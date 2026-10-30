/**
 * ATPL GitHub Cloud Sync Engine v3.0  (drop-in replacement for v2.0)
 *
 * WHY v3:
 *  v2 kept every salary file (base64) inside data/sync/sync_state.json. That file grew past 1 MB, so the
 *  GitHub Contents API stopped returning its content, the "update index" step failed silently and other
 *  browsers never saw new uploads / deletes (and every poll downloaded MBs => hangs).
 *
 * HOW v3 WORKS:
 *  - data/sync/manifest_v2.json  = tiny index (name, saved time, size)  -> a few KB, polled every 20s
 *  - data/sync/salary_files/salary_<name>.json  = the real file         -> downloaded ONLY when new/changed
 *  - data/sync/hr_docs/hr_<id>.json                                      -> same idea for HR documents
 *  - Deletes are tombstones inside the manifest, so Browser A delete => Browser B delete.
 *  - READING needs no token (raw.githubusercontent.com).  WRITING needs a GitHub token that is stored
 *    in the browser only (localStorage 'ATPL_GITHUB_SYNC_TOKEN'). No token is hard-coded any more.
 *
 * ONE-TIME SETUP (admin browser(s) that upload/delete):
 *    ATPLGitHubSync.setToken('github_pat_xxx')     // run once in browser console, or ATPLGitHubSync.promptToken()
 *
 * Author: ATPL Engineering
 */
