import { parse } from 'parse5';

const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const attr = (node, name) => node.attrs?.find(a => a.name === name)?.value;
const text = node => node?.nodeName === '#text' ? node.value : ['script','style','template'].includes(node?.tagName) ? '' : (node?.childNodes ?? []).map(text).join('');
function all(node, predicate) { const out=[]; for (const child of node.childNodes ?? []) { if (predicate(child)) out.push(child); out.push(...all(child,predicate)); } return out; }
const cells = row => (row.childNodes ?? []).filter(n => n.tagName === 'td' || n.tagName === 'th');

export function parseTranscriptHtml(html, { currentSemester } = {}) {
  if (typeof html !== 'string' || !html.trim()) throw Object.assign(new Error('Empty transcript HTML.'), { code: 'INVALID_TRANSCRIPT' });
  const document = parse(html, { sourceCodeLocationInfo: true });
  const tables = all(document, n => n.tagName === 'table');
  const semesters = [];
  for (const table of tables) {
    const headers = cells(all(table, n => n.tagName === 'tr')[0] ?? {}).map(n => clean(text(n)).toLowerCase());
    if (!headers.includes('code') || !headers.includes('grade')) continue;
    const codeIndex=headers.indexOf('code'), nameIndex=headers.indexOf('course name'), gradeIndex=headers.indexOf('grade'), pointsIndex=headers.indexOf('points'), termNode = (() => { let n=table.parentNode; while(n){ const hs=all(n, x=>/^h[1-6]$/.test(x.tagName ?? '')); if(hs.length) return hs[hs.length-1]; n=n.parentNode; } return null; })();
    const priorHeaders = all(document, n => /^h[1-6]$/.test(n.tagName ?? '') && n.sourceCodeLocation?.startTag?.startLine <= table.sourceCodeLocation?.startTag?.startLine); const term=clean(text(priorHeaders[priorHeaders.length - 1])) || 'Unknown semester';
    const courses=[];
    for (const row of all(table, n => n.tagName === 'tr').slice(1)) { const c=cells(row); if(c.length <= Math.max(codeIndex,gradeIndex)) continue; const code=clean(text(c[codeIndex])); if(!/^[A-Za-z]{2,}\d{3,}$/.test(code)) continue; courses.push({ code, name: clean(text(c[nameIndex])), grade: clean(text(c[gradeIndex])) || 'I', points: pointsIndex >= 0 ? clean(text(c[pointsIndex])) : '' }); }
    if (courses.length) semesters.push({ term, courses });
  }
  if (!semesters.length) throw Object.assign(new Error('No transcript grade tables found.'), { code: 'INVALID_TRANSCRIPT' });
  const selected = currentSemester ? semesters.filter(s => s.term.toLowerCase().includes(String(currentSemester).toLowerCase())) : semesters;
  return { schemaVersion: 1, semesters: selected.length ? selected : semesters };
}

export function diffTranscript(previous, current) {
  const before = new Map((previous?.semesters ?? []).flatMap(s => s.courses.map(c => [`${s.term}|${c.code}`, {...c, term:s.term}])));
  const changes=[];
  for (const semester of current.semesters ?? []) for (const course of semester.courses) { const key=`${semester.term}|${course.code}`, old=before.get(key); if (!old || old.grade !== course.grade || old.points !== course.points) changes.push({ term: semester.term, old: old ?? null, now: course }); }
  return changes;
}
