'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

function loadDolRebuildEnv(driveRecords) {
  const storage = new Map();
  const timers = [];
  const els = {};
  const document = {
    readyState: 'loading',
    head: { appendChild() {} },
    body: { appendChild() {} },
    getElementById(id) { return els[id] || null; },
    querySelector() { return null; },
    createElement(tag) {
      return {
        tagName: tag.toUpperCase(),
        id: '', className: '', innerHTML: '', textContent: '', style: {},
        appendChild() {}, addEventListener() {}, setAttribute() {}, remove() {}
      };
    },
    addEventListener() {}
  };
  const win = {
    document,
    console,
    setTimeout: (fn, ms) => { const t = setTimeout(fn, ms); timers.push(t); return t; },
    clearTimeout,
    URL,
    Blob,
    Uint8Array,
    ArrayBuffer,
    Promise,
    Date,
    Math,
    JSON,
    Set,
    Map,
    Array,
    Object,
    String,
    Number,
    RegExp,
    Error,
    localStorage: {
      getItem: k => storage.has(k) ? storage.get(k) : null,
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: k => storage.delete(k)
    },
    ATPLDriveHrDolSync: {
      listDolRecords: async (type) => ({
        ok: true,
        mode: 'drive-sheets',
        records: (driveRecords || []).filter(r => r.type === type),
        tombstones: {},
        remoteCount: (driveRecords || []).filter(r => r.type === type).length
      }),
      dolIsTombstoned: () => false
    }
  };
  win.window = win;
  win.self = win;
  const code = fs.readFileSync(path.join(ROOT, 'compliance-dol-rebuild-v2.js'), 'utf8');
  vm.runInContext(code, vm.createContext(win), { filename: 'compliance-dol-rebuild-v2.js' });
  return { win, els, cleanup: () => timers.forEach(t => clearTimeout(t)) };
}

test('localRecordFromCloud preserves Drive ids, hash, driveFileName and sets parseStatus=ready', () => {
  const env = loadDolRebuildEnv([]);
  const h = env.win.ATPLComplianceDOLV2._helpers;
  const driveRec = {
    id: 'v2_pf_238571af2123c57b439c2517',
    type: 'pf',
    name: 'ECR Statement March 2026 (1).pdf',
    hash: '238571af2123c57b439c2517a3cf50c3',
    period: '2026-03',
    ids: ['101969061723', '101234567890'],
    parseStatus: 'error',
    parseError: 'Cloud index has no IDs',
    driveFileName: 'atpl_dol_orig_pf_238571af2123c57b439c2517a3cf50c3.json',
    hasOriginalFile: true
  };
  const local = h.localRecordFromCloud(driveRec);
  assert.equal(local.ids.length, 2);
  assert.ok(local.ids.includes('101969061723'));
  assert.equal(local.parseStatus, 'ready');
  assert.equal(local.parseError, '');
  assert.equal(local.hash, '238571af2123c57b439c2517a3cf50c3');
  assert.equal(local.driveFileName, driveRec.driveFileName);
  env.cleanup();
});

test('inferPeriod detects EPFO Wage Month JUN-2026 and ignores DD-MM-YYYY payment date', () => {
  const env = loadDolRebuildEnv([]);
  const h = env.win.ATPLComplianceDOLV2._helpers;

  const p1 = h.inferPeriod('ECR Statement June 2026.pdf', '');
  assert.equal(p1.period, '2026-06');

  const p2 = h.inferPeriod('TRRN_2607123456.pdf', 'Payment Date: 10-07-2026  Wage Month : JUN-2026  Est ID: RJJOD0008966000');
  assert.equal(p2.period, '2026-06');
  assert.equal(p2.source, 'document');

  const p3 = h.inferPeriod('ECR_10-07-2026.pdf', 'EPFO ECR Return Month: 06-2026');
  assert.equal(p3.period, '2026-06');
  env.cleanup();
});

