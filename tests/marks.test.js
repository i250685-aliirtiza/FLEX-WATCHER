import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMarksEmail } from '../src/email.js';
import { diffMarks } from '../src/marks.js';

function snapshot(assessments = [{ id: 'a1', assessmentNumber: 1, obtained: 7, total: 10, weightage: 2.5 }]) {
  return {
    semester: {
      id: '20263',
      courses: [{
        courseCode: 'CS2001',
        name: 'Programming',
        categories: [{ name: 'Quiz', assessments }],
      }],
    },
  };
}

test('unchanged snapshots produce no changes and no email content', () => {
  const changes = diffMarks(snapshot(), snapshot());
  assert.deepEqual(changes, []);
});

test('new released assessment is detected exactly once', () => {
  const next = snapshot([
    { id: 'a1', assessmentNumber: 1, obtained: 7, total: 10, weightage: 2.5 },
    { id: 'a2', assessmentNumber: 2, obtained: 9, total: 10, weightage: 2.5 },
  ]);
  const changes = diffMarks(snapshot(), next);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].type, 'new');
  assert.equal(changes[0].now.assessmentNumber, 2);
  assert.match(buildMarksEmail(changes).text, /CS2001 - Programming[\s\S]*Quiz 2[\s\S]*New: 9\/10/);
  assert.deepEqual(diffMarks(next, next), []);
});

test('existing obtained mark changes with old and new values in notification', () => {
  const next = snapshot([{ id: 'a1', assessmentNumber: 1, obtained: 9, total: 12, weightage: 2.5 }]);
  const changes = diffMarks(snapshot(), next);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].type, 'changed');
  assert.equal(changes[0].old.obtained, 7);
  assert.equal(changes[0].now.obtained, 9);
  assert.equal(changes[0].now.total, 12);
  const email = buildMarksEmail(changes);
  assert.match(email.subject, /Mark Updated/);
  assert.match(email.text, /Old: 7\/12/);
  assert.match(email.text, /New: 9\/12/);
  assert.deepEqual(diffMarks(next, next), []);
});

test('previously unreleased assessment becomes released', () => {
  const old = snapshot([{ id: 'a1', assessmentNumber: 1, obtained: null, total: 10, weightage: 2.5 }]);
  const next = snapshot([{ id: 'a1', assessmentNumber: 1, obtained: 8, total: 10, weightage: 2.5 }]);
  const changes = diffMarks(old, next);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].type, 'released');
  assert.match(buildMarksEmail(changes).text, /New: 8\/10/);
});
