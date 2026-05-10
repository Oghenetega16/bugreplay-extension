// background.js — BugReplay service worker

'use strict';

async function getRecordingTabId() {
  const res = await chrome.storage.session.get('recordingTabId');
  return res.recordingTabId || null;
}

async function setRecordingTabId(id) {
  if (id === null) {
    await chrome.storage.session.remove('recordingTabId');
  } else {
    await chrome.storage.session.set({ recordingTabId: id });
  }
}

// Inject rrweb-lite + content script, then send a message to start/resume
async function injectAndStart(tabId, resumeState) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ['rrweb-lite.js'] });
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  return new Promise((resolve) => {
    setTimeout(() => {
      chrome.tabs.sendMessage(tabId, { action: 'START_RECORDING', resumeState }, (r) => {
        resolve(chrome.runtime.lastError ? { ok: false, error: chrome.runtime.lastError.message } : r || { ok: true });
      });
    }, 150);
  });
}

// ── MESSAGES ──────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  if (msg.action === 'START_RECORDING') {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const tab = tabs[0];
      if (!tab) return sendResponse({ ok: false, error: 'No active tab' });
      await setRecordingTabId(tab.id);
      try {
        const r = await injectAndStart(tab.id, null);
        sendResponse(r);
      } catch (e) {
        await setRecordingTabId(null);
        sendResponse({ ok: false, error: e.message });
      }
    });
    return true;
  }

  if (msg.action === 'STOP_RECORDING') {
    getRecordingTabId().then(async (tabId) => {
      if (!tabId) return sendResponse({ ok: false, error: 'Not recording' });

      // Try sending STOP to the live content script
      chrome.tabs.sendMessage(tabId, { action: 'STOP_RECORDING' }, async (r) => {
        if (!chrome.runtime.lastError && r && r.ok) {
          // Content script responded — normal stop
          return sendResponse(r);
        }

        // Content script is gone (navigated away). Build payload from
        // whatever was flushed to session storage before the navigation.
        console.warn('[BugReplay] Content script unreachable — recovering from storage');
        const stored = await chrome.storage.session.get([
          'pendingEvents', 'pendingRRwebEvents', 'pendingStartTime',
          'pendingUrl', 'pendingTitle'
        ]);

        const events      = stored.pendingEvents      || [];
        const rrwebEvents = stored.pendingRRwebEvents || [];
        const startTime   = stored.pendingStartTime   || Date.now();

        if (events.length === 0 && rrwebEvents.length === 0) {
          await setRecordingTabId(null);
          chrome.storage.local.set({ recordingState: 'idle' });
          return sendResponse({ ok: false, error: 'No events captured before navigation' });
        }

        const payload = {
          version:   '1.1',
          schema:    'bugreplay',
          hasVisual: rrwebEvents.length > 0,
          meta: {
            recordedAt:  new Date(startTime).toISOString(),
            duration:    Math.max(
              events.length      ? events[events.length - 1].t             : 0,
              rrwebEvents.length ? rrwebEvents[rrwebEvents.length - 1].br_t : 0
            ),
            eventCount:  events.length,
            rrwebCount:  rrwebEvents.length,
            url:         stored.pendingUrl   || '',
            title:       stored.pendingTitle || 'Recovered session',
            userAgent:   '',
            viewport:    {}
          },
          events,
          rrwebEvents
        };

        // Clear pending storage
        chrome.storage.session.remove([
          'pendingEvents', 'pendingRRwebEvents', 'pendingStartTime',
          'pendingUrl', 'pendingTitle'
        ]);

        await setRecordingTabId(null);
        downloadPayload(payload);
        chrome.storage.local.set({ lastRecording: payload, recordingState: 'done' });
        sendResponse({ ok: true, eventCount: events.length, recovered: true });
      });
    });
    return true;
  }

  if (msg.action === 'RECORDING_STATUS') {
    chrome.runtime.sendMessage(msg).catch(() => {});
    return false;
  }

  if (msg.action === 'RECORDING_COMPLETE') {
    const payload = msg.data;
    setRecordingTabId(null);
    chrome.storage.local.set({ lastRecording: payload, recordingState: 'done' });
    downloadPayload(payload);
    sendResponse({ ok: true, eventCount: payload.meta && payload.meta.eventCount });
    return true;
  }
});

// ── NAVIGATION LISTENER — re-inject on redirect during recording ───────────
chrome.webNavigation.onCommitted.addListener(async (details) => {
  // Only care about top-level navigations (not iframes)
  if (details.frameId !== 0) return;

  const tabId = await getRecordingTabId();
  if (!tabId || details.tabId !== tabId) return;

  // Small delay to let the new page stabilise
  setTimeout(async () => {
    try {
      // Retrieve the events flushed by the previous page's beforeunload
      const stored = await chrome.storage.session.get([
        'pendingEvents', 'pendingRRwebEvents', 'pendingStartTime'
      ]);

      const resumeState = {
        events:      stored.pendingEvents      || [],
        rrwebEvents: stored.pendingRRwebEvents || [],
        startTime:   stored.pendingStartTime   || Date.now()
      };

      await injectAndStart(tabId, resumeState);
    } catch (e) {
      console.warn('[BugReplay] Re-inject after navigation failed:', e.message);
    }
  }, 300);
});

// ── TAB CLOSED DURING RECORDING ────────────────────────────────────────────
chrome.tabs.onRemoved.addListener((tabId) => {
  getRecordingTabId().then(async (recTabId) => {
    if (tabId !== recTabId) return;
    await setRecordingTabId(null);
    chrome.storage.local.set({ recordingState: 'idle' });
  });
});

// ── DOWNLOAD HELPER ────────────────────────────────────────────────────────
function downloadPayload(payload) {
  try {
    const json  = JSON.stringify(payload);
    const bytes = new TextEncoder().encode(json);
    const CHUNK = 8192;
    let binary  = '';
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
    }, () => {
      if (chrome.runtime.lastError) {
        console.error('[BugReplay] Download error:', chrome.runtime.lastError.message);
      }
    });
  } catch (e) {
    console.error('[BugReplay] Encode error:', e);
  }
}
