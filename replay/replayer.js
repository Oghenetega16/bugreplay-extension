// replayer.js — BugReplay visual replayer
// Reconstructs the recorded page inside a sandboxed iframe using
// the rrwebEvents stream, then overlays semantic events (clicks, net, etc.)

'use strict';

// ── STATE ──────────────────────────────────────────────────────────────────
let data        = null;
let idx         = 0;        // semantic events cursor
let rrIdx       = 0;        // rrweb events cursor
let paused      = false;
let timer       = null;
let replayFrame = null;     // <iframe> DOM element
let baseUrl     = '';       // recorded page URL (for resolving relative paths)
let replayStart = null;     // wall-clock time replay began (for sync)
let idMap       = new Map();// serialised-node id → live DOM node in iframe

// ── INIT ───────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');

  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') fileInput.click();
  });
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('over');
  });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('over'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('over');
    const file = e.dataTransfer.files[0];
    if (file) loadFile(file);
  });
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) loadFile(file);
  });

  document.getElementById('btn-play').addEventListener('click', play);
  document.getElementById('btn-pause').addEventListener('click', pause);
  document.getElementById('btn-reset').addEventListener('click', reset);
});

// ── FILE LOADING ───────────────────────────────────────────────────────────
function loadFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const parsed = JSON.parse(e.target.result);
      if (!parsed.events || !Array.isArray(parsed.events)) throw new Error('Missing events');
      data    = parsed;
      idx     = 0;
      rrIdx   = 0;
      baseUrl = (parsed.meta && parsed.meta.url) || '';
      renderMeta();
      renderEventsList();
      showPlayer();
    } catch (err) {
      alert('Invalid .replay file.\n\n' + err.message);
    }
  };
  reader.readAsText(file);
}

function showPlayer() {
  document.getElementById('drop-zone').style.display = 'none';
  document.getElementById('player-card').style.display = 'block';

  const m = data.meta || {};
  document.getElementById('session-title').textContent = '// ' + (m.title || 'Session');
  document.getElementById('session-url').textContent   = (m.url || '').slice(0, 60);

  const totalMs = m.duration || 0;
  document.getElementById('tl-total').textContent = fmtTime(totalMs);

  // Show visual or log mode badge
  const hasVisual = data.hasVisual && data.rrwebEvents && data.rrwebEvents.length > 0;
  const modeBadge = document.getElementById('mode-badge');
  if (modeBadge) {
    modeBadge.textContent    = hasVisual ? '● VISUAL MODE' : '● LOG MODE';
    modeBadge.style.color    = hasVisual ? 'var(--accent2)' : 'var(--muted)';
  }

  // Build replay viewport
  buildViewport(hasVisual);
}

// ── VIEWPORT SETUP ─────────────────────────────────────────────────────────
function buildViewport(hasVisual) {
  const vp = document.getElementById('viewport');
  vp.innerHTML = '';

  if (hasVisual) {
    // Sandboxed iframe for visual DOM replay
    replayFrame = document.createElement('iframe');
    replayFrame.id = 'replay-iframe';
    replayFrame.sandbox = 'allow-same-origin'; // needed to write to contentDocument
    replayFrame.style.cssText = [
      'width:100%',
      'height:100%',
      'border:none',
      'background:#fff',
      'border-radius:4px',
      'display:block'
    ].join(';');
    vp.appendChild(replayFrame);

    // Cursor overlay
    const cursor = document.createElement('div');
    cursor.id = 'replay-cursor';
    cursor.style.cssText = [
      'position:absolute',
      'width:18px',
      'height:18px',
      'border-radius:50%',
      'background:rgba(232,255,71,0.4)',
      'border:2px solid #e8ff47',
      'pointer-events:none',
      'transform:translate(-50%,-50%)',
      'display:none',
      'z-index:100',
      'transition:left 0.05s linear,top 0.05s linear'
    ].join(';');
    vp.style.position = 'relative';
    vp.appendChild(cursor);
  } else {
    // Log mode: plain event stream div
    const log = document.createElement('div');
    log.id = 'replay-log';
    log.style.cssText = [
      'height:100%',
      'overflow-y:auto',
      'padding:12px',
      'font-family:var(--mono)',
      'font-size:11px'
    ].join(';');
    log.innerHTML = '<div class="vp-empty">Press PLAY to begin replay</div>';
    vp.appendChild(log);
  }
}

