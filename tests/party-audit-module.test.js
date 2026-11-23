const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const moduleSrc = fs.readFileSync(path.join(ROOT, 'atpl-party-audit-v1.js'), 'utf8');
const htmlSrc = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const serverSrc = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const guardSrc = fs.readFileSync(path.join(ROOT, 'erp-permission-guard-v1.js'), 'utf8');

function createStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(String(k), String(v)); },
    removeItem: (k) => { map.delete(k); },
    clear: () => map.clear()
  };
}

function createBrowserEnv(driveStore) {
  const localStorage = createStorage();
  const sessionStorage = createStorage();
  const container = { innerHTML: '', id: 'partyAuditContainer' };
  const badge = { textContent: '0', style: {} };
  const syncLine = { textContent: '' };
  const syncBtn = { disabled: false, textContent: 'Sync Google Drive' };
  const docListeners = {};
  const elsById = {
    partyAuditContainer: container,
    partyAuditBadge: badge,
    paSyncStatusLine: syncLine,
    paSyncBtn: syncBtn
  };

  const mockDocument = {
    readyState: 'complete',
    hidden: false,
    head: { appendChild: () => {} },
    body: { appendChild: () => {} },
    documentElement: { appendChild: () => {} },
    createElement: (tag) => ({ tagName: tag, style: {}, classList: { add() {}, remove() {} }, setAttribute() {} }),
    getElementById: (id) => elsById[id] || null,
    addEventListener: (ev, fn) => {
      if (!docListeners[ev]) docListeners[ev] = [];
      docListeners[ev].push(fn);
    }
  };

  const fetchMock = async (url, opts) => {
    const u = String(url || '');
    if (u.includes('script.google.com')) {
      const body = JSON.parse(opts && opts.body ? opts.body : '{}');
      if (body.action === 'uploadFile') {
        const jsonStr = Buffer.from(body.fileBase64, 'base64').toString('utf8');
        driveStore.set(body.fileName, jsonStr);
        return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, fileName: body.fileName }) };
      }
      if (body.action === 'downloadFile') {
        if (!driveStore.has(body.fileName)) {
          return { ok: true, status: 200, text: async () => JSON.stringify({ ok: false, error: 'File not found' }) };
        }
        const b64 = Buffer.from(driveStore.get(body.fileName), 'utf8').toString('base64');
        return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, fileBase64: b64 }) };
      }
      if (body.action === 'deleteFile') {
        driveStore.delete(body.fileName);
        return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true }) };
      }
    }
    return { ok: false, status: 404, json: async () => ({ ok: false }), text: async () => '{}' };
  };

  const win = {
    location: { hostname: 'nikhilatpl2026-jpg.github.io', protocol: 'https:' },
    localStorage,
    sessionStorage,
    document: mockDocument,
    fetch: fetchMock,
    Buffer,
    Blob: class FakeBlob { constructor(parts) { this.parts = parts; } },
    FILES: [
      { name: 'Salary_Nov_2026.xlsx', size: 12000 },
      { name: 'ATPL_PARTY_AUDIT_VAULT_V1.json', size: 100 },
      { name: 'atpl_party_audit_att_PA_RWS_1.json', size: 200 }
    ],
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    clearInterval: () => {},
    addEventListener: () => {}
  };
  win.window = win;
  win.globalThis = win;

  vm.createContext(win);
  vm.runInContext(moduleSrc, win);
  return { win, container, badge, driveStore };
}

test('HTML, permission guard, and server wiring for Party Audit', () => {
  assert.ok(htmlSrc.includes('id="vn-partyaudit"'), 'sidebar vn-partyaudit missing');
  assert.ok(htmlSrc.includes('id="page-partyaudit"'), 'page-partyaudit container missing');
  assert.ok(htmlSrc.includes("'partyaudit':'cat-emp'"), 'catMap missing partyaudit');
  assert.ok(htmlSrc.includes("if(name==='partyaudit')"), 'goPage missing partyaudit hook');
  assert.ok(htmlSrc.includes('atpl-party-audit-v1.js'), 'script tag missing in index.html');
  assert.ok(htmlSrc.includes('window.ATPLPartyAudit'), 'cross-sync hook missing in index.html');
  assert.ok(guardSrc.includes('partyaudit:1'), 'permission guard MASTER_READ missing partyaudit');
  assert.ok(serverSrc.includes("'/api/sync/party-audits'"), 'server GET party-audits route missing');
  assert.ok(serverSrc.includes("'/api/sync/party-audits/bulk'"), 'server POST bulk route missing');
  assert.ok(serverSrc.includes("'/api/sync/party-audit-att/:id'"), 'server GET attachment route missing');
  assert.ok(serverSrc.includes("'/api/sync/party-audit/:id'"), 'server DELETE route missing');
});

