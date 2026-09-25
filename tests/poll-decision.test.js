import test from 'node:test';
import assert from 'node:assert/strict';
import { decidePoll } from '../src/poll-decision.js';

const snap = courses => ({ semester: { courses } });
const course = (code, assessments = []) => ({ courseCode: code, categories: [{ name: 'Quiz', assessments }] });
const assessment = (id, obtained = 5) => ({ id, assessmentNumber: 1, obtained, total: 10, weightage: 2 });

test('poll decision identifies baseline, unchanged, and changed outcomes', () => {
  const first = snap([course('CS1', [assessment('a')])]);
  assert.deepEqual(decidePoll(null, first), { type: 'baseline', changes: [] });
  assert.equal(decidePoll(first, structuredClone(first)).type, 'unchanged');
  const changed = snap([course('CS1', [assessment('a', 8)])]);
  const decision = decidePoll(first, changed);
  assert.equal(decision.type, 'changed');
  assert.equal(decision.changes.length, 1);
});

test('poll decision rejects course and assessment count drops', () => {
  const old = snap([course('CS1', [assessment('a')]), course('CS2', [assessment('b')])]);
  assert.throws(() => decidePoll(old, snap([course('CS1', [assessment('a')])])), /course count dropped/);
  const oldAssessments = snap([course('CS1', [assessment('a'), { ...assessment('b'), assessmentNumber: 2 }])]);
  assert.throws(() => decidePoll(oldAssessments, snap([course('CS1', [assessment('a')])])), /assessment count dropped/);
});
