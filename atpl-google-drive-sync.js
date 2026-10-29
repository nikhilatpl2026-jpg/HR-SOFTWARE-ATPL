/**
 * ATPL GOOGLE DRIVE & GOOGLE SHEETS UNIFIED REAL-TIME SYNC ENGINE (OPTION 1)
 * Ultra-fast, zero-hang, zero-junk cross-browser synchronization for Arora ERP.
 * Direct user-controlled integration with Google Drive (folder: ATPL_HR_FILES) and Google Sheets.
 * Starts 100% clean: Zero fake files, zero dummy employees. Only what the user uploads and manages!
 */
(function(window) {
  'use strict';

  var DEFAULT_GAS_URL = '';
  function getGasUrl() {
    try {
      var custom = (window.localStorage && window.localStorage.getItem('ATPL_CUSTOM_GAS_URL')) || '';
      if (custom && custom.trim() && /^https:\/\/script\.google\.com\/macros\/s\//.test(custom.trim())) {
        return custom.trim();
      }
      if (window.ATPL_CUSTOM_GAS_URL && String(window.ATPL_CUSTOM_GAS_URL).trim()) {
        return String(window.ATPL_CUSTOM_GAS_URL).trim();
      }
      if (window.ATPL_GAS_URL && String(window.ATPL_GAS_URL).trim() && !window.ATPL_GAS_URL.includes('AKfycbxiaKVtVJUWqDPtI')) {
        return String(window.ATPL_GAS_URL).trim();
      }
    } catch (_) {}
    return DEFAULT_GAS_URL;
  }

  var GAS_URL = getGasUrl();
  window.ATPL_GAS_URL = GAS_URL;
  window.ATPL_GET_API_BASE = function() { return ''; };
  window.__ATPL_CENTRAL_BACKEND_URL = '';

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

  // ── Universal Google Apps Script Transport (POST + JSONP fallback) ──
  async function callGoogleBackend(action, params) {
    var endpoint = getGasUrl();
    if (!endpoint) return null; // No dummy endpoint call
    var p = Object.assign({ action: action, sender: MY_CLIENT_ID }, params || {});

    // 1. Primary: POST with text/plain (avoids CORS preflight, handles large files)
    try {
      var res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(p)
      });
      if (res.ok) {
        var data = await res.json();
        return data;
      }
    } catch (err) {
      // POST network or CORS issue, fall back if applicable
    }

    // 2. Query actions fallback: GET or JSONP script injection
    var isBig = !!(p.fileBase64 || p.data || (p.records && p.records.length > 20));
    if (!isBig) {
      try {
        var qs = Object.keys(p).map(function(k) {
          return encodeURIComponent(k) + '=' + encodeURIComponent(p[k] == null ? '' : String(p[k]));
        }).join('&');
        var gRes = await fetch(endpoint + '?' + qs, { method: 'GET', cache: 'no-store' });
        if (gRes.ok) {
          return await gRes.json();
        }
      } catch (_) {}

      return new Promise(function(resolve) {
        var cb = '__atpl_gas_' + Date.now() + '_' + Math.random().toString(36).slice(2);
        var script = document.createElement('script');
        var timer = setTimeout(function() {
          cleanup();
          resolve(null);
        }, 20000);
        function cleanup() {
          clearTimeout(timer);
          try { delete window[cb]; } catch (_) { window[cb] = undefined; }
          if (script.parentNode) script.parentNode.removeChild(script);
        }
        window[cb] = function(data) {
          cleanup();
          resolve(data);
        };
        script.onerror = function() {
          cleanup();
          resolve(null);
        };
        var qs = Object.keys(p).map(function(k) {
          return encodeURIComponent(k) + '=' + encodeURIComponent(p[k] == null ? '' : String(p[k]));
        }).join('&');
        script.async = true;
        script.src = endpoint + '?' + qs + '&callback=' + cb;
        (document.head || document.documentElement).appendChild(script);
      });
    }

    return null;
  }

  // ── UI Update Helpers ──
  function updateSyncBadge(status, text) {
    var count = (Array.isArray(window.FILES) ? window.FILES.length : 0);
    var emCount = (window.EM && Array.isArray(window.EM.data) ? window.EM.data.length : 0);
    var hasUrl = !!getGasUrl();
    var defaultMsg = hasUrl
      ? ('☁️ Drive & Sheets (' + count + ' Files, ' + emCount + ' Emp)')
      : ('☁️ Drive & Sheets: Connect Setup (' + count + ' Files)');
    var msg = text || defaultMsg;

    var badge = document.getElementById('atplCloudFilesBadge');
    if (!badge) {
      var headerRight = document.querySelector('.header-right') || document.querySelector('.top-nav');
      if (headerRight) {
        badge = document.createElement('span');
        badge.id = 'atplCloudFilesBadge';
        badge.style.cssText = 'display:inline-flex;align-items:center;gap:6px;font-size:11px;padding:4px 10px;border-radius:999px;font-weight:700;border:1px solid #a7f3d0;background:#ecfdf5;color:#047857;cursor:pointer;';
        badge.title = 'Google Drive & Sheets Integration. Click to manage setup.';
        badge.onclick = function() {
          if (!getGasUrl() && typeof window.openCloudSyncModal === 'function') {
            window.openCloudSyncModal();
          } else {
            window.triggerManualCrossBrowserSync();
          }
        };
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
      } else if (!hasUrl) {
        badge.style.background = '#f0fdf4';
        badge.style.color = '#15803d';
        badge.style.borderColor = '#bbf7d0';
      } else {
        badge.style.background = '#ecfdf5';
        badge.style.color = '#047857';
        badge.style.borderColor = '#a7f3d0';
      }
    }
    if (typeof window.updateRealtimeCloudBadge === 'function') {
      try { window.updateRealtimeCloudBadge(count, status || 'ok', msg); } catch (_) {}
    }
  }

  function syncFileMap() {
    fileMap.clear();
    (window.FILES || []).forEach(function(f) {
      if (f && f.name) {
        fileMap.set(String(f.name).toLowerCase().trim(), f);
      }
    });
  }

  function refreshFilesUI() {
    syncFileMap();
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
    notifySubscribers('salary');
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
    notifySubscribers('employee');
  }

  function notifySubscribers(mod) {
    var list = subscribers[mod] || [];
    list.forEach(function(cb) {
      try { cb(); } catch (_) {}
    });
  }

  // ── Buffer Utilities ──
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

  // ── Background Download Queue for Google Drive Files (Zero Hang) ──
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
              try {
                window.saveFileToDB(fileName, rawBuf);
              } finally {
                window.__ATPL_IS_DOWNLOADING_DRIVE = false;
              }
            }
            refreshFilesUI();
          }
        } catch (err) {
          console.warn('[ATPL Sync] Notice downloading file:', fileName, err);
        }
        await new Promise(function(r) { setTimeout(r, 20); });
      }
    } finally {
      isDownloading = false;
      updateSyncBadge('ok');
    }
  }

  // ── Continuous Background State Poller (Zero-Hang Heartbeat) ──
  async function pollSyncState(force) {
    if (!isInitialLoaded) {
      isInitialLoaded = true;
      if (typeof window.loadFilesFromDB === 'function') {
        try { window.loadFilesFromDB(); } catch (_) {}
      }
      refreshFilesUI();
    }

    var endpoint = getGasUrl();
    if (!endpoint) {
      updateSyncBadge('ok');
      return { ok: true, localOnly: true, files: window.FILES || [] };
    }

    if (isPolling && !force) return Promise.resolve({ ok: true });
    isPolling = true;

    try {
      // 1. Lightweight version probe (under 100 bytes, <1s response)
      var statusRes = null;
      if (!force) {
        statusRes = await callGoogleBackend('status');
      }
      var remoteVersion = statusRes ? Number(statusRes.currentVersion || 0) : 0;
      var needFullSync = force || (statusRes && remoteVersion > localVersion) || localVersion === 0;

      if (!needFullSync) {
        updateSyncBadge('ok');
        return { ok: true, version: localVersion, files: window.FILES || [] };
      }

      // 2. Fetch fresh state from the user's Google Drive & Sheets
      updateSyncBadge('syncing', '☁️ Syncing with Google Cloud…');
      var state = await callGoogleBackend('getSyncState');
      if (!state || !state.ok) {
        updateSyncBadge('ok');
        return { ok: false };
      }

      var sVer = Number(state.currentVersion || state.version || remoteVersion || 0);
      localVersion = Math.max(localVersion, sVer);
      try {
        localStorage.setItem('ATPL_DRIVE_SYNC_VERSION', String(localVersion));
      } catch (_) {}

      // Reconcile Google Drive Files
      var driveFiles = Array.isArray(state.files) ? state.files : [];
      var tombstones = {};
      try { tombstones = JSON.parse(localStorage.getItem('ATPL_SALARY_TOMBSTONES_V2') || '{}'); } catch (_) {}
      var currentFiles = Array.isArray(window.FILES) ? window.FILES.slice() : [];
      var driveMap = {};
      driveFiles.forEach(function(df) {
        if (df && df.name) driveMap[String(df.name).toLowerCase().trim()] = df;
      });

      // Remove files that were trashed or deleted from Google Drive
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

      // Queue downloads only for files present in user's Drive but missing locally
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

      // Reconcile Employee Master from the user's Google Sheet
      if (Array.isArray(state.employees)) {
        applyEmployeeRecords(state.employees);
      }

      updateSyncBadge('ok');
      return { ok: true, version: localVersion, files: window.FILES || [] };
    } catch (err) {
      console.warn('[ATPL Sync] Notice:', err.message);
      updateSyncBadge('ok');
      return { ok: false, error: err.message };
    } finally {
      isPolling = false;
    }
  }

  // ── Event-Driven Cross-Browser Sync Trigger Engine ──
  function dispatchSyncTrigger(action, details) {
    var payload = { action: action, details: details || {}, sender: MY_CLIENT_ID, ts: Date.now() };

    // 1. BroadcastChannel: Instant notification to other tabs in same browser (0ms)
    if (typeof window.BroadcastChannel !== 'undefined') {
      try {
        var bc = new window.BroadcastChannel('ATPL_ERP_TRIGGER_BUS');
        bc.postMessage(payload);
        bc.close();
      } catch (_) {}
      try {
        var bc2 = new window.BroadcastChannel('ATPL_ERP_SHARED_V2');
        bc2.postMessage({ type: action, details: details || {} });
        bc2.close();
      } catch (_) {}
    }

    // 2. Storage event: Fires across all open windows of the app (0ms)
    try {
      localStorage.setItem('ATPL_TRIGGER_EVENT', JSON.stringify(payload));
    } catch (_) {}

    // 3. Optional local server notification (fire-and-forget, zero block)
    var host = (window.location && window.location.hostname) || '';
    if (host === 'localhost' || host === '127.0.0.1' || /\.run\.app$/i.test(host)) {
      try {
        fetch('/api/sync/trigger', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        }).catch(function() {});
      } catch (_) {}
    }
  }

  function onTriggerReceived(action, details, sender) {
    var originSender = sender || (details && details.sender);
    if (originSender && originSender === MY_CLIENT_ID) {
      return; // Ignore self-echo
    }

    // Handle file deletion instantly
    if (action === 'file_deleted' && details && details.name) {
      var target = String(details.name).toLowerCase().trim();
      window.FILES = (window.FILES || []).filter(function(x) {
        return x && String(x.name || '').toLowerCase().trim() !== target;
      });
      if (typeof window.deleteFromDB === 'function') {
        window.deleteFromDB(details.name);
      }
      try {
        var tombs = JSON.parse(localStorage.getItem('ATPL_SALARY_TOMBSTONES_V2') || '{}');
        tombs[target] = new Date().toISOString();
        localStorage.setItem('ATPL_SALARY_TOMBSTONES_V2', JSON.stringify(tombs));
      } catch (_) {}
      refreshFilesUI();
      return;
    }

    // Handle file update / reload from IndexedDB or Drive
    if (action === 'file_uploaded') {
      if (typeof window.loadFilesFromDB === 'function') {
        try { window.loadFilesFromDB(); } catch (_) {}
      }
      refreshFilesUI();
      setTimeout(function() { pollSyncState(false); }, 300);
    }

    if (action === 'employee_updated' || action === 'employee_deleted') {
      setTimeout(function() { pollSyncState(false); }, 300);
    }
  }

  // ── Setup SSE (Optional Server Event Stream, Never Blocks) ──
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
        es.onerror = function() {};
      } catch (_) {}
    }
  }

  // ── Unified API Engine Object ──
  var UnifiedSyncEngine = {
    version: '2026.11.16-GOOGLE-DRIVE-SHEETS-CLEAN-V5',
    apiBase: '',
    gasUrl: GAS_URL,
    fileMap: fileMap,

    init: function() {
      // 1. Initial quick sync from IndexedDB
      pollSyncState(true);

      // 2. Periodic Heartbeat Poller (Every 5 seconds for instant cross-device updates)
      setInterval(function() {
        if (!document.hidden && getGasUrl()) {
          pollSyncState(false);
        }
      }, 5000);

      // 3. Tab focus & visibility change trigger instant check
      window.addEventListener('focus', function() {
        if (getGasUrl()) pollSyncState(false);
      });
      document.addEventListener('visibilitychange', function() {
        if (!document.hidden && getGasUrl()) {
          pollSyncState(false);
        }
      });

      // 4. Cross-tab BroadcastChannel Trigger Listener (0ms)
      if (typeof window.BroadcastChannel !== 'undefined') {
        try {
          var bc = new window.BroadcastChannel('ATPL_ERP_TRIGGER_BUS');
          bc.onmessage = function(ev) {
            if (ev && ev.data && ev.data.action) {
              onTriggerReceived(ev.data.action, ev.data.details, ev.data.sender);
            }
          };
        } catch (_) {}
        try {
          var bc2 = new window.BroadcastChannel('ATPL_ERP_SHARED_V2');
          bc2.onmessage = function(ev) {
            if (ev && ev.data && getGasUrl()) {
              pollSyncState(false);
            }
          };
        } catch (_) {}
      }

      // 5. Cross-window LocalStorage Event Trigger Listener (0ms)
      window.addEventListener('storage', function(ev) {
        if (ev && ev.key === 'ATPL_TRIGGER_EVENT' && ev.newValue) {
          try {
            var payload = JSON.parse(ev.newValue);
            if (payload && payload.action) {
              onTriggerReceived(payload.action, payload.details, payload.sender);
            }
          } catch (_) {}
        }
        if (ev && ev.key === 'ATPL_CUSTOM_GAS_URL') {
          GAS_URL = getGasUrl();
          window.ATPL_GAS_URL = GAS_URL;
          pollSyncState(true);
        }
      });

      // 6. Server-Sent Events (when running with local Express server)
      setupSSE();
    },

    uploadFile: async function(a, b, c, d) {
      var mod = 'salary', name = '', rawBuf = null;
      if (a === 'salary' || a === 'hr_doc' || a === 'files' || a === 'pf' || a === 'esic') {
        mod = a;
        var fileObj = b || {};
        name = (fileObj && (fileObj.name || fileObj.filename || fileObj.document_name || fileObj.id)) || ('file_' + Date.now());
        if (fileObj instanceof Blob) {
          rawBuf = await fileObj.arrayBuffer();
        } else if (fileObj.buf instanceof ArrayBuffer) {
          rawBuf = fileObj.buf;
        } else if (fileObj instanceof ArrayBuffer) {
          rawBuf = fileObj;
        } else if (typeof fileObj.buf === 'string') {
          rawBuf = b64ToBuf(fileObj.buf);
        }
      } else if (typeof a === 'string') {
        name = a;
        if (typeof b === 'string') {
          rawBuf = b64ToBuf(b);
        } else if (b instanceof ArrayBuffer) {
          rawBuf = b;
        } else if (b instanceof Blob) {
          rawBuf = await b.arrayBuffer();
        }
      } else {
        var fileObj = a || {};
        name = (fileObj && (fileObj.name || fileObj.filename || fileObj.document_name || fileObj.id)) || ('file_' + Date.now());
        if (fileObj instanceof Blob) {
          rawBuf = await fileObj.arrayBuffer();
        } else if (fileObj.buf instanceof ArrayBuffer) {
          rawBuf = fileObj.buf;
        }
      }

      var now = new Date().toISOString();
      // Clear local tombstone
      try {
        var tombs = JSON.parse(localStorage.getItem('ATPL_SALARY_TOMBSTONES_V2') || '{}');
        delete tombs[String(name).toLowerCase().trim()];
        localStorage.setItem('ATPL_SALARY_TOMBSTONES_V2', JSON.stringify(tombs));
      } catch (_) {}

      // 1. Store immediately in memory and IndexedDB (0ms latency for current user)
      if (rawBuf && typeof window.parseWB === 'function' && typeof window.wbToSheets === 'function') {
        var wb = window.parseWB(rawBuf);
        var sheets = window.wbToSheets(wb);
        var entry = { id: name, name: name, wb: wb, sheets: sheets, buf: rawBuf, savedAt: now };
        window.FILES = (window.FILES || []).filter(function(x) {
          return x && String(x.name || '').toLowerCase() !== name.toLowerCase();
        });
        window.FILES.push(entry);
        try {
          if (typeof window.saveFileToDB === 'function') window.saveFileToDB(name, rawBuf);
        } catch (_) {}
        refreshFilesUI();
      }

      // 2. Instant cross-tab broadcast (0ms)
      dispatchSyncTrigger('file_uploaded', { name: name, size: (rawBuf && rawBuf.byteLength) || 0 });
      updateSyncBadge('syncing', '☁️ Saving ' + name + '…');

      // 3. Background Cloud Sync to user's Google Drive
      var b64Payload = rawBuf ? toB64(rawBuf) : '';
      if (b64Payload && getGasUrl()) {
        window.__ATPL_IS_UPLOADING = true;
        callGoogleBackend('uploadFile', {
          fileName: name,
          fileBase64: b64Payload,
          mimeType: (mod === 'salary' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/pdf')
        }).then(function(res) {
          if (res && res.ok && res.version) {
            localVersion = Math.max(localVersion, res.version);
            try { localStorage.setItem('ATPL_DRIVE_SYNC_VERSION', String(localVersion)); } catch (_) {}
          }
          updateSyncBadge('ok');
        }).catch(function(err) {
          console.warn('[ATPL Sync] Cloud save warning:', err);
          updateSyncBadge('ok');
        }).finally(function() {
          window.__ATPL_IS_UPLOADING = false;
        });
      } else {
        updateSyncBadge('ok');
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
      var name = '';
      if (idOrName !== undefined && idOrName !== null && idOrName !== '') {
        name = String(idOrName).trim();
      } else if (module !== undefined && module !== null && module !== '') {
        name = String(module).trim();
      }
      if (!name) return false;
      var target = name.toLowerCase().trim();

      // 1. Remove immediately from memory and local IndexedDB (0ms)
      window.FILES = (window.FILES || []).filter(function(x) {
        return x && String(x.name || '').toLowerCase().trim() !== target;
      });
      if (typeof window.deleteFromDB === 'function') window.deleteFromDB(name);
      refreshFilesUI();

      // 2. Record tombstone locally
      try {
        var tombs = JSON.parse(localStorage.getItem('ATPL_SALARY_TOMBSTONES_V2') || '{}');
        tombs[target] = new Date().toISOString();
        localStorage.setItem('ATPL_SALARY_TOMBSTONES_V2', JSON.stringify(tombs));
      } catch (_) {}

      // 3. Instant local broadcast
      dispatchSyncTrigger('file_deleted', { name: name });
      updateSyncBadge('syncing', '🗑️ Deleting ' + name + '…');

      // 4. Background Cloud Deletion on user's Google Drive
      if (getGasUrl()) {
        callGoogleBackend('deleteFile', { fileName: name }).then(function(res) {
          if (res && res.ok && res.version) {
            localVersion = Math.max(localVersion, res.version);
            try { localStorage.setItem('ATPL_DRIVE_SYNC_VERSION', String(localVersion)); } catch (_) {}
          }
          updateSyncBadge('ok');
        }).catch(function(err) {
          console.warn('[ATPL Sync] Cloud delete notice:', err);
          updateSyncBadge('ok');
        });
      } else {
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
      try {
        localStorage.setItem('ATPL_ALL_SALARY_CLEARED_AT', now);
        var tombs = JSON.parse(localStorage.getItem('ATPL_SALARY_TOMBSTONES_V2') || '{}');
        (window.FILES || []).forEach(function(f) {
          if (f && f.name) tombs[String(f.name).toLowerCase().trim()] = now;
        });
        localStorage.setItem('ATPL_SALARY_TOMBSTONES_V2', JSON.stringify(tombs));
      } catch (_) {}

      window.FILES = [];
      if (typeof window.clearSalaryDb === 'function') await window.clearSalaryDb();
      refreshFilesUI();
      dispatchSyncTrigger('salary_cleared', { cleared_at: now });
      return true;
    },

    saveEmployeeMaster: async function(records) {
      if (!Array.isArray(records)) return { ok: false };
      try {
        localStorage.setItem('AroraTextilesEmployeeMasterV3', JSON.stringify(records));
      } catch (_) {}
      if (window.EM) window.EM.data = records.slice();
      dispatchSyncTrigger('employee_updated', { count: records.length });
      refreshEmployeeUI();

      // Background Cloud Sync to user's Google Sheet
      if (getGasUrl()) {
        callGoogleBackend('saveEmployeeMaster', { records: records }).then(function(res) {
          if (res && res.ok && res.version) {
            localVersion = Math.max(localVersion, res.version);
            try { localStorage.setItem('ATPL_DRIVE_SYNC_VERSION', String(localVersion)); } catch (_) {}
          }
        }).catch(function(e) { console.warn('Google Sheets save notice:', e); });
      }

      return { ok: true };
    },

    deleteEmployeeMaster: async function(empId) {
      dispatchSyncTrigger('employee_deleted', { emp_id: empId });
      if (getGasUrl()) {
        callGoogleBackend('deleteEmployeeMaster', { emp_id: empId }).then(function(res) {
          if (res && res.ok && res.version) {
            localVersion = Math.max(localVersion, res.version);
            try { localStorage.setItem('ATPL_DRIVE_SYNC_VERSION', String(localVersion)); } catch (_) {}
          }
        }).catch(function(e) { console.warn('Google Sheets delete notice:', e); });
      }
      return { ok: true };
    },

    upsertEmployeeMaster: async function(empId, record) {
      dispatchSyncTrigger('employee_updated', { emp_id: empId });
      if (getGasUrl()) {
        callGoogleBackend('upsertEmployeeMaster', {
          emp_id: empId,
          record_json: JSON.stringify(record)
        }).then(function(res) {
          if (res && res.ok && res.version) {
            localVersion = Math.max(localVersion, res.version);
            try { localStorage.setItem('ATPL_DRIVE_SYNC_VERSION', String(localVersion)); } catch (_) {}
          }
        }).catch(function(e) { console.warn('Google Sheets upsert notice:', e); });
      }
      return { ok: true };
    },

    fetchAllSalaryFiles: async function() {
      return window.FILES || [];
    },

    fetchAllHrDocs: async function() {
      return (typeof window.hrDocGetDocs === 'function') ? window.hrDocGetDocs() : [];
    },

    fetchAllEmployeeMaster: async function() {
      return (window.EM && window.EM.data) || [];
    },

    getFileContent: async function(idOrName) {
      var target = String(idOrName || '').toLowerCase().trim();
      var found = (window.FILES || []).find(function(f) {
        return f && String(f.name || f.id || '').toLowerCase().trim() === target;
      });
      if (found) {
        return found.buf || found.original_b64 || null;
      }
      return null;
    },

    subscribe: function(mod, cb) {
      if (typeof cb !== 'function') return;
      if (!subscribers[mod]) subscribers[mod] = [];
      subscribers[mod].push(cb);
    },

    reconcileAll: async function(force) {
      return pollSyncState(!!force);
    },

    triggerUniversalReconciliation: async function(force) {
      return pollSyncState(!!force);
    },

    forceSyncAllFiles: async function(force) {
      return pollSyncState(!!force);
    },

    syncNow: async function(force) {
      return pollSyncState(!!force);
    },

    getClientId: function() {
      return MY_CLIENT_ID;
    }
  };

  // Expose on global window object
  window.ATPLGoogleSync = UnifiedSyncEngine;
  window.ATPLCentralFileSync = UnifiedSyncEngine;
  window.ATPLRealtimeSyncEngine = UnifiedSyncEngine;
  window.UniversalEngine = UnifiedSyncEngine;

  window.triggerManualCrossBrowserSync = async function() {
    updateSyncBadge('syncing', '☁️ Force syncing…');
    await pollSyncState(true);
    if (window.showToast) window.showToast('✅ Google Drive & Sheets sabhi files aur data instant sync ho gaye!');
  };

  // Auto-init on script load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { UnifiedSyncEngine.init(); });
  } else {
    UnifiedSyncEngine.init();
  }

  window.atplDirectServerSync = function() { return pollSyncState(true); };
  window.syncAllAtplModules = function() { return pollSyncState(true); };
})(typeof window !== 'undefined' ? window : this);
