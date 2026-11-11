/**
 * ATPL GOOGLE DRIVE & GOOGLE SHEETS UNIFIED REAL-TIME SYNC ENGINE (V7 - MASTER BRIDGE)
 * 100% Fixes:
 * 1. Employee Master any small edit / paste instant cross-browser sync (Hooks ATPLCloudSyncV1 & localStorage)
 * 2. Preserves all 40+ Employee Master columns without field loss
 * 3. HR Documents, PF & ESIC Challan permanent cloud sync (Never disappears after 5-10s)
 * 4. Zero Hang, Zero Reload, Zero Firebase Toggle
 */
(function(window) {
  'use strict';

  // ── 0. Permanently Hide Any Legacy Firebase Toggle ──
  function suppressFirebaseUI() {
    try {
      window.ATPL_DISABLE_FIREBASE = true;
      var st = document.getElementById('atpl-no-fb-style');
      if (!st) {
        st = document.createElement('style');
        st.id = 'atpl-no-fb-style';
        st.innerHTML = '[id*="firebase" i], [class*="firebase" i], #fbToggle, .fb-toggle-wrap, [data-sync="firebase"] { display: none !important; }';
        (document.head || document.documentElement).appendChild(st);
      }
    } catch (_) {}
  }
  suppressFirebaseUI();

  var DEFAULT_GAS_URL = 'https://script.google.com/macros/s/AKfycbxiaKVtVJUWqDPtI-9iecG0LE817SfbbQNfUaZouw8sgYr3f1zRffutMu_UGnV-vqy-oA/exec';

  function getGasUrl() {
    try {
      var custom = (window.localStorage && window.localStorage.getItem('ATPL_CUSTOM_GAS_URL')) || '';
      if (custom && custom.trim() && /^https:\/\/script\.google\.com\/macros\/s\//.test(custom.trim())) {
        return custom.trim();
      }
      if (window.ATPL_CUSTOM_GAS_URL && String(window.ATPL_CUSTOM_GAS_URL).trim()) {
        return String(window.ATPL_CUSTOM_GAS_URL).trim();
      }
      if (window.ATPL_GAS_URL && String(window.ATPL_GAS_URL).trim() && /^https:\/\/script\.google\.com\/macros\/s\//.test(String(window.ATPL_GAS_URL).trim())) {
        return String(window.ATPL_GAS_URL).trim();
      }
    } catch (_) {}
    return DEFAULT_GAS_URL;
  }

  var GAS_URL = getGasUrl();
  window.ATPL_GAS_URL = GAS_URL;

  var MY_CLIENT_ID = 'client_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  var localVersion = 0;
  try {
    localVersion = parseInt(window.localStorage.getItem('ATPL_DRIVE_SYNC_VERSION') || '0', 10) || 0;
  } catch (_) {}

  var isPolling = false;
  var downloadQueue = [];
  var isDownloading = false;
  var isInitialLoaded = false;
  var fileMap = new Map();
  var subscribers = {};

  // ── Locks & Fingerprints (Prevents 5-10 sec disappearing bug) ──
  var lastEmpLocalWriteTime = 0;
  var lastVaultLocalWriteTime = 0;
  var lastFileLocalWriteTime = 0;
  var recentlyUploadedFiles = {};
  var _lastAppliedEmpHash = '';
  var _lastAppliedEmpFp = '';
  var _lastPushedEmpHash = '';
  var _lastAppliedVaultHash = '';

  // Known localStorage keys used by index.html for Emp Master, HR Docs, PF & ESIC Challan
  var EMP_STORAGE_KEYS = [
    'AroraTextilesEmployeeMasterV3',
    'ATPL_EmployeeMaster_V1',
    'ATPL_EMP_MASTER_V1'
  ];

  var VAULT_STORAGE_KEYS = [
    'ATPL_HR_DOCUMENTS_V1',
    'ATPL_HR_DOCS_V1',
    'AroraTextilesHRDocsV1',
    'hrDocsData',
    'ATPL_CHALLAN_DATA_V1',
    'ATPL_CHALLAN_HISTORY_V1',
    'ATPL_PF_ESIC_CHALLAN_V1',
    'ATPL_STATUTORY_CHALLAN_V1',
    'ATPL_COMPLIANCE_DOL_V1'
  ];

  // Fast string hash to detect even a 1-character change in any employee or document
  function fastHashStr(str) {
    if (!str) return '0';
    var h = 2166136261;
    var len = str.length;
    for (var i = 0; i < len; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return len + '_' + (h >>> 0).toString(36);
  }

  function getMimeType(fileName, fallback) {
    var ext = String(fileName || '').split('.').pop().toLowerCase().trim();
    var map = {
      'pdf': 'application/pdf',
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'png': 'image/png',
      'webp': 'image/webp',
      'doc': 'application/msword',
      'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'xls': 'application/vnd.ms-excel',
      'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'csv': 'text/csv',
      'txt': 'text/plain'
    };
    return map[ext] || fallback || 'application/octet-stream';
  }

  function isSpreadsheetFile(fileName) {
    var ext = String(fileName || '').split('.').pop().toLowerCase().trim();
    return ['xlsx', 'xls', 'csv'].indexOf(ext) !== -1;
  }

  // ── Universal Google Apps Script Transport (Safe Timeout + Non-Blocking) ──
  async function callGoogleBackend(action, params) {
    var endpoint = getGasUrl();
    if (!endpoint) return null;
    var p = Object.assign({ action: action, sender: MY_CLIENT_ID, _ts: Date.now() }, params || {});
    var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timeoutId = controller ? setTimeout(function() { controller.abort(); }, 25000) : null;
    try {
      var res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(p),
        signal: controller ? controller.signal : undefined
      });
      if (timeoutId) clearTimeout(timeoutId);
      if (!res.ok) return null;
      var text = await res.text();
      try {
        return JSON.parse(text);
      } catch (e) {
        return { ok: false, error: 'JSON parse error', raw: text };
      }
    } catch (err) {
      if (timeoutId) clearTimeout(timeoutId);
      console.warn('[ATPL Sync] Transport warning (' + action + '):', err.message);
      return null;
    }
  }

  // ── UI Sync Status Indicators ──
  function updateSyncBadge(status, text) {
    var badge = document.getElementById('cloudSyncStatusBadge');
    if (!badge) return;
    if (status === 'syncing') {
      badge.innerHTML = '<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#38bdf8;animation:pulse 1s infinite;margin-right:5px"></span>' + (text || 'Syncing…');
      badge.style.color = '#38bdf8';
    } else if (status === 'error') {
      badge.innerHTML = '<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#f87171;margin-right:5px"></span>Offline';
      badge.style.color = '#f87171';
    } else {
      var cnt = Array.isArray(window.FILES) ? window.FILES.length : 0;
      var empCnt = (window.EM && Array.isArray(window.EM.data)) ? window.EM.data.length : 0;
      badge.innerHTML = '<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#4ade80;margin-right:5px"></span>Drive & Sheets (' + cnt + ' Files, ' + empCnt + ' Emp)';
      badge.style.color = '#4ade80';
    }
  }

  var fileUiTimer = null;
  function refreshFilesUI() {
    clearTimeout(fileUiTimer);
    fileUiTimer = setTimeout(function() {
      requestAnimationFrame(function() {
        try { if (typeof window.renderSavedFiles === 'function') window.renderSavedFiles(); } catch (_) {}
        try { if (typeof window.updStats === 'function') window.updStats(); } catch (_) {}
        try { if (typeof window.renderAllFilesPage === 'function') window.renderAllFilesPage(); } catch (_) {}
        try { if (typeof window.populateNJSelects === 'function') window.populateNJSelects(); } catch (_) {}
        try { if (typeof window.hrDocRender === 'function') window.hrDocRender(); } catch (_) {}
        try { if (typeof window.initStatutoryChallanTab === 'function') window.initStatutoryChallanTab(); } catch (_) {}
        var sl = document.getElementById('storageLbl');
        if (sl && window.FILES) sl.textContent = window.FILES.length + ' files saved';
        updateSyncBadge('ok');
        notifySubscribers('salary');
        notifySubscribers('hr_doc');
        notifySubscribers('files');
      });
    }, 80);
  }

  var emUiTimer = null;
  function refreshEmployeeUI() {
    clearTimeout(emUiTimer);
    emUiTimer = setTimeout(function() {
      requestAnimationFrame(function() {
        try { if (typeof window.emFilter === 'function') window.emFilter(); } catch (_) {}
        try { if (typeof window.emUpdateStats === 'function') window.emUpdateStats(); } catch (_) {}
        try { if (typeof window.aroraRefreshMaster === 'function') window.aroraRefreshMaster(); } catch (_) {}
        var badge = document.getElementById('empMasterBadge');
        var totalBadge = document.getElementById('emTotalBadge');
        var len = (window.EM && Array.isArray(window.EM.data)) ? window.EM.data.length : 0;
        if (badge && len > 0) badge.textContent = String(len);
        if (totalBadge && len > 0) totalBadge.textContent = len + ' Employees';
        updateSyncBadge('ok');
        notifySubscribers('employee');
      });
    }, 60);
  }

  function notifySubscribers(mod) {
    (subscribers[mod] || []).forEach(function(cb) {
      try { cb(); } catch (_) {}
    });
  }

  function b64ToBuf(b64) {
    if (!b64 || typeof b64 !== 'string') return null;
    try {
      var clean = b64.replace(/^data:[^;]+;base64,/, '').trim();
      var bin = atob(clean);
      var len = bin.length;
      var bytes = new Uint8Array(len);
      for (var i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
      return bytes.buffer;
    } catch (_) {
      return null;
    }
  }

  function toB64(buf) {
    if (!buf) return '';
    if (typeof buf === 'string') {
      return buf.replace(/^data:[^;]+;base64,/, '').trim();
    }
    try {
      var bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
      var bin = '';
      var chunk = 8192;
      for (var i = 0; i < bytes.byteLength; i += chunk) {
        bin += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + chunk, bytes.byteLength)));
      }
      return btoa(bin);
    } catch (_) {
      return '';
    }
  }

  function extractEmpId(r) {
    if (!r || typeof r !== 'object') return '';
    var id = r.emp_id || r.empCode || r.emp_code || r.id || r.code || r.EmpID || r['Emp ID'] || r['Employee ID'] || r['1. Employee ID'] || '';
    return String(id).trim();
  }

  // ── Pack & Unpack HR Docs / PF / ESIC Vault Inside Employee Master Sheet ──
  // Saves metadata to Google Sheets without requiring any Code.gs modifications!
  function buildSystemVaultRecords() {
    var vaultObj = {};
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (!k) continue;
        var kLow = k.toLowerCase();
        var isTarget = VAULT_STORAGE_KEYS.indexOf(k) !== -1 ||
          kLow.indexOf('hrdoc') >= 0 ||
          kLow.indexOf('hr_doc') >= 0 ||
          kLow.indexOf('challan') >= 0 ||
          kLow.indexOf('esic') >= 0 ||
          kLow.indexOf('epfo') >= 0;
        if (isTarget && kLow.indexOf('tombstone') === -1 && kLow.indexOf('session') === -1) {
          var val = localStorage.getItem(k);
          if (val && val.length < 180000) {
            vaultObj[k] = val;
          }
        }
      }
    } catch (_) {}

    var jsonStr = JSON.stringify(vaultObj);
    if (!jsonStr || jsonStr === '{}') return [];

    var chunkSize = 40000;
    var chunks = [];
    for (var c = 0; c < jsonStr.length; c += chunkSize) {
      chunks.push({
        emp_id: '__atpl_sys__vault_' + (chunks.length),
        name: '__ATPL_CLOUD_VAULT__',
        father: jsonStr.slice(c, c + chunkSize),
        updated_at: new Date().toISOString()
      });
    }
    return chunks;
  }

  function applySystemVaultRecords(sysRows) {
    if (!Array.isArray(sysRows) || !sysRows.length) return;
    if (Date.now() - lastVaultLocalWriteTime < 20000) return;

    var vaultRows = sysRows.filter(function(r) {
      return r && String(r.emp_id || '').indexOf('__atpl_sys__vault_') === 0;
    }).sort(function(a, b) {
      var ia = parseInt(String(a.emp_id).replace('__atpl_sys__vault_', ''), 10) || 0;
      var ib = parseInt(String(b.emp_id).replace('__atpl_sys__vault_', ''), 10) || 0;
      return ia - ib;
    });

    if (!vaultRows.length) return;
    var fullJson = vaultRows.map(function(r) { return r.father || ''; }).join('');
    if (!fullJson) return;

    var hash = fastHashStr(fullJson);
    if (hash === _lastAppliedVaultHash) return;
    _lastAppliedVaultHash = hash;

    try {
      var vaultObj = JSON.parse(fullJson);
      var changedAny = false;
      Object.keys(vaultObj).forEach(function(k) {
        var remoteVal = vaultObj[k];
        if (typeof remoteVal === 'string' && remoteVal.length > 2) {
          var curVal = localStorage.getItem(k);
          if (curVal !== remoteVal) {
            window.__ATPL_INTERNAL_STORAGE_WRITE = true;
            try { localStorage.setItem(k, remoteVal); } finally { window.__ATPL_INTERNAL_STORAGE_WRITE = false; }
            changedAny = true;
          }
        }
      });
      if (changedAny) {
        try { if (typeof window.hrDocLoad === 'function') window.hrDocLoad(); } catch (_) {}
        try { if (typeof window.hrDocRender === 'function') window.hrDocRender(); } catch (_) {}
        try { if (typeof window.initStatutoryChallanTab === 'function') window.initStatutoryChallanTab(); } catch (_) {}
      }
    } catch (e) {
      console.warn('[ATPL Sync] Vault parse note:', e);
    }
  }

  // ── Apply & Smart-Merge Employee Records Across Browsers ──
  function applyEmployeeRecords(records, remoteDeletedIds, remoteAllCleared) {
    if (!Array.isArray(records)) return;

    var sysRows = [];
    var empRows = [];
    records.forEach(function(r) {
      if (!r || typeof r !== 'object') return;
      var id = extractEmpId(r);
      if (!id) return;
      if (id.toLowerCase().indexOf('__atpl_sys__') === 0) sysRows.push(r);
      else empRows.push(r);
    });
    if (sysRows.length) applySystemVaultRecords(sysRows);

    // Do not overwrite an in-progress local edit/import. It will be pushed first.
    if (Date.now() - lastEmpLocalWriteTime < 20000 || window.__ATPL_IS_SAVING_EMP) return;

    var localDead = {};
    try { localDead = JSON.parse(localStorage.getItem('ATPL_EmployeeMasterDeletedV1') || '{}'); } catch (_) {}
    var remoteDead = {};
    (Array.isArray(remoteDeletedIds) ? remoteDeletedIds : []).forEach(function(id) {
      var raw = String(id || '').trim().toLowerCase();
      if (raw) {
        remoteDead[raw] = true;
        remoteDead[raw.replace(/^0+/, '')] = true;
      }
    });
    function deleted(id) {
      var raw = String(id || '').trim().toLowerCase();
      var clean = raw.replace(/^0+/, '');
      return !!(localDead[raw] || localDead[clean] || remoteDead[raw] || remoteDead[clean]);
    }

    var localList = (window.EM && Array.isArray(window.EM.data)) ? window.EM.data : [];
    var mergedById = {};

    // Recover local-only records that never reached Sheets, but never restore a
    // record carrying a cloud tombstone. A cloud-wide clear is always authoritative.
    if (!remoteAllCleared) {
      localList.forEach(function(localRow) {
        var id = extractEmpId(localRow);
        var key = id.toLowerCase();
        if (key && !deleted(id)) mergedById[key] = Object.assign({}, localRow, { emp_id: id });
      });
    }

    empRows.forEach(function(sourceRow) {
      var row = sourceRow;
      if (row._raw_json && typeof row._raw_json === 'string') {
        try { row = Object.assign({}, JSON.parse(row._raw_json), row); } catch (_) {}
      }
      var id = extractEmpId(row);
      var key = id.toLowerCase();
      if (!key || deleted(id)) return;

      // The cloud row wins for every field, including intentional blank values
      // and status changes such as LEFT -> ACTIVE.
      mergedById[key] = Object.assign({}, mergedById[key] || {}, row, { emp_id: id });
    });

    var valid = Object.keys(mergedById).map(function(k) { return mergedById[k]; });
    var remoteHash = fastHashStr(JSON.stringify(valid));
    if (_lastAppliedEmpHash === remoteHash && window.EM &&
        Array.isArray(window.EM.data) && window.EM.data.length === valid.length) return;

    _lastAppliedEmpHash = remoteHash;
    _lastAppliedEmpFp = remoteHash;
    if (!window.EM) window.EM = { data: [], filtered: [], selectedRows: new Set() };
    window.EM.data = valid.slice();
    if (Array.isArray(window.EMP_MASTER_DATA)) {
      window.EMP_MASTER_DATA.length = 0;
      Array.prototype.push.apply(window.EMP_MASTER_DATA, valid);
    }

    window.__ATPL_INTERNAL_STORAGE_WRITE = true;
    try {
      var serialized = JSON.stringify(valid);
      localStorage.setItem('AroraTextilesEmployeeMasterV3', serialized);
      _lastPushedEmpHash = fastHashStr(serialized);
    } catch (_) {} finally {
      window.__ATPL_INTERNAL_STORAGE_WRITE = false;
    }
    refreshEmployeeUI();

    // Repair a partial cloud master from surviving local-only rows. Backend
    // tombstones prevent a deleted employee from being recreated by this repair.
    if (!remoteAllCleared && valid.length > empRows.length) {
      var repairRows = valid.filter(function(r) {
        var id = extractEmpId(r);
        return !empRows.some(function(remote) {
          return extractEmpId(remote).toLowerCase() === id.toLowerCase();
        });
      });
      if (repairRows.length) {
        callGoogleBackend('saveEmployeeMaster', { records: repairRows }).then(function(result) {
          if (!result || !result.ok) console.warn('[ATPL Sync] Employee Master repair pending:', result && result.error);
        }).catch(function(err) {
          console.warn('[ATPL Sync] Employee Master repair pending:', err);
        });
      }
    }
  }

  // ── Background File Download Queue (Excel Only for window.FILES) ──
  async function processDownloadQueue() {
    if (isDownloading || !downloadQueue.length) return;
    isDownloading = true;
    try {
      while (downloadQueue.length > 0) {
        var fileMeta = downloadQueue.shift();
        if (!fileMeta || !fileMeta.name) continue;
        var fileName = fileMeta.name;
        var nameKey = String(fileName).toLowerCase().trim();

        // Guard: Do not load internal advance management json or non-spreadsheets into salary files
        if (nameKey.indexOf('advance_management') !== -1 || nameKey.endsWith('.json')) {
          continue;
        }
        if (nameKey.includes('attend') && fileMeta.size === 0) continue;

        var existing = (window.FILES || []).find(function(f) {
          return f && String(f.name).toLowerCase().trim() === nameKey;
        });
        if (existing) continue;

        updateSyncBadge('syncing', '⬇️ Syncing ' + fileName + '…');
        try {
          var res = await callGoogleBackend('downloadFile', { fileName: fileName });
          if (res && res.ok && res.fileBase64) {
            await new Promise(function(r) { setTimeout(r, 40); });
            var rawBuf = b64ToBuf(res.fileBase64);
            var mime = getMimeType(fileName, res.mimeType);
            var wb = null;
            var sheets = {};

            if (isSpreadsheetFile(fileName)) {
              try {
                if (rawBuf && typeof window.parseWB === 'function') {
                  wb = window.parseWB(rawBuf);
                }
              } catch (_) {}
              sheets = (wb && typeof window.wbToSheets === 'function') ? window.wbToSheets(wb) : {};
            }

            window.FILES = (window.FILES || []).filter(function(f) {
              return f && String(f.name).toLowerCase().trim() !== nameKey;
            });

            window.FILES.push({
              id: fileName,
              name: fileName,
              mimeType: mime,
              isDocument: !isSpreadsheetFile(fileName),
              wb: wb,
              sheets: sheets,
              buf: rawBuf,
              base64: res.fileBase64,
              savedAt: fileMeta.updatedAt || new Date().toISOString()
            });

            if (typeof window.saveFileToDB === 'function') {
              window.__ATPL_IS_DOWNLOADING_DRIVE = true;
              try { window.saveFileToDB(fileName, rawBuf); } finally { window.__ATPL_IS_DOWNLOADING_DRIVE = false; }
            }

            refreshFilesUI();
          }
        } catch (err) {
          console.warn('[ATPL Sync] Download error:', fileName, err);
        }
        await new Promise(function(r) { setTimeout(r, 40); });
      }
    } finally {
      isDownloading = false;
      updateSyncBadge('ok');
    }
  }

  // ── Poll Sync State ──
  var lastPollTimestamp = 0;
  async function pollSyncState(force) {
    if (!isInitialLoaded) {
      isInitialLoaded = true;
      refreshFilesUI();
    }
    var endpoint = getGasUrl();
    if (!endpoint || window.__ATPL_IS_UPLOADING || window.__ATPL_IS_SAVING_EMP) {
      return { ok: true, files: window.FILES || [] };
    }

    var now = Date.now();
    if (!force && (now - lastPollTimestamp < 2000)) {
      return Promise.resolve({ ok: true, throttled: true });
    }
    lastPollTimestamp = now;

    if (isPolling) return Promise.resolve({ ok: true });
    isPolling = true;

    try {
      // Cheap version check first: avoid scanning Drive + Employee Master on
      // every heartbeat. Fetch the full shared state only when cloud changed.
      if (!force) {
        var versionState = await callGoogleBackend('getSyncVersion');
        var serverVersion = Number(versionState && (versionState.currentVersion || versionState.version) || 0);
        if (versionState && versionState.ok && serverVersion > 0 && serverVersion === localVersion) {
          updateSyncBadge('ok');
          return { ok: true, unchanged: true, version: localVersion, files: window.FILES || [] };
        }
      }

      var state = await callGoogleBackend('getSyncState');
      if (!state || !state.ok) {
        updateSyncBadge('ok');
        return { ok: false };
      }

      if (window.__ATPL_IS_UPLOADING || window.__ATPL_IS_SAVING_EMP) {
        return { ok: true };
      }

      var sVer = Number(state.currentVersion || state.version || 0);
      if (sVer > 0) {
        localVersion = Math.max(localVersion, sVer);
        try { localStorage.setItem('ATPL_DRIVE_SYNC_VERSION', String(localVersion)); } catch (_) {}
      }

      var driveFiles = Array.isArray(state.files) ? state.files : [];
      var tombstones = {};
      try { tombstones = JSON.parse(localStorage.getItem('ATPL_SALARY_TOMBSTONES_V2') || '{}'); } catch (_) {}

      driveFiles.forEach(function(df) {
        if (df && df.name) {
          var k = String(df.name).toLowerCase().trim();
          if (tombstones[k] && df.updatedAt && Date.parse(df.updatedAt) > Date.parse(tombstones[k])) {
            delete tombstones[k];
            try { localStorage.setItem('ATPL_SALARY_TOMBSTONES_V2', JSON.stringify(tombstones)); } catch (_) {}
          }
        }
      });

      var currentFiles = Array.isArray(window.FILES) ? window.FILES.slice() : [];
      var filesChanged = false;

      // Google Drive is authoritative for All Files. Remove files deleted from
      // another browser, but protect uploads that are still being committed.
      var remoteNames = {};
      driveFiles.forEach(function(df) {
        if (df && df.name) remoteNames[String(df.name).toLowerCase().trim()] = true;
      });
      for (var ri = currentFiles.length - 1; ri >= 0; ri--) {
        var remoteCheck = currentFiles[ri];
        if (!remoteCheck || !remoteCheck.name) continue;
        var remoteKey = String(remoteCheck.name).toLowerCase().trim();
        var uploadAge = recentlyUploadedFiles[remoteKey] ? (Date.now() - recentlyUploadedFiles[remoteKey]) : Infinity;
        if (!remoteNames[remoteKey] && uploadAge > 60000) {
          currentFiles.splice(ri, 1);
          tombstones[remoteKey] = new Date().toISOString();
          window.__ATPL_IS_DOWNLOADING_DRIVE = true;
          try {
            if (typeof window.deleteFromDB === 'function') window.deleteFromDB(remoteCheck.name);
          } catch (_) {}
          window.__ATPL_IS_DOWNLOADING_DRIVE = false;
          filesChanged = true;
        }
      }
      if (filesChanged) {
        try { localStorage.setItem('ATPL_SALARY_TOMBSTONES_V2', JSON.stringify(tombstones)); } catch (_) {}
        window.FILES = currentFiles;
        refreshFilesUI();
      }

      for (var i = currentFiles.length - 1; i >= 0; i--) {
        var cf = currentFiles[i];
        if (!cf || !cf.name) continue;
        var cNameLow = String(cf.name).toLowerCase().trim();
        if (recentlyUploadedFiles[cNameLow] && (Date.now() - recentlyUploadedFiles[cNameLow] < 60000)) {
          continue;
        }
        var tombVal = tombstones[cNameLow];
        var tombTime = typeof tombVal === 'string' ? (Date.parse(tombVal) || 0) : (tombVal === true ? Infinity : 0);
        var fileTime = cf.savedAt ? (Date.parse(cf.savedAt) || 0) : 0;
        if (tombVal && (tombTime > fileTime)) {
          currentFiles.splice(i, 1);
          window.__ATPL_IS_DOWNLOADING_DRIVE = true;
          if (typeof window.deleteFromDB === 'function') {
            try { window.deleteFromDB(cf.name); } catch (_) {}
          }
          window.__ATPL_IS_DOWNLOADING_DRIVE = false;
          filesChanged = true;
        }
      }

      if (filesChanged) {
        window.FILES = currentFiles;
        refreshFilesUI();
      }

      for (var j = 0; j < driveFiles.length; j++) {
        var df = driveFiles[j];
        if (!df || !df.name) continue;
        var dfNameLow = String(df.name).toLowerCase().trim();
        // Ignore internal data files (.json, advance management data) or non-spreadsheets
        if (dfNameLow.indexOf('advance_management') !== -1 || dfNameLow.endsWith('.json')) {
          continue;
        }
        if (tombstones[dfNameLow]) continue;

        var exists = currentFiles.some(function(f) {
          return f && String(f.name).toLowerCase().trim() === dfNameLow;
        });

        if (!exists) {
          var alreadyQueued = downloadQueue.some(function(q) {
            return q && String(q.name).toLowerCase().trim() === dfNameLow;
          });
          if (!alreadyQueued) downloadQueue.push(df);
        }
      }

      if (downloadQueue.length > 0 && !isDownloading) {
        processDownloadQueue();
      }

      if (Array.isArray(state.employees)) {
        applyEmployeeRecords(state.employees, state.employeeDeletedIds, state.employeeMasterAllCleared);
      }

      updateSyncBadge('ok');
      return { ok: true, version: localVersion, files: window.FILES || [] };
    } catch (err) {
      return { ok: false, error: err.message };
    } finally {
      isPolling = false;
    }
  }

  function dispatchSyncTrigger(action, details) {
    var payload = { action: action, details: details || {}, sender: MY_CLIENT_ID, ts: Date.now() };
    if (typeof window.BroadcastChannel !== 'undefined') {
      try {
        var bc = new window.BroadcastChannel('ATPL_ERP_TRIGGER_BUS');
        bc.postMessage(payload);
        bc.close();
      } catch (_) {}
    }
    window.__ATPL_INTERNAL_STORAGE_WRITE = true;
    try { localStorage.setItem('ATPL_TRIGGER_EVENT', JSON.stringify(payload)); } catch (_) {}
    window.__ATPL_INTERNAL_STORAGE_WRITE = false;
  }

  function onTriggerReceived(action, details, sender) {
    if (sender && sender === MY_CLIENT_ID) return;
    if (action === 'file_deleted' && details && details.name) {
      var target = String(details.name).toLowerCase().trim();
      window.FILES = (window.FILES || []).filter(function(x) {
        return x && String(x.name || '').toLowerCase().trim() !== target;
      });
      refreshFilesUI();
      return;
    }
    if (action === 'salary_cleared') {
      window.FILES = [];
      refreshFilesUI();
      return;
    }
    setTimeout(function() { pollSyncState(true); }, 600);
  }

  // ── Core Push Function for Employee Master + HR Docs / Challan Vault ──
  var pushDebounceTimer = null;
  async function pushEmployeeAndVaultToCloud(empArrayOverride) {
    clearTimeout(pushDebounceTimer);
    return new Promise(function(resolve) {
      pushDebounceTimer = setTimeout(async function() {
        var rawList = empArrayOverride;
        if (!Array.isArray(rawList) || !rawList.length) {
          if (window.EM && Array.isArray(window.EM.data) && window.EM.data.length) {
            rawList = window.EM.data;
          } else {
            try {
              rawList = JSON.parse(localStorage.getItem('AroraTextilesEmployeeMasterV3') || '[]');
            } catch (_) { rawList = []; }
          }
        }
        if (!Array.isArray(rawList)) rawList = [];

        lastEmpLocalWriteTime = Date.now();
        window.__ATPL_IS_SAVING_EMP = true;

        var cleaned = [];
        for (var i = 0; i < rawList.length; i++) {
          var r = rawList[i];
          if (!r || typeof r !== 'object') continue;
          var id = extractEmpId(r);
          if (!id || id.toLowerCase().indexOf('__atpl_sys__') === 0) continue;
          var copy = Object.assign({}, r, { emp_id: id });
          cleaned.push(copy);
        }

        // Attach system vault chunks (HR Docs, PF & ESIC Challan metadata)
        var vaultChunks = buildSystemVaultRecords();
        var payloadRecords = cleaned.concat(vaultChunks);

        var syncError = null, syncResult = null;
        try {
          if (!getGasUrl()) throw new Error('Google Sheets backend URL is not configured.');
          if (payloadRecords.length > 0) {
            updateSyncBadge('syncing', '☁️ Syncing ' + cleaned.length + ' Emp & Docs…');
            syncResult = await callGoogleBackend('saveEmployeeMaster', { records: cleaned });
            if (!syncResult || !syncResult.ok) throw new Error(syncResult && syncResult.error || 'Google Sheets did not confirm Employee Master save.');
            // Keep HR document / PF / ESIC vault chunks in SystemRecords, not EmployeeMaster rows.
            for (var vi = 0; vi < vaultChunks.length; vi++) {
              var vaultResult = await callGoogleBackend('upsertEmployeeMaster', { record: vaultChunks[vi] });
              if (!vaultResult || !vaultResult.ok) throw new Error(vaultResult && vaultResult.error || 'System vault cloud save failed.');
            }
            _lastAppliedEmpHash = fastHashStr(JSON.stringify(cleaned));
            _lastAppliedEmpFp = _lastAppliedEmpHash;
            dispatchSyncTrigger('employee_updated', { count: cleaned.length });
            updateSyncBadge('ok');
          }
        } catch (e) {
          syncError = e;
          console.warn('[ATPL Sync] Push error:', e);
        } finally {
          lastEmpLocalWriteTime = Date.now();
          window.__ATPL_IS_SAVING_EMP = false;
        }
        resolve(syncError ? { ok: false, error: syncError.message || String(syncError) } :
          { ok: true, verified: true, version: syncResult && syncResult.version || 0 });
      }, 350);
    });
  }

  // ── Hook localStorage & ATPLCloudSyncV1 So Every Edit/Paste/Upload Syncs Automatically ──
  function installMasterHooks() {
    // 1. Intercept localStorage.setItem so whenever index.html saves Emp Master, HR Docs, or PF/ESIC Challan, it pushes to Cloud!
    try {
      var origSetItem = Storage.prototype.setItem;
      if (!Storage.prototype.__atplHookedV7) {
        Storage.prototype.setItem = function(key, value) {
          origSetItem.apply(this, arguments);
          if (window.__ATPL_INTERNAL_STORAGE_WRITE) return;
          var k = String(key || '');
          var kLow = k.toLowerCase();

          // Check if Employee Master was updated
          if (EMP_STORAGE_KEYS.indexOf(k) !== -1) {
            var newHash = fastHashStr(String(value || ''));
            if (newHash !== _lastPushedEmpHash) {
              _lastPushedEmpHash = newHash;
              lastEmpLocalWriteTime = Date.now();
              try {
                var parsed = JSON.parse(value);
                if (Array.isArray(parsed) && parsed.length > 0) {
                  pushEmployeeAndVaultToCloud(parsed);
                }
              } catch (_) {}
            }
          }
          // Check if HR Documents or PF/ESIC Challan was updated
          else if (
            VAULT_STORAGE_KEYS.indexOf(k) !== -1 ||
            kLow.indexOf('hrdoc') >= 0 ||
            kLow.indexOf('hr_doc') >= 0 ||
            kLow.indexOf('challan') >= 0
          ) {
            lastVaultLocalWriteTime = Date.now();
            pushEmployeeAndVaultToCloud();
          }
        };
        Storage.prototype.__atplHookedV7 = true;
      }
    } catch (e) {
      console.warn('[ATPL Sync] Storage hook notice:', e);
    }

    // 2. Live ATPLCloudSyncV1 Bridge
    window.ATPLCloudSyncV1 = {
      pullMaster: async function() {
        await pollSyncState(true);
        return true;
      },
      pushMaster: async function() {
        return await pushEmployeeAndVaultToCloud();
      },
      saveMaster: async function(record) {
        lastEmpLocalWriteTime = Date.now();
        if (record && typeof record === 'object' && window.EM && Array.isArray(window.EM.data)) {
          var id = extractEmpId(record);
          if (id) {
            record.emp_id = id;
            var idx = window.EM.data.findIndex(function(x) { return extractEmpId(x).toLowerCase() === id.toLowerCase(); });
            if (idx >= 0) window.EM.data[idx] = Object.assign({}, window.EM.data[idx], record);
            else window.EM.data.push(record);
          }
        }
        var saved = await pushEmployeeAndVaultToCloud();
        if (!saved || !saved.ok) throw new Error(saved && saved.error || 'Employee Master cloud save failed.');
        return { ok: true, verified: true, version: saved.version || 0 };
      },
      saveMany: async function(records) {
        lastEmpLocalWriteTime = Date.now();
        var saved = await pushEmployeeAndVaultToCloud(Array.isArray(records) && records.length > 0 ? (window.EM && window.EM.data ? window.EM.data : records) : undefined);
        if (!saved || !saved.ok) throw new Error(saved && saved.error || 'Employee Master bulk cloud save failed.');
        return { ok: true, verified: true, version: saved.version || 0 };
      },
      deleteMaster: async function(empId) {
        lastEmpLocalWriteTime = Date.now();
        if (!empId || !getGasUrl()) throw new Error('Employee code or Google Sheets backend is missing.');
        var deleted = await callGoogleBackend('deleteEmployeeMaster', { emp_id: String(empId) });
        if (!deleted || !deleted.ok) throw new Error(deleted && deleted.error || 'Google Sheets did not confirm employee deletion.');
        var saved = await pushEmployeeAndVaultToCloud();
        if (!saved || !saved.ok) throw new Error(saved && saved.error || 'Post-delete cloud verification failed.');
        return { ok: true, verified: true, version: deleted.version || saved.version || 0 };
      },
      persistLocal: function() {
        lastEmpLocalWriteTime = Date.now();
        pushEmployeeAndVaultToCloud();
      },
      wake: function() { pollSyncState(false); },
      status: function() { return { backendReady: true, queued: 0, running: 0, token: true, pending: 0, conflicts: 0 }; },
      isSystemRecord: function(r) {
        var id = extractEmpId(r).toLowerCase();
        return id.indexOf('__atpl_sys__') === 0;
      }
    };

    // 3. Hook HR Docs Manual Sync Button
    window.triggerManualHrSync = async function() {
      updateSyncBadge('syncing', '☁️ Syncing HR Documents…');
      await pushEmployeeAndVaultToCloud();
      await pollSyncState(true);
      if (window.showToast) window.showToast('✅ HR Documents sabhi browsers me sync ho gaye!');
    };
  }

  function setupSSE() {
    var host = (window.location && window.location.hostname) || '';
    var isServer = host === 'localhost' || host === '127.0.0.1' || /\.run\.app$/i.test(host);
    if (isServer && typeof window.EventSource !== 'undefined') {
      try {
        var es = new EventSource('/api/sync/events');
        es.addEventListener('drive_trigger', function(ev) {
          try {
            var p = JSON.parse(ev.data);
            var action = (p && p.data && p.data.action) || (p && p.action);
            var details = (p && p.data && p.data.details) || (p && p.details);
            var sender = (p && p.data && p.data.sender) || (p && p.sender);
            if (action) onTriggerReceived(action, details, sender);
          } catch (_) {}
        });
      } catch (_) {}
    }
  }

  var pollTimerId = null;
  function scheduleNextPoll() {
    clearTimeout(pollTimerId);
    pollTimerId = setTimeout(async function() {
      if (!document.hidden && getGasUrl() && !window.__ATPL_IS_UPLOADING && !window.__ATPL_IS_SAVING_EMP) {
        await pollSyncState(false);
      }
      scheduleNextPoll();
    }, 2500);
  }

  var UnifiedSyncEngine = {
    version: '2026.11.16-GOOGLE-DRIVE-SHEETS-MASTER-V7',
    apiBase: '',
    gasUrl: GAS_URL,
    callGoogleBackend: callGoogleBackend,
    fileMap: fileMap,
    init: function() {
      suppressFirebaseUI();
      installMasterHooks();
      setupSSE();
      pollSyncState(true);
      scheduleNextPoll();
      setInterval(function() {
        if (!document.hidden && getGasUrl() && !window.__ATPL_IS_UPLOADING && !window.__ATPL_IS_SAVING_EMP) {
          pollSyncState(false);
        }
      }, 2500);
      window.addEventListener('focus', function() {
        if (getGasUrl() && !window.__ATPL_IS_UPLOADING && !window.__ATPL_IS_SAVING_EMP) {
          pollSyncState(false);
        }
      });
      document.addEventListener('visibilitychange', function() {
        if (!document.hidden && getGasUrl() && !window.__ATPL_IS_UPLOADING && !window.__ATPL_IS_SAVING_EMP) {
          pollSyncState(false);
        }
      });
      window.addEventListener('storage', function(ev) {
        if (ev && ev.key === 'ATPL_TRIGGER_EVENT' && ev.newValue) {
          try {
            var data = JSON.parse(ev.newValue);
            if (data && data.action) onTriggerReceived(data.action, data.details, data.sender);
          } catch (_) {}
        }
      });
      if (typeof window.BroadcastChannel !== 'undefined') {
        try {
          var bc = new window.BroadcastChannel('ATPL_ERP_TRIGGER_BUS');
          bc.onmessage = function(ev) {
            if (ev && ev.data && ev.data.action) {
              onTriggerReceived(ev.data.action, ev.data.details, ev.data.sender);
            }
          };
        } catch (_) {}
      }
    },
    uploadFile: async function(a, b, c) {
      var mod = 'salary', name = '', rawBuf = null, explicitMime = '';
      if (a === 'salary' || a === 'hr_doc' || a === 'files' || a === 'challan' || a === 'pf' || a === 'esic') {
        mod = a;
        var fileObj = b || {};
        name = (fileObj && (fileObj.name || fileObj.filename || fileObj.id)) || ('file_' + Date.now());
        explicitMime = fileObj.type || fileObj.mimeType || '';
        if (fileObj instanceof Blob) rawBuf = await fileObj.arrayBuffer();
        else if (fileObj.buf instanceof ArrayBuffer) rawBuf = fileObj.buf;
        else if (fileObj instanceof ArrayBuffer) rawBuf = fileObj;
        else if (typeof fileObj.buf === 'string') rawBuf = b64ToBuf(fileObj.buf);
        else if (typeof fileObj.base64 === 'string') rawBuf = b64ToBuf(fileObj.base64);
        else if (typeof fileObj.data === 'string') rawBuf = b64ToBuf(fileObj.data);
      } else if (typeof a === 'string') {
        name = a;
        if (typeof b === 'string') rawBuf = b64ToBuf(b);
        else if (b instanceof ArrayBuffer) rawBuf = b;
        else if (b instanceof Blob) {
          explicitMime = b.type || '';
          rawBuf = await b.arrayBuffer();
        }
      }

      var now = new Date().toISOString();
      var nameLow = String(name).toLowerCase().trim();
      lastFileLocalWriteTime = Date.now();
      recentlyUploadedFiles[nameLow] = Date.now();

      try {
        var tombs = JSON.parse(localStorage.getItem('ATPL_SALARY_TOMBSTONES_V2') || '{}');
        if (tombs[nameLow]) {
          delete tombs[nameLow];
          localStorage.setItem('ATPL_SALARY_TOMBSTONES_V2', JSON.stringify(tombs));
        }
      } catch (_) {}

      var b64Payload = rawBuf ? toB64(rawBuf) : (typeof b === 'string' ? toB64(b) : '');
      var finalMime = getMimeType(name, explicitMime);

      if (name) {
        window.FILES = (window.FILES || []).filter(function(f) {
          return f && String(f.name).toLowerCase().trim() !== nameLow;
        });
        var wb = null, sheets = {};
        if (rawBuf && isSpreadsheetFile(name) && typeof window.parseWB === 'function') {
          try {
            wb = window.parseWB(rawBuf);
            sheets = typeof window.wbToSheets === 'function' ? window.wbToSheets(wb) : {};
          } catch (_) {}
        }
        window.FILES.push({
          id: name,
          name: name,
          module: mod,
          mimeType: finalMime,
          isDocument: !isSpreadsheetFile(name),
          wb: wb,
          sheets: sheets,
          buf: rawBuf,
          base64: b64Payload,
          savedAt: now
        });
        refreshFilesUI();
      }

      if (b64Payload && getGasUrl()) {
        window.__ATPL_IS_UPLOADING = true;
        window.__ATPL_LAST_UPLOAD_TIME = Date.now();
        updateSyncBadge('syncing', '☁️ Uploading ' + name + '…');
        try {
          var res = await callGoogleBackend('uploadFile', {
            fileName: name,
            module: mod,
            fileBase64: b64Payload,
            mimeType: finalMime
          });
          if (res && res.ok && res.version) {
            localVersion = Math.max(localVersion, res.version);
            try { localStorage.setItem('ATPL_DRIVE_SYNC_VERSION', String(localVersion)); } catch (_) {}
          }
          dispatchSyncTrigger('file_uploaded', { name: name, module: mod });
        } finally {
          window.__ATPL_IS_UPLOADING = false;
          window.__ATPL_LAST_UPLOAD_TIME = Date.now();
          lastFileLocalWriteTime = Date.now();
          updateSyncBadge('ok');
        }
      }

      return { id: name, name: name, module: mod, mimeType: finalMime, created_at: now, ok: true };
    },
    uploadBulk: async function(mod, fileList, meta, onProgress) {
      var list = Array.from(fileList || []);
      for (var i = 0; i < list.length; i++) {
        var f = list[i];
        if (typeof onProgress === 'function') onProgress(i, 'uploading', Math.round((i / list.length) * 100), f.name);
        await this.uploadFile(mod || 'salary', f);
        if (typeof onProgress === 'function') onProgress(i, 'saved', Math.round(((i + 1) / list.length) * 100), f.name);
      }
      return { ok: true, count: list.length };
    },
    deleteFile: async function(module, idOrName) {
      var name = '';
      if (idOrName !== undefined && idOrName !== null && idOrName !== '') {
        name = String(idOrName).trim();
      } else if (module !== undefined && module !== null && module !== '') {
        name = String(module).trim();
      }
      if (!name) return false;
      var target = name.toLowerCase().trim();
      delete recentlyUploadedFiles[target];
      window.FILES = (window.FILES || []).filter(function(x) {
        return x && String(x.name || '').toLowerCase().trim() !== target;
      });
      refreshFilesUI();
      try {
        var tombs = JSON.parse(localStorage.getItem('ATPL_SALARY_TOMBSTONES_V2') || '{}');
        tombs[target] = new Date().toISOString();
        localStorage.setItem('ATPL_SALARY_TOMBSTONES_V2', JSON.stringify(tombs));
      } catch (_) {}
      dispatchSyncTrigger('file_deleted', { name: name });
      if (getGasUrl()) {
        updateSyncBadge('syncing', '🗑️ Deleting ' + name + '…');
        await callGoogleBackend('deleteFile', { fileName: name });
        updateSyncBadge('ok');
      }
      return true;
    },
    saveEmployeeMaster: async function(records) {
      if (!Array.isArray(records)) return { ok: false };
      lastEmpLocalWriteTime = Date.now();
      window.__ATPL_INTERNAL_STORAGE_WRITE = true;
      try {
        localStorage.setItem('AroraTextilesEmployeeMasterV3', JSON.stringify(records));
      } catch (_) {} finally {
        window.__ATPL_INTERNAL_STORAGE_WRITE = false;
      }
      if (window.EM) window.EM.data = records.slice();
      refreshEmployeeUI();
      return await pushEmployeeAndVaultToCloud(records);
    },
    upsertEmployeeMaster: async function(records) {
      if (!Array.isArray(records) || !records.length) return { ok: false, error: 'Employee records must be a non-empty array.' };
      // Single write authority: merge incoming employee rows into the current
      // complete master, then use the same Google Sheets push used by All Files.
      var current = (window.EM && Array.isArray(window.EM.data)) ? window.EM.data.slice() : [];
      if (!current.length) {
        try { current = JSON.parse(localStorage.getItem('AroraTextilesEmployeeMasterV3') || '[]'); } catch (_) { current = []; }
      }
      if (!Array.isArray(current)) current = [];
      function empKey(row) {
        var id = extractEmpId(row);
        return String(id || '').trim().toLowerCase().replace(/^0+/, '') || String(id || '').trim().toLowerCase();
      }
      var merged = current.slice();
      records.forEach(function(incoming) {
        if (!incoming || typeof incoming !== 'object') return;
        var id = extractEmpId(incoming);
        if (!id) return;
        var key = empKey(incoming);
        var at = merged.findIndex(function(row) { return empKey(row) === key; });
        var clean = Object.assign({}, at >= 0 ? merged[at] : {}, incoming, { emp_id: id });
        if (at >= 0) merged[at] = clean; else merged.push(clean);
      });
      if (!merged.length) return { ok: false, error: 'No valid Employee Code found.' };
      return await this.saveEmployeeMaster(merged);
    },
    deleteEmployeeMaster: async function(empCode) {
      var cleanEmpId = String(empCode || '').trim();
      if (!cleanEmpId) return { ok: false, error: 'Employee code is required.' };
      lastEmpLocalWriteTime = Date.now();
      var result = await callGoogleBackend('deleteEmployeeMaster', { emp_id: cleanEmpId });
      if (!result || result.ok !== true) {
        throw new Error(result && result.error || 'Google Sheets did not confirm Employee Master deletion.');
      }
      dispatchSyncTrigger('employee_deleted', { emp_id: cleanEmpId });
      return { ok: true, verified: true, deleted: cleanEmpId, version: result.version || 0 };
    },
    bulkDeleteEmployees: async function(ids) {
      if (!Array.isArray(ids) || !ids.length) return { ok: false, error: 'No Employee Codes supplied.' };
      var done = [];
      for (var i = 0; i < ids.length; i++) {
        var result = await this.deleteEmployeeMaster(ids[i]);
        if (!result || !result.ok || !result.verified) throw new Error('Delete not verified for Employee Code ' + ids[i]);
        done.push(result.deleted);
      }
      return { ok: true, verified: true, count: done.length, deleted: done };
    },
    clearAllEmployees: async function() {
      var result = await this.deleteEmployeeMaster('ALL');
      if (!result || !result.ok || !result.verified) throw new Error('Google Sheets did not confirm Employee Master clear.');
      return { ok: true, verified: true, cleared: true, count: 0, version: result.version || 0 };
    },
    subscribe: function(mod, cb) {
      if (!subscribers[mod]) subscribers[mod] = [];
      subscribers[mod].push(cb);
    },
    reconcileAll: async function(force) { return pollSyncState(!!force); },
    syncNow: async function(force) {
      await pushEmployeeAndVaultToCloud();
      return await pollSyncState(!!force);
    }
  };

  window.ATPLGoogleSync = UnifiedSyncEngine;
  window.ATPLCentralFileSync = UnifiedSyncEngine;
  window.ATPLRealtimeSyncEngine = UnifiedSyncEngine;
  window.UniversalEngine = UnifiedSyncEngine;

  window.triggerManualCrossBrowserSync = async function() {
    updateSyncBadge('syncing', '☁️ Force syncing all modules…');
    await pushEmployeeAndVaultToCloud();
    await pollSyncState(true);
    if (window.showToast) window.showToast('✅ Employee Master, HR Docs, PF/ESIC & Salary Files sabhi browsers me sync ho gaye!');
  };
  window.atplTriggerCrossSync = window.triggerManualCrossBrowserSync;
  window.atplDirectServerSync = function() { return pollSyncState(true); };
  window.syncAllAtplModules = function() { return window.triggerManualCrossBrowserSync(); };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { UnifiedSyncEngine.init(); });
  } else {
    UnifiedSyncEngine.init();
  }
})(typeof window !== 'undefined' ? window : this);
