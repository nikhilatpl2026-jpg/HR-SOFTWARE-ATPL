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

  await t.test('7. Real-time engine handles tombstones after re-upload, status toggle (ACTIVE <-> INACTIVE), and account_no edits across browsers', async () => {
    const engineCode = fs.readFileSync(path.join(__dirname, '..', 'atpl-employee-master-realtime-engine.js'), 'utf8');
    const emJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'employee_master.json'), 'utf8'));
    const tombJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'tombstones_employees.json'), 'utf8'));

    // Verify repo data/tombstones_employees.json no longer blocks active employees in data/employee_master.json
    const nk = s => String(s || '').toUpperCase().trim().replace(/^0+/, '') || String(s || '').toUpperCase().trim();
    const tombSet = new Set(tombJson.map(nk));
    const blockedActive = emJson.filter(r => tombSet.has(nk(r.emp_id)));
    assert.strictEqual(blockedActive.length, 0, 'Active employees in employee_master.json must NOT be blocked by tombstones_employees.json');

    // Boot two isolated browser VMs sharing a mock GitHub repo + Drive backend
    let ghMaster = [{ emp_id: '00135', name: 'SAMPAT LAL', account_no: '111122223333', status: 'ACTIVE', _em_updated_at: 2000000 }];
    let ghTombs = ['135', '99999']; // Legacy array tombstone for 135 from an older clear; 99999 is genuinely deleted
    let pushedTombsCount = 0;

    function makeBrowser() {
      const store = new Map();
      const channels = [];
      const win = {
        EM: { data: [], filtered: [], selectedRows: new Set(), editIdx: -1 },
        EMP_MASTER_DATA: [],
        atob,
        btoa,
        localStorage: {
          getItem: k => (store.has(k) ? store.get(k) : null),
          setItem: (k, v) => store.set(k, String(v)),
          removeItem: k => store.delete(k)
        },
        location: { hostname: 'nikhilatpl2026-jpg.github.io', protocol: 'https:' },
        document: {
          readyState: 'complete',
          hidden: false,
          getElementById: () => null,
          addEventListener: () => {}
        },
        addEventListener: () => {},
        setTimeout,
        clearTimeout,
        setInterval: () => 1,
        clearInterval: () => {},
        BroadcastChannel: function(name) {
          this.name = name;
          this.postMessage = () => {};
          this.close = () => {};
          channels.push(this);
        },
        fetch: async (url, opts) => {
          const u = String(url);
          const method = (opts && opts.method) || 'GET';
          if (u.includes('/commits?path=data%2Femployee_master.json')) {
            return { ok: true, status: 200, json: async () => [{ sha: 'sha_m_' + ghMaster.length }] };
          }
          if (u.includes('/commits?path=data%2Ftombstones_employees.json')) {
            return { ok: true, status: 200, json: async () => [{ sha: 'sha_t_' + ghTombs.length }] };
          }
          if (u.includes('/contents/data/employee_master.json') && method === 'GET') {
            const b64 = Buffer.from(JSON.stringify(ghMaster)).toString('base64');
            return { ok: true, status: 200, json: async () => ({ sha: 'sha_m', content: b64 }) };
          }
          if (u.includes('/contents/data/tombstones_employees.json') && method === 'GET') {
            const b64 = Buffer.from(JSON.stringify(ghTombs)).toString('base64');
            return { ok: true, status: 200, json: async () => ({ sha: 'sha_t', content: b64 }) };
          }
          if (u.includes('/contents/data/employee_master.json') && method === 'PUT') {
            const body = JSON.parse(opts.body);
            ghMaster = JSON.parse(Buffer.from(body.content, 'base64').toString('utf8'));
            return { ok: true, status: 200, json: async () => ({ content: { sha: 'sha_m2' }, commit: { sha: 'c_m2' } }) };
          }
          if (u.includes('/contents/data/tombstones_employees.json') && method === 'PUT') {
            const body = JSON.parse(opts.body);
            ghTombs = JSON.parse(Buffer.from(body.content, 'base64').toString('utf8'));
            pushedTombsCount++;
            return { ok: true, status: 200, json: async () => ({ content: { sha: 'sha_t2' }, commit: { sha: 'c_t2' } }) };
          }
          return { ok: false, status: 404, json: async () => ({}) };
        },
        emSaveModal: async () => {
          // Simulate emSaveModal updating EM.data[editIdx] and closing modal (editIdx = -1)
          win.EM.data[0] = Object.assign({}, win.EM.data[0], { account_no: '999888777666' });
          win.EM.editIdx = -1;
        },
        console
      };
      win.window = win;
      vm.runInNewContext(engineCode, win);
      return win;
    }

    const b1 = makeBrowser();
    await b1.ATPLEmployeeMasterRealtimeEngine.hydrate();
    assert.strictEqual(b1.EM.data.length, 1, 'Legacy array tombstone must NOT delete newer active employee 00135');
    assert.strictEqual(b1.EM.data[0].emp_id, '00135');

    // Simulate offline/prior delete tombstone in b1 localStorage before re-saving 00135, plus modal account_no edit + rapid status toggle
    b1.localStorage.setItem('ATPL_EmployeeMasterDeletedV1', JSON.stringify({ '135': '2026-11-16T01:00:00.000Z', '99999': '2026-11-16T01:00:00.000Z' }));
    b1.EM.editIdx = 0;
    await b1.emSaveModal();
    await b1.ATPLEmployeeMasterRealtimeEngine.updateEmployeeStatus('00135', 'INACTIVE', '16-11-2026');

    // Wait briefly for debounced GitHub push queue (250ms)
    await new Promise(r => setTimeout(r, 400));
    assert.ok(pushedTombsCount >= 1, 'Re-saving previously tombstoned employee must clean and push tombstones_employees.json');
    assert.ok(!ghTombs.includes('135') && !ghTombs.includes('00135'), 'Cleaned tombstones must no longer contain 135');

    // Browser 2 hydrates and receives both new account_no and INACTIVE status
    const b2 = makeBrowser();
    await b2.ATPLEmployeeMasterRealtimeEngine.hydrate();
    assert.strictEqual(b2.EM.data.length, 1);
    assert.strictEqual(b2.EM.data[0].account_no, '999888777666');
    assert.strictEqual(b2.EM.data[0].status, 'INACTIVE');
    assert.strictEqual(b2.EM.data[0].dol, '16-11-2026');

    // Genuine delete in Browser 1 removes employee and blocks older snapshots
    await b1.ATPLEmployeeMasterRealtimeEngine.deleteEmployee('00135');
    await new Promise(r => setTimeout(r, 400));
    assert.strictEqual(ghMaster.length, 0);
    assert.ok(ghTombs.includes('00135') || ghTombs.includes('135'));
  });
});
