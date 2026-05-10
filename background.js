// background.js — BugReplay service worker
// Injects rrweb-lite.js THEN content.js so BugReplayRecorder is available
// when content.js runs.

'use strict';

let recordingTabId = null;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  // ── START ────────────────────────────────────────────────────────────────
  if (msg.action === 'START_RECORDING') {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const tab = tabs[0];
      if (!tab) return sendResponse({ ok: false, error: 'No active tab' });

      recordingTabId = tab.id;

      try {
        // 1. Inject the visual recorder (rrweb-lite) first
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['rrweb-lite.js']
        });

        // 2. Inject the semantic content script
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content.js']
        });

        // 3. Signal content script to start
        setTimeout(() => {
          chrome.tabs.sendMessage(tab.id, { action: 'START_RECORDING' }, (r) => {
            if (chrome.runtime.lastError) {
              sendResponse({ ok: false, error: chrome.runtime.lastError.message });
            } else {
              sendResponse(r || { ok: true });
            }
          });
        }, 150);

      } catch (e) {
        recordingTabId = null;
        sendResponse({ ok: false, error: e.message });
      }
    });
    return true;
  }

  // ── STOP ─────────────────────────────────────────────────────────────────
  if (msg.action === 'STOP_RECORDING') {
    if (!recordingTabId) return sendResponse({ ok: false, error: 'Not recording' });
    chrome.tabs.sendMessage(recordingTabId, { action: 'STOP_RECORDING' }, (r) => {
      if (chrome.runtime.lastError) {
        sendResponse({ ok: false, error: chrome.runtime.lastError.message });
      } else {
        sendResponse(r || { ok: false });
      }
    });
    return true;
  }

  // ── STATUS RELAY ─────────────────────────────────────────────────────────
  if (msg.action === 'RECORDING_STATUS') {
    chrome.runtime.sendMessage(msg).catch(() => {});
    return false;
  }

  // ── COMPLETE: encode + download ──────────────────────────────────────────
  if (msg.action === 'RECORDING_COMPLETE') {
    const payload = msg.data;
    recordingTabId = null;

    chrome.storage.local.set({ lastRecording: payload, recordingState: 'done' });

    try {
      const json  = JSON.stringify(payload);
      const bytes = new TextEncoder().encode(json);

      // btoa can't handle arbitrary bytes; encode via Uint8Array loop
      let binary = '';
      // Process in 8KB chunks to avoid call-stack limits on large sessions
      const CHUNK = 8192;
      for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
      }
      const b64     = btoa(binary);
      const dataUri = 'data:application/octet-stream;base64,' + b64;
      const ts      = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

      chrome.downloads.download({
        url: dataUri,
        filename: 'bugreplay-' + ts + '.replay',
        saveAs: false
      }, (id) => {
        if (chrome.runtime.lastError) {
          console.error('[BugReplay] Download error:', chrome.runtime.lastError.message);
        }
      });

      sendResponse({ ok: true, eventCount: payload.meta && payload.meta.eventCount });
    } catch (e) {
      console.error('[BugReplay] Encode error:', e);
      sendResponse({ ok: false, error: e.message });
    }
    return true;
  }
});

// Clean up on tab close
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === recordingTabId) {
    recordingTabId = null;
    chrome.storage.local.set({ recordingState: 'idle' });
  }
});
