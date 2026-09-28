import { buildMarksEmail } from './email.js';

// Checkpoint only accepted assessments; failed deliveries remain differences on retry.
export async function deliverChanges({ previous, current, changes, send, save, logError = () => {}, detectedAt = new Date() }) {
  const checkpoint = structuredClone(previous);
  let ok = true;
  for (const change of changes) {
    try {
      await send(buildMarksEmail(change, detectedAt));
    } catch {
      logError('NOTIFICATION FAILED | assessment delivery will be retried; accepted notifications retained');
      ok = false;
      continue;
    }
    for (const sourceCourse of current.semester.courses) {
      for (const sourceCategory of sourceCourse.categories) {
        const assessment = sourceCategory.assessments.find(a => a.id === change.now.id);
        if (!assessment) continue;
        let course = checkpoint.semester.courses.find(c => c.courseCode === sourceCourse.courseCode);
        if (!course) {
          course = { ...structuredClone(sourceCourse), categories: [] };
          checkpoint.semester.courses.push(course);
        }
        let category = course.categories.find(c => (c.assessmentType || c.name.toLowerCase()) === (sourceCategory.assessmentType || sourceCategory.name.toLowerCase()));
        if (!category) {
          category = { ...structuredClone(sourceCategory), assessments: [] };
          course.categories.push(category);
        }
        const index = category.assessments.findIndex(a => a.id === assessment.id);
        if (index < 0) category.assessments.push(structuredClone(assessment));
        else category.assessments[index] = structuredClone(assessment);
      }
    }
    // Stop if durable acknowledgement fails; do not send further messages.
    await save(checkpoint);
  }
  if (ok) await save(current);
  return ok;
}
