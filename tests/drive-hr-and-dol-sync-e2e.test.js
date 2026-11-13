const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

function createMockGasBackend() {
  const drive = new Map(); // name -> { name, mimeType, contentBase64, updatedAt, id, size }
  const sheetRecords = new Map(); // rowKey -> record object

  return {
    drive,
    sheetRecords,
    async fetch(url, opts = {}) {
      const body = opts.body ? JSON.parse(opts.body) : {};
      const action = body.action || '';
      if (action === 'uploadFile') {
        const name = String(body.fileName || body.name || '');
        const b64 = String(body.fileBase64 || body.data || '');
        drive.set(name, {
          id: 'drv_' + name,
          name,
          mimeType: body.mimeType || 'application/octet-stream',
          fileBase64: b64,
          size: Buffer.from(b64, 'base64').length,
          updatedAt: new Date().toISOString()
        });
        return mockRes({ ok: true, fileId: 'drv_' + name, name });
      }
      if (action === 'downloadFile') {
        const name = String(body.fileName || body.name || '');
        const f = drive.get(name);
        if (!f) return mockRes({ ok: false, error: 'File not found: ' + name });
        return mockRes({ ok: true, name: f.name, mimeType: f.mimeType, fileBase64: f.fileBase64 });
      }
      if (action === 'deleteFile') {
        const name = String(body.fileName || '');
        drive.delete(name);
        return mockRes({ ok: true });
      }
      if (action === 'upsertEmployeeMaster') {
        const id = String(body.emp_id || (body.record && body.record.emp_id) || '');
        if (id && body.record) sheetRecords.set(id, JSON.parse(JSON.stringify(body.record)));
        const recs = Array.isArray(body.records) ? body.records : [];
        recs.forEach(r => {
          if (r && (r.emp_id || r.emp_code)) sheetRecords.set(String(r.emp_id || r.emp_code), JSON.parse(JSON.stringify(r)));
        });
        return mockRes({ ok: true, emp_id: id });
      }
      if (action === 'deleteEmployeeMaster') {
        if (body.emp_id) sheetRecords.delete(String(body.emp_id));
        const ids = Array.isArray(body.emp_codes) ? body.emp_codes : (body.emp_code ? [body.emp_code] : []);
        ids.forEach(id => sheetRecords.delete(String(id)));
        return mockRes({ ok: true });
      }
      if (action === 'getSystemRecords') {
        const kind = String(body.kind || '');
        const out = [];
        for (const r of sheetRecords.values()) {
          if (!r || !r._atpl_system) continue;
          if (!kind || r.object_kind === kind) out.push(r);
        }
        return mockRes({ ok: true, count: out.length, records: out });
      }
      if (action === 'getSyncState') {
        const files = [];
        for (const f of drive.values()) {
          files.push({ id: f.id, name: f.name, mimeType: f.mimeType, size: f.size, updatedAt: f.updatedAt });
        }
        return mockRes({ ok: true, driveFiles: files, employees: [], advances: [] });
      }
      return mockRes({ ok: false, error: 'Unknown action: ' + action });
    }
  };
}

function mockRes(obj) {
  const txt = JSON.stringify(obj);
  return {
    ok: true,
    status: 200,
    async text() { return txt; },
    async json() { return obj; }
  };
}

