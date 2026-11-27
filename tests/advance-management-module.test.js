const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('Advance Management Module - Enterprise Tests (Manual-Only Deduction & Employee History)', async (t) => {
  const rootDir = path.join(__dirname, '..');
  const htmlContent = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');
  const advanceJsContent = fs.readFileSync(path.join(rootDir, 'atpl-advance-management.js'), 'utf8');

  function makeMockWindow(emData) {
    const store = new Map();
    const container = { innerHTML: '' };
    const modal = { innerHTML: '' };
    const appendedElements = [];

    const mockWindow = {
      console,
      Math, Date, JSON, Number, String, Array, Object, Boolean, RegExp, parseInt, parseFloat, isNaN, Promise, setTimeout,
      alert: () => {},
      confirm: () => true,
      fetch: async () => ({ ok: false, json: async () => ({}) }),
      localStorage: {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: (k) => store.delete(k)
      },
      document: {
        createElement: () => ({ style: {}, href: '', download: '', click: () => {}, appendChild: () => {} }),
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

  await t.test('2. HTML wiring: index.html includes advance module, nav item, page container, protects Advance History, and disables auto salary-sheet scan', () => {
    assert(htmlContent.includes('id="vn-advance"'), 'Sidebar must have Advance Management link');
    assert(htmlContent.includes('id="page-advance"'), 'Page container must have page-advance');
    assert(htmlContent.includes('id="advanceModuleContainer"'), 'Module mount div advanceModuleContainer must exist');
    assert(/src="atpl-advance-management\.js(\?[^"]*)?"/.test(htmlContent), 'index.html must load atpl-advance-management.js');
    assert(!htmlContent.includes('ATPLAdvanceManager.processAllSalaryFiles'), 'handleFiles must NOT auto-trigger processAllSalaryFiles');
    assert(htmlContent.includes("b.closest('#advanceModuleContainer')"), 'HR doc history cleanup must protect Advance Employee History buttons');
  });

  await t.test('3. Salary Sheet Auto-Deduction is Disabled (Even with Explicit Advance Column)', () => {
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

    const marchWorkbook = {
      name: 'Salary_March_2026.xlsx',
      sheets: {
        'Fourmala Sheet': [
          ['Emp Code', 'Employee Name', 'Basic', 'Gross', 'Advance Deduction', 'Net Payable'],
          ['25924', 'Ram Kumar Sharma', '15000', '24000', '3500', '20500'],
          ['26002', 'Lokesh Verma', '12000', '18000', '1500', '16500']
        ]
      }
    };
    mockWindow.FILES = [marchWorkbook];
    mockWindow.getAllLoadedSalaryFiles = () => [marchWorkbook];

    const resMarch = mockWindow.ATPLAdvanceManager.processSalaryFile(marchWorkbook);
    assert.equal(resMarch.processed, 0, 'processSalaryFile must NOT deduct any advance from salary sheet');
    assert.equal(mockWindow.ATPLAdvanceManager.processAllSalaryFiles(), 0, 'processAllSalaryFiles must NOT deduct any advance');
    assert.equal(mockWindow.ATPLAdvanceManager.getEmployeeOutstandingBalance('25924'), 12000, 'Ram advance balance must stay untouched');
    assert.equal(mockWindow.ATPLAdvanceManager.getEmployeeOutstandingBalance('26002'), 5000, 'Lokesh advance balance must stay untouched');
    assert.equal(mockWindow.ATPLAdvanceManager.getAllDeductions().length, 0, 'No automatic salary-sheet deduction may be recorded');
  });

  await t.test('4. Multi-advance FIFO allocation & capping at outstanding balance via Manual Deduction', () => {
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

    const overRes = mockWindow.ATPLAdvanceManager.deductAdvanceManually({
      empCode: '999',
      amount: 8000,
      deductionDate: '2026-04-01',
      mode: 'Manual Cash Recovery'
    });
    assert.equal(overRes.ok, false, 'Manual cut above outstanding balance must be rejected');

    const res = mockWindow.ATPLAdvanceManager.deductAdvanceManually({
      empCode: '999',
      amount: 7000,
      deductionDate: '2026-04-01',
      mode: 'Manual Cash Recovery'
    });
    assert.equal(res.ok, true);
    assert.equal(res.deductions.length, 2, 'Should split manual deduction FIFO across both active advances');
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

    // 1. First manual cut of ₹3,000
    const firstMan = mockWindow.ATPLAdvanceManager.deductAdvanceManually({
      empCode: '25924',
      amount: 3000,
      deductionDate: '2026-03-31',
      mode: 'Manual Salary Adjustment',
      deductedFromSalary: 'March 2026 Staff Salary',
      remarks: 'Manually cut for March'
    });
    assert.equal(firstMan.ok, true);
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
    assert.equal(hist.totalSalaryCut, 0);
    assert.equal(hist.totalManualCut, 5500);
    assert.equal(hist.totalRemaining, 4500);
    assert.equal(hist.deductions.length, 2);

    mockWindow.ATPLAdvanceManager.viewEmployeeHistory('25924');
    assert(modal.innerHTML.includes('Ram Kumar Sharma'), 'History modal must show employee name');
    assert(modal.innerHTML.includes('Manual Salary Adjustment'), 'History modal must show manual adjustment mode');
    assert(modal.innerHTML.includes('Manual Cash Recovery'), 'History modal must show manual cash deduction mode');
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

  await t.test('6. Salary-Sheet File/Scan Controls Removed from Top Header & Only Manual Deduction Allowed', () => {
    const { mockWindow, container, modal } = makeMockWindow([
      { emp_id: '25924', name: 'Ram Kumar Sharma', dept: 'Spinning', gross: 24000 },
      { emp_id: '26002', name: 'Lokesh Verma', dept: 'Dyeing', gross: 18000 }
    ]);
    const fileApril = {
      name: 'April_Salary_2026.xlsx',
      sheets: {
        'Salary Sheet': [
          ['Emp Code', 'Employee Name', 'Gross', 'Advance Deduction', 'Net Payable'],
          ['25924', 'Ram Kumar Sharma', '24000', '2000', '22000']
        ]
      }
    };
    mockWindow.FILES = [fileApril];
    mockWindow.getAllLoadedSalaryFiles = () => [fileApril];

    const ctx = vm.createContext(mockWindow);
    vm.runInContext(advanceJsContent, ctx);

    mockWindow.ATPLAdvanceManager.addOrUpdateAdvance({
      id: 'adv_ram_drop',
      empCode: '25924',
      amount: 10000,
      advanceDate: '2026-04-01'
    });

    // Top bar must NOT contain salary-sheet file picker or Re-Scan Sheets controls
    assert(!container.innerHTML.includes('id="advFileSelect"'), 'Salary file selector bar must be removed');
    assert(!container.innerHTML.includes('id="advSalarySheetSelect"'), 'Deducted From sheet selector must be removed');
    assert(!container.innerHTML.includes('Re-Scan Sheets'), 'Re-Scan Sheets button must be removed');
    assert(container.innerHTML.includes('Manual Deduction'), 'Manual Deduction button must remain visible');

    // triggerDeductionScan opens manual modal and does NOT cut from any salary sheet
    assert.equal(mockWindow.ATPLAdvanceManager.triggerDeductionScan(), 0);
    assert(modal.innerHTML.includes('Manual Advance Deduction'), 'triggerDeductionScan must open Manual Deduction modal');
    assert.equal(mockWindow.ATPLAdvanceManager.getEmployeeOutstandingBalance('25924'), 10000);

    // Manual Deduction works cleanly
    const manSalRes = mockWindow.ATPLAdvanceManager.deductAdvanceManually({
      empCode: '25924',
      amount: 1000,
      deductionDate: '2026-06-30',
      mode: 'Manual Salary Adjustment',
      deductedFromFile: 'June_Payroll_2026.xlsx',
      deductedFromSalary: 'June 2026 Staff Salary',
      remarks: 'Cut from June Staff Salary'
    });
    assert.equal(manSalRes.ok, true);
    assert.equal(manSalRes.deductions[0].deductedFrom, 'June 2026 Staff Salary');
    assert.equal(manSalRes.deductions[0].deductedFromFile, 'June_Payroll_2026.xlsx');
    assert.equal(mockWindow.ATPLAdvanceManager.getEmployeeOutstandingBalance('25924'), 9000);
  });

  await t.test("7. Advance Deduction + Next Month Pending Excel Report (.xlsx) covers month cuts, cleared dues, and next-month carry-forward pending", () => {
    const XLSX = require(path.join(rootDir, "xlsx.full.min.js"));
    const { mockWindow, container } = makeMockWindow([
      { emp_id: "101", name: "SAMPAT LAL", dept: "FELTING", desig: "Operator" },
      { emp_id: "102", name: "SURENDRA KUMAR", dept: "CARDING", desig: "Helper" },
      { emp_id: "103", name: "BULLURAM", dept: "WASHING", desig: "Operator" }
    ]);
    mockWindow.XLSX = XLSX;
    mockWindow.Blob = globalThis.Blob;
    mockWindow.URL = { createObjectURL: () => "blob:mock-xlsx", revokeObjectURL: () => {} };
    let lastDownload = "";
    mockWindow.document.createElement = () => ({
      style: {},
      setAttribute: function(k, v) { if (k === "download") lastDownload = v; },
      click: function() { if (this.download) lastDownload = this.download; }
    });
    mockWindow.document.body = { appendChild: () => {}, removeChild: () => {} };

    const ctx = vm.createContext(mockWindow);
    vm.runInContext(advanceJsContent, ctx);

    // Emp 101: ₹10,000 advance in Mar 2026, ₹3,000 cut in Apr 2026 -> ₹7,000 pending for May 2026
    mockWindow.ATPLAdvanceManager.addOrUpdateAdvance({
      id: "adv_101", empCode: "101", amount: 10000, monthlyCap: 3000, advanceDate: "2026-03-10", remarks: "Home repair"
    });
    mockWindow.ATPLAdvanceManager.deductAdvanceManually({
      empCode: "101", amount: 3000, deductionDate: "2026-04-30", mode: "Manual Salary Adjustment", deductedFromSalary: "April 2026", remarks: "April cut"
    });

    // Emp 102: ₹4,000 advance in Apr 2026, ₹4,000 fully cut in Apr 2026 -> ₹0 pending for May 2026 (Cleared)
    mockWindow.ATPLAdvanceManager.addOrUpdateAdvance({
      id: "adv_102", empCode: "102", amount: 4000, advanceDate: "2026-04-02", remarks: "Medical"
    });
    mockWindow.ATPLAdvanceManager.deductAdvanceManually({
      empCode: "102", amount: 4000, deductionDate: "2026-04-30", mode: "Cash Voucher", remarks: "Full cash settled"
    });

    // Emp 103: ₹5,000 advance in Mar 2026, NO cut in Apr 2026 -> ₹5,000 pending for May 2026
    mockWindow.ATPLAdvanceManager.addOrUpdateAdvance({
      id: "adv_103", empCode: "103", amount: 5000, monthlyCap: 2000, advanceDate: "2026-03-15", remarks: "Family"
    });

    mockWindow.ATPLAdvanceManager.setSelectedMonth("2026-04");
    assert(container.innerHTML.includes("exportAdvanceExcelReport"), "UI must render Excel Report download button");
    mockWindow.ATPLAdvanceManager.setTab("deductions");
    assert(container.innerHTML.includes("Download Deduction + Next Month Pending Excel"), "Deductions tab must show Excel download button");

    const res = mockWindow.ATPLAdvanceManager.exportAdvanceExcelReport("2026-04");
    assert.equal(res.ok, true, "Excel export must succeed");
    assert.ok(res.fileName.includes("2026-04") && res.fileName.includes("2026-05") && res.fileName.endsWith(".xlsx"));
    assert.equal(lastDownload, res.fileName, "Download link must trigger .xlsx download");
    assert.deepEqual(res.workbook.SheetNames, ["Cut & Next Pending", "Next Month Pending", "Month Cut Details", "All Advances Ledger"]);

    const rep = res.report;
    assert.equal(rep.monthKey, "2026-04");
    assert.equal(rep.nextMonthKey, "2026-05");
    assert.equal(rep.totals.employeesCutCount, 2, "2 employees had deductions in April 2026");
    assert.equal(rep.totals.cutInMonth, 7000, "Total April cuts = 3000 + 4000");
    assert.equal(rep.totals.employeesNextPendingCount, 2, "2 employees carry pending balance into May 2026");
    assert.equal(rep.totals.nextMonthPending, 12000, "Total May 2026 pending = 7000 (101) + 5000 (103)");

    const r101 = rep.summaryRows.find(r => r.empCode === "101");
    const r102 = rep.summaryRows.find(r => r.empCode === "102");
    const r103 = rep.summaryRows.find(r => r.empCode === "103");
    assert.equal(r101.cutInMonth, 3000);
    assert.equal(r101.nextMonthPending, 7000);
    assert.equal(r102.cutInMonth, 4000);
    assert.equal(r102.nextMonthPending, 0);
    assert.equal(r103.cutInMonth, 0);
    assert.equal(r103.nextMonthPending, 5000);

    // Next Month Pending sheet must ONLY include 101 and 103 (NOT cleared 102)
    assert.deepEqual(Array.from(rep.nextMonthPendingRows, r => r.empCode).sort(), ["101", "103"]);
    // Month Cut Details must have 2 transactions (101 and 102)
    assert.equal(rep.monthDeductionRows.length, 2);
  });

  await t.test('8. Signed Advance Slip preview supports mouse-wheel zoom in/out, zoom buttons, and reset', async () => {
    const elements = new Map();
    const wheelListeners = [];
    const viewportEl = {
      style: {},
      clientWidth: 640,
      clientHeight: 380,
      scrollWidth: 640,
      scrollHeight: 380,
      scrollLeft: 0,
      scrollTop: 0,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 640, height: 380, right: 640, bottom: 380 }),
      addEventListener: (ev, fn) => { if (ev === 'wheel') wheelListeners.push(fn); }
    };
    const imgEl = {
      style: {},
      clientWidth: 260,
      clientHeight: 350,
      naturalWidth: 520,
      naturalHeight: 700,
      getBoundingClientRect: () => ({
        left: 190,
        top: 15,
        width: parseInt(imgEl.style.width, 10) || 260,
        height: parseInt(imgEl.style.height, 10) || 350,
        right: 190 + (parseInt(imgEl.style.width, 10) || 260),
        bottom: 15 + (parseInt(imgEl.style.height, 10) || 350)
      })
    };
    const pctEl = { textContent: '100%' };
    const previewBoxEl = {
      _html: '',
      get innerHTML() { return this._html; },
      set innerHTML(val) {
        this._html = String(val || '');
        if (this._html.includes('id="advSlipZoomViewport"')) {
          elements.set('advSlipZoomViewport', viewportEl);
          elements.set('advSlipZoomImg', imgEl);
          elements.set('advSlipZoomPct', pctEl);
        }
      }
    };
    elements.set('advSlipPreviewBox', previewBoxEl);

    const { mockWindow, modal } = makeMockWindow();
    const origGetEl = mockWindow.document.getElementById;
    mockWindow.document.getElementById = (id) => {
      if (elements.has(id)) return elements.get(id);
      return origGetEl(id);
    };
    vm.runInNewContext(advanceJsContent, mockWindow);
    const mgr = mockWindow.ATPLAdvanceManager;
    assert.ok(typeof mgr.zoomSlipBy === 'function', 'zoomSlipBy must be exposed');
    assert.ok(typeof mgr.resetSlipZoom === 'function', 'resetSlipZoom must be exposed');

    mgr.addOrUpdateAdvance({
      id: 'adv_zoom_1',
      empCode: '25191',
      empName: 'UMMAID SINGH',
      advanceDate: '2026-11-24',
      amount: 15000
    });
    const upRes = await mgr.uploadAdvanceSlip('adv_zoom_1', {
      fileName: 'slip.jpg',
      mimeType: 'image/jpeg',
      size: 120,
      dataUrl: 'data:image/jpeg;base64,ZmFrZQ=='
    });
    assert.equal(upRes.ok, true);

    mgr.openSlipModal('adv_zoom_1');
    await new Promise((r) => setTimeout(r, 25));

    assert.ok(previewBoxEl.innerHTML.includes('id="advSlipZoomViewport"'), 'Slip preview must render zoom viewport');
    assert.ok(previewBoxEl.innerHTML.includes('id="advSlipZoomImg"'), 'Slip preview must render zoomable image');
    assert.equal(wheelListeners.length, 1, 'Wheel zoom listener must be attached to slip viewport');

    // Scroll up (wheel zoom in)
    let prevented = false;
    wheelListeners[0]({
      deltaY: -120,
      clientX: 300,
      clientY: 180,
      preventDefault: () => { prevented = true; },
      stopPropagation: () => {}
    });
    assert.equal(prevented, true, 'Mouse wheel on slip must prevent outer modal scrolling');
    assert.equal(pctEl.textContent, '115%', 'Wheel up must zoom in to 115%');
    assert.equal(imgEl.style.width, '299px');

    // Scroll up again -> further zoom in
    wheelListeners[0]({
      deltaY: -120,
      clientX: 300,
      clientY: 180,
      preventDefault: () => {},
      stopPropagation: () => {}
    });
    assert.equal(pctEl.textContent, '132%');

    // Scroll down -> zoom out
    wheelListeners[0]({
      deltaY: 120,
      clientX: 300,
      clientY: 180,
      preventDefault: () => {},
      stopPropagation: () => {}
    });
    assert.equal(pctEl.textContent, '115%');

    // Reset button restores 100%
    mgr.resetSlipZoom();
    assert.equal(pctEl.textContent, '100%');
    assert.equal(imgEl.style.maxHeight, '356px');
  });
});
