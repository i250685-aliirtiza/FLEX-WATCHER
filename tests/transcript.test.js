import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTranscriptHtml, diffTranscript } from '../src/flex/transcript.js';

const html = `<h5>Fall 2026</h5><table><thead><tr><th>Code</th><th>Course Name</th><th>Section</th><th>CrdHrs</th><th>Grade</th><th>Points</th></tr></thead><tbody><tr><td>CS2001</td><td>Data Structures</td><td>BCS-3D</td><td>3</td><td>I</td><td>0</td></tr></tbody></table>`;

test('transcript parser recognizes pending I grade', () => {
  const result = parseTranscriptHtml(html, { currentSemester: 'Fall 2026' });
  assert.equal(result.semesters[0].courses[0].grade, 'I');
});

test('transcript diff detects I becoming a posted grade', () => {
  const old = parseTranscriptHtml(html);
  const now = parseTranscriptHtml(html.replace('<td>I</td><td>0</td>', '<td>A</td><td>4</td>'));
  const changes = diffTranscript(old, now);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].old.grade, 'I');
  assert.equal(changes[0].now.grade, 'A');
});
