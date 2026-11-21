'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const XLSX = require(path.join(ROOT, 'xlsx.full.min.js'));
const studio = require(path.join(ROOT, 'mam-compliance-excel-studio.js'));

test('Card shift rule: Employee in Master Card 01 placed under C7/Card 7 in Mam sheet shifts directly to CARD NO.7 & survives Sync Master', () => {
  const master = [
    {
      emp_id: '00101',
      name: 'RAKESH VERMA',
      father: 'MAHESH VERMA',
      pf_no: '100111222333',
      esi_no: '2701112223',
      gender: 'MALE',
      dept: 'WEAVING',
      desig: 'WEAVER',
      cat2: 'CARD NO. 1',
      basic: 16000,
      gross: 20000
    },
    {
      emp_id: '00202',
      name: 'SUNIL SHARMA',
      father: 'RAMESH SHARMA',
      pf_no: '100444555666',
      esi_no: 'NA',
      gender: 'MALE',
      dept: 'WEAVING',
      desig: 'WEAVER',
      cat2: 'CARD NO.7',
      basic: 15000,
      gross: 18500
    },
    {
      emp_id: '00303',
      name: 'AMIT KUMAR',
      father: 'SURESH KUMAR',
      pf_no: 'NA',
      esi_no: 'NA',
      gender: 'MALE',
      dept: 'GENERAL',
      desig: 'HELPER',
      cat2: 'CARD NO 01',
      basic: 12000,
      gross: 14500
    }
  ];

  // Case 1: Grouped section CSV with C7 header
  const csvGrouped = [
    'Code,C7,Total',
    '101,Rakesh Verma,20000',
    '202,Sunil Sharma,18500',
    'Code,Card 7,Total',
    '303,Amit Kumar,14500'
  ].join('\n');
  const mamRows = studio.parseMamMatrix(studio.parseCsvText(csvGrouped), 'OCT_2026', 'OCT_2026_MAM.csv');
  const rows = studio.generateComplianceRows(mamRows, master, {
    settings: { month: '2026-10', monthDays: 31 }
  });

  assert.equal(rows.length, 3);
  assert.equal(rows[0].empId, '00101');
  assert.equal(rows[0].category, 'CARD NO.7', '00101 in C7 must directly become CARD NO.7 instead of old CARD NO. 1');
  assert.equal(rows[0].cardShiftedFrom, 'CARD NO. 1');
  assert.equal(rows[0].mamCategoryLocked, true);

  assert.equal(rows[1].empId, '00202');
  assert.equal(rows[1].category, 'CARD NO.7');
  assert.equal(rows[1].cardShiftedFrom, '', 'Existing CARD NO.7 employee has no card shift');

  assert.equal(rows[2].empId, '00303');
  assert.equal(rows[2].category, 'CARD NO.7', '00303 under Card 7 must shift directly from CARD NO 01 to CARD NO.7');
  assert.equal(rows[2].cardShiftedFrom, 'CARD NO 01');

  // Case 2: Explicit Card column in flat CSV
  const csvFlat = 'Code,Name,Card,Total\n101,Rakesh Verma,C7,20000\n';
  const flatMam = studio.parseMamMatrix(studio.parseCsvText(csvFlat), 'Sheet1', 'OCT_MAM.csv');
  const flatRows = studio.generateComplianceRows(flatMam, master, { settings: { month: '2026-10', monthDays: 31 } });
  assert.equal(flatRows[0].category, 'CARD NO.7');
  assert.equal(flatRows[0].cardShiftedFrom, 'CARD NO. 1');
});