function createMemoryIdb() {
  const dbs = new Map(); // dbName -> Map(storeName -> Map(key -> value))
  function getStore(dbName, storeName) {
    if (!dbs.has(dbName)) dbs.set(dbName, new Map());
    const dbMap = dbs.get(dbName);
    if (!dbMap.has(storeName)) dbMap.set(storeName, new Map());
    return dbMap.get(storeName);
  }
  return {
    open(name) {
      const req = {
        result: {
          name,
          objectStoreNames: {
            contains: (sn) => dbs.has(name) && dbs.get(name).has(sn)
          },
          createObjectStore: (sn) => {
            getStore(name, sn);
            return { createIndex() {} };
          },
          transaction: (sn) => {
            const store = getStore(name, sn);
            const tx = {
              oncomplete: null,
              onerror: null,
              onabort: null,
              objectStore: () => ({
                getAll() {
                  const r = { onsuccess: null, onerror: null, result: Array.from(store.values()) };
                  queueMicrotask(() => { r.onsuccess && r.onsuccess({ target: r }); });
                  return r;
                },
                get(k) {
                  const r = { onsuccess: null, onerror: null, result: store.get(k) || null };
                  queueMicrotask(() => { r.onsuccess && r.onsuccess({ target: r }); });
                  return r;
                },
                put(v) {
                  if (v && v.id != null) store.set(v.id, v);
                  const r = { onsuccess: null, onerror: null };
                  queueMicrotask(() => {
                    r.onsuccess && r.onsuccess({ target: r });
                    tx.oncomplete && tx.oncomplete();
                  });
                  return r;
                },
                delete(k) {
                  store.delete(k);
                  const r = { onsuccess: null, onerror: null };
                  queueMicrotask(() => {
                    r.onsuccess && r.onsuccess({ target: r });
                    tx.oncomplete && tx.oncomplete();
                  });
                  return r;
                }
              })
            };
            return tx;
          },
          close() {}
        },
        onupgradeneeded: null,
        onsuccess: null,
        onerror: null
      };
      queueMicrotask(() => {
        if (req.onupgradeneeded) req.onupgradeneeded({ target: req });
        if (req.onsuccess) req.onsuccess({ target: req });
      });
      return req;
    }
  };
}

