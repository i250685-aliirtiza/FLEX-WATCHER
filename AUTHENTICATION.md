# Automatic authentication: implementation boundary

Live automatic login is NOT implemented or verified yet. Cookie mode remains the supported working mode. No enrollment actions are performed.

## Evidence from public FLEX pages, 26 September 2026

GET https://flexstudent.nu.edu.pk/ redirects to /Login. Its login form declares POST /Login/login with username, password and remember fields. No __VIEWSTATE, __EVENTVALIDATION or named CSRF input was observed in the static response. This does not prove tokens are absent from the browser request.

The page loads Cloudflare Turnstile. Its public /Assets/snippets/pages/user/login.js intercepts submit and uses ajaxSubmit with relative URL login/Login. It expects JSON status done/fail and navigates to the returned url on success. A 200 response alone is not authentication proof.

The observed visible ASP.NET session identifier is not proof of a valid server-side login. Cookie rotation, additional cookies, and Turnstile request requirements need browser evidence.

## Capture needed (redacted, not a raw HAR)

1. Open DevTools Network, enable Preserve log, then perform one normal successful FLEX login.
2. Select the login POST: provide exact Request URL, method, Content-Type, Origin/Referer paths, and all Form Data field NAMES. Replace username/password and every token value with REDACTED. Note whether cf-turnstile-response or another challenge field is present.
3. Provide the JSON response shape/status and destination path, redacting personal information and token-bearing query values.
4. For GET login, POST login and each subsequent redirect, provide status, Location path, and Set-Cookie NAMES and attributes (Domain, Path, Secure, HttpOnly, SameSite, expiry). Never provide cookie values.
5. For the first successful StudentMarks request provide cookie NAMES and final URL path/status. Note whether a visible human challenge, OTP, or additional step occurred.
6. Provide hidden input NAMES from the rendered login form, including verification/ASP.NET fields if present. No live token values are needed.

Do not export an unredacted HAR or copy a credential-bearing curl command. Do not share your FLEX password in chat.

## Implemented recovery scaffold

FLEX_AUTO_LOGIN=1 opts into the controller. On LOGIN_REQUIRED it calls loginToFlex, verifies the replacement through the existing protected marks parser, and only then updates the active cookie and continues normal snapshot comparison. Network/parser/server failures do not invoke login. The controller allows three attempts with 60/120-second backoff, then requires manual intervention; the existing alert latch suppresses repeated expiry emails.

The live login adapter deliberately returns MANUAL_INTERVENTION until the request contract and Turnstile requirements are verified. Leave FLEX_AUTO_LOGIN unset for ordinary operation. There are no active FLEX_USERNAME/FLEX_PASSWORD settings yet: accepting credentials without a working verified adapter would be misleading. Future credentials will be environment-only; existing .env ignore rules apply. The app does not automatically load .env files.

Run `node --test --test-isolation=none tests/recovery.test.js` for safe mock verification: replacement-session proof, network classification, bounded retries/backoff and blocked adapter behavior. These tests send no email, alter no snapshot and contact no FLEX service. Initial live login, cookie collection and expiry/re-login remain blocked pending the capture above; Turnstile may require an interactive browser flow.
