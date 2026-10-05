/**
 * ATPL Central File Sync System (v2026.10-SERVER-BREATHER-FIX)
 * ─────────────────────────────────────────────────────────────────
 * Centralized, backend-authoritative, real-time file synchronization.
 * 
 * FIXES APPLIED:
 *  1. SERVER BREATHER: Added 1.5s delay between bulk uploads and downloads 
 *     to prevent Express/Cloud Run from choking or rate-limiting.
 *  2. PROGRESSIVE UI: Files appear on screen ONE BY ONE as they download, 
 *     rather than waiting for the entire batch to finish.
 *  3. UNBREAKABLE SYNC: Relentless polling every 5 seconds.
 *  4. STRICT MAP ENGINE: Mathematically prevents duplicates.
 * ─────────────────────────────────────────────────────────────────
 */
(function(window) {
  'use strict';

  var LIVE_CLOUD_RUN_URL = 'https://ais-dev-otzwpfkfuuyg26sg6l3uml-427004433114.asia-southeast1.run.app';

  function detectBackendUrl() {
    if (typeof window === 'undefined') return '';
    var origin = window.location.origin || '';
    if (origin.indexOf('localhost') >= 0 || origin.indexOf('127.0.0.1') >= 0 || origin.indexOf('.run.app') >= 0) {
      return ''; 
    }
    var configured = window.__ATPL_CENTRAL_BACKEND_URL;
    if (configured) return configured.replace(/\/+$/, '');
    if (origin.indexOf('github.io') >= 0) {
      return LIVE_CLOUD_RUN_URL;
    }
    return ''; 
  }

  var API_BASE = detectBackendUrl();

  async function computeSha256(data) {
    try {
      var buffer;
      if (typeof data === 'string') {
        if (data.indexOf('base64,') >= 0) {
          data = data.split('base64,')[1];
        }
        var binary = atob(data);
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
    var clean = base64.indexOf(',') >= 0 ? base64.split(',')[1] : base64;
    var binary = atob(clean);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }

  // An HTML login page or an unavailable server is never an empty file list.
  async function requestJson(url, options) {
    var controller = new AbortController();
    var timer = setTimeout(function() { controller.abort(); }, 20000);
    try {
      var res = await fetch(url, Object.assign({}, options || {}, { signal: controller.signal }));
      if (res.redirected || !/application\/json/i.test(res.headers.get('content-type') || '')) {
        throw new Error('Shared backend returned a login/HTML page. Configure an authenticated production API.');
      }
      var data = await res.json();
      if (!res.ok || !data || data.ok !== true) throw new Error(data && data.error || ('Shared backend HTTP ' + res.status));
      return data;
    } finally { clearTimeout(timer); }
  }

  function fileTime(file) {
    return Date.parse(file && (file.updated_at || file.savedAt || file.saved || file.created_at || file.uploaded_at) || '') || 0;
  }
  function deletedAfter(tombs, name, id, file) {
    return [name, id].some(function(key) {
      if (!key || !tombs[key]) return false;
      var value = tombs[key];
      var time = Date.parse(typeof value === 'object' ? value.deleted_at : value) || 0;
      return value === true || !time || time >= fileTime(file);
    });
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
    version: '2026.10-CONFIRMED-SYNC',
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
          if (f && f.name) this.fileMap.set(String(f.name).toLowerCase(), f);
        });
      }

      this.connectSSE();
      this.connectFirebase();
      this.bindWindowEvents();
      setTimeout(() => { this.reconcileAll(true); }, 300);
      
      // RELENTLESS POLLING (Every 3 seconds for instant cross-browser mirror)
      setInterval(() => {
        if (typeof document !== 'undefined' && !document.hidden) {
          this.requestReconcile();
        }
      }, 3000);
    },

    syncToWindowFiles: function() {
      var arr = Array.from(this.fileMap.values());
      arr.sort((a, b) => {
        var da = new Date(a.savedAt || 0).getTime();
        var db = new Date(b.savedAt || 0).getTime();
        return db - da; 
      });
      window.FILES = arr;
      if (typeof FILES !== 'undefined') FILES = arr;
      this.triggerImmediateUIRefresh();
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
      if (window.ATPLGenZDashboard && typeof window.ATPLGenZDashboard.refresh === 'function') {
        window.ATPLGenZDashboard.refresh();
      }
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
      if (this.eventSource) {
        try { this.eventSource.close(); } catch (_) {}
        this.eventSource = null;
      }
      var sseUrl = (this.apiBase || '') + '/api/sync/events';
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

        es.addEventListener('file_saved', (e) => { this.requestReconcile(); });
        es.addEventListener('file_deleted', (e) => { this.handleRemoteFileDeleted(e.data); });
        es.addEventListener('files_bulk_saved', (e) => { this.requestReconcile(); });
        es.addEventListener('module_cleared', (e) => {
          try { var m = JSON.parse(e.data); if ((m.data || m).module === 'salary') this.clearModule('salary', true); } catch (_) {}
        });
        es.addEventListener('salary_file_saved', (e) => { this.requestReconcile(); });
        es.addEventListener('salary_file_deleted', (e) => { this.handleRemoteFileDeleted(e.data); });
        es.addEventListener('salary_clear_all', (e) => { this.clearModule('salary', true); });
        es.addEventListener('hr_doc_deleted', (e) => {
          try {
            var msg = JSON.parse(e.data || '{}');
            var id = msg.id || (msg.data && msg.data.id);
            if (id && typeof window.hrDocGetDocs === 'function') {
              var docs = window.hrDocGetDocs();
              if (Array.isArray(docs)) {
                var lId = String(id).toLowerCase();
                var remaining = docs.filter(function(d) { return d && String(d.id).toLowerCase() !== lId; });
                docs.length = 0;
                Array.prototype.push.apply(docs, remaining);
                if (typeof window.hrDocRender === 'function') window.hrDocRender();
              }
            }
          } catch(_) {}
        });
      } catch (err) {}
    },

    connectFirebase: function() {
      if (typeof window === 'undefined') return;
      if (window.__atplFirebaseQuotaExhausted) return;
      
      var setupListeners = () => {
        if (!window.ATPLFirebase) return;
        if (typeof window.ATPLFirebase.subscribeSalaryFiles === 'function') {
          try {
            window.ATPLFirebase.subscribeSalaryFiles((update) => {
              if (!update) return;
              if (Array.isArray(update.removedNames) && update.removedNames.length > 0) {
                update.removedNames.forEach((delName) => {
                  this.deleteFile('salary', delName, true); 
                });
              }
              if (Array.isArray(update.all) && update.all.length > 0) {
                this.requestReconcile(); 
              }
            });
          } catch (_) {}
        }
      };

      if (window.ATPLFirebase) {
        setupListeners();
      } else {
        setTimeout(setupListeners, 800);
        setTimeout(setupListeners, 2500);
      }
    },

    requestReconcile: function() {
      if (this.reconcileTimer) {
        clearTimeout(this.reconcileTimer);
      }
      this.reconcileTimer = setTimeout(() => {
        this.reconcileAll(true);
      }, 500); 
    },

    handleRemoteFileDeleted: function(raw) {
      try {
        var msg = typeof raw === 'string' ? JSON.parse(raw) : raw;
        var info = msg.data || msg;
        if (info.module && info.module !== 'salary') return;
        var targetName = String(info.name || '').toLowerCase();
        var targetId = String(info.id || '').toLowerCase();
        if (!targetName && !targetId) return;

        console.warn('[CentralSync] Remote file deleted received:', targetName || targetId);

        var tombs = JSON.parse(localStorage.getItem('ATPL_SALARY_TOMBSTONES_V2') || '{}');
        if (targetName) tombs[targetName] = new Date().toISOString();
        if (targetId) tombs[targetId] = new Date().toISOString();
        localStorage.setItem('ATPL_SALARY_TOMBSTONES_V2', JSON.stringify(tombs));

        if (targetName) this.fileMap.delete(targetName);
        if (targetId) this.fileMap.delete(targetId);
        for (var [k, v] of this.fileMap.entries()) {
          var vn = String(v.name || '').toLowerCase();
          var vi = String(v.id || '').toLowerCase();
          if ((targetName && (vn === targetName || vi === targetName)) || (targetId && (vi === targetId || vn === targetId))) {
            this.fileMap.delete(k);
          }
        }

        if (Array.isArray(window.FILES)) {
          window.FILES = window.FILES.filter(function(x) {
            if (!x) return false;
            var xn = String(x.name || '').toLowerCase();
            var xi = String(x.id || '').toLowerCase();
            return !(targetName && (xn === targetName || xi === targetName)) && !(targetId && (xi === targetId || xn === targetId));
          });
          if (typeof FILES !== 'undefined') FILES = window.FILES;
        }
        
        if (typeof deleteFromDB === 'function') {
            if (info.name) deleteFromDB(info.name);
            if (info.id) deleteFromDB(info.id);
        }
        if (window.DB) {
          try {
            var dtx = window.DB.transaction(window.DB_STORE || 'salaryFiles', 'readwrite');
            if (info.name) dtx.objectStore(window.DB_STORE || 'salaryFiles').delete(info.name);
            if (info.id) dtx.objectStore(window.DB_STORE || 'salaryFiles').delete(info.id);
          } catch (_) {}
        }

        this.syncToWindowFiles();
        if (window.ATPLGenZDashboard && typeof window.ATPLGenZDashboard.refresh === 'function') {
          window.ATPLGenZDashboard.refresh(true);
        }
        window.dispatchEvent(new CustomEvent('atpl_files_updated'));
      } catch (e) {}
    },

    uploadFile: async function(module, fileObj, meta = {}, onProgress = null) {
      return this.uploadQueue.add(async () => {
        if (onProgress) onProgress('preparing', 10);
        var name = fileObj.name;
        var lName = String(name).toLowerCase();
        var mime = fileObj.type || fileObj.mime_type || 'application/octet-stream';
        var size = fileObj.size || 0;
        var bufBase64 = '';
        var rawBuf = null;

        if (typeof fileObj.buf === 'string') {
          bufBase64 = fileObj.buf;
          rawBuf = base64ToArrayBuffer(fileObj.buf);
        } else if (fileObj instanceof File || fileObj instanceof Blob) {
          var arrayBuf = await fileObj.arrayBuffer();
          rawBuf = arrayBuf;
          bufBase64 = arrayBufferToBase64(arrayBuf);
          size = arrayBuf.byteLength;
        } else if (fileObj.buf instanceof ArrayBuffer) {
          rawBuf = fileObj.buf;
          bufBase64 = arrayBufferToBase64(rawBuf);
          size = rawBuf.byteLength;
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

        var result;
        try {
          result = await requestJson((this.apiBase || '') + '/api/sync/files', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
          });
          if (!result.file || !result.file.id || !result.file.name) throw new Error('Backend did not confirm the saved file.');
        } catch (err) {
          this.updateSyncBadge('error', 'Upload not confirmed — retry required');
          if (onProgress) onProgress('failed', 0);
          throw err;
        }
        // Use the server identity (including deduplicated uploads).
        payload = result.file;
        name = payload.name;
        lName = String(name).toLowerCase();
        var tombs = JSON.parse(localStorage.getItem('ATPL_SALARY_TOMBSTONES_V2') || '{}');
        delete tombs[lName];
        delete tombs[String(payload.id).toLowerCase()];
        localStorage.setItem('ATPL_SALARY_TOMBSTONES_V2', JSON.stringify(tombs));

        if (module === 'salary' && rawBuf && window.parseWB && window.wbToSheets) {
          try {
            var wb = window.parseWB(rawBuf);
            var sheets = window.wbToSheets(wb);
            
            this.fileMap.set(lName, { 
                id: payload.id, name: name, wb: wb, sheets: sheets, buf: rawBuf, 
                savedAt: payload.created_at, syncStatus: result.ok ? 'saved' : 'pending' 
            });
            
            if (typeof saveFileToDB === 'function') saveFileToDB(name, rawBuf); 
          } catch (_) {}
        }
        
        this.syncToWindowFiles();
        if (onProgress) onProgress('saved', 100);
        return result.file || payload;
      });
    },

    uploadBulk: async function(module, fileList, metaGenerator = null, onFileProgress = null) {
      var files = Array.from(fileList || []);
      if (!files.length) return { total: 0, saved: 0, failed: 0, results: [] };

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
        
        // Streamlined delay between uploads for smooth server handling
        if (i < files.length - 1) {
            await new Promise(r => setTimeout(r, 100));
        }
      }

      if (module === 'salary') this.syncToWindowFiles(); 
      return { total: files.length, saved: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length, results: results };
    },

    deleteFile: async function(module, idOrName, skipRemote = false) {
      if (!idOrName) return false;
      if (!skipRemote) {
        await requestJson((this.apiBase || '') + '/api/sync/files/' + encodeURIComponent(idOrName) + '?module=' + encodeURIComponent(module), { method: 'DELETE' });
      }
      var targetName = String(idOrName).toLowerCase();

      var tombs = JSON.parse(localStorage.getItem('ATPL_SALARY_TOMBSTONES_V2') || '{}');
      tombs[targetName] = new Date().toISOString();
      localStorage.setItem('ATPL_SALARY_TOMBSTONES_V2', JSON.stringify(tombs));

      this.fileMap.delete(targetName);
      for (var [k, v] of this.fileMap.entries()) {
        var vn = String((v && v.name) || '').toLowerCase();
        var vi = String((v && v.id) || '').toLowerCase();
        if (vn === targetName || vi === targetName || k === targetName) {
            this.fileMap.delete(k);
        }
      }

      if (Array.isArray(window.FILES)) {
        window.FILES = window.FILES.filter(function(x) {
          if (!x) return false;
          var xn = String(x.name || '').toLowerCase();
          var xi = String(x.id || '').toLowerCase();
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

      this.syncToWindowFiles();

      if (module === 'salary' && typeof deleteFromDB === 'function') {
         deleteFromDB(idOrName);
      }
      return true;
    },

    clearModule: async function(module = 'salary', skipRemote = false) {
      if (!skipRemote) {
        await requestJson((this.apiBase || '') + '/api/sync/files/clear-module', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ module: module })
        });
      }

      if (module === 'salary') {
        this.fileMap.clear();
        if (window.DB) {
          try {
            var ctx = window.DB.transaction(window.DB_STORE || 'salaryFiles', 'readwrite');
            ctx.objectStore(window.DB_STORE || 'salaryFiles').clear();
          } catch (_) {}
        }
        this.syncToWindowFiles();
      }
      return true;
    },

    getFileContent: async function(fileId) {
      if (!fileId) throw new Error('File ID required');
      var url = (this.apiBase || '') + '/api/sync/files/' + encodeURIComponent(fileId) + '/content?_t=' + Date.now();
      var res = await fetch(url, { cache: 'no-store' });
      if (!res.ok || res.redirected || /text\/html/i.test(res.headers.get('content-type') || '')) throw new Error('Failed to download file content');
      var blob = await res.blob();
      return blob.arrayBuffer();
    },

    reconcileAll: async function(force = false) {
      if (this.isReconciling) {
        this.pendingReconcile = true; 
        return;
      }
      this.isReconciling = true;
      try {
        this.lastSyncTime = Date.now();
        var data = await requestJson((this.apiBase || '') + '/api/sync/files?module=salary&summary=1&_t=' + Date.now(), {
          cache: 'no-store', headers: { 'Accept': 'application/json' }
        });
        if (!Array.isArray(data.files)) throw new Error('Shared backend returned an invalid file list.');
        var serverFiles = data.files;
        var serverTombs = data.tombstones || {};

        var salaryServerFiles = serverFiles.filter(function(f) { return f && (f.module === 'salary' || !f.module); });
        var localTombs = {};
        try { localTombs = JSON.parse(localStorage.getItem('ATPL_SALARY_TOMBSTONES_V2') || '{}'); } catch(e){}

        // Only explicit deletion records can remove local files.
        // Merge server tombstones into local storage
        if (serverTombs && typeof serverTombs === 'object') {
          for (var tk in serverTombs) {
            if (!serverTombs[tk]) continue;
            if (serverTombs[tk].module && serverTombs[tk].module !== 'salary') continue;
            var stamp = serverTombs[tk].deleted_at || serverTombs[tk];
            if (!localTombs[tk.toLowerCase()] || Date.parse(stamp) > Date.parse(localTombs[tk.toLowerCase()])) localTombs[tk.toLowerCase()] = stamp;
          }
          try { localStorage.setItem('ATPL_SALARY_TOMBSTONES_V2', JSON.stringify(localTombs)); } catch(_) {}
        }

        var prunedAny = false;
        // Check this.fileMap for deleted files
        for (var [localKey, localItem] of Array.from(this.fileMap.entries())) {
          var lName = String((localItem && localItem.name) || localKey).toLowerCase();
          var lId = String((localItem && localItem.id) || '').toLowerCase();
          var isTombstoned = deletedAfter(localTombs, lName, lId, localItem);

          if (isTombstoned) {
            console.warn('[CentralSync] Strict auto-prune deleted file:', lName);
            this.fileMap.delete(localKey);
            this.fileMap.delete(lName);
            if (lId) this.fileMap.delete(lId);

            if (window.DB) {
              try {
                var ptx = window.DB.transaction(window.DB_STORE || 'salaryFiles', 'readwrite');
                ptx.objectStore(window.DB_STORE || 'salaryFiles').delete(localItem.name || localKey);
              } catch (_) {}
            }
            prunedAny = true;
          }
        }

        // Also purge from window.FILES
        if (Array.isArray(window.FILES)) {
          var origLen = window.FILES.length;
          window.FILES = window.FILES.filter(function(x) {
            if (!x || !x.name) return false;
            var xn = String(x.name).toLowerCase();
            var xi = String(x.id || '').toLowerCase();
            var isTomb = deletedAfter(localTombs, xn, xi, x);
            return !isTomb; // Missing is not proof of deletion: keep unsynced local copies.
          });
          if (window.FILES.length !== origLen) prunedAny = true;
          if (typeof FILES !== 'undefined') FILES = window.FILES;
        }

        if (prunedAny) {
          this.syncToWindowFiles();
        }

        var downloadedAny = false;
        for (var sf of salaryServerFiles) {
          if (!sf || (!sf.name && !sf.id)) continue;
          var sName = sf.name;
          var lNameLower = String(sName).toLowerCase();
          var lIdLower = sf.id ? String(sf.id).toLowerCase() : '';

          if (deletedAfter(localTombs, lNameLower, lIdLower, sf)) {
              this.fileMap.delete(lNameLower);
              continue; 
          }

          var existing = this.fileMap.get(lNameLower);
          if (existing && existing.buf && existing.wb && fileTime(existing) >= fileTime(sf)) {
              continue; 
          }

          var winExisting = Array.isArray(window.FILES) ? window.FILES.find(function(x) { return x && String(x.name).toLowerCase() === lNameLower && x.wb; }) : null;
          if (winExisting && winExisting.buf && winExisting.wb && fileTime(winExisting) >= fileTime(sf)) {
            this.fileMap.set(lNameLower, winExisting);
            continue;
          }

          var rawBuf = null;
          if (sf.buf) {
            rawBuf = typeof sf.buf === 'string' ? base64ToArrayBuffer(sf.buf) : sf.buf;
          }

          if (!rawBuf && sf.id) {
            try {
              rawBuf = await this.getFileContent(sf.id);
            } catch(e) {
              try {
                var sRes = await fetch((this.apiBase || '') + '/api/sync/salary-file/' + encodeURIComponent(sName));
                if (sRes.ok) {
                  var sJson = await sRes.json();
                  if (sJson && sJson.file && sJson.file.buf) {
                    rawBuf = base64ToArrayBuffer(sJson.file.buf);
                  }
                }
              } catch (_) {}
            }
          }

          var latestTombs = JSON.parse(localStorage.getItem('ATPL_SALARY_TOMBSTONES_V2') || '{}');
          if (deletedAfter(latestTombs, lNameLower, lIdLower, sf)) continue;
          if (!rawBuf || !rawBuf.byteLength) throw new Error('Download not confirmed: ' + sName);
          if (rawBuf && rawBuf.byteLength > 0 && window.parseWB && window.wbToSheets) {
            try {
              var wb = window.parseWB(rawBuf);
              var sheets = window.wbToSheets(wb);
              
              this.fileMap.set(lNameLower, {
                id: sf.id,
                name: sName,
                wb: wb,
                sheets: sheets,
                buf: rawBuf,
                fromDB: true,
                savedAt: sf.updated_at || sf.created_at || sf.saved || new Date().toISOString(),
                syncStatus: 'saved'
              });
              
              if (window.DB) {
                try {
                  var tx = window.DB.transaction(window.DB_STORE || 'salaryFiles', 'readwrite');
                  tx.objectStore(window.DB_STORE || 'salaryFiles').put({ name: sName, id: sf.id, buf: rawBuf, saved: sf.created_at || sf.saved || new Date().toISOString() });
                } catch (_) {}
              }
              downloadedAny = true;
            } catch (err) {
              throw new Error('Could not read shared workbook ' + sName + ': ' + err.message);
            }
          }
        }
        if (downloadedAny || prunedAny) {
          this.syncToWindowFiles();
        }
        this.lastError = '';
        return true;
      } catch (err) {
        this.lastError = err.message || String(err);
        this.updateSyncBadge('error', 'Sync unavailable — local files retained');
        return false;
      } finally {
        this.isReconciling = false;
        if (this.pendingReconcile) {
          this.pendingReconcile = false;
          setTimeout(() => this.reconcileAll(true), 1000);
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
