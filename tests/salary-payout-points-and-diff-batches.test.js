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

  await t.test('6. Two separate sheets (Compliance sheet + Diff sheet), Batch Bank Sheet with Account lookup & Remarks, and cross-browser sync', async () => {
    const bA = createBrowser('BrowserA_Sep', cloud);
    vm.runInContext(payoutJs, vm.createContext(bA.mockWindow));
    bA.mockWindow.ATPLSalaryPayout.setSelectedMonth('2026-12');

    bA.mockWindow.FILES.push({
      name: 'DEC_COMPLIANCE_BANK.xlsx',
      sheets: {
        'BankTransfer': [
          ['Emp Code', 'Name of employee', 'Net Payable', 'Remarks'],
          ['25924', 'Ram Kumar Sharma', 18500, 'Comp NEFT'],
          ['26448', 'Nikhil Arora', 30000, 'Comp Staff']
        ]
      }
    });
    bA.mockWindow.FILES.push({
      name: 'DEC_DIFF_SHEET.xlsx',
      sheets: {
        'DiffSheet': [
          ['Emp Code', 'Name of employee', 'Diff Amount', 'Remarks'],
          ['25924', 'Ram Kumar Sharma', 4500, 'Workers Diff'],
          ['26448', 'Nikhil Arora', 15000, 'Staff Diff']
        ]
      }
    });

    const cRes = bA.mockWindow.ATPLSalaryPayout.importFromLoadedFile('DEC_COMPLIANCE_BANK.xlsx', '2026-12', 'COMPLIANCE');
    assert.equal(cRes.ok, true);
    assert.equal(cRes.imported, 2);

    const dRes = bA.mockWindow.ATPLSalaryPayout.importFromLoadedFile('DEC_DIFF_SHEET.xlsx', '2026-12', 'DIFF');
    assert.equal(dRes.ok, true);
    assert.equal(dRes.imported, 2);

    const decLedger = bA.mockWindow.ATPLSalaryPayout.computeMonthLedger('2026-12');
    assert.equal(decLedger.complianceTotal, 48500, 'Compliance sheet total must stay preserved after Diff import');
    assert.equal(decLedger.diffTotal, 19500, 'Diff sheet total must merge without overwriting Compliance');

    // Parse a Batch Bank Payment Sheet that uses Account No instead of Emp Code + Remarks
    const batchWb = {
      name: 'DEC_DIFF_PART1_BANK.xlsx',
      sheets: {
        'Sheet1': [
          ['Beneficiary Name', 'Account No', 'Amount', 'Remarks'],
          ['Ram Kumar Sharma', '111122223333', 4000, 'Part 1 Bank Lot'],
          ['Nikhil Arora', '777788889999', 15000, 'Staff Lot Paid']
        ]
      }
    };
    const batchRows = bA.mockWindow.ATPLSalaryPayout.extractSalaryRowsFromWorkbook(batchWb, 'BATCH');
    assert.equal(batchRows.length, 2, 'Must resolve Emp Codes via Account No lookup');
    assert.equal(batchRows[0].empCode, '25924');
    assert.equal(batchRows[0].amount, 4000);
    assert.equal(batchRows[0].remarks, 'Part 1 Bank Lot');

    bA.mockWindow.ATPLSalaryPayout.addOrUpdateDiffBatch({
      monthKey: '2026-12',
      partNumber: 1,
      title: 'Part 1 Bank Lot',
      status: 'DISBURSED',
      allocations: batchRows.map(r => ({ empCode: r.empCode, empName: r.empName, amount: r.amount, remarks: r.remarks }))
    });

    await new Promise(r => setTimeout(r, 50));
    const bB = createBrowser('BrowserB_Sep', cloud);
    vm.runInContext(payoutJs, vm.createContext(bB.mockWindow));
    await bB.mockWindow.ATPLSalaryPayout.syncNow(false);
    bB.mockWindow.ATPLSalaryPayout.setSelectedMonth('2026-12');
    const ledgerB = bB.mockWindow.ATPLSalaryPayout.computeMonthLedger('2026-12');
    assert.equal(ledgerB.complianceTotal, 48500);
    assert.equal(ledgerB.totalBatchPaid, 19000);
    assert.equal(ledgerB.diffRemainingTotal, 500);
    assert.equal(ledgerB.batches[0].allocations[0].remarks, 'Part 1 Bank Lot');
  });

  await t.test('7. Late/Missed Diff addition, Edit & Delete ledger rows with tombstone sync, and Batch Modal quick-add auto-flush', async () => {
    const bA = createBrowser('BrowserA_EditDel', cloud);
    // Provide DOM elements needed to verify submitBatchModal auto-flush when user types without clicking + Add Row
    const extraEls = {
      spBatQuickCode: { value: '00387' },
      spBatQuickAmt: { value: '500' },
      spBatQuickRem: { value: 'Missed night shift' },
      spBatPart: { value: '2' },
      spBatTitle: { value: 'Part 2 Quick Flush' },
      spBatLot: { value: 'WORKERS_LOT' },
      spBatDate: { value: '2026-12-18' },
      spBatMode: { value: 'Cash' },
      spBatSigned: { value: 'Sarthak ji' },
      spBatStatus: { value: 'DISBURSED' },
      spBatLump: { value: '' },
      spBatUtr: { value: 'CASH-22' },
      spBatNotes: { value: 'Quick auto flush' },
      spBatExtraRowsWrap: { innerHTML: '' },
      spBatModalTotal: { textContent: '' }
    };
    const origGetEl = bA.mockWindow.document.getElementById;
    bA.mockWindow.document.getElementById = (id) => extraEls[id] || origGetEl(id);
    bA.mockWindow.document.querySelectorAll = () => [];

    vm.runInContext(payoutJs, vm.createContext(bA.mockWindow));
    await bA.mockWindow.ATPLSalaryPayout.syncNow(false);
    bA.mockWindow.ATPLSalaryPayout.setSelectedMonth('2026-12');

    // 1. Add Missed / Chhoota Diff later for Ram (25924): +750 missed diff
    const missRes = bA.mockWindow.ATPLSalaryPayout.upsertEmpSalary({
      monthKey: '2026-12',
      empCode: '25924',
      addMissedDiff: 750,
      remarks: 'Chhoota hua overtime diff baad me add'
    });
    assert.equal(missRes.ok, true);
    assert.equal(missRes.record.missedDiffAmount, 750);

    // Also add brand-new missed diff entry for 00387
    bA.mockWindow.ATPLSalaryPayout.upsertEmpSalary({
      monthKey: '2026-12',
      empCode: '00387',
      addMissedDiff: 500,
      remarks: 'Surendra chhoota diff'
    });

    // Trigger submitBatchModal directly while 00387 / 500 is sitting in Quick Add inputs
    bA.mockWindow.ATPLSalaryPayout.submitBatchModal();

    const midLedger = bA.mockWindow.ATPLSalaryPayout.computeMonthLedger('2026-12');
    assert.equal(midLedger.empMissedDiffSum, 1250, 'Missed diff sum must show on dashboard immediately');
    assert.equal(midLedger.diffTotal, 20750, '19500 + 1250 missed diff = 20750');
    assert.equal(midLedger.batches.length, 2, 'submitBatchModal must auto-flush Quick Add row into Part 2');
    const bat2 = midLedger.batches.find(b => b.partNumber === 2);
    assert.equal(bat2.allocations[0].empCode, '00387');
    assert.equal(bat2.allocations[0].amount, 500);
    assert.equal(bat2.allocations[0].remarks, 'Missed night shift');

    // 2. Edit Nikhil (26448) compliance from 30000 -> 32000, then Delete 25924 ledger row with tombstone
    bA.mockWindow.ATPLSalaryPayout.upsertEmpSalary({
      monthKey: '2026-12',
      empCode: '26448',
      complianceAmount: 32000,
      remarks: 'Revised compliance'
    });
    assert.equal(bA.mockWindow.ATPLSalaryPayout.deleteEmpSalary('2026-12::25924'), true);

    await new Promise(r => setTimeout(r, 50));
    const bB = createBrowser('BrowserB_EditDel', cloud);
    vm.runInContext(payoutJs, vm.createContext(bB.mockWindow));
    await bB.mockWindow.ATPLSalaryPayout.syncNow(false);
    bB.mockWindow.ATPLSalaryPayout.setSelectedMonth('2026-12');
    const finalB = bB.mockWindow.ATPLSalaryPayout.computeMonthLedger('2026-12');
    const nikhilB = finalB.rows.find(r => r.empCode === '26448');
    const ramB = finalB.rows.find(r => r.empCode === '25924');
    assert.equal(nikhilB.complianceAmount, 32000, 'Edited compliance amount must sync across browsers');
    assert.equal(ramB.hasSalaryRecord, false, 'Deleted emp salary row must stay deleted via tombstone');
  });

  await t.test('8. Smart Human Reader: Exact Net Payment / Net Payable, PF@12%, ESIC@0.75%, Manual, multi-tab deduplication & stale replacement', async () => {
    const bA = createBrowser('BrowserA_Smart', cloud);
    vm.runInContext(payoutJs, vm.createContext(bA.mockWindow));
    bA.mockWindow.ATPLSalaryPayout.setSelectedMonth('2026-05');

    // First simulate a stale manual ₹500 target + stale extra row from an earlier wrong import
    bA.mockWindow.ATPLSalaryPayout.saveMonthSummary({ monthKey: '2026-05', complianceTarget: 9999999, diffTarget: 500 });
    bA.mockWindow.ATPLSalaryPayout.upsertEmpSalary({ monthKey: '2026-05', empCode: '99999', complianceAmount: 80000, sourceFile: 'OldBuggySheet.xlsx' });

    // Multi-tab workbook mimicking Screenshot 1 (Fourmala Sheet + duplicate PF/Bank tabs + footer Total row)
    bA.mockWindow.FILES.push({
      name: 'May 2026 Salary Sheet Atpl Final.xlsx',
      sheets: {
        'Fourmala Sheet': [
          ['Sr.No.', 'Emp Code', 'Emp Name', 'NET EARNING', 'PF 12%', 'ESIC 0.75%', 'Advance', 'Total Deduction', 'NET PAYMENT', 'MANUAL AMOUNT', 'DIFFERENCE AMOUNT'],
          [1, '25924', 'Ram Kumar Sharma', 20000, 1800, 150, 0, 1950, 18050, 22200, 4150],
          [2, '00387', 'Surendra Kumar', 26000, 1800, 0, 500, 2300, 23700, 34100, 10400],
          [3, '26448', 'Nikhil Arora', 32000, 1800, 0, 0, 1800, 30200, 45000, 14800],
          // Footer total row like row 340 in Excel screenshot (Sr.No = 1, blank code/name, huge totals)
          [1, '', '', 78000, 5400, 150, 500, 6050, 71950, 101300, 29350]
        ],
        // Filtered/split tabs containing the same employees — MUST NEVER be double/triple counted!
        'JISKO PF ME RAKH RAHE HE': [
          ['Emp Code', 'Emp Name', 'PF 12%', 'NET PAYMENT', 'MANUAL AMOUNT'],
          ['25924', 'Ram Kumar Sharma', 1800, 18050, 22200],
          ['00387', 'Surendra Kumar', 1800, 23700, 34100]
        ],
        'HDFC': [
          ['Emp Code', 'Emp Name', 'Amount'],
          ['25924', 'Ram Kumar Sharma', 18050],
          ['26448', 'Nikhil Arora', 30200]
        ],
        'BANK NON HDFC': [
          ['Emp Code', 'Emp Name', 'Amount'],
          ['00387', 'Surendra Kumar', 23700]
        ]
      }
    });

    const meta1 = bA.mockWindow.ATPLSalaryPayout.extractSalaryRowsWithMeta(
      bA.mockWindow.FILES.find(f => f.name === 'May 2026 Salary Sheet Atpl Final.xlsx'),
      'COMPLIANCE'
    );
    assert.deepEqual(Array.from(meta1.selectedSheets), ['Fourmala Sheet']);
    assert.equal(meta1.skippedSheets.length, 3, 'Must skip duplicate PF/HDFC/Non-HDFC tabs');
    assert.equal(meta1.totals.empCount, 3, 'Footer Total row must be ignored');
    assert.equal(meta1.totals.complianceTotal, 71950, 'Must match exact NET PAYMENT sum without 2x/3x inflation');
    assert.equal(meta1.totals.manualTotal, 101300);
    assert.equal(meta1.totals.pfTotal, 5400);
    assert.equal(meta1.totals.esicTotal, 150);

    const imp1 = bA.mockWindow.ATPLSalaryPayout.importFromLoadedFile('May 2026 Salary Sheet Atpl Final.xlsx', '2026-05', 'COMPLIANCE');
    assert.equal(imp1.ok, true);
    const ledgerMay = bA.mockWindow.ATPLSalaryPayout.computeMonthLedger('2026-05');
    assert.equal(ledgerMay.complianceTotal, 71950, 'Stale 9999999 target & stale 99999 row must be cleaned');
    assert.equal(ledgerMay.manualTotal, 101300);
    assert.equal(ledgerMay.pfTotal, 5400);
    assert.equal(ledgerMay.esicTotal, 150);
    assert.equal(ledgerMay.rows.some(r => r.empCode === '99999'), false, 'Stale previous import row must be removed');

    // Screenshot 3 format (Mam -> Compliance): Employee ID, Name of employee, Manual Amount, Diff. Amount, PF@12%, ESIC @0.75%, Net Payable, PF @13%, ESI @3.25%, NO ACTIVE & Total row
    bA.mockWindow.ATPLSalaryPayout.setSelectedMonth('2026-06');
    bA.mockWindow.FILES.push({
      name: 'June_Compliance_Mam.xlsx',
      sheets: {
        'Compliance': [
          ['Employee ID', 'Name of employee', 'Manual Amount', 'Diff. Amount', 'PF@12%', 'ESIC @0.75%', 'Advance Deduction', 'Total Deduction', 'Net Payable', 'PF @13%', 'ESI @3.25%', 'Remarks'],
          ['26510', 'MAHESHWAR PRASAD', 15709, 291, 0, 77, 0, 77, 15341, 0, 333, 'ACTIVE'],
          ['26352', 'SANTONA BARMAN', 0, 0, 0, 0, 0, 0, 0, 0, 0, 'NO ACTIVE'],
          ['26489', 'ASHIK SHAH', 32800, 275, 0, 0, 16900, 16900, 15625, 0, 0, 'ACTIVE'],
          ['26166', 'KISHAN SINGH', 17800, 228, 0, 88, 0, 88, 17484, 0, 380, 'ACTIVE'],
          ['', 'Total', 66309, 794, 0, 165, 16900, 17065, 48450, 0, 713, '']
        ]
      }
    });

    const impJune = bA.mockWindow.ATPLSalaryPayout.importFromLoadedFile('June_Compliance_Mam.xlsx', '2026-06', 'BOTH');
    assert.equal(impJune.ok, true);
    assert.equal(impJune.imported, 3, 'NO ACTIVE zero rows & Total row must be skipped');
    const ledgerJune = bA.mockWindow.ATPLSalaryPayout.computeMonthLedger('2026-06');
    assert.equal(ledgerJune.complianceTotal, 48450, 'Net Payable column must be read exactly');
    assert.equal(ledgerJune.manualTotal, 66309);
    assert.equal(ledgerJune.esicTotal, 165, 'ESIC @0.75% must be extracted, never ESI @3.25%');
    assert.equal(ledgerJune.pfTotal, 0, 'PF@12% must be 0, never PF @13%');
    assert.equal(ledgerJune.diffTotal, 794);
    assert.equal(ledgerJune.advanceDedTotal, 16900);
  });
});