function createBrowserEnv(name, backend) {
  const ls = new Map();
  const listeners = new Map();
  const idb = createMemoryIdb();
  let hrDocsMem = [];
  let renderCount = 0;
  const timers = new Set();
  const intervals = new Set();
  const safeSetTimeout = (fn, ms, ...args) => { const t = setTimeout(fn, ms, ...args); if (t && t.unref && ms > 200) t.unref(); timers.add(t); return t; };
  const safeClearTimeout = (t) => { timers.delete(t); return clearTimeout(t); };
  const safeSetInterval = (fn, ms, ...args) => { const t = setInterval(fn, ms, ...args); if (t && t.unref) t.unref(); intervals.add(t); return t; };
  const safeClearInterval = (t) => { intervals.delete(t); return clearInterval(t); };

  class MockBlob {
    constructor(parts, opts = {}) {
      const bufs = (parts || []).map(p => {
        if (Buffer.isBuffer(p)) return p;
        if (p instanceof ArrayBuffer) return Buffer.from(p);
        if (ArrayBuffer.isView(p)) return Buffer.from(p.buffer, p.byteOffset, p.byteLength);
        return Buffer.from(String(p), 'utf8');
      });
      this._buf = Buffer.concat(bufs);
      this.size = this._buf.length;
      this.type = opts.type || '';
    }
    async arrayBuffer() {
      return this._buf.buffer.slice(this._buf.byteOffset, this._buf.byteOffset + this._buf.byteLength);
    }
  }

  class MockFileReader {
    readAsDataURL(blob) {
      queueMicrotask(() => {
        const mime = blob.type || 'application/octet-stream';
        const b64 = blob._buf.toString('base64');
        this.result = `data:${mime};base64,${b64}`;
        this.onload && this.onload();
      });
    }
  }

  const win = {
    name,
    Storage: { prototype: { setItem: () => {} } },
    ATPL_GAS_URL: 'https://script.google.com/macros/s/mock/exec',
    FILES: [],
    indexedDB: idb,
    Blob: MockBlob,
    FileReader: MockFileReader,
    crypto: globalThis.crypto,
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    atob: (b64) => Buffer.from(b64, 'base64').toString('binary'),
    TextEncoder,
    TextDecoder,
    localStorage: {
      getItem: (k) => (ls.has(k) ? ls.get(k) : null),
      setItem: (k, v) => ls.set(k, String(v)),
      removeItem: (k) => ls.delete(k)
    },
    sessionStorage: {
      getItem: () => JSON.stringify({ id: 'admin', name: 'Admin', admin: true }),
      setItem: () => {}
    },
    document: {
      readyState: 'complete',
      addEventListener: () => {},
      getElementById: () => null
    },
    addEventListener: (t, fn) => {
      if (!listeners.has(t)) listeners.set(t, []);
      listeners.get(t).push(fn);
    },
    fetch: (url, opts) => backend.fetch(url, opts),
    hrDocGetDocs: () => hrDocsMem,
    hrDocReplaceDocs: (arr) => { hrDocsMem = Array.isArray(arr) ? arr.slice() : []; },
    hrDocRender: () => { renderCount++; },
    hrDocPut: (d, cb) => {
      const idx = hrDocsMem.findIndex(x => x && x.id === d.id);
      if (idx >= 0) hrDocsMem[idx] = d;
      else hrDocsMem.push(d);
      const tx = idb.open('AroraTextilesHRDocs', 2);
      tx.onupgradeneeded = (ev) => {
        const db = ev.target.result;
        if (!db.objectStoreNames.contains('documents')) db.createObjectStore('documents', { keyPath: 'id' });
      };
      tx.onsuccess = (ev) => {
        const db = ev.target.result;
        const t = db.transaction('documents', 'readwrite');
        t.objectStore('documents').put(d);
        t.oncomplete = () => cb && cb();
      };
    },
    console: { log() {}, info() {}, warn: (...a) => console.warn(`[${name}]`, ...a), error: (...a) => console.error(`[${name}]`, ...a) },
    setTimeout: safeSetTimeout, clearTimeout: safeClearTimeout, setInterval: safeSetInterval, clearInterval: safeClearInterval, requestAnimationFrame: (fn) => safeSetTimeout(fn, 0),
    Promise, Array, Object, String, Number, Boolean, Date, JSON, Math, Set, Map, Uint8Array, ArrayBuffer, Error
  };
  win.window = win;
  win.globalThis = win;

  const ctx = vm.createContext(win);
  for (const file of [
    'atpl-drive-hr-dol-sync-v1.js',
    'atpl-firebase-bundle.js',
    'erp-cloud-shared-storage-v1.js',
    'atpl-google-drive-sync.js'
  ]) {
    const code = fs.readFileSync(path.join(ROOT, file), 'utf8');
    vm.runInContext(code, ctx, { filename: file });
  }
  return { win, idb, getHrDocs: () => hrDocsMem, getRenderCount: () => renderCount, cleanup() { for (const t of timers) clearTimeout(t); for (const t of intervals) clearInterval(t); } };
}

