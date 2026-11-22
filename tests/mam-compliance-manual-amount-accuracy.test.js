'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const XLSX = require(path.join(ROOT, 'xlsx.full.min.js'));
const studio = require(path.join(ROOT, 'mam-compliance-excel-studio.js'));

test('REVISED Sent Atpl-sep.xlsx computes exact 8857405 Manual Amount', () => {
  const sepPath = path.join(ROOT, 'data/sync/salary_files/salary_REVISED Sent Atpl-sep.xlsx.json');
  const emPath = path.join(ROOT, 'data/employee_master.json');
  const sep = JSON.parse(fs.readFileSync(sepPath, 'utf8'));
  const emps = JSON.parse(fs.readFileSync(emPath, 'utf8'));
  const wb = XLSX.read(Buffer.from(sep.original_b64, 'base64'), { type: 'buffer' });
  const wbMeta = (wb.Workbook && wb.Workbook.Sheets) || [];
  const sheets = wb.SheetNames.map((sn, idx) => ({
    name: sn,
    rows: studio.sheetToVisibleMatrix(XLSX, wb.Sheets[sn]),
    hidden: !!(wbMeta[idx] && wbMeta[idx].Hidden)
  }));
  const picked = studio.selectBestMamSheet(sheets, 'REVISED Sent Atpl-sep.xlsx');
  assert.equal(picked.name, 'Main Sheet');
  assert.equal(picked.rows.length, 484);
  const comp = studio.generateComplianceRows(picked.rows, emps, { settings: { month: '2026-09', monthDays: 30 } });
  const tot = studio.computeTotals(comp);
  assert.equal(tot.manualAmount, 8857405);
});

test('sheetToVisibleMatrix excludes hidden/filtered Excel rows while preserving legacy BIFF8 outline-hidden sheets', () => {
  const aoaMain = [
    ['Code', 'Card No. 1', 'Total'],
    ['00101', 'RAMESH KUMAR', 5000000],
    ['00102', 'SURESH SHARMA', 3850000],
    ['', 'Dharmendra', 7405], // real uncoded worker (must stay!)
    ['00103', 'HIDDEN LEFT WORKER', 3000], // hidden/filtered row in Excel (must be excluded!)
    ['', 'Card 1 Total', 8857405],
    ['', 'Grand Total', 8857405],
    ['', 'Advance Cash Note', 3000] // post-Grand-Total note (must be excluded!)
  ];
  const wsMain = XLSX.utils.aoa_to_sheet(aoaMain);
  wsMain['!rows'] = [
    undefined,
    undefined,
    undefined,
    undefined,
    { hidden: true } // row index 4 (00103) hidden in Excel
  ];
  const visibleMatrix = studio.sheetToVisibleMatrix(XLSX, wsMain);
  const parsed = studio.parseMamMatrix(visibleMatrix, 'Sheet1', 'SEP_MAM_2026.xlsx');
  assert.equal(parsed.length, 3);
  const comp = studio.generateComplianceRows(parsed, [], { settings: { month: '2026-09', monthDays: 30 } });
  assert.equal(studio.computeTotals(comp).manualAmount, 8857405);

  // Legacy BIFF8 outline-grouped sheet where >50% of rows carry hidden:true must preserve all rows
  const wsLegacy = XLSX.utils.aoa_to_sheet([
    ['Code', 'Name', 'Total'],
    ['00101', 'EMP A', 10000],
    ['00102', 'EMP B', 20000],
    ['00103', 'EMP C', 30000]
  ]);
  wsLegacy['!rows'] = [
    undefined,
    { hidden: true },
    { hidden: true },
    { hidden: true }
  ];
  const legacyMatrix = studio.sheetToVisibleMatrix(XLSX, wsLegacy);
  const parsedLegacy = studio.parseMamMatrix(legacyMatrix, 'Fourmala Sheet', 'LEGACY.xls');
  assert.equal(parsedLegacy.length, 3);
  assert.equal(parsedLegacy.reduce((a, b) => a + b.manualAmount, 0), 60000);
});

