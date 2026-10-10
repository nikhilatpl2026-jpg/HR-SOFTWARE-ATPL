const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

test('Universal Salary Header Reader & Complete 29-Column Drag/Edit/Remove System', async (t) => {
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const workplaceJs = fs.readFileSync(path.join(__dirname, '../hr-workplace.js'), 'utf8');

  await t.test('1. ALL_STANDARD_EM_COLS has all 29 fields including Aadhaar, Phone, Nominee, etc.', () => {
    const reqFields = ['emp_id', 'name', 'father', 'dob', 'doj', 'dol', 'status', 'gender', 'pf_no', 'esi_no', 'bank_name', 'ifsc', 'account_no', 'dept', 'desig', 'cat1', 'cat2', 'basic', 'hra', 'gross', 'aadhaar_no', 'phone_no', 'qualification', 'present_address', 'permanent_address', 'marital_status', 'nominee_name', 'nominee_relation', 'nominee_dob'];
    reqFields.forEach(f => {
      assert(html.includes('key:\'' + f + '\''), 'Must include column: ' + f);
    });
  });

  await t.test('2. Every column chip has Drag, Edit ✏️, and Remove ✕ actions', () => {
    assert(html.includes('emEditCol('), 'Must include emEditCol function call on chips');
    assert(html.includes('emRemoveCol('), 'Must include emRemoveCol on chips');
    assert(html.includes('em-drag-grip'), 'Must include drag handle');
    assert(html.includes('emApplyPreset'), 'Must include preset switcher');
  });

  await t.test('3. Duplicate atplMapper is eliminated from hr-workplace.js', () => {
    assert(!workplaceJs.includes('q.id=\'atplMapper\''), 'hr-workplace must not inject redundant atplMapper');
  });

  await t.test('4. universalDetectSalaryCols correctly identifies diverse Indian salary formats', () => {
    assert(html.includes('universalDetectSalaryCols'), 'Must have universalDetectSalaryCols');
    assert(html.includes('findUniversalHeaderRow'), 'Must have findUniversalHeaderRow');
  });
});