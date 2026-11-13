const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('Service History Module - PF No, ESIC No, Monthly Deductions & UI Upgrade', async (t) => {
  const rootDir = path.resolve(__dirname, '..');
  const shCode = fs.readFileSync(path.join(rootDir, 'service-history-v1.js'), 'utf8');

  function makeDomCtx(masterList, filesList) {
    const ids = {};
    const headChildren = [];
    const navChildren = [];
    const containerChildren = [];

    function makeNode(tag, id) {
      return {
        tagName: tag,
        id: id || '',
        className: '',
        innerHTML: '',
        textContent: '',
        value: '',
        style: {},
        children: [],
        appendChild(el) {
          this.children.push(el);
          if (el.id) ids[el.id] = el;
          if (el.innerHTML && el.innerHTML.includes('atpl-sh-results')) {
            for (const nestedId of ['atpl-sh-code', 'atpl-sh-search', 'atpl-sh-notice', 'atpl-sh-results', 'atpl-sh-suggest', 'atpl-sh-back']) {
              ids[nestedId] = makeNode('div', nestedId);
            }
          }
          return el;
        },
        querySelector() { return null; },
        querySelectorAll() { return []; },
        getAttribute() { return null; }
      };
    }

    const pageSync = makeNode('div', 'page-sync');
    const parentBox = {
      appendChild(el) {
        containerChildren.push(el);
        if (el.id) ids[el.id] = el;
        if (el.innerHTML && el.innerHTML.includes('atpl-sh-results')) {
          for (const nestedId of ['atpl-sh-code', 'atpl-sh-search', 'atpl-sh-notice', 'atpl-sh-results', 'atpl-sh-suggest', 'atpl-sh-back']) {
            ids[nestedId] = makeNode('div', nestedId);
          }
        }
      }
    };
    pageSync.parentNode = parentBox;
    ids['page-sync'] = pageSync;

    const vnEmp = makeNode('div', 'vn-empmaster');
    vnEmp.parentNode = {
      appendChild(el) {
        navChildren.push(el);
        if (el.id) ids[el.id] = el;
      }
    };
    ids['vn-empmaster'] = vnEmp;

    const mockWindow = {
      localStorage: { getItem: () => null, setItem: () => {} },
      sessionStorage: { getItem: () => null },
      document: {
        readyState: 'complete',
        head: { appendChild: (el) => { headChildren.push(el); if (el.id) ids[el.id] = el; } },
        body: { appendChild: () => {} },
        createElement: (tag) => makeNode(tag, ''),
        getElementById: (id) => ids[id] || null,
        querySelector: () => null,
        addEventListener: () => {}
      },
      EM: { data: masterList || [] },
      FILES: filesList || [],
      goPage: () => {},
      showToast: () => {}
    };
    mockWindow.window = mockWindow;
    return { mockWindow, ids, headChildren, navChildren };
  }

  await t.test('1. Extracts PF No & ESIC No from Employee Master and PF@12% / ESIC@0.75% across 2025 + 2026 sheets', () => {
    const master = [
      {
        emp_id: '25924',
        name: 'Ram Kumar Sharma',
        father: 'Mohan Lal',
        dept: 'Spinning',
        desig: 'Senior Operator',
        doj: '2023-04-01',
        pf_no: '101456789012',
        esi_no: '3112345678',
        gross: 24000,
        basic: 15000
      }
    ];
    const files = [
      {
        name: 'Salary_Jun_2025.xlsx',
        sheets: {
          'Fourmala Sheet': [
            ['Emp Code', 'Employee Name', 'Gross', 'Basic', 'PF@12%', 'ESIC @0.75%', 'Manual Amount', 'Net Payable'],
            ['25924', 'Ram Kumar Sharma', '22000', '14000', '1680', '165', '20155', '20155']
          ]
        }
      },
      {
        name: 'Final Salary March 2026.xlsx',
        sheets: {
          'Formula Sheet': [
            ['Emp Code', 'Employee Name', 'Gross Salary', 'Basic Salary', 'Employee PF', 'Employee ESIC', 'Manual Amount', 'Net Payable'],
            ['25924', 'Ram Kumar Sharma', '24000', '15000', '1800', '180', '22020', '22020']
          ]
        }
      }
    ];

    const { mockWindow, ids } = makeDomCtx(master, files);
    const ctx = vm.createContext(mockWindow);
    vm.runInContext(shCode, ctx);

    const res = mockWindow.ATPLServiceHistoryV1.scan('25924');
    assert.equal(res.profile.name, 'Ram Kumar Sharma');
    assert.equal(res.profile.pfNo, '101456789012');
    assert.equal(res.profile.esicNo, '3112345678');
    assert.equal(res.profile.pfNoSource, 'Employee Master');
    assert.equal(res.profile.esicNoSource, 'Employee Master');
    assert.equal(res.totals.monthsFound, 2);
    assert.equal(res.totals.pfTotal, 3480);
    assert.equal(res.totals.pfMonths, 2);
    assert.equal(res.totals.esicTotal, 345);
    assert.equal(res.totals.esicMonths, 2);
    assert.equal(res.totals.manualTotal, 42175);

    // Search via Employee Name triggers UI render with PF No, ESIC No & totals
    ids['atpl-sh-code'].value = 'Ram Kumar Sharma';
    ids['atpl-sh-search'].onclick();
    const html = ids['atpl-sh-results'].innerHTML;
    assert(html.includes('101456789012'), 'Rendered UI must display PF / UAN Number');
    assert(html.includes('3112345678'), 'Rendered UI must display ESIC / IP Number');
    assert(html.includes('3,480'), 'Rendered UI must display Total PF Deducted');
    assert(html.includes('345'), 'Rendered UI must display Total ESIC Deducted');
    assert(html.includes('June 2025'), 'Rendered UI must include 2025 historical salary month');
    assert(html.includes('March 2026'), 'Rendered UI must include 2026 salary month');
  });

  await t.test('2. Falls back to Salary Sheet PF No / ESIC No if Employee Master has blank statutory IDs', () => {
    const files = [
      {
        name: 'Salary_Feb_2026.xlsx',
        sheets: {
          'Main Sheet': [
            ['Emp Code', 'Employee Name', 'PF No', 'ESIC No', 'EPF 12%', 'ESI 0.75%', 'Manual Amount', 'Net Pay'],
            ['901', 'Suresh Singh', '101999888777', '3198765432', '1440', '135', '16425', '16425']
          ]
        }
      }
    ];
    const { mockWindow } = makeDomCtx([], files);
    const ctx = vm.createContext(mockWindow);
    vm.runInContext(shCode, ctx);

    const res = mockWindow.ATPLServiceHistoryV1.scan('901');
    assert.equal(res.profile.name, 'Suresh Singh');
    assert.equal(res.profile.pfNo, '101999888777');
    assert.equal(res.profile.esicNo, '3198765432');
    assert.equal(res.profile.pfNoSource, 'Salary Sheet');
    assert.equal(res.profile.esicNoSource, 'Salary Sheet');
    assert.equal(res.totals.pfTotal, 1440);
    assert.equal(res.totals.esicTotal, 135);
  });
});
