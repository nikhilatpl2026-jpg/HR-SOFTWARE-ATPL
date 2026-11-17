(function(g) {
  'use strict';
  if (!g || g.__ATPL_SERVICE_HISTORY_V1__ === '2.1.0') return;
  g.__ATPL_SERVICE_HISTORY_V1__ = '2.2.0';

  var P = 'page-servicehistory';
  var N = 'atpl-sh-nav';
  var M = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  // Normalized header aliases (ordered from most specific to generic)
  var A = {
    code: [
      'employee code', 'emp code', 'employee id', 'emp id', 'empcode', 'empid',
      'e code', 'ecode', 'emp no', 'empno', 'employee no', 'employee number',
      'staff code', 'staff id', 'worker code', 'worker id', 'worker no',
      'card no', 'token no', 'badli no', 'member id', 'id no', 'code'
    ],
    manual: [
      'manual amount', 'manual amt', 'mam amount', 'manual salary', 'manual net',
      'actual paid', 'manual pay', 'cash amount', 'cash amt', 'manual'
    ],
    gross: [
      'gross salary', 'gross total salary', 'total gross salary', 'total gross',
      'earned gross salary', 'gross earned salary', 'gross earning salary', 'earned gross',
      'gross amount', 'gross amt', 'gross wages', 'gross wage', 'gross pay',
      'total earnings', 'total earning', 'gross'
    ],
    basic: [
      'basic salary', 'basic wages', 'basic wage', 'basic pay', 'earned basic',
      'actual basic', 'basic amt', 'basic amount', 'basic da', 'earn basic da', 'basic'
    ],
    hra: ['hra', 'h r a', 'house rent allowance', 'house rent', 'earned hra', 'hra allowance'],
    pf: [
      'employee pf', 'emp pf', 'pf employee', 'pf emp', 'pf emp share', 'employee pf share',
      'pf deduction', 'pf ded', 'ded pf', 'deduction pf', 'pf deductions',
      'pf 12', 'pf12', 'pf 12 0', 'p f 12', 'pf amt', 'pf amount', 'pf cut',
      'epf employee', 'emp epf', 'epf deduction', 'epf ded', 'epf 12', 'epf12',
      'epf amt', 'epf amount', 'provident fund', 'p f', 'epf', 'pf'
    ],
    esic: [
      'employee esic', 'emp esic', 'esic employee', 'esic emp', 'esic emp share', 'employee esic share',
      'employee esi', 'emp esi', 'esi employee', 'esi emp', 'esi emp share',
      'esic deduction', 'esic ded', 'ded esic', 'esic deductions', 'esi deduction', 'esi ded',
      'esic 0 75', 'esic0 75', 'esic 075', 'esic 75', 'esi 0 75', 'esi0 75', 'esi 075', 'esi 75',
      'esic amt', 'esic amount', 'esicamt', 'esi amt', 'esi amount', 'esiamt',
      'esic cut', 'ip ded', 'e s i c', 'e s i', 'esic', 'esi'
    ],
    net: [
      'net salary payable', 'net payable', 'net pay', 'net salary', 'net payment',
      'net amount payable', 'net amount', 'net paid', 'take home pay', 'take home',
      'in hand', 'total payable', 'payable amount', 'net sal'
    ],
    earn: ['other earnings', 'other earning', 'allowances', 'allowance'],
    adv: [
      'advance deduction', 'adv deduction', 'advance ded', 'adv ded',
      'advance recovery', 'adv recovery', 'salary advance', 'advance', 'adv'
    ],
    ded: ['other deductions', 'other deduction', 'total deduction', 'total deductions'],
    pfno: [
      'pf no uan', 'pf uan', 'pf no', 'pf number', 'pf account no', 'pf account number',
      'pf a c no', 'pf ac no', 'epf no', 'epf number', 'epf account no', 'pf member id',
      'uan no', 'uan number', 'universal account number', 'uan'
    ],
    esicno: [
      'esic no', 'esic number', 'esi no', 'esi number', 'esic ip no', 'esic ip number',
      'esic ip', 'ip no', 'ip number', 'insurance no', 'insurance number',
      'esic a c no', 'esi a c no'
    ]
  };

  var S = {
    result: null,
    expanded: {},
    filter: 'all' // 'all' | 'found' | 'statutory' | 'missing'
  };

  function $(id) {
    return document.getElementById('atpl-sh-' + id);
  }

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function(c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function norm(v) {
    if (v instanceof Date) return '';
    return String(v == null ? '' : v).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function key(v) {
    if (v instanceof Date) return '';
    var s = String(v == null ? '' : v).trim().replace(/\.0+$/, '').replace(/\s+/g, '').toUpperCase();
    return /^\d+$/.test(s) ? (s.replace(/^0+/, '') || '0') : s;
  }

  function num(v) {
    if (v instanceof Date) return null;
    if (typeof v === 'number' && isFinite(v)) return v;
    if (v == null || String(v).trim() === '') return null;
    var s = String(v).replace(/[₹,\s]/g, '').replace(/^\((.*)\)$/, '-$1');
    if (/^[-–—]+$/.test(s) || /^n\/?a$/i.test(s) || /^nil$/i.test(s) || /^#+$/.test(s)) return null;
    var n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  function round2(n) {
    return Math.round((Number(n) || 0) * 100) / 100;
  }

  function money(v) {
    if (v == null) return '—';
    return '₹' + Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  }

  function parseMonthFromText(raw) {
    if (!raw) return '';
    var s = String(raw).toLowerCase().replace(/[_.,/()'’`-]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!s) return '';

    // 1. Numeric YYYY MM or MM YYYY
    var m = s.match(/\b(20\d{2})\s+(0?[1-9]|1[0-2])\b/) || s.match(/\b(0?[1-9]|1[0-2])\s+(20\d{2})\b/);
    if (m) {
      return m[1].length === 4
        ? m[1] + '-' + String(+m[2]).padStart(2, '0')
        : m[2] + '-' + String(+m[1]).padStart(2, '0');
    }

    // 2. Named months (full + short) anywhere in text, with 4-digit or 2-digit year
    var monthDefs = [
      ['january', 1], ['february', 2], ['march', 3], ['april', 4],
      ['june', 6], ['july', 7], ['august', 8], ['september', 9],
      ['october', 10], ['november', 11], ['december', 12],
      ['sept', 9], ['jan', 1], ['feb', 2], ['mar', 3], ['apr', 4],
      ['may', 5], ['jun', 6], ['jul', 7], ['aug', 8], ['sep', 9],
      ['oct', 10], ['nov', 11], ['dec', 12]
    ];

    var foundMonthNum = 0;
    for (var i = 0; i < monthDefs.length; i++) {
      var nm = monthDefs[i][0];
      var re = new RegExp('(?:^|\\b)' + nm + '(?:\\b|(?=\\d))');
      if (re.test(s)) {
        foundMonthNum = monthDefs[i][1];
        break;
      }
    }

    if (foundMonthNum > 0) {
      var yr4 = s.match(/\b(20[1-3]\d)\b/) || s.match(/(?:january|february|march|april|may|june|july|august|september|october|november|december|sept|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)(20[1-3]\d)\b/);
      if (yr4) {
        return yr4[1] + '-' + String(foundMonthNum).padStart(2, '0');
      }
      var yr2 = s.match(/(?:^|\s|january|february|march|april|may|june|july|august|september|october|november|december|sept|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)(2[0-9]|3[0-5])\b/);
      if (yr2) {
        return '20' + yr2[1] + '-' + String(foundMonthNum).padStart(2, '0');
      }
    }

    // 3. Numeric MM YY (e.g. 03 26)
    var m2 = s.match(/\b(0?[1-9]|1[0-2])\s+(2[0-9]|3[0-5])\b/);
    if (m2) {
      return '20' + m2[2] + '-' + String(+m2[1]).padStart(2, '0');
    }

    return '';
  }

  function month(s, fileSheets) {
    var p = parseMonthFromText(s);
    if (p) return p;
    if (Array.isArray(fileSheets)) {
      for (var i = 0; i < fileSheets.length; i++) {
        var sh = fileSheets[i];
        if (!sh) continue;
        p = parseMonthFromText(sh.name);
        if (p) return p;
        var rows = sh.rows || [];
        for (var r = 0; r < Math.min(10, rows.length); r++) {
          var rowTxt = Array.isArray(rows[r]) ? rows[r].join(' ') : String(rows[r] || '');
          p = parseMonthFromText(rowTxt);
          if (p) return p;
        }
      }
    }
    return '';
  }

  var MASTER_CACHE = { listRef: null, len: -1, ts: 0, entries: [], byCode: {}, byName: {}, byStat: {} };

  function getMasterList() {
    try {
      if (g.EM && Array.isArray(g.EM.data) && g.EM.data.length) return g.EM.data;
    } catch (_) {}
    try {
      if (Array.isArray(g.EMP_MASTER_DATA) && g.EMP_MASTER_DATA.length) return g.EMP_MASTER_DATA;
    } catch (_) {}
    try {
      var raw = g.localStorage && (
        g.localStorage.getItem('AroraTextilesEmployeeMasterV3') ||
        g.localStorage.getItem('ATPL_EmployeeMaster_V3') ||
        g.localStorage.getItem('EM_DATA')
      );
      if (raw) {
        var parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
        if (parsed && Array.isArray(parsed.data)) return parsed.data;
        if (parsed && Array.isArray(parsed.employees)) return parsed.employees;
      }
    } catch (_) {}
    return [];
  }

  function cleanStatId(val) {
    if (val instanceof Date) {
      return String(val.getDate()).padStart(2, '0') + '/' + String(val.getMonth() + 1).padStart(2, '0') + '/' + val.getFullYear();
    }
    var s = String(val == null ? '' : val).trim();
    if (!s || s === '-' || s === '--' || /^n\/?a$/i.test(s) || /^nil$/i.test(s)) return '';
    return s.replace(/\.0+$/, '');
  }

  function formatMasterObj(e) {
    return {
      code: String(e.emp_id || e.code || e.emp_code || e.id || '').trim(),
      name: String(e.name || e.emp_name || '').trim(),
      father: String(e.father || e.father_name || '').trim(),
      dept: String(e.dept || e.department || '').trim(),
      desig: String(e.desig || e.designation || '').trim(),
      cat1: String(e.cat1 || e.category || '').trim(),
      doj: String(e.doj || '').trim(),
      status: String(e.status || '').trim(),
      pfNo: cleanStatId(e.pf_no || e.pfno || e.pf_number || e.uan || e.uan_no),
      esicNo: cleanStatId(e.esi_no || e.esic_no || e.esicno || e.esic_number || e.ip_no),
      gross: num(e.gross),
      basic: num(e.basic),
      hra: num(e.hra),
      bankName: String(e.bank_name || '').trim(),
      accountNo: String(e.account_no || '').trim()
    };
  }

  function getMasterIndex() {
    var list = getMasterList();
    var now = Date.now();
    if (MASTER_CACHE.listRef === list && MASTER_CACHE.len === list.length && (now - MASTER_CACHE.ts) < 2500) {
      return MASTER_CACHE;
    }
    var entries = [];
    var byCode = {};
    var byName = {};
    var byStat = {};
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (!e) continue;
      var c = String(e.emp_id || e.code || e.emp_code || e.id || '').trim();
      var nm = String(e.name || e.emp_name || '').trim();
      var dept = String(e.dept || e.department || '').trim();
      var pf = cleanStatId(e.pf_no || e.pfno || e.pf_number || e.uan || e.uan_no);
      var es = cleanStatId(e.esi_no || e.esic_no || e.esicno || e.esic_number || e.ip_no);
      var ck = key(c);
      var nw = norm(nm);
      var pfk = pf ? key(pf) : '';
      var esk = es ? key(es) : '';
      if (ck && !byCode[ck]) byCode[ck] = e;
      if (nw && !byName[nw]) byName[nw] = e;
      if (pfk && !byStat[pfk]) byStat[pfk] = e;
      if (esk && !byStat[esk]) byStat[esk] = e;
      entries.push({
        raw: e,
        code: c,
        name: nm,
        dept: dept,
        pf: pf,
        es: es,
        nmNorm: nw,
        searchLower: (c + ' ' + nm + ' ' + pf + ' ' + es).toLowerCase()
      });
    }
    MASTER_CACHE = { listRef: list, len: list.length, ts: now, entries: entries, byCode: byCode, byName: byName, byStat: byStat };
    return MASTER_CACHE;
  }

  function lookupMasterEmployee(query) {
    var qNorm = key(query);
    var qWords = norm(query);
    if (!qNorm && !qWords) return null;
    var idx = getMasterIndex();
    if (qNorm && idx.byCode[qNorm]) return formatMasterObj(idx.byCode[qNorm]);
    if (qWords && idx.byName[qWords]) return formatMasterObj(idx.byName[qWords]);
    if (qNorm && idx.byStat[qNorm]) return formatMasterObj(idx.byStat[qNorm]);

    if (qWords && qWords.length >= 3) {
      var partialMatch = null;
      var entries = idx.entries;
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].nmNorm.indexOf(qWords) >= 0) {
          if (partialMatch) return null;
          partialMatch = entries[i].raw;
        }
      }
      if (partialMatch) return formatMasterObj(partialMatch);
    }
    return null;
  }

    function isUsableSalaryFile(f) {
    if (!f || typeof f !== 'object') return false;
    var nm = String(f.name || f.filename || f.id || '').toLowerCase().trim();
    if (!nm) return false;
    if (/\.(json|pdf|doc|docx|png|jpg|jpeg|txt)$/i.test(nm)) return false;
    if (nm.indexOf('advance_management') >= 0 || nm.indexOf('atpl_employee_advances') >= 0) return false;
    if (f.isDocument === true && !f.wb && !f.sheets) return false;
    if (f.module && ['hr_doc', 'challan', 'pf', 'esic'].indexOf(String(f.module).toLowerCase()) >= 0) return false;
    return true;
  }

  function fileRichness(f) {
    if (!f) return 0;
    if (f.wb && f.wb.SheetNames && f.wb.SheetNames.length) return 4;
    if (f.sheets && ((Array.isArray(f.sheets) && f.sheets.length) || (!Array.isArray(f.sheets) && Object.keys(f.sheets).length))) return 3;
    if (f.buf) return 2;
    if (f.base64 || f.original_b64 || f.file_data) return 1;
    return 0;
  }

  function getFiles() {
    var sources = [];
    try {
      if (g.ATPLCentralFileSync && typeof g.ATPLCentralFileSync.getModuleFiles === 'function') {
        sources.push(g.ATPLCentralFileSync.getModuleFiles('salary') || []);
      }
    } catch (_) {}
    if (Array.isArray(g.FILES)) sources.push(g.FILES);
    try {
      if (g.ATPLCentralFileSync && g.ATPLCentralFileSync.fileMap && typeof g.ATPLCentralFileSync.fileMap.values === 'function') {
        sources.push(Array.from(g.ATPLCentralFileSync.fileMap.values()));
      }
    } catch (_) {}

    var byKey = {};
    var order = [];
    sources.forEach(function(arr) {
      if (!Array.isArray(arr)) return;
      arr.forEach(function(f) {
        if (!isUsableSalaryFile(f)) return;
        var k = String(f.name || f.filename || f.id || '').trim().toLowerCase();
        if (!k) return;
        if (!byKey[k]) {
          byKey[k] = f;
          order.push(k);
        } else if (fileRichness(f) > fileRichness(byKey[k])) {
          byKey[k] = f;
        }
      });
    });

    return order.map(function(k) { return byKey[k]; });
  }

  function b64ToUint8(b64) {
    var clean = String(b64 || '').replace(/^data:[^;]+;base64,/, '').trim();
    if (!clean) return null;
    try {
      if (typeof atob === 'function') {
        var bin = atob(clean);
        var u8 = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        return u8;
      }
      if (typeof Buffer !== 'undefined') {
        return new Uint8Array(Buffer.from(clean, 'base64'));
      }
    } catch (_) {}
    return null;
  }

  function decodeWorkbookIfMissing(f) {
    if (!f || f.wb) return f && f.wb;
    try {
      var buf = f.buf;
      if (!buf && (f.base64 || f.original_b64 || f.file_data)) {
        buf = b64ToUint8(f.base64 || f.original_b64 || f.file_data);
      } else if (typeof buf === 'string') {
        buf = b64ToUint8(buf);
      }
      if (!buf) return null;
      if (typeof g.parseWB === 'function') {
        var wb1 = g.parseWB(buf);
        if (wb1 && Array.isArray(wb1.SheetNames) && wb1.SheetNames.length) {
          f.wb = wb1;
          return wb1;
        }
      }
      if (g.XLSX && typeof g.XLSX.read === 'function') {
        var u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
        var wb2 = g.XLSX.read(u8, { type: 'array', cellDates: true });
        if (wb2 && Array.isArray(wb2.SheetNames) && wb2.SheetNames.length) {
          f.wb = wb2;
          return wb2;
        }
      }
    } catch (_) {}
    return null;
  }

  function sheets(f) {
    var out = [];
    var wb = f && f.wb;

    // 1. Prefer f.wb with raw: true so narrow Excel columns ("###") and UAN/ESIC ("1.01E+11") never corrupt
    try {
      if (wb && g.XLSX && wb.SheetNames && wb.Sheets) {
        wb.SheetNames.forEach(function(n) {
          var ws = wb.Sheets[n];
          if (!ws) return;
          var rows = g.XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
          if (Array.isArray(rows) && rows.length) {
            out.push({ name: n, rows: rows });
          }
        });
        if (out.length) return out;
      }
    } catch (_) {}

    // 2. Fallback to pre-extracted f.sheets (handles arrays, objects, or lazy getters)
    var s = f && f.sheets;
    if (Array.isArray(s)) {
      s.forEach(function(x) {
        if (!x) return;
        var rows = x.rows || x.data || [];
        if (Array.isArray(rows) && rows.length) out.push({ name: x.name || 'Sheet', rows: rows });
      });
      if (out.length) return out;
    } else if (s && typeof s === 'object') {
      Object.keys(s).forEach(function(n) {
        var x = s[n];
        var rows = Array.isArray(x) ? x : ((x && (x.rows || x.data)) || []);
        if (Array.isArray(rows) && rows.length) out.push({ name: n, rows: rows });
      });
      if (out.length) return out;
    }

    // 3. Lazy decode from f.buf / f.base64 if neither wb nor sheets was populated yet
    if (f && !wb) {
      wb = decodeWorkbookIfMissing(f);
      if (wb && g.XLSX && wb.SheetNames && wb.Sheets) {
        try {
          wb.SheetNames.forEach(function(n) {
            var ws = wb.Sheets[n];
            if (!ws) return;
            var rows = g.XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
            if (Array.isArray(rows) && rows.length) out.push({ name: n, rows: rows });
          });
        } catch (_) {}
      }
    }

    return out;
  }

  function sheetPriority(name) {
    var nl = norm(name);
    if (nl.indexOf('fourmala') >= 0 || nl.indexOf('formula') >= 0) return 100;
    if (nl.indexOf('manisha') >= 0 || nl.indexOf('manisah') >= 0) return 95;
    if (nl === 'salary sheet' || nl === 'main sheet' || nl === 'salaries') return 90;
    if (nl.indexOf('salary') >= 0 || nl.indexOf('payroll') >= 0 || nl.indexOf('wages') >= 0) return 80;
    if (nl.indexOf('pf') >= 0 || nl.indexOf('esic') >= 0 || nl.indexOf('statutory') >= 0 || nl.indexOf('compliance') >= 0) return 75;
    if (nl === 'staff' || nl === 'non staff' || nl.indexOf('worker') >= 0) return 70;
    if (nl === 'sheet1' || nl === 'sheet 1' || nl === 'data') return 50;
    if (nl.indexOf('category') >= 0 || nl.indexOf('summary') >= 0 || nl.indexOf('department') >= 0 ||
        nl.indexOf('bank') >= 0 || nl.indexOf('hdfc') >= 0 || nl.indexOf('sbi') >= 0 ||
        nl.indexOf('neft') >= 0 || nl.indexOf('attendance') >= 0 || nl.indexOf('attandance') >= 0 ||
        nl === 'advance' || nl === 'adv') return 5;
    return 40;
  }

  function indices(h, aliases, fieldKey) {
    var out = [];
    var seen = {};
    var normalizedH = h.map(function(v) { return norm(v); });

    for (var ai = 0; ai < aliases.length; ai++) {
      var alias = aliases[ai];
      for (var ci = 0; ci < normalizedH.length; ci++) {
        if (seen[ci]) continue;
        if (normalizedH[ci] === alias) {
          seen[ci] = true;
          out.push(ci);
        }
      }
    }
    if (out.length) return out;

    // Safe semantic fallbacks for statutory deduction & ID columns
    if (fieldKey === 'pf') {
      normalizedH.forEach(function(nv, i) {
        if (!nv) return;
        if (/\b(employer|er|3 67|8 33|13|13 0|13 61|admin|edli|no|number|num|account|acc|ac|uan|eps|wage|wages|base|gross|basic)\b/.test(nv)) return;
        if (/\b(pf|p f|epf|pf12|epf12|provident)\b/.test(nv)) out.push(i);
      });
    } else if (fieldKey === 'esic') {
      normalizedH.forEach(function(nv, i) {
        if (!nv) return;
        if (/\b(employer|er|3 25|325|4 75|no|number|num|ip|account|acc|ac|wage|wages|base|gross|basic)\b/.test(nv)) return;
        if (/\b(esic|esi|e s i c|e s i|esic0|esi0)\b/.test(nv)) out.push(i);
      });
    } else if (fieldKey === 'pfno') {
      normalizedH.forEach(function(nv, i) {
        if (!nv) return;
        if (/\b(uan|pf no|pf number|pf account|epf no|epf number|pf member)\b/.test(nv)) out.push(i);
      });
    } else if (fieldKey === 'esicno') {
      normalizedH.forEach(function(nv, i) {
        if (!nv) return;
        if (/\b(esic no|esic number|esi no|esi number|ip no|ip number|esic ip)\b/.test(nv)) out.push(i);
      });
    }
    return out;
  }

  function buildMergedRow(rows, r) {
    var row = rows[r] || [];
    if (r <= 0) return row;
    var prev = rows[r - 1];
    if (!Array.isArray(prev)) return row;
    var prevStr = prev.map(function(x) { return norm(x); }).join(' ');
    if (!/\b(earning|earnings|deduction|deductions|salary|statutory|pf|esic|employee)\b/.test(prevStr)) {
      return row;
    }
    var maxLen = Math.max(prev.length, row.length);
    var merged = [];
    var lastPrefix = '';
    for (var c = 0; c < maxLen; c++) {
      var top = String(prev[c] == null ? '' : prev[c]).trim();
      if (top) lastPrefix = top;
      var bot = String(row[c] == null ? '' : row[c]).trim();
      if (bot) {
        merged[c] = (lastPrefix && norm(bot).indexOf(norm(lastPrefix)) < 0 && !/^(emp|employee|code|id|name|s no|sr no)/i.test(bot))
          ? (lastPrefix + ' ' + bot)
          : bot;
      } else {
        merged[c] = top;
      }
    }
    return merged;
  }

  function detectHeaderRow(rows) {
    var nameHeads = ['employee name', 'employee s name', 'name of employee', 'name of employe', 'emp name', 'emp s name', 'empname', 'worker name', 'worker s name', 'staff name', 'name of worker', 'name of staff', 'full name', 'name', 'karamchari'];
    var serialHeads = ['s no', 'sr no', 'serial no', 'serial number', 'sno', 'sr number', 'sl no', 'sr'];
    var best = null;
    var maxScan = Math.min(35, rows.length);

    for (var r = 0; r < maxScan; r++) {
      var rawH = rows[r] || [];
      if (!Array.isArray(rawH) || rawH.length < 2) continue;
      var mergedH = buildMergedRow(rows, r);

      var ni = -1;
      for (var j = 0; j < rawH.length; j++) {
        if (nameHeads.indexOf(norm(rawH[j])) >= 0) {
          ni = j;
          break;
        }
      }

      var explicitCodeCols = indices(rawH, A.code, 'code');
      var codeCol = -1;
      if (explicitCodeCols.length >= 1) {
        codeCol = explicitCodeCols[0];
      } else if (ni > 0) {
        var prevHead = norm(rawH[ni - 1]);
        var nonCodeHeads = ['department', 'dept', 'designation', 'desig', 'category', 'date', 'month', 'branch', 'unit', 'father name', 'fathers name'];
        if (prevHead && serialHeads.indexOf(prevHead) < 0 && nonCodeHeads.indexOf(prevHead) < 0) {
          codeCol = ni - 1;
        }
      }

      var ix = { code: codeCol >= 0 ? [codeCol] : [] };
      var fieldHits = 0;
      Object.keys(A).forEach(function(k) {
        if (k === 'code') return;
        var cols = indices(rawH, A[k], k);
        if (!cols.length && mergedH !== rawH) {
          cols = indices(mergedH, A[k], k);
        }
        ix[k] = cols;
        if (cols.length) fieldHits++;
      });

      if (codeCol < 0 && (ni < 0 || fieldHits === 0)) continue;
      if (fieldHits === 0 && (explicitCodeCols.length === 0 || ni < 0)) continue;

      var score = (explicitCodeCols.length ? 20 : (codeCol >= 0 ? 5 : 0)) + (ni >= 0 ? 10 : 0) + (fieldHits * 5) + (ix.pf.length ? 8 : 0) + (ix.esic.length ? 8 : 0) + (ix.gross.length ? 5 : 0) + (ix.manual.length ? 5 : 0);
      if (!best || score > best.score) {
        best = { hi: r, nameIdx: ni, ix: ix, score: score, headerRow: rawH };
      }
    }

    return best;
  }

  function codeMatches(cellVal, targetEmpKey) {
    if (!targetEmpKey) return false;
    var ck = key(cellVal);
    if (!ck) return false;
    if (ck === targetEmpKey) return true;
    if (/^\d+$/.test(targetEmpKey)) {
      var m = ck.match(/^[A-Z\/_-]+0*(\d+)$/);
      if (m && (m[1].replace(/^0+/, '') || '0') === targetEmpKey) return true;
    }
    return false;
  }

  var FILE_INDEX_CACHE = typeof WeakMap === 'function' ? new WeakMap() : null;
  var FILE_INDEX_FALLBACK = [];
  var activeSearchToken = 0;
  var scanInProgress = false;
  var warmRunning = false;

  function sheetsSignature(f) {
    var s = f && f.sheets;
    if (!s) return '0';
    if (Array.isArray(s)) return 'A:' + s.length + ':' + (s[0] && (s[0].name || ''));
    if (typeof s === 'object') {
      var ks = Object.keys(s);
      return 'O:' + ks.length + ':' + (ks[0] || '');
    }
    return '1';
  }

  function getCachedFileIndex(f) {
    if (!f || typeof f !== 'object') return null;
    var entry = null;
    if (FILE_INDEX_CACHE) {
      entry = FILE_INDEX_CACHE.get(f) || null;
    } else {
      for (var i = 0; i < FILE_INDEX_FALLBACK.length; i++) {
        if (FILE_INDEX_FALLBACK[i].file === f) { entry = FILE_INDEX_FALLBACK[i].meta; break; }
      }
    }
    if (!entry) return null;
    var fname = String(f.name || f.filename || f.id || '');
    var savedAt = String(f.savedAt || f.updatedAt || f.version || '');
    if (
      entry.wbRef !== (f.wb || null) ||
      entry.sheetsRef !== (f.sheets || null) ||
      entry.sheetsSig !== sheetsSignature(f) ||
      entry.savedAt !== savedAt ||
      entry.name !== fname
    ) {
      return null;
    }
    return entry.index;
  }

  function setCachedFileIndex(f, index) {
    if (!f || typeof f !== 'object') return;
    var meta = {
      wbRef: f.wb || null,
      sheetsRef: f.sheets || null,
      sheetsSig: sheetsSignature(f),
      savedAt: String(f.savedAt || f.updatedAt || f.version || ''),
      name: String(f.name || f.filename || f.id || ''),
      index: index
    };
    if (FILE_INDEX_CACHE) {
      FILE_INDEX_CACHE.set(f, meta);
    } else {
      for (var i = 0; i < FILE_INDEX_FALLBACK.length; i++) {
        if (FILE_INDEX_FALLBACK[i].file === f) {
          FILE_INDEX_FALLBACK[i].meta = meta;
          return;
        }
      }
      if (FILE_INDEX_FALLBACK.length > 80) FILE_INDEX_FALLBACK.shift();
      FILE_INDEX_FALLBACK.push({ file: f, meta: meta });
    }
  }

  function buildSheetIndex(sh) {
    var rows = (sh && sh.rows) || [];
    var hdr = detectHeaderRow(rows);
    var shName = (sh && sh.name) || 'Sheet';
    if (!hdr) {
      return { name: shName, priority: sheetPriority(shName), hdr: null, rows: rows, byCode: null, byName: null };
    }
    var hi = hdr.hi;
    var ix = hdr.ix;
    var nameIdx = hdr.nameIdx;
    var hasCode = !!(ix.code && ix.code.length);
    var codeCol = hasCode ? ix.code[0] : -1;
    var byCode = {};
    var byName = {};

    for (var i = hi + 1; i < rows.length; i++) {
      var row = rows[i];
      if (!row || !row.length) continue;
      if (hasCode) {
        var ck = key(row[codeCol]);
        if (ck) {
          (byCode[ck] || (byCode[ck] = [])).push(i);
          var m = ck.match(/^[A-Z\/_-]+0*(\d+)$/);
          if (m) {
            var stripped = m[1].replace(/^0+/, '') || '0';
            if (stripped && stripped !== ck) {
              (byCode[stripped] || (byCode[stripped] = [])).push(i);
            }
          }
        }
      }
      if (nameIdx >= 0) {
        var rName = norm(row[nameIdx]);
        if (rName) {
          (byName[rName] || (byName[rName] = [])).push(i);
          var rNameClean = rName.replace(/^(mr|mrs|ms|shri|smt|miss|late)\s+/, '').replace(/\s+ji$/, '');
          if (rNameClean && rNameClean !== rName) {
            (byName[rNameClean] || (byName[rNameClean] = [])).push(i);
          }
        }
      }
    }

    return {
      name: shName,
      priority: sheetPriority(shName),
      hdr: hdr,
      rows: rows,
      byCode: byCode,
      byName: byName
    };
  }

  function getOrBuildFileIndex(f) {
    var cached = getCachedFileIndex(f);
    if (cached) return cached;
    var fname = f.name || f.filename || f.id;
    var p = parseMonthFromText(fname);
    var shList = sheets(f);
    if (!p) p = month(fname, shList);
    var indexedSheets = new Array(shList.length);
    for (var i = 0; i < shList.length; i++) {
      indexedSheets[i] = buildSheetIndex(shList[i]);
    }
    var index = {
      file: f,
      period: p,
      sheets: indexedSheets
    };
    setCachedFileIndex(f, index);
    return index;
  }

  function allFilesCached(fs) {
    for (var i = 0; i < fs.length; i++) {
      if (!getCachedFileIndex(fs[i])) return false;
    }
    return true;
  }

  function lookupIndexedSheet(f, idxSh, p, emp, masterEmp, allowNameFallback) {
    var hdr = idxSh && idxSh.hdr;
    if (!hdr) return { recognized: false, rows: [] };

    var rows = idxSh.rows || [];
    var numericKeys = ['manual', 'gross', 'basic', 'hra', 'pf', 'esic', 'net', 'earn', 'adv', 'ded'];
    var hi = hdr.hi;
    var ix = hdr.ix;
    var nameIdx = hdr.nameIdx;
    var headerArr = hdr.headerRow || rows[hi] || [];
    var empKey = key(emp);
    var targetNameNorm = (masterEmp && masterEmp.name) ? norm(masterEmp.name) : (!/^\d+$/.test(String(emp || '').trim()) ? norm(emp) : '');

    function extractRowRec(row, rowIdx, matchedBy) {
      var rawCode = ix.code.length ? cleanStatId(row[ix.code[0]]) : '';
      if (!rawCode && matchedBy !== 'name') return null;
      var codeNorm = norm(rawCode);
      if (codeNorm === 'total' || codeNorm === 'grand total' || codeNorm === 'sub total' || codeNorm === 'subtotal') return null;

      var rec = {
        period: p,
        file: f.name || f.id || 'Unnamed',
        sheet: idxSh.name || 'Sheet',
        priority: idxSh.priority != null ? idxSh.priority : sheetPriority(idxSh.name || ''),
        row: rowIdx + 1,
        code: rawCode || emp,
        empName: nameIdx >= 0 ? cleanStatId(row[nameIdx]) : '',
        matchedBy: matchedBy,
        values: {},
        headers: {},
        issues: []
      };

      Object.keys(ix).forEach(function(k) {
        var cols = ix[k];
        if (!cols || !cols.length) return;
        var colIdx = cols[0];
        var val = numericKeys.indexOf(k) >= 0 ? num(row[colIdx]) : cleanStatId(row[colIdx]);
        if ((val == null || val === '') && cols.length > 1) {
          for (var c2 = 1; c2 < cols.length; c2++) {
            var altVal = numericKeys.indexOf(k) >= 0 ? num(row[cols[c2]]) : cleanStatId(row[cols[c2]]);
            if (altVal != null && altVal !== '') {
              colIdx = cols[c2];
              val = altVal;
              break;
            }
          }
        }
        if ((k === 'pf' || k === 'esic') && typeof val === 'number' && val < 0) {
          val = Math.abs(val);
        }
        rec.headers[k] = String(headerArr[colIdx] || '');
        rec.values[k] = val;
      });

      return rec;
    }

    var found = [];
    if (ix.code.length && empKey && idxSh.byCode && idxSh.byCode[empKey]) {
      var cRows = idxSh.byCode[empKey];
      var seenCode = {};
      for (var ci = 0; ci < cRows.length; ci++) {
        var rIdx = cRows[ci];
        if (seenCode[rIdx]) continue;
        seenCode[rIdx] = true;
        var rec = extractRowRec(rows[rIdx], rIdx, 'code');
        if (rec) found.push(rec);
      }
    }

    // Name fallback ONLY if code match found nothing in this sheet and we have a multi-char target name
    if (!found.length && allowNameFallback && targetNameNorm && nameIdx >= 0 && targetNameNorm.length >= 4 && idxSh.byName) {
      var tNameClean = targetNameNorm.replace(/^(mr|mrs|ms|shri|smt|miss|late)\s+/, '').replace(/\s+ji$/, '');
      var cand = [];
      var seenName = {};
      var l1 = idxSh.byName[targetNameNorm];
      if (l1) {
        for (var a = 0; a < l1.length; a++) {
          if (!seenName[l1[a]]) { seenName[l1[a]] = true; cand.push(l1[a]); }
        }
      }
      if (tNameClean && tNameClean.length >= 4 && tNameClean !== targetNameNorm) {
        var l2 = idxSh.byName[tNameClean];
        if (l2) {
          for (var b = 0; b < l2.length; b++) {
            if (!seenName[l2[b]]) { seenName[l2[b]] = true; cand.push(l2[b]); }
          }
        }
      }
      if (cand.length > 1) cand.sort(function(x, y) { return x - y; });
      var nameHits = [];
      for (var ni2 = 0; ni2 < cand.length; ni2++) {
        var nRec = extractRowRec(rows[cand[ni2]], cand[ni2], 'name');
        if (nRec) nameHits.push(nRec);
      }
      if (nameHits.length === 1) {
        found.push(nameHits[0]);
      }
    }

    return { recognized: true, rows: found };
  }

  function matchScore(r) {
    if (!r) return -1;
    return (r.priority || 0) +
      (r.values.manual != null ? 20 : 0) +
      (r.values.pf != null && r.values.pf > 0 ? 15 : (r.values.pf != null ? 5 : 0)) +
      (r.values.esic != null && r.values.esic > 0 ? 15 : (r.values.esic != null ? 5 : 0)) +
      (r.values.gross != null ? 8 : 0) +
      (r.values.net != null ? 6 : 0);
  }

  function consolidateMatches(matches) {
    if (!matches || !matches.length) return null;
    matches.sort(function(a, b) { return matchScore(b) - matchScore(a); });
    var primary = matches[0];
    if (matches.length === 1) return primary;

    var mergedValues = Object.assign({}, primary.values);
    var mergedHeaders = Object.assign({}, primary.headers);
    var empName = primary.empName;
    var extraSources = [];

    var mergeFields = ['pf', 'esic', 'pfno', 'esicno', 'manual', 'gross', 'basic', 'hra', 'net', 'earn', 'adv', 'ded'];
    for (var i = 1; i < matches.length; i++) {
      var sec = matches[i];
      if (!sec) continue;
      var usedSec = false;
      if (!empName && sec.empName) {
        empName = sec.empName;
        usedSec = true;
      }
      mergeFields.forEach(function(k) {
        var cur = mergedValues[k];
        var alt = sec.values ? sec.values[k] : undefined;
        var isMissing = (cur == null || cur === '' || ((k === 'pf' || k === 'esic') && cur === 0));
        var altValid = (alt != null && alt !== '' && !((k === 'pf' || k === 'esic') && alt === 0));
        if (isMissing && altValid) {
          mergedValues[k] = alt;
          if (sec.headers && sec.headers[k]) mergedHeaders[k] = sec.headers[k] + ' (' + sec.sheet + ')';
          usedSec = true;
        }
      });
      if (usedSec) extraSources.push(sec.file + ' / ' + sec.sheet);
    }

    return Object.assign({}, primary, {
      empName: empName,
      values: mergedValues,
      headers: mergedHeaders,
      mergedFrom: extraSources
    });
  }

  function finalizeScan(inputVal, masterEmp, indexedFiles) {
    var emp = (masterEmp && masterEmp.code) ? masterEmp.code : inputVal;
    var map = {};
    var undatedFiles = [];
    var now = new Date();
    var end = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    var startMonth = '2026-01';
    var endMonth = end;

    for (var fi = 0; fi < indexedFiles.length; fi++) {
      var entry = indexedFiles[fi];
      if (!entry) continue;
      var p = entry.period;
      if (p) {
        if (p < startMonth) startMonth = p;
        if (p > endMonth) endMonth = p;
        (map[p] || (map[p] = [])).push(entry);
      } else {
        undatedFiles.push(entry);
      }
    }

    var months = [];
    var sp = startMonth.split('-');
    var ep = endMonth.split('-');
    var d = new Date(parseInt(sp[0], 10), parseInt(sp[1], 10) - 1, 1);
    var last = new Date(parseInt(ep[0], 10), parseInt(ep[1], 10) - 1, 1);
    var guard = 0;
    while (d <= last && guard < 120) {
      months.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'));
      d.setMonth(d.getMonth() + 1);
      guard++;
    }
    if (undatedFiles.length) {
      map['UNDATED'] = undatedFiles;
      months.push('UNDATED');
    }

    var sheetPfNo = '';
    var sheetEsicNo = '';
    var sheetEmpName = '';
    var discoveredCode = '';
    var totals = {
      monthsFound: 0,
      pfTotal: 0,
      pfMonths: 0,
      esicTotal: 0,
      esicMonths: 0,
      grossTotal: 0,
      basicTotal: 0,
      manualTotal: 0,
      netTotal: 0,
      advTotal: 0,
      dedTotal: 0
    };

    var allowNameFallback = true;

    var monthResults = months.map(function(p) {
      var entries = map[p] || [];
      var fileNames = entries.map(function(x) { return x.file.name || x.file.filename || x.file.id || 'Unnamed file'; });

      function result(status, reason, records) {
        return { period: p, status: status, reason: reason, records: records || [], files: fileNames };
      }

      if (!entries.length) {
        return result('SALARY FILE UNAVAILABLE', 'No saved salary file with a recognizable month in its filename.');
      }

      var matches = [];
      var recognized = 0;
      var unread = [];
      for (var ei = 0; ei < entries.length; ei++) {
        var entry = entries[ei];
        var f = entry.file;
        var ss = entry.sheets || [];
        if (!ss.length) {
          unread.push(f.name || 'Unnamed file');
          continue;
        }
        for (var si = 0; si < ss.length; si++) {
          var idxSh = ss[si];
          var z = lookupIndexedSheet(f, idxSh, p, emp, masterEmp, allowNameFallback);
          if (z.recognized) recognized++;
          else unread.push((f.name || 'File') + ' / ' + idxSh.name);
          if (z.rows.length) {
            for (var ri = 0; ri < z.rows.length; ri++) matches.push(z.rows[ri]);
          }
        }
      }

      if (matches.length >= 1) {
        var r = consolidateMatches(matches);
        if (!discoveredCode && r.code) discoveredCode = r.code;
        if (!sheetEmpName && r.empName) sheetEmpName = r.empName;
        if (!sheetPfNo && r.values.pfno) sheetPfNo = r.values.pfno;
        if (!sheetEsicNo && r.values.esicno) sheetEsicNo = r.values.esicno;

        totals.monthsFound++;
        if (r.values.pf != null && r.values.pf > 0) {
          totals.pfTotal = round2(totals.pfTotal + r.values.pf);
          totals.pfMonths++;
        }
        if (r.values.esic != null && r.values.esic > 0) {
          totals.esicTotal = round2(totals.esicTotal + r.values.esic);
          totals.esicMonths++;
        }
        if (r.values.gross != null) totals.grossTotal = round2(totals.grossTotal + r.values.gross);
        if (r.values.basic != null) totals.basicTotal = round2(totals.basicTotal + r.values.basic);
        if (r.values.manual != null) totals.manualTotal = round2(totals.manualTotal + r.values.manual);
        if (r.values.net != null) totals.netTotal = round2(totals.netTotal + r.values.net);
        if (r.values.adv != null) totals.advTotal = round2(totals.advTotal + r.values.adv);
        if (r.values.ded != null) totals.dedTotal = round2(totals.dedTotal + r.values.ded);

        var displayMatches = [r].concat(matches.filter(function(m) { return m !== r; }));
        if (r.issues.length) return result('DATA NOT VERIFIED', r.issues.join('; '), displayMatches);

        var hasOtherPayOrStat = (r.values.gross != null && r.values.gross > 0) ||
                                (r.values.net != null && r.values.net > 0) ||
                                (r.values.pf != null && r.values.pf > 0) ||
                                (r.values.esic != null && r.values.esic > 0);

        if (matches.length > 1) {
          return result('RECORD FOUND', 'Matched across ' + matches.length + ' sheets/files (consolidated primary + statutory values).', displayMatches);
        }
        if (!Object.prototype.hasOwnProperty.call(r.values, 'manual')) {
          return hasOtherPayOrStat
            ? result('RECORD FOUND', 'Salary & statutory columns matched.', [r])
            : result('MANUAL AMOUNT MISSING', 'Employee row found, but no recognized Manual Amount column exists.', [r]);
        }
        if (r.values.manual === null && !hasOtherPayOrStat) {
          return result('MANUAL AMOUNT MISSING', 'Manual Amount cell is blank or non-numeric; blank is not zero.', [r]);
        }
        if (r.values.manual === 0 && !hasOtherPayOrStat) {
          return result('MANUAL AMOUNT ZERO', 'Manual Amount cell contains numeric zero.', [r]);
        }
        return result('RECORD FOUND', 'Exact Employee record matched.', [r]);
      }

      if (!recognized && unread.length) {
        return result('DATA NOT VERIFIED', 'Could not confidently identify Employee Code header in: ' + unread.join(', '));
      }
      return result('EMPLOYEE CODE NOT FOUND', 'Recognized sheets scanned; Employee Code not present.');
    });

    var finalCode = (masterEmp && masterEmp.code) || discoveredCode || emp;
    var profile = {
      code: finalCode,
      name: (masterEmp && masterEmp.name) || sheetEmpName || '',
      father: (masterEmp && masterEmp.father) || '',
      dept: (masterEmp && masterEmp.dept) || '',
      desig: (masterEmp && masterEmp.desig) || '',
      doj: (masterEmp && masterEmp.doj) || '',
      empStatus: (masterEmp && masterEmp.status) || '',
      pfNo: (masterEmp && masterEmp.pfNo) || sheetPfNo || '',
      pfNoSource: (masterEmp && masterEmp.pfNo) ? 'Employee Master' : (sheetPfNo ? 'Salary Sheet' : ''),
      esicNo: (masterEmp && masterEmp.esicNo) || sheetEsicNo || '',
      esicNoSource: (masterEmp && masterEmp.esicNo) ? 'Employee Master' : (sheetEsicNo ? 'Salary Sheet' : ''),
      masterGross: masterEmp ? masterEmp.gross : null,
      masterBasic: masterEmp ? masterEmp.basic : null,
      inMaster: !!masterEmp
    };

    return {
      employeeCode: finalCode,
      profile: profile,
      filesScanned: indexedFiles.length,
      totals: totals,
      months: monthResults
    };
  }

  function scan(rawQuery) {
    var inputVal = String(rawQuery || '').trim();
    var masterEmp = lookupMasterEmployee(inputVal);
    var fs = getFiles();
    var indexedFiles = new Array(fs.length);
    for (var i = 0; i < fs.length; i++) {
      indexedFiles[i] = getOrBuildFileIndex(fs[i]);
    }
    return finalizeScan(inputVal, masterEmp, indexedFiles);
  }

  function scanAsync(rawQuery, opts) {
    opts = opts || {};
    var inputVal = String(rawQuery || '').trim();
    var masterEmp = lookupMasterEmployee(inputVal);
    var fs = getFiles();
    var token = opts.token;
    var hasTimer = typeof g.setTimeout === 'function';
    var sliceMs = typeof opts.sliceMs === 'number' ? opts.sliceMs : 12;
    var indexedFiles = new Array(fs.length);
    var pos = 0;

    function cancelled() {
      return (typeof opts.isCancelled === 'function' && opts.isCancelled()) ||
             (token != null && token !== activeSearchToken);
    }

    function done(resolve) {
      if (cancelled()) {
        if (typeof opts.onCancel === 'function') opts.onCancel();
        if (resolve) resolve(null);
        return null;
      }
      var res = finalizeScan(inputVal, masterEmp, indexedFiles);
      if (typeof opts.onComplete === 'function') opts.onComplete(res);
      if (resolve) resolve(res);
      return res;
    }

    function step(resolve) {
      if (cancelled()) {
        if (typeof opts.onCancel === 'function') opts.onCancel();
        if (resolve) resolve(null);
        return;
      }
      var t0 = Date.now();
      while (pos < fs.length) {
        var f = fs[pos];
        var wasCached = !!getCachedFileIndex(f);
        indexedFiles[pos] = getOrBuildFileIndex(f);
        pos++;
        if (pos < fs.length && hasTimer) {
          var elapsed = Date.now() - t0;
          if (!wasCached && (opts.yieldPerUncachedFile || elapsed >= sliceMs)) {
            if (typeof opts.onProgress === 'function') {
              opts.onProgress({
                done: pos,
                total: fs.length,
                fileName: (f && (f.name || f.filename || f.id)) || ''
              });
            }
            g.setTimeout(function() { step(resolve); }, 0);
            return;
          }
        }
      }
      done(resolve);
    }

    if (typeof Promise === 'function') {
      return new Promise(function(resolve) {
        if (opts.deferStart && hasTimer && fs.length > 0 && !allFilesCached(fs)) {
          g.setTimeout(function() { step(resolve); }, 0);
        } else {
          step(resolve);
        }
      });
    }

    step(null);
    return pos === fs.length ? finalizeScan(inputVal, masterEmp, indexedFiles) : null;
  }

  function warmCacheInBackground() {
    if (typeof g.setTimeout !== 'function' || warmRunning || scanInProgress) return;
    var fs = getFiles();
    if (!fs.length || allFilesCached(fs)) return;
    var idx = 0;
    warmRunning = true;
    function warmStep() {
      if (scanInProgress) {
        warmRunning = false;
        return;
      }
      while (idx < fs.length && getCachedFileIndex(fs[idx])) {
        idx++;
      }
      if (idx >= fs.length) {
        warmRunning = false;
        return;
      }
      getOrBuildFileIndex(fs[idx]);
      idx++;
      g.setTimeout(warmStep, 20);
    }
    g.setTimeout(warmStep, 40);
  }

  function label(p) {
    if (p === 'UNDATED') return 'Other / Undated';
    var a = p.split('-');
    return (M[+a[1] - 1] || p) + ' ' + (a[0] || '');
  }

  function delta(a, b, k) {
    var x = a && a.records && a.records[0] && a.records[0].values[k];
    var y = b && b.records && b.records[0] && b.records[0].values[k];
    if (x == null || y == null) return 'Unavailable';
    var d = x - y;
    var pc = y ? (d / Math.abs(y) * 100) : null;
    return (d > 0 ? '+' : '') + money(d) + (pc == null ? '' : ' (' + (pc > 0 ? '+' : '') + pc.toFixed(1) + '%)');
  }

  function copyVal(text, labelName) {
    if (!text) return;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text);
      }
    } catch (_) {}
    if (g.showToast) g.showToast('Copied ' + labelName + ': ' + text);
  }

  function statusMeta(st) {
    if (st === 'RECORD FOUND') return { text: 'Verified', color: '#15803d', bg: '#f0fdf4' };
    if (st === 'MANUAL AMOUNT ZERO') return { text: 'Zero Pay', color: '#b45309', bg: '#fffbeb' };
    if (st === 'MANUAL AMOUNT MISSING') return { text: 'Manual Missing', color: '#b45309', bg: '#fffbeb' };
    if (st === 'DATA NOT VERIFIED') return { text: 'Check Source', color: '#dc2626', bg: '#fef2f2' };
    if (st === 'EMPLOYEE CODE NOT FOUND') return { text: 'Not in Sheet', color: '#64748b', bg: '#f8fafc' };
    return { text: 'No File', color: '#94a3b8', bg: '#f8fafc' };
  }

  function exportCSV() {
    if (!S.result || !S.result.months || !S.result.months.length) return;
    var r = S.result;
    var headers = ['Emp Code', 'Employee Name', 'PF / UAN No', 'ESIC No', 'Month', 'Status', 'Manual Amt', 'Gross Salary', 'Basic', 'HRA', 'Employee PF Cut', 'Employee ESIC Cut', 'Advance Ded', 'Other Ded', 'Net Payable', 'File Name', 'Sheet Name', 'Row'];
    var rows = r.months.map(function(m) {
      var x = m.records && m.records[0];
      var v = x ? x.values : {};
      return [
        r.employeeCode,
        '"' + (r.profile.name || '').replace(/"/g, '""') + '"',
        '"' + ((v.pfno || r.profile.pfNo || '').replace(/"/g, '""')) + '"',
        '"' + ((v.esicno || r.profile.esicNo || '').replace(/"/g, '""')) + '"',
        label(m.period),
        m.status,
        v.manual != null ? v.manual : '',
        v.gross != null ? v.gross : '',
        v.basic != null ? v.basic : '',
        v.hra != null ? v.hra : '',
        v.pf != null ? v.pf : '',
        v.esic != null ? v.esic : '',
        v.adv != null ? v.adv : '',
        v.ded != null ? v.ded : '',
        v.net != null ? v.net : '',
        '"' + ((x ? x.file : (m.files || []).join(' | ')) || '').replace(/"/g, '""') + '"',
        '"' + ((x && x.sheet) || '').replace(/"/g, '""') + '"',
        x ? x.row : ''
      ].join(',');
    });
    var csv = 'data:text/csv;charset=utf-8,' + [headers.join(',')].concat(rows).join('\n');
    var a = document.createElement('a');
    a.href = encodeURI(csv);
    a.download = 'ATPL_Service_History_' + (r.employeeCode || 'emp') + '_' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  function render() {
    var host = $('results');
    if (!host) return;
    var r = S.result;
    if (!r) {
      var masterList = getMasterList(); var emSample = []; for (var mi = 0; mi < masterList.length && emSample.length < 5; mi++) { if (masterList[mi] && (masterList[mi].emp_id || masterList[mi].code)) emSample.push(masterList[mi]); }
      var emptyHtml = '<div class="sh-empty-panel">';
      emptyHtml += '  <div class="sh-empty-title">Search an employee to inspect PF/ESIC numbers &amp; monthly deductions</div>';
      emptyHtml += '  <div class="sh-empty-sub">Employee Code ya Name daalein — Employee Master aur sabhi uploaded salary sheets se PF No, ESIC No, PF cut, ESIC cut aur monthly payout automatic calculate hoga.</div>';
      if (emSample.length) {
        emptyHtml += '  <div class="sh-quick-picks"><span class="sh-qp-lbl">Quick lookup:</span>';
        emSample.forEach(function(e) {
          var c = String(e.emp_id || e.code || '').trim();
          var nm = String(e.name || '').trim();
          emptyHtml += '<button type="button" class="sh-qp-btn" data-qp="' + esc(c) + '">' + esc(c) + (nm ? ' · ' + esc(nm) : '') + '</button>';
        });
        emptyHtml += '  </div>';
      }
      emptyHtml += '</div>';
      host.innerHTML = emptyHtml;
      host.querySelectorAll('[data-qp]').forEach(function(btn) {
        btn.onclick = function() {
          var inp = $('code');
          if (inp) inp.value = btn.getAttribute('data-qp');
          search();
        };
      });
      return;
    }

    var p = r.profile || {};
    var t = r.totals || {};

    var h = '';

    var metaBits = [];
    if (p.father) metaBits.push('S/o ' + p.father);
    if (p.dept) metaBits.push(p.dept);
    if (p.desig) metaBits.push(p.desig);
    if (p.doj) metaBits.push('DOJ: ' + p.doj);
    if (p.empStatus) metaBits.push(p.empStatus);

    h += '<section class="sh-profile">';
    h += '  <div class="sh-profile-top">';
    h += '    <div>';
    h += '      <div class="sh-name-row"><h2 class="sh-emp-name">' + esc(p.name || 'Employee #' + r.employeeCode) + '</h2><span class="sh-emp-code">#' + esc(r.employeeCode) + '</span></div>';
    h += '      <div class="sh-meta-line">' + esc(metaBits.join(' · ') || (p.inMaster ? 'Employee Master linked' : 'Matched from uploaded salary sheets')) + '</div>';
    h += '    </div>';
    h += '    <button type="button" id="atpl-sh-export" class="sh-btn-secondary">Export CSV</button>';
    h += '  </div>';

    h += '  <div class="sh-statutory-grid">';
    h += '    <div class="sh-stat-cell">';
    h += '      <span class="sh-lbl">PF / UAN Number</span>';
    h += '      <div class="sh-stat-val-row"><strong class="tabular">' + esc(p.pfNo || 'Not Available') + '</strong>' + (p.pfNo ? '<button type="button" class="sh-copy-btn" data-copy="' + esc(p.pfNo) + '" data-label="PF / UAN">Copy</button>' : '') + '</div>';
    h += '      <small class="sh-sub-hint">' + esc(p.pfNoSource ? 'Source: ' + p.pfNoSource : 'Not found in Master or sheets') + '</small>';
    h += '    </div>';

    h += '    <div class="sh-stat-cell">';
    h += '      <span class="sh-lbl">ESIC / IP Number</span>';
    h += '      <div class="sh-stat-val-row"><strong class="tabular">' + esc(p.esicNo || 'Not Available') + '</strong>' + (p.esicNo ? '<button type="button" class="sh-copy-btn" data-copy="' + esc(p.esicNo) + '" data-label="ESIC No">Copy</button>' : '') + '</div>';
    h += '      <small class="sh-sub-hint">' + esc(p.esicNoSource ? 'Source: ' + p.esicNoSource : 'Not found in Master or sheets') + '</small>';
    h += '    </div>';

    h += '    <div class="sh-stat-cell">';
    h += '      <span class="sh-lbl">Master Gross / Basic</span>';
    h += '      <div class="sh-stat-val-row"><strong class="tabular">' + (p.masterGross != null ? money(p.masterGross) : '—') + (p.masterBasic != null ? ' / ' + money(p.masterBasic) : '') + '</strong></div>';
    h += '      <small class="sh-sub-hint">Files scanned: <span class="tabular">' + r.filesScanned + '</span> · Active months: <span class="tabular">' + (t.monthsFound || 0) + '</span></small>';
    h += '    </div>';
    h += '  </div>';
    h += '</section>';

    h += '<section class="sh-kpi-grid">';
    h += '  <div class="sh-kpi"><span class="sh-lbl">Total PF Deducted (Emp)</span><b class="tabular sh-kpi-pf">' + money(t.pfTotal || 0) + '</b><small class="sh-sub-hint">' + (t.pfMonths || 0) + ' months deducted</small></div>';
    h += '  <div class="sh-kpi"><span class="sh-lbl">Total ESIC Deducted (Emp)</span><b class="tabular sh-kpi-esic">' + money(t.esicTotal || 0) + '</b><small class="sh-sub-hint">' + (t.esicMonths || 0) + ' months deducted</small></div>';
    h += '  <div class="sh-kpi"><span class="sh-lbl">Total Gross / Net Paid</span><b class="tabular">' + money(t.grossTotal || 0) + '</b><small class="sh-sub-hint">Net: ' + money(t.netTotal || 0) + '</small></div>';
    h += '  <div class="sh-kpi"><span class="sh-lbl">Total Manual Amount</span><b class="tabular">' + money(t.manualTotal || 0) + '</b><small class="sh-sub-hint">Adv Ded: ' + money(t.advTotal || 0) + '</small></div>';
    h += '</section>';

    var foundCount = r.months.filter(function(m) { return m.records && m.records.length > 0; }).length;
    var statCount = r.months.filter(function(m) {
      var x = m.records && m.records[0];
      return x && ((x.values.pf != null && x.values.pf > 0) || (x.values.esic != null && x.values.esic > 0));
    }).length;
    var missCount = r.months.length - foundCount;

    var visibleMonths = r.months.filter(function(m) {
      var x = m.records && m.records[0];
      if (S.filter === 'found') return !!(x);
      if (S.filter === 'statutory') return !!(x && ((x.values.pf != null && x.values.pf > 0) || (x.values.esic != null && x.values.esic > 0)));
      if (S.filter === 'missing') return !x;
      return true;
    });

    h += '<section class="sh-ledger-card">';
    h += '  <div class="sh-ledger-bar">';
    h += '    <div>';
    h += '      <div class="sh-ledger-title">Month-Wise Salary &amp; PF / ESIC Deduction Ledger</div>';
    h += '      <div class="sh-ledger-sub">Har mahine ka PF cut, ESIC cut, Gross, Manual aur Net Pay — click "Details" for sheet proof &amp; month-over-month change</div>';
    h += '    </div>';
    h += '    <div class="sh-seg" role="tablist">';
    h += '      <button type="button" data-filter="all" class="' + (S.filter === 'all' ? 'active' : '') + '">All Months (' + r.months.length + ')</button>';
    h += '      <button type="button" data-filter="found" class="' + (S.filter === 'found' ? 'active' : '') + '">Found (' + foundCount + ')</button>';
    h += '      <button type="button" data-filter="statutory" class="' + (S.filter === 'statutory' ? 'active' : '') + '">PF / ESIC Cut (' + statCount + ')</button>';
    h += '      <button type="button" data-filter="missing" class="' + (S.filter === 'missing' ? 'active' : '') + '">Missing (' + missCount + ')</button>';
    h += '    </div>';
    h += '  </div>';

    if (!visibleMonths.length) {
      h += '<div class="sh-no-rows">Is filter ke liye koi month entry nahi mili. Upar "All Months" select karein.</div>';
    } else {
      h += '<div class="sh-tbl-wrap">';
      h += '<table class="sh-table">';
      h += '  <thead><tr>';
      h += '    <th>Month</th>';
      h += '    <th>Status</th>';
      h += '    <th class="num">Manual (₹)</th>';
      h += '    <th class="num">Gross (₹)</th>';
      h += '    <th class="num">PF Cut (₹)</th>';
      h += '    <th class="num">ESIC Cut (₹)</th>';
      h += '    <th class="num">Net Pay (₹)</th>';
      h += '    <th>Source File</th>';
      h += '    <th class="act">Details</th>';
      h += '  </tr></thead>';
      h += '  <tbody>';

      visibleMonths.forEach(function(m) {
        var origIdx = r.months.indexOf(m);
        var x = m.records && m.records[0];
        var v = x ? x.values : {};
        var open = !!S.expanded[m.period];
        var sm = statusMeta(m.status);
        var fileTxt = x ? x.file : ((m.files && m.files[0]) || '—');

        h += '<tr class="sh-row' + (open ? ' is-open' : '') + '">';
        h += '  <td class="sh-mcell"><strong>' + esc(label(m.period)) + '</strong></td>';
        h += '  <td><span class="sh-st" style="color:' + sm.color + '">' + esc(sm.text) + '</span></td>';
        h += '  <td class="num tabular"><strong>' + (x ? money(v.manual) : '—') + '</strong></td>';
        h += '  <td class="num tabular">' + (x ? money(v.gross) : '—') + '</td>';
        h += '  <td class="num tabular sh-pf-num">' + (x ? money(v.pf) : '—') + '</td>';
        h += '  <td class="num tabular sh-esic-num">' + (x ? money(v.esic) : '—') + '</td>';
        h += '  <td class="num tabular">' + (x ? money(v.net) : '—') + '</td>';
        h += '  <td class="sh-fcell" title="' + esc((m.files || []).join(', ')) + '">' + esc(fileTxt) + '</td>';
        h += '  <td class="act"><button type="button" class="sh-det-btn" data-expand="' + esc(m.period) + '">' + (open ? 'Hide' : 'Details') + '</button></td>';
        h += '</tr>';

        if (open) {
          h += '<tr class="sh-detail-row"><td colspan="9">';
          h += '  <div class="sh-detail-box">';
          if (!x) {
            h += '    <div class="sh-detail-reason"><strong>Reason:</strong> ' + esc(m.reason) + (m.files && m.files.length ? ' · <strong>Files checked:</strong> ' + esc(m.files.join(', ')) : '') + '</div>';
          } else {
            h += '    <div class="sh-fields">';
            [
              ['Manual Amount', v.manual, 'money'],
              ['Gross Salary', v.gross, 'money'],
              ['Basic', v.basic, 'money'],
              ['HRA', v.hra, 'money'],
              ['Employee PF Cut', v.pf, 'money'],
              ['Employee ESIC Cut', v.esic, 'money'],
              ['Advance Ded', v.adv, 'money'],
              ['Other Earnings', v.earn, 'money'],
              ['Other Deductions', v.ded, 'money'],
              ['Net Payable', v.net, 'money']
            ].forEach(function(item) {
              var valStr = item[2] === 'money' ? money(item[1]) : esc(item[1] || '—');
              h += '<div class="sh-fitem"><small>' + item[0] + '</small><b class="tabular">' + valStr + '</b></div>';
            });
            h += '    </div>';
            var mergedNote = (x.mergedFrom && x.mergedFrom.length) ? (' · Merged fields from: ' + x.mergedFrom.join(', ')) : '';
            h += '    <div class="sh-source"><strong>Source Verification:</strong> Original file: <span>' + esc(x.file) + '</span> · Sheet: <span>' + esc(x.sheet) + '</span> · Row: <span class="tabular">' + x.row + '</span> · Code: <span class="tabular">' + esc(x.code) + '</span>' + esc(mergedNote) + '<br><span class="sh-cols-line">Matched columns: ' + esc(Object.keys(x.headers).map(function(k) { return k + ' = ' + x.headers[k]; }).join(' · ')) + '</span></div>';

            if (origIdx > 0 && r.months[origIdx - 1] && r.months[origIdx - 1].records && r.months[origIdx - 1].records[0]) {
              var prevM = r.months[origIdx - 1];
              h += '    <div class="sh-delta"><strong>vs ' + esc(label(prevM.period)) + ':</strong> ';
              ['manual', 'gross', 'basic', 'pf', 'esic', 'net'].forEach(function(k) {
                h += '<span class="tabular">' + k.toUpperCase() + ': ' + esc(delta(m, prevM, k)) + '</span>';
              });
              h += '    </div>';
            }
          }
          h += '  </div>';
          h += '</td></tr>';
        }
      });

      h += '  </tbody>';
      h += '</table>';
      h += '</div>';
    }
    h += '</section>';

    host.innerHTML = h;

    host.querySelectorAll('[data-expand]').forEach(function(b) {
      b.onclick = function() {
        var per = b.getAttribute('data-expand');
        S.expanded[per] = !S.expanded[per];
        render();
      };
    });
    host.querySelectorAll('[data-filter]').forEach(function(b) {
      b.onclick = function() {
        S.filter = b.getAttribute('data-filter') || 'all';
        render();
      };
    });
    host.querySelectorAll('[data-copy]').forEach(function(b) {
      b.onclick = function() {
        copyVal(b.getAttribute('data-copy'), b.getAttribute('data-label'));
      };
    });
    var expBtn = document.getElementById('atpl-sh-export');
    if (expBtn) expBtn.onclick = exportCSV;
  }

  function updateAutocomplete(val) {
    var box = $('suggest');
    if (!box) return;
    var q = String(val || '').trim().toLowerCase();
    if (!q) {
      box.style.display = 'none';
      box.innerHTML = '';
      return;
    }
    var entries = getMasterIndex().entries;
    var hits = [];
    for (var i = 0; i < entries.length && hits.length < 7; i++) {
      var item = entries[i];
      if (item.searchLower.indexOf(q) >= 0) {
        hits.push(item);
      }
    }
    if (!hits.length) {
      box.style.display = 'none';
      return;
    }
    box.innerHTML = hits.map(function(item) {
      var stat = [];
      if (item.pf) stat.push('PF: ' + esc(item.pf));
      if (item.es) stat.push('ESIC: ' + esc(item.es));
      return '<div class="sh-sugg-item" data-code="' + esc(item.code) + '">' +
        '<div><strong class="tabular">' + esc(item.code) + '</strong> <span class="sh-sugg-name">' + esc(item.name) + '</span>' + (item.dept ? ' <span class="sh-sugg-dept">' + esc(item.dept) + '</span>' : '') + '</div>' +
        '<div class="sh-sugg-stat tabular">' + (stat.join(' · ') || 'No PF/ESIC in Master') + '</div>' +
        '</div>';
    }).join('');
    box.style.display = 'block';
    box.querySelectorAll('.sh-sugg-item').forEach(function(el) {
      el.onclick = function() {
        var inp = $('code');
        if (inp) inp.value = el.getAttribute('data-code');
        box.style.display = 'none';
        search();
      };
    });
  }

  function renderScanningState(done, total, fileName) {
    var notice = $('notice');
    var host = $('results');
    var pct = total > 0 ? Math.round((done / total) * 100) : 0;
    if (notice) {
      notice.textContent = 'Scanning salary workbooks (' + done + ' / ' + total + ' files)...';
    }
    if (host) {
      host.innerHTML =
        '<div class="sh-empty-panel">' +
        '  <div class="sh-empty-title">Scanning Salary Workbooks &amp; PF / ESIC Ledger…</div>' +
        '  <div class="sh-empty-sub">' + esc(fileName ? ('Reading: ' + fileName) : 'Building search index…') + ' (' + done + ' / ' + total + ' files · ' + pct + '%)</div>' +
        '</div>';
    }
  }

  function applySearchResult(res) {
    S.result = res;
    S.expanded = {};
    S.filter = 'all';
    render();
    if ($('notice')) {
      var p = (res && res.profile) || {};
      $('notice').textContent = 'Read-only scan complete for ' + (p.name ? (p.name + ' (' + res.employeeCode + ')') : (res ? res.employeeCode : '')) + '. No source file was modified.';
    }
  }

  function search() {
    var inp = $('code');
    var v = inp ? inp.value.trim() : '';
    var box = $('suggest');
    if (box) box.style.display = 'none';
    if (!v) {
      if ($('notice')) $('notice').textContent = 'Enter an Employee Code, Name, PF No, or ESIC No.';
      return;
    }

    var token = ++activeSearchToken;
    var fs = getFiles();
    if (allFilesCached(fs) || typeof g.setTimeout !== 'function') {
      scanInProgress = false;
      applySearchResult(scan(v));
      return;
    }

    scanInProgress = true;
    var firstFile = fs[0] && (fs[0].name || fs[0].filename || fs[0].id || '');
    renderScanningState(0, fs.length, firstFile);
    scanAsync(v, {
      token: token,
      deferStart: true,
      sliceMs: 12,
      onProgress: function(prog) {
        if (token !== activeSearchToken) return;
        renderScanningState(prog.done, prog.total, prog.fileName);
      },
      onComplete: function(res) {
        if (token !== activeSearchToken) return;
        scanInProgress = false;
        applySearchResult(res);
      },
      onCancel: function() {
        if (token === activeSearchToken) scanInProgress = false;
      }
    });
  }

  function allowed() {
    var s = null, u = [];
    try {
      s = JSON.parse(g.sessionStorage.getItem('ATPL_UserSession_V5') || g.localStorage.getItem('ATPL_UserSession_V5') || 'null');
      u = JSON.parse(g.localStorage.getItem('ATPL_UserAccess_V1') || '[]');
    } catch (e) {}
    var a = s && u.find(function(x) { return String(x.id).toLowerCase() === String(s.id).toLowerCase(); });
    if (a && !a.admin && !(a.access || []).includes('servicehistory') && !(a.access || []).includes('*')) {
      alert('Service History access has not been granted.');
      return false;
    }
    return true;
  }

  function mount() {
    if (!document.getElementById(P)) {
      var p = document.createElement('section');
      p.id = P;
      p.className = 'page';
      p.innerHTML =
        '<div class="sh-app">' +
        '  <header class="sh-hero">' +
        '    <div class="sh-hero-txt">' +
        '      <h1>Employee Service History &amp; PF / ESIC Ledger</h1>' +
        '      <p>Read-only statutory profile (PF / UAN, ESIC No) &amp; month-wise salary deductions across all saved sheets.</p>' +
        '    </div>' +
        '    <button type="button" id="atpl-sh-back">Back to Command Center</button>' +
        '  </header>' +
        '  <div class="sh-search">' +
        '    <div class="sh-search-field">' +
        '      <label for="atpl-sh-code">Employee Code, Name, PF No, or ESIC No</label>' +
        '      <input id="atpl-sh-code" type="text" autocomplete="off" placeholder="Type Emp Code (e.g. 25924) or Name...">' +
        '      <div id="atpl-sh-suggest" class="sh-suggest" style="display:none"></div>' +
        '    </div>' +
        '    <button type="button" id="atpl-sh-search">Search Employee</button>' +
        '  </div>' +
        '  <div id="atpl-sh-notice">Read-only verification mode. Source workbooks are never altered.</div>' +
        '  <div id="atpl-sh-results"></div>' +
        '  <footer>ATPL HR Payroll Suite · Read-Only Service History &amp; Statutory Audit</footer>' +
        '</div>';
      var anchor = document.getElementById('page-sync') || document.querySelector('.page');
      if (anchor && anchor.parentNode) anchor.parentNode.appendChild(p);
    }

    if (!document.getElementById('atpl-sh-style')) {
      var s = document.createElement('style');
      s.id = 'atpl-sh-style';
      s.textContent = [
        '#page-servicehistory{font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f8fafc;min-height:100%;color:#0f172a}',
        '#page-servicehistory .tabular{font-variant-numeric:tabular-nums}',
        '#page-servicehistory .sh-app{max-width:1280px;margin:0 auto;padding:24px 24px 48px}',
        '#page-servicehistory .sh-hero{display:flex;justify-content:space-between;align-items:center;gap:16px;padding-bottom:18px;border-bottom:1px solid #e2e8f0}',
        '#page-servicehistory .sh-hero h1{margin:0;font-size:22px;font-weight:700;color:#0f172a;letter-spacing:-0.3px}',
        '#page-servicehistory .sh-hero p{margin:4px 0 0;font-size:13px;color:#64748b}',
        '#page-servicehistory button{font-family:inherit;min-height:40px;padding:0 16px;border-radius:8px;border:1px solid #cbd5e1;background:#ffffff;font-weight:600;font-size:13px;cursor:pointer;color:#334155;white-space:nowrap;flex-shrink:0;transition:background .15s,border-color .15s,color .15s}',
        '#page-servicehistory button:hover{border-color:#94a3b8;background:#f8fafc;color:#0f172a}',
        '#page-servicehistory button:focus-visible,#page-servicehistory input:focus-visible{outline:2px solid #4338ca;outline-offset:2px}',
        '#page-servicehistory .sh-search{display:flex;align-items:flex-end;gap:12px;background:#ffffff;padding:18px 20px;margin:16px 0 12px;border:1px solid #e2e8f0;border-radius:12px}',
        '#page-servicehistory .sh-search-field{position:relative;flex:1;min-width:260px}',
        '#page-servicehistory .sh-search-field label{display:block;font-size:12px;font-weight:600;color:#475569;margin-bottom:6px}',
        '#page-servicehistory .sh-search-field input{box-sizing:border-box;width:100%;height:42px;padding:0 14px;border:1px solid #cbd5e1;border-radius:8px;background:#ffffff;font-size:14px;color:#0f172a;outline:none}',
        '#page-servicehistory #atpl-sh-search{background:#312e81;color:#ffffff;border-color:#312e81;height:42px;padding:0 22px}',
        '#page-servicehistory #atpl-sh-search:hover{background:#3730a3;border-color:#3730a3;color:#ffffff}',
        '#page-servicehistory .sh-suggest{position:absolute;top:100%;left:0;right:0;margin-top:4px;background:#ffffff;border:1px solid #cbd5e1;border-radius:10px;box-shadow:0 12px 28px rgba(15,23,42,0.12);z-index:50;max-height:260px;overflow-y:auto}',
        '#page-servicehistory .sh-sugg-item{padding:10px 14px;border-bottom:1px solid #f1f5f9;display:flex;justify-content:space-between;align-items:center;gap:12px;cursor:pointer;font-size:13px}',
        '#page-servicehistory .sh-sugg-item:last-child{border-bottom:0}',
        '#page-servicehistory .sh-sugg-item:hover{background:#f8fafc}',
        '#page-servicehistory .sh-sugg-name{font-weight:600;color:#0f172a;margin-left:6px}',
        '#page-servicehistory .sh-sugg-dept{font-size:12px;color:#64748b;margin-left:6px}',
        '#page-servicehistory .sh-sugg-stat{font-size:12px;color:#475569;white-space:nowrap}',
        '#page-servicehistory #atpl-sh-notice{padding:10px 14px;background:#ffffff;color:#475569;border:1px solid #e2e8f0;border-radius:10px;font-size:12.5px;margin-bottom:16px}',
        '#page-servicehistory .sh-empty-panel{background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;padding:36px 24px;text-align:center}',
        '#page-servicehistory .sh-empty-title{font-size:16px;font-weight:700;color:#0f172a}',
        '#page-servicehistory .sh-empty-sub{font-size:13px;color:#64748b;margin:6px auto 0;max-width:620px;line-height:1.6}',
        '#page-servicehistory .sh-quick-picks{margin-top:18px;display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:8px}',
        '#page-servicehistory .sh-qp-lbl{font-size:12px;color:#64748b;font-weight:600}',
        '#page-servicehistory .sh-qp-btn{padding:6px 12px;min-height:34px;font-size:12px}',
        '#page-servicehistory .sh-profile{background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;margin-bottom:16px;overflow:hidden}',
        '#page-servicehistory .sh-profile-top{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;padding:18px 22px;border-bottom:1px solid #f1f5f9}',
        '#page-servicehistory .sh-name-row{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}',
        '#page-servicehistory .sh-emp-name{margin:0;font-size:20px;font-weight:700;color:#0f172a;letter-spacing:-0.3px}',
        '#page-servicehistory .sh-emp-code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:14px;font-weight:700;color:#4338ca}',
        '#page-servicehistory .sh-meta-line{margin-top:4px;font-size:12.5px;color:#64748b}',
        '#page-servicehistory .sh-btn-secondary{padding:8px 14px;min-height:36px;font-size:12.5px}',
        '#page-servicehistory .sh-statutory-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:0}',
        '#page-servicehistory .sh-stat-cell{padding:16px 22px;border-right:1px solid #f1f5f9}',
        '#page-servicehistory .sh-stat-cell:last-child{border-right:0}',
        '#page-servicehistory .sh-lbl{display:block;font-size:12px;font-weight:600;color:#64748b;margin-bottom:4px}',
        '#page-servicehistory .sh-stat-val-row{display:flex;align-items:center;justify-content:space-between;gap:10px}',
        '#page-servicehistory .sh-stat-val-row strong{font-size:16px;font-weight:700;color:#0f172a;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}',
        '#page-servicehistory .sh-copy-btn{padding:3px 9px;min-height:26px;font-size:11.5px;border-radius:6px}',
        '#page-servicehistory .sh-sub-hint{display:block;margin-top:4px;font-size:12px;color:#64748b}',
        '#page-servicehistory .sh-kpi-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:16px}',
        '#page-servicehistory .sh-kpi{background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;padding:16px 18px}',
        '#page-servicehistory .sh-kpi b{display:block;font-size:22px;font-weight:700;color:#0f172a;margin:4px 0 2px;line-height:1.25}',
        '#page-servicehistory .sh-kpi .sh-kpi-pf{color:#312e81}',
        '#page-servicehistory .sh-kpi .sh-kpi-esic{color:#0f766e}',
        '#page-servicehistory .sh-ledger-card{background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden}',
        '#page-servicehistory .sh-ledger-bar{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;padding:16px 20px;border-bottom:1px solid #e2e8f0}',
        '#page-servicehistory .sh-ledger-title{font-size:15px;font-weight:700;color:#0f172a}',
        '#page-servicehistory .sh-ledger-sub{font-size:12px;color:#64748b;margin-top:2px}',
        '#page-servicehistory .sh-seg{display:inline-flex;gap:4px;padding:4px;background:#f1f5f9;border-radius:9px;flex-wrap:wrap}',
        '#page-servicehistory .sh-seg button{min-height:32px;padding:6px 12px;border:0;background:transparent;color:#475569;font-size:12px;font-weight:600;border-radius:6px}',
        '#page-servicehistory .sh-seg button.active{background:#ffffff;color:#0f172a;box-shadow:0 1px 2px rgba(15,23,42,0.08)}',
        '#page-servicehistory .sh-tbl-wrap{overflow-x:auto}',
        '#page-servicehistory .sh-table{width:100%;border-collapse:collapse;font-size:13px;text-align:left}',
        '#page-servicehistory .sh-table th{padding:11px 14px;background:#f8fafc!important;border-bottom:1px solid #e2e8f0!important;font-size:12px!important;font-weight:600!important;color:#475569!important;white-space:nowrap}',
        '#page-servicehistory .sh-table td{padding:11px 14px;border-bottom:1px solid #f1f5f9!important;color:#0f172a;vertical-align:middle}',
        '#page-servicehistory .sh-table th.num,#page-servicehistory .sh-table td.num{text-align:right;white-space:nowrap}',
        '#page-servicehistory .sh-table th.act,#page-servicehistory .sh-table td.act{text-align:center;white-space:nowrap}',
        '#page-servicehistory .sh-row:hover td{background:#f8fafc}',
        '#page-servicehistory .sh-row.is-open td{background:#f8fafc}',
        '#page-servicehistory .sh-st{font-size:12px;font-weight:600;white-space:nowrap}',
        '#page-servicehistory .sh-pf-num{color:#312e81;font-weight:600}',
        '#page-servicehistory .sh-esic-num{color:#0f766e;font-weight:600}',
        '#page-servicehistory .sh-fcell{max-width:210px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:#64748b}',
        '#page-servicehistory .sh-det-btn{min-height:30px;padding:4px 12px;font-size:12px}',
        '#page-servicehistory .sh-detail-row td{padding:0!important;background:#f8fafc!important;border-bottom:1px solid #e2e8f0!important}',
        '#page-servicehistory .sh-detail-box{padding:16px 20px}',
        '#page-servicehistory .sh-detail-reason{font-size:13px;color:#475569}',
        '#page-servicehistory .sh-fields{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px;margin-bottom:12px}',
        '#page-servicehistory .sh-fitem{background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;padding:10px 12px}',
        '#page-servicehistory .sh-fitem small{display:block;font-size:11.5px;color:#64748b;font-weight:600}',
        '#page-servicehistory .sh-fitem b{display:block;margin-top:4px;font-size:13.5px;color:#0f172a;font-weight:700}',
        '#page-servicehistory .sh-source{font-size:12px;color:#475569;line-height:1.7;padding-top:10px;border-top:1px solid #e2e8f0}',
        '#page-servicehistory .sh-source strong{color:#0f172a}',
        '#page-servicehistory .sh-cols-line{color:#64748b}',
        '#page-servicehistory .sh-delta{display:flex;flex-wrap:wrap;gap:8px 16px;margin-top:10px;padding-top:10px;border-top:1px dashed #cbd5e1;font-size:12px;color:#475569}',
        '#page-servicehistory .sh-no-rows{padding:36px 20px;text-align:center;color:#64748b;font-size:13px}',
        '#page-servicehistory footer{text-align:center;color:#94a3b8;font-size:11px;padding:24px 8px 8px}',
        '@media(max-width:1024px){#page-servicehistory .sh-kpi-grid{grid-template-columns:repeat(2,minmax(0,1fr))}#page-servicehistory .sh-fields{grid-template-columns:repeat(3,minmax(0,1fr))}}',
        '@media(max-width:720px){#page-servicehistory .sh-app{padding:16px}#page-servicehistory .sh-hero{flex-direction:column;align-items:flex-start}#page-servicehistory .sh-search{flex-direction:column;align-items:stretch}#page-servicehistory .sh-statutory-grid{grid-template-columns:1fr}#page-servicehistory .sh-stat-cell{border-right:0;border-bottom:1px solid #f1f5f9}#page-servicehistory .sh-stat-cell:last-child{border-bottom:0}#page-servicehistory .sh-kpi-grid{grid-template-columns:1fr}#page-servicehistory .sh-fields{grid-template-columns:repeat(2,minmax(0,1fr))}}'
      ].join('\n');
      document.head.appendChild(s);
    }

    var sub = document.getElementById('vn-empmaster') || document.getElementById('vn-hrdocs');
    sub = (sub && sub.parentNode) || document.getElementById('cat-emp') || document.getElementById('cat-tools');
    if (sub && !document.getElementById(N)) {
      var n = document.createElement('div');
      n.id = N;
      n.className = 'vitem';
      n.innerHTML = '<span class="vi">📚</span>SERVICE HISTORY';
      n.onclick = function() {
        if (allowed()) {
          g.goPage('servicehistory');
          if (!S.result) render();
          warmCacheInBackground();
        }
      };
      sub.appendChild(n);
    }

    var b = $('search');
    var c = $('code');
    var back = $('back');
    if (b) b.onclick = search;
    if (c) {
      var suggestTimer = null;
      c.oninput = function() {
        if (typeof g.setTimeout !== 'function') { updateAutocomplete(c.value); return; }
        if (typeof g.clearTimeout === 'function' && suggestTimer) g.clearTimeout(suggestTimer);
        suggestTimer = g.setTimeout(function() { suggestTimer = null; updateAutocomplete(c.value); }, 60);
      };
      c.onkeydown = function(e) { if (e.key === 'Enter') search(); };
    }
    if (back) back.onclick = function() { g.goPage('cmd'); };
    if (!S.result) render();
  }

  function boot() {
    mount();
    if (typeof setInterval === 'function') {
      var count = 0;
      var t = setInterval(function() {
        if (document.getElementById(N) || ++count > 25) {
          if (typeof clearInterval === 'function') clearInterval(t);
          return;
        }
        mount();
      }, 300);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }

  g.ATPLServiceHistoryV1 = { scan: scan, scanAsync: scanAsync, lookupMasterEmployee: lookupMasterEmployee, warmCache: warmCacheInBackground, version: '2.2.0' };
})(window);
