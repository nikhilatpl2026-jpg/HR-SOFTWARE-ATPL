'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const XLSX = require('../xlsx.full.min.js');

const ROOT = path.resolve(__dirname, '..');
const studio = require('../mam-compliance-excel-studio.js');

function readCsv(relPath) {
  const txt = fs.readFileSync(path.join(ROOT, relPath), 'utf8');
  return studio.parseCsvText(txt);
}

test('parses ATPL Full Compliance CSV (try1_f17af3b2.csv) and optional OCT_MAM CSV cleanly', () => {
  const tryRows = readCsv('public/assets/aistudio/try1_f17af3b2.csv');
  const prof = studio.parseReferenceMatrix(tryRows, 'try1', 'try1_f17af3b2.csv');
  assert.ok(prof.count >= 460, 'Expected >= 460 reference profiles from try1_f17af3b2.csv, got ' + prof.count);

  const octMamPath = path.join(ROOT, 'public/assets/aistudio/OCT_MAM_929191bf.csv');
  if (fs.existsSync(octMamPath)) {
    const rows = readCsv('public/assets/aistudio/OCT_MAM_929191bf.csv');
    const parsed = studio.parseMamMatrix(rows, 'OCT MAM', 'OCT_MAM.csv');
    assert.ok(parsed.length >= 460 && parsed.length <= 490, 'Expected ~469 Mam rows, got ' + parsed.length);
  }
});

test('reproduces Full Compliance formulas (Working Days, Sun Allow, HRA, Earn HRA, Bonus 8.33%, OT Amount) across all employee rows of try1_f17af3b2.csv', () => {
  const tryRows = readCsv('public/assets/aistudio/try1_f17af3b2.csv');
  let checked = 0;
  let exactPaid = 0;
  let exactEarnBasic = 0;
  let exactEarnHra = 0;
  let exactBonus = 0;
  let exactOt = 0;
  let exactTotalGross = 0;

  for (let i = 1; i < tryRows.length; i++) {
    const r = tryRows[i];
    const id = studio.cleanCode(r[1]);
    const name = studio.text(r[2]);
    if (!id || !name || /^(total|grand total)$/i.test(name)) continue;

    const basic = studio.num(r[10]) || 0;
    const hra = studio.num(r[11]) || 0;
    const gross = studio.num(r[12]) || 0;
    const md = studio.num(r[13]) || 30;
    const workingDays = studio.num(r[14]) || 0;
    const sunAllow = studio.num(r[15]) || 0;
    const hd = studio.num(r[16]) || 0;
    const paidDays = studio.num(r[18]) || 0;
    const ot = studio.num(r[19]) || 0;
    const actualEB = studio.num(r[20]) || 0;
    const actualEH = studio.num(r[21]) || 0;
    const actualBonus = studio.num(r[23]) || 0;
    const actualOt = studio.num(r[24]) || 0;
    const actualTG = studio.num(r[25]) || 0;
    const pfNo = studio.text(r[6]) || 'NA';
    const esiNo = studio.text(r[7]) || 'NA';
    const manual = studio.num(r[26]) || 0;
    const adv = studio.num(r[30]) || 0;
    const rem = studio.text(r[34]);

    const row = studio.recalculateRow({
      uid: 't_' + i,
      empId: id,
      name,
      pfNo,
      esiNo,
      basic,
      hra,
      gross,
      _salaryPartsEdited: true,
      monthDays: md,
      workingDays,
      sunAllow,
      hd,
      paidDays,
      _attendanceEdited: true,
      _attendancePartsLocked: true,
      overtimeHours: ot,
      manualAmount: manual,
      advance: adv,
      remarks: rem,
      _remarksEdited: true,
      masterMatched: true
    }, { month: '2026-09', monthDays: md });

    checked++;
    if (Math.abs((workingDays + sunAllow + hd) - paidDays) < 0.01) exactPaid++;
    if (Math.abs(row.earnBasic - actualEB) <= 1) exactEarnBasic++;
    if (Math.abs(row.earnHra - actualEH) <= 1) exactEarnHra++;
    if (Math.abs(row.earnedBonus - actualBonus) <= 1) exactBonus++;
    if (Math.abs(row.otAmount - actualOt) <= 1) exactOt++;
    if (Math.abs(row.totalGross - actualTG) <= 1) exactTotalGross++;
  }

  assert.ok(checked >= 485, 'Expected >= 485 employee rows, got ' + checked);
  assert.equal(exactPaid, checked, 'Working Days + Sun Allow + HD must equal Paid Days on 100% of rows');
  assert.equal(exactEarnBasic, checked, 'Earn Basic must match try1_f17af3b2.csv on 100% of rows');
  assert.equal(exactEarnHra, checked, 'Earn HRA must match try1_f17af3b2.csv on 100% of rows');
  assert.equal(exactBonus, checked, 'Earned Bonus 8.33% must match try1_f17af3b2.csv on 100% of rows');
  assert.equal(exactOt, checked, 'OT Amount must match try1_f17af3b2.csv on 100% of rows');
  assert.ok(exactTotalGross >= checked - 2, 'Total Gross salary must match try1_f17af3b2.csv on >= 99.5% of rows (' + exactTotalGross + '/' + checked + ')');
});

