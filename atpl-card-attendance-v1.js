/**
 * ATPL CARD MANPOWER & MONTHLY ATTENDANCE SYNC (V1.0)
 * Imports / syncs Monthly Attendance from the Production ERP (erp-system-ui / Export Excel / Live API Bridge / All Files),
 * groups by Card (Card-1 .. Card-13, Washing, Dying, Blending, Shorting) using Machine Code & Employee Master,
 * displays Card-wise Total Admi (unique headcount), Total Duty Units (1/1.5/2), Day/Night shift counts,
 * and syncs snapshots via Google Drive + Express server across browsers.
 */
(function (root) {
  'use strict';

  var MODULE_VERSION = '2026.11.24-card-attendance-v1';
  if (root.__ATPL_CARD_ATTENDANCE_INIT__ === MODULE_VERSION) return;
  root.__ATPL_CARD_ATTENDANCE_INIT__ = MODULE_VERSION;

  var STORAGE_KEY = 'ATPL_CardAttendanceV1';
  var TOMB_KEY = 'ATPL_CardAttendanceTombstonesV1';
  var LAST_SYNC_KEY = 'ATPL_CardAttendanceLastSyncV1';
  var DRIVE_FILE = 'ATPL_CARD_ATTENDANCE_SYNC_V1.json';
  var DEFAULT_GAS_URL = 'https://script.google.com/macros/s/AKfycbxiaKVtVJUWqDPtI-9iecG0LE817SfbbQNfUaZouw8sgYr3f1zRffutMu_UGnV-vqy-oA/exec';
  var DEFAULT_OTHER_ERP_URL = 'https://erp-system-ui-515975426507.asia-south1.run.app';
  var CHANNEL_NAME = 'ATPL_ERP_TRIGGER_BUS';
  var CLIENT_ID = 'cardatt_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);

  var MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

  var state = {
    months: {},       // "YYYY-MM" -> { monthKey, month, year, source, updatedAt, syncedFrom, rows: [...] }
    tombstones: {},   // monthKey -> deletedAt ISO
    activeMonthKey: '',
    selectedCard: 'ALL',
    selectedDay: 'LATEST', // 'ALL' | 'LATEST' | 1..31
    shiftFilter: 'ALL',    // 'ALL' | 'D' | 'N'
    searchQuery: '',
    viewMode: 'summary',   // 'summary' | 'matrix' | 'workers'
    syncing: false,
    syncText: 'Ready',
    lastSyncAt: ''
  };

  var stylesInjected = false;
  var listenersBound = false;
  var syncInFlight = null;

  function safeJsonParse(s, fallback) {
    try { return JSON.parse(s); } catch (_) { return fallback; }
  }

  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function dateMs(v) {
    if (typeof v === 'number' && isFinite(v)) return v;
    if (!v) return 0;
    var n = Date.parse(String(v));
    return isFinite(n) ? n : 0;
  }

  function notify(msg) {
    try {
      if (typeof root.showToast === 'function') {
        root.showToast(msg);
        return;
      }
    } catch (_) {}
    var doc = root.document;
    if (!doc || !doc.body) return;
    var el = doc.getElementById('caToastBox');
    if (!el) {
      el = doc.createElement('div');
      el.id = 'caToastBox';
      el.className = 'ca-toast';
      doc.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.classList.remove('show'); }, 3500);
  }

  function isServerAvailable() {
    try {
      var host = String(root.location && root.location.hostname || '').toLowerCase();
      var proto = String(root.location && root.location.protocol || '');
      if (!/^https?:$/.test(proto)) return false;
      return host === 'localhost' || host === '127.0.0.1' || /\.run\.app$/i.test(host);
    } catch (_) {
      return false;
    }
  }

  function getGasUrl() {
    try {
      var custom = root.localStorage && root.localStorage.getItem('ATPL_CUSTOM_GAS_URL');
      if (custom && /^https:\/\/script\.google\.com\/macros\/s\//.test(custom.trim())) return custom.trim();
      if (root.ATPL_CUSTOM_GAS_URL && /^https:\/\/script\.google\.com\/macros\/s\//.test(String(root.ATPL_CUSTOM_GAS_URL).trim())) {
        return String(root.ATPL_CUSTOM_GAS_URL).trim();
      }
      if (root.ATPL_GAS_URL && /^https:\/\/script\.google\.com\/macros\/s\//.test(String(root.ATPL_GAS_URL).trim())) {
        return String(root.ATPL_GAS_URL).trim();
      }
      if (root.ATPLGoogleSync && root.ATPLGoogleSync.gasUrl && /^https:\/\/script\.google\.com\/macros\/s\//.test(String(root.ATPLGoogleSync.gasUrl).trim())) {
        return String(root.ATPLGoogleSync.gasUrl).trim();
      }
    } catch (_) {}
    return DEFAULT_GAS_URL;
  }

  function readStorageJson(key, fallback) {
    try {
      var raw = root.localStorage && root.localStorage.getItem(key);
      if (!raw) return fallback;
      var parsed = JSON.parse(raw);
      return (parsed && typeof parsed === 'object') ? parsed : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function writeStorageJson(key, val) {
    try {
      if (!root.localStorage) return;
      root.__ATPL_INTERNAL_STORAGE_WRITE = true;
      try {
        root.localStorage.setItem(key, JSON.stringify(val));
      } finally {
        root.__ATPL_INTERNAL_STORAGE_WRITE = false;
      }
    } catch (_) {}
  }

  function stripFromWindowFiles() {
    try {
      if (!Array.isArray(root.FILES)) return;
      root.FILES = root.FILES.filter(function (f) {
        if (!f || !f.name) return true;
        return String(f.name).toLowerCase().trim() !== DRIVE_FILE.toLowerCase();
      });
    } catch (_) {}
  }

  async function utf8ToBase64(str) {
    var input = String(str || '');
    if (typeof root.Blob !== 'undefined' && typeof root.FileReader !== 'undefined') {
      var blob = new root.Blob([input], { type: 'application/json;charset=utf-8' });
      return await new Promise(function (resolve, reject) {
        var r = new root.FileReader();
        r.onload = function () {
          var res = String(r.result || '');
          var idx = res.indexOf(',');
          resolve(idx >= 0 ? res.slice(idx + 1) : res);
        };
        r.onerror = function () { reject(r.error || new Error('Encode error')); };
        r.readAsDataURL(blob);
      });
    }
    if (typeof Buffer !== 'undefined') return Buffer.from(input, 'utf8').toString('base64');
    return btoa(unescape(encodeURIComponent(input)));
  }

  function base64ToUtf8(b64) {
    var clean = String(b64 || '').replace(/^data:[^;]+;base64,/, '').trim();
    if (!clean) return '';
    if (typeof Buffer !== 'undefined' && typeof atob === 'undefined') {
      return Buffer.from(clean, 'base64').toString('utf8');
    }
    var bin = atob(clean);
    if (typeof TextDecoder !== 'undefined') {
      var bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new TextDecoder('utf-8').decode(bytes);
    }
    try { return decodeURIComponent(escape(bin)); } catch (_) { return bin; }
  }

  async function callGas(action, params, timeoutMs) {
    var endpoint = getGasUrl();
    if (!endpoint || typeof root.fetch !== 'function') return { ok: false, error: 'GAS unavailable' };
    var payload = Object.assign({ action: action, sender: CLIENT_ID, _ts: Date.now() }, params || {});
    var ctrl = (typeof root.AbortController !== 'undefined') ? new root.AbortController() : null;
    var timer = ctrl ? setTimeout(function () { try { ctrl.abort(); } catch (_) {} }, timeoutMs || 32000) : null;
    try {
      var res = await root.fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload),
        signal: ctrl ? ctrl.signal : undefined
      });
      if (timer) clearTimeout(timer);
      if (!res || !res.ok) return { ok: false, error: 'HTTP ' + (res ? res.status : 'err') };
      return safeJsonParse(await res.text(), { ok: false, error: 'Invalid JSON' });
    } catch (e) {
      if (timer) clearTimeout(timer);
      return { ok: false, error: (e && e.message) || 'Network error' };
    }
  }

  // ── Employee Master & Card Normalization ──
  function getEmpMasterList() {
    if (Array.isArray(root.EMP_MASTER_DATA) && root.EMP_MASTER_DATA.length) return root.EMP_MASTER_DATA;
    try {
      if (typeof root.emGetList === 'function') {
        var list = root.emGetList();
        if (Array.isArray(list) && list.length) return list;
      }
    } catch (_) {}
    var stored = readStorageJson('ATPL_EMP_MASTER_V1', null);
    if (Array.isArray(stored) && stored.length) return stored;
    return [];
  }

  function buildEmpMasterMap() {
    var map = {};
    getEmpMasterList().forEach(function (e) {
      if (!e || !e.emp_id) return;
      map[String(e.emp_id).trim().toUpperCase()] = e;
    });
    return map;
  }

  function normalizeCardLabel(raw) {
    var s = String(raw || '').trim();
    if (!s) return '';
    var upper = s.toUpperCase().replace(/\s+/g, ' ');
    // Match "CARD NO 01", "CARD NO. 1", "CARD-1", "CARD NO-12", "CARD-13 RANJEET", "CARD 5"
    var m = upper.match(/^CARD(?:\s*NO\.?)?[\s-]*0*(\d+)(?:\b.*)?$/i);
    if (m) return 'Card-' + parseInt(m[1], 10);
    // Match Machine Code prefix C1C, C1O, C1B1, C2A, C13M, etc.
    var mc = upper.match(/^C0*(\d+)[A-Z0-9_-]*$/i);
    if (mc) return 'Card-' + parseInt(mc[1], 10);
    if (/PAKKI\s*WASHING|WASHING/i.test(upper)) return 'Washing';
    if (/KACHI\s*WASHING|\bK\.?W\b/i.test(upper)) return 'Kachi Washing';
    if (/DYING|DYEING/i.test(upper)) return 'Dying';
    if (/BLENDING/i.test(upper)) return 'Blending';
    if (/SHORTING|SORTING/i.test(upper)) return 'Shorting';
    if (/BOOKLAY|CONDEN[CS]ER/i.test(upper)) return 'Booklay / Condenser';
    if (/OFF\s*STAFF|STAFF/i.test(upper)) return 'Staff';
    if (/CONSTRUCTION/i.test(upper)) return 'Construction';
    return s;
  }

  function resolveRowCard(row, empMap) {
    if (row.card) {
      var explicit = normalizeCardLabel(row.card);
      if (explicit) return explicit;
    }
    if (row.location_name || row.locationName) {
      var loc = normalizeCardLabel(row.location_name || row.locationName);
      if (loc) return loc;
    }
    if (row.machine_code || row.machineCode) {
      var mc = String(row.machine_code || row.machineCode).trim();
      var mcCard = normalizeCardLabel(mc);
      if (/^Card-\d+$/i.test(mcCard)) return mcCard;
    }
    var code = String(row.emp_code || row.empCode || '').trim().toUpperCase();
    var emp = code && empMap ? empMap[code] : null;
    if (emp) {
      var c1 = normalizeCardLabel(emp.cat1 || emp.cat2 || '');
      if (c1) return c1;
    }
    return 'Unassigned / Other';
  }

  function cardSortRank(name) {
    var m = String(name || '').match(/^Card-(\d+)$/i);
    if (m) return [0, parseInt(m[1], 10), name];
    if (name === 'Unassigned / Other') return [2, 9999, name];
    return [1, 0, String(name || '')];
  }

  function sortCardNames(names) {
    return names.slice().sort(function (a, b) {
      var ra = cardSortRank(a);
      var rb = cardSortRank(b);
      if (ra[0] !== rb[0]) return ra[0] - rb[0];
      if (ra[1] !== rb[1]) return ra[1] - rb[1];
      return String(ra[2]).localeCompare(String(rb[2]));
    });
  }

  function parseDayNum(v) {
    if (v === null || v === undefined || v === '' || v === '-' || v === '—' || v === 'A' || v === 'AB') return 0;
    if (typeof v === 'number') return isFinite(v) && v > 0 ? v : 0;
    var s = String(v).trim().toUpperCase();
    if (!s || s === '-' || s === 'A' || s === 'AB' || s === 'WO' || s === 'OFF') return 0;
    if (s === 'P') return 1;
    if (s === 'H' || s === 'HD') return 0.5;
    var num = parseFloat(s);
    if (!isNaN(num) && isFinite(num) && num > 0) return num;
    return 0;
  }

  function normalizeShift(v) {
    var s = String(v || '').trim().toUpperCase();
    if (s === 'D' || s === 'DAY' || s === 'SHIFT-D' || s === 'SHIFT D' || s === '1') return 'D';
    if (s === 'N' || s === 'NIGHT' || s === 'SHIFT-N' || s === 'SHIFT N' || s === '2') return 'N';
    return s || 'D';
  }

  // ── Parsers for External ERP Formats (API JSON, Export HTML .xls, XLSX/CSV) ──
  function normalizeExternalApiRecords(apiRows, locationsList, machinesList, month, year) {
    var locMap = {};
    (locationsList || []).forEach(function (l) {
      if (l && l.id != null) locMap[String(l.id)] = l.name || l.code || '';
    });
    var machLocMap = {};
    (machinesList || []).forEach(function (m) {
      if (!m) return;
      var code = String(m.code || m.machine_code || '').trim().toUpperCase();
      var lname = (m.location && m.location.name) || locMap[String(m.location_id)] || '';
      if (code && lname) machLocMap[code] = lname;
    });

    var empMap = buildEmpMasterMap();
    var out = [];
    (apiRows || []).forEach(function (r) {
      if (!r) return;
      if (r.moved_to_machine_code || (r.moved_to_machine && r.moved_to_machine.code)) return;
      var empCode = String(r.employee_code || (r.employee && (r.employee.biometric_id || r.employee.employee_number)) || r.employee_number || '').trim();
      var empName = '';
      if (r.employee) {
        empName = ((r.employee.first_name || '') + ' ' + (r.employee.last_name || '')).trim();
      }
      if (!empName) empName = String(r.employee_name || empCode || '').trim();
      if (!empCode && !empName) return;

      var machineCode = String((r.machine && r.machine.code) || r.machine_code || '').trim();
      var shift = normalizeShift((r.shift && r.shift.name) || r.shift_name || 'D');
      var rawLoc = (r.location && r.location.name) || locMap[String(r.location_id)] || machLocMap[machineCode.toUpperCase()] || '';
      var days = [];
      for (var d = 1; d <= 31; d++) {
        var val = Array.isArray(r.days) ? r.days[d - 1] : r['d' + d];
        days.push(parseDayNum(val));
      }

      var card = resolveRowCard({
        card: rawLoc,
        location_name: rawLoc,
        machine_code: machineCode,
        emp_code: empCode
      }, empMap);

      out.push({
        emp_code: empCode,
        emp_name: empName,
        machine_code: machineCode,
        shift: shift,
        card: card,
        days: days
      });
    });
    var mk = year + '-' + String(month).padStart(2, '0');
    return {
      monthKey: mk,
      month: Number(month),
      year: Number(year),
      source: 'Live ERP API',
      updatedAt: new Date().toISOString(),
      rows: out
    };
  }

  function parseMatrixRows(matrix, fileName, fallbackMonth, fallbackYear) {
    if (!Array.isArray(matrix) || !matrix.length) return null;
    var headerIdx = -1;
    var dayCols = {}; // dayNumber 1..31 -> colIndex
    var empCodeCol = -1, empNameCol = -1, machineCol = -1, shiftCol = -1, cardCol = -1;

    for (var r = 0; r < Math.min(matrix.length, 15); r++) {
      var row = matrix[r];
      if (!Array.isArray(row)) continue;
      var foundDays = 0;
      var tmpDayCols = {};
      var ec = -1, en = -1, mc = -1, sc = -1, cc = -1;
      for (var c = 0; c < row.length; c++) {
        var cell = String(row[c] == null ? '' : row[c]).trim();
        var low = cell.toLowerCase();
        if (/^(emp\.?\s*code|employee\s*code|emp\.?\s*id|biometric\s*id)$/i.test(cell)) ec = c;
        else if (/^(employee|employee\s*name|emp\.?\s*name|name)$/i.test(cell)) en = c;
        else if (/^(machine\s*code|machine|m\/c)$/i.test(cell)) mc = c;
        else if (/^(shift|shift\s*name)$/i.test(cell)) sc = c;
        else if (/^(card|card\s*no|location|category|cat1)$/i.test(cell)) cc = c;
        else if (/^\d{1,2}$/.test(cell)) {
          var dn = parseInt(cell, 10);
          if (dn >= 1 && dn <= 31 && tmpDayCols[dn] === undefined) {
            tmpDayCols[dn] = c;
            foundDays++;
          }
        }
      }
      if (foundDays >= 10 && (en >= 0 || ec >= 0)) {
        headerIdx = r;
        dayCols = tmpDayCols;
        empCodeCol = ec;
        empNameCol = en;
        machineCol = mc;
        shiftCol = sc;
        cardCol = cc;
        break;
      }
    }

    if (headerIdx < 0) return null;
    var empMap = buildEmpMasterMap();
    var parsedRows = [];

    // Try extracting month/year from filename or top rows
    var month = Number(fallbackMonth) || (new Date().getMonth() + 1);
    var year = Number(fallbackYear) || new Date().getFullYear();
    var textHead = String(fileName || '') + ' ' + matrix.slice(0, headerIdx).map(function (x) { return (x || []).join(' '); }).join(' ');
    var ymMatch = textHead.match(/(20\d{2})[-_\s/]+(\d{1,2})/);
    if (ymMatch) {
      year = parseInt(ymMatch[1], 10);
      month = parseInt(ymMatch[2], 10);
    } else {
      for (var mi = 0; mi < MONTHS.length; mi++) {
        if (new RegExp(MONTHS[mi].slice(0, 3), 'i').test(textHead)) {
          month = mi + 1;
          break;
        }
      }
      var yMatch = textHead.match(/\b(202\d)\b/);
      if (yMatch) year = parseInt(yMatch[1], 10);
    }

    for (var i = headerIdx + 1; i < matrix.length; i++) {
      var line = matrix[i];
      if (!Array.isArray(line) || !line.length) continue;
      var rawName = empNameCol >= 0 ? String(line[empNameCol] == null ? '' : line[empNameCol]).trim() : '';
      var rawCode = empCodeCol >= 0 ? String(line[empCodeCol] == null ? '' : line[empCodeCol]).trim() : '';
      if (!rawName && !rawCode) continue;
      if (/^(total|grand\s*total|employee\s*salary\s*summary|#)$/i.test(rawName || rawCode)) break;

      // Support "25492 — GULAB CHAND" combined format
      if (!rawCode && rawName) {
        var splitM = rawName.match(/^(\d{3,8})\s*[—–-]\s*(.+)$/);
        if (splitM) {
          rawCode = splitM[1].trim();
          rawName = splitM[2].trim();
        }
      } else if (rawName && rawCode && rawName.indexOf(rawCode) === 0) {
        rawName = rawName.replace(new RegExp('^' + rawCode + '\\s*[—–-]?\\s*'), '').trim() || rawName;
      }

      var mCode = machineCol >= 0 ? String(line[machineCol] == null ? '' : line[machineCol]).trim() : '';
      var shift = shiftCol >= 0 ? normalizeShift(line[shiftCol]) : 'D';
      var rawCard = cardCol >= 0 ? String(line[cardCol] == null ? '' : line[cardCol]).trim() : '';
      var days = [];
      for (var d = 1; d <= 31; d++) {
        var col = dayCols[d];
        days.push(col !== undefined ? parseDayNum(line[col]) : 0);
      }

      var card = resolveRowCard({
        card: rawCard,
        machine_code: mCode,
        emp_code: rawCode
      }, empMap);

      parsedRows.push({
        emp_code: rawCode,
        emp_name: rawName || rawCode,
        machine_code: mCode,
        shift: shift,
        card: card,
        days: days
      });
    }

    if (!parsedRows.length) return null;
    var mk = year + '-' + String(month).padStart(2, '0');
    return {
      monthKey: mk,
      month: month,
      year: year,
      source: fileName || 'Uploaded Sheet',
      updatedAt: new Date().toISOString(),
      rows: parsedRows
    };
  }

  function parseHtmlTableExport(htmlStr, fileName, fallbackMonth, fallbackYear) {
    if (typeof root.DOMParser === 'undefined' && !/<tr[\s>]/i.test(htmlStr)) return null;
    var matrix = [];
    if (typeof root.DOMParser !== 'undefined') {
      var doc = new root.DOMParser().parseFromString(htmlStr, 'text/html');
      var trs = doc.querySelectorAll('table tr');
      for (var i = 0; i < trs.length; i++) {
        var cells = trs[i].querySelectorAll('th,td');
        var row = [];
        for (var j = 0; j < cells.length; j++) row.push((cells[j].textContent || '').trim());
        if (row.length) matrix.push(row);
      }
    } else {
      // Lightweight regex parser for Node VM tests without DOMParser
      var trMatches = String(htmlStr || '').match(/<tr\b[\s\S]*?<\/tr>/gi) || [];
      trMatches.forEach(function (tr) {
        var cells = tr.match(/<t[dh]\b[\s\S]*?<\/t[dh]>/gi) || [];
        var row = cells.map(function (c) { return c.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); });
        if (row.length) matrix.push(row);
      });
    }
    return parseMatrixRows(matrix, fileName, fallbackMonth, fallbackYear);
  }

  async function parseUploadedAttendanceFile(file, fallbackMonth, fallbackYear) {
    var name = file && file.name ? file.name : 'Attendance.xlsx';
    var buf = await file.arrayBuffer();
    // 1. Check if it is an HTML-based .xls export (like MonthlyAttendance Export Excel)
    var headStr = '';
    try {
      var u8 = new Uint8Array(buf.slice(0, 4096));
      headStr = new TextDecoder('utf-8').decode(u8);
    } catch (_) {}

    if (/<html|<table|<tr/i.test(headStr)) {
      var fullHtml = new TextDecoder('utf-8').decode(new Uint8Array(buf));
      var parsedHtml = parseHtmlTableExport(fullHtml, name, fallbackMonth, fallbackYear);
      if (parsedHtml) return parsedHtml;
    }

    // 2. Otherwise use XLSX if available
    if (root.XLSX) {
      var wb = root.XLSX.read(buf, { type: 'array' });
      for (var i = 0; i < wb.SheetNames.length; i++) {
        var ws = wb.Sheets[wb.SheetNames[i]];
        var mat = root.XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
        var parsed = parseMatrixRows(mat, name, fallbackMonth, fallbackYear);
        if (parsed) return parsed;
      }
    }
    throw new Error('Could not find Monthly Attendance columns (Emp Code / Employee / Days 1-31) in ' + name);
  }

  // ── Pure Calculation Engine: Card-wise Total Admi & Duty Counts ──
  function computeCardMetrics(monthSnapshot, selectedDay, shiftFilter) {
    var rows = (monthSnapshot && Array.isArray(monthSnapshot.rows)) ? monthSnapshot.rows : [];
    var empMap = buildEmpMasterMap();
    var dayTotals = new Array(31).fill(0);
    var dayUniqueSets = [];
    for (var i = 0; i < 31; i++) dayUniqueSets.push({});

    var filteredRows = rows.filter(function (r) {
      if (!r) return false;
      if (shiftFilter && shiftFilter !== 'ALL' && normalizeShift(r.shift) !== shiftFilter) return false;
      return true;
    });

    // Determine effective day
    var lastActiveDay = 1;
    filteredRows.forEach(function (r) {
      var dArr = r.days || [];
      for (var d = 0; d < 31; d++) {
        var val = parseDayNum(dArr[d]);
        if (val > 0) {
          dayTotals[d] += val;
          var uk = String(r.emp_code || r.emp_name || '').trim().toUpperCase();
          if (uk) dayUniqueSets[d][uk] = 1;
          if (d + 1 > lastActiveDay) lastActiveDay = d + 1;
        }
      }
    });

    var effDay = selectedDay === 'LATEST'
      ? lastActiveDay
      : (selectedDay === 'ALL' ? 'ALL' : Math.max(1, Math.min(31, Number(selectedDay) || 1)));

    // Compute Employee Master baseline per Card
    var masterByCard = {};
    Object.keys(empMap).forEach(function (ek) {
      var emp = empMap[ek];
      var cName = normalizeCardLabel(emp.cat1 || emp.cat2 || '');
      if (!cName) return;
      masterByCard[cName] = (masterByCard[cName] || 0) + 1;
    });

    var cardsMap = {};
    function ensureCard(cName) {
      if (!cardsMap[cName]) {
        cardsMap[cName] = {
          name: cName,
          uniqueSet: {},
          dayShiftSet: {},
          nightShiftSet: {},
          totalDuty: 0,
          dayShiftDuty: 0,
          nightShiftDuty: 0,
          machines: {},
          masterCount: masterByCard[cName] || 0,
          dayMatrixTotals: new Array(31).fill(0),
          dayMatrixUnique: Array.from({ length: 31 }, function () { return {}; }),
          rows: []
        };
      }
      return cardsMap[cName];
    }

    // Seed known cards from Employee Master so zero-attendance cards still show up cleanly
    Object.keys(masterByCard).forEach(function (cName) {
      if (/^Card-\d+$/i.test(cName)) ensureCard(cName);
    });

    var globalUnique = {};
    var globalDaySet = {};
    var globalNightSet = {};
    var globalDuty = 0;
    var globalDayDuty = 0;
    var globalNightDuty = 0;

    filteredRows.forEach(function (r) {
      var cName = resolveRowCard(r, empMap);
      var cardObj = ensureCard(cName);
      var empKey = String(r.emp_code || r.emp_name || '').trim().toUpperCase();
      var shift = normalizeShift(r.shift);
      var dArr = r.days || [];

      var rowVal = 0;
      for (var d = 0; d < 31; d++) {
        var dv = parseDayNum(dArr[d]);
        if (dv > 0) {
          cardObj.dayMatrixTotals[d] += dv;
          if (empKey) cardObj.dayMatrixUnique[d][empKey] = 1;
        }
      }

      if (effDay === 'ALL') {
        for (var j = 0; j < 31; j++) rowVal += parseDayNum(dArr[j]);
      } else {
        rowVal = parseDayNum(dArr[effDay - 1]);
      }

      cardObj.rows.push(Object.assign({}, r, { resolvedCard: cName, selectedVal: rowVal }));

      if (rowVal > 0) {
        cardObj.totalDuty += rowVal;
        globalDuty += rowVal;
        if (empKey) {
          cardObj.uniqueSet[empKey] = 1;
          globalUnique[empKey] = 1;
        }
        if (shift === 'D') {
          cardObj.dayShiftDuty += rowVal;
          globalDayDuty += rowVal;
          if (empKey) { cardObj.dayShiftSet[empKey] = 1; globalDaySet[empKey] = 1; }
        } else if (shift === 'N') {
          cardObj.nightShiftDuty += rowVal;
          globalNightDuty += rowVal;
          if (empKey) { cardObj.nightShiftSet[empKey] = 1; globalNightSet[empKey] = 1; }
        }
        if (r.machine_code) {
          var mc = String(r.machine_code).trim().toUpperCase();
          if (!cardObj.machines[mc]) cardObj.machines[mc] = { code: mc, unique: {}, duty: 0 };
          cardObj.machines[mc].duty += rowVal;
          if (empKey) cardObj.machines[mc].unique[empKey] = 1;
        }
      }
    });

    var cardList = sortCardNames(Object.keys(cardsMap)).map(function (cName) {
      var c = cardsMap[cName];
      return {
        name: c.name,
        uniqueAdmi: Object.keys(c.uniqueSet).length,
        dayAdmi: Object.keys(c.dayShiftSet).length,
        nightAdmi: Object.keys(c.nightShiftSet).length,
        totalDuty: Math.round(c.totalDuty * 100) / 100,
        dayShiftDuty: Math.round(c.dayShiftDuty * 100) / 100,
        nightShiftDuty: Math.round(c.nightShiftDuty * 100) / 100,
        masterCount: c.masterCount,
        machines: Object.keys(c.machines).sort().map(function (mk) {
          return {
            code: mk,
            uniqueAdmi: Object.keys(c.machines[mk].unique).length,
            duty: Math.round(c.machines[mk].duty * 100) / 100
          };
        }),
        dayMatrixTotals: c.dayMatrixTotals,
        dayMatrixUniqueCounts: c.dayMatrixUnique.map(function (s) { return Object.keys(s).length; }),
        rows: c.rows
      };
    });

    return {
      effectiveDay: effDay,
      lastActiveDay: lastActiveDay,
      dayTotals: dayTotals.map(function (v) { return Math.round(v * 100) / 100; }),
      dayUniqueCounts: dayUniqueSets.map(function (s) { return Object.keys(s).length; }),
      totalUniqueAdmi: Object.keys(globalUnique).length,
      totalDayAdmi: Object.keys(globalDaySet).length,
      totalNightAdmi: Object.keys(globalNightSet).length,
      totalDuty: Math.round(globalDuty * 100) / 100,
      totalDayDuty: Math.round(globalDayDuty * 100) / 100,
      totalNightDuty: Math.round(globalNightDuty * 100) / 100,
      cards: cardList
    };
  }

  // ── Persistence & Cloud Sync ──
  function mergeSnapshots(baseMonths, overlayMonths, tombs) {
    var out = {};
    function ingest(src) {
      if (!src || typeof src !== 'object') return;
      Object.keys(src).forEach(function (mk) {
        var snap = src[mk];
        if (!snap || !Array.isArray(snap.rows)) return;
        var sTs = dateMs(snap.updatedAt);
        var tTs = tombs && tombs[mk] ? dateMs(tombs[mk]) : 0;
        if (tTs && tTs >= sTs) return;
        if (!out[mk] || sTs >= dateMs(out[mk].updatedAt)) {
          out[mk] = snap;
        }
      });
    }
    ingest(baseMonths);
    ingest(overlayMonths);
    return out;
  }

  function loadLocalState() {
    var raw = readStorageJson(STORAGE_KEY, null);
    var tombs = readStorageJson(TOMB_KEY, {});
    state.tombstones = (tombs && typeof tombs === 'object') ? tombs : {};
    state.months = mergeSnapshots(raw && raw.months ? raw.months : {}, {}, state.tombstones);
    if (!state.activeMonthKey || !state.months[state.activeMonthKey]) {
      var keys = Object.keys(state.months).sort().reverse();
      state.activeMonthKey = keys[0] || '';
    }
    try { state.lastSyncAt = (root.localStorage && root.localStorage.getItem(LAST_SYNC_KEY)) || ''; } catch (_) {}
  }

  function saveLocalState() {
    writeStorageJson(STORAGE_KEY, { version: 1, updatedAt: new Date().toISOString(), months: state.months });
    writeStorageJson(TOMB_KEY, state.tombstones);
    if (state.lastSyncAt && root.localStorage) {
      try { root.localStorage.setItem(LAST_SYNC_KEY, state.lastSyncAt); } catch (_) {}
    }
    updateSidebarBadge();
  }

  function updateSidebarBadge() {
    var doc = root.document;
    if (!doc) return;
    var badge = doc.getElementById('cardAttBadge');
    if (!badge) return;
    var snap = state.activeMonthKey ? state.months[state.activeMonthKey] : null;
    if (!snap) {
      badge.style.display = 'none';
      return;
    }
    var m = computeCardMetrics(snap, state.selectedDay, 'ALL');
    badge.textContent = String(m.totalUniqueAdmi || 0);
    badge.style.display = m.totalUniqueAdmi > 0 ? '' : 'none';
  }

  function dispatchTrigger(action, details) {
    var payload = { action: action, details: details || {}, sender: CLIENT_ID, ts: Date.now() };
    if (typeof root.BroadcastChannel !== 'undefined') {
      try {
        var bc = new root.BroadcastChannel(CHANNEL_NAME);
        bc.postMessage(payload);
        bc.close();
      } catch (_) {}
    }
  }

  async function syncNow(manual) {
    if (syncInFlight) return syncInFlight;
    syncInFlight = (async function () {
      state.syncing = true;
      state.syncText = 'Syncing Google Drive…';
      renderUI();
      try {
        var dlRes = await callGas('downloadFile', { fileName: DRIVE_FILE }, 32000);
        var remote = null;
        if (dlRes && dlRes.ok && dlRes.fileBase64) {
          remote = safeJsonParse(base64ToUtf8(dlRes.fileBase64), null);
        }
        var srvData = null;
        if (isServerAvailable()) {
          try {
            var sRes = await root.fetch('/api/sync/card-attendance');
            if (sRes && sRes.ok) srvData = await sRes.json();
          } catch (_) {}
        }

        // Merge tombstones
        [remote && remote.tombstones, srvData && srvData.tombstones].forEach(function (tb) {
          if (!tb) return;
          Object.keys(tb).forEach(function (k) {
            if (dateMs(tb[k]) > dateMs(state.tombstones[k])) state.tombstones[k] = tb[k];
          });
        });

        state.months = mergeSnapshots(
          mergeSnapshots(remote && remote.months, srvData && srvData.months, state.tombstones),
          state.months,
          state.tombstones
        );
        if (!state.activeMonthKey || !state.months[state.activeMonthKey]) {
          var keys = Object.keys(state.months).sort().reverse();
          state.activeMonthKey = keys[0] || '';
        }

        var payload = {
          version: 1,
          updatedAt: new Date().toISOString(),
          months: state.months,
          tombstones: state.tombstones
        };

        var driveOk = false;
        var b64 = await utf8ToBase64(JSON.stringify(payload));
        var upRes = await callGas('uploadFile', {
          fileName: DRIVE_FILE,
          module: 'vault',
          fileBase64: b64,
          mimeType: 'application/json'
        }, 45000);
        if (upRes && upRes.ok) driveOk = true;

        var srvOk = false;
        if (isServerAvailable()) {
          try {
            var postRes = await root.fetch('/api/sync/card-attendance/bulk', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload)
            });
            srvOk = !!(postRes && postRes.ok);
          } catch (_) {}
        }

        if (driveOk || srvOk) {
          state.lastSyncAt = payload.updatedAt;
          state.syncText = driveOk ? 'Google Drive Synced' : 'Server Synced';
        } else {
          state.syncText = 'Local Ready';
        }

        saveLocalState();
        stripFromWindowFiles();
        renderUI();
        if (manual) notify(driveOk ? 'Card Manpower synced with Google Drive' : 'Card Manpower updated locally');
        return { ok: driveOk || srvOk, months: Object.keys(state.months).length };
      } catch (e) {
        state.syncText = 'Sync Warning';
        if (manual) notify('Sync error: ' + ((e && e.message) || e));
        return { ok: false, error: (e && e.message) || String(e) };
      } finally {
        state.syncing = false;
        syncInFlight = null;
        renderUI();
      }
    })();
    return syncInFlight;
  }

  async function saveMonthSnapshot(snapshot) {
    if (!snapshot || !snapshot.monthKey) return { ok: false };
    snapshot.updatedAt = new Date().toISOString();
    delete state.tombstones[snapshot.monthKey];
    state.months[snapshot.monthKey] = snapshot;
    state.activeMonthKey = snapshot.monthKey;
    state.selectedCard = 'ALL';
    state.selectedDay = 'LATEST';
    saveLocalState();
    renderUI();
    dispatchTrigger('card_attendance_saved', { monthKey: snapshot.monthKey });
    return await syncNow(false);
  }

  // ── Styles ──
  function ensureStyles() {
    var doc = root.document;
    if (!doc || stylesInjected || doc.getElementById('atplCardAttStyles')) {
      stylesInjected = true;
      return;
    }
    stylesInjected = true;
    var css = [
      '#page-cardattendance { background:#f8fafc; color:#0f172a; font-family:Inter,system-ui,-apple-system,sans-serif; }',
      '.ca-wrap { max-width:1460px; margin:0 auto; padding:16px 22px 36px; display:flex; flex-direction:column; gap:14px; }',
      '.ca-header { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:12px; background:#ffffff; border:1px solid #e2e8f0; border-radius:14px; padding:15px 20px; }',
      '.ca-title h1 { margin:0; font-size:20px; font-weight:800; color:#0f172a; letter-spacing:-0.02em; }',
      '.ca-title p { margin:3px 0 0; font-size:12.5px; color:#475569; }',
      '.ca-actions { display:flex; flex-wrap:wrap; align-items:center; gap:8px; }',
      '.ca-btn { display:inline-flex; align-items:center; justify-content:center; gap:6px; height:36px; padding:0 14px; border-radius:10px; font-size:12.5px; font-weight:700; cursor:pointer; border:1px solid #cbd5e1; background:#ffffff; color:#0f172a; font-family:inherit; white-space:nowrap; transition:all .14s; }',
      '.ca-btn:hover { background:#f1f5f9; border-color:#94a3b8; }',
      '.ca-btn-accent { background:#1d4ed8; color:#ffffff; border-color:#1d4ed8; }',
      '.ca-btn-accent:hover { background:#1e40af; border-color:#1e40af; }',
      '.ca-btn-dark { background:#0f172a; color:#ffffff; border-color:#0f172a; }',
      '.ca-btn-dark:hover { background:#1e293b; }',
      '.ca-btn-sm { height:30px; padding:0 10px; font-size:12px; border-radius:8px; }',
      '.ca-input { height:36px; padding:0 11px; border:1px solid #cbd5e1; border-radius:10px; font-size:12.5px; color:#0f172a; background:#ffffff; font-family:inherit; }',

      '.ca-kpis { display:grid; grid-template-columns:repeat(5,minmax(0,1fr)); gap:11px; }',
      '.ca-kpi { background:#ffffff; border:1px solid #cbd5e1; border-radius:12px; padding:13px 15px; display:flex; flex-direction:column; align-items:flex-start; gap:4px; text-align:left; font-family:inherit; cursor:pointer; transition:all .14s; }',
      '.ca-kpi:hover { border-color:#64748b; background:#f8fafc; }',
      '.ca-kpi.active { border-color:#0f172a; box-shadow:0 0 0 1px #0f172a inset; }',
      '.ca-kpi-lbl { font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.04em; color:#475569; }',
      '.ca-kpi-val { font-size:24px; font-weight:800; color:#0f172a; font-variant-numeric:tabular-nums; line-height:1.15; }',
      '.ca-kpi-sub { font-size:11.5px; color:#64748b; font-variant-numeric:tabular-nums; }',

      '.ca-section { background:#ffffff; border:1px solid #e2e8f0; border-radius:14px; padding:15px 18px; display:flex; flex-direction:column; gap:12px; }',
      '.ca-sec-head { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px; }',
      '.ca-sec-title { font-size:12.5px; font-weight:800; text-transform:uppercase; letter-spacing:0.05em; color:#334155; }',

      '.ca-day-strip { display:flex; flex-wrap:wrap; gap:5px; }',
      '.ca-day-btn { min-width:44px; padding:5px 7px; border-radius:8px; border:1px solid #cbd5e1; background:#ffffff; color:#0f172a; cursor:pointer; display:flex; flex-direction:column; align-items:center; gap:2px; font-family:inherit; }',
      '.ca-day-btn:hover { background:#f1f5f9; border-color:#94a3b8; }',
      '.ca-day-btn.active { background:#0f172a; border-color:#0f172a; color:#ffffff; }',
      '.ca-day-btn b { font-size:12px; font-variant-numeric:tabular-nums; }',
      '.ca-day-btn span { font-size:10px; opacity:0.8; font-variant-numeric:tabular-nums; }',

      '.ca-card-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(195px,1fr)); gap:10px; }',
      '.ca-card-btn { display:flex; flex-direction:column; align-items:flex-start; gap:5px; padding:13px 15px; border-radius:12px; border:1px solid #cbd5e1; background:#f8fafc; color:#0f172a; cursor:pointer; text-align:left; font-family:inherit; transition:all .14s; }',
      '.ca-card-btn:hover { border-color:#1d4ed8; background:#eff6ff; }',
      '.ca-card-btn.active { background:#0f172a; border-color:#0f172a; color:#ffffff; }',
      '.ca-card-top { width:100%; display:flex; align-items:center; justify-content:space-between; font-size:14px; font-weight:800; }',
      '.ca-card-admi { font-size:21px; font-weight:800; font-variant-numeric:tabular-nums; line-height:1.1; }',
      '.ca-card-meta { font-size:11.5px; opacity:0.82; font-variant-numeric:tabular-nums; }',
      '.ca-card-bar { width:100%; height:4px; border-radius:4px; background:rgba(148,163,184,0.28); overflow:hidden; margin-top:2px; }',
      '.ca-card-bar > i { display:block; height:100%; background:#10b981; border-radius:4px; }',

      '.ca-table-wrap { overflow:auto; border:1px solid #e2e8f0; border-radius:10px; max-height:520px; }',
      '.ca-table { width:100%; border-collapse:collapse; font-size:12.5px; font-variant-numeric:tabular-nums; }',
      '.ca-table th { position:sticky; top:0; background:#f1f5f9; color:#334155; font-weight:800; text-align:left; padding:9px 11px; border-bottom:1px solid #cbd5e1; white-space:nowrap; z-index:2; }',
      '.ca-table td { padding:8px 11px; border-bottom:1px solid #f1f5f9; white-space:nowrap; color:#0f172a; }',
      '.ca-table tr:hover td { background:#f8fafc; }',
      '.ca-num { text-align:right; font-weight:700; }',
      '.ca-empty { padding:38px 20px; text-align:center; border:1px dashed #cbd5e1; border-radius:12px; background:#f8fafc; color:#475569; }',
      '.ca-empty h3 { margin:0 0 6px; font-size:16px; color:#0f172a; }',
      '.ca-empty p { margin:0 0 14px; font-size:13px; max-width:640px; margin-left:auto; margin-right:auto; }',

      '.ca-modal-overlay { position:fixed; inset:0; background:rgba(15,23,42,0.58); z-index:99990; display:flex; align-items:center; justify-content:center; padding:18px; }',
      '.ca-modal { background:#ffffff; color:#0f172a; border-radius:14px; border:1px solid #cbd5e1; width:100%; max-width:680px; max-height:92vh; display:flex; flex-direction:column; overflow:hidden; }',
      '.ca-modal-head { display:flex; align-items:center; justify-content:space-between; padding:14px 18px; border-bottom:1px solid #e2e8f0; }',
      '.ca-modal-head h3 { margin:0; font-size:16px; font-weight:800; }',
      '.ca-modal-body { padding:16px 18px; overflow-y:auto; display:flex; flex-direction:column; gap:12px; }',
      '.ca-modal-foot { padding:12px 18px; border-top:1px solid #e2e8f0; display:flex; justify-content:flex-end; gap:8px; background:#f8fafc; }',
      '.ca-grid-2 { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; }',
      '.ca-field { display:flex; flex-direction:column; gap:4px; }',
      '.ca-field.full { grid-column:1/-1; }',
      '.ca-field label { font-size:12px; font-weight:700; color:#334155; }',
      '.ca-codebox { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:11px; background:#0f172a; color:#e2e8f0; padding:10px 12px; border-radius:10px; max-height:130px; overflow:auto; white-space:pre-wrap; word-break:break-all; }',
      '.ca-toast { position:fixed; bottom:22px; right:22px; background:#0f172a; color:#ffffff; padding:11px 16px; border-radius:10px; font-size:13px; font-weight:600; z-index:99999; opacity:0; pointer-events:none; transition:opacity .2s; }',
      '.ca-toast.show { opacity:1; }',
      '@media (max-width:1100px) { .ca-kpis { grid-template-columns:repeat(3,minmax(0,1fr)); } }',
      '@media (max-width:800px) { .ca-kpis { grid-template-columns:repeat(2,minmax(0,1fr)); } .ca-grid-2 { grid-template-columns:1fr; } }'
    ].join('\n');
    var styleEl = doc.createElement('style');
    styleEl.id = 'atplCardAttStyles';
    styleEl.textContent = css;
    (doc.head || doc.documentElement).appendChild(styleEl);
  }

  // ── UI Rendering ──
  function renderUI() {
    var doc = root.document;
    if (!doc) return;
    ensureStyles();
    updateSidebarBadge();

    var container = doc.getElementById('cardAttendanceContainer');
    if (!container) return;

    var monthKeys = Object.keys(state.months).sort().reverse();
    var activeSnap = state.activeMonthKey && state.months[state.activeMonthKey] ? state.months[state.activeMonthKey] : null;
    var metrics = computeCardMetrics(activeSnap, state.selectedDay, state.shiftFilter);
    var activeCardObj = state.selectedCard === 'ALL'
      ? null
      : metrics.cards.find(function (c) { return c.name === state.selectedCard; }) || null;
    if (state.selectedCard !== 'ALL' && !activeCardObj) state.selectedCard = 'ALL';

    var totalMaster = metrics.cards.reduce(function (s, c) { return s + (c.masterCount || 0); }, 0);
    var dayLabel = metrics.effectiveDay === 'ALL' ? 'Full Month' : ('Day ' + metrics.effectiveDay);

    var html = [];
    html.push('<div class="ca-wrap">');

    // Header
    html.push('<div class="ca-header">');
    html.push('  <div class="ca-title">');
    html.push('    <h1>🏭 Card Manpower &amp; Attendance Count</h1>');
    html.push('    <p>Live Card-wise Total Admi (Headcount), Shift Duty (D/N) &amp; Machine breakdown synced from Monthly Attendance &amp; Google Drive.</p>');
    html.push('  </div>');
    html.push('  <div class="ca-actions">');
    html.push('    <span style="font-size:12px;color:#64748b">' + esc(state.syncText) + (activeSnap ? (' · Source: ' + esc(activeSnap.source)) : '') + '</span>');
    if (monthKeys.length) {
      html.push('    <select class="ca-input" id="caMonthSelect" aria-label="Select attendance month">');
      monthKeys.forEach(function (mk) {
        var sp = state.months[mk];
        var lbl = MONTHS[(sp.month || 1) - 1] + ' ' + sp.year;
        html.push('      <option value="' + esc(mk) + '"' + (mk === state.activeMonthKey ? ' selected' : '') + '>' + esc(lbl) + '</option>');
      });
      html.push('    </select>');
    }
    html.push('    <button type="button" class="ca-btn" data-ca-act="sync">' + (state.syncing ? 'Syncing…' : 'Sync Drive') + '</button>');
    html.push('    <button type="button" class="ca-btn" data-ca-act="export-csv">Export Card CSV</button>');
    html.push('    <button type="button" class="ca-btn" data-ca-act="open-connect">Connect Other ERP</button>');
    html.push('    <label class="ca-btn ca-btn-accent" style="margin:0;cursor:pointer">+ Upload Export Excel<input type="file" id="caUploadExcelInp" accept=".xls,.xlsx,.csv" style="display:none" /></label>');
    html.push('  </div>');
    html.push('</div>');

    // 5 Interactive KPI Cards
    html.push('<div class="ca-kpis">');
    html.push('  <button type="button" class="ca-kpi ' + (state.selectedCard === 'ALL' ? 'active' : '') + '" data-ca-act="select-card" data-card="ALL">');
    html.push('    <span class="ca-kpi-lbl">Active Cards (' + esc(dayLabel) + ')</span>');
    html.push('    <span class="ca-kpi-val">' + metrics.cards.length + '</span>');
    html.push('    <span class="ca-kpi-sub">Click to view all cards</span>');
    html.push('  </button>');
    html.push('  <button type="button" class="ca-kpi" data-ca-act="set-shift" data-val="ALL">');
    html.push('    <span class="ca-kpi-lbl">Total Admi (' + esc(dayLabel) + ')</span>');
    html.push('    <span class="ca-kpi-val" style="color:#1d4ed8">' + metrics.totalUniqueAdmi + '</span>');
    html.push('    <span class="ca-kpi-sub">Unique workers present</span>');
    html.push('  </button>');
    html.push('  <button type="button" class="ca-kpi" data-ca-act="set-view" data-val="matrix">');
    html.push('    <span class="ca-kpi-lbl">Total Duty Units</span>');
    html.push('    <span class="ca-kpi-val" style="color:#047857">' + metrics.totalDuty + '</span>');
    html.push('    <span class="ca-kpi-sub">Sum of 1 / 1.5 / 2 shifts</span>');
    html.push('  </button>');
    html.push('  <button type="button" class="ca-kpi ' + (state.shiftFilter !== 'ALL' ? 'active' : '') + '" data-ca-act="cycle-shift">');
    html.push('    <span class="ca-kpi-lbl">Day (D) / Night (N)</span>');
    html.push('    <span class="ca-kpi-val">' + metrics.totalDayAdmi + ' / ' + metrics.totalNightAdmi + '</span>');
    html.push('    <span class="ca-kpi-sub">Duty: D ' + metrics.totalDayDuty + ' · N ' + metrics.totalNightDuty + ' (Filter: ' + esc(state.shiftFilter) + ')</span>');
    html.push('  </button>');
    html.push('  <button type="button" class="ca-kpi" data-ca-act="set-view" data-val="summary">');
    html.push('    <span class="ca-kpi-lbl">Master Strength</span>');
    html.push('    <span class="ca-kpi-val">' + totalMaster + '</span>');
    html.push('    <span class="ca-kpi-sub">' + (totalMaster ? (Math.round((metrics.totalUniqueAdmi / totalMaster) * 100) + '% vs Employee Master') : 'Load Employee Master') + '</span>');
    html.push('  </button>');
    html.push('</div>');

    if (!activeSnap) {
      html.push('<div class="ca-section">');
      html.push('  <div class="ca-empty">');
      html.push('    <h3>Monthly Attendance Data Load Karein (Other ERP se)</h3>');
      html.push('    <p>Apne dusre ERP (<b>erp-system-ui</b> → HR → Monthly Attendance) se <b>Export Excel</b> file yahan upload karein, ya <b>Connect Other ERP</b> button se live sync script / direct login connect karein. Ek baar sync hone par saare Cards (Card-1, Card-2, ..., Card-13) ka Total Admi count automatically Google Drive par save aur live dikhega.</p>');
      html.push('    <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">');
      html.push('      <label class="ca-btn ca-btn-accent" style="margin:0;cursor:pointer">+ Upload Export Excel (.xls / .xlsx)<input type="file" id="caUploadExcelEmpty" accept=".xls,.xlsx,.csv" style="display:none" /></label>');
      html.push('      <button type="button" class="ca-btn ca-btn-dark" data-ca-act="open-connect">Connect Other ERP (Live Sync)</button>');
      html.push('    </div>');
      html.push('  </div>');
      html.push('</div>');
      html.push('</div>');
      container.innerHTML = html.join('\n');
      bindFileInputs();
      return;
    }

    // Day Selector Strip (1..31 + Full Month)
    html.push('<div class="ca-section">');
    html.push('  <div class="ca-sec-head">');
    html.push('    <span class="ca-sec-title">Select Day (Daily Duty Total) — ' + esc(MONTHS[(activeSnap.month || 1) - 1] + ' ' + activeSnap.year) + '</span>');
    html.push('    <div style="display:flex;gap:6px;flex-wrap:wrap">');
    html.push('      <button type="button" class="ca-btn ca-btn-sm ' + (state.shiftFilter === 'ALL' ? 'ca-btn-dark' : '') + '" data-ca-act="set-shift" data-val="ALL">All Shifts</button>');
    html.push('      <button type="button" class="ca-btn ca-btn-sm ' + (state.shiftFilter === 'D' ? 'ca-btn-dark' : '') + '" data-ca-act="set-shift" data-val="D">Day (D)</button>');
    html.push('      <button type="button" class="ca-btn ca-btn-sm ' + (state.shiftFilter === 'N' ? 'ca-btn-dark' : '') + '" data-ca-act="set-shift" data-val="N">Night (N)</button>');
    html.push('    </div>');
    html.push('  </div>');
    html.push('  <div class="ca-day-strip">');
    html.push('    <button type="button" class="ca-day-btn ' + (metrics.effectiveDay === 'ALL' ? 'active' : '') + '" data-ca-act="select-day" data-day="ALL"><b>ALL</b><span>Month</span></button>');
    for (var d = 1; d <= 31; d++) {
      var dtot = metrics.dayTotals[d - 1] || 0;
      var du = metrics.dayUniqueCounts[d - 1] || 0;
      var isActDay = metrics.effectiveDay === d;
      html.push('    <button type="button" class="ca-day-btn ' + (isActDay ? 'active' : '') + '" data-ca-act="select-day" data-day="' + d + '" title="Day ' + d + ': ' + du + ' unique admi, ' + dtot + ' duty units"><b>' + d + '</b><span>' + (dtot || '—') + '</span></button>');
    }
    html.push('  </div>');
    html.push('</div>');

    // Card-Wise Total Admi Button Grid
    html.push('<div class="ca-section">');
    html.push('  <div class="ca-sec-head">');
    html.push('    <span class="ca-sec-title">Card-Wise Total Admi Count (' + esc(dayLabel) + ')</span>');
    html.push('    <div style="display:flex;gap:6px;flex-wrap:wrap">');
    html.push('      <button type="button" class="ca-btn ca-btn-sm ' + (state.viewMode === 'summary' ? 'ca-btn-dark' : '') + '" data-ca-act="set-view" data-val="summary">Card Summary</button>');
    html.push('      <button type="button" class="ca-btn ca-btn-sm ' + (state.viewMode === 'matrix' ? 'ca-btn-dark' : '') + '" data-ca-act="set-view" data-val="matrix">Day 1–31 Matrix</button>');
    html.push('      <button type="button" class="ca-btn ca-btn-sm ' + (state.viewMode === 'workers' ? 'ca-btn-dark' : '') + '" data-ca-act="set-view" data-val="workers">Worker List</button>');
    html.push('    </div>');
    html.push('  </div>');

    html.push('  <div class="ca-card-grid">');
    html.push('    <button type="button" class="ca-card-btn ' + (state.selectedCard === 'ALL' ? 'active' : '') + '" data-ca-act="select-card" data-card="ALL">');
    html.push('      <div class="ca-card-top"><span>All Cards</span><span>' + metrics.cards.length + ' cards</span></div>');
    html.push('      <div class="ca-card-admi">' + metrics.totalUniqueAdmi + ' Admi</div>');
    html.push('      <div class="ca-card-meta">Duty: ' + metrics.totalDuty + ' · D: ' + metrics.totalDayAdmi + ' · N: ' + metrics.totalNightAdmi + '</div>');
    html.push('      <div class="ca-card-bar"><i style="width:100%"></i></div>');
    html.push('    </button>');

    metrics.cards.forEach(function (c) {
      var isSel = state.selectedCard === c.name;
      var pct = c.masterCount ? Math.min(100, Math.round((c.uniqueAdmi / c.masterCount) * 100)) : (c.uniqueAdmi ? 100 : 0);
      html.push('    <button type="button" class="ca-card-btn ' + (isSel ? 'active' : '') + '" data-ca-act="select-card" data-card="' + esc(c.name) + '">');
      html.push('      <div class="ca-card-top"><span>' + esc(c.name) + '</span><span>' + (c.masterCount ? (c.uniqueAdmi + '/' + c.masterCount + ' Mstr') : (c.machines.length + ' M/C')) + '</span></div>');
      html.push('      <div class="ca-card-admi">' + c.uniqueAdmi + ' Admi</div>');
      html.push('      <div class="ca-card-meta">Duty: ' + c.totalDuty + ' · D: ' + c.dayAdmi + ' · N: ' + c.nightAdmi + '</div>');
      html.push('      <div class="ca-card-bar"><i style="width:' + pct + '%"></i></div>');
      html.push('    </button>');
    });
    html.push('  </div>');

    // Detail View (Summary / Matrix / Workers)
    if (state.viewMode === 'matrix') {
      html.push('  <div class="ca-table-wrap"><table class="ca-table"><thead><tr><th>Card Name</th><th>Master</th>');
      for (var md = 1; md <= 31; md++) html.push('<th class="ca-num">' + md + '</th>');
      html.push('</tr></thead><tbody>');
      metrics.cards.forEach(function (c) {
        if (state.selectedCard !== 'ALL' && c.name !== state.selectedCard) return;
        html.push('<tr><td><b>' + esc(c.name) + '</b></td><td>' + (c.masterCount || '—') + '</td>');
        for (var j = 0; j < 31; j++) {
          var uCnt = c.dayMatrixUniqueCounts[j] || 0;
          var dSum = Math.round((c.dayMatrixTotals[j] || 0) * 10) / 10;
          html.push('<td class="ca-num" title="' + uCnt + ' unique admi, ' + dSum + ' duty">' + (uCnt ? (uCnt + '<span style="color:#64748b;font-weight:400;font-size:10px">/' + dSum + '</span>') : '—') + '</td>');
        }
        html.push('</tr>');
      });
      html.push('</tbody></table></div>');
    } else if (state.viewMode === 'workers' || activeCardObj) {
      var targetRows = activeCardObj ? activeCardObj.rows : metrics.cards.reduce(function (acc, c) { return acc.concat(c.rows); }, []);
      var q = state.searchQuery.trim().toLowerCase();
      if (q) {
        targetRows = targetRows.filter(function (r) {
          return (String(r.emp_code || '') + ' ' + String(r.emp_name || '') + ' ' + String(r.machine_code || '') + ' ' + String(r.resolvedCard || '')).toLowerCase().indexOf(q) >= 0;
        });
      }
      html.push('  <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">');
      html.push('    <input type="search" class="ca-input" id="caSearchInp" placeholder="Search emp code, name, machine code…" value="' + esc(state.searchQuery) + '" style="flex:1;min-width:220px" />');
      html.push('    <span style="font-size:12px;color:#64748b">' + targetRows.length + ' attendance row(s)</span>');
      html.push('  </div>');
      html.push('  <div class="ca-table-wrap"><table class="ca-table"><thead><tr><th>#</th><th>Card</th><th>Emp Code</th><th>Employee</th><th>Machine</th><th>Shift</th><th class="ca-num">' + esc(dayLabel) + '</th><th class="ca-num">Month Total</th></tr></thead><tbody>');
      targetRows.forEach(function (r, idx) {
        var mSum = (r.days || []).reduce(function (s, x) { return s + parseDayNum(x); }, 0);
        html.push('<tr><td>' + (idx + 1) + '</td><td><b>' + esc(r.resolvedCard) + '</b></td><td>' + esc(r.emp_code || '—') + '</td><td>' + esc(r.emp_name) + '</td><td>' + esc(r.machine_code || '—') + '</td><td>' + esc(r.shift) + '</td><td class="ca-num">' + (r.selectedVal || '—') + '</td><td class="ca-num">' + (Math.round(mSum * 100) / 100) + '</td></tr>');
      });
      html.push('</tbody></table></div>');
    } else {
      // Card Summary Table
      html.push('  <div class="ca-table-wrap"><table class="ca-table"><thead><tr><th>Card Name</th><th class="ca-num">Unique Admi</th><th class="ca-num">Total Duty</th><th class="ca-num">Day (D) Admi / Duty</th><th class="ca-num">Night (N) Admi / Duty</th><th class="ca-num">Master Strength</th><th>Machines Breakdown</th></tr></thead><tbody>');
      metrics.cards.forEach(function (c) {
        var machTxt = c.machines.length
          ? c.machines.map(function (m) { return m.code + ': ' + m.uniqueAdmi + ' (' + m.duty + ')'; }).join(' · ')
          : '—';
        html.push('<tr><td><button type="button" class="ca-btn ca-btn-sm" data-ca-act="select-card" data-card="' + esc(c.name) + '">' + esc(c.name) + '</button></td><td class="ca-num" style="color:#1d4ed8">' + c.uniqueAdmi + '</td><td class="ca-num" style="color:#047857">' + c.totalDuty + '</td><td class="ca-num">' + c.dayAdmi + ' (' + c.dayShiftDuty + ')</td><td class="ca-num">' + c.nightAdmi + ' (' + c.nightShiftDuty + ')</td><td class="ca-num">' + (c.masterCount || '—') + '</td><td style="white-space:normal;min-width:220px;font-size:11.5px;color:#475569">' + esc(machTxt) + '</td></tr>');
      });
      html.push('</tbody></table></div>');
    }

    html.push('</div>');
    html.push('</div>');
    container.innerHTML = html.join('\n');
    bindFileInputs();
  }

  function bindFileInputs() {
    var doc = root.document;
    if (!doc) return;
    ['caUploadExcelInp', 'caUploadExcelEmpty'].forEach(function (id) {
      var inp = doc.getElementById(id);
      if (inp) {
        inp.onchange = async function () {
          var f = inp.files && inp.files[0];
          if (!f) return;
          try {
            notify('Parsing Monthly Attendance sheet…');
            var snap = await parseUploadedAttendanceFile(f);
            await saveMonthSnapshot(snap);
            notify('Loaded ' + snap.rows.length + ' attendance rows (' + snap.monthKey + ') & synced to Drive');
          } catch (err) {
            notify('Import failed: ' + ((err && err.message) || err));
          }
          inp.value = '';
        };
      }
    });

    var mSel = doc.getElementById('caMonthSelect');
    if (mSel) {
      mSel.onchange = function () {
        state.activeMonthKey = mSel.value;
        state.selectedCard = 'ALL';
        state.selectedDay = 'LATEST';
        renderUI();
      };
    }

    var sInp = doc.getElementById('caSearchInp');
    if (sInp) {
      sInp.oninput = function () {
        state.searchQuery = sInp.value || '';
        renderUI();
        var next = doc.getElementById('caSearchInp');
        if (next) {
          next.focus();
          try { next.setSelectionRange(next.value.length, next.value.length); } catch (_) {}
        }
      };
    }
  }

  // ── Connect Other ERP Modal (Server Proxy + Console/Bookmarklet Bridge for GitHub Pages) ──
  function closeModal() {
    var doc = root.document;
    if (!doc) return;
    var ov = doc.getElementById('caModalOverlay');
    if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
  }

  function buildCrossErpSyncSnippet(month, year) {
    var gasUrl = getGasUrl();
    return "(async()=>{const m=" + Number(month) + ",y=" + Number(year) + ",gas='" + gasUrl + "';const g=async u=>(await fetch(u,{credentials:'include'})).json();const [att,locs,mach]=await Promise.all([g(`/api/v1/attendance/?month=${m}&year=${y}`),g('/api/v1/masters/locations').catch(()=>[]),g('/api/v1/masters/machines').catch(()=>[])]);const locMap={};(locs||[]).forEach(l=>locMap[l.id]=l.name);const mMap={};(mach||[]).forEach(x=>mMap[(x.code||'').toUpperCase()]=locMap[x.location_id]||'');const rows=(att||[]).filter(r=>!r.moved_to_machine_code).map(r=>{const mc=(r.machine?.code||r.machine_code||'');const days=[];for(let d=1;d<=31;d++)days.push(Number(r['d'+d]||0)||0);return{emp_code:String(r.employee_code||r.employee?.biometric_id||r.employee_number||''),emp_name:((r.employee?.first_name||'')+' '+(r.employee?.last_name||'')).trim()||r.employee_number||'',machine_code:mc,shift:r.shift?.name||r.shift_name||'D',card:mMap[mc.toUpperCase()]||'',days};});const mk=y+'-'+String(m).padStart(2,'0');let cur={version:1,months:{},tombstones:{}};try{const dl=await(await fetch(gas,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({action:'downloadFile',fileName:'" + DRIVE_FILE + "'})})).json();if(dl.ok&&dl.fileBase64)cur=JSON.parse(atob(dl.fileBase64));}catch(_){}cur.months=cur.months||{};cur.months[mk]={monthKey:mk,month:m,year:y,source:'Other ERP Live Sync',updatedAt:new Date().toISOString(),rows};cur.updatedAt=new Date().toISOString();const b64=btoa(unescape(encodeURIComponent(JSON.stringify(cur))));const up=await(await fetch(gas,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({action:'uploadFile',fileName:'" + DRIVE_FILE + "',module:'vault',fileBase64:b64,mimeType:'application/json'})})).json();alert(up.ok?('Synced '+rows.length+' rows for '+mk+' to Google Drive!'):('Sync failed: '+up.error));})();";
  }

  function openConnectModal() {
    closeModal();
    var doc = root.document;
    if (!doc || !doc.body) return;
    var now = new Date();
    var curMonth = now.getMonth() + 1;
    var curYear = now.getFullYear();
    var srvMode = isServerAvailable();

    var ov = doc.createElement('div');
    ov.id = 'caModalOverlay';
    ov.className = 'ca-modal-overlay';
    ov.innerHTML = [
      '<div class="ca-modal">',
      '  <div class="ca-modal-head"><h3>Connect Other ERP — Monthly Attendance Sync</h3><button type="button" class="ca-btn ca-btn-sm" id="caMClose">Close</button></div>',
      '  <div class="ca-modal-body">',
      '    <div class="ca-grid-2">',
      '      <div class="ca-field"><label>Month</label><select class="ca-input" id="caConnM">' + MONTHS.map(function (m, i) { return '<option value="' + (i + 1) + '"' + (i + 1 === curMonth ? ' selected' : '') + '>' + m + '</option>'; }).join('') + '</select></div>',
      '      <div class="ca-field"><label>Year</label><input type="number" class="ca-input" id="caConnY" value="' + curYear + '" /></div>',
      '    </div>',
      srvMode ? [
        '    <div style="border:1px solid #cbd5e1;border-radius:10px;padding:12px;background:#f8fafc">',
        '      <div style="font-size:13px;font-weight:800;margin-bottom:8px">Option A — Direct Server Sync (Recommended)</div>',
        '      <div class="ca-grid-2">',
        '        <div class="ca-field full"><label>Other ERP URL</label><input class="ca-input" id="caConnUrl" value="' + DEFAULT_OTHER_ERP_URL + '" /></div>',
        '        <div class="ca-field"><label>Other ERP Username</label><input class="ca-input" id="caConnUser" placeholder="Username / Email" /></div>',
        '        <div class="ca-field"><label>Other ERP Password</label><input type="password" class="ca-input" id="caConnPass" placeholder="Password" /></div>',
        '      </div>',
        '      <div style="margin-top:10px"><button type="button" class="ca-btn ca-btn-accent" id="caConnPullBtn">Pull Live Monthly Attendance Now</button></div>',
        '    </div>'
      ].join('') : '',
      '    <div style="border:1px solid #cbd5e1;border-radius:10px;padding:12px;background:#ffffff">',
      '      <div style="font-size:13px;font-weight:800;margin-bottom:4px">' + (srvMode ? 'Option B — ' : '') + '1-Click Live Sync from Other ERP Browser Tab</div>',
      '      <p style="margin:0 0 8px;font-size:12px;color:#475569">Because your other ERP requires login &amp; blocks cross-domain calls from GitHub Pages, copy this script and run it inside your logged-in <b>erp-system-ui</b> tab (DevTools Console or Bookmark). It pushes live Card Attendance straight to your Google Drive!</p>',
      '      <div class="ca-codebox" id="caSnippetBox">' + esc(buildCrossErpSyncSnippet(curMonth, curYear)) + '</div>',
      '      <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">',
      '        <button type="button" class="ca-btn ca-btn-dark ca-btn-sm" id="caCopySnippetBtn">Copy Live Sync Script</button>',
      '        <button type="button" class="ca-btn ca-btn-sm" id="caPullDriveAfterBtn">Refresh from Google Drive</button>',
      '      </div>',
      '    </div>',
      '  </div>',
      '  <div class="ca-modal-foot"><button type="button" class="ca-btn" id="caMCancel">Close</button></div>',
      '</div>'
    ].join('');

    doc.body.appendChild(ov);
    ov.querySelector('#caMClose').onclick = closeModal;
    ov.querySelector('#caMCancel').onclick = closeModal;

    var refreshSnippet = function () {
      var m = ov.querySelector('#caConnM').value;
      var y = ov.querySelector('#caConnY').value;
      ov.querySelector('#caSnippetBox').textContent = buildCrossErpSyncSnippet(m, y);
    };
    ov.querySelector('#caConnM').onchange = refreshSnippet;
    ov.querySelector('#caConnY').oninput = refreshSnippet;

    ov.querySelector('#caCopySnippetBtn').onclick = async function () {
      var txt = ov.querySelector('#caSnippetBox').textContent;
      try {
        await root.navigator.clipboard.writeText(txt);
        notify('Copied live sync script! Paste in your other ERP tab console.');
      } catch (_) {
        notify('Select & copy the script box manually');
      }
    };
    ov.querySelector('#caPullDriveAfterBtn').onclick = async function () {
      closeModal();
      await syncNow(true);
    };

    var pullBtn = ov.querySelector('#caConnPullBtn');
    if (pullBtn) {
      pullBtn.onclick = async function () {
        var erpUrl = ov.querySelector('#caConnUrl').value.trim();
        var username = ov.querySelector('#caConnUser').value.trim();
        var password = ov.querySelector('#caConnPass').value;
        var month = Number(ov.querySelector('#caConnM').value);
        var year = Number(ov.querySelector('#caConnY').value);
        if (!username || !password) {
          notify('Please enter your other ERP username and password');
          return;
        }
        pullBtn.disabled = true;
        pullBtn.textContent = 'Connecting & Pulling…';
        try {
          var res = await root.fetch('/api/external-erp/attendance-sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ erpUrl: erpUrl, username: username, password: password, month: month, year: year })
          });
          var data = await res.json();
          if (!res.ok || !data.ok) throw new Error(data.error || 'Sync failed');
          var snap = normalizeExternalApiRecords(data.attendance || [], data.locations || [], data.machines || [], month, year);
          await saveMonthSnapshot(snap);
          closeModal();
          notify('Synced ' + snap.rows.length + ' rows from Other ERP for ' + snap.monthKey);
        } catch (err) {
          pullBtn.disabled = false;
          pullBtn.textContent = 'Pull Live Monthly Attendance Now';
          notify('Connect failed: ' + ((err && err.message) || err));
        }
      };
    }
  }

  function exportSummaryCsv() {
    var activeSnap = state.activeMonthKey && state.months[state.activeMonthKey] ? state.months[state.activeMonthKey] : null;
    if (!activeSnap) { notify('No attendance data loaded yet'); return; }
    var metrics = computeCardMetrics(activeSnap, state.selectedDay, state.shiftFilter);
    var headers = ['Card Name', 'Period', 'Unique Admi', 'Total Duty', 'Day Admi', 'Day Duty', 'Night Admi', 'Night Duty', 'Master Strength'];
    var dayTxt = metrics.effectiveDay === 'ALL' ? 'Full Month' : ('Day ' + metrics.effectiveDay);
    var lines = [headers.join(',')];
    metrics.cards.forEach(function (c) {
      lines.push(['"' + c.name.replace(/"/g, '""') + '"', '"' + dayTxt + '"', c.uniqueAdmi, c.totalDuty, c.dayAdmi, c.dayShiftDuty, c.nightAdmi, c.nightShiftDuty, c.masterCount].join(','));
    });
    var blob = new root.Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    var url = root.URL.createObjectURL(blob);
    var a = root.document.createElement('a');
    a.href = url;
    a.download = 'ATPL_Card_Manpower_' + activeSnap.monthKey + '_' + dayTxt.replace(/\s+/g, '_') + '.csv';
    root.document.body.appendChild(a);
    a.click();
    setTimeout(function () { if (a.parentNode) a.parentNode.removeChild(a); try { root.URL.revokeObjectURL(url); } catch (_) {} }, 300);
  }

  // ── Event Binding ──
  function bindEvents() {
    if (listenersBound) return;
    listenersBound = true;
    var doc = root.document;
    if (!doc) return;

    doc.addEventListener('click', function (ev) {
      var target = ev.target && ev.target.closest ? ev.target.closest('[data-ca-act]') : null;
      if (!target) return;
      var act = target.getAttribute('data-ca-act');
      if (act === 'sync') syncNow(true);
      else if (act === 'export-csv') exportSummaryCsv();
      else if (act === 'open-connect') openConnectModal();
      else if (act === 'select-card') {
        state.selectedCard = target.getAttribute('data-card') || 'ALL';
        renderUI();
      } else if (act === 'select-day') {
        var dv = target.getAttribute('data-day');
        state.selectedDay = dv === 'ALL' ? 'ALL' : Number(dv);
        renderUI();
      } else if (act === 'set-shift') {
        state.shiftFilter = target.getAttribute('data-val') || 'ALL';
        renderUI();
      } else if (act === 'cycle-shift') {
        var ord = ['ALL', 'D', 'N'];
        state.shiftFilter = ord[(ord.indexOf(state.shiftFilter) + 1) % ord.length];
        renderUI();
      } else if (act === 'set-view') {
        state.viewMode = target.getAttribute('data-val') || 'summary';
        renderUI();
      }
    });

    if (typeof root.BroadcastChannel !== 'undefined') {
      try {
        var bc = new root.BroadcastChannel(CHANNEL_NAME);
        bc.onmessage = function (e) {
          var m = e && e.data;
          if (!m || m.sender === CLIENT_ID) return;
          if (String(m.action || '').indexOf('card_attendance') === 0) {
            loadLocalState();
            renderUI();
          }
        };
      } catch (_) {}
    }
  }

  function init() {
    loadLocalState();
    stripFromWindowFiles();
    bindEvents();
    renderUI();
    setTimeout(function () { syncNow(false); }, 800);
  }

  if (root.document && root.document.readyState === 'loading') {
    root.document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  root.ATPLCardAttendance = {
    version: MODULE_VERSION,
    DRIVE_FILE: DRIVE_FILE,
    init: init,
    renderUI: renderUI,
    syncNow: syncNow,
    saveMonthSnapshot: saveMonthSnapshot,
    parseMatrixRows: parseMatrixRows,
    parseHtmlTableExport: parseHtmlTableExport,
    parseUploadedAttendanceFile: parseUploadedAttendanceFile,
    normalizeExternalApiRecords: normalizeExternalApiRecords,
    computeCardMetrics: computeCardMetrics,
    normalizeCardLabel: normalizeCardLabel,
    getState: function () { return state; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
