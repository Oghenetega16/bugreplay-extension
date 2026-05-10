// popup.js — BugReplay popup controller
// No inline handlers. All event listeners attached via addEventListener.

'use strict';

let state = 'idle'; // idle | recording | done
let timerInterval = null;
let startTime = null; // set from chrome.storage on reopen, not from Date.now()

// ─────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadPageInfo();
  checkExistingRecording(); // reads storage FIRST, then binds buttons
  bindButtons();

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'RECORDING_STATUS') {
      updateLiveStats(msg.eventCount);
    }
    if (msg.action === 'RECORDING_COMPLETE') {
      const count = (msg.data && msg.data.meta && msg.data.meta.eventCount) || 0;
      transitionToDone(count);
    }
  });
});

function bindButtons() {
  document.getElementById('btn-start').addEventListener('click', startRecording);
  document.getElementById('btn-stop').addEventListener('click', stopRecording);
  document.getElementById('btn-open-replayer').addEventListener('click', openReplayer);
  document.getElementById('btn-new-recording').addEventListener('click', resetToIdle);
  document.getElementById('footer-replayer-link').addEventListener('click', openReplayer);
}

function loadPageInfo() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab) return;
    const titleEl = document.getElementById('page-title');
    const urlEl = document.getElementById('page-url');
    if (titleEl) titleEl.textContent = tab.title || 'Untitled';
    if (urlEl) urlEl.textContent = tab.url || '';
  });
}

function checkExistingRecording() {
  // Read both state AND the recorded start time so the timer is accurate on reopen
  chrome.storage.local.get(['recordingState', 'recordingStartTime', 'recordingEventCount'], (res) => {
    if (res.recordingState === 'recording') {
      // Restore wall-clock start so timer shows correct elapsed time
      startTime = res.recordingStartTime || Date.now();
      transitionToRecording(false, res.recordingEventCount || 0);
    } else if (res.recordingState === 'done') {
      // Show done state if popup was closed before user saw it
      chrome.storage.local.get(['lastRecording'], (r) => {
        const count = r.lastRecording && r.lastRecording.meta && r.lastRecording.meta.eventCount || 0;
        transitionToDone(count);
      });
    }
  });
}

// ─────────────────────────────────────────────
// STATE TRANSITIONS
// ─────────────────────────────────────────────
function transitionToRecording(sendStart, restoredEventCount) {
  state = 'recording';
  // Only set startTime if not already restored from storage
  if (!startTime) startTime = Date.now();

  document.getElementById('main-idle').classList.add('hidden');
  document.getElementById('main-done').classList.add('hidden');
  document.getElementById('main-recording').classList.remove('hidden');

  document.getElementById('logo-icon').classList.add('recording');
  document.getElementById('logo-icon').textContent = '\u23FA';
  document.getElementById('status-pill').textContent = 'REC';
  document.getElementById('status-pill').className = 'status-pill recording';

  const feed = document.getElementById('event-feed');
  feed.innerHTML = '<div class="feed-empty">Listening for events\u2026</div>';

  // Restore event count display if reopening mid-session
  if (restoredEventCount) {
    const el = document.getElementById('stat-events');
    if (el) el.textContent = restoredEventCount;
  }

  // Start (or resume) the timer — reads from startTime which may be from storage
  clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    const s  = Math.floor((Date.now() - startTime) / 1000);
    const mm = Math.floor(s / 60);
    const ss = String(s % 60).padStart(2, '0');
    const el = document.getElementById('stat-time');
    if (el) el.textContent = mm + ':' + ss;
  }, 500);

  if (sendStart) {
    // Persist start time so it survives popup close
    chrome.storage.local.set({
      recordingState: 'recording',
      recordingStartTime: startTime,
      recordingEventCount: 0
    });
    chrome.runtime.sendMessage({ action: 'START_RECORDING' }, (res) => {
      if (chrome.runtime.lastError || !res || !res.ok) {
        const err = (chrome.runtime.lastError && chrome.runtime.lastError.message) ||
                    (res && res.error) || 'Unknown error';
        showError('Cannot record this page: ' + err);
        transitionToIdle();
      }
    });
  }
}

