import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMarksEmail, buildTestEmail, buildRecoveryEmail, buildSessionExpiredEmail, loadEmailConfig, rawMessage } from '../src/email.js';

test('email config is disabled when no email settings exist', () => {
  assert.equal(loadEmailConfig({}), null);
});

test('email config fails closed when partially configured', () => {
  assert.throws(
    () => loadEmailConfig({ FLEX_SMTP_USER: 'sender@example.com', FLEX_EMAIL_TO: 'me@example.com' }),
    /incomplete/i,
  );
});

test('gmail defaults use implicit TLS port and normalize app-password spaces', () => {
  const config = loadEmailConfig({
    FLEX_SMTP_USER: 'sender@gmail.com',
    FLEX_SMTP_PASS: 'abcd efgh ijkl mnop',
    FLEX_EMAIL_TO: 'me@example.com, second@example.com',
  });
  assert.equal(config.host, 'smtp.gmail.com');
  assert.equal(config.port, 465);
  assert.equal(config.from, 'sender@gmail.com');
  assert.equal(config.pass, 'abcdefghijklmnop');
  assert.deepEqual(config.to, ['me@example.com', 'second@example.com']);
});

test('new mark email includes only relevant student mark details', () => {
  const message = buildMarksEmail({
    type: 'released',
    now: {
      courseCode: 'CS2001', courseName: 'Data Structures', category: 'Quiz',
      assessmentNumber: 2, obtained: 8, total: 10, weightage: 2.5,
    },
  }, new Date('2026-09-25T16:00:00Z'));
  assert.match(message.subject, /Data Structures Quiz 2 \u2014 8\/10/);
  assert.match(message.text, /Course: Data Structures/);
  assert.match(message.text, /New: 8\/10/);
  assert.doesNotMatch(message.text, /average|min|max/i);
});

test('changed mark email shows old and new values', () => {
  const message = buildMarksEmail({
    type: 'changed',
    old: { obtained: 7, total: 12 },
    now: {
      courseCode: 'MT1004', courseName: 'Linear Algebra', category: 'Assignment',
      assessmentNumber: 1, obtained: 9, total: 10, weightage: 3,
    },
  });
  assert.match(message.subject, /Linear Algebra Assignment 1 \u2014 9\/10/);
  assert.match(message.text, /Previous: 7\/12/);
  assert.match(message.text, /New: 9\/10/);
});

test('batch input is rejected', () => {
  assert.throws(() => buildMarksEmail([{ now: {} }, { now: {} }]), /exactly one/);
});

test('HTML escapes scraped values, calculates decimals, and includes text alternative', () => {
  const message = buildMarksEmail({ type: 'new', now: { courseName: '<script>&"', category: "Quiz's", assessmentNumber: 1, obtained: 9.5, total: 10 } });
  assert.match(message.text, /95%/);
  assert.match(message.html, /95%/);
  assert.match(message.html, /&lt;script&gt;&amp;&quot;/);
  assert.match(message.html, /Quiz&#39;s/);
  assert.doesNotMatch(message.html, /<script>/);
  const raw = rawMessage({ from: 'a@example.com', to: ['b@example.com'] }, message);
  assert.match(raw, /multipart\/alternative/);
  assert.match(raw, /text\/plain/);
  assert.match(raw, /text\/html/);
  assert.ok(raw.includes(Buffer.from(message.text).toString('base64').slice(0, 60)));
});

test('missing, zero, and invalid totals omit percentage without fake values', () => {
  for (const total of [undefined, null, 0, NaN, Infinity]) {
    const message = buildMarksEmail({ type: 'new', now: { courseName: 'Course', category: 'Quiz', obtained: 9, total } });
    assert.doesNotMatch(message.text, /Percentage|undefined|null|NaN|Infinity/);
    assert.doesNotMatch(message.html, /NaN%|undefined|null|Infinity/);
  }
  assert.match(buildMarksEmail({ type: 'new', now: { obtained: 1, total: 3 } }).text, /33.33%/);
});

test('test email explicitly states it does not change FLEX state', () => {
  const message = buildTestEmail();
  assert.match(message.subject, /Email Test/);
  assert.match(message.text, /No FLEX mark or saved snapshot was changed/);
});

test('header injection in configured addresses is rejected', () => {
  assert.throws(() => loadEmailConfig({
    FLEX_SMTP_USER: 'sender@example.com\r\nBcc: attacker@example.com',
    FLEX_SMTP_PASS: 'secret',
    FLEX_EMAIL_TO: 'me@example.com',
  }), /Invalid FLEX_SMTP_USER/);
});

test('auth recovery emails contain a private link and no secrets', () => {
  const lost = buildSessionExpiredEmail(new Date('2026-09-28T13:00:00Z'), 'https://browser.tailnet.example');
  assert.match(lost.subject, /Login Required/); assert.match(lost.html, /Re-authenticate FLEX/); assert.match(lost.html, /browser.tailnet.example/);
  assert.doesNotMatch(lost.text, /password|cookie|session id/i);
  const recovered = buildRecoveryEmail(new Date('2026-09-28T13:05:00Z'), 15000);
  assert.match(recovered.subject, /Back Online/); assert.match(recovered.text, /resumed automatically/);
});
