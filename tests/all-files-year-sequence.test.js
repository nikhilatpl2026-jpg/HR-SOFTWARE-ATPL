const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('All Saved Files Year filter, 12-month sequence strip, and chronological sorting regardless of upload order', () => {
  const startMarker = '// ALL FILES PAGE (LAZY LOADED, YEAR FILTER & MONTH SEQUENCE)';
  const endMarker = '// INLINE VIEWER - view + edit cells directly';
  const sIdx = indexHtml.indexOf(startMarker);
  const eIdx = indexHtml.indexOf(endMarker, sIdx);
  assert.ok(sIdx >= 0 && eIdx > sIdx, 'All Files JS block must exist');
  const code = indexHtml.slice(sIdx, eIdx);

  const makeEl = (id, tag = 'div') => ({
    id,
    tagName: tag.toUpperCase(),
    value: tag === 'select' ? 'ALL' : '',
    innerHTML: '',
    textContent: '',
    style: {},
    classList: { contains: (c) => c === 'active' },
    focus() {},
    scrollIntoView() {}
  });

  const els = {
    'page-files': makeEl('page-files'),
    allFilesArea: makeEl('allFilesArea'),
    allFilesYearFilter: makeEl('allFilesYearFilter', 'select'),
    allFilesSortMode: makeEl('allFilesSortMode', 'select'),
    allFilesSearchInput: makeEl('allFilesSearchInput', 'input'),
    allFilesSearchClearBtn: makeEl('allFilesSearchClearBtn', 'button'),
    allFilesSearchCount: makeEl('allFilesSearchCount'),
    allFilesNoMatch: makeEl('allFilesNoMatch')
  };

  // Deliberately out-of-order upload timestamps (all uploaded in Nov 2026)
  const sampleFiles = [
    { name: '01-ARORA TEXTILES PVT. LTD. MAY-25 DUGAR JI (1).xlsx', savedAt: '2026-11-20T12:41:38Z', sheets: { 'STAFF WAGES MAY-25': [['A'], ['B']] } },
    { name: '01-ARORA TEXTILES PVT. LTD. Feb-25 (3).xls', savedAt: '2026-11-20T12:41:33Z', sheets: { ATTENDANCE: [['A'], ['B']] } },
    { name: 'March 2026 Salary.xlsx', savedAt: '2026-11-20T12:41:31Z', sheets: { Sheet1: [['A'], ['B']] } },
    { name: 'ATPL- SALARY SHEET MARCH 2025 (1).xls', savedAt: '2026-11-20T12:41:29Z', sheets: { Salary: [['A'], ['B']] } },
    { name: 'Salary Sheet June-', savedAt: '2026-11-20T12:41:25Z', sheets: { 'June 2025 Summary': [['A'], ['B']] } }
  ];

  const sandbox = {
    window: {},
    document: {
      getElementById: (id) => els[id] || null,
      querySelectorAll: () => []
    },
    getAllLoadedSalaryFiles: () => sampleFiles,
    safeGetSheetNames: (f) => Object.keys(f.sheets || {}),
    safeGetWorkbookRows: (f) => Object.values(f.sheets || {}).reduce((a, b) => a + b.length, 0),
    esc: (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
    setTimeout: () => {},
    console,
    Array,
    Object,
    String,
    Number,
    Date,
    RegExp
  };
  sandbox.window = sandbox;
  vm.runInNewContext(code, sandbox);

  // Verify smart period detection
  const pMay = sandbox.extractAllFilesPeriod(sampleFiles[0], 0);
  const pFeb = sandbox.extractAllFilesPeriod(sampleFiles[1], 1);
  const pMar26 = sandbox.extractAllFilesPeriod(sampleFiles[2], 2);
  const pMar25 = sandbox.extractAllFilesPeriod(sampleFiles[3], 3);
  const pJun25 = sandbox.extractAllFilesPeriod(sampleFiles[4], 4);

  assert.equal(pMay.year, 2025); assert.equal(pMay.month, 5);
  assert.equal(pFeb.year, 2025); assert.equal(pFeb.month, 2);
  assert.equal(pMar26.year, 2026); assert.equal(pMar26.month, 3);
  assert.equal(pMar25.year, 2025); assert.equal(pMar25.month, 3);
  assert.equal(pJun25.year, 2025); assert.equal(pJun25.month, 6);

  // Filter to Year 2025 and verify Jan -> Dec sequence & top overview
  sandbox.setAllFilesYearFilter('2025');
  const out = els.allFilesArea.innerHTML;

  assert.ok(out.includes('id="allFilesYearOverview"'), 'Must render top Year Overview card');
  assert.ok(out.includes('2025 — Uploaded Files'), 'Must show 2025 uploaded files heading');
  assert.ok(out.includes('✓ Feb <span style="opacity:0.8">(1)</span>'), '12-month strip must highlight Feb');
  assert.ok(out.includes('✓ Mar <span style="opacity:0.8">(1)</span>'), '12-month strip must highlight Mar');
  assert.ok(out.includes('✓ May <span style="opacity:0.8">(1)</span>'), '12-month strip must highlight May');
  assert.ok(out.includes('✓ Jun <span style="opacity:0.8">(1)</span>'), '12-month strip must highlight Jun');
  assert.ok(!out.includes('March 2026 Salary.xlsx'), '2026 file must be filtered out when 2025 is selected');

  // Verify chronological month order in rendered cards: Feb-25 (origIdx 1) -> MARCH 2025 (origIdx 3) -> MAY-25 (origIdx 0) -> June (origIdx 4)
  const posFeb = out.indexOf('id="all-files-card-1"');
  const posMar = out.indexOf('id="all-files-card-3"');
  const posMay = out.indexOf('id="all-files-card-0"');
  const posJun = out.indexOf('id="all-files-card-4"');
  assert.ok(posFeb > 0 && posFeb < posMar && posMar < posMay && posMay < posJun, '2025 files must appear in exact Feb -> Mar -> May -> Jun sequence');

  // Verify original array indices are preserved for openInlineViewer and rmFile
  assert.ok(out.includes('openInlineViewer(1,0)'), 'Feb-25 card must pass origIdx 1');
  assert.ok(out.includes('rmFile(0)'), 'MAY-25 card must pass origIdx 0');
});