(function(root) {
  'use strict';

  if (root.ATPLGitHubSync && root.ATPLGitHubSync.__version === 3) return;

  var TEST_CFG = root.ATPL_GH_SYNC_TEST_CONFIG || {};

  var CONFIG = {
    owner: 'nikhilatpl2026-jpg',
    repo: 'HR-SOFTWARE-ATPL',
    branch: 'main',
    syncPath: 'data/sync',
    manifestName: 'manifest_v2.json',
    pollMs: TEST_CFG.pollMs || 20000,          // how often other browsers look for changes
    startupDelayMs: TEST_CFG.startupDelayMs != null ? TEST_CFG.startupDelayMs : 8000, // let local DB load first
    downloadPauseMs: TEST_CFG.downloadPauseMs != null ? TEST_CFG.downloadPauseMs : 250,
    retryBaseMs: TEST_CFG.retryBaseMs != null ? TEST_CFG.retryBaseMs : 2000,
    tombstoneKeepDays: 120,
    getToken: function() {
      try {
        var t = root.localStorage ? root.localStorage.getItem('ATPL_GITHUB_SYNC_TOKEN') : '';
        return (t || '').trim();
      } catch (_) { return ''; }
    }
  };

  var MANIFEST = CONFIG.manifestName;
  var startedAt = Date.now();

  //  state 
  var remote = null;                 // last manifest seen from GitHub (normalized)
  var remoteLegacy = null;           // virtual manifest built from directory listing (only until manifest exists)
  var lastLegacyAt = 0;
  var lastPollAt = 0;
  var lastError = '';
  var pollPromise = null;
  var writeChain = Promise.resolve();
  var pendingWrites = 0;
  var hrFull = {};                   // id -> full HR doc (small), kept in memory
  var knownSalaryTombs = {};         // name -> true (already announced to subscribers)
  var knownHrTombs = {};
  var deliveredAt = {};              // 'name:saved_ms' -> ms when we last handed that version to the app
  var attempts = {};                 // 'name:saved_ms' -> download attempts
  var inited = false;

  var salarySubscribers = [];
  var salaryTombSubscribers = [];
  var hrSubscribers = [];
  var hrTombSubscribers = [];

  //  helpers 
  function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

  function dateMs(v) {
    if (v == null || v === '') return 0;
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    if (/^\d{10,}$/.test(String(v))) return Number(v);
    var n = Date.parse(v);
    return isFinite(n) ? n : 0;
  }

  function b64EncodeUnicode(str) {
    try {
      return btoa(unescape(encodeURIComponent(str)));
    } catch (_) {
      var bytes = new TextEncoder().encode(str);
      var bin = '';
      for (var i = 0; i < bytes.length; i += 8192) {
        bin += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + 8192, bytes.length)));
      }
      return btoa(bin);
    }
  }

  function b64DecodeUnicode(str) {
    var bin = atob(str);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  function extractBase64(payloadOrBuf) {
    if (!payloadOrBuf) return '';
    if (typeof payloadOrBuf === 'string') return payloadOrBuf;
    if (typeof payloadOrBuf.original_b64 === 'string') return payloadOrBuf.original_b64;
    if (payloadOrBuf.buf) {
      if (typeof payloadOrBuf.buf === 'string') return payloadOrBuf.buf;
      if (typeof root.bufToB64 === 'function') { try { return root.bufToB64(payloadOrBuf.buf); } catch (_) {} }
    }
    if (typeof root.bufToB64 === 'function') { try { return root.bufToB64(payloadOrBuf); } catch (_) {} }
    if (typeof root.bytesToB64 === 'function') { try { return root.bytesToB64(payloadOrBuf); } catch (_) {} }
    return '';
  }

  var lastToastAt = 0;
  function toast(msg) {
    var now = Date.now();
    if (now - lastToastAt < 30000) return;
    lastToastAt = now;
    try { if (typeof root.showToast === 'function') root.showToast(msg); } catch (_) {}
  }

  function reportError(what, e) {
    var msg = (e && e.message) ? e.message : String(e);
    lastError = what + ': ' + msg;
    try { console.warn('[ATPL-Sync] ' + lastError, e); } catch (_) {}
    if (msg === 'NO_TOKEN') {
      toast('WARNING: Cloud sync token set nahi hai - ye change sirf is browser me hai. Admin: ATPLGitHubSync.promptToken()');
    } else if (e && e.status === 401) {
      toast('WARNING: GitHub sync token galat ya expire ho gaya hai - naya token set karein.');
    } else {
      toast('WARNING: Cloud sync fail (' + what + '). Thodi der me dobara try hoga.');
    }
  }

  //  GitHub REST 
  function apiUrl(sub, withRef) {
    return 'https://api.github.com/repos/' + CONFIG.owner + '/' + CONFIG.repo + '/contents/' +
      CONFIG.syncPath + '/' + sub + (withRef ? ('?ref=' + encodeURIComponent(CONFIG.branch)) : '');
  }

  function rawUrl(sub) {
    return 'https://raw.githubusercontent.com/' + CONFIG.owner + '/' + CONFIG.repo + '/' +
      CONFIG.branch + '/' + CONFIG.syncPath + '/' + sub + '?_t=' + Date.now() + Math.floor(Math.random() * 1000);
  }

  async function githubApi(sub, method, body) {
    method = method || 'GET';
    var token = CONFIG.getToken();
    if (method !== 'GET' && !token) throw new Error('NO_TOKEN');
    var headers = { 'Accept': 'application/vnd.github+json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    if (body) headers['Content-Type'] = 'application/json';
    var res = await fetch(apiUrl(sub, method === 'GET'), {
      method: method,
      headers: headers,
      body: body ? JSON.stringify(body) : undefined
    });
    if (!res.ok) {
      if (res.status === 404 && method === 'GET') return null;
      var err = await res.json().catch(function() { return {}; });
      var e = new Error(err.message || ('GitHub API Error ' + res.status));
      e.status = res.status;
      throw e;
    }
    return await res.json();
  }

  // Create/update one file (retries on sha / branch conflicts). sha is ALWAYS read from the API,
  // which returns it even for files bigger than 1 MB.
  async function putFile(sub, text, message) {
    for (var attempt = 0; attempt < 4; attempt++) {
      var existing = null;
      try { existing = await githubApi(sub, 'GET'); }
      catch (e) { if (e.status === 401 || e.status === 403) throw e; }
      var body = { message: message, content: b64EncodeUnicode(text), branch: CONFIG.branch };
      if (existing && existing.sha && !Array.isArray(existing)) body.sha = existing.sha;
      try {
        return await githubApi(sub, 'PUT', body);
      } catch (e2) {
        if ((e2.status === 409 || e2.status === 422) && attempt < 3) { await sleep(400 * (attempt + 1)); continue; }
        throw e2;
      }
    }
  }

  async function deleteFile(sub, message) {
    for (var attempt = 0; attempt < 4; attempt++) {
      var existing = await githubApi(sub, 'GET');
      if (!existing || !existing.sha || Array.isArray(existing)) return false;
      try {
        await githubApi(sub, 'DELETE', { message: message, sha: existing.sha, branch: CONFIG.branch });
        return true;
      } catch (e) {
        if ((e.status === 409 || e.status === 422) && attempt < 3) { await sleep(400 * (attempt + 1)); continue; }
        if (e.status === 404) return false;
        throw e;
      }
    }
    return false;
  }

  async function fetchRawJson(sub) {
    var res = await fetch(rawUrl(sub), { cache: 'no-store' });
    if (!res.ok) throw new Error('download failed ' + res.status);
    return await res.json();
  }

  function salarySub(name) { return 'salary_files/salary_' + encodeURIComponent(name) + '.json'; }
  function hrSub(id) { return 'hr_docs/hr_' + encodeURIComponent(id) + '.json'; }

  //  manifest 
  function emptyManifest() {
    return { version: 2, rev: 0, last_updated: 0, salary_files: {}, salary_tombstones: {}, hr_docs: {}, hr_tombstones: {} };
  }

  function normalizeManifest(m) {
    m = m || {};
    m.version = 2;
    m.rev = m.rev || 0;
    m.last_updated = m.last_updated || 0;
    m.salary_files = m.salary_files || {};
    m.salary_tombstones = m.salary_tombstones || {};
    m.hr_docs = m.hr_docs || {};
    m.hr_tombstones = m.hr_tombstones || {};
    return m;
  }

  function pruneTombstones(m) {
    var cutoff = Date.now() - CONFIG.tombstoneKeepDays * 86400000;
    ['salary_tombstones', 'hr_tombstones'].forEach(function(k) {
      Object.keys(m[k]).forEach(function(key) {
        var t = dateMs(m[k][key] && m[k][key].deleted_at);
        if (t && t < cutoff) delete m[k][key];
      });
    });
  }

  // returns {status:'ok'|'missing'|'error', data}
  async function fetchRemoteManifest() {
    try {
      var res = await fetch(rawUrl(MANIFEST), { cache: 'no-store' });
      if (res.status === 404) return { status: 'missing' };
      if (!res.ok) return { status: 'error' };
      var d = await res.json();
      if (!d || d.version !== 2) return { status: 'error' };
      return { status: 'ok', data: normalizeManifest(d) };
    } catch (_) {
      return { status: 'error' };
    }
  }

  // Build a manifest from the files that already exist in the repo (first-time migration from v2).
  async function legacyManifest() {
    var m = emptyManifest();
    var sal = await githubApi('salary_files', 'GET').catch(function() { return null; });
    if (Array.isArray(sal)) {
      sal.forEach(function(it) {
        if (it && it.type === 'file' && /^salary_.+\.json$/.test(it.name)) {
          var nm = it.name.slice(7, -5);
          m.salary_files[nm] = { name: nm, saved_ms: 0, saved_at: '', size: it.size || 0, legacy: true };
        }
      });
    }
    var hr = await githubApi('hr_docs', 'GET').catch(function() { return null; });
    if (Array.isArray(hr)) {
      hr.forEach(function(it) {
        if (it && it.type === 'file' && /^hr_.+\.json$/.test(it.name)) {
          var id = it.name.slice(3, -5);
          m.hr_docs[id] = { id: id, name: id, updated_at: '', size: it.size || 0, legacy: true };
        }
      });
    }
    return m;
  }

  async function readManifestForWrite() {
    var meta = await githubApi(MANIFEST, 'GET');
    if (!meta || Array.isArray(meta)) return { m: null, sha: null };
    var m = null;
    if (meta.content) {
      try { m = JSON.parse(b64DecodeUnicode(String(meta.content).replace(/\s/g, ''))); } catch (_) {}
    }
    if (!m) {
      var r = await fetchRemoteManifest();
      if (r.status === 'ok') m = r.data;
    }
    if (m && m.version !== 2) m = null;
    return { m: m, sha: meta.sha };
  }

  // Read-modify-write of the tiny manifest with conflict retries.
  async function updateManifest(updater, message) {
    var lastErr;
    for (var attempt = 0; attempt < 6; attempt++) {
      var cur = await readManifestForWrite();
      var m = normalizeManifest(cur.m || await legacyManifest());
      updater(m);
      pruneTombstones(m);
      m.rev = (m.rev || 0) + 1;
      m.last_updated = Date.now();
      var body = {
        message: message || ('[Cloud Sync] Manifest rev ' + m.rev),
        content: b64EncodeUnicode(JSON.stringify(m)),
        branch: CONFIG.branch
      };
      if (cur.sha) body.sha = cur.sha;
      try {
        await githubApi(MANIFEST, 'PUT', body);
        remote = m;
        return m;
      } catch (e) {
        lastErr = e;
        if (e.status === 409 || e.status === 422) { await sleep(300 + Math.random() * 500 * (attempt + 1)); continue; }
        throw e;
      }
    }
    throw lastErr || new Error('manifest update failed');
  }

  // All writes go through one queue (no overlapping commits from this browser) and retry on failure.
  function enqueueWrite(job) {
    pendingWrites++;
    var run = async function() {
      var lastErr;
      for (var i = 0; i <= 3; i++) {
        try { return await job(); }
        catch (e) {
          lastErr = e;
          if (e && (e.message === 'NO_TOKEN' || e.status === 401 || e.status === 403)) break;
          await sleep(CONFIG.retryBaseMs * (i + 1));
        }
      }
      throw lastErr;
    };
    var p = writeChain.then(run);
    writeChain = p.catch(function() {});
    return p.finally(function() { pendingWrites--; });
  }

  //  local app helpers 
  function localFiles() { return Array.isArray(root.FILES) ? root.FILES : []; }

  function findLocal(name) {
    var arr = localFiles(), low = String(name).toLowerCase();
    for (var i = 0; i < arr.length; i++) { if (arr[i] && arr[i].name === name) return arr[i]; }
    for (var j = 0; j < arr.length; j++) { if (arr[j] && String(arr[j].name).toLowerCase() === low) return arr[j]; }
    return null;
  }

  function localSalaryTombMs(name) {
    try {
      var t = JSON.parse(root.localStorage.getItem('ATPL_SALARY_TOMBSTONES_V2') || '{}');
      var v = t[String(name).toLowerCase()];
      if (v === true) return Infinity;
      return dateMs(v);
    } catch (_) { return 0; }
  }

  function slimSalary(e) {
    return {
      name: e.name, saved: e.saved_ms || 0, saved_at: e.saved_at || '', size: e.size || 0,
      rows_count: e.rows_count || 0, sheets_count: e.sheets_count || 1,
      uploaded_by: e.uploaded_by || 'admin', updated_at: e.updated_at || e.saved_at || ''
    };
  }

  function metaList(m) {
    return Object.keys(m.salary_files).map(function(k) { return slimSalary(m.salary_files[k]); });
  }

  // Hand data to the ERP storage layer (it writes IndexedDB + refreshes the UI).
  async function deliverSalary(payload) {
    var S = root.ATPLCloudSharedStorageV1;
    if (S && typeof S.handleFirebaseFilesUpdate === 'function') {
      try { await S.handleFirebaseFilesUpdate(payload); } catch (e) { console.warn('[ATPL-Sync] deliver salary err', e); }
    } else {
      salarySubscribers.forEach(function(fn) { try { fn(payload); } catch (_) {} });
    }
  }

  async function deliverHr(payload) {
    var S = root.ATPLCloudSharedStorageV1;
    if (S && typeof S.handleFirebaseHrUpdate === 'function') {
      try { await S.handleFirebaseHrUpdate(payload); } catch (e) { console.warn('[ATPL-Sync] deliver hr err', e); }
    } else {
      hrSubscribers.forEach(function(fn) { try { fn(payload); } catch (_) {} });
    }
  }

  function needDownload(name, e) {
    var last = deliveredAt[name + ':' + (e.saved_ms || 0)] || 0;
    if (last && Date.now() - last < 120000) return false;       // just delivered, give UI time
    var savedMs = e.saved_ms || 0;
    if ((attempts[name + ':' + savedMs] || 0) >= 4) return false; // give up until it changes
    var lt = localSalaryTombMs(name);
    if (lt && lt > savedMs) return false;                         // deleted locally after that version
    var loc = findLocal(name);
    if (!loc) return true;
    if (!savedMs) return false;                                   // legacy entry and we already have the file
    return savedMs > dateMs(loc.savedAt || loc.saved);
  }

  //  polling (other browsers) 
  async function applyManifest(m) {
    // 1) deletes done in another browser
    var removed = [], newTombs = [];
    Object.keys(m.salary_tombstones).forEach(function(name) {
      if (m.salary_files[name]) return;
      var t = m.salary_tombstones[name];
      if (!t || name === '__ALL__') return;
      if (!knownSalaryTombs[name]) { knownSalaryTombs[name] = true; newTombs.push({ name: name, deleted_at: t.deleted_at }); }
      var loc = findLocal(name);
      if (loc && dateMs(loc.savedAt || loc.saved) <= dateMs(t.deleted_at)) removed.push(name);
    });
    if (newTombs.length) {
      salaryTombSubscribers.forEach(function(fn) { try { fn(newTombs); } catch (_) {} });
    }
    if (removed.length) {
      await deliverSalary({ all: metaList(m), removedNames: removed });
    }

    // 2) new / changed salary files (only the ones we really need)
    var todo = Object.keys(m.salary_files).filter(function(n) { return needDownload(n, m.salary_files[n]); });
    for (var i = 0; i < todo.length; i++) {
      var name = todo[i], e = m.salary_files[name], key = name + ':' + (e.saved_ms || 0);
      attempts[key] = (attempts[key] || 0) + 1;
      try {
        var doc = await fetchRawJson(salarySub(name));
        if (!doc || (!doc.original_b64 && !doc.sheets)) { deliveredAt[key] = Date.now(); continue; }
        var docMs = dateMs(doc.saved_at || doc.saved);
        if (e.saved_ms && docMs && docMs < e.saved_ms) throw new Error('stale copy, retry'); // CDN lag
        doc.name = doc.name || name;
        doc.saved_at = new Date(docMs || e.saved_ms || Date.now()).toISOString();
        doc.sheets = doc.sheets || [];     // storage layer skips docs without 'sheets'
        var all = metaList(m).map(function(x) { return x.name === name ? doc : x; });
        deliveredAt[key] = Date.now();
        await deliverSalary({ all: all, removedNames: [] });
        doc = null; all = null;
        if (i < todo.length - 1) await sleep(CONFIG.downloadPauseMs); // keep the UI responsive
      } catch (err) {
        console.warn('[ATPL-Sync] download failed for', name, err && err.message);
      }
    }

    // 3) HR documents (small): keep full copies in memory
    var hrChanged = false;
    for (var id in m.hr_docs) {
      var he = m.hr_docs[id], cached = hrFull[id];
      if (cached && dateMs(cached.updated_at) >= dateMs(he.updated_at)) continue;
      if (cached && he.legacy) continue;
      try {
        var hd = await fetchRawJson(hrSub(id));
        if (hd && hd.id) { hrFull[id] = hd; hrChanged = true; }
      } catch (_) {}
    }
    var hrNewTombs = [];
    Object.keys(m.hr_tombstones).forEach(function(id2) {
      if (m.hr_docs[id2]) return;
      if (hrFull[id2]) { delete hrFull[id2]; hrChanged = true; }
      if (!knownHrTombs[id2]) { knownHrTombs[id2] = true; hrNewTombs.push({ id: id2, deleted_at: m.hr_tombstones[id2].deleted_at }); }
    });
    if (hrNewTombs.length) hrTombSubscribers.forEach(function(fn) { try { fn(hrNewTombs); } catch (_) {} });
    if (hrChanged) await deliverHr({ all: Object.keys(hrFull).map(function(k) { return hrFull[k]; }) });
  }

  async function doPoll() {
    var r = await fetchRemoteManifest();
    var m;
    if (r.status === 'error') return;
    if (r.status === 'missing') {
      // manifest not created yet (first run after upgrade): use the repo folder listing, at most every 10 min
      if (!remoteLegacy || Date.now() - lastLegacyAt > 600000) {
        lastLegacyAt = Date.now();
        try { remoteLegacy = await legacyManifest(); } catch (_) { return; }
      }
      m = remoteLegacy;
    } else {
      m = r.data;
    }
    remote = m;
    // wait a moment after page load so the local DB / FILES list is populated before comparing
    if (Date.now() - startedAt < CONFIG.startupDelayMs) return;
    await applyManifest(m);
  }

  function pollRemoteState() {
    if (pollPromise) return pollPromise;
    pollPromise = doPoll().catch(function(e) { lastError = 'poll: ' + (e && e.message); })
      .then(function() { lastPollAt = Date.now(); pollPromise = null; });
    return pollPromise;
  }

  async function pollIfStale(maxAgeMs) {
    if (remote && Date.now() - lastPollAt < maxAgeMs) return;
    await pollRemoteState();
  }

  function startPolling() {
    if (!root.window && typeof root.addEventListener !== 'function') return;
    try {
      root.addEventListener('focus', function() { pollRemoteState(); });
      if (root.document) {
        root.document.addEventListener('visibilitychange', function() { if (!root.document.hidden) pollRemoteState(); });
      }
    } catch (_) {}
    setInterval(function() {
      if (root.document && root.document.hidden) return;
      pollRemoteState();
    }, CONFIG.pollMs);
    setTimeout(pollRemoteState, CONFIG.startupDelayMs + 500);
  }

  //  public API 
  var ATPLGitHubSync = {
    __version: 3,

    setToken: function(t) {
      try { root.localStorage.setItem('ATPL_GITHUB_SYNC_TOKEN', String(t || '').trim()); } catch (_) {}
      lastError = '';
      return !!CONFIG.getToken();
    },
    clearToken: function() { try { root.localStorage.removeItem('ATPL_GITHUB_SYNC_TOKEN'); } catch (_) {} },
    promptToken: function() {
      var t = root.prompt ? root.prompt('GitHub sync token (fine-grained, Contents: read/write on HR-SOFTWARE-ATPL):') : '';
      if (t) return this.setToken(t);
      return false;
    },
    syncNow: function() { return pollRemoteState(); },
    status: function() {
      return {
        version: 3, hasToken: !!CONFIG.getToken(), lastPollAt: lastPollAt, lastError: lastError,
        manifestRev: remote ? remote.rev : null,
        remoteFiles: remote ? Object.keys(remote.salary_files).length : null,
        pendingWrites: pendingWrites
      };
    },

    //  SALARY FILES 
    saveSalaryFile: async function(name, payloadOrBuf, meta) {
      try {
        var base64 = extractBase64(payloadOrBuf);
        var sheets = payloadOrBuf && Array.isArray(payloadOrBuf.sheets) ? payloadOrBuf.sheets : undefined;
        if (!base64 && !sheets) { console.warn('[ATPL-Sync] nothing to upload for', name); return true; }
        var savedMs = dateMs(meta && meta.saved_at) || Date.now();
        var savedIso = new Date(savedMs).toISOString();
        var rows = (meta && meta.rows_count) || (sheets ? sheets.reduce(function(a, s) { return a + Math.max(0, (s.rows || []).length - 1); }, 0) : 0);
        var shCount = (meta && meta.sheets_count) || (sheets ? sheets.length : 1);
        var doc = {
          name: name, saved: savedMs, saved_at: savedIso, original_b64: base64,
          rows_count: rows, sheets_count: shCount, sheets: sheets,
          uploaded_by: (meta && meta.uploaded_by) || 'admin', updated_at: new Date().toISOString()
        };
        var entry = {
          name: name, saved_ms: savedMs, saved_at: savedIso, size: base64.length,
          rows_count: rows, sheets_count: shCount, uploaded_by: doc.uploaded_by, updated_at: doc.updated_at
        };
        deliveredAt[name + ':' + savedMs] = Date.now();     // our own upload: don't pull it back
        delete knownSalaryTombs[name];

        await enqueueWrite(async function() {
          await putFile(salarySub(name), JSON.stringify(doc), '[Cloud Sync] Upload ' + name);
          await updateManifest(function(m) {
            m.salary_files[name] = entry;
            delete m.salary_tombstones[name];
          }, '[Cloud Sync] Index ' + name);
        });
        return true;
      } catch (err) {
        reportError('upload ' + name, err);
        return true; // never block the UI
      }
    },

    deleteSalaryFile: async function(name) {
      try {
        await enqueueWrite(async function() {
          await deleteFile(salarySub(name), '[Cloud Sync] Delete ' + name);
          await updateManifest(function(m) {
            delete m.salary_files[name];
            m.salary_tombstones[name] = { name: name, deleted_at: new Date().toISOString() };
          }, '[Cloud Sync] Index delete ' + name);
        });
        return true;
      } catch (err) {
        reportError('delete ' + name, err);
        return true;
      }
    },

    clearAllSalaryFiles: async function() {
      try {
        await enqueueWrite(async function() {
          var cur = await readManifestForWrite();
          var m0 = normalizeManifest(cur.m || await legacyManifest());
          var names = {};
          Object.keys(m0.salary_files).forEach(function(n) { names[n] = true; });
          localFiles().forEach(function(f) { if (f && f.name) names[f.name] = true; });
          var list = Object.keys(names);
          for (var i = 0; i < list.length; i++) {
            if (m0.salary_files[list[i]]) await deleteFile(salarySub(list[i]), '[Cloud Sync] Delete ' + list[i]);
          }
          var nowIso = new Date().toISOString();
          await updateManifest(function(m) {
            list.forEach(function(n) {
              delete m.salary_files[n];
              m.salary_tombstones[n] = { name: n, deleted_at: nowIso };
            });
          }, '[Cloud Sync] Index clear all');
        });
        return true;
      } catch (e) {
        reportError('clear all', e);
        return true;
      }
    },

    fetchAllSalaryFiles: async function() {
      await pollIfStale(10000);
      return remote ? metaList(remote) : [];
    },

    fetchAllTombstones: async function() {
      await pollIfStale(10000);
      var out = [];
      if (remote) Object.keys(remote.salary_tombstones).forEach(function(k) {
        if (!remote.salary_files[k]) out.push(remote.salary_tombstones[k]);
      });
      return out;
    },

    //  HR DOCUMENTS 
    saveHrDoc: async function(doc) {
      if (!doc || !doc.id) return true;
      try {
        doc.updated_at = doc.updated_at || new Date().toISOString();
        hrFull[doc.id] = doc;
        delete knownHrTombs[doc.id];
        var text = JSON.stringify(doc);
        var entry = { id: doc.id, name: doc.document_name || doc.name || doc.id, updated_at: doc.updated_at, size: text.length };
        await enqueueWrite(async function() {
          await putFile(hrSub(doc.id), text, '[Cloud Sync] Upload HR doc ' + entry.name);
          await updateManifest(function(m) {
            m.hr_docs[doc.id] = entry;
            delete m.hr_tombstones[doc.id];
          }, '[Cloud Sync] Index HR doc ' + doc.id);
        });
        return true;
      } catch (err) {
        reportError('HR upload', err);
        return true;
      }
    },

    deleteHrDoc: async function(id) {
      try {
        delete hrFull[id];
        await enqueueWrite(async function() {
          await deleteFile(hrSub(id), '[Cloud Sync] Delete HR doc ' + id);
          await updateManifest(function(m) {
            delete m.hr_docs[id];
            m.hr_tombstones[id] = { id: id, deleted_at: new Date().toISOString() };
          }, '[Cloud Sync] Index HR delete ' + id);
        });
        return true;
      } catch (err) {
        reportError('HR delete', err);
        return true;
      }
    },

    fetchAllHrDocs: async function() {
      await pollIfStale(15000);
      return Object.keys(hrFull).map(function(k) { return hrFull[k]; });
    },

    fetchAllHrTombstones: async function() {
      await pollIfStale(15000);
      var out = [];
      if (remote) Object.keys(remote.hr_tombstones).forEach(function(k) {
        if (!remote.hr_docs[k]) out.push(remote.hr_tombstones[k]);
      });
      return out;
    },

    //  hook into the ERP (same drop-in object the app already expects: window.ATPLFirebase) 
    init: function() {
      if (inited) return;
      inited = true;
      var self = this;
      root.ATPLGitHubSync = self;

      try {
        Object.defineProperty(root, '__atplFirebaseQuotaExhausted', {
          get: function() { return false; }, set: function() {}, configurable: true
        });
      } catch (_) { root.__atplFirebaseQuotaExhausted = false; }

      function sub(list, cb, initial) {
        if (typeof cb === 'function') {
          list.push(cb);
          if (initial) initial().then(function(v) { if (v) { try { cb(v); } catch (_) {} } }).catch(function() {});
        }
        return function() { var i = list.indexOf(cb); if (i !== -1) list.splice(i, 1); };
      }

      root.ATPLFirebase = {
        init: function() {},
        saveSalaryFile: function(n, p, m) { return self.saveSalaryFile(n, p, m); },
        deleteSalaryFile: function(n) { return self.deleteSalaryFile(n); },
        clearAllSalaryFiles: function() { return self.clearAllSalaryFiles(); },
        fetchAllSalaryFiles: function() { return self.fetchAllSalaryFiles(); },
        fetchAllTombstones: function() { return self.fetchAllTombstones(); },
        subscribeSalaryFiles: function(cb) {
          return sub(salarySubscribers, cb, function() {
            return self.fetchAllSalaryFiles().then(function(f) { return f.length ? { all: f, removedNames: [] } : null; });
          });
        },
        subscribeTombstones: function(cb) {
          return sub(salaryTombSubscribers, cb, function() {
            return self.fetchAllTombstones().then(function(t) { return t.length ? t : null; });
          });
        },
        decodeDocPayload: function(doc) {
          if (!doc) return doc;
          if (doc.payload) return doc.payload;
          if (doc.original_b64) return { name: doc.name, original_b64: doc.original_b64, v: 1, sheets: doc.sheets };
          return doc;
        },
        saveHrDoc: function(d) { return self.saveHrDoc(d); },
        deleteHrDoc: function(id) { return self.deleteHrDoc(id); },
        decodeHrPayload: function(doc) {
          if (!doc) return doc;
          if (doc.payload) return doc.payload;
          return doc;
        },
        fetchAllHrDocs: function() { return self.fetchAllHrDocs(); },
        fetchAllHrTombstones: function() { return self.fetchAllHrTombstones(); },
        subscribeHrDocs: function(cb) {
          return sub(hrSubscribers, cb, function() {
            return self.fetchAllHrDocs().then(function(d) { return d.length ? { all: d } : null; });
          });
        },
        subscribeHrTombstones: function(cb) {
          return sub(hrTombSubscribers, cb, function() {
            return self.fetchAllHrTombstones().then(function(t) { return t.length ? t : null; });
          });
        },
        safeKey: function(k) { return String(k || '').replace(/[^a-zA-Z0-9_-]/g, '_'); },
        safeHrKey: function(k) { return String(k || '').replace(/[^a-zA-Z0-9_-]/g, '_'); },
        fetchAllEmployeeMaster: async function() { return []; },
        saveEmployeeMaster: async function() { return true; }
      };

      startPolling();
      try { console.log('[ATPL-Sync] Cloud Sync Engine v3.0 active (manifest based). Token:', !!CONFIG.getToken() ? 'set' : 'NOT set (read-only)'); } catch (_) {}
    }
  };

  root.ATPLGitHubSync = ATPLGitHubSync;

  try { ATPLGitHubSync.init(); } catch (e) { try { console.warn('[ATPL-Sync] init failed', e); } catch (_) {} }
})(typeof window !== 'undefined' ? window : this);
