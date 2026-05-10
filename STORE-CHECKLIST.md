# BugReplay Recorder — Chrome Web Store Listing Copy
# All fields required by the Developer Dashboard submission form
# https://chrome.google.com/webstore/devconsole

---

## EXTENSION NAME
BugReplay Recorder

---

## SHORT DESCRIPTION
(132 characters max — used in search results and category listings)

Record bugs as portable .replay files. Share via GitHub issues or Slack. No cloud, no account, no SaaS dashboard.

Character count: 115 ✓

---

## DETAILED DESCRIPTION
(Up to 16,000 characters — supports plain text only, no markdown or HTML)

BugReplay Recorder is a developer tool that captures exactly what happened before a bug — and packages it into a single portable file your teammate can replay in their browser.

No dashboards. No logins. No monthly fee. Just a file.

─────────────────────────────────────
HOW IT WORKS
─────────────────────────────────────

① Press Start Recording in the extension popup
② Reproduce the bug on any webpage
③ Press Stop & Export
④ A .replay file downloads to your computer
⑤ Attach it to a GitHub issue, Slack message, or email
⑥ Your teammate opens BugReplay's built-in Replayer and watches exactly what you did

That's it. The file is self-contained. No upload step. No shared account. No expiry.

─────────────────────────────────────
WHAT GETS CAPTURED
─────────────────────────────────────

Every recording captures a precise, timestamped log of:

• Mouse clicks — element selector and screen coordinates
• Keyboard input — typed values and navigation keys (Enter, Escape, Tab, arrow keys)
• DOM mutations — every node added, removed, or modified on the page
• Network requests — HTTP method, URL, and status code for all XHR and fetch calls
• Console output — console.log, console.warn, and console.error messages
• JavaScript errors — uncaught exceptions and unhandled promise rejections
• Scroll position — where the user was on the page
• Page snapshot — the baseline DOM at the moment recording started

─────────────────────────────────────
BUILT FOR DEVELOPER WORKFLOWS
─────────────────────────────────────

The .replay format is plain JSON. You can:

• Attach it directly to a GitHub issue (files up to 25MB are supported)
• Drop it in a Slack message or Linear ticket
• Commit it to a repository alongside a failing test
• Open it with any text editor to inspect the raw event log

The built-in Replayer is a standalone HTML page that opens in a new tab. Your teammates don't need the extension installed to replay a session — they just need the file and a browser.

─────────────────────────────────────
PRIVACY FIRST — BY DESIGN
─────────────────────────────────────

Most session recorders are SaaS dashboards that store your users' activity on their servers. BugReplay is different: it is peer-to-peer.

• Zero network requests — the extension never contacts any server
• All data stays on your device until you explicitly share the file
• Passwords and sensitive fields are automatically redacted before recording
  (fields matching: password, token, secret, auth, card, cvv, ssn, pin)
• No analytics, no telemetry, no account required
• Open source — inspect every line at github.com/bugreplay/bugreplay-extension

─────────────────────────────────────
PERMISSIONS EXPLAINED
─────────────────────────────────────

BugReplay requests the minimum permissions needed:

activeTab — to access the tab you're currently recording
scripting — to inject the recorder into the page when you press Start
storage — to remember recording state if you close the popup mid-session
downloads — to save the .replay file to your Downloads folder
<all_urls> — so you can record on any site you choose; the extension is dormant until you press Start

─────────────────────────────────────
TYPICAL USE CASES
─────────────────────────────────────

→ A QA engineer reproduces a checkout bug and attaches the replay to a Jira ticket instead of writing a 12-step reproduction guide

→ A developer on a remote team records a UI glitch in staging and drops the file in Slack so a colleague in a different timezone can replay it without a screen share call

→ A technical founder demonstrates a bug to a contractor without granting access to their production environment

→ A solo developer captures a flaky error that only happens in the browser (not in unit tests) and replays it frame-by-frame to find the failing network call

─────────────────────────────────────
SUPPORT
─────────────────────────────────────

GitHub Issues: github.com/bugreplay/bugreplay-extension/issues
Email: support@bugreplay.dev
Privacy Policy: bugreplay.dev/privacy

---

## CATEGORY
Developer Tools

---

## LANGUAGE
English (en)

---

## STORE LISTING SCREENSHOTS
(Required: at least 1. Recommended size: 1280×800px or 640×400px)

Screenshot 1 — "The popup: idle state"
  Show: Extension popup open on a real website (e.g. a checkout page), IDLE state, with page title and URL visible

Screenshot 2 — "Recording in progress"
  Show: Popup in REC state with event count and live timer visible

Screenshot 3 — "The Replayer: event stream"
  Show: Replayer tab open with a loaded .replay file, events scrolling, timeline fill at ~60%

Screenshot 4 — "GitHub issue attachment"
  Show: A GitHub issue with a .replay file attached and a comment like "Attached the replay — open in BugReplay Replayer"

---

## PROMOTIONAL IMAGES

Small promo tile: 440×280px
  Design: Dark background (#0a0a0b), BugReplay logo top-left, large tagline "Bug reproduction as a file." centred, small subtext "No cloud. No account. No SaaS." at bottom

Marquee promo tile: 1400×560px (optional but recommended)
  Design: Split — left half shows the popup in REC state, right half shows the Replayer with an event stream. Tagline overlaid: "Record once. Share anywhere."

---

## JUSTIFICATION FOR <all_urls> HOST PERMISSION
(Required field in the submission form when requesting broad host permissions)

BugReplay Recorder is a developer debugging tool that must be capable of recording sessions on any website the developer is testing — including localhost, staging environments, and production. The host permission is necessary because developers cannot know in advance which domain they will need to record. The extension's content script is injected only on explicit user action (pressing "Start Recording") and is immediately removed when recording stops. No data is collected passively. Full permission justification and privacy practices are documented at bugreplay.dev/privacy.

---

## SINGLE PURPOSE DESCRIPTION
(Chrome Web Store policy requires a clear single-purpose statement)

The single purpose of BugReplay Recorder is to capture browser session activity (clicks, inputs, network calls, and DOM changes) into a portable file that can be shared for bug reproduction. The extension performs no other function.

---

## PRIVACY POLICY URL
https://bugreplay.dev/privacy

(Host the privacy-policy.html file at this URL before submission.
GitHub Pages is free and works well: enable Pages on your repo and the
file will be available at https://<username>.github.io/<repo>/privacy)

---

## VERSION NOTES
(Shown to existing users on update; not visible in initial listing)

v1.0.0 — Initial release. Records clicks, inputs, DOM mutations, network calls, console output, and JS errors into a portable .replay file. Includes built-in Replayer with timeline scrubbing and speed controls.