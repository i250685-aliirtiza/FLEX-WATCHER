import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { parseMarksHtml } from '../src/flex/parser.js';
import { retryDelay, classifyFailure } from '../src/retry.js';

const fixture = await readFile(new URL('./fixtures/flex-structure.html', import.meta.url), 'utf8');
const baseline = parseMarksHtml(fixture);

async function run({ response = {}, network = false, previous = baseline, signal = null, navigationResponse = {}, loop = false } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'flex-runtime-'));
  try {
    const snapshot = join(dir, 'snapshot.json');
    const before = JSON.stringify(previous);
    await writeFile(snapshot, before);
    const preload = join(dir, 'mock.mjs');
    await writeFile(preload, `
      let calls = 0, navigationCalls = 0, active = 0;
      const realTimeout = globalThis.setTimeout;
      ${loop ? "globalThis.setTimeout = (fn, delay, ...args) => realTimeout(fn, delay === 15000 ? 5 : delay, ...args);" : ''}
      globalThis.fetch = async (url, options) => {
        if (++active !== 1) throw new Error('Overlapping requests');
        if (options.headers.Cookie !== 'ASP.NET_SessionId=test-only-cookie') throw new Error('Session changed');
        await new Promise(resolve => realTimeout(resolve, 20));
        active--;
        if (url === 'https://flexstudent.nu.edu.pk/Student/PrintAdmitCard?semid=20263') {
          if (++navigationCalls !== calls + 1) throw new Error('Wrong navigation sequence');
          return { url, status: 200, headers: new Headers({'content-type': 'text/html'}), text: async () => '<html><a href="/Login/Logout">Logout</a></html>', ...${JSON.stringify(navigationResponse)},
            ${navigationResponse.html !== undefined ? `text: async () => ${JSON.stringify(navigationResponse.html)},` : ''}
          };
        }
        if (!url.includes('/Student/StudentMarks?')) throw new Error('Unexpected route');
        if (++calls !== navigationCalls) throw new Error('Marks requested before navigation');
        ${loop ? "if (calls === 2) process.emit('SIGTERM');" : ''}
        ${signal === 'first' ? "process.emit('SIGTERM');" : ''}
        ${network ? "throw new TypeError('fetch failed');" : ''}
        return { url: 'https://flexstudent.nu.edu.pk/Student/StudentMarks', status: 200,
          headers: new Headers({'content-type': 'text/html'}),
          text: async () => ${JSON.stringify(fixture)}, ...${JSON.stringify(response)},
          ${response.html !== undefined ? `text: async () => ${JSON.stringify(response.html)},` : ''}
        };
      };
      ${signal === 'idle' ? "setTimeout(() => process.emit('SIGINT'), 250);" : ''}
    `);
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('FLEX_') && key !== 'MARKS_POLL_MS'));
    Object.assign(env, { FLEX_COOKIE: 'test-only-cookie', FLEX_SNAPSHOT_FILE: snapshot, FLEX_RUN_ONCE: signal || loop ? '0' : '1' });
    const result = await new Promise((resolveResult, reject) => {
      const child = spawn(process.execPath, ['--import', pathToFileURL(preload).href, resolve('src/notifier.js')], { env });
      let output = '';
      child.stdout.on('data', data => { output += data; });
      child.stderr.on('data', data => { output += data; });
      const timer = setTimeout(() => { child.kill(); reject(new Error('Watcher did not shut down promptly')); }, 5000);
      child.on('error', reject);
      child.on('close', code => { clearTimeout(timer); resolveResult({ code, output }); });
    });
    return { ...result, before, after: await readFile(snapshot, 'utf8') };
  } finally { await rm(dir, { recursive: true, force: true }); }
}

test('runtime unchanged poll verifies auth and keeps equivalent snapshot', async () => {
  const r = await run();
  assert.equal(r.code, 0);
  assert.match(r.output, /AUTH VERIFIED/);
  assert.match(r.output, /no mark changes/);
  assert.deepEqual(JSON.parse(r.after), baseline);
});

test('runtime changed marks advance snapshot after terminal notification', async () => {
  const previous = structuredClone(baseline);
  const assessment = previous.semester.courses.flatMap(c => c.categories).flatMap(c => c.assessments).find(a => a.obtained !== null);
  assessment.obtained -= 1;
  const r = await run({ previous });
  assert.equal(r.code, 0);
  assert.match(r.output, /MARK CHANGE DETECTED/);
  assert.deepEqual(JSON.parse(r.after), baseline);
});

test('runtime failures preserve exact snapshot bytes and fail one-shot checks', async () => {
  for (const [options, label] of [
    [{ network: true }, 'TRANSIENT FAILURE'],
    [{ response: { status: 500, html: '' } }, 'FLEX HTTP FAILURE'],
    [{ response: { url: 'https://flexstudent.nu.edu.pk/Login', html: '' } }, 'AUTH EXPIRED'],
    [{ response: { html: '<input type="password">' } }, 'AUTH EXPIRED'],
    [{ response: { html: '<html>maintenance</html>' } }, 'UNEXPECTED FLEX RESPONSE'],
    [{ response: { status: 403, html: 'cf-chl-challenge' } }, 'UNEXPECTED FLEX RESPONSE'],
  ]) {
    const r = await run(options);
    assert.equal(r.code, 1, r.output);
    assert.ok(r.output.includes(label), r.output);
    assert.equal(r.after, r.before);
    assert.doesNotMatch(r.output, /test-only-cookie/);
  }
});

test('SIGTERM during first request and SIGINT during idle wait exit cleanly', async () => {
  for (const signal of ['first', 'idle']) {
    const r = await run({ signal });
    assert.equal(r.code, 0);
    assert.match(r.output, /SHUTDOWN REQUESTED/);
    assert.match(r.output, /SHUTDOWN COMPLETE/);
  }
});

test('backoff increases, caps, and resets with failure counter', () => {
  assert.deepEqual([1, 2, 3, 4, 100, 1].map(n => retryDelay(n, 300000, 1800000)),
    [300000, 600000, 1200000, 1800000, 1800000, 300000]);
  assert.equal(classifyFailure({ code: 'EACCES' }), 'LOCAL WATCH FAILURE');
});

test('navigation failure never parses marks or replaces snapshot', async () => {
  for (const navigationResponse of [
    { url: 'https://flexstudent.nu.edu.pk/Login', html: '<input type="password">' },
    { html: '<input type="password">' },
    { html: '<div class="cf-turnstile"></div>' },
    { html: '<html>Maintenance</html>' },
    { status: 401 },
  ]) {
    const result = await run({ navigationResponse });
    assert.equal(result.code, 1);
    assert.equal(result.before, result.after);
    assert.doesNotMatch(result.output, /NAVIGATION.*OK|AUTH VERIFIED|MARK CHANGE DETECTED|EMAIL SENT/);
  }
});

test('two delayed cycles use the same cookie and navigation order without overlap', async () => {
  const result = await run({ loop: true });
  assert.equal(result.code, 0, result.output);
  assert.equal((result.output.match(/NAVIGATION \| PrintAdmitCard OK/g) || []).length, 2);
  assert.equal((result.output.match(/AUTH VERIFIED/g) || []).length, 2);
  assert.match(result.output, /poll=15000ms/);
  assert.match(result.output, /observedAuthenticatedMs/);
});
