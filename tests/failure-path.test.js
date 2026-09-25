import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyAuthenticatedMarksResponse } from '../src/flex/auth.js';
import { validateSnapshot } from '../src/snapshot.js';
import { SessionAlertTracker } from '../src/session-alert.js';

test('authentication failures fail closed for redirects, challenge pages, and non-HTML', () => {
  assert.throws(() => verifyAuthenticatedMarksResponse({ responseUrl: 'https://flexstudent.nu.edu.pk/Login', status: 200, contentType: 'text/html', html: '<form><input type="password"></form>' }), /login/i);
  assert.throws(() => verifyAuthenticatedMarksResponse({ responseUrl: 'https://flexstudent.nu.edu.pk/Student/StudentMarks', status: 200, contentType: 'text/html', html: 'Just a moment... cf-chl-' }), /Cloudflare|human/i);
  assert.throws(() => verifyAuthenticatedMarksResponse({ responseUrl: 'https://flexstudent.nu.edu.pk/Student/StudentMarks', status: 200, contentType: 'application/json', html: '{}' }), /HTML/i);
});

test('invalid persisted state is rejected before comparison', () => {
  assert.throws(() => validateSnapshot({ schemaVersion: 1, semester: { id: '20263', courses: [{ courseCode: 'CS', categories: [{ name: 'Quiz', assessments: [{ id: 'x', assessmentNumber: 1, obtained: 'bad', total: 10 }] }] }] } }), /assessment/i);
});

test('session alert retries after delivery failure and latches after success', async () => {
  let attempts = 0;
  const tracker = new SessionAlertTracker({ sendAlert: async () => { attempts += 1; if (attempts === 1) throw new Error('temporary'); } });
  await tracker.onPollFailure({ code: 'LOGIN_REQUIRED' });
  assert.equal(tracker.isAlertSent(), false);
  await tracker.onPollFailure({ code: 'LOGIN_REQUIRED' });
  assert.equal(attempts, 2);
  assert.equal(tracker.isAlertSent(), true);
  await tracker.onPollFailure({ code: 'LOGIN_REQUIRED' });
  assert.equal(attempts, 2);
});
