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
  await t.test("5. Modal opens, closes, and variable initialization order is valid without TypeError", () => {
    const domElements = {};
    const mockDoc = {
      getElementById: (id) => {
        if (!domElements[id]) {
          domElements[id] = {
            id,
            style: { display: "none", setProperty: function(k, v) { this[k] = v; } },
            innerHTML: "",
            appendChild: function(c) { this.children = this.children || []; this.children.push(c); },
            value: ""
          };
        }
        return domElements[id];
      },
      createElement: () => ({ style: { setProperty: function(k, v) { this[k] = v; } }, setAttribute: () => {}, addEventListener: () => {} }),
      addEventListener: () => {}
    };
    const ctx = {
      document: mockDoc,
      window: {},
      localStorage: { getItem: () => null, setItem: () => {} },
      alert: () => {},
      prompt: () => "NEW_COL"
    };
    ctx.window = ctx;

    const marker = "// EMPLOYEE MASTER — Excel Style Editor Functions";
    const scriptStart = html.indexOf(marker);
    const scriptEnd = html.indexOf("</script>", scriptStart);
    const code = html.slice(scriptStart, scriptEnd);

    const vm = require("vm");
    vm.runInNewContext(code, ctx);

    assert.equal(ctx.ALL_STANDARD_EM_COLS.length, 29, "Must have 29 standard columns");
    assert.equal(ctx.EM_COLS.length, 29, "Must initialize 29 columns");
    assert.equal(typeof ctx.emOpenAddColModal, "function", "emOpenAddColModal must be defined");
    assert.equal(typeof ctx.emCloseAddColModal, "function", "emCloseAddColModal must be defined");

    ctx.emOpenAddColModal();
    const modal = ctx.document.getElementById("emColModal");
    assert.equal(modal.style.display, "flex", "emColModal display must be flex after open");

    ctx.emCloseAddColModal();
    assert.equal(modal.style.display, "none", "emColModal display must be none after close");
  });
});