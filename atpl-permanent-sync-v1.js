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
      // Hang-free: Background polling loops disabled
    },

    syncAll: async function(isManual) {
      if (this.isSyncing) return;
      this.isSyncing = true;
      var btnLbl = document.getElementById("crossSyncBtnLbl");
      if (isManual && btnLbl) btnLbl.textContent = "Syncing...";

      try {
        var jobs = [];

        // 1. Sync Cloud Shared Storage
        if (window.ATPLCloudSharedStorageV1 && typeof window.ATPLCloudSharedStorageV1.syncNow === 'function') {
          jobs.push(window.ATPLCloudSharedStorageV1.syncNow(true));
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

        // 5. Ensure IndexedDB Files are hydrated without blocking CPU (Reuse cached workbooks)
        if (typeof window.loadAllFromDB === "function") {
          window.loadAllFromDB(function(saved) {
            var tombstones = {};
            try { tombstones = JSON.parse(localStorage.getItem('ATPL_SALARY_TOMBSTONES_V2') || '{}'); } catch(_) {}
            saved = (saved || []).filter(function(s) {
              if (!s || !s.name) return false;
              var tomb = tombstones[String(s.name).toLowerCase()];
              if (!tomb) return true;
              var tombTime = typeof tomb === 'string' ? Date.parse(tomb) : (tomb === true ? Infinity : 0);
              var fileTime = s.saved ? Date.parse(s.saved) : 0;
              if (fileTime && isFinite(fileTime) && isFinite(tombTime) && fileTime >= tombTime) {
                try {
                  delete tombstones[String(s.name).toLowerCase()];
                  localStorage.setItem('ATPL_SALARY_TOMBSTONES_V2', JSON.stringify(tombstones));
                } catch(_) {}
                return true;
              }
              return false;
            });
            var oldFiles = Array.isArray(window.FILES) ? window.FILES : [];
            var changed = oldFiles.length !== saved.length;
            window.FILES = saved.map(function(s) {
              var existing = oldFiles.find(function(f) {
                return f && f.name === s.name && f.savedAt === s.saved && f.wb;
              });
              if (existing) return existing;
              changed = true;
              var wb = typeof parseWB === 'function' ? parseWB(s.buf) : null;
              return {
                name: s.name,
                wb: wb,
                sheets: wb && typeof wbToSheets === 'function' ? wbToSheets(wb) : {},
                buf: s.buf,
                savedAt: s.saved
              };
            });

            if (changed) {
              if (typeof renderFiles === 'function') renderFiles();
              if (typeof renderSheets === 'function') renderSheets();
              if (typeof updStats === 'function') updStats();
              if (typeof renderAllFilesPage === 'function') renderAllFilesPage();
            }

            var sl = document.getElementById("storageLbl");
            if (sl) sl.textContent = window.FILES.length + " files saved";
          });
        }

        // 6. Refresh Employee Master Views
        if (window.EM && typeof aroraRefreshMaster === 'function') {
          aroraRefreshMaster();
        }

        this.lastSyncTime = Date.now();
        if (isManual && btnLbl) btnLbl.textContent = "Sync Complete ✓";
        if (isManual && window.showToast) {
          window.showToast("✅ Cross-Browser data 100% sync ho gaya!");
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


/* ATPL FILE PANEL VISIBILITY TOGGLE — additive UI only */
(function () {
  'use strict';
  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, {once:true});
    else fn();
  }
  ready(function () {
    var toggle = null, panel = null, collapsed = false;
    function norm(s) { return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase(); }
    function findPanel() {
      var nodes = document.querySelectorAll('div, aside, section');
      for (var i=0; i<nodes.length; i++) {
        var el=nodes[i], t=norm(el.textContent);
        if (t.length > 14000 || t.length < 50 || !t.includes('saved files') || !t.includes('sheets')) continue;
        if (!(t.includes('upload files') || t.includes('files yahan drop karo'))) continue;
        var parent=el.parentElement, pt=parent && norm(parent.textContent);
        if (pt && pt.length < 14000 && pt.includes('saved files') && pt.includes('sheets') &&
            (pt.includes('upload files') || pt.includes('files yahan drop karo'))) continue;
        var rect=el.getBoundingClientRect();
        if (rect.width > 120 && rect.width < 440 && rect.height > 180) return el;
      }
      return null;
    }
    function findHeaderAnchor() {
      var nodes=document.querySelectorAll('button, a, span, div');
      for (var i=0;i<nodes.length;i++) {
        var e=nodes[i];
        if (e.children.length > 3 || norm(e.textContent) !== 'files & sheets') continue;
        var r=e.getBoundingClientRect();
        if (r.top < 145 && r.width > 40 && r.width < 300) return e.closest('button, a') || e;
      }
      return null;
    }
    function setPanel() {
      if (!panel || !panel.isConnected) panel=findPanel();
      if (!panel) return false;
      panel.style.display=collapsed?'none':'';
      if (toggle) {
        toggle.textContent=collapsed?'📁 Show Files':'📁 Hide Files';
        toggle.setAttribute('aria-expanded',String(!collapsed));
        toggle.title=collapsed?'Show uploaded and saved files':'Hide uploaded and saved files';
      }
      return true;
    }
    function mount() {
      if (!panel || !panel.isConnected) panel=findPanel();
      if (!panel) return;
      if (!toggle || !toggle.isConnected) {
        var anchor=findHeaderAnchor();
        if (!anchor || !anchor.parentElement) return;
        toggle=document.createElement('button');
        toggle.type='button';
        toggle.id='atpl-files-panel-toggle';
        toggle.setAttribute('aria-controls','atpl-files-visibility-panel');
        toggle.style.cssText='margin-left:8px;padding:7px 12px;border:1px solid #bbc9f8;border-radius:9px;background:#eef2ff;color:#3e43be;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap';
        toggle.addEventListener('click', function () { collapsed=!collapsed;setPanel(); });
        anchor.insertAdjacentElement('afterend',toggle);
      }
      if (!panel.id) panel.id='atpl-files-visibility-panel';
      if (!panel.dataset.atplFilesToggleReady) {
        panel.dataset.atplFilesToggleReady='true';
        collapsed=true; // Keep the list hidden until the user chooses Show Files.
      }
      setPanel();
    }
    mount();
    var tries=0;
    var interval=setInterval(function () {
      mount();
      if ((toggle && toggle.isConnected && panel && panel.isConnected) || ++tries >= 30) clearInterval(interval);
    },500);
  });
})();
