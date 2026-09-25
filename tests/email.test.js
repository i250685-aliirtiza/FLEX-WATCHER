import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMarksEmail, buildTestEmail, loadEmailConfig } from '../src/email.js';

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
  const message = buildMarksEmail([{
    type: 'released',
    now: {
      courseCode: 'CS2001', courseName: 'Data Structures', category: 'Quiz',
      assessmentNumber: 2, obtained: 8, total: 10, weightage: 2.5,
    },
  }], new Date('2026-09-25T16:00:00Z'));
  assert.match(message.subject, /New Mark: CS2001 Quiz 2/);
  assert.match(message.text, /CS2001 - Data Structures/);
  assert.match(message.text, /New: 8\/10/);
  assert.doesNotMatch(message.text, /average|min|max/i);
});

test('changed mark email shows old and new values', () => {
  const message = buildMarksEmail([{
    type: 'changed',
    old: { obtained: 7 },
    now: {
      courseCode: 'MT1004', courseName: 'Linear Algebra', category: 'Assignment',
      assessmentNumber: 1, obtained: 9, total: 10, weightage: 3,
    },
  }]);
  assert.match(message.subject, /Mark Updated/);
  assert.match(message.text, /Old: 7\/10/);
  assert.match(message.text, /New: 9\/10/);
});

test('multiple changes are batched into one email', () => {
  const sample = n => ({
    type: 'new',
    now: { courseCode: `CS${n}`, courseName: 'Course', category: 'Quiz', assessmentNumber: 1, obtained: n, total: 10, weightage: 1 },
  });
  const message = buildMarksEmail([sample(1), sample(2)]);
  assert.equal(message.subject, 'FLEX - 2 Mark Updates');
  assert.match(message.text, /CS1/);
  assert.match(message.text, /CS2/);
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
