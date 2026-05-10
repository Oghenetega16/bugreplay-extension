// popup.js — BugReplay popup controller
// No inline handlers. All event listeners attached via addEventListener.

'use strict';

let state = 'idle'; // idle | recording | done
let timerInterval = null;
let startTime = null;

// ─────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadPageInfo();
  checkExistingRecording();
  bindButtons();

  // Listen for live updates from content script (relayed via background)
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
  chrome.storage.local.get(['recordingState'], (res) => {
    if (res.recordingState === 'recording') {
      transitionToRecording(false);
    }
  });
}

// ─────────────────────────────────────────────
// STATE TRANSITIONS
// ─────────────────────────────────────────────
function transitionToRecording(sendStart) {
  state = 'recording';
  startTime = Date.now();

  document.getElementById('main-idle').classList.add('hidden');
  document.getElementById('main-done').classList.add('hidden');
  document.getElementById('main-recording').classList.remove('hidden');

  document.getElementById('logo-icon').classList.add('recording');
  document.getElementById('logo-icon').textContent = '\u23FA'; // ⏺
  document.getElementById('status-pill').textContent = 'REC';
  document.getElementById('status-pill').className = 'status-pill recording';

  const feed = document.getElementById('event-feed');
  feed.innerHTML = '<div class="feed-empty">Listening for events\u2026</div>';

  timerInterval = setInterval(() => {
    const s = Math.floor((Date.now() - startTime) / 1000);
    const mm = Math.floor(s / 60);
    const ss = String(s % 60).padStart(2, '0');
    const el = document.getElementById('stat-time');
    if (el) el.textContent = mm + ':' + ss;
  }, 500);

  if (sendStart) {
    chrome.storage.local.set({ recordingState: 'recording' });
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
  clearInterval(timerInterval);
  chrome.storage.local.set({ recordingState: 'idle' });

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
  clearInterval(timerInterval);
  chrome.storage.local.set({ recordingState: 'done' });

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
  chrome.runtime.sendMessage({ action: 'STOP_RECORDING' }, (res) => {
    if (chrome.runtime.lastError || !res || !res.ok) {
      showError('Failed to stop recording. Try refreshing the page.');
      return;
    }
    // RECORDING_COMPLETE message will trigger transitionToDone,
    // but use a fallback in case the popup missed it
    setTimeout(() => {
      if (state === 'recording') transitionToDone(res.eventCount || 0);
    }, 2000);
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
