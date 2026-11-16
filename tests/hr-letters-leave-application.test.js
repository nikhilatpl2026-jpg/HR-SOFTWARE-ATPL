'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

function mkStorage(init) {
  const m = new Map(Object.entries(init || {}));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k)
  };
}

function bootLettersModule(employees) {
  const local = mkStorage();
  const doc = {
    readyState: 'complete',
    head: { appendChild: () => {} },
    body: { appendChild: () => {}, removeChild: () => {} },
    getElementById: () => null,
    createElement: () => ({ id: '', style: {}, click: () => {} }),
    addEventListener: () => {}
  };
  const win = {
    localStorage: local,
    document: doc,
    EM: { data: employees || [] },
    addEventListener: () => {},
    setTimeout: () => 1
  };
  win.window = win;
  vm.runInNewContext(read('atpl-letters-v1.js'), Object.assign(win, { window: win }));
  return { mgr: win.ATPLLettersManager, local };
}

test('auto-lookup by Emp Code fills Name, Designation, Department and bottom signature', () => {
  const { mgr } = bootLettersModule([
    { emp_id: '25447', name: 'Kamlesh Kumar', desig: 'BLEND MASTER', dept: 'Quality' },
    { emp_id: '1042', name: 'Ramesh Sharma', desig: 'SUPERVISOR', dept: 'Spinning' }
  ]);

  mgr.setFormField('empCode', '25447');
  assert.equal(mgr.state.form.empName, 'Kamlesh Kumar');
  assert.equal(mgr.state.form.designation, 'BLEND MASTER');
  assert.equal(mgr.state.form.department, 'Quality');

  const html = mgr.buildLetterInnerHtml();
  assert.ok(html.includes('Kamlesh Kumar'));
  assert.ok(html.includes('<b>Employee ID:</b> 25447'));
  assert.ok(html.includes('<b>Designation:</b> BLEND MASTER'));
  assert.ok(html.includes('<b>Department:</b> Quality'));
  assert.ok(html.includes('(Kamlesh Kumar)'));

  mgr.setFormField('empCode', '1042');
  assert.equal(mgr.state.form.empName, 'Ramesh Sharma');
  assert.equal(mgr.state.form.designation, 'SUPERVISOR');
  assert.equal(mgr.state.form.department, 'Spinning');
  assert.ok(mgr.buildLetterInnerHtml().includes('(Ramesh Sharma)'));
});

test('calculates inclusive leave days accurately and auto-computes Next Available Date with manual override', () => {
  const { mgr } = bootLettersModule([
    { emp_id: '25447', name: 'Kamlesh Kumar', desig: 'BLEND MASTER', dept: 'Quality' }
  ]);

  assert.equal(mgr.diffDaysInclusive('2026-11-15', '2026-11-30'), 16);
  assert.equal(mgr.diffDaysInclusive('2026-11-12', '2026-11-27'), 16);
  assert.equal(mgr.diffDaysInclusive('2026-11-15', '2026-11-15'), 1);
  assert.equal(mgr.diffDaysInclusive('2026-11-30', '2026-11-15'), 0);

  mgr.setFormField('empCode', '25447');
  mgr.setFormField('fromDate', '2026-11-15');
  mgr.setFormField('toDate', '2026-11-30');
  assert.equal(mgr.state.form.days, 16);
  assert.equal(mgr.state.form.returnDate, '2026-12-01');

  // Manual override of returnDate is respected when other fields edit
  mgr.setFormField('returnDate', '2026-12-03');
  assert.equal(mgr.state.returnDateManual, true);
  mgr.setFormField('reason', 'family function');
  assert.equal(mgr.state.form.returnDate, '2026-12-03');

  // Reset returns to ToDate + 1
  mgr.resetReturnDateAuto();
  assert.equal(mgr.state.returnDateManual, false);
  assert.equal(mgr.state.form.returnDate, '2026-12-01');
});

