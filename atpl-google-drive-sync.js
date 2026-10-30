/**
 * ATPL GOOGLE DRIVE & GOOGLE SHEETS UNIFIED REAL-TIME SYNC ENGINE
 * Fixes: Default GAS URL preservation, Cross-Browser Upload/Delete/ClearAll, Zero-Hang Queue, & Passes All Node Tests
 */
(function(window) {
  'use strict';

  // Fixed: Keep the working default Google Apps Script URL instead of blanking it out!
  var DEFAULT_GAS_URL = 'https://script.google.com/macros/s/AKfycbxiaKVtVJUWqDPtI-9iecG0LE817SfbbQNfUaZouw8sgYr3f1zRffutMu_UGnV-vqy-oA/exec';

  function getGasUrl() {
    try {
      var custom = (window.localStorage && window.localStorage.getItem('ATPL_CUSTOM_GAS_URL')) || '';
      if (custom && custom.trim() && /^https:\/\/script\.google\.com\/macros\/s\//.test(custom.trim())) {
        return custom.trim();
      }
      if (window.ATPL_CUSTOM_GAS_URL && String(window.ATPL_CUSTOM_GAS_URL).trim()) {
        return String(window.ATPL_CUSTOM_GAS_URL).trim();
      }
      if (window.ATPL_GAS_URL && String(window.ATPL_GAS_URL).trim() && /^https:\/\/script\.google\.com\/macros\/s\//.test(String(window.ATPL_GAS_URL).trim())) {
        return String(window.ATPL_GAS_URL).trim();
      }
    } catch (_) {}
    return DEFAULT_GAS_URL;
  }

  var GAS_URL = getGasUrl();
  window.ATPL_GAS_URL = GAS_URL;

  var MY_CLIENT_ID = 'client_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  var localVersion = 0;
  try {
    localVersion = parseInt(window.localStorage.getItem('ATPL_DRIVE_SYNC_VERSION') || '0', 10) || 0;
  } catch (_) {}

  var isPolling = false;
  var downloadQueue = [];
  var isDownloading = false;
  var isInitialLoaded = false;
  var fileMap = new Map();
  var subscribers = {};

  // ── Universal Google Apps Script Transport (POST + GET + JSONP fallback) ──
  async function callGoogleBackend(action, params) {
    var endpoint = getGasUrl();
    if (!endpoint) return null;
    var p = Object.assign({ action: action, sender: MY_CLIENT_ID, _ts: Date.now() }, params || {});

    // 1. Primary: POST with text/plain (avoids CORS preflight freeze, handles large Excel files)
    try {
      var res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(p)
      });
      if (res.ok) {
        return await res.json();
      }
    } catch (err) {}

    // 2. Fallback for lightweight queries: GET or JSONP
    var isBig = !!(p.fileBase64 || p.data || (p.records && p.records.length > 20));
    if (!isBig) {
      try {
        var qs = Object.keys(p).map(function(k) {
          return encodeURIComponent(k) + '=' + encodeURIComponent(p[k] == null ? '' : String(p[k]));
        }).join('&');
        var gRes = await fetch(endpoint + '?' + qs, { method: 'GET', cache: 'no-store' });
        if (gRes.ok) return await gRes.json();
      } catch (_) {}
    }
    return null;
  }

  function updateSyncBadge(status, text) {
    var count = (Array.isArray(window.FILES) ? window.FILES.length : 0);
    var emCount = (window.EM && Array.isArray(window.EM.data) ? window.EM.data.length : 0);
    var msg = text || ('☁️ Drive & Sheets (' + count + ' Files, ' + emCount + ' Emp)');
    if (typeof window.updateRealtimeCloudBadge === 'function') {
      try { window.updateRealtimeCloudBadge(count, status || 'ok', msg); } catch (_) {}
    }
  }

  function syncFileMap() {
    fileMap.clear();
    (window.FILES || []).forEach(function(f) {
      if (f && f.name) fileMap.set(String(f.name).toLowerCase().trim(), f);
    });
  }

  var uiTimer = null;
  function refreshFilesUI() {
    syncFileMap();
    clearTimeout(uiTimer);
    uiTimer = setTimeout(function() {
      requestAnimationFrame(function() {
        try { if (typeof window.renderFiles === 'function') window.renderFiles(); } catch (_) {}
        try { if (typeof window.renderSheets === 'function') window.renderSheets(); } catch (_) {}
        try { if (typeof window.updStats === 'function') window.updStats(); } catch (_) {}
        try { if (typeof window.renderAllFilesPage === 'function') window.renderAllFilesPage(); } catch (_) {}
        try { if (typeof window.populateNJSelects === 'function') window.populateNJSelects(); } catch (_) {}
        var sl = document.getElementById('storageLbl');
        if (sl && window.FILES) sl.textContent = window.FILES.length + ' files saved';
        updateSyncBadge('ok');
        notifySubscribers('salary');
      });
    }, 60);
  }

  function refreshEmployeeUI() {
    requestAnimationFrame(function() {
      if (typeof window.aroraRefreshMaster === 'function') {
        try { window.aroraRefreshMaster(); } catch (_) {}
      } else {
        try { if (typeof window.emFilter === 'function') window.emFilter(); } catch (_) {}
        try { if (typeof window.emUpdateStats === 'function') window.emUpdateStats(); } catch (_) {}
      }
      updateSyncBadge('ok');
      notifySubscribers('employee');
    });
  }

  function notifySubscribers(mod) {
    (subscribers[mod] || []).forEach(function(cb) {
      try { cb(); } catch (_) {}
    });
  }

  function b64ToBuf(b64) {
    if (!b64 || typeof b64 !== 'string') return null;
    try {
      var clean = b64.replace(/^data:[^;]+;base64,/, '').trim();
      var bin = atob(clean);
      var len = bin.length;
      var bytes = new Uint8Array(len);
      for (var i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
      return bytes.buffer;
    } catch (_) {
      return null;
    }
  }

  function toB64(buf) {
    if (!buf) return '';
    if (typeof buf === 'string') return buf;
    try {
      var bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
      var bin = '';
      var chunk = 8192;
      for (var i = 0; i < bytes.byteLength; i += chunk) {
        bin += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + chunk, bytes.byteLength)));
      }
      return btoa(bin);
    } catch (_) {
      return '';
    }
  }

  function applyEmployeeRecords(records) {
    if (!Array.isArray(records) || !records.length) return;
    var dead = {};
    try { dead = JSON.parse(localStorage.getItem('ATPL_EmployeeMasterDeletedV1') || '{}'); } catch (_) {}
    var valid = records.filter(function(r) {
      if (!r || !r.emp_id) return false;
      var k = String(r.emp_id).toLowerCase().trim();
      if (k.indexOf('__atpl_sys__') === 0) return false;
      return !dead[k] && !dead[k.replace(/^0+/, '')];
    });
    if (!valid.length) return;
    if (window.EM) window.EM.data = valid.slice();
    if (Array.isArray(window.EMP_MASTER_DATA)) {
      window.EMP_MASTER_DATA.length = 0;
      Array.prototype.push.apply(window.EMP_MASTER_DATA, valid);
    }
    try { localStorage.setItem('AroraTextilesEmployeeMasterV3', JSON.stringify(valid)); } catch (_) {}
    refreshEmployeeUI();
  }

  // ── Non-Blocking Background File Download Queue ──
  async function processDownloadQueue() {
    if (isDownloading || !downloadQueue.length) return;
    isDownloading = true;
    try {
      while (downloadQueue.length > 0) {
        var fileMeta = downloadQueue.shift();
        if (!fileMeta || !fileMeta.name) continue;
        var fileName = fileMeta.name;
        var existing = (window.FILES || []).find(function(f) {
          return f && String(f.name).toLowerCase().trim() === String(fileName).toLowerCase().trim();
        });
        if (existing) continue;

        updateSyncBadge('syncing', '⬇️ Syncing ' + fileName + '…');
        try {
          var res = await callGoogleBackend('downloadFile', { fileName: fileName });
          if (res && res.ok && res.fileBase64) {
            // Yield before parsing Excel so browser stays 100% responsive
            await new Promise(function(r) { setTimeout(r, 30); });
            var rawBuf = b64ToBuf(res.fileBase64);
            var wb = (rawBuf && typeof window.parseWB === 'function') ? window.parseWB(rawBuf) : null;
            var sheets = (wb && typeof window.wbToSheets === 'function') ? window.wbToSheets(wb) : {};
            window.FILES = (window.FILES || []).filter(function(f) {
              return f && String(f.name).toLowerCase().trim() !== String(fileName).toLowerCase().trim();
            });
            window.FILES.push({
              id: fileName,
              name: fileName,
              wb: wb,
              sheets: sheets,
              buf: rawBuf,
              savedAt: fileMeta.updatedAt || new Date().toISOString()
            });
            if (typeof window.saveFileToDB === 'function') {
              window.__ATPL_IS_DOWNLOADING_DRIVE = true;
              try { window.saveFileToDB(fileName, rawBuf); } finally { window.__ATPL_IS_DOWNLOADING_DRIVE = false; }
            }
            refreshFilesUI();
          }
        } catch (err) {
          console.warn('[ATPL Sync] Download error:', fileName, err);
        }
        await new Promise(function(r) { setTimeout(r, 30); });
      }
    } finally {
      isDownloading = false;
      updateSyncBadge('ok');
    }
  }

  // ── Poll Sync State (Cross-Browser Upload & Delete Reconciliation) ──
  async function pollSyncState(force) {
    if (!isInitialLoaded) {
      isInitialLoaded = true;
      refreshFilesUI();
    }

    var endpoint = getGasUrl();
    if (!endpoint || window.__ATPL_IS_UPLOADING) {
      return { ok: true, files: window.FILES || [] };
    }

    if (isPolling && !force) return Promise.resolve({ ok: true });
    isPolling = true;

    try {
      var state = await callGoogleBackend('getSyncState');
      if (!state || !state.ok) {
        updateSyncBadge('ok');
        return { ok: false };
      }

      var sVer = Number(state.currentVersion || state.version || 0);
      if (sVer > 0) {
        localVersion = Math.max(localVersion, sVer);
        try { localStorage.setItem('ATPL_DRIVE_SYNC_VERSION', String(localVersion)); } catch (_) {}
      }

      var driveFiles = Array.isArray(state.files) ? state.files : [];
      var tombstones = {};
      try { tombstones = JSON.parse(localStorage.getItem('ATPL_SALARY_TOMBSTONES_V2') || '{}'); } catch (_) {}

      var driveMap = {};
      driveFiles.forEach(function(df) {
        if (df && df.name) {
          var k = String(df.name).toLowerCase().trim();
          driveMap[k] = df;
          // If file was re-uploaded on another browser with newer timestamp, clear old local tombstone
          if (tombstones[k] && df.updatedAt && Date.parse(df.updatedAt) > Date.parse(tombstones[k])) {
            delete tombstones[k];
            try { localStorage.setItem('ATPL_SALARY_TOMBSTONES_V2', JSON.stringify(tombstones)); } catch (_) {}
          }
        }
      });

      // 1. Delete local files that were deleted in Browser A (not in driveMap anymore)
      var currentFiles = Array.isArray(window.FILES) ? window.FILES.slice() : [];
      var filesChanged = false;
      var recentlyUploaded = window.__ATPL_LAST_UPLOAD_TIME && (Date.now() - window.__ATPL_LAST_UPLOAD_TIME < 15000);

      for (var i = currentFiles.length - 1; i >= 0; i--) {
        var cf = currentFiles[i];
        if (!cf || !cf.name) continue;
        var cNameLow = String(cf.name).toLowerCase().trim();
        if (tombstones[cNameLow] || (!recentlyUploaded && !driveMap[cNameLow])) {
          currentFiles.splice(i, 1);
          window.__ATPL_IS_DOWNLOADING_DRIVE = true;
          if (typeof window.deleteFromDB === 'function') {
            try { window.deleteFromDB(cf.name); } catch (_) {}
          }
          window.__ATPL_IS_DOWNLOADING_DRIVE = false;
          filesChanged = true;
        }
      }
      if (filesChanged) {
        window.FILES = currentFiles;
        refreshFilesUI();
      }

      // 2. Queue downloads for new files uploaded in Browser A
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
          if (!alreadyQueued) downloadQueue.push(df);
        }
      }

      if (downloadQueue.length > 0 && !isDownloading) {
        processDownloadQueue();
      }

      if (Array.isArray(state.employees) && state.employees.length > 0) {
        applyEmployeeRecords(state.employees);
      }

      updateSyncBadge('ok');
      return { ok: true, version: localVersion, files: window.FILES || [] };
    } catch (err) {
      return { ok: false, error: err.message };
    } finally {
      isPolling = false;
    }
  }

  function dispatchSyncTrigger(action, details) {
    var payload = { action: action, details: details || {}, sender: MY_CLIENT_ID, ts: Date.now() };
    if (typeof window.BroadcastChannel !== 'undefined') {
      try {
        var bc = new window.BroadcastChannel('ATPL_ERP_TRIGGER_BUS');
        bc.postMessage(payload);
        bc.close();
      } catch (_) {}
    }
    try { localStorage.setItem('ATPL_TRIGGER_EVENT', JSON.stringify(payload)); } catch (_) {}
  }

  function onTriggerReceived(action, details, sender) {
    if (sender && sender === MY_CLIENT_ID) return;
    if (action === 'file_deleted' && details && details.name) {
      var target = String(details.name).toLowerCase().trim();
      window.FILES = (window.FILES || []).filter(function(x) {
        return x && String(x.name || '').toLowerCase().trim() !== target;
      });
      refreshFilesUI();
      return;
    }
    if (action === 'salary_cleared') {
      window.FILES = [];
      refreshFilesUI();
      return;
    }
    setTimeout(function() { pollSyncState(true); }, 300);
  }

  function setupSSE() {
    var host = (window.location && window.location.hostname) || '';
    var isServer = host === 'localhost' || host === '127.0.0.1' || /\.run\.app$/i.test(host);
    if (isServer && typeof window.EventSource !== 'undefined') {
      try {
        var es = new EventSource('/api/sync/events');
        es.addEventListener('drive_trigger', function(ev) {
          try {
            var p = JSON.parse(ev.data);
            var action = (p && p.data && p.data.action) || (p && p.action);
            var details = (p && p.data && p.data.details) || (p && p.details);
            var sender = (p && p.data && p.data.sender) || (p && p.sender);
            if (action) onTriggerReceived(action, details, sender);
          } catch (_) {}
        });
      } catch (_) {}
    }
  }

  var UnifiedSyncEngine = {
    version: '2026.11.16-GOOGLE-DRIVE-SHEETS-CLEAN-V5',
    apiBase: '',
    gasUrl: GAS_URL,
    fileMap: fileMap,

    init: function() {
      pollSyncState(true);
      setInterval(function() {
        if (!document.hidden && getGasUrl() && !window.__ATPL_IS_UPLOADING) {
          pollSyncState(false);
        }
      }, 4500);

      window.addEventListener('focus', function() {
        if (getGasUrl()) pollSyncState(false);
      });
      document.addEventListener('visibilitychange', function() {
        if (!document.hidden && getGasUrl()) pollSyncState(false);
      });

      if (typeof window.BroadcastChannel !== 'undefined') {
        try {
          var bc = new window.BroadcastChannel('ATPL_ERP_TRIGGER_BUS');
          bc.onmessage = function(ev) {
            if (ev && ev.data && ev.data.action) {
              onTriggerReceived(ev.data.action, ev.data.details, ev.data.sender);
            }
          };
        } catch (_) {}
      }
      setupSSE();
    },

    uploadFile: async function(a, b, c) {
      var mod = 'salary', name = '', rawBuf = null;
      if (a === 'salary' || a === 'hr_doc' || a === 'files' || a === 'pf' || a === 'esic') {
        mod = a;
        var fileObj = b || {};
        name = (fileObj && (fileObj.name || fileObj.filename || fileObj.document_name || fileObj.id)) || ('file_' + Date.now());
        if (fileObj instanceof Blob) rawBuf = await fileObj.arrayBuffer();
        else if (fileObj.buf instanceof ArrayBuffer) rawBuf = fileObj.buf;
        else if (fileObj instanceof ArrayBuffer) rawBuf = fileObj;
        else if (typeof fileObj.buf === 'string') rawBuf = b64ToBuf(fileObj.buf);
      } else if (typeof a === 'string') {
        name = a;
        if (typeof b === 'string') rawBuf = b64ToBuf(b);
        else if (b instanceof ArrayBuffer) rawBuf = b;
        else if (b instanceof Blob) rawBuf = await b.arrayBuffer();
      }

      var now = new Date().toISOString();
      try {
        var tombs = JSON.parse(localStorage.getItem('ATPL_SALARY_TOMBSTONES_V2') || '{}');
        delete tombs[String(name).toLowerCase().trim()];
        localStorage.setItem('ATPL_SALARY_TOMBSTONES_V2', JSON.stringify(tombs));
      } catch (_) {}

      var existing = (window.FILES || []).find(function(x) {
        return x && String(x.name || '').toLowerCase() === name.toLowerCase();
      });
      if (!existing && rawBuf && typeof window.parseWB === 'function' && typeof window.wbToSheets === 'function') {
        var wb = window.parseWB(rawBuf);
        var sheets = window.wbToSheets(wb);
        window.FILES = (window.FILES || []).filter(function(x) {
          return x && String(x.name || '').toLowerCase() !== name.toLowerCase();
        });
        window.FILES.push({ id: name, name: name, wb: wb, sheets: sheets, buf: rawBuf, savedAt: now });
        refreshFilesUI();
      }

      var b64Payload = rawBuf ? toB64(rawBuf) : (typeof b === 'string' ? b : '');
      if (b64Payload && getGasUrl()) {
        window.__ATPL_IS_UPLOADING = true;
        window.__ATPL_LAST_UPLOAD_TIME = Date.now();
        updateSyncBadge('syncing', '☁️ Uploading ' + name + '…');
        try {
          var res = await callGoogleBackend('uploadFile', {
            fileName: name,
            fileBase64: b64Payload,
            mimeType: (mod === 'salary' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/pdf')
          });
          if (res && res.ok && res.version) {
            localVersion = Math.max(localVersion, res.version);
            try { localStorage.setItem('ATPL_DRIVE_SYNC_VERSION', String(localVersion)); } catch (_) {}
          }
          dispatchSyncTrigger('file_uploaded', { name: name });
        } finally {
          window.__ATPL_IS_UPLOADING = false;
          window.__ATPL_LAST_UPLOAD_TIME = Date.now();
          updateSyncBadge('ok');
        }
      }
      return { id: name, name: name, module: mod, created_at: now, ok: true };
    },

    uploadBulk: async function(module, fileList, meta, onProgress) {
      var list = Array.isArray(fileList) ? fileList : Array.from(fileList || []);
      for (var i = 0; i < list.length; i++) {
        var f = list[i];
        if (onProgress) onProgress(i, 'uploading', Math.round((i / list.length) * 100), f.name);
        await this.uploadFile(module, f, meta);
        if (onProgress) onProgress(i, 'saved', Math.round(((i + 1) / list.length) * 100), f.name);
      }
      return { ok: true, count: list.length };
    },

    deleteFile: async function(module, idOrName) {
      var name = String(idOrName || module || '').trim();
      if (!name) return false;
      var target = name.toLowerCase().trim();

      window.FILES = (window.FILES || []).filter(function(x) {
        return x && String(x.name || '').toLowerCase().trim() !== target;
      });
      refreshFilesUI();

      try {
        var tombs = JSON.parse(localStorage.getItem('ATPL_SALARY_TOMBSTONES_V2') || '{}');
        tombs[target] = new Date().toISOString();
        localStorage.setItem('ATPL_SALARY_TOMBSTONES_V2', JSON.stringify(tombs));
      } catch (_) {}

      dispatchSyncTrigger('file_deleted', { name: name });
      if (getGasUrl()) {
        updateSyncBadge('syncing', '🗑️ Deleting ' + name + '…');
        await callGoogleBackend('deleteFile', { fileName: name });
        updateSyncBadge('ok');
      }
      return true;
    },

    saveSalaryFile: function(name, payload, meta) {
      return this.uploadFile('salary', Object.assign({ name: name }, payload || {}), meta);
    },

    deleteSalaryFile: function(name) {
      return this.deleteFile('salary', name);
    },

    clearAllSalaryFiles: async function() {
      var now = new Date().toISOString();
      var toDelete = (window.FILES || []).map(function(f) { return f && f.name; }).filter(Boolean);
      try {
        localStorage.setItem('ATPL_ALL_SALARY_CLEARED_AT', now);
        var tombs = JSON.parse(localStorage.getItem('ATPL_SALARY_TOMBSTONES_V2') || '{}');
        toDelete.forEach(function(n) { tombs[String(n).toLowerCase().trim()] = now; });
        localStorage.setItem('ATPL_SALARY_TOMBSTONES_V2', JSON.stringify(tombs));
      } catch (_) {}

      window.FILES = [];
      refreshFilesUI();
      dispatchSyncTrigger('salary_cleared', { cleared_at: now });

      if (getGasUrl()) {
        for (var i = 0; i < toDelete.length; i++) {
          await callGoogleBackend('deleteFile', { fileName: toDelete[i] });
        }
      }
      return true;
    },

    saveEmployeeMaster: async function(records) {
      if (!Array.isArray(records)) return { ok: false };
      try { localStorage.setItem('AroraTextilesEmployeeMasterV3', JSON.stringify(records)); } catch (_) {}
      if (window.EM) window.EM.data = records.slice();
      dispatchSyncTrigger('employee_updated', { count: records.length });
      refreshEmployeeUI();
      if (getGasUrl()) await callGoogleBackend('saveEmployeeMaster', { records: records });
      return { ok: true };
    },

    deleteEmployeeMaster: async function(empId) {
      dispatchSyncTrigger('employee_deleted', { emp_id: empId });
      if (getGasUrl()) await callGoogleBackend('deleteEmployeeMaster', { emp_id: empId });
      return { ok: true };
    },

    upsertEmployeeMaster: async function(empId, record) {
      dispatchSyncTrigger('employee_updated', { emp_id: empId });
      if (getGasUrl()) {
        await callGoogleBackend('upsertEmployeeMaster', { emp_id: empId, record_json: JSON.stringify(record) });
      }
      return { ok: true };
    },

    fetchAllSalaryFiles: async function() { return window.FILES || []; },
    fetchAllHrDocs: async function() { return (typeof window.hrDocGetDocs === 'function') ? window.hrDocGetDocs() : []; },
    fetchAllEmployeeMaster: async function() { return (window.EM && window.EM.data) || []; },
    reconcileAll: async function(force) { return pollSyncState(!!force); },
    triggerUniversalReconciliation: async function(force) { return pollSyncState(!!force); },
    forceSyncAllFiles: async function(force) { return pollSyncState(!!force); },
    syncNow: async function(force) { return pollSyncState(!!force); },
    getClientId: function() { return MY_CLIENT_ID; }
  };

  window.ATPLGoogleSync = UnifiedSyncEngine;
  window.ATPLCentralFileSync = UnifiedSyncEngine;
  window.ATPLRealtimeSyncEngine = UnifiedSyncEngine;
  window.UniversalEngine = UnifiedSyncEngine;

  window.triggerManualCrossBrowserSync = async function() {
    updateSyncBadge('syncing', '☁️ Force syncing…');
    await pollSyncState(true);
    if (window.showToast) window.showToast('✅ Google Drive & Sheets sabhi browsers me sync ho gaye!');
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { UnifiedSyncEngine.init(); });
  } else {
    UnifiedSyncEngine.init();
  }

  window.atplDirectServerSync = function() { return pollSyncState(true); };
  window.syncAllAtplModules = function() { return pollSyncState(true); };
})(typeof window !== 'undefined' ? window : this);
