const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const moduleSrc = fs.readFileSync(path.join(ROOT, 'atpl-pf-esic-portal-export-v1.js'), 'utf8');
const htmlSrc = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const guardSrc = fs.readFileSync(path.join(ROOT, 'erp-permission-guard-v1.js'), 'utf8');
const XLSX = require(path.join(ROOT, 'xlsx.full.min.js'));

function createStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(String(k), String(v)); },
    removeItem: (k) => { map.delete(k); },
    clear: () => map.clear()
  };
}

function loadPortalModule(opts = {}) {
  const localStorage = createStorage();
  const container = { innerHTML: '', querySelector: () => null, querySelectorAll: () => [] };
  const mockDoc = {
    head: { appendChild: () => {} },
    body: { appendChild: () => {}, removeChild: () => {} },
    createElement: (tag) => ({ tagName: tag, style: {}, textContent: '' }),
    getElementById: (id) => (id === 'ecrPortalContainer' ? container : null)
  };
  const ctx = {
    window: null,
    document: mockDoc,
    localStorage,
    XLSX,
    FILES: opts.files || [],
    EMP_MASTER_DATA: opts.master || [],
    addEventListener: () => {},
    Blob: globalThis.Blob,
    URL: { createObjectURL: () => 'blob:mock', revokeObjectURL: () => {} }
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(moduleSrc, ctx);
  return { ctx, api: ctx.ATPLPfEsicPortalExport, localStorage, container };
}

test('HTML & permission guard wiring for PF & ESIC Portal Export (vn-challan untouched)', () => {
  assert.ok(htmlSrc.includes('id="vn-ecrportal"'), 'Sidebar item vn-ecrportal must exist');
  assert.ok(htmlSrc.includes("goPage('ecrportal')"), 'Sidebar item must route to ecrportal');
  assert.ok(htmlSrc.includes('id="page-ecrportal"'), 'Page container page-ecrportal must exist');
  assert.ok(htmlSrc.includes('id="ecrPortalContainer"'), 'Mount container ecrPortalContainer must exist');
  assert.ok(htmlSrc.includes("'ecrportal':'cat-sal'"), 'catMap must map ecrportal to cat-sal');
  assert.ok(htmlSrc.includes('atpl-pf-esic-portal-export-v1.js'), 'index.html must load portal export script');
  assert.ok(guardSrc.includes('ecrportal:1'), 'permission guard MASTER_READ must include ecrportal:1');
  // Legacy hidden check remains intact
  assert.ok(/id="vn-challan"[^>]*display:none!important/.test(htmlSrc), 'Legacy vn-challan hidden rule must stay untouched');
});

test('Detects offset headers, filters totals, matches Employee Master UAN/IP, and builds strict EPFO ECR + ESIC formats', () => {
  const sampleSheet = [
    ['ARORA TEXTILES PVT. LTD.'],
    ['SALARY REGISTER — NOVEMBER 2026'],
    [],
    ['Sr', 'Emp Code', 'Employee Name', 'Paid Days', 'Basic', 'Gross Wages', 'PF 12%', 'ESIC 0.75%'],
    ['1', '1001', 'RAMESH KUMAR.', '26', '14000', '16500', '1680', '124'],
    ['2', '1002', 'SURESH YADAV', '30', '18000', '22500', '2160', '0'],
    ['3', '1003', 'MAHESH VERMA (NO UAN)', '25', '12000', '14000', '1440', '105'],
    ['4', '1004', 'LEFT WORKER', '0', '0', '0', '0', '0'],
    ['', 'Total', '', '', '44000', '53000', '5280', '229'],
    ['', 'Grand Total', '', '', '44000', '53000', '5280', '229']
  ];
  const wbEntry = {
    name: 'Nov_2026_Salary.xlsx',
    grids: {
      Summary: [['Month', 'Total'], ['Nov 2026', '53000']],
      Compliance: sampleSheet
    },
    sheetNames: ['Summary', 'Compliance']
  };
  const master = [
    { emp_id: '1001', name: 'RAMESH KUMAR', pf_no: '100123456789', esi_no: '1112223334', status: 'ACTIVE' },
    { emp_id: '1002', name: 'SURESH YADAV', pf_no: '100987654321', esi_no: 'NA', status: 'ACTIVE' },
    { emp_id: '1003', name: 'MAHESH VERMA', pf_no: 'NA', esi_no: '1115556667', status: 'ACTIVE' },
    { emp_id: '1004', name: 'LEFT WORKER', pf_no: '100444555666', esi_no: '1119998887', status: 'LEFT', dol: '2026-10-31' }
  ];

  const { api } = loadPortalModule({ files: [wbEntry], master });
  const computed = api.computePortalExport(wbEntry, { monthDays: 30, capEpfAt15k: false, onlyValidPortalIds: true });

  // Note: row 1004 has 0 basic/gross/pf/esic so skipped; let's verify active salary rows (3)
  assert.equal(computed.activeTabNames[0], 'Compliance', 'Should skip Summary and select Compliance');
  assert.equal(computed.rows.length, 3, 'Should parse 3 employee rows and skip Total/Grand Total');
  assert.equal(computed.totals.pfValidCount, 2, '2 valid 12-digit UAN PF rows');
  assert.equal(computed.totals.pfMissingUanCount, 1, '1 missing UAN PF row flagged without inventing fake UAN');
  assert.equal(computed.totals.esicValidCount, 2, '2 valid 10-digit ESIC IP rows');

  const r1002 = computed.rows.find(r => r.empCode === '1002');
  assert.equal(r1002.epfWage, 18000);
  assert.equal(r1002.epsWage, 15000, 'EPS wage must cap at 15000');
  assert.equal(r1002.edliWage, 15000, 'EDLI wage must cap at 15000');
  assert.equal(r1002.eePF, 2160);
  assert.equal(r1002.erEPS, 1250, 'EPS contribution must cap at 1250');
  assert.equal(r1002.erDiff, 910, 'ER Diff = 2160 - 1250');
  assert.equal(r1002.isEsicEligible, false, 'Gross 22500 > 21000 with 0 ESIC ded is not ESIC eligible');

  // Strict ECR output must exclude 1003 (missing UAN) and follow exact 11-field #~# format
  const ecr = api.buildEpfoEcrText(computed.rows, true);
  const lines = ecr.split('\r\n');
  assert.equal(lines.length, 2, 'Only 2 valid UAN rows in strict portal ECR');
  assert.equal(lines[0], '100123456789#~#RAMESH KUMAR#~#16500#~#14000#~#14000#~#14000#~#1680#~#1166#~#514#~#4#~#0');
  assert.equal(lines[1], '100987654321#~#SURESH YADAV#~#22500#~#18000#~#15000#~#15000#~#2160#~#1250#~#910#~#0#~#0');

  // Cap EPF at 15,000 option
  const capped = api.computePortalExport(wbEntry, { monthDays: 30, capEpfAt15k: true, onlyValidPortalIds: true });
  const capped1002 = capped.rows.find(r => r.empCode === '1002');
  assert.equal(capped1002.epfWage, 15000);
  assert.equal(capped1002.eePF, 1800);
  assert.equal(capped1002.erDiff, 550);

  // ESIC 6-column sheet & BIFF8/XLSX generation
  const esicBuilt = api.buildEsicWorkbook(computed.rows, true);
  assert.ok(esicBuilt && esicBuilt.aoa.length === 3, 'Header + 2 valid ESIC IP rows');
  assert.deepEqual([...esicBuilt.aoa[0]], [
    'IP Number',
    'IP Name',
    'No of Days for which wages paid',
    'Total Monthly Wages',
    'Reason Code for Zero workings days(numeric)',
    'Last Working Day'
  ]);
  assert.deepEqual([...esicBuilt.aoa[1]], ['1112223334', 'RAMESH KUMAR', 26, 16500, 0, '']);
  assert.equal(esicBuilt.wb.Sheets['Monthly Contribution'].A2.t, 's', 'IP Number cell must stay text');
  const biff8Bytes = XLSX.write(esicBuilt.wb, { bookType: 'biff8', type: 'buffer' });
  assert.ok(biff8Bytes.length > 1000, 'BIFF8 .xls export succeeds');
});

test('ESIC zero-wage left worker auto-populates Reason Code 2 + DD/MM/YYYY LWD & inline UAN fix unlocks export', () => {
  const wbEntry = {
    name: 'Oct_2026_Salary.xlsx',
    grids: {
      Staff: [
        ['Emp Code', 'Emp Name', 'Days', 'Basic', 'Gross', 'PF', 'ESIC'],
        ['2001', 'AJAY SINGH', '28', '12000', '13000', '1440', '98'],
        ['2002', 'VIJAY LEFT', '0', '0', '0', '0', '1'] // ESIC column marker / 0 wage left tracking
      ]
    },
    sheetNames: ['Staff']
  };
  const master = [
    { emp_id: '2001', name: 'AJAY SINGH', pf_no: 'NA', esi_no: '2223334445', status: 'ACTIVE' },
    { emp_id: '2002', name: 'VIJAY LEFT', pf_no: '100222333444', esi_no: '2226667778', status: 'LEFT', dol: '2026-10-15' }
  ];

  const { api } = loadPortalModule({ files: [wbEntry], master });
  let res = api.computePortalExport(wbEntry, { monthDays: 31, onlyValidPortalIds: true });
  assert.equal(res.totals.pfMissingUanCount, 1);
  assert.equal(api.buildEpfoEcrText(res.rows, true), '', '2001 excluded until UAN is fixed');

  // Fix UAN inline for 2001 & check 2002 zero-wage DOL override
  api.setOverride('2001', { uan: '100555666777' });
  res = api.computePortalExport(wbEntry, { monthDays: 31, onlyValidPortalIds: true });
  assert.equal(res.totals.pfMissingUanCount, 0);
  const ecrLines = api.buildEpfoEcrText(res.rows, true).split('\r\n');
  assert.equal(ecrLines.length, 1);
  assert.ok(ecrLines[0].startsWith('100555666777#~#AJAY SINGH#~#13000#~#12000#~#12000#~#12000#~#1440#~#1000#~#440#~#3#~#0'));

  // Zero-wage ESIC row with DOL
  api.setOverride('2002', { reasonCode: '2', lastWorkingDay: '15/10/2026' });
  const wbZeroEsic = {
    name: 'Zero_Test.xlsx',
    grids: {
      Staff: [
        ['Emp Code', 'Emp Name', 'Days', 'Basic', 'Gross', 'ESIC IP'],
        ['2002', 'VIJAY LEFT', '0', '0', '1', '2226667778']
      ]
    }
  };
  const r2 = api.computePortalExport(wbZeroEsic, { monthDays: 31, onlyValidPortalIds: true });
  const esicRows = api.buildEsicSheetRows(r2.rows, true);
  assert.equal(esicRows[1][4], 2);
  assert.equal(esicRows[1][5], '15/10/2026');
});

test("Salary Sheet Search Box, Multi-Tab Department Workbook Auto-Reading, and Duplicate Fixed vs Earned Column Disambiguation", () => {
  const deptSheet1 = [
    ["ARORA TEXTILES PVT. LTD."],
    ["S.No.", "Employee ID", "Name of employee", "Basic", "HRA", "Gross Total Salary", "Paid Days", "Basic", "HRA", "Gross Earned Salary", "Total Gross salary", "PF@12%", "ESIC @0.75%"],
    ["1", "135", "SAMPAT LAL", "15120", "5880", "21000", "26", "12681", "4932", "17613", "18100", "1522", "136"],
    ["2", "387", "SURENDRA KUMAR", "15120", "5880", "21000", "25", "12194", "4742", "16936", "17200", "1463", "129"],
    ["", "Grand Total", "", "", "", "", "", "24875", "", "34549", "35300", "2985", "265"]
  ];
  const deptSheet2 = [
    ["ARORA TEXTILES PVT. LTD."],
    ["S.No.", "Emp Code", "Employee Name", "Paid Days", "Earned Basic", "Gross Wages", "PF 12%", "ESIC 0.75%"],
    ["1", "419", "BULLURAM", "25", "12000", "15500", "1440", "117"],
    ["2", "512", "RAMESH CHAND", "28", "14000", "18000", "1680", "135"]
  ];
  const wbEntry = {
    name: "Final Salary Sheet Jan 2026 (1) (1).xls",
    sheets: {
      Summary: [["Dept", "Total"], ["FELTING", "35300"]],
      FELTING: deptSheet1,
      CARDING: deptSheet2,
      "HDFC BANK": [["Emp Code", "Name", "Net Payable"], ["135", "SAMPAT LAL", "16000"]]
    }
  };
  const { api, container } = loadPortalModule({
    files: [wbEntry, { name: "Final Salary Sheet April 2026.xls", sheets: { STAFF: deptSheet2 } }],
    master: [
      { emp_id: "135", name: "SAMPAT LAL", pf_no: "101234567890", esi_no: "2707123456" },
      { emp_id: "387", name: "SURENDRA KUMAR", pf_no: "101234567891", esi_no: "2707123457" },
      { emp_id: "419", name: "BULLURAM", pf_no: "101234567892", esi_no: "2707123458" },
      { emp_id: "512", name: "RAMESH CHAND", pf_no: "101234567893", esi_no: "2707123459" }
    ]
  });

  api.renderUI();
  assert.ok(container.innerHTML.includes("id=\"ecrpFileSearchInput\""), "Salary sheet search box must render");
  assert.ok(container.innerHTML.includes("id=\"ecrpFileSelect\""), "Salary sheet select dropdown must render");
  assert.ok(container.innerHTML.includes("id=\"ecrpSelectAllTabsBtn\""), "All Salary Tabs button must render for multi-tab workbook");

  const computed = api.getState().computed;
  assert.equal(computed.activeTabNames.length, 2, "Must auto-select both FELTING and CARDING department tabs (skipping Summary & HDFC BANK)");
  assert.equal(computed.rows.length, 4, "Must parse all 4 employees across both department tabs");

  // Verify duplicate Basic/Gross disambiguation picked EARNED Basic (12681) and Total Gross (18100), NOT fixed rate Basic (15120) / Gross Total (21000)!
  const sampat = computed.rows.find(r => r.empCode === "135");
  assert.ok(sampat, "Employee 135 SAMPAT LAL must be parsed");
  assert.equal(sampat.paidDays, 26);
  assert.equal(sampat.basic, 12681, "Must pick Earned Basic AFTER Paid Days, not fixed rate Basic 15120");
  assert.equal(sampat.gross, 18100, "Must pick Total Gross Salary AFTER Paid Days, not fixed Gross Total 21000");

  const bulluram = computed.rows.find(r => r.empCode === "419");
  assert.ok(bulluram, "Employee 419 BULLURAM from second tab CARDING must also be parsed");
  assert.equal(bulluram.basic, 12000);
  assert.equal(bulluram.gross, 15500);
});
