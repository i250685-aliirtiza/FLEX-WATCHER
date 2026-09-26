import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionRecovery, loginToFlex } from '../src/flex/recovery.js';

const expired = { code: 'LOGIN_REQUIRED' };
test('recovery verifies replacement session before exposing it', async () => {
  const events = [];
  const recovery = new SessionRecovery({ login: async () => 'test-cookie', verify: async cookie => { events.push(cookie); return { current: 'verified' }; } });
  assert.deepEqual(await recovery.recover(expired), { cookie: 'test-cookie', result: { current: 'verified' } });
  assert.deepEqual(events, ['test-cookie']);
});
test('network errors do not trigger login', async () => {
  let calls = 0;
  const recovery = new SessionRecovery({ login: async () => calls++ });
  await assert.rejects(recovery.recover(new Error('network')), /network/);
  assert.equal(calls, 0);
});
test('failed verification backs off, caps attempts and never returns a session', async () => {
  let clock = 0, calls = 0;
  const recovery = new SessionRecovery({ now: () => clock, login: async () => { calls++; return 'bad'; }, verify: async () => { throw expired; } });
  await assert.rejects(recovery.recover(expired), { code: 'RECOVERY_BACKOFF' });
  await assert.rejects(recovery.recover(expired), { code: 'RECOVERY_BACKOFF' });
  assert.equal(calls, 1);
  clock = 60000;
  await assert.rejects(recovery.recover(expired), { code: 'RECOVERY_BACKOFF' });
  clock = 180000;
  await assert.rejects(recovery.recover(expired), { code: 'MANUAL_INTERVENTION' });
  clock = 999999;
  await assert.rejects(recovery.recover(expired), { code: 'MANUAL_INTERVENTION' });
  assert.equal(calls, 3);
});
test('unverified live adapter fails closed without posting credentials', async () => {
  const oldUser = process.env.FLEX_USERNAME;
  const oldPass = process.env.FLEX_PASSWORD;
  delete process.env.FLEX_USERNAME; delete process.env.FLEX_PASSWORD;
  await assert.rejects(loginToFlex(), { code: 'MANUAL_INTERVENTION' });
  if (oldUser === undefined) delete process.env.FLEX_USERNAME; else process.env.FLEX_USERNAME = oldUser;
  if (oldPass === undefined) delete process.env.FLEX_PASSWORD; else process.env.FLEX_PASSWORD = oldPass;
});

test('browser adapter extracts only the session cookie after Turnstile and login response', async () => {
  const oldUser = process.env.FLEX_USERNAME; const oldPass = process.env.FLEX_PASSWORD;
  process.env.FLEX_USERNAME = 'student@example.test'; process.env.FLEX_PASSWORD = 'secret';
  let closed = false;
  const input = { fill: async value => { assert.ok(value); }, waitFor: async () => {}, click: async () => {} };
  const page = {
    goto: async url => assert.equal(url, 'https://flexstudent.nu.edu.pk/Login'),
    locator: selector => { assert.match(selector, /username|password|cf-turnstile-response|m_login_signin_submit/); return input; },
    waitForFunction: async () => {},
    waitForResponse: async () => {},
  };
  const context = { newPage: async () => page, cookies: async () => [{ name: 'ASP.NET_SessionId', value: 'session-value' }] };
  const browserType = { launch: async () => ({ newContext: async () => context, close: async () => { closed = true; } }) };
  const { loginToFlex: login } = await import('../src/flex/recovery.js');
  assert.equal(await login({ browserType }), 'ASP.NET_SessionId=session-value');
  assert.equal(closed, true);
  if (oldUser === undefined) delete process.env.FLEX_USERNAME; else process.env.FLEX_USERNAME = oldUser;
  if (oldPass === undefined) delete process.env.FLEX_PASSWORD; else process.env.FLEX_PASSWORD = oldPass;
});
