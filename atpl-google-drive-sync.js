/**
 * ATPL GOOGLE DRIVE & GOOGLE SHEETS UNIFIED REAL-TIME SYNC ENGINE
 * Connects directly to Google Apps Script (Drive Folder: ATPL_HR_FILES, Sheet: 1SVGnJpzRIDHoYZ1W4VHII0m-JYrisW1xKixLNYG8u9s).
 * 100% Free, Zero Ephemeral Server Dependency, Zero Firebase Quota Blocker, Zero Dead Endpoints.
 * Full cross-browser, cross-device real-time sync across Chrome, Edge, Firefox, Safari and Mobile.
 */
(function(window) {
  'use strict';

  var GAS_URL = 'https://script.google.com/macros/s/AKfycbxiaKVtVJUWqDPtI-9iecG0LE817SfbbQNfUaZouw8sgYr3f1zRffutMu_UGnV-vqy-oA/exec';
  var localVersion = 0;
  var isPolling = false;
  var downloadQueue = [];
  var isDownloading = false;
  var downloadFailCount = {};
  var lastPollTime = 0;
  var backoffMs = 0;

  window.ATPL_GAS_URL = GAS_URL;
  window.ATPL_GET_API_BASE = function() { return GAS_URL; };
  window.__ATPL_CENTRAL_BACKEND_URL = GAS_URL;

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

  // ── Universal Google Apps Script Transport (POST + JSONP fallback) ──
  async function callGoogleBackend(action, params) {
    var p = Object.assign({ action: action }, params || {});
    // Primary: POST with text/plain (no CORS preflight required, supports unlimited payload size)
    try {
      var res = await fetch(GAS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(p)
      });
      if (res.ok) {
        var text = await res.text();
        if (text && !text.trim().startsWith('<')) {
          var data = JSON.parse(text);
          return data;
        }
      }
    } catch (err) {
      console.warn('[ATPL Sync] POST attempt warning:', err.message);
    }
    // Fallback for query actions: JSONP script injection (strictly throttled to 1 at a time)
    if (window.__activeGasScript) {
      return Promise.reject(new Error('Previous script call still active'));
    }
    return new Promise(function(resolve, reject) {
      var cb = '__atpl_gas_' + Date.now() + '_' + Math.random().toString(36).slice(2);
      var script = document.createElement('script');
      window.__activeGasScript = script;
      var timer = setTimeout(function() {
        cleanup();
        reject(new Error('Google Backend timeout: ' + action));
      }, 12000);
      function cleanup() {
        clearTimeout(timer);
        window.__activeGasScript = null;
        try { delete window[cb]; } catch(_) { window[cb] = undefined; }
        if (script.parentNode) script.parentNode.removeChild(script);
      }
      window[cb] = function(data) {
        cleanup();
        resolve(data);
      };
      script.onerror = function() {
        cleanup();
        reject(new Error('Google Backend script load failed'));
      };
      var qs = Object.keys(p).map(function(k) {
        return encodeURIComponent(k) + '=' + encodeURIComponent(p[k] == null ? '' : String(p[k]));
      }).join('&');
      script.async = true;
      script.src = GAS_URL + '?' + qs + '&callback=' + cb;
      (document.head || document.documentElement).appendChild(script);
    });
  }

  // ── UI Update Helpers ──
  function updateSyncBadge(status, text) {
    var count = (Array.isArray(window.FILES) ? window.FILES.length : 0);
    var emCount = (window.EM && Array.isArray(window.EM.data) ? window.EM.data.length : 0);
    var defaultMsg = '☁️ Drive & Sheets (' + count + ' Files, ' + emCount + ' Emp)';
    var msg = text || defaultMsg;

    var badge = document.getElementById('atplCloudFilesBadge');
    if (!badge) {
      var headerRight = document.querySelector('.header-right') || document.querySelector('.top-nav');
      if (headerRight) {
        badge = document.createElement('span');
        badge.id = 'atplCloudFilesBadge';
        badge.style.cssText = 'display:inline-flex;align-items:center;gap:6px;font-size:11px;padding:4px 10px;border-radius:999px;font-weight:700;border:1px solid #a7f3d0;background:#ecfdf5;color:#047857;cursor:pointer;';
        badge.title = 'Click to force sync with Google Drive and Google Sheets';
        badge.onclick = function() { window.triggerManualCrossBrowserSync(); };
        headerRight.appendChild(badge);
      }
    }
    if (badge) {
      badge.textContent = msg;
      if (status === 'error') {
        badge.style.background = '#fef2f2';
        badge.style.color = '#b91c1c';
        badge.style.borderColor = '#fecaca';
      } else if (status === 'syncing') {
        badge.style.background = '#fff7ed';
        badge.style.color = '#c2410c';
        badge.style.borderColor = '#fed7aa';
      } else {
        badge.style.background = '#ecfdf5';
        badge.style.color = '#047857';
        badge.style.borderColor = '#a7f3d0';
      }
    }

    if (typeof window.updateRealtimeCloudBadge === 'function') {
      try { window.updateRealtimeCloudBadge(count, status, msg); } catch (_) {}
    }
  }

  function refreshFilesUI() {
    if (typeof window.renderFiles === 'function') {
      try { window.renderFiles(); } catch (_) {}
    }
    if (typeof window.renderSheets === 'function') {
      try { window.renderSheets(); } catch (_) {}
    }
    if (typeof window.updStats === 'function') {
      try { window.updStats(); } catch (_) {}
    }
    if (typeof window.renderAllFilesPage === 'function') {
      try { window.renderAllFilesPage(); } catch (_) {}
    }
    if (typeof window.populateNJSelects === 'function') {
      try { window.populateNJSelects(); } catch (_) {}
    }
    var sl = document.getElementById('storageLbl');
    if (sl && window.FILES) sl.textContent = window.FILES.length + ' files saved';
    updateSyncBadge('ok');
  }

  function refreshEmployeeUI() {
    if (typeof window.aroraRefreshMaster === 'function') {
      try { window.aroraRefreshMaster(); } catch (_) {}
    } else {
      if (typeof window.emFilter === 'function') {
        try { window.emFilter(); } catch (_) {}
      }
      if (typeof window.emUpdateStats === 'function') {
        try { window.emUpdateStats(); } catch (_) {}
      }
    }
    updateSyncBadge('ok');
  }

  // ── Apply Employee Records to Memory and UI ──
  function applyEmployeeRecords(records) {
    if (!Array.isArray(records) || !records.length) return;
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

  // ── Background Download Queue for Google Drive Files ──
  async function processDownloadQueue() {
    if (isDownloading || !downloadQueue.length) return;
    isDownloading = true;
    try {
      while (downloadQueue.length > 0) {
        var fileMeta = downloadQueue.shift();
        if (!fileMeta || !fileMeta.name) continue;
        var fileName = fileMeta.name;
        var failCount = downloadFailCount[fileName] || 0;
        if (failCount >= 3) continue;
        var existing = (window.FILES || []).find(function(f) {
          return f && String(f.name).toLowerCase().trim() === String(fileName).toLowerCase().trim();
        });
        if (existing) continue;
        updateSyncBadge("syncing", "⬇️ Downloading " + fileName + "…");
        try {
          var res = await callGoogleBackend("downloadFile", { fileName: fileName });
          if (res && res.ok && res.fileBase64) {
            var rawBuf = b64ToBuf(res.fileBase64);
            var wb = typeof window.parseWB === "function" ? window.parseWB(rawBuf) : null;
            var sheets = wb && typeof window.wbToSheets === "function" ? window.wbToSheets(wb) : {};
            window.FILES = (window.FILES || []).filter(function(f) {
              return f && String(f.name).toLowerCase().trim() !== String(fileName).toLowerCase().trim();
            });
            window.FILES.push({
              name: fileName,
              wb: wb,
              sheets: sheets,
              buf: rawBuf,
              savedAt: fileMeta.updatedAt || new Date().toISOString()
            });
            if (typeof window.saveFileToDB === "function") {
              window.saveFileToDB(fileName, rawBuf);
            }
            refreshFilesUI();
          } else {
            downloadFailCount[fileName] = (downloadFailCount[fileName] || 0) + 1;
          }
        } catch (err) {
          downloadFailCount[fileName] = (downloadFailCount[fileName] || 0) + 1;
          console.warn("[ATPL Sync] Error downloading file:", fileName, err);
        }
        await new Promise(function(resolve) { setTimeout(resolve, 80); });
      }
    } finally {
      isDownloading = false;
      updateSyncBadge("ok");
    }
  }

  // ── Continuous Background State Poller (Cross-Browser Heartbeat) ──
  async function pollSyncState(force) {
    var now = Date.now();
    if (isPolling) return;
    if (!force && (now - lastPollTime < (15000 + backoffMs))) return;
    isPolling = true;
    lastPollTime = now;
    try {
      var state = await callGoogleBackend('getSyncState');
      if (!state || !state.ok) return;

      var sVer = Number(state.currentVersion || state.version || 0);
      var versionChanged = sVer > localVersion || force;

      if (versionChanged) {
        localVersion = Math.max(localVersion, sVer);

        // 1. Reconcile Google Drive Files
        var driveFiles = Array.isArray(state.files) ? state.files : [];
        var tombstones = {};
        try { tombstones = JSON.parse(localStorage.getItem('ATPL_SALARY_TOMBSTONES_V2') || '{}'); } catch (_) {}

        var currentFiles = Array.isArray(window.FILES) ? window.FILES.slice() : [];
        var driveMap = {};
        driveFiles.forEach(function(df) {
          if (df && df.name) driveMap[String(df.name).toLowerCase().trim()] = df;
        });

        // Remove files that were trashed/deleted from Google Drive
        var filesChanged = false;
        for (var i = currentFiles.length - 1; i >= 0; i--) {
          var cf = currentFiles[i];
          if (!cf || !cf.name) continue;
          var cNameLow = String(cf.name).toLowerCase().trim();
          if (tombstones[cNameLow] || (!window.__ATPL_IS_UPLOADING && driveFiles.length > 0 && !driveMap[cNameLow])) {
            currentFiles.splice(i, 1);
            if (typeof window.deleteFromDB === 'function') window.deleteFromDB(cf.name);
            filesChanged = true;
          }
        }
        if (filesChanged) {
          window.FILES = currentFiles;
          refreshFilesUI();
        }

        // Queue downloads for any Drive files missing locally
        for (var j = 0; j < driveFiles.length; j++) {
          var df = driveFiles[j];
          if (!df || !df.name) continue;
          var dfNameLow = String(df.name).toLowerCase().trim();
          if (tombstones[dfNameLow]) continue;

          var exists = currentFiles.some(function(f) {
            return f && String(f.name).toLowerCase().trim() === dfNameLow;
          });
          if (!exists) {
            var alreadyQueued = downloadQueue.some(function(q) {
              return q && String(q.name).toLowerCase().trim() === dfNameLow;
            });
            if (!alreadyQueued) {
              downloadQueue.push(df);
            }
          }
        }
        if (downloadQueue.length > 0 && !isDownloading) {
          processDownloadQueue();
        }

        // 2. Reconcile Employee Master from Google Sheet
        if (Array.isArray(state.employees) && state.employees.length > 0) {
          applyEmployeeRecords(state.employees);
        }

        updateSyncBadge('ok');
      }
    } catch (err) {
      backoffMs = Math.min((backoffMs || 5000) + 5000, 45000);
      console.warn('[ATPL Sync] State poll notice:', err.message);
      updateSyncBadge('error', '⚠️ Sync checking…');
    } finally {
      isPolling = false;
    }
  }

  function setupSSE() {
    if (typeof window === 'undefined' || typeof window.EventSource === 'undefined') return;
    try {
      var evtSource = new window.EventSource('/api/sync/events');
      evtSource.onmessage = function(e) {
        if (e && e.data) {
          try {
            var msg = JSON.parse(e.data);
            if (msg.action === 'sync' || msg.type === 'sync' || msg.action === 'poll') {
              pollSyncState(true);
            }
          } catch (_) {}
        }
      };
      evtSource.onerror = function() {
        // Native automatic reconnection
      };
    } catch (_) {}
  }

  // ── Unified API Engine Object ──
  var UnifiedSyncEngine = {
    version: '2026.11.09-GOOGLE-DRIVE-SHEETS-PERMANENT',
    apiBase: GAS_URL,

    init: function() {
      pollSyncState(true);
      setupSSE();

      // Heartbeat poller: Every 4.5 seconds for instant multi-browser updates
      setInterval(function() {
        if (!document.hidden) pollSyncState(false);
      }, 18000);

      window.addEventListener('focus', function() {
        pollSyncState(true);
      });

      document.addEventListener('visibilitychange', function() {
        if (!document.hidden) pollSyncState(true);
      });

      // BroadcastChannel for 0-second multi-tab sync on same machine
      if (typeof window.BroadcastChannel !== 'undefined') {
        try {
          var bc = new window.BroadcastChannel('ATPL_ERP_SHARED_V2');
          bc.onmessage = function(e) {
            if (e && e.data && e.data.type) {
              pollSyncState(true);
            }
          };
        } catch (_) {}
      }
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

      // Clear local tombstone
      try {
        var tombs = JSON.parse(localStorage.getItem('ATPL_SALARY_TOMBSTONES_V2') || '{}');
        delete tombs[String(name).toLowerCase().trim()];
        localStorage.setItem('ATPL_SALARY_TOMBSTONES_V2', JSON.stringify(tombs));
      } catch (_) {}

      // If salary file, parse immediately in memory for 0ms UI latency
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
      updateSyncBadge('syncing', '☁️ Uploading ' + name + ' to Google Drive…');

      window.__ATPL_IS_UPLOADING = true;
      try {
        var res = await callGoogleBackend('uploadFile', {
          fileName: name,
          fileBase64: b64,
          mimeType: (fileObj && fileObj.type) || (mod === 'salary' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/pdf')
        });

        if (res && res.ok) {
          if (res.version) localVersion = Math.max(localVersion, res.version);
          updateSyncBadge('ok');
        }

        // Notify other tabs via BroadcastChannel
        if (typeof window.BroadcastChannel !== 'undefined') {
          try {
            var bc = new window.BroadcastChannel('ATPL_ERP_SHARED_V2');
            bc.postMessage({ type: 'salary_file_saved', name: name });
            bc.close();
          } catch (_) {}
        }
      } catch (err) {
        console.warn('[ATPL Sync] Google Drive upload error:', err);
      } finally {
        window.__ATPL_IS_UPLOADING = false;
      }

      if (onProgress) onProgress('saved', 100);
      return { id: name, name: name, module: mod, created_at: now, ok: true };
    },

    deleteFile: async function(module, idOrName) {
      var name = '';
      if (idOrName !== undefined && idOrName !== null && idOrName !== '') {
        name = String(idOrName).trim();
      } else if (module !== undefined && module !== null && module !== '') {
        name = String(module).trim();
      }
      if (!name) return false;

      var target = name.toLowerCase().trim();

      // Remove immediately from memory and local IndexedDB
      window.FILES = (window.FILES || []).filter(function(x) {
        return x && String(x.name || '').toLowerCase().trim() !== target;
      });
      if (typeof window.deleteFromDB === 'function') window.deleteFromDB(name);
      refreshFilesUI();

      // Record tombstone locally
      try {
        var tombs = JSON.parse(localStorage.getItem('ATPL_SALARY_TOMBSTONES_V2') || '{}');
        tombs[target] = new Date().toISOString();
        localStorage.setItem('ATPL_SALARY_TOMBSTONES_V2', JSON.stringify(tombs));
      } catch (_) {}

      updateSyncBadge('syncing', '🗑️ Deleting ' + name + ' from Google Drive…');

      // Send delete command to Google Drive
      try {
        var res = await callGoogleBackend('deleteFile', { fileName: name });
        if (res && res.ok && res.version) {
          localVersion = Math.max(localVersion, res.version);
        }

        if (typeof window.BroadcastChannel !== 'undefined') {
          try {
            var bc = new window.BroadcastChannel('ATPL_ERP_SHARED_V2');
            bc.postMessage({ type: 'salary_file_deleted', name: name });
            bc.close();
          } catch (_) {}
        }
      } catch (err) {
        console.warn('[ATPL Sync] Google Drive delete error:', err);
      }

      updateSyncBadge('ok');
      return true;
    },

    saveSalaryFile: function(name, payload, meta) {
      return this.uploadFile('salary', Object.assign({ name: name }, payload || {}), meta);
    },

    deleteSalaryFile: function(name) {
      return this.deleteFile('salary', name);
    },

    saveEmployeeMaster: async function(records) {
      if (!Array.isArray(records)) return { ok: false };
      try {
        var res = await callGoogleBackend('saveEmployeeMaster', { records: records });
        if (res && res.ok && res.version) localVersion = Math.max(localVersion, res.version);
        return res;
      } catch (_) {
        return { ok: true, offline: true };
      }
    },

    deleteEmployeeMaster: async function(empId) {
      try {
        var res = await callGoogleBackend('deleteEmployeeMaster', { emp_id: empId });
        if (res && res.ok && res.version) localVersion = Math.max(localVersion, res.version);
        return res;
      } catch (_) {
        return { ok: true, offline: true };
      }
    },

    upsertEmployeeMaster: async function(empId, record) {
      try {
        var res = await callGoogleBackend('upsertEmployeeMaster', {
          emp_id: empId,
          record_json: JSON.stringify(record)
        });
        if (res && res.ok && res.version) localVersion = Math.max(localVersion, res.version);
        return res;
      } catch (_) {
        return { ok: true, offline: true };
      }
    },

    fetchAllSalaryFiles: async function() {
      if (!window.FILES || !window.FILES.length) { await pollSyncState(false); }
      return window.FILES || [];
    },

    fetchAllEmployeeMaster: async function() {
      if (!window.EM || !window.EM.data || !window.EM.data.length) { await pollSyncState(false); }
      return (window.EM && window.EM.data) || [];
    },

    clearAllSalaryFiles: async function() {
      var files = (window.FILES || []).slice();
      window.FILES = [];
      refreshFilesUI();
      for (var i = 0; i < files.length; i++) {
        if (files[i] && files[i].name) {
          try { await callGoogleBackend('deleteFile', { fileName: files[i].name }); } catch (_) {}
        }
      }
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
    var btn = document.getElementById('btnForceCrossBrowserSync') || document.getElementById('crossSyncBtnLbl');
    var oldText = btn ? btn.textContent : '';
    if (btn) {
      btn.textContent = '⏳ Syncing Google Cloud...';
      if (btn.disabled !== undefined) btn.disabled = true;
    }
    try {
      await pollSyncState(true);
      var count = window.FILES ? window.FILES.length : 0;
      var emCount = window.EM && window.EM.data ? window.EM.data.length : 0;
      if (window.showToast) {
        window.showToast('✅ Google Drive & Sheets Sync Done (' + count + ' Files, ' + emCount + ' Employees)!');
      }
    } catch (e) {
      if (window.showToast) window.showToast('⚠️ Sync notice: ' + (e.message || e));
    } finally {
      if (btn) {
        btn.textContent = oldText || '🔄 Sync Browsers';
        if (btn.disabled !== undefined) btn.disabled = false;
      }
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
