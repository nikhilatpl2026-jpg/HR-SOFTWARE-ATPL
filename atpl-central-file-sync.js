/**
 * ATPL Central File Sync System (v2026.10.17-STRICT-CROSS-DEVICE-AUTHORITY)
 * ─────────────────────────────────────────────────────────────────────────
 * Centralized, backend-authoritative, real-time file synchronization.
 *
 * GUARANTEES:
 *  1. STRICT AUTO-DELETE: Deleting a file on Browser A immediately purges it
 *     from Firebase Firestore, GitHub Cloud Repository, and all Browser B
 *     devices (Memory + IndexedDB + UI).
 *  2. PROGRESSIVE UI: Files appear on screen as they download.
 *  3. ZERO GHOST RESURRECTION: Browser B never re-uploads deleted local files.
 * ─────────────────────────────────────────────────────────────────────────
 */
(function(window) {
  'use strict';

  function detectBackendUrl() {
    if (typeof window === 'undefined' || !window.location) return 'https://ais-pre-2vnnysb742azuzgorygr6z-909075195436.asia-east1.run.app';
    var host = window.location.hostname || '';
    if (host === 'localhost' || host === '127.0.0.1' || /\.run\.app$/i.test(host)) {
      return window.location.origin || '';
    }
    return (window.LIVE_CLOUD_RUN_URL || window.__ATPL_CENTRAL_BACKEND_URL || 'https://ais-pre-2vnnysb742azuzgorygr6z-909075195436.asia-east1.run.app');
  }

  var API_BASE = detectBackendUrl();

  async function computeSha256(data) {
    try {
      var buffer;
      if (typeof data === 'string') {
        if (data.indexOf('base64,') >= 0) {
          data = data.split('base64,')[1];
        }
        var binary = atob(data.replace(/\s+/g, ''));
        var bytes = new Uint8Array(binary.length);
        for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        buffer = bytes.buffer;
      } else if (data instanceof ArrayBuffer) {
        buffer = data;
      } else if (data instanceof Uint8Array) {
        buffer = data.buffer;
      } else if (data instanceof Blob) {
        buffer = await data.arrayBuffer();
      } else {
        buffer = new TextEncoder().encode(JSON.stringify(data)).buffer;
      }
      var digest = await crypto.subtle.digest('SHA-256', buffer);
      var hashArray = Array.from(new Uint8Array(digest));
      return hashArray.map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
    } catch (e) {
      var str = typeof data === 'string' ? data : (data.name || '') + (data.size || '') + (data.lastModified || '');
      var hash = 0;
      for (var j = 0; j < str.length; j++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(j);
        hash |= 0;
      }
      return 'fb_' + Math.abs(hash).toString(16);
    }
  }

  function arrayBufferToBase64(buffer) {
    if (!buffer) return '';
    if (typeof buffer === 'string') {
      return buffer.indexOf(',') >= 0 ? buffer.split(',')[1] : buffer;
    }
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

  class ConcurrencyQueue {
    constructor(concurrency = 1) {
      this.concurrency = concurrency;
      this.running = 0;
      this.queue = [];
    }

    add(fn) {
      return new Promise((resolve, reject) => {
        this.queue.push({ fn, resolve, reject });
        this.processNext();
      });
    }

    processNext() {
      if (this.running >= this.concurrency || this.queue.length === 0) return;
      this.running++;
      var item = this.queue.shift();
      item.fn()
        .then(result => {
          this.running--;
          item.resolve(result);
          this.processNext();
        })
        .catch(err => {
          this.running--;
          item.reject(err);
          this.processNext();
        });
    }
  }

  var ATPLCentralFileSync = {
    version: '2026.10.17-STRICT-CROSS-DEVICE-AUTHORITY',
    apiBase: API_BASE,
    connected: false,
    serverStateVersion: 0,
    eventSource: null,
    subscribers: {},
    uploadQueue: new ConcurrencyQueue(1),
    fileMap: new Map(),
    reconnectTimer: null,
    reconcileTimer: null,
    reconnectAttempts: 0,
    lastSyncTime: 0,
    isReconciling: false,
    pendingReconcile: false,

    init: function() {
      if (Array.isArray(window.FILES)) {
        window.FILES.forEach(f => {
          if (f && f.name) {
            var fk = String(f.name).toLowerCase().trim();
            this.fileMap.set(fk, f);
          }
        });
      }

      this.connectSSE();
      this.connectFirebase();
      this.bindWindowEvents();
      setTimeout(() => { this.reconcileAll(true); }, 300);
      this.fetchEmployeeMasterOnStartup();

      setInterval(() => {
        if (typeof document !== 'undefined' && !document.hidden && !window.__ATPL_IS_UPLOADING) {
          this.requestReconcile();
        }
      }, 6000);
    },

    syncToWindowFiles: function(forceRefresh = false) {
      if (Array.isArray(window.FILES)) {
        window.FILES.forEach(f => {
          if (f && f.name && f.wb) {
            var fk = String(f.name).toLowerCase().trim();
            var allowed = typeof window.atplSalaryRestoreAllowed === 'function'
              ? window.atplSalaryRestoreAllowed(f.name, f.savedAt || f.saved)
              : true;
            if (allowed && !this.fileMap.has(fk)) {
              this.fileMap.set(fk, f);
            }
          }
        });
      }
      var arr = Array.from(this.fileMap.values());
      arr.sort((a, b) => {
        var da = new Date(a.savedAt || 0).getTime();
        var db = new Date(b.savedAt || 0).getTime();
        return db - da;
      });
      var prev = window.FILES || [];
      var isChanged = forceRefresh || prev.length !== arr.length || prev.some((p, i) => !arr[i] || p.name !== arr[i].name || p.savedAt !== arr[i].savedAt);
      window.FILES = arr;
      if (typeof FILES !== 'undefined') FILES = arr;
      if (isChanged) {
        this.triggerImmediateUIRefresh();
      }
      this.updateSyncBadge('ok', '⚡ Realtime (' + arr.length + ' files)');
    },

    triggerImmediateUIRefresh: function() {
      try {
        var event = new CustomEvent('atplVaultUpdated', { detail: { files: window.FILES || [] } });
        window.dispatchEvent(event);
      } catch(e) {}

      if (typeof renderFiles === 'function') renderFiles();
      if (typeof renderSheets === 'function') renderSheets();
      if (typeof updStats === 'function') updStats();
      if (typeof renderAllFilesPage === 'function') renderAllFilesPage();
      if (typeof populateNJSelects === 'function') populateNJSelects();
      if (typeof window.initStatutoryChallanTab === 'function') {
        try { window.initStatutoryChallanTab(); } catch(_) {}
      }
      if (typeof window.empDashboardRender === 'function') {
        try { window.empDashboardRender(); } catch(_) {}
      }
      if (typeof window.hrDocRender === 'function') {
        try { window.hrDocRender(); } catch(_) {}
      }
      if (window.ATPLGenZDashboard && typeof window.ATPLGenZDashboard.refresh === 'function') {
        window.ATPLGenZDashboard.refresh();
      }
    },

    fetchEmployeeMasterOnStartup: function() {
      if (window.ATPLCloudSyncV1) { return window.ATPLCloudSyncV1.pullMaster(); }
      if (!this.apiBase) return;
      fetch(this.apiBase + "/api/sync/employee-master?_t=" + Date.now(), { cache: "no-store" })
        .then(r => r.json())
        .then(data => {
          if (data && data.ok && Array.isArray(data.records) && data.records.length > 0 && window.EM) {
            window.EM.data = data.records.slice();
            if (Array.isArray(window.EMP_MASTER_DATA)) {
              window.EMP_MASTER_DATA.length = 0;
              Array.prototype.push.apply(window.EMP_MASTER_DATA, data.records);
            }
            try { localStorage.setItem("AroraTextilesEmployeeMasterV3", JSON.stringify(data.records)); } catch(_) {}
            if (typeof window.emFilter === "function") window.emFilter();
            if (typeof window.emUpdateStats === "function") window.emUpdateStats();
            if (typeof window.initStatutoryChallanTab === "function") {
              try { window.initStatutoryChallanTab(); } catch(_) {}
            }
          }
        })
        .catch(() => {});
    },

    bindWindowEvents: function() {
      window.addEventListener('online', () => {
        this.connectSSE();
        this.requestReconcile();
      });

      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
          this.requestReconcile();
        }
      });
    },

    connectSSE: function() {
      if (!this.apiBase) return;
      if (typeof window !== "undefined" && window.location && window.location.port === "4173") return;
      if (this.eventSource) {
        try { this.eventSource.close(); } catch (_) {}
        this.eventSource = null;
      }
      var sseUrl = this.apiBase + '/api/sync/events';
      try {
        var es = new EventSource(sseUrl);
        this.eventSource = es;

        es.onopen = () => {
          this.connected = true;
          this.reconnectAttempts = 0;
          this.updateSyncBadge('ok', '⚡ Realtime Live');
        };

        es.onerror = () => {
          this.connected = false;
          try { es.close(); } catch (_) {}
          this.eventSource = null;
          var delay = Math.min(10000, 1000 * Math.pow(1.5, this.reconnectAttempts++));
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = setTimeout(() => {
            this.connectSSE();
            this.requestReconcile();
          }, delay);
        };

        es.addEventListener('file_saved', () => { this.requestReconcile(); });
        es.addEventListener('file_deleted', (e) => { this.handleRemoteFileDeleted(e.data); });
        es.addEventListener('files_bulk_saved', () => { this.requestReconcile(); });
        es.addEventListener('module_cleared', () => { this.clearModule('salary', true); });
        es.addEventListener('salary_file_saved', () => { this.requestReconcile(); });
        es.addEventListener('salary_file_deleted', (e) => { this.handleRemoteFileDeleted(e.data); });
        es.addEventListener('salary_clear_all', () => { this.clearModule('salary', true); });
        es.addEventListener('hr_doc_deleted', (e) => {
          try {
            var msg = JSON.parse(e.data || '{}');
            var id = msg.id || (msg.data && msg.data.id);
            if (id && window.ATPLRealtimeSyncEngine && typeof window.ATPLRealtimeSyncEngine.purgeLocalHrDoc === 'function') {
              window.ATPLRealtimeSyncEngine.purgeLocalHrDoc(id, id);
            }
          } catch(_) {}
        });
      } catch (err) {}
    },

    connectFirebase: function() {
      if (typeof window === 'undefined') return;
      var setupListeners = () => {
        var fb = window.ATPLNativeFirebase || window.ATPLFirebase;
        if (!fb) return;
        if (typeof fb.subscribeSalaryFiles === 'function') {
          try {
            fb.subscribeSalaryFiles((update) => {
              if (!update) return;
              if (Array.isArray(update.removedNames) && update.removedNames.length > 0) {
                update.removedNames.forEach((delName) => {
                  this.deleteFile('salary', delName, true);
                });
              }
              this.requestReconcile();
            });
          } catch (_) {}
        }
        if (typeof fb.subscribeTombstones === 'function') {
          try {
            fb.subscribeTombstones((tombs) => {
              if (!Array.isArray(tombs)) return;
              tombs.forEach((t) => {
                if (!t || !t.name) return;
                if (t.name === '__ALL__') {
                  this.clearModule('salary', true);
                } else {
                  this.deleteFile('salary', t.name, true);
                }
              });
            });
          } catch (_) {}
        }
      };

      if (window.ATPLNativeFirebase || window.ATPLFirebase) {
        setupListeners();
      } else {
        setTimeout(setupListeners, 600);
        setTimeout(setupListeners, 2000);
      }
    },

    requestReconcile: function() {
      if (this.reconcileTimer) {
        clearTimeout(this.reconcileTimer);
      }
      this.reconcileTimer = setTimeout(() => {
        this.reconcileAll(true);
      }, 350);
    },

    handleRemoteFileDeleted: function(raw) {
      try {
        var msg = typeof raw === 'string' ? JSON.parse(raw) : raw;
        var info = (msg && msg.data) || msg || {};
        var targetName = String(info.name || info.filename || '').toLowerCase().trim();
        var targetId = String(info.id || '').toLowerCase().trim();
        if (!targetName && !targetId) return;

        if (typeof window.atplClearSessionUpload === 'function') {
          window.atplClearSessionUpload('salary', targetName || targetId);
        }

        var tombs = JSON.parse(localStorage.getItem('ATPL_SALARY_TOMBSTONES_V2') || '{}');
        var delIso = info.deleted_at || new Date().toISOString();
        if (targetName) tombs[targetName] = delIso;
        if (targetId) tombs[targetId] = delIso;
        localStorage.setItem('ATPL_SALARY_TOMBSTONES_V2', JSON.stringify(tombs));

        if (targetName) this.fileMap.delete(targetName);
        if (targetId) this.fileMap.delete(targetId);
        for (var [k, v] of Array.from(this.fileMap.entries())) {
          var vn = String((v && v.name) || '').toLowerCase().trim();
          var vi = String((v && v.id) || '').toLowerCase().trim();
          if (vn === targetName || vi === targetId || vi === targetName || vn === targetId || String(k).toLowerCase().trim() === targetName) {
            this.fileMap.delete(k);
          }
        }

        if (Array.isArray(window.FILES)) {
          window.FILES = window.FILES.filter(function(x) {
            if (!x) return false;
            var xn = String(x.name || '').toLowerCase().trim();
            var xi = String(x.id || '').toLowerCase().trim();
            return xn !== targetName && xi !== targetId && xn !== targetId && xi !== targetName;
          });
          if (typeof FILES !== 'undefined') FILES = window.FILES;
        }

        if (window.DB) {
          try {
            var dtx = window.DB.transaction(window.DB_STORE || 'salaryFiles', 'readwrite');
            if (info.name) dtx.objectStore(window.DB_STORE || 'salaryFiles').delete(info.name);
            if (info.id) dtx.objectStore(window.DB_STORE || 'salaryFiles').delete(info.id);
          } catch (_) {}
        }
        try {
          var req = indexedDB.open('AroraTextiles', 1);
          req.onsuccess = function(e) {
            var db = e.target.result;
            if (db.objectStoreNames.contains('salaryFiles')) {
              var store = db.transaction('salaryFiles', 'readwrite').objectStore('salaryFiles');
              if (info.name) { try { store.delete(info.name); } catch (_) {} }
              var curReq = store.openCursor();
              curReq.onsuccess = function(ev) {
                var cursor = ev.target.result;
                if (cursor) {
                  var val = cursor.value;
                  var vn = String((val && val.name) || '').toLowerCase().trim();
                  if (vn === targetName || vn === targetId) cursor.delete();
                  cursor.continue();
                }
              };
            }
          };
        } catch (_) {}

        this.syncToWindowFiles(true);
        window.dispatchEvent(new CustomEvent('atpl_files_updated'));
      } catch (e) {}
    },

    uploadFile: async function(module, fileObj, meta = {}, onProgress = null) {
      return this.uploadQueue.add(async () => {
        if (onProgress) onProgress('preparing', 10);
        var name = fileObj.name;
        var lName = String(name).toLowerCase().trim();
        var mime = fileObj.type || fileObj.mime_type || 'application/octet-stream';
        var size = fileObj.size || 0;
        var bufBase64 = '';
        var rawBuf = null;

        if (typeof window.atplMarkSessionUpload === 'function') {
          window.atplMarkSessionUpload(module || 'salary', lName);
        }

        if (typeof fileObj.buf === 'string') {
          bufBase64 = fileObj.buf;
          rawBuf = base64ToArrayBuffer(fileObj.buf);
        } else if (fileObj.buf instanceof ArrayBuffer) {
          rawBuf = fileObj.buf;
          bufBase64 = arrayBufferToBase64(fileObj.buf);
          size = fileObj.buf.byteLength;
        } else if (fileObj instanceof File || fileObj instanceof Blob) {
          var arrayBuf = await fileObj.arrayBuffer();
          rawBuf = arrayBuf;
          bufBase64 = arrayBufferToBase64(arrayBuf);
          size = arrayBuf.byteLength;
        } else if (fileObj.buffer instanceof ArrayBuffer) {
          rawBuf = fileObj.buffer;
          bufBase64 = arrayBufferToBase64(fileObj.buffer);
          size = fileObj.buffer.byteLength;
        }

        if (onProgress) onProgress('hashing', 30);
        var sha256 = await computeSha256(bufBase64);

        var payload = {
          id: fileObj.id || meta.id || ('file_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9)),
          module: module,
          category: meta.category || fileObj.category || 'general',
          name: name,
          mime_type: mime,
          size: size,
          sha256_hash: sha256,
          period: meta.period || fileObj.period || '',
          periodSource: meta.periodSource || fileObj.periodSource || '',
          meta: meta,
          buf: bufBase64,
          uploaded_by: meta.uploaded_by || 'admin',
          created_at: fileObj.created_at || new Date().toISOString()
        };

        if (onProgress) onProgress('uploading', 60);

        var result = { ok: true, file: payload };
        if (this.apiBase) {
          try {
            var res = await fetch(this.apiBase + '/api/sync/files', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload)
            });
            if (res.ok) {
              var tempResult = await res.json();
              if (tempResult && tempResult.ok) result = tempResult;
            }
          } catch (_) {}
        }

        // Parse locally and save to IndexedDB + Cloud (Firebase Firestore + GitHub Cloud)
        if (module === 'salary' && rawBuf && window.parseWB && window.wbToSheets) {
          try {
            var wb = window.parseWB(rawBuf);
            var sheets = window.wbToSheets(wb);
            this.fileMap.set(lName, {
              id: payload.id,
              name: name,
              wb: wb,
              sheets: sheets,
              buf: rawBuf,
              savedAt: payload.created_at,
              syncStatus: 'saved'
            });
          } catch (_) {}
        }

        // Clear any local tombstone
        try {
          var ts = JSON.parse(localStorage.getItem('ATPL_SALARY_TOMBSTONES_V2') || '{}');
          if (ts[lName]) {
            delete ts[lName];
            localStorage.setItem('ATPL_SALARY_TOMBSTONES_V2', JSON.stringify(ts));
          }
        } catch (_) {}

        // Save to local IndexedDB
        if (module === 'salary' && rawBuf) {
          try {
            var req = indexedDB.open('AroraTextiles', 1);
            req.onsuccess = function(e) {
              var db = e.target.result;
              if (db.objectStoreNames.contains('salaryFiles')) {
                db.transaction('salaryFiles', 'readwrite').objectStore('salaryFiles').put({
                  name: name,
                  buf: rawBuf,
                  saved: payload.created_at
                });
              }
            };
          } catch (_) {}
        }

        // Save to Authoritative Multi-Cloud (Google Apps Script + Firebase Firestore + GitHub Cloud)
        if (module === 'salary' && rawBuf && window.ATPLCloudSharedStorageV1 && typeof window.ATPLCloudSharedStorageV1.saveSalary === 'function') {
          try {
            window.ATPLCloudSharedStorageV1.saveSalary(name, rawBuf, payload.created_at).catch(function(){});
          } catch (_) {}
        }
        if (module === 'salary' && window.ATPLFirebase && typeof window.ATPLFirebase.saveSalaryFile === 'function') {
          try {
            await window.ATPLFirebase.saveSalaryFile(
              name,
              { original_b64: bufBase64, name: name, id: payload.id },
              { name: name, id: payload.id, saved_at: payload.created_at, uploaded_by: payload.uploaded_by }
            );
          } catch (_) {}
        }
        if (module === 'hr_doc' && window.ATPLCloudSharedStorageV1 && typeof window.ATPLCloudSharedStorageV1.saveHrDoc === 'function') {
          try {
            window.ATPLCloudSharedStorageV1.saveHrDoc(payload).catch(function(){});
          } catch (_) {}
        }

        this.syncToWindowFiles(true);
        if (onProgress) onProgress('saved', 100);
        return result.file || payload;
      });
    },

    uploadBulk: async function(module, fileList, metaGenerator = null, onFileProgress = null) {
      window.__ATPL_IS_UPLOADING = true;
      window.__ATPL_LAST_UPLOAD_TIME = Date.now();
      var files = Array.from(fileList || []);
      if (!files.length) {
        window.__ATPL_IS_UPLOADING = false;
        return { total: 0, saved: 0, failed: 0, results: [] };
      }

      var results = [];
      for (var i = 0; i < files.length; i++) {
        var f = files[i];
        var meta = typeof metaGenerator === 'function' ? await metaGenerator(f, i) : {};
        if (onFileProgress) onFileProgress(i, 'queued', 0, f.name);

        try {
          var saved = await this.uploadFile(module, f, meta, (status, pct) => {
            if (onFileProgress) onFileProgress(i, status, pct, f.name);
          });
          results.push({ ok: true, name: f.name, file: saved });
          if (onFileProgress) onFileProgress(i, 'saved', 100, f.name);
        } catch (err) {
          results.push({ ok: false, name: f.name, error: err.message || err });
          if (onFileProgress) onFileProgress(i, 'failed', 0, f.name, err.message || err);
        }

        if (i < files.length - 1) {
          await new Promise(r => setTimeout(r, 80));
        }
      }

      if (module === 'salary') this.syncToWindowFiles(true);
      window.__ATPL_IS_UPLOADING = false;
      window.__ATPL_LAST_UPLOAD_TIME = Date.now();
      return { total: files.length, saved: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length, results: results };
    },

    deleteFile: async function(module, idOrName, skipRemote = false) {
      if (!idOrName) return false;
      var targetName = String(idOrName).toLowerCase().trim();

      if (typeof window.atplClearSessionUpload === 'function') {
        window.atplClearSessionUpload(module || 'salary', targetName);
      }

      var tombs = JSON.parse(localStorage.getItem('ATPL_SALARY_TOMBSTONES_V2') || '{}');
      tombs[targetName] = new Date().toISOString();
      localStorage.setItem('ATPL_SALARY_TOMBSTONES_V2', JSON.stringify(tombs));

      this.fileMap.delete(targetName);
      for (var [k, v] of Array.from(this.fileMap.entries())) {
        var vn = String((v && v.name) || '').toLowerCase().trim();
        var vi = String((v && v.id) || '').toLowerCase().trim();
        if (vn === targetName || vi === targetName || String(k).toLowerCase().trim() === targetName) {
          this.fileMap.delete(k);
        }
      }

      if (Array.isArray(window.FILES)) {
        window.FILES = window.FILES.filter(function(x) {
          if (!x) return false;
          var xn = String(x.name || '').toLowerCase().trim();
          var xi = String(x.id || '').toLowerCase().trim();
          return xn !== targetName && xi !== targetName;
        });
        if (typeof FILES !== 'undefined') FILES = window.FILES;
      }

      if (window.DB) {
        try {
          var dtx = window.DB.transaction(window.DB_STORE || 'salaryFiles', 'readwrite');
          dtx.objectStore(window.DB_STORE || 'salaryFiles').delete(idOrName);
        } catch (_) {}
      }
      try {
        var req = indexedDB.open('AroraTextiles', 1);
        req.onsuccess = function(e) {
          var db = e.target.result;
          if (db.objectStoreNames.contains('salaryFiles')) {
            var store = db.transaction('salaryFiles', 'readwrite').objectStore('salaryFiles');
            try { store.delete(idOrName); } catch (_) {}
            var curReq = store.openCursor();
            curReq.onsuccess = function(ev) {
              var cursor = ev.target.result;
              if (cursor) {
                var val = cursor.value;
                if (val && String(val.name || '').toLowerCase().trim() === targetName) {
                  cursor.delete();
                }
                cursor.continue();
              }
            };
          }
        };
      } catch (_) {}

      this.syncToWindowFiles(true);

      if (!skipRemote) {
        if (this.apiBase) {
          try {
            await fetch(this.apiBase + '/api/sync/files/' + encodeURIComponent(idOrName) + '?module=' + encodeURIComponent(module), { method: 'DELETE' });
            if (module === 'salary') {
              await fetch(this.apiBase + '/api/sync/salary-file/' + encodeURIComponent(idOrName), { method: 'DELETE' });
            }
          } catch (_) {}
        }

        if (module === 'salary' && window.ATPLCloudSharedStorageV1 && typeof window.ATPLCloudSharedStorageV1.deleteSalary === 'function') {
          try { window.ATPLCloudSharedStorageV1.deleteSalary(idOrName).catch(function(){}); } catch (_) {}
        }
        if (module === 'hr_doc' && window.ATPLCloudSharedStorageV1 && typeof window.ATPLCloudSharedStorageV1.deleteHrDoc === 'function') {
          try { window.ATPLCloudSharedStorageV1.deleteHrDoc(idOrName, idOrName).catch(function(){}); } catch (_) {}
        }
        if (module === 'salary' && window.ATPLFirebase && typeof window.ATPLFirebase.deleteSalaryFile === 'function') {
          try { await window.ATPLFirebase.deleteSalaryFile(idOrName, 'admin'); } catch (_) {}
        } else if (module === 'hr_doc' && window.ATPLFirebase && typeof window.ATPLFirebase.deleteHrDoc === 'function') {
          try { await window.ATPLFirebase.deleteHrDoc(idOrName, idOrName, 'admin'); } catch (_) {}
        } else if ((module === 'pf' || module === 'esic') && window.ATPLFirebase && typeof window.ATPLFirebase.deleteComplianceDoc === 'function') {
          try { await window.ATPLFirebase.deleteComplianceDoc(module, idOrName, idOrName); } catch (_) {}
        }
      }

      return true;
    },

    clearModule: async function(module = 'salary', skipRemote = false) {
      if (module === 'salary') {
        try { localStorage.setItem('ATPL_ALL_SALARY_CLEARED_AT', new Date().toISOString()); } catch (_) {}
        if (window.__ATPL_SESSION_UPLOADS) window.__ATPL_SESSION_UPLOADS.salary = {};
        window.__ATPL_SESSION_UPLOADED_FILES = {};
        this.fileMap.clear();
        window.FILES = [];
        if (typeof FILES !== 'undefined') FILES = [];
        if (window.DB) {
          try {
            var ctx = window.DB.transaction(window.DB_STORE || 'salaryFiles', 'readwrite');
            ctx.objectStore(window.DB_STORE || 'salaryFiles').clear();
          } catch (_) {}
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
        this.syncToWindowFiles(true);
      }

      if (!skipRemote) {
        if (this.apiBase) {
          try {
            await fetch(this.apiBase + '/api/sync/files/clear-module', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ module: module })
            }).catch(function(){});
          } catch (_) {}
        }
        if (module === 'salary' && window.ATPLCloudSharedStorageV1 && typeof window.ATPLCloudSharedStorageV1.clearSalary === 'function') {
          try { window.ATPLCloudSharedStorageV1.clearSalary().catch(function(){}); } catch (_) {}
        }
        if (module === 'salary' && window.ATPLFirebase && typeof window.ATPLFirebase.clearAllSalaryFiles === 'function') {
          try { await window.ATPLFirebase.clearAllSalaryFiles('admin'); } catch (_) {}
        }
      }
      return true;
    },

    getFileContent: async function(fileId) {
      if (!fileId) throw new Error('File ID required');
      if (this.apiBase) {
        var url = this.apiBase + '/api/sync/files/' + encodeURIComponent(fileId) + '/content?_t=' + Date.now();
        var res = await fetch(url, { cache: 'no-store' });
        if (res.ok) {
          var blob = await res.blob();
          return blob.arrayBuffer();
        }
      }
      if (window.ATPLFirebase && typeof window.ATPLFirebase.decodeDocPayload === 'function') {
        var decoded = await window.ATPLFirebase.decodeDocPayload({ id: fileId, name: fileId });
        if (decoded && decoded.original_b64) {
          return base64ToArrayBuffer(decoded.original_b64);
        }
      }
      throw new Error('Failed to download file content');
    },

    reconcileAll: async function(force = false) {
      if (this.isReconciling) {
        this.pendingReconcile = true;
        return;
      }
      this.isReconciling = true;
      try {
        this.lastSyncTime = Date.now();
        if (Array.isArray(window.FILES)) {
          window.FILES.forEach(f => {
            if (f && f.name && f.wb) {
              var fk = String(f.name).toLowerCase().trim();
              var allowed = typeof window.atplSalaryRestoreAllowed === 'function'
                ? window.atplSalaryRestoreAllowed(f.name, f.savedAt || f.saved)
                : true;
              if (allowed && !this.fileMap.has(fk)) {
                this.fileMap.set(fk, f);
              }
            }
          });
        }
        var serverFiles = null;
        var serverTombs = {};
        var backendSuccess = false;

        if (this.apiBase) {
          try {
            var fetchUrl = this.apiBase + '/api/sync/files?summary=1&_t=' + Date.now();
            var res = await fetch(fetchUrl, {
              cache: 'no-store',
              headers: { 'Accept': 'application/json', 'Cache-Control': 'no-cache, no-store, must-revalidate' }
            });
            if (res.ok) {
              var data = await res.json();
              if (data.ok && Array.isArray(data.files)) {
                serverFiles = data.files;
                serverTombs = data.tombstones || {};
                backendSuccess = true;
              }
            }
          } catch (_) {}
        }

        if (!this.apiBase && window.ATPLCloudSharedStorageV1 && typeof window.ATPLCloudSharedStorageV1.syncNow === "function") {
          try { window.ATPLCloudSharedStorageV1.syncNow(!!force).catch(function(){}); } catch (_) {}
        }
        if (!backendSuccess && window.ATPLFirebase && typeof window.ATPLFirebase.fetchAllSalaryFiles === 'function') {
          try {
            var fbFiles = await window.ATPLFirebase.fetchAllSalaryFiles();
            var fbTombs = typeof window.ATPLFirebase.fetchAllTombstones === 'function' ? await window.ATPLFirebase.fetchAllTombstones() : [];
            if (Array.isArray(fbFiles)) {
              serverFiles = fbFiles.map(function(f) {
                return Object.assign({}, f, {
                  id: f.id || f.name,
                  module: 'salary',
                  name: f.name,
                  buf: f.original_b64 || f.buf || '',
                  sheets: f.sheets || null,
                  created_at: f.saved_at || f.uploaded_at || new Date().toISOString(),
                  uploaded_by: f.uploaded_by || 'admin'
                });
              });
              if (Array.isArray(fbTombs)) {
                fbTombs.forEach(function(t) {
                  if (t && t.name) {
                    serverTombs[String(t.name).toLowerCase().trim()] = {
                      name: t.name,
                      deleted_at: t.deleted_at || t.cleared_at || new Date().toISOString()
                    };
                  }
                });
              }
              backendSuccess = true;
            }
          } catch (_) {}
        }

        if (!serverFiles) return;

        var salaryServerFiles = serverFiles.filter(function(f) { return f && (f.module === 'salary' || !f.module); });
        var localTombs = {};
        try { localTombs = JSON.parse(localStorage.getItem('ATPL_SALARY_TOMBSTONES_V2') || '{}'); } catch (_) {}

        var allClearedAt = 0;
        if (serverTombs['__all__'] && serverTombs['__all__'].deleted_at) {
          allClearedAt = Date.parse(serverTombs['__all__'].deleted_at) || 0;
          try { localStorage.setItem('ATPL_ALL_SALARY_CLEARED_AT', serverTombs['__all__'].deleted_at); } catch (_) {}
        }

        var activeServerNames = new Set();
        var activeServerIds = new Set();
        salaryServerFiles.forEach(function(sf) {
          var lName = String(sf.name || '').toLowerCase().trim();
          var lId = String(sf.id || '').toLowerCase().trim();
          var sfTime = Date.parse(sf.created_at || sf.saved_at || '0') || 0;
          if (allClearedAt && sfTime <= allClearedAt) return;
          var tEntry = serverTombs[lName] || (lId && serverTombs[lId]);
          if (tEntry && (Date.parse(tEntry.deleted_at || '0') || 0) >= sfTime) return;
          if (lName) activeServerNames.add(lName);
          if (lId) activeServerIds.add(lId);
        });

        if (serverTombs && typeof serverTombs === 'object') {
          for (var tk in serverTombs) {
            if (tk !== '__all__') {
              localTombs[tk.toLowerCase().trim()] = serverTombs[tk].deleted_at || new Date().toISOString();
            }
          }
          try { localStorage.setItem('ATPL_SALARY_TOMBSTONES_V2', JSON.stringify(localTombs)); } catch (_) {}
        }

        var prunedAny = false;
        var isUploadingNow = !!window.__ATPL_IS_UPLOADING;
        if (!isUploadingNow) {
          for (var [localKey, localItem] of Array.from(this.fileMap.entries())) {
            var lName = String((localItem && localItem.name) || localKey).toLowerCase().trim();
            var lId = String((localItem && localItem.id) || '').toLowerCase().trim();
            var itemTime = Date.parse((localItem && (localItem.savedAt || localItem.saved)) || '0') || 0;
            var tEntry = serverTombs[lName] || (lId && serverTombs[lId]);
            var tTime = tEntry ? (Date.parse(tEntry.deleted_at || '0') || Infinity) : 0;
            var isTombstoned = (tTime > 0 && tTime >= itemTime) || (allClearedAt > 0 && itemTime <= allClearedAt);
            var isMissingFromServer = !activeServerNames.has(lName) && (!lId || !activeServerIds.has(lId));
            if (isTombstoned) {
              this.fileMap.delete(localKey);
              this.fileMap.delete(lName);
              if (lId) this.fileMap.delete(lId);
              try {
                var req = indexedDB.open('AroraTextiles', 1);
                req.onsuccess = function(e) {
                  var db = e.target.result;
                  if (db.objectStoreNames.contains('salaryFiles')) {
                    db.transaction('salaryFiles', 'readwrite').objectStore('salaryFiles').delete((localItem && localItem.name) || localKey);
                  }
                };
              } catch (_) {}
              prunedAny = true;
            } else if (isMissingFromServer && localItem && localItem.buf && !localItem._pushedToCloud) {
              localItem._pushedToCloud = true;
              if (window.ATPLCloudSharedStorageV1 && typeof window.ATPLCloudSharedStorageV1.saveSalary === 'function') {
                try { window.ATPLCloudSharedStorageV1.saveSalary(localItem.name, localItem.buf, localItem.savedAt || new Date().toISOString()).catch(function(){}); } catch (_) {}
              }
              if (window.ATPLFirebase && typeof window.ATPLFirebase.saveSalaryFile === 'function') {
                try {
                  var b64Push = arrayBufferToBase64(localItem.buf);
                  window.ATPLFirebase.saveSalaryFile(localItem.name, { original_b64: b64Push, name: localItem.name }, { name: localItem.name, saved_at: localItem.savedAt || new Date().toISOString(), uploaded_by: 'admin' }).catch(function(){});
                } catch (_) {}
              }
            }
          }

          if (Array.isArray(window.FILES)) {
            var origLen = window.FILES.length;
            window.FILES = window.FILES.filter(function(x) {
              if (!x || !x.name) return false;
              var xn = String(x.name).toLowerCase().trim();
              var xi = String(x.id || '').toLowerCase().trim();
              var xTime = Date.parse(x.savedAt || x.saved || '0') || 0;
              var xtEntry = serverTombs[xn] || (xi && serverTombs[xi]);
              var xtTime = xtEntry ? (Date.parse(xtEntry.deleted_at || '0') || Infinity) : 0;
              if ((xtTime > 0 && xtTime >= xTime) || (allClearedAt > 0 && xTime <= allClearedAt)) return false;
              return true;
            });
            if (window.FILES.length !== origLen) prunedAny = true;
            if (typeof FILES !== 'undefined') FILES = window.FILES;
          }
        }

        if (prunedAny) {
          this.syncToWindowFiles(true);
        }

        var downloadedAny = false;
        for (var sf of salaryServerFiles) {
          if (!sf || !sf.name) continue;
          var sName = sf.name;
          var lNameLower = String(sName).toLowerCase().trim();
          if (!activeServerNames.has(lNameLower)) continue;

          if (localTombs[lNameLower]) {
            delete localTombs[lNameLower];
            try { localStorage.setItem('ATPL_SALARY_TOMBSTONES_V2', JSON.stringify(localTombs)); } catch (_) {}
          }

          var existing = this.fileMap.get(lNameLower);
          if (existing && existing.buf && existing.wb) continue;

          var winExisting = Array.isArray(window.FILES) ? window.FILES.find(function(x) { return x && String(x.name).toLowerCase().trim() === lNameLower && x.wb; }) : null;
          if (winExisting && winExisting.buf && winExisting.wb) {
            this.fileMap.set(lNameLower, winExisting);
            continue;
          }

          var rawBuf = null;
          if (sf.buf) {
            rawBuf = typeof sf.buf === 'string' ? base64ToArrayBuffer(sf.buf) : sf.buf;
          }
          if ((!rawBuf || !rawBuf.byteLength) && window.ATPLFirebase && typeof window.ATPLFirebase.decodeDocPayload === 'function') {
            try {
              var payload = await window.ATPLFirebase.decodeDocPayload(sf);
              if (payload && payload.original_b64) {
                rawBuf = base64ToArrayBuffer(payload.original_b64);
              } else if (payload && Array.isArray(payload.sheets) && window.XLSX) {
                var tempWb = window.XLSX.utils.book_new();
                payload.sheets.forEach(function(s) {
                  var ws = window.XLSX.utils.aoa_to_sheet(Array.isArray(s.rows) ? s.rows : []);
                  window.XLSX.utils.book_append_sheet(tempWb, ws, String(s.name || 'Sheet').slice(0, 31));
                });
                rawBuf = window.XLSX.write(tempWb, { bookType: 'xlsx', type: 'array', compression: true });
              }
            } catch (_) {}
          }

          if ((!rawBuf || !rawBuf.byteLength) && sf.id && this.apiBase) {
            try {
              rawBuf = await this.getFileContent(sf.id);
            } catch (_) {}
          }

          if (rawBuf && rawBuf.byteLength > 0 && window.parseWB && window.wbToSheets) {
            try {
              var wb = window.parseWB(rawBuf);
              var sheets = window.wbToSheets(wb);
              var entry = {
                id: sf.id || sName,
                name: sName,
                wb: wb,
                sheets: sheets,
                buf: rawBuf,
                fromDB: true,
                savedAt: sf.created_at || sf.saved || new Date().toISOString(),
                syncStatus: 'saved'
              };
              this.fileMap.set(lNameLower, entry);
              try {
                var reqDb = indexedDB.open('AroraTextiles', 1);
                reqDb.onsuccess = function(e) {
                  var db = e.target.result;
                  if (db.objectStoreNames.contains('salaryFiles')) {
                    db.transaction('salaryFiles', 'readwrite').objectStore('salaryFiles').put({
                      name: sName,
                      id: sf.id || sName,
                      buf: rawBuf,
                      saved: entry.savedAt
                    });
                  }
                };
              } catch (_) {}
              downloadedAny = true;
            } catch (err) {
              console.warn('[CentralSync] Parse error:', sName, err);
            }
          }
        }

        if (downloadedAny || prunedAny) {
          this.syncToWindowFiles(true);
        }

        // Also trigger HR Docs & Compliance reconciliation
        if (window.ATPLRealtimeSyncEngine) {
          if (typeof window.ATPLRealtimeSyncEngine.reconcileHrDocs === 'function') {
            await window.ATPLRealtimeSyncEngine.reconcileHrDocs();
          }
          if (typeof window.ATPLRealtimeSyncEngine.reconcileCompliance === 'function') {
            await window.ATPLRealtimeSyncEngine.reconcileCompliance();
          }
        }
      } catch (err) {
      } finally {
        this.isReconciling = false;
        if (this.pendingReconcile) {
          this.pendingReconcile = false;
          setTimeout(() => this.reconcileAll(true), 800);
        }
      }
    },

    updateSyncBadge: function(status, msg) {
      try {
        if (typeof window.updateRealtimeCloudBadge === 'function') {
          var count = this.fileMap ? this.fileMap.size : 0;
          window.updateRealtimeCloudBadge(count, status, msg);
        }
      } catch (_) {}
    }
  };

  window.ATPLCentralFileSync = ATPLCentralFileSync;
  window.atplBufToB64 = arrayBufferToBase64;
  window.atplB64ToBuf = base64ToArrayBuffer;
  window.atplSha256 = computeSha256;

  if (typeof window !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function() { ATPLCentralFileSync.init(); });
    } else {
      ATPLCentralFileSync.init();
    }
  }

})(window);
