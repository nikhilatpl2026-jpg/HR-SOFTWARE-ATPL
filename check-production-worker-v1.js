/* ATPL Check Production Background Web Worker V1
   Runs Excel file reading, decompression, sparse cell extraction, Card-sheet detection,
   and Machine-to-Card credit classification completely off the main UI thread so the ERP
   never freezes, hangs, or becomes unresponsive even on large 13-sheet workbooks.
*/
'use strict';

if (typeof importScripts === 'function') {
  try {
    importScripts('xlsx.full.min.js');
  } catch (_) {
    try {
      importScripts('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');
    } catch (e) {
      // Handled gracefully on message
    }
  }
}

var KNOWN_CARDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
var MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function round3(n) { return Math.round((Number(n) || 0) * 1000) / 1000; }
function round4(n) { return Math.round((Number(n) || 0) * 10000) / 10000; }
function cleanText(v) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); }
function normHeader(v) { return cleanText(v).toLowerCase().replace(/[._:]+/g, ' ').replace(/\s+/g, ' ').trim(); }
function num(v) {
  if (typeof v === 'number') return isFinite(v) ? v : null;
  var s = String(v == null ? '' : v).replace(/[₹,\s]/g, '').trim();
  if (!s || s === '-' || s === '--' || /^n\/?a$/i.test(s)) return null;
  var n = Number(s);
  return isFinite(n) ? n : null;
}
function normalizeEmpCode(v) {
  if (v == null) return '';
  if (typeof v === 'number' && isFinite(v)) return String(Math.trunc(v));
  return cleanText(v).replace(/\.0+$/, '');
}
function daysInCalendarMonth(year, month1to12) {
  if (!year || !month1to12) return 30;
  return new Date(year, month1to12, 0).getDate();
}

function detectMonthFromFilename(fileName) {
  var fn = String(fileName || '').toLowerCase();
  var shortMap = {
    jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
    apr: 4, april: 4, may: 5, jun: 6, june: 6,
    jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
    oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12
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
  if (ym4) foundYear = parseInt(ym4[1], 10);
  else {
    var ym2 = fn.match(/(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*[\s._-]*([2-3][0-9])(?:[^0-9]|$)/i);
    if (ym2) foundYear = 2000 + parseInt(ym2[1], 10);
  }
  var now = new Date();
  var monthNum = foundMonth || (now.getMonth() + 1);
  var yearNum = foundYear || now.getFullYear();
  return {
    monthKey: yearNum + '-' + String(monthNum).padStart(2, '0'),
    monthNum: monthNum,
    yearNum: yearNum,
    label: MONTH_NAMES[monthNum - 1] + ' ' + yearNum,
    daysInMonth: daysInCalendarMonth(yearNum, monthNum)
  };
}

function monthInfoFromKey(monthKey) {
  var m = String(monthKey || '').match(/^(\d{4})-(\d{2})$/);
  if (!m) return detectMonthFromFilename('');
  var y = parseInt(m[1], 10), mo = parseInt(m[2], 10);
  if (mo < 1 || mo > 12) return detectMonthFromFilename('');
  return {
    monthKey: monthKey,
    monthNum: mo,
    yearNum: y,
    label: MONTH_NAMES[mo - 1] + ' ' + y,
    daysInMonth: daysInCalendarMonth(y, mo)
  };
}

function parseSheetCardInfo(sheetName) {
  var raw = cleanText(sheetName);
  var low = raw.toLowerCase();
  if (!raw) return null;
  if (/\b(summary|grand\s*total|all\s*cards?|consolidated|master|salary\s*sheet|bank|advance|staff|index)\b/i.test(low)) return null;
  var m = raw.match(/^(?:card(?:\s*no\.?)?[\s._-]*0*(\d+)|c[\s._-]*0*(\d+))(?:\b|[\s._-]|$)/i);
  if (!m) m = raw.match(/\bcard(?:\s*no\.?)?[\s._-]*0*(\d+)\b/i);
  if (!m) return null;
  var n = parseInt(m[1] || m[2], 10);
  if (!isFinite(n) || n <= 0 || n > 99) return null;
  return { cardNum: n, cardKey: 'C' + n, cardLabel: 'Card ' + String(n).padStart(2, '0'), sheetName: raw };
}

function cleanRawMachine(v) {
  return String(v == null ? '' : v).trim().toUpperCase().replace(/[\s_/]+/g, '').replace(/-+/g, '');
}

function stripRateSuffix(rawMachine, rate) {
  var mc = cleanRawMachine(rawMachine);
  var n = Number(rate);
  if (!mc || !isFinite(n) || n <= 0 || n >= 500) return mc;
  var forms = [String(n), n.toFixed(1), n.toFixed(2), n.toFixed(3)];
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
      if (/^C\d+[A-Z]+[A-Z0-9]*$/.test(base)) return base;
    }
  }
  return mc;
}

