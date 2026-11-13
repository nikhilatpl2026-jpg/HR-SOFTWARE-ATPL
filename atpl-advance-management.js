/**
 * ATPL ADVANCE MANAGEMENT, EXACT SALARY SHEET DEDUCTION & MANUAL RECOVERY ENGINE (V2.0 - ENTERPRISE)
 * Dedicated full-screen HR ERP module for Arora Textiles Private Limited.
 * Features:
 *  - Employee Master Code auto-lookup & instant name/dept mapping
 *  - Multi-advance tracking per employee with total outstanding balance calculation
 *  - Accurate Salary Sheet Advance Column matching: ONLY deducts from valid salary sheets containing an
 *    explicit Advance deduction column, using the exact amount deducted for that employee in that column
 *  - Manual Advance Deduction workflow (Cash/Bank/F&F/Adjustment, FIFO or specific advance, with undo/delete)
 *  - Complete Employee History audit modal combining Advances Given + Salary Sheet Cuts + Manual Cuts
 *  - Strict guards: Never deduct > balance, never deduct same file/employee twice (idempotent)
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
    deductionSourceFilter: 'ALL', // 'ALL' | 'salary' | 'manual'
    historySourceFilter: 'ALL', // 'ALL' | 'salary' | 'manual'
    openHistoryEmpCode: null,
    isSyncing: false,
    selectedAdvanceForModal: null,
    editingAdvanceId: null
  };

  function round2(n) {
    return Math.round((Number(n) || 0) * 100) / 100;
  }

  function formatINR(val) {
    var n = Number(val) || 0;
    return '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  }

  function normalizeCode(code) {
    if (code == null) return '';
    return String(code).trim().replace(/\.0+$/, '').toLowerCase().replace(/^0+/, '');
  }

  function esc(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function parseMoney(val) {
    if (val == null) return 0;
    if (typeof val === 'number') return isFinite(val) ? val : 0;
    var s = String(val).replace(/[₹,\s]/g, '').trim();
    if (!s || s === '-' || s === '--' || /^n\/?a$/i.test(s)) return 0;
    var m = s.match(/-?\d+(?:\.\d+)?/);
    if (!m) return 0;
    var num = parseFloat(m[0]);
    return isFinite(num) ? num : 0;
  }

  function isDeductionTombstoned(d) {
    if (!d || !d.id) return true;
    var t = state.tombstones || {};
    return !!(t[d.id] || t['ded:' + d.id] || (d.advanceId && t[d.advanceId]));
  }

  function getDeductionSourceType(d) {
    if (!d) return 'salary';
    if (d.sourceType === 'manual' || d.sourceType === 'salary') return d.sourceType;
    var fn = String(d.fileName || '').toLowerCase();
    var sh = String(d.sheetName || '').toLowerCase();
    var col = String(d.columnName || '').toLowerCase();
    if (fn.indexOf('manual') >= 0 || sh.indexOf('manual') >= 0 || col.indexOf('manual') >= 0 || String(d.id || '').indexOf('ded_man_') === 0) {
      return 'manual';
    }
    return 'salary';
  }

  function getDeductionDateStr(d) {
    if (!d) return '';
    if (d.deductionDate && /^\d{4}-\d{2}-\d{2}/.test(String(d.deductionDate))) {
      return String(d.deductionDate).slice(0, 10);
    }
    if (d.date) return String(d.date).slice(0, 10);
    return '';
  }

  function formatMonthYearFromDate(dateStr) {
    var mNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    if (!dateStr) return 'Manual Entry';
    var m = String(dateStr).match(/^(\d{4})-(\d{2})/);
    if (m) {
      var yr = m[1];
      var mo = parseInt(m[2], 10);
      if (mo >= 1 && mo <= 12) return mNames[mo - 1] + ' ' + yr;
    }
    return String(dateStr);
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
    for (var j = 0; j < (state.advances || []).length; j++) {
      var a = state.advances[j];
      if (a && normalizeCode(a.empCode) === norm && a.empName) {
        return {
          code: String(a.empCode).trim(),
          name: String(a.empName).trim(),
          dept: '',
          desig: '',
          gross: 0
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
    if (state.tombstones && Object.keys(state.tombstones).length > 0) {
      state.advances = (state.advances || []).filter(function(a) {
        return a && a.id && !state.tombstones[a.id];
      });
      state.deductions = (state.deductions || []).filter(function(d) {
        return !isDeductionTombstoned(d);
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

  function recalculateAllBalances() {
    state.advances = (state.advances || []).filter(function(a) {
      return a && a.id && !(state.tombstones && state.tombstones[a.id]);
    });
    state.deductions = (state.deductions || []).filter(function(d) {
      return !isDeductionTombstoned(d);
    });

    var byAdvance = {};
    (state.deductions || []).forEach(function(d) {
      if (!d || !d.advanceId) return;
      if (!byAdvance[d.advanceId]) byAdvance[d.advanceId] = [];
      byAdvance[d.advanceId].push(d);
    });

    (state.advances || []).forEach(function(adv) {
      if (!adv) return;
      var list = (byAdvance[adv.id] || []).slice().sort(function(a, b) {
        var ta = Date.parse(a.deductionDate || a.date || 0) || 0;
        var tb = Date.parse(b.deductionDate || b.date || 0) || 0;
        if (ta !== tb) return ta - tb;
        return String(a.id || '').localeCompare(String(b.id || ''));
      });

      var runningBal = round2(Number(adv.amount) || 0);
      var totalDeducted = 0;
      list.forEach(function(d) {
        var cut = round2(Number(d.deductedAmount) || 0);
        d.sourceType = getDeductionSourceType(d);
        d.previousBalance = runningBal;
        runningBal = Math.max(0, round2(runningBal - cut));
        d.remainingBalance = runningBal;
        totalDeducted = round2(totalDeducted + cut);
      });

      adv.recoveredAmount = totalDeducted;
      adv.balanceAmount = Math.max(0, round2((Number(adv.amount) || 0) - totalDeducted));
      adv.deductions = list;
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

    Object.keys(remoteTombstones).forEach(function(k) {
      if (remoteTombstones[k]) state.tombstones[k] = remoteTombstones[k];
    });

    state.advances = (state.advances || []).filter(function(a) {
      return a && a.id && !state.tombstones[a.id];
    });

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

    state.deductions = (state.deductions || []).filter(function(d) {
      return !isDeductionTombstoned(d);
    });

    var dedMap = {};
    (state.deductions || []).forEach(function(d) {
      if (d && d.id) dedMap[d.id] = d;
    });

    remoteDeductions.forEach(function(rd) {
      if (!rd || !rd.id || isDeductionTombstoned(rd)) return;
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
          version: 3,
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

    window.addEventListener('focus', function() {
      fetchRemoteAdvances(false);
    });
    document.addEventListener('visibilitychange', function() {
      if (!document.hidden) {
        fetchRemoteAdvances(false);
      }
    });

    if (typeof setInterval === 'function') {
      setInterval(function() {
        if (typeof document !== 'undefined' && !document.hidden) {
          fetchRemoteAdvances(false);
        }
      }, 25000);
    }

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

  // ── 4. ADVANCE & MANUAL DEDUCTION RECORD MANAGEMENT ──
  function addOrUpdateAdvance(payload) {
    var emp = findEmployeeByCode(payload.empCode);
    var empName = payload.empName || (emp ? emp.name : 'Unknown');
    var amount = round2(Number(payload.amount));
    if (!payload.empCode || !amount || amount <= 0) {
      if (window.showToast) window.showToast('⚠️ Please enter a valid Employee Code and positive Advance Amount.');
      return false;
    }

    var now = new Date().toISOString();
    var recordId = payload.id || ('adv_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7));
    var existingIdx = state.advances.findIndex(function(a) { return a.id === recordId; });

    var existing = existingIdx >= 0 ? state.advances[existingIdx] : null;
    var recovered = existing ? round2(Number(existing.recoveredAmount) || 0) : 0;
    var balance = Math.max(0, round2(amount - recovered));
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

    if (state.tombstones && state.tombstones[recordId]) {
      delete state.tombstones[recordId];
    }

    recalculateAllBalances();
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
    state.advances.splice(idx, 1);

    state.tombstones[id] = new Date().toISOString();
    state.deductions = (state.deductions || []).filter(function(d) {
      if (d && d.advanceId === id) {
        if (d.id) state.tombstones['ded:' + d.id] = state.tombstones[id];
        return false;
      }
      return true;
    });

    recalculateAllBalances();
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

  /**
   * Manual Advance Deduction: Allows cutting any positive amount up to the selected advance or total
   * employee outstanding balance (FIFO if advanceId is omitted or 'AUTO').
   */
  function deductAdvanceManually(payload) {
    payload = payload || {};
    var empCodeRaw = String(payload.empCode || '').trim();
    var normCode = normalizeCode(empCodeRaw);
    var amount = round2(Number(payload.amount));
    if (!normCode || !amount || amount <= 0) {
      if (window.showToast) window.showToast('⚠️ Enter a valid Employee Code and positive Manual Deduction amount.');
      return { ok: false, error: 'INVALID_INPUT', deductions: [] };
    }

    var targetAdvId = payload.advanceId && payload.advanceId !== 'AUTO' ? String(payload.advanceId) : null;
    var activeAdvances = (state.advances || []).filter(function(adv) {
      if (!adv || (Number(adv.balanceAmount) || 0) <= 0) return false;
      if (targetAdvId) return adv.id === targetAdvId && normalizeCode(adv.empCode) === normCode;
      return normalizeCode(adv.empCode) === normCode;
    }).sort(function(a, b) {
      return (Date.parse(a.advanceDate || a.createdAt || 0) || 0) - (Date.parse(b.advanceDate || b.createdAt || 0) || 0);
    });

    if (!activeAdvances.length) {
      if (window.showToast) window.showToast('⚠️ No active advance balance found for Employee ' + empCodeRaw + '.');
      return { ok: false, error: 'NO_ACTIVE_ADVANCE', deductions: [] };
    }

    var totalAvailable = round2(activeAdvances.reduce(function(sum, a) {
      return sum + (Number(a.balanceAmount) || 0);
    }, 0));

    if (amount > totalAvailable + 0.001) {
      if (window.showToast) window.showToast('⚠️ Manual deduction ' + formatINR(amount) + ' exceeds outstanding balance ' + formatINR(totalAvailable) + '.');
      return { ok: false, error: 'EXCEEDS_BALANCE', available: totalAvailable, deductions: [] };
    }

    var emp = findEmployeeByCode(empCodeRaw);
    var dedDate = payload.deductionDate && /^\d{4}-\d{2}-\d{2}$/.test(String(payload.deductionDate).trim())
      ? String(payload.deductionDate).trim()
      : new Date().toISOString().slice(0, 10);
    var nowIso = new Date().toISOString();
    var timestampIso = dedDate + 'T' + nowIso.slice(11);
    var mode = String(payload.mode || 'Manual Cash Recovery').trim();
    var remarks = String(payload.remarks || '').trim();
    var periodLabel = formatMonthYearFromDate(dedDate);

    var remainingToCut = amount;
    var created = [];

    for (var i = 0; i < activeAdvances.length && remainingToCut > 0; i++) {
      var adv = activeAdvances[i];
      var outBal = round2(Number(adv.balanceAmount) || 0);
      if (outBal <= 0) continue;
      var cut = Math.min(outBal, remainingToCut);
      cut = round2(cut);
      if (cut <= 0) continue;

      var dedRec = {
        id: 'ded_man_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
        advanceId: adv.id,
        empCode: adv.empCode,
        empName: adv.empName || (emp ? emp.name : ('Emp ' + empCodeRaw)),
        sourceType: 'manual',
        deductionMode: mode,
        fileName: 'Manual Deduction (' + mode + ')',
        sheetName: 'Manual Entry',
        columnName: mode,
        salaryMonth: periodLabel,
        remarks: remarks,
        previousBalance: outBal,
        deductedAmount: cut,
        remainingBalance: round2(outBal - cut),
        deductionDate: dedDate,
        date: timestampIso
      };

      state.deductions.push(dedRec);
      adv.updatedAt = nowIso;
      created.push(dedRec);
      remainingToCut = round2(remainingToCut - cut);
    }

    if (created.length > 0) {
      recalculateAllBalances();
      saveToLocal();
      renderUI();

      var lastDed = created[created.length - 1];
      pushDeductionRemote(lastDed).then(function(res) {
        if (window.showToast) {
          if (res && res.ok) {
            window.showToast('✅ Manual deduction of ' + formatINR(amount) + ' for ' + created[0].empName + ' saved & synced!');
          } else {
            window.showToast('⚠️ Manual deduction of ' + formatINR(amount) + ' saved locally. Cloud sync pending retry.');
          }
        }
      });
    }

    return { ok: created.length > 0, deductions: created };
  }

  function deleteDeduction(deductionId) {
    if (!deductionId) return false;
    var idx = (state.deductions || []).findIndex(function(d) { return d && d.id === deductionId; });
    if (idx < 0) return false;
    var removed = state.deductions.splice(idx, 1)[0];

    var nowIso = new Date().toISOString();
    state.tombstones['ded:' + deductionId] = nowIso;

    var parentAdv = (state.advances || []).find(function(a) { return a && a.id === removed.advanceId; });
    if (parentAdv) parentAdv.updatedAt = nowIso;

    recalculateAllBalances();
    saveToLocal();
    renderUI();

    if (state.openHistoryEmpCode) {
      viewEmployeeHistory(state.openHistoryEmpCode);
    }

    pushAuthoritativeToCloud().then(function(res) {
      broadcastSync('advance_deduction_deleted', { id: deductionId });
      if (window.showToast) {
        if (res && res.ok) {
          window.showToast('↩️ Deduction entry reversed & synced to cloud.');
        } else {
          window.showToast('↩️ Deduction reversed locally. Cloud sync pending retry.');
        }
      }
    });
    return true;
  }

  function confirmDeleteDeduction(deductionId) {
    var d = (state.deductions || []).find(function(x) { return x && x.id === deductionId; });
    if (!d) return;
    var label = getDeductionSourceType(d) === 'manual' ? 'Manual Deduction' : 'Salary Sheet Deduction';
    if (confirm('Reverse/Delete this ' + label + ' of ' + formatINR(d.deductedAmount) + ' for ' + d.empName + ' (' + d.empCode + ')?\nBalance will automatically increase back.')) {
      deleteDeduction(deductionId);
    }
  }

  function getEmployeeOutstandingBalance(empCode) {
    var norm = normalizeCode(empCode);
    var total = 0;
    (state.advances || []).forEach(function(adv) {
      if (normalizeCode(adv.empCode) === norm) {
        total += (Number(adv.balanceAmount) || 0);
      }
    });
    return round2(total);
  }

  function getEmployeeHistoryData(empCode) {
    var norm = normalizeCode(empCode);
    var empAdv = (state.advances || []).filter(function(a) {
      return a && normalizeCode(a.empCode) === norm;
    }).sort(function(a, b) {
      return (Date.parse(b.advanceDate || b.createdAt || 0) || 0) - (Date.parse(a.advanceDate || a.createdAt || 0) || 0);
    });

    var empDed = (state.deductions || []).filter(function(d) {
      return d && normalizeCode(d.empCode) === norm && !isDeductionTombstoned(d);
    }).sort(function(a, b) {
      var ta = Date.parse(b.deductionDate || b.date || 0) || 0;
      var tb = Date.parse(a.deductionDate || a.date || 0) || 0;
      if (ta !== tb) return ta - tb;
      return String(b.id || '').localeCompare(String(a.id || ''));
    });

    var masterEmp = findEmployeeByCode(empCode);
    var empName = (masterEmp && masterEmp.name) || (empAdv[0] && empAdv[0].empName) || (empDed[0] && empDed[0].empName) || ('Employee ' + empCode);
    var displayCode = (masterEmp && masterEmp.code) || (empAdv[0] && empAdv[0].empCode) || (empDed[0] && empDed[0].empCode) || String(empCode || '');

    var totalGiven = 0;
    var totalSalaryCut = 0;
    var totalManualCut = 0;
    var totalRemaining = 0;

    empAdv.forEach(function(a) {
      totalGiven = round2(totalGiven + (Number(a.amount) || 0));
      totalRemaining = round2(totalRemaining + (Number(a.balanceAmount) || 0));
    });
    empDed.forEach(function(d) {
      var amt = Number(d.deductedAmount) || 0;
      if (getDeductionSourceType(d) === 'manual') totalManualCut = round2(totalManualCut + amt);
      else totalSalaryCut = round2(totalSalaryCut + amt);
    });

    return {
      empCode: displayCode,
      empName: empName,
      dept: masterEmp ? masterEmp.dept : '',
      desig: masterEmp ? masterEmp.desig : '',
      advances: empAdv,
      deductions: empDed,
      totalGiven: totalGiven,
      totalSalaryCut: totalSalaryCut,
      totalManualCut: totalManualCut,
      totalRecovered: round2(totalSalaryCut + totalManualCut),
      totalRemaining: totalRemaining
    };
  }

  // ── 5. STRICT SALARY SHEET & ADVANCE COLUMN ENGINE ──
  function cleanHeader(val) {
    return String(val == null ? '' : val)
      .toLowerCase()
      .replace(/[._\-\/()\[\]:]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function findHeaderRowSafe(sheetData) {
    if (!Array.isArray(sheetData) || !sheetData.length) return 0;
    var bestIdx = 0;
    var maxScore = -1;
    var KEYWORDS = [
      'emp', 'code', 'name', 'basic', 'gross', 'salary', 'pf', 'esi',
      'days', 'dept', 'desig', 'total', 'payable', 'net', 'advance', 'adv', 'deduction'
    ];
    var maxSearch = Math.min(25, sheetData.length);
    for (var i = 0; i < maxSearch; i++) {
      var row = sheetData[i];
      if (!Array.isArray(row)) continue;
      var nonEmpty = 0;
      var rowTokens = [];
      for (var c = 0; c < row.length; c++) {
        var cellStr = String(row[c] == null ? '' : row[c]).trim();
        if (cellStr) nonEmpty++;
        rowTokens.push(cleanHeader(cellStr));
      }
      if (nonEmpty < 2) continue;
      var rowStr = ' ' + rowTokens.join(' ') + ' ';
      var score = 0;
      KEYWORDS.forEach(function(kw) {
        if (rowStr.indexOf(kw) >= 0) score++;
      });
      if ((rowStr.indexOf('emp') >= 0 || rowStr.indexOf(' code ') >= 0) &&
          (rowStr.indexOf('name') >= 0 || rowStr.indexOf('basic') >= 0 || rowStr.indexOf('advance') >= 0 || rowStr.indexOf('adv') >= 0 || rowStr.indexOf('net') >= 0)) {
        score += 3;
      }
      if (score > maxScore) {
        maxScore = score;
        bestIdx = i;
      }
    }
    return bestIdx;
  }

  function buildCleanAndMergedHeaders(sheetData, hdrIdx) {
    var rawHdr = Array.isArray(sheetData[hdrIdx]) ? sheetData[hdrIdx].slice() : [];
    var mergedHdr = rawHdr.map(function(v) { return String(v == null ? '' : v).trim(); });
    if (hdrIdx > 0 && Array.isArray(sheetData[hdrIdx - 1])) {
      var prevRow = sheetData[hdrIdx - 1];
      var prevStr = prevRow.join(' ').toLowerCase();
      if (prevStr.indexOf('earning') >= 0 || prevStr.indexOf('deduction') >= 0 || prevStr.indexOf('salary') >= 0 || prevStr.indexOf('recovery') >= 0) {
        var maxLen = Math.max(prevRow.length, rawHdr.length);
        var lastPrefix = '';
        for (var c = 0; c < maxLen; c++) {
          var top = String(prevRow[c] == null ? '' : prevRow[c]).trim();
          if (top) lastPrefix = top;
          var bot = String(rawHdr[c] == null ? '' : rawHdr[c]).trim();
          mergedHdr[c] = bot
            ? (lastPrefix && bot.toLowerCase().indexOf(lastPrefix.toLowerCase()) < 0 ? (lastPrefix + ' ' + bot) : bot)
            : top;
        }
      }
    }
    return { rawHdr: rawHdr, mergedHdr: mergedHdr };
  }

  var ADV_EXACT_DED_ALIASES = [
    'advance deduction', 'adv deduction', 'adv ded', 'advance ded',
    'advance recovery', 'adv recovery', 'less advance', 'deduct advance',
    'advance cut', 'adv cut', 'deduction advance', 'deductions advance',
    'salary advance deduction', 'staff advance deduction', 'emp advance deduction'
  ];

  var ADV_STANDARD_ALIASES = [
    'advance', 'adv', 'salary advance', 'staff advance', 'emp advance',
    'employee advance', 'advance amt', 'advance amount', 'adv amt',
    'adv amount', 'advance pay', 'deductions adv', 'deduction adv'
  ];

  var ADV_REJECT_WORDS = [
    'balance', 'bal', 'opening', 'closing', 'remaining', 'pending',
    'rule', 'mode', 'date', 'given', 'disbursed', 'recovered',
    'status', 'cap', 'limit', 'installment', 'prev', 'previous',
    'remark', 'reason', 'loan', 'voucher', 'ref'
  ];

  function hasWord(str, word) {
    return new RegExp('(?:^|\\s)' + word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:$|\\s)').test(str);
  }

  function isExcludedAdvanceHeader(hNorm) {
    if (!hNorm) return true;
    for (var i = 0; i < ADV_REJECT_WORDS.length; i++) {
      if (hasWord(hNorm, ADV_REJECT_WORDS[i])) return true;
    }
    return false;
  }

  function detectAdvanceSheetInfo(sheetName, sheetData, fileName) {
    if (!Array.isArray(sheetData) || sheetData.length < 2) {
      return { valid: false, reason: 'EMPTY_SHEET' };
    }

    var snl = String(sheetName || '').toLowerCase().trim();
    var fnl = String(fileName || '').toLowerCase().trim();

    if (fnl.indexOf('advance_management') >= 0 || fnl.endsWith('.json') || fnl.indexOf('atpl_employee_advances') >= 0) {
      return { valid: false, reason: 'INTERNAL_OR_EXPORT_FILE' };
    }

    var hardSkipSheets = [
      'bank', 'hdfc', 'sbi', 'non sbi', 'non hdfc', 'neft', 'rtgs', 'transfer',
      'payment advice', 'attendance', 'attandance', 'rule audit', 'report notes',
      'missing', 'summary', 'abstract', 'consolidated', 'card', 'id card',
      'employee master', 'emp master', 'advance register', 'advance ledger', 'advance list'
    ];
    for (var s = 0; s < hardSkipSheets.length; s++) {
      if (snl.indexOf(hardSkipSheets[s]) >= 0) {
        return { valid: false, reason: 'NON_SALARY_SHEET_NAME' };
      }
    }

    var hdrIdx = findHeaderRowSafe(sheetData);
    var hdrObj = buildCleanAndMergedHeaders(sheetData, hdrIdx);
    var rawHdr = hdrObj.rawHdr;
    var mergedHdr = hdrObj.mergedHdr;
    if (!rawHdr.length) return { valid: false, reason: 'NO_HEADERS' };

    var empCodeCol = -1;
    var empNameCol = -1;
    var advCol = -1;
    var advHeaderDisplay = '';
    var payrollColCount = 0;
    var advLedgerMarkerCount = 0;

    var CODE_EXACT = [
      'emp code', 'employee code', 'emp id', 'employee id', 'emp no',
      'employee no', 'staff code', 'worker code', 'token no', 'badli no',
      'code', 'id no'
    ];
    var NAME_EXACT = [
      'name of employee', 'employee name', 'emp name', 'worker name', 'staff name', 'name', 'karamchari'
    ];
    var PAYROLL_MARKERS = [
      'basic', 'gross', 'total gross', 'gross salary', 'gross total salary',
      'net', 'net pay', 'net payable', 'net payment', 'net salary', 'payable',
      'paid days', 'working days', 'p days', 'wd', 'pf', 'epf', 'esic', 'esi',
      'manual amount', 'manual amt', 'hra', 'bonus', 'total deduction', 'total ded',
      'earned', 'wages', 'salary', 'ptax', 'diff amount', 'overtime', 'ot amt', 'ot hours'
    ];

    for (var c = 0; c < rawHdr.length; c++) {
      var hRaw = cleanHeader(rawHdr[c]);
      var hMerged = cleanHeader(mergedHdr[c]);
      var checkList = hMerged && hMerged !== hRaw ? [hRaw, hMerged] : [hRaw];

      // Emp Code column
      if (empCodeCol < 0 && hRaw) {
        var isBadCode = hasWord(hRaw, 'pf') || hasWord(hRaw, 'esi') || hasWord(hRaw, 'esic') ||
                        hasWord(hRaw, 'uan') || hasWord(hRaw, 'account') || hasWord(hRaw, 'ifsc') ||
                        hasWord(hRaw, 'aadhaar') || hasWord(hRaw, 'aadhar') || hasWord(hRaw, 'phone') ||
                        hasWord(hRaw, 'mobile') || hRaw === 's no' || hRaw === 'sr no' || hRaw === 'sl no' || hRaw === 'serial';
        if (!isBadCode) {
          if (CODE_EXACT.indexOf(hRaw) >= 0) {
            empCodeCol = c;
          } else if (hRaw === 'id' || hRaw.indexOf('emp code') >= 0 || hRaw.indexOf('employee code') >= 0 || hRaw.indexOf('employee id') >= 0 || hRaw.indexOf('emp id') >= 0) {
            empCodeCol = c;
          }
        }
      }

      // Emp Name column
      if (empNameCol < 0 && hRaw) {
        var isBadName = hasWord(hRaw, 'father') || hasWord(hRaw, 'husband') || hasWord(hRaw, 'bank') ||
                        hasWord(hRaw, 'company') || hasWord(hRaw, 'sheet') || hasWord(hRaw, 'file') ||
                        hasWord(hRaw, 'dept') || hasWord(hRaw, 'department');
        if (!isBadName && NAME_EXACT.indexOf(hRaw) >= 0) {
          empNameCol = c;
        }
      }

      // Advance ledger export anti-markers
      if (hasWord(hRaw, 'recovered') || hasWord(hRaw, 'outstanding') || hRaw === 'monthly cap' || hRaw === 'remaining balance') {
        advLedgerMarkerCount++;
      }

      // Payroll context marker check
      for (var p = 0; p < PAYROLL_MARKERS.length; p++) {
        var pm = PAYROLL_MARKERS[p];
        if (hRaw === pm || hasWord(hRaw, pm) || (hMerged && hasWord(hMerged, pm))) {
          if (!hasWord(hRaw, 'pf no') && !hasWord(hRaw, 'esi no') && !hasWord(hRaw, 'uan')) {
            payrollColCount++;
            break;
          }
        }
      }

      // Tier 1 strict advance deduction column match
      for (var t1 = 0; t1 < checkList.length; t1++) {
        var cand1 = checkList[t1];
        if (!cand1 || isExcludedAdvanceHeader(cand1)) continue;
        if (ADV_EXACT_DED_ALIASES.indexOf(cand1) >= 0) {
          advCol = c;
          advHeaderDisplay = String(rawHdr[c] || mergedHdr[c] || 'Advance Deduction').trim();
          break;
        }
      }
    }

    // Fallback Emp Code / Emp Name broader match if exact wasn't found
    if (empCodeCol < 0) {
      for (var c2 = 0; c2 < rawHdr.length; c2++) {
        var hc = cleanHeader(rawHdr[c2]);
        if (!hc) continue;
        if (hasWord(hc, 'pf') || hasWord(hc, 'esi') || hasWord(hc, 'esic') || hasWord(hc, 'uan') || hasWord(hc, 'bank') || hasWord(hc, 'ifsc') || hasWord(hc, 'account') || hasWord(hc, 'aadhaar') || hasWord(hc, 'phone') || hasWord(hc, 'mobile') || hc === 's no' || hc === 'sr no') continue;
        if (hasWord(hc, 'emp') || hasWord(hc, 'code') || hasWord(hc, 'token') || hasWord(hc, 'badli')) {
          empCodeCol = c2;
          break;
        }
      }
    }
    if (empNameCol < 0) {
      for (var c3 = 0; c3 < rawHdr.length; c3++) {
        var hn = cleanHeader(rawHdr[c3]);
        if (!hn || c3 === empCodeCol) continue;
        if (hasWord(hn, 'father') || hasWord(hn, 'bank') || hasWord(hn, 'dept') || hasWord(hn, 'department')) continue;
        if (hasWord(hn, 'name') || hasWord(hn, 'karamchari')) {
          empNameCol = c3;
          break;
        }
      }
    }

    // Tier 2 standard advance deduction column match (only if Tier 1 didn't match)
    if (advCol < 0) {
      for (var c4 = 0; c4 < rawHdr.length; c4++) {
        var hr = cleanHeader(rawHdr[c4]);
        var hm = cleanHeader(mergedHdr[c4]);
        var list2 = hm && hm !== hr ? [hr, hm] : [hr];
        var matchedTier2 = false;
        for (var j2 = 0; j2 < list2.length; j2++) {
          var cand2 = list2[j2];
          if (!cand2 || isExcludedAdvanceHeader(cand2)) continue;
          if (ADV_STANDARD_ALIASES.indexOf(cand2) >= 0) {
            advCol = c4;
            advHeaderDisplay = String(rawHdr[c4] || mergedHdr[c4] || 'Advance').trim();
            matchedTier2 = true;
            break;
          }
        }
        if (matchedTier2) break;
      }
    }

    // Tier 3 prefixed/word-safe deduction match (e.g. "ded advance", "adv ded rs", "advance salary ded")
    if (advCol < 0) {
      for (var c5 = 0; c5 < rawHdr.length; c5++) {
        var hr3 = cleanHeader(rawHdr[c5]);
        var hm3 = cleanHeader(mergedHdr[c5]);
        var list3 = hm3 && hm3 !== hr3 ? [hr3, hm3] : [hr3];
        var matchedTier3 = false;
        for (var j3 = 0; j3 < list3.length; j3++) {
          var cand3 = list3[j3];
          if (!cand3 || isExcludedAdvanceHeader(cand3)) continue;
          if ((hasWord(cand3, 'advance') || hasWord(cand3, 'adv')) &&
              (hasWord(cand3, 'ded') || hasWord(cand3, 'deduction') || hasWord(cand3, 'deductions') || hasWord(cand3, 'cut') || hasWord(cand3, 'recovery') || hasWord(cand3, 'less') || hasWord(cand3, 'amt') || hasWord(cand3, 'amount') || hasWord(cand3, 'rs'))) {
            advCol = c5;
            advHeaderDisplay = String(rawHdr[c5] || mergedHdr[c5] || 'Advance').trim();
            matchedTier3 = true;
            break;
          }
        }
        if (matchedTier3) break;
      }
    }

    if (empCodeCol < 0) return { valid: false, reason: 'NO_EMP_CODE_COL' };
    if (advCol < 0) return { valid: false, reason: 'NO_ADVANCE_COL' };
    if (advLedgerMarkerCount >= 2 && payrollColCount === 0) {
      return { valid: false, reason: 'ADVANCE_REGISTER_EXPORT' };
    }
    if ((snl === 'advance' || snl === 'adv' || snl === 'advances') && payrollColCount === 0) {
      return { valid: false, reason: 'NON_PAYROLL_ADVANCE_SHEET' };
    }
    var sheetOrFileHasSalary = /(salary|salaries|payroll|fourmala|formula|manisha|wages|staff)/i.test(snl + ' ' + fnl);
    if (payrollColCount === 0 && !sheetOrFileHasSalary) {
      return { valid: false, reason: 'NO_SALARY_CONTEXT' };
    }

    return {
      valid: true,
      sheetName: sheetName,
      hdrIdx: hdrIdx,
      empCodeCol: empCodeCol,
      empNameCol: empNameCol,
      advCol: advCol,
      advHeaderDisplay: advHeaderDisplay || 'Advance',
      payrollColCount: payrollColCount
    };
  }

  function getSheetPriorityScore(sheetName) {
    var snl = String(sheetName || '').toLowerCase().trim();
    if (snl.indexOf('fourmala') >= 0 || snl.indexOf('formula') >= 0) return 100;
    if (snl.indexOf('manisha') >= 0 || snl.indexOf('manisah') >= 0) return 95;
    if (snl === 'salary sheet' || snl === 'main sheet' || snl === 'salaries' || snl === 'salary details') return 90;
    if (snl.indexOf('salary') >= 0 || snl.indexOf('payroll') >= 0) return 80;
    if (snl === 'staff' || snl === 'non staff') return 70;
    if (snl === 'sheet1' || snl === 'data') return 50;
    if (snl.indexOf('category') >= 0 || snl.indexOf('department wise') >= 0 || snl.indexOf('dept wise') >= 0 || snl.indexOf('cash payment') >= 0) return 10;
    return 40;
  }

  function extractWorkbookSheets(fileObj) {
    var list = [];
    var seen = {};
    if (fileObj.sheets && typeof fileObj.sheets === 'object') {
      Object.keys(fileObj.sheets).forEach(function(sn) {
        var rows = fileObj.sheets[sn];
        if (Array.isArray(rows) && rows.length >= 2) {
          seen[sn] = true;
          list.push({ sheetName: sn, rows: rows });
        }
      });
    }
    if (fileObj.wb && Array.isArray(fileObj.wb.SheetNames) && fileObj.wb.Sheets && window.XLSX && window.XLSX.utils && typeof window.XLSX.utils.sheet_to_json === 'function') {
      fileObj.wb.SheetNames.forEach(function(sn) {
        if (seen[sn]) return;
        try {
          var ws = fileObj.wb.Sheets[sn];
          if (!ws) return;
          var rows = window.XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true });
          if (Array.isArray(rows) && rows.length >= 2) {
            seen[sn] = true;
            list.push({ sheetName: sn, rows: rows });
          }
        } catch (_) {}
      });
    }
    return list.sort(function(a, b) {
      return getSheetPriorityScore(b.sheetName) - getSheetPriorityScore(a.sheetName);
    });
  }

  function detectSalaryMonthFromFilename(fileName, sheetName) {
    var fn = String(fileName || '').toLowerCase() + ' ' + String(sheetName || '').toLowerCase();
    var months = [
      'january', 'february', 'march', 'april', 'may', 'june',
      'july', 'august', 'september', 'october', 'november', 'december'
    ];
    var shortMonths = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec'];
    var shortToFullIdx = [0, 1, 2, 3, 4, 5, 6, 7, 8, 8, 9, 10, 11];

    var foundMonth = '';
    for (var i = 0; i < months.length; i++) {
      if (new RegExp('(?:^|[^a-z])' + months[i] + '(?:[^a-z]|$)').test(fn)) {
        foundMonth = months[i].charAt(0).toUpperCase() + months[i].slice(1);
        break;
      }
    }
    if (!foundMonth) {
      for (var j = 0; j < shortMonths.length; j++) {
        if (new RegExp('(?:^|[^a-z])' + shortMonths[j] + '(?:[^a-z]|$)').test(fn)) {
          var fullM = months[shortToFullIdx[j]];
          foundMonth = fullM.charAt(0).toUpperCase() + fullM.slice(1);
          break;
        }
      }
    }

    var yearMatch = fn.match(/202[0-9]/);
    var year = yearMatch ? yearMatch[0] : new Date().getFullYear();

    if (foundMonth) {
      return foundMonth + ' ' + year;
    }
    return 'Salary Period (' + fileName + ')';
  }

  /**
   * Scans an uploaded or loaded salary workbook across all sheets.
   * ONLY processes salary sheets that have an explicit Advance deduction column,
   * and deducts the exact advance cut specified in that column for each employee.
   */
  function processSalaryFile(fileObj) {
    if (!fileObj || !fileObj.name) return { processed: 0, deductions: [] };
    var fileName = String(fileObj.name);
    var cleanFileName = fileName.trim().toLowerCase();

    var candidateSheets = extractWorkbookSheets(fileObj);
    if (!candidateSheets.length) {
      return { processed: 0, deductions: [] };
    }

    var deductionsMade = [];
    var processedEmpInFile = {};
    var nowIso = new Date().toISOString();
    var dedDate = nowIso.slice(0, 10);

    for (var sIdx = 0; sIdx < candidateSheets.length; sIdx++) {
      var sEntry = candidateSheets[sIdx];
      var sheetInfo = detectAdvanceSheetInfo(sEntry.sheetName, sEntry.rows, fileName);
      if (!sheetInfo.valid) continue;

      var sheetData = sEntry.rows;
      var salaryMonth = detectSalaryMonthFromFilename(fileName, sEntry.sheetName);

      for (var r = sheetInfo.hdrIdx + 1; r < sheetData.length; r++) {
        var row = sheetData[r];
        if (!Array.isArray(row) || !row.length) continue;

        var rawCode = row[sheetInfo.empCodeCol];
        if (rawCode == null || String(rawCode).trim() === '') continue;
        var cleanCode = String(rawCode).trim().replace(/\.0+$/, '');
        var normCode = normalizeCode(cleanCode);
        if (!normCode || normCode === 'total' || normCode === 'grand' || normCode === 'grandtotal' || normCode === 'subtotal') continue;

        // Avoid double-cutting the same employee from secondary summary tabs within the same workbook
        if (processedEmpInFile[normCode]) continue;

        // Read exact advance amount from this sheet's matched Advance column
        var sheetAdvAmt = round2(parseMoney(row[sheetInfo.advCol]));
        if (!sheetAdvAmt || sheetAdvAmt <= 0) continue;

        // Idempotency: if this employee already has a salary deduction recorded from this fileName, skip
        var alreadyDeductedForFile = (state.deductions || []).some(function(d) {
          if (!d || isDeductionTombstoned(d) || getDeductionSourceType(d) === 'manual') return false;
          var dFile = String(d.fileName || '').trim().toLowerCase();
          return dFile === cleanFileName && normalizeCode(d.empCode) === normCode;
        });
        if (alreadyDeductedForFile) {
          processedEmpInFile[normCode] = true;
          continue;
        }

        var empRowName = sheetInfo.empNameCol >= 0 ? String(row[sheetInfo.empNameCol] || '').trim() : '';

        var activeAdvances = (state.advances || []).filter(function(adv) {
          return adv && !(state.tombstones && state.tombstones[adv.id]) &&
                 normalizeCode(adv.empCode) === normCode &&
                 (Number(adv.balanceAmount) || 0) > 0;
        }).sort(function(a, b) {
          return (Date.parse(a.advanceDate || a.createdAt || 0) || 0) - (Date.parse(b.advanceDate || b.createdAt || 0) || 0);
        });

        if (!activeAdvances.length) continue;

        var remainingFromSheet = sheetAdvAmt;
        for (var aIdx = 0; aIdx < activeAdvances.length && remainingFromSheet > 0; aIdx++) {
          var adv = activeAdvances[aIdx];
          var outBal = round2(Number(adv.balanceAmount) || 0);
          if (outBal <= 0) continue;

          var deductible = round2(Math.min(remainingFromSheet, outBal));
          if (deductible <= 0) continue;

          var dedRec = {
            id: 'ded_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
            advanceId: adv.id,
            empCode: adv.empCode,
            empName: adv.empName || empRowName || ('Emp ' + cleanCode),
            sourceType: 'salary',
            fileName: fileName,
            sheetName: sEntry.sheetName,
            columnName: sheetInfo.advHeaderDisplay,
            sheetAdvanceAmount: sheetAdvAmt,
            salaryMonth: salaryMonth,
            previousBalance: outBal,
            deductedAmount: deductible,
            remainingBalance: round2(outBal - deductible),
            deductionDate: dedDate,
            date: nowIso
          };

          state.deductions.push(dedRec);
          deductionsMade.push(dedRec);

          adv.recoveredAmount = round2((Number(adv.recoveredAmount) || 0) + deductible);
          adv.balanceAmount = Math.max(0, round2((Number(adv.amount) || 0) - adv.recoveredAmount));
          adv.status = adv.balanceAmount <= 0 ? 'REPAID' : 'PARTIAL';
          adv.updatedAt = nowIso;
          if (!Array.isArray(adv.deductions)) adv.deductions = [];
          adv.deductions.push(dedRec);

          remainingFromSheet = round2(remainingFromSheet - deductible);
          processedEmpInFile[normCode] = true;
        }
      }
    }

    if (deductionsMade.length > 0) {
      recalculateAllBalances();
      saveToLocal();
      renderUI();
      pushAuthoritativeToCloud();
      if (window.showToast) {
        window.showToast('💰 Deducted advance from salary sheet for ' + deductionsMade.length + ' entry/entries in ' + fileName);
      }
    }

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
          salaryRec: 0,
          manualRec: 0,
          totalBal: 0,
          count: 0,
          dedCount: 0
        };
      }
      empMap[k].totalAdv += amt;
      empMap[k].totalRec += rec;
      empMap[k].totalBal += bal;
      empMap[k].count++;
    });

    var salaryCutTotal = 0;
    var manualCutTotal = 0;
    (state.deductions || []).forEach(function(d) {
      if (!d || isDeductionTombstoned(d)) return;
      var amt = Number(d.deductedAmount) || 0;
      var isMan = getDeductionSourceType(d) === 'manual';
      if (isMan) manualCutTotal += amt;
      else salaryCutTotal += amt;

      var k = normalizeCode(d.empCode);
      if (empMap[k]) {
        empMap[k].dedCount++;
        if (isMan) empMap[k].manualRec += amt;
        else empMap[k].salaryRec += amt;
      }
    });

    var badge = document.getElementById('advBadge');
    if (badge) {
      badge.textContent = activeCount;
      badge.style.display = activeCount > 0 ? 'inline-block' : 'none';
    }

    var html = '<div class="adv-shell" style="padding:18px;min-height:100%;background:#f6f7fb;font-family:system-ui,-apple-system,sans-serif">';

    // 1. Executive Top Header
    html += '<div style="display:flex;justify-content:space-between;gap:20px;align-items:center;flex-wrap:wrap;background:linear-gradient(135deg,#fff,#fbfbff);border:1px solid #e5e7eb;border-radius:14px;padding:19px 20px;box-shadow:0 1px 3px rgba(15,23,42,.04);margin-bottom:12px">';
    html += '  <div>';
    html += '    <div style="font-size:9px;font-weight:900;letter-spacing:1.3px;color:#7c3aed;margin-bottom:5px;text-transform:uppercase">SALARY PAYROLL / ADVANCE &amp; LOAN AUDIT</div>';
    html += '    <div style="font-size:21px;font-weight:850;color:#111827;letter-spacing:-.45px">Advance &amp; Loan Management</div>';
    html += '    <div style="font-size:11px;color:#64748b;margin-top:5px;max-width:760px;line-height:1.6">Arora Textiles ERP · Exact Salary-Sheet Advance Column matching, Manual Advance Deduction aur complete Employee History audit.</div>';
    html += '  </div>';
    html += '  <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">';
    html += '    <button onclick="ATPLAdvanceManager.openNewModal()" style="display:inline-flex;align-items:center;gap:6px;padding:10px 16px;border-radius:9px;background:#312e81;color:#fff;font-size:11px;font-weight:800;border:none;cursor:pointer;box-shadow:0 1px 3px rgba(49,46,129,0.25)">';
    html += '      <span>💳</span> Record New Advance';
    html += '    </button>';
    html += '    <button onclick="ATPLAdvanceManager.openManualDeductionModal()" style="display:inline-flex;align-items:center;gap:6px;padding:10px 15px;border-radius:9px;background:#b45309;color:#fff;font-size:11px;font-weight:800;border:none;cursor:pointer;box-shadow:0 1px 3px rgba(180,83,9,0.25)">';
    html += '      <span>✂️</span> Manual Deduction';
    html += '    </button>';
    html += '    <button onclick="ATPLAdvanceManager.triggerDeductionScan()" style="display:inline-flex;align-items:center;gap:5px;height:34px;border:1px solid #d1d5db;border-radius:8px;background:#fff;padding:0 12px;font-size:10px;font-weight:700;color:#475569;cursor:pointer">';
    html += '      <span>⚡</span> Re-Scan Sheets';
    html += '    </button>';
    html += '    <button onclick="ATPLAdvanceManager.exportDataCSV()" style="display:inline-flex;align-items:center;gap:5px;height:34px;border:1px solid #d1d5db;border-radius:8px;background:#fff;padding:0 12px;font-size:10px;font-weight:700;color:#475569;cursor:pointer">';
    html += '      <span>⬇</span> Export CSV';
    html += '    </button>';
    html += '    <button id="advSyncBtn" onclick="ATPLAdvanceManager.syncNow(true)" style="display:inline-flex;align-items:center;gap:5px;height:34px;border:1px solid #d1d5db;border-radius:8px;background:#fff;padding:0 12px;font-size:10px;font-weight:700;color:#475569;cursor:pointer" title="Sync with Cloud">';
    html += '      <span>🔄</span> Sync';
    html += '    </button>';
    html += '  </div>';
    html += '</div>';

    // 2. Modebar
    html += '<div style="display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:12px;padding:10px 14px;background:#fff;border:1px solid #e5e7eb;border-radius:10px">';
    html += '  <div style="display:flex;flex-direction:column;gap:2px">';
    html += '    <b style="font-size:11px;color:#334155">View Mode</b>';
    html += '    <span style="font-size:9px;color:#94a3b8">Active Advances, All Deductions (Salary + Manual), aur Employee Ledger / History ke beech switch karo</span>';
    html += '  </div>';
    html += '  <div style="display:flex;gap:4px;background:#f3f4f6;padding:3px;border-radius:9px">';
    html += '    <button onclick="ATPLAdvanceManager.setTab(\'advances\')" style="border:0;background:' + (state.activeTab === 'advances' ? '#312e81' : 'transparent') + ';color:' + (state.activeTab === 'advances' ? '#fff' : '#64748b') + ';border-radius:7px;padding:6px 13px;font-size:10px;font-weight:850;cursor:pointer;' + (state.activeTab === 'advances' ? 'box-shadow:0 1px 2px rgba(15,23,42,.12)' : '') + '">₹ Advances Register (' + state.advances.length + ')</button>';
    html += '    <button onclick="ATPLAdvanceManager.setTab(\'deductions\')" style="border:0;background:' + (state.activeTab === 'deductions' ? '#312e81' : 'transparent') + ';color:' + (state.activeTab === 'deductions' ? '#fff' : '#64748b') + ';border-radius:7px;padding:6px 13px;font-size:10px;font-weight:850;cursor:pointer;' + (state.activeTab === 'deductions' ? 'box-shadow:0 1px 2px rgba(15,23,42,.12)' : '') + '">📉 All Deductions (' + state.deductions.length + ')</button>';
    html += '    <button onclick="ATPLAdvanceManager.setTab(\'ledger\')" style="border:0;background:' + (state.activeTab === 'ledger' ? '#312e81' : 'transparent') + ';color:' + (state.activeTab === 'ledger' ? '#fff' : '#64748b') + ';border-radius:7px;padding:6px 13px;font-size:10px;font-weight:850;cursor:pointer;' + (state.activeTab === 'ledger' ? 'box-shadow:0 1px 2px rgba(15,23,42,.12)' : '') + '">👥 Employee Ledger (' + Object.keys(empMap).length + ')</button>';
    html += '  </div>';
    html += '</div>';

    // 3. Status Filebar
    html += '<div style="margin-bottom:12px;display:flex;align-items:center;gap:10px;background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:10px 14px;font-size:10px">';
    html += '  <span style="font-size:18px">💳</span>';
    html += '  <div style="display:flex;flex-direction:column;gap:2px;min-width:0;flex:1">';
    html += '    <b style="color:#334155;font-size:11px">Exact Salary-Column + Manual Advance Deduction Engine Active</b>';
    html += '    <small style="color:#94a3b8;font-size:9px">Sirf wahi salary sheet scan hoti hai jisme explicit Advance column ho · Column ki exact value cut hoti hai · Manual cut aur full Employee History supported</small>';
    html += '  </div>';
    html += '  <span style="font-size:9px;font-weight:900;color:#15803d;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:999px;padding:4px 9px;letter-spacing:0.5px">READY</span>';
    html += '</div>';

    // 4. Metric Statistic Cards
    html += '<div style="display:grid;grid-template-columns:repeat(4,minmax(150px,1fr));gap:10px;margin-bottom:12px">';
    html += '  <div style="background:#fff;border:1px solid #e5e7eb;border-radius:11px;padding:12px 14px;display:flex;flex-direction:column;gap:4px;box-shadow:0 1px 2px rgba(15,23,42,.02)">';
    html += '    <span style="font-size:9px;text-transform:uppercase;letter-spacing:.8px;color:#64748b;font-weight:800">Total Disbursed</span>';
    html += '    <b style="font-size:20px;font-weight:850;color:#111827">' + formatINR(totalDisbursed) + '</b>';
    html += '    <small style="font-size:9px;color:#94a3b8">' + state.advances.length + ' lifetime advances</small>';
    html += '  </div>';
    html += '  <div style="background:#fff;border:1px solid #e5e7eb;border-radius:11px;padding:12px 14px;display:flex;flex-direction:column;gap:4px;box-shadow:0 1px 2px rgba(15,23,42,.02)">';
    html += '    <span style="font-size:9px;text-transform:uppercase;letter-spacing:.8px;color:#64748b;font-weight:800">Total Recovered</span>';
    html += '    <b style="font-size:20px;font-weight:850;color:#15803d">' + formatINR(totalRecovered) + '</b>';
    html += '    <small style="font-size:9px;color:#94a3b8">Sheet: ' + formatINR(salaryCutTotal) + ' · Manual: ' + formatINR(manualCutTotal) + '</small>';
    html += '  </div>';
    html += '  <div style="background:#fff;border:1px solid #fecaca;border-radius:11px;padding:12px 14px;display:flex;flex-direction:column;gap:4px;box-shadow:0 1px 2px rgba(15,23,42,.02)">';
    html += '    <span style="font-size:9px;text-transform:uppercase;letter-spacing:.8px;color:#dc2626;font-weight:800">Outstanding Balance</span>';
    html += '    <b style="font-size:20px;font-weight:850;color:#dc2626">' + formatINR(totalOutstanding) + '</b>';
    html += '    <small style="font-size:9px;color:#ef4444">pending recovery</small>';
    html += '  </div>';
    html += '  <div style="background:#fff;border:1px solid #e5e7eb;border-radius:11px;padding:12px 14px;display:flex;flex-direction:column;gap:4px;box-shadow:0 1px 2px rgba(15,23,42,.02)">';
    html += '    <span style="font-size:9px;text-transform:uppercase;letter-spacing:.8px;color:#64748b;font-weight:800">Active Borrowers</span>';
    html += '    <b style="font-size:20px;font-weight:850;color:#312e81">' + activeCount + '</b>';
    html += '    <small style="font-size:9px;color:#94a3b8">across ' + Object.keys(empMap).length + ' employees with history</small>';
    html += '  </div>';
    html += '</div>';

    // 5. Toolbar
    html += '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;background:#fff;border:1px solid #e5e7eb;border-radius:10px 10px 0 0;padding:11px 14px">';
    html += '  <div style="display:flex;flex-direction:column;gap:2px">';
    html += '    <b style="font-size:11px;color:#334155">' + (state.activeTab === 'advances' ? 'Advances Register &amp; Active Dues' : state.activeTab === 'deductions' ? 'Salary &amp; Manual Deduction Audit' : 'Employee Balance Ledger &amp; History') + '</b>';
    html += '    <small style="font-size:9px;color:#94a3b8">Verified records · Click Employee History on any row to view full Salary Sheet + Manual deduction audit</small>';
    html += '  </div>';
    html += '  <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">';
    html += '    <input type="text" id="advSearchInput" placeholder="🔍 Search employee code, name..." value="' + esc(state.searchQuery) + '" oninput="ATPLAdvanceManager.setSearch(this.value)" style="height:32px;padding:0 12px;background:#fff;border:1px solid #d1d5db;border-radius:7px;color:#111827;font-size:11px;outline:none;min-width:220px">';
    if (state.activeTab === 'advances') {
      html += '    <select onchange="ATPLAdvanceManager.setStatusFilter(this.value)" style="height:32px;border:1px solid #d1d5db;border-radius:7px;background:#fff;padding:0 10px;font-size:10px;font-weight:700;color:#475569;cursor:pointer">';
      html += '      <option value="ALL"' + (state.statusFilter === 'ALL' ? ' selected' : '') + '>All statuses</option>';
      html += '      <option value="ACTIVE"' + (state.statusFilter === 'ACTIVE' ? ' selected' : '') + '>Active dues only</option>';
      html += '      <option value="PARTIAL"' + (state.statusFilter === 'PARTIAL' ? ' selected' : '') + '>Partial repaid</option>';
      html += '      <option value="REPAID"' + (state.statusFilter === 'REPAID' ? ' selected' : '') + '>Fully repaid only</option>';
      html += '    </select>';
    } else if (state.activeTab === 'deductions') {
      html += '    <select onchange="ATPLAdvanceManager.setDeductionSourceFilter(this.value)" style="height:32px;border:1px solid #d1d5db;border-radius:7px;background:#fff;padding:0 10px;font-size:10px;font-weight:700;color:#475569;cursor:pointer">';
      html += '      <option value="ALL"' + (state.deductionSourceFilter === 'ALL' ? ' selected' : '') + '>All Cut Types (Salary + Manual)</option>';
      html += '      <option value="salary"' + (state.deductionSourceFilter === 'salary' ? ' selected' : '') + '>📄 Salary Sheet Only</option>';
      html += '      <option value="manual"' + (state.deductionSourceFilter === 'manual' ? ' selected' : '') + '>✍️ Manual Deduction Only</option>';
      html += '    </select>';
    }
    html += '  </div>';
    html += '</div>';

    // 6. Table Body Container
    html += '<div style="background:#fff;border:1px solid #e5e7eb;border-top:0;border-radius:0 0 10px 10px;overflow:hidden;box-shadow:0 1px 3px rgba(15,23,42,.02)">';
    if (state.activeTab === 'advances') {
      html += renderAdvancesTable();
    } else if (state.activeTab === 'deductions') {
      html += renderDeductionsTable();
    } else if (state.activeTab === 'ledger') {
      html += renderLedgerTable(empMap);
    }
    html += '</div>';

    html += '</div>';

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
      return '<div style="padding:48px 20px;text-align:center;color:#94a3b8;background:#fff">' +
             '  <div style="font-size:36px;margin-bottom:8px;opacity:0.4">💳</div>' +
             '  <div style="font-size:14px;font-weight:700;color:#334155">No Advance Records Found</div>' +
             '  <div style="font-size:11px;margin-top:4px;color:#94a3b8">Click "Record New Advance" above to record an employee advance.</div>' +
             '</div>';
    }

    var html = '<div style="overflow-x:auto">';
    html += '<table style="width:100%;border-collapse:collapse;font-size:12px;text-align:left;background:#fff">';
    html += '  <thead>';
    html += '    <tr style="background:#fff;border-bottom:1px solid #eef2f7;color:#64748b;font-size:9.5px;text-transform:uppercase;letter-spacing:0.8px;font-weight:800">';
    html += '      <th style="padding:10px 14px">Date</th>';
    html += '      <th style="padding:10px 14px">Emp Code</th>';
    html += '      <th style="padding:10px 14px">Employee Name</th>';
    html += '      <th style="padding:10px 14px;text-align:right">Advance (₹)</th>';
    html += '      <th style="padding:10px 14px;text-align:right">Recovered (₹)</th>';
    html += '      <th style="padding:10px 14px;text-align:right">Outstanding (₹)</th>';
    html += '      <th style="padding:10px 14px;text-align:center">Status</th>';
    html += '      <th style="padding:10px 14px">Remarks</th>';
    html += '      <th style="padding:10px 14px;text-align:center">Actions</th>';
    html += '    </tr>';
    html += '  </thead>';
    html += '  <tbody>';

    filtered.forEach(function(adv) {
      var pillClass = 'background:#f0fdf4;color:#15803d;border:1px solid #bbf7d0';
      if (adv.status === 'ACTIVE') {
        pillClass = 'background:#fffbeb;color:#b45309;border:1px solid #fde68a';
      } else if (adv.status === 'PARTIAL') {
        pillClass = 'background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe';
      }

      html += '    <tr style="border-bottom:1px solid #f3f4f6;transition:background 0.15s" onmouseover="this.style.background=\'#f8fafc\'" onmouseout="this.style.background=\'#fff\'">';
      html += '      <td style="padding:10px 14px;color:#64748b;white-space:nowrap;font-size:11px">' + esc(adv.advanceDate || '-') + '</td>';
      html += '      <td style="padding:10px 14px;font-weight:800;color:#312e81;font-family:monospace;font-size:12px">' + esc(adv.empCode) + '</td>';
      html += '      <td style="padding:10px 14px;font-weight:700;color:#111827">' + esc(adv.empName) + '</td>';
      html += '      <td style="padding:10px 14px;text-align:right;font-weight:750;color:#111827">' + formatINR(adv.amount) + '</td>';
      html += '      <td style="padding:10px 14px;text-align:right;font-weight:600;color:#15803d">' + formatINR(adv.recoveredAmount) + '</td>';
      html += '      <td style="padding:10px 14px;text-align:right;font-weight:800;color:' + (adv.balanceAmount > 0 ? '#dc2626' : '#64748b') + '">' + formatINR(adv.balanceAmount) + '</td>';
      html += '      <td style="padding:10px 14px;text-align:center"><span style="display:inline-block;padding:3px 9px;border-radius:999px;font-size:9px;font-weight:850;letter-spacing:0.3px;' + pillClass + '">' + esc(adv.status) + '</span></td>';
      html += '      <td style="padding:10px 14px;color:#64748b;font-size:11px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(adv.remarks) + '">' + esc(adv.remarks || '—') + '</td>';
      html += '      <td style="padding:10px 14px;text-align:center;white-space:nowrap">';
      html += '        <button onclick="ATPLAdvanceManager.viewEmployeeHistory(\'' + esc(adv.empCode) + '\')" style="height:26px;padding:0 8px;border:1px solid #c7d2fe;background:#eef2ff;color:#312e81;border-radius:6px;cursor:pointer;font-size:10px;font-weight:800;margin-right:4px" title="Employee History (Salary + Manual)">📜 History</button>';
      if (adv.balanceAmount > 0) {
        html += '        <button onclick="ATPLAdvanceManager.openManualDeductionModal(\'' + esc(adv.empCode) + '\',\'' + esc(adv.id) + '\')" style="height:26px;padding:0 8px;border:1px solid #fde68a;background:#fffbeb;color:#b45309;border-radius:6px;cursor:pointer;font-size:10px;font-weight:800;margin-right:4px" title="Manual Advance Cut">✂️ Cut</button>';
      }
      html += '        <button onclick="ATPLAdvanceManager.viewStatement(\'' + esc(adv.id) + '\')" style="height:26px;padding:0 8px;border:1px solid #d1d5db;background:#fff;color:#475569;border-radius:6px;cursor:pointer;font-size:10px;font-weight:700;margin-right:4px" title="View Single Advance Statement">👁</button>';
      html += '        <button onclick="ATPLAdvanceManager.editAdvance(\'' + esc(adv.id) + '\')" style="height:26px;padding:0 8px;border:1px solid #d1d5db;background:#fff;color:#d97706;border-radius:6px;cursor:pointer;font-size:10px;font-weight:700;margin-right:4px" title="Edit Advance">✏️</button>';
      html += '        <button onclick="ATPLAdvanceManager.confirmDelete(\'' + esc(adv.id) + '\')" style="height:26px;padding:0 8px;border:1px solid #fecaca;background:#fef2f2;color:#dc2626;border-radius:6px;cursor:pointer;font-size:10px;font-weight:700" title="Delete Advance">🗑</button>';
      html += '      </td>';
      html += '    </tr>';
    });

    html += '  </tbody>';
    html += '</table>';
    html += '</div>';
    return html;
  }

  function renderDeductionsTable() {
    var query = state.searchQuery.toLowerCase().trim();
    var filtered = (state.deductions || []).filter(function(d) {
      if (!d || isDeductionTombstoned(d)) return false;
      var sType = getDeductionSourceType(d);
      if (state.deductionSourceFilter !== 'ALL' && sType !== state.deductionSourceFilter) return false;
      if (!query) return true;
      return String(d.empCode || '').toLowerCase().includes(query) ||
             String(d.empName || '').toLowerCase().includes(query) ||
             String(d.fileName || '').toLowerCase().includes(query) ||
             String(d.sheetName || '').toLowerCase().includes(query) ||
             String(d.columnName || '').toLowerCase().includes(query) ||
             String(d.remarks || '').toLowerCase().includes(query) ||
             String(d.salaryMonth || '').toLowerCase().includes(query);
    }).slice().sort(function(a, b) {
      return (Date.parse(b.deductionDate || b.date || 0) || 0) - (Date.parse(a.deductionDate || a.date || 0) || 0);
    });

    if (!filtered.length) {
      return '<div style="padding:48px 20px;text-align:center;color:#94a3b8;background:#fff">' +
             '  <div style="font-size:36px;margin-bottom:8px;opacity:0.4">📉</div>' +
             '  <div style="font-size:14px;font-weight:700;color:#334155">No Advance Deductions Found</div>' +
             '  <div style="font-size:11px;margin-top:4px;color:#94a3b8">Salary sheets with an Advance column or Manual Deductions will appear here with full audit details.</div>' +
             '</div>';
    }

    var html = '<div style="overflow-x:auto">';
    html += '<table style="width:100%;border-collapse:collapse;font-size:12px;text-align:left;background:#fff">';
    html += '  <thead>';
    html += '    <tr style="background:#fff;border-bottom:1px solid #eef2f7;color:#64748b;font-size:9.5px;text-transform:uppercase;letter-spacing:0.8px;font-weight:800">';
    html += '      <th style="padding:10px 14px">Date</th>';
    html += '      <th style="padding:10px 14px">Cut Type</th>';
    html += '      <th style="padding:10px 14px">Source (File / Sheet / Column or Remarks)</th>';
    html += '      <th style="padding:10px 14px">Emp Code</th>';
    html += '      <th style="padding:10px 14px">Employee Name</th>';
    html += '      <th style="padding:10px 14px;text-align:right">Prev Balance</th>';
    html += '      <th style="padding:10px 14px;text-align:right">Deducted</th>';
    html += '      <th style="padding:10px 14px;text-align:right">Remaining</th>';
    html += '      <th style="padding:10px 14px;text-align:center">Action</th>';
    html += '    </tr>';
    html += '  </thead>';
    html += '  <tbody>';

    filtered.forEach(function(d) {
      var dDate = getDeductionDateStr(d) || '-';
      var sType = getDeductionSourceType(d);
      var typeBadge = sType === 'manual'
        ? '<span style="display:inline-block;padding:3px 8px;border-radius:999px;font-size:9px;font-weight:850;background:#fffbeb;color:#b45309;border:1px solid #fde68a">✍️ MANUAL</span>'
        : '<span style="display:inline-block;padding:3px 8px;border-radius:999px;font-size:9px;font-weight:850;background:#eef2ff;color:#312e81;border:1px solid #c7d2fe">📄 SALARY SHEET</span>';

      var sourceHtml = '';
      if (sType === 'manual') {
        sourceHtml += '<div style="font-weight:700;color:#111827">' + esc(d.deductionMode || d.columnName || 'Manual Deduction') + '</div>';
        sourceHtml += '<div style="font-size:10px;color:#64748b">' + esc(d.remarks || 'No remarks') + '</div>';
      } else {
        sourceHtml += '<div style="font-weight:700;color:#111827">' + esc(d.salaryMonth || 'Salary Sheet') + '</div>';
        sourceHtml += '<div style="font-size:10px;color:#64748b">📄 ' + esc(d.fileName || '') + (d.sheetName ? ' · 📑 ' + esc(d.sheetName) : '') + (d.columnName ? ' · 🧾 Col: ' + esc(d.columnName) : '') + '</div>';
      }

      html += '    <tr style="border-bottom:1px solid #f3f4f6;transition:background 0.15s" onmouseover="this.style.background=\'#f8fafc\'" onmouseout="this.style.background=\'#fff\'">';
      html += '      <td style="padding:10px 14px;color:#64748b;white-space:nowrap;font-size:11px">' + esc(dDate) + '</td>';
      html += '      <td style="padding:10px 14px;white-space:nowrap">' + typeBadge + '</td>';
      html += '      <td style="padding:10px 14px">' + sourceHtml + '</td>';
      html += '      <td style="padding:10px 14px;font-weight:800;color:#312e81;font-family:monospace;font-size:12px">' + esc(d.empCode) + '</td>';
      html += '      <td style="padding:10px 14px;font-weight:700;color:#111827">' + esc(d.empName) + '</td>';
      html += '      <td style="padding:10px 14px;text-align:right;color:#64748b">' + formatINR(d.previousBalance) + '</td>';
      html += '      <td style="padding:10px 14px;text-align:right;font-weight:700;color:#15803d">-' + formatINR(d.deductedAmount) + '</td>';
      html += '      <td style="padding:10px 14px;text-align:right;font-weight:800;color:' + (d.remainingBalance > 0 ? '#dc2626' : '#15803d') + '">' + formatINR(d.remainingBalance) + '</td>';
      html += '      <td style="padding:10px 14px;text-align:center;white-space:nowrap">';
      html += '        <button onclick="ATPLAdvanceManager.viewEmployeeHistory(\'' + esc(d.empCode) + '\')" style="height:26px;padding:0 8px;border:1px solid #c7d2fe;background:#eef2ff;color:#312e81;border-radius:6px;cursor:pointer;font-size:10px;font-weight:800;margin-right:4px">📜 History</button>';
      html += '        <button onclick="ATPLAdvanceManager.confirmDeleteDeduction(\'' + esc(d.id) + '\')" style="height:26px;padding:0 8px;border:1px solid #fecaca;background:#fef2f2;color:#dc2626;border-radius:6px;cursor:pointer;font-size:10px;font-weight:700" title="Reverse / Delete Deduction">🗑</button>';
      html += '      </td>';
      html += '    </tr>';
    });

    html += '  </tbody>';
    html += '</table>';
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
      return '<div style="padding:48px 20px;text-align:center;color:#94a3b8;background:#fff">' +
             '  <div style="font-size:36px;margin-bottom:8px;opacity:0.4">👥</div>' +
             '  <div style="font-size:14px;font-weight:700;color:#334155">No Employee Balance Records</div>' +
             '  <div style="font-size:11px;margin-top:4px;color:#94a3b8">Active employee advance balances will be summarized here.</div>' +
             '</div>';
    }

    var html = '<div style="overflow-x:auto">';
    html += '<table style="width:100%;border-collapse:collapse;font-size:12px;text-align:left;background:#fff">';
    html += '  <thead>';
    html += '    <tr style="background:#fff;border-bottom:1px solid #eef2f7;color:#64748b;font-size:9.5px;text-transform:uppercase;letter-spacing:0.8px;font-weight:800">';
    html += '      <th style="padding:10px 14px">Emp Code</th>';
    html += '      <th style="padding:10px 14px">Employee Name</th>';
    html += '      <th style="padding:10px 14px;text-align:center">Advances</th>';
    html += '      <th style="padding:10px 14px;text-align:right">Disbursed (₹)</th>';
    html += '      <th style="padding:10px 14px;text-align:right">Salary Cut (₹)</th>';
    html += '      <th style="padding:10px 14px;text-align:right">Manual Cut (₹)</th>';
    html += '      <th style="padding:10px 14px;text-align:right">Net Outstanding (₹)</th>';
    html += '      <th style="padding:10px 14px;text-align:center">Status</th>';
    html += '      <th style="padding:10px 14px;text-align:center">Actions</th>';
    html += '    </tr>';
    html += '  </thead>';
    html += '  <tbody>';

    list.forEach(function(item) {
      var isPending = item.totalBal > 0;
      html += '    <tr style="border-bottom:1px solid #f3f4f6;transition:background 0.15s" onmouseover="this.style.background=\'#f8fafc\'" onmouseout="this.style.background=\'#fff\'">';
      html += '      <td style="padding:10px 14px;font-weight:800;color:#312e81;font-family:monospace;font-size:12px">' + esc(item.code) + '</td>';
      html += '      <td style="padding:10px 14px;font-weight:700;color:#111827">' + esc(item.name) + '</td>';
      html += '      <td style="padding:10px 14px;text-align:center;color:#64748b;font-weight:600">' + item.count + ' <span style="font-size:9px;color:#94a3b8">(' + item.dedCount + ' cuts)</span></td>';
      html += '      <td style="padding:10px 14px;text-align:right;font-weight:750;color:#111827">' + formatINR(item.totalAdv) + '</td>';
      html += '      <td style="padding:10px 14px;text-align:right;font-weight:600;color:#312e81">' + formatINR(item.salaryRec) + '</td>';
      html += '      <td style="padding:10px 14px;text-align:right;font-weight:600;color:#b45309">' + formatINR(item.manualRec) + '</td>';
      html += '      <td style="padding:10px 14px;text-align:right;font-weight:800;color:' + (isPending ? '#dc2626' : '#15803d') + '">' + formatINR(item.totalBal) + '</td>';
      html += '      <td style="padding:10px 14px;text-align:center">';
      if (isPending) {
        html += '        <span style="display:inline-block;padding:3px 9px;border-radius:999px;font-size:9px;font-weight:850;background:#fef2f2;color:#dc2626;border:1px solid #fecaca">OUTSTANDING</span>';
      } else {
        html += '        <span style="display:inline-block;padding:3px 9px;border-radius:999px;font-size:9px;font-weight:850;background:#f0fdf4;color:#15803d;border:1px solid #bbf7d0">CLEAR</span>';
      }
      html += '      </td>';
      html += '      <td style="padding:10px 14px;text-align:center;white-space:nowrap">';
      html += '        <button onclick="ATPLAdvanceManager.viewEmployeeHistory(\'' + esc(item.code) + '\')" style="height:26px;padding:0 10px;border:1px solid #818cf8;background:#eef2ff;color:#3730a3;border-radius:6px;cursor:pointer;font-size:10px;font-weight:800;margin-right:4px">👤 Employee History</button>';
      if (isPending) {
        html += '        <button onclick="ATPLAdvanceManager.openManualDeductionModal(\'' + esc(item.code) + '\')" style="height:26px;padding:0 9px;border:1px solid #fde68a;background:#fffbeb;color:#b45309;border-radius:6px;cursor:pointer;font-size:10px;font-weight:800;margin-right:4px">✂️ Manual Cut</button>';
      }
      html += '        <button onclick="ATPLAdvanceManager.openNewModal(\'' + esc(item.code) + '\')" style="height:26px;padding:0 9px;border:none;background:#312e81;color:#fff;border-radius:6px;cursor:pointer;font-size:10px;font-weight:700">➕ Add</button>';
      html += '      </td>';
      html += '    </tr>';
    });

    html += '  </tbody>';
    html += '</table>';
    html += '</div>';
    return html;
  }

  // ── 7. MODALS (NEW ENTRY, MANUAL DEDUCTION, STATEMENT & EMPLOYEE HISTORY) ──
  function getOrCreateModal() {
    var modal = document.getElementById('advModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'advModal';
      document.body.appendChild(modal);
    }
    return modal;
  }

  function openNewModal(prefillCode) {
    state.editingAdvanceId = null;
    state.openHistoryEmpCode = null;
    var emp = prefillCode ? findEmployeeByCode(prefillCode) : null;
    var outBal = prefillCode ? getEmployeeOutstandingBalance(prefillCode) : 0;
    var modal = getOrCreateModal();
    var today = new Date().toISOString().slice(0, 10);

    var content = '';
    content += '<div style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(15,23,42,0.45);backdrop-filter:blur(4px);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px" onclick="if(event.target===this)ATPLAdvanceManager.closeModal()">';
    content += '  <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:16px;max-width:540px;width:100%;box-shadow:0 20px 40px rgba(15,23,42,0.18);overflow:hidden">';

    content += '    <div style="padding:18px 22px;border-bottom:1px solid #e5e7eb;display:flex;justify-content:space-between;align-items:center;background:#ffffff">';
    content += '      <div>';
    content += '        <div style="font-size:9px;font-weight:900;letter-spacing:1px;color:#7c3aed;text-transform:uppercase">ADVANCE ENTRY AUDIT</div>';
    content += '        <h3 style="margin:2px 0 0;font-size:18px;font-weight:850;color:#111827">Record Employee Advance</h3>';
    content += '        <div style="font-size:11px;color:#64748b;margin-top:2px">Employee code auto-fetches name from Employee Master</div>';
    content += '      </div>';
    content += '      <button onclick="ATPLAdvanceManager.closeModal()" style="border:1px solid #e5e7eb;background:#f9fafb;color:#64748b;width:32px;height:32px;border-radius:8px;cursor:pointer;font-size:15px;display:flex;align-items:center;justify-content:center">✕</button>';
    content += '    </div>';

    content += '    <div style="padding:22px;display:flex;flex-direction:column;gap:14px;background:#ffffff">';
    content += '      <div style="position:relative">';
    content += '        <label style="display:block;font-size:10px;font-weight:800;color:#475569;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:5px">Employee Code *</label>';
    content += '        <input type="text" id="advFormCode" placeholder="Enter Employee Code (e.g. 25924)" value="' + esc(prefillCode || '') + '" oninput="ATPLAdvanceManager.onCodeInput(this.value)" autocomplete="off" style="width:100%;padding:10px 12px;background:#ffffff;border:1px solid #d1d5db;border-radius:8px;color:#111827;font-size:13px;font-weight:700;font-family:monospace;outline:none">';
    content += '        <div id="advCodeSuggestions" style="display:none;position:absolute;top:100%;left:0;right:0;background:#ffffff;border:1px solid #cbd5e1;border-radius:8px;margin-top:4px;max-height:190px;overflow-y:auto;z-index:200;box-shadow:0 12px 28px rgba(15,23,42,0.18)"></div>';
    content += '      </div>';

    content += '      <div id="advEmpDetailsBox" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:11px 14px;display:flex;justify-content:space-between;align-items:center">';
    content += '        <div>';
    content += '          <div style="font-size:9.5px;color:#64748b;text-transform:uppercase;font-weight:800">Auto-Fetched Employee</div>';
    content += '          <div id="advFormEmpName" style="font-size:13px;font-weight:800;color:' + (emp ? '#312e81' : '#64748b') + '">' + esc(emp ? emp.name : 'Waiting for Employee Code...') + '</div>';
    content += '          <div id="advFormEmpDept" style="font-size:10px;color:#94a3b8">' + esc(emp ? (emp.dept + (emp.desig ? ' • ' + emp.desig : '')) : '-') + '</div>';
    content += '        </div>';
    content += '        <div style="text-align:right">';
    content += '          <div style="font-size:9.5px;color:#64748b;text-transform:uppercase;font-weight:800">Existing Balance</div>';
    content += '          <div id="advFormExistingBal" style="font-size:14px;font-weight:850;color:' + (outBal > 0 ? '#dc2626' : '#15803d') + '">' + formatINR(outBal) + '</div>';
    content += '        </div>';
    content += '      </div>';

    content += '      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">';
    content += '        <div>';
    content += '          <label style="display:block;font-size:10px;font-weight:800;color:#475569;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:5px">Advance Date *</label>';
    content += '          <input type="date" id="advFormDate" value="' + today + '" style="width:100%;padding:9px 12px;background:#ffffff;border:1px solid #d1d5db;border-radius:8px;color:#111827;font-size:12px;outline:none">';
    content += '        </div>';
    content += '        <div>';
    content += '          <label style="display:block;font-size:10px;font-weight:800;color:#475569;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:5px">Advance Amount (₹) *</label>';
    content += '          <input type="number" id="advFormAmount" min="1" placeholder="e.g. 10000" style="width:100%;padding:9px 12px;background:#ffffff;border:1px solid #d1d5db;border-radius:8px;color:#111827;font-size:13px;font-weight:750;outline:none">';
    content += '        </div>';
    content += '      </div>';

    content += '      <div style="display:flex;gap:6px;flex-wrap:wrap">';
    [2000, 5000, 10000, 20000, 50000].forEach(function(amt) {
      content += '      <button type="button" onclick="document.getElementById(\'advFormAmount\').value=' + amt + '" style="padding:4px 9px;background:#f3f4f6;border:1px solid #e5e7eb;color:#374151;border-radius:6px;font-size:10px;font-weight:700;cursor:pointer">+ ' + formatINR(amt) + '</button>';
    });
    content += '      </div>';

    content += '      <div>';
    content += '        <label style="display:block;font-size:10px;font-weight:800;color:#475569;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:3px">Monthly Reference Cap (Optional)</label>';
    content += '        <div style="font-size:10px;color:#94a3b8;margin-bottom:5px">Note only — salary sheet deduction cuts the exact Advance column amount present in the uploaded salary sheet.</div>';
    content += '        <input type="number" id="advFormCap" min="0" placeholder="0 = No fixed cap" style="width:100%;padding:9px 12px;background:#ffffff;border:1px solid #d1d5db;border-radius:8px;color:#111827;font-size:12px;outline:none">';
    content += '      </div>';

    content += '      <div>';
    content += '        <label style="display:block;font-size:10px;font-weight:800;color:#475569;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:5px">Remarks / Reason</label>';
    content += '        <input type="text" id="advFormRemarks" placeholder="e.g. Festival Advance, Medical Need, Urgent Loan" style="width:100%;padding:9px 12px;background:#ffffff;border:1px solid #d1d5db;border-radius:8px;color:#111827;font-size:12px;outline:none">';
    content += '      </div>';
    content += '    </div>';

    content += '    <div style="padding:14px 22px;border-top:1px solid #e5e7eb;display:flex;justify-content:flex-end;gap:10px;background:#f8fafc">';
    content += '      <button onclick="ATPLAdvanceManager.closeModal()" style="padding:9px 16px;background:#ffffff;border:1px solid #d1d5db;color:#475569;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer">Cancel</button>';
    content += '      <button onclick="ATPLAdvanceManager.submitForm()" style="padding:9px 20px;background:#312e81;color:#fff;border:none;border-radius:8px;font-size:12px;font-weight:800;cursor:pointer;box-shadow:0 1px 3px rgba(49,46,129,0.25)">Save Advance &amp; Sync</button>';
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
      if (boxName) { boxName.textContent = emp.name; boxName.style.color = '#312e81'; }
      if (boxDept) boxDept.textContent = emp.dept + (emp.desig ? ' • ' + emp.desig : '');
    } else {
      if (boxName) { boxName.textContent = 'Code not in Master (Custom Employee)'; boxName.style.color = '#d97706'; }
      if (boxDept) boxDept.textContent = '-';
    }

    if (boxBal) {
      boxBal.textContent = formatINR(bal);
      boxBal.style.color = bal > 0 ? '#ef4444' : '#10b981';
    }

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
          sHtml += '<div onclick="ATPLAdvanceManager.selectSuggestion(\'' + esc(mCode) + '\')" style="padding:10px 14px;border-bottom:1px solid #f1f5f9;cursor:pointer;display:flex;justify-content:space-between;align-items:center;background:#ffffff;transition:background 0.15s" onmouseover="this.style.background=\'#f8fafc\'" onmouseout="this.style.background=\'#ffffff\'">';
          sHtml += '  <div style="display:flex;align-items:center;gap:8px"><strong style="color:#312e81;font-size:12.5px;font-family:monospace;letter-spacing:0.3px">' + esc(mCode) + '</strong> <span style="color:#cbd5e1;font-weight:600">—</span> <span style="color:#0f172a;font-weight:750;font-size:12.5px">' + esc(mName) + '</span></div>';
          sHtml += '  <div style="font-size:10px;font-weight:700;color:#475569;background:#f1f5f9;border:1px solid #e2e8f0;padding:2px 8px;border-radius:4px;letter-spacing:0.3px">' + esc(mDept || 'PRODUCTION') + '</div>';
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

  // ── MANUAL DEDUCTION MODAL ──
  function getActiveAdvancesForCode(code) {
    var norm = normalizeCode(code);
    if (!norm) return [];
    return (state.advances || []).filter(function(a) {
      return a && normalizeCode(a.empCode) === norm && (Number(a.balanceAmount) || 0) > 0;
    }).sort(function(a, b) {
      return (Date.parse(a.advanceDate || a.createdAt || 0) || 0) - (Date.parse(b.advanceDate || b.createdAt || 0) || 0);
    });
  }

  function buildTargetAdvanceOptionsHtml(code, selectedId) {
    var active = getActiveAdvancesForCode(code);
    if (!active.length) {
      return '<option value="AUTO">No active advance balance for this employee</option>';
    }
    var opts = '<option value="AUTO"' + (!selectedId || selectedId === 'AUTO' ? ' selected' : '') + '>Auto (FIFO — Oldest Active First · Total Bal: ' + formatINR(getEmployeeOutstandingBalance(code)) + ')</option>';
    active.forEach(function(a) {
      var label = (a.advanceDate || '-') + ' · Given ' + formatINR(a.amount) + ' · Bal ' + formatINR(a.balanceAmount) + (a.remarks ? (' (' + a.remarks + ')') : '');
      opts += '<option value="' + esc(a.id) + '"' + (selectedId === a.id ? ' selected' : '') + '>' + esc(label) + '</option>';
    });
    return opts;
  }

  function openManualDeductionModal(prefillCode, prefillAdvanceId) {
    state.openHistoryEmpCode = null;
    var modal = getOrCreateModal();
    var today = new Date().toISOString().slice(0, 10);
    var emp = prefillCode ? findEmployeeByCode(prefillCode) : null;
    var outBal = prefillCode ? getEmployeeOutstandingBalance(prefillCode) : 0;
    if (prefillAdvanceId) {
      var selAdv = (state.advances || []).find(function(a) { return a.id === prefillAdvanceId; });
      if (selAdv) outBal = Number(selAdv.balanceAmount) || 0;
    }

    var content = '';
    content += '<div style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(15,23,42,0.45);backdrop-filter:blur(4px);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px" onclick="if(event.target===this)ATPLAdvanceManager.closeModal()">';
    content += '  <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:16px;max-width:560px;width:100%;box-shadow:0 20px 40px rgba(15,23,42,0.18);overflow:hidden">';

    content += '    <div style="padding:18px 22px;border-bottom:1px solid #e5e7eb;display:flex;justify-content:space-between;align-items:center;background:#fffbeb">';
    content += '      <div>';
    content += '        <div style="font-size:9px;font-weight:900;letter-spacing:1px;color:#b45309;text-transform:uppercase">MANUAL ADVANCE RECOVERY</div>';
    content += '        <h3 style="margin:2px 0 0;font-size:18px;font-weight:850;color:#111827">✂️ Manual Advance Deduction</h3>';
    content += '        <div style="font-size:11px;color:#64748b;margin-top:2px">Cash, Bank/UPI, F&amp;F ya manual adjustment se kisi bhi employee ka advance cut karein</div>';
    content += '      </div>';
    content += '      <button onclick="ATPLAdvanceManager.closeModal()" style="border:1px solid #fde68a;background:#fff;color:#64748b;width:32px;height:32px;border-radius:8px;cursor:pointer;font-size:15px;display:flex;align-items:center;justify-content:center">✕</button>';
    content += '    </div>';

    content += '    <div style="padding:20px 22px;display:flex;flex-direction:column;gap:13px;background:#ffffff">';
    content += '      <div style="position:relative">';
    content += '        <label style="display:block;font-size:10px;font-weight:800;color:#475569;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:5px">Employee Code / Name *</label>';
    content += '        <input type="text" id="advManCode" placeholder="Enter Code or Name with Active Advance..." value="' + esc(prefillCode || '') + '" oninput="ATPLAdvanceManager.onManualCodeInput(this.value)" autocomplete="off" style="width:100%;padding:10px 12px;background:#ffffff;border:1px solid #d1d5db;border-radius:8px;color:#111827;font-size:13px;font-weight:700;font-family:monospace;outline:none">';
    content += '        <div id="advManSuggestions" style="display:none;position:absolute;top:100%;left:0;right:0;background:#ffffff;border:1px solid #cbd5e1;border-radius:8px;margin-top:4px;max-height:190px;overflow-y:auto;z-index:200;box-shadow:0 12px 28px rgba(15,23,42,0.18)"></div>';
    content += '      </div>';

    content += '      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:11px 14px;display:flex;justify-content:space-between;align-items:center">';
    content += '        <div>';
    content += '          <div style="font-size:9.5px;color:#64748b;text-transform:uppercase;font-weight:800">Selected Employee</div>';
    content += '          <div id="advManEmpName" style="font-size:13px;font-weight:800;color:' + (emp ? '#312e81' : '#64748b') + '">' + esc(emp ? emp.name : 'Enter Employee Code...') + '</div>';
    content += '          <div id="advManEmpDept" style="font-size:10px;color:#94a3b8">' + esc(emp && emp.dept ? emp.dept : '-') + '</div>';
    content += '        </div>';
    content += '        <div style="text-align:right">';
    content += '          <div style="font-size:9.5px;color:#64748b;text-transform:uppercase;font-weight:800">Available to Cut</div>';
    content += '          <div id="advManBal" style="font-size:15px;font-weight:850;color:' + (outBal > 0 ? '#dc2626' : '#15803d') + '">' + formatINR(outBal) + '</div>';
    content += '        </div>';
    content += '      </div>';

    content += '      <div>';
    content += '        <label style="display:block;font-size:10px;font-weight:800;color:#475569;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:5px">Target Advance Record</label>';
    content += '        <select id="advManTarget" onchange="ATPLAdvanceManager.onManualTargetChange(this.value)" style="width:100%;padding:9px 12px;background:#ffffff;border:1px solid #d1d5db;border-radius:8px;color:#111827;font-size:12px;font-weight:600;outline:none">';
    content +=            buildTargetAdvanceOptionsHtml(prefillCode, prefillAdvanceId);
    content += '        </select>';
    content += '      </div>';

    content += '      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">';
    content += '        <div>';
    content += '          <label style="display:block;font-size:10px;font-weight:800;color:#475569;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:5px">Deduction Date *</label>';
    content += '          <input type="date" id="advManDate" value="' + today + '" style="width:100%;padding:9px 12px;background:#ffffff;border:1px solid #d1d5db;border-radius:8px;color:#111827;font-size:12px;outline:none">';
    content += '        </div>';
    content += '        <div>';
    content += '          <label style="display:block;font-size:10px;font-weight:800;color:#475569;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:5px">Deduction Amount (₹) *</label>';
    content += '          <input type="number" id="advManAmount" min="1" step="any" placeholder="Enter amount to cut" style="width:100%;padding:9px 12px;background:#ffffff;border:1px solid #d1d5db;border-radius:8px;color:#111827;font-size:13px;font-weight:800;outline:none">';
    content += '        </div>';
    content += '      </div>';

    content += '      <div id="advManQuickBtns" style="display:flex;gap:6px;flex-wrap:wrap">';
    if (outBal > 0) {
      content += '      <button type="button" onclick="document.getElementById(\'advManAmount\').value=' + outBal + '" style="padding:4px 9px;background:#fef2f2;border:1px solid #fecaca;color:#dc2626;border-radius:6px;font-size:10px;font-weight:800;cursor:pointer">Full Bal: ' + formatINR(outBal) + '</button>';
    }
    [500, 1000, 2000, 5000].forEach(function(amt) {
      content += '      <button type="button" onclick="document.getElementById(\'advManAmount\').value=' + amt + '" style="padding:4px 9px;background:#f3f4f6;border:1px solid #e5e7eb;color:#374151;border-radius:6px;font-size:10px;font-weight:700;cursor:pointer">' + formatINR(amt) + '</button>';
    });
    content += '      </div>';

    content += '      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">';
    content += '        <div>';
    content += '          <label style="display:block;font-size:10px;font-weight:800;color:#475569;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:5px">Deduction Mode</label>';
    content += '          <select id="advManMode" style="width:100%;padding:9px 12px;background:#ffffff;border:1px solid #d1d5db;border-radius:8px;color:#111827;font-size:12px;outline:none">';
    content += '            <option value="Manual Cash Recovery">Manual Cash Recovery</option>';
    content += '            <option value="Bank / UPI Transfer">Bank / UPI Transfer</option>';
    content += '            <option value="F&amp;F Settlement">F&amp;F Settlement</option>';
    content += '            <option value="Manual Salary Adjustment">Manual Salary Adjustment</option>';
    content += '            <option value="Other Recovery">Other Recovery</option>';
    content += '          </select>';
    content += '        </div>';
    content += '        <div>';
    content += '          <label style="display:block;font-size:10px;font-weight:800;color:#475569;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:5px">Remarks / Note</label>';
    content += '          <input type="text" id="advManRemarks" placeholder="e.g. Cash received in office" style="width:100%;padding:9px 12px;background:#ffffff;border:1px solid #d1d5db;border-radius:8px;color:#111827;font-size:12px;outline:none">';
    content += '        </div>';
    content += '      </div>';
    content += '    </div>';

    content += '    <div style="padding:14px 22px;border-top:1px solid #e5e7eb;display:flex;justify-content:flex-end;gap:10px;background:#f8fafc">';
    content += '      <button onclick="ATPLAdvanceManager.closeModal()" style="padding:9px 16px;background:#ffffff;border:1px solid #d1d5db;color:#475569;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer">Cancel</button>';
    content += '      <button onclick="ATPLAdvanceManager.submitManualDeduction()" style="padding:9px 20px;background:#b45309;color:#fff;border:none;border-radius:8px;font-size:12px;font-weight:800;cursor:pointer;box-shadow:0 1px 3px rgba(180,83,9,0.25)">✂️ Cut Advance &amp; Sync</button>';
    content += '    </div>';

    content += '  </div>';
    content += '</div>';

    modal.innerHTML = content;
  }

  function onManualCodeInput(val) {
    var raw = String(val || '').trim();
    var boxName = document.getElementById('advManEmpName');
    var boxDept = document.getElementById('advManEmpDept');
    var boxBal = document.getElementById('advManBal');
    var targetSel = document.getElementById('advManTarget');
    var suggBox = document.getElementById('advManSuggestions');
    var quickBtns = document.getElementById('advManQuickBtns');

    if (!raw) {
      if (boxName) { boxName.textContent = 'Enter Employee Code...'; boxName.style.color = '#64748b'; }
      if (boxDept) boxDept.textContent = '-';
      if (boxBal) { boxBal.textContent = '₹0'; boxBal.style.color = '#15803d'; }
      if (targetSel) targetSel.innerHTML = buildTargetAdvanceOptionsHtml('', null);
      if (suggBox) suggBox.style.display = 'none';
      return;
    }

    var emp = findEmployeeByCode(raw);
    var bal = getEmployeeOutstandingBalance(raw);

    if (boxName) {
      boxName.textContent = emp ? emp.name : 'Employee not found';
      boxName.style.color = emp ? '#312e81' : '#d97706';
    }
    if (boxDept) boxDept.textContent = emp && emp.dept ? emp.dept : '-';
    if (boxBal) {
      boxBal.textContent = formatINR(bal);
      boxBal.style.color = bal > 0 ? '#dc2626' : '#15803d';
    }
    if (targetSel) {
      targetSel.innerHTML = buildTargetAdvanceOptionsHtml(raw, null);
    }
    if (quickBtns) {
      var qb = '';
      if (bal > 0) {
        qb += '<button type="button" onclick="document.getElementById(\'advManAmount\').value=' + bal + '" style="padding:4px 9px;background:#fef2f2;border:1px solid #fecaca;color:#dc2626;border-radius:6px;font-size:10px;font-weight:800;cursor:pointer">Full Bal: ' + formatINR(bal) + '</button>';
      }
      [500, 1000, 2000, 5000].forEach(function(amt) {
        qb += '<button type="button" onclick="document.getElementById(\'advManAmount\').value=' + amt + '" style="padding:4px 9px;background:#f3f4f6;border:1px solid #e5e7eb;color:#374151;border-radius:6px;font-size:10px;font-weight:700;cursor:pointer">' + formatINR(amt) + '</button>';
      });
      quickBtns.innerHTML = qb;
    }

    if (suggBox) {
      var norm = raw.toLowerCase();
      var empMap = {};
      (state.advances || []).forEach(function(a) {
        if (!a || (Number(a.balanceAmount) || 0) <= 0) return;
        var k = normalizeCode(a.empCode);
        if (!empMap[k]) empMap[k] = { code: a.empCode, name: a.empName, bal: 0 };
        empMap[k].bal += (Number(a.balanceAmount) || 0);
      });
      var matches = Object.values(empMap).filter(function(m) {
        return String(m.code || '').toLowerCase().includes(norm) || String(m.name || '').toLowerCase().includes(norm);
      }).slice(0, 6);

      if (matches.length > 0 && (!emp || normalizeCode(raw) !== normalizeCode(emp.code) || bal === 0)) {
        var sHtml = '';
        matches.forEach(function(m) {
          sHtml += '<div onclick="ATPLAdvanceManager.selectManualSuggestion(\'' + esc(m.code) + '\')" style="padding:10px 14px;border-bottom:1px solid #f1f5f9;cursor:pointer;display:flex;justify-content:space-between;align-items:center;background:#ffffff" onmouseover="this.style.background=\'#f8fafc\'" onmouseout="this.style.background=\'#ffffff\'">';
          sHtml += '  <div><strong style="color:#312e81;font-family:monospace">' + esc(m.code) + '</strong> — <span style="font-weight:750;color:#0f172a">' + esc(m.name) + '</span></div>';
          sHtml += '  <div style="font-size:10px;font-weight:800;color:#dc2626">Bal: ' + formatINR(m.bal) + '</div>';
          sHtml += '</div>';
        });
        suggBox.innerHTML = sHtml;
        suggBox.style.display = 'block';
      } else {
        suggBox.style.display = 'none';
      }
    }
  }

  function selectManualSuggestion(code) {
    var inp = document.getElementById('advManCode');
    if (inp) {
      inp.value = code;
      onManualCodeInput(code);
    }
    var suggBox = document.getElementById('advManSuggestions');
    if (suggBox) suggBox.style.display = 'none';
  }

  function onManualTargetChange(advId) {
    var code = (document.getElementById('advManCode') || {}).value || '';
    var boxBal = document.getElementById('advManBal');
    var quickBtns = document.getElementById('advManQuickBtns');
    var bal = getEmployeeOutstandingBalance(code);
    if (advId && advId !== 'AUTO') {
      var found = (state.advances || []).find(function(a) { return a.id === advId; });
      if (found) bal = Number(found.balanceAmount) || 0;
    }
    if (boxBal) {
      boxBal.textContent = formatINR(bal);
      boxBal.style.color = bal > 0 ? '#dc2626' : '#15803d';
    }
    if (quickBtns) {
      var qb = '';
      if (bal > 0) {
        qb += '<button type="button" onclick="document.getElementById(\'advManAmount\').value=' + bal + '" style="padding:4px 9px;background:#fef2f2;border:1px solid #fecaca;color:#dc2626;border-radius:6px;font-size:10px;font-weight:800;cursor:pointer">Full Bal: ' + formatINR(bal) + '</button>';
      }
      [500, 1000, 2000, 5000].forEach(function(amt) {
        qb += '<button type="button" onclick="document.getElementById(\'advManAmount\').value=' + amt + '" style="padding:4px 9px;background:#f3f4f6;border:1px solid #e5e7eb;color:#374151;border-radius:6px;font-size:10px;font-weight:700;cursor:pointer">' + formatINR(amt) + '</button>';
      });
      quickBtns.innerHTML = qb;
    }
  }

  function submitManualDeduction() {
    var code = (document.getElementById('advManCode') || {}).value;
    var advanceId = (document.getElementById('advManTarget') || {}).value || 'AUTO';
    var date = (document.getElementById('advManDate') || {}).value;
    var amount = (document.getElementById('advManAmount') || {}).value;
    var mode = (document.getElementById('advManMode') || {}).value;
    var remarks = (document.getElementById('advManRemarks') || {}).value;

    if (!code || !String(code).trim()) {
      alert('Please enter Employee Code.');
      return;
    }
    if (!amount || Number(amount) <= 0) {
      alert('Please enter a valid positive Manual Deduction Amount.');
      return;
    }

    var res = deductAdvanceManually({
      empCode: String(code).trim(),
      advanceId: advanceId,
      deductionDate: date,
      amount: Number(amount),
      mode: mode,
      remarks: remarks
    });

    if (res && res.ok) {
      closeModal();
    } else if (res && res.error === 'EXCEEDS_BALANCE') {
      alert('Deduction amount cannot exceed available balance (' + formatINR(res.available) + ').');
    } else if (res && res.error === 'NO_ACTIVE_ADVANCE') {
      alert('No active advance balance found for Employee ' + code + '.');
    }
  }

  // ── COMPLETE EMPLOYEE HISTORY MODAL (SALARY SHEET + MANUAL CUTS) ──
  function viewEmployeeHistory(empCode) {
    if (!empCode) return;
    state.openHistoryEmpCode = empCode;
    var hist = getEmployeeHistoryData(empCode);
    var modal = getOrCreateModal();

    var filteredDed = hist.deductions.filter(function(d) {
      if (state.historySourceFilter === 'ALL') return true;
      return getDeductionSourceType(d) === state.historySourceFilter;
    });

    var advLookup = {};
    hist.advances.forEach(function(a) { advLookup[a.id] = a; });

    var content = '';
    content += '<div style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(15,23,42,0.5);backdrop-filter:blur(4px);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px" onclick="if(event.target===this)ATPLAdvanceManager.closeModal()">';
    content += '  <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:16px;max-width:860px;width:100%;max-height:90vh;display:flex;flex-direction:column;box-shadow:0 24px 48px rgba(15,23,42,0.22);overflow:hidden">';

    // Header
    content += '    <div style="padding:18px 22px;border-bottom:1px solid #e5e7eb;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;background:#ffffff">';
    content += '      <div>';
    content += '        <div style="font-size:9px;font-weight:900;letter-spacing:1.1px;color:#4f46e5;text-transform:uppercase">COMPLETE EMPLOYEE ADVANCE HISTORY</div>';
    content += '        <h3 style="margin:2px 0 0;font-size:19px;font-weight:850;color:#111827">' + esc(hist.empName) + ' <span style="font-family:monospace;color:#312e81;font-size:15px">(' + esc(hist.empCode) + ')</span></h3>';
    content += '        <div style="font-size:11px;color:#64748b;margin-top:2px">' + (hist.dept ? esc(hist.dept) + (hist.desig ? ' · ' + esc(hist.desig) : '') + ' · ' : '') + 'Salary Sheet aur Manual Advance Deduction ka poora hisab</div>';
    content += '      </div>';
    content += '      <div style="display:flex;gap:8px;align-items:center">';
    if (hist.totalRemaining > 0) {
      content += '        <button onclick="ATPLAdvanceManager.openManualDeductionModal(\'' + esc(hist.empCode) + '\')" style="padding:7px 12px;background:#b45309;color:#fff;border:none;border-radius:8px;font-size:11px;font-weight:800;cursor:pointer">✂️ Manual Cut</button>';
    }
    content += '        <button onclick="ATPLAdvanceManager.openNewModal(\'' + esc(hist.empCode) + '\')" style="padding:7px 12px;background:#312e81;color:#fff;border:none;border-radius:8px;font-size:11px;font-weight:800;cursor:pointer">➕ Add Advance</button>';
    content += '        <button onclick="ATPLAdvanceManager.closeModal()" style="border:1px solid #e5e7eb;background:#f9fafb;color:#64748b;width:32px;height:32px;border-radius:8px;cursor:pointer;font-size:15px;display:flex;align-items:center;justify-content:center">✕</button>';
    content += '      </div>';
    content += '    </div>';

    // 4 Summary Cards
    content += '    <div style="padding:14px 22px;border-bottom:1px solid #e5e7eb;background:#f8fafc;display:grid;grid-template-columns:repeat(4,1fr);gap:10px">';
    content += '      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:10px 12px"><div style="font-size:9px;color:#64748b;text-transform:uppercase;font-weight:800">Total Advance Given</div><div style="font-size:17px;font-weight:850;color:#111827">' + formatINR(hist.totalGiven) + '</div><div style="font-size:10px;color:#94a3b8">' + hist.advances.length + ' advance(s)</div></div>';
    content += '      <div style="background:#fff;border:1px solid #c7d2fe;border-radius:10px;padding:10px 12px"><div style="font-size:9px;color:#312e81;text-transform:uppercase;font-weight:800">Salary Sheet Cut</div><div style="font-size:17px;font-weight:850;color:#312e81">' + formatINR(hist.totalSalaryCut) + '</div><div style="font-size:10px;color:#6366f1">' + hist.deductions.filter(function(d){return getDeductionSourceType(d)==='salary';}).length + ' sheet cut(s)</div></div>';
    content += '      <div style="background:#fff;border:1px solid #fde68a;border-radius:10px;padding:10px 12px"><div style="font-size:9px;color:#b45309;text-transform:uppercase;font-weight:800">Manual Cut</div><div style="font-size:17px;font-weight:850;color:#b45309">' + formatINR(hist.totalManualCut) + '</div><div style="font-size:10px;color:#d97706">' + hist.deductions.filter(function(d){return getDeductionSourceType(d)==='manual';}).length + ' manual cut(s)</div></div>';
    content += '      <div style="background:#fff;border:1px solid ' + (hist.totalRemaining > 0 ? '#fecaca' : '#bbf7d0') + ';border-radius:10px;padding:10px 12px"><div style="font-size:9px;color:' + (hist.totalRemaining > 0 ? '#dc2626' : '#15803d') + ';text-transform:uppercase;font-weight:800">Remaining Balance</div><div style="font-size:17px;font-weight:850;color:' + (hist.totalRemaining > 0 ? '#dc2626' : '#15803d') + '">' + formatINR(hist.totalRemaining) + '</div><div style="font-size:10px;color:#64748b">' + (hist.totalRemaining > 0 ? 'Pending recovery' : 'Fully cleared') + '</div></div>';
    content += '    </div>';

    // Scrollable Body
    content += '    <div style="padding:18px 22px;overflow-y:auto;flex:1;background:#ffffff;display:flex;flex-direction:column;gap:18px">';

    // Advances Given Summary Table
    content += '      <div>';
    content += '        <h4 style="margin:0 0 8px;font-size:11px;font-weight:850;color:#334155;text-transform:uppercase;letter-spacing:0.6px">💳 Advances Disbursed (' + hist.advances.length + ')</h4>';
    if (!hist.advances.length) {
      content += '        <div style="padding:14px;border:1px dashed #e2e8f0;border-radius:8px;color:#94a3b8;font-size:11px;text-align:center">No advance entries found.</div>';
    } else {
      content += '        <div style="border:1px solid #e5e7eb;border-radius:10px;overflow:hidden">';
      content += '          <table style="width:100%;border-collapse:collapse;font-size:11.5px;text-align:left">';
      content += '            <thead><tr style="background:#f8fafc;border-bottom:1px solid #e5e7eb;color:#64748b;font-size:9.5px;text-transform:uppercase;font-weight:800"><th style="padding:8px 12px">Advance Date</th><th style="padding:8px 12px;text-align:right">Given (₹)</th><th style="padding:8px 12px;text-align:right">Recovered (₹)</th><th style="padding:8px 12px;text-align:right">Remaining (₹)</th><th style="padding:8px 12px">Status</th><th style="padding:8px 12px">Remarks</th></tr></thead>';
      content += '            <tbody>';
      hist.advances.forEach(function(a) {
        content += '              <tr style="border-bottom:1px solid #f1f5f9">';
        content += '                <td style="padding:8px 12px;color:#334155;font-weight:600">' + esc(a.advanceDate || '-') + '</td>';
        content += '                <td style="padding:8px 12px;text-align:right;font-weight:750;color:#111827">' + formatINR(a.amount) + '</td>';
        content += '                <td style="padding:8px 12px;text-align:right;font-weight:650;color:#15803d">' + formatINR(a.recoveredAmount) + '</td>';
        content += '                <td style="padding:8px 12px;text-align:right;font-weight:800;color:' + (a.balanceAmount > 0 ? '#dc2626' : '#15803d') + '">' + formatINR(a.balanceAmount) + '</td>';
        content += '                <td style="padding:8px 12px;font-weight:800;font-size:10px;color:' + (a.status === 'REPAID' ? '#15803d' : '#b45309') + '">' + esc(a.status) + '</td>';
        content += '                <td style="padding:8px 12px;color:#64748b">' + esc(a.remarks || '—') + '</td>';
        content += '              </tr>';
      });
      content += '            </tbody></table></div>';
    }
    content += '      </div>';

    // Complete Deduction Breakdown (Salary Sheet + Manual)
    content += '      <div>';
    content += '        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:8px">';
    content += '          <h4 style="margin:0;font-size:11px;font-weight:850;color:#334155;text-transform:uppercase;letter-spacing:0.6px">📉 Kab Kab &amp; Kaise Cut Hua — Deduction Breakdown (' + filteredDed.length + ')</h4>';
    content += '          <div style="display:flex;gap:4px;background:#f3f4f6;padding:3px;border-radius:8px">';
    content += '            <button onclick="ATPLAdvanceManager.setHistoryFilter(\'ALL\')" style="border:0;padding:4px 10px;border-radius:6px;font-size:10px;font-weight:800;cursor:pointer;background:' + (state.historySourceFilter === 'ALL' ? '#312e81' : 'transparent') + ';color:' + (state.historySourceFilter === 'ALL' ? '#fff' : '#64748b') + '">All (' + hist.deductions.length + ')</button>';
    content += '            <button onclick="ATPLAdvanceManager.setHistoryFilter(\'salary\')" style="border:0;padding:4px 10px;border-radius:6px;font-size:10px;font-weight:800;cursor:pointer;background:' + (state.historySourceFilter === 'salary' ? '#312e81' : 'transparent') + ';color:' + (state.historySourceFilter === 'salary' ? '#fff' : '#64748b') + '">📄 Salary Sheet</button>';
    content += '            <button onclick="ATPLAdvanceManager.setHistoryFilter(\'manual\')" style="border:0;padding:4px 10px;border-radius:6px;font-size:10px;font-weight:800;cursor:pointer;background:' + (state.historySourceFilter === 'manual' ? '#b45309' : 'transparent') + ';color:' + (state.historySourceFilter === 'manual' ? '#fff' : '#64748b') + '">✍️ Manual</button>';
    content += '          </div>';
    content += '        </div>';

    if (!filteredDed.length) {
      content += '        <div style="padding:22px;border:1px dashed #e2e8f0;border-radius:10px;text-align:center;color:#94a3b8;font-size:11px">No deductions recorded yet for this filter.</div>';
    } else {
      content += '        <div style="border:1px solid #e5e7eb;border-radius:10px;overflow:hidden">';
      content += '          <table style="width:100%;border-collapse:collapse;font-size:11.5px;text-align:left">';
      content += '            <thead>';
      content += '              <tr style="background:#f8fafc;border-bottom:1px solid #e5e7eb;color:#64748b;font-size:9.5px;text-transform:uppercase;font-weight:800">';
      content += '                <th style="padding:8px 10px">Cut Date</th>';
      content += '                <th style="padding:8px 10px">Type</th>';
      content += '                <th style="padding:8px 10px">File / Sheet / Column / Remarks</th>';
      content += '                <th style="padding:8px 10px">Advance Ref</th>';
      content += '                <th style="padding:8px 10px;text-align:right">Prev Bal</th>';
      content += '                <th style="padding:8px 10px;text-align:right">Deducted</th>';
      content += '                <th style="padding:8px 10px;text-align:right">New Bal</th>';
      content += '                <th style="padding:8px 10px;text-align:center">Undo</th>';
      content += '              </tr>';
      content += '            </thead>';
      content += '            <tbody>';

      filteredDed.forEach(function(d) {
        var sType = getDeductionSourceType(d);
        var dDate = getDeductionDateStr(d) || '-';
        var parentAdv = advLookup[d.advanceId];
        var advRefText = parentAdv ? ((parentAdv.advanceDate || '') + ' (' + formatINR(parentAdv.amount) + ')') : '-';
        var badge = sType === 'manual'
          ? '<span style="display:inline-block;padding:2px 7px;border-radius:999px;font-size:9px;font-weight:850;background:#fffbeb;color:#b45309;border:1px solid #fde68a">✍️ MANUAL</span>'
          : '<span style="display:inline-block;padding:2px 7px;border-radius:999px;font-size:9px;font-weight:850;background:#eef2ff;color:#312e81;border:1px solid #c7d2fe">📄 SALARY</span>';

        var detailHtml = '';
        if (sType === 'manual') {
          detailHtml += '<div style="font-weight:700;color:#111827">' + esc(d.deductionMode || d.columnName || 'Manual Deduction') + '</div>';
          detailHtml += '<div style="font-size:10px;color:#64748b">' + esc(d.remarks || '—') + '</div>';
        } else {
          detailHtml += '<div style="font-weight:700;color:#111827">' + esc(d.salaryMonth || 'Salary Sheet') + '</div>';
          detailHtml += '<div style="font-size:10px;color:#64748b">📄 ' + esc(d.fileName || '') + (d.sheetName ? ' · 📑 ' + esc(d.sheetName) : '') + (d.columnName ? ' · 🧾 Col: ' + esc(d.columnName) : '') + '</div>';
        }

        content += '              <tr style="border-bottom:1px solid #f1f5f9">';
        content += '                <td style="padding:8px 10px;color:#475569;white-space:nowrap;font-weight:600">' + esc(dDate) + '</td>';
        content += '                <td style="padding:8px 10px;white-space:nowrap">' + badge + '</td>';
        content += '                <td style="padding:8px 10px">' + detailHtml + '</td>';
        content += '                <td style="padding:8px 10px;font-size:10px;color:#64748b;white-space:nowrap">' + esc(advRefText) + '</td>';
        content += '                <td style="padding:8px 10px;text-align:right;color:#64748b">' + formatINR(d.previousBalance) + '</td>';
        content += '                <td style="padding:8px 10px;text-align:right;font-weight:800;color:#15803d">-' + formatINR(d.deductedAmount) + '</td>';
        content += '                <td style="padding:8px 10px;text-align:right;font-weight:800;color:' + (d.remainingBalance > 0 ? '#dc2626' : '#15803d') + '">' + formatINR(d.remainingBalance) + '</td>';
        content += '                <td style="padding:8px 10px;text-align:center"><button onclick="ATPLAdvanceManager.confirmDeleteDeduction(\'' + esc(d.id) + '\')" style="height:24px;padding:0 7px;border:1px solid #fecaca;background:#fef2f2;color:#dc2626;border-radius:6px;cursor:pointer;font-size:10px" title="Reverse Deduction">🗑</button></td>';
        content += '              </tr>';
      });

      content += '            </tbody>';
      content += '          </table>';
      content += '        </div>';
    }
    content += '      </div>';

    content += '    </div>';

    // Footer
    content += '    <div style="padding:14px 22px;border-top:1px solid #e5e7eb;display:flex;justify-content:flex-end;background:#f8fafc">';
    content += '      <button onclick="ATPLAdvanceManager.closeModal()" style="padding:8px 18px;background:#312e81;color:#fff;border:none;border-radius:8px;font-size:12px;font-weight:800;cursor:pointer">Close</button>';
    content += '    </div>';

    content += '  </div>';
    content += '</div>';

    modal.innerHTML = content;
  }

  function viewStatement(advanceId) {
    var adv = state.advances.find(function(a) { return a.id === advanceId; });
    if (!adv) return;
    state.openHistoryEmpCode = null;

    var modal = getOrCreateModal();
    var decList = (state.deductions || []).filter(function(d) {
      return d && d.advanceId === advanceId && !isDeductionTombstoned(d);
    });

    var content = '';
    content += '<div style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(15,23,42,0.45);backdrop-filter:blur(4px);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px" onclick="if(event.target===this)ATPLAdvanceManager.closeModal()">';
    content += '  <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:16px;max-width:720px;width:100%;box-shadow:0 20px 40px rgba(15,23,42,0.18);overflow:hidden">';

    content += '    <div style="padding:18px 22px;border-bottom:1px solid #e5e7eb;display:flex;justify-content:space-between;align-items:center;background:#ffffff">';
    content += '      <div>';
    content += '        <div style="font-size:9px;font-weight:900;letter-spacing:1px;color:#7c3aed;text-transform:uppercase">TRANSACTION AUDIT STATEMENT</div>';
    content += '        <h3 style="margin:2px 0 0;font-size:18px;font-weight:850;color:#111827">Advance Statement &amp; Deductions</h3>';
    content += '        <div style="font-size:11px;color:#64748b;margin-top:2px">Employee: <strong style="color:#312e81">' + esc(adv.empName) + '</strong> (' + esc(adv.empCode) + ')</div>';
    content += '      </div>';
    content += '      <div style="display:flex;gap:8px;align-items:center">';
    content += '        <button onclick="ATPLAdvanceManager.viewEmployeeHistory(\'' + esc(adv.empCode) + '\')" style="padding:6px 11px;background:#eef2ff;border:1px solid #818cf8;color:#312e81;border-radius:8px;font-size:11px;font-weight:800;cursor:pointer">👤 Full Employee History</button>';
    content += '        <button onclick="ATPLAdvanceManager.closeModal()" style="border:1px solid #e5e7eb;background:#f9fafb;color:#64748b;width:32px;height:32px;border-radius:8px;cursor:pointer;font-size:15px;display:flex;align-items:center;justify-content:center">✕</button>';
    content += '      </div>';
    content += '    </div>';

    content += '    <div style="padding:16px 22px;border-bottom:1px solid #e5e7eb;background:#f8fafc;display:grid;grid-template-columns:repeat(3,1fr);gap:12px">';
    content += '      <div><div style="font-size:9.5px;color:#64748b;text-transform:uppercase;font-weight:800">Original Advance</div><div style="font-size:17px;font-weight:850;color:#111827">' + formatINR(adv.amount) + '</div><div style="font-size:10px;color:#94a3b8">' + esc(adv.advanceDate) + '</div></div>';
    content += '      <div><div style="font-size:9.5px;color:#64748b;text-transform:uppercase;font-weight:800">Total Deducted</div><div style="font-size:17px;font-weight:850;color:#15803d">' + formatINR(adv.recoveredAmount) + '</div><div style="font-size:10px;color:#94a3b8">' + decList.length + ' deduction(s)</div></div>';
    content += '      <div><div style="font-size:9.5px;color:#64748b;text-transform:uppercase;font-weight:800">Balance Remaining</div><div style="font-size:17px;font-weight:850;color:' + (adv.balanceAmount > 0 ? '#dc2626' : '#15803d') + '">' + formatINR(adv.balanceAmount) + '</div><div style="font-size:10px;font-weight:800;color:' + (adv.status === 'REPAID' ? '#15803d' : '#b45309') + '">' + esc(adv.status) + '</div></div>';
    content += '    </div>';

    content += '    <div style="padding:18px 22px;max-height:320px;overflow-y:auto;background:#ffffff">';
    content += '      <h4 style="margin:0 0 10px;font-size:11px;font-weight:800;color:#334155;text-transform:uppercase;letter-spacing:0.6px">Deductions History (Salary Sheet + Manual)</h4>';

    if (!decList.length) {
      content += '      <div style="text-align:center;padding:24px;color:#94a3b8;font-size:11px">No deductions have occurred yet for this advance.</div>';
    } else {
      content += '      <table style="width:100%;border-collapse:collapse;font-size:11.5px;text-align:left">';
      content += '        <thead>';
      content += '          <tr style="border-bottom:1px solid #eef2f7;color:#64748b;font-size:9.5px;text-transform:uppercase;font-weight:800">';
      content += '            <th style="padding:7px 10px">Date / Period</th>';
      content += '            <th style="padding:7px 10px">Type &amp; Source</th>';
      content += '            <th style="padding:7px 10px;text-align:right">Previous Bal</th>';
      content += '            <th style="padding:7px 10px;text-align:right">Deducted</th>';
      content += '            <th style="padding:7px 10px;text-align:right">New Bal</th>';
      content += '          </tr>';
      content += '        </thead>';
      content += '        <tbody>';
      decList.forEach(function(d) {
        var sType = getDeductionSourceType(d);
        content += '        <tr style="border-bottom:1px solid #f3f4f6">';
        content += '          <td style="padding:8px 10px;font-weight:700;color:#111827">' + esc(getDeductionDateStr(d) || d.salaryMonth || '-') + '<div style="font-size:9.5px;color:#94a3b8">' + esc(d.salaryMonth || '') + '</div></td>';
        content += '          <td style="padding:8px 10px;color:#64748b;font-size:10px">' + (sType === 'manual' ? '<strong style="color:#b45309">✍️ Manual:</strong> ' + esc(d.deductionMode || '') + (d.remarks ? ' · ' + esc(d.remarks) : '') : '<strong style="color:#312e81">📄 Sheet:</strong> ' + esc(d.fileName) + (d.sheetName ? ' · ' + esc(d.sheetName) : '') + (d.columnName ? ' (Col: ' + esc(d.columnName) + ')' : '')) + '</td>';
        content += '          <td style="padding:8px 10px;text-align:right;color:#64748b">' + formatINR(d.previousBalance) + '</td>';
        content += '          <td style="padding:8px 10px;text-align:right;font-weight:700;color:#15803d">-' + formatINR(d.deductedAmount) + '</td>';
        content += '          <td style="padding:8px 10px;text-align:right;font-weight:750;color:' + (d.remainingBalance > 0 ? '#dc2626' : '#15803d') + '">' + formatINR(d.remainingBalance) + '</td>';
        content += '        </tr>';
      });
      content += '        </tbody>';
      content += '      </table>';
    }
    content += '    </div>';

    content += '    <div style="padding:14px 22px;border-top:1px solid #e5e7eb;display:flex;justify-content:flex-end;gap:10px;background:#f8fafc">';
    if (adv.balanceAmount > 0) {
      content += '      <button onclick="ATPLAdvanceManager.openManualDeductionModal(\'' + esc(adv.empCode) + '\',\'' + esc(adv.id) + '\')" style="padding:8px 16px;background:#b45309;color:#fff;border:none;border-radius:8px;font-size:12px;font-weight:800;cursor:pointer">✂️ Manual Deduct</button>';
    }
    content += '      <button onclick="ATPLAdvanceManager.closeModal()" style="padding:8px 18px;background:#312e81;color:#fff;border:none;border-radius:8px;font-size:12px;font-weight:800;cursor:pointer;box-shadow:0 1px 3px rgba(49,46,129,0.25)">Close</button>';
    content += '    </div>';

    content += '  </div>';
    content += '</div>';

    modal.innerHTML = content;
  }

  function closeModal() {
    state.openHistoryEmpCode = null;
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
    version: '2.0.0-ENTERPRISE',
    init: function() {
      loadFromLocal();
      fetchRemoteAdvances();
      setupRealtimeListeners();
      renderUI();
    },
    getAllAdvances: function() { return state.advances; },
    getAllDeductions: function() { return state.deductions; },
    getEmployeeOutstandingBalance: getEmployeeOutstandingBalance,
    getEmployeeHistoryData: getEmployeeHistoryData,
    detectAdvanceSheetInfo: detectAdvanceSheetInfo,
    addOrUpdateAdvance: addOrUpdateAdvance,
    deleteAdvance: deleteAdvance,
    deductAdvanceManually: deductAdvanceManually,
    deleteDeduction: deleteDeduction,
    confirmDeleteDeduction: confirmDeleteDeduction,
    processSalaryFile: processSalaryFile,
    processAllSalaryFiles: processAllSalaryFiles,
    renderUI: renderUI,
    exportDataCSV: exportDataCSV,
    setTab: function(tab) {
      state.activeTab = tab;
      renderUI();
    },
    setSearch: function(q) {
      state.searchQuery = q || '';
      renderUI();
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
    setDeductionSourceFilter: function(src) {
      state.deductionSourceFilter = src || 'ALL';
      renderUI();
    },
    setHistoryFilter: function(src) {
      state.historySourceFilter = src || 'ALL';
      if (state.openHistoryEmpCode) {
        viewEmployeeHistory(state.openHistoryEmpCode);
      }
    },
    openNewModal: openNewModal,
    openManualDeductionModal: openManualDeductionModal,
    closeModal: closeModal,
    onCodeInput: onCodeInput,
    selectSuggestion: selectSuggestion,
    onManualCodeInput: onManualCodeInput,
    selectManualSuggestion: selectManualSuggestion,
    onManualTargetChange: onManualTargetChange,
    submitForm: submitForm,
    submitManualDeduction: submitManualDeduction,
    editAdvance: editAdvance,
    confirmDelete: confirmDelete,
    viewStatement: viewStatement,
    viewEmployeeHistory: viewEmployeeHistory,
    syncNow: async function(manual) {
      var btn = document.getElementById('advSyncBtn');
      if (btn) btn.innerHTML = '<span style="display:inline-block;animation:spin 1s linear infinite">🔄</span>';
      var res = await fetchRemoteAdvances(true, !!manual);
      if (btn) btn.innerHTML = '<span>🔄</span> Sync';
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
        if (window.showToast) window.showToast('✅ Scanned all salary sheets (Advance column verified). No pending deductions found.');
      }
    }
  };

  window.ATPLAdvanceManager = ATPLAdvanceManager;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      ATPLAdvanceManager.init();
    });
  } else {
    ATPLAdvanceManager.init();
  }

})(window);
