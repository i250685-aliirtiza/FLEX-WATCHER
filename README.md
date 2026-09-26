# FLEX Marks Watcher

For a practical single-user Windows runbook, see [DEPLOYMENT.md](./DEPLOYMENT.md).

Polls the authenticated FAST FLEX marks page, validates the session on every poll, compares normalized marks against the last valid snapshot, and can email you when a mark is released or changed.

It does **not** log in for you, solve Cloudflare challenges, or bypass FLEX authentication. It uses a session/cookie you already obtained legitimately in your browser.

## What `AUTH VERIFIED` means

A poll prints `AUTH VERIFIED` only after all of these pass:

1. FLEX returned HTTP 2xx.
2. The final URL is `https://flexstudent.nu.edu.pk/Student/StudentMarks`.
3. The response is HTML.
4. No login form is present.
5. No Cloudflare/human-verification page is present.
6. The strict marks parser validates the semester/course/assessment DOM.
7. The parsed semester matches the requested semester.

A generic HTTP 200 page is therefore **not** enough.

## Install and test

Requirements: Node.js 20.19+ and npm.

```powershell
npm ci
npm test
```

## Run without email

```powershell
powershell -ExecutionPolicy Bypass -File .\watch.ps1 -Seconds 60
```

The script asks for your FLEX cookie with hidden input. Paste either the raw `ASP.NET_SessionId` value or a complete browser `Cookie` header.

Healthy output looks like:

```text
[9/25/2026, 8:10:00 PM] AUTH VERIFIED | protected marks route | session=1a2b3c4d | semester=20263 | HTTP 200 | courses=9 | assessments=20 | released=19 | snapshot=...
[9/25/2026, 8:10:00 PM] WATCHED | session still authenticated | no mark changes.
```

`session=1a2b3c4d` is only the first 8 characters of a SHA-256 fingerprint of the cookie. The cookie itself is never printed.

## Email notifications

Email is optional. The watcher uses implicit-TLS SMTP and defaults to Gmail's `smtp.gmail.com:465`.

For Gmail, use a **Google App Password**, not your normal Google password. The App Password is prompted with hidden input and is not written to the repository or snapshot.

First test email delivery without touching FLEX or the saved marks snapshot:

```powershell
powershell -ExecutionPolicy Bypass -File .\email-test.ps1 -SmtpUser "you@gmail.com" -EmailTo "you@gmail.com"
```

If delivery succeeds, you should see:

```text
EMAIL TEST PASS | host=smtp.gmail.com:465 | recipients=1
```

Then run the watcher with email enabled:

```powershell
powershell -ExecutionPolicy Bypass -File .\watch.ps1 -Seconds 60 -Email -SmtpUser "you@gmail.com" -EmailTo "you@gmail.com"
```

When FLEX changes a student mark, the watcher prints the change and sends one email containing all changes detected in that poll.

Examples:

```text
[NEW MARK] CS2001 | Quiz 2: 8/10
[MARK CHANGED] MT1004 | Assignment 1: 7 -> 9/10
```

If email delivery fails after a mark change, the watcher **does not advance the saved snapshot**. The same change is retried on the next poll instead of being silently lost.

Class average, minimum, maximum, and standard-deviation-only changes are ignored by the normalized snapshot.

## Email environment variables

The PowerShell scripts are convenient for local use. A cloud deployment can set these environment variables directly:

```text
FLEX_SMTP_USER=you@gmail.com
FLEX_SMTP_PASS=your-app-password
FLEX_EMAIL_TO=you@gmail.com
FLEX_EMAIL_FROM=you@gmail.com      # optional; defaults to SMTP user
FLEX_SMTP_HOST=smtp.gmail.com      # optional
FLEX_SMTP_PORT=465                 # optional
```

Email settings are considered enabled when any email setting is present. `FLEX_SMTP_USER`, `FLEX_SMTP_PASS`, and `FLEX_EMAIL_TO` must then all be present.

## Manual FLEX environment variables

```powershell
$env:FLEX_SESSION_ID="PASTE_RAW_SESSION_ID_VALUE"
$env:FLEX_SEMESTER_ID="20263"
$env:FLEX_POLL_MS="60000"
npm start
```

Requests time out after 30 seconds by default. Set `FLEX_REQUEST_TIMEOUT_MS` to change this (minimum 1000 ms).
Press Ctrl+C to stop the watcher; it finishes the current poll and exits without replacing the last safe snapshot.

For a full cookie header use `FLEX_COOKIE` instead. `FLEX_COOKIE` takes precedence over `FLEX_SESSION_ID`.

## One-shot FLEX check

```powershell
$env:FLEX_RUN_ONCE="1"
npm start
Remove-Item Env:FLEX_RUN_ONCE
```

## Snapshot behavior

The first successful authenticated fetch becomes `data/marks-snapshot.json`.

Later successful polls compare marks against that snapshot. Failed authentication, Cloudflare pages, parser failures, semester mismatches, suspicious course-count/assessment-count drops, and failed mark-notification emails do **not** overwrite the last safe baseline.

## Tests

```powershell
npm test
npm run test:auth
npm run test:email
npm run test:session
```

The test suite covers the marks parser, authentication response verification, email configuration/message generation, and session-expiry alerting/latching. The live email test is intentionally separate because it requires your SMTP credentials.

## Session expiry alerts

When FLEX invalidates your session or redirects requests to the login page:
- The watcher fails closed and preserves the last valid marks snapshot.
- If email is configured, the watcher immediately sends an alert email informing you that the session has expired and a fresh cookie is needed.
- To prevent spam, the alert is sent only once per outage.
- When an updated, valid session cookie is provided and the watcher successfully retrieves marks again (`AUTH VERIFIED`), the alert latch is automatically reset.

## Current limitation

This watcher proves that **each poll successfully accessed the authenticated protected marks page with the cookie supplied to the process**. It does not control a browser tab. For a future cloud deployment, per-request authentication proof is the condition that matters.

The initial cookie is read once, then all FLEX Set-Cookie updates are retained in memory. If FLEX still expires the authenticated session, the watcher preserves the last valid snapshot and reports the failure.

## Session preservation experiment

The watcher starts with a valid `ASP.NET_SessionId` (or complete Cookie header), keeps a persistent FLEX cookie jar, accepts every `Set-Cookie` update, and sends an authenticated `/Student/Marks` heartbeat every 10–15 minutes. Playwright/Chromium auto-login was tested and abandoned because Turnstile blocked it. No CAPTCHA or Turnstile bypass is used, and the watcher never logs in or re-authenticates.

For an 8-hour bounded test:

```powershell
$env:FLEX_COOKIE = "ASP.NET_SessionId=<your-valid-session-id>"
$env:FLEX_LONG_RUN = "1"
$env:FLEX_LONG_RUN_HOURS = "8"
$env:FLEX_HEARTBEAT_MS = "720000"
npm start
```