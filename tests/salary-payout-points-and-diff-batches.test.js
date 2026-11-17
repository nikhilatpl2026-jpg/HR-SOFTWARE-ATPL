'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const rootDir = path.resolve(__dirname, '..');
const payoutJs = fs.readFileSync(path.join(rootDir, 'atpl-salary-payout.js'), 'utf8');
const htmlCode = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');
const serverCode = fs.readFileSync(path.join(rootDir, 'server.js'), 'utf8');
const guardCode = fs.readFileSync(path.join(rootDir, 'erp-permission-guard-v1.js'), 'utf8');

function createBrowser(name, sharedCloud) {
  const ls = {};
  const elements = {
    salaryPayoutContainer: { innerHTML: '' },
    salPayoutModal: { id: 'salPayoutModal', innerHTML: '' }
  };
  const masterPushLog = [];
  const mockWindow = {
    name,
    localStorage: {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(ls, k) ? ls[k] : null),
      setItem: (k, v) => { ls[k] = String(v); },
      removeItem: (k) => { delete ls[k]; }
    },
    document: {
      readyState: 'complete',
      hidden: false,
      addEventListener: () => {},
      getElementById: (id) => elements[id] || null,
      createElement: () => ({ style: {}, setAttribute: () => {}, click: () => {} }),
      body: { appendChild: () => {}, removeChild: () => {} }
    },
    addEventListener: () => {},
    BroadcastChannel: class {
      postMessage(msg) { if (sharedCloud.onBc) sharedCloud.onBc(name, msg); }
      close() {}
    },
    EM: {
      data: [
        { emp_id: '25924', name: 'Ram Kumar Sharma', dept: 'Spinning', desig: 'Operator', account_no: '111122223333', ifsc: 'SBIN0000111' },
        { emp_id: '00387', name: 'Surendra Kumar', dept: 'Blend', desig: 'Leader', account_no: '444455556666', ifsc: 'SBIN0000222' },
        { emp_id: '26448', name: 'Nikhil Arora', dept: 'Staff', desig: 'Incharge', account_no: '777788889999', ifsc: 'HDFC0000333' }
      ]
    },
    FILES: [],
    showToast: () => {},
    ATPLGoogleSync: {
      callGoogleBackend: async (action, params) => sharedCloud.handleGas(action, params),
      pushEmployeeAndVaultToCloud: (arr) => { masterPushLog.push(arr.map(x => ({ ...x }))); }
    }
  };
  mockWindow.window = mockWindow;
  return { mockWindow, ls, elements, masterPushLog };
}

