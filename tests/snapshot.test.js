import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSnapshot } from '../src/snapshot.js';

const valid = {
  schemaVersion: 1,
  semester: { id: '20263', courses: [{ courseCode: 'CS2001', categories: [{ name: 'Quiz', assessments: [{ id: 'a1', assessmentNumber: 1, obtained: 7, total: 10, weightage: 2.5 }] }] }] },
};

test('valid snapshot passes schema validation', () => assert.equal(validateSnapshot(valid), valid));
test('malformed and unsupported snapshots fail closed', () => {
  for (const invalid of [null, {}, { schemaVersion: 2 }, { schemaVersion: 1, semester: {} }, { ...valid, semester: { ...valid.semester, courses: [{ courseCode: 'x', categories: [{}] }] } }]) {
    assert.throws(() => validateSnapshot(invalid));
  }
});
