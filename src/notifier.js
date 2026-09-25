import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parseMarksHtml } from './flex/parser.js';
import { normalizeCookieInput, verifyAuthenticatedMarksResponse } from './flex/auth.js';
import { buildMarksEmail, buildSessionExpiredEmail, buildTestEmail, loadEmailConfig, sendEmail } from './email.js';
import { SessionAlertTracker } from './session-alert.js';
import { diffMarks } from './marks.js';
import { validateSnapshot } from './snapshot.js';

const COOKIE_INPUT = process.env.FLEX_COOKIE || process.env.FLEX_SESSION_ID;
const SEMESTER_ID = process.env.FLEX_SEMESTER_ID || '20263';
const POLL_MS = Number(process.env.FLEX_POLL_MS || 300000);
const REQUEST_TIMEOUT_MS = Number(process.env.FLEX_REQUEST_TIMEOUT_MS || 30000);
const SNAPSHOT_FILE = process.env.FLEX_SNAPSHOT_FILE || './data/marks-snapshot.json';
const RUN_ONCE = process.env.FLEX_RUN_ONCE === '1';
const SELF_TEST = process.env.FLEX_SELF_TEST === '1';
const EMAIL_TEST = process.env.FLEX_EMAIL_TEST === '1';

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
        await sendEmail(EMAIL_CONFIG, buildSessionExpiredEmail());
      }
    : null,
  log: msg => console.log(`[${stamp()}] ${msg}`),
  logError: msg => console.error(`[${stamp()}] ${msg}`),
});

let COOKIE_HEADER = null;
if (!SELF_TEST && !EMAIL_TEST) {
  try {
    COOKIE_HEADER = normalizeCookieInput(COOKIE_INPUT);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

if (!Number.isFinite(POLL_MS) || POLL_MS < 10000) {
  console.error('FLEX_POLL_MS must be a number >= 10000.');
  process.exit(1);
}

const MARKS_URL = `https://flexstudent.nu.edu.pk/Student/StudentMarks?semid=${encodeURIComponent(SEMESTER_ID)}`;

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
    await writeFile(temporary, JSON.stringify(snapshot, null, 2), { encoding: 'utf8' });
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

function sessionFingerprint(cookieHeader) {
  return createHash('sha256').update(cookieHeader).digest('hex').slice(0, 8);
}

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

async function poll() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const res = await fetch(MARKS_URL, {
      headers: {
        Cookie: COOKIE_HEADER,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/142 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const html = await res.text();
    verifyAuthenticatedMarksResponse({
      responseUrl: res.url,
      status: res.status,
      contentType: res.headers.get('content-type') || '',
      html,
    });

    // Structural parsing is part of the auth proof: a login/challenge/error page
    // cannot pass this and masquerade as a successful poll.
    const current = parseMarksHtml(html);
    if (String(current.semester.id) !== String(SEMESTER_ID)) {
      throw new Error(`SEMESTER MISMATCH: requested ${SEMESTER_ID}, received ${current.semester.id}.`);
    }

    const stats = snapshotStats(current);
    const previous = await loadSnapshot();
    const fp = sessionFingerprint(COOKIE_HEADER);

    console.log(
      `[${stamp()}] AUTH VERIFIED | protected marks route | session=${fp} | ` +
      `semester=${current.semester.id} | HTTP ${res.status} | courses=${stats.courses} | ` +
      `assessments=${stats.assessments} | released=${stats.released} | snapshot=${stats.hash}`
    );

    SESSION_ALERT_TRACKER.onPollSuccess();

    if (!previous) {
      await saveSnapshot(current);
      console.log(`[${stamp()}] Baseline saved. Watching FLEX every ${Math.round(POLL_MS / 1000)}s.`);
      return;
    }

    const prevStats = snapshotStats(previous);
    if (stats.courses < prevStats.courses) {
      throw new Error(`INTEGRITY CHECK FAILED: course count dropped ${prevStats.courses} -> ${stats.courses}; snapshot NOT overwritten.`);
    }
    if (stats.assessments < prevStats.assessments) {
      throw new Error(`INTEGRITY CHECK FAILED: assessment count dropped ${prevStats.assessments} -> ${stats.assessments}; snapshot NOT overwritten.`);
    }

    const changes = diffMarks(previous, current);
    if (changes.length === 0) {
      console.log(`[${stamp()}] WATCHED | session still authenticated | no mark changes.`);
      await saveSnapshot(current);
      return;
    }

    console.log(`\n[${stamp()}] ${changes.length} mark change(s) detected:`);
    for (const change of changes) printChange(change);
    console.log('');

    if (!await notifyChanges(changes)) return;
    await saveSnapshot(current);
  } catch (error) {
    const code = error?.code ? ` ${error.code}` : '';
    console.error(`[${stamp()}] AUTH/WATCH FAILED${code}: ${error.message}`);
    console.error(`[${stamp()}] Last valid snapshot was NOT overwritten.`);
    await SESSION_ALERT_TRACKER.onPollFailure(error);
  }
}

async function watchLoop() {
  await poll();
  if (RUN_ONCE) return;

  // Sequential loop avoids overlapping checks when FLEX is slow.
  let stopping = false;
  const stop = () => { stopping = true; };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  while (!stopping) {
    await new Promise(resolve => setTimeout(resolve, POLL_MS));
    if (stopping) break;
    await poll();
  }
  process.removeListener('SIGINT', stop);
  process.removeListener('SIGTERM', stop);
  console.log(`[${stamp()}] SHUTDOWN COMPLETE`);
}

if (EMAIL_TEST) {
  await runEmailTest();
} else if (SELF_TEST) {
  await runSelfTest();
} else {
  await watchLoop();
}
