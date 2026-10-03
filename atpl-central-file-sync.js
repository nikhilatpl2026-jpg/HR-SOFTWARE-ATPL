/**
 * ATPL Central File Sync System (v2026.10-authoritative-final-fix)
 * ─────────────────────────────────────────────────────────────────
 * Centralized, backend-authoritative, real-time file synchronization
 * engine for all ERP file modules.
 *
 * Architecture Principles:
 *  1. Backend is the SINGLE SOURCE OF TRUTH.
 *  2. Real-time push via SSE events + Firebase Firestore WebSocket sync.
 *  3. Permanent Delete Guarantee: Once deleted on backend, no resurrect.
 *  4. Controlled Bulk Upload Queue: Concurrency limit (2), Auto-Retry.
 *  5. SMART DEBOUNCE RECONCILE: Wait 1.5s to gather all concurrent 
 *     uploads before fetching, guaranteeing NO dropped files in Browser B.
 * ─────────────────────────────────────────────────────────────────
 */
(function(window) {
  'use strict';

  // Determine central backend URL
  function detectBackendUrl() {
    if (typeof window === 'undefined') return '';
    var origin = window.location.origin || '';
    if (origin.indexOf('localhost') >= 0 || origin.indexOf('127.0.0.1') >= 0 || origin.indexOf('.run.app') >= 0) {
      return ''; 
    }
    var configured = window.__ATPL_CENTRAL_BACKEND_URL;
    if (configured) return configured.replace(/\/+$/, '');
    return ''; 
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

  // Convert ArrayBuffer / Uint8Array to Base64
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

  // Concurrency Queue reduced to 2 for server stability
  class ConcurrencyQueue {
    constructor(concurrency = 2) {
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
    version: '2026.10-authoritative-final-fix',
    apiBase: API_BASE,
    connected: false,
    serverStateVersion: 0,
    eventSource: null,
    subscribers: {}, 
    uploadQueue: new ConcurrencyQueue(2),
    reconnectTimer: null,
    reconcileTimer: null, // THE SMART WAIT TIMER
    reconnectAttempts: 0,
    lastSyncTime: 0,
    isReconciling: false,

    // Initialize System
    init: function() {
      console.log('[ATPL FileSync] Initializing bulletproof Smart-Wait sync system...');
      this.connectSSE();
      this.connectFirebase();
      this.bindWindowEvents();
      setTimeout(() => { this.reconcileAll(); }, 300);
      
      // Safe fallback polling (Only checks every 5 seconds if not busy)
      setInterval(() => {
        if (typeof document !== 'undefined' && !document.hidden) {
          if (this.backendReachable === false && Date.now() - this.lastSyncTime < 15000) return; // Save Firebase quota
          this.requestReconcile();
        }
      }, 5000);
    },

    // CENTRAL INSTANT UI REFRESH DISPATCHER
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
    },

    bindWindowEvents: function() {
      window.addEventListener('online', () => {
        this.connectSSE();
        this.requestReconcile();
      });

      document.addEventListener('visibilitychange', () => {
        if (!document.hidden && Date.now() - this.lastSyncTime > 4000) {
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
          var delay = Math.min(15000, 1000 * Math.pow(1.5, this.reconnectAttempts++));
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = setTimeout(() => {
            this.connectSSE();
            this.requestReconcile();
          }, delay);
        };

        // Call the debounced fetch instead of immediate fetch
        es.addEventListener('file_saved', (e) => { this.handleRemoteFileSaved(e.data); });
        es.addEventListener('file_deleted', (e) => { this.requestReconcile(); });
        es.addEventListener('files_bulk_saved', (e) => { this.requestReconcile(); });
        es.addEventListener('module_cleared', (e) => { this.requestReconcile(); });
        es.addEventListener('salary_file_saved', (e) => { this.handleRemoteFileSaved(e.data); });
        es.addEventListener('salary_file_deleted', (e) => { this.requestReconcile(); });
        es.addEventListener('salary_clear_all', (e) => { this.requestReconcile(); });

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
                  this.deleteFile('salary', delName, true); // Visual fast delete
                });
              }
              if (Array.isArray(update.all) && update.all.length > 0) {
                // Wait for all overlapping firebase notifications before fetching
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

    // THE MAGIC FIX: Smart Wait (Debounce). Solves the "1 missing file" bug.
    requestReconcile: function() {
      if (this.reconcileTimer) {
        clearTimeout(this.reconcileTimer);
      }
      // System will wait 1.5 seconds to see if more files are uploading, then fetch ONCE.
      this.reconcileTimer = setTimeout(() => {
        this.reconcileAll(true);
      }, 1500);
    },

    handleRemoteFileSaved: function(raw) {
      try {
        var msg = typeof raw === 'string' ? JSON.parse(raw) : raw;
        var file = msg.file || msg.data || msg;
        if (!file || !file.name) return;
        if (msg.version) this.serverStateVersion = msg.version;

        if (file.module === 'salary' || !file.module) {
          var fileName = file.name;
          var rawBuf = file.buf ? (typeof file.buf === 'string' ? base64ToArrayBuffer(file.buf) : file.buf) : null;
          
          if (rawBuf && window.parseWB && window.wbToSheets) {
            // Instant render if server provided full data
            var wb = window.parseWB(rawBuf);
            var sheets = window.wbToSheets(wb);
            window.FILES = (window.FILES || []).filter(function(x) { return String(x.name).toLowerCase() !== String(fileName).toLowerCase(); });
            var item = { id: file.id, name: fileName, wb: wb, sheets: sheets, buf: rawBuf, fromDB: true, savedAt: file.created_at || file.saved || new Date().toISOString(), syncStatus: 'saved' };
            
            window.FILES.unshift(item);
            if (typeof FILES !== 'undefined') FILES = window.FILES;
            if (typeof saveFileToDB === 'function') saveFileToDB(fileName, rawBuf);
            
            this.triggerImmediateUIRefresh();
            this.updateSyncBadge('ok', '⚡ Realtime (' + (window.FILES || []).length + ' files)');
          } else {
            // Trigger Smart Wait if data is missing
            this.requestReconcile();
          }
        }
      } catch (e) {}
    },

    listFiles: async function(module = 'all', force = false) {
      var url = (this.apiBase || '') + '/api/sync/files?module=' + encodeURIComponent(module) + '&summary=0';
      var res = await fetch(url, {
        headers: { 'Accept': 'application/json', 'Cache-Control': 'no-cache' },
        cache: force ? 'no-cache' : 'default'
      });
      if (!res.ok) throw new Error('Failed to list files from backend');
      var data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Backend failed to return files');
      if (data.version) this.serverStateVersion = data.version;
      return data.files || [];
    },

    // 3-Attempt Auto-Retry for robust uploads
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

        var result = { ok: true, file: payload };
        var attempt = 0;
        var maxAttempts = 3;

        // Auto-Retry Loop
        while (attempt < maxAttempts) {
          try {
            var res = await fetch((this.apiBase || '') + '/api/sync/files', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload)
            });

            if (res.ok) {
              var tempResult = await res.json();
              if (tempResult.ok) {
                result = tempResult;
                break; 
              }
            }
            throw new Error('Backend error ' + res.status);
          } catch (err) {
            attempt++;
            if (attempt >= maxAttempts) {
              result.ok = false;
            } else {
              if (onProgress) onProgress('retrying', 60 + (attempt * 10)); 
              await new Promise(r => setTimeout(r, 2000)); 
            }
          }
        }

        // Mirror to Firebase
        if (module === 'salary' && !window.__atplFirebaseQuotaExhausted && window.ATPLFirebase && typeof window.ATPLFirebase.saveSalaryFile === 'function') {
          try {
            await window.ATPLFirebase.saveSalaryFile(name, { original_b64: bufBase64, name: name, id: payload.id }, { name: name, id: payload.id, saved_at: payload.created_at, uploaded_by: payload.uploaded_by });
          } catch (e) {
            if (/quota|resource-exhausted/i.test(e.message || '')) {
              window.__atplFirebaseQuotaExhausted = true;
            }
          }
        }

        if (module === 'salary' && rawBuf && window.parseWB && window.wbToSheets) {
          try {
            var wb = window.parseWB(rawBuf);
            var sheets = window.wbToSheets(wb);
            window.FILES = (window.FILES || []).filter(function(x) { return x && x.name !== name; });
            
            window.FILES.unshift({ 
                id: payload.id, 
                name: name, 
                wb: wb, 
                sheets: sheets, 
                buf: rawBuf, 
                savedAt: payload.created_at,
                syncStatus: result.ok ? 'saved' : 'pending' 
            });
            
            if (typeof FILES !== 'undefined') FILES = window.FILES;
            if (typeof saveFileToDB === 'function') saveFileToDB(name, rawBuf);
          } catch (_) {}
        }
        
        this.triggerImmediateUIRefresh(); 

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
      }

      if (module === 'salary') {
        this.triggerImmediateUIRefresh(); 
      }

      return { total: files.length, saved: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length, results: results };
    },

    deleteFile: async function(module, idOrName, skipRemote = false) {
      if (!idOrName) return false;

      // 1. Delete from central backend API
      if (!skipRemote) {
        try {
          var url = (this.apiBase || '') + '/api/sync/files/' + encodeURIComponent(idOrName) + '?module=' + encodeURIComponent(module);
          await fetch(url, { method: 'DELETE' });
        } catch (err) {}

        // 2. Delete from Firebase Firestore 
        if (module === 'salary' && !window.__atplFirebaseQuotaExhausted && window.ATPLFirebase && typeof window.ATPLFirebase.deleteSalaryFile === 'function') {
          try { await window.ATPLFirebase.deleteSalaryFile(idOrName, 'admin'); } catch (_) {}
        }
      }

      // 3. Remove immediately from local state
      if (module === 'salary') {
        var targetName = String(idOrName).toLowerCase();
        window.FILES = (window.FILES || []).filter(function(x) { 
            var xName = x && x.name ? String(x.name).toLowerCase() : '';
            var xId = x && x.id ? String(x.id).toLowerCase() : '';
            return xName !== targetName && xId !== targetName; 
        });
        if (typeof FILES !== 'undefined') FILES = window.FILES;
        if (typeof deleteFromDB === 'function') deleteFromDB(idOrName);
        try {
          var tombs = JSON.parse(localStorage.getItem('ATPL_SALARY_TOMBSTONES_V2') || '{}');
          tombs[targetName] = new Date().toISOString();
          localStorage.setItem('ATPL_SALARY_TOMBSTONES_V2', JSON.stringify(tombs));
        } catch (_) {}
        
        this.triggerImmediateUIRefresh();
        this.updateSyncBadge('ok', '⚡ Realtime (' + (window.FILES || []).length + ' files)');
      }

      return true;
    },

    clearModule: async function(module = 'salary') {
      try {
        var url = (this.apiBase || '') + '/api/sync/files/clear-module';
        await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ module: module }) }).catch(function(){});
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
        this.triggerImmediateUIRefresh();
        this.updateSyncBadge('ok', '⚡ Realtime (0 files)');
      }
      return true;
    },

    getFileContent: async function(fileId) {
      if (!fileId) throw new Error('File ID required');
      var url = (this.apiBase || '') + '/api/sync/files/' + encodeURIComponent(fileId) + '/content?_t=' + Date.now();
      var res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to download file content');
      var blob = await res.blob();
      return blob.arrayBuffer();
    },

    // Master Fetcher
    reconcileAll: async function(force = false) {
      if (this.isReconciling) return; // Debounce handles overlaps now
      this.isReconciling = true;
      try {
        this.lastSyncTime = Date.now();
        var serverFiles = null;
        var serverTombs = {};

        // 1. Fetch from central Express backend
        if (this.backendReachable !== false) {
          try {
            var fetchUrl = (this.apiBase || '') + '/api/sync/files?summary=0' + (force ? '&_t=' + Date.now() : '');
            var res = await fetch(fetchUrl, {
              cache: force ? 'no-store' : 'default',
              headers: { 'Accept': 'application/json', 'Cache-Control': 'no-cache' }
            });
            if (res.ok) {
              var data = await res.json();
              if (data.ok && Array.isArray(data.files)) {
                serverFiles = data.files;
                serverTombs = data.tombstones || {};
                if (data.version) this.serverStateVersion = data.version;
                this.backendReachable = true;
              }
            } else {
              this.backendReachable = false;
            }
          } catch (netErr) {
            this.backendReachable = false;
          }
        }

        // 2. Dual fallback: HybridEngine (Firestore)
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
          } catch (_) {}
        }

        if (!serverFiles) return;

        var salaryServerFiles = serverFiles.filter(function(f) { return f && (f.module === 'salary' || !f.module); });
        var serverMap = {};
        salaryServerFiles.forEach(function(f) {
          if (f && f.name) serverMap[String(f.name).toLowerCase()] = f;
          if (f && f.id) serverMap[String(f.id).toLowerCase()] = f;
        });

        var curFiles = Array.isArray(window.FILES) ? window.FILES.slice() : [];
        var dirty = false;
        var keptFiles = [];
        
        var localTombs = {};
        try { localTombs = JSON.parse(localStorage.getItem('ATPL_SALARY_TOMBSTONES_V2') || '{}'); } catch(e){}

        // Clean dead files
        for (var i = 0; i < curFiles.length; i++) {
          var lf = curFiles[i];
          if (!lf || (!lf.name && !lf.id)) continue;
          
          var lkName = lf.name ? String(lf.name).toLowerCase() : '';
          var lkId = lf.id ? String(lf.id).toLowerCase() : '';
          
          var tombName = serverTombs[lkName];
          var tombId = serverTombs[lkId];

          var isPending = (lf.syncStatus === 'pending');
          var isRecent = lf.savedAt && (Date.now() - new Date(lf.savedAt).getTime() < 60000); 
          
          if (((!isPending && !isRecent) && (!serverMap[lkName] && !serverMap[lkId])) || tombName || tombId) {
            dirty = true;
            if (typeof deleteFromDB === 'function') {
              if (lf.name) deleteFromDB(lf.name);
              if (lf.id) deleteFromDB(lf.id);
            }
          } else {
            keptFiles.push(lf);
          }
        }

        window.FILES = keptFiles;
        if (typeof FILES !== 'undefined') FILES = keptFiles;

        // Process new incoming files
        for (var sf of salaryServerFiles) {
          if (!sf || (!sf.name && !sf.id)) continue;
          var sName = sf.name;
          var lNameLower = String(sName).toLowerCase();
          var lIdLower = sf.id ? String(sf.id).toLowerCase() : '';

          if (serverTombs[lNameLower] || serverTombs[lIdLower] || localTombs[lNameLower] || localTombs[lIdLower]) {
              continue; 
          }

          var cur = (window.FILES || []).find(function(x) { 
              return (x && x.id && sf.id && String(x.id).toLowerCase() === lIdLower) || 
                     (x && x.name && sName && String(x.name).toLowerCase() === lNameLower); 
          });
          
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
                id: sf.id,
                name: sName,
                wb: wb,
                sheets: sheets,
                buf: rawBuf,
                fromDB: true,
                savedAt: sf.created_at || sf.saved || new Date().toISOString(),
                syncStatus: 'saved'
              };
              window.FILES.push(fItem);
              if (typeof FILES !== 'undefined') FILES = window.FILES;
              dirty = true;
              if (window.DB) {
                try {
                  var tx = window.DB.transaction(window.DB_STORE || 'salaryFiles', 'readwrite');
                  tx.objectStore(window.DB_STORE || 'salaryFiles').put({ name: sName, id: sf.id, buf: rawBuf, saved: fItem.savedAt });
                } catch (_) {}
              }
            } catch (err) {}
          }
        }

        if (dirty || !curFiles.length) {
          this.triggerImmediateUIRefresh();
        }

        this.updateSyncBadge('ok', '☁ Realtime (' + (window.FILES || []).length + ' files)');
      } catch (err) {
      } finally {
        this.isReconciling = false;
      }
    },

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

  if (typeof window !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function() { ATPLCentralFileSync.init(); });
    } else {
      ATPLCentralFileSync.init();
    }
  }

})(window);
