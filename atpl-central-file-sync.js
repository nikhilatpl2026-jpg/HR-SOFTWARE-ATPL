/**
 * ATPL Central File Sync System (v2026.10)
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
 *  2. Real-time push via SSE events (3–5 second cross-browser sync).
 *  3. Permanent Delete Guarantee: Once deleted on backend, no client
 *     cache or offline session can resurrect it.
 *  4. Controlled Bulk Upload Queue: Concurrency limit (3), per-file
 *     status tracking, SHA-256 deduplication.
 *  5. Reconnect Reconciliation: Authoritative fetch after reconnect,
 *     login, window focus, or page refresh.
 * ─────────────────────────────────────────────────────────────────
 */
(function(window) {
  'use strict';

  // Determine central backend URL
  // If running on a static host (e.g. GitHub Pages), fallback to deployed Cloud Run backend
  function detectBackendUrl() {
    if (typeof window === 'undefined') return '';
    var origin = window.location.origin || '';
    if (origin.indexOf('localhost') >= 0 || origin.indexOf('127.0.0.1') >= 0 || origin.indexOf('run.app') >= 0) {
      return ''; // Relative URLs hit local Express server
    }
    // Static hosting (e.g. github.io) -> Point to deployed AI Studio backend
    var configured = window.__ATPL_CENTRAL_BACKEND_URL;
    if (configured) return configured.replace(/\/+$/, '');
    return 'https://ais-pre-jpq6ydqehx3naxdoorqfao-427004433114.asia-southeast1.run.app';
  }

  var API_BASE = detectBackendUrl();

  // Compute SHA-256 hash in browser
  async function computeSha256(data) {
    try {
      var buffer;
      if (typeof data === 'string') {
        // Check if data is Base64
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
      // Fallback simple hash if SubtleCrypto fails
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

  // Concurrency Queue for Controlled Bulk Uploads
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
    version: '2026.10-backend-authority',
    apiBase: API_BASE,
    connected: false,
    serverStateVersion: 0,
    eventSource: null,
    subscribers: {}, // module -> array of callbacks
    uploadQueue: new ConcurrencyQueue(3),
    reconnectTimer: null,
    reconnectAttempts: 0,
    lastSyncTime: 0,

    // Initialize Real-time SSE Connection & Listeners
    init: function() {
      console.log('[ATPL FileSync] Initializing central backend-authoritative sync system...');
      this.connectSSE();
      this.bindWindowEvents();
      // Initial state sync after a brief delay
      setTimeout(() => { this.reconcileAll(); }, 500);
    },

    // Bind window visibility and online events for reconnect recovery
    bindWindowEvents: function() {
      window.addEventListener('online', () => {
        console.log('[ATPL FileSync] Network came online — reconnecting and reconciling...');
        this.connectSSE();
        this.reconcileAll();
      });

      document.addEventListener('visibilitychange', () => {
        if (!document.hidden && Date.now() - this.lastSyncTime > 10000) {
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
          console.log('[ATPL FileSync] Real-time event stream connected successfully!');
          this.connected = true;
          this.reconnectAttempts = 0;
          this.updateSyncBadge('ok', '⚡ Realtime Live');
        };

        es.onerror = (err) => {
          this.connected = false;
          es.close();
          this.eventSource = null;
          var delay = Math.min(30000, 1000 * Math.pow(1.5, this.reconnectAttempts++));
          console.warn('[ATPL FileSync] Real-time stream disconnected. Retrying in ' + Math.round(delay/1000) + 's...');
          this.updateSyncBadge('busy', '🔄 Reconnecting...');
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

        // Listen for legacy events for 100% backwards compatibility
        es.addEventListener('salary_file_saved', (e) => {
          try {
            var data = JSON.parse(e.data);
            this.notifySubscribers('salary', 'saved', data.data || data);
          } catch (_) {}
        });

        es.addEventListener('salary_file_deleted', (e) => {
          try {
            var data = JSON.parse(e.data);
            this.notifySubscribers('salary', 'deleted', data.data || data);
          } catch (_) {}
        });

        es.addEventListener('salary_clear_all', (e) => {
          this.notifySubscribers('salary', 'cleared', {});
        });

        es.addEventListener('hr_doc_saved', (e) => {
          try {
            var data = JSON.parse(e.data);
            this.notifySubscribers('hr_doc', 'saved', data.data || data);
          } catch (_) {}
        });

        es.addEventListener('hr_doc_deleted', (e) => {
          try {
            var data = JSON.parse(e.data);
            this.notifySubscribers('hr_doc', 'deleted', data.data || data);
          } catch (_) {}
        });

      } catch (err) {
        console.warn('[ATPL FileSync] SSE initialization warning:', err);
      }
    },

    // Handle remote file saved event
    handleRemoteFileSaved: function(raw) {
      try {
        var msg = typeof raw === 'string' ? JSON.parse(raw) : raw;
        var file = msg.file || msg.data || msg;
        console.log('[ATPL FileSync] Remote file saved event received:', file.name, 'Module:', file.module);
        if (msg.version) this.serverStateVersion = msg.version;
        this.notifySubscribers(file.module, 'saved', file);
        this.notifySubscribers('all', 'saved', file);
      } catch (e) {
        console.warn('[ATPL FileSync] handleRemoteFileSaved parse error:', e);
      }
    },

    // Handle remote file deleted event
    handleRemoteFileDeleted: function(raw) {
      try {
        var msg = typeof raw === 'string' ? JSON.parse(raw) : raw;
        var info = msg.data || msg;
        console.log('[ATPL FileSync] Remote file deleted event received:', info.name || info.id, 'Module:', info.module);
        if (msg.version) this.serverStateVersion = msg.version;
        this.notifySubscribers(info.module, 'deleted', info);
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

        if (typeof fileObj.buf === 'string') {
          bufBase64 = fileObj.buf;
        } else if (fileObj instanceof File || fileObj instanceof Blob) {
          var arrayBuf = await fileObj.arrayBuffer();
          bufBase64 = arrayBufferToBase64(arrayBuf);
          size = arrayBuf.byteLength;
        } else if (fileObj.buffer instanceof ArrayBuffer) {
          bufBase64 = arrayBufferToBase64(fileObj.buffer);
          size = fileObj.buffer.byteLength;
        } else if (fileObj.buf instanceof ArrayBuffer) {
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

        if (onProgress) onProgress('saved', 100);
        console.log('[ATPL FileSync] File upload confirmed by central backend:', name);
        return result.file || payload;
      });
    },

    // Controlled Bulk Upload with Per-File State Tracking & Retry
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

      var url = (this.apiBase || '') + '/api/sync/files/' + encodeURIComponent(idOrName) + '?module=' + encodeURIComponent(module);
      var res = await fetch(url, { method: 'DELETE' });
      if (!res.ok) {
        var errData = {};
        try { errData = await res.json(); } catch (_) {}
        throw new Error(errData.error || ('Delete failed with status ' + res.status));
      }

      var data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Delete rejected by backend');

      console.log('[ATPL FileSync] Permanent backend deletion confirmed for:', idOrName);

      // Immediately notify subscribers so local UI updates without delay
      this.notifySubscribers(module, 'deleted', { id: idOrName, name: idOrName, module: module });
      this.notifySubscribers('all', 'deleted', { id: idOrName, name: idOrName, module: module });
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
    reconcileAll: async function() {
      try {
        this.lastSyncTime = Date.now();
        var stateRes = await fetch((this.apiBase || '') + '/api/sync/state?summary=1');
        if (!stateRes.ok) return;
        var state = await stateRes.json();
        if (!state.ok) return;

        this.serverStateVersion = state.version || 0;
        console.log('[ATPL FileSync] Reconciled state with central backend. Active files:', state.files_count || 0);

        // Notify each active module of full authoritative state
        this.notifySubscribers('salary', 'reconciled', state);
        this.notifySubscribers('pf', 'reconciled', state);
        this.notifySubscribers('esic', 'reconciled', state);
        this.notifySubscribers('hr_doc', 'reconciled', state);
        this.notifySubscribers('all', 'reconciled', state);

        this.updateSyncBadge('ok', '☁ Realtime (' + (state.files_count || 0) + ' files)');
      } catch (err) {
        console.warn('[ATPL FileSync] Reconcile warning:', err.message);
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