test('enriches Mam rows automatically from Employee Master & recalculates on grid edits', () => {
  const mamRows = studio.parseMamMatrix([
    ['Code', 'Staff Name', 'Total'],
    ['135', 'Sampat Lal', 27660],
    ['25903', 'Shiv kumar yadav', 4750]
  ], 'Sheet1', 'OCT_MAM.csv');

  const master = [
    {
      emp_id: '00135',
      name: 'SAMPAT LAL',
      father: 'SOHAN LAL',
      dob: '01-01-1985',
      doj: '01-05-2018',
      pf_no: '100330064649',
      esi_no: '2706516566',
      gender: 'MALE',
      dept: 'STAFF',
      desig: 'SUPERVISOR',
      cat2: 'STAFF NAME',
      basic: 20489,
      gross: 27660,
      bank_name: 'SBI',
      ifsc: 'SBIN0000123',
      account_no: '1234567890'
    },
    {
      emp_id: '25903',
      name: 'SHIV KUMAR YADAV',
      father: 'RAM LAL',
      pf_no: 'NA',
      esi_no: 'NA',
      gender: 'MALE',
      dept: 'PRODUCTION',
      desig: 'HELPER',
      cat2: 'CARD NO.6',
      basic: 0,
      gross: 0
    }
  ];

  const rows = studio.generateComplianceRows(mamRows, master, {
    settings: { month: '2026-10', monthDays: 31 },
    advanceMap: { '135': 500 }
  });

  assert.equal(rows.length, 2);

  // Employee 00135 enriched from Master + Advance deducted
  const r0 = rows[0];
  assert.equal(r0.empId, '00135');
  assert.equal(r0.designation, 'SUPERVISOR');
  assert.equal(r0.category, 'STAFF NAME');
  assert.equal(r0.pfNo, '100330064649');
  assert.equal(r0.esiNo, '2706516566');
  assert.equal(r0.paidDays, 29);
  assert.equal(r0.absent, 2);
  assert.equal(r0.earnBasic, 19167);
  assert.equal(r0.grossEarned, 25875);
  assert.equal(r0.totalGross, 27472);
  assert.equal(r0.diffAmount, 188);
  assert.equal(r0.pfEmployee, 2300);
  assert.equal(r0.esiEmployee, 144);
  assert.equal(r0.advance, 500);
  assert.equal(r0.totalDeduction, 2944);
  assert.equal(r0.netPayable, 24528);
  assert.equal(r0.remarks, 'onroll');

  // Employee 25903 has Basic/Gross 0 -> automatically marked off roll
  const r1 = rows[1];
  assert.equal(r1.remarks, 'off roll');
  assert.equal(r1.diffAmount, 4750);
  assert.equal(r1.netPayable, 0);

  // Live edit simulation: change PF rule to CAP_15000 and add 2 OT hours
  r0.pfMode = 'CAP_15000';
  r0.overtimeHours = 2;
  studio.recalculateRow(r0, { month: '2026-10', monthDays: 31 });
  assert.equal(r0.pfEmployee, 1800, '12% capped at 15,000 must equal 1,800');
  assert.ok(r0.totalGross > 27472, 'Adding 2 OT hours must raise Total Gross');

  // Verify Working Days + Sun Allow + HD split & HRA / Earn HRA / Bonus / OT calculations
  assert.equal(r0.hra, 27660 - 20489);
  assert.equal(r0.sunAllow, 4);
  assert.equal(r0.workingDays, 25);
  assert.equal(r0.workingDays + r0.sunAllow + r0.hd, r0.paidDays);
  assert.ok(r0.earnHra > 0 && r0.earnedBonus > 0 && r0.pfEmployer > 0 && r0.esiEmployer > 0);

  // Multi-sheet Excel export includes live formulas across 39-col Full Compliance sheet
  const wb = studio.buildComplianceWorkbook(XLSX, rows, { month: '2026-10', monthDays: 31 }, { mamFile: 'OCT_MAM.csv' });
  assert.ok(wb.SheetNames.includes('Main Sheet'));
  assert.ok(wb.SheetNames.includes('Category Summary'));
  assert.ok(wb.SheetNames.includes('Bank NEFT Transfer'));
  assert.ok(wb.SheetNames.includes('Master & Designation'));
  assert.ok(wb.SheetNames.includes('PF & ESIC Summary'));
  assert.ok(wb.SheetNames.includes('Diff & Variance'));
  const mainWs = wb.Sheets['Main Sheet'];
  assert.ok(mainWs['X2'].f && mainWs['X2'].f.includes('ROUND('), 'Earn Basic cell must contain live Excel formula');
  assert.ok(mainWs['Y2'].f && mainWs['Y2'].f.includes('ROUND('), 'Earn HRA cell must contain live Excel formula');
  assert.ok(mainWs['AA2'].f && mainWs['AA2'].f.includes('ROUND('), 'Earned Bonus cell must contain live Excel formula');
  assert.ok(mainWs['AC2'].f && mainWs['AC2'].f.includes('ROUND('), 'Total Gross cell must contain live Excel formula');
  assert.ok(mainWs['AJ4'].f && mainWs['AJ4'].f.includes('SUM('), 'Grand Total Net Payable row must contain SUM formula');
});