// ── META ───────────────────────────────────────────────────────────────────
function renderMeta() {
  const m    = data.meta || {};
  const dur  = m.duration ? (m.duration / 1000).toFixed(1) + 's' : '—';
  const rec  = m.recordedAt ? new Date(m.recordedAt).toLocaleString() : '—';
  const ua   = m.userAgent ? m.userAgent.slice(0, 55) + '…' : '—';
  const vp   = m.viewport  ? m.viewport.width + '×' + m.viewport.height : '—';
  const vis  = (data.hasVisual && data.rrwebEvents && data.rrwebEvents.length)
               ? data.rrwebEvents.length + ' DOM events' : 'Log only';

  document.getElementById('meta-body').innerHTML =
    mr('RECORDED',  rec)        +
    mr('EVENTS',    m.eventCount || data.events.length) +
    mr('VISUAL',    vis)        +
    mr('DURATION',  dur)        +
    mr('VIEWPORT',  vp)         +
    mr('URL',       (m.url||'').slice(0,55), true);
}

function mr(k, v, small) {
  return '<div class="meta-row"><span class="mk">' + esc(k) + '</span>' +
         '<span class="mv"' + (small?' style="font-size:9px"':'') + '>' + esc(String(v)) + '</span></div>';
}

// ── EVENTS LIST ────────────────────────────────────────────────────────────
function renderEventsList() {
  const c = document.getElementById('events-list');
  c.innerHTML = '';
  (data.events || []).forEach((ev, i) => {
    const row = document.createElement('div');
    row.className = 'ev-row';
    row.id        = 'ev-' + i;

    const t = document.createElement('span');
    t.className   = 'ev-time';
    t.textContent = (ev.t / 1000).toFixed(2) + 's';

    const tp = document.createElement('span');
    tp.className  = 'vp-type t-' + ev.type;
    tp.textContent = ev.type.toUpperCase();

    const d = document.createElement('span');
    d.className   = 'ev-desc';
    d.textContent = ev.desc || '';

    row.append(t, tp, d);
    c.appendChild(row);
  });
}

// ── PLAYBACK ───────────────────────────────────────────────────────────────
function play() {
  if (!data) return;
  paused      = false;
  replayStart = Date.now();

  document.getElementById('btn-play').disabled  = true;
  document.getElementById('btn-pause').disabled = false;

  const hasVisual = data.hasVisual && data.rrwebEvents && data.rrwebEvents.length > 0;

  if (hasVisual && rrIdx === 0) {
    // Apply full snapshot synchronously before starting the tick loop
    applyFullSnapshot(data.rrwebEvents[0]);
    rrIdx = 1;
  }

  tick();
}

function pause() {
  paused = true;
  clearTimeout(timer);
  document.getElementById('btn-play').disabled  = false;
  document.getElementById('btn-pause').disabled = true;
}

function reset() {
  clearTimeout(timer);
  paused = false;
  idx    = 0;
  rrIdx  = 0;
  idMap.clear();

  document.getElementById('btn-play').disabled  = false;
  document.getElementById('btn-pause').disabled = true;
  document.getElementById('tl-fill').style.width = '0%';
  document.getElementById('tl-cur').textContent  = '0:00';

  const hasVisual = data && data.hasVisual && data.rrwebEvents && data.rrwebEvents.length > 0;
  buildViewport(hasVisual);
  if (data) renderEventsList();

  const cursor = document.getElementById('replay-cursor');
  if (cursor) cursor.style.display = 'none';
}

// Main tick — advances both streams in timestamp order
function tick() {
  if (paused || !data) return;

  const speed   = parseFloat(document.getElementById('speed-sel').value) || 1;
  const totalMs = (data.meta && data.meta.duration) || 1;
  const evs     = data.events    || [];
  const rrEvs   = data.rrwebEvents || [];

  const nextSem  = evs[idx];
  const nextRR   = rrEvs[rrIdx];

  // Done?
  if (!nextSem && !nextRR) {
    document.getElementById('btn-play').disabled  = false;
    document.getElementById('btn-pause').disabled = true;
    document.getElementById('tl-fill').style.width = '100%';
    return;
  }

  // Which stream is next?
  const semT = nextSem ? nextSem.t         : Infinity;
  const rrT  = nextRR  ? nextRR.br_t       : Infinity;

  let delay;

  if (rrT <= semT && nextRR) {
    // Apply rrweb visual event
    applyRRwebEvent(nextRR);
    const afterT = rrEvs[rrIdx + 1] ? rrEvs[rrIdx + 1].br_t : (evs[idx] ? evs[idx].t : totalMs);
    delay = (afterT - rrT) / speed;
    rrIdx++;
  } else if (nextSem) {
    // Apply semantic event
    applySemanticEvent(nextSem, idx);
    updateTimeline(nextSem.t, totalMs);
    const afterT = evs[idx + 1] ? evs[idx + 1].t : (rrEvs[rrIdx] ? rrEvs[rrIdx].br_t : totalMs);
    delay = (afterT - nextSem.t) / speed;
    idx++;
  }

  timer = setTimeout(() => tick(), Math.max(delay || 0, 20));
}