test('Pre-seeds RWS, MWS, and Inditex party audit buttons and strips vault files from window.FILES', () => {
  const drive = new Map();
  const { win, container } = createBrowserEnv(drive);
  const st = win.ATPLPartyAudit.getState();
  const ids = st.parties.map(p => p.id);
  assert.ok(ids.includes('RWS'));
  assert.ok(ids.includes('MWS'));
  assert.ok(ids.includes('INDITEX'));
  assert.ok(container.innerHTML.includes('RWS'));
  assert.ok(container.innerHTML.includes('MWS'));
  assert.ok(container.innerHTML.includes('Inditex'));
  assert.deepEqual(win.FILES.map(f => f.name), ['Salary_Nov_2026.xlsx']);
});

test('Google Drive round-trip sync across two browsers (custom party, document upload, attachment hydration, tombstone delete)', async () => {
  const sharedDrive = new Map();
  const browserA = createBrowserEnv(sharedDrive);
  const browserB = createBrowserEnv(sharedDrive);

  // Browser A creates custom party H&M
  await browserA.win.ATPLPartyAudit.savePartyAndSync({
    name: 'H&M',
    fullName: 'H&M Sustainability & Social Audit',
    scope: 'HIGG & SIPP compliance',
    checklist: [{ title: 'H&M Wage Ledger', category: 'Statutory & Payroll' }]
  });

  // Browser A uploads an audit document under Inditex with attachment bytes
  const sampleB64 = 'data:application/pdf;base64,' + Buffer.from('%PDF-1.4 Test Audit Document').toString('base64');
  await browserA.win.ATPLPartyAudit.saveDocAndSync({
    id: 'PA_INDITEX_101',
    partyId: 'INDITEX',
    partyName: 'Inditex',
    title: 'Inditex Code of Conduct Compliance 2026',
    category: 'Buyer Policy & COC',
    refNo: 'IND-COC-2026',
    status: 'ready',
    file_name: 'Inditex_COC_2026.pdf',
    file_type: 'application/pdf',
    file_size: 28,
    file_data: sampleB64,
    files: [{ name: 'Inditex_COC_2026.pdf', type: 'application/pdf', size: 28, data: sampleB64 }]
  }, true);

  // Verify Drive vault stays lightweight (no inline file_data) while attachment file has bytes
  assert.ok(sharedDrive.has('ATPL_PARTY_AUDIT_VAULT_V1.json'));
  assert.ok(sharedDrive.has('atpl_party_audit_att_PA_INDITEX_101.json'));
  const vaultJson = JSON.parse(sharedDrive.get('ATPL_PARTY_AUDIT_VAULT_V1.json'));
  const vaultDoc = vaultJson.docs.find(d => d.id === 'PA_INDITEX_101');
  assert.ok(vaultDoc);
  assert.equal(vaultDoc.file_data, undefined, 'Vault metadata should omit inline base64');
  assert.equal(vaultDoc.has_attachment, true);

  // Browser B syncs from Google Drive
  const syncResB = await browserB.win.ATPLPartyAudit.syncNow(false);
  assert.equal(syncResB.ok, true);
  const stB = browserB.win.ATPLPartyAudit.getState();
  assert.ok(stB.parties.some(p => p.name === 'H&M'), 'Browser B should receive custom party H&M');
  const syncedDocB = stB.docs.find(d => d.id === 'PA_INDITEX_101');
  assert.ok(syncedDocB, 'Browser B should receive Inditex document');
  assert.equal(syncedDocB.refNo, 'IND-COC-2026');

  // Browser B hydrates attachment bytes lazily from Drive
  const attB = await browserB.win.ATPLPartyAudit.hydrateAttachment(syncedDocB);
  assert.ok(attB && attB.file_data === sampleB64, 'Browser B should download attachment bytes from Google Drive');

  // Browser A deletes document -> tombstone stops resurrection in Browser B
  await browserA.win.ATPLPartyAudit.deleteDocAndSync('PA_INDITEX_101');
  assert.equal(sharedDrive.has('atpl_party_audit_att_PA_INDITEX_101.json'), false, 'Attachment should be deleted from Drive');

  await browserB.win.ATPLPartyAudit.syncNow(false);
  assert.equal(
    browserB.win.ATPLPartyAudit.getState().docs.some(d => d.id === 'PA_INDITEX_101'),
    false,
    'Deleted doc must not resurrect on Browser B sync'
  );
});
