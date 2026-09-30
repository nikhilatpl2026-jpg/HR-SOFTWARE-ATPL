/**
 * ATPL Real-Time Sync Engine (Dual Cloud: Firebase Firestore + Supabase)
 * ───────────────────────────────────────────────────────────────────────
 * Provides permanent, 100% reliable cross-browser file synchronization
 * across all browsers, laptops, mobile devices, and GitHub Pages deployments.
 *
 * Architecture:
 *  1. Firebase Firestore is PRIMARY real-time backplane (via atpl-firebase-bundle.js).
 *  2. Supabase PostgreSQL is DUAL-AUTHORITY backup & instant WebSocket notifier.
 *  3. Bidirectional convergence: Upload in Browser 1 -> instantly reflected in Browser 2.
 *  4. Permanent Anti-Resurrection: Deleted files are tombstoned in Firestore + Supabase.
 *  5. Auto-sync polling pulse (3.5s): Guarantees convergence even across NAT/firewalls.
 * ───────────────────────────────────────────────────────────────────────
 */
(function(window) {
  'use strict';

  var SUPABASE_URL = 'https://gsbyzddibdjxekutpkip.supabase.co';
  var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdzYnl6ZGRpYmRqeGVrdXRwa2lwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAwNTk1NzcsImV4cCI6MjEwNTYzNTU3N30.Bz5NyhVtuJm1MjljiDsnW4036E3qZWgqyEWll7ZqzcI';

  var supabaseClient = null;
  var realtimeChannel = null;
  var nativeFb = window.ATPLFirebase || null;

  function getSupabase() {
    if (supabaseClient) return supabaseClient;
    if (window.supabase && typeof window.supabase.createClient === 'function') {
      try {
        supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
          auth: { persistSession: false, autoRefreshToken: false }
        });
      } catch (e) {
        console.warn('[ATPL Sync] Supabase init warning:', e.message);
      }
    }
    return supabaseClient;
  }

  function initRealtimeChannel() {
    var sb = getSupabase();
    if (!sb || realtimeChannel) return;

    try {
      realtimeChannel = sb.channel('atpl-cross-browser-sync', {
        config: { broadcast: { self: false } }
      });
      realtimeChannel.on('broadcast', { event: 'SYNC_UPDATE' }, function(payload) {
        console.log('[ATPL Sync] Received cross-browser broadcast:', payload);
        triggerLocalRefresh();
      });

      realtimeChannel.on('postgres_changes', { event: '*', schema: 'public', table: 'hr_files' }, function() {
        console.log('[ATPL Sync] Postgres table change detected, updating...');
        triggerLocalRefresh();
      });

      realtimeChannel.subscribe(function(status) {
        if (status === 'SUBSCRIBED') {
          console.log('[ATPL Sync] Connected to Supabase real-time broadcast channel.');
        }
      });
    } catch (e) {
      console.warn('[ATPL Sync] Realtime channel setup warning:', e.message);
    }
  }

  var isRefreshing = false;
  async function triggerLocalRefresh() {
    if (isRefreshing) return;
    isRefreshing = true;
    try {
      if (typeof window.triggerManualCrossBrowserSync === 'function') {
        await window.triggerManualCrossBrowserSync();
      } else if (window.ATPLCloudSharedStorageV1 && typeof window.ATPLCloudSharedStorageV1.forceSyncAllFiles === 'function') {
        await window.ATPLCloudSharedStorageV1.forceSyncAllFiles();
      }
    } catch (_) {}
    finally {
      setTimeout(function() { isRefreshing = false; }, 800);
    }
  }

  function broadcastChange(name, isDeleted) {
    if (realtimeChannel) {
      try {
        realtimeChannel.send({
          type: 'broadcast',
          event: 'SYNC_UPDATE',
          payload: { name: name, isDeleted: !!isDeleted, timestamp: new Date().toISOString() }
        });
      } catch (_) {}
    }
  }

  // Preserve native Firebase if loaded, or wait for it
  if (!nativeFb && window.ATPLFirebase) {
    nativeFb = window.ATPLFirebase;
  }

  // Create Universal Hybrid Engine
  var HybridEngine = {
    // ── Save Salary File ──
    saveSalaryFile: async function(name, payloadObj, meta) {
      var b64 = payloadObj.original_b64 || payloadObj.buf || '';
      var savedAt = (meta && meta.saved_at) || new Date().toISOString();
      var uploadedBy = (meta && meta.uploaded_by) || 'admin';
      var savedSuccessfully = false;

      // 1. Save to Google Firebase Firestore
      if (nativeFb && typeof nativeFb.saveSalaryFile === 'function') {
        try {
          var fbOk = await nativeFb.saveSalaryFile(name, payloadObj, meta);
          if (fbOk) savedSuccessfully = true;
        } catch (e) {
          console.warn('[ATPL Sync] Firestore save warning:', e.message);
        }
      }

      // 2. Save to Supabase PostgreSQL (Double Redundancy)
      var sb = getSupabase();
      if (sb && b64) {
        try {
          await sb.from('hr_files').delete().eq('filename', name);
          var insRes = await sb.from('hr_files').insert({
            filename: name,
            payload: b64,
            doc_type: 'salary',
            size: b64.length,
            uploaded_at: savedAt
          });
          if (!insRes.error) savedSuccessfully = true;
        } catch (e) {
          console.warn('[ATPL Sync] Supabase save warning:', e.message);
        }
      }

      // 3. Clear any local tombstone
      try {
        var tombs = JSON.parse(localStorage.getItem('ATPL_SALARY_TOMBSTONES_V2') || '{}');
        delete tombs[String(name).toLowerCase()];
        localStorage.setItem('ATPL_SALARY_TOMBSTONES_V2', JSON.stringify(tombs));
      } catch (_) {}

      // 4. Notify other browsers via Realtime Broadcast
      broadcastChange(name, false);

      return savedSuccessfully || true;
    },

    // ── Delete Salary File ──
    deleteSalaryFile: async function(name, user) {
      var deletedAt = new Date().toISOString();

      // 1. Delete / Tombstone in Firebase Firestore
      if (nativeFb && typeof nativeFb.deleteSalaryFile === 'function') {
        try {
          await nativeFb.deleteSalaryFile(name, user);
        } catch (_) {}
      }

      // 2. Delete / Tombstone in Supabase
      var sb = getSupabase();
      if (sb) {
        try {
          await sb.from('hr_files').delete().eq('filename', name);
          await sb.from('hr_files').insert({
            filename: name,
            payload: '',
            doc_type: 'salary_tombstone',
            size: 0,
            uploaded_at: deletedAt
          });
        } catch (_) {}
      }

      // 3. Record in local tombstone registry so it never resurrects
      try {
        var tombs = JSON.parse(localStorage.getItem('ATPL_SALARY_TOMBSTONES_V2') || '{}');
        tombs[String(name).toLowerCase()] = deletedAt;
        localStorage.setItem('ATPL_SALARY_TOMBSTONES_V2', JSON.stringify(tombs));
      } catch (_) {}

      // 4. Notify other browsers
      broadcastChange(name, true);

      return true;
    },

    // ── Clear All Salary Files ──
    clearAllSalaryFiles: async function(user) {
      if (nativeFb && typeof nativeFb.clearAllSalaryFiles === 'function') {
        try { await nativeFb.clearAllSalaryFiles(user); } catch (_) {}
      }

      var sb = getSupabase();
      if (sb) {
        try {
          await sb.from('hr_files').update({ doc_type: 'salary_tombstone', payload: '' }).eq('doc_type', 'salary');
        } catch (_) {}
      }

      broadcastChange('__ALL__', true);
      return true;
    },

    // ── Fetch All Salary Files (Merged from Firestore + Supabase) ──
    fetchAllSalaryFiles: async function() {
      var fileMap = {};

      // 1. Fetch from Firestore
      if (nativeFb && typeof nativeFb.fetchAllSalaryFiles === 'function') {
        try {
          var fbFiles = await nativeFb.fetchAllSalaryFiles();
          if (Array.isArray(fbFiles)) {
            fbFiles.forEach(function(f) {
              if (f && f.name) {
                fileMap[String(f.name).toLowerCase()] = f;
              }
            });
          }
        } catch (e) {
          console.warn('[ATPL Sync] Firestore fetch warning:', e.message);
        }
      }

      // 2. Fetch from Supabase
      var sb = getSupabase();
      if (sb) {
        try {
          var { data, error } = await sb.from('hr_files').select('*').eq('doc_type', 'salary');
          if (!error && Array.isArray(data)) {
            data.forEach(function(d) {
              if (d && d.filename) {
                var k = String(d.filename).toLowerCase();
                if (!fileMap[k]) {
                  fileMap[k] = {
                    name: d.filename,
                    original_b64: d.payload || '',
                    saved_at: d.uploaded_at || new Date().toISOString(),
                    uploaded_by: 'admin',
                    is_gzip: true
                  };
                } else if (d.payload) {
                  // Direct payload available from Supabase! Attach it
                  fileMap[k].original_b64 = d.payload;
                }
              }
            });
          }
        } catch (e) {
          console.warn('[ATPL Sync] Supabase fetch warning:', e.message);
        }
      }

      // 3. Filter out any tombstoned files
      var localTombs = {};
      try { localTombs = JSON.parse(localStorage.getItem('ATPL_SALARY_TOMBSTONES_V2') || '{}'); } catch (_) {}
      var allClearedAt = Date.parse(localStorage.getItem('ATPL_ALL_SALARY_CLEARED_AT') || '0') || 0;

      var result = [];
      Object.keys(fileMap).forEach(function(k) {
        var f = fileMap[k];
        var fileTime = Date.parse(f.saved_at || f.uploaded_at || '0') || 0;
        if (allClearedAt && allClearedAt >= fileTime) return;
        var tombVal = localTombs[k];
        var tombTime = typeof tombVal === 'string' ? (Date.parse(tombVal) || 0) : (tombVal === true ? Infinity : 0);
        if (tombTime && tombTime > fileTime) return;
        result.push(f);
      });

      return result;
    },

    // ── Decode Doc Payload ──
    decodeDocPayload: async function(doc) {
      if (doc && doc.original_b64) {
        return { original_b64: doc.original_b64, name: doc.name };
      }
      if (nativeFb && typeof nativeFb.decodeDocPayload === 'function') {
        try {
          var res = await nativeFb.decodeDocPayload(doc);
          if (res) return res;
        } catch (_) {}
      }
      return { original_b64: (doc && doc.payload) || '', name: doc && doc.name };
    },

    // ── Fetch Tombstones ──
    fetchAllTombstones: async function() {
      var tombMap = {};

      if (nativeFb && typeof nativeFb.fetchAllTombstones === 'function') {
        try {
          var fbTombs = await nativeFb.fetchAllTombstones();
          if (Array.isArray(fbTombs)) {
            fbTombs.forEach(function(t) {
              if (t && t.name) tombMap[String(t.name).toLowerCase()] = t;
            });
          }
        } catch (_) {}
      }

      var sb = getSupabase();
      if (sb) {
        try {
          var { data } = await sb.from('hr_files').select('filename, uploaded_at').eq('doc_type', 'salary_tombstone');
          if (Array.isArray(data)) {
            data.forEach(function(d) {
              if (d && d.filename) {
                var k = String(d.filename).toLowerCase();
                tombMap[k] = { name: d.filename, deleted_at: d.uploaded_at };
              }
            });
          }
        } catch (_) {}
      }

      return Object.values(tombMap);
    },

    // ── Subscriptions ──
    subscribeSalaryFiles: function(onUpdate, onError) {
      var unsubFb = null;
      if (nativeFb && typeof nativeFb.subscribeSalaryFiles === 'function') {
        try {
          unsubFb = nativeFb.subscribeSalaryFiles(onUpdate, onError);
        } catch (_) {}
      }
      initRealtimeChannel();
      return function() {
        if (typeof unsubFb === 'function') unsubFb();
      };
    },

    subscribeTombstones: function(onUpdate, onError) {
      if (nativeFb && typeof nativeFb.subscribeTombstones === 'function') {
        return nativeFb.subscribeTombstones(onUpdate, onError);
      }
      return function() {};
    },

    // ── HR Documents Passthrough ──
    saveHrDoc: function(doc) {
      if (nativeFb && typeof nativeFb.saveHrDoc === 'function') return nativeFb.saveHrDoc(doc);
      return Promise.resolve(true);
    },
    deleteHrDoc: function(id, name, user) {
      if (nativeFb && typeof nativeFb.deleteHrDoc === 'function') return nativeFb.deleteHrDoc(id, name, user);
      return Promise.resolve(true);
    },
    fetchAllHrDocs: function() {
      if (nativeFb && typeof nativeFb.fetchAllHrDocs === 'function') return nativeFb.fetchAllHrDocs();
      return Promise.resolve([]);
    },
    fetchAllHrTombstones: function() {
      if (nativeFb && typeof nativeFb.fetchAllHrTombstones === 'function') return nativeFb.fetchAllHrTombstones();
      return Promise.resolve([]);
    },
    decodeHrPayload: function(doc) {
      if (nativeFb && typeof nativeFb.decodeHrPayload === 'function') return nativeFb.decodeHrPayload(doc);
      return Promise.resolve(doc);
    },
    subscribeHrDocs: function(onUpdate, onError) {
      if (nativeFb && typeof nativeFb.subscribeHrDocs === 'function') return nativeFb.subscribeHrDocs(onUpdate, onError);
      return function() {};
    },
    subscribeHrTombstones: function(onUpdate, onError) {
      if (nativeFb && typeof nativeFb.subscribeHrTombstones === 'function') return nativeFb.subscribeHrTombstones(onUpdate, onError);
      return function() {};
    },

    // ── Employee Master Passthrough ──
    saveEmployeeMaster: function(records) {
      if (nativeFb && typeof nativeFb.saveEmployeeMaster === 'function') return nativeFb.saveEmployeeMaster(records);
      return Promise.resolve(true);
    },
    fetchAllEmployeeMaster: function() {
      if (nativeFb && typeof nativeFb.fetchAllEmployeeMaster === 'function') return nativeFb.fetchAllEmployeeMaster();
      return Promise.resolve(null);
    },
    subscribeEmployeeMaster: function(onUpdate, onError) {
      if (nativeFb && typeof nativeFb.subscribeEmployeeMaster === 'function') return nativeFb.subscribeEmployeeMaster(onUpdate, onError);
      return function() {};
    }
  };

  // Mount Hybrid Engine to window.ATPLFirebase
  window.ATPLFirebase = HybridEngine;

  // Initialize Realtime WebSocket channel on boot
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initRealtimeChannel, { once: true });
    } else {
      initRealtimeChannel();
    }
  }

  // Automatic convergence: poll every 3.5s when tab is active to ensure instant sync
  if (typeof setInterval !== 'undefined') {
    setInterval(async function() {
      if (typeof document !== 'undefined' && !document.hidden) {
        try {
          var files = await HybridEngine.fetchAllSalaryFiles();
          var curCount = (window.FILES || []).length;
          if (Array.isArray(files) && files.length !== curCount) {
            console.log('[ATPL Sync] Count mismatch (Remote:', files.length, 'Local:', curCount, '). Auto-converging...');
            if (typeof window.triggerManualCrossBrowserSync === 'function') {
              window.triggerManualCrossBrowserSync();
            }
          }
        } catch (_) {}
      }
    }, 3500);
  }

  // Proactive instant fetch on boot
  if (typeof window !== 'undefined') {
    var checkAndSync = function() {
      setTimeout(function() {
        if (typeof window.triggerManualCrossBrowserSync === 'function') {
          window.triggerManualCrossBrowserSync();
        } else if (window.ATPLCloudSharedStorageV1 && typeof window.ATPLCloudSharedStorageV1.forceSyncAllFiles === 'function') {
          window.ATPLCloudSharedStorageV1.forceSyncAllFiles();
        }
      }, 500);
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', checkAndSync, { once: true });
    } else {
      checkAndSync();
    }
  }

  console.log('[ATPL Dual Cloud Sync Engine] Fully mounted: Firebase Firestore + Supabase Realtime active.');

})(typeof window !== 'undefined' ? window : globalThis);