function updateTimeline(t, totalMs) {
  document.getElementById('tl-fill').style.width = ((t / totalMs) * 100) + '%';
  document.getElementById('tl-cur').textContent  = fmtTime(t);

  // Highlight semantic event row
  document.querySelectorAll('.ev-row').forEach(r => r.classList.remove('current'));
  const row = document.getElementById('ev-' + (idx));
  if (row) { row.classList.add('current'); row.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
}

// ── SEMANTIC EVENT RENDERING ───────────────────────────────────────────────
function applySemanticEvent(ev, i) {
  const hasVisual = data.hasVisual && data.rrwebEvents && data.rrwebEvents.length > 0;

  if (hasVisual) {
    // In visual mode just flash cursor on click; rrweb handles DOM
    if (ev.type === 'click' && ev.x != null) {
      flashCursor(ev.x, ev.y);
    }
  } else {
    // Log mode: append to log div
    appendToLog(ev);
  }

  // Always update event list highlight
  document.querySelectorAll('.ev-row').forEach(r => r.classList.remove('current'));
  const row = document.getElementById('ev-' + i);
  if (row) { row.classList.add('current'); row.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
}

function appendToLog(ev) {
  const log = document.getElementById('replay-log');
  if (!log) return;
  const empty = log.querySelector('.vp-empty');
  if (empty) empty.remove();

  const line = document.createElement('div');
  line.className = 'vp-line';

  const t  = document.createElement('span');
  t.className   = 'vp-time';
  t.textContent = (ev.t / 1000).toFixed(2) + 's';

  const tp = document.createElement('span');
  tp.className  = 'vp-type t-' + ev.type;
  tp.textContent = ev.type.toUpperCase();

  const d  = document.createElement('span');
  d.className   = 'vp-desc';
  d.textContent = ev.desc || '';

  line.append(t, tp, d);
  log.appendChild(line);
  log.scrollTop = log.scrollHeight;
}

function flashCursor(x, y) {
  const cursor = document.getElementById('replay-cursor');
  if (!cursor) return;
  cursor.style.display = 'block';
  cursor.style.left    = x + 'px';
  cursor.style.top     = y + 'px';
  setTimeout(() => { if (cursor) cursor.style.display = 'none'; }, 500);
}

// ── RRWEB EVENT APPLICATION ────────────────────────────────────────────────
// Type 2 = FullSnapshot, Type 3 = IncrementalSnapshot
// Source constants: 0=Mutation, 1=MouseMove, 2=MouseInteraction,
//                  3=Scroll, 4=ViewportResize, 5=Input

function applyFullSnapshot(event) {
  if (!replayFrame) return;
  idMap.clear();
  try {
    const iDoc = replayFrame.contentDocument || replayFrame.contentWindow.document;
    iDoc.open();
    iDoc.write('<!DOCTYPE html><html><head></head><body></body></html>');
    iDoc.close();

    const snap = event.data;
    if (snap && snap.node) {
      buildDOM(snap.node, iDoc, iDoc);
    }

    // Inject base tag so relative URLs resolve correctly
    if (baseUrl) {
      const base = iDoc.createElement('base');
      base.href  = baseUrl;
      const head = iDoc.querySelector('head');
      if (head) head.insertBefore(base, head.firstChild);
    }

    // Initial scroll
    if (snap && snap.initialOffset) {
      iDoc.documentElement.scrollTop  = snap.initialOffset.top  || 0;
      iDoc.documentElement.scrollLeft = snap.initialOffset.left || 0;
    }
  } catch (e) {
    console.warn('[BugReplay] Full snapshot error:', e);
  }
}

function applyRRwebEvent(event) {
  if (event.type === 2) { applyFullSnapshot(event); return; }
  if (event.type !== 3 || !replayFrame) return;

  try {
    const iDoc = replayFrame.contentDocument || replayFrame.contentWindow.document;
    const d    = event.data;

    switch (d.source) {
      case 0: // Mutation
        applyMutation(d, iDoc);
        break;

      case 1: // MouseMove
        if (d.positions && d.positions.length) {
          const p = d.positions[d.positions.length - 1];
          // Convert iframe coordinates to overlay coordinates
          const ifRect = replayFrame.getBoundingClientRect();
          flashCursor(ifRect.left + p.x, ifRect.top + p.y);
        }
        break;

      case 2: // MouseInteraction (click)
        if (d.type === 2 /* Click */) {
          const ifRect = replayFrame.getBoundingClientRect();
          flashCursor(ifRect.left + (d.x || 0), ifRect.top + (d.y || 0));
        }
        break;

      case 3: // Scroll
        try {
          const target = idMap.get(d.id) || iDoc.documentElement;
          if (target && target.scrollTo) target.scrollTo(d.x || 0, d.y || 0);
        } catch(e) {}
        break;

      case 5: // Input
        try {
          const el = idMap.get(d.id);
          if (el) {
            if (el.type === 'checkbox' || el.type === 'radio') {
              el.checked = d.isChecked;
            } else {
              el.value = d.text || '';
            }
          }
        } catch(e) {}
        break;
    }
  } catch (e) {
    // Silently ignore cross-origin iframe errors
  }
}

function applyMutation(d, iDoc) {
  // Removals
  (d.removes || []).forEach(r => {
    const node = idMap.get(r.id);
    if (node && node.parentNode) node.parentNode.removeChild(node);
  });

  // Additions
  (d.adds || []).forEach(add => {
    const parent = idMap.get(add.parentId) || iDoc.documentElement;
    if (!parent) return;
    const node = buildDOM(add.node, iDoc, iDoc);
    if (!node) return;
    if (add.nextId) {
      const nextSib = idMap.get(add.nextId);
      parent.insertBefore(node, nextSib || null);
    } else {
      parent.appendChild(node);
    }
  });

  // Attribute changes
  (d.attributes || []).forEach(a => {
    const el = idMap.get(a.id);
    if (!el || !el.setAttribute) return;
    Object.entries(a.attributes || {}).forEach(([k, v]) => {
      try {
        if (v === null) { el.removeAttribute(k); }
        else { el.setAttribute(k, v); }
      } catch(e) {}
    });
  });

  // Text changes
  (d.texts || []).forEach(t => {
    const node = idMap.get(t.id);
    if (node) node.textContent = t.value;
  });
}

// ── DOM BUILDER ────────────────────────────────────────────────────────────
// Recreates the serialised node tree inside the iframe document
const NodeType = { Document:0, DocumentType:1, Element:2, Text:3, CDATA:4, Comment:5 };

function buildDOM(sNode, iDoc, parentDoc) {
  if (!sNode) return null;
  let node = null;

  switch (sNode.type) {
    case NodeType.Document:
      // Just recurse into children using the existing iDoc
      (sNode.childNodes || []).forEach(c => {
        const child = buildDOM(c, iDoc, parentDoc);
        if (child) {
          try { iDoc.documentElement ? iDoc.documentElement.appendChild(child) : iDoc.appendChild(child); }
          catch(e) {}
        }
      });
      return iDoc;

    case NodeType.DocumentType:
      // Can't create in an already-opened document; skip
      return null;

    case NodeType.Element: {
      const tag = sNode.tagName;
      // Skip scripts — we don't re-execute JS in the replay iframe
      if (tag === 'script') return null;

      try {
        node = sNode.isSVG
          ? iDoc.createElementNS('http://www.w3.org/2000/svg', tag)
          : iDoc.createElement(tag);
      } catch(e) { return null; }

      // Set attributes
      const attrs = sNode.attributes || {};
      Object.entries(attrs).forEach(([k, v]) => {
        if (k === '__live_value') return; // handle below
        try { node.setAttribute(k, v); } catch(e) {}
      });

      // Live form values
      if (attrs.__live_value !== undefined) {
        node.value = attrs.__live_value;
      }

      // Inline style override for reconstructed sheets
      if (sNode.inlineStyleText) {
        node.textContent = sNode.inlineStyleText;
      }

      // Recurse
      (sNode.childNodes || []).forEach(c => {
        const child = buildDOM(c, iDoc, parentDoc);
        if (child) { try { node.appendChild(child); } catch(e) {} }
      });

      if (sNode.id) idMap.set(sNode.id, node);
      return node;
    }

    case NodeType.Text:
      try {
        node = iDoc.createTextNode(sNode.textContent || '');
        if (sNode.id) idMap.set(sNode.id, node);
        return node;
      } catch(e) { return null; }

    case NodeType.Comment:
      try {
        node = iDoc.createComment(sNode.textContent || '');
        if (sNode.id) idMap.set(sNode.id, node);
        return node;
      } catch(e) { return null; }

    default:
      return null;
  }
}

// ── UTILS ──────────────────────────────────────────────────────────────────
function fmtTime(ms) {
  const s  = Math.round((ms || 0) / 1000);
  const mm = Math.floor(s / 60);
  const ss = String(s % 60).padStart(2, '0');
  return mm + ':' + ss;
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = String(s);
  return d.innerHTML;
}