function classifyMachineAndCard(rawLoc, rate, fallbackSheetCardNum) {
  var rawClean = cleanRawMachine(rawLoc);
  if (!rawClean) return null;
  if (/^(total|sub\s*total|grand\s*total|summary|ring|card\s*total|remark|remarks)$/i.test(rawClean)) return null;
  var machineCode = stripRateSuffix(rawClean, rate);
  var cardNum = null;
  var m = machineCode.match(/^C0*(\d+)/i);
  if (!m) m = machineCode.match(/^CARD0*(\d+)/i);
  if (m) {
    var digits = m[1];
    var parsed = parseInt(digits, 10);
    if (parsed >= 1 && parsed <= 30) cardNum = parsed;
    else if (digits.length >= 3) {
      var two = parseInt(digits.slice(0, 2), 10);
      var one = parseInt(digits.slice(0, 1), 10);
      if (KNOWN_CARDS.indexOf(two) >= 0 && two >= 10) cardNum = two;
      else if (KNOWN_CARDS.indexOf(one) >= 0) cardNum = one;
      else if (two >= 1 && two <= 30) cardNum = two;
      else cardNum = one || parsed;
    } else cardNum = parsed;
  } else if (fallbackSheetCardNum && isFinite(fallbackSheetCardNum)) {
    cardNum = Number(fallbackSheetCardNum);
  }
  var cardKey = cardNum ? ('C' + cardNum) : 'OTHER';
  var cardLabel = cardNum ? ('Card ' + String(cardNum).padStart(2, '0')) : 'Other';
  var isCrossCard = !!(cardNum && fallbackSheetCardNum && Number(cardNum) !== Number(fallbackSheetCardNum));
  return { rawMachine: rawClean, machineCode: machineCode, cardNum: cardNum, cardKey: cardKey, cardLabel: cardLabel, isCrossCard: isCrossCard };
}

