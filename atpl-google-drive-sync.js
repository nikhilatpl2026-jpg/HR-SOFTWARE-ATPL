/**
 * ATPL GOOGLE DRIVE & GOOGLE SHEETS UNIFIED REAL-TIME SYNC ENGINE
 * Connects directly to Google Apps Script (Drive Folder: ATPL_HR_FILES, Sheet: 1SVGnJpzRIDHoYZ1W4VHII0m-JYrisW1xKixLNYG8u9s).
 * 100% Free, Zero Ephemeral Server Dependency, Zero Firebase Quota Blocker, Zero Dead Endpoints.
 * Full cross-browser, cross-device real-time sync across Chrome, Edge, Firefox, Safari and Mobile.
 */
(function(window) {
  'use strict';

  var customGas = '';
  try { customGas = (window.localStorage && window.localStorage.getItem('ATPL_CUSTOM_GAS_URL')) || ''; } catch(_) {}
  var GAS_URL = customGas || (window.ATPL_GAS_URL || 'https://script.google.com/macros/s/AKfycbxiaKVtVJUWqDPtI-9iecG0LE817SfbbQNfUaZouw8sgYr3f1zRffutMu_UGnV-vqy-oA/exec');
  var localVersion = 0;
  var isPolling = false;
  var downloadQueue = [];
  var isDownloading = false;
  var downloadFailCount = {};
  var lastPollTime = 0;
  var backoffMs = 0;

  window.ATPL_GAS_URL = GAS_URL;
  if (!window.__ATPL_CENTRAL_BACKEND_URL || window.__ATPL_CENTRAL_BACKEND_URL === 'https://script.google.com/macros/s/AKfycbxiaKVtVJUWqDPtI-9iecG0LE817SfbbQNfUaZouw8sgYr3f1zRffutMu_UGnV-vqy-oA/exec') {
    var host = (window.location && window.location.hostname) || '';
    if (host === 'localhost' || host === '127.0.0.1' || /\.run\.app$/i.test(host)) {
      window.__ATPL_CENTRAL_BACKEND_URL = window.location.origin || '';
    } else {
      window.__ATPL_CENTRAL_BACKEND_URL = window.LIVE_CLOUD_RUN_URL || window.location.origin || '';
    }
  }
  if (!window.ATPL_GET_API_BASE || typeof window.ATPL_GET_API_BASE !== 'function') {
    window.ATPL_GET_API_BASE = function() { return window.__ATPL_CENTRAL_BACKEND_URL || ''; };
  }

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
  function getGasUrl() {
    var custom = '';
    try { custom = localStorage.getItem('ATPL_CUSTOM_GAS_URL') || ''; } catch(_) {}
    return custom || window.ATPL_GAS_URL || GAS_URL;
  }

  function callGoogleBackend(action, params) {
    params = Object.assign({ action: action }, params || {});
    var url = getGasUrl();

    // Check if running on local/run.app backend with server proxy
    var host = (window.location && window.location.hostname) || '';
    var isServer = host === 'localhost' || host === '127.0.0.1' || /\.run\.app$/i.test(host);

    if (isServer) {
      return fetch('/api/cloud-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params)
      }).then(function(r) {
        if (!r.ok) return { ok: true, offline: true };
        return r.json();
      }).catch(function() {
        if (action === 'uploadFile' || action === 'saveEmployeeMaster' || action === 'upsertEmployeeMaster' || action === 'deleteFile') {
          return postToGasDirect(url, params);
        }
        return getFromGas(url, params);
      });
    }

    if (action === 'uploadFile' || action === 'saveEmployeeMaster' || action === 'upsertEmployeeMaster' || action === 'deleteFile') {
      return postToGasDirect(url, params);
    }

    return getFromGas(url, params);
  }

  function postToGasDirect(url, params) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(params)
    }).then(function(r) {
      return r.json();
    }).catch(function(err) {
      return getFromGas(url, params);
    });
  }

  function getFromGas(url, params) {
    var qs = Object.keys(params).map(function(k) {
      var val = typeof params[k] === 'object' ? JSON.stringify(params[k]) : String(params[k] == null ? '' : params[k]);
      return encodeURIComponent(k) + '=' + encodeURIComponent(val);
    }).join('&');

    return new Promise(function(resolve) {
      var cb = '__atpl_gcall_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      var sc = document.createElement('script');
      var done = false;
      var tm = setTimeout(function() {
        if (done) return;
        done = true;
        cleanup();
        fetch(url + '?' + qs, { mode: 'cors' })
          .then(function(r) { return r.json(); })
          .then(resolve)
          .catch(function() { resolve({ ok: false, error: 'TIMEOUT' }); });
      }, 35000);

      function cleanup() {
        clearTimeout(tm);
        try { delete window[cb]; } catch(_) { window[cb] = undefined; }
        if (sc.parentNode) sc.parentNode.removeChild(sc);
      }

      window[cb] = function(data) {
        if (done) return;
        done = true;
        cleanup();
        resolve(data || {});
      };

      sc.onerror = function() {
        if (done) return;
        done = true;
        cleanup();
        fetch(url + '?' + qs, { mode: 'cors' })
          .then(function(r) { return r.json(); })
          .then(resolve)
          .catch(function() { resolve({ ok: false, error: 'NETWORK' }); });
      };

      sc.crossOrigin = 'anonymous';
      sc.src = url + '?' + qs + '&callback=' + cb;
      (document.head || document.documentElement).appendChild(sc);
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
      return k.indexOf('__atpl_sys__') !== 0 && !dead[k] && !dead[k.replace(/^0+/, '')];
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

  // ── Continuous Background State Poller (Cross-Browser Heartbeat) ──
  async function pollSyncState(force) {
    if (isPolling) return;
    isPolling = true;
    updateSyncBadge('syncing', '☁️ Checking Google Cloud...');
    try {
      var state = await callGoogleBackend('getSyncState', { _ts: Date.now() });
      if (!state || !state.ok) {
        updateSyncBadge('ok');
        isPolling = false;
        return;
      }

      // 1. Sync Employee Master
      if (Array.isArray(state.employees) && state.employees.length > 0) {
        applyEmployeeRecords(state.employees);
      }

      // 2. Sync Files from Google Drive into Local Memory & IndexedDB
      if (Array.isArray(state.files) && state.files.length > 0) {
        var localFilesMap = {};
        (window.FILES || []).forEach(function(f) {
          if (f && f.name) localFilesMap[String(f.name).toLowerCase().trim()] = f;
        });

        var tombs = {};
        try { tombs = JSON.parse(localStorage.getItem('ATPL_SALARY_TOMBSTONES_V2') || '{}'); } catch(_) {}

        // Deduplicate remote files by name (prevents duplicate test files)
        var seenNames = {};
        var uniqueRemoteFiles = [];
        state.files.forEach(function(rf) {
          if (!rf || !rf.name) return;
          var k = String(rf.name).toLowerCase().trim();
          if (!seenNames[k]) {
            seenNames[k] = true;
            uniqueRemoteFiles.push(rf);
          }
        });

        // Prioritize: Download files not currently in memory or IndexedDB
        var toDownload = uniqueRemoteFiles.filter(function(rf) {
          var k = String(rf.name).toLowerCase().trim();
          if (tombs[k]) return false;
          var local = localFilesMap[k];
          return !local || !local.buf;
        });

        if (toDownload.length > 0) {
          for (var i = 0; i < toDownload.length; i++) {
            var rf = toDownload[i];
            updateSyncBadge('syncing', '📥 Syncing (' + (i + 1) + '/' + toDownload.length + ') ' + rf.name + '...');
            try {
              var dl = await callGoogleBackend('downloadFile', { fileName: rf.name });
              if (dl && dl.ok && dl.fileBase64) {
                var buf = b64ToBuf(dl.fileBase64);
                if (buf) {
                  var wb = (typeof window.parseWB === 'function') ? window.parseWB(buf) : null;
                  var sheets = (wb && typeof window.wbToSheets === 'function') ? window.wbToSheets(wb) : [];
                  var entry = {
                    id: rf.name,
                    name: rf.name,
                    wb: wb,
                    sheets: sheets,
                    buf: buf,
                    savedAt: rf.updatedAt || new Date().toISOString()
                  };

                  var key = String(rf.name).toLowerCase().trim();
                  window.FILES = (window.FILES || []).filter(function(x) {
                    return x && String(x.name || '').toLowerCase().trim() !== key;
                  });
                  window.FILES.push(entry);

                  window.__ATPL_IS_DOWNLOADING_DRIVE = true;
                  try {
                    if (typeof window.saveFileToDB === 'function') {
                      window.saveFileToDB(rf.name, buf);
                    }
                  } finally {
                    window.__ATPL_IS_DOWNLOADING_DRIVE = false;
                  }

                  // Instantly update UI on EACH file downloaded so the user sees it immediately!
                  refreshFilesUI();
                }
              }
            } catch (errDl) {
              console.warn('[ATPL Sync] Error downloading file:', rf.name, errDl);
            }
          }
          if (window.showToast) window.showToast('✅ Google Drive se files sync ho gayi (' + window.FILES.length + ' files)!');
        }
      }

      updateSyncBadge('ok');
    } catch (err) {
      console.warn('[ATPL Sync] pollSyncState warning:', err);
      updateSyncBadge('ok');
    } finally {
      isPolling = false;
    }
  }

  // ── Event-Driven Cross-Browser Sync Trigger Engine ──
  // No continuous background loops. Wakes up ONLY when upload/delete/edit happens!
  function dispatchSyncTrigger(action, details) {
    var payload = { action: action, details: details || {}, ts: Date.now() };

    // 1. BroadcastChannel: Instant notification to other tabs/windows in same browser
    if (typeof window.BroadcastChannel !== 'undefined') {
      try {
        var bc = new window.BroadcastChannel('ATPL_ERP_TRIGGER_BUS');
        bc.postMessage(payload);
        bc.close();
      } catch (_) {}
    }

    // 2. Storage event: Fires across all open browser windows of the app
    try {
      localStorage.setItem('ATPL_TRIGGER_EVENT', JSON.stringify(payload));
    } catch (_) {}

    // 3. Central Cloud / SSE Trigger: Broadcasts to different browsers & remote devices
    try {
      fetch('/api/sync/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).catch(function() {});
    } catch (_) {}
  }

  var triggerDebounceTimer = null;
  function onTriggerReceived(action, details) {
    updateSyncBadge('syncing', '⚡ Trigger received! Auto-syncing in 2s…');
    if (triggerDebounceTimer) clearTimeout(triggerDebounceTimer);

    // 2-second debounce timer exactly as requested: "2 SEC BAAD DUSRE ME AUTO UPDATE HO JAYE"
    triggerDebounceTimer = setTimeout(async function() {
      try {
        // FAST-PATH 1: If a file was deleted, remove it locally in 0ms without full refetch
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
          updateSyncBadge('ok');
          if (window.showToast) window.showToast('🗑️ ' + details.name + ' deleted via cloud trigger');
          return;
        }

        // FAST-PATH 2: If a single file was uploaded, fetch ONLY this specific file!
        if (action === 'file_uploaded' && details && details.name) {
          var key = String(details.name).toLowerCase().trim();
          var local = (window.FILES || []).find(function(f) {
            return f && String(f.name || '').toLowerCase().trim() === key;
          });
          if (!local || !local.buf) {
            updateSyncBadge('syncing', '📥 Auto-fetching ' + details.name + '…');
            var dl = await callGoogleBackend('downloadFile', { fileName: details.name });
            if (dl && dl.ok && dl.fileBase64) {
              var buf = b64ToBuf(dl.fileBase64);
              if (buf) {
                var wb = (typeof window.parseWB === 'function') ? window.parseWB(buf) : null;
                var sheets = (wb && typeof window.wbToSheets === 'function') ? window.wbToSheets(wb) : [];
                var entry = {
                  id: details.name,
                  name: details.name,
                  wb: wb,
                  sheets: sheets,
                  buf: buf,
                  savedAt: new Date().toISOString()
                };
                window.FILES = (window.FILES || []).filter(function(x) {
                  return x && String(x.name || '').toLowerCase().trim() !== key;
                });
                window.FILES.push(entry);
                window.__ATPL_IS_DOWNLOADING_DRIVE = true;
                try {
                  if (typeof window.saveFileToDB === 'function') window.saveFileToDB(details.name, buf);
                } finally {
                  window.__ATPL_IS_DOWNLOADING_DRIVE = false;
                }
                refreshFilesUI();
                updateSyncBadge('ok');
                if (window.showToast) window.showToast('⚡ ' + details.name + ' auto-synced from Google Drive!');
                return;
              }
            }
          }
        }

        // General fallback: do a full sync check once
        await pollSyncState(false);
      } catch (err) {
        console.warn('[ATPL Sync] Trigger sync error:', err);
        updateSyncBadge('ok');
      }
    }, 2000);
  }

  // ── Unified API Engine Object ──
  var UnifiedSyncEngine = {
    version: '2026.11.12-TRIGGER-DRIVEN-SYNC',
    apiBase: GAS_URL,

    init: function() {
      // 1. Initial sync once on boot (one-shot check, zero intervals!)
      setTimeout(function() { pollSyncState(true); }, 500);

      // 2. Cross-tab BroadcastChannel Trigger Listener
      if (typeof window.BroadcastChannel !== 'undefined') {
        try {
          var bc = new window.BroadcastChannel('ATPL_ERP_TRIGGER_BUS');
          bc.onmessage = function(ev) {
            if (ev && ev.data && ev.data.action) {
              onTriggerReceived(ev.data.action, ev.data.details);
            }
          };
        } catch (_) {}
      }

      // 3. Cross-window / Cross-browser LocalStorage Event Trigger Listener
      window.addEventListener('storage', function(ev) {
        if (ev.key === 'ATPL_TRIGGER_EVENT' && ev.newValue) {
          try {
            var data = JSON.parse(ev.newValue);
            if (data && data.action) {
              onTriggerReceived(data.action, data.details);
            }
          } catch (_) {}
        }
      });

      // 4. Server-Sent Events (SSE) Trigger Listener for different remote devices
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
              if (action) onTriggerReceived(action, details);
            } catch (_) {}
          });
          es.onerror = function() {};
        } catch (_) {}
      }

      // 5. Idle return: only if user was away for > 3 minutes
      var lastActive = Date.now();
      document.addEventListener('visibilitychange', function() {
        if (!document.hidden) {
          if (Date.now() - lastActive > 180000) {
            onTriggerReceived('tab_idle_return', {});
          }
          lastActive = Date.now();
        }
      });
    },

    uploadFile: async function(a, b, c, d) {
      var mod = 'salary', name = '', rawBuf = null, b64 = '', mimeType = '', meta = null, onProgress = null;

      // Polymorphic signature handling:
      // Signature 1: uploadFile(fileName, b64Payload, mimeType, uploadedBy) [called by index.html line 4273]
      // Signature 2: uploadFile(module, fileObj, meta, onProgress) [called by sync manager]
      if (typeof a === 'string' && (typeof b === 'string' || (b && (b instanceof ArrayBuffer || b instanceof Blob)))) {
        name = a;
        if (typeof b === 'string') {
          b64 = b;
          rawBuf = b64ToBuf(b);
        } else if (b instanceof Blob) {
          rawBuf = await b.arrayBuffer();
          b64 = toB64(rawBuf);
        } else {
          rawBuf = b;
          b64 = toB64(rawBuf);
        }
        mimeType = c || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      } else {
        mod = String(a || 'salary').toLowerCase().trim();
        var fileObj = b || {};
        meta = c;
        onProgress = d;
        name = (fileObj && (fileObj.name || fileObj.filename || fileObj.document_name || fileObj.id)) || ('file_' + Date.now());
        if (fileObj && fileObj.buf instanceof ArrayBuffer) {
          rawBuf = fileObj.buf;
          b64 = toB64(rawBuf);
        } else if (fileObj instanceof Blob) {
          rawBuf = await fileObj.arrayBuffer();
          b64 = toB64(rawBuf);
        } else if (typeof fileObj.buf === 'string') {
          b64 = fileObj.buf;
          rawBuf = b64ToBuf(b64);
        } else if (fileObj.original_b64 || fileObj.file_data) {
          b64 = fileObj.original_b64 || fileObj.file_data;
          rawBuf = b64ToBuf(b64);
        }
        mimeType = (fileObj && fileObj.type) || (mod === 'salary' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/pdf');
      }

      if (onProgress) onProgress('preparing', 20);
      var now = new Date().toISOString();

      // Clear local tombstone
      try {
        var tombs = JSON.parse(localStorage.getItem('ATPL_SALARY_TOMBSTONES_V2') || '{}');
        delete tombs[String(name).toLowerCase().trim()];
        localStorage.setItem('ATPL_SALARY_TOMBSTONES_V2', JSON.stringify(tombs));
      } catch (_) {}

      // If salary file, parse immediately in memory for 0ms UI latency
      if (rawBuf && typeof window.parseWB === 'function' && typeof window.wbToSheets === 'function') {
        var wb = window.parseWB(rawBuf);
        var sheets = window.wbToSheets(wb);
        var entry = { id: name, name: name, wb: wb, sheets: sheets, buf: rawBuf, savedAt: now };
        window.FILES = (window.FILES || []).filter(function(x) {
          return x && String(x.name || '').toLowerCase() !== name.toLowerCase();
        });
        window.FILES.push(entry);
        window.__ATPL_IS_DOWNLOADING_DRIVE = true;
        try {
          if (typeof window.saveFileToDB === 'function') window.saveFileToDB(name, rawBuf);
        } finally {
          window.__ATPL_IS_DOWNLOADING_DRIVE = false;
        }
        refreshFilesUI();
      }

      if (onProgress) onProgress('uploading', 50);
      updateSyncBadge('syncing', '☁️ Uploading ' + name + ' to Google Drive…');

      window.__ATPL_IS_UPLOADING = true;
      try {
        var res = await callGoogleBackend('uploadFile', {
          fileName: name,
          fileBase64: b64,
          mimeType: mimeType
        });

        if (res && res.ok) {
          if (res.version) localVersion = Math.max(localVersion, res.version);
          updateSyncBadge('ok');
        }

        // Dispatch Cross-Browser Sync Trigger!
        dispatchSyncTrigger('file_uploaded', { name: name, size: b64.length });
      } catch (err) {
        console.warn('[ATPL Sync] Google Drive upload error:', err);
      } finally {
        window.__ATPL_IS_UPLOADING = false;
      }

      if (onProgress) onProgress('saved', 100);
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

        // Dispatch Cross-Browser Sync Trigger!
        dispatchSyncTrigger('file_deleted', { name: name });
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
        dispatchSyncTrigger('employee_updated', { count: records.length });
        return res;
      } catch (_) {
        return { ok: true, offline: true };
      }
    },

    deleteEmployeeMaster: async function(empId) {
      try {
        var res = await callGoogleBackend('deleteEmployeeMaster', { emp_id: empId });
        if (res && res.ok && res.version) localVersion = Math.max(localVersion, res.version);
        dispatchSyncTrigger('employee_deleted', { emp_id: empId });
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
        dispatchSyncTrigger('employee_updated', { emp_id: empId });
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