test('Last month PF & ESIC deduction rules apply accurately while absent/left & 0-day employees get strictly ₹0', () => {
  const master = [
    { emp_id: '00101', name: 'ANIL CAP', pf_no: 'PF101', esi_no: 'ESI101', cat2: 'CARD NO.1', basic: 22000, gross: 28000 },
    { emp_id: '00102', name: 'VIJAY EXEMPT', pf_no: 'PF102', esi_no: 'ESI102', cat2: 'CARD NO.2', basic: 14000, gross: 17000 },
    { emp_id: '00103', name: 'RAJU FULL GROSS_ESI', pf_no: 'PF103', esi_no: 'ESI103', cat2: 'CARD NO.3', basic: 18000, gross: 23000 },
    { emp_id: '00104', name: 'LEFT WORKER MANOJ', pf_no: 'PF104', esi_no: 'ESI104', cat2: 'CARD NO.4', basic: 15000, gross: 18000 },
    { emp_id: '00105', name: 'ZERO DAY SURESH', pf_no: 'PF105', esi_no: 'ESI105', cat2: 'CARD NO.5', basic: 15000, gross: 18000 }
  ];

  // Build September reference/last month matrix where:
  // - 00101 had CAP_15000 PF (₹1,800 instead of 12% of 22,000=₹2,640) & EARN_BASIC ESIC (₹165)
  // - 00102 had PF=0 (exempt) and ESIC=0 (exempt) despite having PF/ESI numbers in Master
  // - 00103 had FULL_12 PF (₹2,160) & TOTAL_GROSS ESIC (0.75% of 24,500 = ₹184 instead of 0.75% of 18,000 = ₹135)
  // - 00104 (Manoj) had PF=₹1,800 & ESIC=₹113 cut last month, but is NOT present in October Mam sheet (Left/Absent!)
  // - 00105 (Suresh) had PF=₹1,800 & ESIC=₹113 last month, and has 0 Manual Amount in October
  const prevRefRows = [
    ['Employee ID', 'Name of employee', 'PF NO', 'ESI NO', 'Basic', 'Gross Total Salary', 'Month Of Days', 'Paid Days', 'Earn Basic', 'Total Gross salary', 'PF@12%', 'ESIC @0.75%', 'Remarks'],
    ['00101', 'ANIL CAP', 'PF101', 'ESI101', 22000, 28000, 30, 30, 22000, 29833, 1800, 165, 'onroll'],
    ['00102', 'VIJAY EXEMPT', 'PF102', 'ESI102', 14000, 17000, 30, 30, 14000, 18166, 0, 0, 'onroll'],
    ['00103', 'RAJU FULL GROSS_ESI', 'PF103', 'ESI103', 18000, 23000, 30, 30, 18000, 24500, 2160, 184, 'onroll'],
    ['00104', 'LEFT WORKER MANOJ', 'PF104', 'ESI104', 15000, 18000, 30, 30, 15000, 19250, 1800, 113, 'onroll'],
    ['00105', 'ZERO DAY SURESH', 'PF105', 'ESI105', 15000, 18000, 30, 30, 15000, 19250, 1800, 113, 'onroll']
  ];

  const prevProfiles = studio.parseReferenceMatrix(prevRefRows, 'Main Sheet', 'SEP_2026_COMPLIANCE.xlsx');
  assert.equal(prevProfiles.byCode['101'].pfMode, 'CAP_15000');
  assert.equal(prevProfiles.byCode['101'].esiMode, 'EARN_BASIC');
  assert.equal(prevProfiles.byCode['102'].pfMode, 'NONE');
  assert.equal(prevProfiles.byCode['102'].esiMode, 'NONE');
  assert.equal(prevProfiles.byCode['103'].pfMode, 'FULL_12');
  assert.equal(prevProfiles.byCode['103'].esiMode, 'TOTAL_GROSS');

  // October Mam sheet omits 00104 (Left/Absent) and sets 00105 Manual=0
  const octMamCsv = [
    'Code,Name,Total',
    '101,ANIL CAP,29833',
    '102,VIJAY EXEMPT,18166',
    '103,RAJU FULL GROSS_ESI,24500',
    '105,ZERO DAY SURESH,0'
  ].join('\n');
  const octMam = studio.parseMamMatrix(studio.parseCsvText(octMamCsv), 'OCT_2026', 'OCT_2026_MAM.csv');
  const octRows = studio.generateComplianceRows(octMam, master, {
    settings: { month: '2026-10', monthDays: 31 },
    profiles: prevProfiles
  });

  // 00104 MUST NOT be present in October generated rows
  assert.equal(octRows.length, 4);
  assert.equal(octRows.some(r => r.empId === '00104'), false, 'Absent/left employee from last month must never be added');

  const r101 = octRows.find(r => r.empId === '00101');
  const r102 = octRows.find(r => r.empId === '00102');
  const r103 = octRows.find(r => r.empId === '00103');
  const r105 = octRows.find(r => r.empId === '00105');

  assert.equal(r101.pfMode, 'CAP_15000');
  assert.equal(r101.pfEmployee, 1800, 'CAP_15000 keeps PF capped at ₹1,800');
  assert.ok(r101.esiEmployee > 0);

  assert.equal(r102.pfMode, 'NONE');
  assert.equal(r102.pfEmployee, 0, 'NONE keeps PF ₹0');
  assert.equal(r102.esiEmployee, 0, 'NONE keeps ESIC ₹0');

  assert.equal(r103.pfMode, 'FULL_12');
  assert.equal(r103.esiMode, 'TOTAL_GROSS');
  assert.equal(r103.esiEmployee, studio.round0(r103.totalGross * 0.0075));

  assert.equal(r105.paidDays, 0);
  assert.equal(r105.pfEmployee, 0, '0 Paid Days must strictly cut ₹0 PF');
  assert.equal(r105.esiEmployee, 0, '0 Paid Days must strictly cut ₹0 ESIC');

  const audit = studio.computeLastMonthAudit(octRows, prevProfiles);
  assert.equal(audit.skippedAbsentCount, 1);
  assert.equal(audit.skippedAbsent[0].empId, '00104');
  assert.equal(audit.skippedAbsent[0].prevPf, 1800);
  assert.equal(audit.skippedAbsent[0].currPf, 0);
  assert.equal(audit.skippedAbsent[0].currEsi, 0);
  assert.equal(audit.zeroDayCurrentCount, 1);
  assert.equal(audit.zeroDayCurrent[0].empId, '00105');
});