function detectHeaderRow(row) {
  if (!Array.isArray(row) || row.length < 4) return null;
  var codeCol = -1, nameCol = -1, locCol = -1, daysCol = -1, rateCol = -1, totalCol = -1;
  var dayCols = [], daySeen = {};
  for (var c = 0; c < row.length; c++) {
    var rawCell = cleanText(row[c]);
    var h = normHeader(rawCell);
    if (!h) continue;
    if (codeCol < 0 && (h === 'code' || h === 'emp code' || h === 'employee code' || h === 'staff code' || h === 'worker code' || h === 'emp id' || h === 'employee id')) { codeCol = c; continue; }
    if (locCol < 0 && (h === 'loctatic' || h === 'location' || h === 'loctation' || h === 'loc' || h === 'machine' || h === 'machine code' || h === 'm/c' || h.indexOf('loctat') >= 0 || h.indexOf('location') >= 0)) { locCol = c; continue; }
    if (nameCol < 0 && (h === 'name' || h === 'emp name' || h === 'employee name' || h === 'staff name' || h === 'worker name')) { nameCol = c; continue; }
    if (/^0*([1-9]|[12][0-9]|3[01])$/.test(h)) {
      var dayNum = parseInt(h, 10);
      if (dayNum >= 1 && dayNum <= 31 && !daySeen[dayNum]) { daySeen[dayNum] = true; dayCols.push({ day: dayNum, col: c }); }
      continue;
    }
    if (daysCol < 0 && (h === 'days' || h === 'day' || h === 'total days' || h === 'tot days' || h === 'qty' || h === 'total qty' || h === 'production' || h === 'total prod')) { daysCol = c; continue; }
    if (rateCol < 0 && (h === 'salry' || h === 'salary' || h === 'rate' || h === 'salary rate' || h === 'prod rate' || h === 'rate/kg' || h.indexOf('salry') >= 0 || h.indexOf('salary') >= 0)) { rateCol = c; continue; }
    if (totalCol < 0 && (h === 'total' || h === 'amount' || h === 'total amount' || h === 'total amt' || h === 'prod value')) { totalCol = c; continue; }
  }
  var looksValid = (locCol >= 0 && (dayCols.length >= 5 || daysCol >= 0 || rateCol >= 0)) || (codeCol >= 0 && dayCols.length >= 10);
  if (!looksValid) return null;
  if (codeCol < 0) codeCol = 0;
  if (nameCol < 0) nameCol = (locCol > codeCol + 1) ? (codeCol + 1) : ((codeCol + 1 < row.length && codeCol + 1 !== locCol) ? (codeCol + 1) : 1);
  dayCols.sort(function(a, b) { return a.day - b.day; });
  return { codeCol: codeCol, nameCol: nameCol, locCol: locCol, dayCols: dayCols, daysCol: daysCol, rateCol: rateCol, totalCol: totalCol };
}

function detectMonthlyDivisor(qty, monthlyRate, sheetTotal, defaultDaysInMonth) {
  var fallback = defaultDaysInMonth || 30;
  if (!sheetTotal || sheetTotal <= 0 || !qty || qty <= 0 || !monthlyRate || monthlyRate <= 0) return fallback;
  var candidates = [fallback, 30, 31, 28, 29], seen = {}, bestDiv = fallback, bestErr = Infinity;
  for (var i = 0; i < candidates.length; i++) {
    var d = candidates[i];
    if (!d || seen[d]) continue;
    seen[d] = true;
    var err = Math.abs(((qty * monthlyRate) / d) - sheetTotal);
    if (err < bestErr) { bestErr = err; bestDiv = d; }
  }
  return bestErr <= Math.max(10, sheetTotal * 0.05) ? bestDiv : fallback;
}

/**
 * O(populated cells) worksheet extractor!
 * Completely immune to trailing formatted blank rows up to row 1,048,576 or col XFD.
 */
function sheetToCompactRows(ws, xlsxLib) {
  if (!ws) return [];
  var keys = Object.keys(ws);
  var rowBuckets = {};
  var rowIndices = [];
  var maxCol = 0;

  for (var i = 0; i < keys.length; i++) {
    var addr = keys[i];
    if (!addr || addr.charCodeAt(0) === 33) continue; // skip '!ref', '!merges', etc.
    var cell = ws[addr];
    if (!cell || cell.v === undefined || cell.v === null || cell.v === '') continue;
    var pos;
    try { pos = xlsxLib.utils.decode_cell(addr); } catch (_) { continue; }
    if (!pos || pos.c > 80) continue; // attendance sheets never exceed ~50 cols; ignore stray cols at XFD
    if (pos.c > maxCol) maxCol = pos.c;
    if (!rowBuckets[pos.r]) {
      rowBuckets[pos.r] = [];
      rowIndices.push(pos.r);
    }
    rowBuckets[pos.r][pos.c] = cell.v;
  }

  rowIndices.sort(function(a, b) { return a - b; });
  return rowIndices.map(function(rIdx) {
    var arr = rowBuckets[rIdx];
    return { excelRow: rIdx + 1, cells: arr };
  });
}

