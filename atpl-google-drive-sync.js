/**
 * ATPL GOOGLE DRIVE & GOOGLE SHEETS UNIFIED REAL-TIME SYNC ENGINE (V6 - ULTRA STABLE)
 * Fixes: Paste Data Disappearing, Field Loss, HR Docs/PF/ESIC Disappearing, Zero-Hang, No Firebase Toggle
 */
(function(window) {
  'use strict';

  // ── 0. Force Hide Any Legacy Firebase Toggle UI ──
  function suppressFirebaseUI() {
    try {
      window.ATPL_DISABLE_FIREBASE = true;
      var style = document.getElementById('atpl-no-fb-style');
      if (!style) {
        style = document.createElement('style');
        style.id = 'atpl-no-fb-style';
        style.innerHTML = '[id*="firebase" i], [class*="firebase" i], #fbToggle, .fb-toggle-wrap, [data-sync="firebase"] { display: none !important; }';
        (document.head || document.documentElement).appendChild(style);
      }
    } catch (_) {}
  }
  suppressFirebaseUI();

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

  // Protection Locks to prevent background poll from wiping pasted/uploaded data
  var lastEmpLocalWriteTime = 0;
  var lastFileLocalWriteTime = 0;
  var recentlyUploadedFiles = {}; // { fileNameLow: timestamp }

  // ── Detect Correct MIME Type & File Category ──
  function getMimeType(fileName, fallback) {
    var ext = String(fileName || '').split('.').pop().toLowerCase().trim();
    var map = {
      'pdf': 'application/pdf',
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'png': 'image/png',
      'doc': 'application/msword',
      'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'xls': 'application/vnd.ms-excel',
      'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'csv': 'text/csv',
      'txt': 'text/plain'
    };
    return map[ext] || fallback || 'application/octet-stream';
  }

  function isSpreadsheetFile(fileName) {
    var ext = String(fileName || '').split('.').pop().toLowerCase().trim();
    return ['xlsx', 'xls', 'csv'].indexOf(ext) !== -1;
  }

  // ── Universal Google Apps Script Transport (Safe Timeout + Non-Blocking) ──
  async function callGoogleBackend(action, params) {
    var endpoint = getGasUrl();
    if (!endpoint) return null;
    var p = Object.assign({ action: action, sender: MY_CLIENT_ID, _ts: Date.now() }, params || {});

    var controller = new AbortController();
    var timeoutId = setTimeout(function() { controller.abort(); }, 18000);

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
        try { if (typeof window.renderHRDocs === 'function') window.renderHRDocs(); } catch (_) {}
        try { if (typeof window.renderChallanList === 'function') window.renderChallanList(); } catch (_) {}
        var sl = document.getElementById('storageLbl');
        if (sl && window.FILES) sl.textContent = window.FILES.length + ' files saved';
        updateSyncBadge('ok');
        notifySubscribers('salary');
        notifySubscribers('hr_doc');
        notifySubscribers('files');
      });
    }, 80);
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
    }, 60);
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
    if (typeof buf === 'string') {
      return buf.replace(/^data:[^;]+;base64,/, '').trim();
    }
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

  // ── Normalize Employee ID & Preserve ALL Pasted Fields ──
  function extractEmpId(r) {
    if (!r || typeof r !== 'object') return '';
    var id = r.emp_id || r.empCode || r.emp_code || r.id || r.code || r.EmpID || r['Emp ID'] || r['Employee ID'] || r['Employee Code'] || '';
    return String(id).trim();
  }

  function mergeAndApplyEmployeeRecords(remoteRecords) {
    // 1. Guard: Agar user ne pichle 25 seconds me kuch paste/edit kiya hai, toh remote poll ko overwrite mat karne do!
    if (Date.now() - lastEmpLocalWriteTime < 25000 || window.__ATPL_IS_SAVING_EMP) {
      return;
    }
    if (!Array.isArray(remoteRecords) || !remoteRecords.length) return;

    var dead = {};
    try { dead = JSON.parse(localStorage.getItem('ATPL_EmployeeMasterDeletedV1') || '{}'); } catch (_) {}

    // Local records ka map banao taaki koi bhi extra field (jo paste ki gayi ho) gayab na ho
    var localList = (window.EM && Array.isArray(window.EM.data)) ? window.EM.data : [];
    var localMap = {};
    for (var l = 0; l < localList.length; l++) {
      var lr = localList[l];
      var lid = extractEmpId(lr).toLowerCase();
      if (lid) localMap[lid] = lr;
    }

    var merged = [];
    var seenIds = {};

    for (var i = 0; i < remoteRecords.length; i++) {
      var r = remoteRecords[i];
      if (!r || typeof r !== 'object') continue;
      var rawId = extractEmpId(r);
      if (!rawId) continue;

      var k = rawId.toLowerCase();
      if (k.indexOf('__atpl_sys__') === 0) continue;
      if (dead[k] || dead[k.replace(/^0+/, '')]) continue;

      // Ensure emp_id property always exists
      r.emp_id = rawId;

      // Smart Merge: Local fields + Remote fields (non-empty remote values update local, but local extra columns stay intact)
      var existingLocal = localMap[k];
      var combined = existingLocal ? Object.assign({}, existingLocal) : {};
      Object.keys(r).forEach(function(fieldKey) {
        var val = r[fieldKey];
        if (val !== undefined && val !== null && val !== '') {
          combined[fieldKey] = val;
        } else if (!(fieldKey in combined)) {
          combined[fieldKey] = val;
        }
      });
      combined.emp_id = rawId;

      merged.push(combined);
      seenIds[k] = true;
    }

    // Agar local me koi aisi rows hain jo abhi tak server pe sync nahi hui, unhe gayab mat hone do
    for (var j = 0; j < localList.length; j++) {
      var locRow = localList[j];
      var locId = extractEmpId(locRow);
      if (!locId) continue;
      var lk = locId.toLowerCase();
      if (!seenIds[lk] && !dead[lk] && !dead[lk.replace(/^0+/, '')]) {
        locRow.emp_id = locId;
        merged.push(locRow);
      }
    }

    if (!merged.length) return;

    if (window.EM) window.EM.data = merged.slice();
    if (Array.isArray(window.EMP_MASTER_DATA)) {
      window.EMP_MASTER_DATA.length = 0;
      Array.prototype.push.apply(window.EMP_MASTER_DATA, merged);
    }
    try {
      localStorage.setItem('AroraTextilesEmployeeMasterV3', JSON.stringify(merged));
    } catch (_) {}
    refreshEmployeeUI();
  }

  // ── Safe Background File Download Queue (Supports Excel + PDF/PF/ESIC/HR Docs) ──
  async function processDownloadQueue() {
    if (isDownloading || !downloadQueue.length) return;
    isDownloading = true;
    try {
      while (downloadQueue.length > 0) {
        var fileMeta = downloadQueue.shift();
        if (!fileMeta || !fileMeta.name) continue;
        var fileName = fileMeta.name;
        var nameKey = String(fileName).toLowerCase().trim();

        if (nameKey.includes('attend') && fileMeta.size === 0) {
          continue;
        }

        var existing = (window.FILES || []).find(function(f) {
          return f && String(f.name).toLowerCase().trim() === nameKey;
        });
        if (existing) continue;

        updateSyncBadge('syncing', '⬇️ Syncing ' + fileName + '…');
        try {
          var res = await callGoogleBackend('downloadFile', { fileName: fileName });
          if (res && res.ok && res.fileBase64) {
            await new Promise(function(r) { setTimeout(r, 40); });
            var rawBuf = b64ToBuf(res.fileBase64);
            var mime = getMimeType(fileName, res.mimeType);
            var wb = null;
            var sheets = {};

            // Sirf Excel/CSV files par parseWB chalao, PDF/Challan/Images par nahi!
            if (isSpreadsheetFile(fileName)) {
              try {
                if (rawBuf && typeof window.parseWB === 'function') {
                  wb = window.parseWB(rawBuf);
                }
              } catch (pErr) {
                console.warn('[ATPL Sync] Excel parse skipped:', fileName);
              }
              sheets = (wb && typeof window.wbToSheets === 'function') ? window.wbToSheets(wb) : {};
            }

            window.FILES = (window.FILES || []).filter(function(f) {
              return f && String(f.name).toLowerCase().trim() !== nameKey;
            });

            var newFileObj = {
              id: fileName,
              name: fileName,
              mimeType: mime,
              isDocument: !isSpreadsheetFile(fileName),
              wb: wb,
              sheets: sheets,
              buf: rawBuf,
              base64: res.fileBase64,
              savedAt: fileMeta.updatedAt || new Date().toISOString()
            };

            window.FILES.push(newFileObj);

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
    // Agar abhi upload ya employee save chal raha hai, toh poll skip karo taaki UI data gayab na ho
    if (!endpoint || window.__ATPL_IS_UPLOADING || window.__ATPL_IS_SAVING_EMP) {
      return { ok: true, files: window.FILES || [] };
    }

    var now = Date.now();
    if (!force && (now - lastPollTimestamp < 18000)) {
      return Promise.resolve({ ok: true, throttled: true });
    }
    lastPollTimestamp = now;

    if (isPolling) return Promise.resolve({ ok: true });
    isPolling = true;

    try {
      var state = await callGoogleBackend('getSyncState');
      if (!state || !state.ok) {
        updateSyncBadge('ok');
        return { ok: false };
      }

      // Check again after async network wait: agar is beech user ne kuch upload/paste kiya, toh abort poll apply
      if (window.__ATPL_IS_UPLOADING || window.__ATPL_IS_SAVING_EMP || (Date.now() - lastFileLocalWriteTime < 15000)) {
        return { ok: true, skippedDueToLocalWrite: true };
      }

      var sVer = Number(state.currentVersion || state.version || 0);
      if (sVer > 0) {
        localVersion = Math.max(localVersion, sVer);
        try { localStorage.setItem('ATPL_DRIVE_SYNC_VERSION', String(localVersion)); } catch (_) {}
      }

      var driveFiles = Array.isArray(state.files) ? state.files : [];
      var tombstones = {};
      try { tombstones = JSON.parse(localStorage.getItem('ATPL_SALARY_TOMBSTONES_V2') || '{}'); } catch (_) {}

      driveFiles.forEach(function(df) {
        if (df && df.name) {
          var k = String(df.name).toLowerCase().trim();
          if (tombstones[k] && df.updatedAt && Date.parse(df.updatedAt) > Date.parse(tombstones[k])) {
            delete tombstones[k];
            try { localStorage.setItem('ATPL_SALARY_TOMBSTONES_V2', JSON.stringify(tombstones)); } catch (_) {}
          }
        }
      });

      // 1. Delete ONLY explicitly tombstoned files (Never delete newly uploaded PF/ESIC/HR Docs)
      var currentFiles = Array.isArray(window.FILES) ? window.FILES.slice() : [];
      var filesChanged = false;

      for (var i = currentFiles.length - 1; i >= 0; i--) {
        var cf = currentFiles[i];
        if (!cf || !cf.name) continue;
        var cNameLow = String(cf.name).toLowerCase().trim();

        // Protect recently uploaded files (60 seconds grace period)
        if (recentlyUploadedFiles[cNameLow] && (Date.now() - recentlyUploadedFiles[cNameLow] < 60000)) {
          continue;
        }

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

      // 2. Queue downloads for new files from other devices
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

      // 3. Smart Merge Employees (Won't overwrite recent paste or strip custom fields)
      if (Array.isArray(state.employees) && state.employees.length > 0) {
        mergeAndApplyEmployeeRecords(state.employees);
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
    setTimeout(function() { pollSyncState(true); }, 800);
  }

  // ── Single Trailing Background Poll Timer (No duplicate setInterval, Zero Freeze) ──
  var pollTimerId = null;
  function scheduleNextPoll() {
    clearTimeout(pollTimerId);
    pollTimerId = setTimeout(async function() {
      if (!document.hidden && getGasUrl() && !window.__ATPL_IS_UPLOADING && !window.__ATPL_IS_SAVING_EMP) {
        await pollSyncState(false);
      }
      scheduleNextPoll();
    }, 30000);
  }

  var UnifiedSyncEngine = {
    version: '2026.11.16-GOOGLE-DRIVE-SHEETS-CLEAN-V6',
    apiBase: '',
    gasUrl: GAS_URL,
    fileMap: fileMap,

    init: function() {
      suppressFirebaseUI();
      pollSyncState(true);
      scheduleNextPoll();

      window.addEventListener('focus', function() {
        if (getGasUrl() && !window.__ATPL_IS_UPLOADING && !window.__ATPL_IS_SAVING_EMP) {
          pollSyncState(false);
        }
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
      var mod = 'salary', name = '', rawBuf = null, explicitMime = '';
      if (a === 'salary' || a === 'hr_doc' || a === 'files' || a === 'challan' || a === 'pf' || a === 'esic') {
        mod = a;
        var fileObj = b || {};
        name = (fileObj && (fileObj.name || fileObj.filename || fileObj.id)) || ('file_' + Date.now());
        explicitMime = fileObj.type || fileObj.mimeType || '';
        if (fileObj instanceof Blob) rawBuf = await fileObj.arrayBuffer();
        else if (fileObj.buf instanceof ArrayBuffer) rawBuf = fileObj.buf;
        else if (fileObj instanceof ArrayBuffer) rawBuf = fileObj;
        else if (typeof fileObj.buf === 'string') rawBuf = b64ToBuf(fileObj.buf);
        else if (typeof fileObj.base64 === 'string') rawBuf = b64ToBuf(fileObj.base64);
        else if (typeof fileObj.data === 'string') rawBuf = b64ToBuf(fileObj.data);
      } else if (typeof a === 'string') {
        name = a;
        if (typeof b === 'string') rawBuf = b64ToBuf(b);
        else if (b instanceof ArrayBuffer) rawBuf = b;
        else if (b instanceof Blob) {
          explicitMime = b.type || '';
          rawBuf = await b.arrayBuffer();
        }
      }

      var now = new Date().toISOString();
      var nameLow = String(name).toLowerCase().trim();
      lastFileLocalWriteTime = Date.now();
      recentlyUploadedFiles[nameLow] = Date.now();

      // Clear any old tombstone for this file immediately
      try {
        var tombs = JSON.parse(localStorage.getItem('ATPL_SALARY_TOMBSTONES_V2') || '{}');
        if (tombs[nameLow]) {
          delete tombs[nameLow];
          localStorage.setItem('ATPL_SALARY_TOMBSTONES_V2', JSON.stringify(tombs));
        }
      } catch (_) {}

      var b64Payload = rawBuf ? toB64(rawBuf) : (typeof b === 'string' ? toB64(b) : '');
      var finalMime = getMimeType(name, explicitMime);

      // Keep local reference in window.FILES so UI never drops it after 5-10 seconds
      if (name) {
        window.FILES = (window.FILES || []).filter(function(f) {
          return f && String(f.name).toLowerCase().trim() !== nameLow;
        });
        var wb = null, sheets = {};
        if (rawBuf && isSpreadsheetFile(name) && typeof window.parseWB === 'function') {
          try {
            wb = window.parseWB(rawBuf);
            sheets = typeof window.wbToSheets === 'function' ? window.wbToSheets(wb) : {};
          } catch (_) {}
        }
        window.FILES.push({
          id: name,
          name: name,
          module: mod,
          mimeType: finalMime,
          isDocument: !isSpreadsheetFile(name),
          wb: wb,
          sheets: sheets,
          buf: rawBuf,
          base64: b64Payload,
          savedAt: now
        });
        refreshFilesUI();
      }

      if (b64Payload && getGasUrl()) {
        window.__ATPL_IS_UPLOADING = true;
        window.__ATPL_LAST_UPLOAD_TIME = Date.now();
        updateSyncBadge('syncing', '☁️ Uploading ' + name + '…');
        try {
          var res = await callGoogleBackend('uploadFile', {
            fileName: name,
            module: mod,
            fileBase64: b64Payload,
            mimeType: finalMime
          });
          if (res && res.ok && res.version) {
            localVersion = Math.max(localVersion, res.version);
            try { localStorage.setItem('ATPL_DRIVE_SYNC_VERSION', String(localVersion)); } catch (_) {}
          }
          dispatchSyncTrigger('file_uploaded', { name: name, module: mod });
        } finally {
          window.__ATPL_IS_UPLOADING = false;
          window.__ATPL_LAST_UPLOAD_TIME = Date.now();
          lastFileLocalWriteTime = Date.now();
          updateSyncBadge('ok');
        }
      }
      return { id: name, name: name, module: mod, mimeType: finalMime, created_at: now, ok: true };
    },

    deleteFile: async function(module, idOrName) {
      var name = String(idOrName || module || '').trim();
      if (!name) return false;
      var target = name.toLowerCase().trim();

      delete recentlyUploadedFiles[target];

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
      lastEmpLocalWriteTime = Date.now();
      window.__ATPL_IS_SAVING_EMP = true;

      // Normalize emp_id so pasted rows never get dropped
      var cleaned = [];
      for (var i = 0; i < records.length; i++) {
        var r = records[i];
        if (!r || typeof r !== 'object') continue;
        var id = extractEmpId(r);
        if (id) r.emp_id = id;
        cleaned.push(r);
      }

      try { localStorage.setItem('AroraTextilesEmployeeMasterV3', JSON.stringify(cleaned)); } catch (_) {}
      if (window.EM) window.EM.data = cleaned.slice();
      if (Array.isArray(window.EMP_MASTER_DATA)) {
        window.EMP_MASTER_DATA.length = 0;
        Array.prototype.push.apply(window.EMP_MASTER_DATA, cleaned);
      }

      refreshEmployeeUI();
      dispatchSyncTrigger('employee_updated', { count: cleaned.length });

      try {
        if (getGasUrl()) {
          updateSyncBadge('syncing', '☁️ Saving ' + cleaned.length + ' Employees…');
          await callGoogleBackend('saveEmployeeMaster', { records: cleaned });
          updateSyncBadge('ok');
        }
      } finally {
        lastEmpLocalWriteTime = Date.now();
        window.__ATPL_IS_SAVING_EMP = false;
      }
      return { ok: true };
    },

    upsertEmployeeMaster: async function(records) {
      lastEmpLocalWriteTime = Date.now();
      return this.saveEmployeeMaster(records);
    },

    deleteEmployeeMaster: async function(empCode) {
      lastEmpLocalWriteTime = Date.now();
      if (getGasUrl()) await callGoogleBackend('deleteEmployeeMaster', { empCode: empCode });
      return true;
    },

     subscribe: function(mod, cb) {
      if (!subscribers[mod]) subscribers[mod] = [];
      subscribers[mod].push(cb);
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
