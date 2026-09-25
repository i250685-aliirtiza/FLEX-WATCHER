# FLEX Marks Notifier Roadmap

This file is the permanent source of truth for future Codex sessions. It reflects the repository as inspected on 2026-09-25, branch `main`.

## Current implementation assessment

### Implemented and verified by repository evidence

- [x] Node package metadata and scripts exist in `package.json`, including `start`, `test`, and focused test commands.
- [x] FLEX cookie input accepts either a raw `ASP.NET_SessionId` value or a complete Cookie header.
- [x] Each poll requests the protected `Student/StudentMarks` route and follows redirects.
- [x] Authentication proof checks HTTP status, final HTTPS FLEX origin/path, HTML content type, login-form signals, and Cloudflare/human-verification signals.
- [x] The marks parser is pure and structural: it validates semester metadata, course tabs/panes, assessment identity, numeric values, and rejects ambiguous or incomplete markup.
- [x] Parser output is normalized and includes stable assessment IDs, which supports comparison across polls.
- [x] The first successful authenticated poll creates a baseline without sending a marks notification.
- [x] Later polls compare released marks and changed obtained values and avoid notifications for unchanged values.
- [x] Class statistics that are not part of normalized assessment state are excluded from the comparison.
- [x] A saved JSON snapshot is loaded on restart and is preserved when authentication, parsing, integrity checks, network access, or notification delivery fails.
- [x] Course-count and assessment-count drops are rejected before replacing the saved snapshot.
- [x] Optional SMTP email configuration validates required fields, recipients, headers, host, and port; Gmail App Password guidance is documented.
- [x] Mark-change, email-test, and session-expiry message builders exist.
- [x] Session-expiry email alerts are latched to avoid repeated alerts during one outage and reset after a successful poll.
- [x] Terminal logs cover authenticated checks, baseline creation, no-change checks, detected changes, notification status, and poll failures.
- [x] PowerShell launchers collect cookie/password input as hidden values and remove their environment variables on exit.
- [x] A fixture-backed parser test suite, authentication tests, email configuration/message tests, and session-alert tests are present.

### Implemented but not verified in this inspection

- [x] End-to-end live FLEX authentication and polling with a real valid session cookie. Verified 2026-09-25 with a one-shot poll using a process-only cookie and temporary snapshot: `AUTH VERIFIED`, HTTP 200, semester `20263`, 9 courses, 20 assessments, 19 released marks, and baseline saved.
- [x] Real SMTP delivery through the documented email-test path. Verified 2026-09-25 with Gmail SMTP over TLS using process-only configuration: `EMAIL TEST PASS`, host `smtp.gmail.com:465`, 1 recipient; no secrets persisted.
- [x] Restart and mark-change behavior verified deterministically with the production `diffMarks` logic: unchanged, new assessment, released mark, obtained/total change, exact-once detection, notification content, and repeat-poll suppression all pass in `tests/marks.test.js`. Live restart/no-change polling also passed.
- [x] PowerShell launcher behavior verified from the user-provided Windows run: `watch.ps1 -Email` accepted hidden cookie/password input, launched the watcher, completed repeated authenticated polls, and produced clean no-change logs.

### Partial, risky, or missing behavior

