const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');

function extractScriptById(id) {
  const marker = `<script id="${id}">`;
  const start = html.indexOf(marker);
  assert(start >= 0, `Script ${id} must exist`);
  const codeStart = start + marker.length;
  const end = html.indexOf('</script>', codeStart);
  assert(end > codeStart, `Script ${id} closing tag must exist`);
  return html.slice(codeStart, end);
}

function makeMockDom(initialValues = {}) {
  const els = {};
  const getEl = (id) => {
    if (!els[id]) {
      els[id] = {
        id,
        value: initialValues[id] != null ? String(initialValues[id]) : '',
        innerHTML: '',
        textContent: '',
        style: {},
        className: '',
        disabled: false,
        checked: false,
        classList: {
          add: () => {},
          remove: () => {},
          toggle: () => {},
          contains: () => false
        }
      };
    }
    return els[id];
  };
  const doc = {
    getElementById: getEl,
    querySelectorAll: () => [],
    createElement: () => ({ style: {}, className: '', textContent: '', innerHTML: '' }),
    head: { appendChild: () => {} },
    body: { classList: { add: () => {}, remove: () => {} } }
  };
  Object.keys(initialValues).forEach(getEl); return { doc, els };
}

test('PaySlip auto-detects MAY-25 (May 2025), exact PF 1500, Working Days & Multi-sheet Combine', () => {
  const { doc, els } = makeMockDom({
    psgMonthSel: '5',
    psgYearInput: '2026',
    psgCompanyInput: 'ARORA TEXTILES PVT.LTD,',
    psgLayoutSel: 'TWIN',
    psgEmpCodeSel: 'ORIGINAL', psgErpFileSelect: ''
  });

  const ctx = {
    document: doc,
    window: null,
    FILES: [
      {
        name: '01-ARORA TEXTILES PVT. LTD. MAY-25 DUGAR JI (1).xls',
        savedAt: '2026-11-20T12:41:33Z',
        sheets: {
          'Total': [
            { 'Department': 'SPINNING', 'Count': 200, 'Net': 2500000 }
          ],
          'STAFF WAGES MAY-25': [
            ['ARORA TEXTILES PVT. LTD. - STAFF SALARY SHEET MAY-25'],
            ['Emp Code', 'Employee Name', 'Designation', 'Month Days', 'Working Days', 'Sun Allow', 'Paid Days', 'Basic', 'HRA', 'Earned Basic', 'Earned HRA', 'Gross Earned', 'P.F. @12%', 'E.S.I. 0.75%', 'Advance', 'Total Ded', 'Net Payable'],
            ['S001', 'RAMESH SHARMA', 'SUPERVISOR', 31, 27, 4, 31, 15000, 3000, 15000, 3000, 18000, 1800, 135, 0, 1935, 16065]
          ],
          'LABOUR WAGES MAY-25': [
            ['ARORA TEXTILES PVT. LTD. - LABOUR WAGES MAY-25'],
            ['Emp Code', 'Employee Name', 'Designation', 'Month Days', 'W.D.', 'W.O.', 'Paid Days', 'Rate Basic', 'Rate HRA', 'Earn Basic', 'Earn HRA', 'Total Earned', 'P.F.', 'E.S.I.', 'Advance', 'Total Deduction', 'Net Payable'],
            ['00101', 'DINESH KUMAR', 'WEAVER', 31, 25, 4, 29, 13350, 2000, 12500, 1871, 14371, 1500, 108, 500, 2108, 12263],
            ['00102', 'SUNIL YADAV', 'HELPER', 31, 22, 4, 26, 11900, 1500, 10000, 1258, 11258, 1200, 85, 0, 1285, 9973]
          ],
          'hdfc bank': [
            { 'Name': 'DINESH KUMAR', 'Bank': 'HDFC', 'Amount': 12263 }
          ],
          'non hdfc bank': [
            { 'Name': 'SUNIL YADAV', 'Bank': 'SBI', 'Amount': 9973 }
          ]
        }
      }
    ],
    indexedDB: null,
    console
  };
  ctx.window = ctx;
  vm.runInNewContext(extractScriptById('atplPaySlipGeneratorScript'), ctx);

  const psg = ctx.ATPLPaySlipGenerator;
  // Verify onErpSelectChange immediately switches June 2026 -> May 2025 on dropdown select
  els.psgErpFileSelect.value = '0';
  psg.onErpSelectChange();
  assert.equal(els.psgMonthSel.value, '4', 'Dropdown select must set month to MAY (4)');
  assert.equal(els.psgYearInput.value, '2025', 'Dropdown select must set year to 2025');

  // Verify loadFromErpSelect picks LABOUR WAGES MAY-25 (not Total or hdfc bank), keeps 2025 & extracts exact PF 1500 & WD 25
  psg.loadFromErpSelect();
  assert.equal(els.psgMonthSel.value, '4');
  assert.equal(els.psgYearInput.value, '2025');
  assert(els.psgFileMeta.textContent.includes('MAY 2025'), 'Meta must display MAY 2025');
  assert(els.psgFileMeta.textContent.includes('LABOUR WAGES MAY-25'), 'Should pick LABOUR WAGES MAY-25 over Total/bank sheets');
  assert(els.psgListTbody.innerHTML.includes('1500'), 'Employee PF 1500 must appear in table');
  assert(els.psgListTbody.innerHTML.includes('25'), 'Working Days 25 must appear in table');

  // Verify Combined All Salary Sheets combines Staff (1) + Labour (2) = 3 employees without bank sheets
  psg.switchWorkbookSheet('__COMBINED__');
  assert(els.psgFileMeta.textContent.includes('3 employees'), 'Combined should load 1 Staff + 2 Labour = 3 employees');

  // Verify dotted + single Basic column + sibling-sheet days enrichment
  const wagesAoa = [
    ['SALARY SHEET MARCH 2025'],
    ['Emp Code', 'Name', 'Basic', 'P.F.', 'Net Payable'],
    ['00501', 'AMIT VERMA', 12500, 1500, 11000]
  ];
  const attAoa = [
    ['ATTENDANCE MARCH 2025'],
    ['Emp Code', 'Name', 'Working Days', 'Weekly Off'],
    ['501', 'AMIT VERMA', 24, 5]
  ];
  const rowsRes = psg._engine.extractRowsFromAoa(wagesAoa, 31);
  assert.equal(rowsRes.rows.length, 1);
  assert.equal(rowsRes.rows[0].pf, 1500, 'P.F. column with dots must extract 1500');
  assert.equal(rowsRes.rows[0].earnBasic, 12500, 'Single Basic column must populate earnBasic');
  psg._engine.enrichRowsFromSiblingSheets(rowsRes.rows, { WAGES: wagesAoa, ATT: attAoa }, 'WAGES', 31);
  assert.equal(rowsRes.rows[0].workingDays, 24, 'Sibling attendance sheet should enrich workingDays=24');
  assert.equal(rowsRes.rows[0].sunAllow, 5, 'Sibling attendance sheet should enrich sunAllow=5');
  assert.equal(rowsRes.rows[0].paidDays, 29, 'Paid days should become 24+5=29');
});

