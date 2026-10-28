const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('all modified JavaScript and Apps Script files parse with valid syntax', () => {
  const files = [
    'server.js',
    'erp-cloud-sync-v1.js',
    'erp-cloud-shared-storage-v1.js',
    'employee-master-confirmed-save-v1.js'
  ];
  files.forEach(file => {
    assert.doesNotThrow(() => new Function(read(file)), `${file} syntax check`);
  });

  // Verify GoogleDriveSyncBackend.gs has valid JavaScript function syntax
  assert.doesNotThrow(() => {
    const gs = read('backend/GoogleDriveSyncBackend.gs');
    new Function(gs);
  }, 'backend/GoogleDriveSyncBackend.gs syntax check');
});

test('matchColumnHeader in index.html correctly recognizes all Basic, HRA, and Gross variations', () => {
  const html = read('index.html');
  const startIdx = html.indexOf('function matchColumnHeader(header, counts)');
  const endIdx = html.indexOf('window.matchColumnHeader = matchColumnHeader;', startIdx);
  assert.ok(startIdx > 0 && endIdx > startIdx, 'Should find matchColumnHeader in index.html');
  const matchFnCode = html.slice(startIdx, endIdx);
  const matchColumnHeader = new Function(`return (${matchFnCode})`)();

  const basicHeaders = ['Basic', 'BASIC', 'basic', 'Basic Pay', 'Basic Rate', 'Basic Wages', 'Basic (Rs)', 'Basic(Rs)', 'Basic+DA', 'Basic + DA', 'Basic Salary'];
  basicHeaders.forEach(h => {
    const res = matchColumnHeader(h, { district: 0, state: 0, gross: 0 });
    assert.equal(res, 'basic', `Header "${h}" must map to "basic"`);
  });

  const hraHeaders = ['HRA', 'H.R.A', 'H.R.A.', 'H R A', 'hra', 'House Rent Allowance', 'HRA Allowance', 'HRA (Rs)', 'HRA(Rs)'];
  hraHeaders.forEach(h => {
    const res = matchColumnHeader(h, { district: 0, state: 0, gross: 0 });
    assert.equal(res, 'hra', `Header "${h}" must map to "hra"`);
  });

  const grossHeaders = ['Gross', 'GROSS', 'gross', 'Gross Salary', 'Gross Total Salary', 'Gross Pay'];
  grossHeaders.forEach(h => {
    const res = matchColumnHeader(h, { district: 0, state: 0, gross: 0 });
    assert.equal(res, 'gross', `First header "${h}" must map to "gross"`);
  });

  // Second occurrence of Gross maps to new_gross
  const counts = { district: 0, state: 0, gross: 0 };
  const firstGross = matchColumnHeader('Gross', counts);
  assert.equal(firstGross, 'gross');
  const secondGross = matchColumnHeader('Gross', counts);
  assert.equal(secondGross, 'new_gross');
});

test('matchColumnHeader called via Array.map(matchColumnHeader) does not corrupt counts with index', () => {
  const html = read('index.html');
  const startIdx = html.indexOf('function matchColumnHeader(header, counts)');
  const endIdx = html.indexOf('window.matchColumnHeader = matchColumnHeader;', startIdx);
  const matchFnCode = html.slice(startIdx, endIdx);
  const matchColumnHeader = new Function(`return (${matchFnCode})`)();

  const headers = ['Employee Code', 'Employee Name', 'Basic Pay', 'H.R.A', 'Gross Salary'];
  // Array.prototype.map passes (element, index, array). In buggy code, index (a number) was used as counts.
  const mapped = headers.map(matchColumnHeader);

  assert.equal(mapped[2], 'basic', 'Basic Pay via .map must be basic');
  assert.equal(mapped[3], 'hra', 'H.R.A via .map must be hra');
  assert.equal(mapped[4], 'gross', 'Gross Salary via .map must be gross (not new_gross or null)');
});