test('Formatted Excel export & end-to-end browser workflow: Auto last-month PF/ESIC + Card Shift + Styled XLSX download', async () => {
  const studioSrc = fs.readFileSync(path.join(ROOT, 'mam-compliance-excel-studio.js'), 'utf8');
  const elements = new Map();
  let lastDownloadedBlob = null;

  function makeEl(tag, id) {
    const el = {
      tagName: String(tag || 'DIV').toUpperCase(),
      id: id || '',
      className: '',
      style: {},
      dataset: {},
      children: [],
      value: '',
      disabled: false,
      textContent: '',
      classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
      addEventListener() {},
      querySelector() { return null; },
      querySelectorAll() { return []; },
      appendChild(child) { this.children.push(child); if (child && child.id) elements.set(child.id, child); return child; },
      remove() { if (this.id) elements.delete(this.id); },
      click() {
        if (this.tagName === 'A' && this.download && this.href) {
          lastDownloadedBlob = this;
        }
      },
      set innerHTML(html) {
        this._innerHTML = String(html || '');
        for (const m of this._innerHTML.matchAll(/id="([^"]+)"/g)) {
          if (!elements.has(m[1])) elements.set(m[1], makeEl('DIV', m[1]));
        }
      },
      get innerHTML() { return this._innerHTML || ''; }
    };
    return el;
  }

  const body = makeEl('BODY', '');
  const head = makeEl('HEAD', '');
  const storageMap = new Map();
  storageMap.set('AroraTextilesEmployeeMasterV3', JSON.stringify([
    { emp_id: '00101', name: 'RAKESH VERMA', pf_no: 'PF101', esi_no: 'ESI101', cat2: 'CARD NO. 1', basic: 22000, gross: 28000 },
    { emp_id: '00102', name: 'VIJAY EXEMPT', pf_no: 'PF102', esi_no: 'ESI102', cat2: 'CARD NO.2', basic: 14000, gross: 17000 },
    { emp_id: '00104', name: 'ABSENT MANOJ', pf_no: 'PF104', esi_no: 'ESI104', cat2: 'CARD NO.4', basic: 15000, gross: 18000 }
  ]));

  // Seed September 2026 compliance sheet into storage so October Mam upload auto-detects last month PF/ESIC!
  storageMap.set('ATPL_ComplianceSheets_V1', JSON.stringify({
    '2026-09': {
      id: '2026-09',
      month: '2026-09',
      mamFile: 'SEP_2026_MAM.csv',
      updatedAt: new Date().toISOString(),
      rows: [
        { empId: '00101', name: 'RAKESH VERMA', pfNo: 'PF101', esiNo: 'ESI101', category: 'CARD NO. 1', basic: 22000, gross: 28000, paidDays: 30, earnBasic: 22000, totalGross: 29833, pfMode: 'CAP_15000', esiMode: 'EARN_BASIC', pfEmployee: 1800, esiEmployee: 165, remarks: 'onroll' },
        { empId: '00102', name: 'VIJAY EXEMPT', pfNo: 'PF102', esiNo: 'ESI102', category: 'CARD NO.2', basic: 14000, gross: 17000, paidDays: 30, earnBasic: 14000, totalGross: 18166, pfMode: 'NONE', esiMode: 'NONE', pfEmployee: 0, esiEmployee: 0, remarks: 'onroll' },
        { empId: '00104', name: 'ABSENT MANOJ', pfNo: 'PF104', esiNo: 'ESI104', category: 'CARD NO.4', basic: 15000, gross: 18000, paidDays: 30, earnBasic: 15000, totalGross: 19250, pfMode: 'FULL_12', esiMode: 'EARN_BASIC', pfEmployee: 1800, esiEmployee: 113, remarks: 'onroll' }
      ]
    }
  }));

  const blobPayloads = [];
  const sandbox = {
    console, setTimeout, clearTimeout, Math, Date, JSON, Set, Map, RegExp, Error, Number, String, Array, Object,
    TextEncoder, TextDecoder, Uint8Array,
    Blob: class MockBlob {
      constructor(parts, opts) { this.parts = parts; this.type = opts && opts.type; blobPayloads.push(parts[0]); }
    },
    URL: { createObjectURL: () => 'blob:mock-xlsx', revokeObjectURL() {} },
    XLSX,
    localStorage: {
      getItem: k => storageMap.has(k) ? storageMap.get(k) : null,
      setItem: (k, v) => storageMap.set(k, String(v)),
      removeItem: k => storageMap.delete(k)
    },
    sessionStorage: { getItem: () => null, setItem() {} },
    addEventListener() {},
    removeEventListener() {},
    fetch: () => Promise.resolve({ ok: false, json: () => Promise.resolve({}) }),
    document: {
      readyState: 'complete',
      head,
      body,
      getElementById: id => elements.get(id) || null,
      createElement: tag => makeEl(tag, ''),
      querySelector: sel => (sel === '.content' ? body : null),
      querySelectorAll: () => [],
      addEventListener() {}
    }
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  vm.runInNewContext(studioSrc, sandbox);

  // Upload October Mam sheet where 00101 shifted to C7, 00102 present, 00104 left/absent
  const octCsv = [
    'Code,C7,Total',
    '101,Rakesh Verma,29833',
    'Code,CARD NO.2,Total',
    '102,Vijay Exempt,18166'
  ].join('\n');
  await elements.get('mcsMamInput').onchange({
    target: { files: [{ name: 'OCT_2026_MAM.csv', text: async () => octCsv }] }
  });

  const savedSheets = JSON.parse(storageMap.get('ATPL_ComplianceSheets_V1'));
  const octSheet = savedSheets['2026-10'];
  assert.ok(octSheet, 'October compliance sheet saved');
  assert.equal(octSheet.rows.length, 2, 'Left employee 00104 must NOT be carried over into October');

  const r101 = octSheet.rows.find(r => r.empId === '00101');
  const r102 = octSheet.rows.find(r => r.empId === '00102');
  assert.equal(r101.category, 'CARD NO.7', '00101 shifted directly from CARD NO. 1 to CARD NO.7');
  assert.equal(r101.pfEmployee, 1800, 'Auto-applied September CAP_15000 rule to 00101');
  assert.equal(r102.pfEmployee, 0, 'Auto-applied September NONE rule to 00102');
  assert.equal(octSheet.lastMonthAudit.skippedAbsentCount, 1);
  assert.equal(octSheet.lastMonthAudit.skippedAbsent[0].empId, '00104');

  // Verify clicking Sync Master does NOT revert shifted CARD NO.7 back to Master CARD NO. 1!
  elements.get('mcsSyncMasterBtn').onclick();
  const afterMasterSync = JSON.parse(storageMap.get('ATPL_ComplianceSheets_V1'))['2026-10'];
  const r101After = afterMasterSync.rows.find(r => r.empId === '00101');
  assert.equal(r101After.category, 'CARD NO.7', 'Sync Master must preserve Mam shifted CARD NO.7');

  // Verify styled Excel Download produces rich OOXML workbook readable by XLSX with cellStyles
  elements.get('mcsDownloadBtn').onclick();
  assert.ok(lastDownloadedBlob && lastDownloadedBlob.download === 'ATPL_ESI_PF_Compliance_2026-10.xlsx');
  const xlsxBytes = blobPayloads[blobPayloads.length - 1];
  assert.ok(xlsxBytes instanceof Uint8Array && xlsxBytes.length > 2000);

  const parsedWb = XLSX.read(xlsxBytes, { type: 'array', cellStyles: true });
  assert.ok(parsedWb.SheetNames.includes('Main Sheet'));
  assert.ok(parsedWb.SheetNames.includes('Last Month & Card Audit'));
  assert.ok(parsedWb.SheetNames.includes('CARD NO.7'));
  assert.ok(parsedWb.SheetNames.includes('CARD NO.2'));

  const wsMain = parsedWb.Sheets['Main Sheet'];
  assert.equal(wsMain['A1'].s.fgColor.rgb, '1E3A8A', 'Header row must have Navy #1E3A8A fill');
  assert.equal(wsMain['C4'].s.fgColor.rgb, 'DBEAFE', 'Grand Total row must have Ice Blue #DBEAFE fill');
  assert.equal(wsMain['AJ2'].s.fgColor.rgb, 'ECFDF5', 'Net Payable cell must have Mint Green #ECFDF5 highlight');
  assert.equal(wsMain['AF2'].s.fgColor.rgb, 'FFF7ED', 'PF deduction cell must have Soft Amber #FFF7ED highlight');

  // Verify Download Form modal opens and downloads customized Excel with banner enabled
  elements.get('mcsDownloadFormBtn').onclick();
  assert.ok(elements.get('mcsExportModal'));
  elements.get('mcsExpBanner').checked = true;
  elements.get('mcsExpRunXlsx').onclick();
  const customXlsx = blobPayloads[blobPayloads.length - 1];
  const customParsed = XLSX.read(customXlsx, { type: 'array' });
  assert.equal(customParsed.Sheets['Main Sheet']['A3'].v, 'S.No.');

  // Also verify Last Month PF/ESIC button executes cleanly without carrying over absent employees
  elements.get('mcsLastMonthBtn').onclick();
  const afterLastMonthBtn = JSON.parse(storageMap.get('ATPL_ComplianceSheets_V1'))['2026-10'];
  assert.equal(afterLastMonthBtn.rows.length, 2);
  assert.equal(afterLastMonthBtn.rows[0].pfEmployee, 1800);
  assert.ok(wsMain['X2'].f && wsMain['X2'].f.includes('ROUND('), 'Live Earn Basic formula preserved after styling');
  assert.ok(wsMain['Y2'].f && wsMain['Y2'].f.includes('ROUND('), 'Live Earn HRA formula preserved after styling');
  assert.ok(wsMain['AJ4'].f && wsMain['AJ4'].f.includes('SUM('), 'Grand Total Net Payable SUM formula preserved after styling');
});
