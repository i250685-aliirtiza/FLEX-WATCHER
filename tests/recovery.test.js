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
  await assert.rejects(loginToFlex(), { code: 'MANUAL_INTERVENTION' });
});
