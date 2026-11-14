const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('Pending Diff Amount (Salary/Adv) + Cash Adv Voucher (Directors Sign) + Month-Wise + Cross-Browser Sync', async (t) => {
  const rootDir = path.resolve(__dirname, '..');
  const advanceJsContent = fs.readFileSync(path.join(rootDir, 'atpl-advance-management.js'), 'utf8');
  const serverJsContent = fs.readFileSync(path.join(rootDir, 'server.js'), 'utf8');

  function makeDomCtx() {
    const mockStorage = {};
    const elements = {};
    const container = { innerHTML: '' };
    const modal = { id: 'advModal', innerHTML: '' };
    const fetchCalls = [];
    const bcPosted = [];
    const sseListeners = {};
    elements['advanceModuleContainer'] = container;
    elements['advModal'] = modal;

    let remotePendingDiffResponse = { ok: true, records: [], tombstones: {} };

    const mockWindow = {
      localStorage: {
        getItem: (k) => (Object.prototype.hasOwnProperty.call(mockStorage, k) ? mockStorage[k] : null),
        setItem: (k, v) => { mockStorage[k] = String(v); },
        removeItem: (k) => { delete mockStorage[k]; }
      },
      fetch: async (url, opts) => {
        const method = (opts && opts.method) || 'GET';
        let parsedBody = null;
        if (opts && opts.body) {
          try { parsedBody = JSON.parse(opts.body); } catch (_) { parsedBody = opts.body; }
        }
        fetchCalls.push({ url, method, body: parsedBody });
        if (method === 'GET' && String(url).startsWith('/api/sync/pending-diffs')) {
          return { ok: true, json: async () => remotePendingDiffResponse };
        }
        return { ok: true, json: async () => ({ ok: true }) };
      },
      document: {
        addEventListener: () => {},
        getElementById: (id) => elements[id] || null,
        createElement: () => ({ style: {}, setAttribute: () => {}, click: () => {} }),
        body: { appendChild: () => {}, removeChild: () => {} },
        readyState: 'complete',
        hidden: false
      },
      addEventListener: () => {},
      BroadcastChannel: class {
        postMessage(msg) { bcPosted.push(msg); }
        addEventListener() {}
        close() {}
      },
      EventSource: class {
        addEventListener(ev, fn) { sseListeners[ev] = fn; }
        close() {}
      },
      Blob: function(parts, opts) { return { parts, opts }; },
      URL: { createObjectURL: () => 'blob:mock-doc', revokeObjectURL: () => {} },
      setTimeout: setTimeout,
      clearTimeout: clearTimeout,
      setInterval: () => 0,
      clearInterval: () => {},
      EM: {
        data: [
          { emp_id: '25924', name: 'Ram Kumar Sharma', desig: 'Senior Operator', dept: 'Spinning', gross: 24000 },
          { emp_id: '26002', name: 'Lokesh Verma', desig: 'Dyeing Master', dept: 'Dyeing', gross: 18000 }
        ]
      },
      showToast: () => {}
    };
    mockWindow.window = mockWindow;
    return {
      mockWindow,
      elements,
      container,
      modal,
      fetchCalls,
      bcPosted,
      sseListeners,
      mockStorage,
      setRemotePendingDiffResponse: (val) => { remotePendingDiffResponse = val; }
    };
  }

  await t.test('1. Server & client expose Pending Diff endpoints, SSE listeners, and Pending Diff UI wiring', () => {
    assert(serverJsContent.includes("app.get('/api/sync/pending-diffs'"), 'server.js must expose GET /api/sync/pending-diffs');
    assert(serverJsContent.includes("app.post('/api/sync/pending-diff'"), 'server.js must expose POST /api/sync/pending-diff');
    assert(serverJsContent.includes("app.post('/api/sync/pending-diffs/bulk'"), 'server.js must expose POST /api/sync/pending-diffs/bulk');
    assert(serverJsContent.includes("app.delete('/api/sync/pending-diff/:id'"), 'server.js must expose DELETE /api/sync/pending-diff/:id');
    assert(serverJsContent.includes("'pending_diff_saved'"), 'server.js must broadcast SSE pending_diff_saved');
    assert(serverJsContent.includes("'pending_diff_deleted'"), 'server.js must broadcast SSE pending_diff_deleted');
    assert(serverJsContent.includes("'pending_diffs_updated'"), 'server.js must broadcast SSE pending_diffs_updated');
    assert(serverJsContent.includes('pending_diff_vouchers.json'), 'server.js must persist pending diffs to JSON');

    assert(advanceJsContent.includes('pending_diff_saved'), 'client must listen to SSE pending_diff_saved');
    assert(advanceJsContent.includes('pending_diff_deleted'), 'client must listen to SSE pending_diff_deleted');
    assert(advanceJsContent.includes('pending_diffs_updated'), 'client must listen to SSE pending_diffs_updated');
    assert(advanceJsContent.includes('ATPL_PendingDiffVouchersV1'), 'client must store pending diffs in localStorage');
  });

  await t.test('2. Emp Code lookup auto-fills Name, Designation & Department and creates Pending Diff record', () => {
    const { mockWindow, elements, container, modal, fetchCalls } = makeDomCtx();
    const ctx = vm.createContext(mockWindow);
    vm.runInContext(advanceJsContent, ctx);

    mockWindow.ATPLAdvanceManager.openPendingDiffModal();
    assert(modal.innerHTML.includes('id="advPdCode"'), 'Pending Diff modal must have Emp Code input');
    assert(modal.innerHTML.includes('id="advPdSignedBy"'), 'Pending Diff modal must have Director Signed By selector');
    assert(modal.innerHTML.includes('Sarthak ji'), 'Modal must include Sarthak ji');
    assert(modal.innerHTML.includes('Manish ji'), 'Modal must include Manish ji');
    assert(modal.innerHTML.includes('Ayush ji'), 'Modal must include Ayush ji');

    // Simulate Emp Code input auto-lookup
    elements['advPdEmpName'] = { value: '' };
    elements['advPdDesig'] = { value: '' };
    elements['advPdDept'] = { value: '' };
    elements['advPdSuggestions'] = { innerHTML: '', style: { display: 'none' } };
    mockWindow.ATPLAdvanceManager.onPendingDiffCodeInput('25924');
    assert.equal(elements['advPdEmpName'].value, 'Ram Kumar Sharma');
    assert.equal(elements['advPdDesig'].value, 'Senior Operator');
    assert.equal(elements['advPdDept'].value, 'Spinning');

    // Submit Pending Diff form via UI bindings
    elements['advPdCode'] = { value: '25924' };
    elements['advPdVoucherNo'] = { value: 'CAV-202610-001' };
    elements['advPdCategory'] = { value: 'Pending Salary' };
    elements['advPdMonth'] = { value: '2026-10' };
    elements['advPdDate'] = { value: '2026-10-18' };
    elements['advPdAmount'] = { value: '3500' };
    elements['advPdPaidNow'] = { value: '500' };
    elements['advPdSignedBy'] = { value: 'Manish ji' };
    elements['advPdRemarks'] = { value: 'Oct Salary Diff' };
    elements['advPdError'] = { textContent: '', style: { display: 'none' } };

    const formRes = mockWindow.ATPLAdvanceManager.submitPendingDiffForm(true);
    assert.equal(formRes.ok, true);
    assert.equal(formRes.record.empName, 'Ram Kumar Sharma');
    assert.equal(formRes.record.designation, 'Senior Operator');
    assert.equal(formRes.record.department, 'Spinning');
    assert.equal(formRes.record.monthKey, '2026-10');
    assert.equal(formRes.record.diffAmount, 3500);
    assert.equal(formRes.record.paidAmount, 500);
    assert.equal(formRes.record.pendingBalance, 3000);
    assert.equal(formRes.record.status, 'PARTIAL');
    assert.equal(formRes.record.signedBy, 'Manish ji');

    // Verify rendered tab and preview Cash Adv Voucher modal with all Directors' signatures
    assert(container.innerHTML.includes('Pending Diff Amount'), 'UI must render Pending Diff Amount view');
    assert(container.innerHTML.includes('CAV-202610-001'), 'UI must show voucher number');
    assert(modal.innerHTML.includes('ARORA TEXTILES PRIVATE LIMITED'), 'Cash Adv Voucher must display company header');
    assert(modal.innerHTML.includes('Sarthak ji'), 'Cash Adv Voucher must show Sarthak ji signature block');
    assert(modal.innerHTML.includes('Manish ji'), 'Cash Adv Voucher must show Manish ji signature block');
    assert(modal.innerHTML.includes('Ayush ji'), 'Cash Adv Voucher must show Ayush ji signature block');
    assert(modal.innerHTML.includes('Approved (Manish ji)'), 'Cash Adv Voucher must highlight approving Director');
    assert(modal.innerHTML.includes('Three Thousand Five Hundred Rupees Only'), 'Cash Adv Voucher must include Indian words amount');
    assert(modal.innerHTML.includes('Receiver Sign (25924)'), 'Cash Adv Voucher must include Employee Receiver signature');

    assert(
      fetchCalls.some((c) => c.method === 'POST' && c.url === '/api/sync/pending-diff' && c.body && c.body.voucherNo === 'CAV-202610-001'),
      'Saving Pending Diff must sync to POST /api/sync/pending-diff'
    );

    const docRes = mockWindow.ATPLAdvanceManager.downloadPendingDiffVoucherDoc(formRes.record.id);
    assert.equal(docRes.ok, true);
    assert(docRes.filename.includes('CAV-202610-001'));
    assert(docRes.html.includes('CASH ADVANCE / PENDING DIFF VOUCHER'));
  });

  await t.test('3. Month-wise maintenance, bulk feed, settlement & analytics work accurately', async () => {
    const { mockWindow, fetchCalls } = makeDomCtx();
    const ctx = vm.createContext(mockWindow);
    vm.runInContext(advanceJsContent, ctx);

    const batchOct = mockWindow.ATPLAdvanceManager.submitPendingDiffFeedBatch(
      [
        { empCode: '25924', category: 'Pending Salary', diffAmount: '2000', paidAmount: '0', signedBy: 'Sarthak ji', remarks: 'Oct Diff' },
        { empCode: '26002', category: 'Pending Advance', diffAmount: '1500', paidAmount: '500', signedBy: 'Ayush ji', remarks: 'Oct Adv' }
      ],
      '2026-10-12',
      '2026-10'
    );
    assert.equal(batchOct.ok, true);
    assert.equal(batchOct.count, 2);

    const batchNov = mockWindow.ATPLAdvanceManager.submitPendingDiffFeedBatch(
      [
        { empCode: '25924', category: 'Diff Amount', diffAmount: '1200', paidAmount: '1200', signedBy: 'Manish ji', remarks: 'Nov Settled' }
      ],
      '2026-11-05',
      '2026-11'
    );
    assert.equal(batchNov.ok, true);

    const monthly = mockWindow.ATPLAdvanceManager.getPendingDiffMonthlySummary();
    assert.equal(monthly.length, 2);
    assert.equal(monthly[0].monthKey, '2026-11');
    assert.equal(monthly[0].totalDiff, 1200);
    assert.equal(monthly[0].totalPaid, 1200);
    assert.equal(monthly[0].totalBalance, 0);

    assert.equal(monthly[1].monthKey, '2026-10');
    assert.equal(monthly[1].totalDiff, 3500);
    assert.equal(monthly[1].totalPaid, 500);
    assert.equal(monthly[1].totalBalance, 3000);

    // Check analytics integrates Pending Diff for selected & previous month
    const novAnalytics = mockWindow.ATPLAdvanceManager.getMonthAnalytics('2026-11', '');
    assert.equal(novAnalytics.selected.pendingDiffTotal, 1200);
    assert.equal(novAnalytics.selected.pendingDiffBalance, 0);
    assert.equal(novAnalytics.previous.pendingDiffTotal, 3500);
    assert.equal(novAnalytics.previous.pendingDiffBalance, 3000);

    // Settle remaining 2000 for Emp 25924 in Oct
    const octEmp1Id = batchOct.records[0].id;
    const settleRes = mockWindow.ATPLAdvanceManager.settlePendingDiff(octEmp1Id, {
      date: '2026-11-10',
      amount: 2000,
      signedBy: 'Sarthak ji',
      remarks: 'Cash Adv Payout'
    });
    assert.equal(settleRes.ok, true);
    assert.equal(settleRes.record.pendingBalance, 0);
    assert.equal(settleRes.record.status, 'SETTLED');
    assert.equal(settleRes.record.settlements.length, 1);
    await new Promise((r) => setTimeout(r, 25));
    assert(
      fetchCalls.some((c) => c.method === 'POST' && c.url === '/api/sync/pending-diffs/bulk'),
      'Bulk feed must trigger cloud/server bulk sync'
    );
  });

  await t.test('4. Cross-browser tombstone delete prevents stale cloud/browser replay resurrection', async () => {
    const { mockWindow, fetchCalls, bcPosted, mockStorage, setRemotePendingDiffResponse } = makeDomCtx();
    const ctx = vm.createContext(mockWindow);
    vm.runInContext(advanceJsContent, ctx);

    const created = mockWindow.ATPLAdvanceManager.addOrUpdatePendingDiff({
      id: 'pdiff_sync_1',
      empCode: '25924',
      category: 'Pending Salary',
      monthKey: '2026-10',
      entryDate: '2026-10-15',
      diffAmount: 4000,
      paidAmount: 0,
      signedBy: 'Sarthak ji'
    });
    assert.equal(created.ok, true);
    assert.equal(mockWindow.ATPLAdvanceManager.getAllPendingDiffs().length, 1);

    const delOk = mockWindow.ATPLAdvanceManager.deletePendingDiff('pdiff_sync_1');
    assert.equal(delOk, true);
    assert.equal(mockWindow.ATPLAdvanceManager.getAllPendingDiffs().length, 0);
    await new Promise((r) => setTimeout(r, 25));
    assert(
      fetchCalls.some((c) => c.method === 'DELETE' && c.url.includes('/api/sync/pending-diff/pdiff_sync_1')),
      'Deleting pending diff must call DELETE /api/sync/pending-diff/:id'
    );
    assert(
      bcPosted.some((m) => m && m.action === 'pending_diff_deleted' && m.details && m.details.id === 'pdiff_sync_1'),
      'Deleting pending diff must broadcast event to other open browser tabs'
    );
    assert(
      String(mockStorage['ATPL_AdvanceTombstonesV2'] || '').includes('pdiff:pdiff_sync_1'),
      'Tombstone must persist in localStorage'
    );

    // Simulate another browser having stale copy of pdiff_sync_1 plus a new pdiff_sync_2 via /api/sync/pending-diffs
    setRemotePendingDiffResponse({
      ok: true,
      records: [
        created.record,
        {
          id: 'pdiff_sync_2',
          empCode: '26002',
          empName: 'Lokesh Verma',
          category: 'Pending Advance',
          monthKey: '2026-11',
          entryDate: '2026-11-02',
          diffAmount: 1800,
          paidAmount: 0,
          signedBy: 'Manish ji',
          updatedAt: new Date().toISOString()
        }
      ],
      tombstones: {}
    });

    await mockWindow.ATPLAdvanceManager.syncNow(true);

    const afterSync = mockWindow.ATPLAdvanceManager.getAllPendingDiffs();
    assert.equal(afterSync.length, 1, 'Tombstoned pdiff_sync_1 must NOT resurrect from stale remote data');
    assert.equal(afterSync[0].id, 'pdiff_sync_2', 'New pdiff_sync_2 from another browser must sync cleanly');
  });
});
