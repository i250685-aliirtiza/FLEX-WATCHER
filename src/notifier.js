import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parseMarksHtml } from './flex/parser.js';
import { normalizeCookieInput, verifyAuthenticatedMarksResponse } from './flex/auth.js';
import { buildMarksEmail, buildSessionExpiredEmail, buildTestEmail, loadEmailConfig, sendEmail } from './email.js';
import { SessionAlertTracker } from './session-alert.js';
import { diffMarks } from './marks.js';
import { validateSnapshot } from './snapshot.js';
import { FlexSession } from './flex/session.js';
import { decidePoll } from './poll-decision.js';
import { retryDelay, classifyFailure } from './retry.js';

const COOKIE_INPUT = process.env.FLEX_COOKIE || process.env.FLEX_SESSION_ID;
const SEMESTER_ID = process.env.FLEX_SEMESTER_ID || '20263';
const POLL_MS = Number(process.env.FLEX_POLL_MS || 300000);
const REQUEST_TIMEOUT_MS = Number(process.env.FLEX_REQUEST_TIMEOUT_MS || 30000);
const SNAPSHOT_FILE = process.env.FLEX_SNAPSHOT_FILE || './data/marks-snapshot.json';
const RUN_ONCE = process.env.FLEX_RUN_ONCE === '1';
const SELF_TEST = process.env.FLEX_SELF_TEST === '1';
const EMAIL_TEST = process.env.FLEX_EMAIL_TEST === '1';
const RETRY_BASE_MS = Number(process.env.FLEX_RETRY_BASE_MS || POLL_MS);
const RETRY_MAX_MS = Number(process.env.FLEX_RETRY_MAX_MS || Math.max(POLL_MS, 1800000));
const LONG_RUN = process.env.FLEX_LONG_RUN === '1';
const LONG_RUN_MS = Number(process.env.FLEX_LONG_RUN_HOURS || 8) * 60 * 60 * 1000;

let EMAIL_CONFIG = null;
try {
  EMAIL_CONFIG = loadEmailConfig();
} catch (error) {
  console.error(`EMAIL CONFIG ERROR: ${error.message}`);
  process.exit(1);
}

const SESSION_ALERT_TRACKER = new SessionAlertTracker({
  sendAlert: EMAIL_CONFIG
    ? async () => {
        const message = buildSessionExpiredEmail();

        await sendEmail(EMAIL_CONFIG, message);
      }
    : null,
  log: msg => console.log(`[${stamp()}] ${msg}`),
  logError: msg => console.error(`[${stamp()}] ${msg}`),
});

