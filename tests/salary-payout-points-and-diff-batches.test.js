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
    assert.ok(/src="atpl-salary-payout\.js(\?[^"]*)?"/.test(htmlCode), 'HTML must load atpl-salary-payout.js');
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

  await t.test('9. 2-row merged headers, Compliance 70L + Diff 5L workflow, manual tab choice & resetMonthData', async () => {
    const bA = createBrowser('BrowserA_Flow', cloud);
    vm.runInContext(payoutJs, vm.createContext(bA.mockWindow));
    bA.mockWindow.ATPLSalaryPayout.setSelectedMonth('2026-07');

    // 2-row split header (e.g. Net + Payable, PF + 12%, ESIC + 0.75%) & formatted Rs strings + Multi-Tab choice (Workers 44L + Staff 26L = 70L)
    const julyCompWb = {
      name: 'JULY_2026_COMPLIANCE.xlsx',
      sheets: {
        'Workers': [
          ['Emp', 'Name', 'Net', 'PF', 'ESIC', 'Manual'],
          ['Code', 'Employee', 'Payable', '12%', '0.75%', 'Amount'],
          ['25924', 'Ram Kumar Sharma', '₹ 44,00,000/-', 1800, 150, 4800000]
        ],
        'Staff': [
          ['Emp Code', 'Emp Name', 'Net Payable', 'PF 12%', 'ESIC 0.75%'],
          ['26448', 'Nikhil Arora', 2600000, 3600, 0]
        ],
        'HDFC': [
          ['Emp Code', 'Emp Name', 'Amount'],
          ['25924', 'Ram Kumar Sharma', 4400000],
          ['26448', 'Nikhil Arora', 2600000]
        ]
      }
    };

    const metaComp = bA.mockWindow.ATPLSalaryPayout.extractSalaryRowsWithMeta(julyCompWb, 'COMPLIANCE');
    assert.equal(metaComp.totals.complianceTotal, 7000000, '2-row merged Net+Payable and disjoint Workers+Staff must total exact 70,00,000 without HDFC duplicate');
    assert.equal(metaComp.totals.pfTotal, 5400, '2-row merged PF+12% must extract cleanly');
    assert.equal(metaComp.totals.esicTotal, 150, '2-row merged ESIC+0.75% must extract cleanly');

    // Import Compliance Sheet -> Compliance KPI = 70,00,000
    bA.mockWindow.ATPLSalaryPayout.bulkImportMonthSalaries('2026-07', metaComp.rows, julyCompWb.name, 'COMPLIANCE');
    let ledgerJuly = bA.mockWindow.ATPLSalaryPayout.computeMonthLedger('2026-07');
    assert.equal(ledgerJuly.complianceTotal, 7000000);
    assert.equal(ledgerJuly.diffTotal, 0);

    // Next upload Diff Sheet (5,00,000) -> Diff KPI = 5,00,000, Total = 75,00,000
    bA.mockWindow.FILES.push({
      name: 'JULY_2026_DIFF.xlsx',
      sheets: {
        'Diff': [
          ['Emp Code', 'Emp Name', 'Diff Amount'],
          ['25924', 'Ram Kumar Sharma', 300000],
          ['26448', 'Nikhil Arora', 200000]
        ]
      }
    });
    bA.mockWindow.ATPLSalaryPayout.importFromLoadedFile('JULY_2026_DIFF.xlsx', '2026-07', 'DIFF');
    ledgerJuly = bA.mockWindow.ATPLSalaryPayout.computeMonthLedger('2026-07');
    assert.equal(ledgerJuly.complianceTotal, 7000000);
    assert.equal(ledgerJuly.diffTotal, 500000);
    assert.equal(ledgerJuly.diffRemainingTotal, 500000);
    assert.equal(ledgerJuly.totalMonthSalary, 7500000);

    // Pay Part 1 (2,00,000) & Part 2 (1,50,000) -> Diff Paid = 3,50,000, Diff Baaki = 1,50,000
    bA.mockWindow.ATPLSalaryPayout.addOrUpdateDiffBatch({
      monthKey: '2026-07', partNumber: 1, status: 'DISBURSED',
      allocations: [{ empCode: '25924', amount: 200000 }]
    });
    bA.mockWindow.ATPLSalaryPayout.addOrUpdateDiffBatch({
      monthKey: '2026-07', partNumber: 2, status: 'DISBURSED',
      allocations: [{ empCode: '26448', amount: 150000 }]
    });
    ledgerJuly = bA.mockWindow.ATPLSalaryPayout.computeMonthLedger('2026-07');
    assert.equal(ledgerJuly.totalBatchPaid, 350000);
    assert.equal(ledgerJuly.diffRemainingTotal, 150000);

    // Reset Month Data clears everything cleanly & syncs tombstone
    assert.equal(bA.mockWindow.ATPLSalaryPayout.resetMonthData('2026-07'), true);
    ledgerJuly = bA.mockWindow.ATPLSalaryPayout.computeMonthLedger('2026-07');
    assert.equal(ledgerJuly.complianceTotal, 0);
    assert.equal(ledgerJuly.diffTotal, 0);
    assert.equal(ledgerJuly.rows.length, 0);
  });

  await t.test('10. Manual Compliance + Compliance Lock + Additive Multi-Diff Sheets (Sheet1+Sheet2+Sheet3+Manual) + Delete Sheet Sync', async () => {
    const bA = createBrowser('BrowserA_Multi', cloud);
    const bB = createBrowser('BrowserB_Multi', cloud);
    vm.runInContext(payoutJs, vm.createContext(bA.mockWindow));
    vm.runInContext(payoutJs, vm.createContext(bB.mockWindow));

    bA.mockWindow.ATPLSalaryPayout.setSelectedMonth('2026-08');
    bB.mockWindow.ATPLSalaryPayout.setSelectedMonth('2026-08');

    // A) Manual Compliance Net Payable (70L) -> auto-locks, toggle lock & delete works cleanly
    const manComp = bA.mockWindow.ATPLSalaryPayout.saveManualSheetEntry({
      monthKey: '2026-08',
      kind: 'COMPLIANCE',
      title: 'Aug Compliance Manual Net Pay',
      amount: 7000000,
      remarks: 'HDFC NEFT'
    });
    assert.equal(manComp.ok, true);
    let ledA = bA.mockWindow.ATPLSalaryPayout.computeMonthLedger('2026-08');
    assert.equal(ledA.complianceTotal, 7000000);
    assert.equal(ledA.complianceLocked, true, 'Manual Compliance must lock after processing');
    assert.equal(ledA.complianceSheets.length, 1);

    // Unlock, delete manual compliance, then upload Excel Compliance sheet (80L)
    assert.equal(bA.mockWindow.ATPLSalaryPayout.toggleSheetLock(manComp.record.id), true);
    assert.equal(bA.mockWindow.ATPLSalaryPayout.isComplianceLockedForMonth('2026-08'), false);
    assert.equal(bA.mockWindow.ATPLSalaryPayout.deleteUploadedSheet(manComp.record.id), true);
    ledA = bA.mockWindow.ATPLSalaryPayout.computeMonthLedger('2026-08');
    assert.equal(ledA.complianceTotal, 0);
    assert.equal(ledA.complianceSheets.length, 0);

    bA.mockWindow.FILES.push({
      name: 'AUG_COMPLIANCE.xlsx',
      sheets: {
        'Compliance': [
          ['Emp Code', 'Emp Name', 'Net Payable', 'PF 12%', 'ESIC 0.75%'],
          ['25924', 'Ram Kumar Sharma', 5000000, 1800, 150],
          ['26448', 'Nikhil Arora', 3000000, 3600, 0]
        ]
      }
    });
    const cImp = bA.mockWindow.ATPLSalaryPayout.importFromLoadedFile('AUG_COMPLIANCE.xlsx', '2026-08', 'COMPLIANCE');
    assert.equal(cImp.ok, true);
    ledA = bA.mockWindow.ATPLSalaryPayout.computeMonthLedger('2026-08');
    assert.equal(ledA.complianceTotal, 8000000);
    assert.equal(ledA.complianceLocked, true, 'Excel Compliance must lock after processing');

    // Bank Return still works even when Compliance is locked!
    const retRes = bA.mockWindow.ATPLSalaryPayout.addOrUpdateReturn({
      monthKey: '2026-08',
      empCode: '25924',
      amount: 18000,
      reason: 'IFSC Changed',
      newAccountNo: '9988776655',
      newIfsc: 'HDFC0009999'
    });
    assert.equal(retRes.ok, true);

    // B) Additive Multi-Diff Sheets: Sheet 1 (3L) + Sheet 2 (2L, overlapping 25924) + Sheet 3 (1L) + Manual Diff (50k) = 6.5L!
    bA.mockWindow.FILES.push(
      {
        name: 'AUG_DIFF_1.xlsx',
        sheets: {
          'Diff1': [
            ['Emp Code', 'Emp Name', 'Diff Amount'],
            ['25924', 'Ram Kumar Sharma', 180000],
            ['26448', 'Nikhil Arora', 120000]
          ]
        }
      },
      {
        name: 'AUG_DIFF_2.xlsx',
        sheets: {
          'Diff2': [
            ['Emp Code', 'Emp Name', 'Diff Amount'],
            ['25924', 'Ram Kumar Sharma', 80000],
            ['26510', 'Maheshwar Prasad', 120000]
          ]
        }
      },
      {
        name: 'AUG_DIFF_3.xlsx',
        sheets: {
          'Diff3': [
            ['Emp Code', 'Emp Name', 'Diff Amount'],
            ['26520', 'Sukhchan Barman', 100000]
          ]
        }
      }
    );

    const d1 = bA.mockWindow.ATPLSalaryPayout.importFromLoadedFile('AUG_DIFF_1.xlsx', '2026-08', 'DIFF');
    const d2 = bA.mockWindow.ATPLSalaryPayout.importFromLoadedFile('AUG_DIFF_2.xlsx', '2026-08', 'DIFF');
    const d3 = bA.mockWindow.ATPLSalaryPayout.importFromLoadedFile('AUG_DIFF_3.xlsx', '2026-08', 'DIFF');
    assert.equal(d1.ok && d2.ok && d3.ok, true);

    const manDiff = bA.mockWindow.ATPLSalaryPayout.saveManualSheetEntry({
      monthKey: '2026-08',
      kind: 'DIFF',
      title: 'Special Cash Diff Lot',
      amount: 50000,
      remarks: 'Extra Diff'
    });
    assert.equal(manDiff.ok, true);

    // Pay 1,50,000 batch
    bA.mockWindow.ATPLSalaryPayout.addOrUpdateDiffBatch({
      monthKey: '2026-08',
      partNumber: 1,
      status: 'DISBURSED',
      allocations: [{ empCode: '25924', amount: 150000 }]
    });

    ledA = bA.mockWindow.ATPLSalaryPayout.computeMonthLedger('2026-08');
    assert.equal(ledA.diffTotal, 650000, 'Sheet1 (3L) + Sheet2 (2L) + Sheet3 (1L) + Manual (50k) must sum to 6,50,000');
    assert.equal(ledA.diffSheets.length, 4);
    assert.equal(ledA.rows.find(r => r.empCode === '25924').baseDiffAmount, 260000, 'Same Emp across Sheet 1 + Sheet 2 must accumulate');
    assert.equal(ledA.totalBatchPaid, 150000);
    assert.equal(ledA.diffRemainingTotal, 500000);

    // Sync to Browser B and verify parity
    await new Promise(r => setTimeout(r, 60));
    await bB.mockWindow.ATPLSalaryPayout.syncNow(true);
    let ledB = bB.mockWindow.ATPLSalaryPayout.computeMonthLedger('2026-08');
    assert.equal(ledB.complianceTotal, 8000000);
    assert.equal(ledB.complianceLocked, true);
    assert.equal(ledB.diffTotal, 650000);
    assert.equal(ledB.diffSheets.length, 4);
    assert.equal(ledB.diffRemainingTotal, 500000);

    // C) Delete ONLY Diff Sheet 2 (2L) -> subtracts 2L cleanly (6.5L -> 4.5L), keeps Sheet 1 + Sheet 3 + Manual, syncs via tombstone!
    assert.equal(bA.mockWindow.ATPLSalaryPayout.deleteUploadedSheet(d2.sheetId), true);
    ledA = bA.mockWindow.ATPLSalaryPayout.computeMonthLedger('2026-08');
    assert.equal(ledA.diffTotal, 450000, 'Deleting Diff Sheet 2 must leave exact 4,50,000');
    assert.equal(ledA.diffSheets.length, 3);
    assert.equal(ledA.rows.find(r => r.empCode === '25924').baseDiffAmount, 180000, 'Emp 25924 must drop back to Sheet 1 amount 1,80,000');
    assert.equal(ledA.rows.some(r => r.empCode === '26510'), false, 'Emp 26510 unique to Sheet 2 must be removed');
    assert.equal(ledA.diffRemainingTotal, 300000);

    await new Promise(r => setTimeout(r, 60));
    await bB.mockWindow.ATPLSalaryPayout.syncNow(true);
    ledB = bB.mockWindow.ATPLSalaryPayout.computeMonthLedger('2026-08');
    assert.equal(ledB.diffTotal, 450000, 'Browser B must reflect deleted Diff Sheet 2 via tombstone sync');
    assert.equal(ledB.diffSheets.length, 3);
    assert.equal(ledB.rows.find(r => r.empCode === '25924').baseDiffAmount, 180000);
    assert.equal(ledB.rows.some(r => r.empCode === '26510'), false);
  });

  await t.test('11. Working SHeet vs stale Sheet1, Oct Diff Bank Sheet (ALREADY GIVEN + #N/A + AMOUNT), & File Search Filter', () => {
    const bA = createBrowser('BrowserA_Oct', cloud);
    vm.runInContext(payoutJs, vm.createContext(bA.mockWindow));
    const octCompWb = {
      name: 'Sent Compilance Sheet October-26 (1).xlsx',
      sheets: {
        'Sheet1': [
          ['S.No.', 'Employee ID', 'Name of employee', 'Manual Amount', 'Diff. Amount', 'PF@12%', 'ESIC @0.75%', 'Net Payable', 'Remarks'],
          [1, '00135', 'SAMPAT LAL', 27660, 188, 2300, 144, 46526, 'onroll'],
          [2, '10582', 'TEJ PAL PRAJAPAT', 18500, 0, 1547, 97, 16830, 'onroll']
        ],
        'working SHeet': [
          ['S.No.', 'Employee ID', 'Name of employee', 'Manual Amount', 'Diff. Amount', 'PF@12%', 'ESIC @0.75%', 'Net Payable', 'Remarks'],
          [1, '00135', 'SAMPAT LAL', 27660, 188, 2300, 144, 7570000, 'onroll'],
          [2, '10582', 'TEJ PAL PRAJAPAT', 18500, 0, 1547, 97, 24447, 'onroll'],
          ['', '', 'Grand Total', 8527635, 596008, 146415, 7581, 7594447, '']
        ]
      }
    };
    const metaOct = bA.mockWindow.ATPLSalaryPayout.extractSalaryRowsWithMeta(octCompWb, 'COMPLIANCE');
    assert.deepEqual(Array.from(metaOct.selectedSheets), ['working SHeet'], 'Must select active working SHeet instead of stale Sheet1');
    assert.equal(metaOct.totals.complianceTotal, 7594447);
    assert.equal(metaOct.totals.pfTotal, 3847);
    assert.equal(metaOct.totals.esicTotal, 241);

    const octDiffWb = {
      name: 'BANK SHEET DIFF AMOUNT OCT MONTH -732886.xlsx',
      sheets: {
        'Sheet1': [
          ['', 'BANK SHEET DIFF AMOUNT OCT MONTH -732886', '', '', '', '', '', '', ''],
          [],
          ['Employee ID', 'Name of employee', 'Catgrory 02', 'A.C NO ', 'IFSC CODE ', 'BANK NAME ', 'MANUAL AMOUNT', 'ALREADY GIVEN', 'AMOUNT'],
          ['00135', 'SAMPAT LAL', 'STAFF NAME', '013501', 'BARB0', 'BOB', 27660, 25028, 711506],
          ['25191', 'UMMIAD SINGH', 'CARD NO-6', '131018', 'HDFC0', 'HDFC', 21380, '#N/A', 21380],
          ['TOTAL', '', '', '', '', '', 8156209, '', 732886],
          ['', '', '', '', '', '', 'DIRECTOR SIGN', '', '']
        ]
      }
    };
    const metaDiff = bA.mockWindow.ATPLSalaryPayout.extractSalaryRowsWithMeta(octDiffWb, 'DIFF');
    assert.equal(metaDiff.totals.empCount, 2);
    assert.equal(metaDiff.totals.diffTotal, 732886);
    assert.equal(metaDiff.totals.complianceTotal, 0);
    assert.equal(metaDiff.primaryColumns.diffCol, 'AMOUNT');
    assert.equal(metaDiff.primaryColumns.complianceCol, null);

    // Even in BOTH mode, a Diff bank sheet (ALREADY GIVEN + AMOUNT without Net Payable) must not leak AMOUNT into complianceTotal
    const metaDiffBoth = bA.mockWindow.ATPLSalaryPayout.extractSalaryRowsWithMeta(octDiffWb, 'BOTH');
    assert.equal(metaDiffBoth.totals.diffTotal, 732886);
    assert.equal(metaDiffBoth.totals.complianceTotal, 0);

    // File Search Box filter test
    bA.mockWindow.FILES.push(octCompWb, octDiffWb);
    bA.mockWindow.ATPLSalaryPayout.openImportAndTargetsModal('COMPLIANCE');
    assert.ok(bA.elements.salPayoutModal.innerHTML.includes('spImportFileSearch'), 'Search input must render inside Upload Modal');
    const selEl = { value: octCompWb.name, innerHTML: '' };
    const cntEl = { textContent: '' };
    const origGet = bA.mockWindow.document.getElementById;
    bA.mockWindow.document.getElementById = (id) => {
      if (id === 'spImportFileSel') return selEl;
      if (id === 'spImportFileCount') return cntEl;
      return origGet(id);
    };
    try {
      const matched = bA.mockWindow.ATPLSalaryPayout.filterImportFileSelect('oct diff');
      assert.deepEqual(Array.from(matched), ['BANK SHEET DIFF AMOUNT OCT MONTH -732886.xlsx']);
      assert.equal(selEl.value, 'BANK SHEET DIFF AMOUNT OCT MONTH -732886.xlsx');
      assert.ok(cntEl.textContent.startsWith('1 / '));
    } finally {
      bA.mockWindow.document.getElementById = origGet;
    }
  });

  await t.test('12. Compliance Sheet Diff Chhoota Total + Swapped Emp Name/Code & a.c Header in Part 3 Diff Batch', async () => {
    const bA = createBrowser('BrowserA_Part3', cloud);
    vm.runInContext(payoutJs, vm.createContext(bA.mockWindow));
    bA.mockWindow.ATPLSalaryPayout.setSelectedMonth('2026-10');

    // 1. Compliance sheet with Diff. Amount column where 26468 (Mintu Modak) is later omitted from Diff Sheet
    bA.mockWindow.FILES.push({
      name: 'Sent Compilance Sheet October-26 (1).xlsx',
      sheets: {
        'working SHeet': [
          ['S.No.', 'Employee ID', 'Name of employee', 'Manual Amount', 'Diff. Amount', 'PF@12%', 'ESIC @0.75%', 'Net Payable', 'Remarks'],
          [1, '00135', 'SAMPAT LAL', 27660, 188, 2300, 144, 25028, 'onroll'],
          [2, '26468', 'MINTU MODAK', 15050, 1050, 0, 0, 14000, 'onroll'],
          ['', '', 'Grand Total', 42710, 1238, 2300, 144, 39028, '']
        ]
      }
    });
    const impComp = bA.mockWindow.ATPLSalaryPayout.importFromLoadedFile('Sent Compilance Sheet October-26 (1).xlsx', '2026-10', 'COMPLIANCE');
    assert.equal(impComp.ok, true);
    assert.equal(impComp.meta.totals.compDiffTotal, 1238, 'Compliance sheet Diff. Amount must be extracted');

    // Diff sheet only includes 00135 (188), missing 26468 (1050) from Compliance sheet
    bA.mockWindow.FILES.push({
      name: '#1 Sent Diff .Sheet October-26 FINAL WORKING.xlsx',
      sheets: {
        'BANK SHEET': [
          ['Employee ID', 'Name of employee', 'AMOUNT'],
          ['00135', 'SAMPAT LAL', 188]
        ]
      }
    });
    bA.mockWindow.ATPLSalaryPayout.importFromLoadedFile('#1 Sent Diff .Sheet October-26 FINAL WORKING.xlsx', '2026-10', 'DIFF');

    // Pay 00135 in Batch 1 -> Diff sheet remaining = 0, yet Compliance Diff Chhoota (1050) must still show!
    bA.mockWindow.ATPLSalaryPayout.addOrUpdateDiffBatch({
      monthKey: '2026-10',
      partNumber: 1,
      status: 'DISBURSED',
      allocations: [{ empCode: '00135', empName: 'SAMPAT LAL', amount: 188 }]
    });

    let ledOct = bA.mockWindow.ATPLSalaryPayout.computeMonthLedger('2026-10');
    assert.equal(ledOct.compSheetDiffTotal, 1238, 'Total Compliance Sheet Diff must show');
    assert.equal(ledOct.compDiffUncoveredTotal, 1050, 'Missed Compliance Diff for 26468 must be tracked');
    assert.equal(ledOct.diffBaakiTotal, 1050, 'Dashboard Diff Baaki must include uncovered Compliance Diff');
    assert.ok(bA.elements.salaryPayoutContainer.innerHTML.includes('Comp Sheet Diff Chhoota'));
    assert.ok(bA.elements.salaryPayoutContainer.innerHTML.includes('1,238'));
    assert.ok(bA.elements.salaryPayoutContainer.innerHTML.includes('1,050'));

    // 2. Part 3 Diff Batch bank sheet with swapped headers ("emp name" = code, "emp code" = multi-word name) + "a.c" header
    const part3Wb = {
      name: 'diff amount 3 abdul.xlsx',
      sheets: {
        'Sheet1': [
          ['s.no', 'emp name', 'emp code', 'net payable', 'department', 'remarks', 'a.c', 'ifsc code', 'bank name'],
          [1, '26468', 'mintu modak', 1050, 'card no 03', 'production', '7568046412', 'AIRP0000001', 'AIRTEL PAYMENTS BANK'],
          [2, '26531', 'sukhchan', 1200, 'card no 03', 'production', '31724919089', 'SBIN0011382', 'STATE BANK OF INDIA'],
          [3, '26634', 'manjay thakur', 500, 'card no 03', 'production', '45524027401', 'SBIN0031725', 'SBI BANK'],
          [4, '22271', 'abdul miya', 8165, 'card no 03', 'production', '61232449447', 'SBIN0031725', 'STATE BANK OF INDIA'],
          [5, '26630', 'deepak mahto', 2478, 'k.w', 'left amount', '36998098118', 'SBIN0005785', 'STATE BANK OF INDIA'],
          ['', 'TOTAL', '', 13393, '', '', '', '', '']
        ]
      }
    };
    const batchRows = bA.mockWindow.ATPLSalaryPayout.extractSalaryRowsFromWorkbook(part3Wb, 'BATCH');
    assert.equal(batchRows.length, 5, 'All 5 rows including multi-word names must parse when emp name & emp code are swapped');
    const mintuRow = batchRows.find(r => r.empCode === '26468');
    const manjayRow = batchRows.find(r => r.empCode === '26634');
    const abdulRow = batchRows.find(r => r.empCode === '22271');
    assert.ok(mintuRow && manjayRow && abdulRow);
    assert.equal(mintuRow.empName, 'mintu modak');
    assert.equal(mintuRow.accountNo, '7568046412');
    assert.equal(mintuRow.amount, 1050);
    assert.equal(manjayRow.empName, 'manjay thakur');
    assert.equal(abdulRow.amount, 8165);
    const part3Sum = batchRows.reduce((s, r) => s + r.amount, 0);
    assert.equal(part3Sum, 13393);

    // Paying Part 3 clears Mintu Modak (26468) uncovered Compliance Diff
    bA.mockWindow.ATPLSalaryPayout.addOrUpdateDiffBatch({
      monthKey: '2026-10',
      partNumber: 3,
      status: 'DISBURSED',
      allocations: batchRows.map(r => ({ empCode: r.empCode, empName: r.empName, amount: r.amount, remarks: r.remarks }))
    });
    ledOct = bA.mockWindow.ATPLSalaryPayout.computeMonthLedger('2026-10');
    assert.equal(ledOct.compDiffUncoveredTotal, 0, 'Mintu Modak paid in Part 3 clears uncovered Compliance Diff');
    assert.equal(ledOct.diffBaakiTotal, 0);

    // 3. Legacy Compliance sheet uploaded before compDiffAmount tracking backfills dynamically once cloud workbook loads
    const bLegacy = createBrowser('BrowserB_LegacyBackfill', new Map());
    vm.runInContext(payoutJs, vm.createContext(bLegacy.mockWindow));
    bLegacy.mockWindow.ATPLSalaryPayout.setSelectedMonth('2026-10');
    bLegacy.mockWindow.FILES.push({
      name: 'Sent Compilance Sheet October-26 (1).xlsx',
      sheets: {
        'working SHeet': [
          ['S.No.', 'Employee ID', 'Name of employee', 'Manual Amount', 'Diff. Amount', 'PF@12%', 'ESIC @0.75%', 'Net Payable', 'Remarks'],
          [1, '00135', 'SAMPAT LAL', 27660, 188, 2300, 144, 25028, 'onroll'],
          [2, '26468', 'MINTU MODAK', 15050, 1050, 0, 0, 14000, 'onroll']
        ]
      }
    });
    bLegacy.mockWindow.ATPLSalaryPayout.importFromLoadedFile('Sent Compilance Sheet October-26 (1).xlsx', '2026-10', 'COMPLIANCE');
    // Strip compDiffAmount + remove file temporarily to simulate pre-upgrade DB + async cloud file load
    const legSt = bLegacy.mockWindow.ATPLSalaryPayout.getState();
    Object.values(legSt.uploadedSheets).forEach(sh => { delete sh.compDiffAmount; });
    Object.values(legSt.empSalaries).forEach(rec => { delete rec.compDiffAmount; });
    const savedCompFile = bLegacy.mockWindow.FILES.pop();
    let legLed = bLegacy.mockWindow.ATPLSalaryPayout.computeMonthLedger('2026-10');
    assert.equal(legLed.compSheetDiffTotal, 0);
    // Now simulate cloud file arriving later
    bLegacy.mockWindow.FILES.push(savedCompFile);
    legLed = bLegacy.mockWindow.ATPLSalaryPayout.computeMonthLedger('2026-10');
    assert.equal(legLed.compSheetDiffTotal, 1238, 'Legacy Compliance sheet must backfill compDiffAmount after async file load');
    assert.equal(legLed.compDiffUncoveredTotal, 1238);
  });

  await t.test('13. Total Month Payout uses Paid Diff + Compliance, and Emp Payout Audit tracks Manual/Cuts/Increase/Parts 1-4', async () => {
    const bA = createBrowser('BrowserA_Audit', new Map());
    vm.runInContext(payoutJs, vm.createContext(bA.mockWindow));
    bA.mockWindow.ATPLSalaryPayout.setSelectedMonth('2026-09');

    // Compliance sheet: Emp 25046 Manual 25000, PF 1500, ESIC 200, Net Payable 21000 => Diff = 2300
    bA.mockWindow.FILES.push({
      name: 'SEP_COMP.xlsx',
      sheets: {
        'working SHeet': [
          ['Emp Code', 'Name of employee', 'Manual Amount', 'PF@12%', 'ESIC @0.75%', 'Net Payable', 'Diff. Amount'],
          ['25046', 'Kamlaram', 25000, 1500, 200, 21000, 2300],
          ['26471', 'Mhanta Rai', 20000, 1200, 150, 17000, 1650]
        ]
      }
    });
    bA.mockWindow.ATPLSalaryPayout.importFromLoadedFile('SEP_COMP.xlsx', '2026-09', 'COMPLIANCE');

    // Check Audit BEFORE any Diff Batch is paid -> 0 Diff paid, 2300 pending
    let aud = bA.mockWindow.ATPLSalaryPayout.buildEmpPayoutAudit('25046', '2026-09');
    assert.equal(aud.compliance.manualAmount, 25000);
    assert.equal(aud.compliance.pfEmployee, 1500);
    assert.equal(aud.compliance.esicEmployee, 200);
    assert.equal(aud.compliance.compliancePaid, 21000);
    assert.equal(aud.compliance.calcComplianceDiff, 2300);
    assert.equal(aud.summary.totalDiffDisbursed, 0, 'Before batches, 0 Diff should be paid');
    assert.equal(aud.summary.grandTotalPaid, 21000);
    assert.equal(aud.summary.pendingDiff, 2300);

    // Upload Diff Sheet #1 (2300) + Additive Diff Sheet #2 (+500 increase) => Total Diff Target = 2800
    bA.mockWindow.FILES.push({
      name: 'SEP_DIFF_1.xlsx',
      sheets: { 'BANK SHEET': [['Emp Code', 'Name', 'AMOUNT'], ['25046', 'Kamlaram', 2300], ['26471', 'Mhanta Rai', 1650]] }
    });
    bA.mockWindow.ATPLSalaryPayout.importFromLoadedFile('SEP_DIFF_1.xlsx', '2026-09', 'DIFF');

    bA.mockWindow.FILES.push({
      name: 'SEP_DIFF_2_EXTRA.xlsx',
      sheets: { 'BANK SHEET': [['Emp Code', 'Name', 'AMOUNT'], ['25046', 'Kamlaram', 500]] }
    });
    bA.mockWindow.ATPLSalaryPayout.importFromLoadedFile('SEP_DIFF_2_EXTRA.xlsx', '2026-09', 'DIFF', { replaceMonthSheets: false });

    // Pay across Part 1, Part 2, Part 3, Part 4 (Kamlaram gets 0 in Part 1, 2300 in Part 2, 500 in Part 3, 0 in Part 4)
    bA.mockWindow.ATPLSalaryPayout.addOrUpdateDiffBatch({
      monthKey: '2026-09', partNumber: 1, title: 'Part 1', status: 'DISBURSED',
      allocations: [{ empCode: '26471', empName: 'Mhanta Rai', amount: 2650 }] // 1000 extra above Diff sheet!
    });
    bA.mockWindow.ATPLSalaryPayout.addOrUpdateDiffBatch({
      monthKey: '2026-09', partNumber: 2, title: 'Part 2', status: 'DISBURSED',
      allocations: [{ empCode: '25046', empName: 'Kamlaram', amount: 2300 }]
    });
    bA.mockWindow.ATPLSalaryPayout.addOrUpdateDiffBatch({
      monthKey: '2026-09', partNumber: 3, title: 'Part 3', status: 'DISBURSED',
      allocations: [{ empCode: '25046', empName: 'Kamlaram', amount: 500 }]
    });
    bA.mockWindow.ATPLSalaryPayout.addOrUpdateDiffBatch({
      monthKey: '2026-09', partNumber: 4, title: 'Part 4', status: 'DISBURSED',
      allocations: [{ empCode: '26471', empName: 'Mhanta Rai', amount: 100 }]
    });

    // Verify Card 5 Total Month Payout = Comp Paid (38000) + Batch Paid (2650 + 2300 + 500 + 100 = 5550) = 43550 (NOT Diff Target 4450)
    const ledSep = bA.mockWindow.ATPLSalaryPayout.computeMonthLedger('2026-09');
    assert.equal(ledSep.complianceTotal, 38000);
    assert.equal(ledSep.diffTotal, 4450);
    assert.equal(ledSep.totalBatchPaid, 5550);
    assert.equal(ledSep.totalMonthSalary, 43550, 'Total Month Payout must equal Compliance Paid + Actual Diff Batch Paid');
    assert.ok(bA.elements.salaryPayoutContainer.innerHTML.includes('43,550'));
    assert.ok(bA.elements.salaryPayoutContainer.innerHTML.includes('Diff Paid'));

    // Verify Audit Waterfall for 25046 after Part 1-4
    aud = bA.mockWindow.ATPLSalaryPayout.buildEmpPayoutAudit('25046', '2026-09');
    assert.equal(aud.diffAndAdjustments.netDiffTarget, 2800);
    assert.equal(aud.diffAndAdjustments.increaseVsComp, 500);
    assert.equal(aud.summary.totalDiffDisbursed, 2800);
    assert.equal(aud.summary.grandTotalPaid, 23800);
    assert.equal(aud.summary.pendingDiff, 0);
    assert.equal(aud.batches.length, 4);
    assert.equal(aud.batches[0].amountPaid, 0);
    assert.equal(aud.batches[1].amountPaid, 2300);
    assert.equal(aud.batches[2].amountPaid, 500);
    assert.equal(aud.batches[3].amountPaid, 0);

    // Open Audit UI tab and check rendered HTML includes breakdown
    bA.mockWindow.ATPLSalaryPayout.openEmpAuditCheck('25046', '2026-09');
    const htmlOut = bA.elements.salaryPayoutContainer.innerHTML;
    assert.ok(htmlOut.includes('25,000'));
    assert.ok(htmlOut.includes('21,000'));
    assert.ok(htmlOut.includes('2,300'));
    assert.ok(htmlOut.includes('2,800'));
    assert.ok(htmlOut.includes('23,800'));
    assert.ok(htmlOut.includes('Badha'));
  });

  await t.test('14. Compliance CSV (incl. blank Emp ID off-roll rows), Diff Upload/Manual -> Paid Payments, & In-App Sheet Viewer', async () => {
    const bA = createBrowser('BrowserA_Viewer', new Map());
    const viewerEls = {
      spSheetViewerBody: { innerHTML: '' },
      spSheetViewerFoot: { innerHTML: '' },
      spSheetViewerSearch: { value: '' },
      spImportKindSel: { value: 'COMPLIANCE' },
      spImportMonthInp: { value: '2026-10' },
      spImportReplaceChk: { checked: true },
      spImportPreviewBox: { innerHTML: '' },
      spImportDiffAutoPayChk: { checked: true },
      spManSheetKind: { value: 'DIFF' },
      spManSheetTitle: { value: 'Oct Manual Diff Cash' },
      spManSheetAmt: { value: '15000' },
      spManSheetRem: { value: 'Cash diff lot' },
      spManDiffAutoPayChk: { checked: true }
    };
    const origGet = bA.mockWindow.document.getElementById;
    bA.mockWindow.document.getElementById = (id) => viewerEls[id] || origGet(id);
    bA.mockWindow.document.querySelectorAll = () => [];
    bA.mockWindow.FileReader = class {
      readAsText(file) { this.onload && this.onload({ target: { result: file._text } }); }
      readAsArrayBuffer(file) { this.onload && this.onload({ target: { result: file._buf } }); }
    };

    vm.runInContext(payoutJs, vm.createContext(bA.mockWindow));
    bA.mockWindow.ATPLSalaryPayout.setSelectedMonth('2026-10');

    // A) Upload Compliance CSV with quoted commas, newline header, & blank Employee ID off-roll row (Babloo)
    const sampleCompCsv = [
      'S.No.,Employee ID,Name of employee,"Gross \nTotal \nSalary",Manual Amount,Diff. Amount,PF@12%,ESIC @0.75%,Advance Deduction,Total Deduction,Net Payable,Remarks',
      '1,00135,SAMPAT LAL,27660,"27,660",188,2300,144,,2444,"25,028",onroll',
      '2,,Babloo,15950,"15,950","15,950",0,0,0,0,0,off roll',
      ',,Grand Total,,"43,610","16,138",2300,144,,2444,"25,028",',
      'Prepared By HR Department,,,,,,,,,,,'
    ].join('\n');

    bA.mockWindow.ATPLSalaryPayout.handleDirectExcelUpload({ files: [{ name: 'oct 2026.csv', _text: sampleCompCsv }] });
    const compImp = bA.mockWindow.ATPLSalaryPayout.confirmPreviewImport();
    assert.equal(compImp.ok, true);
    assert.equal(compImp.imported, 2, 'Both coded row 00135 and blank-ID row Babloo must import (skipping Grand Total & Prepared By)');

    let ledOct = bA.mockWindow.ATPLSalaryPayout.computeMonthLedger('2026-10');
    assert.equal(ledOct.complianceTotal, 25028, 'Compliance Net Payable must show directly in top KPI');
    assert.equal(ledOct.manualTotal, 43610);
    assert.equal(ledOct.compSheetDiffTotal, 16138, 'Full Compliance Diff including blank-ID Babloo must compute');
    assert.ok(bA.elements.salaryPayoutContainer.innerHTML.includes('25,028'));
    assert.ok(bA.elements.salaryPayoutContainer.innerHTML.includes('View'));

    // Open In-App Viewer on the uploaded Compliance sheet and filter
    const vRows = bA.mockWindow.ATPLSalaryPayout.openUploadedSheetViewer(compImp.sheetId);
    assert.equal(vRows.length, 2);
    assert.ok(viewerEls.spSheetViewerBody.innerHTML.includes('Babloo'));
    assert.ok(viewerEls.spSheetViewerFoot.innerHTML.includes('25,028'));
    viewerEls.spSheetViewerSearch.value = 'babloo';
    bA.mockWindow.ATPLSalaryPayout.filterSheetViewerRows();
    assert.ok(viewerEls.spSheetViewerFoot.innerHTML.includes('1 / 2'));

    // B) Add Manual Diff via UI -> lands in Diff Sheets AND auto-adds to Diff Me Di (Paid)
    bA.mockWindow.ATPLSalaryPayout.submitManualSheetEntry();
    ledOct = bA.mockWindow.ATPLSalaryPayout.computeMonthLedger('2026-10');
    assert.equal(ledOct.diffTotal, 15000);
    assert.equal(ledOct.totalBatchPaid, 15000, 'Manual Diff from UI must appear in Diff Payments directly');
    assert.equal(ledOct.totalMonthSalary, 40028);

    // C) Upload Diff CSV via UI -> appends to Diff Sheets AND auto-adds to Diff Payments
    viewerEls.spImportKindSel.value = 'DIFF';
    viewerEls.spImportReplaceChk.checked = false;
    viewerEls.spImportDiffAutoPayChk.checked = true;
    const sampleDiffCsv = 'Emp Code,Name of employee,Diff Amount,Remarks\n00135,SAMPAT LAL,188,oct diff\n';
    bA.mockWindow.ATPLSalaryPayout.handleDirectExcelUpload({ files: [{ name: 'oct diff.csv', _text: sampleDiffCsv }] });
    const diffImp = bA.mockWindow.ATPLSalaryPayout.confirmPreviewImport();
    assert.equal(diffImp.ok, true);

    ledOct = bA.mockWindow.ATPLSalaryPayout.computeMonthLedger('2026-10');
    assert.equal(ledOct.diffSheets.length, 2);
    assert.equal(ledOct.diffTotal, 15188);
    assert.equal(ledOct.totalBatchPaid, 15188);
    assert.equal(ledOct.totalMonthSalary, 40216);

    // D) Open In-App Batch Viewer cleanly (must auto-clear previous viewer search query!)
    const bRows = bA.mockWindow.ATPLSalaryPayout.openBatchSheetViewer(ledOct.batches[1].id);
    assert.equal(bRows.length, 1);
    assert.ok(viewerEls.spSheetViewerBody.innerHTML.includes('SAMPAT LAL'));
    assert.ok(viewerEls.spSheetViewerFoot.innerHTML.includes('188'));

    // E) Deleting the Diff Sheet cleanly deletes both the sheet and its auto-linked Batch
    assert.equal(bA.mockWindow.ATPLSalaryPayout.deleteUploadedSheet(diffImp.sheetId), true);
    ledOct = bA.mockWindow.ATPLSalaryPayout.computeMonthLedger('2026-10');
    assert.equal(ledOct.diffSheets.length, 1);
    assert.equal(ledOct.diffTotal, 15000);
    assert.equal(ledOct.totalBatchPaid, 15000);
  });
});
