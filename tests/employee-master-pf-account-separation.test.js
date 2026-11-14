const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('all modified JS files and inline scripts in index.html have valid syntax', () => {
  const jsFiles = [
    'server.js',
    'atpl-employee-master-realtime-engine.js',
    'atpl-google-drive-sync.js',
    'erp-cloud-sync-v1.js',
    'employee-master-confirmed-save-v1.js'
  ];
  jsFiles.forEach((file) => {
    assert.doesNotThrow(() => new vm.Script(read(file), { filename: file }), `${file} must parse cleanly`);
  });

  const html = read('index.html');
  const scriptRe = /<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  let count = 0;
  while ((m = scriptRe.exec(html)) !== null) {
    count++;
    assert.doesNotThrow(
      () => new vm.Script(m[1], { filename: `index.html#script-${count}` }),
      `index.html inline script #${count} must parse cleanly`
    );
  }
  assert.ok(count > 0, 'index.html should contain inline scripts');
});

test('matchColumnHeader prevents P.F. A/C No and ESI A/C No from mapping to account_no', () => {
  const html = read('index.html');
  const startIdx = html.indexOf('function matchColumnHeader(header, counts)');
  const endIdx = html.indexOf('window.matchColumnHeader = matchColumnHeader;', startIdx);
  assert.ok(startIdx > 0 && endIdx > startIdx, 'matchColumnHeader should exist in index.html');
  const fnCode = html.slice(startIdx, endIdx);
  const matchColumnHeader = new Function(`return (${fnCode})`)();

  assert.equal(matchColumnHeader('P.F. A/C No', { district: 0, state: 0, gross: 0 }), 'pf_no');
  assert.equal(matchColumnHeader('PF Account No', { district: 0, state: 0, gross: 0 }), 'pf_no');
  assert.equal(matchColumnHeader('PF NO', { district: 0, state: 0, gross: 0 }), 'pf_no');
  assert.equal(matchColumnHeader('UAN Number', { district: 0, state: 0, gross: 0 }), 'pf_no');
  assert.equal(matchColumnHeader('ESI A/C No', { district: 0, state: 0, gross: 0 }), 'esi_no');
  assert.equal(matchColumnHeader('Account No', { district: 0, state: 0, gross: 0 }), 'account_no');
  assert.equal(matchColumnHeader('Bank A/C No', { district: 0, state: 0, gross: 0 }), 'account_no');
});

test('aroraMapHeaders maps PF/ESI/Bank Account columns exclusively with zero collisions', () => {
  const html = read('index.html');
  const aliasesStart = html.indexOf('var ARORA_IMPORT_ALIASES = {');
  const normStart = html.indexOf('function aroraNormHeader(v){');
  const mapStart = html.indexOf('function aroraMapHeaders(header){');
  const mapEnd = html.indexOf('function aroraRowsToEmployees(', mapStart);
  assert.ok(aliasesStart > 0 && normStart > 0 && mapStart > 0 && mapEnd > mapStart);

  const snippet = [
    html.slice(aliasesStart, html.indexOf('};', aliasesStart) + 2),
    html.slice(normStart, html.indexOf('\n}\n', normStart) + 3),
    html.slice(mapStart, mapEnd)
  ].join('\n');

  const aroraMapHeaders = new Function(`${snippet}\nreturn aroraMapHeaders;`)();

  const map1 = aroraMapHeaders(['Employee Code', 'Employee Name', 'Account No', 'PF NO', 'ESI No']);
  assert.equal(map1.account_no, 2, 'Account No maps to col 2');
  assert.equal(map1.pf_no, 3, 'PF NO maps to col 3');
  assert.equal(map1.esi_no, 4, 'ESI No maps to col 4');
  assert.notEqual(map1.pf_no, map1.account_no, 'pf_no and account_no must never share column index');

  const map2 = aroraMapHeaders(['Emp Code', 'PF Account No', 'Bank Account No', 'IFSC Code']);
  assert.equal(map2.pf_no, 1, 'PF Account No maps to col 1');
  assert.equal(map2.account_no, 2, 'Bank Account No maps to col 2');
  assert.equal(map2.ifsc, 3, 'IFSC Code maps to col 3');
});

