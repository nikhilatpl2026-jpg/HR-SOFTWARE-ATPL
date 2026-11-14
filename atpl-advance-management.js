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
  var STORAGE_KEY_PENDING_DIFF = 'ATPL_PendingDiffVouchersV1';
  var CLOUD_FILENAME = 'ATPL_ADVANCE_MANAGEMENT_DATA.json';
  var CHANNEL_NAME = 'ATPL_ERP_TRIGGER_BUS';
  var DEFAULT_GAS_URL = 'https://script.google.com/macros/s/AKfycbxiaKVtVJUWqDPtI-9iecG0LE817SfbbQNfUaZouw8sgYr3f1zRffutMu_UGnV-vqy-oA/exec';

  var SIGNED_BY_OPTIONS = ['Sarthak ji', 'Manish ji', 'Ayush ji'];
  var PENDING_DIFF_CATEGORIES = ['Pending Salary', 'Pending Advance', 'Diff Amount', 'F&F / Other Diff'];

  var state = {
    advances: [],
    deductions: [],
    pendingDiffs: [],
    tombstones: {},
    activeTab: 'advances', // 'advances' | 'deductions' | 'pending_diff' | 'ledger' | 'monthly'
    searchQuery: '',
    statusFilter: 'ALL', // 'ALL' | 'ACTIVE' | 'PARTIAL' | 'REPAID'
    deductionSourceFilter: 'ALL', // 'ALL' | 'salary' | 'manual' | 'voucher'
    pendingDiffStatusFilter: 'ALL', // 'ALL' | 'PENDING' | 'PARTIAL' | 'SETTLED'
    pendingDiffCategoryFilter: 'ALL',
    historySourceFilter: 'ALL', // 'ALL' | 'salary' | 'manual'
    selectedMonth: new Date().toISOString().slice(0, 7), // 'YYYY-MM'
    selectedDateFilter: '', // optional 'YYYY-MM-DD'
    filterTablesByMonth: false,
    openHistoryEmpCode: null,
    isSyncing: false,
    selectedAdvanceForModal: null,
    editingAdvanceId: null,
    editingPendingDiffId: null,
    monthFeedRows: [],
    pendingDiffFeedRows: []
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

  function isCashVoucherDeduction(d) {
    if (!d) return false;
    if (d.isCashVoucher) return true;
    var mode = String(d.deductionMode || d.columnName || '').toLowerCase();
    return mode.indexOf('cash voucher') >= 0;
  }

  function parseMonthYearToKey(str) {
    if (!str) return '';
    var s = String(str).trim().toLowerCase();
    var iso = s.match(/^(\d{4})-(\d{2})/);
    if (iso) return iso[1] + '-' + iso[2];
    var months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
    var shortMonths = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    var yrMatch = s.match(/(20\d{2})/);
    var yr = yrMatch ? yrMatch[1] : '';
    if (!yr) return '';
    for (var i = 0; i < months.length; i++) {
      if (s.indexOf(months[i]) >= 0 || new RegExp('(?:^|[^a-z])' + shortMonths[i] + '(?:[^a-z]|$)').test(s)) {
        return yr + '-' + String(i + 1).padStart(2, '0');
      }
    }
    return '';
  }

  function getAdvanceMonthKey(adv) {
    if (!adv) return '';
    var d = String(adv.advanceDate || adv.createdAt || '').trim();
    var m = d.match(/^(\d{4}-\d{2})/);
    return m ? m[1] : '';
  }

  function getDeductionMonthKey(d) {
    if (!d) return '';
    if (getDeductionSourceType(d) === 'manual') {
      var ds = getDeductionDateStr(d);
      if (ds && /^\d{4}-\d{2}/.test(ds)) return ds.slice(0, 7);
    }
    var fromSal = parseMonthYearToKey(d.salaryMonth || '');
    if (fromSal) return fromSal;
    var ds2 = getDeductionDateStr(d);
    return (ds2 && /^\d{4}-\d{2}/.test(ds2)) ? ds2.slice(0, 7) : '';
  }

  function getPreviousMonthKey(monthKey) {
    var m = String(monthKey || '').match(/^(\d{4})-(\d{2})$/);
    if (!m) {
      var now = new Date();
      now.setMonth(now.getMonth() - 1);
      return now.toISOString().slice(0, 7);
    }
    var y = parseInt(m[1], 10);
    var mo = parseInt(m[2], 10) - 1;
    if (mo <= 0) {
      mo = 12;
      y -= 1;
    }
    return y + '-' + String(mo).padStart(2, '0');
  }

  function formatMonthKeyLabel(monthKey) {
    var m = String(monthKey || '').match(/^(\d{4})-(\d{2})$/);
    if (!m) return monthKey || 'Selected Month';
    return formatMonthYearFromDate(m[1] + '-' + m[2] + '-01');
  }

  function getMonthAnalytics(monthKey, exactDate) {
    var selKey = /^\d{4}-\d{2}$/.test(String(monthKey || '')) ? String(monthKey) : new Date().toISOString().slice(0, 7);
    var prevKey = getPreviousMonthKey(selKey);

    function emptyBucket(key) {
      return {
        monthKey: key,
        label: formatMonthKeyLabel(key),
        givenTotal: 0,
        givenCount: 0,
        recoveredTotal: 0,
        salaryRecovered: 0,
        voucherRecovered: 0,
        manualOtherRecovered: 0,
        recCount: 0
      };
    }

    var sel = emptyBucket(selKey);
    var prev = emptyBucket(prevKey);
    var exact = exactDate ? { date: exactDate, givenTotal: 0, givenCount: 0, recoveredTotal: 0, recCount: 0 } : null;
    var empMonthly = {};

    function ensureEmp(code, name) {
      var norm = normalizeCode(code);
      if (!norm) return null;
      if (!empMonthly[norm]) {
        var master = findEmployeeByCode(code);
        empMonthly[norm] = {
          code: code,
          name: (master && master.name) || name || ('Emp ' + code),
          prevGiven: 0,
          prevRecovered: 0,
          selGiven: 0,
          selSalaryCut: 0,
          selVoucherCut: 0,
          selManualOtherCut: 0,
          selRecovered: 0,
          currentOutstanding: 0
        };
      }
      return empMonthly[norm];
    }

    (state.advances || []).forEach(function(a) {
      if (!a) return;
      var amt = round2(Number(a.amount) || 0);
      var bal = round2(Number(a.balanceAmount) || 0);
      var mk = getAdvanceMonthKey(a);
      var dStr = String(a.advanceDate || '').slice(0, 10);
      var eRow = ensureEmp(a.empCode, a.empName);
      if (eRow) eRow.currentOutstanding = round2(eRow.currentOutstanding + bal);

      if (mk === selKey) {
        sel.givenTotal = round2(sel.givenTotal + amt);
        sel.givenCount++;
        if (eRow) eRow.selGiven = round2(eRow.selGiven + amt);
      } else if (mk === prevKey) {
        prev.givenTotal = round2(prev.givenTotal + amt);
        prev.givenCount++;
        if (eRow) eRow.prevGiven = round2(eRow.prevGiven + amt);
      }
      if (exact && dStr === exact.date) {
        exact.givenTotal = round2(exact.givenTotal + amt);
        exact.givenCount++;
      }
    });

    (state.deductions || []).forEach(function(d) {
      if (!d || isDeductionTombstoned(d)) return;
      var amt = round2(Number(d.deductedAmount) || 0);
      var mk = getDeductionMonthKey(d);
      var dStr = getDeductionDateStr(d);
      var sType = getDeductionSourceType(d);
      var isVoucher = isCashVoucherDeduction(d);
      var eRow = ensureEmp(d.empCode, d.empName);

      if (mk === selKey) {
        sel.recoveredTotal = round2(sel.recoveredTotal + amt);
        sel.recCount++;
        if (sType === 'salary') {
          sel.salaryRecovered = round2(sel.salaryRecovered + amt);
          if (eRow) eRow.selSalaryCut = round2(eRow.selSalaryCut + amt);
        } else if (isVoucher) {
          sel.voucherRecovered = round2(sel.voucherRecovered + amt);
          if (eRow) eRow.selVoucherCut = round2(eRow.selVoucherCut + amt);
        } else {
          sel.manualOtherRecovered = round2(sel.manualOtherRecovered + amt);
          if (eRow) eRow.selManualOtherCut = round2(eRow.selManualOtherCut + amt);
        }
        if (eRow) eRow.selRecovered = round2(eRow.selRecovered + amt);
      } else if (mk === prevKey) {
        prev.recoveredTotal = round2(prev.recoveredTotal + amt);
        prev.recCount++;
        if (sType === 'salary') prev.salaryRecovered = round2(prev.salaryRecovered + amt);
        else if (isVoucher) prev.voucherRecovered = round2(prev.voucherRecovered + amt);
        else prev.manualOtherRecovered = round2(prev.manualOtherRecovered + amt);
        if (eRow) eRow.prevRecovered = round2(eRow.prevRecovered + amt);
      }
      if (exact && dStr === exact.date) {
        exact.recoveredTotal = round2(exact.recoveredTotal + amt);
        exact.recCount++;
      }
    });

    sel.pendingDiffTotal = 0;
    sel.pendingDiffPaid = 0;
    sel.pendingDiffBalance = 0;
    sel.pendingDiffCount = 0;
    prev.pendingDiffTotal = 0;
    prev.pendingDiffPaid = 0;
    prev.pendingDiffBalance = 0;
    prev.pendingDiffCount = 0;

    (state.pendingDiffs || []).forEach(function(p) {
      if (!p || isPendingDiffTombstoned(p)) return;
      var mk = getPendingDiffMonthKey(p);
      var amt = round2(Number(p.diffAmount) || 0);
      var paid = round2(Number(p.paidAmount) || 0);
      var bal = round2(Number(p.pendingBalance) || 0);
      var eRow = ensureEmp(p.empCode, p.empName);
      if (eRow) {
        if (typeof eRow.selPendingDiff !== 'number') eRow.selPendingDiff = 0;
        if (typeof eRow.prevPendingDiff !== 'number') eRow.prevPendingDiff = 0;
        if (typeof eRow.pendingDiffBalance !== 'number') eRow.pendingDiffBalance = 0;
        eRow.pendingDiffBalance = round2(eRow.pendingDiffBalance + bal);
      }
      if (mk === selKey) {
        sel.pendingDiffTotal = round2(sel.pendingDiffTotal + amt);
        sel.pendingDiffPaid = round2(sel.pendingDiffPaid + paid);
        sel.pendingDiffBalance = round2(sel.pendingDiffBalance + bal);
        sel.pendingDiffCount++;
        if (eRow) eRow.selPendingDiff = round2(eRow.selPendingDiff + amt);
      } else if (mk === prevKey) {
        prev.pendingDiffTotal = round2(prev.pendingDiffTotal + amt);
        prev.pendingDiffPaid = round2(prev.pendingDiffPaid + paid);
        prev.pendingDiffBalance = round2(prev.pendingDiffBalance + bal);
        prev.pendingDiffCount++;
        if (eRow) eRow.prevPendingDiff = round2(eRow.prevPendingDiff + amt);
      }
    });

    return {
      selected: sel,
      previous: prev,
      exactDate: exact,
      employees: Object.values(empMonthly).filter(function(r) {
        return r.prevGiven > 0 || r.prevRecovered > 0 || r.selGiven > 0 || r.selRecovered > 0 || (r.selPendingDiff || 0) > 0 || (r.prevPendingDiff || 0) > 0;
      })
    };
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

  function isPendingDiffTombstoned(p) {
    if (!p || !p.id) return true;
    var t = state.tombstones || {};
    var tombTs = t['pdiff:' + p.id] || t[p.id];
    if (!tombTs) return false;
    var rTs = Date.parse(p.updatedAt || p.createdAt || 0) || 0;
    var dTs = Date.parse(tombTs) || 0;
    return !rTs || dTs >= rTs;
  }

  function getPendingDiffMonthKey(p) {
    if (!p) return '';
    if (p.monthKey && /^\d{4}-\d{2}$/.test(String(p.monthKey).trim())) return String(p.monthKey).trim();
    var ds = String(p.entryDate || p.createdAt || '').trim();
    var m = ds.match(/^(\d{4}-\d{2})/);
    return m ? m[1] : '';
  }

  function normalizePendingDiffRecord(p) {
    if (!p || typeof p !== 'object') return p;
    var amt = round2(Number(p.diffAmount) || 0);
    var paid = 0;
    if (Array.isArray(p.settlements) && p.settlements.length > 0) {
      paid = round2(p.settlements.reduce(function(s, it) { return s + (Number(it && it.amount) || 0); }, 0));
    } else {
      paid = round2(Number(p.paidAmount) || 0);
    }
    if (paid > amt && amt > 0) paid = amt;
    var bal = Math.max(0, round2(amt - paid));
    var entryDate = String(p.entryDate || p.createdAt || new Date().toISOString().slice(0, 10)).slice(0, 10);
    var mk = getPendingDiffMonthKey({ monthKey: p.monthKey, entryDate: entryDate }) || entryDate.slice(0, 7);
    p.diffAmount = amt;
    p.paidAmount = paid;
    p.pendingBalance = bal;
    p.status = bal <= 0 ? 'SETTLED' : (paid > 0 ? 'PARTIAL' : 'PENDING');
    p.entryDate = entryDate;
    p.monthKey = mk;
    p.category = String(p.category || 'Pending Salary').trim() || 'Pending Salary';
    p.signedBy = String(p.signedBy || 'Sarthak ji').trim() || 'Sarthak ji';
    if (!Array.isArray(p.settlements)) p.settlements = [];
    return p;
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
      var rawPdiff = localStorage.getItem(STORAGE_KEY_PENDING_DIFF);
      if (rawPdiff) state.pendingDiffs = JSON.parse(rawPdiff) || [];
    } catch (_) {
      state.pendingDiffs = [];
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
      state.pendingDiffs = (state.pendingDiffs || []).filter(function(p) {
        return !isPendingDiffTombstoned(p);
      });
    }
    recalculateAllBalances();
  }

  function saveToLocal() {
    try {
      localStorage.setItem(STORAGE_KEY_ADVANCES, JSON.stringify(state.advances));
      localStorage.setItem(STORAGE_KEY_DEDUCTIONS, JSON.stringify(state.deductions));
      localStorage.setItem(STORAGE_KEY_PENDING_DIFF, JSON.stringify(state.pendingDiffs));
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
    state.pendingDiffs = (state.pendingDiffs || []).filter(function(p) {
      return !isPendingDiffTombstoned(p);
    }).map(function(p) {
      return normalizePendingDiffRecord(p);
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
    var remotePendingDiffs = Array.isArray(cloudData.pendingDiffs) ? cloudData.pendingDiffs : [];
    var remoteTombstones = cloudData.tombstones && typeof cloudData.tombstones === 'object' ? cloudData.tombstones : {};
    var remotePendingTombs = cloudData.pendingDiffTombstones && typeof cloudData.pendingDiffTombstones === 'object' ? cloudData.pendingDiffTombstones : {};

    Object.keys(remoteTombstones).forEach(function(k) {
      if (remoteTombstones[k]) state.tombstones[k] = remoteTombstones[k];
    });
    Object.keys(remotePendingTombs).forEach(function(k) {
      if (remotePendingTombs[k]) state.tombstones['pdiff:' + String(k).replace(/^pdiff:/, '')] = remotePendingTombs[k];
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

    state.pendingDiffs = (state.pendingDiffs || []).filter(function(p) {
      return !isPendingDiffTombstoned(p);
    });
    var pdiffMap = {};
    (state.pendingDiffs || []).forEach(function(p) {
      if (p && p.id) pdiffMap[p.id] = normalizePendingDiffRecord(p);
    });
    remotePendingDiffs.forEach(function(rp) {
      if (!rp || !rp.id || isPendingDiffTombstoned(rp)) return;
      var existingP = pdiffMap[rp.id];
      if (!existingP) {
        pdiffMap[rp.id] = normalizePendingDiffRecord(Object.assign({}, rp));
      } else {
        var lTs = Date.parse(existingP.updatedAt || existingP.createdAt || 0) || 0;
        var rTs = Date.parse(rp.updatedAt || rp.createdAt || 0) || 0;
        if (rTs >= lTs) {
          pdiffMap[rp.id] = normalizePendingDiffRecord(Object.assign({}, rp));
        }
      }
    });
    state.pendingDiffs = Object.values(pdiffMap).sort(function(a, b) {
      return String(b.entryDate || b.updatedAt || '').localeCompare(String(a.entryDate || a.updatedAt || ''));
    });
    return true;
  }

  var activePushPromise = null;
  var pendingPushQueued = false;
  function pushAuthoritativeToCloud() {
    if (activePushPromise) {
      pendingPushQueued = true;
      return activePushPromise;
    }
    activePushPromise = (async function() {
      var lastRes = { ok: false, error: 'CLOUD_UNCONFIRMED' };
      try {
        do {
          pendingPushQueued = false;
          var nowIso = new Date().toISOString();
          var pendingTombs = {};
          Object.keys(state.tombstones || {}).forEach(function(k) {
            if (String(k).indexOf('pdiff:') === 0 && state.tombstones[k]) {
              pendingTombs[k.slice(6)] = state.tombstones[k];
            }
          });
          var payload = {
            version: 4,
            advances: state.advances || [],
            deductions: state.deductions || [],
            pendingDiffs: state.pendingDiffs || [],
            tombstones: state.tombstones || {},
            pendingDiffTombstones: pendingTombs,
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

          try {
            fetch('/api/sync/pending-diffs/bulk', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ records: state.pendingDiffs || [], tombstones: pendingTombs })
            }).catch(function() {});
          } catch (_) {}

          broadcastSync('advance_cloud_synced', { ts: Date.now(), count: (state.advances || []).length, pendingDiffCount: (state.pendingDiffs || []).length });
          lastRes = { ok: confirmed, error: confirmed ? null : 'CLOUD_UNCONFIRMED' };
        } while (pendingPushQueued);
        return lastRes;
      } catch (err) {
        return { ok: false, error: err.message };
      } finally {
        activePushPromise = null;
        pendingPushQueued = false;
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

        try {
          var resPdiff = await fetch('/api/sync/pending-diffs', { cache: 'no-store' });
          if (resPdiff && resPdiff.ok) {
            var dataPdiff = await resPdiff.json();
            if (dataPdiff && dataPdiff.ok) {
              applyCloudData({
                advances: [],
                deductions: [],
                pendingDiffs: Array.isArray(dataPdiff.records) ? dataPdiff.records : [],
                pendingDiffTombstones: (dataPdiff.tombstones && typeof dataPdiff.tombstones === 'object') ? dataPdiff.tombstones : {}
              });
              cloudLoaded = true;
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

  async function pushPendingDiffRemote(record) {
    try {
      fetch('/api/sync/pending-diff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(record)
      }).catch(function() {});
    } catch (_) {}

    var res = await pushAuthoritativeToCloud();
    broadcastSync('pending_diff_saved', { id: record.id });
    return res;
  }

  async function deletePendingDiffRemote(id) {
    try {
      fetch('/api/sync/pending-diff/' + encodeURIComponent(id), {
        method: 'DELETE'
      }).catch(function() {});
    } catch (_) {}

    var res = await pushAuthoritativeToCloud();
    broadcastSync('pending_diff_deleted', { id: id });
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
          if (ev && ev.data && ev.data.action && (ev.data.action.indexOf('advance') === 0 || ev.data.action.indexOf('pending_diff') === 0)) {
            fetchRemoteAdvances(false);
          }
        };
      } catch (_) {}
    }

    window.addEventListener('storage', function(e) {
      if (e.key === 'ATPL_TRIGGER_EVENT' && e.newValue) {
        try {
          var ev = JSON.parse(e.newValue);
          if (ev && ev.action && (ev.action.indexOf('advance') === 0 || ev.action.indexOf('pending_diff') === 0)) {
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
        evtSrc.addEventListener('advance_deduction_deleted', function() { fetchRemoteAdvances(false); });
        evtSrc.addEventListener('advances_updated', function() { fetchRemoteAdvances(false); });
        evtSrc.addEventListener('pending_diff_saved', function() { fetchRemoteAdvances(false); });
        evtSrc.addEventListener('pending_diff_deleted', function() { fetchRemoteAdvances(false); });
        evtSrc.addEventListener('pending_diffs_updated', function() { fetchRemoteAdvances(false); });
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

  function deleteEmployeeLedger(empCode) {
    var norm = normalizeCode(empCode);
    if (!norm) return 0;

    var toDeleteAdvs = (state.advances || []).filter(function(a) {
      return a && normalizeCode(a.empCode) === norm;
    });
    var toDeleteDeds = (state.deductions || []).filter(function(d) {
      return d && normalizeCode(d.empCode) === norm;
    });
    if (!toDeleteAdvs.length && !toDeleteDeds.length) return 0;

    var empLabel = (toDeleteAdvs[0] && toDeleteAdvs[0].empName) || (toDeleteDeds[0] && toDeleteDeds[0].empName) || ('Emp ' + empCode);
    var nowIso = new Date().toISOString();
    var deletedAdvIds = [];

    toDeleteAdvs.forEach(function(a) {
      if (a && a.id) {
        state.tombstones[a.id] = nowIso;
        deletedAdvIds.push(a.id);
      }
    });
    toDeleteDeds.forEach(function(d) {
      if (d && d.id) {
        state.tombstones['ded:' + d.id] = nowIso;
      }
    });

    state.advances = (state.advances || []).filter(function(a) {
      return a && normalizeCode(a.empCode) !== norm;
    });
    state.deductions = (state.deductions || []).filter(function(d) {
      return d && normalizeCode(d.empCode) !== norm && !(d.advanceId && deletedAdvIds.indexOf(d.advanceId) >= 0);
    });

    if (state.openHistoryEmpCode && normalizeCode(state.openHistoryEmpCode) === norm) {
      closeModal();
    }

    recalculateAllBalances();
    saveToLocal();
    renderUI();

    deletedAdvIds.forEach(function(id) {
      try {
        fetch('/api/sync/advance/' + encodeURIComponent(id), { method: 'DELETE' }).catch(function() {});
      } catch (_) {}
    });

    pushAuthoritativeToCloud().then(function(res) {
      broadcastSync('advance_deleted', { empCode: empCode, ids: deletedAdvIds });
      if (window.showToast) {
        if (res && res.ok) {
          window.showToast('🗑 Deleted all advance records for ' + empLabel + ' (' + empCode + ') from cloud & all devices.');
        } else {
          window.showToast('⚠️ Deleted ' + empLabel + ' ledger locally. Cloud sync pending retry.');
        }
      }
    });

    return deletedAdvIds.length;
  }

  function confirmDeleteEmployeeLedger(empCode) {
    var norm = normalizeCode(empCode);
    var empAdvs = (state.advances || []).filter(function(a) {
      return a && normalizeCode(a.empCode) === norm;
    });
    if (!empAdvs.length) return;
    var empName = empAdvs[0].empName || ('Emp ' + empCode);
    var totalAmt = empAdvs.reduce(function(s, a) { return s + (Number(a.amount) || 0); }, 0);
    var totalBal = empAdvs.reduce(function(s, a) { return s + (Number(a.balanceAmount) || 0); }, 0);
    if (confirm('Delete ALL ' + empAdvs.length + ' advance record(s) & deduction history for ' + empName + ' (' + empCode + ')?\nTotal Disbursed: ' + formatINR(totalAmt) + ' | Outstanding: ' + formatINR(totalBal))) {
      deleteEmployeeLedger(empCode);
    }
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
    var signedBy = String(payload.signedBy || '').trim();
    var voucherNo = String(payload.voucherNo || '').trim();
    var isCashVoucher = !!(payload.isCashVoucher || mode.toLowerCase().indexOf('cash voucher') >= 0);
    var remarks = String(payload.remarks || '').trim();
    if (isCashVoucher && !remarks && signedBy) {
      remarks = 'Cash Voucher · Signed by ' + signedBy;
    }
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
        id: (isCashVoucher ? 'ded_cv_' : 'ded_man_') + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
        advanceId: adv.id,
        empCode: adv.empCode,
        empName: adv.empName || (emp ? emp.name : ('Emp ' + empCodeRaw)),
        sourceType: 'manual',
        deductionMode: mode,
        isCashVoucher: isCashVoucher,
        signedBy: signedBy,
        voucherNo: voucherNo,
        fileName: isCashVoucher
          ? ('Cash Voucher' + (signedBy ? ' (Signed by: ' + signedBy + ')' : ''))
          : ('Manual Deduction (' + mode + ')'),
        sheetName: isCashVoucher ? 'Cash Voucher' : 'Manual Entry',
        columnName: isCashVoucher ? 'Cash Voucher' : mode,
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

    if (created.length > 0 && !payload.skipRemoteSync) {
      recalculateAllBalances();
      saveToLocal();
      renderUI();

      created.forEach(function(recItem) {
        try {
          fetch('/api/sync/advance-deduction', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(recItem)
          }).catch(function() {});
        } catch (_) {}
      });

      pushAuthoritativeToCloud().then(function(res) {
        broadcastSync('advance_deduction_saved', { id: created[created.length - 1].id });
        if (window.showToast) {
          var labelTxt = isCashVoucher ? ('Cash Voucher of ' + formatINR(amount)) : ('Manual deduction of ' + formatINR(amount));
          if (res && res.ok) {
            window.showToast('✅ ' + labelTxt + ' for ' + created[0].empName + ' saved & synced!');
          } else {
            window.showToast('⚠️ ' + labelTxt + ' saved locally. Cloud sync pending retry.');
          }
        }
      });
    } else if (created.length > 0) {
      recalculateAllBalances();
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

    try {
      fetch('/api/sync/advance-deduction/' + encodeURIComponent(deductionId), {
        method: 'DELETE'
      }).catch(function() {});
    } catch (_) {}

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
    var voucherCutTotal = 0;
    var manualOtherCutTotal = 0;
    (state.deductions || []).forEach(function(d) {
      if (!d || isDeductionTombstoned(d)) return;
      var amt = Number(d.deductedAmount) || 0;
      var isMan = getDeductionSourceType(d) === 'manual';
      var isCv = isCashVoucherDeduction(d);
      if (isMan) {
        if (isCv) voucherCutTotal += amt;
        else manualOtherCutTotal += amt;
      } else {
        salaryCutTotal += amt;
      }

      var k = normalizeCode(d.empCode);
      if (empMap[k]) {
        empMap[k].dedCount++;
        if (isMan) empMap[k].manualRec += amt;
        else empMap[k].salaryRec += amt;
      }
    });
    var manualCutTotal = round2(voucherCutTotal + manualOtherCutTotal);
    var analytics = getMonthAnalytics(state.selectedMonth, state.selectedDateFilter);

    var pendingDiffList = (state.pendingDiffs || []).filter(function(p) { return p && !isPendingDiffTombstoned(p); });
    var totalPendingDiffAmt = 0;
    var totalPendingDiffBal = 0;
    var openPendingDiffCount = 0;
    pendingDiffList.forEach(function(p) {
      totalPendingDiffAmt = round2(totalPendingDiffAmt + (Number(p.diffAmount) || 0));
      var b = Number(p.pendingBalance) || 0;
      totalPendingDiffBal = round2(totalPendingDiffBal + b);
      if (b > 0) openPendingDiffCount++;
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
    html += '    <div style="font-size:11px;color:#64748b;margin-top:5px;max-width:760px;line-height:1.6">Arora Textiles ERP · Salary-Sheet Deduction, Cash Voucher, Pending Diff Amount, Month-Wise Data Feed aur Pichle Mahine ka Complete Audit.</div>';
    html += '  </div>';
    html += '  <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">';
    html += '    <button onclick="ATPLAdvanceManager.openNewModal()" style="display:inline-flex;align-items:center;gap:6px;padding:10px 15px;border-radius:9px;background:#312e81;color:#fff;font-size:11px;font-weight:800;border:none;cursor:pointer;box-shadow:0 1px 3px rgba(49,46,129,0.25)">';
    html += '      <span>💳</span> Record New Advance';
    html += '    </button>';
    html += '    <button onclick="ATPLAdvanceManager.openCashVoucherModal()" style="display:inline-flex;align-items:center;gap:6px;padding:10px 15px;border-radius:9px;background:#0f766e;color:#fff;font-size:11px;font-weight:800;border:none;cursor:pointer;box-shadow:0 1px 3px rgba(15,118,110,0.25)">';
    html += '      <span>🧾</span> Cash Voucher';
    html += '    </button>';
    html += '    <button onclick="ATPLAdvanceManager.openPendingDiffModal()" style="display:inline-flex;align-items:center;gap:6px;padding:10px 15px;border-radius:9px;background:#7c2d12;color:#fff;font-size:11px;font-weight:800;border:none;cursor:pointer;box-shadow:0 1px 3px rgba(124,45,18,0.25)">';
    html += '      <span>⏳</span> Pending Diff / Cash Adv Voucher';
    html += '    </button>';
    html += '    <button onclick="ATPLAdvanceManager.openMonthFeedModal()" style="display:inline-flex;align-items:center;gap:6px;padding:10px 15px;border-radius:9px;background:#4338ca;color:#fff;font-size:11px;font-weight:800;border:none;cursor:pointer;box-shadow:0 1px 3px rgba(67,56,202,0.25)">';
    html += '      <span>📅</span> Month-Wise Feed';
    html += '    </button>';
    html += '    <button onclick="ATPLAdvanceManager.openManualDeductionModal()" style="display:inline-flex;align-items:center;gap:6px;padding:10px 14px;border-radius:9px;background:#b45309;color:#fff;font-size:11px;font-weight:800;border:none;cursor:pointer;box-shadow:0 1px 3px rgba(180,83,9,0.25)">';
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
    html += '    <span style="font-size:9px;color:#94a3b8">Advances Register, All Deductions, Pending Diff Amount (Cash Adv Voucher), Employee Ledger, aur Month-Wise Report</span>';
    html += '  </div>';
    html += '  <div style="display:flex;gap:4px;background:#f3f4f6;padding:3px;border-radius:9px;flex-wrap:wrap">';
    html += '    <button onclick="ATPLAdvanceManager.setTab(\'advances\')" style="border:0;background:' + (state.activeTab === 'advances' ? '#312e81' : 'transparent') + ';color:' + (state.activeTab === 'advances' ? '#fff' : '#64748b') + ';border-radius:7px;padding:6px 13px;font-size:10px;font-weight:850;cursor:pointer;' + (state.activeTab === 'advances' ? 'box-shadow:0 1px 2px rgba(15,23,42,.12)' : '') + '">₹ Advances Register (' + state.advances.length + ')</button>';
    html += '    <button onclick="ATPLAdvanceManager.setTab(\'deductions\')" style="border:0;background:' + (state.activeTab === 'deductions' ? '#312e81' : 'transparent') + ';color:' + (state.activeTab === 'deductions' ? '#fff' : '#64748b') + ';border-radius:7px;padding:6px 13px;font-size:10px;font-weight:850;cursor:pointer;' + (state.activeTab === 'deductions' ? 'box-shadow:0 1px 2px rgba(15,23,42,.12)' : '') + '">📉 All Deductions (' + state.deductions.length + ')</button>';
    html += '    <button onclick="ATPLAdvanceManager.setTab(\'pending_diff\')" style="border:0;background:' + (state.activeTab === 'pending_diff' ? '#7c2d12' : 'transparent') + ';color:' + (state.activeTab === 'pending_diff' ? '#fff' : '#7c2d12') + ';border-radius:7px;padding:6px 13px;font-size:10px;font-weight:850;cursor:pointer;' + (state.activeTab === 'pending_diff' ? 'box-shadow:0 1px 2px rgba(15,23,42,.12)' : '') + '">⏳ Pending Diff Amount (' + pendingDiffList.length + ')</button>';
    html += '    <button onclick="ATPLAdvanceManager.setTab(\'ledger\')" style="border:0;background:' + (state.activeTab === 'ledger' ? '#312e81' : 'transparent') + ';color:' + (state.activeTab === 'ledger' ? '#fff' : '#64748b') + ';border-radius:7px;padding:6px 13px;font-size:10px;font-weight:850;cursor:pointer;' + (state.activeTab === 'ledger' ? 'box-shadow:0 1px 2px rgba(15,23,42,.12)' : '') + '">👥 Employee Ledger (' + Object.keys(empMap).length + ')</button>';
    html += '    <button onclick="ATPLAdvanceManager.setTab(\'monthly\')" style="border:0;background:' + (state.activeTab === 'monthly' ? '#312e81' : 'transparent') + ';color:' + (state.activeTab === 'monthly' ? '#fff' : '#64748b') + ';border-radius:7px;padding:6px 13px;font-size:10px;font-weight:850;cursor:pointer;' + (state.activeTab === 'monthly' ? 'box-shadow:0 1px 2px rgba(15,23,42,.12)' : '') + '">📅 Month-Wise Summary</button>';
    html += '  </div>';
    html += '</div>';

    // 3. Month / Date Selector & Previous Month Comparison Strip
    html += '<div style="margin-bottom:12px;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:12px 14px;display:flex;flex-direction:column;gap:10px">';
    html += '  <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">';
    html += '    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">';
    html += '      <span style="font-size:11px;font-weight:800;color:#1e293b">📅 Month / Date Check (Pichle Mahine ka Hisab):</span>';
    html += '      <button type="button" onclick="ATPLAdvanceManager.shiftSelectedMonth(-1)" style="height:30px;padding:0 9px;border:1px solid #d1d5db;background:#f8fafc;color:#334155;border-radius:7px;font-size:11px;font-weight:700;cursor:pointer" title="Previous Month">◀</button>';
    html += '      <input type="month" id="advMonthPicker" value="' + esc(analytics.selected.monthKey) + '" onchange="ATPLAdvanceManager.setSelectedMonth(this.value)" style="height:30px;padding:0 9px;border:1px solid #cbd5e1;border-radius:7px;font-size:11px;font-weight:700;color:#111827;background:#fff">';
    html += '      <button type="button" onclick="ATPLAdvanceManager.shiftSelectedMonth(1)" style="height:30px;padding:0 9px;border:1px solid #d1d5db;background:#f8fafc;color:#334155;border-radius:7px;font-size:11px;font-weight:700;cursor:pointer" title="Next Month">▶</button>';
    html += '      <span style="font-size:10px;color:#64748b;font-weight:700">or Date:</span>';
    html += '      <input type="date" id="advDatePicker" value="' + esc(state.selectedDateFilter || '') + '" onchange="ATPLAdvanceManager.setSelectedDate(this.value)" style="height:30px;padding:0 9px;border:1px solid #cbd5e1;border-radius:7px;font-size:11px;font-weight:700;color:#111827;background:#fff">';
    if (state.selectedDateFilter) {
      html += '      <button type="button" onclick="ATPLAdvanceManager.setSelectedDate(\'\')" style="height:28px;padding:0 8px;border:1px solid #fecaca;background:#fef2f2;color:#dc2626;border-radius:6px;font-size:10px;font-weight:700;cursor:pointer">✕ Clear Date</button>';
    }
    html += '    </div>';
    html += '    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">';
    html += '      <label style="display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:700;color:#475569;cursor:pointer;background:#f8fafc;border:1px solid #e2e8f0;padding:5px 10px;border-radius:7px">';
    html += '        <input type="checkbox" ' + (state.filterTablesByMonth ? 'checked' : '') + ' onchange="ATPLAdvanceManager.toggleFilterTablesByMonth(this.checked)">';
    html += '        <span>Filter Tables to ' + esc(analytics.selected.label) + '</span>';
    html += '      </label>';
    html += '      <button type="button" onclick="ATPLAdvanceManager.openMonthFeedModal(\'' + esc(analytics.selected.monthKey) + '\')" style="height:30px;padding:0 12px;border:none;background:#eef2ff;color:#312e81;border:1px solid #c7d2fe;border-radius:7px;font-size:11px;font-weight:800;cursor:pointer">➕ Feed Data for ' + esc(analytics.selected.label) + '</button>';
    html += '    </div>';
    html += '  </div>';

    html += '  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px">';
    // Selected Month Card
    html += '    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:10px 14px;display:flex;justify-content:space-between;align-items:center;gap:12px">';
    html += '      <div>';
    html += '        <div style="font-size:9.5px;font-weight:800;color:#4338ca;text-transform:uppercase;letter-spacing:0.6px">Selected Month · ' + esc(analytics.selected.label) + '</div>';
    html += '        <div style="font-size:12px;color:#334155;margin-top:3px">Given: <strong style="color:#111827">' + formatINR(analytics.selected.givenTotal) + '</strong> <span style="font-size:10px;color:#64748b">(' + analytics.selected.givenCount + ')</span></div>';
    html += '        <div style="font-size:12px;color:#334155;margin-top:2px">Recovered: <strong style="color:#15803d">' + formatINR(analytics.selected.recoveredTotal) + '</strong> <span style="font-size:10px;color:#64748b">(' + analytics.selected.recCount + ' cuts)</span></div>';
    html += '      </div>';
    html += '      <div style="text-align:right;font-size:10px;color:#64748b;line-height:1.5">';
    html += '        <div>Sheet: <strong style="color:#312e81">' + formatINR(analytics.selected.salaryRecovered) + '</strong></div>';
    html += '        <div>Cash Voucher: <strong style="color:#0f766e">' + formatINR(analytics.selected.voucherRecovered) + '</strong></div>';
    html += '        <div>Other Manual: <strong style="color:#b45309">' + formatINR(analytics.selected.manualOtherRecovered) + '</strong></div>';
    html += '      </div>';
    html += '    </div>';
    // Previous Month (Pichla Mahina) Card
    html += '    <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:10px 14px;display:flex;justify-content:space-between;align-items:center;gap:12px">';
    html += '      <div>';
    html += '        <div style="font-size:9.5px;font-weight:800;color:#b45309;text-transform:uppercase;letter-spacing:0.6px">Pichla Mahina (Previous Month) · ' + esc(analytics.previous.label) + '</div>';
    html += '        <div style="font-size:12px;color:#334155;margin-top:3px">Kitna Adv Diya: <strong style="color:#111827">' + formatINR(analytics.previous.givenTotal) + '</strong> <span style="font-size:10px;color:#64748b">(' + analytics.previous.givenCount + ')</span></div>';
    html += '        <div style="font-size:12px;color:#334155;margin-top:2px">Kitna Recover Hua: <strong style="color:#15803d">' + formatINR(analytics.previous.recoveredTotal) + '</strong> <span style="font-size:10px;color:#64748b">(' + analytics.previous.recCount + ' cuts)</span></div>';
    html += '      </div>';
    html += '      <div style="text-align:right;font-size:10px;color:#64748b;line-height:1.5">';
    html += '        <div>Sheet: <strong style="color:#312e81">' + formatINR(analytics.previous.salaryRecovered) + '</strong></div>';
    html += '        <div>Cash Voucher: <strong style="color:#0f766e">' + formatINR(analytics.previous.voucherRecovered) + '</strong></div>';
    html += '        <div>Net Diff: <strong style="color:' + (analytics.previous.givenTotal - analytics.previous.recoveredTotal > 0 ? '#dc2626' : '#15803d') + '">' + formatINR(round2(analytics.previous.givenTotal - analytics.previous.recoveredTotal)) + '</strong></div>';
    html += '      </div>';
    html += '    </div>';
    html += '  </div>';

    if (analytics.exactDate) {
      html += '  <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:7px 12px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;font-size:11px;color:#1e3a8a">';
      html += '    <span>📌 <strong>Selected Date (' + esc(analytics.exactDate.date) + '):</strong> Advance Given: <strong>' + formatINR(analytics.exactDate.givenTotal) + '</strong> (' + analytics.exactDate.givenCount + ') · Recovered / Voucher Cut: <strong style="color:#15803d">' + formatINR(analytics.exactDate.recoveredTotal) + '</strong> (' + analytics.exactDate.recCount + ')</span>';
      html += '    <span style="font-size:10px;color:#3b82f6">Showing ' + esc(analytics.selected.label) + ' vs ' + esc(analytics.previous.label) + '</span>';
      html += '  </div>';
    }
    html += '</div>';

    // 4. Metric Statistic Cards
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(175px,1fr));gap:10px;margin-bottom:12px">';
    html += '  <div style="background:#fff;border:1px solid #e5e7eb;border-radius:11px;padding:12px 14px;display:flex;flex-direction:column;gap:4px;box-shadow:0 1px 2px rgba(15,23,42,.02)">';
    html += '    <span style="font-size:9px;text-transform:uppercase;letter-spacing:.8px;color:#64748b;font-weight:800">Total Disbursed</span>';
    html += '    <b style="font-size:20px;font-weight:850;color:#111827">' + formatINR(totalDisbursed) + '</b>';
    html += '    <small style="font-size:9px;color:#94a3b8">' + state.advances.length + ' lifetime advances</small>';
    html += '  </div>';
    html += '  <div style="background:#fff;border:1px solid #e5e7eb;border-radius:11px;padding:12px 14px;display:flex;flex-direction:column;gap:4px;box-shadow:0 1px 2px rgba(15,23,42,.02)">';
    html += '    <span style="font-size:9px;text-transform:uppercase;letter-spacing:.8px;color:#64748b;font-weight:800">Total Recovered</span>';
    html += '    <b style="font-size:20px;font-weight:850;color:#15803d">' + formatINR(totalRecovered) + '</b>';
    html += '    <small style="font-size:9px;color:#94a3b8">Sheet: ' + formatINR(salaryCutTotal) + ' · Voucher: ' + formatINR(voucherCutTotal) + ' · Manual: ' + formatINR(manualOtherCutTotal) + '</small>';
    html += '  </div>';
    html += '  <div style="background:#fff;border:1px solid #fecaca;border-radius:11px;padding:12px 14px;display:flex;flex-direction:column;gap:4px;box-shadow:0 1px 2px rgba(15,23,42,.02)">';
    html += '    <span style="font-size:9px;text-transform:uppercase;letter-spacing:.8px;color:#dc2626;font-weight:800">Outstanding Balance</span>';
    html += '    <b style="font-size:20px;font-weight:850;color:#dc2626">' + formatINR(totalOutstanding) + '</b>';
    html += '    <small style="font-size:9px;color:#ef4444">pending recovery</small>';
    html += '  </div>';
    html += '  <div onclick="ATPLAdvanceManager.setTab(\'pending_diff\')" style="cursor:pointer;background:#fff7ed;border:1px solid #fed7aa;border-radius:11px;padding:12px 14px;display:flex;flex-direction:column;gap:4px;box-shadow:0 1px 2px rgba(15,23,42,.02)">';
    html += '    <span style="font-size:9px;text-transform:uppercase;letter-spacing:.8px;color:#9a3412;font-weight:800">Pending Diff Balance</span>';
    html += '    <b style="font-size:20px;font-weight:850;color:#7c2d12">' + formatINR(totalPendingDiffBal) + '</b>';
    html += '    <small style="font-size:9px;color:#c2410c">' + openPendingDiffCount + ' open · ' + formatINR(totalPendingDiffAmt) + ' total diff</small>';
    html += '  </div>';
    html += '  <div style="background:#fff;border:1px solid #e5e7eb;border-radius:11px;padding:12px 14px;display:flex;flex-direction:column;gap:4px;box-shadow:0 1px 2px rgba(15,23,42,.02)">';
    html += '    <span style="font-size:9px;text-transform:uppercase;letter-spacing:.8px;color:#64748b;font-weight:800">Active Borrowers</span>';
    html += '    <b style="font-size:20px;font-weight:850;color:#312e81">' + activeCount + '</b>';
    html += '    <small style="font-size:9px;color:#94a3b8">across ' + Object.keys(empMap).length + ' employees with history</small>';
    html += '  </div>';
    html += '</div>';

    // 5. Toolbar
    var tabTitle = state.activeTab === 'advances'
      ? 'Advances Register &amp; Active Dues'
      : state.activeTab === 'deductions'
        ? 'Salary, Cash Voucher &amp; Manual Deduction Audit'
        : state.activeTab === 'pending_diff'
          ? 'Pending Diff Amount &amp; Cash Adv Vouchers (Directors Signed · Month-Wise)'
          : state.activeTab === 'monthly'
            ? ('Month-Wise Report: ' + esc(analytics.selected.label) + ' vs ' + esc(analytics.previous.label))
            : 'Employee Balance Ledger &amp; History';
    html += '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;background:#fff;border:1px solid #e5e7eb;border-radius:10px 10px 0 0;padding:11px 14px">';
    html += '  <div style="display:flex;flex-direction:column;gap:2px">';
    html += '    <b style="font-size:11px;color:#334155">' + tabTitle + (state.filterTablesByMonth && state.activeTab !== 'monthly' ? ' <span style="color:#4338ca">(' + esc(analytics.selected.label) + ')</span>' : '') + '</b>';
    html += '    <small style="font-size:9px;color:#94a3b8">Verified records · Cash Voucher, Pending Diff Amount (Directors Sign), Month-Wise Feed aur Employee History ke saath complete sync</small>';
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
      html += '      <option value="ALL"' + (state.deductionSourceFilter === 'ALL' ? ' selected' : '') + '>All Cut Types (Salary + Voucher + Manual)</option>';
      html += '      <option value="salary"' + (state.deductionSourceFilter === 'salary' ? ' selected' : '') + '>📄 Salary Sheet Only</option>';
      html += '      <option value="voucher"' + (state.deductionSourceFilter === 'voucher' ? ' selected' : '') + '>🧾 Cash Voucher Only</option>';
      html += '      <option value="manual"' + (state.deductionSourceFilter === 'manual' ? ' selected' : '') + '>✍️ All Manual / Cash Voucher</option>';
      html += '    </select>';
    } else if (state.activeTab === 'pending_diff') {
      html += '    <select onchange="ATPLAdvanceManager.setPendingDiffCategoryFilter(this.value)" style="height:32px;border:1px solid #d1d5db;border-radius:7px;background:#fff;padding:0 10px;font-size:10px;font-weight:700;color:#475569;cursor:pointer">';
      html += '      <option value="ALL"' + (state.pendingDiffCategoryFilter === 'ALL' ? ' selected' : '') + '>All Types (Salary / Adv / Diff)</option>';
      PENDING_DIFF_CATEGORIES.forEach(function(cat) {
        html += '      <option value="' + esc(cat) + '"' + (state.pendingDiffCategoryFilter === cat ? ' selected' : '') + '>' + esc(cat) + '</option>';
      });
      html += '    </select>';
      html += '    <select onchange="ATPLAdvanceManager.setPendingDiffStatusFilter(this.value)" style="height:32px;border:1px solid #d1d5db;border-radius:7px;background:#fff;padding:0 10px;font-size:10px;font-weight:700;color:#475569;cursor:pointer">';
      html += '      <option value="ALL"' + (state.pendingDiffStatusFilter === 'ALL' ? ' selected' : '') + '>All Status</option>';
      html += '      <option value="PENDING"' + (state.pendingDiffStatusFilter === 'PENDING' ? ' selected' : '') + '>⏳ Pending Only</option>';
      html += '      <option value="PARTIAL"' + (state.pendingDiffStatusFilter === 'PARTIAL' ? ' selected' : '') + '>🌓 Partial Paid</option>';
      html += '      <option value="SETTLED"' + (state.pendingDiffStatusFilter === 'SETTLED' ? ' selected' : '') + '>✅ Settled / Paid</option>';
      html += '    </select>';
      html += '    <button type="button" onclick="ATPLAdvanceManager.openPendingDiffModal()" style="height:32px;padding:0 12px;border:none;border-radius:7px;background:#7c2d12;color:#fff;font-size:10px;font-weight:800;cursor:pointer">+ Add Pending Diff</button>';
      html += '    <button type="button" onclick="ATPLAdvanceManager.openPendingDiffFeedModal()" style="height:32px;padding:0 12px;border:1px solid #fdba74;border-radius:7px;background:#fff7ed;color:#9a3412;font-size:10px;font-weight:800;cursor:pointer">📋 Bulk Month Entry</button>';
    }
    html += '  </div>';
    html += '</div>';

    // 6. Table Body Container
    html += '<div style="background:#fff;border:1px solid #e5e7eb;border-top:0;border-radius:0 0 10px 10px;overflow:hidden;box-shadow:0 1px 3px rgba(15,23,42,.02)">';
    if (state.activeTab === 'advances') {
      html += renderAdvancesTable();
    } else if (state.activeTab === 'deductions') {
      html += renderDeductionsTable();
    } else if (state.activeTab === 'pending_diff') {
      html += renderPendingDiffsTab(analytics);
    } else if (state.activeTab === 'monthly') {
      html += renderMonthlySummaryTable(analytics);
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
      if (state.filterTablesByMonth && getAdvanceMonthKey(a) !== state.selectedMonth) return false;
      if (state.selectedDateFilter && String(a.advanceDate || '').slice(0, 10) !== state.selectedDateFilter) return false;
      if (!query) return true;
      return String(a.empCode || '').toLowerCase().includes(query) ||
             String(a.empName || '').toLowerCase().includes(query) ||
             String(a.remarks || '').toLowerCase().includes(query);
    });

    if (!filtered.length) {
      return '<div style="padding:48px 20px;text-align:center;color:#94a3b8;background:#fff">' +
             '  <div style="font-size:36px;margin-bottom:8px;opacity:0.4">💳</div>' +
             '  <div style="font-size:14px;font-weight:700;color:#334155">No Advance Records Found</div>' +
             '  <div style="font-size:11px;margin-top:4px;color:#94a3b8">Click "Record New Advance" or "Month-Wise Feed" above to record employee advances.</div>' +
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
        html += '        <button onclick="ATPLAdvanceManager.openCashVoucherModal(\'' + esc(adv.empCode) + '\',\'' + esc(adv.id) + '\')" style="height:26px;padding:0 8px;border:1px solid #99f6e4;background:#f0fdfa;color:#0f766e;border-radius:6px;cursor:pointer;font-size:10px;font-weight:800;margin-right:4px" title="Cash Voucher se Advance Minus Karein">🧾 Voucher</button>';
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
      var isCv = isCashVoucherDeduction(d);
      if (state.deductionSourceFilter === 'voucher') {
        if (!isCv) return false;
      } else if (state.deductionSourceFilter !== 'ALL' && sType !== state.deductionSourceFilter) {
        return false;
      }
      if (state.filterTablesByMonth && getDeductionMonthKey(d) !== state.selectedMonth) return false;
      if (state.selectedDateFilter && getDeductionDateStr(d) !== state.selectedDateFilter) return false;
      if (!query) return true;
      return String(d.empCode || '').toLowerCase().includes(query) ||
             String(d.empName || '').toLowerCase().includes(query) ||
             String(d.fileName || '').toLowerCase().includes(query) ||
             String(d.sheetName || '').toLowerCase().includes(query) ||
             String(d.columnName || '').toLowerCase().includes(query) ||
             String(d.signedBy || '').toLowerCase().includes(query) ||
             String(d.remarks || '').toLowerCase().includes(query) ||
             String(d.salaryMonth || '').toLowerCase().includes(query);
    }).slice().sort(function(a, b) {
      return (Date.parse(b.deductionDate || b.date || 0) || 0) - (Date.parse(a.deductionDate || a.date || 0) || 0);
    });

    if (!filtered.length) {
      return '<div style="padding:48px 20px;text-align:center;color:#94a3b8;background:#fff">' +
             '  <div style="font-size:36px;margin-bottom:8px;opacity:0.4">📉</div>' +
             '  <div style="font-size:14px;font-weight:700;color:#334155">No Advance Deductions Found</div>' +
             '  <div style="font-size:11px;margin-top:4px;color:#94a3b8">Salary sheets with an Advance column, Cash Vouchers, or Manual Deductions will appear here.</div>' +
             '</div>';
    }

    var html = '<div style="overflow-x:auto">';
    html += '<table style="width:100%;border-collapse:collapse;font-size:12px;text-align:left;background:#fff">';
    html += '  <thead>';
    html += '    <tr style="background:#fff;border-bottom:1px solid #eef2f7;color:#64748b;font-size:9.5px;text-transform:uppercase;letter-spacing:0.8px;font-weight:800">';
    html += '      <th style="padding:10px 14px">Date</th>';
    html += '      <th style="padding:10px 14px">Cut Type</th>';
    html += '      <th style="padding:10px 14px">Source (File / Voucher / Signed By / Remarks)</th>';
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
      var isCv = isCashVoucherDeduction(d);
      var typeBadge = isCv
        ? '<span style="display:inline-block;padding:3px 8px;border-radius:999px;font-size:9px;font-weight:850;background:#f0fdfa;color:#0f766e;border:1px solid #99f6e4">🧾 CASH VOUCHER</span>'
        : sType === 'manual'
          ? '<span style="display:inline-block;padding:3px 8px;border-radius:999px;font-size:9px;font-weight:850;background:#fffbeb;color:#b45309;border:1px solid #fde68a">✍️ MANUAL</span>'
          : '<span style="display:inline-block;padding:3px 8px;border-radius:999px;font-size:9px;font-weight:850;background:#eef2ff;color:#312e81;border:1px solid #c7d2fe">📄 SALARY SHEET</span>';

      var sourceHtml = '';
      if (isCv) {
        sourceHtml += '<div style="font-weight:700;color:#0f766e">Cash Voucher' + (d.signedBy ? ' · Signed by: ' + esc(d.signedBy) : '') + '</div>';
        sourceHtml += '<div style="font-size:10px;color:#64748b">' + esc(d.remarks || 'Voucher settled') + '</div>';
      } else if (sType === 'manual') {
        sourceHtml += '<div style="font-weight:700;color:#111827">' + esc(d.deductionMode || d.columnName || 'Manual Deduction') + (d.signedBy ? ' · Signed by: ' + esc(d.signedBy) : '') + '</div>';
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

  function renderMonthlySummaryTable(analytics) {
    var query = state.searchQuery.toLowerCase().trim();
    var list = (analytics && Array.isArray(analytics.employees) ? analytics.employees : []).filter(function(r) {
      if (!query) return true;
      return String(r.code || '').toLowerCase().includes(query) ||
             String(r.name || '').toLowerCase().includes(query);
    });

    if (!list.length) {
      return '<div style="padding:44px 20px;text-align:center;color:#94a3b8;background:#fff">' +
             '  <div style="font-size:34px;margin-bottom:8px;opacity:0.45">📅</div>' +
             '  <div style="font-size:14px;font-weight:700;color:#334155">No Activity in ' + esc(analytics.selected.label) + ' or ' + esc(analytics.previous.label) + '</div>' +
             '  <div style="font-size:11px;margin-top:4px;color:#94a3b8">Is mahine ya pichle mahine ka data feed karne ke liye "Month-Wise Feed" button par click karein.</div>' +
             '  <div style="margin-top:14px"><button onclick="ATPLAdvanceManager.openMonthFeedModal(\'' + esc(analytics.selected.monthKey) + '\')" style="padding:8px 16px;background:#4338ca;color:#fff;border:none;border-radius:8px;font-size:11px;font-weight:800;cursor:pointer">📅 Feed Month-Wise Data</button></div>' +
             '</div>';
    }

    var html = '<div style="overflow-x:auto">';
    html += '<table style="width:100%;border-collapse:collapse;font-size:12px;text-align:left;background:#fff">';
    html += '  <thead>';
    html += '    <tr style="background:#fff;border-bottom:1px solid #eef2f7;color:#64748b;font-size:9.5px;text-transform:uppercase;letter-spacing:0.6px;font-weight:800">';
    html += '      <th style="padding:10px 12px">Emp Code</th>';
    html += '      <th style="padding:10px 12px">Employee Name</th>';
    html += '      <th style="padding:10px 12px;text-align:right;background:#fffbeb;color:#b45309">Prev Given (' + esc(analytics.previous.label) + ')</th>';
    html += '      <th style="padding:10px 12px;text-align:right;background:#fffbeb;color:#15803d">Prev Recovered</th>';
    html += '      <th style="padding:10px 12px;text-align:right">Sel Month Given (' + esc(analytics.selected.label) + ')</th>';
    html += '      <th style="padding:10px 12px;text-align:right">Sheet Cut</th>';
    html += '      <th style="padding:10px 12px;text-align:right;color:#0f766e">Cash Voucher / Manual</th>';
    html += '      <th style="padding:10px 12px;text-align:right">Total Outstanding</th>';
    html += '      <th style="padding:10px 12px;text-align:center">Actions</th>';
    html += '    </tr>';
    html += '  </thead>';
    html += '  <tbody>';

    list.forEach(function(item) {
      var manualCombo = round2((item.selVoucherCut || 0) + (item.selManualOtherCut || 0));
      html += '    <tr style="border-bottom:1px solid #f3f4f6" onmouseover="this.style.background=\'#f8fafc\'" onmouseout="this.style.background=\'#fff\'">';
      html += '      <td style="padding:10px 12px;font-weight:800;color:#312e81;font-family:monospace">' + esc(item.code) + '</td>';
      html += '      <td style="padding:10px 12px;font-weight:700;color:#111827">' + esc(item.name) + '</td>';
      html += '      <td style="padding:10px 12px;text-align:right;font-weight:700;background:#fffdf5;color:#111827">' + formatINR(item.prevGiven) + '</td>';
      html += '      <td style="padding:10px 12px;text-align:right;font-weight:700;background:#fffdf5;color:#15803d">' + formatINR(item.prevRecovered) + '</td>';
      html += '      <td style="padding:10px 12px;text-align:right;font-weight:700;color:#111827">' + formatINR(item.selGiven) + '</td>';
      html += '      <td style="padding:10px 12px;text-align:right;font-weight:650;color:#312e81">' + formatINR(item.selSalaryCut) + '</td>';
      html += '      <td style="padding:10px 12px;text-align:right;font-weight:650;color:#0f766e">' + formatINR(manualCombo) + '</td>';
      html += '      <td style="padding:10px 12px;text-align:right;font-weight:800;color:' + (item.currentOutstanding > 0 ? '#dc2626' : '#15803d') + '">' + formatINR(item.currentOutstanding) + '</td>';
      html += '      <td style="padding:10px 12px;text-align:center;white-space:nowrap">';
      html += '        <button onclick="ATPLAdvanceManager.viewEmployeeHistory(\'' + esc(item.code) + '\')" style="height:26px;padding:0 8px;border:1px solid #c7d2fe;background:#eef2ff;color:#312e81;border-radius:6px;cursor:pointer;font-size:10px;font-weight:800;margin-right:4px">📜 History</button>';
      if (item.currentOutstanding > 0) {
        html += '        <button onclick="ATPLAdvanceManager.openCashVoucherModal(\'' + esc(item.code) + '\')" style="height:26px;padding:0 8px;border:1px solid #99f6e4;background:#f0fdfa;color:#0f766e;border-radius:6px;cursor:pointer;font-size:10px;font-weight:800">🧾 Cash Voucher</button>';
      }
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
    html += '      <th style="padding:10px 14px;text-align:right">Manual / Voucher (₹)</th>';
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
        html += '        <button onclick="ATPLAdvanceManager.openCashVoucherModal(\'' + esc(item.code) + '\')" style="height:26px;padding:0 9px;border:1px solid #99f6e4;background:#f0fdfa;color:#0f766e;border-radius:6px;cursor:pointer;font-size:10px;font-weight:800;margin-right:4px" title="Cash Voucher se Ledger se Minus karein">🧾 Cash Voucher</button>';
        html += '        <button onclick="ATPLAdvanceManager.openManualDeductionModal(\'' + esc(item.code) + '\')" style="height:26px;padding:0 9px;border:1px solid #fde68a;background:#fffbeb;color:#b45309;border-radius:6px;cursor:pointer;font-size:10px;font-weight:800;margin-right:4px">✂️ Manual Cut</button>';
      }
      html += '        <button onclick="ATPLAdvanceManager.openNewModal(\'' + esc(item.code) + '\')" style="height:26px;padding:0 9px;border:none;background:#312e81;color:#fff;border-radius:6px;cursor:pointer;font-size:10px;font-weight:700">➕ Add</button>';
      html += '        <button onclick="ATPLAdvanceManager.confirmDeleteEmployeeLedger(\'' + esc(item.code) + '\')" style="height:26px;padding:0 9px;border:1px solid #fecaca;background:#fef2f2;color:#dc2626;border-radius:6px;cursor:pointer;font-size:10px;font-weight:800;margin-left:4px" title="Delete All Advances for Employee">🗑 Delete</button>';
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
      content += '        <button onclick="ATPLAdvanceManager.openCashVoucherModal(\'' + esc(hist.empCode) + '\')" style="padding:7px 12px;background:#0f766e;color:#fff;border:none;border-radius:8px;font-size:11px;font-weight:800;cursor:pointer">🧾 Cash Voucher</button>';
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
    content += '      <div style="background:#fff;border:1px solid #fde68a;border-radius:10px;padding:10px 12px"><div style="font-size:9px;color:#b45309;text-transform:uppercase;font-weight:800">Manual / Voucher Cut</div><div style="font-size:17px;font-weight:850;color:#b45309">' + formatINR(hist.totalManualCut) + '</div><div style="font-size:10px;color:#d97706">' + hist.deductions.filter(function(d){return getDeductionSourceType(d)==='manual';}).length + ' manual/voucher cut(s)</div></div>';
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
    content += '            <button onclick="ATPLAdvanceManager.setHistoryFilter(\'manual\')" style="border:0;padding:4px 10px;border-radius:6px;font-size:10px;font-weight:800;cursor:pointer;background:' + (state.historySourceFilter === 'manual' ? '#b45309' : 'transparent') + ';color:' + (state.historySourceFilter === 'manual' ? '#fff' : '#64748b') + '">✍️ Manual / Voucher</button>';
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
      content += '                <th style="padding:8px 10px">File / Voucher / Signed By / Remarks</th>';
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
        var isCv = isCashVoucherDeduction(d);
        var dDate = getDeductionDateStr(d) || '-';
        var parentAdv = advLookup[d.advanceId];
        var advRefText = parentAdv ? ((parentAdv.advanceDate || '') + ' (' + formatINR(parentAdv.amount) + ')') : '-';
        var badge = isCv
          ? '<span style="display:inline-block;padding:2px 7px;border-radius:999px;font-size:9px;font-weight:850;background:#f0fdfa;color:#0f766e;border:1px solid #99f6e4">🧾 VOUCHER</span>'
          : sType === 'manual'
            ? '<span style="display:inline-block;padding:2px 7px;border-radius:999px;font-size:9px;font-weight:850;background:#fffbeb;color:#b45309;border:1px solid #fde68a">✍️ MANUAL</span>'
            : '<span style="display:inline-block;padding:2px 7px;border-radius:999px;font-size:9px;font-weight:850;background:#eef2ff;color:#312e81;border:1px solid #c7d2fe">📄 SALARY</span>';

        var detailHtml = '';
        if (isCv) {
          detailHtml += '<div style="font-weight:700;color:#0f766e">Cash Voucher' + (d.signedBy ? ' · Signed by: ' + esc(d.signedBy) : '') + '</div>';
          detailHtml += '<div style="font-size:10px;color:#64748b">' + esc(d.remarks || '—') + '</div>';
        } else if (sType === 'manual') {
          detailHtml += '<div style="font-weight:700;color:#111827">' + esc(d.deductionMode || d.columnName || 'Manual Deduction') + (d.signedBy ? ' · Signed by: ' + esc(d.signedBy) : '') + '</div>';
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
        var isCv = isCashVoucherDeduction(d);
        var srcDesc = isCv
          ? ('<strong style="color:#0f766e">🧾 Cash Voucher' + (d.signedBy ? ' (' + esc(d.signedBy) + ')' : '') + ':</strong> ' + esc(d.remarks || 'Voucher settled'))
          : sType === 'manual'
            ? ('<strong style="color:#b45309">✍️ Manual:</strong> ' + esc(d.deductionMode || '') + (d.signedBy ? ' · Signed by: ' + esc(d.signedBy) : '') + (d.remarks ? ' · ' + esc(d.remarks) : ''))
            : ('<strong style="color:#312e81">📄 Sheet:</strong> ' + esc(d.fileName) + (d.sheetName ? ' · ' + esc(d.sheetName) : '') + (d.columnName ? ' (Col: ' + esc(d.columnName) + ')' : ''));
        content += '        <tr style="border-bottom:1px solid #f3f4f6">';
        content += '          <td style="padding:8px 10px;font-weight:700;color:#111827">' + esc(getDeductionDateStr(d) || d.salaryMonth || '-') + '<div style="font-size:9.5px;color:#94a3b8">' + esc(d.salaryMonth || '') + '</div></td>';
        content += '          <td style="padding:8px 10px;color:#64748b;font-size:10px">' + srcDesc + '</td>';
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
      content += '      <button onclick="ATPLAdvanceManager.openCashVoucherModal(\'' + esc(adv.empCode) + '\',\'' + esc(adv.id) + '\')" style="padding:8px 16px;background:#0f766e;color:#fff;border:none;border-radius:8px;font-size:12px;font-weight:800;cursor:pointer">🧾 Cash Voucher</button>';
      content += '      <button onclick="ATPLAdvanceManager.openManualDeductionModal(\'' + esc(adv.empCode) + '\',\'' + esc(adv.id) + '\')" style="padding:8px 16px;background:#b45309;color:#fff;border:none;border-radius:8px;font-size:12px;font-weight:800;cursor:pointer">✂️ Manual Deduct</button>';
    }
    content += '      <button onclick="ATPLAdvanceManager.closeModal()" style="padding:8px 18px;background:#312e81;color:#fff;border:none;border-radius:8px;font-size:12px;font-weight:800;cursor:pointer;box-shadow:0 1px 3px rgba(49,46,129,0.25)">Close</button>';
    content += '    </div>';

    content += '  </div>';
    content += '</div>';

    modal.innerHTML = content;
  }

  // ── CASH VOUCHER MODAL (LEDGER SE ADVANCE MINUS KARNE KE LIYE) ──
  function openCashVoucherModal(prefillCode, prefillAdvanceId) {
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

    content += '    <div style="padding:18px 22px;border-bottom:1px solid #ccfbf1;display:flex;justify-content:space-between;align-items:center;background:#f0fdfa">';
    content += '      <div>';
    content += '        <div style="font-size:9px;font-weight:900;letter-spacing:1px;color:#0f766e;text-transform:uppercase">ADVANCE LEDGER CASH VOUCHER</div>';
    content += '        <h3 style="margin:2px 0 0;font-size:18px;font-weight:850;color:#111827">🧾 Cash Voucher Entry</h3>';
    content += '        <div style="font-size:11px;color:#475569;margin-top:2px">Voucher amount employee ke advance ledger balance se seedha minus ho jayega</div>';
    content += '      </div>';
    content += '      <button onclick="ATPLAdvanceManager.closeModal()" style="border:1px solid #99f6e4;background:#fff;color:#64748b;width:32px;height:32px;border-radius:8px;cursor:pointer;font-size:15px;display:flex;align-items:center;justify-content:center">✕</button>';
    content += '    </div>';

    content += '    <div style="padding:20px 22px;display:flex;flex-direction:column;gap:13px;background:#ffffff">';
    content += '      <div style="position:relative">';
    content += '        <label style="display:block;font-size:10px;font-weight:800;color:#475569;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:5px">Employee Code / Name *</label>';
    content += '        <input type="text" id="advCvCode" placeholder="Enter Code or Name with Advance Balance..." value="' + esc(prefillCode || '') + '" oninput="ATPLAdvanceManager.onCashVoucherCodeInput(this.value)" autocomplete="off" style="width:100%;padding:10px 12px;background:#ffffff;border:1px solid #d1d5db;border-radius:8px;color:#111827;font-size:13px;font-weight:700;font-family:monospace;outline:none">';
    content += '        <div id="advCvSuggestions" style="display:none;position:absolute;top:100%;left:0;right:0;background:#ffffff;border:1px solid #cbd5e1;border-radius:8px;margin-top:4px;max-height:190px;overflow-y:auto;z-index:200;box-shadow:0 12px 28px rgba(15,23,42,0.18)"></div>';
    content += '      </div>';

    content += '      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:11px 14px;display:flex;justify-content:space-between;align-items:center">';
    content += '        <div>';
    content += '          <div style="font-size:9.5px;color:#64748b;text-transform:uppercase;font-weight:800">Selected Employee</div>';
    content += '          <div id="advCvEmpName" style="font-size:13px;font-weight:800;color:' + (emp ? '#312e81' : '#64748b') + '">' + esc(emp ? emp.name : 'Enter Employee Code...') + '</div>';
    content += '          <div id="advCvEmpDept" style="font-size:10px;color:#94a3b8">' + esc(emp && emp.dept ? emp.dept : '-') + '</div>';
    content += '        </div>';
    content += '        <div style="text-align:right">';
    content += '          <div style="font-size:9.5px;color:#64748b;text-transform:uppercase;font-weight:800">Current Ledger Balance</div>';
    content += '          <div id="advCvBal" data-bal="' + outBal + '" style="font-size:15px;font-weight:850;color:' + (outBal > 0 ? '#dc2626' : '#15803d') + '">' + formatINR(outBal) + '</div>';
    content += '        </div>';
    content += '      </div>';

    content += '      <div>';
    content += '        <label style="display:block;font-size:10px;font-weight:800;color:#475569;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:5px">Target Advance Record</label>';
    content += '        <select id="advCvTarget" onchange="ATPLAdvanceManager.onCashVoucherTargetChange(this.value)" style="width:100%;padding:9px 12px;background:#ffffff;border:1px solid #d1d5db;border-radius:8px;color:#111827;font-size:12px;font-weight:600;outline:none">';
    content +=            buildTargetAdvanceOptionsHtml(prefillCode, prefillAdvanceId);
    content += '        </select>';
    content += '      </div>';

    content += '      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">';
    content += '        <div>';
    content += '          <label style="display:block;font-size:10px;font-weight:800;color:#475569;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:5px">Cash Voucher Date *</label>';
    content += '          <input type="date" id="advCvDate" value="' + today + '" style="width:100%;padding:9px 12px;background:#ffffff;border:1px solid #d1d5db;border-radius:8px;color:#111827;font-size:12px;outline:none">';
    content += '        </div>';
    content += '        <div>';
    content += '          <label style="display:block;font-size:10px;font-weight:800;color:#475569;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:5px">Cash Voucher Amount (₹) *</label>';
    content += '          <input type="number" id="advCvAmount" min="1" step="any" placeholder="Enter voucher amount" oninput="ATPLAdvanceManager.updateCashVoucherPreview()" style="width:100%;padding:9px 12px;background:#ffffff;border:1px solid #d1d5db;border-radius:8px;color:#111827;font-size:13px;font-weight:800;outline:none">';
    content += '        </div>';
    content += '      </div>';

    content += '      <div id="advCvQuickBtns" style="display:flex;gap:6px;flex-wrap:wrap">';
    if (outBal > 0) {
      content += '      <button type="button" onclick="document.getElementById(\'advCvAmount\').value=' + outBal + ';ATPLAdvanceManager.updateCashVoucherPreview()" style="padding:4px 9px;background:#f0fdfa;border:1px solid #99f6e4;color:#0f766e;border-radius:6px;font-size:10px;font-weight:800;cursor:pointer">Full Ledger Bal: ' + formatINR(outBal) + '</button>';
    }
    [500, 1000, 2000, 5000].forEach(function(amt) {
      content += '      <button type="button" onclick="document.getElementById(\'advCvAmount\').value=' + amt + ';ATPLAdvanceManager.updateCashVoucherPreview()" style="padding:4px 9px;background:#f3f4f6;border:1px solid #e5e7eb;color:#374151;border-radius:6px;font-size:10px;font-weight:700;cursor:pointer">' + formatINR(amt) + '</button>';
    });
    content += '      </div>';

    content += '      <div id="advCvBalancePreview" style="padding:8px 12px;background:#f0fdfa;border:1px solid #ccfbf1;border-radius:8px;font-size:11px;color:#0f766e;font-weight:700">Remaining Balance Preview: ' + formatINR(outBal) + '</div>';

    content += '      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">';
    content += '        <div>';
    content += '          <label style="display:block;font-size:10px;font-weight:800;color:#475569;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:5px">Signed By *</label>';
    content += '          <select id="advCvSignedBy" style="width:100%;padding:9px 12px;background:#ffffff;border:1px solid #d1d5db;border-radius:8px;color:#111827;font-size:12px;font-weight:700;outline:none">';
    SIGNED_BY_OPTIONS.forEach(function(nm) {
      content += '            <option value="' + esc(nm) + '">' + esc(nm) + '</option>';
    });
    content += '          </select>';
    content += '        </div>';
    content += '        <div>';
    content += '          <label style="display:block;font-size:10px;font-weight:800;color:#475569;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:5px">Voucher Remarks (Optional)</label>';
    content += '          <input type="text" id="advCvRemarks" placeholder="e.g. Voucher #104 cash settled" style="width:100%;padding:9px 12px;background:#ffffff;border:1px solid #d1d5db;border-radius:8px;color:#111827;font-size:12px;outline:none">';
    content += '        </div>';
    content += '      </div>';
    content += '      <div id="advCvError" style="display:none;padding:8px 12px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;color:#dc2626;font-size:11px;font-weight:700"></div>';
    content += '    </div>';

    content += '    <div style="padding:14px 22px;border-top:1px solid #e5e7eb;display:flex;justify-content:flex-end;gap:10px;background:#f8fafc">';
    content += '      <button onclick="ATPLAdvanceManager.closeModal()" style="padding:9px 16px;background:#ffffff;border:1px solid #d1d5db;color:#475569;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer">Cancel</button>';
    content += '      <button onclick="ATPLAdvanceManager.submitCashVoucher()" style="padding:9px 20px;background:#0f766e;color:#fff;border:none;border-radius:8px;font-size:12px;font-weight:800;cursor:pointer;box-shadow:0 1px 3px rgba(15,118,110,0.25)">🧾 Minus from Ledger &amp; Sync</button>';
    content += '    </div>';

    content += '  </div>';
    content += '</div>';

    modal.innerHTML = content;
  }

  function updateCashVoucherPreview() {
    var balEl = document.getElementById('advCvBal');
    var amtEl = document.getElementById('advCvAmount');
    var prevEl = document.getElementById('advCvBalancePreview');
    if (!balEl || !prevEl) return;
    var bal = round2(Number(balEl.getAttribute('data-bal')) || 0);
    var cut = round2(Number(amtEl && amtEl.value) || 0);
    var after = Math.max(0, round2(bal - cut));
    if (cut > bal + 0.001) {
      prevEl.style.background = '#fef2f2';
      prevEl.style.borderColor = '#fecaca';
      prevEl.style.color = '#dc2626';
      prevEl.textContent = 'Voucher amount (' + formatINR(cut) + ') exceeds current balance (' + formatINR(bal) + ')';
    } else {
      prevEl.style.background = '#f0fdfa';
      prevEl.style.borderColor = '#ccfbf1';
      prevEl.style.color = '#0f766e';
      prevEl.textContent = 'Ledger Balance: ' + formatINR(bal) + ' − Cash Voucher: ' + formatINR(cut) + ' = Remaining: ' + formatINR(after);
    }
  }

  function onCashVoucherCodeInput(val) {
    var raw = String(val || '').trim();
    var boxName = document.getElementById('advCvEmpName');
    var boxDept = document.getElementById('advCvEmpDept');
    var boxBal = document.getElementById('advCvBal');
    var targetSel = document.getElementById('advCvTarget');
    var suggBox = document.getElementById('advCvSuggestions');
    var quickBtns = document.getElementById('advCvQuickBtns');

    if (!raw) {
      if (boxName) { boxName.textContent = 'Enter Employee Code...'; boxName.style.color = '#64748b'; }
      if (boxDept) boxDept.textContent = '-';
      if (boxBal) { boxBal.textContent = '₹0'; boxBal.setAttribute('data-bal', '0'); boxBal.style.color = '#15803d'; }
      if (targetSel) targetSel.innerHTML = buildTargetAdvanceOptionsHtml('', null);
      if (suggBox) suggBox.style.display = 'none';
      updateCashVoucherPreview();
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
      boxBal.setAttribute('data-bal', String(bal));
      boxBal.style.color = bal > 0 ? '#dc2626' : '#15803d';
    }
    if (targetSel) {
      targetSel.innerHTML = buildTargetAdvanceOptionsHtml(raw, null);
    }
    if (quickBtns) {
      var qb = '';
      if (bal > 0) {
        qb += '<button type="button" onclick="document.getElementById(\'advCvAmount\').value=' + bal + ';ATPLAdvanceManager.updateCashVoucherPreview()" style="padding:4px 9px;background:#f0fdfa;border:1px solid #99f6e4;color:#0f766e;border-radius:6px;font-size:10px;font-weight:800;cursor:pointer">Full Ledger Bal: ' + formatINR(bal) + '</button>';
      }
      [500, 1000, 2000, 5000].forEach(function(amt) {
        qb += '<button type="button" onclick="document.getElementById(\'advCvAmount\').value=' + amt + ';ATPLAdvanceManager.updateCashVoucherPreview()" style="padding:4px 9px;background:#f3f4f6;border:1px solid #e5e7eb;color:#374151;border-radius:6px;font-size:10px;font-weight:700;cursor:pointer">' + formatINR(amt) + '</button>';
      });
      quickBtns.innerHTML = qb;
    }
    updateCashVoucherPreview();

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
          sHtml += '<div onclick="ATPLAdvanceManager.selectCashVoucherSuggestion(\'' + esc(m.code) + '\')" style="padding:10px 14px;border-bottom:1px solid #f1f5f9;cursor:pointer;display:flex;justify-content:space-between;align-items:center;background:#ffffff" onmouseover="this.style.background=\'#f8fafc\'" onmouseout="this.style.background=\'#ffffff\'">';
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

  function selectCashVoucherSuggestion(code) {
    var inp = document.getElementById('advCvCode');
    if (inp) {
      inp.value = code;
      onCashVoucherCodeInput(code);
    }
    var suggBox = document.getElementById('advCvSuggestions');
    if (suggBox) suggBox.style.display = 'none';
  }

  function onCashVoucherTargetChange(advId) {
    var code = (document.getElementById('advCvCode') || {}).value || '';
    var boxBal = document.getElementById('advCvBal');
    var quickBtns = document.getElementById('advCvQuickBtns');
    var bal = getEmployeeOutstandingBalance(code);
    if (advId && advId !== 'AUTO') {
      var found = (state.advances || []).find(function(a) { return a.id === advId; });
      if (found) bal = Number(found.balanceAmount) || 0;
    }
    if (boxBal) {
      boxBal.textContent = formatINR(bal);
      boxBal.setAttribute('data-bal', String(bal));
      boxBal.style.color = bal > 0 ? '#dc2626' : '#15803d';
    }
    if (quickBtns) {
      var qb = '';
      if (bal > 0) {
        qb += '<button type="button" onclick="document.getElementById(\'advCvAmount\').value=' + bal + ';ATPLAdvanceManager.updateCashVoucherPreview()" style="padding:4px 9px;background:#f0fdfa;border:1px solid #99f6e4;color:#0f766e;border-radius:6px;font-size:10px;font-weight:800;cursor:pointer">Full Ledger Bal: ' + formatINR(bal) + '</button>';
      }
      [500, 1000, 2000, 5000].forEach(function(amt) {
        qb += '<button type="button" onclick="document.getElementById(\'advCvAmount\').value=' + amt + ';ATPLAdvanceManager.updateCashVoucherPreview()" style="padding:4px 9px;background:#f3f4f6;border:1px solid #e5e7eb;color:#374151;border-radius:6px;font-size:10px;font-weight:700;cursor:pointer">' + formatINR(amt) + '</button>';
      });
      quickBtns.innerHTML = qb;
    }
    updateCashVoucherPreview();
  }

  function submitCashVoucher() {
    var code = (document.getElementById('advCvCode') || {}).value;
    var advanceId = (document.getElementById('advCvTarget') || {}).value || 'AUTO';
    var date = (document.getElementById('advCvDate') || {}).value;
    var amount = (document.getElementById('advCvAmount') || {}).value;
    var signedBy = (document.getElementById('advCvSignedBy') || {}).value || 'Ayush ji';
    var remarks = (document.getElementById('advCvRemarks') || {}).value;
    var errEl = document.getElementById('advCvError');

    function showCvErr(msg) {
      if (errEl) {
        errEl.textContent = msg;
        errEl.style.display = 'block';
      }
    }
    if (errEl) errEl.style.display = 'none';

    if (!code || !String(code).trim()) {
      showCvErr('Please enter Employee Code.');
      return { ok: false, error: 'INVALID_CODE' };
    }
    if (!date) {
      showCvErr('Please select Cash Voucher Date.');
      return { ok: false, error: 'INVALID_DATE' };
    }
    if (!amount || Number(amount) <= 0) {
      showCvErr('Please enter a positive Cash Voucher Amount.');
      return { ok: false, error: 'INVALID_AMOUNT' };
    }

    var res = deductAdvanceManually({
      empCode: String(code).trim(),
      advanceId: advanceId,
      deductionDate: date,
      amount: Number(amount),
      mode: 'Cash Voucher',
      isCashVoucher: true,
      signedBy: signedBy,
      remarks: remarks
    });

    if (res && res.ok) {
      closeModal();
    } else if (res && res.error === 'EXCEEDS_BALANCE') {
      showCvErr('Cash Voucher amount cannot exceed available balance (' + formatINR(res.available) + ').');
    } else if (res && res.error === 'NO_ACTIVE_ADVANCE') {
      showCvErr('No active advance balance found in ledger for Employee ' + code + '.');
    }
    return res;
  }

  // ── MONTH-WISE DATA FEED MODAL ──
  function makeEmptyFeedRow() {
    return { empCode: '', empName: '', givenAmount: '', recoveredAmount: '', mode: 'Salary Sheet Recovery', signedBy: '', remarks: '' };
  }

  function renderMonthFeedRowsHtml() {
    var rows = state.monthFeedRows || [];
    var html = '';
    rows.forEach(function(r, idx) {
      html += '<tr style="border-bottom:1px solid #f1f5f9">';
      html += '  <td style="padding:6px 8px;color:#94a3b8;font-size:10px;font-weight:700">' + (idx + 1) + '</td>';
      html += '  <td style="padding:6px 8px"><input type="text" value="' + esc(r.empCode) + '" placeholder="Code" oninput="ATPLAdvanceManager.updateMonthFeedCell(' + idx + ',\'empCode\',this.value)" style="width:92px;padding:6px 8px;border:1px solid #cbd5e1;border-radius:6px;font-size:11px;font-family:monospace;font-weight:700"></td>';
      html += '  <td style="padding:6px 8px"><input type="text" id="advFeedName_' + idx + '" value="' + esc(r.empName) + '" placeholder="Auto / Name" oninput="ATPLAdvanceManager.updateMonthFeedCell(' + idx + ',\'empName\',this.value)" style="width:150px;padding:6px 8px;border:1px solid #cbd5e1;border-radius:6px;font-size:11px;font-weight:600"></td>';
      html += '  <td style="padding:6px 8px"><input type="number" min="0" value="' + esc(r.givenAmount) + '" placeholder="0" oninput="ATPLAdvanceManager.updateMonthFeedCell(' + idx + ',\'givenAmount\',this.value)" style="width:105px;padding:6px 8px;border:1px solid #cbd5e1;border-radius:6px;font-size:11px;font-weight:700;text-align:right"></td>';
      html += '  <td style="padding:6px 8px"><input type="number" min="0" value="' + esc(r.recoveredAmount) + '" placeholder="0" oninput="ATPLAdvanceManager.updateMonthFeedCell(' + idx + ',\'recoveredAmount\',this.value)" style="width:105px;padding:6px 8px;border:1px solid #cbd5e1;border-radius:6px;font-size:11px;font-weight:700;text-align:right"></td>';
      html += '  <td style="padding:6px 8px"><select onchange="ATPLAdvanceManager.updateMonthFeedCell(' + idx + ',\'mode\',this.value)" style="padding:6px 8px;border:1px solid #cbd5e1;border-radius:6px;font-size:11px"><option value="Salary Sheet Recovery"' + (r.mode === 'Salary Sheet Recovery' ? ' selected' : '') + '>Salary Sheet</option><option value="Cash Voucher"' + (r.mode === 'Cash Voucher' ? ' selected' : '') + '>Cash Voucher</option><option value="Manual Cash Recovery"' + (r.mode === 'Manual Cash Recovery' ? ' selected' : '') + '>Manual Cash</option></select></td>';
      html += '  <td style="padding:6px 8px"><select onchange="ATPLAdvanceManager.updateMonthFeedCell(' + idx + ',\'signedBy\',this.value)" style="padding:6px 8px;border:1px solid #cbd5e1;border-radius:6px;font-size:11px"><option value="">—</option>';
      SIGNED_BY_OPTIONS.forEach(function(nm) {
        html += '<option value="' + esc(nm) + '"' + (r.signedBy === nm ? ' selected' : '') + '>' + esc(nm) + '</option>';
      });
      html += '</select></td>';
      html += '  <td style="padding:6px 8px"><input type="text" value="' + esc(r.remarks) + '" placeholder="Remarks" oninput="ATPLAdvanceManager.updateMonthFeedCell(' + idx + ',\'remarks\',this.value)" style="width:130px;padding:6px 8px;border:1px solid #cbd5e1;border-radius:6px;font-size:11px"></td>';
      html += '  <td style="padding:6px 8px;text-align:center"><button type="button" onclick="ATPLAdvanceManager.removeMonthFeedRow(' + idx + ')" style="border:1px solid #fecaca;background:#fef2f2;color:#dc2626;border-radius:6px;padding:4px 7px;font-size:10px;cursor:pointer">✕</button></td>';
      html += '</tr>';
    });
    return html;
  }

  function openMonthFeedModal(targetMonth) {
    state.openHistoryEmpCode = null;
    var mKey = /^\d{4}-\d{2}$/.test(String(targetMonth || '')) ? String(targetMonth) : (state.selectedMonth || new Date().toISOString().slice(0, 7));
    var defaultDate = mKey + '-01';
    if (!Array.isArray(state.monthFeedRows) || !state.monthFeedRows.length) {
      state.monthFeedRows = [makeEmptyFeedRow(), makeEmptyFeedRow(), makeEmptyFeedRow()];
    }

    var modal = getOrCreateModal();
    var content = '';
    content += '<div style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(15,23,42,0.5);backdrop-filter:blur(4px);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px" onclick="if(event.target===this)ATPLAdvanceManager.closeModal()">';
    content += '  <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:16px;max-width:980px;width:100%;max-height:92vh;display:flex;flex-direction:column;box-shadow:0 24px 48px rgba(15,23,42,0.22);overflow:hidden">';

    content += '    <div style="padding:16px 22px;border-bottom:1px solid #e5e7eb;display:flex;justify-content:space-between;align-items:center;background:#eef2ff">';
    content += '      <div>';
    content += '        <div style="font-size:9px;font-weight:900;letter-spacing:1px;color:#4338ca;text-transform:uppercase">BULK MONTH-WISE DATA FEED</div>';
    content += '        <h3 style="margin:2px 0 0;font-size:18px;font-weight:850;color:#111827">📅 Month-Wise Advance &amp; Recovery Feed</h3>';
    content += '        <div style="font-size:11px;color:#475569;margin-top:2px">Kisi bhi mahine ka advance diya hua aur recovery data ek saath feed karein — Emp Code dalte hi Name auto-fill hoga</div>';
    content += '      </div>';
    content += '      <button onclick="ATPLAdvanceManager.closeModal()" style="border:1px solid #c7d2fe;background:#fff;color:#64748b;width:32px;height:32px;border-radius:8px;cursor:pointer;font-size:15px;display:flex;align-items:center;justify-content:center">✕</button>';
    content += '    </div>';

    content += '    <div style="padding:14px 22px;border-bottom:1px solid #e5e7eb;background:#f8fafc;display:flex;gap:14px;align-items:flex-end;flex-wrap:wrap">';
    content += '      <div>';
    content += '        <label style="display:block;font-size:10px;font-weight:800;color:#475569;text-transform:uppercase;margin-bottom:4px">Target Month *</label>';
    content += '        <input type="month" id="advFeedMonth" value="' + esc(mKey) + '" onchange="var d=document.getElementById(\'advFeedDate\');if(d&&this.value)d.value=this.value+\'-01\'" style="height:34px;padding:0 10px;border:1px solid #cbd5e1;border-radius:8px;font-size:12px;font-weight:700;background:#fff">';
    content += '      </div>';
    content += '      <div>';
    content += '        <label style="display:block;font-size:10px;font-weight:800;color:#475569;text-transform:uppercase;margin-bottom:4px">Entry Date *</label>';
    content += '        <input type="date" id="advFeedDate" value="' + esc(defaultDate) + '" style="height:34px;padding:0 10px;border:1px solid #cbd5e1;border-radius:8px;font-size:12px;font-weight:700;background:#fff">';
    content += '      </div>';
    content += '      <div style="margin-left:auto;display:flex;gap:8px;flex-wrap:wrap">';
    content += '        <button type="button" onclick="ATPLAdvanceManager.addMonthFeedRows(1)" style="height:34px;padding:0 12px;border:1px solid #cbd5e1;background:#fff;color:#334155;border-radius:8px;font-size:11px;font-weight:700;cursor:pointer">+ Add Row</button>';
    content += '        <button type="button" onclick="ATPLAdvanceManager.addMonthFeedRows(5)" style="height:34px;padding:0 12px;border:1px solid #cbd5e1;background:#fff;color:#334155;border-radius:8px;font-size:11px;font-weight:700;cursor:pointer">+ Add 5 Rows</button>';
    content += '      </div>';
    content += '    </div>';

    content += '    <div style="padding:14px 22px;overflow:auto;flex:1;background:#fff">';
    content += '      <table style="width:100%;border-collapse:collapse;font-size:11.5px;text-align:left">';
    content += '        <thead><tr style="background:#f8fafc;border-bottom:1px solid #e5e7eb;color:#64748b;font-size:9.5px;text-transform:uppercase;font-weight:800"><th style="padding:8px">#</th><th style="padding:8px">Emp Code *</th><th style="padding:8px">Employee Name</th><th style="padding:8px;text-align:right">Advance Given (₹)</th><th style="padding:8px;text-align:right">Recovered / Cut (₹)</th><th style="padding:8px">Cut Mode</th><th style="padding:8px">Signed By</th><th style="padding:8px">Remarks</th><th style="padding:8px;text-align:center">Del</th></tr></thead>';
    content += '        <tbody id="advFeedRowsBody">' + renderMonthFeedRowsHtml() + '</tbody>';
    content += '      </table>';

    content += '      <div style="margin-top:14px;padding:10px 12px;background:#f8fafc;border:1px dashed #cbd5e1;border-radius:10px">';
    content += '        <div style="font-size:10px;font-weight:800;color:#475569;margin-bottom:4px">📋 Quick Bulk Paste (CSV / Excel copy-paste: EmpCode, AdvanceGiven, Recovered, Remarks)</div>';
    content += '        <div style="display:flex;gap:8px;align-items:flex-start">';
    content += '          <textarea id="advFeedPasteBox" rows="2" placeholder="Example:\n25924, 5000, 1500, Oct Advance\n26002, 0, 2000, Oct Recovery" style="flex:1;padding:8px;border:1px solid #cbd5e1;border-radius:8px;font-size:11px;font-family:monospace"></textarea>';
    content += '          <button type="button" onclick="ATPLAdvanceManager.parseMonthFeedPaste()" style="height:40px;padding:0 14px;background:#312e81;color:#fff;border:none;border-radius:8px;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap">Load Rows</button>';
    content += '        </div>';
    content += '      </div>';
    content += '      <div id="advFeedError" style="display:none;margin-top:10px;padding:8px 12px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;color:#dc2626;font-size:11px;font-weight:700"></div>';
    content += '    </div>';

    content += '    <div style="padding:14px 22px;border-top:1px solid #e5e7eb;display:flex;justify-content:space-between;align-items:center;gap:10px;background:#f8fafc">';
    content += '      <span style="font-size:11px;color:#64748b">Sabhi rows ek baar me local + cloud me sync ho jayengi</span>';
    content += '      <div style="display:flex;gap:10px">';
    content += '        <button onclick="ATPLAdvanceManager.closeModal()" style="padding:9px 16px;background:#ffffff;border:1px solid #d1d5db;color:#475569;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer">Cancel</button>';
    content += '        <button onclick="ATPLAdvanceManager.submitMonthFeed()" style="padding:9px 20px;background:#4338ca;color:#fff;border:none;border-radius:8px;font-size:12px;font-weight:800;cursor:pointer">💾 Save Month-Wise Data &amp; Sync</button>';
    content += '      </div>';
    content += '    </div>';

    content += '  </div>';
    content += '</div>';

    modal.innerHTML = content;
  }

  function updateMonthFeedCell(idx, field, value) {
    if (!state.monthFeedRows || !state.monthFeedRows[idx]) return;
    state.monthFeedRows[idx][field] = value;
    if (field === 'empCode') {
      var emp = findEmployeeByCode(value);
      if (emp && emp.name) {
        state.monthFeedRows[idx].empName = emp.name;
        var nameInp = document.getElementById('advFeedName_' + idx);
        if (nameInp) nameInp.value = emp.name;
      }
    }
  }

  function addMonthFeedRows(count) {
    if (!Array.isArray(state.monthFeedRows)) state.monthFeedRows = [];
    for (var i = 0; i < (count || 1); i++) {
      state.monthFeedRows.push(makeEmptyFeedRow());
    }
    var tbody = document.getElementById('advFeedRowsBody');
    if (tbody) tbody.innerHTML = renderMonthFeedRowsHtml();
  }

  function removeMonthFeedRow(idx) {
    if (!Array.isArray(state.monthFeedRows)) return;
    state.monthFeedRows.splice(idx, 1);
    if (!state.monthFeedRows.length) state.monthFeedRows.push(makeEmptyFeedRow());
    var tbody = document.getElementById('advFeedRowsBody');
    if (tbody) tbody.innerHTML = renderMonthFeedRowsHtml();
  }

  function parseMonthFeedPaste() {
    var box = document.getElementById('advFeedPasteBox');
    var raw = box ? String(box.value || '').trim() : '';
    if (!raw) return;
    var lines = raw.split(/\r?\n/);
    var parsed = [];
    lines.forEach(function(line) {
      var parts = line.split(/\t|,/).map(function(s) { return s.trim(); });
      if (!parts[0]) return;
      var code = parts[0];
      var emp = findEmployeeByCode(code);
      parsed.push({
        empCode: code,
        empName: (emp && emp.name) || '',
        givenAmount: parts[1] ? String(parseMoney(parts[1]) || '') : '',
        recoveredAmount: parts[2] ? String(parseMoney(parts[2]) || '') : '',
        mode: 'Salary Sheet Recovery',
        signedBy: '',
        remarks: parts[3] || ''
      });
    });
    if (parsed.length) {
      state.monthFeedRows = parsed;
      var tbody = document.getElementById('advFeedRowsBody');
      if (tbody) tbody.innerHTML = renderMonthFeedRowsHtml();
      if (box) box.value = '';
    }
  }

  function submitMonthFeedBatch(rows, entryDate, targetMonth) {
    var errEl = document.getElementById('advFeedError');
    var cleanDate = /^\d{4}-\d{2}-\d{2}$/.test(String(entryDate || '').trim())
      ? String(entryDate).trim()
      : (targetMonth && /^\d{4}-\d{2}$/.test(targetMonth) ? (targetMonth + '-01') : new Date().toISOString().slice(0, 10));
    var nowIso = new Date().toISOString();
    var createdAdvs = [];
    var createdDeds = [];
    var recoveryErrors = [];

    (rows || []).forEach(function(r, idx) {
      if (!r) return;
      var code = String(r.empCode || '').trim();
      var given = round2(Number(r.givenAmount) || 0);
      var recAmt = round2(Number(r.recoveredAmount) || 0);
      if (!code || (given <= 0 && recAmt <= 0)) return;

      var emp = findEmployeeByCode(code);
      var empName = String(r.empName || '').trim() || (emp ? emp.name : ('Employee ' + code));

      if (given > 0) {
        var newAdv = {
          id: 'adv_m_' + Date.now() + '_' + idx + '_' + Math.random().toString(36).slice(2, 6),
          empCode: code,
          empName: empName,
          advanceDate: cleanDate,
          amount: given,
          recoveredAmount: 0,
          balanceAmount: given,
          monthlyCap: 0,
          remarks: String(r.remarks || '').trim() || ('Month Feed (' + formatMonthYearFromDate(cleanDate) + ')'),
          status: 'ACTIVE',
          createdAt: nowIso,
          updatedAt: nowIso,
          deductions: []
        };
        state.advances.unshift(newAdv);
        createdAdvs.push(newAdv);
      }

      if (recAmt > 0) {
        var dedRes = deductAdvanceManually({
          empCode: code,
          deductionDate: cleanDate,
          amount: recAmt,
          mode: r.mode || 'Salary Sheet Recovery',
          isCashVoucher: String(r.mode || '').toLowerCase().indexOf('cash voucher') >= 0,
          signedBy: r.signedBy || '',
          remarks: String(r.remarks || '').trim() || ('Month Feed (' + formatMonthYearFromDate(cleanDate) + ')'),
          skipRemoteSync: true
        });
        if (dedRes && dedRes.ok && dedRes.deductions.length) {
          createdDeds = createdDeds.concat(dedRes.deductions);
        } else if (dedRes && dedRes.error) {
          recoveryErrors.push(code + ': ' + dedRes.error);
        }
      }
    });

    if (!createdAdvs.length && !createdDeds.length) {
      if (errEl) {
        errEl.textContent = recoveryErrors.length
          ? ('Recovery could not be applied (' + recoveryErrors.join(', ') + '). Check active advance balance for the employee.')
          : 'Please enter at least one valid row with Employee Code and Advance Given or Recovered amount.';
        errEl.style.display = 'block';
      }
      return { ok: false, advancesCount: 0, deductionsCount: 0, errors: recoveryErrors };
    }

    state.selectedMonth = cleanDate.slice(0, 7);
    recalculateAllBalances();
    saveToLocal();
    state.monthFeedRows = [];
    renderUI();

    try {
      if (createdAdvs.length) {
        fetch('/api/sync/advances/bulk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ records: state.advances || [] })
        }).catch(function() {});
      }
      createdDeds.forEach(function(dItem) {
        fetch('/api/sync/advance-deduction', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(dItem)
        }).catch(function() {});
      });
    } catch (_) {}

    pushAuthoritativeToCloud().then(function(res) {
      if (window.showToast) {
        var summary = createdAdvs.length + ' advance(s) & ' + createdDeds.length + ' recovery entry(s)';
        if (res && res.ok) {
          window.showToast('✅ Month-wise feed saved (' + summary + ') & synced to cloud!');
        } else {
          window.showToast('⚠️ Month-wise feed saved locally (' + summary + '). Cloud sync pending retry.');
        }
      }
    });

    return { ok: true, advancesCount: createdAdvs.length, deductionsCount: createdDeds.length };
  }

  function submitMonthFeed() {
    var mVal = (document.getElementById('advFeedMonth') || {}).value;
    var dVal = (document.getElementById('advFeedDate') || {}).value;
    var res = submitMonthFeedBatch(state.monthFeedRows, dVal, mVal);
    if (res && res.ok) {
      closeModal();
    }
    return res;
  }

  function closeModal() {
    state.openHistoryEmpCode = null;
    var modal = document.getElementById('advModal');
    if (modal) modal.innerHTML = '';
  }

  // ── 7B. PENDING DIFF AMOUNT & CASH ADV VOUCHER ENGINE ──
  function generatePendingDiffVoucherNo(monthKey) {
    var mk = String(monthKey || state.selectedMonth || new Date().toISOString().slice(0, 7)).replace('-', '');
    var seq = (state.pendingDiffs || []).length + 1;
    var candidate = 'PDV-' + mk + '-' + String(seq).padStart(3, '0');
    var used = {};
    (state.pendingDiffs || []).forEach(function(p) {
      if (p && p.voucherNo) used[String(p.voucherNo).toUpperCase()] = true;
    });
    while (used[candidate.toUpperCase()]) {
      seq++;
      candidate = 'PDV-' + mk + '-' + String(seq).padStart(3, '0');
    }
    return candidate;
  }

  function numberToIndianWords(num) {
    var n = Math.floor(Math.abs(Number(num) || 0));
    if (n === 0) return 'Zero';
    var ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
    var tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
    function twoDigits(v) {
      if (v < 20) return ones[v];
      return tens[Math.floor(v / 10)] + (v % 10 ? ' ' + ones[v % 10] : '');
    }
    function threeDigits(v) {
      var h = Math.floor(v / 100);
      var rem = v % 100;
      var s = h ? ones[h] + ' Hundred' : '';
      if (rem) s += (s ? ' ' : '') + twoDigits(rem);
      return s;
    }
    var out = '';
    var crore = Math.floor(n / 10000000);
    n %= 10000000;
    var lakh = Math.floor(n / 100000);
    n %= 100000;
    var thousand = Math.floor(n / 1000);
    n %= 1000;
    if (crore) out += twoDigits(crore) + ' Crore ';
    if (lakh) out += twoDigits(lakh) + ' Lakh ';
    if (thousand) out += twoDigits(thousand) + ' Thousand ';
    if (n) out += threeDigits(n);
    return out.trim();
  }

  function formatDisplayDateDDMMYYYY(iso) {
    var m = String(iso || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return iso || '-';
    return m[3] + '/' + m[2] + '/' + m[1];
  }

  function getPendingDiffMonthlySummary() {
    var byMonth = {};
    (state.pendingDiffs || []).forEach(function(p) {
      if (!p || isPendingDiffTombstoned(p)) return;
      var mk = getPendingDiffMonthKey(p) || 'Unknown';
      if (!byMonth[mk]) {
        byMonth[mk] = {
          monthKey: mk,
          label: formatMonthKeyLabel(mk),
          count: 0,
          salaryDiffTotal: 0,
          advanceDiffTotal: 0,
          otherDiffTotal: 0,
          totalDiff: 0,
          totalPaid: 0,
          totalBalance: 0
        };
      }
      var bucket = byMonth[mk];
      var amt = round2(Number(p.diffAmount) || 0);
      var paid = round2(Number(p.paidAmount) || 0);
      var bal = round2(Number(p.pendingBalance) || 0);
      bucket.count++;
      bucket.totalDiff = round2(bucket.totalDiff + amt);
      bucket.totalPaid = round2(bucket.totalPaid + paid);
      bucket.totalBalance = round2(bucket.totalBalance + bal);
      var catLow = String(p.category || '').toLowerCase();
      if (catLow.indexOf('salary') >= 0) bucket.salaryDiffTotal = round2(bucket.salaryDiffTotal + amt);
      else if (catLow.indexOf('advance') >= 0) bucket.advanceDiffTotal = round2(bucket.advanceDiffTotal + amt);
      else bucket.otherDiffTotal = round2(bucket.otherDiffTotal + amt);
    });
    return Object.values(byMonth).sort(function(a, b) {
      return String(b.monthKey).localeCompare(String(a.monthKey));
    });
  }

  function addOrUpdatePendingDiff(payload) {
    payload = payload || {};
    var code = String(payload.empCode || '').trim();
    var diffAmount = round2(Number(payload.diffAmount));
    if (!code || !diffAmount || diffAmount <= 0) {
      return { ok: false, error: 'INVALID_INPUT' };
    }
    var emp = findEmployeeByCode(code);
    var empName = String(payload.empName || '').trim() || (emp ? emp.name : ('Employee ' + code));
    var designation = String(payload.designation || '').trim() || (emp && emp.desig) || '';
    var department = String(payload.department || '').trim() || (emp && emp.dept) || '';
    var nowIso = new Date().toISOString();
    var entryDate = (payload.entryDate && /^\d{4}-\d{2}-\d{2}$/.test(String(payload.entryDate).trim()))
      ? String(payload.entryDate).trim()
      : nowIso.slice(0, 10);
    var monthKey = (payload.monthKey && /^\d{4}-\d{2}$/.test(String(payload.monthKey).trim()))
      ? String(payload.monthKey).trim()
      : entryDate.slice(0, 7);

    var recordId = payload.id || ('pdiff_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7));
    var existingIdx = (state.pendingDiffs || []).findIndex(function(p) { return p && p.id === recordId; });
    var existing = existingIdx >= 0 ? state.pendingDiffs[existingIdx] : null;

    var settlements = existing && Array.isArray(existing.settlements) ? existing.settlements.slice() : [];
    var initialPaid = round2(Number(payload.paidAmount) || 0);
    if (!existing && initialPaid > 0) {
      if (initialPaid > diffAmount) initialPaid = diffAmount;
      settlements.push({
        id: 'pds_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        date: entryDate,
        amount: initialPaid,
        mode: 'Cash Adv Voucher',
        voucherNo: String(payload.voucherNo || generatePendingDiffVoucherNo(monthKey)).trim(),
        signedBy: String(payload.signedBy || 'Sarthak ji').trim(),
        remarks: String(payload.remarks || 'Initial Cash Adv Voucher Disbursement').trim(),
        createdAt: nowIso
      });
    }

    var rec = normalizePendingDiffRecord({
      id: recordId,
      voucherNo: String(payload.voucherNo || (existing && existing.voucherNo) || generatePendingDiffVoucherNo(monthKey)).trim(),
      empCode: emp && emp.code ? emp.code : code,
      empName: empName,
      designation: designation,
      department: department,
      monthKey: monthKey,
      entryDate: entryDate,
      category: String(payload.category || (existing && existing.category) || 'Pending Salary').trim(),
      diffAmount: diffAmount,
      paidAmount: settlements.length ? undefined : (existing ? existing.paidAmount : initialPaid),
      settlements: settlements,
      signedBy: String(payload.signedBy || (existing && existing.signedBy) || 'Sarthak ji').trim(),
      directors: SIGNED_BY_OPTIONS.slice(),
      remarks: String(payload.remarks || '').trim(),
      createdAt: existing ? existing.createdAt : nowIso,
      updatedAt: nowIso
    });

    if (state.tombstones && state.tombstones['pdiff:' + recordId]) {
      delete state.tombstones['pdiff:' + recordId];
    }

    if (existingIdx >= 0) {
      state.pendingDiffs[existingIdx] = rec;
    } else {
      state.pendingDiffs.unshift(rec);
    }

    if (!payload.skipRemoteSync) {
      state.selectedMonth = rec.monthKey;
      recalculateAllBalances();
      saveToLocal();
      renderUI();
      pushPendingDiffRemote(rec).then(function(res) {
        if (window.showToast) {
          if (res && res.ok) {
            window.showToast('✅ Pending Diff (' + formatINR(rec.diffAmount) + ') for ' + rec.empName + ' saved & synced!');
          } else {
            window.showToast('✅ Pending Diff (' + formatINR(rec.diffAmount) + ') saved locally & queued for sync.');
          }
        }
      });
    }

    return { ok: true, record: rec };
  }

  function settlePendingDiff(id, settlePayload) {
    settlePayload = settlePayload || {};
    var rec = (state.pendingDiffs || []).find(function(p) { return p && p.id === id && !isPendingDiffTombstoned(p); });
    if (!rec) return { ok: false, error: 'NOT_FOUND' };
    normalizePendingDiffRecord(rec);
    var payAmt = round2(Number(settlePayload.amount));
    if (!payAmt || payAmt <= 0) return { ok: false, error: 'INVALID_AMOUNT' };
    if (payAmt > rec.pendingBalance + 0.001) {
      return { ok: false, error: 'EXCEEDS_BALANCE', available: rec.pendingBalance };
    }
    var nowIso = new Date().toISOString();
    var payDate = (settlePayload.date && /^\d{4}-\d{2}-\d{2}$/.test(String(settlePayload.date).trim()))
      ? String(settlePayload.date).trim()
      : nowIso.slice(0, 10);
    if (!Array.isArray(rec.settlements)) rec.settlements = [];
    if (rec.settlements.length === 0 && (Number(rec.paidAmount) || 0) > 0) {
      rec.settlements.push({
        id: 'pds_init_' + Date.now(),
        date: rec.entryDate,
        amount: round2(rec.paidAmount),
        mode: 'Previous Payment',
        voucherNo: rec.voucherNo,
        signedBy: rec.signedBy,
        remarks: 'Previous recorded payout',
        createdAt: rec.createdAt || nowIso
      });
    }
    var settlementItem = {
      id: 'pds_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      date: payDate,
      amount: payAmt,
      mode: String(settlePayload.mode || 'Cash Adv Voucher').trim(),
      voucherNo: String(settlePayload.voucherNo || rec.voucherNo || generatePendingDiffVoucherNo(rec.monthKey)).trim(),
      signedBy: String(settlePayload.signedBy || rec.signedBy || 'Sarthak ji').trim(),
      remarks: String(settlePayload.remarks || 'Cash Adv Voucher settlement').trim(),
      createdAt: nowIso
    };
    rec.settlements.push(settlementItem);
    rec.signedBy = settlementItem.signedBy;
    rec.updatedAt = nowIso;
    normalizePendingDiffRecord(rec);

    recalculateAllBalances();
    saveToLocal();
    renderUI();

    pushPendingDiffRemote(rec).then(function(res) {
      if (window.showToast) {
        if (res && res.ok) {
          window.showToast('✅ Cash Adv Voucher payout (' + formatINR(payAmt) + ') for ' + rec.empName + ' synced!');
        } else {
          window.showToast('✅ Payout (' + formatINR(payAmt) + ') saved locally.');
        }
      }
    });
    return { ok: true, record: rec, settlement: settlementItem };
  }

  function deletePendingDiff(id) {
    if (!id) return false;
    var idx = (state.pendingDiffs || []).findIndex(function(p) { return p && p.id === id; });
    if (idx < 0) return false;
    state.pendingDiffs.splice(idx, 1);
    var nowIso = new Date().toISOString();
    state.tombstones['pdiff:' + id] = nowIso;

    recalculateAllBalances();
    saveToLocal();
    renderUI();

    deletePendingDiffRemote(id).then(function(res) {
      if (window.showToast) {
        if (res && res.ok) {
          window.showToast('🗑 Pending Diff entry deleted across all browsers.');
        } else {
          window.showToast('🗑 Pending Diff entry deleted locally.');
        }
      }
    });
    return true;
  }

  function confirmDeletePendingDiff(id) {
    var rec = (state.pendingDiffs || []).find(function(p) { return p && p.id === id; });
    if (!rec) return;
    if (confirm('Delete Pending Diff entry (' + rec.voucherNo + ') of ' + formatINR(rec.diffAmount) + ' for ' + rec.empName + ' (' + rec.empCode + ')?')) {
      deletePendingDiff(id);
    }
  }

  function renderPendingDiffsTab(analytics) {
    var query = state.searchQuery.toLowerCase().trim();
    var allClean = (state.pendingDiffs || []).filter(function(p) { return p && !isPendingDiffTombstoned(p); });
    var filtered = allClean.filter(function(p) {
      if (state.pendingDiffStatusFilter !== 'ALL' && p.status !== state.pendingDiffStatusFilter) return false;
      if (state.pendingDiffCategoryFilter !== 'ALL' && p.category !== state.pendingDiffCategoryFilter) return false;
      if (state.filterTablesByMonth && getPendingDiffMonthKey(p) !== state.selectedMonth) return false;
      if (state.selectedDateFilter && String(p.entryDate || '').slice(0, 10) !== state.selectedDateFilter) return false;
      if (!query) return true;
      return String(p.empCode || '').toLowerCase().includes(query) ||
             String(p.empName || '').toLowerCase().includes(query) ||
             String(p.voucherNo || '').toLowerCase().includes(query) ||
             String(p.category || '').toLowerCase().includes(query) ||
             String(p.department || '').toLowerCase().includes(query) ||
             String(p.signedBy || '').toLowerCase().includes(query) ||
             String(p.remarks || '').toLowerCase().includes(query);
    }).slice().sort(function(a, b) {
      return String(b.entryDate || b.updatedAt || '').localeCompare(String(a.entryDate || a.updatedAt || ''));
    });

    var monthlyBuckets = getPendingDiffMonthlySummary();
    var out = '';

    // Inline Month-Wise Summary Strip
    out += '<div style="padding:12px 14px;background:#fff7ed;border-bottom:1px solid #fed7aa;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">';
    out += '  <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">';
    out += '    <span style="font-size:11px;font-weight:850;color:#7c2d12">⏳ ' + esc(analytics.selected.label) + ' Pending Diff:</span>';
    out += '    <span style="font-size:11px;color:#334155">Total: <strong>' + formatINR(analytics.selected.pendingDiffTotal || 0) + '</strong></span>';
    out += '    <span style="font-size:11px;color:#15803d">Cash Paid: <strong>' + formatINR(analytics.selected.pendingDiffPaid || 0) + '</strong></span>';
    out += '    <span style="font-size:11px;color:#dc2626">Remaining: <strong>' + formatINR(analytics.selected.pendingDiffBalance || 0) + '</strong></span>';
    out += '    <span style="color:#cbd5e1">|</span>';
    out += '    <span style="font-size:10.5px;color:#9a3412">Pichla Mahina (' + esc(analytics.previous.label) + '): <strong>' + formatINR(analytics.previous.pendingDiffTotal || 0) + '</strong> (Bal: <strong>' + formatINR(analytics.previous.pendingDiffBalance || 0) + '</strong>)</span>';
    out += '  </div>';
    out += '  <div style="display:flex;gap:6px;flex-wrap:wrap">';
    monthlyBuckets.slice(0, 6).forEach(function(mb) {
      var activeChip = state.filterTablesByMonth && state.selectedMonth === mb.monthKey;
      out += '    <button type="button" onclick="ATPLAdvanceManager.setSelectedMonth(\'' + esc(mb.monthKey) + '\')" style="padding:3px 9px;border-radius:999px;border:1px solid ' + (activeChip ? '#7c2d12' : '#fdba74') + ';background:' + (activeChip ? '#7c2d12' : '#fff') + ';color:' + (activeChip ? '#fff' : '#9a3412') + ';font-size:10px;font-weight:800;cursor:pointer">' + esc(mb.label) + ': ' + formatINR(mb.totalDiff) + '</button>';
    });
    out += '  </div>';
    out += '</div>';

    if (!filtered.length) {
      out += '<div style="padding:48px 20px;text-align:center;color:#94a3b8;background:#fff">';
      out += '  <div style="font-size:36px;margin-bottom:8px;opacity:0.45">🧾</div>';
      out += '  <div style="font-size:14px;font-weight:700;color:#334155">Koi Pending Diff Amount Record Nahi Mila</div>';
      out += '  <div style="font-size:11px;margin-top:4px;color:#94a3b8">Emp Code daal kar Pending Salary / Pending Advance / Diff Amount add karein aur Directors ke sign ke saath Cash Adv Voucher print/download karein.</div>';
      out += '  <div style="margin-top:14px;display:flex;gap:8px;justify-content:center;flex-wrap:wrap">';
      out += '    <button type="button" onclick="ATPLAdvanceManager.openPendingDiffModal()" style="padding:8px 16px;background:#7c2d12;color:#fff;border:none;border-radius:8px;font-size:11px;font-weight:800;cursor:pointer">+ Add Pending Diff / Cash Adv Voucher</button>';
      out += '    <button type="button" onclick="ATPLAdvanceManager.openPendingDiffFeedModal()" style="padding:8px 16px;background:#fff7ed;color:#9a3412;border:1px solid #fdba74;border-radius:8px;font-size:11px;font-weight:800;cursor:pointer">📋 Bulk Month-Wise Entry</button>';
      out += '  </div>';
      out += '</div>';
    } else {
      out += '<div style="overflow-x:auto">';
      out += '<table style="width:100%;border-collapse:collapse;font-size:12px;text-align:left;background:#fff">';
      out += '  <thead>';
      out += '    <tr style="background:#fff;border-bottom:1px solid #eef2f7;color:#64748b;font-size:9.5px;text-transform:uppercase;letter-spacing:0.7px;font-weight:800">';
      out += '      <th style="padding:10px 12px">Voucher No / Month</th>';
      out += '      <th style="padding:10px 12px">Date</th>';
      out += '      <th style="padding:10px 12px">Emp Code</th>';
      out += '      <th style="padding:10px 12px">Employee / Dept</th>';
      out += '      <th style="padding:10px 12px">Type</th>';
      out += '      <th style="padding:10px 12px;text-align:right">Diff Amount (₹)</th>';
      out += '      <th style="padding:10px 12px;text-align:right">Paid (₹)</th>';
      out += '      <th style="padding:10px 12px;text-align:right">Pending Bal (₹)</th>';
      out += '      <th style="padding:10px 12px">Director Sign</th>';
      out += '      <th style="padding:10px 12px;text-align:center">Status</th>';
      out += '      <th style="padding:10px 12px;text-align:center">Actions</th>';
      out += '    </tr>';
      out += '  </thead>';
      out += '  <tbody>';

      filtered.forEach(function(p) {
        var pillStyle = p.status === 'SETTLED'
          ? 'background:#f0fdf4;color:#15803d;border:1px solid #bbf7d0'
          : p.status === 'PARTIAL'
            ? 'background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe'
            : 'background:#fffbeb;color:#b45309;border:1px solid #fde68a';
        var catStyle = String(p.category || '').toLowerCase().indexOf('advance') >= 0
          ? 'background:#f0fdfa;color:#0f766e;border:1px solid #99f6e4'
          : 'background:#eef2ff;color:#312e81;border:1px solid #c7d2fe';
        out += '    <tr style="border-bottom:1px solid #f3f4f6" onmouseover="this.style.background=\'#f8fafc\'" onmouseout="this.style.background=\'#fff\'">';
        out += '      <td style="padding:10px 12px"><div style="font-weight:800;color:#7c2d12;font-family:monospace;font-size:11px">' + esc(p.voucherNo) + '</div><div style="font-size:10px;color:#64748b">' + esc(formatMonthKeyLabel(p.monthKey)) + '</div></td>';
        out += '      <td style="padding:10px 12px;color:#64748b;font-size:11px;white-space:nowrap">' + esc(p.entryDate) + '</td>';
        out += '      <td style="padding:10px 12px;font-weight:800;color:#312e81;font-family:monospace">' + esc(p.empCode) + '</td>';
        out += '      <td style="padding:10px 12px"><div style="font-weight:750;color:#111827">' + esc(p.empName) + '</div><div style="font-size:10px;color:#64748b">' + esc(p.department || p.designation || '-') + (p.remarks ? ' · ' + esc(p.remarks) : '') + '</div></td>';
        out += '      <td style="padding:10px 12px;white-space:nowrap"><span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:9.5px;font-weight:800;' + catStyle + '">' + esc(p.category) + '</span></td>';
        out += '      <td style="padding:10px 12px;text-align:right;font-weight:800;color:#111827">' + formatINR(p.diffAmount) + '</td>';
        out += '      <td style="padding:10px 12px;text-align:right;font-weight:700;color:#15803d">' + formatINR(p.paidAmount) + '</td>';
        out += '      <td style="padding:10px 12px;text-align:right;font-weight:850;color:' + (p.pendingBalance > 0 ? '#dc2626' : '#15803d') + '">' + formatINR(p.pendingBalance) + '</td>';
        out += '      <td style="padding:10px 12px;font-size:11px;font-weight:700;color:#334155">' + esc(p.signedBy) + '<div style="font-size:9px;color:#94a3b8">Directors Panel</div></td>';
        out += '      <td style="padding:10px 12px;text-align:center"><span style="display:inline-block;padding:3px 8px;border-radius:999px;font-size:9px;font-weight:850;' + pillStyle + '">' + esc(p.status) + '</span></td>';
        out += '      <td style="padding:10px 12px;text-align:center;white-space:nowrap">';
        out += '        <button type="button" onclick="ATPLAdvanceManager.openPendingDiffVoucherModal(\'' + esc(p.id) + '\')" style="height:26px;padding:0 8px;border:1px solid #99f6e4;background:#f0fdfa;color:#0f766e;border-radius:6px;cursor:pointer;font-size:10px;font-weight:800;margin-right:4px" title="Cash Adv Voucher Print / Download with Directors Sign">🧾 Cash Adv Voucher</button>';
        if (p.pendingBalance > 0) {
          out += '        <button type="button" onclick="ATPLAdvanceManager.openSettlePendingDiffModal(\'' + esc(p.id) + '\')" style="height:26px;padding:0 8px;border:1px solid #fde68a;background:#fffbeb;color:#b45309;border-radius:6px;cursor:pointer;font-size:10px;font-weight:800;margin-right:4px" title="Pay / Settle Pending Diff">💸 Settle</button>';
        }
        out += '        <button type="button" onclick="ATPLAdvanceManager.openPendingDiffModal(\'' + esc(p.empCode) + '\',\'' + esc(p.id) + '\')" style="height:26px;padding:0 8px;border:1px solid #d1d5db;background:#fff;color:#d97706;border-radius:6px;cursor:pointer;font-size:10px;font-weight:700;margin-right:4px" title="Edit">✏️</button>';
        out += '        <button type="button" onclick="ATPLAdvanceManager.confirmDeletePendingDiff(\'' + esc(p.id) + '\')" style="height:26px;padding:0 8px;border:1px solid #fecaca;background:#fef2f2;color:#dc2626;border-radius:6px;cursor:pointer;font-size:10px;font-weight:700" title="Delete">🗑</button>';
        out += '      </td>';
        out += '    </tr>';
      });

      out += '  </tbody>';
      out += '</table>';
      out += '</div>';
    }

    if (monthlyBuckets.length > 0) {
      out += '<div style="padding:14px;background:#f8fafc;border-top:1px solid #e5e7eb">';
      out += '  <div style="font-size:10.5px;font-weight:850;color:#334155;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:8px">📅 Month-Wise Pending Diff Summary Record</div>';
      out += '  <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:11.5px;background:#fff;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">';
      out += '    <thead><tr style="background:#f1f5f9;color:#475569;font-size:9.5px;text-transform:uppercase;font-weight:800"><th style="padding:8px 10px">Month</th><th style="padding:8px 10px;text-align:center">Vouchers</th><th style="padding:8px 10px;text-align:right">Pending Salary</th><th style="padding:8px 10px;text-align:right">Pending Advance</th><th style="padding:8px 10px;text-align:right">Other Diff</th><th style="padding:8px 10px;text-align:right">Total Diff</th><th style="padding:8px 10px;text-align:right">Cash Paid</th><th style="padding:8px 10px;text-align:right">Remaining Bal</th></tr></thead>';
      out += '    <tbody>';
      monthlyBuckets.forEach(function(mb) {
        out += '      <tr style="border-top:1px solid #f1f5f9">';
        out += '        <td style="padding:8px 10px;font-weight:800;color:#312e81">' + esc(mb.label) + '</td>';
        out += '        <td style="padding:8px 10px;text-align:center;color:#64748b;font-weight:700">' + mb.count + '</td>';
        out += '        <td style="padding:8px 10px;text-align:right">' + formatINR(mb.salaryDiffTotal) + '</td>';
        out += '        <td style="padding:8px 10px;text-align:right">' + formatINR(mb.advanceDiffTotal) + '</td>';
        out += '        <td style="padding:8px 10px;text-align:right">' + formatINR(mb.otherDiffTotal) + '</td>';
        out += '        <td style="padding:8px 10px;text-align:right;font-weight:800">' + formatINR(mb.totalDiff) + '</td>';
        out += '        <td style="padding:8px 10px;text-align:right;font-weight:700;color:#15803d">' + formatINR(mb.totalPaid) + '</td>';
        out += '        <td style="padding:8px 10px;text-align:right;font-weight:850;color:' + (mb.totalBalance > 0 ? '#dc2626' : '#15803d') + '">' + formatINR(mb.totalBalance) + '</td>';
        out += '      </tr>';
      });
      out += '    </tbody></table></div>';
      out += '</div>';
    }

    return out;
  }

  function openPendingDiffModal(prefillCode, editId) {
    state.openHistoryEmpCode = null;
    var existing = editId ? (state.pendingDiffs || []).find(function(p) { return p && p.id === editId; }) : null;
    state.editingPendingDiffId = existing ? existing.id : null;

    var codeVal = existing ? existing.empCode : (prefillCode || '');
    var emp = codeVal ? findEmployeeByCode(codeVal) : null;
    var today = new Date().toISOString().slice(0, 10);
    var mKey = existing ? existing.monthKey : (state.selectedMonth || today.slice(0, 7));
    var entryDate = existing ? existing.entryDate : (mKey === today.slice(0, 7) ? today : (mKey + '-01'));
    var voucherNo = existing ? existing.voucherNo : generatePendingDiffVoucherNo(mKey);
    var empNameVal = existing ? existing.empName : (emp ? emp.name : '');
    var desigVal = existing ? (existing.designation || '') : (emp ? (emp.desig || '') : '');
    var deptVal = existing ? (existing.department || '') : (emp ? (emp.dept || '') : '');

    var modal = getOrCreateModal();
    var c = '';
    c += '<div style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(15,23,42,0.48);backdrop-filter:blur(4px);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px" onclick="if(event.target===this)ATPLAdvanceManager.closeModal()">';
    c += '  <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:16px;max-width:620px;width:100%;max-height:92vh;display:flex;flex-direction:column;box-shadow:0 24px 48px rgba(15,23,42,0.22);overflow:hidden">';

    c += '    <div style="padding:16px 22px;border-bottom:1px solid #fed7aa;display:flex;justify-content:space-between;align-items:center;background:#fff7ed">';
    c += '      <div>';
    c += '        <div style="font-size:9px;font-weight:900;letter-spacing:1px;color:#9a3412;text-transform:uppercase">PENDING DIFF AMOUNT · CASH ADV VOUCHER</div>';
    c += '        <h3 style="margin:2px 0 0;font-size:18px;font-weight:850;color:#111827">' + (existing ? '✏️ Edit Pending Diff / Cash Adv Voucher' : '⏳ Pending Diff Salary / Adv Entry') + '</h3>';
    c += '        <div style="font-size:11px;color:#64748b;margin-top:2px">Emp Code dalte hi Name, Dept, Desig auto-fill hoga · Directors sign ke saath Cash Adv Voucher banega</div>';
    c += '      </div>';
    c += '      <button onclick="ATPLAdvanceManager.closeModal()" style="border:1px solid #fdba74;background:#fff;color:#64748b;width:32px;height:32px;border-radius:8px;cursor:pointer;font-size:15px;display:flex;align-items:center;justify-content:center">✕</button>';
    c += '    </div>';

    c += '    <div style="padding:18px 22px;overflow-y:auto;display:flex;flex-direction:column;gap:12px;background:#ffffff">';
    c += '      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">';
    c += '        <div style="position:relative">';
    c += '          <label style="display:block;font-size:10px;font-weight:800;color:#475569;text-transform:uppercase;margin-bottom:4px">Employee Code *</label>';
    c += '          <input type="text" id="advPdCode" value="' + esc(codeVal) + '" placeholder="Enter Emp Code (e.g. 25924)" oninput="ATPLAdvanceManager.onPendingDiffCodeInput(this.value)" autocomplete="off" style="width:100%;padding:9px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:13px;font-weight:800;font-family:monospace">';
    c += '          <div id="advPdSuggestions" style="display:none;position:absolute;top:100%;left:0;right:0;background:#ffffff;border:1px solid #cbd5e1;border-radius:8px;margin-top:4px;max-height:190px;overflow-y:auto;z-index:200;box-shadow:0 12px 28px rgba(15,23,42,0.18)"></div>';
    c += '        </div>';
    c += '        <div>';
    c += '          <label style="display:block;font-size:10px;font-weight:800;color:#475569;text-transform:uppercase;margin-bottom:4px">Cash Adv Voucher No *</label>';
    c += '          <input type="text" id="advPdVoucherNo" value="' + esc(voucherNo) + '" style="width:100%;padding:9px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:12px;font-weight:800;font-family:monospace;color:#7c2d12">';
    c += '        </div>';
    c += '      </div>';

    c += '      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:10px 14px;display:grid;grid-template-columns:1.3fr 1fr 1fr;gap:10px">';
    c += '        <div><div style="font-size:9px;color:#64748b;font-weight:800;text-transform:uppercase">Employee Name</div><input type="text" id="advPdEmpName" value="' + esc(empNameVal) + '" placeholder="Auto-filled..." style="width:100%;margin-top:3px;padding:5px 8px;border:1px solid #e2e8f0;border-radius:6px;font-size:12px;font-weight:750;color:#111827;background:#fff"></div>';
    c += '        <div><div style="font-size:9px;color:#64748b;font-weight:800;text-transform:uppercase">Designation</div><input type="text" id="advPdDesig" value="' + esc(desigVal) + '" placeholder="-" style="width:100%;margin-top:3px;padding:5px 8px;border:1px solid #e2e8f0;border-radius:6px;font-size:11.5px;font-weight:600;color:#334155;background:#fff"></div>';
    c += '        <div><div style="font-size:9px;color:#64748b;font-weight:800;text-transform:uppercase">Department</div><input type="text" id="advPdDept" value="' + esc(deptVal) + '" placeholder="-" style="width:100%;margin-top:3px;padding:5px 8px;border:1px solid #e2e8f0;border-radius:6px;font-size:11.5px;font-weight:600;color:#334155;background:#fff"></div>';
    c += '      </div>';

    c += '      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">';
    c += '        <div>';
    c += '          <label style="display:block;font-size:10px;font-weight:800;color:#475569;text-transform:uppercase;margin-bottom:4px">Pending Type *</label>';
    c += '          <select id="advPdCategory" style="width:100%;padding:9px 10px;border:1px solid #d1d5db;border-radius:8px;font-size:12px;font-weight:700">';
    PENDING_DIFF_CATEGORIES.forEach(function(cat) {
      c += '            <option value="' + esc(cat) + '"' + (existing && existing.category === cat ? ' selected' : '') + '>' + esc(cat) + '</option>';
    });
    c += '          </select>';
    c += '        </div>';
    c += '        <div>';
    c += '          <label style="display:block;font-size:10px;font-weight:800;color:#475569;text-transform:uppercase;margin-bottom:4px">Month (Mahina) *</label>';
    c += '          <input type="month" id="advPdMonth" value="' + esc(mKey) + '" style="width:100%;padding:8px 10px;border:1px solid #d1d5db;border-radius:8px;font-size:12px;font-weight:700">';
    c += '        </div>';
    c += '        <div>';
    c += '          <label style="display:block;font-size:10px;font-weight:800;color:#475569;text-transform:uppercase;margin-bottom:4px">Voucher Date *</label>';
    c += '          <input type="date" id="advPdDate" value="' + esc(entryDate) + '" onchange="var pm=document.getElementById(\'advPdMonth\');if(pm&&this.value)pm.value=this.value.slice(0,7)" style="width:100%;padding:8px 10px;border:1px solid #d1d5db;border-radius:8px;font-size:12px;font-weight:700">';
    c += '        </div>';
    c += '      </div>';

    c += '      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">';
    c += '        <div>';
    c += '          <label style="display:block;font-size:10px;font-weight:800;color:#475569;text-transform:uppercase;margin-bottom:4px">Pending Diff Amount (₹) *</label>';
    c += '          <input type="number" id="advPdAmount" min="1" step="any" value="' + (existing ? existing.diffAmount : '') + '" placeholder="e.g. 2500" style="width:100%;padding:9px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;font-weight:850;color:#111827">';
    c += '        </div>';
    c += '        <div>';
    c += '          <label style="display:block;font-size:10px;font-weight:800;color:#475569;text-transform:uppercase;margin-bottom:4px">Cash Paid Now (Optional ₹)</label>';
    c += '          <input type="number" id="advPdPaidNow" min="0" step="any" value="' + (existing ? existing.paidAmount : '0') + '"' + (existing ? ' readonly title="Use Settle button on row for additional payments"' : '') + ' placeholder="0 = Keep Pending" style="width:100%;padding:9px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:13px;font-weight:700;background:' + (existing ? '#f1f5f9' : '#fff') + '">';
    c += '        </div>';
    c += '      </div>';

    c += '      <div style="display:grid;grid-template-columns:1fr 1.4fr;gap:12px">';
    c += '        <div>';
    c += '          <label style="display:block;font-size:10px;font-weight:800;color:#475569;text-transform:uppercase;margin-bottom:4px">Approved By (Director Sign) *</label>';
    c += '          <select id="advPdSignedBy" style="width:100%;padding:9px 10px;border:1px solid #d1d5db;border-radius:8px;font-size:12px;font-weight:750">';
    SIGNED_BY_OPTIONS.forEach(function(nm) {
      var sel = existing ? (existing.signedBy === nm) : (nm === 'Sarthak ji');
      c += '            <option value="' + esc(nm) + '"' + (sel ? ' selected' : '') + '>' + esc(nm) + ' (Director)</option>';
    });
    c += '          </select>';
    c += '        </div>';
    c += '        <div>';
    c += '          <label style="display:block;font-size:10px;font-weight:800;color:#475569;text-transform:uppercase;margin-bottom:4px">Reason / Diff Details</label>';
    c += '          <input type="text" id="advPdRemarks" value="' + esc(existing ? (existing.remarks || '') : '') + '" placeholder="e.g. Oct Salary 3 Days Diff / Cash Adv Voucher" style="width:100%;padding:9px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:12px">';
    c += '        </div>';
    c += '      </div>';

    c += '      <div style="padding:9px 12px;background:#f0fdfa;border:1px solid #ccfbf1;border-radius:8px;font-size:10.5px;color:#0f766e;font-weight:700">';
    c += '        ✍ Cash Adv Voucher par Sabhi Directors ke Signature Block (Sarthak ji, Manish ji, Ayush ji) aur Selected Approving Director highlight rahega.';
    c += '      </div>';
    c += '      <div id="advPdError" style="display:none;padding:8px 12px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;color:#dc2626;font-size:11px;font-weight:700"></div>';
    c += '    </div>';

    c += '    <div style="padding:14px 22px;border-top:1px solid #e5e7eb;display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap;background:#f8fafc">';
    c += '      <button type="button" onclick="ATPLAdvanceManager.closeModal()" style="padding:9px 15px;background:#ffffff;border:1px solid #d1d5db;color:#475569;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer">Cancel</button>';
    c += '      <button type="button" onclick="ATPLAdvanceManager.submitPendingDiffForm(false)" style="padding:9px 16px;background:#7c2d12;color:#fff;border:none;border-radius:8px;font-size:12px;font-weight:800;cursor:pointer">💾 Save &amp; Sync</button>';
    c += '      <button type="button" onclick="ATPLAdvanceManager.submitPendingDiffForm(true)" style="padding:9px 18px;background:#0f766e;color:#fff;border:none;border-radius:8px;font-size:12px;font-weight:800;cursor:pointer">🧾 Save &amp; Cash Adv Voucher</button>';
    c += '    </div>';

    c += '  </div>';
    c += '</div>';
    modal.innerHTML = c;
  }

  function onPendingDiffCodeInput(val) {
    var raw = String(val || '').trim();
    var nameEl = document.getElementById('advPdEmpName');
    var desigEl = document.getElementById('advPdDesig');
    var deptEl = document.getElementById('advPdDept');
    var suggBox = document.getElementById('advPdSuggestions');

    if (!raw) {
      if (nameEl) nameEl.value = '';
      if (desigEl) desigEl.value = '';
      if (deptEl) deptEl.value = '';
      if (suggBox) suggBox.style.display = 'none';
      return;
    }

    var emp = findEmployeeByCode(raw);
    if (emp) {
      if (nameEl) nameEl.value = emp.name || '';
      if (desigEl) desigEl.value = emp.desig || '';
      if (deptEl) deptEl.value = emp.dept || '';
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

      if (matches.length > 0 && (!emp || normalizeCode(raw) !== normalizeCode(emp.code))) {
        var sHtml = '';
        matches.forEach(function(m) {
          var mCode = String(m.emp_id || m.code);
          sHtml += '<div onclick="ATPLAdvanceManager.selectPendingDiffSuggestion(\'' + esc(mCode) + '\')" style="padding:9px 12px;border-bottom:1px solid #f1f5f9;cursor:pointer;display:flex;justify-content:space-between;align-items:center;background:#fff" onmouseover="this.style.background=\'#f8fafc\'" onmouseout="this.style.background=\'#fff\'">';
          sHtml += '  <div><strong style="color:#312e81;font-family:monospace">' + esc(mCode) + '</strong> — <span style="font-weight:750;color:#0f172a">' + esc(m.name || '') + '</span></div>';
          sHtml += '  <div style="font-size:10px;color:#64748b">' + esc(m.dept || '') + '</div>';
          sHtml += '</div>';
        });
        suggBox.innerHTML = sHtml;
        suggBox.style.display = 'block';
      } else {
        suggBox.style.display = 'none';
      }
    }
  }

  function selectPendingDiffSuggestion(code) {
    var inp = document.getElementById('advPdCode');
    if (inp) {
      inp.value = code;
      onPendingDiffCodeInput(code);
    }
    var suggBox = document.getElementById('advPdSuggestions');
    if (suggBox) suggBox.style.display = 'none';
  }

  function submitPendingDiffForm(openVoucherAfter) {
    var code = (document.getElementById('advPdCode') || {}).value;
    var voucherNo = (document.getElementById('advPdVoucherNo') || {}).value;
    var empName = (document.getElementById('advPdEmpName') || {}).value;
    var designation = (document.getElementById('advPdDesig') || {}).value;
    var department = (document.getElementById('advPdDept') || {}).value;
    var category = (document.getElementById('advPdCategory') || {}).value;
    var monthKey = (document.getElementById('advPdMonth') || {}).value;
    var entryDate = (document.getElementById('advPdDate') || {}).value;
    var diffAmount = (document.getElementById('advPdAmount') || {}).value;
    var paidNow = (document.getElementById('advPdPaidNow') || {}).value;
    var signedBy = (document.getElementById('advPdSignedBy') || {}).value;
    var remarks = (document.getElementById('advPdRemarks') || {}).value;
    var errEl = document.getElementById('advPdError');

    if (errEl) errEl.style.display = 'none';
    if (!code || !String(code).trim()) {
      if (errEl) { errEl.textContent = 'Please enter Employee Code.'; errEl.style.display = 'block'; }
      return { ok: false, error: 'INVALID_CODE' };
    }
    if (!diffAmount || Number(diffAmount) <= 0) {
      if (errEl) { errEl.textContent = 'Please enter a positive Pending Diff Amount.'; errEl.style.display = 'block'; }
      return { ok: false, error: 'INVALID_AMOUNT' };
    }

    var res = addOrUpdatePendingDiff({
      id: state.editingPendingDiffId || undefined,
      voucherNo: voucherNo,
      empCode: String(code).trim(),
      empName: empName,
      designation: designation,
      department: department,
      category: category,
      monthKey: monthKey,
      entryDate: entryDate,
      diffAmount: Number(diffAmount),
      paidAmount: Number(paidNow) || 0,
      signedBy: signedBy,
      remarks: remarks
    });

    if (res && res.ok) {
      state.editingPendingDiffId = null;
      state.activeTab = 'pending_diff';
      renderUI();
      if (openVoucherAfter) {
        openPendingDiffVoucherModal(res.record.id);
      } else {
        closeModal();
      }
    }
    return res;
  }

  function makeEmptyPendingDiffFeedRow() {
    return { empCode: '', empName: '', category: 'Pending Salary', diffAmount: '', paidAmount: '', signedBy: 'Sarthak ji', remarks: '' };
  }

  function renderPendingDiffFeedRowsHtml() {
    var rows = state.pendingDiffFeedRows || [];
    var html = '';
    rows.forEach(function(r, idx) {
      html += '<tr style="border-bottom:1px solid #f1f5f9">';
      html += '  <td style="padding:6px 8px;color:#94a3b8;font-size:10px;font-weight:700">' + (idx + 1) + '</td>';
      html += '  <td style="padding:6px 8px"><input type="text" value="' + esc(r.empCode) + '" placeholder="Code" oninput="ATPLAdvanceManager.updatePendingDiffFeedCell(' + idx + ',\'empCode\',this.value)" style="width:90px;padding:6px 8px;border:1px solid #cbd5e1;border-radius:6px;font-size:11px;font-family:monospace;font-weight:700"></td>';
      html += '  <td style="padding:6px 8px"><input type="text" id="advPdFeedName_' + idx + '" value="' + esc(r.empName) + '" placeholder="Auto / Name" oninput="ATPLAdvanceManager.updatePendingDiffFeedCell(' + idx + ',\'empName\',this.value)" style="width:145px;padding:6px 8px;border:1px solid #cbd5e1;border-radius:6px;font-size:11px;font-weight:600"></td>';
      html += '  <td style="padding:6px 8px"><select onchange="ATPLAdvanceManager.updatePendingDiffFeedCell(' + idx + ',\'category\',this.value)" style="padding:6px 8px;border:1px solid #cbd5e1;border-radius:6px;font-size:11px">';
      PENDING_DIFF_CATEGORIES.forEach(function(cat) {
        html += '<option value="' + esc(cat) + '"' + (r.category === cat ? ' selected' : '') + '>' + esc(cat) + '</option>';
      });
      html += '  </select></td>';
      html += '  <td style="padding:6px 8px"><input type="number" min="0" value="' + esc(r.diffAmount) + '" placeholder="0" oninput="ATPLAdvanceManager.updatePendingDiffFeedCell(' + idx + ',\'diffAmount\',this.value)" style="width:95px;padding:6px 8px;border:1px solid #cbd5e1;border-radius:6px;font-size:11px;font-weight:700;text-align:right"></td>';
      html += '  <td style="padding:6px 8px"><input type="number" min="0" value="' + esc(r.paidAmount) + '" placeholder="0" oninput="ATPLAdvanceManager.updatePendingDiffFeedCell(' + idx + ',\'paidAmount\',this.value)" style="width:90px;padding:6px 8px;border:1px solid #cbd5e1;border-radius:6px;font-size:11px;font-weight:700;text-align:right"></td>';
      html += '  <td style="padding:6px 8px"><select onchange="ATPLAdvanceManager.updatePendingDiffFeedCell(' + idx + ',\'signedBy\',this.value)" style="padding:6px 8px;border:1px solid #cbd5e1;border-radius:6px;font-size:11px">';
      SIGNED_BY_OPTIONS.forEach(function(nm) {
        html += '<option value="' + esc(nm) + '"' + (r.signedBy === nm ? ' selected' : '') + '>' + esc(nm) + '</option>';
      });
      html += '  </select></td>';
      html += '  <td style="padding:6px 8px"><input type="text" value="' + esc(r.remarks) + '" placeholder="Remarks" oninput="ATPLAdvanceManager.updatePendingDiffFeedCell(' + idx + ',\'remarks\',this.value)" style="width:125px;padding:6px 8px;border:1px solid #cbd5e1;border-radius:6px;font-size:11px"></td>';
      html += '  <td style="padding:6px 8px;text-align:center"><button type="button" onclick="ATPLAdvanceManager.removePendingDiffFeedRow(' + idx + ')" style="border:1px solid #fecaca;background:#fef2f2;color:#dc2626;border-radius:6px;padding:4px 7px;font-size:10px;cursor:pointer">✕</button></td>';
      html += '</tr>';
    });
    return html;
  }

  function openPendingDiffFeedModal(targetMonth) {
    state.openHistoryEmpCode = null;
    var mKey = /^\d{4}-\d{2}$/.test(String(targetMonth || '')) ? String(targetMonth) : (state.selectedMonth || new Date().toISOString().slice(0, 7));
    var defaultDate = mKey + '-01';
    if (!Array.isArray(state.pendingDiffFeedRows) || !state.pendingDiffFeedRows.length) {
      state.pendingDiffFeedRows = [makeEmptyPendingDiffFeedRow(), makeEmptyPendingDiffFeedRow(), makeEmptyPendingDiffFeedRow()];
    }
    var modal = getOrCreateModal();
    var c = '';
    c += '<div style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(15,23,42,0.5);backdrop-filter:blur(4px);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px" onclick="if(event.target===this)ATPLAdvanceManager.closeModal()">';
    c += '  <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:16px;max-width:990px;width:100%;max-height:92vh;display:flex;flex-direction:column;box-shadow:0 24px 48px rgba(15,23,42,0.22);overflow:hidden">';
    c += '    <div style="padding:16px 22px;border-bottom:1px solid #fed7aa;display:flex;justify-content:space-between;align-items:center;background:#fff7ed">';
    c += '      <div>';
    c += '        <div style="font-size:9px;font-weight:900;letter-spacing:1px;color:#9a3412;text-transform:uppercase">BULK MONTH-WISE PENDING DIFF FEED</div>';
    c += '        <h3 style="margin:2px 0 0;font-size:18px;font-weight:850;color:#111827">⏳ Bulk Pending Diff Salary / Adv Entry</h3>';
    c += '        <div style="font-size:11px;color:#475569;margin-top:2px">Emp Code dalte hi Name auto-fill hoga aur har row ka Cash Adv Voucher banega</div>';
    c += '      </div>';
    c += '      <button onclick="ATPLAdvanceManager.closeModal()" style="border:1px solid #fdba74;background:#fff;color:#64748b;width:32px;height:32px;border-radius:8px;cursor:pointer;font-size:15px">✕</button>';
    c += '    </div>';
    c += '    <div style="padding:12px 22px;border-bottom:1px solid #e5e7eb;background:#f8fafc;display:flex;gap:14px;align-items:flex-end;flex-wrap:wrap">';
    c += '      <div><label style="display:block;font-size:10px;font-weight:800;color:#475569;text-transform:uppercase;margin-bottom:4px">Target Month *</label><input type="month" id="advPdFeedMonth" value="' + esc(mKey) + '" onchange="var d=document.getElementById(\'advPdFeedDate\');if(d&&this.value)d.value=this.value+\'-01\'" style="height:34px;padding:0 10px;border:1px solid #cbd5e1;border-radius:8px;font-size:12px;font-weight:700;background:#fff"></div>';
    c += '      <div><label style="display:block;font-size:10px;font-weight:800;color:#475569;text-transform:uppercase;margin-bottom:4px">Voucher Date *</label><input type="date" id="advPdFeedDate" value="' + esc(defaultDate) + '" style="height:34px;padding:0 10px;border:1px solid #cbd5e1;border-radius:8px;font-size:12px;font-weight:700;background:#fff"></div>';
    c += '      <div style="margin-left:auto;display:flex;gap:8px"><button type="button" onclick="ATPLAdvanceManager.addPendingDiffFeedRows(1)" style="height:34px;padding:0 12px;border:1px solid #cbd5e1;background:#fff;border-radius:8px;font-size:11px;font-weight:700;cursor:pointer">+ Row</button><button type="button" onclick="ATPLAdvanceManager.addPendingDiffFeedRows(5)" style="height:34px;padding:0 12px;border:1px solid #cbd5e1;background:#fff;border-radius:8px;font-size:11px;font-weight:700;cursor:pointer">+ 5 Rows</button></div>';
    c += '    </div>';
    c += '    <div style="padding:14px 22px;overflow:auto;flex:1;background:#fff">';
    c += '      <table style="width:100%;border-collapse:collapse;font-size:11.5px;text-align:left">';
    c += '        <thead><tr style="background:#f8fafc;border-bottom:1px solid #e5e7eb;color:#64748b;font-size:9.5px;text-transform:uppercase;font-weight:800"><th style="padding:8px">#</th><th style="padding:8px">Emp Code *</th><th style="padding:8px">Employee Name</th><th style="padding:8px">Type</th><th style="padding:8px;text-align:right">Diff Amount</th><th style="padding:8px;text-align:right">Paid Now</th><th style="padding:8px">Director Sign</th><th style="padding:8px">Remarks</th><th style="padding:8px;text-align:center">Del</th></tr></thead>';
    c += '        <tbody id="advPdFeedRowsBody">' + renderPendingDiffFeedRowsHtml() + '</tbody>';
    c += '      </table>';
    c += '      <div style="margin-top:12px;padding:10px 12px;background:#f8fafc;border:1px dashed #cbd5e1;border-radius:10px">';
    c += '        <div style="font-size:10px;font-weight:800;color:#475569;margin-bottom:4px">📋 Quick Paste (EmpCode, DiffAmount, Type[Salary/Advance], PaidNow, Remarks)</div>';
    c += '        <div style="display:flex;gap:8px;align-items:flex-start"><textarea id="advPdFeedPasteBox" rows="2" placeholder="Example:\n25924, 1850, Pending Salary, 0, Oct Att Diff\n26002, 2500, Pending Advance, 2500, Cash Voucher" style="flex:1;padding:8px;border:1px solid #cbd5e1;border-radius:8px;font-size:11px;font-family:monospace"></textarea><button type="button" onclick="ATPLAdvanceManager.parsePendingDiffFeedPaste()" style="height:40px;padding:0 14px;background:#7c2d12;color:#fff;border:none;border-radius:8px;font-size:11px;font-weight:700;cursor:pointer">Load Rows</button></div>';
    c += '      </div>';
    c += '      <div id="advPdFeedError" style="display:none;margin-top:10px;padding:8px 12px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;color:#dc2626;font-size:11px;font-weight:700"></div>';
    c += '    </div>';
    c += '    <div style="padding:14px 22px;border-top:1px solid #e5e7eb;display:flex;justify-content:flex-end;gap:10px;background:#f8fafc">';
    c += '      <button type="button" onclick="ATPLAdvanceManager.closeModal()" style="padding:9px 16px;background:#fff;border:1px solid #d1d5db;color:#475569;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer">Cancel</button>';
    c += '      <button type="button" onclick="ATPLAdvanceManager.submitPendingDiffFeed()" style="padding:9px 20px;background:#7c2d12;color:#fff;border:none;border-radius:8px;font-size:12px;font-weight:800;cursor:pointer">💾 Save All &amp; Sync</button>';
    c += '    </div>';
    c += '  </div>';
    c += '</div>';
    modal.innerHTML = c;
  }

  function updatePendingDiffFeedCell(idx, field, value) {
    if (!state.pendingDiffFeedRows || !state.pendingDiffFeedRows[idx]) return;
    state.pendingDiffFeedRows[idx][field] = value;
    if (field === 'empCode') {
      var emp = findEmployeeByCode(value);
      if (emp && emp.name) {
        state.pendingDiffFeedRows[idx].empName = emp.name;
        var inp = document.getElementById('advPdFeedName_' + idx);
        if (inp) inp.value = emp.name;
      }
    }
  }

  function addPendingDiffFeedRows(count) {
    if (!Array.isArray(state.pendingDiffFeedRows)) state.pendingDiffFeedRows = [];
    for (var i = 0; i < (count || 1); i++) state.pendingDiffFeedRows.push(makeEmptyPendingDiffFeedRow());
    var tb = document.getElementById('advPdFeedRowsBody');
    if (tb) tb.innerHTML = renderPendingDiffFeedRowsHtml();
  }

  function removePendingDiffFeedRow(idx) {
    if (!Array.isArray(state.pendingDiffFeedRows)) return;
    state.pendingDiffFeedRows.splice(idx, 1);
    if (!state.pendingDiffFeedRows.length) state.pendingDiffFeedRows.push(makeEmptyPendingDiffFeedRow());
    var tb = document.getElementById('advPdFeedRowsBody');
    if (tb) tb.innerHTML = renderPendingDiffFeedRowsHtml();
  }

  function parsePendingDiffFeedPaste() {
    var box = document.getElementById('advPdFeedPasteBox');
    var raw = box ? String(box.value || '').trim() : '';
    if (!raw) return;
    var parsed = [];
    raw.split(/\r?\n/).forEach(function(line) {
      var parts = line.split(/\t|,/).map(function(s) { return s.trim(); });
      if (!parts[0]) return;
      var code = parts[0];
      var emp = findEmployeeByCode(code);
      var catRaw = String(parts[2] || '').toLowerCase();
      var cat = catRaw.indexOf('adv') >= 0 ? 'Pending Advance' : (catRaw.indexOf('diff') >= 0 ? 'Diff Amount' : 'Pending Salary');
      parsed.push({
        empCode: code,
        empName: (emp && emp.name) || '',
        category: cat,
        diffAmount: parts[1] ? String(parseMoney(parts[1]) || '') : '',
        paidAmount: parts[3] ? String(parseMoney(parts[3]) || '') : '',
        signedBy: 'Sarthak ji',
        remarks: parts[4] || ''
      });
    });
    if (parsed.length) {
      state.pendingDiffFeedRows = parsed;
      var tb = document.getElementById('advPdFeedRowsBody');
      if (tb) tb.innerHTML = renderPendingDiffFeedRowsHtml();
      if (box) box.value = '';
    }
  }

  function submitPendingDiffFeedBatch(rows, entryDate, targetMonth) {
    var errEl = document.getElementById('advPdFeedError');
    var cleanDate = /^\d{4}-\d{2}-\d{2}$/.test(String(entryDate || '').trim())
      ? String(entryDate).trim()
      : (targetMonth && /^\d{4}-\d{2}$/.test(targetMonth) ? (targetMonth + '-01') : new Date().toISOString().slice(0, 10));
    var mKey = /^\d{4}-\d{2}$/.test(String(targetMonth || '')) ? String(targetMonth) : cleanDate.slice(0, 7);
    var created = [];
    (rows || []).forEach(function(r) {
      if (!r) return;
      var code = String(r.empCode || '').trim();
      var amt = round2(Number(r.diffAmount) || 0);
      if (!code || amt <= 0) return;
      var res = addOrUpdatePendingDiff({
        empCode: code,
        empName: r.empName,
        category: r.category || 'Pending Salary',
        monthKey: mKey,
        entryDate: cleanDate,
        diffAmount: amt,
        paidAmount: round2(Number(r.paidAmount) || 0),
        signedBy: r.signedBy || 'Sarthak ji',
        remarks: r.remarks || ('Month Feed (' + formatMonthKeyLabel(mKey) + ')'),
        skipRemoteSync: true
      });
      if (res && res.ok && res.record) created.push(res.record);
    });
    if (!created.length) {
      if (errEl) {
        errEl.textContent = 'Please enter at least one valid row with Emp Code and Pending Diff Amount.';
        errEl.style.display = 'block';
      }
      return { ok: false, count: 0 };
    }
    state.selectedMonth = mKey;
    state.activeTab = 'pending_diff';
    state.pendingDiffFeedRows = [];
    recalculateAllBalances();
    saveToLocal();
    renderUI();
    pushAuthoritativeToCloud().then(function(res) {
      broadcastSync('pending_diffs_updated', { count: created.length });
      if (window.showToast) {
        window.showToast('✅ Saved ' + created.length + ' Pending Diff entry(s) & ' + (res && res.ok ? 'synced!' : 'saved locally!'));
      }
    });
    return { ok: true, count: created.length, records: created };
  }

  function submitPendingDiffFeed() {
    var mVal = (document.getElementById('advPdFeedMonth') || {}).value;
    var dVal = (document.getElementById('advPdFeedDate') || {}).value;
    var res = submitPendingDiffFeedBatch(state.pendingDiffFeedRows, dVal, mVal);
    if (res && res.ok) closeModal();
    return res;
  }

  function openSettlePendingDiffModal(id) {
    var rec = (state.pendingDiffs || []).find(function(p) { return p && p.id === id; });
    if (!rec) return;
    var today = new Date().toISOString().slice(0, 10);
    var modal = getOrCreateModal();
    var c = '';
    c += '<div style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(15,23,42,0.48);backdrop-filter:blur(4px);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px" onclick="if(event.target===this)ATPLAdvanceManager.closeModal()">';
    c += '  <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:16px;max-width:480px;width:100%;box-shadow:0 20px 40px rgba(15,23,42,0.2);overflow:hidden">';
    c += '    <div style="padding:16px 20px;border-bottom:1px solid #ccfbf1;display:flex;justify-content:space-between;align-items:center;background:#f0fdfa">';
    c += '      <div><div style="font-size:9px;font-weight:900;color:#0f766e;text-transform:uppercase">CASH ADV VOUCHER PAYOUT</div><h3 style="margin:2px 0 0;font-size:17px;font-weight:850;color:#111827">💸 Settle Pending Diff Amount</h3></div>';
    c += '      <button onclick="ATPLAdvanceManager.closeModal()" style="border:1px solid #99f6e4;background:#fff;width:30px;height:30px;border-radius:8px;cursor:pointer">✕</button>';
    c += '    </div>';
    c += '    <div style="padding:18px 20px;display:flex;flex-direction:column;gap:12px">';
    c += '      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:10px 14px;display:flex;justify-content:space-between;align-items:center">';
    c += '        <div><div style="font-weight:800;color:#312e81">' + esc(rec.empName) + ' (' + esc(rec.empCode) + ')</div><div style="font-size:10.5px;color:#64748b">' + esc(rec.voucherNo) + ' · ' + esc(rec.category) + '</div></div>';
    c += '        <div style="text-align:right"><div style="font-size:9.5px;color:#64748b;font-weight:800">Pending Bal</div><div style="font-size:15px;font-weight:850;color:#dc2626">' + formatINR(rec.pendingBalance) + '</div></div>';
    c += '      </div>';
    c += '      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">';
    c += '        <div><label style="display:block;font-size:10px;font-weight:800;color:#475569;text-transform:uppercase;margin-bottom:4px">Payout Date *</label><input type="date" id="advPdSettleDate" value="' + today + '" style="width:100%;padding:8px 10px;border:1px solid #d1d5db;border-radius:8px;font-size:12px"></div>';
    c += '        <div><label style="display:block;font-size:10px;font-weight:800;color:#475569;text-transform:uppercase;margin-bottom:4px">Cash Adv Voucher Amount *</label><input type="number" id="advPdSettleAmt" value="' + rec.pendingBalance + '" min="1" step="any" style="width:100%;padding:8px 10px;border:1px solid #d1d5db;border-radius:8px;font-size:13px;font-weight:800"></div>';
    c += '      </div>';
    c += '      <div style="display:grid;grid-template-columns:1fr 1.3fr;gap:10px">';
    c += '        <div><label style="display:block;font-size:10px;font-weight:800;color:#475569;text-transform:uppercase;margin-bottom:4px">Signed By (Director) *</label><select id="advPdSettleSign" style="width:100%;padding:8px 10px;border:1px solid #d1d5db;border-radius:8px;font-size:12px;font-weight:700">';
    SIGNED_BY_OPTIONS.forEach(function(nm) {
      c += '<option value="' + esc(nm) + '"' + (rec.signedBy === nm ? ' selected' : '') + '>' + esc(nm) + '</option>';
    });
    c += '</select></div>';
    c += '        <div><label style="display:block;font-size:10px;font-weight:800;color:#475569;text-transform:uppercase;margin-bottom:4px">Remarks</label><input type="text" id="advPdSettleRemarks" placeholder="e.g. Paid via Cash Adv Voucher" style="width:100%;padding:8px 10px;border:1px solid #d1d5db;border-radius:8px;font-size:12px"></div>';
    c += '      </div>';
    c += '      <div id="advPdSettleErr" style="display:none;padding:8px 10px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;color:#dc2626;font-size:11px;font-weight:700"></div>';
    c += '    </div>';
    c += '    <div style="padding:12px 20px;border-top:1px solid #e5e7eb;display:flex;justify-content:flex-end;gap:8px;background:#f8fafc">';
    c += '      <button type="button" onclick="ATPLAdvanceManager.closeModal()" style="padding:8px 14px;background:#fff;border:1px solid #d1d5db;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer">Cancel</button>';
    c += '      <button type="button" onclick="ATPLAdvanceManager.submitSettlePendingDiff(\'' + esc(rec.id) + '\')" style="padding:8px 18px;background:#0f766e;color:#fff;border:none;border-radius:8px;font-size:12px;font-weight:800;cursor:pointer">✅ Pay &amp; Print Cash Adv Voucher</button>';
    c += '    </div>';
    c += '  </div>';
    c += '</div>';
    modal.innerHTML = c;
  }

  function submitSettlePendingDiff(id) {
    var dVal = (document.getElementById('advPdSettleDate') || {}).value;
    var aVal = (document.getElementById('advPdSettleAmt') || {}).value;
    var sVal = (document.getElementById('advPdSettleSign') || {}).value;
    var rVal = (document.getElementById('advPdSettleRemarks') || {}).value;
    var errEl = document.getElementById('advPdSettleErr');
    var res = settlePendingDiff(id, { date: dVal, amount: Number(aVal), signedBy: sVal, remarks: rVal });
    if (res && res.ok) {
      openPendingDiffVoucherModal(id);
    } else if (errEl) {
      errEl.textContent = (res && res.error === 'EXCEEDS_BALANCE')
        ? ('Amount cannot exceed pending balance (' + formatINR(res.available) + ').')
        : 'Please enter a valid payout amount.';
      errEl.style.display = 'block';
    }
    return res;
  }

  function buildPendingDiffVoucherDocHtml(rec, mode) {
    if (!rec) return '';
    normalizePendingDiffRecord(rec);
    var amtWords = numberToIndianWords(rec.diffAmount) + ' Rupees Only';
    var dateDisplay = formatDisplayDateDDMMYYYY(rec.entryDate);
    var monthDisplay = formatMonthKeyLabel(rec.monthKey);
    var docTitle = 'Cash Adv Voucher - ' + rec.voucherNo + ' - ' + rec.empName;

    var settleRows = '';
    if (Array.isArray(rec.settlements) && rec.settlements.length > 0) {
      settleRows = '<table style="width:100%;border-collapse:collapse;margin-top:10px;font-size:11px">' +
        '<thead><tr style="background:#f8fafc"><th style="border:1px solid #cbd5e1;padding:5px 8px;text-align:left">Pay Date</th><th style="border:1px solid #cbd5e1;padding:5px 8px;text-align:left">Mode</th><th style="border:1px solid #cbd5e1;padding:5px 8px;text-align:left">Director Sign</th><th style="border:1px solid #cbd5e1;padding:5px 8px;text-align:right">Paid Amount</th></tr></thead><tbody>';
      rec.settlements.forEach(function(st) {
        settleRows += '<tr><td style="border:1px solid #cbd5e1;padding:5px 8px">' + esc(formatDisplayDateDDMMYYYY(st.date)) + '</td><td style="border:1px solid #cbd5e1;padding:5px 8px">' + esc(st.mode || 'Cash Adv Voucher') + '</td><td style="border:1px solid #cbd5e1;padding:5px 8px">' + esc(st.signedBy || rec.signedBy) + '</td><td style="border:1px solid #cbd5e1;padding:5px 8px;text-align:right;font-weight:700">' + formatINR(st.amount) + '</td></tr>';
      });
      settleRows += '</tbody></table>';
    }

    var directorsHtml = '<table style="width:100%;border-collapse:collapse;margin-top:26px"><tr>';
    directorsHtml += '<td style="width:24%;text-align:center;vertical-align:bottom;padding:8px 6px"><div style="border-top:1px solid #334155;padding-top:5px;font-size:11px;font-weight:800;color:#111827">' + esc(rec.empName) + '</div><div style="font-size:10px;color:#475569">Receiver Sign (' + esc(rec.empCode) + ')</div></td>';
    SIGNED_BY_OPTIONS.forEach(function(dirName) {
      var isSelected = rec.signedBy === dirName;
      directorsHtml += '<td style="width:25.3%;text-align:center;vertical-align:bottom;padding:8px 6px">' +
        '<div style="font-size:10px;font-weight:800;color:' + (isSelected ? '#0f766e' : '#64748b') + ';margin-bottom:22px">' + (isSelected ? ('✔ Approved (' + esc(dirName) + ')') : '&nbsp;') + '</div>' +
        '<div style="border-top:1px solid #334155;padding-top:5px;font-size:11px;font-weight:800;color:#111827">' + esc(dirName) + '</div>' +
        '<div style="font-size:9.5px;color:#475569">Director · Arora Textiles Pvt. Ltd.</div>' +
      '</td>';
    });
    directorsHtml += '</tr></table>';

    var bodyHtml = '<div style="border:2px solid #1e293b;padding:20px 22px;background:#fff;color:#111827;font-family:Segoe UI,Arial,sans-serif">' +
      '<div style="text-align:center;border-bottom:2px solid #1e293b;padding-bottom:10px;margin-bottom:14px">' +
      '  <div style="font-size:18px;font-weight:900;letter-spacing:1px;color:#0f172a">ARORA TEXTILES PRIVATE LIMITED</div>' +
      '  <div style="font-size:11px;font-weight:700;color:#475569;margin-top:2px">CASH ADVANCE / PENDING DIFF VOUCHER</div>' +
      '</div>' +
      '<table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:12px">' +
      '  <tr>' +
      '    <td style="padding:4px 0"><strong>Voucher No:</strong> <span style="font-family:monospace;font-weight:800">' + esc(rec.voucherNo) + '</span></td>' +
      '    <td style="padding:4px 0;text-align:right"><strong>Date:</strong> ' + esc(dateDisplay) + '</td>' +
      '  </tr>' +
      '  <tr>' +
      '    <td style="padding:4px 0"><strong>Month (Period):</strong> ' + esc(monthDisplay) + '</td>' +
      '    <td style="padding:4px 0;text-align:right"><strong>Category:</strong> ' + esc(rec.category) + '</td>' +
      '  </tr>' +
      '</table>' +
      '<table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:14px">' +
      '  <tr><td style="border:1px solid #cbd5e1;padding:7px 10px;background:#f8fafc;width:28%;font-weight:700">Employee Code</td><td style="border:1px solid #cbd5e1;padding:7px 10px;font-family:monospace;font-weight:800">' + esc(rec.empCode) + '</td><td style="border:1px solid #cbd5e1;padding:7px 10px;background:#f8fafc;width:20%;font-weight:700">Department</td><td style="border:1px solid #cbd5e1;padding:7px 10px">' + esc(rec.department || '-') + '</td></tr>' +
      '  <tr><td style="border:1px solid #cbd5e1;padding:7px 10px;background:#f8fafc;font-weight:700">Payee Name</td><td style="border:1px solid #cbd5e1;padding:7px 10px;font-weight:800">' + esc(rec.empName) + '</td><td style="border:1px solid #cbd5e1;padding:7px 10px;background:#f8fafc;font-weight:700">Designation</td><td style="border:1px solid #cbd5e1;padding:7px 10px">' + esc(rec.designation || '-') + '</td></tr>' +
      '  <tr><td style="border:1px solid #cbd5e1;padding:7px 10px;background:#f8fafc;font-weight:700">Particulars / Reason</td><td colspan="3" style="border:1px solid #cbd5e1;padding:7px 10px">' + esc(rec.remarks || (rec.category + ' for ' + monthDisplay)) + '</td></tr>' +
      '</table>' +
      '<table style="width:100%;border-collapse:collapse;font-size:12.5px;margin-bottom:10px">' +
      '  <tr style="background:#f8fafc"><th style="border:1px solid #cbd5e1;padding:7px 10px;text-align:left">Description</th><th style="border:1px solid #cbd5e1;padding:7px 10px;text-align:right">Amount (₹)</th></tr>' +
      '  <tr><td style="border:1px solid #cbd5e1;padding:7px 10px">Total Pending Diff Amount (' + esc(rec.category) + ' · ' + esc(monthDisplay) + ')</td><td style="border:1px solid #cbd5e1;padding:7px 10px;text-align:right;font-weight:800">' + formatINR(rec.diffAmount) + '</td></tr>' +
      '  <tr><td style="border:1px solid #cbd5e1;padding:7px 10px">Cash Adv Paid / Disbursed</td><td style="border:1px solid #cbd5e1;padding:7px 10px;text-align:right;font-weight:700;color:#15803d">' + formatINR(rec.paidAmount) + '</td></tr>' +
      '  <tr style="background:#fffbeb"><td style="border:1px solid #cbd5e1;padding:7px 10px;font-weight:800">Remaining Pending Diff Balance</td><td style="border:1px solid #cbd5e1;padding:7px 10px;text-align:right;font-weight:900;color:' + (rec.pendingBalance > 0 ? '#dc2626' : '#15803d') + '">' + formatINR(rec.pendingBalance) + ' (' + esc(rec.status) + ')</td></tr>' +
      '</table>' +
      '<div style="font-size:11.5px;padding:6px 10px;background:#f8fafc;border:1px solid #cbd5e1"><strong>Amount in Words:</strong> ' + esc(amtWords) + '</div>' +
      settleRows +
      '<div style="margin-top:14px;font-size:10px;font-weight:800;color:#475569;text-transform:uppercase;letter-spacing:0.6px">Authorized Directors Signatory &amp; Approval</div>' +
      directorsHtml +
    '</div>';

    if (mode === 'fragment') return bodyHtml;
    var ns = mode === 'word' ? ' xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"' : '';
    return '<!DOCTYPE html><html' + ns + '><head><meta charset="utf-8"><title>' + esc(docTitle) + '</title>' +
      '<style>@page{size:A4;margin:14mm;}body{font-family:Segoe UI,Arial,sans-serif;margin:0;padding:12px;color:#111827;background:#fff;}</style>' +
      '</head><body>' + bodyHtml + '</body></html>';
  }

  function openPendingDiffVoucherModal(id) {
    var rec = (state.pendingDiffs || []).find(function(p) { return p && p.id === id; });
    if (!rec) return;
    var modal = getOrCreateModal();
    var previewHtml = buildPendingDiffVoucherDocHtml(rec, 'fragment');
    var c = '';
    c += '<div style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(15,23,42,0.55);backdrop-filter:blur(4px);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px" onclick="if(event.target===this)ATPLAdvanceManager.closeModal()">';
    c += '  <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:16px;max-width:780px;width:100%;max-height:92vh;display:flex;flex-direction:column;box-shadow:0 24px 48px rgba(15,23,42,0.25);overflow:hidden">';
    c += '    <div style="padding:14px 20px;border-bottom:1px solid #e5e7eb;display:flex;justify-content:space-between;align-items:center;background:#f8fafc">';
    c += '      <div><div style="font-size:9px;font-weight:900;color:#0f766e;text-transform:uppercase">ATPL CASH ADV VOUCHER · DIRECTORS AUTHORIZED</div><h3 style="margin:2px 0 0;font-size:17px;font-weight:850;color:#111827">🧾 ' + esc(rec.voucherNo) + ' — ' + esc(rec.empName) + '</h3></div>';
    c += '      <div style="display:flex;gap:8px;align-items:center">';
    c += '        <button type="button" onclick="ATPLAdvanceManager.printPendingDiffVoucher(\'' + esc(rec.id) + '\')" style="padding:7px 14px;background:#312e81;color:#fff;border:none;border-radius:8px;font-size:11px;font-weight:800;cursor:pointer">🖨 Print / PDF</button>';
    c += '        <button type="button" onclick="ATPLAdvanceManager.downloadPendingDiffVoucherDoc(\'' + esc(rec.id) + '\')" style="padding:7px 14px;background:#0f766e;color:#fff;border:none;border-radius:8px;font-size:11px;font-weight:800;cursor:pointer">⬇ Download .doc</button>';
    c += '        <button type="button" onclick="ATPLAdvanceManager.closeModal()" style="border:1px solid #d1d5db;background:#fff;width:30px;height:30px;border-radius:8px;cursor:pointer">✕</button>';
    c += '      </div>';
    c += '    </div>';
    c += '    <div style="padding:18px 22px;overflow:auto;flex:1;background:#f1f5f9">' + previewHtml + '</div>';
    c += '    <div style="padding:12px 20px;border-top:1px solid #e5e7eb;display:flex;justify-content:flex-end;gap:8px;background:#fff">';
    if (rec.pendingBalance > 0) {
      c += '      <button type="button" onclick="ATPLAdvanceManager.openSettlePendingDiffModal(\'' + esc(rec.id) + '\')" style="padding:8px 14px;background:#b45309;color:#fff;border:none;border-radius:8px;font-size:11.5px;font-weight:800;cursor:pointer">💸 Pay / Settle Amount</button>';
    }
    c += '      <button type="button" onclick="ATPLAdvanceManager.closeModal()" style="padding:8px 16px;background:#312e81;color:#fff;border:none;border-radius:8px;font-size:11.5px;font-weight:800;cursor:pointer">Close</button>';
    c += '    </div>';
    c += '  </div>';
    c += '</div>';
    modal.innerHTML = c;
  }

  function downloadPendingDiffVoucherDoc(id) {
    var rec = (state.pendingDiffs || []).find(function(p) { return p && p.id === id; });
    if (!rec) return false;
    var html = buildPendingDiffVoucherDocHtml(rec, 'word');
    var safeName = String(rec.voucherNo + '_' + rec.empCode + '_' + rec.empName).replace(/[^a-zA-Z0-9_-]+/g, '_');
    var filename = 'Cash_Adv_Voucher_' + safeName + '.doc';
    try {
      if (typeof window.Blob === 'function' && window.URL && typeof window.URL.createObjectURL === 'function' && document && document.createElement) {
        var blob = new window.Blob(['\ufeff', html], { type: 'application/msword;charset=utf-8' });
        var url = window.URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function() { try { window.URL.revokeObjectURL(url); } catch (_) {} }, 1500);
      }
      if (window.showToast) window.showToast('⬇ Downloaded ' + filename);
      return { ok: true, filename: filename, html: html };
    } catch (_) {
      return false;
    }
  }

  function printPendingDiffVoucher(id) {
    var rec = (state.pendingDiffs || []).find(function(p) { return p && p.id === id; });
    if (!rec) return false;
    var docHtml = buildPendingDiffVoucherDocHtml(rec, 'print');
    try {
      var old = document.getElementById('atplPendingDiffPrintFrame');
      if (old && old.parentNode) old.parentNode.removeChild(old);
      var iframe = document.createElement('iframe');
      iframe.id = 'atplPendingDiffPrintFrame';
      iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
      document.body.appendChild(iframe);
      var cw = iframe.contentWindow;
      var cdoc = cw ? cw.document : iframe.contentDocument;
      if (cdoc) {
        cdoc.open();
        cdoc.write(docHtml);
        cdoc.close();
      }
      setTimeout(function() {
        try { if (cw) { cw.focus(); cw.print(); } } catch (_) {}
      }, 150);
      return true;
    } catch (_) {
      return false;
    }
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
    getAllPendingDiffs: function() { return state.pendingDiffs; },
    getPendingDiffMonthlySummary: getPendingDiffMonthlySummary,
    getEmployeeOutstandingBalance: getEmployeeOutstandingBalance,
    getEmployeeHistoryData: getEmployeeHistoryData,
    getMonthAnalytics: getMonthAnalytics,
    detectAdvanceSheetInfo: detectAdvanceSheetInfo,
    addOrUpdateAdvance: addOrUpdateAdvance,
    deleteAdvance: deleteAdvance,
    deleteEmployeeLedger: deleteEmployeeLedger,
    confirmDeleteEmployeeLedger: confirmDeleteEmployeeLedger,
    deductAdvanceManually: deductAdvanceManually,
    deleteDeduction: deleteDeduction,
    confirmDeleteDeduction: confirmDeleteDeduction,
    addOrUpdatePendingDiff: addOrUpdatePendingDiff,
    settlePendingDiff: settlePendingDiff,
    deletePendingDiff: deletePendingDiff,
    confirmDeletePendingDiff: confirmDeletePendingDiff,
    buildPendingDiffVoucherDocHtml: buildPendingDiffVoucherDocHtml,
    openPendingDiffModal: openPendingDiffModal,
    openPendingDiffFeedModal: openPendingDiffFeedModal,
    openPendingDiffVoucherModal: openPendingDiffVoucherModal,
    openSettlePendingDiffModal: openSettlePendingDiffModal,
    onPendingDiffCodeInput: onPendingDiffCodeInput,
    selectPendingDiffSuggestion: selectPendingDiffSuggestion,
    submitPendingDiffForm: submitPendingDiffForm,
    updatePendingDiffFeedCell: updatePendingDiffFeedCell,
    addPendingDiffFeedRows: addPendingDiffFeedRows,
    removePendingDiffFeedRow: removePendingDiffFeedRow,
    parsePendingDiffFeedPaste: parsePendingDiffFeedPaste,
    submitPendingDiffFeedBatch: submitPendingDiffFeedBatch,
    submitPendingDiffFeed: submitPendingDiffFeed,
    submitSettlePendingDiff: submitSettlePendingDiff,
    downloadPendingDiffVoucherDoc: downloadPendingDiffVoucherDoc,
    printPendingDiffVoucher: printPendingDiffVoucher,
    processSalaryFile: processSalaryFile,
    processAllSalaryFiles: processAllSalaryFiles,
    renderUI: renderUI,
    exportDataCSV: exportDataCSV,
    setTab: function(tab) {
      state.activeTab = tab;
      renderUI();
    },
    setSelectedMonth: function(monthKey) {
      if (monthKey && /^\d{4}-\d{2}$/.test(String(monthKey))) {
        state.selectedMonth = String(monthKey);
        state.selectedDateFilter = '';
        renderUI();
      }
    },
    shiftSelectedMonth: function(delta) {
      var m = String(state.selectedMonth || new Date().toISOString().slice(0, 7)).match(/^(\d{4})-(\d{2})$/);
      if (!m) return;
      var d = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1 + (delta || 0), 1);
      state.selectedMonth = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
      state.selectedDateFilter = '';
      renderUI();
    },
    setSelectedDate: function(dateStr) {
      var clean = String(dateStr || '').trim();
      if (clean && /^\d{4}-\d{2}-\d{2}$/.test(clean)) {
        state.selectedDateFilter = clean;
        state.selectedMonth = clean.slice(0, 7);
      } else {
        state.selectedDateFilter = '';
      }
      renderUI();
    },
    toggleFilterTablesByMonth: function(flag) {
      state.filterTablesByMonth = !!flag;
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
    setPendingDiffStatusFilter: function(st) {
      state.pendingDiffStatusFilter = st || 'ALL';
      renderUI();
    },
    setPendingDiffCategoryFilter: function(cat) {
      state.pendingDiffCategoryFilter = cat || 'ALL';
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
    openCashVoucherModal: openCashVoucherModal,
    openMonthFeedModal: openMonthFeedModal,
    closeModal: closeModal,
    onCodeInput: onCodeInput,
    selectSuggestion: selectSuggestion,
    onManualCodeInput: onManualCodeInput,
    selectManualSuggestion: selectManualSuggestion,
    onManualTargetChange: onManualTargetChange,
    onCashVoucherCodeInput: onCashVoucherCodeInput,
    selectCashVoucherSuggestion: selectCashVoucherSuggestion,
    onCashVoucherTargetChange: onCashVoucherTargetChange,
    updateCashVoucherPreview: updateCashVoucherPreview,
    updateMonthFeedCell: updateMonthFeedCell,
    addMonthFeedRows: addMonthFeedRows,
    removeMonthFeedRow: removeMonthFeedRow,
    parseMonthFeedPaste: parseMonthFeedPaste,
    submitMonthFeedBatch: submitMonthFeedBatch,
    submitMonthFeed: submitMonthFeed,
    submitForm: submitForm,
    submitManualDeduction: submitManualDeduction,
    submitCashVoucher: submitCashVoucher,
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
          window.showToast('✅ Synchronized ' + state.advances.length + ' advances, ' + state.deductions.length + ' deductions & ' + state.pendingDiffs.length + ' pending diffs from cloud!');
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
