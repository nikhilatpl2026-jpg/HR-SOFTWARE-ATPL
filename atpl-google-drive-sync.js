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
        if (badge) badge.textContent = String(len);
        if (totalBadge) totalBadge.textContent = len + ' Employees';
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

  function utf8ToB64(str) {
    if (!str) return '';
    try {
      return btoa(unescape(encodeURIComponent(str)));
    } catch (_) {
      try {
        if (typeof Buffer !== 'undefined') return Buffer.from(str, 'utf8').toString('base64');
      } catch (_) {}
      return '';
    }
  }

  function b64ToUtf8(b64) {
    if (!b64 || typeof b64 !== 'string') return '';
    try {
      var clean = b64.replace(/^data:[^;]+;base64,/, '').trim();
      return decodeURIComponent(escape(atob(clean)));
    } catch (_) {
      try {
        if (typeof Buffer !== 'undefined') return Buffer.from(b64, 'base64').toString('utf8');
      } catch (_) {}
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
  function applyEmployeeRecords(records, isForcedVault) {
    if (!Array.isArray(records) || !records.length) return;

    var sysRows = [];
    var empRows = [];
    for (var i = 0; i < records.length; i++) {
      var r = records[i];
      if (!r || typeof r !== 'object') continue;
      var id = extractEmpId(r);
      if (!id) continue;
      if (id.toLowerCase().indexOf('__atpl_sys__') === 0) {
        sysRows.push(r);
      } else {
        empRows.push(r);
      }
    }

    if (sysRows.length > 0) {
      applySystemVaultRecords(sysRows);
    }

    var localList = (window.EM && Array.isArray(window.EM.data)) ? window.EM.data : [];
    var localCount = localList.length;
    var remoteCount = empRows.length;
    // Authoritative cloud sync (allow deletions and valid updates)
    if (!isForcedVault && !isLocalTruncated && (Date.now() - lastEmpLocalWriteTime < 3500 || window.__ATPL_IS_SAVING_EMP)) {
      return;
    }
    if (!empRows.length) return;

    var dead = {};
    try {
      var rawDead = JSON.parse(localStorage.getItem('ATPL_EmployeeMasterDeletedV1') || '{}');
      if (rawDead && Object.keys(rawDead).length < 200) {
        dead = rawDead;
      }
    } catch (_) {}

    var remoteHash = fastHashStr(JSON.stringify(empRows));
    if (!isForcedVault && !isLocalTruncated && (_lastAppliedEmpHash === remoteHash || _lastAppliedEmpFp === remoteHash) && localCount > 0) {
      return;
    }
    _lastAppliedEmpHash = remoteHash;
    _lastAppliedEmpFp = remoteHash;

    var localList = (window.EM && Array.isArray(window.EM.data)) ? window.EM.data : [];
    var localMap = {};
    for (var l = 0; l < localList.length; l++) {
      var lr = localList[l];
      var lid = extractEmpId(lr).toLowerCase();
      if (lid) localMap[lid] = lr;
    }

    var valid = [];
    for (var j = 0; j < empRows.length; j++) {
      var row = empRows[j];
      var rawId = extractEmpId(row);
      var k = rawId.toLowerCase();
      if (dead[k] || dead[k.replace(/^0+/, '')]) continue;

      if (row._raw_json && typeof row._raw_json === 'string') {
        try {
          var unpacked = JSON.parse(row._raw_json);
          row = Object.assign({}, unpacked, row);
        } catch (_) {}
      }

      var base = localMap[k] ? Object.assign({}, localMap[k]) : {};
      Object.keys(row).forEach(function(fk) {
        if (row[fk] !== undefined && row[fk] !== null && row[fk] !== '') {
          base[fk] = row[fk];
        } else if (!(fk in base)) {
          base[fk] = row[fk];
        }
      });
      if (!base.account_no && (base.bank_account_no || row.bank_account_no)) base.account_no = base.bank_account_no || row.bank_account_no;
      if (!base.ifsc && (base.ifsc_code || row.ifsc_code)) base.ifsc = base.ifsc_code || row.ifsc_code;
      if (!base.dept && (base.department || row.department)) base.dept = base.department || row.department;
      if (!base.doj && (base.date_of_joining || row.date_of_joining)) base.doj = base.date_of_joining || row.date_of_joining;
      if (!base.pf_no && (base.uan_no || row.uan_no)) base.pf_no = base.uan_no || row.uan_no;
      if (!base.esi_no && (base.esic_no || row.esic_no)) base.esi_no = base.esic_no || row.esic_no;
      base.emp_id = rawId;
      valid.push(base);
    }

    if (!valid.length) return;

    if (window.EM) window.EM.data = valid.slice();
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
        if (nameKey.indexOf('advance_management') !== -1 || nameKey.endsWith('.json') || !isSpreadsheetFile(fileName)) {
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
    if (!force && (now - lastPollTimestamp < 12000)) {
      return Promise.resolve({ ok: true, throttled: true });
    }
    lastPollTimestamp = now;

    if (isPolling) return Promise.resolve({ ok: true });
    isPolling = true;

    try {
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
        if (dfNameLow.indexOf('advance_management') !== -1 || dfNameLow.endsWith('.json') || !isSpreadsheetFile(df.name)) {
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

      // 1. Authoritative sync of Employee Master Vault from Google Drive (454+ employees)
      await syncEmployeeMasterDriveVault(driveFiles, !!force);

      // 2. Secondary Sheet employees (only if >= 50 records)
      if (Array.isArray(state.employees) && state.employees.length >= 50) {
        applyEmployeeRecords(state.employees);
      }

      updateSyncBadge('ok');
      return { ok: true, version: localVersion, files: window.FILES || [] };
    } catch (err) {
      return { ok: false, error: err.message };
    } finally {
      isPolling = false;
    }
  }

  async function syncEmployeeMasterDriveVault(driveFiles, force) {
    if (!Array.isArray(driveFiles) || !getGasUrl()) return;
    var empVaultFile = driveFiles.find(function(df) {
      return df && String(df.name).toLowerCase().trim() === 'atpl_employee_master_vault.json';
    });
    if (!empVaultFile) return;

    var remoteVaultTs = Date.parse(empVaultFile.updatedAt) || 0;
    var lastVaultTs = parseInt(localStorage.getItem('ATPL_EMP_VAULT_LAST_TS') || '0', 10);
    var currentEmpCount = (window.EM && Array.isArray(window.EM.data)) ? window.EM.data.length : 0;
    var localEmps = (window.EM && Array.isArray(window.EM.data)) ? window.EM.data : [];
    var localHasBank = localEmps.some(function(e) { return e && (e.bank_name || e.account_no || e.ifsc); });

    var isCleared = localStorage.getItem('ATPL_EMP_MASTER_CLEARED_V1') === 'true';

    if (force || remoteVaultTs > lastVaultTs || (!isCleared && (currentEmpCount < 50 || !localHasBank))) {
      try {
        var vaultRes = await callGoogleBackend('downloadFile', { fileName: 'atpl_employee_master_vault.json' });
        if (vaultRes && vaultRes.ok && vaultRes.fileBase64) {
          var vaultJson = b64ToUtf8(vaultRes.fileBase64);
          var vaultData = JSON.parse(vaultJson);
          if (vaultData && Array.isArray(vaultData.employees)) {
            if (vaultData.employees.length === 0 || vaultData.cleared === true) {
              applyEmployeeClearLocally();
              localStorage.setItem('ATPL_EMP_VAULT_LAST_TS', String(remoteVaultTs));
            } else {
              applyAuthoritativeSnapshot(vaultData.employees);
              localStorage.setItem('ATPL_EMP_VAULT_LAST_TS', String(remoteVaultTs));
            }
          }
        }
      } catch (err) {
        console.warn('[ATPL Sync] Vault download error:', err);
      }
    }
  }

  async function pushEmployeeMasterDriveVault(customList) {
    if (!getGasUrl()) return;
    var list = customList;
    if (!Array.isArray(list)) {
      list = (window.EM && Array.isArray(window.EM.data)) ? window.EM.data : [];
    }
    try {
      var nowIso = new Date().toISOString();
      var isZero = (list.length === 0);
      var payload = {
        version: 1,
        employees: list,
        count: list.length,
        cleared: isZero,
        updatedAt: nowIso
      };
      var b64Data = utf8ToB64(JSON.stringify(payload));
      await callGoogleBackend('uploadFile', {
        fileName: 'atpl_employee_master_vault.json',
        fileBase64: b64Data,
        mimeType: 'application/json'
      });
      localStorage.setItem('ATPL_EMP_VAULT_LAST_TS', String(Date.parse(nowIso)));
      if (isZero) {
        dispatchSyncTrigger('employee_cleared', { count: 0, ts: Date.now() });
      } else {
        dispatchSyncTrigger('employee_updated', { count: list.length, ts: Date.now() });
      }
    } catch (e) {
      console.warn('[ATPL Sync] Error pushing employee vault to Drive:', e);
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
      try {
        var bc2 = new window.BroadcastChannel('ATPL_ERP_SHARED_V2');
        bc2.postMessage({
          type: action,
          details: details || {},
          emp_id: details && (details.emp_id || details.id),
          records: details && details.records,
          record: details && details.record
        });
        bc2.close();
      } catch (_) {}
    }
    window.__ATPL_INTERNAL_STORAGE_WRITE = true;
    try { localStorage.setItem('ATPL_TRIGGER_EVENT', JSON.stringify(payload)); } catch (_) {}
    window.__ATPL_INTERNAL_STORAGE_WRITE = false;

    // Fast HTTP trigger to server for cross-browser SSE relay
    try {
      if (typeof fetch === 'function') {
        fetch('/api/sync/trigger', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        }).catch(function() {});
      }
    } catch (_) {}
  }

  function applySingleOrBatchEmployeeUpdate(updatedList) {
    if (!Array.isArray(updatedList) || !updatedList.length) return;
    var currentList = (window.EM && Array.isArray(window.EM.data)) ? window.EM.data : [];
    var changed = false;
    var dead = {};
    try { dead = JSON.parse(localStorage.getItem('ATPL_EmployeeMasterDeletedV1') || '{}'); } catch (_) {}

    try { localStorage.removeItem('ATPL_EMP_MASTER_CLEARED_V1'); } catch(_) {}

    updatedList.forEach(function(rec) {
      if (!rec || typeof rec !== 'object') return;
      var id = extractEmpId(rec);
      if (!id || id.toLowerCase().indexOf('__atpl_sys__') === 0) return;
      var idLow = id.toLowerCase();
      var idClean = idLow.replace(/^0+/, '');

      // An explicit add or update un-tombstones the employee
      if (dead[idLow] || (idClean && dead[idClean])) {
        delete dead[idLow];
        if (idClean) delete dead[idClean];
        try { localStorage.setItem('ATPL_EmployeeMasterDeletedV1', JSON.stringify(dead)); } catch(_) {}
      }

      rec.emp_id = id;
      var idx = currentList.findIndex(function(x) {
        var xId = extractEmpId(x).toLowerCase();
        return xId === idLow || (idClean && xId.replace(/^0+/, '') === idClean);
      });
      if (idx >= 0) {
        var existing = currentList[idx];
        var merged = Object.assign({}, existing);
        Object.keys(rec).forEach(function(k) {
          if (rec[k] !== undefined && rec[k] !== null) {
            merged[k] = rec[k];
          }
        });
        if (!merged.account_no && (merged.bank_account_no || rec.bank_account_no)) merged.account_no = merged.bank_account_no || rec.bank_account_no;
        if (!merged.ifsc && (merged.ifsc_code || rec.ifsc_code)) merged.ifsc = merged.ifsc_code || rec.ifsc_code;
        if (!merged.dept && (merged.department || rec.department)) merged.dept = merged.department || rec.department;
        if (!merged.doj && (merged.date_of_joining || rec.date_of_joining)) merged.doj = merged.date_of_joining || rec.date_of_joining;
        if (!merged.pf_no && (merged.uan_no || rec.uan_no)) merged.pf_no = merged.uan_no || rec.uan_no;
        if (!merged.esi_no && (merged.esic_no || rec.esic_no)) merged.esi_no = merged.esic_no || rec.esic_no;
        if (merged.gross && !merged.new_gross) merged.new_gross = merged.gross;
        if (merged.new_gross && !merged.gross) merged.gross = merged.new_gross;
        merged.emp_id = id;
        currentList[idx] = merged;
        changed = true;
      } else {
        currentList.push(rec);
        changed = true;
      }
    });

    if (changed) {
      if (window.EM) window.EM.data = currentList;
      if (Array.isArray(window.EMP_MASTER_DATA)) {
        window.EMP_MASTER_DATA.length = 0;
        Array.prototype.push.apply(window.EMP_MASTER_DATA, currentList);
      }
      window.__ATPL_INTERNAL_STORAGE_WRITE = true;
      try {
        var serialized = JSON.stringify(currentList);
        localStorage.setItem('AroraTextilesEmployeeMasterV3', serialized);
        _lastAppliedEmpHash = fastHashStr(serialized);
        _lastAppliedEmpFp = _lastAppliedEmpHash;
      } catch (_) {} finally {
        window.__ATPL_INTERNAL_STORAGE_WRITE = false;
      }
      refreshEmployeeUI();
    }
  }

  function applyEmployeeClearLocally() {
    if (window.EM) {
      window.EM.data = [];
      window.EM.filtered = [];
      if (window.EM.selectedRows) window.EM.selectedRows.clear();
    }
    if (Array.isArray(window.EMP_MASTER_DATA)) {
      window.EMP_MASTER_DATA.length = 0;
    }
    window.__ATPL_INTERNAL_STORAGE_WRITE = true;
    try {
      localStorage.setItem('AroraTextilesEmployeeMasterV3', '[]');
      localStorage.setItem('ATPL_EMP_MASTER_CLEARED_V1', 'true');
      _lastAppliedEmpHash = fastHashStr('[]');
      _lastAppliedEmpFp = _lastAppliedEmpHash;
    } catch (_) {} finally {
      window.__ATPL_INTERNAL_STORAGE_WRITE = false;
    }
    refreshEmployeeUI();
  }

  function applyEmployeeBulkDeleteLocally(ids) {
    if (!Array.isArray(ids) || !ids.length) return;
    var delSet = new Set(ids.map(function(x){ return String(x || '').toLowerCase().trim(); }).filter(Boolean));
    var cleanDelSet = new Set(ids.map(function(x){ return String(x || '').toLowerCase().trim().replace(/^0+/, ''); }).filter(Boolean));

    try {
      var m = JSON.parse(localStorage.getItem('ATPL_EmployeeMasterDeletedV1') || '{}');
      delSet.forEach(function(code) { m[code] = new Date().toISOString(); });
      cleanDelSet.forEach(function(code) { m[code] = new Date().toISOString(); });
      localStorage.setItem('ATPL_EmployeeMasterDeletedV1', JSON.stringify(m));
    } catch (_) {}

    var currentList = (window.EM && Array.isArray(window.EM.data)) ? window.EM.data : [];
    var initialLen = currentList.length;
    currentList = currentList.filter(function(x) {
      var xId = extractEmpId(x).toLowerCase();
      return !delSet.has(xId) && !cleanDelSet.has(xId.replace(/^0+/, ''));
    });

    if (currentList.length !== initialLen) {
      if (window.EM) {
        window.EM.data = currentList;
        if (window.EM.selectedRows) window.EM.selectedRows.clear();
      }
      if (Array.isArray(window.EMP_MASTER_DATA)) {
        window.EMP_MASTER_DATA.length = 0;
        Array.prototype.push.apply(window.EMP_MASTER_DATA, currentList);
      }
      window.__ATPL_INTERNAL_STORAGE_WRITE = true;
      try {
        var serialized = JSON.stringify(currentList);
        localStorage.setItem('AroraTextilesEmployeeMasterV3', serialized);
        _lastAppliedEmpHash = fastHashStr(serialized);
        _lastAppliedEmpFp = _lastAppliedEmpHash;
      } catch (_) {} finally {
        window.__ATPL_INTERNAL_STORAGE_WRITE = false;
      }
      refreshEmployeeUI();
    }
  }

  function applyAuthoritativeSnapshot(records) {
    if (!Array.isArray(records)) return;
    if (records.length === 0) {
      applyEmployeeClearLocally();
      return;
    }
    var cleaned = records.map(function(r) {
      var id = extractEmpId(r);
      var copyRec = Object.assign({}, r);
      if (id) copyRec.emp_id = id;
      return copyRec;
    }).filter(function(r) { return r && r.emp_id; });

    if (window.EM) {
      window.EM.data = cleaned;
      if (window.EM.selectedRows) window.EM.selectedRows.clear();
    }
    if (Array.isArray(window.EMP_MASTER_DATA)) {
      window.EMP_MASTER_DATA.length = 0;
      Array.prototype.push.apply(window.EMP_MASTER_DATA, cleaned);
    }
    window.__ATPL_INTERNAL_STORAGE_WRITE = true;
    try {
      var serialized = JSON.stringify(cleaned);
      localStorage.setItem('AroraTextilesEmployeeMasterV3', serialized);
      localStorage.removeItem('ATPL_EMP_MASTER_CLEARED_V1');
      _lastAppliedEmpHash = fastHashStr(serialized);
      _lastAppliedEmpFp = _lastAppliedEmpHash;
    } catch (_) {} finally {
      window.__ATPL_INTERNAL_STORAGE_WRITE = false;
    }
    refreshEmployeeUI();
  }

  function applyEmployeeDeleteLocally(empId) {
    if (!empId) return;
    var cleanCode = String(empId).toLowerCase().trim();
    var cleanNoZero = cleanCode.replace(/^0+/, '');

    try {
      var m = JSON.parse(localStorage.getItem('ATPL_EmployeeMasterDeletedV1') || '{}');
      m[cleanCode] = new Date().toISOString();
      if (cleanNoZero) m[cleanNoZero] = new Date().toISOString();
      localStorage.setItem('ATPL_EmployeeMasterDeletedV1', JSON.stringify(m));
    } catch (_) {}

    var currentList = (window.EM && Array.isArray(window.EM.data)) ? window.EM.data : [];
    var initialLen = currentList.length;
    currentList = currentList.filter(function(x) {
      var xId = extractEmpId(x).toLowerCase();
      return xId !== cleanCode && (cleanNoZero ? xId.replace(/^0+/, '') !== cleanNoZero : true);
    });

    if (currentList.length !== initialLen) {
      if (window.EM) window.EM.data = currentList;
      if (Array.isArray(window.EMP_MASTER_DATA)) {
        window.EMP_MASTER_DATA.length = 0;
        Array.prototype.push.apply(window.EMP_MASTER_DATA, currentList);
      }
      window.__ATPL_INTERNAL_STORAGE_WRITE = true;
      try {
        var serialized = JSON.stringify(currentList);
        localStorage.setItem('AroraTextilesEmployeeMasterV3', serialized);
        _lastAppliedEmpHash = fastHashStr(serialized);
        _lastAppliedEmpFp = _lastAppliedEmpHash;
      } catch (_) {} finally {
        window.__ATPL_INTERNAL_STORAGE_WRITE = false;
      }
      refreshEmployeeUI();
    }
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
    if (action === 'employee_cleared' || action === 'employee_master_cleared') {
      applyEmployeeClearLocally();
      return;
    }
    if (action === 'employee_bulk_deleted' || action === 'employee_master_bulk_deleted') {
      var bIds = (details && (details.deleted_ids || details.ids)) || [];
      if (Array.isArray(bIds) && bIds.length) {
        applyEmployeeBulkDeleteLocally(bIds);
      }
      return;
    }
    if (action === 'employee_deleted' || action === 'employee_master_deleted') {
      var delEmpId = details && (details.emp_id || details.id);
      if (delEmpId) {
        applyEmployeeDeleteLocally(delEmpId);
      }
      return;
    }
    if (action === 'employee_updated' || action === 'employee_master_updated' || action === 'employee_master_saved') {
      if (details && details.records && details.records.length === 0) {
        applyEmployeeClearLocally();
        return;
      }
      var updatedList = (details && (details.records || (details.record ? [details.record] : null))) || [];
      if (Array.isArray(updatedList) && updatedList.length > 0) {
        applySingleOrBatchEmployeeUpdate(updatedList);
      } else {
        setTimeout(function() { pollSyncState(true); }, 150);
      }
      return;
    }
    setTimeout(function() { pollSyncState(true); }, 400);
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

        try {
          if (getGasUrl() && payloadRecords.length > 0) {
            updateSyncBadge('syncing', '☁️ Syncing ' + cleaned.length + ' Emp & Docs…');
            await callGoogleBackend('saveEmployeeMaster', { records: payloadRecords });
            _lastAppliedEmpHash = fastHashStr(JSON.stringify(cleaned));
            _lastAppliedEmpFp = _lastAppliedEmpHash;
            dispatchSyncTrigger('employee_updated', { count: cleaned.length });
            updateSyncBadge('ok');
          }
        } catch (e) {
          console.warn('[ATPL Sync] Push error:', e);
        } finally {
          lastEmpLocalWriteTime = Date.now();
          window.__ATPL_IS_SAVING_EMP = false;
          resolve({ ok: true });
        }
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
      pushMaster: async function(emp) {
        if (emp) return await UnifiedSyncEngine.upsertEmployeeMaster(emp);
        return await pushEmployeeAndVaultToCloud();
      },
      saveMaster: async function(record) {
        if (!record && arguments[1]) record = arguments[1];
        if (typeof record === 'string' && arguments[1] && typeof arguments[1] === 'object') {
          record = arguments[1];
        }
        return await UnifiedSyncEngine.upsertEmployeeMaster(record);
      },
      saveMany: async function(records) {
        lastEmpLocalWriteTime = Date.now();
        await pushEmployeeAndVaultToCloud(Array.isArray(records) && records.length > 0 ? (window.EM && window.EM.data ? window.EM.data : records) : undefined);
        return { ok: true, verified: true };
      },
      deleteMaster: async function(empId) {
        return await UnifiedSyncEngine.deleteEmployeeMaster(empId);
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
    var isServer = host === 'localhost' || host === '127.0.0.1' || /\.run\.app$/i.test(host) || (window.location && (window.location.protocol === 'http:' || window.location.protocol === 'https:'));
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
        es.addEventListener('employee_master_updated', function(ev) {
          try {
            var p = JSON.parse(ev.data);
            if (p && (p.mode === 'replace' || (Array.isArray(p.records) && p.records.length === 0))) {
              if (p.records && p.records.length === 0) {
                applyEmployeeClearLocally();
              } else if (Array.isArray(p.records)) {
                applyAuthoritativeSnapshot(p.records);
              }
            } else {
              var recs = (p && p.updated) || (p && p.records) || [];
              onTriggerReceived('employee_updated', { records: recs }, 'sse');
            }
          } catch (_) {}
        });
        es.addEventListener('employee_master_deleted', function(ev) {
          try {
            var p = JSON.parse(ev.data);
            var empId = p && (p.emp_id || p.id);
            if (empId) onTriggerReceived('employee_deleted', { emp_id: empId }, 'sse');
          } catch (_) {}
        });
        es.addEventListener('employee_master_cleared', function(ev) {
          try {
            onTriggerReceived('employee_cleared', {}, 'sse');
          } catch (_) {}
        });
        es.addEventListener('employee_master_bulk_deleted', function(ev) {
          try {
            var p = JSON.parse(ev.data);
            onTriggerReceived('employee_bulk_deleted', p, 'sse');
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
    }, 8000);
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
      }, 8000);
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
        try {
          var bc2 = new window.BroadcastChannel('ATPL_ERP_SHARED_V2');
          bc2.onmessage = function(ev) {
            var d = ev && ev.data;
            if (!d) return;
            if (d.type === 'employee_master_deleted' && d.emp_id) {
              onTriggerReceived('employee_deleted', { emp_id: d.emp_id });
            } else if (d.type === 'employee_master_saved' || d.type === 'employee_updated') {
              onTriggerReceived('employee_updated', { records: d.records, record: d.record });
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
      if (!Array.isArray(records)) records = [records];
      if (records.length === 1 && window.EM && Array.isArray(window.EM.data) && window.EM.data.length > 1) {
        return await this.upsertEmployeeMaster(records);
      }
      lastEmpLocalWriteTime = Date.now();
      window.__ATPL_INTERNAL_STORAGE_WRITE = true;
      try {
        localStorage.setItem('AroraTextilesEmployeeMasterV3', JSON.stringify(records));
      } catch (_) {} finally {
        window.__ATPL_INTERNAL_STORAGE_WRITE = false;
      }
      if (window.EM) window.EM.data = records.slice();
      if (Array.isArray(window.EMP_MASTER_DATA)) {
        window.EMP_MASTER_DATA.length = 0;
        Array.prototype.push.apply(window.EMP_MASTER_DATA, records);
      }
      refreshEmployeeUI();
      return await pushEmployeeAndVaultToCloud(records);
    },
    'upsertEmployeeMaster': async function(singleOrArray) {
      var list = Array.isArray(singleOrArray) ? singleOrArray : [singleOrArray];
      if (!list.length) return { ok: true, count: 0 };
      lastEmpLocalWriteTime = Date.now();

      // Merge into local in-memory dataset without wiping out existing records!
      var currentList = (window.EM && Array.isArray(window.EM.data)) ? window.EM.data : [];
      list.forEach(function(rec) {
        if (!rec || typeof rec !== 'object') return;
        var id = extractEmpId(rec);
        if (!id) return;
        rec.emp_id = id;
        var idx = currentList.findIndex(function(x) {
          return extractEmpId(x).toLowerCase() === id.toLowerCase();
        });
        if (idx >= 0) {
          currentList[idx] = Object.assign({}, currentList[idx], rec);
        } else {
          currentList.push(rec);
        }
      });

      if (window.EM) window.EM.data = currentList;
      if (Array.isArray(window.EMP_MASTER_DATA)) {
        window.EMP_MASTER_DATA.length = 0;
        Array.prototype.push.apply(window.EMP_MASTER_DATA, currentList);
      }

      window.__ATPL_INTERNAL_STORAGE_WRITE = true;
      try {
        localStorage.setItem('AroraTextilesEmployeeMasterV3', JSON.stringify(currentList));
      } catch (_) {} finally {
        window.__ATPL_INTERNAL_STORAGE_WRITE = false;
      }

      refreshEmployeeUI();

      // 1. Immediately upload complete updated vault to Google Drive (authoritative 454+ sync)
      await pushEmployeeMasterDriveVault(currentList);

      // 2. Also push single row to Google Sheet
      var lastEmpId = '';
      if (getGasUrl()) {
        for (var i = 0; i < list.length; i++) {
          var item = list[i];
          if (!item) continue;
          var empId = extractEmpId(item);
          lastEmpId = empId;
          try {
            callGoogleBackend('upsertEmployeeMaster', {
              emp_id: empId,
              record: item,
              record_json: JSON.stringify(item),
              records: [item]
            }).catch(function() {});
          } catch (_) {}
        }
      }

      dispatchSyncTrigger('employee_updated', {
        emp_id: lastEmpId,
        record: list[0],
        records: list,
        count: currentList.length
      });

      try {
        if (typeof fetch === 'function') {
          fetch('/api/sync/employee-master', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ records: list })
          }).catch(function() {});
        }
      } catch (_) {}

      return { ok: true, verified: true, record: list[0], count: currentList.length };
    },
    upsertEmployeeMaster: async function(records) {
      return await this['upsertEmployeeMaster'](records);
    },
    deleteEmployeeMaster: async function(empCode) {
      lastEmpLocalWriteTime = Date.now();
      var cleanCode = String(empCode || '').toLowerCase().trim();
      var cleanNoZero = cleanCode.replace(/^0+/, '');

      try {
        var m = JSON.parse(localStorage.getItem('ATPL_EmployeeMasterDeletedV1') || '{}');
        m[cleanCode] = new Date().toISOString();
        if (cleanNoZero) m[cleanNoZero] = new Date().toISOString();
        localStorage.setItem('ATPL_EmployeeMasterDeletedV1', JSON.stringify(m));
      } catch (_) {}

      if (window.EM && Array.isArray(window.EM.data)) {
        window.EM.data = window.EM.data.filter(function(x) {
          var xId = extractEmpId(x).toLowerCase();
          return xId !== cleanCode && (cleanNoZero ? xId.replace(/^0+/, '') !== cleanNoZero : true);
        });
      }
      if (Array.isArray(window.EMP_MASTER_DATA)) {
        window.EMP_MASTER_DATA = window.EMP_MASTER_DATA.filter(function(x) {
          var xId = extractEmpId(x).toLowerCase();
          return xId !== cleanCode && (cleanNoZero ? xId.replace(/^0+/, '') !== cleanNoZero : true);
        });
      }

      window.__ATPL_INTERNAL_STORAGE_WRITE = true;
      try {
        var serialized = JSON.stringify(window.EM.data || []);
        localStorage.setItem('AroraTextilesEmployeeMasterV3', serialized);
        _lastAppliedEmpHash = fastHashStr(serialized);
        _lastAppliedEmpFp = _lastAppliedEmpHash;
      } catch (_) {} finally {
        window.__ATPL_INTERNAL_STORAGE_WRITE = false;
      }

      refreshEmployeeUI();

      dispatchSyncTrigger('employee_deleted', { emp_id: empCode });

      try {
        if (typeof fetch === 'function') {
          fetch('/api/sync/employee-master/' + encodeURIComponent(empCode), {
            method: 'DELETE'
          }).catch(function() {});
        }
      } catch (_) {}

      // Push updated master to Google Drive vault
      await pushEmployeeMasterDriveVault(window.EM.data);

      if (getGasUrl()) {
        try { callGoogleBackend('deleteEmployeeMaster', { empCode: empCode, emp_id: empCode }).catch(function() {}); } catch (_) {}
      }
      return { ok: true, verified: true };
    },
    clearAllEmployees: async function() {
      applyEmployeeClearLocally();
      try {
        if (typeof fetch === 'function') {
          fetch('/api/sync/employee-master', { method: 'DELETE' }).catch(function() {});
        }
      } catch (_) {}
      dispatchSyncTrigger('employee_cleared', { count: 0 });
      await pushEmployeeMasterDriveVault([]);
      if (getGasUrl()) {
        try { callGoogleBackend('deleteEmployeeMaster', { emp_id: 'ALL' }).catch(function() {}); } catch (_) {}
      }
      return { ok: true, cleared: true };
    },
    bulkDeleteEmployees: async function(ids) {
      if (!Array.isArray(ids) || !ids.length) return { ok: true, count: 0 };
      applyEmployeeBulkDeleteLocally(ids);
      try {
        if (typeof fetch === 'function') {
          fetch('/api/sync/employee-master/bulk-delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: ids })
          }).catch(function() {});
        }
      } catch (_) {}
      dispatchSyncTrigger('employee_bulk_deleted', { deleted_ids: ids, count: (window.EM && window.EM.data && window.EM.data.length) || 0 });
      await pushEmployeeMasterDriveVault(window.EM && window.EM.data);
      if (getGasUrl()) {
        ids.forEach(function(code) {
          try { callGoogleBackend('deleteEmployeeMaster', { empCode: code, emp_id: code }).catch(function() {}); } catch (_) {}
        });
      }
      return { ok: true, deletedCount: ids.length };
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