test('Excludes hidden sheets and secondary sheets via .xlsx Workbook metadata', () => {
  const wsMain = XLSX.utils.aoa_to_sheet([
    ['Code', 'Card No. 1', 'Total'],
    ['00101', 'RAMESH KUMAR', 5000000],
    ['00102', 'SURESH SHARMA', 3850000],
    ['', 'Dharmendra', 7405],
    ['', 'Grand Total', 8857405],
    ['', 'Advance Cash Note', 3000]
  ]);
  const wsBackup = XLSX.utils.aoa_to_sheet([
    ['Code', 'Card No. 1', 'Total'],
    ['00101', 'RAMESH KUMAR', 5000000],
    ['00102', 'SURESH SHARMA', 3850000],
    ['', 'Dharmendra', 7405],
    ['00103', 'EXTRA ROW', 3000],
    ['00104', 'ANOTHER', 0]
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, wsMain, 'Sheet1');
  XLSX.utils.book_append_sheet(wb, wsBackup, 'Sheet2');
  wb.Workbook = {
    Sheets: [
      { name: 'Sheet1', Hidden: 0 },
      { name: 'Sheet2', Hidden: 1 }
    ]
  };
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const reparsed = XLSX.read(buf, { type: 'buffer' });
  const wbMeta = (reparsed.Workbook && reparsed.Workbook.Sheets) || [];
  const sheets = reparsed.SheetNames.map((sn, idx) => ({
    name: sn,
    rows: studio.sheetToVisibleMatrix(XLSX, reparsed.Sheets[sn]),
    hidden: !!(wbMeta[idx] && wbMeta[idx].Hidden)
  }));
  const picked = studio.selectBestMamSheet(sheets, 'SEP_MAM_2026.xlsx');
  assert.equal(picked.name, 'Sheet1');
  assert.equal(picked.rows.length, 3);
  const comp = studio.generateComplianceRows(picked.rows, [], { settings: { month: '2026-09', monthDays: 30 } });
  assert.equal(studio.computeTotals(comp).manualAmount, 8857405);
});

test('Prioritizes explicit Manual Amount column over left-side Amount/Total/Salary columns and filters non-employee labels/phrases', () => {
  const rows = [
    ['Code', 'Name', 'Salary', 'Total', 'Manual Amount'],
    ['00101', 'EMP ONE', 10000, 12000, 15000],
    ['00102', 'EMP TWO', 10000, 12000, 20000],
    ['', 'Advance Cash Note', 0, 0, 3000],
    ['', 'Cash Pending', 0, 0, 1500],
    ['', 'Chai Kharcha', 0, 0, 500],
    ['', 'Advance', 0, 0, 3000],
    ['', '123', 0, 0, 3000],
    ['', 'G Total', 20000, 24000, 35000]
  ];
  const parsed = studio.parseMamMatrix(rows, 'Sheet1', 'SEP_MAM.xlsx');
  assert.equal(parsed.length, 2);
  assert.equal(parsed.reduce((a, b) => a + b.manualAmount, 0), 35000);
});

test('Skips unlabeled footer Grand Total + post-total rows while preserving multi-section coded rows after section subtotals', () => {
  const rows = [
    ['Code', 'Card No. 1', 'Total'],
    ['00101', 'WORKER A', 20000],
    ['00102', 'WORKER B', 30000],
    ['', '', 50000], // mid-sheet section subtotal (more coded rows follow!)
    ['Code', 'Card No. 2', 'Total'],
    ['00103', 'WORKER C', 10000],
    ['00104', 'WORKER D', 15000],
    ['00105', 'WORKER E', 25000],
    ['', '', 100000], // final unlabeled Grand Total (matches running sum 100000, no coded rows follow)
    ['', 'Cash Pending', 3000],
    ['', 'Chai Kharcha', 500]
  ];
  const parsed = studio.parseMamMatrix(rows, 'Sheet1', 'SEP_MAM.xlsx');
  assert.equal(parsed.length, 5);
  assert.equal(parsed.reduce((a, b) => a + b.manualAmount, 0), 100000);
});
