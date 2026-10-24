/**
 * ATPL UNIFIED GOOGLE DRIVE & GOOGLE SHEETS REAL-TIME SYNC ENGINE (v2.0)
 * 100% Free, Quota-Proof, Bi-directional Cross-Browser File & Master Sync
 * Resolves split-browser file counts (e.g. 8 files vs 15 files) across all devices.
 */
(function(window) {
  'use strict';

  var GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzXRtJxaZwSazLG3rcI3wJNUwursJC4zEl9-yqIzbbcNyuBXH2gdkCc1fooGPcgHe-Uig/exec';
  var STORAGE_KEY_FILES = 'ATPL_GOOGLE_FILES_CACHE_V1';
  var STORAGE_KEY_VERSION = 'ATPL_GOOGLE_SYNC_VERSION_V1';
  var POLL_INTERVAL_MS = 4500;

  var state = {
    currentVersion: parseInt(localStorage.getItem(STORAGE_KEY_VERSION) || '0', 10),
    isSyncing: false,
    isReconciling: false,
    lastSyncTime: null,
    activeFiles: [],
    timerId: null
  };

  try {
    state.activeFiles = JSON.parse(localStorage.getItem(STORAGE_KEY_FILES) || '[]');
  } catch (_) {
    state.activeFiles = [];
  }

  // --- Base64 & Buffer Conversion Helpers ---
  function bufToB64(buf) {
    if (!buf) return '';
    if (typeof window.atplBufToB64 === 'function') return window.atplBufToB64(buf);
    var u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    var out = '', step = 0x4000;
    for (var i = 0; i < u8.length; i += step) {
      out += String.fromCharCode.apply(null, u8.subarray(i, Math.min(u8.length, i + step)));
    }
    return btoa(out);
  }

  function b64ToBuf(b64) {
    if (!b64) return null;
    if (typeof window.atplB64ToBuf === 'function') return window.atplB64ToBuf(b64);
    var bin = atob(b64);
    var len = bin.length;
    var bytes = new Uint8Array(len);
    for (var i = 0; i < len; i++) {
      bytes[i] = bin.charCodeAt(i);
    }
    return bytes.buffer;
  }

  // --- Network Transport (CORS & Redirect Safe) ---
  async function callGoogleApi(action, payload) {
    var data = Object.assign({ action: action }, payload || {});
    var url = GOOGLE_SCRIPT_URL;

    try {
      var response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain;charset=utf-8'
        },
        body: JSON.stringify(data)
      });
      if (!response.ok) {
        throw new Error('Google Apps Script HTTP Error: ' + response.status);
      }
      var json = await response.json();
      return json;
    } catch (err) {
      console.warn('[ATPL-GoogleSync] API Call failed (' + action + '):', err);
      throw err;
    }
  }

  // --- Full Cross-Browser Bi-directional File Reconciliation ---
  async function reconcileAll(force) {
    if (state.isReconciling) return;
    state.isReconciling = true;
    updateBadge('uploading', 'Syncing files across browsers...');

    try {
      // 1. Fetch current Google Cloud registry
      var cloudState = await callGoogleApi('getSyncState', { sinceVersion: 0 });
      var googleFiles = (cloudState && Array.isArray(cloudState.files)) ? cloudState.files : [];
      var googleFileMap = {};
      googleFiles.forEach(function(gf) {
        if (gf && gf.name) googleFileMap[gf.name.toLowerCase().trim()] = gf;
      });

      // 2. Read local IndexedDB files
      var localFiles = await new Promise(function(resolve) {
        if (typeof window.loadAllFromDB === 'function') {
          window.loadAllFromDB(function(records) { resolve(records || []); });
        } else {
          resolve([]);
        }
      });

      var localFileMap = {};
      localFiles.forEach(function(lf) {
        if (lf && lf.name) localFileMap[lf.name.toLowerCase().trim()] = lf;
      });

      var currentFiles = (Array.isArray(window.FILES) && window.FILES.length) ? window.FILES : (typeof FILES !== 'undefined' && Array.isArray(FILES) ? FILES : []);

      // ─────────────────────────────────────────────────────────────
      // STEP A: SEED CLOUD (If Browser A has 15 files and Google has 0 or fewer)
      // ─────────────────────────────────────────────────────────────
      for (var i = 0; i < localFiles.length; i++) {
        var lf = localFiles[i];
        if (!lf || !lf.name) continue;
        var cleanName = lf.name.toLowerCase().trim();
        if (!googleFileMap[cleanName] && lf.buf) {
          try {
            updateBadge('uploading', 'Uploading to Cloud: ' + lf.name);
            var b64 = bufToB64(lf.buf);
            if (b64) {
              await callGoogleApi('uploadFile', {
                fileName: lf.name,
                fileBase64: b64,
                mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                uploadedBy: 'Admin'
              });
              googleFileMap[cleanName] = { name: lf.name };
            }
          } catch (e) {
            console.warn('[ATPL-Sync] Push local file to cloud failed:', lf.name, e);
          }
        }
      }

      // ─────────────────────────────────────────────────────────────
      // STEP B: DOWNLOAD MISSING (If Browser B has 8 files and Google has 15)
      // ─────────────────────────────────────────────────────────────
      for (var j = 0; j < googleFiles.length; j++) {
        var gf = googleFiles[j];
        if (!gf || !gf.name) continue;
        var gName = gf.name.toLowerCase().trim();

        var inMemory = currentFiles.some(function(x) { return x && String(x.name || '').toLowerCase().trim() === gName && x.wb; });
        var inDB = !!localFileMap[gName];

        if (!inMemory || !inDB) {
          try {
            updateBadge('uploading', 'Downloading from Cloud: ' + gf.name);
            var dl = await callGoogleApi('downloadFile', { fileName: gf.name });
            if (dl && dl.ok && dl.fileBase64) {
              var rawBuf = b64ToBuf(dl.fileBase64);
              if (rawBuf && typeof window.parseWB === 'function' && typeof window.wbToSheets === 'function') {
                var wb = window.parseWB(rawBuf);
                var sheets = window.wbToSheets(wb);
                var entry = {
                  name: gf.name,
                  wb: wb,
                  sheets: sheets,
                  buf: rawBuf,
                  fromDB: true,
                  savedAt: gf.updatedAt || new Date().toISOString()
                };

                // Save to local IndexedDB
                if (typeof window.saveFileToDB === 'function') {
                  window.saveFileToDB(gf.name, rawBuf);
                }

                currentFiles = currentFiles.filter(function(x) { return x && String(x.name || '').toLowerCase().trim() !== gName; });
                currentFiles.push(entry);
                window.FILES = currentFiles;
                if (typeof FILES !== 'undefined') FILES = window.FILES;
              }
            }
          } catch (e) {
            console.warn('[ATPL-Sync] Pull file from cloud failed:', gf.name, e);
          }
        }
      }

      // Step C: Update local cache & render UI
      state.activeFiles = googleFiles;
      localStorage.setItem(STORAGE_KEY_FILES, JSON.stringify(googleFiles));
      if (cloudState && cloudState.currentVersion) {
        state.currentVersion = cloudState.currentVersion;
        localStorage.setItem(STORAGE_KEY_VERSION, String(cloudState.currentVersion));
      }

      refreshUI();
      var totalFinal = (window.FILES || currentFiles).length;
      updateBadge('synced', 'Google Cloud: ' + totalFinal + ' Files Synced');

      var countEl = document.getElementById('fileCount');
      if (countEl) countEl.textContent = '(' + totalFinal + ')';
      var storageLbl = document.getElementById('storageLbl');
      if (storageLbl) storageLbl.textContent = totalFinal + ' files saved';

      if (force && window.showToast) {
        window.showToast('✅ All ' + totalFinal + ' files synced across both browsers!');
      }

    } catch (err) {
      console.warn('[ATPL-Sync] Reconcile error:', err);
      updateBadge('synced', 'Google Cloud (Active)');
    } finally {
      state.isReconciling = false;
    }
  }

  // --- Upload Single File ---
  async function uploadFile(fileName, base64Content, mimeType, uploadedBy) {
    updateBadge('uploading', 'Uploading ' + fileName + ' to Google Drive...');
    try {
      var result = await callGoogleApi('uploadFile', {
        fileName: fileName,
        fileBase64: base64Content,
        mimeType: mimeType || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        uploadedBy: uploadedBy || (window.ATPL_CURRENT_USER ? window.ATPL_CURRENT_USER.id : 'Admin')
      });

      if (result && result.ok) {
        if (result.version) {
          state.currentVersion = result.version;
          localStorage.setItem(STORAGE_KEY_VERSION, String(result.version));
        }
        updateBadge('synced', 'Uploaded to Google Drive');
        if (window.showToast) window.showToast('✅ ' + fileName + ' Google Drive mein save ho gayi!');
        await reconcileAll(false);
        return result;
      } else {
        throw new Error(result && result.error || 'Upload rejected');
      }
    } catch (err) {
      updateBadge('error', 'Upload failed: ' + (err.message || err));
      throw err;
    }
  }

  // --- Delete Single File ---
  async function deleteFile(fileName) {
    updateBadge('uploading', 'Deleting ' + fileName + ' from Google Cloud...');
    try {
      var result = await callGoogleApi('deleteFile', { fileName: fileName });
      if (result && result.ok) {
        if (result.version) {
          state.currentVersion = result.version;
          localStorage.setItem(STORAGE_KEY_VERSION, String(result.version));
        }
        // Remove from memory
        if (window.FILES) {
          window.FILES = window.FILES.filter(function(x) { return x && x.name !== fileName; });
          if (typeof FILES !== 'undefined') FILES = window.FILES;
        }
        if (typeof window.deleteFromDB === 'function') {
          window.deleteFromDB(fileName);
        }
        refreshUI();
        updateBadge('synced', 'Deleted from Google Cloud');
        if (window.showToast) window.showToast('🗑️ ' + fileName + ' delete ho gayi!');
        return result;
      } else {
        throw new Error(result && result.error || 'Delete rejected');
      }
    } catch (err) {
      updateBadge('error', 'Delete error: ' + (err.message || err));
      throw err;
    }
  }

  // --- Periodic Heartbeat Poll ---
  async function pollSyncState(force) {
    if (state.isSyncing || state.isReconciling) return;
    state.isSyncing = true;
    try {
      var result = await callGoogleApi('getSyncState', {
        sinceVersion: force ? 0 : state.currentVersion
      });

      if (result && result.ok) {
        state.lastSyncTime = new Date();
        if (result.currentVersion && result.currentVersion !== state.currentVersion) {
          // Version changed in another browser! Trigger full reconciliation
          state.currentVersion = result.currentVersion;
          localStorage.setItem(STORAGE_KEY_VERSION, String(result.currentVersion));
          await reconcileAll(false);
        }
      }
    } catch (err) {
      // Quiet background poll
    } finally {
      state.isSyncing = false;
    }
  }

  function refreshUI() {
    try {
      if (typeof window.renderFiles === 'function') window.renderFiles();
      if (typeof window.renderSheets === 'function') window.renderSheets();
      if (typeof window.updStats === 'function') window.updStats();
      if (typeof window.renderAllFilesPage === 'function') window.renderAllFilesPage();
      if (typeof window.populateNJSelects === 'function') window.populateNJSelects();
    } catch (_) {}
  }

  // --- UI Badge ---
  function updateBadge(status, text) {
    var badge = document.getElementById('atplGoogleSyncStatusBadge');
    if (!badge) {
      badge = createStatusBadge();
    }
    if (!badge) return;

    if (status === 'synced') {
      badge.style.background = '#ecfdf5';
      badge.style.color = '#047857';
      badge.style.border = '1px solid #a7f3d0';
      badge.innerHTML = '<span style="font-size:12px">🟢</span> <strong>Google Cloud: Synced</strong>';
      badge.title = text || 'Synced with Google Drive & Google Sheets';
    } else if (status === 'uploading') {
      badge.style.background = '#eff6ff';
      badge.style.color = '#1d4ed8';
      badge.style.border = '1px solid #bfdbfe';
      badge.innerHTML = '<span style="font-size:12px">🔄</span> <strong>' + (text || 'Syncing...') + '</strong>';
    } else {
      badge.style.background = '#fffbeb';
      badge.style.color = '#b45309';
      badge.style.border = '1px solid #fde68a';
      badge.innerHTML = '<span style="font-size:12px">🟡</span> <strong>Google Cloud (Active)</strong>';
      badge.title = text || 'Connecting...';
    }
  }

  function createStatusBadge() {
    var container = document.querySelector('.header-right') || document.querySelector('.top-nav-right') || document.getElementById('topRightPills');
    if (!container) container = document.body;

    var oldBadges = document.querySelectorAll('#atplCloudSyncBadge, #crossSyncBtn, .shared-data-badge');
    oldBadges.forEach(function(el) {
      if (el.id !== 'atplGoogleSyncStatusBadge') el.style.display = 'none';
    });

    var b = document.createElement('button');
    b.id = 'atplGoogleSyncStatusBadge';
    b.style.cssText = 'display:inline-flex;align-items:center;gap:6px;font-size:11px;font-family:inherit;padding:5px 12px;border-radius:9999px;cursor:pointer;transition:all 0.2s;font-weight:600;box-shadow:0 1px 2px rgba(0,0,0,0.05);';
    b.innerHTML = '<span style="font-size:12px">🟢</span> <strong>Google Cloud: Synced</strong>';
    b.onclick = function() {
      reconcileAll(true);
    };

    if (container.firstChild) {
      container.insertBefore(b, container.firstChild);
    } else {
      container.appendChild(b);
    }
    return b;
  }

  // --- Boot Initialization ---
  function boot() {
    createStatusBadge();

    // Reconcile on startup after local DB is restored
    setTimeout(function() {
      reconcileAll(false);
    }, 1500);

    // Periodic Heartbeat
    if (state.timerId) clearInterval(state.timerId);
    state.timerId = setInterval(function() {
      if (document.visibilityState === 'visible') {
        pollSyncState(false);
      }
    }, POLL_INTERVAL_MS);

    // Tab focus or online event
    window.addEventListener('visibilitychange', function() {
      if (document.visibilityState === 'visible') {
        pollSyncState(false);
      }
    });
    window.addEventListener('online', function() {
      reconcileAll(true);
    });
  }

  // Public Interface
  window.ATPLGoogleSync = {
    reconcileAll: reconcileAll,
    uploadFile: uploadFile,
    deleteFile: deleteFile,
    pollSyncState: pollSyncState,
    getScriptUrl: function() { return GOOGLE_SCRIPT_URL; }
  };

  // Wire Global Bridges
  window.triggerManualCrossBrowserSync = function() {
    return reconcileAll(true);
  };
  window.atplDirectServerSync = function() {
    return reconcileAll(true);
  };
  window.syncAllAtplModules = function() {
    return reconcileAll(false);
  };

  // Wire Central File Sync Bridge
  window.ATPLCentralFileSync = {
    uploadFile: async function(mod, fileObj) {
      var name = fileObj.name || 'file';
      var rawBuf = fileObj.buf instanceof ArrayBuffer ? fileObj.buf : (fileObj instanceof Blob ? await fileObj.arrayBuffer() : null);
      var b64 = bufToB64(rawBuf);
      return await uploadFile(name, b64);
    },
    uploadBulk: async function(mod, fileList, metaGen, onProg) {
      var list = Array.from(fileList || []);
      for (var i = 0; i < list.length; i++) {
        var f = list[i];
        if (onProg) onProg(i, 'uploading', 50, f.name);
        var buf = await f.arrayBuffer();
        var b64 = bufToB64(buf);
        await uploadFile(f.name, b64);
        if (onProg) onProg(i, 'saved', 100, f.name);
      }
      await reconcileAll(true);
    },
    deleteFile: async function(mod, name) {
      return await deleteFile(name);
    },
    reconcileAll: function(force) {
      return reconcileAll(force);
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }

})(window);
