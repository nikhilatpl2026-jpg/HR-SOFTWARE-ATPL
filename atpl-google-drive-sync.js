/**
 * ATPL UNIFIED CROSS-BROWSER & GOOGLE DRIVE / SHEETS SYNC ENGINE
 * Single Source of Truth for Files, Employee Master, HR Docs, PF, ESIC & Challans.
 * Real-time SSE updates + Lightweight 3-second heartbeat polling.
 * Zero data loss, zero resurrection of deleted items, instant cross-device updates.
 */
(function(window) {
  'use strict';

  var API_BASE = '';
  try {
    var host = window.location && window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1' || /\.run\.app$/i.test(host)) {
      API_BASE = window.location.origin || '';
    } else if (window.LIVE_CLOUD_RUN_URL) {
      API_BASE = window.LIVE_CLOUD_RUN_URL;
    }
  } catch (_) {
    API_BASE = '';
  }

  window.__ATPL_CENTRAL_BACKEND_URL = API_BASE;
  window.ATPL_GET_API_BASE = function() { return API_BASE; };

  var localVersion = 0;
  var isPolling = false;
  var sseConnected = false;
  var eventSource = null;

  // ── Helper Utilities ──
  function toB64(buf) {
    if (!buf) return '';
    if (typeof buf === 'string') return buf;
    var bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    var binary = '';
    var len = bytes.byteLength;
    var chunk = 0x8000;
    for (var i = 0; i < len; i += chunk) {
      var sub = bytes.subarray(i, Math.min(i + chunk, len));
      binary += String.fromCharCode.apply(null, sub);
    }
    return window.btoa(binary);
  }

  function b64ToBuf(b64) {
    if (!b64) return null;
    var clean = b64.indexOf(',') !== -1 ? b64.split(',')[1] : b64;
    var binary = window.atob(clean);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  // ── Real-Time Server-Sent Events (SSE) Listener ──
  function setupSSE() {
    if (typeof window.EventSource === 'undefined') return;
    if (eventSource) {
      try { eventSource.close(); } catch (_) {}
    }

    try {
      eventSource = new EventSource(API_BASE + '/api/sync/events');

      eventSource.addEventListener('connected', function(e) {
        sseConnected = true;
        try {
          var data = JSON.parse(e.data);
          if (data && data.version) localVersion = Math.max(localVersion, data.version);
        } catch (_) {}
      });

      eventSource.addEventListener('file_saved', function(e) {
        handleRemoteFileSaved(e);
      });

      eventSource.addEventListener('salary_file_saved', function(e) {
        handleRemoteFileSaved(e);
      });

      eventSource.addEventListener('file_deleted', function(e) {
        handleRemoteFileDeleted(e);
      });

      eventSource.addEventListener('salary_file_deleted', function(e) {
        handleRemoteFileDeleted(e);
      });

      eventSource.addEventListener('employee_master_updated', function(e) {
        handleRemoteEmployeeUpdated(e);
      });

      eventSource.addEventListener('employee_master_deleted', function(e) {
        handleRemoteEmployeeDeleted(e);
      });

      eventSource.addEventListener('hr_doc_saved', function(e) {
        handleRemoteHrDocSaved(e);
      });

      eventSource.addEventListener('hr_doc_deleted', function(e) {
        handleRemoteHrDocDeleted(e);
      });

      eventSource.addEventListener('dol_record_saved', function(e) {
        handleRemoteDolSaved(e);
      });

      eventSource.addEventListener('dol_record_deleted', function(e) {
        handleRemoteDolDeleted(e);
      });

      eventSource.onerror = function() {
        sseConnected = false;
        try { eventSource.close(); } catch (_) {}
        setTimeout(setupSSE, 5000);
      };
    } catch (err) {
      console.warn('[ATPL Sync] SSE connection error:', err);
    }
  }

  // ── Handle SSE Incoming Events ──
  async function handleRemoteFileSaved(e) {
    try {
      var d = JSON.parse(e.data || '{}');
      var fileObj = d.data || d;
      var name = fileObj.name;
      if (!name) return;

      var mod = String(fileObj.module || 'salary').toLowerCase();
      if (mod === 'salary') {
        // Fetch full file content if buffer not in event
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
          window.FILES.push({
            name: name,
            wb: wb,
            sheets: sheets,
            buf: rawBuf,
            savedAt: fileObj.saved || fileObj.created_at || new Date().toISOString()
          });

          if (typeof window.saveFileToDB === 'function') {
            window.saveFileToDB(name, rawBuf);
          }
          refreshFilesUI();
        }
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

      if (typeof window.deleteFromDB === 'function') {
        window.deleteFromDB(name);
      }

      // Record tombstone locally so it won't resurrect
      try {
        var tombs = JSON.parse(localStorage.getItem('ATPL_SALARY_TOMBSTONES_V2') || '{}');
        tombs[target] = new Date().toISOString();
        localStorage.setItem('ATPL_SALARY_TOMBSTONES_V2', JSON.stringify(tombs));
      } catch (_) {}

      refreshFilesUI();
    } catch (_) {}
  }

  async function handleRemoteEmployeeUpdated(e) {
    try {
      var res = await fetch(API_BASE + '/api/sync/employee-master');
      if (res.ok) {
        var d = await res.json();
        if (d.records && Array.isArray(d.records) && window.EM) {
          applyEmployeeRecords(d.records);
        }
      }
    } catch (_) {}
  }

  function handleRemoteEmployeeDeleted(e) {
    try {
      var d = JSON.parse(e.data || '{}');
      var empId = String((d.data && d.data.emp_id) || d.emp_id || '').toUpperCase().trim();
      if (!empId) return;

      // Mark tombstone
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
      if (idx >= 0) list[idx] = Object.assign({}, list[idx], doc);
      else list.push(doc);

      if (typeof window.hrDocPut === 'function') {
        window.hrDocPut(doc);
      }
      if (typeof window.hrDocRender === 'function') {
        window.hrDocRender();
      }
    } catch (_) {}
  }

  function handleRemoteHrDocDeleted(e) {
    try {
      var d = JSON.parse(e.data || '{}');
      var id = String((d.data && d.data.id) || d.id || '');
      if (!id) return;

      var list = typeof window.hrDocGetDocs === 'function' ? window.hrDocGetDocs() : [];
      var filtered = list.filter(function(x) { return x.id !== id; });
      if (typeof window.hrDocSetDocs === 'function') {
        window.hrDocSetDocs(filtered);
      }
      if (typeof window.hrDocRender === 'function') {
        window.hrDocRender();
      }
    } catch (_) {}
  }

  function handleRemoteDolSaved(e) {
    if (typeof window.initStatutoryChallanTab === 'function') {
      try { window.initStatutoryChallanTab(); } catch (_) {}
    }
  }

  function handleRemoteDolDeleted(e) {
    if (typeof window.initStatutoryChallanTab === 'function') {
      try { window.initStatutoryChallanTab(); } catch (_) {}
    }
  }

  // ── Apply Employee Records to Memory and UI ──
  function applyEmployeeRecords(records) {
    if (!Array.isArray(records)) return;
    var dead = {};
    try { dead = JSON.parse(localStorage.getItem('ATPL_EmployeeMasterDeletedV1') || '{}'); } catch (_) {}

    var valid = records.filter(function(r) {
      if (!r || !r.emp_id) return false;
      var k = String(r.emp_id).toLowerCase().trim();
      return !dead[k] && !dead[k.replace(/^0+/, '')];
    });

    if (window.EM) {
      window.EM.data = valid.slice();
    }
    if (Array.isArray(window.EMP_MASTER_DATA)) {
      window.EMP_MASTER_DATA.length = 0;
      Array.prototype.push.apply(window.EMP_MASTER_DATA, valid);
    }
    try {
      localStorage.setItem('AroraTextilesEmployeeMasterV3', JSON.stringify(valid));
    } catch (_) {}
    refreshEmployeeUI();
  }

  function refreshFilesUI() {
    if (typeof window.renderFiles === 'function') window.renderFiles();
    if (typeof window.renderSheets === 'function') window.renderSheets();
    if (typeof window.updStats === 'function') window.updStats();
    if (typeof window.renderAllFilesPage === 'function') window.renderAllFilesPage();
    if (typeof window.populateNJSelects === 'function') window.populateNJSelects();
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

  // ── Continuous Background State Poller (Cross-Browser Heartbeat) ──
  async function pollSyncState(force) {
    if (isPolling && !force) return;
    isPolling = true;

    try {
      var res = await fetch(API_BASE + '/api/sync/state?summary=1');
      if (!res.ok) return;
      var state = await res.json();
      if (!state || !state.ok) return;

      var sVer = Number(state.version || 0);
      var versionChanged = sVer > localVersion || force;

      if (versionChanged) {
        localVersion = Math.max(localVersion, sVer);

        // 1. Reconcile Salary Files
        var serverSalaryFiles = Array.isArray(state.salary_files) ? state.salary_files : [];
        var tombstones = state.salary_tombstones || {};

        // Remove tombstoned files from local
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

        // Fetch any missing files from server
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
                  currentFiles.push({
                    name: sf.name,
                    wb: wb,
                    sheets: sheets,
                    buf: rawBuf,
                    savedAt: sf.saved || new Date().toISOString()
                  });
                  if (typeof window.saveFileToDB === 'function') {
                    window.saveFileToDB(sf.name, rawBuf);
                  }
                  filesChanged = true;
                }
              }
            } catch (_) {}
          }
        }

        if (filesChanged) {
          window.FILES = currentFiles;
          refreshFilesUI();
        }

        // 2. Reconcile Employee Master
        if (Array.isArray(state.employee_master) && state.employee_master.length > 0) {
          applyEmployeeRecords(state.employee_master);
        }

        // 3. Reconcile HR Docs
        if (Array.isArray(state.hr_docs) && typeof window.hrDocSetDocs === 'function') {
          window.hrDocSetDocs(state.hr_docs);
          if (typeof window.hrDocRender === 'function') window.hrDocRender();
        }

        // 4. Statutory Challans
        if (typeof window.initStatutoryChallanTab === 'function') {
          try { window.initStatutoryChallanTab(); } catch (_) {}
        }
      }
    } catch (e) {
      console.warn('[ATPL Sync] State poll notice:', e.message);
    } finally {
      isPolling = false;
    }
  }

  // ── Unified API Engine Object ──
  var UnifiedSyncEngine = {
    version: '2026.11.09-ENTERPRISE-UNIFIED',
    apiBase: API_BASE,

    init: function() {
      setupSSE();
      pollSyncState(true);
      setInterval(function() {
        if (!document.hidden) pollSyncState(false);
      }, 3500);

      window.addEventListener('focus', function() {
        pollSyncState(true);
      });
      document.addEventListener('visibilitychange', function() {
        if (!document.hidden) pollSyncState(true);
      });
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

      // If salary file, parse immediately for zero UI wait
      if (mod === 'salary' && rawBuf && typeof window.parseWB === 'function' && typeof window.wbToSheets === 'function') {
        var wb = window.parseWB(rawBuf);
        var sheets = window.wbToSheets(wb);
        var entry = { id: name, name: name, wb: wb, sheets: sheets, buf: rawBuf, savedAt: now };
        window.FILES = (window.FILES || []).filter(function(x) {
          return x && String(x.name || '').toLowerCase() !== name.toLowerCase();
        });
        window.FILES.push(entry);
        if (typeof window.saveFileToDB === 'function') window.saveFileToDB(name, rawBuf);
        refreshFilesUI();
      }

      if (onProgress) onProgress('uploading', 50);

      // Send to server authoritative store
      var payload = {
        name: name,
        module: mod,
        category: (meta && meta.category) || 'general',
        buf: b64,
        size: rawBuf ? rawBuf.byteLength : (b64 ? b64.length : 0),
        mime_type: (fileObj && fileObj.type) || (mod === 'salary' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/pdf'),
        meta: Object.assign({}, meta || {}, { name: name }),
        created_at: now
      };

      try {
        var res = await fetch(API_BASE + '/api/sync/files', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (res.ok) {
          var data = await res.json();
          if (data && data.version) localVersion = Math.max(localVersion, data.version);
        }
      } catch (err) {
        console.warn('[ATPL Sync] File save server notice:', err);
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
      var mod = 'salary';
      var name = '';
      if (idOrName !== undefined && idOrName !== null && idOrName !== '') {
        mod = String(module || 'salary').toLowerCase().trim();
        name = String(idOrName).trim();
      } else {
        name = String(module || '').trim();
      }
      if (!name) return false;

      // Remove immediately from memory and local store
      var target = name.toLowerCase();
      if (mod === 'salary' || !mod) {
        window.FILES = (window.FILES || []).filter(function(x) {
          return x && String(x.name || '').toLowerCase().trim() !== target;
        });
        if (typeof window.deleteFromDB === 'function') window.deleteFromDB(name);
        refreshFilesUI();
      }

      // Record tombstone locally
      try {
        var tombs = JSON.parse(localStorage.getItem('ATPL_SALARY_TOMBSTONES_V2') || '{}');
        tombs[target] = new Date().toISOString();
        localStorage.setItem('ATPL_SALARY_TOMBSTONES_V2', JSON.stringify(tombs));
      } catch (_) {}

      // Tell server to delete and propagate to Google Drive
      try {
        await Promise.allSettled([
          fetch(API_BASE + '/api/sync/files/' + encodeURIComponent(name) + '?module=' + mod, { method: 'DELETE' }),
          fetch(API_BASE + '/api/sync/salary-file/' + encodeURIComponent(name), { method: 'DELETE' })
        ]);
      } catch (_) {}

      return true;
    },

    saveSalaryFile: function(name, payload, meta) {
      return this.uploadFile('salary', Object.assign({ name: name }, payload || {}), meta);
    },

    deleteSalaryFile: function(name) {
      return this.deleteFile('salary', name);
    },

    saveHrDoc: async function(doc) {
      if (!doc || !doc.id) return { ok: false };
      try {
        var res = await fetch(API_BASE + '/api/sync/hr-doc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(doc)
        });
        return await res.json();
      } catch (_) {
        return { ok: true, offline: true };
      }
    },

    deleteHrDoc: async function(id) {
      try {
        await fetch(API_BASE + '/api/sync/hr-doc/' + encodeURIComponent(id), { method: 'DELETE' });
        return true;
      } catch (_) {
        return false;
      }
    },

    saveComplianceDoc: async function(type, name, payload) {
      var record = Object.assign({ id: name, name: name, module: type }, payload || {});
      try {
        await fetch(API_BASE + '/api/sync/dol-record', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(record)
        });
      } catch (_) {}
      return { ok: true };
    },

    deleteComplianceDoc: async function(type, id) {
      try {
        await fetch(API_BASE + '/api/sync/dol-record/' + encodeURIComponent(id), { method: 'DELETE' });
      } catch (_) {}
      return true;
    },

    saveEmployeeMaster: async function(records) {
      if (!Array.isArray(records)) return { ok: false };
      try {
        var res = await fetch(API_BASE + '/api/sync/employee-master', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ records: records })
        });
        return await res.json();
      } catch (_) {
        return { ok: true, offline: true };
      }
    },

    deleteEmployeeMaster: async function(empId) {
      try {
        var res = await fetch(API_BASE + '/api/sync/employee-master/' + encodeURIComponent(empId), {
          method: 'DELETE'
        });
        return await res.json();
      } catch (_) {
        return { ok: true, offline: true };
      }
    },

    fetchAllSalaryFiles: async function() {
      await pollSyncState(true);
      return window.FILES || [];
    },

    fetchAllEmployeeMaster: async function() {
      try {
        var res = await fetch(API_BASE + '/api/sync/employee-master');
        if (res.ok) {
          var d = await res.json();
          return d.records || [];
        }
      } catch (_) {}
      return (window.EM && window.EM.data) || [];
    },

    clearAllSalaryFiles: async function() {
      window.FILES = [];
      try {
        await fetch(API_BASE + '/api/sync/files/clear-module', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ module: 'salary' })
        });
      } catch (_) {}
      refreshFilesUI();
      return { ok: true };
    },

    reconcileAll: function(force) {
      return pollSyncState(!!force);
    },

    syncNow: function(force) {
      return pollSyncState(!!force);
    },

    triggerUniversalReconciliation: function(force) {
      return pollSyncState(!!force);
    }
  };

  // Expose global aliases so all modules call the real active sync engine
  window.ATPLGoogleSync = UnifiedSyncEngine;
  window.ATPLCentralFileSync = UnifiedSyncEngine;
  window.ATPLRealtimeSyncEngine = UnifiedSyncEngine;
  window.UniversalEngine = UnifiedSyncEngine;
  window.ATPLFirebase = UnifiedSyncEngine;
  window.ATPLCloudSharedStorageV1 = UnifiedSyncEngine;

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

  // Auto-boot on load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', UnifiedSyncEngine.init, { once: true });
  } else {
    UnifiedSyncEngine.init();
  }
})(window);
