import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseMarksHtml, FlexParseError } from '../src/flex/parser.js';

// Synthetic values; DOM structure follows the supplied FLEX contract.
const row = (number = 1, obtained = '8', total = '10', weightage = '2') => `
<tr class="calculationrow"><td>${number}</td>
<td class="weightage">${weightage}</td><td class="ObtMarks">${obtained}</td>
<td class="GrandTotal">${total}</td><td class="AverageMarks">6.25</td>
<td class="MinMarks">0</td><td class="MaxMarks">10</td><td class="StdDev">1</td></tr>`;
const card = (type = 'Quiz', rows = row(), extra = '') => `
<div class="card"><div class="card-header"><h5><button>${type}</button></h5></div>
<div class="card-body"><table><thead><tr><th>${type} #</th><th>Weightage</th>
<th>Obtained Marks</th><th>Total Marks</th></tr></thead><tbody>${rows}</tbody>${extra}</table></div></div>`;
const course = (code = 'CS2001', cards = card()) => `
<div class="tab-pane" id="${code}"><div id="accordion"><h5>${code}-Example Course (BCS-3D)</h5>${cards}</div></div>`;
const page = (courses = [course()], options = '<option value="20261">Spring 2026</option><option selected value="20263">Fall 2026</option>') => `
<!doctype html><html><body><select id="SemId">${options}</select>
<nav>${courses.map(c => `<a role="tab" href="#${c.match(/id="([^"]+)"/)[1]}">Course</a>`).join('')}</nav>
${courses.join('')}</body></html>`;
const first = html => parseMarksHtml(html).semester.courses[0].categories[0].assessments[0];
const invalid = html => assert.throws(() => parseMarksHtml(html), error => error instanceof FlexParseError && error.code === 'INVALID_MARKS_PAGE');

test('1. discovers multiple courses, including inactive panes', () => {
  assert.deepEqual(parseMarksHtml(page([course('CS2001'), course('MT1004')])).semester.courses.map(c => c.courseCode), ['CS2001', 'MT1004']);
});
test('2. groups multiple categories independently', () => {
  const c = parseMarksHtml(page([course('CS2001', card('Quiz') + card('Assignment') + card('Lab Work'))])).semester.courses[0];
  assert.deepEqual(c.categories.map(x => x.assessmentType), ['assignment', 'lab work', 'quiz']);
  assert.equal(new Set(c.categories.flatMap(x => x.assessments.map(a => a.id))).size, 3);
});
test('3. numeric marks and complete normalized assessment', () => {
  assert.deepEqual(first(page()), { id: '["20263","CS2001","quiz",1]', assessmentNumber: 1, obtained: 8, total: 10, weightage: 2 });
});
test('4. decimal obtained, total, and weightage', () => {
  const a = first(page([course('CS2001', card('Quiz', row(1, '9.5', '12.5', '1.25')))]));
  assert.deepEqual([a.obtained, a.total, a.weightage], [9.5, 12.5, 1.25]);
});
test('5. dash is unreleased, not zero', () => {
  assert.equal(first(page([course('CS2001', card('Quiz', row(1, '-')))])).obtained, null);
});
test('6. empty course is retained', () => {
  const c = parseMarksHtml(page([course('EE1005', '')])).semester.courses[0];
  assert.equal(c.courseCode, 'EE1005');
  assert.deepEqual(c.categories, []);
});
test('7. totals in tbody and all footer rows are ignored', () => {
  const html = page([course('CS2001', card('Quiz', row() + '<tr><td>Total</td><td>99</td></tr>' + row('Total', '99'), `<tfoot>${row(99, '999')}</tfoot>`))]);
  assert.equal(parseMarksHtml(html).semester.courses[0].categories[0].assessments.length, 1);
});
test('8. selected semester ID/name and available options', () => {
  const s = parseMarksHtml(page());
  assert.equal(s.semester.id, '20263');
  assert.equal(s.semester.name, 'Fall 2026');
  assert.deepEqual(s.availableSemesters, [{ id: '20261', name: 'Spring 2026' }, { id: '20263', name: 'Fall 2026' }]);
});
test('9. dynamic discovery has no hardcoded course codes or CSS ID interpolation', () => {
  assert.equal(parseMarksHtml(page([course('NEW:987-X')])).semester.courses[0].courseCode, 'NEW:987-X');
});
test('blank and nonbreaking-space marks are null; zero is released', () => {
  for (const v of ['', '  ', '&nbsp;']) assert.equal(first(page([course('CS2001', card('Quiz', row(1, v)))])).obtained, null);
  assert.equal(first(page([course('CS2001', card('Quiz', row(1, '0')))])).obtained, 0);
});
test('class statistics do not affect normalized snapshot', () => {
  const html = page();
  const changed = html.replace('>6.25<', '>100<').replace('>0<', '>-50<').replace('MaxMarks">10', 'MaxMarks">999').replace('StdDev">1', 'StdDev">99');
  assert.deepEqual(parseMarksHtml(html), parseMarksHtml(changed));
});
test('identity is stable across row ordering, formatting, and category casing', () => {
  const a = page([course('CS2001', card('Quiz', row(2) + row(1)))]);
  const b = page([course('CS2001', card('  QUIZ  ', row('01') + row(2)))]);
  const assessments = html => parseMarksHtml(html).semester.courses[0].categories[0].assessments;
  assert.deepEqual(assessments(a), assessments(b));
});
test('semester, course, category, and number each contribute to identity', () => {
  const variants = [page(), page().replaceAll('20263', '20273'), page([course('MT1004')]), page([course('CS2001', card('Assignment'))]), page([course('CS2001', card('Quiz', row(2)))])];
  assert.equal(new Set(variants.map(html => first(html).id)).size, 5);
});
test('missing selected attribute follows first-option HTML default', () => {
  assert.equal(parseMarksHtml(page().replace(' selected', '')).semester.id, '20261');
});
test('ambiguous or missing semester data is rejected', () => {
  invalid(page().replace('<option value=', '<option selected value='));
  invalid(page().replace('id="SemId"', 'id="other"'));
  invalid(page([], '<option selected value="">Choose semester</option>'));
});
test('login, challenge, non-HTML, and empty pages fail closed', () => {
  for (const html of ['', null, 'error', '<html><title>Just a moment...</title></html>', '<form><input type="password"></form>', page() + '<input type="password">', page([])]) invalid(html);
});
test('malformed student numbers never silently become null or partial numbers', () => {
  for (const v of ['8oops', 'NaN', 'Infinity', '1,2', 'Pending']) invalid(page([course('CS2001', card('Quiz', row(1, v)))]));
  invalid(page([course('CS2001', card('Quiz', row(1, '8', '-')))]));
  invalid(page([course('CS2001', card('Quiz', row(1, '8', '10', '')))]));
});
test('missing semantic cells and category headers reject the whole snapshot', () => {
  invalid(page().replace('class="ObtMarks"', 'class="unknown"'));
  invalid(page().replace('class="card-header"', 'class="unknown"'));
});
test('duplicate assessments and courses are rejected', () => {
  invalid(page([course('CS2001', card('Quiz', row() + row()))]));
  invalid(page([course(), course()]));
});
test('invalid or absent assessment numbers are rejected', () => {
  for (const number of ['', 'Quiz 1', '1.5', '0', '9007199254740992']) invalid(page([course('CS2001', card('Quiz', row(number)))]));
});
test('missing panes and truncated HTML are rejected', () => {
  invalid(page().replace('href="#CS2001"', 'href="#MISSING"'));
  invalid(page().slice(0, page().indexOf('</tbody>')));
});
test('HTML entities decode and embedded scripts are not executed', () => {
  const html = page([course('CS2001', card('Lab&nbsp;Work', row(1, '<span>8.5</span>')))]) + '<script>throw new Error("Must not run")</script>';
  assert.equal(first(html).obtained, 8.5);
  assert.equal(parseMarksHtml(html).semester.courses[0].categories[0].assessmentType, 'lab work');
});
test('sanitized real FLEX structure: nine courses, fourteen assessments, three empty courses', () => {
  const html = readFileSync(new URL('./fixtures/flex-structure.html', import.meta.url), 'utf8');
  const snapshot = parseMarksHtml(html);
  assert.equal(snapshot.semester.id, '20263');
  assert.equal(snapshot.semester.courses.length, 9);
  assert.deepEqual(snapshot.semester.courses.filter(c => !c.categories.length).map(c => c.courseCode), ['EE1005', 'SS1019', 'SS1022']);
  const assessments = snapshot.semester.courses.flatMap(c => c.categories.flatMap(g => g.assessments));
  assert.equal(assessments.length, 14);
  assert.ok(assessments.every(a => a.obtained === 7.5 && a.total === 10 && a.weightage === 2.5));
  assert.equal(new Set(assessments.map(a => a.id)).size, 14);
});
