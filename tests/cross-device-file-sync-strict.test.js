const test = require('node:test');
const assert = require('node:assert/strict');

test('Cross-Device Real-Time Sync & Strict Auto-Delete Test', async (t) => {
  // Mock In-Memory Server Sync Store
  const store = {
    version: 1,
    files: {},          // id -> file
    salary_files: {},   // name -> file
    salary_tombstones: {}, // name -> { deleted_at }
    hr_docs: {},        // id -> doc
    hr_tombstones: {},  // id -> { deleted_at }
    dol_records: {}     // id -> rec
  };

  function serverSaveFile(module, payload) {
    store.version++;
    const id = payload.id || payload.name;
    store.files[id] = { ...payload, created_at: new Date().toISOString() };
    if (module === 'salary') {
      store.salary_files[payload.name] = { ...payload, saved: new Date().toISOString() };
      delete store.salary_tombstones[payload.name.toLowerCase()];
    } else if (module === 'hr_doc') {
      store.hr_docs[id] = { ...payload, updated_at: new Date().toISOString() };
      delete store.hr_tombstones[id.toLowerCase()];
    } else if (module === 'pf' || module === 'esic') {
      store.dol_records[id] = { ...payload, created_at: new Date().toISOString() };
    }
    return { ok: true, id };
  }

  function serverDeleteFile(module, idOrName) {
    store.version++;
    const now = new Date().toISOString();
    const key = String(idOrName).toLowerCase();
    delete store.files[idOrName];
    delete store.files[key];

    if (module === 'salary') {
      delete store.salary_files[idOrName];
      store.salary_tombstones[key] = { deleted_at: now };
    } else if (module === 'hr_doc') {
      delete store.hr_docs[idOrName];
      delete store.hr_docs[key];
      store.hr_tombstones[key] = { deleted_at: now };
    } else if (module === 'pf' || module === 'esic') {
      delete store.dol_records[idOrName];
    }
    return { ok: true, deleted: true, id: idOrName, deleted_at: now };
  }

  function serverGetState() {
    return {
      ok: true,
      version: store.version,
      salary_files: Object.values(store.salary_files),
      salary_tombstones: store.salary_tombstones,
      hr_docs: Object.values(store.hr_docs),
      hr_tombstones: store.hr_tombstones,
      dol_records: Object.values(store.dol_records),
      files: Object.values(store.files)
    };
  }

  // Simulated Browser B state
  const browserB = {
    salaryFiles: [],
    hrDocs: [],
    dolRecords: [],
    localTombs: {}
  };

  function browserBReconcile() {
    const cloud = serverGetState();
    
    // Strict Salary Auto-Prune & Download
    const cloudSalaryMap = new Map();
    cloud.salary_files.forEach(f => cloudSalaryMap.set(f.name.toLowerCase(), f));
    
    // 1. Strict Prune: If in tombstones OR not in active cloud files -> REMOVE
    browserB.salaryFiles = browserB.salaryFiles.filter(f => {
      const fn = f.name.toLowerCase();
      if (cloud.salary_tombstones[fn]) return false;
      if (!cloudSalaryMap.has(fn)) return false;
      return true;
    });

    // 2. Auto-Download: Any file in cloud missing locally is added
    const localSalaryNames = new Set(browserB.salaryFiles.map(f => f.name.toLowerCase()));
    cloud.salary_files.forEach(f => {
      if (!localSalaryNames.has(f.name.toLowerCase())) {
        browserB.salaryFiles.push({ ...f });
      }
    });

    // Strict HR Docs Auto-Prune & Download
    const cloudHrMap = new Map();
    cloud.hr_docs.forEach(d => cloudHrMap.set(d.id.toLowerCase(), d));

    browserB.hrDocs = browserB.hrDocs.filter(d => {
      const did = d.id.toLowerCase();
      if (cloud.hr_tombstones[did]) return false;
      if (!cloudHrMap.has(did)) return false;
      return true;
    });

    const localHrIds = new Set(browserB.hrDocs.map(d => d.id.toLowerCase()));
    cloud.hr_docs.forEach(d => {
      if (!localHrIds.has(d.id.toLowerCase())) {
        browserB.hrDocs.push({ ...d });
      }
    });

    // Strict PF/ESIC Auto-Prune & Download
    const cloudDolMap = new Map();
    cloud.dol_records.forEach(r => cloudDolMap.set(r.id.toLowerCase(), r));

    browserB.dolRecords = browserB.dolRecords.filter(r => cloudDolMap.has(r.id.toLowerCase()));
    const localDolIds = new Set(browserB.dolRecords.map(r => r.id.toLowerCase()));
    cloud.dol_records.forEach(r => {
      if (!localDolIds.has(r.id.toLowerCase())) {
        browserB.dolRecords.push({ ...r });
      }
    });
  }

  await t.test('1. Browser A uploads 5 files across modules (Salary, HR Docs, PF, ESIC)', () => {
    serverSaveFile('salary', { name: 'Salary_May_2026.xlsx', size: 50000 });
    serverSaveFile('salary', { name: 'Salary_June_2026.xlsx', size: 52000 });
    serverSaveFile('hr_doc', { id: 'HRD-2026-001', document_name: 'Fire Safety Policy' });
    serverSaveFile('pf', { id: 'PF-CHALLAN-2026-05', name: 'PF_Challan_May_2026.pdf', module: 'pf' });
    serverSaveFile('esic', { id: 'ESIC-CHALLAN-2026-05', name: 'ESIC_Challan_May_2026.pdf', module: 'esic' });

    assert.equal(Object.keys(store.salary_files).length, 2);
    assert.equal(Object.keys(store.hr_docs).length, 1);
    assert.equal(Object.keys(store.dol_records).length, 2);
  });

  await t.test('2. Browser B opens on mobile phone: reconciles and discovers all 5 files', () => {
    browserBReconcile();

    assert.equal(browserB.salaryFiles.length, 2, 'Browser B has 2 salary files');
    assert.equal(browserB.hrDocs.length, 1, 'Browser B has 1 HR document');
    assert.equal(browserB.dolRecords.length, 2, 'Browser B has 2 PF/ESIC challans');
  });

  await t.test('3. Admin deletes Salary_May_2026.xlsx on Browser A -> strict tombstone registered', () => {
    const res = serverDeleteFile('salary', 'Salary_May_2026.xlsx');
    assert.equal(res.ok, true);
    assert.equal(store.salary_files['Salary_May_2026.xlsx'], undefined);
    assert.ok(store.salary_tombstones['salary_may_2026.xlsx']);
  });

  await t.test('4. Browser B reconciles on phone: Salary_May_2026 is strictly auto-deleted', () => {
    browserBReconcile();

    assert.equal(browserB.salaryFiles.length, 1, 'Only 1 salary file remains on Browser B');
    assert.equal(browserB.salaryFiles[0].name, 'Salary_June_2026.xlsx');
  });

  await t.test('5. Admin deletes HRD-2026-001 on Browser A -> strictly auto-deleted on Browser B', () => {
    serverDeleteFile('hr_doc', 'HRD-2026-001');
    browserBReconcile();

    assert.equal(browserB.hrDocs.length, 0, 'HR document strictly deleted on Browser B');
  });

  await t.test('6. Admin deletes PF Challan -> strictly auto-deleted on Browser B', () => {
    serverDeleteFile('pf', 'PF-CHALLAN-2026-05');
    browserBReconcile();

    assert.equal(browserB.dolRecords.length, 1, 'Only 1 compliance challan remains on Browser B');
    assert.equal(browserB.dolRecords[0].id, 'ESIC-CHALLAN-2026-05');
  });

  await t.test('7. Zero resurrection / Zero ghost cache: Browser B reloads and never recovers deleted file', () => {
    // Simulate user reloading Browser B with stale cache containing the deleted files
    browserB.salaryFiles.push({ name: 'Salary_May_2026.xlsx' });
    browserB.hrDocs.push({ id: 'HRD-2026-001' });

    browserBReconcile();

    assert.equal(browserB.salaryFiles.length, 1, 'Stale file strictly auto-purged on reconciliation');
    assert.equal(browserB.salaryFiles[0].name, 'Salary_June_2026.xlsx');
    assert.equal(browserB.hrDocs.length, 0, 'Stale HR doc strictly auto-purged on reconciliation');
  });
});