test('atplSanitizeEmployeePfAccount and auditAndCleanEmployee handle UAN, IPPB, swapped, Aadhaar, and Airtel Payments Bank cases', () => {
  const html = read('index.html');
  const sanStart = html.indexOf('function atplSanitizeEmployeePfAccount(emp, seedMapOverride)');
  const sanEnd = html.indexOf("if (typeof window !== 'undefined')", sanStart);
  assert.ok(sanStart > 0 && sanEnd > sanStart, 'atplSanitizeEmployeePfAccount must exist in index.html');
  const sanCode = html.slice(sanStart, sanEnd);

  const audStart = html.indexOf('function auditAndCleanEmployee(emp, rawCols)');
  const audEnd = html.indexOf('window.auditAndCleanEmployee = auditAndCleanEmployee;', audStart);
  assert.ok(audStart > 0 && audEnd > audStart, 'auditAndCleanEmployee must exist in index.html');
  const audCode = html.slice(audStart, audEnd);

  const cleanIfsc = (x) => String(x || '').toUpperCase().trim();
  const cleanAccountNo = (x) => String(x || '').replace(/\D/g, '');
  const emNormalizeDateValue = (x) => String(x || '');

  const sandbox = {
    window: { __ATPL_SEED_EMP_MAP__: { '26135': { pf_no: '101479071121', esi_no: '', account_no: '9574193492' } } },
    cleanIfsc,
    cleanAccountNo,
    emNormalizeDateValue
  };
  vm.createContext(sandbox);
  vm.runInContext(
    sanCode + '\nwindow.atplSanitizeEmployeePfAccount = atplSanitizeEmployeePfAccount;\nvar atplSanitizeEmployeePfAccount = window.atplSanitizeEmployeePfAccount;\n' + audCode,
    sandbox
  );

  // 1. 12-digit UAN + 12-digit IPPB Bank A/C must both stay separate
  const ippbEmp = sandbox.auditAndCleanEmployee({
    emp_id: '25913',
    name: 'TEST IPPB',
    pf_no: '101448947322',
    account_no: '045010161276',
    ifsc: 'IPOS0000001'
  });
  assert.equal(ippbEmp.pf_no, '101448947322');
  assert.equal(ippbEmp.account_no, '045010161276');

  // 2. Swapped pair (SBI A/C in pf_no, UAN in account_no) must swap back cleanly
  const swapped = sandbox.window.atplSanitizeEmployeePfAccount({
    emp_id: '26414',
    pf_no: '110021690968',
    account_no: '101751490810',
    ifsc: 'CNRB0005298'
  });
  assert.equal(swapped.pf_no, '101751490810');
  assert.equal(swapped.account_no, '110021690968');

  // 3. Airtel Payments Bank mobile account_no preserved while colliding pf_no restored from seed
  const airtel = sandbox.window.atplSanitizeEmployeePfAccount({
    emp_id: '26135',
    pf_no: '9574193492',
    account_no: '9574193492',
    phone_no: '9574193492',
    ifsc: 'AIRP0000001',
    bank_name: 'AIRTEL PAYMENTS BANK'
  });
  assert.equal(airtel.account_no, '9574193492');
  assert.equal(airtel.pf_no, '101479071121');

  // 4. Aadhaar leaked into account_no + Bank A/C leaked into pf_no gets repaired
  const aadLeak = sandbox.window.atplSanitizeEmployeePfAccount({
    emp_id: '26507',
    pf_no: '42031944281',
    account_no: '361326811379',
    aadhaar_no: '3613 2681 1379',
    ifsc: 'SBIN0031725'
  });
  assert.equal(aadLeak.account_no, '42031944281');
  assert.equal(aadLeak.pf_no, 'NA');
});

