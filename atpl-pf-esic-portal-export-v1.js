/**
 * ATPL PF & ESIC PORTAL EXPORT HUB (V1.0)
 * Select any loaded Salary Sheet (or upload Excel/CSV) and instantly generate:
 * 1. Official EPFO ECR Text File (#~# delimited, 11 columns, zero fake UANs)
 * 2. Official ESIC Monthly Contribution Portal Upload (.xls BIFF8 / .xlsx / .csv)
 * 3. Account-wise Challan Breakdown (A/c 1, 2, 10, 21 & ESIC EE/ER) + Print Slip
 * 4. Pre-Upload Portal Validator & Inline Missing UAN / ESIC IP Quick-Fixer
 */
(function (root) {
  'use strict';

  var MODULE_VERSION = '2026.11.24-pf-esic-portal-export-v1';
  if (root.__ATPL_PF_ESIC_PORTAL_EXPORT__ === MODULE_VERSION) return;
  root.__ATPL_PF_ESIC_PORTAL_EXPORT__ = MODULE_VERSION;

  var OVERRIDES_KEY = 'ATPL_PfEsicPortalOverridesV1';
  var SETTINGS_KEY = 'ATPL_PfEsicPortalSettingsV1';

  var ESIC_REASONS = [
    { code: '0', label: '0 — Active (Wages Paid)' },
    { code: '1', label: '1 — On Leave' },
    { code: '2', label: '2 — Left Service' },
    { code: '3', label: '3 — Retired' },
    { code: '4', label: '4 — Out of Coverage' },
    { code: '5', label: '5 — Expired' },
    { code: '6', label: '6 — Non-Implemented Area' },
    { code: '7', label: '7 — Compliance by Immediate Employer' },
    { code: '8', label: '8 — Suspension of Work' },
    { code: '9', label: '9 — Strike / Lockout' },
    { code: '10', label: '10 — Retrenchment' },
    { code: '11', label: '11 — No Work' },
    { code: '12', label: '12 — Doesn\'t Belong to This Employer' },
    { code: '13', label: '13 — Duplicate IP' }
  ];

  var DEFAULT_SETTINGS = {
    selectedFileName: '',
    selectedSheets: [],
    monthDays: 30,
    capEpfAt15k: false,
    useSheetPfAmount: false,
    onlyValidPortalIds: true,
    epfWageBase: 'basic_or_pf', // 'basic_or_pf' | 'gross'
    activeTab: 'pf-ecr', // 'pf-ecr' | 'esic-return' | 'breakdown' | 'missing-ids'
    searchQuery: '',
    showMapping: false,
    colMap: {
      empCode: '',
      empName: '',
      uan: '',
      esicIp: '',
      days: '',
      basic: '',
      gross: '',
      pfDed: '',
      esicDed: ''
    }
  };

  var state = {
    settings: loadSettings(),
    overrides: loadOverrides(),
    computed: null,
    selectedWorkbook: null,
    availableTabs: [],
    colHeaders: [],
    detectedMap: {}
  };

  function safeJsonParse(raw, fallback) {
    try {
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function loadSettings() {
    var saved = {};
    try {
      if (root.localStorage) {
        saved = safeJsonParse(root.localStorage.getItem(SETTINGS_KEY), {});
      }
    } catch (_) {}
    var merged = Object.assign({}, DEFAULT_SETTINGS, saved || {});
    merged.colMap = Object.assign({}, DEFAULT_SETTINGS.colMap, (saved && saved.colMap) || {});
    if (!Array.isArray(merged.selectedSheets)) merged.selectedSheets = [];
    return merged;
  }

  function saveSettings() {
    try {
      if (root.localStorage) {
        root.localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
      }
    } catch (_) {}
  }

  function loadOverrides() {
    try {
      if (root.localStorage) {
        return safeJsonParse(root.localStorage.getItem(OVERRIDES_KEY), {});
      }
    } catch (_) {}
    return {};
  }

  function saveOverrides() {
    try {
      if (root.localStorage) {
        root.localStorage.setItem(OVERRIDES_KEY, JSON.stringify(state.overrides));
      }
    } catch (_) {}
  }

  function escHtml(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function numVal(v) {
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    var s = String(v == null ? '' : v).replace(/[₹,\s]/g, '').trim();
    if (!s || s === '-' || s === '--') return 0;
    var n = parseFloat(s);
    return isFinite(n) ? n : 0;
  }

  function normalizeCode(v) {
    return String(v == null ? '' : v).trim().replace(/\.0$/, '').toUpperCase();
  }

  function digitsOnly(v) {
    var s = String(v == null ? '' : v).trim();
    // Avoid scientific notation strings if Excel converted numbers
    if (/^\d+(\.\d+)?e\+\d+$/i.test(s)) {
      var n = Number(s);
      if (isFinite(n)) s = n.toFixed(0);
    }
    return s.replace(/\.0$/, '').replace(/\D/g, '');
  }

  function normalizePersonName(v) {
    return String(v == null ? '' : v)
      .toUpperCase()
      .replace(/[^A-Z\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function sanitizePortalName(v) {
    var cleaned = normalizePersonName(v);
    return (cleaned || 'WORKER').substring(0, 85);
  }

  function formatDdMmYyyy(val) {
    var s = String(val == null ? '' : val).trim();
    if (!s || s === '0' || s === '-' || /^na$/i.test(s)) return '';
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return s;
    var m1 = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
    if (m1) {
      return ('0' + m1[1]).slice(-2) + '/' + ('0' + m1[2]).slice(-2) + '/' + m1[3];
    }
    var m2 = s.match(/^(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})/);
    if (m2) {
      return ('0' + m2[3]).slice(-2) + '/' + ('0' + m2[2]).slice(-2) + '/' + m2[1];
    }
    if (/^\d{5}$/.test(s)) {
      var serial = parseInt(s, 10);
      if (serial > 30000 && serial < 60000) {
        var dt = new Date((serial - 25569) * 86400 * 1000);
        if (!isNaN(dt.getTime())) {
          return ('0' + dt.getUTCDate()).slice(-2) + '/' + ('0' + (dt.getUTCMonth() + 1)).slice(-2) + '/' + dt.getUTCFullYear();
        }
      }
    }
    return '';
  }

  function guessMonthDaysFromName(fileName) {
    var s = String(fileName || '').toLowerCase();
    if (/feb|february/.test(s)) {
      return /2024|2028|2032/.test(s) ? 29 : 28;
    }
    if (/jan|january|mar|march|may|jul|july|aug|august|oct|october|dec|december/.test(s)) {
      return 31;
    }
    if (/apr|april|jun|june|sep|sept|september|nov|november/.test(s)) {
      return 30;
    }
    return 30;
  }

  function getWorkbookGrids(fileObj) {
    var out = {};
    if (!fileObj) return out;
    if (fileObj.sheets && typeof fileObj.sheets === 'object') {
      Object.keys(fileObj.sheets).forEach(function (name) {
        var grid = fileObj.sheets[name];
        if (Array.isArray(grid) && grid.length >= 2) out[name] = grid;
      });
    }
    if ((!Object.keys(out).length) && fileObj.wb && fileObj.wb.Sheets && root.XLSX && root.XLSX.utils) {
      (fileObj.wb.SheetNames || Object.keys(fileObj.wb.Sheets)).forEach(function (name) {
        var ws = fileObj.wb.Sheets[name];
        if (!ws) return;
        var grid = root.XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
        if (Array.isArray(grid) && grid.length >= 2) out[name] = grid;
      });
    }
    return out;
  }

  function getLoadedWorkbooks() {
    var list = [];
    var seen = {};
    function pushFile(f) {
      if (!f || !f.name) return;
      var name = String(f.name);
      if (/\.json$/i.test(name)) return;
      var grids = getWorkbookGrids(f);
      if (!Object.keys(grids).length) return;
      if (seen[name]) return;
      seen[name] = true;
      list.push({
        name: name,
        raw: f,
        grids: grids,
        sheetNames: Object.keys(grids)
      });
    }
    if (Array.isArray(root.FILES)) root.FILES.forEach(pushFile);
    if (root.ATPLCentralFileSync && root.ATPLCentralFileSync.fileMap && typeof root.ATPLCentralFileSync.fileMap === 'object') {
      Object.keys(root.ATPLCentralFileSync.fileMap).forEach(function (k) {
        pushFile(root.ATPLCentralFileSync.fileMap[k]);
      });
    }
    return list;
  }

  function buildMasterLookup() {
    var byCode = {};
    var byName = {};
    var sources = [];
    if (Array.isArray(root.EMP_MASTER_DATA)) sources.push(root.EMP_MASTER_DATA);
    if (root.EM && Array.isArray(root.EM.data)) sources.push(root.EM.data);
    sources.forEach(function (arr) {
      arr.forEach(function (emp) {
        if (!emp || typeof emp !== 'object') return;
        var code = normalizeCode(emp.emp_id || emp.code || emp.empCode || emp.id || '');
        var nameKey = normalizePersonName(emp.name || emp.emp_name || '');
        if (code && !byCode[code]) byCode[code] = emp;
        if (nameKey && !byName[nameKey]) byName[nameKey] = emp;
      });
    });
    return { byCode: byCode, byName: byName };
  }

  function findColIndex(headers, patterns, excludes) {
    for (var p = 0; p < patterns.length; p++) {
      var rx = patterns[p];
      for (var i = 0; i < headers.length; i++) {
        var h = String(headers[i] || '').toLowerCase().replace(/[^a-z0-9%.\s]/g, ' ').replace(/\s+/g, ' ').trim();
        if (!h) continue;
        if (excludes && excludes.test(h)) continue;
        if (rx.test(h)) return i;
      }
    }
    return -1;
  }

  function detectHeaderAndCols(grid) {
    if (!Array.isArray(grid) || grid.length < 2) return null;
    var bestRowIdx = -1;
    var bestScore = -1;
    var scanLimit = Math.min(grid.length, 18);
    for (var r = 0; r < scanLimit; r++) {
      var row = grid[r];
      if (!Array.isArray(row)) continue;
      var nonEmpty = 0;
      var score = 0;
      for (var c = 0; c < row.length; c++) {
        var txt = String(row[c] == null ? '' : row[c]).toLowerCase().trim();
        if (!txt) continue;
        nonEmpty++;
        if (/(emp.*code|emp.*id|e\.?code|code|card|token)/.test(txt)) score += 4;
        if (/(emp.*name|employee.*name|worker.*name|\bname\b)/.test(txt)) score += 4;
        if (/(gross|earning|salary|payable|net|wages)/.test(txt)) score += 3;
        if (/(\bbasic\b|epf.*wage|pf.*wage)/.test(txt)) score += 3;
        if (/(\bpf\b|epf|\besic?\b|esi|uan|ip\s*no)/.test(txt)) score += 3;
        if (/(\bwd\b|work.*day|paid.*day|present|days)/.test(txt)) score += 2;
      }
      if (nonEmpty >= 3 && score > bestScore) {
        bestScore = score;
        bestRowIdx = r;
      }
    }
    if (bestRowIdx < 0 || bestScore < 5) return null;
    var hdr = (grid[bestRowIdx] || []).map(function (h, idx) {
      var s = String(h == null ? '' : h).replace(/\s+/g, ' ').trim();
      return s || ('Col ' + (idx + 1));
    });

    var cols = {
      empCode: findColIndex(hdr, [/^emp\s*code$/, /^e\s*code$/, /^emp\s*id$/, /^code$/, /\b(emp\s*code|employee\s*code|employee\s*id|emp\s*id|token\s*no)\b/]),
      empName: findColIndex(hdr, [/^emp\s*name$/, /^employee\s*name$/, /^worker\s*name$/, /^name$/, /\b(emp\s*name|employee\s*name|worker\s*name|member\s*name)\b/], /\b(father|husband|bank|dept|department|sheet|file)\b/),
      uan: findColIndex(hdr, [/^uan$/, /^uan\s*no$/, /^pf\s*uan$/, /^pf\s*no$/, /^pf\s*number$/, /\b(uan|pf\s*no|pf\s*number|epf\s*no)\b/], /\b(amount|amt|ded|12|13|wage|rate)\b/),
      esicIp: findColIndex(hdr, [/^esic?\s*ip$/, /^ip\s*no$/, /^ip\s*number$/, /^esic?\s*no$/, /^esic?\s*number$/, /\b(ip\s*number|ip\s*no|esic?\s*ip|esic?\s*no|esic?\s*number)\b/], /\b(amount|amt|ded|0\.?75|3\.?25|wage|rate)\b/),
      days: findColIndex(hdr, [/^wd$/, /^paid\s*days?$/, /^work(?:ing)?\s*days?$/, /^present\s*days?$/, /^pay\s*days?$/, /^days$/, /\b(working\s*days?|paid\s*days?|days\s*worked|present\s*days?|pay\s*days?)\b/], /\b(ncp|absent|weekly|off|sunday)\b/),
      basic: findColIndex(hdr, [/^earned\s*basic$/, /^actual\s*basic$/, /^basic\s*wages?$/, /^basic\s*pay$/, /^basic$/, /^epf\s*wages?$/, /^pf\s*wages?$/, /\b(earned\s*basic|basic\s*salary|basic\s*wages?|basic\s*pay|epf\s*wages?|pf\s*wages?)\b/], /\b(rate|fix|fixed)\b/),
      gross: findColIndex(hdr, [/^gross\s*wages?$/, /^gross\s*salary$/, /^gross\s*earning$/, /^total\s*earning$/, /^gross\s*pay$/, /^gross$/, /\b(gross\s*wages?|gross\s*salary|total\s*earning|gross\s*amt|gross\s*amount)\b/], /\b(rate|fix|fixed|net\s*pay)\b/),
      netPay: findColIndex(hdr, [/^net\s*pay(?:able|ment)?$/, /^net\s*salary$/, /^compliance\s*(?:net|amt|amount|pay)$/, /\b(net\s*payable|net\s*payment|net\s*salary)\b/]),
      pfDed: findColIndex(hdr, [/^pf\s*12%?$/, /^epf\s*12%?$/, /^ee\s*pf$/, /^pf\s*ded(?:uction)?$/, /^epf\s*ded(?:uction)?$/, /^pf$/, /\b(pf\s*12|epf\s*12|pf\s*ded|ee\s*pf|emp\s*pf)\b/], /\b(13|employer|uan|no|number|id|wage|rate|eps|edli|admin|diff|status|check)\b/),
      esicDed: findColIndex(hdr, [/^esic?\s*0\.?75%?$/, /^ee\s*esic?$/, /^esic?\s*ded(?:uction)?$/, /^esic?$/, /\b(esic?\s*0\.?75|esic?\s*ded|ee\s*esic?|emp\s*esic?)\b/], /\b(3\.?25|employer|ip|no|number|id|wage|rate|status|check)\b/)
    };

    if (cols.gross < 0 && cols.netPay >= 0) cols.gross = cols.netPay;

    return {
      headerRowIdx: bestRowIdx,
      headers: hdr,
      cols: cols,
      score: bestScore + grid.length * 0.01
    };
  }

  function analyzeWorkbookTabs(wbEntry) {
    if (!wbEntry || !wbEntry.grids) return [];
    var tabs = [];
    Object.keys(wbEntry.grids).forEach(function (sheetName) {
      var low = String(sheetName || '').toLowerCase();
      if (/\b(summary|abstract|chart|pivot|rough|index)\b/.test(low)) return;
      var grid = wbEntry.grids[sheetName];
      var det = detectHeaderAndCols(grid);
      if (!det) return;
      var score = det.score;
      if (/\b(fourmala|formula|final|compliance|master|main|salary|payroll|workers|staff|non\s*staff|manisha)\b/.test(low)) score += 30;
      if (/\b(jiska|remove|hdfc|icici|sbi|axis|neft|rtgs|copy|old|bak|backup|diff)\b/.test(low)) score -= 40;
      if (det.cols.pfDed >= 0 || det.cols.esicDed >= 0) score += 20;
      tabs.push({
        sheetName: sheetName,
        headerRowIdx: det.headerRowIdx,
        headers: det.headers,
        cols: det.cols,
        rowCount: Math.max(0, grid.length - det.headerRowIdx - 1),
        score: score
      });
    });
    tabs.sort(function (a, b) { return b.score - a.score; });
    return tabs;
  }

  function isSkippableRow(row, iCode, iName) {
    if (!Array.isArray(row)) return true;
    var nonEmpty = false;
    for (var i = 0; i < row.length; i++) {
      if (String(row[i] == null ? '' : row[i]).trim() !== '') {
        nonEmpty = true;
        break;
      }
    }
    if (!nonEmpty) return true;
    var cVal = iCode >= 0 ? String(row[iCode] == null ? '' : row[iCode]).trim() : '';
    var nVal = iName >= 0 ? String(row[iName] == null ? '' : row[iName]).trim() : '';
    var firstVal = String(row[0] == null ? '' : row[0]).trim();
    var rxStop = /^(total|grand\s*total|sub\s*total|sum|summary|page\s*total|net\s*total|prepared\s*by|checked\s*by|approved\s*by|verified\s*by|authori[sz]ed|signatory|signature|sr\.?\s*no\.?|s\.?\s*no\.?|emp\s*code|employee\s*id)(\b|:)/i;
    if (rxStop.test(cVal) || rxStop.test(nVal) || rxStop.test(firstVal)) return true;
    for (var k = 0; k < Math.min(row.length, 5); k++) {
      if (/^(grand\s*total|sub\s*total|total\s*:|net\s*total|prepared\s*by|approved\s*by)/i.test(String(row[k] == null ? '' : row[k]).trim())) {
        return true;
      }
    }
    return false;
  }

  function resolveColIdx(headers, overrideVal, autoIdx) {
    if (overrideVal !== '' && overrideVal !== null && overrideVal !== undefined) {
      var parsed = parseInt(overrideVal, 10);
      if (!isNaN(parsed) && parsed >= 0 && parsed < headers.length) return parsed;
      if (overrideVal === '__NONE__') return -1;
    }
    return autoIdx;
  }

  function computePortalExport(wbEntry, customSettings, customOverrides) {
    var s = Object.assign({}, DEFAULT_SETTINGS, customSettings || state.settings);
    var ovMap = customOverrides || state.overrides || {};
    var monthDays = Math.min(31, Math.max(28, parseInt(s.monthDays, 10) || 30));
    var tabs = analyzeWorkbookTabs(wbEntry);
    var activeTabNames = Array.isArray(s.selectedSheets) && s.selectedSheets.length
      ? s.selectedSheets.filter(function (n) { return wbEntry && wbEntry.grids && wbEntry.grids[n]; })
      : (tabs.length ? [tabs[0].sheetName] : []);

    var master = buildMasterLookup();
    var allColHeaders = [];
    var detectedMap = {};
    var seenEmp = {};
    var rows = [];

    activeTabNames.forEach(function (sheetName, sheetIdx) {
      var grid = wbEntry.grids[sheetName];
      var det = detectHeaderAndCols(grid);
      if (!det) return;
      if (sheetIdx === 0) {
        allColHeaders = det.headers.slice();
        detectedMap = Object.assign({}, det.cols);
      }

      var cm = s.colMap || {};
      var iCode = resolveColIdx(det.headers, cm.empCode, det.cols.empCode);
      var iName = resolveColIdx(det.headers, cm.empName, det.cols.empName);
      var iUan = resolveColIdx(det.headers, cm.uan, det.cols.uan);
      var iIp = resolveColIdx(det.headers, cm.esicIp, det.cols.esicIp);
      var iDays = resolveColIdx(det.headers, cm.days, det.cols.days);
      var iBasic = resolveColIdx(det.headers, cm.basic, det.cols.basic);
      var iGross = resolveColIdx(det.headers, cm.gross, det.cols.gross);
      var iPf = resolveColIdx(det.headers, cm.pfDed, det.cols.pfDed);
      var iEsic = resolveColIdx(det.headers, cm.esicDed, det.cols.esicDed);

      for (var r = det.headerRowIdx + 1; r < grid.length; r++) {
        var row = grid[r];
        if (isSkippableRow(row, iCode, iName)) continue;

        var empCode = iCode >= 0 ? normalizeCode(row[iCode]) : '';
        var empName = iName >= 0 ? String(row[iName] == null ? '' : row[iName]).trim() : '';
        if (!empCode && !empName) continue;
        // Skip rows with no name and non-numeric code junk
        if (!empName && !/\d{2,}/.test(empCode)) continue;

        var basic = iBasic >= 0 ? Math.max(0, numVal(row[iBasic])) : 0;
        var gross = iGross >= 0 ? Math.max(0, numVal(row[iGross])) : 0;
        var pfDed = iPf >= 0 ? Math.max(0, numVal(row[iPf])) : 0;
        var esicDed = iEsic >= 0 ? Math.max(0, numVal(row[iEsic])) : 0;
        var paidDaysRaw = iDays >= 0 ? numVal(row[iDays]) : 0;

        if (gross === 0 && basic > 0) gross = basic;
        if (basic === 0 && gross === 0 && pfDed === 0 && esicDed === 0) continue;

        var empKey = empCode || ('NAME:' + normalizePersonName(empName));
        if (seenEmp[empKey]) continue;
        seenEmp[empKey] = true;

        var mRec = (empCode && master.byCode[empCode]) || (empName && master.byName[normalizePersonName(empName)]) || {};
        var ov = ovMap[empCode] || ovMap[empKey] || {};

        var sheetUan = iUan >= 0 ? digitsOnly(row[iUan]) : '';
        var masterUan = digitsOnly(mRec.pf_no || mRec.uan || '');
        var uan = digitsOnly(ov.uan || '') || (sheetUan.length === 12 ? sheetUan : '') || (masterUan.length === 12 ? masterUan : '') || sheetUan || masterUan;

        var sheetIp = iIp >= 0 ? digitsOnly(row[iIp]) : '';
        var masterIp = digitsOnly(mRec.esi_no || mRec.esic_no || mRec.esiIp || '');
        var esicIp = digitsOnly(ov.esicIp || '') || (sheetIp.length === 10 ? sheetIp : '') || (masterIp.length === 10 ? masterIp : '') || sheetIp || masterIp;

        var paidDays = iDays >= 0 ? Math.min(monthDays, Math.max(0, Math.round(paidDaysRaw))) : (gross > 0 ? monthDays : 0);
        var ncpDays = Math.max(0, monthDays - paidDays);

        // Determine PF eligibility & EPF Wage
        var isPfEligible = pfDed > 0 || (uan.length === 12 && (basic > 0 || gross > 0));
        var epfBase = s.epfWageBase === 'gross'
          ? (gross > 0 ? gross : basic)
          : (basic > 0 ? basic : (pfDed > 0 ? Math.round(pfDed / 0.12) : gross));
        if (s.capEpfAt15k && epfBase > 15000) epfBase = 15000;
        var epfWage = isPfEligible ? Math.round(epfBase) : 0;
        var grossRounded = Math.round(Math.max(gross, epfWage));
        var epsWage = isPfEligible ? Math.min(epfWage, 15000) : 0;
        var edliWage = isPfEligible ? Math.min(epfWage, 15000) : 0;

        var eePF = 0;
        var erEPS = 0;
        var erDiff = 0;
        if (isPfEligible && epfWage > 0) {
          var statutory12 = Math.round(epfWage * 0.12);
          eePF = (s.useSheetPfAmount && pfDed > 0) ? Math.round(pfDed) : statutory12;
          erEPS = Math.min(1250, Math.round(epsWage * 0.0833));
          // EPFO requires ER_EPS + ER_DIFF = 12% of EPF Wages
          erDiff = Math.max(0, statutory12 - erEPS);
        }

        // Determine ESIC eligibility & wages
        var isEsicEligible = esicDed > 0 || (grossRounded > 0 && grossRounded <= 21000 && (esicIp.length === 10 || pfDed > 0 || !isPfEligible));
        var esicWage = isEsicEligible ? grossRounded : 0;
        var eeESIC = isEsicEligible ? (esicDed > 0 && s.useSheetPfAmount ? Math.round(esicDed) : Math.ceil(esicWage * 0.0075)) : 0;
        var erESIC = isEsicEligible ? Math.ceil(esicWage * 0.0325) : 0;

        var dolFmt = formatDdMmYyyy(ov.lastWorkingDay || mRec.dol || mRec.leaving_date || mRec.date_of_leaving || '');
        var defaultReason = '0';
        var lwd = '';
        if (esicWage === 0 && isEsicEligible) {
          if (dolFmt || /left/i.test(String(mRec.status || ''))) {
            defaultReason = '2';
            lwd = dolFmt;
          } else {
            defaultReason = '1';
          }
        }
        var reasonCode = ov.reasonCode !== undefined && ov.reasonCode !== '' ? String(ov.reasonCode) : defaultReason;
        if (reasonCode === '0') lwd = '';
        else if (['2', '3', '4', '5', '10', '11'].indexOf(reasonCode) >= 0) lwd = dolFmt || String(ov.lastWorkingDay || '');

        var uanValid = uan.length === 12;
        var ipValid = esicIp.length === 10;

        rows.push({
          empKey: empKey,
          empCode: empCode || '-',
          name: empName || String(mRec.name || 'WORKER'),
          portalName: sanitizePortalName(empName || mRec.name || 'WORKER'),
          sheetName: sheetName,
          uan: uan,
          uanValid: uanValid,
          esicIp: esicIp,
          ipValid: ipValid,
          paidDays: paidDays,
          ncpDays: ncpDays,
          gross: grossRounded,
          basic: Math.round(basic),
          isPfEligible: isPfEligible,
          epfWage: epfWage,
          epsWage: epsWage,
          edliWage: edliWage,
          eePF: eePF,
          erEPS: erEPS,
          erDiff: erDiff,
          sheetPf: Math.round(pfDed),
          isEsicEligible: isEsicEligible,
          esicWage: esicWage,
          eeESIC: eeESIC,
          erESIC: erESIC,
          sheetEsic: Math.round(esicDed),
          reasonCode: reasonCode,
          lastWorkingDay: lwd
        });
      }
    });

    var totals = {
      totalEmployees: rows.length,
      pfEligibleCount: 0,
      pfValidCount: 0,
      pfMissingUanCount: 0,
      esicEligibleCount: 0,
      esicValidCount: 0,
      esicMissingIpCount: 0,
      grossWages: 0,
      epfWages: 0,
      epsWages: 0,
      edliWages: 0,
      eePF: 0,
      erEPS: 0,
      erDiff: 0,
      adminAc2: 0,
      edliAc21: 0,
      totalPFChallan: 0,
      esicWages: 0,
      eeESIC: 0,
      erESIC: 0,
      totalESICChallan: 0,
      grandTotalDeposit: 0
    };

    rows.forEach(function (r) {
      totals.grossWages += r.gross;
      if (r.isPfEligible && r.epfWage > 0) {
        totals.pfEligibleCount++;
        if (r.uanValid) totals.pfValidCount++;
        else totals.pfMissingUanCount++;
        totals.epfWages += r.epfWage;
        totals.epsWages += r.epsWage;
        totals.edliWages += r.edliWage;
        totals.eePF += r.eePF;
        totals.erEPS += r.erEPS;
        totals.erDiff += r.erDiff;
      }
      if (r.isEsicEligible) {
        totals.esicEligibleCount++;
        if (r.ipValid) totals.esicValidCount++;
        else totals.esicMissingIpCount++;
        totals.esicWages += r.esicWage;
        totals.eeESIC += r.eeESIC;
        totals.erESIC += r.erESIC;
      }
    });

    if (totals.pfEligibleCount > 0 && totals.epfWages > 0) {
      totals.adminAc2 = Math.max(500, Math.round(totals.epfWages * 0.005));
      totals.edliAc21 = Math.round(totals.edliWages * 0.005);
      totals.totalPFChallan = totals.eePF + totals.erEPS + totals.erDiff + totals.adminAc2 + totals.edliAc21;
    }
    totals.totalESICChallan = totals.eeESIC + totals.erESIC;
    totals.grandTotalDeposit = totals.totalPFChallan + totals.totalESICChallan;

    return {
      fileName: wbEntry ? wbEntry.name : '',
      tabs: tabs,
      activeTabNames: activeTabNames,
      colHeaders: allColHeaders,
      detectedMap: detectedMap,
      rows: rows,
      totals: totals
    };
  }

  // Official 11-column EPFO ECR (#~#) text format
  function buildEpfoEcrText(rows, onlyValidUan) {
    var list = Array.isArray(rows) ? rows : [];
    var strict = onlyValidUan !== false;
    var lines = [];
    list.forEach(function (r) {
      if (!r.isPfEligible || r.epfWage <= 0) return;
      if (strict && !r.uanValid) return;
      var fields = [
        r.uan || '',
        sanitizePortalName(r.portalName || r.name),
        Math.round(r.gross),
        Math.round(r.epfWage),
        Math.round(r.epsWage),
        Math.round(r.edliWage),
        Math.round(r.eePF),
        Math.round(r.erEPS),
        Math.round(r.erDiff),
        Math.round(r.ncpDays),
        0
      ];
      lines.push(fields.join('#~#'));
    });
    return lines.join('\r\n');
  }

  // Official 6-column ESIC Portal Monthly Contribution rows
  function buildEsicSheetRows(rows, onlyValidIp) {
    var list = Array.isArray(rows) ? rows : [];
    var strict = onlyValidIp !== false;
    var header = [
      'IP Number',
      'IP Name',
      'No of Days for which wages paid',
      'Total Monthly Wages',
      'Reason Code for Zero workings days(numeric)',
      'Last Working Day'
    ];
    var out = [header];
    list.forEach(function (r) {
      if (!r.isEsicEligible) return;
      if (strict && !r.ipValid) return;
      var rc = parseInt(r.reasonCode, 10);
      if (isNaN(rc)) rc = r.esicWage > 0 ? 0 : 1;
      out.push([
        String(r.esicIp || ''),
        sanitizePortalName(r.portalName || r.name),
        r.esicWage > 0 ? Math.round(r.paidDays) : 0,
        Math.round(r.esicWage),
        rc,
        rc > 0 && r.lastWorkingDay ? String(r.lastWorkingDay) : ''
      ]);
    });
    return out;
  }

  function buildEsicWorkbook(rows, onlyValidIp) {
    if (!root.XLSX || !root.XLSX.utils) return null;
    var aoa = buildEsicSheetRows(rows, onlyValidIp);
    if (aoa.length <= 1) return null;
    var wb = root.XLSX.utils.book_new();
    var ws = root.XLSX.utils.aoa_to_sheet(aoa);
    // Force text format on Column A (IP Number) and Column F (Last Working Day)
    for (var r = 1; r < aoa.length; r++) {
      var addrA = root.XLSX.utils.encode_cell({ r: r, c: 0 });
      if (ws[addrA]) { ws[addrA].t = 's'; ws[addrA].z = '@'; }
      var addrF = root.XLSX.utils.encode_cell({ r: r, c: 5 });
      if (ws[addrF]) { ws[addrF].t = 's'; ws[addrF].z = '@'; }
    }
    ws['!cols'] = [{ wch: 14 }, { wch: 28 }, { wch: 16 }, { wch: 16 }, { wch: 18 }, { wch: 16 }];
    root.XLSX.utils.book_append_sheet(wb, ws, 'Monthly Contribution');
    return { wb: wb, aoa: aoa };
  }

  function buildEsicCsvText(rows, onlyValidIp) {
    var aoa = buildEsicSheetRows(rows, onlyValidIp);
    return aoa.map(function (row) {
      return row.map(function (cell) {
        var s = String(cell == null ? '' : cell);
        if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
        return s;
      }).join(',');
    }).join('\r\n');
  }

  function triggerFileDownload(content, mimeType, fileName) {
    var blob = content instanceof root.Blob ? content : new root.Blob([content], { type: mimeType });
    var url = root.URL.createObjectURL(blob);
    var a = root.document.createElement('a');
    a.href = url;
    a.download = fileName;
    root.document.body.appendChild(a);
    a.click();
    root.document.body.removeChild(a);
    setTimeout(function () { root.URL.revokeObjectURL(url); }, 1000);
  }

  function fileStem(name) {
    return String(name || 'Salary_Sheet').replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'Salary_Sheet';
  }

  function downloadPfEcr() {
    if (!state.computed) return;
    var text = buildEpfoEcrText(state.computed.rows, state.settings.onlyValidPortalIds);
    if (!text) {
      if (root.showToast) root.showToast('⚠️ Koi valid 12-digit UAN PF row ready nahi hai. Missing UAN tab check karein.');
      return;
    }
    var fName = 'ATPL_EPFO_ECR_' + fileStem(state.computed.fileName) + '.txt';
    triggerFileDownload(text, 'text/plain;charset=utf-8', fName);
    if (root.showToast) root.showToast('✅ Official EPFO ECR (.txt) download ho gayi!');
  }

  function downloadEsic(format) {
    if (!state.computed) return;
    var fmt = String(format || 'xls').toLowerCase();
    var stem = 'ATPL_ESIC_Upload_' + fileStem(state.computed.fileName);
    if (fmt === 'csv') {
      var csv = buildEsicCsvText(state.computed.rows, state.settings.onlyValidPortalIds);
      if (csv.split('\n').length <= 1) {
        if (root.showToast) root.showToast('⚠️ Koi valid 10-digit ESIC IP row ready nahi hai.');
        return;
      }
      triggerFileDownload(csv, 'text/csv;charset=utf-8', stem + '.csv');
      if (root.showToast) root.showToast('✅ ESIC Upload CSV download ho gayi!');
      return;
    }
    var built = buildEsicWorkbook(state.computed.rows, state.settings.onlyValidPortalIds);
    if (!built) {
      if (root.showToast) root.showToast('⚠️ Koi valid 10-digit ESIC IP row ready nahi hai. Missing IP tab check karein.');
      return;
    }
    var bookType = fmt === 'xlsx' ? 'xlsx' : 'biff8';
    var ext = fmt === 'xlsx' ? '.xlsx' : '.xls';
    var arrBuf = root.XLSX.write(built.wb, { bookType: bookType, type: 'array' });
    triggerFileDownload(new root.Blob([arrBuf], { type: 'application/vnd.ms-excel' }), 'application/vnd.ms-excel', stem + ext);
    if (root.showToast) root.showToast('✅ Official ESIC Portal (' + ext.toUpperCase() + ') download ho gayi!');
  }

  function copyEcrToClipboard() {
    if (!state.computed) return;
    var text = buildEpfoEcrText(state.computed.rows, state.settings.onlyValidPortalIds);
    if (!text) return;
    if (root.navigator && root.navigator.clipboard && root.navigator.clipboard.writeText) {
      root.navigator.clipboard.writeText(text).then(function () {
        if (root.showToast) root.showToast('📋 EPFO ECR lines copied to clipboard!');
      }).catch(function () {});
    }
  }

  function handleDirectSheetUpload(input) {
    var file = input && input.files && input.files[0];
    if (!file) return;
    if (!root.XLSX) {
      if (root.showToast) root.showToast('⚠️ Excel parser ready nahi hai.');
      return;
    }
    var reader = new root.FileReader();
    reader.onload = function (ev) {
      try {
        var data = new Uint8Array(ev.target.result);
        var wb = root.XLSX.read(data, { type: 'array' });
        var sheets = {};
        (wb.SheetNames || []).forEach(function (sn) {
          sheets[sn] = root.XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: '', raw: false });
        });
        var newObj = { name: file.name, wb: wb, sheets: sheets, uploadedAt: new Date().toISOString() };
        if (!Array.isArray(root.FILES)) root.FILES = [];
        root.FILES = root.FILES.filter(function (x) { return x && x.name !== file.name; });
        root.FILES.unshift(newObj);
        state.settings.selectedFileName = file.name;
        state.settings.selectedSheets = [];
        state.settings.monthDays = guessMonthDaysFromName(file.name);
        state.settings.colMap = Object.assign({}, DEFAULT_SETTINGS.colMap);
        saveSettings();
        if (typeof root.updateAllFilesBadge === 'function') root.updateAllFilesBadge();
        renderUI();
        if (root.showToast) root.showToast('✅ Sheet "' + file.name + '" loaded for PF & ESIC Export!');
      } catch (err) {
        if (root.showToast) root.showToast('❌ File read failed: ' + err.message);
      }
    };
    reader.readAsArrayBuffer(file);
  }

  function formatInr(n) {
    return '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
  }

  function injectStyles() {
    var doc = root.document;
    if (!doc || !doc.head || doc.getElementById('atpl-ecrp-styles')) return;
    var css = [
      '#page-ecrportal { font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }',
      '.ecrp-wrap { max-width: 1440px; margin: 0 auto; padding: 18px 20px 44px; }',
      '.ecrp-card { background: #ffffff; border: 1px solid #e2e8f0; border-radius: 14px; padding: 16px 18px; box-shadow: 0 1px 3px rgba(15,23,42,0.04); margin-bottom: 14px; }',
      '.ecrp-header { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 14px; }',
      '.ecrp-title { font-size: 20px; font-weight: 800; color: #0f172a; display: flex; align-items: center; gap: 10px; margin: 0; }',
      '.ecrp-sub { font-size: 12.5px; color: #64748b; margin-top: 4px; }',
      '.ecrp-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }',
      '.ecrp-btn { border: 1px solid #cbd5e1; background: #ffffff; color: #0f172a; padding: 8px 14px; border-radius: 9px; font-size: 12.5px; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; transition: all .14s; }',
      '.ecrp-btn:hover { background: #f8fafc; border-color: #94a3b8; }',
      '.ecrp-btn-primary { background: #0284c7; border-color: #0284c7; color: #ffffff; }',
      '.ecrp-btn-primary:hover { background: #0369a1; }',
      '.ecrp-btn-green { background: #16a34a; border-color: #16a34a; color: #ffffff; }',
      '.ecrp-btn-green:hover { background: #15803d; }',
      '.ecrp-btn-amber { background: #fffbeb; border-color: #fcd34d; color: #92400e; }',
      '.ecrp-kpis { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 12px; margin-bottom: 14px; }',
      '@media (max-width: 1120px) { .ecrp-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); } }',
      '@media (max-width: 600px) { .ecrp-kpis { grid-template-columns: 1fr; } }',
      '.ecrp-kpi { text-align: left; width: 100%; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 13px 15px; cursor: pointer; transition: all .14s; }',
      '.ecrp-kpi:hover { border-color: #94a3b8; transform: translateY(-1px); box-shadow: 0 4px 12px rgba(15,23,42,0.06); }',
      '.ecrp-kpi.active { border-color: #0f172a; box-shadow: 0 0 0 2px rgba(15,23,42,0.08); }',
      '.ecrp-kpi-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; font-size: 10.5px; font-weight: 800; text-transform: uppercase; letter-spacing: .04em; color: #64748b; }',
      '.ecrp-kpi-top span:last-child { white-space: nowrap; flex-shrink: 0; }',
      '.ecrp-kpi-val { font-size: 22px; font-weight: 800; color: #0f172a; margin: 5px 0 3px; font-variant-numeric: tabular-nums; }',
      '.ecrp-kpi-sub { font-size: 11.5px; color: #64748b; }',
      '.ecrp-kpi-pf { background: #f0f9ff; border-color: #bae6fd; } .ecrp-kpi-pf .ecrp-kpi-top, .ecrp-kpi-pf .ecrp-kpi-val { color: #0369a1; }',
      '.ecrp-kpi-esic { background: #ecfdf5; border-color: #a7f3d0; } .ecrp-kpi-esic .ecrp-kpi-top, .ecrp-kpi-esic .ecrp-kpi-val { color: #047857; }',
      '.ecrp-kpi-warn { background: #fffbeb; border-color: #fde68a; } .ecrp-kpi-warn .ecrp-kpi-top, .ecrp-kpi-warn .ecrp-kpi-val { color: #b45309; }',
      '.ecrp-ctrl-grid { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-end; }',
      '.ecrp-field { display: flex; flex-direction: column; gap: 4px; min-width: 150px; }',
      '.ecrp-field label { font-size: 11px; font-weight: 700; color: #475569; text-transform: uppercase; letter-spacing: .03em; }',
      '.ecrp-select, .ecrp-input { padding: 7px 10px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 12.5px; background: #fff; color: #0f172a; font-weight: 600; }',
      '.ecrp-chip-row { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; align-items: center; }',
      '.ecrp-chip { border: 1px solid #cbd5e1; background: #f8fafc; color: #334155; padding: 5px 11px; border-radius: 8px; font-size: 12px; font-weight: 700; cursor: pointer; }',
      '.ecrp-chip.active { background: #0f172a; border-color: #0f172a; color: #ffffff; }',
      '.ecrp-tabs { display: flex; flex-wrap: wrap; gap: 8px; border-bottom: 1px solid #e2e8f0; padding-bottom: 10px; margin-bottom: 12px; }',
      '.ecrp-tab { border: 1px solid #e2e8f0; background: #f8fafc; color: #334155; padding: 7px 14px; border-radius: 9px; font-size: 12.5px; font-weight: 700; cursor: pointer; }',
      '.ecrp-tab.active { background: #0f172a; border-color: #0f172a; color: #ffffff; }',
      '.ecrp-tbl-wrap { overflow-x: auto; border: 1px solid #e2e8f0; border-radius: 10px; }',
      '.ecrp-tbl { width: 100%; border-collapse: collapse; font-size: 12px; }',
      '.ecrp-tbl th { background: #f1f5f9; color: #334155; font-size: 11px; font-weight: 800; text-transform: uppercase; padding: 9px 10px; text-align: left; border-bottom: 1px solid #e2e8f0; white-space: nowrap; }',
      '.ecrp-tbl td { padding: 8px 10px; border-bottom: 1px solid #f1f5f9; color: #0f172a; white-space: nowrap; }',
      '.ecrp-tbl tr:hover td { background: #f8fafc; }',
      '.ecrp-badge { display: inline-block; padding: 2px 8px; border-radius: 6px; font-size: 11px; font-weight: 700; }',
      '.ecrp-badge-ok { background: #ecfdf5; color: #047857; border: 1px solid #a7f3d0; }',
      '.ecrp-badge-err { background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca; }',
      '.ecrp-pre { width: 100%; min-height: 170px; background: #0f172a; color: #86efac; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11.5px; padding: 12px; border-radius: 10px; border: 1px solid #1e293b; box-sizing: border-box; }'
    ].join('\n');
    var styleEl = doc.createElement('style');
    styleEl.id = 'atpl-ecrp-styles';
    styleEl.textContent = css;
    doc.head.appendChild(styleEl);
  }

  function renderUI() {
    var doc = root.document;
    if (!doc) return;
    var container = doc.getElementById('ecrPortalContainer');
    if (!container) return;
    injectStyles();

    var workbooks = getLoadedWorkbooks();
    if (!workbooks.length) {
      state.selectedWorkbook = null;
      state.computed = null;
      container.innerHTML =
        '<div class="ecrp-wrap">' +
          '<div class="ecrp-card ecrp-header">' +
            '<div>' +
              '<h2 class="ecrp-title">🏛️ PF &amp; ESIC Portal Export (EPFO ECR &amp; ESIC Challan Upload)</h2>' +
              '<div class="ecrp-sub">Kisi bhi mahine ki Salary Sheet select karke direct EPFO Portal (#~# ECR) aur ESIC Portal upload file generate karein.</div>' +
            '</div>' +
            '<div class="ecrp-actions">' +
              '<label class="ecrp-btn ecrp-btn-primary">📤 Upload Salary Sheet (.xlsx / .xls / .csv)' +
                '<input type="file" accept=".xlsx,.xls,.csv" style="display:none" id="ecrpDirectUploadInput">' +
              '</label>' +
            '</div>' +
          '</div>' +
          '<div class="ecrp-card" style="text-align:center;padding:46px 20px">' +
            '<div style="font-size:38px;margin-bottom:10px">📊</div>' +
            '<div style="font-size:16px;font-weight:800;color:#0f172a">Abhi koi Salary Sheet loaded nahi hai</div>' +
            '<div style="font-size:13px;color:#64748b;margin:6px auto 16px;max-width:480px">Upar "Upload Salary Sheet" dabaye ya "All Files / Sync Data" se apni monthly salary Excel load karein — uske baad 1 click me EPFO ECR aur ESIC file ban jayegi.</div>' +
          '</div>' +
        '</div>';
      wireDomEvents(container);
      return;
    }

    var selectedWb = workbooks.find(function (w) { return w.name === state.settings.selectedFileName; }) || workbooks[0];
    if (state.settings.selectedFileName !== selectedWb.name) {
      state.settings.selectedFileName = selectedWb.name;
      state.settings.selectedSheets = [];
      state.settings.monthDays = guessMonthDaysFromName(selectedWb.name);
      saveSettings();
    }
    state.selectedWorkbook = selectedWb;

    var computed = computePortalExport(selectedWb, state.settings, state.overrides);
    state.computed = computed;
    if (!state.settings.selectedSheets.length && computed.activeTabNames.length) {
      state.settings.selectedSheets = computed.activeTabNames.slice();
    }
    var t = computed.totals;
    var q = String(state.settings.searchQuery || '').toLowerCase().trim();
    var filteredRows = computed.rows.filter(function (r) {
      if (!q) return true;
      return String(r.empCode).toLowerCase().indexOf(q) >= 0 ||
        String(r.name).toLowerCase().indexOf(q) >= 0 ||
        String(r.uan).indexOf(q) >= 0 ||
        String(r.esicIp).indexOf(q) >= 0;
    });

    var missingCount = t.pfMissingUanCount + t.esicMissingIpCount;
    var validTotal = t.pfValidCount + t.esicValidCount;
    var activeTab = state.settings.activeTab || 'pf-ecr';

    var h = '<div class="ecrp-wrap">';
    // Header card
    h += '<div class="ecrp-card ecrp-header">';
    h += '<div>';
    h += '<h2 class="ecrp-title">🏛️ PF &amp; ESIC Portal Export <span style="font-size:11px;background:#ecfdf5;color:#047857;border:1px solid #a7f3d0;padding:2px 8px;border-radius:6px">EPFO #~# + ESIC MC</span></h2>';
    h += '<div class="ecrp-sub">Salary sheet select karein → Portal-ready EPFO ECR (.txt) &amp; ESIC Contribution (.xls / .xlsx / .csv) 1 click me download karein.</div>';
    h += '</div>';
    h += '<div class="ecrp-actions">';
    h += '<label class="ecrp-btn">📤 Upload New Sheet<input type="file" accept=".xlsx,.xls,.csv" style="display:none" id="ecrpDirectUploadInput"></label>';
    h += '<button type="button" class="ecrp-btn ecrp-btn-primary" id="ecrpBtnDownloadPf">⬇ Download PF ECR (.txt)</button>';
    h += '<button type="button" class="ecrp-btn ecrp-btn-green" id="ecrpBtnDownloadEsicXls">⬇ ESIC Portal (.xls)</button>';
    h += '<button type="button" class="ecrp-btn" id="ecrpBtnDownloadEsicXlsx">⬇ ESIC (.xlsx)</button>';
    h += '<button type="button" class="ecrp-btn" id="ecrpBtnPrint">🖨 Print Challan Summary</button>';
    h += '</div></div>';

    // Selector + Settings card
    h += '<div class="ecrp-card">';
    h += '<div class="ecrp-ctrl-grid">';
    h += '<div class="ecrp-field" style="min-width:260px;flex:1"><label for="ecrpFileSelect">1. Select Salary Sheet</label><select id="ecrpFileSelect" class="ecrp-select">';
    workbooks.forEach(function (wb) {
      h += '<option value="' + escHtml(wb.name) + '"' + (wb.name === selectedWb.name ? ' selected' : '') + '>' + escHtml(wb.name) + ' (' + wb.sheetNames.length + ' tabs)</option>';
    });
    h += '</select></div>';

    h += '<div class="ecrp-field"><label for="ecrpMonthDays">Month Days</label><select id="ecrpMonthDays" class="ecrp-select">';
    [28, 29, 30, 31].forEach(function (d) {
      h += '<option value="' + d + '"' + (Number(state.settings.monthDays) === d ? ' selected' : '') + '>' + d + ' Days</option>';
    });
    h += '</select></div>';

    h += '<div class="ecrp-field"><label for="ecrpEpfBase">EPF Wage Source</label><select id="ecrpEpfBase" class="ecrp-select">';
    h += '<option value="basic_or_pf"' + (state.settings.epfWageBase === 'basic_or_pf' ? ' selected' : '') + '>Basic / PF Wage</option>';
    h += '<option value="gross"' + (state.settings.epfWageBase === 'gross' ? ' selected' : '') + '>Gross Wages</option>';
    h += '</select></div>';

    h += '<div class="ecrp-field"><label>Portal Rules</label><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:6px 0">';
    h += '<label style="display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:600;color:#0f172a;text-transform:none;cursor:pointer"><input type="checkbox" id="ecrpCap15k"' + (state.settings.capEpfAt15k ? ' checked' : '') + '> Cap EPF ₹15,000</label>';
    h += '<label style="display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:600;color:#0f172a;text-transform:none;cursor:pointer"><input type="checkbox" id="ecrpUseSheetPf"' + (state.settings.useSheetPfAmount ? ' checked' : '') + '> Sheet Exact PF/ESIC</label>';
    h += '<label style="display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:600;color:#0f172a;text-transform:none;cursor:pointer"><input type="checkbox" id="ecrpOnlyValid"' + (state.settings.onlyValidPortalIds ? ' checked' : '') + '> Valid UAN/IP Only (Safe)</label>';
    h += '</div></div>';

    h += '<div><button type="button" class="ecrp-btn" id="ecrpToggleMappingBtn">⚙ Column Mapping</button></div>';
    h += '</div>';

    // Sheet tab selector
    if (computed.tabs.length > 0) {
      h += '<div class="ecrp-chip-row"><span style="font-size:11px;font-weight:800;color:#475569;text-transform:uppercase">Sheet Tabs:</span>';
      computed.tabs.forEach(function (tb) {
        var active = computed.activeTabNames.indexOf(tb.sheetName) >= 0;
        h += '<button type="button" class="ecrp-chip' + (active ? ' active' : '') + '" data-ecrp-sheet="' + escHtml(tb.sheetName) + '">' + escHtml(tb.sheetName) + ' (' + tb.rowCount + ')</button>';
      });
      h += '</div>';
    }

    // Collapsible manual column mapping
    if (state.settings.showMapping && computed.colHeaders.length > 0) {
      var mapFields = [
        { key: 'empCode', label: 'Emp Code' },
        { key: 'empName', label: 'Emp Name' },
        { key: 'uan', label: 'UAN (Sheet)' },
        { key: 'esicIp', label: 'ESIC IP (Sheet)' },
        { key: 'days', label: 'Paid Days' },
        { key: 'basic', label: 'Basic / EPF Wage' },
        { key: 'gross', label: 'Gross Wages' },
        { key: 'pfDed', label: 'PF 12% Col' },
        { key: 'esicDed', label: 'ESIC 0.75% Col' }
      ];
      h += '<div style="margin-top:12px;padding-top:12px;border-top:1px dashed #cbd5e1;display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px">';
      mapFields.forEach(function (mf) {
        var autoIdx = computed.detectedMap[mf.key];
        var curVal = state.settings.colMap[mf.key];
        h += '<div class="ecrp-field"><label>' + mf.label + '</label><select class="ecrp-select ecrp-colmap-sel" data-colkey="' + mf.key + '">';
        h += '<option value="">Auto (' + (autoIdx >= 0 && computed.colHeaders[autoIdx] ? escHtml(computed.colHeaders[autoIdx]) : 'Master/None') + ')</option>';
        h += '<option value="__NONE__"' + (curVal === '__NONE__' ? ' selected' : '') + '>-- Ignore --</option>';
        computed.colHeaders.forEach(function (ch, ci) {
          h += '<option value="' + ci + '"' + (String(curVal) === String(ci) ? ' selected' : '') + '>' + escHtml(ch) + '</option>';
        });
        h += '</select></div>';
      });
      h += '</div>';
    }
    h += '</div>';

    // 5 Actionable Button-Type KPI Cards
    h += '<div class="ecrp-kpis">';
    h += '<button type="button" class="ecrp-kpi ecrp-kpi-pf' + (activeTab === 'pf-ecr' ? ' active' : '') + '" data-ecrp-tab="pf-ecr">' +
      '<div class="ecrp-kpi-top"><span>🏛️ EPFO PF Challan</span><span>' + t.pfEligibleCount + ' Members</span></div>' +
      '<div class="ecrp-kpi-val">' + formatInr(t.totalPFChallan) + '</div>' +
      '<div class="ecrp-kpi-sub">EE ' + formatInr(t.eePF) + ' · EPS ' + formatInr(t.erEPS) + ' · Diff ' + formatInr(t.erDiff) + ' · A/c2+21 ' + formatInr(t.adminAc2 + t.edliAc21) + '</div>' +
      '</button>';

    h += '<button type="button" class="ecrp-kpi ecrp-kpi-esic' + (activeTab === 'esic-return' ? ' active' : '') + '" data-ecrp-tab="esic-return">' +
      '<div class="ecrp-kpi-top"><span>🏥 ESIC Challan</span><span>' + t.esicEligibleCount + ' Beneficiaries</span></div>' +
      '<div class="ecrp-kpi-val">' + formatInr(t.totalESICChallan) + '</div>' +
      '<div class="ecrp-kpi-sub">EE 0.75% ' + formatInr(t.eeESIC) + ' · ER 3.25% ' + formatInr(t.erESIC) + '</div>' +
      '</button>';

    h += '<button type="button" class="ecrp-kpi' + (activeTab === 'breakdown' ? ' active' : '') + '" data-ecrp-tab="breakdown">' +
      '<div class="ecrp-kpi-top"><span>💳 Total Portal Deposit</span><span>' + t.totalEmployees + ' Workers</span></div>' +
      '<div class="ecrp-kpi-val">' + formatInr(t.grandTotalDeposit) + '</div>' +
      '<div class="ecrp-kpi-sub">EPF Wages ' + formatInr(t.epfWages) + ' · ESIC Wages ' + formatInr(t.esicWages) + '</div>' +
      '</button>';

    h += '<button type="button" class="ecrp-kpi ecrp-kpi-esic' + (activeTab === 'pf-ecr' ? ' active' : '') + '" data-ecrp-tab="pf-ecr">' +
      '<div class="ecrp-kpi-top"><span>✅ Portal Ready Rows</span><span>Valid IDs</span></div>' +
      '<div class="ecrp-kpi-val">' + t.pfValidCount + ' PF / ' + t.esicValidCount + ' ESIC</div>' +
      '<div class="ecrp-kpi-sub">' + validTotal + ' verified portal lines ready</div>' +
      '</button>';

    h += '<button type="button" class="ecrp-kpi ' + (missingCount > 0 ? 'ecrp-kpi-warn' : 'ecrp-kpi-esic') + (activeTab === 'missing-ids' ? ' active' : '') + '" data-ecrp-tab="missing-ids">' +
      '<div class="ecrp-kpi-top"><span>⚠️ Missing UAN / IP</span><span>' + (missingCount > 0 ? 'Fix Inline' : '100% Clean') + '</span></div>' +
      '<div class="ecrp-kpi-val">' + missingCount + '</div>' +
      '<div class="ecrp-kpi-sub">' + t.pfMissingUanCount + ' PF UAN · ' + t.esicMissingIpCount + ' ESIC IP missing</div>' +
      '</button>';
    h += '</div>';

    // Workspace Tabs Card
    h += '<div class="ecrp-card">';
    h += '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:10px">';
    h += '<div class="ecrp-tabs" style="margin-bottom:0;border-bottom:none;padding-bottom:0">';
    h += '<button type="button" class="ecrp-tab' + (activeTab === 'pf-ecr' ? ' active' : '') + '" data-ecrp-tab="pf-ecr">🏛️ EPFO ECR Format (#~#)</button>';
    h += '<button type="button" class="ecrp-tab' + (activeTab === 'esic-return' ? ' active' : '') + '" data-ecrp-tab="esic-return">🏥 ESIC Portal Upload (MC)</button>';
    h += '<button type="button" class="ecrp-tab' + (activeTab === 'breakdown' ? ' active' : '') + '" data-ecrp-tab="breakdown">📊 Challan Statement (' + t.totalEmployees + ')</button>';
    h += '<button type="button" class="ecrp-tab' + (activeTab === 'missing-ids' ? ' active' : '') + '" data-ecrp-tab="missing-ids">⚠️ Missing UAN / IP Fixer (' + missingCount + ')</button>';
    h += '</div>';
    h += '<input type="search" id="ecrpSearchInput" class="ecrp-input" style="min-width:240px" placeholder="🔍 Search Code, Name, UAN, ESIC IP..." value="' + escHtml(state.settings.searchQuery) + '">';
    h += '</div>';

    if (activeTab === 'pf-ecr') {
      h += renderPfEcrTab(filteredRows);
    } else if (activeTab === 'esic-return') {
      h += renderEsicTab(filteredRows);
    } else if (activeTab === 'breakdown') {
      h += renderBreakdownTab(filteredRows, t);
    } else {
      h += renderMissingIdsTab(filteredRows);
    }

    h += '</div></div>';
    container.innerHTML = h;
    wireDomEvents(container);
  }

  function renderPfEcrTab(rows) {
    var pfRows = rows.filter(function (r) { return r.isPfEligible && r.epfWage > 0; });
    var rawText = buildEpfoEcrText(pfRows, state.settings.onlyValidPortalIds);
    var exportedCount = rawText ? rawText.split('\r\n').length : 0;
    var h = '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:10px;padding:10px 12px;background:#f0f9ff;border:1px solid #bae6fd;border-radius:10px">';
    h += '<div style="font-size:12.5px;color:#0369a1;font-weight:700">EPFO Unified Portal ECR Text (#~# 11 Columns) — <strong>' + exportedCount + '</strong> valid lines ready (Total PF rows: ' + pfRows.length + ')</div>';
    h += '<div style="display:flex;gap:8px"><button type="button" class="ecrp-btn" id="ecrpCopyEcrBtn">📋 Copy ECR Lines</button><button type="button" class="ecrp-btn ecrp-btn-primary" id="ecrpDownloadPfBtn2">⬇ Download ECR (.txt)</button></div>';
    h += '</div>';

    h += '<div style="margin-bottom:12px"><textarea readonly class="ecrp-pre">' + escHtml(rawText || 'Koi valid 12-digit UAN row export ke liye ready nahi hai. Missing UAN / IP tab me UAN fill karein ya "Valid UAN/IP Only" uncheck karke preview dekhein.') + '</textarea></div>';

    h += '<div class="ecrp-tbl-wrap"><table class="ecrp-tbl"><thead><tr>' +
      '<th>Code</th><th>UAN (12 Digit)</th><th>Member Name</th><th>Gross</th><th>EPF Wage</th><th>EPS Wage</th><th>EDLI Wage</th><th>EE 12%</th><th>EPS 8.33%</th><th>ER Diff</th><th>NCP Days</th>' +
      '</tr></thead><tbody>';
    pfRows.slice(0, 150).forEach(function (r) {
      h += '<tr>' +
        '<td><strong>' + escHtml(r.empCode) + '</strong></td>' +
        '<td>' + (r.uanValid ? '<span class="ecrp-badge ecrp-badge-ok">' + escHtml(r.uan) + '</span>' : '<span class="ecrp-badge ecrp-badge-err">' + escHtml(r.uan || 'MISSING UAN') + '</span>') + '</td>' +
        '<td>' + escHtml(r.portalName) + '</td>' +
        '<td>' + r.gross + '</td><td>' + r.epfWage + '</td><td>' + r.epsWage + '</td><td>' + r.edliWage + '</td>' +
        '<td><strong>' + r.eePF + '</strong></td><td>' + r.erEPS + '</td><td>' + r.erDiff + '</td><td>' + r.ncpDays + '</td>' +
        '</tr>';
    });
    if (!pfRows.length) h += '<tr><td colspan="11" style="text-align:center;padding:24px;color:#64748b">Koi PF eligible employee is filter me nahi mila.</td></tr>';
    h += '</tbody></table></div>';
    if (pfRows.length > 150) h += '<div style="margin-top:8px;font-size:11.5px;color:#64748b">Table preview me pehle 150 rows dikh rahe hain; download file me saari ' + exportedCount + ' rows hongi.</div>';
    return h;
  }

  function renderEsicTab(rows) {
    var esicRows = rows.filter(function (r) { return r.isEsicEligible; });
    var validCount = esicRows.filter(function (r) { return r.ipValid; }).length;
    var h = '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:10px;padding:10px 12px;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:10px">';
    h += '<div style="font-size:12.5px;color:#047857;font-weight:700">ESIC Portal Monthly Contribution Upload — <strong>' + validCount + '</strong> valid 10-digit IP rows ready (Total ESIC rows: ' + esicRows.length + ')</div>';
    h += '<div style="display:flex;gap:8px"><button type="button" class="ecrp-btn ecrp-btn-green" id="ecrpDownloadEsicXls2">⬇ ESIC (.xls Portal)</button><button type="button" class="ecrp-btn" id="ecrpDownloadEsicXlsx2">⬇ ESIC (.xlsx)</button><button type="button" class="ecrp-btn" id="ecrpDownloadEsicCsv2">⬇ ESIC (.csv)</button></div>';
    h += '</div>';

    h += '<div class="ecrp-tbl-wrap"><table class="ecrp-tbl"><thead><tr>' +
      '<th>Code</th><th>IP Number (10 Digit)</th><th>IP Name</th><th>Days Worked</th><th>Total Monthly Wages</th><th>EE 0.75%</th><th>ER 3.25%</th><th>Reason Code</th><th>Last Working Day</th>' +
      '</tr></thead><tbody>';
    esicRows.slice(0, 150).forEach(function (r) {
      h += '<tr>' +
        '<td><strong>' + escHtml(r.empCode) + '</strong></td>' +
        '<td>' + (r.ipValid ? '<span class="ecrp-badge ecrp-badge-ok">' + escHtml(r.esicIp) + '</span>' : '<span class="ecrp-badge ecrp-badge-err">' + escHtml(r.esicIp || 'MISSING IP') + '</span>') + '</td>' +
        '<td>' + escHtml(r.portalName) + '</td>' +
        '<td>' + (r.esicWage > 0 ? r.paidDays : 0) + '</td>' +
        '<td><strong>' + r.esicWage + '</strong></td>' +
        '<td>' + r.eeESIC + '</td><td>' + r.erESIC + '</td>' +
        '<td><select class="ecrp-select ecrp-reason-sel" data-empkey="' + escHtml(r.empKey) + '" style="padding:3px 6px;font-size:11.5px;max-width:170px">' +
          ESIC_REASONS.map(function (rs) {
            return '<option value="' + rs.code + '"' + (String(r.reasonCode) === rs.code ? ' selected' : '') + '>' + escHtml(rs.label) + '</option>';
          }).join('') +
        '</select></td>' +
        '<td><input type="text" class="ecrp-input ecrp-lwd-inp" data-empkey="' + escHtml(r.empKey) + '" placeholder="DD/MM/YYYY" value="' + escHtml(r.lastWorkingDay) + '" style="width:105px;padding:3px 6px;font-size:11.5px"></td>' +
        '</tr>';
    });
    if (!esicRows.length) h += '<tr><td colspan="9" style="text-align:center;padding:24px;color:#64748b">Koi ESIC eligible employee is filter me nahi mila.</td></tr>';
    h += '</tbody></table></div>';
    return h;
  }

  function renderBreakdownTab(rows, t) {
    var h = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px;margin-bottom:14px">' +
      '<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px 14px">' +
        '<div style="font-size:12px;font-weight:800;color:#0369a1;margin-bottom:6px">🏛️ EPFO ACCOUNT SUMMARY</div>' +
        '<div style="font-size:12px;line-height:1.7;color:#334155">' +
          'A/c 1 (Employee 12%): <strong>' + formatInr(t.eePF) + '</strong><br>' +
          'A/c 1 (Employer Diff 3.67%): <strong>' + formatInr(t.erDiff) + '</strong><br>' +
          'A/c 10 (EPS Pension 8.33%): <strong>' + formatInr(t.erEPS) + '</strong><br>' +
          'A/c 2 (Admin 0.5%, min ₹500): <strong>' + formatInr(t.adminAc2) + '</strong><br>' +
          'A/c 21 (EDLI 0.5%): <strong>' + formatInr(t.edliAc21) + '</strong><br>' +
          '<strong>Total PF Challan: ' + formatInr(t.totalPFChallan) + '</strong>' +
        '</div>' +
      '</div>' +
      '<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px 14px">' +
        '<div style="font-size:12px;font-weight:800;color:#047857;margin-bottom:6px">🏥 ESIC CONTRIBUTION SUMMARY</div>' +
        '<div style="font-size:12px;line-height:1.7;color:#334155">' +
          'Total ESIC Covered Wages: <strong>' + formatInr(t.esicWages) + '</strong><br>' +
          'Employee Share (0.75%): <strong>' + formatInr(t.eeESIC) + '</strong><br>' +
          'Employer Share (3.25%): <strong>' + formatInr(t.erESIC) + '</strong><br>' +
          'Beneficiaries Count: <strong>' + t.esicEligibleCount + '</strong><br>' +
          '<strong>Total ESIC Challan: ' + formatInr(t.totalESICChallan) + '</strong>' +
        '</div>' +
      '</div>' +
    '</div>';

    h += '<div class="ecrp-tbl-wrap"><table class="ecrp-tbl"><thead><tr>' +
      '<th>Code</th><th>Name</th><th>Days</th><th>Basic</th><th>Gross</th><th>EPF Wage</th><th>EE PF</th><th>ER EPS</th><th>ER Diff</th><th>ESIC Wage</th><th>EE ESIC</th><th>ER ESIC</th>' +
      '</tr></thead><tbody>';
    rows.slice(0, 150).forEach(function (r) {
      h += '<tr>' +
        '<td><strong>' + escHtml(r.empCode) + '</strong></td>' +
        '<td>' + escHtml(r.name) + '</td>' +
        '<td>' + r.paidDays + '</td><td>' + r.basic + '</td><td>' + r.gross + '</td>' +
        '<td>' + r.epfWage + '</td><td><strong>' + r.eePF + '</strong></td><td>' + r.erEPS + '</td><td>' + r.erDiff + '</td>' +
        '<td>' + r.esicWage + '</td><td><strong>' + r.eeESIC + '</strong></td><td>' + r.erESIC + '</td>' +
        '</tr>';
    });
    h += '</tbody></table></div>';
    return h;
  }

  function renderMissingIdsTab(rows) {
    var bad = rows.filter(function (r) {
      return (r.isPfEligible && r.epfWage > 0 && !r.uanValid) || (r.isEsicEligible && !r.ipValid);
    });
    var h = '<div style="margin-bottom:10px;padding:10px 12px;background:#fffbeb;border:1px solid #fde68a;border-radius:10px;font-size:12.5px;color:#92400e;font-weight:700">' +
      'Yahan un workers ko fix karein jinka 12-digit UAN ya 10-digit ESIC IP missing/galat hai. Type karte hi save ho jata hai aur ECR/ESIC download file me turant jud jayega.' +
      '</div>';
    h += '<div class="ecrp-tbl-wrap"><table class="ecrp-tbl"><thead><tr>' +
      '<th>Code</th><th>Name</th><th>PF Wage</th><th>12-Digit UAN</th><th>ESIC Wage</th><th>10-Digit ESIC IP</th><th>Action</th>' +
      '</tr></thead><tbody>';
    bad.slice(0, 200).forEach(function (r) {
      var uanNeeds = r.isPfEligible && r.epfWage > 0 && !r.uanValid;
      var ipNeeds = r.isEsicEligible && !r.ipValid;
      h += '<tr>' +
        '<td><strong>' + escHtml(r.empCode) + '</strong></td>' +
        '<td>' + escHtml(r.name) + '</td>' +
        '<td>' + r.epfWage + '</td>' +
        '<td><input type="text" maxlength="12" class="ecrp-input ecrp-fix-uan" data-empkey="' + escHtml(r.empKey) + '" data-empcode="' + escHtml(r.empCode) + '" placeholder="12 digit UAN" value="' + escHtml(r.uan) + '" style="width:135px;' + (uanNeeds ? 'border-color:#f59e0b;background:#fffbeb' : '') + '"></td>' +
        '<td>' + r.esicWage + '</td>' +
        '<td><input type="text" maxlength="10" class="ecrp-input ecrp-fix-ip" data-empkey="' + escHtml(r.empKey) + '" data-empcode="' + escHtml(r.empCode) + '" placeholder="10 digit ESIC IP" value="' + escHtml(r.esicIp) + '" style="width:125px;' + (ipNeeds ? 'border-color:#f59e0b;background:#fffbeb' : '') + '"></td>' +
        '<td><button type="button" class="ecrp-btn ecrp-btn-primary ecrp-save-id-btn" data-empkey="' + escHtml(r.empKey) + '" data-empcode="' + escHtml(r.empCode) + '">Save ID</button></td>' +
        '</tr>';
    });
    if (!bad.length) h += '<tr><td colspan="7" style="text-align:center;padding:24px;color:#047857;font-weight:700">✅ Sabhi eligible workers ke UAN aur ESIC IP valid hain!</td></tr>';
    h += '</tbody></table></div>';
    return h;
  }

  function wireDomEvents(container) {
    var uploadInp = container.querySelector('#ecrpDirectUploadInput');
    if (uploadInp) uploadInp.onchange = function () { handleDirectSheetUpload(this); };

    var fileSel = container.querySelector('#ecrpFileSelect');
    if (fileSel) {
      fileSel.onchange = function () {
        state.settings.selectedFileName = this.value;
        state.settings.selectedSheets = [];
        state.settings.monthDays = guessMonthDaysFromName(this.value);
        state.settings.colMap = Object.assign({}, DEFAULT_SETTINGS.colMap);
        saveSettings();
        renderUI();
      };
    }

    var daysSel = container.querySelector('#ecrpMonthDays');
    if (daysSel) {
      daysSel.onchange = function () {
        state.settings.monthDays = parseInt(this.value, 10) || 30;
        saveSettings();
        renderUI();
      };
    }

    var epfBaseSel = container.querySelector('#ecrpEpfBase');
    if (epfBaseSel) {
      epfBaseSel.onchange = function () {
        state.settings.epfWageBase = this.value;
        saveSettings();
        renderUI();
      };
    }

    var capChk = container.querySelector('#ecrpCap15k');
    if (capChk) capChk.onchange = function () { state.settings.capEpfAt15k = !!this.checked; saveSettings(); renderUI(); };
    var sheetPfChk = container.querySelector('#ecrpUseSheetPf');
    if (sheetPfChk) sheetPfChk.onchange = function () { state.settings.useSheetPfAmount = !!this.checked; saveSettings(); renderUI(); };
    var validOnlyChk = container.querySelector('#ecrpOnlyValid');
    if (validOnlyChk) validOnlyChk.onchange = function () { state.settings.onlyValidPortalIds = !!this.checked; saveSettings(); renderUI(); };

    var mapBtn = container.querySelector('#ecrpToggleMappingBtn');
    if (mapBtn) mapBtn.onclick = function () { state.settings.showMapping = !state.settings.showMapping; saveSettings(); renderUI(); };

    Array.prototype.forEach.call(container.querySelectorAll('.ecrp-colmap-sel'), function (sel) {
      sel.onchange = function () {
        var k = this.getAttribute('data-colkey');
        state.settings.colMap[k] = this.value;
        saveSettings();
        renderUI();
      };
    });

    Array.prototype.forEach.call(container.querySelectorAll('[data-ecrp-sheet]'), function (btn) {
      btn.onclick = function () {
        var sn = this.getAttribute('data-ecrp-sheet');
        var cur = state.settings.selectedSheets.slice();
        var idx = cur.indexOf(sn);
        if (idx >= 0 && cur.length > 1) cur.splice(idx, 1);
        else if (idx < 0) cur.push(sn);
        state.settings.selectedSheets = cur;
        saveSettings();
        renderUI();
      };
    });

    Array.prototype.forEach.call(container.querySelectorAll('[data-ecrp-tab]'), function (btn) {
      btn.onclick = function () {
        state.settings.activeTab = this.getAttribute('data-ecrp-tab');
        saveSettings();
        renderUI();
      };
    });

    var srch = container.querySelector('#ecrpSearchInput');
    if (srch) {
      srch.oninput = function () {
        state.settings.searchQuery = this.value;
        saveSettings();
        renderUI();
        var el = container.querySelector('#ecrpSearchInput');
        if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
      };
    }

    var bindClick = function (id, fn) {
      var b = container.querySelector('#' + id);
      if (b) b.onclick = fn;
    };
    bindClick('ecrpBtnDownloadPf', downloadPfEcr);
    bindClick('ecrpDownloadPfBtn2', downloadPfEcr);
    bindClick('ecrpCopyEcrBtn', copyEcrToClipboard);
    bindClick('ecrpBtnDownloadEsicXls', function () { downloadEsic('xls'); });
    bindClick('ecrpDownloadEsicXls2', function () { downloadEsic('xls'); });
    bindClick('ecrpBtnDownloadEsicXlsx', function () { downloadEsic('xlsx'); });
    bindClick('ecrpDownloadEsicXlsx2', function () { downloadEsic('xlsx'); });
    bindClick('ecrpDownloadEsicCsv2', function () { downloadEsic('csv'); });
    bindClick('ecrpBtnPrint', function () { if (typeof root.print === 'function') root.print(); });

    Array.prototype.forEach.call(container.querySelectorAll('.ecrp-reason-sel'), function (sel) {
      sel.onchange = function () {
        var key = this.getAttribute('data-empkey');
        state.overrides[key] = Object.assign({}, state.overrides[key] || {}, { reasonCode: this.value });
        saveOverrides();
        renderUI();
      };
    });

    Array.prototype.forEach.call(container.querySelectorAll('.ecrp-lwd-inp'), function (inp) {
      inp.onchange = function () {
        var key = this.getAttribute('data-empkey');
        state.overrides[key] = Object.assign({}, state.overrides[key] || {}, { lastWorkingDay: this.value.trim() });
        saveOverrides();
        renderUI();
      };
    });

    Array.prototype.forEach.call(container.querySelectorAll('.ecrp-save-id-btn'), function (btn) {
      btn.onclick = function () {
        var key = this.getAttribute('data-empkey');
        var code = this.getAttribute('data-empcode');
        var rowEl = this.closest('tr');
        var uanVal = digitsOnly(rowEl && rowEl.querySelector('.ecrp-fix-uan') ? rowEl.querySelector('.ecrp-fix-uan').value : '');
        var ipVal = digitsOnly(rowEl && rowEl.querySelector('.ecrp-fix-ip') ? rowEl.querySelector('.ecrp-fix-ip').value : '');
        var ovKey = (code && code !== '-') ? code : key;
        state.overrides[ovKey] = Object.assign({}, state.overrides[ovKey] || {}, {
          uan: uanVal,
          esicIp: ipVal
        });
        saveOverrides();
        // Sync back to in-memory Employee Master if matched
        if (code && code !== '-' && Array.isArray(root.EMP_MASTER_DATA)) {
          root.EMP_MASTER_DATA.forEach(function (emp) {
            if (emp && normalizeCode(emp.emp_id || emp.code) === code) {
              if (uanVal.length === 12) emp.pf_no = uanVal;
              if (ipVal.length === 10) emp.esi_no = ipVal;
            }
          });
        }
        if (root.showToast) root.showToast('✅ UAN / ESIC IP updated for ' + (code || key));
        renderUI();
      };
    });
  }

  root.ATPLPfEsicPortalExport = {
    version: MODULE_VERSION,
    renderUI: renderUI,
    computePortalExport: computePortalExport,
    buildEpfoEcrText: buildEpfoEcrText,
    buildEsicSheetRows: buildEsicSheetRows,
    buildEsicWorkbook: buildEsicWorkbook,
    buildEsicCsvText: buildEsicCsvText,
    detectHeaderAndCols: detectHeaderAndCols,
    analyzeWorkbookTabs: analyzeWorkbookTabs,
    sanitizePortalName: sanitizePortalName,
    getState: function () { return state; },
    setSettings: function (patch) {
      state.settings = Object.assign({}, state.settings, patch || {});
      saveSettings();
    },
    setOverride: function (empKey, patch) {
      state.overrides[empKey] = Object.assign({}, state.overrides[empKey] || {}, patch || {});
      saveOverrides();
    }
  };

  if (typeof root.addEventListener === 'function') {
    ['atplVaultUpdated', 'atplFilesUpdated', 'atplMasterUpdated'].forEach(function (evName) {
      root.addEventListener(evName, function () {
        var page = root.document && root.document.getElementById('page-ecrportal');
        if (page && page.classList && page.classList.contains('active')) {
          renderUI();
        }
      });
    });
  }
})(typeof window !== 'undefined' ? window : globalThis);
