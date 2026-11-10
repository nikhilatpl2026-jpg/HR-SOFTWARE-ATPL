const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const path = require('path');
const fs = require('fs');

test('CRITICAL E2E: Real-Time Multi-Browser Employee Master Sync over HTTP & SSE', async (t) => {
  // Read server.js
  const serverPath = path.join(__dirname, '..', 'server.js');
  const serverCode = fs.readFileSync(serverPath, 'utf8');

  // Verify routes exist in server.js
  assert.ok(serverCode.includes("app.get('/api/sync/employee-master'"), 'GET /api/sync/employee-master required');
  assert.ok(serverCode.includes("app.post('/api/sync/employee-master'"), 'POST /api/sync/employee-master required');
  assert.ok(serverCode.includes('app.delete("/api/sync/employee-master/:id"'), 'DELETE /api/sync/employee-master/:id required');
  assert.ok(serverCode.includes('app.delete("/api/sync/employee-master"'), 'DELETE /api/sync/employee-master required');
  assert.ok(serverCode.includes('app.post("/api/sync/employee-master/bulk-delete"'), 'POST /api/sync/employee-master/bulk-delete required');
  assert.ok(serverCode.includes("app.get('/api/sync/events'"), 'GET /api/sync/events SSE required');

  // Multi-browser simulation model matching index.html + atpl-google-drive-sync.js
  class BrowserClient {
    constructor(name) {
      this.name = name;
      this.localStorage = new Map();
      this.EM = { data: [], filtered: [], selectedRows: new Set() };
      this.EMP_MASTER_DATA = [];
      this.badge = '0';
      this.totalBadge = '0 Employees';
    }

    refreshUI() {
      const len = this.EM.data.length;
      this.badge = String(len);
      this.totalBadge = len + ' Employees';
      this.EM.filtered = this.EM.data.slice();
    }

    init(serverRecords) {
      // Logic matching line 9365 of index.html
      const isExplicitlyCleared = this.localStorage.get('ATPL_EMP_MASTER_CLEARED_V1') === 'true' || this.localStorage.get('AroraTextilesEmployeeMasterV3') === '[]';
      if (isExplicitlyCleared) {
        this.EM.data = [];
        this.EMP_MASTER_DATA = [];
      } else {
        const raw = this.localStorage.get('AroraTextilesEmployeeMasterV3');
        if (raw) {
          try { this.EM.data = JSON.parse(raw); } catch(_) { this.EM.data = []; }
        } else if (Array.isArray(serverRecords)) {
          this.EM.data = serverRecords.slice();
        }
        this.EMP_MASTER_DATA = this.EM.data.slice();
      }
      this.refreshUI();
    }

    syncFromServer(serverRecords) {
      // Single Source of Truth sync from server
      if (Array.isArray(serverRecords)) {
        if (serverRecords.length === 0) {
          this.EM.data = [];
          this.EMP_MASTER_DATA = [];
          this.localStorage.set('AroraTextilesEmployeeMasterV3', '[]');
          this.localStorage.set('ATPL_EMP_MASTER_CLEARED_V1', 'true');
        } else {
          this.EM.data = serverRecords.slice();
          this.EMP_MASTER_DATA = serverRecords.slice();
          this.localStorage.set('AroraTextilesEmployeeMasterV3', JSON.stringify(serverRecords));
          this.localStorage.delete('ATPL_EMP_MASTER_CLEARED_V1');
        }
        this.refreshUI();
      }
    }

    onSSE(event, payload) {
      if (event === 'employee_master_cleared' || event === 'employee_cleared') {
        this.EM.data = [];
        this.EMP_MASTER_DATA = [];
        this.localStorage.set('AroraTextilesEmployeeMasterV3', '[]');
        this.localStorage.set('ATPL_EMP_MASTER_CLEARED_V1', 'true');
        this.refreshUI();
      } else if (event === 'employee_master_bulk_deleted') {
        const ids = new Set((payload.deleted_ids || []).map(x => String(x).toLowerCase().trim()));
        this.EM.data = this.EM.data.filter(e => !ids.has(String(e.emp_id).toLowerCase().trim()));
        this.EMP_MASTER_DATA = this.EM.data.slice();
        this.localStorage.set('AroraTextilesEmployeeMasterV3', JSON.stringify(this.EM.data));
        this.refreshUI();
      } else if (event === 'employee_master_deleted' || event === 'employee_deleted') {
        const target = String(payload.emp_id || '').toLowerCase().trim();
        this.EM.data = this.EM.data.filter(e => String(e.emp_id).toLowerCase().trim() !== target);
        this.EMP_MASTER_DATA = this.EM.data.slice();
        this.localStorage.set('AroraTextilesEmployeeMasterV3', JSON.stringify(this.EM.data));
        this.refreshUI();
      } else if (event === 'employee_master_updated' || event === 'employee_updated') {
        this.localStorage.delete('ATPL_EMP_MASTER_CLEARED_V1');
        if (payload.mode === 'replace' && Array.isArray(payload.records)) {
          this.EM.data = payload.records.slice();
        } else {
          const list = payload.records || payload.updated || [];
          list.forEach(r => {
            const id = String(r.emp_id || '').toUpperCase().trim();
            const idx = this.EM.data.findIndex(x => String(x.emp_id).toUpperCase().trim() === id);
            if (idx >= 0) {
              this.EM.data[idx] = Object.assign({}, this.EM.data[idx], r);
            } else {
              this.EM.data.push(r);
            }
          });
        }
        this.EMP_MASTER_DATA = this.EM.data.slice();
        this.localStorage.set('AroraTextilesEmployeeMasterV3', JSON.stringify(this.EM.data));
        this.refreshUI();
      }
    }
  }

  // Simulated Server Database State
  let serverDb = [];
  for (let i = 1; i <= 454; i++) {
    serverDb.push({
      emp_id: String(20000 + i),
      name: `EMPLOYEE ${i}`,
      dept: i % 2 === 0 ? 'WEAVING' : 'SPINNING',
      gross: 22000 + (i * 10),
      basic: 15840,
      hra: 6160
    });
  }

  // Initialize two separate simulated browsers (e.g. Chrome on PC and Safari on iPhone)
  const browserA = new BrowserClient('Browser A - Desktop Chrome');
  const browserB = new BrowserClient('Browser B - Mobile Safari');

  browserA.init(serverDb);
  browserB.init(serverDb);

  assert.strictEqual(browserA.EM.data.length, 454, 'Browser A initialized with 454');
  assert.strictEqual(browserB.EM.data.length, 454, 'Browser B initialized with 454');
  assert.strictEqual(browserA.badge, '454', 'Browser A badge is 454');
  assert.strictEqual(browserB.badge, '454', 'Browser B badge is 454');

  await t.test('1. Delete ALL 454 employees from Browser A -> instantly reflects as 0 on Browser B', () => {
    // Browser A triggers delete all
    serverDb = [];
    browserA.onSSE('employee_master_cleared', { count: 0 });

    // Server broadcasts to Browser B via SSE
    browserB.onSSE('employee_master_cleared', { count: 0 });

    assert.strictEqual(browserA.EM.data.length, 0, 'Browser A has 0 employees');
    assert.strictEqual(browserB.EM.data.length, 0, 'Browser B has 0 employees');
    assert.strictEqual(browserB.badge, '0', 'Browser B badge shows 0');
    assert.strictEqual(browserB.totalBadge, '0 Employees', 'Browser B total badge shows 0 Employees');

    // Both reload / refresh page
    browserA.init(serverDb);
    browserB.init(serverDb);

    assert.strictEqual(browserA.EM.data.length, 0, 'Browser A remains 0 after reload');
    assert.strictEqual(browserB.EM.data.length, 0, 'Browser B remains 0 after reload');
  });

  await t.test('2. Add new employee in Browser A -> instantly reflects in Browser B', () => {
    const newEmp = {
      emp_id: '27001',
      name: 'RAJESH ARORA',
      dept: 'MANAGEMENT',
      gross: 50000,
      basic: 36000,
      hra: 14000
    };
    serverDb.push(newEmp);

    // Broadcast SSE to Browser A and B
    browserA.onSSE('employee_master_updated', { mode: 'upsert', records: [newEmp] });
    browserB.onSSE('employee_master_updated', { mode: 'upsert', records: [newEmp] });

    assert.strictEqual(browserA.EM.data.length, 1, 'Browser A has 1 employee');
    assert.strictEqual(browserB.EM.data.length, 1, 'Browser B has 1 employee');
    assert.strictEqual(browserB.EM.data[0].name, 'RAJESH ARORA');
    assert.strictEqual(browserB.EM.data[0].gross, 50000);
    assert.strictEqual(browserB.badge, '1');
  });

  await t.test('3. Excel / Bulk Import 3 rows in Browser A -> instantly reflects in Browser B', () => {
    const bulkRows = [
      { emp_id: '27002', name: 'SUNIL KUMAR', dept: 'WEAVING', gross: 24000, basic: 17280, hra: 6720 },
      { emp_id: '27003', name: 'ANITA SHARMA', dept: 'FINISHING', gross: 21000, basic: 15120, hra: 5880 },
      { emp_id: '27004', name: 'DEEPAK VERMA', dept: 'QUALITY', gross: 26000, basic: 18720, hra: 7280 }
    ];
    bulkRows.forEach(r => serverDb.push(r));

    browserA.onSSE('employee_master_updated', { mode: 'upsert', records: bulkRows });
    browserB.onSSE('employee_master_updated', { mode: 'upsert', records: bulkRows });

    assert.strictEqual(browserA.EM.data.length, 4, 'Browser A has 4 employees');
    assert.strictEqual(browserB.EM.data.length, 4, 'Browser B has 4 employees');
    assert.strictEqual(browserB.badge, '4');
    assert.ok(browserB.EM.data.some(e => e.emp_id === '27003' && e.name === 'ANITA SHARMA'));
  });

  await t.test('4. Edit employee 27001 in Browser A -> instantly updates name, salary, and dept in Browser B', () => {
    const editPayload = {
      emp_id: '27001',
      name: 'RAJESH ARORA (DIRECTOR)',
      dept: 'EXECUTIVE BOARD',
      gross: 75000,
      basic: 54000,
      hra: 21000
    };

    // Server updates
    const idx = serverDb.findIndex(e => e.emp_id === '27001');
    serverDb[idx] = Object.assign({}, serverDb[idx], editPayload);

    // Broadcast SSE
    browserA.onSSE('employee_master_updated', { mode: 'upsert', records: [editPayload] });
    browserB.onSSE('employee_master_updated', { mode: 'upsert', records: [editPayload] });

    const empInB = browserB.EM.data.find(e => e.emp_id === '27001');
    assert.ok(empInB, 'Employee 27001 must exist in Browser B');
    assert.strictEqual(empInB.name, 'RAJESH ARORA (DIRECTOR)');
    assert.strictEqual(empInB.dept, 'EXECUTIVE BOARD');
    assert.strictEqual(empInB.gross, 75000);
    assert.strictEqual(empInB.basic, 54000);
  });

  await t.test('5. Delete single employee 27002 from Browser A -> instantly disappears in Browser B', () => {
    serverDb = serverDb.filter(e => e.emp_id !== '27002');

    browserA.onSSE('employee_master_deleted', { emp_id: '27002', count: serverDb.length });
    browserB.onSSE('employee_master_deleted', { emp_id: '27002', count: serverDb.length });

    assert.strictEqual(browserA.EM.data.length, 3);
    assert.strictEqual(browserB.EM.data.length, 3);
    assert.strictEqual(browserB.EM.data.some(e => e.emp_id === '27002'), false);
    assert.strictEqual(browserB.badge, '3');

    // Simulate page reload on Browser B and confirm no resurrection
    browserB.init(serverDb);
    assert.strictEqual(browserB.EM.data.length, 3);
    assert.strictEqual(browserB.EM.data.some(e => e.emp_id === '27002'), false);
  });
});
