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

test('parses full grouped OCT_MAM CSV (all 28 sections, skipping Totals & repeated headers)', () => {
  const rows = readCsv('public/assets/aistudio/OCT_MAM_929191bf.csv');
  const parsed = studio.parseMamMatrix(rows, 'OCT MAM', 'OCT_MAM.csv');
  assert.ok(parsed.length >= 460 && parsed.length <= 490, 'Expected ~469 Mam rows, got ' + parsed.length);
  assert.equal(parsed[0].code, '25903');
  assert.equal(parsed[0].category, 'Card No.6');
  assert.equal(parsed[0].manualAmount, 4750);
  const staffRow = parsed.find(r => r.code === '135' || r.code === '00135');
  assert.ok(staffRow, 'Expected Sampat Lal in Staff Name section');
  assert.equal(staffRow.category, 'Staff Name');
  assert.equal(staffRow.manualAmount, 27660);
});

test('reproduces Lokesh compliance formulas accurately across OCT_LOKESH rows', () => {
  const lokesh = readCsv('public/assets/aistudio/OCT_LOKESH_a0b68345.csv');
  let checked = 0;
  let exactEarnBasic = 0;
  let exactGrossEarned = 0;
  let exactEsic = 0;
  let esicCount = 0;
  let exactNet = 0;

  for (let i = 1; i < lokesh.length; i++) {
    const r = lokesh[i];
    const sno = studio.text(r[0]);
    const id = studio.cleanCode(r[1]);
    const name = studio.text(r[2]);
    if ((!sno && !id && !name) || /^(total|grand total)$/i.test(name) || /^(total|grand total)$/i.test(sno)) continue;
    if (!id && !name) continue;

    const pfNo = studio.text(r[4]) || 'NA';
    const esiNo = studio.text(r[5]) || 'NA';
    const basic = studio.num(r[8]) || 0;
    const gross = studio.num(r[9]) || 0;
    const md = studio.num(r[10]) || 31;
    const paidDays = studio.num(r[12]) || 0;
    const ot = studio.num(r[13]) || 0;
    const actualEB = studio.num(r[14]) || 0;
    const actualGE = studio.num(r[15]) || 0;
    const actualTG = studio.num(r[16]) || 0;
    const manual = studio.num(r[17]) || 0;
    const actualPf = studio.num(r[19]) || 0;
    const actualEsi = studio.num(r[20]) || 0;
    const adv = studio.num(r[21]) || 0;
    const actualNet = studio.num(r[23]) || 0;
    const rem = studio.text(r[24]);

    const row = studio.recalculateRow({
      uid: 't_' + i,
      empId: id,
      name,
      pfNo,
      esiNo,
      basic,
      gross,
      monthDays: md,
      paidDays,
      overtimeHours: ot,
      manualAmount: manual,
      advance: adv,
      pfMode: (studio.validId(pfNo) && actualPf === 0 && actualEB > 0) ? 'NONE' : 'AUTO',
      esiMode: (studio.validId(esiNo) && actualEsi === 0 && actualEB > 0) ? 'NONE' : 'AUTO',
      remarks: rem,
      _remarksEdited: true,
      masterMatched: true
    }, { month: '2026-10', monthDays: md });

    checked++;
    if (Math.abs(row.earnBasic - actualEB) <= 1) exactEarnBasic++;
    if (Math.abs(row.grossEarned - actualGE) <= 1) exactGrossEarned++;
    if (actualEsi > 0) {
      esicCount++;
      if (Math.abs(row.esiEmployee - actualEsi) <= 1) exactEsic++;
    }
    if (Math.abs(row.totalGross - actualTG) <= 5 && Math.abs(row.netPayable - actualNet) <= 5) {
      exactNet++;
    }
  }

  assert.equal(checked, 482);
  assert.equal(exactEarnBasic, 482, 'Earn Basic formula must match 100% of Lokesh rows');
  assert.equal(exactGrossEarned, 482, 'Gross Earned formula must match 100% of Lokesh rows');
  assert.equal(exactEsic, esicCount, 'ESIC @0.75% formula must match 100% of ESIC-applicable rows');
  assert.ok(exactNet >= 470, 'Total Gross & Net Payable must match Lokesh formulas across >97% of rows, matched ' + exactNet);
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

  // Multi-sheet Excel export includes live formulas
  const wb = studio.buildComplianceWorkbook(XLSX, rows, { month: '2026-10', monthDays: 31 }, { mamFile: 'OCT_MAM.csv' });
  assert.ok(wb.SheetNames.includes('Main Sheet'));
  assert.ok(wb.SheetNames.includes('Category Summary'));
  assert.ok(wb.SheetNames.includes('Master & Designation'));
  assert.ok(wb.SheetNames.includes('PF & ESIC Summary'));
  const mainWs = wb.Sheets['Main Sheet'];
  assert.ok(mainWs['O2'].f && mainWs['O2'].f.includes('ROUND('), 'Earn Basic cell must contain live Excel formula');
  assert.ok(mainWs['Q2'].f && mainWs['Q2'].f.includes('ROUND('), 'Total Gross cell must contain live Excel formula');
  assert.ok(mainWs['X4'].f && mainWs['X4'].f.includes('SUM('), 'Grand Total row must contain SUM formula');
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
  assert.ok(elements.get('mcsSheetTabs'), 'Must render bottom Excel worksheet tabs');
});
