import { diffMarks } from './marks.js';

function stats(snapshot) {
  let courses = snapshot.semester.courses.length;
  let assessments = 0;
  for (const course of snapshot.semester.courses) {
    for (const category of course.categories) assessments += category.assessments.length;
  }
  return { courses, assessments };
}

export function decidePoll(previous, current) {
  if (!previous) return { type: 'baseline', changes: [] };
  const before = stats(previous);
  const now = stats(current);
  if (now.courses < before.courses) throw new Error(`INTEGRITY CHECK FAILED: course count dropped ${before.courses} -> ${now.courses}; snapshot NOT overwritten.`);
  if (now.assessments < before.assessments) throw new Error(`INTEGRITY CHECK FAILED: assessment count dropped ${before.assessments} -> ${now.assessments}; snapshot NOT overwritten.`);
  const changes = diffMarks(previous, current);
  return { type: changes.length ? 'changed' : 'unchanged', changes };
}
