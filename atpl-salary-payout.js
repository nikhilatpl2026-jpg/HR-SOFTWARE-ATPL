/* ============================================================================
 * ATPLSalaryPayout — Monthly Salary, Emp Adjustment Points (+/-),
 * Compliance Sheet & Bank Return Re-Transfer, & Multi-Part Diff Payouts
 * ----------------------------------------------------------------------------
 * Features:
 *  1. Two Clear Payment Sheet Workflows (Bank Excel/CSV + Manual Entry):
 *     - Compliance Salary Sheet / Manual + Bank Return & A/C Change Re-Pay
 *     - Diff Master Sheet / Manual / Missed Late Diff + Multi-Part Payout Batches
 *  2. Inside Each Diff Batch (Part 1..6+): Upload Bank Payment Sheet OR enter
 *     Emp Code + Amount + Remarks manually (Workers ₹4-5L, Staff ₹1-2L,
 *     2-3 Leaders Lot, & Small Leftover <= ₹500 clearance like ₹150)
 *  3. Dashboard Totals: Compliance Di, Diff Total, Diff Di (Paid),
 *     Diff Baaki / Chhoota Hua (Leftover), & Emp Adjustment Points (+/-)
 *  4. Full Edit & Delete with Tombstones on every Ledger, Point, Return & Batch
 *  5. Cross-Browser Cloud Sync: Google Drive/GAS + /api/sync/salary-payout +
 *     SSE + BroadcastChannel + localStorage
 * ============================================================================ */
