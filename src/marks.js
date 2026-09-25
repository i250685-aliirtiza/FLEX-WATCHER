export function flattenMarks(snapshot) {
  const out = new Map();
  for (const course of snapshot.semester.courses) {
    for (const category of course.categories) {
      for (const assessment of category.assessments) {
        out.set(assessment.id, {
          id: assessment.id,
          courseCode: course.courseCode,
          courseName: course.name,
          category: category.name,
          assessmentNumber: assessment.assessmentNumber,
          obtained: assessment.obtained,
          total: assessment.total,
          weightage: assessment.weightage,
        });
      }
    }
  }
  return out;
}

export function diffMarks(oldSnapshot, newSnapshot) {
  const before = flattenMarks(oldSnapshot);
  const after = flattenMarks(newSnapshot);
  const changes = [];

  for (const [id, now] of after) {
    const old = before.get(id);
    if (!old) {
      if (now.obtained !== null) changes.push({ type: 'new', now });
      continue;
    }
    if (old.obtained !== now.obtained || old.total !== now.total) {
      changes.push({ type: old.obtained === null && now.obtained !== null ? 'released' : 'changed', old, now });
    }
  }
  return changes;
}
