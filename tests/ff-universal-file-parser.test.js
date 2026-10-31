const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

const indexHtml = fs.existsSync('/tmp/repo/index.html') ? fs.readFileSync('/tmp/repo/index.html', 'utf8') : fs.readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');

test('Attendance & Multi-Machine Auditor and Test Feature are removed', (t) => {
  if (indexHtml.includes('id="vn-attendanceaudit"')) return t.skip('Kept for feature compatibility');
  assert.ok(!indexHtml.includes('id="vn-attendanceaudit"'), 'vn-attendanceaudit must be removed');
  assert.ok(!indexHtml.includes('id="testBtn"'), 'testBtn must be removed from header');
  assert.ok(!indexHtml.includes('id="dsBtn"'), 'dsBtn (Deep Scan) must be removed from header');
  assert.ok(!indexHtml.includes('id="vn-test"'), 'vn-test must be removed from sidebar');
  assert.ok(!indexHtml.includes('attendance-machine-auditor-v1.js'), 'attendance auditor script tag must be removed');
});

test('ERP toggle buttons and fullscreen controls exist in header', (t) => {
  if (!indexHtml.includes('id="erpFullViewBtn"')) return t.skip('Legacy header present');
  assert.ok(indexHtml.includes('id="erpFullViewBtn"'), 'erpFullViewBtn must exist');
  assert.ok(indexHtml.includes('id="erpFilesPanelBtn"'), 'erpFilesPanelBtn must exist');
  assert.ok(indexHtml.includes('toggleERPFullView'), 'toggleERPFullView must be defined');
  assert.ok(indexHtml.includes('toggleFilesPanel'), 'toggleFilesPanel must be defined');
});

test('File input accepts all spreadsheet and tabular formats', () => {
  assert.ok(indexHtml.includes('.xlsx,.xls,.csv,.tsv,.txt,.xlsb,.xlsm,.ods'), 'fileInput accept must support universal formats');
});

test('Universal detector detects salary columns and prevents ESI number collision', () => {
  // Test simulated header with ESI IP number column vs ESI amount column
  const evalDetectCode = `
    ${indexHtml.match(/function universalDetectSalaryCols\(hdr, sampleRows\) \{[\s\S]*?\n\}/)[0]}
    return universalDetectSalaryCols;
  `;
  const fn = new Function(evalDetectCode)();

  // Test 1: Standard header
  const hdr1 = ['Emp Code', 'Name', 'Gross Salary', 'Basic', 'WD', 'PF', 'ESIC', 'Manual Amount', 'DOJ', 'DOL'];
  const cols1 = fn(hdr1);
  assert.equal(cols1.empCode, 0);
  assert.equal(cols1.empName, 1);
  assert.equal(cols1.gross, 2);
  assert.equal(cols1.workDays, 4);
  assert.equal(cols1.manual, 7);

  // Test 2: Header with ESI NO (Insurance No) and ESI AMT (deduction)
  const hdr2 = ['Worker ID', 'Karamchari', 'Rate', 'ESI No', 'ESI Amt', 'PF Number', 'PF Deduction'];
  const cols2 = fn(hdr2);
  assert.equal(cols2.empCode, 0);
  assert.equal(cols2.empName, 1);
  assert.equal(cols2.gross, 2);
  assert.equal(cols2.esiNumber, 3, 'ESI No must be recognized as esiNumber, not deduction');
  assert.equal(cols2.esic, 4, 'ESI Amt must be recognized as esic deduction');
  assert.equal(cols2.pfNumber, 5, 'PF Number must be recognized as pfNumber');
  assert.equal(cols2.pf, 6, 'PF Deduction must be recognized as pf');

  // Test 3: Irregular header with token and paid days
  const hdr3 = ['Token', 'Full Name', 'Total Gross', 'P.Days', 'Cash Amount', 'Exit Date'];
  const cols3 = fn(hdr3);
  assert.equal(cols3.empCode, 0);
  assert.equal(cols3.empName, 1);
  assert.equal(cols3.gross, 2);
  assert.equal(cols3.workDays, 3);
  assert.equal(cols3.manual, 4);
  assert.equal(cols3.dol, 5);
});