test('Salary Payout Dashboard: Emp Points, Compliance Bank Returns & Multi-Part Diff Batches Sync', async (t) => {
  const cloud = {
    files: {},
    handleGas: async (action, params) => {
      if (action === 'uploadFile') {
        cloud.files[params.fileName] = { fileBase64: params.fileBase64, mimeType: params.mimeType };
        return { ok: true };
      }
      if (action === 'downloadFile') {
        const f = cloud.files[params.fileName];
        return f ? { ok: true, fileBase64: f.fileBase64 } : { ok: false, error: 'not_found' };
      }
      return { ok: false };
    }
  };

  await t.test('1. HTML, Permission Guard & Server Sync Endpoints are cleanly wired', () => {
    assert.doesNotThrow(() => new vm.Script(payoutJs));
    assert.ok(htmlCode.includes('id="vn-salarypayout"'), 'Sidebar must include vn-salarypayout');
    assert.ok(htmlCode.includes('id="page-salarypayout"'), 'HTML must include page-salarypayout');
    assert.ok(htmlCode.includes('id="salaryPayoutContainer"'), 'HTML must include salaryPayoutContainer');
    assert.ok(htmlCode.includes('src="atpl-salary-payout.js"'), 'HTML must load atpl-salary-payout.js');
    assert.ok(guardCode.includes('salarypayout:1'), 'Permission guard MASTER_READ must allow salarypayout');
    assert.ok(serverCode.includes("app.get('/api/sync/salary-payout'"), 'server.js must expose GET /api/sync/salary-payout');
    assert.ok(serverCode.includes("app.post('/api/sync/salary-payout'"), 'server.js must expose POST /api/sync/salary-payout');
    assert.ok(serverCode.includes("'salary_payout_updated'"), 'server.js must emit salary_payout_updated SSE');
  });

  await t.test('2. Imports month salary workbook and computes Compliance + Diff dashboard totals', async () => {
    const bA = createBrowser('BrowserA', cloud);
    vm.runInContext(payoutJs, vm.createContext(bA.mockWindow));
    bA.mockWindow.ATPLSalaryPayout.setSelectedMonth('2026-11');

    bA.mockWindow.FILES.push({
      name: 'NOV_2026_SALARY.xlsx',
      sheets: {
        'Workers': [
          ['Emp Code', 'Name', 'Dept', 'Net Pay', 'Diff Amount', 'Manual Amount'],
          ['25924', 'Ram Kumar Sharma', 'Spinning', 18000, 4150, 22150],
          ['00387', 'Surendra Kumar', 'Blend', 24000, 10000, 34000],
          ['26448', 'Nikhil Arora', 'Staff', 30000, 15000, 45000]
        ]
      }
    });

    const impRes = bA.mockWindow.ATPLSalaryPayout.importFromLoadedFile('NOV_2026_SALARY.xlsx', '2026-11');
    assert.equal(impRes.ok, true);
    assert.equal(impRes.imported, 3);

    const ledger = bA.mockWindow.ATPLSalaryPayout.computeMonthLedger('2026-11');
    assert.equal(ledger.complianceTotal, 72000);
    assert.equal(ledger.diffTotal, 29150);
    assert.equal(ledger.totalMonthSalary, 101150);
    await new Promise(r => setTimeout(r, 40));
    assert.ok(cloud.files['ATPL_SALARY_PAYOUT_DATA.json'], 'Salary payout data must upload to cloud');
  });

  await t.test('3. Emp Code adjustment points (+ Add / - Less) adjust Net Diff & sync across browsers with tombstones', async () => {
    const bA = createBrowser('BrowserA_Pts', cloud);
    vm.runInContext(payoutJs, vm.createContext(bA.mockWindow));
    await bA.mockWindow.ATPLSalaryPayout.syncNow(false);
    bA.mockWindow.ATPLSalaryPayout.setSelectedMonth('2026-11');

    // Add +500 extra for 25924 (4150 + 500 = 4650), and -1500 cut for 00387 (10000 - 1500 = 8500)
    const p1 = bA.mockWindow.ATPLSalaryPayout.addOrUpdatePoint({
      monthKey: '2026-11',
      empCode: '25924',
      direction: 'ADD',
      applyTo: 'DIFF',
      amount: 500,
      note: 'Extra machine overtime point'
    });
    const p2 = bA.mockWindow.ATPLSalaryPayout.addOrUpdatePoint({
      monthKey: '2026-11',
      empCode: '00387',
      direction: 'DEDUCT',
      applyTo: 'DIFF',
      amount: 1500,
      note: '2 days absent kam point'
    });
    assert.equal(p1.ok, true);
    assert.equal(p2.ok, true);
    await new Promise(r => setTimeout(r, 50));

    // Fresh Browser B loads from cloud
    const bB = createBrowser('BrowserB_Pts', cloud);
    bB.mockWindow.FILES = [{ name: 'ATPL_SALARY_PAYOUT_DATA.json' }, { name: 'OCT_SALARY.xlsx', sheets: {} }];
    vm.runInContext(payoutJs, vm.createContext(bB.mockWindow));
    const syncRes = await bB.mockWindow.ATPLSalaryPayout.syncNow(false);
    assert.equal(syncRes.ok, true);
    assert.equal(bB.mockWindow.FILES.some(f => f.name === 'ATPL_SALARY_PAYOUT_DATA.json'), false, 'Cloud JSON must be filtered from window.FILES');
    bB.mockWindow.ATPLSalaryPayout.setSelectedMonth('2026-11');

    const ledgerB = bB.mockWindow.ATPLSalaryPayout.computeMonthLedger('2026-11');
    const ramB = ledgerB.rows.find(r => r.empCode === '25924');
    const surB = ledgerB.rows.find(r => r.empCode === '00387');
    assert.equal(ramB.netDiffAmount, 4650, 'Browser B must apply +500 point to Ram');
    assert.equal(surB.netDiffAmount, 8500, 'Browser B must apply -1500 point to Surendra');

    // Delete p1 on Browser B -> tombstone prevents resurrection on Browser A
    assert.equal(bB.mockWindow.ATPLSalaryPayout.deletePoint(p1.record.id), true);
    await new Promise(r => setTimeout(r, 50));
    await bA.mockWindow.ATPLSalaryPayout.syncNow(false);
    const ramA = bA.mockWindow.ATPLSalaryPayout.computeMonthLedger('2026-11').rows.find(r => r.empCode === '25924');
    assert.equal(ramA.netDiffAmount, 4150, 'Deleted point must remain deleted across browsers');
  });

  await t.test('4. Compliance Bank Return A/C change updates Employee Master & tracks Re-Transfer', async () => {
    const bA = createBrowser('BrowserA_Ret', cloud);
    vm.runInContext(payoutJs, vm.createContext(bA.mockWindow));
    await bA.mockWindow.ATPLSalaryPayout.syncNow(false);
    bA.mockWindow.ATPLSalaryPayout.setSelectedMonth('2026-11');

    bA.mockWindow.ATPLSalaryPayout.saveMonthSummary({
      monthKey: '2026-11',
      complianceDisbursed: true,
      complianceDate: '2026-11-05',
      complianceUtr: 'NEFT_COMP_001'
    });

    const retRes = bA.mockWindow.ATPLSalaryPayout.addOrUpdateReturn({
      monthKey: '2026-11',
      empCode: '25924',
      amount: 18000,
      reason: 'Wrong Account Number',
      newAccountNo: '999900001111',
      newIfsc: 'BARB0BIKANER',
      newBankName: 'Bank of Baroda',
      updateMaster: true
    });
    assert.equal(retRes.ok, true);
    assert.equal(retRes.masterSynced, true, 'Must update Employee Master when updateMaster=true');
    const emRam = bA.mockWindow.EM.data.find(e => e.emp_id === '25924');
    assert.equal(emRam.account_no, '999900001111');
    assert.equal(emRam.ifsc, 'BARB0BIKANER');
    assert.equal(bA.masterPushLog.length, 1, 'Must push updated bank A/C to Employee Master cloud');

    bA.mockWindow.ATPLSalaryPayout.markReturnRetransferred(retRes.record.id, 'UTR_REPAY_789', '2026-11-08');
    await new Promise(r => setTimeout(r, 50));

    const bB = createBrowser('BrowserB_Ret', cloud);
    vm.runInContext(payoutJs, vm.createContext(bB.mockWindow));
    await bB.mockWindow.ATPLSalaryPayout.syncNow(false);
    bB.mockWindow.ATPLSalaryPayout.setSelectedMonth('2026-11');
    const ledgerB = bB.mockWindow.ATPLSalaryPayout.computeMonthLedger('2026-11');
    assert.equal(ledgerB.summary.complianceDisbursed, true);
    assert.equal(ledgerB.returns.length, 1);
    assert.equal(ledgerB.returns[0].status, 'RETRANSFERRED');
    assert.equal(ledgerB.returns[0].newAccountNo, '999900001111');
    assert.equal(ledgerB.pendingReturnCount, 0);
  });

  await t.test('5. Diff 4-6 multi-part batches (Workers, Staff, Leaders) & exact ₹150 small leftover detection & clearance', async () => {
    const bA = createBrowser('BrowserA_Diff', cloud);
    vm.runInContext(payoutJs, vm.createContext(bA.mockWindow));
    await bA.mockWindow.ATPLSalaryPayout.syncNow(false);
    bA.mockWindow.ATPLSalaryPayout.setSelectedMonth('2026-11');

    // Part 1: Workers partial payment -> Ram (4150) paid 4000, leaving exact ₹150!
    bA.mockWindow.ATPLSalaryPayout.addOrUpdateDiffBatch({
      monthKey: '2026-11',
      partNumber: 1,
      title: 'Part 1 - Workers Lot',
      lotType: 'WORKERS_LOT',
      paymentDate: '2026-11-10',
      mode: 'Bank NEFT / RTGS',
      signedBy: 'Sarthak ji',
      status: 'DISBURSED',
      allocations: [{ empCode: '25924', amount: 4000 }]
    });

    // Part 2: Staff Lot -> Nikhil (15000) paid full
    bA.mockWindow.ATPLSalaryPayout.addOrUpdateDiffBatch({
      monthKey: '2026-11',
      partNumber: 2,
      title: 'Part 2 - Staff Lot',
      lotType: 'STAFF_LOT',
      paymentDate: '2026-11-12',
      mode: 'Bank NEFT / RTGS',
      signedBy: 'Manish ji',
      status: 'DISBURSED',
      allocations: [{ empCode: '26448', amount: 15000 }]
    });

    // Part 3: 2-3 Leaders Lot -> Surendra (8500 net after -1500 point) paid 8500
    bA.mockWindow.ATPLSalaryPayout.addOrUpdateDiffBatch({
      monthKey: '2026-11',
      partNumber: 3,
      title: 'Part 3 - Leaders Lot',
      lotType: 'LEADERS_LOT',
      paymentDate: '2026-11-14',
      mode: 'Bank NEFT / RTGS',
      signedBy: 'Ayush ji',
      status: 'DISBURSED',
      allocations: [{ empCode: '00387', amount: 8500 }]
    });

    const midLedger = bA.mockWindow.ATPLSalaryPayout.computeMonthLedger('2026-11');
    assert.equal(midLedger.batches.length, 3);
    assert.equal(midLedger.totalBatchPaid, 27500);
    assert.equal(midLedger.diffRemainingTotal, 150, 'Only ₹150 leftover must remain');
    assert.equal(midLedger.smallLeftoverRows.length, 1);
    assert.equal(midLedger.smallLeftoverRows[0].empCode, '25924');
    assert.equal(midLedger.smallLeftoverRows[0].diffRemaining, 150);

    // Part 4: Small Leftover Clearance batch pays the ₹150
    bA.mockWindow.ATPLSalaryPayout.addOrUpdateDiffBatch({
      monthKey: '2026-11',
      partNumber: 4,
      title: 'Part 4 - Small Leftover Clearance',
      lotType: 'LEFTOVER_CLEARANCE',
      paymentDate: '2026-11-17',
      mode: 'Cash',
      signedBy: 'Sarthak ji',
      status: 'DISBURSED',
      allocations: [{ empCode: '25924', amount: 150 }]
    });
    await new Promise(r => setTimeout(r, 50));

    // Browser B verifies all 4 parts & ₹0 remaining
    const bB = createBrowser('BrowserB_Diff', cloud);
    vm.runInContext(payoutJs, vm.createContext(bB.mockWindow));
    await bB.mockWindow.ATPLSalaryPayout.syncNow(false);
    bB.mockWindow.ATPLSalaryPayout.setSelectedMonth('2026-11');

    const finalLedger = bB.mockWindow.ATPLSalaryPayout.computeMonthLedger('2026-11');
    assert.equal(finalLedger.batches.length, 4);
    assert.equal(finalLedger.totalBatchPaid, 27650);
    assert.equal(finalLedger.diffRemainingTotal, 0);
    assert.equal(finalLedger.smallLeftoverRows.length, 0);
  });
});
