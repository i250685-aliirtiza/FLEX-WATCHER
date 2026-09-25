# FLEX Marks Watcher — Auth Verification Build

This build polls the FLEX marks page and explicitly verifies on every poll that the supplied session still reaches the authenticated `StudentMarks` route.

It does **not** log in for you, solve Cloudflare challenges, or bypass FLEX authentication. It only uses a session/cookie you already obtained legitimately in your browser.

## What counts as `AUTH VERIFIED`

A poll prints `AUTH VERIFIED` only after all of these pass:

1. FLEX returned HTTP 2xx.
2. The final URL is exactly on `https://flexstudent.nu.edu.pk/Student/StudentMarks` (a redirect to login fails).
3. The response is HTML.
4. No login form is present.
5. No Cloudflare/human-verification page is present.
6. The existing strict marks parser successfully validates the semester/course/assessment DOM.
7. The parsed semester matches the semester requested by the watcher.

So a generic HTTP 200 page is **not** enough to produce `AUTH VERIFIED`.

## Windows — easiest way to run

Requirements: Node.js 20.19+ (or newer) and npm.

Open PowerShell in this project folder and run once:

```powershell
npm ci
npm test
```

Then start a 60-second watcher:

```powershell
powershell -ExecutionPolicy Bypass -File .\watch.ps1 -Seconds 60
```

The script asks for your cookie with hidden input. Paste either:

- only the value of `ASP.NET_SessionId`, or
- the complete browser `Cookie` header if FLEX needs more than one cookie.

The script does not write the cookie to a project file. Press `Ctrl+C` to stop.

Example healthy output:

```text
[9/25/2026, 8:10:00 PM] AUTH VERIFIED | protected marks route | session=1a2b3c4d | semester=20263 | HTTP 200 | courses=9 | assessments=14 | released=14 | snapshot=...
[9/25/2026, 8:10:00 PM] WATCHED | session still authenticated | no mark changes.
```

Example expired session:

```text
AUTH/WATCH FAILED LOGIN_REQUIRED: FLEX session is no longer authenticated; request landed on the login page.
Last valid snapshot was NOT overwritten.
```

`session=1a2b3c4d` is only the first 8 characters of a SHA-256 fingerprint of the cookie. The cookie itself is never printed.

## Manual environment-variable method

If you prefer not to use `watch.ps1`:

```powershell
$env:FLEX_SESSION_ID="PASTE_RAW_SESSION_ID_VALUE"
$env:FLEX_SEMESTER_ID="20263"
$env:FLEX_POLL_MS="60000"
npm start
```

For a full cookie header use `FLEX_COOKIE` instead:

```powershell
$env:FLEX_COOKIE="ASP.NET_SessionId=...; other_cookie=..."
npm start
```

`FLEX_COOKIE` takes precedence over `FLEX_SESSION_ID`.

## One-shot check

```powershell
$env:FLEX_RUN_ONCE="1"
npm start
Remove-Item Env:FLEX_RUN_ONCE
```

## Snapshot behavior

The first successful authenticated fetch becomes `data/marks-snapshot.json`.

Later successful polls compare marks against that snapshot. Failed authentication, Cloudflare pages, parser failures, semester mismatches, and suspicious course-count or assessment-count drops do **not** overwrite the last valid snapshot.

## Tests

```powershell
npm test
```

The suite contains the original parser tests plus authentication-response tests for login redirects, 200-with-login-form responses, wrong routes/origins, non-HTML responses, and Cloudflare challenge pages.

## Important limitation

This watcher proves that **each poll successfully accessed the authenticated protected marks page with the cookie you supplied**. It cannot prove that a browser tab itself remains logged in, because this program is making its own HTTP requests rather than controlling your browser. For our cloud notifier, this per-request authentication proof is the condition that matters.
