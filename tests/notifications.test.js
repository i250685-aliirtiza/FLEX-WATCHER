import test from 'node:test';
import assert from 'node:assert/strict';
import { deliverChanges } from '../src/notifications.js';
import { diffMarks } from '../src/marks.js';
import { validateSnapshot } from '../src/snapshot.js';

const snapshot = count => ({ schemaVersion: 1, semester: { id: '20263', courses: Array.from({ length: count }, (_, i) => ({
  courseCode: `CS${i}`, name: `Course-${i}`, categories: [{ name: 'Quiz', assessments: [{ id: `a${i}`, assessmentNumber: i + 1, obtained: 9, total: 10, weightage: 2 }] }],
})) } });

for (const count of [0, 1, 3, 7]) {
  test(`${count} changes send exactly ${count} isolated emails sequentially; repeat poll sends none`, async () => {
    const previous = snapshot(0), current = snapshot(count), sent = [];
    let saved = previous, active = 0, maxActive = 0;
    const send = async message => {
      active++; maxActive = Math.max(maxActive, active);
      await new Promise(resolve => setTimeout(resolve, 2));
      sent.push(message); active--;
    };
    const save = async value => { saved = structuredClone(validateSnapshot(value)); };
    assert.equal(await deliverChanges({ previous, current, changes: diffMarks(previous, current), send, save }), true);
    assert.equal(sent.length, count);
    assert.ok(maxActive <= 1);
    for (let i = 0; i < count; i++) {
      assert.equal(sent[i].subject, `Course-${i} Quiz ${i + 1} \u2014 9/10`);
      for (let j = 0; j < count; j++) if (j !== i) {
        assert.ok(!sent[i].text.includes(`Course-${j}`));
        assert.ok(!sent[i].html.includes(`Course-${j}`));
      }
    }
    await deliverChanges({ previous: saved, current, changes: diffMarks(saved, current), send, save });
    assert.equal(sent.length, count);
  });
}

test('partial SMTP failure checkpoints successes; restart retries only failed assessment', async () => {
  const previous = snapshot(0), current = snapshot(7);
  let saved = previous;
  const accepted = [], errors = [];
  const save = async value => { saved = structuredClone(validateSnapshot(value)); };
  const ok = await deliverChanges({ previous, current, changes: diffMarks(previous, current), save,
    send: async message => { if (message.subject.startsWith('Course-3')) throw new Error('SMTP failure'); accepted.push(message); },
    logError: message => errors.push(message),
  });
  assert.equal(ok, false);
  assert.equal(accepted.length, 6);
  assert.equal(errors.length, 1);
  const pending = diffMarks(JSON.parse(JSON.stringify(saved)), current);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].now.courseName, 'Course-3');
  await deliverChanges({ previous: saved, current, changes: pending, save, send: async message => accepted.push(message) });
  assert.equal(accepted.length, 7);
  assert.deepEqual(diffMarks(saved, current), []);
});

test('changed result sends old total correctly and checkpoint failure stops later sends', async () => {
  const previous = snapshot(3), current = snapshot(3);
  for (const c of current.semester.courses) c.categories[0].assessments[0].obtained = 9.5;
  const sent = [];
  await assert.rejects(deliverChanges({ previous, current, changes: diffMarks(previous, current),
    send: async message => sent.push(message), save: async () => { throw new Error('Disk failure'); },
  }), /Disk failure/);
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /Previous: 9\/10/);
  assert.match(sent[0].text, /New: 9.5\/10/);
  assert.match(sent[0].html, /Marks Updated/);
  assert.equal(previous.semester.courses[0].categories[0].assessments[0].obtained, 9);
});
