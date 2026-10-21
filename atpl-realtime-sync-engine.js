/**
 * ATPL PURE GOOGLE DRIVE + GOOGLE SHEET REAL-TIME SYNC ENGINE (v2026.11.01)
 * ─────────────────────────────────────────────────────────────────────────
 * Connected to Live Google Apps Script Vault:
 * https://script.google.com/macros/s/AKfycbwHjuIFasUeW_QosnwssfpqDKp2yU2ZYqY28vkqdYc5tXsCgkY0KCuBL1nuaZZE3s5c/exec
 * ─────────────────────────────────────────────────────────────────────────
 */
(function(window) {
  'use strict';

  // ✅ Tera Live Google Apps Script URL yahan permanently set hai:
  var DEFAULT_GAS_URL = 'https://script.google.com/macros/s/AKfycbwHjuIFasUeW_QosnwssfpqDKp2yU2ZYqY28vkqdYc5tXsCgkY0KCuBL1nuaZZE3s5c/exec';

  function getGasUrl() {
    try {
      var saved = localStorage.getItem('ATPL_GAS_MASTER_URL');
      if (saved && saved.indexOf('https://script.google.com') === 0) return saved.trim();
    } catch (_) {}
    return DEFAULT_GAS_URL;
  }

  // Save URL in localStorage so all tabs/modules use the exact same live endpoint
  try { localStorage.setItem('ATPL_GAS_MASTER_URL', DEFAULT_GAS_URL); } catch (_) {}

  window.ATPLSetGoogleBackendUrl = function(url) {
    if (!url || url.indexOf('https://script.google.com') !== 0) return false;
    localStorage.setItem('ATPL_GAS_MASTER_URL', url.trim());
    if (window.showToast) window.showToast('✅ Google Drive + Sheet Backend Connected! Syncing now...');
    triggerUniversalReconciliation(true);
    return true;
  };

  // Kill all old conflicting backends immediately (Firebase, Supabase, dead Cloud Run, GitHub JSON)
  window.__atplFirebaseQuotaExhausted = true;
  window.LIVE_CLOUD_RUN_URL = '';
  window.__ATPL_CENTRAL_BACKEND_URL = '';
  window.ATPL_GET_API_BASE = function() { return ''; };

  // Clean old ghost cache once on upgrade to Google Drive Engine
  var ENGINE_SCHEMA = 'ATPL_GDRIVE_MASTER_LIVE_V2';
  try {
    if (localStorage.getItem('ATPL_SYNC_SCHEMA_VER') !== ENGINE_SCHEMA) {
      localStorage.setItem('ATPL_SYNC_SCHEMA_VER', ENGINE_SCHEMA);
      localStorage.removeItem('ATPL_ALL_SALARY_CLEARED_AT');
      localStorage.removeItem('ATPL_SALARY_TOMBSTONES_V2');
      localStorage.removeItem('ATPL_HR_TOMBSTONES_V1');
      localStorage.removeItem('ATPL_HR_TOMBSTONES_V2');
    }
  } catch (_) {}

  // Base64 <-> ArrayBuffer Helpers
  function arrayBufferToBase64(buffer) {
    if (!buffer) return '';
    if (typeof buffer === 'string') return buffer.indexOf(',') >= 0 ? buffer.split(',')[1] : buffer;
    var bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    var binary = '';
    var chunkSize = 8192;
    for (var i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  }

  function base64ToArrayBuffer(base64) {
    if (!base64) return new ArrayBuffer(0);
    if (base64 instanceof ArrayBuffer) return base64;
    if (base64 instanceof Uint8Array) return base64.buffer;
    var clean = String(base64);
    if (clean.indexOf(',') >= 0) clean = clean.split(',')[1];
    clean = clean.replace(/\s+/g, '');
    var binary = atob(clean);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }

  window.atplBufToB64 = arrayBufferToBase64;
  window.atplB64ToBuf = base64ToArrayBuffer;

  // Track session uploads
  window.__ATPL_SESSION_UPLOADS = { salary: {}, hr_doc: {}, pf: {}, esic: {} };
  window.atplMarkSessionUpload = function(mod, key) {
    var m = String(mod || 'salary').toLowerCase().trim();
    var k = String(key || '').toLowerCase().trim();
    if (!window.__ATPL_SESSION_UPLOADS[m]) window.__ATPL_SESSION_UPLOADS[m] = {};
    if (k) window.__ATPL_SESSION_UPLOADS[m][k] = Date.now();
  };
  window.atplClearSessionUpload = function(mod, key) {
    var m = String(mod || 'salary').toLowerCase().trim();
    var k = String(key || '').toLowerCase().trim();
    if (window.__ATPL_SESSION_UPLOADS[m] && k) delete window.__ATPL_SESSION_UPLOADS[m][k];
  };
  window.atplIsRecentSessionUpload = function(mod, key, maxAgeMs) {
    var m = String(mod || 'salary').toLowerCase().trim();
    var k = String(key || '').toLowerCase().trim();
    var ts = (window.__ATPL_SESSION_UPLOADS[m] && window.__ATPL_SESSION_UPLOADS[m][k]) || 0;
    return ts > 0 && (Date.now() - ts) < (maxAgeMs || 60000);
  };

  // ── GOOGLE APPS SCRIPT NETWORK TRANSPORT (CORS-Safe text/plain POST) ──
  async function gasGet(params) {
    var baseUrl = getGasUrl();
    if (!baseUrl || baseUrl.indexOf('https://script.google.com') !== 0) return null;
    var qs = Object.keys(params || {}).map(function(k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
    }).join('&');
    var url = baseUrl + (baseUrl.indexOf('?') >= 0 ? '&' : '?') + qs + '&_t=' + Date.now();
    var res = await fetch(url, { method: 'GET', cache: 'no-store', redirect: 'follow' });
    if (!res.ok) throw new Error('GAS GET HTTP ' + res.status);
    return await res.json();
  }

  async function gasPost(payloadObj) {
    var baseUrl = getGasUrl();
    if (!baseUrl || baseUrl.indexOf('https://script.google.com') !== 0) return null;
    var res = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payloadObj),
      redirect: 'follow'
    });
    if (!res.ok) throw new Error('GAS POST HTTP ' + res.status);
    return await res.json();
  }

  // ── LOCAL PURGE FUNCTIONS (Immediate UI + IndexedDB Cleanup) ──
  function purgeLocalSalaryFile(name, deletedAtIso) {
    var targetName = String(name || '').toLowerCase().trim();
    if (!targetName) return;
    window.atplClearSessionUpload('salary', targetName);

    try {
      var tombs = JSON.parse(localStorage.getItem('ATPL_SALARY_TOMBSTONES_V2') || '{}');
      tombs[targetName] = deletedAtIso || new Date().toISOString();
      localStorage.setItem('ATPL_SALARY_TOMBSTONES_V2', JSON.stringify(tombs));
    } catch (_) {}

    if (Array.isArray(window.FILES)) {
      window.FILES = window.FILES.filter(function(x) {
        return x && String(x.name || '').toLowerCase().trim() !== targetName && String(x.id || '').toLowerCase().trim() !== targetName;
      });
    }
    if (window.ATPLCentralFileSync && window.ATPLCentralFileSync.fileMap) {
      window.ATPLCentralFileSync.fileMap.delete(targetName);
    }

    try {
      var req = indexedDB.open('AroraTextiles', 1);
      req.onsuccess = function(e) {
        var db = e.target.result;
        if (db.objectStoreNames.contains('salaryFiles')) {
          var store = db.transaction('salaryFiles', 'readwrite').objectStore('salaryFiles');
          try { store.delete(name); } catch (_) {}
          var cur = store.openCursor();
          cur.onsuccess = function(ev) {
            var c = ev.target.result;
            if (c) {
              if (c.value && String(c.value.name || '').toLowerCase().trim() === targetName) c.delete();
              c.continue();
            }
          };
        }
      };
    } catch (_) {}

    refreshAllUI();
  }

  function purgeAllSalaryFilesLocal(clearedAtIso) {
    try { localStorage.setItem('ATPL_ALL_SALARY_CLEARED_AT', clearedAtIso || new Date().toISOString()); } catch (_) {}
    window.FILES = [];
    if (window.ATPLCentralFileSync && window.ATPLCentralFileSync.fileMap) {
      window.ATPLCentralFileSync.fileMap.clear();
    }
    try {
      var req = indexedDB.open('AroraTextiles', 1);
      req.onsuccess = function(e) {
        var db = e.target.result;
        if (db.objectStoreNames.contains('salaryFiles')) {
          db.transaction('salaryFiles', 'readwrite').objectStore('salaryFiles').clear();
        }
      };
    } catch (_) {}
    refreshAllUI();
  }

  function purgeLocalHrDoc(id, name, deletedAtIso) {
    var targetId = String(id || '').toLowerCase().trim();
    var targetName = String(name || id || '').toLowerCase().trim();
    if (!targetId && !targetName) return;

    var stamp = deletedAtIso || new Date().toISOString();
    ['ATPL_HR_TOMBSTONES_V1', 'ATPL_HR_TOMBSTONES_V2'].forEach(function(k) {
      try {
        var t = JSON.parse(localStorage.getItem(k) || '{}');
        if (targetId) t[targetId] = stamp;
        if (targetName) t[targetName] = stamp;
        localStorage.setItem(k, JSON.stringify(t));
      } catch (_) {}
    });

    if (typeof window.hrDocGetDocs === 'function') {
      var docs = window.hrDocGetDocs();
      if (Array.isArray(docs)) {
        var kept = docs.filter(function(d) {
          if (!d) return false;
          var did = String(d.id || '').toLowerCase().trim();
          var dnm = String(d.document_name || '').toLowerCase().trim();
          return did !== targetId && did !== targetName && dnm !== targetId && dnm !== targetName;
        });
        docs.length = 0;
        Array.prototype.push.apply(docs, kept);
      }
    }

    try {
      var r = indexedDB.open('AroraTextilesHRDocs', 1);
      r.onsuccess = function(e) {
        var db = e.target.result;
        if (db.objectStoreNames.contains('documents')) {
          var store = db.transaction('documents', 'readwrite').objectStore('documents');
          var cur = store.openCursor();
          cur.onsuccess = function(ev) {
            var c = ev.target.result;
            if (c) {
              var v = c.value;
              var vid = String((v && v.id) || '').toLowerCase().trim();
              var vnm = String((v && v.document_name) || '').toLowerCase().trim();
              if (vid === targetId || vid === targetName || vnm === targetId || vnm === targetName) c.delete();
              c.continue();
            }
          };
        }
      };
    } catch (_) {}

    if (typeof window.hrDocRender === 'function') window.hrDocRender();
  }

  function purgeLocalCompliance(mod, id, name, hash) {
    var modType = String(mod || 'pf').toLowerCase().trim();
    var targetId = String(id || '').toLowerCase().trim();
    var targetName = String(name || id || '').toLowerCase().trim();
    var targetHash = String(hash || '').toLowerCase().trim();

    ['ATPL_COMPLIANCE_DOL_V2', 'ATPL_COMPLIANCE_DOL_V1'].forEach(function(dbName) {
      try {
        var req = indexedDB.open(dbName, 1);
        req.onsuccess = function(e) {
          var db = e.target.result;
          var stName = db.objectStoreNames.contains('challans') ? 'challans' : (db.objectStoreNames.contains('files') ? 'files' : '');
          if (!stName) return;
          var store = db.transaction(stName, 'readwrite').objectStore(stName);
          var cur = store.openCursor();
          cur.onsuccess = function(ev) {
            var c = ev.target.result;
            if (c) {
              var rec = c.value;
              if (rec && String(rec.type || '').toLowerCase() === modType) {
                var rid = String(rec.id || '').toLowerCase().trim();
                var rnm = String(rec.name || '').toLowerCase().trim();
                var rhs = String(rec.hash || rec.fileHash || '').toLowerCase().trim();
                if ((targetId && (rid === targetId || rnm === targetId)) ||
                    (targetName && (rnm === targetName || rid === targetName)) ||
                    (targetHash && rhs === targetHash)) {
                  c.delete();
                }
              }
              c.continue();
            }
          };
        };
      } catch (_) {}
    });

    try {
      window.dispatchEvent(new CustomEvent('atpl-dol-supabase-change', {
        detail: { type: modType, action: 'delete', id: id, filename: name, at: Date.now() }
      }));
    } catch (_) {}
  }

  function refreshAllUI() {
    var count = Array.isArray(window.FILES) ? window.FILES.length : 0;
    if (typeof window.renderFiles === 'function') window.renderFiles();
    if (typeof window.renderSheets === 'function') window.renderSheets();
    if (typeof window.updStats === 'function') window.updStats();
    if (typeof window.renderAllFilesPage === 'function') window.renderAllFilesPage();
    if (typeof window.populateNJSelects === 'function') window.populateNJSelects();
    if (typeof window.empDashboardRender === 'function') { try { window.empDashboardRender(); } catch (_) {} }
    if (typeof window.hrDocRender === 'function') { try { window.hrDocRender(); } catch (_) {} }
    if (typeof window.updateRealtimeCloudBadge === 'function') {
      window.updateRealtimeCloudBadge(count, 'ok', '🟢 Google Drive Sync (' + count + ' files)');
    }
  }

  // ── MASTER RECONCILIATION LOOP (Polls Google Sheet every 4 seconds) ──
  var lastSeenVersion = -1;
  var isSyncingNow = false;
  var subscriberCallbacks = { salary: [], hr_doc: [], pf: [], esic: [] };

  async function triggerUniversalReconciliation(forceDownloadCheck) {
    if (isSyncingNow || window.__ATPL_IS_UPLOADING) return;
    var gasUrl = getGasUrl();
    if (!gasUrl || gasUrl.indexOf('https://script.google.com') !== 0) return;

    isSyncingNow = true;
    try {
      var manifest = await gasGet({ action: 'manifest', nocache: forceDownloadCheck ? '1' : '' });
      if (!manifest || !manifest.ok) return;

      if (!forceDownloadCheck && manifest.version === lastSeenVersion) {
        return;
      }
      lastSeenVersion = manifest.version;

      var allFiles = Array.isArray(manifest.files) ? manifest.files : [];
      var allTombs = Array.isArray(manifest.tombstones) ? manifest.tombstones : [];

      // 1. Apply Tombstones (Auto-Delete across all browsers & phones)
      allTombs.forEach(function(t) {
        var mod = String(t.module || '').toLowerCase();
        if (mod === 'salary') {
          if (t.name === '__ALL__' || t.id === '__ALL__') {
            purgeAllSalaryFilesLocal(t.deleted_at);
          } else {
            purgeLocalSalaryFile(t.name || t.id, t.deleted_at);
          }
        } else if (mod === 'hr_doc') {
          purgeLocalHrDoc(t.id, t.name, t.deleted_at);
        } else if (mod === 'pf' || mod === 'esic') {
          purgeLocalCompliance(mod, t.id, t.name, t.file_hash);
        }
      });

      // 2. Reconcile Salary Files (ALL FILES)
      var remoteSalary = allFiles.filter(function(f) { return f.module === 'salary'; });
      var activeSalNames = new Set(remoteSalary.map(function(f) { return String(f.name || '').toLowerCase().trim(); }));

      if (Array.isArray(window.FILES)) {
        var staleLocal = window.FILES.filter(function(lf) {
          var lnm = String((lf && lf.name) || '').toLowerCase().trim();
          return lnm && !activeSalNames.has(lnm) && !window.atplIsRecentSessionUpload('salary', lnm, 45000);
        });
        staleLocal.forEach(function(sf) { purgeLocalSalaryFile(sf.name); });
      }

      var localSalSet = new Set((window.FILES || []).map(function(f) { return f && f.wb ? String(f.name).toLowerCase().trim() : ''; }));
      var salChanged = false;
      for (var i = 0; i < remoteSalary.length; i++) {
        var rSal = remoteSalary[i];
        var rNameLow = String(rSal.name || '').toLowerCase().trim();
        if (!rNameLow || localSalSet.has(rNameLow)) continue;

        var fRes = await gasGet({ action: 'get_file', drive_id: rSal.drive_id, key: rSal.key });
        if (fRes && fRes.ok && fRes.payload) {
          var b64 = typeof fRes.payload === 'string' ? fRes.payload : (fRes.payload.original_b64 || fRes.payload.buf || '');
          var rawBuf = base64ToArrayBuffer(b64);
          if (rawBuf && rawBuf.byteLength > 0 && typeof window.parseWB === 'function') {
            var wb = window.parseWB(rawBuf);
            var sheets = typeof window.wbToSheets === 'function' ? window.wbToSheets(wb) : {};
            var entry = {
              id: rSal.id || rSal.name,
              name: rSal.name,
              wb: wb,
              sheets: sheets,
              buf: rawBuf,
              fromDB: true,
              savedAt: rSal.updated_at || new Date().toISOString()
            };
            window.FILES = (window.FILES || []).filter(function(x) { return x && String(x.name).toLowerCase().trim() !== rNameLow; });
            window.FILES.push(entry);
            if (window.ATPLCentralFileSync && window.ATPLCentralFileSync.fileMap) {
              window.ATPLCentralFileSync.fileMap.set(rNameLow, entry);
            }
            try {
              var reqDb = indexedDB.open('AroraTextiles', 1);
              reqDb.onsuccess = function(ev) {
                var db = ev.target.result;
                if (db.objectStoreNames.contains('salaryFiles')) {
                  db.transaction('salaryFiles', 'readwrite').objectStore('salaryFiles').put({
                    name: entry.name,
                    buf: rawBuf,
                    saved: entry.savedAt
                  });
                }
              };
            } catch (_) {}
            salChanged = true;
          }
        }
      }
      if (salChanged) refreshAllUI();

      // 3. Reconcile HR Documents
      var remoteHr = allFiles.filter(function(f) { return f.module === 'hr_doc'; });
      var activeHrIds = new Set(remoteHr.map(function(f) { return String(f.id || f.name).toLowerCase().trim(); }));
      var localHrDocs = typeof window.hrDocGetDocs === 'function' ? window.hrDocGetDocs() : [];
      if (Array.isArray(localHrDocs)) {
        var staleHr = localHrDocs.filter(function(d) {
          var did = String((d && d.id) || '').toLowerCase().trim();
          return did && !activeHrIds.has(did) && !window.atplIsRecentSessionUpload('hr_doc', did, 45000);
        });
        staleHr.forEach(function(d) { purgeLocalHrDoc(d.id, d.document_name); });

        var localHrMap = new Map();
        localHrDocs.forEach(function(d) { if (d && d.id) localHrMap.set(String(d.id).toLowerCase().trim(), d); });

        var hrChanged = false;
        for (var h = 0; h < remoteHr.length; h++) {
          var rHr = remoteHr[h];
          var hid = String(rHr.id || rHr.name).toLowerCase().trim();
          var locDoc = localHrMap.get(hid);
          if (!locDoc || (Date.parse(rHr.updated_at || '0') > Date.parse(locDoc.updated_at || '0'))) {
            var hrRes = await gasGet({ action: 'get_file', drive_id: rHr.drive_id, key: rHr.key });
            if (hrRes && hrRes.ok && hrRes.payload) {
              var docObj = typeof hrRes.payload === 'string' ? JSON.parse(hrRes.payload) : hrRes.payload;
              if (docObj && docObj.id) {
                var idx = localHrDocs.findIndex(function(x) { return x && String(x.id).toLowerCase().trim() === hid; });
                if (idx >= 0) localHrDocs[idx] = docObj;
                else localHrDocs.push(docObj);
                try {
                  var rIdb = indexedDB.open('AroraTextilesHRDocs', 1);
                  rIdb.onsuccess = function(ev) {
                    var db = ev.target.result;
                    if (db.objectStoreNames.contains('documents')) {
                      db.transaction('documents', 'readwrite').objectStore('documents').put(docObj);
                    }
                  };
                } catch (_) {}
                hrChanged = true;
              }
            }
          }
        }
        if (hrChanged && typeof window.hrDocRender === 'function') window.hrDocRender();
      }

      // 4. Notify PF & ESIC Subscribers
      ['pf', 'esic'].forEach(function(modType) {
        var modFiles = allFiles.filter(function(f) { return f.module === modType; });
        var cbs = subscriberCallbacks[modType] || [];
        if (cbs.length > 0) {
          cbs.forEach(function(fn) {
            try { fn({ all: modFiles, removed: [] }); } catch (_) {}
          });
        }
      });

      refreshAllUI();
    } catch (err) {
      console.warn('[ATPL Google Drive Sync] Poll notice:', err && err.message);
    } finally {
      isSyncingNow = false;
    }
  }

  // ── UNIFIED API OBJECT ──
  var GoogleDriveEngine = {
    version: '2026.11.01-GOOGLE-DRIVE-SHEET-MASTER',

    init: function() {
      setTimeout(function() { triggerUniversalReconciliation(true); }, 300);
      return this;
    },

    // SALARY FILES (ALL FILES)
    saveSalaryFile: async function(name, payloadObj, meta) {
      window.atplMarkSessionUpload('salary', name);
      var b64 = (payloadObj && (payloadObj.original_b64 || payloadObj.buf)) || (typeof payloadObj === 'string' ? payloadObj : '');
      var updatedAt = (meta && meta.saved_at) || new Date().toISOString();
      await gasPost({
        action: 'save_file',
        module: 'salary',
        id: name,
        name: name,
        size: b64.length,
        updated_at: updatedAt,
        meta: meta || { name: name, saved_at: updatedAt },
        payload: { original_b64: b64, name: name }
      });
      await triggerUniversalReconciliation(true);
      return true;
    },

    deleteSalaryFile: async function(name) {
      purgeLocalSalaryFile(name);
      await gasPost({
        action: 'delete_file',
        module: 'salary',
        id: name,
        name: name
      });
      await triggerUniversalReconciliation(true);
      return true;
    },

    clearAllSalaryFiles: async function() {
      purgeAllSalaryFilesLocal();
      await gasPost({
        action: 'clear_module',
        module: 'salary'
      });
      await triggerUniversalReconciliation(true);
      return true;
    },

    fetchAllSalaryFiles: async function() {
      var m = await gasGet({ action: 'manifest', nocache: '1' });
      if (!m || !Array.isArray(m.files)) return [];
      return m.files.filter(function(f) { return f.module === 'salary'; }).map(function(f) {
        return {
          id: f.id || f.name,
          name: f.name,
          drive_id: f.drive_id,
          key: f.key,
          size: f.size || 0,
          saved_at: f.updated_at,
          uploaded_at: f.updated_at
        };
      });
    },

    fetchAllTombstones: async function() {
      var m = await gasGet({ action: 'manifest' });
      if (!m || !Array.isArray(m.tombstones)) return [];
      return m.tombstones.filter(function(t) { return t.module === 'salary'; });
    },

    decodeDocPayload: async function(doc) {
      if (!doc) return null;
      if (doc.original_b64) return doc;
      var res = await gasGet({ action: 'get_file', drive_id: doc.drive_id || '', key: doc.key || ('salary:' + String(doc.name || doc.id).toLowerCase()) });
      if (res && res.ok && res.payload) {
        return typeof res.payload === 'string' ? { original_b64: res.payload, name: doc.name } : res.payload;
      }
      return null;
    },

    // HR DOCUMENTS
    saveHrDoc: async function(doc) {
      if (!doc || !doc.id) return false;
      window.atplMarkSessionUpload('hr_doc', doc.id);
      var updatedAt = doc.updated_at || new Date().toISOString();
      await gasPost({
        action: 'save_file',
        module: 'hr_doc',
        id: doc.id,
        name: doc.document_name || doc.id,
        updated_at: updatedAt,
        meta: {
          id: doc.id,
          document_name: doc.document_name,
          document_type: doc.document_type,
          emp_code: doc.emp_code,
          emp_name: doc.emp_name,
          expiry_date: doc.expiry_date,
          updated_at: updatedAt
        },
        payload: doc
      });
      await triggerUniversalReconciliation(true);
      return true;
    },

    deleteHrDoc: async function(id, name) {
      purgeLocalHrDoc(id, name);
      await gasPost({
        action: 'delete_file',
        module: 'hr_doc',
        id: id,
        name: name || id
      });
      await triggerUniversalReconciliation(true);
      return true;
    },

    fetchAllHrDocs: async function() {
      var m = await gasGet({ action: 'manifest', nocache: '1' });
      if (!m || !Array.isArray(m.files)) return [];
      return m.files.filter(function(f) { return f.module === 'hr_doc'; }).map(function(f) {
        return Object.assign({}, f.meta || {}, { id: f.id, drive_id: f.drive_id, key: f.key, updated_at: f.updated_at });
      });
    },

    fetchAllHrTombstones: async function() {
      var m = await gasGet({ action: 'manifest' });
      if (!m || !Array.isArray(m.tombstones)) return [];
      return m.tombstones.filter(function(t) { return t.module === 'hr_doc'; });
    },

    decodeHrPayload: async function(doc) {
      if (!doc) return null;
      if (doc.file_data) return doc;
      var res = await gasGet({ action: 'get_file', drive_id: doc.drive_id || '', key: doc.key || ('hr_doc:' + String(doc.id).toLowerCase()) });
      return (res && res.ok && res.payload) ? res.payload : doc;
    },

    // PF & ESIC COMPLIANCE
    saveComplianceDoc: async function(module, name, payload) {
      var mod = String(module || 'pf').toLowerCase().trim();
      var obj = typeof payload === 'string' ? JSON.parse(payload) : (payload || {});
      var recId = obj.id || name;
      window.atplMarkSessionUpload(mod, recId);
      await gasPost({
        action: 'save_file',
        module: mod,
        id: recId,
        name: name || obj.name || recId,
        updated_at: new Date().toISOString(),
        meta: {
          id: recId,
          name: name || obj.name || recId,
          period: obj.period || '',
          file_hash: obj.hash || obj.file_hash || ''
        },
        payload: obj
      });
      await triggerUniversalReconciliation(true);
      return true;
    },

    deleteComplianceDoc: async function(module, name, id, hash) {
      var mod = String(module || 'pf').toLowerCase().trim();
      purgeLocalCompliance(mod, id || name, name, hash);
      await gasPost({
        action: 'delete_file',
        module: mod,
        id: id || name,
        name: name || id,
        file_hash: hash || ''
      });
      await triggerUniversalReconciliation(true);
      return true;
    },

    saveDolRecord: async function(type, rec, b64) {
      var copy = Object.assign({}, rec || {});
      if (b64) copy.original_b64 = b64;
      return await this.saveComplianceDoc(type, copy.name || copy.id, copy);
    },

    deleteDolRecord: async function(type, id, name, hash) {
      return await this.deleteComplianceDoc(type, name || id, id, hash);
    },

    fetchAllDolRecords: async function(type) {
      var mod = String(type || 'esic').toLowerCase().trim();
      var m = await gasGet({ action: 'manifest', nocache: '1' });
      if (!m || !Array.isArray(m.files)) return [];
      var list = m.files.filter(function(f) { return f.module === mod; });
      var out = [];
      for (var i = 0; i < list.length; i++) {
        var item = list[i];
        var full = await gasGet({ action: 'get_file', drive_id: item.drive_id, key: item.key });
        if (full && full.ok && full.payload) {
          out.push(typeof full.payload === 'string' ? JSON.parse(full.payload) : full.payload);
        }
      }
      return out;
    },

    fetchAllDolTombstones: async function(type) {
      var mod = String(type || 'esic').toLowerCase().trim();
      var m = await gasGet({ action: 'manifest' });
      if (!m || !Array.isArray(m.tombstones)) return [];
      return m.tombstones.filter(function(t) { return t.module === mod; });
    },

    decodeDolPayload: async function(rec) {
      if (!rec) return null;
      if (rec.original_b64 || rec.contributions) return rec;
      var res = await gasGet({ action: 'get_file', drive_id: rec.drive_id || '', key: rec.key || '' });
      return (res && res.ok && res.payload) ? res.payload : rec;
    },

    // EMPLOYEE MASTER
    saveEmployeeMaster: async function(records) {
      await gasPost({ action: 'save_emp_master', records: records || [] });
      return true;
    },

    fetchAllEmployeeMaster: async function() {
      var res = await gasGet({ action: 'get_emp_master' });
      return (res && res.ok && Array.isArray(res.records)) ? res.records : [];
    },

    // SUBSCRIPTIONS
    subscribeSalaryFiles: function(cb) { if (cb) subscriberCallbacks.salary.push(cb); return function() {}; },
    subscribeTombstones: function() { return function() {}; },
    subscribeHrDocs: function(cb) { if (cb) subscriberCallbacks.hr_doc.push(cb); return function() {}; },
    subscribeHrTombstones: function() { return function() {}; },
    subscribeDolRecords: function(type, cb) {
      var m = String(type || 'esic').toLowerCase();
      if (cb && subscriberCallbacks[m]) subscriberCallbacks[m].push(cb);
      return function() {};
    },
    subscribeDolTombstones: function() { return function() {}; },
    subscribeEmployeeMaster: function() { return function() {}; },

    triggerUniversalReconciliation: triggerUniversalReconciliation,
    reconcileSalaryFiles: function() { return triggerUniversalReconciliation(true); },
    reconcileHrDocs: function() { return triggerUniversalReconciliation(true); },
    reconcileCompliance: function() { return triggerUniversalReconciliation(true); },
    purgeLocalSalaryFile: purgeLocalSalaryFile,
    purgeAllSalaryFilesLocal: purgeAllSalaryFilesLocal,
    purgeLocalHrDoc: purgeLocalHrDoc,
    purgeLocalCompliance: purgeLocalCompliance
  };

  window.ATPLRealtimeSyncEngine = GoogleDriveEngine;
  window.ATPLRealtimeSync = GoogleDriveEngine;
  window.ATPLFirebase = GoogleDriveEngine;
  window.ATPLNativeFirebase = GoogleDriveEngine;
  window.UniversalEngine = GoogleDriveEngine;
  window.ATPLSyncEngine = GoogleDriveEngine;

  window.triggerManualCrossBrowserSync = function() {
    if (window.showToast) window.showToast('🔄 Syncing with Google Drive & Sheet...');
    triggerUniversalReconciliation(true);
  };
  window.atplTriggerCrossSync = function() {
    triggerUniversalReconciliation(true);
  };

  setTimeout(function() { triggerUniversalReconciliation(true); }, 400);
  setInterval(function() {
    if (!document.hidden && !window.__ATPL_IS_UPLOADING) {
      triggerUniversalReconciliation(false);
    }
  }, 4000);

  window.addEventListener('focus', function() { triggerUniversalReconciliation(true); });
  document.addEventListener('visibilitychange', function() {
    if (!document.hidden) triggerUniversalReconciliation(true);
  });

  console.log('✅ [ATPL Google Drive + Sheet Master Engine] Active & polling every 4s.');
})(window);
