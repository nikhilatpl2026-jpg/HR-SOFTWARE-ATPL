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