test('server.js & mam-salary.js expose cross-browser compliance sheet sync endpoints and loader wiring', () => {
  const serverSrc = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert.ok(serverSrc.includes("'/api/sync/compliance-sheets'"));
  assert.ok(serverSrc.includes("'/api/sync/compliance-sheet'"));
  assert.ok(serverSrc.includes("'/api/sync/compliance-sheet/:id'"));
  assert.ok(serverSrc.includes("broadcastEvent('compliance_sheet_saved'"));
  assert.ok(serverSrc.includes("broadcastEvent('compliance_sheet_deleted'"));

  const loaderSrc = fs.readFileSync(path.join(ROOT, 'mam-salary.js'), 'utf8');
  assert.ok(loaderSrc.includes('mam-compliance-excel-studio.js'));
  assert.ok(loaderSrc.includes('mam-salary-july-v4.js'));
  assert.ok(loaderSrc.includes('mam-salary-generator.js'));
});

test('browser handleMamUpload runs end-to-end for CSV and XLSX without advanceMap ReferenceError', async () => {
  const vm = require('node:vm');
  const studioSrc = fs.readFileSync(path.join(ROOT, 'mam-compliance-excel-studio.js'), 'utf8');

  const elements = new Map();
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
      classList: {
        add() {},
        remove() {},
        toggle() {},
        contains() { return false; }
      },
      addEventListener() {},
      querySelector() { return null; },
      querySelectorAll() { return []; },
      appendChild(child) {
        this.children.push(child);
        if (child && child.id) elements.set(child.id, child);
        return child;
      },
      remove() {
        if (this.id) elements.delete(this.id);
      },
      set innerHTML(html) {
        this._innerHTML = String(html || '');
        const idMatches = this._innerHTML.matchAll(/id="([^"]+)"/g);
        for (const m of idMatches) {
          if (!elements.has(m[1])) {
            const child = makeEl('DIV', m[1]);
            elements.set(m[1], child);
          }
        }
      },
      get innerHTML() {
        return this._innerHTML || '';
      }
    };
    return el;
  }

  const body = makeEl('BODY', '');
  const head = makeEl('HEAD', '');
  const storageMap = new Map();
  storageMap.set('AroraTextilesEmployeeMasterV3', JSON.stringify([
    {
      emp_id: '00135',
      name: 'SAMPAT LAL',
      father: 'SOHAN LAL',
      pf_no: '100330064649',
      esi_no: '2706516566',
      gender: 'MALE',
      dept: 'STAFF',
      desig: 'SUPERVISOR',
      cat2: 'STAFF NAME',
      basic: 20489,
      gross: 27660
    }
  ]));
  storageMap.set('ATPL_AdvanceRecordsV2', JSON.stringify([
    { empCode: '135', balanceAmount: 2000, monthlyCap: 500, status: 'ACTIVE' }
  ]));

  const localStorageMock = {
    getItem: k => storageMap.has(k) ? storageMap.get(k) : null,
    setItem: (k, v) => storageMap.set(k, String(v)),
    removeItem: k => storageMap.delete(k)
  };

  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    Date,
    Math,
    Number,
    String,
    Array,
    Object,
    Set,
    Map,
    JSON,
    Promise,
    Error,
    RegExp,
    XLSX,
    localStorage: localStorageMock,
    sessionStorage: localStorageMock,
    location: { hostname: 'nikhilatpl2026-jpg.github.io', protocol: 'https:', origin: 'https://nikhilatpl2026-jpg.github.io' },
    document: {
      readyState: 'complete',
      hidden: false,
      head,
      body,
      activeElement: null,
      getElementById: id => elements.get(id) || null,
      createElement: tag => makeEl(tag, ''),
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener() {}
    },
    addEventListener() {},
    fetch: async () => ({ ok: false, status: 404, json: async () => ({}) })
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;

  vm.runInNewContext(studioSrc, sandbox);

  const mamInput = elements.get('mcsMamInput');
  assert.ok(mamInput && typeof mamInput.onchange === 'function', 'mcsMamInput onchange handler must be bound');

  // Build real XLSX file buffer matching Mam format
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ['Code', 'Staff Name', 'Total'],
    ['135', 'Sampat Lal', 27660]
  ]);
  XLSX.utils.book_append_sheet(wb, ws, 'OCT MAM');
  const xlsxBuf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  await mamInput.onchange({
    target: {
      files: [{
        name: 'OCT_2026_MAM.xlsx',
        arrayBuffer: async () => xlsxBuf.buffer.slice(xlsxBuf.byteOffset, xlsxBuf.byteOffset + xlsxBuf.byteLength)
      }]
    }
  });

  const notice = elements.get('mcsNotice');
  assert.equal(notice.dataset.type, 'ok', 'Expected upload success notice, got: ' + notice.textContent);
  assert.ok(!notice.textContent.includes('advanceMap'), 'Must not fail with advanceMap ReferenceError');

  const savedSheets = JSON.parse(storageMap.get(studio.STORAGE_SHEETS_KEY) || '{}');
  const sheet = savedSheets['2026-10'];
  assert.ok(sheet && Array.isArray(sheet.rows) && sheet.rows.length === 1);
  assert.equal(sheet.rows[0].empId, '00135');
  assert.equal(sheet.rows[0].advance, 500, 'Must pull monthly advance cap from ATPL_AdvanceRecordsV2');
  assert.equal(sheet.rows[0].netPayable, 24528);
  assert.ok(elements.get('mcsTableBody').innerHTML.includes('00135'));
});