function transitionToIdle() {
  state = 'idle';
  startTime = null;
  clearInterval(timerInterval);
  chrome.storage.local.set({ recordingState: 'idle' });
  chrome.storage.local.remove(['recordingStartTime', 'recordingEventCount']);

  document.getElementById('main-recording').classList.add('hidden');
  document.getElementById('main-done').classList.add('hidden');
  document.getElementById('main-idle').classList.remove('hidden');

  const icon = document.getElementById('logo-icon');
  icon.classList.remove('recording');
  icon.textContent = '\u23FA'; // ⏺
  icon.style.background = '';
  icon.style.color = '';

  document.getElementById('status-pill').textContent = 'IDLE';
  document.getElementById('status-pill').className = 'status-pill';
}

function transitionToDone(eventCount) {
  state = 'done';
  startTime = null;
  clearInterval(timerInterval);
  chrome.storage.local.set({ recordingState: 'done' });
  chrome.storage.local.remove(['recordingStartTime', 'recordingEventCount']);

  document.getElementById('main-recording').classList.add('hidden');
  document.getElementById('main-idle').classList.add('hidden');
  document.getElementById('main-done').classList.remove('hidden');

  const icon = document.getElementById('logo-icon');
  icon.classList.remove('recording');
  icon.textContent = '\u2713'; // ✓
  icon.style.background = 'var(--accent2)';
  icon.style.color = '#000';

  document.getElementById('status-pill').textContent = 'DONE';
  document.getElementById('status-pill').className = 'status-pill done';
  document.getElementById('done-sub').textContent = eventCount + ' events captured';
}

// ─────────────────────────────────────────────
// ACTIONS
// ─────────────────────────────────────────────
function startRecording() {
  transitionToRecording(true);
}

function stopRecording() {
  // Disable button immediately so user knows the click registered
  const btn = document.getElementById('btn-stop');
  if (btn) { btn.disabled = true; btn.textContent = 'Stopping…'; }

  chrome.runtime.sendMessage({ action: 'STOP_RECORDING' }, (res) => {
    if (btn) { btn.disabled = false; btn.textContent = '⏹ STOP & EXPORT'; }

    if (chrome.runtime.lastError) {
      showError('Could not reach the page. Was it closed?');
      return;
    }

    if (res && res.ok) {
      // recovered: true means background recovered events from storage after navigation
      if (res.recovered) {
        transitionToDone(res.eventCount || 0);
      } else {
        // Normal stop — RECORDING_COMPLETE message will call transitionToDone,
        // but fall back after 2s in case the popup missed the message
        setTimeout(() => {
          if (state === 'recording') transitionToDone(res.eventCount || 0);
        }, 2000);
      }
      return;
    }

    showError((res && res.error) || 'Failed to stop recording.');
  });
}

function resetToIdle() {
  transitionToIdle();
  loadPageInfo();
}

function openReplayer() {
  // getURL path is relative to the extension root, no leading dots
  chrome.tabs.create({ url: chrome.runtime.getURL('replay/replayer.html') });
}

// ─────────────────────────────────────────────
// LIVE STATS
// ─────────────────────────────────────────────
function updateLiveStats(eventCount) {
  const el = document.getElementById('stat-events');
  if (el) el.textContent = eventCount;
  // Keep storage in sync so count is correct if popup is closed and reopened
  chrome.storage.local.set({ recordingEventCount: eventCount });
}

// ─────────────────────────────────────────────
// ERROR DISPLAY
// ─────────────────────────────────────────────
function showError(msg) {
  const hint = document.querySelector('.hint');
  if (hint) {
    hint.style.color = 'var(--danger)';
    hint.textContent = msg;
  }
}

// ─────────────────────────────────────────────
// FEED HELPERS (called from updateLiveStats batch updates)
// ─────────────────────────────────────────────
function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