(function(window) {
  'use strict';

  var STORAGE_KEY = 'ATPL_SalaryPayoutData_V1';
  var CLOUD_FILENAME = 'ATPL_SALARY_PAYOUT_DATA.json';
  var CHANNEL_NAME = 'ATPL_SYNC_CHANNEL';
  var DEFAULT_GAS_URL = 'https://script.google.com/macros/s/AKfycbz8aQ8jB4fM_S1pA_x55bK033b4P9fM4H_1_K1b/exec';

  var POINT_DIRECTIONS = [
    { key: 'ADD', label: '+ Add / Extra (Paise Jyada)' },
    { key: 'DEDUCT', label: '- Less / Cut / Hold (Paise Kam)' },
    { key: 'NOTE', label: 'Note / Point Only (₹0)' }
  ];

  var POINT_APPLY_TO = [
    { key: 'DIFF', label: 'Diff Salary' },
    { key: 'COMPLIANCE', label: 'Compliance Note' },
    { key: 'GENERAL', label: 'General Salary' }
  ];

  var RETURN_REASONS = [
    'Wrong Account Number',
    'IFSC Mismatch / Bank Merged',
    'Account Closed / Frozen',
    'Beneficiary Name Mismatch',
    'Bank Hold / Technical Return',
    'Other Reason'
  ];

  var LOT_TYPES = [
    { key: 'WORKERS_LOT', label: 'Workers Main Lot (₹4-5L)' },
    { key: 'STAFF_LOT', label: 'Staff / Second Lot (₹1-2L)' },
    { key: 'LEADERS_LOT', label: 'Leaders / Incharge Lot (2-3 Leaders)' },
    { key: 'PART_PAYMENT', label: 'Part Payment Lot' },
    { key: 'LEFTOVER_CLEARANCE', label: 'Small Leftover Clearance (≤ ₹500)' },
    { key: 'CASH_LOT', label: 'Cash / Counter Lot' }
  ];

  var PAYMENT_MODES = ['Bank NEFT / RTGS', 'IMPS / Bank', 'Cash', 'UPI / Online', 'Cheque'];
  var SIGNATORIES = ['Sarthak ji', 'Manish ji', 'Ayush ji', 'Other'];

  function todayIso() {
    return new Date().toISOString().slice(0, 10);
  }

  function currentMonthIso() {
    return new Date().toISOString().slice(0, 7);
  }

  var state = {
    selectedMonth: currentMonthIso(),
    activeTab: 'overview', // 'overview' | 'points' | 'compliance' | 'diff'
    searchQuery: '',
    overviewFilter: 'ALL', // 'ALL' | 'DIFF_PENDING' | 'LEFTOVER_SMALL' | 'HAS_POINTS' | 'RETURN_PENDING'
    monthSummaries: {},
    uploadedSheets: {},
    empSalaries: {},
    points: {},
    returns: {},
    diffBatches: {},
    tombstones: {},
    editingPointId: null,
    editingReturnId: null,
    editingBatchId: null,
    _batchExtraRows: [],
    lastSyncAt: ''
  };

  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function round2(n) {
    return Math.round(((Number(n) || 0) + Number.EPSILON) * 100) / 100;
  }

  function formatINR(num) {
    var val = round2(num);
    try {
      return '₹' + val.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
    } catch (_) {
      return '₹' + val;
    }
  }

  function normalizeCode(code) {
    var c = String(code === null || code === undefined ? '' : code).trim().replace(/\.0$/, '');
    if (/^\d+$/.test(c)) {
      return c.replace(/^0+/, '') || '0';
    }
    return c.toLowerCase();
  }

  function formatMonthLabel(mk) {
    var m = String(mk || '').match(/^(\d{4})-(\d{2})$/);
    if (!m) return mk || '-';
    var names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var idx = parseInt(m[2], 10) - 1;
    return (names[idx] || m[2]) + ' ' + m[1];
  }

  function getEmployeeMasterList() {
    var list = (window.EM && Array.isArray(window.EM.data)) ? window.EM.data : [];
    if (!list.length && typeof window.localStorage !== 'undefined') {
      try {
        var raw = window.localStorage.getItem('ATPL_EmployeeMaster_V1');
        if (raw) {
          var parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) list = parsed;
        }
      } catch (_) {}
    }
    return list;
  }

  function findEmployeeByCode(code) {
    var norm = normalizeCode(code);
    if (!norm) return null;
    var list = getEmployeeMasterList();
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (!e) continue;
      var c = e.emp_id || e.empCode || e.code || e['Emp Code'] || '';
      if (normalizeCode(c) === norm) {
        return {
          empCode: String(c).trim(),
          name: String(e.name || e.emp_name || e['Employee Name'] || ('Employee ' + code)).trim(),
          dept: String(e.dept || e.department || e['Department'] || '').trim(),
          desig: String(e.desig || e.designation || e['Designation'] || '').trim(),
          accountNo: String(e.account_no || e.accountNo || e.bank_account || e['A/C No'] || '').trim(),
          ifsc: String(e.ifsc || e.ifsc_code || e['IFSC'] || '').trim(),
          bankName: String(e.bank_name || e.bankName || '').trim(),
          status: String(e.status || 'ACTIVE').trim()
        };
      }
    }
    var salKey = state.selectedMonth + '::' + norm;
    var sal = state.empSalaries[salKey];
    if (!sal) {
      var allSal = Object.values(state.empSalaries || {});
      for (var j = 0; j < allSal.length; j++) {
        if (allSal[j] && normalizeCode(allSal[j].empCode) === norm) {
          sal = allSal[j];
          break;
        }
      }
    }
    if (sal) {
      return {
        empCode: sal.empCode,
        name: sal.empName || ('Employee ' + sal.empCode),
        dept: sal.dept || '',
        desig: sal.desig || '',
        accountNo: sal.accountNo || '',
        ifsc: sal.ifsc || '',
        bankName: sal.bankName || '',
        status: 'ACTIVE'
      };
    }
    return null;
  }

  function findEmployeeByAccount(accNo) {
    var cleanAcc = String(accNo || '').replace(/\s+/g, '').replace(/^0+/, '');
    if (!cleanAcc) return null;
    var list = getEmployeeMasterList();
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (!e) continue;
      var ec = String(e.account_no || e.accountNo || e.bank_account || e['A/C No'] || '').replace(/\s+/g, '').replace(/^0+/, '');
      if (ec && ec === cleanAcc) {
        return {
          empCode: String(e.emp_id || e.empCode || e.code || '').trim(),
          name: String(e.name || e.emp_name || '').trim(),
          dept: String(e.dept || e.department || '').trim(),
          desig: String(e.desig || e.designation || '').trim(),
          accountNo: String(e.account_no || e.accountNo || '').trim(),
          ifsc: String(e.ifsc || e.ifsc_code || '').trim()
        };
      }
    }
    return null;
  }

  // ── CLOUD & LOCAL PERSISTENCE ENGINE ──
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
      else if (c < 2048) utf8Bytes.push(192 | (c >> 6), 128 | (c & 63));
      else if (c < 65536) utf8Bytes.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63));
      else utf8Bytes.push(240 | (c >> 18), 128 | ((c >> 12) & 63), 128 | ((c >> 6) & 63), 128 | (c & 63));
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
      var e1 = B64_CHARS.indexOf(clean.charAt(i));
      var e2 = B64_CHARS.indexOf(clean.charAt(i + 1));
      var e3 = clean.charAt(i + 2) === '=' ? -1 : B64_CHARS.indexOf(clean.charAt(i + 2));
      var e4 = clean.charAt(i + 3) === '=' ? -1 : B64_CHARS.indexOf(clean.charAt(i + 3));
      bytes.push((e1 << 2) | (e2 >> 4));
      if (e3 !== -1) bytes.push(((e2 & 15) << 4) | (e3 >> 2));
      if (e4 !== -1) bytes.push(((e3 & 3) << 6) | e4);
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

  function getGasUrl() {
    try {
      var custom = (window.localStorage && window.localStorage.getItem('ATPL_CUSTOM_GAS_URL')) || '';
      if (custom && /^https:\/\/script\.google\.com\/macros\/s\//.test(custom.trim())) return custom.trim();
      if (window.ATPL_CUSTOM_GAS_URL && /^https:\/\/script\.google\.com\/macros\/s\//.test(String(window.ATPL_CUSTOM_GAS_URL).trim())) {
        return String(window.ATPL_CUSTOM_GAS_URL).trim();
      }
      if (window.ATPL_GAS_URL && /^https:\/\/script\.google\.com\/macros\/s\//.test(String(window.ATPL_GAS_URL).trim())) {
        return String(window.ATPL_GAS_URL).trim();
      }
    } catch (_) {}
    return DEFAULT_GAS_URL;
  }

  async function callGoogleBackend(action, params) {
    if (window.ATPLGoogleSync && typeof window.ATPLGoogleSync.callGoogleBackend === 'function') {
      try {
        var res = await window.ATPLGoogleSync.callGoogleBackend(action, params);
        if (res != null) return res;
      } catch (_) {}
    }
    var endpoint = getGasUrl();
    if (!endpoint || typeof fetch !== 'function') return null;
    var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var tid = (controller && typeof setTimeout === 'function') ? setTimeout(function() { controller.abort(); }, 12000) : null;
    try {
      var payload = Object.assign({ action: action, sender: 'salpayout_' + Date.now(), _ts: Date.now() }, params || {});
      var r = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload),
        signal: controller ? controller.signal : undefined
      });
      if (tid) clearTimeout(tid);
      if (r && r.ok) return await r.json();
    } catch (_) {
      if (tid) clearTimeout(tid);
    }
    return null;
  }

  function exportAuthoritativePayload() {
    return {
      version: 1,
      updatedAt: new Date().toISOString(),
      monthSummaries: state.monthSummaries || {},
      uploadedSheets: state.uploadedSheets || {},
      empSalaries: state.empSalaries || {},
      points: state.points || {},
      returns: state.returns || {},
      diffBatches: state.diffBatches || {},
      tombstones: state.tombstones || {}
    };
  }

  function saveToLocal() {
    try {
      if (typeof window.localStorage !== 'undefined') {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(exportAuthoritativePayload()));
      }
    } catch (_) {}
  }

  function loadFromLocal() {
    try {
      if (typeof window.localStorage !== 'undefined') {
        var raw = window.localStorage.getItem(STORAGE_KEY);
        if (raw) {
          var parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object') {
            applyCloudData(parsed);
          }
        }
      }
    } catch (_) {}
  }

  function applyCloudData(cloud) {
    if (!cloud || typeof cloud !== 'object') return false;
    var incTombs = (cloud.tombstones && typeof cloud.tombstones === 'object') ? cloud.tombstones : {};
    Object.keys(incTombs).forEach(function(k) {
      if (!incTombs[k]) return;
      var pTs = Date.parse(state.tombstones[k] || 0) || 0;
      var nTs = Date.parse(incTombs[k] || 0) || 0;
      if (nTs >= pTs) state.tombstones[k] = incTombs[k];
    });

    var sections = ['monthSummaries', 'uploadedSheets', 'empSalaries', 'points', 'returns', 'diffBatches'];
    sections.forEach(function(sec) {
      var localMap = state[sec] || {};
      var remoteMap = (cloud[sec] && typeof cloud[sec] === 'object') ? cloud[sec] : {};
      Object.keys(localMap).forEach(function(id) {
        var tTs = Date.parse(state.tombstones[id] || 0) || 0;
        var rTs = Date.parse((localMap[id] && (localMap[id].updatedAt || localMap[id].createdAt)) || 0) || 0;
        if (tTs && tTs >= rTs) delete localMap[id];
      });
      Object.keys(remoteMap).forEach(function(id) {
        var rec = remoteMap[id];
        if (!rec || typeof rec !== 'object') return;
        var rTs = Date.parse(rec.updatedAt || rec.createdAt || 0) || 0;
        var tTs = Date.parse(state.tombstones[id] || 0) || 0;
        if (tTs && tTs >= rTs) return;
        var cur = localMap[id];
        var cTs = cur ? (Date.parse(cur.updatedAt || cur.createdAt || 0) || 0) : 0;
        if (!cur || rTs >= cTs) {
          localMap[id] = rec;
        }
      });
      state[sec] = localMap;
    });
    return true;
  }

  function stripFromWindowFiles() {
    try {
      if (Array.isArray(window.FILES)) {
        var changed = false;
        window.FILES = window.FILES.filter(function(f) {
          var n = f && String(f.name || '').toLowerCase().trim();
          if (n === CLOUD_FILENAME.toLowerCase()) {
            changed = true;
            return false;
          }
          return true;
        });
        if (changed && typeof window.renderFiles === 'function') {
          try { window.renderFiles(); } catch (_) {}
        }
      }
    } catch (_) {}
  }

  function broadcastSync(action, details) {
    var payload = { action: action || 'salary_payout_updated', details: details || {}, ts: Date.now() };
    if (typeof window.BroadcastChannel !== 'undefined') {
      try {
        var bc = new window.BroadcastChannel(CHANNEL_NAME);
        bc.postMessage(payload);
        bc.close();
      } catch (_) {}
    }
    try {
      if (typeof window.localStorage !== 'undefined') {
        window.localStorage.setItem('ATPL_TRIGGER_EVENT', JSON.stringify(payload));
      }
    } catch (_) {}
  }

  var activePushPromise = null;
  var pendingPushQueued = false;

  function pushCloudNow(reason) {
    if (activePushPromise) {
      pendingPushQueued = true;
      return activePushPromise;
    }
    activePushPromise = (async function() {
      var gasOk = false;
      var srvOk = false;
      try {
        do {
          pendingPushQueued = false;
          var body = exportAuthoritativePayload();
          try {
            var b64 = utf8ToB64(JSON.stringify(body));
            var gRes = await callGoogleBackend('uploadFile', {
              fileName: CLOUD_FILENAME,
              fileBase64: b64,
              mimeType: 'application/json'
            });
            if (gRes && gRes.ok) gasOk = true;
          } catch (_) {}
          try {
            if (typeof fetch === 'function') {
              var sRes = await fetch('/api/sync/salary-payout', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
              }).catch(function() { return null; });
              if (sRes && sRes.ok) {
                var sJson = await sRes.json().catch(function() { return null; });
                if (sJson && sJson.ok && sJson.data) {
                  applyCloudData(sJson.data);
                  saveToLocal();
                }
                srvOk = true;
              }
            }
          } catch (_) {}
        } while (pendingPushQueued);
        state.lastSyncAt = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        broadcastSync('salary_payout_updated', { reason: reason || 'save' });
        return { ok: gasOk || srvOk, gasOk: gasOk, srvOk: srvOk };
      } finally {
        activePushPromise = null;
      }
    })();
    return activePushPromise;
  }

  var activeFetchPromise = null;
  var lastFetchTime = 0;

  function fetchCloudNow(force, isManual) {
    var now = Date.now();
    if (!force && (now - lastFetchTime < 8000)) {
      return Promise.resolve({ ok: true, throttled: true });
    }
    if (activeFetchPromise) return activeFetchPromise;
    activeFetchPromise = (async function() {
      var loaded = false;
      try {
        try {
          var dl = await callGoogleBackend('downloadFile', { fileName: CLOUD_FILENAME });
          if (dl && dl.ok && dl.fileBase64) {
            var jsonStr = b64ToUtf8(dl.fileBase64);
            var parsed = jsonStr ? JSON.parse(jsonStr) : null;
            if (parsed && typeof parsed === 'object') {
              applyCloudData(parsed);
              loaded = true;
            }
          }
        } catch (_) {}
        try {
          if (typeof fetch === 'function') {
            var sr = await fetch('/api/sync/salary-payout', { cache: 'no-store' }).catch(function() { return null; });
            if (sr && sr.ok) {
              var sj = await sr.json().catch(function() { return null; });
              if (sj && sj.ok && sj.data) {
                applyCloudData(sj.data);
                loaded = true;
              }
            }
          }
        } catch (_) {}
        stripFromWindowFiles();
        if (loaded) {
          lastFetchTime = Date.now();
          state.lastSyncAt = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
          saveToLocal();
          renderUI();
        }
        return { ok: loaded, manual: !!isManual };
      } catch (err) {
        return { ok: false, error: err && err.message ? err.message : 'sync_error' };
      } finally {
        activeFetchPromise = null;
      }
    })();
    return activeFetchPromise;
  }

  function setupRealtimeListeners() {
    if (window.__ATPL_SAL_PAYOUT_LISTENERS__) return;
    window.__ATPL_SAL_PAYOUT_LISTENERS__ = true;

    if (typeof window.BroadcastChannel !== 'undefined') {
      try {
        var bc = new window.BroadcastChannel(CHANNEL_NAME);
        bc.onmessage = function(ev) {
          if (ev && ev.data && ev.data.action && ev.data.action.indexOf('salary_payout') === 0) {
            fetchCloudNow(true, false);
          }
        };
      } catch (_) {}
    }

    if (typeof window.addEventListener === 'function') {
      window.addEventListener('storage', function(e) {
        if (e && e.key === STORAGE_KEY && e.newValue) {
          try {
            applyCloudData(JSON.parse(e.newValue));
            renderUI();
          } catch (_) {}
        } else if (e && e.key === 'ATPL_TRIGGER_EVENT' && e.newValue) {
          try {
            var ev = JSON.parse(e.newValue);
            if (ev && ev.action && ev.action.indexOf('salary_payout') === 0) {
              fetchCloudNow(true, false);
            }
          } catch (_) {}
        }
      });
      window.addEventListener('focus', function() { fetchCloudNow(false, false); });
    }

    if (typeof document !== 'undefined' && document.addEventListener) {
      document.addEventListener('visibilitychange', function() {
        if (!document.hidden) fetchCloudNow(false, false);
      });
    }

    if (typeof setInterval === 'function') {
      setInterval(function() {
        if (typeof document !== 'undefined' && !document.hidden) {
          fetchCloudNow(false, false);
        }
      }, 25000);
    }

    if (typeof window.EventSource !== 'undefined') {
      try {
        var es = new window.EventSource('/api/sync/events');
        es.addEventListener('salary_payout_updated', function() {
          fetchCloudNow(true, false);
        });
      } catch (_) {}
    }
  }

  // ── ANALYTICS & LEDGER COMPUTATION ──
  function getMonthSummary(monthKey) {
    var mk = monthKey || state.selectedMonth;
    return state.monthSummaries[mk] || {
      monthKey: mk,
      complianceTarget: 0,
      diffTarget: 0,
      complianceDisbursed: false,
      complianceDate: '',
      complianceUtr: '',
      complianceNotes: ''
    };
  }

  function getMonthUploadedSheets(monthKey) {
    var mk = monthKey || state.selectedMonth;
    return Object.values(state.uploadedSheets || {}).filter(function(sh) {
      return sh && sh.monthKey === mk && !state.tombstones[sh.id];
    }).sort(function(a, b) {
      return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
    });
  }

  function isComplianceLockedForMonth(monthKey) {
    return getMonthUploadedSheets(monthKey).some(function(sh) {
      return (sh.kind === 'COMPLIANCE' || sh.kind === 'BOTH') && !!sh.locked;
    });
  }

  function listAvailableMonths() {
    var set = {};
    set[state.selectedMonth || currentMonthIso()] = true;
    set[currentMonthIso()] = true;
    Object.keys(state.monthSummaries || {}).forEach(function(k) { if (k) set[k] = true; });
    Object.values(state.uploadedSheets || {}).forEach(function(r) { if (r && r.monthKey && !state.tombstones[r.id]) set[r.monthKey] = true; });
    Object.values(state.empSalaries || {}).forEach(function(r) { if (r && r.monthKey) set[r.monthKey] = true; });
    Object.values(state.points || {}).forEach(function(r) { if (r && r.monthKey) set[r.monthKey] = true; });
    Object.values(state.returns || {}).forEach(function(r) { if (r && r.monthKey) set[r.monthKey] = true; });
    Object.values(state.diffBatches || {}).forEach(function(r) { if (r && r.monthKey) set[r.monthKey] = true; });
    return Object.keys(set).sort(function(a, b) { return String(b).localeCompare(String(a)); });
  }

  function getMonthPoints(monthKey) {
    var mk = monthKey || state.selectedMonth;
    return Object.values(state.points || {}).filter(function(p) {
      return p && p.monthKey === mk && !state.tombstones[p.id];
    }).sort(function(a, b) {
      return String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || ''));
    });
  }

  function getMonthReturns(monthKey) {
    var mk = monthKey || state.selectedMonth;
    return Object.values(state.returns || {}).filter(function(r) {
      return r && r.monthKey === mk && !state.tombstones[r.id];
    }).sort(function(a, b) {
      if ((a.status === 'PENDING') !== (b.status === 'PENDING')) return a.status === 'PENDING' ? -1 : 1;
      return String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || ''));
    });
  }

  function getMonthBatches(monthKey) {
    var mk = monthKey || state.selectedMonth;
    return Object.values(state.diffBatches || {}).filter(function(b) {
      return b && b.monthKey === mk && !state.tombstones[b.id];
    }).sort(function(a, b) {
      var pa = Number(a.partNumber) || 999;
      var pb = Number(b.partNumber) || 999;
      if (pa !== pb) return pa - pb;
      return String(a.paymentDate || a.createdAt || '').localeCompare(String(b.paymentDate || b.createdAt || ''));
    });
  }

  function getBatchPaidTotal(batch) {
    if (!batch) return 0;
    var allocs = Array.isArray(batch.allocations) ? batch.allocations : [];
    var allocSum = allocs.reduce(function(acc, item) {
      return round2(acc + (Number(item && item.amount) || 0));
    }, 0);
    var lump = round2(Number(batch.lumpSumAmount) || 0);
    return lump > 0 ? lump : allocSum;
  }

  function computeMonthLedger(monthKey) {
    var mk = monthKey || state.selectedMonth;
    var summary = getMonthSummary(mk);
    var empMap = {};

    function ensureRow(empCode, hint) {
      var norm = normalizeCode(empCode);
      if (!norm) return null;
      if (!empMap[norm]) {
        var em = findEmployeeByCode(empCode);
        empMap[norm] = {
          normCode: norm,
          salId: (hint && hint.id) || (mk + '::' + norm),
          empCode: (hint && hint.empCode) || (em && em.empCode) || String(empCode).trim(),
          empName: (hint && hint.empName) || (em && em.name) || ('Employee ' + empCode),
          dept: (hint && hint.dept) || (em && em.dept) || '',
          desig: (hint && hint.desig) || (em && em.desig) || '',
          accountNo: (hint && hint.accountNo) || (em && em.accountNo) || '',
          ifsc: (hint && hint.ifsc) || (em && em.ifsc) || '',
          manualAmount: Number(hint && hint.manualAmount) || 0,
          complianceAmount: Number(hint && hint.complianceAmount) || 0,
          pfEmployee: Number(hint && hint.pfEmployee) || 0,
          esicEmployee: Number(hint && hint.esicEmployee) || 0,
          pfEmployer: Number(hint && hint.pfEmployer) || 0,
          esicEmployer: Number(hint && hint.esicEmployer) || 0,
          advanceDeduction: Number(hint && hint.advanceDeduction) || 0,
          totalDeduction: Number(hint && hint.totalDeduction) || 0,
          baseDiffAmount: Number(hint && hint.baseDiffAmount) || 0,
          missedDiffAmount: Number(hint && hint.missedDiffAmount) || 0,
          remarks: String((hint && hint.remarks) || '').trim(),
          sourceFile: String((hint && hint.sourceFile) || '').trim(),
          hasSalaryRecord: !!(hint && hint.hasSalaryRecord),
          plusPoints: 0,
          minusPoints: 0,
          noteCount: 0,
          pointsList: [],
          diffPaid: 0,
          batchBreakdown: [],
          returnsPendingCount: 0,
          returnsPendingAmount: 0,
          returnsList: []
        };
      }
      return empMap[norm];
    }

    // 1. Imported / manually entered month salary rows
    Object.values(state.empSalaries || {}).forEach(function(s) {
      if (!s || s.monthKey !== mk || state.tombstones[s.id]) return;
      var row = ensureRow(s.empCode, Object.assign({}, s, { hasSalaryRecord: true }));
      if (!row) return;
      row.salId = s.id;
      row.hasSalaryRecord = true;
      row.empCode = s.empCode || row.empCode;
      row.empName = s.empName || row.empName;
      row.dept = s.dept || row.dept;
      row.desig = s.desig || row.desig;
      row.accountNo = s.accountNo || row.accountNo;
      row.ifsc = s.ifsc || row.ifsc;
      row.manualAmount = round2(Number(s.manualAmount) || 0);
      row.complianceAmount = round2(Number(s.complianceAmount) || 0);
      row.pfEmployee = round2(Number(s.pfEmployee) || 0);
      row.esicEmployee = round2(Number(s.esicEmployee) || 0);
      row.pfEmployer = round2(Number(s.pfEmployer) || 0);
      row.esicEmployer = round2(Number(s.esicEmployer) || 0);
      row.advanceDeduction = round2(Number(s.advanceDeduction) || 0);
      row.totalDeduction = round2(Number(s.totalDeduction) || 0);
      row.baseDiffAmount = round2(Number(s.baseDiffAmount) || 0);
      row.missedDiffAmount = round2(Number(s.missedDiffAmount) || 0);
      row.remarks = s.remarks || row.remarks || '';
      row.sourceFile = s.sourceFile || row.sourceFile || '';
    });

    // 2. Emp Adjustment Points (+/-)
    var pts = getMonthPoints(mk);
    var totalPlusPoints = 0;
    var totalMinusPoints = 0;
    pts.forEach(function(p) {
      var row = ensureRow(p.empCode, { empCode: p.empCode, empName: p.empName, dept: p.dept, desig: p.desig });
      if (!row) return;
      row.pointsList.push(p);
      if (p.direction === 'NOTE') {
        row.noteCount++;
        return;
      }
      var amt = round2(Number(p.amount) || 0);
      if (p.direction === 'ADD') {
        totalPlusPoints = round2(totalPlusPoints + amt);
        if (p.applyTo !== 'COMPLIANCE') row.plusPoints = round2(row.plusPoints + amt);
      } else if (p.direction === 'DEDUCT') {
        totalMinusPoints = round2(totalMinusPoints + amt);
        if (p.applyTo !== 'COMPLIANCE') row.minusPoints = round2(row.minusPoints + amt);
      }
    });

    // 3. Compliance Bank Returns
    var rets = getMonthReturns(mk);
    var pendingReturnTotal = 0;
    var pendingReturnCount = 0;
    rets.forEach(function(r) {
      var row = ensureRow(r.empCode, { empCode: r.empCode, empName: r.empName });
      if (row) {
        row.returnsList.push(r);
        if (r.status === 'PENDING') {
          row.returnsPendingCount++;
          row.returnsPendingAmount = round2(row.returnsPendingAmount + (Number(r.amount) || 0));
        }
      }
      if (r.status === 'PENDING') {
        pendingReturnCount++;
        pendingReturnTotal = round2(pendingReturnTotal + (Number(r.amount) || 0));
      }
    });

    // 4. Diff Multi-Part Payout Batches
    var batches = getMonthBatches(mk);
    var totalBatchPaidAll = 0;
    var totalBatchPlannedAll = 0;
    var disbursedBatchCount = 0;
    var lumpSumUnallocated = 0;

    batches.forEach(function(b) {
      var allocs = Array.isArray(b.allocations) ? b.allocations : [];
      var allocSum = 0;
      allocs.forEach(function(al) {
        var aAmt = round2(Number(al && al.amount) || 0);
        if (aAmt <= 0) return;
        allocSum = round2(allocSum + aAmt);
        var row = ensureRow(al.empCode, { empCode: al.empCode, empName: al.empName });
        if (row && b.status !== 'CANCELLED') {
          row.diffPaid = round2(row.diffPaid + aAmt);
          row.batchBreakdown.push({
            batchId: b.id,
            partNumber: b.partNumber,
            title: b.title,
            amount: aAmt,
            remarks: al.remarks || '',
            status: b.status || 'DISBURSED'
          });
        }
      });
      var batchEffective = getBatchPaidTotal(b);
      if ((Number(b.lumpSumAmount) || 0) > allocSum) {
        lumpSumUnallocated = round2(lumpSumUnallocated + (Number(b.lumpSumAmount) - allocSum));
      }
      if (b.status === 'PLANNED') {
        totalBatchPlannedAll = round2(totalBatchPlannedAll + batchEffective);
      } else {
        totalBatchPaidAll = round2(totalBatchPaidAll + batchEffective);
        disbursedBatchCount++;
      }
    });

    // 5. Finalize per-employee Net Diff & Leftover
    var rows = Object.values(empMap).map(function(r) {
      var effectiveBaseDiff = round2(r.baseDiffAmount + r.missedDiffAmount);
      r.effectiveBaseDiff = effectiveBaseDiff;
      r.netDiffAmount = Math.max(0, round2(effectiveBaseDiff + r.plusPoints - r.minusPoints));
      r.diffRemaining = Math.max(0, round2(r.netDiffAmount - r.diffPaid));
      r.isSmallLeftover = r.diffRemaining > 0 && r.diffRemaining <= 500;
      return r;
    }).sort(function(a, b) {
      return String(a.empCode).localeCompare(String(b.empCode), undefined, { numeric: true });
    });

    var monthUploadedSheets = getMonthUploadedSheets(mk);
    var complianceSheets = monthUploadedSheets.filter(function(sh) { return sh.kind === 'COMPLIANCE' || sh.kind === 'BOTH'; });
    var diffSheets = monthUploadedSheets.filter(function(sh) { return sh.kind === 'DIFF' || sh.kind === 'BOTH'; });
    var complianceLocked = complianceSheets.some(function(sh) { return !!sh.locked; });

    var lumpComplianceSheets = monthUploadedSheets.reduce(function(acc, sh) {
      if ((sh.kind === 'COMPLIANCE' || sh.kind === 'BOTH') && (!Array.isArray(sh.rows) || sh.rows.length === 0)) {
        return round2(acc + (Number(sh.complianceAmount) || 0));
      }
      return acc;
    }, 0);
    var lumpDiffSheets = monthUploadedSheets.reduce(function(acc, sh) {
      if ((sh.kind === 'DIFF' || sh.kind === 'BOTH') && (!Array.isArray(sh.rows) || sh.rows.length === 0)) {
        return round2(acc + (Number(sh.diffAmount) || 0));
      }
      return acc;
    }, 0);

    var empComplianceSum = round2(rows.reduce(function(acc, r) { return round2(acc + r.complianceAmount); }, 0) + lumpComplianceSheets);
    var empManualSum = rows.reduce(function(acc, r) { return round2(acc + r.manualAmount); }, 0);
    var empPfSum = rows.reduce(function(acc, r) { return round2(acc + r.pfEmployee); }, 0);
    var empEsicSum = rows.reduce(function(acc, r) { return round2(acc + r.esicEmployee); }, 0);
    var empAdvanceDedSum = rows.reduce(function(acc, r) { return round2(acc + r.advanceDeduction); }, 0);
    var empBaseDiffSum = round2(rows.reduce(function(acc, r) { return round2(acc + r.effectiveBaseDiff); }, 0) + lumpDiffSheets);
    var empNetDiffSum = round2(rows.reduce(function(acc, r) { return round2(acc + r.netDiffAmount); }, 0) + lumpDiffSheets);
    var empMissedDiffSum = rows.reduce(function(acc, r) { return round2(acc + r.missedDiffAmount); }, 0);
    var empDiffRemainingSum = rows.reduce(function(acc, r) { return round2(acc + r.diffRemaining); }, 0);
    var smallLeftoverRows = rows.filter(function(r) { return r.isSmallLeftover; });
    var smallLeftoverTotal = smallLeftoverRows.reduce(function(acc, r) { return round2(acc + r.diffRemaining); }, 0);

    var compTarget = round2(Number(summary.complianceTarget) || 0);
    var complianceTotal = compTarget > 0 && empComplianceSum === 0 ? compTarget : (empComplianceSum > 0 ? Math.max(compTarget, empComplianceSum) : compTarget);
    var complianceEmpCount = rows.filter(function(r) { return r.complianceAmount > 0; }).length;

    var diffTarget = round2(Number(summary.diffTarget) || 0);
    var diffTotal = diffTarget > 0 && empBaseDiffSum === 0
      ? Math.max(0, round2(diffTarget + totalPlusPoints - totalMinusPoints))
      : Math.max(diffTarget, empNetDiffSum);

    var diffRemainingTotal = (empNetDiffSum > 0 && lumpDiffSheets === 0 && diffTarget <= empNetDiffSum && lumpSumUnallocated === 0)
      ? empDiffRemainingSum
      : Math.max(0, round2(diffTotal - totalBatchPaidAll));

    return {
      monthKey: mk,
      summary: summary,
      rows: rows,
      points: pts,
      returns: rets,
      batches: batches,
      uploadedSheets: monthUploadedSheets,
      complianceSheets: complianceSheets,
      diffSheets: diffSheets,
      complianceLocked: complianceLocked,
      complianceTotal: complianceTotal,
      complianceEmpCount: complianceEmpCount,
      manualTotal: empManualSum,
      pfTotal: empPfSum,
      esicTotal: empEsicSum,
      advanceDedTotal: empAdvanceDedSum,
      diffTotal: diffTotal,
      empMissedDiffSum: empMissedDiffSum,
      totalMonthSalary: round2(complianceTotal + diffTotal),
      totalBatchPaid: totalBatchPaidAll,
      totalBatchPlanned: totalBatchPlannedAll,
      disbursedBatchCount: disbursedBatchCount,
      diffRemainingTotal: diffRemainingTotal,
      smallLeftoverRows: smallLeftoverRows,
      smallLeftoverTotal: smallLeftoverTotal,
      pendingReturnCount: pendingReturnCount,
      pendingReturnTotal: pendingReturnTotal,
      totalPlusPoints: totalPlusPoints,
      totalMinusPoints: totalMinusPoints,
      netPointsImpact: round2(totalPlusPoints - totalMinusPoints)
    };
  }

  // ── CRUD OPERATIONS (WITH REAL-TIME CLOUD SYNC & TOMBSTONES) ──
  function setSelectedMonth(mk) {
    if (!mk) return;
    state.selectedMonth = String(mk).trim();
    renderUI();
  }

  function setTab(tab) {
    state.activeTab = tab || 'overview';
    renderUI();
  }

  function setOverviewFilter(filterKey) {
    state.overviewFilter = filterKey || 'ALL';
    renderUI();
  }

  function setSearch(q) {
    state.searchQuery = String(q || '');
    renderUI();
  }

  function saveMonthSummary(payload) {
    payload = payload || {};
    var mk = String(payload.monthKey || state.selectedMonth).trim();
    if (!mk) return { ok: false };
    var prev = getMonthSummary(mk);
    var nowIso = new Date().toISOString();
    var rec = {
      id: mk,
      monthKey: mk,
      complianceTarget: payload.complianceTarget !== undefined ? Math.max(0, round2(payload.complianceTarget)) : (Number(prev.complianceTarget) || 0),
      diffTarget: payload.diffTarget !== undefined ? Math.max(0, round2(payload.diffTarget)) : (Number(prev.diffTarget) || 0),
      complianceDisbursed: payload.complianceDisbursed !== undefined ? !!payload.complianceDisbursed : !!prev.complianceDisbursed,
      complianceDate: payload.complianceDate !== undefined ? String(payload.complianceDate).trim() : (prev.complianceDate || ''),
      complianceUtr: payload.complianceUtr !== undefined ? String(payload.complianceUtr).trim() : (prev.complianceUtr || ''),
      complianceNotes: payload.complianceNotes !== undefined ? String(payload.complianceNotes).trim() : (prev.complianceNotes || ''),
      updatedAt: nowIso
    };
    delete state.tombstones[mk];
    state.monthSummaries[mk] = rec;
    saveToLocal();
    renderUI();
    pushCloudNow('month_summary');
    return { ok: true, record: rec };
  }

  function upsertEmpSalary(payload) {
    payload = payload || {};
    var mk = String(payload.monthKey || state.selectedMonth).trim();
    var code = String(payload.empCode || '').trim();
    if (!mk || !code) return { ok: false, error: 'EMP_CODE_REQUIRED' };
    var id = mk + '::' + normalizeCode(code);
    var em = findEmployeeByCode(code);
    var prev = state.empSalaries[id];
    var nowIso = new Date().toISOString();

    // Support adding missed/chhoota diff cleanly on top of existing row
    var missedAdd = payload.addMissedDiff !== undefined ? Math.max(0, round2(Number(payload.addMissedDiff) || 0)) : 0;
    var nextMissed = payload.missedDiffAmount !== undefined
      ? Math.max(0, round2(Number(payload.missedDiffAmount) || 0))
      : round2(((prev && Number(prev.missedDiffAmount)) || 0) + missedAdd);

    var rec = {
      id: id,
      monthKey: mk,
      empCode: code,
      empName: String(payload.empName || (em && em.name) || (prev && prev.empName) || ('Employee ' + code)).trim(),
      dept: String(payload.dept || (em && em.dept) || (prev && prev.dept) || '').trim(),
      desig: String(payload.desig || (em && em.desig) || (prev && prev.desig) || '').trim(),
      accountNo: String(payload.accountNo !== undefined ? payload.accountNo : ((em && em.accountNo) || (prev && prev.accountNo) || '')).trim(),
      ifsc: String(payload.ifsc !== undefined ? payload.ifsc : ((em && em.ifsc) || (prev && prev.ifsc) || '')).trim(),
      manualAmount: round2(Number(payload.manualAmount !== undefined ? payload.manualAmount : (prev && prev.manualAmount)) || 0),
      complianceAmount: round2(Number(payload.complianceAmount !== undefined ? payload.complianceAmount : (prev && prev.complianceAmount)) || 0),
      pfEmployee: round2(Number(payload.pfEmployee !== undefined ? payload.pfEmployee : (prev && prev.pfEmployee)) || 0),
      esicEmployee: round2(Number(payload.esicEmployee !== undefined ? payload.esicEmployee : (prev && prev.esicEmployee)) || 0),
      pfEmployer: round2(Number(payload.pfEmployer !== undefined ? payload.pfEmployer : (prev && prev.pfEmployer)) || 0),
      esicEmployer: round2(Number(payload.esicEmployer !== undefined ? payload.esicEmployer : (prev && prev.esicEmployer)) || 0),
      advanceDeduction: round2(Number(payload.advanceDeduction !== undefined ? payload.advanceDeduction : (prev && prev.advanceDeduction)) || 0),
      totalDeduction: round2(Number(payload.totalDeduction !== undefined ? payload.totalDeduction : (prev && prev.totalDeduction)) || 0),
      baseDiffAmount: round2(Number(payload.baseDiffAmount !== undefined ? payload.baseDiffAmount : (prev && prev.baseDiffAmount)) || 0),
      missedDiffAmount: nextMissed,
      remarks: String(payload.remarks !== undefined ? payload.remarks : ((prev && prev.remarks) || '')).trim(),
      sourceFile: String(payload.sourceFile || (prev && prev.sourceFile) || 'Manual Entry').trim(),
      createdAt: (prev && prev.createdAt) || nowIso,
      updatedAt: nowIso
    };
    delete state.tombstones[id];
    state.empSalaries[id] = rec;
    saveToLocal();
    renderUI();
    pushCloudNow('emp_salary');
    return { ok: true, record: rec };
  }

  function deleteEmpSalary(empCodeOrId) {
    if (!empCodeOrId) return false;
    var id = String(empCodeOrId).indexOf('::') >= 0 ? String(empCodeOrId) : (state.selectedMonth + '::' + normalizeCode(empCodeOrId));
    if (!state.empSalaries[id]) return false;
    delete state.empSalaries[id];
    state.tombstones[id] = new Date().toISOString();
    saveToLocal();
    renderUI();
    pushCloudNow('emp_salary_deleted');
    return true;
  }

  function resetMonthData(monthKey) {
    var mk = String(monthKey || state.selectedMonth).trim();
    if (!mk) return false;
    var nowIso = new Date().toISOString();
    Object.keys(state.uploadedSheets || {}).forEach(function(id) {
      if (state.uploadedSheets[id] && state.uploadedSheets[id].monthKey === mk) {
        delete state.uploadedSheets[id];
        state.tombstones[id] = nowIso;
      }
    });
    Object.keys(state.empSalaries || {}).forEach(function(id) {
      if (state.empSalaries[id] && state.empSalaries[id].monthKey === mk) {
        delete state.empSalaries[id];
        state.tombstones[id] = nowIso;
      }
    });
    Object.keys(state.points || {}).forEach(function(id) {
      if (state.points[id] && state.points[id].monthKey === mk) {
        delete state.points[id];
        state.tombstones[id] = nowIso;
      }
    });
    Object.keys(state.returns || {}).forEach(function(id) {
      if (state.returns[id] && state.returns[id].monthKey === mk) {
        delete state.returns[id];
        state.tombstones[id] = nowIso;
      }
    });
    Object.keys(state.diffBatches || {}).forEach(function(id) {
      if (state.diffBatches[id] && state.diffBatches[id].monthKey === mk) {
        delete state.diffBatches[id];
        state.tombstones[id] = nowIso;
      }
    });
    if (state.monthSummaries[mk]) {
      delete state.monthSummaries[mk];
      state.tombstones[mk] = nowIso;
    }
    saveToLocal();
    renderUI();
    pushCloudNow('month_reset');
    return true;
  }

  function saveManualSheetEntry(payload) {
    payload = payload || {};
    var mk = String(payload.monthKey || state.selectedMonth).trim();
    var kind = String(payload.kind || 'DIFF').toUpperCase();
    var amt = Math.max(0, round2(Number(payload.amount) || 0));
    if (!mk || amt <= 0) return { ok: false, error: 'AMOUNT_REQUIRED' };
    var nowIso = new Date().toISOString();
    var id = payload.id || ('sh_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6));
    var prev = state.uploadedSheets[id];
    var rec = {
      id: id,
      monthKey: mk,
      kind: kind,
      entryMode: 'MANUAL',
      title: String(payload.title || (kind === 'COMPLIANCE' ? 'Manual Compliance Net Payable' : 'Manual Diff Entry')).trim(),
      fileName: 'Manual Entry',
      selectedTabs: [],
      locked: kind === 'COMPLIANCE' ? (payload.locked !== undefined ? !!payload.locked : true) : false,
      empCount: 0,
      complianceAmount: kind === 'COMPLIANCE' ? amt : 0,
      diffAmount: kind === 'DIFF' ? amt : 0,
      manualAmount: round2(Number(payload.manualAmount) || 0),
      pfTotal: round2(Number(payload.pfTotal) || 0),
      esicTotal: round2(Number(payload.esicTotal) || 0),
      notes: String(payload.remarks || payload.notes || '').trim(),
      rows: [],
      createdAt: (prev && prev.createdAt) || nowIso,
      updatedAt: nowIso
    };
    delete state.tombstones[id];
    state.uploadedSheets[id] = rec;
    saveToLocal();
    renderUI();
    pushCloudNow('manual_sheet_saved');
    return { ok: true, record: rec };
  }

  function toggleSheetLock(sheetId) {
    var sh = sheetId && state.uploadedSheets[sheetId];
    if (!sh) return false;
    sh.locked = !sh.locked;
    sh.updatedAt = new Date().toISOString();
    saveToLocal();
    renderUI();
    pushCloudNow('sheet_lock_toggled');
    return true;
  }

  function deleteUploadedSheet(sheetId) {
    var sh = sheetId && state.uploadedSheets[sheetId];
    if (!sh) return false;
    var mk = sh.monthKey;
    var kind = String(sh.kind || 'DIFF').toUpperCase();
    var nowIso = new Date().toISOString();

    // Subtract ONLY this deleted sheet's per-employee contributions cleanly
    (Array.isArray(sh.rows) ? sh.rows : []).forEach(function(item) {
      if (!item || !item.empCode) return;
      var eid = mk + '::' + normalizeCode(item.empCode);
      var existing = state.empSalaries[eid];
      if (!existing) return;
      if (kind !== 'DIFF') {
        existing.complianceAmount = Math.max(0, round2((Number(existing.complianceAmount) || 0) - (Number(item.complianceAmount) || 0)));
        existing.pfEmployee = Math.max(0, round2((Number(existing.pfEmployee) || 0) - (Number(item.pfEmployee) || 0)));
        existing.esicEmployee = Math.max(0, round2((Number(existing.esicEmployee) || 0) - (Number(item.esicEmployee) || 0)));
        existing.pfEmployer = Math.max(0, round2((Number(existing.pfEmployer) || 0) - (Number(item.pfEmployer) || 0)));
        existing.esicEmployer = Math.max(0, round2((Number(existing.esicEmployer) || 0) - (Number(item.esicEmployer) || 0)));
        existing.advanceDeduction = Math.max(0, round2((Number(existing.advanceDeduction) || 0) - (Number(item.advanceDeduction) || 0)));
        existing.totalDeduction = Math.max(0, round2((Number(existing.totalDeduction) || 0) - (Number(item.totalDeduction) || 0)));
        if (Number(item.manualAmount) > 0) {
          existing.manualAmount = Math.max(0, round2((Number(existing.manualAmount) || 0) - (Number(item.manualAmount) || 0)));
        }
      }
      if (kind !== 'COMPLIANCE') {
        existing.baseDiffAmount = Math.max(0, round2((Number(existing.baseDiffAmount) || 0) - (Number(item.baseDiffAmount) || 0)));
      }
      if ((Number(existing.complianceAmount) || 0) === 0 && (Number(existing.baseDiffAmount) || 0) === 0 && (Number(existing.missedDiffAmount) || 0) === 0 && (Number(existing.manualAmount) || 0) === 0) {
        delete state.empSalaries[eid];
        state.tombstones[eid] = nowIso;
      } else {
        existing.updatedAt = nowIso;
      }
    });

    delete state.uploadedSheets[sheetId];
    state.tombstones[sheetId] = nowIso;
    saveToLocal();
    renderUI();
    pushCloudNow('uploaded_sheet_deleted');
    return true;
  }

  function bulkImportMonthSalaries(monthKey, rowsList, sourceFile, sheetKind, opts) {
    var mk = String(monthKey || state.selectedMonth).trim();
    var kind = String(sheetKind || 'BOTH').toUpperCase(); // 'COMPLIANCE' | 'DIFF' | 'BOTH'
    opts = opts || {};
    // DIFF sheets ADD onto previous Diff sheets by default! COMPLIANCE/BOTH replace stale same-type sheets by default.
    var replaceExisting = opts.replaceExisting !== undefined ? !!opts.replaceExisting : (kind !== 'DIFF');
    if (!mk || !Array.isArray(rowsList) || !rowsList.length) return { ok: false, imported: 0 };
    var nowIso = new Date().toISOString();
    var incomingIds = {};
    var count = 0;

    var sheetCompSum = 0, sheetDiffSum = 0, sheetManualSum = 0, sheetPfSum = 0, sheetEsicSum = 0;
    var compactRows = [];

    rowsList.forEach(function(item) {
      if (!item || !item.empCode) return;
      var code = String(item.empCode).trim();
      var id = mk + '::' + normalizeCode(code);
      incomingIds[id] = true;
      var em = findEmployeeByCode(code);
      var prev = state.empSalaries[id];
      delete state.tombstones[id];

      var rowComp = round2(Number(item.complianceAmount) || 0);
      var rowDiff = round2(Number(item.baseDiffAmount) || 0);
      var rowManual = round2(Number(item.manualAmount) || 0);
      var rowPf = round2(Number(item.pfEmployee) || 0);
      var rowEsic = round2(Number(item.esicEmployee) || 0);
      var rowPfEr = round2(Number(item.pfEmployer) || 0);
      var rowEsicEr = round2(Number(item.esicEmployer) || 0);
      var rowAdvDed = round2(Number(item.advanceDeduction) || 0);
      var rowTotDed = round2(Number(item.totalDeduction) || 0);

      var nextComp = kind === 'DIFF'
        ? ((prev && Number(prev.complianceAmount)) || 0)
        : rowComp;
      // Additive DIFF mode (!replaceExisting) sums onto previous baseDiffAmount!
      var nextDiff = kind === 'COMPLIANCE'
        ? ((prev && Number(prev.baseDiffAmount)) || 0)
        : (replaceExisting ? rowDiff : round2(((prev && Number(prev.baseDiffAmount)) || 0) + rowDiff));
      var nextManual = rowManual > 0
        ? (kind === 'DIFF' && !replaceExisting && prev && Number(prev.manualAmount) > 0 ? Number(prev.manualAmount) : rowManual)
        : ((prev && Number(prev.manualAmount)) || 0);
      var nextPf = kind === 'DIFF'
        ? ((prev && Number(prev.pfEmployee)) || 0)
        : round2(Number(item.pfEmployee !== undefined ? item.pfEmployee : (prev && prev.pfEmployee)) || 0);
      var nextEsic = kind === 'DIFF'
        ? ((prev && Number(prev.esicEmployee)) || 0)
        : round2(Number(item.esicEmployee !== undefined ? item.esicEmployee : (prev && prev.esicEmployee)) || 0);
      var nextPfEr = kind === 'DIFF'
        ? ((prev && Number(prev.pfEmployer)) || 0)
        : round2(Number(item.pfEmployer !== undefined ? item.pfEmployer : (prev && prev.pfEmployer)) || 0);
      var nextEsicEr = kind === 'DIFF'
        ? ((prev && Number(prev.esicEmployer)) || 0)
        : round2(Number(item.esicEmployer !== undefined ? item.esicEmployer : (prev && prev.esicEmployer)) || 0);
      var nextAdvDed = kind === 'DIFF'
        ? ((prev && Number(prev.advanceDeduction)) || 0)
        : round2(Number(item.advanceDeduction !== undefined ? item.advanceDeduction : (prev && prev.advanceDeduction)) || 0);
      var nextTotDed = kind === 'DIFF'
        ? ((prev && Number(prev.totalDeduction)) || 0)
        : round2(Number(item.totalDeduction !== undefined ? item.totalDeduction : (prev && prev.totalDeduction)) || 0);

      state.empSalaries[id] = {
        id: id,
        monthKey: mk,
        empCode: code,
        empName: String(item.empName || (em && em.name) || (prev && prev.empName) || ('Employee ' + code)).trim(),
        dept: String(item.dept || (em && em.dept) || (prev && prev.dept) || '').trim(),
        desig: String(item.desig || (em && em.desig) || (prev && prev.desig) || '').trim(),
        accountNo: String(item.accountNo || (em && em.accountNo) || (prev && prev.accountNo) || '').trim(),
        ifsc: String(item.ifsc || (em && em.ifsc) || (prev && prev.ifsc) || '').trim(),
        manualAmount: nextManual,
        complianceAmount: nextComp,
        pfEmployee: nextPf,
        esicEmployee: nextEsic,
        pfEmployer: nextPfEr,
        esicEmployer: nextEsicEr,
        advanceDeduction: nextAdvDed,
        totalDeduction: nextTotDed,
        baseDiffAmount: nextDiff,
        missedDiffAmount: (prev && Number(prev.missedDiffAmount)) || 0,
        remarks: String(item.remarks || (prev && prev.remarks) || '').trim(),
        sourceFile: String(sourceFile || item.sourceFile || 'Salary Sheet').trim(),
        createdAt: (prev && prev.createdAt) || nowIso,
        updatedAt: nowIso
      };

      sheetCompSum = round2(sheetCompSum + (kind === 'DIFF' ? 0 : rowComp));
      sheetDiffSum = round2(sheetDiffSum + (kind === 'COMPLIANCE' ? 0 : rowDiff));
      sheetManualSum = round2(sheetManualSum + rowManual);
      sheetPfSum = round2(sheetPfSum + (kind === 'DIFF' ? 0 : rowPf));
      sheetEsicSum = round2(sheetEsicSum + (kind === 'DIFF' ? 0 : rowEsic));
      compactRows.push({
        empCode: code,
        complianceAmount: kind === 'DIFF' ? 0 : rowComp,
        baseDiffAmount: kind === 'COMPLIANCE' ? 0 : rowDiff,
        manualAmount: rowManual,
        pfEmployee: kind === 'DIFF' ? 0 : rowPf,
        esicEmployee: kind === 'DIFF' ? 0 : rowEsic,
        pfEmployer: kind === 'DIFF' ? 0 : rowPfEr,
        esicEmployer: kind === 'DIFF' ? 0 : rowEsicEr,
        advanceDeduction: kind === 'DIFF' ? 0 : rowAdvDed,
        totalDeduction: kind === 'DIFF' ? 0 : rowTotDed
      });
      count++;
    });

    if (count > 0 && replaceExisting) {
      // Remove & tombstone previous uploadedSheets of same kind for this month
      Object.keys(state.uploadedSheets || {}).forEach(function(shId) {
        var oldSh = state.uploadedSheets[shId];
        if (!oldSh || oldSh.monthKey !== mk) return;
        if (kind === 'BOTH' || oldSh.kind === kind) {
          delete state.uploadedSheets[shId];
          state.tombstones[shId] = nowIso;
        }
      });

      Object.keys(state.empSalaries || {}).forEach(function(eid) {
        var existing = state.empSalaries[eid];
        if (!existing || existing.monthKey !== mk || incomingIds[eid]) return;
        if (String(existing.sourceFile || '') === 'Manual Entry' || String(existing.sourceFile || '') === 'Missed Diff Add-On') return;
        if (kind === 'COMPLIANCE') {
          existing.complianceAmount = 0;
          existing.pfEmployee = 0;
          existing.esicEmployee = 0;
          existing.pfEmployer = 0;
          existing.esicEmployer = 0;
          existing.advanceDeduction = 0;
          existing.totalDeduction = 0;
        } else if (kind === 'DIFF') {
          existing.baseDiffAmount = 0;
        } else {
          existing.complianceAmount = 0;
          existing.baseDiffAmount = 0;
          existing.manualAmount = 0;
          existing.pfEmployee = 0;
          existing.esicEmployee = 0;
        }
        if ((Number(existing.complianceAmount) || 0) === 0 && (Number(existing.baseDiffAmount) || 0) === 0 && (Number(existing.missedDiffAmount) || 0) === 0) {
          delete state.empSalaries[eid];
          state.tombstones[eid] = nowIso;
        } else {
          existing.updatedAt = nowIso;
        }
      });

      var prevSum = state.monthSummaries[mk];
      if (prevSum) {
        if (kind === 'COMPLIANCE' || kind === 'BOTH') prevSum.complianceTarget = 0;
        if (kind === 'DIFF' || kind === 'BOTH') prevSum.diffTarget = 0;
        prevSum.updatedAt = nowIso;
      }
    }

    var sheetId = 'sh_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    if (count > 0) {
      state.uploadedSheets[sheetId] = {
        id: sheetId,
        monthKey: mk,
        kind: kind,
        entryMode: 'EXCEL_SHEET',
        title: String(sourceFile || (kind + ' Sheet')).trim(),
        fileName: String(sourceFile || 'Salary Sheet').trim(),
        selectedTabs: Array.isArray(opts.selectedTabs) ? opts.selectedTabs : [],
        locked: (kind === 'COMPLIANCE' || kind === 'BOTH') ? (opts.locked !== undefined ? !!opts.locked : true) : false,
        empCount: count,
        complianceAmount: sheetCompSum,
        diffAmount: sheetDiffSum,
        manualAmount: sheetManualSum,
        pfTotal: sheetPfSum,
        esicTotal: sheetEsicSum,
        notes: String(opts.notes || '').trim(),
        rows: compactRows,
        createdAt: nowIso,
        updatedAt: nowIso
      };
      saveToLocal();
      renderUI();
      pushCloudNow('bulk_import_' + kind.toLowerCase());
    }
    return { ok: count > 0, imported: count, kind: kind, sheetId: sheetId };
  }

  function addOrUpdatePoint(payload) {
    payload = payload || {};
    var code = String(payload.empCode || '').trim();
    var mk = String(payload.monthKey || state.selectedMonth).trim();
    var dir = String(payload.direction || 'ADD').toUpperCase();
    var amt = dir === 'NOTE' ? 0 : Math.abs(round2(Number(payload.amount) || 0));
    var note = String(payload.note || '').trim();
    if (!code || !mk) return { ok: false, error: 'EMP_CODE_REQUIRED' };
    if (dir !== 'NOTE' && amt <= 0 && !note) return { ok: false, error: 'AMOUNT_OR_NOTE_REQUIRED' };

    var em = findEmployeeByCode(code);
    var id = payload.id || ('pt_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6));
    var prev = state.points[id];
    var nowIso = new Date().toISOString();
    var rec = {
      id: id,
      monthKey: mk,
      empCode: code,
      empName: String(payload.empName || (em && em.name) || (prev && prev.empName) || ('Employee ' + code)).trim(),
      dept: String(payload.dept || (em && em.dept) || (prev && prev.dept) || '').trim(),
      desig: String(payload.desig || (em && em.desig) || (prev && prev.desig) || '').trim(),
      direction: dir,
      applyTo: String(payload.applyTo || 'DIFF').toUpperCase(),
      amount: amt,
      note: note,
      status: String(payload.status || (prev && prev.status) || 'ACTIVE').toUpperCase(),
      createdAt: (prev && prev.createdAt) || nowIso,
      updatedAt: nowIso
    };
    delete state.tombstones[id];
    state.points[id] = rec;
    saveToLocal();
    renderUI();
    pushCloudNow('point_saved');
    return { ok: true, record: rec };
  }

  function togglePointStatus(id) {
    var p = state.points[id];
    if (!p) return false;
    var order = ['ACTIVE', 'APPLIED', 'SETTLED'];
    var next = order[(order.indexOf(p.status) + 1) % order.length];
    p.status = next;
    p.updatedAt = new Date().toISOString();
    saveToLocal();
    renderUI();
    pushCloudNow('point_status');
    return true;
  }

  function deletePoint(id) {
    if (!id || !state.points[id]) return false;
    delete state.points[id];
    state.tombstones[id] = new Date().toISOString();
    saveToLocal();
    renderUI();
    pushCloudNow('point_deleted');
    return true;
  }

  function syncNewAccountToEmployeeMaster(empCode, newAccountNo, newIfsc, newBankName) {
    if (!empCode || !newAccountNo) return false;
    var norm = normalizeCode(empCode);
    var updated = null;
    if (window.EM && Array.isArray(window.EM.data)) {
      for (var i = 0; i < window.EM.data.length; i++) {
        var row = window.EM.data[i];
        var rc = row && (row.emp_id || row.empCode || row.code || '');
        if (normalizeCode(rc) === norm) {
          row.account_no = newAccountNo;
          if (newIfsc) row.ifsc = newIfsc;
          if (newBankName) row.bank_name = newBankName;
          row.updated_at = new Date().toISOString();
          updated = row;
          break;
        }
      }
      if (updated) {
        try {
          if (typeof window.localStorage !== 'undefined') {
            window.localStorage.setItem('ATPL_EmployeeMaster_V1', JSON.stringify(window.EM.data));
          }
          if (window.ATPLGoogleSync && typeof window.ATPLGoogleSync.pushEmployeeAndVaultToCloud === 'function') {
            window.ATPLGoogleSync.pushEmployeeAndVaultToCloud(window.EM.data);
          }
          if (typeof fetch === 'function') {
            fetch('/api/sync/employee-master', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ record: updated })
            }).catch(function() {});
          }
          if (typeof window.emRender === 'function') {
            try { window.emRender(); } catch (_) {}
          }
        } catch (_) {}
      }
    }
    var salKey = state.selectedMonth + '::' + norm;
    if (state.empSalaries[salKey]) {
      state.empSalaries[salKey].accountNo = newAccountNo;
      if (newIfsc) state.empSalaries[salKey].ifsc = newIfsc;
      state.empSalaries[salKey].updatedAt = new Date().toISOString();
    }
    return !!updated;
  }

  function addOrUpdateReturn(payload) {
    payload = payload || {};
    var code = String(payload.empCode || '').trim();
    var mk = String(payload.monthKey || state.selectedMonth).trim();
    var amt = round2(Number(payload.amount) || 0);
    if (!code || !mk || amt <= 0) return { ok: false, error: 'INVALID_RETURN_INPUT' };

    var em = findEmployeeByCode(code);
    var id = payload.id || ('ret_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6));
    var prev = state.returns[id];
    var nowIso = new Date().toISOString();
    var newAcc = String(payload.newAccountNo || '').trim();
    var newIfsc = String(payload.newIfsc || '').trim().toUpperCase();
    var newBank = String(payload.newBankName || '').trim();

    var masterSynced = false;
    if (payload.updateMaster && newAcc) {
      masterSynced = syncNewAccountToEmployeeMaster(code, newAcc, newIfsc, newBank);
    }

    var rec = {
      id: id,
      monthKey: mk,
      empCode: code,
      empName: String(payload.empName || (em && em.name) || (prev && prev.empName) || ('Employee ' + code)).trim(),
      dept: String(payload.dept || (em && em.dept) || (prev && prev.dept) || '').trim(),
      amount: amt,
      reason: String(payload.reason || 'Wrong Account Number').trim(),
      oldAccountNo: String(payload.oldAccountNo || (em && em.accountNo) || (prev && prev.oldAccountNo) || '').trim(),
      oldIfsc: String(payload.oldIfsc || (em && em.ifsc) || (prev && prev.oldIfsc) || '').trim().toUpperCase(),
      newAccountNo: newAcc,
      newIfsc: newIfsc,
      newBankName: newBank,
      status: String(payload.status || (prev && prev.status) || 'PENDING').toUpperCase(),
      utr: String(payload.utr || (prev && prev.utr) || '').trim(),
      retransferDate: String(payload.retransferDate || (prev && prev.retransferDate) || '').trim(),
      updatedToMaster: masterSynced || !!(prev && prev.updatedToMaster),
      createdAt: (prev && prev.createdAt) || nowIso,
      updatedAt: nowIso
    };
    delete state.tombstones[id];
    state.returns[id] = rec;
    saveToLocal();
    renderUI();
    pushCloudNow('bank_return_saved');
    return { ok: true, record: rec, masterSynced: masterSynced };
  }

  function markReturnRetransferred(id, utr, retransferDate) {
    var r = state.returns[id];
    if (!r) return false;
    r.status = 'RETRANSFERRED';
    if (utr !== undefined) r.utr = String(utr).trim();
    r.retransferDate = String(retransferDate || todayIso()).trim();
    r.updatedAt = new Date().toISOString();
    saveToLocal();
    renderUI();
    pushCloudNow('bank_return_repaid');
    return true;
  }

  function deleteReturn(id) {
    if (!id || !state.returns[id]) return false;
    delete state.returns[id];
    state.tombstones[id] = new Date().toISOString();
    saveToLocal();
    renderUI();
    pushCloudNow('bank_return_deleted');
    return true;
  }

  function addOrUpdateDiffBatch(payload) {
    payload = payload || {};
    var mk = String(payload.monthKey || state.selectedMonth).trim();
    if (!mk) return { ok: false, error: 'MONTH_REQUIRED' };
    var existingBatches = getMonthBatches(mk);
    var id = payload.id || ('bat_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6));
    var prev = state.diffBatches[id];
    var nextPartNum = prev ? prev.partNumber : (existingBatches.reduce(function(mx, b) {
      return Math.max(mx, Number(b.partNumber) || 0);
    }, 0) + 1);
    var partNum = Number(payload.partNumber) || nextPartNum;
    var allocs = Array.isArray(payload.allocations) ? payload.allocations.filter(function(a) {
      return a && a.empCode && round2(Number(a.amount) || 0) > 0;
    }).map(function(a) {
      var em = findEmployeeByCode(a.empCode);
      return {
        empCode: String(a.empCode).trim(),
        empName: String(a.empName || (em && em.name) || ('Employee ' + a.empCode)).trim(),
        amount: round2(Number(a.amount) || 0),
        remarks: String(a.remarks || '').trim(),
        accountNo: String(a.accountNo || (em && em.accountNo) || '').trim(),
        ifsc: String(a.ifsc || (em && em.ifsc) || '').trim()
      };
    }) : [];
    var lumpSum = round2(Number(payload.lumpSumAmount) || 0);
    if (!allocs.length && lumpSum <= 0) {
      return { ok: false, error: 'BATCH_EMPTY' };
    }
    var nowIso = new Date().toISOString();
    var rec = {
      id: id,
      monthKey: mk,
      partNumber: partNum,
      title: String(payload.title || ('Part ' + partNum + ' Diff Payout')).trim(),
      lotType: String(payload.lotType || 'PART_PAYMENT').trim(),
      paymentDate: String(payload.paymentDate || todayIso()).trim(),
      mode: String(payload.mode || PAYMENT_MODES[0]).trim(),
      signedBy: String(payload.signedBy || '').trim(),
      utr: String(payload.utr || '').trim(),
      status: String(payload.status || 'DISBURSED').toUpperCase(),
      lumpSumAmount: lumpSum,
      notes: String(payload.notes || '').trim(),
      sourceFile: String(payload.sourceFile || (prev && prev.sourceFile) || '').trim(),
      allocations: allocs,
      createdAt: (prev && prev.createdAt) || nowIso,
      updatedAt: nowIso
    };
    delete state.tombstones[id];
    state.diffBatches[id] = rec;
    saveToLocal();
    renderUI();
    pushCloudNow('diff_batch_saved');
    return { ok: true, record: rec };
  }

  function markBatchDisbursed(id) {
    var b = state.diffBatches[id];
    if (!b) return false;
    b.status = b.status === 'DISBURSED' ? 'PLANNED' : 'DISBURSED';
    b.updatedAt = new Date().toISOString();
    saveToLocal();
    renderUI();
    pushCloudNow('diff_batch_status');
    return true;
  }

  function deleteDiffBatch(id) {
    if (!id || !state.diffBatches[id]) return false;
    delete state.diffBatches[id];
    state.tombstones[id] = new Date().toISOString();
    saveToLocal();
    renderUI();
    pushCloudNow('diff_batch_deleted');
    return true;
  }

  // ── SMART HUMAN-STYLE SALARY & BANK SHEET PARSER ──
  function cleanHeader(v) {
    return String(v === null || v === undefined ? '' : v)
      .replace(/[\r\n]+/g, ' ')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function parseNumeric(v) {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v !== 'string') return 0;
    var raw = v.trim();
    if (!raw || /^(#|err:|n\/a$|na$|nil$|null$|none$|-$)/i.test(raw)) return 0;
    var cleaned = raw.replace(/\/-$/, '').replace(/[^\d.-]/g, '');
    if (!cleaned || cleaned === '-' || cleaned === '.') return 0;
    var n = Number(cleaned);
    return Number.isFinite(n) ? n : 0;
  }

  function findHeaderIdx(headers, patterns, excludePattern) {
    for (var p = 0; p < patterns.length; p++) {
      var pat = patterns[p];
      for (var i = 0; i < headers.length; i++) {
        var hStr = headers[i];
        if (!hStr) continue;
        if (excludePattern && excludePattern.test(hStr)) continue;
        if (pat instanceof RegExp ? pat.test(hStr) : hStr === pat) return i;
      }
    }
    return -1;
  }

  function parseSingleSalarySheet(grid, sheetName, kind, fileName) {
    if (!Array.isArray(grid) || grid.length < 2) return null;
    var hdrIdx = -1;
    var mergedHeaders = null;
    var dataStartIdx = -1;

    for (var r = 0; r < Math.min(grid.length, 25); r++) {
      var row = grid[r];
      if (!Array.isArray(row)) continue;
      var normRow = row.map(cleanHeader);
      var nextRow = Array.isArray(grid[r + 1]) ? grid[r + 1].map(cleanHeader) : null;
      // Check merged 2-row headers (e.g. row r = 'PF' & row r+1 = '12%', or 'Net' & 'Payable')
      var combined = normRow.map(function(cell, cIdx) {
        if (!nextRow) return cell;
        var nxt = nextRow[cIdx] || '';
        if (nxt && !/^\d{3,}$/.test(nxt) && /^(12|13|0 75|75|3 25|payable|payment|payments|amount|amt|deduction|code|id|name|employee|remarks)$/.test(nxt)) {
          return (cell + ' ' + nxt).trim();
        }
        return cell;
      });
      var hasId = combined.some(function(h) {
        return /^emp\s*code$|^employee\s*code$|^emp\s*id$|^employee\s*id$|^e\s*code$|^beneficiary\s*code$|^account\s*no$|^a\s*c\s*no$|^bank\s*account$|^beneficiary\s*a\s*c$/.test(h);
      });
      var hasMoney = combined.some(function(h) {
        return /\b(net\s*payments?|net\s*payable|net\s*pay\b|manual|diff|difference|amount|amt|transfer|cr\s*amt|salary|pf|esic)\b/.test(h);
      });
      if (hasId && hasMoney) {
        hdrIdx = r;
        var useMerged = nextRow && combined.some(function(c, idx) { return c !== normRow[idx]; });
        mergedHeaders = useMerged ? combined : normRow;
        dataStartIdx = useMerged ? (r + 2) : (r + 1);
        break;
      }
    }
    if (hdrIdx < 0 || !mergedHeaders) return null;

    var h = mergedHeaders;
    var iCode = findHeaderIdx(h, [
      /^emp\s*code$/, /^employee\s*code$/, /^emp\s*id$/, /^employee\s*id$/, /^e\s*code$/, /^beneficiary\s*code$/,
      /\b(emp\s*code|employee\s*code|emp\s*id|employee\s*id|beneficiary\s*code|e\s*code)\b/
    ], /\b(ifsc|bank\s*code|branch\s*code)\b/);

    var iAcc = findHeaderIdx(h, [
      /^a\s*c\s*no$/, /^account\s*no$/, /^bank\s*account$/, /^beneficiary\s*a\s*c$/, /^beneficiary\s*account$/,
      /\b(account\s*no|a\s*c\s*no|ac\s*no|bank\s*a\s*c|beneficiary\s*account|beneficiary\s*a\s*c)\b/
    ]);
    if (iCode < 0 && iAcc < 0) return null;

    var iName = findHeaderIdx(h, [
      /^name\s*of\s*employee$/, /^emp\s*name$/, /^employee\s*name$/, /^beneficiary\s*name$/, /^name$/,
      /\b(name\s*of\s*employee|emp\s*name|employee\s*name|beneficiary\s*name)\b/
    ], /\b(father|mother|husband|wife|bank|dept|department|company|nominee)\b/);

    var iDept = findHeaderIdx(h, [/^dept$/, /^department$/, /\b(dept|department)\b/]);
    var iDesig = findHeaderIdx(h, [/^desig$/, /^designation$/, /\b(desig|designation)\b/]);
    var iManual = findHeaderIdx(h, [/^manual\s*amt$/, /^manual\s*amount$/, /^mam\s*amount$/, /^manual$/, /\b(manual\s*amt|manual\s*amount|mam\s*amount)\b/]);
    var iDiff = findHeaderIdx(h, [/^diff\s*amt$/, /^diff\s*amount$/, /^difference\s*amount$/, /^difference\s*amt$/, /^cash\s*diff$/, /^diff$/, /\b(diff\s*amt|diff\s*amount|difference\s*amount|difference\s*amt|cash\s*diff)\b/]);

    // Compliance Net Payment / Net Payable strictly prioritized over generic Amount; NEVER matches Net Earning or Manual
    var iCompExplicit = findHeaderIdx(h, [
      /^net\s*payments?$/, /^net\s*payable$/, /^net\s*pay$/, /^net\s*salary$/, /^compliance\s*(net|amt|amount|pay|payable|payment)?$/,
      /^bank\s*transfer(\s*amt|\s*amount)?$/, /^payable\s*bank$/,
      /\b(net\s*payments?|net\s*payable|net\s*pay\b|compliance\s*net|net\s*salary|bank\s*transfer)\b/
    ], /\b(earning|gross|manual|diff|difference)\b/);
    var iGenericAmt = findHeaderIdx(h, [
      /^transfer\s*amt$/, /^transfer\s*amount$/, /^cr\s*amt$/, /^paid\s*amount$/, /^amount$/, /^amt$/, /^payable$/
    ], /\b(manual|diff|difference|gross|earning|deduction|pf|esic|advance|loan)\b/);
    var iAlreadyGiven = findHeaderIdx(h, [/^already\s*given$/, /^already\s*paid$/, /\balready\s*(given|paid)\b/]);
    var bannerText = String(fileName || '') + ' ' + String(sheetName || '');
    for (var br = 0; br < hdrIdx; br++) {
      if (Array.isArray(grid[br])) bannerText += ' ' + grid[br].join(' ');
    }
    var isDiffBankSheet = (iCompExplicit < 0) && (iAlreadyGiven >= 0 || (/\b(diff|difference)\b/i.test(bannerText) && iGenericAmt >= 0));
    var iComp = iCompExplicit >= 0 ? iCompExplicit : iGenericAmt;

    var iPfEmp = findHeaderIdx(h, [
      /^pf\s*12/, /^epf\s*12/, /^pf\s*ded/, /^pf\s*emp/, /\b(pf\s*12|epf\s*12|pf\s*deduction|pf\s*employee)\b/, /\bpf\b/
    ], /\b(13|employer|uan|no|number|id|reg|status|flag|check|remove|rakh)\b/);

    var iEsicEmp = findHeaderIdx(h, [
      /^esic?\s*0\s*75/, /^esic?\s*75/, /^esic?\s*ded/, /^esic?\s*emp/, /\b(esic?\s*0\s*75|esic?\s*deduction|esic?\s*employee)\b/, /\besic?\b/
    ], /\b(3\s*25|325|employer|ip|no|number|id|card|status|flag|check)\b/);

    var iPfEr = findHeaderIdx(h, [/\b(pf\s*13|epf\s*13|pf\s*employer)\b/]);
    var iEsicEr = findHeaderIdx(h, [/\b(esic?\s*3\s*25|esi\s*325|esic?\s*employer)\b/]);
    var iAdvDed = findHeaderIdx(h, [/^advance\s*deduction$/, /^advance\s*ded$/, /^advance$/, /\badvance\s*ded/]);
    var iTotDed = findHeaderIdx(h, [/^total\s*deduction$/, /^total\s*ded$/, /\btotal\s*deduction\b/]);
    var iIfsc = findHeaderIdx(h, [/^ifsc$/, /^ifsc\s*code$/, /\b(ifsc|ifsc\s*code)\b/]);
    var iRem = findHeaderIdx(h, [/^remarks?$/, /^note$/, /^reason$/, /^narration$/, /\b(remarks?|note|reason|narration)\b/]);

    var rows = [];
    var seenInSheet = {};
    var compSum = 0, manualSum = 0, diffSum = 0, pfSum = 0, esicSum = 0;

    for (var rr = dataStartIdx; rr < grid.length; rr++) {
      var dataRow = grid[rr];
      if (!Array.isArray(dataRow)) continue;

      var rawCode = iCode >= 0 ? String(dataRow[iCode] === null || dataRow[iCode] === undefined ? '' : dataRow[iCode]).trim().replace(/\.0$/, '') : '';
      var rawAcc = iAcc >= 0 ? String(dataRow[iAcc] === null || dataRow[iAcc] === undefined ? '' : dataRow[iAcc]).trim().replace(/\.0$/, '') : '';
      var rawName = iName >= 0 ? String(dataRow[iName] === null || dataRow[iName] === undefined ? '' : dataRow[iName]).trim() : '';
      var cell0 = String(dataRow[0] === null || dataRow[0] === undefined ? '' : dataRow[0]).trim();

      // Smart Total / Grand Total / Summary / Sub-Total / Blank Header Footer Row Skipping
      if (/^(total|grand\s*total|sub\s*total|sum|summary|page\s*total|net\s*total|sr\.?\s*no\.?|s\.?\s*no\.?|emp\s*code|employee\s*id)$/i.test(rawCode)) continue;
      if (/^(total|grand\s*total|sub\s*total|sum|summary|page\s*total|net\s*total)(\b|:)/i.test(rawName)) continue;
      if (/^(total|grand\s*total|sub\s*total|page\s*total)(\b|:)/i.test(cell0)) continue;
      var hasRowTotalLabel = false;
      for (var tc = 0; tc < Math.min(dataRow.length, 6); tc++) {
        if (/^(total|grand\s*total|sub\s*total|page\s*total|net\s*total)(\b|:)/i.test(String(dataRow[tc] === null || dataRow[tc] === undefined ? '' : dataRow[tc]).trim())) {
          hasRowTotalLabel = true;
          break;
        }
      }
      if (hasRowTotalLabel) continue;

      if (!rawCode && rawAcc) {
        var byAcc = findEmployeeByAccount(rawAcc);
        if (byAcc && byAcc.empCode) rawCode = byAcc.empCode;
      }
      if (!rawCode || !/^[a-z0-9_-]{1,16}$/i.test(rawCode)) continue;
      // If a name column exists, require either a real name OR an Employee Master match (prevents footer count cells like '1' or '338' from parsing as employees!)
      if (iName >= 0 && !rawName && !findEmployeeByCode(rawCode)) continue;

      var compColVal = iComp >= 0 ? Math.max(0, round2(parseNumeric(dataRow[iComp]))) : 0;
      var diffColVal = iDiff >= 0 ? Math.max(0, round2(parseNumeric(dataRow[iDiff]))) : 0;
      var manColVal = iManual >= 0 ? Math.max(0, round2(parseNumeric(dataRow[iManual]))) : 0;
      var genAmtVal = iGenericAmt >= 0 ? Math.max(0, round2(parseNumeric(dataRow[iGenericAmt]))) : 0;
      var pfEmpVal = iPfEmp >= 0 ? Math.max(0, round2(parseNumeric(dataRow[iPfEmp]))) : 0;
      var esicEmpVal = iEsicEmp >= 0 ? Math.max(0, round2(parseNumeric(dataRow[iEsicEmp]))) : 0;
      var pfErVal = iPfEr >= 0 ? Math.max(0, round2(parseNumeric(dataRow[iPfEr]))) : 0;
      var esicErVal = iEsicEr >= 0 ? Math.max(0, round2(parseNumeric(dataRow[iEsicEr]))) : 0;
      var advDedVal = iAdvDed >= 0 ? Math.max(0, round2(parseNumeric(dataRow[iAdvDed]))) : 0;
      var totDedVal = iTotDed >= 0 ? Math.max(0, round2(parseNumeric(dataRow[iTotDed]))) : 0;

      var compVal = 0;
      var diffVal = 0;
      var payAmt = 0;

      if (kind === 'COMPLIANCE') {
        compVal = iCompExplicit >= 0 ? compColVal : (genAmtVal || manColVal);
        if (compVal <= 0 && pfEmpVal <= 0 && esicEmpVal <= 0) continue;
      } else if (kind === 'DIFF') {
        diffVal = iDiff >= 0 ? diffColVal : (genAmtVal || (manColVal > compColVal && compColVal > 0 ? round2(manColVal - compColVal) : 0));
        if (diffVal <= 0) continue;
      } else if (kind === 'BATCH') {
        payAmt = iDiff >= 0 && diffColVal > 0 ? diffColVal : (genAmtVal || compColVal || manColVal);
        if (payAmt <= 0) continue;
      } else if (isDiffBankSheet) {
        compVal = 0;
        diffVal = iDiff >= 0 ? diffColVal : genAmtVal;
        if (diffVal <= 0 && manColVal <= 0) continue;
      } else {
        compVal = iCompExplicit >= 0 ? compColVal : (diffColVal === 0 && manColVal === 0 ? genAmtVal : compColVal);
        diffVal = diffColVal;
        if (diffVal === 0 && manColVal > compVal && compVal > 0 && iDiff < 0) diffVal = round2(manColVal - compVal);
        if (compVal === 0 && diffVal === 0 && manColVal === 0 && pfEmpVal === 0 && esicEmpVal === 0) continue;
      }

      var norm = normalizeCode(rawCode);
      var remVal = iRem >= 0 ? String(dataRow[iRem] || '').trim() : '';
      var recObj = {
        empCode: rawCode,
        empName: rawName,
        dept: iDept >= 0 ? String(dataRow[iDept] || '').trim() : '',
        desig: iDesig >= 0 ? String(dataRow[iDesig] || '').trim() : '',
        accountNo: rawAcc,
        ifsc: iIfsc >= 0 ? String(dataRow[iIfsc] || '').trim() : '',
        manualAmount: manColVal,
        complianceAmount: compVal,
        pfEmployee: pfEmpVal,
        esicEmployee: esicEmpVal,
        pfEmployer: pfErVal,
        esicEmployer: esicErVal,
        advanceDeduction: advDedVal,
        totalDeduction: totDedVal,
        baseDiffAmount: diffVal,
        amount: payAmt,
        remarks: remVal
      };

      if (!seenInSheet[norm]) {
        seenInSheet[norm] = recObj;
        rows.push(recObj);
        compSum = round2(compSum + compVal);
        manualSum = round2(manualSum + manColVal);
        diffSum = round2(diffSum + diffVal);
        pfSum = round2(pfSum + pfEmpVal);
        esicSum = round2(esicSum + esicEmpVal);
      } else if (kind === 'BATCH') {
        seenInSheet[norm].amount = round2(seenInSheet[norm].amount + payAmt);
        if (remVal && seenInSheet[norm].remarks.indexOf(remVal) < 0) {
          seenInSheet[norm].remarks = seenInSheet[norm].remarks ? (seenInSheet[norm].remarks + '; ' + remVal) : remVal;
        }
      }
    }

    if (!rows.length) return null;

    var lowName = String(sheetName || '').toLowerCase();
    var score = Math.min(rows.length, 600) * 0.25;
    if (iCompExplicit >= 0) score += 120;
    if (iManual >= 0) score += 45;
    if (iPfEmp >= 0 || iEsicEmp >= 0) score += 35;
    if (iDiff >= 0) score += 25;
    if (/\b(fourmala|formula|final|compliance|master|main|salary|payroll|consolidated|workers|staff|working\s*sheet|working)\b/.test(lowName)) score += 25;
    if (kind !== 'BATCH' && /\b(jiska|jisko|remove|rakh|non\s*hdfc|hdfc|icici|sbi|axis|neft|rtgs|bank\s*sheet|sheet\d+|copy|old|bak|backup)\b/.test(lowName)) score -= 75;

    var dispCompIdx = (kind === 'DIFF' || (kind === 'BOTH' && isDiffBankSheet)) ? iCompExplicit : iComp;
    var dispDiffCol = iDiff >= 0
      ? String(grid[hdrIdx][iDiff] || 'Diff')
      : (((kind === 'DIFF' || isDiffBankSheet) && iGenericAmt >= 0) ? String(grid[hdrIdx][iGenericAmt] || 'AMOUNT') : null);

    return {
      sheetName: sheetName,
      score: round2(score),
      rows: rows,
      hasExplicitComp: iCompExplicit >= 0,
      isDiffBankSheet: isDiffBankSheet,
      columns: {
        codeCol: iCode >= 0 ? String(grid[hdrIdx][iCode] || 'Emp Code') : null,
        complianceCol: dispCompIdx >= 0 ? String(grid[hdrIdx][dispCompIdx] || 'Net Payable') : null,
        manualCol: iManual >= 0 ? String(grid[hdrIdx][iManual] || 'Manual') : null,
        diffCol: dispDiffCol,
        pfCol: iPfEmp >= 0 ? String(grid[hdrIdx][iPfEmp] || 'PF 12%') : null,
        esicCol: iEsicEmp >= 0 ? String(grid[hdrIdx][iEsicEmp] || 'ESIC 0.75%') : null
      },
      totals: {
        empCount: rows.length,
        complianceTotal: compSum,
        manualTotal: manualSum,
        diffTotal: diffSum,
        pfTotal: pfSum,
        esicTotal: esicSum
      }
    };
  }

  function analyzeWorkbookTabs(fileObj, sheetKind) {
    if (!fileObj || !fileObj.sheets) return [];
    var kind = String(sheetKind || 'BOTH').toUpperCase();
    var candidates = [];
    Object.keys(fileObj.sheets).forEach(function(sheetName) {
      var low = String(sheetName || '').toLowerCase();
      if (/\b(summary|abstract|chart|challan|ecr|pf summary|esic summary|attendance|absent|ot sheet|pivot|rough)\b/.test(low)) return;
      var parsed = parseSingleSalarySheet(fileObj.sheets[sheetName], sheetName, kind, fileObj.name);
      if (parsed && parsed.rows.length > 0) candidates.push(parsed);
    });
    candidates.sort(function(a, b) { return b.score - a.score; });

    var pickedMap = {};
    candidates.forEach(function(tab, idx) {
      if (idx === 0) {
        tab.recommended = true;
        tab.overlapPct = 0;
        tab.rows.forEach(function(r) { pickedMap[normalizeCode(r.empCode)] = true; });
        return;
      }
      var overlapCount = 0;
      tab.rows.forEach(function(r) {
        if (pickedMap[normalizeCode(r.empCode)]) overlapCount++;
      });
      var overlapRatio = overlapCount / Math.max(1, tab.rows.length);
      var maxAllowedOverlap = kind === 'BATCH' ? 0.25 : 0.10;
      tab.overlapPct = Math.round(overlapRatio * 100);
      tab.recommended = overlapRatio < maxAllowedOverlap;
      if (tab.recommended) {
        tab.rows.forEach(function(r) { pickedMap[normalizeCode(r.empCode)] = true; });
      }
    });
    return candidates;
  }

  function extractSalaryRowsWithMeta(fileObj, sheetKind, chosenTabNames) {
    var empty = { rows: [], selectedSheets: [], skippedSheets: [], allTabs: [], primaryColumns: {}, totals: { empCount: 0, complianceTotal: 0, manualTotal: 0, diffTotal: 0, pfTotal: 0, esicTotal: 0 } };
    if (!fileObj || !fileObj.sheets) return empty;
    var kind = String(sheetKind || 'BOTH').toUpperCase();
    var candidates = analyzeWorkbookTabs(fileObj, kind);
    if (!candidates.length) return empty;

    var hasExplicitSelection = Array.isArray(chosenTabNames) && chosenTabNames.length > 0;
    var chosenSet = {};
    if (hasExplicitSelection) {
      chosenTabNames.forEach(function(n) { chosenSet[String(n)] = true; });
    }

    var byKey = {};
    var selectedSheets = [];
    var skippedSheets = [];

    candidates.forEach(function(tab) {
      var pick = hasExplicitSelection ? !!chosenSet[tab.sheetName] : !!tab.recommended;
      if (!pick) {
        skippedSheets.push(tab.sheetName + (tab.overlapPct ? (' (' + tab.overlapPct + '% duplicate)') : ''));
        return;
      }
      selectedSheets.push(tab.sheetName);
      tab.rows.forEach(function(r) {
        var norm = normalizeCode(r.empCode);
        if (!byKey[norm]) {
          byKey[norm] = r;
        } else if (kind === 'BATCH') {
          byKey[norm] = Object.assign({}, byKey[norm], { amount: round2((Number(byKey[norm].amount) || 0) + (Number(r.amount) || 0)) });
        }
      });
    });

    var finalRows = Object.values(byKey);
    var totals = finalRows.reduce(function(acc, r) {
      acc.empCount++;
      acc.complianceTotal = round2(acc.complianceTotal + (Number(r.complianceAmount) || 0));
      acc.manualTotal = round2(acc.manualTotal + (Number(r.manualAmount) || 0));
      acc.diffTotal = round2(acc.diffTotal + (Number(r.baseDiffAmount) || 0));
      acc.pfTotal = round2(acc.pfTotal + (Number(r.pfEmployee) || 0));
      acc.esicTotal = round2(acc.esicTotal + (Number(r.esicEmployee) || 0));
      return acc;
    }, { empCount: 0, complianceTotal: 0, manualTotal: 0, diffTotal: 0, pfTotal: 0, esicTotal: 0 });

    return {
      rows: finalRows,
      selectedSheets: selectedSheets,
      skippedSheets: skippedSheets,
      allTabs: candidates,
      primaryColumns: (candidates.find(function(c) { return selectedSheets.indexOf(c.sheetName) >= 0; }) || candidates[0]).columns,
      totals: totals
    };
  }

  // sheetKind: 'BOTH' | 'COMPLIANCE' | 'DIFF' | 'BATCH'
  function extractSalaryRowsFromWorkbook(fileObj, sheetKind) {
    return extractSalaryRowsWithMeta(fileObj, sheetKind).rows;
  }

  function getLoadedSalaryWorkbooks() {
    var files = [];
    if (Array.isArray(window.FILES)) files = files.concat(window.FILES);
    if (window.ATPLCentralFileSync && window.ATPLCentralFileSync.fileMap && typeof window.ATPLCentralFileSync.fileMap === 'object') {
      Object.values(window.ATPLCentralFileSync.fileMap).forEach(function(f) {
        if (f && f.name && !files.some(function(x) { return x && x.name === f.name; })) files.push(f);
      });
    }
    return files.filter(function(f) {
      return f && f.sheets && !/\.json$/i.test(String(f.name || ''));
    });
  }

  function importFromLoadedFile(fileName, monthKey, sheetKind, opts) {
    var mk = monthKey || state.selectedMonth;
    var kind = String(sheetKind || 'BOTH').toUpperCase();
    var files = getLoadedSalaryWorkbooks();
    var target = files.find(function(f) { return f && f.name === fileName; });
    if (!target) {
      if (window.showToast) window.showToast('⚠️ Selected salary file loaded nahi mili.');
      return { ok: false, imported: 0 };
    }
    var meta = extractSalaryRowsWithMeta(target, kind);
    if (!meta.rows.length) {
      if (window.showToast) window.showToast('⚠️ Is sheet me Emp Code / Net Payment / Amount columns detect nahi huye.');
      return { ok: false, imported: 0 };
    }
    var mergedOpts = Object.assign({}, opts || {}, { selectedTabs: meta.selectedSheets });
    var res = bulkImportMonthSalaries(mk, meta.rows, target.name, kind, mergedOpts);
    res.meta = meta;
    if (window.showToast) {
      window.showToast('✅ ' + res.imported + ' employees (' + meta.selectedSheets.join(', ') + ') import · Net Pay ' + formatINR(meta.totals.complianceTotal) + ' · PF ' + formatINR(meta.totals.pfTotal) + ' · ESIC ' + formatINR(meta.totals.esicTotal));
    }
    return res;
  }

  function readWorkbookFromFileInput(file, callback) {
    if (!file || typeof window.XLSX === 'undefined') {
      if (window.showToast) window.showToast('⚠️ Excel reader ready nahi hai.');
      return;
    }
    var reader = new window.FileReader();
    reader.onload = function(ev) {
      try {
        var wb = window.XLSX.read(ev.target.result, { type: 'array' });
        var sheets = {};
        wb.SheetNames.forEach(function(sn) {
          sheets[sn] = window.XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: '' });
        });
        callback(null, { name: file.name, sheets: sheets });
      } catch (err) {
        callback(err);
      }
    };
    reader.onerror = function() { callback(new Error('File read failed')); };
    reader.readAsArrayBuffer(file);
  }

  // ── UI MODALS & INTERACTION HANDLERS ──
  function getOrCreateModal() {
    var m = document.getElementById('salPayoutModal');
    if (!m && typeof document !== 'undefined' && document.body) {
      m = document.createElement('div');
      m.id = 'salPayoutModal';
      document.body.appendChild(m);
    }
    return m;
  }

  function closeModal() {
    state.editingPointId = null;
    state.editingReturnId = null;
    state.editingBatchId = null;
    state._batchExtraRows = [];
    var m = document.getElementById('salPayoutModal');
    if (m) m.innerHTML = '';
  }

  function openPointModal(pointId, prefillEmpCode) {
    var p = pointId ? state.points[pointId] : null;
    state.editingPointId = p ? p.id : null;
    var modal = getOrCreateModal();
    if (!modal) return;
    var defCode = p ? p.empCode : (prefillEmpCode || '');
    var em = defCode ? findEmployeeByCode(defCode) : null;
    var defDir = p ? p.direction : 'ADD';
    var defApply = p ? p.applyTo : 'DIFF';
    var defAmt = p ? p.amount : '';
    var defNote = p ? p.note : '';

    var h = '';
    h += '<div style="position:fixed;inset:0;background:rgba(15,23,42,0.5);backdrop-filter:blur(3px);z-index:10050;display:flex;align-items:center;justify-content:center;padding:16px" onclick="if(event.target===this)ATPLSalaryPayout.closeModal()">';
    h += '  <div style="background:#fff;border:1px solid #e2e8f0;border-radius:14px;max-width:500px;width:100%;box-shadow:0 24px 48px rgba(15,23,42,0.22);overflow:hidden">';
    h += '    <div style="padding:16px 20px;border-bottom:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center">';
    h += '      <div><div style="font-size:11px;font-weight:700;color:#4f46e5">' + esc(formatMonthLabel(state.selectedMonth)) + ' · Emp Code Adjustment</div><h3 style="margin:2px 0 0;font-size:16px;font-weight:800;color:#0f172a">' + (p ? 'Edit Salary Point' : 'Add Emp Salary Point (+/-)') + '</h3></div>';
    h += '      <button type="button" onclick="ATPLSalaryPayout.closeModal()" style="border:1px solid #e2e8f0;background:#f8fafc;color:#64748b;width:30px;height:30px;border-radius:8px;cursor:pointer;font-size:14px">✕</button>';
    h += '    </div>';
    h += '    <div style="padding:16px 20px;display:flex;flex-direction:column;gap:12px">';
    h += '      <div>';
    h += '        <label style="display:block;font-size:11px;font-weight:700;color:#475569;margin-bottom:4px">Employee Code</label>';
    h += '        <input type="text" id="spPtCode" value="' + esc(defCode) + '" oninput="ATPLSalaryPayout.onPointCodeInput(this.value)" placeholder="e.g. 25924 or 00387" style="width:100%;padding:9px 11px;border:1px solid #cbd5e1;border-radius:8px;font-size:13px;font-weight:700;color:#0f172a;box-sizing:border-box">';
    h += '        <div id="spPtEmpPreview" style="margin-top:4px;font-size:11px;color:#475569">' + (em ? ('<strong>' + esc(em.name) + '</strong> · ' + esc(em.dept || '-') + ' · ' + esc(em.desig || '-')) : 'Emp Code daalein — Name & Dept automatic aayega') + '</div>';
    h += '      </div>';
    h += '      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">';
    h += '        <div>';
    h += '          <label style="display:block;font-size:11px;font-weight:700;color:#475569;margin-bottom:4px">Kam / Zyada Type</label>';
    h += '          <select id="spPtDir" style="width:100%;padding:9px 10px;border:1px solid #cbd5e1;border-radius:8px;font-size:12px;font-weight:700;color:#0f172a;background:#fff">';
    POINT_DIRECTIONS.forEach(function(d) {
      h += '            <option value="' + d.key + '"' + (defDir === d.key ? ' selected' : '') + '>' + esc(d.label) + '</option>';
    });
    h += '          </select>';
    h += '        </div>';
    h += '        <div>';
    h += '          <label style="display:block;font-size:11px;font-weight:700;color:#475569;margin-bottom:4px">Apply On</label>';
    h += '          <select id="spPtApply" style="width:100%;padding:9px 10px;border:1px solid #cbd5e1;border-radius:8px;font-size:12px;font-weight:700;color:#0f172a;background:#fff">';
    POINT_APPLY_TO.forEach(function(a) {
      h += '            <option value="' + a.key + '"' + (defApply === a.key ? ' selected' : '') + '>' + esc(a.label) + '</option>';
    });
    h += '          </select>';
    h += '        </div>';
    h += '      </div>';
    h += '      <div>';
    h += '        <label style="display:block;font-size:11px;font-weight:700;color:#475569;margin-bottom:4px">Adjustment Amount (₹)</label>';
    h += '        <input type="number" id="spPtAmount" min="0" step="1" value="' + esc(defAmt) + '" placeholder="e.g. 500" style="width:100%;padding:9px 11px;border:1px solid #cbd5e1;border-radius:8px;font-size:13px;font-weight:700;color:#0f172a;box-sizing:border-box">';
    h += '      </div>';
    h += '      <div>';
    h += '        <label style="display:block;font-size:11px;font-weight:700;color:#475569;margin-bottom:4px">Point / Reason / Remark</label>';
    h += '        <textarea id="spPtNote" rows="2" placeholder="e.g. Double machine allowance +₹500 / 2 days short -₹600 / Hold reason..." style="width:100%;padding:9px 11px;border:1px solid #cbd5e1;border-radius:8px;font-size:12px;color:#0f172a;box-sizing:border-box">' + esc(defNote) + '</textarea>';
    h += '      </div>';
    h += '    </div>';
    h += '    <div style="padding:12px 20px;border-top:1px solid #e2e8f0;background:#f8fafc;display:flex;justify-content:flex-end;gap:8px">';
    h += '      <button type="button" onclick="ATPLSalaryPayout.closeModal()" style="padding:8px 14px;border:1px solid #cbd5e1;background:#fff;color:#475569;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer">Cancel</button>';
    h += '      <button type="button" onclick="ATPLSalaryPayout.submitPointModal()" style="padding:8px 18px;border:none;background:#1e293b;color:#fff;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer">Save &amp; Sync Point</button>';
    h += '    </div>';
    h += '  </div>';
    h += '</div>';
    modal.innerHTML = h;
  }

  function onPointCodeInput(code) {
    var el = document.getElementById('spPtEmpPreview');
    if (!el) return;
    var em = findEmployeeByCode(code);
    el.innerHTML = em
      ? ('<strong style="color:#15803d">' + esc(em.name) + '</strong> · ' + esc(em.dept || '-') + ' · ' + esc(em.desig || '-'))
      : '<span style="color:#b45309">Master me code check ho raha hai / Manual code accept hoga</span>';
  }

  function submitPointModal() {
    var code = String((document.getElementById('spPtCode') || {}).value || '').trim();
    var dir = String((document.getElementById('spPtDir') || {}).value || 'ADD').trim();
    var applyTo = String((document.getElementById('spPtApply') || {}).value || 'DIFF').trim();
    var amount = (document.getElementById('spPtAmount') || {}).value;
    var note = String((document.getElementById('spPtNote') || {}).value || '').trim();
    var res = addOrUpdatePoint({
      id: state.editingPointId || undefined,
      monthKey: state.selectedMonth,
      empCode: code,
      direction: dir,
      applyTo: applyTo,
      amount: amount,
      note: note
    });
    if (!res.ok) {
      if (window.showToast) window.showToast('⚠️ Emp Code aur Amount/Note daalna zaroori hai.');
      return;
    }
    closeModal();
    if (window.showToast) window.showToast('✅ Salary Point save & sabhi browsers me sync ho gaya!');
  }

  // Edit / Add Employee Salary + Add Missed Diff modal
  function openEmpSalaryModal(empCode, mode) {
    var code = empCode ? String(empCode).trim() : '';
    var norm = code ? normalizeCode(code) : '';
    var prev = norm ? state.empSalaries[state.selectedMonth + '::' + norm] : null;
    var em = code ? findEmployeeByCode(code) : null;
    var modal = getOrCreateModal();
    if (!modal) return;
    var isMissedMode = mode === 'MISSED_DIFF';
    var compLocked = !isMissedMode && isComplianceLockedForMonth(state.selectedMonth);

    var h = '';
    h += '<div style="position:fixed;inset:0;background:rgba(15,23,42,0.5);backdrop-filter:blur(3px);z-index:10050;display:flex;align-items:center;justify-content:center;padding:16px" onclick="if(event.target===this)ATPLSalaryPayout.closeModal()">';
    h += '  <div style="background:#fff;border:1px solid #e2e8f0;border-radius:14px;max-width:520px;width:100%;box-shadow:0 24px 48px rgba(15,23,42,0.22);overflow:hidden">';
    h += '    <div style="padding:15px 20px;border-bottom:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center">';
    h += '      <div><div style="font-size:11px;font-weight:700;color:#4f46e5">' + esc(formatMonthLabel(state.selectedMonth)) + ' · Employee Salary &amp; Missed Diff</div><h3 style="margin:2px 0 0;font-size:16px;font-weight:800;color:#0f172a">' + (isMissedMode ? 'Add Chhoota Hua / Missed Diff Amount' : (prev ? 'Edit Employee Salary Row' : 'Add Manual Employee Salary')) + '</h3></div>';
    h += '      <button type="button" onclick="ATPLSalaryPayout.closeModal()" style="border:1px solid #e2e8f0;background:#f8fafc;color:#64748b;width:30px;height:30px;border-radius:8px;cursor:pointer;font-size:14px">✕</button>';
    h += '    </div>';
    h += '    <div style="padding:16px 20px;display:flex;flex-direction:column;gap:12px">';
    h += '      <div style="display:grid;grid-template-columns:1fr 1.4fr;gap:10px">';
    h += '        <div><label style="display:block;font-size:11px;font-weight:700;color:#475569;margin-bottom:3px">Emp Code</label><input type="text" id="spEmpCode" value="' + esc(code) + '" oninput="ATPLSalaryPayout.onEmpSalaryCodeInput(this.value)" placeholder="e.g. 25924" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;font-size:12.5px;font-weight:700;box-sizing:border-box"></div>';
    h += '        <div><label style="display:block;font-size:11px;font-weight:700;color:#475569;margin-bottom:3px">Employee Name</label><input type="text" id="spEmpName" value="' + esc((prev && prev.empName) || (em && em.name) || '') + '" placeholder="Auto from Master" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;font-size:12.5px;box-sizing:border-box"></div>';
    h += '      </div>';
    if (isMissedMode) {
      h += '      <div style="padding:12px;background:#fff7ed;border:1px solid #fed7aa;border-radius:8px">';
      h += '        <label style="display:block;font-size:11px;font-weight:800;color:#9a3412;margin-bottom:4px">Chhoota Hua / Missed Diff Amount Add Karein (₹)</label>';
      h += '        <input type="number" id="spEmpMissedAdd" min="1" placeholder="e.g. 150 or 2500" style="width:100%;padding:9px 10px;border:1px solid #fdba74;border-radius:8px;font-size:13px;font-weight:800;box-sizing:border-box">';
      h += '        <div id="spEmpCurrInfo" style="margin-top:5px;font-size:11px;color:#7c2d12">Existing Base Diff: ' + formatINR(prev ? (Number(prev.baseDiffAmount) || 0) + (Number(prev.missedDiffAmount) || 0) : 0) + ' (Naya amount isme judkar Dashboard par show hoga)</div>';
      h += '      </div>';
    } else {
      if (compLocked) {
        h += '      <div style="padding:8px 10px;background:#f0fdf4;border:1px solid #86efac;border-radius:8px;font-size:11px;font-weight:700;color:#15803d">🔒 Compliance Processed &amp; Locked — Net Pay / PF / ESIC me change nahi ho sakta (sirf Bank Return / Unlock allowed). Diff &amp; Missed Diff edit kar sakte hain.</div>';
      }
      h += '      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">';
      h += '        <div><label style="display:block;font-size:11px;font-weight:700;color:#475569;margin-bottom:3px">Compliance / Net Pay (₹)' + (compLocked ? ' 🔒' : '') + '</label><input type="number" id="spEmpComp" min="0" value="' + esc(prev ? prev.complianceAmount : 0) + '"' + (compLocked ? ' disabled' : '') + ' style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:8px;font-size:12.5px;font-weight:700;box-sizing:border-box' + (compLocked ? ';background:#f1f5f9;color:#64748b' : '') + '"></div>';
      h += '        <div><label style="display:block;font-size:11px;font-weight:700;color:#475569;margin-bottom:3px">Base Diff (₹)</label><input type="number" id="spEmpDiff" min="0" value="' + esc(prev ? prev.baseDiffAmount : 0) + '" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:8px;font-size:12.5px;font-weight:700;box-sizing:border-box"></div>';
      h += '        <div><label style="display:block;font-size:11px;font-weight:700;color:#9a3412;margin-bottom:3px">Missed Diff (₹)</label><input type="number" id="spEmpMissed" min="0" value="' + esc(prev ? prev.missedDiffAmount : 0) + '" style="width:100%;padding:8px;border:1px solid #fdba74;border-radius:8px;font-size:12.5px;font-weight:700;box-sizing:border-box"></div>';
      h += '      </div>';
      h += '      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">';
      h += '        <div><label style="display:block;font-size:11px;font-weight:700;color:#475569;margin-bottom:3px">Manual Amount (₹)</label><input type="number" id="spEmpManual" min="0" value="' + esc(prev ? (prev.manualAmount || 0) : 0) + '" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:8px;font-size:12px;font-weight:700;box-sizing:border-box"></div>';
      h += '        <div><label style="display:block;font-size:11px;font-weight:700;color:#475569;margin-bottom:3px">PF @12% (₹)' + (compLocked ? ' 🔒' : '') + '</label><input type="number" id="spEmpPf" min="0" value="' + esc(prev ? (prev.pfEmployee || 0) : 0) + '"' + (compLocked ? ' disabled' : '') + ' style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:8px;font-size:12px;box-sizing:border-box' + (compLocked ? ';background:#f1f5f9;color:#64748b' : '') + '"></div>';
      h += '        <div><label style="display:block;font-size:11px;font-weight:700;color:#475569;margin-bottom:3px">ESIC @0.75% (₹)' + (compLocked ? ' 🔒' : '') + '</label><input type="number" id="spEmpEsic" min="0" value="' + esc(prev ? (prev.esicEmployee || 0) : 0) + '"' + (compLocked ? ' disabled' : '') + ' style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:8px;font-size:12px;box-sizing:border-box' + (compLocked ? ';background:#f1f5f9;color:#64748b' : '') + '"></div>';
      h += '      </div>';
    }
    h += '      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">';
    h += '        <div><label style="display:block;font-size:11px;font-weight:700;color:#475569;margin-bottom:3px">Bank A/C No (Optional)</label><input type="text" id="spEmpAcc" value="' + esc((prev && prev.accountNo) || (em && em.accountNo) || '') + '" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:8px;font-size:12px;font-family:monospace;box-sizing:border-box"></div>';
    h += '        <div><label style="display:block;font-size:11px;font-weight:700;color:#475569;margin-bottom:3px">IFSC (Optional)</label><input type="text" id="spEmpIfsc" value="' + esc((prev && prev.ifsc) || (em && em.ifsc) || '') + '" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:8px;font-size:12px;font-family:monospace;box-sizing:border-box"></div>';
    h += '      </div>';
    h += '      <div><label style="display:block;font-size:11px;font-weight:700;color:#475569;margin-bottom:3px">Remarks</label><input type="text" id="spEmpRem" value="' + esc((prev && prev.remarks) || '') + '" placeholder="e.g. Chhoota diff added / Bank sheet note" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;font-size:12px;box-sizing:border-box"></div>';
    h += '    </div>';
    h += '    <div style="padding:12px 20px;border-top:1px solid #e2e8f0;background:#f8fafc;display:flex;justify-content:flex-end;gap:8px">';
    h += '      <button type="button" onclick="ATPLSalaryPayout.closeModal()" style="padding:8px 14px;border:1px solid #cbd5e1;background:#fff;color:#475569;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer">Cancel</button>';
    h += '      <button type="button" onclick="ATPLSalaryPayout.submitEmpSalaryModal(' + (isMissedMode ? 'true' : 'false') + ')" style="padding:8px 18px;border:none;background:#0f172a;color:#fff;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer">Save &amp; Sync</button>';
    h += '    </div>';
    h += '  </div>';
    h += '</div>';
    modal.innerHTML = h;
  }

  function onEmpSalaryCodeInput(code) {
    var em = findEmployeeByCode(code);
    var norm = normalizeCode(code);
    var prev = state.empSalaries[state.selectedMonth + '::' + norm];
    var nmEl = document.getElementById('spEmpName');
    var accEl = document.getElementById('spEmpAcc');
    var ifscEl = document.getElementById('spEmpIfsc');
    var currEl = document.getElementById('spEmpCurrInfo');
    if (nmEl && (em || prev)) nmEl.value = (prev && prev.empName) || (em && em.name) || '';
    if (accEl && (em || prev)) accEl.value = (prev && prev.accountNo) || (em && em.accountNo) || '';
    if (ifscEl && (em || prev)) ifscEl.value = (prev && prev.ifsc) || (em && em.ifsc) || '';
    if (currEl) currEl.textContent = 'Existing Base Diff: ' + formatINR(prev ? (Number(prev.baseDiffAmount) || 0) + (Number(prev.missedDiffAmount) || 0) : 0);
  }

  function submitEmpSalaryModal(isMissedMode) {
    var code = String((document.getElementById('spEmpCode') || {}).value || '').trim();
    if (!code) {
      if (window.showToast) window.showToast('⚠️ Emp Code daalna zaroori hai.');
      return;
    }
    var payload = {
      monthKey: state.selectedMonth,
      empCode: code,
      empName: (document.getElementById('spEmpName') || {}).value,
      accountNo: (document.getElementById('spEmpAcc') || {}).value,
      ifsc: (document.getElementById('spEmpIfsc') || {}).value,
      remarks: (document.getElementById('spEmpRem') || {}).value
    };
    if (isMissedMode) {
      var addMissed = Number((document.getElementById('spEmpMissedAdd') || {}).value) || 0;
      if (addMissed <= 0) {
        if (window.showToast) window.showToast('⚠️ Missed Diff amount daalein.');
        return;
      }
      payload.addMissedDiff = addMissed;
      payload.sourceFile = 'Missed Diff Add-On';
    } else {
      var prevRec = state.empSalaries[state.selectedMonth + '::' + normalizeCode(code)];
      var compLocked = isComplianceLockedForMonth(state.selectedMonth);
      payload.complianceAmount = compLocked && prevRec ? (Number(prevRec.complianceAmount) || 0) : (Number((document.getElementById('spEmpComp') || {}).value) || 0);
      payload.baseDiffAmount = Number((document.getElementById('spEmpDiff') || {}).value) || 0;
      payload.missedDiffAmount = Number((document.getElementById('spEmpMissed') || {}).value) || 0;
      payload.manualAmount = Number((document.getElementById('spEmpManual') || {}).value) || 0;
      payload.pfEmployee = compLocked && prevRec ? (Number(prevRec.pfEmployee) || 0) : (Number((document.getElementById('spEmpPf') || {}).value) || 0);
      payload.esicEmployee = compLocked && prevRec ? (Number(prevRec.esicEmployee) || 0) : (Number((document.getElementById('spEmpEsic') || {}).value) || 0);
    }
    upsertEmpSalary(payload);
    closeModal();
    if (window.showToast) window.showToast('✅ Employee salary updated & dashboard synced!');
  }

  function openReturnModal(returnId, prefillEmpCode) {
    var r = returnId ? state.returns[returnId] : null;
    state.editingReturnId = r ? r.id : null;
    var modal = getOrCreateModal();
    if (!modal) return;
    var defCode = r ? r.empCode : (prefillEmpCode || '');
    var em = defCode ? findEmployeeByCode(defCode) : null;
    var salRow = defCode ? state.empSalaries[state.selectedMonth + '::' + normalizeCode(defCode)] : null;
    var defAmt = r ? r.amount : (salRow && salRow.complianceAmount ? salRow.complianceAmount : '');
    var defOldAcc = r ? r.oldAccountNo : ((salRow && salRow.accountNo) || (em && em.accountNo) || '');
    var defOldIfsc = r ? r.oldIfsc : ((salRow && salRow.ifsc) || (em && em.ifsc) || '');
    var defNewAcc = r ? r.newAccountNo : '';
    var defNewIfsc = r ? r.newIfsc : '';
    var defNewBank = r ? r.newBankName : ((em && em.bankName) || '');
    var defReason = r ? r.reason : RETURN_REASONS[0];
    var defStatus = r ? r.status : 'PENDING';
    var defUtr = r ? r.utr : '';

    var h = '';
    h += '<div style="position:fixed;inset:0;background:rgba(15,23,42,0.5);backdrop-filter:blur(3px);z-index:10050;display:flex;align-items:center;justify-content:center;padding:16px" onclick="if(event.target===this)ATPLSalaryPayout.closeModal()">';
    h += '  <div style="background:#fff;border:1px solid #e2e8f0;border-radius:14px;max-width:560px;width:100%;max-height:92vh;overflow-y:auto;box-shadow:0 24px 48px rgba(15,23,42,0.22)">';
    h += '    <div style="padding:16px 20px;border-bottom:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center">';
    h += '      <div><div style="font-size:11px;font-weight:700;color:#b45309">' + esc(formatMonthLabel(state.selectedMonth)) + ' · Compliance Bank Return</div><h3 style="margin:2px 0 0;font-size:16px;font-weight:800;color:#0f172a">' + (r ? 'Edit Return / Account Re-Pay' : 'Record Compliance Bank Return & Change A/C') + '</h3></div>';
    h += '      <button type="button" onclick="ATPLSalaryPayout.closeModal()" style="border:1px solid #e2e8f0;background:#f8fafc;color:#64748b;width:30px;height:30px;border-radius:8px;cursor:pointer;font-size:14px">✕</button>';
    h += '    </div>';
    h += '    <div style="padding:16px 20px;display:flex;flex-direction:column;gap:12px">';
    h += '      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">';
    h += '        <div>';
    h += '          <label style="display:block;font-size:11px;font-weight:700;color:#475569;margin-bottom:4px">Employee Code</label>';
    h += '          <input type="text" id="spRetCode" value="' + esc(defCode) + '" oninput="ATPLSalaryPayout.onReturnCodeInput(this.value)" placeholder="e.g. 25924" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;font-size:12.5px;font-weight:700;box-sizing:border-box">';
    h += '        </div>';
    h += '        <div>';
    h += '          <label style="display:block;font-size:11px;font-weight:700;color:#475569;margin-bottom:4px">Returned Amount (₹)</label>';
    h += '          <input type="number" id="spRetAmount" min="1" value="' + esc(defAmt) + '" placeholder="e.g. 16500" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;font-size:12.5px;font-weight:700;box-sizing:border-box">';
    h += '        </div>';
    h += '      </div>';
    h += '      <div id="spRetEmpInfo" style="font-size:11px;color:#475569">' + (em ? ('<strong>' + esc(em.name) + '</strong> · ' + esc(em.dept || '-')) : 'Emp Code daalne par Old Bank A/C auto fill hoga') + '</div>';
    h += '      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">';
    h += '        <div>';
    h += '          <label style="display:block;font-size:11px;font-weight:700;color:#475569;margin-bottom:4px">Return Reason</label>';
    h += '          <select id="spRetReason" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;font-size:12px;background:#fff">';
    RETURN_REASONS.forEach(function(rs) {
      h += '            <option value="' + esc(rs) + '"' + (defReason === rs ? ' selected' : '') + '>' + esc(rs) + '</option>';
    });
    h += '          </select>';
    h += '        </div>';
    h += '        <div>';
    h += '          <label style="display:block;font-size:11px;font-weight:700;color:#475569;margin-bottom:4px">Status</label>';
    h += '          <select id="spRetStatus" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;font-size:12px;font-weight:700;background:#fff">';
    h += '            <option value="PENDING"' + (defStatus === 'PENDING' ? ' selected' : '') + '>Return Pending (Re-Pay Baaki)</option>';
    h += '            <option value="RETRANSFERRED"' + (defStatus === 'RETRANSFERRED' ? ' selected' : '') + '>Re-Transferred / Paid</option>';
    h += '          </select>';
    h += '        </div>';
    h += '      </div>';
    h += '      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:10px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px">';
    h += '        <div><label style="display:block;font-size:10.5px;font-weight:700;color:#64748b;margin-bottom:3px">Old Bank A/C (Returned)</label><input type="text" id="spRetOldAcc" value="' + esc(defOldAcc) + '" style="width:100%;padding:7px 9px;border:1px solid #cbd5e1;border-radius:6px;font-size:12px;font-family:monospace;box-sizing:border-box"></div>';
    h += '        <div><label style="display:block;font-size:10.5px;font-weight:700;color:#64748b;margin-bottom:3px">Old IFSC</label><input type="text" id="spRetOldIfsc" value="' + esc(defOldIfsc) + '" style="width:100%;padding:7px 9px;border:1px solid #cbd5e1;border-radius:6px;font-size:12px;font-family:monospace;box-sizing:border-box"></div>';
    h += '      </div>';
    h += '      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:10px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px">';
    h += '        <div><label style="display:block;font-size:10.5px;font-weight:700;color:#15803d;margin-bottom:3px">New / Corrected Bank A/C</label><input type="text" id="spRetNewAcc" value="' + esc(defNewAcc) + '" placeholder="Naya Sahi Account No." style="width:100%;padding:7px 9px;border:1px solid #86efac;border-radius:6px;font-size:12px;font-family:monospace;font-weight:700;box-sizing:border-box"></div>';
    h += '        <div><label style="display:block;font-size:10.5px;font-weight:700;color:#15803d;margin-bottom:3px">New IFSC</label><input type="text" id="spRetNewIfsc" value="' + esc(defNewIfsc) + '" placeholder="e.g. SBIN0001234" style="width:100%;padding:7px 9px;border:1px solid #86efac;border-radius:6px;font-size:12px;font-family:monospace;font-weight:700;box-sizing:border-box"></div>';
    h += '        <div><label style="display:block;font-size:10.5px;font-weight:700;color:#15803d;margin-bottom:3px">New Bank Name (Optional)</label><input type="text" id="spRetNewBank" value="' + esc(defNewBank) + '" placeholder="e.g. SBI / BOB / HDFC" style="width:100%;padding:7px 9px;border:1px solid #86efac;border-radius:6px;font-size:12px;box-sizing:border-box"></div>';
    h += '        <div><label style="display:block;font-size:10.5px;font-weight:700;color:#15803d;margin-bottom:3px">Re-Transfer UTR / Ref</label><input type="text" id="spRetUtr" value="' + esc(defUtr) + '" placeholder="Re-pay UTR number" style="width:100%;padding:7px 9px;border:1px solid #86efac;border-radius:6px;font-size:12px;font-family:monospace;box-sizing:border-box"></div>';
    h += '      </div>';
    h += '      <label style="display:flex;align-items:center;gap:8px;font-size:12px;font-weight:600;color:#0f172a;cursor:pointer"><input type="checkbox" id="spRetUpdateMaster" checked> New Bank A/C &amp; IFSC ko Employee Master me bhi update &amp; sync karein</label>';
    h += '    </div>';
    h += '    <div style="padding:12px 20px;border-top:1px solid #e2e8f0;background:#f8fafc;display:flex;justify-content:flex-end;gap:8px">';
    h += '      <button type="button" onclick="ATPLSalaryPayout.closeModal()" style="padding:8px 14px;border:1px solid #cbd5e1;background:#fff;color:#475569;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer">Cancel</button>';
    h += '      <button type="button" onclick="ATPLSalaryPayout.submitReturnModal()" style="padding:8px 18px;border:none;background:#1e293b;color:#fff;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer">Save &amp; Sync Return</button>';
    h += '    </div>';
    h += '  </div>';
    h += '</div>';
    modal.innerHTML = h;
  }

  function onReturnCodeInput(code) {
    var em = findEmployeeByCode(code);
    var salRow = state.empSalaries[state.selectedMonth + '::' + normalizeCode(code)];
    var info = document.getElementById('spRetEmpInfo');
    if (info) {
      info.innerHTML = em ? ('<strong style="color:#15803d">' + esc(em.name) + '</strong> · ' + esc(em.dept || '-')) : 'Manual Emp Code';
    }
    var oldAcc = document.getElementById('spRetOldAcc');
    var oldIfsc = document.getElementById('spRetOldIfsc');
    var amtEl = document.getElementById('spRetAmount');
    if (oldAcc && !oldAcc.value) oldAcc.value = (salRow && salRow.accountNo) || (em && em.accountNo) || '';
    if (oldIfsc && !oldIfsc.value) oldIfsc.value = (salRow && salRow.ifsc) || (em && em.ifsc) || '';
    if (amtEl && !amtEl.value && salRow && salRow.complianceAmount) amtEl.value = salRow.complianceAmount;
  }

  function submitReturnModal() {
    var res = addOrUpdateReturn({
      id: state.editingReturnId || undefined,
      monthKey: state.selectedMonth,
      empCode: (document.getElementById('spRetCode') || {}).value,
      amount: (document.getElementById('spRetAmount') || {}).value,
      reason: (document.getElementById('spRetReason') || {}).value,
      status: (document.getElementById('spRetStatus') || {}).value,
      oldAccountNo: (document.getElementById('spRetOldAcc') || {}).value,
      oldIfsc: (document.getElementById('spRetOldIfsc') || {}).value,
      newAccountNo: (document.getElementById('spRetNewAcc') || {}).value,
      newIfsc: (document.getElementById('spRetNewIfsc') || {}).value,
      newBankName: (document.getElementById('spRetNewBank') || {}).value,
      utr: (document.getElementById('spRetUtr') || {}).value,
      updateMaster: !!(document.getElementById('spRetUpdateMaster') && document.getElementById('spRetUpdateMaster').checked)
    });
    if (!res.ok) {
      if (window.showToast) window.showToast('⚠️ Emp Code aur Returned Amount daalein.');
      return;
    }
    closeModal();
    if (window.showToast) {
      window.showToast(res.masterSynced
        ? '✅ Bank Return saved & Employee Master ka New A/C bhi sync ho gaya!'
        : '✅ Compliance Bank Return save & sync ho gaya!');
    }
  }

  function openBatchModal(batchId, modePreset) {
    var ledger = computeMonthLedger(state.selectedMonth);
    var b = batchId ? state.diffBatches[batchId] : null;
    state.editingBatchId = b ? b.id : null;
    var modal = getOrCreateModal();
    if (!modal) return;

    var nextPart = b ? b.partNumber : (ledger.batches.reduce(function(mx, x) { return Math.max(mx, Number(x.partNumber) || 0); }, 0) + 1);
    var isLeftoverPreset = modePreset === 'LEFTOVER_CLEARANCE';
    var defTitle = b ? b.title : (isLeftoverPreset ? ('Part ' + nextPart + ' - Small Leftover Clearance') : ('Part ' + nextPart + ' Diff Payout'));
    var defLot = b ? b.lotType : (isLeftoverPreset ? 'LEFTOVER_CLEARANCE' : (nextPart === 1 ? 'WORKERS_LOT' : nextPart === 2 ? 'STAFF_LOT' : 'PART_PAYMENT'));
    var defDate = b ? b.paymentDate : todayIso();
    var defMode = b ? b.mode : PAYMENT_MODES[0];
    var defSigned = b ? b.signedBy : '';
    var defUtr = b ? b.utr : '';
    var defStatus = b ? b.status : 'DISBURSED';
    var defLump = b && b.lumpSumAmount ? b.lumpSumAmount : '';
    var defNotes = b ? b.notes : '';

    var existingAllocMap = {};
    var ledgerCodesSet = {};
    ledger.rows.forEach(function(r) { ledgerCodesSet[r.normCode] = true; });
    state._batchExtraRows = [];

    if (b && Array.isArray(b.allocations)) {
      b.allocations.forEach(function(al) {
        if (!al || !al.empCode) return;
        var nc = normalizeCode(al.empCode);
        if (ledgerCodesSet[nc]) {
          existingAllocMap[nc] = { amount: round2(Number(al.amount) || 0), remarks: String(al.remarks || '') };
        } else {
          state._batchExtraRows.push({
            empCode: al.empCode,
            empName: al.empName || ('Employee ' + al.empCode),
            amount: round2(Number(al.amount) || 0),
            remarks: String(al.remarks || ''),
            accountNo: al.accountNo || '',
            ifsc: al.ifsc || ''
          });
        }
      });
    }

    var candidateRows = ledger.rows.filter(function(r) {
      var prevInThisBatch = existingAllocMap[r.normCode] ? existingAllocMap[r.normCode].amount : 0;
      return r.diffRemaining > 0 || prevInThisBatch > 0;
    });

    var h = '';
    h += '<div style="position:fixed;inset:0;background:rgba(15,23,42,0.5);backdrop-filter:blur(3px);z-index:10050;display:flex;align-items:center;justify-content:center;padding:16px" onclick="if(event.target===this)ATPLSalaryPayout.closeModal()">';
    h += '  <div style="background:#fff;border:1px solid #e2e8f0;border-radius:14px;max-width:860px;width:100%;max-height:92vh;display:flex;flex-direction:column;box-shadow:0 24px 48px rgba(15,23,42,0.22);overflow:hidden">';
    h += '    <div style="padding:15px 20px;border-bottom:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center">';
    h += '      <div><div style="font-size:11px;font-weight:700;color:#4f46e5">' + esc(formatMonthLabel(state.selectedMonth)) + ' · Multi-Part Diff Payout</div><h3 style="margin:2px 0 0;font-size:16px;font-weight:800;color:#0f172a">' + (b ? 'Edit Diff Payout Batch' : 'New Diff Payout Batch (Part ' + nextPart + ')') + '</h3></div>';
    h += '      <button type="button" onclick="ATPLSalaryPayout.closeModal()" style="border:1px solid #e2e8f0;background:#f8fafc;color:#64748b;width:30px;height:30px;border-radius:8px;cursor:pointer;font-size:14px">✕</button>';
    h += '    </div>';
    h += '    <div style="padding:16px 20px;overflow-y:auto;flex:1;display:flex;flex-direction:column;gap:12px">';
    h += '      <div style="display:grid;grid-template-columns:70px 1.4fr 1.2fr;gap:10px">';
    h += '        <div><label style="display:block;font-size:10.5px;font-weight:700;color:#475569;margin-bottom:3px">Part #</label><input type="number" id="spBatPart" min="1" value="' + esc(nextPart) + '" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:8px;font-size:12.5px;font-weight:700;box-sizing:border-box"></div>';
    h += '        <div><label style="display:block;font-size:10.5px;font-weight:700;color:#475569;margin-bottom:3px">Batch / Lot Name</label><input type="text" id="spBatTitle" value="' + esc(defTitle) + '" placeholder="e.g. Part 1 - Workers Lot (4.5L)" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;font-size:12.5px;font-weight:700;box-sizing:border-box"></div>';
    h += '        <div><label style="display:block;font-size:10.5px;font-weight:700;color:#475569;margin-bottom:3px">Lot Category</label><select id="spBatLot" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:8px;font-size:12px;background:#fff">';
    LOT_TYPES.forEach(function(lt) {
      h += '          <option value="' + lt.key + '"' + (defLot === lt.key ? ' selected' : '') + '>' + esc(lt.label) + '</option>';
    });
    h += '        </select></div>';
    h += '      </div>';

    h += '      <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:10px">';
    h += '        <div><label style="display:block;font-size:10.5px;font-weight:700;color:#475569;margin-bottom:3px">Payment Date</label><input type="date" id="spBatDate" value="' + esc(defDate) + '" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:8px;font-size:12px;box-sizing:border-box"></div>';
    h += '        <div><label style="display:block;font-size:10.5px;font-weight:700;color:#475569;margin-bottom:3px">Mode</label><select id="spBatMode" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:8px;font-size:12px;background:#fff">';
    PAYMENT_MODES.forEach(function(pm) {
      h += '          <option value="' + esc(pm) + '"' + (defMode === pm ? ' selected' : '') + '>' + esc(pm) + '</option>';
    });
    h += '        </select></div>';
    h += '        <div><label style="display:block;font-size:10.5px;font-weight:700;color:#475569;margin-bottom:3px">Director Sign</label><select id="spBatSigned" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:8px;font-size:12px;background:#fff"><option value="">Optional</option>';
    SIGNATORIES.forEach(function(sg) {
      h += '          <option value="' + esc(sg) + '"' + (defSigned === sg ? ' selected' : '') + '>' + esc(sg) + '</option>';
    });
    h += '        </select></div>';
    h += '        <div><label style="display:block;font-size:10.5px;font-weight:700;color:#475569;margin-bottom:3px">Status</label><select id="spBatStatus" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:8px;font-size:12px;font-weight:700;background:#fff"><option value="DISBURSED"' + (defStatus === 'DISBURSED' ? ' selected' : '') + '>Disbursed / Paid</option><option value="PLANNED"' + (defStatus === 'PLANNED' ? ' selected' : '') + '>Planned / Ready</option></select></div>';
    h += '      </div>';

    h += '      <div style="display:grid;grid-template-columns:1fr 1fr 1.3fr;gap:10px">';
    h += '        <div><label style="display:block;font-size:10.5px;font-weight:700;color:#475569;margin-bottom:3px">Lump-Sum Lot Amount (₹ Optional)</label><input type="number" id="spBatLump" min="0" value="' + esc(defLump) + '" oninput="ATPLSalaryPayout.recalcBatchModalTotal()" placeholder="Bina emp list ke lot amount" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;font-size:12px;font-weight:700;box-sizing:border-box"></div>';
    h += '        <div><label style="display:block;font-size:10.5px;font-weight:700;color:#475569;margin-bottom:3px">UTR / Voucher Ref</label><input type="text" id="spBatUtr" value="' + esc(defUtr) + '" placeholder="UTR / Ref No." style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;font-size:12px;box-sizing:border-box"></div>';
    h += '        <div><label style="display:block;font-size:10.5px;font-weight:700;color:#475569;margin-bottom:3px">Batch Notes</label><input type="text" id="spBatNotes" value="' + esc(defNotes) + '" placeholder="e.g. 2-3 Leaders Lot / ₹150 remaining clear" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;font-size:12px;box-sizing:border-box"></div>';
    h += '      </div>';

    // Bank Sheet Upload inside Batch Modal
    h += '      <div style="padding:10px 12px;background:#eef2ff;border:1px dashed #818cf8;border-radius:10px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">';
    h += '        <div><div style="font-size:11.5px;font-weight:800;color:#312e81">Is Payment Part Ki Bank Sheet Upload Karein (.xlsx / .csv)</div><div style="font-size:11px;color:#475569">Emp Code / Bank A/C, Amount aur Remarks sheet se direct is batch me add ho jayenge.</div></div>';
    h += '        <input type="file" id="spBatExcelInput" accept=".xlsx,.xls,.csv" onchange="ATPLSalaryPayout.handleBatchBankSheetUpload(this)" style="font-size:11px;max-width:240px">';
    h += '      </div>';

    // Employee-wise allocation table inside batch modal
    h += '      <div style="border:1px solid #e2e8f0;border-radius:10px;overflow:hidden">';
    h += '        <div style="padding:8px 12px;background:#f8fafc;border-bottom:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">';
    h += '          <div style="font-size:11.5px;font-weight:700;color:#0f172a">Employee Diff Allocation (Amount + Remarks)</div>';
    h += '          <div style="display:flex;gap:6px;flex-wrap:wrap">';
    h += '            <button type="button" onclick="ATPLSalaryPayout.batchQuickSelect(\'ALL\')" style="padding:4px 9px;border:1px solid #cbd5e1;background:#fff;border-radius:6px;font-size:10.5px;font-weight:700;cursor:pointer">Fill All Remaining</button>';
    h += '            <button type="button" onclick="ATPLSalaryPayout.batchQuickSelect(\'LEFTOVER\')" style="padding:4px 9px;border:1px solid #fdba74;background:#fff7ed;color:#9a3412;border-radius:6px;font-size:10.5px;font-weight:700;cursor:pointer">Only Leftover ≤ ₹500</button>';
    h += '            <button type="button" onclick="ATPLSalaryPayout.batchQuickSelect(\'CLEAR\')" style="padding:4px 9px;border:1px solid #cbd5e1;background:#fff;color:#64748b;border-radius:6px;font-size:10.5px;font-weight:700;cursor:pointer">Clear All</button>';
    h += '          </div>';
    h += '        </div>';
    h += '        <div style="max-height:210px;overflow-y:auto">';
    if (candidateRows.length) {
      h += '          <table style="width:100%;border-collapse:collapse;font-size:11.5px">';
      h += '            <thead><tr style="background:#fff;border-bottom:1px solid #e2e8f0;color:#64748b;font-size:10px;text-align:left"><th style="padding:7px 10px">Pick</th><th style="padding:7px 10px">Emp Code</th><th style="padding:7px 10px">Name / Dept</th><th style="padding:7px 10px;text-align:right">Remaining</th><th style="padding:7px 10px;text-align:right">Pay Now (₹)</th><th style="padding:7px 10px">Remarks</th></tr></thead>';
      h += '            <tbody>';
      candidateRows.forEach(function(r) {
        var prevAlloc = existingAllocMap[r.normCode];
        var avail = round2(r.diffRemaining + (prevAlloc ? prevAlloc.amount : 0));
        var preChecked = !!(prevAlloc && prevAlloc.amount > 0) || (isLeftoverPreset && avail > 0 && avail <= 500);
        var preVal = (prevAlloc && prevAlloc.amount > 0) ? prevAlloc.amount : (preChecked ? avail : '');
        var preRem = (prevAlloc && prevAlloc.remarks) ? prevAlloc.remarks : '';
        h += '              <tr class="sp-bat-row" data-code="' + esc(r.empCode) + '" data-name="' + esc(r.empName) + '" data-avail="' + avail + '" style="border-bottom:1px solid #f1f5f9">';
        h += '                <td style="padding:6px 10px"><input type="checkbox" class="sp-bat-chk"' + (preChecked ? ' checked' : '') + ' onchange="ATPLSalaryPayout.onBatchRowToggle(this)"></td>';
        h += '                <td style="padding:6px 10px;font-family:monospace;font-weight:700;color:#312e81">' + esc(r.empCode) + '</td>';
        h += '                <td style="padding:6px 10px">' + esc(r.empName) + (r.dept ? (' <span style="color:#64748b;font-size:10.5px">· ' + esc(r.dept) + '</span>') : '') + '</td>';
        h += '                <td style="padding:6px 10px;text-align:right;font-variant-numeric:tabular-nums;color:' + (avail <= 500 ? '#c2410c' : '#334155') + ';font-weight:700">' + formatINR(avail) + '</td>';
        h += '                <td style="padding:6px 10px;text-align:right"><input type="number" class="sp-bat-amt" min="0" step="1" value="' + esc(preVal) + '" oninput="ATPLSalaryPayout.recalcBatchModalTotal()" style="width:95px;padding:4px 7px;border:1px solid #cbd5e1;border-radius:6px;text-align:right;font-variant-numeric:tabular-nums;font-weight:700"></td>';
        h += '                <td style="padding:6px 10px"><input type="text" class="sp-bat-rem" value="' + esc(preRem) + '" placeholder="Remark" style="width:120px;padding:4px 7px;border:1px solid #cbd5e1;border-radius:6px;font-size:11px"></td>';
        h += '              </tr>';
      });
      h += '            </tbody></table>';
    }
    h += '        </div>';

    // Manual / Sheet Extra Rows List + Quick Add Emp
    h += '        <div id="spBatExtraTableWrap"></div>';
    h += '        <div style="padding:9px 12px;background:#f8fafc;border-top:1px solid #e2e8f0;display:flex;gap:8px;align-items:center;flex-wrap:wrap">';
    h += '          <span style="font-size:11px;font-weight:700;color:#475569">Manual Add Emp:</span>';
    h += '          <input type="text" id="spBatQuickCode" placeholder="Emp Code" oninput="ATPLSalaryPayout.recalcBatchModalTotal()" style="width:95px;padding:6px 8px;border:1px solid #cbd5e1;border-radius:6px;font-size:11.5px;font-weight:700">';
    h += '          <input type="number" id="spBatQuickAmt" placeholder="Amount ₹" oninput="ATPLSalaryPayout.recalcBatchModalTotal()" style="width:105px;padding:6px 8px;border:1px solid #cbd5e1;border-radius:6px;font-size:11.5px;font-weight:700">';
    h += '          <input type="text" id="spBatQuickRem" placeholder="Remarks (Optional)" style="flex:1;min-width:130px;padding:6px 8px;border:1px solid #cbd5e1;border-radius:6px;font-size:11.5px">';
    h += '          <button type="button" onclick="ATPLSalaryPayout.addManualRowToBatchModal()" style="padding:6px 12px;border:1px solid #cbd5e1;background:#fff;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer">+ Add Row</button>';
    h += '        </div>';
    h += '      </div>';

    h += '    </div>';
    h += '    <div style="padding:12px 20px;border-top:1px solid #e2e8f0;background:#f8fafc;display:flex;justify-content:space-between;align-items:center;gap:10px">';
    h += '      <div id="spBatModalTotal" style="font-size:13px;font-weight:800;color:#0f172a;font-variant-numeric:tabular-nums">Batch Total: ₹0</div>';
    h += '      <div style="display:flex;gap:8px">';
    h += '        <button type="button" onclick="ATPLSalaryPayout.closeModal()" style="padding:8px 14px;border:1px solid #cbd5e1;background:#fff;color:#475569;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer">Cancel</button>';
    h += '        <button type="button" onclick="ATPLSalaryPayout.submitBatchModal()" style="padding:8px 18px;border:none;background:#1e293b;color:#fff;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer">Save &amp; Sync Batch</button>';
    h += '      </div>';
    h += '    </div>';
    h += '  </div>';
    h += '</div>';
    modal.innerHTML = h;
    renderBatchExtraRowsTable();
    recalcBatchModalTotal();
  }

  function renderBatchExtraRowsTable() {
    var wrap = document.getElementById('spBatExtraTableWrap');
    if (!wrap) return;
    var extras = state._batchExtraRows || [];
    if (!extras.length) {
      wrap.innerHTML = '';
      return;
    }
    var h = '<div style="border-top:1px solid #e2e8f0;max-height:170px;overflow-y:auto"><table style="width:100%;border-collapse:collapse;font-size:11.5px;background:#fefce8">';
    h += '<thead><tr style="border-bottom:1px solid #fde68a;color:#854d0e;font-size:10px;text-align:left"><th style="padding:6px 10px">Emp Code</th><th style="padding:6px 10px">Name</th><th style="padding:6px 10px;text-align:right">Amount (₹)</th><th style="padding:6px 10px">Remarks</th><th style="padding:6px 10px;text-align:center">Remove</th></tr></thead><tbody>';
    extras.forEach(function(ex, idx) {
      h += '<tr style="border-bottom:1px solid #fef08a">';
      h += '<td style="padding:5px 10px;font-family:monospace;font-weight:700;color:#312e81">' + esc(ex.empCode) + '</td>';
      h += '<td style="padding:5px 10px">' + esc(ex.empName) + '</td>';
      h += '<td style="padding:5px 10px;text-align:right;font-variant-numeric:tabular-nums;font-weight:700">' + formatINR(ex.amount) + '</td>';
      h += '<td style="padding:5px 10px;color:#475569">' + esc(ex.remarks || '—') + '</td>';
      h += '<td style="padding:5px 10px;text-align:center"><button type="button" onclick="ATPLSalaryPayout.removeExtraBatchRow(' + idx + ')" style="border:none;background:transparent;color:#dc2626;font-weight:800;cursor:pointer">✕</button></td>';
      h += '</tr>';
    });
    h += '</tbody></table></div>';
    wrap.innerHTML = h;
  }

  function removeExtraBatchRow(idx) {
    if (!Array.isArray(state._batchExtraRows)) return;
    state._batchExtraRows.splice(idx, 1);
    renderBatchExtraRowsTable();
    recalcBatchModalTotal();
  }

  function handleBatchBankSheetUpload(input) {
    var file = input && input.files && input.files[0];
    if (!file) return;
    readWorkbookFromFileInput(file, function(err, wbObj) {
      if (err || !wbObj) {
        if (window.showToast) window.showToast('⚠️ Bank sheet read failed.');
        return;
      }
      var parsed = extractSalaryRowsFromWorkbook(wbObj, 'BATCH');
      if (!parsed.length) {
        if (window.showToast) window.showToast('⚠️ Sheet me Emp Code/Account aur Amount column nahi mila.');
        return;
      }
      var matchedInTable = 0;
      var tableRows = {};
      document.querySelectorAll('.sp-bat-row').forEach(function(tr) {
        tableRows[normalizeCode(tr.getAttribute('data-code'))] = tr;
      });
      state._batchExtraRows = state._batchExtraRows || [];
      parsed.forEach(function(item) {
        var nc = normalizeCode(item.empCode);
        var tr = tableRows[nc];
        if (tr) {
          var chk = tr.querySelector('.sp-bat-chk');
          var amtInp = tr.querySelector('.sp-bat-amt');
          var remInp = tr.querySelector('.sp-bat-rem');
          if (chk) chk.checked = true;
          if (amtInp) amtInp.value = item.amount;
          if (remInp && item.remarks) remInp.value = item.remarks;
          matchedInTable++;
        } else {
          var em = findEmployeeByCode(item.empCode);
          state._batchExtraRows.push({
            empCode: item.empCode,
            empName: item.empName || (em && em.name) || ('Employee ' + item.empCode),
            amount: item.amount,
            remarks: item.remarks || ('Sheet: ' + file.name),
            accountNo: item.accountNo || (em && em.accountNo) || '',
            ifsc: item.ifsc || (em && em.ifsc) || ''
          });
        }
      });
      renderBatchExtraRowsTable();
      recalcBatchModalTotal();
      if (window.showToast) window.showToast('✅ ' + parsed.length + ' rows Bank Sheet se batch me load ho gayi!');
    });
  }

  function onBatchRowToggle(chk) {
    if (!chk) return;
    var tr = chk.closest('tr');
    if (!tr) return;
    var amtInp = tr.querySelector('.sp-bat-amt');
    var avail = Number(tr.getAttribute('data-avail')) || 0;
    if (amtInp) amtInp.value = chk.checked ? avail : '';
    recalcBatchModalTotal();
  }

  function batchQuickSelect(mode) {
    var rows = document.querySelectorAll('.sp-bat-row');
    rows.forEach(function(tr) {
      var chk = tr.querySelector('.sp-bat-chk');
      var inp = tr.querySelector('.sp-bat-amt');
      var avail = Number(tr.getAttribute('data-avail')) || 0;
      var checkIt = mode === 'ALL' || (mode === 'LEFTOVER' && avail > 0 && avail <= 500);
      if (chk) chk.checked = checkIt;
      if (inp) inp.value = checkIt ? avail : '';
    });
    recalcBatchModalTotal();
  }

  function addManualRowToBatchModal() {
    var cEl = document.getElementById('spBatQuickCode');
    var aEl = document.getElementById('spBatQuickAmt');
    var rEl = document.getElementById('spBatQuickRem');
    var code = String((cEl && cEl.value) || '').trim();
    var amt = round2(Number((aEl && aEl.value) || 0));
    var rem = String((rEl && rEl.value) || '').trim();
    if (!code || amt <= 0) return;
    var em = findEmployeeByCode(code);
    state._batchExtraRows = state._batchExtraRows || [];
    state._batchExtraRows.push({
      empCode: code,
      empName: em ? em.name : ('Employee ' + code),
      amount: amt,
      remarks: rem,
      accountNo: em ? em.accountNo : '',
      ifsc: em ? em.ifsc : ''
    });
    if (cEl) cEl.value = '';
    if (aEl) aEl.value = '';
    if (rEl) rEl.value = '';
    renderBatchExtraRowsTable();
    recalcBatchModalTotal();
  }

  function recalcBatchModalTotal() {
    var total = 0;
    var count = 0;
    document.querySelectorAll('.sp-bat-row').forEach(function(tr) {
      var chk = tr.querySelector('.sp-bat-chk');
      var inp = tr.querySelector('.sp-bat-amt');
      var val = round2(Number((inp && inp.value) || 0));
      if (val > 0 && chk && !chk.checked) chk.checked = true;
      if (chk && chk.checked && val > 0) {
        total = round2(total + val);
        count++;
      }
    });
    (state._batchExtraRows || []).forEach(function(r) {
      total = round2(total + (Number(r.amount) || 0));
      count++;
    });
    // Also include pending typed Quick Add row if user typed both code & amount
    var qCode = String((document.getElementById('spBatQuickCode') || {}).value || '').trim();
    var qAmt = round2(Number((document.getElementById('spBatQuickAmt') || {}).value || 0));
    if (qCode && qAmt > 0) {
      total = round2(total + qAmt);
      count++;
    }
    var lump = round2(Number((document.getElementById('spBatLump') || {}).value || 0));
    var el = document.getElementById('spBatModalTotal');
    if (el) {
      var eff = lump > 0 ? lump : total;
      el.textContent = 'Batch Total: ' + formatINR(eff) + ' (' + count + ' employees selected)';
    }
  }

  function submitBatchModal() {
    // Auto-flush Quick Add inputs if user typed them directly without clicking "+ Add Row"
    var qCode = String((document.getElementById('spBatQuickCode') || {}).value || '').trim();
    var qAmt = round2(Number((document.getElementById('spBatQuickAmt') || {}).value || 0));
    if (qCode && qAmt > 0) {
      addManualRowToBatchModal();
    }

    var allocs = [];
    document.querySelectorAll('.sp-bat-row').forEach(function(tr) {
      var chk = tr.querySelector('.sp-bat-chk');
      var inp = tr.querySelector('.sp-bat-amt');
      var remInp = tr.querySelector('.sp-bat-rem');
      var val = round2(Number((inp && inp.value) || 0));
      if (chk && chk.checked && val > 0) {
        allocs.push({
          empCode: tr.getAttribute('data-code'),
          empName: tr.getAttribute('data-name'),
          amount: val,
          remarks: remInp ? String(remInp.value || '').trim() : ''
        });
      }
    });
    (state._batchExtraRows || []).forEach(function(r) { allocs.push(r); });
    var res = addOrUpdateDiffBatch({
      id: state.editingBatchId || undefined,
      monthKey: state.selectedMonth,
      partNumber: Number((document.getElementById('spBatPart') || {}).value) || 1,
      title: (document.getElementById('spBatTitle') || {}).value,
      lotType: (document.getElementById('spBatLot') || {}).value,
      paymentDate: (document.getElementById('spBatDate') || {}).value,
      mode: (document.getElementById('spBatMode') || {}).value,
      signedBy: (document.getElementById('spBatSigned') || {}).value,
      status: (document.getElementById('spBatStatus') || {}).value,
      lumpSumAmount: (document.getElementById('spBatLump') || {}).value,
      utr: (document.getElementById('spBatUtr') || {}).value,
      notes: (document.getElementById('spBatNotes') || {}).value,
      allocations: allocs
    });
    if (!res.ok) {
      if (window.showToast) window.showToast('⚠️ Kam se kam ek employee add/select karein ya Lump-Sum Amount daalein.');
      return;
    }
    state._batchExtraRows = [];
    closeModal();
    if (window.showToast) window.showToast('✅ Diff Payout Batch save & sabhi browsers me sync ho gaya!');
  }

  function getActivePreviewWorkbook() {
    if (state._pendingDirectWorkbook) return state._pendingDirectWorkbook;
    var sel = document.getElementById('spImportFileSel');
    if (!sel || !sel.value) return null;
    var files = getLoadedSalaryWorkbooks();
    return files.find(function(f) { return f && f.name === sel.value; }) || null;
  }

  function getSelectedTabNamesFromModal() {
    var chks = document.querySelectorAll('.sp-tab-chk');
    if (!chks || !chks.length) return null;
    var picked = [];
    chks.forEach(function(chk) {
      if (chk && chk.checked && chk.value) picked.push(chk.value);
    });
    return picked;
  }

  function renderImportPreviewBox(wbObj, kind, explicitTabs) {
    var box = document.getElementById('spImportPreviewBox');
    if (!box) return;
    if (!wbObj) { box.innerHTML = ''; return; }
    var meta = extractSalaryRowsWithMeta(wbObj, kind, explicitTabs);
    var allTabs = meta.allTabs || [];
    if (!allTabs.length) {
      box.innerHTML = '<div style="margin-top:8px;padding:8px 10px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;font-size:11.5px;color:#b91c1c">⚠️ Is sheet me Emp Code / Net Payment / Manual / Diff columns detect nahi huye.</div>';
      return;
    }
    var cols = meta.primaryColumns || {};
    var t = meta.totals || {};
    var h = '<div style="margin-top:8px;padding:10px 12px;background:#f0fdf4;border:1px solid #86efac;border-radius:8px;font-size:11.5px;color:#0f172a">';
    h += '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;margin-bottom:6px">';
    h += '<div style="font-weight:800;color:#15803d">✓ Smart Human Reader Preview (' + esc(wbObj.name) + ')</div>';
    if (cols.complianceCol || cols.manualCol || cols.pfCol || cols.esicCol || cols.diffCol) {
      h += '<div style="font-size:10.5px;color:#475569">' + (cols.complianceCol ? ('Comp=' + esc(cols.complianceCol) + ' ') : '') + (cols.manualCol ? ('· Manual=' + esc(cols.manualCol) + ' ') : '') + (cols.pfCol ? ('· PF=' + esc(cols.pfCol) + ' ') : '') + (cols.esicCol ? ('· ESIC=' + esc(cols.esicCol) + ' ') : '') + (cols.diffCol ? ('· Diff=' + esc(cols.diffCol)) : '') + '</div>';
    }
    h += '</div>';

    // Tab Picker Checkboxes so user has 100% control if Excel has multiple tabs
    var looksLikeDiffSheet = allTabs.some(function(tb) { return tb.isDiffBankSheet; }) || (/\bdiff(erence)?\b/i.test(String(wbObj.name || '')) && allTabs.every(function(tb) { return !tb.hasExplicitComp; }));
    if (kind === 'COMPLIANCE' && looksLikeDiffSheet) {
      h += '<div style="margin-bottom:6px;padding:6px 9px;background:#fef3c7;border:1px solid #fcd34d;border-radius:6px;font-size:11px;font-weight:700;color:#92400e">⚠️ Yeh Diff Bank Sheet lag rahi hai (is me Net Payable column nahi hai). Agar yeh Diff sheet hai toh upar Sheet Type me "Diff Salary Sheet" select karein.</div>';
    }
        h += '<div style="margin-bottom:8px;display:flex;flex-direction:column;gap:4px;max-height:140px;overflow-y:auto;background:#fff;border:1px solid #dcfce7;border-radius:7px;padding:6px 8px">';
    allTabs.forEach(function(tab) {
      var isChecked = explicitTabs ? (explicitTabs.indexOf(tab.sheetName) >= 0) : !!tab.recommended;
      var valDisp = kind === 'DIFF' ? formatINR(tab.totals.diffTotal) : formatINR(tab.totals.complianceTotal);
      h += '<label style="display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:11px;cursor:pointer;padding:2px 0">';
      h += '<span><input type="checkbox" class="sp-tab-chk" value="' + esc(tab.sheetName) + '"' + (isChecked ? ' checked' : '') + ' onchange="ATPLSalaryPayout.onTabSelectionChange()" style="margin-right:6px"><strong>' + esc(tab.sheetName) + '</strong> <span style="color:#64748b">(' + tab.totals.empCount + ' emp' + (tab.overlapPct > 0 && !tab.recommended ? (' · ' + tab.overlapPct + '% duplicate tab') : (tab.recommended ? ' · Recommended' : '')) + ')</span></span>';
      h += '<span style="font-weight:700;font-variant-numeric:tabular-nums;color:' + (isChecked ? '#15803d' : '#64748b') + '">' + valDisp + '</span>';
      h += '</label>';
    });
    h += '</div>';

    h += '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">';
    h += '<div style="display:flex;gap:10px;flex-wrap:wrap;font-weight:800;font-variant-numeric:tabular-nums">';
    h += '<span>Emp: ' + t.empCount + '</span>';
    h += '<span style="color:#15803d">Net Pay (Compliance): ' + formatINR(t.complianceTotal) + '</span>';
    h += '<span>Manual: ' + formatINR(t.manualTotal) + '</span>';
    h += '<span>PF: ' + formatINR(t.pfTotal) + '</span>';
    h += '<span>ESIC: ' + formatINR(t.esicTotal) + '</span>';
    if (t.diffTotal > 0) h += '<span style="color:#1d4ed8">Diff: ' + formatINR(t.diffTotal) + '</span>';
    h += '</div>';
    h += '<button type="button" onclick="ATPLSalaryPayout.confirmPreviewImport()" style="padding:7px 14px;border:none;background:#15803d;color:#fff;border-radius:7px;font-size:12px;font-weight:800;cursor:pointer">Confirm &amp; Import (' + t.empCount + ' Emp)</button>';
    h += '</div></div>';
    box.innerHTML = h;
  }

  function onTabSelectionChange() {
    var wbObj = getActivePreviewWorkbook();
    var kind = String((document.getElementById('spImportKindSel') || {}).value || 'BOTH').toUpperCase();
    var repChk = document.getElementById('spImportReplaceChk');
    if (repChk && !state._userTouchedReplaceChk) {
      repChk.checked = (kind !== 'DIFF');
    }
    var picked = getSelectedTabNamesFromModal();
    renderImportPreviewBox(wbObj, kind, picked || []);
  }

  function previewSelectedFileImport() {
    state._pendingDirectWorkbook = null;
    var wbObj = getActivePreviewWorkbook();
    var kind = String((document.getElementById('spImportKindSel') || {}).value || 'BOTH').toUpperCase();
    renderImportPreviewBox(wbObj, kind, null);
  }

  function confirmPreviewImport() {
    var wbObj = getActivePreviewWorkbook();
    if (!wbObj) {
      if (window.showToast) window.showToast('⚠️ Pehle koi file select ya upload karein.');
      return { ok: false, imported: 0 };
    }
    var mk = String((document.getElementById('spImportMonthInp') || {}).value || state.selectedMonth).trim();
    var kind = String((document.getElementById('spImportKindSel') || {}).value || 'BOTH').toUpperCase();
    if ((kind === 'COMPLIANCE' || kind === 'BOTH') && isComplianceLockedForMonth(mk)) {
      if (window.showToast) window.showToast('🔒 Compliance processed & locked hai — pehle Unlock ya Delete karein, ya sirf Bank Return record karein!');
      return { ok: false, imported: 0, locked: true };
    }
    var rep = document.getElementById('spImportReplaceChk') ? !!document.getElementById('spImportReplaceChk').checked : (kind !== 'DIFF');
    var picked = getSelectedTabNamesFromModal();
    var meta = extractSalaryRowsWithMeta(wbObj, kind, picked);
    if (!meta.rows.length) {
      if (window.showToast) window.showToast('⚠️ Kam se kam ek valid tab select karein.');
      return { ok: false, imported: 0 };
    }
    state.selectedMonth = mk;
    var res = bulkImportMonthSalaries(mk, meta.rows, wbObj.name, kind, { replaceExisting: rep, selectedTabs: meta.selectedSheets });
    state._pendingDirectWorkbook = null;
    closeModal();
    if (window.showToast) {
      window.showToast('✅ ' + res.imported + ' employees (' + formatMonthLabel(mk) + ') imported · Net Pay ' + formatINR(meta.totals.complianceTotal) + ' · PF ' + formatINR(meta.totals.pfTotal) + ' · ESIC ' + formatINR(meta.totals.esicTotal));
    }
    return res;
  }

  function openImportAndTargetsModal(defaultKind) {
    var modal = getOrCreateModal();
    if (!modal) return;
    var loadedFiles = getLoadedSalaryWorkbooks();
    var summary = getMonthSummary(state.selectedMonth);
    var kind = String(defaultKind || 'COMPLIANCE').toUpperCase();
    var compLocked = isComplianceLockedForMonth(state.selectedMonth);
    state._pendingDirectWorkbook = null;
    state._userTouchedReplaceChk = false;

    var h = '<div onclick="if(event.target===this)ATPLSalaryPayout.closeModal()" style="position:fixed;inset:0;background:rgba(15,23,42,0.55);backdrop-filter:blur(2px);z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px">';
    h += '  <div style="background:#fff;width:100%;max-width:720px;max-height:92vh;overflow-y:auto;border-radius:14px;border:1px solid #e2e8f0;box-shadow:0 24px 60px rgba(15,23,42,0.22)">';
    h += '    <div style="padding:15px 20px;border-bottom:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center">';
    h += '      <div><div style="font-size:11px;font-weight:700;color:#4f46e5">' + esc(formatMonthLabel(state.selectedMonth)) + ' · Smart Excel Import &amp; Manual Entry</div><h3 style="margin:2px 0 0;font-size:16px;font-weight:800;color:#0f172a">Upload Compliance / Diff Sheets (Net Pay, PF, ESIC, Manual)</h3></div>';
    h += '      <button type="button" onclick="ATPLSalaryPayout.closeModal()" style="border:1px solid #e2e8f0;background:#f8fafc;color:#64748b;width:30px;height:30px;border-radius:8px;cursor:pointer;font-size:14px">✕</button>';
    h += '    </div>';
    h += '    <div style="padding:16px 20px;display:flex;flex-direction:column;gap:14px">';

    // 1. Two Sheet Uploads (Compliance Net Payment OR Diff Sheet OR Combined)
    h += '      <div style="padding:12px;border:1px solid #e2e8f0;border-radius:10px;background:#f8fafc">';
    h += '        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:8px">';
    h += '          <div style="font-size:12px;font-weight:800;color:#0f172a">1. Salary / Bank Payment Sheet Upload Karein (.xlsx / .csv)</div>';
    h += '          <div style="display:flex;align-items:center;gap:6px"><label style="font-size:11px;font-weight:700;color:#475569">Target Month:</label><input type="month" id="spImportMonthInp" value="' + esc(state.selectedMonth) + '" style="padding:4px 8px;border:1px solid #cbd5e1;border-radius:6px;font-size:11.5px;font-weight:700;background:#fff"></div>';
    h += '        </div>';
    h += '        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:8px">';
    h += '          <div><label style="font-size:11px;font-weight:700;color:#475569;margin-right:8px">Sheet Type:</label>';
    h += '            <select id="spImportKindSel" onchange="ATPLSalaryPayout.onTabSelectionChange()" style="padding:6px 10px;border:1px solid #cbd5e1;border-radius:7px;font-size:12px;font-weight:700;background:#fff">';
    h += '              <option value="COMPLIANCE"' + (kind === 'COMPLIANCE' ? ' selected' : '') + '>Compliance Salary Sheet (Net Payment + PF + ESIC + Manual)</option>';
    h += '              <option value="DIFF"' + (kind === 'DIFF' ? ' selected' : '') + '>Diff Salary Sheet</option>';
    h += '              <option value="BOTH"' + (kind === 'BOTH' ? ' selected' : '') + '>Combined Salary Sheet (Compliance + Diff + PF + ESIC Dono)</option>';
    h += '            </select>';
    h += '          </div>';
    h += '          <label style="font-size:11px;font-weight:700;color:#334155;display:flex;align-items:center;gap:5px;cursor:pointer"><input type="checkbox" id="spImportReplaceChk" onchange="ATPLSalaryPayout._markReplaceTouched()"' + (kind !== 'DIFF' ? ' checked' : '') + '> Purani ' + (kind === 'DIFF' ? 'Diff sheets replace karein (Untick = Sheet 1 + Sheet 2 Add hoga!)' : 'sheet replace karein (Exact total match)') + '</label>';
    h += '        </div>';
    if (compLocked && kind === 'COMPLIANCE') {
      h += '        <div style="margin-bottom:8px;padding:8px 10px;background:#fefce8;border:1px solid #fde047;border-radius:8px;font-size:11px;font-weight:700;color:#854d0e">🔒 Is mahine ki Compliance Sheet pehle se processed &amp; locked hai (sirf Bank Return allowed). Nayi sheet upload karne ke liye pehle Dashboard par Compliance card se Unlock ya Delete karein.</div>';
    }
    if (loadedFiles.length) {
      h += '        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:6px">';
      h += '          <input type="text" id="spImportFileSearch" value="" oninput="ATPLSalaryPayout.filterImportFileSelect(this.value)" placeholder="Search saved file (e.g. Oct, Diff, Compilance, 2026)..." style="flex:1;min-width:220px;padding:7px 10px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;font-size:12px;box-sizing:border-box">';
      h += '          <span id="spImportFileCount" style="font-size:11px;font-weight:700;color:#64748b;white-space:nowrap">' + loadedFiles.length + ' / ' + loadedFiles.length + ' files</span>';
      h += '        </div>';
      h += '        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">';
      h += '          <select id="spImportFileSel" onchange="ATPLSalaryPayout.previewSelectedFileImport()" style="flex:1;min-width:200px;padding:8px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;font-size:12px">';
      loadedFiles.forEach(function(f) { h += '<option value="' + esc(f.name) + '">' + esc(f.name) + '</option>'; });
      h += '          </select>';
      h += '          <button type="button" onclick="ATPLSalaryPayout.runFileImport()" style="padding:8px 14px;border:none;background:#1e293b;color:#fff;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer">Import Selected</button>';
      h += '        </div>';
    }
    h += '        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;padding-top:6px;border-top:1px dashed #cbd5e1">';
    h += '          <span style="font-size:11.5px;font-weight:700;color:#334155">Ya seedha computer se Excel / Bank Sheet upload karein:</span>';
    h += '          <input type="file" id="spDirectExcelInput" accept=".xlsx,.xls,.csv" onchange="ATPLSalaryPayout.handleDirectExcelUpload(this)" style="font-size:11.5px">';
    h += '        </div>';
    h += '        <div id="spImportPreviewBox"></div>';
    h += '      </div>';

    // 2. Manual Compliance Net Payable & Manual Diff Sheet Add (Adds cleanly + Deletable!)
    h += '      <div style="padding:12px;border:1px solid #e2e8f0;border-radius:10px">';
    h += '        <div style="font-size:12px;font-weight:800;color:#0f172a;margin-bottom:8px">2. Manual Compliance Net Payable ya Manual Diff Entry Add Karein</div>';
    h += '        <div style="display:grid;grid-template-columns:130px 1fr 1fr 1.1fr auto;gap:8px;align-items:center">';
    h += '          <select id="spManSheetKind" style="padding:8px;border:1px solid #cbd5e1;border-radius:8px;font-size:12px;font-weight:700;background:#fff"><option value="COMPLIANCE"' + (kind === 'COMPLIANCE' ? ' selected' : '') + '>Compliance (Net)</option><option value="DIFF"' + (kind === 'DIFF' ? ' selected' : '') + '>Diff (+ Add)</option></select>';
    h += '          <input type="text" id="spManSheetTitle" placeholder="Sheet / Entry Name" style="padding:8px;border:1px solid #cbd5e1;border-radius:8px;font-size:12px">';
    h += '          <input type="number" id="spManSheetAmt" min="1" placeholder="Amount (₹)" style="padding:8px;border:1px solid #cbd5e1;border-radius:8px;font-size:12px;font-weight:700">';
    h += '          <input type="text" id="spManSheetRem" placeholder="Remarks" style="padding:8px;border:1px solid #cbd5e1;border-radius:8px;font-size:12px">';
    h += '          <button type="button" onclick="ATPLSalaryPayout.submitManualSheetEntry()" style="padding:8px 13px;border:none;background:#0f766e;color:#fff;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap">+ Add &amp; Sync</button>';
    h += '        </div>';
    h += '        <div style="margin-top:10px;padding-top:10px;border-top:1px dashed #e2e8f0;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">';
    h += '          <button type="button" onclick="ATPLSalaryPayout.clearCurrentMonthAllData()" style="padding:6px 12px;border:1px solid #fecaca;background:#fef2f2;color:#dc2626;border-radius:8px;font-size:11.5px;font-weight:700;cursor:pointer">Clear This Month Data</button>';
    h += '          <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">';
    h += '            <input type="number" id="spTgtComp" min="0" value="' + esc(summary.complianceTarget || '') + '" placeholder="Comp Override ₹" style="width:125px;padding:6px 8px;border:1px solid #cbd5e1;border-radius:7px;font-size:11.5px">';
    h += '            <input type="number" id="spTgtDiff" min="0" value="' + esc(summary.diffTarget || '') + '" placeholder="Diff Override ₹" style="width:125px;padding:6px 8px;border:1px solid #cbd5e1;border-radius:7px;font-size:11.5px">';
    h += '            <button type="button" onclick="ATPLSalaryPayout.submitTargetsOnly()" style="padding:6px 10px;border:1px solid #cbd5e1;background:#fff;color:#0f172a;border-radius:7px;font-size:11.5px;font-weight:700;cursor:pointer">Save Override</button>';
    h += '            <button type="button" onclick="ATPLSalaryPayout.resetMonthTargets()" style="padding:6px 10px;border:1px solid #cbd5e1;background:#fff;color:#64748b;border-radius:7px;font-size:11.5px;font-weight:700;cursor:pointer">Reset 0</button>';
    h += '          </div>';
    h += '        </div>';
    h += '      </div>';

    // 3. Quick Manual Single Emp Row
    h += '      <div style="padding:12px;border:1px solid #e2e8f0;border-radius:10px">';
    h += '        <div style="font-size:12px;font-weight:800;color:#0f172a;margin-bottom:8px">3. Manual Employee Compliance / Diff / Chhoota Diff Add Karein</div>';
    h += '        <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1.2fr;gap:8px">';
    h += '          <input type="text" id="spOneCode" placeholder="Emp Code" style="padding:8px;border:1px solid #cbd5e1;border-radius:8px;font-size:12px;font-weight:700">';
    h += '          <input type="number" id="spOneComp" placeholder="Compliance ₹" min="0" style="padding:8px;border:1px solid #cbd5e1;border-radius:8px;font-size:12px">';
    h += '          <input type="number" id="spOneDiff" placeholder="Diff ₹" min="0" style="padding:8px;border:1px solid #cbd5e1;border-radius:8px;font-size:12px">';
    h += '          <input type="text" id="spOneRem" placeholder="Remarks" style="padding:8px;border:1px solid #cbd5e1;border-radius:8px;font-size:12px">';
    h += '        </div>';
    h += '        <div style="margin-top:8px;display:flex;justify-content:flex-end"><button type="button" onclick="ATPLSalaryPayout.submitSingleEmpSalary()" style="padding:7px 14px;border:1px solid #cbd5e1;background:#fff;color:#0f172a;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer">+ Save &amp; Sync Emp Row</button></div>';
    h += '      </div>';
    h += '    </div>';
    h += '  </div>';
    h += '</div>';
    modal.innerHTML = h;
    if (loadedFiles.length) previewSelectedFileImport();
  }

  function filterImportFileSelect(query) {
    var sel = document.getElementById('spImportFileSel');
    var cntEl = document.getElementById('spImportFileCount');
    var loadedFiles = getLoadedSalaryWorkbooks();
    var tokens = String(query || '').toLowerCase().trim().split(/\s+/).filter(Boolean);
    var matches = tokens.length
      ? loadedFiles.filter(function(f) {
          var nm = String((f && f.name) || '').toLowerCase();
          return tokens.every(function(tok) { return nm.indexOf(tok) >= 0; });
        })
      : loadedFiles;
    if (cntEl) cntEl.textContent = matches.length + ' / ' + loadedFiles.length + ' files';
    if (!sel) return matches.map(function(f) { return f.name; });
    var prevVal = String(sel.value || '');
    if (!matches.length) {
      sel.innerHTML = '<option value="">Koi matching file nahi mili</option>';
      sel.value = '';
      var box = document.getElementById('spImportPreviewBox');
      if (box) box.innerHTML = '';
      return [];
    }
    sel.innerHTML = matches.map(function(f) {
      return '<option value="' + esc(f.name) + '">' + esc(f.name) + '</option>';
    }).join('');
    var stillPresent = matches.some(function(f) { return f.name === prevVal; });
    sel.value = stillPresent ? prevVal : matches[0].name;
    previewSelectedFileImport();
    return matches.map(function(f) { return f.name; });
  }

  function runFileImport() {
    return confirmPreviewImport();
  }

  function handleDirectExcelUpload(input) {
    var file = input && input.files && input.files[0];
    var kind = String((document.getElementById('spImportKindSel') || {}).value || 'BOTH').toUpperCase();
    if (!file) return;
    readWorkbookFromFileInput(file, function(err, wbObj) {
      if (err || !wbObj) {
        if (window.showToast) window.showToast('⚠️ Excel read error.');
        return;
      }
      state._pendingDirectWorkbook = wbObj;
      renderImportPreviewBox(wbObj, kind, null);
      if (window.showToast) {
        window.showToast('✓ File loaded — niche Preview check karke "Confirm & Import" dabaye!');
      }
    });
  }

  function submitManualSheetEntry() {
    var kind = String((document.getElementById('spManSheetKind') || {}).value || 'DIFF').toUpperCase();
    var title = String((document.getElementById('spManSheetTitle') || {}).value || '').trim();
    var amt = Number((document.getElementById('spManSheetAmt') || {}).value) || 0;
    var rem = String((document.getElementById('spManSheetRem') || {}).value || '').trim();
    var mk = String((document.getElementById('spImportMonthInp') || {}).value || state.selectedMonth).trim();
    if (kind === 'COMPLIANCE' && isComplianceLockedForMonth(mk)) {
      if (window.showToast) window.showToast('🔒 Compliance locked hai — pehle Unlock ya Delete karein, ya sirf Bank Return record karein!');
      return;
    }
    if (amt <= 0) {
      if (window.showToast) window.showToast('⚠️ Valid amount (₹) daalein.');
      return;
    }
    saveManualSheetEntry({ monthKey: mk, kind: kind, title: title, amount: amt, remarks: rem });
    closeModal();
    if (window.showToast) window.showToast('✅ Manual ' + kind + ' amount (' + formatINR(amt) + ') save & sync ho gaya!');
  }

  function clearCurrentMonthAllData() {
    var mk = String((document.getElementById('spImportMonthInp') || {}).value || state.selectedMonth).trim();
    resetMonthData(mk);
    closeModal();
    if (window.showToast) window.showToast('🗑️ ' + formatMonthLabel(mk) + ' ka saara test/purana data clear & sync ho gaya!');
  }

  function resetMonthTargets() {
    saveMonthSummary({
      monthKey: state.selectedMonth,
      complianceTarget: 0,
      diffTarget: 0
    });
    closeModal();
    if (window.showToast) window.showToast('✅ Manual targets reset to 0 — Dashboard ab exact sheet sums dikha raha hai!');
  }

  function submitTargetsOnly() {
    saveMonthSummary({
      monthKey: state.selectedMonth,
      complianceTarget: Number((document.getElementById('spTgtComp') || {}).value) || 0,
      diffTarget: Number((document.getElementById('spTgtDiff') || {}).value) || 0
    });
    closeModal();
    if (window.showToast) window.showToast('✅ Month salary totals saved & synced!');
  }

  function submitSingleEmpSalary() {
    var code = String((document.getElementById('spOneCode') || {}).value || '').trim();
    var comp = Number((document.getElementById('spOneComp') || {}).value) || 0;
    var diff = Number((document.getElementById('spOneDiff') || {}).value) || 0;
    var rem = String((document.getElementById('spOneRem') || {}).value || '').trim();
    if (!code) return;
    upsertEmpSalary({
      monthKey: state.selectedMonth,
      empCode: code,
      complianceAmount: comp,
      baseDiffAmount: diff,
      remarks: rem
    });
    if (document.getElementById('spOneCode')) document.getElementById('spOneCode').value = '';
    if (document.getElementById('spOneComp')) document.getElementById('spOneComp').value = '';
    if (document.getElementById('spOneDiff')) document.getElementById('spOneDiff').value = '';
    if (document.getElementById('spOneRem')) document.getElementById('spOneRem').value = '';
    if (window.showToast) window.showToast('✅ Employee ' + code + ' salary saved & synced!');
  }

  function printBatch(batchId) {
    var b = state.diffBatches[batchId];
    if (!b) return;
    var allocs = Array.isArray(b.allocations) ? b.allocations : [];
    var total = getBatchPaidTotal(b);
    var rowsHtml = allocs.map(function(al, idx) {
      var em = findEmployeeByCode(al.empCode) || {};
      return '<tr><td style="padding:6px 8px;border:1px solid #cbd5e1">' + (idx + 1) + '</td><td style="padding:6px 8px;border:1px solid #cbd5e1;font-family:monospace">' + esc(al.empCode) + '</td><td style="padding:6px 8px;border:1px solid #cbd5e1">' + esc(al.empName) + '</td><td style="padding:6px 8px;border:1px solid #cbd5e1;font-family:monospace">' + esc(al.accountNo || em.accountNo || '-') + '</td><td style="padding:6px 8px;border:1px solid #cbd5e1;font-family:monospace">' + esc(al.ifsc || em.ifsc || '-') + '</td><td style="padding:6px 8px;border:1px solid #cbd5e1">' + esc(al.remarks || '-') + '</td><td style="padding:6px 8px;border:1px solid #cbd5e1;text-align:right;font-weight:700">' + formatINR(al.amount) + '</td></tr>';
    }).join('');
    try {
      var frame = document.getElementById('atplSalPayoutPrintFrame');
      if (!frame) {
        frame = document.createElement('iframe');
        frame.id = 'atplSalPayoutPrintFrame';
        frame.style.position = 'fixed';
        frame.style.width = '0';
        frame.style.height = '0';
        frame.style.border = '0';
        document.body.appendChild(frame);
      }
      var cw = frame.contentWindow;
      var doc = frame.contentDocument || (cw && cw.document);
      if (doc) {
        doc.open();
        doc.write('<!doctype html><html><head><title>' + esc(b.title) + '</title></head><body style="font-family:sans-serif;padding:20px;color:#0f172a"><h2 style="margin:0 0 4px">ARORA TEXTILES PRIVATE LIMITED — DIFF PAYOUT SHEET</h2><div style="font-size:12px;margin-bottom:12px">' + esc(formatMonthLabel(b.monthKey)) + ' · <strong>' + esc(b.title) + '</strong> · Date: ' + esc(b.paymentDate) + ' · Mode: ' + esc(b.mode) + (b.signedBy ? (' · Signed: ' + esc(b.signedBy)) : '') + (b.utr ? (' · Ref: ' + esc(b.utr)) : '') + '</div><table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr style="background:#f1f5f9"><th style="padding:7px 8px;border:1px solid #cbd5e1;text-align:left">#</th><th style="padding:7px 8px;border:1px solid #cbd5e1;text-align:left">Emp Code</th><th style="padding:7px 8px;border:1px solid #cbd5e1;text-align:left">Name</th><th style="padding:7px 8px;border:1px solid #cbd5e1;text-align:left">Account No</th><th style="padding:7px 8px;border:1px solid #cbd5e1;text-align:left">IFSC</th><th style="padding:7px 8px;border:1px solid #cbd5e1;text-align:left">Remarks</th><th style="padding:7px 8px;border:1px solid #cbd5e1;text-align:right">Amount (₹)</th></tr></thead><tbody>' + (rowsHtml || '<tr><td colspan="7" style="padding:12px;text-align:center;border:1px solid #cbd5e1">Lump-Sum Lot Payout</td></tr>') + '</tbody><tfoot><tr><td colspan="6" style="padding:8px;border:1px solid #cbd5e1;text-align:right;font-weight:800">TOTAL BATCH PAYOUT</td><td style="padding:8px;border:1px solid #cbd5e1;text-align:right;font-weight:800">' + formatINR(total) + '</td></tr></tfoot></table></body></html>');
        doc.close();
      }
      if (typeof setTimeout === 'function') setTimeout(function() { try { if (cw) { cw.focus(); cw.print(); } } catch (_) {} }, 180);
    } catch (_) {}
  }

  function promptReTransfer(returnId) {
    var r = state.returns[returnId];
    if (!r) return;
    openReturnModal(returnId, r.empCode);
    if (typeof setTimeout === 'function') {
      setTimeout(function() {
        var st = document.getElementById('spRetStatus');
        if (st) st.value = 'RETRANSFERRED';
        var utrEl = document.getElementById('spRetUtr');
        if (utrEl && utrEl.focus) utrEl.focus();
      }, 30);
    }
  }

  function promptComplianceComplete() {
    var ledger = computeMonthLedger(state.selectedMonth);
    var s = ledger.summary;
    var modal = getOrCreateModal();
    if (!modal) return;
    var h = '';
    h += '<div style="position:fixed;inset:0;background:rgba(15,23,42,0.5);z-index:10050;display:flex;align-items:center;justify-content:center;padding:16px" onclick="if(event.target===this)ATPLSalaryPayout.closeModal()">';
    h += '  <div style="background:#fff;border:1px solid #e2e8f0;border-radius:14px;max-width:440px;width:100%;box-shadow:0 24px 48px rgba(15,23,42,0.22);overflow:hidden">';
    h += '    <div style="padding:15px 18px;border-bottom:1px solid #e2e8f0"><h3 style="margin:0;font-size:15px;font-weight:800">1-Time Compliance Transfer Details</h3></div>';
    h += '    <div style="padding:15px 18px;display:flex;flex-direction:column;gap:10px">';
    h += '      <div><label style="display:block;font-size:11px;font-weight:700;margin-bottom:3px">Transfer Date</label><input type="date" id="spCompDate" value="' + esc(s.complianceDate || todayIso()) + '" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:8px;box-sizing:border-box"></div>';
    h += '      <div><label style="display:block;font-size:11px;font-weight:700;margin-bottom:3px">Bank Batch UTR / Reference</label><input type="text" id="spCompUtr" value="' + esc(s.complianceUtr || '') + '" placeholder="NEFT / Bank File Ref" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:8px;box-sizing:border-box"></div>';
    h += '      <label style="display:flex;align-items:center;gap:8px;font-size:12px;font-weight:700"><input type="checkbox" id="spCompDone" checked> Mark Compliance Salary Disbursed</label>';
    h += '    </div>';
    h += '    <div style="padding:12px 18px;border-top:1px solid #e2e8f0;background:#f8fafc;display:flex;justify-content:flex-end;gap:8px">';
    h += '      <button type="button" onclick="ATPLSalaryPayout.closeModal()" style="padding:7px 14px;border:1px solid #cbd5e1;background:#fff;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer">Cancel</button>';
    h += '      <button type="button" onclick="ATPLSalaryPayout.submitComplianceComplete()" style="padding:7px 16px;border:none;background:#15803d;color:#fff;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer">Save Status</button>';
    h += '    </div>';
    h += '  </div>';
    h += '</div>';
    modal.innerHTML = h;
  }

  function submitComplianceComplete() {
    saveMonthSummary({
      monthKey: state.selectedMonth,
      complianceDisbursed: !!(document.getElementById('spCompDone') && document.getElementById('spCompDone').checked),
      complianceDate: (document.getElementById('spCompDate') || {}).value,
      complianceUtr: (document.getElementById('spCompUtr') || {}).value
    });
    closeModal();
    if (window.showToast) window.showToast('✅ Compliance disbursement status updated!');
  }

  // ── MAIN DASHBOARD RENDERER ──
  function renderUI() {
    var container = document.getElementById('salaryPayoutContainer');
    if (!container) return;

    var ledger = computeMonthLedger(state.selectedMonth);
    var months = listAvailableMonths();
    var q = String(state.searchQuery || '').toLowerCase().trim();
    var lotLabelMap = {};
    LOT_TYPES.forEach(function(lt) { lotLabelMap[lt.key] = lt.label; });

    var h = '';
    h += '<div style="max-width:1360px;margin:0 auto;display:flex;flex-direction:column;gap:14px;font-family:\'Plus Jakarta Sans\',\'Manrope\',system-ui,sans-serif;color:#0f172a">';

    // Top Header Bar
    h += '  <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;padding:14px 18px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px">';
    h += '    <div>';
    h += '      <div style="font-size:11px;font-weight:600;color:#64748b">Arora Textiles Pvt. Ltd. · Salary Payout Control</div>';
    h += '      <h2 style="margin:2px 0 0;font-size:19px;font-weight:800;letter-spacing:-0.01em;color:#0f172a">Monthly Salary, Emp Points &amp; Multi-Part Diff Dashboard</h2>';
    h += '    </div>';
    h += '    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">';
    h += '      <input type="month" value="' + esc(state.selectedMonth) + '" onchange="ATPLSalaryPayout.setSelectedMonth(this.value)" style="height:34px;padding:0 10px;border:1px solid #cbd5e1;border-radius:8px;font-size:12px;font-weight:700;color:#0f172a;background:#fff">';
    if (months.length > 1) {
      h += '      <select onchange="ATPLSalaryPayout.setSelectedMonth(this.value)" style="height:34px;padding:0 10px;border:1px solid #cbd5e1;border-radius:8px;font-size:12px;font-weight:700;color:#334155;background:#fff">';
      months.forEach(function(mk) {
        h += '        <option value="' + esc(mk) + '"' + (mk === state.selectedMonth ? ' selected' : '') + '>' + esc(formatMonthLabel(mk)) + '</option>';
      });
      h += '      </select>';
    }
    h += '      <button type="button" onclick="ATPLSalaryPayout.openImportAndTargetsModal(\'COMPLIANCE\')" style="height:34px;padding:0 12px;border:1px solid #86efac;background:#f0fdf4;color:#15803d;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap">Upload Compliance Sheet</button>';
    h += '      <button type="button" onclick="ATPLSalaryPayout.openImportAndTargetsModal(\'DIFF\')" style="height:34px;padding:0 12px;border:1px solid #cbd5e1;background:#fff;color:#0f172a;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap">Upload Diff Sheet / Targets</button>';
    h += '      <button type="button" onclick="ATPLSalaryPayout.openEmpSalaryModal(null,\'MISSED_DIFF\')" style="height:34px;padding:0 12px;border:1px solid #fdba74;background:#fff7ed;color:#9a3412;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap">+ Missed Diff</button>';
    h += '      <button type="button" onclick="ATPLSalaryPayout.openPointModal()" style="height:34px;padding:0 12px;border:1px solid #c7d2fe;background:#eef2ff;color:#312e81;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap">+ Emp Point (+/-)</button>';
    h += '      <button type="button" onclick="ATPLSalaryPayout.openBatchModal()" style="height:34px;padding:0 14px;border:none;background:#0f172a;color:#fff;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap">+ Diff Batch (Part ' + (ledger.batches.length + 1) + ')</button>';
    h += '      <button type="button" onclick="ATPLSalaryPayout.syncNow(true)" style="height:34px;padding:0 11px;border:1px solid #cbd5e1;background:#f8fafc;color:#334155;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap">Sync</button>';
    h += '    </div>';
    h += '  </div>';

    // KPI Strip — Clear Compliance Net Payable -> Diff Total Target -> Diff Paid Lots -> Diff Baaki -> Month Grand Total
    h += '  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(215px,1fr));gap:10px">';
    h += '    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:12px 14px">';
    h += '      <div style="font-size:11px;font-weight:700;color:#64748b">Compliance Me Di (Net Pay)</div>';
    h += '      <div style="font-size:21px;font-weight:800;color:#15803d;margin-top:4px;font-variant-numeric:tabular-nums">' + formatINR(ledger.complianceTotal) + '</div>';
    h += '      <div style="font-size:11px;color:' + (ledger.pendingReturnCount > 0 ? '#b45309' : '#475569') + ';margin-top:3px;font-weight:' + (ledger.pendingReturnCount > 0 ? '700' : '500') + '">' + (ledger.pendingReturnCount > 0 ? (ledger.pendingReturnCount + ' Bank Return (' + formatINR(ledger.pendingReturnTotal) + ')') : (ledger.complianceEmpCount + ' emp · PF ' + formatINR(ledger.pfTotal) + ' · ESIC ' + formatINR(ledger.esicTotal))) + '</div>';
    h += '    </div>';

    h += '    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:12px 14px">';
    h += '      <div style="font-size:11px;font-weight:700;color:#64748b">Diff Sheet / Target (' + esc(formatMonthLabel(state.selectedMonth)) + ')</div>';
    h += '      <div style="font-size:21px;font-weight:800;color:#0f172a;margin-top:4px;font-variant-numeric:tabular-nums">' + formatINR(ledger.diffTotal) + '</div>';
    h += '      <div style="font-size:11px;color:#475569;margin-top:3px">Points ' + (ledger.netPointsImpact >= 0 ? '+' : '-') + formatINR(Math.abs(ledger.netPointsImpact)) + (ledger.empMissedDiffSum > 0 ? (' · Missed +' + formatINR(ledger.empMissedDiffSum)) : '') + (ledger.manualTotal > 0 ? (' · Manual ' + formatINR(ledger.manualTotal)) : '') + '</div>';
    h += '    </div>';

    h += '    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:12px 14px">';
    h += '      <div style="font-size:11px;font-weight:700;color:#64748b">Diff Me Di (Paid in Batches)</div>';
    h += '      <div style="font-size:21px;font-weight:800;color:#1d4ed8;margin-top:4px;font-variant-numeric:tabular-nums">' + formatINR(ledger.totalBatchPaid) + '</div>';
    h += '      <div style="font-size:11px;color:#475569;margin-top:3px">' + ledger.disbursedBatchCount + ' batches disbursed' + (ledger.totalBatchPlanned > 0 ? (' · ' + formatINR(ledger.totalBatchPlanned) + ' planned') : '') + '</div>';
    h += '    </div>';

    h += '    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:12px 14px">';
    h += '      <div style="font-size:11px;font-weight:700;color:#64748b">Diff Baaki / Chhoota Hua</div>';
    h += '      <div style="font-size:21px;font-weight:800;color:' + (ledger.diffRemainingTotal > 0 ? '#dc2626' : '#15803d') + ';margin-top:4px;font-variant-numeric:tabular-nums">' + formatINR(ledger.diffRemainingTotal) + '</div>';
    h += '      <div style="font-size:11px;color:#475569;margin-top:3px">' + (ledger.smallLeftoverRows.length > 0 ? (ledger.smallLeftoverRows.length + ' small leftover (≤₹500): ' + formatINR(ledger.smallLeftoverTotal)) : (ledger.diffRemainingTotal > 0 ? 'Balance to pay in next lots' : 'All Diff clear')) + '</div>';
    h += '    </div>';

    h += '    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:12px 14px">';
    h += '      <div style="font-size:11px;font-weight:700;color:#64748b">Total Month Payout (Comp + Diff)</div>';
    h += '      <div style="font-size:21px;font-weight:800;color:#312e81;margin-top:4px;font-variant-numeric:tabular-nums">' + formatINR(ledger.totalMonthSalary) + '</div>';
    h += '      <div style="font-size:11px;color:#475569;margin-top:3px">Comp ' + formatINR(ledger.complianceTotal) + ' + Diff ' + formatINR(ledger.diffTotal) + '</div>';
    h += '    </div>';
    h += '  </div>';

    // Uploaded Compliance & Diff Sheets Strip (Add multiple Diff sheets + Delete any sheet + Lock Compliance)
    if (ledger.uploadedSheets.length > 0) {
      h += '  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:10px">';
      // Compliance Sheets Box
      h += '    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:12px 14px">';
      h += '      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">';
      h += '        <div style="font-size:12px;font-weight:800;color:#15803d">Compliance Sheets / Manual (' + ledger.complianceSheets.length + ') · ' + formatINR(ledger.complianceTotal) + '</div>';
      h += '        <button type="button" onclick="ATPLSalaryPayout.openImportAndTargetsModal(\'COMPLIANCE\')" style="padding:3px 9px;border:1px solid #86efac;background:#f0fdf4;color:#15803d;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer">+ Sheet / Manual</button>';
      h += '      </div>';
      if (!ledger.complianceSheets.length) {
        h += '      <div style="font-size:11.5px;color:#64748b">Koi Compliance sheet/manual upload nahi hai.</div>';
      } else {
        h += '      <div style="display:flex;flex-direction:column;gap:6px">';
        ledger.complianceSheets.forEach(function(sh) {
          h += '        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 9px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:7px;font-size:11.5px">';
          h += '          <div><div style="font-weight:700;color:#0f172a">' + esc(sh.title) + (sh.locked ? ' <span style="color:#15803d;font-size:10.5px">(Locked · Return Only)</span>' : '') + '</div><div style="font-size:10.5px;color:#64748b">' + (sh.entryMode === 'MANUAL' ? 'Manual Entry' : (sh.empCount + ' emp · ' + esc((sh.selectedTabs || []).join(', ') || sh.fileName))) + (sh.notes ? (' · ' + esc(sh.notes)) : '') + '</div></div>';
          h += '          <div style="display:flex;align-items:center;gap:6px;white-space:nowrap">';
          h += '            <strong style="color:#15803d;font-variant-numeric:tabular-nums">' + formatINR(sh.complianceAmount) + '</strong>';
          h += '            <button type="button" onclick="ATPLSalaryPayout.toggleSheetLock(\'' + esc(sh.id) + '\')" style="padding:3px 7px;border:1px solid #cbd5e1;background:#fff;border-radius:5px;font-size:10.5px;font-weight:700;cursor:pointer">' + (sh.locked ? 'Unlock' : 'Lock') + '</button>';
          h += '            <button type="button" onclick="ATPLSalaryPayout.deleteUploadedSheet(\'' + esc(sh.id) + '\')" style="padding:3px 7px;border:1px solid #fecaca;background:#fef2f2;color:#dc2626;border-radius:5px;font-size:10.5px;font-weight:700;cursor:pointer">Delete</button>';
          h += '          </div>';
          h += '        </div>';
        });
        h += '      </div>';
      }
      h += '    </div>';

      // Diff Sheets Box (Additive Sheet 1 + Sheet 2 + Sheet 3 + Manual!)
      h += '    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:12px 14px">';
      h += '      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">';
      h += '        <div style="font-size:12px;font-weight:800;color:#1d4ed8">Diff Sheets / Manual (' + ledger.diffSheets.length + ' · Auto-Sum) · ' + formatINR(ledger.diffTotal) + '</div>';
      h += '        <button type="button" onclick="ATPLSalaryPayout.openImportAndTargetsModal(\'DIFF\')" style="padding:3px 9px;border:1px solid #bfdbfe;background:#eff6ff;color:#1d4ed8;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer">+ Add Diff Sheet / Manual</button>';
      h += '      </div>';
      if (!ledger.diffSheets.length) {
        h += '      <div style="font-size:11.5px;color:#64748b">Diff Sheet 1, Sheet 2, Sheet 3 ya Manual Diff add karein — sabhi aapas me judte jayenge.</div>';
      } else {
        h += '      <div style="display:flex;flex-direction:column;gap:6px">';
        ledger.diffSheets.forEach(function(sh, idx) {
          h += '        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 9px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:7px;font-size:11.5px">';
          h += '          <div><div style="font-weight:700;color:#0f172a">#' + (idx + 1) + ' ' + esc(sh.title) + '</div><div style="font-size:10.5px;color:#64748b">' + (sh.entryMode === 'MANUAL' ? 'Manual Diff' : (sh.empCount + ' emp · ' + esc((sh.selectedTabs || []).join(', ') || sh.fileName))) + (sh.notes ? (' · ' + esc(sh.notes)) : '') + '</div></div>';
          h += '          <div style="display:flex;align-items:center;gap:6px;white-space:nowrap">';
          h += '            <strong style="color:#1d4ed8;font-variant-numeric:tabular-nums">+' + formatINR(sh.diffAmount) + '</strong>';
          h += '            <button type="button" onclick="ATPLSalaryPayout.deleteUploadedSheet(\'' + esc(sh.id) + '\')" style="padding:3px 7px;border:1px solid #fecaca;background:#fef2f2;color:#dc2626;border-radius:5px;font-size:10.5px;font-weight:700;cursor:pointer">Delete</button>';
          h += '          </div>';
          h += '        </div>';
        });
        h += '      </div>';
      }
      h += '    </div>';
      h += '  </div>';
    }

    // Segmented Sub-Tab Bar + Search
    h += '  <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden">';
    h += '    <div style="padding:10px 14px;border-bottom:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;background:#f8fafc">';
    h += '      <div style="display:flex;gap:4px;padding:3px;background:#e2e8f0;border-radius:8px;flex-wrap:wrap">';
    var tabs = [
      { id: 'overview', label: 'Emp Ledger (' + ledger.rows.length + ')' },
      { id: 'points', label: 'Adjustment Points (' + ledger.points.length + ')' },
      { id: 'compliance', label: 'Compliance & Returns (' + ledger.complianceEmpCount + ' / ' + ledger.returns.length + ')' },
      { id: 'diff', label: 'Diff Batches / Parts (' + ledger.batches.length + ')' }
    ];
    tabs.forEach(function(tb) {
      var active = state.activeTab === tb.id;
      h += '        <button type="button" onclick="ATPLSalaryPayout.setTab(\'' + tb.id + '\')" style="padding:6px 12px;border:none;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap;' + (active ? 'background:#fff;color:#0f172a;box-shadow:0 1px 2px rgba(15,23,42,0.08)' : 'background:transparent;color:#475569') + '">' + esc(tb.label) + '</button>';
    });
    h += '      </div>';
    h += '      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">';
    h += '        <input type="text" value="' + esc(state.searchQuery) + '" oninput="ATPLSalaryPayout.setSearch(this.value)" placeholder="Search Emp Code, Name, Reason..." style="height:32px;padding:0 11px;border:1px solid #cbd5e1;border-radius:7px;font-size:12px;min-width:210px;background:#fff">';
    if (state.activeTab === 'overview') {
      h += '        <select onchange="ATPLSalaryPayout.setOverviewFilter(this.value)" style="height:32px;padding:0 9px;border:1px solid #cbd5e1;border-radius:7px;font-size:11.5px;font-weight:700;background:#fff;color:#334155">';
      h += '          <option value="ALL"' + (state.overviewFilter === 'ALL' ? ' selected' : '') + '>All Employees</option>';
      h += '          <option value="DIFF_PENDING"' + (state.overviewFilter === 'DIFF_PENDING' ? ' selected' : '') + '>Diff Remaining > 0</option>';
      h += '          <option value="LEFTOVER_SMALL"' + (state.overviewFilter === 'LEFTOVER_SMALL' ? ' selected' : '') + '>Small Leftover (≤ ₹500)</option>';
      h += '          <option value="HAS_POINTS"' + (state.overviewFilter === 'HAS_POINTS' ? ' selected' : '') + '>Has Adjustment Points</option>';
      h += '          <option value="RETURN_PENDING"' + (state.overviewFilter === 'RETURN_PENDING' ? ' selected' : '') + '>Bank Return Pending</option>';
      h += '        </select>';
    }
    h += '      </div>';
    h += '    </div>';

    // TAB 1: OVERVIEW & EMP LEDGER
    if (state.activeTab === 'overview') {
      var filteredRows = ledger.rows.filter(function(r) {
        if (state.overviewFilter === 'DIFF_PENDING' && !(r.diffRemaining > 0)) return false;
        if (state.overviewFilter === 'LEFTOVER_SMALL' && !r.isSmallLeftover) return false;
        if (state.overviewFilter === 'HAS_POINTS' && !r.pointsList.length) return false;
        if (state.overviewFilter === 'RETURN_PENDING' && !(r.returnsPendingCount > 0)) return false;
        if (q) {
          var hay = (r.empCode + ' ' + r.empName + ' ' + r.dept + ' ' + r.desig + ' ' + r.remarks).toLowerCase();
          if (hay.indexOf(q) < 0) return false;
        }
        return true;
      });
      if (ledger.smallLeftoverRows.length > 0) {
        h += '    <div style="padding:10px 16px;background:#fff7ed;border-bottom:1px solid #fed7aa;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">';
        h += '      <div style="font-size:12px;color:#9a3412"><strong>' + ledger.smallLeftoverRows.length + ' employees</strong> ka thoda sa Diff amount (≤ ₹500, total <strong>' + formatINR(ledger.smallLeftoverTotal) + '</strong>) abhi left hai (jaise ₹150 type leftover).</div>';
        h += '      <button type="button" onclick="ATPLSalaryPayout.openBatchModal(null,\'LEFTOVER_CLEARANCE\')" style="padding:6px 12px;border:none;background:#c2410c;color:#fff;border-radius:7px;font-size:11.5px;font-weight:700;cursor:pointer">Clear Small Leftover Batch</button>';
        h += '    </div>';
      }
      if (!filteredRows.length) {
        h += '    <div style="padding:38px 20px;text-align:center;color:#64748b">';
        h += '      <div style="font-size:14px;font-weight:700;color:#334155">Is mahine (' + esc(formatMonthLabel(state.selectedMonth)) + ') ke liye abhi koi employee ledger row nahi hai</div>';
        h += '      <div style="font-size:12px;margin-top:4px">Upar <strong>Upload Compliance Sheet</strong>, <strong>Upload Diff Sheet</strong>, ya <strong>+ Missed Diff / + Emp Point</strong> se data add karein.</div>';
        h += '    </div>';
      } else {
        h += '    <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px">';
        h += '      <thead><tr style="background:#f8fafc;border-bottom:1px solid #e2e8f0;color:#475569;font-size:11px;text-align:left"><th style="padding:9px 12px">Emp Code</th><th style="padding:9px 12px">Employee &amp; Remarks</th><th style="padding:9px 10px;text-align:right">Manual</th><th style="padding:9px 10px;text-align:right">PF / ESIC</th><th style="padding:9px 10px;text-align:right">Compliance (Net)</th><th style="padding:9px 10px;text-align:right">Diff Total</th><th style="padding:9px 10px;text-align:right">Points (+/-)</th><th style="padding:9px 10px;text-align:right">Net Diff</th><th style="padding:9px 10px;text-align:right">Diff Di (Parts)</th><th style="padding:9px 10px;text-align:right">Diff Left</th><th style="padding:9px 12px;text-align:center">Actions</th></tr></thead>';
        h += '      <tbody>';
        filteredRows.forEach(function(r) {
          var netPt = round2(r.plusPoints - r.minusPoints);
          var ptLabel = netPt === 0 ? (r.noteCount ? (r.noteCount + ' note') : '—') : ((netPt > 0 ? '+' : '-') + formatINR(Math.abs(netPt)));
          var statLabel = (r.pfEmployee > 0 || r.esicEmployee > 0) ? ('PF ' + formatINR(r.pfEmployee) + ' / ESIC ' + formatINR(r.esicEmployee)) : '—';
          h += '        <tr style="border-bottom:1px solid #f1f5f9">';
          h += '          <td style="padding:9px 12px;font-family:monospace;font-weight:800;color:#312e81">' + esc(r.empCode) + '</td>';
          h += '          <td style="padding:9px 12px"><div style="font-weight:700;color:#0f172a">' + esc(r.empName) + '</div><div style="font-size:11px;color:#64748b">' + esc(r.dept || '-') + (r.remarks ? (' · ' + esc(r.remarks)) : '') + (r.missedDiffAmount > 0 ? (' · <span style="color:#9a3412;font-weight:700">Missed +' + formatINR(r.missedDiffAmount) + '</span>') : '') + (r.returnsPendingCount > 0 ? (' · <span style="color:#b45309;font-weight:700">Bank Return Pending</span>') : '') + '</div></td>';
          h += '          <td style="padding:9px 10px;text-align:right;font-variant-numeric:tabular-nums;color:#334155">' + formatINR(r.manualAmount) + '</td>';
          h += '          <td style="padding:9px 10px;text-align:right;font-variant-numeric:tabular-nums;font-size:11px;color:#475569">' + esc(statLabel) + '</td>';
          h += '          <td style="padding:9px 10px;text-align:right;font-variant-numeric:tabular-nums;font-weight:700;color:#15803d">' + formatINR(r.complianceAmount) + '</td>';
          h += '          <td style="padding:9px 12px;text-align:right;font-variant-numeric:tabular-nums">' + formatINR(r.effectiveBaseDiff) + '</td>';
          h += '          <td style="padding:9px 12px;text-align:right;font-variant-numeric:tabular-nums;font-weight:700;color:' + (netPt > 0 ? '#15803d' : netPt < 0 ? '#dc2626' : '#64748b') + '">' + esc(ptLabel) + '</td>';
          h += '          <td style="padding:9px 12px;text-align:right;font-variant-numeric:tabular-nums;font-weight:700">' + formatINR(r.netDiffAmount) + '</td>';
          h += '          <td style="padding:9px 12px;text-align:right;font-variant-numeric:tabular-nums;color:#1d4ed8;font-weight:700">' + formatINR(r.diffPaid) + '</td>';
          h += '          <td style="padding:9px 12px;text-align:right;font-variant-numeric:tabular-nums;font-weight:800;color:' + (r.isSmallLeftover ? '#c2410c' : r.diffRemaining > 0 ? '#dc2626' : '#15803d') + '">' + formatINR(r.diffRemaining) + (r.isSmallLeftover ? ' (Left)' : '') + '</td>';
          h += '          <td style="padding:9px 12px;text-align:center;white-space:nowrap">';
          h += '            <button type="button" onclick="ATPLSalaryPayout.openEmpSalaryModal(\'' + esc(r.empCode) + '\')" style="padding:4px 8px;border:1px solid #cbd5e1;background:#fff;color:#0f172a;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;margin-right:3px">Edit</button>';
          h += '            <button type="button" onclick="ATPLSalaryPayout.openPointModal(null,\'' + esc(r.empCode) + '\')" style="padding:4px 8px;border:1px solid #c7d2fe;background:#eef2ff;color:#312e81;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;margin-right:3px">+ Point</button>';
          h += '            <button type="button" onclick="ATPLSalaryPayout.openReturnModal(null,\'' + esc(r.empCode) + '\')" style="padding:4px 8px;border:1px solid #fde68a;background:#fffbeb;color:#b45309;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;margin-right:3px">Return</button>';
          if (r.hasSalaryRecord) {
            h += '            <button type="button" onclick="ATPLSalaryPayout.deleteEmpSalary(\'' + esc(r.salId) + '\')" style="padding:4px 8px;border:1px solid #fecaca;background:#fef2f2;color:#dc2626;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer">Delete</button>';
          }
          h += '          </td>';
          h += '        </tr>';
        });
        h += '      </tbody></table></div>';
      }
    }

    // TAB 2: EMP ADJUSTMENT POINTS (+/-)
    if (state.activeTab === 'points') {
      var filteredPts = ledger.points.filter(function(p) {
        if (!q) return true;
        return (p.empCode + ' ' + p.empName + ' ' + p.note + ' ' + p.direction).toLowerCase().indexOf(q) >= 0;
      });
      h += '    <div style="padding:12px 16px;border-bottom:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">';
      h += '      <div style="font-size:12px;color:#475569">Salary banate waqt kisi bhi Emp Code par paise kam/zyada ya special points yahan save karein — sabhi browsers me auto sync hoga aur Net Diff me judega.</div>';
      h += '      <button type="button" onclick="ATPLSalaryPayout.openPointModal()" style="padding:7px 13px;border:none;background:#1e293b;color:#fff;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer">+ Add New Point</button>';
      h += '    </div>';
      if (!filteredPts.length) {
        h += '    <div style="padding:34px 20px;text-align:center;color:#64748b;font-size:12.5px">Abhi ' + esc(formatMonthLabel(state.selectedMonth)) + ' me koi adjustment point add nahi hua hai.</div>';
      } else {
        h += '    <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px">';
        h += '      <thead><tr style="background:#f8fafc;border-bottom:1px solid #e2e8f0;color:#475569;font-size:11px;text-align:left"><th style="padding:9px 12px">Emp Code</th><th style="padding:9px 12px">Name &amp; Dept</th><th style="padding:9px 12px">Type</th><th style="padding:9px 12px">Apply To</th><th style="padding:9px 12px;text-align:right">Amount (₹)</th><th style="padding:9px 12px">Point / Remark</th><th style="padding:9px 12px">Status</th><th style="padding:9px 12px;text-align:center">Actions</th></tr></thead>';
        h += '      <tbody>';
        filteredPts.forEach(function(p) {
          var dirTxt = p.direction === 'ADD' ? '+ Add / Extra' : p.direction === 'DEDUCT' ? '- Less / Cut' : 'Note Only';
          var dirCol = p.direction === 'ADD' ? '#15803d' : p.direction === 'DEDUCT' ? '#dc2626' : '#475569';
          h += '        <tr style="border-bottom:1px solid #f1f5f9">';
          h += '          <td style="padding:9px 12px;font-family:monospace;font-weight:800;color:#312e81">' + esc(p.empCode) + '</td>';
          h += '          <td style="padding:9px 12px"><strong>' + esc(p.empName) + '</strong><div style="font-size:11px;color:#64748b">' + esc(p.dept || '-') + '</div></td>';
          h += '          <td style="padding:9px 12px;font-weight:700;color:' + dirCol + '">' + esc(dirTxt) + '</td>';
          h += '          <td style="padding:9px 12px">' + esc(p.applyTo) + '</td>';
          h += '          <td style="padding:9px 12px;text-align:right;font-variant-numeric:tabular-nums;font-weight:800;color:' + dirCol + '">' + (p.direction === 'DEDUCT' ? '-' : p.direction === 'ADD' ? '+' : '') + formatINR(p.amount) + '</td>';
          h += '          <td style="padding:9px 12px;max-width:260px">' + esc(p.note || '—') + '</td>';
          h += '          <td style="padding:9px 12px"><button type="button" onclick="ATPLSalaryPayout.togglePointStatus(\'' + esc(p.id) + '\')" style="padding:3px 8px;border:1px solid #cbd5e1;background:#f8fafc;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer">' + esc(p.status) + '</button></td>';
          h += '          <td style="padding:9px 12px;text-align:center;white-space:nowrap">';
          h += '            <button type="button" onclick="ATPLSalaryPayout.openPointModal(\'' + esc(p.id) + '\')" style="padding:4px 8px;border:1px solid #cbd5e1;background:#fff;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;margin-right:4px">Edit</button>';
          h += '            <button type="button" onclick="ATPLSalaryPayout.deletePoint(\'' + esc(p.id) + '\')" style="padding:4px 8px;border:1px solid #fecaca;background:#fef2f2;color:#dc2626;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer">Delete</button>';
          h += '          </td>';
          h += '        </tr>';
        });
        h += '      </tbody></table></div>';
      }
    }

    // TAB 3: COMPLIANCE 1-TIME STATUS, SHEET & BANK RETURN RE-TRANSFER
    if (state.activeTab === 'compliance') {
      var compRows = ledger.rows.filter(function(r) {
        if (!(r.complianceAmount > 0)) return false;
        if (!q) return true;
        return (r.empCode + ' ' + r.empName + ' ' + r.accountNo + ' ' + r.remarks).toLowerCase().indexOf(q) >= 0;
      });
      var filteredRets = ledger.returns.filter(function(r) {
        if (!q) return true;
        return (r.empCode + ' ' + r.empName + ' ' + r.oldAccountNo + ' ' + r.newAccountNo + ' ' + r.reason).toLowerCase().indexOf(q) >= 0;
      });
      h += '    <div style="padding:14px 16px;border-bottom:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;background:#f8fafc">';
      h += '      <div>';
      h += '        <div style="font-size:13px;font-weight:800;color:#0f172a">Compliance Salary (' + esc(formatMonthLabel(state.selectedMonth)) + '): ' + (ledger.summary.complianceDisbursed ? '<span style="color:#15803d">1-Time Paid</span>' : '<span style="color:#475569">Active</span>') + (ledger.complianceLocked ? ' <span style="color:#15803d;font-size:11.5px">· 🔒 Locked (Return Only)</span>' : '') + ' · Total ' + formatINR(ledger.complianceTotal) + '</div>';
      h += '        <div style="font-size:11.5px;color:#64748b;margin-top:2px">' + (ledger.summary.complianceDate ? ('Transfer Date: ' + esc(ledger.summary.complianceDate) + (ledger.summary.complianceUtr ? (' · UTR: ' + esc(ledger.summary.complianceUtr)) : '')) : 'Compliance bank sheet upload karein ya manual daalein; agar return aaye toh A/C change karke re-transfer karein.') + '</div>';
      h += '      </div>';
      h += '      <div style="display:flex;gap:8px;flex-wrap:wrap">';
      h += '        <button type="button" onclick="ATPLSalaryPayout.openImportAndTargetsModal(\'COMPLIANCE\')" style="padding:7px 12px;border:1px solid #86efac;background:#f0fdf4;color:#15803d;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer">Upload Compliance Sheet</button>';
      h += '        <button type="button" onclick="ATPLSalaryPayout.openEmpSalaryModal()" style="padding:7px 12px;border:1px solid #cbd5e1;background:#fff;color:#0f172a;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer">+ Manual Compliance</button>';
      h += '        <button type="button" onclick="ATPLSalaryPayout.promptComplianceComplete()" style="padding:7px 12px;border:1px solid #cbd5e1;background:#fff;color:#15803d;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer">Mark Compliance Paid</button>';
      h += '        <button type="button" onclick="ATPLSalaryPayout.openReturnModal()" style="padding:7px 13px;border:none;background:#b45309;color:#fff;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer">+ Record Bank Return</button>';
      h += '      </div>';
      h += '    </div>';

      // Bank Returns Table
      if (filteredRets.length) {
        h += '    <div style="padding:8px 16px;background:#fffbeb;border-bottom:1px solid #fde68a;font-size:11.5px;font-weight:800;color:#92400e">Bank Return &amp; Account-Change Re-Transfer Queue (' + filteredRets.length + ')</div>';
        h += '    <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px">';
        h += '      <thead><tr style="background:#f8fafc;border-bottom:1px solid #e2e8f0;color:#475569;font-size:11px;text-align:left"><th style="padding:9px 12px">Emp Code</th><th style="padding:9px 12px">Name</th><th style="padding:9px 12px;text-align:right">Amount (₹)</th><th style="padding:9px 12px">Return Reason</th><th style="padding:9px 12px">Old A/C → New A/C</th><th style="padding:9px 12px">Status &amp; UTR</th><th style="padding:9px 12px;text-align:center">Actions</th></tr></thead>';
        h += '      <tbody>';
        filteredRets.forEach(function(r) {
          var isPending = r.status === 'PENDING';
          h += '        <tr style="border-bottom:1px solid #f1f5f9">';
          h += '          <td style="padding:9px 12px;font-family:monospace;font-weight:800;color:#312e81">' + esc(r.empCode) + '</td>';
          h += '          <td style="padding:9px 12px"><strong>' + esc(r.empName) + '</strong></td>';
          h += '          <td style="padding:9px 12px;text-align:right;font-variant-numeric:tabular-nums;font-weight:800">' + formatINR(r.amount) + '</td>';
          h += '          <td style="padding:9px 12px">' + esc(r.reason) + '</td>';
          h += '          <td style="padding:9px 12px;font-family:monospace;font-size:11px"><div style="color:#64748b">Old: ' + esc(r.oldAccountNo || '-') + ' (' + esc(r.oldIfsc || '-') + ')</div><div style="color:#15803d;font-weight:700">New: ' + esc(r.newAccountNo || 'Pending') + (r.newIfsc ? (' (' + esc(r.newIfsc) + ')') : '') + (r.updatedToMaster ? ' · Master Updated' : '') + '</div></td>';
          h += '          <td style="padding:9px 12px"><div style="font-weight:800;color:' + (isPending ? '#b45309' : '#15803d') + '">' + (isPending ? 'Return Pending' : 'Re-Transferred') + '</div><div style="font-size:11px;color:#64748b">' + esc(r.utr || r.retransferDate || '-') + '</div></td>';
          h += '          <td style="padding:9px 12px;text-align:center;white-space:nowrap">';
          if (isPending) {
            h += '            <button type="button" onclick="ATPLSalaryPayout.promptReTransfer(\'' + esc(r.id) + '\')" style="padding:4px 9px;border:none;background:#15803d;color:#fff;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;margin-right:4px">Re-Transfer</button>';
          }
          h += '            <button type="button" onclick="ATPLSalaryPayout.openReturnModal(\'' + esc(r.id) + '\')" style="padding:4px 8px;border:1px solid #cbd5e1;background:#fff;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;margin-right:4px">Edit</button>';
          h += '            <button type="button" onclick="ATPLSalaryPayout.deleteReturn(\'' + esc(r.id) + '\')" style="padding:4px 8px;border:1px solid #fecaca;background:#fef2f2;color:#dc2626;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer">Delete</button>';
          h += '          </td>';
          h += '        </tr>';
        });
        h += '      </tbody></table></div>';
      }

      // Compliance Employees List
      if (compRows.length) {
        h += '    <div style="padding:8px 16px;background:#f8fafc;border-top:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;font-size:11.5px;font-weight:800;color:#334155">Compliance Bank Sheet / Manual Entries (' + compRows.length + ' employees · ' + formatINR(ledger.complianceTotal) + ')</div>';
        h += '    <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px">';
        h += '      <thead><tr style="background:#fff;border-bottom:1px solid #e2e8f0;color:#475569;font-size:11px;text-align:left"><th style="padding:8px 12px">Emp Code</th><th style="padding:8px 12px">Name</th><th style="padding:8px 12px">Bank A/C &amp; IFSC</th><th style="padding:8px 10px;text-align:right">Manual (₹)</th><th style="padding:8px 10px;text-align:right">PF @12%</th><th style="padding:8px 10px;text-align:right">ESIC @0.75%</th><th style="padding:8px 10px;text-align:right">Net Pay (₹)</th><th style="padding:8px 12px;text-align:center">Actions</th></tr></thead>';
        h += '      <tbody>';
        compRows.forEach(function(r) {
          h += '        <tr style="border-bottom:1px solid #f1f5f9">';
          h += '          <td style="padding:8px 12px;font-family:monospace;font-weight:800;color:#312e81">' + esc(r.empCode) + '</td>';
          h += '          <td style="padding:8px 12px"><strong>' + esc(r.empName) + '</strong><div style="font-size:10.5px;color:#64748b">' + esc(r.remarks || r.sourceFile || '') + '</div></td>';
          h += '          <td style="padding:8px 12px;font-family:monospace;font-size:11px">' + esc(r.accountNo || '-') + (r.ifsc ? (' · ' + esc(r.ifsc)) : '') + '</td>';
          h += '          <td style="padding:8px 10px;text-align:right;font-variant-numeric:tabular-nums">' + formatINR(r.manualAmount) + '</td>';
          h += '          <td style="padding:8px 10px;text-align:right;font-variant-numeric:tabular-nums">' + formatINR(r.pfEmployee) + '</td>';
          h += '          <td style="padding:8px 10px;text-align:right;font-variant-numeric:tabular-nums">' + formatINR(r.esicEmployee) + '</td>';
          h += '          <td style="padding:8px 10px;text-align:right;font-variant-numeric:tabular-nums;font-weight:800;color:#15803d">' + formatINR(r.complianceAmount) + '</td>';
          h += '          <td style="padding:8px 12px;text-align:center;white-space:nowrap">';
          h += '            <button type="button" onclick="ATPLSalaryPayout.openReturnModal(null,\'' + esc(r.empCode) + '\')" style="padding:4px 8px;border:1px solid #fde68a;background:#fffbeb;color:#b45309;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;margin-right:3px">Bank Return</button>';
          h += '            <button type="button" onclick="ATPLSalaryPayout.openEmpSalaryModal(\'' + esc(r.empCode) + '\')" style="padding:4px 8px;border:1px solid #cbd5e1;background:#fff;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;margin-right:3px">Edit</button>';
          h += '            <button type="button" onclick="ATPLSalaryPayout.deleteEmpSalary(\'' + esc(r.salId) + '\')" style="padding:4px 8px;border:1px solid #fecaca;background:#fef2f2;color:#dc2626;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer">Delete</button>';
          h += '          </td>';
          h += '        </tr>';
        });
        h += '      </tbody></table></div>';
      } else if (!filteredRets.length) {
        h += '    <div style="padding:34px 20px;text-align:center;color:#64748b;font-size:12.5px">Abhi is mahine koi Compliance Bank Sheet ya Bank Return entry nahi hai.</div>';
      }
    }

    // TAB 4: DIFF MULTI-PART PAYOUT BATCHES (4-6+ PARTS / LEADERS / LEFTOVER)
    if (state.activeTab === 'diff') {
      var filteredBatches = ledger.batches.filter(function(b) {
        if (!q) return true;
        var allocStr = (b.allocations || []).map(function(al) { return al.empCode + ' ' + al.empName + ' ' + (al.remarks || ''); }).join(' ');
        var hay = (b.title + ' ' + b.lotType + ' ' + b.utr + ' ' + b.notes + ' ' + (b.signedBy || '') + ' ' + allocStr).toLowerCase();
        return hay.indexOf(q) >= 0;
      });
      h += '    <div style="padding:12px 16px;border-bottom:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">';
      h += '      <div style="font-size:12px;color:#475569">Har Diff payment lot (Bank Sheet upload ya Manual Emp Code + Amount + Remarks) alag Part me save &amp; sync hota hai.</div>';
      h += '      <div style="display:flex;gap:8px;flex-wrap:wrap">';
      h += '        <button type="button" onclick="ATPLSalaryPayout.openImportAndTargetsModal(\'DIFF\')" style="padding:7px 12px;border:1px solid #cbd5e1;background:#fff;color:#0f172a;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer">Upload Master Diff Sheet</button>';
      if (ledger.smallLeftoverRows.length > 0) {
        h += '        <button type="button" onclick="ATPLSalaryPayout.openBatchModal(null,\'LEFTOVER_CLEARANCE\')" style="padding:7px 12px;border:1px solid #fdba74;background:#fff7ed;color:#9a3412;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer">Leftover Clearance (' + ledger.smallLeftoverRows.length + ')</button>';
      }
      h += '        <button type="button" onclick="ATPLSalaryPayout.openBatchModal()" style="padding:7px 14px;border:none;background:#0f172a;color:#fff;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer">+ New Diff Batch (Part ' + (ledger.batches.length + 1) + ')</button>';
      h += '      </div>';
      h += '    </div>';
      if (!filteredBatches.length) {
        h += '    <div style="padding:36px 20px;text-align:center;color:#64748b;font-size:12.5px">Abhi ' + esc(formatMonthLabel(state.selectedMonth)) + ' me koi Diff Payout Batch nahi bana hai. Upar <strong>+ New Diff Batch</strong> se Bank Sheet ya Manual Emp Code + Amount + Remarks add karein.</div>';
      } else {
        h += '    <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px">';
        h += '      <thead><tr style="background:#f8fafc;border-bottom:1px solid #e2e8f0;color:#475569;font-size:11px;text-align:left"><th style="padding:9px 12px">Part</th><th style="padding:9px 12px">Batch Title &amp; Employees Detail</th><th style="padding:9px 12px">Date &amp; Mode</th><th style="padding:9px 12px;text-align:right">Batch Amount (₹)</th><th style="padding:9px 12px">Sign &amp; Status</th><th style="padding:9px 12px;text-align:center">Actions</th></tr></thead>';
        h += '      <tbody>';
        filteredBatches.forEach(function(b) {
          var amt = getBatchPaidTotal(b);
          var allocs = Array.isArray(b.allocations) ? b.allocations : [];
          var isPaid = b.status !== 'PLANNED';
          var empPreview = allocs.slice(0, 4).map(function(al) {
            return esc(al.empCode) + ' (' + formatINR(al.amount) + (al.remarks ? (': ' + esc(al.remarks)) : '') + ')';
          }).join(' · ');
          if (allocs.length > 4) empPreview += ' · +' + (allocs.length - 4) + ' more';

          h += '        <tr style="border-bottom:1px solid #f1f5f9">';
          h += '          <td style="padding:9px 12px;font-weight:800;color:#312e81">Part ' + esc(b.partNumber) + '</td>';
          h += '          <td style="padding:9px 12px"><div style="font-weight:700;color:#0f172a">' + esc(b.title) + '</div><div style="font-size:11px;color:#64748b">' + esc(lotLabelMap[b.lotType] || b.lotType) + (b.notes ? (' · ' + esc(b.notes)) : '') + '</div>' + (empPreview ? ('<div style="font-size:11px;color:#334155;margin-top:3px">' + empPreview + '</div>') : '') + '</td>';
          h += '          <td style="padding:9px 12px"><div>' + esc(b.paymentDate) + '</div><div style="font-size:11px;color:#64748b">' + esc(b.mode) + (b.utr ? (' · ' + esc(b.utr)) : '') + '</div></td>';
          h += '          <td style="padding:9px 12px;text-align:right;font-variant-numeric:tabular-nums;font-weight:800;color:#0f172a">' + formatINR(amt) + '<div style="font-size:10.5px;color:#64748b;font-weight:600">' + (allocs.length ? (allocs.length + ' employees') : 'Lump-Sum Lot') + '</div></td>';
          h += '          <td style="padding:9px 12px"><div style="font-weight:700;color:' + (isPaid ? '#15803d' : '#b45309') + '">' + (isPaid ? 'Disbursed' : 'Planned') + '</div><div style="font-size:11px;color:#64748b">' + esc(b.signedBy || '—') + '</div></td>';
          h += '          <td style="padding:9px 12px;text-align:center;white-space:nowrap">';
          h += '            <button type="button" onclick="ATPLSalaryPayout.markBatchDisbursed(\'' + esc(b.id) + '\')" style="padding:4px 8px;border:1px solid #86efac;background:#f0fdf4;color:#15803d;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;margin-right:4px">' + (isPaid ? 'Set Planned' : 'Mark Paid') + '</button>';
          h += '            <button type="button" onclick="ATPLSalaryPayout.printBatch(\'' + esc(b.id) + '\')" style="padding:4px 8px;border:1px solid #cbd5e1;background:#fff;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;margin-right:4px">Print</button>';
          h += '            <button type="button" onclick="ATPLSalaryPayout.openBatchModal(\'' + esc(b.id) + '\')" style="padding:4px 8px;border:1px solid #cbd5e1;background:#fff;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;margin-right:4px">Edit</button>';
          h += '            <button type="button" onclick="ATPLSalaryPayout.deleteDiffBatch(\'' + esc(b.id) + '\')" style="padding:4px 8px;border:1px solid #fecaca;background:#fef2f2;color:#dc2626;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer">Delete</button>';
          h += '          </td>';
          h += '        </tr>';
        });
        h += '      </tbody></table></div>';
      }
    }

    h += '  </div>';
    h += '</div>';
    container.innerHTML = h;
  }

  var ATPLSalaryPayout = {
    version: '1.1.0',
    init: function() {
      loadFromLocal();
      setupRealtimeListeners();
      fetchCloudNow(false, false);
      renderUI();
    },
    renderUI: renderUI,
    setSelectedMonth: setSelectedMonth,
    setTab: setTab,
    setOverviewFilter: setOverviewFilter,
    setSearch: setSearch,
    saveMonthSummary: saveMonthSummary,
    upsertEmpSalary: upsertEmpSalary,
    deleteEmpSalary: deleteEmpSalary,
    bulkImportMonthSalaries: bulkImportMonthSalaries,
    importFromLoadedFile: importFromLoadedFile,
    analyzeWorkbookTabs: analyzeWorkbookTabs,
    extractSalaryRowsWithMeta: extractSalaryRowsWithMeta,
    extractSalaryRowsFromWorkbook: extractSalaryRowsFromWorkbook,
    onTabSelectionChange: onTabSelectionChange,
    previewSelectedFileImport: previewSelectedFileImport,
    confirmPreviewImport: confirmPreviewImport,
    clearCurrentMonthAllData: clearCurrentMonthAllData,
    resetMonthData: resetMonthData,
    resetMonthTargets: resetMonthTargets,
    getMonthUploadedSheets: getMonthUploadedSheets,
    isComplianceLockedForMonth: isComplianceLockedForMonth,
    saveManualSheetEntry: saveManualSheetEntry,
    submitManualSheetEntry: submitManualSheetEntry,
    toggleSheetLock: toggleSheetLock,
    deleteUploadedSheet: deleteUploadedSheet,
    _markReplaceTouched: function() { state._userTouchedReplaceChk = true; },
    addOrUpdatePoint: addOrUpdatePoint,
    togglePointStatus: togglePointStatus,
    deletePoint: deletePoint,
    addOrUpdateReturn: addOrUpdateReturn,
    markReturnRetransferred: markReturnRetransferred,
    deleteReturn: deleteReturn,
    addOrUpdateDiffBatch: addOrUpdateDiffBatch,
    markBatchDisbursed: markBatchDisbursed,
    deleteDiffBatch: deleteDiffBatch,
    computeMonthLedger: computeMonthLedger,
    openPointModal: openPointModal,
    onPointCodeInput: onPointCodeInput,
    submitPointModal: submitPointModal,
    openEmpSalaryModal: openEmpSalaryModal,
    onEmpSalaryCodeInput: onEmpSalaryCodeInput,
    submitEmpSalaryModal: submitEmpSalaryModal,
    openReturnModal: openReturnModal,
    onReturnCodeInput: onReturnCodeInput,
    submitReturnModal: submitReturnModal,
    promptReTransfer: promptReTransfer,
    promptComplianceComplete: promptComplianceComplete,
    submitComplianceComplete: submitComplianceComplete,
    openBatchModal: openBatchModal,
    onBatchRowToggle: onBatchRowToggle,
    batchQuickSelect: batchQuickSelect,
    addManualRowToBatchModal: addManualRowToBatchModal,
    removeExtraBatchRow: removeExtraBatchRow,
    handleBatchBankSheetUpload: handleBatchBankSheetUpload,
    recalcBatchModalTotal: recalcBatchModalTotal,
    submitBatchModal: submitBatchModal,
    printBatch: printBatch,
    openImportAndTargetsModal: openImportAndTargetsModal,
    filterImportFileSelect: filterImportFileSelect,
    runFileImport: runFileImport,
    handleDirectExcelUpload: handleDirectExcelUpload,
    submitTargetsOnly: submitTargetsOnly,
    submitSingleEmpSalary: submitSingleEmpSalary,
    closeModal: closeModal,
    getState: function() { return state; },
    syncNow: async function(manual) {
      var res = await fetchCloudNow(true, !!manual);
      if (manual && window.showToast) {
        window.showToast(res && res.ok
          ? '✅ Salary Payout, Points, Returns & Diff Batches cloud se sync ho gaye!'
          : '⚠️ Offline/Local mode: latest local records dikha rahe hain.');
      }
      return res;
    }
  };

  window.ATPLSalaryPayout = ATPLSalaryPayout;

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function() { ATPLSalaryPayout.init(); });
    } else {
      ATPLSalaryPayout.init();
    }
  } else {
    ATPLSalaryPayout.init();
  }
})(typeof window !== 'undefined' ? window : globalThis);
