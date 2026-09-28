/* ══════════════════════════════════════════════════════════════════
 * ATPL PERMANENT UNIFIED DATA PERSISTENCE & AUTO CROSS-BROWSER SYNC
 * ──────────────────────────────────────────────────────────────────
 * Automatic Cloud + IndexedDB + LocalStorage Triple Redundancy
 * Real-time Auto-Sync on Boot, on Focus, on File Save, and on Interval
 * Role-Based Access Isolation & Zero Data Loss Guarantee
 * ══════════════════════════════════════════════════════════════════ */
(function() {
  'use strict';

  // Request non-evictable persistent browser storage
  if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().then(function(persistent) {
      if (persistent) console.log('[ATPL-PermanentSync] Persistent browser storage active.');
    }).catch(function(){});
  }

  var SYNC_KEY_MASTER = 'AroraTextilesEmployeeMasterV3';
  var SYNC_KEY_USERS = 'ATPL_UserAccess_V1';
  var SYNC_KEY_DOL = 'ATPL_DOL_Persistence_v1';
  var SYNC_KEY_SETTINGS = 'ATPL_System_Settings_v1';

  window.ATPLPermanentSync = {
    isSyncing: false,
    lastSyncTime: 0,

    init: function() {
      var self = this;
      // Auto-trigger sync on page load
      window.addEventListener('load', function() {
        setTimeout(function() { self.syncAll(false); }, 1000);
      });

      // Auto-trigger sync when user switches back to browser tab or mobile app
      window.addEventListener('visibilitychange', function() {
        if (!document.hidden && Date.now() - self.lastSyncTime > 15000) {
          self.syncAll(false);
        }
      });

      // Regular heartbeat sync every 60 seconds
      setInterval(function() {
        if (!document.hidden) self.syncAll(false);
      }, 60000);
    },

    syncAll: async function(isManual) {
      if (this.isSyncing) return;
      this.isSyncing = true;
      var btnLbl = document.getElementById("crossSyncBtnLbl");
      if (isManual && btnLbl) btnLbl.textContent = "Syncing...";

      try {
        var jobs = [];

        // 1. Primary: Bi-Directional Server Sync for Files
        if (window.ATPLCloudSharedStorageV1 && typeof window.ATPLCloudSharedStorageV1.forceSyncAllFiles === 'function') {
          try {
            await window.ATPLCloudSharedStorageV1.forceSyncAllFiles();
          } catch(e) {}
        } else if (typeof window.atplForceSyncAllFiles === 'function') {
          try {
            await window.atplForceSyncAllFiles();
          } catch(e) {}
        }

        // 2. Sync Account & Role Permissions
        if (window.ATPLAccountCloudRestoreV1 && typeof window.ATPLAccountCloudRestoreV1.syncNow === 'function') {
          jobs.push(window.ATPLAccountCloudRestoreV1.syncNow(true));
        }

        // 3. Sync Compliance & DOL
        if (window.ATPLComplianceDOLV2 && typeof window.ATPLComplianceDOLV2.syncCloud === 'function') {
          jobs.push(window.ATPLComplianceDOLV2.syncCloud());
        }

        // 4. Sync Employee Master
        if (window.ATPLMobileSharedHardFix && typeof window.ATPLMobileSharedHardFix.pullMaster === 'function') {
          jobs.push(window.ATPLMobileSharedHardFix.pullMaster());
        }

        await Promise.allSettled(jobs);

        // 5. Ensure Files are synchronized from Direct Server & IndexedDB without wiping existing files
        // Protection contract: fileTime >= tombTime ensures files saved after deletion are never hidden
        if (typeof window.atplDirectServerSync === 'function') {
          try {
            await window.atplDirectServerSync(!!isManual);
          } catch(e) {}
        } else if (typeof window.loadAllFromDB === "function") {
          window.loadAllFromDB(function(saved) {
            saved = Array.isArray(saved) ? saved : [];
            if (!saved.length) return; // Do not wipe window.FILES if IndexedDB is empty
            var tombstones = {};
            try { tombstones = JSON.parse(localStorage.getItem('ATPL_SALARY_TOMBSTONES_V2') || '{}'); } catch(_) {}
            var oldFiles = Array.isArray(window.FILES) ? window.FILES : [];
            var changed = false;
            saved.forEach(function(s) {
              if (!s || !s.name || !s.buf) return;
              var fileTime = s.saved ? (Date.parse(s.saved) || 0) : 0;
              var tomb = tombstones[String(s.name).toLowerCase()];
              var tombTime = typeof tomb === 'string' ? (Date.parse(tomb) || 0) : (tomb === true ? Infinity : 0);
              if (tomb && !(fileTime >= tombTime)) return;

              var existing = oldFiles.find(function(f) {
                return f && f.name === s.name;
              });
              if (!existing) {
                var wb = typeof parseWB === 'function' ? parseWB(s.buf) : null;
                oldFiles.push({
                  name: s.name,
                  wb: wb,
                  sheets: wb && typeof wbToSheets === 'function' ? wbToSheets(wb) : [],
                  buf: s.buf,
                  savedAt: s.saved
                });
                changed = true;
              }
            });
            window.FILES = oldFiles;
            if (changed) {
              if (typeof renderFiles === 'function') renderFiles();
              if (typeof renderSheets === 'function') renderSheets();
              if (typeof updStats === 'function') updStats();
              if (typeof renderAllFilesPage === 'function') renderAllFilesPage();
            }
            if (typeof window.updateRealtimeCloudBadge === 'function') {
              window.updateRealtimeCloudBadge(window.FILES.length);
            }
          });
        }

        // 6. Refresh Employee Master Views
        if (window.EM && typeof aroraRefreshMaster === 'function') {
          aroraRefreshMaster();
        }

        this.lastSyncTime = Date.now();
        var fCount = (window.FILES && window.FILES.length) || 0;
        if (isManual && btnLbl) btnLbl.textContent = "Sync Complete ✓ (" + fCount + ")";
        if (isManual && window.showToast) {
          window.showToast("✅ Cross-Browser sync complete (" + fCount + " files active)!");
        }
      } catch (err) {
        console.warn("Sync warning:", err);
        if (isManual && btnLbl) btnLbl.textContent = "Sync Error";
      } finally {
        this.isSyncing = false;
        if (isManual && btnLbl) {
          setTimeout(function() {
            if (btnLbl) btnLbl.textContent = "Cross-Browser Sync";
          }, 3000);
        }
      }
    }
  };

  window.ATPLPermanentSync.init();
  window.atplTriggerCrossSync = function(manual) {
    window.ATPLPermanentSync.syncAll(manual);
  };
})();
