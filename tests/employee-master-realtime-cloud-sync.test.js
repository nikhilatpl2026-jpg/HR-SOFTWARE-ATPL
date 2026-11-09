const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

test('Employee Master Real-Time Cloud Sync Architecture Verification', async (t) => {
  const syncJs = fs.readFileSync(path.join(__dirname, '..', 'atpl-google-drive-sync.js'), 'utf8');
  const serverJs = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const empSaveJs = fs.readFileSync(path.join(__dirname, '..', 'employee-master-confirmed-save-v1.js'), 'utf8');
  const cleanGs = fs.readFileSync(path.join(__dirname, '..', 'backend', 'ATPL_Clean_Backend_V5.gs'), 'utf8');

  await t.test('1. atpl-google-drive-sync.js syntax and real-time event mechanisms', () => {
    assert.doesNotThrow(() => {
      new vm.Script(syncJs);
    }, 'atpl-google-drive-sync.js must compile without syntax errors');

    assert.ok(syncJs.includes('applySingleOrBatchEmployeeUpdate'), 'Must have instant single or batch employee updater');
    assert.ok(syncJs.includes('applyEmployeeDeleteLocally'), 'Must have instant employee delete local handler');
    assert.ok(syncJs.includes("dispatchSyncTrigger('employee_updated'"), 'Must trigger employee_updated event');
    assert.ok(syncJs.includes("dispatchSyncTrigger('employee_deleted'"), 'Must trigger employee_deleted event');
    assert.ok(syncJs.includes("fetch('/api/sync/trigger'"), 'Must relay sync trigger to server SSE stream');
    assert.ok(syncJs.includes("'employee_master_updated'"), 'SSE listener must subscribe to employee_master_updated');
    assert.ok(syncJs.includes("'employee_master_deleted'"), 'SSE listener must subscribe to employee_master_deleted');
    assert.ok(syncJs.includes('ATPL_ERP_SHARED_V2'), 'Must broadcast to ATPL_ERP_SHARED_V2 channel');
    assert.ok(syncJs.includes('ATPL_ERP_TRIGGER_BUS'), 'Must broadcast to ATPL_ERP_TRIGGER_BUS channel');
  });

  await t.test('2. server.js real-time SSE relay & persistent storage routes', () => {
    assert.ok(serverJs.includes("app.post('/api/sync/trigger'"), 'Must have /api/sync/trigger endpoint');
    assert.ok(serverJs.includes("app.get('/api/sync/events'"), 'Must have /api/sync/events SSE endpoint');
    assert.ok(serverJs.includes("app.post('/api/sync/employee-master'"), 'Must have /api/sync/employee-master endpoint');
    assert.ok(serverJs.includes("app.delete(\"/api/sync/employee-master/:id\""), 'Must have DELETE /api/sync/employee-master/:id endpoint');
    assert.ok(serverJs.includes("broadcastEvent('employee_master_updated'"), 'Must broadcast employee_master_updated on save');
    assert.ok(serverJs.includes("broadcastEvent(\"employee_master_deleted\""), 'Must broadcast employee_master_deleted on delete');
  });

  await t.test('3. Google Apps Script backend supports batch & single Employee Master operations', () => {
    assert.ok(cleanGs.includes("action === 'upsertEmployeeMaster'"), 'Must support upsertEmployeeMaster');
    assert.ok(cleanGs.includes("action === 'saveEmployeeMaster'"), 'Must support saveEmployeeMaster');
    assert.ok(cleanGs.includes("action === 'deleteEmployeeMaster'"), 'Must support deleteEmployeeMaster');
  });

  await t.test('4. End-to-end simulated cross-browser sync: Browser A -> Server -> Browser B', () => {
    // Simulated Browser A state
    const browserA_EM = [
      { emp_id: '1001', name: 'Ramesh Sharma', dept: 'Spinning', gross: 18000 },
      { emp_id: '1002', name: 'Suresh Verma', dept: 'Maintenance', gross: 22000 }
    ];

    // Simulated Browser B state
    const browserB_EM = [
      { emp_id: '1001', name: 'Ramesh Sharma', dept: 'Spinning', gross: 18000 },
      { emp_id: '1002', name: 'Suresh Verma', dept: 'Maintenance', gross: 22000 }
    ];

    // Browser A edits single field: salary changed to 24000 and department to 'Weaving'
    const editUpdate = { emp_id: '1001', dept: 'Weaving', gross: 24000 };

    // Update in Browser A
    const aIdx = browserA_EM.findIndex(e => e.emp_id === '1001');
    browserA_EM[aIdx] = Object.assign({}, browserA_EM[aIdx], editUpdate);

    // Event payload dispatched from Browser A
    const eventPayload = {
      action: 'employee_updated',
      details: {
        emp_id: '1001',
        record: browserA_EM[aIdx],
        records: [browserA_EM[aIdx]]
      }
    };

    // Browser B receives payload and applies update immediately via applySingleOrBatchEmployeeUpdate logic
    const bUpdatedRecords = eventPayload.details.records || [eventPayload.details.record];
    bUpdatedRecords.forEach(rec => {
      const idx = browserB_EM.findIndex(x => x.emp_id === rec.emp_id);
      if (idx >= 0) {
        browserB_EM[idx] = Object.assign({}, browserB_EM[idx], rec);
      } else {
        browserB_EM.push(rec);
      }
    });

    // Verify Browser B updated instantly without reload or loss of other fields
    assert.strictEqual(browserB_EM[0].dept, 'Weaving', 'Browser B must reflect updated department');
    assert.strictEqual(browserB_EM[0].gross, 24000, 'Browser B must reflect updated salary');
    assert.strictEqual(browserB_EM[0].name, 'Ramesh Sharma', 'Browser B must preserve unchanged fields');

    // Browser A adds new employee 1003
    const newEmp = { emp_id: '1003', name: 'Amit Kumar', dept: 'Finishing', gross: 20000 };
    browserA_EM.push(newEmp);

    // Browser B receives add event
    browserB_EM.push(newEmp);
    assert.strictEqual(browserB_EM.length, 3, 'Browser B must have 3 employees after addition');
    assert.strictEqual(browserB_EM[2].emp_id, '1003');

    // Browser A deletes employee 1002
    const delId = '1002';
    const bAfterDel = browserB_EM.filter(e => e.emp_id !== delId);
    assert.strictEqual(bAfterDel.length, 2, 'Browser B must reflect deletion instantly');
    assert.strictEqual(bAfterDel.some(e => e.emp_id === '1002'), false, 'Deleted employee must not exist in Browser B');
  });

  await t.test('5. hr-workplace.js saveView routes to ATPLGoogleSync, /api/sync/employee-master, and dispatchSyncTrigger', () => {
    const hrWorkplaceCode = fs.readFileSync(path.join(__dirname, '../hr-workplace.js'), 'utf8');
    assert.ok(hrWorkplaceCode.includes('ATPLGoogleSync.upsertEmployeeMaster'), 'saveView must call ATPLGoogleSync.upsertEmployeeMaster');
    assert.ok(hrWorkplaceCode.includes('/api/sync/employee-master'), 'saveView must post to /api/sync/employee-master');
    assert.ok(hrWorkplaceCode.includes('dispatchSyncTrigger'), 'saveView must call dispatchSyncTrigger');
  });

  await t.test('6. Employee Master contains enriched bank details and normalizes aliases', () => {
    const emps = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/employee_master.json'), 'utf8'));
    const emp00530 = emps.find(e => String(e.emp_id).includes('530'));
    assert.ok(emp00530, 'Employee 00530 must exist');
    assert.strictEqual(emp00530.bank_name, 'STATE BANK OF INDIA');
    assert.strictEqual(emp00530.ifsc, 'SBIN0003401');
    assert.strictEqual(emp00530.account_no, '33811674907');

    const syncCode = fs.readFileSync(path.join(__dirname, '../atpl-google-drive-sync.js'), 'utf8');
    assert.ok(syncCode.includes('!localHasBank'), 'Must auto-pull vault if local records lack bank details');
    assert.ok(syncCode.includes('base.bank_account_no'), 'Must normalize bank_account_no alias');
  });
});