let SESSION = null;
if (!SELF_TEST && !EMAIL_TEST) {
  try {
    SESSION = new FlexSession(normalizeCookieInput(COOKIE_INPUT));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

if (!Number.isFinite(POLL_MS) || POLL_MS < 10000) {
  console.error('FLEX_POLL_MS must be a number >= 10000.');
  process.exit(1);
}

for (const [name, value] of Object.entries({ FLEX_POLL_MS: POLL_MS, FLEX_REQUEST_TIMEOUT_MS: REQUEST_TIMEOUT_MS, FLEX_RETRY_BASE_MS: RETRY_BASE_MS, FLEX_RETRY_MAX_MS: RETRY_MAX_MS })) {
  if (!Number.isSafeInteger(value) || value < (name === 'FLEX_REQUEST_TIMEOUT_MS' ? 1000 : 10000) || value > 2147483647) {
    console.error(`${name} must be an integer within the supported timer range.`);
    process.exit(1);
  }
}
if (RETRY_MAX_MS < RETRY_BASE_MS) {
  console.error('FLEX_RETRY_MAX_MS must be >= FLEX_RETRY_BASE_MS.');
  process.exit(1);
}

async function loadSnapshot() {
  try {
    return validateSnapshot(JSON.parse(await readFile(SNAPSHOT_FILE, 'utf8')));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function saveSnapshot(snapshot) {
  await mkdir(dirname(SNAPSHOT_FILE), { recursive: true });
  const temporary = `${SNAPSHOT_FILE}.tmp-${process.pid}-${Date.now()}`;
  try {
    await writeFile(temporary, JSON.stringify(snapshot, null, 2), { encoding: 'utf8', mode: 0o600 });
    await rename(temporary, SNAPSHOT_FILE);
  } finally {
    try { await unlink(temporary); } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
}
if (!Number.isFinite(REQUEST_TIMEOUT_MS) || REQUEST_TIMEOUT_MS < 1000) {
  console.error('FLEX_REQUEST_TIMEOUT_MS must be a number >= 1000.');
  process.exit(1);
}

function stamp() {
  return new Date().toLocaleString();
}

function snapshotStats(snapshot) {
  const courses = snapshot.semester.courses.length;
  let categories = 0;
  let assessments = 0;
  let released = 0;
  for (const course of snapshot.semester.courses) {
    categories += course.categories.length;
    for (const category of course.categories) {
      assessments += category.assessments.length;
      released += category.assessments.filter(a => a.obtained !== null).length;
    }
  }
  const canonical = JSON.stringify(snapshot);
  const hash = createHash('sha256').update(canonical).digest('hex').slice(0, 12);
  return { courses, categories, assessments, released, hash };
}

function sessionFingerprint() { return SESSION?.fingerprint() || 'none'; }

function printChange(change) {
  const a = change.now;
  const label = `${a.courseCode} | ${a.category} ${a.assessmentNumber}`;
  if (change.type === 'changed') {
    console.log(`[MARK CHANGED] ${label}: ${change.old.obtained} -> ${a.obtained}/${a.total}`);
  } else {
    console.log(`[NEW MARK] ${label}: ${a.obtained}/${a.total}`);
  }
}

async function runSelfTest() {
  const snapshot = await loadSnapshot();
  if (!snapshot) throw new Error(`No snapshot exists at ${SNAPSHOT_FILE}; run the watcher successfully once first.`);
  const mutated = structuredClone(snapshot);
  let target = null;
  for (const course of mutated.semester.courses) {
    for (const category of course.categories) {
      for (const assessment of category.assessments) {
        if (assessment.obtained !== null) {
          target = assessment;
          break;
        }
      }
      if (target) break;
    }
    if (target) break;
  }
  if (!target) throw new Error('Snapshot contains no released mark to mutate for self-test.');
  target.obtained += 0.123456;
  const changes = diffMarks(snapshot, mutated);
  if (changes.length !== 1 || changes[0].type !== 'changed') {
    throw new Error(`Self-test failed: expected exactly one changed mark; got ${changes.length}.`);
  }
  console.log(`[${stamp()}] SELF-TEST PASS: diff engine detected a controlled mark change without modifying the saved snapshot.`);
  printChange(changes[0]);
}

async function runEmailTest() {
  if (!EMAIL_CONFIG) {
    throw new Error('Email test requested, but email is not configured. Set FLEX_SMTP_USER, FLEX_SMTP_PASS, and FLEX_EMAIL_TO.');
  }
  const result = await sendEmail(EMAIL_CONFIG, buildTestEmail());
  console.log(
    `[${stamp()}] EMAIL TEST PASS | host=${EMAIL_CONFIG.host}:${EMAIL_CONFIG.port} | ` +
    `recipients=${result.recipients}`
  );
}

async function notifyChanges(changes) {
  if (!EMAIL_CONFIG) {
    console.log(`[${stamp()}] EMAIL DISABLED | mark change remains terminal-only.`);
    return true;
  }

  try {
    const result = await sendEmail(EMAIL_CONFIG, buildMarksEmail(changes));
    console.log(`[${stamp()}] EMAIL SENT | recipients=${result.recipients}`);
    return true;
  } catch (error) {
    console.error(`[${stamp()}] NOTIFICATION FAILED: ${error.message}`);
    console.error(`[${stamp()}] Snapshot was NOT advanced; the same mark change will be retried on the next poll.`);
    return false;
  }
}

async function request(path) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`https://flexstudent.nu.edu.pk${path}`, { headers: { Cookie: SESSION.header(), 'User-Agent': 'Mozilla/5.0', Accept: 'text/html,application/xhtml+xml' }, redirect: 'follow', signal: controller.signal });
    const setCookie = SESSION.acceptSetCookie(res.headers);
    const html = await res.text();
    return { res, html, setCookie };
  } catch {
    // Do not log remote text, URLs or fetch causes: they can contain secrets.
    throw Object.assign(new Error('Network request failed or timed out.'), { code: 'NETWORK_FAILURE' });
  } finally { clearTimeout(timeout); }
}
if (LONG_RUN && (!Number.isFinite(LONG_RUN_MS) || LONG_RUN_MS < 60 * 60 * 1000)) {
  console.error('FLEX_LONG_RUN_HOURS must be a number >= 1.');
  process.exit(1);
}

async function fetchVerifiedMarks() {
  const { res, html, setCookie } = await request(`/Student/StudentMarks?semid=${encodeURIComponent(SEMESTER_ID)}`);
  verifyAuthenticatedMarksResponse({ responseUrl: res.url, status: res.status, contentType: res.headers.get('content-type') || '', html });
  const current = parseMarksHtml(html);
  if (String(current.semester.id) !== String(SEMESTER_ID)) throw Object.assign(new Error('Requested semester does not match the marks response.'), { code: 'SEMESTER_MISMATCH' });
  return { current, status: res.status, setCookie };
}

async function poll() {
  try {
    const result = await fetchVerifiedMarks();
    const { current, status } = result;
    const stats = snapshotStats(current);
    const previous = await loadSnapshot();
    const fp = sessionFingerprint();

    console.log(
      `[${stamp()}] AUTH VERIFIED | protected marks route | session=${fp} | ` +
      `semester=${current.semester.id} | HTTP ${status} | courses=${stats.courses} | ` +
      `assessments=${stats.assessments} | released=${stats.released} | snapshot=${stats.hash}`
    );

    SESSION_ALERT_TRACKER.onPollSuccess();

    if (!previous) {
      await saveSnapshot(current);
      console.log(`[${stamp()}] Baseline saved. Watching FLEX every ${Math.round(POLL_MS / 1000)}s.`);
      return true;
    }

    const decision = decidePoll(previous, current);
    if (decision.type === 'unchanged') {
      console.log(`[${stamp()}] WATCHED | session still authenticated | no mark changes.`);
      await saveSnapshot(current);
      return true;
    }
    const changes = decision.changes;

    console.log(`[${stamp()}] MARK CHANGE DETECTED | count=${changes.length}`);
    for (const change of changes) printChange(change);
    console.log('');

    if (!await notifyChanges(changes)) return false;
    await saveSnapshot(current);
  } catch (error) {
    console.error(`[${stamp()}] ${classifyFailure(error)} | code=${error?.code || 'LOCAL_ERROR'}${error?.status ? ` | HTTP ${error.status}` : ''} | last valid snapshot preserved`);
    await SESSION_ALERT_TRACKER.onPollFailure(error);
    return false;
  }
  return true;
}

async function watchLoop() {
  const deadline = LONG_RUN ? Date.now() + LONG_RUN_MS : Infinity;
  let stopping = false;
  let wake = null;
  const stop = () => {
    stopping = true;
    console.log(`[${stamp()}] SHUTDOWN REQUESTED | finishing current poll`);
    wake?.();
  };
  // Install before the initial request, including in one-shot mode.
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  console.log(`[${stamp()}] STARTUP | poll=${POLL_MS}ms | timeout=${REQUEST_TIMEOUT_MS}ms | protected marks route is heartbeat`);
  if (LONG_RUN) console.log(`[${stamp()}] LONG SESSION TEST | duration=${LONG_RUN_MS / 3600000}h`);
  let failures = 0;
  try {
    while (!stopping && Date.now() < deadline) {
      const ok = await poll();
      failures = ok ? 0 : failures + 1;
      if (RUN_ONCE) {
        if (!ok) process.exitCode = 1;
        break;
      }
      if (stopping) break;
      const delay = ok ? POLL_MS : retryDelay(failures, RETRY_BASE_MS, RETRY_MAX_MS);
      if (!ok) console.log(`[${stamp()}] RETRY | in=${delay}ms | consecutiveFailures=${failures}`);
      await new Promise(resolve => {
        const timer = setTimeout(resolve, Math.min(delay, Math.max(0, deadline - Date.now())));
        wake = () => { clearTimeout(timer); resolve(); };
      });
      wake = null;
    }
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    console.log(`[${stamp()}] SHUTDOWN COMPLETE`);
  }
}

// Unexpected programming errors exit nonzero; systemd restarts a clean process.
function fatal() {
  console.error(`[${stamp()}] FATAL ERROR | process stopping; inspect configuration and local state`);
  process.exit(1);
}
process.on('unhandledRejection', fatal);
process.on('uncaughtException', fatal);
try {
  if (EMAIL_TEST) await runEmailTest();
  else if (SELF_TEST) await runSelfTest();
  else await watchLoop();
} catch {
  fatal();
}
