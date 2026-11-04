/**
 * ATPL GOOGLE DRIVE & GOOGLE SHEETS UNIFIED REAL-TIME SYNC ENGINE (V5 - BULLETPROOF)
 * Features: 12s Auto-Timeout, Non-blocking Queue, Zero-Freeze Guard, Safe Offline Fallback
 */
(function(window) {
  'use strict';

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

  // ── Universal Google Apps Script Transport (Safe Timeout + Non-Blocking) ──
  async function callGoogleBackend(action, params) {
    var endpoint = getGasUrl();
    if (!endpoint) return null;
    var p = Object.assign({ action: action, sender: MY_CLIENT_ID, _ts: Date.now() }, params || {});

    // 12-second hard safety timeout (Prevents infinite hanging)
    var controller = new AbortController();
    var timeoutId = setTimeout(function() { controller.abort(); }, 12000);

    try {
      var res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(p),
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      if (res.ok) {
        return await res.json();
      }
    } catch (err) {
      clearTimeout(timeoutId);
      console.warn('[ATPL Sync] Network notice (' + action + '):', err.message);
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

  var emUiTimer = null;
  function refreshEmployeeUI() {
    clearTimeout(emUiTimer);
    emUiTimer = setTimeout(function() {
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
    }, 50);
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

  var _lastAppliedEmpFp = '';
  function applyEmployeeRecords(records) {
    if (!Array.isArray(records) || !records.length) return;
    var len = records.length;
    var fp = len + ':' + (records[0] ? records[0].emp_id : '') + ':' + (records[len - 1] ? records[len - 1].emp_id : '');
    if (_lastAppliedEmpFp === fp && window.EM && Array.isArray(window.EM.data) && window.EM.data.length > 0) {
      return;
    }
    _lastAppliedEmpFp = fp;

    var dead = {};
    try { dead = JSON.parse(localStorage.getItem('ATPL_EmployeeMasterDeletedV1') || '{}'); } catch (_) {}
    var valid = [];
    for (var i = 0; i < len; i++) {
      var r = records[i];
      if (!r || !r.emp_id) continue;
      var k = String(r.emp_id).toLowerCase().trim();
      if (k.indexOf('__atpl_sys__') === 0) continue;
      if (dead[k] || dead[k.replace(/^0+/, '')]) continue;
      valid.push(r);
    }
    if (!valid.length) return;
    if (window.EM) window.EM.data = valid.slice();
    if (Array.isArray(window.EMP_MASTER_DATA)) {
      window.EMP_MASTER_DATA.length = 0;
      Array.prototype.push.apply(window.EMP_MASTER_DATA, valid);
    }
    try {
      if (valid.length < 3000) {
        localStorage.setItem('AroraTextilesEmployeeMasterV3', JSON.stringify(valid));
      }
    } catch (_) {}
    refreshEmployeeUI();
  }

  // ── Safe Background File Download Queue (Freeze-Proof) ──
  async function processDownloadQueue() {
    if (isDownloading || !downloadQueue.length) return;
    isDownloading = true;
    try {
      while (downloadQueue.length > 0) {
        var fileMeta = downloadQueue.shift();
        if (!fileMeta || !fileMeta.name) continue;
        var fileName = fileMeta.name;

        // Skip known corrupt/bomb file names to prevent freezing
        if (String(fileName).toLowerCase().includes('attend') && fileMeta.size === 0) {
          console.warn('[ATPL Sync] Skipping corrupt file:', fileName);
          continue;
        }

        var existing = (window.FILES || []).find(function(f) {
          return f && String(f.name).toLowerCase().trim() === String(fileName).toLowerCase().trim();
        });
        if (existing) continue;

        updateSyncBadge('syncing', '⬇️ Syncing ' + fileName + '…');
        try {
          var res = await callGoogleBackend('downloadFile', { fileName: fileName });
          if (res && res.ok && res.fileBase64) {
            await new Promise(function(r) { setTimeout(r, 40); });
            var rawBuf = b64ToBuf(res.fileBase64);
            var wb = null;
            try {
              if (rawBuf && typeof window.parseWB === 'function') {
                wb = window.parseWB(rawBuf);
              }
            } catch (pErr) {
              console.warn('[ATPL Sync] Parse bypassed to protect UI:', fileName);
            }
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
        await new Promise(function(r) { setTimeout(r, 40); });
      }
    } finally {
      isDownloading = false;
      updateSyncBadge('ok');
    }
  }

  // ── Poll Sync State ──
  var lastPollTimestamp = 0;
  async function pollSyncState(force) {
    if (!isInitialLoaded) {
      isInitialLoaded = true;
      refreshFilesUI();
    }

    var endpoint = getGasUrl();
    if (!endpoint || window.__ATPL_IS_UPLOADING) {
      return { ok: true, files: window.FILES || [] };
    }

    var now = Date.now();
    if (!force && (now - lastPollTimestamp < 15000)) {
      return Promise.resolve({ ok: true, throttled: true });
    }
    lastPollTimestamp = now;

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
          if (tombstones[k] && df.updatedAt && Date.parse(df.updatedAt) > Date.parse(tombstones[k])) {
            delete tombstones[k];
            try { localStorage.setItem('ATPL_SALARY_TOMBSTONES_V2', JSON.stringify(tombstones)); } catch (_) {}
          }
        }
      });

      // 1. Delete local files that were tombstoned
      var currentFiles = Array.isArray(window.FILES) ? window.FILES.slice() : [];
      var filesChanged = false;

      for (var i = currentFiles.length - 1; i >= 0; i--) {
        var cf = currentFiles[i];
        if (!cf || !cf.name) continue;
        var cNameLow = String(cf.name).toLowerCase().trim();
        var tombVal = tombstones[cNameLow];
        var tombTime = typeof tombVal === 'string' ? (Date.parse(tombVal) || 0) : (tombVal === true ? Infinity : 0);
        var fileTime = cf.savedAt ? (Date.parse(cf.savedAt) || 0) : 0;
        if (tombVal && (tombTime > fileTime)) {
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

      // 2. Queue downloads for new files uploaded from other devices
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
    setTimeout(function() { pollSyncState(true); }, 500);
  }

  // ── Safe Background Polling Loop (Trailing Timer, Never Piles Up) ──
  function scheduleNextPoll() {
    setTimeout(async function() {
      if (!document.hidden && getGasUrl() && !window.__ATPL_IS_UPLOADING) {
        await pollSyncState(false);
      }
      scheduleNextPoll();
    }, 30000); // Har 30 second me ek baar safe poll
  }

  var UnifiedSyncEngine = {
    version: '2026.11.16-GOOGLE-DRIVE-SHEETS-CLEAN-V5',
    apiBase: '',
    gasUrl: GAS_URL,
    fileMap: fileMap,

    init: function() {
      pollSyncState(true);
      scheduleNextPoll();
      if (typeof setInterval === 'function') {
        setInterval(function() {
          if (!document.hidden && getGasUrl() && !window.__ATPL_IS_UPLOADING) pollSyncState(false);
        }, 30000);
      }

      window.addEventListener('focus', function() {
        if (getGasUrl() && !window.__ATPL_IS_UPLOADING) pollSyncState(false);
      });
      window.addEventListener('visibilitychange', function() {
        if (!document.hidden && getGasUrl() && !window.__ATPL_IS_UPLOADING) pollSyncState(false);
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
    },

    uploadFile: async function(a, b, c) {
      var mod = 'salary', name = '', rawBuf = null;
      if (a === 'salary' || a === 'hr_doc' || a === 'files') {
        mod = a;
        var fileObj = b || {};
        name = (fileObj && (fileObj.name || fileObj.filename || fileObj.id)) || ('file_' + Date.now());
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

      var b64Payload = rawBuf ? toB64(rawBuf) : (typeof b === 'string' ? b : '');
      if (b64Payload && getGasUrl()) {
        window.__ATPL_IS_UPLOADING = true;
        window.__ATPL_LAST_UPLOAD_TIME = Date.now();
        updateSyncBadge('syncing', '☁️ Uploading ' + name + '…');
        try {
          var res = await callGoogleBackend('uploadFile', {
            fileName: name,
            fileBase64: b64Payload,
            mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
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

    saveEmployeeMaster: async function(records) {
      if (!Array.isArray(records)) return { ok: false };
      try { localStorage.setItem('AroraTextilesEmployeeMasterV3', JSON.stringify(records)); } catch (_) {}
      if (window.EM) window.EM.data = records.slice();
      dispatchSyncTrigger('employee_updated', { count: records.length });
      refreshEmployeeUI();
      if (getGasUrl()) await callGoogleBackend('saveEmployeeMaster', { records: records });
      return { ok: true };
    },
    upsertEmployeeMaster: async function(records) {
      if (getGasUrl()) await callGoogleBackend('upsertEmployeeMaster', { records: records });
      return this.saveEmployeeMaster(records);
    },
    deleteEmployeeMaster: async function(empCode) {
      if (getGasUrl()) await callGoogleBackend('deleteEmployeeMaster', { empCode: empCode });
      return true;
    },

    reconcileAll: async function(force) { return pollSyncState(!!force); },
    syncNow: async function(force) { return pollSyncState(!!force); }
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
