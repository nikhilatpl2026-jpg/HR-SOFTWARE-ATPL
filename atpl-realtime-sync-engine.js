/**
 * ATPL Universal Real-Time Sync Engine — INTERCEPTOR EDITION
 * Hooks directly into IndexedDB & localStorage prototypes so private closure variables
 * in index.html are FORCED to read/write HR Documents directly from Google Drive!
 */
(function(window) {
  'use strict';

  var DEFAULT_GAS_URL = 'https://script.google.com/macros/s/AKfycbwHjuIFasUeW_QosnwssfpqDKp2yU2ZYqY28vkqdYc5tXsCgkY0KCuBL1nuaZZE3s5c/exec';

  function getGasUrl() {
    try {
      var saved = localStorage.getItem('ATPL_GAS_MASTER_URL');
      if (saved && saved.indexOf('https://script.google.com') === 0) return saved.trim();
    } catch (_) {}
    return DEFAULT_GAS_URL;
  }

  try { localStorage.setItem('ATPL_GAS_MASTER_URL', DEFAULT_GAS_URL); } catch (_) {}

  window.__atplFirebaseQuotaExhausted = true;
  window.LIVE_CLOUD_RUN_URL = '';
  window.__ATPL_CENTRAL_BACKEND_URL = '';
  window.ATPL_GET_API_BASE = function() { return ''; };

  // Master Authoritative HR Docs List in RAM (Synced with Google Sheet)
  var MASTER_HR_DOCS = [];
  var HR_TOMBSTONE_IDS = new Set();
  var isInternalIdbWrite = false;

  window.ATPL_UNIVERSAL_VAULT = window.ATPL_UNIVERSAL_VAULT || {
    pf: [],
    esic: [],
    challan: []
  };

  function yieldToUI(ms) {
    return new Promise(function(resolve) {
      if (typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(function() { setTimeout(resolve, ms || 35); });
      } else {
        setTimeout(resolve, ms || 35);
      }
    });
  }

  function arrayBufferToBase64(buffer) {
    if (!buffer) return '';
    if (typeof buffer === 'string') return buffer.indexOf(',') >= 0 ? buffer.split(',')[1] : buffer;
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

  window.atplBufToB64 = arrayBufferToBase64;
  window.atplB64ToBuf = base64ToArrayBuffer;

  window.__ATPL_SESSION_UPLOADS = {};
  window.atplMarkSessionUpload = function(mod, key) {
    var m = String(mod || 'salary').toLowerCase().trim();
    var k = String(key || '').toLowerCase().trim();
    if (!window.__ATPL_SESSION_UPLOADS[m]) window.__ATPL_SESSION_UPLOADS[m] = {};
    if (k) window.__ATPL_SESSION_UPLOADS[m][k] = Date.now();
  };
  window.atplClearSessionUpload = function(mod, key) {
    var m = String(mod || 'salary').toLowerCase().trim();
    var k = String(key || '').toLowerCase().trim();
    if (window.__ATPL_SESSION_UPLOADS[m] && k) delete window.__ATPL_SESSION_UPLOADS[m][k];
  };
  window.atplIsRecentSessionUpload = function(mod, key, maxAgeMs) {
    var m = String(mod || 'salary').toLowerCase().trim();
    var k = String(key || '').toLowerCase().trim();
    var ts = (window.__ATPL_SESSION_UPLOADS[m] && window.__ATPL_SESSION_UPLOADS[m][k]) || 0;
    return ts > 0 && (Date.now() - ts) < (maxAgeMs || 60000);
  };

  async function gasGet(params) {
    var baseUrl = getGasUrl();
    if (!baseUrl || baseUrl.indexOf('https://script.google.com') !== 0) return null;
    var qs = Object.keys(params || {}).map(function(k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
    }).join('&');
    var url = baseUrl + (baseUrl.indexOf('?') >= 0 ? '&' : '?') + qs + '&_t=' + Date.now();
    var res = await fetch(url, { method: 'GET', cache: 'no-store', redirect: 'follow' });
    if (!res.ok) throw new Error('GAS GET HTTP ' + res.status);
    return await res.json();
  }

  async function gasPost(payloadObj) {
    var baseUrl = getGasUrl();
    if (!baseUrl || baseUrl.indexOf('https://script.google.com') !== 0) return null;
    var res = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payloadObj),
      redirect: 'follow'
    });
    if (!res.ok) throw new Error('GAS POST HTTP ' + res.status);
    return await res.json();
  }

  // ── 1. INTERCEPT BROWSER INDEXEDDB FOR HR DOCS (Auto-captures Add/Edit/Delete from index.html!) ──
  (function installHrIndexedDBInterceptor() {
    if (typeof IDBObjectStore === 'undefined') return;
    var origPut = IDBObjectStore.prototype.put;
    var origAdd = IDBObjectStore.prototype.add;
    var origDelete = IDBObjectStore.prototype.delete;

    function isHrStore(store) {
      try {
        var dbName = String((store.transaction && store.transaction.db && store.transaction.db.name) || '').toLowerCase();
        var stName = String(store.name || '').toLowerCase();
        return dbName.indexOf('hr') >= 0 || stName.indexOf('doc') >= 0 || stName.indexOf('hr') >= 0;
      } catch (_) {
        return false;
      }
    }

    function looksLikeHrDoc(val) {
      return val && typeof val === 'object' && (val.document_name || val.category || val.issue_date || val.expiry_date || val.doc_type);
    }

    IDBObjectStore.prototype.put = function(value, key) {
      if (!isInternalIdbWrite && (isHrStore(this) || looksLikeHrDoc(value))) {
        setTimeout(function() {
          if (value && typeof value === 'object') {
            GoogleDriveEngine.saveHrDoc(value);
          }
        }, 10);
      }
      return origPut.apply(this, arguments);
    };

    IDBObjectStore.prototype.add = function(value, key) {
      if (!isInternalIdbWrite && (isHrStore(this) || looksLikeHrDoc(value))) {
        setTimeout(function() {
          if (value && typeof value === 'object') {
            GoogleDriveEngine.saveHrDoc(value);
          }
        }, 10);
      }
      return origAdd.apply(this, arguments);
    };

    IDBObjectStore.prototype.delete = function(key) {
      if (!isInternalIdbWrite && isHrStore(this) && key) {
        var delId = String(key).trim();
        setTimeout(function() {
          GoogleDriveEngine.deleteHrDoc(delId, delId);
        }, 10);
      }
      return origDelete.apply(this, arguments);
    };
  })();

  // ── 2. INTERCEPT LOCALSTORAGE FOR HR DOCS (Auto-captures localStorage saves from index.html!) ──
  (function installLocalStorageInterceptor() {
    try {
      var origSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key, val) {
        origSetItem.apply(this, arguments);
        if (isInternalIdbWrite) return;
        var kLow = String(key || '').toLowerCase();
        if (kLow.indexOf('hr') >= 0 && kLow.indexOf('doc') >= 0 && kLow.indexOf('tomb') < 0) {
          try {
            var parsed = JSON.parse(val);
            if (Array.isArray(parsed)) {
              parsed.forEach(function(d) {
                if (d && (d.id || d.document_name)) {
                  var did = String(d.id || d.document_name).toLowerCase().trim();
                  if (!HR_TOMBSTONE_IDS.has(did)) {
                    var existsInMaster = MASTER_HR_DOCS.some(function(m) {
                      return String(m.id || '').toLowerCase().trim() === did;
                    });
                    if (!existsInMaster) {
                      GoogleDriveEngine.saveHrDoc(d);
                    }
                  }
                }
              });
            }
          } catch (_) {}
        }
      };
    } catch (_) {}
  })();

  function clearHrSyncingIndicator() {
    try {
      var btns = document.querySelectorAll('button');
      for (var i = 0; i < btns.length; i++) {
        var b = btns[i];
        if (b.textContent && b.textContent.indexOf('Syncing...') >= 0) {
          b.textContent = '✅ Cloud Synced';
          b.disabled = false;
        }
      }
    } catch (_) {}
  }

  // Scan ALL IndexedDB databases & localStorage keys to find where HR Documents live on this browser
  function scanAllBrowserHrStores() {
    return new Promise(function(resolve) {
      var foundMap = new Map();

      function ingest(item) {
        if (!item || typeof item !== 'object') return;
        if (!item.document_name && !item.category && !item.issue_date && !item.expiry_date && !item.doc_type && !item.re_training) return;
        var id = String(item.id || item.doc_id || item.document_name || item.name || '').trim();
        if (!id) return;
        var k = id.toLowerCase();
        if (HR_TOMBSTONE_IDS.has(k)) return;
        var prev = foundMap.get(k) || {};
        foundMap.set(k, Object.assign({}, prev, item, {
          id: item.id || id,
          document_name: item.document_name || item.name || item.title || id
        }));
      }

      // 1. Check window.hrDocGetDocs() & global arrays
      try {
        if (typeof window.hrDocGetDocs === 'function') {
          var arr = window.hrDocGetDocs();
          if (Array.isArray(arr)) arr.forEach(ingest);
        }
      } catch (_) {}

      // 2. Scan ALL localStorage keys
      try {
        for (var i = 0; i < localStorage.length; i++) {
          var lKey = localStorage.key(i);
          if (!lKey || lKey.toLowerCase().indexOf('tomb') >= 0) continue;
          var raw = localStorage.getItem(lKey);
          if (raw && raw.charAt(0) === '[') {
            try {
              var p = JSON.parse(raw);
              if (Array.isArray(p)) p.forEach(ingest);
            } catch (_) {}
          }
        }
      } catch (_) {}

      // 3. Scan IndexedDB ('AroraTextilesHRDocs' and 'AroraTextiles')
      if (typeof indexedDB === 'undefined') {
        return resolve(Array.from(foundMap.values()));
      }

      var dbNamesToCheck = ['AroraTextilesHRDocs', 'AroraTextiles', 'HRDocsDB', 'atpl_hr_docs'];
      var pendingDbs = dbNamesToCheck.length;

      function finishOneDb() {
        pendingDbs--;
        if (pendingDbs <= 0) resolve(Array.from(foundMap.values()));
      }

      dbNamesToCheck.forEach(function(dbName) {
        try {
          var req = indexedDB.open(dbName);
          req.onerror = finishOneDb;
          req.onsuccess = function(e) {
            var db = e.target.result;
            var stores = Array.from(db.objectStoreNames || []);
            if (stores.length === 0) {
              db.close();
              return finishOneDb();
            }
            var pendingStores = stores.length;
            stores.forEach(function(stName) {
              if (stName === 'salaryFiles') {
                pendingStores--;
                if (pendingStores <= 0) finishOneDb();
                return;
              }
              try {
                var tx = db.transaction(stName, 'readonly');
                var st = tx.objectStore(stName);
                var gReq = st.getAll();
                gReq.onsuccess = function(ev) {
                  var items = ev.target.result;
                  if (Array.isArray(items)) items.forEach(ingest);
                  pendingStores--;
                  if (pendingStores <= 0) finishOneDb();
                };
                gReq.onerror = function() {
                  pendingStores--;
                  if (pendingStores <= 0) finishOneDb();
                };
              } catch (_) {
                pendingStores--;
                if (pendingStores <= 0) finishOneDb();
              }
            });
          };
        } catch (_) {
          finishOneDb();
        }
      });
    });
  }

  // Force-write the exact MASTER_HR_DOCS list into every local store + trigger UI re-render
  function forceWriteMasterHrDocsToBrowser(docsList) {
    return new Promise(function(resolve) {
      isInternalIdbWrite = true;
      var arr = Array.isArray(docsList) ? docsList : [];
      MASTER_HR_DOCS = arr.slice();

      // 1. Update in-memory reference if accessible
      try {
        if (typeof window.hrDocSetDocs === 'function') window.hrDocSetDocs(arr.slice());
      } catch (_) {}
      try {
        if (typeof window.hrDocGetDocs === 'function') {
          var ref = window.hrDocGetDocs();
          if (Array.isArray(ref)) {
            ref.length = 0;
            Array.prototype.push.apply(ref, arr);
          }
        }
      } catch (_) {}

      // 2. Overwrite all HR Doc arrays in localStorage
      var slim = arr.map(function(d) {
        var c = Object.assign({}, d);
        delete c.file_data;
        delete c.file_data_list;
        return c;
      });
      var slimStr = JSON.stringify(slim);

      try {
        for (var i = 0; i < localStorage.length; i++) {
          var k = localStorage.key(i);
          if (!k) continue;
          var kl = k.toLowerCase();
          if ((kl.indexOf('hr') >= 0 && kl.indexOf('doc') >= 0 && kl.indexOf('tomb') < 0) || kl === 'hr_documents') {
            localStorage.setItem(k, slimStr);
          }
        }
        localStorage.setItem('ATPL_HR_DOCS_V1', slimStr);
        localStorage.setItem('hr_documents', slimStr);
      } catch (_) {}

      // 3. Overwrite 'AroraTextilesHRDocs' IndexedDB completely
      if (typeof indexedDB === 'undefined') {
        isInternalIdbWrite = false;
        return resolve();
      }

      try {
        var req = indexedDB.open('AroraTextilesHRDocs', 1);
        req.onerror = function() {
          isInternalIdbWrite = false;
          resolve();
        };
        req.onsuccess = function(e) {
          var db = e.target.result;
          var stores = Array.from(db.objectStoreNames || []);
          if (stores.length === 0) {
            isInternalIdbWrite = false;
            return resolve();
          }
          var pending = stores.length;
          stores.forEach(function(sName) {
            try {
              var tx = db.transaction(sName, 'readwrite');
              var st = tx.objectStore(sName);
              st.clear();
              arr.forEach(function(doc) {
                if (doc && doc.id) {
                  try {
                    if (st.keyPath) st.put(doc);
                    else st.put(doc, doc.id);
                  } catch (_) {}
                }
              });
              tx.oncomplete = function() {
                pending--;
                if (pending <= 0) {
                  isInternalIdbWrite = false;
                  resolve();
                }
              };
              tx.onerror = function() {
                pending--;
                if (pending <= 0) {
                  isInternalIdbWrite = false;
                  resolve();
                }
              };
            } catch (_) {
              pending--;
              if (pending <= 0) {
                isInternalIdbWrite = false;
                resolve();
              }
            }
          });
        };
      } catch (_) {
        isInternalIdbWrite = false;
        resolve();
      }
    });
  }

  function createHybridArrayPayload(list, removedIds) {
    var out = Array.isArray(list) ? list.slice() : [];
    out.updated = true;
    out.docs = out;
    out.records = out;
    out.removedIds = Array.isArray(removedIds) ? removedIds : [];
    return out;
  }

  function notifyHrDocSubscribersAndUI(docsList, removedIds) {
    var payload = createHybridArrayPayload(docsList, removedIds);
    hrDocSubs.forEach(function(cb) {
      try { cb(payload); } catch (_) {}
    });
    // Call every known HR Doc reload/init/render function in index.html
    ['hrDocInit', 'initHrDocs', 'hrDocLoadFromDB', 'hrDocReload', 'hrDocRender'].forEach(function(fn) {
      if (typeof window[fn] === 'function') {
        try { window[fn](payload); } catch (_) {}
      }
    });
    clearHrSyncingIndicator();
  }

  function writeUniversalModuleToLocal(modName, cleanList) {
    var m = String(modName || '').toLowerCase().trim();
    if (!m) return;
    var arr = Array.isArray(cleanList) ? cleanList : [];
    window.ATPL_UNIVERSAL_VAULT[m] = arr;
    try {
      var slim = arr.map(function(item) {
        var c = Object.assign({}, item);
        delete c.original_b64;
        delete c.file_data;
        delete c.buf;
        return c;
      });
      localStorage.setItem('ATPL_MOD_CACHE_' + m.toUpperCase(), JSON.stringify(slim));
    } catch (_) {}
    try {
      window.dispatchEvent(new CustomEvent('atpl-dol-supabase-change', {
        detail: { type: m, action: 'sync', records: arr, at: Date.now() }
      }));
    } catch (_) {}
  }

  function syncIndexedDBExactMirror(activeNamesSet) {
    try {
      if (typeof indexedDB === 'undefined') return;
      var req = indexedDB.open('AroraTextiles', 1);
      req.onsuccess = function(e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains('salaryFiles')) return;
        var store = db.transaction('salaryFiles', 'readwrite').objectStore('salaryFiles');
        var cur = store.openCursor();
        cur.onsuccess = function(ev) {
          var c = ev.target.result;
          if (c) {
            var nm = String((c.value && c.value.name) || '').toLowerCase().trim();
            if (!nm || !activeNamesSet.has(nm)) c.delete();
            c.continue();
          }
        };
      };
    } catch (_) {}
  }

  function purgeLocalSalaryFile(name) {
    var targetName = String(name || '').toLowerCase().trim();
    if (!targetName) return;
    window.atplClearSessionUpload('salary', targetName);
    if (Array.isArray(window.FILES)) {
      window.FILES = window.FILES.filter(function(x) {
        return x && String(x.name || '').toLowerCase().trim() !== targetName && String(x.id || '').toLowerCase().trim() !== targetName;
      });
      if (typeof FILES !== 'undefined') FILES = window.FILES;
    }
    if (window.ATPLCentralFileSync && window.ATPLCentralFileSync.fileMap) {
      window.ATPLCentralFileSync.fileMap.delete(targetName);
    }
    scheduleDebouncedUIRefresh();
  }

  function purgeAllSalaryFilesLocal() {
    window.FILES = [];
    if (typeof FILES !== 'undefined') FILES = [];
    if (window.ATPLCentralFileSync && window.ATPLCentralFileSync.fileMap) {
      window.ATPLCentralFileSync.fileMap.clear();
    }
    scheduleDebouncedUIRefresh();
  }

  async function purgeLocalHrDoc(id, name) {
    var targetId = String(id || '').toLowerCase().trim();
    var targetName = String(name || '').toLowerCase().trim();
    if (targetId) HR_TOMBSTONE_IDS.add(targetId);
    if (targetName) HR_TOMBSTONE_IDS.add(targetName);

    var kept = MASTER_HR_DOCS.filter(function(d) {
      if (!d) return false;
      var did = String(d.id || '').toLowerCase().trim();
      var dnm = String(d.document_name || d.name || '').toLowerCase().trim();
      return did !== targetId && (targetName ? dnm !== targetName : true);
    });
    await forceWriteMasterHrDocsToBrowser(kept);
    notifyHrDocSubscribersAndUI(kept, [id || name]);
  }

  function purgeLocalCompliance(mod, id, name) {
    var modType = String(mod || 'pf').toLowerCase().trim();
    var targetId = String(id || '').toLowerCase().trim();
    var targetNm = String(name || '').toLowerCase().trim();
    if (Array.isArray(window.ATPL_UNIVERSAL_VAULT[modType])) {
      window.ATPL_UNIVERSAL_VAULT[modType] = window.ATPL_UNIVERSAL_VAULT[modType].filter(function(item) {
        if (!item) return false;
        var iid = String(item.id || '').toLowerCase().trim();
        var inm = String(item.name || item.filename || '').toLowerCase().trim();
        return iid !== targetId && inm !== targetNm;
      });
      writeUniversalModuleToLocal(modType, window.ATPL_UNIVERSAL_VAULT[modType]);
    }
  }

  var uiRefreshTimer = null;
  function scheduleDebouncedUIRefresh() {
    if (uiRefreshTimer) clearTimeout(uiRefreshTimer);
    uiRefreshTimer = setTimeout(function() {
      uiRefreshTimer = null;
      refreshAllUIImmediate();
    }, 180);
  }

  function refreshAllUIImmediate() {
    var count = Array.isArray(window.FILES) ? window.FILES.length : 0;
    if (typeof window.renderFiles === 'function') { try { window.renderFiles(); } catch (_) {} }
    if (typeof window.renderSheets === 'function') { try { window.renderSheets(); } catch (_) {} }
    if (typeof window.updStats === 'function') { try { window.updStats(); } catch (_) {} }
    if (typeof window.renderAllFilesPage === 'function') { try { window.renderAllFilesPage(); } catch (_) {} }
    if (typeof window.populateNJSelects === 'function') { try { window.populateNJSelects(); } catch (_) {} }
    if (typeof window.initStatutoryChallanTab === 'function') { try { window.initStatutoryChallanTab(); } catch (_) {} }
    if (typeof window.empDashboardRender === 'function') { try { window.empDashboardRender(); } catch (_) {} }
    if (typeof window.hrDocRender === 'function') { try { window.hrDocRender(); } catch (_) {} }
    if (typeof window.updateRealtimeCloudBadge === 'function') {
      try { window.updateRealtimeCloudBadge(count, 'ok', '🟢 Google Drive Sync (' + count + ' files)'); } catch (_) {}
    }
    clearHrSyncingIndicator();
  }

  async function waitForExcelParser(maxWaitMs) {
    var start = Date.now();
    while (typeof window.parseWB !== 'function') {
      if (Date.now() - start > (maxWaitMs || 6000)) break;
      await yieldToUI(120);
    }
    return typeof window.parseWB === 'function';
  }

  var lastSeenVersion = -1;
  var isSyncingNow = false;
  var salarySubs = [];
  var hrDocSubs = [];
  var dolSubs = {};
  var pushedLocalHrIds = new Set();

  // ── MASTER UNIVERSAL RECONCILIATION ──
  async function triggerUniversalReconciliation(forceDownloadCheck) {
    if (isSyncingNow || window.__ATPL_IS_UPLOADING) return;
    var gasUrl = getGasUrl();
    if (!gasUrl || gasUrl.indexOf('https://script.google.com') !== 0) return;

    isSyncingNow = true;
    try {
      var manifest = await gasGet({ action: 'manifest', nocache: forceDownloadCheck ? '1' : '' });
      if (!manifest || !manifest.ok) {
        clearHrSyncingIndicator();
        return;
      }

      var allFiles = Array.isArray(manifest.files) ? manifest.files : [];
      var allTombs = Array.isArray(manifest.tombstones) ? manifest.tombstones : [];

      // Collect Tombstones
      var moduleTombstones = {};
      allTombs.forEach(function(t) {
        var mod = String(t.module || '').toLowerCase().trim();
        if (!moduleTombstones[mod]) moduleTombstones[mod] = new Set();
        if (t.id) moduleTombstones[mod].add(String(t.id).toLowerCase().trim());
        if (t.name) moduleTombstones[mod].add(String(t.name).toLowerCase().trim());
        if (mod === 'hr_doc') {
          if (t.id) HR_TOMBSTONE_IDS.add(String(t.id).toLowerCase().trim());
          if (t.name) HR_TOMBSTONE_IDS.add(String(t.name).toLowerCase().trim());
        }
      });

      // 1. HR DOCUMENTS DEEP SYNC
      var remoteHr = allFiles.filter(function(f) { return f.module === 'hr_doc'; });
      var uniqueRemoteHrMap = new Map();
      remoteHr.forEach(function(hf) {
        var hid = String(hf.id || hf.name || '').toLowerCase().trim();
        if (hid && !HR_TOMBSTONE_IDS.has(hid)) uniqueRemoteHrMap.set(hid, hf);
      });

      // Scan browser's IndexedDB & localStorage for any local HR docs not yet on Google Drive
      var browserLocalHrDocs = await scanAllBrowserHrStores();
      for (var u = 0; u < browserLocalHrDocs.length; u++) {
        var lDoc = browserLocalHrDocs[u];
        var lidLow = String(lDoc.id || '').toLowerCase().trim();
        var lnmLow = String(lDoc.document_name || '').toLowerCase().trim();
        if (!lidLow || HR_TOMBSTONE_IDS.has(lidLow) || (lnmLow && HR_TOMBSTONE_IDS.has(lnmLow))) continue;

        if (!uniqueRemoteHrMap.has(lidLow) && !pushedLocalHrIds.has(lidLow)) {
          pushedLocalHrIds.add(lidLow);
          try {
            var slimMeta = Object.assign({}, lDoc);
            delete slimMeta.file_data;
            delete slimMeta.file_data_list;
            await gasPost({
              action: 'save_file',
              module: 'hr_doc',
              id: lDoc.id,
              name: lDoc.document_name || lDoc.id,
              updated_at: lDoc.updated_at || new Date().toISOString(),
              meta: slimMeta,
              payload: lDoc
            });
            uniqueRemoteHrMap.set(lidLow, {
              id: lDoc.id,
              name: lDoc.document_name || lDoc.id,
              updated_at: lDoc.updated_at || new Date().toISOString(),
              meta: slimMeta
            });
            await yieldToUI(20);
          } catch (_) {}
        }
      }

      // Build final authoritative HR Docs list from Google Sheet manifest
      var cleanRemoteHrList = Array.from(uniqueRemoteHrMap.values());
      var localHrMap = new Map();
      browserLocalHrDocs.forEach(function(d) {
        if (d && d.id) localHrMap.set(String(d.id).toLowerCase().trim(), d);
      });

      var finalHrDocs = [];
      for (var hIdx = 0; hIdx < cleanRemoteHrList.length; hIdx++) {
        var rDoc = cleanRemoteHrList[hIdx];
        var ridLow = String(rDoc.id || rDoc.name || '').toLowerCase().trim();
        if (!ridLow || HR_TOMBSTONE_IDS.has(ridLow)) continue;

        var metaObj = (rDoc.meta && typeof rDoc.meta === 'object') ? rDoc.meta : {};
        var localExisting = localHrMap.get(ridLow) || {};

        if (!metaObj.document_name && !localExisting.document_name && rDoc.drive_id) {
          try {
            var fullHr = await gasGet({ action: 'get_file', drive_id: rDoc.drive_id, key: rDoc.key });
            if (fullHr && fullHr.ok && fullHr.payload) {
              var parsedHr = typeof fullHr.payload === 'string' ? JSON.parse(fullHr.payload) : fullHr.payload;
              if (parsedHr && typeof parsedHr === 'object') metaObj = parsedHr;
            }
            await yieldToUI(20);
          } catch (_) {}
        }

        var docTitle = metaObj.document_name || localExisting.document_name || metaObj.name || rDoc.name || rDoc.id;
        finalHrDocs.push(Object.assign({}, localExisting, metaObj, {
          id: rDoc.id || metaObj.id || docTitle,
          document_name: docTitle,
          name: docTitle,
          drive_id: rDoc.drive_id || localExisting.drive_id || '',
          key: rDoc.key || localExisting.key || ('hr_doc:' + ridLow),
          updated_at: rDoc.updated_at || metaObj.updated_at || localExisting.updated_at || new Date().toISOString()
        }));
      }

      var hrChanged = finalHrDocs.length !== MASTER_HR_DOCS.length || forceDownloadCheck || manifest.version !== lastSeenVersion;
      if (hrChanged) {
        await forceWriteMasterHrDocsToBrowser(finalHrDocs);
        notifyHrDocSubscribersAndUI(finalHrDocs, Array.from(HR_TOMBSTONE_IDS));
      } else {
        clearHrSyncingIndicator();
      }

      // 2. SALARY FILES SYNC
      var remoteSalary = allFiles.filter(function(f) { return f.module === 'salary'; });
      var uniqueRemoteSalMap = new Map();
      remoteSalary.forEach(function(rf) {
        var nm = String(rf.name || '').toLowerCase().trim();
        if (nm && !(moduleTombstones.salary && moduleTombstones.salary.has(nm))) {
          uniqueRemoteSalMap.set(nm, rf);
        }
      });
      var cleanRemoteSalList = Array.from(uniqueRemoteSalMap.values());
      var activeSalNames = new Set(uniqueRemoteSalMap.keys());

      var anySalChange = false;
      if (Array.isArray(window.FILES)) {
        var seenLocal = new Set();
        var strictlyFiltered = [];
        for (var k = 0; k < window.FILES.length; k++) {
          var lf = window.FILES[k];
          var lnm = String((lf && lf.name) || '').toLowerCase().trim();
          if (!lnm || seenLocal.has(lnm)) { anySalChange = true; continue; }
          if (activeSalNames.has(lnm) || window.atplIsRecentSessionUpload('salary', lnm, 45000)) {
            seenLocal.add(lnm);
            strictlyFiltered.push(lf);
          } else {
            anySalChange = true;
          }
        }
        if (anySalChange) {
          window.FILES = strictlyFiltered;
          if (typeof FILES !== 'undefined') FILES = window.FILES;
        }
      } else {
        window.FILES = [];
        if (typeof FILES !== 'undefined') FILES = window.FILES;
      }

      syncIndexedDBExactMirror(activeSalNames);

      var validLocalSet = new Set();
      window.FILES.forEach(function(f) {
        if (f && f.name && f.wb) validLocalSet.add(String(f.name).toLowerCase().trim());
      });

      var missingSalary = cleanRemoteSalList.filter(function(rSal) {
        var rNameLow = String(rSal.name || '').toLowerCase().trim();
        return rNameLow && !validLocalSet.has(rNameLow);
      });

      if (missingSalary.length > 0) {
        await waitForExcelParser(6000);
        for (var m = 0; m < missingSalary.length; m++) {
          var rSal = missingSalary[m];
          try {
            var rNameLow = String(rSal.name || '').toLowerCase().trim();
            var fRes = await gasGet({ action: 'get_file', drive_id: rSal.drive_id, key: rSal.key });
            if (fRes && fRes.ok && fRes.payload) {
              await yieldToUI(35);
              var b64 = typeof fRes.payload === 'string' ? fRes.payload : (fRes.payload.original_b64 || fRes.payload.buf || '');
              var rawBuf = base64ToArrayBuffer(b64);
              if (rawBuf && rawBuf.byteLength > 0 && typeof window.parseWB === 'function') {
                await yieldToUI(35);
                var wb = window.parseWB(rawBuf);
                await yieldToUI(25);
                var sheets = typeof window.wbToSheets === 'function' ? window.wbToSheets(wb) : {};
                var entry = {
                  id: rSal.id || rSal.name,
                  name: rSal.name,
                  wb: wb,
                  sheets: sheets,
                  buf: rawBuf,
                  fromDB: true,
                  savedAt: rSal.updated_at || new Date().toISOString()
                };
                window.FILES = (window.FILES || []).filter(function(x) { return x && String(x.name).toLowerCase().trim() !== rNameLow; });
                window.FILES.push(entry);
                if (typeof FILES !== 'undefined') FILES = window.FILES;
                if (window.ATPLCentralFileSync && window.ATPLCentralFileSync.fileMap) {
                  window.ATPLCentralFileSync.fileMap.set(rNameLow, entry);
                }
                try {
                  var idbReq = indexedDB.open('AroraTextiles', 1);
                  idbReq.onsuccess = function(ev) {
                    var db = ev.target.result;
                    if (db.objectStoreNames.contains('salaryFiles')) {
                      db.transaction('salaryFiles', 'readwrite').objectStore('salaryFiles').put({
                        name: rSal.name, buf: rawBuf, saved: rSal.updated_at || new Date().toISOString()
                      });
                    }
                  };
                } catch (_) {}
                anySalChange = true;
              }
            }
          } catch (_) {}
          await yieldToUI(40);
        }
      }

      if (window.FILES.length === cleanRemoteSalList.length) {
        lastSeenVersion = manifest.version;
      }

      if (anySalChange || hrChanged) {
        salarySubs.forEach(function(cb) { try { cb({ updated: true, removedNames: [] }); } catch (_) {} });
        scheduleDebouncedUIRefresh();
      }
    } catch (err) {
      console.warn('[ATPL Interceptor Sync] Notice:', err && err.message);
      clearHrSyncingIndicator();
    } finally {
      isSyncingNow = false;
    }
  }

  var GoogleDriveEngine = {
    version: '2026.11.10-HR-INTERCEPTOR-MASTER',
    init: function() {
      setTimeout(function() { triggerUniversalReconciliation(true); }, 900);
      return this;
    },
    saveSalaryFile: async function(name, payloadObj, meta) {
      window.atplMarkSessionUpload('salary', name);
      var b64 = (payloadObj && (payloadObj.original_b64 || payloadObj.buf)) || (typeof payloadObj === 'string' ? payloadObj : '');
      var updatedAt = (meta && meta.saved_at) || new Date().toISOString();
      await gasPost({
        action: 'save_file', module: 'salary', id: name, name: name, size: b64.length,
        updated_at: updatedAt, meta: meta || { name: name, saved_at: updatedAt },
        payload: { original_b64: b64, name: name }
      });
      await triggerUniversalReconciliation(true);
      return true;
    },
    deleteSalaryFile: async function(name) {
      purgeLocalSalaryFile(name);
      await gasPost({ action: 'delete_file', module: 'salary', id: name, name: name });
      await triggerUniversalReconciliation(true);
      return true;
    },
    clearAllSalaryFiles: async function() {
      purgeAllSalaryFilesLocal();
      await gasPost({ action: 'clear_module', module: 'salary' });
      await triggerUniversalReconciliation(true);
      return true;
    },
    fetchAllSalaryFiles: async function() {
      var m = await gasGet({ action: 'manifest', nocache: '1' });
      if (!m || !Array.isArray(m.files)) return [];
      return m.files.filter(function(f) { return f.module === 'salary'; }).map(function(f) {
        return { id: f.id || f.name, name: f.name, drive_id: f.drive_id, key: f.key, size: f.size || 0, saved_at: f.updated_at, uploaded_at: f.updated_at };
      });
    },
    fetchAllTombstones: async function() {
      var m = await gasGet({ action: 'manifest' });
      if (!m || !Array.isArray(m.tombstones)) return [];
      return m.tombstones.filter(function(t) { return t.module === 'salary'; });
    },
    decodeDocPayload: async function(doc) {
      if (!doc) return null;
      if (doc.original_b64) return doc;
      var res = await gasGet({ action: 'get_file', drive_id: doc.drive_id || '', key: doc.key || ('salary:' + String(doc.name || doc.id).toLowerCase()) });
      return (res && res.ok && res.payload) ? (typeof res.payload === 'string' ? { original_b64: res.payload, name: doc.name } : res.payload) : null;
    },
    saveHrDoc: async function(doc) {
      if (!doc) return false;
      var docId = String(doc.id || doc.doc_id || doc.document_name || ('hr_' + Date.now())).trim();
      doc.id = docId;
      var docName = String(doc.document_name || doc.name || docId).trim();
      doc.document_name = docName;

      var idLow = docId.toLowerCase();
      HR_TOMBSTONE_IDS.delete(idLow);
      HR_TOMBSTONE_IDS.delete(docName.toLowerCase());
      window.atplMarkSessionUpload('hr_doc', docId);
      pushedLocalHrIds.add(idLow);

      var slimMeta = Object.assign({}, doc);
      delete slimMeta.file_data;
      delete slimMeta.file_data_list;

      await gasPost({
        action: 'save_file',
        module: 'hr_doc',
        id: docId,
        name: docName,
        updated_at: doc.updated_at || new Date().toISOString(),
        meta: slimMeta,
        payload: doc
      });
      await triggerUniversalReconciliation(true);
      return true;
    },
    deleteHrDoc: async function(id, name) {
      await purgeLocalHrDoc(id, name);
      await gasPost({ action: 'delete_file', module: 'hr_doc', id: id || name, name: name || id });
      await triggerUniversalReconciliation(true);
      return true;
    },
    fetchAllHrDocs: async function() {
      await triggerUniversalReconciliation(true);
      return createHybridArrayPayload(MASTER_HR_DOCS, Array.from(HR_TOMBSTONE_IDS));
    },
    fetchAllHrTombstones: async function() {
      var m = await gasGet({ action: 'manifest' });
      if (!m || !Array.isArray(m.tombstones)) return [];
      return m.tombstones.filter(function(t) { return t.module === 'hr_doc'; });
    },
    decodeHrPayload: async function(doc) {
      if (!doc) return null;
      if (doc.file_data || doc.file_data_list) return doc;
      var res = await gasGet({ action: 'get_file', drive_id: doc.drive_id || '', key: doc.key || ('hr_doc:' + String(doc.id).toLowerCase()) });
      if (res && res.ok && res.payload) {
        var parsed = typeof res.payload === 'string' ? JSON.parse(res.payload) : res.payload;
        return Object.assign({}, doc, parsed || {});
      }
      return doc;
    },
    saveComplianceDoc: async function(module, name, payload) {
      var mod = String(module || 'pf').toLowerCase().trim();
      var obj = typeof payload === 'string' ? JSON.parse(payload) : (payload || {});
      var recId = String(obj.id || name || ('doc_' + Date.now())).trim();
      var recName = String(name || obj.name || obj.filename || recId).trim();
      window.atplMarkSessionUpload(mod, recId);

      var slimMeta = Object.assign({}, obj, { id: recId, name: recName, module: mod });
      delete slimMeta.original_b64;
      delete slimMeta.file_data;
      delete slimMeta.buf;

      await gasPost({
        action: 'save_file',
        module: mod,
        id: recId,
        name: recName,
        updated_at: new Date().toISOString(),
        meta: slimMeta,
        payload: obj
      });
      await triggerUniversalReconciliation(true);
      return true;
    },
    deleteComplianceDoc: async function(module, name, id, hash) {
      var mod = String(module || 'pf').toLowerCase().trim();
      purgeLocalCompliance(mod, id || name, name);
      await gasPost({ action: 'delete_file', module: mod, id: id || name, name: name || id, file_hash: hash || '' });
      await triggerUniversalReconciliation(true);
      return true;
    },
    saveDolRecord: async function(type, rec, b64) {
      var copy = Object.assign({}, rec || {});
      if (b64) copy.original_b64 = b64;
      return await this.saveComplianceDoc(type, copy.name || copy.id, copy);
    },
    deleteDolRecord: async function(type, id, name, hash) {
      return await this.deleteComplianceDoc(type, name || id, id, hash);
    },
    fetchAllDolRecords: async function(type) {
      var mod = String(type || 'esic').toLowerCase().trim();
      var m = await gasGet({ action: 'manifest', nocache: '1' });
      if (!m || !Array.isArray(m.files)) return [];
      var list = m.files.filter(function(f) { return String(f.module || '').toLowerCase() === mod; });
      var out = [];
      for (var i = 0; i < list.length; i++) {
        var item = list[i];
        var full = await gasGet({ action: 'get_file', drive_id: item.drive_id, key: item.key });
        if (full && full.ok && full.payload) {
          var parsed = typeof full.payload === 'string' ? JSON.parse(full.payload) : full.payload;
          out.push(Object.assign({}, item.meta || {}, parsed, { id: item.id, name: item.name, drive_id: item.drive_id, updated_at: item.updated_at }));
        }
        await yieldToUI(20);
      }
      writeUniversalModuleToLocal(mod, out);
      return out;
    },
    fetchAllDolTombstones: async function(type) {
      var mod = String(type || 'esic').toLowerCase().trim();
      var m = await gasGet({ action: 'manifest' });
      if (!m || !Array.isArray(m.tombstones)) return [];
      return m.tombstones.filter(function(t) { return String(t.module || '').toLowerCase() === mod; });
    },
    decodeDolPayload: async function(rec) {
      if (!rec) return null;
      if (rec.original_b64 || rec.contributions || rec.file_data) return rec;
      var res = await gasGet({ action: 'get_file', drive_id: rec.drive_id || '', key: rec.key || '' });
      return (res && res.ok && res.payload) ? res.payload : rec;
    },
    saveEmployeeMaster: async function(records) {
      await gasPost({ action: 'save_emp_master', records: records || [] });
      return true;
    },
    fetchAllEmployeeMaster: async function() {
      var res = await gasGet({ action: 'get_emp_master' });
      return (res && res.ok && Array.isArray(res.records)) ? res.records : [];
    },
    subscribeSalaryFiles: function(cb) {
      if (typeof cb === 'function') {
        salarySubs.push(cb);
        setTimeout(function() { try { cb({ updated: true, removedNames: [] }); } catch (_) {} }, 600);
      }
      return function() {};
    },
    subscribeTombstones: function(cb) {
      if (typeof cb === 'function') setTimeout(function() { try { cb([]); } catch (_) {} }, 600);
      return function() {};
    },
    subscribeHrDocs: function(cb) {
      if (typeof cb === 'function') {
        hrDocSubs.push(cb);
        setTimeout(function() {
          try { cb(createHybridArrayPayload(MASTER_HR_DOCS, Array.from(HR_TOMBSTONE_IDS))); } catch (_) {}
          clearHrSyncingIndicator();
        }, 700);
      }
      return function() {};
    },
    subscribeHrTombstones: function(cb) {
      if (typeof cb === 'function') setTimeout(function() { try { cb([]); } catch (_) {} }, 600);
      return function() {};
    },
    subscribeDolRecords: function(type, cb) {
      var mod = String(type || 'pf').toLowerCase().trim();
      if (typeof cb === 'function') {
        if (!dolSubs[mod]) dolSubs[mod] = [];
        dolSubs[mod].push(cb);
      }
      return function() {};
    },
    subscribeDolTombstones: function(type, cb) {
      if (typeof cb === 'function') setTimeout(function() { try { cb([]); } catch (_) {} }, 600);
      return function() {};
    },
    subscribeEmployeeMaster: function() { return function() {}; },
    triggerUniversalReconciliation: triggerUniversalReconciliation,
    reconcileSalaryFiles: function() { return triggerUniversalReconciliation(true); },
    reconcileHrDocs: function() { return triggerUniversalReconciliation(true); },
    reconcileCompliance: function() { return triggerUniversalReconciliation(true); },
    purgeLocalSalaryFile: purgeLocalSalaryFile,
    purgeAllSalaryFilesLocal: purgeAllSalaryFilesLocal,
    purgeLocalHrDoc: purgeLocalHrDoc,
    purgeLocalCompliance: purgeLocalCompliance
  };

  window.ATPLRealtimeSyncEngine = GoogleDriveEngine;
  window.ATPLRealtimeSync = GoogleDriveEngine;
  window.ATPLFirebase = GoogleDriveEngine;
  window.ATPLNativeFirebase = GoogleDriveEngine;
  window.UniversalEngine = GoogleDriveEngine;
  window.ATPLSyncEngine = GoogleDriveEngine;

  window.triggerManualCrossBrowserSync = function() {
    if (window.showToast) window.showToast('🔄 Syncing all modules with Google Drive...');
    triggerUniversalReconciliation(true);
  };
  window.atplTriggerCrossSug = function() {
    triggerUniversalReconciliation(true);
  };

  setTimeout(function() { triggerUniversalReconciliation(true); }, 900);

  setInterval(function() {
    if (!document.hidden && !window.__ATPL_IS_UPLOADING) {
      triggerUniversalReconciliation(false);
    }
  }, 5000);
})(window);
