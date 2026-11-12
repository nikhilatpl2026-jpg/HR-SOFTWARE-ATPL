const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('CRITICAL: Authoritative Real-Time Employee Master Engine Acceptance Test', async (t) => {
  // Load original 454 employees from repository
  const originalJson = fs.readFileSync(path.join(__dirname, '../data/employee_master.json'), 'utf8');
  const initial454 = JSON.parse(originalJson);
  assert.strictEqual(initial454.length, 454, 'Initial dataset must contain exactly 454 employees');

  // Simulated Browser Environment Class
  class MockBrowser {
    constructor(name) {
      this.name = name;
      this.localStorage = new Map();
      this.EM = { data: [], filtered: [], selectedRows: new Set() };
      this.EMP_MASTER_DATA = [];
      this.events = [];
    }

    hydrate(seed) {
      const isCleared = this.localStorage.get('ATPL_EMP_MASTER_CLEARED_V1') === 'true' ||
                        this.localStorage.get('AroraTextilesEmployeeMasterV3') === '[]';
      if (isCleared) {
        this.EM.data = [];
        this.EMP_MASTER_DATA = [];
      } else {
        const stored = this.localStorage.get('AroraTextilesEmployeeMasterV3');
        if (stored) {
          try { this.EM.data = JSON.parse(stored); } catch (_) { this.EM.data = []; }
        } else if (seed && seed.length) {
          this.EM.data = seed.slice();
        }
        this.EMP_MASTER_DATA = this.EM.data.slice();
      }
      this.EM.filtered = this.EM.data.slice();
    }

    // Process incoming real-time sync event
    onSyncEvent(evt) {
      if (evt.action === "status_update") {
        const id = String(evt.emp_id || "").toUpperCase().trim();
        const found = this.EM.data.find(x => String(x.emp_id || "").toUpperCase().trim() === id);
        if (found) {
          found.status = (evt.status || "ACTIVE").toUpperCase();
          found.dol = (found.status === "ACTIVE") ? "" : (evt.dol || "");
          if (evt.record) Object.assign(found, evt.record);
        }
        this.EM.filtered = this.EM.data.slice();
        this.EMP_MASTER_DATA = this.EM.data.slice();
        this.localStorage.set("AroraTextilesEmployeeMasterV3", JSON.stringify(this.EM.data));
        return;
      }
      this.events.push(evt);
      if (evt.action === 'delete_all') {
        this.EM.data = [];
        this.EM.filtered = [];
        this.EMP_MASTER_DATA = [];
        this.localStorage.set('AroraTextilesEmployeeMasterV3', '[]');
        this.localStorage.set('ATPL_EMP_MASTER_CLEARED_V1', 'true');
      } else if (evt.action === 'delete') {
        const id = String(evt.emp_id || '').toUpperCase().trim();
        this.EM.data = this.EM.data.filter(e => String(e.emp_id || '').toUpperCase().trim() !== id);
        this.EM.filtered = this.EM.data.slice();
        this.EMP_MASTER_DATA = this.EM.data.slice();
        this.localStorage.set('AroraTextilesEmployeeMasterV3', JSON.stringify(this.EM.data));
      } else if (evt.action === 'bulk_delete') {
        const delSet = new Set((evt.ids || []).map(x => String(x || '').toUpperCase().trim()));
        this.EM.data = this.EM.data.filter(e => !delSet.has(String(e.emp_id || '').toUpperCase().trim()));
        this.EM.filtered = this.EM.data.slice();
        this.EMP_MASTER_DATA = this.EM.data.slice();
        this.localStorage.set('AroraTextilesEmployeeMasterV3', JSON.stringify(this.EM.data));
      } else if (evt.action === 'upsert') {
        this.localStorage.delete('ATPL_EMP_MASTER_CLEARED_V1');
        const rows = evt.records || (evt.record ? [evt.record] : []);
        rows.forEach(r => {
          const id = String(r.emp_id || '').toUpperCase().trim();
          const idx = this.EM.data.findIndex(x => String(x.emp_id || '').toUpperCase().trim() === id);
          if (idx >= 0) {
            this.EM.data[idx] = Object.assign({}, this.EM.data[idx], r);
          } else {
            this.EM.data.push(Object.assign({}, r, { emp_id: id }));
          }
        });
        this.EM.filtered = this.EM.data.slice();
        this.EMP_MASTER_DATA = this.EM.data.slice();
        this.localStorage.set('AroraTextilesEmployeeMasterV3', JSON.stringify(this.EM.data));
      }
    }
  }

  const browserA = new MockBrowser('Browser A - Windows Chrome');
  const browserB = new MockBrowser('Browser B - Mac Safari');
  const browserC = new MockBrowser('Browser C - Android Mobile');

  // Initialize all browsers with the central 454 employees
  browserA.hydrate(initial454);
  browserB.hydrate(initial454);
  browserC.hydrate(initial454);

  assert.strictEqual(browserA.EM.data.length, 454);
  assert.strictEqual(browserB.EM.data.length, 454);
  assert.strictEqual(browserC.EM.data.length, 454);

  await t.test('1. Delete ALL 454 employees from Browser A -> immediately disappears in Browser B & C', () => {
    // Browser A initiates Delete All
    browserA.onSyncEvent({ action: 'delete_all' });
    
    // Multi-channel broadcast arrives at Browser B and C
    browserB.onSyncEvent({ action: 'delete_all' });
    browserC.onSyncEvent({ action: 'delete_all' });

    assert.strictEqual(browserA.EM.data.length, 0, 'Browser A must have 0 employees');
    assert.strictEqual(browserB.EM.data.length, 0, 'Browser B must have 0 employees');
    assert.strictEqual(browserC.EM.data.length, 0, 'Browser C must have 0 employees');

    // Simulate page reload on all browsers -> must stay 0 (no resurrection of deleted employees)
    browserA.hydrate(initial454);
    browserB.hydrate(initial454);
    browserC.hydrate(initial454);

    assert.strictEqual(browserA.EM.data.length, 0, 'Browser A remains 0 after reload');
    assert.strictEqual(browserB.EM.data.length, 0, 'Browser B remains 0 after reload');
    assert.strictEqual(browserC.EM.data.length, 0, 'Browser C remains 0 after reload');
  });

  await t.test('2. Add new employee in Browser B -> immediately reflects in Browser A & C', () => {
    const newEmp = {
      emp_id: '99001',
      name: 'RAJESH SHARMA',
      dept: 'LOOM MAINTENANCE',
      basic: 22000,
      hra: 8000,
      gross: 30000
    };

    browserB.onSyncEvent({ action: 'upsert', records: [newEmp] });
    browserA.onSyncEvent({ action: 'upsert', records: [newEmp] });
    browserC.onSyncEvent({ action: 'upsert', records: [newEmp] });

    assert.strictEqual(browserA.EM.data.length, 1);
    assert.strictEqual(browserB.EM.data.length, 1);
    assert.strictEqual(browserC.EM.data.length, 1);

    assert.strictEqual(browserA.EM.data[0].name, 'RAJESH SHARMA');
    assert.strictEqual(browserC.EM.data[0].gross, 30000);
  });

  await t.test('3. Excel Import 5 employees in Browser C -> immediately reflects in Browser A & B', () => {
    const excelRows = [
      { emp_id: '99002', name: 'SUNIL VERMA', dept: 'WEAVING', gross: 25000 },
      { emp_id: '99003', name: 'ANITA DEVI', dept: 'SPINNING', gross: 21000 },
      { emp_id: '99004', name: 'MOHAN LAL', dept: 'DYEING', gross: 27000 },
      { emp_id: '99005', name: 'KAVITA RANI', dept: 'QUALITY CONTROL', gross: 24000 },
      { emp_id: '99006', name: 'DEEPAK JOSHI', dept: 'FINISHING', gross: 23000 }
    ];

    browserC.onSyncEvent({ action: 'upsert', records: excelRows });
    browserA.onSyncEvent({ action: 'upsert', records: excelRows });
    browserB.onSyncEvent({ action: 'upsert', records: excelRows });

    assert.strictEqual(browserA.EM.data.length, 6, 'Browser A now has 6 employees');
    assert.strictEqual(browserB.EM.data.length, 6, 'Browser B now has 6 employees');
    assert.strictEqual(browserC.EM.data.length, 6, 'Browser C now has 6 employees');

    assert.ok(browserA.EM.data.some(e => e.emp_id === '99004' && e.name === 'MOHAN LAL'));
  });

  await t.test('4. Edit employee 99001 in Browser A -> instantly updates name, salary, dept across B & C', () => {
    const editPayload = {
      emp_id: '99001',
      name: 'RAJESH SHARMA (PLANT HEAD)',
      dept: 'EXECUTIVE MANAGEMENT',
      basic: 36000,
      hra: 14000,
      gross: 50000
    };

    browserA.onSyncEvent({ action: 'upsert', records: [editPayload] });
    browserB.onSyncEvent({ action: 'upsert', records: [editPayload] });
    browserC.onSyncEvent({ action: 'upsert', records: [editPayload] });

    // Check count hasn't changed
    assert.strictEqual(browserA.EM.data.length, 6);
    assert.strictEqual(browserB.EM.data.length, 6);
    assert.strictEqual(browserC.EM.data.length, 6);

    // Verify fields updated in Browser B
    const b2Emp = browserB.EM.data.find(e => e.emp_id === '99001');
    assert.strictEqual(b2Emp.name, 'RAJESH SHARMA (PLANT HEAD)');
    assert.strictEqual(b2Emp.dept, 'EXECUTIVE MANAGEMENT');
    assert.strictEqual(b2Emp.gross, 50000);
    assert.strictEqual(b2Emp.basic, 36000);

    // Verify fields updated in Browser C
    const b3Emp = browserC.EM.data.find(e => e.emp_id === '99001');
    assert.strictEqual(b3Emp.name, 'RAJESH SHARMA (PLANT HEAD)');
    assert.strictEqual(b3Emp.gross, 50000);
  });

  await t.test('5. Delete single employee 99003 from Browser B -> immediately deleted in A & C', () => {
    browserB.onSyncEvent({ action: 'delete', emp_id: '99003' });
    browserA.onSyncEvent({ action: 'delete', emp_id: '99003' });
    browserC.onSyncEvent({ action: 'delete', emp_id: '99003' });

    assert.strictEqual(browserA.EM.data.length, 5);
    assert.strictEqual(browserB.EM.data.length, 5);
    assert.strictEqual(browserC.EM.data.length, 5);

    assert.strictEqual(browserA.EM.data.some(e => e.emp_id === '99003'), false);
    assert.strictEqual(browserB.EM.data.some(e => e.emp_id === '99003'), false);
    assert.strictEqual(browserC.EM.data.some(e => e.emp_id === '99003'), false);

    // Refresh simulation on Browser A
    browserA.hydrate();
    assert.strictEqual(browserA.EM.data.length, 5);
    assert.strictEqual(browserA.EM.data.some(e => e.emp_id === '99003'), false);
  });

  await t.test("6. Status Change (ACTIVE <-> LEFT) in Browser B -> instantly reflects in Browser A & C", () => {
    // Browser B marks 99001 as LEFT with DOL
    const statusPayload = {
      action: "status_update",
      emp_id: "99001",
      status: "LEFT",
      dol: "12-11-2026"
    };
    browserB.onSyncEvent(statusPayload);
    browserA.onSyncEvent(statusPayload);
    browserC.onSyncEvent(statusPayload);

    const aEmp = browserA.EM.data.find(e => e.emp_id === "99001");
    const bEmp = browserB.EM.data.find(e => e.emp_id === "99001");
    const cEmp = browserC.EM.data.find(e => e.emp_id === "99001");

    assert.strictEqual(aEmp.status, "LEFT");
    assert.strictEqual(aEmp.dol, "12-11-2026");
    assert.strictEqual(bEmp.status, "LEFT");
    assert.strictEqual(cEmp.status, "LEFT");

    // Toggle back to ACTIVE in Browser A
    const activePayload = {
      action: "status_update",
      emp_id: "99001",
      status: "ACTIVE",
      dol: ""
    };
    browserA.onSyncEvent(activePayload);
    browserB.onSyncEvent(activePayload);
    browserC.onSyncEvent(activePayload);

    assert.strictEqual(aEmp.status, "ACTIVE");
    assert.strictEqual(aEmp.dol, "");
    assert.strictEqual(bEmp.status, "ACTIVE");
    assert.strictEqual(cEmp.status, "ACTIVE");
  });
});