function parseSheetCompact(sheetName, compactRows, monthMeta) {
  var sheetCard = parseSheetCardInfo(sheetName);
  var fallbackCardNum = sheetCard ? sheetCard.cardNum : null;
  var records = [];
  var hdr = null;

  for (var idx = 0; idx < compactRows.length; idx++) {
    var rowObj = compactRows[idx];
    var row = rowObj.cells;
    if (!Array.isArray(row) || row.length === 0) continue;

    var maybeHdr = detectHeaderRow(row);
    if (maybeHdr) { hdr = maybeHdr; continue; }
    if (!hdr) continue;

    var empCode = normalizeEmpCode(hdr.codeCol >= 0 ? row[hdr.codeCol] : '');
    var empName = cleanText(hdr.nameCol >= 0 ? row[hdr.nameCol] : '');
    var locText = cleanText(hdr.locCol >= 0 ? row[hdr.locCol] : '');

    if (!locText) continue;
    if (/^(total|sub\s*total|grand\s*total|card\s*total|ring|summary)$/i.test(locText) ||
        /^(total|sub\s*total|grand\s*total|card\s*total|summary)$/i.test(empName) ||
        /^(total|sub\s*total|grand\s*total)$/i.test(empCode)) {
      continue;
    }

    var rateVal = hdr.rateCol >= 0 ? num(row[hdr.rateCol]) : null;
    var rate = (rateVal != null && rateVal >= 0) ? round4(rateVal) : 0;
    var machineInfo = classifyMachineAndCard(locText, rate, fallbackCardNum);
    if (!machineInfo) continue;

    var daily = new Array(31);
    for (var di = 0; di < 31; di++) daily[di] = 0;
    var dailySum = 0, hasNumericDaily = false, activeDaysCount = 0;

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
    if (qty <= 0) continue;

    var totalColVal = hdr.totalCol >= 0 ? num(row[hdr.totalCol]) : null;
    var sheetTotal = (totalColVal != null && totalColVal >= 0) ? round2(totalColVal) : null;

    var rateKind = 'none', divisor = null, effectiveRate = 0, value = 0;
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
      value = sheetTotal != null ? sheetTotal : 0;
    }

    var finalName = empName || (empCode ? ('Employee ' + empCode) : 'Unnamed Worker');
    var normCodeKey = empCode ? empCode.replace(/^0+/, '').toUpperCase() : '';
    var empKey = normCodeKey ? ('CODE::' + normCodeKey) : ('NAME::' + finalName.toLowerCase().replace(/\s+/g, ' ').trim());

    records.push({
      id: sheetName + '::r' + rowObj.excelRow,
      sheetName: sheetName,
      sourceCardNum: fallbackCardNum,
      sourceCardLabel: sheetCard ? sheetCard.cardLabel : sheetName,
      excelRow: rowObj.excelRow,
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

function analyzeBuffer(buffer, fileName, monthKeyOverride, jobId) {
  if (typeof XLSX === 'undefined' || !XLSX || typeof XLSX.read !== 'function') {
    throw new Error('Excel parser library (XLSX) could not be loaded in background worker.');
  }
  postMessage({ type: 'progress', jobId: jobId, stage: 'Decompressing workbook…', percent: 12 });

  var wb = XLSX.read(buffer, {
    type: 'array',
    cellDates: false,
    cellFormula: false,
    cellStyles: false,
    cellNF: false,
    cellHTML: false,
    sheetStubs: false
  });

  var names = (wb && Array.isArray(wb.SheetNames)) ? wb.SheetNames.slice() : [];
  var baseMeta = monthKeyOverride ? monthInfoFromKey(monthKeyOverride) : detectMonthFromFilename(fileName);

  var cardSheetNames = names.filter(function(sn) { return !!parseSheetCardInfo(sn); });
  cardSheetNames.sort(function(a, b) {
    var ca = parseSheetCardInfo(a), cb = parseSheetCardInfo(b);
    return (ca ? ca.cardNum : 999) - (cb ? cb.cardNum : 999);
  });

  var targetSheets = cardSheetNames.length > 0 ? cardSheetNames : names;
  var total = Math.max(1, targetSheets.length);
  var allRecords = [], detectedSheets = [], skippedSheets = [];

  for (var si = 0; si < targetSheets.length; si++) {
    var sn = targetSheets[si];
    postMessage({
      type: 'progress',
      jobId: jobId,
      stage: 'Scanning ' + sn + ' (' + (si + 1) + '/' + targetSheets.length + ')…',
      percent: 18 + Math.round(((si + 1) / total) * 74)
    });

    var ws = wb.Sheets[sn];
    if (!ws) { skippedSheets.push(sn); continue; }
    var compactRows = sheetToCompactRows(ws, XLSX);
    // Free sheet object promptly to keep worker peak RAM low
    wb.Sheets[sn] = null;

    if (compactRows.length < 2) { skippedSheets.push(sn); continue; }
    var res = parseSheetCompact(sn, compactRows, baseMeta);
    if (res.records.length > 0) {
      detectedSheets.push({
        sheetName: sn,
        cardLabel: res.cardInfo ? res.cardInfo.cardLabel : sn,
        cardNum: res.cardInfo ? res.cardInfo.cardNum : null,
        rowCount: res.records.length
      });
      for (var ri = 0; ri < res.records.length; ri++) allRecords.push(res.records[ri]);
    } else {
      skippedSheets.push(sn);
    }
  }
  wb = null;

  if (allRecords.length === 0) {
    throw new Error('No valid attendance/production rows found. Ensure sheets contain Code, Name, Location (e.g. C1R, C1W), Day columns (1-31) and Salry/Rate.');
  }

  postMessage({ type: 'progress', jobId: jobId, stage: 'Reconciling employees & cards…', percent: 95 });
  var bestNameByKey = {}, bestCodeByKey = {};
  for (var i = 0; i < allRecords.length; i++) {
    var rec = allRecords[i];
    if (rec.empCode && !bestCodeByKey[rec.empKey]) bestCodeByKey[rec.empKey] = rec.empCode;
    if (rec.empName && rec.empName !== ('Employee ' + rec.empCode)) {
      if (!bestNameByKey[rec.empKey] || rec.empName.length > bestNameByKey[rec.empKey].length) {
        bestNameByKey[rec.empKey] = rec.empName;
      }
    }
  }
  for (var j = 0; j < allRecords.length; j++) {
    var r2 = allRecords[j];
    if (bestNameByKey[r2.empKey]) r2.empName = bestNameByKey[r2.empKey];
    if (bestCodeByKey[r2.empKey] && !r2.empCode) r2.empCode = bestCodeByKey[r2.empKey];
  }

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

if (typeof self !== 'undefined' && typeof self.postMessage === 'function') {
  self.onmessage = async function(e) {
    var d = e.data || {};
    if (d.type !== 'parse') return;
    try {
      postMessage({ type: 'progress', jobId: d.jobId, stage: 'Opening file in background…', percent: 5 });
      var buffer = d.buffer || null;
      if (!buffer && d.file) {
        if (typeof FileReaderSync === 'function') {
          buffer = (new FileReaderSync()).readAsArrayBuffer(d.file);
        } else if (typeof d.file.arrayBuffer === 'function') {
          buffer = await d.file.arrayBuffer();
        }
      }
      if (!buffer) throw new Error('Workbook file data unavailable.');
      var dataset = analyzeBuffer(buffer, d.fileName || (d.file && d.file.name) || 'Attendance_Sheet.xlsx', d.monthKey || '', d.jobId);
      buffer = null;
      postMessage({ type: 'done', jobId: d.jobId, dataset: dataset });
    } catch (err) {
      postMessage({ type: 'error', jobId: d.jobId, message: err && err.message ? err.message : String(err) });
    }
  };
}