- [x] Make the test suite runnable in the supported environment. Updated the test script to use `node --test --test-isolation=none`; `npm test` now passes all 50 tests.
- [x] Add deterministic mark-change integration coverage. `tests/marks.test.js` exercises the production comparison logic and notification builder for no-change, new, released, obtained/total changes, exact-once detection, and repeat-poll suppression.
- [x] Verify and harden atomic snapshot persistence. `src/notifier.js` now writes a uniquely named temporary JSON file and renames it into place; syntax and a live one-shot baseline write passed with no temporary residue.
- [x] Define graceful shutdown behavior. Added SIGINT/SIGTERM handling, documented Ctrl+C behavior, and verified syntax plus a live one-shot after the change.
- [x] Resolve session refresh expectations. Documented restart-only cookie refresh in `README.md`; the process intentionally uses one cookie for its lifetime.
- [x] Add configuration and state hygiene for deployment. Added and verified root `.gitignore` coverage for `data/`, `.env`, `node_modules/`, and `*.log`; runtime snapshots and local secrets are ignored.
- [x] Review snapshot schema/version validation and migration behavior. Added `validateSnapshot` and tests for malformed, unsupported, and invalid nested state; invalid persisted state fails before comparison and preserves the safe snapshot.
- [x] Review duplicate and identity edge cases. Existing parser identity tests plus deterministic mark tests cover category/assessment identity, removal without false alerts, reappearance, and obtained/total changes.
- [x] Review network timeout and retry behavior. Added configurable `FLEX_REQUEST_TIMEOUT_MS` (default 30 seconds, minimum 1 second), wired through `AbortController`, and documented it.
- [x] Verify dependency and runtime reproducibility. `npm ci` completed with 0 vulnerabilities; Node `v24.18.0`, npm `11.16.0`, and all 58 tests pass.
- [x] Update `README.md` after behavior changes; timeout, shutdown, and restart-only session refresh are documented.
- [x] Perform the final security and release review. Tracked-file scan found no credentials or cookies; secrets are entered at runtime, runtime artifacts are ignored, logs use cookie fingerprints only, `git diff --check` passes, and reproducible install/tests are documented.

## Ordered milestones

### Milestone 1 — Establish reproducible verification

- [x] Resolve or document the `spawn EPERM` test-runner blocker by using single-process test isolation.
- [x] Run the complete automated suite successfully: `npm test` passes 50 tests.
- [ ] Run focused static/configuration checks for scripts, package lock, and runtime version.

### Milestone 2 — Test critical watcher behavior

- [x] Add deterministic coverage for unchanged polls, new/released/changed marks, duplicate suppression, and notification content.
- [x] Add failure-preservation coverage for authentication redirects/login pages, Cloudflare pages, non-HTML responses, malformed persisted state, and session-alert delivery retry. Network/fetch orchestration remains a future integration-test extension.
- [x] Add snapshot schema/state tests.

### Milestone 3 — Operational correctness

- [ ] Choose and implement/document session-cookie refresh semantics.
- [ ] Add request timeout and bounded retry behavior suitable for polling.
- [ ] Add clean SIGINT/SIGTERM shutdown handling.
- [ ] Make snapshot writes crash-safe and verify the behavior.
- [x] Add `.gitignore` and confirm runtime secrets/state are excluded.

### Milestone 4 — Real environment verification

- [ ] Verify a live authenticated FLEX one-shot poll with a legitimate cookie.
- [ ] Verify a real SMTP test email without exposing credentials.
- [ ] Verify restart persistence and one genuine change/retry cycle.
- [ ] Verify the PowerShell launchers and environment cleanup.

### Milestone 5 — Documentation and release readiness

- [ ] Synchronize `README.md` with the final behavior and verification procedures.
- [ ] Perform the final security/reproducibility review.
- [x] Confirm release files are tracked and the project is ready for commit and push.

## Permanent Codex rules

1. Every Codex session must read `roadmap.md` before modifying the project.
2. Unless the user explicitly requests something else, work on the FIRST unchecked task.
3. Complete one logical roadmap task at a time.
4. Never mark `[x]` just because code was written; verify/test it first.
5. If partially complete, keep `[ ]` and record progress.
6. If blocked, record the blocker and leave it unchecked.
7. Add newly discovered required work to the appropriate roadmap position.
8. Never delete completed tasks simply to shorten the roadmap.
9. Keep `roadmap.md` synchronized with the actual repository.
10. Do not claim tests or verification that were not actually performed.
11. Avoid unrelated refactors.
12. Preserve existing working behavior.
13. Update documentation when behavior/setup changes.
14. Update `roadmap.md` before ending every development session.
15. At the end of a task, report:
    - what changed
    - what was verified
    - files changed
    - whether the task was checked off
    - the next unchecked task
16. Do not automatically execute the next roadmap task in the same session unless explicitly asked.

## This inspection session

- [x] Inspected repository files, source, configuration, tests, fixture, README, Git status, and current branch.
- [x] Created this root-level roadmap from repository evidence.
- [x] Recorded the automated-test verification blocker without claiming tests passed.
- [x] Completed the live FLEX verification task using the user-supplied session cookie without persisting credentials or repository state.\n- [ ] No implementation task was executed in this session.



















