const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('Advance Management Module - Enterprise Tests (Exact Column, Manual Cut & Employee History)', async (t) => {
  const rootDir = path.resolve(__dirname, '..');
  const htmlContent = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');
  const advanceJsContent = fs.readFileSync(path.join(rootDir, 'atpl-advance-management.js'), 'utf8');

  function makeMockWindow(emData) {
    const mockStorage = {};
    const appendedElements = [];
    const container = { innerHTML: '' };
    const modal = { id: 'advModal', innerHTML: '' };
    const mockWindow = {
      localStorage: {
        getItem: (k) => (Object.prototype.hasOwnProperty.call(mockStorage, k) ? mockStorage[k] : null),
        setItem: (k, v) => { mockStorage[k] = String(v); },
        removeItem: (k) => { delete mockStorage[k]; }
      },
      document: {
        addEventListener: () => {},
        getElementById: (id) => {
          if (id === 'advanceModuleContainer') return container;
          if (id === 'advModal') return modal;
          return null;
        },
        body: { appendChild: (el) => appendedElements.push(el) },
        readyState: 'complete',
        hidden: false
      },
      addEventListener: () => {},
      BroadcastChannel: class { postMessage() {} close() {} },
      EM: { data: emData || [{ emp_id: '25924', name: 'Ram Kumar Sharma', dept: 'Spinning', gross: 24000 }] },
      showToast: () => {}
    };
    mockWindow.window = mockWindow;
    return { mockWindow, container, modal };
  }

  await t.test('1. Syntax validation: atpl-advance-management.js has zero syntax errors', () => {
    assert.doesNotThrow(() => {
      new vm.Script(advanceJsContent);
    }, 'atpl-advance-management.js must parse with zero syntax errors');
  });

  await t.test('2. HTML wiring: index.html includes advance module, nav item, page container, and protects Advance History button', () => {
    assert(htmlContent.includes('id="vn-advance"'), 'Sidebar must have Advance Management link');
    assert(htmlContent.includes('id="page-advance"'), 'Page container must have page-advance');
    assert(htmlContent.includes('id="advanceModuleContainer"'), 'Module mount div advanceModuleContainer must exist');
    assert(htmlContent.includes('src="atpl-advance-management.js"'), 'index.html must load atpl-advance-management.js');
    assert(htmlContent.includes('ATPLAdvanceManager.processAllSalaryFiles'), 'handleFiles must trigger processAllSalaryFiles');
    assert(htmlContent.includes("b.closest('#advanceModuleContainer')"), 'HR doc history cleanup must protect Advance Employee History buttons');
  });

  await t.test('3. Exact Salary Sheet & Advance Column Detection + Multi-sheet safety + Idempotency', () => {
    const { mockWindow } = makeMockWindow([
      { emp_id: '25924', name: 'Ram Kumar Sharma', dept: 'Spinning', gross: 24000 },
      { emp_id: '26002', name: 'Lokesh Verma', dept: 'Dyeing', gross: 18000 }
    ]);
    const ctx = vm.createContext(mockWindow);
    vm.runInContext(advanceJsContent, ctx);

    mockWindow.ATPLAdvanceManager.addOrUpdateAdvance({
      id: 'adv_ram_1',
      empCode: '25924',
      amount: 12000,
      advanceDate: '2026-01-10',
      monthlyCap: 4000,
      remarks: 'Medical loan'
    });
    mockWindow.ATPLAdvanceManager.addOrUpdateAdvance({
      id: 'adv_lokesh_1',
      empCode: '26002',
      amount: 5000,
      advanceDate: '2026-01-12',
      monthlyCap: 2500,
      remarks: 'Personal advance'
    });

    // Wrong file: Bank/Attendance/No Advance column -> MUST NOT DEDUCT ANYTHING
    const wrongBankSheet = {
      name: 'Bank_Transfer_March_2026.xlsx',
      sheets: {
        'Bank': [
          ['Emp Code', 'Employee Name', 'Net Payment'],
          ['25924', 'Ram Kumar Sharma', '22500'],
          ['26002', 'Lokesh Verma', '18000']
        ]
      }
    };
    const resWrong = mockWindow.ATPLAdvanceManager.processSalaryFile(wrongBankSheet);
    assert.equal(resWrong.processed, 0, 'Must NOT deduct from Bank/non-advance sheet');
    assert.equal(mockWindow.ATPLAdvanceManager.getEmployeeOutstandingBalance('25924'), 12000);

    // Sheet with "Advance Balance" instead of Advance Deduction column -> MUST NOT DEDUCT
    const ledgerExport = {
      name: 'Advance_Summary_Check.xlsx',
      sheets: {
        'Sheet1': [
          ['Emp Code', 'Employee Name', 'Advance Balance', 'Recovered', 'Status'],
          ['25924', 'Ram Kumar Sharma', '12000', '0', 'ACTIVE']
        ]
      }
    };
    assert.equal(mockWindow.ATPLAdvanceManager.processSalaryFile(ledgerExport).processed, 0, 'Must reject Advance Balance / Ledger export');

    // Real Arora Textiles Multi-sheet Salary Workbook:
    // Sheet1 has attendance/bank info (no advance col)
    // "Advance" sheet is an advance-balance list (no payroll cols)
    // "Fourmala Sheet" has Basic, Gross, Advance Deduction, Net Payable -> Ram cut 3500 (not monthlyCap 4000!), Lokesh cut 0!
    // "Category" summary repeats the same data -> MUST NOT double-deduct Ram!
    const marchWorkbook = {
      name: 'Salary_March_2026.xlsx',
      sheets: {
        'Attendance': [
          ['Emp Code', 'Employee Name', 'Paid Days'],
          ['25924', 'Ram Kumar Sharma', '26'],
          ['26002', 'Lokesh Verma', '24']
        ],
        'Advance': [
          ['Emp Code', 'Employee Name', 'Advance'],
          ['25924', 'Ram Kumar Sharma', '9999']
        ],
        'Fourmala Sheet': [
          ['Emp Code', 'Employee Name', 'Basic', 'Gross', 'Advance Deduction', 'Net Payable'],
          ['25924', 'Ram Kumar Sharma', '15000', '24000', '3500', '20500'],
          ['26002', 'Lokesh Verma', '12000', '18000', '0', '18000']
        ],
        'Category': [
          ['Emp Code', 'Employee Name', 'Basic', 'Gross', 'Advance Deduction', 'Net Payable'],
          ['25924', 'Ram Kumar Sharma', '15000', '24000', '3500', '20500']
        ]
      }
    };

    const resMarch = mockWindow.ATPLAdvanceManager.processSalaryFile(marchWorkbook);
    assert.equal(resMarch.processed, 1, 'Only Ram (Adv=3500) should be deducted; Lokesh (Adv=0) must be skipped');
    assert.equal(resMarch.deductions[0].deductedAmount, 3500, 'Must deduct exact Advance Deduction column value (3500), NOT monthlyCap (4000)');
    assert.equal(resMarch.deductions[0].sheetName, 'Fourmala Sheet', 'Must attribute deduction to exact matched salary sheet');
    assert.equal(resMarch.deductions[0].columnName, 'Advance Deduction', 'Must record exact column name matched');
    assert.equal(resMarch.deductions[0].remainingBalance, 8500);
    assert.equal(mockWindow.ATPLAdvanceManager.getEmployeeOutstandingBalance('25924'), 8500);
    assert.equal(mockWindow.ATPLAdvanceManager.getEmployeeOutstandingBalance('26002'), 5000, 'Lokesh advance must remain untouched because Advance=0 in sheet');

    // Re-scan idempotency
    const resDup = mockWindow.ATPLAdvanceManager.processSalaryFile(marchWorkbook);
    assert.equal(resDup.processed, 0, 'Re-scanning the same workbook must deduct 0');
    assert.equal(mockWindow.ATPLAdvanceManager.getEmployeeOutstandingBalance('25924'), 8500);
  });

  await t.test('4. Multi-advance FIFO allocation & capping at outstanding balance from Salary Sheet', () => {
    const { mockWindow } = makeMockWindow([{ emp_id: '999', name: 'Test Worker' }]);
    const ctx = vm.createContext(mockWindow);
    vm.runInContext(advanceJsContent, ctx);

    mockWindow.ATPLAdvanceManager.addOrUpdateAdvance({
      id: 'adv_1',
      empCode: '999',
      amount: 3000,
      advanceDate: '2026-01-01',
      remarks: 'First advance'
    });
    mockWindow.ATPLAdvanceManager.addOrUpdateAdvance({
      id: 'adv_2',
      empCode: '999',
      amount: 4000,
      advanceDate: '2026-02-01',
      remarks: 'Second advance'
    });

    // Sheet deducts ₹8,000, but total outstanding is ₹7,000 -> must cap at ₹3,000 + ₹4,000 = ₹7,000
    const aprilSheet = {
      name: 'Salary_April_2026.xlsx',
      sheets: {
        'Salary Sheet': [
          ['Emp Code', 'Name', 'Gross', 'Advance', 'Net Pay'],
          ['999', 'Test Worker', '25000', '8000', '17000']
        ]
      }
    };

    const res = mockWindow.ATPLAdvanceManager.processSalaryFile(aprilSheet);
    assert.equal(res.processed, 2, 'Should split deduction FIFO across both active advances');
    assert.equal(res.deductions[0].advanceId, 'adv_1');
    assert.equal(res.deductions[0].deductedAmount, 3000);
    assert.equal(res.deductions[1].advanceId, 'adv_2');
    assert.equal(res.deductions[1].deductedAmount, 4000);
    assert.equal(mockWindow.ATPLAdvanceManager.getEmployeeOutstandingBalance('999'), 0);
  });

  await t.test('5. Manual Advance Deduction, Validation, Deletion/Undo & Complete Employee History Audit', () => {
    const { mockWindow, container, modal } = makeMockWindow([
      { emp_id: '25924', name: 'Ram Kumar Sharma', dept: 'Spinning', desig: 'Operator' }
    ]);
    const ctx = vm.createContext(mockWindow);
    vm.runInContext(advanceJsContent, ctx);

    mockWindow.ATPLAdvanceManager.addOrUpdateAdvance({
      id: 'adv_ram_man',
      empCode: '25924',
      amount: 10000,
      advanceDate: '2026-03-01',
      remarks: 'Urgent advance'
    });

    // 1. Salary sheet cuts ₹3,000
    const marchSheet = {
      name: 'Salary_March_2026.xlsx',
      sheets: {
        'Manisha Mam': [
          ['Emp Code', 'Employee Name', 'Gross', 'Adv Ded', 'Net Payable'],
          ['25924', 'Ram Kumar Sharma', '22000', '3000', '19000']
        ]
      }
    };
    const salRes = mockWindow.ATPLAdvanceManager.processSalaryFile(marchSheet);
    assert.equal(salRes.processed, 1);
    assert.equal(mockWindow.ATPLAdvanceManager.getEmployeeOutstandingBalance('25924'), 7000);

    // 2. Manual deduction over-balance must be blocked
    const overRes = mockWindow.ATPLAdvanceManager.deductAdvanceManually({
      empCode: '25924',
      amount: 9000,
      deductionDate: '2026-04-05',
      mode: 'Manual Cash Recovery',
      remarks: 'Should fail'
    });
    assert.equal(overRes.ok, false);
    assert.equal(overRes.error, 'EXCEEDS_BALANCE');
    assert.equal(mockWindow.ATPLAdvanceManager.getEmployeeOutstandingBalance('25924'), 7000);

    // 3. Valid manual deduction of ₹2,500
    const manRes = mockWindow.ATPLAdvanceManager.deductAdvanceManually({
      empCode: '25924',
      amount: 2500,
      deductionDate: '2026-04-05',
      mode: 'Manual Cash Recovery',
      remarks: 'Cash received by accounts'
    });
    assert.equal(manRes.ok, true);
    assert.equal(manRes.deductions[0].sourceType, 'manual');
    assert.equal(manRes.deductions[0].deductedAmount, 2500);
    assert.equal(mockWindow.ATPLAdvanceManager.getEmployeeOutstandingBalance('25924'), 4500);

    // 4. Employee History data + rendered modal HTML verification
    const hist = mockWindow.ATPLAdvanceManager.getEmployeeHistoryData('25924');
    assert.equal(hist.totalGiven, 10000);
    assert.equal(hist.totalSalaryCut, 3000);
    assert.equal(hist.totalManualCut, 2500);
    assert.equal(hist.totalRemaining, 4500);
    assert.equal(hist.deductions.length, 2);

    mockWindow.ATPLAdvanceManager.viewEmployeeHistory('25924');
    assert(modal.innerHTML.includes('Ram Kumar Sharma'), 'History modal must show employee name');
    assert(modal.innerHTML.includes('Salary_March_2026.xlsx'), 'History modal must show salary file name');
    assert(modal.innerHTML.includes('Manisha Mam'), 'History modal must show salary sheet name');
    assert(modal.innerHTML.includes('Adv Ded'), 'History modal must show matched advance column');
    assert(modal.innerHTML.includes('Manual Cash Recovery'), 'History modal must show manual deduction mode');
    assert(modal.innerHTML.includes('Cash received by accounts'), 'History modal must show manual remarks');

    // Ledger renders Employee History button & Manual Cut button
    mockWindow.ATPLAdvanceManager.setTab('ledger');
    assert(container.innerHTML.includes('Employee History'), 'Ledger must render Employee History button');
    assert(container.innerHTML.includes('Manual Cut'), 'Ledger must render Manual Cut button');
    assert(container.innerHTML.includes('confirmDeleteEmployeeLedger'), 'Ledger must render Delete button for employee row');

    // 5. Reversing/deleting the manual deduction restores balance accurately
    const deletedOk = mockWindow.ATPLAdvanceManager.deleteDeduction(manRes.deductions[0].id);
    assert.equal(deletedOk, true);
    assert.equal(mockWindow.ATPLAdvanceManager.getEmployeeOutstandingBalance('25924'), 7000);

    // 6. Deleting entire Employee Ledger deletes all advances & deductions for that employee only
    mockWindow.ATPLAdvanceManager.addOrUpdateAdvance({
      id: 'adv_other_emp',
      empCode: '26002',
      amount: 4000,
      advanceDate: '2026-03-02',
      remarks: 'Other employee advance'
    });
    const delLedgerCount = mockWindow.ATPLAdvanceManager.deleteEmployeeLedger('25924');
    assert.equal(delLedgerCount, 1, 'Must delete 1 advance for employee 25924');
    assert.equal(mockWindow.ATPLAdvanceManager.getEmployeeOutstandingBalance('25924'), 0);
    assert.equal(mockWindow.ATPLAdvanceManager.getAllAdvances().some(a => a.empCode === '25924'), false);
    assert.equal(mockWindow.ATPLAdvanceManager.getAllDeductions().some(d => d.empCode === '25924'), false);
    assert.equal(mockWindow.ATPLAdvanceManager.getEmployeeOutstandingBalance('26002'), 4000, 'Other employee advance must stay intact');
  });
});