test('MonthlyStatusReport auto-detects Feb-25 (28 days), daily muster 1..28, and derived Weekly Off / Absent', () => {
  const { doc, els } = makeMockDom({
    msrMonthSel: '8',
    msrYearInput: '2026',
    msrCompanyInput: 'ARORA TEXTILES PVT.LTD.',
    msrMaxOtInput: '4',
    msrNightScope: 'DESIGNATION',
    msrBulkScope: 'ALL', msrErpFileSelect: ''
  });

  const ctx = {
    document: doc,
    window: null,
    FILES: [
      {
        name: '01-ARORA TEXTILES PVT. LTD. Feb-25 (3).xls',
        savedAt: '2026-11-20T12:41:38Z',
        sheets: {
          'ATTENDANCE': (() => {
            const hdr = ['Emp ID', 'Name', 'Gender', 'Department', 'Designation'];
            for (let d = 1; d <= 28; d++) hdr.push(String(d));
            const row1 = ['001', 'RAJESH KUMAR', 'M', 'WEAVING', 'WEAVER'];
            // Feb 2025 Sundays are 2, 9, 16, 23 (4 WOs); 2 Absents (10, 11); 22 P
            for (let d = 1; d <= 28; d++) {
              if (d === 2 || d === 9 || d === 16 || d === 23) row1.push('WO');
              else if (d === 10 || d === 11) row1.push('A');
              else row1.push('P');
            }
            return [
              ['ARORA TEXTILES PVT. LTD. - ATTENDANCE FEB-25'],
              hdr,
              row1
            ];
          })(),
          'hdfc bank': [
            { 'Name': 'RAJESH KUMAR', 'Amount': 12000 }
          ]
        }
      }
    ],
    indexedDB: null,
    console
  };
  ctx.window = ctx;
  vm.runInNewContext(extractScriptById('atplMonthlyStatusReportScript'), ctx);

  const msr = ctx.ATPLMonthlyStatusReport;
  els.msrErpFileSelect.value = '0';
  msr.onErpSelectChange();
  assert.equal(els.msrMonthSel.value, '1', 'Dropdown select must set month to FEB (1)');
  assert.equal(els.msrYearInput.value, '2025', 'Dropdown select must set year to 2025');

  msr.loadFromErpSelect();
  assert.equal(els.msrMonthSel.value, '1');
  assert.equal(els.msrYearInput.value, '2025');
  assert(els.msrFileMeta.textContent.includes('FEB 2025'), 'MSR meta must display FEB 2025');
  assert(els.msrCfgTbody.innerHTML.includes('28'), 'Month Days 28 for Feb-25 must render');
  assert(els.msrCfgTbody.innerHTML.includes('22'), 'Working Days 22 from daily muster must render');
  assert(els.msrCfgTbody.innerHTML.includes('4'), 'Weekly Off 4 from daily muster must render');
  assert(els.msrCfgTbody.innerHTML.includes('2'), 'Absent 2 from daily muster must render');
  assert(!els.msrCfgTbody.innerHTML.includes('Mismatch'), 'Feb-25 28 days must have zero calendar/sum mismatch!');

  // Verify sparse sheet without Sun Allow column (Month=31, WD=24, Paid=28 -> auto WO=4, Abs=3)
  const sparseAoa = [
    ['SALARY SHEET MAY-25'],
    ['Emp ID', 'Name', 'Month Days', 'Working Days', 'Paid Days'],
    ['E10', 'MOHAN LAL', 31, 24, 28]
  ];
  const sparseExt = msr._engine.extractRowsFromAoa(sparseAoa, {}, 31);
  assert.equal(sparseExt.rows.length, 1);
  assert.equal(sparseExt.rows[0].workingDays, 24);
  assert.equal(sparseExt.rows[0].sunAllow, 4, 'Should auto-derive Sun Allow/WO = Paid(28) - WD(24) = 4');
  assert.equal(sparseExt.rows[0].absent, 3, 'Should auto-derive Absent = 31 - 28 = 3');
  const sched = msr._engine.generateEmployeeSchedule(sparseExt.rows[0], { month: 4, year: 2025, maxOtPerDay: 4 });
  assert.equal(sched.hasMismatch, false, 'Schedule for MAY 2025 must have zero mismatches');
  assert.equal(sched.counts.p, 24);
  assert.equal(sched.counts.wo, 4);
  assert.equal(sched.counts.a, 3);
});

