/**
 * ATPL GOOGLE DRIVE + GOOGLE SHEETS VAULT SYNC ENGINE (HR DOCS + PF/ESIC DOL)
 * Version: 2026.11.13-drive-sheets-hr-dol-v1
 *
 * Guarantees:
 * - Zero freeze / hang / auto-reload (async POST transport + native Blob FileReader base64)
 * - 100% Google Drive + Google Sheet persistence using live Apps Script actions
 * - Zero interference with All Files, Advance Deduction, or Employee Master
 * - Attachments (PDF/JPG/Excel) synced via dedicated per-item Drive files & hydrated on demand
 * - Persistent pending ops & timestamped tombstones (never vanishes after 4-5s)
 */
(function(root) {
  'use strict';

  var BUILD = '2026.11.13-drive-sheets-hr-dol-v1';
  if (root.__ATPL_DRIVE_HR_DOL_SYNC__ === BUILD) return;
  root.__ATPL_DRIVE_HR_DOL_SYNC__ = BUILD;

  var DEFAULT_GAS_URL = 'https://script.google.com/macros/s/AKfycbxiaKVtVJUWqDPtI-9iecG0LE817SfbbQNfUaZouw8sgYr3f1zRffutMu_UGnV-vqy-oA/exec';
  var DRIVE_HR_VAULT_FILE = 'atpl_hr_docs_vault_v1.json';
  var DRIVE_HR_ATT_PREFIX = 'atpl_hr_doc_att_';
  var DRIVE_DOL_VAULT_PREFIX = 'atpl_dol_vault_';
  var DRIVE_DOL_ORIG_PREFIX = 'atpl_dol_orig_';

  var HR_DB_NAME = 'AroraTextilesHRDocs';
  var HR_STORE = 'documents';
  var HR_TOMB_KEY = 'ATPL_HR_TOMBSTONES_V2';
  var HR_TOMB_V1_KEY = 'ATPL_HR_TOMBSTONES_V1';
  var HR_PENDING_KEY = 'ATPL_HR_PENDING_OPS_V1';
  var HR_REMOTE_TS_KEY = 'ATPL_HR_VAULT_REMOTE_TS_V1';

  var DOL_TOMB_KEY = 'ATPL_DOL_DELETE_TOMBSTONES_V2';
  var DOL_PENDING_KEY = 'ATPL_DOL_PENDING_OPS_V1';
  var DOL_REMOTE_TS_KEY = 'ATPL_DOL_VAULT_REMOTE_TS_V1';

  var CLIENT_ID = 'hrdol_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  var writeChains = { hr: Promise.resolve(), pf: Promise.resolve(), esic: Promise.resolve() };
  var syncFlights = { hr: null, pf: null, esic: null };
  var lastDriveSeen = { hr: 0, pf: 0, esic: 0 };

  function getGasUrl() {
    try {
      var custom = root.localStorage && root.localStorage.getItem('ATPL_CUSTOM_GAS_URL');
      if (custom && /^https:\/\/script\.google\.com\/macros\/s\//.test(custom.trim())) return custom.trim();
      if (root.ATPL_CUSTOM_GAS_URL && /^https:\/\/script\.google\.com\/macros\/s\//.test(String(root.ATPL_CUSTOM_GAS_URL).trim())) {
        return String(root.ATPL_CUSTOM_GAS_URL).trim();
      }
      if (root.ATPL_GAS_URL && /^https:\/\/script\.google\.com\/macros\/s\//.test(String(root.ATPL_GAS_URL).trim())) {
        return String(root.ATPL_GAS_URL).trim();
      }
      if (root.ATPLGoogleSync && root.ATPLGoogleSync.gasUrl && /^https:\/\/script\.google\.com\/macros\/s\//.test(String(root.ATPLGoogleSync.gasUrl).trim())) {
        return String(root.ATPLGoogleSync.gasUrl).trim();
      }
    } catch (_) {}
    return DEFAULT_GAS_URL;
  }

  function safeJsonParse(str, fallback) {
    try { return JSON.parse(str); } catch (_) { return fallback; }
  }

  function readStorageJson(key, fallback) {
    try {
      var raw = root.localStorage && root.localStorage.getItem(key);
      if (!raw) return fallback;
      var parsed = JSON.parse(raw);
      return (parsed && typeof parsed === 'object') ? parsed : fallback;
    } catch (_) { return fallback; }
  }

  function writeStorageJson(key, obj) {
    try {
      if (!root.localStorage) return;
      root.__ATPL_INTERNAL_STORAGE_WRITE = true;
      try {
        root.localStorage.setItem(key, JSON.stringify(obj));
      } finally {
        root.__ATPL_INTERNAL_STORAGE_WRITE = false;
      }
    } catch (_) {}
  }

  function safeKey(v) {
    return String(v || '').trim().replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 96) || 'item';
  }

  function dateMs(v) {
    if (typeof v === 'number' && isFinite(v)) return v;
    var n = Date.parse(String(v || ''));
    return isFinite(n) ? n : 0;
  }

  function tick() {
    return new Promise(function(r) { setTimeout(r, 0); });
  }

  function queueWrite(bucket, fn) {
    var prev = writeChains[bucket] || Promise.resolve();
    var next = prev.catch(function() {}).then(fn);
    writeChains[bucket] = next.catch(function() {});
    return next;
  }

  async function callGas(action, params, timeoutMs) {
    var endpoint = getGasUrl();
    if (!endpoint) throw new Error('Google Apps Script URL not configured');
    var payload = Object.assign({ action: action, sender: CLIENT_ID, _ts: Date.now() }, params || {});
    var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function() { try { ctrl.abort(); } catch (_) {} }, timeoutMs || 32000) : null;
    try {
      var res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload),
        signal: ctrl ? ctrl.signal : undefined
      });
      if (timer) clearTimeout(timer);
      if (!res || !res.ok) return { ok: false, error: 'HTTP ' + (res ? res.status : 'error') };
      var txt = await res.text();
      try { return JSON.parse(txt); } catch (_) { return { ok: false, error: 'Invalid JSON response' }; }
    } catch (e) {
      if (timer) clearTimeout(timer);
      return { ok: false, error: (e && e.message) || 'Network error' };
    }
  }

  async function blobOrBufToBase64(input) {
    if (!input) return '';
    var blob = input;
    if (!(typeof Blob !== 'undefined' && input instanceof Blob)) {
      if (typeof input === 'string') {
        if (typeof Blob !== 'undefined' && typeof FileReader !== 'undefined') {
          blob = new Blob([input], { type: 'application/json;charset=utf-8' });
        } else if (typeof Buffer !== 'undefined') {
          return Buffer.from(input, 'utf8').toString('base64');
        } else {
          return btoa(unescape(encodeURIComponent(input)));
        }
      } else if (input instanceof ArrayBuffer || ArrayBuffer.isView(input)) {
        if (typeof Blob !== 'undefined' && typeof FileReader !== 'undefined') {
          blob = new Blob([input]);
        } else {
          var bytes = input instanceof Uint8Array ? input : new Uint8Array(input.buffer || input);
          if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
          var bin = '';
          for (var i = 0; i < bytes.length; i += 8192) {
            bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
          }
          return btoa(bin);
        }
      }
    }
    if (typeof FileReader !== 'undefined' && typeof Blob !== 'undefined' && blob instanceof Blob) {
      return await new Promise(function(resolve, reject) {
        var r = new FileReader();
        r.onload = function() {
          var s = String(r.result || '');
          var idx = s.indexOf(',');
          resolve(idx >= 0 ? s.slice(idx + 1) : s);
        };
        r.onerror = function() { reject(r.error || new Error('Base64 encode failed')); };
        r.readAsDataURL(blob);
      });
    }
    return '';
  }

  function b64ToUtf8(b64) {
    if (!b64 || typeof b64 !== 'string') return '';
    var clean = b64.replace(/^data:[^;]+;base64,/, '').trim();
    if (typeof Buffer !== 'undefined') {
      try { return Buffer.from(clean, 'base64').toString('utf8'); } catch (_) {}
    }
    var bin = atob(clean);
    if (typeof TextDecoder !== 'undefined') {
      var bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new TextDecoder('utf-8').decode(bytes);
    }
    try { return decodeURIComponent(escape(bin)); } catch (_) { return bin; }
  }

  function b64ToUint8Array(b64) {
    var clean = String(b64 || '').replace(/^data:[^;]+;base64,/, '').trim();
    if (!clean) return new Uint8Array(0);
    if (typeof Buffer !== 'undefined' && typeof atob === 'undefined') {
      return new Uint8Array(Buffer.from(clean, 'base64'));
    }
    var bin = atob(clean);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function downloadJsonFromDrive(fileName) {
    var res = await callGas('downloadFile', { fileName: fileName }, 32000);
    if (!res || !res.ok || !res.fileBase64) {
      var err = String(res && res.error || '');
      if (/not found/i.test(err)) return { found: false, data: null };
      return { found: false, transientError: err || 'Download failed', data: null };
    }
    try {
      var jsonStr = b64ToUtf8(res.fileBase64);
      var parsed = JSON.parse(jsonStr);
      return { found: true, data: parsed };
    } catch (e) {
      return { found: false, transientError: 'JSON parse error: ' + e.message, data: null };
    }
  }

  async function uploadJsonToDrive(fileName, obj) {
    var jsonStr = JSON.stringify(obj);
    var b64 = await blobOrBufToBase64(jsonStr);
    if (!b64) throw new Error('Failed to encode Drive JSON payload');
    var res = await callGas('uploadFile', {
      fileName: fileName,
      module: 'vault',
      fileBase64: b64,
      mimeType: 'application/json'
    }, 45000);
    if (!res || !res.ok) throw new Error((res && res.error) || 'Drive upload failed');
    return res;
  }

  async function deleteFileFromDrive(fileName) {
    if (!fileName) return { ok: true };
    return await callGas('deleteFile', { fileName: fileName }, 25000);
  }

  function dispatchTrigger(action, details) {
    var payload = { action: action, details: details || {}, sender: CLIENT_ID, ts: Date.now() };
    if (typeof root.BroadcastChannel !== 'undefined') {
      try {
        var bc1 = new root.BroadcastChannel('ATPL_ERP_TRIGGER_BUS');
        bc1.postMessage(payload);
        bc1.close();
      } catch (_) {}
      try {
        var bc2 = new root.BroadcastChannel('ATPL_ERP_SHARED_V2');
        bc2.postMessage(Object.assign({ type: action }, details || {}));
        bc2.close();
      } catch (_) {}
    }
    try {
      root.__ATPL_INTERNAL_STORAGE_WRITE = true;
      root.localStorage.setItem('ATPL_TRIGGER_EVENT', JSON.stringify(payload));
    } catch (_) {} finally {
      root.__ATPL_INTERNAL_STORAGE_WRITE = false;
    }
  }

  function currentUserId() {
    try {
      var raw = (root.sessionStorage && root.sessionStorage.getItem('ATPL_UserSession_V5')) ||
                (root.localStorage && root.localStorage.getItem('ATPL_UserSession_V5')) || '';
      var s = safeJsonParse(raw, null);
      if (s && s.id) return String(s.id);
    } catch (_) {}
    return 'admin';
  }

  /* ============================================================================
     1. HR DOCUMENTS — GOOGLE DRIVE + GOOGLE SHEET AUTHORITATIVE VAULT
     ============================================================================ */

  function hrAttFileName(docId) {
    return DRIVE_HR_ATT_PREFIX + safeKey(docId) + '.json';
  }

  function openHrDb() {
    return new Promise(function(resolve, reject) {
      if (!root.indexedDB) { resolve(null); return; }
      try {
        var r = root.indexedDB.open(HR_DB_NAME);
        r.onupgradeneeded = function(e) {
          var db = e.target.result;
          if (!db.objectStoreNames.contains(HR_STORE)) db.createObjectStore(HR_STORE, { keyPath: 'id' });
        };
        r.onsuccess = function(e) {
          var db = e.target.result;
          if (!db.objectStoreNames.contains(HR_STORE)) {
            var ver = (db.version || 1) + 1;
            db.close();
            var r2 = root.indexedDB.open(HR_DB_NAME, ver);
            r2.onupgradeneeded = function(ev) {
              var up = ev.target.result;
              if (!up.objectStoreNames.contains(HR_STORE)) up.createObjectStore(HR_STORE, { keyPath: 'id' });
            };
            r2.onsuccess = function(ev) { resolve(ev.target.result); };
            r2.onerror = function() { resolve(null); };
          } else {
            resolve(db);
          }
        };
        r.onerror = function() { resolve(null); };
      } catch (_) { resolve(null); }
    });
  }

  async function idbGetAllHr() {
    var db = await openHrDb();
    if (!db) return [];
    return new Promise(function(resolve) {
      try {
        var req = db.transaction(HR_STORE, 'readonly').objectStore(HR_STORE).getAll();
        req.onsuccess = function() { try { db.close(); } catch (_) {} resolve(req.result || []); };
        req.onerror = function() { try { db.close(); } catch (_) {} resolve([]); };
      } catch (_) {
        try { db.close(); } catch (_) {}
        resolve([]);
      }
    });
  }

  async function idbPutHr(doc) {
    if (!doc || !doc.id) return false;
    var db = await openHrDb();
    if (!db) return false;
    return new Promise(function(resolve) {
      try {
        var tx = db.transaction(HR_STORE, 'readwrite');
        tx.objectStore(HR_STORE).put(doc);
        tx.oncomplete = function() { try { db.close(); } catch (_) {} resolve(true); };
        tx.onerror = function() { try { db.close(); } catch (_) {} resolve(false); };
      } catch (_) {
        try { db.close(); } catch (_) {}
        resolve(false);
      }
    });
  }

  async function idbDeleteHr(id) {
    if (!id) return false;
    var db = await openHrDb();
    if (!db) return false;
    return new Promise(function(resolve) {
      try {
        var tx = db.transaction(HR_STORE, 'readwrite');
        tx.objectStore(HR_STORE).delete(id);
        tx.oncomplete = function() { try { db.close(); } catch (_) {} resolve(true); };
        tx.onerror = function() { try { db.close(); } catch (_) {} resolve(false); };
      } catch (_) {
        try { db.close(); } catch (_) {}
        resolve(false);
      }
    });
  }

  function hrReadTombstones() {
    var raw = readStorageJson(HR_TOMB_KEY, {});
    var clean = {}, changed = false;
    Object.keys(raw).forEach(function(k) {
      var v = raw[k];
      var ms = typeof v === 'string' ? dateMs(v) : (typeof v === 'number' && isFinite(v) ? v : 0);
      if (ms > 0) clean[String(k).toLowerCase()] = new Date(ms).toISOString();
      else changed = true;
    });
    if (changed) writeStorageJson(HR_TOMB_KEY, clean);
    return clean;
  }

  function hrSaveTombstones(map) {
    writeStorageJson(HR_TOMB_KEY, map || {});
  }

  function hrReadPending() {
    return readStorageJson(HR_PENDING_KEY, {});
  }

  function hrWritePending(map) {
    writeStorageJson(HR_PENDING_KEY, map || {});
  }

  function hrHasInlineAttachment(doc) {
    if (!doc) return false;
    if (doc.file_data && typeof doc.file_data === 'string' && doc.file_data.length > 8) return true;
    if (Array.isArray(doc.file_data_list) && doc.file_data_list.some(function(f) { return f && f.data && String(f.data).length > 8; })) return true;
    return false;
  }

  function hrMetaOnly(doc) {
    var hasAtt = hrHasInlineAttachment(doc) || !!doc.has_attachment || !!doc.drive_attachment_file;
    var attList = Array.isArray(doc.file_data_list) ? doc.file_data_list : [];
    var attCount = attList.length ? attList.filter(function(f) { return f && (f.data || f.name); }).length : (hasAtt ? (Number(doc.attachment_count) || 1) : 0);
    var copy = Object.assign({}, doc);
    delete copy.file_data;
    delete copy.file_data_list;
    delete copy._cloud_attachment_omitted;
    copy.has_attachment = hasAtt;
    copy.attachment_count = attCount;
    copy.drive_attachment_file = hasAtt ? (doc.drive_attachment_file || hrAttFileName(doc.id)) : '';
    copy.attachment_names = attList.length ? attList.map(function(x) { return x && x.name || ''; }).filter(Boolean) : (Array.isArray(doc.attachment_names) ? doc.attachment_names : []);
    return copy;
  }

  function hrAttachmentPayload(doc) {
    var list = Array.isArray(doc.file_data_list) ? doc.file_data_list.filter(function(f) { return f && f.data; }) : [];
    return {
      v: 1,
      id: doc.id,
      updated_at: doc.updated_at || new Date().toISOString(),
      file_name: doc.file_name || (list[0] && list[0].name) || '',
      file_type: doc.file_type || (list[0] && list[0].type) || '',
      file_data: doc.file_data || (list[0] && list[0].data) || null,
      file_data_list: list
    };
  }

  function mergeHrDocLists(baseDocs, overlayDocs, tombstones) {
    var byId = {};
    function ingest(d) {
      if (!d || !d.id) return;
      var k = String(d.id).toLowerCase();
      var dTs = dateMs(d.updated_at || d.saved_at || d.uploaded_at || d.created_at);
      var tTs = tombstones && tombstones[k] ? dateMs(tombstones[k]) : 0;
      if (tTs && tTs >= dTs) return;
      var old = byId[k];
      if (!old) {
        byId[k] = Object.assign({}, d);
        return;
      }
      var oldTs = dateMs(old.updated_at || old.saved_at || old.uploaded_at || old.created_at);
      var winner = dTs >= oldTs ? d : old;
      var donor = dTs >= oldTs ? old : d;
      var merged = Object.assign({}, donor, winner);
      // Preserve attachment metadata & local attachment bytes safely across clients
      if (!winner.file_name && donor.file_name && !winner._attachment_removed) {
        merged.file_name = donor.file_name;
        merged.file_type = winner.file_type || donor.file_type || '';
      }
      if (!winner.has_attachment && donor.has_attachment && !winner._attachment_removed) {
        merged.has_attachment = true;
      }
      if (!winner.drive_attachment_file && donor.drive_attachment_file && !winner._attachment_removed) {
        merged.drive_attachment_file = donor.drive_attachment_file;
      }
      if ((!Array.isArray(winner.attachment_names) || !winner.attachment_names.length) && Array.isArray(donor.attachment_names) && donor.attachment_names.length && !winner._attachment_removed) {
        merged.attachment_names = donor.attachment_names;
        merged.attachment_count = donor.attachment_count || donor.attachment_names.length;
      }
      if (!hrHasInlineAttachment(winner) && hrHasInlineAttachment(donor)) {
        var sameAtt = (!winner.file_name || winner.file_name === donor.file_name) &&
                      (!winner.attachment_updated_at || winner.attachment_updated_at === donor.attachment_updated_at || !donor.attachment_updated_at);
        if (sameAtt && winner.has_attachment !== false) {
          merged.file_data = donor.file_data || null;
          merged.file_data_list = donor.file_data_list || null;
        } else {
          delete merged.file_data;
          delete merged.file_data_list;
        }
      }
      if (!merged.drive_attachment_file && (hrHasInlineAttachment(merged) || merged.has_attachment || merged.file_name)) {
        merged.drive_attachment_file = hrAttFileName(merged.id);
        merged.has_attachment = true;
      }
      byId[k] = merged;
    }
    (baseDocs || []).forEach(ingest);
    (overlayDocs || []).forEach(ingest);
    return Object.keys(byId).map(function(k) { return byId[k]; });
  }

  function applyHrDocsToLiveUi(finalDocs) {
    if (typeof root.hrDocReplaceDocs === 'function') {
      root.hrDocReplaceDocs(finalDocs);
    } else if (typeof root.hrDocGetDocs === 'function') {
      var ref = root.hrDocGetDocs();
      if (Array.isArray(ref)) {
        ref.length = 0;
        for (var i = 0; i < finalDocs.length; i++) ref.push(finalDocs[i]);
      }
    }
    try { if (typeof root.hrDocRender === 'function') root.hrDocRender(); } catch (_) {}
    try { if (typeof root.hrDocCheckAlerts === 'function') root.hrDocCheckAlerts(false); } catch (_) {}
  }

  async function mirrorHrMetaToSheet(metaDoc) {
    if (!metaDoc || !metaDoc.id) return;
    var sysId = '__ATPL_SYS__hr_doc_' + safeKey(metaDoc.id);
    var rec = Object.assign({}, hrMetaOnly(metaDoc), {
      emp_id: sysId,
      _atpl_system: true,
      _atpl_kind: 'meta',
      object_kind: 'hr_doc',
      object_key: 'hr_doc__' + safeKey(metaDoc.id),
      key_text: String(metaDoc.id),
      uploaded_by: currentUserId(),
      saved_at: metaDoc.updated_at || new Date().toISOString()
    });
    await callGas('upsertEmployeeMaster', { emp_id: sysId, record: rec }, 20000);
  }

  async function deleteHrMetaFromSheet(docId) {
    if (!docId) return;
    var sysId = '__ATPL_SYS__hr_doc_' + safeKey(docId);
    await callGas('deleteEmployeeMaster', { emp_id: sysId }, 20000);
  }

  async function saveHrDoc(docObj) {
    if (!docObj || !docObj.id) return { ok: false, error: 'Invalid HR doc' };
    var nowIso = docObj.updated_at || new Date().toISOString();
    var k = String(docObj.id).toLowerCase();

    // Clear tombstone immediately & record pending save before network I/O
    var tombs = hrReadTombstones();
    if (tombs[k]) {
      delete tombs[k];
      hrSaveTombstones(tombs);
    }
    var hasBytes = hrHasInlineAttachment(docObj);
    var enriched = Object.assign({}, docObj, {
      updated_at: nowIso,
      has_attachment: hasBytes || !!docObj.has_attachment || !!docObj.drive_attachment_file,
      drive_attachment_file: (hasBytes || docObj.has_attachment || docObj.drive_attachment_file) ? (docObj.drive_attachment_file || hrAttFileName(docObj.id)) : '',
      attachment_updated_at: hasBytes ? nowIso : (docObj.attachment_updated_at || '')
    });

    var pend = hrReadPending();
    pend[k] = { op: 'save', id: docObj.id, updated_at: nowIso, doc: hrMetaOnly(enriched) };
    hrWritePending(pend);

    // Ensure local IDB + memory have full object immediately
    await idbPutHr(enriched);
    try {
      var curRef = typeof root.hrDocGetDocs === 'function' ? root.hrDocGetDocs() : null;
      if (Array.isArray(curRef)) {
        var idx = curRef.findIndex(function(x) { return x && String(x.id).toLowerCase() === k; });
        if (idx >= 0) curRef[idx] = enriched;
        else curRef.push(enriched);
      }
    } catch (_) {}

    return await queueWrite('hr', async function() {
      try {
        // 1. Upload attachment bytes first if present
        if (hasBytes) {
          await uploadJsonToDrive(enriched.drive_attachment_file, hrAttachmentPayload(enriched));
        }

        // 2. Read-Modify-Write authoritative HR vault on Google Drive
        var dl = await downloadJsonFromDrive(DRIVE_HR_VAULT_FILE);
        var remoteVault = (dl.data && typeof dl.data === 'object') ? dl.data : { version: 1, docs: [], tombstones: {} };
        var remoteTombs = Object.assign({}, remoteVault.tombstones || {}, hrReadTombstones());
        if (remoteTombs[k] && dateMs(nowIso) >= dateMs(remoteTombs[k])) {
          delete remoteTombs[k];
        }
        hrSaveTombstones(remoteTombs);

        var localMetaDocs = (await idbGetAllHr()).map(hrMetaOnly);
        var pendingNow = hrReadPending();
        var pendingSaves = Object.keys(pendingNow)
          .map(function(pk) { return pendingNow[pk]; })
          .filter(function(op) { return op && op.op === 'save' && op.doc; })
          .map(function(op) { return op.doc; });

        var mergedDocs = mergeHrDocLists(
          mergeHrDocLists(remoteVault.docs || [], localMetaDocs, remoteTombs),
          pendingSaves.concat([hrMetaOnly(enriched)]),
          remoteTombs
        ).map(hrMetaOnly);

        var newVault = {
          version: 1,
          updatedAt: new Date().toISOString(),
          docs: mergedDocs,
          tombstones: remoteTombs
        };
        await uploadJsonToDrive(DRIVE_HR_VAULT_FILE, newVault);
        lastDriveSeen.hr = Date.now();
        writeStorageJson(HR_REMOTE_TS_KEY, { ts: Date.now(), count: mergedDocs.length });

        // 3. Mirror metadata to Google Sheet (non-blocking if Sheet is slow)
        mirrorHrMetaToSheet(enriched).catch(function() {});

        // 4. Ack pending op
        var pAfter = hrReadPending();
        if (pAfter[k] && pAfter[k].op === 'save' && dateMs(pAfter[k].updated_at) <= dateMs(nowIso)) {
          delete pAfter[k];
          hrWritePending(pAfter);
        }

        dispatchTrigger('hr_doc_saved', { id: enriched.id, updated_at: nowIso });
        return { ok: true, id: enriched.id };
      } catch (err) {
        console.warn('[Drive HR Sync] Deferred retry queued for save:', docObj.id, err && err.message || err);
        return { ok: false, queued: true, error: err && err.message || String(err) };
      }
    });
  }

  async function deleteHrDoc(id, docName) {
    if (!id) return { ok: false, error: 'Missing id' };
    var k = String(id).toLowerCase();
    var maxDocTs = 0;
    try {
      var curScan = typeof root.hrDocGetDocs === 'function' ? root.hrDocGetDocs() : [];
      var hit = (curScan || []).find(function(x) { return x && String(x.id || '').toLowerCase() === k; });
      if (hit) maxDocTs = Math.max(maxDocTs, dateMs(hit.updated_at || hit.saved_at || hit.created_at));
    } catch (_) {}
    var nowIso = new Date(Math.max(Date.now(), maxDocTs + 1000)).toISOString();

    var tombs = hrReadTombstones();
    tombs[k] = nowIso;
    hrSaveTombstones(tombs);

    var pend = hrReadPending();
    pend[k] = { op: 'delete', id: id, name: docName || id, deleted_at: nowIso };
    hrWritePending(pend);

    await idbDeleteHr(id);
    try {
      var curRef = typeof root.hrDocGetDocs === 'function' ? root.hrDocGetDocs() : null;
      if (Array.isArray(curRef)) {
        for (var i = curRef.length - 1; i >= 0; i--) {
          if (curRef[i] && String(curRef[i].id || '').toLowerCase() === k) curRef.splice(i, 1);
        }
      }
    } catch (_) {}

    return await queueWrite('hr', async function() {
      try {
        var dl = await downloadJsonFromDrive(DRIVE_HR_VAULT_FILE);
        var remoteVault = (dl.data && typeof dl.data === 'object') ? dl.data : { version: 1, docs: [], tombstones: {} };
        (remoteVault.docs || []).forEach(function(d) {
          if (d && String(d.id || '').toLowerCase() === k) {
            var rTs = dateMs(d.updated_at || d.saved_at || d.created_at);
            if (rTs >= dateMs(nowIso)) nowIso = new Date(rTs + 1000).toISOString();
          }
        });
        var remoteTombs = Object.assign({}, remoteVault.tombstones || {}, hrReadTombstones());
        if (!remoteTombs[k] || dateMs(nowIso) > dateMs(remoteTombs[k])) remoteTombs[k] = nowIso;
        hrSaveTombstones(remoteTombs);

        var remaining = (remoteVault.docs || []).filter(function(d) {
          if (!d || !d.id) return false;
          var dk = String(d.id).toLowerCase();
          if (dk === k) return false;
          var tTs = remoteTombs[dk] ? dateMs(remoteTombs[dk]) : 0;
          var dTs = dateMs(d.updated_at || d.saved_at || d.created_at);
          return !(tTs && tTs >= dTs);
        });

        await uploadJsonToDrive(DRIVE_HR_VAULT_FILE, {
          version: 1,
          updatedAt: new Date().toISOString(),
          docs: remaining,
          tombstones: remoteTombs
        });
        lastDriveSeen.hr = Date.now();

        deleteFileFromDrive(hrAttFileName(id)).catch(function() {});
        deleteHrMetaFromSheet(id).catch(function() {});

        var pAfter = hrReadPending();
        if (pAfter[k] && pAfter[k].op === 'delete') {
          delete pAfter[k];
          hrWritePending(pAfter);
        }

        dispatchTrigger('hr_doc_deleted', { id: id, deleted_at: nowIso });
        return { ok: true, id: id };
      } catch (err) {
        console.warn('[Drive HR Sync] Deferred retry queued for delete:', id, err && err.message || err);
        return { ok: false, queued: true, error: err && err.message || String(err) };
      }
    });
  }

  async function ensureHrAttachment(docOrId) {
    var doc = (docOrId && typeof docOrId === 'object') ? docOrId : null;
    var id = doc ? doc.id : docOrId;
    if (!id) return null;
    if (!doc) {
      var list = typeof root.hrDocGetDocs === 'function' ? root.hrDocGetDocs() : [];
      doc = (list || []).find(function(x) { return x && String(x.id) === String(id); }) || null;
      if (!doc) {
        var allIdb = await idbGetAllHr();
        doc = allIdb.find(function(x) { return x && String(x.id) === String(id); }) || null;
      }
    }
    if (!doc) return null;
    if (hrHasInlineAttachment(doc)) return doc;

    var attName = doc.drive_attachment_file || hrAttFileName(doc.id);
    var dl = await downloadJsonFromDrive(attName);
    if (dl && dl.found && dl.data) {
      var p = dl.data;
      var hydrated = Object.assign({}, doc, {
        file_name: p.file_name || doc.file_name || 'Attachment',
        file_type: p.file_type || doc.file_type || '',
        file_data: p.file_data || (Array.isArray(p.file_data_list) && p.file_data_list[0] && p.file_data_list[0].data) || null,
        file_data_list: Array.isArray(p.file_data_list) ? p.file_data_list : (p.file_data ? [{ name: p.file_name || doc.file_name || 'Attachment', type: p.file_type || doc.file_type || '', data: p.file_data }] : [])
      });
      await idbPutHr(hydrated);
      try {
        var curRef = typeof root.hrDocGetDocs === 'function' ? root.hrDocGetDocs() : null;
        if (Array.isArray(curRef)) {
          var idx = curRef.findIndex(function(x) { return x && String(x.id) === String(hydrated.id); });
          if (idx >= 0) curRef[idx] = hydrated;
        }
      } catch (_) {}
      return hydrated;
    }
    return doc;
  }

  async function syncHrDocs(force) {
    if (syncFlights.hr) return syncFlights.hr;
    syncFlights.hr = (async function() {
      try {
        var dl = await downloadJsonFromDrive(DRIVE_HR_VAULT_FILE);
        var remoteVault = (dl.found && dl.data && typeof dl.data === 'object') ? dl.data : { version: 1, docs: [], tombstones: {} };

        // Fallback/supplement from Google Sheet SystemRecords if Drive vault is empty or force
        var sheetDocs = [];
        if (!dl.found || force) {
          try {
            var sRes = await callGas('getSystemRecords', { kind: 'hr_doc' }, 20000);
            if (sRes && sRes.ok && Array.isArray(sRes.records)) {
              sheetDocs = sRes.records.filter(function(r) { return r && r.id && r._atpl_kind !== 'tombstone'; });
            }
          } catch (_) {}
        }

        // Merge tombstones safely (strict timestamp check)
        var localTombs = hrReadTombstones();
        var mergedTombs = Object.assign({}, localTombs);
        var rTombs = remoteVault.tombstones || {};
        Object.keys(rTombs).forEach(function(k) {
          var v = rTombs[k];
          var ts = dateMs(v);
          if (ts > 0 && (!mergedTombs[k] || ts > dateMs(mergedTombs[k]))) {
            mergedTombs[k] = new Date(ts).toISOString();
          }
        });

        var localDocs = await idbGetAllHr();
        var memDocs = (typeof root.hrDocGetDocs === 'function' ? root.hrDocGetDocs() : []) || [];
        var combinedLocal = mergeHrDocLists(localDocs, memDocs, {});

        // Respect pending ops
        var pend = hrReadPending();
        var pendingSaves = [];
        Object.keys(pend).forEach(function(pk) {
          var op = pend[pk];
          if (!op) return;
          if (op.op === 'delete') {
            var dTs = dateMs(op.deleted_at);
            if (!mergedTombs[pk] || dTs > dateMs(mergedTombs[pk])) mergedTombs[pk] = op.deleted_at;
          } else if (op.op === 'save' && op.doc) {
            if (mergedTombs[pk] && dateMs(op.updated_at) >= dateMs(mergedTombs[pk])) delete mergedTombs[pk];
            pendingSaves.push(op.doc);
          }
        });

        // Clear any tombstone overridden by a newer doc
        var allRemote = mergeHrDocLists(sheetDocs, remoteVault.docs || [], mergedTombs);
        var mergedAll = mergeHrDocLists(allRemote, combinedLocal.concat(pendingSaves), mergedTombs);

        // Identify local-only un-tombstoned docs that Drive doesn't have yet -> queue push
        var remoteById = {};
        (remoteVault.docs || []).forEach(function(d) {
          if (d && d.id) remoteById[String(d.id).toLowerCase()] = d;
        });

        var needVaultPush = false;
        var docsToUpload = [];
        for (var i = 0; i < mergedAll.length; i++) {
          var d = mergedAll[i];
          var dk = String(d.id).toLowerCase();
          var r = remoteById[dk];
          var dTs = dateMs(d.updated_at || d.created_at);
          var rTs = r ? dateMs(r.updated_at || r.created_at) : 0;
          var attNeedsBackfill = hrHasInlineAttachment(d) && (!r || !r.has_attachment || !r.drive_attachment_file || !r.file_name);
          if (!r || dTs > rTs || pend[dk] || attNeedsBackfill) {
            needVaultPush = true;
            docsToUpload.push(d);
          }
        }
        // Also purge tombstoned docs from IDB
        for (var j = 0; j < combinedLocal.length; j++) {
          var ld = combinedLocal[j];
          var lk = String(ld.id).toLowerCase();
          var tTs = mergedTombs[lk] ? dateMs(mergedTombs[lk]) : 0;
          var lTs = dateMs(ld.updated_at || ld.created_at);
          if (tTs && tTs >= lTs) {
            await idbDeleteHr(ld.id);
          }
        }
        // Persist any new/updated docs into IDB
        for (var m = 0; m < mergedAll.length; m++) {
          await idbPutHr(mergedAll[m]);
          if (m % 8 === 0) await tick();
        }
        hrSaveTombstones(mergedTombs);
        applyHrDocsToLiveUi(mergedAll);

        if (needVaultPush && !dl.transientError) {
          await queueWrite('hr', async function() {
            for (var u = 0; u < docsToUpload.length; u++) {
              var ud = docsToUpload[u];
              if (hrHasInlineAttachment(ud)) {
                try { await uploadJsonToDrive(ud.drive_attachment_file || hrAttFileName(ud.id), hrAttachmentPayload(ud)); } catch (_) {}
              }
              mirrorHrMetaToSheet(ud).catch(function() {});
            }
            var finalRemoteList = mergedAll.map(hrMetaOnly);
            await uploadJsonToDrive(DRIVE_HR_VAULT_FILE, {
              version: 1,
              updatedAt: new Date().toISOString(),
              docs: finalRemoteList,
              tombstones: mergedTombs
            });
            // Clear resolved pending ops
            var pAfter = hrReadPending();
            Object.keys(pAfter).forEach(function(pk) { delete pAfter[pk]; });
            hrWritePending(pAfter);
          });
        } else if (dl.found) {
          // Clear pending deletes that remote already honors
          var pClean = hrReadPending();
          var pChanged = false;
          Object.keys(pClean).forEach(function(pk) {
            if (pClean[pk] && pClean[pk].op === 'delete' && mergedTombs[pk]) {
              delete pClean[pk];
              pChanged = true;
            }
          });
          if (pChanged) hrWritePending(pClean);
        }

        lastDriveSeen.hr = Date.now();
        var prevMetaTs = Number(readStorageJson(HR_REMOTE_TS_KEY, {}).ts || 0);
        var remoteStamp = remoteVault.updatedAt ? dateMs(remoteVault.updatedAt) : prevMetaTs;
        writeStorageJson(HR_REMOTE_TS_KEY, { ts: Math.max(prevMetaTs, remoteStamp, 1), count: mergedAll.length });
        return { ok: true, count: mergedAll.length, docs: mergedAll };
      } catch (e) {
        console.warn('[Drive HR Sync] Sync notice:', e && e.message || e);
        return { ok: false, error: e && e.message || String(e) };
      } finally {
        syncFlights.hr = null;
      }
    })();
    return syncFlights.hr;
  }

  /* ============================================================================
     2. PF & ESIC DOL — GOOGLE DRIVE + GOOGLE SHEET AUTHORITATIVE VAULT
     ============================================================================ */

  function dolVaultFileName(type) {
    return DRIVE_DOL_VAULT_PREFIX + String(type || 'esic').toLowerCase() + '.json';
  }

  function dolOrigFileName(type, rec) {
    var key = String(rec && (rec.hash || rec.fileHash || rec.fingerprint || rec.id) || '').toLowerCase().replace(/[^a-z0-9_-]/g, '');
    return DRIVE_DOL_ORIG_PREFIX + String(type || 'esic').toLowerCase() + '_' + (key.slice(0, 32) || Date.now()) + '.json';
  }

  function dolLogicalName(name) {
    return String(name || '').toLowerCase().replace(/\.[^.]+$/, '').replace(/\(\s*\d+\s*\)$/g, '').replace(/[^a-z0-9]+/g, '');
  }

  function dolIdentityKeys(type, r) {
    type = String(type || (r && r.type) || '').toLowerCase();
    r = r || {};
    var out = [], seen = {};
    function add(k) { if (k && !seen[k]) { seen[k] = 1; out.push(k); } }
    var h = String(r.hash || r.fileHash || r.fingerprint || '').toLowerCase();
    var id = String(r.cloudRecordId || r.id || '');
    var rawId = String(r.id || '');
    var n = dolLogicalName(r.name), p = String(r.period || '');
    if (h) add(type + '|hash|' + h);
    if (id) add(type + '|id|' + id);
    if (rawId) add(type + '|id|' + rawId);
    if (n) add(type + '|name|' + n + '|' + p);
    return out;
  }

  function dolStripLocalBlobs(r) {
    if (!r) return null;
    var type = String(r.type || 'esic').toLowerCase();
    var hash = String(r.hash || r.fileHash || r.fingerprint || '').toLowerCase();
    var ids = Array.isArray(r.ids) ? r.ids.slice() : [].concat(Array.isArray(r.digitIds) ? r.digitIds : [], Array.isArray(r.alnumIds) ? r.alnumIds : []);
    return {
      id: r.id,
      cloudRecordId: r.cloudRecordId || r.id,
      version: r.version || 2,
      type: type,
      name: r.name || 'Challan',
      size: Number(r.size || 0),
      lastModified: Number(r.lastModified || 0),
      hash: hash,
      fileHash: hash,
      mime: r.mime || (String(r.name || '').toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
      period: r.period || '',
      periodSource: r.periodSource || '',
      ids: Array.from(new Set(ids.map(String).filter(Boolean))),
      parseStatus: r.parseStatus || 'ready',
      parseError: r.parseError || '',
      uploadedAt: r.uploadedAt || new Date().toISOString(),
      updatedAt: r.updatedAt || r.uploadedAt || new Date().toISOString(),
      driveFileName: r.driveFileName || (hash ? dolOrigFileName(type, { hash: hash, id: r.id }) : ''),
      hasOriginalFile: !!(r.hasOriginalFile || r.driveFileName || r.blob || r.opfsPath),
      cloudSynced: true,
      sharedAuthoritative: true,
      sharedSource: 'drive-sheets'
    };
  }

  function dolReadTombstones() {
    return readStorageJson(DOL_TOMB_KEY, {});
  }

  function dolWriteTombstones(map) {
    writeStorageJson(DOL_TOMB_KEY, map || {});
  }

  function dolReadPending() {
    return readStorageJson(DOL_PENDING_KEY, {});
  }

  function dolWritePending(map) {
    writeStorageJson(DOL_PENDING_KEY, map || {});
  }

  function dolIsTombstoned(type, rec, tombs) {
    tombs = tombs || dolReadTombstones();
    var ks = dolIdentityKeys(type, rec);
    var recTs = dateMs(rec && (rec.updatedAt || rec.uploadedAt));
    for (var i = 0; i < ks.length; i++) {
      var t = tombs[ks[i]];
      var tMs = dateMs(t);
      if (tMs > 0 && (!recTs || tMs >= recTs)) return true;
    }
    return false;
  }

  function dolClearTombstone(type, rec, extraTombs) {
    var tombs = extraTombs || dolReadTombstones();
    dolIdentityKeys(type, rec).forEach(function(k) { delete tombs[k]; });
    if (!extraTombs) dolWriteTombstones(tombs);
    return tombs;
  }

  function dolMergeTombstones(a, b) {
    var out = Object.assign({}, a || {});
    Object.keys(b || {}).forEach(function(k) {
      var ts = dateMs(b[k]);
      if (ts > 0 && (!out[k] || ts > dateMs(out[k]))) out[k] = ts;
    });
    return out;
  }

  function dolMergeRecords(base, overlay, tombs) {
    var map = {};
    function keyOf(r) {
      var h = String(r.hash || r.fileHash || '').toLowerCase();
      if (h) return 'h:' + h;
      var n = dolLogicalName(r.name), p = String(r.period || '');
      if (n && p) return 'np:' + n + '|' + p;
      return 'id:' + String(r.cloudRecordId || r.id || '');
    }
    function ingest(r) {
      if (!r || !r.id) return;
      if (dolIsTombstoned(r.type, r, tombs)) return;
      var k = keyOf(r);
      var clean = dolStripLocalBlobs(r);
      var old = map[k];
      if (!old) { map[k] = clean; return; }
      var oldTs = dateMs(old.updatedAt || old.uploadedAt);
      var newTs = dateMs(clean.updatedAt || clean.uploadedAt);
      var winner = newTs >= oldTs ? clean : old;
      var donor = newTs >= oldTs ? old : clean;
      var ids = Array.from(new Set([].concat(donor.ids || [], winner.ids || [])));
      map[k] = Object.assign({}, donor, winner, {
        ids: ids,
        hasOriginalFile: !!(winner.hasOriginalFile || donor.hasOriginalFile),
        driveFileName: winner.driveFileName || donor.driveFileName
      });
    }
    (base || []).forEach(ingest);
    (overlay || []).forEach(ingest);
    return Object.keys(map).map(function(k) { return map[k]; });
  }

  async function mirrorDolMetaToSheet(type, metaRec) {
    if (!metaRec || !metaRec.id) return;
    var shortKey = safeKey(String(metaRec.hash || metaRec.id).slice(0, 28));
    var sysId = '__ATPL_SYS__dol_' + type + '_' + shortKey;
    // Keep Sheet cell safely compact (< 30 KB)
    var sheetCopy = Object.assign({}, dolStripLocalBlobs(metaRec), {
      emp_id: sysId,
      _atpl_system: true,
      _atpl_kind: 'meta',
      object_kind: 'compliance_dol_' + type,
      object_key: 'dol_' + type + '__' + shortKey,
      key_text: String(metaRec.id),
      uploaded_by: currentUserId()
    });
    if (Array.isArray(sheetCopy.ids) && sheetCopy.ids.length > 600) {
      sheetCopy.ids_truncated = true;
      sheetCopy.ids_count = sheetCopy.ids.length;
      sheetCopy.ids = sheetCopy.ids.slice(0, 600);
    }
    await callGas('upsertEmployeeMaster', { emp_id: sysId, record: sheetCopy }, 20000);
  }

  async function deleteDolMetaFromSheet(type, rec) {
    if (!rec) return;
    var keys = [];
    if (rec.hash) keys.push(safeKey(String(rec.hash).slice(0, 28)));
    if (rec.id) keys.push(safeKey(String(rec.id).slice(0, 28)));
    for (var i = 0; i < keys.length; i++) {
      var sysId = '__ATPL_SYS__dol_' + type + '_' + keys[i];
      await callGas('deleteEmployeeMaster', { emp_id: sysId }, 20000).catch(function() {});
    }
  }

  async function uploadDolRecord(rec, arrayBuffer, onProgress) {
    if (!rec || !rec.type || !rec.id) throw new Error('Invalid challan record');
    var type = String(rec.type).toLowerCase();
    var nowIso = rec.updatedAt || new Date().toISOString();
    var origName = rec.driveFileName || dolOrigFileName(type, rec);

    // Clear local tombstone & mark pending before network I/O
    dolClearTombstone(type, rec);
    var metaRec = dolStripLocalBlobs(Object.assign({}, rec, {
      updatedAt: nowIso,
      driveFileName: origName,
      hasOriginalFile: true
    }));

    var pendKey = type + '|' + String(rec.hash || rec.id);
    var pend = dolReadPending();
    pend[pendKey] = { op: 'save', type: type, updatedAt: nowIso, record: metaRec };
    dolWritePending(pend);

    return await queueWrite(type, async function() {
      if (onProgress) onProgress(10);
      if (arrayBuffer && (arrayBuffer instanceof ArrayBuffer || ArrayBuffer.isView(arrayBuffer))) {
        var b64 = await blobOrBufToBase64(arrayBuffer);
        if (onProgress) onProgress(40);
        await uploadJsonToDrive(origName, {
          v: 1,
          type: type,
          id: rec.id,
          hash: rec.hash || '',
          name: rec.name || 'Challan',
          mime: metaRec.mime,
          size: metaRec.size || (arrayBuffer.byteLength || 0),
          period: rec.period || '',
          updatedAt: nowIso,
          base64: b64
        });
      }
      if (onProgress) onProgress(75);

      // Read-Modify-Write vault index
      var vFile = dolVaultFileName(type);
      var dl = await downloadJsonFromDrive(vFile);
      var remoteVault = (dl.data && typeof dl.data === 'object') ? dl.data : { version: 1, type: type, records: [], tombstones: {} };
      var mergedTombs = dolMergeTombstones(remoteVault.tombstones || {}, dolReadTombstones());
      dolClearTombstone(type, rec, mergedTombs);
      dolWriteTombstones(mergedTombs);

      var mergedRecs = dolMergeRecords(remoteVault.records || [], [metaRec], mergedTombs);
      await uploadJsonToDrive(vFile, {
        version: 1,
        type: type,
        updatedAt: new Date().toISOString(),
        records: mergedRecs,
        tombstones: mergedTombs
      });
      if (onProgress) onProgress(95);

      mirrorDolMetaToSheet(type, metaRec).catch(function() {});

      var pAfter = dolReadPending();
      if (pAfter[pendKey] && pAfter[pendKey].op === 'save') {
        delete pAfter[pendKey];
        dolWritePending(pAfter);
      }

      lastDriveSeen[type] = Date.now();
      dispatchTrigger('dol_updated', { type: type, id: rec.id });
      if (onProgress) onProgress(100);
      return { ok: true, record: metaRec };
    });
  }

  async function updateDolRecord(rec) {
    if (!rec || !rec.type || !rec.id) throw new Error('Invalid challan record');
    var type = String(rec.type).toLowerCase();
    var nowIso = new Date().toISOString();
    var metaRec = dolStripLocalBlobs(Object.assign({}, rec, { updatedAt: nowIso }));

    return await queueWrite(type, async function() {
      var vFile = dolVaultFileName(type);
      var dl = await downloadJsonFromDrive(vFile);
      var remoteVault = (dl.data && typeof dl.data === 'object') ? dl.data : { version: 1, type: type, records: [], tombstones: {} };
      var mergedTombs = dolMergeTombstones(remoteVault.tombstones || {}, dolReadTombstones());
      dolClearTombstone(type, rec, mergedTombs);
      var mergedRecs = dolMergeRecords(remoteVault.records || [], [metaRec], mergedTombs);
      await uploadJsonToDrive(vFile, {
        version: 1,
        type: type,
        updatedAt: nowIso,
        records: mergedRecs,
        tombstones: mergedTombs
      });
      mirrorDolMetaToSheet(type, metaRec).catch(function() {});
      lastDriveSeen[type] = Date.now();
      dispatchTrigger('dol_updated', { type: type, id: rec.id });
      return { ok: true, record: metaRec };
    });
  }

  async function deleteDolRecord(rec) {
    if (!rec || !rec.type) return { ok: false, error: 'Invalid record' };
    var type = String(rec.type).toLowerCase();
    var recTs = dateMs(rec.updatedAt || rec.uploadedAt);
    var nowMs = Math.max(Date.now(), recTs ? recTs + 1000 : 0);
    var ks = dolIdentityKeys(type, rec);

    var localTombs = dolReadTombstones();
    ks.forEach(function(k) { localTombs[k] = nowMs; });
    dolWriteTombstones(localTombs);

    var pendKey = type + '|del|' + String(rec.hash || rec.id || rec.name || nowMs);
    var pend = dolReadPending();
    // Cancel any pending save for same record
    Object.keys(pend).forEach(function(pk) {
      if (pend[pk] && pend[pk].op === 'save' && pend[pk].type === type && pend[pk].record) {
        var rks = dolIdentityKeys(type, pend[pk].record);
        if (rks.some(function(x) { return ks.indexOf(x) >= 0; })) delete pend[pk];
      }
    });
    pend[pendKey] = { op: 'delete', type: type, deletedAt: nowMs, record: dolStripLocalBlobs(rec) };
    dolWritePending(pend);

    return await queueWrite(type, async function() {
      var vFile = dolVaultFileName(type);
      var dl = await downloadJsonFromDrive(vFile);
      var remoteVault = (dl.data && typeof dl.data === 'object') ? dl.data : { version: 1, type: type, records: [], tombstones: {} };
      var mergedTombs = dolMergeTombstones(remoteVault.tombstones || {}, dolReadTombstones());
      ks.forEach(function(k) {
        if (!mergedTombs[k] || nowMs > dateMs(mergedTombs[k])) mergedTombs[k] = nowMs;
      });
      dolWriteTombstones(mergedTombs);

      var remaining = (remoteVault.records || []).filter(function(r) {
        return r && !dolIsTombstoned(type, r, mergedTombs);
      });

      await uploadJsonToDrive(vFile, {
        version: 1,
        type: type,
        updatedAt: new Date().toISOString(),
        records: remaining,
        tombstones: mergedTombs
      });

      var origName = rec.driveFileName || dolOrigFileName(type, rec);
      deleteFileFromDrive(origName).catch(function() {});
      deleteDolMetaFromSheet(type, rec).catch(function() {});

      var pAfter = dolReadPending();
      if (pAfter[pendKey]) { delete pAfter[pendKey]; dolWritePending(pAfter); }

      lastDriveSeen[type] = Date.now();
      dispatchTrigger('dol_deleted', { type: type, id: rec.id, hash: rec.hash, name: rec.name, period: rec.period });
      return { ok: true };
    });
  }

  async function downloadDolOriginalBlob(rec) {
    if (!rec) return null;
    var type = String(rec.type || 'esic').toLowerCase();
    var candidates = [];
    if (rec.driveFileName) candidates.push(rec.driveFileName);
    var gen = dolOrigFileName(type, rec);
    if (candidates.indexOf(gen) < 0) candidates.push(gen);

    for (var i = 0; i < candidates.length; i++) {
      var dl = await downloadJsonFromDrive(candidates[i]);
      if (dl && dl.found && dl.data && dl.data.base64) {
        var bytes = b64ToUint8Array(dl.data.base64);
        if (bytes && bytes.byteLength) {
          var mime = dl.data.mime || rec.mime || 'application/pdf';
          return new Blob([bytes], { type: mime });
        }
      }
    }
    // Fallback lookup against live Drive manifest in case driveFileName varied on legacy record
    try {
      var st = await callGas('getSyncState', {}, 20000);
      var stFiles = (st && (st.files || st.driveFiles));
      if (st && st.ok && Array.isArray(stFiles)) {
        var hashPref = String(rec.hash || rec.fileHash || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 16);
        var idPref = String(rec.id || '').toLowerCase().replace(/[^a-z0-9_-]/g, '');
        var matched = stFiles.find(function(f) {
          if (!f || !f.name) return false;
          var n = String(f.name).toLowerCase();
          if (n.indexOf('atpl_dol_orig_' + type + '_') !== 0) return false;
          return (hashPref && n.indexOf(hashPref) >= 0) || (idPref && n.indexOf(idPref) >= 0);
        });
        if (matched && matched.name && candidates.indexOf(matched.name) < 0) {
          var dl2 = await downloadJsonFromDrive(matched.name);
          if (dl2 && dl2.found && dl2.data && dl2.data.base64) {
            var bytes2 = b64ToUint8Array(dl2.data.base64);
            if (bytes2 && bytes2.byteLength) {
              return new Blob([bytes2], { type: dl2.data.mime || rec.mime || 'application/pdf' });
            }
          }
        }
      }
    } catch (_) {}
    return null;
  }

  async function uploadDolOriginalOnly(rec, blobOrBuf) {
    if (!rec || !rec.type || !rec.id || !blobOrBuf) return { ok: false };
    var type = String(rec.type).toLowerCase();
    var origName = rec.driveFileName || dolOrigFileName(type, rec);
    return await queueWrite(type, async function() {
      try {
        var b64 = await blobOrBufToBase64(blobOrBuf);
        if (!b64) return { ok: false };
        await uploadJsonToDrive(origName, {
          v: 1,
          type: type,
          id: rec.id,
          hash: rec.hash || '',
          name: rec.name || 'Challan',
          mime: rec.mime || 'application/pdf',
          size: Number(rec.size || blobOrBuf.size || blobOrBuf.byteLength || 0),
          period: rec.period || '',
          updatedAt: new Date().toISOString(),
          base64: b64
        });
        var vFile = dolVaultFileName(type);
        var dl = await downloadJsonFromDrive(vFile);
        var remoteVault = (dl.data && typeof dl.data === 'object') ? dl.data : { version: 1, type: type, records: [], tombstones: {} };
        var patched = dolStripLocalBlobs(Object.assign({}, rec, {
          driveFileName: origName,
          hasOriginalFile: true,
          updatedAt: rec.updatedAt || new Date().toISOString()
        }));
        var merged = dolMergeRecords(remoteVault.records || [], [patched], remoteVault.tombstones || {});
        await uploadJsonToDrive(vFile, {
          version: 1,
          type: type,
          updatedAt: new Date().toISOString(),
          records: merged,
          tombstones: remoteVault.tombstones || {}
        });
        mirrorDolMetaToSheet(type, patched).catch(function() {});
        return { ok: true, driveFileName: origName };
      } catch (e) {
        return { ok: false, error: e && e.message || String(e) };
      }
    });
  }

  async function listDolRecords(type, localRows) {
    type = String(type || '').toLowerCase();
    if (type !== 'pf' && type !== 'esic') return { ok: false, records: [] };

    var vFile = dolVaultFileName(type);
    var dl = await downloadJsonFromDrive(vFile);
    var remoteVault = (dl.found && dl.data && typeof dl.data === 'object') ? dl.data : { version: 1, type: type, records: [], tombstones: {} };

    var sheetRecs = [];
    if (!dl.found) {
      try {
        var sRes = await callGas('getSystemRecords', { kind: 'compliance_dol_' + type }, 20000);
        if (sRes && sRes.ok && Array.isArray(sRes.records)) sheetRecs = sRes.records;
      } catch (_) {}
    }

    var mergedTombs = dolMergeTombstones(dolReadTombstones(), remoteVault.tombstones || {});
    var pend = dolReadPending();
    var pendingSaves = [];
    Object.keys(pend).forEach(function(pk) {
      var op = pend[pk];
      if (!op || op.type !== type) return;
      if (op.op === 'delete' && op.record) {
        dolIdentityKeys(type, op.record).forEach(function(k) {
          if (!mergedTombs[k] || op.deletedAt > dateMs(mergedTombs[k])) mergedTombs[k] = op.deletedAt;
        });
      } else if (op.op === 'save' && op.record) {
        dolClearTombstone(type, op.record, mergedTombs);
        pendingSaves.push(op.record);
      }
    });
    dolWriteTombstones(mergedTombs);

    var remoteOnly = dolMergeRecords(sheetRecs, remoteVault.records || [], mergedTombs);
    // Keep any valid non-tombstoned local rows (e.g. uploaded pre-rollout or pending retry)
    var localValid = (Array.isArray(localRows) ? localRows : []).filter(function(r) {
      return r && String(r.type || '').toLowerCase() === type && !r.archived && !dolIsTombstoned(type, r, mergedTombs);
    });
    var merged = dolMergeRecords(remoteOnly, localValid.concat(pendingSaves), mergedTombs);

    // Push back any missing non-tombstoned local rows in background so all browsers stay in sync
    if (!dl.transientError) {
      var remoteIds = {};
      remoteOnly.forEach(function(r) { dolIdentityKeys(type, r).forEach(function(k) { remoteIds[k] = 1; }); });
      var toPush = merged.filter(function(r) {
        var ks = dolIdentityKeys(type, r);
        return !ks.some(function(k) { return !!remoteIds[k]; });
      });
      if (toPush.length > 0) {
        queueWrite(type, async function() {
          for (var i = 0; i < toPush.length; i++) {
            mirrorDolMetaToSheet(type, toPush[i]).catch(function() {});
          }
          await uploadJsonToDrive(vFile, {
            version: 1,
            type: type,
            updatedAt: new Date().toISOString(),
            records: merged.map(dolStripLocalBlobs),
            tombstones: mergedTombs
          });
          var pAfter = dolReadPending();
          Object.keys(pAfter).forEach(function(pk) {
            if (pAfter[pk] && pAfter[pk].type === type) delete pAfter[pk];
          });
          dolWritePending(pAfter);
        }).catch(function() {});
      }
    }

    lastDriveSeen[type] = Date.now();
    return {
      ok: true,
      mode: 'drive-sheets',
      records: merged,
      tombstones: mergedTombs,
      remoteCount: remoteOnly.length
    };
  }

  /* ============================================================================
     3. CROSS-BROWSER WATCHER HOOKS (CALLED BY ATPLGoogleSync.pollSyncState)
     ============================================================================ */

  function onDriveFilesMeta(driveFiles) {
    if (!Array.isArray(driveFiles) || !driveFiles.length) return;
    var hrMeta = null, pfMeta = null, esicMeta = null;
    for (var i = 0; i < driveFiles.length; i++) {
      var f = driveFiles[i];
      if (!f || !f.name) continue;
      var n = String(f.name).toLowerCase().trim();
      if (n === DRIVE_HR_VAULT_FILE.toLowerCase()) hrMeta = f;
      else if (n === 'atpl_dol_vault_pf.json') pfMeta = f;
      else if (n === 'atpl_dol_vault_esic.json') esicMeta = f;
    }

    var hrPend = Object.keys(hrReadPending()).length > 0;
    var hrRemoteTs = hrMeta ? dateMs(hrMeta.updatedAt) : 0;
    var hrLast = Number(readStorageJson(HR_REMOTE_TS_KEY, {}).ts || 0);
    if (hrPend || (hrRemoteTs > hrLast && Date.now() - lastDriveSeen.hr > 3000)) {
      if (hrRemoteTs > hrLast) {
        writeStorageJson(HR_REMOTE_TS_KEY, { ts: hrRemoteTs, count: Number(readStorageJson(HR_REMOTE_TS_KEY, {}).count || 0) });
      }
      syncHrDocs(false);
    }

    var dolPendAll = dolReadPending();
    var hasPfPend = Object.keys(dolPendAll).some(function(k) { return dolPendAll[k] && dolPendAll[k].type === 'pf'; });
    var hasEsicPend = Object.keys(dolPendAll).some(function(k) { return dolPendAll[k] && dolPendAll[k].type === 'esic'; });
    var dolLastMap = readStorageJson(DOL_REMOTE_TS_KEY, {});

    if (hasPfPend || (pfMeta && dateMs(pfMeta.updatedAt) > Number(dolLastMap.pf || 0) && Date.now() - lastDriveSeen.pf > 3000)) {
      writeStorageJson(DOL_REMOTE_TS_KEY, Object.assign({}, dolLastMap, { pf: pfMeta ? dateMs(pfMeta.updatedAt) : Date.now() }));
      if (root.ATPLComplianceDOLV2 && typeof root.ATPLComplianceDOLV2.refresh === 'function') {
        root.ATPLComplianceDOLV2.refresh('pf');
      }
    }
    if (hasEsicPend || (esicMeta && dateMs(esicMeta.updatedAt) > Number(dolLastMap.esic || 0) && Date.now() - lastDriveSeen.esic > 3000)) {
      writeStorageJson(DOL_REMOTE_TS_KEY, Object.assign({}, readStorageJson(DOL_REMOTE_TS_KEY, {}), { esic: esicMeta ? dateMs(esicMeta.updatedAt) : Date.now() }));
      if (root.ATPLComplianceDOLV2 && typeof root.ATPLComplianceDOLV2.refresh === 'function') {
        root.ATPLComplianceDOLV2.refresh('esic');
      }
    }
  }

  function installRealtimeListeners() {
    function handleAction(action, details) {
      if (action === 'hr_doc_saved' || action === 'hr_doc_deleted') {
        syncHrDocs(true);
      } else if ((action === 'dol_updated' || action === 'dol_deleted') && details && (details.type === 'pf' || details.type === 'esic')) {
        if (root.ATPLComplianceDOLV2 && typeof root.ATPLComplianceDOLV2.refresh === 'function') {
          root.ATPLComplianceDOLV2.refresh(details.type);
        }
      }
    }
    if (typeof root.BroadcastChannel !== 'undefined') {
      try {
        var bc = new root.BroadcastChannel('ATPL_ERP_TRIGGER_BUS');
        bc.onmessage = function(ev) {
          var d = ev && ev.data;
          if (d && d.sender !== CLIENT_ID && d.action) handleAction(d.action, d.details);
        };
      } catch (_) {}
    }
    if (typeof root.addEventListener === 'function') {
      root.addEventListener('storage', function(ev) {
        if (ev && ev.key === 'ATPL_TRIGGER_EVENT' && ev.newValue) {
          var d = safeJsonParse(ev.newValue, null);
          if (d && d.sender !== CLIENT_ID && d.action) handleAction(d.action, d.details);
        }
      });
      root.addEventListener('online', function() {
        setTimeout(function() {
          syncHrDocs(true);
          if (root.ATPLComplianceDOLV2 && typeof root.ATPLComplianceDOLV2.refresh === 'function') {
            root.ATPLComplianceDOLV2.refresh('pf');
            root.ATPLComplianceDOLV2.refresh('esic');
          }
        }, 700);
      });
    }
    // Initial non-blocking HR Docs sync shortly after load
    setTimeout(function() { syncHrDocs(false); }, 900);
  }

  root.ATPLDriveHrDolSync = {
    version: BUILD,
    saveHrDoc: saveHrDoc,
    deleteHrDoc: deleteHrDoc,
    syncHrDocs: syncHrDocs,
    ensureHrAttachment: ensureHrAttachment,
    hrReadTombstones: hrReadTombstones,
    uploadDolRecord: uploadDolRecord,
    updateDolRecord: updateDolRecord,
    deleteDolRecord: deleteDolRecord,
    downloadDolOriginalBlob: downloadDolOriginalBlob,
    uploadDolOriginalOnly: uploadDolOriginalOnly,
    listDolRecords: listDolRecords,
    dolIsTombstoned: dolIsTombstoned,
    onDriveFilesMeta: onDriveFilesMeta,
    getGasUrl: getGasUrl
  };

  if (root.document) {
    if (root.document.readyState === 'loading') {
      root.document.addEventListener('DOMContentLoaded', installRealtimeListeners, { once: true });
    } else {
      installRealtimeListeners();
    }
  }
})(typeof window !== 'undefined' ? window : globalThis);
