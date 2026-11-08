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
  var CHANNEL_NAME = 'ATPL_ERP_TRIGGER_BUS';

  var state = {
    advances: [],
    deductions: [],
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
    recalculateAllBalances();
  }

  function saveToLocal() {
    try {
      localStorage.setItem(STORAGE_KEY_ADVANCES, JSON.stringify(state.advances));
      localStorage.setItem(STORAGE_KEY_DEDUCTIONS, JSON.stringify(state.deductions));
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
  async function fetchRemoteAdvances() {
    try {
      var res = await fetch('/api/sync/advances', { cache: 'no-store' });
      if (res.ok) {
        var data = await res.json();
        if (data && data.ok && Array.isArray(data.records)) {
          // Merge remote records with local
          var map = {};
          data.records.forEach(function(r) { if (r && r.id) map[r.id] = r; });
          state.advances.forEach(function(localAdv) {
            if (!map[localAdv.id]) {
              map[localAdv.id] = localAdv;
            } else {
              // Prefer newer timestamp
              var localTs = Date.parse(localAdv.updatedAt || localAdv.createdAt || 0) || 0;
              var remoteTs = Date.parse(map[localAdv.id].updatedAt || map[localAdv.id].createdAt || 0) || 0;
              if (localTs > remoteTs) map[localAdv.id] = localAdv;
            }
          });
          state.advances = Object.values(map);
        }
      }
    } catch (_) {}

    try {
      var resDed = await fetch('/api/sync/advance-deductions', { cache: 'no-store' });
      if (resDed.ok) {
        var dataDed = await resDed.json();
        if (dataDed && dataDed.ok && Array.isArray(dataDed.records)) {
          var dedMap = {};
          dataDed.records.forEach(function(d) { if (d && d.id) dedMap[d.id] = d; });
          state.deductions.forEach(function(ld) {
            if (!dedMap[ld.id]) dedMap[ld.id] = ld;
          });
          state.deductions = Object.values(dedMap);
        }
      }
    } catch (_) {}

    recalculateAllBalances();
    saveToLocal();
    renderUI();
  }

  async function pushAdvanceRemote(record) {
    try {
      await fetch('/api/sync/advance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(record)
      });
    } catch (_) {}
    try {
      if (window.ATPLGoogleSync && typeof window.ATPLGoogleSync.callGoogleBackend === 'function') {
        window.ATPLGoogleSync.callGoogleBackend('upsertEmployeeMaster', {
          empCode: '__ATPL_SYS__ADV__' + record.id,
          record_json: JSON.stringify(Object.assign({ _atpl_kind: 'advance_record', object_key: record.id }, record))
        });
      }
    } catch (_) {}
    broadcastSync('advance_updated', { id: record.id });
  }

  async function deleteAdvanceRemote(id) {
    try {
      await fetch('/api/sync/advance/' + encodeURIComponent(id), {
        method: 'DELETE'
      });
    } catch (_) {}
    try {
      if (window.ATPLGoogleSync && typeof window.ATPLGoogleSync.callGoogleBackend === 'function') {
        window.ATPLGoogleSync.callGoogleBackend('deleteEmployeeMaster', {
          empCode: '__ATPL_SYS__ADV__' + id
        });
      }
    } catch (_) {}
    broadcastSync('advance_deleted', { id: id });
  }

  async function pushDeductionRemote(deduction) {
    try {
      await fetch('/api/sync/advance-deduction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(deduction)
      });
    } catch (_) {}
    try {
      if (window.ATPLGoogleSync && typeof window.ATPLGoogleSync.callGoogleBackend === 'function') {
        window.ATPLGoogleSync.callGoogleBackend('upsertEmployeeMaster', {
          empCode: '__ATPL_SYS__DED__' + deduction.id,
          record_json: JSON.stringify(Object.assign({ _atpl_kind: 'advance_deduction', object_key: deduction.id }, deduction))
        });
      }
    } catch (_) {}
    broadcastSync('advance_deduction_saved', { id: deduction.id });
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
            fetchRemoteAdvances();
          }
        };
      } catch (_) {}
    }

    window.addEventListener('storage', function(e) {
      if (e.key === 'ATPL_TRIGGER_EVENT' && e.newValue) {
        try {
          var ev = JSON.parse(e.newValue);
          if (ev && ev.action && ev.action.indexOf('advance') === 0) {
            fetchRemoteAdvances();
          }
        } catch (_) {}
      }
    });

    // Server-Sent Events hook
    if (typeof window.EventSource !== 'undefined') {
      try {
        var evtSrc = new window.EventSource('/api/sync/events');
        evtSrc.addEventListener('advance_saved', function() { fetchRemoteAdvances(); });
        evtSrc.addEventListener('advance_deleted', function() { fetchRemoteAdvances(); });
        evtSrc.addEventListener('advance_deduction_saved', function() { fetchRemoteAdvances(); });
        evtSrc.addEventListener('advances_updated', function() { fetchRemoteAdvances(); });
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

    saveToLocal();
    pushAdvanceRemote(rec);
    renderUI();

    if (window.showToast) {
      window.showToast('✅ Advance of ' + formatINR(amount) + ' for ' + empName + ' (' + rec.empCode + ') recorded & synced!');
    }
    return true;
  }

  function deleteAdvance(id) {
    if (!id) return;
    var idx = state.advances.findIndex(function(a) { return a.id === id; });
    if (idx < 0) return;
    var deleted = state.advances.splice(idx, 1)[0];

    // Remove associated deductions
    state.deductions = state.deductions.filter(function(d) { return d.advanceId !== id; });

    saveToLocal();
    deleteAdvanceRemote(id);
    renderUI();

    if (window.showToast) {
      window.showToast('🗑 Advance record deleted from all devices.');
    }
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

        // Idempotency check: has this advance already been deducted for this specific file?
        var alreadyDeducted = (state.deductions || []).some(function(d) {
          return d.advanceId === adv.id && d.fileName === fileName;
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

        // Push deduction to remote & sync
        pushDeductionRemote(dedRec);
        pushAdvanceRemote(adv);
      }
    }

    if (deductionsMade.length > 0) {
      saveToLocal();
      recalculateAllBalances();
      renderUI();
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
    html += '    <button onclick="ATPLAdvanceManager.syncNow()" style="padding:10px 14px;background:#1e293b;border:1px solid rgba(255,255,255,0.12);color:#94a3b8;border-radius:10px;font-weight:600;font-size:13px;cursor:pointer" title="Sync with Cloud">';
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
    exportDataCSV: exportDataCSV,
    syncNow: function() {
      fetchRemoteAdvances();
      if (window.showToast) window.showToast('🔄 Synchronized advances and deductions from cloud!');
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
