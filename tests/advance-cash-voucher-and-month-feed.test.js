const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('Advance Cash Voucher, Month-Wise Feed, All Files Search & Sidebar Removal', async (t) => {
  const rootDir = path.resolve(__dirname, '..');
  const htmlContent = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');
  const advanceJsContent = fs.readFileSync(path.join(rootDir, 'atpl-advance-management.js'), 'utf8');
  const cleanupJsContent = fs.readFileSync(path.join(rootDir, 'erp-ui-cleanup-v1.js'), 'utf8');
  const enterpriseUiContent = fs.readFileSync(path.join(rootDir, 'erp-enterprise-ui-v1.js'), 'utf8');
  const serverJsContent = fs.readFileSync(path.join(rootDir, 'server.js'), 'utf8');

  function makeDomCtx() {
    const mockStorage = {};
    const elements = {};
    const container = { innerHTML: '' };
    const modal = { id: 'advModal', innerHTML: '' };
    const fetchCalls = [];
    elements['advanceModuleContainer'] = container;
    elements['advModal'] = modal;

    const mockWindow = {
      localStorage: {
        getItem: (k) => (Object.prototype.hasOwnProperty.call(mockStorage, k) ? mockStorage[k] : null),
        setItem: (k, v) => { mockStorage[k] = String(v); },
        removeItem: (k) => { delete mockStorage[k]; }
      },
      fetch: async (url, opts) => {
        fetchCalls.push({ url, method: (opts && opts.method) || 'GET', body: opts && opts.body });
        return { ok: true, json: async () => ({ ok: true }) };
      },
      document: {
        addEventListener: () => {},
        getElementById: (id) => elements[id] || null,
        body: { appendChild: () => {} },
        readyState: 'complete',
        hidden: false
      },
      addEventListener: () => {},
      BroadcastChannel: class { postMessage() {} close() {} },
      EM: {
        data: [
          { emp_id: '25924', name: 'Ram Kumar Sharma', dept: 'Spinning', gross: 24000 },
          { emp_id: '26002', name: 'Lokesh Verma', dept: 'Dyeing', gross: 18000 }
        ]
      },
      showToast: () => {}
    };
    mockWindow.window = mockWindow;
    return { mockWindow, elements, container, modal, fetchCalls };
  }

  await t.test('1. Four yellow-highlighted sidebar items are hidden across index.html & UI cleanup scripts', () => {
    for (const id of ['vn-ai-commander', 'vn-challan', 'vn-dol', 'vn-dolverify']) {
      assert(
        htmlContent.includes(`id="${id}"`) &&
          new RegExp(`id="${id}"[^>]*display:none!important`).test(htmlContent),
        `${id} must be hidden in index.html`
      );
      assert(cleanupJsContent.includes(`#${id}`), `${id} must be hidden in erp-ui-cleanup-v1.js`);
      assert(enterpriseUiContent.includes(`#${id}`), `${id} must be hidden in erp-enterprise-ui-v1.js`);
    }
  });

  await t.test('2. All Files page has search box and in-place filter functions without losing file indices', () => {
    assert(htmlContent.includes('id="allFilesSearchInput"'), 'All Files search input must exist');
    assert(htmlContent.includes('oninput="filterAllFilesList(this.value)"'), 'All Files search input must call filterAllFilesList');
    assert(htmlContent.includes('id="allFilesSearchClearBtn"'), 'Clear search button must exist');
    assert(htmlContent.includes('data-search-text='), 'File cards must expose data-search-text');
    assert(htmlContent.includes('id="allFilesNoMatch"'), 'No-match empty state must exist');
  });

  await t.test('3. Cash Voucher modal includes Date, Amount deduction & Signed By (Ayush ji, Sarthak ji, Manish ji)', () => {
    const { mockWindow, elements, modal, fetchCalls } = makeDomCtx();
    const ctx = vm.createContext(mockWindow);
    vm.runInContext(advanceJsContent, ctx);

    mockWindow.ATPLAdvanceManager.addOrUpdateAdvance({
      id: 'adv_cv_1',
      empCode: '25924',
      amount: 10000,
      advanceDate: '2026-03-05',
      remarks: 'March Advance'
    });

    mockWindow.ATPLAdvanceManager.openCashVoucherModal('25924', 'adv_cv_1');
    assert(modal.innerHTML.includes('id="advCvDate"'), 'Cash Voucher modal must include date input');
    assert(modal.innerHTML.includes('id="advCvAmount"'), 'Cash Voucher modal must include amount input');
    assert(modal.innerHTML.includes('id="advCvSignedBy"'), 'Cash Voucher modal must include Signed By dropdown');
    assert(modal.innerHTML.includes('value="Ayush ji"'), 'Signed By dropdown must include Ayush ji');
    assert(modal.innerHTML.includes('value="Sarthak ji"'), 'Signed By dropdown must include Sarthak ji');
    assert(modal.innerHTML.includes('value="Manish ji"'), 'Signed By dropdown must include Manish ji');

    // Simulate submitting Cash Voucher form
    elements['advCvCode'] = { value: '25924' };
    elements['advCvTarget'] = { value: 'adv_cv_1' };
    elements['advCvDate'] = { value: '2026-04-12' };
    elements['advCvAmount'] = { value: '3500' };
    elements['advCvSignedBy'] = { value: 'Sarthak ji' };
    elements['advCvRemarks'] = { value: 'Cash Voucher #21' };
    elements['advCvError'] = { textContent: '', style: { display: 'none' } };

    const submitRes = mockWindow.ATPLAdvanceManager.submitCashVoucher();
    assert.equal(submitRes.ok, true);
    assert.equal(submitRes.deductions[0].isCashVoucher, true);
    assert.equal(submitRes.deductions[0].signedBy, 'Sarthak ji');
    assert.equal(submitRes.deductions[0].deductionDate, '2026-04-12');
    assert.equal(mockWindow.ATPLAdvanceManager.getEmployeeOutstandingBalance('25924'), 6500);

    // Reverse Cash Voucher must restore balance and call DELETE /api/sync/advance-deduction/:id
    const dedId = submitRes.deductions[0].id;
    assert.equal(mockWindow.ATPLAdvanceManager.deleteDeduction(dedId), true);
    assert.equal(mockWindow.ATPLAdvanceManager.getEmployeeOutstandingBalance('25924'), 10000);
    assert(
      fetchCalls.some((c) => c.method === 'DELETE' && c.url.includes('/api/sync/advance-deduction/' + encodeURIComponent(dedId))),
      'deleteDeduction must notify /api/sync/advance-deduction/:id DELETE endpoint'
    );
    assert(serverJsContent.includes("app.delete('/api/sync/advance-deduction/:id'"), 'server.js must handle DELETE /api/sync/advance-deduction/:id');
  });

  await t.test('4. Month-Wise Feed & Selected/Previous Month (Pichla Mahina) + Date Analytics', () => {
    const { mockWindow, container, modal } = makeDomCtx();
    const ctx = vm.createContext(mockWindow);
    vm.runInContext(advanceJsContent, ctx);

    mockWindow.ATPLAdvanceManager.openMonthFeedModal('2026-03');
    assert(modal.innerHTML.includes('id="advFeedMonth"'), 'Month feed modal must include month input');
    assert(modal.innerHTML.includes('id="advFeedDate"'), 'Month feed modal must include date input');

    // Feed March 2026 (Previous Month relative to April 2026)
    const marchFeed = mockWindow.ATPLAdvanceManager.submitMonthFeedBatch(
      [
        { empCode: '25924', givenAmount: '8000', recoveredAmount: '2000', mode: 'Salary Sheet Recovery', remarks: 'March Feed' },
        { empCode: '26002', givenAmount: '4000', recoveredAmount: '0', mode: 'Salary Sheet Recovery', remarks: 'March Feed' }
      ],
      '2026-03-10',
      '2026-03'
    );
    assert.equal(marchFeed.ok, true);
    assert.equal(marchFeed.advancesCount, 2);
    assert.equal(marchFeed.deductionsCount, 1);

    // Feed April 2026 via Cash Voucher by Manish ji
    const aprilFeed = mockWindow.ATPLAdvanceManager.submitMonthFeedBatch(
      [
        { empCode: '25924', givenAmount: '1000', recoveredAmount: '1500', mode: 'Cash Voucher', signedBy: 'Manish ji', remarks: 'April CV' }
      ],
      '2026-04-15',
      '2026-04'
    );
    assert.equal(aprilFeed.ok, true);

    mockWindow.ATPLAdvanceManager.setSelectedDate('2026-04-15');
    const analytics = mockWindow.ATPLAdvanceManager.getMonthAnalytics('2026-04', '2026-04-15');
    assert.equal(analytics.selected.monthKey, '2026-04');
    assert.equal(analytics.selected.givenTotal, 1000);
    assert.equal(analytics.selected.voucherRecovered, 1500);
    assert.equal(analytics.previous.monthKey, '2026-03');
    assert.equal(analytics.previous.givenTotal, 12000, 'Previous month must aggregate March given advances (8000+4000)');
    assert.equal(analytics.previous.recoveredTotal, 2000, 'Previous month must aggregate March recovery (2000)');
    assert.equal(analytics.exactDate.givenTotal, 1000);
    assert.equal(analytics.exactDate.recoveredTotal, 1500);
    assert(container.innerHTML.includes('Pichla Mahina'), 'Rendered UI must display Pichla Mahina comparison');
  });
});
