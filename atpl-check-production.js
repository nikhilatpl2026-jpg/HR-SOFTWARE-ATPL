/**
 * ATPL HR ERP — Check Production Module (v1)
 *
 * Enterprise monthly attendance & production analytics module:
 *  - Auto-detects & parses all Card sheets (C1, C3, C5..C13, Card no-1..Card no.-13)
 *  - Handles repeated mid-sheet headers, blank daily cells, decimals (1.33, 1.3, 1.25),
 *    blank employee codes, multiple rows per employee/machine, and subtotal row exclusion
 *  - Strict Card Mapping Rule: Credits production to the Card indicated by Machine/Location
 *    code (e.g. C7R inside Card no-1 sheet credits Card 07, C1224PA/C1224SP credits Card 12),
 *    never double-counting
 *  - Calculates Card-wise, Machine-wise, Employee-wise, Rate-wise totals & Production Value
 *    (handles both unit/piece rates e.g. ₹1.8/2.25/2.6/3/4 and monthly salary rates e.g. ₹15,100/mo)
 *  - Interactive Dashboard, Top Producers, Rate Breakdown, Filters & Search, View More Employee
 *    1-31 Daily Breakdown Modal, and Excel (.xlsx) Export
 *  - Persistent IndexedDB + localStorage storage with non-blocking chunked parsing
 */
