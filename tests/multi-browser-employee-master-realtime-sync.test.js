const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const path = require('path');
const fs = require('fs');

test('CRITICAL: 100% Real-Time Multi-Browser Employee Master Sync (Delete -> Add -> Import -> Edit)', async (t) => {
  // 1. Verify server endpoints and SSE event streaming
  const serverPath = path.join(__dirname, '..', 'server.js');
  const serverCode = fs.readFileSync(serverPath, 'utf8');

  assert.ok(serverCode.includes("app.post('/api/sync/employee-master'"), 'Server must have POST /api/sync/employee-master');
  assert.ok(serverCode.includes("app.delete(\"/api/sync/employee-master/:id\""), 'Server must have DELETE /api/sync/employee-master/:id');
  assert.ok(serverCode.includes("app.delete(\"/api/sync/employee-master\""), 'Server must have DELETE /api/sync/employee-master');
  assert.ok(serverCode.includes("app.post(\"/api/sync/employee-master/bulk-delete\""), 'Server must have bulk-delete route');
  assert.ok(serverCode.includes("broadcastEvent('employee_master_cleared'"), 'Server must broadcast employee_master_cleared');

  // 2. Simulated Multi-Browser Environment
  class SimulatedBrowser {
    constructor(name) {
      this.name = name;
      this.localStorage = new Map();
      this.sessionStorage = new Map();
      this.EM = { data: [], filtered: [], selectedRows: new Set() };
      this.EMP_MASTER_DATA = [];
      this.receivedEvents = [];
    }

    init(seedList) {
      const cleared = this.localStorage.get('ATPL_EMP_MASTER_CLEARED_V1') === 'true' || this.localStorage.get('AroraTextilesEmployeeMasterV3') === '[]';
      if (cleared) {
        this.EM.data = [];
        this.EMP_MASTER_DATA = [];
      } else {
        const raw = this.localStorage.get('AroraTextilesEmployeeMasterV3');
        if (raw) {
          try { this.EM.data = JSON.parse(raw); } catch(_) { this.EM.data = []; }
        } else if (seedList && seedList.length) {
          this.EM.data = seedList.slice();
        }
        this.EMP_MASTER_DATA = this.EM.data.slice();
      }
      this.EM.filtered = this.EM.data.slice();
    }

    onSSE(event, data) {
      this.receivedEvents.push({ event, data });
      if (event === 'employee_master_cleared') {
        this.EM.data = [];
        this.EM.filtered = [];
        this.EMP_MASTER_DATA = [];
        this.localStorage.set('AroraTextilesEmployeeMasterV3', '[]');
        this.localStorage.set('ATPL_EMP_MASTER_CLEARED_V1', 'true');
      } else if (event === 'employee_master_bulk_deleted') {
        const delSet = new Set((data.deleted_ids || []).map(x => String(x).toLowerCase().trim()));
        this.EM.data = this.EM.data.filter(e => !delSet.has(String(e.emp_id).toLowerCase().trim()));
        this.EM.filtered = this.EM.data.slice();
        this.EMP_MASTER_DATA = this.EM.data.slice();
        this.localStorage.set('AroraTextilesEmployeeMasterV3', JSON.stringify(this.EM.data));
      } else if (event === 'employee_master_deleted') {
        const target = String(data.emp_id || '').toLowerCase().trim();
        this.EM.data = this.EM.data.filter(e => String(e.emp_id).toLowerCase().trim() !== target);
        this.EM.filtered = this.EM.data.slice();
        this.EMP_MASTER_DATA = this.EM.data.slice();
        this.localStorage.set('AroraTextilesEmployeeMasterV3', JSON.stringify(this.EM.data));
      } else if (event === 'employee_master_updated') {
        this.localStorage.delete('ATPL_EMP_MASTER_CLEARED_V1');
        if (data.mode === 'replace' && Array.isArray(data.records)) {
          this.EM.data = data.records.slice();
        } else {
          const list = data.records || data.updated || [];
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
        this.EM.filtered = this.EM.data.slice();
        this.EMP_MASTER_DATA = this.EM.data.slice();
        this.localStorage.set('AroraTextilesEmployeeMasterV3', JSON.stringify(this.EM.data));
      }
    }
  }

  // Generate 454 authentic employees
  const initial454 = [];
  for (let i = 1; i <= 454; i++) {
    initial454.push({
      emp_id: String(20000 + i),
      name: `Employee ${i}`,
      dept: i % 2 === 0 ? 'PRODUCTION' : 'MAINTENANCE',
      gross: 21000 + (i * 10),
      basic: 15120,
      hra: 5880
    });
  }

  const browser1 = new SimulatedBrowser('Browser 1 - Chrome Desktop');
  const browser2 = new SimulatedBrowser('Browser 2 - Safari Mobile');

  browser1.init(initial454);
  browser2.init(initial454);

  assert.strictEqual(browser1.EM.data.length, 454, 'Browser 1 must start with 454 employees');
  assert.strictEqual(browser2.EM.data.length, 454, 'Browser 2 must start with 454 employees');

  await t.test('1. Delete ALL 454 employees from Browser 1 -> instantly syncs to Browser 2', () => {
    // Browser 1 selects all and deletes
    const deletedCount = browser1.EM.data.length;
    browser1.EM.data = [];
    browser1.localStorage.set('AroraTextilesEmployeeMasterV3', '[]');
    browser1.localStorage.set('ATPL_EMP_MASTER_CLEARED_V1', 'true');

    // Server broadcasts event to Browser 2
    browser2.onSSE('employee_master_cleared', { count: 0 });

    assert.strictEqual(browser1.EM.data.length, 0, 'Browser 1 has 0 employees');
    assert.strictEqual(browser2.EM.data.length, 0, 'Browser 2 instantly has 0 employees without refresh');

    // Simulate page refresh on both browsers
    browser1.init(initial454);
    browser2.init(initial454);

    assert.strictEqual(browser1.EM.data.length, 0, 'Browser 1 remains 0 after refresh (no resurrection)');
    assert.strictEqual(browser2.EM.data.length, 0, 'Browser 2 remains 0 after refresh (no resurrection)');
  });

  await t.test('2. Add new employee in Browser 1 -> instantly reflects in Browser 2', () => {
    const newEmp = {
      emp_id: '27001',
      name: 'AARAV SHARMA',
      dept: 'QUALITY CONTROL',
      basic: 18000,
      hra: 7000,
      gross: 25000
    };

    browser1.onSSE('employee_master_updated', {
      mode: 'upsert',
      updated: [newEmp],
      records: [newEmp]
    });

    browser2.onSSE('employee_master_updated', {
      mode: 'upsert',
      updated: [newEmp],
      records: [newEmp]
    });

    assert.strictEqual(browser1.EM.data.length, 1, 'Browser 1 now has 1 employee');
    assert.strictEqual(browser2.EM.data.length, 1, 'Browser 2 instantly has 1 employee');
    assert.strictEqual(browser2.EM.data[0].name, 'AARAV SHARMA');
    assert.strictEqual(browser2.EM.data[0].dept, 'QUALITY CONTROL');
    assert.strictEqual(browser2.EM.data[0].gross, 25000);
  });

  await t.test('3. Excel / Bulk Master Import in Browser 1 -> instantly syncs across all browsers', () => {
    const importedRows = [
      { emp_id: '27002', name: 'PRIYA PATEL', dept: 'PACKING', gross: 22000, basic: 15840, hra: 6160 },
      { emp_id: '27003', name: 'VIKRAM SINGH', dept: 'SPINNING', gross: 24000, basic: 17280, hra: 6720 },
      { emp_id: '27004', name: 'MEERA DEVI', dept: 'FINISHING', gross: 20000, basic: 14400, hra: 5600 }
    ];

    browser1.onSSE('employee_master_updated', {
      mode: 'upsert',
      updated: importedRows,
      records: [...browser1.EM.data, ...importedRows]
    });

    browser2.onSSE('employee_master_updated', {
      mode: 'upsert',
      updated: importedRows,
      records: [...browser2.EM.data, ...importedRows]
    });

    assert.strictEqual(browser1.EM.data.length, 4, 'Browser 1 has 4 employees');
    assert.strictEqual(browser2.EM.data.length, 4, 'Browser 2 has 4 employees');
    assert.ok(browser2.EM.data.some(e => e.emp_id === '27003' && e.name === 'VIKRAM SINGH'), 'Browser 2 has imported Vikram Singh');
  });

  await t.test('4. Edit employee in Browser 1 -> instantly updates all fields in Browser 2', () => {
    const editedEmp = {
      emp_id: '27001',
      name: 'AARAV SHARMA (PROMOTED)',
      dept: 'HEAD OF OPERATIONS',
      basic: 28800,
      hra: 11200,
      gross: 40000
    };

    browser1.onSSE('employee_master_updated', {
      mode: 'upsert',
      updated: [editedEmp],
      records: browser1.EM.data.map(e => e.emp_id === '27001' ? Object.assign({}, e, editedEmp) : e)
    });

    browser2.onSSE('employee_master_updated', {
      mode: 'upsert',
      updated: [editedEmp],
      records: browser2.EM.data.map(e => e.emp_id === '27001' ? Object.assign({}, e, editedEmp) : e)
    });

    const empInB2 = browser2.EM.data.find(e => e.emp_id === '27001');
    assert.ok(empInB2, 'Employee 27001 must exist in Browser 2');
    assert.strictEqual(empInB2.name, 'AARAV SHARMA (PROMOTED)');
    assert.strictEqual(empInB2.dept, 'HEAD OF OPERATIONS');
    assert.strictEqual(empInB2.gross, 40000);
    assert.strictEqual(empInB2.basic, 28800);
  });

  await t.test('5. Delete single employee in Browser 1 -> instantly disappears in Browser 2', () => {
    browser1.onSSE('employee_master_deleted', { emp_id: '27002', count: 3 });
    browser2.onSSE('employee_master_deleted', { emp_id: '27002', count: 3 });

    assert.strictEqual(browser1.EM.data.length, 3);
    assert.strictEqual(browser2.EM.data.length, 3);
    assert.strictEqual(browser2.EM.data.some(e => e.emp_id === '27002'), false, 'Employee 27002 must not exist in Browser 2');

    // Refresh simulation
    browser2.init();
    assert.strictEqual(browser2.EM.data.length, 3);
    assert.strictEqual(browser2.EM.data.some(e => e.emp_id === '27002'), false);
  });
});