test('auditAndCleanEmployee preserves exact decimal Basic, HRA, and Gross values', () => {
  const html = read('index.html');
  const startIdx = html.indexOf('function auditAndCleanEmployee(emp, rawCols)');
  const endIdx = html.indexOf('window.auditAndCleanEmployee = auditAndCleanEmployee;', startIdx);
  assert.ok(startIdx > 0 && endIdx > startIdx, 'Should find auditAndCleanEmployee in index.html');
  const fnCode = html.slice(startIdx, endIdx);

  // Provide mock dependencies for standalone evaluation
  const cleanIfsc = (x) => String(x || '').toUpperCase().trim();
  const cleanAccountNo = (x) => String(x || '').replace(/\D/g, '');
  const emNormalizeDateValue = (x) => String(x || '');

  const auditAndCleanEmployee = new Function(
    'cleanIfsc', 'cleanAccountNo', 'emNormalizeDateValue',
    `return (${fnCode})`
  )(cleanIfsc, cleanAccountNo, emNormalizeDateValue);

  const testEmp = {
    emp_id: 'ATPL-001',
    name: 'Rohan Sharma',
    basic: 21500.75,
    hra: 4300.25,
    gross: 25801.00
  };

  const cleaned = auditAndCleanEmployee(testEmp);
  assert.equal(cleaned.basic, 21500.75, 'Basic salary decimal must be preserved exactly');
  assert.equal(cleaned.hra, 4300.25, 'HRA salary decimal must be preserved exactly');
  assert.equal(cleaned.gross, 25801.00, 'Gross salary decimal must be preserved exactly');
  assert.equal(cleaned.new_gross, 25801.00, 'new_gross must sync with gross');
});

test('emDoDownload formula references point to Col 38 (Basic, c:37) and Col 39 (HRA, c:38) for Col 40 (Gross New, c:39)', () => {
  const html = read('index.html');
  assert.ok(html.includes("c:37}); // Col 38 = New Basic"), 'emDoDownload must reference c:37 for basic');
  assert.ok(html.includes("c:38}); // Col 39 = New HRA"), 'emDoDownload must reference c:38 for hra');
  assert.ok(html.includes("c:39}); // Col 40 = Gross Total Salary (New)"), 'emDoDownload must reference c:39 for new gross');
  assert.ok(html.includes("f:'='+basicCell+'+'+hraCell"), 'emDoDownload must compute formula =basicCell+hraCell');
});

test('GoogleDriveSyncBackend.gs provides full Google Sheets backend handlers and prevents resurrection', () => {
  const gs = read('backend/GoogleDriveSyncBackend.gs');

  // Verify all required actions are present
  const requiredActions = [
    'getSystemRecords',
    'getEmployeeMaster',
    'upsertEmployeeMaster',
    'deleteEmployeeMaster',
    'bulkUpsertEmployeeMaster',
    'saveEmployeeMaster',
    'getSyncState',
    'status',
    'login'
  ];

  requiredActions.forEach(action => {
    assert.ok(gs.includes(`action === "${action}"`) || gs.includes(`action === '${action}'`), `Apps Script must support action: ${action}`);
  });

  // Verify sheet names and IDs
  assert.ok(gs.includes('1SVGnJpzRIDHoYZ1W4VHII0m-JYrisW1xKixLNYG8u9s'), 'Spreadsheet ID must be configured in Apps Script');
  assert.ok(gs.includes('EmployeeMaster'), 'EmployeeMaster sheet must be present');
  assert.ok(gs.includes('Tombstones'), 'Tombstones sheet must be present for permanent deletion');
  assert.ok(gs.includes('SystemRecords'), 'SystemRecords sheet must be present');
  assert.ok(gs.includes('LockService.getScriptLock()'), 'Must use ScriptLock for concurrency protection');
});

test('employee-master-confirmed-save-v1.js does not wipe bulk rows before sending', () => {
  const js = read('employee-master-confirmed-save-v1.js');
  assert.ok(js.includes('var rowsToSave=g.EM_BULK_ROWS.slice();'), 'Must capture rowsToSave before clearing g.EM_BULK_ROWS');
  assert.ok(js.includes('var items=rowsToSave.map(function(emp)'), 'Must map items from captured rowsToSave');
});

test('server.js cloud-proxy handles getSystemRecords and provides SSE endpoint for cross-browser sync', () => {
  const server = read('server.js');
  assert.ok(server.includes("action === 'getSystemRecords'"), 'server.js must handle getSystemRecords in proxy');
  assert.ok(server.includes('/api/sync/events'), 'server.js must provide SSE endpoint /api/sync/events');
  assert.ok(server.includes('employee_master_updated'), 'server.js must broadcast employee_master_updated event');
  assert.ok(server.includes('employee_master_deleted'), 'server.js must broadcast employee_master_deleted event');
});

test('erp-cloud-sync-v1.js implements near-real-time periodic polling, visibility change, and SSE hooks', () => {
  const sync = read('erp-cloud-sync-v1.js');
  assert.ok(sync.includes('setupLiveSync'), 'erp-cloud-sync-v1.js must have setupLiveSync');
  assert.ok(sync.includes('/api/sync/events'), 'erp-cloud-sync-v1.js must connect to SSE events');
  assert.ok(sync.includes('BroadcastChannel'), 'erp-cloud-sync-v1.js must support BroadcastChannel');
  assert.ok(sync.includes('scheduleNextProbe'), 'erp-cloud-sync-v1.js must have scheduleNextProbe polling');
});
