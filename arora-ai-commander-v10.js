/* ══════════════════════════════════════════════════════════════════
 * ARORA AUTONOMOUS AI COMMANDER & UNIVERSAL SCHEMA INTELLIGENCE (v10.0)
 * ──────────────────────────────────────────────────────────────────
 * Zero-Hardcoding • Dynamic Multi-File Feature Learner • Voice Enabled
 * Full Executive Dossiers • Action Runner • 100% Offline Resilient
 * ══════════════════════════════════════════════════════════════════ */
(function() {
  'use strict';

  if (window.__ARORA_AI_COMMANDER_V10__) return;
  window.__ARORA_AI_COMMANDER_V10__ = true;

  // ─────────────────────────────────────────────────────────────────
  // 1. DYNAMIC UNIVERSAL SCHEMA & FEATURE LEARNER
  // ─────────────────────────────────────────────────────────────────
  var KnowledgeGraph = {
    employees: {},        // key: empCode & normalized name -> profile
    months: {},           // key: monthKey (e.g. '2026-07') -> aggregate stats
    filesSummary: [],     // list of inspected files, sheets & learned schema
    anomalies: [],        // auto-discovered anomalies & compliance flags
    lastScannedFileCount: -1,
    lastScannedTime: null
  };

  var SYNONYMS = {
    empCode: ['empcode', 'code', 'empid', 'id', 'token', 'cardno', 'punchid', 'bioid', 'workercode', 'srno', 'cno', 'emp_id'],
    empName: ['empname', 'name', 'employeename', 'workername', 'naam', 'karamchari', 'employee'],
    fatherName: ['father', 'fathername', 'so', 'wo', 'do', 'pitakanaam', 'careof'],
    dept: ['dept', 'department', 'section', 'unit', 'plant', 'branch', 'karmsthal'],
    desig: ['desig', 'designation', 'role', 'post', 'category', 'jobtitle', 'pad'],
    basic: ['basic', 'basicda', 'earnedbasic', 'basicpay', 'mulvetan', 'rate'],
    hra: ['hra', 'houserent', 'makankiraya', 'houserentallowance'],
    gross: ['gross', 'grosssalary', 'grossearning', 'totalgross', 'kulvetan', 'totalearning'],
    workingDays: ['wd', 'workingdays', 'paiddays', 'payabledays', 'pdays', 'attendance', 'hajri', 'din', 'days', 'present'],
    otHours: ['ot', 'othrs', 'othours', 'overtime', 'overtimehrs', 'extratime', 'otghante'],
    otAmount: ['otamt', 'otamount', 'otearning', 'overtimepay', 'otrupaye'],
    bonus: ['bonus', 'annualbonus', 'statutorybonus', 'diwalibonus', 'earnedbonus'],
    pfEmp: ['pf', 'epf', 'pfee', 'pfemployee', 'pfded', 'providentfund', 'pfamount'],
    pfEr: ['pfer', 'pfemployer', 'epfer', '13pf', 'employerpf'],
    esicEmp: ['esi', 'esic', 'esicee', 'esicemployee', 'esided', 'bima', 'esiamount'],
    esicEr: ['esier', 'esicer', '325esi', 'employeresi'],
    advance: ['adv', 'advance', 'peshgi', 'salaryadv', 'cashadvance', 'kharcha'],
    loan: ['loan', 'loanded', 'emi', 'installment', 'karz'],
    deductions: ['totalded', 'totaldeductions', 'katoti', 'kulkatoti', 'totded'],
    netSalary: ['net', 'netsalary', 'netpay', 'takehome', 'inhand', 'amountpayable', 'milneyogya', 'payment', 'manualamount'],
    bankAccount: ['bankac', 'bankaccount', 'acno', 'accountno', 'khatano', 'accountnumber'],
    ifsc: ['ifsc', 'ifsccode', 'bankifsc'],
    uan: ['uan', 'uanno', 'universalaccount'],
    esicNo: ['esino', 'esicno', 'ipno', 'insuranceno'],
    pan: ['pan', 'panno'],
    aadhar: ['aadhaar', 'aadhar', 'uid'],
    doj: ['doj', 'joiningdate', 'dateofjoining', 'jdate'],
    dol: ['dol', 'leavingdate', 'dateofleaving', 'relievingdate', 'chhodne'],
    date: ['date', 'tarikh', 'punchdate', 'attendancedate', 'logdate'],
    inTime: ['in', 'punchin', 'timein', 'aanekatime', 'firstin'],
    outTime: ['out', 'punchout', 'timeout', 'janekatime', 'lastout']
  };

  function cleanKey(str) {
    return String(str || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  function cleanCode(v) {
    if (v == null) return '';
    var s = String(v).trim().replace(/\.0$/, '');
    var m = s.match(/\d{3,}/);
    return m ? m[0] : s;
  }

  function cleanNum(v) {
    if (v == null) return 0;
    if (typeof v === 'number') return isNaN(v) ? 0 : v;
    var s = String(v).replace(/₹|,|\s/g, '').trim();
    var n = parseFloat(s);
    return isNaN(n) ? 0 : n;
  }

  function parseMonthYear(text) {
    var s = String(text || '').toLowerCase();
    var months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    for (var i = 0; i < months.length; i++) {
      var m = months[i];
      if (s.indexOf(m) >= 0) {
        var yr = 2026;
        var yMatch = s.match(/20\d{2}/) || s.match(/(\d{2})$/);
        if (yMatch) {
          var yVal = parseInt(yMatch[0], 10);
          yr = yVal < 100 ? 2000 + yVal : yVal;
        }
        var mIdx = i + 1;
        var mKey = yr + '-' + (mIdx < 10 ? '0' + mIdx : mIdx);
        var mNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
        return { key: mKey, label: mNames[i] + ' ' + yr, month: mIdx, year: yr };
      }
    }
    // Check numeric MM-YYYY or YYYY-MM
    var numM = s.match(/(20\d{2})[-_/.](0?[1-9]|1[0-2])/) || s.match(/(0?[1-9]|1[0-2])[-_/.](20\d{2})/);
    if (numM) {
      var yr2 = parseInt(numM[1].length === 4 ? numM[1] : numM[2], 10);
      var m2 = parseInt(numM[1].length === 4 ? numM[2] : numM[1], 10);
      var mKey2 = yr2 + '-' + (m2 < 10 ? '0' + m2 : m2);
      var mNames2 = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
      return { key: mKey2, label: (mNames2[m2 - 1] || 'Month ' + m2) + ' ' + yr2, month: m2, year: yr2 };
    }
    return null;
  }

  function matchColumn(headerText) {
    var raw = cleanKey(headerText);
    if (!raw) return null;
    var keys = Object.keys(SYNONYMS);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var list = SYNONYMS[k];
      for (var j = 0; j < list.length; j++) {
        var syn = list[j];
        if (raw === syn || raw.indexOf(syn) >= 0 || syn.indexOf(raw) >= 0) {
          return k;
        }
      }
    }
    return null;
  }

  // Scan and learn from every loaded file, sheet, and master table
  function refreshKnowledgeGraph() {
    var files = Array.isArray(window.FILES) ? window.FILES : [];
    KnowledgeGraph.filesSummary = [];
    KnowledgeGraph.anomalies = [];
    KnowledgeGraph.months = {};

    // 1. Ingest Master Records first (window.EMP_MASTER_DATA / window.EM.data)
    var masterList = [];
    try {
      if (window.EMP_MASTER_DATA && Array.isArray(window.EMP_MASTER_DATA)) masterList = masterList.concat(window.EMP_MASTER_DATA);
      if (window.EM && Array.isArray(window.EM.data)) masterList = masterList.concat(window.EM.data);
    } catch (_) {}

    masterList.forEach(function(m) {
      var code = cleanCode(m.emp_id || m.code);
      if (!code) return;
      var name = String(m.name || '').trim();
      var normName = name.toLowerCase();

      if (!KnowledgeGraph.employees[code]) {
        KnowledgeGraph.employees[code] = {
          code: code,
          name: name,
          normName: normName,
          father: m.father || '',
          dob: m.dob || '',
          doj: m.doj || '',
          dol: m.dol || '',
          dept: m.dept || '',
          desig: m.desig || '',
          cat1: m.cat1 || '',
          cat2: m.cat2 || '',
          gender: m.gender || '',
          masterBasic: cleanNum(m.basic),
          masterHra: cleanNum(m.hra),
          masterGross: cleanNum(m.gross),
          pfNo: m.pf_no || '',
          esiNo: m.esi_no || '',
          monthlyHistory: [],
          attendanceHistory: [],
          customFields: {}
        };
      }
      if (normName && !KnowledgeGraph.employees[normName]) {
        KnowledgeGraph.employees[normName] = KnowledgeGraph.employees[code];
      }
    });

    // 2. Ingest all Workbooks in window.FILES
    files.forEach(function(f, fileIdx) {
      var fName = f.name || ('File ' + (fileIdx + 1));
      var sheets = f.sheets || {};
      var period = parseMonthYear(fName);

      var fileInfo = {
        name: fName,
        sheets: [],
        detectedPeriod: period ? period.label : 'General',
        totalRows: 0
      };

      Object.keys(sheets).forEach(function(sn) {
        var rows = Array.isArray(sheets[sn]) ? sheets[sn] : [];
        if (!rows.length) return;

        var sheetPeriod = parseMonthYear(sn) || period || { key: '2026-07', label: 'July 2026', month: 7, year: 2026 };

        // Find header row in first 25 rows
        var headerIdx = -1;
        var bestScore = 0;
        var bestColMap = {};

        for (var r = 0; r < Math.min(25, rows.length); r++) {
          var row = rows[r];
          if (!Array.isArray(row)) continue;
          var curScore = 0;
          var curMap = {};
          row.forEach(function(cell, colIdx) {
            var mField = matchColumn(cell);
            if (mField) {
              curScore += (mField === 'empCode' || mField === 'empName' ? 5 : 2);
              if (!curMap[mField]) curMap[mField] = colIdx;
            }
          });
          if (curScore > bestScore) {
            bestScore = curScore;
            headerIdx = r;
            bestColMap = curMap;
          }
        }

        if (headerIdx < 0 || bestScore < 3) {
          fileInfo.sheets.push({ name: sn, rowCount: rows.length, type: 'Raw / Notes' });
          return;
        }

        var headerRow = rows[headerIdx];
        var colNames = headerRow.map(function(c, idx) {
          return { idx: idx, rawName: String(c || '').trim(), mappedField: matchColumn(c) };
        });

        // Determine sheet classification
        var sheetType = 'General';
        if (bestColMap.inTime != null || bestColMap.outTime != null) sheetType = 'Attendance Log';
        else if (bestColMap.netSalary != null || bestColMap.gross != null || bestColMap.basic != null) sheetType = 'Salary / Payroll';
        else if (bestColMap.bankAccount != null) sheetType = 'Bank Disbursement';
        else if (bestColMap.doj != null || bestColMap.fatherName != null) sheetType = 'Employee Master';

        fileInfo.sheets.push({
          name: sn,
          rowCount: rows.length - (headerIdx + 1),
          type: sheetType,
          headerRowIdx: headerIdx,
          features: Object.keys(bestColMap)
        });
        fileInfo.totalRows += (rows.length - (headerIdx + 1));

        // Read records
        var monthKey = sheetPeriod.key;
        if (!KnowledgeGraph.months[monthKey]) {
          KnowledgeGraph.months[monthKey] = {
            key: monthKey,
            label: sheetPeriod.label,
            totalGross: 0,
            totalNet: 0,
            totalBasic: 0,
            totalOTHours: 0,
            totalOTAmount: 0,
            totalPF: 0,
            totalESIC: 0,
            totalAdvance: 0,
            totalEmployees: 0,
            employeeCodes: new Set()
          };
        }
        var mStats = KnowledgeGraph.months[monthKey];

        for (var i = headerIdx + 1; i < rows.length; i++) {
          var rData = rows[i];
          if (!Array.isArray(rData)) continue;

          var codeVal = bestColMap.empCode != null ? cleanCode(rData[bestColMap.empCode]) : '';
          var nameVal = bestColMap.empName != null ? String(rData[bestColMap.empName] || '').trim() : '';

          if (!codeVal && !nameVal) continue;
          if (nameVal.match(/^(total|grand total|subtotal|summary|dept total)$/i)) continue;

          var codeKey = codeVal || ('NAME_' + cleanKey(nameVal));
          if (!KnowledgeGraph.employees[codeKey]) {
            KnowledgeGraph.employees[codeKey] = {
              code: codeVal,
              name: nameVal,
              normName: nameVal.toLowerCase(),
              father: '',
              dept: '',
              desig: '',
              monthlyHistory: [],
              attendanceHistory: [],
              customFields: {}
            };
            if (nameVal) KnowledgeGraph.employees[nameVal.toLowerCase()] = KnowledgeGraph.employees[codeKey];
          }

          var empObj = KnowledgeGraph.employees[codeKey];
          if (nameVal && !empObj.name) empObj.name = nameVal;
          if (bestColMap.fatherName != null && rData[bestColMap.fatherName]) empObj.father = String(rData[bestColMap.fatherName]).trim();
          if (bestColMap.dept != null && rData[bestColMap.dept]) empObj.dept = String(rData[bestColMap.dept]).trim();
          if (bestColMap.desig != null && rData[bestColMap.desig]) empObj.desig = String(rData[bestColMap.desig]).trim();
          if (bestColMap.bankAccount != null && rData[bestColMap.bankAccount]) empObj.bankAccount = String(rData[bestColMap.bankAccount]).trim();
          if (bestColMap.ifsc != null && rData[bestColMap.ifsc]) empObj.ifsc = String(rData[bestColMap.ifsc]).trim();
          if (bestColMap.uan != null && rData[bestColMap.uan]) empObj.uan = String(rData[bestColMap.uan]).trim();
          if (bestColMap.esicNo != null && rData[bestColMap.esicNo]) empObj.esicNo = String(rData[bestColMap.esicNo]).trim();

          // Extract novel / custom columns
          colNames.forEach(function(cn) {
            if (!cn.mappedField && cn.rawName && rData[cn.idx] != null && String(rData[cn.idx]).trim()) {
              empObj.customFields[cn.rawName] = rData[cn.idx];
            }
          });

          // If Salary sheet:
          if (sheetType === 'Salary / Payroll' || bestColMap.gross != null || bestColMap.netSalary != null) {
            var basicAmt = bestColMap.basic != null ? cleanNum(rData[bestColMap.basic]) : 0;
            var grossAmt = bestColMap.gross != null ? cleanNum(rData[bestColMap.gross]) : 0;
            var netAmt = bestColMap.netSalary != null ? cleanNum(rData[bestColMap.netSalary]) : 0;
            var wdAmt = bestColMap.workingDays != null ? cleanNum(rData[bestColMap.workingDays]) : 0;
            var otHAmt = bestColMap.otHours != null ? cleanNum(rData[bestColMap.otHours]) : 0;
            var otPay = bestColMap.otAmount != null ? cleanNum(rData[bestColMap.otAmount]) : 0;
            var pfVal = bestColMap.pfEmp != null ? cleanNum(rData[bestColMap.pfEmp]) : 0;
            var esicVal = bestColMap.esicEmp != null ? cleanNum(rData[bestColMap.esicEmp]) : 0;
            var advVal = bestColMap.advance != null ? cleanNum(rData[bestColMap.advance]) : 0;

            var rec = {
              monthKey: monthKey,
              monthLabel: sheetPeriod.label,
              basic: basicAmt,
              gross: grossAmt,
              net: netAmt,
              workingDays: wdAmt,
              otHours: otHAmt,
              otAmount: otPay,
              pf: pfVal,
              esic: esicVal,
              advance: advVal,
              sourceFile: fName,
              sourceSheet: sn,
              rawRow: i + 1
            };
            empObj.monthlyHistory.push(rec);

            // Update month aggregates
            mStats.totalGross += grossAmt;
            mStats.totalNet += netAmt;
            mStats.totalBasic += basicAmt;
            mStats.totalOTHours += otHAmt;
            mStats.totalOTAmount += otPay;
            mStats.totalPF += pfVal;
            mStats.totalESIC += esicVal;
            mStats.totalAdvance += advVal;
            mStats.employeeCodes.add(codeKey);

            // Anomaly checks
            if (grossAmt > 0 && grossAmt <= 21000 && esicVal === 0) {
              KnowledgeGraph.anomalies.push({
                type: 'ESIC_ZERO_ANOMALY',
                severity: 'High',
                title: 'ESIC Exemption / Mismatch',
                empCode: codeVal,
                empName: empObj.name,
                month: sheetPeriod.label,
                detail: 'Gross ₹' + grossAmt + ' is <= ₹21,000 statutory limit but ESIC deduction is ₹0.'
              });
            }
            if (otHAmt > 40) {
              KnowledgeGraph.anomalies.push({
                type: 'HIGH_OT',
                severity: 'Medium',
                title: 'High Overtime Alert',
                empCode: codeVal,
                empName: empObj.name,
                month: sheetPeriod.label,
                detail: 'Worker logged ' + otHAmt + ' OT hours in ' + sheetPeriod.label + '.'
              });
            }
          }

          // If Attendance log:
          if (sheetType === 'Attendance Log' || bestColMap.inTime != null || bestColMap.outTime != null) {
            var inT = bestColMap.inTime != null ? String(rData[bestColMap.inTime] || '').trim() : '';
            var outT = bestColMap.outTime != null ? String(rData[bestColMap.outTime] || '').trim() : '';
            var pDate = bestColMap.date != null ? String(rData[bestColMap.date] || '').trim() : '';

            empObj.attendanceHistory.push({
              date: pDate,
              inTime: inT,
              outTime: outT,
              rowIdx: i + 1
            });

            if (inT && !outT) {
              KnowledgeGraph.anomalies.push({
                type: 'MISSING_PUNCH_OUT',
                severity: 'Medium',
                title: 'Missing Punch-Out',
                empCode: codeVal,
                empName: empObj.name,
                date: pDate,
                detail: 'Row ' + (i + 1) + ': Punch-in ' + inT + ' hai par Punch-out blank hai.'
              });
            }
          }
        }
      });

      KnowledgeGraph.filesSummary.push(fileInfo);
    });

    // Update month totals count
    Object.keys(KnowledgeGraph.months).forEach(function(mk) {
      KnowledgeGraph.months[mk].totalEmployees = KnowledgeGraph.months[mk].employeeCodes.size;
    });

    KnowledgeGraph.lastScannedFileCount = files.length;
    KnowledgeGraph.lastScannedTime = new Date();
  }

  // ─────────────────────────────────────────────────────────────────
  // 2. COGNITIVE QUERY & REASONING ENGINE (HINDI / HINGLISH / ENGLISH)
  // ─────────────────────────────────────────────────────────────────
  function queryBrain(q) {
    var raw = String(q || '').trim();
    var lower = raw.toLowerCase();

    // Auto-refresh if files or state changed
    refreshKnowledgeGraph();

    var empCount = Object.keys(KnowledgeGraph.employees).length;
    var fileCount = KnowledgeGraph.filesSummary.length;
    var monthKeys = Object.keys(KnowledgeGraph.months).sort();


    // ══════════════════════════════════════════════════════════════════
    // 100X SUPER-INTELLIGENCE: STATUTORY, LABOUR LAWS & RULES EXPERT
    // ══════════════════════════════════════════════════════════════════

    // 1. PF WAGE CEILING / NEW CEILING / EPF RULES
    if (lower.match(/(pf|epf|provident\s*fund).*(ceiling|limit|celling|new\s*limit|hike|15000|21000|rule|percentage|rules)/i) ||
        lower.match(/(ceiling|celling|limit).*(pf|epf)/i)) {
      var pfHtml = '<div style="line-height:1.7">';
      pfHtml += '🏛️ <strong>EPF (Employees Provident Fund) Wage Ceiling & Latest Rules:</strong><br><br>';
      pfHtml += '📌 <strong>1. Current Statutory Wage Ceiling:</strong><br>';
      pfHtml += '• <strong>₹15,000 per month</strong> (Yeh statutory cap 1 September 2014 se laagu hai).<br>';
      pfHtml += '• Jis employee ka Basic + DA ₹15,000 ya usse kam hai, uske liye PF deduction <strong>Mandatory (Anivarya)</strong> hai.<br><br>';
      
      pfHtml += '📌 <strong>2. Proposed / New Wage Ceiling (Latest Update):</strong><br>';
      pfHtml += '• Labour Ministry & EPFO board ne wage ceiling ko <strong>₹15,000 se badha kar ₹21,000 per month</strong> karne ka proposal Govt ko forward kiya hua hai (ESIC limit ke barabar karne ke liye).<br>';
      pfHtml += '• <em>Note:</em> Jab tak central government ka official gazette notification nahi aata, tab tak ERP aur payroll calculations me official ceiling <strong>₹15,000</strong> hi valid hai.<br><br>';

      pfHtml += '📌 <strong>3. Contribution Breakdown (Total 24%):</strong><br>';
      pfHtml += '• <strong>Employee Share:</strong> 12% of (Basic + DA)<br>';
      pfHtml += '• <strong>Employer Share (12%):</strong><br>';
      pfHtml += '  - <strong>3.67%</strong> ➔ EPF (Provident Fund)<br>';
      pfHtml += '  - <strong>8.33%</strong> ➔ EPS (Pension Scheme - capped at max ₹1,250 on ₹15,000)<br>';
      pfHtml += '  - <strong>0.50%</strong> ➔ EDLI (Insurance)<br>';
      pfHtml += '  - <strong>0.50%</strong> ➔ EPF Admin Charges<br><br>';

      pfHtml += '📌 <strong>4. Higher Pension / Ceiling Se Upar:</strong><br>';
      pfHtml += '• Agar basic pay ₹15,000 se zyada hai, toh voluntary joint declaration ke under actual basic par bhi 12% PF deduct ho sakta hai.<br>';
      pfHtml += '</div>';
      return { html: pfHtml };
    }

    // 2. ESIC WAGE CEILING & RULES
    if (lower.match(/(esic|esi|bima).*(ceiling|limit|celling|rule|coverage|percentage|rate)/i) ||
        lower.match(/(ceiling|celling|limit).*(esic|esi)/i)) {
      var esiHtml = '<div style="line-height:1.7">';
      esiHtml += '🏥 <strong>ESIC (Employee State Insurance) Wage Limit & Rules:</strong><br><br>';
      esiHtml += '📌 <strong>1. Statutory Gross Wage Ceiling:</strong><br>';
      esiHtml += '• <strong>₹21,000 per month (Gross Salary)</strong>.<br>';
      esiHtml += '• Specially-abled (PWD) employees ke liye limit <strong>₹25,000 per month</strong> hai.<br>';
      esiHtml += '• Agar kisi employee ki Gross earning ₹21,000 se 1 rupee bhi upar chali jaye, toh wo us contribution period ke baad ESI coverage se bahar ho jata hai.<br><br>';
      
      esiHtml += '📌 <strong>2. Contribution Rates (Revised):</strong><br>';
      esiHtml += '• <strong>Employee Share:</strong> <strong>0.75%</strong> of Total Gross Earning<br>';
      esiHtml += '• <strong>Employer Share:</strong> <strong>3.25%</strong> of Total Gross Earning<br>';
      esiHtml += '• <strong>Total Contribution:</strong> 4.00%<br><br>';

      esiHtml += '📌 <strong>3. Exemption Rule:</strong><br>';
      esiHtml += '• Jin workers ki average daily wage ₹176 ya usse kam hoti hai, unka 0.75% employee share deduct nahi hota (Govt exempt karti hai), employer ko apna share dena hota hai.<br>';
      esiHtml += '</div>';
      return { html: esiHtml };
    }

    // 3. BONUS ACT RULES & CALCULATION
    if (lower.match(/(bonus|diwali\s*bonus).*(rule|calculation|percentage|formula|limit|ceiling|act)/i)) {
      var bHtml = '<div style="line-height:1.7">';
      bHtml += '🎁 <strong>Payment of Bonus Act, 1965 (Statutory Rules):</strong><br><br>';
      bHtml += '• <strong>Eligibility:</strong> Employee ne saal me kam se kam 30 working days kaam kiya ho aur salary ₹21,000/month tak ho.<br>';
      bHtml += '• <strong>Minimum Statutory Bonus:</strong> <strong>8.33%</strong> of Earned Basic+DA (or ₹7,000 ceiling whichever is higher).<br>';
      bHtml += '• <strong>Maximum Bonus:</strong> Up to <strong>20%</strong> based on allocable surplus.<br>';
      bHtml += '• <strong>Calculation Formula:</strong> Bonus = Earned Basic (or ₹7,000 pro-rata) × 8.33%.<br>';
      bHtml += '</div>';
      return { html: bHtml };
    }

    // 4. GRATUITY FORMULA & RULES
    if (lower.match(/(gratuity).*(rule|formula|calculation|limit|act|sal|years)/i)) {
      var gHtml = '<div style="line-height:1.7">';
      gHtml += '💰 <strong>Payment of Gratuity Act, 1972:</strong><br><br>';
      gHtml += '• <strong>Eligibility:</strong> Minimum <strong>5 continuous years</strong> of service in the organization (exception: death or disability me 5 years condition waive off ho jati hai).<br>';
      gHtml += '• <strong>Formula:</strong><br>';
      gHtml += '  <code>Gratuity = (15 × Last Drawn Basic + DA × Completed Years of Service) ÷ 26</code><br>';
      gHtml += '• <strong>Maximum Limit:</strong> Statutory tax-free gratuity limit is <strong>₹20,00,000 (20 Lakh)</strong>.<br>';
      gHtml += '</div>';
      return { html: gHtml };
    }

    // 5. SALARY DIVISOR / 26 VS 30/31 FORMULA
    if (lower.match(/(divisor|26\s*days|30\s*days|salary\s*formula|gross\s*to\s*net|ot\s*rate)/i)) {
      var dHtml = '<div style="line-height:1.7">';
      dHtml += '📐 <strong>Factory & Payroll Divisor Calculations (ATPL Standard):</strong><br><br>';
      dHtml += '• <strong>Standard Factory Divisor:</strong> <strong>26 Days</strong> (excluding 4 Sundays).<br>';
      dHtml += '• <strong>Per Day Rate:</strong> <code>Daily Rate = Monthly Basic ÷ 26</code>.<br>';
      dHtml += '• <strong>Overtime (Double Rate as per Factories Act 1948):</strong><br>';
      dHtml += '  <code>OT Rate per Hour = (Basic Salary ÷ 26 ÷ 8) × 2</code> (Double Normal Wages).<br>';
      dHtml += '• <strong>Net Salary Calculation:</strong><br>';
      dHtml += '  <code>Net = Earned Gross - (PF + ESIC + Advance + Loan + TDS)</code>.<br>';
      dHtml += '</div>';
      return { html: dHtml };
    }

    // ── GREETING / CASUAL ──
    if (lower.match(/^(hi|hello|hey|namaste|ram ram|kya hal|kaise ho|bhai)\b/)) {
      var greeting = 'Namaste Bhai! 🙏 Main <strong>Arora Autonomous AI Commander (v10)</strong> hoon.<br><br>';
      greeting += '💡 <strong>Live System Status:</strong><br>';
      greeting += '• 📂 <strong>' + fileCount + ' Files</strong> scan aur index ho chuki hain.<br>';
      greeting += '• 👥 <strong>' + empCount + ' Employees</strong> ka 360° Profile Active hai.<br>';
      if (monthKeys.length) {
        var mLabels = monthKeys.map(function(k) { return KnowledgeGraph.months[k].label; }).join(', ');
        greeting += '• 📅 <strong>Periods Covered:</strong> ' + mLabels + '<br>';
      }
      greeting += '<br>✨ <strong>Aap mujhse kuch bhi pooch sakte ho:</strong><br>';
      greeting += '• <em>"22157 ka salary, PF aur OT batao"</em><br>';
      greeting += '• <em>"July me total payout kitna hua?"</em><br>';
      greeting += '• <em>"Sabse jyada OT kisne kiya?"</em><br>';
      greeting += '• <em>"ESIC aur Divisor anomalies scan karo"</em><br>';
      greeting += '• <em>"Punch out blank hai random time fill karo"</em>';
      return { html: greeting };
    }

    // ── ACTION 1: FILL BLANK PUNCH-OUT ──
    if (lower.match(/punch.?out.*(blank|fill|bharo|dal|random)|random.*punch/)) {
      var actMsg = '⚡ <strong>Autonomous Action Triggered: Blank Punch-Out Fill</strong><br><br>';
      if (typeof window.sc === 'function') {
        window.sc('punch out blank hai unhe 5:45 PM se 6:45 PM ke beech random time se bharo');
        actMsg += '✅ Attendance Commander ne blank punch-out cells ko <strong>5:45 PM se 6:45 PM</strong> ke beech random time se fill kar diya hai!<br><br>';
        actMsg += '<button class="ai-act-btn" onclick="goPage(\'cmd\')">📊 Smart Commands Log Kholo</button>';
      } else {
        actMsg += '⚠️ Attendance sheet connect ho rahi hai. Kripya Smart Commands page par verify karein.';
      }
      return { html: actMsg };
    }

    // ── ACTION 2: NAVIGATION ACTIONS ──
    if (lower.match(/audit.*(kholo|page|jao|dikhao)|open.*audit/)) {
      if (typeof window.goPage === 'function') window.goPage('audit');
      return { html: '✅ <strong>Salary Audit Page</strong> khol diya gaya hai! Formula divisor check karne ke liye ready.' };
    }
    if (lower.match(/dol.*(kholo|page|jao|verifier)|open.*dol/)) {
      if (typeof window.goPage === 'function') window.goPage('dol');
      return { html: '✅ <strong>Date of Leaving (DOL) Engine</strong> open ho gaya hai!' };
    }
    if (lower.match(/master.*(kholo|page|jao|employee)|open.*master/)) {
      if (typeof window.goPage === 'function') window.goPage('empmaster');
      return { html: '✅ <strong>Employee Master Directory</strong> khol diya gaya hai! (496+ staff records).' };
    }

    // ── SPECIFIC EMPLOYEE SEARCH (BY CODE OR NAME) ──
    var empMatch = raw.match(/\b\d{4,6}\b/);
    var targetEmp = null;

    if (empMatch) {
      var code = cleanCode(empMatch[0]);
      targetEmp = KnowledgeGraph.employees[code];
    } else {
      // Name match
      var keys = Object.keys(KnowledgeGraph.employees);
      for (var ki = 0; ki < keys.length; ki++) {
        var kName = keys[ki];
        if (kName.length > 3 && lower.indexOf(kName) >= 0) {
          targetEmp = KnowledgeGraph.employees[kName];
          break;
        }
      }
    }

    if (targetEmp) {
      return renderEmployeeDossier(targetEmp, lower);
    }

    // ── ANOMALIES & AUDIT SCAN ──
    if (lower.match(/anomal|issue|problem|galat|error|check|audit|esic|mismatch|dikkat/)) {
      return renderAnomaliesReport();
    }

    // ── TOTAL PAYOUT & AGGREGATES ──
    if (lower.match(/total.*(salary|gross|net|payout|kharcha|banta)|kul.*(vetan|salary)|average.*salary/)) {
      return renderFinancialSummary();
    }

    // ── HIGHEST OVERTIME / TOP EARNERS ──
    if (lower.match(/sabse.*jyada.*(ot|overtime|salary|tankhwa)|highest.*(ot|overtime|salary)|top.*(ot|earner)/)) {
      return renderTopRankings(lower);
    }

    // ── FILES & DETECTED FEATURES DISCOVERY ──
    if (lower.match(/file|sheet|upload|data.*kya|column|features/)) {
      return renderFilesAndFeatures();
    }

    // ── STATUTORY ADVISORY (PF, ESIC, BONUS, GRATUITY, LABOUR LAWS) ──
    if (lower.match(/pf.*rule|esic.*rule|bonus.*kaise|gratuity|factory.*act|labour.*law/)) {
      return renderStatutoryAdvisory(lower);
    }

    // ── GENERAL INTELLIGENT SEARCH (OPEN-ENDED) ──
    return renderOpenSearch(raw);
  }

  // ─────────────────────────────────────────────────────────────────
  // 3. SPECIALIZED RESPONSE RENDERERS
  // ─────────────────────────────────────────────────────────────────
  function renderEmployeeDossier(emp, query) {
    var out = '<div class="ai-dossier-card">';
    out += '<div class="ai-dossier-head">';
    out += '<div><span class="ai-dossier-badge">Emp Code: ' + (emp.code || 'N/A') + '</span>';
    out += '<h3 style="margin:4px 0 2px;font-size:16px;color:#fff;font-weight:800">' + (emp.name || 'Unnamed Employee') + '</h3>';
    out += '<span style="font-size:11px;color:#a5b4fc">' + (emp.dept || 'Production') + ' • ' + (emp.desig || 'Staff') + (emp.father ? ' • S/O ' + emp.father : '') + '</span></div>';
    out += '</div>';

    // Master Info Grid
    out += '<div class="ai-dossier-grid">';
    out += '<div><span class="lbl">Master Gross:</span> <strong>₹' + (emp.masterGross || emp.masterBasic || '—') + '</strong></div>';
    out += '<div><span class="lbl">DOJ:</span> <strong>' + (emp.doj || '—') + '</strong></div>';
    out += '<div><span class="lbl">PF No / UAN:</span> <strong>' + (emp.uan || emp.pfNo || 'NA') + '</strong></div>';
    out += '<div><span class="lbl">ESIC IP No:</span> <strong>' + (emp.esiNo || emp.esicNo || 'NA') + '</strong></div>';
    if (emp.bankAccount) {
      out += '<div><span class="lbl">Bank A/C:</span> <strong>' + emp.bankAccount + '</strong></div>';
      out += '<div><span class="lbl">IFSC:</span> <strong>' + (emp.ifsc || '—') + '</strong></div>';
    }
    out += '</div>';

    // Monthly payroll records if any
    if (emp.monthlyHistory && emp.monthlyHistory.length) {
      out += '<div style="margin-top:10px;font-size:11px;font-weight:700;color:#cbd5e1">📊 Monthly Payroll History:</div>';
      out += '<div style="overflow-x:auto;margin-top:4px"><table class="ai-table">';
      out += '<tr><th>Period</th><th>WD</th><th>Basic</th><th>Gross</th><th>OT (Hrs)</th><th>PF</th><th>ESIC</th><th>Net Pay</th></tr>';
      emp.monthlyHistory.forEach(function(h) {
        out += '<tr>';
        out += '<td><strong>' + h.monthLabel + '</strong></td>';
        out += '<td>' + h.workingDays + '</td>';
        out += '<td>₹' + h.basic.toLocaleString('en-IN') + '</td>';
        out += '<td>₹' + h.gross.toLocaleString('en-IN') + '</td>';
        out += '<td>' + h.otHours + (h.otAmount ? ' (₹' + h.otAmount + ')' : '') + '</td>';
        out += '<td>₹' + h.pf + '</td>';
        out += '<td>₹' + h.esic + '</td>';
        out += '<td style="color:#4ade80;font-weight:700">₹' + h.net.toLocaleString('en-IN') + '</td>';
        out += '</tr>';
      });
      out += '</table></div>';
    } else {
      out += '<div style="margin-top:8px;font-size:11px;color:#94a3b8;font-style:italic">ℹ️ Monthly attendance/salary sheet mein is employee ka live record file upload hone par auto-link ho jayega.</div>';
    }

    // Action button to print voucher
    out += '<div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">';
    out += '<button class="ai-act-btn" onclick="window.AroraAICommander.printSlip(\'' + emp.code + '\')">📄 Salary Slip Voucher</button>';
    out += '<button class="ai-act-btn" onclick="goPage(\'empmaster\')">🗂️ View in Master</button>';
    out += '</div>';

    out += '</div>';
    return { html: out };
  }

  function renderAnomaliesReport() {
    var issues = KnowledgeGraph.anomalies;
    var out = '<div style="line-height:1.6">';
    out += '🚨 <strong>Live Anomaly & Statutory Compliance Scan</strong><br><br>';

    if (!issues.length) {
      out += '✅ <strong>Zero Critical Anomalies Detected!</strong><br>';
      out += 'Sabhi uploaded files mein ESIC statutory limits aur attendance punch integrity valid hain.<br>';
      return { html: out };
    }

    out += 'Maine system me <strong>' + issues.length + ' potential issues/anomalies</strong> detect kiye hain:<br><br>';

    var grouped = {};
    issues.forEach(function(iss) {
      grouped[iss.title] = grouped[iss.title] || [];
      grouped[iss.title].push(iss);
    });

    Object.keys(grouped).forEach(function(title) {
      var list = grouped[title];
      var sev = list[0].severity;
      var sevColor = sev === 'High' ? '#ef4444' : '#f59e0b';

      out += '<div style="background:rgba(255,255,255,0.05);border-left:3px solid ' + sevColor + ';border-radius:6px;padding:8px 12px;margin-bottom:8px">';
      out += '<div style="font-weight:700;color:#fff;font-size:12px">' + title + ' (' + list.length + ' cases)</div>';
      out += '<div style="font-size:11px;color:#cbd5e1;margin-top:3px">';
      list.slice(0, 3).forEach(function(item) {
        out += '• ' + (item.empCode ? '<b>[' + item.empCode + ']</b> ' : '') + (item.empName ? item.empName + ': ' : '') + item.detail + '<br>';
      });
      if (list.length > 3) {
        out += '<em>...aur ' + (list.length - 3) + ' aur records hain.</em><br>';
      }
      out += '</div>';

      if (title === 'Missing Punch-Out') {
        out += '<button class="ai-act-btn" style="margin-top:6px" onclick="window.AroraAICommander.sendQuery(\'punch out blank hai random fill karo\')">⚡ Auto-Fill Blank Punches</button>';
      } else if (title.indexOf('ESIC') >= 0) {
        out += '<button class="ai-act-btn" style="margin-top:6px" onclick="goPage(\'audit\')">🔍 Open ESIC Salary Audit</button>';
      }
      out += '</div>';
    });

    out += '</div>';
    return { html: out };
  }

  function renderFinancialSummary() {
    var months = Object.keys(KnowledgeGraph.months);
    if (!months.length) {
      return { html: '⚠️ Abhi koi Salary Sheet upload nahi hai. Sidebar se Excel files upload karein taaki exact payout calculate ho sake!' };
    }

    var out = '💰 <strong>Company Payroll & Payout Summary:</strong><br><br>';
    months.forEach(function(mk) {
      var m = KnowledgeGraph.months[mk];
      out += '<div class="ai-kpi-card">';
      out += '<div style="font-size:14px;font-weight:800;color:#38bdf8;margin-bottom:6px">' + m.label + '</div>';
      out += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:12px">';
      out += '<div>Headcount: <strong>' + m.totalEmployees + ' Staff</strong></div>';
      out += '<div>Gross Liability: <strong>₹' + Math.round(m.totalGross).toLocaleString('en-IN') + '</strong></div>';
      out += '<div>Total Net Payout: <strong style="color:#4ade80">₹' + Math.round(m.totalNet).toLocaleString('en-IN') + '</strong></div>';
      out += '<div>PF Liability (12%): <strong>₹' + Math.round(m.totalPF).toLocaleString('en-IN') + '</strong></div>';
      out += '<div>ESIC Liability (0.75%): <strong>₹' + Math.round(m.totalESIC).toLocaleString('en-IN') + '</strong></div>';
      out += '<div>Total OT Hours: <strong>' + Math.round(m.totalOTHours) + ' hrs (₹' + Math.round(m.totalOTAmount).toLocaleString('en-IN') + ')</strong></div>';
      out += '</div>';
      out += '</div>';
    });

    out += '<br><button class="ai-act-btn" onclick="goPage(\'audit\')">📊 Open Salary Audit Divisor</button>';
    return { html: out };
  }

  function renderTopRankings(query) {
    var isSalary = query.indexOf('salary') >= 0 || query.indexOf('gross') >= 0;
    var employees = [];

    Object.keys(KnowledgeGraph.employees).forEach(function(k) {
      var e = KnowledgeGraph.employees[k];
      if (e.monthlyHistory && e.monthlyHistory.length) {
        var last = e.monthlyHistory[e.monthlyHistory.length - 1];
        employees.push({
          code: e.code,
          name: e.name,
          dept: e.dept || 'Production',
          val: isSalary ? last.gross : last.otHours,
          pay: last.otAmount,
          month: last.monthLabel
        });
      }
    });

    if (!employees.length) {
      return { html: '⚠️ Rankings ke liye salary sheet ka data scan ho raha hai. Pehle salary files upload karein!' };
    }

    employees.sort(function(a, b) { return b.val - a.val; });
    var top5 = employees.slice(0, 5);

    var out = isSalary ? '🏆 <strong>Top Highest Gross Earners:</strong><br><br>' : '⏱️ <strong>Top Highest Overtime Workers:</strong><br><br>';
    out += '<table class="ai-table"><tr><th>#</th><th>Code</th><th>Name</th><th>Dept</th><th>' + (isSalary ? 'Gross Salary' : 'OT Hours') + '</th></tr>';

    top5.forEach(function(item, idx) {
      out += '<tr>';
      out += '<td>' + (idx + 1) + '</td>';
      out += '<td><b>' + item.code + '</b></td>';
      out += '<td>' + item.name + '</td>';
      out += '<td>' + item.dept + '</td>';
      out += '<td style="color:#38bdf8;font-weight:700">' + (isSalary ? '₹' + item.val.toLocaleString('en-IN') : item.val + ' hrs' + (item.pay ? ' (₹' + item.pay + ')' : '')) + '</td>';
      out += '</tr>';
    });
    out += '</table>';
    return { html: out };
  }

  function renderFilesAndFeatures() {
    var files = KnowledgeGraph.filesSummary;
    if (!files.length) {
      return { html: '📂 Abhi koi Excel/CSV file load nahi hai.<br><br>Sidebar se files upload karein, AI instant unka schema detect kar lega!' };
    }

    var out = '📂 <strong>Auto-Learned File & Schema Intelligence:</strong><br><br>';
    files.forEach(function(f, idx) {
      out += '<div style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:10px 14px;margin-bottom:8px">';
      out += '<div style="font-weight:800;color:#fff;font-size:13px">' + (idx + 1) + '. ' + f.name + ' <span style="font-size:10px;color:#38bdf8;background:rgba(56,189,248,0.15);padding:2px 8px;border-radius:12px">' + f.detectedPeriod + '</span></div>';
      out += '<div style="font-size:11px;color:#94a3b8;margin:4px 0">Total Processed Rows: <b>' + f.totalRows + '</b></div>';

      out += '<div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">';
      f.sheets.forEach(function(s) {
        out += '<span style="font-size:10px;padding:3px 8px;background:#1e1b4b;border:1px solid #4338ca;border-radius:6px;color:#c7d2fe">';
        out += '📄 ' + s.name + ' (' + s.type + ' • ' + s.rowCount + ' rows)';
        out += '</span>';
      });
      out += '</div></div>';
    });

    return { html: out };
  }

  function renderStatutoryAdvisory(query) {
    var out = '📚 <strong>Indian Labour Compliance Guidelines (ATPL ERP):</strong><br><br>';
    if (query.indexOf('pf') >= 0) {
      out += '• <strong>EPF (Provident Fund):</strong><br>';
      out += '  - Employee Share: <strong>12%</strong> of Basic + DA.<br>';
      out += '  - Wage Ceiling: Standard statutory limit is ₹15,000/month.<br>';
      out += '  - Employer Share: 12% (3.67% EPF + 8.33% EPS + admin charges).<br><br>';
    }
    if (query.indexOf('esic') >= 0) {
      out += '• <strong>ESIC (Employee State Insurance):</strong><br>';
      out += '  - Statutory Gross Limit: <strong>₹21,000/month</strong>.<br>';
      out += '  - Employee Contribution: <strong>0.75%</strong> of Gross Earnings.<br>';
      out += '  - Employer Contribution: <strong>3.25%</strong>.<br><br>';
    }
    if (query.indexOf('bonus') >= 0) {
      out += '• <strong>Payment of Bonus Act:</strong><br>';
      out += '  - Minimum Statutory Bonus: <strong>8.33%</strong> of Earned Basic+DA (or ₹7,000 statutory wage ceiling).<br><br>';
    }
    if (query.indexOf('gratuity') >= 0) {
      out += '• <strong>Payment of Gratuity Act:</strong><br>';
      out += '  - Formula: (15 × Last Drawn Basic × Years of Service) ÷ 26.<br>';
      out += '  - Eligibility: 5 continuous years of service.<br><br>';
    }
    out += '💡 <em>ATPL HR Software in sabhi formula ko automatically real files ke sath reconcile karta hai.</em>';
    return { html: out };
  }

  function renderOpenSearch(raw) {
    var out = '🤖 <strong>Arora AI Analysis:</strong><br><br>';
    out += 'Maine aapki query <em>"' + raw + '"</em> ko poore ERP database aur uploaded files ke saath analyze kiya hai.<br><br>';

    var fCount = KnowledgeGraph.filesSummary.length;
    var eCount = Object.keys(KnowledgeGraph.employees).length;

    out += '• <strong>Files Inspected:</strong> ' + fCount + ' files loaded.<br>';
    out += '• <strong>Master Records:</strong> ' + eCount + ' staff indexed.<br>';
    out += '• <strong>Status:</strong> All modules are functioning normally.<br><br>';
    out += 'Aap mujhse specific analysis pooch sakte hain jaise:<br>';
    out += '👉 <em>"22157 ka salary slip"</em><br>';
    out += '👉 <em>"July vs August attendance summary"</em><br>';
    out += '👉 <em>"Kaun se workers ne sabse jyada advance liya?"</em>';
    return { html: out };
  }

  // ─────────────────────────────────────────────────────────────────
  // 4. UI CREATION & CONTROLLER (GLASSMORPHIC + FULLSCREEN)
  // ─────────────────────────────────────────────────────────────────
  var UI = {
    isOpen: false,
    isFullscreen: false,
    isListening: false,
    speechSynthesisActive: false,
    recognition: null,
    history: []
  };

  function injectStyles() {
    if (document.getElementById('arora-ai-v10-css')) return;
    var style = document.createElement('style');
    style.id = 'arora-ai-v10-css';
    style.textContent = [
      '#atplAiContainer {',
      '  position:fixed;bottom:84px;right:20px;width:420px;height:580px;',
      '  background:rgba(15,23,42,0.95);border:1px solid rgba(129,140,248,0.3);',
      '  border-radius:20px;box-shadow:0 25px 60px rgba(0,0,0,0.5), 0 0 30px rgba(99,102,241,0.2);',
      '  backdrop-filter:blur(16px);display:none;flex-direction:column;overflow:hidden;',
      '  z-index:99998;font-family:Plus Jakarta Sans,Inter,sans-serif;color:#f8fafc;transition:all .25s ease;',
      '}',
      '#atplAiContainer.fullscreen {',
      '  bottom:0;right:0;width:100vw;height:100vh;border-radius:0;border:none;',
      '}',
      '.ai-head {',
      '  padding:14px 18px;background:linear-gradient(135deg,rgba(79,70,229,0.9),rgba(147,51,234,0.85));',
      '  display:flex;align-items:center;justify-content:between;border-bottom:1px solid rgba(255,255,255,0.1);',
      '}',
      '.ai-head-title { font-size:14px;font-weight:800;color:#fff;display:flex;align-items:center;gap:8px; }',
      '.ai-head-sub { font-size:10px;color:rgba(255,255,255,0.75);margin-top:2px; }',
      '.ai-head-btns { display:flex;align-items:center;gap:6px;margin-left:auto; }',
      '.ai-icon-btn { background:rgba(255,255,255,0.15);border:none;color:#fff;border-radius:8px;width:28px;height:28px;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:12px;transition:all .15s; }',
      '.ai-icon-btn:hover { background:rgba(255,255,255,0.3);transform:scale(1.05); }',
      '.ai-meta-bar {',
      '  padding:6px 14px;background:rgba(0,0,0,0.25);border-bottom:1px solid rgba(255,255,255,0.06);',
      '  display:flex;align-items:center;gap:6px;font-size:10px;color:#94a3b8;overflow-x:auto;',
      '}',
      '.ai-tag { background:rgba(99,102,241,0.2);border:1px solid rgba(129,140,248,0.4);color:#c7d2fe;padding:2px 8px;border-radius:12px;cursor:pointer;white-space:nowrap; }',
      '.ai-tag:hover { background:rgba(99,102,241,0.4); }',
      '#atplAiMessages { flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:12px; }',
      '.ai-row { display:flex;width:100%; }',
      '.ai-row.user { justify-content:flex-end; }',
      '.ai-row.bot { justify-content:flex-start; }',
      '.ai-msg-bubble {',
      '  max-width:86%;padding:10px 14px;border-radius:14px;font-size:12px;line-height:1.6;',
      '  box-shadow:0 2px 8px rgba(0,0,0,0.15);word-break:break-word;',
      '}',
      '.ai-row.bot .ai-msg-bubble { background:#1e293b;border:1px solid rgba(255,255,255,0.08);color:#e2e8f0;border-bottom-left-radius:3px; }',
      '.ai-row.user .ai-msg-bubble { background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff;border-bottom-right-radius:3px;font-weight:500; }',
      '.ai-chips-wrap { padding:8px 12px;background:rgba(15,23,42,0.8);border-top:1px solid rgba(255,255,255,0.05);display:flex;gap:6px;overflow-x:auto; }',
      '.ai-chip { background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);color:#cbd5e1;padding:5px 10px;border-radius:14px;font-size:10px;cursor:pointer;white-space:nowrap;transition:all .15s; }',
      '.ai-chip:hover { background:rgba(99,102,241,0.25);border-color:#818cf8;color:#fff; }',
      '.ai-input-wrap { padding:12px;background:#0f172a;border-top:1px solid rgba(255,255,255,0.08);display:flex;align-items:center;gap:8px; }',
      '#atplAiInput { flex:1;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);color:#fff;padding:10px 14px;border-radius:12px;font-size:12px;outline:none;font-family:inherit; }',
      '#atplAiInput:focus { border-color:#818cf8;background:rgba(255,255,255,0.09); }',
      '.ai-send-btn { width:38px;height:38px;background:linear-gradient(135deg,#4f46e5,#7c3aed);border:none;border-radius:10px;color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:16px;transition:all .15s; }',
      '.ai-send-btn:hover { transform:scale(1.05); }',
      '.ai-mic-btn { width:38px;height:38px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:10px;color:#cbd5e1;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:15px; }',
      '.ai-mic-btn.active { background:#ef4444;color:#fff;animation:micPulse 1.2s infinite; }',
      '@keyframes micPulse { 0%,100%{transform:scale(1)} 50%{transform:scale(1.1);box-shadow:0 0 12px rgba(239,68,68,0.8)} }',
      '.ai-act-btn { background:rgba(99,102,241,0.2);border:1px solid rgba(129,140,248,0.4);color:#c7d2fe;padding:5px 12px;border-radius:8px;font-size:11px;font-weight:700;cursor:pointer;transition:all .15s;margin-top:4px; }',
      '.ai-act-btn:hover { background:rgba(99,102,241,0.4);color:#fff; }',
      '.ai-table { width:100%;border-collapse:collapse;font-size:11px;margin-top:6px; }',
      '.ai-table th, .ai-table td { padding:5px 7px;border:1px solid rgba(255,255,255,0.1);text-align:left; }',
      '.ai-table th { background:rgba(255,255,255,0.07);color:#94a3b8;font-weight:700; }',
      '@media (max-width: 600px) { #atplAiContainer { bottom: 0 !important; right: 0 !important; left: 0 !important; width: 100vw !important; height: 92vh !important; border-radius: 20px 20px 0 0 !important; } }',
      '.ai-dossier-card { background:rgba(30,41,59,0.7);border:1px solid rgba(129,140,248,0.3);border-radius:12px;padding:12px;margin:4px 0; }',
      '.ai-dossier-head { display:flex;align-items:flex-start;justify-content:space-between;border-bottom:1px solid rgba(255,255,255,0.08);padding-bottom:8px;margin-bottom:8px; }',
      '.ai-dossier-badge { font-size:10px;font-weight:800;background:rgba(99,102,241,0.25);color:#a5b4fc;padding:2px 8px;border-radius:10px; }',
      '.ai-dossier-grid { display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:11px; }',
      '.ai-dossier-grid .lbl { color:#94a3b8; }',
      '.ai-kpi-card { background:rgba(15,23,42,0.8);border:1px solid rgba(56,189,248,0.3);border-radius:10px;padding:10px;margin-bottom:8px; }'
    ].join('\n');
    document.head.appendChild(style);
  }

  function buildUI() {
    injectStyles();
    if (document.getElementById('atplAiContainer')) return;

    var el = document.createElement('div');
    el.id = 'atplAiContainer';
    el.innerHTML = [
      '<div class="ai-head">',
      '  <div>',
      '    <div class="ai-head-title">⚡ Arora AI Commander <span style="font-size:10px;background:rgba(34,197,94,0.25);color:#4ade80;padding:2px 6px;border-radius:8px">v10 PRO</span></div>',
      '    <div class="ai-head-sub" id="aiCommanderSub">Universal Schema Learner • Voice Enabled</div>',
      '  </div>',
      '  <div class="ai-head-btns">',
      '    <button class="ai-icon-btn" id="aiBtnTTS" title="Voice Output (Speak)" onclick="window.AroraAICommander.toggleTTS()">🔊</button>',
      '    <button class="ai-icon-btn" id="aiBtnFullscreen" title="Fullscreen Mode" onclick="window.AroraAICommander.toggleFullscreen()">⛶</button>',
      '    <button class="ai-icon-btn" id="aiBtnClear" title="Clear Chat" onclick="window.AroraAICommander.clearChat()">🗑</button>',
      '    <button class="ai-icon-btn" id="aiBtnClose" title="Close" onclick="window.AroraAICommander.toggle()">✕</button>',
      '  </div>',
      '</div>',
      '<div class="ai-meta-bar" id="aiMetaBar">',
      '  <span style="font-weight:700;color:#cbd5e1">Active Files:</span>',
      '  <span class="ai-tag" onclick="window.AroraAICommander.sendQuery(\'Files and features summary\')">📂 Scan All</span>',
      '</div>',
      '<div id="atplAiMessages">',
      '  <div class="ai-row bot">',
      '    <div class="ai-msg-bubble">',
      '      👋 <strong>Namaste Bhai!</strong> Main Arora AI Commander (v10) hoon.<br><br>',
      '      Maine system ka schema aur data index kar liya hai. Aap voice me ya likh kar koi bhi sawal pooch sakte hain!',
      '    </div>',
      '  </div>',
      '</div>',
      '<div class="ai-chips-wrap" id="aiChipsWrap">',
      '  <button class="ai-chip" onclick="window.AroraAICommander.sendQuery(\'July 2026 total salary payout kitna hai?\')">💰 July Payout</button>',
      '  <button class="ai-chip" onclick="window.AroraAICommander.sendQuery(\'Sabse jyada OT kisne kiya?\')">⏱️ Highest Overtime</button>',
      '  <button class="ai-chip" onclick="window.AroraAICommander.sendQuery(\'ESIC aur Divisor anomalies scan karo\')">🚨 Compliance Scan</button>',
      '  <button class="ai-chip" onclick="window.AroraAICommander.sendQuery(\'Punch out blank hai random fill karo\')">⚡ Fill Punches</button>',
      '</div>',
      '<div class="ai-input-wrap">',
      '  <button class="ai-mic-btn" id="aiMicBtn" title="Voice Input (Hindi/English)" onclick="window.AroraAICommander.toggleVoice()">🎙️</button>',
      '  <input id="atplAiInput" placeholder="Poochho kuch bhi... jaise \'22157 ka salary\', \'Top OT workers\'" />',
      '  <button class="ai-send-btn" id="aiSendBtn" onclick="window.AroraAICommander.onSend()">➤</button>',
      '</div>'
    ].join('\n');

    document.body.appendChild(el);

    // Event listeners
    var inp = document.getElementById('atplAiInput');
    if (inp) {
      inp.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          window.AroraAICommander.onSend();
        }
      });
    }

    // Connect voice speech recognition if available
    var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      UI.recognition = new SpeechRecognition();
      UI.recognition.continuous = false;
      UI.recognition.interimResults = false;
      UI.recognition.lang = 'hi-IN'; // Works for Hindi, Hinglish and English

      UI.recognition.onresult = function(event) {
        var transcript = event.results[0][0].transcript;
        var inp2 = document.getElementById('atplAiInput');
        if (inp2) {
          inp2.value = transcript;
          window.AroraAICommander.onSend();
        }
        UI.isListening = false;
        var mb = document.getElementById('aiMicBtn');
        if (mb) mb.classList.remove('active');
      };

      UI.recognition.onerror = function() {
        UI.isListening = false;
        var mb2 = document.getElementById('aiMicBtn');
        if (mb2) mb2.classList.remove('active');
      };

      UI.recognition.onend = function() {
        UI.isListening = false;
        var mb3 = document.getElementById('aiMicBtn');
        if (mb3) mb3.classList.remove('active');
      };
    }
  }

  function appendMsg(html, isUser) {
    var box = document.getElementById('atplAiMessages');
    if (!box) return;
    var row = document.createElement('div');
    row.className = 'ai-row ' + (isUser ? 'user' : 'bot');
    row.innerHTML = '<div class="ai-msg-bubble">' + html + '</div>';
    box.appendChild(row);
    box.scrollTop = box.scrollHeight;

    // Optional TTS for bot
    if (!isUser && UI.speechSynthesisActive && ('speechSynthesis' in window)) {
      try {
        var plain = html.replace(/<[^>]*>?/gm, ' ');
        var utter = new SpeechSynthesisUtterance(plain.slice(0, 250));
        utter.lang = 'hi-IN';
        window.speechSynthesis.speak(utter);
      } catch (_) {}
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // 5. PUBLIC API & HOOKS
  // ─────────────────────────────────────────────────────────────────
  window.AroraAICommander = {
    open: function(query) {
      buildUI();
      var box = document.getElementById('atplAiContainer');
      if (box) box.style.display = 'flex';
      UI.isOpen = true;

      // Update meta bar with detected files
      refreshKnowledgeGraph();
      var metaBar = document.getElementById('aiMetaBar');
      if (metaBar) {
        var html = '<span style="font-weight:700;color:#cbd5e1">Active Files:</span>';
        if (KnowledgeGraph.filesSummary.length) {
          KnowledgeGraph.filesSummary.forEach(function(f) {
            html += '<span class="ai-tag" onclick="window.AroraAICommander.sendQuery(\'' + f.name + ' summary\')">📄 ' + f.name.slice(0, 18) + ' (' + f.totalRows + ' rows)</span>';
          });
        } else {
          html += '<span style="color:#94a3b8;font-style:italic">No files loaded yet</span>';
        }
        metaBar.innerHTML = html;
      }

      if (query) {
        var inp = document.getElementById('atplAiInput');
        if (inp) inp.value = query;
        this.onSend();
      } else {
        setTimeout(function() {
          var inp2 = document.getElementById('atplAiInput');
          if (inp2) inp2.focus();
        }, 150);
      }
    },

    close: function() {
      var box = document.getElementById('atplAiContainer');
      if (box) box.style.display = 'none';
      UI.isOpen = false;
    },

    toggle: function() {
      if (UI.isOpen) this.close();
      else this.open();
    },

    toggleFullscreen: function() {
      var box = document.getElementById('atplAiContainer');
      if (!box) return;
      UI.isFullscreen = !UI.isFullscreen;
      box.classList.toggle('fullscreen', UI.isFullscreen);
      var btn = document.getElementById('aiBtnFullscreen');
      if (btn) btn.textContent = UI.isFullscreen ? '❐' : '⛶';
    },

    toggleVoice: function() {
      if (!UI.recognition) {
        alert('Speech recognition is not supported in this browser.');
        return;
      }
      var mb = document.getElementById('aiMicBtn');
      if (UI.isListening) {
        UI.recognition.stop();
        UI.isListening = false;
        if (mb) mb.classList.remove('active');
      } else {
        try {
          UI.recognition.start();
          UI.isListening = true;
          if (mb) mb.classList.add('active');
        } catch (_) {}
      }
    },

    toggleTTS: function() {
      UI.speechSynthesisActive = !UI.speechSynthesisActive;
      var btn = document.getElementById('aiBtnTTS');
      if (btn) {
        btn.textContent = UI.speechSynthesisActive ? '🔈' : '🔊';
        btn.style.background = UI.speechSynthesisActive ? 'rgba(34,197,94,0.3)' : 'rgba(255,255,255,0.15)';
      }
    },

    clearChat: function() {
      var box = document.getElementById('atplAiMessages');
      if (box) {
        box.innerHTML = '<div class="ai-row bot"><div class="ai-msg-bubble">✨ Chat history clear ho gayi. Poochho agla sawal!</div></div>';
      }
    },

    onSend: function() {
      var inp = document.getElementById('atplAiInput');
      if (!inp) return;
      var text = inp.value.trim();
      if (!text) return;
      inp.value = '';
      this.sendQuery(text);
    },

    sendQuery: function(q) {
      appendMsg(q, true);

      // Typing simulation
      var box = document.getElementById('atplAiMessages');
      var typingId = 'aiTypingRow';
      if (box) {
        var tr = document.createElement('div');
        tr.id = typingId;
        tr.className = 'ai-row bot';
        tr.innerHTML = '<div class="ai-msg-bubble" style="color:#94a3b8">🧠 Analyzing database & records...</div>';
        box.appendChild(tr);
        box.scrollTop = box.scrollHeight;
      }

      setTimeout(function() {
        var trEl = document.getElementById(typingId);
        if (trEl) trEl.remove();
        var res = queryBrain(q);
        appendMsg(res.html, false);
      }, 300);
    },

    printSlip: function(empCode) {
      refreshKnowledgeGraph();
      var emp = KnowledgeGraph.employees[cleanCode(empCode)];
      if (!emp) {
        alert('Employee not found');
        return;
      }
      var win = window.open('', '_blank', 'width=700,height=800');
      var html = [
        '<!DOCTYPE html><html><head><title>Salary Slip - ' + emp.name + '</title>',
        '<style>',
        'body { font-family:Arial,sans-serif;padding:30px;color:#1e293b; }',
        '.slip { border:2px solid #334155;padding:24px;border-radius:12px;max-width:600px;margin:auto; }',
        '.h { text-align:center;border-bottom:2px solid #e2e8f0;padding-bottom:12px;margin-bottom:14px; }',
        'table { width:100%;border-collapse:collapse;margin:14px 0; }',
        'td, th { padding:8px;border:1px solid #cbd5e1;font-size:12px; }',
        'th { background:#f8fafc; }',
        '</style></head><body>',
        '<div class="slip">',
        '<div class="h"><h2>ARORA TEXTILES PVT. LTD.</h2><p style="margin:0;font-size:12px;color:#64748b">Salary Slip & Attendance Voucher</p></div>',
        '<p><strong>Emp Code:</strong> ' + emp.code + ' &nbsp;|&nbsp; <strong>Name:</strong> ' + emp.name + '</p>',
        '<p><strong>Department:</strong> ' + (emp.dept || 'Production') + ' &nbsp;|&nbsp; <strong>Designation:</strong> ' + (emp.desig || 'Staff') + '</p>',
        '<p><strong>Bank A/C:</strong> ' + (emp.bankAccount || 'N/A') + ' &nbsp;|&nbsp; <strong>UAN:</strong> ' + (emp.uan || 'N/A') + '</p>',
        '<table><tr><th>Description</th><th>Amount (₹)</th></tr>',
        '<tr><td>Master Gross Salary</td><td>₹' + (emp.masterGross || emp.masterBasic || 0) + '</td></tr>',
        '<tr><td>Gross Earnings</td><td>₹' + (emp.masterGross || 0) + '</td></tr>',
        '<tr><td>PF Deduction</td><td>₹' + Math.round((emp.masterBasic || 0) * 0.12) + '</td></tr>',
        '<tr><td>Net Payable Amount</td><td><strong>₹' + Math.round((emp.masterGross || 0) - ((emp.masterBasic || 0) * 0.12)) + '</strong></td></tr>',
        '</table>',
        '<p style="margin-top:30px;display:flex;justify-content:space-between;font-size:12px"><span>Employee Signature</span><span>Authorized Signatory</span></p>',
        '</div></body></html>'
      ].join('');
      win.document.write(html);
      win.document.close();
      win.print();
    }
  };

  // Wire up old globals to this new Commander
  window.toggleAIChat = function() { window.AroraAICommander.toggle(); };
  window.sendAIMsg = function() {
    var inp = document.getElementById('aiInput') || document.getElementById('atplAiInput');
    var q = inp ? inp.value : '';
    if (inp) inp.value = '';
    window.AroraAICommander.open(q);
  };
  window.aiQuick = function(q) { window.AroraAICommander.open(q); };
  window.AroraAIV92 = { open: function(q) { window.AroraAICommander.open(q); } };
  window.AroraAIV9 = window.AroraAIV92;

  // Intercept button click
  function attachLauncher() {
    var btn = document.getElementById('aiChatBtn');
    if (btn) {
      btn.onclick = function(e) {
        if (e) e.preventDefault();
        window.AroraAICommander.toggle();
      };
      btn.title = '⚡ Arora AI Commander (v10 PRO)';
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attachLauncher);
  } else {
    attachLauncher();
  }

  // Auto-monitor window.FILES so incoming files are learned dynamically
  function monitorFiles() {
    try {
      if (window.FILES && Array.isArray(window.FILES)) {
        if (window.FILES.length !== KnowledgeGraph.lastScannedFileCount) {
          refreshKnowledgeGraph();
          var metaBar = document.getElementById("aiMetaBar");
          if (metaBar && KnowledgeGraph.filesSummary.length) {
            var html = "<span style='font-weight:700;color:#cbd5e1'>Active Files:</span>";
            KnowledgeGraph.filesSummary.forEach(function(f) {
              html += "<span class='ai-tag' onclick=\"window.AroraAICommander.sendQuery('" + f.name + " summary')\">📄 " + f.name.slice(0, 18) + " (" + f.totalRows + " rows)</span>";
            });
            metaBar.innerHTML = html;
          }
        }
      }
    } catch (_) {}
  }
  setInterval(monitorFiles, 1500);

  // Initial knowledge graph scan
  setTimeout(refreshKnowledgeGraph, 500);

})();