(function(root) {
  'use strict';

  var BUILD = '2026.11.13-check-production-v1';
  if (root && typeof window !== 'undefined' && root === window && root.__ATPL_CHECK_PRODUCTION_V1__ === BUILD) {
    return;
  }
  if (root) root.__ATPL_CHECK_PRODUCTION_V1__ = BUILD;

  var DB_NAME = 'ATPL_CheckProductionDB_V1';
  var DB_STORE = 'months';
  var META_STORAGE_KEY = 'ATPL_CheckProductionMetaV1';
  var LOCAL_FALLBACK_KEY = 'ATPL_CheckProductionMonthsFallbackV1';
  var KNOWN_CARDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];

  var state = {
    months: {}, // { monthKey: MonthDataset }
    activeMonthKey: '',
    activeTab: 'dashboard', // 'dashboard' | 'cards' | 'machines' | 'employees' | 'rates'
    cardFilter: 'ALL',
    machineFilter: 'ALL',
    rateModeFilter: 'ALL', // 'ALL' | 'piece' | 'monthly'
    searchQuery: '',
    topSortBy: 'qty', // 'qty' | 'value'
    empSortBy: 'value', // 'value' | 'qty' | 'name'
    isParsing: false,
    parseProgressText: '',
    parsePercent: 0,
    empViewLimit: 120,
    machineViewLimit: 120,
    lastError: '',
    pendingMonthKey: '', // optional override in upload bar
    viewMoreEmpKey: null,
    expandedCardKey: null
  };

  // ── Numeric & Text Utilities ──
  function round2(n) {
    return Math.round((Number(n) || 0) * 100) / 100;
  }

  function round3(n) {
    return Math.round((Number(n) || 0) * 1000) / 1000;
  }

  function round4(n) {
    return Math.round((Number(n) || 0) * 10000) / 10000;
  }

  function jsStr(str) {
    return esc(String(str == null ? '' : str).replace(/\\/g, '\\\\').replace(/'/g, "\\'"));
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

  function cleanText(v) {
    return String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  }

  function normHeader(v) {
    return cleanText(v).toLowerCase().replace(/[._:]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function num(v) {
    if (typeof v === 'number') return isFinite(v) ? v : null;
    var s = String(v == null ? '' : v).replace(/[₹,\s]/g, '').trim();
    if (!s || s === '-' || s === '--' || /^n\/?a$/i.test(s)) return null;
    var n = Number(s);
    return isFinite(n) ? n : null;
  }

  function formatQty(v) {
    var n = Number(v) || 0;
    var dec = Math.abs(n - Math.round(n)) > 0.001 ? 2 : 0;
    try {
      return n.toLocaleString('en-IN', { minimumFractionDigits: dec, maximumFractionDigits: 2 });
    } catch (_) {
      return dec ? n.toFixed(2) : String(Math.round(n));
    }
  }

  function formatINR(v) {
    var n = Number(v) || 0;
    var dec = Math.abs(n - Math.round(n)) > 0.005 ? 2 : 0;
    try {
      return '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: dec, maximumFractionDigits: 2 });
    } catch (_) {
      return '₹' + (dec ? n.toFixed(2) : String(Math.round(n)));
    }
  }

  function formatRate(rate, rateKind, divisor) {
    var r = Number(rate) || 0;
    if (r <= 0) return '—';
    if (rateKind === 'monthly') {
      return '₹' + r.toLocaleString('en-IN', { maximumFractionDigits: 0 }) + '/mo' + (divisor ? ' (÷' + divisor + ')' : '');
    }
    var dec = Math.abs(r - Math.round(r)) > 0.001 ? 2 : 0;
    return '₹' + r.toLocaleString('en-IN', { minimumFractionDigits: dec, maximumFractionDigits: 2 });
  }

  function normalizeEmpCode(v) {
    if (v == null) return '';
    if (typeof v === 'number' && isFinite(v)) {
      return String(Math.trunc(v));
    }
    var s = cleanText(v).replace(/\.0+$/, '');
    return s;
  }

  // ── Month Parsing & Helpers ──
  var MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  function daysInCalendarMonth(year, month1to12) {
    if (!year || !month1to12) return 30;
    return new Date(year, month1to12, 0).getDate();
  }

  function detectMonthFromFilename(fileName) {
    var fn = String(fileName || '').toLowerCase();
    var shortMap = {
      jan: 1, january: 1,
      feb: 2, february: 2,
      mar: 3, march: 3,
      apr: 4, april: 4,
      may: 5,
      jun: 6, june: 6,
      jul: 7, july: 7,
      aug: 8, august: 8,
      sep: 9, sept: 9, september: 9,
      oct: 10, october: 10,
      nov: 11, november: 11,
      dec: 12, december: 12
    };
    var foundMonth = 0;
    var keys = Object.keys(shortMap);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (new RegExp('(?:^|[^a-z])' + k + '(?:[^a-z]|$)', 'i').test(fn)) {
        foundMonth = shortMap[k];
        break;
      }
    }
    var foundYear = 0;
    var ym4 = fn.match(/(?:^|[^0-9])(20[2-3][0-9])(?:[^0-9]|$)/);
    if (ym4) {
      foundYear = parseInt(ym4[1], 10);
    } else {
      var ym2 = fn.match(/(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*[\s._-]*([2-3][0-9])(?:[^0-9]|$)/i);
      if (ym2) foundYear = 2000 + parseInt(ym2[1], 10);
    }

    var now = new Date();
    var monthNum = foundMonth || (now.getMonth() + 1);
    var yearNum = foundYear || now.getFullYear();
    var monthKey = yearNum + '-' + String(monthNum).padStart(2, '0');
    return {
      monthKey: monthKey,
      monthNum: monthNum,
      yearNum: yearNum,
      label: MONTH_NAMES[monthNum - 1] + ' ' + yearNum,
      daysInMonth: daysInCalendarMonth(yearNum, monthNum),
      detectedFromFilename: !!(foundMonth)
    };
  }

  function monthInfoFromKey(monthKey) {
    var m = String(monthKey || '').match(/^(\d{4})-(\d{2})$/);
    if (!m) return detectMonthFromFilename('');
    var y = parseInt(m[1], 10);
    var mo = parseInt(m[2], 10);
    if (mo < 1 || mo > 12) return detectMonthFromFilename('');
    return {
      monthKey: monthKey,
      monthNum: mo,
      yearNum: y,
      label: MONTH_NAMES[mo - 1] + ' ' + y,
      daysInMonth: daysInCalendarMonth(y, mo),
      detectedFromFilename: true
    };
  }

  // ── Sheet & Machine Card Mapping Rules ──
  function parseSheetCardInfo(sheetName) {
    var raw = cleanText(sheetName);
    var low = raw.toLowerCase();
    if (!raw) return null;
    // Never classify summary / aggregate / master tabs as Card sheets
    if (/\b(summary|grand\s*total|all\s*cards?|consolidated|master|salary\s*sheet|bank|advance|staff|index)\b/i.test(low)) {
      return null;
    }
    var m = raw.match(/^(?:card(?:\s*no\.?)?[\s._-]*0*(\d+)|c[\s._-]*0*(\d+))(?:\b|[\s._-]|$)/i);
    if (!m) {
      m = raw.match(/\bcard(?:\s*no\.?)?[\s._-]*0*(\d+)\b/i);
    }
    if (!m) return null;
    var n = parseInt(m[1] || m[2], 10);
    if (!isFinite(n) || n <= 0 || n > 99) return null;
    return {
      cardNum: n,
      cardKey: 'C' + n,
      cardLabel: 'Card ' + String(n).padStart(2, '0'),
      sheetName: raw
    };
  }

  function cleanRawMachine(v) {
    return String(v == null ? '' : v)
      .trim()
      .toUpperCase()
      .replace(/[\s_/]+/g, '')
      .replace(/-+/g, '');
  }

  function stripRateSuffix(rawMachine, rate) {
    var mc = cleanRawMachine(rawMachine);
    var n = Number(rate);
    if (!mc || !isFinite(n) || n <= 0 || n >= 500) return mc;
    var forms = [
      String(n),
      n.toFixed(1),
      n.toFixed(2),
      n.toFixed(3)
    ];
    var uniq = [];
    for (var i = 0; i < forms.length; i++) {
      var trimmed = forms[i].replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '');
      if (uniq.indexOf(forms[i]) < 0) uniq.push(forms[i]);
      if (uniq.indexOf(trimmed) < 0) uniq.push(trimmed);
    }
    uniq.sort(function(a, b) { return b.length - a.length; });
    for (var j = 0; j < uniq.length; j++) {
      var suf = uniq[j].toUpperCase();
      if (suf && mc.length > suf.length && mc.slice(-suf.length) === suf) {
        var base = mc.slice(0, -suf.length).replace(/[.]$/, '');
        // Only strip if the remaining prefix looks like a valid machine code ending in a letter (e.g. C7R2.60 -> C7R, C1R1.8 -> C1R)
        if (/^C\d+[A-Z]+[A-Z0-9]*$/.test(base)) {
          return base;
        }
      }
    }
    return mc;
  }

  /**
   * CRITICAL CARD MAPPING RULE:
   * Always classify production using the actual Machine/Location code, NOT the Excel sheet name!
   * Examples:
   *   C1W     -> Card 01 (C1)
   *   C1R     -> Card 01 (C1)
   *   C7R     -> Card 07 (C7) even if located in Card no-1 sheet
   *   C7R2.60 -> Card 07 (C7), canonical machine C7R
   *   C12S    -> Card 12 (C12)
   *   C1224PA -> Card 12 (C12) (2-digit prefix 12 in known card set; not Card 1224!)
   *   C1224SP -> Card 12 (C12)
   */
  function classifyMachineAndCard(rawLoc, rate, fallbackSheetCardNum) {
    var rawClean = cleanRawMachine(rawLoc);
    if (!rawClean) return null;
    if (/^(total|sub\s*total|grand\s*total|summary|ring|card\s*total|remark|remarks)$/i.test(rawClean)) {
      return null;
    }

    var machineCode = stripRateSuffix(rawClean, rate);
    var cardNum = null;

    var m = machineCode.match(/^C0*(\d+)/i);
    if (!m) {
      m = machineCode.match(/^CARD0*(\d+)/i);
    }
    if (m) {
      var digits = m[1];
      var parsed = parseInt(digits, 10);
      if (parsed >= 1 && parsed <= 30) {
        cardNum = parsed;
      } else if (digits.length >= 3) {
        // Handle concatenated numeric suffixes like C1224PA / C1224SP -> C12 + 24PA
        var two = parseInt(digits.slice(0, 2), 10);
        var one = parseInt(digits.slice(0, 1), 10);
        if (KNOWN_CARDS.indexOf(two) >= 0 && two >= 10) {
          cardNum = two;
        } else if (KNOWN_CARDS.indexOf(one) >= 0) {
          cardNum = one;
        } else if (two >= 1 && two <= 30) {
          cardNum = two;
        } else {
          cardNum = one || parsed;
        }
      } else {
        cardNum = parsed;
      }
    } else if (fallbackSheetCardNum && isFinite(fallbackSheetCardNum)) {
      cardNum = Number(fallbackSheetCardNum);
    }

    var cardKey = cardNum ? ('C' + cardNum) : 'OTHER';
    var cardLabel = cardNum ? ('Card ' + String(cardNum).padStart(2, '0')) : 'Other';
    var isCrossCard = !!(cardNum && fallbackSheetCardNum && Number(cardNum) !== Number(fallbackSheetCardNum));

    return {
      rawMachine: rawClean,
      machineCode: machineCode,
      cardNum: cardNum,
      cardKey: cardKey,
      cardLabel: cardLabel,
      isCrossCard: isCrossCard
    };
  }

  // ── Header & Row Parsing ──
  function detectHeaderRow(row) {
    if (!Array.isArray(row) || row.length < 4) return null;
    var codeCol = -1;
    var nameCol = -1;
    var locCol = -1;
    var daysCol = -1;
    var rateCol = -1;
    var totalCol = -1;
    var advCol = -1;
    var dayCols = [];
    var daySeen = {};

    for (var c = 0; c < row.length; c++) {
      var rawCell = cleanText(row[c]);
      var h = normHeader(rawCell);
      if (!h) continue;

      if (codeCol < 0 && (h === 'code' || h === 'emp code' || h === 'employee code' || h === 'staff code' || h === 'worker code' || h === 'emp id' || h === 'employee id')) {
        codeCol = c;
        continue;
      }
      if (locCol < 0 && (h === 'loctatic' || h === 'location' || h === 'loctation' || h === 'loc' || h === 'machine' || h === 'machine code' || h === 'm/c' || h.indexOf('loctat') >= 0 || h.indexOf('location') >= 0)) {
        locCol = c;
        continue;
      }
      if (nameCol < 0 && (h === 'name' || h === 'emp name' || h === 'employee name' || h === 'staff name' || h === 'worker name')) {
        nameCol = c;
        continue;
      }
      // Day columns 1..31
      if (/^0*([1-9]|[12][0-9]|3[01])$/.test(h)) {
        var dayNum = parseInt(h, 10);
        if (dayNum >= 1 && dayNum <= 31 && !daySeen[dayNum]) {
          daySeen[dayNum] = true;
          dayCols.push({ day: dayNum, col: c });
        }
        continue;
      }
      if (daysCol < 0 && (h === 'days' || h === 'day' || h === 'total days' || h === 'tot days' || h === 'qty' || h === 'total qty' || h === 'production' || h === 'total prod')) {
        daysCol = c;
        continue;
      }
      if (rateCol < 0 && (h === 'salry' || h === 'salary' || h === 'rate' || h === 'salary rate' || h === 'prod rate' || h === 'rate/kg' || h.indexOf('salry') >= 0 || h.indexOf('salary') >= 0)) {
        rateCol = c;
        continue;
      }
      if (totalCol < 0 && (h === 'total' || h === 'amount' || h === 'total amount' || h === 'total amt' || h === 'prod value')) {
        totalCol = c;
        continue;
      }
      if (advCol < 0 && (h === 'adv' || h === 'advance')) {
        advCol = c;
        continue;
      }
    }

    // Must look like an attendance/production header (either locCol + dayCols/daysCol, or codeCol + locCol)
    var looksValid = (locCol >= 0 && (dayCols.length >= 5 || daysCol >= 0 || rateCol >= 0)) ||
      (codeCol >= 0 && dayCols.length >= 10);
    if (!looksValid) return null;

    if (codeCol < 0) codeCol = 0;
    if (nameCol < 0) {
      // In Arora attendance sheets, Col B header says "Card No. 1" (between Code and Loctatic)
      if (locCol > codeCol + 1) {
        nameCol = codeCol + 1;
      } else if (codeCol + 1 < row.length && codeCol + 1 !== locCol) {
        nameCol = codeCol + 1;
      } else {
        nameCol = 1;
      }
    }
    dayCols.sort(function(a, b) { return a.day - b.day; });

    return {
      codeCol: codeCol,
      nameCol: nameCol,
      locCol: locCol,
      dayCols: dayCols,
      daysCol: daysCol,
      rateCol: rateCol,
      totalCol: totalCol,
      advCol: advCol
    };
  }

  function detectMonthlyDivisor(qty, monthlyRate, sheetTotal, defaultDaysInMonth) {
    var fallback = defaultDaysInMonth || 30;
    if (!sheetTotal || sheetTotal <= 0 || !qty || qty <= 0 || !monthlyRate || monthlyRate <= 0) {
      return fallback;
    }
    var candidates = [fallback, 30, 31, 28, 29];
    var seen = {};
    var bestDiv = fallback;
    var bestErr = Infinity;
    for (var i = 0; i < candidates.length; i++) {
      var d = candidates[i];
      if (!d || seen[d]) continue;
      seen[d] = true;
      var est = (qty * monthlyRate) / d;
      var err = Math.abs(est - sheetTotal);
      if (err < bestErr) {
        bestErr = err;
        bestDiv = d;
      }
    }
    // Accept closest divisor only if within reasonable tolerance (e.g. 5% + ₹5 rounding)
    if (bestErr <= Math.max(10, sheetTotal * 0.05)) {
      return bestDiv;
    }
    return fallback;
  }

  function parseSheetRows(sheetName, sheetRows, monthMeta) {
    var sheetCard = parseSheetCardInfo(sheetName);
    var fallbackCardNum = sheetCard ? sheetCard.cardNum : null;
    var records = [];
    var hdr = null;

    for (var r = 0; r < sheetRows.length; r++) {
      var row = sheetRows[r];
      if (!Array.isArray(row) || row.length === 0) continue;

      // Check for initial or repeated header rows (e.g. Row 1 and Row 54 in Card no-1)
      var maybeHdr = detectHeaderRow(row);
      if (maybeHdr) {
        hdr = maybeHdr;
        continue;
      }
      if (!hdr) continue;

      var rawCode = hdr.codeCol >= 0 ? row[hdr.codeCol] : '';
      var rawName = hdr.nameCol >= 0 ? row[hdr.nameCol] : '';
      var rawLoc = hdr.locCol >= 0 ? row[hdr.locCol] : '';

      var empCode = normalizeEmpCode(rawCode);
      var empName = cleanText(rawName);
      var locText = cleanText(rawLoc);

      // Skip subtotal / total / section divider rows cleanly
      var combinedLabel = (empCode + ' ' + empName + ' ' + locText).toLowerCase().trim();
      if (!locText) continue;
      if (/^(total|sub\s*total|grand\s*total|card\s*total|ring|summary)$/i.test(locText) ||
          /^(total|sub\s*total|grand\s*total|card\s*total|summary)$/i.test(empName) ||
          /^(total|sub\s*total|grand\s*total)$/i.test(empCode) ||
          !combinedLabel) {
        continue;
      }

      var rateVal = hdr.rateCol >= 0 ? num(row[hdr.rateCol]) : null;
      var rate = (rateVal != null && rateVal >= 0) ? round4(rateVal) : 0;

      var machineInfo = classifyMachineAndCard(locText, rate, fallbackCardNum);
      if (!machineInfo) continue;

      // Extract daily quantities (1..31) handling blanks & decimals cleanly
      var daily = new Array(31);
      for (var dIdx = 0; dIdx < 31; dIdx++) daily[dIdx] = 0;
      var dailySum = 0;
      var hasNumericDaily = false;
      var activeDaysCount = 0;

      for (var dc = 0; dc < hdr.dayCols.length; dc++) {
        var dayInfo = hdr.dayCols[dc];
        var val = num(row[dayInfo.col]);
        if (val != null && val > 0) {
          var qVal = round3(val);
          daily[dayInfo.day - 1] = round3(daily[dayInfo.day - 1] + qVal);
          dailySum += qVal;
          hasNumericDaily = true;
          activeDaysCount++;
        } else if (val === 0 && row[dayInfo.col] !== '' && row[dayInfo.col] != null) {
          hasNumericDaily = true;
        }
      }
      dailySum = round3(dailySum);

      var daysColVal = hdr.daysCol >= 0 ? num(row[hdr.daysCol]) : null;
      var sheetDaysQty = (daysColVal != null && daysColVal > 0) ? round3(daysColVal) : 0;
      var qty = dailySum > 0 ? dailySum : (hasNumericDaily && sheetDaysQty === 0 ? 0 : sheetDaysQty);

      if (qty <= 0) {
        // Skip zero-quantity / empty placeholder rows
        continue;
      }

      var totalColVal = hdr.totalCol >= 0 ? num(row[hdr.totalCol]) : null;
      var sheetTotal = (totalColVal != null && totalColVal >= 0) ? round2(totalColVal) : null;

      var rateKind = 'none';
      var divisor = null;
      var effectiveRate = 0;
      var value = 0;

      if (rate > 0 && rate < 500) {
        rateKind = 'piece';
        effectiveRate = rate;
        value = round2(qty * effectiveRate);
      } else if (rate >= 500) {
        rateKind = 'monthly';
        divisor = detectMonthlyDivisor(qty, rate, sheetTotal, monthMeta ? monthMeta.daysInMonth : 30);
        effectiveRate = round4(rate / divisor);
        value = round2(qty * effectiveRate);
      } else {
        rateKind = 'none';
        effectiveRate = 0;
        value = sheetTotal != null ? sheetTotal : 0;
      }

      var finalName = empName || (empCode ? ('Employee ' + empCode) : 'Unnamed Worker');
      var normCodeKey = empCode ? empCode.replace(/^0+/, '').toUpperCase() : '';
      var empKey = normCodeKey ? ('CODE::' + normCodeKey) : ('NAME::' + finalName.toLowerCase().replace(/\s+/g, ' ').trim());

      records.push({
        id: sheetName + '::r' + (row.__excelRow || (r + 1)),
        sheetName: sheetName,
        sourceCardNum: fallbackCardNum,
        sourceCardLabel: sheetCard ? sheetCard.cardLabel : sheetName,
        excelRow: row.__excelRow || (r + 1),
        empCode: empCode,
        empName: finalName,
        empKey: empKey,
        rawMachine: machineInfo.rawMachine,
        machineCode: machineInfo.machineCode,
        cardNum: machineInfo.cardNum,
        cardKey: machineInfo.cardKey,
        cardLabel: machineInfo.cardLabel,
        isCrossCard: machineInfo.isCrossCard,
        daily: daily,
        activeDaysCount: activeDaysCount,
        qty: qty,
        rate: rate,
        rateKind: rateKind,
        divisor: divisor,
        effectiveRate: effectiveRate,
        value: value,
        sheetTotal: sheetTotal
      });
    }

    return {
      sheetName: sheetName,
      cardInfo: sheetCard,
      hasHeader: !!hdr,
      records: records
    };
  }

  /**
   * Parse an entire workbook (either SheetJS workbook `wb` OR plain map `{ sheetName: 2DArray }`).
   */
  function sheetToCompactAoa(ws, xlsxLib) {
    if (!ws) return [];
    var keys = Object.keys(ws);
    var rowBuckets = {};
    var maxRow = -1;
    for (var i = 0; i < keys.length; i++) {
      var addr = keys[i];
      if (!addr || addr.charCodeAt(0) === 33) continue;
      var cell = ws[addr];
      if (!cell || cell.v === undefined || cell.v === null || cell.v === '') continue;
      var pos;
      try { pos = xlsxLib.utils.decode_cell(addr); } catch (_) { continue; }
      if (!pos || pos.c > 80) continue;
      if (pos.r > maxRow) maxRow = pos.r;
      if (!rowBuckets[pos.r]) rowBuckets[pos.r] = [];
      rowBuckets[pos.r][pos.c] = cell.v;
    }
    var out = [];
    var rIndices = Object.keys(rowBuckets).map(Number).sort(function(a, b) { return a - b; });
    for (var j = 0; j < rIndices.length; j++) {
      var rowArr = rowBuckets[rIndices[j]];
      rowArr.__excelRow = rIndices[j] + 1;
      out.push(rowArr);
    }
    return out;
  }

  function parseWorkbookData(input, options) {
    options = options || {};
    var fileName = options.fileName || 'Attendance_Sheet.xlsx';
    var baseMeta = options.monthKey ? monthInfoFromKey(options.monthKey) : detectMonthFromFilename(fileName);
    var sheetNames = [];
    var sheetsMap = {};

    if (input && Array.isArray(input.SheetNames) && input.Sheets) {
      var xlsxLib = options.XLSX || (typeof window !== 'undefined' ? window.XLSX : null);
      if (!xlsxLib || !xlsxLib.utils || typeof xlsxLib.utils.sheet_to_json !== 'function') {
        throw new Error('SheetJS (XLSX) library is unavailable.');
      }
      sheetNames = input.SheetNames.slice();
      // Identify Card sheets up front so we don't even convert non-Card tabs when Card sheets exist
      var preCardSheets = sheetNames.filter(function(sn) { return !!parseSheetCardInfo(sn); });
      var extractList = preCardSheets.length > 0 ? preCardSheets : sheetNames;
      extractList.forEach(function(sn) {
        try {
          var ws = input.Sheets[sn];
          if (ws) {
            sheetsMap[sn] = sheetToCompactAoa(ws, xlsxLib);
          }
        } catch (_) {}
      });
    } else if (input && typeof input === 'object') {
      var mapSrc = input.sheets && typeof input.sheets === 'object' ? input.sheets : input;
      sheetNames = Object.keys(mapSrc);
      sheetNames.forEach(function(sn) {
        if (Array.isArray(mapSrc[sn])) {
          sheetsMap[sn] = mapSrc[sn];
        }
      });
    }

    // Identify Card sheets first (C1, C3, C5..C13, Card no-1..Card no.-13)
    var cardSheetNames = sheetNames.filter(function(sn) {
      return !!parseSheetCardInfo(sn);
    });
    // Sort card sheets naturally by card number
    cardSheetNames.sort(function(a, b) {
      var ca = parseSheetCardInfo(a);
      var cb = parseSheetCardInfo(b);
      return (ca ? ca.cardNum : 999) - (cb ? cb.cardNum : 999);
    });

    // If Card sheets exist, ONLY scan Card sheets so Summary/Consolidated tabs never double-count.
    // Fallback to all sheets only when no Card-named sheet is present.
    var targetSheets = cardSheetNames.length > 0 ? cardSheetNames : sheetNames;

    var allRecords = [];
    var detectedSheets = [];
    var skippedSheets = [];

    targetSheets.forEach(function(sn) {
      var rows = sheetsMap[sn];
      if (!Array.isArray(rows) || rows.length < 2) {
        skippedSheets.push(sn);
        return;
      }
      var res = parseSheetRows(sn, rows, baseMeta);
      if (res.records.length > 0) {
        detectedSheets.push({
          sheetName: sn,
          cardLabel: res.cardInfo ? res.cardInfo.cardLabel : sn,
          cardNum: res.cardInfo ? res.cardInfo.cardNum : null,
          rowCount: res.records.length
        });
        for (var i = 0; i < res.records.length; i++) {
          allRecords.push(res.records[i]);
        }
      } else {
        skippedSheets.push(sn);
      }
    });

    if (allRecords.length === 0) {
      throw new Error('No valid attendance/production rows found. Ensure sheets contain Code, Name, Location (e.g. C1R, C1W), Day columns (1-31) and Salry/Rate.');
    }

    // Reconcile employee name if one row lacked name or standardize best display name per empKey
    var bestNameByKey = {};
    var bestCodeByKey = {};
    allRecords.forEach(function(rec) {
      if (rec.empCode && !bestCodeByKey[rec.empKey]) bestCodeByKey[rec.empKey] = rec.empCode;
      if (rec.empName && rec.empName !== ('Employee ' + rec.empCode)) {
        if (!bestNameByKey[rec.empKey] || rec.empName.length > bestNameByKey[rec.empKey].length) {
          bestNameByKey[rec.empKey] = rec.empName;
        }
      }
    });
    allRecords.forEach(function(rec) {
      if (bestNameByKey[rec.empKey]) rec.empName = bestNameByKey[rec.empKey];
      if (bestCodeByKey[rec.empKey] && !rec.empCode) rec.empCode = bestCodeByKey[rec.empKey];
    });

    return {
      monthKey: baseMeta.monthKey,
      monthLabel: baseMeta.label,
      monthNum: baseMeta.monthNum,
      yearNum: baseMeta.yearNum,
      daysInMonth: baseMeta.daysInMonth,
      fileName: fileName,
      uploadedAt: new Date().toISOString(),
      detectedSheets: detectedSheets,
      skippedSheets: skippedSheets,
      records: allRecords
    };
  }

  // ── Filter & Aggregation Engine ──
  function filterRecords(records, filters) {
    filters = filters || {};
    var cardFilter = filters.cardFilter || 'ALL';
    var machineFilter = filters.machineFilter || 'ALL';
    var rateModeFilter = filters.rateModeFilter || 'ALL';
    var q = cleanText(filters.searchQuery).toLowerCase();

    return (records || []).filter(function(rec) {
      if (cardFilter !== 'ALL' && rec.cardKey !== cardFilter) return false;
      if (machineFilter !== 'ALL' && rec.machineCode !== machineFilter) return false;
      if (rateModeFilter !== 'ALL' && rec.rateKind !== rateModeFilter) return false;
      if (q) {
        var hay = (rec.empCode + ' ' + rec.empName + ' ' + rec.machineCode + ' ' + rec.rawMachine + ' ' + rec.cardLabel).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
  }

  function computeAnalytics(records) {
    var totalQty = 0;
    var totalValue = 0;
    var pieceQty = 0;
    var pieceValue = 0;
    var monthlyQty = 0;
    var monthlyValue = 0;
    var crossCardCount = 0;

    var cardMap = {};
    var machineMap = {};
    var empMap = {};
    var rateMap = {};

    (records || []).forEach(function(rec) {
      totalQty += rec.qty;
      totalValue += rec.value;
      if (rec.rateKind === 'piece') {
        pieceQty += rec.qty;
        pieceValue += rec.value;
      } else if (rec.rateKind === 'monthly') {
        monthlyQty += rec.qty;
        monthlyValue += rec.value;
      }
      if (rec.isCrossCard) crossCardCount++;

      // 1. Card-wise aggregation (ALWAYS credited to rec.cardKey from Machine/Location code!)
      if (!cardMap[rec.cardKey]) {
        cardMap[rec.cardKey] = {
          cardKey: rec.cardKey,
          cardNum: rec.cardNum != null ? rec.cardNum : 999,
          cardLabel: rec.cardLabel,
          totalQty: 0,
          totalValue: 0,
          pieceQty: 0,
          pieceValue: 0,
          monthlyQty: 0,
          monthlyValue: 0,
          rowCount: 0,
          crossCardIncomingCount: 0,
          crossCardIncomingQty: 0,
          crossCardIncomingValue: 0,
          incomingSheets: {},
          machinesSet: {},
          employeesSet: {},
          machinesMap: {}
        };
      }
      var cd = cardMap[rec.cardKey];
      cd.totalQty += rec.qty;
      cd.totalValue += rec.value;
      if (rec.rateKind === 'piece') {
        cd.pieceQty += rec.qty;
        cd.pieceValue += rec.value;
      } else if (rec.rateKind === 'monthly') {
        cd.monthlyQty += rec.qty;
        cd.monthlyValue += rec.value;
      }
      cd.rowCount++;
      cd.machinesSet[rec.machineCode] = true;
      cd.employeesSet[rec.empKey] = true;
      if (rec.isCrossCard) {
        cd.crossCardIncomingCount++;
        cd.crossCardIncomingQty += rec.qty;
        cd.crossCardIncomingValue += rec.value;
        cd.incomingSheets[rec.sheetName] = (cd.incomingSheets[rec.sheetName] || 0) + 1;
      }
      if (!cd.machinesMap[rec.machineCode]) {
        cd.machinesMap[rec.machineCode] = {
          machineCode: rec.machineCode,
          totalQty: 0,
          totalValue: 0,
          employeesSet: {},
          rowCount: 0
        };
      }
      cd.machinesMap[rec.machineCode].totalQty += rec.qty;
      cd.machinesMap[rec.machineCode].totalValue += rec.value;
      cd.machinesMap[rec.machineCode].employeesSet[rec.empKey] = true;
      cd.machinesMap[rec.machineCode].rowCount++;

      // 2. Machine-wise aggregation
      if (!machineMap[rec.machineCode]) {
        machineMap[rec.machineCode] = {
          machineCode: rec.machineCode,
          cardKey: rec.cardKey,
          cardNum: rec.cardNum != null ? rec.cardNum : 999,
          cardLabel: rec.cardLabel,
          totalQty: 0,
          totalValue: 0,
          rowCount: 0,
          crossCardCount: 0,
          employeesSet: {},
          ratesSet: {},
          rateKind: rec.rateKind
        };
      }
      var mc = machineMap[rec.machineCode];
      mc.totalQty += rec.qty;
      mc.totalValue += rec.value;
      mc.rowCount++;
      if (rec.isCrossCard) mc.crossCardCount++;
      mc.employeesSet[rec.empKey] = true;
      mc.ratesSet[rec.rateKind + ':' + rec.rate] = { rate: rec.rate, rateKind: rec.rateKind, divisor: rec.divisor };

      // 3. Employee-wise aggregation (consolidated per empKey, preserving separate machine-wise records)
      if (!empMap[rec.empKey]) {
        empMap[rec.empKey] = {
          empKey: rec.empKey,
          empCode: rec.empCode,
          empName: rec.empName,
          cardsSet: {},
          machinesSet: {},
          machineRecordsMap: {}, // separate per machine + rate + credited card
          rawRows: [],
          dailyTotals: new Array(31).fill(0),
          totalQty: 0,
          totalValue: 0,
          pieceQty: 0,
          pieceValue: 0,
          monthlyQty: 0,
          monthlyValue: 0,
          crossCardCount: 0
        };
      }
      var emp = empMap[rec.empKey];
      emp.cardsSet[rec.cardLabel] = rec.cardNum != null ? rec.cardNum : 999;
      emp.machinesSet[rec.machineCode] = true;
      emp.rawRows.push(rec);
      emp.totalQty += rec.qty;
      emp.totalValue += rec.value;
      if (rec.rateKind === 'piece') {
        emp.pieceQty += rec.qty;
        emp.pieceValue += rec.value;
      } else if (rec.rateKind === 'monthly') {
        emp.monthlyQty += rec.qty;
        emp.monthlyValue += rec.value;
      }
      if (rec.isCrossCard) emp.crossCardCount++;

      for (var d = 0; d < 31; d++) {
        if (rec.daily && rec.daily[d]) {
          emp.dailyTotals[d] = round3(emp.dailyTotals[d] + rec.daily[d]);
        }
      }

      var mrKey = rec.machineCode + '||' + rec.cardKey + '||' + rec.rateKind + '||' + rec.rate;
      if (!emp.machineRecordsMap[mrKey]) {
        emp.machineRecordsMap[mrKey] = {
          machineCode: rec.machineCode,
          rawMachines: {},
          cardKey: rec.cardKey,
          cardNum: rec.cardNum != null ? rec.cardNum : 999,
          cardLabel: rec.cardLabel,
          sourceSheets: {},
          isCrossCard: false,
          rate: rec.rate,
          rateKind: rec.rateKind,
          divisor: rec.divisor,
          effectiveRate: rec.effectiveRate,
          daily: new Array(31).fill(0),
          qty: 0,
          value: 0,
          entryCount: 0
        };
      }
      var mr = emp.machineRecordsMap[mrKey];
      mr.rawMachines[rec.rawMachine] = true;
      mr.sourceSheets[rec.sheetName] = true;
      if (rec.isCrossCard) mr.isCrossCard = true;
      mr.qty += rec.qty;
      mr.value += rec.value;
      mr.entryCount++;
      for (var md = 0; md < 31; md++) {
        if (rec.daily && rec.daily[md]) {
          mr.daily[md] = round3(mr.daily[md] + rec.daily[md]);
        }
      }

      // 4. Rate-wise breakdown
      var rKey = rec.rateKind + '::' + rec.rate;
      if (!rateMap[rKey]) {
        rateMap[rKey] = {
          rateKey: rKey,
          rate: rec.rate,
          rateKind: rec.rateKind,
          divisor: rec.divisor,
          effectiveRate: rec.effectiveRate,
          rowCount: 0,
          totalQty: 0,
          totalValue: 0,
          employeesSet: {},
          machinesSet: {},
          cardsSet: {}
        };
      }
      var rt = rateMap[rKey];
      rt.rowCount++;
      rt.totalQty += rec.qty;
      rt.totalValue += rec.value;
      rt.employeesSet[rec.empKey] = true;
      rt.machinesSet[rec.machineCode] = true;
      rt.cardsSet[rec.cardLabel] = true;
    });

    totalQty = round3(totalQty);
    totalValue = round2(totalValue);
    pieceQty = round3(pieceQty);
    pieceValue = round2(pieceValue);
    monthlyQty = round3(monthlyQty);
    monthlyValue = round2(monthlyValue);

    var cards = Object.keys(cardMap).map(function(k) {
      var c = cardMap[k];
      c.totalQty = round3(c.totalQty);
      c.totalValue = round2(c.totalValue);
      c.pieceQty = round3(c.pieceQty);
      c.pieceValue = round2(c.pieceValue);
      c.monthlyQty = round3(c.monthlyQty);
      c.monthlyValue = round2(c.monthlyValue);
      c.crossCardIncomingQty = round3(c.crossCardIncomingQty);
      c.crossCardIncomingValue = round2(c.crossCardIncomingValue);
      c.machineCount = Object.keys(c.machinesSet).length;
      c.employeeCount = Object.keys(c.employeesSet).length;
      c.valueSharePct = totalValue > 0 ? round2((c.totalValue / totalValue) * 100) : 0;
      c.qtySharePct = totalQty > 0 ? round2((c.totalQty / totalQty) * 100) : 0;
      c.machinesList = Object.keys(c.machinesMap).map(function(mk) {
        var mm = c.machinesMap[mk];
        return {
          machineCode: mm.machineCode,
          totalQty: round3(mm.totalQty),
          totalValue: round2(mm.totalValue),
          employeeCount: Object.keys(mm.employeesSet).length,
          rowCount: mm.rowCount
        };
      }).sort(function(a, b) { return b.totalValue - a.totalValue; });
      return c;
    }).sort(function(a, b) { return a.cardNum - b.cardNum; });

    var machines = Object.keys(machineMap).map(function(k) {
      var m = machineMap[k];
      m.totalQty = round3(m.totalQty);
      m.totalValue = round2(m.totalValue);
      m.employeeCount = Object.keys(m.employeesSet).length;
      m.rates = Object.keys(m.ratesSet).map(function(rk) { return m.ratesSet[rk]; })
        .sort(function(a, b) { return a.rate - b.rate; });
      m.valueSharePct = totalValue > 0 ? round2((m.totalValue / totalValue) * 100) : 0;
      return m;
    }).sort(function(a, b) {
      if (a.cardNum !== b.cardNum) return a.cardNum - b.cardNum;
      return a.machineCode.localeCompare(b.machineCode);
    });

    var employees = Object.keys(empMap).map(function(k) {
      var e = empMap[k];
      e.totalQty = round3(e.totalQty);
      e.totalValue = round2(e.totalValue);
      e.pieceQty = round3(e.pieceQty);
      e.pieceValue = round2(e.pieceValue);
      e.monthlyQty = round3(e.monthlyQty);
      e.monthlyValue = round2(e.monthlyValue);
      e.cardsWorked = Object.keys(e.cardsSet).sort(function(a, b) {
        return (e.cardsSet[a] || 999) - (e.cardsSet[b] || 999);
      });
      e.machinesWorked = Object.keys(e.machinesSet).sort();
      e.machineRecords = Object.keys(e.machineRecordsMap).map(function(mrk) {
        var mrec = e.machineRecordsMap[mrk];
        mrec.qty = round3(mrec.qty);
        mrec.value = round2(mrec.value);
        mrec.rawMachinesList = Object.keys(mrec.rawMachines);
        mrec.sourceSheetsList = Object.keys(mrec.sourceSheets);
        return mrec;
      }).sort(function(a, b) {
        if (a.cardNum !== b.cardNum) return a.cardNum - b.cardNum;
        if (a.machineCode !== b.machineCode) return a.machineCode.localeCompare(b.machineCode);
        return a.rate - b.rate;
      });
      return e;
    });

    var rates = Object.keys(rateMap).map(function(k) {
      var rt = rateMap[k];
      rt.totalQty = round3(rt.totalQty);
      rt.totalValue = round2(rt.totalValue);
      rt.employeeCount = Object.keys(rt.employeesSet).length;
      rt.machineCount = Object.keys(rt.machinesSet).length;
      rt.cardCount = Object.keys(rt.cardsSet).length;
      rt.machinesList = Object.keys(rt.machinesSet).sort();
      rt.valueSharePct = totalValue > 0 ? round2((rt.totalValue / totalValue) * 100) : 0;
      rt.qtySharePct = totalQty > 0 ? round2((rt.totalQty / totalQty) * 100) : 0;
      return rt;
    }).sort(function(a, b) {
      if (a.rateKind !== b.rateKind) return a.rateKind === 'piece' ? -1 : 1;
      return a.rate - b.rate;
    });

    var topByQty = employees.slice().sort(function(a, b) { return b.totalQty - a.totalQty; }).slice(0, 10);
    var topByValue = employees.slice().sort(function(a, b) { return b.totalValue - a.totalValue; }).slice(0, 10);

    return {
      totalQty: totalQty,
      totalValue: totalValue,
      pieceQty: pieceQty,
      pieceValue: pieceValue,
      monthlyQty: monthlyQty,
      monthlyValue: monthlyValue,
      rowCount: (records || []).length,
      crossCardCount: crossCardCount,
      cardCount: cards.length,
      machineCount: machines.length,
      employeeCount: employees.length,
      cards: cards,
      machines: machines,
      employees: employees,
      rates: rates,
      topByQty: topByQty,
      topByValue: topByValue
    };
  }

  // ── IndexedDB + localStorage Persistence ──
  function openDB() {
    return new Promise(function(resolve, reject) {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('IndexedDB unavailable'));
        return;
      }
      try {
        var req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = function(e) {
          var db = e.target.result;
          if (!db.objectStoreNames.contains(DB_STORE)) {
            db.createObjectStore(DB_STORE, { keyPath: 'monthKey' });
          }
        };
        req.onsuccess = function(e) { resolve(e.target.result); };
        req.onerror = function(e) { reject(e.target.error || new Error('DB open error')); };
      } catch (err) {
        reject(err);
      }
    });
  }

  function saveMonthToStorage(dataset) {
    if (!dataset || !dataset.monthKey) return Promise.resolve(false);
    try {
      var metas = {};
      Object.keys(state.months).forEach(function(k) {
        var m = state.months[k];
        if (m) {
          metas[k] = {
            monthKey: m.monthKey,
            monthLabel: m.monthLabel,
            fileName: m.fileName,
            uploadedAt: m.uploadedAt,
            recordCount: (m.records || []).length
          };
        }
      });
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(META_STORAGE_KEY, JSON.stringify({
          activeMonthKey: state.activeMonthKey,
          months: metas
        }));
      }
    } catch (_) {}

    return openDB().then(function(db) {
      return new Promise(function(resolve) {
        try {
          var tx = db.transaction([DB_STORE], 'readwrite');
          var store = tx.objectStore(DB_STORE);
          store.put(dataset);
          tx.oncomplete = function() { resolve(true); };
          tx.onerror = function() { resolve(false); };
        } catch (_) {
          resolve(false);
        }
      });
    }).catch(function() {
      try {
        if (typeof localStorage !== 'undefined' && dataset.records && dataset.records.length <= 2500) {
          var payload = JSON.stringify(dataset);
          if (payload.length < 1500000) localStorage.setItem(LOCAL_FALLBACK_KEY + '_' + dataset.monthKey, payload);
          return true;
        }
      } catch (_) {}
      return false;
    });
  }

  function deleteMonthFromStorage(monthKey) {
    if (!monthKey) return Promise.resolve(false);
    delete state.months[monthKey];
    var remaining = Object.keys(state.months).sort().reverse();
    if (state.activeMonthKey === monthKey) {
      state.activeMonthKey = remaining[0] || '';
    }
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(LOCAL_FALLBACK_KEY + '_' + monthKey);
        var metas = {};
        remaining.forEach(function(k) {
          var m = state.months[k];
          metas[k] = { monthKey: m.monthKey, monthLabel: m.monthLabel, fileName: m.fileName, uploadedAt: m.uploadedAt, recordCount: (m.records || []).length };
        });
        localStorage.setItem(META_STORAGE_KEY, JSON.stringify({ activeMonthKey: state.activeMonthKey, months: metas }));
      }
    } catch (_) {}

    return openDB().then(function(db) {
      return new Promise(function(resolve) {
        try {
          var tx = db.transaction([DB_STORE], 'readwrite');
          tx.objectStore(DB_STORE).delete(monthKey);
          tx.oncomplete = function() { resolve(true); };
          tx.onerror = function() { resolve(false); };
        } catch (_) { resolve(false); }
      });
    }).catch(function() { return false; });
  }

  function loadAllMonthsFromStorage() {
    return openDB().then(function(db) {
      return new Promise(function(resolve) {
        try {
          var tx = db.transaction([DB_STORE], 'readonly');
          var req = tx.objectStore(DB_STORE).getAll();
          req.onsuccess = function() {
            var arr = Array.isArray(req.result) ? req.result : [];
            arr.forEach(function(ds) {
              if (ds && ds.monthKey && Array.isArray(ds.records)) {
                state.months[ds.monthKey] = ds;
              }
            });
            resolve(arr.length);
          };
          req.onerror = function() { resolve(0); };
        } catch (_) { resolve(0); }
      });
    }).catch(function() {
      var loaded = 0;
      try {
        if (typeof localStorage !== 'undefined') {
          var rawMeta = JSON.parse(localStorage.getItem(META_STORAGE_KEY) || '{}');
          var mKeys = rawMeta && rawMeta.months ? Object.keys(rawMeta.months) : [];
          mKeys.forEach(function(k) {
            var raw = localStorage.getItem(LOCAL_FALLBACK_KEY + '_' + k);
            if (raw) {
              var ds = JSON.parse(raw);
              if (ds && ds.monthKey) {
                state.months[ds.monthKey] = ds;
                loaded++;
              }
            }
          });
        }
      } catch (_) {}
      return loaded;
    }).then(function(count) {
      try {
        if (typeof localStorage !== 'undefined') {
          var rawMeta = JSON.parse(localStorage.getItem(META_STORAGE_KEY) || '{}');
          if (rawMeta && rawMeta.activeMonthKey && state.months[rawMeta.activeMonthKey]) {
            state.activeMonthKey = rawMeta.activeMonthKey;
          }
        }
      } catch (_) {}
      if (!state.activeMonthKey || !state.months[state.activeMonthKey]) {
        var keys = Object.keys(state.months).sort().reverse();
        state.activeMonthKey = keys[0] || '';
      }
      updateSidebarBadge();
      renderUI();
      return count;
    });
  }

  // ── Upload & File Processing (Off-Main-Thread Web Worker) ──
  var activeWorker = null;
  var activeJobId = 0;
  var searchDebounceTimer = null;
  var analyticsMemo = { key: '', res: null };

  function invalidateAnalyticsCache() {
    analyticsMemo.key = '';
    analyticsMemo.res = null;
  }

  function stopActiveWorker() {
    try {
      if (activeWorker) {
        activeWorker.terminate();
        activeWorker = null;
      }
    } catch (_) {}
  }

  function updateProgressDom(text, pct) {
    state.parseProgressText = text || 'Processing…';
    state.parsePercent = Math.max(0, Math.min(100, Number(pct) || 0));
    if (typeof document === 'undefined') return;
    var wrap = document.getElementById('cpProgressWrap');
    var lbl = document.getElementById('cpProgressText');
    var bar = document.getElementById('cpProgressFill');
    if (wrap) wrap.style.display = state.isParsing ? 'block' : 'none';
    if (lbl) lbl.textContent = state.parseProgressText + ' (' + state.parsePercent + '%)';
    if (bar) bar.style.width = state.parsePercent + '%';
  }

  function finishDatasetLoad(ds) {
    state.months[ds.monthKey] = ds;
    state.activeMonthKey = ds.monthKey;
    state.cardFilter = 'ALL';
    state.machineFilter = 'ALL';
    state.searchQuery = '';
    state.empViewLimit = 120;
    state.machineViewLimit = 120;
    state.viewMoreEmpKey = null;
    state.isParsing = false;
    state.parseProgressText = '';
    state.parsePercent = 100;
    state.lastError = '';
    invalidateAnalyticsCache();
    updateSidebarBadge();
    renderUI();
    // Persist asynchronously after UI paints so dashboard appears in <16ms
    setTimeout(function() {
      saveMonthToStorage(ds);
    }, 50);
    if (typeof window !== 'undefined' && window.showToast) {
      window.showToast('✅ Loaded <strong>' + esc(ds.monthLabel) + '</strong>: ' + ds.detectedSheets.length + ' card sheet(s), ' + ds.records.length + ' production entries.');
    }
  }

  function cancelUpload() {
    activeJobId++;
    stopActiveWorker();
    state.isParsing = false;
    state.parseProgressText = '';
    state.parsePercent = 0;
    renderUI();
  }

  function fallbackMainThreadParse(file, jobId) {
    if (!window.XLSX || typeof window.XLSX.read !== 'function') {
      state.isParsing = false;
      state.lastError = 'Excel parser (XLSX) is still loading. Please try again in a second.';
      renderUI();
      return Promise.resolve(null);
    }
    updateProgressDom('Reading ' + file.name + '…', 15);
    return new Promise(function(resolve) {
      var reader = new FileReader();
      reader.onload = function(ev) {
        if (jobId !== activeJobId) { resolve(null); return; }
        setTimeout(function() {
          try {
            var data = new Uint8Array(ev.target.result);
            var wb = window.XLSX.read(data, { type: 'array', cellDates: false, cellFormula: false, cellStyles: false, cellNF: false, cellHTML: false, sheetStubs: false });
            var ds = parseWorkbookData(wb, {
              fileName: file.name,
              monthKey: state.pendingMonthKey || ''
            });
            wb = null;
            if (jobId !== activeJobId) { resolve(null); return; }
            finishDatasetLoad(ds);
            resolve(ds);
          } catch (err) {
            state.isParsing = false;
            state.parseProgressText = '';
            state.lastError = err && err.message ? err.message : 'Unable to parse Excel file.';
            renderUI();
            if (window.showToast) window.showToast('⚠️ ' + esc(state.lastError));
            resolve(null);
          }
        }, 30);
      };
      reader.onerror = function() {
        state.isParsing = false;
        state.parseProgressText = '';
        state.lastError = 'Failed to read selected file.';
        renderUI();
        resolve(null);
      };
      reader.readAsArrayBuffer(file);
    });
  }

  function handleFileUpload(file) {
    if (!file) return Promise.resolve(null);
    stopActiveWorker();
    var jobId = ++activeJobId;
    state.isParsing = true;
    state.lastError = '';
    state.parseProgressText = 'Starting background scan for ' + file.name + '…';
    state.parsePercent = 5;
    renderUI();

    if (typeof Worker !== 'function') {
      return fallbackMainThreadParse(file, jobId);
    }

    return new Promise(function(resolve) {
      try {
        activeWorker = new Worker('check-production-worker-v1.js?v=20261113-v2');
      } catch (_) {
        activeWorker = null;
        fallbackMainThreadParse(file, jobId).then(resolve);
        return;
      }

      var settled = false;
      activeWorker.onmessage = function(ev) {
        var d = ev.data || {};
        if (d.jobId !== jobId || jobId !== activeJobId) return;
        if (d.type === 'progress') {
          updateProgressDom(d.stage || 'Scanning workbook…', d.percent || 20);
          return;
        }
        if (d.type === 'done' && d.dataset) {
          settled = true;
          stopActiveWorker();
          finishDatasetLoad(d.dataset);
          resolve(d.dataset);
          return;
        }
        if (d.type === 'error') {
          settled = true;
          stopActiveWorker();
          state.isParsing = false;
          state.parseProgressText = '';
          state.lastError = d.message || 'Unable to parse Excel file.';
          renderUI();
          if (window.showToast) window.showToast('⚠️ ' + esc(state.lastError));
          resolve(null);
        }
      };

      activeWorker.onerror = function() {
        if (settled || jobId !== activeJobId) return;
        stopActiveWorker();
        // Transparent fallback to sparse main-thread parse if worker fails to load
        fallbackMainThreadParse(file, jobId).then(resolve);
      };

      try {
        activeWorker.postMessage({
          type: 'parse',
          jobId: jobId,
          file: file,
          fileName: file.name,
          monthKey: state.pendingMonthKey || ''
        });
      } catch (_) {
        stopActiveWorker();
        fallbackMainThreadParse(file, jobId).then(resolve);
      }
    });
  }

  function loadFromErpSavedFile(fileIndex) {
    try {
      var list = (typeof window.files !== 'undefined' && Array.isArray(window.files)) ? window.files : [];
      var fileObj = list[fileIndex];
      if (!fileObj) return;
      var jobId = ++activeJobId;
      state.isParsing = true;
      state.lastError = '';
      state.parseProgressText = 'Scanning ERP file: ' + (fileObj.name || 'Workbook') + '…';
      state.parsePercent = 25;
      renderUI();

      setTimeout(function() {
        if (jobId !== activeJobId) return;
        try {
          var ds = parseWorkbookData(fileObj.wb ? fileObj.wb : { sheets: fileObj.sheets || {} }, {
            fileName: fileObj.name || 'ERP_Attendance_Sheet.xlsx',
            monthKey: state.pendingMonthKey || ''
          });
          finishDatasetLoad(ds);
        } catch (err) {
          state.isParsing = false;
          state.parseProgressText = '';
          state.lastError = err && err.message ? err.message : 'Selected ERP file does not match attendance card structure.';
          renderUI();
        }
      }, 30);
    } catch (e) {
      state.isParsing = false;
      state.lastError = e.message || 'Failed to read ERP file.';
      renderUI();
    }
  }

  // ── Excel Reports Export ──
  function getActiveDataset() {
    if (!state.activeMonthKey || !state.months[state.activeMonthKey]) return null;
    return state.months[state.activeMonthKey];
  }

  function getFilteredAnalytics() {
    var ds = getActiveDataset();
    if (!ds) return { dataset: null, filteredRecords: [], analytics: computeAnalytics([]), allAnalytics: computeAnalytics([]) };
    var cacheKey = [ds.monthKey, ds.uploadedAt || '', state.cardFilter, state.machineFilter, state.rateModeFilter, state.searchQuery].join('||');
    if (analyticsMemo.key === cacheKey && analyticsMemo.res) {
      return analyticsMemo.res;
    }
    var allKey = ds.monthKey + '||' + (ds.uploadedAt || '') + '||ALL';
    var allAnalytics = (analyticsMemo.allKey === allKey && analyticsMemo.allRes)
      ? analyticsMemo.allRes
      : computeAnalytics(ds.records);
    analyticsMemo.allKey = allKey;
    analyticsMemo.allRes = allAnalytics;

    var isUnfiltered = (state.cardFilter === 'ALL' && state.machineFilter === 'ALL' && state.rateModeFilter === 'ALL' && !cleanText(state.searchQuery));
    var filtered = isUnfiltered ? ds.records : filterRecords(ds.records, {
      cardFilter: state.cardFilter,
      machineFilter: state.machineFilter,
      rateModeFilter: state.rateModeFilter,
      searchQuery: state.searchQuery
    });
    var analytics = isUnfiltered ? allAnalytics : computeAnalytics(filtered);
    var result = { dataset: ds, filteredRecords: filtered, analytics: analytics, allAnalytics: allAnalytics };
    analyticsMemo.key = cacheKey;
    analyticsMemo.res = result;
    return result;
  }

  function buildCardExportRows(ds, analytics) {
    var rows = [
      ['ATPL CHECK PRODUCTION — CARD-WISE PRODUCTION REPORT'],
      ['Month', ds.monthLabel, 'Source File', ds.fileName, 'Generated', new Date().toLocaleString()],
      ['Rule', 'Production is strictly credited to the Card derived from Machine/Location code (e.g. C7R -> Card 07), never double-counted.'],
      [],
      ['Card', 'Machines Count', 'Employees Count', 'Entries', 'Cross-Sheet Reassigned', 'Piece-Rate Qty', 'Piece-Rate Value (₹)', 'Shift/Monthly Qty', 'Shift/Monthly Value (₹)', 'Total Production Qty', 'Total Production Value (₹)', 'Value Share (%)']
    ];
    analytics.cards.forEach(function(c) {
      rows.push([
        c.cardLabel,
        c.machineCount,
        c.employeeCount,
        c.rowCount,
        c.crossCardIncomingCount,
        c.pieceQty,
        c.pieceValue,
        c.monthlyQty,
        c.monthlyValue,
        c.totalQty,
        c.totalValue,
        c.valueSharePct
      ]);
    });
    rows.push([]);
    rows.push(['GRAND TOTAL', analytics.machineCount, analytics.employeeCount, analytics.rowCount, analytics.crossCardCount, analytics.pieceQty, analytics.pieceValue, analytics.monthlyQty, analytics.monthlyValue, analytics.totalQty, analytics.totalValue, 100]);
    return rows;
  }

  function buildMachineExportRows(ds, analytics) {
    var rows = [
      ['ATPL CHECK PRODUCTION — MACHINE-WISE PRODUCTION REPORT'],
      ['Month', ds.monthLabel, 'Source File', ds.fileName],
      [],
      ['Machine Code', 'Credited Card', 'Employees Count', 'Entries', 'Rates Found', 'Total Production Qty', 'Total Production Value (₹)', 'Share (%)', 'Cross-Sheet Entries']
    ];
    analytics.machines.forEach(function(m) {
      var rateStr = m.rates.map(function(rt) { return formatRate(rt.rate, rt.rateKind, rt.divisor); }).join(' | ');
      rows.push([
        m.machineCode,
        m.cardLabel,
        m.employeeCount,
        m.rowCount,
        rateStr,
        m.totalQty,
        m.totalValue,
        m.valueSharePct,
        m.crossCardCount
      ]);
    });
    rows.push([]);
    rows.push(['GRAND TOTAL', analytics.cardCount + ' Cards', analytics.employeeCount, analytics.rowCount, '', analytics.totalQty, analytics.totalValue, 100, analytics.crossCardCount]);
    return rows;
  }

  function buildEmployeeExportSheets(ds, analytics) {
    var summaryRows = [
      ['ATPL CHECK PRODUCTION — EMPLOYEE-WISE CONSOLIDATED REPORT'],
      ['Month', ds.monthLabel, 'Source File', ds.fileName],
      [],
      ['Emp Code', 'Employee Name', 'Cards Credited', 'Machines Worked', 'Machine Records', 'Total Production Qty', 'Total Production Value (₹)']
    ];
    var sortedEmps = getSortedEmployees(analytics.employees);
    sortedEmps.forEach(function(e) {
      summaryRows.push([
        e.empCode || '—',
        e.empName,
        e.cardsWorked.join(', '),
        e.machinesWorked.join(', '),
        e.machineRecords.length,
        e.totalQty,
        e.totalValue
      ]);
    });
    summaryRows.push([]);
    summaryRows.push(['TOTAL', sortedEmps.length + ' Employees', '', '', analytics.rowCount, analytics.totalQty, analytics.totalValue]);

    var detailRows = [
      ['ATPL CHECK PRODUCTION — EMPLOYEE MACHINE-WISE & DAILY (1-31) BREAKDOWN'],
      ['Month', ds.monthLabel],
      [],
      ['Emp Code', 'Employee Name', 'Machine Code', 'Credited Card', 'Source Excel Sheet', 'Rate', 'Rate Mode']
        .concat(Array.from({ length: 31 }, function(_, idx) { return 'D' + (idx + 1); }))
        .concat(['Total Qty', 'Total Value (₹)'])
    ];
    sortedEmps.forEach(function(e) {
      e.machineRecords.forEach(function(mr) {
        var rArr = [
          e.empCode || '—',
          e.empName,
          mr.machineCode,
          mr.cardLabel,
          mr.sourceSheetsList.join(', '),
          mr.rate,
          mr.rateKind === 'monthly' ? ('Monthly ÷ ' + (mr.divisor || ds.daysInMonth)) : 'Per Unit'
        ];
        for (var d = 0; d < 31; d++) {
          rArr.push(mr.daily[d] || 0);
        }
        rArr.push(mr.qty);
        rArr.push(mr.value);
        detailRows.push(rArr);
      });
    });

    return { summaryRows: summaryRows, detailRows: detailRows };
  }

  function buildRateExportRows(ds, analytics) {
    var rows = [
      ['ATPL CHECK PRODUCTION — RATE-WISE BREAKDOWN'],
      ['Month', ds.monthLabel],
      [],
      ['Rate (₹)', 'Rate Type', 'Effective Per-Unit Rate (₹)', 'Machines Count', 'Employees Count', 'Entries', 'Total Qty', 'Total Value (₹)', 'Share (%)']
    ];
    analytics.rates.forEach(function(rt) {
      rows.push([
        rt.rate,
        rt.rateKind === 'monthly' ? ('Monthly Salary (÷' + (rt.divisor || 30) + 'd)') : 'Production / Unit Rate',
        rt.effectiveRate,
        rt.machineCount,
        rt.employeeCount,
        rt.rowCount,
        rt.totalQty,
        rt.totalValue,
        rt.valueSharePct
      ]);
    });
    return rows;
  }

  function exportReport(kind) {
    if (!window.XLSX || !window.XLSX.utils || typeof window.XLSX.writeFile !== 'function') {
      if (window.showToast) window.showToast('⚠️ Excel export library unavailable.');
      return;
    }
    var ctx = getFilteredAnalytics();
    if (!ctx.dataset || ctx.filteredRecords.length === 0) {
      if (window.showToast) window.showToast('⚠️ No production data to export.');
      return;
    }
    var ds = ctx.dataset;
    var analytics = ctx.analytics;
    var wb = window.XLSX.utils.book_new();
    var slug = ds.monthKey || 'report';

    if (kind === 'cards') {
      window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.aoa_to_sheet(buildCardExportRows(ds, analytics)), 'Card_Wise');
      window.XLSX.writeFile(wb, 'Check_Production_Card_Wise_' + slug + '.xlsx');
    } else if (kind === 'machines') {
      window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.aoa_to_sheet(buildMachineExportRows(ds, analytics)), 'Machine_Wise');
      window.XLSX.writeFile(wb, 'Check_Production_Machine_Wise_' + slug + '.xlsx');
    } else if (kind === 'employees') {
      var empSheets = buildEmployeeExportSheets(ds, analytics);
      window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.aoa_to_sheet(empSheets.summaryRows), 'Employee_Summary');
      window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.aoa_to_sheet(empSheets.detailRows), 'Employee_Machine_Daily');
      window.XLSX.writeFile(wb, 'Check_Production_Employee_Wise_' + slug + '.xlsx');
    } else {
      var empAll = buildEmployeeExportSheets(ds, analytics);
      window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.aoa_to_sheet(buildCardExportRows(ds, analytics)), 'Card_Wise');
      window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.aoa_to_sheet(buildMachineExportRows(ds, analytics)), 'Machine_Wise');
      window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.aoa_to_sheet(empAll.summaryRows), 'Employee_Wise');
      window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.aoa_to_sheet(buildRateExportRows(ds, analytics)), 'Rate_Wise');
      window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.aoa_to_sheet(empAll.detailRows), 'Daily_1_31_Detail');
      window.XLSX.writeFile(wb, 'Check_Production_Complete_' + slug + '.xlsx');
    }
    if (window.showToast) window.showToast('⬇ Exported Excel report successfully.');
  }

  function exportSingleEmployeeExcel(empKey) {
    if (!window.XLSX || !window.XLSX.utils || typeof window.XLSX.writeFile !== 'function') return;
    var ctx = getFilteredAnalytics();
    var emp = ctx.analytics.employees.find(function(e) { return e.empKey === empKey; }) ||
      ctx.allAnalytics.employees.find(function(e) { return e.empKey === empKey; });
    if (!emp || !ctx.dataset) return;

    var rows = [
      ['EMPLOYEE PRODUCTION STATEMENT'],
      ['Month', ctx.dataset.monthLabel, 'Emp Code', emp.empCode || '—', 'Employee Name', emp.empName],
      ['Total Production Qty', emp.totalQty, 'Total Production Value (₹)', emp.totalValue, 'Cards', emp.cardsWorked.join(', ')],
      [],
      ['Machine Code', 'Credited Card', 'Source Sheet(s)', 'Rate (₹)', 'Rate Mode']
        .concat(Array.from({ length: 31 }, function(_, idx) { return 'Day ' + (idx + 1); }))
        .concat(['Total Qty', 'Total Value (₹)'])
    ];
    emp.machineRecords.forEach(function(mr) {
      var rArr = [
        mr.machineCode,
        mr.cardLabel,
        mr.sourceSheetsList.join(', '),
        mr.rate,
        mr.rateKind === 'monthly' ? ('Monthly ÷ ' + (mr.divisor || ctx.dataset.daysInMonth)) : 'Per Unit'
      ];
      for (var d = 0; d < 31; d++) rArr.push(mr.daily[d] || 0);
      rArr.push(mr.qty);
      rArr.push(mr.value);
      rows.push(rArr);
    });
    var totRow = ['CONSOLIDATED TOTAL', emp.cardsWorked.join(', '), emp.machineRecords.length + ' Machine Record(s)', '', ''];
    for (var td = 0; td < 31; td++) totRow.push(emp.dailyTotals[td] || 0);
    totRow.push(emp.totalQty);
    totRow.push(emp.totalValue);
    rows.push(totRow);

    var wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.aoa_to_sheet(rows), 'Employee_Detail');
    var safeFile = (emp.empCode || emp.empName).replace(/[^a-z0-9_-]/gi, '_');
    window.XLSX.writeFile(wb, 'Employee_Production_' + safeFile + '_' + ctx.dataset.monthKey + '.xlsx');
  }

  function getSortedEmployees(list) {
    var arr = (list || []).slice();
    if (state.empSortBy === 'qty') {
      arr.sort(function(a, b) { return b.totalQty - a.totalQty || b.totalValue - a.totalValue; });
    } else if (state.empSortBy === 'name') {
      arr.sort(function(a, b) { return a.empName.localeCompare(b.empName); });
    } else {
      arr.sort(function(a, b) { return b.totalValue - a.totalValue || b.totalQty - a.totalQty; });
    }
    return arr;
  }

  // ── UI Styling ──
  function injectStyles() {
    if (typeof document === 'undefined' || document.getElementById('atpl-cp-styles')) return;
    var style = document.createElement('style');
    style.id = 'atpl-cp-styles';
    style.textContent = [
      '#checkProductionContainer { font-family: "Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, sans-serif; max-width: 1440px; margin: 0 auto; color: #0f172a; padding-bottom: 48px; }',
      '.cp-num { font-family: "JetBrains Mono", ui-monospace, monospace; font-variant-numeric: tabular-nums; }',
      '.cp-header { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 16px; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 18px 22px; margin-bottom: 16px; }',
      '.cp-title { font-size: 20px; font-weight: 800; color: #0f172a; letter-spacing: -0.02em; margin: 0; }',
      '.cp-sub { font-size: 12.5px; color: #64748b; margin-top: 3px; }',
      '.cp-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }',
      '.cp-btn { display: inline-flex; align-items: center; gap: 6px; padding: 8px 14px; border-radius: 8px; font-size: 12px; font-weight: 700; cursor: pointer; border: 1px solid #cbd5e1; background: #ffffff; color: #1e293b; white-space: nowrap; transition: background .15s ease, border-color .15s ease, transform .15s ease; }',
      '.cp-btn:hover { background: #f8fafc; border-color: #94a3b8; }',
      '.cp-btn-primary { background: #4f46e5; border-color: #4f46e5; color: #ffffff; }',
      '.cp-btn-primary:hover { background: #4338ca; border-color: #4338ca; }',
      '.cp-btn-emerald { background: #059669; border-color: #059669; color: #ffffff; }',
      '.cp-btn-emerald:hover { background: #047857; border-color: #047857; }',
      '.cp-btn-sm { padding: 5px 10px; font-size: 11px; border-radius: 6px; }',
      '.cp-btn-danger { color: #dc2626; border-color: #fecaca; background: #fef2f2; }',
      '.cp-btn-danger:hover { background: #fee2e2; border-color: #fca5a5; }',
      '.cp-upload-bar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 14px; background: #ffffff; border: 1px dashed #94a3b8; border-radius: 12px; padding: 14px 20px; margin-bottom: 16px; transition: border-color .15s ease, background .15s ease; }',
      '.cp-upload-bar.dragover { border-color: #4f46e5; background: #eef2ff; }',
      '.cp-kpi-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 16px; }',
      '@media(max-width: 1024px) { .cp-kpi-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }',
      '@media(max-width: 600px) { .cp-kpi-grid { grid-template-columns: 1fr; } }',
      '.cp-kpi { background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px 18px; }',
      '.cp-kpi-label { font-size: 11px; font-weight: 700; color: #64748b; letter-spacing: 0.03em; }',
      '.cp-kpi-val { font-size: 24px; font-weight: 800; color: #0f172a; margin-top: 6px; line-height: 1.15; }',
      '.cp-kpi-meta { font-size: 11.5px; color: #64748b; margin-top: 6px; }',
      '.cp-filter-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 12px 16px; margin-bottom: 16px; }',
      '.cp-field { display: flex; flex-direction: column; gap: 3px; min-width: 140px; }',
      '.cp-field-grow { flex: 1 1 220px; }',
      '.cp-field label { font-size: 10.5px; font-weight: 700; color: #64748b; }',
      '.cp-input, .cp-select { height: 34px; padding: 0 10px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 12.5px; color: #0f172a; background: #ffffff; }',
      '.cp-tabs { display: inline-flex; flex-wrap: wrap; gap: 4px; padding: 4px; background: #e2e8f0; border-radius: 10px; margin-bottom: 16px; }',
      '.cp-tab { padding: 7px 14px; border: none; border-radius: 7px; font-size: 12px; font-weight: 700; color: #475569; background: transparent; cursor: pointer; white-space: nowrap; transition: background .15s ease, color .15s ease; }',
      '.cp-tab.active { background: #ffffff; color: #0f172a; box-shadow: 0 1px 2px rgba(15,23,42,0.08); }',
      '.cp-panel { background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; margin-bottom: 16px; }',
      '.cp-panel-hd { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; padding: 14px 18px; border-bottom: 1px solid #e2e8f0; }',
      '.cp-panel-title { font-size: 14px; font-weight: 800; color: #0f172a; }',
      '.cp-panel-meta { font-size: 12px; color: #64748b; }',
      '.cp-grid-2 { display: grid; grid-template-columns: 1.15fr 0.85fr; gap: 16px; margin-bottom: 16px; align-items: start; }',
      '@media(max-width: 1100px) { .cp-grid-2 { grid-template-columns: 1fr; } }',
      '.cp-table-wrap { overflow-x: auto; }',
      '.cp-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }',
      '.cp-table th { background: #f8fafc; color: #475569; font-weight: 700; font-size: 11px; text-align: left; padding: 10px 14px; border-bottom: 1px solid #e2e8f0; white-space: nowrap; }',
      '.cp-table td { padding: 9px 14px; border-bottom: 1px solid #f1f5f9; color: #0f172a; vertical-align: middle; }',
      '.cp-table tbody tr:hover { background: #f8fafc; }',
      '.cp-table th.num, .cp-table td.num { text-align: right; }',
      '.cp-bar-track { width: 88px; height: 6px; background: #e2e8f0; border-radius: 99px; overflow: hidden; display: inline-block; vertical-align: middle; margin-right: 6px; }',
      '.cp-bar-fill { height: 100%; background: #4f46e5; border-radius: 99px; }',
      '.cp-cross-note { font-size: 11px; color: #b45309; font-weight: 600; }',
      '.cp-empty { background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 48px 24px; text-align: center; }',
      '.cp-modal-backdrop { position: fixed; inset: 0; background: rgba(15, 23, 42, 0.56); z-index: 99999; display: flex; align-items: center; justify-content: center; padding: 18px; }',
      '.cp-modal { background: #ffffff; border-radius: 14px; border: 1px solid #cbd5e1; width: min(1180px, 98vw); max-height: 92vh; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 24px 60px rgba(15,23,42,0.28); }',
      '.cp-modal-hd { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 16px 22px; border-bottom: 1px solid #e2e8f0; background: #f8fafc; }',
      '.cp-modal-body { padding: 18px 22px; overflow-y: auto; }',
      '.cp-daily-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(56px, 1fr)); gap: 6px; margin-top: 8px; }',
      '.cp-day-cell { border: 1px solid #e2e8f0; border-radius: 8px; padding: 6px 4px; text-align: center; background: #f8fafc; }',
      '.cp-day-cell.active { background: #eef2ff; border-color: #a5b4fc; }',
      '.cp-day-num { font-size: 10px; color: #64748b; font-weight: 700; }',
      '.cp-day-val { font-size: 12px; font-weight: 800; color: #0f172a; margin-top: 2px; }',
      '.cp-day-cell:not(.active) .cp-day-val { color: #cbd5e1; font-weight: 500; }'
    ].join('\n');
    document.head.appendChild(style);
  }

  function updateSidebarBadge() {
    if (typeof document === 'undefined') return;
    var badge = document.getElementById('checkProdBadge');
    if (!badge) return;
    var ds = getActiveDataset();
    if (ds && ds.records && ds.records.length > 0) {
      badge.textContent = String(ds.records.length);
      badge.style.display = 'inline-block';
    } else {
      badge.style.display = 'none';
    }
  }

  // ── UI Rendering ──
  function renderUploadZone(ds) {
    var erpFiles = (typeof window !== 'undefined' && Array.isArray(window.files)) ? window.files : [];
    var erpOptions = erpFiles.map(function(f, idx) {
      return '<option value="' + idx + '">' + esc(f.name || ('File #' + (idx + 1))) + '</option>';
    }).join('');

    var sheetSummaryText = '';
    if (ds) {
      var sheetList = ds.detectedSheets.map(function(s) { return s.sheetName; }).slice(0, 6).join(', ');
      if (ds.detectedSheets.length > 6) sheetList += ' +' + (ds.detectedSheets.length - 6) + ' more';
      sheetSummaryText = '<div style="font-size:11.5px;color:#475569;margin-top:4px">' +
        'Active File: <strong>' + esc(ds.fileName) + '</strong> · ' +
        ds.detectedSheets.length + ' Card sheet(s) detected (' + esc(sheetList) + ') · ' +
        ds.records.length + ' entries' +
        '</div>';
    }

    return '' +
      '<div class="cp-upload-bar" id="cpDropZone" ' +
      'ondragover="event.preventDefault();this.classList.add(\'dragover\')" ' +
      'ondragleave="this.classList.remove(\'dragover\')" ' +
      'ondrop="event.preventDefault();this.classList.remove(\'dragover\');if(event.dataTransfer&&event.dataTransfer.files&&event.dataTransfer.files[0])ATPLCheckProduction.handleFileUpload(event.dataTransfer.files[0]);">' +
        '<div>' +
          '<div style="font-size:13.5px;font-weight:800;color:#0f172a">Upload Monthly Attendance / Production Excel Sheet</div>' +
          '<div style="font-size:12px;color:#64748b;margin-top:2px">' +
            'Auto-reads Card sheets (C1, C3, C5–C13) · Machine codes credit true Card (e.g. C7R → Card 07) · Supports .xlsx, .xls, .csv' +
          '</div>' +
          sheetSummaryText +
          '<div id="cpProgressWrap" style="display:' + (state.isParsing ? 'block' : 'none') + ';margin-top:8px;max-width:460px">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;font-size:11.5px;font-weight:700;color:#4f46e5;margin-bottom:4px">' +
              '<span id="cpProgressText">' + esc(state.parseProgressText || 'Processing in background…') + ' (' + (state.parsePercent || 0) + '%)</span>' +
              '<button type="button" class="cp-btn cp-btn-sm" style="padding:2px 8px;margin-left:8px" onclick="ATPLCheckProduction.cancelUpload()">Cancel</button>' +
            '</div>' +
            '<div style="height:6px;background:#e2e8f0;border-radius:99px;overflow:hidden"><div id="cpProgressFill" style="height:100%;width:' + (state.parsePercent || 0) + '%;background:#4f46e5;transition:width .15s ease"></div></div>' +
          '</div>' +
          (state.lastError ? '<div style="font-size:12px;color:#dc2626;font-weight:700;margin-top:6px">' + esc(state.lastError) + '</div>' : '') +
        '</div>' +
        '<div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px">' +
          '<input type="month" class="cp-input" id="cpUploadMonthOverride" value="' + esc(state.pendingMonthKey || (ds ? ds.monthKey : '')) + '" onchange="ATPLCheckProduction.setPendingMonth(this.value)" title="Optional: override month for uploaded sheet" style="width:146px">' +
          '<input type="file" id="cpFileInput" accept=".xlsx,.xls,.xlsb,.xlsm,.ods,.csv" style="display:none" onchange="if(this.files&&this.files[0]){ATPLCheckProduction.handleFileUpload(this.files[0]);this.value=\'\';}">' +
          '<button type="button" class="cp-btn cp-btn-primary" onclick="document.getElementById(\'cpFileInput\').click()">' +
            (state.isParsing ? '⏳ ' + esc(state.parseProgressText || 'Processing…') : '📤 Upload Attendance Sheet') +
          '</button>' +
          (erpFiles.length > 0
            ? '<select class="cp-select" id="cpErpFilePicker" style="max-width:210px" onchange="if(this.value!==\'\'){ATPLCheckProduction.loadFromErpSavedFile(Number(this.value));this.value=\'\';}">' +
                '<option value="">Pick from Saved ERP Files (' + erpFiles.length + ')…</option>' +
                erpOptions +
              '</select>'
            : '') +
        '</div>' +
      '</div>';
  }

  function renderFilterBar(ds, allAnalytics) {
    var monthKeys = Object.keys(state.months).sort().reverse();
    var monthOpts = monthKeys.map(function(mk) {
      var m = state.months[mk];
      return '<option value="' + esc(mk) + '"' + (mk === state.activeMonthKey ? ' selected' : '') + '>' + esc(m.monthLabel) + ' (' + m.records.length + ' rows)</option>';
    }).join('');

    var cardOpts = '<option value="ALL">All Cards (' + allAnalytics.cards.length + ')</option>' +
      allAnalytics.cards.map(function(c) {
        return '<option value="' + esc(c.cardKey) + '"' + (c.cardKey === state.cardFilter ? ' selected' : '') + '>' + esc(c.cardLabel) + ' (' + formatQty(c.totalQty) + ')</option>';
      }).join('');

    var machinePool = allAnalytics.machines.filter(function(m) {
      return state.cardFilter === 'ALL' || m.cardKey === state.cardFilter;
    });
    var machineOpts = '<option value="ALL">All Machines (' + machinePool.length + ')</option>' +
      machinePool.map(function(m) {
        return '<option value="' + esc(m.machineCode) + '"' + (m.machineCode === state.machineFilter ? ' selected' : '') + '>' + esc(m.machineCode) + ' · ' + esc(m.cardLabel) + '</option>';
      }).join('');

    return '' +
      '<div class="cp-filter-bar">' +
        '<div class="cp-field">' +
          '<label for="cpMonthSel">Month</label>' +
          '<select id="cpMonthSel" class="cp-select" onchange="ATPLCheckProduction.setMonth(this.value)">' + monthOpts + '</select>' +
        '</div>' +
        '<div class="cp-field">' +
          '<label for="cpCardSel">Card</label>' +
          '<select id="cpCardSel" class="cp-select" onchange="ATPLCheckProduction.setCardFilter(this.value)">' + cardOpts + '</select>' +
        '</div>' +
        '<div class="cp-field">' +
          '<label for="cpMachineSel">Machine</label>' +
          '<select id="cpMachineSel" class="cp-select" onchange="ATPLCheckProduction.setMachineFilter(this.value)">' + machineOpts + '</select>' +
        '</div>' +
        '<div class="cp-field">' +
          '<label for="cpRateModeSel">Rate Type</label>' +
          '<select id="cpRateModeSel" class="cp-select" onchange="ATPLCheckProduction.setRateModeFilter(this.value)">' +
            '<option value="ALL"' + (state.rateModeFilter === 'ALL' ? ' selected' : '') + '>All Rates</option>' +
            '<option value="piece"' + (state.rateModeFilter === 'piece' ? ' selected' : '') + '>Piece / Unit Rate</option>' +
            '<option value="monthly"' + (state.rateModeFilter === 'monthly' ? ' selected' : '') + '>Monthly Salary Rate</option>' +
          '</select>' +
        '</div>' +
        '<div class="cp-field cp-field-grow">' +
          '<label for="cpSearchInput">Search Employee (Code or Name)</label>' +
          '<input id="cpSearchInput" type="search" class="cp-input" placeholder="Search code e.g. 26303 or name e.g. Ramawadh…" value="' + esc(state.searchQuery) + '" oninput="ATPLCheckProduction.setSearch(this.value)">' +
        '</div>' +
        '<div style="display:flex;align-items:flex-end;gap:6px;padding-top:14px">' +
          '<button type="button" class="cp-btn cp-btn-sm" onclick="ATPLCheckProduction.resetFilters()">↺ Reset</button>' +
          (ds ? '<button type="button" class="cp-btn cp-btn-sm cp-btn-danger" onclick="ATPLCheckProduction.confirmDeleteMonth(\'' + jsStr(ds.monthKey) + '\')" title="Remove this month upload">🗑 Remove Month</button>' : '') +
        '</div>' +
      '</div>';
  }

  function renderKpis(ds, analytics) {
    var pieceSub = analytics.pieceQty > 0 ? ('Piece Qty: ' + formatQty(analytics.pieceQty)) : '';
    var monthSub = analytics.monthlyQty > 0 ? ('Shift Days: ' + formatQty(analytics.monthlyQty)) : '';
    var qtyMeta = [pieceSub, monthSub].filter(Boolean).join(' · ') || 'Across all selected rows';

    var valMeta = [];
    if (analytics.pieceValue > 0) valMeta.push('Piece: ' + formatINR(analytics.pieceValue));
    if (analytics.monthlyValue > 0) valMeta.push('Monthly: ' + formatINR(analytics.monthlyValue));

    return '' +
      '<div class="cp-kpi-grid">' +
        '<div class="cp-kpi">' +
          '<div class="cp-kpi-label">Total Monthly Production</div>' +
          '<div class="cp-kpi-val cp-num">' + formatQty(analytics.totalQty) + '</div>' +
          '<div class="cp-kpi-meta cp-num">' + esc(qtyMeta) + '</div>' +
        '</div>' +
        '<div class="cp-kpi">' +
          '<div class="cp-kpi-label">Total Production Value</div>' +
          '<div class="cp-kpi-val cp-num" style="color:#059669">' + formatINR(analytics.totalValue) + '</div>' +
          '<div class="cp-kpi-meta cp-num">' + esc(valMeta.join(' · ') || 'Quantity × Applicable Rate') + '</div>' +
        '</div>' +
        '<div class="cp-kpi">' +
          '<div class="cp-kpi-label">Active Cards &amp; Machines</div>' +
          '<div class="cp-kpi-val cp-num">' + analytics.cardCount + ' Cards · ' + analytics.machineCount + ' Machines</div>' +
          '<div class="cp-kpi-meta">' + analytics.rowCount + ' machine-shift entries · ' + ds.detectedSheets.length + ' Card sheets</div>' +
        '</div>' +
        '<div class="cp-kpi">' +
          '<div class="cp-kpi-label">Employees &amp; Card Accuracy</div>' +
          '<div class="cp-kpi-val cp-num">' + analytics.employeeCount + ' Employees</div>' +
          '<div class="cp-kpi-meta">' +
            (analytics.crossCardCount > 0
              ? '<span style="color:#b45309;font-weight:700">' + analytics.crossCardCount + ' cross-sheet entries credited to true Card</span>'
              : 'All entries matched source sheet Card') +
          '</div>' +
        '</div>' +
      '</div>';
  }

  function renderDashboardTab(ds, analytics) {
    // 1. Card-wise Summary table
    var cardRows = analytics.cards.map(function(c) {
      var incomingText = c.crossCardIncomingCount > 0
        ? '<div class="cp-cross-note">+' + c.crossCardIncomingCount + ' entry from ' + esc(Object.keys(c.incomingSheets).join(', ')) + '</div>'
        : '';
      return '' +
        '<tr>' +
          '<td>' +
            '<button type="button" class="cp-btn cp-btn-sm" style="font-weight:800;border-color:#e2e8f0" onclick="ATPLCheckProduction.drillToCard(\'' + jsStr(c.cardKey) + '\')">' + esc(c.cardLabel) + '</button>' +
            incomingText +
          '</td>' +
          '<td class="num cp-num">' + c.machineCount + '</td>' +
          '<td class="num cp-num">' + c.employeeCount + '</td>' +
          '<td class="num cp-num" style="font-weight:700">' + formatQty(c.totalQty) + '</td>' +
          '<td class="num cp-num" style="font-weight:800;color:#059669">' + formatINR(c.totalValue) + '</td>' +
          '<td class="num cp-num">' +
            '<div class="cp-bar-track"><div class="cp-bar-fill" style="width:' + Math.min(100, Math.max(2, c.valueSharePct)) + '%"></div></div>' +
            c.valueSharePct + '%' +
          '</td>' +
        '</tr>';
    }).join('');

    // 2. Highest Production Employees
    var topList = state.topSortBy === 'value' ? analytics.topByValue : analytics.topByQty;
    var topRows = topList.map(function(e, idx) {
      return '' +
        '<tr>' +
          '<td class="cp-num" style="color:#64748b;font-weight:700">' + (idx + 1) + '</td>' +
          '<td>' +
            '<div style="font-weight:700;color:#0f172a">' + esc(e.empName) + '</div>' +
            '<div style="font-size:11px;color:#64748b" class="cp-num">' + esc(e.empCode || 'No Code') + ' · ' + esc(e.cardsWorked.join(', ')) + '</div>' +
          '</td>' +
          '<td class="num cp-num" style="font-weight:700">' + formatQty(e.totalQty) + '</td>' +
          '<td class="num cp-num" style="font-weight:800;color:#059669">' + formatINR(e.totalValue) + '</td>' +
          '<td style="text-align:right"><button type="button" class="cp-btn cp-btn-sm cp-btn-primary" onclick="ATPLCheckProduction.openEmployeeDetail(\'' + jsStr(e.empKey) + '\')">View More</button></td>' +
        '</tr>';
    }).join('');

    // 3. Rate-wise Breakdown
    var rateRows = analytics.rates.map(function(rt) {
      return '' +
        '<tr>' +
          '<td class="cp-num" style="font-weight:800">' + esc(formatRate(rt.rate, rt.rateKind, rt.divisor)) + '</td>' +
          '<td>' + (rt.rateKind === 'monthly' ? 'Monthly Salary Rate' : (rt.rateKind === 'piece' ? 'Production / Piece Rate' : 'Direct Amount')) + '</td>' +
          '<td class="num cp-num">' + rt.machineCount + '</td>' +
          '<td class="num cp-num">' + rt.employeeCount + '</td>' +
          '<td class="num cp-num">' + rt.rowCount + '</td>' +
          '<td class="num cp-num" style="font-weight:700">' + formatQty(rt.totalQty) + '</td>' +
          '<td class="num cp-num" style="font-weight:800;color:#059669">' + formatINR(rt.totalValue) + '</td>' +
          '<td class="num cp-num">' + rt.valueSharePct + '%</td>' +
        '</tr>';
    }).join('');

    // 4. Top Machines Preview
    var topMachines = analytics.machines.slice().sort(function(a, b) { return b.totalValue - a.totalValue; }).slice(0, 12);
    var machineRows = topMachines.map(function(m) {
      var rateList = m.rates.map(function(rt) { return formatRate(rt.rate, rt.rateKind, rt.divisor); }).join(' · ');
      return '' +
        '<tr>' +
          '<td class="cp-num" style="font-weight:800">' + esc(m.machineCode) + '</td>' +
          '<td>' + esc(m.cardLabel) + '</td>' +
          '<td style="font-size:11.5px;color:#475569" class="cp-num">' + esc(rateList) + '</td>' +
          '<td class="num cp-num">' + m.employeeCount + '</td>' +
          '<td class="num cp-num" style="font-weight:700">' + formatQty(m.totalQty) + '</td>' +
          '<td class="num cp-num" style="font-weight:800;color:#059669">' + formatINR(m.totalValue) + '</td>' +
        '</tr>';
    }).join('');

    return '' +
      '<div class="cp-grid-2">' +
        '<div class="cp-panel">' +
          '<div class="cp-panel-hd">' +
            '<div><div class="cp-panel-title">Card-wise Production Summary</div><div class="cp-panel-meta">Click any Card to drill down · Credited strictly by machine code</div></div>' +
            '<button type="button" class="cp-btn cp-btn-sm" onclick="ATPLCheckProduction.exportReport(\'cards\')">⬇ Export Cards</button>' +
          '</div>' +
          '<div class="cp-table-wrap"><table class="cp-table"><thead><tr><th>Card</th><th class="num">Machines</th><th class="num">Employees</th><th class="num">Total Qty</th><th class="num">Total Value</th><th class="num">Share</th></tr></thead><tbody>' +
            (cardRows || '<tr><td colspan="6" style="text-align:center;padding:24px;color:#64748b">No card data matches filters.</td></tr>') +
          '</tbody></table></div>' +
        '</div>' +
        '<div class="cp-panel">' +
          '<div class="cp-panel-hd">' +
            '<div><div class="cp-panel-title">Highest Production Employees</div><div class="cp-panel-meta">Top 10 performers in selected view</div></div>' +
            '<div style="display:flex;gap:4px">' +
              '<button type="button" class="cp-btn cp-btn-sm ' + (state.topSortBy === 'qty' ? 'cp-btn-primary' : '') + '" onclick="ATPLCheckProduction.setTopSort(\'qty\')">By Qty</button>' +
              '<button type="button" class="cp-btn cp-btn-sm ' + (state.topSortBy === 'value' ? 'cp-btn-primary' : '') + '" onclick="ATPLCheckProduction.setTopSort(\'value\')">By Value</button>' +
            '</div>' +
          '</div>' +
          '<div class="cp-table-wrap"><table class="cp-table"><thead><tr><th>#</th><th>Employee</th><th class="num">Qty</th><th class="num">Value</th><th style="text-align:right">Details</th></tr></thead><tbody>' +
            (topRows || '<tr><td colspan="5" style="text-align:center;padding:24px;color:#64748b">No employees match filters.</td></tr>') +
          '</tbody></table></div>' +
        '</div>' +
      '</div>' +
      '<div class="cp-panel">' +
        '<div class="cp-panel-hd">' +
          '<div><div class="cp-panel-title">Machine-wise Production Summary</div><div class="cp-panel-meta">Showing top ' + topMachines.length + ' of ' + analytics.machines.length + ' machines · Switch to Machine-wise tab for full list</div></div>' +
          '<button type="button" class="cp-btn cp-btn-sm" onclick="ATPLCheckProduction.setTab(\'machines\')">View All Machines →</button>' +
        '</div>' +
        '<div class="cp-table-wrap"><table class="cp-table"><thead><tr><th>Machine</th><th>Credited Card</th><th>Rate(s)</th><th class="num">Employees</th><th class="num">Total Qty</th><th class="num">Total Value</th></tr></thead><tbody>' +
          (machineRows || '<tr><td colspan="6" style="text-align:center;padding:24px;color:#64748b">No machines match filters.</td></tr>') +
        '</tbody></table></div>' +
      '</div>' +
      '<div class="cp-panel">' +
        '<div class="cp-panel-hd">' +
          '<div><div class="cp-panel-title">Rate-wise Breakdown</div><div class="cp-panel-meta">Quantities and amounts grouped separately by applicable rate</div></div>' +
        '</div>' +
        '<div class="cp-table-wrap"><table class="cp-table"><thead><tr><th>Rate</th><th>Rate Category</th><th class="num">Machines</th><th class="num">Employees</th><th class="num">Entries</th><th class="num">Total Qty</th><th class="num">Total Value</th><th class="num">Share</th></tr></thead><tbody>' +
          (rateRows || '<tr><td colspan="8" style="text-align:center;padding:24px;color:#64748b">No rate entries match filters.</td></tr>') +
        '</tbody></table></div>' +
      '</div>';
  }

  function renderCardsTab(analytics) {
    var rows = analytics.cards.map(function(c) {
      var isExp = state.expandedCardKey === c.cardKey;
      var incomingText = c.crossCardIncomingCount > 0
        ? '<span class="cp-cross-note">Includes ' + c.crossCardIncomingCount + ' entry (' + formatQty(c.crossCardIncomingQty) + ' qty · ' + formatINR(c.crossCardIncomingValue) + ') moved from ' + esc(Object.keys(c.incomingSheets).join(', ')) + '</span>'
        : '<span style="color:#64748b;font-size:11.5px">All from native card sheet</span>';

      var html = '' +
        '<tr>' +
          '<td style="font-weight:800">' + esc(c.cardLabel) + '</td>' +
          '<td class="num cp-num">' + c.machineCount + '</td>' +
          '<td class="num cp-num">' + c.employeeCount + '</td>' +
          '<td class="num cp-num">' + c.rowCount + '</td>' +
          '<td class="num cp-num">' + formatQty(c.pieceQty) + '</td>' +
          '<td class="num cp-num">' + formatINR(c.pieceValue) + '</td>' +
          '<td class="num cp-num">' + formatQty(c.monthlyQty) + '</td>' +
          '<td class="num cp-num">' + formatINR(c.monthlyValue) + '</td>' +
          '<td class="num cp-num" style="font-weight:800">' + formatQty(c.totalQty) + '</td>' +
          '<td class="num cp-num" style="font-weight:800;color:#059669">' + formatINR(c.totalValue) + '</td>' +
          '<td>' + incomingText + '</td>' +
          '<td style="text-align:right"><button type="button" class="cp-btn cp-btn-sm" onclick="ATPLCheckProduction.toggleExpandCard(\'' + jsStr(c.cardKey) + '\')">' + (isExp ? 'Hide Machines' : 'Machines (' + c.machineCount + ')') + '</button></td>' +
        '</tr>';

      if (isExp) {
        var subRows = c.machinesList.map(function(m) {
          return '<div style="display:flex;justify-content:space-between;gap:12px;padding:6px 10px;border-bottom:1px solid #e2e8f0;font-size:12px">' +
            '<span class="cp-num" style="font-weight:700">' + esc(m.machineCode) + '</span>' +
            '<span style="color:#64748b">' + m.employeeCount + ' employees · ' + m.rowCount + ' rows</span>' +
            '<span class="cp-num">Qty: <strong>' + formatQty(m.totalQty) + '</strong> · Value: <strong style="color:#059669">' + formatINR(m.totalValue) + '</strong></span>' +
          '</div>';
        }).join('');
        html += '<tr><td colspan="12" style="background:#f8fafc;padding:10px 18px">' +
          '<div style="font-size:11.5px;font-weight:800;color:#334155;margin-bottom:6px">' + esc(c.cardLabel) + ' — Machines Breakdown</div>' +
          subRows +
        '</td></tr>';
      }
      return html;
    }).join('');

    return '' +
      '<div class="cp-panel">' +
        '<div class="cp-panel-hd">' +
          '<div><div class="cp-panel-title">Card-wise Total Production</div><div class="cp-panel-meta">Card credits determined strictly from machine/location code (e.g. C7R → Card 07)</div></div>' +
          '<button type="button" class="cp-btn cp-btn-sm cp-btn-emerald" onclick="ATPLCheckProduction.exportReport(\'cards\')">⬇ Export Card-wise Excel</button>' +
        '</div>' +
        '<div class="cp-table-wrap"><table class="cp-table"><thead><tr>' +
          '<th>Card</th><th class="num">Machines</th><th class="num">Employees</th><th class="num">Entries</th>' +
          '<th class="num">Piece Qty</th><th class="num">Piece Value</th>' +
          '<th class="num">Shift Qty</th><th class="num">Shift Value</th>' +
          '<th class="num">Total Qty</th><th class="num">Total Value</th><th>Sheet Credit Audit</th><th style="text-align:right">Inspect</th>' +
        '</tr></thead><tbody>' +
          (rows || '<tr><td colspan="12" style="text-align:center;padding:24px;color:#64748b">No cards match current filters.</td></tr>') +
        '</tbody></table></div>' +
      '</div>';
  }

  function renderMachinesTab(analytics) {
    var visibleMachines = analytics.machines.slice(0, state.machineViewLimit || 120);
    var rows = visibleMachines.map(function(m) {
      var rateStr = m.rates.map(function(rt) { return formatRate(rt.rate, rt.rateKind, rt.divisor); }).join(' · ');
      return '' +
        '<tr>' +
          '<td class="cp-num" style="font-weight:800">' + esc(m.machineCode) + '</td>' +
          '<td>' + esc(m.cardLabel) + '</td>' +
          '<td class="cp-num" style="font-size:12px">' + esc(rateStr) + '</td>' +
          '<td class="num cp-num">' + m.employeeCount + '</td>' +
          '<td class="num cp-num">' + m.rowCount + '</td>' +
          '<td class="num cp-num" style="font-weight:700">' + formatQty(m.totalQty) + '</td>' +
          '<td class="num cp-num" style="font-weight:800;color:#059669">' + formatINR(m.totalValue) + '</td>' +
          '<td class="num cp-num">' + m.valueSharePct + '%</td>' +
          '<td class="num cp-num">' + (m.crossCardCount > 0 ? '<span class="cp-cross-note">' + m.crossCardCount + ' cross-sheet</span>' : '—') + '</td>' +
        '</tr>';
    }).join('');

    return '' +
      '<div class="cp-panel">' +
        '<div class="cp-panel-hd">' +
          '<div><div class="cp-panel-title">Machine-wise Production (' + analytics.machines.length + ' Machines)</div><div class="cp-panel-meta">Consolidated production per canonical machine code</div></div>' +
          '<button type="button" class="cp-btn cp-btn-sm cp-btn-emerald" onclick="ATPLCheckProduction.exportReport(\'machines\')">⬇ Export Machine-wise Excel</button>' +
        '</div>' +
        '<div class="cp-table-wrap"><table class="cp-table"><thead><tr>' +
          '<th>Machine Code</th><th>Credited Card</th><th>Applicable Rate(s)</th><th class="num">Employees</th><th class="num">Entries</th><th class="num">Total Qty</th><th class="num">Total Value</th><th class="num">Share</th><th class="num">Cross-Sheet</th>' +
        '</tr></thead><tbody>' +
          (rows || '<tr><td colspan="9" style="text-align:center;padding:24px;color:#64748b">No machines match filters.</td></tr>') +
        '</tbody></table></div>' +
        (analytics.machines.length > visibleMachines.length
          ? '<div style="padding:12px;text-align:center;border-top:1px solid #f1f5f9"><button type="button" class="cp-btn cp-btn-sm" onclick="ATPLCheckProduction.showMoreMachines()">Show More Machines (' + (analytics.machines.length - visibleMachines.length) + ' remaining)</button></div>'
          : '') +
      '</div>';
  }

  function renderEmployeesTab(analytics) {
    var list = getSortedEmployees(analytics.employees);
    var visibleList = list.slice(0, state.empViewLimit || 120);
    var rows = visibleList.map(function(e) {
      var machinesSummary = e.machineRecords.map(function(mr) {
        return mr.machineCode + ' (' + formatQty(mr.qty) + ')';
      }).join(', ');
      return '' +
        '<tr>' +
          '<td class="cp-num" style="font-weight:700">' + esc(e.empCode || '—') + '</td>' +
          '<td style="font-weight:700">' + esc(e.empName) + '</td>' +
          '<td>' + esc(e.cardsWorked.join(', ')) + '</td>' +
          '<td style="max-width:340px;font-size:12px;color:#475569">' + esc(machinesSummary) + '</td>' +
          '<td class="num cp-num">' + e.machineRecords.length + '</td>' +
          '<td class="num cp-num" style="font-weight:700">' + formatQty(e.totalQty) + '</td>' +
          '<td class="num cp-num" style="font-weight:800;color:#059669">' + formatINR(e.totalValue) + '</td>' +
          '<td style="text-align:right">' +
            '<button type="button" class="cp-btn cp-btn-sm cp-btn-primary" onclick="ATPLCheckProduction.openEmployeeDetail(\'' + jsStr(e.empKey) + '\')">View More</button>' +
          '</td>' +
        '</tr>';
    }).join('');

    return '' +
      '<div class="cp-panel">' +
        '<div class="cp-panel-hd">' +
          '<div><div class="cp-panel-title">Employee-wise Production (' + list.length + ' Employees)</div><div class="cp-panel-meta">Consolidated across all machines · Click View More for machine-wise &amp; daily (1–31) breakdown</div></div>' +
          '<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center">' +
            '<select class="cp-select" style="height:30px;font-size:11.5px" onchange="ATPLCheckProduction.setEmpSort(this.value)">' +
              '<option value="value"' + (state.empSortBy === 'value' ? ' selected' : '') + '>Sort: Highest Value</option>' +
              '<option value="qty"' + (state.empSortBy === 'qty' ? ' selected' : '') + '>Sort: Highest Qty</option>' +
              '<option value="name"' + (state.empSortBy === 'name' ? ' selected' : '') + '>Sort: Name A–Z</option>' +
            '</select>' +
            '<button type="button" class="cp-btn cp-btn-sm cp-btn-emerald" onclick="ATPLCheckProduction.exportReport(\'employees\')">⬇ Export Employee-wise Excel</button>' +
          '</div>' +
        '</div>' +
        '<div class="cp-table-wrap"><table class="cp-table"><thead><tr>' +
          '<th>Emp Code</th><th>Employee Name</th><th>Cards Credited</th><th>Machines Worked (Qty)</th><th class="num">Records</th><th class="num">Total Qty</th><th class="num">Total Value</th><th style="text-align:right">Details</th>' +
        '</tr></thead><tbody>' +
          (rows || '<tr><td colspan="8" style="text-align:center;padding:24px;color:#64748b">No employees match search/filters.</td></tr>') +
        '</tbody></table></div>' +
        (list.length > visibleList.length
          ? '<div style="padding:12px;text-align:center;border-top:1px solid #f1f5f9;display:flex;justify-content:center;gap:8px">' +
              '<button type="button" class="cp-btn cp-btn-sm" onclick="ATPLCheckProduction.showMoreEmployees(120)">Show Next 120 (' + (list.length - visibleList.length) + ' remaining)</button>' +
              '<button type="button" class="cp-btn cp-btn-sm" onclick="ATPLCheckProduction.showMoreEmployees(10000)">Show All (' + list.length + ')</button>' +
            '</div>'
          : '') +
      '</div>';
  }

  function renderRatesTab(analytics) {
    var rows = analytics.rates.map(function(rt) {
      return '' +
        '<tr>' +
          '<td class="cp-num" style="font-weight:800">' + esc(formatRate(rt.rate, rt.rateKind, rt.divisor)) + '</td>' +
          '<td>' + (rt.rateKind === 'monthly' ? 'Monthly Salary Rate' : (rt.rateKind === 'piece' ? 'Production / Unit Rate' : 'Direct Amount')) + '</td>' +
          '<td class="num cp-num">' + formatINR(rt.effectiveRate) + '</td>' +
          '<td style="max-width:300px;font-size:11.5px;color:#475569" class="cp-num">' + esc(rt.machinesList.join(', ')) + '</td>' +
          '<td class="num cp-num">' + rt.employeeCount + '</td>' +
          '<td class="num cp-num">' + rt.rowCount + '</td>' +
          '<td class="num cp-num" style="font-weight:700">' + formatQty(rt.totalQty) + '</td>' +
          '<td class="num cp-num" style="font-weight:800;color:#059669">' + formatINR(rt.totalValue) + '</td>' +
          '<td class="num cp-num">' + rt.valueSharePct + '%</td>' +
        '</tr>';
    }).join('');

    return '' +
      '<div class="cp-panel">' +
        '<div class="cp-panel-hd">' +
          '<div><div class="cp-panel-title">Rate-wise Production Breakdown</div><div class="cp-panel-meta">Separate totals for each unit/piece rate and monthly salary rate</div></div>' +
        '</div>' +
        '<div class="cp-table-wrap"><table class="cp-table"><thead><tr>' +
          '<th>Sheet Rate</th><th>Category</th><th class="num">Effective Unit Rate</th><th>Machines</th><th class="num">Employees</th><th class="num">Entries</th><th class="num">Total Qty</th><th class="num">Total Value</th><th class="num">Share</th>' +
        '</tr></thead><tbody>' +
          (rows || '<tr><td colspan="9" style="text-align:center;padding:24px;color:#64748b">No rate breakdown available.</td></tr>') +
        '</tbody></table></div>' +
      '</div>';
  }

  function renderEmployeeDetailModal(ds, analytics, allAnalytics) {
    if (!state.viewMoreEmpKey) return '';
    var emp = analytics.employees.find(function(e) { return e.empKey === state.viewMoreEmpKey; }) ||
      allAnalytics.employees.find(function(e) { return e.empKey === state.viewMoreEmpKey; });
    if (!emp) return '';

    var machineRowsHtml = emp.machineRecords.map(function(mr, idx) {
      var crossNote = mr.isCrossCard
        ? '<div class="cp-cross-note">Sheet: ' + esc(mr.sourceSheetsList.join(', ')) + ' → Credited: ' + esc(mr.cardLabel) + '</div>'
        : '<div style="font-size:11px;color:#64748b">Sheet: ' + esc(mr.sourceSheetsList.join(', ')) + '</div>';

      var dailyBoxes = '';
      for (var d = 0; d < 31; d++) {
        var dv = mr.daily[d] || 0;
        dailyBoxes += '<div class="cp-day-cell ' + (dv > 0 ? 'active' : '') + '">' +
          '<div class="cp-day-num">D' + (d + 1) + '</div>' +
          '<div class="cp-day-val cp-num">' + (dv > 0 ? formatQty(dv) : '0') + '</div>' +
        '</div>';
      }

      return '' +
        '<div style="border:1px solid #e2e8f0;border-radius:10px;padding:14px;margin-bottom:12px;background:#ffffff">' +
          '<div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:10px;padding-bottom:10px;border-bottom:1px solid #f1f5f9">' +
            '<div>' +
              '<div style="font-size:14px;font-weight:800;color:#0f172a" class="cp-num">' +
                (idx + 1) + '. Machine ' + esc(mr.machineCode) + ' · ' + esc(mr.cardLabel) +
              '</div>' +
              crossNote +
            '</div>' +
            '<div style="display:flex;flex-wrap:wrap;gap:18px;font-size:12.5px" class="cp-num">' +
              '<div><span style="color:#64748b">Rate:</span> <strong>' + esc(formatRate(mr.rate, mr.rateKind, mr.divisor)) + '</strong></div>' +
              '<div><span style="color:#64748b">Quantity:</span> <strong>' + formatQty(mr.qty) + '</strong></div>' +
              '<div><span style="color:#64748b">Value:</span> <strong style="color:#059669">' + formatINR(mr.value) + '</strong></div>' +
            '</div>' +
          '</div>' +
          '<div class="cp-daily-grid">' + dailyBoxes + '</div>' +
        '</div>';
    }).join('');

    var consolidatedDaily = '';
    for (var cd = 0; cd < 31; cd++) {
      var cdv = emp.dailyTotals[cd] || 0;
      consolidatedDaily += '<div class="cp-day-cell ' + (cdv > 0 ? 'active' : '') + '">' +
        '<div class="cp-day-num">D' + (cd + 1) + '</div>' +
        '<div class="cp-day-val cp-num">' + (cdv > 0 ? formatQty(cdv) : '0') + '</div>' +
      '</div>';
    }

    return '' +
      '<div class="cp-modal-backdrop" id="cpEmpModalBackdrop" onclick="if(event.target===this)ATPLCheckProduction.closeEmployeeDetail()">' +
        '<div class="cp-modal" role="dialog" aria-modal="true">' +
          '<div class="cp-modal-hd">' +
            '<div>' +
              '<div style="font-size:17px;font-weight:800;color:#0f172a">' + esc(emp.empName) + '</div>' +
              '<div style="font-size:12px;color:#475569;margin-top:2px" class="cp-num">' +
                'Code: ' + esc(emp.empCode || '—') + ' · Month: ' + esc(ds.monthLabel) + ' · Cards: ' + esc(emp.cardsWorked.join(', ')) + ' · Machines: ' + esc(emp.machinesWorked.join(', ')) +
              '</div>' +
            '</div>' +
            '<div style="display:flex;align-items:center;gap:8px">' +
              '<button type="button" class="cp-btn cp-btn-sm cp-btn-emerald" onclick="ATPLCheckProduction.exportSingleEmployeeExcel(\'' + jsStr(emp.empKey) + '\')">⬇ Export Employee Excel</button>' +
              '<button type="button" class="cp-btn cp-btn-sm" onclick="ATPLCheckProduction.closeEmployeeDetail()">✕ Close</button>' +
            '</div>' +
          '</div>' +
          '<div class="cp-modal-body">' +
            '<div class="cp-kpi-grid" style="grid-template-columns:repeat(3,minmax(0,1fr));margin-bottom:14px">' +
              '<div class="cp-kpi"><div class="cp-kpi-label">Machines Worked</div><div class="cp-kpi-val cp-num" style="font-size:20px">' + emp.machineRecords.length + ' Record(s)</div><div class="cp-kpi-meta">' + esc(emp.machinesWorked.join(', ')) + '</div></div>' +
              '<div class="cp-kpi"><div class="cp-kpi-label">Consolidated Production Qty</div><div class="cp-kpi-val cp-num" style="font-size:20px">' + formatQty(emp.totalQty) + '</div><div class="cp-kpi-meta">Exact sum across all machines</div></div>' +
              '<div class="cp-kpi"><div class="cp-kpi-label">Consolidated Production Value</div><div class="cp-kpi-val cp-num" style="font-size:20px;color:#059669">' + formatINR(emp.totalValue) + '</div><div class="cp-kpi-meta">Qty × Applicable Rate</div></div>' +
            '</div>' +
            '<div style="font-size:13px;font-weight:800;color:#0f172a;margin-bottom:8px">Machine-wise Records &amp; Daily Production (Days 1–31)</div>' +
            machineRowsHtml +
            '<div style="border:1px solid #cbd5e1;border-radius:10px;padding:14px;background:#f8fafc">' +
              '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">' +
                '<div style="font-size:13px;font-weight:800;color:#0f172a">Consolidated Daily Totals Across All Machines (1–31)</div>' +
                '<div class="cp-num" style="font-size:13px;font-weight:800">Total Qty: ' + formatQty(emp.totalQty) + ' · Total Value: <span style="color:#059669">' + formatINR(emp.totalValue) + '</span></div>' +
              '</div>' +
              '<div class="cp-daily-grid">' + consolidatedDaily + '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  function renderUI() {
    if (typeof document === 'undefined') return;
    injectStyles();
    var container = document.getElementById('checkProductionContainer');
    if (!container) return;

    var ctx = getFilteredAnalytics();
    var ds = ctx.dataset;
    var analytics = ctx.analytics;
    var allAnalytics = ctx.allAnalytics;

    var headerHtml = '' +
      '<div class="cp-header">' +
        '<div>' +
          '<h2 class="cp-title">Check Production</h2>' +
          '<div class="cp-sub">Monthly Card, Machine &amp; Employee production verification from Excel attendance sheets</div>' +
        '</div>' +
        '<div class="cp-actions">' +
          (ds ? '<button type="button" class="cp-btn cp-btn-emerald" onclick="ATPLCheckProduction.exportReport(\'all\')">⬇ Export Complete Excel</button>' : '') +
        '</div>' +
      '</div>';

    var html = headerHtml + renderUploadZone(ds);

    if (!ds) {
      html += '' +
        '<div class="cp-empty">' +
          '<div style="font-size:32px;margin-bottom:8px">📊</div>' +
          '<div style="font-size:16px;font-weight:800;color:#0f172a">No Attendance Sheet Loaded Yet</div>' +
          '<div style="font-size:13px;color:#64748b;max-width:560px;margin:8px auto 18px">' +
            'Upload a monthly Excel attendance workbook (containing Card sheets C1, C3, C5–C13) to calculate Card-wise, Machine-wise, Employee-wise, and Rate-wise production automatically.' +
          '</div>' +
          '<button type="button" class="cp-btn cp-btn-primary" onclick="document.getElementById(\'cpFileInput\').click()">📤 Upload Monthly Attendance Sheet</button>' +
        '</div>';
      container.innerHTML = html;
      return;
    }

    html += renderFilterBar(ds, allAnalytics);
    html += renderKpis(ds, analytics);

    html += '' +
      '<div class="cp-tabs">' +
        '<button type="button" class="cp-tab ' + (state.activeTab === 'dashboard' ? 'active' : '') + '" onclick="ATPLCheckProduction.setTab(\'dashboard\')">Overview Dashboard</button>' +
        '<button type="button" class="cp-tab ' + (state.activeTab === 'cards' ? 'active' : '') + '" onclick="ATPLCheckProduction.setTab(\'cards\')">Card-wise (' + analytics.cardCount + ')</button>' +
        '<button type="button" class="cp-tab ' + (state.activeTab === 'machines' ? 'active' : '') + '" onclick="ATPLCheckProduction.setTab(\'machines\')">Machine-wise (' + analytics.machineCount + ')</button>' +
        '<button type="button" class="cp-tab ' + (state.activeTab === 'employees' ? 'active' : '') + '" onclick="ATPLCheckProduction.setTab(\'employees\')">Employee-wise (' + analytics.employeeCount + ')</button>' +
        '<button type="button" class="cp-tab ' + (state.activeTab === 'rates' ? 'active' : '') + '" onclick="ATPLCheckProduction.setTab(\'rates\')">Rate-wise Breakdown (' + analytics.rates.length + ')</button>' +
      '</div>';

    if (state.activeTab === 'cards') {
      html += renderCardsTab(analytics);
    } else if (state.activeTab === 'machines') {
      html += renderMachinesTab(analytics);
    } else if (state.activeTab === 'employees') {
      html += renderEmployeesTab(analytics);
    } else if (state.activeTab === 'rates') {
      html += renderRatesTab(analytics);
    } else {
      html += renderDashboardTab(ds, analytics);
    }

    html += renderEmployeeDetailModal(ds, analytics, allAnalytics);
    container.innerHTML = html;
  }

  // ── Public Controller API ──
  var ATPLCheckProduction = {
    version: BUILD,
    init: function() {
      loadAllMonthsFromStorage();
      renderUI();
    },
    renderUI: renderUI,
    handleFileUpload: handleFileUpload,
    cancelUpload: cancelUpload,
    showMoreEmployees: function(step) { state.empViewLimit = (state.empViewLimit || 120) + (step || 120); renderUI(); },
    showMoreMachines: function() { state.machineViewLimit = (state.machineViewLimit || 120) + 120; renderUI(); },
    loadFromErpSavedFile: loadFromErpSavedFile,
    setPendingMonth: function(mk) {
      state.pendingMonthKey = mk || '';
    },
    setMonth: function(mk) {
      if (state.months[mk]) {
        state.activeMonthKey = mk;
        invalidateAnalyticsCache();
        state.cardFilter = 'ALL';
        state.machineFilter = 'ALL';
        state.viewMoreEmpKey = null;
        try {
          if (typeof localStorage !== 'undefined') {
            var meta = JSON.parse(localStorage.getItem(META_STORAGE_KEY) || '{}');
            meta.activeMonthKey = mk;
            localStorage.setItem(META_STORAGE_KEY, JSON.stringify(meta));
          }
        } catch (_) {}
        updateSidebarBadge();
        renderUI();
      }
    },
    confirmDeleteMonth: function(mk) {
      var m = state.months[mk];
      if (!m) return;
      if (typeof confirm === 'function' && !confirm('Remove uploaded production data for ' + m.monthLabel + '?')) {
        return;
      }
      invalidateAnalyticsCache();
      deleteMonthFromStorage(mk).then(function() {
        updateSidebarBadge();
        renderUI();
        if (window.showToast) window.showToast('🗑 Removed ' + esc(m.monthLabel) + ' production data.');
      });
    },
    setTab: function(tab) {
      state.activeTab = tab || 'dashboard';
      renderUI();
    },
    setCardFilter: function(val) {
      state.cardFilter = val || 'ALL';
      state.machineFilter = 'ALL';
      renderUI();
    },
    setMachineFilter: function(val) {
      state.machineFilter = val || 'ALL';
      renderUI();
    },
    setRateModeFilter: function(val) {
      state.rateModeFilter = val || 'ALL';
      renderUI();
    },
    setSearch: function(q) {
      state.searchQuery = q || '';
      state.empViewLimit = 120;
      if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(function() {
        searchDebounceTimer = null;
        renderUI();
        var inp = document.getElementById('cpSearchInput');
        if (inp) {
          inp.focus();
          try { inp.selectionStart = inp.selectionEnd = inp.value.length; } catch (_) {}
        }
      }, 140);
    },
    resetFilters: function() {
      state.cardFilter = 'ALL';
      state.machineFilter = 'ALL';
      state.rateModeFilter = 'ALL';
      state.searchQuery = '';
      state.expandedCardKey = null;
      renderUI();
    },
    drillToCard: function(cardKey) {
      state.cardFilter = cardKey || 'ALL';
      state.machineFilter = 'ALL';
      state.activeTab = 'machines';
      renderUI();
    },
    toggleExpandCard: function(cardKey) {
      state.expandedCardKey = (state.expandedCardKey === cardKey) ? null : cardKey;
      renderUI();
    },
    setTopSort: function(sortBy) {
      state.topSortBy = sortBy === 'value' ? 'value' : 'qty';
      renderUI();
    },
    setEmpSort: function(sortBy) {
      state.empSortBy = sortBy || 'value';
      renderUI();
    },
    openEmployeeDetail: function(empKey) {
      state.viewMoreEmpKey = empKey || null;
      renderUI();
    },
    closeEmployeeDetail: function() {
      state.viewMoreEmpKey = null;
      renderUI();
    },
    exportReport: exportReport,
    exportSingleEmployeeExcel: exportSingleEmployeeExcel,

    // Pure engine helpers (also exported for comprehensive automated testing)
    parseSheetCardInfo: parseSheetCardInfo,
    classifyMachineAndCard: classifyMachineAndCard,
    parseWorkbookData: parseWorkbookData,
    filterRecords: filterRecords,
    computeAnalytics: computeAnalytics,
    detectMonthFromFilename: detectMonthFromFilename,
    getState: function() { return state; }
  };

  if (root) root.ATPLCheckProduction = ATPLCheckProduction;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ATPLCheckProduction;
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function() {
        ATPLCheckProduction.init();
      });
    } else {
      ATPLCheckProduction.init();
    }
  }
})(typeof window !== 'undefined' ? window : globalThis);