test('realtime engine sanitizes stale PF/Account collisions while preserving status/DOL/salary/bank cross-browser sync', () => {
  const code = read('atpl-employee-master-realtime-engine.js');
  const storage = {};
  const sandbox = {
    window: null,
    self: null,
    globalThis: null,
    EM: {
      data: [{
        emp_id: '00530',
        name: 'TEST EMP',
        pf_no: '33811674907',
        account_no: '33811674907',
        ifsc: 'SBIN0003401',
        bank_name: 'STATE BANK OF INDIA',
        status: 'ACTIVE',
        dol: '',
        _status_updated_at: 1000,
        _em_updated_at: 1000
      }]
    },
    localStorage: {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(storage, k) ? storage[k] : null),
      setItem: (k, v) => { storage[k] = String(v); },
      removeItem: (k) => { delete storage[k]; }
    },
    document: { readyState: 'loading', addEventListener: () => {} },
    fetch: () => Promise.resolve({ ok: true, json: async () => ({ ok: true }) }),
    BroadcastChannel: function () { return { postMessage: () => {}, addEventListener: () => {}, close: () => {} }; },
    EventSource: undefined,
    console: { log: () => {}, warn: () => {}, error: () => {} },
    setTimeout: () => 0,
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {}
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.window.__ATPL_SEED_EMP_MAP__ = { '530': { pf_no: '100933145683', account_no: '33811674907' } };

  vm.runInNewContext(code, sandbox);
  const engine = sandbox.ATPLEmployeeMasterRealtimeEngine;
  assert.ok(engine && typeof engine.reconcileExternalRecords === 'function');

  // Remote updates status to LEFT + DOL + salary while still carrying stale colliding PF=AC='33811674907'
  const remote = [{
    emp_id: '00530',
    name: 'TEST EMP',
    pf_no: '33811674907',
    account_no: '33811674907',
    ifsc: 'SBIN0003401',
    bank_name: 'STATE BANK OF INDIA',
    basic: 22000,
    status: 'LEFT',
    dol: '15-10-2026',
    _status_updated_at: 2000,
    _em_updated_at: 2000
  }];

  engine.reconcileExternalRecords(remote, true);
  const merged = sandbox.EM.data.find((x) => x.emp_id === '00530');
  assert.ok(merged, 'Merged employee record should remain in EM.data');
  assert.equal(merged.status, 'LEFT', 'Status update from remote must sync cleanly');
  assert.equal(merged.dol, '15-10-2026', 'DOL update from remote must sync cleanly');
  assert.equal(merged.basic, 22000, 'Basic update from remote must sync cleanly');
  assert.equal(merged.account_no, '33811674907', 'Bank account must be preserved');
  assert.equal(merged.pf_no, '100933145683', 'Colliding pf_no must be repaired from seed during sync merge');
});

test('confirmedSingleSave blocks saving when non-empty pf_no equals account_no', () => {
  const js = read('employee-master-confirmed-save-v1.js');
  assert.ok(
    js.includes("if(pfNorm && pfNorm!=='NA' && acNorm && pfNorm===acNorm)"),
    'employee-master-confirmed-save-v1.js must validate and block identical PF and Account numbers on save'
  );
});

test('data/employee_master.json has zero PF/Account collisions and preserves verified records', () => {
  const data = JSON.parse(read('data/employee_master.json'));
  assert.equal(data.length, 561, 'Expected all 561 employees in data/employee_master.json');

  const collisions = data.filter((r) => r.pf_no && r.pf_no !== 'NA' && r.pf_no === r.account_no);
  assert.equal(collisions.length, 0, 'Zero employees should have identical PF No and Account No');

  const aadInAc = data.filter((r) => {
    const ac = String(r.account_no || '').replace(/\D/g, '');
    const aad = String(r.aadhaar_no || '').replace(/\D/g, '');
    return ac && aad && ac === aad;
  });
  assert.equal(aadInAc.length, 0, 'Zero employees should have Aadhaar inside account_no');

  const ifscInPf = data.filter((r) => /^[A-Z]{4}0[A-Z0-9]{6}$/.test(String(r.pf_no || '').toUpperCase()));
  assert.equal(ifscInPf.length, 0, 'Zero employees should have IFSC inside pf_no');

  const phoneInNonPayAc = data.filter((r) => {
    const ifsc = String(r.ifsc || '').toUpperCase();
    const bank = String(r.bank_name || '').toUpperCase();
    const isPayBank = /^AIRP/.test(ifsc) || /AIRTEL/.test(bank) || /^PYTM/.test(ifsc) || /^JIOP/.test(ifsc);
    const ph = String(r.phone_no || '').replace(/\D/g, '');
    const ac = String(r.account_no || '').replace(/\D/g, '');
    return !isPayBank && ph && ac && ph === ac;
  });
  assert.equal(phoneInNonPayAc.length, 0, 'Zero non-Payments-Bank employees should have phone inside account_no');

  const findEmp = (id) => data.find((r) => String(r.emp_id).replace(/^0+/, '') === id.replace(/^0+/, ''));
  assert.equal(findEmp('00530').account_no, '33811674907');
  assert.equal(findEmp('00530').pf_no, '100933145683');
  assert.equal(findEmp('25913').pf_no, '101448947322');
  assert.equal(findEmp('25913').account_no, '045010161276');
  assert.equal(findEmp('26414').pf_no, '101751490810');
  assert.equal(findEmp('26414').account_no, '110021690968');
  assert.equal(findEmp('26507').account_no, '42031944281');
  assert.equal(findEmp('26507').pf_no, 'NA');
  assert.equal(findEmp('25940').account_no, '7481817875');
  assert.equal(findEmp('26135').account_no, '9574193492');
  assert.equal(findEmp('26135').pf_no, '101479071121');
  assert.equal(findEmp('25699').pf_no, 'NA');
  assert.equal(findEmp('25699').account_no, '61263225454');
});
