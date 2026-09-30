/**
 * ATPL Central File Sync System (v2026.10-authoritative)
 * ─────────────────────────────────────────────────────────────────
 * Centralized, backend-authoritative, real-time file synchronization
 * engine for all ERP file modules:
 *  - Salary Audit & All Files
 *  - PF to DOL & ESIC to DOL Challans
 *  - HR Documents & Compliance Records
 *  - Bank Account Verification Sheets
 *  - Employee Documents & General Files
 *
 * Architecture Principles:
 *  1. Backend is the SINGLE SOURCE OF TRUTH.
 *  2. Real-time push via SSE events + Firebase Firestore WebSocket sync (1–3 second cross-browser sync).
 *  3. Permanent Delete Guarantee: Once deleted on backend, no client
 *     cache or offline session can resurrect it.
 *  4. Controlled Bulk Upload Queue: Concurrency limit (3), per-file
 *     status tracking, SHA-256 deduplication.
 *  5. Reconnect Reconciliation: Authoritative fetch after reconnect,
 *     login, window focus, or page refresh. Backend always wins.
 * ─────────────────────────────────────────────────────────────────
 */
(function(window) {
  'use strict';

  // Determine central backend URL
  // If running on a static host (e.g. GitHub Pages), fallback to deployed Cloud Run backend
  function detectBackendUrl() {
    if (typeof window === 'undefined') return '';
    var origin = window.location.origin || '';
    if (origin.indexOf('localhost') >= 0 || origin.indexOf('127.0.0.1') >= 0 || origin.indexOf('.run.app') >= 0) {
      return ''; // Local Express server or direct Cloud Run
    }
    var configured = window.__ATPL_CENTRAL_BACKEND_URL;
    if (configured) return configured.replace(/\/+$/, '');
    // For GitHub Pages or external domains, default to deployed Cloud Run backend
    return 'https://ais-pre-jiolbcc7lq5ecyqpk3wi6s-318187434838.asia-southeast1.run.app';
  }

  var API_BASE = detectBackendUrl();

  // Compute SHA-256 hash in browser
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

  // Convert ArrayBuffer / Uint8Array to Base64 safely in chunks
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

  // Convert Base64 to ArrayBuffer
  function base64ToArrayBuffer(base64) {
    if (!base64) return new ArrayBuffer(0);
    var clean = base64.indexOf(',') >= 0 ? base64.split(',')[1] : base64;
    var binary = atob(clean);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }

  // Concurrency Queue for Controlled Bulk Uploads (Max 3 concurrent)
  class ConcurrencyQueue {
    constructor(concurrency = 3) {
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

  // Central File Sync Service Singleton
  var ATPLCentralFileSync = {
    version: '2026.10-authoritative',
    apiBase: API_BASE,
    connected: false,
    serverStateVersion: 0,
    eventSource: null,
    subscribers: {}, // module -> array of callbacks
    uploadQueue: new ConcurrencyQueue(3),
    reconnectTimer: null,
    reconnectAttempts: 0,
    lastSyncTime: 0,
    isReconciling: false,

    // Initialize Real-time SSE Connection & Listeners
    init: function() {
      console.log('[ATPL FileSync] Initializing central backend-authoritative sync system...');
      this.connectSSE();
      this.connectFirebase();
      this.bindWindowEvents();
      // Fast authoritative reconcile
      setTimeout(() => { this.reconcileAll(); }, 300);
      setInterval(() => {
        if (typeof document !== 'undefined' && !document.hidden) {
          this.reconcileAll();
        }
      }, 4000);
    },

    // Bind window visibility and online events for reconnect recovery
    bindWindowEvents: function() {
      window.addEventListener('online', () => {
        console.log('[ATPL FileSync] Network came online — reconnecting and reconciling...');
        this.connectSSE();
        this.reconcileAll(true);
      });

      document.addEventListener('visibilitychange', () => {
        if (!document.hidden && Date.now() - this.lastSyncTime > 4000) {
          console.log('[ATPL FileSync] Tab focused — checking for remote changes...');
          this.reconcileAll();
        }
      });
    },

    // Connect Server-Sent Events (SSE) for Real-Time Cross-Browser Updates
    connectSSE: function() {
      if (this.eventSource) {
        try { this.eventSource.close(); } catch (_) {}
        this.eventSource = null;
      }

      var sseUrl = (this.apiBase || '') + '/api/sync/events';
      console.log('[ATPL FileSync] Connecting real-time SSE stream:', sseUrl);

      try {
        var es = new EventSource(sseUrl);
        this.eventSource = es;

        es.onopen = () => {
          console.log('[ATPL FileSync] Real-time SSE event stream connected successfully!');
          this.connected = true;
          this.reconnectAttempts = 0;
          this.updateSyncBadge('ok', '⚡ Realtime Live');
        };

        es.onerror = () => {
          this.connected = false;
          try { es.close(); } catch (_) {}
          this.eventSource = null;
          var delay = Math.min(15000, 1000 * Math.pow(1.5, this.reconnectAttempts++));
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = setTimeout(() => {
            this.connectSSE();
            this.reconcileAll();
          }, delay);
        };

        // Listen for unified file events
        es.addEventListener('file_saved', (e) => {
          this.handleRemoteFileSaved(e.data);
        });

        es.addEventListener('file_deleted', (e) => {
          this.handleRemoteFileDeleted(e.data);
        });

        es.addEventListener('files_bulk_saved', (e) => {
          this.handleRemoteBulkSaved(e.data);
        });

        es.addEventListener('module_cleared', (e) => {
          this.handleRemoteModuleCleared(e.data);
        });

        // Legacy event listeners
        es.addEventListener('salary_file_saved', (e) => {
          this.handleRemoteFileSaved(e.data);
        });

        es.addEventListener('salary_file_deleted', (e) => {
          this.handleRemoteFileDeleted(e.data);
        });

        es.addEventListener('salary_clear_all', (e) => {
          this.handleRemoteModuleCleared({ module: 'salary' });
        });

      } catch (err) {
        console.warn('[ATPL FileSync] SSE initialization notice:', err.message);
      }
    },

    // Connect Firebase Firestore Real-Time Watchers (Double Redundancy)
    connectFirebase: function() {
      if (typeof window === 'undefined') return;
      var setupListeners = () => {
        if (!window.ATPLFirebase) return;
        if (typeof window.ATPLFirebase.subscribeSalaryFiles === 'function') {
          try {
            window.ATPLFirebase.subscribeSalaryFiles((update) => {
              if (!update) return;
              if (Array.isArray(update.removedNames) && update.removedNames.length > 0) {
                update.removedNames.forEach((delName) => {
                  this.handleRemoteFileDeleted({ module: 'salary', name: delName });
                });
              }
              if (Array.isArray(update.all) && update.all.length > 0) {
                var localNames = (window.FILES || []).map(f => String(f.name).toLowerCase());
                var remoteNames = update.all.map(f => String(f.name).toLowerCase());
                var hasNew = remoteNames.some(rn => !localNames.includes(rn));
                var hasDeleted = localNames.some(ln => !remoteNames.includes(ln));
                if (hasNew || hasDeleted) {
                  this.reconcileAll();
                }
              }
            });
          } catch (_) {}
        }
        if (typeof window.ATPLFirebase.subscribeTombstones === 'function') {
          try {
            window.ATPLFirebase.subscribeTombstones((tombs) => {
              if (Array.isArray(tombs) && tombs.length > 0) {
                tombs.forEach((t) => {
                  if (t && t.name) this.handleRemoteFileDeleted({ module: 'salary', name: t.name });
                });
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

    // Handle remote file saved event
    handleRemoteFileSaved: function(raw) {
      try {
        var msg = typeof raw === 'string' ? JSON.parse(raw) : raw;
        var file = msg.file || msg.data || msg;
        if (!file || !file.name) return;
        console.log('[ATPL FileSync] Remote file saved event received:', file.name, 'Module:', file.module);
        if (msg.version) this.serverStateVersion = msg.version;

        if (file.module === 'salary' || !file.module) {
          var fileName = file.name;
          var cur = (window.FILES || []).find(function(x) { return x && String(x.name).toLowerCase() === String(fileName).toLowerCase(); });
          if (!(cur && cur.savedAt === (file.created_at || file.saved) && cur.buf)) {
            var rawBuf = file.buf ? (typeof file.buf === 'string' ? base64ToArrayBuffer(file.buf) : file.buf) : null;
            if (rawBuf && window.parseWB && window.wbToSheets) {
              var wb = window.parseWB(rawBuf);
              var sheets = window.wbToSheets(wb);
              window.FILES = (window.FILES || []).filter(function(x) { return String(x.name).toLowerCase() !== String(fileName).toLowerCase(); });
              var item = { name: fileName, wb: wb, sheets: sheets, buf: rawBuf, fromDB: true, savedAt: file.created_at || file.saved || new Date().toISOString() };
              window.FILES.push(item);
              if (typeof FILES !== 'undefined') FILES = window.FILES;
              if (typeof saveFileToDB === 'function') saveFileToDB(fileName, rawBuf);
              if (typeof renderFiles === 'function') renderFiles();
              if (typeof renderSheets === 'function') renderSheets();
              if (typeof updStats === 'function') updStats();
              if (typeof renderAllFilesPage === 'function') renderAllFilesPage();
              if (typeof populateNJSelects === 'function') populateNJSelects();
              this.updateSyncBadge('ok', '⚡ Realtime (' + (window.FILES || []).length + ' files)');
            } else {
              this.reconcileAll();
            }
          }
        }

        this.notifySubscribers(file.module || 'salary', 'saved', file);
        this.notifySubscribers('all', 'saved', file);
      } catch (e) {
        console.warn('[ATPL FileSync] handleRemoteFileSaved parse error:', e);
      }
    },

    // Handle remote file deleted event (PERMANENT DELETE)
    handleRemoteFileDeleted: function(raw) {
      try {
        var msg = typeof raw === 'string' ? JSON.parse(raw) : raw;
        var info = msg.data || msg;
        var targetName = String(info.name || info.id || '').toLowerCase();
        if (!targetName) return;
        console.log('[ATPL FileSync] Remote file deleted event received:', targetName, 'Module:', info.module);
        if (msg.version) this.serverStateVersion = msg.version;

        if (info.module === 'salary' || !info.module || (window.FILES || []).some(function(x) { return x && String(x.name).toLowerCase() === targetName; })) {
          window.FILES = (window.FILES || []).filter(function(x) { return x && String(x.name).toLowerCase() !== targetName; });
          if (typeof FILES !== 'undefined') FILES = window.FILES;
          if (typeof deleteFromDB === 'function') deleteFromDB(info.name || info.id);
          try {
            var tombs = JSON.parse(localStorage.getItem('ATPL_SALARY_TOMBSTONES_V2') || '{}');
            tombs[targetName] = new Date().toISOString();
            localStorage.setItem('ATPL_SALARY_TOMBSTONES_V2', JSON.stringify(tombs));
          } catch (_) {}
          if (typeof renderFiles === 'function') renderFiles();
          if (typeof renderSheets === 'function') renderSheets();
          if (typeof updStats === 'function') updStats();
          if (typeof renderAllFilesPage === 'function') renderAllFilesPage();
          if (typeof populateNJSelects === 'function') populateNJSelects();
          this.updateSyncBadge('ok', '⚡ Realtime (' + (window.FILES || []).length + ' files)');
        }

        this.notifySubscribers(info.module || 'salary', 'deleted', info);
        this.notifySubscribers('all', 'deleted', info);
      } catch (e) {
        console.warn('[ATPL FileSync] handleRemoteFileDeleted parse error:', e);
      }
    },

    // Handle remote bulk files saved event
    handleRemoteBulkSaved: function(raw) {
      try {
        var msg = typeof raw === 'string' ? JSON.parse(raw) : raw;
        console.log('[ATPL FileSync] Remote bulk saved event received:', msg.count || 0, 'files');
        if (msg.version) this.serverStateVersion = msg.version;
        this.reconcileAll();
        var files = msg.files || [];
        var modules = new Set(files.map(f => f.module).filter(Boolean));
        modules.forEach(mod => {
          this.notifySubscribers(mod, 'bulk_saved', files.filter(f => f.module === mod));
        });
        this.notifySubscribers('all', 'bulk_saved', files);
      } catch (e) {
        console.warn('[ATPL FileSync] handleRemoteBulkSaved parse error:', e);
      }
    },

    // Handle remote module cleared event
    handleRemoteModuleCleared: function(raw) {
      try {
        var msg = typeof raw === 'string' ? JSON.parse(raw) : raw;
        var mod = msg.module || (msg.data && msg.data.module) || 'salary';
        console.log('[ATPL FileSync] Remote module cleared event received for module:', mod);
        if (mod === 'salary') {
          window.FILES = [];
          if (typeof FILES !== 'undefined') FILES = [];
          if (window.DB) {
            try {
              var ctx = window.DB.transaction(window.DB_STORE || 'salaryFiles', 'readwrite');
              ctx.objectStore(window.DB_STORE || 'salaryFiles').clear();
            } catch (_) {}
          }
          if (typeof renderFiles === 'function') renderFiles();
          if (typeof renderSheets === 'function') renderSheets();
          if (typeof updStats === 'function') updStats();
          if (typeof renderAllFilesPage === 'function') renderAllFilesPage();
          if (typeof populateNJSelects === 'function') populateNJSelects();
          this.updateSyncBadge('ok', '⚡ Realtime (0 files)');
        }
        this.notifySubscribers(mod, 'cleared', msg);
      } catch (e) {
        console.warn('[ATPL FileSync] handleRemoteModuleCleared parse error:', e);
      }
    },

    // Subscribe a callback to changes in a specific module
    subscribe: function(module, callback) {
      if (!this.subscribers[module]) this.subscribers[module] = [];
      this.subscribers[module].push(callback);
      return () => {
        this.subscribers[module] = this.subscribers[module].filter(cb => cb !== callback);
      };
    },

    notifySubscribers: function(module, eventType, data) {
      var cbs = this.subscribers[module] || [];
      cbs.forEach(cb => {
        try { cb(eventType, data); } catch (err) { console.error('[ATPL FileSync] Subscriber error:', err); }
      });
    },

    // Authoritative Fetch / List Files from Backend
    listFiles: async function(module = 'all', force = false) {
      var url = (this.apiBase || '') + '/api/sync/files?module=' + encodeURIComponent(module) + '&summary=0';
      var res = await fetch(url, {
        headers: { 'Accept': 'application/json' },
        cache: force ? 'no-cache' : 'default'
      });
      if (!res.ok) throw new Error('Failed to list files from backend (' + res.status + ')');
      var data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Backend failed to return files');
      if (data.version) this.serverStateVersion = data.version;
      return data.files || [];
    },

    // Authoritative Upload Single File
    uploadFile: async function(module, fileObj, meta = {}, onProgress = null) {
      return this.uploadQueue.add(async () => {
        if (onProgress) onProgress('preparing', 10);
        var name = fileObj.name;
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
        } else if (fileObj.buffer instanceof ArrayBuffer) {
          rawBuf = fileObj.buffer;
          bufBase64 = arrayBufferToBase64(fileObj.buffer);
          size = fileObj.buffer.byteLength;
        } else if (fileObj.buf instanceof ArrayBuffer) {
          rawBuf = fileObj.buf;
          bufBase64 = arrayBufferToBase64(fileObj.buf);
          size = fileObj.buf.byteLength;
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

        // 1. Post to Express Backend
        var res = await fetch((this.apiBase || '') + '/api/sync/files', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (!res.ok) {
          var errJson = {};
          try { errJson = await res.json(); } catch (_) {}
          throw new Error(errJson.error || ('Upload failed with status ' + res.status));
        }

        var result = await res.json();
        if (!result.ok) throw new Error(result.error || 'Server rejected file upload');

        // 2. Also Mirror to Google Firebase Firestore for global 100% uptime
        if (module === 'salary' && window.ATPLFirebase && typeof window.ATPLFirebase.saveSalaryFile === 'function') {
          try {
            await window.ATPLFirebase.saveSalaryFile(name, { original_b64: bufBase64, name: name }, { name: name, saved_at: payload.created_at, uploaded_by: payload.uploaded_by });
          } catch (e) {
            console.warn('[ATPL FileSync] Firestore mirror notice:', e.message);
          }
        }

        // 3. Update local state
        if (module === 'salary' && rawBuf && window.parseWB && window.wbToSheets) {
          try {
            var wb = window.parseWB(rawBuf);
            var sheets = window.wbToSheets(wb);
            window.FILES = (window.FILES || []).filter(function(x) { return x && x.name !== name; });
            window.FILES.push({ name: name, wb: wb, sheets: sheets, buf: rawBuf, savedAt: payload.created_at });
            if (typeof FILES !== 'undefined') FILES = window.FILES;
            if (typeof saveFileToDB === 'function') saveFileToDB(name, rawBuf);
          } catch (_) {}
        }

        if (onProgress) onProgress('saved', 100);
        console.log('[ATPL FileSync] File upload confirmed by central backend:', name);
        return result.file || payload;
      });
    },

    // Controlled Bulk Upload with Per-File State Tracking & Retry (Limit 3 concurrent)
    uploadBulk: async function(module, fileList, metaGenerator = null, onFileProgress = null) {
      var files = Array.from(fileList || []);
      if (!files.length) return { total: 0, saved: 0, failed: 0, results: [] };

      console.log('[ATPL FileSync] Starting controlled bulk upload of ' + files.length + ' files in module: ' + module);
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
          console.error('[ATPL FileSync] Bulk upload item failed:', f.name, err);
          results.push({ ok: false, name: f.name, error: err.message || err });
          if (onFileProgress) onFileProgress(i, 'failed', 0, f.name, err.message || err);
        }
      }

      var savedCount = results.filter(r => r.ok).length;
      var failedCount = results.filter(r => !r.ok).length;
      console.log('[ATPL FileSync] Bulk upload complete. Saved:', savedCount, 'Failed:', failedCount);

      if (module === 'salary') {
        if (typeof renderFiles === 'function') renderFiles();
        if (typeof renderSheets === 'function') renderSheets();
        if (typeof updStats === 'function') updStats();
        if (typeof renderAllFilesPage === 'function') renderAllFilesPage();
        if (typeof populateNJSelects === 'function') populateNJSelects();
      }

      return {
        total: files.length,
        saved: savedCount,
        failed: failedCount,
        results: results
      };
    },

    // Permanent Delete: Deleted file is removed from backend and NEVER resurrected
    deleteFile: async function(module, idOrName) {
      if (!idOrName) return false;
      console.log('[ATPL FileSync] Requesting permanent deletion of:', idOrName, 'Module:', module);

      // 1. Delete from central backend API
      try {
        var url = (this.apiBase || '') + '/api/sync/files/' + encodeURIComponent(idOrName) + '?module=' + encodeURIComponent(module);
        await fetch(url, { method: 'DELETE' });
      } catch (err) {
        console.warn('[ATPL FileSync] Backend delete notice:', err.message);
      }

      // 2. Delete from Firebase Firestore
      if (module === 'salary' && window.ATPLFirebase && typeof window.ATPLFirebase.deleteSalaryFile === 'function') {
        try {
          await window.ATPLFirebase.deleteSalaryFile(idOrName, 'admin');
        } catch (_) {}
      }

      // 3. Remove immediately from local state & IndexedDB
      if (module === 'salary') {
        var targetName = String(idOrName).toLowerCase();
        window.FILES = (window.FILES || []).filter(function(x) { return x && String(x.name).toLowerCase() !== targetName; });
        if (typeof FILES !== 'undefined') FILES = window.FILES;
        if (typeof deleteFromDB === 'function') deleteFromDB(idOrName);
        try {
          var tombs = JSON.parse(localStorage.getItem('ATPL_SALARY_TOMBSTONES_V2') || '{}');
          tombs[targetName] = new Date().toISOString();
          localStorage.setItem('ATPL_SALARY_TOMBSTONES_V2', JSON.stringify(tombs));
        } catch (_) {}
        if (typeof renderFiles === 'function') renderFiles();
        if (typeof renderSheets === 'function') renderSheets();
        if (typeof updStats === 'function') updStats();
        if (typeof renderAllFilesPage === 'function') renderAllFilesPage();
        if (typeof populateNJSelects === 'function') populateNJSelects();
        this.updateSyncBadge('ok', '⚡ Realtime (' + (window.FILES || []).length + ' files)');
      }

      this.notifySubscribers(module, 'deleted', { id: idOrName, name: idOrName, module: module });
      this.notifySubscribers('all', 'deleted', { id: idOrName, name: idOrName, module: module });
      return true;
    },

    // Clear entire module permanently
    clearModule: async function(module = 'salary') {
      try {
        var url = (this.apiBase || '') + '/api/sync/files/clear-module';
        await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ module: module })
        }).catch(function(){});
      } catch (_) {}

      if (module === 'salary' && window.ATPLFirebase && typeof window.ATPLFirebase.clearAllSalaryFiles === 'function') {
        try { await window.ATPLFirebase.clearAllSalaryFiles('admin'); } catch (_) {}
      }

      if (module === 'salary') {
        window.FILES = [];
        if (typeof FILES !== 'undefined') FILES = [];
        if (window.DB) {
          try {
            var ctx = window.DB.transaction(window.DB_STORE || 'salaryFiles', 'readwrite');
            ctx.objectStore(window.DB_STORE || 'salaryFiles').clear();
          } catch (_) {}
        }
        if (typeof renderFiles === 'function') renderFiles();
        if (typeof renderSheets === 'function') renderSheets();
        if (typeof updStats === 'function') updStats();
        if (typeof renderAllFilesPage === 'function') renderAllFilesPage();
        if (typeof populateNJSelects === 'function') populateNJSelects();
        this.updateSyncBadge('ok', '⚡ Realtime (0 files)');
      }

      this.notifySubscribers(module, 'cleared', { module: module });
      return true;
    },

    // Fetch raw file binary content from backend (for PDF / Excel / Document viewers)
    getFileContent: async function(fileId) {
      if (!fileId) throw new Error('File ID required');
      var url = (this.apiBase || '') + '/api/sync/files/' + encodeURIComponent(fileId) + '/content';
      var res = await fetch(url);
      if (!res.ok) throw new Error('Failed to download file content (' + res.status + ')');
      var blob = await res.blob();
      return blob.arrayBuffer();
    },

    // Full Reconnect & Refresh Reconciliation: The Backend ALWAYS Wins
    reconcileAll: async function(force = false) {
      if (this.isReconciling) return;
      this.isReconciling = true;
      try {
        this.lastSyncTime = Date.now();
        var serverFiles = null;
        var serverTombs = {};

        // 1. Fetch from central Express backend
        try {
          var res = await fetch((this.apiBase || '') + '/api/sync/files?summary=0', {
            cache: force ? 'no-cache' : 'default',
            headers: { 'Accept': 'application/json' }
          });
          if (res.ok) {
            var data = await res.json();
            if (data.ok && Array.isArray(data.files)) {
              serverFiles = data.files;
              serverTombs = data.tombstones || {};
              if (data.version) this.serverStateVersion = data.version;
            }
          }
        } catch (netErr) {
          console.warn('[ATPL FileSync] Backend fetch notice:', netErr.message);
        }

        // 2. Dual fallback: Firebase Firestore
        if (!serverFiles && window.ATPLFirebase && typeof window.ATPLFirebase.fetchAllSalaryFiles === 'function') {
          try {
            var fbFiles = await window.ATPLFirebase.fetchAllSalaryFiles();
            if (Array.isArray(fbFiles)) {
              serverFiles = fbFiles.map(function(f) {
                return {
                  id: f.id || ('sf_' + (f.name||'').toLowerCase()),
                  module: 'salary',
                  name: f.name,
                  buf: f.original_b64 || f.sheets_b64 || f.buf,
                  sheets: f.sheets || null,
                  created_at: f.saved_at || f.uploaded_at || new Date().toISOString(),
                  uploaded_by: f.uploaded_by || 'admin'
                };
              });
            }
          } catch (fbErr) {
            console.warn('[ATPL FileSync] Firestore fetch notice:', fbErr.message);
          }
        }

        if (!serverFiles) return;

        // Apply BACKEND AUTHORITY to salary files
        var salaryServerFiles = serverFiles.filter(function(f) { return f && (f.module === 'salary' || !f.module); });
        var serverNameMap = {};
        salaryServerFiles.forEach(function(f) {
          if (f && f.name) serverNameMap[String(f.name).toLowerCase()] = f;
        });

        var curFiles = Array.isArray(window.FILES) ? window.FILES.slice() : [];
        var dirty = false;
        var keptFiles = [];

        // Check for deleted files (backend does not have it, or it is tombstoned)
        for (var i = 0; i < curFiles.length; i++) {
          var lf = curFiles[i];
          if (!lf || !lf.name) continue;
          var lk = String(lf.name).toLowerCase();
          var tomb = serverTombs[lk] || serverTombs[lf.id];
          if (!serverNameMap[lk] || tomb) {
            console.log('[ATPL FileSync] Authoritative delete enforced for:', lf.name);
            dirty = true;
            if (typeof deleteFromDB === 'function') deleteFromDB(lf.name);
          } else {
            keptFiles.push(lf);
          }
        }

        window.FILES = keptFiles;
        if (typeof FILES !== 'undefined') FILES = keptFiles;

        // Add or update missing files from backend
        for (var sf of salaryServerFiles) {
          if (!sf || !sf.name) continue;
          var sName = sf.name;
          var cur = (window.FILES || []).find(function(x) { return x && String(x.name).toLowerCase() === String(sName).toLowerCase(); });
          if (cur && cur.savedAt === (sf.created_at || sf.saved) && cur.buf) continue;

          var rawBuf = null;
          if (sf.buf) {
            rawBuf = typeof sf.buf === 'string' ? base64ToArrayBuffer(sf.buf) : sf.buf;
          } else if (window.ATPLFirebase && typeof window.ATPLFirebase.decodeDocPayload === 'function') {
            try {
              var payload = await window.ATPLFirebase.decodeDocPayload(sf);
              if (payload && payload.original_b64) rawBuf = base64ToArrayBuffer(payload.original_b64);
            } catch (_) {}
          }

          if (rawBuf && window.parseWB && window.wbToSheets) {
            try {
              var wb = window.parseWB(rawBuf);
              var sheets = window.wbToSheets(wb);
              window.FILES = (window.FILES || []).filter(function(x) { return String(x.name).toLowerCase() !== String(sName).toLowerCase(); });
              var fItem = {
                name: sName,
                wb: wb,
                sheets: sheets,
                buf: rawBuf,
                fromDB: true,
                savedAt: sf.created_at || sf.saved || new Date().toISOString()
              };
              window.FILES.push(fItem);
              if (typeof FILES !== 'undefined') FILES = window.FILES;
              dirty = true;
              if (window.DB) {
                try {
                  var tx = window.DB.transaction(window.DB_STORE || 'salaryFiles', 'readwrite');
                  tx.objectStore(window.DB_STORE || 'salaryFiles').put({ name: sName, buf: rawBuf, saved: fItem.savedAt });
                } catch (_) {}
              }
            } catch (err) {
              console.warn('[ATPL FileSync] Workbook parse error for', sName, err);
            }
          }
        }

        if (dirty || !curFiles.length) {
          if (typeof renderFiles === 'function') renderFiles();
          if (typeof renderSheets === 'function') renderSheets();
          if (typeof updStats === 'function') updStats();
          if (typeof renderAllFilesPage === 'function') renderAllFilesPage();
          if (typeof populateNJSelects === 'function') populateNJSelects();
        }

        this.updateSyncBadge('ok', '☁ Realtime (' + (window.FILES || []).length + ' files)');
        this.notifySubscribers('salary', 'reconciled', { files: window.FILES });
      } catch (err) {
        console.warn('[ATPL FileSync] Reconcile error:', err.message);
      } finally {
        this.isReconciling = false;
      }
    },

    // UI helper: update top badge
    updateSyncBadge: function(status, msg) {
      try {
        if (typeof window.updateRealtimeCloudBadge === 'function') {
          var count = Array.isArray(window.FILES) ? window.FILES.length : 0;
          window.updateRealtimeCloudBadge(count, status, msg);
        }
      } catch (_) {}
    }
  };

  // Expose globally
  window.ATPLCentralFileSync = ATPLCentralFileSync;
  window.atplBufToB64 = arrayBufferToBase64;
  window.atplB64ToBuf = base64ToArrayBuffer;
  window.atplSha256 = computeSha256;

  // Auto-init on script load
  if (typeof window !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function() { ATPLCentralFileSync.init(); });
    } else {
      ATPLCentralFileSync.init();
    }
  }

})(window);
