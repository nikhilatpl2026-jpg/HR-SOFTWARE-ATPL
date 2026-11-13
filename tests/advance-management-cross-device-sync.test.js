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
    document: {
      addEventListener: () => {},
      getElementById: () => null,
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
});
