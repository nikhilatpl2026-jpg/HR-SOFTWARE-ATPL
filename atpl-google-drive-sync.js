/**
 * ATPL MASTER GOOGLE DRIVE & GOOGLE SHEETS UNIFIED SYNC ENGINE
 * 100% Quota-Proof, Cross-Device, Anti-Hang Synchronization
 * Connected to live ATPL Google Apps Script Engine
 */
(function (window) {
  "use strict";

  // 1. SUPPRESS DEAD LEGACY CLOUD RUN / FIREBASE / EVENTSOURCE CHANNELS
  window.__atplFirebaseQuotaExhausted = true;
  window.LIVE_CLOUD_RUN_URL = "";
  window.__ATPL_CENTRAL_BACKEND_URL = "";
  window.ATPL_GET_API_BASE = function () { return ""; };

  // Block dead EventSource loops that would attempt to connect to offline endpoints
  if (window.EventSource) {
    const OrigEventSource = window.EventSource;
    window.EventSource = function (url, config) {
      if (typeof url === "string" && (url.indexOf("/api/sync/") !== -1 || url.indexOf(".run.app") !== -1)) {
        return {
          addEventListener: function () {},
          removeEventListener: function () {},
          close: function () {}
        };
      }
      return new OrigEventSource(url, config);
    };
  }

  // Intercept obsolete legacy local endpoints without affecting standard fetch
  const origFetch = window.fetch;
  window.fetch = async function (input, init) {
    const url = typeof input === "string" ? input : (input && input.url) || "";
    if (
      url.indexOf("/api/sync/") !== -1 ||
      url.indexOf("data/salary_files.json") !== -1 ||
      url.indexOf("data/atpl-documents.json") !== -1 ||
      url.indexOf("data/blobs/") !== -1
    ) {
      return new Response(JSON.stringify({ ok: true, blocked_legacy: true, files: [], salary_files: [], hr_docs: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
    return origFetch.apply(this, arguments);
  };

  // 2. LIVE GOOGLE APPS SCRIPT ENDPOINT
  const GAS_URL = "https://script.google.com/macros/s/AKfycbzXRtJxaZwSazLG3rcI3wJNUwursJC4zEl9-yqIzbbcNyuBXH2gdkCc1fooGPcgHe-Uig/exec";
  const STORAGE_KEY_VERSION = "ATPL_GOOGLE_SYNC_VERSION_V1";
  const STORAGE_KEY_META = "ATPL_GOOGLE_FILES_META_V1";

  // Memory Cache so Excel workbooks are NEVER parsed twice (100% Hang Prevention)
  const parsedWorkbookCache = new Map();
  let isSyncing = false;
  let syncTimer = null;

  function bufToB64(buf) {
    if (!buf) return "";
    if (typeof buf === "string") return buf;
    const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    let out = "";
    const step = 0x8000;
    for (let i = 0; i < u8.length; i += step) {
      out += String.fromCharCode.apply(null, u8.subarray(i, Math.min(u8.length, i + step)));
    }
    return btoa(out);
  }

  function b64ToBuf(b64) {
    if (!b64 || typeof b64 !== "string") return null;
    const clean = b64.indexOf(",") !== -1 ? b64.split(",")[1] : b64;
    const bin = atob(clean);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8.buffer;
  }

  // Robust transport that handles both GET (fast reads) and POST (writes)
  async function callGoogleDrive(action, payload) {
    payload = payload || {};
    try {
      // Use GET for fast, lightweight reads (zero CORS preflight, instant redirects)
      if (action === "getSyncState") {
        const since = encodeURIComponent(payload.sinceVersion || 0);
        const url = GAS_URL + "?action=getSyncState&sinceVersion=" + since + "&_t=" + Date.now();
        const res = await origFetch(url, { method: "GET" });
        if (!res.ok) return { ok: false, offline: true };
        return await res.json();
      }

      if (action === "downloadFile") {
        const fn = encodeURIComponent(payload.fileName || "");
        const url = GAS_URL + "?action=downloadFile&fileName=" + fn + "&_t=" + Date.now();
        const res = await origFetch(url, { method: "GET" });
        if (!res.ok) return { ok: false, offline: true };
        return await res.json();
      }

      // Use POST with text/plain body for writes (avoids CORS preflight)
      const data = Object.assign({ action: action }, payload);
      const res = await origFetch(GAS_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(data)
      });
      if (!res.ok) return { ok: false, offline: true };
      const txt = await res.text();
      try {
        return JSON.parse(txt);
      } catch (_) {
        return { ok: false, offline: true };
      }
    } catch (err) {
      console.warn("[GoogleDriveSync] API Notice (" + action + "):", err);
      return { ok: false, offline: true };
    }
  }

  function getTombstones(key) {
    try { return JSON.parse(localStorage.getItem(key) || "{}"); } catch (_) { return {}; }
  }

  function setTombstone(key, name) {
    try {
      const t = getTombstones(key);
      t[String(name).toLowerCase()] = new Date().toISOString();
      localStorage.setItem(key, JSON.stringify(t));
    } catch (_) {}
  }

  function removeTombstone(key, name) {
    try {
      const t = getTombstones(key);
      delete t[String(name).toLowerCase()];
      localStorage.setItem(key, JSON.stringify(t));
    } catch (_) {}
  }

  // --- UI BADGE MANAGEMENT ---
  function updateSyncBadge(status, text) {
    try {
      if (typeof window.updateRealtimeCloudBadge === "function") {
        const count = (window.FILES || []).length;
        window.updateRealtimeCloudBadge(count, status === "synced" ? "ok" : (status === "syncing" ? "syncing" : "warn"), text);
      }
      let badge = document.getElementById("atplGoogleSyncStatusBadge");
      if (!badge) {
        badge = createStatusBadge();
      }
      if (!badge) return;
      if (status === "synced") {
        badge.style.background = "#ecfdf5";
        badge.style.color = "#047857";
        badge.style.border = "1px solid #a7f3d0";
        badge.innerHTML = '<span style="font-size:12px">🟢</span> <strong>Google Cloud: Synced (' + (window.FILES || []).length + ')</strong>';
        badge.title = text || "Google Drive & Sheets se latest data synchronized hai";
      } else if (status === "syncing") {
        badge.style.background = "#eff6ff";
        badge.style.color = "#1d4ed8";
        badge.style.border = "1px solid #bfdbfe";
        badge.innerHTML = '<span style="font-size:12px;display:inline-block;animation:spin 1s linear infinite">🔄</span> <strong>' + (text || "Drive Syncing...") + '</strong>';
      } else {
        badge.style.background = "#fffbeb";
        badge.style.color = "#b45309";
        badge.style.border = "1px solid #fde68a";
        badge.innerHTML = '<span style="font-size:12px">🟡</span> <strong>Google Cloud (Active)</strong>';
        badge.title = text || "Google Drive Ready";
      }
    } catch (_) {}
  }

  function createStatusBadge() {
    const container = document.querySelector(".header-right") || document.querySelector(".top-nav-right") || document.getElementById("topRightPills");
    if (!container) return null;
    const old = document.getElementById("atplGoogleSyncStatusBadge");
    if (old) return old;

    const b = document.createElement("button");
    b.id = "atplGoogleSyncStatusBadge";
    b.type = "button";
    b.style.cssText = "display:inline-flex;align-items:center;gap:6px;font-size:11px;font-family:inherit;padding:4px 10px;border-radius:9999px;cursor:pointer;font-weight:600;box-shadow:0 1px 2px rgba(0,0,0,0.05);margin-left:6px;vertical-align:middle;";
    b.innerHTML = '<span style="font-size:12px">🟢</span> <strong>Google Cloud: Synced</strong>';
    b.onclick = function () {
      updateSyncBadge("syncing", "Manual Syncing...");
      syncAllFromGoogleDrive(true);
    };
    if (container.firstChild) {
      container.insertBefore(b, container.firstChild);
    } else {
      container.appendChild(b);
    }
    return b;
  }

  // --- CORE SYNC OPERATIONS ---
  async function uploadSalaryFile(name, arrayBufOrB64) {
    removeTombstone("ATPL_SALARY_TOMBSTONES_V2", name);
    const b64 = typeof arrayBufOrB64 === "string" ? arrayBufOrB64 : bufToB64(arrayBufOrB64);
    const buf = typeof arrayBufOrB64 === "string" ? b64ToBuf(arrayBufOrB64) : arrayBufOrB64;

    if (buf && typeof window.saveFileToDB === "function") {
      try { window.saveFileToDB(name, buf); } catch (_) {}
    }

    updateSyncBadge("syncing", "Uploading " + name + " to Google Drive...");
    const res = await callGoogleDrive("uploadFile", {
      fileName: name,
      fileBase64: b64,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      uploadedBy: (window.ATPL_CURRENT_USER ? window.ATPL_CURRENT_USER.id : "Admin")
    });

    if (res && res.ok) {
      if (res.version) localStorage.setItem(STORAGE_KEY_VERSION, String(res.version));
      updateSyncBadge("synced", "Saved to Google Drive");
      if (window.showToast) window.showToast("✅ " + name + " Google Drive mein save ho gayi!");
    }
    return res;
  }

  async function deleteSalaryFile(name) {
    setTombstone("ATPL_SALARY_TOMBSTONES_V2", name);
    parsedWorkbookCache.delete(String(name).toLowerCase());
    window.FILES = (window.FILES || []).filter(f => f && String(f.name).toLowerCase() !== String(name).toLowerCase());

    if (typeof window.deleteFromDB === "function") {
      try { window.deleteFromDB(name); } catch (_) {}
    }

    updateSyncBadge("syncing", "Deleting " + name + " from Google Drive...");
    const res = await callGoogleDrive("deleteFile", {
      fileName: name
    });

    if (res && res.ok) {
      if (res.version) localStorage.setItem(STORAGE_KEY_VERSION, String(res.version));
      updateSyncBadge("synced", "Deleted from Google Drive");
      if (window.showToast) window.showToast("🗑️ " + name + " Google Drive se delete kar di gayi!");
      refreshUI();
    }
    return res;
  }

  function refreshUI() {
    try {
      if (typeof window.renderFiles === "function") window.renderFiles();
      if (typeof window.renderSheets === "function") window.renderSheets();
      if (typeof window.updStats === "function") window.updStats();
      if (typeof window.renderAllFilesPage === "function") window.renderAllFilesPage();
      if (typeof window.populateNJSelects === "function") window.populateNJSelects();
      if (typeof window.renderSavedFiles === "function") window.renderSavedFiles();
      if (typeof window.updateFileCounter === "function") window.updateFileCounter();
    } catch (_) {}
  }

  async function syncAllFromGoogleDrive(forceUI) {
    if (isSyncing) return;
    isSyncing = true;
    try {
      updateSyncBadge("syncing", "☁️ Drive Syncing...");

      // 1. Fetch current sync state from Google Apps Script Engine
      const data = await callGoogleDrive("getSyncState", { sinceVersion: 0 });
      if (!data || !data.ok) {
        updateSyncBadge("ready", "Google Drive Ready");
        return;
      }

      if (data.currentVersion) {
        localStorage.setItem(STORAGE_KEY_VERSION, String(data.currentVersion));
      }

      // 2. Sync Employee Master if provided
      if (data.employees) {
        try {
          const emps = typeof data.employees === "string" ? JSON.parse(data.employees) : data.employees;
          if (Array.isArray(emps) && emps.length > 0) {
            localStorage.setItem("AroraTextilesEmployeeMasterV3", JSON.stringify(emps));
            if (typeof window.renderEmployeeTable === "function") {
              try { window.renderEmployeeTable(emps); } catch (_) {}
            }
          }
        } catch (_) {}
      }

      // 3. Process Google Drive Files
      const remoteFiles = Array.isArray(data.files) ? data.files : (Array.isArray(data.salary_files) ? data.salary_files : []);
      const tombs = getTombstones("ATPL_SALARY_TOMBSTONES_V2");
      const remoteNames = new Set();
      let newFilesLoaded = 0;

      // First check what is already loaded locally in indexedDB
      let localDbFiles = [];
      if (typeof window.loadAllFromDB === "function") {
        try {
          localDbFiles = await new Promise(resolve => window.loadAllFromDB(resolve));
        } catch (_) {}
      }
      const localDbMap = new Map();
      (localDbFiles || []).forEach(f => {
        if (f && f.name) localDbMap.set(String(f.name).toLowerCase(), f.buf);
      });

      for (let i = 0; i < remoteFiles.length; i++) {
        const rf = remoteFiles[i];
        if (!rf || !rf.name) continue;
        const key = String(rf.name).toLowerCase();
        if (tombs[key]) continue;
        remoteNames.add(key);

        const existsLocal = (window.FILES || []).find(f => f && String(f.name).toLowerCase() === key);
        if (!existsLocal) {
          let buf = localDbMap.get(key) || null;

          // If not in local indexedDB, download from Google Drive
          if (!buf) {
            updateSyncBadge("syncing", "Downloading " + rf.name.slice(0, 18) + "...");
            const dl = await callGoogleDrive("downloadFile", { fileName: rf.name });
            if (dl && dl.ok && dl.fileBase64) {
              buf = b64ToBuf(dl.fileBase64);
              if (buf && typeof window.saveFileToDB === "function") {
                try { window.saveFileToDB(rf.name, buf); } catch (_) {}
              }
            }
          }

          if (buf && typeof window.parseWB === "function") {
            // Anti-hang yield to browser UI thread
            await new Promise(r => setTimeout(r, 20));
            let parsed = parsedWorkbookCache.get(key);
            if (!parsed) {
              const wb = window.parseWB(buf);
              const sheets = typeof window.wbToSheets === "function" ? window.wbToSheets(wb) : {};
              parsed = { wb, sheets };
              parsedWorkbookCache.set(key, parsed);
            }
            window.FILES = (window.FILES || []).filter(f => f && String(f.name).toLowerCase() !== key);
            window.FILES.push({
              name: rf.name,
              wb: parsed.wb,
              sheets: parsed.sheets,
              buf: buf,
              fromDB: true,
              savedAt: rf.updatedAt || new Date().toISOString()
            });
            newFilesLoaded++;
          }
        }
      }

      // 4. Update UI
      refreshUI();
      updateSyncBadge("synced", "Google Cloud: Synced (" + (window.FILES || []).length + " files)");

      if (forceUI && typeof window.showToast === "function") {
        window.showToast("✅ Google Drive Sync Complete: " + (window.FILES || []).length + " files synchronized!");
      }
    } catch (e) {
      console.warn("[GoogleDriveSync] Sync notice:", e);
      updateSyncBadge("ready", "Google Drive Ready");
    } finally {
      isSyncing = false;
    }
  }

  // --- HOOK FILE INTERCEPTIONS ---
  function hookInterceptors() {
    // Intercept salary save
    const origSave = window.saveSalaryFile;
    if (typeof origSave === "function" && !origSave.__atplGoogleHooked) {
      window.saveSalaryFile = async function (fileName, data, opts) {
        const res = origSave.apply(this, arguments);
        try {
          if (data && data.base64) {
            uploadSalaryFile(fileName, data.base64);
          }
        } catch (_) {}
        return res;
      };
      window.saveSalaryFile.__atplGoogleHooked = true;
    }

    // Intercept salary delete
    const origDel = window.deleteSalaryFile;
    if (typeof origDel === "function" && !origDel.__atplGoogleHooked) {
      window.deleteSalaryFile = async function (fileName) {
        try {
          deleteSalaryFile(fileName);
        } catch (_) {}
        return origDel.apply(this, arguments);
      };
      window.deleteSalaryFile.__atplGoogleHooked = true;
    }
  }

  // --- UNIFIED COMPATIBILITY ENGINE ---
  const UnifiedEngine = {
    uploadFile: async function (name, b64) { return uploadSalaryFile(name, b64); },
    deleteFile: async function (name) { return deleteSalaryFile(name); },
    saveSalaryFile: async function (name, payload) {
      const b64 = (payload && payload.original_b64) || (payload && payload.base64) || payload;
      return uploadSalaryFile(name, b64);
    },
    deleteSalaryFile: async function (name) { return deleteSalaryFile(name); },
    clearAllSalaryFiles: async function () {
      const list = (window.FILES || []).slice();
      window.FILES = [];
      for (const f of list) {
        if (f && f.name) await deleteSalaryFile(f.name);
      }
    },
    uploadBulk: async function (mod, files, meta, onProg) {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const key = String(file.name).toLowerCase();
        await new Promise(r => setTimeout(r, 20));
        const buf = await file.arrayBuffer();
        let parsed = parsedWorkbookCache.get(key);
        if (!parsed) {
          const wb = typeof window.parseWB === "function" ? window.parseWB(buf) : null;
          const sheets = wb && typeof window.wbToSheets === "function" ? window.wbToSheets(wb) : {};
          parsed = { wb, sheets };
          parsedWorkbookCache.set(key, parsed);
        }
        window.FILES = (window.FILES || []).filter(f => f && String(f.name).toLowerCase() !== key);
        window.FILES.push({
          name: file.name,
          wb: parsed.wb,
          sheets: parsed.sheets,
          buf: buf,
          savedAt: new Date().toISOString()
        });
        if (typeof window.saveFileToDB === "function") window.saveFileToDB(file.name, buf);
        await uploadSalaryFile(file.name, buf);
        if (onProg) onProg(i, "saved", Math.round(((i + 1) / files.length) * 100), file.name);
      }
      refreshUI();
    },
    reconcileAll: function (force) { return syncAllFromGoogleDrive(force); },
    syncNow: function (force) { return syncAllFromGoogleDrive(force); },
    pollSyncState: function (force) { return syncAllFromGoogleDrive(force); },
    getScriptUrl: function () { return GAS_URL; }
  };

  window.ATPLGoogleSync = UnifiedEngine;
  window.ATPLCentralFileSync = UnifiedEngine;
  window.ATPLFirebase = UnifiedEngine;
  window.ATPLCloudSharedStorageV1 = UnifiedEngine;
  window.triggerManualCrossBrowserSync = function () { return syncAllFromGoogleDrive(true); };
  window.atplTriggerCrossSync = function (force) { return syncAllFromGoogleDrive(force); };
  window.atplDirectServerSync = function () { return syncAllFromGoogleDrive(true); };
  window.syncAllAtplModules = function () { return syncAllFromGoogleDrive(false); };

  function boot() {
    createStatusBadge();
    hookInterceptors();

    // Gentle initial sync after DOM is loaded and IndexedDB has opened
    setTimeout(() => {
      syncAllFromGoogleDrive(false);
    }, 800);

    // Periodic gentle heartbeat every 45s when page is active
    if (syncTimer) clearInterval(syncTimer);
    syncTimer = setInterval(() => {
      if (document.visibilityState === "visible") {
        syncAllFromGoogleDrive(false);
      }
    }, 45000);

    // Sync on tab re-focus or coming online
    window.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        syncAllFromGoogleDrive(false);
      }
    });
    window.addEventListener("online", () => {
      syncAllFromGoogleDrive(true);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})(window);