test('exact PDF company layout and Sarthak ji / Manish ji / Ayush ji signatories are preserved in downloadable document', () => {
  const { mgr } = bootLettersModule([
    { emp_id: '25447', name: 'Kamlesh Kumar', desig: 'BLEND MASTER', dept: 'Quality' }
  ]);

  assert.deepEqual(Array.from(mgr.SIGNED_BY_OPTIONS), ['Sarthak ji', 'Manish ji', 'Ayush ji']);

  mgr.setFormField('empCode', '25447');
  mgr.setFormField('letterDate', '2026-11-10');
  mgr.setFormField('fromDate', '2026-11-12');
  mgr.setFormField('toDate', '2026-11-27');
  mgr.setFormField('signedBy', 'Ayush ji');

  const wordDoc = mgr.buildDownloadDocumentHtml(mgr.state.form, 'word');
  assert.ok(wordDoc.includes('ARORA TEXTILES PVT LTD'));
  assert.ok(wordDoc.includes('(Manufacturers of Suppliers of Carpet Woollen Yarn)'));
  assert.ok(wordDoc.includes('Add:-E-90,91, IGC, Khara-334601, Bikaner (Rajasthan)'));
  assert.ok(wordDoc.includes('E-mail:-arorawool@gmail.com:, Mobile No:-9858121113'));
  assert.ok(wordDoc.includes('The Respected Directors'));
  assert.ok(wordDoc.includes('Subject: Leave Application'));
  assert.ok(wordDoc.includes('16 Days'));
  assert.ok(wordDoc.includes('12/11/2026'));
  assert.ok(wordDoc.includes('27/11/2026'));
  assert.ok(wordDoc.includes('28/11/2026'));
  assert.ok(wordDoc.includes('(Thanking You)'));
  assert.ok(wordDoc.includes('Sincerely'));
  assert.ok(wordDoc.includes('(Kamlesh Kumar)'));
  assert.ok(wordDoc.includes('(Director)'));
  assert.ok(wordDoc.includes('(Ayush ji)'));
  assert.ok(wordDoc.includes('HR Department'));
  assert.ok(wordDoc.includes('(HOD)'));
});

test('saves, tracks per-employee leave history cleanly without duplicate spam, loads, and deletes', () => {
  const { mgr } = bootLettersModule([
    { emp_id: '25447', name: 'Kamlesh Kumar', desig: 'BLEND MASTER', dept: 'Quality' },
    { emp_id: '1042', name: 'Ramesh Sharma', desig: 'SUPERVISOR', dept: 'Spinning' }
  ]);

  mgr.setFormField('empCode', '25447');
  mgr.setFormField('fromDate', '2026-11-15');
  mgr.setFormField('toDate', '2026-11-30');
  mgr.setFormField('signedBy', 'Manish ji');
  const saved1 = mgr.saveCurrentLetter();
  assert.ok(saved1 && saved1.id);
  assert.equal(mgr.getEmployeeHistory('25447').length, 1);

  // Re-saving same empCode + date range updates record instead of duplicating
  mgr.setFormField('reason', 'medical checkup');
  const saved1Updated = mgr.saveCurrentLetter();
  assert.equal(saved1Updated.id, saved1.id);
  assert.equal(mgr.getEmployeeHistory('25447').length, 1);
  assert.equal(mgr.getEmployeeHistory('25447')[0].reason, 'medical checkup');

  // Different employee record stays isolated in employee history
  mgr.startNewLetter();
  mgr.setFormField('empCode', '1042');
  mgr.setFormField('fromDate', '2026-12-01');
  mgr.setFormField('toDate', '2026-12-05');
  const saved2 = mgr.saveCurrentLetter();
  assert.equal(mgr.getEmployeeHistory('25447').length, 1);
  assert.equal(mgr.getEmployeeHistory('1042').length, 1);
  assert.equal(mgr.getEmployeeHistory('1042')[0].days, 5);

  // Delete removes record cleanly
  assert.equal(mgr.deleteRecord(saved2.id), true);
  assert.equal(mgr.getEmployeeHistory('1042').length, 0);
});

test('ERP navigation, permission guard, and server leave-letter sync endpoints are wired', () => {
  const html = read('index.html');
  const uiJs = read('erp-enterprise-ui-v1.js');
  const guardJs = read('erp-permission-guard-v1.js');
  const srvJs = read('server.js');

  assert.ok(html.includes('id="vn-letter"'));
  assert.ok(html.includes("goPage('letter')"));
  assert.ok(html.includes('id="page-letter"'));
  assert.ok(html.includes('atpl-letters-v1.js'));
  assert.ok(uiJs.includes("letter:'Employee / HR Letters'"));
  assert.ok(guardJs.includes('letter:1'));
  assert.ok(srvJs.includes('/api/sync/leave-letters'));
  assert.ok(srvJs.includes('/api/sync/leave-letter'));
});


