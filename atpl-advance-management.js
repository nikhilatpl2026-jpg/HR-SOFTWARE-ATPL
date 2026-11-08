/**
 * ATPL ADVANCE MANAGEMENT & AUTOMATIC SALARY DEDUCTION ENGINE (V1.0 - ENTERPRISE)
 * Dedicated full-screen HR ERP module for Arora Textiles Private Limited.
 * Features:
 *  - Employee Master Code auto-lookup & instant name/dept mapping
 *  - Multi-advance tracking per employee with total outstanding balance calculation
 *  - Automated salary sheet reconciliation & advance deduction upon upload
 *  - Strict guards: Never deduct > balance, never deduct same advance twice (idempotent)
 *  - Cross-browser real-time synchronization (SSE, BroadcastChannel, localStorage, Google Drive/Sheets bridge)
 */
(function(window) {
  'use strict';

  var STORAGE_KEY_ADVANCES = 'ATPL_AdvanceRecordsV2';
  var STORAGE_KEY_DEDUCTIONS = 'ATPL_AdvanceDeductionsV2';
  var STORAGE_KEY_TOMBSTONES = 'ATPL_AdvanceTombstonesV2';
  var CLOUD_FILENAME = 'ATPL_ADVANCE_MANAGEMENT_DATA.json';
  var CHANNEL_NAME = 'ATPL_ERP_TRIGGER_BUS';
  var DEFAULT_GAS_URL = 'https://script.google.com/macros/s/AKfycbxiaKVtVJUWqDPtI-9iecG0LE817SfbbQNfUaZouw8sgYr3f1zRffutMu_UGnV-vqy-oA/exec';

  var state = {
    advances: [],
    deductions: [],
    tombstones: {},
    activeTab: 'advances', // 'advances' | 'deductions' | 'ledger'
    searchQuery: '',
    statusFilter: 'ALL', // 'ALL' | 'ACTIVE' | 'PARTIAL' | 'REPAID'
    isSyncing: false,
    selectedAdvanceForModal: null,
    editingAdvanceId: null
  };

  // Helper: Format currency in INR
  function formatINR(val) {
    var n = Number(val) || 0;
    return '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  }

  // Helper: Normalize employee code
  function normalizeCode(code) {
    if (code == null) return '';
    return String(code).trim().toLowerCase().replace(/^0+/, '');
  }

  // Helper: Safe HTML escape
  function esc(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ── 1. EMPLOYEE MASTER LOOKUP ──
  function getMasterEmployees() {
    try {
      if (window.EM && Array.isArray(window.EM.data) && window.EM.data.length > 0) {
        return window.EM.data;
      }
    } catch (_) {}
    try {
      if (Array.isArray(window.EMP_MASTER_DATA) && window.EMP_MASTER_DATA.length > 0) {
        return window.EMP_MASTER_DATA;
      }
    } catch (_) {}
    try {
      var saved = JSON.parse(localStorage.getItem('AroraTextilesEmployeeMasterV3') || '[]');
      if (Array.isArray(saved) && saved.length > 0) return saved;
    } catch (_) {}
    return [];
  }

  function findEmployeeByCode(code) {
    if (!code) return null;
    var norm = normalizeCode(code);
    var emList = getMasterEmployees();
    for (var i = 0; i < emList.length; i++) {
      var e = emList[i];
      if (!e) continue;
      var eCode = normalizeCode(e.emp_id || e.code || e.emp_code || e.id);
      if (eCode === norm) {
        return {
          code: String(e.emp_id || e.code || e.emp_code || code).trim(),
          name: String(e.name || e.emp_name || '').trim(),
          dept: String(e.dept || e.department || '').trim(),
          desig: String(e.desig || e.designation || '').trim(),
          gross: Number(e.gross || e.basic || 0)
        };
      }
    }
    return null;
  }

  // ── 2. LOCAL PERSISTENCE & IN-MEMORY CACHE ──
  function loadFromLocal() {
    try {
      var rawAdv = localStorage.getItem(STORAGE_KEY_ADVANCES);
      if (rawAdv) state.advances = JSON.parse(rawAdv) || [];
    } catch (_) {
      state.advances = [];
    }
    try {
      var rawDed = localStorage.getItem(STORAGE_KEY_DEDUCTIONS);
      if (rawDed) state.deductions = JSON.parse(rawDed) || [];
    } catch (_) {
      state.deductions = [];
    }
    try {
      var rawTombs = localStorage.getItem(STORAGE_KEY_TOMBSTONES);
      if (rawTombs) state.tombstones = JSON.parse(rawTombs) || {};
    } catch (_) {
      state.tombstones = {};
    }
    // Purge tombstoned advances
    if (state.tombstones && Object.keys(state.tombstones).length > 0) {
      state.advances = (state.advances || []).filter(function(a) {
        return a && a.id && !state.tombstones[a.id];
      });
    }
    recalculateAllBalances();
  }

  function saveToLocal() {
    try {
      localStorage.setItem(STORAGE_KEY_ADVANCES, JSON.stringify(state.advances));
      localStorage.setItem(STORAGE_KEY_DEDUCTIONS, JSON.stringify(state.deductions));
      localStorage.setItem(STORAGE_KEY_TOMBSTONES, JSON.stringify(state.tombstones));
    } catch (_) {}
  }

  // Recalculates recovered and remaining balance for each advance
  function recalculateAllBalances() {
    var deductionMap = {};
    (state.deductions || []).forEach(function(d) {
      if (!d || !d.advanceId) return;
      deductionMap[d.advanceId] = (deductionMap[d.advanceId] || 0) + (Number(d.deductedAmount) || 0);
    });

    (state.advances || []).forEach(function(adv) {
      if (!adv) return;
      var totalDeducted = deductionMap[adv.id] || 0;
      adv.recoveredAmount = totalDeducted;
      adv.balanceAmount = Math.max(0, (Number(adv.amount) || 0) - totalDeducted);
      if (adv.balanceAmount <= 0) {
        adv.status = 'REPAID';
      } else if (adv.recoveredAmount > 0) {
        adv.status = 'PARTIAL';
      } else {
        adv.status = 'ACTIVE';
      }
    });
  }

  // ── 3. CLOUD & REAL-TIME SYNCHRONIZATION ──
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

  async function callGoogleBackend(action, params) {
    if (window.ATPLGoogleSync && typeof window.ATPLGoogleSync.callGoogleBackend === 'function') {
      try {
        var syncRes = await window.ATPLGoogleSync.callGoogleBackend(action, params);
        if (syncRes != null) return syncRes;
      } catch (_) {}
    }
    var endpoint = getGasUrl();
    if (!endpoint) return null;
    var p = Object.assign({ action: action, sender: 'adv_client_' + Date.now(), _ts: Date.now() }, params || {});
    var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timeoutId = controller ? setTimeout(function() { controller.abort(); }, 12000) : null;
    try {
      var res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(p),
        signal: controller ? controller.signal : undefined
      });
      if (timeoutId) clearTimeout(timeoutId);
      if (res.ok) {
        return await res.json();
      }
    } catch (err) {
      if (timeoutId) clearTimeout(timeoutId);
      console.warn('[ATPL Advance Sync] Network notice (' + action + '):', err.message);
    }
    return null;
  }

  var B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';

  function utf8ToB64(str) {
    if (typeof Buffer !== 'undefined') {
      try { return Buffer.from(str, 'utf8').toString('base64'); } catch (_) {}
    }
    if (typeof btoa !== 'undefined') {
      try { return btoa(unescape(encodeURIComponent(str))); } catch (_) {}
    }
    var utf8Bytes = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 128) utf8Bytes.push(c);
      else if (c < 2048) {
        utf8Bytes.push(192 | (c >> 6), 128 | (c & 63));
      } else if (c < 65536) {
        utf8Bytes.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63));
      } else {
        utf8Bytes.push(240 | (c >> 18), 128 | ((c >> 12) & 63), 128 | ((c >> 6) & 63), 128 | (c & 63));
      }
    }
    var res = '';
    for (var j = 0; j < utf8Bytes.length; j += 3) {
      var b1 = utf8Bytes[j];
      var b2 = j + 1 < utf8Bytes.length ? utf8Bytes[j + 1] : NaN;
      var b3 = j + 2 < utf8Bytes.length ? utf8Bytes[j + 2] : NaN;
      res += B64_CHARS.charAt(b1 >> 2);
      res += B64_CHARS.charAt(((b1 & 3) << 4) | (isNaN(b2) ? 0 : (b2 >> 4)));
      res += isNaN(b2) ? '=' : B64_CHARS.charAt(((b2 & 15) << 2) | (isNaN(b3) ? 0 : (b3 >> 6)));
      res += isNaN(b3) ? '=' : B64_CHARS.charAt(b3 & 63);
    }
    return res;
  }

  function b64ToUtf8(b64) {
    if (!b64 || typeof b64 !== 'string') return '';
    var clean = b64.replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, '');
    if (typeof Buffer !== 'undefined') {
      try { return Buffer.from(clean, 'base64').toString('utf8'); } catch (_) {}
    }
    if (typeof atob !== 'undefined') {
      try { return decodeURIComponent(escape(atob(clean))); } catch (_) {}
    }
    var bytes = [];
    for (var i = 0; i < clean.length; i += 4) {
      var enc1 = B64_CHARS.indexOf(clean.charAt(i));
      var enc2 = B64_CHARS.indexOf(clean.charAt(i + 1));
      var enc3 = clean.charAt(i + 2) === '=' ? -1 : B64_CHARS.indexOf(clean.charAt(i + 2));
      var enc4 = clean.charAt(i + 3) === '=' ? -1 : B64_CHARS.indexOf(clean.charAt(i + 3));
      bytes.push((enc1 << 2) | (enc2 >> 4));
      if (enc3 !== -1) bytes.push(((enc2 & 15) << 4) | (enc3 >> 2));
      if (enc4 !== -1) bytes.push(((enc3 & 3) << 6) | enc4);
    }
    var out = '', k = 0;
    while (k < bytes.length) {
      var c1 = bytes[k++];
      if (c1 < 128) out += String.fromCharCode(c1);
      else if (c1 > 191 && c1 < 224) {
        var c2 = bytes[k++];
        out += String.fromCharCode(((c1 & 31) << 6) | (c2 & 63));
      } else {
        var c2b = bytes[k++];
        var c3b = bytes[k++];
        out += String.fromCharCode(((c1 & 15) << 12) | ((c2b & 63) << 6) | (c3b & 63));
      }
    }
    return out;
  }

  function applyCloudData(cloudData) {
    if (!cloudData || typeof cloudData !== 'object') return false;
    var remoteAdvances = Array.isArray(cloudData.advances) ? cloudData.advances : [];
    var remoteDeductions = Array.isArray(cloudData.deductions) ? cloudData.deductions : [];
    var remoteTombstones = cloudData.tombstones && typeof cloudData.tombstones === 'object' ? cloudData.tombstones : {};

    // 1. Merge tombstones
    Object.keys(remoteTombstones).forEach(function(k) {
      if (remoteTombstones[k]) state.tombstones[k] = remoteTombstones[k];
    });

    // 2. Remove tombstoned advances from local state
    state.advances = (state.advances || []).filter(function(a) {
      return a && a.id && !state.tombstones[a.id];
    });

    // 3. Merge advances
    var advMap = {};
    (state.advances || []).forEach(function(a) {
      if (a && a.id) advMap[a.id] = a;
    });

    remoteAdvances.forEach(function(ra) {
      if (!ra || !ra.id || state.tombstones[ra.id]) return;
      var existing = advMap[ra.id];
      if (!existing) {
        advMap[ra.id] = ra;
      } else {
        var localTs = Date.parse(existing.updatedAt || existing.createdAt || 0) || 0;
        var remoteTs = Date.parse(ra.updatedAt || ra.createdAt || 0) || 0;
        if (remoteTs >= localTs) {
          advMap[ra.id] = ra;
        }
      }
    });

    state.advances = Object.values(advMap);

    // 4. Merge deductions (idempotent set by deduction ID or composite)
    var dedMap = {};
    (state.deductions || []).forEach(function(d) {
      if (d && d.id) dedMap[d.id] = d;
    });

    remoteDeductions.forEach(function(rd) {
      if (!rd || !rd.id) return;
      if (!dedMap[rd.id]) {
        dedMap[rd.id] = rd;
      }
    });

    state.deductions = Object.values(dedMap);
    return true;
  }

  var activePushPromise = null;
  function pushAuthoritativeToCloud() {
    if (activePushPromise) return activePushPromise;
    activePushPromise = (async function() {
      try {
        var nowIso = new Date().toISOString();
        var payload = {
          version: 2,
          advances: state.advances || [],
          deductions: state.deductions || [],
          tombstones: state.tombstones || {},
          updatedAt: nowIso
        };
        var b64Data = utf8ToB64(JSON.stringify(payload));
        
        var res = await callGoogleBackend('uploadFile', {
          fileName: CLOUD_FILENAME,
          fileBase64: b64Data,
          mimeType: 'application/json'
        });

        var confirmed = !!(res && res.ok);

        // Local node server bridge
        try {
          fetch('/api/sync/advances/bulk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ records: state.advances || [] })
          }).catch(function() {});
        } catch (_) {}

        broadcastSync('advance_cloud_synced', { ts: Date.now(), count: (state.advances || []).length });
        return { ok: confirmed, error: confirmed ? null : 'CLOUD_UNCONFIRMED' };
      } catch (err) {
        return { ok: false, error: err.message };
      } finally {
        activePushPromise = null;
      }
    })();
    return activePushPromise;
  }

  var activeFetchPromise = null;
  var lastCloudFetchTime = 0;
  function fetchRemoteAdvances(force, isManual) {
    var now = Date.now();
    if (!force && (now - lastCloudFetchTime < 10000)) {
      return Promise.resolve({ ok: true, throttled: true });
    }
    if (activeFetchPromise) return activeFetchPromise;

    activeFetchPromise = (async function() {
      var cloudLoaded = false;
      try {
        // 1. Authoritative Cloud Fetch from Google Drive / Sheets
        var dlRes = await callGoogleBackend('downloadFile', { fileName: CLOUD_FILENAME });
        if (dlRes && dlRes.ok && dlRes.fileBase64) {
          try {
            var jsonStr = b64ToUtf8(dlRes.fileBase64);
            var cloudData = JSON.parse(jsonStr);
            if (cloudData && (Array.isArray(cloudData.advances) || Array.isArray(cloudData.deductions))) {
              applyCloudData(cloudData);
              cloudLoaded = true;
              lastCloudFetchTime = Date.now();
            }
          } catch (pErr) {
            console.warn('[ATPL Advance Sync] Parse error:', pErr.message);
          }
        }

        // 2. Node server fallback if running
        try {
          var res = await fetch('/api/sync/advances', { cache: 'no-store' });
          if (res && res.ok) {
            var data = await res.json();
            if (data && data.ok && Array.isArray(data.records) && data.records.length > 0) {
              applyCloudData({ advances: data.records, deductions: [] });
              cloudLoaded = true;
            }
          }
        } catch (_) {}

        try {
          var resDed = await fetch('/api/sync/advance-deductions', { cache: 'no-store' });
          if (resDed && resDed.ok) {
            var dataDed = await resDed.json();
            if (dataDed && dataDed.ok && Array.isArray(dataDed.records) && dataDed.records.length > 0) {
              applyCloudData({ advances: [], deductions: dataDed.records });
            }
          }
        } catch (_) {}

        // Keep window.FILES clean of the advance data json if it was loaded by All Files
        if (Array.isArray(window.FILES)) {
          var hasAdvInFiles = false;
          window.FILES = window.FILES.filter(function(f) {
            if (f && String(f.name).toLowerCase().trim() === CLOUD_FILENAME.toLowerCase()) {
              hasAdvInFiles = true;
              return false;
            }
            return true;
          });
          if (hasAdvInFiles && typeof window.renderFiles === 'function') {
            try { window.renderFiles(); } catch (_) {}
          }
        }

        recalculateAllBalances();
        saveToLocal();
        renderUI();
        return { ok: cloudLoaded, manual: !!isManual };
      } catch (err) {
        return { ok: false, error: err.message };
      } finally {
        activeFetchPromise = null;
      }
    })();

    return activeFetchPromise;
  }

  async function pushAdvanceRemote(record) {
    try {
      fetch('/api/sync/advance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(record)
      }).catch(function() {});
    } catch (_) {}

    var res = await pushAuthoritativeToCloud();
    broadcastSync('advance_updated', { id: record.id });
    return res;
  }

  async function deleteAdvanceRemote(id) {
    try {
      fetch('/api/sync/advance/' + encodeURIComponent(id), {
        method: 'DELETE'
      }).catch(function() {});
    } catch (_) {}

    var res = await pushAuthoritativeToCloud();
    broadcastSync('advance_deleted', { id: id });
    return res;
  }

  async function pushDeductionRemote(deduction) {
    try {
      fetch('/api/sync/advance-deduction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(deduction)
      }).catch(function() {});
    } catch (_) {}

    var res = await pushAuthoritativeToCloud();
    broadcastSync('advance_deduction_saved', { id: deduction.id });
    return res;
  }

  function broadcastSync(action, details) {
    var payload = { action: action, details: details || {}, ts: Date.now() };
    if (typeof window.BroadcastChannel !== 'undefined') {
      try {
        var bc = new window.BroadcastChannel(CHANNEL_NAME);
        bc.postMessage(payload);
        bc.close();
      } catch (_) {}
    }
    try {
      localStorage.setItem('ATPL_TRIGGER_EVENT', JSON.stringify(payload));
    } catch (_) {}
  }

  function setupRealtimeListeners() {
    if (typeof window.BroadcastChannel !== 'undefined') {
      try {
        var bc = new window.BroadcastChannel(CHANNEL_NAME);
        bc.onmessage = function(ev) {
          if (ev && ev.data && ev.data.action && ev.data.action.indexOf('advance') === 0) {
            fetchRemoteAdvances(false);
          }
        };
      } catch (_) {}
    }

    window.addEventListener('storage', function(e) {
      if (e.key === 'ATPL_TRIGGER_EVENT' && e.newValue) {
        try {
          var ev = JSON.parse(e.newValue);
          if (ev && ev.action && ev.action.indexOf('advance') === 0) {
            fetchRemoteAdvances(false);
          }
        } catch (_) {}
      }
    });

    // Window focus & tab visibility change listener
    window.addEventListener('focus', function() {
      fetchRemoteAdvances(false);
    });
    document.addEventListener('visibilitychange', function() {
      if (!document.hidden) {
        fetchRemoteAdvances(false);
      }
    });

    // Safe 25-second background polling timer (never freezes or piles up)
    if (typeof setInterval === 'function') {
      setInterval(function() {
        if (!document.hidden) {
          fetchRemoteAdvances(false);
        }
      }, 25000);
    }

    // Server-Sent Events hook
    if (typeof window.EventSource !== 'undefined') {
      try {
        var evtSrc = new window.EventSource('/api/sync/events');
        evtSrc.addEventListener('advance_saved', function() { fetchRemoteAdvances(false); });
        evtSrc.addEventListener('advance_deleted', function() { fetchRemoteAdvances(false); });
        evtSrc.addEventListener('advance_deduction_saved', function() { fetchRemoteAdvances(false); });
        evtSrc.addEventListener('advances_updated', function() { fetchRemoteAdvances(false); });
      } catch (_) {}
    }
  }

  // ── 4. ADVANCE RECORD MANAGEMENT ──
  function addOrUpdateAdvance(payload) {
    var emp = findEmployeeByCode(payload.empCode);
    var empName = payload.empName || (emp ? emp.name : 'Unknown');
    var amount = Number(payload.amount);
    if (!payload.empCode || !amount || amount <= 0) {
      if (window.showToast) window.showToast('⚠️ Please enter a valid Employee Code and positive Advance Amount.');
      return false;
    }

    var now = new Date().toISOString();
    var recordId = payload.id || ('adv_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7));
    var existingIdx = state.advances.findIndex(function(a) { return a.id === recordId; });

    var existing = existingIdx >= 0 ? state.advances[existingIdx] : null;
    var recovered = existing ? (Number(existing.recoveredAmount) || 0) : 0;
    var balance = Math.max(0, amount - recovered);
    var status = balance <= 0 ? 'REPAID' : (recovered > 0 ? 'PARTIAL' : 'ACTIVE');

    var rec = {
      id: recordId,
      empCode: String(payload.empCode).trim(),
      empName: empName,
      advanceDate: payload.advanceDate || now.slice(0, 10),
      amount: amount,
      recoveredAmount: recovered,
      balanceAmount: balance,
      monthlyCap: Number(payload.monthlyCap) || 0,
      remarks: payload.remarks || '',
      status: status,
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now,
      deductions: existing && Array.isArray(existing.deductions) ? existing.deductions : []
    };

    if (existingIdx >= 0) {
      state.advances[existingIdx] = rec;
    } else {
      state.advances.unshift(rec);
    }

    // Un-tombstone if re-adding
    if (state.tombstones && state.tombstones[recordId]) {
      delete state.tombstones[recordId];
    }

    saveToLocal();
    renderUI();

    pushAdvanceRemote(rec).then(function(res) {
      if (res && res.ok) {
        if (window.showToast) {
          window.showToast('✅ Advance of ' + formatINR(amount) + ' for ' + empName + ' (' + rec.empCode + ') recorded & synced to cloud!');
        }
      } else {
        if (window.showToast) {
          window.showToast('⚠️ Advance of ' + formatINR(amount) + ' saved locally. Cloud sync pending retry.');
        }
      }
    });

    return true;
  }

  function deleteAdvance(id) {
    if (!id) return;
    var idx = state.advances.findIndex(function(a) { return a.id === id; });
    if (idx < 0) return;
    var deleted = state.advances.splice(idx, 1)[0];

    // Record tombstone
    state.tombstones[id] = new Date().toISOString();

    // Remove associated deductions
    state.deductions = state.deductions.filter(function(d) { return d.advanceId !== id; });

    saveToLocal();
    renderUI();

    deleteAdvanceRemote(id).then(function(res) {
      if (res && res.ok) {
        if (window.showToast) {
          window.showToast('🗑 Advance record deleted from cloud & all devices.');
        }
      } else {
        if (window.showToast) {
          window.showToast('⚠️ Advance deleted locally. Cloud sync pending retry.');
        }
      }
    });
  }

  // Calculate employee total outstanding balance
  function getEmployeeOutstandingBalance(empCode) {
    var norm = normalizeCode(empCode);
    var total = 0;
    (state.advances || []).forEach(function(adv) {
      if (normalizeCode(adv.empCode) === norm) {
        total += (Number(adv.balanceAmount) || 0);
      }
    });
    return total;
  }

  // ── 5. AUTOMATIC SALARY DEDUCTION ENGINE ──
  /**
   * Scans an uploaded or loaded salary file.
   * Matches employee codes with active advances and automatically deducts up to the outstanding balance.
   * Ensures idempotency: never deducts the same file twice.
   */
  function processSalaryFile(fileObj) {
    if (!fileObj || !fileObj.name) return { processed: 0, deductions: [] };
    var fileName = String(fileObj.name);

    // Collect sheet rows
    var sheetData = null;
    if (fileObj.sheets && typeof fileObj.sheets === 'object') {
      var keys = Object.keys(fileObj.sheets);
      for (var k = 0; k < keys.length; k++) {
        var sRows = fileObj.sheets[keys[k]];
        if (Array.isArray(sRows) && sRows.length > 1) {
          sheetData = sRows;
          break;
        }
      }
    }

    if (!sheetData && fileObj.wb && fileObj.wb.SheetNames && fileObj.wb.Sheets) {
      try {
        var firstSheetName = fileObj.wb.SheetNames[0];
        if (window.XLSX && typeof window.XLSX.utils.sheet_to_json === 'function') {
          sheetData = window.XLSX.utils.sheet_to_json(fileObj.wb.Sheets[firstSheetName], { header: 1, defval: '' });
        }
      } catch (_) {}
    }

    if (!Array.isArray(sheetData) || sheetData.length < 2) {
      return { processed: 0, deductions: [] };
    }

    // Detect header row
    var hdrIdx = 0;
    if (typeof window.findUniversalHeaderRow === 'function') {
      hdrIdx = window.findUniversalHeaderRow(sheetData);
    }
    var hdr = sheetData[hdrIdx] || [];
    if (!Array.isArray(hdr)) return { processed: 0, deductions: [] };

    // Column detection
    var colMap = { empCode: -1, empName: -1, netPay: -1, gross: -1 };
    if (typeof window.universalDetectSalaryCols === 'function') {
      var detected = window.universalDetectSalaryCols(hdr, sheetData.slice(hdrIdx + 1, hdrIdx + 10));
      if (detected) {
        colMap.empCode = detected.empCode;
        colMap.empName = detected.empName;
        colMap.netPay = detected.netPayment >= 0 ? detected.netPayment : detected.netEarning;
        colMap.gross = detected.gross;
      }
    }

    // Fallback column detector if universalDetectSalaryCols didn't find empCode
    if (colMap.empCode < 0) {
      for (var c = 0; c < hdr.length; c++) {
        var colStr = String(hdr[c] || '').toLowerCase().trim();
        if (colMap.empCode < 0 && (colStr.includes('emp') || colStr.includes('code') || colStr.includes('token') || colStr.includes('id') || colStr.includes('badli'))) {
          colMap.empCode = c;
        }
        if (colMap.empName < 0 && (colStr.includes('name') || colStr.includes('karamchari'))) {
          colMap.empName = c;
        }
        if (colMap.netPay < 0 && (colStr.includes('net') || colStr.includes('payable') || colStr.includes('paid'))) {
          colMap.netPay = c;
        }
      }
    }

    if (colMap.empCode < 0) return { processed: 0, deductions: [] };

    // Determine salary month from file name (e.g. "Salary_March_2026.xlsx" -> "March 2026")
    var salaryMonth = detectSalaryMonthFromFilename(fileName);

    var deductionsMade = [];
    var nowIso = new Date().toISOString();

    // Iterate through sheet employee rows
    for (var r = hdrIdx + 1; r < sheetData.length; r++) {
      var row = sheetData[r];
      if (!Array.isArray(row) || !row.length) continue;

      var rawCode = row[colMap.empCode];
      if (rawCode == null || String(rawCode).trim() === '') continue;
      var cleanCode = String(rawCode).trim();
      var normCode = normalizeCode(cleanCode);
      if (!normCode || normCode === 'total' || normCode === 'grand') continue;

      var empRowName = colMap.empName >= 0 ? String(row[colMap.empName] || '').trim() : '';
      var netPay = colMap.netPay >= 0 ? (parseFloat(String(row[colMap.netPay]).replace(/[^0-9.-]/g, '')) || 0) : 0;

      // Find active advances for this employee (FIFO order by advance date)
      var activeAdvances = (state.advances || []).filter(function(adv) {
        return normalizeCode(adv.empCode) === normCode && (Number(adv.balanceAmount) || 0) > 0;
      }).sort(function(a, b) {
        return (Date.parse(a.advanceDate || a.createdAt || 0) || 0) - (Date.parse(b.advanceDate || b.createdAt || 0) || 0);
      });

      if (!activeAdvances.length) continue;

      for (var aIdx = 0; aIdx < activeAdvances.length; aIdx++) {
        var adv = activeAdvances[aIdx];
        var outBal = Number(adv.balanceAmount) || 0;
        if (outBal <= 0) continue;

        // Idempotency check: has this advance already been deducted for this specific file or salary month?
        var cleanFileName = String(fileName).trim().toLowerCase();
        var alreadyDeducted = (state.deductions || []).some(function(d) {
          var dFile = String(d.fileName || '').trim().toLowerCase();
          return d.advanceId === adv.id && (dFile === cleanFileName || (salaryMonth && d.salaryMonth === salaryMonth && dFile === cleanFileName));
        });
        if (alreadyDeducted) {
          continue; // "Never deduct the same advance twice"
        }

        // Determine deductible amount
        var maxInst = adv.monthlyCap > 0 ? Number(adv.monthlyCap) : outBal;
        var deductible = Math.min(outBal, maxInst);

        // If net salary is positive and less than deductible, cap to net salary
        if (netPay > 0 && deductible > netPay) {
          deductible = netPay;
        }

        // Strictly never deduct more than outstanding balance
        deductible = Math.min(deductible, outBal);
        if (deductible <= 0) continue;

        var dedRec = {
          id: 'ded_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
          advanceId: adv.id,
          empCode: adv.empCode,
          empName: adv.empName || empRowName || ('Emp ' + cleanCode),
          fileName: fileName,
          salaryMonth: salaryMonth,
          previousBalance: outBal,
          deductedAmount: deductible,
          remainingBalance: outBal - deductible,
          date: nowIso
        };

        state.deductions.push(dedRec);
        deductionsMade.push(dedRec);

        // Update advance balance
        adv.recoveredAmount = (Number(adv.recoveredAmount) || 0) + deductible;
        adv.balanceAmount = Math.max(0, (Number(adv.amount) || 0) - adv.recoveredAmount);
        adv.status = adv.balanceAmount <= 0 ? 'REPAID' : 'PARTIAL';
        adv.updatedAt = nowIso;
        if (!Array.isArray(adv.deductions)) adv.deductions = [];
        adv.deductions.push(dedRec);
      }
    }

    if (deductionsMade.length > 0) {
      saveToLocal();
      recalculateAllBalances();
      renderUI();
      pushAuthoritativeToCloud();
      if (window.showToast) {
        window.showToast('💰 Automatically deducted advances for ' + deductionsMade.length + ' employee(s) from ' + fileName);
      }
    }

    // Attach summary onto the file object for the All Files section
    fileObj.__advanceDeductionSummary = {
      count: deductionsMade.length,
      totalDeducted: deductionsMade.reduce(function(sum, d) { return sum + d.deductedAmount; }, 0),
      deductions: deductionsMade
    };

    return {
      processed: deductionsMade.length,
      deductions: deductionsMade
    };
  }

  function detectSalaryMonthFromFilename(fileName) {
    var fn = String(fileName || '').toLowerCase();
    var months = [
      'january', 'february', 'march', 'april', 'may', 'june',
      'july', 'august', 'september', 'october', 'november', 'december'
    ];
    var shortMonths = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

    var foundMonth = '';
    for (var i = 0; i < months.length; i++) {
      if (fn.includes(months[i])) {
        foundMonth = months[i].charAt(0).toUpperCase() + months[i].slice(1);
        break;
      }
      if (fn.includes(shortMonths[i])) {
        foundMonth = months[i].charAt(0).toUpperCase() + months[i].slice(1);
        break;
      }
    }

    var yearMatch = fn.match(/202[0-9]/);
    var year = yearMatch ? yearMatch[0] : new Date().getFullYear();

    if (foundMonth) {
      return foundMonth + ' ' + year;
    }
    return 'Salary Period (' + fileName + ')';
  }

  function processAllSalaryFiles() {
    var files = Array.isArray(window.FILES) ? window.FILES : [];
    var totalProcessed = 0;
    files.forEach(function(f) {
      if (!f) return;
      var res = processSalaryFile(f);
      totalProcessed += res.processed;
    });
    return totalProcessed;
  }

  // ── 6. UI RENDERING ──
  function renderUI() {
    var container = document.getElementById('advanceModuleContainer');
    if (!container) return;

    // Calculate totals
    var totalDisbursed = 0;
    var totalRecovered = 0;
    var totalOutstanding = 0;
    var activeCount = 0;
    var empMap = {};

    (state.advances || []).forEach(function(a) {
      if (!a) return;
      var amt = Number(a.amount) || 0;
      var rec = Number(a.recoveredAmount) || 0;
      var bal = Number(a.balanceAmount) || 0;
      totalDisbursed += amt;
      totalRecovered += rec;
      totalOutstanding += bal;
      if (bal > 0) activeCount++;

      var k = normalizeCode(a.empCode);
      if (!empMap[k]) {
        empMap[k] = {
          code: a.empCode,
          name: a.empName,
          totalAdv: 0,
          totalRec: 0,
          totalBal: 0,
          count: 0
        };
      }
      empMap[k].totalAdv += amt;
      empMap[k].totalRec += rec;
      empMap[k].totalBal += bal;
      empMap[k].count++;
    });

    var badge = document.getElementById('advBadge');
    if (badge) {
      badge.textContent = activeCount;
      badge.style.display = activeCount > 0 ? 'inline-block' : 'none';
    }

    var html = '';

    // Header & Actions
    html += '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:16px;margin-bottom:20px">';
    html += '  <div>';
    html += '    <h1 style="font-size:24px;font-weight:800;color:#f8fafc;margin:0;display:flex;align-items:center;gap:10px">';
    html += '      <span>💳</span> Advance Management &amp; Salary Deduction Hub';
    html += '      <span style="font-size:11px;font-weight:700;padding:4px 10px;border-radius:20px;background:#10b981;color:#fff">LIVE CLOUD</span>';
    html += '    </h1>';
    html += '    <p style="margin:4px 0 0;font-size:13px;color:#94a3b8">';
    html += '      Track employee advances, outstanding balances, and automated salary deductions from monthly sheets.';
    html += '    </p>';
    html += '  </div>';

    html += '  <div style="display:flex;gap:10px;flex-wrap:wrap">';
    html += '    <button onclick="ATPLAdvanceManager.openNewModal()" style="padding:10px 18px;background:linear-gradient(135deg,#10b981,#059669);color:#fff;border:none;border-radius:10px;font-weight:700;font-size:13px;cursor:pointer;display:flex;align-items:center;gap:6px;box-shadow:0 4px 14px rgba(16,185,129,0.3)">';
    html += '      <span>➕</span> Record New Advance';
    html += '    </button>';
    html += '    <button onclick="ATPLAdvanceManager.triggerDeductionScan()" style="padding:10px 16px;background:linear-gradient(135deg,#6366f1,#4f46e5);color:#fff;border:none;border-radius:10px;font-weight:700;font-size:13px;cursor:pointer;display:flex;align-items:center;gap:6px;box-shadow:0 4px 14px rgba(99,102,241,0.25)">';
    html += '      <span>⚡</span> Re-Scan Salary Sheets';
    html += '    </button>';
    html += '    <button onclick="ATPLAdvanceManager.exportDataCSV()" style="padding:10px 14px;background:#1e293b;border:1px solid rgba(255,255,255,0.12);color:#cbd5e1;border-radius:10px;font-weight:600;font-size:13px;cursor:pointer;display:flex;align-items:center;gap:6px">';
    html += '      <span>📥</span> Export CSV';
    html += '    </button>';
    html += '    <button id="advSyncBtn" onclick="ATPLAdvanceManager.syncNow(true)" style="padding:10px 14px;background:#1e293b;border:1px solid rgba(255,255,255,0.12);color:#94a3b8;border-radius:10px;font-weight:600;font-size:13px;cursor:pointer" title="Sync with Cloud">';
    html += '      <span>🔄</span>';
    html += '    </button>';
    html += '  </div>';
    html += '</div>';

    // Summary Cards
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:14px;margin-bottom:24px">';
    html += '  <div style="background:#0F172A;border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:18px 20px;box-shadow:0 4px 16px rgba(0,0,0,0.25)">';
    html += '    <div style="font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px">Total Advances Disbursed</div>';
    html += '    <div style="font-size:24px;font-weight:800;color:#38bdf8">' + formatINR(totalDisbursed) + '</div>';
    html += '    <div style="font-size:11px;color:#64748b;margin-top:4px">' + state.advances.length + ' lifetime entries</div>';
    html += '  </div>';

    html += '  <div style="background:#0F172A;border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:18px 20px;box-shadow:0 4px 16px rgba(0,0,0,0.25)">';
    html += '    <div style="font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px">Total Recovered / Deducted</div>';
    html += '    <div style="font-size:24px;font-weight:800;color:#4ade80">' + formatINR(totalRecovered) + '</div>';
    html += '    <div style="font-size:11px;color:#64748b;margin-top:4px">' + state.deductions.length + ' monthly salary deductions</div>';
    html += '  </div>';

    html += '  <div style="background:#0F172A;border:1px solid rgba(239,68,68,0.3);border-radius:16px;padding:18px 20px;box-shadow:0 4px 16px rgba(0,0,0,0.25)">';
    html += '    <div style="font-size:11px;font-weight:700;color:#f87171;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px">Current Outstanding Balance</div>';
    html += '    <div style="font-size:24px;font-weight:800;color:#ef4444">' + formatINR(totalOutstanding) + '</div>';
    html += '    <div style="font-size:11px;color:#fca5a5;margin-top:4px">Pending salary deduction</div>';
    html += '  </div>';

    html += '  <div style="background:#0F172A;border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:18px 20px;box-shadow:0 4px 16px rgba(0,0,0,0.25)">';
    html += '    <div style="font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px">Active Advances</div>';
    html += '    <div style="font-size:24px;font-weight:800;color:#fbbf24">' + activeCount + '</div>';
    html += '    <div style="font-size:11px;color:#64748b;margin-top:4px">Across ' + Object.keys(empMap).length + ' employees</div>';
    html += '  </div>';
    html += '</div>';

    // Tabs Navigation
    html += '<div style="display:flex;gap:4px;border-bottom:1px solid rgba(255,255,255,0.1);margin-bottom:18px">';
    html += '  <button onclick="ATPLAdvanceManager.setTab(\'advances\')" style="padding:10px 18px;border:none;background:none;font-size:13px;font-weight:700;cursor:pointer;border-bottom:2px solid ' + (state.activeTab === 'advances' ? '#10b981' : 'transparent') + ';color:' + (state.activeTab === 'advances' ? '#10b981' : '#94a3b8') + '">📑 Advance Entries (' + state.advances.length + ')</button>';
    html += '  <button onclick="ATPLAdvanceManager.setTab(\'deductions\')" style="padding:10px 18px;border:none;background:none;font-size:13px;font-weight:700;cursor:pointer;border-bottom:2px solid ' + (state.activeTab === 'deductions' ? '#10b981' : 'transparent') + ';color:' + (state.activeTab === 'deductions' ? '#10b981' : '#94a3b8') + '">📉 Salary Deductions Audit (' + state.deductions.length + ')</button>';
    html += '  <button onclick="ATPLAdvanceManager.setTab(\'ledger\')" style="padding:10px 18px;border:none;background:none;font-size:13px;font-weight:700;cursor:pointer;border-bottom:2px solid ' + (state.activeTab === 'ledger' ? '#10b981' : 'transparent') + ';color:' + (state.activeTab === 'ledger' ? '#10b981' : '#94a3b8') + '">👥 Employee Balance Ledger (' + Object.keys(empMap).length + ')</button>';
    html += '</div>';

    // Filter and Search Toolbar
    html += '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:16px">';
    html += '  <div style="display:flex;gap:10px;align-items:center;flex:1;min-width:240px;max-width:400px">';
    html += '    <input type="text" id="advSearchInput" placeholder="🔍 Search employee code, name, remarks..." value="' + esc(state.searchQuery) + '" oninput="ATPLAdvanceManager.setSearch(this.value)" style="width:100%;padding:9px 14px;background:#0F172A;border:1px solid rgba(255,255,255,0.12);border-radius:10px;color:#f8fafc;font-size:13px;outline:none">';
    html += '  </div>';

    if (state.activeTab === 'advances') {
      html += '  <div style="display:flex;gap:6px">';
      ['ALL', 'ACTIVE', 'PARTIAL', 'REPAID'].forEach(function(st) {
        var isSel = state.statusFilter === st;
        html += '<button onclick="ATPLAdvanceManager.setStatusFilter(\'' + st + '\')" style="padding:6px 12px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;border:1px solid ' + (isSel ? '#10b981' : 'rgba(255,255,255,0.08)') + ';background:' + (isSel ? 'rgba(16,185,129,0.15)' : '#0F172A') + ';color:' + (isSel ? '#34d399' : '#94a3b8') + '">' + st + '</button>';
      });
      html += '  </div>';
    }
    html += '</div>';

    // TAB CONTENTS
    if (state.activeTab === 'advances') {
      html += renderAdvancesTable();
    } else if (state.activeTab === 'deductions') {
      html += renderDeductionsTable();
    } else if (state.activeTab === 'ledger') {
      html += renderLedgerTable(empMap);
    }

    container.innerHTML = html;
  }

  function renderAdvancesTable() {
    var query = state.searchQuery.toLowerCase().trim();
    var filtered = (state.advances || []).filter(function(a) {
      if (!a) return false;
      if (state.statusFilter !== 'ALL' && a.status !== state.statusFilter) return false;
      if (!query) return true;
      return String(a.empCode || '').toLowerCase().includes(query) ||
             String(a.empName || '').toLowerCase().includes(query) ||
             String(a.remarks || '').toLowerCase().includes(query);
    });

    if (!filtered.length) {
      return '<div style="background:#0F172A;border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:48px;text-align:center;color:#64748b">' +
             '  <div style="font-size:40px;margin-bottom:12px">💳</div>' +
             '  <div style="font-size:16px;font-weight:700;color:#cbd5e1">No Advance Records Found</div>' +
             '  <div style="font-size:12px;margin-top:6px;color:#94a3b8">Click "+ Record New Advance" above to add an employee advance.</div>' +
             '</div>';
    }

    var html = '<div style="background:#0F172A;border:1px solid rgba(255,255,255,0.08);border-radius:16px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.2)">';
    html += '<div style="overflow-x:auto">';
    html += '<table style="width:100%;border-collapse:collapse;font-size:13px;text-align:left">';
    html += '  <thead>';
    html += '    <tr style="background:rgba(255,255,255,0.03);border-bottom:1px solid rgba(255,255,255,0.08);color:#94a3b8;font-size:11px;text-transform:uppercase;letter-spacing:0.5px">';
    html += '      <th style="padding:14px 16px">Date</th>';
    html += '      <th style="padding:14px 16px">Emp Code</th>';
    html += '      <th style="padding:14px 16px">Employee Name</th>';
    html += '      <th style="padding:14px 16px;text-align:right">Advance (₹)</th>';
    html += '      <th style="padding:14px 16px;text-align:right">Recovered (₹)</th>';
    html += '      <th style="padding:14px 16px;text-align:right">Outstanding (₹)</th>';
    html += '      <th style="padding:14px 16px;text-align:center">Status</th>';
    html += '      <th style="padding:14px 16px">Remarks</th>';
    html += '      <th style="padding:14px 16px;text-align:center">Actions</th>';
    html += '    </tr>';
    html += '  </thead>';
    html += '  <tbody>';

    filtered.forEach(function(adv) {
      var statusColor = '#10b981'; // REPAID
      var statusBg = 'rgba(16,185,129,0.15)';
      var statusBorder = 'rgba(16,185,129,0.3)';
      if (adv.status === 'ACTIVE') {
        statusColor = '#f59e0b';
        statusBg = 'rgba(245,158,11,0.15)';
        statusBorder = 'rgba(245,158,11,0.3)';
      } else if (adv.status === 'PARTIAL') {
        statusColor = '#38bdf8';
        statusBg = 'rgba(56,189,248,0.15)';
        statusBorder = 'rgba(56,189,248,0.3)';
      }

      html += '    <tr style="border-bottom:1px solid rgba(255,255,255,0.04);transition:background 0.15s" onmouseover="this.style.background=\'rgba(255,255,255,0.02)\'" onmouseout="this.style.background=\'\'">';
      html += '      <td style="padding:14px 16px;color:#cbd5e1;white-space:nowrap">' + esc(adv.advanceDate || '-') + '</td>';
      html += '      <td style="padding:14px 16px;font-weight:700;color:#38bdf8;font-family:monospace">' + esc(adv.empCode) + '</td>';
      html += '      <td style="padding:14px 16px;font-weight:600;color:#f8fafc">' + esc(adv.empName) + '</td>';
      html += '      <td style="padding:14px 16px;text-align:right;font-weight:700;color:#f8fafc">' + formatINR(adv.amount) + '</td>';
      html += '      <td style="padding:14px 16px;text-align:right;color:#4ade80">' + formatINR(adv.recoveredAmount) + '</td>';
      html += '      <td style="padding:14px 16px;text-align:right;font-weight:800;color:' + (adv.balanceAmount > 0 ? '#ef4444' : '#94a3b8') + '">' + formatINR(adv.balanceAmount) + '</td>';
      html += '      <td style="padding:14px 16px;text-align:center"><span style="padding:4px 10px;border-radius:12px;font-size:11px;font-weight:700;background:' + statusBg + ';color:' + statusColor + ';border:1px solid ' + statusBorder + '">' + esc(adv.status) + '</span></td>';
      html += '      <td style="padding:14px 16px;color:#94a3b8;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(adv.remarks) + '">' + esc(adv.remarks || '-') + '</td>';
      html += '      <td style="padding:14px 16px;text-align:center;white-space:nowrap">';
      html += '        <button onclick="ATPLAdvanceManager.viewStatement(\'' + adv.id + '\')" style="padding:5px 9px;border:none;background:rgba(255,255,255,0.06);color:#38bdf8;border-radius:6px;cursor:pointer;font-size:11px;font-weight:600;margin-right:4px" title="View Statement">👁 Details</button>';
      html += '        <button onclick="ATPLAdvanceManager.editAdvance(\'' + adv.id + '\')" style="padding:5px 9px;border:none;background:rgba(255,255,255,0.06);color:#fbbf24;border-radius:6px;cursor:pointer;font-size:11px;font-weight:600;margin-right:4px" title="Edit Advance">✏️</button>';
      html += '        <button onclick="ATPLAdvanceManager.confirmDelete(\'' + adv.id + '\')" style="padding:5px 9px;border:none;background:rgba(239,68,68,0.15);color:#ef4444;border-radius:6px;cursor:pointer;font-size:11px;font-weight:600" title="Delete Advance">🗑</button>';
      html += '      </td>';
      html += '    </tr>';
    });

    html += '  </tbody>';
    html += '</table>';
    html += '</div>';
    html += '</div>';
    return html;
  }

  function renderDeductionsTable() {
    var query = state.searchQuery.toLowerCase().trim();
    var filtered = (state.deductions || []).filter(function(d) {
      if (!d) return false;
      if (!query) return true;
      return String(d.empCode || '').toLowerCase().includes(query) ||
             String(d.empName || '').toLowerCase().includes(query) ||
             String(d.fileName || '').toLowerCase().includes(query) ||
             String(d.salaryMonth || '').toLowerCase().includes(query);
    }).reverse();

    if (!filtered.length) {
      return '<div style="background:#0F172A;border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:48px;text-align:center;color:#64748b">' +
             '  <div style="font-size:40px;margin-bottom:12px">📉</div>' +
             '  <div style="font-size:16px;font-weight:700;color:#cbd5e1">No Salary Deductions Yet</div>' +
             '  <div style="font-size:12px;margin-top:6px;color:#94a3b8">When salary sheets are uploaded via "All Files", matched employee advance deductions will automatically populate here.</div>' +
             '</div>';
    }

    var html = '<div style="background:#0F172A;border:1px solid rgba(255,255,255,0.08);border-radius:16px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.2)">';
    html += '<div style="overflow-x:auto">';
    html += '<table style="width:100%;border-collapse:collapse;font-size:13px;text-align:left">';
    html += '  <thead>';
    html += '    <tr style="background:rgba(255,255,255,0.03);border-bottom:1px solid rgba(255,255,255,0.08);color:#94a3b8;font-size:11px;text-transform:uppercase;letter-spacing:0.5px">';
    html += '      <th style="padding:14px 16px">Deduction Date</th>';
    html += '      <th style="padding:14px 16px">Salary File / Period</th>';
    html += '      <th style="padding:14px 16px">Emp Code</th>';
    html += '      <th style="padding:14px 16px">Employee Name</th>';
    html += '      <th style="padding:14px 16px;text-align:right">Previous Balance</th>';
    html += '      <th style="padding:14px 16px;text-align:right">Monthly Deduction</th>';
    html += '      <th style="padding:14px 16px;text-align:right">Remaining Balance</th>';
    html += '      <th style="padding:14px 16px;text-align:center">Action</th>';
    html += '    </tr>';
    html += '  </thead>';
    html += '  <tbody>';

    filtered.forEach(function(d) {
      var dDate = d.date ? d.date.slice(0, 10) : '-';
      html += '    <tr style="border-bottom:1px solid rgba(255,255,255,0.04);transition:background 0.15s" onmouseover="this.style.background=\'rgba(255,255,255,0.02)\'" onmouseout="this.style.background=\'\'">';
      html += '      <td style="padding:14px 16px;color:#cbd5e1;white-space:nowrap">' + esc(dDate) + '</td>';
      html += '      <td style="padding:14px 16px">';
      html += '        <div style="font-weight:700;color:#f8fafc">' + esc(d.salaryMonth || 'Monthly Salary') + '</div>';
      html += '        <div style="font-size:11px;color:#64748b">' + esc(d.fileName) + '</div>';
      html += '      </td>';
      html += '      <td style="padding:14px 16px;font-weight:700;color:#38bdf8;font-family:monospace">' + esc(d.empCode) + '</td>';
      html += '      <td style="padding:14px 16px;font-weight:600;color:#f8fafc">' + esc(d.empName) + '</td>';
      html += '      <td style="padding:14px 16px;text-align:right;color:#94a3b8">' + formatINR(d.previousBalance) + '</td>';
      html += '      <td style="padding:14px 16px;text-align:right;font-weight:700;color:#4ade80">-' + formatINR(d.deductedAmount) + '</td>';
      html += '      <td style="padding:14px 16px;text-align:right;font-weight:800;color:' + (d.remainingBalance > 0 ? '#ef4444' : '#10b981') + '">' + formatINR(d.remainingBalance) + '</td>';
      html += '      <td style="padding:14px 16px;text-align:center">';
      html += '        <button onclick="ATPLAdvanceManager.viewStatement(\'' + d.advanceId + '\')" style="padding:5px 9px;border:none;background:rgba(255,255,255,0.06);color:#38bdf8;border-radius:6px;cursor:pointer;font-size:11px;font-weight:600">👁 View</button>';
      html += '      </td>';
      html += '    </tr>';
    });

    html += '  </tbody>';
    html += '</table>';
    html += '</div>';
    html += '</div>';
    return html;
  }

  function renderLedgerTable(empMap) {
    var query = state.searchQuery.toLowerCase().trim();
    var list = Object.values(empMap).filter(function(e) {
      if (!e) return false;
      if (!query) return true;
      return String(e.code || '').toLowerCase().includes(query) ||
             String(e.name || '').toLowerCase().includes(query);
    });

    if (!list.length) {
      return '<div style="background:#0F172A;border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:48px;text-align:center;color:#64748b">' +
             '  <div style="font-size:40px;margin-bottom:12px">👥</div>' +
             '  <div style="font-size:16px;font-weight:700;color:#cbd5e1">No Employee Balance Records</div>' +
             '</div>';
    }

    var html = '<div style="background:#0F172A;border:1px solid rgba(255,255,255,0.08);border-radius:16px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.2)">';
    html += '<div style="overflow-x:auto">';
    html += '<table style="width:100%;border-collapse:collapse;font-size:13px;text-align:left">';
    html += '  <thead>';
    html += '    <tr style="background:rgba(255,255,255,0.03);border-bottom:1px solid rgba(255,255,255,0.08);color:#94a3b8;font-size:11px;text-transform:uppercase;letter-spacing:0.5px">';
    html += '      <th style="padding:14px 16px">Emp Code</th>';
    html += '      <th style="padding:14px 16px">Employee Name</th>';
    html += '      <th style="padding:14px 16px;text-align:center">Advance Count</th>';
    html += '      <th style="padding:14px 16px;text-align:right">Total Disbursed (₹)</th>';
    html += '      <th style="padding:14px 16px;text-align:right">Total Recovered (₹)</th>';
    html += '      <th style="padding:14px 16px;text-align:right">Net Outstanding (₹)</th>';
    html += '      <th style="padding:14px 16px;text-align:center">Balance Status</th>';
    html += '      <th style="padding:14px 16px;text-align:center">Action</th>';
    html += '    </tr>';
    html += '  </thead>';
    html += '  <tbody>';

    list.forEach(function(item) {
      var isPending = item.totalBal > 0;
      html += '    <tr style="border-bottom:1px solid rgba(255,255,255,0.04);transition:background 0.15s" onmouseover="this.style.background=\'rgba(255,255,255,0.02)\'" onmouseout="this.style.background=\'\'">';
      html += '      <td style="padding:14px 16px;font-weight:700;color:#38bdf8;font-family:monospace">' + esc(item.code) + '</td>';
      html += '      <td style="padding:14px 16px;font-weight:600;color:#f8fafc">' + esc(item.name) + '</td>';
      html += '      <td style="padding:14px 16px;text-align:center;color:#94a3b8">' + item.count + '</td>';
      html += '      <td style="padding:14px 16px;text-align:right;font-weight:700;color:#f8fafc">' + formatINR(item.totalAdv) + '</td>';
      html += '      <td style="padding:14px 16px;text-align:right;color:#4ade80">' + formatINR(item.totalRec) + '</td>';
      html += '      <td style="padding:14px 16px;text-align:right;font-weight:800;color:' + (isPending ? '#ef4444' : '#10b981') + '">' + formatINR(item.totalBal) + '</td>';
      html += '      <td style="padding:14px 16px;text-align:center">';
      if (isPending) {
        html += '        <span style="padding:4px 10px;border-radius:12px;font-size:11px;font-weight:700;background:rgba(239,68,68,0.15);color:#ef4444;border:1px solid rgba(239,68,68,0.3)">OUTSTANDING</span>';
      } else {
        html += '        <span style="padding:4px 10px;border-radius:12px;font-size:11px;font-weight:700;background:rgba(16,185,129,0.15);color:#10b981;border:1px solid rgba(16,185,129,0.3)">CLEAR</span>';
      }
      html += '      </td>';
      html += '      <td style="padding:14px 16px;text-align:center">';
      html += '        <button onclick="ATPLAdvanceManager.openNewModal(\'' + esc(item.code) + '\')" style="padding:5px 10px;border:none;background:rgba(16,185,129,0.2);color:#34d399;border-radius:6px;cursor:pointer;font-size:11px;font-weight:700">➕ Add Advance</button>';
      html += '      </td>';
      html += '    </tr>';
    });

    html += '  </tbody>';
    html += '</table>';
    html += '</div>';
    html += '</div>';
    return html;
  }

  // ── 7. MODALS (NEW ENTRY & STATEMENT) ──
  function openNewModal(prefillCode) {
    state.editingAdvanceId = null;
    var emp = prefillCode ? findEmployeeByCode(prefillCode) : null;
    var outBal = prefillCode ? getEmployeeOutstandingBalance(prefillCode) : 0;

    var modal = document.getElementById('advModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'advModal';
      document.body.appendChild(modal);
    }

    var today = new Date().toISOString().slice(0, 10);

    var content = '';
    content += '<div style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.75);backdrop-filter:blur(4px);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px" onclick="if(event.target===this)ATPLAdvanceManager.closeModal()">';
    content += '  <div style="background:#0F172A;border:1px solid rgba(255,255,255,0.12);border-radius:20px;max-width:540px;width:100%;box-shadow:0 20px 40px rgba(0,0,0,0.5);overflow:hidden;animation:fadeIn 0.2s ease">';
    
    // Modal Header
    content += '    <div style="padding:20px 24px;border-bottom:1px solid rgba(255,255,255,0.08);display:flex;justify-content:space-between;align-items:center;background:linear-gradient(135deg,#1e1b4b,#0f172a)">';
    content += '      <div>';
    content += '        <h3 style="margin:0;font-size:18px;font-weight:800;color:#f8fafc">Record Employee Advance</h3>';
    content += '        <div style="font-size:12px;color:#94a3b8;margin-top:2px">Employee code auto-fetches name from Employee Master</div>';
    content += '      </div>';
    content += '      <button onclick="ATPLAdvanceManager.closeModal()" style="border:none;background:rgba(255,255,255,0.06);color:#94a3b8;width:32px;height:32px;border-radius:50%;cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center">✕</button>';
    content += '    </div>';

    // Modal Form Body
    content += '    <div style="padding:24px;display:flex;flex-direction:column;gap:16px">';
    
    // Employee Code Input + Autocomplete Suggestion Area
    content += '      <div>';
    content += '        <label style="display:block;font-size:12px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px">Employee Code *</label>';
    content += '        <input type="text" id="advFormCode" placeholder="Enter Employee Code (e.g. 25924)" value="' + esc(prefillCode || '') + '" oninput="ATPLAdvanceManager.onCodeInput(this.value)" autocomplete="off" style="width:100%;padding:11px 14px;background:#1e293b;border:1px solid rgba(255,255,255,0.14);border-radius:10px;color:#f8fafc;font-size:14px;font-weight:700;font-family:monospace;outline:none">';
    content += '        <div id="advCodeSuggestions" style="display:none;position:relative;background:#1e293b;border:1px solid rgba(255,255,255,0.15);border-radius:10px;margin-top:4px;max-height:160px;overflow-y:auto;z-index:100;box-shadow:0 10px 25px rgba(0,0,0,0.4)"></div>';
    content += '      </div>';

    // Auto-fetched details box
    content += '      <div id="advEmpDetailsBox" style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:12px 16px;display:flex;justify-content:space-between;align-items:center">';
    content += '        <div>';
    content += '          <div style="font-size:11px;color:#64748b;text-transform:uppercase;font-weight:700">Auto-Fetched Employee</div>';
    content += '          <div id="advFormEmpName" style="font-size:14px;font-weight:700;color:' + (emp ? '#38bdf8' : '#94a3b8') + '">' + esc(emp ? emp.name : 'Waiting for Employee Code...') + '</div>';
    content += '          <div id="advFormEmpDept" style="font-size:11px;color:#94a3b8">' + esc(emp ? (emp.dept + (emp.desig ? ' • ' + emp.desig : '')) : '-') + '</div>';
    content += '        </div>';
    content += '        <div style="text-align:right">';
    content += '          <div style="font-size:11px;color:#64748b;text-transform:uppercase;font-weight:700">Existing Balance</div>';
    content += '          <div id="advFormExistingBal" style="font-size:15px;font-weight:800;color:' + (outBal > 0 ? '#ef4444' : '#10b981') + '">' + formatINR(outBal) + '</div>';
    content += '        </div>';
    content += '      </div>';

    // Date & Amount in 2 columns
    content += '      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">';
    content += '        <div>';
    content += '          <label style="display:block;font-size:12px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px">Advance Date *</label>';
    content += '          <input type="date" id="advFormDate" value="' + today + '" style="width:100%;padding:11px 14px;background:#1e293b;border:1px solid rgba(255,255,255,0.14);border-radius:10px;color:#f8fafc;font-size:13px;outline:none">';
    content += '        </div>';
    content += '        <div>';
    content += '          <label style="display:block;font-size:12px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px">Advance Amount (₹) *</label>';
    content += '          <input type="number" id="advFormAmount" min="1" placeholder="e.g. 10000" style="width:100%;padding:11px 14px;background:#1e293b;border:1px solid rgba(255,255,255,0.14);border-radius:10px;color:#f8fafc;font-size:14px;font-weight:700;outline:none">';
    content += '        </div>';
    content += '      </div>';

    // Quick Amount Buttons
    content += '      <div style="display:flex;gap:8px;flex-wrap:wrap">';
    [2000, 5000, 10000, 20000, 50000].forEach(function(amt) {
      content += '      <button type="button" onclick="document.getElementById(\'advFormAmount\').value=' + amt + '" style="padding:4px 10px;background:#1e293b;border:1px solid rgba(255,255,255,0.1);color:#cbd5e1;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer">+ ' + formatINR(amt) + '</button>';
    });
    content += '      </div>';

    // Monthly Cap (Optional installment)
    content += '      <div>';
    content += '        <label style="display:block;font-size:12px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">Monthly Max Deduction (Optional)</label>';
    content += '        <div style="font-size:11px;color:#64748b;margin-bottom:6px">Leave 0 to deduct full advance in the upcoming salary. Enter amount for installment recovery.</div>';
    content += '        <input type="number" id="advFormCap" min="0" placeholder="0 = Deduct Full Outstanding" style="width:100%;padding:10px 14px;background:#1e293b;border:1px solid rgba(255,255,255,0.14);border-radius:10px;color:#f8fafc;font-size:13px;outline:none">';
    content += '      </div>';

    // Remarks
    content += '      <div>';
    content += '        <label style="display:block;font-size:12px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px">Remarks / Reason</label>';
    content += '        <input type="text" id="advFormRemarks" placeholder="e.g. Festival Advance, Medical Need, Urgent Loan" style="width:100%;padding:10px 14px;background:#1e293b;border:1px solid rgba(255,255,255,0.14);border-radius:10px;color:#f8fafc;font-size:13px;outline:none">';
    content += '      </div>';

    content += '    </div>';

    // Modal Footer
    content += '    <div style="padding:16px 24px;border-top:1px solid rgba(255,255,255,0.08);display:flex;justify-content:flex-end;gap:10px;background:#0b0f19">';
    content += '      <button onclick="ATPLAdvanceManager.closeModal()" style="padding:10px 18px;background:none;border:1px solid rgba(255,255,255,0.12);color:#94a3b8;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer">Cancel</button>';
    content += '      <button onclick="ATPLAdvanceManager.submitForm()" style="padding:10px 22px;background:linear-gradient(135deg,#10b981,#059669);color:#fff;border:none;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;box-shadow:0 4px 14px rgba(16,185,129,0.3)">Save Advance &amp; Sync</button>';
    content += '    </div>';

    content += '  </div>';
    content += '</div>';

    modal.innerHTML = content;
  }

  function onCodeInput(val) {
    var raw = String(val || '').trim();
    var boxName = document.getElementById('advFormEmpName');
    var boxDept = document.getElementById('advFormEmpDept');
    var boxBal = document.getElementById('advFormExistingBal');
    var suggBox = document.getElementById('advCodeSuggestions');

    if (!raw) {
      if (boxName) { boxName.textContent = 'Waiting for Employee Code...'; boxName.style.color = '#94a3b8'; }
      if (boxDept) boxDept.textContent = '-';
      if (boxBal) { boxBal.textContent = '₹0'; boxBal.style.color = '#10b981'; }
      if (suggBox) suggBox.style.display = 'none';
      return;
    }

    var emp = findEmployeeByCode(raw);
    var bal = getEmployeeOutstandingBalance(raw);

    if (emp) {
      if (boxName) { boxName.textContent = emp.name; boxName.style.color = '#38bdf8'; }
      if (boxDept) boxDept.textContent = emp.dept + (emp.desig ? ' • ' + emp.desig : '');
    } else {
      if (boxName) { boxName.textContent = 'Code not in Master (Custom Employee)'; boxName.style.color = '#fbbf24'; }
      if (boxDept) boxDept.textContent = '-';
    }

    if (boxBal) {
      boxBal.textContent = formatINR(bal);
      boxBal.style.color = bal > 0 ? '#ef4444' : '#10b981';
    }

    // Populate autocomplete suggestions
    if (suggBox) {
      var allEm = getMasterEmployees();
      var norm = raw.toLowerCase();
      var matches = allEm.filter(function(e) {
        if (!e) return false;
        var code = String(e.emp_id || e.code || '').toLowerCase();
        var name = String(e.name || '').toLowerCase();
        return code.includes(norm) || name.includes(norm);
      }).slice(0, 6);

      if (matches.length > 0 && (!emp || raw !== emp.code)) {
        var sHtml = '';
        matches.forEach(function(m) {
          var mCode = String(m.emp_id || m.code);
          var mName = String(m.name || '');
          var mDept = String(m.dept || '');
          sHtml += '<div onclick="ATPLAdvanceManager.selectSuggestion(\'' + esc(mCode) + '\')" style="padding:8px 12px;border-bottom:1px solid rgba(255,255,255,0.06);cursor:pointer;display:flex;justify-content:space-between;align-items:center" onmouseover="this.style.background=\'rgba(255,255,255,0.08)\'" onmouseout="this.style.background=\'\'">';
          sHtml += '  <div><strong style="color:#38bdf8">' + esc(mCode) + '</strong> - <span style="color:#f8fafc">' + esc(mName) + '</span></div>';
          sHtml += '  <div style="font-size:10px;color:#94a3b8">' + esc(mDept) + '</div>';
          sHtml += '</div>';
        });
        suggBox.innerHTML = sHtml;
        suggBox.style.display = 'block';
      } else {
        suggBox.style.display = 'none';
      }
    }
  }

  function selectSuggestion(code) {
    var inp = document.getElementById('advFormCode');
    if (inp) {
      inp.value = code;
      onCodeInput(code);
    }
    var suggBox = document.getElementById('advCodeSuggestions');
    if (suggBox) suggBox.style.display = 'none';
  }

  function submitForm() {
    var code = (document.getElementById('advFormCode') || {}).value;
    var date = (document.getElementById('advFormDate') || {}).value;
    var amount = (document.getElementById('advFormAmount') || {}).value;
    var cap = (document.getElementById('advFormCap') || {}).value;
    var remarks = (document.getElementById('advFormRemarks') || {}).value;

    if (!code || !String(code).trim()) {
      alert('Please enter an Employee Code.');
      return;
    }
    if (!amount || Number(amount) <= 0) {
      alert('Please enter a valid positive Advance Amount.');
      return;
    }

    var emp = findEmployeeByCode(code);
    var empName = emp ? emp.name : ('Employee ' + code);

    var success = addOrUpdateAdvance({
      id: state.editingAdvanceId || undefined,
      empCode: String(code).trim(),
      empName: empName,
      advanceDate: date,
      amount: Number(amount),
      monthlyCap: Number(cap) || 0,
      remarks: remarks
    });

    if (success) {
      closeModal();
    }
  }

  function editAdvance(id) {
    var adv = state.advances.find(function(a) { return a.id === id; });
    if (!adv) return;
    openNewModal(adv.empCode);
    state.editingAdvanceId = id;

    setTimeout(function() {
      var dInp = document.getElementById('advFormDate');
      var aInp = document.getElementById('advFormAmount');
      var cInp = document.getElementById('advFormCap');
      var rInp = document.getElementById('advFormRemarks');
      if (dInp) dInp.value = adv.advanceDate || '';
      if (aInp) aInp.value = adv.amount || '';
      if (cInp) cInp.value = adv.monthlyCap || 0;
      if (rInp) rInp.value = adv.remarks || '';
    }, 50);
  }

  function confirmDelete(id) {
    var adv = state.advances.find(function(a) { return a.id === id; });
    if (!adv) return;
    if (confirm('Are you sure you want to delete Advance of ' + formatINR(adv.amount) + ' for ' + adv.empName + ' (' + adv.empCode + ')?')) {
      deleteAdvance(id);
    }
  }

  function viewStatement(advanceId) {
    var adv = state.advances.find(function(a) { return a.id === advanceId; });
    if (!adv) return;

    var modal = document.getElementById('advModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'advModal';
      document.body.appendChild(modal);
    }

    var decList = (state.deductions || []).filter(function(d) {
      return d.advanceId === advanceId;
    });

    var content = '';
    content += '<div style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.8);backdrop-filter:blur(4px);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px" onclick="if(event.target===this)ATPLAdvanceManager.closeModal()">';
    content += '  <div style="background:#0F172A;border:1px solid rgba(255,255,255,0.12);border-radius:20px;max-width:650px;width:100%;box-shadow:0 20px 40px rgba(0,0,0,0.6);overflow:hidden">';
    
    // Header
    content += '    <div style="padding:20px 24px;border-bottom:1px solid rgba(255,255,255,0.08);display:flex;justify-content:space-between;align-items:center;background:linear-gradient(135deg,#1e1b4b,#0f172a)">';
    content += '      <div>';
    content += '        <h3 style="margin:0;font-size:18px;font-weight:800;color:#f8fafc">Advance Statement &amp; Deductions</h3>';
    content += '        <div style="font-size:12px;color:#94a3b8;margin-top:2px">Employee: <strong style="color:#38bdf8">' + esc(adv.empName) + '</strong> (' + esc(adv.empCode) + ')</div>';
    content += '      </div>';
    content += '      <button onclick="ATPLAdvanceManager.closeModal()" style="border:none;background:rgba(255,255,255,0.06);color:#94a3b8;width:32px;height:32px;border-radius:50%;cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center">✕</button>';
    content += '    </div>';

    // Summary Card
    content += '    <div style="padding:20px 24px;border-bottom:1px solid rgba(255,255,255,0.06);background:rgba(255,255,255,0.02);display:grid;grid-template-columns:repeat(3,1fr);gap:12px">';
    content += '      <div><div style="font-size:11px;color:#64748b;text-transform:uppercase;font-weight:700">Original Advance</div><div style="font-size:18px;font-weight:800;color:#f8fafc">' + formatINR(adv.amount) + '</div><div style="font-size:11px;color:#94a3b8">' + esc(adv.advanceDate) + '</div></div>';
    content += '      <div><div style="font-size:11px;color:#64748b;text-transform:uppercase;font-weight:700">Total Deducted</div><div style="font-size:18px;font-weight:800;color:#4ade80">' + formatINR(adv.recoveredAmount) + '</div><div style="font-size:11px;color:#94a3b8">' + decList.length + ' monthly deduction(s)</div></div>';
    content += '      <div><div style="font-size:11px;color:#64748b;text-transform:uppercase;font-weight:700">Balance Remaining</div><div style="font-size:18px;font-weight:800;color:' + (adv.balanceAmount > 0 ? '#ef4444' : '#10b981') + '">' + formatINR(adv.balanceAmount) + '</div><div style="font-size:11px;font-weight:700;color:' + (adv.status === 'REPAID' ? '#10b981' : '#f59e0b') + '">' + esc(adv.status) + '</div></div>';
    content += '    </div>';

    // Deductions Table
    content += '    <div style="padding:20px 24px;max-height:300px;overflow-y:auto">';
    content += '      <h4 style="margin:0 0 12px;font-size:13px;font-weight:700;color:#cbd5e1;text-transform:uppercase;letter-spacing:0.5px">Salary Deductions History</h4>';
    
    if (!decList.length) {
      content += '      <div style="text-align:center;padding:24px;color:#64748b;font-size:12px">No salary deductions have occurred yet for this advance.</div>';
    } else {
      content += '      <table style="width:100%;border-collapse:collapse;font-size:12px;text-align:left">';
      content += '        <thead>';
      content += '          <tr style="border-bottom:1px solid rgba(255,255,255,0.08);color:#94a3b8">';
      content += '            <th style="padding:8px">Period / Month</th>';
      content += '            <th style="padding:8px">File Name</th>';
      content += '            <th style="padding:8px;text-align:right">Previous Bal</th>';
      content += '            <th style="padding:8px;text-align:right">Deducted</th>';
      content += '            <th style="padding:8px;text-align:right">New Bal</th>';
      content += '          </tr>';
      content += '        </thead>';
      content += '        <tbody>';
      decList.forEach(function(d) {
        content += '        <tr style="border-bottom:1px solid rgba(255,255,255,0.04)">';
        content += '          <td style="padding:8px;font-weight:700;color:#f8fafc">' + esc(d.salaryMonth) + '</td>';
        content += '          <td style="padding:8px;color:#94a3b8;font-size:11px">' + esc(d.fileName) + '</td>';
        content += '          <td style="padding:8px;text-align:right;color:#cbd5e1">' + formatINR(d.previousBalance) + '</td>';
        content += '          <td style="padding:8px;text-align:right;font-weight:700;color:#4ade80">-' + formatINR(d.deductedAmount) + '</td>';
        content += '          <td style="padding:8px;text-align:right;font-weight:700;color:' + (d.remainingBalance > 0 ? '#ef4444' : '#10b981') + '">' + formatINR(d.remainingBalance) + '</td>';
        content += '        </tr>';
      });
      content += '        </tbody>';
      content += '      </table>';
    }
    content += '    </div>';

    // Footer
    content += '    <div style="padding:14px 24px;border-top:1px solid rgba(255,255,255,0.08);display:flex;justify-content:flex-end;background:#0b0f19">';
    content += '      <button onclick="ATPLAdvanceManager.closeModal()" style="padding:8px 18px;background:rgba(255,255,255,0.08);color:#cbd5e1;border:none;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer">Close</button>';
    content += '    </div>';

    content += '  </div>';
    content += '</div>';

    modal.innerHTML = content;
  }

  function closeModal() {
    var modal = document.getElementById('advModal');
    if (modal) modal.innerHTML = '';
  }

  // ── 8. EXPORT CSV ──
  function exportDataCSV() {
    if (!state.advances.length) {
      alert('No advance records to export.');
      return;
    }
    var headers = ['Advance ID', 'Emp Code', 'Employee Name', 'Advance Date', 'Amount (INR)', 'Recovered (INR)', 'Balance (INR)', 'Monthly Cap', 'Status', 'Remarks'];
    var rows = state.advances.map(function(a) {
      return [
        a.id,
        a.empCode,
        '"' + (a.empName || '').replace(/"/g, '""') + '"',
        a.advanceDate,
        a.amount,
        a.recoveredAmount,
        a.balanceAmount,
        a.monthlyCap || 0,
        a.status,
        '"' + (a.remarks || '').replace(/"/g, '""') + '"'
      ].join(',');
    });
    var csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(',')].concat(rows).join('\n');
    var encodedUri = encodeURI(csvContent);
    var link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', 'ATPL_Employee_Advances_' + new Date().toISOString().slice(0, 10) + '.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // ── 9. PUBLIC API ──
  var ATPLAdvanceManager = {
    version: '1.0.0-ENTERPRISE',
    init: function() {
      loadFromLocal();
      fetchRemoteAdvances();
      setupRealtimeListeners();
      
      // Auto-scan files when salary subscriber is notified
      if (window.ATPLGoogleSync && typeof window.ATPLGoogleSync.init === 'function') {
        // Register subscriber if supported
      }
      
      // Initial render if container exists
      renderUI();
    },
    getAllAdvances: function() { return state.advances; },
    getAllDeductions: function() { return state.deductions; },
    getEmployeeOutstandingBalance: getEmployeeOutstandingBalance,
    addOrUpdateAdvance: addOrUpdateAdvance,
    deleteAdvance: deleteAdvance,
    processSalaryFile: processSalaryFile,
    processAllSalaryFiles: processAllSalaryFiles,
    renderUI: renderUI,
    setTab: function(tab) {
      state.activeTab = tab;
      renderUI();
    },
    setSearch: function(q) {
      state.searchQuery = q || '';
      renderUI();
      // Keep focus on input
      var inp = document.getElementById('advSearchInput');
      if (inp) {
        inp.focus();
        inp.selectionStart = inp.selectionEnd = inp.value.length;
      }
    },
    setStatusFilter: function(st) {
      state.statusFilter = st;
      renderUI();
    },
    openNewModal: openNewModal,
    closeModal: closeModal,
    onCodeInput: onCodeInput,
    selectSuggestion: selectSuggestion,
    submitForm: submitForm,
    editAdvance: editAdvance,
    confirmDelete: confirmDelete,
    viewStatement: viewStatement,
    syncNow: async function(manual) {
      var btn = document.getElementById('advSyncBtn');
      if (btn) btn.innerHTML = '<span style="display:inline-block;animation:spin 1s linear infinite">🔄</span>';
      var res = await fetchRemoteAdvances(true, !!manual);
      if (btn) btn.innerHTML = '<span>🔄</span>';
      if (res && res.ok) {
        if (window.showToast) {
          window.showToast('✅ Synchronized ' + state.advances.length + ' advances and ' + state.deductions.length + ' deductions from cloud!');
        }
      } else {
        if (window.showToast) {
          window.showToast('⚠️ Cloud sync could not complete. Displaying latest local records.');
        }
      }
      return res;
    },
    triggerDeductionScan: function() {
      var count = processAllSalaryFiles();
      if (count === 0) {
        if (window.showToast) window.showToast('✅ Scanned all salary sheets. No pending advance deductions found.');
      }
    }
  };

  window.ATPLAdvanceManager = ATPLAdvanceManager;

  // Auto-init on DOMContentLoaded or immediate if ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      ATPLAdvanceManager.init();
    });
  } else {
    ATPLAdvanceManager.init();
  }

})(window);
