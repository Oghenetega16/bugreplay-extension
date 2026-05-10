// content.js — BugReplay content script
// Injected on demand. Survives page navigation by flushing events to
// chrome.storage.session on beforeunload, then resuming on the new page.

(() => {
  if (window.__bugReplayActive) return;
  window.__bugReplayActive = true;

  // ── STATE ──────────────────────────────────────────────────────────────────
  let recording   = false;
  let events      = [];
  let rrwebEvents = [];
  let startTime   = null;
  let rrwebStopFn = null;

  const _XHROpen      = XMLHttpRequest.prototype.open;
  const _XHRSend      = XMLHttpRequest.prototype.send;
  const _fetch        = window.fetch;
  const _consoleLog   = console.log;
  const _consoleWarn  = console.warn;
  const _consoleError = console.error;

  // ── HELPERS ────────────────────────────────────────────────────────────────
  function now() { return Date.now() - startTime; }

  function push(type, data) {
    if (!recording) return;
    events.push({ t: now(), type, ...data });
    pingStatus();
  }

  const SENSITIVE = /password|passwd|pwd|secret|token|auth|card|cvv|ssn|pin/i;
  function scrubValue(el, value) {
    if (!el) return value;
    const name = el.name || el.id || el.autocomplete || el.type || '';
    if (SENSITIVE.test(name) || el.type === 'password') return '[REDACTED]';
    return value;
  }

  function selector(el) {
    if (!el || el === document.body) return 'body';
    const id  = el.id ? '#' + el.id : '';
    const cls = el.className && typeof el.className === 'string'
      ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
    return (el.tagName.toLowerCase() + id + cls).slice(0, 60);
  }

  let pingTimer;
  function pingStatus() {
    clearTimeout(pingTimer);
    pingTimer = setTimeout(() => {
      chrome.runtime.sendMessage({
        action: 'RECORDING_STATUS',
        eventCount: events.length,
        duration: now()
      }).catch(() => {});
    }, 200);
  }

  // ── FLUSH TO STORAGE (called on beforeunload) ──────────────────────────────
  // Saves accumulated events to session storage so background can retrieve
  // them if the content script dies before STOP is called.
  function flushToStorage() {
    if (!recording || !events.length) return;
    try {
      chrome.storage.session.set({
        pendingEvents: events,
        pendingRRwebEvents: rrwebEvents,
        pendingStartTime: startTime,
        pendingUrl: location.href,
        pendingTitle: document.title
      });
    } catch (e) { /* storage unavailable during unload — best effort */ }
  }

  // ── START ──────────────────────────────────────────────────────────────────
  function startRecording(resumeState) {
    if (recording) return;
    recording = true;

    if (resumeState) {
      // Resuming after navigation — restore accumulated events
      events      = resumeState.events      || [];
      rrwebEvents = resumeState.rrwebEvents || [];
      startTime   = resumeState.startTime   || Date.now();
    } else {
      events      = [];
      rrwebEvents = [];
      startTime   = Date.now();
    }

    // Visual DOM recording
    if (window.BugReplayRecorder) {
      rrwebStopFn = window.BugReplayRecorder.record({
        emit(event) {
          rrwebEvents.push({ ...event, br_t: now() });
        }
      });
    }

    // XHR
    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      this.__brMethod = method;
      this.__brUrl    = url;
      return _XHROpen.call(this, method, url, ...rest);
    };
    XMLHttpRequest.prototype.send = function (body) {
      const method = this.__brMethod;
      const url    = this.__brUrl;
      const t0     = now();
      this.addEventListener('loadend', () => {
        push('net', {
          method,
          url: String(url).slice(0, 120),
          status: this.status,
          duration: now() - t0,
          desc: `${method} ${String(url).slice(0, 90)} → ${this.status}`
        });
      });
      return _XHRSend.call(this, body);
    };

    // fetch
    window.fetch = function (resource, init = {}) {
      const method = ((init && init.method) || 'GET').toUpperCase();
      const url    = typeof resource === 'string' ? resource : resource.url;
      const t0     = now();
      return _fetch.call(window, resource, init)
        .then(res => {
          push('net', {
            method, url: String(url).slice(0, 120), status: res.status,
            duration: now() - t0,
            desc: `${method} ${String(url).slice(0, 90)} → ${res.status}`
          });
          return res;
        })
        .catch(err => {
          push('net', {
            method, url: String(url).slice(0, 120), status: 0,
            desc: `${method} ${String(url).slice(0, 90)} → FAILED`
          });
          throw err;
        });
    };

    // console
    console.log = (...args) => {
      _consoleLog.apply(console, args);
      push('log', { level: 'log', desc: args.map(String).join(' ').slice(0, 120) });
    };
    console.warn = (...args) => {
      _consoleWarn.apply(console, args);
      push('log', { level: 'warn', desc: args.map(String).join(' ').slice(0, 120) });
    };
    console.error = (...args) => {
      _consoleError.apply(console, args);
      push('err', { desc: args.map(String).join(' ').slice(0, 120) });
    };

    window.addEventListener('error', onErrorCapture, true);
    window.addEventListener('unhandledrejection', onRejectionCapture, true);
    document.addEventListener('click',   onClickCapture,  true);
    document.addEventListener('input',   onInputCapture,  true);
    document.addEventListener('change',  onChangeCapture, true);
    document.addEventListener('keydown', onKeyCapture,    true);

    // Flush events before page unloads (navigation/redirect)
    window.addEventListener('beforeunload', onBeforeUnload);

    // Add a navigation breadcrumb so the replay shows page changes
    if (resumeState) {
      push('nav', { url: location.href, desc: `navigated to ${location.href}` });
    }

    chrome.runtime.sendMessage({
      action: 'RECORDING_STATUS',
      eventCount: events.length,
      duration: now()
    }).catch(() => {});
  }

  // ── EVENT HANDLERS ─────────────────────────────────────────────────────────
  function onBeforeUnload() {
    flushToStorage();
  }

  function onClickCapture(e) {
    push('click', {
      x: Math.round(e.clientX), y: Math.round(e.clientY),
      target: selector(e.target),
      desc: `click on ${selector(e.target)}`
    });
  }

  function onInputCapture(e) {
    const el = e.target;
    if (!el || !el.tagName) return;
    const value = scrubValue(el, el.value || '');
    push('input', { target: selector(el), value, desc: `${selector(el)} → "${value.slice(0, 40)}"` });
  }

  function onChangeCapture(e) {
    const el    = e.target;
    const value = scrubValue(el, el.value || '');
    push('change', { target: selector(el), value, desc: `${selector(el)} changed → "${value.slice(0, 40)}"` });
  }

  function onKeyCapture(e) {
    const SPECIAL = ['Enter','Escape','Tab','Backspace','Delete','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'];
    if (SPECIAL.includes(e.key)) {
      push('key', { key: e.key, target: selector(e.target), desc: `[${e.key}] on ${selector(e.target)}` });
    }
  }

  function onScrollCapture(e) {
    if (onScrollCapture._t && now() - onScrollCapture._t < 500) return;
    onScrollCapture._t = now();
    push('scroll', {
      x: Math.round(window.scrollX), y: Math.round(window.scrollY),
      desc: `scroll to (${Math.round(window.scrollX)}, ${Math.round(window.scrollY)})`
    });
  }

  function onErrorCapture(e) {
    push('err', {
      message: e.message, source: e.filename, line: e.lineno,
      desc: `JS Error: ${e.message} @ ${(e.filename || '').split('/').pop()}:${e.lineno}`
    });
  }

  function onRejectionCapture(e) {
    push('err', { message: String(e.reason), desc: `Unhandled rejection: ${String(e.reason).slice(0, 100)}` });
  }

  // ── STOP ───────────────────────────────────────────────────────────────────
  function stopRecording() {
    if (!recording) return null;
    recording = false;

    if (rrwebStopFn) { try { rrwebStopFn(); } catch (e) {} rrwebStopFn = null; }

    document.removeEventListener('click',   onClickCapture,   true);
    document.removeEventListener('input',   onInputCapture,   true);
    document.removeEventListener('change',  onChangeCapture,  true);
    document.removeEventListener('keydown', onKeyCapture,     true);
    document.removeEventListener('scroll',  onScrollCapture,  true);
    window.removeEventListener('error',              onErrorCapture,     true);
    window.removeEventListener('unhandledrejection', onRejectionCapture, true);
    window.removeEventListener('beforeunload',       onBeforeUnload);

    XMLHttpRequest.prototype.open = _XHROpen;
    XMLHttpRequest.prototype.send = _XHRSend;
    window.fetch   = _fetch;
    console.log    = _consoleLog;
    console.warn   = _consoleWarn;
    console.error  = _consoleError;

    window.__bugReplayActive = false;

    // Clear pending storage — we have the full payload now
    chrome.storage.session.remove([
      'pendingEvents', 'pendingRRwebEvents', 'pendingStartTime',
      'pendingUrl', 'pendingTitle'
    ]).catch(() => {});

    const payload = buildPayload();
    chrome.runtime.sendMessage({ action: 'RECORDING_COMPLETE', data: payload }).catch(() => {});
    return payload;
  }

  function buildPayload() {
    return {
      version:   '1.1',
      schema:    'bugreplay',
      hasVisual: rrwebEvents.length > 0,
      meta: {
        recordedAt:  new Date(startTime).toISOString(),
        duration:    Math.max(
          events.length      ? events[events.length - 1].t            : 0,
          rrwebEvents.length ? rrwebEvents[rrwebEvents.length - 1].br_t : 0
        ),
        eventCount:  events.length,
        rrwebCount:  rrwebEvents.length,
        url:         location.href,
        title:       document.title,
        userAgent:   navigator.userAgent,
        viewport:    { width: window.innerWidth, height: window.innerHeight }
      },
      events,
      rrwebEvents
    };
  }

  // ── MESSAGE LISTENER ───────────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'START_RECORDING') {
      startRecording(msg.resumeState || null);
      sendResponse({ ok: true });
      return false;
    }
    if (msg.action === 'STOP_RECORDING') {
      const p = stopRecording();
      sendResponse({ ok: !!p, eventCount: p ? p.events.length : 0 });
      return false;
    }
  });

})();
