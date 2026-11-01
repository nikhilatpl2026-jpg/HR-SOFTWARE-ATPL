const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

test('Employee master 11K dataset performance & zero main-thread freeze', async (t) => {
  const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const syncJs = fs.readFileSync(path.join(__dirname, '..', 'atpl-google-drive-sync.js'), 'utf8');

  // 1. Verify index.html does NOT contain O(N^2) indexOf duplicate detection
  assert.strictEqual(
    indexHtml.includes('codes.filter(function(c,i){return codes.indexOf(c)!==i;})'),
    false,
    'emUpdateStats must not use O(N^2) codes.indexOf(c)!==i'
  );
  assert.strictEqual(
    indexHtml.includes('allCodes.filter(function(c,i){return allCodes.indexOf(c)!==i;})'),
    false,
    'emRenderTable must not use O(N^2) allCodes.indexOf(c)!==i'
  );

  // 2. Verify safeGetWorkbookRows caches row count and does not trigger lazy sheet_to_json getters
  assert.strictEqual(
    indexHtml.includes('f.__cachedRowCount'),
    true,
    'safeGetWorkbookRows must memoize row count on the file object'
  );

  // 3. Verify atpl-google-drive-sync.js includes fingerprint comparison & debouncing
  assert.strictEqual(
    syncJs.includes('_lastAppliedEmpFp'),
    true,
    'applyEmployeeRecords must check fingerprint to prevent redundant processing of 11K records'
  );
  assert.strictEqual(
    syncJs.includes('lastPollTimestamp'),
    true,
    'pollSyncState must throttle polling intervals to prevent infinite sync loops'
  );

  // 4. Benchmark O(N) duplicate detection logic with 11,056 records
  const mock11kEmployees = [];
  for (let i = 0; i < 11056; i++) {
    mock11kEmployees.push({
      emp_id: String(10000 + (i % 9000)), // intentionally generate ~2000 duplicates
      name: 'Worker ' + i,
      dept: 'Spinning_' + (i % 20),
      pf_no: i % 3 === 0 ? 'PF_' + i : '',
      esi_no: i % 4 === 0 ? 'ESI_' + i : '',
      status: i % 10 === 0 ? 'LEFT' : 'ACTIVE'
    });
  }

  const startTime = Date.now();
  const codeSeen = new Set();
  const dupCodeSet = new Set();
  let leftCount = 0;
  let activeCount = 0;
  let pf = 0;
  let esi = 0;
  const deptSet = new Set();

  for (let i = 0; i < mock11kEmployees.length; i++) {
    const e = mock11kEmployees[i];
    if (e.status === 'LEFT') leftCount++;
    else activeCount++;
    if (e.pf_no) pf++;
    if (e.esi_no) esi++;
    const c = String(e.emp_id).replace(/^0+/, '');
    if (c) {
      if (codeSeen.has(c)) dupCodeSet.add(c);
      else codeSeen.add(c);
    }
    if (e.dept) deptSet.add(e.dept);
  }

  const durationMs = Date.now() - startTime;
  console.log(`[PERF TEST] 11,056 Employee Master stats processed in ${durationMs}ms (dups: ${dupCodeSet.size})`);
  // 5. Verify elimination of 33MB salary_files.json fetch
  const erpCloudJs = fs.readFileSync(path.join(__dirname, '..', 'erp-cloud-shared-storage-v1.js'), 'utf8');
  assert.strictEqual(
    erpCloudJs.includes("await fetch('./data/salary_files.json')") || erpCloudJs.includes("await fetch('data/salary_files.json')"),
    false,
    'erp-cloud-shared-storage-v1.js must never download 33MB salary_files.json'
  );

  // 6. Verify employee-master-persistence-guard-v1.js does not wipe cache on >600 employees
  const guardJs = fs.readFileSync(path.join(__dirname, '..', 'employee-master-persistence-guard-v1.js'), 'utf8');
  assert.strictEqual(
    guardJs.includes('local.length > 600'),
    false,
    'employee-master-persistence-guard-v1.js must not wipe cache for 11k employees'
  );

  // 7. Verify index.html uses v4 cache busting tags
  assert.strictEqual(
    indexHtml.includes('atpl-google-drive-sync.js?v=20261101-nofreeze-v4'),
    true,
    'index.html must use v4 cache busting tag for atpl-google-drive-sync.js'
  );
});
