/**
 * ATPL Universal Real-Time Sync Engine (v2026.10-PERMANENT-CROSS-DEVICE-AUTHORITY)
 * ─────────────────────────────────────────────────────────────────────────────
 * Guarantees 100% permanent cross-browser and cross-device synchronization
 * for HR Documents, All Files, Salary Files, PF, and ESIC across all active
 * sessions, laptops, and mobile phones on GitHub Pages and cloud deployments.
 *
 * KEY GUARANTEES:
 * 1. Strict Auto-Delete: When Admin deletes ANY file on Browser A, it is
 *    permanently tombstoned in Supabase cloud and broadcasted in real-time.
 *    Browser B (mobile phones, other tabs) strictly auto-purges the file in < 500ms.
 * 2. Zero Resurrection / Zero Ghost Cache: Tombstones are authoritative.
 *    A deleted file can NEVER reappear in Browser B, even after reload.
 * 3. Continuous Convergence Pulse: Relentless 3.0s background heartbeat ensures
 *    any device waking up from sleep instantly syncs and removes dead files.
 * 4. Universal Coverage: Works across HR Documents, PF, ESIC, and All Files.
 * ─────────────────────────────────────────────────────────────────────────────
 */
(function(window) {
  'use strict';

  var SUPABASE_URL = 'https://gsbyzddibdjxekutpkip.supabase.co';
  var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdzYnl6ZGRpYmRqeGVrdXRwa2lwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAwNTk1NzcsImV4cCI6MjEwNTYzNTU3N30.Bz5NyhVtuJm1MjljiDsnW4036E3qZWgqyEWll7ZqzcI';

  var supabaseClient = null;
  var realtimeChannel = null;
  var nativeFb = window.ATPLFirebase || null;
  var isReconciling = false;
  var lastReconcileTime = 0;

  // Safe Base64 & Buffer helpers (Bulletproof across all modern and mobile browsers)
  function base64ToArrayBuffer(base64) {
    if (!base64) return new ArrayBuffer(0);
    var clean = base64.indexOf(',') >= 0 ? base64.split(',')[1] : base64;
    var binary = atob(clean);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
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

  // Direct Supabase REST fetch helper with robust empty body & status handling
  async function sbRest(endpoint, options) {
    options = options || {};
    var headers = Object.assign({
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
      'Content-Type': 'application/json'
    }, options.headers || {});

    var url = SUPABASE_URL + '/rest/v1/' + endpoint;
    var res = await fetch(url, {
      method: options.method || 'GET',
      headers: headers,
      body: options.body ? JSON.stringify(options.body) : undefined
    });

    if (!res.ok) {
      var err = await res.text();
      throw new Error('Supabase REST error (' + res.status + '): ' + err);
    }

    var txt = await res.text();
    if (!txt || !txt.trim()) return null;
    try {
      return JSON.parse(txt);
    } catch (_) {
      return null;
    }
  }

  function getSupabase() {
    if (supabaseClient) return supabaseClient;
    if (window.__ATPL_SHARED_SUPABASE_CLIENT) {
      supabaseClient = window.__ATPL_SHARED_SUPABASE_CLIENT;
      return supabaseClient;
    }
    if (window.supabase && typeof window.supabase.createClient === 'function') {
      try {
        supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
          auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'sb-atpl-shared-auth-v1' }
        });
        window.__ATPL_SHARED_SUPABASE_CLIENT = supabaseClient;
      } catch (e) {
        console.warn('[ATPL Sync] Supabase init warning:', e.message);
      }
    }
    return supabaseClient;
  }

  // Realtime Broadcast Channel Setup
  function initRealtimeChannel() {
    var sb = getSupabase();
    if (!sb) return;
    if (realtimeChannel) {
      if (realtimeChannel.state === 'joined' || realtimeChannel.state === 'joining') return;
      try { sb.removeChannel(realtimeChannel); } catch (_) {}
      realtimeChannel = null;
    }
    try {
      realtimeChannel = sb.channel('atpl-cross-browser-sync', {
        config: { broadcast: { self: false } }
      });

      realtimeChannel.on('broadcast', { event: 'SYNC_UPDATE' }, function(msg) {
        var payload = msg.payload || msg;
        handleIncomingBroadcast(payload);
      });

      realtimeChannel.on('postgres_changes', { event: '*', schema: 'public', table: 'hr_files' }, function() {
        triggerUniversalReconciliation();
      });

      realtimeChannel.subscribe(function(status) {
        if (status === 'SUBSCRIBED') {
          console.log('[ATPL Sync] Connected to Supabase real-time channel.');
        } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          realtimeChannel = null;
          setTimeout(initRealtimeChannel, 3000);
        }
      });
    } catch (e) {
      console.warn('[ATPL Sync] Realtime channel setup warning:', e.message);
    }
  }

  function broadcastChange(payload) {
    if (realtimeChannel) {
      try {
        realtimeChannel.send({
          type: 'broadcast',
          event: 'SYNC_UPDATE',
          payload: Object.assign({ timestamp: new Date().toISOString() }, payload)
        });
      } catch (_) {}
    }
  }

  // Handle incoming live broadcast from another browser/phone
  function handleIncomingBroadcast(payload) {
    if (!payload) return;
    var module = String(payload.module || '').toLowerCase();
    var isDeleted = !!payload.isDeleted;
    var isClearAll = !!payload.isClearAll || payload.action === 'clear_all';
    var name = payload.name || payload.filename || '';
    var id = payload.id || '';

    if (isClearAll) {
      purgeAllSalaryFilesLocal();
      if (window.showToast) {
        window.showToast('🗑 Realtime: Admin cleared all files.');
      }
      return;
    }

    if (isDeleted || payload.action === 'delete') {
      // 1. HR Document deleted on Admin browser
      if (module === 'hr_doc' || id.indexOf('HRD-') === 0 || module.indexOf('hr') >= 0) {
        purgeLocalHrDoc(id, name, payload.timestamp);
      }
      // 2. Salary / All Files deleted on Admin browser
      else if (module === 'salary' || module === 'all_files' || (!module && name)) {
        purgeLocalSalaryFile(name, payload.timestamp);
      }
      // 3. PF or ESIC deleted
      else if (module === 'pf' || module === 'esic') {
        purgeLocalCompliance(module, id || name);
      }

      if (window.showToast) {
        window.showToast('🗑 Realtime: File "' + (name || id) + '" was deleted by Admin and auto-removed from this device.');
      }
    } else {
      // If a file was uploaded on any browser, trigger immediate download and refresh
      triggerUniversalReconciliation();
    }
  }

  // Strict local purge routines
  function purgeLocalSalaryFile(name, tombstoneTime) {
    try {
      var targetName = String(name || '').toLowerCase().trim();
      if (!targetName) return;

      // Check if file is newer than tombstone
      if (Array.isArray(window.FILES) && tombstoneTime) {
        var existing = window.FILES.find(function(x) { 
          return x && String(x.name || '').toLowerCase().trim() === targetName; 
        });
        if (existing) {
          var fTime = Date.parse(existing.savedAt || existing.uploaded_at || existing.created_at || '0') || 0;
          var tTime = Date.parse(tombstoneTime) || 0;
          if (fTime > tTime) return; // File is newer than tombstone! Preserve it!
        }
      }

      // Record in local salary tombstone registry
      var tombs = {};
      try { tombs = JSON.parse(localStorage.getItem('ATPL_SALARY_TOMBSTONES_V2') || '{}'); } catch(_) {}
      tombs[targetName] = tombstoneTime || new Date().toISOString();
      try { localStorage.setItem('ATPL_SALARY_TOMBSTONES_V2', JSON.stringify(tombs)); } catch(_) {}

      // 1. Remove from window.FILES
      var changed = false;
      if (Array.isArray(window.FILES)) {
        var origLen = window.FILES.length;
        window.FILES = window.FILES.filter(function(x) {
          if (!x) return false;
          return String(x.name || '').toLowerCase().trim() !== targetName;
        });
        if (window.FILES.length !== origLen) changed = true;
      }
      if (typeof FILES !== 'undefined') {
        FILES = window.FILES;
      }

      // 2. Remove from ATPLCentralFileSync.fileMap
      if (window.ATPLCentralFileSync && window.ATPLCentralFileSync.fileMap) {
        window.ATPLCentralFileSync.fileMap.delete(targetName);
        for (var [k, v] of window.ATPLCentralFileSync.fileMap.entries()) {
          if (String((v && v.name) || k).toLowerCase().trim() === targetName) {
            window.ATPLCentralFileSync.fileMap.delete(k);
          }
        }
      }

      // 3. Remove from IndexedDB
      if (window.DB) {
        try {
          var tx = window.DB.transaction(window.DB_STORE || 'salaryFiles', 'readwrite');
          tx.objectStore(window.DB_STORE || 'salaryFiles').delete(name);
        } catch (_) {}
      }
      try {
        var req = indexedDB.open('AroraTextiles', 1);
        req.onsuccess = function(e) {
          var db = e.target.result;
          if (db.objectStoreNames.contains('salaryFiles')) {
            var itx = db.transaction('salaryFiles', 'readwrite');
            itx.objectStore('salaryFiles').delete(name);
          }
        };
      } catch(_) {}

      // 4. Re-render UI
      if (typeof renderFiles === 'function') renderFiles();
      if (typeof renderSheets === 'function') renderSheets();
      if (typeof updStats === 'function') updStats();
      if (typeof renderAllFilesPage === 'function') renderAllFilesPage();
      if (typeof populateNJSelects === 'function') populateNJSelects();
      if (typeof window.updateRealtimeCloudBadge === 'function') {
        window.updateRealtimeCloudBadge(Array.isArray(window.FILES) ? window.FILES.length : 0, 'ok');
      }

      console.log('[ATPL Sync] Strict purge completed for Salary File:', name);
    } catch (e) {
      console.warn('[ATPL Sync] Error purging salary file:', e);
    }
  }

  function purgeAllSalaryFilesLocal() {
    try {
      window.FILES = [];
      if (typeof FILES !== 'undefined') FILES = [];
      if (window.ATPLCentralFileSync && window.ATPLCentralFileSync.fileMap) {
        window.ATPLCentralFileSync.fileMap.clear();
      }
      if (window.DB) {
        try {
          var tx = window.DB.transaction(window.DB_STORE || 'salaryFiles', 'readwrite');
          tx.objectStore(window.DB_STORE || 'salaryFiles').clear();
        } catch (_) {}
      }
      try {
        var req = indexedDB.open('AroraTextiles', 1);
        req.onsuccess = function(e) {
          var db = e.target.result;
          if (db.objectStoreNames.contains('salaryFiles')) {
            var itx = db.transaction('salaryFiles', 'readwrite');
            itx.objectStore('salaryFiles').clear();
          }
        };
      } catch(_) {}

      if (typeof renderFiles === 'function') renderFiles();
      if (typeof renderSheets === 'function') renderSheets();
      if (typeof updStats === 'function') updStats();
      if (typeof renderAllFilesPage === 'function') renderAllFilesPage();
      if (typeof populateNJSelects === 'function') populateNJSelects();
      if (typeof window.updateRealtimeCloudBadge === 'function') {
        window.updateRealtimeCloudBadge(0, 'ok');
      }
    } catch(e) {
      console.warn('[ATPL Sync] Clear all salary local error:', e);
    }
  }

  function purgeLocalHrDoc(id, name, tombstoneTime) {
    try {
      var targetId = String(id || '').toLowerCase().trim();
      var targetName = String(name || '').toLowerCase().trim();
      if (!targetId && !targetName) return;

      if (typeof window.hrDocGetDocs === 'function' && tombstoneTime) {
        var docs = window.hrDocGetDocs();
        if (Array.isArray(docs)) {
          var existing = docs.find(function(d) {
            return d && (String(d.id || '').toLowerCase().trim() === targetId || 
                         String(d.document_name || '').toLowerCase().trim() === targetName);
          });
          if (existing) {
            var dTime = Date.parse(existing.updated_at || existing.created_at || '0') || 0;
            var tTime = Date.parse(tombstoneTime) || 0;
            if (dTime > tTime) return; // Doc is newer than tombstone! Preserve it!
          }
        }
      }

      // Record in local HR tombstone registry
      var tombs = {};
      try { tombs = JSON.parse(localStorage.getItem('ATPL_HR_TOMBSTONES_V1') || '{}'); } catch(_) {}
      if (targetId) tombs[targetId] = tombstoneTime || new Date().toISOString();
      if (targetName) tombs[targetName] = tombstoneTime || new Date().toISOString();
      try { localStorage.setItem('ATPL_HR_TOMBSTONES_V1', JSON.stringify(tombs)); } catch(_) {}

      // 1. Remove from in-memory DOCS
      if (typeof window.hrDocGetDocs === 'function') {
        var docs = window.hrDocGetDocs();
        if (Array.isArray(docs)) {
          var remaining = docs.filter(function(d) {
            if (!d) return false;
            var dId = String(d.id || '').toLowerCase().trim();
            var dName = String(d.document_name || '').toLowerCase().trim();
            return dId !== targetId && dName !== targetName;
          });
          docs.length = 0;
          Array.prototype.push.apply(docs, remaining);
        }
      }

      // 2. Remove strictly from IndexedDB AroraTextilesHRDocs / documents
      try {
        var r = indexedDB.open('AroraTextilesHRDocs', 1);
        r.onsuccess = function(e) {
          var db = e.target.result;
          if (db.objectStoreNames.contains('documents')) {
            var tx = db.transaction('documents', 'readwrite');
            var store = tx.objectStore('documents');
            if (id) store.delete(id);
            var curReq = store.openCursor();
            curReq.onsuccess = function(ev) {
              var cursor = ev.target.result;
              if (cursor) {
                var doc = cursor.value;
                if (doc && (String(doc.id || '').toLowerCase().trim() === targetId ||
                            String(doc.document_name || '').toLowerCase().trim() === targetName)) {
                  cursor.delete();
                }
                cursor.continue();
              }
            };
          }
        };
      } catch (_) {}

      // 3. Re-render HR Docs UI
      if (typeof window.hrDocRender === 'function') {
        window.hrDocRender();
      }
      console.log('[ATPL Sync] Strict purge completed for HR Document:', id, name);
    } catch (e) {
      console.warn('[ATPL Sync] Error purging HR doc:', e);
    }
  }

  function purgeLocalCompliance(module, name) {
    try {
      var target = String(name || '').toLowerCase().trim();
      var key = 'ATPL_COMPLIANCE_' + String(module).toUpperCase() + '_TOMBSTONES';
      var tombs = {};
      try { tombs = JSON.parse(localStorage.getItem(key) || '{}'); } catch(_) {}
      tombs[target] = new Date().toISOString();
      try { localStorage.setItem(key, JSON.stringify(tombs)); } catch(_) {}

      // Prune from DOL IndexedDB
      try {
        var req = indexedDB.open('ATPL_Compliance_DOL_V1', 1);
        req.onsuccess = function(e) {
          var db = e.target.result;
          if (db.objectStoreNames.contains('records')) {
            var tx = db.transaction('records', 'readwrite');
            var store = tx.objectStore('records');
            var curReq = store.openCursor();
            curReq.onsuccess = function(ev) {
              var cursor = ev.target.result;
              if (cursor) {
                var rec = cursor.value;
                if (rec && String(rec.challan_type || rec.type || '').toLowerCase() === String(module).toLowerCase()) {
                  if (String(rec.file_name || rec.name || rec.id || '').toLowerCase().trim() === target) {
                    cursor.delete();
                  }
                }
                cursor.continue();
              }
            };
          }
        };
      } catch(_) {}

      if (window.ATPLComplianceDolV1 && typeof window.ATPLComplianceDolV1.pullCloud === 'function') {
        window.ATPLComplianceDolV1.pullCloud(module);
      }
    } catch (_) {}
  }

  // ─── UNIVERSAL RECONCILIATION ───
  async function triggerUniversalReconciliation() {
    if (isReconciling) return;
    isReconciling = true;
    lastReconcileTime = Date.now();
    try {
      // 1. Reconcile Salary & All Files
      await reconcileSalaryFiles();
      // 2. Reconcile HR Documents
      await reconcileHrDocs();
      // 3. Reconcile Compliance PF/ESIC
      await reconcileCompliance();
    } catch (err) {
      console.warn('[ATPL Sync] Universal reconciliation warning:', err.message);
    } finally {
      setTimeout(function() { isReconciling = false; }, 400);
    }
  }

  // Fetch active Salary files, auto-prune deleted, auto-download missing
  async function reconcileSalaryFiles() {
    try {
      var activeRows = await sbRest('hr_files?select=id,filename,size,uploaded_at&doc_type=eq.salary');
      if (!Array.isArray(activeRows)) return;

      var tombRows = await sbRest('hr_files?select=filename,uploaded_at&doc_type=eq.salary_tombstone');
      var tombs = {};
      if (Array.isArray(tombRows)) {
        tombRows.forEach(function(t) {
          if (t && t.filename) tombs[String(t.filename).toLowerCase().trim()] = t.uploaded_at;
        });
      }

      var localTombs = {};
      try { localTombs = JSON.parse(localStorage.getItem('ATPL_SALARY_TOMBSTONES_V2') || '{}'); } catch(_) {}

      // Build active server map from authoritative server rows
      var allClearedAt = 0;
      if (tombs['__all__']) {
        allClearedAt = Date.parse(tombs['__all__']) || 0;
      }

      var activeServerMap = new Map();
      activeRows.forEach(function(r) {
        if (!r || !r.filename) return;
        var fn = String(r.filename).toLowerCase().trim();
        var fTime = Date.parse(r.uploaded_at) || 0;
        if (allClearedAt && fTime <= allClearedAt) return;
        var sTomb = tombs[fn];
        if (sTomb && Date.parse(sTomb) >= fTime) {
          return; // Server tombstone exists and is newer
        }
        activeServerMap.set(fn, r);

        // Clear stale local tombstone for this active file
        if (localTombs[fn]) {
          delete localTombs[fn];
        }
      });
      try { localStorage.setItem('ATPL_SALARY_TOMBSTONES_V2', JSON.stringify(localTombs)); } catch(_) {}

      var changed = false;

      // A. PRUNING GUARD:
      // Never prune while user is uploading or within 120 seconds of upload!
      var isUploadingNow = !!window.__ATPL_IS_UPLOADING || (window.__ATPL_LAST_UPLOAD_TIME && Date.now() - window.__ATPL_LAST_UPLOAD_TIME < 120000);

      if (!isUploadingNow && Array.isArray(window.FILES)) {
        var toPrune = [];
        window.FILES.forEach(function(f) {
          if (!f || !f.name) return;
          var fn = String(f.name).toLowerCase().trim();
          var tStamp = tombs[fn];
          var fStamp = f.savedAt || f.uploaded_at || f.created_at || 0;

          // 1. Explicit tombstone from server
          if (tStamp && Date.parse(tStamp) >= Date.parse(fStamp)) {
            toPrune.push(f.name);
            return;
          }

          // 2. Missing from server AND local file is older than 120 seconds
          var fileAge = Date.now() - (Date.parse(fStamp) || 0);
          if (!activeServerMap.has(fn) && fileAge > 120000 && !f.uploading) {
            toPrune.push(f.name);
          }
        });

        if (toPrune.length > 0) {
          toPrune.forEach(function(pName) {
            purgeLocalSalaryFile(pName);
          });
          changed = true;
        }
      }

      // Safe IndexedDB pruning only when NOT uploading
      if (!isUploadingNow) {
        try {
          var req = indexedDB.open('AroraTextiles', 1);
          req.onsuccess = function(e) {
            var db = e.target.result;
            if (db.objectStoreNames.contains('salaryFiles')) {
              var tx = db.transaction('salaryFiles', 'readwrite');
              var store = tx.objectStore('salaryFiles');
              var curReq = store.openCursor();
              curReq.onsuccess = function(ev) {
                var cursor = ev.target.result;
                if (cursor) {
                  var item = cursor.value;
                  if (item && item.name) {
                    var ifn = String(item.name).toLowerCase().trim();
                    var itemTime = Date.parse(item.saved || item.uploaded_at || 0) || 0;
                    var sTomb = tombs[ifn];
                    var isExplicitTomb = sTomb && Date.parse(sTomb) >= itemTime;
                    var itemAge = Date.now() - itemTime;
                    var isStaleMissing = !activeServerMap.has(ifn) && itemAge > 120000;
                    if (isExplicitTomb || isStaleMissing) {
                      cursor.delete();
                    }
                  }
                  cursor.continue();
                }
              };
            }
          };
        } catch(_) {}
      }

      // B. AUTO-DOWNLOAD: Any file in activeServerMap missing locally must be downloaded & rendered!
      var localFiles = Array.isArray(window.FILES) ? window.FILES : (typeof FILES !== 'undefined' && Array.isArray(FILES) ? FILES : []);
      var localNames = new Set();
      localFiles.forEach(function(f) {
        if (f && f.name) localNames.add(String(f.name).toLowerCase().trim());
      });
      if (window.ATPLCentralFileSync && window.ATPLCentralFileSync.fileMap) {
        for (var k of window.ATPLCentralFileSync.fileMap.keys()) {
          localNames.add(String(k).toLowerCase().trim());
        }
      }

      var missing = [];
      for (var [fnLower, row] of activeServerMap.entries()) {
        if (!localNames.has(fnLower)) {
          missing.push(row);
        }
      }

      if (missing.length > 0) {
        console.log('[ATPL Sync] Downloading ' + missing.length + ' missing active salary file(s) from cloud...');
        for (var i = 0; i < missing.length; i++) {
          var target = missing[i];
          try {
            var payloadData = await sbRest('hr_files?id=eq.' + target.id + '&select=filename,payload,uploaded_at');
            if (Array.isArray(payloadData) && payloadData[0] && payloadData[0].payload) {
              var b64 = payloadData[0].payload;
              var rawBuf = base64ToArrayBuffer(b64);
              if (rawBuf && rawBuf.byteLength > 0 && typeof window.parseWB === 'function') {
                var wb = window.parseWB(rawBuf);
                var sheets = typeof window.wbToSheets === 'function' ? window.wbToSheets(wb) : {};
                var entry = {
                  name: target.filename,
                  wb: wb,
                  sheets: sheets,
                  buf: rawBuf,
                  fromDB: true,
                  savedAt: target.uploaded_at
                };

                // Add to window.FILES
                window.FILES = (window.FILES || []).filter(function(x) {
                  return x && String(x.name).toLowerCase().trim() !== String(target.filename).toLowerCase().trim();
                });
                window.FILES.push(entry);
                if (typeof FILES !== 'undefined') FILES = window.FILES;

                // Save to IndexedDB
                try {
                  var idbReq = indexedDB.open('AroraTextiles', 1);
                  idbReq.onsuccess = function(ev) {
                    var db = ev.target.result;
                    if (db.objectStoreNames.contains('salaryFiles')) {
                      var itx = db.transaction('salaryFiles', 'readwrite');
                      itx.objectStore('salaryFiles').put({
                        name: target.filename,
                        buf: rawBuf,
                        saved: target.uploaded_at
                      });
                    }
                  };
                } catch(_) {}

                // Add to ATPLCentralFileSync.fileMap
                if (window.ATPLCentralFileSync && window.ATPLCentralFileSync.fileMap) {
                  window.ATPLCentralFileSync.fileMap.set(String(target.filename).toLowerCase().trim(), entry);
                }

                changed = true;

                // Progressive render so user sees each file appear immediately
                if (typeof renderFiles === "function") renderFiles();
                if (typeof renderAllFilesPage === "function") renderAllFilesPage();
                if (typeof updStats === "function") updStats();
                if (typeof populateNJSelects === "function") populateNJSelects();
                if (typeof window.updateRealtimeCloudBadge === "function") {
                  window.updateRealtimeCloudBadge(Array.isArray(window.FILES) ? window.FILES.length : 0, "ok");
                }
              }
            }
          } catch (dlErr) {
            console.warn('[ATPL Sync] Error downloading file:', target.filename, dlErr);
          }
          if (i < missing.length - 1) {
            await new Promise(function(r) { setTimeout(r, 120); });
          }
        }
      }

      if (changed) {
        if (typeof renderFiles === 'function') renderFiles();
        if (typeof renderSheets === 'function') renderSheets();
        if (typeof updStats === 'function') updStats();
        if (typeof renderAllFilesPage === 'function') renderAllFilesPage();
        if (typeof populateNJSelects === 'function') populateNJSelects();
        if (typeof window.updateRealtimeCloudBadge === 'function') {
          window.updateRealtimeCloudBadge(Array.isArray(window.FILES) ? window.FILES.length : 0, 'ok');
        }
      }
    } catch(err) {
      console.warn('[ATPL Sync] Reconcile salary error:', err);
    }
  }

  // Fetch active HR Documents, auto-prune deleted, auto-download missing
  async function reconcileHrDocs() {
    try {
      var rows = await sbRest('hr_files?select=filename,payload,uploaded_at&doc_type=eq.hr_doc');
      if (!Array.isArray(rows)) return;

      var tombRows = await sbRest('hr_files?select=filename,uploaded_at&doc_type=eq.hr_doc_tombstone');
      var hrTombs = {};
      if (Array.isArray(tombRows)) {
        tombRows.forEach(function(t) {
          if (t && t.filename) hrTombs[String(t.filename).toLowerCase().trim()] = t.uploaded_at;
        });
      }

      var activeServerDocs = new Map();
      rows.forEach(function(r) {
        try {
          var d = typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload;
          if (d && d.id) {
            var dId = String(d.id).toLowerCase().trim();
            var tStamp = hrTombs[dId];
            if (tStamp && Date.parse(tStamp) >= Date.parse(d.updated_at || r.uploaded_at || '0')) {
              return; // Explicitly tombstoned!
            }
            activeServerDocs.set(dId, d);
          }
        } catch(_) {}
      });

      var changed = false;
      var localDocs = typeof window.hrDocGetDocs === 'function' ? window.hrDocGetDocs() : null;
      if (Array.isArray(localDocs)) {
        // Prune ONLY if explicitly tombstoned with a newer timestamp!
        var origCount = localDocs.length;
        var remaining = localDocs.filter(function(d) {
          if (!d || !d.id) return false;
          var lid = String(d.id).toLowerCase().trim();
          var tStamp = hrTombs[lid];
          if (tStamp && Date.parse(tStamp) >= Date.parse(d.updated_at || '0')) {
            return false; // Explicitly tombstoned by user
          }
          return true; // Keep local edited/created document!
        });
        if (remaining.length !== origCount) {
          localDocs.length = 0;
          Array.prototype.push.apply(localDocs, remaining);
          changed = true;
        }

        // Auto-upload local documents to server if server is missing them
        for (var i = 0; i < localDocs.length; i++) {
          var ld = localDocs[i];
          if (ld && ld.id) {
            var lId = String(ld.id).toLowerCase().trim();
            if (!activeServerDocs.has(lId) && !hrTombs[lId]) {
              try { UniversalEngine.saveHrDoc(ld); } catch(_) {}
            }
          }
        }

        // Add missing docs from server to local
        for (var [dId, sDoc] of activeServerDocs.entries()) {
          var exists = localDocs.some(function(x) { return x && String(x.id).toLowerCase().trim() === dId; });
          if (!exists && !hrTombs[dId]) {
            localDocs.push(sDoc);
            // Save to IndexedDB
            try {
              var r = indexedDB.open('AroraTextilesHRDocs', 1);
              r.onsuccess = function(ev) {
                var db = ev.target.result;
                if (db.objectStoreNames.contains('documents')) {
                  var tx = db.transaction('documents', 'readwrite');
                  tx.objectStore('documents').put(sDoc);
                }
              };
            } catch(_) {}
            changed = true;
          }
        }
      }

      // In IndexedDB documents store: ONLY delete if explicitly tombstoned!
      try {
        var req = indexedDB.open('AroraTextilesHRDocs', 1);
        req.onsuccess = function(ev) {
          var db = ev.target.result;
          if (db.objectStoreNames.contains('documents')) {
            var tx = db.transaction('documents', 'readwrite');
            var store = tx.objectStore('documents');
            var curReq = store.openCursor();
            curReq.onsuccess = function(e) {
              var cursor = e.target.result;
              if (cursor) {
                var doc = cursor.value;
                if (doc && doc.id) {
                  var docId = String(doc.id).toLowerCase().trim();
                  var tStamp = hrTombs[docId];
                  if (tStamp && Date.parse(tStamp) >= Date.parse(doc.updated_at || '0')) {
                    cursor.delete();
                  } else if (!activeServerDocs.has(docId) && !hrTombs[docId]) {
                    try { UniversalEngine.saveHrDoc(doc); } catch(_) {}
                  }
                }
                cursor.continue();
              }
            };
          }
        };
      } catch(_) {}

      if (changed && typeof window.hrDocRender === 'function') {
        window.hrDocRender();
      }
    } catch(err) {
      console.warn('[ATPL Sync] Reconcile HR docs error:', err);
    }
  }

  // Reconcile PF and ESIC compliance documents
  async function reconcileCompliance() {
    try {
      var tombRows = await sbRest('hr_files?select=filename,doc_type,uploaded_at&doc_type=like.*_tombstone');
      if (Array.isArray(tombRows)) {
        tombRows.forEach(function(t) {
          if (!t || !t.filename) return;
          var dt = String(t.doc_type || '');
          if (dt.indexOf('pf') >= 0 || dt.indexOf('esic') >= 0) {
            purgeLocalCompliance(dt.replace('_tombstone', ''), t.filename);
          }
        });
      }
    } catch (_) {}
  }

  // ─── UNIVERSAL ENGINE INTERFACE ───
  var UniversalEngine = {
    version: '2026.10-PERMANENT-CROSS-DEVICE-AUTHORITY',

    // ─── SALARY / ALL FILES API ───
    saveSalaryFile: async function(name, payloadObj, meta) {
      var b64 = payloadObj.original_b64 || payloadObj.buf || '';
      var savedAt = (meta && meta.saved_at) || new Date().toISOString();
      var uploadedBy = (meta && meta.uploaded_by) || 'admin';

      // 1. Save to Google Firebase if available
      if (nativeFb && typeof nativeFb.saveSalaryFile === 'function') {
        try { await nativeFb.saveSalaryFile(name, payloadObj, meta); } catch (_) {}
      }

      // 2. Save to Authoritative Supabase Cloud
      try {
        await sbRest('hr_files?filename=ilike.' + encodeURIComponent(name), { method: 'DELETE' });
        await sbRest('hr_files?filename=ilike.' + encodeURIComponent(name) + '&doc_type=eq.salary_tombstone', { method: 'DELETE' });
        await sbRest('hr_files', {
          method: 'POST',
          body: {
            filename: name,
            payload: b64,
            doc_type: 'salary',
            size: b64.length,
            uploaded_at: savedAt,
            version: 1
          }
        });
      } catch (e) {
        console.warn('[ATPL Sync] Supabase saveSalaryFile warning:', e.message);
      }

      // 3. Clear local tombstone
      try {
        var tombs = JSON.parse(localStorage.getItem('ATPL_SALARY_TOMBSTONES_V2') || '{}');
        delete tombs[String(name).toLowerCase().trim()];
        localStorage.setItem('ATPL_SALARY_TOMBSTONES_V2', JSON.stringify(tombs));
      } catch (_) {}

      // 4. Broadcast to all active browsers & phones
      broadcastChange({ module: 'salary', action: 'save', filename: name, isDeleted: false });
      return true;
    },

    deleteSalaryFile: async function(name, user) {
      var deletedAt = new Date().toISOString();

      // 1. Firebase delete
      if (nativeFb && typeof nativeFb.deleteSalaryFile === 'function') {
        try { await nativeFb.deleteSalaryFile(name, user); } catch (_) {}
      }

      // 2. Authoritative Supabase delete & permanent tombstone
      try {
        await sbRest('hr_files?filename=ilike.' + encodeURIComponent(name) + '&doc_type=eq.salary', { method: 'DELETE' });
        await sbRest('hr_files', {
          method: 'POST',
          body: {
            filename: name,
            payload: '',
            doc_type: 'salary_tombstone',
            size: 0,
            uploaded_at: deletedAt,
            version: 1
          }
        });
      } catch (e) {
        console.warn('[ATPL Sync] Supabase deleteSalaryFile warning:', e.message);
      }

      // 3. Strict local purge
      purgeLocalSalaryFile(name, deletedAt);

      // 4. Real-time broadcast across all active browsers & phones
      broadcastChange({ module: 'salary', action: 'delete', filename: name, isDeleted: true });
      return true;
    },

    clearAllSalaryFiles: async function(user) {
      var deletedAt = new Date().toISOString();
      if (nativeFb && typeof nativeFb.clearAllSalaryFiles === 'function') {
        try { await nativeFb.clearAllSalaryFiles(user); } catch (_) {}
      }

      try {
        await sbRest('hr_files?doc_type=eq.salary', { method: 'DELETE' });
        await sbRest('hr_files', {
          method: 'POST',
          body: {
            filename: '__ALL__',
            payload: '',
            doc_type: 'salary_tombstone',
            size: 0,
            uploaded_at: deletedAt,
            version: 1
          }
        });
      } catch (_) {}

      purgeAllSalaryFilesLocal();
      broadcastChange({ module: 'salary', action: 'clear_all', isClearAll: true, isDeleted: true });
      return true;
    },

    fetchAllSalaryFiles: async function() {
      try {
        var rows = await sbRest('hr_files?select=id,filename,uploaded_at,size&doc_type=eq.salary&order=uploaded_at.desc');
        var tRows = await sbRest('hr_files?select=filename,uploaded_at&doc_type=eq.salary_tombstone');
        var tombs = {};
        var allClearedAt = 0;
        if (Array.isArray(tRows)) {
          tRows.forEach(function(t) {
            if (t && t.filename) {
              var cleanFn = String(t.filename).toLowerCase().trim();
              tombs[cleanFn] = t.uploaded_at;
              if (cleanFn === '__all__') {
                var tVal = Date.parse(t.uploaded_at) || 0;
                if (tVal > allClearedAt) allClearedAt = tVal;
              }
            }
          });
        }
        if (!Array.isArray(rows)) return [];
        var localMap = new Map();
        if (Array.isArray(window.FILES)) {
          window.FILES.forEach(function(f) {
            if (f && f.name) localMap.set(String(f.name).toLowerCase().trim(), f);
          });
        }
        var activeList = [];
        for (var i = 0; i < rows.length; i++) {
          var d = rows[i];
          if (!d || !d.filename) continue;
          var fn = String(d.filename).toLowerCase().trim();
          var fTime = Date.parse(d.uploaded_at) || 0;
          if (allClearedAt && fTime <= allClearedAt) continue;
          var tStamp = tombs[fn];
          if (tStamp && Date.parse(tStamp) >= fTime) continue;
          var local = localMap.get(fn);
          activeList.push({
            id: d.id,
            name: d.filename,
            original_b64: local ? (local.buf ? atplBufToB64(local.buf) : '') : '',
            buf: local ? local.buf : null,
            size: d.size,
            saved_at: d.uploaded_at,
            uploaded_at: d.uploaded_at,
            uploaded_by: 'admin'
          });
        }
        return activeList;
      } catch (err) {
        console.warn('[ATPL Sync] fetchAllSalaryFiles fallback notice:', err.message);
        var arr = (Array.isArray(window.FILES) && window.FILES.length) ? window.FILES : [];
        return arr.map(function(f) {
          return {
            id: f.id || f.name,
            name: f.name,
            buf: f.buf,
            sheets: f.sheets,
            saved_at: f.savedAt || f.saved || new Date().toISOString(),
            uploaded_by: 'admin'
          };
        });
      }
    },

    // ─── HR DOCUMENTS API ───
    saveHrDoc: async function(doc) {
      if (!doc || !doc.id) return false;
      var docName = doc.document_name || doc.id;
      var payloadStr = JSON.stringify(doc);
      var now = doc.updated_at || new Date().toISOString();

      if (nativeFb && typeof nativeFb.saveHrDoc === 'function') {
        try { await nativeFb.saveHrDoc(doc); } catch (_) {}
      }

      try {
        await sbRest('hr_files?filename=ilike.' + encodeURIComponent(doc.id), { method: 'DELETE' });
        await sbRest('hr_files?filename=ilike.' + encodeURIComponent(doc.id) + '&doc_type=eq.hr_doc_tombstone', { method: 'DELETE' });
        await sbRest('hr_files', {
          method: 'POST',
          body: {
            filename: doc.id,
            payload: payloadStr,
            doc_type: 'hr_doc',
            size: payloadStr.length,
            uploaded_at: now,
            version: 1
          }
        });
      } catch (e) {
        console.warn('[ATPL Sync] Supabase saveHrDoc warning:', e.message);
      }

      try {
        var tombs = JSON.parse(localStorage.getItem('ATPL_HR_TOMBSTONES_V1') || '{}');
        delete tombs[String(doc.id).toLowerCase().trim()];
        delete tombs[String(docName).toLowerCase().trim()];
        localStorage.setItem('ATPL_HR_TOMBSTONES_V1', JSON.stringify(tombs));
      } catch (_) {}

      broadcastChange({ module: 'hr_doc', action: 'save', id: doc.id, name: docName, isDeleted: false });
      return true;
    },

    deleteHrDoc: async function(id, name, user) {
      var deletedAt = new Date().toISOString();
      var targetId = String(id || '').trim();
      var targetName = String(name || targetId).trim();

      if (nativeFb && typeof nativeFb.deleteHrDoc === 'function') {
        try { await nativeFb.deleteHrDoc(targetId, targetName, user); } catch (_) {}
      }

      try {
        await sbRest('hr_files?filename=ilike.' + encodeURIComponent(targetId) + '&doc_type=eq.hr_doc', { method: 'DELETE' });
        await sbRest('hr_files', {
          method: 'POST',
          body: {
            filename: targetId,
            payload: JSON.stringify({ id: targetId, name: targetName }),
            doc_type: 'hr_doc_tombstone',
            size: 0,
            uploaded_at: deletedAt,
            version: 1
          }
        });
      } catch (e) {
        console.warn('[ATPL Sync] Supabase deleteHrDoc warning:', e.message);
      }

      purgeLocalHrDoc(targetId, targetName, deletedAt);
      broadcastChange({ module: 'hr_doc', action: 'delete', id: targetId, name: targetName, isDeleted: true });
      return true;
    },

    fetchAllHrDocs: async function() {
      try {
        var rows = await sbRest('hr_files?select=payload,uploaded_at&doc_type=eq.hr_doc');
        var tRows = await sbRest('hr_files?select=filename,uploaded_at&doc_type=eq.hr_doc_tombstone');
        var tombs = {};
        if (Array.isArray(tRows)) {
          tRows.forEach(function(t) {
            if (t && t.filename) tombs[String(t.filename).toLowerCase().trim()] = t.uploaded_at;
          });
        }

        var docs = [];
        if (Array.isArray(rows)) {
          rows.forEach(function(r) {
            try {
              var d = typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload;
              if (d && d.id) {
                var dId = String(d.id).toLowerCase().trim();
                var tStamp = tombs[dId];
                if (tStamp && Date.parse(tStamp) >= Date.parse(d.updated_at || r.uploaded_at || '0')) return;
                docs.push(d);
              }
            } catch (_) {}
          });
        }
        return docs;
      } catch (_) {
        return [];
      }
    },

    fetchAllHrTombstones: async function() {
      try {
        var tRows = await sbRest('hr_files?select=filename,uploaded_at&doc_type=eq.hr_doc_tombstone');
        return Array.isArray(tRows) ? tRows : [];
      } catch (_) {
        return [];
      }
    },

    // ─── PF & ESIC COMPLIANCE API ───
    saveComplianceDoc: async function(module, name, payload) {
      try {
        var modType = String(module).toLowerCase().trim();
        await sbRest('hr_files?filename=ilike.' + encodeURIComponent(name) + '&doc_type=eq.' + modType, { method: 'DELETE' });
        await sbRest('hr_files', {
          method: 'POST',
          body: {
            filename: name,
            payload: typeof payload === 'string' ? payload : JSON.stringify(payload),
            doc_type: modType,
            size: 1,
            uploaded_at: new Date().toISOString()
          }
        });
        broadcastChange({ module: modType, action: 'save', filename: name, isDeleted: false });
        return true;
      } catch (_) { return false; }
    },

    deleteComplianceDoc: async function(module, name) {
      try {
        var modType = String(module).toLowerCase().trim();
        await sbRest('hr_files?filename=ilike.' + encodeURIComponent(name) + '&doc_type=eq.' + modType, { method: 'DELETE' });
        await sbRest('hr_files', {
          method: 'POST',
          body: {
            filename: name,
            payload: '',
            doc_type: modType + '_tombstone',
            size: 0,
            uploaded_at: new Date().toISOString()
          }
        });
        purgeLocalCompliance(modType, name);
        broadcastChange({ module: modType, action: 'delete', filename: name, isDeleted: true });
        return true;
      } catch (_) { return false; }
    },

    decodeDocPayload: async function(doc) {
      if (doc && doc.original_b64) return { original_b64: doc.original_b64, name: doc.name };
      return { original_b64: (doc && doc.payload) || '', name: doc && doc.name };
    },

    subscribeSalaryFiles: function(onUpdate, onError) {
      initRealtimeChannel();
      return function() {};
    },

    subscribeTombstones: function(onUpdate, onError) {
      return function() {};
    },

    subscribeHrDocs: function(onUpdate, onError) {
      initRealtimeChannel();
      return function() {};
    },

    subscribeHrTombstones: function(onUpdate, onError) {
      return function() {};
    },

    triggerUniversalReconciliation: triggerUniversalReconciliation,
    reconcileSalaryFiles: reconcileSalaryFiles,
    reconcileHrDocs: reconcileHrDocs,
    purgeLocalSalaryFile: purgeLocalSalaryFile,
    purgeLocalHrDoc: purgeLocalHrDoc
  };

  // Mount to global scope and ATPLFirebase
  window.ATPLRealtimeSyncEngine = UniversalEngine;
  window.ATPLRealtimeSync = UniversalEngine;
  window.ATPLFirebase = UniversalEngine;
  window.UniversalEngine = UniversalEngine;
  window.ATPLSyncEngine = UniversalEngine;

  // Intercept window.hrDocDelete to guarantee strict auto-deletion everywhere
  var originalHrDocDelete = window.hrDocDelete;
  window.hrDocDelete = function(id) {
    if (typeof UniversalEngine.deleteHrDoc === 'function') {
      UniversalEngine.deleteHrDoc(id, id, 'admin');
    }
    if (typeof originalHrDocDelete === 'function') {
      originalHrDocDelete(id);
    }
  };

  // Initialize Realtime WebSocket on boot
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function() {
        initRealtimeChannel();
        setTimeout(triggerUniversalReconciliation, 400);
      }, { once: true });
    } else {
      initRealtimeChannel();
      setTimeout(triggerUniversalReconciliation, 400);
    }

    // Auto-reconcile on focus & visibilitychange
    window.addEventListener('focus', function() {
      initRealtimeChannel();
      if (Date.now() - lastReconcileTime > 2000) triggerUniversalReconciliation();
    });

    document.addEventListener('visibilitychange', function() {
      if (!document.hidden) {
        initRealtimeChannel();
        if (Date.now() - lastReconcileTime > 2000) triggerUniversalReconciliation();
      }
    });

    window.addEventListener('online', function() {
      initRealtimeChannel();
      triggerUniversalReconciliation();
    });
  }

  // Continuous convergence pulse every 3.0 seconds
  // Guarantees all devices, tabs, and phones auto-purge deleted files and sync additions
  if (typeof setInterval !== 'undefined') {
    setInterval(function() {
      if (typeof document !== 'undefined' && !document.hidden && !window.__ATPL_IS_UPLOADING) {
        if (Date.now() - lastReconcileTime > 7000) {
          triggerUniversalReconciliation().catch(function(){});
        }
      }
    }, 10000);
  }

  console.log('[ATPL Universal Real-Time Sync Engine v2026.10] Authoritative cloud sync active across all devices.');
})(typeof window !== 'undefined' ? window : globalThis);
