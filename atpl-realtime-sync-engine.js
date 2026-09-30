/**
 * ATPL Real-Time Sync Engine (Backend-Authoritative V5)
 * ─────────────────────────────────────────────────────────────────
 * Fully connects ATPLFirebase and ATPLRealtimeSync interfaces directly
 * to the centralized Node.js/Express backend file repository and SSE engine.
 * 
 * Replaces expired 3rd-party services with our dedicated central backend.
 * Provides 100% permanent cross-browser synchronization for:
 *   - Salary audit sheets
 *   - HR documents
 *   - PF / ESIC Challans
 *   - All Files Library
 * ─────────────────────────────────────────────────────────────────
 */
window.ATPLRealtimeSync = (function() {
  'use strict';

  function getBaseUrl() {
    if (window.ATPLCentralFileSync && window.ATPLCentralFileSync.apiBase != null) {
      return window.ATPLCentralFileSync.apiBase;
    }
    var origin = window.location.origin || '';
    if (origin.indexOf('localhost') >= 0 || origin.indexOf('127.0.0.1') >= 0 || origin.indexOf('run.app') >= 0) {
      return '';
    }
    return 'https://ais-pre-jpq6ydqehx3naxdoorqfao-427004433114.asia-southeast1.run.app';
  }

  function init() {
    console.log('[ATPL Realtime Sync Engine V5] Initializing with central backend authority...');

    window.ATPLFirebase = {
      // ── Salary Files ──
      fetchAllSalaryFiles: async function() {
        try {
          var res = await fetch(getBaseUrl() + '/api/sync/files?module=salary&summary=0');
          if (!res.ok) throw new Error('Salary fetch failed: ' + res.status);
          var json = await res.json();
          var files = json.files || [];
          return files.map(d => ({
            id: d.id,
            name: d.name,
            original_b64: d.buf || '',
            saved_at: d.created_at || d.saved || d.updated_at,
            uploaded_by: d.uploaded_by || 'admin',
            is_gzip: true
          }));
        } catch (e) {
          console.warn('[ATPL Sync] fetchAllSalaryFiles fallback:', e.message);
          try {
            var r2 = await fetch(getBaseUrl() + '/api/sync/state?summary=0');
            var j2 = await r2.json();
            var sf = j2.salary_files || [];
            return sf.map(d => ({
              name: d.name,
              original_b64: d.buf || '',
              saved_at: d.saved || new Date().toISOString(),
              uploaded_by: d.uploaded_by || 'admin',
              is_gzip: true
            }));
          } catch (_) {
            return [];
          }
        }
      },

      decodeDocPayload: async function(doc) {
        return { original_b64: doc.original_b64 || doc.buf || '' };
      },

      saveSalaryFile: async function(name, payloadObj, meta) {
        try {
          var b64 = payloadObj.original_b64 || payloadObj.buf || '';
          var res = await fetch(getBaseUrl() + '/api/sync/files', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              module: 'salary',
              category: 'audit',
              name: name,
              buf: b64,
              size: b64.length,
              uploaded_by: meta && meta.uploaded_by ? meta.uploaded_by : 'admin',
              created_at: meta && meta.saved_at ? meta.saved_at : new Date().toISOString()
            })
          });
          return res.ok;
        } catch (e) {
          console.error('[ATPL Sync] saveSalaryFile error:', e);
          return false;
        }
      },

      deleteSalaryFile: async function(name, user) {
        try {
          var res = await fetch(getBaseUrl() + '/api/sync/files/' + encodeURIComponent(name) + '?module=salary', {
            method: 'DELETE'
          });
          return res.ok;
        } catch (e) {
          console.error('[ATPL Sync] deleteSalaryFile error:', e);
          return false;
        }
      },

      fetchAllTombstones: async function() {
        try {
          var res = await fetch(getBaseUrl() + '/api/sync/state?summary=1');
          if (!res.ok) return [];
          var json = await res.json();
          var tombs = json.tombstones || json.salary_tombstones || {};
          return Object.values(tombs).map(t => ({
            name: t.name,
            id: t.id,
            deleted_at: t.deleted_at || new Date().toISOString()
          }));
        } catch (e) {
          return [];
        }
      },

      // ── HR Documents ──
      fetchAllHrDocs: async function() {
        try {
          var res = await fetch(getBaseUrl() + '/api/sync/files?module=hr_doc&summary=0');
          if (!res.ok) throw new Error('HR docs fetch failed');
          var json = await res.json();
          var files = json.files || [];
          return files.map(d => {
            var doc = d.meta || {};
            doc.id = d.id;
            doc.document_name = doc.document_name || d.name;
            doc.file_name = doc.file_name || d.name;
            doc.file_data = doc.file_data || d.buf;
            doc.is_gzip = true;
            return doc;
          });
        } catch (e) {
          try {
            var r2 = await fetch(getBaseUrl() + '/api/sync/hr-docs');
            var j2 = await r2.json();
            return j2.records || [];
          } catch (_) {
            return [];
          }
        }
      },

      decodeHrPayload: async function(doc) {
        return doc;
      },

      saveHrDoc: async function(doc) {
        try {
          var res = await fetch(getBaseUrl() + '/api/sync/files', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: doc.id,
              module: 'hr_doc',
              category: doc.doc_type || 'HR Policy',
              name: doc.file_name || doc.document_name || doc.id,
              buf: doc.file_data || '',
              meta: doc,
              uploaded_by: 'admin',
              created_at: doc.updated_at || new Date().toISOString()
            })
          });
          return res.ok;
        } catch (e) {
          console.error('[ATPL Sync] saveHrDoc error:', e);
          return false;
        }
      },

      deleteHrDoc: async function(id, name, user) {
        try {
          var res = await fetch(getBaseUrl() + '/api/sync/files/' + encodeURIComponent(id) + '?module=hr_doc', {
            method: 'DELETE'
          });
          return res.ok;
        } catch (e) {
          console.error('[ATPL Sync] deleteHrDoc error:', e);
          return false;
        }
      },

      fetchAllHrTombstones: async function() {
        try {
          var res = await fetch(getBaseUrl() + '/api/sync/state?summary=1');
          if (!res.ok) return [];
          var json = await res.json();
          var tombs = json.hr_tombstones || {};
          return Object.values(tombs).map(t => ({
            id: t.id,
            deleted_at: t.deleted_at || new Date().toISOString()
          }));
        } catch (e) {
          return [];
        }
      },

      clearAllSalaryFiles: async function() {
        try {
          var res = await fetch(getBaseUrl() + '/api/sync/files/clear-module', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ module: 'salary' })
          });
          return res.ok;
        } catch (e) {
          return false;
        }
      },

      // Subscriptions no-ops (handled centrally via SSE in ATPLCentralFileSync)
      subscribeSalaryFiles: function(cb) {
        if (window.ATPLCentralFileSync) {
          return window.ATPLCentralFileSync.subscribe('salary', function(ev, data) {
            if (typeof cb === 'function') cb(ev, data);
          });
        }
        return function() {};
      },
      subscribeTombstones: function() { return function() {}; },
      subscribeHrDocs: function(cb) {
        if (window.ATPLCentralFileSync) {
          return window.ATPLCentralFileSync.subscribe('hr_doc', function(ev, data) {
            if (typeof cb === 'function') cb(ev, data);
          });
        }
        return function() {};
      },
      subscribeHrTombstones: function() { return function() {}; }
    };

    console.log('[ATPL Realtime Sync Engine V5] ATPLFirebase successfully mounted to central backend authority.');
  }

  return { init: init };
})();

if (typeof window !== 'undefined') {
  window.ATPLRealtimeSync.init();
}
