const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const CheckProduction = require(path.join(ROOT, 'atpl-check-production.js'));

function makeHeaderRow(cardTitle) {
  const row = ['Code', cardTitle || 'Card No. 1', 'Loctatic'];
  for (let d = 1; d <= 31; d++) row.push(d);
  row.push('Days', 'Salry', 'Total', 'Adv', 'Total amot');
  return row;
}

function makeDataRow({ code = '', name = '', loc = '', daysMap = {}, daysCol = '', rate = '', total = '' }) {
  const row = [code, name, loc];
  for (let d = 1; d <= 31; d++) {
    row.push(daysMap[d] != null ? daysMap[d] : '');
  }
  row.push(daysCol, rate, total, '', '');
  return row;
}

test('Check Production Module — Card Mapping, Sheet Parsing, Rates, Multi-Machine & HTML Wiring', async (t) => {
  await t.test('1. HTML wiring, syntax check & UI safety', () => {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const cpSrc = fs.readFileSync(path.join(ROOT, 'atpl-check-production.js'), 'utf8');
    assert.doesNotThrow(() => new Function(cpSrc), 'atpl-check-production.js parses via new Function');
    assert.ok(html.includes('id="vn-checkproduction"'), 'Sidebar Check Production tab exists');
    assert.ok(html.includes('id="page-checkproduction"'), 'Check Production page container exists');
    assert.ok(html.includes('id="checkProductionContainer"'), 'Mount container exists');
    assert.ok(html.includes('atpl-check-production.js'), 'Script tag wired in index.html');
    assert.ok(html.includes("'checkproduction':'cat-sal'"), 'Sidebar category auto-expand mapped');
  });

  await t.test('2. Sheet Card detection & Machine-to-Card mapping rules (C1..C13, C7R->Card07, C1224SP->Card12)', () => {
    const expectedSheets = [
      ['Card no-1', 1], ['Card no-3', 3], ['Card no.-5', 5], ['Card no.-6', 6],
      ['Card no-7', 7], ['Card no.-8', 8], ['Card no.-9', 9], ['Card no.-10', 10],
      ['Card no.-11', 11], ['Card no.-12', 12], ['Card no.-13', 13],
      ['C1', 1], ['C7', 7], ['C13', 13]
    ];
    expectedSheets.forEach(([name, num]) => {
      const info = CheckProduction.parseSheetCardInfo(name);
      assert.ok(info, 'Detected card sheet: ' + name);
      assert.equal(info.cardNum, num);
    });
    assert.equal(CheckProduction.parseSheetCardInfo('Summary'), null);
    assert.equal(CheckProduction.parseSheetCardInfo('Grand Total'), null);

    // Critical Cross-Card Mapping Rule: C7R appearing inside Card 01 sheet MUST credit Card 07
    const c7r = CheckProduction.classifyMachineAndCard('C7R', 15100, 1);
    assert.equal(c7r.cardNum, 7);
    assert.equal(c7r.cardLabel, 'Card 07');
    assert.equal(c7r.isCrossCard, true);

    const c7r26 = CheckProduction.classifyMachineAndCard('C7R2.60', 2.6, 1);
    assert.equal(c7r26.cardNum, 7);
    assert.equal(c7r26.machineCode, 'C7R');
    assert.equal(c7r26.isCrossCard, true);

    const c1r18 = CheckProduction.classifyMachineAndCard('C1R1.8', 1.8, 1);
    assert.equal(c1r18.cardNum, 1);
    assert.equal(c1r18.machineCode, 'C1R');
    assert.equal(c1r18.isCrossCard, false);

    // C1224PA & C1224SP must resolve to Card 12 (not Card 1224!)
    const c12pa = CheckProduction.classifyMachineAndCard('C1224PA', 12900, 1);
    assert.equal(c12pa.cardNum, 12);
    assert.equal(c12pa.cardLabel, 'Card 12');
    assert.equal(c12pa.isCrossCard, true);

    const c12sp = CheckProduction.classifyMachineAndCard('C1224SP', 4, 1);
    assert.equal(c12sp.cardNum, 12);
    assert.equal(c12sp.cardLabel, 'Card 12');
  });

  await t.test('3. Exact Excel calculation matching user screenshot rows (decimals, blanks, repeated headers, subtotals, cross-card credit)', () => {
    const sheet1Rows = [
      makeHeaderRow('Card No. 1'),
      // Gulshan: C12S (Card 12) + C1O (Card 1)
      makeDataRow({ code: '26672', name: 'Gulshan', loc: 'C12S', daysMap: { 18: 1 }, daysCol: 1, rate: 12900, total: 430 }),
      makeDataRow({ code: '26672', name: 'Gulshan', loc: 'C1O', daysMap: { 19: 1, 21: 1, 22: 1, 23: 1, 24: 1, 25: 1, 26: 1, 27: 1, 28: 1, 29: 1, 30: 1 }, daysCol: 11, rate: 15000, total: 5500 }),
      // Subtotal row (blank code/name/loc, only total) -> MUST be skipped
      ['', '', '', ...Array(31).fill(''), '', '', 17663, '', ''],
      // Section header row ('Ring') -> MUST be skipped
      ['', 'Ring', '', ...Array(31).fill(''), '', '', '', '', ''],
      // Sujan (blank code! + C12 entries inside Card 1 sheet)
      makeDataRow({ code: '', name: 'Sujan', loc: 'C1224PA', daysMap: { 19: 1 }, daysCol: 1, rate: 12900, total: 430 }),
      makeDataRow({ code: '', name: 'Sujan', loc: 'C12R', daysMap: { 19: 1.25 }, daysCol: 1.25, rate: 15100, total: 629 }),
      makeDataRow({ code: '', name: 'Sujan', loc: 'C1224SP', daysMap: { 18: 198 }, daysCol: 198, rate: 4, total: 792 }),
      makeDataRow({ code: '', name: 'Sujan', loc: 'C1R', daysMap: { 22: 1.3, 23: 1.3, 24: 1.3, 25: 1.33, 26: 1.33, 27: 1.3, 28: 1.33, 29: 1.3, 30: 1.3 }, daysCol: 11.79, rate: 15100, total: 5934 }),
      // Ramawadh (26303): C1R + C7P (inside Card 1 -> MUST credit Card 07!) + two C1W rows + C1P
      makeDataRow({ code: '26303', name: 'Ramawadh', loc: 'C1R', daysMap: { 11: 1.3, 12: 1.33 }, daysCol: 2.63, rate: 15100, total: 1324 }),
      makeDataRow({ code: '26303', name: 'Ramawadh', loc: 'C7P', daysMap: { 18: 203 }, daysCol: 203, rate: 2.25, total: 457 }),
      makeDataRow({ code: '26303', name: 'Ramawadh', loc: 'C1W', daysMap: { 1: 464, 2: 390, 3: 419 }, daysCol: 1273, rate: 2.25, total: 2864 }),
      makeDataRow({ code: '26303', name: 'Ramawadh', loc: 'C1W', daysMap: { 4: 456, 5: 238 }, daysCol: 694, rate: 2.25, total: 1562 }),
      makeDataRow({ code: '26303', name: 'Ramawadh', loc: 'C1P', daysMap: { 20: 446, 25: 506 }, daysCol: 952, rate: 2.25, total: 2142 }),
      // Repeated mid-sheet header (like Row 54) -> MUST NOT be counted as data row!
      makeHeaderRow('Card No. 1'),
      // Gudiya Rajbh (26430): C1R1.8 + C7R2.60 + C7R1.80 (different rates on same machine C7R!)
      makeDataRow({ code: '26430', name: 'Gudiya Rajbh', loc: 'C1R1.8', daysMap: { 5: 273, 8: 192 }, daysCol: 465, rate: 1.8, total: 837 }),
      makeDataRow({ code: '26430', name: 'Gudiya Rajbh', loc: 'C7R2.60', daysMap: { 7: 197, 13: 376 }, daysCol: 573, rate: 2.6, total: 1490 }),
      makeDataRow({ code: '26430', name: 'Gudiya Rajbh', loc: 'C7R1.80', daysMap: { 6: 217 }, daysCol: 217, rate: 1.8, total: 391 })
    ];

    const sheet7Rows = [
      makeHeaderRow('Card No. 7'),
      makeDataRow({ code: '26580', name: 'Subarto Barn', loc: 'C7W', daysMap: { 11: 454, 13: 420 }, daysCol: 874, rate: 2.25, total: 1967 })
    ];

    // Summary tab present in workbook -> MUST be ignored when Card sheets exist to prevent double-counting!
    const summaryTabRows = [
      makeHeaderRow('Summary'),
      makeDataRow({ code: '26303', name: 'Ramawadh', loc: 'C1W', daysMap: { 1: 9999 }, daysCol: 9999, rate: 2.25, total: 22498 })
    ];

    const ds = CheckProduction.parseWorkbookData(
      { 'Card no-1': sheet1Rows, 'Card no-7': sheet7Rows, 'Summary': summaryTabRows },
      { fileName: 'attendence sheet sep-26 (3).xlsx' }
    );

    assert.equal(ds.monthKey, '2026-09');
    assert.equal(ds.monthLabel, 'September 2026');
    assert.equal(ds.detectedSheets.length, 2, 'Summary sheet skipped; 2 card sheets parsed');
    assert.equal(ds.records.length, 15, 'Repeated headers, section label, and subtotals skipped accurately');

    const analytics = CheckProduction.computeAnalytics(ds.records);

    // Check Card 07 receives: Ramawadh C7P (203) + Gudiya C7R2.60 (573) + Gudiya C7R1.80 (217) from Card no-1 PLUS Subarto C7W (874) from Card no-7 = 1867
    const card7 = analytics.cards.find(c => c.cardKey === 'C7');
    assert.ok(card7, 'Card 07 exists');
    assert.equal(card7.totalQty, 1867);
    assert.equal(card7.crossCardIncomingCount, 3, '3 cross-sheet entries credited to Card 07');
    assert.equal(card7.crossCardIncomingQty, 993, '203 + 573 + 217 = 993 moved from Card no-1 to Card 07');

    // Check Card 12 receives: Gulshan C12S (1) + Sujan C1224PA (1) + Sujan C12R (1.25) + Sujan C1224SP (198) = 201.25
    const card12 = analytics.cards.find(c => c.cardKey === 'C12');
    assert.ok(card12, 'Card 12 exists');
    assert.equal(card12.totalQty, 201.25);

    // Check Card 01 ONLY receives C1* entries (never C7* or C12*!)
    const card1 = analytics.cards.find(c => c.cardKey === 'C1');
    assert.ok(card1, 'Card 01 exists');
    // Gulshan C1O (11) + Sujan C1R (11.49) + Ramawadh C1R (2.63) + C1W (1273+694) + C1P (952) + Gudiya C1R (465) = 3409.12
    assert.equal(card1.totalQty, 3409.42);

    // Check Machine C7R combines Gudiya's 573 @ 2.6 and 217 @ 1.8 = 790
    const mC7R = analytics.machines.find(m => m.machineCode === 'C7R');
    assert.ok(mC7R);
    assert.equal(mC7R.cardKey, 'C7');
    assert.equal(mC7R.totalQty, 790);
    assert.equal(mC7R.rates.length, 2);

    // Check Employee Ramawadh consolidation & separate machine records
    const ram = analytics.employees.find(e => e.empCode === '26303');
    assert.ok(ram);
    assert.equal(ram.totalQty, 3124.63); // 2.63 + 203 + 1273 + 694 + 952
    assert.equal(ram.machineRecords.length, 4, 'C1R, C7P, C1W (combined 2 rows same rate), C1P');
    const ramC1W = ram.machineRecords.find(mr => mr.machineCode === 'C1W');
    assert.equal(ramC1W.qty, 1967); // 1273 + 694
    assert.equal(ramC1W.daily[0], 464);
    assert.equal(ramC1W.daily[3], 456);

    // Check Gudiya Rajbh keeps separate records for C7R @ 2.6 and C7R @ 1.8
    const gudiya = analytics.employees.find(e => e.empCode === '26430');
    assert.ok(gudiya);
    assert.equal(gudiya.machineRecords.length, 3);
    assert.equal(gudiya.totalQty, 1255); // 465 + 573 + 217

    // Check Rate-wise breakdown includes separate entries for ₹1.8, ₹2.25, ₹2.6, ₹4
    const rate225 = analytics.rates.find(rt => rt.rate === 2.25 && rt.rateKind === 'piece');
    assert.ok(rate225);
    assert.equal(rate225.totalQty, 3996); // 203 + 1273 + 694 + 952 + 874
    assert.equal(rate225.totalValue, 8991); // 3996 * 2.25

    // Check Filtering by Card, Machine, Search
    const onlyCard7 = CheckProduction.filterRecords(ds.records, { cardFilter: 'C7' });
    assert.equal(CheckProduction.computeAnalytics(onlyCard7).totalQty, 1867);
    const searchSujan = CheckProduction.filterRecords(ds.records, { searchQuery: 'sujan' });
    assert.equal(CheckProduction.computeAnalytics(searchSujan).employeeCount, 1);
    assert.equal(CheckProduction.computeAnalytics(searchSujan).totalQty, 212.04);
  });

  await t.test('4. Rendered HTML UI across all 5 tabs & View More modal + Excel export builders', () => {
    const vm = require('node:vm');
    const code = fs.readFileSync(path.join(ROOT, 'atpl-check-production.js'), 'utf8');
    const container = { innerHTML: '' };
    const badge = { textContent: '', style: { display: '' } };
    const head = { appended: [], appendChild(el) { this.appended.push(el); } };
    const writtenFiles = [];
    const mockXlsx = {
      utils: {
        book_new: () => ({ SheetNames: [], Sheets: {} }),
        aoa_to_sheet: (aoa) => ({ aoa }),
        book_append_sheet: (wb, ws, name) => { wb.SheetNames.push(name); wb.Sheets[name] = ws; },
        sheet_to_json: () => []
      },
      writeFile: (wb, fname) => { writtenFiles.push({ fname, sheets: wb.SheetNames.slice() }); }
    };
    const sandbox = {
      window: null,
      document: {
        readyState: 'complete',
        head,
        getElementById: (id) => {
          if (id === 'checkProductionContainer') return container;
          if (id === 'checkProdBadge') return badge;
          if (id === 'atpl-cp-styles') return null;
          return null;
        },
        createElement: (tag) => ({ tag, id: '', textContent: '' }),
        addEventListener: () => {}
      },
      localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
      XLSX: mockXlsx,
      showToast: () => {},
      confirm: () => true,
      setTimeout, clearTimeout, console
    };
    sandbox.window = sandbox;
    vm.runInNewContext(code, sandbox);

    const cp = sandbox.ATPLCheckProduction;
    const ds = cp.parseWorkbookData({
      'Card no-1': [
        makeHeaderRow('Card No. 1'),
        makeDataRow({ code: '26303', name: 'Ramawadh', loc: 'C1W', daysMap: { 1: 464, 2: 390 }, daysCol: 854, rate: 2.25, total: 1922 }),
        makeDataRow({ code: '26303', name: 'Ramawadh', loc: 'C7P', daysMap: { 18: 203 }, daysCol: 203, rate: 2.25, total: 457 })
      ]
    }, { fileName: 'attendence sheet sep-26.xlsx' });

    const st = cp.getState();
    st.months[ds.monthKey] = ds;
    st.activeMonthKey = ds.monthKey;

    ['dashboard', 'cards', 'machines', 'employees', 'rates'].forEach(tab => {
      cp.setTab(tab);
      assert.ok(container.innerHTML.includes('Check Production'), 'Renders header on ' + tab);
      assert.ok(!container.innerHTML.includes('undefined'), 'No undefined text in ' + tab);
    });

    assert.ok(container.innerHTML.includes('₹2.25'), 'Rate-wise tab displays rate');
    cp.setTab('employees');
    assert.ok(container.innerHTML.includes('View More'), 'Employees tab shows View More button');
    assert.ok(container.innerHTML.includes('Ramawadh'), 'Employees tab renders employee');

    cp.openEmployeeDetail('CODE::26303');
    assert.ok(container.innerHTML.includes('cpEmpModalBackdrop'), 'View More modal opens');
    assert.ok(container.innerHTML.includes('Machine C1W'), 'Modal shows C1W machine');
    assert.ok(container.innerHTML.includes('Machine C7P'), 'Modal shows C7P machine');
    assert.ok(container.innerHTML.includes('Card 07'), 'Modal shows C7P credited to Card 07');
    assert.ok(container.innerHTML.includes('D18'), 'Modal shows Days 1-31 breakdown');

    cp.exportReport('cards');
    cp.exportReport('machines');
    cp.exportReport('employees');
    cp.exportReport('all');
    cp.exportSingleEmployeeExcel('CODE::26303');
    assert.equal(writtenFiles.length, 5);
    assert.deepEqual(writtenFiles[3].sheets, ['Card_Wise', 'Machine_Wise', 'Employee_Wise', 'Rate_Wise', 'Daily_1_31_Detail']);
  });

  await t.test('5. Anti-Hang: Background Worker & Sparse Extractor handle bloated 1,048,576-row sheets in milliseconds without freezing', async () => {
    const vm = require('node:vm');
    const workerCode = fs.readFileSync(path.join(ROOT, 'check-production-worker-v1.js'), 'utf8');
    assert.doesNotThrow(() => new Function(workerCode), 'check-production-worker-v1.js syntax valid');

    const posted = [];
    const mockWs = {
      '!ref': 'A1:XFD1048576', // Simulated Excel formatted to 1M rows x 16K cols!
      A1: { v: 'Code' }, B1: { v: 'Card No. 1' }, C1: { v: 'Loctatic' },
      D1: { v: 1 }, E1: { v: 2 }, F1: { v: 3 }, G1: { v: 4 }, H1: { v: 5 },
      I1: { v: 'Days' }, J1: { v: 'Salry' }, K1: { v: 'Total' },
      A2: { v: 26303 }, B2: { v: 'Ramawadh' }, C2: { v: 'C7P' },
      D2: { v: 200 }, E2: { v: 150 }, I2: { v: 350 }, J2: { v: 2.25 }, K2: { v: 788 },
      // Simulate styled empty cell at row 1,048,576 with no value
      A1048576: { s: {} }
    };
    const mockXlsx = {
      read: () => ({ SheetNames: ['Card no-1', 'Summary'], Sheets: { 'Card no-1': mockWs, Summary: { '!ref': 'A1:A1' } } }),
      utils: {
        decode_cell: (addr) => {
          const m = addr.match(/^([A-Z]+)(\d+)$/);
          if (!m) return { r: 0, c: 0 };
          let c = 0;
          for (let i = 0; i < m[1].length; i++) c = c * 26 + (m[1].charCodeAt(i) - 64);
          return { r: parseInt(m[2], 10) - 1, c: c - 1 };
        }
      }
    };
    const sandbox = {
      self: { postMessage: (msg) => posted.push(msg), onmessage: null },
      postMessage: (msg) => posted.push(msg),
      importScripts: () => {},
      XLSX: mockXlsx,
      FileReaderSync: function() { this.readAsArrayBuffer = () => new ArrayBuffer(8); },
      console
    };
    sandbox.self.postMessage = sandbox.postMessage;
    vm.runInNewContext(workerCode, sandbox);

    const t0 = Date.now();
    await sandbox.self.onmessage({ data: { type: 'parse', jobId: 7, buffer: new ArrayBuffer(8), fileName: 'attendence sheet sep-26.xlsx' } });
    const elapsed = Date.now() - t0;

    assert.ok(elapsed < 500, 'Bloated 1M-row sheet parsed in ' + elapsed + 'ms (<500ms)');
    const doneMsg = posted.find(m => m.type === 'done');
    assert.ok(doneMsg && doneMsg.dataset, 'Worker posted done dataset');
    assert.equal(doneMsg.dataset.records.length, 1);
    assert.equal(doneMsg.dataset.records[0].cardKey, 'C7', 'C7P credited to Card 07');
    assert.equal(doneMsg.dataset.records[0].qty, 350);
    assert.equal(doneMsg.dataset.records[0].value, 787.5);

    // Also verify main module uses Worker cleanly when available
    const cpSrc = fs.readFileSync(path.join(ROOT, 'atpl-check-production.js'), 'utf8');
    assert.ok(cpSrc.includes("new Worker('check-production-worker-v1.js"), 'Main module spawns Web Worker for uploads');
    assert.ok(cpSrc.includes('sheetToCompactAoa'), 'Main module fallback uses sparse O(populated cells) reader');
  });
});
