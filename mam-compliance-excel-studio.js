/*
 * ATPL Mam -> ESI/PF Compliance Excel Studio
 * Single-upload Mam Sheet (.csv/.xlsx/.xls) -> Employee Master Auto-Enrichment ->
 * Verified Lokesh Formulas -> Interactive Excel-like Live Grid ->
 * Multi-Sheet Formula-Enabled .xlsx Download -> Cross-Browser Real-Time Sync.
 */
(function(root) {
  'use strict';

  const STORAGE_SHEETS_KEY = 'ATPL_ComplianceSheets_V1';
  const STORAGE_TOMBS_KEY = 'ATPL_ComplianceTombstones_V1';
  const STORAGE_ACTIVE_KEY = 'ATPL_ComplianceActiveMonth_V1';
  const STORAGE_PROFILES_KEY = 'ATPL_ComplianceProfiles_V1';
  const CHANNEL_NAME = 'ATPL_ERP_TRIGGER_BUS';

  const MAIN_HEADERS = [
    'S.No.', 'Employee ID', 'Name of employee', 'Fathers Name', 'D.O.B', 'D-O-J',
    'PF NO', 'ESI NO', 'Gender', 'Department', 'Designation', 'Catgrory 01', 'Catgrory 02',
    'Basic', 'HRA', 'Gross Total Salary', 'Month Of Days', 'Working Days', 'Sun Allow', 'HD',
    'Absent', 'Paid Days', 'Over Time Hours', 'Earn Basic', 'Earn HRA', 'Gross Earned Salary',
    'Earned Bonus 8.33%', 'OT Amount', 'Total Gross salary', 'Manual Amount', 'Diff. Amount',
    'PF@12%', 'ESIC @0.75%', 'Advance Deduction', 'Total Deduction', 'Net Payable',
    'PF @13%', 'ESI @3.25%', 'Remarks'
  ];

  const COMPACT_HEADERS = [
    'S.No.', 'Employee ID', 'Name of employee', 'Fathers Name', 'PF NO', 'ESI NO',
    'Gender', 'Catgrory 02', 'Basic', 'Gross Total Salary', 'Month Of Days', 'Absent',
    'Paid Days', 'Over Time Hours', 'Earn Basic', 'Gross Earned Salary',
    'Total Gross salary', 'Manual Amount', 'Diff. Amount', 'PF@12%', 'ESIC @0.75%',
    'Advance Deduction', 'Total Deduction', 'Net Payable', 'Remarks'
  ];

  const DEFAULT_SETTINGS = {
    month: '',
    monthDays: 31,
    maxOtHours: 32,
    bonusMode: 'BASIC_833',   // BASIC_833 | GROSS_10 | NONE
    bonusRate: 8.33,          // % of Earn Basic
    otDivisor: 104,           // Gross / 104 per OT hr (double hourly rate on 208 hrs)
    pfRate: 0.12,
    pfEmployerRate: 0.13,
    pfCap: 15000,
    pfDefaultMode: 'FULL_12', // FULL_12 (Lokesh verified) | CAP_15000 | NONE
    esiRate: 0.0075,
    esiEmployerRate: 0.0325,
    esiBase: 'EARN_BASIC',    // EARN_BASIC (Lokesh verified) | TOTAL_GROSS
    autoPullAdvance: true,
    clampNegativeDiff: true
  };

  function text(v) {
    return v === null || v === undefined ? '' : String(v).replace(/^\uFEFF/, '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '').trim();
  }
  function norm(v) {
    return text(v).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }
  function nameKey(v) {
    return norm(v).replace(/\s+/g, ' ');
  }
  function cleanCode(v) {
    return text(v).replace(/\.0+$/, '').replace(/\s+/g, '');
  }
  function codeKey(v) {
    const c = cleanCode(v).toUpperCase();
    if (!c) return '';
    return /^\d+$/.test(c) ? (c.replace(/^0+/, '') || '0') : c;
  }
  function num(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    const s = text(v).replace(/[₹,\s]/g, '');
    if (!s || /^#/.test(s)) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  function round0(v) {
    return Math.round((Number(v) || 0) + Number.EPSILON);
  }
  function round2(v) {
    return Math.round(((Number(v) || 0) + Number.EPSILON) * 100) / 100;
  }
  function validId(v) {
    const n = norm(v);
    return !!n && !['na', 'n a', 'nil', 'none', '0', 'not available', '-'].includes(n);
  }
  function daysInMonth(month) {
    const m = /^(\d{4})-(\d{2})$/.exec(text(month));
    return m ? new Date(Date.UTC(+m[1], +m[2], 0)).getUTCDate() : 31;
  }
  function todayMonth() {
    return new Date().toISOString().slice(0, 7);
  }
  function detectMonthFromText(value) {
    const s = text(value).replace(/[_/]+/g, ' ');
    if (!s) return '';
    const ym = s.match(/\b(20\d{2})[-\s](0?[1-9]|1[0-2])\b/);
    if (ym) return ym[1] + '-' + String(Number(ym[2])).padStart(2, '0');
    const names = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
    const shortMap = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
    const fullMatch = s.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)(?:[\s-]*(20\d{2}|\d{2}))?\b/i);
    if (!fullMatch) return '';
    const tok = fullMatch[1].toLowerCase();
    const mi = names.indexOf(tok) + 1 || shortMap[tok];
    if (!mi) return '';
    const yr = fullMatch[2] ? (fullMatch[2].length === 2 ? '20' + fullMatch[2] : fullMatch[2]) : String(new Date().getFullYear());
    return yr + '-' + String(mi).padStart(2, '0');
  }
  function monthLabel(monthKey) {
    const m = /^(\d{4})-(\d{2})$/.exec(text(monthKey));
    if (!m) return text(monthKey) || 'Selected Month';
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return (months[Number(m[2]) - 1] || m[2]) + ' ' + m[1];
  }
  function settingsOf(input) {
    const s = Object.assign({}, DEFAULT_SETTINGS, input || {});
    s.month = text(s.month) || todayMonth();
    const dm = daysInMonth(s.month);
    s.monthDays = (num(s.monthDays) && num(s.monthDays) > 0) ? Math.min(31, Math.max(1, round0(s.monthDays))) : dm;
    ['maxOtHours', 'bonusRate', 'otDivisor', 'pfRate', 'pfEmployerRate', 'pfCap', 'esiRate', 'esiEmployerRate'].forEach(k => {
      const n = num(s[k]);
      s[k] = n === null ? DEFAULT_SETTINGS[k] : n;
    });
    if (!['BASIC_833', 'GROSS_10', 'NONE'].includes(s.bonusMode)) s.bonusMode = 'BASIC_833';
    if (!['FULL_12', 'CAP_15000', 'NONE'].includes(s.pfDefaultMode)) s.pfDefaultMode = 'FULL_12';
    if (!['EARN_BASIC', 'TOTAL_GROSS'].includes(s.esiBase)) s.esiBase = 'EARN_BASIC';
    s.autoPullAdvance = s.autoPullAdvance !== false;
    s.clampNegativeDiff = s.clampNegativeDiff !== false;
    return s;
  }

  // Pure JS CSV parser for Node/browser compatibility
  function parseCsvText(csvStr) {
    const str = String(csvStr || '').replace(/^\uFEFF/, '');
    const rows = [];
    let row = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < str.length; i++) {
      const ch = str[i];
      if (inQ) {
        if (ch === '"' && str[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') { inQ = false; }
        else { cur += ch; }
      } else {
        if (ch === '"') { inQ = true; }
        else if (ch === ',') { row.push(cur); cur = ''; }
        else if (ch === '\r') { /* skip */ }
        else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
        else { cur += ch; }
      }
    }
    if (cur.length || row.length) {
      row.push(cur);
      rows.push(row);
    }
    return rows;
  }

  const CODE_HEADERS = ['code', 'emp code', 'employee code', 'employee id', 'emp id', 'id', 'card no', 'ecode', 'e code', 'staff code', 'worker code'];
  const GENERIC_NAME_HEADERS = ['name', 'emp name', 'employee name', 'name of employee', 'employee', 'worker name'];
  const NAME_HEADERS = GENERIC_NAME_HEADERS.concat(['staff name']);
  const CATEGORY_HEADERS = ['category', 'category 02', 'catgrory 02', 'category 01', 'catgrory 01', 'card', 'card no', 'card number', 'dept', 'department', 'group'];
  const AMOUNT_HEADERS = ['manual amount', 'manual amt', 'mam amount', 'amount', 'total', 'total amount', 'salary', 'salary amount', 'net payable', 'payment', 'net amount'];

  function parseCardNumber(val) {
    const raw = text(val);
    if (!raw) return '';
    let m = raw.match(/^(?:new\s*)?card(?:\s*no\.?)?[-\s.]*0*(\d{1,3})(?:\b|\s|$)/i);
    if (m) return String(Number(m[1]));
    m = raw.match(/^c[-\s.]*0*(\d{1,3})$/i);
    if (m) return String(Number(m[1]));
    m = raw.match(/\bcard(?:\s*no\.?)?[-\s.]*0*(\d{1,3})\b/i);
    if (m) return String(Number(m[1]));
    return '';
  }

  function buildMasterCardMap(employees) {
    const counts = {};
    const display = {};
    (employees || []).forEach(e => {
      if (!e) return;
      [e.cat2, e.cat1].forEach(raw => {
        const c = text(raw).toUpperCase();
        const cn = parseCardNumber(c);
        if (!cn) return;
        counts[cn] = counts[cn] || {};
        counts[cn][c] = (counts[cn][c] || 0) + 1;
      });
    });
    Object.keys(counts).forEach(cn => {
      const variants = Object.keys(counts[cn]).sort((a, b) => {
        // Prefer clean Card formats like "CARD NO.7" over extra suffix if counts tie, else most common
        const diff = (counts[cn][b] || 0) - (counts[cn][a] || 0);
        if (diff !== 0) return diff;
        return a.length - b.length;
      });
      if (variants.length) display[cn] = variants[0];
    });
    return display;
  }

  function canonicalizeCardCategory(rawCat, masterCardMap) {
    const raw = text(rawCat).toUpperCase();
    if (!raw) return '';
    const cn = parseCardNumber(raw);
    if (!cn) return raw;
    if (masterCardMap && masterCardMap[cn]) return masterCardMap[cn];
    if (/^(?:NEW\s*)?CARD/i.test(raw)) return raw;
    return 'CARD NO.' + cn;
  }

  function parseMamMatrix(rows, sheetName, fileName) {
    rows = Array.isArray(rows) ? rows : [];
    const sheet = text(sheetName) || 'Sheet1';
    const file = text(fileName) || 'Mam_Sheet';
    let ci = -1, ni = -1, ai = -1, catIdx = -1;
    let currentCategory = sheet;
    let sectionHeaderCount = 0;
    let firstHeaderIdx = -1;

    for (let i = 0; i < Math.min(40, rows.length); i++) {
      const r = rows[i] || [];
      const h = r.map(norm);
      const foundC = h.findIndex(x => CODE_HEADERS.includes(x));
      const foundA = h.findIndex(x => AMOUNT_HEADERS.includes(x));
      if (foundC >= 0 && foundA >= 0) {
        ci = foundC;
        ai = foundA;
        sectionHeaderCount = 1;
        const foundN = h.findIndex((x, idx) => idx !== ci && idx !== ai && GENERIC_NAME_HEADERS.includes(x));
        if (foundN >= 0) {
          ni = foundN;
          const foundCat = h.findIndex((x, idx) => idx !== ci && idx !== ni && idx !== ai && CATEGORY_HEADERS.includes(x));
          if (foundCat >= 0) catIdx = foundCat;
        } else {
          // Pick middle non-empty column between ci and ai, or next column (grouped Mam format: Code | Card No.6 | Total or Code | Staff Name | Total)
          for (let c = 0; c < r.length; c++) {
            if (c !== ci && c !== ai && text(r[c]) !== '') { ni = c; break; }
          }
          if (ni < 0) ni = ci + 1;
          const headerNameTxt = text(r[ni]);
          if (headerNameTxt && !GENERIC_NAME_HEADERS.includes(norm(headerNameTxt))) {
            currentCategory = headerNameTxt;
          }
          const foundCat = h.findIndex((x, idx) => idx !== ci && idx !== ni && idx !== ai && CATEGORY_HEADERS.includes(x));
          if (foundCat >= 0) catIdx = foundCat;
        }
        firstHeaderIdx = i;
        break;
      }
    }

    // Fallback: 3-column heuristic without explicit header
    if (firstHeaderIdx < 0) {
      for (let i = 0; i < Math.min(20, rows.length); i++) {
        const r = rows[i] || [];
        if (text(r[1]) && num(r[2]) !== null) {
          ci = 0; ni = 1; ai = 2; firstHeaderIdx = i - 1; break;
        }
      }
    }

    if (ci < 0 || ai < 0) {
      throw new Error('Mam sheet ke columns pehchane nahi gaye. Format rakhein: Code | Name/Category | Total (ya Employee ID | Name | Manual Amount).');
    }

    const out = [];
    for (let r = firstHeaderIdx + 1; r < rows.length; r++) {
      const a = rows[r] || [];
      const rawCode = text(a[ci]);
      const rawName = text(a[ni]);
      const rawAmt = a[ai];
      const nCode = norm(rawCode);
      const nName = norm(rawName);

      // Grouped section header row e.g. ['Code', 'Card-9', 'Total'] or ['Code', 'C7', 'Total'] or ['Code', 'Staff Name', '']
      if (CODE_HEADERS.includes(nCode)) {
        sectionHeaderCount++;
        if (rawName && !GENERIC_NAME_HEADERS.includes(nName)) currentCategory = rawName;
        continue;
      }

      if (!rawCode && !rawName) continue;
      if (/^(total|grand total|sub total|subtotal|amount)$/i.test(rawName)) continue;
      if (!rawCode && /^(total|grand total|sub total|subtotal)$/i.test(rawCode)) continue;
      if (/^(total|grand total|sub total|subtotal)$/i.test(rawCode)) continue;

      const amt = num(rawAmt);
      if (amt === null && !rawCode) continue;

      const colCat = catIdx >= 0 ? text(a[catIdx]) : '';
      const resolvedCat = colCat || currentCategory || sheet;
      const isCardSection = !!parseCardNumber(resolvedCat);
      const explicitFromSheet = !!(colCat || isCardSection || (sectionHeaderCount > 1 && !NAME_HEADERS.includes(norm(resolvedCat))));

      out.push({
        code: cleanCode(rawCode),
        name: rawName,
        manualAmount: amt === null ? 0 : round2(amt),
        category: resolvedCat,
        hasExplicitCategory: explicitFromSheet,
        source: file + ' · ' + sheet + ' · Row ' + (r + 1),
        sourceRow: r + 1
      });
    }

    if (!out.length) {
      throw new Error('Mam sheet me koi employee salary row nahi mili.');
    }
    return out;
  }

  // Reference / Last Month Compliance parser: learns exact PF & ESIC deduction rules per employee
  function parseReferenceMatrix(rows, sheetName, fileName) {
    rows = Array.isArray(rows) ? rows : [];
    let hi = -1;
    for (let i = 0; i < Math.min(25, rows.length); i++) {
      const h = (rows[i] || []).map(norm);
      if (h.some(x => ['employee id', 'emp id', 'emp code', 'code'].includes(x)) &&
          h.some(x => ['name of employee', 'employee name', 'name'].includes(x)) &&
          h.some(x => ['paid days', 'working days', 'pf 12', 'pf', 'esic 0 75', 'esic'].includes(x))) {
        hi = i; break;
      }
    }
    if (hi < 0) throw new Error('Reference sheet me Employee ID, Name of employee, Paid Days / PF / ESIC columns nahi mile.');
    const hdr = (rows[hi] || []).map(norm);
    const col = (...aliases) => hdr.findIndex(h => aliases.includes(h));
    const idx = {
      id: col('employee id', 'emp id', 'emp code', 'code'),
      name: col('name of employee', 'employee name', 'name'),
      father: col('fathers name', 'father name'),
      pfNo: col('pf no', 'pf number', 'uan'),
      esiNo: col('esi no', 'esic no', 'ip no'),
      gender: col('gender', 'sex'),
      cat: col('catgrory 02', 'category 02', 'catgrory 01', 'category 01', 'category'),
      basic: col('basic', 'basic salary'),
      gross: col('gross total salary', 'gross salary', 'gross'),
      monthDays: col('month of days', 'month days'),
      paidDays: col('paid days', 'working days'),
      ot: col('over time hours', 'overtime hours', 'ot hours'),
      earnBasic: col('earn basic', 'earned basic'),
      totalGross: col('total gross salary', 'total gross'),
      manual: col('manual amount', 'mam amount'),
      pfRule: col('pf rule', 'pf mode'),
      pf: col('pf 12', 'pf 12%', 'pf', 'pf employee', 'pf ded'),
      esiRule: col('esic rule', 'esi rule', 'esic mode'),
      esic: col('esic 0 75', 'esi 0 75', 'esic', 'esi', 'esic employee'),
      adv: col('advance deduction', 'advance'),
      remarks: col('remarks', 'remark')
    };
    const detectedMonth = detectMonthFromText(fileName || '') || detectMonthFromText(sheetName || '');
    const profiles = {
      byCode: {},
      byName: {},
      list: [],
      count: 0,
      sourceFile: fileName || sheetName || '',
      month: detectedMonth
    };
    for (let r = hi + 1; r < rows.length; r++) {
      const a = rows[r] || [];
      const empId = cleanCode(idx.id >= 0 ? a[idx.id] : '');
      const empName = text(idx.name >= 0 ? a[idx.name] : '');
      if (!empId || /^(total|grand total)$/i.test(empName)) continue;
      const basic = num(idx.basic >= 0 ? a[idx.basic] : 0) || 0;
      const gross = num(idx.gross >= 0 ? a[idx.gross] : 0) || 0;
      const md = num(idx.monthDays >= 0 ? a[idx.monthDays] : 31) || 31;
      const paid = num(idx.paidDays >= 0 ? a[idx.paidDays] : 0) || 0;
      const explicitEb = num(idx.earnBasic >= 0 ? a[idx.earnBasic] : null);
      const eb = (explicitEb !== null && explicitEb >= 0) ? round0(explicitEb) : (md ? round0(basic * paid / md) : 0);
      const tg = num(idx.totalGross >= 0 ? a[idx.totalGross] : 0) || 0;
      const pf = num(idx.pf >= 0 ? a[idx.pf] : 0) || 0;
      const esic = num(idx.esic >= 0 ? a[idx.esic] : 0) || 0;
      const pfNo = text(idx.pfNo >= 0 ? a[idx.pfNo] : '');
      const esiNo = text(idx.esiNo >= 0 ? a[idx.esiNo] : '');
      const explicitPfRule = text(idx.pfRule >= 0 ? a[idx.pfRule] : '').toUpperCase();
      const explicitEsiRule = text(idx.esiRule >= 0 ? a[idx.esiRule] : '').toUpperCase();

      const capPf = round0(Math.min(15000, eb) * 0.12);
      const fullPf = round0(eb * 0.12);
      const grossPf = round0(tg * 0.12);
      let pfMode = 'AUTO';
      if (['FULL_12', 'CAP_15000', 'GROSS_12', 'NONE'].includes(explicitPfRule)) {
        pfMode = explicitPfRule;
      } else if (paid > 0 && eb > 0) {
        if (pf === 0) pfMode = 'NONE';
        else if (eb > 15000 && Math.abs(pf - capPf) <= 3 && Math.abs(pf - fullPf) > 10) pfMode = 'CAP_15000';
        else if (tg > eb && Math.abs(pf - grossPf) <= 3 && Math.abs(pf - fullPf) > 10) pfMode = 'GROSS_12';
        else if (pf > 0) pfMode = 'FULL_12';
      }

      const ebEsi = round0(eb * 0.0075);
      const tgEsi = round0(tg * 0.0075);
      let esiMode = 'AUTO';
      if (['EARN_BASIC', 'TOTAL_GROSS', 'NONE'].includes(explicitEsiRule)) {
        esiMode = explicitEsiRule;
      } else if (paid > 0 && eb > 0) {
        if (esic === 0) esiMode = 'NONE';
        else if (tg > eb && Math.abs(esic - tgEsi) <= 3 && Math.abs(esic - ebEsi) > 3) esiMode = 'TOTAL_GROSS';
        else if (esic > 0) esiMode = 'EARN_BASIC';
      }

      const p = {
        empId,
        name: empName,
        father: text(idx.father >= 0 ? a[idx.father] : ''),
        pfNo,
        esiNo,
        gender: text(idx.gender >= 0 ? a[idx.gender] : ''),
        category: text(idx.cat >= 0 ? a[idx.cat] : ''),
        basic,
        gross,
        paidDays: paid,
        otHours: num(idx.ot >= 0 ? a[idx.ot] : 0) || 0,
        earnBasic: eb,
        totalGross: tg,
        manualAmount: num(idx.manual >= 0 ? a[idx.manual] : null),
        prevPf: round0(pf),
        prevEsi: round0(esic),
        pfMode,
        esiMode,
        remarks: text(idx.remarks >= 0 ? a[idx.remarks] : '')
      };
      const ck = codeKey(empId);
      if (ck && !profiles.byCode[ck]) {
        profiles.byCode[ck] = p;
        profiles.count++;
      }
      const nk = nameKey(empName);
      if (nk && !profiles.byName[nk]) profiles.byName[nk] = p;
      profiles.list.push(p);
    }
    return profiles;
  }

  function buildProfilesFromComplianceSheet(sheetRecord) {
    if (!sheetRecord || !Array.isArray(sheetRecord.rows)) return null;
    const s = settingsOf(sheetRecord.settings);
    const profiles = {
      byCode: {},
      byName: {},
      list: [],
      count: 0,
      sourceFile: sheetRecord.mamFile || ('Saved · ' + monthLabel(sheetRecord.month || sheetRecord.id)),
      month: text(sheetRecord.month || sheetRecord.id)
    };
    sheetRecord.rows.forEach(r => {
      if (!r || !cleanCode(r.empId)) return;
      const eb = Number(r.earnBasic) || 0;
      const tg = Number(r.totalGross) || 0;
      const paid = Number(r.paidDays) || 0;
      const pf = Number(r.pfEmployee) || 0;
      const esic = Number(r.esiEmployee) || 0;

      let pfMode = text(r.pfMode).toUpperCase() || 'AUTO';
      if (pfMode === 'AUTO' && paid > 0 && eb > 0) {
        if (pf === 0) pfMode = 'NONE';
        else {
          const capPf = round0(Math.min(s.pfCap || 15000, eb) * s.pfRate);
          const fullPf = round0(eb * s.pfRate);
          const grossPf = round0(tg * s.pfRate);
          if (eb > (s.pfCap || 15000) && Math.abs(pf - capPf) <= 3 && Math.abs(pf - fullPf) > 10) pfMode = 'CAP_15000';
          else if (tg > eb && Math.abs(pf - grossPf) <= 3 && Math.abs(pf - fullPf) > 10) pfMode = 'GROSS_12';
          else pfMode = 'FULL_12';
        }
      }

      let esiMode = text(r.esiMode).toUpperCase() || 'AUTO';
      if (esiMode === 'AUTO' && paid > 0 && eb > 0) {
        if (esic === 0) esiMode = 'NONE';
        else if (tg > eb && Math.abs(esic - round0(tg * s.esiRate)) <= 3 && Math.abs(esic - round0(eb * s.esiRate)) > 3) esiMode = 'TOTAL_GROSS';
        else esiMode = 'EARN_BASIC';
      }

      const p = {
        empId: cleanCode(r.empId),
        name: text(r.name),
        father: text(r.father),
        pfNo: text(r.pfNo),
        esiNo: text(r.esiNo),
        gender: text(r.gender),
        category: text(r.category),
        basic: Number(r.basic) || 0,
        gross: Number(r.gross) || 0,
        paidDays: paid,
        otHours: Number(r.overtimeHours) || 0,
        earnBasic: eb,
        totalGross: tg,
        manualAmount: Number(r.manualAmount) || 0,
        prevPf: round0(pf),
        prevEsi: round0(esic),
        pfMode,
        esiMode,
        remarks: text(r.remarks)
      };
      const ck = codeKey(p.empId);
      if (ck && !profiles.byCode[ck]) {
        profiles.byCode[ck] = p;
        profiles.count++;
      }
      const nk = nameKey(p.name);
      if (nk && !profiles.byName[nk]) profiles.byName[nk] = p;
      profiles.list.push(p);
    });
    return profiles;
  }

  function computeLastMonthAudit(currentRows, prevProfiles) {
    const cur = Array.isArray(currentRows) ? currentRows : [];
    const curCodes = new Set();
    const curNames = new Set();
    const zeroDayCurrent = [];
    const matched = [];
    const cardShifts = [];

    cur.forEach(r => {
      const ck = codeKey(r.empId);
      const nk = nameKey(r.name);
      if (ck) curCodes.add(ck);
      if (nk) curNames.add(nk);
      if (r.cardShiftedFrom) {
        cardShifts.push({
          empId: r.empId,
          name: r.name,
          fromCard: r.cardShiftedFrom,
          toCard: r.category,
          paidDays: r.paidDays,
          pfEmployee: r.pfEmployee || 0,
          esiEmployee: r.esiEmployee || 0
        });
      }
      if ((r.paidDays <= 0 || r.earnBasic <= 0 || norm(r.remarks) === 'off roll') &&
          ((r.prevPfEmployee || 0) > 0 || (r.prevEsiEmployee || 0) > 0 || validId(r.pfNo) || validId(r.esiNo))) {
        zeroDayCurrent.push({
          empId: r.empId,
          name: r.name,
          category: r.category,
          prevPf: r.prevPfEmployee || 0,
          prevEsi: r.prevEsiEmployee || 0,
          currPf: r.pfEmployee || 0,
          currEsi: r.esiEmployee || 0,
          paidDays: r.paidDays || 0,
          reason: '0 Paid Days / Off Roll in Mam Sheet — ₹0 PF & ₹0 ESIC'
        });
      }
    });

    const skippedAbsent = [];
    if (prevProfiles) {
      const list = Array.isArray(prevProfiles.list) && prevProfiles.list.length
        ? prevProfiles.list
        : Object.values(prevProfiles.byCode || {});
      list.forEach(p => {
        if (!p) return;
        const ck = codeKey(p.empId);
        const nk = nameKey(p.name);
        const isPresent = (ck && curCodes.has(ck)) || (nk && curNames.has(nk));
        if (!isPresent) {
          skippedAbsent.push({
            empId: p.empId,
            name: p.name,
            category: p.category || '',
            pfNo: p.pfNo || 'NA',
            esiNo: p.esiNo || 'NA',
            prevPf: Number(p.prevPf) || 0,
            prevEsi: Number(p.prevEsi) || 0,
            currPf: 0,
            currEsi: 0,
            pfMode: p.pfMode || 'AUTO',
            esiMode: p.esiMode || 'AUTO',
            reason: (Number(p.prevPf) > 0 || Number(p.prevEsi) > 0)
              ? 'Not in Mam Sheet (Left / Absent) — ₹0 PF & ₹0 ESIC'
              : 'Not in Mam Sheet (Absent) — ₹0'
          });
        } else {
          const curRow = cur.find(r => (ck && codeKey(r.empId) === ck) || (nk && nameKey(r.name) === nk));
          if (curRow) {
            matched.push({
              empId: curRow.empId,
              name: curRow.name,
              category: curRow.category,
              prevPf: Number(p.prevPf) || 0,
              currPf: curRow.pfEmployee || 0,
              prevEsi: Number(p.prevEsi) || 0,
              currEsi: curRow.esiEmployee || 0,
              pfMode: curRow.pfMode,
              esiMode: curRow.esiMode,
              paidDays: curRow.paidDays
            });
          }
        }
      });
    }

    return {
      sourceFile: (prevProfiles && prevProfiles.sourceFile) || '',
      sourceMonth: (prevProfiles && prevProfiles.month) || '',
      matchedCount: matched.length,
      skippedAbsentCount: skippedAbsent.length,
      skippedWithPrevDeductionCount: skippedAbsent.filter(x => x.prevPf > 0 || x.prevEsi > 0).length,
      zeroDayCurrentCount: zeroDayCurrent.length,
      cardShiftCount: cardShifts.length,
      matched,
      skippedAbsent,
      zeroDayCurrent,
      cardShifts
    };
  }

  function indexEmployeeMaster(employees) {
    const byCode = {};
    const byName = {};
    const nameCounts = {};
    (employees || []).forEach(e => {
      if (!e) return;
      const nk = nameKey(e.name || e.emp_name);
      if (nk) nameCounts[nk] = (nameCounts[nk] || 0) + 1;
    });
    (employees || []).forEach(e => {
      if (!e) return;
      const ck = codeKey(e.emp_id || e.employee_id || e.code);
      if (ck && !byCode[ck]) byCode[ck] = e;
      const nk = nameKey(e.name || e.emp_name);
      if (nk && nameCounts[nk] === 1) byName[nk] = e;
    });
    return { byCode, byName, count: Object.keys(byCode).length };
  }

  function splitPaidDays(paidDays, hd) {
    const d = Math.max(0, Number(paidDays) || 0);
    const halfHoliday = Math.max(0, Number(hd) || 0);
    const sunAllow = d <= 0 ? 0 : Math.min(4, Math.floor(d / 6));
    const workingDays = Math.max(0, round2(d - sunAllow - halfHoliday));
    return { workingDays, sunAllow, hd: halfHoliday };
  }

  function calculateTotalGross(basic, gross, paidDays, otHours, settings) {
    const s = settingsOf(settings);
    const md = s.monthDays || 31;
    const d = Math.max(0, Number(paidDays) || 0);
    const ot = Math.max(0, Number(otHours) || 0);
    const b = Math.max(0, Number(basic) || 0);
    const g = Math.max(0, Number(gross) || 0);
    if (d <= 0 || g <= 0) return 0;
    const hra = Math.max(0, round0(g - b));
    const eb = round0(b * d / md);
    const eh = hra > 0 ? round0(hra * d / md) : 0;
    const ge = hra > 0 ? (eb + eh) : round0(g * d / md);
    let bonus = 0;
    if (s.bonusMode === 'BASIC_833') bonus = round0(eb * (s.bonusRate / 100));
    else if (s.bonusMode === 'GROSS_10') bonus = round0(ge * 0.10);
    const otAmt = s.otDivisor > 0 ? round0((g / s.otDivisor) * ot) : 0;
    return round0(ge + bonus + otAmt);
  }

  // Verified Greedy-Highest-Days-First solver matching Lokesh compliance sheet patterns (98.4% within Rs.350 diff)
  function deriveDaysAndOt(manualAmount, basic, gross, settings) {
    const s = settingsOf(settings);
    const md = s.monthDays || 31;
    const wanted = num(manualAmount);
    if (wanted === null || wanted <= 0 || !gross || gross <= 0) {
      return { paidDays: 0, workingDays: 0, sunAllow: 0, hd: 0, overtimeHours: 0, totalGross: 0 };
    }
    let bestDays = 0;
    for (let d = md; d >= 0; d--) {
      if (calculateTotalGross(basic, gross, d, 0, s) <= wanted) {
        bestDays = d;
        break;
      }
    }
    let bestOt = 0;
    for (let o = 0; o <= s.maxOtHours; o++) {
      if (calculateTotalGross(basic, gross, bestDays, o, s) <= wanted) {
        bestOt = o;
      } else {
        break;
      }
    }
    const split = splitPaidDays(bestDays, 0);
    return {
      paidDays: bestDays,
      workingDays: split.workingDays,
      sunAllow: split.sunAllow,
      hd: 0,
      overtimeHours: bestOt,
      totalGross: calculateTotalGross(basic, gross, bestDays, bestOt, s)
    };
  }

  function recalculateRow(row, settings) {
    const s = settingsOf(settings);
    row.monthDays = Math.max(1, num(row.monthDays) || s.monthDays || 31);
    row.basic = Math.max(0, num(row.basic) || 0);
    const hasExplicitHra = row.hra !== undefined && row.hra !== null && row.hra !== '';
    if (row._salaryPartsEdited) {
      row.hra = Math.max(0, num(row.hra) || 0);
      row.gross = round0(row.basic + row.hra);
    } else {
      row.gross = Math.max(0, num(row.gross) || 0);
      row.hra = hasExplicitHra ? Math.max(0, num(row.hra) || 0) : Math.max(0, round0(row.gross - row.basic));
      if (row.gross <= 0 && (row.basic > 0 || row.hra > 0)) {
        row.gross = round0(row.basic + row.hra);
      }
    }

    if (row._attendanceEdited && row._attendancePartsLocked) {
      row.workingDays = Math.max(0, num(row.workingDays) || 0);
      row.sunAllow = Math.max(0, num(row.sunAllow) || 0);
      row.hd = Math.max(0, num(row.hd) || 0);
      row.paidDays = Math.max(0, Math.min(row.monthDays, round2(row.workingDays + row.sunAllow + row.hd)));
    } else {
      row.paidDays = Math.max(0, Math.min(row.monthDays, num(row.paidDays) || 0));
      const split = splitPaidDays(row.paidDays, row.hd || 0);
      if (row.workingDays === undefined || row.workingDays === null || !row._attendancePartsLocked) {
        row.sunAllow = split.sunAllow;
        row.hd = split.hd;
        row.workingDays = split.workingDays;
      } else {
        row.workingDays = Math.max(0, num(row.workingDays) || 0);
        row.sunAllow = Math.max(0, num(row.sunAllow) || 0);
        row.hd = Math.max(0, num(row.hd) || 0);
      }
    }

    row.absent = Math.max(0, round2(row.monthDays - row.paidDays));
    row.overtimeHours = Math.max(0, num(row.overtimeHours) || 0);
    row.manualAmount = num(row.manualAmount);
    row.advance = Math.max(0, num(row.advance) || 0);

    const rowSettings = Object.assign({}, s, { monthDays: row.monthDays });
    row.earnBasic = row.paidDays > 0 ? round0(row.basic * row.paidDays / row.monthDays) : 0;
    row.earnHra = row.paidDays > 0 ? round0(row.hra * row.paidDays / row.monthDays) : 0;
    row.grossEarned = row.paidDays > 0
      ? (row.hra > 0 ? (row.earnBasic + row.earnHra) : round0(row.gross * row.paidDays / row.monthDays))
      : 0;
    row.earnedBonus = (row.paidDays > 0 && row.gross > 0)
      ? (s.bonusMode === 'BASIC_833'
        ? round0(row.earnBasic * (s.bonusRate / 100))
        : (s.bonusMode === 'GROSS_10' ? round0(row.grossEarned * 0.10) : 0))
      : 0;
    row.otAmount = (row.paidDays > 0 && row.gross > 0 && s.otDivisor > 0)
      ? round0((row.gross / s.otDivisor) * row.overtimeHours)
      : 0;
    row.totalGross = (row.paidDays > 0 && row.gross > 0)
      ? round0(row.grossEarned + row.earnedBonus + row.otAmount)
      : 0;

    if (row.manualAmount === null) {
      row.diffAmount = 0;
    } else {
      const rawDiff = round0(row.manualAmount - row.totalGross);
      row.diffAmount = s.clampNegativeDiff ? Math.max(0, rawDiff) : rawDiff;
    }

    // PF@12% (Strictly ₹0 if paidDays <= 0, earnBasic <= 0, gross <= 0, or NONE)
    const hasPf = validId(row.pfNo);
    const effectivePfMode = row.pfMode && row.pfMode !== 'AUTO' ? row.pfMode : (hasPf ? s.pfDefaultMode : 'NONE');
    if (effectivePfMode === 'NONE' || !hasPf || row.paidDays <= 0 || row.earnBasic <= 0 || row.gross <= 0) {
      row.pfWage = 0;
      row.pfEmployee = 0;
      row.pfEmployer = 0;
    } else if (effectivePfMode === 'CAP_15000') {
      row.pfWage = Math.min(s.pfCap || 15000, row.earnBasic);
      row.pfEmployee = round0(row.pfWage * s.pfRate);
      row.pfEmployer = round0(row.pfWage * s.pfEmployerRate);
    } else if (effectivePfMode === 'GROSS_12') {
      row.pfWage = row.totalGross;
      row.pfEmployee = round0(row.pfWage * s.pfRate);
      row.pfEmployer = round0(row.pfWage * s.pfEmployerRate);
    } else {
      row.pfWage = row.earnBasic;
      row.pfEmployee = round0(row.pfWage * s.pfRate);
      row.pfEmployer = round0(row.pfWage * s.pfEmployerRate);
    }

    // ESIC@0.75% (Strictly ₹0 if paidDays <= 0, earnBasic <= 0, gross <= 0, or NONE)
    const hasEsi = validId(row.esiNo);
    const effectiveEsiMode = row.esiMode && row.esiMode !== 'AUTO' ? row.esiMode : (hasEsi ? s.esiBase : 'NONE');
    if (effectiveEsiMode === 'NONE' || !hasEsi || row.paidDays <= 0 || row.earnBasic <= 0 || row.gross <= 0) {
      row.esiWage = 0;
      row.esiEmployee = 0;
      row.esiEmployer = 0;
    } else {
      row.esiWage = effectiveEsiMode === 'TOTAL_GROSS' ? row.totalGross : row.earnBasic;
      row.esiEmployee = round0(row.esiWage * s.esiRate);
      row.esiEmployer = round0(row.esiWage * s.esiEmployerRate);
    }

    row.totalDeduction = round0(row.pfEmployee + row.esiEmployee + row.advance);
    row.netPayable = row.paymentHold ? 0 : Math.max(0, round0(row.totalGross - row.totalDeduction));

    if (!row._remarksEdited) {
      row.remarks = (row.paidDays > 0 && row.gross > 0) ? 'onroll' : 'off roll';
    }

    // Audit flags for easy filtering
    const flags = [];
    if (!row.masterMatched) flags.push('Missing in Employee Master');
    if (!row.gross || !row.basic || row.paidDays <= 0) flags.push('Basic/Gross/Days 0 (Off Roll)');
    if (hasPf && row.pfEmployee === 0 && row.earnBasic > 0) flags.push('PF Exempt');
    if (row.manualAmount !== null && row.totalGross > row.manualAmount) flags.push('Total Gross > Manual');
    if (row.isDuplicate) flags.push('Duplicate Code in Mam');
    if (row.cardShiftedFrom) flags.push('Card Shifted: ' + row.cardShiftedFrom + ' → ' + row.category);
    row.flags = flags;
    row.status = flags.length ? 'REVIEW' : 'READY';
    return row;
  }

  function generateComplianceRows(mamRows, employees, options) {
    const opts = options || {};
    const s = settingsOf(opts.settings);
    const master = indexEmployeeMaster(employees);
    const masterCardMap = buildMasterCardMap(employees);
    const profiles = opts.profiles || { byCode: {}, byName: {} };
    const advanceMap = opts.advanceMap || {};

    const codeCounts = {};
    (mamRows || []).forEach(m => {
      const ck = codeKey(m.code);
      if (ck) codeCounts[ck] = (codeCounts[ck] || 0) + 1;
    });

    // Strictly iterate ONLY Mam sheet employees — any employee from last month who is absent this month is NEVER added.
    return (mamRows || []).map((m, idx) => {
      const rawCk = codeKey(m.code);
      const nk = nameKey(m.name);
      const emp = (rawCk && master.byCode[rawCk]) || (nk && master.byName[nk]) || null;
      const prof = (rawCk && profiles.byCode && profiles.byCode[rawCk]) || (nk && profiles.byName && profiles.byName[nk]) || null;

      const empId = cleanCode(emp && (emp.emp_id || emp.employee_id || emp.code)) || cleanCode(prof && prof.empId) || cleanCode(m.code);
      const ck = codeKey(empId) || rawCk;

      const empGross = num(emp && (emp.gross || emp.new_gross));
      const empBasic = num(emp && emp.basic);
      const empHra = num(emp && emp.hra);
      const profGross = num(prof && prof.gross);
      const profBasic = num(prof && prof.basic);
      const profHra = num(prof && prof.hra);

      let gross = empGross && empGross > 0 ? round0(empGross) : (profGross && profGross > 0 ? round0(profGross) : 0);
      let basic = empBasic && empBasic > 0 ? round0(empBasic) : (profBasic && profBasic > 0 ? round0(profBasic) : (gross > 0 ? round0(gross / 1.15) : 0));
      let hra = (empHra !== null && empHra >= 0 && empBasic > 0)
        ? round0(empHra)
        : ((profHra !== null && profHra >= 0 && profBasic > 0) ? round0(profHra) : Math.max(0, round0(gross - basic)));
      if (gross <= 0 && (basic > 0 || hra > 0)) gross = round0(basic + hra);
      if (gross > 0 && basic > 0 && (basic + hra) !== gross && !(empHra > 0)) {
        hra = Math.max(0, round0(gross - basic));
      }

      const pfNo = text(emp && (emp.pf_no || emp.pfNo)) || text(prof && prof.pfNo) || 'NA';
      const esiNo = text(emp && (emp.esi_no || emp.esiNo)) || text(prof && prof.esiNo) || 'NA';

      // Card shift rule: If Mam sheet places employee under an explicit Card / section (e.g. C7 / Card No.7),
      // shift employee directly to that Card instead of forcing Employee Master's old Card (e.g. CARD NO. 1).
      const masterCatRaw = text(emp && (emp.cat2 || emp.cat1)).toUpperCase();
      const profCatRaw = text(prof && prof.category).toUpperCase();
      const mamCatRaw = text(m.category);
      const mamCardNum = parseCardNumber(mamCatRaw);
      const mamCatNormalized = canonicalizeCardCategory(mamCatRaw, masterCardMap);
      const mamExplicitCard = !!(mamCatRaw && (m.hasExplicitCategory || mamCardNum));

      let category = '';
      let mamCategoryLocked = false;
      let cardShiftedFrom = '';
      if (mamExplicitCard && mamCatNormalized) {
        category = mamCatNormalized;
        mamCategoryLocked = true;
        if (masterCatRaw && canonicalizeCardCategory(masterCatRaw, masterCardMap) !== category) {
          cardShiftedFrom = masterCatRaw;
        }
      } else {
        category = masterCatRaw || profCatRaw || mamCatNormalized || 'OTHER';
      }

      const designation = text(emp && (emp.desig || emp.designation)) || '';
      const department = text(emp && (emp.dept || emp.department)) || '';
      const cat1 = text(emp && emp.cat1) || department || category.toUpperCase();
      const father = text(emp && (emp.father || emp.fathers_name)) || text(prof && prof.father) || '';
      const gender = text(emp && emp.gender) || text(prof && prof.gender) || '';
      const dob = text(emp && emp.dob) || '';
      const doj = text(emp && emp.doj) || '';
      const bankName = text(emp && (emp.bank_name || emp.bankName)) || '';
      const ifsc = text(emp && emp.ifsc) || '';
      const accountNo = text(emp && (emp.account_no || emp.accountNo)) || '';

      const advAmt = (s.autoPullAdvance && ck && num(advanceMap[ck]) !== null) ? round0(advanceMap[ck]) : 0;
      const derived = deriveDaysAndOt(m.manualAmount, basic, gross, s);

      const row = {
        uid: 'r_' + idx + '_' + (ck || 'nocode'),
        _index: idx,
        empId,
        name: text(emp && emp.name) || text(m.name) || text(prof && prof.name),
        mamName: text(m.name),
        father,
        dob,
        doj,
        pfNo,
        esiNo,
        gender,
        department,
        designation,
        cat1: cat1.toUpperCase(),
        category: category.toUpperCase(),
        mamCategory: mamCatRaw,
        mamCategoryLocked,
        cardShiftedFrom,
        basic,
        hra,
        gross,
        monthDays: s.monthDays,
        workingDays: derived.workingDays,
        sunAllow: derived.sunAllow,
        hd: derived.hd || 0,
        absent: s.monthDays - derived.paidDays,
        paidDays: derived.paidDays,
        overtimeHours: derived.overtimeHours,
        earnBasic: 0,
        earnHra: 0,
        grossEarned: 0,
        earnedBonus: 0,
        otAmount: 0,
        totalGross: 0,
        manualAmount: m.manualAmount === null ? 0 : round0(m.manualAmount),
        diffAmount: 0,
        pfMode: (prof && prof.pfMode) || 'AUTO',
        esiMode: (prof && prof.esiMode) || 'AUTO',
        prevPfEmployee: prof ? (Number(prof.prevPf) || 0) : 0,
        prevEsiEmployee: prof ? (Number(prof.prevEsi) || 0) : 0,
        prevPfMode: (prof && prof.pfMode) || '',
        prevEsiMode: (prof && prof.esiMode) || '',
        pfWage: 0,
        pfEmployee: 0,
        pfEmployer: 0,
        esiWage: 0,
        esiEmployee: 0,
        esiEmployer: 0,
        advance: advAmt,
        totalDeduction: 0,
        netPayable: 0,
        remarks: '',
        paymentHold: false,
        bankName,
        ifsc,
        accountNo,
        masterMatched: !!emp,
        isDuplicate: !!(rawCk && codeCounts[rawCk] > 1),
        source: m.source || ''
      };
      return recalculateRow(row, s);
    });
  }

  function computeTotals(rows) {
    const sum = k => (rows || []).reduce((acc, r) => acc + (Number(r && r[k]) || 0), 0);
    return {
      count: (rows || []).length,
      onroll: (rows || []).filter(r => norm(r.remarks) !== 'off roll' && r.paidDays > 0).length,
      offroll: (rows || []).filter(r => norm(r.remarks) === 'off roll' || r.paidDays === 0).length,
      basic: round0(sum('basic')),
      hra: round0(sum('hra')),
      gross: round0(sum('gross')),
      workingDays: round2(sum('workingDays')),
      sunAllow: round2(sum('sunAllow')),
      hd: round2(sum('hd')),
      absent: round2(sum('absent')),
      paidDays: round2(sum('paidDays')),
      overtimeHours: round2(sum('overtimeHours')),
      earnBasic: round0(sum('earnBasic')),
      earnHra: round0(sum('earnHra')),
      grossEarned: round0(sum('grossEarned')),
      earnedBonus: round0(sum('earnedBonus')),
      otAmount: round0(sum('otAmount')),
      totalGross: round0(sum('totalGross')),
      manualAmount: round0(sum('manualAmount')),
      diffAmount: round0(sum('diffAmount')),
      pfEmployee: round0(sum('pfEmployee')),
      pfEmployer: round0(sum('pfEmployer')),
      esiEmployee: round0(sum('esiEmployee')),
      esiEmployer: round0(sum('esiEmployer')),
      advance: round0(sum('advance')),
      totalDeduction: round0(sum('totalDeduction')),
      netPayable: round0(sum('netPayable'))
    };
  }

  function colIdxToLetters(idx) {
    let n = Math.max(0, Number(idx) || 0) + 1;
    let out = '';
    while (n > 0) {
      const rem = (n - 1) % 26;
      out = String.fromCharCode(65 + rem) + out;
      n = Math.floor((n - 1) / 26);
    }
    return out || 'A';
  }

  function safeSheetName(value, used) {
    let base = text(value).replace(/[\\/?*\[\]:]/g, ' ').replace(/^'+|'+$/g, '').replace(/'/g, '').replace(/\s+/g, ' ').trim().slice(0, 31) || 'OTHER';
    if (base.toLowerCase() === 'history') base = 'History Log';
    let name = base, n = 2;
    while (used.has(name.toLowerCase()) || name.toLowerCase() === 'history') {
      const suf = ' ' + n++;
      name = base.slice(0, 31 - suf.length) + suf;
    }
    used.add(name.toLowerCase());
    return name;
  }

  function autoFitColsFromAoa(aoa, minW, maxW) {
    const lo = minW || 9;
    const hi = maxW || 34;
    const widths = [];
    (aoa || []).forEach(row => {
      (row || []).forEach((val, idx) => {
        const len = text(val).length + 3;
        if (!widths[idx] || len > widths[idx]) widths[idx] = len;
      });
    });
    return widths.map((w, idx) => ({ wch: idx === 0 ? Math.max(7, Math.min(12, w)) : Math.max(lo, Math.min(hi, w)) }));
  }

  function colLettersToIndex0(colLetter) {
    let col = 0;
    const s = String(colLetter || '').toUpperCase().replace(/[^A-Z]/g, '');
    for (let i = 0; i < s.length; i++) col = col * 26 + (s.charCodeAt(i) - 64);
    return Math.max(0, col - 1);
  }

  function applyNumericFormatsAndFormulaRow(ws, aoa, numColIndices, formulaCols, textColIndices, headerRow1) {
    if (!ws || !Array.isArray(aoa) || !aoa.length) return;
    const hdrRow = headerRow1 || 1;
    const firstDataRow = hdrRow + 1;
    const totalRowIdx = aoa.length;
    const lastDataRow = aoa.length - 1;
    for (let r = firstDataRow; r <= lastDataRow; r++) {
      (numColIndices || []).forEach(cIdx => {
        const addr = colIdxToLetters(cIdx) + r;
        if (ws[addr] && ws[addr].t === 'n') ws[addr].z = '#,##0';
      });
      (textColIndices || []).forEach(cIdx => {
        const addr = colIdxToLetters(cIdx) + r;
        if (ws[addr]) { ws[addr].t = 's'; ws[addr].z = '@'; }
      });
    }
    if (lastDataRow >= firstDataRow && Array.isArray(formulaCols)) {
      formulaCols.forEach(colLetter => {
        const addr = colLetter + totalRowIdx;
        const cIdx = colLettersToIndex0(colLetter);
        const val = Number((aoa[aoa.length - 1] || [])[cIdx]) || 0;
        ws[addr] = { t: 'n', f: `SUM(${colLetter}${firstDataRow}:${colLetter}${lastDataRow})`, v: val, z: '#,##0' };
      });
    }
  }

  function normalizeRowExportFields(r, s) {
    const monthDays = Number(r.monthDays) || s.monthDays || 31;
    const basic = Number(r.basic) || 0;
    const gross = Number(r.gross) || 0;
    const hra = (r.hra !== undefined && r.hra !== null && r.hra !== '') ? (Number(r.hra) || 0) : Math.max(0, round0(gross - basic));
    const paidDays = Number(r.paidDays) || 0;
    const hd = Number(r.hd) || 0;
    const hasSplit = (r.workingDays !== undefined && r.workingDays !== null) && (r.sunAllow !== undefined && r.sunAllow !== null);
    const split = splitPaidDays(paidDays, hd);
    const sunAllow = hasSplit ? (Number(r.sunAllow) || 0) : split.sunAllow;
    const workingDays = hasSplit ? (Number(r.workingDays) || 0) : split.workingDays;
    const earnBasic = (r.earnBasic !== undefined && r.earnBasic !== null) ? (Number(r.earnBasic) || 0) : (paidDays > 0 ? round0(basic * paidDays / monthDays) : 0);
    const earnHra = (r.earnHra !== undefined && r.earnHra !== null) ? (Number(r.earnHra) || 0) : (paidDays > 0 ? round0(hra * paidDays / monthDays) : 0);
    const grossEarned = (r.grossEarned !== undefined && r.grossEarned !== null) ? (Number(r.grossEarned) || 0) : (hra > 0 ? (earnBasic + earnHra) : (paidDays > 0 ? round0(gross * paidDays / monthDays) : 0));
    const earnedBonus = (r.earnedBonus !== undefined && r.earnedBonus !== null)
      ? (Number(r.earnedBonus) || 0)
      : (paidDays > 0 && gross > 0
        ? (s.bonusMode === 'BASIC_833' ? round0(earnBasic * (s.bonusRate / 100)) : (s.bonusMode === 'GROSS_10' ? round0(grossEarned * 0.10) : 0))
        : 0);
    const otHours = Number(r.overtimeHours) || 0;
    const otAmount = (r.otAmount !== undefined && r.otAmount !== null)
      ? (Number(r.otAmount) || 0)
      : (paidDays > 0 && gross > 0 && (s.otDivisor || 104) > 0 ? round0((gross / (s.otDivisor || 104)) * otHours) : 0);
    return Object.assign({}, r, {
      monthDays, basic, hra, gross: gross || round0(basic + hra),
      workingDays, sunAllow, hd, paidDays, overtimeHours: otHours,
      absent: Math.max(0, round2(monthDays - paidDays)),
      earnBasic, earnHra, grossEarned, earnedBonus, otAmount,
      cat1: text(r.cat1) || text(r.department) || text(r.category)
    });
  }

  function wireCompactFormulasForSheet(ws, rows, s, headerRow1) {
    const hdrRow = headerRow1 || 1;
    const firstDataRow = hdrRow + 1;
    const bonusFactor = s.bonusMode === 'BASIC_833' ? (s.bonusRate / 100) : 0;
    const grossBonusFactor = s.bonusMode === 'GROSS_10' ? 0.10 : 0;
    const otDiv = s.otDivisor || 104;
    const totals = computeTotals(rows);
    const totalRowIdx = rows.length + hdrRow + 1;
    const useFormulas = s.includeFormulas !== false;

    rows.forEach((rawRow, i) => {
      const r = normalizeRowExportFields(rawRow, s);
      const xlRow = firstDataRow + i;
      const setFormula = (colLetter, formula, val) => {
        const addr = colLetter + xlRow;
        ws[addr] = useFormulas
          ? { t: 'n', f: formula, v: Number(val) || 0, z: '#,##0' }
          : { t: 'n', v: Number(val) || 0, z: '#,##0' };
      };
      setFormula('L', `MAX(0,K${xlRow}-M${xlRow})`, r.absent);
      setFormula('O', `IF(M${xlRow}>0,ROUND(I${xlRow}*M${xlRow}/K${xlRow},0),0)`, r.earnBasic);
      setFormula('P', `IF(M${xlRow}>0,ROUND(J${xlRow}*M${xlRow}/K${xlRow},0),0)`, r.grossEarned);

      let tgFormula = `IF(OR(M${xlRow}<=0,J${xlRow}<=0),0,ROUND(P${xlRow}`;
      if (bonusFactor > 0) tgFormula += `+ROUND(O${xlRow}*${bonusFactor},0)`;
      else if (grossBonusFactor > 0) tgFormula += `+ROUND(P${xlRow}*${grossBonusFactor},0)`;
      tgFormula += `+ROUND((J${xlRow}/${otDiv})*N${xlRow},0),0))`;
      setFormula('Q', tgFormula, r.totalGross);
      setFormula('S', s.clampNegativeDiff ? `MAX(0,R${xlRow}-Q${xlRow})` : `(R${xlRow}-Q${xlRow})`, r.diffAmount);

      const hasPf = validId(r.pfNo);
      const effPfMode = r.pfMode && r.pfMode !== 'AUTO' ? r.pfMode : (hasPf ? s.pfDefaultMode : 'NONE');
      if (effPfMode === 'NONE' || !hasPf || r.paidDays <= 0 || r.earnBasic <= 0 || r.gross <= 0) {
        setFormula('T', '0', 0);
      } else if (effPfMode === 'CAP_15000') {
        setFormula('T', `IF(M${xlRow}<=0,0,ROUND(MIN(${s.pfCap || 15000},O${xlRow})*${s.pfRate},0))`, r.pfEmployee);
      } else if (effPfMode === 'GROSS_12') {
        setFormula('T', `IF(M${xlRow}<=0,0,ROUND(Q${xlRow}*${s.pfRate},0))`, r.pfEmployee);
      } else {
        setFormula('T', `IF(M${xlRow}<=0,0,ROUND(O${xlRow}*${s.pfRate},0))`, r.pfEmployee);
      }

      const hasEsi = validId(r.esiNo);
      const effEsiMode = r.esiMode && r.esiMode !== 'AUTO' ? r.esiMode : (hasEsi ? s.esiBase : 'NONE');
      if (effEsiMode === 'NONE' || !hasEsi || r.paidDays <= 0 || r.earnBasic <= 0 || r.gross <= 0) {
        setFormula('U', '0', 0);
      } else if (effEsiMode === 'TOTAL_GROSS') {
        setFormula('U', `IF(M${xlRow}<=0,0,ROUND(Q${xlRow}*${s.esiRate},0))`, r.esiEmployee);
      } else {
        setFormula('U', `IF(M${xlRow}<=0,0,ROUND(O${xlRow}*${s.esiRate},0))`, r.esiEmployee);
      }

      setFormula('W', `T${xlRow}+U${xlRow}+V${xlRow}`, r.totalDeduction);
      setFormula('X', r.paymentHold ? '0' : `MAX(0,Q${xlRow}-W${xlRow})`, r.netPayable);

      ['I', 'J', 'K', 'M', 'N', 'R', 'V'].forEach(colL => {
        const cell = ws[colL + xlRow];
        if (cell && cell.t === 'n') cell.z = '#,##0';
      });
      ['B', 'E', 'F'].forEach(c => {
        const cell = ws[c + xlRow];
        if (cell) { cell.t = 's'; cell.z = '@'; }
      });
    });

    if (rows.length > 0) {
      const lastRow = firstDataRow + rows.length - 1;
      const keyMap = {
        I: 'basic', J: 'gross', O: 'earnBasic', P: 'grossEarned',
        Q: 'totalGross', R: 'manualAmount', S: 'diffAmount', T: 'pfEmployee',
        U: 'esiEmployee', V: 'advance', W: 'totalDeduction', X: 'netPayable'
      };
      Object.keys(keyMap).forEach(colLetter => {
        ws[colLetter + totalRowIdx] = useFormulas
          ? { t: 'n', f: `SUM(${colLetter}${firstDataRow}:${colLetter}${lastRow})`, v: totals[keyMap[colLetter]] || 0, z: '#,##0' }
          : { t: 'n', v: totals[keyMap[colLetter]] || 0, z: '#,##0' };
      });
      ws['!autofilter'] = { ref: `A${hdrRow}:Y${lastRow}` };
    }
    const preRows = hdrRow > 1 ? Array.from({ length: hdrRow - 1 }, () => ({ hpt: 22 })) : [];
    ws['!rows'] = preRows.concat([{ hpt: 28 }]).concat(rows.map(() => ({ hpt: 20 }))).concat([{ hpt: 24 }]);
  }

  function wireComplianceFormulasForSheet(ws, rows, s, headerRow1) {
    const hdrRow = headerRow1 || 1;
    const firstDataRow = hdrRow + 1;
    const bonusFactor = s.bonusMode === 'BASIC_833' ? (s.bonusRate / 100) : 0;
    const grossBonusFactor = s.bonusMode === 'GROSS_10' ? 0.10 : 0;
    const otDiv = s.otDivisor || 104;
    const normRows = rows.map(r => normalizeRowExportFields(r, s));
    const totals = computeTotals(normRows);
    const totalRowIdx = normRows.length + hdrRow + 1;
    const useFormulas = s.includeFormulas !== false;

    normRows.forEach((r, i) => {
      const xlRow = firstDataRow + i;
      const setFormula = (colLetter, formula, val) => {
        const addr = colLetter + xlRow;
        ws[addr] = useFormulas
          ? { t: 'n', f: formula, v: Number(val) || 0, z: '#,##0' }
          : { t: 'n', v: Number(val) || 0, z: '#,##0' };
      };

      // P: Gross Total Salary = Basic (N) + HRA (O)
      setFormula('P', `N${xlRow}+O${xlRow}`, r.gross);
      // V: Paid Days = MIN(MonthOfDays Q, WorkingDays R + SunAllow S + HD T)
      setFormula('V', `MIN(Q${xlRow},R${xlRow}+S${xlRow}+T${xlRow})`, r.paidDays);
      // U: Absent = MAX(0, MonthOfDays Q - PaidDays V)
      setFormula('U', `MAX(0,Q${xlRow}-V${xlRow})`, r.absent);
      // X: Earn Basic = IF(V>0, ROUND(N*V/Q, 0), 0)
      setFormula('X', `IF(V${xlRow}>0,ROUND(N${xlRow}*V${xlRow}/Q${xlRow},0),0)`, r.earnBasic);
      // Y: Earn HRA = IF(V>0, ROUND(O*V/Q, 0), 0)
      setFormula('Y', `IF(V${xlRow}>0,ROUND(O${xlRow}*V${xlRow}/Q${xlRow},0),0)`, r.earnHra);
      // Z: Gross Earned Salary = Earn Basic (X) + Earn HRA (Y)
      setFormula('Z', `X${xlRow}+Y${xlRow}`, r.grossEarned);

      // AA: Earned Bonus 8.33%
      if (bonusFactor > 0) {
        setFormula('AA', `IF(V${xlRow}>0,ROUND(X${xlRow}*${bonusFactor},0),0)`, r.earnedBonus);
      } else if (grossBonusFactor > 0) {
        setFormula('AA', `IF(V${xlRow}>0,ROUND(Z${xlRow}*${grossBonusFactor},0),0)`, r.earnedBonus);
      } else {
        setFormula('AA', '0', 0);
      }

      // AB: OT Amount = IF(V>0, ROUND((P/otDiv)*W, 0), 0)
      setFormula('AB', otDiv > 0 ? `IF(V${xlRow}>0,ROUND((P${xlRow}/${otDiv})*W${xlRow},0),0)` : '0', r.otAmount);

      // AC: Total Gross salary = IF(OR(V<=0,P<=0),0,ROUND(Z+AA+AB,0))
      setFormula('AC', `IF(OR(V${xlRow}<=0,P${xlRow}<=0),0,ROUND(Z${xlRow}+AA${xlRow}+AB${xlRow},0))`, r.totalGross);

      // AE: Diff. Amount = Manual Amount (AD) - Total Gross (AC)
      setFormula('AE', s.clampNegativeDiff ? `MAX(0,AD${xlRow}-AC${xlRow})` : `(AD${xlRow}-AC${xlRow})`, r.diffAmount);

      // AF: PF@12% & AK: PF@13% (Employer)
      const hasPf = validId(r.pfNo);
      const effPfMode = r.pfMode && r.pfMode !== 'AUTO' ? r.pfMode : (hasPf ? s.pfDefaultMode : 'NONE');
      if (effPfMode === 'NONE' || !hasPf || r.paidDays <= 0 || r.earnBasic <= 0 || r.gross <= 0) {
        setFormula('AF', '0', 0);
        setFormula('AK', '0', 0);
      } else if (effPfMode === 'CAP_15000') {
        setFormula('AF', `IF(V${xlRow}<=0,0,ROUND(MIN(${s.pfCap || 15000},X${xlRow})*${s.pfRate},0))`, r.pfEmployee);
        setFormula('AK', `IF(V${xlRow}<=0,0,ROUND(MIN(${s.pfCap || 15000},X${xlRow})*${s.pfEmployerRate},0))`, r.pfEmployer);
      } else if (effPfMode === 'GROSS_12') {
        setFormula('AF', `IF(V${xlRow}<=0,0,ROUND(AC${xlRow}*${s.pfRate},0))`, r.pfEmployee);
        setFormula('AK', `IF(V${xlRow}<=0,0,ROUND(AC${xlRow}*${s.pfEmployerRate},0))`, r.pfEmployer);
      } else {
        setFormula('AF', `IF(V${xlRow}<=0,0,ROUND(X${xlRow}*${s.pfRate},0))`, r.pfEmployee);
        setFormula('AK', `IF(V${xlRow}<=0,0,ROUND(X${xlRow}*${s.pfEmployerRate},0))`, r.pfEmployer);
      }

      // AG: ESIC @0.75% & AL: ESI @3.25% (Employer)
      const hasEsi = validId(r.esiNo);
      const effEsiMode = r.esiMode && r.esiMode !== 'AUTO' ? r.esiMode : (hasEsi ? s.esiBase : 'NONE');
      if (effEsiMode === 'NONE' || !hasEsi || r.paidDays <= 0 || r.earnBasic <= 0 || r.gross <= 0) {
        setFormula('AG', '0', 0);
        setFormula('AL', '0', 0);
      } else if (effEsiMode === 'TOTAL_GROSS') {
        setFormula('AG', `IF(V${xlRow}<=0,0,ROUND(AC${xlRow}*${s.esiRate},0))`, r.esiEmployee);
        setFormula('AL', `IF(V${xlRow}<=0,0,ROUND(AC${xlRow}*${s.esiEmployerRate},0))`, r.esiEmployer);
      } else {
        setFormula('AG', `IF(V${xlRow}<=0,0,ROUND(X${xlRow}*${s.esiRate},0))`, r.esiEmployee);
        setFormula('AL', `IF(V${xlRow}<=0,0,ROUND(X${xlRow}*${s.esiEmployerRate},0))`, r.esiEmployer);
      }

      // AI: Total Deduction = PF@12% (AF) + ESIC@0.75% (AG) + Advance Deduction (AH)
      setFormula('AI', `AF${xlRow}+AG${xlRow}+AH${xlRow}`, r.totalDeduction);
      // AJ: Net Payable = MAX(0, Total Gross AC - Total Deduction AI) (or 0 on hold)
      setFormula('AJ', r.paymentHold ? '0' : `MAX(0,AC${xlRow}-AI${xlRow})`, r.netPayable);

      ['N', 'O', 'Q', 'R', 'S', 'T', 'W', 'AD', 'AH'].forEach(colL => {
        const cell = ws[colL + xlRow];
        if (cell && cell.t === 'n') cell.z = '#,##0';
      });
      ['B', 'E', 'F', 'G', 'H'].forEach(c => {
        const cell = ws[c + xlRow];
        if (cell) { cell.t = 's'; cell.z = '@'; }
      });
    });

    if (normRows.length > 0) {
      const lastRow = firstDataRow + normRows.length - 1;
      const keyMap = {
        N: 'basic', O: 'hra', P: 'gross', R: 'workingDays', S: 'sunAllow', T: 'hd', U: 'absent', V: 'paidDays', W: 'overtimeHours',
        X: 'earnBasic', Y: 'earnHra', Z: 'grossEarned', AA: 'earnedBonus', AB: 'otAmount',
        AC: 'totalGross', AD: 'manualAmount', AE: 'diffAmount', AF: 'pfEmployee',
        AG: 'esiEmployee', AH: 'advance', AI: 'totalDeduction', AJ: 'netPayable',
        AK: 'pfEmployer', AL: 'esiEmployer'
      };
      Object.keys(keyMap).forEach(colLetter => {
        ws[colLetter + totalRowIdx] = useFormulas
          ? { t: 'n', f: `SUM(${colLetter}${firstDataRow}:${colLetter}${lastRow})`, v: totals[keyMap[colLetter]] || 0, z: '#,##0' }
          : { t: 'n', v: totals[keyMap[colLetter]] || 0, z: '#,##0' };
      });
      ws['!autofilter'] = { ref: `A${hdrRow}:AM${lastRow}` };
    }
    const preRows = hdrRow > 1 ? Array.from({ length: hdrRow - 1 }, () => ({ hpt: 22 })) : [];
    ws['!rows'] = preRows.concat([{ hpt: 30 }]).concat(normRows.map(() => ({ hpt: 20 }))).concat([{ hpt: 24 }]);
  }

  function mainRowFullAoa(r, i, s) {
    return [
      i + 1,
      text(r.empId),
      text(r.name),
      text(r.father),
      text(r.dob),
      text(r.doj),
      text(r.pfNo) || 'NA',
      text(r.esiNo) || 'NA',
      text(r.gender),
      text(r.department),
      text(r.designation),
      text(r.cat1 || r.category),
      text(r.category),
      Number(r.basic) || 0,
      Number(r.hra) || 0,
      Number(r.gross) || 0,
      Number(r.monthDays) || s.monthDays,
      Number(r.workingDays) || 0,
      Number(r.sunAllow) || 0,
      Number(r.hd) || 0,
      Number(r.absent) || 0,
      Number(r.paidDays) || 0,
      Number(r.overtimeHours) || 0,
      Number(r.earnBasic) || 0,
      Number(r.earnHra) || 0,
      Number(r.grossEarned) || 0,
      Number(r.earnedBonus) || 0,
      Number(r.otAmount) || 0,
      Number(r.totalGross) || 0,
      Number(r.manualAmount) || 0,
      Number(r.diffAmount) || 0,
      Number(r.pfEmployee) || 0,
      Number(r.esiEmployee) || 0,
      Number(r.advance) || 0,
      Number(r.totalDeduction) || 0,
      Number(r.netPayable) || 0,
      Number(r.pfEmployer) || 0,
      Number(r.esiEmployer) || 0,
      text(r.remarks) || (r.paidDays > 0 ? 'onroll' : 'off roll')
    ];
  }

  function mainTotalFullAoa(label, t) {
    return [
      '', '', label, '', '', '', '', '', '', '', '', '', '',
      t.basic, t.hra, t.gross, '', t.workingDays, t.sunAllow, t.hd, t.absent, t.paidDays, t.overtimeHours,
      t.earnBasic, t.earnHra, t.grossEarned, t.earnedBonus, t.otAmount,
      t.totalGross, t.manualAmount, t.diffAmount, t.pfEmployee,
      t.esiEmployee, t.advance, t.totalDeduction, t.netPayable,
      t.pfEmployer, t.esiEmployer, ''
    ];
  }

  function mainRowCompactAoa(r, i, s) {
    return [
      i + 1, text(r.empId), text(r.name), text(r.father), text(r.pfNo) || 'NA', text(r.esiNo) || 'NA',
      text(r.gender), text(r.category), Number(r.basic) || 0, Number(r.gross) || 0,
      Number(r.monthDays) || s.monthDays, Number(r.absent) || 0, Number(r.paidDays) || 0,
      Number(r.overtimeHours) || 0, Number(r.earnBasic) || 0, Number(r.grossEarned) || 0,
      Number(r.totalGross) || 0, Number(r.manualAmount) || 0, Number(r.diffAmount) || 0,
      Number(r.pfEmployee) || 0, Number(r.esiEmployee) || 0, Number(r.advance) || 0,
      Number(r.totalDeduction) || 0, Number(r.netPayable) || 0,
      text(r.remarks) || (r.paidDays > 0 ? 'onroll' : 'off roll')
    ];
  }

  function mainTotalCompactAoa(label, t) {
    return [
      '', '', label, '', '', '', '', '',
      t.basic, t.gross, '', '', '', '',
      t.earnBasic, t.grossEarned, t.totalGross,
      t.manualAmount, t.diffAmount, t.pfEmployee,
      t.esiEmployee, t.advance, t.totalDeduction,
      t.netPayable, ''
    ];
  }

  // Builds a rich multi-tab Excel workbook with LIVE Excel formulas on Main Sheet & Category Tabs
  function buildComplianceWorkbook(XLSX, rows, settings, meta) {
    const s = settingsOf(settings);
    const m = meta || {};
    const exp = Object.assign({
      template: 'FULL',          // FULL (39 cols) | COMPACT_25
      includeFormulas: true,
      includeBanner: false,
      includeEmployerCols: true,
      excludeHoldFromBank: true,
      sheets: {
        main: true,
        categorySummary: true,
        categoryTabs: true,
        bankNeft: true,
        statutory: true,
        diffVariance: true,
        master: true,
        lastMonthAudit: true,
        notes: true
      }
    }, m.exportOptions || {});
    exp.sheets = Object.assign({
      main: true,
      categorySummary: true,
      categoryTabs: true,
      bankNeft: true,
      statutory: true,
      diffVariance: true,
      master: true,
      lastMonthAudit: true,
      notes: true
    }, (m.exportOptions && m.exportOptions.sheets) || {});

    const sWithFormulaFlag = Object.assign({}, s, { includeFormulas: exp.includeFormulas !== false });
    const isCompact = exp.template === 'COMPACT_25';
    const wb = XLSX.utils.book_new();
    const used = new Set();
    const list = (Array.isArray(rows) ? rows : []).map(r => normalizeRowExportFields(r, s));
    const totals = computeTotals(list);
    const metaMap = wb.__atplMeta = {};
    const hdrRow1 = exp.includeBanner ? 3 : 1;

    const appendMainLikeSheet = (sheetTitle, subRows, totalLabel) => {
      const subTotals = computeTotals(subRows);
      const hdrs = (isCompact ? COMPACT_HEADERS : MAIN_HEADERS).slice();
      const aoa = [];
      if (exp.includeBanner) {
        const bannerRow1 = new Array(hdrs.length).fill('');
        bannerRow1[0] = `ARORA TEXTILES PVT. LTD. — ESI & PF COMPLIANCE SALARY SHEET (${monthLabel(s.month).toUpperCase()})`;
        const bannerRow2 = new Array(hdrs.length).fill('');
        bannerRow2[0] = `Source: ${text(m.mamFile || 'Mam Sheet')} · Employees: ${subRows.length} · Gross: ₹${subTotals.totalGross.toLocaleString('en-IN')} · Net Payable: ₹${subTotals.netPayable.toLocaleString('en-IN')}`;
        aoa.push(bannerRow1, bannerRow2);
      }
      aoa.push(hdrs);
      subRows.forEach((r, i) => aoa.push(isCompact ? mainRowCompactAoa(r, i, s) : mainRowFullAoa(r, i, s)));
      aoa.push(isCompact ? mainTotalCompactAoa(totalLabel, subTotals) : mainTotalFullAoa(totalLabel, subTotals));

      const ws = XLSX.utils.aoa_to_sheet(aoa);
      if (exp.includeBanner) {
        ws['!merges'] = [
          { s: { r: 0, c: 0 }, e: { r: 0, c: hdrs.length - 1 } },
          { s: { r: 1, c: 0 }, e: { r: 1, c: hdrs.length - 1 } }
        ];
      }
      if (isCompact) {
        wireCompactFormulasForSheet(ws, subRows, sWithFormulaFlag, hdrRow1);
      } else {
        wireComplianceFormulasForSheet(ws, subRows, sWithFormulaFlag, hdrRow1);
      }
      ws['!cols'] = autoFitColsFromAoa(aoa.slice(hdrRow1 - 1), 10, 28);
      ws['!cols'][0] = { wch: 7 };
      ws['!cols'][2] = { wch: Math.max(24, (ws['!cols'][2] && ws['!cols'][2].wch) || 24) };
      if (!isCompact && exp.includeEmployerCols === false) {
        ws['!cols'][36] = { wch: 11, hidden: true };
        ws['!cols'][37] = { wch: 11, hidden: true };
      }
      const tabName = safeSheetName(sheetTitle, used);
      XLSX.utils.book_append_sheet(wb, ws, tabName);
      metaMap[tabName] = isCompact ? {
        type: 'SALARY_MAIN',
        hasHeader: true,
        headerRow1: hdrRow1,
        hasTotalRow: true,
        freezeCols: 3,
        numCols: [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23],
        dedCols: [19, 20, 21, 22],
        netCols: [23],
        alertRows: subRows.map((r, i) => (norm(r.remarks) === 'off roll' || r.paidDays <= 0) ? (hdrRow1 + 1 + i) : -1).filter(n => n > 0)
      } : {
        type: 'SALARY_MAIN',
        hasHeader: true,
        headerRow1: hdrRow1,
        hasTotalRow: true,
        freezeCols: 3,
        numCols: [13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37],
        dedCols: [31, 32, 33, 34],
        netCols: [35],
        alertRows: subRows.map((r, i) => (norm(r.remarks) === 'off roll' || r.paidDays <= 0) ? (hdrRow1 + 1 + i) : -1).filter(n => n > 0)
      };
    };

    // 1. Main Sheet
    if (exp.sheets.main) {
      appendMainLikeSheet('Main Sheet', list, 'GRAND TOTAL');
    }

    // 2. Category Summary
    const catGroups = {};
    list.forEach(r => {
      const k = text(r.category) || 'OTHER';
      (catGroups[k] = catGroups[k] || []).push(r);
    });
    const sortedCats = Object.keys(catGroups).sort();
    if (exp.sheets.categorySummary) {
      const catSummaryAoa = [[
        'S.No.', 'Category', 'Employees', 'Onroll', 'Off Roll', 'Earn Basic', 'Earn HRA',
        'Earned Bonus', 'OT Amount', 'Total Gross', 'Manual Amount', 'Diff. Amount',
        'PF@12%', 'ESIC@0.75%', 'Advance', 'Total Deduction', 'Net Payable', 'PF@13%', 'ESI@3.25%'
      ]];
      sortedCats.forEach((cat, idx) => {
        const t = computeTotals(catGroups[cat]);
        catSummaryAoa.push([
          idx + 1, cat, t.count, t.onroll, t.offroll, t.earnBasic, t.earnHra,
          t.earnedBonus, t.otAmount, t.totalGross, t.manualAmount, t.diffAmount,
          t.pfEmployee, t.esiEmployee, t.advance, t.totalDeduction, t.netPayable,
          t.pfEmployer, t.esiEmployer
        ]);
      });
      catSummaryAoa.push([
        '', 'GRAND TOTAL', totals.count, totals.onroll, totals.offroll, totals.earnBasic, totals.earnHra,
        totals.earnedBonus, totals.otAmount, totals.totalGross, totals.manualAmount, totals.diffAmount,
        totals.pfEmployee, totals.esiEmployee, totals.advance, totals.totalDeduction, totals.netPayable,
        totals.pfEmployer, totals.esiEmployer
      ]);
      const wsCatSum = XLSX.utils.aoa_to_sheet(catSummaryAoa);
      applyNumericFormatsAndFormulaRow(
        wsCatSum, catSummaryAoa,
        [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18],
        ['C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S'],
        []
      );
      wsCatSum['!cols'] = autoFitColsFromAoa(catSummaryAoa, 12, 28);
      wsCatSum['!rows'] = [{ hpt: 28 }].concat(sortedCats.map(() => ({ hpt: 20 }))).concat([{ hpt: 24 }]);
      wsCatSum['!autofilter'] = sortedCats.length ? { ref: `A1:S${sortedCats.length + 1}` } : undefined;
      const catSumName = safeSheetName('Category Summary', used);
      XLSX.utils.book_append_sheet(wb, wsCatSum, catSumName);
      metaMap[catSumName] = {
        type: 'SUMMARY',
        hasHeader: true,
        hasTotalRow: true,
        freezeCols: 2,
        numCols: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18],
        dedCols: [12, 13, 14, 15],
        netCols: [16],
        alertRows: []
      };
    }

    // 3. Bank NEFT Transfer Sheet
    if (exp.sheets.bankNeft) {
      const bankPool = list.filter(r => {
        if ((Number(r.netPayable) || 0) <= 0) return false;
        if (exp.excludeHoldFromBank !== false && r.paymentHold) return false;
        return true;
      });
      const bankTotalNet = round0(bankPool.reduce((a, b) => a + (Number(b.netPayable) || 0), 0));
      const bankAoa = [[
        'S.No.', 'Employee ID', 'Name of employee', 'Category', 'Bank Name',
        'IFSC Code', 'Account Number', 'Net Payable', 'Payment Mode', 'Status / Remarks'
      ]];
      const bankAlerts = [];
      bankPool.forEach((r, idx) => {
        const missingBank = !text(r.ifsc) || !text(r.accountNo);
        const mode = missingBank ? 'CHECK BANK' : (/^sbi/i.test(text(r.ifsc)) ? 'SBI INTRA' : 'NEFT');
        bankAoa.push([
          idx + 1, text(r.empId), text(r.name), text(r.category),
          text(r.bankName) || '—', text(r.ifsc) || 'MISSING', text(r.accountNo) || 'MISSING',
          Number(r.netPayable) || 0, mode,
          r.paymentHold ? 'HOLD' : (missingBank ? 'Update IFSC / A/C in Master' : 'Ready for Transfer')
        ]);
        if (missingBank || r.paymentHold) bankAlerts.push(bankAoa.length);
      });
      if (bankPool.length === 0) {
        bankAoa.push([1, '—', 'No payable employees matching filter', '', '', '', '', 0, '—', '']);
      }
      bankAoa.push(['', 'TOTAL', `${bankPool.length} Transfers`, '', '', '', '', bankTotalNet, '', '']);
      const wsBank = XLSX.utils.aoa_to_sheet(bankAoa);
      applyNumericFormatsAndFormulaRow(wsBank, bankAoa, [7], bankPool.length ? ['H'] : [], [1, 5, 6]);
      wsBank['!cols'] = autoFitColsFromAoa(bankAoa, 12, 30);
      wsBank['!rows'] = [{ hpt: 28 }].concat(bankAoa.slice(1, -1).map(() => ({ hpt: 20 }))).concat([{ hpt: 24 }]);
      if (bankPool.length) wsBank['!autofilter'] = { ref: `A1:J${bankPool.length + 1}` };
      const bankName = safeSheetName('Bank NEFT Transfer', used);
      XLSX.utils.book_append_sheet(wb, wsBank, bankName);
      metaMap[bankName] = {
        type: 'BANK',
        hasHeader: true,
        hasTotalRow: true,
        freezeCols: 3,
        numCols: [7],
        dedCols: [],
        netCols: [7],
        alertRows: bankAlerts
      };
    }

    // 4. Employee Master & Designation Sheet
    if (exp.sheets.master) {
      const masterAoa = [[
        'S.No.', 'Employee ID', 'Name of employee', 'Fathers Name', 'D.O.B', 'D-O-J',
        'PF NO', 'ESI NO', 'Gender', 'Department', 'Designation', 'Category',
        'Bank Name', 'IFSC Code', 'Account Number', 'Net Payable', 'Remarks'
      ]];
      list.forEach((r, i) => {
        masterAoa.push([
          i + 1, text(r.empId), text(r.name), text(r.father), text(r.dob), text(r.doj),
          text(r.pfNo), text(r.esiNo), text(r.gender), text(r.department), text(r.designation),
          text(r.category), text(r.bankName), text(r.ifsc), text(r.accountNo), Number(r.netPayable) || 0, text(r.remarks)
        ]);
      });
      masterAoa.push(['', 'TOTAL', '', '', '', '', '', '', '', '', '', '', '', '', '', totals.netPayable, '']);
      const wsMaster = XLSX.utils.aoa_to_sheet(masterAoa);
      applyNumericFormatsAndFormulaRow(wsMaster, masterAoa, [15], ['P'], [1, 6, 7, 13, 14]);
      wsMaster['!cols'] = autoFitColsFromAoa(masterAoa, 12, 28);
      wsMaster['!rows'] = [{ hpt: 28 }].concat(list.map(() => ({ hpt: 20 }))).concat([{ hpt: 24 }]);
      const masterName = safeSheetName('Master & Designation', used);
      XLSX.utils.book_append_sheet(wb, wsMaster, masterName);
      metaMap[masterName] = {
        type: 'MASTER',
        hasHeader: true,
        hasTotalRow: true,
        freezeCols: 3,
        numCols: [15],
        dedCols: [],
        netCols: [15],
        alertRows: []
      };
    }

    // 5. PF & ESIC Statutory Summary (with Last Month comparison & Rule tracking)
    if (exp.sheets.statutory) {
      const statAoa = [[
        'S.No.', 'Employee ID', 'Name of employee', 'PF NO', 'ESI NO',
        'PF Rule', 'PF Wages', 'PF Employee (12%)', 'PF Employer (13%)', 'Prev PF (Last Mo)',
        'ESIC Rule', 'ESIC Wages', 'ESIC Employee (0.75%)', 'ESIC Employer (3.25%)', 'Prev ESIC (Last Mo)',
        'Total PF + ESIC Contribution', 'Remarks'
      ]];
      list.forEach((r, i) => {
        statAoa.push([
          i + 1, text(r.empId), text(r.name), text(r.pfNo), text(r.esiNo),
          text(r.pfMode || 'AUTO'), r.pfWage || 0, r.pfEmployee || 0, r.pfEmployer || 0, Number(r.prevPfEmployee) || 0,
          text(r.esiMode || 'AUTO'), r.esiWage || 0, r.esiEmployee || 0, r.esiEmployer || 0, Number(r.prevEsiEmployee) || 0,
          (r.pfEmployee || 0) + (r.pfEmployer || 0) + (r.esiEmployee || 0) + (r.esiEmployer || 0),
          text(r.remarks)
        ]);
      });
      statAoa.push([
        '', 'TOTAL', '', '', '', '',
        round0(list.reduce((a, b) => a + (b.pfWage || 0), 0)),
        totals.pfEmployee, totals.pfEmployer,
        round0(list.reduce((a, b) => a + (Number(b.prevPfEmployee) || 0), 0)),
        '',
        round0(list.reduce((a, b) => a + (b.esiWage || 0), 0)),
        totals.esiEmployee, totals.esiEmployer,
        round0(list.reduce((a, b) => a + (Number(b.prevEsiEmployee) || 0), 0)),
        totals.pfEmployee + totals.pfEmployer + totals.esiEmployee + totals.esiEmployer,
        ''
      ]);
      const wsStat = XLSX.utils.aoa_to_sheet(statAoa);
      applyNumericFormatsAndFormulaRow(wsStat, statAoa, [6, 7, 8, 9, 11, 12, 13, 14, 15], ['G', 'H', 'I', 'J', 'L', 'M', 'N', 'O', 'P'], [1, 3, 4]);
      wsStat['!cols'] = autoFitColsFromAoa(statAoa, 12, 28);
      wsStat['!rows'] = [{ hpt: 28 }].concat(list.map(() => ({ hpt: 20 }))).concat([{ hpt: 24 }]);
      wsStat['!autofilter'] = list.length ? { ref: `A1:Q${list.length + 1}` } : undefined;
      const statName = safeSheetName('PF & ESIC Summary', used);
      XLSX.utils.book_append_sheet(wb, wsStat, statName);
      metaMap[statName] = {
        type: 'STATUTORY',
        hasHeader: true,
        hasTotalRow: true,
        freezeCols: 3,
        numCols: [6, 7, 8, 9, 11, 12, 13, 14, 15],
        dedCols: [7, 12],
        netCols: [15],
        alertRows: list.map((r, i) => (norm(r.remarks) === 'off roll' || r.paidDays <= 0) ? (i + 2) : -1).filter(n => n > 0)
      };
    }

    // 6. Difference & Variance Analysis Sheet
    if (exp.sheets.diffVariance) {
      const diffRows = list
        .filter(r => Math.abs((Number(r.manualAmount) || 0) - (Number(r.totalGross) || 0)) > 0 || (r.flags || []).length > 0)
        .sort((a, b) => Math.abs((b.manualAmount || 0) - (b.totalGross || 0)) - Math.abs((a.manualAmount || 0) - (a.totalGross || 0)));
      const dt = computeTotals(diffRows);
      const diffAoa = [[
        'S.No.', 'Employee ID', 'Name of employee', 'Category', 'Paid Days', 'OT Hours',
        'Total Gross salary', 'Manual Amount', 'Diff. Amount', 'Net Payable', 'Audit Status / Flags'
      ]];
      const diffAlerts = [];
      diffRows.forEach((r, idx) => {
        diffAoa.push([
          idx + 1, text(r.empId), text(r.name), text(r.category),
          Number(r.paidDays) || 0, Number(r.overtimeHours) || 0,
          Number(r.totalGross) || 0, Number(r.manualAmount) || 0, Number(r.diffAmount) || 0,
          Number(r.netPayable) || 0, (r.flags || []).join('; ') || 'Within Tolerance'
        ]);
        if ((r.totalGross || 0) > (r.manualAmount || 0) || (r.diffAmount || 0) > 500) diffAlerts.push(diffAoa.length);
      });
      if (!diffRows.length) {
        diffAoa.push([1, '—', 'Zero difference rows', '—', 0, 0, 0, 0, 0, 0, '100% matched']);
      }
      diffAoa.push(['', 'TOTAL', `${diffRows.length} Variance Rows`, '', '', '', dt.totalGross, dt.manualAmount, dt.diffAmount, dt.netPayable, '']);
      const wsDiff = XLSX.utils.aoa_to_sheet(diffAoa);
      applyNumericFormatsAndFormulaRow(wsDiff, diffAoa, [4, 5, 6, 7, 8, 9], diffRows.length ? ['G', 'H', 'I', 'J'] : [], [1]);
      wsDiff['!cols'] = autoFitColsFromAoa(diffAoa, 12, 34);
      wsDiff['!rows'] = [{ hpt: 28 }].concat(diffAoa.slice(1, -1).map(() => ({ hpt: 20 }))).concat([{ hpt: 24 }]);
      if (diffRows.length) wsDiff['!autofilter'] = { ref: `A1:K${diffRows.length + 1}` };
      const diffName = safeSheetName('Diff & Variance', used);
      XLSX.utils.book_append_sheet(wb, wsDiff, diffName);
      metaMap[diffName] = {
        type: 'DIFF',
        hasHeader: true,
        hasTotalRow: true,
        freezeCols: 3,
        numCols: [4, 5, 6, 7, 8, 9],
        dedCols: [8],
        netCols: [9],
        alertRows: diffAlerts
      };
    }

    // 7. Last Month Audit & Card Shift Log
    const audit = m.lastMonthAudit || computeLastMonthAudit(list, m.prevProfiles || null);
    if (exp.sheets.lastMonthAudit) {
      const auditAoa = [
        ['Type / Status', 'Employee ID', 'Name of employee', 'Master / Prev Info', 'Current Card / Status', 'Last Month PF', 'This Month PF', 'Last Month ESIC', 'This Month ESIC', 'Audit Note']
      ];
      const auditAlertRows = [];
      (audit.skippedAbsent || []).forEach(x => {
        auditAoa.push([
          'ABSENT / LEFT (NOT IN MAM)', text(x.empId), text(x.name), text(x.category || 'Prev Sheet'), 'NOT IN MAM SHEET',
          x.prevPf || 0, 0, x.prevEsi || 0, 0, text(x.reason)
        ]);
        auditAlertRows.push(auditAoa.length);
      });
      (audit.zeroDayCurrent || []).forEach(x => {
        auditAoa.push([
          'OFF ROLL / 0 DAYS', text(x.empId), text(x.name), text(x.category), '0 Paid Days',
          x.prevPf || 0, 0, x.prevEsi || 0, 0, text(x.reason)
        ]);
        auditAlertRows.push(auditAoa.length);
      });
      (audit.cardShifts || []).forEach(x => {
        auditAoa.push([
          'CARD SHIFTED (MAM)', text(x.empId), text(x.name), text(x.fromCard), text(x.toCard),
          0, x.pfEmployee || 0, 0, x.esiEmployee || 0, `Master: ${x.fromCard} -> Salary Card: ${x.toCard}`
        ]);
      });
      if (auditAoa.length === 1) {
        auditAoa.push(['INFO', '—', 'No absent/left skips or card shifts detected', '—', '—', 0, 0, 0, 0, 'All previous statutory records matched']);
      }
      const wsAudit = XLSX.utils.aoa_to_sheet(auditAoa);
      wsAudit['!cols'] = autoFitColsFromAoa(auditAoa, 14, 38);
      wsAudit['!rows'] = [{ hpt: 28 }].concat(auditAoa.slice(1).map(() => ({ hpt: 21 })));
      const auditSheetName = safeSheetName('Last Month & Card Audit', used);
      XLSX.utils.book_append_sheet(wb, wsAudit, auditSheetName);
      metaMap[auditSheetName] = {
        type: 'AUDIT',
        hasHeader: true,
        hasTotalRow: false,
        freezeCols: 3,
        numCols: [5, 6, 7, 8],
        dedCols: [5, 7],
        netCols: [6, 8],
        alertRows: auditAlertRows
      };
    }

    // 8. Individual Category tabs
    if (exp.sheets.categoryTabs) {
      sortedCats.slice(0, 30).forEach(cat => {
        appendMainLikeSheet(cat, catGroups[cat], `${cat} TOTAL`);
      });
    }

    // 9. Formula & Sync Notes
    if (exp.sheets.notes) {
      const notesAoa = [
        ['ATPL Mam -> Compliance Workbook Summary', ''],
        ['Payroll Month', monthLabel(s.month)],
        ['Mam File Source', text(m.mamFile)],
        ['Previous Month Source', text(audit.sourceFile || 'Auto / Built-in')],
        ['Last Synced At', text(m.updatedAt) || new Date().toISOString()],
        ['Total Employees', totals.count],
        ['Absent / Left Skipped (₹0 PF/ESIC)', audit.skippedAbsentCount || 0],
        ['Card Shifts Applied (Master -> Mam)', audit.cardShiftCount || 0],
        ['Paid Days Formula', 'MIN(Month Of Days, Working Days + Sun Allow + HD)'],
        ['Absent Formula', 'MAX(0, Month Of Days - Paid Days)'],
        ['Earn Basic Formula', 'ROUND(Basic * Paid Days / Month Of Days, 0)'],
        ['Earn HRA Formula', 'ROUND(HRA * Paid Days / Month Of Days, 0)'],
        ['Gross Earned Formula', 'Earn Basic + Earn HRA'],
        ['Earned Bonus Formula', s.bonusMode === 'BASIC_833' ? `ROUND(Earn Basic * ${s.bonusRate}%, 0)` : (s.bonusMode === 'GROSS_10' ? 'ROUND(Gross Earned * 10%, 0)' : '0')],
        ['OT Amount Formula', `ROUND((Gross Total Salary / ${s.otDivisor}) * Over Time Hours, 0)`],
        ['Total Gross Formula', 'ROUND(Gross Earned + Earned Bonus + OT Amount, 0)'],
        ['Diff Amount Formula', s.clampNegativeDiff ? 'MAX(0, Manual Amount - Total Gross)' : 'Manual Amount - Total Gross'],
        ['PF@12% & PF@13% Formula', `Employee ${(s.pfRate * 100).toFixed(2)}% / Employer ${(s.pfEmployerRate * 100).toFixed(2)}% on Earn Basic (or Cap ₹15k) when PF NO valid & Paid Days > 0`],
        ['ESIC@0.75% & ESI@3.25% Formula', `Employee ${(s.esiRate * 100).toFixed(2)}% / Employer ${(s.esiEmployerRate * 100).toFixed(2)}% on Earn Basic when ESI NO valid & Paid Days > 0`],
        ['Net Payable Formula', 'MAX(0, Total Gross - (PF@12% + ESIC@0.75% + Advance Deduction))']
      ];
      const wsNotes = XLSX.utils.aoa_to_sheet(notesAoa);
      wsNotes['!cols'] = [{ wch: 36 }, { wch: 76 }];
      wsNotes['!rows'] = [{ hpt: 28 }].concat(notesAoa.slice(1).map(() => ({ hpt: 20 })));
      const notesName = safeSheetName('Formula Notes', used);
      XLSX.utils.book_append_sheet(wb, wsNotes, notesName);
      metaMap[notesName] = { type: 'NOTES', hasHeader: true, hasTotalRow: false, freezeCols: 1, numCols: [], dedCols: [], netCols: [], alertRows: [] };
    }

    // Safety fallback if user deselected every single sheet
    if (!wb.SheetNames.length) {
      appendMainLikeSheet('Main Sheet', list, 'GRAND TOTAL');
    }

    wb.Props = {
      Title: 'ATPL Compliance Salary Sheet - ' + monthLabel(s.month),
      Subject: 'ESI/PF Compliance Salary Sheet',
      Author: 'Arora Textiles HR Software',
      CreatedDate: new Date()
    };
    return wb;
  }

  // Post-processes SheetJS CE workbook XML using XLSX.CFB to inject valid MS Excel OOXML styling:
  // Complete crisp grid borders on every cell (including blanks), navy headers, zebra rows, #,##0 alignment,
  // semantic Net Payable & Deduction fills, Total double-bottom borders, frozen panes & schema-valid landscape pageSetup.
  function styleComplianceWorkbookBytes(XLSX, wb) {
    const rawArr = XLSX.write(wb, { type: 'array', bookType: 'xlsx', compression: false });
    if (!XLSX.CFB || typeof XLSX.CFB.read !== 'function') {
      return new Uint8Array(rawArr);
    }
    const zip = XLSX.CFB.read(new Uint8Array(rawArr), { type: 'array' });
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    const customStylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="7">
    <font><sz val="10"/><color rgb="FF0F172A"/><name val="Calibri"/><family val="2"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>
    <font><b/><sz val="10"/><color rgb="FF065F46"/><name val="Calibri"/><family val="2"/></font>
    <font><b/><sz val="10"/><color rgb="FF9A3412"/><name val="Calibri"/><family val="2"/></font>
    <font><b/><sz val="10"/><color rgb="FF1E3A8A"/><name val="Calibri"/><family val="2"/></font>
    <font><b/><sz val="10"/><color rgb="FF991B1B"/><name val="Calibri"/><family val="2"/></font>
    <font><sz val="10"/><color rgb="FF991B1B"/><name val="Calibri"/><family val="2"/></font>
  </fonts>
  <fills count="9">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF1E3A8A"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF8FAFC"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFECFDF5"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFF7ED"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFDBEAFE"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFEF2F2"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFFFFF"/></patternFill></fill>
  </fills>
  <borders count="6">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border><left style="thin"><color rgb="FF64748B"/></left><right style="thin"><color rgb="FF64748B"/></right><top style="thin"><color rgb="FF64748B"/></top><bottom style="thin"><color rgb="FF64748B"/></bottom><diagonal/></border>
    <border><left style="thin"><color rgb="FF1E40AF"/></left><right style="thin"><color rgb="FF1E40AF"/></right><top style="medium"><color rgb="FF0F172A"/></top><bottom style="medium"><color rgb="FF0F172A"/></bottom><diagonal/></border>
    <border><left style="thin"><color rgb="FF059669"/></left><right style="thin"><color rgb="FF059669"/></right><top style="thin"><color rgb="FF64748B"/></top><bottom style="thin"><color rgb="FF64748B"/></bottom><diagonal/></border>
    <border><left style="thin"><color rgb="FFD97706"/></left><right style="thin"><color rgb="FFD97706"/></right><top style="thin"><color rgb="FF64748B"/></top><bottom style="thin"><color rgb="FF64748B"/></bottom><diagonal/></border>
    <border><left style="thin"><color rgb="FF1E3A8A"/></left><right style="thin"><color rgb="FF1E3A8A"/></right><top style="medium"><color rgb="FF1E3A8A"/></top><bottom style="double"><color rgb="FF0F172A"/></bottom><diagonal/></border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="12">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="8" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="3" fontId="0" fillId="8" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="3" fontId="0" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="3" fontId="2" fillId="4" borderId="3" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="3" fontId="3" fillId="5" borderId="4" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="0" fontId="4" fillId="6" borderId="5" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="3" fontId="4" fillId="6" borderId="5" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="0" fontId="6" fillId="7" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="3" fontId="5" fillId="7" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
  <dxfs count="0"/>
  <tableStyles count="0" defaultTableStyle="TableStyleMedium9" defaultPivotStyle="PivotStyleMedium4"/>
</styleSheet>`;

    const findZipEntry = target => {
      if (Array.isArray(zip.FullPaths)) {
        const idx = zip.FullPaths.findIndex(p => String(p || '').endsWith('/' + target) || String(p || '') === target);
        if (idx >= 0 && zip.FileIndex[idx]) return zip.FileIndex[idx];
      }
      const base = target.split('/').pop();
      return zip.FileIndex.find(f => f && (f.name === target || f.name === '/' + target || f.name === base));
    };
    const updateEntryBytes = (entry, str) => {
      const bytes = encoder.encode(str);
      entry.content = bytes;
      entry.size = bytes.length;
      if ('csize' in entry) delete entry.csize;
      if ('crc' in entry) delete entry.crc;
    };

    const stylesEntry = findZipEntry('xl/styles.xml');
    if (stylesEntry) updateEntryBytes(stylesEntry, customStylesXml);

    const colLettersToIdx = ref => {
      const m = /^([A-Z]+)(\d+)$/.exec(ref || '');
      if (!m) return { col: 0, row: 1 };
      let col = 0;
      for (let i = 0; i < m[1].length; i++) col = col * 26 + (m[1].charCodeAt(i) - 64);
      return { col: col - 1, row: Number(m[2]) };
    };

    const metaMap = wb.__atplMeta || {};
    (wb.SheetNames || []).forEach((sheetName, sIdx) => {
      const sheetPath = `xl/worksheets/sheet${sIdx + 1}.xml`;
      const entry = findZipEntry(sheetPath);
      if (!entry || !entry.content) return;
      const ws = wb.Sheets[sheetName];
      const mInfo = metaMap[sheetName] || { hasHeader: true, hasTotalRow: false, freezeCols: 1, numCols: [], dedCols: [], netCols: [], alertRows: [] };
      const numSet = new Set(mInfo.numCols || []);
      const dedSet = new Set(mInfo.dedCols || []);
      const netSet = new Set(mInfo.netCols || []);
      const alertSet = new Set(mInfo.alertRows || []);
      const refRange = ws && ws['!ref'] ? XLSX.utils.decode_range(ws['!ref']) : { e: { r: 0, c: 0 } };
      const lastRow1 = refRange.e.r + 1;
      const lastCol0 = Math.max(0, refRange.e.c || 0);

      const pickStyle = (col0, row1) => {
        const hdrRow = Number(mInfo.headerRow1) || 1;
        const isBanner = hdrRow > 1 && row1 < hdrRow;
        const isHdr = mInfo.hasHeader && row1 === hdrRow;
        const isTot = mInfo.hasTotalRow && row1 === lastRow1 && lastRow1 > hdrRow;
        const isAlert = alertSet.has(row1);
        const isZebra = (row1 - hdrRow) % 2 === 0;
        const isNum = numSet.has(col0);
        const isDed = dedSet.has(col0);
        const isNet = netSet.has(col0);
        if (isBanner) return row1 === 1 ? 1 : 8;
        if (isHdr) return 1;
        if (isTot) return isNum ? 9 : 8;
        if (isAlert) return isNum ? 11 : 10;
        if (isNet) return 6;
        if (isDed) return 7;
        if (isNum) return isZebra ? 5 : 4;
        return isZebra ? 3 : 2;
      };

      let xml = decoder.decode(new Uint8Array(entry.content));

      // 1. Add sheetPr (fitToPage="1") as first child inside <worksheet> (strict CT_Worksheet schema order)
      if (!/<sheetPr\b/.test(xml)) {
        xml = xml.replace(/<dimension\b/, '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension');
      }

      // 2. Inject frozen pane view + active gridlines
      if (mInfo.hasHeader) {
        const xSplit = Math.max(0, Number(mInfo.freezeCols) || 0);
        const ySplit = Math.max(1, Number(mInfo.headerRow1) || 1);
        const topLeftCol = colIdxToLetters(xSplit);
        const topLeftRow = ySplit + 1;
        const freezeTag = xSplit > 0
          ? `<sheetViews><sheetView tabSelected="${sIdx === 0 ? 1 : 0}" showGridLines="1" workbookViewId="0"><pane xSplit="${xSplit}" ySplit="${ySplit}" topLeftCell="${topLeftCol}${topLeftRow}" activePane="bottomRight" state="frozen"/></sheetView></sheetViews>`
          : `<sheetViews><sheetView tabSelected="${sIdx === 0 ? 1 : 0}" showGridLines="1" workbookViewId="0"><pane ySplit="${ySplit}" topLeftCell="A${topLeftRow}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`;
        if (/<sheetViews>[\s\S]*?<\/sheetViews>/.test(xml)) {
          xml = xml.replace(/<sheetViews>[\s\S]*?<\/sheetViews>/, freezeTag);
        } else if (/<sheetFormatPr\b/.test(xml)) {
          xml = xml.replace(/<sheetFormatPr\b/, freezeTag + '<sheetFormatPr');
        } else {
          xml = xml.replace(/<cols\b|<sheetData\b/, m => freezeTag + m);
        }
      }

      // 3. Populate every missing cell & style every existing cell (handles both <c .../> and <c ...>...</c>)
      xml = xml.replace(/<row\b([^>]*)>([\s\S]*?)<\/row>/g, (rowFull, rowAttrs, rowInner) => {
        const rowMatch = /r="(\d+)"/.exec(rowAttrs);
        const row1 = rowMatch ? Number(rowMatch[1]) : 1;
        const cellsByCol = new Map();
        rowInner.replace(/<c\s+([^>]*?)(\/)?>(?:([\s\S]*?)<\/c>)?/g, (cFull, attrs, selfClose, bodyXml) => {
          const rm = /r="([A-Z]+\d+)"/.exec(attrs);
          if (!rm) return '';
          const pos = colLettersToIdx(rm[1]);
          const styleId = pickStyle(pos.col, pos.row);
          const cleanAttrs = attrs.replace(/\s*s="\d+"/g, '').trim();
          const rebuilt = selfClose
            ? `<c ${cleanAttrs} s="${styleId}"/>`
            : `<c ${cleanAttrs} s="${styleId}">${bodyXml || ''}</c>`;
          cellsByCol.set(pos.col, rebuilt);
          return '';
        });
        const fullCells = [];
        for (let c = 0; c <= lastCol0; c++) {
          if (cellsByCol.has(c)) {
            fullCells.push(cellsByCol.get(c));
          } else {
            const addr = colIdxToLetters(c) + row1;
            fullCells.push(`<c r="${addr}" s="${pickStyle(c, row1)}"/>`);
          }
        }
        return `<row ${rowAttrs.trim()}>${fullCells.join('')}</row>`;
      });

      // 4. Remove any pre-existing pageMargins/pageSetup and insert in strict ECMA-376 CT_Worksheet order (BEFORE ignoredErrors/worksheet end)
      xml = xml.replace(/<pageMargins\b[^>]*\/>/g, '').replace(/<pageSetup\b[^>]*\/>/g, '');
      const printXml = '<pageMargins left="0.35" right="0.35" top="0.5" bottom="0.5" header="0.25" footer="0.25"/><pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/>';
      if (/<ignoredErrors\b/.test(xml)) {
        xml = xml.replace(/<ignoredErrors\b/, printXml + '<ignoredErrors');
      } else if (/<\/worksheet>/.test(xml)) {
        xml = xml.replace(/<\/worksheet>/, printXml + '</worksheet>');
      }

      updateEntryBytes(entry, xml);
    });

    const outZip = XLSX.CFB.write(zip, { fileType: 'zip', type: 'array', compression: true });
    return new Uint8Array(outZip);
  }

  const API = {
    MAIN_HEADERS,
    COMPACT_HEADERS,
    DEFAULT_SETTINGS,
    STORAGE_SHEETS_KEY,
    STORAGE_TOMBS_KEY,
    text,
    norm,
    nameKey,
    cleanCode,
    codeKey,
    num,
    round0,
    round2,
    validId,
    daysInMonth,
    detectMonthFromText,
    monthLabel,
    settingsOf,
    parseCsvText,
    parseCardNumber,
    buildMasterCardMap,
    canonicalizeCardCategory,
    parseMamMatrix,
    parseReferenceMatrix,
    buildProfilesFromComplianceSheet,
    computeLastMonthAudit,
    indexEmployeeMaster,
    splitPaidDays,
    calculateTotalGross,
    deriveDaysAndOt,
    recalculateRow,
    generateComplianceRows,
    computeTotals,
    buildComplianceWorkbook,
    styleComplianceWorkbookBytes
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = API;
    return;
  }

  if (root.__ATPL_COMPLIANCE_STUDIO__) return;
  root.__ATPL_COMPLIANCE_STUDIO__ = API;

  // ════════════════════════════════════════════════════════════════
  // BROWSER WORKSPACE, INTERACTIVE EXCEL GRID & CROSS-BROWSER SYNC
  // ════════════════════════════════════════════════════════════════
  const $ = id => document.getElementById(id);
  const esc = v => String(v === null || v === undefined ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const inr = v => (num(v) === null ? '—' : Number(v).toLocaleString('en-IN', { maximumFractionDigits: 0 }));

  const STORAGE_HIDDENCOLS_KEY = 'ATPL_ComplianceHiddenCols_V1';
  const STORAGE_EXPORT_KEY = 'ATPL_ComplianceExportOpts_V1';

  const DEFAULT_EXPORT_OPTS = {
    template: 'FULL',
    scope: 'ALL',
    includeFormulas: true,
    includeBanner: false,
    includeEmployerCols: true,
    excludeHoldFromBank: true,
    customFilename: '',
    sheets: {
      main: true,
      categorySummary: true,
      categoryTabs: true,
      bankNeft: true,
      statutory: true,
      diffVariance: true,
      master: true,
      lastMonthAudit: true,
      notes: true
    }
  };

  const GRID_COLS = [
    { key: '_select', label: '', col: '', width: 38, align: 'center', stickyBase: true },
    { key: 'serial', label: 'S.No.', col: 'A', width: 50, align: 'center', stickyBase: true },
    { key: 'empId', label: 'Employee ID', col: 'B', width: 100, edit: 'text', stickyBase: true, sortable: true },
    { key: 'name', label: 'Name of employee', col: 'C', width: 192, edit: 'text', stickyBase: true, sortable: true },
    { key: 'father', label: 'Fathers Name', col: 'D', width: 158, edit: 'text', optional: true, sortable: true },
    { key: 'dob', label: 'D.O.B', col: 'E', width: 98, edit: 'text', optional: true, sortable: true },
    { key: 'doj', label: 'D-O-J', col: 'F', width: 98, edit: 'text', optional: true, sortable: true },
    { key: 'pfNo', label: 'PF NO', col: 'G', width: 130, edit: 'text', optional: true, sortable: true },
    { key: 'esiNo', label: 'ESI NO', col: 'H', width: 116, edit: 'text', optional: true, sortable: true },
    { key: 'gender', label: 'Gender', col: 'I', width: 72, edit: 'text', optional: true, sortable: true },
    { key: 'department', label: 'Department', col: 'J', width: 122, edit: 'text', optional: true, sortable: true },
    { key: 'designation', label: 'Designation', col: 'K', width: 140, edit: 'text', optional: true, sortable: true },
    { key: 'cat1', label: 'Catgrory 01', col: 'L', width: 112, edit: 'text', optional: true, sortable: true },
    { key: 'category', label: 'Catgrory 02', col: 'M', width: 136, edit: 'text', optional: true, sortable: true },
    { key: 'basic', label: 'Basic', col: 'N', width: 92, edit: 'number', align: 'right', money: true, numeric: true, sortable: true, totalKey: 'basic' },
    { key: 'hra', label: 'HRA', col: 'O', width: 84, edit: 'number', align: 'right', money: true, numeric: true, sortable: true, totalKey: 'hra' },
    { key: 'gross', label: 'Gross Total Salary', col: 'P', width: 108, edit: 'number', align: 'right', money: true, numeric: true, sortable: true, totalKey: 'gross', formula: r => `=${r.basic || 0} + ${r.hra || 0}` },
    { key: 'monthDays', label: 'Month Days', col: 'Q', width: 78, edit: 'number', align: 'right', numeric: true, optional: true },
    { key: 'workingDays', label: 'Working Days', col: 'R', width: 88, edit: 'number', align: 'right', numeric: true, sortable: true, totalKey: 'workingDays' },
    { key: 'sunAllow', label: 'Sun Allow', col: 'S', width: 78, edit: 'number', align: 'right', numeric: true, sortable: true, totalKey: 'sunAllow' },
    { key: 'hd', label: 'HD', col: 'T', width: 64, edit: 'number', align: 'right', numeric: true, optional: true, sortable: true, totalKey: 'hd' },
    { key: 'absent', label: 'Absent', col: 'U', width: 70, align: 'right', numeric: true, optional: true, sortable: true, totalKey: 'absent', formula: r => `=MAX(0, ${r.monthDays} - ${r.paidDays})` },
    { key: 'paidDays', label: 'Paid Days', col: 'V', width: 82, edit: 'number', align: 'right', numeric: true, sortable: true, totalKey: 'paidDays', formula: r => `=MIN(${r.monthDays}, ${r.workingDays || 0} + ${r.sunAllow || 0} + ${r.hd || 0})` },
    { key: 'overtimeHours', label: 'OT Hours', col: 'W', width: 78, edit: 'number', align: 'right', numeric: true, sortable: true, totalKey: 'overtimeHours' },
    { key: 'earnBasic', label: 'Earn Basic', col: 'X', width: 96, align: 'right', money: true, numeric: true, sortable: true, totalKey: 'earnBasic', formula: r => `=ROUND(${r.basic} * ${r.paidDays} / ${r.monthDays}, 0)` },
    { key: 'earnHra', label: 'Earn HRA', col: 'Y', width: 88, align: 'right', money: true, numeric: true, sortable: true, totalKey: 'earnHra', formula: r => `=ROUND(${r.hra || 0} * ${r.paidDays} / ${r.monthDays}, 0)` },
    { key: 'grossEarned', label: 'Gross Earned', col: 'Z', width: 106, align: 'right', money: true, numeric: true, sortable: true, totalKey: 'grossEarned', formula: r => `=${r.earnBasic || 0} + ${r.earnHra || 0}` },
    { key: 'earnedBonus', label: 'Bonus 8.33%', col: 'AA', width: 94, align: 'right', money: true, numeric: true, sortable: true, totalKey: 'earnedBonus', formula: (r, s) => `=ROUND(${r.earnBasic || 0} * ${s.bonusRate}%, 0)` },
    { key: 'otAmount', label: 'OT Amount', col: 'AB', width: 90, align: 'right', money: true, numeric: true, sortable: true, totalKey: 'otAmount', formula: (r, s) => `=ROUND((${r.gross || 0} / ${s.otDivisor}) * ${r.overtimeHours || 0}, 0)` },
    { key: 'totalGross', label: 'Total Gross salary', col: 'AC', width: 116, align: 'right', money: true, numeric: true, sortable: true, totalKey: 'totalGross', formula: r => `=ROUND(${r.grossEarned || 0} + ${r.earnedBonus || 0} + ${r.otAmount || 0}, 0)` },
    { key: 'manualAmount', label: 'Manual Amount', col: 'AD', width: 110, edit: 'number', align: 'right', money: true, numeric: true, sortable: true, totalKey: 'manualAmount' },
    { key: 'diffAmount', label: 'Diff. Amount', col: 'AE', width: 94, align: 'right', money: true, numeric: true, sortable: true, totalKey: 'diffAmount', formula: r => `=MAX(0, ${r.manualAmount || 0} - ${r.totalGross})` },
    { key: 'pfMode', label: 'PF Rule', col: 'PF Rule', width: 98, edit: 'select', options: ['AUTO', 'FULL_12', 'CAP_15000', 'GROSS_12', 'NONE'], optional: true, sortable: true },
    { key: 'pfEmployee', label: 'PF@12%', col: 'AF', width: 86, align: 'right', money: true, numeric: true, sortable: true, totalKey: 'pfEmployee', formula: (r, s) => `=ROUND(EarnBasic * ${(s.pfRate * 100).toFixed(2)}%, 0)` },
    { key: 'esiMode', label: 'ESIC Rule', col: 'ESI Rule', width: 100, edit: 'select', options: ['AUTO', 'EARN_BASIC', 'TOTAL_GROSS', 'NONE'], optional: true, sortable: true },
    { key: 'esiEmployee', label: 'ESIC @0.75%', col: 'AG', width: 90, align: 'right', money: true, numeric: true, sortable: true, totalKey: 'esiEmployee', formula: (r, s) => `=ROUND(EarnBasic * ${(s.esiRate * 100).toFixed(2)}%, 0)` },
    { key: 'advance', label: 'Advance Ded.', col: 'AH', width: 96, edit: 'number', align: 'right', money: true, numeric: true, optional: true, sortable: true, totalKey: 'advance' },
    { key: 'totalDeduction', label: 'Total Ded.', col: 'AI', width: 98, align: 'right', money: true, numeric: true, sortable: true, totalKey: 'totalDeduction', formula: r => `=${r.pfEmployee} + ${r.esiEmployee} + ${r.advance}` },
    { key: 'netPayable', label: 'Net Payable', col: 'AJ', width: 112, align: 'right', money: true, numeric: true, sortable: true, totalKey: 'netPayable', formula: r => `=${r.totalGross} - ${r.totalDeduction}` },
    { key: 'pfEmployer', label: 'PF @13%', col: 'AK', width: 88, align: 'right', money: true, numeric: true, optional: true, sortable: true, totalKey: 'pfEmployer', formula: (r, s) => `=ROUND(PFWage * ${(s.pfEmployerRate * 100).toFixed(2)}%, 0)` },
    { key: 'esiEmployer', label: 'ESI @3.25%', col: 'AL', width: 90, align: 'right', money: true, numeric: true, optional: true, sortable: true, totalKey: 'esiEmployer', formula: (r, s) => `=ROUND(ESIWage * ${(s.esiEmployerRate * 100).toFixed(2)}%, 0)` },
    { key: 'paymentHold', label: 'Hold', col: 'Hold', width: 56, edit: 'checkbox', align: 'center', optional: true, sortable: true },
    { key: 'remarks', label: 'Remarks', col: 'AM', width: 104, edit: 'select', options: ['onroll', 'off roll'], sortable: true },
    { key: '_delete', label: 'Action', col: '', width: 74, align: 'center' }
  ];

  const VIEW_PRESETS = {
    FULL: {},
    ATTENDANCE: {
      father: true, dob: true, doj: true, pfNo: true, esiNo: true, gender: true,
      department: true, designation: true, cat1: true, hra: true, earnedBonus: true,
      otAmount: true, manualAmount: true, diffAmount: true, pfMode: true, pfEmployee: true,
      esiMode: true, esiEmployee: true, advance: true, totalDeduction: true,
      pfEmployer: true, esiEmployer: true, paymentHold: true
    },
    STATUTORY: {
      father: true, dob: true, doj: true, gender: true, department: true, designation: true,
      cat1: true, monthDays: true, workingDays: true, sunAllow: true, hd: true, absent: true,
      earnHra: true, grossEarned: true, earnedBonus: true, otAmount: true, manualAmount: true,
      diffAmount: true, paymentHold: true
    },
    COMPACT: {
      father: true, dob: true, doj: true, pfNo: true, esiNo: true, gender: true,
      department: true, designation: true, cat1: true, monthDays: true, hd: true, absent: true,
      pfMode: true, esiMode: true, pfEmployer: true, esiEmployer: true, paymentHold: true
    }
  };

  function cloneExportOpts(raw) {
    const base = Object.assign({}, DEFAULT_EXPORT_OPTS, raw || {});
    base.sheets = Object.assign({}, DEFAULT_EXPORT_OPTS.sheets, (raw && raw.sheets) || {});
    return base;
  }

  function hydrateSheetRows(sh) {
    if (!sh || !Array.isArray(sh.rows)) return sh;
    const s = settingsOf(sh.settings);
    sh.rows.forEach(r => {
      if (r && (r.hra === undefined || r.workingDays === undefined || r.earnHra === undefined || r.earnedBonus === undefined || r.otAmount === undefined)) {
        recalculateRow(r, s);
      }
    });
    return sh;
  }

  const state = {
    sheets: {},          // id (monthKey e.g. '2026-10') -> sheet record
    tombstones: {},      // id -> deleted_at ISO
    activeId: '',
    profiles: { byCode: {}, byName: {}, count: 0, sourceFile: '' },
    search: '',
    categoryFilter: 'ALL',
    statusFilter: 'ALL', // ALL | ONROLL | OFFROLL | MISSING_STAT | DIFF_ALERT
    selectedCell: null,  // { uid, key, label, col, value, formula, editable }
    notice: '',
    noticeType: 'info',  // info | ok | warn | err
    syncLabel: 'Synced',
    listenersBound: false,
    syncDebounce: null,
    pageOffset: 0,
    pageSize: 100,
    focusMode: false,
    isFullscreen: false,
    freezePanes: true,
    activeTab: 'MAIN',   // MAIN | CATEGORY | BANK | PF_ESIC | DIFF | LAST_MONTH | MASTER
    viewPreset: 'FULL',
    inspectUid: '',
    exportModalOpen: false,
    exportOptions: cloneExportOpts(),
    sortKey: '',
    sortDir: '',         // '' | 'asc' | 'desc'
    selectedUids: new Set(),
    hiddenCols: {},
    undoStack: [],
    redoStack: [],
    _editBatchOpen: false
  };

  function currentUserLabel() {
    try {
      const u = JSON.parse(sessionStorage.getItem('ATPL_UserSession_V5') || localStorage.getItem('ATPL_UserSession_V5') || 'null');
      return (u && (u.name || u.username || u.id)) || 'ERP User';
    } catch (_) {
      return 'ERP User';
    }
  }

  function getEmployeeMasterList() {
    const out = [];
    const seen = {};
    const addList = list => {
      if (!Array.isArray(list)) return;
      list.forEach(emp => {
        const k = codeKey(emp && (emp.emp_id || emp.employee_id || emp.code));
        if (k && !seen[k]) {
          seen[k] = 1;
          out.push(emp);
        }
      });
    };
    try { if (root.EM && Array.isArray(root.EM.data)) addList(root.EM.data); } catch (_) {}
    try { addList(JSON.parse(localStorage.getItem('AroraTextilesEmployeeMasterV3') || '[]')); } catch (_) {}
    try { if (Array.isArray(root.EMP_MASTER_DATA)) addList(root.EMP_MASTER_DATA); } catch (_) {}
    return out;
  }

  function getAdvanceBalanceMap() {
    const map = {};
    try {
      let list = [];
      if (root.ATPLAdvanceManager && typeof root.ATPLAdvanceManager.getState === 'function') {
        const st = root.ATPLAdvanceManager.getState();
        if (st && Array.isArray(st.advances)) list = st.advances;
      }
      if (!list.length && typeof localStorage !== 'undefined') {
        try {
          const raw = JSON.parse(localStorage.getItem('ATPL_AdvanceRecordsV2') || '[]');
          if (Array.isArray(raw)) list = raw;
        } catch (_) {}
      }
      list.forEach(a => {
        const ck = codeKey(a && a.empCode);
        const bal = num(a && a.balanceAmount);
        if (ck && bal > 0 && a.status !== 'REPAID') {
          const cap = num(a.monthlyCap);
          const ded = cap && cap > 0 ? Math.min(bal, cap) : 0;
          if (ded > 0) map[ck] = (map[ck] || 0) + ded;
        }
      });
    } catch (_) {}
    return map;
  }

  function loadFromLocal() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_SHEETS_KEY) || '{}');
      if (raw && typeof raw === 'object') {
        state.sheets = raw;
        Object.keys(state.sheets).forEach(k => hydrateSheetRows(state.sheets[k]));
      }
    } catch (_) {}
    try {
      const tombs = JSON.parse(localStorage.getItem(STORAGE_TOMBS_KEY) || '{}');
      if (tombs && typeof tombs === 'object') state.tombstones = tombs;
    } catch (_) {}
    try {
      const prof = JSON.parse(localStorage.getItem(STORAGE_PROFILES_KEY) || 'null');
      if (prof && prof.byCode) state.profiles = prof;
    } catch (_) {}
    try {
      state.activeId = localStorage.getItem(STORAGE_ACTIVE_KEY) || '';
    } catch (_) {}
    try {
      const hc = JSON.parse(localStorage.getItem(STORAGE_HIDDENCOLS_KEY) || '{}');
      if (hc && typeof hc === 'object') state.hiddenCols = hc;
    } catch (_) {}
    try {
      const eo = JSON.parse(localStorage.getItem(STORAGE_EXPORT_KEY) || 'null');
      if (eo && typeof eo === 'object') state.exportOptions = cloneExportOpts(eo);
    } catch (_) {}

    // Reconcile local tombstones
    Object.keys(state.tombstones).forEach(id => {
      if (state.sheets[id]) {
        const tTs = Date.parse(state.tombstones[id]) || 0;
        const rTs = Date.parse(state.sheets[id].updatedAt || state.sheets[id].createdAt || 0) || 0;
        if (tTs >= rTs) delete state.sheets[id];
      }
    });
    if (!state.activeId || !state.sheets[state.activeId]) {
      const keys = Object.keys(state.sheets).sort().reverse();
      state.activeId = keys[0] || '';
    }
  }

  function saveToLocal() {
    try { localStorage.setItem(STORAGE_SHEETS_KEY, JSON.stringify(state.sheets)); } catch (_) {}
    try { localStorage.setItem(STORAGE_TOMBS_KEY, JSON.stringify(state.tombstones)); } catch (_) {}
    try { localStorage.setItem(STORAGE_ACTIVE_KEY, state.activeId || ''); } catch (_) {}
  }

  function broadcastSync(action, details) {
    const payload = { action, details: details || {}, ts: Date.now() };
    if (typeof root.BroadcastChannel !== 'undefined') {
      try {
        const bc = new root.BroadcastChannel(CHANNEL_NAME);
        bc.postMessage(payload);
        bc.close();
      } catch (_) {}
    }
    try {
      localStorage.setItem('ATPL_TRIGGER_EVENT', JSON.stringify(payload));
    } catch (_) {}
  }

  function mergeRemoteSheets(records, tombstones) {
    let changed = false;
    if (tombstones && typeof tombstones === 'object') {
      Object.entries(tombstones).forEach(([id, ts]) => {
        if (!id || !ts) return;
        state.tombstones[id] = ts;
        if (state.sheets[id]) {
          const rTs = Date.parse(state.sheets[id].updatedAt || state.sheets[id].createdAt || 0) || 0;
          if (Date.parse(ts) >= rTs) {
            delete state.sheets[id];
            if (state.activeId === id) {
              const rem = Object.keys(state.sheets).sort().reverse();
              state.activeId = rem[0] || '';
            }
            changed = true;
          }
        }
      });
    }
    if (Array.isArray(records)) {
      records.forEach(remote => {
        if (!remote || !remote.id) return;
        const rTs = Date.parse(remote.updatedAt || remote.createdAt || 0) || 0;
        const tomb = state.tombstones[remote.id];
        if (tomb && Date.parse(tomb) >= rTs) return;
        const local = state.sheets[remote.id];
        const lTs = local ? (Date.parse(local.updatedAt || local.createdAt || 0) || 0) : 0;
        if (!local || rTs > lTs) {
          state.sheets[remote.id] = hydrateSheetRows(remote);
          changed = true;
        }
      });
    }
    if (!state.activeId || !state.sheets[state.activeId]) {
      const keys = Object.keys(state.sheets).sort().reverse();
      if (keys[0]) { state.activeId = keys[0]; changed = true; }
    }
    if (changed) {
      saveToLocal();
      const activeEl = document.activeElement;
      const isEditingCell = activeEl && activeEl.closest && activeEl.closest('#mcsTableBody');
      if (!isEditingCell) render();
    }
    return changed;
  }

  function getSyncApiBase() {
    try {
      if (typeof root.ATPL_GET_API_BASE === 'function') return root.ATPL_GET_API_BASE() || '';
      if (root.__ATPL_CENTRAL_BACKEND_URL) return root.__ATPL_CENTRAL_BACKEND_URL;
    } catch (_) {}
    return '';
  }

  function hasSyncBackend() {
    try {
      if (getSyncApiBase()) return true;
      const host = (root.location && root.location.hostname) || '';
      return host === 'localhost' || host === '127.0.0.1' || /\.run\.app$/i.test(host);
    } catch (_) {
      return false;
    }
  }

  async function pullRemoteSheets() {
    if (!hasSyncBackend()) return;
    try {
      const res = await fetch(getSyncApiBase() + '/api/sync/compliance-sheets', { cache: 'no-store' });
      if (!res || !res.ok) return;
      const data = await res.json();
      if (data && data.ok) {
        mergeRemoteSheets(data.records || [], data.tombstones || {});
        setSyncStatus('Synced across browsers');
      }
    } catch (_) {}
  }

  async function pushSheetRemote(sheet) {
    if (!sheet || !sheet.id) return false;
    if (!hasSyncBackend()) {
      broadcastSync('compliance_sheet_saved', { id: sheet.id, updatedAt: sheet.updatedAt });
      setSyncStatus('Saved locally (browser synced)');
      return false;
    }
    setSyncStatus('Syncing…');
    try {
      const res = await fetch(getSyncApiBase() + '/api/sync/compliance-sheet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sheet)
      });
      if (res && res.ok) {
        broadcastSync('compliance_sheet_saved', { id: sheet.id, updatedAt: sheet.updatedAt });
        setSyncStatus('Synced live');
        return true;
      }
    } catch (_) {}
    setSyncStatus('Saved locally (retry queued)');
    return false;
  }

  async function deleteSheetRemote(id) {
    if (!id) return false;
    broadcastSync('compliance_sheet_deleted', { id });
    if (!hasSyncBackend()) return false;
    try {
      const res = await fetch(getSyncApiBase() + '/api/sync/compliance-sheet/' + encodeURIComponent(id), { method: 'DELETE' });
      if (res && res.ok) {
        broadcastSync('compliance_sheet_deleted', { id });
        return true;
      }
    } catch (_) {}
    return false;
  }

  function scheduleSyncActiveSheet() {
    const sheet = activeSheet();
    if (!sheet) return;
    sheet.updatedAt = new Date().toISOString();
    sheet.updatedBy = currentUserLabel();
    saveToLocal();
    setSyncStatus('Saving…');
    if (state.syncDebounce) clearTimeout(state.syncDebounce);
    state.syncDebounce = setTimeout(() => {
      pushSheetRemote(activeSheet());
    }, 450);
  }

  function bindRealtimeListeners() {
    if (state.listenersBound) return;
    state.listenersBound = true;
    if (typeof root.BroadcastChannel !== 'undefined') {
      try {
        const bc = new root.BroadcastChannel(CHANNEL_NAME);
        bc.onmessage = ev => {
          if (ev && ev.data && ev.data.action && ev.data.action.indexOf('compliance_sheet') === 0) {
            pullRemoteSheets();
          }
        };
      } catch (_) {}
    }
    root.addEventListener('storage', e => {
      if (e.key === 'ATPL_TRIGGER_EVENT' && e.newValue) {
        try {
          const ev = JSON.parse(e.newValue);
          if (ev && ev.action && ev.action.indexOf('compliance_sheet') === 0) pullRemoteSheets();
        } catch (_) {}
      }
    });
    root.addEventListener('focus', () => pullRemoteSheets());
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) pullRemoteSheets();
    });
    if (typeof root.EventSource !== 'undefined' && hasSyncBackend()) {
      try {
        const es = new root.EventSource(getSyncApiBase() + '/api/sync/events');
        es.addEventListener('compliance_sheet_saved', () => pullRemoteSheets());
        es.addEventListener('compliance_sheet_deleted', () => pullRemoteSheets());
      } catch (_) {}
    }
  }

  function activeSheet() {
    return state.activeId && state.sheets[state.activeId] ? state.sheets[state.activeId] : null;
  }

  function setNotice(msg, type) {
    state.notice = msg || '';
    state.noticeType = type || 'info';
    const el = $('mcsNotice');
    if (el) {
      el.textContent = state.notice;
      el.dataset.type = state.noticeType;
    }
  }

  function setSyncStatus(label) {
    state.syncLabel = label;
    const el = $('mcsSyncLabel');
    if (el) el.textContent = label;
  }

  async function readUploadedWorkbook(file) {
    const ext = (file.name || '').split('.').pop().toLowerCase();
    if (ext === 'csv' || ext === 'txt') {
      const txt = await file.text();
      return [{ name: file.name.replace(/\.[^.]+$/, '') || 'Sheet1', rows: parseCsvText(txt) }];
    }
    if (!root.XLSX) throw new Error('Excel parser (XLSX) load nahi hua. Please page refresh karein.');
    const buf = await file.arrayBuffer();
    const wb = root.XLSX.read(buf, { type: 'array', cellDates: false, cellText: true });
    return (wb.SheetNames || []).map(sn => {
      const ws = wb.Sheets[sn];
      const rows = root.XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '', blankrows: false });
      return { name: sn, rows };
    });
  }

  function getAllLoadedSalaryFiles() {
    const out = [];
    const seen = new Set();
    const pushFile = f => {
      if (!f || !f.name || seen.has(f.name)) return;
      seen.add(f.name);
      out.push(f);
    };
    try { if (Array.isArray(root.FILES)) root.FILES.forEach(pushFile); } catch (_) {}
    try { if (typeof FILES !== 'undefined' && Array.isArray(FILES)) FILES.forEach(pushFile); } catch (_) {}
    return out;
  }

  function extractMatrixFromLoadedFile(f) {
    const out = [];
    if (!f) return out;
    if (f.sheets && typeof f.sheets === 'object' && !Array.isArray(f.sheets)) {
      Object.keys(f.sheets).forEach(sn => {
        try {
          const rows = f.sheets[sn];
          if (Array.isArray(rows) && rows.length) out.push({ name: sn, rows });
        } catch (_) {}
      });
    } else if (f.wb && Array.isArray(f.wb.SheetNames) && root.XLSX && root.XLSX.utils) {
      f.wb.SheetNames.forEach(sn => {
        try {
          const rows = root.XLSX.utils.sheet_to_json(f.wb.Sheets[sn], { header: 1, defval: '', raw: true });
          if (Array.isArray(rows) && rows.length) out.push({ name: sn, rows });
        } catch (_) {}
      });
    }
    return out;
  }

  function findPreviousMonthProfiles(targetMonth) {
    const target = text(targetMonth);
    const savedKeys = Object.keys(state.sheets || {}).filter(k => k && k !== target && state.sheets[k] && Array.isArray(state.sheets[k].rows) && state.sheets[k].rows.length);
    const earlierSaved = savedKeys.filter(k => !target || k < target).sort().reverse();
    const fallbackSaved = savedKeys.sort().reverse();
    const chosenSavedKey = earlierSaved[0] || fallbackSaved[0];
    if (chosenSavedKey) {
      return buildProfilesFromComplianceSheet(state.sheets[chosenSavedKey]);
    }

    // Check already-loaded workbooks in All Files whose month < targetMonth (or compliance format)
    const files = getAllLoadedSalaryFiles();
    let best = null;
    for (const f of files) {
      const fMonth = detectMonthFromText(f.name);
      if (target && fMonth && fMonth >= target) continue;
      const sheets = extractMatrixFromLoadedFile(f);
      for (const sh of sheets) {
        try {
          const p = parseReferenceMatrix(sh.rows, sh.name, f.name);
          if (p && p.count > 0) {
            if (!best || (p.month && (!best.month || p.month > best.month)) || p.count > best.count) {
              best = p;
            }
          }
        } catch (_) {}
      }
    }
    if (best && best.count > 0) return best;

    if (state.profiles && state.profiles.count > 0) {
      return state.profiles;
    }
    return null;
  }

  function applyLastMonthPfEsicToActiveSheet() {
    const sh = activeSheet();
    if (!sh || !Array.isArray(sh.rows) || !sh.rows.length) {
      setNotice('Pehle is month ki Mam sheet upload karein.', 'warn');
      return;
    }
    const prevProfiles = findPreviousMonthProfiles(sh.month || sh.id);
    if (!prevProfiles || !prevProfiles.count) {
      setNotice('Last month ki salary/compliance sheet nahi mili. Formulas Drawer -> Import Ref se pichle mahine ki sheet upload karein ya pichla month save rakhein.', 'warn');
      return;
    }

    pushUndoSnapshot();
    const s = settingsOf(sh.settings);
    let updated = 0;
    let exemptCount = 0;
    let cappedCount = 0;
    let zeroDayCount = 0;

    sh.rows.forEach(r => {
      const ck = codeKey(r.empId);
      const nk = nameKey(r.name);
      const prof = (ck && prevProfiles.byCode && prevProfiles.byCode[ck]) || (nk && prevProfiles.byName && prevProfiles.byName[nk]) || null;
      if (prof) {
        r.prevPfEmployee = Number(prof.prevPf) || 0;
        r.prevEsiEmployee = Number(prof.prevEsi) || 0;
        r.prevPfMode = prof.pfMode || '';
        r.prevEsiMode = prof.esiMode || '';
        if (prof.pfMode && prof.pfMode !== 'AUTO') r.pfMode = prof.pfMode;
        if (prof.esiMode && prof.esiMode !== 'AUTO') r.esiMode = prof.esiMode;
        updated++;
      }
      recalculateRow(r, s);
      if (r.pfMode === 'NONE' && (r.paidDays > 0 && r.earnBasic > 0)) exemptCount++;
      if (r.pfMode === 'CAP_15000') cappedCount++;
      if (r.paidDays <= 0 || r.earnBasic <= 0) zeroDayCount++;
    });

    const audit = computeLastMonthAudit(sh.rows, prevProfiles);
    sh.lastMonthAudit = audit;
    sh.prevSource = prevProfiles.sourceFile || '';
    render();
    scheduleSyncActiveSheet();
    setNotice(
      `Last Month PF/ESIC applied from ${prevProfiles.sourceFile || monthLabel(prevProfiles.month)}: ${updated} matched (${exemptCount} exempt, ${cappedCount} ₹15k cap), ${audit.skippedAbsentCount} absent/left employees strictly ₹0 (sheet me add nahi hue), ${zeroDayCount} off-roll ₹0.`,
      'ok'
    );
  }

  async function handleMamUpload(file) {
    if (!file) return;
    setNotice('Mam sheet parse ho rahi hai & Employee Master + Last Month PF/ESIC rules match ho rahe hain…', 'info');
    try {
      const sheets = await readUploadedWorkbook(file);
      let parsedRows = [];
      let usedSheet = '';
      for (const sh of sheets) {
        try {
          const r = parseMamMatrix(sh.rows, sh.name, file.name);
          if (r.length > parsedRows.length) {
            parsedRows = r;
            usedSheet = sh.name;
          }
        } catch (_) {}
      }
      if (!parsedRows.length) {
        throw new Error('Mam sheet ke columns pehchane nahi gaye. Columns rakhein: Code | Name/Category | Total.');
      }

      const detectedMonth = detectMonthFromText(file.name) || detectMonthFromText(usedSheet) || ($('mcsMonth') && $('mcsMonth').value) || todayMonth();
      const currentSettings = settingsOf(Object.assign({}, activeSheet() ? activeSheet().settings : {}, { month: detectedMonth, monthDays: daysInMonth(detectedMonth) }));
      const emps = getEmployeeMasterList();
      const advanceMap = getAdvanceBalanceMap();
      const prevProfiles = findPreviousMonthProfiles(detectedMonth);
      const rows = generateComplianceRows(parsedRows, emps, {
        settings: currentSettings,
        profiles: prevProfiles || state.profiles,
        advanceMap
      });
      const lastMonthAudit = computeLastMonthAudit(rows, prevProfiles);

      const sheetId = detectedMonth;
      const now = new Date().toISOString();
      const record = {
        id: sheetId,
        month: detectedMonth,
        title: 'Compliance Sheet · ' + monthLabel(detectedMonth),
        mamFile: file.name,
        mamSheet: usedSheet,
        settings: currentSettings,
        rows,
        lastMonthAudit,
        prevSource: prevProfiles ? (prevProfiles.sourceFile || monthLabel(prevProfiles.month)) : '',
        createdAt: now,
        updatedAt: now,
        updatedBy: currentUserLabel()
      };

      delete state.tombstones[sheetId];
      state.sheets[sheetId] = record;
      state.activeId = sheetId;
      state.pageOffset = 0;
      state.categoryFilter = 'ALL';
      state.statusFilter = 'ALL';
      state.selectedUids.clear();
      state.sortKey = '';
      state.sortDir = '';
      state.activeTab = 'MAIN';
      saveToLocal();
      render();
      pushSheetRemote(record);

      const t = computeTotals(rows);
      const extras = [];
      if (lastMonthAudit.cardShiftCount > 0) extras.push(`${lastMonthAudit.cardShiftCount} Card shifts applied`);
      if (lastMonthAudit.skippedAbsentCount > 0) extras.push(`${lastMonthAudit.skippedAbsentCount} last-month absent/left skipped (₹0 PF/ESIC)`);
      const extraTxt = extras.length ? (' · ' + extras.join(' · ')) : '';
      setNotice(
        `${file.name} loaded: ${rows.length} employees (${t.onroll} onroll, ${t.offroll} off roll) auto-enriched from ${emps.length} Employee Master records${extraTxt} & synced across browsers.`,
        'ok'
      );
    } catch (err) {
      setNotice(err && err.message ? err.message : String(err), 'err');
    } finally {
      if ($('mcsMamInput')) $('mcsMamInput').value = '';
      if ($('mcsEmptyUpload')) $('mcsEmptyUpload').value = '';
    }
  }

  async function handleReferenceUpload(file) {
    if (!file) return;
    setNotice('Consultant reference sheet se rules learn ho rahe hain…', 'info');
    try {
      const sheets = await readUploadedWorkbook(file);
      let learned = null;
      for (const sh of sheets) {
        try {
          const p = parseReferenceMatrix(sh.rows, sh.name, file.name);
          if (!learned || p.count > learned.count) learned = p;
        } catch (_) {}
      }
      if (!learned || !learned.count) throw new Error('Reference sheet valid nahi mili.');
      state.profiles = learned;
      try { localStorage.setItem(STORAGE_PROFILES_KEY, JSON.stringify(learned)); } catch (_) {}
      setNotice(`Learned ${learned.count} employee PF/ESIC rules from ${file.name}. Built-in Lokesh formulas active hain.`, 'ok');
      render();
    } catch (err) {
      setNotice(err && err.message ? err.message : String(err), 'err');
    } finally {
      if ($('mcsRefInput')) $('mcsRefInput').value = '';
    }
  }

  function visibleGridCols() {
    let leftAcc = 0;
    return GRID_COLS.filter(c => !state.hiddenCols[c.key]).map(c => {
      if (state.freezePanes && c.stickyBase) {
        const out = Object.assign({}, c, { sticky: leftAcc });
        leftAcc += c.width;
        return out;
      }
      return Object.assign({}, c, { sticky: undefined });
    });
  }

  function snapshotRows(rows) {
    return (rows || []).map(r => Object.assign({}, r, { flags: Array.isArray(r.flags) ? r.flags.slice() : [] }));
  }

  function pushUndoSnapshot() {
    const sh = activeSheet();
    if (!sh) return;
    state.undoStack.push({ activeId: state.activeId, rows: snapshotRows(sh.rows) });
    if (state.undoStack.length > 25) state.undoStack.shift();
    state.redoStack = [];
    updateUndoRedoButtons();
  }

  function updateUndoRedoButtons() {
    const u = $('mcsUndoBtn');
    const r = $('mcsRedoBtn');
    if (u) u.disabled = state.undoStack.length === 0;
    if (r) r.disabled = state.redoStack.length === 0;
  }

  function undoEdit() {
    const sh = activeSheet();
    if (!sh || !state.undoStack.length) return;
    const prev = state.undoStack.pop();
    if (!prev || prev.activeId !== state.activeId) return;
    state.redoStack.push({ activeId: state.activeId, rows: snapshotRows(sh.rows) });
    sh.rows = prev.rows;
    state.selectedUids.clear();
    render();
    scheduleSyncActiveSheet();
    setNotice('Undo applied (previous state restored & synced).', 'info');
  }

  function redoEdit() {
    const sh = activeSheet();
    if (!sh || !state.redoStack.length) return;
    const next = state.redoStack.pop();
    if (!next || next.activeId !== state.activeId) return;
    state.undoStack.push({ activeId: state.activeId, rows: snapshotRows(sh.rows) });
    sh.rows = next.rows;
    state.selectedUids.clear();
    render();
    scheduleSyncActiveSheet();
    setNotice('Redo applied.', 'info');
  }

  function filteredRows() {
    const sh = activeSheet();
    if (!sh || !Array.isArray(sh.rows)) return [];
    const q = norm(state.search);
    const filtered = sh.rows.filter(r => {
      if (state.categoryFilter !== 'ALL' && text(r.category) !== state.categoryFilter) return false;
      if (state.statusFilter === 'ONROLL' && (norm(r.remarks) === 'off roll' || r.paidDays <= 0)) return false;
      if (state.statusFilter === 'OFFROLL' && norm(r.remarks) !== 'off roll' && r.paidDays > 0) return false;
      if (state.statusFilter === 'MISSING_STAT' && (validId(r.pfNo) || validId(r.esiNo))) return false;
      if (state.statusFilter === 'DIFF_ALERT' && (r.diffAmount || 0) <= 500 && !(r.flags || []).length) return false;
      if (q) {
        const cn = parseCardNumber(r.category);
        const cardAliases = cn ? ('c' + cn + ' card ' + cn + ' cardno' + cn) : '';
        const hay = norm([r.empId, r.name, r.father, r.pfNo, r.esiNo, r.category, r.cardShiftedFrom, cardAliases, r.designation, r.department, r.remarks].join(' '));
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    if (state.sortKey && state.sortDir) {
      const colDef = GRID_COLS.find(c => c.key === state.sortKey);
      const isNum = !!(colDef && colDef.numeric);
      const mult = state.sortDir === 'desc' ? -1 : 1;
      return filtered.slice().sort((a, b) => {
        if (isNum) {
          return ((Number(a[state.sortKey]) || 0) - (Number(b[state.sortKey]) || 0)) * mult;
        }
        return String(a[state.sortKey] ?? '').localeCompare(String(b[state.sortKey] ?? ''), undefined, { numeric: true, sensitivity: 'base' }) * mult;
      });
    }
    return filtered;
  }

  function toggleSort(colKey) {
    if (state.sortKey !== colKey) {
      state.sortKey = colKey;
      state.sortDir = 'asc';
    } else if (state.sortDir === 'asc') {
      state.sortDir = 'desc';
    } else {
      state.sortKey = '';
      state.sortDir = '';
    }
    state.pageOffset = 0;
    render();
  }

  function selectCellInfo(row, colDef, rowIndexZero) {
    if (!row || !colDef) return;
    const sh = activeSheet();
    const s = settingsOf(sh && sh.settings);
    const xlRow = rowIndexZero + 2;
    const formula = typeof colDef.formula === 'function' ? colDef.formula(row, s) : String(row[colDef.key] ?? '');
    const editable = !!(colDef.edit && colDef.edit !== 'checkbox');
    state.selectedCell = {
      uid: row.uid,
      key: colDef.key,
      coord: `${colDef.col || ''}${xlRow}`,
      label: colDef.label,
      empName: row.name || row.empId,
      value: row[colDef.key],
      formula,
      editable
    };
    const barCoord = $('mcsFormulaCoord');
    const barVal = $('mcsFormulaExpr');
    const barInp = $('mcsFormulaInput');
    if (barCoord) barCoord.textContent = `${state.selectedCell.coord} · ${state.selectedCell.empName} · ${state.selectedCell.label}`;
    if (barVal) barVal.textContent = state.selectedCell.formula || '—';
    if (barInp && barVal) {
      if (editable) {
        barInp.style.display = 'block';
        barVal.style.display = 'none';
        if (document.activeElement !== barInp) {
          barInp.value = row[colDef.key] === null || row[colDef.key] === undefined ? '' : String(row[colDef.key]);
        }
      } else {
        barInp.style.display = 'none';
        barVal.style.display = 'block';
      }
    }
  }

  function applyRowCellEdit(uid, field, rawVal, skipDomSync) {
    const sh = activeSheet();
    if (!sh) return;
    const row = (sh.rows || []).find(r => r.uid === uid);
    if (!row) return;
    const s = settingsOf(sh.settings);

    if (field === 'paymentHold') {
      row.paymentHold = !!rawVal;
    } else if (field === 'remarks') {
      row._remarksEdited = true;
      row.remarks = text(rawVal) || 'onroll';
    } else if (['pfMode', 'esiMode'].includes(field)) {
      row[field] = text(rawVal) || 'AUTO';
    } else if (['basic', 'hra', 'gross', 'monthDays', 'workingDays', 'sunAllow', 'hd', 'paidDays', 'overtimeHours', 'manualAmount', 'advance'].includes(field)) {
      const parsed = num(rawVal);
      row[field] = parsed === null ? 0 : parsed;
      const monthDays = row.monthDays || s.monthDays;
      if (field === 'basic' || field === 'hra') {
        row._salaryPartsEdited = true;
        row.gross = round0((Number(row.basic) || 0) + (Number(row.hra) || 0));
      } else if (field === 'gross') {
        row._salaryPartsEdited = false;
        row.hra = Math.max(0, round0((Number(row.gross) || 0) - (Number(row.basic) || 0)));
      }
      if (field === 'workingDays' || field === 'sunAllow' || field === 'hd') {
        row._attendanceEdited = true;
        row._attendancePartsLocked = true;
        const w = Math.max(0, Number(row.workingDays) || 0);
        const sun = Math.max(0, Number(row.sunAllow) || 0);
        const h = Math.max(0, Number(row.hd) || 0);
        row.paidDays = Math.min(monthDays, round2(w + sun + h));
      } else if (field === 'paidDays') {
        row._attendanceEdited = true;
        row._attendancePartsLocked = false;
        row.paidDays = Math.max(0, Math.min(monthDays, Number(row.paidDays) || 0));
        const sp = splitPaidDays(row.paidDays, row.hd || 0);
        row.sunAllow = sp.sunAllow;
        row.workingDays = sp.workingDays;
      } else if (field === 'overtimeHours') {
        row._attendanceEdited = true;
        row.overtimeHours = Math.max(0, Number(row.overtimeHours) || 0);
      } else if (field === 'manualAmount' || (!row._attendanceEdited && (field === 'basic' || field === 'hra' || field === 'gross' || field === 'monthDays'))) {
        const rowSettings = Object.assign({}, s, { monthDays });
        const d = deriveDaysAndOt(row.manualAmount, row.basic, row.gross, rowSettings);
        row.paidDays = d.paidDays;
        row.workingDays = d.workingDays;
        row.sunAllow = d.sunAllow;
        row.hd = d.hd || 0;
        row.overtimeHours = d.overtimeHours;
        row._attendanceEdited = false;
        row._attendancePartsLocked = false;
      }
    } else {
      row[field] = text(rawVal);
      if (field === 'category') row.mamCategoryLocked = true;
      if (field === 'empId') {
        const master = indexEmployeeMaster(getEmployeeMasterList());
        const emp = master.byCode[codeKey(rawVal)];
        if (emp) {
          if (!row.name) row.name = text(emp.name);
          if (!row.father) row.father = text(emp.father);
          if (!row.dob) row.dob = text(emp.dob);
          if (!row.doj) row.doj = text(emp.doj);
          if (!validId(row.pfNo)) row.pfNo = text(emp.pf_no || 'NA');
          if (!validId(row.esiNo)) row.esiNo = text(emp.esi_no || 'NA');
          if (!row.designation) row.designation = text(emp.desig);
          if (!row.department) row.department = text(emp.dept);
          if (!row.cat1) row.cat1 = text(emp.cat1 || emp.cat2);
          if (!row.category || row.category === 'OTHER') row.category = text(emp.cat2 || emp.cat1 || 'OTHER').toUpperCase();
          if (!row.basic) row.basic = num(emp.basic) || 0;
          if (!row.gross) row.gross = num(emp.gross || emp.new_gross) || 0;
          if (!row.hra && row.gross >= row.basic) row.hra = Math.max(0, round0(row.gross - row.basic));
          if (!row.bankName) row.bankName = text(emp.bank_name);
          if (!row.ifsc) row.ifsc = text(emp.ifsc);
          if (!row.accountNo) row.accountNo = text(emp.account_no);
          row.masterMatched = true;
        }
      }
    }

    recalculateRow(row, s);
    if (!skipDomSync) {
      updateRowDomInPlace(row);
      updateSummaryAndTotalsBar();
      if (state.inspectUid === row.uid) renderInspectorBody();
      scheduleSyncActiveSheet();
    }
  }

  function updateRowDomInPlace(row) {
    const escUid = (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') ? CSS.escape(row.uid) : row.uid.replace(/["\\]/g, '\\$&');
    const tr = document.querySelector(`tr[data-uid="${escUid}"]`);
    if (!tr) return;
    const derivedKeys = [
      'absent', 'earnBasic', 'earnHra', 'grossEarned', 'earnedBonus', 'otAmount',
      'totalGross', 'diffAmount', 'pfEmployee', 'esiEmployee', 'totalDeduction',
      'netPayable', 'pfEmployer', 'esiEmployer'
    ];
    derivedKeys.forEach(k => {
      const span = tr.querySelector(`[data-ro="${k}"]`);
      if (span) {
        const col = GRID_COLS.find(c => c.key === k);
        span.textContent = col && col.money ? inr(row[k]) : String(row[k] ?? 0);
      }
    });
    [
      'workingDays', 'sunAllow', 'hd', 'paidDays', 'overtimeHours',
      'name', 'father', 'dob', 'doj', 'pfNo', 'esiNo', 'department', 'designation',
      'cat1', 'category', 'basic', 'hra', 'gross', 'remarks', 'manualAmount', 'advance'
    ].forEach(k => {
      const inp = tr.querySelector(`[data-field="${k}"]`);
      if (inp && document.activeElement !== inp) {
        inp.value = row[k] === null || row[k] === undefined ? '' : String(row[k]);
      }
    });
    const holdCb = tr.querySelector('input[data-field="paymentHold"]');
    if (holdCb && document.activeElement !== holdCb) holdCb.checked = !!row.paymentHold;
    tr.dataset.remarks = norm(row.remarks);
    tr.classList.toggle('mcs-row-hold', !!row.paymentHold);
    const activeCell = document.activeElement && document.activeElement.closest('[data-field]');
    if (activeCell) {
      const key = activeCell.dataset.field;
      const colDef = GRID_COLS.find(c => c.key === key);
      const idx = Number(tr.dataset.rowidx || 0);
      if (colDef) selectCellInfo(row, colDef, idx);
    }
  }

  function updateSummaryAndTotalsBar() {
    const sh = activeSheet();
    const rows = sh ? sh.rows || [] : [];
    const t = computeTotals(rows);
    const filtered = filteredRows();
    const ft = computeTotals(filtered);

    const kpiEl = $('mcsKpiStrip');
    if (kpiEl) {
      const cards = [
        { k: 'Employees', v: `${t.count}`, sub: `${t.onroll} onroll · ${t.offroll} off roll` },
        { k: 'Earn Basic + HRA', v: `₹${inr(t.grossEarned)}`, sub: `Basic ₹${inr(t.earnBasic)} · HRA ₹${inr(t.earnHra)}` },
        { k: 'Total Gross Salary', v: `₹${inr(t.totalGross)}`, sub: `Bonus ₹${inr(t.earnedBonus)} · OT ₹${inr(t.otAmount)}` },
        { k: 'Manual vs Diff', v: `₹${inr(t.manualAmount)}`, sub: `Diff ₹${inr(t.diffAmount)} · W.Days ${round2(t.workingDays)}` },
        { k: 'PF & ESIC Total', v: `₹${inr(t.pfEmployee + t.esiEmployee)}`, sub: `Emp+Er ₹${inr(t.pfEmployee + t.pfEmployer + t.esiEmployee + t.esiEmployer)}` },
        { k: 'Net Payable', v: `₹${inr(t.netPayable)}`, sub: `Adv ₹${inr(t.advance)} · Ded ₹${inr(t.totalDeduction)}` }
      ];
      kpiEl.innerHTML = cards.map(c =>
        `<div class="mcs-kpi">
          <div class="mcs-kpi-label">${esc(c.k)}</div>
          <div class="mcs-kpi-val num">${esc(c.v)}</div>
          <div class="mcs-kpi-sub num">${esc(c.sub)}</div>
        </div>`
      ).join('');
    }

    const totMap = {
      basic: ft.basic, hra: ft.hra, gross: ft.gross,
      workingDays: ft.workingDays, sunAllow: ft.sunAllow, hd: ft.hd, absent: ft.absent, paidDays: ft.paidDays, overtimeHours: ft.overtimeHours,
      earnBasic: ft.earnBasic, earnHra: ft.earnHra, grossEarned: ft.grossEarned,
      earnedBonus: ft.earnedBonus, otAmount: ft.otAmount,
      totalGross: ft.totalGross, manualAmount: ft.manualAmount, diffAmount: ft.diffAmount,
      pfEmployee: ft.pfEmployee, esiEmployee: ft.esiEmployee, advance: ft.advance,
      totalDeduction: ft.totalDeduction, netPayable: ft.netPayable,
      pfEmployer: ft.pfEmployer, esiEmployer: ft.esiEmployer
    };
    Object.entries(totMap).forEach(([k, val]) => {
      const td = document.querySelector(`#mcsTotalRow [data-tot="${k}"]`);
      if (td) td.textContent = inr(val);
    });

    const statusStat = $('mcsStatusStats');
    if (statusStat) {
      const selectedList = state.selectedUids.size
        ? rows.filter(r => state.selectedUids.has(r.uid))
        : filtered;
      const st = computeTotals(selectedList);
      const avg = st.count ? Math.round(st.netPayable / st.count) : 0;
      const label = state.selectedUids.size ? 'Selected' : 'Filtered';
      statusStat.textContent = `${label}: ${st.count} · Net Sum: ₹${inr(st.netPayable)} · Avg: ₹${inr(avg)}`;
    }

    updateBulkBar();
    if (state.exportModalOpen) syncExportModalUi();
  }

  function updateBulkBar() {
    const bar = $('mcsBulkBar');
    if (!bar) return;
    const sh = activeSheet();
    const n = state.selectedUids.size;
    if (!sh || n === 0 || state.activeTab !== 'MAIN') {
      bar.style.display = 'none';
      return;
    }
    const selRows = (sh.rows || []).filter(r => state.selectedUids.has(r.uid));
    const t = computeTotals(selRows);
    bar.style.display = 'flex';
    const info = $('mcsBulkInfo');
    if (info) {
      info.textContent = `${selRows.length} selected · Net ₹${inr(t.netPayable)} · Diff ₹${inr(t.diffAmount)}`;
    }
  }

  function applyBulkAction(action, value) {
    const sh = activeSheet();
    if (!sh || !state.selectedUids.size) return;
    const s = settingsOf(sh.settings);
    const targets = (sh.rows || []).filter(r => state.selectedUids.has(r.uid));
    if (!targets.length) return;
    pushUndoSnapshot();
    if (action === 'delete') {
      sh.rows = (sh.rows || []).filter(r => !state.selectedUids.has(r.uid));
      state.selectedUids.clear();
      render();
      scheduleSyncActiveSheet();
      setNotice(`${targets.length} selected rows deleted (Undo available).`, 'info');
      return;
    }
    targets.forEach(r => {
      if (action === 'paidDays') {
        r._attendanceEdited = true;
        r._attendancePartsLocked = false;
        r.paidDays = Math.max(0, Math.min(r.monthDays || s.monthDays, num(value) || 0));
      } else if (action === 'overtimeHours') {
        r._attendanceEdited = true;
        r.overtimeHours = Math.max(0, num(value) || 0);
      } else if (action === 'pfMode') r.pfMode = text(value) || 'AUTO';
      else if (action === 'esiMode') r.esiMode = text(value) || 'AUTO';
      else if (action === 'remarks') { r._remarksEdited = true; r.remarks = text(value) || 'onroll'; }
      else if (action === 'hold') r.paymentHold = !!value;
      recalculateRow(r, s);
    });
    render();
    scheduleSyncActiveSheet();
    setNotice(`Bulk update applied to ${targets.length} rows & synced.`, 'ok');
  }

  function applyFindAndReplace() {
    const sh = activeSheet();
    if (!sh) return;
    const field = ($('mcsFrField') && $('mcsFrField').value) || 'category';
    const findVal = ($('mcsFrFind') && $('mcsFrFind').value) || '';
    const replaceVal = ($('mcsFrReplace') && $('mcsFrReplace').value) || '';
    const scope = ($('mcsFrScope') && $('mcsFrScope').value) || 'FILTERED';
    if (!findVal && !replaceVal) {
      setNotice('Find ya Replace value enter karein.', 'warn');
      return;
    }
    const pool = scope === 'SELECTED' && state.selectedUids.size
      ? (sh.rows || []).filter(r => state.selectedUids.has(r.uid))
      : filteredRows();
    const s = settingsOf(sh.settings);
    let count = 0;
    pushUndoSnapshot();
    pool.forEach(r => {
      const cur = text(r[field]);
      if (!findVal || norm(cur) === norm(findVal) || cur.toLowerCase().includes(findVal.toLowerCase())) {
        if (!findVal) r[field] = replaceVal;
        else if (norm(cur) === norm(findVal)) r[field] = replaceVal;
        else r[field] = cur.replace(new RegExp(findVal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), replaceVal);
        if (field === 'remarks') r._remarksEdited = true;
        recalculateRow(r, s);
        count++;
      }
    });
    if (!count) state.undoStack.pop();
    render();
    if (count) scheduleSyncActiveSheet();
    setNotice(count ? `Replaced in ${count} rows & synced.` : 'Koi matching value nahi mili.', count ? 'ok' : 'warn');
  }

  function addBlankRow() {
    const sh = activeSheet();
    if (!sh) return;
    pushUndoSnapshot();
    const s = settingsOf(sh.settings);
    const row = recalculateRow({
      uid: 'r_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      _index: sh.rows.length,
      empId: '',
      name: '',
      father: '',
      dob: '',
      doj: '',
      pfNo: 'NA',
      esiNo: 'NA',
      gender: 'MALE',
      department: '',
      designation: '',
      cat1: '',
      category: state.categoryFilter !== 'ALL' ? state.categoryFilter : 'STAFF NAME',
      basic: 0,
      hra: 0,
      gross: 0,
      monthDays: s.monthDays,
      workingDays: 0,
      sunAllow: 0,
      hd: 0,
      absent: 0,
      paidDays: 0,
      overtimeHours: 0,
      earnBasic: 0,
      earnHra: 0,
      grossEarned: 0,
      earnedBonus: 0,
      otAmount: 0,
      totalGross: 0,
      manualAmount: 0,
      diffAmount: 0,
      pfMode: 'AUTO',
      esiMode: 'AUTO',
      advance: 0,
      remarks: 'off roll',
      paymentHold: false,
      masterMatched: false
    }, s);
    sh.rows.unshift(row);
    state.pageOffset = 0;
    state.activeTab = 'MAIN';
    render();
    scheduleSyncActiveSheet();
    setNotice('Nayi blank row add ho gayi. Employee ID daalne par Employee Master se details auto-fill hongi.', 'ok');
  }

  function deleteRow(uid) {
    const sh = activeSheet();
    if (!sh) return;
    pushUndoSnapshot();
    sh.rows = (sh.rows || []).filter(r => r.uid !== uid);
    state.selectedUids.delete(uid);
    render();
    scheduleSyncActiveSheet();
  }

  function refreshFromMasterAndAdvance(pullAdvances) {
    const sh = activeSheet();
    if (!sh) return;
    pushUndoSnapshot();
    const s = settingsOf(sh.settings);
    const emps = getEmployeeMasterList();
    const master = indexEmployeeMaster(emps);
    const masterCardMap = buildMasterCardMap(emps);
    const advMap = pullAdvances ? getAdvanceBalanceMap() : {};
    let updatedCount = 0;

    (sh.rows || []).forEach(r => {
      const ck = codeKey(r.empId);
      const nk = nameKey(r.name);
      const emp = (ck && master.byCode[ck]) || (nk && master.byName[nk]) || null;
      if (emp) {
        updatedCount++;
        r.empId = cleanCode(emp.emp_id || r.empId);
        r.name = text(emp.name) || r.name;
        r.father = text(emp.father) || r.father;
        r.pfNo = text(emp.pf_no) || r.pfNo || 'NA';
        r.esiNo = text(emp.esi_no) || r.esiNo || 'NA';
        r.gender = text(emp.gender) || r.gender;
        r.designation = text(emp.desig) || r.designation;
        r.department = text(emp.dept) || r.department;
        const masterCat = text(emp.cat2 || emp.cat1).toUpperCase();
        // If employee shifted Card in Mam Sheet (e.g. Master CARD NO. 1 -> Mam C7 / CARD NO.7), preserve shifted Card!
        if (r.mamCategoryLocked) {
          if (masterCat && canonicalizeCardCategory(masterCat, masterCardMap) !== r.category) {
            r.cardShiftedFrom = masterCat;
          }
        } else {
          r.category = (masterCat || r.category || 'OTHER').toUpperCase();
        }
        r.dob = text(emp.dob) || r.dob;
        r.doj = text(emp.doj) || r.doj;
        r.bankName = text(emp.bank_name) || r.bankName;
        r.ifsc = text(emp.ifsc) || r.ifsc;
        r.accountNo = text(emp.account_no) || r.accountNo;
        const mGross = num(emp.gross || emp.new_gross);
        const mBasic = num(emp.basic);
        if (mGross && mGross > 0) r.gross = round0(mGross);
        if (mBasic && mBasic > 0) r.basic = round0(mBasic);
        else if (r.gross > 0 && !r.basic) r.basic = round0(r.gross / 1.15);
        r.masterMatched = true;
      }
      if (pullAdvances && ck && num(advMap[ck]) !== null) {
        r.advance = round0(advMap[ck]);
      }
      const d = deriveDaysAndOt(r.manualAmount, r.basic, r.gross, s);
      r.paidDays = d.paidDays;
      r.overtimeHours = d.overtimeHours;
      recalculateRow(r, s);
    });

    render();
    scheduleSyncActiveSheet();
    setNotice(
      pullAdvances
        ? `Employee Master (${updatedCount} matched, Mam Card shifts preserved) & Advance Ledger se sheet recalculate aur sync ho gayi.`
        : `Employee Master se ${updatedCount} employees refresh aur recalculate ho gaye (Mam Card shifts preserved).`,
      'ok'
    );
  }

  function applySettingsFromDrawer() {
    const sh = activeSheet();
    if (!sh) return;
    pushUndoSnapshot();
    const s = settingsOf({
      month: ($('mcsSetMonth') && $('mcsSetMonth').value) || sh.month,
      monthDays: $('mcsSetMonthDays') ? $('mcsSetMonthDays').value : sh.settings.monthDays,
      maxOtHours: $('mcsSetMaxOt') ? $('mcsSetMaxOt').value : sh.settings.maxOtHours,
      bonusMode: $('mcsSetBonusMode') ? $('mcsSetBonusMode').value : sh.settings.bonusMode,
      bonusRate: $('mcsSetBonusRate') ? $('mcsSetBonusRate').value : sh.settings.bonusRate,
      otDivisor: $('mcsSetOtDivisor') ? $('mcsSetOtDivisor').value : sh.settings.otDivisor,
      pfDefaultMode: $('mcsSetPfMode') ? $('mcsSetPfMode').value : sh.settings.pfDefaultMode,
      esiBase: $('mcsSetEsiBase') ? $('mcsSetEsiBase').value : sh.settings.esiBase
    });
    sh.settings = s;
    (sh.rows || []).forEach(r => {
      r.monthDays = s.monthDays;
      if (!r._attendanceEdited) {
        const d = deriveDaysAndOt(r.manualAmount, r.basic, r.gross, s);
        r.paidDays = d.paidDays;
        r.overtimeHours = d.overtimeHours;
        r._attendancePartsLocked = false;
      }
      recalculateRow(r, s);
    });
    render();
    scheduleSyncActiveSheet();
    setNotice('Lokesh Compliance formulas apply aur recalculate ho gaye (sabhi browsers par synced).', 'ok');
  }

  function saveExportOptions() {
    try { localStorage.setItem(STORAGE_EXPORT_KEY, JSON.stringify(state.exportOptions)); } catch (_) {}
  }

  function resolveRowsForExport(sh, scope) {
    const rows = (sh && sh.rows) || [];
    if (scope === 'SELECTED' && state.selectedUids.size) return rows.filter(r => state.selectedUids.has(r.uid));
    if (scope === 'FILTERED') return filteredRows();
    if (scope === 'ONROLL') return rows.filter(r => norm(r.remarks) !== 'off roll' && (Number(r.paidDays) || 0) > 0);
    return rows;
  }

  function runCustomExport(presetMode, customOpts) {
    const sh = activeSheet();
    if (!sh || !sh.rows || !sh.rows.length) {
      setNotice('Download ke liye pehle Mam sheet upload karein.', 'warn');
      return;
    }
    const opts = cloneExportOpts(customOpts || state.exportOptions);
    if (presetMode === 'CSV') {
      exportCsv(resolveRowsForExport(sh, opts.scope));
      return;
    }
    if (!root.XLSX) {
      setNotice('Excel library (XLSX) load nahi hui. Page refresh karein.', 'err');
      return;
    }
    if (presetMode === 'BANK_ONLY') {
      opts.sheets = { main: false, categorySummary: false, categoryTabs: false, bankNeft: true, statutory: false, diffVariance: false, master: false, lastMonthAudit: false, notes: false };
    } else if (presetMode === 'CHALLAN_ONLY') {
      opts.sheets = { main: false, categorySummary: false, categoryTabs: false, bankNeft: false, statutory: true, diffVariance: false, master: false, lastMonthAudit: false, notes: true };
    }
    const targetRows = resolveRowsForExport(sh, opts.scope);
    if (!targetRows.length) {
      setNotice('Selected export filter me 0 rows hain. Scope "All Employees" select karein.', 'warn');
      return;
    }
    try {
      const prevProfiles = findPreviousMonthProfiles(sh.month || sh.id);
      const wb = buildComplianceWorkbook(root.XLSX, targetRows, sh.settings, {
        mamFile: sh.mamFile,
        updatedAt: sh.updatedAt,
        lastMonthAudit: sh.lastMonthAudit,
        prevProfiles,
        exportOptions: opts
      });
      const defaultStem = presetMode === 'BANK_ONLY'
        ? `ATPL_Bank_NEFT_${sh.month || todayMonth()}`
        : (presetMode === 'CHALLAN_ONLY'
          ? `ATPL_PF_ESIC_Challan_${sh.month || todayMonth()}`
          : `ATPL_ESI_PF_Compliance_${sh.month || todayMonth()}`);
      const safeStem = text(opts.customFilename).replace(/[\\/:*?"<>|]/g, '_').replace(/\.xlsx$/i, '');
      const fname = (safeStem || defaultStem) + '.xlsx';
      if (root.XLSX.CFB && typeof Blob !== 'undefined' && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
        const bytes = styleComplianceWorkbookBytes(root.XLSX, wb);
        const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fname;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1500);
      } else {
        root.XLSX.writeFile(wb, fname, { compression: true });
      }
      setNotice(`Formatted Excel downloaded: ${fname} (${targetRows.length} employees · ${wb.SheetNames.length} sheets · Live Formulas & Full Borders).`, 'ok');
    } catch (err) {
      setNotice('Excel export error: ' + (err && err.message ? err.message : err), 'err');
    }
  }

  function downloadExcel() {
    runCustomExport('FULL', state.exportOptions);
  }

  function exportCsv(explicitRows) {
    const sh = activeSheet();
    if (!sh || !sh.rows || !sh.rows.length) {
      setNotice('CSV export ke liye pehle Mam sheet upload karein.', 'warn');
      return;
    }
    const cols = visibleGridCols().filter(c => c.key !== '_select' && c.key !== '_delete');
    const escCsv = v => {
      const s = String(v === null || v === undefined ? '' : v);
      return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const rows = Array.isArray(explicitRows)
      ? explicitRows
      : (state.selectedUids.size ? sh.rows.filter(r => state.selectedUids.has(r.uid)) : filteredRows());
    const lines = [cols.map(c => escCsv(c.label)).join(',')];
    rows.forEach((r, i) => {
      lines.push(cols.map(c => escCsv(c.key === 'serial' ? i + 1 : r[c.key])).join(','));
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ATPL_Compliance_${sh.month || todayMonth()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice(`CSV exported (${rows.length} rows).`, 'ok');
  }

  async function copyToExcelClipboard() {
    const sh = activeSheet();
    if (!sh || !sh.rows || !sh.rows.length) return;
    const cols = visibleGridCols().filter(c => c.key !== '_select' && c.key !== '_delete');
    const rows = state.selectedUids.size ? sh.rows.filter(r => state.selectedUids.has(r.uid)) : filteredRows();
    const cleanCell = v => String(v === null || v === undefined ? '' : v).replace(/[\t\r\n]+/g, ' ');
    const lines = [cols.map(c => cleanCell(c.label)).join('\t')];
    rows.forEach((r, i) => {
      lines.push(cols.map(c => cleanCell(c.key === 'serial' ? i + 1 : r[c.key])).join('\t'));
    });
    const tsv = lines.join('\n');
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(tsv);
      } else {
        const ta = document.createElement('textarea');
        ta.value = tsv;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setNotice(`Copied ${rows.length} rows for MS Excel — ab Excel me seedha Ctrl+V paste kar sakte ho.`, 'ok');
    } catch (_) {
      setNotice('Clipboard copy blocked by browser permissions.', 'warn');
    }
  }

  function pasteFromClipboardText(startUid, startField, clipText) {
    const sh = activeSheet();
    if (!sh || !clipText) return false;
    if (!clipText.includes('\t') && !clipText.includes('\n')) return false;
    const list = filteredRows();
    const startRowIdx = list.findIndex(r => r.uid === startUid);
    const cols = visibleGridCols();
    const startColIdx = cols.findIndex(c => c.key === startField);
    if (startRowIdx < 0 || startColIdx < 0) return false;

    const matrix = clipText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    if (matrix.length && matrix[matrix.length - 1] === '') matrix.pop();
    if (!matrix.length) return false;

    pushUndoSnapshot();
    let updatedCells = 0;
    for (let rOff = 0; rOff < matrix.length; rOff++) {
      const targetRow = list[startRowIdx + rOff];
      if (!targetRow) break;
      const vals = matrix[rOff].split('\t');
      for (let cOff = 0; cOff < vals.length; cOff++) {
        const targetCol = cols[startColIdx + cOff];
        if (!targetCol || !targetCol.edit) continue;
        const val = targetCol.edit === 'checkbox' ? /^(1|true|yes|hold)$/i.test(vals[cOff].trim()) : vals[cOff];
        applyRowCellEdit(targetRow.uid, targetCol.key, val, true);
        updatedCells++;
      }
    }
    if (updatedCells > 0) {
      render();
      scheduleSyncActiveSheet();
      setNotice(`Excel paste applied: ${updatedCells} cells updated & recalculated.`, 'ok');
    } else {
      state.undoStack.pop();
    }
    return true;
  }

  function toggleFocusMode(force) {
    state.focusMode = typeof force === 'boolean' ? force : !state.focusMode;
    const shell = $('mcsShell');
    if (shell) shell.classList.toggle('mcs-focus', state.focusMode);
    const btn = $('mcsExpandGridBtn');
    if (btn) btn.textContent = state.focusMode ? '⊟ Show Summary' : '⛶ Expand Grid';
  }

  async function toggleBrowserFullscreen() {
    const page = $('page-mamsalary');
    if (!page) return;
    const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    if (!fsEl) {
      state.isFullscreen = true;
      toggleFocusMode(true);
      try {
        if (page.requestFullscreen) await page.requestFullscreen();
        else if (page.webkitRequestFullscreen) page.webkitRequestFullscreen();
      } catch (_) {}
    } else {
      state.isFullscreen = false;
      try {
        if (document.exitFullscreen) await document.exitFullscreen();
        else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
      } catch (_) {}
    }
    updateFullscreenButton();
  }

  function updateFullscreenButton() {
    const fsEl = typeof document !== 'undefined' && (document.fullscreenElement || document.webkitFullscreenElement);
    state.isFullscreen = !!fsEl;
    const btn = $('mcsFullscreenBtn');
    if (btn) btn.textContent = state.isFullscreen ? '✕ Exit Full Screen' : '⛶ Full Screen';
  }

  async function deleteActiveMonthSheet() {
    const sh = activeSheet();
    if (!sh) return;
    const id = sh.id;
    state.tombstones[id] = new Date().toISOString();
    delete state.sheets[id];
    const rem = Object.keys(state.sheets).sort().reverse();
    state.activeId = rem[0] || '';
    state.selectedUids.clear();
    state.undoStack = [];
    state.redoStack = [];
    saveToLocal();
    render();
    await deleteSheetRemote(id);
    setNotice(`${monthLabel(id)} ki compliance sheet delete ho gayi.`, 'info');
  }

  function renderCell(row, col, rowIdxZero) {
    const stickyStyle = typeof col.sticky === 'number' ? `left:${col.sticky}px;` : '';
    if (col.key === '_select') {
      const checked = state.selectedUids.has(row.uid) ? ' checked' : '';
      return `<td class="${typeof col.sticky === 'number' ? 'mcs-sticky' : ''}" style="${stickyStyle}width:${col.width}px;text-align:center">
        <input type="checkbox" class="mcs-row-check" data-sel="${esc(row.uid)}"${checked} aria-label="Select row">
      </td>`;
    }
    if (col.key === 'serial') {
      return `<td class="${typeof col.sticky === 'number' ? 'mcs-sticky ' : ''}num" style="${stickyStyle}width:${col.width}px;text-align:center;color:#64748b">${rowIdxZero + 1}</td>`;
    }
    if (col.key === '_delete') {
      return `<td style="text-align:center">
        <button type="button" class="mcs-row-ins" data-inspect="${esc(row.uid)}" title="Inspect Compliance Formula">🔍</button>
        <button type="button" class="mcs-row-del" data-del="${esc(row.uid)}" title="Remove row">✕</button>
      </td>`;
    }

    const roleCls = col.key === 'netPayable'
      ? 'mcs-cell-net'
      : (['pfEmployee', 'esiEmployee', 'advance', 'totalDeduction'].includes(col.key)
        ? 'mcs-cell-ded'
        : (col.key === 'diffAmount' ? 'mcs-cell-diff' : (['pfEmployer', 'esiEmployer'].includes(col.key) ? 'mcs-cell-er' : '')));
    const cls = [
      typeof col.sticky === 'number' ? 'mcs-sticky' : '',
      col.align === 'right' ? 'num mcs-num' : '',
      col.edit ? 'mcs-editable' : 'mcs-formula-cell',
      roleCls
    ].filter(Boolean).join(' ');

    if (col.edit === 'checkbox') {
      const checked = row[col.key] ? ' checked' : '';
      return `<td class="${cls}" style="${stickyStyle}width:${col.width}px;text-align:center">
        <input data-field="${col.key}" type="checkbox" class="mcs-row-check"${checked}>
      </td>`;
    }

    if (col.edit === 'select') {
      const val = text(row[col.key]) || col.options[0];
      return `<td class="${cls}" style="${stickyStyle}width:${col.width}px">
        <select data-field="${col.key}" class="mcs-cell-select">
          ${col.options.map(o => `<option value="${esc(o)}"${o === val ? ' selected' : ''}>${esc(o)}</option>`).join('')}
        </select>
      </td>`;
    }

    if (col.edit) {
      const val = row[col.key] === null || row[col.key] === undefined ? '' : row[col.key];
      const shiftHint = (col.key === 'category' && row.cardShiftedFrom) ? ` title="Card shifted from ${esc(row.cardShiftedFrom)} -> ${esc(row.category)} (Mam Sheet priority)"` : '';
      return `<td class="${cls}" style="${stickyStyle}width:${col.width}px"${shiftHint}>
        <input data-field="${col.key}" type="${col.edit}" ${col.edit === 'number' ? 'step="any"' : ''} class="mcs-cell-input ${col.align === 'right' ? 'num' : ''}" value="${esc(val)}">
      </td>`;
    }

    const disp = col.money ? inr(row[col.key]) : esc(row[col.key]);
    return `<td class="${cls}" data-ro-cell="${col.key}" style="${stickyStyle}width:${col.width}px" tabindex="0">
      <span data-ro="${col.key}">${disp}</span>
    </td>`;
  }

  function renderMainTableChrome(cols, filteredList) {
    const colgroup = $('mcsTableColgroup');
    const thead = $('mcsTableHead');
    const tfoot = $('mcsTableFoot');
    if (colgroup) {
      colgroup.innerHTML = cols.map(c => `<col style="width:${c.width}px;min-width:${c.width}px">`).join('');
    }
    if (thead) {
      const allFilteredSelected = filteredList.length > 0 && filteredList.every(r => state.selectedUids.has(r.uid));
      const letterRow = `<tr class="mcs-xl-letters">${cols.map(c => {
        const st = typeof c.sticky === 'number' ? `left:${c.sticky}px;` : '';
        return `<th class="${typeof c.sticky === 'number' ? 'mcs-sticky' : ''}" style="${st}">${esc(c.col || '')}</th>`;
      }).join('')}</tr>`;
      const headerRow = `<tr>${cols.map(c => {
        const st = typeof c.sticky === 'number' ? `left:${c.sticky}px;` : '';
        const align = c.align === 'right' ? 'text-align:right;' : (c.align === 'center' ? 'text-align:center;' : '');
        if (c.key === '_select') {
          return `<th class="${typeof c.sticky === 'number' ? 'mcs-sticky' : ''}" style="${st}${align}"><input type="checkbox" id="mcsSelectAll" class="mcs-row-check"${allFilteredSelected ? ' checked' : ''} title="Select all filtered rows"></th>`;
        }
        const sortIcon = state.sortKey === c.key ? (state.sortDir === 'asc' ? ' ▲' : ' ▼') : '';
        const sortAttr = c.sortable ? ` data-sort="${c.key}" style="${st}${align}cursor:pointer"` : ` style="${st}${align}"`;
        return `<th class="${typeof c.sticky === 'number' ? 'mcs-sticky ' : ''}${c.sortable ? 'mcs-th-sort' : ''}"${sortAttr} title="${c.sortable ? 'Click to sort' : ''}">${esc(c.label)}${sortIcon ? `<span class="mcs-sort-ind">${sortIcon}</span>` : ''}</th>`;
      }).join('')}</tr>`;
      thead.innerHTML = letterRow + headerRow;
    }
    if (tfoot) {
      tfoot.innerHTML = `<tr id="mcsTotalRow">${cols.map(c => {
        const st = typeof c.sticky === 'number' ? `left:${c.sticky}px;` : '';
        const cls = typeof c.sticky === 'number' ? 'mcs-sticky' : '';
        if (c.key === '_select') return `<td class="${cls}" style="${st}"></td>`;
        if (c.key === 'serial') return `<td class="${cls}" style="${st}text-align:center">—</td>`;
        if (c.key === 'empId') return `<td class="${cls}" style="${st}">TOTAL</td>`;
        if (c.key === 'name') return `<td class="${cls}" style="${st}">Grand Total</td>`;
        if (c.totalKey) return `<td class="num" data-tot="${c.totalKey}">0</td>`;
        return '<td></td>';
      }).join('')}</tr>`;
    }
  }

  function renderSummaryTab(tab, allRows) {
    const colgroup = $('mcsTableColgroup');
    const thead = $('mcsTableHead');
    const tbody = $('mcsTableBody');
    const tfoot = $('mcsTableFoot');
    const t = computeTotals(allRows);

    if (tab === 'CATEGORY') {
      const groups = {};
      allRows.forEach(r => {
        const k = text(r.category) || 'OTHER';
        (groups[k] = groups[k] || []).push(r);
      });
      const cats = Object.keys(groups).sort();
      const hdrs = ['S.No.', 'Category (Click to Filter)', 'Employees', 'Onroll', 'Off Roll', 'Earn Basic', 'Total Gross', 'Manual Amount', 'Diff. Amount', 'PF@12%', 'ESIC@0.75%', 'Advance', 'Net Payable'];
      if (colgroup) colgroup.innerHTML = hdrs.map((_, i) => `<col style="width:${i === 1 ? 220 : i === 0 ? 58 : 115}px">`).join('');
      if (thead) thead.innerHTML = `<tr>${hdrs.map((h, i) => `<th style="${i >= 2 ? 'text-align:right' : ''}">${esc(h)}</th>`).join('')}</tr>`;
      if (tbody) {
        tbody.innerHTML = cats.map((cat, idx) => {
          const ct = computeTotals(groups[cat]);
          return `<tr class="mcs-cat-row" data-jump-cat="${esc(cat)}" style="cursor:pointer">
            <td style="text-align:center;color:#64748b" class="num">${idx + 1}</td>
            <td style="padding:0 10px;font-weight:700;color:#1d4ed8">${esc(cat)}</td>
            <td class="mcs-formula-cell num">${ct.count}</td>
            <td class="mcs-formula-cell num">${ct.onroll}</td>
            <td class="mcs-formula-cell num">${ct.offroll}</td>
            <td class="mcs-formula-cell num">${inr(ct.earnBasic)}</td>
            <td class="mcs-formula-cell num">${inr(ct.totalGross)}</td>
            <td class="mcs-formula-cell num">${inr(ct.manualAmount)}</td>
            <td class="mcs-formula-cell num">${inr(ct.diffAmount)}</td>
            <td class="mcs-formula-cell num">${inr(ct.pfEmployee)}</td>
            <td class="mcs-formula-cell num">${inr(ct.esiEmployee)}</td>
            <td class="mcs-formula-cell num">${inr(ct.advance)}</td>
            <td class="mcs-formula-cell num">${inr(ct.netPayable)}</td>
          </tr>`;
        }).join('');
      }
      if (tfoot) {
        tfoot.innerHTML = `<tr>
          <td style="text-align:center">—</td><td style="text-align:left">GRAND TOTAL (${cats.length} Categories)</td>
          <td class="num">${t.count}</td><td class="num">${t.onroll}</td><td class="num">${t.offroll}</td>
          <td class="num">${inr(t.earnBasic)}</td><td class="num">${inr(t.totalGross)}</td><td class="num">${inr(t.manualAmount)}</td>
          <td class="num">${inr(t.diffAmount)}</td><td class="num">${inr(t.pfEmployee)}</td><td class="num">${inr(t.esiEmployee)}</td>
          <td class="num">${inr(t.advance)}</td><td class="num">${inr(t.netPayable)}</td>
        </tr>`;
      }
      return;
    }

    if (tab === 'PF_ESIC') {
      const hdrs = ['S.No.', 'Employee ID', 'Name of employee', 'PF NO', 'ESI NO', 'PF Rule', 'PF Wages', 'PF Emp (12%)', 'Prev PF', 'ESIC Rule', 'ESIC Wages', 'ESIC Emp (0.75%)', 'Prev ESIC', 'Total PF+ESIC', 'Remarks'];
      if (colgroup) colgroup.innerHTML = hdrs.map((_, i) => `<col style="width:${i === 2 ? 195 : i === 0 ? 54 : [5, 9].includes(i) ? 98 : 114}px">`).join('');
      if (thead) thead.innerHTML = `<tr>${hdrs.map((h, i) => `<th style="${[6, 7, 8, 10, 11, 12, 13].includes(i) ? 'text-align:right' : ''}">${esc(h)}</th>`).join('')}</tr>`;
      const statRows = allRows.filter(r => (r.pfEmployee || 0) > 0 || (r.esiEmployee || 0) > 0 || (r.prevPfEmployee || 0) > 0 || (r.prevEsiEmployee || 0) > 0 || validId(r.pfNo) || validId(r.esiNo));
      const pfW = round0(statRows.reduce((a, b) => a + (b.pfWage || 0), 0));
      const esiW = round0(statRows.reduce((a, b) => a + (b.esiWage || 0), 0));
      const prevPfTot = round0(statRows.reduce((a, b) => a + (Number(b.prevPfEmployee) || 0), 0));
      const prevEsiTot = round0(statRows.reduce((a, b) => a + (Number(b.prevEsiEmployee) || 0), 0));
      const st = computeTotals(statRows);
      if (tbody) {
        tbody.innerHTML = statRows.slice(0, 500).map((r, idx) => {
          const totalC = (r.pfEmployee || 0) + (r.pfEmployer || 0) + (r.esiEmployee || 0) + (r.esiEmployer || 0);
          return `<tr>
            <td style="text-align:center;color:#64748b" class="num">${idx + 1}</td>
            <td style="padding:0 8px">${esc(r.empId)}</td>
            <td style="padding:0 8px;font-weight:600">${esc(r.name)}</td>
            <td style="padding:0 8px" class="num">${esc(r.pfNo)}</td>
            <td style="padding:0 8px" class="num">${esc(r.esiNo)}</td>
            <td style="padding:0 8px;font-weight:600;color:#1d4ed8">${esc(r.pfMode || 'AUTO')}</td>
            <td class="mcs-formula-cell num">${inr(r.pfWage || 0)}</td>
            <td class="mcs-formula-cell num" style="font-weight:700">${inr(r.pfEmployee || 0)}</td>
            <td class="mcs-formula-cell num" style="color:#64748b">${inr(r.prevPfEmployee || 0)}</td>
            <td style="padding:0 8px;font-weight:600;color:#1d4ed8">${esc(r.esiMode || 'AUTO')}</td>
            <td class="mcs-formula-cell num">${inr(r.esiWage || 0)}</td>
            <td class="mcs-formula-cell num" style="font-weight:700">${inr(r.esiEmployee || 0)}</td>
            <td class="mcs-formula-cell num" style="color:#64748b">${inr(r.prevEsiEmployee || 0)}</td>
            <td class="mcs-formula-cell num" style="font-weight:700">${inr(totalC)}</td>
            <td style="padding:0 8px">${esc(r.remarks)}</td>
          </tr>`;
        }).join('');
      }
      if (tfoot) {
        tfoot.innerHTML = `<tr>
          <td></td><td style="text-align:left">TOTAL</td><td style="text-align:left">${statRows.length} Statutory</td><td></td><td></td><td></td>
          <td class="num">${inr(pfW)}</td><td class="num">${inr(st.pfEmployee)}</td><td class="num">${inr(prevPfTot)}</td><td></td>
          <td class="num">${inr(esiW)}</td><td class="num">${inr(st.esiEmployee)}</td><td class="num">${inr(prevEsiTot)}</td>
          <td class="num">${inr(st.pfEmployee + st.pfEmployer + st.esiEmployee + st.esiEmployer)}</td><td></td>
        </tr>`;
      }
      return;
    }

    if (tab === 'LAST_MONTH') {
      const sh = activeSheet();
      const prevProfiles = findPreviousMonthProfiles(sh && (sh.month || sh.id));
      const audit = (sh && sh.lastMonthAudit) || computeLastMonthAudit(allRows, prevProfiles);
      const hdrs = ['Audit Type', 'Employee ID', 'Name of employee', 'Master / Prev', 'Current Card / Status', 'Last Month PF', 'This Month PF', 'Last Month ESIC', 'This Month ESIC', 'Audit Reason'];
      if (colgroup) colgroup.innerHTML = hdrs.map((_, i) => `<col style="width:${i === 9 ? 280 : i === 2 ? 190 : i === 0 ? 185 : 118}px">`).join('');
      if (thead) thead.innerHTML = `<tr>${hdrs.map((h, i) => `<th style="${[5, 6, 7, 8].includes(i) ? 'text-align:right' : ''}">${esc(h)}</th>`).join('')}</tr>`;
      const items = [];
      (audit.skippedAbsent || []).forEach(x => {
        items.push({ type: 'ABSENT / LEFT (NOT IN MAM)', cls: 'mcs-row-warn', empId: x.empId, name: x.name, prev: x.category || 'Prev Month', curr: 'NOT IN MAM (₹0)', prevPf: x.prevPf, currPf: 0, prevEsi: x.prevEsi, currEsi: 0, reason: x.reason });
      });
      (audit.zeroDayCurrent || []).forEach(x => {
        items.push({ type: 'OFF ROLL / 0 PAID DAYS', cls: 'mcs-row-off', empId: x.empId, name: x.name, prev: x.category, curr: '0 Paid Days (₹0)', prevPf: x.prevPf, currPf: 0, prevEsi: x.prevEsi, currEsi: 0, reason: x.reason });
      });
      (audit.cardShifts || []).forEach(x => {
        items.push({ type: 'CARD SHIFTED', cls: '', empId: x.empId, name: x.name, prev: x.fromCard, curr: x.toCard, prevPf: 0, currPf: x.pfEmployee, prevEsi: 0, currEsi: x.esiEmployee, reason: `Master: ${x.fromCard} -> Mam Salary Card: ${x.toCard}` });
      });
      if (tbody) {
        tbody.innerHTML = items.length ? items.slice(0, 500).map(it => `<tr class="${it.cls}">
          <td style="padding:0 8px;font-weight:700">${esc(it.type)}</td>
          <td style="padding:0 8px">${esc(it.empId)}</td>
          <td style="padding:0 8px;font-weight:600">${esc(it.name)}</td>
          <td style="padding:0 8px">${esc(it.prev)}</td>
          <td style="padding:0 8px;font-weight:600;color:#1d4ed8">${esc(it.curr)}</td>
          <td class="mcs-formula-cell num">${inr(it.prevPf)}</td>
          <td class="mcs-formula-cell num" style="font-weight:700">${inr(it.currPf)}</td>
          <td class="mcs-formula-cell num">${inr(it.prevEsi)}</td>
          <td class="mcs-formula-cell num" style="font-weight:700">${inr(it.currEsi)}</td>
          <td style="padding:0 8px">${esc(it.reason)}</td>
        </tr>`).join('') : `<tr><td colspan="10" style="padding:18px;text-align:center;color:#64748b">Koi absent/left skip ya card shift pending nahi hai. (${audit.matchedCount || 0} employees previous month se matched).</td></tr>`;
      }
      if (tfoot) {
        tfoot.innerHTML = `<tr>
          <td colspan="5" style="text-align:left">AUDIT SUMMARY · Skipped Absent: ${audit.skippedAbsentCount || 0} (Strictly ₹0) · 0-Day Off Roll: ${audit.zeroDayCurrentCount || 0} · Card Shifts: ${audit.cardShiftCount || 0}</td>
          <td class="num">${inr(items.reduce((a, b) => a + (b.prevPf || 0), 0))}</td>
          <td class="num">${inr(items.reduce((a, b) => a + (b.currPf || 0), 0))}</td>
          <td class="num">${inr(items.reduce((a, b) => a + (b.prevEsi || 0), 0))}</td>
          <td class="num">${inr(items.reduce((a, b) => a + (b.currEsi || 0), 0))}</td>
          <td></td>
        </tr>`;
      }
      return;
    }

    if (tab === 'BANK') {
      const exclHold = !!(state.exportOptions && state.exportOptions.excludeHoldFromBank);
      const bankRows = allRows.filter(r => (Number(r.netPayable) || 0) > 0 && (!exclHold || !r.paymentHold));
      const missingBankCount = bankRows.filter(r => !text(r.ifsc) || !text(r.accountNo)).length;
      const bt = computeTotals(bankRows);
      const hdrs = ['S.No.', 'Employee ID', 'Name of employee', 'Bank Name', 'IFSC Code', 'Account Number', 'Category', 'Net Payable', 'Transfer Mode', 'Bank Status'];
      if (colgroup) colgroup.innerHTML = hdrs.map((_, i) => `<col style="width:${i === 2 ? 190 : i === 0 ? 54 : i === 5 ? 160 : 128}px">`).join('');
      if (thead) thead.innerHTML = `<tr>${hdrs.map((h, i) => `<th style="${i === 7 ? 'text-align:right' : ''}">${esc(h)}</th>`).join('')}</tr>`;
      if (tbody) {
        tbody.innerHTML = bankRows.length ? bankRows.slice(0, 500).map((r, idx) => {
          const isSbi = /SBI|STATE BANK/i.test(text(r.bankName) + ' ' + text(r.ifsc));
          const hasBank = !!(text(r.ifsc) && text(r.accountNo));
          const mode = hasBank ? (isSbi ? 'SBI INTRA' : 'NEFT / IMPS') : 'MISSING BANK';
          return `<tr class="${hasBank ? '' : 'mcs-row-warn'}">
            <td style="text-align:center;color:#64748b" class="num">${idx + 1}</td>
            <td style="padding:0 8px">${esc(r.empId)}</td>
            <td style="padding:0 8px;font-weight:600">${esc(r.name)}</td>
            <td style="padding:0 8px">${esc(r.bankName || '—')}</td>
            <td style="padding:0 8px" class="num">${esc(r.ifsc || '—')}</td>
            <td style="padding:0 8px" class="num">${esc(r.accountNo || '—')}</td>
            <td style="padding:0 8px">${esc(r.category)}</td>
            <td class="mcs-formula-cell mcs-cell-net num">${inr(r.netPayable)}</td>
            <td style="padding:0 8px;font-weight:600;color:${hasBank ? '#047857' : '#dc2626'}">${esc(mode)}</td>
            <td style="padding:0 8px">${hasBank ? 'Ready' : 'Update Master IFSC/Acc'}</td>
          </tr>`;
        }).join('') : `<tr><td colspan="10" style="padding:18px;text-align:center;color:#64748b">No payable bank transfer rows found.</td></tr>`;
      }
      if (tfoot) {
        tfoot.innerHTML = `<tr>
          <td colspan="7" style="text-align:left">BANK NEFT SUMMARY · ${bankRows.length} Transfers · Missing Bank Details: ${missingBankCount}</td>
          <td class="num">${inr(bt.netPayable)}</td>
          <td colspan="2" style="text-align:left">Hold Excluded: ${exclHold ? 'Yes' : 'No'}</td>
        </tr>`;
      }
      return;
    }

    if (tab === 'DIFF') {
      const diffRows = allRows
        .filter(r => Math.abs((Number(r.manualAmount) || 0) - (Number(r.totalGross) || 0)) > 0 || (r.flags || []).length > 0)
        .sort((a, b) => Math.abs((b.manualAmount || 0) - (b.totalGross || 0)) - Math.abs((a.manualAmount || 0) - (a.totalGross || 0)));
      const dt = computeTotals(diffRows);
      const hdrs = ['S.No.', 'Employee ID', 'Name of employee', 'Category', 'Working / Paid', 'OT Hrs', 'Total Gross', 'Manual Amount', 'Diff. Amount', 'Variance %', 'Audit Flags'];
      if (colgroup) colgroup.innerHTML = hdrs.map((_, i) => `<col style="width:${i === 2 ? 190 : i === 0 ? 54 : i === 10 ? 220 : 114}px">`).join('');
      if (thead) thead.innerHTML = `<tr>${hdrs.map((h, i) => `<th style="${[5, 6, 7, 8, 9].includes(i) ? 'text-align:right' : ''}">${esc(h)}</th>`).join('')}</tr>`;
      if (tbody) {
        tbody.innerHTML = diffRows.length ? diffRows.slice(0, 500).map((r, idx) => {
          const pct = r.manualAmount > 0 ? (((r.totalGross - r.manualAmount) / r.manualAmount) * 100).toFixed(1) + '%' : '—';
          const warnCls = (r.totalGross || 0) > (r.manualAmount || 0) || (r.diffAmount || 0) > 500 ? 'mcs-row-warn' : '';
          return `<tr class="${warnCls}" data-jump-uid="${esc(r.uid)}" style="cursor:pointer" title="Click to inspect employee compliance">
            <td style="text-align:center;color:#64748b" class="num">${idx + 1}</td>
            <td style="padding:0 8px">${esc(r.empId)}</td>
            <td style="padding:0 8px;font-weight:600">${esc(r.name)}</td>
            <td style="padding:0 8px">${esc(r.category)}</td>
            <td style="padding:0 8px" class="num">${r.workingDays || 0}W + ${r.sunAllow || 0}S = ${r.paidDays || 0}</td>
            <td class="mcs-formula-cell num">${r.overtimeHours || 0}</td>
            <td class="mcs-formula-cell num">${inr(r.totalGross)}</td>
            <td class="mcs-formula-cell num">${inr(r.manualAmount)}</td>
            <td class="mcs-formula-cell mcs-cell-diff num">${inr(r.diffAmount)}</td>
            <td class="mcs-formula-cell num">${esc(pct)}</td>
            <td style="padding:0 8px">${esc((r.flags || []).join('; ') || 'Within Tolerance')}</td>
          </tr>`;
        }).join('') : `<tr><td colspan="11" style="padding:18px;text-align:center;color:#047857;font-weight:600">0 variance rows — Sabhi employees ki Total Gross aur Manual Amount match hai.</td></tr>`;
      }
      if (tfoot) {
        tfoot.innerHTML = `<tr>
          <td colspan="6" style="text-align:left">DIFF &amp; VARIANCE TOTAL (${diffRows.length} Rows)</td>
          <td class="num">${inr(dt.totalGross)}</td>
          <td class="num">${inr(dt.manualAmount)}</td>
          <td class="num">${inr(dt.diffAmount)}</td>
          <td colspan="2" style="text-align:left">Click any row to inspect</td>
        </tr>`;
      }
      return;
    }

    // MASTER tab
    const hdrs = ['S.No.', 'Employee ID', 'Name of employee', 'Fathers Name', 'D.O.B', 'D-O-J', 'Department', 'Designation', 'Category', 'Bank Name', 'IFSC Code', 'Account Number', 'Net Payable'];
    if (colgroup) colgroup.innerHTML = hdrs.map((_, i) => `<col style="width:${i === 2 ? 190 : i === 0 ? 54 : 132}px">`).join('');
    if (thead) thead.innerHTML = `<tr>${hdrs.map((h, i) => `<th style="${i === 12 ? 'text-align:right' : ''}">${esc(h)}</th>`).join('')}</tr>`;
    if (tbody) {
      tbody.innerHTML = allRows.slice(0, 500).map((r, idx) => `<tr>
        <td style="text-align:center;color:#64748b" class="num">${idx + 1}</td>
        <td style="padding:0 8px">${esc(r.empId)}</td>
        <td style="padding:0 8px;font-weight:600">${esc(r.name)}</td>
        <td style="padding:0 8px">${esc(r.father)}</td>
        <td style="padding:0 8px" class="num">${esc(r.dob)}</td>
        <td style="padding:0 8px" class="num">${esc(r.doj)}</td>
        <td style="padding:0 8px">${esc(r.department)}</td>
        <td style="padding:0 8px">${esc(r.designation)}</td>
        <td style="padding:0 8px">${esc(r.category)}</td>
        <td style="padding:0 8px">${esc(r.bankName)}</td>
        <td style="padding:0 8px" class="num">${esc(r.ifsc)}</td>
        <td style="padding:0 8px" class="num">${esc(r.accountNo)}</td>
        <td class="mcs-formula-cell num">${inr(r.netPayable)}</td>
      </tr>`).join('');
    }
    if (tfoot) {
      tfoot.innerHTML = `<tr><td colspan="12" style="text-align:left">MASTER TOTAL (${allRows.length} employees)</td><td class="num">${inr(t.netPayable)}</td></tr>`;
    }
  }

  function applyColumnPreset(presetName) {
    const key = VIEW_PRESETS[presetName] ? presetName : 'FULL';
    state.viewPreset = key;
    state.hiddenCols = Object.assign({}, VIEW_PRESETS[key]);
    try { localStorage.setItem(STORAGE_HIDDENCOLS_KEY, JSON.stringify(state.hiddenCols)); } catch (_) {}
    renderColumnPicker();
    render();
  }

  function renderColumnPicker() {
    const pop = $('mcsColPicker');
    if (!pop) return;
    const opts = GRID_COLS.filter(c => c.key !== '_select' && c.key !== 'serial' && c.key !== '_delete');
    pop.innerHTML = `
      <div class="mcs-colpop-head">
        <strong>Columns &amp; Presets</strong>
        <div style="display:flex;gap:4px;flex-wrap:wrap">
          <button type="button" class="mcs-mini-btn" id="mcsColShowAll">Full 39</button>
          <button type="button" class="mcs-mini-btn" id="mcsColAttendance">Attendance</button>
          <button type="button" class="mcs-mini-btn" id="mcsColStatutory">PF/ESI</button>
          <button type="button" class="mcs-mini-btn" id="mcsColCompact">Compact</button>
        </div>
      </div>
      <div class="mcs-colpop-grid">
        ${opts.map(c => `<label class="mcs-colpop-item">
          <input type="checkbox" data-col-toggle="${esc(c.key)}"${!state.hiddenCols[c.key] ? ' checked' : ''}>
          <span>${esc(c.col ? c.col + ' · ' : '')}${esc(c.label)}</span>
        </label>`).join('')}
      </div>
    `;
  }

  function syncExportModalUi() {
    const modal = $('mcsExportModal');
    if (!modal) return;
    const sh = activeSheet();
    const o = state.exportOptions || DEFAULT_EXPORT_OPTS;
    const targetRows = sh ? resolveRowsForExport(sh, o.scope) : [];
    const t = computeTotals(targetRows);
    const statCount = Object.values(o.sheets || {}).filter(Boolean).length;

    const sumEl = $('mcsExpSummaryStrip');
    if (sumEl) {
      sumEl.innerHTML = `
        <div class="mcs-exp-stat"><span>Rows</span><strong class="num">${targetRows.length}</strong></div>
        <div class="mcs-exp-stat"><span>Total Gross</span><strong class="num">₹${inr(t.totalGross)}</strong></div>
        <div class="mcs-exp-stat"><span>PF + ESIC</span><strong class="num">₹${inr(t.pfEmployee + t.esiEmployee)}</strong></div>
        <div class="mcs-exp-stat"><span>Net Payable</span><strong class="num" style="color:#065f46">₹${inr(t.netPayable)}</strong></div>
        <div class="mcs-exp-stat"><span>Sheets</span><strong class="num">${statCount || 1} tabs</strong></div>
      `;
    }
    if ($('mcsExpFileName') && document.activeElement !== $('mcsExpFileName')) {
      $('mcsExpFileName').value = o.customFilename || `ATPL_ESI_PF_Compliance_${(sh && sh.month) || todayMonth()}`;
    }
    if ($('mcsExpTemplate')) $('mcsExpTemplate').value = o.template || 'FULL';
    if ($('mcsExpScope')) $('mcsExpScope').value = o.scope || 'ALL';
    if ($('mcsExpFormulas')) $('mcsExpFormulas').checked = o.includeFormulas !== false;
    if ($('mcsExpBanner')) $('mcsExpBanner').checked = !!o.includeBanner;
    if ($('mcsExpEmployer')) $('mcsExpEmployer').checked = o.includeEmployerCols !== false;
    if ($('mcsExpExcludeHold')) $('mcsExpExcludeHold').checked = o.excludeHoldFromBank !== false;
    Object.entries(o.sheets || {}).forEach(([k, v]) => {
      const cb = document.querySelector(`#mcsExportModal input[data-exp-sheet="${k}"]`);
      if (cb) cb.checked = !!v;
    });
  }

  function openExportModal(force) {
    const sh = activeSheet();
    if (!sh || !sh.rows || !sh.rows.length) {
      setNotice('Download Form kholne ke liye pehle Mam sheet upload karein.', 'warn');
      return;
    }
    state.exportModalOpen = typeof force === 'boolean' ? force : !state.exportModalOpen;
    const modal = $('mcsExportModal');
    if (modal) modal.classList.toggle('open', state.exportModalOpen);
    if (state.exportModalOpen) syncExportModalUi();
  }

  function closeExportModal() {
    state.exportModalOpen = false;
    const modal = $('mcsExportModal');
    if (modal) modal.classList.remove('open');
  }

  function openInspector(uid) {
    state.inspectUid = uid || '';
    const dr = $('mcsInspectorDrawer');
    if (dr) dr.classList.toggle('open', !!state.inspectUid);
    if (state.inspectUid) renderInspectorBody();
  }

  function closeInspector() {
    state.inspectUid = '';
    const dr = $('mcsInspectorDrawer');
    if (dr) dr.classList.remove('open');
  }

  function renderInspectorBody() {
    const body = $('mcsInsBody');
    const sh = activeSheet();
    if (!body || !sh || !state.inspectUid) return;
    const list = filteredRows();
    const row = (sh.rows || []).find(r => r.uid === state.inspectUid);
    if (!row) { closeInspector(); return; }
    const s = settingsOf(sh.settings);
    const pos = list.findIndex(r => r.uid === row.uid);
    const prevUid = pos > 0 ? list[pos - 1].uid : '';
    const nextUid = pos >= 0 && pos < list.length - 1 ? list[pos + 1].uid : '';

    body.innerHTML = `
      <div class="mcs-ins-head">
        <div>
          <div class="mcs-ins-name">${esc(row.name || 'Unnamed Employee')}</div>
          <div class="mcs-ins-sub num">${esc(row.empId)} · ${esc(row.category)} · ${esc(row.designation || '—')}</div>
        </div>
        <div style="display:flex;gap:6px">
          <button type="button" class="mcs-mini-btn" id="mcsInsPrev" data-jump="${esc(prevUid)}"${prevUid ? '' : ' disabled'}>◀ Prev</button>
          <button type="button" class="mcs-mini-btn" id="mcsInsNext" data-jump="${esc(nextUid)}"${nextUid ? '' : ' disabled'}>Next ▶</button>
          <button type="button" class="mcs-mini-btn" id="mcsInsClose">Close</button>
        </div>
      </div>

      <div class="mcs-ins-section">
        <div class="mcs-ins-sec-title">1. Attendance Breakdown (Paid = Working + Sun Allow + HD)</div>
        <div class="mcs-ins-grid">
          <label class="mcs-ins-field"><span>Working Days</span><input type="number" step="0.5" data-ins-field="workingDays" value="${esc(row.workingDays ?? 0)}"></label>
          <label class="mcs-ins-field"><span>Sun Allow</span><input type="number" step="0.5" data-ins-field="sunAllow" value="${esc(row.sunAllow ?? 0)}"></label>
          <label class="mcs-ins-field"><span>HD</span><input type="number" step="0.5" data-ins-field="hd" value="${esc(row.hd ?? 0)}"></label>
          <label class="mcs-ins-field"><span>OT Hours</span><input type="number" step="0.5" data-ins-field="overtimeHours" value="${esc(row.overtimeHours ?? 0)}"></label>
        </div>
        <div class="mcs-ins-formula num">Paid Days: ${row.paidDays || 0} / ${row.monthDays || s.monthDays} · Absent: ${row.absent || 0}</div>
      </div>

      <div class="mcs-ins-section">
        <div class="mcs-ins-sec-title">2. Salary Components &amp; Live Formula Proof</div>
        <div class="mcs-ins-kv"><span>Basic + HRA</span><strong class="num">₹${inr(row.basic)} + ₹${inr(row.hra)} = ₹${inr(row.gross)}</strong></div>
        <div class="mcs-ins-kv"><span>Earn Basic (${row.paidDays}/${row.monthDays})</span><strong class="num">₹${inr(row.earnBasic)}</strong></div>
        <div class="mcs-ins-kv"><span>Earn HRA (${row.paidDays}/${row.monthDays})</span><strong class="num">₹${inr(row.earnHra)}</strong></div>
        <div class="mcs-ins-kv"><span>Gross Earned Salary</span><strong class="num">₹${inr(row.grossEarned)}</strong></div>
        <div class="mcs-ins-kv"><span>Earned Bonus (${s.bonusRate}%)</span><strong class="num">₹${inr(row.earnedBonus)}</strong></div>
        <div class="mcs-ins-kv"><span>OT Amount (Gross/${s.otDivisor} × ${row.overtimeHours || 0})</span><strong class="num">₹${inr(row.otAmount)}</strong></div>
        <div class="mcs-ins-kv mcs-ins-total"><span>Total Gross Salary</span><strong class="num">₹${inr(row.totalGross)}</strong></div>
        <div class="mcs-ins-kv"><span>Manual Amount (Mam)</span><strong class="num">₹${inr(row.manualAmount)} (Diff ₹${inr(row.diffAmount)})</strong></div>
      </div>

      <div class="mcs-ins-section">
        <div class="mcs-ins-sec-title">3. PF / ESIC Statutory &amp; Deductions</div>
        <div class="mcs-ins-grid">
          <label class="mcs-ins-field"><span>PF Rule</span>
            <select data-ins-field="pfMode">
              ${['AUTO', 'FULL_12', 'CAP_15000', 'GROSS_12', 'NONE'].map(m => `<option value="${m}"${(row.pfMode || 'AUTO') === m ? ' selected' : ''}>${m}</option>`).join('')}
            </select>
          </label>
          <label class="mcs-ins-field"><span>ESIC Rule</span>
            <select data-ins-field="esiMode">
              ${['AUTO', 'EARN_BASIC', 'TOTAL_GROSS', 'NONE'].map(m => `<option value="${m}"${(row.esiMode || 'AUTO') === m ? ' selected' : ''}>${m}</option>`).join('')}
            </select>
          </label>
          <label class="mcs-ins-field"><span>Advance Ded.</span><input type="number" step="1" data-ins-field="advance" value="${esc(row.advance || 0)}"></label>
          <label class="mcs-ins-field"><span>Remarks</span>
            <select data-ins-field="remarks">
              <option value="onroll"${norm(row.remarks) !== 'off roll' ? ' selected' : ''}>onroll</option>
              <option value="off roll"${norm(row.remarks) === 'off roll' ? ' selected' : ''}>off roll</option>
            </select>
          </label>
        </div>
        <div class="mcs-ins-kv"><span>PF NO / ESI NO</span><strong class="num">${esc(row.pfNo || 'NA')} / ${esc(row.esiNo || 'NA')}</strong></div>
        <div class="mcs-ins-kv"><span>Employee PF@12% / Employer PF@13%</span><strong class="num">₹${inr(row.pfEmployee)} / ₹${inr(row.pfEmployer)}</strong></div>
        <div class="mcs-ins-kv"><span>Employee ESIC@0.75% / Employer@3.25%</span><strong class="num">₹${inr(row.esiEmployee)} / ₹${inr(row.esiEmployer)}</strong></div>
        <div class="mcs-ins-kv mcs-ins-net"><span>Net Payable</span><strong class="num">₹${inr(row.netPayable)}</strong></div>
      </div>

      <div class="mcs-ins-section">
        <div class="mcs-ins-sec-title">4. Bank &amp; Master Info</div>
        <div class="mcs-ins-kv"><span>Bank / IFSC</span><strong class="num">${esc(row.bankName || '—')} · ${esc(row.ifsc || '—')}</strong></div>
        <div class="mcs-ins-kv"><span>Account No</span><strong class="num">${esc(row.accountNo || '—')}</strong></div>
        <div class="mcs-ins-kv"><span>DOB / DOJ</span><strong class="num">${esc(row.dob || '—')} / ${esc(row.doj || '—')}</strong></div>
      </div>
    `;
  }

  function render() {
    const rootEl = $('page-mamsalary');
    if (!rootEl) return;

    const sh = activeSheet();
    const s = settingsOf(sh && sh.settings);
    const savedKeys = Object.keys(state.sheets).sort().reverse();
    const allRows = sh && Array.isArray(sh.rows) ? sh.rows : [];
    const list = filteredRows();
    const categories = [...new Set(allRows.map(r => text(r.category)).filter(Boolean))].sort();

    // Update top month switcher
    const sw = $('mcsMonthSwitch');
    if (sw) {
      sw.innerHTML = savedKeys.length
        ? savedKeys.map(k => `<option value="${esc(k)}"${k === state.activeId ? ' selected' : ''}>${esc(monthLabel(k))} (${(state.sheets[k].rows || []).length} emp)</option>`).join('')
        : '<option value="">No saved month yet</option>';
    }

    // Update category filter
    const cf = $('mcsCatFilter');
    if (cf) {
      cf.innerHTML = `<option value="ALL">All Categories (${categories.length})</option>` +
        categories.map(c => `<option value="${esc(c)}"${c === state.categoryFilter ? ' selected' : ''}>${esc(c)}</option>`).join('');
    }

    if ($('mcsSetMonth')) $('mcsSetMonth').value = s.month;
    if ($('mcsSetMonthDays')) $('mcsSetMonthDays').value = s.monthDays;
    if ($('mcsSetMaxOt')) $('mcsSetMaxOt').value = s.maxOtHours;
    if ($('mcsSetBonusMode')) $('mcsSetBonusMode').value = s.bonusMode;
    if ($('mcsSetBonusRate')) $('mcsSetBonusRate').value = s.bonusRate;
    if ($('mcsSetOtDivisor')) $('mcsSetOtDivisor').value = s.otDivisor;
    if ($('mcsSetPfMode')) $('mcsSetPfMode').value = s.pfDefaultMode;
    if ($('mcsSetEsiBase')) $('mcsSetEsiBase').value = s.esiBase;
    if ($('mcsPageSize')) $('mcsPageSize').value = String(state.pageSize);
    if ($('mcsViewPreset')) $('mcsViewPreset').value = state.viewPreset || 'FULL';
    if ($('mcsFreezeBtn')) $('mcsFreezeBtn').classList.toggle('mcs-btn-active', !!state.freezePanes);

    document.querySelectorAll('.mcs-seg-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.status === state.statusFilter);
    });
    document.querySelectorAll('.mcs-sheet-tab').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === state.activeTab);
    });

    const dlBtn = $('mcsDownloadBtn');
    const dlFormBtn = $('mcsDownloadFormBtn');
    const csvBtn = $('mcsDownloadCsvBtn');
    const delBtn = $('mcsDeleteSheetBtn');
    if (dlBtn) dlBtn.disabled = !allRows.length;
    if (dlFormBtn) dlFormBtn.disabled = !allRows.length;
    if (csvBtn) csvBtn.disabled = !allRows.length;
    if (delBtn) delBtn.disabled = !sh;
    updateUndoRedoButtons();

    const metaLine = $('mcsSheetMeta');
    if (metaLine) {
      metaLine.textContent = sh
        ? `${sh.mamFile || 'Mam Sheet'} · ${allRows.length} employees · Updated ${new Date(sh.updatedAt || Date.now()).toLocaleString('en-IN')}`
        : `Employee Master loaded (${getEmployeeMasterList().length} records) · Verified Lokesh ESI/PF Formulas Ready`;
    }

    const emptyBox = $('mcsEmptyState');
    const gridWrap = $('mcsGridContainer');
    if (!sh || !allRows.length) {
      if (emptyBox) emptyBox.style.display = 'flex';
      if (gridWrap) gridWrap.style.display = 'none';
      if (state.inspectUid) closeInspector();
      updateSummaryAndTotalsBar();
      return;
    }

    if (emptyBox) emptyBox.style.display = 'none';
    if (gridWrap) gridWrap.style.display = 'flex';

    if (state.activeTab !== 'MAIN') {
      renderSummaryTab(state.activeTab, allRows);
      if ($('mcsPageInfo')) $('mcsPageInfo').textContent = `Tab: ${state.activeTab.replace('_', ' & ')}`;
      if ($('mcsPrevPage')) $('mcsPrevPage').disabled = true;
      if ($('mcsNextPage')) $('mcsNextPage').disabled = true;
      updateSummaryAndTotalsBar();
      if (state.notice) setNotice(state.notice, state.noticeType);
      return;
    }

    const cols = visibleGridCols();
    renderMainTableChrome(cols, list);

    const effSize = state.pageSize >= 9999 ? Math.max(1, list.length) : state.pageSize;
    const totalPages = Math.max(1, Math.ceil(list.length / effSize));
    const currentPage = Math.min(state.pageOffset, totalPages - 1);
    state.pageOffset = Math.max(0, currentPage);
    const start = state.pageOffset * effSize;
    const pageRows = list.slice(start, start + effSize);

    const tbody = $('mcsTableBody');
    if (tbody) {
      tbody.innerHTML = pageRows.map((r, j) => {
        const absIdx = start + j;
        const isOff = norm(r.remarks) === 'off roll' || r.paidDays <= 0;
        const isMissing = !r.masterMatched;
        const isHold = !!r.paymentHold;
        const rowCls = [
          isMissing ? 'mcs-row-warn' : (isOff ? 'mcs-row-off' : ''),
          isHold ? 'mcs-row-hold' : '',
          state.selectedUids.has(r.uid) ? 'mcs-row-sel' : ''
        ].filter(Boolean).join(' ');
        return `<tr data-uid="${esc(r.uid)}" data-rowidx="${absIdx}" data-remarks="${esc(norm(r.remarks))}" class="${rowCls}">${cols.map(c => renderCell(r, c, absIdx)).join('')}</tr>`;
      }).join('');
    }

    const pageInfo = $('mcsPageInfo');
    if (pageInfo) {
      pageInfo.textContent = list.length
        ? `Showing ${start + 1}–${Math.min(start + effSize, list.length)} of ${list.length} rows`
        : '0 matching rows';
    }
    if ($('mcsPrevPage')) $('mcsPrevPage').disabled = state.pageOffset <= 0;
    if ($('mcsNextPage')) $('mcsNextPage').disabled = state.pageOffset >= totalPages - 1;

    updateSummaryAndTotalsBar();
    if (state.notice) setNotice(state.notice, state.noticeType);
  }

  function injectStyles() {
    if ($('mcsStyles')) return;
    const style = document.createElement('style');
    style.id = 'mcsStyles';
    style.textContent = `
      #page-mamsalary {
        padding: 0;
        background: #f8fafc;
        color: #0f172a;
        font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
      }
      #page-mamsalary.active {
        position: fixed !important;
        inset: 0 !important;
        z-index: 99999 !important;
        display: block !important;
        overflow: hidden !important;
      }
      .mcs-shell {
        height: 100vh;
        display: flex;
        flex-direction: column;
        background: #f8fafc;
      }
      .mcs-shell.mcs-focus .mcs-kpi-strip,
      .mcs-shell.mcs-focus .mcs-notice {
        display: none !important;
      }
      .mcs-shell.mcs-focus .mcs-topbar {
        padding: 7px 16px;
      }
      .mcs-shell.mcs-focus .mcs-toolbar {
        padding: 6px 16px;
        gap: 6px;
      }
      .mcs-shell.mcs-focus .mcs-formulabar {
        padding: 4px 16px;
      }
      .num {
        font-family: 'JetBrains Mono', monospace;
        font-variant-numeric: tabular-nums;
      }
      .mcs-topbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 10px 20px;
        background: #ffffff;
        border-bottom: 1px solid #cbd5e1;
        box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
      }
      .mcs-brand-zone {
        display: flex;
        flex-direction: column;
        min-width: 0;
      }
      .mcs-title-row {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .mcs-title {
        font-size: 16.5px;
        font-weight: 800;
        color: #0f172a;
        letter-spacing: -0.02em;
        white-space: nowrap;
      }
      .mcs-meta {
        font-size: 11.5px;
        color: #64748b;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        margin-top: 2px;
      }
      .mcs-actions-zone {
        display: flex;
        align-items: center;
        gap: 7px;
        flex-wrap: wrap;
        justify-content: flex-end;
      }
      #page-mamsalary .mcs-select, #page-mamsalary .mcs-input {
        height: 33px !important;
        padding: 0 10px !important;
        border: 1px solid #cbd5e1 !important;
        border-radius: 7px !important;
        background: #ffffff !important;
        color: #0f172a !important;
        font-size: 12px !important;
        font-family: inherit !important;
        line-height: 31px !important;
        outline: none !important;
        box-shadow: none !important;
      }
      #page-mamsalary .mcs-select:focus, #page-mamsalary .mcs-input:focus {
        border-color: #1d4ed8 !important;
        box-shadow: 0 0 0 2px rgba(29, 78, 216, 0.14) !important;
      }
      #page-mamsalary .mcs-btn {
        height: 33px;
        padding: 0 11px;
        border-radius: 7px;
        border: 1px solid #cbd5e1;
        background: #ffffff;
        color: #0f172a;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 5px;
        white-space: nowrap;
        transition: background-color 140ms ease, border-color 140ms ease, box-shadow 140ms ease;
      }
      #page-mamsalary .mcs-btn:hover:not(:disabled) {
        background: #f1f5f9;
        border-color: #94a3b8;
      }
      #page-mamsalary .mcs-btn:disabled {
        opacity: 0.45;
        cursor: not-allowed;
      }
      #page-mamsalary .mcs-btn-active {
        background: #eff6ff !important;
        border-color: #2563eb !important;
        color: #1d4ed8 !important;
      }
      #page-mamsalary .mcs-btn-primary {
        background: #0f172a;
        color: #ffffff;
        border-color: #0f172a;
      }
      #page-mamsalary .mcs-btn-primary:hover:not(:disabled) {
        background: #1e293b;
        border-color: #1e293b;
      }
      #page-mamsalary .mcs-btn-accent {
        background: #15803d;
        color: #ffffff;
        border-color: #15803d;
        box-shadow: 0 1px 2px rgba(21, 128, 61, 0.25);
      }
      #page-mamsalary .mcs-btn-accent:hover:not(:disabled) {
        background: #166534;
        border-color: #166534;
      }
      #page-mamsalary .mcs-mini-btn {
        height: 26px;
        padding: 0 9px;
        border-radius: 5px;
        border: 1px solid #cbd5e1;
        background: #ffffff;
        color: #0f172a;
        font-size: 11px;
        font-weight: 600;
        cursor: pointer;
      }
      #page-mamsalary .mcs-mini-btn:hover { background: #f1f5f9; }
      .mcs-file-label {
        position: relative;
        overflow: hidden;
      }
      .mcs-file-label input[type=file] {
        position: absolute;
        inset: 0;
        opacity: 0;
        cursor: pointer;
      }
      .mcs-kpi-strip {
        display: grid;
        grid-template-columns: repeat(6, minmax(0, 1fr));
        background: #ffffff;
        border-bottom: 1px solid #cbd5e1;
      }
      .mcs-kpi {
        padding: 9px 14px;
        border-right: 1px solid #e2e8f0;
        border-top: 3px solid #cbd5e1;
      }
      .mcs-kpi:nth-child(1) { border-top-color: #334155; }
      .mcs-kpi:nth-child(2) { border-top-color: #2563eb; }
      .mcs-kpi:nth-child(3) { border-top-color: #0284c7; }
      .mcs-kpi:nth-child(4) { border-top-color: #d97706; }
      .mcs-kpi:nth-child(5) { border-top-color: #ea580c; }
      .mcs-kpi:nth-child(6) { border-top-color: #059669; background: #f0fdf4; border-right: none; }
      .mcs-kpi:nth-child(6) .mcs-kpi-val { color: #065f46; }
      .mcs-kpi-label {
        font-size: 10.5px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: #64748b;
      }
      .mcs-kpi-val {
        font-size: 17px;
        font-weight: 800;
        color: #0f172a;
        margin-top: 2px;
      }
      .mcs-kpi-sub {
        font-size: 11px;
        color: #64748b;
        margin-top: 1px;
      }
      .mcs-toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 8px;
        padding: 7px 20px;
        background: #f8fafc;
        border-bottom: 1px solid #cbd5e1;
      }
      .mcs-toolbar-left, .mcs-toolbar-right {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-wrap: wrap;
      }
      .mcs-seg {
        display: inline-flex;
        padding: 2px;
        background: #e2e8f0;
        border-radius: 7px;
        gap: 2px;
      }
      .mcs-seg-btn {
        border: none;
        background: transparent;
        color: #475569;
        font-size: 11.5px;
        font-weight: 600;
        padding: 5px 9px;
        border-radius: 5px;
        cursor: pointer;
        white-space: nowrap;
      }
      .mcs-seg-btn.active {
        background: #ffffff;
        color: #0f172a;
        box-shadow: 0 1px 2px rgba(15, 23, 42, 0.08);
      }
      .mcs-bulkbar {
        display: none;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 8px;
        padding: 6px 20px;
        background: #eff6ff;
        border-bottom: 1px solid #bfdbfe;
        font-size: 12px;
      }
      .mcs-bulk-group {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-wrap: wrap;
      }
      .mcs-bulk-info {
        font-weight: 700;
        color: #1e40af;
      }
      .mcs-frbar {
        display: none;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
        padding: 7px 20px;
        background: #fefce8;
        border-bottom: 1px solid #fde047;
        font-size: 12px;
      }
      .mcs-frbar.open { display: flex; }
      .mcs-colpop-wrap { position: relative; }
      .mcs-colpop {
        display: none;
        position: absolute;
        top: 38px;
        right: 0;
        z-index: 50;
        width: 340px;
        background: #ffffff;
        border: 1px solid #cbd5e1;
        border-radius: 10px;
        box-shadow: 0 12px 30px rgba(15, 23, 42, 0.16);
        padding: 12px;
      }
      .mcs-colpop.open { display: block; }
      .mcs-colpop-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 8px;
        font-size: 12px;
      }
      .mcs-colpop-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 6px;
        max-height: 260px;
        overflow: auto;
      }
      .mcs-colpop-item {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 11.5px;
        color: #334155;
        cursor: pointer;
      }
      .mcs-formulabar {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 5px 20px;
        background: #ffffff;
        border-bottom: 1px solid #e2e8f0;
        font-size: 12px;
      }
      .mcs-fx {
        font-family: 'JetBrains Mono', monospace;
        font-weight: 700;
        color: #15803d;
        padding: 2px 7px;
        background: #f1f5f9;
        border: 1px solid #cbd5e1;
        border-radius: 4px;
      }
      .mcs-fcoord {
        font-weight: 600;
        color: #334155;
        min-width: 220px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .mcs-fexpr, #page-mamsalary .mcs-finput {
        flex: 1;
        font-family: 'JetBrains Mono', monospace !important;
        color: #0f172a !important;
        background: #f8fafc !important;
        border: 1px solid #cbd5e1 !important;
        border-radius: 4px !important;
        padding: 3px 8px !important;
        font-size: 12px !important;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        box-shadow: none !important;
      }
      #page-mamsalary .mcs-finput {
        background: #ffffff !important;
        border-color: #2563eb !important;
        outline: none !important;
      }
      .mcs-notice {
        padding: 6px 20px;
        font-size: 12px;
        font-weight: 600;
        background: #f1f5f9;
        color: #1e293b;
        border-bottom: 1px solid #cbd5e1;
      }
      .mcs-notice[data-type="ok"] { background: #ecfdf5; color: #14532d; border-bottom-color: #a7f3d0; }
      .mcs-notice[data-type="warn"] { background: #fffbeb; color: #78350f; border-bottom-color: #fde68a; }
      .mcs-notice[data-type="err"] { background: #fef2f2; color: #7f1d1d; border-bottom-color: #fecaca; }
      .mcs-drawer {
        display: none;
        padding: 12px 20px;
        background: #ffffff;
        border-bottom: 1px solid #cbd5e1;
      }
      .mcs-drawer.open { display: block; }
      .mcs-drawer-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
        gap: 10px;
        align-items: end;
      }
      .mcs-field label {
        display: block;
        font-size: 11px;
        font-weight: 600;
        color: #475569;
        margin-bottom: 4px;
      }
      #page-mamsalary .mcs-field input, #page-mamsalary .mcs-field select {
        width: 100%;
        height: 34px !important;
        padding: 0 8px !important;
        border: 1px solid #cbd5e1 !important;
        border-radius: 6px !important;
        font-size: 12px !important;
        background: #ffffff !important;
        color: #0f172a !important;
      }
      .mcs-grid-container {
        flex: 1;
        min-height: 0;
        display: flex;
        flex-direction: column;
        background: #ffffff;
      }
      .mcs-grid-scroll {
        flex: 1;
        overflow: auto;
        position: relative;
        background: #ffffff;
      }
      .mcs-table {
        border-collapse: separate;
        border-spacing: 0;
        width: max-content;
        min-width: 100%;
        table-layout: fixed;
        font-size: 12.5px;
      }
      #page-mamsalary .mcs-table thead tr.mcs-xl-letters th {
        position: sticky;
        top: 0;
        z-index: 14;
        height: 22px;
        padding: 2px 6px !important;
        background: #e2e8f0 !important;
        color: #475569 !important;
        font-size: 10.5px !important;
        font-weight: 700 !important;
        text-align: center;
        border-bottom: 1px solid #cbd5e1 !important;
        border-right: 1px solid #cbd5e1 !important;
      }
      #page-mamsalary .mcs-table thead tr.mcs-xl-letters th.mcs-sticky {
        z-index: 22;
        background: #cbd5e1 !important;
      }
      #page-mamsalary .mcs-table thead tr:not(.mcs-xl-letters) th {
        position: sticky;
        top: 22px;
        z-index: 12;
        background: #1e3a8a !important;
        color: #ffffff !important;
        font-weight: 700 !important;
        font-size: 11.5px !important;
        padding: 7px 8px !important;
        text-align: left;
        border-bottom: 2px solid #0f172a !important;
        border-right: 1px solid #1e40af !important;
        white-space: nowrap;
        user-select: none;
      }
      #page-mamsalary .mcs-table thead tr:only-child th {
        top: 0;
      }
      #page-mamsalary .mcs-table thead tr:not(.mcs-xl-letters) th.mcs-sticky {
        z-index: 20;
        background: #172554 !important;
      }
      #page-mamsalary .mcs-th-sort:hover { background: #1d4ed8 !important; }
      .mcs-sort-ind { color: #93c5fd; font-size: 10px; }
      #page-mamsalary .mcs-table tbody td {
        height: 34px;
        padding: 0 !important;
        border-bottom: 1px solid #cbd5e1 !important;
        border-right: 1px solid #cbd5e1 !important;
        background: #ffffff;
        vertical-align: middle;
        white-space: nowrap;
        overflow: hidden;
        font-size: 12.5px !important;
      }
      #page-mamsalary .mcs-table tbody tr:nth-child(even) td { background: #f8fafc; }
      #page-mamsalary .mcs-table tbody td.mcs-cell-net { background: #ecfdf5 !important; color: #065f46; font-weight: 700; }
      #page-mamsalary .mcs-table tbody td.mcs-cell-ded { background: #fff7ed !important; color: #9a3412; }
      #page-mamsalary .mcs-table tbody td.mcs-cell-diff { background: #eff6ff; color: #1e40af; }
      #page-mamsalary .mcs-table tbody td.mcs-cell-er { background: #f8fafc; color: #475569; }
      #page-mamsalary .mcs-table tbody tr:hover td { background: #eff6ff !important; }
      #page-mamsalary .mcs-table tbody tr.mcs-row-off td { background: #fffbeb !important; }
      #page-mamsalary .mcs-table tbody tr.mcs-row-warn td { background: #fef2f2 !important; }
      #page-mamsalary .mcs-table tbody tr.mcs-row-hold td { background: #fefce8 !important; opacity: 0.92; }
      #page-mamsalary .mcs-table tbody tr.mcs-row-sel td { background: #dbeafe !important; }
      #page-mamsalary .mcs-table td.mcs-sticky {
        position: sticky;
        z-index: 8;
        background: #ffffff;
        box-shadow: inset -1px 0 0 #94a3b8;
      }
      #page-mamsalary .mcs-table tbody tr:nth-child(even) td.mcs-sticky { background: #f8fafc; }
      #page-mamsalary .mcs-table tbody tr:hover td.mcs-sticky { background: #e0e7ff !important; }
      #page-mamsalary .mcs-table tbody tr.mcs-row-sel td.mcs-sticky { background: #bfdbfe !important; }
      #page-mamsalary .mcs-table td.mcs-formula-cell {
        padding: 0 8px !important;
        text-align: right;
        color: #0f172a;
        font-weight: 500;
      }
      #page-mamsalary .mcs-table td.mcs-formula-cell.mcs-cell-net {
        color: #065f46;
        font-weight: 800;
      }
      #page-mamsalary .mcs-table td.mcs-formula-cell:focus {
        outline: 2px solid #1d4ed8 !important;
        outline-offset: -2px;
        background: #eff6ff !important;
      }
      #page-mamsalary .mcs-row-check {
        width: 15px !important;
        height: 15px !important;
        padding: 0 !important;
        margin: 0 !important;
        cursor: pointer;
        accent-color: #1d4ed8;
      }
      /* Neutralize external erp-enterprise-ui-v1.js global input/select box styles inside grid cells */
      #page-mamsalary .mcs-table td input.mcs-cell-input,
      #page-mamsalary .mcs-table td select.mcs-cell-select {
        width: 100% !important;
        height: 33px !important;
        border: none !important;
        border-radius: 0 !important;
        background: transparent !important;
        padding: 0 8px !important;
        margin: 0 !important;
        font-size: 12.5px !important;
        font-family: inherit;
        color: #0f172a !important;
        outline: none !important;
        box-shadow: none !important;
        line-height: 33px !important;
      }
      #page-mamsalary .mcs-table td input.mcs-cell-input.num {
        text-align: right !important;
        font-family: 'JetBrains Mono', monospace !important;
        font-weight: 500 !important;
      }
      #page-mamsalary .mcs-table td input.mcs-cell-input:focus,
      #page-mamsalary .mcs-table td select.mcs-cell-select:focus {
        background: #eff6ff !important;
        border: none !important;
        box-shadow: inset 0 0 0 2px #1d4ed8 !important;
        outline: none !important;
      }
      .mcs-row-ins, .mcs-row-del {
        border: none;
        background: transparent;
        color: #64748b;
        cursor: pointer;
        font-size: 13px;
        padding: 4px 5px;
      }
      .mcs-row-ins:hover { color: #1d4ed8; }
      .mcs-row-del:hover { color: #dc2626; }
      #page-mamsalary .mcs-table tfoot td {
        position: sticky;
        bottom: 0;
        z-index: 15;
        background: #0f172a !important;
        color: #ffffff !important;
        font-weight: 700 !important;
        font-size: 12px !important;
        padding: 8px 8px !important;
        border-top: 2px solid #1e40af !important;
        border-right: 1px solid #334155 !important;
        border-bottom: 1px solid #0f172a !important;
        text-align: right;
      }
      #page-mamsalary .mcs-table tfoot td.mcs-sticky {
        z-index: 22;
        background: #0f172a !important;
        text-align: left;
      }
      .mcs-sheet-tabs {
        display: flex;
        align-items: center;
        gap: 3px;
        padding: 5px 16px 0;
        background: #e2e8f0;
        border-top: 1px solid #cbd5e1;
      }
      .mcs-sheet-tab {
        border: 1px solid transparent;
        border-bottom: none;
        background: transparent;
        color: #475569;
        font-size: 11.5px;
        font-weight: 600;
        padding: 6px 14px;
        border-radius: 6px 6px 0 0;
        cursor: pointer;
      }
      .mcs-sheet-tab:hover { background: #f1f5f9; color: #0f172a; }
      .mcs-sheet-tab.active {
        background: #ffffff;
        color: #047857;
        border-color: #cbd5e1;
        box-shadow: inset 0 2px 0 #15803d;
        font-weight: 700;
      }
      .mcs-empty {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 36px 20px;
        background: radial-gradient(circle at top center, #eff6ff 0%, #f8fafc 60%);
      }
      .mcs-empty-card {
        max-width: 720px;
        width: 100%;
        background: #ffffff;
        border: 2px dashed #94a3b8;
        border-radius: 14px;
        padding: 34px 36px;
        text-align: center;
        box-shadow: 0 10px 28px rgba(15, 23, 42, 0.06);
        transition: border-color 150ms ease, background-color 150ms ease;
      }
      .mcs-empty-card.mcs-dragover {
        border-color: #2563eb;
        background: #eff6ff;
      }
      .mcs-empty-icon {
        width: 52px;
        height: 52px;
        margin: 0 auto 14px;
        border-radius: 12px;
        background: #ecfdf5;
        border: 1px solid #a7f3d0;
        color: #047857;
        font-size: 24px;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .mcs-empty-card h3 {
        font-size: 20px;
        font-weight: 800;
        color: #0f172a;
        margin: 0 0 8px;
      }
      .mcs-empty-card p {
        font-size: 13.5px;
        color: #475569;
        line-height: 1.6;
        margin: 0 0 18px;
      }
      .mcs-empty-steps {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 10px;
        margin-bottom: 22px;
        text-align: left;
      }
      .mcs-empty-step {
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 9px;
        padding: 10px 12px;
        font-size: 11.5px;
        color: #334155;
      }
      .mcs-empty-step strong {
        display: block;
        color: #0f172a;
        margin-bottom: 2px;
        font-size: 12px;
      }
      .mcs-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 8px;
        padding: 6px 20px;
        background: #ffffff;
        border-top: 1px solid #cbd5e1;
        font-size: 11.5px;
        color: #475569;
      }
      #page-mamsalary #mcsPageSize, #page-mamsalary #mcsViewPreset {
        height: 28px !important;
        line-height: 26px !important;
        padding: 0 8px !important;
        font-size: 11.5px !important;
        min-width: 64px !important;
      }
      .mcs-modal {
        display: none;
        position: fixed;
        inset: 0;
        z-index: 120;
        background: rgba(15, 23, 42, 0.45);
        align-items: center;
        justify-content: center;
        padding: 20px;
      }
      .mcs-modal.open { display: flex; }
      .mcs-modal-card {
        width: 100%;
        max-width: 680px;
        max-height: 90vh;
        overflow: auto;
        background: #ffffff;
        border: 1px solid #cbd5e1;
        border-radius: 12px;
        box-shadow: 0 24px 50px rgba(15, 23, 42, 0.22);
        display: flex;
        flex-direction: column;
      }
      .mcs-modal-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 14px 20px;
        border-bottom: 1px solid #e2e8f0;
        background: #f8fafc;
      }
      .mcs-modal-head h3 {
        margin: 0;
        font-size: 15.5px;
        font-weight: 800;
        color: #0f172a;
      }
      .mcs-exp-strip {
        display: grid;
        grid-template-columns: repeat(5, minmax(0, 1fr));
        border-bottom: 1px solid #e2e8f0;
        background: #ffffff;
      }
      .mcs-exp-stat {
        padding: 10px 14px;
        border-right: 1px solid #e2e8f0;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .mcs-exp-stat:last-child { border-right: none; }
      .mcs-exp-stat span {
        font-size: 10.5px;
        font-weight: 700;
        text-transform: uppercase;
        color: #64748b;
      }
      .mcs-exp-stat strong { font-size: 14px; color: #0f172a; }
      .mcs-modal-body {
        padding: 16px 20px;
        display: flex;
        flex-direction: column;
        gap: 14px;
      }
      .mcs-exp-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 10px;
      }
      .mcs-exp-toggles {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
        padding: 10px 12px;
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
      }
      .mcs-exp-sheets {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 7px;
      }
      .mcs-exp-check {
        display: flex;
        align-items: center;
        gap: 7px;
        font-size: 12px;
        color: #1e293b;
        cursor: pointer;
      }
      .mcs-modal-foot {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 8px;
        padding: 12px 20px;
        border-top: 1px solid #e2e8f0;
        background: #f8fafc;
      }
      .mcs-inspector {
        display: none;
        position: fixed;
        top: 0;
        right: 0;
        bottom: 0;
        width: 440px;
        max-width: 96vw;
        z-index: 110;
        background: #ffffff;
        border-left: 1px solid #cbd5e1;
        box-shadow: -12px 0 32px rgba(15, 23, 42, 0.14);
        overflow: auto;
        padding: 18px 20px;
      }
      .mcs-inspector.open { display: block; }
      .mcs-ins-head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 10px;
        padding-bottom: 12px;
        border-bottom: 1px solid #e2e8f0;
      }
      .mcs-ins-name { font-size: 16px; font-weight: 800; color: #0f172a; }
      .mcs-ins-sub { font-size: 11.5px; color: #64748b; margin-top: 2px; }
      .mcs-ins-section {
        margin-top: 14px;
        padding: 12px;
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
      }
      .mcs-ins-sec-title {
        font-size: 11px;
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: #334155;
        margin-bottom: 8px;
      }
      .mcs-ins-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
      }
      .mcs-ins-field span {
        display: block;
        font-size: 11px;
        font-weight: 600;
        color: #475569;
        margin-bottom: 3px;
      }
      #page-mamsalary .mcs-ins-field input,
      #page-mamsalary .mcs-ins-field select {
        width: 100%;
        height: 30px !important;
        padding: 0 8px !important;
        border: 1px solid #cbd5e1 !important;
        border-radius: 6px !important;
        background: #ffffff !important;
        color: #0f172a !important;
        font-size: 12px !important;
      }
      .mcs-ins-formula {
        margin-top: 8px;
        font-size: 11.5px;
        color: #1e40af;
        font-weight: 600;
      }
      .mcs-ins-kv {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 4px 0;
        font-size: 12px;
        color: #334155;
        border-bottom: 1px solid #e2e8f0;
      }
      .mcs-ins-kv:last-child { border-bottom: none; }
      .mcs-ins-total { font-weight: 700; color: #0f172a; }
      .mcs-ins-net { font-weight: 800; color: #065f46; font-size: 13px; }
    `;
    document.head.appendChild(style);
  }

  function buildPageShell() {
    const old = $('page-mamsalary');
    if (old) old.remove();

    const page = document.createElement('div');
    page.id = 'page-mamsalary';
    page.className = 'page';
    page.innerHTML = `
      <div id="mcsShell" class="mcs-shell">
        <header class="mcs-topbar">
          <div class="mcs-brand-zone">
            <div class="mcs-title-row">
              <div class="mcs-title">Mam → ESI &amp; PF Compliance Sheet</div>
            </div>
            <div id="mcsSheetMeta" class="mcs-meta">Verified Lokesh Formulas · 39-Column Full Compliance Excel</div>
          </div>
          <div class="mcs-actions-zone">
            <select id="mcsMonthSwitch" class="mcs-select" title="Saved monthly compliance sheets"></select>
            <label class="mcs-btn mcs-btn-primary mcs-file-label">
              <span>+ Upload Mam Sheet</span>
              <input id="mcsMamInput" type="file" accept=".csv,.xlsx,.xls">
            </label>
            <button type="button" id="mcsDownloadFormBtn" class="mcs-btn mcs-btn-accent" disabled>Download Form (.xlsx)</button>
            <button type="button" id="mcsDownloadBtn" class="mcs-btn" disabled title="1-Click Download Full Styled Excel Workbook">Quick .xlsx</button>
            <button type="button" id="mcsDownloadCsvBtn" class="mcs-btn" disabled title="Export current view as CSV">CSV</button>
            <button type="button" id="mcsExpandGridBtn" class="mcs-btn" title="Maximize spreadsheet area (Ctrl+Shift+F)">⛶ Expand Grid</button>
            <button type="button" id="mcsFullscreenBtn" class="mcs-btn" title="Enter/Exit Browser Full Screen">⛶ Full Screen</button>
            <button type="button" id="mcsBackBtn" class="mcs-btn">Back to ERP</button>
          </div>
        </header>

        <div id="mcsKpiStrip" class="mcs-kpi-strip"></div>

        <div class="mcs-toolbar">
          <div class="mcs-toolbar-left">
            <input id="mcsSearch" class="mcs-input" style="width:200px" placeholder="Search ID, Name, PF, ESI, C7...">
            <select id="mcsCatFilter" class="mcs-select"></select>
            <div class="mcs-seg" role="group" aria-label="Filter rows by status">
              <button type="button" class="mcs-seg-btn active" data-status="ALL">All</button>
              <button type="button" class="mcs-seg-btn" data-status="ONROLL">Onroll</button>
              <button type="button" class="mcs-seg-btn" data-status="OFFROLL">Off Roll</button>
              <button type="button" class="mcs-seg-btn" data-status="MISSING_STAT">No PF/ESI</button>
              <button type="button" class="mcs-seg-btn" data-status="DIFF_ALERT">Review</button>
            </div>
          </div>
          <div class="mcs-toolbar-right">
            <select id="mcsViewPreset" class="mcs-select" title="Switch grid column preset">
              <option value="FULL">Full 39-Col View</option>
              <option value="ATTENDANCE">Attendance View</option>
              <option value="STATUTORY">PF &amp; ESIC View</option>
              <option value="COMPACT">Compact View</option>
            </select>
            <button type="button" id="mcsUndoBtn" class="mcs-btn" disabled title="Undo (Ctrl+Z)">↩ Undo</button>
            <button type="button" id="mcsRedoBtn" class="mcs-btn" disabled title="Redo (Ctrl+Y)">↪ Redo</button>
            <button type="button" id="mcsAddRowBtn" class="mcs-btn">+ Add Row</button>
            <button type="button" id="mcsCopyTsvBtn" class="mcs-btn" title="Copy visible/selected rows for MS Excel">📋 Copy Excel</button>
            <button type="button" id="mcsFreezeBtn" class="mcs-btn mcs-btn-active" title="Freeze S.No, ID &amp; Name columns">❄️ Freeze A–C</button>
            <div class="mcs-colpop-wrap">
              <button type="button" id="mcsColPickerBtn" class="mcs-btn" title="Show/Hide Excel columns">⊞ Columns</button>
              <div id="mcsColPicker" class="mcs-colpop"></div>
            </div>
            <button type="button" id="mcsFindReplaceBtn" class="mcs-btn" title="Find &amp; Replace (Ctrl+H)">⇄ Find/Replace</button>
            <button type="button" id="mcsLastMonthBtn" class="mcs-btn" title="Auto-apply last month PF &amp; ESIC logic">⏮ Last Month PF/ESIC</button>
            <button type="button" id="mcsSyncMasterBtn" class="mcs-btn">Sync Master</button>
            <button type="button" id="mcsSyncAdvBtn" class="mcs-btn">Sync Advances</button>
            <button type="button" id="mcsFormulaBtn" class="mcs-btn">Formulas &amp; Rules</button>
            <button type="button" id="mcsDeleteSheetBtn" class="mcs-btn" disabled>Delete Month</button>
          </div>
        </div>

        <div id="mcsFindReplaceBar" class="mcs-frbar">
          <strong>Find &amp; Replace:</strong>
          <select id="mcsFrField" class="mcs-select" style="height:28px">
            <option value="category">Category</option>
            <option value="designation">Designation</option>
            <option value="department">Department</option>
            <option value="remarks">Remarks (onroll / off roll)</option>
            <option value="pfMode">PF Rule</option>
            <option value="esiMode">ESIC Rule</option>
          </select>
          <input id="mcsFrFind" class="mcs-input" style="height:28px;width:150px" placeholder="Find (blank = all)">
          <input id="mcsFrReplace" class="mcs-input" style="height:28px;width:150px" placeholder="Replace with">
          <select id="mcsFrScope" class="mcs-select" style="height:28px">
            <option value="FILTERED">Filtered Rows</option>
            <option value="SELECTED">Selected Rows Only</option>
          </select>
          <button type="button" id="mcsFrApplyBtn" class="mcs-btn mcs-btn-primary" style="height:28px">Replace All</button>
          <button type="button" id="mcsFrCloseBtn" class="mcs-btn" style="height:28px">Close</button>
        </div>

        <div id="mcsBulkBar" class="mcs-bulkbar">
          <div class="mcs-bulk-group">
            <span id="mcsBulkInfo" class="mcs-bulk-info">0 selected</span>
            <input id="mcsBulkDays" type="number" step="1" min="0" max="31" class="mcs-input" style="height:28px;width:76px" placeholder="Days">
            <button type="button" id="mcsBulkApplyDays" class="mcs-mini-btn">Set Days</button>
            <input id="mcsBulkOt" type="number" step="1" min="0" max="100" class="mcs-input" style="height:28px;width:68px" placeholder="OT">
            <button type="button" id="mcsBulkApplyOt" class="mcs-mini-btn">Set OT</button>
            <select id="mcsBulkPf" class="mcs-select" style="height:28px">
              <option value="">PF Rule…</option>
              <option value="AUTO">AUTO</option>
              <option value="FULL_12">FULL_12</option>
              <option value="CAP_15000">CAP_15000</option>
              <option value="GROSS_12">GROSS_12</option>
              <option value="NONE">NONE</option>
            </select>
            <select id="mcsBulkEsi" class="mcs-select" style="height:28px">
              <option value="">ESIC Rule…</option>
              <option value="AUTO">AUTO</option>
              <option value="EARN_BASIC">EARN_BASIC</option>
              <option value="TOTAL_GROSS">TOTAL_GROSS</option>
              <option value="NONE">NONE</option>
            </select>
            <select id="mcsBulkRemarks" class="mcs-select" style="height:28px">
              <option value="">Remarks…</option>
              <option value="onroll">onroll</option>
              <option value="off roll">off roll</option>
            </select>
          </div>
          <div class="mcs-bulk-group">
            <button type="button" id="mcsBulkHoldBtn" class="mcs-mini-btn">Hold Pay</button>
            <button type="button" id="mcsBulkUnholdBtn" class="mcs-mini-btn">Release Hold</button>
            <button type="button" id="mcsBulkDelBtn" class="mcs-mini-btn" style="color:#dc2626">Delete Selected</button>
            <button type="button" id="mcsBulkClearBtn" class="mcs-mini-btn">Clear</button>
          </div>
        </div>

        <div id="mcsFormulaDrawer" class="mcs-drawer">
          <div class="mcs-drawer-grid">
            <div class="mcs-field">
              <label>Payroll Month</label>
              <input id="mcsSetMonth" type="month">
            </div>
            <div class="mcs-field">
              <label>Month Of Days</label>
              <input id="mcsSetMonthDays" type="number" min="28" max="31">
            </div>
            <div class="mcs-field">
              <label>Max OT Hours</label>
              <input id="mcsSetMaxOt" type="number" min="0" max="100">
            </div>
            <div class="mcs-field">
              <label>Bonus Formula</label>
              <select id="mcsSetBonusMode">
                <option value="BASIC_833">8.33% of Earn Basic (Lokesh Default)</option>
                <option value="GROSS_10">10% of Gross Earned</option>
                <option value="NONE">No Bonus (0%)</option>
              </select>
            </div>
            <div class="mcs-field">
              <label>Bonus %</label>
              <input id="mcsSetBonusRate" type="number" step="0.01">
            </div>
            <div class="mcs-field">
              <label>OT Divisor (Gross / N)</label>
              <input id="mcsSetOtDivisor" type="number" step="1">
            </div>
            <div class="mcs-field">
              <label>PF@12% Mode</label>
              <select id="mcsSetPfMode">
                <option value="FULL_12">12% Full Earn Basic (Lokesh Default)</option>
                <option value="CAP_15000">12% Capped at ₹15,000</option>
                <option value="NONE">PF Disabled</option>
              </select>
            </div>
            <div class="mcs-field">
              <label>ESIC@0.75% Base</label>
              <select id="mcsSetEsiBase">
                <option value="EARN_BASIC">0.75% of Earn Basic (Lokesh Default)</option>
                <option value="TOTAL_GROSS">0.75% of Total Gross</option>
              </select>
            </div>
            <div class="mcs-field" style="display:flex;gap:8px">
              <button type="button" id="mcsApplyFormulaBtn" class="mcs-btn mcs-btn-primary">Apply &amp; Recalculate</button>
              <label class="mcs-btn mcs-file-label">
                <span>Import Ref</span>
                <input id="mcsRefInput" type="file" accept=".csv,.xlsx,.xls">
              </label>
            </div>
          </div>
        </div>

        <div class="mcs-formulabar">
          <span class="mcs-fx">fx</span>
          <span id="mcsFormulaCoord" class="mcs-fcoord">Select any cell</span>
          <span id="mcsFormulaExpr" class="mcs-fexpr">Lokesh formulas: Earn Basic = ROUND(Basic * PaidDays / MonthDays, 0) · PF = 12% Earn Basic · ESIC = 0.75% Earn Basic</span>
          <input id="mcsFormulaInput" class="mcs-finput" style="display:none" placeholder="Edit selected cell & press Enter...">
        </div>

        <div id="mcsNotice" class="mcs-notice" data-type="info">Upload only Mam Salary Sheet (.csv / .xlsx). Software Employee Master se PF, ESIC, Category, Designation, Basic aur Gross automatic utha lega.</div>

        <div id="mcsEmptyState" class="mcs-empty">
          <div id="mcsEmptyCard" class="mcs-empty-card">
            <div class="mcs-empty-icon">📊</div>
            <h3>Upload Mam Salary Sheet to Generate ESI &amp; PF Compliance Excel</h3>
            <p>
              Mam ki salary sheet (<strong>.csv, .xlsx, .xls</strong>) yahan select ya drag-drop karein.
              Employee Master se <strong>PF No, ESI No, Category, Designation, Bank</strong> aur Lokesh formulas automatic apply honge.
            </p>
            <div class="mcs-empty-steps">
              <div class="mcs-empty-step"><strong>1. Auto Enrichment</strong>PF, ESIC, Basic, Gross &amp; Card shifts automatically synced.</div>
              <div class="mcs-empty-step"><strong>2. Live Formula Grid</strong>Edit Days, OT or PF rules directly &amp; review instant totals.</div>
              <div class="mcs-empty-step"><strong>3. MS Excel Ready</strong>Opens cleanly in Excel with full borders, totals &amp; Category tabs.</div>
            </div>
            <label class="mcs-btn mcs-btn-primary mcs-file-label" style="height:42px;padding:0 22px;font-size:13.5px">
              <span>Select or Drop Mam Sheet (.csv / .xlsx / .xls)</span>
              <input id="mcsEmptyUpload" type="file" accept=".csv,.xlsx,.xls">
            </label>
          </div>
        </div>

        <div id="mcsGridContainer" class="mcs-grid-container" style="display:none">
          <div class="mcs-grid-scroll">
            <table class="mcs-table">
              <colgroup id="mcsTableColgroup"></colgroup>
              <thead id="mcsTableHead"></thead>
              <tbody id="mcsTableBody"></tbody>
              <tfoot id="mcsTableFoot"></tfoot>
            </table>
          </div>
          <div id="mcsSheetTabs" class="mcs-sheet-tabs">
            <button type="button" class="mcs-sheet-tab active" data-tab="MAIN">Main Sheet (39 Cols)</button>
            <button type="button" class="mcs-sheet-tab" data-tab="CATEGORY">Category Summary</button>
            <button type="button" class="mcs-sheet-tab" data-tab="BANK">Bank NEFT Transfer</button>
            <button type="button" class="mcs-sheet-tab" data-tab="PF_ESIC">PF &amp; ESIC Summary</button>
            <button type="button" class="mcs-sheet-tab" data-tab="DIFF">Diff &amp; Variance</button>
            <button type="button" class="mcs-sheet-tab" data-tab="LAST_MONTH">Last Month &amp; Card Audit</button>
            <button type="button" class="mcs-sheet-tab" data-tab="MASTER">Master &amp; Bank</button>
          </div>
        </div>

        <footer class="mcs-footer">
          <div>
            <span id="mcsSyncLabel">Synced across browsers</span>
            <span> · </span>
            <span id="mcsStatusStats" class="num">Filtered: 0</span>
            <span> · </span>
            <span>Enter / ↑ / ↓ / Ctrl+V Excel Paste / Ctrl+Z Undo</span>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <label style="display:inline-flex;align-items:center;gap:4px">
              <span>Rows:</span>
              <select id="mcsPageSize" class="mcs-select" style="height:26px;font-size:11.5px;padding:0 6px">
                <option value="50">50</option>
                <option value="100" selected>100</option>
                <option value="250">250</option>
                <option value="9999">All</option>
              </select>
            </label>
            <span id="mcsPageInfo" class="num">0 rows</span>
            <button type="button" id="mcsPrevPage" class="mcs-btn" style="height:26px;padding:0 10px">Prev</button>
            <button type="button" id="mcsNextPage" class="mcs-btn" style="height:26px;padding:0 10px">Next</button>
          </div>
        </footer>

        <div id="mcsExportModal" class="mcs-modal" role="dialog" aria-label="Compliance Excel Download Form">
          <div class="mcs-modal-card">
            <div class="mcs-modal-head">
              <h3>Compliance Excel Download Form</h3>
              <button type="button" id="mcsExpCloseBtn" class="mcs-mini-btn">✕ Close</button>
            </div>
            <div id="mcsExpSummaryStrip" class="mcs-exp-strip"></div>
            <div class="mcs-modal-body">
              <div class="mcs-exp-grid">
                <div class="mcs-field">
                  <label>File Name (.xlsx)</label>
                  <input id="mcsExpFileName" type="text" placeholder="ATPL_ESI_PF_Compliance">
                </div>
                <div class="mcs-field">
                  <label>Excel Column Format</label>
                  <select id="mcsExpTemplate">
                    <option value="FULL">Full ATPL Compliance (39 Cols + Working Days + HRA + Bonus)</option>
                    <option value="COMPACT_25">Compact Legacy Format (25 Cols)</option>
                  </select>
                </div>
                <div class="mcs-field">
                  <label>Row Scope</label>
                  <select id="mcsExpScope">
                    <option value="ALL">All Employees</option>
                    <option value="FILTERED">Current Filtered View</option>
                    <option value="SELECTED">Selected Rows Only</option>
                    <option value="ONROLL">Onroll Only</option>
                  </select>
                </div>
              </div>

              <div class="mcs-exp-toggles">
                <label class="mcs-exp-check"><input id="mcsExpFormulas" type="checkbox" checked><span>Include Live MS Excel Formulas (=SUM, =ROUND, etc.)</span></label>
                <label class="mcs-exp-check"><input id="mcsExpBanner" type="checkbox"><span>Include Company Header Banner (Rows 1–2)</span></label>
                <label class="mcs-exp-check"><input id="mcsExpEmployer" type="checkbox" checked><span>Include Employer Share (PF @13% &amp; ESI @3.25%)</span></label>
                <label class="mcs-exp-check"><input id="mcsExpExcludeHold" type="checkbox" checked><span>Exclude Hold Salary Rows from Bank NEFT Sheet</span></label>
              </div>

              <div>
                <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#475569;margin-bottom:7px">Worksheets to Include</div>
                <div class="mcs-exp-sheets">
                  <label class="mcs-exp-check"><input type="checkbox" data-exp-sheet="main" checked><span>Main Compliance Sheet</span></label>
                  <label class="mcs-exp-check"><input type="checkbox" data-exp-sheet="categorySummary" checked><span>Category Summary</span></label>
                  <label class="mcs-exp-check"><input type="checkbox" data-exp-sheet="categoryTabs" checked><span>Individual Category Tabs</span></label>
                  <label class="mcs-exp-check"><input type="checkbox" data-exp-sheet="bankNeft" checked><span>Bank NEFT Transfer</span></label>
                  <label class="mcs-exp-check"><input type="checkbox" data-exp-sheet="statutory" checked><span>PF &amp; ESIC Challan Summary</span></label>
                  <label class="mcs-exp-check"><input type="checkbox" data-exp-sheet="diffVariance" checked><span>Diff &amp; Variance Audit</span></label>
                  <label class="mcs-exp-check"><input type="checkbox" data-exp-sheet="master" checked><span>Master &amp; Designation</span></label>
                  <label class="mcs-exp-check"><input type="checkbox" data-exp-sheet="lastMonthAudit" checked><span>Last Month &amp; Card Audit</span></label>
                  <label class="mcs-exp-check"><input type="checkbox" data-exp-sheet="notes" checked><span>Formula Notes</span></label>
                </div>
              </div>
            </div>
            <div class="mcs-modal-foot">
              <div style="display:flex;gap:6px;flex-wrap:wrap">
                <button type="button" id="mcsExpBankOnly" class="mcs-btn">Bank NEFT Only (.xlsx)</button>
                <button type="button" id="mcsExpChallanOnly" class="mcs-btn">PF &amp; ESIC Challan (.xlsx)</button>
                <button type="button" id="mcsExpCsv" class="mcs-btn">CSV</button>
                <button type="button" id="mcsExpPrint" class="mcs-btn">Print</button>
              </div>
              <button type="button" id="mcsExpRunXlsx" class="mcs-btn mcs-btn-accent">Download Styled Excel (.xlsx)</button>
            </div>
          </div>
        </div>

        <aside id="mcsInspectorDrawer" class="mcs-inspector" aria-label="Employee Compliance Inspector">
          <div id="mcsInsBody"></div>
        </aside>
      </div>
    `;

    const container = document.querySelector('.content') || ($('page-cmd') && $('page-cmd').parentNode) || document.body;
    container.appendChild(page);
    bindDomEvents();
  }

  function bindDomEvents() {
    if ($('mcsMamInput')) $('mcsMamInput').onchange = e => handleMamUpload(e.target.files[0]);
    if ($('mcsEmptyUpload')) $('mcsEmptyUpload').onchange = e => handleMamUpload(e.target.files[0]);
    const emptyCard = $('mcsEmptyCard');
    if (emptyCard) {
      emptyCard.addEventListener('dragover', e => { e.preventDefault(); emptyCard.classList.add('mcs-dragover'); });
      emptyCard.addEventListener('dragleave', () => { emptyCard.classList.remove('mcs-dragover'); });
      emptyCard.addEventListener('drop', e => {
        e.preventDefault();
        emptyCard.classList.remove('mcs-dragover');
        const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) handleMamUpload(f);
      });
    }
    if ($('mcsRefInput')) $('mcsRefInput').onchange = e => handleReferenceUpload(e.target.files[0]);
    if ($('mcsDownloadBtn')) $('mcsDownloadBtn').onclick = downloadExcel;
    if ($('mcsDownloadFormBtn')) $('mcsDownloadFormBtn').onclick = () => openExportModal(true);
    if ($('mcsDownloadCsvBtn')) $('mcsDownloadCsvBtn').onclick = () => exportCsv();
    if ($('mcsExpandGridBtn')) $('mcsExpandGridBtn').onclick = () => toggleFocusMode();
    if ($('mcsFullscreenBtn')) $('mcsFullscreenBtn').onclick = () => toggleBrowserFullscreen();
    if ($('mcsBackBtn')) $('mcsBackBtn').onclick = () => {
      const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
      if (fsEl && document.exitFullscreen) { try { document.exitFullscreen(); } catch (_) {} }
      if (typeof root.goPage === 'function') root.goPage('cmd');
    };
    if ($('mcsMonthSwitch')) $('mcsMonthSwitch').onchange = e => {
      state.activeId = e.target.value;
      state.pageOffset = 0;
      state.selectedUids.clear();
      saveToLocal();
      render();
    };
    if ($('mcsSearch')) $('mcsSearch').oninput = e => {
      state.search = e.target.value;
      state.pageOffset = 0;
      render();
    };
    if ($('mcsCatFilter')) $('mcsCatFilter').onchange = e => {
      state.categoryFilter = e.target.value;
      state.pageOffset = 0;
      render();
    };
    if ($('mcsViewPreset')) $('mcsViewPreset').onchange = e => applyColumnPreset(e.target.value);
    document.querySelectorAll('.mcs-seg-btn').forEach(btn => {
      btn.onclick = () => {
        state.statusFilter = btn.dataset.status;
        state.pageOffset = 0;
        render();
      };
    });
    document.querySelectorAll('.mcs-sheet-tab').forEach(btn => {
      btn.onclick = () => {
        state.activeTab = btn.dataset.tab || 'MAIN';
        render();
      };
    });

    if ($('mcsUndoBtn')) $('mcsUndoBtn').onclick = undoEdit;
    if ($('mcsRedoBtn')) $('mcsRedoBtn').onclick = redoEdit;
    if ($('mcsAddRowBtn')) $('mcsAddRowBtn').onclick = addBlankRow;
    if ($('mcsCopyTsvBtn')) $('mcsCopyTsvBtn').onclick = copyToExcelClipboard;
    if ($('mcsFreezeBtn')) $('mcsFreezeBtn').onclick = () => {
      state.freezePanes = !state.freezePanes;
      render();
    };
    if ($('mcsColPickerBtn')) $('mcsColPickerBtn').onclick = e => {
      e.stopPropagation();
      const pop = $('mcsColPicker');
      if (!pop) return;
      renderColumnPicker();
      pop.classList.toggle('open');
    };
    if ($('mcsColPicker')) {
      $('mcsColPicker').addEventListener('click', e => {
        e.stopPropagation();
        if (e.target && e.target.id === 'mcsColShowAll') applyColumnPreset('FULL');
        else if (e.target && e.target.id === 'mcsColAttendance') applyColumnPreset('ATTENDANCE');
        else if (e.target && e.target.id === 'mcsColStatutory') applyColumnPreset('STATUTORY');
        else if (e.target && e.target.id === 'mcsColCompact') applyColumnPreset('COMPACT');
      });
      $('mcsColPicker').addEventListener('change', e => {
        const cb = e.target.closest('input[data-col-toggle]');
        if (!cb) return;
        const k = cb.dataset.colToggle;
        if (cb.checked) delete state.hiddenCols[k];
        else state.hiddenCols[k] = true;
        try { localStorage.setItem(STORAGE_HIDDENCOLS_KEY, JSON.stringify(state.hiddenCols)); } catch (_) {}
        render();
      });
    }
    if ($('mcsFindReplaceBtn')) $('mcsFindReplaceBtn').onclick = () => {
      const b = $('mcsFindReplaceBar');
      if (b) b.classList.toggle('open');
    };
    if ($('mcsFrCloseBtn')) $('mcsFrCloseBtn').onclick = () => {
      const b = $('mcsFindReplaceBar');
      if (b) b.classList.remove('open');
    };
    if ($('mcsFrApplyBtn')) $('mcsFrApplyBtn').onclick = applyFindAndReplace;

    // Bulk action controls
    if ($('mcsBulkApplyDays')) $('mcsBulkApplyDays').onclick = () => {
      const v = $('mcsBulkDays') ? $('mcsBulkDays').value : '';
      if (v !== '') applyBulkAction('paidDays', v);
    };
    if ($('mcsBulkApplyOt')) $('mcsBulkApplyOt').onclick = () => {
      const v = $('mcsBulkOt') ? $('mcsBulkOt').value : '';
      if (v !== '') applyBulkAction('overtimeHours', v);
    };
    if ($('mcsBulkPf')) $('mcsBulkPf').onchange = e => {
      if (e.target.value) { applyBulkAction('pfMode', e.target.value); e.target.value = ''; }
    };
    if ($('mcsBulkEsi')) $('mcsBulkEsi').onchange = e => {
      if (e.target.value) { applyBulkAction('esiMode', e.target.value); e.target.value = ''; }
    };
    if ($('mcsBulkRemarks')) $('mcsBulkRemarks').onchange = e => {
      if (e.target.value) { applyBulkAction('remarks', e.target.value); e.target.value = ''; }
    };
    if ($('mcsBulkHoldBtn')) $('mcsBulkHoldBtn').onclick = () => applyBulkAction('hold', true);
    if ($('mcsBulkUnholdBtn')) $('mcsBulkUnholdBtn').onclick = () => applyBulkAction('hold', false);
    if ($('mcsBulkDelBtn')) $('mcsBulkDelBtn').onclick = () => applyBulkAction('delete');
    if ($('mcsBulkClearBtn')) $('mcsBulkClearBtn').onclick = () => { state.selectedUids.clear(); render(); };

    if ($('mcsLastMonthBtn')) $('mcsLastMonthBtn').onclick = applyLastMonthPfEsicToActiveSheet;
    if ($('mcsSyncMasterBtn')) $('mcsSyncMasterBtn').onclick = () => refreshFromMasterAndAdvance(false);
    if ($('mcsSyncAdvBtn')) $('mcsSyncAdvBtn').onclick = () => refreshFromMasterAndAdvance(true);
    if ($('mcsFormulaBtn')) $('mcsFormulaBtn').onclick = () => {
      const d = $('mcsFormulaDrawer');
      if (d) d.classList.toggle('open');
    };
    if ($('mcsApplyFormulaBtn')) $('mcsApplyFormulaBtn').onclick = applySettingsFromDrawer;
    if ($('mcsDeleteSheetBtn')) $('mcsDeleteSheetBtn').onclick = deleteActiveMonthSheet;
    if ($('mcsPageSize')) $('mcsPageSize').onchange = e => {
      state.pageSize = Math.max(10, Number(e.target.value) || 100);
      state.pageOffset = 0;
      render();
    };
    if ($('mcsPrevPage')) $('mcsPrevPage').onclick = () => { state.pageOffset = Math.max(0, state.pageOffset - 1); render(); };
    if ($('mcsNextPage')) $('mcsNextPage').onclick = () => { state.pageOffset++; render(); };

    // Formula bar live edit
    if ($('mcsFormulaInput')) {
      $('mcsFormulaInput').addEventListener('keydown', e => {
        if (e.key === 'Enter' && state.selectedCell && state.selectedCell.editable) {
          e.preventDefault();
          pushUndoSnapshot();
          applyRowCellEdit(state.selectedCell.uid, state.selectedCell.key, e.target.value);
        }
      });
    }

    // Header sort & Select All
    const thead = $('mcsTableHead');
    if (thead) {
      thead.addEventListener('click', e => {
        const selAll = e.target.closest('#mcsSelectAll');
        if (selAll) {
          const fl = filteredRows();
          if (selAll.checked) fl.forEach(r => state.selectedUids.add(r.uid));
          else fl.forEach(r => state.selectedUids.delete(r.uid));
          render();
          return;
        }
        const th = e.target.closest('th[data-sort]');
        if (th && state.activeTab === 'MAIN') toggleSort(th.dataset.sort);
      });
    }

    const tbody = $('mcsTableBody');
    if (tbody) {
      tbody.addEventListener('input', e => {
        const inp = e.target.closest('input[data-field]');
        const tr = e.target.closest('tr[data-uid]');
        if (!inp || !tr || inp.type === 'checkbox') return;
        if (!state._editBatchOpen) {
          pushUndoSnapshot();
          state._editBatchOpen = true;
        }
        applyRowCellEdit(tr.dataset.uid, inp.dataset.field, inp.value);
      });
      tbody.addEventListener('change', e => {
        const selCb = e.target.closest('input[data-sel]');
        if (selCb) {
          if (selCb.checked) state.selectedUids.add(selCb.dataset.sel);
          else state.selectedUids.delete(selCb.dataset.sel);
          const trRow = selCb.closest('tr[data-uid]');
          if (trRow) trRow.classList.toggle('mcs-row-sel', selCb.checked);
          updateSummaryAndTotalsBar();
          return;
        }
        const fieldEl = e.target.closest('[data-field]');
        const tr = e.target.closest('tr[data-uid]');
        if (!fieldEl || !tr) return;
        if (fieldEl.tagName === 'SELECT' || fieldEl.type === 'checkbox') {
          pushUndoSnapshot();
          const val = fieldEl.type === 'checkbox' ? fieldEl.checked : fieldEl.value;
          applyRowCellEdit(tr.dataset.uid, fieldEl.dataset.field, val);
        }
      });
      tbody.addEventListener('click', e => {
        const ins = e.target.closest('[data-inspect]');
        if (ins) { openInspector(ins.dataset.inspect); return; }
        const jump = e.target.closest('tr[data-jump-uid]');
        if (jump) { openInspector(jump.dataset.jumpUid); return; }
        const del = e.target.closest('[data-del]');
        if (del) { deleteRow(del.dataset.del); return; }
        const catRow = e.target.closest('tr[data-jump-cat]');
        if (catRow) {
          state.categoryFilter = catRow.dataset.jumpCat;
          state.activeTab = 'MAIN';
          state.pageOffset = 0;
          render();
        }
      });
      tbody.addEventListener('focusin', e => {
        state._editBatchOpen = false;
        const tr = e.target.closest('tr[data-uid]');
        if (!tr) return;
        const sh = activeSheet();
        const row = sh && (sh.rows || []).find(r => r.uid === tr.dataset.uid);
        const fieldEl = e.target.closest('[data-field]');
        const roCell = e.target.closest('[data-ro-cell]');
        const key = fieldEl ? fieldEl.dataset.field : (roCell ? roCell.dataset.roCell : '');
        const colDef = GRID_COLS.find(c => c.key === key);
        if (row && colDef) selectCellInfo(row, colDef, Number(tr.dataset.rowidx || 0));
      });
      tbody.addEventListener('focusout', () => {
        state._editBatchOpen = false;
      });
      tbody.addEventListener('paste', e => {
        const inp = e.target.closest('input[data-field]');
        const tr = e.target.closest('tr[data-uid]');
        if (!inp || !tr || !e.clipboardData) return;
        const txt = e.clipboardData.getData('text/plain');
        if (txt && (txt.includes('\t') || txt.includes('\n'))) {
          if (pasteFromClipboardText(tr.dataset.uid, inp.dataset.field, txt)) {
            e.preventDefault();
          }
        }
      });
      tbody.addEventListener('keydown', e => {
        if (!['Enter', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
        const inp = e.target.closest('input[data-field]');
        const tr = e.target.closest('tr[data-uid]');
        if (!inp || !tr) return;
        const dir = (e.key === 'ArrowUp' || (e.key === 'Enter' && e.shiftKey)) ? -1 : 1;
        const nextTr = dir > 0 ? tr.nextElementSibling : tr.previousElementSibling;
        if (!nextTr) return;
        const target = nextTr.querySelector(`input[data-field="${inp.dataset.field}"]`);
        if (target) {
          e.preventDefault();
          target.focus();
          if (typeof target.select === 'function') target.select();
        }
      });
    }

    // Export Download Form Modal Listeners
    const expModal = $('mcsExportModal');
    if (expModal) {
      expModal.addEventListener('click', e => {
        if (e.target === expModal) closeExportModal();
      });
      const syncExpFromModal = () => {
        const o = state.exportOptions;
        if ($('mcsExpFileName')) o.customFilename = $('mcsExpFileName').value;
        if ($('mcsExpTemplate')) o.template = $('mcsExpTemplate').value || 'FULL';
        if ($('mcsExpScope')) o.scope = $('mcsExpScope').value || 'ALL';
        if ($('mcsExpFormulas')) o.includeFormulas = !!$('mcsExpFormulas').checked;
        if ($('mcsExpBanner')) o.includeBanner = !!$('mcsExpBanner').checked;
        if ($('mcsExpEmployer')) o.includeEmployerCols = !!$('mcsExpEmployer').checked;
        if ($('mcsExpExcludeHold')) o.excludeHoldFromBank = !!$('mcsExpExcludeHold').checked;
        saveExportOptions();
        syncExportModalUi();
      };
      if ($('mcsExpCloseBtn')) $('mcsExpCloseBtn').onclick = closeExportModal;
      if ($('mcsExpFileName')) $('mcsExpFileName').oninput = syncExpFromModal;
      ['mcsExpTemplate', 'mcsExpScope', 'mcsExpFormulas', 'mcsExpBanner', 'mcsExpEmployer', 'mcsExpExcludeHold'].forEach(id => {
        if ($(id)) $(id).onchange = syncExpFromModal;
      });
      expModal.addEventListener('change', e => {
        const cb = e.target.closest && e.target.closest('input[data-exp-sheet]');
        if (cb) {
          state.exportOptions.sheets[cb.dataset.expSheet] = !!cb.checked;
          saveExportOptions();
          syncExportModalUi();
        }
      });
      if ($('mcsExpRunXlsx')) $('mcsExpRunXlsx').onclick = () => { syncExpFromModal(); closeExportModal(); runCustomExport('FULL', state.exportOptions); };
      if ($('mcsExpBankOnly')) $('mcsExpBankOnly').onclick = () => { syncExpFromModal(); closeExportModal(); runCustomExport('BANK_ONLY', state.exportOptions); };
      if ($('mcsExpChallanOnly')) $('mcsExpChallanOnly').onclick = () => { syncExpFromModal(); closeExportModal(); runCustomExport('CHALLAN_ONLY', state.exportOptions); };
      if ($('mcsExpCsv')) $('mcsExpCsv').onclick = () => { syncExpFromModal(); closeExportModal(); runCustomExport('CSV', state.exportOptions); };
      if ($('mcsExpPrint')) $('mcsExpPrint').onclick = () => { closeExportModal(); if (typeof root.print === 'function') root.print(); };
    }

    // Employee Compliance Inspector Drawer Listeners
    const insDrawer = $('mcsInspectorDrawer');
    if (insDrawer) {
      insDrawer.addEventListener('click', e => {
        if (e.target && e.target.id === 'mcsInsClose') { closeInspector(); return; }
        const jumpBtn = e.target.closest && e.target.closest('[data-jump]');
        if (jumpBtn && jumpBtn.dataset.jump) openInspector(jumpBtn.dataset.jump);
      });
      insDrawer.addEventListener('input', e => {
        const el = e.target.closest && e.target.closest('input[data-ins-field]');
        if (!el || !state.inspectUid) return;
        pushUndoSnapshot();
        applyRowCellEdit(state.inspectUid, el.dataset.insField, el.value);
      });
      insDrawer.addEventListener('change', e => {
        const el = e.target.closest && e.target.closest('select[data-ins-field]');
        if (!el || !state.inspectUid) return;
        pushUndoSnapshot();
        applyRowCellEdit(state.inspectUid, el.dataset.insField, el.value);
      });
    }

    document.addEventListener('click', () => {
      const pop = $('mcsColPicker');
      if (pop) pop.classList.remove('open');
    });
    document.addEventListener('fullscreenchange', updateFullscreenButton);
    document.addEventListener('webkitfullscreenchange', updateFullscreenButton);
    document.addEventListener('keydown', e => {
      const page = $('page-mamsalary');
      if (!page || !page.classList.contains('active')) return;
      if (e.key === 'Escape') {
        if (state.exportModalOpen) closeExportModal();
        else if (state.inspectUid) closeInspector();
      } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        toggleFocusMode();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'h') {
        e.preventDefault();
        const b = $('mcsFindReplaceBar');
        if (b) b.classList.toggle('open');
      } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        redoEdit();
      } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
        const tag = document.activeElement && document.activeElement.tagName;
        if (tag !== 'INPUT' && tag !== 'TEXTAREA') {
          e.preventDefault();
          undoEdit();
        }
      }
    });
  }

  function initStudio() {
    loadFromLocal();
    injectStyles();
    buildPageShell();
    bindRealtimeListeners();
    render();
    pullRemoteSheets();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initStudio, { once: true });
  } else {
    initStudio();
  }
})(typeof window !== 'undefined' ? window : globalThis);
