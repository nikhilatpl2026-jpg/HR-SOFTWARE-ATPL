const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const rootDir = path.join(__dirname, '..');
const advanceJsCode = fs.readFileSync(path.join(rootDir, 'atpl-advance-management.js'), 'utf8');
const googleSyncJsCode = fs.readFileSync(path.join(rootDir, 'atpl-google-drive-sync.js'), 'utf8');

function createMockBrowser(browserName, sharedCloud) {
  const localStorageData = {};
  const mockWindow = {
    name: browserName,
    localStorage: {
      getItem: (k) => localStorageData[k] || null,
      setItem: (k, v) => { localStorageData[k] = String(v); },
      removeItem: (k) => { delete localStorageData[k]; }
    },
    _elements: { advanceModuleContainer: { innerHTML: '' }, advModal: { id: 'advModal', innerHTML: '' } },
    document: {
      addEventListener: () => {},
      getElementById: (id) => mockWindow._elements[id] || null,
      createElement: () => ({ style: {}, setAttribute: () => {}, click: () => {} }),
      body: { appendChild: () => {}, removeChild: () => {} },
      readyState: 'complete',
      hidden: false
    },
    addEventListener: () => {},
    BroadcastChannel: class {
      postMessage(msg) {
        if (sharedCloud.onBroadcast) sharedCloud.onBroadcast(browserName, msg);
      }
      close() {}
    },
    EM: {
      data: [
        { emp_id: '25924', name: 'Ram Kumar Sharma', dept: 'Spinning', desig: 'Senior Operator' },
        { emp_id: '26448', name: 'Nikhil Arora', dept: 'Management', desig: 'Director' }
      ]
    },
    FILES: [],
    showToast: () => {},
    ATPLGoogleSync: {
      callGoogleBackend: async (action, params) => {
        return sharedCloud.handleGas(action, params);
      }
    }
  };
  mockWindow.window = mockWindow;
  return { mockWindow, storage: localStorageData };
}

