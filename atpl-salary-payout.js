/* ============================================================================
 * ATPLSalaryPayout — Monthly Salary, Emp Adjustment Points (+/-),
 * Compliance Bank Return Re-Transfer & Multi-Part Diff Payouts Dashboard
 * ----------------------------------------------------------------------------
 * Features:
 *  1. Month-Wise Salary Dashboard (Compliance + Diff + Net Adjustment Points)
 *  2. Emp Code Salary Adjustment Points (+ Extra / - Less / Note) synced real-time
 *  3. Compliance 1-Time Status + Bank Return & Account Change Re-Transfer Queue
 *     (optionally syncs corrected Bank A/C & IFSC back to Employee Master)
 *  4. Diff Multi-Part Payout Batches (4-6+ Parts: Workers ₹4-5L, Staff ₹1-2L,
 *     2-3 Leaders, Part Payments & Small Leftover <= ₹500 clearance like ₹150)
 *  5. Cross-Browser Cloud Sync: Google Drive/GAS + /api/sync/salary-payout +
 *     SSE + BroadcastChannel + localStorage + Tombstone Delete Protection
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
    pointFilterStatus: 'ALL',
    monthSummaries: {},
    empSalaries: {},
    points: {},
    returns: {},
    diffBatches: {},
    tombstones: {},
    editingPointId: null,
    editingReturnId: null,
    editingBatchId: null,
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
    // Fallback to existing monthly salary record if EM not loaded yet
    var salKey = state.selectedMonth + '::' + String(code).trim();
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

    var sections = ['monthSummaries', 'empSalaries', 'points', 'returns', 'diffBatches'];
    sections.forEach(function(sec) {
      var localMap = state[sec] || {};
      var remoteMap = (cloud[sec] && typeof cloud[sec] === 'object') ? cloud[sec] : {};
      // Prune local records superseded by tombstones
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

  function listAvailableMonths() {
    var set = {};
    set[state.selectedMonth || currentMonthIso()] = true;
    set[currentMonthIso()] = true;
    Object.keys(state.monthSummaries || {}).forEach(function(k) { if (k) set[k] = true; });
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
    var empMap = {}; // normCode -> row

    function ensureRow(empCode, hint) {
      var norm = normalizeCode(empCode);
      if (!norm) return null;
      if (!empMap[norm]) {
        var em = findEmployeeByCode(empCode);
        empMap[norm] = {
          normCode: norm,
          empCode: (hint && hint.empCode) || (em && em.empCode) || String(empCode).trim(),
          empName: (hint && hint.empName) || (em && em.name) || ('Employee ' + empCode),
          dept: (hint && hint.dept) || (em && em.dept) || '',
          desig: (hint && hint.desig) || (em && em.desig) || '',
          accountNo: (hint && hint.accountNo) || (em && em.accountNo) || '',
          ifsc: (hint && hint.ifsc) || (em && em.ifsc) || '',
          manualAmount: Number(hint && hint.manualAmount) || 0,
          complianceAmount: Number(hint && hint.complianceAmount) || 0,
          baseDiffAmount: Number(hint && hint.baseDiffAmount) || 0,
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
      var row = ensureRow(s.empCode, s);
      if (!row) return;
      row.empCode = s.empCode || row.empCode;
      row.empName = s.empName || row.empName;
      row.dept = s.dept || row.dept;
      row.desig = s.desig || row.desig;
      row.accountNo = s.accountNo || row.accountNo;
      row.ifsc = s.ifsc || row.ifsc;
      row.manualAmount = round2(Number(s.manualAmount) || 0);
      row.complianceAmount = round2(Number(s.complianceAmount) || 0);
      row.baseDiffAmount = round2(Number(s.baseDiffAmount) || 0);
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
      r.netDiffAmount = Math.max(0, round2(r.baseDiffAmount + r.plusPoints - r.minusPoints));
      r.diffRemaining = Math.max(0, round2(r.netDiffAmount - r.diffPaid));
      r.isSmallLeftover = r.diffRemaining > 0 && r.diffRemaining <= 500;
      return r;
    }).sort(function(a, b) {
      return String(a.empCode).localeCompare(String(b.empCode), undefined, { numeric: true });
    });

    var empComplianceSum = rows.reduce(function(acc, r) { return round2(acc + r.complianceAmount); }, 0);
    var empBaseDiffSum = rows.reduce(function(acc, r) { return round2(acc + r.baseDiffAmount); }, 0);
    var empNetDiffSum = rows.reduce(function(acc, r) { return round2(acc + r.netDiffAmount); }, 0);
    var empDiffRemainingSum = rows.reduce(function(acc, r) { return round2(acc + r.diffRemaining); }, 0);
    var smallLeftoverRows = rows.filter(function(r) { return r.isSmallLeftover; });
    var smallLeftoverTotal = smallLeftoverRows.reduce(function(acc, r) { return round2(acc + r.diffRemaining); }, 0);

    var complianceTotal = round2(Number(summary.complianceTarget) || 0) > 0 ? round2(Number(summary.complianceTarget)) : empComplianceSum;
    var diffTargetBase = round2(Number(summary.diffTarget) || 0) > 0 ? round2(Number(summary.diffTarget)) : empNetDiffSum;
    // If summary diffTarget is set explicitly without emp rows, apply net points impact too
    var diffTotal = round2(Number(summary.diffTarget) || 0) > 0 && empBaseDiffSum === 0
      ? Math.max(0, round2(diffTargetBase + totalPlusPoints - totalMinusPoints))
      : Math.max(diffTargetBase, empNetDiffSum);

    var diffRemainingTotal = empNetDiffSum > 0 && lumpSumUnallocated === 0
      ? empDiffRemainingSum
      : Math.max(0, round2(diffTotal - totalBatchPaidAll));

    return {
      monthKey: mk,
      summary: summary,
      rows: rows,
      points: pts,
      returns: rets,
      batches: batches,
      complianceTotal: complianceTotal,
      diffTotal: diffTotal,
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

  // ── CRUD OPERATIONS (WITH REAL-TIME CLOUD SYNC) ──
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
    var rec = {
      id: id,
      monthKey: mk,
      empCode: code,
      empName: String(payload.empName || (em && em.name) || (prev && prev.empName) || ('Employee ' + code)).trim(),
      dept: String(payload.dept || (em && em.dept) || (prev && prev.dept) || '').trim(),
      desig: String(payload.desig || (em && em.desig) || (prev && prev.desig) || '').trim(),
      accountNo: String(payload.accountNo || (em && em.accountNo) || (prev && prev.accountNo) || '').trim(),
      ifsc: String(payload.ifsc || (em && em.ifsc) || (prev && prev.ifsc) || '').trim(),
      manualAmount: round2(Number(payload.manualAmount !== undefined ? payload.manualAmount : (prev && prev.manualAmount)) || 0),
      complianceAmount: round2(Number(payload.complianceAmount !== undefined ? payload.complianceAmount : (prev && prev.complianceAmount)) || 0),
      baseDiffAmount: round2(Number(payload.baseDiffAmount !== undefined ? payload.baseDiffAmount : (prev && prev.baseDiffAmount)) || 0),
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

  function bulkImportMonthSalaries(monthKey, rowsList, sourceFile) {
    var mk = String(monthKey || state.selectedMonth).trim();
    if (!mk || !Array.isArray(rowsList) || !rowsList.length) return { ok: false, imported: 0 };
    var nowIso = new Date().toISOString();
    var count = 0;
    rowsList.forEach(function(item) {
      if (!item || !item.empCode) return;
      var code = String(item.empCode).trim();
      var id = mk + '::' + normalizeCode(code);
      var em = findEmployeeByCode(code);
      var prev = state.empSalaries[id];
      delete state.tombstones[id];
      state.empSalaries[id] = {
        id: id,
        monthKey: mk,
        empCode: code,
        empName: String(item.empName || (em && em.name) || (prev && prev.empName) || ('Employee ' + code)).trim(),
        dept: String(item.dept || (em && em.dept) || (prev && prev.dept) || '').trim(),
        desig: String(item.desig || (em && em.desig) || (prev && prev.desig) || '').trim(),
        accountNo: String(item.accountNo || (em && em.accountNo) || (prev && prev.accountNo) || '').trim(),
        ifsc: String(item.ifsc || (em && em.ifsc) || (prev && prev.ifsc) || '').trim(),
        manualAmount: round2(Number(item.manualAmount) || 0),
        complianceAmount: round2(Number(item.complianceAmount) || 0),
        baseDiffAmount: round2(Number(item.baseDiffAmount) || 0),
        sourceFile: String(sourceFile || item.sourceFile || 'Salary Sheet').trim(),
        createdAt: (prev && prev.createdAt) || nowIso,
        updatedAt: nowIso
      };
      count++;
    });
    if (count > 0) {
      saveToLocal();
      renderUI();
      pushCloudNow('bulk_import_salary');
    }
    return { ok: count > 0, imported: count };
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
    // Also update month salary snapshot if present
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
        amount: round2(Number(a.amount) || 0)
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

  // ── SALARY SHEET PARSER (FROM window.FILES OR UPLOADED XLSX) ──
  function cleanHeader(v) {
    return String(v === null || v === undefined ? '' : v).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function parseNumeric(v) {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v !== 'string') return 0;
    var n = Number(v.replace(/[₹,\s]/g, ''));
    return Number.isFinite(n) ? n : 0;
  }

  function findHeaderIdx(headers, patterns) {
    for (var p = 0; p < patterns.length; p++) {
      var pat = patterns[p];
      for (var i = 0; i < headers.length; i++) {
        if (pat instanceof RegExp ? pat.test(headers[i]) : headers[i] === pat) return i;
      }
    }
    return -1;
  }

  function extractSalaryRowsFromWorkbook(fileObj) {
    if (!fileObj || !fileObj.sheets) return [];
    var byCode = {};
    Object.keys(fileObj.sheets).forEach(function(sheetName) {
      var low = String(sheetName || '').toLowerCase();
      if (/\b(summary|total|abstract|chart|challan|ecr|pf summary|esic summary|attendance|absent|ot sheet)\b/.test(low)) return;
      var grid = fileObj.sheets[sheetName];
      if (!Array.isArray(grid) || grid.length < 2) return;
      var hdrIdx = -1;
      for (var r = 0; r < Math.min(grid.length, 15); r++) {
        var row = grid[r];
        if (!Array.isArray(row)) continue;
        var normRow = row.map(cleanHeader);
        var hasCode = normRow.some(function(h) { return /\b(emp\s*code|emp\s*id|e\s*code|code|id\s*no)\b/.test(h); });
        var hasMoney = normRow.some(function(h) { return /\b(diff|net|gross|manual|payable|bank|salary)\b/.test(h); });
        if (hasCode && hasMoney) {
          hdrIdx = r;
          break;
        }
      }
      if (hdrIdx < 0) return;
      var h = grid[hdrIdx].map(cleanHeader);
      var iCode = findHeaderIdx(h, [/^emp\s*code$/, /^emp\s*id$/, /^e\s*code$/, /\b(emp\s*code|emp\s*id|employee\s*code|e\s*code|code)\b/]);
      if (iCode < 0) return;
      var iName = findHeaderIdx(h, [/^emp\s*name$/, /^employee\s*name$/, /^name$/]);
      var iDept = findHeaderIdx(h, [/\b(dept|department)\b/]);
      var iDesig = findHeaderIdx(h, [/\b(desig|designation)\b/]);
      var iManual = findHeaderIdx(h, [/\b(manual\s*amt|manual\s*amount|manual)\b/]);
      var iDiff = findHeaderIdx(h, [/\b(diff\s*amt|diff\s*amount|difference\s*amount|cash\s*diff|diff)\b/]);
      var iComp = findHeaderIdx(h, [/\b(net\s*pay|net\s*payable|bank\s*transfer|compliance\s*net|net\s*salary|payable\s*bank)\b/, /\b(gross\s*earned|earned\s*gross|gross\s*pay|gross)\b/]);
      var iAcc = findHeaderIdx(h, [/\b(a\s*c\s*no|account\s*no|bank\s*account|ac\s*no)\b/]);
      var iIfsc = findHeaderIdx(h, [/\b(ifsc|ifsc\s*code)\b/]);

      for (var rr = hdrIdx + 1; rr < grid.length; rr++) {
        var dataRow = grid[rr];
        if (!Array.isArray(dataRow)) continue;
        var rawCode = String(dataRow[iCode] === null || dataRow[iCode] === undefined ? '' : dataRow[iCode]).trim().replace(/\.0$/, '');
        if (!rawCode || /^(total|grand total|sub total|sr|s no|emp code)$/i.test(rawCode)) continue;
        if (!/^[a-z0-9_-]{1,16}$/i.test(rawCode)) continue;
        var compVal = iComp >= 0 ? Math.max(0, round2(parseNumeric(dataRow[iComp]))) : 0;
        var diffVal = iDiff >= 0 ? Math.max(0, round2(parseNumeric(dataRow[iDiff]))) : 0;
        var manVal = iManual >= 0 ? Math.max(0, round2(parseNumeric(dataRow[iManual]))) : 0;
        if (compVal === 0 && diffVal === 0 && manVal === 0) continue;
        if (diffVal === 0 && manVal > compVal && compVal > 0) {
          diffVal = round2(manVal - compVal);
        }
        var norm = normalizeCode(rawCode);
        if (!byCode[norm]) {
          byCode[norm] = {
            empCode: rawCode,
            empName: iName >= 0 ? String(dataRow[iName] || '').trim() : '',
            dept: iDept >= 0 ? String(dataRow[iDept] || '').trim() : '',
            desig: iDesig >= 0 ? String(dataRow[iDesig] || '').trim() : '',
            accountNo: iAcc >= 0 ? String(dataRow[iAcc] || '').trim() : '',
            ifsc: iIfsc >= 0 ? String(dataRow[iIfsc] || '').trim() : '',
            manualAmount: manVal,
            complianceAmount: compVal,
            baseDiffAmount: diffVal
          };
        } else {
          byCode[norm].manualAmount = round2(byCode[norm].manualAmount + manVal);
          byCode[norm].complianceAmount = round2(byCode[norm].complianceAmount + compVal);
          byCode[norm].baseDiffAmount = round2(byCode[norm].baseDiffAmount + diffVal);
        }
      }
    });
    return Object.values(byCode);
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

  function importFromLoadedFile(fileName, monthKey) {
    var mk = monthKey || state.selectedMonth;
    var files = getLoadedSalaryWorkbooks();
    var target = files.find(function(f) { return f && f.name === fileName; });
    if (!target) {
      if (window.showToast) window.showToast('⚠️ Selected salary file loaded nahi mili.');
      return { ok: false, imported: 0 };
    }
    var extracted = extractSalaryRowsFromWorkbook(target);
    if (!extracted.length) {
      if (window.showToast) window.showToast('⚠️ Is sheet me Emp Code / Salary columns detect nahi huye.');
      return { ok: false, imported: 0 };
    }
    var res = bulkImportMonthSalaries(mk, extracted, target.name);
    if (window.showToast) window.showToast('✅ ' + res.imported + ' employees ki ' + formatMonthLabel(mk) + ' salary import aur sync ho gayi!');
    return res;
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
    h += '      <button type="button" onclick="ATPLSalaryPayout.submitPointModal()" style="padding:8px 18px;border:none;background:#1e293b;color:#fff;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer">Save & Sync Point</button>';
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
    h += '        <div>';
    h += '          <label style="display:block;font-size:10.5px;font-weight:700;color:#64748b;margin-bottom:3px">Old Bank A/C (Returned)</label>';
    h += '          <input type="text" id="spRetOldAcc" value="' + esc(defOldAcc) + '" style="width:100%;padding:7px 9px;border:1px solid #cbd5e1;border-radius:6px;font-size:12px;font-family:monospace;box-sizing:border-box">';
    h += '        </div>';
    h += '        <div>';
    h += '          <label style="display:block;font-size:10.5px;font-weight:700;color:#64748b;margin-bottom:3px">Old IFSC</label>';
    h += '          <input type="text" id="spRetOldIfsc" value="' + esc(defOldIfsc) + '" style="width:100%;padding:7px 9px;border:1px solid #cbd5e1;border-radius:6px;font-size:12px;font-family:monospace;box-sizing:border-box">';
    h += '        </div>';
    h += '      </div>';
    h += '      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:10px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px">';
    h += '        <div>';
    h += '          <label style="display:block;font-size:10.5px;font-weight:700;color:#15803d;margin-bottom:3px">New / Corrected Bank A/C</label>';
    h += '          <input type="text" id="spRetNewAcc" value="' + esc(defNewAcc) + '" placeholder="Naya Sahi Account No." style="width:100%;padding:7px 9px;border:1px solid #86efac;border-radius:6px;font-size:12px;font-family:monospace;font-weight:700;box-sizing:border-box">';
    h += '        </div>';
    h += '        <div>';
    h += '          <label style="display:block;font-size:10.5px;font-weight:700;color:#15803d;margin-bottom:3px">New IFSC</label>';
    h += '          <input type="text" id="spRetNewIfsc" value="' + esc(defNewIfsc) + '" placeholder="e.g. SBIN0001234" style="width:100%;padding:7px 9px;border:1px solid #86efac;border-radius:6px;font-size:12px;font-family:monospace;font-weight:700;box-sizing:border-box">';
    h += '        </div>';
    h += '        <div>';
    h += '          <label style="display:block;font-size:10.5px;font-weight:700;color:#15803d;margin-bottom:3px">New Bank Name (Optional)</label>';
    h += '          <input type="text" id="spRetNewBank" value="' + esc(defNewBank) + '" placeholder="e.g. SBI / BOB / HDFC" style="width:100%;padding:7px 9px;border:1px solid #86efac;border-radius:6px;font-size:12px;box-sizing:border-box">';
    h += '        </div>';
    h += '        <div>';
    h += '          <label style="display:block;font-size:10.5px;font-weight:700;color:#15803d;margin-bottom:3px">Re-Transfer UTR / Ref</label>';
    h += '          <input type="text" id="spRetUtr" value="' + esc(defUtr) + '" placeholder="Re-pay UTR number" style="width:100%;padding:7px 9px;border:1px solid #86efac;border-radius:6px;font-size:12px;font-family:monospace;box-sizing:border-box">';
    h += '        </div>';
    h += '      </div>';
    h += '      <label style="display:flex;align-items:center;gap:8px;font-size:12px;font-weight:600;color:#0f172a;cursor:pointer">';
    h += '        <input type="checkbox" id="spRetUpdateMaster" checked> New Bank A/C &amp; IFSC ko Employee Master me bhi update &amp; sync karein';
    h += '      </label>';
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
    if (b && Array.isArray(b.allocations)) {
      b.allocations.forEach(function(al) {
        if (al && al.empCode) existingAllocMap[normalizeCode(al.empCode)] = round2(Number(al.amount) || 0);
      });
    }

    var candidateRows = ledger.rows.filter(function(r) {
      var prevInThisBatch = existingAllocMap[r.normCode] || 0;
      return r.diffRemaining > 0 || prevInThisBatch > 0;
    });

    var h = '';
    h += '<div style="position:fixed;inset:0;background:rgba(15,23,42,0.5);backdrop-filter:blur(3px);z-index:10050;display:flex;align-items:center;justify-content:center;padding:16px" onclick="if(event.target===this)ATPLSalaryPayout.closeModal()">';
    h += '  <div style="background:#fff;border:1px solid #e2e8f0;border-radius:14px;max-width:780px;width:100%;max-height:92vh;display:flex;flex-direction:column;box-shadow:0 24px 48px rgba(15,23,42,0.22);overflow:hidden">';
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
    h += '        <div><label style="display:block;font-size:10.5px;font-weight:700;color:#475569;margin-bottom:3px">Lump-Sum Lot Amount (₹ Optional)</label><input type="number" id="spBatLump" min="0" value="' + esc(defLump) + '" placeholder="Agar bina emp list ke dalna ho" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;font-size:12px;font-weight:700;box-sizing:border-box"></div>';
    h += '        <div><label style="display:block;font-size:10.5px;font-weight:700;color:#475569;margin-bottom:3px">UTR / Voucher Ref</label><input type="text" id="spBatUtr" value="' + esc(defUtr) + '" placeholder="UTR / Ref No." style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;font-size:12px;box-sizing:border-box"></div>';
    h += '        <div><label style="display:block;font-size:10.5px;font-weight:700;color:#475569;margin-bottom:3px">Notes</label><input type="text" id="spBatNotes" value="' + esc(defNotes) + '" placeholder="e.g. 2-3 Leaders Lot / ₹150 remaining clear" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;font-size:12px;box-sizing:border-box"></div>';
    h += '      </div>';

    // Employee-wise allocation table inside batch modal
    h += '      <div style="border:1px solid #e2e8f0;border-radius:10px;overflow:hidden">';
    h += '        <div style="padding:8px 12px;background:#f8fafc;border-bottom:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">';
    h += '          <div style="font-size:11.5px;font-weight:700;color:#0f172a">Employee Diff Allocation (Custom / Partial / Leftover)</div>';
    h += '          <div style="display:flex;gap:6px;flex-wrap:wrap">';
    h += '            <button type="button" onclick="ATPLSalaryPayout.batchQuickSelect(\'ALL\')" style="padding:4px 9px;border:1px solid #cbd5e1;background:#fff;border-radius:6px;font-size:10.5px;font-weight:700;cursor:pointer">Fill All Remaining</button>';
    h += '            <button type="button" onclick="ATPLSalaryPayout.batchQuickSelect(\'LEFTOVER\')" style="padding:4px 9px;border:1px solid #fdba74;background:#fff7ed;color:#9a3412;border-radius:6px;font-size:10.5px;font-weight:700;cursor:pointer">Only Leftover ≤ ₹500</button>';
    h += '            <button type="button" onclick="ATPLSalaryPayout.batchQuickSelect(\'CLEAR\')" style="padding:4px 9px;border:1px solid #cbd5e1;background:#fff;color:#64748b;border-radius:6px;font-size:10.5px;font-weight:700;cursor:pointer">Clear All</button>';
    h += '          </div>';
    h += '        </div>';
    h += '        <div style="max-height:240px;overflow-y:auto">';
    if (!candidateRows.length) {
      h += '          <div style="padding:18px;text-align:center;color:#64748b;font-size:12px">Abhi is mahine ki employee Diff sheet import nahi hui hai. Upar <strong>Lump-Sum Lot Amount</strong> daal sakte ho ya niche ek-ek Emp Code add kar sakte ho.</div>';
    } else {
      h += '          <table style="width:100%;border-collapse:collapse;font-size:11.5px">';
      h += '            <thead><tr style="background:#fff;border-bottom:1px solid #e2e8f0;color:#64748b;font-size:10px;text-align:left"><th style="padding:7px 10px">Pick</th><th style="padding:7px 10px">Emp Code</th><th style="padding:7px 10px">Name / Dept</th><th style="padding:7px 10px;text-align:right">Remaining</th><th style="padding:7px 10px;text-align:right">Pay in This Batch (₹)</th></tr></thead>';
      h += '            <tbody>';
      candidateRows.forEach(function(r) {
        var avail = round2(r.diffRemaining + (existingAllocMap[r.normCode] || 0));
        var preChecked = existingAllocMap[r.normCode] > 0 || (isLeftoverPreset && avail > 0 && avail <= 500);
        var preVal = existingAllocMap[r.normCode] > 0 ? existingAllocMap[r.normCode] : (preChecked ? avail : 0);
        h += '              <tr class="sp-bat-row" data-code="' + esc(r.empCode) + '" data-name="' + esc(r.empName) + '" data-avail="' + avail + '" style="border-bottom:1px solid #f1f5f9">';
        h += '                <td style="padding:6px 10px"><input type="checkbox" class="sp-bat-chk"' + (preChecked ? ' checked' : '') + ' onchange="ATPLSalaryPayout.onBatchRowToggle(this)"></td>';
        h += '                <td style="padding:6px 10px;font-family:monospace;font-weight:700;color:#312e81">' + esc(r.empCode) + '</td>';
        h += '                <td style="padding:6px 10px">' + esc(r.empName) + (r.dept ? (' <span style="color:#64748b;font-size:10.5px">· ' + esc(r.dept) + '</span>') : '') + '</td>';
        h += '                <td style="padding:6px 10px;text-align:right;font-variant-numeric:tabular-nums;color:' + (avail <= 500 ? '#c2410c' : '#334155') + ';font-weight:700">' + formatINR(avail) + '</td>';
        h += '                <td style="padding:6px 10px;text-align:right"><input type="number" class="sp-bat-amt" min="0" step="1" value="' + (preVal || '') + '" oninput="ATPLSalaryPayout.recalcBatchModalTotal()" style="width:105px;padding:4px 7px;border:1px solid #cbd5e1;border-radius:6px;text-align:right;font-variant-numeric:tabular-nums;font-weight:700"></td>';
        h += '              </tr>';
      });
      h += '            </tbody></table>';
    }
    h += '        </div>';
    // Quick inline add single Emp Code to batch (useful for 2-3 Leaders without importing full sheet)
    h += '        <div style="padding:8px 12px;background:#f8fafc;border-top:1px solid #e2e8f0;display:flex;gap:8px;align-items:center;flex-wrap:wrap">';
    h += '          <span style="font-size:11px;font-weight:700;color:#475569">Quick Add Emp:</span>';
    h += '          <input type="text" id="spBatQuickCode" placeholder="Emp Code" style="width:100px;padding:5px 8px;border:1px solid #cbd5e1;border-radius:6px;font-size:11.5px">';
    h += '          <input type="number" id="spBatQuickAmt" placeholder="Amount ₹" style="width:110px;padding:5px 8px;border:1px solid #cbd5e1;border-radius:6px;font-size:11.5px">';
    h += '          <button type="button" onclick="ATPLSalaryPayout.addManualRowToBatchModal()" style="padding:5px 10px;border:1px solid #cbd5e1;background:#fff;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer">+ Add to Batch</button>';
    h += '          <div id="spBatQuickExtraList" style="font-size:11px;color:#15803d;font-weight:700"></div>';
    h += '        </div>';
    h += '      </div>';

    h += '    </div>';
    h += '    <div style="padding:12px 20px;border-top:1px solid #e2e8f0;background:#f8fafc;display:flex;justify-content:space-between;align-items:center;gap:10px">';
    h += '      <div id="spBatModalTotal" style="font-size:13px;font-weight:800;color:#0f172a;font-variant-numeric:tabular-nums">Selected Total: ₹0</div>';
    h += '      <div style="display:flex;gap:8px">';
    h += '        <button type="button" onclick="ATPLSalaryPayout.closeModal()" style="padding:8px 14px;border:1px solid #cbd5e1;background:#fff;color:#475569;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer">Cancel</button>';
    h += '        <button type="button" onclick="ATPLSalaryPayout.submitBatchModal()" style="padding:8px 18px;border:none;background:#1e293b;color:#fff;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer">Save &amp; Sync Batch</button>';
    h += '      </div>';
    h += '    </div>';
    h += '  </div>';
    h += '</div>';
    modal.innerHTML = h;
    state._batchExtraRows = [];
    recalcBatchModalTotal();
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
    var code = String((cEl && cEl.value) || '').trim();
    var amt = round2(Number((aEl && aEl.value) || 0));
    if (!code || amt <= 0) return;
    var em = findEmployeeByCode(code);
    state._batchExtraRows = state._batchExtraRows || [];
    state._batchExtraRows.push({
      empCode: code,
      empName: em ? em.name : ('Employee ' + code),
      amount: amt
    });
    if (cEl) cEl.value = '';
    if (aEl) aEl.value = '';
    var badge = document.getElementById('spBatQuickExtraList');
    if (badge) badge.textContent = state._batchExtraRows.length + ' manual emp added';
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
    var lump = round2(Number((document.getElementById('spBatLump') || {}).value || 0));
    var el = document.getElementById('spBatModalTotal');
    if (el) {
      var eff = lump > 0 ? lump : total;
      el.textContent = 'Batch Total: ' + formatINR(eff) + ' (' + count + ' employees selected)';
    }
  }

  function submitBatchModal() {
    var allocs = [];
    document.querySelectorAll('.sp-bat-row').forEach(function(tr) {
      var chk = tr.querySelector('.sp-bat-chk');
      var inp = tr.querySelector('.sp-bat-amt');
      var val = round2(Number((inp && inp.value) || 0));
      if (chk && chk.checked && val > 0) {
        allocs.push({
          empCode: tr.getAttribute('data-code'),
          empName: tr.getAttribute('data-name'),
          amount: val
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
      if (window.showToast) window.showToast('⚠️ Kam se kam ek employee select karein ya Lump-Sum Amount daalein.');
      return;
    }
    state._batchExtraRows = [];
    closeModal();
    if (window.showToast) window.showToast('✅ Diff Payout Batch save & sabhi browsers me sync ho gaya!');
  }

  function openImportAndTargetsModal() {
    var modal = getOrCreateModal();
    if (!modal) return;
    var summary = getMonthSummary(state.selectedMonth);
    var loadedFiles = getLoadedSalaryWorkbooks();
    var h = '';
    h += '<div style="position:fixed;inset:0;background:rgba(15,23,42,0.5);backdrop-filter:blur(3px);z-index:10050;display:flex;align-items:center;justify-content:center;padding:16px" onclick="if(event.target===this)ATPLSalaryPayout.closeModal()">';
    h += '  <div style="background:#fff;border:1px solid #e2e8f0;border-radius:14px;max-width:600px;width:100%;max-height:92vh;overflow-y:auto;box-shadow:0 24px 48px rgba(15,23,42,0.22)">';
    h += '    <div style="padding:15px 20px;border-bottom:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center">';
    h += '      <div><div style="font-size:11px;font-weight:700;color:#4f46e5">' + esc(formatMonthLabel(state.selectedMonth)) + ' · Month Setup</div><h3 style="margin:2px 0 0;font-size:16px;font-weight:800;color:#0f172a">Load Month Salary Sheet / Set Targets</h3></div>';
    h += '      <button type="button" onclick="ATPLSalaryPayout.closeModal()" style="border:1px solid #e2e8f0;background:#f8fafc;color:#64748b;width:30px;height:30px;border-radius:8px;cursor:pointer;font-size:14px">✕</button>';
    h += '    </div>';
    h += '    <div style="padding:16px 20px;display:flex;flex-direction:column;gap:14px">';
    h += '      <div style="padding:12px;border:1px solid #e2e8f0;border-radius:10px;background:#f8fafc">';
    h += '        <div style="font-size:12px;font-weight:800;color:#0f172a;margin-bottom:8px">1. Loaded Salary Excel Se Import Karein (' + esc(formatMonthLabel(state.selectedMonth)) + ')</div>';
    if (loadedFiles.length) {
      h += '        <div style="display:flex;gap:8px;flex-wrap:wrap">';
      h += '          <select id="spImportFileSel" style="flex:1;min-width:200px;padding:8px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;font-size:12px">';
      loadedFiles.forEach(function(f) { h += '<option value="' + esc(f.name) + '">' + esc(f.name) + '</option>'; });
      h += '          </select>';
      h += '          <button type="button" onclick="ATPLSalaryPayout.runFileImport()" style="padding:8px 14px;border:none;background:#1e293b;color:#fff;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer">Import &amp; Sync</button>';
      h += '        </div>';
    } else {
      h += '        <div style="font-size:11.5px;color:#64748b">Abhi software me koi Excel loaded nahi hai. Niche se sidha Excel upload karein ya target amounts set karein.</div>';
    }
    h += '        <div style="margin-top:10px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">';
    h += '          <input type="file" id="spDirectExcelInput" accept=".xlsx,.xls,.csv" onchange="ATPLSalaryPayout.handleDirectExcelUpload(this)" style="font-size:11.5px">';
    h += '        </div>';
    h += '      </div>';

    h += '      <div style="padding:12px;border:1px solid #e2e8f0;border-radius:10px">';
    h += '        <div style="font-size:12px;font-weight:800;color:#0f172a;margin-bottom:8px">2. Month Salary Targets (Manual Total Override)</div>';
    h += '        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">';
    h += '          <div><label style="display:block;font-size:11px;font-weight:700;color:#475569;margin-bottom:3px">Compliance Total (₹)</label><input type="number" id="spTgtComp" min="0" value="' + esc(summary.complianceTarget || '') + '" placeholder="Auto from sheet ya manual" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:8px;font-size:12.5px;font-weight:700;box-sizing:border-box"></div>';
    h += '          <div><label style="display:block;font-size:11px;font-weight:700;color:#475569;margin-bottom:3px">Diff Salary Target (₹)</label><input type="number" id="spTgtDiff" min="0" value="' + esc(summary.diffTarget || '') + '" placeholder="Auto from sheet ya manual" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:8px;font-size:12.5px;font-weight:700;box-sizing:border-box"></div>';
    h += '        </div>';
    h += '        <div style="margin-top:10px;display:flex;justify-content:flex-end"><button type="button" onclick="ATPLSalaryPayout.submitTargetsOnly()" style="padding:7px 14px;border:none;background:#0f766e;color:#fff;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer">Save Month Targets</button></div>';
    h += '      </div>';

    h += '      <div style="padding:12px;border:1px solid #e2e8f0;border-radius:10px">';
    h += '        <div style="font-size:12px;font-weight:800;color:#0f172a;margin-bottom:8px">3. Add / Edit Single Employee Month Salary</div>';
    h += '        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">';
    h += '          <input type="text" id="spOneCode" placeholder="Emp Code" style="padding:8px;border:1px solid #cbd5e1;border-radius:8px;font-size:12px;font-weight:700">';
    h += '          <input type="number" id="spOneComp" placeholder="Compliance ₹" min="0" style="padding:8px;border:1px solid #cbd5e1;border-radius:8px;font-size:12px">';
    h += '          <input type="number" id="spOneDiff" placeholder="Base Diff ₹" min="0" style="padding:8px;border:1px solid #cbd5e1;border-radius:8px;font-size:12px">';
    h += '        </div>';
    h += '        <div style="margin-top:8px;display:flex;justify-content:flex-end"><button type="button" onclick="ATPLSalaryPayout.submitSingleEmpSalary()" style="padding:7px 14px;border:1px solid #cbd5e1;background:#fff;color:#0f172a;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer">+ Save Emp Row</button></div>';
    h += '      </div>';
    h += '    </div>';
    h += '  </div>';
    h += '</div>';
    modal.innerHTML = h;
  }

  function runFileImport() {
    var sel = document.getElementById('spImportFileSel');
    if (!sel || !sel.value) return;
    var res = importFromLoadedFile(sel.value, state.selectedMonth);
    if (res.ok) closeModal();
  }

  function handleDirectExcelUpload(input) {
    var file = input && input.files && input.files[0];
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
        var rows = extractSalaryRowsFromWorkbook({ name: file.name, sheets: sheets });
        if (!rows.length) {
          if (window.showToast) window.showToast('⚠️ Excel me Emp Code aur Salary columns nahi mile.');
          return;
        }
        var res = bulkImportMonthSalaries(state.selectedMonth, rows, file.name);
        closeModal();
        if (window.showToast) window.showToast('✅ ' + res.imported + ' employees imported from ' + file.name);
      } catch (err) {
        if (window.showToast) window.showToast('⚠️ Excel read error: ' + err.message);
      }
    };
    reader.readAsArrayBuffer(file);
  }

  function submitTargetsOnly() {
    saveMonthSummary({
      monthKey: state.selectedMonth,
      complianceTarget: Number((document.getElementById('spTgtComp') || {}).value) || 0,
      diffTarget: Number((document.getElementById('spTgtDiff') || {}).value) || 0
    });
    closeModal();
    if (window.showToast) window.showToast('✅ Month salary targets saved & synced!');
  }

  function submitSingleEmpSalary() {
    var code = String((document.getElementById('spOneCode') || {}).value || '').trim();
    var comp = Number((document.getElementById('spOneComp') || {}).value) || 0;
    var diff = Number((document.getElementById('spOneDiff') || {}).value) || 0;
    if (!code) return;
    upsertEmpSalary({
      monthKey: state.selectedMonth,
      empCode: code,
      complianceAmount: comp,
      baseDiffAmount: diff
    });
    if (document.getElementById('spOneCode')) document.getElementById('spOneCode').value = '';
    if (document.getElementById('spOneComp')) document.getElementById('spOneComp').value = '';
    if (document.getElementById('spOneDiff')) document.getElementById('spOneDiff').value = '';
    if (window.showToast) window.showToast('✅ Employee ' + code + ' month salary saved!');
  }

  function printBatch(batchId) {
    var b = state.diffBatches[batchId];
    if (!b) return;
    var allocs = Array.isArray(b.allocations) ? b.allocations : [];
    var total = getBatchPaidTotal(b);
    var rowsHtml = allocs.map(function(al, idx) {
      var em = findEmployeeByCode(al.empCode) || {};
      return '<tr><td style="padding:6px 8px;border:1px solid #cbd5e1">' + (idx + 1) + '</td><td style="padding:6px 8px;border:1px solid #cbd5e1;font-family:monospace">' + esc(al.empCode) + '</td><td style="padding:6px 8px;border:1px solid #cbd5e1">' + esc(al.empName) + '</td><td style="padding:6px 8px;border:1px solid #cbd5e1;font-family:monospace">' + esc(em.accountNo || '-') + '</td><td style="padding:6px 8px;border:1px solid #cbd5e1;font-family:monospace">' + esc(em.ifsc || '-') + '</td><td style="padding:6px 8px;border:1px solid #cbd5e1;text-align:right;font-weight:700">' + formatINR(al.amount) + '</td></tr>';
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
        doc.write('<!doctype html><html><head><title>' + esc(b.title) + '</title></head><body style="font-family:sans-serif;padding:20px;color:#0f172a"><h2 style="margin:0 0 4px">ARORA TEXTILES PRIVATE LIMITED — DIFF PAYOUT SHEET</h2><div style="font-size:12px;margin-bottom:12px">' + esc(formatMonthLabel(b.monthKey)) + ' · <strong>' + esc(b.title) + '</strong> · Date: ' + esc(b.paymentDate) + ' · Mode: ' + esc(b.mode) + (b.signedBy ? (' · Signed: ' + esc(b.signedBy)) : '') + (b.utr ? (' · Ref: ' + esc(b.utr)) : '') + '</div><table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr style="background:#f1f5f9"><th style="padding:7px 8px;border:1px solid #cbd5e1;text-align:left">#</th><th style="padding:7px 8px;border:1px solid #cbd5e1;text-align:left">Emp Code</th><th style="padding:7px 8px;border:1px solid #cbd5e1;text-align:left">Name</th><th style="padding:7px 8px;border:1px solid #cbd5e1;text-align:left">Account No</th><th style="padding:7px 8px;border:1px solid #cbd5e1;text-align:left">IFSC</th><th style="padding:7px 8px;border:1px solid #cbd5e1;text-align:right">Amount (₹)</th></tr></thead><tbody>' + (rowsHtml || '<tr><td colspan="6" style="padding:12px;text-align:center;border:1px solid #cbd5e1">Lump-Sum Lot Payout</td></tr>') + '</tbody><tfoot><tr><td colspan="5" style="padding:8px;border:1px solid #cbd5e1;text-align:right;font-weight:800">TOTAL BATCH PAYOUT</td><td style="padding:8px;border:1px solid #cbd5e1;text-align:right;font-weight:800">' + formatINR(total) + '</td></tr></tfoot></table></body></html>');
        doc.close();
      }
      if (typeof setTimeout === 'function') setTimeout(function() { try { if (cw) { cw.focus(); cw.print(); } } catch (_) {} }, 180);
    } catch (_) {}
  }

  function promptReTransfer(returnId) {
    var r = state.returns[returnId];
    if (!r) return;
    openReturnModal(returnId, r.empCode);
    if (typeof setTimeout === 'function') setTimeout(function() {
      var st = document.getElementById('spRetStatus');
      if (st) st.value = 'RETRANSFERRED';
      var utrEl = document.getElementById('spRetUtr');
      if (utrEl && utrEl.focus) utrEl.focus();
    }, 30);
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
    h += '      <label style="font-size:11px;font-weight:700;color:#475569">Month:</label>';
    h += '      <input type="month" value="' + esc(state.selectedMonth) + '" onchange="ATPLSalaryPayout.setSelectedMonth(this.value)" style="height:34px;padding:0 10px;border:1px solid #cbd5e1;border-radius:8px;font-size:12px;font-weight:700;color:#0f172a;background:#fff">';
    if (months.length > 1) {
      h += '      <select onchange="ATPLSalaryPayout.setSelectedMonth(this.value)" style="height:34px;padding:0 10px;border:1px solid #cbd5e1;border-radius:8px;font-size:12px;font-weight:700;color:#334155;background:#fff">';
      months.forEach(function(mk) {
        h += '        <option value="' + esc(mk) + '"' + (mk === state.selectedMonth ? ' selected' : '') + '>' + esc(formatMonthLabel(mk)) + '</option>';
      });
      h += '      </select>';
    }
    h += '      <button type="button" onclick="ATPLSalaryPayout.openImportAndTargetsModal()" style="height:34px;padding:0 13px;border:1px solid #cbd5e1;background:#fff;color:#0f172a;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap">Import / Month Targets</button>';
    h += '      <button type="button" onclick="ATPLSalaryPayout.openPointModal()" style="height:34px;padding:0 13px;border:1px solid #c7d2fe;background:#eef2ff;color:#312e81;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap">+ Emp Point (+/-)</button>';
    h += '      <button type="button" onclick="ATPLSalaryPayout.openBatchModal()" style="height:34px;padding:0 14px;border:none;background:#0f172a;color:#fff;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap">+ Diff Batch (Part ' + (ledger.batches.length + 1) + ')</button>';
    h += '      <button type="button" onclick="ATPLSalaryPayout.syncNow(true)" style="height:34px;padding:0 12px;border:1px solid #cbd5e1;background:#f8fafc;color:#334155;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap">Sync</button>';
    h += '    </div>';
    h += '  </div>';

    // KPI Strip
    h += '  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(215px,1fr));gap:10px">';
    h += '    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:12px 14px">';
    h += '      <div style="font-size:11px;font-weight:700;color:#64748b">Total Month Salary (' + esc(formatMonthLabel(state.selectedMonth)) + ')</div>';
    h += '      <div style="font-size:21px;font-weight:800;color:#0f172a;margin-top:4px;font-variant-numeric:tabular-nums">' + formatINR(ledger.totalMonthSalary) + '</div>';
    h += '      <div style="font-size:11px;color:#475569;margin-top:3px">Compliance ' + formatINR(ledger.complianceTotal) + ' · Diff ' + formatINR(ledger.diffTotal) + '</div>';
    h += '    </div>';

    h += '    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:12px 14px">';
    h += '      <div style="font-size:11px;font-weight:700;color:#64748b">Compliance &amp; Bank Returns</div>';
    h += '      <div style="font-size:21px;font-weight:800;color:' + (ledger.pendingReturnCount > 0 ? '#b45309' : '#15803d') + ';margin-top:4px;font-variant-numeric:tabular-nums">' + (ledger.pendingReturnCount > 0 ? (ledger.pendingReturnCount + ' Return Pending') : (ledger.summary.complianceDisbursed ? 'All Clear' : '1-Time Ready')) + '</div>';
    h += '      <div style="font-size:11px;color:#475569;margin-top:3px">' + (ledger.pendingReturnCount > 0 ? ('Re-pay pending: ' + formatINR(ledger.pendingReturnTotal)) : (ledger.summary.complianceDate ? ('Paid on ' + esc(ledger.summary.complianceDate)) : 'Click Compliance tab to update')) + '</div>';
    h += '    </div>';

    h += '    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:12px 14px">';
    h += '      <div style="font-size:11px;font-weight:700;color:#64748b">Diff Multi-Part Paid</div>';
    h += '      <div style="font-size:21px;font-weight:800;color:#1d4ed8;margin-top:4px;font-variant-numeric:tabular-nums">' + formatINR(ledger.totalBatchPaid) + '</div>';
    h += '      <div style="font-size:11px;color:#475569;margin-top:3px">' + ledger.disbursedBatchCount + ' batches disbursed' + (ledger.totalBatchPlanned > 0 ? (' · ' + formatINR(ledger.totalBatchPlanned) + ' planned') : '') + '</div>';
    h += '    </div>';

    h += '    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:12px 14px">';
    h += '      <div style="font-size:11px;font-weight:700;color:#64748b">Diff Remaining &amp; Leftover</div>';
    h += '      <div style="font-size:21px;font-weight:800;color:' + (ledger.diffRemainingTotal > 0 ? '#dc2626' : '#15803d') + ';margin-top:4px;font-variant-numeric:tabular-nums">' + formatINR(ledger.diffRemainingTotal) + '</div>';
    h += '      <div style="font-size:11px;color:#475569;margin-top:3px">' + (ledger.smallLeftoverRows.length > 0 ? (ledger.smallLeftoverRows.length + ' small leftover (≤₹500): ' + formatINR(ledger.smallLeftoverTotal)) : 'No small leftover pending') + '</div>';
    h += '    </div>';

    h += '    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:12px 14px">';
    h += '      <div style="font-size:11px;font-weight:700;color:#64748b">Emp Adjustment Points (+/-)</div>';
    h += '      <div style="font-size:21px;font-weight:800;color:' + (ledger.netPointsImpact >= 0 ? '#15803d' : '#dc2626') + ';margin-top:4px;font-variant-numeric:tabular-nums">' + (ledger.netPointsImpact >= 0 ? '+' : '-') + formatINR(Math.abs(ledger.netPointsImpact)) + '</div>';
    h += '      <div style="font-size:11px;color:#475569;margin-top:3px">' + ledger.points.length + ' points · +' + formatINR(ledger.totalPlusPoints) + ' / -' + formatINR(ledger.totalMinusPoints) + '</div>';
    h += '    </div>';
    h += '  </div>';

    // Segmented Sub-Tab Bar + Search
    h += '  <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden">';
    h += '    <div style="padding:10px 14px;border-bottom:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;background:#f8fafc">';
    h += '      <div style="display:flex;gap:4px;padding:3px;background:#e2e8f0;border-radius:8px;flex-wrap:wrap">';
    var tabs = [
      { id: 'overview', label: 'Emp Ledger (' + ledger.rows.length + ')' },
      { id: 'points', label: 'Adjustment Points (' + ledger.points.length + ')' },
      { id: 'compliance', label: 'Compliance & Returns (' + ledger.returns.length + ')' },
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
          var hay = (r.empCode + ' ' + r.empName + ' ' + r.dept + ' ' + r.desig).toLowerCase();
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
        h += '      <div style="font-size:12px;margin-top:4px">Upar <strong>Import / Month Targets</strong> se salary Excel import karein ya <strong>+ Emp Point (+/-)</strong> se adjustments add karein.</div>';
        h += '    </div>';
      } else {
        h += '    <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px">';
        h += '      <thead><tr style="background:#f8fafc;border-bottom:1px solid #e2e8f0;color:#475569;font-size:11px;text-align:left"><th style="padding:9px 12px">Emp Code</th><th style="padding:9px 12px">Employee &amp; Dept</th><th style="padding:9px 12px;text-align:right">Compliance</th><th style="padding:9px 12px;text-align:right">Base Diff</th><th style="padding:9px 12px;text-align:right">Points (+/-)</th><th style="padding:9px 12px;text-align:right">Net Diff</th><th style="padding:9px 12px;text-align:right">Paid (Parts)</th><th style="padding:9px 12px;text-align:right">Diff Left</th><th style="padding:9px 12px;text-align:center">Actions</th></tr></thead>';
        h += '      <tbody>';
        filteredRows.forEach(function(r) {
          var netPt = round2(r.plusPoints - r.minusPoints);
          var ptLabel = netPt === 0 ? (r.noteCount ? (r.noteCount + ' note') : '—') : ((netPt > 0 ? '+' : '-') + formatINR(Math.abs(netPt)));
          h += '        <tr style="border-bottom:1px solid #f1f5f9">';
          h += '          <td style="padding:9px 12px;font-family:monospace;font-weight:800;color:#312e81">' + esc(r.empCode) + '</td>';
          h += '          <td style="padding:9px 12px"><div style="font-weight:700;color:#0f172a">' + esc(r.empName) + '</div><div style="font-size:11px;color:#64748b">' + esc(r.dept || '-') + (r.returnsPendingCount > 0 ? (' · <span style="color:#b45309;font-weight:700">Bank Return Pending</span>') : '') + '</div></td>';
          h += '          <td style="padding:9px 12px;text-align:right;font-variant-numeric:tabular-nums">' + formatINR(r.complianceAmount) + '</td>';
          h += '          <td style="padding:9px 12px;text-align:right;font-variant-numeric:tabular-nums">' + formatINR(r.baseDiffAmount) + '</td>';
          h += '          <td style="padding:9px 12px;text-align:right;font-variant-numeric:tabular-nums;font-weight:700;color:' + (netPt > 0 ? '#15803d' : netPt < 0 ? '#dc2626' : '#64748b') + '">' + esc(ptLabel) + '</td>';
          h += '          <td style="padding:9px 12px;text-align:right;font-variant-numeric:tabular-nums;font-weight:700">' + formatINR(r.netDiffAmount) + '</td>';
          h += '          <td style="padding:9px 12px;text-align:right;font-variant-numeric:tabular-nums;color:#1d4ed8;font-weight:700">' + formatINR(r.diffPaid) + '</td>';
          h += '          <td style="padding:9px 12px;text-align:right;font-variant-numeric:tabular-nums;font-weight:800;color:' + (r.isSmallLeftover ? '#c2410c' : r.diffRemaining > 0 ? '#dc2626' : '#15803d') + '">' + formatINR(r.diffRemaining) + (r.isSmallLeftover ? ' (Left)' : '') + '</td>';
          h += '          <td style="padding:9px 12px;text-align:center;white-space:nowrap">';
          h += '            <button type="button" onclick="ATPLSalaryPayout.openPointModal(null,\'' + esc(r.empCode) + '\')" style="padding:4px 8px;border:1px solid #c7d2fe;background:#eef2ff;color:#312e81;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;margin-right:4px">+ Point</button>';
          h += '            <button type="button" onclick="ATPLSalaryPayout.openReturnModal(null,\'' + esc(r.empCode) + '\')" style="padding:4px 8px;border:1px solid #fde68a;background:#fffbeb;color:#b45309;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer">Return</button>';
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

    // TAB 3: COMPLIANCE 1-TIME STATUS & BANK RETURN RE-TRANSFER
    if (state.activeTab === 'compliance') {
      var filteredRets = ledger.returns.filter(function(r) {
        if (!q) return true;
        return (r.empCode + ' ' + r.empName + ' ' + r.oldAccountNo + ' ' + r.newAccountNo + ' ' + r.reason).toLowerCase().indexOf(q) >= 0;
      });
      h += '    <div style="padding:14px 16px;border-bottom:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;background:#f8fafc">';
      h += '      <div>';
      h += '        <div style="font-size:13px;font-weight:800;color:#0f172a">Compliance Salary Status (' + esc(formatMonthLabel(state.selectedMonth)) + '): ' + (ledger.summary.complianceDisbursed ? '<span style="color:#15803d">1-Time Paid</span>' : '<span style="color:#475569">Pending Confirmation</span>') + ' · Total ' + formatINR(ledger.complianceTotal) + '</div>';
      h += '        <div style="font-size:11.5px;color:#64748b;margin-top:2px">' + (ledger.summary.complianceDate ? ('Transfer Date: ' + esc(ledger.summary.complianceDate) + (ledger.summary.complianceUtr ? (' · UTR: ' + esc(ledger.summary.complianceUtr)) : '')) : 'Compliance 1 baar me transfer hoti hai; agar kisi bank account se return aaye toh niche A/C change karke re-transfer record karein.') + '</div>';
      h += '      </div>';
      h += '      <div style="display:flex;gap:8px;flex-wrap:wrap">';
      h += '        <button type="button" onclick="ATPLSalaryPayout.promptComplianceComplete()" style="padding:7px 12px;border:1px solid #86efac;background:#f0fdf4;color:#15803d;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer">Mark Compliance Paid</button>';
      h += '        <button type="button" onclick="ATPLSalaryPayout.openReturnModal()" style="padding:7px 13px;border:none;background:#b45309;color:#fff;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer">+ Record Bank Return</button>';
      h += '      </div>';
      h += '    </div>';
      if (!filteredRets.length) {
        h += '    <div style="padding:34px 20px;text-align:center;color:#64748b;font-size:12.5px">Is mahine me koi Bank Return entry nahi hai.</div>';
      } else {
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
    }

    // TAB 4: DIFF MULTI-PART PAYOUT BATCHES (4-6+ PARTS / LEADERS / LEFTOVER)
    if (state.activeTab === 'diff') {
      var filteredBatches = ledger.batches.filter(function(b) {
        if (!q) return true;
        var hay = (b.title + ' ' + b.lotType + ' ' + b.utr + ' ' + b.notes + ' ' + (b.signedBy || '')).toLowerCase();
        return hay.indexOf(q) >= 0;
      });
      h += '    <div style="padding:12px 16px;border-bottom:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">';
      h += '      <div style="font-size:12px;color:#475569">Diff salary ko 4-6 parts/lots me manage karein (Workers ₹4-5L, Staff ₹1-2L, 2-3 Leaders Lot, aur small leftover ₹150 type clearance).</div>';
      h += '      <div style="display:flex;gap:8px;flex-wrap:wrap">';
      if (ledger.smallLeftoverRows.length > 0) {
        h += '        <button type="button" onclick="ATPLSalaryPayout.openBatchModal(null,\'LEFTOVER_CLEARANCE\')" style="padding:7px 12px;border:1px solid #fdba74;background:#fff7ed;color:#9a3412;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer">Leftover Clearance (' + ledger.smallLeftoverRows.length + ')</button>';
      }
      h += '        <button type="button" onclick="ATPLSalaryPayout.openBatchModal()" style="padding:7px 14px;border:none;background:#0f172a;color:#fff;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer">+ New Diff Batch (Part ' + (ledger.batches.length + 1) + ')</button>';
      h += '      </div>';
      h += '    </div>';
      if (!filteredBatches.length) {
        h += '    <div style="padding:36px 20px;text-align:center;color:#64748b;font-size:12.5px">Abhi ' + esc(formatMonthLabel(state.selectedMonth)) + ' me koi Diff Payout Batch nahi bana hai. Upar <strong>+ New Diff Batch</strong> par click karke Part 1, Part 2... banayein.</div>';
      } else {
        h += '    <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px">';
        h += '      <thead><tr style="background:#f8fafc;border-bottom:1px solid #e2e8f0;color:#475569;font-size:11px;text-align:left"><th style="padding:9px 12px">Part</th><th style="padding:9px 12px">Batch Title &amp; Lot Type</th><th style="padding:9px 12px">Date &amp; Mode</th><th style="padding:9px 12px">Employees</th><th style="padding:9px 12px;text-align:right">Batch Amount (₹)</th><th style="padding:9px 12px">Sign &amp; Status</th><th style="padding:9px 12px;text-align:center">Actions</th></tr></thead>';
        h += '      <tbody>';
        filteredBatches.forEach(function(b) {
          var amt = getBatchPaidTotal(b);
          var empCnt = Array.isArray(b.allocations) ? b.allocations.length : 0;
          var isPaid = b.status !== 'PLANNED';
          h += '        <tr style="border-bottom:1px solid #f1f5f9">';
          h += '          <td style="padding:9px 12px;font-weight:800;color:#312e81">Part ' + esc(b.partNumber) + '</td>';
          h += '          <td style="padding:9px 12px"><div style="font-weight:700;color:#0f172a">' + esc(b.title) + '</div><div style="font-size:11px;color:#64748b">' + esc(lotLabelMap[b.lotType] || b.lotType) + (b.notes ? (' · ' + esc(b.notes)) : '') + '</div></td>';
          h += '          <td style="padding:9px 12px"><div>' + esc(b.paymentDate) + '</div><div style="font-size:11px;color:#64748b">' + esc(b.mode) + (b.utr ? (' · ' + esc(b.utr)) : '') + '</div></td>';
          h += '          <td style="padding:9px 12px">' + (empCnt > 0 ? (empCnt + ' employees') : 'Lump-Sum Lot') + '</td>';
          h += '          <td style="padding:9px 12px;text-align:right;font-variant-numeric:tabular-nums;font-weight:800;color:#0f172a">' + formatINR(amt) + '</td>';
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
    version: '1.0.0',
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
    bulkImportMonthSalaries: bulkImportMonthSalaries,
    importFromLoadedFile: importFromLoadedFile,
    extractSalaryRowsFromWorkbook: extractSalaryRowsFromWorkbook,
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
    recalcBatchModalTotal: recalcBatchModalTotal,
    submitBatchModal: submitBatchModal,
    printBatch: printBatch,
    openImportAndTargetsModal: openImportAndTargetsModal,
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
