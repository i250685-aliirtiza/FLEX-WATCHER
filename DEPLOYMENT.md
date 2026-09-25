# Single-user deployment

This deployment keeps one FLEX session and one marks snapshot on one Windows machine. Multi-user hosting is intentionally out of scope.

## Install

Use Node.js 20.19 or newer, then from the project directory run:

```powershell
npm ci
npm test
```

## Start the watcher

Run this in a PowerShell window that stays open:

```powershell
powershell -ExecutionPolicy Bypass -File .\watch.ps1 `
  -Seconds 60 `
  -Email `
  -SmtpUser "you@gmail.com" `
  -EmailTo "you@gmail.com"
```

The script requests the FLEX cookie and Gmail App Password with hidden input. They are held only in the process environment and removed when the script exits.

## Healthy operation

Each poll should show `AUTH VERIFIED`, followed by either `WATCHED | ... no mark changes.` or a detected mark and `EMAIL SENT`. The saved baseline is `data/marks-snapshot.json`; it is ignored by Git and survives normal restarts.

## Session expiry

If FLEX expires the cookie, the watcher preserves the last safe snapshot and sends one session-expiry alert when email is enabled. Stop the process with Ctrl+C and restart it with a newly copied cookie. The watcher intentionally does not change cookies while running.

## Recovery

If the process stops, restart the same command. If the snapshot is malformed or incompatible, the watcher fails closed instead of overwriting it. Keep a copy before manual investigation. Do not commit cookies, passwords, or snapshot files.

## Polling controls

`-Seconds` controls the polling interval. The Node process also accepts `FLEX_REQUEST_TIMEOUT_MS` for request timeout (default 30 seconds, minimum 1 second).

## Stop

Press Ctrl+C. The watcher stops future polls and exits after the current operation without replacing the last safe snapshot.
