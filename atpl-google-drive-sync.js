/**
 * ATPL UNIFIED SYNC ENGINE — PATCHED (GitHub Pages safe)
 *
 * Change vs old version (nothing else touched):
 *  - On localhost / *.run.app  -> behaves EXACTLY like before (own server + SSE + polling).
 *  - On GitHub Pages / any other host -> PAGES_MODE:
 *      * does NOT call the dead AI-Studio Cloud Run URL
 *      * does NOT open SSE / polling to a server that does not exist
 *      * does NOT overwrite window.ATPLFirebase and window.ATPLCloudSharedStorageV1
 *        (so erp-cloud-shared-storage-v1.js keeps doing the real Apps Script sync)
 *      * file upload/delete still parse + store locally (saveFileToDB / deleteFromDB),
 *        and those are already hooked by erp-cloud-shared-storage-v1.js for cloud sync.
 */
(function(window) {
  'use strict';

  var IS_LOCAL = false;
  try {
    var host = window.location && window.location.hostname;
    IS_LOCAL = (host === 'localhost' || host === '127.0.0.1' || /\.run\.app$/i.test(host));
  } catch (_) {}
  var PAGES_MODE = !IS_LOCAL;

  var API_BASE = '';
  if (IS_LOCAL) {
    try { API_BASE = window.location.origin || ''; } catch (_) { API_BASE = ''; }
  }

  // The shared-storage module calls window.atplIsRecentSessionUpload() but nothing defined it,
  // so local-only salary files were never queued to the cloud. Define it (PAGES_MODE only).
  var recentUploads = {};
  function markRecentUpload(mod, name) {
    recentUploads[mod + '|' + String(name || '').toLowerCase()] = Date.now();
  }
  if (PAGES_MODE && typeof window.atplIsRecentSessionUpload !== 'function') {
    window.atplIsRecentSessionUpload = function(mod, key, withinMs) {
      var t = recentUploads[String(mod) + '|' + String(key || '').toLowerCase()];
      return !!t && (Date.now() - t) <= Number(withinMs || 60000);
    };
  }
  // Manual one-time helper: push every salary file currently open in this browser to the shared cloud.
  // Run from console on the browser that HAS the files:  atplPushAllLocalSalaryToCloud()
  window.atplPushAllLocalSalaryToCloud = async function() {
    var api = window.ATPLCloudSharedStorageV1, n = 0, fail = 0;
    if (!api || typeof api.saveSalary !== 'function') { console.warn('Cloud shared storage not ready'); return { ok: false }; }
    var list = (window.FILES || []).slice();
    for (var i = 0; i < list.length; i++) {
      var f = list[i];
      if (!f || !f.name || !f.buf) continue;
      try { await api.saveSalary(f.name, f.buf, f.savedAt || new Date().toISOString()); n++; }
      catch (e) { fail++; console.warn('Push failed', f.name, e); }
    }
    if (window.showToast) window.showToast('☁ ' + n + ' salary files cloud pe bheje' + (fail ? ' (' + fail + ' fail)' : ''));
    return { ok: fail === 0, pushed: n, failed: fail };
  };

  window.__ATPL_CENTRAL_BACKEND_URL = API_BASE;
  window.ATPL_GET_API_BASE = function() { return API_BASE; };

  var localVersion = 0;
  var isPolling = false;
  var eventSource = null;

  function toB64(buf) {
    if (!buf) return '';
    if (typeof buf === 'string') return buf;
    var bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    var binary = '';
    var len = bytes.byteLength, chunk = 0x8000;
    for (var i = 0; i < len; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + chunk, len)));
    }
    return window.btoa(binary);
  }

  function b64ToBuf(b64) {
    if (!b64) return null;
    var clean = b64.indexOf(',') !== -1 ? b64.split(',')[1] : b64;
    var binary = window.atob(clean);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }

  // ── SSE (local server mode only) ──
  function setupSSE() {
    if (PAGES_MODE) return;
    if (typeof window.EventSource === 'undefined') return;
    if (eventSource) { try { eventSource.close(); } catch (_) {} }
    try {
      eventSource = new EventSource(API_BASE + '/api/sync/events');
      eventSource.addEventListener('connected', function(e) {
        try {
          var data = JSON.parse(e.data);
          if (data && data.version) localVersion = Math.max(localVersion, data.version);
        } catch (_) {}
      });
      eventSource.addEventListener('file_saved', handleRemoteFileSaved);
      eventSource.addEventListener('salary_file_saved', handleRemoteFileSaved);
      eventSource.addEventListener('file_deleted', handleRemoteFileDeleted);
      eventSource.addEventListener('salary_file_deleted', handleRemoteFileDeleted);
      eventSource.addEventListener('employee_master_updated', handleRemoteEmployeeUpdated);
      eventSource.addEventListener('employee_master_deleted', handleRemoteEmployeeDeleted);
      eventSource.addEventListener('hr_doc_saved', handleRemoteHrDocSaved);
      eventSource.addEventListener('hr_doc_deleted', handleRemoteHrDocDeleted);
      eventSource.addEventListener('dol_record_saved', handleRemoteDolChanged);
      eventSource.addEventListener('dol_record_deleted', handleRemoteDolChanged);
      eventSource.onerror = function() {
        try { eventSource.close(); } catch (_) {}
        setTimeout(setupSSE, 5000);
      };
    } catch (err) {
      console.warn('[ATPL Sync] SSE connection error:', err);
    }
  }

  async function handleRemoteFileSaved(e) {
    try {
      var d = JSON.parse(e.data || '{}');
      var fileObj = d.data || d;
      var name = fileObj.name;
      if (!name) return;
      var mod = String(fileObj.module || 'salary').toLowerCase();
      if (mod !== 'salary') return;
      var buf = fileObj.buf;
      if (!buf) {
        var res = await fetch(API_BASE + '/api/sync/salary-file/' + encodeURIComponent(name));
        if (res.ok) {
          var j = await res.json();
          if (j.file && j.file.buf) buf = j.file.buf;
        }
      }
      if (buf) {
        var rawBuf = typeof buf === 'string' ? b64ToBuf(buf) : buf;
        var wb = typeof window.parseWB === 'function' ? window.parseWB(rawBuf) : null;
        var sheets = wb && typeof window.wbToSheets === 'function' ? window.wbToSheets(wb) : {};
        window.FILES = (window.FILES || []).filter(function(f) {
          return f && String(f.name).toLowerCase() !== String(name).toLowerCase();
        });
        window.FILES.push({ name: name, wb: wb, sheets: sheets, buf: rawBuf,
          savedAt: fileObj.saved || fileObj.created_at || new Date().toISOString() });
        if (typeof window.saveFileToDB === 'function') window.saveFileToDB(name, rawBuf);
        refreshFilesUI();
      }
    } catch (_) {}
  }

  function handleRemoteFileDeleted(e) {
    try {
      var d = JSON.parse(e.data || '{}');
      var fileObj = d.data || d;
      var name = fileObj.name || fileObj.id;
      if (!name) return;
      var target = String(name).toLowerCase().trim();
      window.FILES = (window.FILES || []).filter(function(f) {
        return f && String(f.name || '').toLowerCase().trim() !== target;
      });
      if (typeof window.deleteFromDB === 'function') window.deleteFromDB(name);
      try {
        var tombs = JSON.parse(localStorage.getItem('ATPL_SALARY_TOMBSTONES_V2') || '{}');
        tombs[target] = new Date().toISOString();
        localStorage.setItem('ATPL_SALARY_TOMBSTONES_V2', JSON.stringify(tombs));
      } catch (_) {}
      refreshFilesUI();
    } catch (_) {}
  }

  async function handleRemoteEmployeeUpdated() {
    try {
      var res = await fetch(API_BASE + '/api/sync/employee-master');
      if (res.ok) {
        var d = await res.json();
        if (d.records && Array.isArray(d.records) && window.EM) applyEmployeeRecords(d.records);
      }
    } catch (_) {}
  }

  function handleRemoteEmployeeDeleted(e) {
    try {
      var d = JSON.parse(e.data || '{}');
      var empId = String((d.data && d.data.emp_id) || d.emp_id || '').toUpperCase().trim();
      if (!empId) return;
      try {
        var tombs = JSON.parse(localStorage.getItem('ATPL_EmployeeMasterDeletedV1') || '{}');
        tombs[empId.toLowerCase()] = new Date().toISOString();
        tombs[empId.toLowerCase().replace(/^0+/, '')] = new Date().toISOString();
        localStorage.setItem('ATPL_EmployeeMasterDeletedV1', JSON.stringify(tombs));
      } catch (_) {}
      if (window.EM && Array.isArray(window.EM.data)) {
        window.EM.data = window.EM.data.filter(function(r) {
          var code = String(r.emp_id || r.id || '').toUpperCase().trim();
          return code !== empId && code.replace(/^0+/, '') !== empId.replace(/^0+/, '');
        });
        refreshEmployeeUI();
      }
    } catch (_) {}
  }

  function handleRemoteHrDocSaved(e) {
    try {
      var d = JSON.parse(e.data || '{}');
      var doc = d.data || d;
      if (!doc || !doc.id) return;
      var list = typeof window.hrDocGetDocs === 'function' ? window.hrDocGetDocs() : [];
      var idx = list.findIndex(function(x) { return x.id === doc.id; });
      if (idx >= 0) list[idx] = Object.assign({}, list[idx], doc); else list.push(doc);
      if (typeof window.hrDocPut === 'function') window.hrDocPut(doc);
      if (typeof window.hrDocRender === 'function') window.hrDocRender();
    } catch (_) {}
  }

  function handleRemoteHrDocDeleted(e) {
    try {
      var d = JSON.parse(e.data || '{}');
      var id = String((d.data && d.data.id) || d.id || '');
      if (!id) return;
      var list = typeof window.hrDocGetDocs === 'function' ? window.hrDocGetDocs() : [];
      var filtered = list.filter(function(x) { return x.id !== id; });
      if (typeof window.hrDocSetDocs === 'function') window.hrDocSetDocs(filtered);
      if (typeof window.hrDocRender === 'function') window.hrDocRender();
    } catch (_) {}
  }

  function handleRemoteDolChanged() {
    if (typeof window.initStatutoryChallanTab === 'function') {
      try { window.initStatutoryChallanTab(); } catch (_) {}
    }
  }

  function applyEmployeeRecords(records) {
    if (!Array.isArray(records)) return;
    var dead = {};
    try { dead = JSON.parse(localStorage.getItem('ATPL_EmployeeMasterDeletedV1') || '{}'); } catch (_) {}
    var valid = records.filter(function(r) {
      if (!r || !r.emp_id) return false;
      var k = String(r.emp_id).toLowerCase().trim();
      return !dead[k] && !dead[k.replace(/^0+/, '')];
    });
    if (window.EM) window.EM.data = valid.slice();
    if (Array.isArray(window.EMP_MASTER_DATA)) {
      window.EMP_MASTER_DATA.length = 0;
      Array.prototype.push.apply(window.EMP_MASTER_DATA, valid);
    }
    try { localStorage.setItem('AroraTextilesEmployeeMasterV3', JSON.stringify(valid)); } catch (_) {}
    refreshEmployeeUI();
  }

  function refreshFilesUI() {
    ['renderFiles', 'renderSheets', 'updStats', 'renderAllFilesPage', 'populateNJSelects'].forEach(function(n) {
      try { if (typeof window[n] === 'function') window[n](); } catch (_) {}
    });
    var sl = document.getElementById('storageLbl');
    if (sl && window.FILES) sl.textContent = window.FILES.length + ' files saved';
  }

  function refreshEmployeeUI() {
    if (typeof window.aroraRefreshMaster === 'function') {
      window.aroraRefreshMaster();
    } else {
      if (typeof window.emFilter === 'function') window.emFilter();
      if (typeof window.emUpdateStats === 'function') window.emUpdateStats();
    }
  }

  // ── State poll ──
  async function pollSyncState(force) {
    // PAGES_MODE: delegate to the real shared-storage sync (Apps Script). No dead server calls.
    if (PAGES_MODE) {
      var real = window.ATPLCloudSharedStorageV1;
      if (real && real !== UnifiedSyncEngine && typeof real.syncNow === 'function') {
        try { return await real.syncNow(!!force); } catch (_) { return false; }
      }
      return false;
    }
    if (isPolling && !force) return;
    isPolling = true;
    try {
      var res = await fetch(API_BASE + '/api/sync/state?summary=1');
      if (!res.ok) return;
      var state = await res.json();
      if (!state || !state.ok) return;
      var sVer = Number(state.version || 0);
      if (!(sVer > localVersion || force)) return;
      localVersion = Math.max(localVersion, sVer);

      var serverSalaryFiles = Array.isArray(state.salary_files) ? state.salary_files : [];
      var tombstones = state.salary_tombstones || {};
      var currentFiles = Array.isArray(window.FILES) ? window.FILES.slice() : [];
      var filesChanged = false;

      for (var i = currentFiles.length - 1; i >= 0; i--) {
        var cf = currentFiles[i];
        if (!cf) continue;
        var cNameLow = String(cf.name || '').toLowerCase().trim();
        if (tombstones[cNameLow] || (state.tombstones && state.tombstones[cNameLow])) {
          currentFiles.splice(i, 1);
          if (typeof window.deleteFromDB === 'function') window.deleteFromDB(cf.name);
          filesChanged = true;
        }
      }

      for (var j = 0; j < serverSalaryFiles.length; j++) {
        var sf = serverSalaryFiles[j];
        if (!sf || !sf.name) continue;
        var sfNameLow = String(sf.name).toLowerCase().trim();
        if (tombstones[sfNameLow]) continue;
        var exists = currentFiles.find(function(f) {
          return f && String(f.name).toLowerCase().trim() === sfNameLow;
        });
        if (!exists) {
          try {
            var fRes = await fetch(API_BASE + '/api/sync/salary-file/' + encodeURIComponent(sf.name));
            if (fRes.ok) {
              var fJson = await fRes.json();
              if (fJson.file && fJson.file.buf) {
                var rawBuf = typeof fJson.file.buf === 'string' ? b64ToBuf(fJson.file.buf) : fJson.file.buf;
                var wb = typeof window.parseWB === 'function' ? window.parseWB(rawBuf) : null;
                var sheets = wb && typeof window.wbToSheets === 'function' ? window.wbToSheets(wb) : {};
                currentFiles.push({ name: sf.name, wb: wb, sheets: sheets, buf: rawBuf,
                  savedAt: sf.saved || new Date().toISOString() });
                if (typeof window.saveFileToDB === 'function') window.saveFileToDB(sf.name, rawBuf);
                filesChanged = true;
              }
            }
          } catch (_) {}
        }
      }
      if (filesChanged) { window.FILES = currentFiles; refreshFilesUI(); }

      if (Array.isArray(state.employee_master) && state.employee_master.length > 0) {
        applyEmployeeRecords(state.employee_master);
      }
      if (Array.isArray(state.hr_docs) && typeof window.hrDocSetDocs === 'function') {
        window.hrDocSetDocs(state.hr_docs);
        if (typeof window.hrDocRender === 'function') window.hrDocRender();
      }
      if (typeof window.initStatutoryChallanTab === 'function') {
        try { window.initStatutoryChallanTab(); } catch (_) {}
      }
    } catch (e) {
      console.warn('[ATPL Sync] State poll notice:', e.message);
    } finally {
      isPolling = false;
    }
  }

  var UnifiedSyncEngine = {
    version: '2026.11.10-PAGES-SAFE',
    apiBase: API_BASE,
    pagesMode: PAGES_MODE,

    init: function() {
      if (PAGES_MODE) return; // real sync is done by erp-cloud-shared-storage-v1.js
      setupSSE();
      pollSyncState(true);
      setInterval(function() { if (!document.hidden) pollSyncState(false); }, 3500);
      window.addEventListener('focus', function() { pollSyncState(true); });
      document.addEventListener('visibilitychange', function() { if (!document.hidden) pollSyncState(true); });
    },

    uploadFile: async function(module, fileObj, meta, onProgress) {
      var mod = String(module || 'salary').toLowerCase().trim();
      var name = (fileObj && (fileObj.name || fileObj.filename || fileObj.document_name || fileObj.id)) || ('file_' + Date.now());
      if (onProgress) onProgress('preparing', 20);

      var rawBuf = fileObj && fileObj.buf instanceof ArrayBuffer
        ? fileObj.buf
        : (fileObj instanceof Blob ? await fileObj.arrayBuffer() : null);
      var b64 = rawBuf
        ? toB64(rawBuf)
        : (fileObj && (fileObj.original_b64 || fileObj.file_data || (typeof fileObj.buf === 'string' ? fileObj.buf : ''))) || '';
      var now = new Date().toISOString();

      if (mod === 'salary' && rawBuf && typeof window.parseWB === 'function' && typeof window.wbToSheets === 'function') {
        var wb = window.parseWB(rawBuf);
        var sheets = window.wbToSheets(wb);
        var entry = { id: name, name: name, wb: wb, sheets: sheets, buf: rawBuf, savedAt: now };
        window.FILES = (window.FILES || []).filter(function(x) {
          return x && String(x.name || '').toLowerCase() !== name.toLowerCase();
        });
        window.FILES.push(entry);
        markRecentUpload('salary', name);
        // saveFileToDB is hooked by erp-cloud-shared-storage-v1.js -> cloud save happens there
        if (typeof window.saveFileToDB === 'function') window.saveFileToDB(name, rawBuf);
        refreshFilesUI();
      }

      if (onProgress) onProgress('uploading', 50);

      if (!PAGES_MODE) {
        var payload = {
          name: name, module: mod,
          category: (meta && meta.category) || 'general',
          buf: b64,
          size: rawBuf ? rawBuf.byteLength : (b64 ? b64.length : 0),
          mime_type: (fileObj && fileObj.type) || (mod === 'salary' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/pdf'),
          meta: Object.assign({}, meta || {}, { name: name }),
          created_at: now
        };
        try {
          var res = await fetch(API_BASE + '/api/sync/files', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          if (res.ok) {
            var data = await res.json();
            if (data && data.version) localVersion = Math.max(localVersion, data.version);
          }
        } catch (err) { console.warn('[ATPL Sync] File save server notice:', err); }
      }

      if (onProgress) onProgress('saved', 100);
      return { id: name, name: name, module: mod, created_at: now, ok: true };
    },

    uploadBulk: async function(module, fileList, metaGenerator, onFileProgress) {
      window.__ATPL_IS_UPLOADING = true;
      var files = Array.from(fileList || []);
      var results = [];
      try {
        for (var i = 0; i < files.length; i++) {
          var f = files[i];
          var meta = typeof metaGenerator === 'function' ? await metaGenerator(f, i) : {};
          if (onFileProgress) onFileProgress(i, 'uploading', 50, f.name);
          var saved = await this.uploadFile(module, f, meta);
          results.push({ ok: true, name: f.name, file: saved });
          if (onFileProgress) onFileProgress(i, 'saved', 100, f.name);
        }
      } finally {
        window.__ATPL_IS_UPLOADING = false;
      }
      refreshFilesUI();
      return { total: files.length, saved: results.length, failed: 0, results: results };
    },

    deleteFile: async function(module, idOrName) {
      var mod = 'salary', name = '';
      if (idOrName !== undefined && idOrName !== null && idOrName !== '') {
        mod = String(module || 'salary').toLowerCase().trim();
        name = String(idOrName).trim();
      } else {
        name = String(module || '').trim();
      }
      if (!name) return false;
      var target = name.toLowerCase();
      if (mod === 'salary' || !mod) {
        window.FILES = (window.FILES || []).filter(function(x) {
          return x && String(x.name || '').toLowerCase().trim() !== target;
        });
        // deleteFromDB is hooked by erp-cloud-shared-storage-v1.js -> cloud delete + tombstone there
        if (typeof window.deleteFromDB === 'function') window.deleteFromDB(name);
        refreshFilesUI();
      }
      if (!PAGES_MODE) {
        try {
          var tombs = JSON.parse(localStorage.getItem('ATPL_SALARY_TOMBSTONES_V2') || '{}');
          tombs[target] = new Date().toISOString();
          localStorage.setItem('ATPL_SALARY_TOMBSTONES_V2', JSON.stringify(tombs));
        } catch (_) {}
        try {
          await Promise.allSettled([
            fetch(API_BASE + '/api/sync/files/' + encodeURIComponent(name) + '?module=' + mod, { method: 'DELETE' }),
            fetch(API_BASE + '/api/sync/salary-file/' + encodeURIComponent(name), { method: 'DELETE' })
          ]);
        } catch (_) {}
      }
      return true;
    },

    saveSalaryFile: function(name, payload, meta) {
      return this.uploadFile('salary', Object.assign({ name: name }, payload || {}), meta);
    },
    deleteSalaryFile: function(name) { return this.deleteFile('salary', name); },

    saveHrDoc: async function(doc) {
      if (!doc || !doc.id) return { ok: false };
      if (PAGES_MODE) return { ok: true, offline: true };
      try {
        var res = await fetch(API_BASE + '/api/sync/hr-doc', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(doc)
        });
        return await res.json();
      } catch (_) { return { ok: true, offline: true }; }
    },

    deleteHrDoc: async function(id) {
      if (PAGES_MODE) return true;
      try { await fetch(API_BASE + '/api/sync/hr-doc/' + encodeURIComponent(id), { method: 'DELETE' }); return true; }
      catch (_) { return false; }
    },

    saveComplianceDoc: async function(type, name, payload) {
      if (PAGES_MODE) return { ok: true, offline: true };
      var record = Object.assign({ id: name, name: name, module: type }, payload || {});
      try {
        await fetch(API_BASE + '/api/sync/dol-record', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(record)
        });
      } catch (_) {}
      return { ok: true };
    },

    deleteComplianceDoc: async function(type, id) {
      if (PAGES_MODE) return true;
      try { await fetch(API_BASE + '/api/sync/dol-record/' + encodeURIComponent(id), { method: 'DELETE' }); } catch (_) {}
      return true;
    },

    saveEmployeeMaster: async function(records) {
      if (!Array.isArray(records)) return { ok: false };
      if (PAGES_MODE) return { ok: true, offline: true };
      try {
        var res = await fetch(API_BASE + '/api/sync/employee-master', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ records: records })
        });
        return await res.json();
      } catch (_) { return { ok: true, offline: true }; }
    },

    deleteEmployeeMaster: async function(empId) {
      if (PAGES_MODE) return { ok: true, offline: true };
      try {
        var res = await fetch(API_BASE + '/api/sync/employee-master/' + encodeURIComponent(empId), { method: 'DELETE' });
        return await res.json();
      } catch (_) { return { ok: true, offline: true }; }
    },

    fetchAllSalaryFiles: async function() { await pollSyncState(true); return window.FILES || []; },

    fetchAllEmployeeMaster: async function() {
      if (!PAGES_MODE) {
        try {
          var res = await fetch(API_BASE + '/api/sync/employee-master');
          if (res.ok) { var d = await res.json(); return d.records || []; }
        } catch (_) {}
      }
      return (window.EM && window.EM.data) || [];
    },

    clearAllSalaryFiles: async function() {
      if (PAGES_MODE) return { ok: true };
      window.FILES = [];
      try {
        await fetch(API_BASE + '/api/sync/files/clear-module', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ module: 'salary' })
        });
      } catch (_) {}
      refreshFilesUI();
      return { ok: true };
    },

    reconcileAll: function(force) { return pollSyncState(!!force); },
    syncNow: function(force) { return pollSyncState(!!force); },
    triggerUniversalReconciliation: function(force) { return pollSyncState(!!force); }
  };

  // Aliases other modules call. In PAGES_MODE we do NOT replace the real
  // ATPLFirebase / ATPLCloudSharedStorageV1 (that was the main conflict).
  window.ATPLGoogleSync = UnifiedSyncEngine;
  window.ATPLCentralFileSync = UnifiedSyncEngine;
  window.ATPLRealtimeSyncEngine = UnifiedSyncEngine;
  window.UniversalEngine = UnifiedSyncEngine;
  if (!PAGES_MODE) {
    window.ATPLFirebase = UnifiedSyncEngine;
    window.ATPLCloudSharedStorageV1 = UnifiedSyncEngine;
  }

  window.triggerManualCrossBrowserSync = async function() {
    var btn = document.getElementById('btnForceCrossBrowserSync');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Syncing...'; }
    try {
      await pollSyncState(true);
      var count = window.FILES ? window.FILES.length : 0;
      var emCount = window.EM && window.EM.data ? window.EM.data.length : 0;
      if (window.showToast) window.showToast('✅ Cross-browser sync complete (' + count + ' Files, ' + emCount + ' Employees)!');
    } catch (e) {
      if (window.showToast) window.showToast('⚠️ Sync notice: ' + (e.message || e));
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '🔄 Sync Browsers'; }
    }
  };

  window.atplTriggerCrossSync = window.triggerManualCrossBrowserSync;
  window.atplDirectServerSync = function() { return pollSyncState(true); };
  window.syncAllAtplModules = function() { return pollSyncState(true); };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', UnifiedSyncEngine.init, { once: true });
  } else {
    UnifiedSyncEngine.init();
  }
})(window);