test('missingMonthsBetween flags Apr/May/Jun 2026 missing between Mar 2026 and Jul-Sep 2026', () => {
  const env = loadDolRebuildEnv([]);
  const h = env.win.ATPLComplianceDOLV2._helpers;
  const missing = h.missingMonthsBetween('2026-03', ['2026-01', '2026-02', '2026-03', '2026-07', '2026-08', '2026-09']);
  assert.deepEqual(Array.from(missing), ['2026-04', '2026-05', '2026-06']);

  const noneMissing = h.missingMonthsBetween('2026-06', ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09']);
  assert.deepEqual(Array.from(noneMissing), []);
  env.cleanup();
});

test('searchAsync warns when Apr/May/Jun 2026 are missing and resolves accurate Jun 2026 once uploaded', async () => {
  const uan = '101969061723';
  const baseRecords = [
    { id: 'pf_2601', cloudRecordId: 'pf_2601', type: 'pf', name: 'ECR Statement Jan 2026.pdf', period: '2026-01', ids: [uan] },
    { id: 'pf_2602', cloudRecordId: 'pf_2602', type: 'pf', name: 'ECR Statement Feb 2026.pdf', period: '2026-02', ids: [uan] },
    { id: 'pf_2603', cloudRecordId: 'pf_2603', type: 'pf', name: 'ECR Statement March 2026.pdf', period: '2026-03', ids: [uan] },
    { id: 'pf_2607', cloudRecordId: 'pf_2607', type: 'pf', name: 'ECR Statement July 2026.pdf', period: '2026-07', ids: ['101000000001'] },
    { id: 'pf_2608', cloudRecordId: 'pf_2608', type: 'pf', name: 'ECR Statement Aug 2026.pdf', period: '2026-08', ids: ['101000000001'] },
    { id: 'pf_2609', cloudRecordId: 'pf_2609', type: 'pf', name: 'ECR Statement Sept 2026.pdf', period: '2026-09', ids: ['101000000001'] }
  ];

  // Case 1: Apr, May, Jun 2026 missing -> must NOT show green verified Mar 2026; must warn about Apr/May/Jun 2026
  const env1 = loadDolRebuildEnv(baseRecords);
  const box1 = { innerHTML: '' };
  await env1.win.ATPLComplianceDOLV2._helpers.searchAsync('pf', [uan], box1);
  assert.ok(box1.innerHTML.includes('Unverified'), 'Must mark Mar 2026 as Unverified when Apr-Jun 2026 challans are missing');
  assert.ok(!box1.innerHTML.includes('cd2-last'), 'Must not render green verified DOL badge when intermediate months are missing');
  assert.ok(box1.innerHTML.includes('Apr 2026') && box1.innerHTML.includes('May 2026') && box1.innerHTML.includes('Jun 2026'), 'Must list all missing months Apr/May/Jun 2026');
  env1.cleanup();

  // Case 2: Apr, May, Jun 2026 uploaded with UAN 101969061723 -> must resolve accurate green verified Jun 2026
  const fullRecords = baseRecords.concat([
    { id: 'pf_2604', cloudRecordId: 'pf_2604', type: 'pf', name: 'ECR Statement April 2026.pdf', period: '2026-04', ids: [uan] },
    { id: 'pf_2605', cloudRecordId: 'pf_2605', type: 'pf', name: 'ECR Statement May 2026.pdf', period: '2026-05', ids: [uan] },
    { id: 'pf_2606', cloudRecordId: 'pf_2606', type: 'pf', name: 'ECR Statement June 2026.pdf', period: '2026-06', ids: [uan] }
  ]);
  const env2 = loadDolRebuildEnv(fullRecords);
  const box2 = { innerHTML: '' };
  await env2.win.ATPLComplianceDOLV2._helpers.searchAsync('pf', [uan], box2);
  assert.ok(box2.innerHTML.includes('cd2-last'), 'Must render green verified DOL badge when all consecutive months are present');
  assert.ok(box2.innerHTML.includes('Jun 2026'), 'Must accurately report Jun 2026 as DOL');
  assert.ok(!box2.innerHTML.includes('Unverified'), 'Must not warn when no months are missing after Jun 2026');
  env2.cleanup();
});

test('Drive sync heals poisoned parseStatus=error when ids exist and guards vault against transient read error', async () => {
  const storage = new Map();
  const timers = [];
  let failDownload = false;
  const win = {
    console, Buffer, Set, TextDecoder, atob, btoa,
    setTimeout: (fn, ms) => { const t = setTimeout(fn, ms); timers.push(t); return t; },
    clearTimeout, Date, Math, JSON, Array, Object, String, Number, Promise, Error,
    localStorage: {
      getItem: k => storage.has(k) ? storage.get(k) : null,
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: k => storage.delete(k)
    },
    fetch: async (_url, opts) => {
      const body = JSON.parse(opts.body);
      if (body.action === 'downloadFile') {
        if (failDownload) return { ok: false, status: 503, text: async () => '' };
        const vault = {
          version: 1,
          type: 'pf',
          records: [{
            id: 'v2_pf_poison',
            type: 'pf',
            name: 'ECR Statement March 2026.pdf',
            hash: 'abc123',
            period: '2026-03',
            ids: ['101969061723'],
            parseStatus: 'error',
            parseError: 'Cloud index has no IDs'
          }],
          tombstones: {}
        };
        return {
          ok: true,
          text: async () => JSON.stringify({ ok: true, fileBase64: Buffer.from(JSON.stringify(vault)).toString('base64') })
        };
      }
      return { ok: true, text: async () => JSON.stringify({ ok: true }) };
    }
  };
  win.window = win;
  const code = fs.readFileSync(path.join(ROOT, 'atpl-drive-hr-dol-sync-v1.js'), 'utf8');
  vm.runInContext(code, vm.createContext(win), { filename: 'atpl-drive-hr-dol-sync-v1.js' });

  const listRes = await win.ATPLDriveHrDolSync.listDolRecords('pf', []);
  assert.equal(listRes.ok, true);
  assert.equal(listRes.records.length, 1);
  assert.equal(listRes.records[0].parseStatus, 'ready');
  assert.equal(listRes.records[0].parseError, '');

  failDownload = true;
  await assert.rejects(
    () => win.ATPLDriveHrDolSync.uploadDolRecord({ id: 'v2_pf_new', type: 'pf', name: 'ECR June 2026.pdf', hash: 'def456', period: '2026-06', ids: ['101969061723'] }, null),
    /Vault read failed before save/
  );
  timers.forEach(t => clearTimeout(t));
});
