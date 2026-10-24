/**
 * ATPL Universal Real-Time Sync Engine — ALL-MODULES EDITION
 * Zero-Hang + 100% Real-Time Google Drive Sync for:
 * Salary, HR Docs, PF, ESIC, Statutory Challans & ANY Future Module!
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

  // Disable legacy backends completely
  window.__atplFirebaseQuotaExhausted = true;
  window.LIVE_CLOUD_RUN_URL = '';
  window.__ATPL_CENTRAL_BACKEND_URL = '';
  window.ATPL_GET_API_BASE = function() { return ''; };
  window.ATPLCloudSharedStorageV1 = {
    syncNow: async function() {},
    syncHrNow: async function() {},
    saveSalary: async function() {},
    saveHrDoc: async function() {},
    deleteHrDoc: async function() {}
  };

  // Universal Vault in RAM for PF, ESIC, Challans & any future modules
  window.ATPL_UNIVERSAL_VAULT = window.ATPL_UNIVERSAL_VAULT || {
    pf: [],
    esic: [],
    challan: []
  };

  function yieldToUI(ms) {
    return new Promise(function(resolve) {
      if (typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(function() {
          setTimeout(resolve, ms || 35);
        });
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

  async function waitForExcelParser(maxWaitMs) {
    var start = Date.now();
    while (typeof window.parseWB !== 'function') {
      if (Date.now() - start > (maxWaitMs || 6000)) break;
      await yieldToUI(120);
    }
    return typeof window.parseWB === 'function';
  }

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

  // ── STRICT HR DOCUMENTS STORAGE SYNCHRONIZER ──
  function writeHrDocsToAllLocalStores(cleanDocsList) {
    var arr = Array.isArray(cleanDocsList) ? cleanDocsList : [];

    if (typeof window.hrDocGetDocs === 'function') {
      try {
        var mem = window.hrDocGetDocs();
        if (Array.isArray(mem) && mem !== arr) {
          mem.length = 0;
          Array.prototype.push.apply(mem, arr);
        }
      } catch (_) {}
    }
    if (Array.isArray(window.HR_DOCS)) window.HR_DOCS = arr;
    if (Array.isArray(window.hrDocs)) window.hrDocs = arr;

    var slimList = arr.map(function(d) {
      var copy = Object.assign({}, d);
      delete copy.file_data;
      delete copy.file_data_list;
      return copy;
    });
    var slimJson = JSON.stringify(slimList);
    ['ATPL_HR_DOCS', 'ATPL_HR_DOCS_V1', 'ATPL_HR_DOCS_CACHE', 'hr_documents', 'arora_hr_docs'].forEach(function(k) {
      try {
        if (localStorage.getItem(k) !== null) localStorage.setItem(k, slimJson);
      } catch (_) {}
    });

    try {
      if (typeof indexedDB !== 'undefined') {
        var req = indexedDB.open('AroraTextilesHRDocs', 1);
        req.onsuccess = function(e) {
          var db = e.target.result;
          if (!db.objectStoreNames.contains('documents')) return;
          var tx = db.transaction('documents', 'readwrite');
          var store = tx.objectStore('documents');
          var validIds = new Set(arr.map(function(d) { return String(d.id || '').toLowerCase().trim(); }));

          var cur = store.openCursor();
          cur.onsuccess = function(ev) {
            var c = ev.target.result;
            if (c) {
              var cid = String((c.value && c.value.id) || '').toLowerCase().trim();
              if (!cid || !validIds.has(cid)) {
                try { c.delete(); } catch (_) {}
              }
              c.continue();
            }
          };

          arr.forEach(function(doc) {
            if (doc && doc.id) {
              try { store.put(doc); } catch (_) {}
            }
          });
        };
      }
    } catch (_) {}
  }

  // ── UNIVERSAL MODULE STORAGE SYNCHRONIZER (PF, ESIC, Challans & Future Modules) ──
  function writeUniversalModuleToLocal(modName, cleanList) {
    var m = String(modName || '').toLowerCase().trim();
    if (!m) return;
    var arr = Array.isArray(cleanList) ? cleanList : [];
    window.ATPL_UNIVERSAL_VAULT[m] = arr;

    // Save slim metadata to localStorage so modules can read instantly on boot
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

    // Fire cross-module browser events so PF, ESIC, Challan & Custom UIs auto-refresh
    try {
      window.dispatchEvent(new CustomEvent('atpl-dol-supabase-change', {
        detail: { type: m, action: 'sync', records: arr, at: Date.now() }
      }));
      window.dispatchEvent(new CustomEvent('atpl-universal-module-sync', {
        detail: { module: m, records: arr, count: arr.length, at: Date.now() }
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
            if (!nm || !activeNamesSet.has(nm)) {
              c.delete();
            }
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
    try {
      var req = indexedDB.open('AroraTextiles', 1);
      req.onsuccess = function(e) {
        var db = e.target.result;
        if (db.objectStoreNames.contains('salaryFiles')) {
          var store = db.transaction('salaryFiles', 'readwrite').objectStore('salaryFiles');
          try { store.delete(name); } catch (_) {}
        }
      };
    } catch (_) {}
    scheduleDebouncedUIRefresh();
  }

  function purgeAllSalaryFilesLocal() {
    window.FILES = [];
    if (typeof FILES !== 'undefined') FILES = [];
    if (window.ATPLCentralFileSync && window.ATPLCentralFileSync.fileMap) {
      window.ATPLCentralFileSync.fileMap.clear();
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
    scheduleDebouncedUIRefresh();
  }

  function purgeLocalHrDoc(id, name, deletedAtIso) {
    var targetId = String(id || '').toLowerCase().trim();
    var targetName = String(name || '').toLowerCase().trim();
    if (!targetId && !targetName) return;
    window.atplClearSessionUpload('hr_doc', targetId);

    var stamp = deletedAtIso || new Date().toISOString();
    ['ATPL_HR_TOMBSTONES_V1', 'ATPL_HR_TOMBSTONES_V2'].forEach(function(k) {
      try {
        var t = JSON.parse(localStorage.getItem(k) || '{}');
        if (targetId) t[targetId] = stamp;
        if (targetName) t[targetName] = stamp;
        localStorage.setItem(k, JSON.stringify(t));
      } catch (_) {}
    });

    if (typeof window.hrDocGetDocs === 'function') {
      var docs = window.hrDocGetDocs();
      if (Array.isArray(docs)) {
        var kept = docs.filter(function(d) {
          if (!d) return false;
          var did = String(d.id || '').toLowerCase().trim();
          var dnm = String(d.document_name || '').toLowerCase().trim();
          return did !== targetId && (targetName ? dnm !== targetName : true);
        });
        writeHrDocsToAllLocalStores(kept);
      }
    }
    if (typeof window.hrDocRender === 'function') {
      try { window.hrDocRender(); } catch (_) {}
    }
  }

  function purgeLocalCompliance(mod, id, name) {
    var modType = String(mod || 'pf').toLowerCase().trim();
    var targetId = String(id || '').toLowerCase().trim();
    var targetNm = String(name || '').toLowerCase().trim();
    window.atplClearSessionUpload(modType, targetId || targetNm);

    if (Array.isArray(window.ATPL_UNIVERSAL_VAULT[modType])) {
      window.ATPL_UNIVERSAL_VAULT[modType] = window.ATPL_UNIVERSAL_VAULT[modType].filter(function(item) {
        if (!item) return false;
        var iid = String(item.id || '').toLowerCase().trim();
        var inm = String(item.name || item.filename || '').toLowerCase().trim();
        return iid !== targetId && inm !== targetNm && iid !== targetNm && inm !== targetId;
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
    if (typeof window.pfRender === 'function') { try { window.pfRender(); } catch (_) {} }
    if (typeof window.esicRender === 'function') { try { window.esicRender(); } catch (_) {} }
    if (typeof window.updateRealtimeCloudBadge === 'function') {
      try { window.updateRealtimeCloudBadge(count, 'ok', '🟢 Google Drive Sync (' + count + ' files)'); } catch (_) {}
    }
    clearHrSyncingIndicator();
  }

  var lastSeenVersion = -1;
  var isSyncingNow = false;
  var salarySubs = [];
  var hrDocSubs = [];
  var dolSubs = {}; // module -> [callbacks]
  var pushedLocalHrIds = new Set();

  // ── UNIVERSAL RECONCILIATION (Salary + HR Docs + PF + ESIC + Challans + Any Future Module) ──
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

      var remoteSalary = allFiles.filter(function(f) { return f.module === 'salary'; });
      var uniqueRemoteSalMap = new Map();
      remoteSalary.forEach(function(rf) {
        var nm = String(rf.name || '').toLowerCase().trim();
        if (nm) uniqueRemoteSalMap.set(nm, rf);
      });
      var cleanRemoteSalList = Array.from(uniqueRemoteSalMap.values());
      var activeSalNames = new Set(uniqueRemoteSalMap.keys());

      var remoteHr = allFiles.filter(function(f) { return f.module === 'hr_doc'; });
      var uniqueRemoteHrMap = new Map();
      remoteHr.forEach(function(hf) {
        var hid = String(hf.id || '').toLowerCase().trim();
        if (hid) uniqueRemoteHrMap.set(hid, hf);
      });
      var cleanRemoteHrList = Array.from(uniqueRemoteHrMap.values());

      var hrTombstoneIds = new Set();
      var hrTombstoneNames = new Set();
      var moduleTombstones = {}; // mod -> Set of deleted keys
      allTombs.forEach(function(t) {
        var mod = String(t.module || '').toLowerCase().trim();
        if (!moduleTombstones[mod]) moduleTombstones[mod] = new Set();
        if (t.id) moduleTombstones[mod].add(String(t.id).toLowerCase().trim());
        if (t.name) moduleTombstones[mod].add(String(t.name).toLowerCase().trim());
        if (mod === 'hr_doc') {
          if (t.id) hrTombstoneIds.add(String(t.id).toLowerCase().trim());
          if (t.name) hrTombstoneNames.add(String(t.name).toLowerCase().trim());
        }
      });

      var localSalaryCount = Array.isArray(window.FILES) ? window.FILES.length : 0;
      var currentLocalHrDocs = (typeof window.hrDocGetDocs === 'function' && Array.isArray(window.hrDocGetDocs())) ? window.hrDocGetDocs() : [];
      var localHrCount = currentLocalHrDocs.length;

      if (!forceDownloadCheck &&
          manifest.version === lastSeenVersion &&
          localSalaryCount === cleanRemoteSalList.length &&
          localHrCount === cleanRemoteHrList.length) {
        clearHrSyncingIndicator();
        return;
      }

      var anyChange = false;

      // 1. Apply Tombstones across ALL modules
      allTombs.forEach(function(t) {
        var mod = String(t.module || '').toLowerCase().trim();
        if (mod === 'salary') {
          if (t.name === '__ALL__' || t.id === '__ALL__') purgeAllSalaryFilesLocal();
          else purgeLocalSalaryFile(t.name || t.id);
        } else if (mod === 'hr_doc') {
          purgeLocalHrDoc(t.id, t.name, t.deleted_at);
        } else {
          purgeLocalCompliance(mod, t.id, t.name);
        }
      });

      // 2. HR DOCUMENTS TWO-WAY MERGE & STRICT MIRROR
      if (currentLocalHrDocs.length > 0) {
        for (var u = 0; u < currentLocalHrDocs.length; u++) {
          var lDoc = currentLocalHrDocs[u];
          if (!lDoc || !lDoc.id) continue;
          var lidLow = String(lDoc.id).toLowerCase().trim();
          var lnmLow = String(lDoc.document_name || '').toLowerCase().trim();
          var isDeleted = hrTombstoneIds.has(lidLow) || (lnmLow && hrTombstoneNames.has(lnmLow));

          if (!uniqueRemoteHrMap.has(lidLow) && !isDeleted && !pushedLocalHrIds.has(lidLow)) {
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
              anyChange = true;
              await yieldToUI(25);
            } catch (_) {}
          }
        }
        cleanRemoteHrList = Array.from(uniqueRemoteHrMap.values());
      }

      var finalHrDocs = [];
      var existingLocalHrMap = new Map();
      currentLocalHrDocs.forEach(function(d) {
        if (d && d.id) existingLocalHrMap.set(String(d.id).toLowerCase().trim(), d);
      });

      for (var hIdx = 0; hIdx < cleanRemoteHrList.length; hIdx++) {
        var rDoc = cleanRemoteHrList[hIdx];
        var ridLow = String(rDoc.id || '').toLowerCase().trim();
        if (!ridLow || hrTombstoneIds.has(ridLow)) continue;

        var metaObj = (rDoc.meta && typeof rDoc.meta === 'object') ? rDoc.meta : {};
        var localExisting = existingLocalHrMap.get(ridLow) || {};

        if (!metaObj.document_name && !localExisting.document_name && rDoc.drive_id) {
          try {
            var fullHr = await gasGet({ action: 'get_file', drive_id: rDoc.drive_id, key: rDoc.key });
            if (fullHr && fullHr.ok && fullHr.payload && typeof fullHr.payload === 'object') {
              metaObj = fullHr.payload;
            }
            await yieldToUI(20);
          } catch (_) {}
        }

        var mergedDoc = Object.assign({}, localExisting, metaObj, {
          id: rDoc.id,
          document_name: metaObj.document_name || localExisting.document_name || rDoc.name || rDoc.id,
          drive_id: rDoc.drive_id || localExisting.drive_id || '',
          key: rDoc.key || localExisting.key || ('hr_doc:' + ridLow),
          updated_at: rDoc.updated_at || metaObj.updated_at || localExisting.updated_at || new Date().toISOString()
        });
        finalHrDocs.push(mergedDoc);
      }

      if (finalHrDocs.length !== localHrCount || anyChange || forceDownloadCheck) {
        writeHrDocsToAllLocalStores(finalHrDocs);
        anyChange = true;
      }

      hrDocSubs.forEach(function(cb) { try { cb({ updated: true, docs: finalHrDocs, removedIds: [] }); } catch (_) {} });
      if (typeof window.hrDocRender === 'function') { try { window.hrDocRender(); } catch (_) {} }
      clearHrSyncingIndicator();

      // 3. UNIVERSAL SYNC FOR PF, ESIC, CHALLAN & ANY OTHER/FUTURE MODULE!
      var otherModulesMap = {}; // moduleName -> array of manifest items
      allFiles.forEach(function(f) {
        var m = String(f.module || '').toLowerCase().trim();
        if (!m || m === 'salary' || m === 'hr_doc') return;
        if (!otherModulesMap[m]) otherModulesMap[m] = [];
        otherModulesMap[m].push(f);
      });

      // Ensure pf, esic, challan keys always get reconciled even if empty
      ['pf', 'esic', 'challan'].forEach(function(coreMod) {
        if (!otherModulesMap[coreMod]) otherModulesMap[coreMod] = [];
      });

      var modNames = Object.keys(otherModulesMap);
      for (var om = 0; om < modNames.length; om++) {
        var modKey = modNames[om];
        var remoteModFiles = otherModulesMap[modKey];
        var modTombs = moduleTombstones[modKey] || new Set();
        var existingVaultList = Array.isArray(window.ATPL_UNIVERSAL_VAULT[modKey]) ? window.ATPL_UNIVERSAL_VAULT[modKey] : [];
        var existingVaultMap = new Map();
        existingVaultList.forEach(function(item) {
          var k = String((item && (item.id || item.name)) || '').toLowerCase().trim();
          if (k) existingVaultMap.set(k, item);
        });

        var syncedModList = [];
        for (var rfIdx = 0; rfIdx < remoteModFiles.length; rfIdx++) {
          var rItem = remoteModFiles[rfIdx];
          var itemKey = String(rItem.id || rItem.name || '').toLowerCase().trim();
          if (!itemKey || modTombs.has(itemKey)) continue;

          var cachedItem = existingVaultMap.get(itemKey);
          var rMeta = (rItem.meta && typeof rItem.meta === 'object') ? rItem.meta : {};

          // Download full payload if not yet cached in RAM and needed for PF/ESIC/Challan
          var fullPayload = cachedItem || null;
          if (!fullPayload && rItem.drive_id) {
            try {
              var dRes = await gasGet({ action: 'get_file', drive_id: rItem.drive_id, key: rItem.key });
              if (dRes && dRes.ok && dRes.payload) {
                fullPayload = typeof dRes.payload === 'string' ? JSON.parse(dRes.payload) : dRes.payload;
              }
              await yieldToUI(20);
            } catch (_) {}
          }

          var finalItem = Object.assign({}, rMeta, fullPayload || {}, {
            id: rItem.id || rItem.name,
            name: rItem.name || rItem.id,
            module: modKey,
            drive_id: rItem.drive_id,
            key: rItem.key,
            updated_at: rItem.updated_at
          });
          syncedModList.push(finalItem);
        }

        if (syncedModList.length !== existingVaultList.length || forceDownloadCheck) {
          writeUniversalModuleToLocal(modKey, syncedModList);
          anyChange = true;
        }
        if (Array.isArray(dolSubs[modKey])) {
          dolSubs[modKey].forEach(function(cb) {
            try { cb({ updated: true, records: syncedModList, removed: [] }); } catch (_) {}
          });
        }
      }

      // 4. SALARY FILES STRICT MIRROR
      if (Array.isArray(window.FILES)) {
        var seenLocal = new Set();
        var strictlyFiltered = [];
        for (var k = 0; k < window.FILES.length; k++) {
          var lf = window.FILES[k];
          var lnm = String((lf && lf.name) || '').toLowerCase().trim();
          if (!lnm || seenLocal.has(lnm)) { anyChange = true; continue; }
          if (activeSalNames.has(lnm) || window.atplIsRecentSessionUpload('salary', lnm, 45000)) {
            seenLocal.add(lnm);
            strictlyFiltered.push(lf);
          } else {
            anyChange = true;
          }
        }
        if (anyChange) {
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
                anyChange = true;
              }
            }
          } catch (_) {}
          await yieldToUI(40);
        }
      }

      if (window.FILES.length === cleanRemoteSalList.length) {
        lastSeenVersion = manifest.version;
      }

      if (anyChange) {
        salarySubs.forEach(function(cb) { try { cb({ updated: true, removedNames: [] }); } catch (_) {} });
        scheduleDebouncedUIRefresh();
      } else {
        var cnt = Array.isArray(window.FILES) ? window.FILES.length : 0;
        if (typeof window.updateRealtimeCloudBadge === 'function') {
          try { window.updateRealtimeCloudBadge(cnt, 'ok', '🟢 Google Drive Sync (' + cnt + ' files)'); } catch (_) {}
        }
      }
    } catch (err) {
      console.warn('[ATPL Universal Sync] Notice:', err && err.message);
      clearHrSyncingIndicator();
    } finally {
      isSyncingNow = false;
    }
  }

  var GoogleDriveEngine = {
    version: '2026.11.08-UNIVERSAL-ALL-MODULES',
    init: function() {
      setTimeout(function() { triggerUniversalReconciliation(true); }, 1200);
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
      if (!doc || !doc.id) return false;
      window.atplMarkSessionUpload('hr_doc', doc.id);
      pushedLocalHrIds.add(String(doc.id).toLowerCase().trim());
      var slimMeta = Object.assign({}, doc);
      delete slimMeta.file_data;
      delete slimMeta.file_data_list;
      await gasPost({
        action: 'save_file', module: 'hr_doc', id: doc.id, name: doc.document_name || doc.id,
        updated_at: doc.updated_at || new Date().toISOString(), meta: slimMeta, payload: doc
      });
      await triggerUniversalReconciliation(true);
      return true;
    },
    deleteHrDoc: async function(id, name) {
      purgeLocalHrDoc(id, name);
      await gasPost({ action: 'delete_file', module: 'hr_doc', id: id, name: name || id });
      await triggerUniversalReconciliation(true);
      return true;
    },
    fetchAllHrDocs: async function() {
      var m = await gasGet({ action: 'manifest', nocache: '1' });
      if (!m || !Array.isArray(m.files)) return [];
      var tombs = new Set((m.tombstones || []).filter(function(t) { return t.module === 'hr_doc'; }).map(function(t) { return String(t.id || '').toLowerCase().trim(); }));
      var list = m.files.filter(function(f) {
        return f.module === 'hr_doc' && !tombs.has(String(f.id || '').toLowerCase().trim());
      }).map(function(f) {
        var meta = (f.meta && typeof f.meta === 'object') ? f.meta : {};
        return Object.assign({}, meta, {
          id: f.id,
          document_name: meta.document_name || f.name || f.id,
          drive_id: f.drive_id,
          key: f.key,
          updated_at: f.updated_at
        });
      });
      writeHrDocsToAllLocalStores(list);
      clearHrSyncingIndicator();
      return list;
    },
    fetchAllHrTombstones: async function() {
      var m = await gasGet({ action: 'manifest' });
      if (!m || !Array.isArray(m.tombstones)) return [];
      return m.tombstones.filter(function(t) { return t.module === 'hr_doc'; });
    },
    decodeHrPayload: async function(doc) {
      if (!doc) return null;
      if (doc.file_data) return doc;
      var res = await gasGet({ action: 'get_file', drive_id: doc.drive_id || '', key: doc.key || ('hr_doc:' + String(doc.id).toLowerCase()) });
      return (res && res.ok && res.payload) ? res.payload : doc;
    },

    // ── UNIVERSAL SAVE / DELETE / FETCH FOR PF, ESIC, CHALLANS & ANY FUTURE MODULE ──
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
    saveUniversalModuleFile: async function(moduleName, fileOrRecordObj) {
      var mod = String(moduleName || 'custom').toLowerCase().trim();
      var name = (fileOrRecordObj && (fileOrRecordObj.name || fileOrRecordObj.filename || fileOrRecordObj.id)) || ('file_' + Date.now());
      return await this.saveComplianceDoc(mod, name, fileOrRecordObj);
    },
    fetchUniversalModuleFiles: async function(moduleName) {
      return await this.fetchAllDolRecords(moduleName);
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
      var tombs = new Set((m.tombstones || []).filter(function(t) { return String(t.module || '').toLowerCase() === mod; }).map(function(t) {
        return String(t.id || t.name || '').toLowerCase().trim();
      }));
      var list = m.files.filter(function(f) {
        return String(f.module || '').toLowerCase() === mod && !tombs.has(String(f.id || f.name || '').toLowerCase().trim());
      });
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
          try { cb({ updated: true, removedIds: [] }); } catch (_) {}
          clearHrSyncingIndicator();
        }, 600);
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
        setTimeout(function() {
          var recs = window.ATPL_UNIVERSAL_VAULT[mod] || [];
          try { cb({ updated: true, records: recs, removed: [] }); } catch (_) {}
        }, 600);
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

  setTimeout(function() { triggerUniversalReconciliation(true); }, 1200);

  setInterval(function() {
    if (!document.hidden && !window.__ATPL_IS_UPLOADING) {
      triggerUniversalReconciliation(false);
    }
  }, 6000);
})(window);
