/**
 * ATPL UNIFIED GOOGLE DRIVE & GOOGLE SHEETS REAL-TIME SYNC ENGINE (v1.0)
 * 100% Free, Quota-Proof, Real-Time Cross-Browser Sync Engine
 * Replaces all fragmented Firebase, Supabase, and local mock sync scripts.
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
    lastSyncTime: null,
    online: navigator.onLine,
    activeFiles: [],
    timerId: null
  };

  try {
    state.activeFiles = JSON.parse(localStorage.getItem(STORAGE_KEY_FILES) || '[]');
  } catch (_) {
    state.activeFiles = [];
  }

  // --- Network Transport (CORS & Redirect Safe) ---
  async function callGoogleApi(action, payload) {
    var data = Object.assign({ action: action }, payload || {});
    var url = GOOGLE_SCRIPT_URL;

    // Use POST with text/plain body to avoid CORS preflight issues with Google Apps Script
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

  // --- Core Sync Operations ---

  // 1. Upload File (Drive + Sheet)
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
        if (window.showToast) window.showToast('✅ ' + fileName + ' Google Drive mein permanently save ho gayi!');
        // Refresh local cache & UI
        await pollSyncState(true);
        return result;
      } else {
        throw new Error(result && result.error || 'Upload rejected');
      }
    } catch (err) {
      updateBadge('error', 'Upload failed: ' + (err.message || err));
      if (window.showToast) window.showToast('⚠️ Google Drive upload failed: ' + (err.message || err));
      throw err;
    }
  }

  // 2. Delete File (Drive Trash + Sheet Deleted)
  async function deleteFile(fileName) {
    updateBadge('uploading', 'Deleting ' + fileName + ' from Google Cloud...');
    try {
      var result = await callGoogleApi('deleteFile', { fileName: fileName });
      if (result && result.ok) {
        if (result.version) {
          state.currentVersion = result.version;
          localStorage.setItem(STORAGE_KEY_VERSION, String(result.version));
        }
        // Remove from local cache immediately
        state.activeFiles = state.activeFiles.filter(function(f) { return f.name !== fileName; });
        localStorage.setItem(STORAGE_KEY_FILES, JSON.stringify(state.activeFiles));
        
        // Also remove from any legacy local storage to prevent zombie resurrection
        cleanupLocalFile(fileName);

        updateBadge('synced', 'Deleted from Google Cloud');
        if (window.showToast) window.showToast('🗑️ ' + fileName + ' Google Cloud se delete ho gayi!');
        refreshUI();
        return result;
      } else {
        throw new Error(result && result.error || 'Delete rejected');
      }
    } catch (err) {
      updateBadge('error', 'Delete error: ' + (err.message || err));
      throw err;
    }
  }

  // 3. Download File (from Google Drive)
  async function downloadFile(fileName) {
    updateBadge('uploading', 'Downloading from Google Drive...');
    try {
      var result = await callGoogleApi('downloadFile', { fileName: fileName });
      if (result && result.ok && result.fileBase64) {
        updateBadge('synced', 'Downloaded from Google Drive');
        return result;
      } else {
        throw new Error(result && result.error || 'Download failed');
      }
    } catch (err) {
      updateBadge('error', 'Download error: ' + (err.message || err));
      throw err;
    }
  }

  // 4. Save Employee Master
  async function saveEmployeeMaster(records) {
    if (!Array.isArray(records)) return;
    try {
      var result = await callGoogleApi('saveEmployeeMaster', { records: records });
      if (result && result.ok && result.version) {
        state.currentVersion = result.version;
        localStorage.setItem(STORAGE_KEY_VERSION, String(result.version));
      }
      return result;
    } catch (e) {
      console.warn('[ATPL-GoogleSync] Employee save error:', e);
    }
  }

  // 5. Heartbeat Poll Sync (Cross-Browser Discovery)
  async function pollSyncState(force) {
    if (state.isSyncing) return;
    state.isSyncing = true;
    try {
      var result = await callGoogleApi('getSyncState', {
        sinceVersion: force ? 0 : state.currentVersion
      });

      if (result && result.ok) {
        state.lastSyncTime = new Date();
        if (result.currentVersion) {
          state.currentVersion = result.currentVersion;
          localStorage.setItem(STORAGE_KEY_VERSION, String(result.currentVersion));
        }

        if (result.changed || force) {
          if (Array.isArray(result.files)) {
            state.activeFiles = result.files;
            localStorage.setItem(STORAGE_KEY_FILES, JSON.stringify(result.files));
            syncActiveFilesWithLocal(result.files);
          }
          if (Array.isArray(result.employees) && result.employees.length > 0) {
            localStorage.setItem('AroraTextilesEmployeeMasterV3', JSON.stringify(result.employees));
            if (typeof window.renderEmployeeTable === 'function') {
              try { window.renderEmployeeTable(result.employees); } catch (_) {}
            }
          }
          refreshUI();
        }
        updateBadge('synced', 'Google Cloud: All Synced');
      }
    } catch (err) {
      updateBadge('offline', 'Google Cloud Sync Waiting...');
    } finally {
      state.isSyncing = false;
    }
  }

  // --- Reconciliation & Anti-Resurrection Guard ---
  function cleanupLocalFile(fileName) {
    try {
      // Clean up from Salary sheets cache
      var raw = localStorage.getItem('ATPL_SALARY_FILES') || '{}';
      var obj = JSON.parse(raw);
      if (obj[fileName]) {
        delete obj[fileName];
        localStorage.setItem('ATPL_SALARY_FILES', JSON.stringify(obj));
      }
      // Also clean up metadata from UI list
      if (window.renderSavedFiles) window.renderSavedFiles();
    } catch (_) {}
  }

  function syncActiveFilesWithLocal(activeGoogleFiles) {
    var activeNames = {};
    activeGoogleFiles.forEach(function(f) { if (f && f.name) activeNames[f.name] = true; });

    // Clean up any local files that are NOT in Google active files (deleted by other browsers)
    try {
      var raw = localStorage.getItem('ATPL_SALARY_FILES') || '{}';
      var localFiles = JSON.parse(raw);
      var modified = false;
      Object.keys(localFiles).forEach(function(name) {
        if (!activeNames[name]) {
          delete localFiles[name];
          modified = true;
        }
      });
      if (modified) {
        localStorage.setItem('ATPL_SALARY_FILES', JSON.stringify(localFiles));
      }
    } catch (_) {}
  }

  function refreshUI() {
    try {
      if (typeof window.renderSavedFiles === 'function') window.renderSavedFiles();
      if (typeof window.updateFileCounter === 'function') window.updateFileCounter();
      if (typeof window.syncAllAtplModules === 'function') window.syncAllAtplModules();
    } catch (_) {}
  }

  // --- Clean Single Header Status Badge ---
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
      badge.innerHTML = '<span style="font-size:12px;animation:spin 1s linear infinite">🔄</span> <strong>' + (text || 'Syncing...') + '</strong>';
    } else {
      badge.style.background = '#fffbeb';
      badge.style.color = '#b45309';
      badge.style.border = '1px solid #fde68a';
      badge.innerHTML = '<span style="font-size:12px">🟡</span> <strong>Google Cloud (Active)</strong>';
      badge.title = text || 'Connecting to Google Drive...';
    }
  }

  function createStatusBadge() {
    var container = document.querySelector('.header-right') || document.querySelector('.top-nav-right') || document.getElementById('topRightPills');
    if (!container) {
      container = document.body;
    }

    // Hide any old conflicting badge elements
    var oldBadges = document.querySelectorAll('#atplCloudSyncBadge, #crossSyncBtn, .shared-data-badge, [id*="SyncBadge"]');
    oldBadges.forEach(function(el) {
      if (el.id !== 'atplGoogleSyncStatusBadge') el.style.display = 'none';
    });

    var b = document.createElement('button');
    b.id = 'atplGoogleSyncStatusBadge';
    b.style.cssText = 'display:inline-flex;align-items:center;gap:6px;font-size:11px;font-family:inherit;padding:5px 12px;border-radius:9999px;cursor:pointer;transition:all 0.2s;font-weight:600;box-shadow:0 1px 2px rgba(0,0,0,0.05);';
    b.innerHTML = '<span style="font-size:12px">🟢</span> <strong>Google Cloud: Synced</strong>';
    b.onclick = function() {
      updateBadge('uploading', 'Manual Syncing...');
      pollSyncState(true).then(function() {
        if (window.showToast) window.showToast('✅ Google Drive & Sheets se latest data sync ho gaya!');
      });
    };

    if (container.firstChild) {
      container.insertBefore(b, container.firstChild);
    } else {
      container.appendChild(b);
    }
    return b;
  }

  // --- Hook Interceptions into Global App ---
  function hookFileInterceptors() {
    // Intercept when a file is saved or dropped
    var origSaveSalary = window.saveSalaryFile;
    if (typeof origSaveSalary === 'function' && !origSaveSalary.__googleHooked) {
      window.saveSalaryFile = async function(fileName, data, opts) {
        var res = origSaveSalary.apply(this, arguments);
        try {
          if (data && data.base64) {
            uploadFile(fileName, data.base64, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
          }
        } catch (_) {}
        return res;
      };
      window.saveSalaryFile.__googleHooked = true;
    }

    // Intercept when a file is deleted
    var origDeleteSalary = window.deleteSalaryFile;
    if (typeof origDeleteSalary === 'function' && !origDeleteSalary.__googleHooked) {
      window.deleteSalaryFile = async function(fileName) {
        try {
          deleteFile(fileName);
        } catch (_) {}
        return origDeleteSalary.apply(this, arguments);
      };
      window.deleteSalaryFile.__googleHooked = true;
    }
  }

  // --- Lifecycle Boot ---
  function boot() {
    createStatusBadge();
    hookFileInterceptors();
    
    // Initial sync
    pollSyncState(true);

    // Periodic Heartbeat
    if (state.timerId) clearInterval(state.timerId);
    state.timerId = setInterval(function() {
      if (document.visibilityState === 'visible') {
        pollSyncState(false);
      }
    }, POLL_INTERVAL_MS);

    // Fast sync on tab focus or back online
    window.addEventListener('visibilitychange', function() {
      if (document.visibilityState === 'visible') {
        pollSyncState(false);
      }
    });
    window.addEventListener('online', function() {
      pollSyncState(true);
    });
  }

  // Expose API globally
  window.ATPLGoogleSync = {
    uploadFile: uploadFile,
    deleteFile: deleteFile,
    downloadFile: downloadFile,
    saveEmployeeMaster: saveEmployeeMaster,
    pollSyncState: pollSyncState,
    getScriptUrl: function() { return GOOGLE_SCRIPT_URL; }
  };

  // Replace old legacy sync methods
  window.atplDirectServerSync = function() { return pollSyncState(true); };
  window.syncAllAtplModules = function() { return pollSyncState(false); };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }

})(window);
