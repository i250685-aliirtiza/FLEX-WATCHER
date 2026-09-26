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

## Current supported architecture

The watcher does not attempt login or re-authentication. It starts from a valid cookie, persists all FLEX Set-Cookie updates in a cookie jar, and uses authenticated `/Student/Marks` as a periodic keep-alive. Playwright/Chromium auto-login was tested and abandoned because Turnstile blocked it. No CAPTCHA or Turnstile bypass is used.

The session-preservation experiment succeeds only if the same process remains authenticated well beyond the previous approximately 4h12m expiry. Use `FLEX_LONG_RUN=1` for a bounded 6–8 hour run; failures preserve the last valid marks snapshot.