const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('Service History Module - PF No, ESIC No, Monthly Deductions & UI Upgrade', async (t) => {
  const rootDir = path.resolve(__dirname, '..');
  const shCode = fs.readFileSync(path.join(rootDir, 'service-history-v1.js'), 'utf8');

  function makeDomCtx(masterList, filesList) {
    const ids = {};
    const headChildren = [];
    const navChildren = [];
    const containerChildren = [];

    function makeNode(tag, id) {
      return {
        tagName: tag,
        id: id || '',
        className: '',
        innerHTML: '',
        textContent: '',
        value: '',
        style: {},
        children: [],
        appendChild(el) {
          this.children.push(el);
          if (el.id) ids[el.id] = el;
          if (el.innerHTML && el.innerHTML.includes('atpl-sh-results')) {
            for (const nestedId of ['atpl-sh-code', 'atpl-sh-search', 'atpl-sh-notice', 'atpl-sh-results', 'atpl-sh-suggest', 'atpl-sh-back']) {
              ids[nestedId] = makeNode('div', nestedId);
            }
          }
          return el;
        },
        querySelector() { return null; },
        querySelectorAll() { return []; },
        getAttribute() { return null; }
      };
    }

    const pageSync = makeNode('div', 'page-sync');
    const parentBox = {
      appendChild(el) {
        containerChildren.push(el);
        if (el.id) ids[el.id] = el;
        if (el.innerHTML && el.innerHTML.includes('atpl-sh-results')) {
          for (const nestedId of ['atpl-sh-code', 'atpl-sh-search', 'atpl-sh-notice', 'atpl-sh-results', 'atpl-sh-suggest', 'atpl-sh-back']) {
            ids[nestedId] = makeNode('div', nestedId);
          }
        }
      }
    };
    pageSync.parentNode = parentBox;
    ids['page-sync'] = pageSync;

    const vnEmp = makeNode('div', 'vn-empmaster');
    vnEmp.parentNode = {
      appendChild(el) {
        navChildren.push(el);
        if (el.id) ids[el.id] = el;
      }
    };
    ids['vn-empmaster'] = vnEmp;

    const mockWindow = {
      localStorage: { getItem: () => null, setItem: () => {} },
      sessionStorage: { getItem: () => null },
      document: {
        readyState: 'complete',
        head: { appendChild: (el) => { headChildren.push(el); if (el.id) ids[el.id] = el; } },
        body: { appendChild: () => {} },
        createElement: (tag) => makeNode(tag, ''),
        getElementById: (id) => ids[id] || null,
        querySelector: () => null,
        addEventListener: () => {}
      },
      EM: { data: masterList || [] },
      FILES: filesList || [],
      goPage: () => {},
      showToast: () => {}
    };
    mockWindow.window = mockWindow;
    return { mockWindow, ids, headChildren, navChildren };
  }

  await t.test('1. Extracts PF No & ESIC No from Employee Master and PF@12% / ESIC@0.75% across 2025 + 2026 sheets', () => {
    const master = [
      {
        emp_id: '25924',
        name: 'Ram Kumar Sharma',
        father: 'Mohan Lal',
        dept: 'Spinning',
        desig: 'Senior Operator',
        doj: '2023-04-01',
        pf_no: '101456789012',
        esi_no: '3112345678',
        gross: 24000,
        basic: 15000
      }
    ];
    const files = [
      {
        name: 'Salary_Jun_2025.xlsx',
        sheets: {
          'Fourmala Sheet': [
            ['Emp Code', 'Employee Name', 'Gross', 'Basic', 'PF@12%', 'ESIC @0.75%', 'Manual Amount', 'Net Payable'],
            ['25924', 'Ram Kumar Sharma', '22000', '14000', '1680', '165', '20155', '20155']
          ]
        }
      },
      {
        name: 'Final Salary March 2026.xlsx',
        sheets: {
          'Formula Sheet': [
            ['Emp Code', 'Employee Name', 'Gross Salary', 'Basic Salary', 'Employee PF', 'Employee ESIC', 'Manual Amount', 'Net Payable'],
            ['25924', 'Ram Kumar Sharma', '24000', '15000', '1800', '180', '22020', '22020']
          ]
        }
      }
    ];

    const { mockWindow, ids } = makeDomCtx(master, files);
    const ctx = vm.createContext(mockWindow);
    vm.runInContext(shCode, ctx);

    const res = mockWindow.ATPLServiceHistoryV1.scan('25924');
    assert.equal(res.profile.name, 'Ram Kumar Sharma');
    assert.equal(res.profile.pfNo, '101456789012');
    assert.equal(res.profile.esicNo, '3112345678');
    assert.equal(res.profile.pfNoSource, 'Employee Master');
    assert.equal(res.profile.esicNoSource, 'Employee Master');
    assert.equal(res.totals.monthsFound, 2);
    assert.equal(res.totals.pfTotal, 3480);
    assert.equal(res.totals.pfMonths, 2);
    assert.equal(res.totals.esicTotal, 345);
    assert.equal(res.totals.esicMonths, 2);
    assert.equal(res.totals.manualTotal, 42175);

    // Search via Employee Name triggers UI render with PF No, ESIC No & totals
    ids['atpl-sh-code'].value = 'Ram Kumar Sharma';
    ids['atpl-sh-search'].onclick();
    const html = ids['atpl-sh-results'].innerHTML;
    assert(html.includes('101456789012'), 'Rendered UI must display PF / UAN Number');
    assert(html.includes('3112345678'), 'Rendered UI must display ESIC / IP Number');
    assert(html.includes('3,480'), 'Rendered UI must display Total PF Deducted');
    assert(html.includes('345'), 'Rendered UI must display Total ESIC Deducted');
    assert(html.includes('June 2025'), 'Rendered UI must include 2025 historical salary month');
    assert(html.includes('March 2026'), 'Rendered UI must include 2026 salary month');
  });

  await t.test('2. Falls back to Salary Sheet PF No / ESIC No if Employee Master has blank statutory IDs', () => {
    const files = [
      {
        name: 'Salary_Feb_2026.xlsx',
        sheets: {
          'Main Sheet': [
            ['Emp Code', 'Employee Name', 'PF No', 'ESIC No', 'EPF 12%', 'ESI 0.75%', 'Manual Amount', 'Net Pay'],
            ['901', 'Suresh Singh', '101999888777', '3198765432', '1440', '135', '16425', '16425']
          ]
        }
      }
    ];
    const { mockWindow } = makeDomCtx([], files);
    const ctx = vm.createContext(mockWindow);
    vm.runInContext(shCode, ctx);

    const res = mockWindow.ATPLServiceHistoryV1.scan('901');
    assert.equal(res.profile.name, 'Suresh Singh');
    assert.equal(res.profile.pfNo, '101999888777');
    assert.equal(res.profile.esicNo, '3198765432');
    assert.equal(res.profile.pfNoSource, 'Salary Sheet');
    assert.equal(res.profile.esicNoSource, 'Salary Sheet');
    assert.equal(res.totals.pfTotal, 1440);
    assert.equal(res.totals.esicTotal, 135);
  });
  await t.test('3. Reads flexible filenames (2-digit year, spaces), ATPLCentralFileSync.fileMap, merged 2-row headers, multi-tab PF/ESIC consolidation & leading-zero IDs (Sampat Lal)', () => {
    const master = [
      {
        emp_id: '00135',
        name: 'SAMPAT LAL',
        father: 'SOHAN LAL',
        dept: 'PRODUCTION',
        desig: 'PRODUCTION',
        pf_no: '100330064649',
        esi_no: '2706516566',
        gross: 27660,
        basic: 19915
      }
    ];
    const files = [
      // Flexible filename with words between month and year + multi-tab where Fourmala Sheet has Gross/Manual and PF ESIC sheet has deductions
      {
        name: 'Final March Salary 2026.xlsx',
        sheets: {
          'Fourmala Sheet': [
            ['Emp Code', 'Employee Name', 'Gross', 'Manual Amount', 'Net Payable'],
            ['135', 'SAMPAT  LAL', '27660', '25652', '25652']
          ],
          'Compliance PF Sheet': [
            ['', '', 'Statutory Deductions', ''],
            ['S.No', 'Employee Name', 'PF @ 12%', 'ESIC @0.75%'],
            ['1', 'SAMPAT LAL', '-1800', '-208']
          ]
        }
      },
      // 2-digit year filename (Apr-25) with 2-row merged header & ATPL/135 code format
      {
        name: 'Salary_Apr-25.xlsx',
        sheets: {
          'Sheet1': [
            ['', '', '', 'Deductions', ''],
            ['Emp ID', 'Name of employee', 'Total Gross salary', 'PF', 'ESIC'],
            ['ATPL/00135', 'SAMPAT LAL', '27660', '1800', '208']
          ]
        }
      }
    ];

    const { mockWindow } = makeDomCtx(master, []);
    // Simulate Google Drive / UnifiedSyncEngine storing files only in ATPLCentralFileSync.fileMap
    mockWindow.ATPLCentralFileSync = {
      fileMap: new Map(files.map((f) => [f.name, f]))
    };
    const ctx = vm.createContext(mockWindow);
    vm.runInContext(shCode, ctx);

    const res = mockWindow.ATPLServiceHistoryV1.scan('Sampat  Lal');
    assert.equal(res.employeeCode, '00135');
    assert.equal(res.profile.pfNo, '100330064649');
    assert.equal(res.profile.esicNo, '2706516566');
    assert.equal(res.totals.monthsFound, 2);
    assert.equal(res.totals.pfTotal, 3600);
    assert.equal(res.totals.pfMonths, 2);
    assert.equal(res.totals.esicTotal, 416);
    assert.equal(res.totals.esicMonths, 2);
    assert.equal(res.totals.grossTotal, 55320);
  });

  await t.test('4. Caches decoded workbook sheets so repeat searches avoid XLSX.sheet_to_json, and invalidates when wb changes', () => {
    let sheetToJsonCalls = 0;
    const rowsA = [
      ['Emp Code', 'Employee Name', 'Gross Salary', 'PF @ 12%', 'ESIC @0.75%', 'Manual Amount', 'Net Payable'],
      ['101', 'Ramesh Kumar', '18000', '1440', '135', '16425', '16425'],
      ['102', 'Mahesh Verma', '20000', '1600', '150', '18250', '18250']
    ];
    const rowsB = [
      ['Emp Code', 'Employee Name', 'Gross Salary', 'PF @ 12%', 'ESIC @0.75%', 'Manual Amount', 'Net Payable'],
      ['101', 'Ramesh Kumar', '19000', '1500', '143', '17357', '17357']
    ];
    const wb1 = { SheetNames: ['Formula Sheet'], Sheets: { 'Formula Sheet': { tag: 'v1' } } };
    const wb2 = { SheetNames: ['Formula Sheet'], Sheets: { 'Formula Sheet': { tag: 'v2' } } };
    const files = [{ name: 'Salary_Jan_2026.xlsx', wb: wb1 }];

    const { mockWindow } = makeDomCtx([], files);
    mockWindow.XLSX = {
      utils: {
        sheet_to_json(ws) {
          sheetToJsonCalls++;
          return ws.tag === 'v2' ? rowsB : rowsA;
        }
      }
    };
    const ctx = vm.createContext(mockWindow);
    vm.runInContext(shCode, ctx);

    const r1 = mockWindow.ATPLServiceHistoryV1.scan('101');
    assert.equal(r1.totals.pfTotal, 1440);
    assert.equal(sheetToJsonCalls, 1, 'First scan decodes workbook once');

    // Search a DIFFERENT employee on the same workbook — must use cached index (0 extra sheet_to_json calls)
    const r2 = mockWindow.ATPLServiceHistoryV1.scan('102');
    assert.equal(r2.totals.pfTotal, 1600);
    assert.equal(r2.profile.name, 'Mahesh Verma');
    assert.equal(sheetToJsonCalls, 1, 'Second scan must reuse cached index without calling sheet_to_json');

    // Mutate wb reference (e.g. file re-uploaded) — cache must invalidate cleanly
    files[0].wb = wb2;
    const r3 = mockWindow.ATPLServiceHistoryV1.scan('101');
    assert.equal(r3.totals.pfTotal, 1500);
    assert.equal(sheetToJsonCalls, 2, 'Replacing wb must invalidate cache and re-read updated sheet');
  });

  await t.test('5. scanAsync & UI search yield cleanly across chunks, report progress, match sync output, and cancel stale searches', async () => {
    const files = [
      {
        name: 'Salary_Jan_2026.xlsx',
        sheets: {
          'Formula Sheet': [
            ['Emp Code', 'Employee Name', 'Gross', 'PF', 'ESIC', 'Manual Amount', 'Net Payable'],
            ['501', 'Vikas Sharma', '20000', '1800', '150', '18050', '18050'],
            ['502', 'Anita Devi', '15000', '1200', '113', '13687', '13687']
          ]
        }
      },
      {
        name: 'Salary_Feb_2026.xlsx',
        sheets: {
          'Formula Sheet': [
            ['Emp Code', 'Employee Name', 'Gross', 'PF', 'ESIC', 'Manual Amount', 'Net Payable'],
            ['501', 'Vikas Sharma', '20000', '1800', '150', '18050', '18050'],
            ['502', 'Anita Devi', '15000', '1200', '113', '13687', '13687']
          ]
        }
      }
    ];

    const { mockWindow, ids } = makeDomCtx([], files);
    mockWindow.setTimeout = setTimeout;
    mockWindow.clearTimeout = clearTimeout;
    const ctx = vm.createContext(mockWindow);
    vm.runInContext(shCode, ctx);

    const progressEvents = [];
    const asyncRes = await mockWindow.ATPLServiceHistoryV1.scanAsync('501', {
      deferStart: true,
      yieldPerUncachedFile: true,
      onProgress: (p) => progressEvents.push(p)
    });
    const syncRes = mockWindow.ATPLServiceHistoryV1.scan('501');
    assert.deepEqual(asyncRes.totals, syncRes.totals);
    assert.equal(asyncRes.totals.pfTotal, 3600);
    assert.equal(progressEvents.length, 1);

    // Test UI click with fresh uncached file: immediate scanning banner + stale search cancellation
    const freshFiles = [
      {
        name: 'Salary_Mar_2026.xlsx',
        sheets: {
          'Formula Sheet': [
            ['Emp Code', 'Employee Name', 'Gross', 'PF', 'ESIC', 'Manual Amount', 'Net Payable'],
            ['501', 'Vikas Sharma', '21000', '1800', '158', '19042', '19042'],
            ['502', 'Anita Devi', '16000', '1200', '120', '14680', '14680']
          ]
        }
      }
    ];
    mockWindow.FILES = freshFiles;
    ids['atpl-sh-code'].value = '501';
    ids['atpl-sh-search'].onclick();
    assert(ids['atpl-sh-results'].innerHTML.includes('Scanning Salary Workbooks'), 'UI must immediately show non-blocking scanning state');

    // Immediately supersede with search for 502 — final UI must show Anita Devi, never overwritten by stale 501 scan
    ids['atpl-sh-code'].value = '502';
    ids['atpl-sh-search'].onclick();
    await new Promise((r) => setTimeout(r, 40));
    assert(ids['atpl-sh-results'].innerHTML.includes('Anita Devi'), 'Latest search must win after async completion');
    assert(!ids['atpl-sh-results'].innerHTML.includes('Vikas Sharma'), 'Cancelled search must not overwrite results');
  });

  await t.test('6. Regression: handles duplicate copy suffixes, ignores Chart/8.33%/DOJ fake dates, filters utility/attendance sheets, reads PFAmt/Earned Salary aliases & multi-section sub-headers', () => {
    const master = [
      { emp_id: '00387', name: 'SURENDRA KUMAR', father: 'UDMI RAM', doj: '2010-04-01', pf_no: '100372880934', gross: 34100 }
    ];
    const files = [
      // Duplicate suffix (2) on Dec 2025 -> must map to 2025-12, NOT 2025-02
      {
        name: 'final salary sheet dec 2025 (2).xls',
        sheets: {
          'Fourmala Sheet': [
            ['Emp ID', 'Name of employee', 'Total Gross salary', 'Manual Amount', 'PF@12%', 'ESIC @0.75%', 'Net Payable'],
            ['00387', 'SURENDRA KUMAR', '34100', '34100', '1800', '0', '32300']
          ]
        }
      },
      // 2024 split tabs with PFAmt / ESIAmt + Manisha Mam column
      {
        name: 'final salary sheet nov 2024 atpl.xlsx',
        sheets: {
          'Manisha Mam': [
            ['Code', 'Name', 'Manisha Mam'],
            ['387', 'Surendra Kumar', '34100']
          ],
          'Sheet1': [
            ['EmpCode', 'EmpName', 'Total Earned Salary', 'PFAmt', 'ESIAmt', 'Net Payable Amount'],
            ['00387', 'SURENDRA KUMAR', '34100', '1800', '0', '32300']
          ]
        }
      },
      // Chart1 numeric numbers (9, 21) must NOT create 2021-09; Main Sheet title "June-26" resolves 2026-06
      {
        name: 'june salary lokesh ji.xlsx',
        sheets: {
          'Chart1': [['Summary'], [25247, 9, 21, 500]],
          'Main Sheet': [
            ['Salary Sheet Month of June-26'],
            ['S.No.', 'Employee ID', 'Name of employee', 'D-O-J', 'Total Gross salary', 'Manual Amount', 'PF@12%', 'Net Payable'],
            [1, '00387', 'SURENDRA KUMAR', '01/04/2002', 34100, 34100, 1800, 32300]
          ]
        }
      },
      // Header containing "Earned Bonus 8.33%" must NOT become 2033-08; month-only "sep" infers 2026 from savedAt
      {
        name: 'revised sent atpl-sep.xlsx',
        savedAt: '2026-10-26T10:00:00.000Z',
        sheets: {
          'Main Sheet': [
            ['S.No.', 'Employee ID', 'Name of employee', 'Earned Bonus 8.33%', 'Total Gross salary', 'Manual Amount', 'PF@12%', 'Net Payable'],
            [1, '00387', 'SURENDRA KUMAR', 1543, 34090, 34100, 2223, 31867]
          ]
        }
      },
      // Embedded section sub-header with shifted columns (april-25 worker -> staff section)
      {
        name: 'salary sheet april-25 (1).xlsx',
        sheets: {
          'Sheet1': [
            ['Code', 'Card No. 1', 'Days', 'Salry', 'Total', 'Adv', 'Total amot'],
            ['25492', 'Gulab Chand', 44, 16500, 24200, '', 24200],
            ['Code', 'Staff Name', 'Post', 'Rate', 'Days', 'Total', 'PF', 'Adv.', 'Total Amount'],
            ['387', 'Surendra kumar', 'Blend Master', 34100, 30, 34100, 'PF', '', 34100]
          ]
        }
      },
      // Embedded section sub-header inheriting parent "Total" column when blank (aug-26 new)
      {
        name: 'salary sheet aug-26 new (1).xlsx',
        sheets: {
          'Sheet1': [
            ['Code', 'Card No. 1', 'Total'],
            ['25114', 'Sukumar Barman', 22298],
            ['Code', 'Staff Name', ''],
            ['00387', 'Surendra kumar', 34100]
          ]
        }
      },
      // Non-salary utility & attendance sheets must be excluded cleanly
      {
        name: 'atpl_machine_rate_audit.xlsx',
        savedAt: '2026-10-15T00:00:00.000Z',
        sheets: { 'REVIEW ROWS': [['A', 'B'], [1, 2]] }
      },
      {
        name: 'offline_reconcile_file.xlsx',
        sheets: { 'Sheet1': [['A', 'B'], [1, 2]] }
      },
      {
        name: 'attendence sheet oct-26.xlsx',
        sheets: {
          'office dep.': [
            ['Code', 'Staff Name', 'Rate', 'Days', 'Total', 'Total Amount'],
            ['387', 'Surendra kumar', 34100, '', 0, 0]
          ]
        }
      }
    ];

    const { mockWindow } = makeDomCtx(master, files);
    const ctx = vm.createContext(mockWindow);
    vm.runInContext(shCode, ctx);

    const res = mockWindow.ATPLServiceHistoryV1.scan('00387');
    const byPeriod = {};
    for (const m of res.months) {
      if (m.status !== 'SALARY FILE UNAVAILABLE') byPeriod[m.period] = m;
    }

    assert(!byPeriod['2021-09'], 'Must not misclassify Chart1 numbers as Sep 2021');
    assert(!byPeriod['2033-08'], 'Must not misclassify 8.33% as Aug 2033');
    assert(!byPeriod['2025-02'], 'Duplicate suffix (2) on Dec 2025 must not map to Feb 2025');
    assert(!byPeriod['UNDATED'], 'Utility reconcile file must be filtered');
    assert(!byPeriod['2026-10'], 'Attendance/audit files without salary must be filtered');

    assert.equal(byPeriod['2024-11'].records[0].values.pf, 1800);
    assert.equal(byPeriod['2024-11'].records[0].values.manual, 34100);
    assert.equal(byPeriod['2024-11'].records[0].values.gross, 34100);
    assert.equal(byPeriod['2025-04'].records[0].values.manual, 34100);
    assert.equal(byPeriod['2025-12'].records[0].values.pf, 1800);
    assert.equal(byPeriod['2026-06'].records[0].values.pf, 1800);
    assert.equal(byPeriod['2026-08'].status, 'RECORD FOUND');
    assert.equal(byPeriod['2026-08'].records[0].values.gross, 34100);
    assert.equal(byPeriod['2026-09'].records[0].values.pf, 2223);
    assert.equal(res.totals.monthsFound, 6);
    assert.equal(res.totals.pfMonths, 4);
    assert.equal(res.totals.pfTotal, 7623);
  });
});
