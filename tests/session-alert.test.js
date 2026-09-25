import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSessionExpiredEmail } from '../src/email.js';
import { SessionAlertTracker } from '../src/session-alert.js';
import { FlexAuthError, verifyAuthenticatedMarksResponse } from '../src/flex/auth.js';

test('buildSessionExpiredEmail produces expected subject and actionable message text', () => {
  const email = buildSessionExpiredEmail(new Date('2026-09-25T17:00:00Z'));
  assert.equal(email.subject, 'FLEX Watcher Alert - Session Expired');
  assert.match(email.text, /Your FLEX session is no longer authenticated\./);
  assert.match(email.text, /A new session cookie is required\./);
  assert.match(email.text, /The saved marks snapshot remains unchanged\./);
});

test('HTTP 401 and 403 fail with LOGIN_REQUIRED', () => {
  for (const status of [401, 403]) {
    assert.throws(
      () => verifyAuthenticatedMarksResponse({
        responseUrl: 'https://flexstudent.nu.edu.pk/Student/StudentMarks',
        status,
        contentType: 'text/html',
        html: '<html><body>Login required</body></html>',
      }),
      error => error instanceof FlexAuthError && error.code === 'LOGIN_REQUIRED',
    );
  }
});

test('SessionAlertTracker dispatches alert once on LOGIN_REQUIRED and latches', async () => {
  let sendCount = 0;
  const logs = [];
  const tracker = new SessionAlertTracker({
    sendAlert: async () => { sendCount++; },
    log: msg => logs.push(msg),
    logError: msg => logs.push(`ERR: ${msg}`),
  });

  const loginError = new FlexAuthError('Session expired', 'LOGIN_REQUIRED');

  // First poll failure with LOGIN_REQUIRED -> triggers alert
  const first = await tracker.onPollFailure(loginError);
  assert.equal(first, true);
  assert.equal(sendCount, 1);
  assert.equal(tracker.isAlertSent(), true);

  // Second poll failure with LOGIN_REQUIRED -> suppressed by anti-spam latch
  const second = await tracker.onPollFailure(loginError);
  assert.equal(second, false);
  assert.equal(sendCount, 1);
  assert.equal(tracker.isAlertSent(), true);
});

test('SessionAlertTracker ignores non-login errors', async () => {
  let sendCount = 0;
  const tracker = new SessionAlertTracker({
    sendAlert: async () => { sendCount++; },
  });

  const otherErrors = [
    new FlexAuthError('Human verification required', 'HUMAN_VERIFICATION_REQUIRED'),
    new FlexAuthError('FLEX returned HTTP 500', 'HTTP_ERROR'),
    new Error('Network offline'),
  ];

  for (const err of otherErrors) {
    const sent = await tracker.onPollFailure(err);
    assert.equal(sent, false);
  }
  assert.equal(sendCount, 0);
  assert.equal(tracker.isAlertSent(), false);
});

test('SessionAlertTracker resets on poll success and can alert again on subsequent expiry', async () => {
  let sendCount = 0;
  const logs = [];
  const tracker = new SessionAlertTracker({
    sendAlert: async () => { sendCount++; },
    log: msg => logs.push(msg),
  });

  const loginError = new FlexAuthError('Session expired', 'LOGIN_REQUIRED');

  await tracker.onPollFailure(loginError);
  assert.equal(sendCount, 1);
  assert.equal(tracker.isAlertSent(), true);

  // Re-authentication occurs
  tracker.onPollSuccess();
  assert.equal(tracker.isAlertSent(), false);
  assert.ok(logs.some(m => m.includes('SESSION RE-AUTHENTICATED')));

  // Session expires again in the future
  await tracker.onPollFailure(loginError);
  assert.equal(sendCount, 2);
  assert.equal(tracker.isAlertSent(), true);
});

test('SessionAlertTracker leaves alertSent false if sendAlert throws, allowing retry', async () => {
  let attempts = 0;
  const errorLogs = [];
  const tracker = new SessionAlertTracker({
    sendAlert: async () => {
      attempts++;
      throw new Error('SMTP connection refused');
    },
    logError: msg => errorLogs.push(msg),
  });

  const loginError = new FlexAuthError('Session expired', 'LOGIN_REQUIRED');

  // Delivery attempt 1 fails
  const first = await tracker.onPollFailure(loginError);
  assert.equal(first, false);
  assert.equal(attempts, 1);
  assert.equal(tracker.isAlertSent(), false);
  assert.ok(errorLogs.some(m => m.includes('SMTP connection refused')));

  // Next poll failure can retry delivery because alertSent is still false
  const second = await tracker.onPollFailure(loginError);
  assert.equal(second, false);
  assert.equal(attempts, 2);
  assert.equal(tracker.isAlertSent(), false);
});

test('SessionAlertTracker logs without crashing when email is not configured', async () => {
  const logs = [];
  const tracker = new SessionAlertTracker({
    sendAlert: null,
    log: msg => logs.push(msg),
  });

  const loginError = new FlexAuthError('Session expired', 'LOGIN_REQUIRED');
  const result = await tracker.onPollFailure(loginError);
  assert.equal(result, false);
  assert.equal(tracker.isAlertSent(), false);
  assert.ok(logs.some(m => m.includes('Email alert disabled')));
});
