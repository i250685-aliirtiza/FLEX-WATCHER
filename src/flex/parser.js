import { parse } from 'parse5';

export class FlexParseError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FlexParseError';
    this.code = 'INVALID_MARKS_PAGE';
  }
}

const fail = (message) => { throw new FlexParseError(message); };
const attr = (node, name) => node.attrs?.find(a => a.name === name)?.value;
const hasClass = (node, name) => (attr(node, 'class') ?? '').split(/\s+/).includes(name);
const clean = (value) => value.replace(/\s+/g, ' ').trim();
const text = (node) => node?.nodeName === '#text' ? node.value
  : ['script', 'style', 'template'].includes(node?.tagName) ? ''
  : (node?.childNodes ?? []).map(text).join('');
const label = (node) => clean(text(node));
function all(node, predicate) {
  const result = [];
  for (const child of node.childNodes ?? []) {
    if (predicate(child)) result.push(child);
    result.push(...all(child, predicate));
  }
  return result;
}
function closest(node, predicate) {
  for (let current = node.parentNode; current; current = current.parentNode) {
    if (predicate(current)) return current;
  }
  return null;
}
const byClass = (root, name) => all(root, node => hasClass(node, name));
const byTag = (root, tag) => all(root, node => node.tagName === tag);
const sortBy = (items, key) => items.sort((a, b) => a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0);
function exactlyOne(nodes, description) {
  if (nodes.length !== 1) fail(`Expected exactly one ${description}; found ${nodes.length}.`);
  return nodes[0];
}
function closed(node, description) {
  if (!node.sourceCodeLocation?.endTag) fail(`Incomplete ${description}.`);
}
function numeric(row, className, nullable = false) {
  const value = label(exactlyOne(byClass(row, className), className));
  if (nullable && (value === '' || value === '-')) return null;
  // Do not use parseFloat: "8oops" must fail, not silently become 8.
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) fail(`Invalid ${className} value.`);
  const number = Number(value);
  if (!Number.isFinite(number)) fail(`Non-finite ${className} value.`);
  return number === 0 ? 0 : number;
}

/**
 * Pure HTML -> JSON-compatible snapshot. No DOMParser, window, Chrome APIs,
 * I/O, script execution, cookies, or network requests.
 * Throws FlexParseError on ambiguous/missing structure or invalid row values.
 * A page represents ONE selected semester; available options are metadata.
 */
export function parseMarksHtml(html) {
  if (typeof html !== 'string' || !html.trim()) fail('Expected a nonempty HTML string.');
  const document = parse(html, { sourceCodeLocationInfo: true });
  if (all(document, n => n.tagName === 'input' && attr(n, 'type')?.toLowerCase() === 'password').length) {
    fail('Login form found instead of a marks page.');
  }
  const select = exactlyOne(all(document, n => n.tagName === 'select' && attr(n, 'id') === 'SemId'), 'semester selector');
  closed(select, 'semester selector');
  const options = byTag(select, 'option');
  if (!options.length) fail('No semesters found.');
  const selected = options.filter(n => attr(n, 'selected') !== undefined);
  if (selected.length > 1) fail('Ambiguous selected semester.');
  const current = selected[0] ?? options[0];
  const availableSemesters = options.map(n => ({ id: clean(attr(n, 'value') ?? ''), name: label(n) }));
  if (availableSemesters.some(s => !s.id || !s.name) || new Set(availableSemesters.map(s => s.id)).size !== options.length) {
    fail('Missing or duplicate semester metadata.');
  }
  const semesterId = clean(attr(current, 'value'));
  const panes = byClass(document, 'tab-pane');
  const anchors = byTag(document, 'a');
  const tabs = anchors.filter(n => attr(n, 'role') === 'tab' || attr(n, 'data-toggle') === 'tab');
  for (const tab of tabs) {
    const href = attr(tab, 'href') ?? '';
    if (!href.startsWith('#') || !panes.some(n => attr(n, 'id') === href.slice(1))) {
      fail('Course tab has no matching pane.');
    }
  }
  if (!panes.length) fail('No course panes found; refusing an unverified empty page.');
  const courseIds = new Set();
  const courses = panes.map(pane => {
    closed(pane, 'course pane');
    const courseCode = clean(attr(pane, 'id') ?? '');
    if (!courseCode || courseIds.has(courseCode)) fail('Missing or duplicate course ID.');
    courseIds.add(courseCode);
    if (!anchors.some(n => attr(n, 'href') === `#${courseCode}`)) fail('Course pane has no matching tab.');
    const heading = all(pane, n => /^h[1-6]$/.test(n.tagName ?? '') &&
      !closest(n, p => hasClass(p, 'card')) && label(n).startsWith(`${courseCode}-`));
    const courseHeading = label(exactlyOne(heading, 'course heading'));
    const courseName = clean(courseHeading.slice(courseCode.length + 1));
    if (!courseName) fail('Missing course name.');
    const categories = new Map();
    for (const row of byClass(pane, 'calculationrow')) {
      if (row.tagName !== 'tr') fail('Assessment row is not a table row.');
      if (closest(row, n => n.tagName === 'tfoot' || n.tagName === 'thead')) continue;
      const cells = (row.childNodes ?? []).filter(n => n.tagName === 'td' || n.tagName === 'th');
      const rawNumber = label(cells[0]);
      if (/^(?:grand\s+total(?:\s+marks)?|total(?:\s+marks)?|subtotal)$/i.test(rawNumber)) continue;
      if (!/^\d+$/.test(rawNumber)) fail('Missing or invalid assessment number.');
      const assessmentNumber = Number(rawNumber);
      if (!Number.isSafeInteger(assessmentNumber) || assessmentNumber < 1) fail('Invalid assessment number.');
      const table = closest(row, n => n.tagName === 'table');
      const card = closest(row, n => hasClass(n, 'card'));
      if (!table || !card) fail('Assessment outside a category table.');
      closed(table, 'assessment table');
      closed(card, 'assessment card');
      const header = exactlyOne(byClass(card, 'card-header').filter(n => closest(n, p => hasClass(p, 'card')) === card), 'category header');
      const assessmentType = label(header);
      if (!assessmentType) fail('Missing assessment category.');
      // Case and whitespace differences do not create new assessment identities.
      const categoryKey = assessmentType.toLowerCase();
      if (!categories.has(categoryKey)) categories.set(categoryKey, { assessmentType: categoryKey, name: assessmentType, assessments: [] });
      const category = categories.get(categoryKey);
      if (category.assessments.some(a => a.assessmentNumber === assessmentNumber)) fail('Duplicate assessment identity.');
      category.assessments.push({
        // JSON tuple encoding is collision-safe even when category names contain separators.
        id: JSON.stringify([semesterId, courseCode, categoryKey, assessmentNumber]),
        assessmentNumber,
        obtained: numeric(row, 'ObtMarks', true),
        total: numeric(row, 'GrandTotal'),
        weightage: numeric(row, 'weightage'),
      });
    }
    const normalizedCategories = sortBy([...categories.values()], 'assessmentType');
    for (const category of normalizedCategories) sortBy(category.assessments, 'assessmentNumber');
    return { courseCode, name: courseName, categories: normalizedCategories };
  });
  return {
    schemaVersion: 1,
    semester: { id: semesterId, name: label(current), courses: sortBy(courses, 'courseCode') },
    availableSemesters,
  };
}