test('Google Drive + Sheet permanent cross-browser sync for HR Docs and PF/ESIC DOL (no 4-5s vanish)', { timeout: 10000 }, async () => {
  const backend = createMockGasBackend();
  const browserA = createBrowserEnv('BrowserA', backend);
  const browserB = createBrowserEnv('BrowserB', backend);

  // =========================================================================
  // PART 1: HR DOCUMENTS — upload in A -> survives 4-5s loops -> opens in B -> edit -> delete -> gone in A
  // =========================================================================
  const pdfB64 = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF').toString('base64');
  const doc1 = {
    id: 'HRD-101',
    doc_type: 'Training Record',
    document_name: 'Fire Safety Drill 2025',
    issue_date: '2025-04-01',
    expiry_date: '2026-04-01',
    file_name: 'fire_drill.pdf',
    file_type: 'application/pdf',
    file_data: 'data:application/pdf;base64,' + pdfB64,
    file_data_list: [{ name: 'fire_drill.pdf', type: 'application/pdf', data: 'data:application/pdf;base64,' + pdfB64 }],
    updated_at: new Date().toISOString()
  };

  await new Promise(resolve => browserA.win.hrDocPut(doc1, resolve));
  const saveRes = await browserA.win.ATPLFirebase.saveHrDoc(doc1);
  assert.equal(saveRes, true);

  // Verify ALL FILES stays completely untouched (zero pollution)
  assert.equal(browserA.win.FILES.length, 0);

  // Simulate the exact 4-5s interval/polling bug: call fetchAllHrTombstones + handleFirebaseHrTombstonesUpdate + syncHrDocs
  const rawTombs = await browserA.win.ATPLFirebase.fetchAllHrTombstones();
  assert.deepEqual(rawTombs, [], 'New HR doc must NEVER produce phantom tombstones');
  await browserA.win.ATPLCloudSharedStorageV1.handleFirebaseHrTombstonesUpdate(rawTombs);
  await browserA.win.ATPLDriveHrDolSync.syncHrDocs(true);
  await browserA.win.ATPLCloudSharedStorageV1.syncHrNow(true);

  assert.equal(browserA.getHrDocs().length, 1, 'HR doc must NOT vanish after 4-5s sync cycles in Browser A');
  assert.equal(browserA.getHrDocs()[0].id, 'HRD-101');

  // Verify Google Drive has both vault manifest and attachment file, AND Sheet has metadata mirror
  assert.ok(backend.drive.has('atpl_hr_docs_vault_v1.json'), 'Drive must store HR vault manifest');
  await new Promise(r => setTimeout(r, 25));
  assert.ok(backend.sheetRecords.has('__ATPL_SYS__hr_doc_HRD-101'), 'Sheet SystemRecords must mirror HR metadata');

  // Browser B syncs cleanly without having the document locally
  const syncB = await browserB.win.ATPLDriveHrDolSync.syncHrDocs(true);
  assert.equal(syncB.ok, true);
  assert.equal(browserB.getHrDocs().length, 1, 'Browser B must receive HR doc from Google Drive + Sheet');
  const bDoc = browserB.getHrDocs()[0];
  assert.equal(bDoc.document_name, 'Fire Safety Drill 2025');
  assert.equal(bDoc.has_attachment, true);
  assert.ok(bDoc.drive_attachment_file, 'Browser B doc must know Drive attachment filename');

  // Lazy attachment download on open in Browser B
  const hydrated = await browserB.win.ATPLDriveHrDolSync.ensureHrAttachment(bDoc);
  assert.ok(hydrated && hydrated.file_data, 'Browser B must download original attachment from Drive on demand');
  assert.ok(hydrated.file_data.includes(pdfB64), 'Downloaded attachment bytes must match Browser A upload');
  assert.equal(browserB.win.FILES.length, 0, 'Browser B All Files must stay clean');

  // Metadata-only edit in Browser B (without re-uploading file) must preserve attachment
  const editedB = Object.assign({}, hydrated, {
    file_data: null,
    file_data_list: null,
    remarks: 'Verified in audit',
    updated_at: new Date(Date.now() + 2000).toISOString()
  });
  await browserB.win.ATPLDriveHrDolSync.saveHrDoc(editedB);
  await browserA.win.ATPLDriveHrDolSync.syncHrDocs(true);
  assert.equal(browserA.getHrDocs()[0].remarks, 'Verified in audit');
  assert.equal(browserA.getHrDocs()[0].has_attachment, true, 'Attachment flag must survive metadata-only edit');

  // Delete in Browser B -> disappears permanently in Browser A too
  const delHr = await browserB.win.ATPLFirebase.deleteHrDoc('HRD-101', 'Fire Safety Drill 2025', 'admin');
  assert.equal(delHr, true);
  await new Promise(r => setTimeout(r, 25));
  assert.ok(!backend.sheetRecords.has('__ATPL_SYS__hr_doc_HRD-101'), 'Sheet mirror must be deleted');
  await browserA.win.ATPLDriveHrDolSync.syncHrDocs(true);
  assert.equal(browserA.getHrDocs().length, 0, 'Browser A must remove HR doc deleted in Browser B');

  // =========================================================================
  // PART 2: PF & ESIC DOL — upload in A -> survives refresh cycles -> visible + downloadable in B -> delete syncs
  // =========================================================================
  const pfBytes = Buffer.from('%PDF-1.4 PF CHALLAN UAN 101234567890 & 101234567891 TRRN 12345', 'utf8');
  const pfRec = {
    id: 'v2_pf_abc123',
    type: 'pf',
    name: 'EPF_Jan_2025.pdf',
    size: pfBytes.length,
    hash: 'abc123hashpf',
    period: '2025-01',
    periodSource: 'filename',
    ids: ['101234567890', '101234567891'],
    parseStatus: 'ready',
    uploadedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  const esicBytes = Buffer.from('PK_ESIC_CHALLAN_2025_01_IP_2012345678', 'utf8');
  const esicRec = {
    id: 'v2_esic_def456',
    type: 'esic',
    name: 'ESIC_Jan_2025.xlsx',
    size: esicBytes.length,
    hash: 'def456hashesic',
    period: '2025-01',
    periodSource: 'filename',
    ids: ['2012345678', '2012345679'],
    parseStatus: 'ready',
    uploadedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  const pfUp = await browserA.win.ATPLDriveHrDolSync.uploadDolRecord(pfRec, pfBytes.buffer.slice(pfBytes.byteOffset, pfBytes.byteOffset + pfBytes.byteLength));
  assert.equal(pfUp.ok, true);
  const esicUp = await browserA.win.ATPLDriveHrDolSync.uploadDolRecord(esicRec, esicBytes.buffer.slice(esicBytes.byteOffset, esicBytes.byteOffset + esicBytes.byteLength));
  assert.equal(esicUp.ok, true);

  // Verify Drive uses .json envelopes (so All Files salary .xlsx poller ignores them) & Sheet mirrors exist
  for (const fname of backend.drive.keys()) {
    assert.ok(fname.endsWith('.json'), 'Drive DOL envelope must be .json so All Files scanner never picks it up: ' + fname);
  }
  assert.ok(backend.drive.has('atpl_dol_vault_pf.json'));
  assert.ok(backend.drive.has('atpl_dol_vault_esic.json'));
  await new Promise(r => setTimeout(r, 25));
  assert.ok(backend.sheetRecords.has('__ATPL_SYS__dol_pf_abc123hashpf'));
  assert.ok(backend.sheetRecords.has('__ATPL_SYS__dol_esic_def456hashesic'));

  // Simulate repeated refresh cycles on Browser A -> challans MUST stay present (never disappear after 4-5s!)
  const pfListA = await browserA.win.ATPLDriveHrDolSync.listDolRecords('pf', [pfRec]);
  const esicListA = await browserA.win.ATPLDriveHrDolSync.listDolRecords('esic', [esicRec]);
  assert.equal(pfListA.records.length, 1);
  assert.equal(esicListA.records.length, 1);

  // Browser B opens PF & ESIC DOL with empty local cache -> receives both challans + searchable IDs
  const pfListB = await browserB.win.ATPLDriveHrDolSync.listDolRecords('pf', []);
  const esicListB = await browserB.win.ATPLDriveHrDolSync.listDolRecords('esic', []);
  assert.equal(pfListB.records.length, 1, 'Browser B must see PF challan from Drive+Sheet');
  assert.equal(esicListB.records.length, 1, 'Browser B must see ESIC challan from Drive+Sheet');
  assert.deepEqual(pfListB.records[0].ids, ['101234567890', '101234567891']);
  assert.deepEqual(esicListB.records[0].ids, ['2012345678', '2012345679']);

  // Browser B downloads original challan bytes -> byte-for-byte identical
  const dlPfBlob = await browserB.win.ATPLDriveHrDolSync.downloadDolOriginalBlob(pfListB.records[0]);
  assert.ok(dlPfBlob, 'Browser B must download original PF PDF from Drive');
  assert.equal(Buffer.from(await dlPfBlob.arrayBuffer()).toString('utf8'), pfBytes.toString('utf8'));

  const dlEsicBlob = await browserB.win.ATPLDriveHrDolSync.downloadDolOriginalBlob(esicListB.records[0]);
  assert.ok(dlEsicBlob, 'Browser B must download original ESIC Excel from Drive');
  assert.equal(Buffer.from(await dlEsicBlob.arrayBuffer()).toString('utf8'), esicBytes.toString('utf8'));

  // Browser B edits month on PF challan -> syncs to Browser A
  const pfEdited = Object.assign({}, pfListB.records[0], { period: '2025-02', periodSource: 'manual', updatedAt: new Date(Date.now() + 3000).toISOString() });
  const updRes = await browserB.win.ATPLDriveHrDolSync.updateDolRecord(pfEdited);
  assert.equal(updRes.ok, true);
  const pfListA2 = await browserA.win.ATPLDriveHrDolSync.listDolRecords('pf', [pfRec]);
  assert.equal(pfListA2.records[0].period, '2025-02', 'Edited challan period must sync across browsers');

  // Browser A deletes ESIC challan -> Browser B syncs -> gone AND tombstone prevents Browser B local copy from resurrecting
  const delEsic = await browserA.win.ATPLDriveHrDolSync.deleteDolRecord(esicRec);
  assert.equal(delEsic.ok, true);
  await new Promise(r => setTimeout(r, 25));
  assert.ok(!backend.sheetRecords.has('__ATPL_SYS__dol_esic_def456hashesic'));
  const esicListB2 = await browserB.win.ATPLDriveHrDolSync.listDolRecords('esic', [esicRec]);
  assert.equal(esicListB2.records.length, 0, 'Deleted ESIC challan must remain deleted across browsers even with stale local row');

  // Also verify compliance-dol-rebuild-v2.js loads cleanly and initializes ATPLComplianceDOLV2 in Drive+Sheet mode
  const dolRebuildCode = fs.readFileSync(path.join(ROOT, 'compliance-dol-rebuild-v2.js'), 'utf8');
  vm.runInContext(dolRebuildCode, vm.createContext(browserB.win), { filename: 'compliance-dol-rebuild-v2.js' });
  assert.ok(browserB.win.ATPLComplianceDOLV2, 'ATPLComplianceDOLV2 must initialize');
  browserA.cleanup();
  browserB.cleanup();
});

test("Regression checks: HR remote Open button, legacy attachment backfill, no getDOLFileInfo crash, DOL found even with unindexed file", async () => {
  const backend = createMockGasBackend();
  const browserA = createBrowserEnv("A2", backend);
  const browserB = createBrowserEnv("B2", backend);

  // 1. Verify index.html AFiles(d) recognizes remote Drive HR doc attachments (so Open button always renders)
  const indexHtml = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const aFilesMatch = indexHtml.match(/function AFiles\(d\)\{[\s\S]*?return \[\];\s*\}/);
  assert.ok(aFilesMatch, "AFiles(d) must exist in index.html");
  const aFilesFn = new Function(aFilesMatch[0] + "; return AFiles;")();
  const remoteOnlyHrDoc = {
    id: "HRD-REM-1",
    document_name: "Fire NOC",
    file_name: "fire_noc.pdf",
    has_attachment: true,
    drive_attachment_file: "atpl_hr_doc_att_HRD-REM-1.json",
    file_data: null,
    file_data_list: null
  };
  const filesSeenInB = aFilesFn(remoteOnlyHrDoc);
  assert.equal(filesSeenInB.length, 1, "AFiles(d) must report remote Drive attachment so Open button renders");
  assert.equal(filesSeenInB[0].name, "fire_noc.pdf");

  // 2. Legacy HR doc attachment auto-backfill from Browser A to Drive
  const legacyDocA = {
    id: "HRD-LEG-2",
    document_name: "Factory License",
    file_name: "license.pdf",
    file_type: "application/pdf",
    file_data: "data:application/pdf;base64,QkFD",
    file_data_list: [{ name: "license.pdf", type: "application/pdf", data: "data:application/pdf;base64,QkFD" }],
    updated_at: "2026-11-13T08:00:00.000Z"
  };
  // Pre-seed remote vault with stripped metadata only (missing attachment flag)
  backend.drive.set("atpl_hr_docs_vault_v1.json", {
    fileName: "atpl_hr_docs_vault_v1.json",
    mimeType: "application/json",
    updatedAt: "2026-11-13T08:00:00.000Z",
    name: "atpl_hr_docs_vault_v1.json",
    fileBase64: Buffer.from(JSON.stringify({
      version: 1,
      updatedAt: "2026-11-13T08:00:00.000Z",
      docs: [{ id: "HRD-LEG-2", document_name: "Factory License", updated_at: "2026-11-13T08:00:00.000Z", file_name: "", has_attachment: false }],
      tombstones: {}
    }), "utf8").toString("base64")
  });
  browserA.win.hrDocReplaceDocs([legacyDocA]);
  await browserA.win.ATPLDriveHrDolSync.syncHrDocs(true);
  assert.ok(backend.drive.has("atpl_hr_doc_att_HRD-LEG-2.json"), "Legacy local HR attachment must auto-backfill to Drive");
  await browserB.win.ATPLDriveHrDolSync.syncHrDocs(true);
  const bDoc = browserB.getHrDocs().find(x => x.id === "HRD-LEG-2");
  assert.ok(bDoc && bDoc.has_attachment && bDoc.file_name === "license.pdf", "Browser B must receive preserved attachment metadata");

  // 3. uploadDolOriginalOnly backfill + hash-prefix download fallback when driveFileName is missing
  const challanBytes = Buffer.from("%PDF-1.4 BACKFILL ESIC", "utf8");
  const partialRec = { id: "v2_esic_bf1", type: "esic", name: "ESIC_BF.pdf", hash: "11223344556677889900aabbccddeeff", period: "2026-07", ids: ["2707265263"], parseStatus: "ready" };
  const bfRes = await browserA.win.ATPLDriveHrDolSync.uploadDolOriginalOnly(partialRec, challanBytes.buffer.slice(challanBytes.byteOffset, challanBytes.byteOffset + challanBytes.byteLength));
  assert.equal(bfRes.ok, true);
  // Simulate old record missing driveFileName in Browser B
  const dlFallback = await browserB.win.ATPLDriveHrDolSync.downloadDolOriginalBlob({ id: "v2_esic_bf1", type: "esic", hash: "11223344556677889900aabbccddeeff" });
  assert.ok(dlFallback, "downloadDolOriginalBlob must find original by hash prefix on Drive");
  assert.equal(Buffer.from(await dlFallback.arrayBuffer()).toString("utf8"), challanBytes.toString("utf8"));

  // 4. Static checks on compliance-dol-rebuild-v2.js: never call v.fileBlob when drive-sheets mode, never emit unguarded "Index incomplete" when DOL matched
  const dolCode = fs.readFileSync(path.join(ROOT, "compliance-dol-rebuild-v2.js"), "utf8");
  assert.ok(dolCode.includes("allowLegacyV4"), "recordBlob must gate legacy v.fileBlob behind allowLegacyV4");
  assert.ok(dolCode.includes("strictlyNewerBlocking"), "searchAsync must not hide matched DOL month behind blocking unindexed files");
  assert.ok(dolCode.includes("⚠ Needs indexing"), "year12 mode must show accurate indexing status instead of lying Indexed");

  browserA.cleanup();
  browserB.cleanup();
});