test('Advance Management Cross-Device Cloud Sync Acceptance Suite', async (t) => {
  // Shared authoritative cloud mock representing Google Drive & Google Apps Script
  const cloudStorage = {
    files: {},
    handleGas: async (action, params) => {
      if (action === 'uploadFile') {
        const fileName = params.fileName;
        cloudStorage.files[fileName] = {
          name: fileName,
          fileBase64: params.fileBase64,
          mimeType: params.mimeType,
          updatedAt: new Date().toISOString()
        };
        return { ok: true, version: 100, fileId: 'drive_' + fileName };
      }
      if (action === 'downloadFile') {
        const file = cloudStorage.files[params.fileName];
        if (file) {
          return { ok: true, name: file.name, fileBase64: file.fileBase64, updatedAt: file.updatedAt };
        }
        return { ok: false, error: 'File not found' };
      }
      if (action === 'deleteFile') {
        delete cloudStorage.files[params.fileName];
        return { ok: true, deleted: true };
      }
      return { ok: false };
    }
  };

  await t.test('Test 1: Add advance in Browser A and verify it appears in Browser B via cloud', async () => {
    // 1. Browser A
    const browserA = createMockBrowser('Browser_A_Desktop', cloudStorage);
    const ctxA = vm.createContext(browserA.mockWindow);
    vm.runInContext(advanceJsCode, ctxA);

    assert(browserA.mockWindow.ATPLAdvanceManager, 'Browser A must have ATPLAdvanceManager');

    // Browser A adds advance for employee 26448
    browserA.mockWindow.ATPLAdvanceManager.addOrUpdateAdvance({
      id: 'adv_nikhil_1',
      empCode: '26448',
      amount: 50000,
      monthlyCap: 10000,
      advanceDate: '2026-11-08',
      remarks: 'Machine expansion advance'
    });

    const advancesA = browserA.mockWindow.ATPLAdvanceManager.getAllAdvances();
    assert.equal(advancesA.length, 1);
    assert.equal(advancesA[0].empName, 'Nikhil Arora');
    assert.equal(advancesA[0].amount, 50000);

    // Wait a tick for background async push to finish
    await new Promise(r => setTimeout(r, 50));

    // Verify file exists in shared Google Drive
    assert(cloudStorage.files['ATPL_ADVANCE_MANAGEMENT_DATA.json'], 'Advance data must be written to Google Drive');

    // 2. Browser B (Fresh browser, completely empty local storage)
    const browserB = createMockBrowser('Browser_B_Laptop', cloudStorage);
    assert.equal(Object.keys(browserB.storage).length, 0, 'Browser B starts with empty localStorage');

    const ctxB = vm.createContext(browserB.mockWindow);
    vm.runInContext(advanceJsCode, ctxB);

    // In Browser B, trigger syncNow to retrieve from cloud
    const syncRes = await browserB.mockWindow.ATPLAdvanceManager.syncNow(false);
    assert.equal(syncRes.ok, true, 'Browser B cloud sync must succeed');

    const advancesB = browserB.mockWindow.ATPLAdvanceManager.getAllAdvances();
    assert.equal(advancesB.length, 1, 'Browser B must have retrieved the advance record from cloud');
    assert.equal(advancesB[0].id, 'adv_nikhil_1');
    assert.equal(advancesB[0].empCode, '26448');
    assert.equal(advancesB[0].empName, 'Nikhil Arora');
    assert.equal(advancesB[0].amount, 50000);
    assert.equal(advancesB[0].balanceAmount, 50000);
  });

  await t.test('Test 2: Add advance from Mobile Phone and verify it appears on Desktop', async () => {
    // Mobile Phone Browser
    const mobile = createMockBrowser('Mobile_Phone_Android', cloudStorage);
    const ctxMobile = vm.createContext(mobile.mockWindow);
    vm.runInContext(advanceJsCode, ctxMobile);

    // Sync mobile first to get existing records
    await mobile.mockWindow.ATPLAdvanceManager.syncNow(false);

    // Mobile adds a second advance for worker 25924
    mobile.mockWindow.ATPLAdvanceManager.addOrUpdateAdvance({
      id: 'adv_ram_1',
      empCode: '25924',
      amount: 15000,
      monthlyCap: 5000,
      advanceDate: '2026-11-09',
      remarks: 'Festival celebration loan'
    });

    await new Promise(r => setTimeout(r, 50));

    // Desktop Browser (Browser A) syncs from cloud
    const desktop = createMockBrowser('Desktop_Workstation', cloudStorage);
    const ctxDesktop = vm.createContext(desktop.mockWindow);
    vm.runInContext(advanceJsCode, ctxDesktop);

    await desktop.mockWindow.ATPLAdvanceManager.syncNow(false);
    const desktopAdvances = desktop.mockWindow.ATPLAdvanceManager.getAllAdvances();
    assert.equal(desktopAdvances.length, 2, 'Desktop must have both advances (Nikhil + Ram Kumar)');
    assert(desktopAdvances.some(a => a.id === 'adv_ram_1'), 'Must include mobile-created advance');
  });

  await t.test('Test 3: Edit and delete an advance and verify changes across devices', async () => {
    const desktop = createMockBrowser('Desktop_Editor', cloudStorage);
    const ctxDesktop = vm.createContext(desktop.mockWindow);
    vm.runInContext(advanceJsCode, ctxDesktop);
    await desktop.mockWindow.ATPLAdvanceManager.syncNow(false);

    // Edit advance adv_ram_1: increase amount to ₹18,000
    desktop.mockWindow.ATPLAdvanceManager.addOrUpdateAdvance({
      id: 'adv_ram_1',
      empCode: '25924',
      amount: 18000,
      monthlyCap: 6000,
      advanceDate: '2026-11-09',
      remarks: 'Updated festival celebration loan'
    });
    await new Promise(r => setTimeout(r, 50));

    // Mobile syncs and verifies edit
    const mobile = createMockBrowser('Mobile_Device', cloudStorage);
    const ctxMobile = vm.createContext(mobile.mockWindow);
    vm.runInContext(advanceJsCode, ctxMobile);
    await mobile.mockWindow.ATPLAdvanceManager.syncNow(false);

    const ramAdvMobile = mobile.mockWindow.ATPLAdvanceManager.getAllAdvances().find(a => a.id === 'adv_ram_1');
    assert.equal(ramAdvMobile.amount, 18000, 'Mobile must reflect updated amount ₹18,000');
    assert.equal(ramAdvMobile.monthlyCap, 6000);

    // Now delete adv_nikhil_1 from Mobile
    mobile.mockWindow.ATPLAdvanceManager.deleteAdvance('adv_nikhil_1');
    await new Promise(r => setTimeout(r, 50));

    // Desktop syncs and verifies deletion
    await desktop.mockWindow.ATPLAdvanceManager.syncNow(false);
    const desktopRemaining = desktop.mockWindow.ATPLAdvanceManager.getAllAdvances();
    assert.equal(desktopRemaining.length, 1, 'Desktop should only have 1 advance left');
    assert.equal(desktopRemaining[0].id, 'adv_ram_1');
    assert(!desktopRemaining.some(a => a.id === 'adv_nikhil_1'), 'adv_nikhil_1 must be deleted on all devices');
  });

  await t.test('Test 4: Refresh or reopen another browser and verify records remain available', async () => {
    // Brand new third device
    const tablet = createMockBrowser('Tablet_iPad', cloudStorage);
    const ctxTablet = vm.createContext(tablet.mockWindow);
    vm.runInContext(advanceJsCode, ctxTablet);

    await tablet.mockWindow.ATPLAdvanceManager.syncNow(false);
    const tabletAdvances = tablet.mockWindow.ATPLAdvanceManager.getAllAdvances();
    assert.equal(tabletAdvances.length, 1);
    assert.equal(tabletAdvances[0].id, 'adv_ram_1');
    assert.equal(tabletAdvances[0].balanceAmount, 18000);
  });

  await t.test('Test 5: Upload monthly salary sheet and verify correct advance deductions without duplication', async () => {
    const desktop = createMockBrowser('Desktop_Salary_Manager', cloudStorage);
    const ctxDesktop = vm.createContext(desktop.mockWindow);
    vm.runInContext(advanceJsCode, ctxDesktop);
    await desktop.mockWindow.ATPLAdvanceManager.syncNow(false);

    // Monthly Salary Sheet for November 2026
    const novSalarySheet = {
      name: 'Salary_Sheet_Nov_2026.xlsx',
      sheets: {
        'Salaries': [
          ['Emp Code', 'Name', 'Gross', 'Advance', 'Net Pay'],
          ['25924', 'Ram Kumar Sharma', '34000', '6000', '28000']
        ]
      }
    };

    // First process: should deduct installment of ₹6,000
    const res1 = desktop.mockWindow.ATPLAdvanceManager.processSalaryFile(novSalarySheet);
    assert.equal(res1.processed, 1, 'Must deduct advance');
    assert.equal(res1.deductions[0].deductedAmount, 6000);
    assert.equal(res1.deductions[0].remainingBalance, 12000);

    const ramAfter1 = desktop.mockWindow.ATPLAdvanceManager.getAllAdvances().find(a => a.id === 'adv_ram_1');
    assert.equal(ramAfter1.balanceAmount, 12000);
    assert.equal(ramAfter1.status, 'PARTIAL');

    // IDEMPOTENCY CHECK: Process the exact same November salary sheet again
    const resDuplicate = desktop.mockWindow.ATPLAdvanceManager.processSalaryFile(novSalarySheet);
    assert.equal(resDuplicate.processed, 0, 'Re-processing the same sheet must deduct ZERO (idempotent)');
    assert.equal(ramAfter1.balanceAmount, 12000, 'Balance must remain ₹12,000 without duplication');

    await new Promise(r => setTimeout(r, 50));

    // Verify Mobile reflects the deduction from the cloud
    const mobile = createMockBrowser('Mobile_Observer', cloudStorage);
    const ctxMobile = vm.createContext(mobile.mockWindow);
    vm.runInContext(advanceJsCode, ctxMobile);
    await mobile.mockWindow.ATPLAdvanceManager.syncNow(false);

    const ramMobile = mobile.mockWindow.ATPLAdvanceManager.getAllAdvances().find(a => a.id === 'adv_ram_1');
    assert.equal(ramMobile.recoveredAmount, 6000, 'Mobile must reflect ₹6,000 deducted');
    assert.equal(ramMobile.balanceAmount, 12000, 'Mobile must reflect ₹12,000 remaining');
    assert.equal(mobile.mockWindow.ATPLAdvanceManager.getAllDeductions().length, 1);
  });

  await t.test('Test 6: Verify All Files and google-drive-sync continue working exactly as before', () => {
    // Verify atpl-google-drive-sync.js compiles and exports all required globals
    assert.doesNotThrow(() => {
      new vm.Script(googleSyncJsCode);
    }, 'atpl-google-drive-sync.js must compile cleanly');

    assert.ok(googleSyncJsCode.includes('callGoogleBackend'), 'Must preserve callGoogleBackend');
    assert.ok(googleSyncJsCode.includes('uploadFile'), 'Must preserve uploadFile');
    assert.ok(googleSyncJsCode.includes('downloadFile'), 'Must preserve downloadFile');
    assert.ok(googleSyncJsCode.includes('deleteFile'), 'Must preserve deleteFile');
    assert.ok(googleSyncJsCode.includes('saveEmployeeMaster'), 'Must preserve saveEmployeeMaster');
  });

  await t.test('Test 7: Manual Advance Deduction and Deduction Reversal sync cleanly across devices', async () => {
    const desktop = createMockBrowser('Desktop_Manual_Entry', cloudStorage);
    const ctxDesktop = vm.createContext(desktop.mockWindow);
    vm.runInContext(advanceJsCode, ctxDesktop);
    await desktop.mockWindow.ATPLAdvanceManager.syncNow(false);

    // Ram currently has 12000 remaining; manually cut 3500
    const manRes = desktop.mockWindow.ATPLAdvanceManager.deductAdvanceManually({
      empCode: '25924',
      amount: 3500,
      deductionDate: '2026-11-12',
      mode: 'Manual Cash Recovery',
      remarks: 'Paid cash at counter'
    });
    assert.equal(manRes.ok, true);
    assert.equal(desktop.mockWindow.ATPLAdvanceManager.getEmployeeOutstandingBalance('25924'), 8500);
    await new Promise(r => setTimeout(r, 60));

    // Mobile syncs and sees both Salary Sheet (6000) + Manual Cut (3500)
    const mobile = createMockBrowser('Mobile_Manual_Check', cloudStorage);
    const ctxMobile = vm.createContext(mobile.mockWindow);
    vm.runInContext(advanceJsCode, ctxMobile);
    await mobile.mockWindow.ATPLAdvanceManager.syncNow(false);

    const histMobile = mobile.mockWindow.ATPLAdvanceManager.getEmployeeHistoryData('25924');
    assert.equal(histMobile.totalSalaryCut, 6000);
    assert.equal(histMobile.totalManualCut, 3500);
    assert.equal(histMobile.totalRemaining, 8500);

    // Reverse/Delete manual deduction on Mobile -> must also stay deleted on Desktop after sync
    const dedId = manRes.deductions[0].id;
    assert.equal(mobile.mockWindow.ATPLAdvanceManager.deleteDeduction(dedId), true);
    assert.equal(mobile.mockWindow.ATPLAdvanceManager.getEmployeeOutstandingBalance('25924'), 12000);
    await new Promise(r => setTimeout(r, 60));

    await desktop.mockWindow.ATPLAdvanceManager.syncNow(false);
    assert.equal(desktop.mockWindow.ATPLAdvanceManager.getEmployeeOutstandingBalance('25924'), 12000);
    assert.equal(desktop.mockWindow.ATPLAdvanceManager.getAllDeductions().length, 1);

    // Delete entire employee ledger for 25924 on Mobile and verify Desktop deletes it cleanly via cloud tombstones
    mobile.mockWindow.ATPLAdvanceManager.addOrUpdateAdvance({
      id: 'adv_nikhil_keep',
      empCode: '26448',
      amount: 9000,
      advanceDate: '2026-11-12',
      remarks: 'Keep other employee'
    });
    const removedCount = mobile.mockWindow.ATPLAdvanceManager.deleteEmployeeLedger('25924');
    assert.equal(removedCount, 1);
    await new Promise(r => setTimeout(r, 60));

    await desktop.mockWindow.ATPLAdvanceManager.syncNow(false);
    assert.equal(desktop.mockWindow.ATPLAdvanceManager.getAllAdvances().some(a => a.empCode === '25924'), false, 'Deleted employee ledger must stay deleted across devices');
    assert.equal(desktop.mockWindow.ATPLAdvanceManager.getAllDeductions().some(d => d.empCode === '25924'), false, 'Deleted employee deductions must stay deleted across devices');
    assert.equal(desktop.mockWindow.ATPLAdvanceManager.getEmployeeOutstandingBalance('26448'), 9000, 'Other employee advance must sync intact');
  });

  await t.test('Test 8: Diary / Director Signed Advance Slip uploads in row, stays quota-safe, and syncs across all browsers', async () => {
    const serverJsCode = fs.readFileSync(path.join(rootDir, 'server.js'), 'utf8');
    assert.ok(serverJsCode.includes("app.post('/api/sync/advance-slip'"), 'server.js must expose POST /api/sync/advance-slip');
    assert.ok(serverJsCode.includes("app.get('/api/sync/advance-slip/:id'"), 'server.js must expose GET /api/sync/advance-slip/:id');
    assert.ok(serverJsCode.includes("app.delete('/api/sync/advance-slip/:id'"), 'server.js must expose DELETE /api/sync/advance-slip/:id');
    assert.ok(serverJsCode.includes("'advance_slip_saved'") && serverJsCode.includes("'advance_slip_deleted'"), 'server.js must broadcast SSE slip events');

    const desktop = createMockBrowser('Desktop_Slip_Uploader', cloudStorage);
    vm.runInContext(advanceJsCode, vm.createContext(desktop.mockWindow));
    await desktop.mockWindow.ATPLAdvanceManager.syncNow(false);

    // Ensure advance record exists with clean initial state
    desktop.mockWindow.ATPLAdvanceManager.addOrUpdateAdvance({
      id: 'adv_slip_test_1',
      empCode: '25924',
      amount: 12000,
      monthlyCap: 4000,
      advanceDate: '2026-11-17',
      remarks: 'Diary signed advance test'
    });

    // 1. Row must show Upload Slip button directly next to the advance
    const beforeTableHtml = desktop.mockWindow._elements.advanceModuleContainer.innerHTML;
    assert.ok(beforeTableHtml.includes('Signed Slip'), 'Advances table must have Signed Slip column');
    assert.ok(beforeTableHtml.includes("ATPLAdvanceManager.openSlipModal('adv_slip_test_1')") && beforeTableHtml.includes("Upload Slip"), "Each advance row must render Upload Slip button");

    // 2. Add/Edit Advance modal & Employee History / Statement modals also expose Signed Slip controls
    desktop.mockWindow.ATPLAdvanceManager.openNewModal('25924');
    assert.ok(desktop.mockWindow._elements.advModal.innerHTML.includes('advFormSlipFile'), 'New/Edit Advance modal must include optional Signed Slip file picker');
    desktop.mockWindow.ATPLAdvanceManager.viewEmployeeHistory('25924');
    assert.ok(desktop.mockWindow._elements.advModal.innerHTML.includes('Signed Slip'), 'Employee History modal must show Signed Slip column');
    desktop.mockWindow.ATPLAdvanceManager.viewStatement('adv_slip_test_1');
    assert.ok(desktop.mockWindow._elements.advModal.innerHTML.includes('Diary / Director Signed Advance Slip'), 'Advance Statement modal must show Signed Slip section');

    // 3. Upload a Director-signed Diary Slip photo in Browser A
    const sampleDataUrl = 'data:image/jpeg;base64,' + Buffer.from('DIRECTOR_SIGNED_DIARY_SLIP_BINARY_MOCK').toString('base64');
    const upRes = await desktop.mockWindow.ATPLAdvanceManager.uploadAdvanceSlip('adv_slip_test_1', {
      fileName: 'diary_slip_25924.jpg',
      mimeType: 'image/jpeg',
      size: 2048,
      signedBy: 'Sarthak ji',
      note: 'Diary Pg 22 - Account Paid',
      dataUrl: sampleDataUrl
    });
    assert.equal(upRes.ok, true, 'Slip upload must succeed');
    assert.equal(upRes.synced, true, 'Slip must sync to cloud');

    // Row button updates immediately to Saved Slip with Director name
    const afterTableHtml = desktop.mockWindow._elements.advanceModuleContainer.innerHTML;
    assert.ok(afterTableHtml.includes('✅ Slip (Sarthak ji)'), 'Row button must reflect saved Director signed slip');

    // Separate slip cloud file exists and main advance JSON stays lightweight (no dataUrl bloat)
    const expectedCloudSlipKey = 'ATPL_ADV_SLIP_adv_slip_test_1.json';
    assert.ok(cloudStorage.files[expectedCloudSlipKey], 'Cloud storage must hold dedicated slip blob file');
    const mainLocalJson = desktop.storage['ATPL_AdvanceRecordsV2'] || '';
    assert.equal(mainLocalJson.includes(sampleDataUrl), false, 'Main advance localStorage must NOT embed heavy base64 slip dataUrl');

    // 4. Browser B (fresh browser, empty storage) syncs and retrieves both metadata and full slip payload
    const mobile = createMockBrowser('Mobile_Account_Browser', cloudStorage);
    // Simulate cloud listing accidentally containing the slip JSON in FILES to verify cleanup guard
    mobile.mockWindow.FILES = [
      { name: 'JUNE_SALARY.xlsx', sheets: {} },
      { name: 'ATPL_ADV_SLIP_adv_slip_test_1.json' }
    ];
    vm.runInContext(advanceJsCode, vm.createContext(mobile.mockWindow));
    const syncB = await mobile.mockWindow.ATPLAdvanceManager.syncNow(false);
    assert.equal(syncB.ok, true, 'Browser B sync must succeed');
    assert.equal(mobile.mockWindow.FILES.some(f => f.name.toLowerCase().includes('atpl_adv_slip_')), false, 'Advance slip JSONs must be filtered out of window.FILES');

    const advB = mobile.mockWindow.ATPLAdvanceManager.getAllAdvances().find(a => a.id === 'adv_slip_test_1');
    assert.ok(advB && advB.signedSlip, 'Browser B must receive signedSlip metadata');
    assert.equal(advB.signedSlip.signedBy, 'Sarthak ji');
    assert.equal(advB.signedSlip.fileName, 'diary_slip_25924.jpg');
    assert.ok(mobile.mockWindow._elements.advanceModuleContainer.innerHTML.includes('✅ Slip (Sarthak ji)'), 'Browser B row UI must show Saved Slip badge');

    const fetchedSlipB = await mobile.mockWindow.ATPLAdvanceManager.fetchAdvanceSlipData('adv_slip_test_1');
    assert.ok(fetchedSlipB, 'Browser B must download slip payload');
    assert.equal(fetchedSlipB.dataUrl, sampleDataUrl, 'Browser B must receive exact uploaded slip image/PDF dataUrl');

    // 5. Editing advance amount preserves signedSlip metadata
    desktop.mockWindow.ATPLAdvanceManager.addOrUpdateAdvance({
      id: 'adv_slip_test_1',
      empCode: '25924',
      amount: 13500,
      monthlyCap: 4500,
      advanceDate: '2026-11-17',
      remarks: 'Edited amount preserves slip'
    });
    const editedAdv = desktop.mockWindow.ATPLAdvanceManager.getAllAdvances().find(a => a.id === 'adv_slip_test_1');
    assert.ok(editedAdv.signedSlip && editedAdv.signedSlip.slipId, 'Editing advance must preserve signedSlip metadata');
    await new Promise(r => setTimeout(r, 40));

    // 6. Removing slip on Browser B clears cloud slip and syncs removal back to Browser A
    await mobile.mockWindow.ATPLAdvanceManager.syncNow(false);
    const remOk = await mobile.mockWindow.ATPLAdvanceManager.removeAdvanceSlip('adv_slip_test_1');
    assert.equal(remOk, true, 'Slip removal must succeed');
    assert.equal(cloudStorage.files[expectedCloudSlipKey], undefined, 'Cloud slip blob must be deleted when slip removed');

    await desktop.mockWindow.ATPLAdvanceManager.syncNow(false);
    const advAfterRemA = desktop.mockWindow.ATPLAdvanceManager.getAllAdvances().find(a => a.id === 'adv_slip_test_1');
    assert.equal(advAfterRemA.signedSlip, null, 'Browser A must reflect slip removal after sync');
    assert.ok(desktop.mockWindow._elements.advanceModuleContainer.innerHTML.includes('Upload Slip'), 'Browser A row must revert to Upload Slip button');
  });

  await t.test('Test 9: Add More Slip + More Adv Date in Slip modal stay quota-safe and sync across all browsers', async () => {
    const desktop = createMockBrowser('Desktop_MultiSlip', cloudStorage);
    vm.runInContext(advanceJsCode, vm.createContext(desktop.mockWindow));
    await desktop.mockWindow.ATPLAdvanceManager.syncNow(false);

    desktop.mockWindow.ATPLAdvanceManager.addOrUpdateAdvance({
      id: 'adv_multi_slip_1',
      empCode: '26448',
      amount: 18000,
      monthlyCap: 3000,
      advanceDate: '2026-10-10',
      remarks: 'Multi slip & more date test'
    });

    // 1. Open slip modal -> must expose Slip Adv Date + More Adv Date controls
    desktop.mockWindow.ATPLAdvanceManager.openSlipModal('adv_multi_slip_1');
    const modalHtml1 = desktop.mockWindow._elements.advModal.innerHTML;
    assert.ok(modalHtml1.includes('advSlipAdvDate'), 'Slip modal must include Slip Adv Date input');
    assert.ok(modalHtml1.includes('advSlipMoreDateInput') && modalHtml1.includes('+ More Adv Date'), 'Slip modal must include + More Adv Date control');

    // 2. Upload Slip #1 (Main Date 2026-10-10)
    const slip1DataUrl = 'data:image/jpeg;base64,' + Buffer.from('SLIP_ONE_BINARY_MOCK').toString('base64');
    const r1 = await desktop.mockWindow.ATPLAdvanceManager.uploadAdvanceSlip('adv_multi_slip_1', {
      fileName: 'slip_1_26448.jpg',
      mimeType: 'image/jpeg',
      size: 1536,
      advDate: '2026-10-10',
      signedBy: 'Sarthak ji',
      note: 'Diary Pg 101',
      dataUrl: slip1DataUrl
    });
    assert.equal(r1.ok, true);
    assert.equal(r1.slipCount, 1);

    // Re-open modal -> must show "+ Add More Slip" button now that 1st slip exists
    desktop.mockWindow.ATPLAdvanceManager.openSlipModal('adv_multi_slip_1');
    const modalHtml2 = desktop.mockWindow._elements.advModal.innerHTML;
    assert.ok(modalHtml2.includes('advAddMoreSlipBtn') && modalHtml2.includes('+ Add More Slip'), 'Slip modal must show + Add More Slip button once first slip is saved');

    // Switch to "+ Add More Slip" mode cleanly
    desktop.mockWindow.ATPLAdvanceManager.startAddMoreSlip('adv_multi_slip_1');
    const modalAddMoreHtml = desktop.mockWindow._elements.advModal.innerHTML;
    assert.ok(modalAddMoreHtml.includes('Add More Slip (Slip #2)'), 'startAddMoreSlip must switch modal to Add More Slip mode');

    // 3. Upload Slip #2 with its own Slip Adv Date (2026-10-18)
    const slip2DataUrl = 'data:image/jpeg;base64,' + Buffer.from('SLIP_TWO_BINARY_MOCK').toString('base64');
    const r2 = await desktop.mockWindow.ATPLAdvanceManager.addMoreAdvanceSlip('adv_multi_slip_1', {
      fileName: 'slip_2_26448.jpg',
      mimeType: 'image/jpeg',
      size: 1840,
      advDate: '2026-10-18',
      signedBy: 'Nikhil ji',
      note: 'Diary Pg 118',
      dataUrl: slip2DataUrl
    });
    assert.equal(r2.ok, true);
    assert.equal(r2.slipCount, 2);

    // 4. Add another More Adv Date explicitly (2026-10-25)
    const dRes = await desktop.mockWindow.ATPLAdvanceManager.addMoreAdvDate('adv_multi_slip_1', '2026-10-25');
    assert.equal(dRes.ok, true);
    assert.equal(dRes.synced, true);

    const advA = desktop.mockWindow.ATPLAdvanceManager.getAllAdvances().find(a => a.id === 'adv_multi_slip_1');
    assert.equal(advA.signedSlips.length, 2, 'Advance must hold both slips in signedSlips');
    assert.deepEqual(Array.from(advA.moreAdvanceDates), ['2026-10-18', '2026-10-25'], 'Advance must store both extra advance dates sorted');

    const cloudKey1 = 'ATPL_ADV_SLIP_adv_multi_slip_1.json';
    const cloudKey2 = advA.signedSlips[1].cloudFileName;
    assert.ok(cloudStorage.files[cloudKey1], 'Cloud must keep first slip blob');
    assert.ok(cloudKey2 && cloudKey2 !== cloudKey1 && cloudStorage.files[cloudKey2], 'Cloud must keep separate blob for 2nd slip');

    const tableHtmlA = desktop.mockWindow._elements.advanceModuleContainer.innerHTML;
    assert.ok(tableHtmlA.includes('✅ 2 Slips'), 'Advances table must show 2 Slips count badge');
    assert.ok(tableHtmlA.includes('+2 More Date'), 'Advances table Date cell must indicate extra advance dates');

    // 5. Fresh Browser B syncs and receives BOTH slips, BOTH images, BOTH extra dates, and date filter match
    const mobile = createMockBrowser('Mobile_MultiSlip', cloudStorage);
    vm.runInContext(advanceJsCode, vm.createContext(mobile.mockWindow));
    const syncB = await mobile.mockWindow.ATPLAdvanceManager.syncNow(false);
    assert.equal(syncB.ok, true);

    const advB = mobile.mockWindow.ATPLAdvanceManager.getAllAdvances().find(a => a.id === 'adv_multi_slip_1');
    assert.ok(advB && advB.signedSlips && advB.signedSlips.length === 2, 'Browser B must receive both slips');
    assert.deepEqual(Array.from(advB.moreAdvanceDates), ['2026-10-18', '2026-10-25'], 'Browser B must receive extra advance dates');
    assert.ok(mobile.mockWindow._elements.advanceModuleContainer.innerHTML.includes('✅ 2 Slips'), 'Browser B UI must show 2 Slips');

    const fetched1 = await mobile.mockWindow.ATPLAdvanceManager.fetchAdvanceSlipData('adv_multi_slip_1', advB.signedSlips[0].slipId);
    const fetched2 = await mobile.mockWindow.ATPLAdvanceManager.fetchAdvanceSlipData('adv_multi_slip_1', advB.signedSlips[1].slipId);
    assert.equal(fetched1 && fetched1.dataUrl, slip1DataUrl, 'Browser B must fetch Slip #1 payload accurately');
    assert.equal(fetched2 && fetched2.dataUrl, slip2DataUrl, 'Browser B must fetch Slip #2 payload accurately');

    // Selecting an extra date in Date Picker must still match and show this advance row
    mobile.mockWindow.ATPLAdvanceManager.setSelectedDate('2026-10-25');
    assert.ok(mobile.mockWindow._elements.advanceModuleContainer.innerHTML.includes('adv_multi_slip_1'), 'Date filter must match extra advance date');
    mobile.mockWindow.ATPLAdvanceManager.setSelectedDate('');

    // 6. Selective delete of Slip #2 in Browser B removes only Slip #2 and preserves Slip #1 across browsers
    const delSlip2 = await mobile.mockWindow.ATPLAdvanceManager.removeAdvanceSlip('adv_multi_slip_1', advB.signedSlips[1].slipId);
    assert.equal(delSlip2, true);
    assert.equal(cloudStorage.files[cloudKey2], undefined, 'Slip #2 cloud blob must be deleted');
    assert.ok(cloudStorage.files[cloudKey1], 'Slip #1 cloud blob must remain intact');

    // Remove extra date 2026-10-25 as well
    const delDate = await mobile.mockWindow.ATPLAdvanceManager.removeMoreAdvDate('adv_multi_slip_1', '2026-10-25');
    assert.equal(delDate, true);

    await desktop.mockWindow.ATPLAdvanceManager.syncNow(false);
    const advAfterRemA = desktop.mockWindow.ATPLAdvanceManager.getAllAdvances().find(a => a.id === 'adv_multi_slip_1');
    assert.equal(advAfterRemA.signedSlips.length, 1, 'Browser A must show only 1 slip after selective delete');
    assert.equal(advAfterRemA.signedSlip.signedBy, 'Sarthak ji', 'Slip #1 must remain intact on Browser A');
    assert.deepEqual(Array.from(advAfterRemA.moreAdvanceDates), ['2026-10-18'], 'Browser A must reflect removed extra date');
  });
});
