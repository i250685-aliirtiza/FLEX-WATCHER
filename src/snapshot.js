export function validateSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    throw new Error('Saved snapshot is not an object.');
  }
  if (snapshot.schemaVersion !== 1) {
    throw new Error(`Unsupported saved snapshot schemaVersion: ${snapshot.schemaVersion ?? 'missing'}.`);
  }
  const semester = snapshot.semester;
  if (!semester || typeof semester.id !== 'string' || !semester.id.trim() || !Array.isArray(semester.courses)) {
    throw new Error('Saved snapshot has invalid semester metadata.');
  }
  for (const course of semester.courses) {
    if (!course || typeof course.courseCode !== 'string' || !Array.isArray(course.categories)) {
      throw new Error('Saved snapshot has invalid course data.');
    }
    for (const category of course.categories) {
      if (!category || typeof category.name !== 'string' || !Array.isArray(category.assessments)) {
        throw new Error('Saved snapshot has invalid category data.');
      }
      for (const assessment of category.assessments) {
        if (!assessment || typeof assessment.id !== 'string' || !Number.isSafeInteger(assessment.assessmentNumber) ||
            typeof assessment.total !== 'number' || !Number.isFinite(assessment.total) ||
            (assessment.obtained !== null && (typeof assessment.obtained !== 'number' || !Number.isFinite(assessment.obtained)))) {
          throw new Error('Saved snapshot has invalid assessment data.');
        }
      }
    }
  }
  return snapshot;
}
