/**
 * ATPL MASTER GOOGLE DRIVE SYNC ENGINE (ANTI-HANG & UNIFIED EDITION)
 * Kills all dead Cloud Run / Firebase / EventSource loops automatically
 * Unifies ATPLGoogleSync, ATPLCentralFileSync, ATPLFirebase & HR Docs into 1 Google Drive Backend
 */
(function () {
  "use strict";

  // 1. KILL ALL DEAD AI STUDIO BACKENDS & EVENTSOURCE LOOPS IMMEDIATELY
  window.__atplFirebaseQuotaExhausted = true;
  window.LIVE_CLOUD_RUN_URL = "";
  window.__ATPL_CENTRAL_BACKEND_URL = "";
  window.ATPL_GET_API_BASE = function () { return ""; };

  // Block dead EventSource('/api/sync/events') that hangs Chrome
  if (window.EventSource) {
    const OrigEventSource = window.EventSource;
    window.EventSource = function (url, config) {
      if (typeof url === "string" && url.indexOf("/api/sync/") !== -1) {
        return { addEventListener: function () {}, close: function () {} };
      }
      return new OrigEventSource(url, config);
    };
  }

  // Intercept dead /api/sync/ and ./data/ fetch calls so browser never freezes
  const origFetch = window.fetch;
  window.fetch = async function (input, init) {
    const url = typeof input === "string" ? input : (input && input.url) || "";
    if (
      url.indexOf("/api/sync/") !== -1 ||
      url.indexOf("data/salary_files.json") !== -1 ||
      url.indexOf("data/atpl-documents.json") !== -1 ||
      url.indexOf("data/blobs/") !== -1 ||
      url.indexOf(".run.app") !== -1
    ) {
      return new Response(JSON.stringify({ ok: true, blocked_legacy: true, salary_files: [], hr_docs: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
    return origFetch.apply(this, arguments);
  };

  // 2. YOUR SINGLE GOOGLE APPS SCRIPT URL (GOOGLE DRIVE BACKEND)
  const GAS_URL = "https://script.google.com/macros/s/AKfycbx2H-SN29b1-16G3bfB5jjC-aS4yK6hL2nCaF9vR9hK-N7mP-Q6A/exec";

  // Memory Cache so Excel files are NEVER parsed twice (100% Hang Prevention)
  const parsedWorkbookCache = new Map();
  let isSyncing = false;

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

  async function callGoogleDrive(payload) {
    try {
      const res = await origFetch(GAS_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload)
      });
      if (!res.ok) return { ok: false, offline: true };
      const txt = await res.text();
      try {
        return JSON.parse(txt);
      } catch (_) {
        return { ok: false, offline: true };
      }
    } catch (_) {
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

  // 3. CORE UPLOAD / DELETE / SYNC FUNCTIONS
  async function uploadSalaryFile(name, arrayBufOrB64) {
    removeTombstone("ATPL_SALARY_TOMBSTONES_V2", name);
    const b64 = typeof arrayBufOrB64 === "string" ? arrayBufOrB64 : bufToB64(arrayBufOrB64);
    return await callGoogleDrive({
      action: "save_file",
      module: "salary",
      id: name,
      name: name,
      data: b64,
      saved_at: new Date().toISOString()
    });
  }

  async function deleteSalaryFile(name) {
    setTombstone("ATPL_SALARY_TOMBSTONES_V2", name);
    parsedWorkbookCache.delete(String(name).toLowerCase());
    return await callGoogleDrive({
      action: "delete_file",
      module: "salary",
      id: name,
      name: name
    });
  }

  async function syncAllFromGoogleDrive(forceUI) {
    if (isSyncing) return;
    isSyncing = true;
    try {
      if (typeof window.updateRealtimeCloudBadge === "function") {
        window.updateRealtimeCloudBadge((window.FILES || []).length, "syncing", "☁️ Drive Syncing...");
      }

      const data = await callGoogleDrive({ action: "list_all" });
      if (!data || !data.ok) return;

      const remoteFiles = Array.isArray(data.salary_files) ? data.salary_files : [];
      const tombs = getTombstones("ATPL_SALARY_TOMBSTONES_V2");
      const remoteNames = new Set();

      for (let i = 0; i < remoteFiles.length; i++) {
        const rf = remoteFiles[i];
        if (!rf || !rf.name) continue;
        const key = String(rf.name).toLowerCase();
        if (tombs[key]) continue;
        remoteNames.add(key);

        const existsLocal = (window.FILES || []).find(f => f && String(f.name).toLowerCase() === key);
        if (!existsLocal && rf.data) {
          // Yield to browser UI thread so Chrome NEVER hangs!
          await new Promise(r => setTimeout(r, 25));
          const buf = b64ToBuf(rf.data);
          if (buf && typeof window.parseWB === "function") {
            let parsed = parsedWorkbookCache.get(key);
            if (!parsed) {
              const wb = window.parseWB(buf);
              const sheets = window.wbToSheets(wb);
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
              savedAt: rf.saved_at || new Date().toISOString()
            });
          }
        }
      }

      // Sync HR Documents if returned
      if (Array.isArray(data.hr_docs)) {
        const hrTombs = getTombstones("ATPL_HRDOC_TOMBSTONES_V2");
        const cleanDocs = data.hr_docs.filter(d => d && d.id && !hrTombs[String(d.id).toLowerCase()]);
        localStorage.setItem("ATPL_HR_DOCUMENTS_V1", JSON.stringify(cleanDocs));
        if (typeof window.hrDocRender === "function") window.hrDocRender();
      }

      if (typeof window.renderFiles === "function") window.renderFiles();
      if (typeof window.renderSheets === "function") window.renderSheets();
      if (typeof window.updStats === "function") window.updStats();
      if (typeof window.renderAllFilesPage === "function") window.renderAllFilesPage();
      if (typeof window.populateNJSelects === "function") window.populateNJSelects();
      if (typeof window.updateRealtimeCloudBadge === "function") {
        window.updateRealtimeCloudBadge((window.FILES || []).length, "ok", "☁️ Google Drive (" + (window.FILES || []).length + ")");
      }
      if (forceUI && typeof window.showToast === "function") {
        window.showToast("✅ Google Drive Sync Complete (" + (window.FILES || []).length + " files)");
      }
    } catch (e) {
      console.warn("[GoogleDriveSync] Notice:", e);
    } finally {
      isSyncing = false;
    }
  }

  // 4. EXPOSE UNIFIED ALIASES SO EVERY BUTTON IN INDEX.HTML WORKS
  const UnifiedEngine = {
    uploadFile: async function (name, b64) { return uploadSalaryFile(name, b64); },
    deleteFile: async function (name) { return deleteSalaryFile(name); },
    saveSalaryFile: async function (name, payload) {
      return uploadSalaryFile(name, (payload && payload.original_b64) || payload);
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
        await new Promise(r => setTimeout(r, 20)); // Anti-hang yield
        const buf = await file.arrayBuffer();
        let parsed = parsedWorkbookCache.get(key);
        if (!parsed) {
          const wb = window.parseWB(buf);
          const sheets = window.wbToSheets(wb);
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
    },
    reconcileAll: function (force) { return syncAllFromGoogleDrive(force); },
    syncNow: function (force) { return syncAllFromGoogleDrive(force); }
  };

  window.ATPLGoogleSync = UnifiedEngine;
  window.ATPLCentralFileSync = UnifiedEngine;
  window.ATPLFirebase = UnifiedEngine;
  window.ATPLCloudSharedStorageV1 = UnifiedEngine;
  window.triggerManualCrossBrowserSync = function () { return syncAllFromGoogleDrive(true); };
  window.atplTriggerCrossSync = function (force) { return syncAllFromGoogleDrive(force); };

  // Run initial sync gently after page load
  setTimeout(() => syncAllFromGoogleDrive(false), 1200);
})();