test('browser Excel features: Full Screen, Expand Grid, Sort, Undo/Redo, Bulk Actions, Worksheet Tabs, Find/Replace', async () => {
  const vm = require('node:vm');
  const studioSrc = fs.readFileSync(path.join(ROOT, 'mam-compliance-excel-studio.js'), 'utf8');

  const elements = new Map();
  const listeners = {};
  function makeEl(tag, id) {
    const clsSet = new Set();
    const el = {
      tagName: String(tag || 'DIV').toUpperCase(),
      id: id || '',
      className: '',
      style: {},
      dataset: {},
      children: [],
      value: '',
      checked: false,
      disabled: false,
      textContent: '',
      classList: {
        add(...cs) { cs.forEach(c => clsSet.add(c)); },
        remove(...cs) { cs.forEach(c => clsSet.delete(c)); },
        toggle(c, force) {
          const on = typeof force === 'boolean' ? force : !clsSet.has(c);
          if (on) clsSet.add(c); else clsSet.delete(c);
          return on;
        },
        contains(c) { return clsSet.has(c); }
      },
      addEventListener(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
      querySelector() { return null; },
      querySelectorAll() { return []; },
      appendChild(child) {
        this.children.push(child);
        if (child && child.id) elements.set(child.id, child);
        return child;
      },
      remove() { if (this.id) elements.delete(this.id); },
      requestFullscreen: async () => { sandbox.document.fullscreenElement = el; },
      set innerHTML(html) {
        this._innerHTML = String(html || '');
        const idMatches = this._innerHTML.matchAll(/id="([^"]+)"/g);
        for (const m of idMatches) {
          if (!elements.has(m[1])) {
            const child = makeEl('DIV', m[1]);
            elements.set(m[1], child);
          }
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
    { emp_id: '00135', name: 'SAMPAT LAL', father: 'SOHAN LAL', pf_no: '100330064649', esi_no: '2706516566', gender: 'MALE', dept: 'STAFF', desig: 'SUPERVISOR', cat2: 'STAFF NAME', basic: 20489, gross: 27660 },
    { emp_id: '00136', name: 'RAMESH KUMAR', father: 'MOHAN LAL', pf_no: '100330064650', esi_no: '2706516567', gender: 'MALE', dept: 'CARD', desig: 'OPERATOR', cat2: 'CARD NO.6', basic: 12000, gross: 16000 }
  ]));

  const localStorageMock = {
    getItem: k => storageMap.has(k) ? storageMap.get(k) : null,
    setItem: (k, v) => storageMap.set(k, String(v)),
    removeItem: k => storageMap.delete(k)
  };

  const sandbox = {
    console, setTimeout, clearTimeout, Date, Math, Number, String, Array, Object, Set, Map, JSON, Promise, Error, RegExp, CSS: { escape: s => s },
    XLSX,
    localStorage: localStorageMock,
    sessionStorage: localStorageMock,
    location: { hostname: 'nikhilatpl2026-jpg.github.io', protocol: 'https:', origin: 'https://nikhilatpl2026-jpg.github.io' },
    document: {
      readyState: 'complete',
      hidden: false,
      fullscreenElement: null,
      head, body,
      activeElement: null,
      getElementById: id => elements.get(id) || null,
      createElement: tag => makeEl(tag, ''),
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener() {},
      exitFullscreen: async () => { sandbox.document.fullscreenElement = null; }
    },
    addEventListener() {},
    fetch: async () => ({ ok: false, status: 404, json: async () => ({}) })
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;

  vm.runInNewContext(studioSrc, sandbox);

  // Upload 2-row CSV
  const mamInput = elements.get('mcsMamInput');
  const csv = 'Code,Staff Name,Total\n135,Sampat Lal,27660\n136,Ramesh Kumar,15000\n';
  await mamInput.onchange({
    target: { files: [{ name: 'OCT_2026_MAM.csv', text: async () => csv }] }
  });

  // 1. Expand Grid & Fullscreen toggles
  elements.get('mcsExpandGridBtn').onclick();
  assert.ok(elements.get('mcsShell').classList.contains('mcs-focus'));
  await elements.get('mcsFullscreenBtn').onclick();
  assert.ok(sandbox.document.fullscreenElement);
  await elements.get('mcsFullscreenBtn').onclick();
  assert.equal(sandbox.document.fullscreenElement, null);

  // 2. Add Row + Undo + Redo
  elements.get('mcsAddRowBtn').onclick();
  let sheets = JSON.parse(storageMap.get(studio.STORAGE_SHEETS_KEY));
  assert.equal(sheets['2026-10'].rows.length, 3);
  assert.equal(elements.get('mcsUndoBtn').disabled, false);

  elements.get('mcsUndoBtn').onclick();
  sheets = JSON.parse(storageMap.get(studio.STORAGE_SHEETS_KEY));
  assert.equal(sheets['2026-10'].rows.length, 2);

  elements.get('mcsRedoBtn').onclick();
  sheets = JSON.parse(storageMap.get(studio.STORAGE_SHEETS_KEY));
  assert.equal(sheets['2026-10'].rows.length, 3);

  // 3. Freeze Panes toggle
  elements.get('mcsFreezeBtn').onclick();
  assert.ok(!elements.get('mcsTableHead').innerHTML.includes('left:0px;'));
  elements.get('mcsFreezeBtn').onclick();
  assert.ok(elements.get('mcsTableHead').innerHTML.includes('left:0px;'));

  // 4. Find & Replace across category
  elements.get('mcsFrField').value = 'category';
  elements.get('mcsFrFind').value = 'CARD NO.6';
  elements.get('mcsFrReplace').value = 'CARD NO.9';
  elements.get('mcsFrScope').value = 'FILTERED';
  elements.get('mcsFrApplyBtn').onclick();
  sheets = JSON.parse(storageMap.get(studio.STORAGE_SHEETS_KEY));
  assert.ok(sheets['2026-10'].rows.some(r => r.category === 'CARD NO.9'));

  // 5. Sort & Worksheet Tabs
  const headHtml = elements.get('mcsTableHead').innerHTML;
  assert.ok(headHtml.includes('mcs-xl-letters'), 'Must render Excel column letter header A, B, C...');
  assert.ok(headHtml.includes('Working Days') && headHtml.includes('Earn Basic') && headHtml.includes('PF @13%'), 'Main table renders full Working Days, Earn Basic & Employer columns');
  assert.ok(elements.get('mcsSheetTabs'), 'Must render bottom Excel worksheet tabs');

  // 6. View Preset switcher & Download Form Modal
  elements.get('mcsViewPreset').onchange({ target: { value: 'ATTENDANCE' } });
  assert.ok(!elements.get('mcsTableHead').innerHTML.includes('PF@12%'), 'Attendance preset focuses on Working Days/Sun Allow/Paid Days');
  elements.get('mcsViewPreset').onchange({ target: { value: 'FULL' } });
  assert.ok(elements.get('mcsTableHead').innerHTML.includes('PF@12%'), 'Full preset restores statutory columns');
  assert.ok(elements.get('mcsDownloadFormBtn') && elements.get('mcsExportModal'), 'Download Form button and modal present');
});

test('Working-Days OT cap (1-7 wd never 32h OT), Manisha Juneja ₹4,200 PF lock & Office Staff last-month PF guard', () => {
  // 1. Working Days OT cap: 1-7 working days can never get 32 OT hours
  assert.equal(studio.maxRealisticOtForWorkingDays(0, 0, 32), 0);
  assert.equal(studio.maxRealisticOtForWorkingDays(1, 1, 32), 1);
  assert.equal(studio.maxRealisticOtForWorkingDays(5, 5, 32), 6);
  assert.equal(studio.maxRealisticOtForWorkingDays(7, 8, 32), 8);
  assert.ok(studio.maxRealisticOtForWorkingDays(7, 8, 32) < 10, '1-7 working days must never allow 32 OT hrs');

  // Even if Manual Amount leaves a gap while Paid Days = 7 (6 working days), OT stays <= 7
  const derivedLowDays = studio.deriveDaysAndOt(5200, 13043, 15000, { monthDays: 30, maxOtHours: 32 });
  assert.ok(derivedLowDays.workingDays <= 8);
  assert.ok(derivedLowDays.overtimeHours <= 11, 'Derived OT must stay proportional to workingDays, got ' + derivedLowDays.overtimeHours);

  // 2. Manisha Juneja PF permanently locked at ₹4,200 regardless of working days / slight basic shifts
  const master = [
    { emp_id: '00538', name: 'MANISHA JUNEJA', pf_no: '101018418699', esi_no: 'NA', dept: 'OFFICE STAFF', desig: 'MANAGER', cat1: 'OFF STAFF', cat2: 'STAFF NAME', basic: 35000, hra: 28000, gross: 63000 },
    { emp_id: '00387', name: 'SURENDRA KUMAR', pf_no: '100387', esi_no: 'NA', dept: 'OFFICE STAFF', desig: 'STAFF', cat1: 'OFF STAFF', cat2: 'STAFF NAME', basic: 25000, hra: 9000, gross: 34000 },
    { emp_id: '25100', name: 'RAMESH WORKER', pf_no: '100999', esi_no: '270999', dept: 'PRODUCTION', desig: 'OP', cat1: 'CARD 1', cat2: 'CARD NO. 1', basic: 20000, hra: 5000, gross: 25000 }
  ];
  const prevProfiles = {
    byCode: {
      '538': { empId: '00538', name: 'MANISHA JUNEJA', prevPf: 4200, pfMode: 'FULL_12' },
      '387': { empId: '00387', name: 'SURENDRA KUMAR', prevPf: 2000, pfMode: 'FULL_12' },
      '25100': { empId: '25100', name: 'RAMESH WORKER', prevPf: 2000, pfMode: 'FULL_12' }
    },
    byName: {},
    count: 3
  };
  const mamRows = [
    { code: '00538', name: 'MANISHA JUNEJA', manualAmount: 50000, category: 'STAFF NAME' },
    { code: '00387', name: 'SURENDRA KUMAR', manualAmount: 18000, category: 'STAFF NAME' },
    { code: '25100', name: 'RAMESH WORKER', manualAmount: 13000, category: 'CARD NO. 1' }
  ];
  const rows = studio.generateComplianceRows(mamRows, master, {
    settings: { month: '2026-10', monthDays: 30, officeStaffPfBandPct: 12 },
    profiles: prevProfiles
  });

  const manisha = rows.find(r => r.empId === '00538');
  assert.equal(manisha.pfMode, 'LOCK_4200');
  assert.equal(manisha.pfEmployee, 4200, 'Manisha Juneja PF must stay locked at ₹4,200 even on lower paid days');
  assert.equal(manisha.pfLocked4200, true);

  // Even if Manisha basic or paidDays increases in live edit, PF remains strictly ₹4,200
  manisha.paidDays = 30;
  manisha.basic = 42000;
  manisha._salaryPartsEdited = true;
  manisha._attendanceEdited = true;
  studio.recalculateRow(manisha, { month: '2026-10', monthDays: 30 });
  assert.equal(manisha.pfEmployee, 4200, 'Manisha Juneja PF must never go above ₹4,200 either');

  // 3. Office Staff PF guard keeps PF near last month (₹2,000 ±12% => ₹1,760..₹2,240), while card worker is unguarded
  const surendra = rows.find(r => r.empId === '00387');
  assert.equal(surendra.pfBandLower, 1760);
  assert.equal(surendra.pfBandUpper, 2240);
  assert.ok(surendra.pfEmployee >= 1760 && surendra.pfEmployee <= 2240, 'Office staff PF must stay near prev ₹2,000, got ' + surendra.pfEmployee);
  assert.equal(surendra.pfBandApplied, true);

  // Raise Surendra days to max so raw PF (3000) would spike way above prev ₹2,000 -> capped at ₹2,240
  surendra.paidDays = 30;
  surendra.workingDays = 26;
  surendra.sunAllow = 4;
  surendra._attendanceEdited = true;
  surendra._attendancePartsLocked = true;
  studio.recalculateRow(surendra, { month: '2026-10', monthDays: 30, officeStaffPfBandPct: 12 });
  assert.equal(surendra.pfEmployee, 2240, 'Office staff PF upper spike clamped to +12% of last month PF');

  const worker = rows.find(r => r.empId === '25100');
  assert.equal(worker.pfBandApplied, false, 'Factory CARD worker must NOT be clamped by Office Staff band');

  // Excel formulas carry LOCK_4200 & MIN/MAX band cleanly
  const wb = studio.buildComplianceWorkbook(XLSX, rows, { month: '2026-10', monthDays: 30 });
  const ws = wb.Sheets['Main Sheet'];
  assert.ok(ws['AF2'].f && ws['AF2'].f.includes('4200'), 'Manisha Juneja Excel PF formula must lock at 4200');
  assert.ok(ws['AF3'].f && ws['AF3'].f.includes('MIN(2240,MAX(1760'), 'Office Staff Excel PF formula must enforce MIN/MAX band');
});