test("Pay Slip Earning Details Total sums Basic + HRA + Bonus + Over Time (27427, not Basic+HRA subtotal 25875)", () => {
  const { doc, els } = makeMockDom({
    psgMonthSel: "6",
    psgYearInput: "2026",
    psgCompanyInput: "ARORA TEXTILES PVT.LTD,",
    psgLayoutMode: "TWIN",
    psgEmpCodeMode: "ORIGINAL",
    psgErpFileSelect: ""
  });
  const sheetBothCols = [
    ["ARORA TEXTILES PVT. LTD. JULY 2026"],
    ["Employee ID", "Name of employee", "Department", "Month Of Days", "Paid Days", "Basic", "HRA", "Gross Total Salary", "Earn Basic", "Earn HRA", "Gross Earned Salary", "Earned Bonus 8.33%", "Earned OverTime Amount", "Total Gross salary", "PF@12%", "ESIC @0.75%", "Advance", "Total Deduction", "Net Payable"],
    ["00135", "SAMPAT LAL", "PRODUCTION", 31, 29, 19915, 7745, 27660, 18630, 7245, 25875, 1552, 0, 27427, 1800, 140, 0, 1940, 25487]
  ];
  const sheetOnlySubtotalCol = [
    ["ARORA TEXTILES PVT. LTD. JULY 2026"],
    ["Employee ID", "Name of employee", "Department", "Month Of Days", "Paid Days", "Basic", "HRA", "Gross Total Salary", "Earn Basic", "Earn HRA", "Gross Earned Salary", "Earned Bonus 8.33%", "Earned OverTime Amount", "PF@12%", "ESIC @0.75%", "Advance", "Total Deduction", "Net Payable"],
    ["00135", "SAMPAT LAL", "PRODUCTION", 31, 29, 19915, 7745, 27660, 18630, 7245, 25875, 1552, 0, 1800, 140, 0, 1940, 25487]
  ];
  const ctx = {
    document: doc,
    window: null,
    FILES: [
      { name: "July_2026_Salary.xlsx", sheets: { "Main Sheet": sheetBothCols, "Subtotal Only": sheetOnlySubtotalCol } }
    ],
    indexedDB: null,
    console
  };
  ctx.window = ctx;
  vm.runInNewContext(extractScriptById("atplPaySlipGeneratorScript"), ctx);
  const psg = ctx.ATPLPaySlipGenerator;
  els.psgErpFileSelect.value = "0";
  psg.loadFromErpSelect();

  assert.ok(els.psgPreviewContainer.innerHTML.includes("27427"), "Pay Slip preview Earning Total must be 27427 (18630+7245+1552+0)");
  assert.ok(!els.psgPreviewContainer.innerHTML.includes(">25875<"), "Pay Slip preview must NOT show Basic+HRA subtotal 25875");
  assert.ok(els.psgListTbody.innerHTML.includes("27427"), "List table Earning Total must be 27427");

  // Also test sheet that only has Gross Earned Salary (25875) without Total Gross salary column
  psg.switchWorkbookSheet("Subtotal Only");
  assert.ok(els.psgPreviewContainer.innerHTML.includes("27427"), "Even when sheet only has Gross Earned Salary subtotal 25875, Pay Slip Total must sum Basic+HRA+Bonus+OT = 27427");
  assert.ok(!els.psgPreviewContainer.innerHTML.includes(">25875<"), "Subtotal 25875 must never replace 27427 in Pay Slip preview");
});
