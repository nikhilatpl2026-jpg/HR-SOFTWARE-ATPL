const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('ATPL Advance Management & Automatic Salary Deduction Module', async (t) => {
  const rootDir = path.join(__dirname, '..');
  const advanceJsContent = fs.readFileSync(path.join(rootDir, 'atpl-advance-management.js'), 'utf8');
  const serverJsContent = fs.readFileSync(path.join(rootDir, 'server.js'), 'utf8');
  const htmlContent = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');

  await t.test('1. Module syntax & files parse cleanly without error', () => {
    assert.doesNotThrow(() => {
      new vm.Script(advanceJsContent);
    }, 'atpl-advance-management.js must parse with zero syntax errors');

    assert.doesNotThrow(() => {
      new vm.Script(serverJsContent);
    }, 'server.js must parse with zero syntax errors');
  });

  await t.test('2. UI Navigation & Page containers correctly integrated into index.html', () => {
    // Nav item under cat-sal
    assert(htmlContent.includes('id="vn-advance"'), 'index.html must include vn-advance navigation item');
    assert(htmlContent.includes("goPage('advance')"), 'index.html must have goPage(\'advance\') hook');

    // Dedicated full-screen page container
    assert(htmlContent.includes('id="page-advance"'), 'index.html must have page-advance container');
    assert(htmlContent.includes('id="advanceModuleContainer"'), 'index.html must have advanceModuleContainer');

    // Script tag included
    assert(htmlContent.includes('src="atpl-advance-management.js"'), 'index.html must load atpl-advance-management.js');

    // All Files integration
    assert(htmlContent.includes('ATPLAdvanceManager.processAllSalaryFiles'), 'handleFiles must trigger processAllSalaryFiles');
    assert(htmlContent.includes('Advances Deducted'), 'renderAllFilesPage must display Advance Deductions button');
  });

  await t.test('3. Server REST endpoints for advances & deductions are fully declared in server.js', () => {
    assert(serverJsContent.includes("app.get('/api/sync/advances'"), 'server.js must expose GET /api/sync/advances');
    assert(serverJsContent.includes("app.post('/api/sync/advance'"), 'server.js must expose POST /api/sync/advance');
    assert(serverJsContent.includes("app.delete('/api/sync/advance/:id'"), 'server.js must expose DELETE /api/sync/advance/:id');
    assert(serverJsContent.includes("app.get('/api/sync/advance-deductions'"), 'server.js must expose GET /api/sync/advance-deductions');
    assert(serverJsContent.includes("app.post('/api/sync/advance-deduction'"), 'server.js must expose POST /api/sync/advance-deduction');
    assert(serverJsContent.includes("advances: Object.values(syncAdvances)"), 'server.js /api/sync/state must return advances');
    assert(serverJsContent.includes("advance_deductions: Object.values(syncAdvanceDeductions)"), 'server.js /api/sync/state must return advance_deductions');
  });

  await t.test('4. Employee Master auto-fetch and advance entry creation & balance tracking', () => {
    const mockStorage = {};
    const mockWindow = {
      localStorage: {
        getItem: (k) => mockStorage[k] || null,
        setItem: (k, v) => { mockStorage[k] = String(v); },
        removeItem: (k) => { delete mockStorage[k]; }
      },
      document: {
        addEventListener: () => {},
        getElementById: () => null,
        body: { appendChild: () => {} },
        readyState: 'complete'
      },
      addEventListener: () => {},
      BroadcastChannel: class {
        postMessage() {}
        close() {}
      },
      EM: {
        data: [
          { emp_id: '25924', name: 'Ram Kumar Sharma', dept: 'Spinning', desig: 'Senior Operator', basic: 15000 },
          { emp_id: '26001', name: 'Priya Singh', dept: 'Weaving', desig: 'Supervisor', basic: 18000 }
        ]
      },
      showToast: () => {}
    };
    mockWindow.window = mockWindow;

    const ctx = vm.createContext(mockWindow);
    vm.runInContext(advanceJsContent, ctx);

    assert(mockWindow.ATPLAdvanceManager, 'ATPLAdvanceManager must be attached to window');

    // Add an advance of ₹10,000 for employee 25924
    const ok = mockWindow.ATPLAdvanceManager.addOrUpdateAdvance({
      empCode: '25924',
      amount: 10000,
      advanceDate: '2026-03-01',
      monthlyCap: 5000,
      remarks: 'Festival advance'
    });
    assert.equal(ok, true, 'Advance entry must save successfully');

    const advances = mockWindow.ATPLAdvanceManager.getAllAdvances();
    assert.equal(advances.length, 1, 'Should have exactly 1 advance record');
    assert.equal(advances[0].empName, 'Ram Kumar Sharma', 'Must auto-fetch employee name from EM.data');
    assert.equal(advances[0].amount, 10000, 'Amount must be 10000');
    assert.equal(advances[0].balanceAmount, 10000, 'Initial balance must be 10000');
    assert.equal(advances[0].status, 'ACTIVE', 'Initial status must be ACTIVE');

    const outBal = mockWindow.ATPLAdvanceManager.getEmployeeOutstandingBalance('25924');
    assert.equal(outBal, 10000, 'Employee total outstanding balance must be 10000');
  });

  await t.test('5. Automatic salary deduction on monthly sheet upload & idempotency guarantee', () => {
    const mockStorage = {};
    const mockWindow = {
      localStorage: {
        getItem: (k) => mockStorage[k] || null,
        setItem: (k, v) => { mockStorage[k] = String(v); },
        removeItem: (k) => { delete mockStorage[k]; }
      },
      document: {
        addEventListener: () => {},
        getElementById: () => null,
        body: { appendChild: () => {} },
        readyState: 'complete'
      },
      addEventListener: () => {},
      BroadcastChannel: class { postMessage() {} close() {} },
      EM: {
        data: [{ emp_id: '25924', name: 'Ram Kumar Sharma', dept: 'Spinning' }]
      },
      showToast: () => {}
    };
    mockWindow.window = mockWindow;

    const ctx = vm.createContext(mockWindow);
    vm.runInContext(advanceJsContent, ctx);

    // Record advance of ₹12,000 with ₹4,000 monthly cap
    mockWindow.ATPLAdvanceManager.addOrUpdateAdvance({
      id: 'adv_test_1',
      empCode: '25924',
      amount: 12000,
      advanceDate: '2026-01-10',
      monthlyCap: 4000,
      remarks: 'Medical loan'
    });

    // Simulate March 2026 Salary Sheet upload
    const salarySheetMarch = {
      name: 'Salary_March_2026.xlsx',
      sheets: {
        'Salary Details': [
          ['Emp Code', 'Employee Name', 'Department', 'Net Payment'],
          ['25924', 'Ram Kumar Sharma', 'Spinning', '22500'],
          ['26002', 'Lokesh Verma', 'Dyeing', '18000']
        ]
      }
    };

    const res1 = mockWindow.ATPLAdvanceManager.processSalaryFile(salarySheetMarch);
    assert.equal(res1.processed, 1, 'Must deduct advance for Ram Kumar Sharma');
    assert.equal(res1.deductions[0].deductedAmount, 4000, 'Must deduct installment of 4000');
    assert.equal(res1.deductions[0].previousBalance, 12000, 'Previous balance was 12000');
    assert.equal(res1.deductions[0].remainingBalance, 8000, 'Remaining balance must now be 8000');

    // Check advance record status
    const advAfter1 = mockWindow.ATPLAdvanceManager.getAllAdvances().find(a => a.id === 'adv_test_1');
    assert.equal(advAfter1.recoveredAmount, 4000, 'Recovered amount must be 4000');
    assert.equal(advAfter1.balanceAmount, 8000, 'Balance amount must be 8000');
    assert.equal(advAfter1.status, 'PARTIAL', 'Status must now be PARTIAL');

    // IDEMPOTENCY CHECK: Re-uploading or re-processing the EXACT SAME March 2026 sheet must NOT deduct again
    const resDuplicate = mockWindow.ATPLAdvanceManager.processSalaryFile(salarySheetMarch);
    assert.equal(resDuplicate.processed, 0, 'Must NOT deduct the same salary sheet twice (idempotency)');
    assert.equal(advAfter1.balanceAmount, 8000, 'Balance must remain 8000 without duplicate deduction');

    // Simulate April 2026 Salary Sheet upload
    const salarySheetApril = {
      name: 'Salary_April_2026.xlsx',
      sheets: {
        'Sheet1': [
          ['Emp Code', 'Employee Name', 'Net Payment'],
          ['25924', 'Ram Kumar Sharma', '23000']
        ]
      }
    };

    const res2 = mockWindow.ATPLAdvanceManager.processSalaryFile(salarySheetApril);
    assert.equal(res2.processed, 1, 'Must process April salary deduction');
    assert.equal(res2.deductions[0].deductedAmount, 4000, 'Must deduct second installment of 4000');
    assert.equal(advAfter1.balanceAmount, 4000, 'Balance must now be 4000');

    // Simulate May 2026 Salary Sheet upload (Final payment)
    const salarySheetMay = {
      name: 'Salary_May_2026.xlsx',
      sheets: {
        'Sheet1': [
          ['Emp Code', 'Employee Name', 'Net Payment'],
          ['25924', 'Ram Kumar Sharma', '23000']
        ]
      }
    };

    const res3 = mockWindow.ATPLAdvanceManager.processSalaryFile(salarySheetMay);
    assert.equal(res3.processed, 1, 'Must process May salary deduction');
    assert.equal(advAfter1.balanceAmount, 0, 'Advance must now be fully cleared to 0');
    assert.equal(advAfter1.status, 'REPAID', 'Status must now be REPAID');

    // A June salary sheet must NOT deduct because balance is 0
    const salarySheetJune = {
      name: 'Salary_June_2026.xlsx',
      sheets: {
        'Sheet1': [
          ['Emp Code', 'Employee Name', 'Net Payment'],
          ['25924', 'Ram Kumar Sharma', '23000']
        ]
      }
    };
    const res4 = mockWindow.ATPLAdvanceManager.processSalaryFile(salarySheetJune);
    assert.equal(res4.processed, 0, 'Must not deduct when outstanding balance is 0');
  });

  await t.test('6. Never deduct more than outstanding balance even if net salary is higher', () => {
    const mockStorage = {};
    const mockWindow = {
      localStorage: {
        getItem: (k) => mockStorage[k] || null,
        setItem: (k, v) => { mockStorage[k] = String(v); },
        removeItem: (k) => { delete mockStorage[k]; }
      },
      document: {
        addEventListener: () => {},
        getElementById: () => null,
        body: { appendChild: () => {} },
        readyState: 'complete'
      },
      addEventListener: () => {},
      BroadcastChannel: class { postMessage() {} close() {} },
      EM: { data: [{ emp_id: '999', name: 'Test Worker' }] },
      showToast: () => {}
    };
    mockWindow.window = mockWindow;

    const ctx = vm.createContext(mockWindow);
    vm.runInContext(advanceJsContent, ctx);

    // Remaining balance is only ₹1,500, no cap set (default full deduction)
    mockWindow.ATPLAdvanceManager.addOrUpdateAdvance({
      id: 'adv_small',
      empCode: '999',
      amount: 1500,
      monthlyCap: 0,
      remarks: 'Small advance'
    });

    const file = {
      name: 'Salary_Nov_2026.xlsx',
      sheets: {
        'Data': [
          ['Emp Code', 'Name', 'Net Pay'],
          ['999', 'Test Worker', '25000']
        ]
      }
    };

    const res = mockWindow.ATPLAdvanceManager.processSalaryFile(file);
    assert.equal(res.processed, 1);
    assert.equal(res.deductions[0].deductedAmount, 1500, 'Must deduct exactly 1500 (capped at outstanding balance)');
    assert.equal(res.deductions[0].remainingBalance, 0, 'Remaining balance must be 0');
    assert.equal(mockWindow.ATPLAdvanceManager.getEmployeeOutstandingBalance('999'), 0);
  });
});
