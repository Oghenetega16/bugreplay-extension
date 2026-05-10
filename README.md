# BugReplay Recorder — Chrome Extension

Record DOM mutations, clicks, network calls, and console output into a portable `.replay` file.
No cloud. No account. No SaaS dashboard. Just a file you can drop in a GitHub issue or Slack message.

---

## Installing (Developer Mode)

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode** (toggle, top-right)
3. Click **Load unpacked**
4. Select the `bugreplay-extension/` folder
5. The BugReplay icon appears in your toolbar

---

## Usage

### Recording a bug

1. Navigate to the page where the bug occurs
2. Click the **BugReplay** extension icon
3. Press **START RECORDING**
4. Reproduce the bug — interact with the page normally
5. Click the icon again → **STOP & EXPORT**
6. A `.replay` file downloads automatically

### Sharing

Drop the `.replay` file into:
- A GitHub issue as an attachment
- A Slack message
- A Linear ticket
- An email

### Replaying

1. Click the extension icon → **Open Replayer** (bottom-left)
2. Drop the `.replay` file onto the page
3. Press **PLAY**

The replayer shows a live event feed with timeline scrubbing and 0.5×–4× speed control.

---

## What gets captured

| Event type | Details |
|---|---|
| `click` | Element selector + x/y coordinates |
| `input` / `change` | Element, value (passwords auto-redacted) |
| `key` | Special keys: Enter, Escape, Tab, arrows |
| `scroll` | Scroll position |
| `dom` | MutationObserver — added/removed nodes, attribute changes |
| `net` | XHR + fetch — method, URL, status code, duration |
| `log` | console.log / console.warn |
| `err` | console.error + uncaught JS errors + unhandled promise rejections |

---

## File format

`.replay` files are plain JSON:

```json
{
  "version": "1.0",
  "schema": "bugreplay",
  "meta": {
    "recordedAt": "2025-05-06T10:23:41.000Z",
    "duration": 14320,
    "eventCount": 47,
    "url": "https://app.example.com/checkout",
    "title": "Checkout — Example App",
    "userAgent": "Mozilla/5.0..."
  },
  "snapshot": {
    "title": "...",
    "url": "...",
    "bodyHTML": "..."
  },
  "events": [
    { "t": 412, "type": "click", "x": 320, "y": 540, "target": "button#submit", "desc": "click on button#submit" },
    { "t": 830, "type": "net",   "method": "POST", "url": "/api/checkout", "status": 400, "desc": "POST /api/checkout → 400" },
    ...
  ]
}
```

---

## Privacy / scrubbing

- Password fields and inputs matching `password|token|secret|auth|card|cvv|ssn|pin` are replaced with `[REDACTED]`
- No data ever leaves the user's machine — everything is local

---

## File structure

```
bugreplay-extension/
├── manifest.json       ← Chrome extension manifest v3
├── background.js       ← Service worker (coordinates popup ↔ content script)
├── content.js          ← Injected into page, captures all events
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── popup/
│   ├── popup.html      ← Extension popup UI
│   ├── popup.css
│   └── popup.js
└── replay/
    └── replayer.html   ← Standalone replayer (opens as new tab)
```

---

## Roadmap

- [ ] rrweb DOM snapshot for full visual replay
- [ ] Binary/MessagePack encoding for large sessions
- [ ] Scrubber click-to-seek
- [ ] Network response body capture (opt-in)
- [ ] Firefox support (WebExtensions API compatible)
