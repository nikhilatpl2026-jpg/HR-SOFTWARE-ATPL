const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');

test('DOB in DD-MM-YYYY format is fully accepted and normalized across Employee Master', async (t) => {
  const hrWorkplace = fs.readFileSync(__dirname + '/../hr-workplace.js', 'utf8');

  const dom = {
    window: {
      location: { href: 'http://localhost' },
      document: { readyState: 'complete', addEventListener: () => {} }
    },
    document: {
      readyState: 'complete',
      addEventListener: () => {},
      createElement: () => ({ setAttribute: () => {}, appendChild: () => {}, style: {} }),
      head: { appendChild: () => {} },
      body: { appendChild: () => {} }
    },
    localStorage: { getItem: () => null, setItem: () => {} },
    sessionStorage: { getItem: () => null, setItem: () => {} }
  };
  dom.window.window = dom.window;
  dom.window.document = dom.document;
  dom.window.localStorage = dom.localStorage;
  dom.window.sessionStorage = dom.sessionStorage;

  const ctx = vm.createContext(dom);
  try {
    vm.runInContext(hrWorkplace, ctx);
  } catch(e) {
    // If DOM elements missing in node, that is fine, functions are tested
  }

  const { normalizeDate, validDate } = dom.window;

  await t.test('DD-MM-YYYY format is accepted', () => {
    assert.equal(validDate('10-05-1990'), true);
    assert.equal(normalizeDate('10-05-1990'), '10-05-1990');
    assert.equal(validDate('01-01-2002'), true);
    assert.equal(normalizeDate('01-01-2002'), '01-01-2002');
  });

  await t.test('DD/MM/YYYY and DD.MM.YYYY formats are normalized to DD-MM-YYYY', () => {
    assert.equal(validDate('15/08/1995'), true);
    assert.equal(normalizeDate('15/08/1995'), '15-08-1995');
    assert.equal(validDate('05.12.1988'), true);
    assert.equal(normalizeDate('05.12.1988'), '05-12-1988');
  });

  await t.test('Single digit day and month are normalized to DD-MM-YYYY', () => {
    assert.equal(validDate('1-5-1990'), true);
    assert.equal(normalizeDate('1-5-1990'), '01-05-1990');
    assert.equal(validDate('5/9/1995'), true);
    assert.equal(normalizeDate('5/9/1995'), '05-09-1995');
  });

  await t.test('ISO format YYYY-MM-DD is normalized to DD-MM-YYYY', () => {
    assert.equal(validDate('1990-05-10'), true);
    assert.equal(normalizeDate('1990-05-10'), '10-05-1990');
  });

  await t.test('8 continuous digits are normalized to DD-MM-YYYY', () => {
    assert.equal(validDate('10051990'), true);
    assert.equal(normalizeDate('10051990'), '10-05-1990');
  });

  await t.test('Empty or placeholder dates are considered valid', () => {
    assert.equal(validDate(''), true);
    assert.equal(validDate(null), true);
    assert.equal(validDate('—'), true);
    assert.equal(validDate('NA'), true);
  });

  await t.test('Invalid dates are rejected', () => {
    assert.equal(validDate('32-05-1990'), false);
    assert.equal(validDate('10-13-1990'), false);
    assert.equal(validDate('invalid-text'), false);
  });
});
