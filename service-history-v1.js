(function(g) {
  'use strict';
  if (!g || g.__ATPL_SERVICE_HISTORY_V1__ === '2.0.0') return;
  g.__ATPL_SERVICE_HISTORY_V1__ = '2.0.0';

  var P = 'page-servicehistory';
  var N = 'atpl-sh-nav';
  var M = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  // Normalized header aliases (all lowercase alphanumeric space-separated to match norm())
  var A = {
    code: ['employee code', 'emp code', 'employee id', 'emp id', 'code', 'employee no', 'emp no', 'staff code', 'worker code', 'card no', 'token no'],
    manual: ['manual amount', 'manual amt', 'mam amount', 'manual salary', 'manual net', 'actual paid'],
    gross: ['gross salary', 'gross total salary', 'gross', 'total gross salary', 'gross amount', 'gross wages', 'total earning', 'total earnings', 'gross pay'],
    basic: ['basic salary', 'basic wages', 'basic pay', 'basic'],
    hra: ['hra', 'house rent allowance', 'hra allowance'],
    pf: [
      'employee pf', 'emp pf', 'pf employee', 'pf deduction', 'pf ded', 'pf 12', 'pf 12 0',
      'pf amt', 'pf amount', 'epf', 'epf 12', 'epf deduction', 'epf employee', 'provident fund', 'pf'
    ],
    esic: [
      'employee esic', 'emp esic', 'esic employee', 'esic deduction', 'esic ded',
      'esic 0 75', 'esic 075', 'esic 75', 'esi 0 75', 'esi 075',
      'employee esi', 'esi employee', 'esi deduction', 'esi ded',
      'esic amt', 'esic amount', 'esi amt', 'esi amount', 'esic', 'esi'
    ],
    net: ['net pay', 'net payable', 'net salary', 'net payment', 'take home', 'take home pay'],
    earn: ['other earnings', 'other earning', 'allowances', 'allowance'],
    adv: ['advance', 'adv', 'advance deduction', 'adv deduction', 'advance ded', 'adv ded'],
    ded: ['other deductions', 'other deduction', 'total deduction', 'total deductions'],
    pfno: [
      'pf no', 'pf number', 'pf account no', 'pf account number', 'pf a c no', 'pf ac no',
      'epf no', 'epf number', 'epf account no', 'uan no', 'uan number', 'uan', 'pf uan', 'pf no uan'
    ],
    esicno: [
      'esic no', 'esic number', 'esi no', 'esi number', 'ip no', 'ip number',
      'esic ip', 'esic ip no', 'insurance no', 'insurance number', 'esic a c no'
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
    return String(v == null ? '' : v).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function key(v) {
    var s = String(v == null ? '' : v).trim().replace(/\.0+$/, '').replace(/\s/g, '').toUpperCase();
    return /^\d+$/.test(s) ? (s.replace(/^0+/, '') || '0') : s;
  }

  function num(v) {
    if (typeof v === 'number' && isFinite(v)) return v;
    if (v == null || String(v).trim() === '') return null;
    var s = String(v).replace(/[₹,\s]/g, '').replace(/^\((.*)\)$/, '-$1');
    if (/^[-–—]+$/.test(s) || /^n\/?a$/i.test(s)) return null;
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

  function month(s) {
    s = String(s || '').toLowerCase().replace(/[_]+/g, ' ');
    var m = s.match(/\b(20\d{2})[-_. ](0?[1-9]|1[0-2])\b/) || s.match(/\b(0?[1-9]|1[0-2])[-_. ](20\d{2})\b/);
    if (m) return m[1].length === 4 ? m[1] + '-' + String(+m[2]).padStart(2, '0') : m[2] + '-' + String(+m[1]).padStart(2, '0');
    var names = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
    var short = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec'];
    m = s.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)[ _.-]*(20\d{2})\b/);
    if (m) {
      var i = names.indexOf(m[1]);
      if (i < 0) {
        var si = short.indexOf(m[1]);
        i = si >= 9 ? si - 1 : si;
      }
      if (i >= 0) return m[2] + '-' + String(i + 1).padStart(2, '0');
    }
    return '';
  }

  function getMasterList() {
    try {
      if (g.EM && Array.isArray(g.EM.data) && g.EM.data.length) return g.EM.data;
    } catch (_) {}
    try {
      if (Array.isArray(g.EMP_MASTER_DATA) && g.EMP_MASTER_DATA.length) return g.EMP_MASTER_DATA;
    } catch (_) {}
    try {
      var raw = g.localStorage && g.localStorage.getItem('AroraTextilesEmployeeMasterV3');
      if (raw) {
        var parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (_) {}
    return [];
  }

  function cleanStatId(val) {
    var s = String(val == null ? '' : val).trim();
    if (!s || s === '-' || s === '--' || /^n\/?a$/i.test(s) || /^nil$/i.test(s)) return '';
    return s.replace(/\.0+$/, '');
  }

  function lookupMasterEmployee(query) {
    var qNorm = key(query);
    var qLower = String(query || '').trim().toLowerCase();
    if (!qNorm && !qLower) return null;
    var list = getMasterList();
    var nameMatch = null;
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (!e) continue;
      var c = String(e.emp_id || e.code || e.emp_code || e.id || '').trim();
      var nm = String(e.name || e.emp_name || '').trim();
      if (qNorm && key(c) === qNorm) {
        return {
          code: c,
          name: nm,
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
      if (!nameMatch && qLower && nm.toLowerCase() === qLower) {
        nameMatch = e;
      }
    }
    if (nameMatch) {
      return lookupMasterEmployee(nameMatch.emp_id || nameMatch.code || nameMatch.emp_code);
    }
    return null;
  }

  function getFiles() {
    var a = [];
    try {
      if (g.ATPLCentralFileSync && g.ATPLCentralFileSync.getModuleFiles) {
        a = g.ATPLCentralFileSync.getModuleFiles('salary') || [];
      }
    } catch (e) {}
    if (!a.length && Array.isArray(g.FILES)) a = g.FILES;
    var seen = {};
    return a.filter(function(f) {
      var k = String((f && (f.name || f.id)) || '').toLowerCase();
      if (!k || seen[k]) return false;
      seen[k] = 1;
      return true;
    });
  }

  function sheets(f) {
    var out = [];
    try {
      if (f.wb && g.XLSX && f.wb.SheetNames) {
        f.wb.SheetNames.forEach(function(n) {
          out.push({
            name: n,
            rows: g.XLSX.utils.sheet_to_json(f.wb.Sheets[n], { header: 1, raw: false, defval: '' })
          });
        });
        return out;
      }
    } catch (e) {}
    var s = f.sheets;
    if (Array.isArray(s)) {
      return s.map(function(x) {
        return { name: x.name || 'Sheet', rows: x.rows || x.data || [] };
      });
    }
    if (s && typeof s === 'object') {
      Object.keys(s).forEach(function(n) {
        var x = s[n];
        out.push({ name: n, rows: Array.isArray(x) ? x : (x.rows || x.data || []) });
      });
    }
    return out;
  }

  function sheetPriority(name) {
    var nl = norm(name);
    if (nl.indexOf('fourmala') >= 0 || nl.indexOf('formula') >= 0) return 100;
    if (nl.indexOf('manisha') >= 0) return 95;
    if (nl === 'salary sheet' || nl === 'main sheet' || nl === 'salaries') return 90;
    if (nl.indexOf('salary') >= 0 || nl.indexOf('payroll') >= 0) return 80;
    if (nl === 'staff' || nl === 'non staff') return 70;
    if (nl === 'sheet1' || nl === 'data') return 50;
    if (nl.indexOf('category') >= 0 || nl.indexOf('summary') >= 0 || nl.indexOf('department') >= 0) return 10;
    return 40;
  }

  function indices(h, aliases, fieldKey) {
    var out = [];
    h.forEach(function(v, i) {
      var nv = norm(v);
      if (!nv) return;
      if (aliases.indexOf(nv) >= 0) out.push(i);
    });
    if (out.length) return out;

    // Safe semantic fallbacks for statutory deduction & ID columns
    if (fieldKey === 'pf') {
      h.forEach(function(v, i) {
        var nv = norm(v);
        if (!nv) return;
        if (/\b(employer|er|no|number|account|acc|ac|uan|share)\b/.test(nv)) return;
        if (/\b(pf|epf)\b/.test(nv)) out.push(i);
      });
    } else if (fieldKey === 'esic') {
      h.forEach(function(v, i) {
        var nv = norm(v);
        if (!nv) return;
        if (/\b(employer|er|no|number|ip|account|acc|ac|share)\b/.test(nv)) return;
        if (/\b(esic|esi)\b/.test(nv)) out.push(i);
      });
    } else if (fieldKey === 'pfno') {
      h.forEach(function(v, i) {
        var nv = norm(v);
        if (!nv) return;
        if (/\b(uan|pf no|pf number|pf account|epf no|epf number)\b/.test(nv)) out.push(i);
      });
    } else if (fieldKey === 'esicno') {
      h.forEach(function(v, i) {
        var nv = norm(v);
        if (!nv) return;
        if (/\b(esic no|esic number|esi no|esi number|ip no|ip number|esic ip)\b/.test(nv)) out.push(i);
      });
    }
    return out;
  }

  function parse(f, sh, p, emp) {
    var rows = sh.rows || [];
    var hi = -1;
    var ix = {};
    var nameIdx = -1;
    var nameHeads = ['employee name', 'name of employee', 'name of employe', 'emp name', 'name'];
    var numericKeys = ['manual', 'gross', 'basic', 'hra', 'pf', 'esic', 'net', 'earn', 'adv', 'ded'];

    for (var r = 0; r < Math.min(35, rows.length); r++) {
      var h = rows[r] || [];
      var ni = -1;
      for (var j = 0; j < h.length; j++) {
        if (nameHeads.indexOf(norm(h[j])) >= 0) {
          ni = j;
          break;
        }
      }
      var explicitCodeCols = indices(h, A.code, 'code');
      var codeCol = -1;
      if (ni > 0) {
        var codeHead = norm(h[ni - 1]);
        if (['s no', 'sr no', 'serial no', 'serial number', 'sno', 'sr number'].indexOf(codeHead) < 0) {
          codeCol = ni - 1;
        }
      }
      if (codeCol < 0 && explicitCodeCols.length === 1) {
        codeCol = explicitCodeCols[0];
      }
      if (codeCol >= 0 && (ni >= 0 || explicitCodeCols.length === 1)) {
        hi = r;
        nameIdx = ni;
        ix.code = [codeCol];
        Object.keys(A).forEach(function(k) {
          if (k !== 'code') ix[k] = indices(h, A[k], k);
        });
        break;
      }
    }

    if (hi < 0) return { recognized: false, rows: [] };

    var found = [];
    for (var i = hi + 1; i < rows.length; i++) {
      var row = rows[i] || [];
      if (key(row[ix.code[0]]) !== key(emp)) continue;
      var rec = {
        period: p,
        file: f.name || f.id || 'Unnamed',
        sheet: sh.name || 'Sheet',
        priority: sheetPriority(sh.name || ''),
        row: i + 1,
        code: String(row[ix.code[0]]).trim(),
        empName: nameIdx >= 0 ? String(row[nameIdx] || '').trim() : '',
        values: {},
        headers: {},
        issues: []
      };
      Object.keys(ix).forEach(function(k) {
        var cols = ix[k];
        if (cols.length > 1) {
          // For pf/esic/pfno/esicno take the first matching column cleanly instead of failing whole sheet unless truly ambiguous
          if (k === 'manual' || k === 'gross' || k === 'net') {
            rec.issues.push('Multiple ' + k + ' columns: ' + cols.map(function(c) { return String((rows[hi] || [])[c]); }).join(', '));
            return;
          }
        }
        if (cols.length >= 1) {
          var colIdx = cols[0];
          rec.headers[k] = String((rows[hi] || [])[colIdx] || '');
          rec.values[k] = numericKeys.indexOf(k) >= 0
            ? num(row[colIdx])
            : cleanStatId(row[colIdx]);
        }
      });
      found.push(rec);
    }
    return { recognized: true, rows: found };
  }

  function scan(rawQuery) {
    var inputVal = String(rawQuery || '').trim();
    var masterEmp = lookupMasterEmployee(inputVal);
    var emp = (masterEmp && masterEmp.code) ? masterEmp.code : inputVal;

    var fs = getFiles();
    var map = {};
    var now = new Date();
    var end = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    var startMonth = '2026-01';
    var endMonth = end;

    fs.forEach(function(f) {
      var p = month(f.name || f.filename);
      if (p) {
        if (p < startMonth) startMonth = p;
        if (p > endMonth) endMonth = p;
        (map[p] || (map[p] = [])).push(f);
      }
    });

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

    var sheetPfNo = '';
    var sheetEsicNo = '';
    var sheetEmpName = '';
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

    var monthResults = months.map(function(p) {
      var files = map[p] || [];
      var fileNames = files.map(function(f) { return f.name || f.filename || f.id || 'Unnamed file'; });

      function result(status, reason, records) {
        return { period: p, status: status, reason: reason, records: records || [], files: fileNames };
      }

      if (!files.length) {
        return result('SALARY FILE UNAVAILABLE', 'No saved salary file with a recognizable month in its filename.');
      }

      var matches = [];
      var recognized = 0;
      var unread = [];
      files.forEach(function(f) {
        var ss = sheets(f);
        if (!ss.length) {
          unread.push(f.name || 'Unnamed file');
          return;
        }
        var fileMatches = [];
        ss.forEach(function(sh) {
          var z = parse(f, sh, p, emp);
          if (z.recognized) recognized++;
          else unread.push((f.name || 'File') + ' / ' + sh.name);
          fileMatches = fileMatches.concat(z.rows);
        });
        // If multiple tabs inside the same workbook matched (e.g. Formula Sheet + Category summary), pick highest priority tab
        if (fileMatches.length > 1) {
          fileMatches.sort(function(a, b) {
            var scoreA = (a.priority || 0) + (a.values.manual != null ? 20 : 0) + (a.values.pf != null ? 10 : 0) + (a.values.esic != null ? 10 : 0);
            var scoreB = (b.priority || 0) + (b.values.manual != null ? 20 : 0) + (b.values.pf != null ? 10 : 0) + (b.values.esic != null ? 10 : 0);
            return scoreB - scoreA;
          });
          fileMatches = [fileMatches[0]];
        }
        matches = matches.concat(fileMatches);
      });

      if (matches.length >= 1) {
        // Pick primary match if two files exist for the same month, preserving alternates for audit note
        if (matches.length > 1) {
          matches.sort(function(a, b) {
            var scoreA = (a.priority || 0) + (a.values.manual != null ? 20 : 0) + (a.values.pf != null ? 10 : 0);
            var scoreB = (b.priority || 0) + (b.values.manual != null ? 20 : 0) + (b.values.pf != null ? 10 : 0);
            return scoreB - scoreA;
          });
        }
        var r = matches[0];
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

        if (r.issues.length) return result('DATA NOT VERIFIED', r.issues.join('; '), matches);
        if (matches.length > 1) {
          return result('RECORD FOUND', 'Matched across ' + matches.length + ' files (showing primary salary sheet).', matches);
        }
        if (!Object.prototype.hasOwnProperty.call(r.values, 'manual')) return result('MANUAL AMOUNT MISSING', 'Employee row found, but no recognized Manual Amount column exists.', [r]);
        if (r.values.manual === null) return result('MANUAL AMOUNT MISSING', 'Manual Amount cell is blank or non-numeric; blank is not zero.', [r]);
        if (r.values.manual === 0) return result('MANUAL AMOUNT ZERO', 'Manual Amount cell contains numeric zero.', [r]);
        return result('RECORD FOUND', 'Exact Employee Code matched.', [r]);
      }

      if (!recognized && unread.length) {
        return result('DATA NOT VERIFIED', 'Could not confidently identify Employee Code header in: ' + unread.join(', '));
      }
      return result('EMPLOYEE CODE NOT FOUND', 'Recognized sheets scanned; Employee Code not present.');
    });

    var profile = {
      code: emp,
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
      employeeCode: emp,
      profile: profile,
      filesScanned: fs.length,
      totals: totals,
      months: monthResults
    };
  }

  function label(p) {
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
      var emSample = getMasterList().filter(function(e) { return e && (e.emp_id || e.code); }).slice(0, 5);
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

    // 1. Employee Statutory & Identity Panel (Single elevation, zero pills, hairline dividers)
    h += '<section class="sh-profile">';
    h += '  <div class="sh-profile-top">';
    h += '    <div class="sh-identity">';
    h += '      <div class="sh-name-row">';
    h += '        <h3 class="sh-emp-name">' + esc(p.name || ('Employee ' + r.employeeCode)) + '</h3>';
    h += '        <span class="sh-emp-code tabular">' + esc(r.employeeCode) + '</span>';
    h += '      </div>';
    var metaParts = [];
    if (p.dept) metaParts.push(esc(p.dept));
    if (p.desig) metaParts.push(esc(p.desig));
    if (p.doj) metaParts.push('DOJ: ' + esc(p.doj));
    if (p.father) metaParts.push('S/O ' + esc(p.father));
    if (!metaParts.length) metaParts.push(p.inMaster ? 'Verified in Employee Master' : 'Matched from Salary Sheets');
    h += '      <div class="sh-meta-line">' + metaParts.join(' <span aria-hidden="true">·</span> ') + '</div>';
    h += '    </div>';
    h += '    <div class="sh-profile-actions">';
    h += '      <button type="button" id="atpl-sh-export" class="sh-btn-secondary">⬇ Export CSV</button>';
    h += '    </div>';
    h += '  </div>';

    h += '  <div class="sh-statutory-grid">';
    h += '    <div class="sh-stat-cell">';
    h += '      <span class="sh-lbl">PF / UAN Number</span>';
    h += '      <div class="sh-stat-val-row">';
    h += '        <strong class="tabular">' + esc(p.pfNo || 'Not Available') + '</strong>';
    if (p.pfNo) h += '<button type="button" class="sh-copy-btn" data-copy="' + esc(p.pfNo) + '" data-label="PF No">Copy</button>';
    h += '      </div>';
    h += '      <span class="sh-sub-hint">' + esc(p.pfNoSource ? ('Source: ' + p.pfNoSource) : 'Not enrolled / blank in master & sheets') + '</span>';
    h += '    </div>';

    h += '    <div class="sh-stat-cell">';
    h += '      <span class="sh-lbl">ESIC / IP Number</span>';
    h += '      <div class="sh-stat-val-row">';
    h += '        <strong class="tabular">' + esc(p.esicNo || 'Not Available') + '</strong>';
    if (p.esicNo) h += '<button type="button" class="sh-copy-btn" data-copy="' + esc(p.esicNo) + '" data-label="ESIC No">Copy</button>';
    h += '      </div>';
    h += '      <span class="sh-sub-hint">' + esc(p.esicNoSource ? ('Source: ' + p.esicNoSource) : 'Not enrolled / blank in master & sheets') + '</span>';
    h += '    </div>';

    h += '    <div class="sh-stat-cell">';
    h += '      <span class="sh-lbl">Master Gross / Basic</span>';
    h += '      <div class="sh-stat-val-row"><strong class="tabular">' + (p.masterGross != null ? money(p.masterGross) : '—') + '</strong></div>';
    h += '      <span class="sh-sub-hint">Basic: ' + (p.masterBasic != null ? money(p.masterBasic) : '—') + (p.empStatus ? (' · Status: ' + esc(p.empStatus)) : '') + '</span>';
    h += '    </div>';
    h += '  </div>';
    h += '</section>';

    // 2. 4-Column Tabular KPI Strip
    h += '<div class="sh-kpi-grid">';
    h += '  <div class="sh-kpi">';
    h += '    <span class="sh-lbl">Total PF Deducted (Emp)</span>';
    h += '    <b class="tabular sh-kpi-pf">' + money(t.pfTotal) + '</b>';
    h += '    <span class="sh-sub-hint">' + (t.pfMonths || 0) + ' month(s) PF cut</span>';
    h += '  </div>';
    h += '  <div class="sh-kpi">';
    h += '    <span class="sh-lbl">Total ESIC Deducted (Emp)</span>';
    h += '    <b class="tabular sh-kpi-esic">' + money(t.esicTotal) + '</b>';
    h += '    <span class="sh-sub-hint">' + (t.esicMonths || 0) + ' month(s) ESIC cut</span>';
    h += '  </div>';
    h += '  <div class="sh-kpi">';
    h += '    <span class="sh-lbl">Total Manual / Gross</span>';
    h += '    <b class="tabular">' + money(t.manualTotal) + '</b>';
    h += '    <span class="sh-sub-hint">Gross total: ' + money(t.grossTotal) + '</span>';
    h += '  </div>';
    h += '  <div class="sh-kpi">';
    h += '    <span class="sh-lbl">Months Verified</span>';
    h += '    <b class="tabular">' + (t.monthsFound || 0) + ' / ' + r.months.length + '</b>';
    h += '    <span class="sh-sub-hint">' + r.filesScanned + ' saved salary files scanned</span>';
    h += '  </div>';
    h += '</div>';

    // 3. Filter Segmented Bar & Month Ledger Table
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
            h += '    <div class="sh-detail-reason"><strong>' + esc(m.status) + ':</strong> ' + esc(m.reason) + '</div>';
          } else {
            h += '    <div class="sh-fields">';
            [
              ['PF / UAN No', v.pfno || p.pfNo || '—', 'text'],
              ['ESIC / IP No', v.esicno || p.esicNo || '—', 'text'],
              ['Basic Salary', v.basic, 'money'],
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
            h += '    <div class="sh-source"><strong>Source Verification:</strong> Original file: <span>' + esc(x.file) + '</span> · Sheet: <span>' + esc(x.sheet) + '</span> · Row: <span class="tabular">' + x.row + '</span> · Code: <span class="tabular">' + esc(x.code) + '</span><br><span class="sh-cols-line">Matched columns: ' + esc(Object.keys(x.headers).map(function(k) { return k + ' = ' + x.headers[k]; }).join(' · ')) + '</span></div>';

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
    var list = getMasterList();
    var hits = [];
    for (var i = 0; i < list.length && hits.length < 7; i++) {
      var e = list[i];
      if (!e) continue;
      var c = String(e.emp_id || e.code || e.emp_code || '').trim();
      var nm = String(e.name || '').trim();
      var pf = cleanStatId(e.pf_no || e.pfno || e.uan);
      var es = cleanStatId(e.esi_no || e.esic_no);
      if (c.toLowerCase().indexOf(q) >= 0 || nm.toLowerCase().indexOf(q) >= 0 || pf.toLowerCase().indexOf(q) >= 0 || es.toLowerCase().indexOf(q) >= 0) {
        hits.push({ code: c, name: nm, dept: String(e.dept || '').trim(), pf: pf, es: es });
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

  function search() {
    var inp = $('code');
    var v = inp ? inp.value.trim() : '';
    var box = $('suggest');
    if (box) box.style.display = 'none';
    if (!v) {
      if ($('notice')) $('notice').textContent = 'Enter an Employee Code, Name, PF No, or ESIC No.';
      return;
    }
    S.result = scan(v);
    S.expanded = {};
    S.filter = 'all';
    render();
    if ($('notice')) {
      var p = S.result.profile || {};
      $('notice').textContent = 'Read-only scan complete for ' + (p.name ? (p.name + ' (' + S.result.employeeCode + ')') : S.result.employeeCode) + '. No source file was modified.';
    }
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
        '    <div>' +
        '      <div class="sh-kicker">Arora Textiles · Employee Statutory &amp; Payroll Ledger</div>' +
        '      <h2>Service History</h2>' +
        '      <p>Employee PF No, ESIC No, month-wise PF/ESIC deductions aur verified salary breakdown</p>' +
        '    </div>' +
        '    <button type="button" id="atpl-sh-back">← Back to ERP</button>' +
        '  </header>' +
        '  <div class="sh-search">' +
        '    <div class="sh-search-field">' +
        '      <label for="atpl-sh-code">Employee Code / Name / PF / ESIC No</label>' +
        '      <input id="atpl-sh-code" type="search" autocomplete="off" placeholder="e.g. 25924, Ram Kumar, ya PF/ESIC number">' +
        '      <div id="atpl-sh-suggest" class="sh-suggest" style="display:none"></div>' +
        '    </div>' +
        '    <button type="button" id="atpl-sh-search">Search Service History</button>' +
        '  </div>' +
        '  <div id="atpl-sh-notice">Employee Master aur saved salary files scan karne ke liye code ya naam search karein.</div>' +
        '  <div id="atpl-sh-results"></div>' +
        '  <footer>Read-only audit ledger · Original salary workbooks and Employee Master are never modified.</footer>' +
        '</div>';
      var a = document.getElementById('page-sync');
      ((a && a.parentNode) || document.querySelector('.content') || document.body).appendChild(p);
    }

    if (!document.getElementById('atpl-sh-style')) {
      var s = document.createElement('style');
      s.id = 'atpl-sh-style';
      s.textContent = [
        '#page-servicehistory.page.active{display:block!important;position:relative!important;box-sizing:border-box!important;width:100%!important;height:calc(100vh - 56px)!important;max-height:calc(100vh - 56px)!important;min-height:0!important;overflow-y:auto!important;overflow-x:hidden!important;overscroll-behavior:contain;scrollbar-gutter:stable;padding:0!important;background:#f8fafc!important;font-family:"Plus Jakarta Sans","Manrope",system-ui,-apple-system,sans-serif}',
        '#page-servicehistory .tabular{font-variant-numeric:tabular-nums}',
        '#page-servicehistory .sh-app{width:100%;max-width:1440px;box-sizing:border-box;margin:0 auto;padding:24px 28px 40px;color:#0f172a}',
        '#page-servicehistory .sh-hero{display:flex;justify-content:space-between;align-items:center;gap:20px;padding:20px 24px;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px}',
        '#page-servicehistory .sh-kicker{font-size:12px;font-weight:600;color:#4f46e5;margin-bottom:4px}',
        '#page-servicehistory .sh-hero h2{font-size:24px;line-height:1.2;font-weight:700;letter-spacing:-0.4px;margin:0 0 4px;color:#0f172a}',
        '#page-servicehistory .sh-hero p{margin:0;color:#64748b;font-size:13px}',
        '#page-servicehistory button{font-family:inherit;border:1px solid #cbd5e1;border-radius:8px;background:#fff;padding:10px 18px;min-height:40px;font-weight:600;font-size:13px;cursor:pointer;color:#334155;white-space:nowrap;flex-shrink:0;transition:background .15s,border-color .15s,color .15s}',
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
        }
      };
      sub.appendChild(n);
    }

    var b = $('search');
    var c = $('code');
    var back = $('back');
    if (b) b.onclick = search;
    if (c) {
      c.oninput = function() { updateAutocomplete(c.value); };
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

  g.ATPLServiceHistoryV1 = { scan: scan, lookupMasterEmployee: lookupMasterEmployee, version: '2.0.0' };
})(window);