test('Bank Account Opening Letter (SBI) option, exact Hindi template, letterhead top spacer, blank & filled fields, and English-to-Hindi conversion', () => {
  const { mgr } = bootLettersModule([
    {
      emp_id: '00135',
      name: 'SAMPAT LAL',
      father: 'SOHAN LAL',
      aadhaar_no: '1234 5678 9012',
      pan_no: 'abcde1234f',
      address: 'Gram Khara, Bikaner\nRajasthan'
    }
  ]);

  assert.ok(mgr.LETTER_TYPES.some((t) => t.id === 'BANK'));
  mgr.setFormField('letterType', 'BANK');

  // Leave Letter uses slightly smaller 12px sizing for 70-80% A4 fill
  mgr.setFormField('letterType', 'LEAVE');
  const leaveHtml = mgr.buildLetterInnerHtml();
  assert.ok(leaveHtml.includes('font-size:12px'));

  // Switch back to Bank Letter and verify blank template with 5 blank letterhead spacer lines
  mgr.setFormField('letterType', 'BANK');
  mgr.setFormField('letterDate', '');
  const blankBankHtml = mgr.buildLetterInnerHtml();
  assert.ok(blankBankHtml.includes('atpl-letterhead-spacer'));
  assert.equal((blankBankHtml.match(/height:22px;line-height:22px/g) || []).length, 5);
  assert.ok(blankBankHtml.includes('ARORA TEXTILES PRIVATE LIMITED'));
  assert.ok(blankBankHtml.includes('खारा, बीकानेर, राजस्थान'));
  assert.ok(blankBankHtml.includes('भारतीय स्टेट बैंक (SBI)'));
  assert.ok(blankBankHtml.includes('विषय: बैंक खाता खुलवाने हेतु अनुरोध पत्र।'));
  assert.ok(blankBankHtml.includes('बचत खाता (Savings Account)'));
  assert.ok(blankBankHtml.includes('1.&nbsp;&nbsp;कर्मचारी का नाम:'));
  assert.ok(blankBankHtml.includes('5.&nbsp;&nbsp;स्थायी पता:'));
  assert.ok(blankBankHtml.includes('अधिकृत हस्ताक्षरकर्ता:'));
  assert.ok(blankBankHtml.includes('कंपनी की मोहर एवं हस्ताक्षर'));
  assert.ok(blankBankHtml.includes('__________________________'));

  // Auto-fill from Employee Master converts English names/address to Hindi
  mgr.setFormField('empCode', '00135');
  mgr.setFormField('letterDate', '2026-11-16');
  mgr.setFormField('signatoryName', 'Sarthak Arora');
  mgr.setFormField('signatoryDesignation', 'Director');
  const filledBankHtml = mgr.buildLetterInnerHtml();
  assert.ok(filledBankHtml.includes('संपत लाल'));
  assert.ok(filledBankHtml.includes('सोहन लाल'));
  assert.ok(filledBankHtml.includes('1234 5678 9012'));
  assert.ok(filledBankHtml.includes('ABCDE1234F'));
  assert.ok(filledBankHtml.includes('ग्राम खारा, बीकानेर'));
  assert.ok(filledBankHtml.includes('राजस्थान'));
  assert.ok(filledBankHtml.includes('16/11/2026'));

  // Saving & exporting Bank Letter to Word (.doc) preserves Hindi & can reload/delete
  const savedBank = mgr.saveCurrentLetter();
  assert.equal(savedBank.letterType, 'BANK');
  assert.equal(savedBank.empName, 'संपत लाल');
  const bankDoc = mgr.buildDownloadDocumentHtml(savedBank, 'word');
  assert.ok(bankDoc.includes('संपत लाल'));
  assert.ok(bankDoc.includes('atpl-letterhead-spacer'));
  assert.equal(mgr.deleteRecord(savedBank.id), true);
});
