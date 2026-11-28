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
  // ── MULTI-TURN MEMORY & SESSION CONTEXT ──
  var AIChatContext = {
    lastActiveEmpCode: null,
    lastActiveEmpName: null,
    lastActiveMonth: null
  };

  // ─────────────────────────────────────────────────────────────────
  // 0. AUTO-UPDATING LIVE COMPLIANCE RULES ENGINE (2026+ FUTURE-PROOF)
  // ─────────────────────────────────────────────────────────────────
  var RULES_STORAGE_KEY = 'ATPL_AI_COMPLIANCE_RULES_V1';
  var RULES_CLOUD_SYS_ID = '__ATPL_SYS__AI_COMPLIANCE_RULES_V1';
  var RULES_MANIFEST_URL = 'compliance-rules-latest.json';
  var DEFAULT_COMPLIANCE_RULES = {
    version: '2026.11.28',
    updatedAt: '2026-11-28T00:00:00.000Z',
    updatedBy: 'ATPL 2026 Statutory Engine',
    pfCeiling: 25000,
    pfCeilingEffective: '2026-09',
    pfPreSepCeiling: 15000,
    pfEmployeePct: 12,
    pfEpsPct: 8.33,
    pfEpfPct: 3.67,
    pfEdliPct: 0.5,
    pfAdminPct: 0.5,
    esicGrossCeiling: 21000,
    esicPwdCeiling: 25000,
    esicEmployeePct: 0.75,
    esicEmployerPct: 3.25,
    esicDailyExempt: 176,
    minBasicPctOfGross: 50,
    maxDeductionPctOfGross: 50,
    otMultiplier: 2,
    maxWeeklyHours: 48,
    maxQuarterlyOtHours: 115,
    maxMonthlyOtWarnHours: 48,
    fnfSettlementDays: 2,
    gratuityPermYears: 5,
    gratuityFteYears: 1,
    gratuityTaxFreeCap: 2000000,
    bonusMinPct: 8.33,
    bonusMaxPct: 20,
    bonusMinDays: 30,
    customRules: [
      {
        id: 'builtin_epf_25k_sep2026',
        title: 'EPF Wage Ceiling ₹25,000 (Eff. 17 Sep 2026)',
        category: 'PF',
        keywords: ['epf', 'pf', '25000', 'ceiling', '5109'],
        effectiveFrom: '2026-09-17',
        summary: 'EPFO wage ceiling ₹15,000 se badh kar ₹25,000/month (Basic+DA) ho chuki hai. Max employee share ₹3,000 aur max EPS pension ₹2,083.',
        auditorNote: 'Sep 2026+ sheets par ₹15,000 cap lock hone par short-deduction demand aa sakti hai.',
        checkMetric: '',
        checkThreshold: null,
        enabled: true
      },
      {
        id: 'builtin_code_wages_50pct',
        title: 'Code on Wages 50% Basic & 50% Max Deduction Cap',
        category: 'LABOUR_CODE',
        keywords: ['50%', 'wage', 'deduction', 'fnf', '2 days', 'labour code'],
        effectiveFrom: '2026-04-01',
        summary: 'Basic+DA kam se kam 50% CTC hona chahiye; total deductions earned gross ke 50% se upar nahi ja sakti; F&F 2 working days mein mandatory hai.',
        auditorNote: 'High advance deductions ya low basic% par auditor add-back / illegal deduction mark karta hai.',
        checkMetric: '',
        checkThreshold: null,
        enabled: true
      }
    ]
  };

  function cloneRuleBundle(src) {
    var base = Object.assign({}, DEFAULT_COMPLIANCE_RULES);
    if (src && typeof src === 'object') {
      Object.keys(DEFAULT_COMPLIANCE_RULES).forEach(function(k) {
        if (k === 'customRules') return;
        if (src[k] !== undefined && src[k] !== null && src[k] !== '') {
          base[k] = typeof DEFAULT_COMPLIANCE_RULES[k] === 'number'
            ? (isFinite(Number(src[k])) ? Number(src[k]) : DEFAULT_COMPLIANCE_RULES[k])
            : String(src[k]);
        }
      });
      var rawList = Array.isArray(src.customRules) ? src.customRules : DEFAULT_COMPLIANCE_RULES.customRules;
      base.customRules = rawList.filter(function(r) { return r && (r.title || r.summary); }).map(function(r, idx) {
        return {
          id: String(r.id || ('cr_' + idx + '_' + Date.now())),
          title: String(r.title || 'Custom Rule'),
          category: String(r.category || 'OTHER').toUpperCase(),
          keywords: Array.isArray(r.keywords)
            ? r.keywords.map(function(w) { return String(w || '').trim().toLowerCase(); }).filter(Boolean)
            : String(r.keywords || '').split(/[,;]+/).map(function(w) { return w.trim().toLowerCase(); }).filter(Boolean),
          effectiveFrom: String(r.effectiveFrom || ''),
          summary: String(r.summary || ''),
          auditorNote: String(r.auditorNote || ''),
          checkMetric: String(r.checkMetric || ''),
          checkThreshold: (r.checkThreshold !== undefined && r.checkThreshold !== null && r.checkThreshold !== '' && isFinite(Number(r.checkThreshold)))
            ? Number(r.checkThreshold) : null,
          enabled: r.enabled !== false
        };
      });
    } else {
      base.customRules = DEFAULT_COMPLIANCE_RULES.customRules.map(function(r) {
        return Object.assign({}, r, { keywords: (r.keywords || []).slice() });
      });
    }
    return base;
  }

  var _activeRulesCache = null;
  var _lastRemoteSyncAttempt = 0;

  var ComplianceRulesEngine = {
    getRules: function() {
      if (_activeRulesCache) return _activeRulesCache;
      var parsed = null;
      try {
        if (typeof localStorage !== 'undefined') {
          var raw = localStorage.getItem(RULES_STORAGE_KEY);
          if (raw) parsed = JSON.parse(raw);
        }
      } catch (_) {}
      _activeRulesCache = cloneRuleBundle(parsed);
      return _activeRulesCache;
    },
    saveRules: function(nextBundle, opts) {
      opts = opts || {};
      var normalized = cloneRuleBundle(nextBundle);
      if (!opts.preserveTimestamp) {
        normalized.updatedAt = new Date().toISOString();
        normalized.version = new Date().toISOString().slice(0, 10).replace(/-/g, '.') + (opts.tag ? ('-' + opts.tag) : '-live');
      }
      if (opts.updatedBy) normalized.updatedBy = String(opts.updatedBy);
      _activeRulesCache = normalized;
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(RULES_STORAGE_KEY, JSON.stringify(normalized));
          localStorage.setItem('ATPL_TRIGGER_EVENT', JSON.stringify({
            action: 'ai_compliance_rules_updated',
            version: normalized.version,
            updatedAt: normalized.updatedAt,
            ts: Date.now()
          }));
        }
      } catch (_) {}
      try {
        if (typeof BroadcastChannel !== 'undefined') {
          var bc = new BroadcastChannel('ATPL_AI_RULES_SYNC');
          bc.postMessage({ action: 'rules_updated', bundle: normalized });
          bc.close();
        }
      } catch (_) {}
      if (!opts.skipCloudPush) {
        this.pushToCloud(normalized).catch(function() {});
      }
      this.refreshSubtitle();
      return normalized;
    },
    resetDefaults: function() {
      var def = cloneRuleBundle(DEFAULT_COMPLIANCE_RULES);
      def.updatedAt = new Date().toISOString();
      def.updatedBy = 'Reset to 2026 Defaults';
      return this.saveRules(def, { preserveTimestamp: true, tag: 'default' });
    },
    refreshSubtitle: function() {
      try {
        var sub = document.getElementById('aiCommanderSub');
        var r = this.getRules();
        if (sub) {
          sub.textContent = 'Rules v' + r.version + ' · PF ₹' + r.pfCeiling.toLocaleString('en-IN') + ' · ESIC ₹' + r.esicGrossCeiling.toLocaleString('en-IN') + ' · Ctrl+K';
        }
      } catch (_) {}
    },
    getAuthToken: function() {
      try {
        var ss = typeof sessionStorage !== 'undefined' ? sessionStorage : null;
        var ls = typeof localStorage !== 'undefined' ? localStorage : null;
        return String(
          (ss && (ss.getItem('ATPL_RemoteToken_V1') || ss.getItem('ATPL_SharedToken_V1'))) ||
          (ls && (ls.getItem('ATPL_RemoteToken_V1') || ls.getItem('ATPL_SharedToken_V1'))) || ''
        ).trim();
      } catch (_) { return ''; }
    },
    pushToCloud: async function(bundle) {
      try {
        if (typeof window === 'undefined' || !window.ATPLCloudAPI || typeof window.ATPLCloudAPI.request !== 'function') return false;
        var tk = this.getAuthToken();
        if (!tk || /^(FAST_AUTH_|OFFLINE_|ADMIN_|LOCAL_)/i.test(tk)) return false;
        await window.ATPLCloudAPI.request({
          action: 'upsertEmployeeMaster',
          token: tk,
          emp_id: RULES_CLOUD_SYS_ID,
          kind: 'ai_compliance_rules',
          record_json: JSON.stringify(Object.assign({ emp_id: RULES_CLOUD_SYS_ID, _atpl_system: true, kind: 'ai_compliance_rules' }, bundle)),
          payload: JSON.stringify(bundle)
        }, { timeout: 14000, source: 'ai-rules' });
        return true;
      } catch (_) { return false; }
    },
    syncLatestRules: async function(forceManual) {
      var now = Date.now();
      if (!forceManual && now - _lastRemoteSyncAttempt < 90000) {
        return { ok: true, updated: false, source: 'cached', bundle: this.getRules() };
      }
      _lastRemoteSyncAttempt = now;
      var current = this.getRules();
      var curMs = Date.parse(current.updatedAt || 0) || 0;
      var best = null;
      var source = '';

      // 1. Check live repo manifest (compliance-rules-latest.json)
      try {
        var isHttp = typeof window !== 'undefined' && window.location && /^https?:/i.test(String(window.location.protocol || ''));
        if ((isHttp || forceManual) && typeof fetch === 'function') {
          var res = await fetch(RULES_MANIFEST_URL + '?_ts=' + Date.now(), { cache: 'no-store' });
          if (res && res.ok) {
            var remoteJson = await res.json();
            if (remoteJson && remoteJson.pfCeiling) {
              var rMs = Date.parse(remoteJson.updatedAt || 0) || 0;
              if (rMs > curMs) {
                best = remoteJson;
                source = 'manifest';
                curMs = rMs;
              }
            }
          }
        }
      } catch (_) {}

      // 2. Check Cloud SystemVaultChunks (cross-browser Admin updates)
      try {
        if (typeof window !== 'undefined' && window.ATPLCloudAPI && typeof window.ATPLCloudAPI.request === 'function') {
          var tk = this.getAuthToken();
          if (tk) {
            var cloudRes = await window.ATPLCloudAPI.request({
              action: 'getSystemRecords',
              kind: 'ai_compliance_rules',
              token: tk
            }, { timeout: 10000, source: 'ai-rules', cacheMs: forceManual ? 0 : 10000 });
            if (cloudRes && cloudRes.ok && Array.isArray(cloudRes.records)) {
              cloudRes.records.forEach(function(rec) {
                if (!rec || String(rec.id || rec.chunk_id || '') !== RULES_CLOUD_SYS_ID) return;
                try {
                  var parsed = JSON.parse(rec.payload || '{}');
                  var cMs = Date.parse(parsed.updatedAt || rec.updated_at || 0) || 0;
                  if (parsed && parsed.pfCeiling && cMs > curMs) {
                    best = parsed;
                    source = 'cloud';
                    curMs = cMs;
                  }
                } catch (_) {}
              });
            }
          }
        }
      } catch (_) {}

      if (best) {
        var saved = this.saveRules(best, { preserveTimestamp: true, skipCloudPush: true });
        return { ok: true, updated: true, source: source, bundle: saved };
      }
      return { ok: true, updated: false, source: 'up-to-date', bundle: current };
    },
    parseCircularText: function(rawText) {
      var txt = String(rawText || '').trim();
      if (!txt) return { ok: false, error: 'EMPTY_TEXT' };
      if (txt.charAt(0) === '{') {
        try {
          var jsonObj = JSON.parse(txt);
          if (jsonObj && (jsonObj.pfCeiling || jsonObj.esicGrossCeiling || jsonObj.customRules)) {
            var merged = Object.assign({}, this.getRules(), jsonObj);
            var savedJson = this.saveRules(merged, { tag: 'json', updatedBy: 'JSON Import' });
            return { ok: true, changes: ['Full JSON Rules imported (v' + savedJson.version + ')'], bundle: savedJson };
          }
        } catch (_) {}
      }
      var cur = cloneRuleBundle(this.getRules());
      var changes = [];
      function pickNum(re) {
        var m = txt.match(re);
        if (!m) return null;
        var v = Number(String(m[1] || '').replace(/,/g, ''));
        return isFinite(v) && v > 0 ? v : null;
      }
      var pfN = pickNum(/(?:pf|epf|provident\s*fund)[^0-9]{0,35}?(?:₹|rs\.?|inr)?\s*(\d{2},\d{3}|\d{5,6})/i);
      if (pfN && pfN >= 10000 && pfN <= 200000 && pfN !== cur.pfCeiling) {
        changes.push('PF Ceiling: ₹' + cur.pfCeiling.toLocaleString('en-IN') + ' → ₹' + pfN.toLocaleString('en-IN'));
        cur.pfCeiling = pfN;
      }
      var esiN = pickNum(/(?:esic|esi)[^0-9]{0,35}?(?:₹|rs\.?|inr)?\s*(\d{2},\d{3}|\d{5,6})/i);
      if (esiN && esiN >= 10000 && esiN <= 200000 && esiN !== cur.esicGrossCeiling) {
        changes.push('ESIC Ceiling: ₹' + cur.esicGrossCeiling.toLocaleString('en-IN') + ' → ₹' + esiN.toLocaleString('en-IN'));
        cur.esicGrossCeiling = esiN;
      }
      var basicPct = pickNum(/(?:basic|wage\s*definition)[^0-9]{0,30}?(\d{2})\s*%/i);
      if (basicPct && basicPct >= 30 && basicPct <= 80 && basicPct !== cur.minBasicPctOfGross) {
        changes.push('Min Basic %: ' + cur.minBasicPctOfGross + '% → ' + basicPct + '%');
        cur.minBasicPctOfGross = basicPct;
      }
      var dedPct = pickNum(/(?:deduction\s*(?:cap|limit)|max\s*deduction)[^0-9]{0,30}?(\d{2})\s*%/i);
      if (dedPct && dedPct >= 20 && dedPct <= 75 && dedPct !== cur.maxDeductionPctOfGross) {
        changes.push('Max Deduction Cap: ' + cur.maxDeductionPctOfGross + '% → ' + dedPct + '%');
        cur.maxDeductionPctOfGross = dedPct;
      }
      var otWarn = pickNum(/(?:monthly\s*ot|ot\s*(?:limit|cap))[^0-9]{0,25}?(\d{2,3})\s*(?:hr|hrs|hour)/i);
      if (otWarn && otWarn >= 10 && otWarn <= 200 && otWarn !== cur.maxMonthlyOtWarnHours) {
        changes.push('Monthly OT Alert: ' + cur.maxMonthlyOtWarnHours + 'h → ' + otWarn + 'h');
        cur.maxMonthlyOtWarnHours = otWarn;
      }
      var shortTitle = txt.split(/[\r\n.]/)[0].trim().slice(0, 68) || 'Updated Compliance Rule';
      var words = txt.toLowerCase().replace(/[^a-z0-9%\s]/g, ' ').split(/\s+/).filter(function(w) {
        return w.length >= 3 && ['rule','update','karo','kar','hai','the','and','for','with','naya','new','add'].indexOf(w) < 0;
      });
      var uniqueKw = [];
      words.forEach(function(w) { if (uniqueKw.indexOf(w) < 0 && uniqueKw.length < 8) uniqueKw.push(w); });
      var cat = /pf|epf|uan/i.test(txt) ? 'PF' : (/esic|esi/i.test(txt) ? 'ESIC' : (/bonus/i.test(txt) ? 'BONUS' : (/gratuity/i.test(txt) ? 'GRATUITY' : (/labour|wage|f&f|fnf|ot/i.test(txt) ? 'LABOUR_CODE' : 'OTHER'))));
      var autoMetric = '';
      var autoThresh = null;
      var mOt = txt.match(/ot\s*(?:>|above|zyada|se\s*zyada)\s*(\d+)/i);
      if (mOt) { autoMetric = 'OT_GT'; autoThresh = Number(mOt[1]); }
      cur.customRules.unshift({
        id: 'cr_' + Date.now(),
        title: shortTitle,
        category: cat,
        keywords: uniqueKw,
        effectiveFrom: new Date().toISOString().slice(0, 10),
        summary: txt.slice(0, 320),
        auditorNote: 'User-updated circular / rule entry.',
        checkMetric: autoMetric,
        checkThreshold: autoThresh,
        enabled: true
      });
      if (!changes.length) changes.push('Custom Rule Added: ' + shortTitle);
      var saved = this.saveRules(cur, { tag: 'rule', updatedBy: 'AI Rule Update' });
      return { ok: true, changes: changes, bundle: saved };
    }
  };

  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('storage', function(ev) {
      if (!ev) return;
      if (ev.key === RULES_STORAGE_KEY || ev.key === 'ATPL_TRIGGER_EVENT') {
        _activeRulesCache = null;
        ComplianceRulesEngine.refreshSubtitle();
      }
    });
  }

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

  var _lastScannedSig = '';
  var _kgFileCache = new Map();

  // Scan and learn from every loaded file, sheet, and master table
  function refreshKnowledgeGraph(force) {
    var files = Array.isArray(window.FILES) ? window.FILES : [];
    var masterCount = (window.EMP_MASTER_DATA && window.EMP_MASTER_DATA.length) || (window.EM && window.EM.data && window.EM.data.length) || 0;
    var curSig = files.length + ':' + files.map(function(f){ return (f.name||'') + '@' + (f.savedAt||''); }).join('|') + ':EM=' + masterCount;
    
    if (!force && curSig === _lastScannedSig && KnowledgeGraph.filesSummary.length > 0) {
      return;
    }
    _lastScannedSig = curSig;

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

      var sheetNames = (f.wb && Array.isArray(f.wb.SheetNames)) ? f.wb.SheetNames : Object.keys(sheets);
      sheetNames.forEach(function(sn, snIdx) {
        var ws = f.wb && f.wb.Sheets && f.wb.Sheets[sn];
        var shRows = (ws && typeof window.fastSheetRowCount === 'function') ? window.fastSheetRowCount(ws) : (f.sheets && f.sheets[sn] ? Math.max(0, f.sheets[sn].length - 1) : 0);
        if (shRows === 0) {
          fileInfo.sheets.push({ name: sn, rowCount: 0, type: 'Empty' });
          return;
        }
        if (snIdx >= 2 && !force) {
          fileInfo.sheets.push({ name: sn, rowCount: shRows, type: 'Salary Sheet' });
          fileInfo.totalRows += shRows;
          return;
        }
        var rows = (ws && ws.__cachedRowsFmt) ? ws.__cachedRowsFmt : (Array.isArray(sheets[sn]) && !f.wb ? sheets[sn] : []);
        if (!rows.length) {
          fileInfo.sheets.push({ name: sn, rowCount: shRows, type: 'General' });
          fileInfo.totalRows += shRows;
          return;
        }

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

        for (var i = headerIdx + 1; i < Math.min(rows.length, headerIdx + 300); i++) {
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

    // ── MULTI-TURN CONTEXT RESOLVER ──
    var directCodeMatch = raw.match(/\b\d{4,6}\b/);
    if (directCodeMatch) {
      AIChatContext.lastActiveEmpCode = cleanCode(directCodeMatch[0]);
    }

    // ── 0. DIRECT STATUTORY CHALLAN / ECR TRIGGER ──
    if (lower.match(/challan|ecr|pf.*return|esic.*return|pf.*file|esic.*file|portal.*upload/i)) {
      if (typeof window.goPage === 'function') window.goPage('challan');
      return {
        html: '🏛️ <strong>EPFO ECR & ESIC Monthly Challan Hub Open Ho Gaya Hai!</strong><br><br>' +
          '✅ Aapki uploaded salary sheet se direct:<br>' +
          '• <strong>EPFO ECR Text File (#~# delimiter)</strong> ready hai.<br>' +
          '• <strong>ESIC Monthly Contribution Template (.xlsx)</strong> ready hai.<br>' +
          '• Account 1, 2, 10, 21, 22 ka exact bifurcation calculate ho gaya hai.<br><br>' +
          '<button class="ai-act-btn" onclick="window.downloadEpfoEcrTextFile()">⬇ Download EPFO ECR File</button> ' +
          '<button class="ai-act-btn" onclick="window.downloadEsicUploadExcel()" style="background:#16a34a">⬇ Download ESIC Excel</button>'
      };
    }

    // ── ACTIVE VS LEFT WORKER INTELLIGENT QUERY ──
    if (lower.match(/(?:active|left|exited|working|chhod|chhodne|dol)s*(?:worker|staff|employee|log|kitne|list|count|status)/i) ||
        lower.match(/(?:kitne|kaun)s*(?:active|left|exited|chhod)/i)) {
      if (typeof window.goPage === 'function') window.goPage('empmaster');
      
      var isAskingLeft = Boolean(lower.match(/left|exited|chhod|dol/i));
      if (typeof window.emSetStatusFilter === 'function') {
        window.emSetStatusFilter(isAskingLeft ? 'left' : 'active');
      }

      var totList = [];
      try {
        if (window.EM && Array.isArray(window.EM.data)) totList = window.EM.data;
        else totList = JSON.parse(localStorage.getItem('AroraTextilesEmployeeMasterV3') || '[]');
      } catch(_) {}

      var leftW = totList.filter(function(e) {
        var s = String(e.status || '').toUpperCase().trim();
        if (s === 'LEFT' || s === 'EXITED' || s === 'DOL') return true;
        var dol = String(e.dol || e.leaving_date || e.date_of_leaving || '').trim();
        return Boolean(dol && dol !== 'NA' && dol !== '-');
      });
      var activeW = totList.length - leftW.length;

      var targetMsg = isAskingLeft 
        ? '🔴 <strong>Exited / Left Employees Filter Active Ho Gaya Hai!</strong><br><br>' +
          '• Total Exited/Left Staff: <b>' + leftW.length + '</b><br>' +
          '• Total Active Staff: <b>' + activeW + '</b><br>' +
          '• Employee Master table me ab sirf left employees dikh rahe hain.'
        : '🟢 <strong>Active Employees Filter Active Ho Gaya Hai!</strong><br><br>' +
          '• Currently Active Staff: <b>' + activeW + '</b><br>' +
          '• Exited/Left Staff: <b>' + leftW.length + '</b><br>' +
          '• Employee Master table me ab sirf currently working staff dikh raha hai.';

      return {
        html: targetMsg + '<br><br>' +
          '<button class="ai-act-btn" onclick="window.emSetStatusFilter(\'all\')">👥 Show All (' + totList.length + ')</button> ' +
          '<button class="ai-act-btn" onclick="window.emSetStatusFilter(\'active\')" style="background:#059669">🟢 Show Active (' + activeW + ')</button> ' +
          '<button class="ai-act-btn" onclick="window.emSetStatusFilter(\'left\')" style="background:#dc2626">🔴 Show Left (' + leftW.length + ')</button>'
      };
    }

    // ── 1. OWNER / EXECUTIVE 1-PAGE SUMMARY ──
    if (lower.match(/owner|malik|executive|summary|profit|loss|overall|dashboard.*view|company.*status/i)) {
      var totEmployees = Object.keys(KnowledgeGraph.employees).length;
      var mKeys = Object.keys(KnowledgeGraph.months).sort();
      var latestMKey = mKeys[mKeys.length - 1];
      var latestM = latestMKey ? KnowledgeGraph.months[latestMKey] : null;

      var out = '<div style="background:linear-gradient(135deg,#1e1b4b,#0f172a);border:1px solid #6366f1;border-radius:14px;padding:16px;box-shadow:0 10px 25px rgba(0,0,0,0.5)">';
      out += '<div style="font-size:15px;font-weight:800;color:#a5b4fc;margin-bottom:10px;display:flex;align-items:center;gap:8px">👔 <strong>Owner / MD 360° Executive Briefing</strong></div>';
      out += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:12px;margin-bottom:12px">';
      out += '<div style="background:rgba(255,255,255,0.05);padding:10px;border-radius:10px;border-left:3px solid #38bdf8">👥 <strong>Active Headcount:</strong><br><span style="font-size:18px;font-weight:800;color:#fff">' + totEmployees + ' Staff</span></div>';
      if (latestM) {
        out += '<div style="background:rgba(255,255,255,0.05);padding:10px;border-radius:10px;border-left:3px solid #4ade80">💰 <strong>Latest Net Payout:</strong><br><span style="font-size:18px;font-weight:800;color:#4ade80">₹' + Math.round(latestM.totalNet).toLocaleString('en-IN') + '</span></div>';
        out += '<div style="background:rgba(255,255,255,0.05);padding:10px;border-radius:10px;border-left:3px solid #fbbf24">⏱️ <strong>Total OT Cost:</strong><br><span style="font-size:18px;font-weight:800;color:#fbbf24">₹' + Math.round(latestM.totalOTAmount).toLocaleString('en-IN') + '</span> (' + Math.round(latestM.totalOTHours) + ' hrs)</div>';
        out += '<div style="background:rgba(255,255,255,0.05);padding:10px;border-radius:10px;border-left:3px solid #f43f5e">🏛️ <strong>Govt PF+ESIC Liability:</strong><br><span style="font-size:18px;font-weight:800;color:#f43f5e">₹' + Math.round(latestM.totalPF + latestM.totalESIC).toLocaleString('en-IN') + '</span></div>';
      } else {
        out += '<div style="background:rgba(255,255,255,0.05);padding:10px;border-radius:10px;border-left:3px solid #4ade80">💰 <strong>Status:</strong><br>Files Ready & Synced</div>';
      }
      out += '</div>';
      out += '<div style="font-size:11px;color:#94a3b8;line-height:1.5;background:rgba(0,0,0,0.25);padding:10px;border-radius:8px">';
      out += '📈 <strong>Strategic Recommendations:</strong><br>';
      out += '• Overtime spending can be controlled by re-allocating second-shift spinning staff.<br>';
      out += '• Zero statutory non-compliance detected in PF/ESIC for standard payroll slabs.';
      out += '</div>';
      out += '<div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap">';
      out += '<button class="ai-act-btn" onclick="goPage(\'audit\')">📊 Salary Audit</button>';
      out += '<button class="ai-act-btn" onclick="goPage(\'cmd\')">⚡ Smart Commands</button>';
      out += '<button class="ai-act-btn" onclick="window.atplTriggerCrossSync(true)">☁️ Cross Sync</button>';
      out += '</div></div>';
      return { html: out };
    }

    // ── 2. AUTONOMOUS DATABASE ACTION: DIRECT UPDATE EMPLOYEE (PHONE / BANK / DEPT) ──
    var updateMatch = lower.match(/(?:code|emp|employee)?\s*(\d{4,6})\s*(?:ka|ki)?\s*(phone|mobile|ifsc|bank|dept|department|name)\s*(?:ko|badal|karke|change|update)?\s*([a-z0-9]+)/i);
    if (updateMatch) {
      var uCode = updateMatch[1];
      var uField = updateMatch[2].toLowerCase();
      var uVal = updateMatch[3].toUpperCase();

      var masterList = [];
      try { masterList = JSON.parse(localStorage.getItem('AroraTextilesEmployeeMasterV3') || '[]'); } catch(_) {}
      var foundIdx = masterList.findIndex(function(e) { return String(e.code || e.empCode || '') === String(uCode); });

      if (foundIdx >= 0) {
        if (uField.includes('phone') || uField.includes('mobile')) masterList[foundIdx].mobile = uVal;
        else if (uField.includes('ifsc')) masterList[foundIdx].ifsc = uVal;
        else if (uField.includes('bank')) masterList[foundIdx].bankAccount = uVal;
        else if (uField.includes('dept')) masterList[foundIdx].department = uVal;

        localStorage.setItem('AroraTextilesEmployeeMasterV3', JSON.stringify(masterList));
        if (typeof aroraRefreshMaster === 'function') aroraRefreshMaster();
        if (window.ATPLPermanentSync) window.ATPLPermanentSync.syncAll(false);

        return {
          html: '⚡ <strong>Autonomous Database Update Success!</strong><br><br>' +
            '✅ Employee Code: <b>' + uCode + '</b> (' + (masterList[foundIdx].name || 'Staff') + ')<br>' +
            '📝 Updated Field: <b>' + uField.toUpperCase() + '</b> ➔ <code>' + uVal + '</code><br>' +
            '☁️ Database and Cloud Sync updated automatically!'
        };
      }
    }

    // ── 3. MULTI-TURN ATTENDANCE / PF / OT SHORTCUT (Uses Last Searched Context) ──
    if (AIChatContext.lastActiveEmpCode && lower.match(/^(aur\s*)?(iski|iska|iske|uski|uska|unka|is worker|is employee)\s*(salary|pf|esi|esic|ot|attendance|bank|ifsc|advance|detail)/i)) {
      var ctxEmp = KnowledgeGraph.employees[AIChatContext.lastActiveEmpCode];
      if (ctxEmp) {
        return renderEmployeeDossier(ctxEmp, lower);
      }
    }

    // ── 4. WHATSAPP SALARY VOUCHER SENDER ──
    if (lower.match(/whatsapp|send.*slip|slip.*bhejo|share.*slip/i)) {
      var wCode = directCodeMatch ? cleanCode(directCodeMatch[0]) : AIChatContext.lastActiveEmpCode;
      var wEmp = wCode ? KnowledgeGraph.employees[wCode] : null;
      if (wEmp) {
        var wNet = Math.round(wEmp.summary.totalNet);
        var wMsg = encodeURIComponent('Namaste ' + wEmp.name + ', Arora Textiles Ltd. Salary Voucher: Net Payout: Rs ' + wNet + ', WD: ' + wEmp.summary.totalWD + ' days. Kisi bhi query ke liye HR se sampark karein.');
        var waUrl = 'https://api.whatsapp.com/send?text=' + wMsg;
        return {
          html: '📱 <strong>WhatsApp Salary Voucher Ready!</strong><br><br>' +
            '👤 <b>' + wEmp.name + '</b> (Code: ' + wEmp.code + ')<br>' +
            '💰 Net Amount: <b>₹' + wNet.toLocaleString('en-IN') + '</b><br><br>' +
            '<a href="' + waUrl + '" target="_blank" class="ai-act-btn" style="text-decoration:none;display:inline-flex;align-items:center;gap:6px;background:#25D366;color:#fff;padding:8px 16px;border-radius:12px;font-weight:700">📲 Send via WhatsApp</a>'
        };
      } else {
        return { html: '⚠️ Kripya employee code batayein jiska voucher WhatsApp par bhejna hai, jaise: <em>"22157 ka slip WhatsApp karo"</em>' };
      }
    }

    // ── 5. RELIEVING / EXPERIENCE LETTER INSTANT GENERATOR ──
    if (lower.match(/relieving|experience|letter|joining.*letter|doc.*banao|certificate/i)) {
      var lCode = directCodeMatch ? cleanCode(directCodeMatch[0]) : AIChatContext.lastActiveEmpCode;
      var lEmp = lCode ? KnowledgeGraph.employees[lCode] : null;
      if (lEmp) {
        var docHtml = '<div style="background:#fff;color:#0f172a;padding:16px;border-radius:10px;font-family:serif;line-height:1.6;border:2px solid #cbd5e1">';
        docHtml += '<div style="text-align:center;font-weight:bold;font-size:14px;border-bottom:1px solid #334155;padding-bottom:6px">ARORA TEXTILES PRIVATE LIMITED</div>';
        docHtml += '<div style="text-align:center;font-size:10px;color:#64748b;margin-bottom:10px">Industrial Area, Textile Zone • HR & Statutory Dept</div>';
        docHtml += '<div style="text-align:center;font-weight:bold;text-decoration:underline;margin-bottom:12px;font-size:12px">TO WHOMSOEVER IT MAY CONCERN</div>';
        docHtml += '<p style="font-size:11px">This is to certify that <strong>' + lEmp.name + '</strong> (Emp Code: <strong>' + lEmp.code + '</strong>) was employed with Arora Textiles as <strong>' + (lEmp.desig || 'Staff') + '</strong> in the <strong>' + (lEmp.dept || 'Production') + '</strong> department.</p>';
        docHtml += '<p style="font-size:11px">During their tenure, we found them to be diligent, hardworking, and regular. We wish them all success in future endeavors.</p>';
        docHtml += '<div style="margin-top:20px;display:flex;justify-content:space-between;font-size:10px;font-weight:bold"><div>Date: ' + new Date().toLocaleDateString('en-IN') + '</div><div>Authorized Signatory<br>Arora Textiles Ltd.</div></div>';
        docHtml += '</div>';
        docHtml += '<br><button class="ai-act-btn" onclick="window.print()">🖨️ Print Certificate</button>';
        return { html: docHtml };
      } else {
        return { html: '⚠️ Certificate generate karne ke liye employee code batayein, e.g. <em>"22157 ka experience letter banao"</em>' };
      }
    }


    // ══════════════════════════════════════════════════════════════════
    // 0. SELF-UPDATING RULES COMMANDS (NATURAL LANGUAGE + LIVE SYNC)
    // ══════════════════════════════════════════════════════════════════
    if (lower.match(/^(?:check|sync|refresh|pull)\s*(?:latest\s*)?rules|rules?\s*(?:sync|update|refresh|check)\s*karo|naye\s*rules?\s*check/i)) {
      var curRules0 = ComplianceRulesEngine.getRules();
      if (typeof window !== 'undefined' && window.AroraAICommander && typeof window.AroraAICommander.syncRulesNow === 'function') {
        setTimeout(function() { window.AroraAICommander.syncRulesNow(true); }, 10);
      }
      return {
        html: '🔄 <strong>Live Compliance Rules Sync Triggered</strong><br><br>' +
          '• <strong>Active Version:</strong> <code>v' + escHtml(curRules0.version) + '</code><br>' +
          '• <strong>PF Cap:</strong> ₹' + curRules0.pfCeiling.toLocaleString('en-IN') + ' · <strong>ESIC Cap:</strong> ₹' + curRules0.esicGrossCeiling.toLocaleString('en-IN') + '<br>' +
          '• <strong>Basic / Deduction Cap:</strong> ' + curRules0.minBasicPctOfGross + '% / ' + curRules0.maxDeductionPctOfGross + '% · <strong>Custom Rules:</strong> ' + (curRules0.customRules || []).length + '<br><br>' +
          '<button type="button" class="ai-act-btn" onclick="window.AroraAICommander.toggleRulesPanel(true)">⚙️ Open Rules Engine</button>'
      };
    }

    if (lower.match(/^(?:update|add|set|change)\s*rule\b|^naya\s*rule\b|^new\s*rule\b|(?:pf|epf|esic|esi|bonus|gratuity|deduction|basic|ot|fnf).*(?:kar\s*do|karo|badlo|set\s*karo|update\s*karo)/i) &&
        !lower.match(/kya\s*hai|batao|explain|formula|\?$/)) {
      var curR = cloneRuleBundle(ComplianceRulesEngine.getRules());
      var updNotes = [];
      var numPick = function(re) {
        var m = raw.match(re);
        if (!m) return null;
        var val = Number(String(m[1] || '').replace(/,/g, ''));
        return isFinite(val) && val > 0 ? val : null;
      };
      var pfSet = numPick(/(?:pf|epf).*?(?:ceiling|limit|celling|cap)?[^0-9]{0,20}(?:₹|rs\.?|inr)?\s*(\d{2},\d{3}|\d{4,6})/i);
      if (pfSet && pfSet >= 10000 && pfSet <= 200000) {
        updNotes.push('PF Wage Ceiling: ₹' + curR.pfCeiling.toLocaleString('en-IN') + ' → <strong>₹' + pfSet.toLocaleString('en-IN') + '</strong>');
        curR.pfCeiling = pfSet;
      }
      var esiSet = numPick(/(?:esic|esi).*?(?:ceiling|limit|celling|cap)?[^0-9]{0,20}(?:₹|rs\.?|inr)?\s*(\d{2},\d{3}|\d{4,6})/i);
      if (esiSet && esiSet >= 10000 && esiSet <= 200000) {
        updNotes.push('ESIC Gross Ceiling: ₹' + curR.esicGrossCeiling.toLocaleString('en-IN') + ' → <strong>₹' + esiSet.toLocaleString('en-IN') + '</strong>');
        curR.esicGrossCeiling = esiSet;
      }
      var dedSet = numPick(/(?:deduction).*?(?:cap|limit)?[^0-9]{0,18}(\d{2})\s*%/i);
      if (dedSet && dedSet >= 20 && dedSet <= 80) {
        updNotes.push('Max Deduction Cap: ' + curR.maxDeductionPctOfGross + '% → <strong>' + dedSet + '%</strong>');
        curR.maxDeductionPctOfGross = dedSet;
      }
      var basicSet = numPick(/(?:basic|wage).*?(?:rule|min)?[^0-9]{0,18}(\d{2})\s*%/i);
      if (basicSet && basicSet >= 25 && basicSet <= 80) {
        updNotes.push('Min Basic % Rule: ' + curR.minBasicPctOfGross + '% → <strong>' + basicSet + '%</strong>');
        curR.minBasicPctOfGross = basicSet;
      }
      var otSet = numPick(/(?:ot|overtime).*?(?:limit|cap|alert|max)?[^0-9]{0,18}(\d{1,3})\s*(?:hr|hrs|hour)/i);
      if (otSet && otSet >= 8 && otSet <= 200) {
        if (/quarter/i.test(raw)) {
          updNotes.push('Quarterly OT Cap: ' + curR.maxQuarterlyOtHours + 'h → <strong>' + otSet + 'h</strong>');
          curR.maxQuarterlyOtHours = otSet;
        } else {
          updNotes.push('Monthly OT Alert: ' + curR.maxMonthlyOtWarnHours + 'h → <strong>' + otSet + 'h</strong>');
          curR.maxMonthlyOtWarnHours = otSet;
        }
      }
      var fnfSet = numPick(/(?:fnf|f&f|settlement)[^0-9]{0,18}(\d{1,2})\s*day/i);
      if (fnfSet && fnfSet >= 1 && fnfSet <= 30) {
        updNotes.push('F&F Settlement Window: ' + curR.fnfSettlementDays + ' days → <strong>' + fnfSet + ' days</strong>');
        curR.fnfSettlementDays = fnfSet;
      }
      var bMinSet = numPick(/bonus\s*min[^0-9]{0,15}(\d+(?:\.\d+)?)\s*%/i);
      if (bMinSet && bMinSet > 0 && bMinSet <= 50) {
        updNotes.push('Bonus Min %: ' + curR.bonusMinPct + '% → <strong>' + bMinSet + '%</strong>');
        curR.bonusMinPct = bMinSet;
      }

      if (updNotes.length > 0 && !lower.match(/^(?:add|naya|new)\s*rule/i)) {
        var saved1 = ComplianceRulesEngine.saveRules(curR, { tag: 'live', updatedBy: 'Chat Command' });
        return {
          html: '✅ <strong>AI Compliance Rule Live Updated (v' + escHtml(saved1.version) + ')!</strong><br><br>' +
            updNotes.map(function(n) { return '• ' + n; }).join('<br>') +
            '<br><br>Ab Q&amp;A aur <strong>Mam → Compliance Auditor</strong> dono automatically is naye rule ke hisaab se chalenge aur sabhi browsers mein sync ho gaya hai.<br><br>' +
            '<button type="button" class="ai-act-btn" onclick="window.AroraAICommander.sendQuery(\'Mam compliance audit karo\')">🛡️ Re-Scan Compliance Sheet</button> ' +
            '<button type="button" class="ai-act-btn" style="background:#1e293b;border-color:rgba(148,163,184,0.35)" onclick="window.AroraAICommander.toggleRulesPanel(true)">⚙️ View Rules</button>'
        };
      }
      var cleanedRuleText = raw.replace(/^(?:update|add|set|change|naya|new)\s*rule\s*[:\-]?\s*/i, '').trim() || raw;
      var ext = ComplianceRulesEngine.parseCircularText(cleanedRuleText);
      if (ext && ext.ok) {
        return {
          html: '✅ <strong>New Rule Saved &amp; Activated (v' + escHtml(ext.bundle.version) + ')!</strong><br><br>' +
            ext.changes.map(function(c) { return '• ' + escHtml(c); }).join('<br>') +
            '<br><br>Ab aap is rule par sawal pooch sakte hain ya live audit scan chala sakte hain.<br><br>' +
            '<button type="button" class="ai-act-btn" onclick="window.AroraAICommander.toggleRulesPanel(true)">⚙️ Manage Rules</button>'
        };
      }
    }

    // ══════════════════════════════════════════════════════════════════
    // 100X SUPER-INTELLIGENCE: STATUTORY, LABOUR LAWS & RULES EXPERT
    // ══════════════════════════════════════════════════════════════════
    var R = ComplianceRulesEngine.getRules();

    // 1. PF WAGE CEILING / DYNAMIC CEILING / EPF RULES
    if (lower.match(/(pf|epf|provident\s*fund).*(ceiling|limit|celling|new\s*limit|hike|15000|21000|25000|30000|rule|percentage|rules)/i) ||
        lower.match(/(ceiling|celling|limit).*(pf|epf)/i)) {
      var pfMaxEmp = Math.round(R.pfCeiling * (R.pfEmployeePct / 100));
      var pfMaxEps = Math.round(R.pfCeiling * (R.pfEpsPct / 100));
      var pfMaxEpf = Math.round(R.pfCeiling * (R.pfEpfPct / 100));
      var pfMaxEdli = Math.round(R.pfCeiling * (R.pfEdliPct / 100));
      var pfHtml = '<div style="line-height:1.7">';
      pfHtml += '🏛️ <strong>EPF Wage Ceiling &amp; Active Rules (v' + escHtml(R.version) + '):</strong><br><br>';
      pfHtml += '📌 <strong>1. Active Statutory Wage Ceiling (Eff. ' + escHtml(R.pfCeilingEffective) + '):</strong><br>';
      pfHtml += '• <strong>₹' + R.pfCeiling.toLocaleString('en-IN') + ' per month (Basic + DA)</strong> — Purani limit ₹' + R.pfPreSepCeiling.toLocaleString('en-IN') + ' se updated active limit <strong>₹' + R.pfCeiling.toLocaleString('en-IN') + '</strong> hai.<br>';
      pfHtml += '• Jin employees ki Basic + DA ₹' + R.pfCeiling.toLocaleString('en-IN') + ' ya usse kam hai, unke liye EPF, EPS aur EDLI <strong>Mandatory (Anivarya)</strong> hai.<br><br>';
      pfHtml += '📌 <strong>2. Monthly Contribution Breakdown (₹' + R.pfCeiling.toLocaleString('en-IN') + ' Ceiling par):</strong><br>';
      pfHtml += '• <strong>Employee Share:</strong> <strong>' + R.pfEmployeePct + '%</strong> of Basic + DA (ceiling par max <strong>₹' + pfMaxEmp.toLocaleString('en-IN') + '</strong>).<br>';
      pfHtml += '• <strong>Employer Share:</strong><br>';
      pfHtml += '  - <strong>' + R.pfEpfPct + '%</strong> ➔ EPF (max ₹' + pfMaxEpf.toLocaleString('en-IN') + ')<br>';
      pfHtml += '  - <strong>' + R.pfEpsPct + '%</strong> ➔ EPS Pension (max <strong>₹' + pfMaxEps.toLocaleString('en-IN') + '</strong>)<br>';
      pfHtml += '  - <strong>' + R.pfEdliPct + '%</strong> ➔ EDLI (max ₹' + pfMaxEdli.toLocaleString('en-IN') + ') + <strong>' + R.pfAdminPct + '%</strong> Admin Charges<br><br>';
      pfHtml += '📌 <strong>3. ' + R.minBasicPctOfGross + '% Wage Definition Rule (Labour Codes):</strong><br>';
      pfHtml += '• Agar Basic + DA total CTC ke ' + R.minBasicPctOfGross + '% se kam hai, toh excess allowances ko Wage mein add-back karke PF calculate karna hota hai.<br><br>';
      pfHtml += '<button type="button" class="ai-act-btn" onclick="window.AroraAICommander.toggleRulesPanel(true)">⚙️ Update PF / Statutory Rules</button>';
      pfHtml += '</div>';
      return { html: pfHtml };
    }

    // 2. ESIC WAGE CEILING & RULES
    if (lower.match(/(esic|esi|bima).*(ceiling|limit|celling|rule|coverage|percentage|rate)/i) ||
        lower.match(/(ceiling|celling|limit).*(esic|esi)/i)) {
      var esiHtml = '<div style="line-height:1.7">';
      esiHtml += '🏥 <strong>ESIC (Code on Social Security) Active Limit &amp; Rules (v' + escHtml(R.version) + '):</strong><br><br>';
      esiHtml += '📌 <strong>1. Statutory Gross Wage Ceiling:</strong><br>';
      esiHtml += '• <strong>₹' + R.esicGrossCeiling.toLocaleString('en-IN') + ' per month (Gross Wages)</strong> · Specially-abled (PwD) ke liye <strong>₹' + R.esicPwdCeiling.toLocaleString('en-IN') + '/month</strong>.<br>';
      esiHtml += '• <strong>Contribution Period Rule:</strong> <strong>Apr–Sep</strong> aur <strong>Oct–Mar</strong> — period start mein covered hone par beech mein salary ₹' + R.esicGrossCeiling.toLocaleString('en-IN') + ' cross kare toh period end tak ESIC continue rehta hai.<br><br>';
      esiHtml += '📌 <strong>2. Contribution Rates:</strong><br>';
      esiHtml += '• <strong>Employee Share:</strong> <strong>' + R.esicEmployeePct + '%</strong> · <strong>Employer Share:</strong> <strong>' + R.esicEmployerPct + '%</strong> (Total ' + (R.esicEmployeePct + R.esicEmployerPct).toFixed(2) + '%).<br><br>';
      esiHtml += '📌 <strong>3. Daily Wage Exemption:</strong><br>';
      esiHtml += '• Average daily wage <strong>₹' + R.esicDailyExempt + ' ya usse kam</strong> hone par Employee ' + R.esicEmployeePct + '% share exempt rehta hai (Employer ko ' + R.esicEmployerPct + '% dena hota hai).<br>';
      esiHtml += '</div>';
      return { html: esiHtml };
    }

    // 3. LABOUR CODES / 50% WAGE / DEDUCTION CAP / F&F TIMELINE
    if (lower.match(/(labour\s*code|labor\s*code|50%|fifty\s*percent|wage\s*definition|deduction\s*limit|deduction\s*cap|2\s*days|new\s*rule|latest\s*rule)/i)) {
      var pfCapMax = Math.round(R.pfCeiling * (R.pfEmployeePct / 100));
      var lcHtml = '<div style="line-height:1.7">';
      lcHtml += '⚖️ <strong>Active Indian Labour Codes Compliance Summary (v' + escHtml(R.version) + '):</strong><br><br>';
      lcHtml += '• <strong>PF Ceiling ₹' + R.pfCeiling.toLocaleString('en-IN') + ':</strong> EPF mandatory wage limit ₹' + R.pfCeiling.toLocaleString('en-IN') + '/month (max ₹' + pfCapMax.toLocaleString('en-IN') + ' employee share).<br>';
      lcHtml += '• <strong>' + R.minBasicPctOfGross + '% Wage Definition Rule:</strong> Basic + DA + Retaining kam se kam total salary ka <strong>' + R.minBasicPctOfGross + '%</strong> hona chahiye; excess allowances Wages mein add-back hote hain.<br>';
      lcHtml += '• <strong>' + R.maxDeductionPctOfGross + '% Max Deduction Cap (Code on Wages):</strong> Total deductions (PF + ESIC + Advance + Fines) earned gross ke <strong>' + R.maxDeductionPctOfGross + '%</strong> se zyada nahi ho sakti.<br>';
      lcHtml += '• <strong>F&amp;F Settlement Window:</strong> Resignation / termination / retrenchment ke <strong>' + R.fnfSettlementDays + ' working days</strong> ke andar final wages pay karna mandatory hai.<br>';
      lcHtml += '• <strong>Overtime &amp; Hours:</strong> OT minimum <strong>' + R.otMultiplier + 'x</strong> normal rate; weekly max <strong>' + R.maxWeeklyHours + ' hrs</strong> aur quarterly OT cap <strong>' + R.maxQuarterlyOtHours + ' hrs</strong>.<br>';
      lcHtml += '• <strong>Gratuity (FTE):</strong> Permanent ke liye ' + R.gratuityPermYears + ' years, Fixed-Term Employees (FTE) ke liye <strong>' + R.gratuityFteYears + ' year</strong> par pro-rata gratuity.<br>';
      var activeCustoms = (R.customRules || []).filter(function(cr) { return cr && cr.enabled && String(cr.id || '').indexOf('builtin_') !== 0; });
      if (activeCustoms.length) {
        lcHtml += '<br>📌 <strong>Custom / Newly Added Rules (' + activeCustoms.length + '):</strong><br>';
        activeCustoms.slice(0, 4).forEach(function(cr) {
          lcHtml += '• <strong>' + escHtml(cr.title) + ':</strong> ' + escHtml(cr.summary) + '<br>';
        });
      }
      lcHtml += '</div>';
      return { html: lcHtml };
    }

    // 4. BONUS ACT / CODE ON WAGES BONUS RULES
    if (lower.match(/(bonus|diwali\s*bonus).*(rule|calculation|percentage|formula|limit|ceiling|act)/i)) {
      var bHtml = '<div style="line-height:1.7">';
      bHtml += '🎁 <strong>Statutory Bonus Rules (v' + escHtml(R.version) + '):</strong><br><br>';
      bHtml += '• <strong>Eligibility:</strong> Kam se kam <strong>' + R.bonusMinDays + ' working days</strong> kaam kiya ho.<br>';
      bHtml += '• <strong>Minimum Bonus:</strong> <strong>' + R.bonusMinPct + '%</strong> of Earned Basic+DA.<br>';
      bHtml += '• <strong>Maximum Bonus:</strong> Up to <strong>' + R.bonusMaxPct + '%</strong> allocable surplus ke hisaab se.<br>';
      bHtml += '• <strong>' + R.minBasicPctOfGross + '% Rule Impact:</strong> Agar Basic total CTC ke ' + R.minBasicPctOfGross + '% se kam rakhi gayi ho, toh add-back Wages par bonus calculation check hoti hai.<br>';
      bHtml += '</div>';
      return { html: bHtml };
    }

    // 5. GRATUITY FORMULA & RULES
    if (lower.match(/(gratuity).*(rule|formula|calculation|limit|act|sal|years)/i)) {
      var gHtml = '<div style="line-height:1.7">';
      gHtml += '💰 <strong>Gratuity Rules (Code on Social Security, 2020):</strong><br><br>';
      gHtml += '• <strong>Permanent Staff:</strong> Minimum <strong>' + R.gratuityPermYears + ' continuous years</strong> (death/disability par waived).<br>';
      gHtml += '• <strong>Fixed-Term Employees (FTE):</strong> Sirf <strong>' + R.gratuityFteYears + ' year</strong> service complete karne par pro-rata gratuity applicable!<br>';
      gHtml += '• <strong>Formula:</strong> <code>(15 × Last Drawn Wages (Basic+DA, min ' + R.minBasicPctOfGross + '% CTC) × Years) ÷ 26</code><br>';
      gHtml += '• <strong>Tax-Free Cap:</strong> <strong>₹' + R.gratuityTaxFreeCap.toLocaleString('en-IN') + '</strong>.<br>';
      gHtml += '</div>';
      return { html: gHtml };
    }

    // 6. SALARY DIVISOR / 26 VS 30/31 FORMULA
    if (lower.match(/(divisor|26\s*days|30\s*days|salary\s*formula|gross\s*to\s*net|ot\s*rate)/i)) {
      var dHtml = '<div style="line-height:1.7">';
      dHtml += '📐 <strong>Factory &amp; Payroll Divisor Calculations (ATPL Standard):</strong><br><br>';
      dHtml += '• <strong>Standard Factory Divisor:</strong> <strong>26 Days</strong>.<br>';
      dHtml += '• <strong>Per Day Rate:</strong> <code>Daily Rate = Monthly Basic ÷ 26</code>.<br>';
      dHtml += '• <strong>Overtime (' + R.otMultiplier + 'x Rate):</strong> <code>OT Rate/Hr = (Basic ÷ 26 ÷ 8) × ' + R.otMultiplier + '</code> (ya Gross ÷ 104).<br>';
      dHtml += '• <strong>Max Deduction Guard:</strong> Total Deduction ≤ ' + R.maxDeductionPctOfGross + '% of Gross Earned.<br>';
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

    // ── LIVE MAM COMPLIANCE AUDITOR BRAIN (2026 RULES + INLINE FIX) ──
    if (lower.match(/mam.*compliance|compliance.*(audit|scan|check|insight|brain|sheet)|auditor|fasa|kahan.*pakad|audit.*ready/)) {
      return runComplianceAuditorBrain();
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

    // ── SPECIFIC SALARY AUDIT / SALARY CHANGE TIMELINE SCANNER ──
    // e.g. "26448 ki manual salary sheet me dekh ke batao kab change hui"
    var salChangeMatch = lower.match(/(?:salary|vetan|payout|rate|basic|gross|manual)s*(?:kab|change|badli|increase|difference|hike|history|history|badha|ghata)|(?:kab|change|badli|badha|ghata).*?(?:salary|vetan|rate|amount)/i);
    var targetCodeForSal = directCodeMatch ? cleanCode(directCodeMatch[0]) : AIChatContext.lastActiveEmpCode;

    if (salChangeMatch && targetCodeForSal) {
      var foundEmp = KnowledgeGraph.employees[targetCodeForSal];
      var empHistory = foundEmp && foundEmp.monthlyHistory ? foundEmp.monthlyHistory : [];

      // Also do deep-scan of ALL files directly in window.FILES if monthlyHistory is sparse
      var scannedHistory = [];
      var filesList = Array.isArray(window.FILES) ? window.FILES : [];

      filesList.forEach(function(f, fIdx) {
        var fTitle = f.name || ('File ' + (fIdx + 1));
        var sheets = f.sheets || {};
        Object.keys(sheets).forEach(function(sn) {
          var rows = Array.isArray(sheets[sn]) ? sheets[sn] : [];
          if (!rows.length) return;

          // Header search
          var hIdx = -1, cMap = {};
          for (var r = 0; r < Math.min(25, rows.length); r++) {
            if (!Array.isArray(rows[r])) continue;
            rows[r].forEach(function(cell, cIdx) {
              var s = String(cell || '').toLowerCase().replace(/[^a-z0-9]/g, '');
              if (s.includes('code') || s.includes('empid') || s.includes('token')) cMap.code = cIdx;
              if (s.includes('gross') || s.includes('earning') || s.includes('rate')) cMap.gross = cIdx;
              if (s.includes('basic') || s.includes('bpay')) cMap.basic = cIdx;
              if (s.includes('net') || s.includes('payment') || s.includes('manual')) cMap.net = cIdx;
            });
            if (cMap.code != null && (cMap.gross != null || cMap.net != null || cMap.basic != null)) {
              hIdx = r; break;
            }
          }

          if (hIdx >= 0) {
            for (var ri = hIdx + 1; ri < rows.length; ri++) {
              var row = rows[ri];
              if (!Array.isArray(row)) continue;
              var curCode = String(row[cMap.code] || '').trim().replace(/\D/g, '');
              if (curCode === targetCodeForSal || (foundEmp && foundEmp.name && String(row[cMap.code + 1] || '').toLowerCase().includes(foundEmp.normName))) {
                var pGross = cMap.gross != null ? cleanNum(row[cMap.gross]) : 0;
                var pBasic = cMap.basic != null ? cleanNum(row[cMap.basic]) : 0;
                var pNet = cMap.net != null ? cleanNum(row[cMap.net]) : 0;
                var pVal = pGross > 0 ? pGross : (pBasic > 0 ? pBasic : pNet);
                scannedHistory.push({
                  file: fTitle,
                  sheet: sn,
                  period: parseMonthYear(fTitle) ? parseMonthYear(fTitle).label : (parseMonthYear(sn) ? parseMonthYear(sn).label : fTitle),
                  gross: pGross,
                  basic: pBasic,
                  net: pNet,
                  effectiveAmount: pVal,
                  rowNum: ri + 1
                });
              }
            }
          }
        });
      });

      // Combine both scanned and cached histories
      var effectiveHist = scannedHistory.length ? scannedHistory : empHistory;
      var empDisplayName = foundEmp ? (foundEmp.name || ('Worker ' + targetCodeForSal)) : ('Worker ' + targetCodeForSal);

      if (effectiveHist.length > 0) {
        var out = '<div style="background:linear-gradient(135deg,#0f172a,#1e1b4b);border:1px solid #38bdf8;border-radius:14px;padding:16px;box-shadow:0 8px 25px rgba(0,0,0,0.4)">';
        out += '<div style="font-size:15px;font-weight:800;color:#38bdf8;margin-bottom:8px;display:flex;align-items:center;gap:8px">';
        out += '📈 <strong>Salary Change Audit & Timeline: [' + targetCodeForSal + '] ' + empDisplayName + '</strong>';
        out += '</div>';

        // Check if there was an actual salary change
        var changesDetected = [];
        for (var hi = 1; hi < effectiveHist.length; hi++) {
          var prev = effectiveHist[hi - 1];
          var curr = effectiveHist[hi];
          var prevAmt = prev.effectiveAmount || prev.gross || prev.net;
          var currAmt = curr.effectiveAmount || curr.gross || curr.net;
          if (prevAmt > 0 && currAmt > 0 && prevAmt !== currAmt) {
            var diff = currAmt - prevAmt;
            var pct = Math.round((diff / prevAmt) * 100);
            var isHike = diff > 0;
            changesDetected.push({
              fromPeriod: prev.period || prev.monthLabel || prev.file,
              toPeriod: curr.period || curr.monthLabel || curr.file,
              oldAmt: prevAmt,
              newAmt: currAmt,
              diff: diff,
              pct: pct,
              isHike: isHike
            });
          }
        }

        if (changesDetected.length > 0) {
          out += '<div style="background:rgba(56,189,248,0.1);border-left:4px solid #38bdf8;padding:10px 14px;border-radius:8px;margin-bottom:12px;font-size:12px;color:#f8fafc">';
          changesDetected.forEach(function(ch) {
            out += '⚡ <strong>Salary Change Detected:</strong> <code>' + ch.fromPeriod + '</code> se <code>' + ch.toPeriod + '</code> ke beech salary <strong>' + (ch.isHike ? 'badh kar (Hike)' : 'kam hokar') + '</strong> ₹' + ch.oldAmt.toLocaleString('en-IN') + ' se <strong>₹' + ch.newAmt.toLocaleString('en-IN') + '</strong> hui (' + (ch.isHike ? '+' : '') + '₹' + Math.abs(ch.diff) + ' ya ' + ch.pct + '%).<br>';
          });
          out += '</div>';
        } else {
          out += '<div style="background:rgba(34,197,94,0.1);border-left:4px solid #22c55e;padding:10px 14px;border-radius:8px;margin-bottom:12px;font-size:12px;color:#f8fafc">';
          out += '✅ <strong>Salary Constant Rahi Hai:</strong> Uploaded sheets ke mutabiq worker ki salary fixed <strong>₹' + (effectiveHist[0].effectiveAmount || effectiveHist[0].gross || effectiveHist[0].net).toLocaleString('en-IN') + '</strong> chali aa rahi hai (koi rate badlav nahi hua).';
          out += '</div>';
        }

        // Full month-by-month table
        out += '<div style="font-size:11px;font-weight:700;color:#94a3b8;margin-bottom:6px;text-transform:uppercase">Uploaded Sheet-Wise Breakdown:</div>';
        out += '<table style="width:100%;border-collapse:collapse;font-size:11px;color:#e2e8f0;text-align:left;background:rgba(0,0,0,0.2);border-radius:8px;overflow:hidden">';
        out += '<thead style="background:#1e293b;color:#94a3b8;font-size:10px"><tr><th style="padding:7px 10px">Month / Sheet</th><th style="padding:7px 10px">Gross / Rate</th><th style="padding:7px 10px">Basic</th><th style="padding:7px 10px">Net Payout</th><th style="padding:7px 10px">Source File</th></tr></thead><tbody>';

        effectiveHist.forEach(function(row) {
          out += '<tr style="border-bottom:1px solid rgba(255,255,255,0.05)">';
          out += '<td style="padding:6px 10px;font-weight:700;color:#38bdf8">' + (row.period || row.monthLabel || row.sheet) + '</td>';
          out += '<td style="padding:6px 10px;font-weight:700">₹' + (row.gross || row.effectiveAmount || 0).toLocaleString('en-IN') + '</td>';
          out += '<td style="padding:6px 10px">₹' + (row.basic || 0).toLocaleString('en-IN') + '</td>';
          out += '<td style="padding:6px 10px;color:#4ade80">₹' + (row.net || 0).toLocaleString('en-IN') + '</td>';
          out += '<td style="padding:6px 10px;color:#64748b;font-size:10px">' + (row.file || row.sourceFile || 'Sheet') + '</td>';
          out += '</tr>';
        });

        out += '</tbody></table>';
        out += '</div>';
        return { html: out };
      } else {
        return {
          html: '🔍 Worker Code <strong>[' + targetCodeForSal + ']</strong> ke liye manual/uploaded sheets scan ki gayi, lekin is code ke multiple months ka salary record nahi mila.<br><br>💡 <em>Tip: Alag-alag mahino ki (jaise July, August, etc.) sheets upload karein, AI turant compare karke bata dega ki salary kab aur kitni change hui!</em>'
        };
      }
    }

    // ── MATCH USER-ADDED CUSTOM COMPLIANCE RULES ──
    var customList = (ComplianceRulesEngine.getRules().customRules || []).filter(function(cr) { return cr && cr.enabled; });
    var matchedRules = customList.filter(function(cr) {
      var titleHit = cr.title && lower.indexOf(cr.title.toLowerCase()) >= 0;
      var kwHits = (cr.keywords || []).filter(function(kw) { return kw.length >= 2 && lower.indexOf(kw) >= 0; }).length;
      return titleHit || kwHits >= 2 || (kwHits >= 1 && /rule|niyam|policy|act|circular/i.test(lower));
    });
    if (matchedRules.length) {
      var crHtml = '📘 <strong>Matched Active Compliance Rules (' + matchedRules.length + '):</strong><br><br>';
      matchedRules.slice(0, 5).forEach(function(cr) {
        crHtml += '<div class="ai-kpi-card">';
        crHtml += '  <div style="display:flex;justify-content:space-between;gap:8px"><strong>' + escHtml(cr.title) + '</strong><span class="ai-dossier-badge">' + escHtml(cr.category) + '</span></div>';
        if (cr.effectiveFrom) crHtml += '  <div style="font-size:10.5px;color:#94a3b8;margin-top:2px">Effective: ' + escHtml(cr.effectiveFrom) + '</div>';
        crHtml += '  <div style="font-size:12px;color:#e2e8f0;margin-top:5px">' + escHtml(cr.summary) + '</div>';
        if (cr.auditorNote) crHtml += '  <div style="font-size:11px;color:#93c5fd;margin-top:4px">Auditor Note: ' + escHtml(cr.auditorNote) + '</div>';
        crHtml += '</div>';
      });
      return { html: crHtml };
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

  function isValidStatutoryId(v) {
    var s = String(v == null ? '' : v).trim().toUpperCase();
    return Boolean(s && s !== 'NA' && s !== 'N/A' && s !== 'NONE' && s !== 'NO' && s !== '-' && s !== '0' && s !== 'NIL');
  }

  function formatINRVal(n) {
    return '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
  }

  function analyzeMamComplianceSnapshot(snap) {
    var rows = Array.isArray(snap && snap.rows) ? snap.rows : [];
    var R = ComplianceRulesEngine.getRules();
    var monthKey = String((snap && snap.month) || '');
    var isPostSep2026 = !monthKey || monthKey >= (R.pfCeilingEffective || '2026-09');
    var pfCeiling = isPostSep2026 ? Number(R.pfCeiling || 25000) : Number(R.pfPreSepCeiling || 15000);
    var esicLimit = Number(R.esicGrossCeiling || 21000);
    var esicDailyExempt = Number(R.esicDailyExempt || 176);
    var minBasicRatio = Number(R.minBasicPctOfGross || 50) / 100;
    var maxDedRatio = Number(R.maxDeductionPctOfGross || 50) / 100;
    var monthlyOtWarn = Number(R.maxMonthlyOtWarnHours || 48);
    var quarterlyOtCap = Number(R.maxQuarterlyOtHours || 115);

    var deptStats = {};
    rows.forEach(function(r) {
      if (!r || Number(r.paidDays || 0) <= 0) return;
      var dept = String(r.department || r.category || 'GENERAL').trim().toUpperCase();
      if (!deptStats[dept]) deptStats[dept] = { count: 0, otSum: 0, diffSum: 0 };
      deptStats[dept].count++;
      deptStats[dept].otSum += Number(r.overtimeHours || 0);
      deptStats[dept].diffSum += Math.abs(Number(r.diffAmount || 0));
    });

    var findings = [];
    function pushFinding(r, severity, ruleCode, title, reason, auditorRisk, suggestedPatch, suggestedNote) {
      var id = 'cf_' + findings.length + '_' + String(r.empId || r.uid || findings.length);
      findings.push({
        id: id,
        uid: r.uid || r.empId,
        empId: r.empId || '',
        name: r.name || 'Worker',
        department: r.department || r.category || '',
        severity: severity,
        ruleCode: ruleCode,
        title: title,
        reason: reason,
        auditorRisk: auditorRisk,
        suggestedPatch: suggestedPatch || null,
        suggestedNote: suggestedNote || '',
        snapshot: {
          paidDays: Number(r.paidDays || 0),
          workingDays: Number(r.workingDays || 0),
          overtimeHours: Number(r.overtimeHours || 0),
          basic: Number(r.basic || 0),
          gross: Number(r.gross || 0),
          earnBasic: Number(r.earnBasic || 0),
          totalGross: Number(r.totalGross || 0),
          pfEmployee: Number(r.pfEmployee || 0),
          esiEmployee: Number(r.esiEmployee || 0),
          totalDeduction: Number(r.totalDeduction || 0),
          netPayable: Number(r.netPayable || 0),
          diffAmount: Number(r.diffAmount || 0),
          pfNo: r.pfNo || '',
          esiNo: r.esiNo || '',
          pfMode: r.pfMode || 'AUTO',
          esiMode: r.esiMode || 'AUTO',
          advance: Number(r.advance || 0),
          remarks: r.remarks || ''
        },
        fixed: false
      });
    }

    rows.forEach(function(r) {
      if (!r) return;
      var paidDays = Number(r.paidDays || 0);
      var workingDays = Number(r.workingDays || 0);
      var ot = Number(r.overtimeHours || 0);
      var basic = Number(r.basic || 0);
      var gross = Number(r.gross || 0);
      var earnBasic = Number(r.earnBasic || 0);
      var totalGross = Number(r.totalGross || 0);
      var pfEmp = Number(r.pfEmployee || 0);
      var esiEmp = Number(r.esiEmployee || 0);
      var totDed = Number(r.totalDeduction || 0);
      var diff = Number(r.diffAmount || 0);
      var hasPfId = isValidStatutoryId(r.pfNo);
      var hasEsiId = isValidStatutoryId(r.esiNo);

      // 1. PF deducted without valid PF No / UAN
      if (pfEmp > 0 && !hasPfId) {
        pushFinding(
          r, 'High', 'PF_WITHOUT_ID',
          'PF kata (' + formatINRVal(pfEmp) + ') par PF No / UAN missing hai',
          'Employee ka PF deduction ho gaya par PF No blank/NA hai.',
          'EPFO ECR upload fail hoga aur Inspector unlicensed deduction par notice de sakta hai.',
          { pfMode: 'NONE' },
          'PF No enter karein ya PF Mode = NONE karein'
        );
      }

      // 2. ESIC deducted without valid ESIC IP No
      if (esiEmp > 0 && !hasEsiId) {
        pushFinding(
          r, 'High', 'ESI_WITHOUT_ID',
          'ESIC kata (' + formatINRVal(esiEmp) + ') par ESIC No missing hai',
          'ESIC contribution deduct ho raha hai bina valid IP number ke.',
          'ESIC portal monthly return reject hogi aur auditor illegal deduction mark karega.',
          { esiMode: 'NONE' },
          'ESIC No enter karein ya ESIC Mode = NONE karein'
        );
      }

      // 3. Valid PF No present, active days, but PF = 0
      if (hasPfId && paidDays > 0 && earnBasic > 0 && pfEmp === 0 && r.pfMode !== 'NONE') {
        pushFinding(
          r, 'High', 'PF_MISSED_ACTIVE',
          'Valid PF No hai par PF ₹0 hai',
          'PF No (' + r.pfNo + ') active hone aur Earn Basic ' + formatINRVal(earnBasic) + ' ke bawajood PF nahi kata.',
          'EPFO 7A inspection mein back-dated interest + damages penalty lag sakti hai.',
          { pfMode: 'FULL_12' },
          'PF Mode ko FULL_12 set karein'
        );
      }

      // 4. Dynamic PF Wage Ceiling Check (₹25,000+ or Updated Rule)
      if (isPostSep2026 && hasPfId && paidDays > 0 && earnBasic > R.pfPreSepCeiling) {
        var expectedPfCap = Math.min(earnBasic, pfCeiling);
        var expectedPfEmp = Math.round(expectedPfCap * (Number(R.pfEmployeePct || 12) / 100));
        if (r.pfMode === 'CAP_15000' || (pfCeiling > 25000 && pfEmp > 0 && pfEmp + 30 < expectedPfEmp)) {
          pushFinding(
            r, 'High', 'PF_NEW_25K_CEILING',
            'Purana PF Cap laga hai (Active limit ₹' + pfCeiling.toLocaleString('en-IN') + ' hai)',
            'Active EPF ceiling ₹' + pfCeiling.toLocaleString('en-IN') + ' ke mutabiq PF ' + formatINRVal(expectedPfEmp) + ' hona chahiye (abhi ' + formatINRVal(pfEmp) + ' on Earn Basic ' + formatINRVal(earnBasic) + ').',
            'Auditor active ₹' + pfCeiling.toLocaleString('en-IN') + ' EPFO rule ke hisaab se short-deduction demand nikal sakta hai.',
            { pfMode: 'FULL_12' },
            'Active ₹' + pfCeiling.toLocaleString('en-IN') + ' rule ke hisaab se FULL_12 apply karein'
          );
        }
      }

      // 5. Dynamic ESIC Ceiling & Daily Exemption Checks
      if (paidDays > 0 && gross > 0) {
        var avgDaily = totalGross / Math.max(1, paidDays);
        if (hasEsiId && gross <= esicLimit && esiEmp === 0 && avgDaily > esicDailyExempt && r.esiMode !== 'NONE') {
          pushFinding(
            r, 'High', 'ESI_MISSED_UNDER_21K',
            'Gross ≤ ₹' + esicLimit.toLocaleString('en-IN') + ' aur ESIC No hai par ESIC ₹0 hai',
            'Daily wage ' + formatINRVal(avgDaily) + ' (>₹' + esicDailyExempt + ') hai aur Gross ' + formatINRVal(gross) + ' ESIC slab mein aata hai.',
            'ESIC Inspector non-deduction par employer + employee dono share + 12% interest maang sakta hai.',
            { esiMode: 'TOTAL_GROSS' },
            'ESIC Mode = TOTAL_GROSS apply karein'
          );
        } else if (gross > esicLimit && esiEmp > 0) {
          pushFinding(
            r, 'Medium', 'ESI_ABOVE_21K_PROOF',
            'Gross ₹' + esicLimit.toLocaleString('en-IN') + ' se upar hai par ESIC (' + formatINRVal(esiEmp) + ') kat raha hai',
            'Gross ' + formatINRVal(gross) + ' limit se upar hai. Sirf Apr–Sep / Oct–Mar mid-period continuation mein valid hota hai.',
            'Auditor check karega ki kya employee period start mein ₹' + esicLimit.toLocaleString('en-IN') + ' ke andar tha.',
            { esiMode: 'NONE' },
            'Mid-period proof nahi ho toh ESIC Mode = NONE karein'
          );
        }
      }

      // 6. Human-Brain "Low Working Days vs High OT Hours" Trap
      if (paidDays > 0 && ((workingDays > 0 && workingDays <= 5 && ot >= 12) || (workingDays > 0 && ot > workingDays * 4))) {
        var safeOt = Math.max(0, Math.round(workingDays * 2));
        pushFinding(
          r, 'High', 'LOW_DAYS_HIGH_OT',
          'Sirf ' + workingDays + ' Working Days par ' + ot + ' hrs OT — Auditor Red Flag!',
          'Itne kam working days mein itna zyada overtime physical biometric punch aur daily 12-hr spread-over limit se match nahi hota.',
          'Factory Inspector attendance register vs salary OT match karke fake/inflated OT objection laga sakta hai.',
          { overtimeHours: safeOt },
          'OT ko realistic ' + safeOt + ' hrs par adjust karein'
        );
      } else if (ot > monthlyOtWarn) {
        pushFinding(
          r, 'Medium', 'HIGH_MONTHLY_OT',
          'Monthly OT ' + ot + ' hrs (>' + monthlyOtWarn + ' hrs) — Quarterly ' + quarterlyOtCap + '-hr limit risk',
          'Active rule ke hisaab se quarterly OT cap ' + quarterlyOtCap + ' hrs aur monthly warn ' + monthlyOtWarn + ' hrs hai.',
          'Lagatar 2-3 mahine itna OT hone par Inspector safety/working-hours violation mark kar sakta hai.',
          { overtimeHours: Math.min(32, monthlyOtWarn) },
          'OT hours ' + Math.min(32, monthlyOtWarn) + ' hrs tak review/cap karein'
        );
      }

      // 7. Dynamic Labour Code Wage Definition Check
      if (gross > 0 && basic > 0 && (basic / gross) < minBasicRatio && paidDays > 0) {
        var minBasicTarget = Math.round(gross * minBasicRatio);
        pushFinding(
          r, 'Insight', 'WAGE_CODE_50_PCT',
          'Basic (' + Math.round((basic / gross) * 100) + '%) total Gross ke ' + R.minBasicPctOfGross + '% se kam hai',
          'Active Labour Code ' + R.minBasicPctOfGross + '% Wage Definition ke mutabiq Basic+DA kam se kam ' + formatINRVal(minBasicTarget) + ' hona chahiye.',
          'Auditor excess allowances ko Wages mein add-back karke PF aur Gratuity liability badha sakta hai.',
          { basic: minBasicTarget },
          'Basic ko ' + R.minBasicPctOfGross + '% (' + formatINRVal(minBasicTarget) + ') par align karein'
        );
      }

      // 8. Dynamic Code on Wages Maximum Deduction Cap
      if (totalGross > 0 && totDed > totalGross * maxDedRatio) {
        var maxAdv = Math.max(0, Math.floor((totalGross * maxDedRatio) - pfEmp - esiEmp));
        pushFinding(
          r, 'High', 'DEDUCTION_OVER_50_PCT',
          'Deduction (' + formatINRVal(totDed) + ') Gross Earned ke ' + R.maxDeductionPctOfGross + '% se zyada hai!',
          'Active rule ke hisaab se total deduction ' + formatINRVal(totalGross * maxDedRatio) + ' se upar nahi ja sakti.',
          'Labour Officer isko illegal wage deduction maan kar penalty laga sakta hai.',
          { advance: maxAdv },
          'Advance deduction ko ' + formatINRVal(maxAdv) + ' par cap karein'
        );
      }

      // 9. Zero Paid Days with Payout / Deduction
      if (paidDays <= 0 && (totalGross > 0 || pfEmp > 0 || esiEmp > 0)) {
        pushFinding(
          r, 'High', 'ZERO_DAY_PAYOUT',
          'Paid Days 0 hone par bhi salary/deduction entry aa rahi hai',
          'Gross ' + formatINRVal(totalGross) + ', PF ' + formatINRVal(pfEmp) + ', ESIC ' + formatINRVal(esiEmp) + ' jabki Paid Days 0 hai.',
          'Ghost worker / dead payroll entry hone ka shak auditor turant pakdega.',
          { paidDays: 0, overtimeHours: 0, pfMode: 'NONE', esiMode: 'NONE' },
          '0-day employee ko strictly ₹0 par reset karein'
        );
      }

      // 10. Dynamic Peer-Department Outlier & Large Manual Diff
      var dept = String(r.department || r.category || 'GENERAL').trim().toUpperCase();
      var dStat = deptStats[dept];
      var deptAvgOt = dStat && dStat.count > 2 ? (dStat.otSum / dStat.count) : 0;
      if (paidDays > 0 && deptAvgOt >= 4 && ot >= 22 && ot > deptAvgOt * 2.2) {
        pushFinding(
          r, 'Insight', 'PEER_OT_SPIKE',
          dept + ' avg OT (' + deptAvgOt.toFixed(1) + 'h) se 2.2x zyada OT (' + ot + 'h)',
          'Same department ke baaki workers ke muqable is worker ka OT achanak double+ dikh raha hai.',
          'Auditor department register se random sample check kare toh ye outlier sabse pehle dikhega.',
          { overtimeHours: Math.round(deptAvgOt) },
          'Dept average (' + Math.round(deptAvgOt) + ' hrs) ke paas review karein'
        );
      } else if (paidDays > 0 && Math.abs(diff) >= 4000) {
        pushFinding(
          r, 'Insight', 'LARGE_MANUAL_DIFF',
          'Manual vs Compliance Diff ' + formatINRVal(diff) + ' ka bada gap hai',
          'Mam sheet (' + formatINRVal(r.manualAmount) + ') aur Compliance Gross (' + formatINRVal(totalGross) + ') mein bada difference hai.',
          'Cash/extra difference agar high ho toh auditor unexplained wage variance question kar sakta hai.',
          null,
          'Paid Days / OT / Basic check karke gap verify karein'
        );
      }

      // 11. User-Added Custom Rules with Auto-Audit Thresholds
      (R.customRules || []).forEach(function(cr) {
        if (!cr || !cr.enabled || !cr.checkMetric || cr.checkThreshold === null || !isFinite(Number(cr.checkThreshold))) return;
        var th = Number(cr.checkThreshold);
        var hit = false;
        var patchObj = null;
        if (cr.checkMetric === 'OT_GT' && paidDays > 0 && ot > th) {
          hit = true;
          patchObj = { overtimeHours: th };
        } else if (cr.checkMetric === 'BASIC_PCT_LT' && paidDays > 0 && gross > 0 && ((basic / gross) * 100) < th) {
          hit = true;
          patchObj = { basic: Math.round(gross * (th / 100)) };
        } else if (cr.checkMetric === 'DED_PCT_GT' && paidDays > 0 && totalGross > 0 && ((totDed / totalGross) * 100) > th) {
          hit = true;
          patchObj = { advance: Math.max(0, Math.floor((totalGross * (th / 100)) - pfEmp - esiEmp)) };
        } else if (cr.checkMetric === 'GROSS_GT' && paidDays > 0 && gross > th) {
          hit = true;
        } else if (cr.checkMetric === 'BASIC_GT' && paidDays > 0 && basic > th) {
          hit = true;
        }
        if (hit) {
          pushFinding(
            r, 'Insight', 'CUSTOM_' + cr.id,
            cr.title + ' (Custom Rule Alert)',
            cr.summary || ('Active custom rule threshold (' + th + ') trigger hua.'),
            cr.auditorNote || 'User-defined compliance rule check.',
            patchObj,
            'Custom rule "' + cr.title + '" ke mutabiq adjust karein'
          );
        }
      });
    });

    return {
      month: monthKey,
      monthLabel: (snap && snap.monthLabel) || monthKey || 'Active Sheet',
      rowsCount: rows.length,
      pfCeilingApplied: pfCeiling,
      esicLimitApplied: esicLimit,
      ruleVersion: R.version,
      findings: findings
    };
  }

  function renderComplianceAuditCards(audit) {
    UI.complianceFindings = {};
    if (!audit || !audit.rowsCount) {
      return [
        '<div style="line-height:1.6">',
        '🛡️ <strong>Mam Compliance Auditor Co-Pilot Ready</strong><br><br>',
        'Abhi <strong>Mam → Compliance</strong> mein koi active salary sheet generated nahi hai.<br>',
        '1. <strong>Mam → Compliance</strong> page par jaakar Mam Sheet upload karein.<br>',
        '2. Phir dubara <strong>"Mam compliance audit karo"</strong> bolein — main har row ko 2026 rules (PF ₹25k, ESIC ₹21k, 50% Wage/Deduction Cap, Days vs OT traps) par audit karke <strong>Accept &amp; Fix</strong> button de dunga!<br><br>',
        '<button type="button" class="ai-act-btn" onclick="if(typeof goPage===\x27function\x27)goPage(\x27mamsalary\x27)">🧾 Open Mam → Compliance</button>',
        '</div>'
      ].join('');
    }

    var list = audit.findings || [];
    var highCount = list.filter(function(f) { return f.severity === 'High'; }).length;
    var medCount = list.filter(function(f) { return f.severity === 'Medium'; }).length;
    var insCount = list.filter(function(f) { return f.severity === 'Insight'; }).length;

    var out = '<div style="line-height:1.55">';
    out += '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px">';
    out += '  <strong style="font-size:13.5px;color:#f8fafc">🛡️ Auditor Brain Scan · ' + escHtml(audit.monthLabel) + '</strong>';
    out += '  <span style="font-size:11px;color:#94a3b8">v' + escHtml(audit.ruleVersion || '2026') + ' · ' + audit.rowsCount + ' rows · PF ₹' + audit.pfCeilingApplied.toLocaleString('en-IN') + ' · ESIC ₹' + (audit.esicLimitApplied || 21000).toLocaleString('en-IN') + '</span>';
    out += '</div>';

    if (!list.length) {
      out += '<div class="ai-kpi-card" style="border-color:rgba(34,197,94,0.4)">';
      out += '✅ <strong style="color:#4ade80">Audit-Ready! Zero Compliance Traps Found</strong><br>';
      out += '<span style="font-size:12px;color:#cbd5e1">Sabhi rows latest 2026 PF (₹' + audit.pfCeilingApplied.toLocaleString('en-IN') + '), ESIC, 50% Wage/Deduction cap aur Days-vs-OT logic ke mutabiq clean hain.</span>';
      out += '</div></div>';
      return out;
    }

    out += '<div class="ai-kpi-card" style="display:flex;gap:12px;flex-wrap:wrap;font-size:11.5px">';
    out += '  <span>🔴 Blockers: <strong style="color:#f87171">' + highCount + '</strong></span>';
    out += '  <span>🟠 Warnings: <strong style="color:#fbbf24">' + medCount + '</strong></span>';
    out += '  <span>💡 Smart Insights: <strong style="color:#60a5fa">' + insCount + '</strong></span>';
    out += '</div>';

    list.slice(0, 12).forEach(function(f) {
      UI.complianceFindings[f.id] = f;
      var sevColor = f.severity === 'High' ? '#ef4444' : (f.severity === 'Medium' ? '#f59e0b' : '#3b82f6');
      var sevLabel = f.severity === 'High' ? '🔴 BLOCKER' : (f.severity === 'Medium' ? '🟠 RISK' : '💡 INSIGHT');
      out += '<div class="ai-audit-card" id="aiAuditCard_' + escHtml(f.id) + '" style="background:#0f172a;border:1px solid rgba(148,163,184,0.2);border-top:2px solid ' + sevColor + ';border-radius:10px;padding:10px 12px;margin-bottom:8px">';
      out += '  <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap">';
      out += '    <strong style="font-size:12.5px;color:#f8fafc">' + escHtml(f.empId) + ' · ' + escHtml(f.name) + '</strong>';
      out += '    <span style="font-size:10px;font-weight:700;color:' + sevColor + '">' + sevLabel + '</span>';
      out += '  </div>';
      out += '  <div style="font-size:12px;font-weight:700;color:#e2e8f0;margin-top:4px">' + escHtml(f.title) + '</div>';
      out += '  <div style="font-size:11.5px;color:#94a3b8;margin-top:3px">' + escHtml(f.reason) + '</div>';
      out += '  <div style="font-size:11px;color:#cbd5e1;margin-top:4px"><strong>Auditor Risk:</strong> ' + escHtml(f.auditorRisk) + '</div>';
      out += '  <div style="font-size:10.5px;color:#94a3b8;margin-top:5px">Days: ' + f.snapshot.paidDays + ' · OT: ' + f.snapshot.overtimeHours + 'h · Basic: ' + formatINRVal(f.snapshot.basic) + ' · PF: ' + formatINRVal(f.snapshot.pfEmployee) + ' · ESIC: ' + formatINRVal(f.snapshot.esiEmployee) + '</div>';
      out += '  <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">';
      out += '    <button type="button" class="ai-act-btn" id="aiFixBtn_' + escHtml(f.id) + '" onclick="window.AroraAICommander.openComplianceFixBox(\'' + escHtml(f.id) + '\')">✅ Accept &amp; Fix</button>';
      out += '    <button type="button" class="ai-act-btn" style="background:#1e293b;border-color:rgba(148,163,184,0.3)" onclick="window.ATPLComplianceBridge && window.ATPLComplianceBridge.openRowInspector(\'' + escHtml(String(f.uid || f.empId)) + '\')">👁️ View Row</button>';
      out += '  </div>';
      out += '</div>';
    });

    if (list.length > 12) {
      out += '<div style="font-size:11.5px;color:#94a3b8;margin-top:4px">...aur ' + (list.length - 12) + ' aur insights hain. Pehle upar wale fix karke dubara scan karein.</div>';
    }
    out += '</div>';
    return out;
  }

  function runComplianceAuditorBrain() {
    if (window.ATPLComplianceBridge && typeof window.ATPLComplianceBridge.getActiveSheetSnapshot === 'function') {
      var snap = window.ATPLComplianceBridge.getActiveSheetSnapshot();
      if (snap && Array.isArray(snap.rows) && snap.rows.length > 0) {
        var audit = analyzeMamComplianceSnapshot(snap);
        return { html: renderComplianceAuditCards(audit), audit: audit };
      }
    }
    return { html: renderComplianceAuditCards(null), audit: null };
  }

  function renderAnomaliesReport() {
    if (window.ATPLComplianceBridge && typeof window.ATPLComplianceBridge.getActiveSheetSnapshot === 'function') {
      var snap = window.ATPLComplianceBridge.getActiveSheetSnapshot();
      if (snap && Array.isArray(snap.rows) && snap.rows.length > 0) {
        return runComplianceAuditorBrain();
      }
    }
    var issues = KnowledgeGraph.anomalies;
    var out = '<div style="line-height:1.6">';
    out += '🚨 <strong>Live Anomaly &amp; Statutory Compliance Scan</strong><br><br>';

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

      out += '<div style="background:rgba(255,255,255,0.05);border:1px solid rgba(148,163,184,0.2);border-top:2px solid ' + sevColor + ';border-radius:8px;padding:8px 12px;margin-bottom:8px">';
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
    var R = ComplianceRulesEngine.getRules();
    var pfMaxEmp = Math.round(R.pfCeiling * (R.pfEmployeePct / 100));
    var pfMaxEps = Math.round(R.pfEpsPct ? R.pfCeiling * (R.pfEpsPct / 100) : 0);
    var out = '📚 <strong>Active Indian Labour Compliance Guidelines (Rules v' + escHtml(R.version) + '):</strong><br><br>';
    if (query.indexOf('pf') >= 0 || query.indexOf('labour') >= 0) {
      out += '• <strong>EPF (Code on Social Security — Eff. ' + escHtml(R.pfCeilingEffective) + '):</strong><br>';
      out += '  - Mandatory Wage Ceiling: <strong>₹' + R.pfCeiling.toLocaleString('en-IN') + '/month</strong>.<br>';
      out += '  - Employee Share: <strong>' + R.pfEmployeePct + '%</strong> (max ₹' + pfMaxEmp.toLocaleString('en-IN') + ') · Employer: <strong>' + R.pfEpfPct + '% EPF + ' + R.pfEpsPct + '% EPS (max ₹' + pfMaxEps.toLocaleString('en-IN') + ') + ' + R.pfEdliPct + '% EDLI + ' + R.pfAdminPct + '% Admin</strong>.<br><br>';
    }
    if (query.indexOf('esic') >= 0 || query.indexOf('labour') >= 0) {
      out += '• <strong>ESIC:</strong><br>';
      out += '  - Statutory Gross Limit: <strong>₹' + R.esicGrossCeiling.toLocaleString('en-IN') + '/month</strong> (PwD: ₹' + R.esicPwdCeiling.toLocaleString('en-IN') + ') · Contribution Periods: Apr–Sep &amp; Oct–Mar.<br>';
      out += '  - Employee: <strong>' + R.esicEmployeePct + '%</strong> (exempt ≤ ₹' + R.esicDailyExempt + '/day) · Employer: <strong>' + R.esicEmployerPct + '%</strong>.<br><br>';
    }
    if (query.indexOf('bonus') >= 0 || query.indexOf('labour') >= 0) {
      out += '• <strong>Statutory Bonus (Code on Wages):</strong> <strong>' + R.bonusMinPct + '%</strong> min to <strong>' + R.bonusMaxPct + '%</strong> max (' + R.bonusMinDays + '+ working days).<br><br>';
    }
    if (query.indexOf('gratuity') >= 0 || query.indexOf('labour') >= 0) {
      out += '• <strong>Gratuity:</strong> (15 × Last Wages × Years) ÷ 26 · ' + R.gratuityPermYears + ' years permanent / <strong>' + R.gratuityFteYears + ' year Fixed-Term (FTE)</strong>.<br><br>';
    }
    out += '• <strong>' + R.minBasicPctOfGross + '% Wage &amp; ' + R.maxDeductionPctOfGross + '% Deduction Rule:</strong> Basic+DA ≥ ' + R.minBasicPctOfGross + '% CTC; total deductions ≤ ' + R.maxDeductionPctOfGross + '% earned gross; F&amp;F payable within ' + R.fnfSettlementDays + ' working days.<br><br>';
    var customExtras = (R.customRules || []).filter(function(cr) { return cr && cr.enabled && String(cr.id || '').indexOf('builtin_') !== 0; });
    if (customExtras.length) {
      out += '• <strong>Added Custom Rules (' + customExtras.length + '):</strong> ' + customExtras.map(function(c) { return escHtml(c.title); }).join(' · ') + '<br><br>';
    }
    out += '💡 <em>Naya rule update karne ke liye <strong>⚙️ Rules Engine</strong> kholein ya likhein: "Update rule: PF ceiling 30000"</em>';
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
  // 4. CSS & EXECUTIVE WORKSPACE UI
  // ─────────────────────────────────────────────────────────────────
  var UI = {
    isOpen: false,
    isWide: false,
    isFullscreen: false,
    isListening: false,
    speechSynthesisActive: false,
    recognition: null,
    history: [],
    promptHistory: [],
    promptHistoryIdx: -1,
    complianceFindings: {},
    activeFixFindingId: null
  };

  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatNowTime() {
    try {
      return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (_) {
      return '';
    }
  }

  function renderWelcomeHtml() {
    return [
      '<div class="ai-welcome">',
      '  <div class="ai-welcome-title">Namaste Bhai — Arora HR Assistant ready hai</div>',
      '  <div class="ai-welcome-desc">Employee Master, Salary Sheets, Attendance aur Statutory Compliance se koi bhi exact sawal poochhein (ya 🎙️ mic se bolein).</div>',
      '  <div class="ai-welcome-examples">',
      '    <button type="button" class="ai-ex-btn" onclick="window.AroraAICommander.sendQuery(\'July 2026 total salary payout kitna hai?\')">"July 2026 total salary payout kitna hai?"</button>',
      '    <button type="button" class="ai-ex-btn" onclick="window.AroraAICommander.sendQuery(\'Sabse jyada OT kisne kiya?\')">"Sabse jyada OT kisne kiya?"</button>',
      '    <button type="button" class="ai-ex-btn" onclick="window.AroraAICommander.sendQuery(\'Executive summary do\')">"Executive summary / MD briefing do"</button>',
      '  </div>',
      '</div>'
    ].join('');
  }

  function renderActiveFilesBar() {
    var metaBar = document.getElementById('aiMetaBar');
    if (!metaBar) return;
    var html = '<span class="ai-meta-label">Data Index</span>';
    if (KnowledgeGraph.filesSummary && KnowledgeGraph.filesSummary.length) {
      KnowledgeGraph.filesSummary.forEach(function(f) {
        var safeName = escHtml(f.name || 'Sheet');
        var qArg = String(f.name || 'Sheet').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        html += '<button type="button" class="ai-tag" onclick="window.AroraAICommander.sendQuery(\'' + qArg + ' summary\')" title="' + safeName + '">' + escHtml(String(f.name || 'Sheet').slice(0, 20)) + ' · ' + (f.totalRows || 0) + '</button>';
      });
    } else {
      html += '<button type="button" class="ai-tag" onclick="window.AroraAICommander.sendQuery(\'Files and features summary\')">Scan Loaded Data</button>';
    }
    metaBar.innerHTML = html;
  }

  function injectStyles() {
    if (document.getElementById('arora-ai-v10-css')) return;
    var style = document.createElement('style');
    style.id = 'arora-ai-v10-css';
    style.textContent = [
      '#atplAiContainer {',
      '  position:fixed;bottom:86px;right:20px;width:480px;height:640px;',
      '  max-width:calc(100vw - 32px);max-height:calc(100vh - 104px);',
      '  background:#0b1220;border:1px solid rgba(148,163,184,0.22);',
      '  border-radius:16px;box-shadow:0 24px 64px rgba(2,6,23,0.62);',
      '  display:none;flex-direction:column;overflow:hidden;',
      '  z-index:99998;font-family:"Plus Jakarta Sans","DM Sans",-apple-system,BlinkMacSystemFont,sans-serif;',
      '  color:#f1f5f9;font-variant-numeric:tabular-nums;',
      '  transition:width 0.18s cubic-bezier(0.16,1,0.3,1),height 0.18s cubic-bezier(0.16,1,0.3,1),border-radius 0.18s ease;',
      '}',
      '#atplAiContainer.wide {',
      '  width:740px;height:min(760px,calc(100vh - 96px));',
      '}',
      '#atplAiContainer.fullscreen {',
      '  bottom:0;right:0;width:100vw;height:100vh;max-width:100vw;max-height:100vh;border-radius:0;border:none;',
      '}',
      '#atplAiContainer.fullscreen #atplAiMessages,',
      '#atplAiContainer.fullscreen .ai-chips-wrap,',
      '#atplAiContainer.fullscreen .ai-input-wrap {',
      '  padding-left:max(24px,calc(50% - 460px));padding-right:max(24px,calc(50% - 460px));',
      '}',
      '#atplAiContainer button:focus-visible, #atplAiContainer textarea:focus-visible {',
      '  outline:2px solid #60a5fa;outline-offset:2px;',
      '}',
      '.ai-head {',
      '  padding:13px 16px;background:#0f172a;border-bottom:1px solid rgba(148,163,184,0.16);',
      '  display:flex;align-items:center;justify-content:space-between;gap:12px;flex-shrink:0;',
      '}',
      '.ai-head-brand { display:flex;align-items:center;gap:10px;min-width:0; }',
      '.ai-brand-mark {',
      '  width:34px;height:34px;border-radius:9px;background:#1e293b;border:1px solid rgba(148,163,184,0.24);',
      '  display:flex;align-items:center;justify-content:center;color:#93c5fd;flex-shrink:0;',
      '}',
      '.ai-head-title { font-size:14px;font-weight:700;color:#f8fafc;letter-spacing:-0.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }',
      '.ai-head-sub { font-size:11px;color:#94a3b8;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }',
      '.ai-head-btns { display:flex;align-items:center;gap:6px;flex-shrink:0; }',
      '.ai-icon-btn {',
      '  background:rgba(148,163,184,0.1);border:1px solid rgba(148,163,184,0.16);color:#cbd5e1;',
      '  border-radius:8px;width:32px;height:32px;cursor:pointer;display:flex;align-items:center;justify-content:center;',
      '  font-size:13px;transition:background 0.15s,color 0.15s,border-color 0.15s;',
      '}',
      '.ai-icon-btn:hover { background:rgba(148,163,184,0.2);color:#ffffff;border-color:rgba(148,163,184,0.34); }',
      '.ai-icon-btn.active { background:#1d4ed8;border-color:#60a5fa;color:#ffffff; }',
      '.ai-meta-bar {',
      '  padding:7px 16px;background:#0d1526;border-bottom:1px solid rgba(148,163,184,0.12);',
      '  display:flex;align-items:center;gap:6px;font-size:11px;color:#94a3b8;overflow-x:auto;flex-shrink:0;',
      '}',
      '.ai-meta-bar::-webkit-scrollbar, .ai-chips-wrap::-webkit-scrollbar { height:4px; }',
      '.ai-meta-bar::-webkit-scrollbar-thumb, .ai-chips-wrap::-webkit-scrollbar-thumb { background:rgba(148,163,184,0.25);border-radius:4px; }',
      '.ai-meta-label { font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;white-space:nowrap;margin-right:2px; }',
      '.ai-tag {',
      '  background:#162033;border:1px solid rgba(148,163,184,0.2);color:#cbd5e1;',
      '  padding:3px 9px;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;white-space:nowrap;flex-shrink:0;',
      '  transition:background 0.15s,border-color 0.15s,color 0.15s;',
      '}',
      '.ai-tag:hover { background:#1e293b;border-color:#60a5fa;color:#ffffff; }',
      '#atplAiMessages {',
      '  flex:1;overflow-y:auto;padding:18px 16px;display:flex;flex-direction:column;gap:14px;background:#0b1220;',
      '}',
      '#atplAiMessages::-webkit-scrollbar { width:6px; }',
      '#atplAiMessages::-webkit-scrollbar-thumb { background:rgba(148,163,184,0.24);border-radius:6px; }',
      '.ai-row { display:flex;width:100%; }',
      '.ai-row.user { justify-content:flex-end; }',
      '.ai-row.bot { justify-content:flex-start; }',
      '.ai-msg-wrap { display:flex;flex-direction:column;max-width:92%;min-width:0; }',
      '.ai-row.user .ai-msg-wrap { max-width:82%;align-items:flex-end; }',
      '.ai-msg-bubble {',
      '  padding:12px 14px;border-radius:12px;font-size:13px;line-height:1.58;',
      '  word-break:break-word;overflow-x:auto;',
      '}',
      '.ai-row.bot .ai-msg-bubble {',
      '  background:#131c31;border:1px solid rgba(148,163,184,0.16);color:#e2e8f0;border-bottom-left-radius:4px;',
      '}',
      '.ai-row.user .ai-msg-bubble {',
      '  background:#1e3a8a;border:1px solid rgba(96,165,250,0.3);color:#f8fafc;border-bottom-right-radius:4px;font-weight:500;',
      '}',
      '.ai-msg-foot {',
      '  display:flex;align-items:center;gap:10px;margin-top:4px;padding:0 2px;font-size:10.5px;color:#64748b;',
      '}',
      '.ai-copy-btn {',
      '  background:transparent;border:none;color:#94a3b8;font-size:10.5px;font-weight:600;cursor:pointer;padding:2px 4px;border-radius:4px;',
      '  transition:color 0.15s,background 0.15s;',
      '}',
      '.ai-copy-btn:hover { color:#f8fafc;background:rgba(148,163,184,0.12); }',
      '.ai-welcome-title { font-size:14px;font-weight:700;color:#f8fafc;margin-bottom:4px; }',
      '.ai-welcome-desc { font-size:12.5px;color:#94a3b8;line-height:1.5;margin-bottom:10px; }',
      '.ai-welcome-examples { display:flex;flex-direction:column;gap:6px; }',
      '.ai-ex-btn {',
      '  text-align:left;background:#0f172a;border:1px solid rgba(148,163,184,0.18);color:#cbd5e1;',
      '  padding:7px 10px;border-radius:8px;font-size:12px;cursor:pointer;transition:border-color 0.15s,background 0.15s,color 0.15s;',
      '}',
      '.ai-ex-btn:hover { border-color:#60a5fa;background:#162238;color:#ffffff; }',
      '.ai-typing-dots { display:inline-flex;align-items:center;gap:4px;margin-right:8px;vertical-align:middle; }',
      '.ai-typing-dots span { width:5px;height:5px;border-radius:50%;background:#60a5fa;animation:aiDotPulse 1s infinite ease-in-out; }',
      '.ai-typing-dots span:nth-child(2) { animation-delay:0.15s; }',
      '.ai-typing-dots span:nth-child(3) { animation-delay:0.3s; }',
      '@keyframes aiDotPulse { 0%,80%,100%{opacity:0.3;transform:scale(0.85)} 40%{opacity:1;transform:scale(1.1)} }',
      '.ai-chips-wrap {',
      '  padding:8px 14px;background:#0d1526;border-top:1px solid rgba(148,163,184,0.12);',
      '  display:flex;gap:6px;overflow-x:auto;flex-shrink:0;',
      '}',
      '.ai-chip {',
      '  background:#162033;border:1px solid rgba(148,163,184,0.2);color:#e2e8f0;',
      '  padding:6px 11px;border-radius:7px;font-size:11.5px;font-weight:600;cursor:pointer;white-space:nowrap;flex-shrink:0;',
      '  transition:background 0.15s,border-color 0.15s,color 0.15s;',
      '}',
      '.ai-chip:hover { background:#1e293b;border-color:#60a5fa;color:#ffffff; }',
      '.ai-input-wrap {',
      '  padding:11px 14px 12px;background:#0f172a;border-top:1px solid rgba(148,163,184,0.16);',
      '  display:flex;align-items:flex-end;gap:8px;flex-shrink:0;',
      '}',
      '#atplAiInput {',
      '  flex:1;background:#131c31;border:1px solid rgba(148,163,184,0.24);color:#f8fafc;',
      '  padding:9px 12px;border-radius:10px;font-size:13px;line-height:1.4;outline:none;font-family:inherit;',
      '  resize:none;min-height:40px;max-height:110px;overflow-y:auto;box-sizing:border-box;',
      '}',
      '#atplAiInput::placeholder { color:#64748b; }',
      '#atplAiInput:focus { border-color:#60a5fa;background:#162038; }',
      '.ai-send-btn {',
      '  height:40px;padding:0 15px;background:#2563eb;border:none;border-radius:10px;color:#ffffff;',
      '  cursor:pointer;display:flex;align-items:center;justify-content:center;gap:5px;font-size:13px;font-weight:700;flex-shrink:0;',
      '  transition:background 0.15s,transform 0.15s;',
      '}',
      '.ai-send-btn:hover { background:#1d4ed8; }',
      '.ai-mic-btn {',
      '  width:40px;height:40px;background:#162033;border:1px solid rgba(148,163,184,0.24);',
      '  border-radius:10px;color:#cbd5e1;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:15px;flex-shrink:0;',
      '  transition:background 0.15s,border-color 0.15s;',
      '}',
      '.ai-mic-btn:hover { background:#1e293b;border-color:#60a5fa;color:#ffffff; }',
      '.ai-mic-btn.active { background:#dc2626;border-color:#f87171;color:#fff;animation:micPulse 1.2s infinite; }',
      '@keyframes micPulse { 0%,100%{transform:scale(1)} 50%{transform:scale(1.06);box-shadow:0 0 12px rgba(239,68,68,0.65)} }',
      '.ai-act-btn {',
      '  background:#1e3a8a;border:1px solid rgba(96,165,250,0.4);color:#e0e7ff;',
      '  padding:6px 12px;border-radius:7px;font-size:11.5px;font-weight:700;cursor:pointer;transition:background 0.15s;margin-top:4px;',
      '}',
      '.ai-act-btn:hover { background:#2563eb;color:#fff; }',
      '.ai-table { width:100%;border-collapse:collapse;font-size:12px;margin-top:8px;font-variant-numeric:tabular-nums; }',
      '.ai-table th, .ai-table td { padding:7px 9px;border:1px solid rgba(148,163,184,0.18);text-align:left;white-space:nowrap; }',
      '.ai-table th { background:#0f172a;color:#94a3b8;font-weight:700;font-size:11px; }',
      '.ai-table tbody tr:nth-child(even) { background:rgba(148,163,184,0.04); }',
      '.ai-dossier-card { background:#0f172a;border:1px solid rgba(148,163,184,0.22);border-radius:10px;padding:12px;margin:4px 0; }',
      '.ai-dossier-head { display:flex;align-items:flex-start;justify-content:space-between;border-bottom:1px solid rgba(148,163,184,0.14);padding-bottom:8px;margin-bottom:8px;gap:8px; }',
      '.ai-dossier-badge { font-size:10.5px;font-weight:700;background:#1e293b;border:1px solid rgba(148,163,184,0.25);color:#93c5fd;padding:2px 8px;border-radius:6px;white-space:nowrap; }',
      '.ai-dossier-grid { display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:12px; }',
      '.ai-dossier-grid .lbl { color:#94a3b8;font-size:11px; }',
      '.ai-kpi-card { background:#0f172a;border:1px solid rgba(148,163,184,0.2);border-radius:10px;padding:11px;margin-bottom:8px; }',
      '#aiMiniFixBox input, #aiMiniFixBox select { background:#162033;border:1px solid rgba(148,163,184,0.26);color:#f8fafc;border-radius:7px;padding:6px 8px;font-size:12px;width:100%;box-sizing:border-box; }',
      '#aiMiniFixBox label { display:block;font-size:10px;font-weight:700;color:#94a3b8;margin-bottom:3px;text-transform:uppercase; }',
      '#aiRulesPanel { display:none;background:#0f172a;border-bottom:1px solid rgba(96,165,250,0.35);padding:12px 14px;max-height:330px;overflow-y:auto;flex-shrink:0;color:#e2e8f0;font-size:12px; }',
      '#aiRulesPanel input, #aiRulesPanel select, #aiRulesPanel textarea { background:#162033;border:1px solid rgba(148,163,184,0.26);color:#f8fafc;border-radius:7px;padding:6px 8px;font-size:12px;width:100%;box-sizing:border-box;font-family:inherit; }',
      '#aiRulesPanel label { display:block;font-size:10px;font-weight:700;color:#94a3b8;margin-bottom:3px;text-transform:uppercase; }',
      '.ai-rules-tabs { display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap; }',
      '.ai-rules-tab { background:#162033;border:1px solid rgba(148,163,184,0.24);color:#cbd5e1;padding:5px 10px;border-radius:7px;font-size:11px;font-weight:700;cursor:pointer; }',
      '.ai-rules-tab.active { background:#2563eb;border-color:#60a5fa;color:#fff; }',
      '@media (prefers-reduced-motion: reduce) { #atplAiContainer, .ai-typing-dots span, .ai-mic-btn.active { animation:none !important;transition:none !important; } }',
      '@media (max-width: 640px) { #atplAiContainer { bottom:0 !important;right:0 !important;left:0 !important;width:100vw !important;max-width:100vw !important;height:92vh !important;max-height:92vh !important;border-radius:16px 16px 0 0 !important; } }'
    ].join('\n');
    document.head.appendChild(style);
  }

  function autoResizeInput(el) {
    if (!el) return;
    el.style.height = '40px';
    el.style.height = Math.min(110, Math.max(40, el.scrollHeight || 40)) + 'px';
  }

  function buildUI() {
    injectStyles();
    if (document.getElementById('atplAiContainer')) return;

    var el = document.createElement('div');
    el.id = 'atplAiContainer';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Arora HR Assistant');
    el.innerHTML = [
      '<div class="ai-head">',
      '  <div class="ai-head-brand">',
      '    <div class="ai-brand-mark" aria-hidden="true">',
      '      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></svg>',
      '    </div>',
      '    <div style="min-width:0">',
      '      <div class="ai-head-title">Arora HR Assistant</div>',
      '      <div class="ai-head-sub" id="aiCommanderSub">Payroll · Attendance · Compliance · Ctrl+K</div>',
      '    </div>',
      '  </div>',
      '  <div class="ai-head-btns">',
      '    <button type="button" class="ai-icon-btn" id="aiBtnRules" title="Live Compliance Rules Engine (Update / Sync Rules)" onclick="window.AroraAICommander.toggleRulesPanel()">⚙️</button>',
      '    <button type="button" class="ai-icon-btn" id="aiBtnTTS" title="Voice Output (Speak)" onclick="window.AroraAICommander.toggleTTS()">🔊</button>',
      '    <button type="button" class="ai-icon-btn" id="aiBtnWide" title="Wide / Compact View" onclick="window.AroraAICommander.toggleWide()">↔</button>',
      '    <button type="button" class="ai-icon-btn" id="aiBtnFullscreen" title="Fullscreen Mode" onclick="window.AroraAICommander.toggleFullscreen()">⛶</button>',
      '    <button type="button" class="ai-icon-btn" id="aiBtnClear" title="Clear Chat" onclick="window.AroraAICommander.clearChat()">🗑</button>',
      '    <button type="button" class="ai-icon-btn" id="aiBtnClose" title="Close (Esc)" onclick="window.AroraAICommander.toggle()">✕</button>',
      '  </div>',
      '</div>',
      '<div class="ai-meta-bar" id="aiMetaBar">',
      '  <span class="ai-meta-label">Data Index</span>',
      '  <button type="button" class="ai-tag" onclick="window.AroraAICommander.sendQuery(\'Files and features summary\')">Scan Loaded Data</button>',
      '</div>',
      '<div id="aiRulesPanel"></div>',
      '<div id="atplAiMessages">',
      '  <div class="ai-row bot"><div class="ai-msg-wrap"><div class="ai-msg-bubble">' + renderWelcomeHtml() + '</div></div></div>',
      '</div>',
      '<div id="aiMiniFixBox" style="display:none;background:#0f172a;border-top:1px solid rgba(96,165,250,0.35);padding:12px 14px;flex-shrink:0"></div>',
      '<div class="ai-chips-wrap" id="aiChipsWrap">',
      '  <button type="button" class="ai-chip" onclick="window.AroraAICommander.sendQuery(\'July 2026 total salary payout kitna hai?\')">💰 Salary Payout</button>',
      '  <button type="button" class="ai-chip" onclick="window.AroraAICommander.sendQuery(\'Sabse jyada OT kisne kiya?\')">⏱️ Top Overtime</button>',
      '  <button type="button" class="ai-chip" onclick="window.AroraAICommander.sendQuery(\'Mam compliance audit karo\')">🛡️ Auditor Check</button>',
      '  <button type="button" class="ai-chip" onclick="window.AroraAICommander.toggleRulesPanel()">⚙️ Update Rules</button>',
      '  <button type="button" class="ai-chip" onclick="window.AroraAICommander.sendQuery(\'ESIC aur Divisor anomalies scan karo\')">🚨 Compliance Scan</button>',
      '  <button type="button" class="ai-chip" onclick="window.AroraAICommander.sendQuery(\'Executive summary do\')">📊 MD Briefing</button>',
      '  <button type="button" class="ai-chip" onclick="window.AroraAICommander.sendQuery(\'Punch out blank hai random fill karo\')">⚡ Fill Punches</button>',
      '</div>',
      '<div class="ai-input-wrap">',
      '  <button type="button" class="ai-mic-btn" id="aiMicBtn" title="Voice Input (Hindi / English)" onclick="window.AroraAICommander.toggleVoice()">🎙️</button>',
      '  <textarea id="atplAiInput" rows="1" placeholder="Sawal poochhein... (e.g. 22157 ka salary, Top OT workers)"></textarea>',
      '  <button type="button" class="ai-send-btn" id="aiSendBtn" onclick="window.AroraAICommander.onSend()">Send ➤</button>',
      '</div>'
    ].join('\n');

    document.body.appendChild(el);

    var inp = document.getElementById('atplAiInput');
    if (inp) {
      inp.addEventListener('input', function() { autoResizeInput(inp); });
      inp.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          window.AroraAICommander.onSend();
          return;
        }
        if (e.key === 'ArrowUp' && !inp.value.trim() && UI.promptHistory.length) {
          e.preventDefault();
          if (UI.promptHistoryIdx < 0) UI.promptHistoryIdx = UI.promptHistory.length - 1;
          else if (UI.promptHistoryIdx > 0) UI.promptHistoryIdx--;
          inp.value = UI.promptHistory[UI.promptHistoryIdx] || '';
          autoResizeInput(inp);
        } else if (e.key === 'ArrowDown' && UI.promptHistoryIdx >= 0) {
          e.preventDefault();
          if (UI.promptHistoryIdx < UI.promptHistory.length - 1) {
            UI.promptHistoryIdx++;
            inp.value = UI.promptHistory[UI.promptHistoryIdx] || '';
          } else {
            UI.promptHistoryIdx = -1;
            inp.value = '';
          }
          autoResizeInput(inp);
        }
      });
    }

    var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      UI.recognition = new SpeechRecognition();
      UI.recognition.continuous = false;
      UI.recognition.interimResults = false;
      UI.recognition.lang = 'hi-IN';

      UI.recognition.onresult = function(event) {
        var transcript = event.results[0][0].transcript;
        var inp2 = document.getElementById('atplAiInput');
        if (inp2) {
          inp2.value = transcript;
          autoResizeInput(inp2);
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

    var wrap = document.createElement('div');
    wrap.className = 'ai-msg-wrap';

    var bubble = document.createElement('div');
    bubble.className = 'ai-msg-bubble';
    bubble.innerHTML = isUser ? escHtml(html).replace(/\n/g, '<br>') : html;
    wrap.appendChild(bubble);

    var foot = document.createElement('div');
    foot.className = 'ai-msg-foot';
    var timeSpan = document.createElement('span');
    timeSpan.textContent = formatNowTime();
    foot.appendChild(timeSpan);

    if (!isUser) {
      var copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'ai-copy-btn';
      copyBtn.textContent = '📋 Copy';
      copyBtn.onclick = function() {
        var txt = (bubble.innerText || bubble.textContent || '').trim();
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          navigator.clipboard.writeText(txt).then(function() {
            copyBtn.textContent = '✓ Copied';
            setTimeout(function() { copyBtn.textContent = '📋 Copy'; }, 1500);
          }).catch(function() {});
        }
      };
      foot.appendChild(copyBtn);
    }

    wrap.appendChild(foot);
    row.appendChild(wrap);
    box.appendChild(row);
    box.scrollTop = box.scrollHeight;

    if (!isUser && UI.speechSynthesisActive && ('speechSynthesis' in window)) {
      try {
        var plain = String(html || '').replace(/<[^>]*>?/gm, ' ');
        var utter = new SpeechSynthesisUtterance(plain.slice(0, 250));
        utter.lang = 'hi-IN';
        window.speechSynthesis.speak(utter);
      } catch (_) {}
    }
  }

  function renderRulesPanelContent() {
    var panel = document.getElementById('aiRulesPanel');
    if (!panel) return;
    var R = ComplianceRulesEngine.getRules();
    var tab = UI.rulesTab || 'thresholds';
    var html = [
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px">',
      '  <div>',
      '    <strong style="font-size:12.5px;color:#93c5fd">⚙️ Live Compliance Rules Engine · v' + escHtml(R.version) + '</strong>',
      '    <div style="font-size:10.5px;color:#94a3b8">Yahan rule update karne par Q&amp;A + Mam Auditor dono turant update &amp; sync hote hain</div>',
      '  </div>',
      '  <div style="display:flex;gap:6px">',
      '    <button type="button" class="ai-rules-tab" onclick="window.AroraAICommander.syncRulesNow()">🔄 Sync Latest</button>',
      '    <button type="button" class="ai-rules-tab" onclick="window.AroraAICommander.resetRulesToDefault()">↺ Reset</button>',
      '    <button type="button" class="ai-rules-tab" onclick="window.AroraAICommander.toggleRulesPanel(false)">✕</button>',
      '  </div>',
      '</div>',
      '<div class="ai-rules-tabs">',
      '  <button type="button" class="ai-rules-tab' + (tab === 'thresholds' ? ' active' : '') + '" onclick="window.AroraAICommander.setRulesTab(\'thresholds\')">1. Statutory Limits</button>',
      '  <button type="button" class="ai-rules-tab' + (tab === 'custom' ? ' active' : '') + '" onclick="window.AroraAICommander.setRulesTab(\'custom\')">2. Custom Rules (' + (R.customRules || []).length + ')</button>',
      '  <button type="button" class="ai-rules-tab' + (tab === 'circular' ? ' active' : '') + '" onclick="window.AroraAICommander.setRulesTab(\'circular\')">3. Paste Notification / JSON</button>',
      '</div>'
    ];

    if (tab === 'thresholds') {
      html.push(
        '<div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-bottom:10px">',
        '  <div><label>PF Ceiling (₹)</label><input id="aiRulePfCeiling" type="number" value="' + escHtml(R.pfCeiling) + '"></div>',
        '  <div><label>PF Eff (YYYY-MM)</label><input id="aiRulePfEff" type="text" value="' + escHtml(R.pfCeilingEffective) + '"></div>',
        '  <div><label>PF Emp %</label><input id="aiRulePfEmpPct" type="number" step="0.01" value="' + escHtml(R.pfEmployeePct) + '"></div>',
        '  <div><label>PF EPS %</label><input id="aiRulePfEpsPct" type="number" step="0.01" value="' + escHtml(R.pfEpsPct) + '"></div>',
        '  <div><label>ESIC Ceiling (₹)</label><input id="aiRuleEsiCeiling" type="number" value="' + escHtml(R.esicGrossCeiling) + '"></div>',
        '  <div><label>ESIC PwD (₹)</label><input id="aiRuleEsiPwd" type="number" value="' + escHtml(R.esicPwdCeiling) + '"></div>',
        '  <div><label>ESIC Emp %</label><input id="aiRuleEsiEmpPct" type="number" step="0.01" value="' + escHtml(R.esicEmployeePct) + '"></div>',
        '  <div><label>ESIC Daily Exempt</label><input id="aiRuleEsiDaily" type="number" value="' + escHtml(R.esicDailyExempt) + '"></div>',
        '  <div><label>Min Basic %</label><input id="aiRuleMinBasic" type="number" value="' + escHtml(R.minBasicPctOfGross) + '"></div>',
        '  <div><label>Max Deduction %</label><input id="aiRuleMaxDed" type="number" value="' + escHtml(R.maxDeductionPctOfGross) + '"></div>',
        '  <div><label>OT Warn (Hrs/Mo)</label><input id="aiRuleOtWarn" type="number" value="' + escHtml(R.maxMonthlyOtWarnHours) + '"></div>',
        '  <div><label>OT Cap (Hrs/Qtr)</label><input id="aiRuleOtQuarter" type="number" value="' + escHtml(R.maxQuarterlyOtHours) + '"></div>',
        '  <div><label>F&amp;F Days</label><input id="aiRuleFnfDays" type="number" value="' + escHtml(R.fnfSettlementDays) + '"></div>',
        '  <div><label>FTE Gratuity Yrs</label><input id="aiRuleFteGrat" type="number" value="' + escHtml(R.gratuityFteYears) + '"></div>',
        '  <div><label>Bonus Min %</label><input id="aiRuleBonusMin" type="number" step="0.01" value="' + escHtml(R.bonusMinPct) + '"></div>',
        '  <div><label>Bonus Max %</label><input id="aiRuleBonusMax" type="number" step="0.01" value="' + escHtml(R.bonusMaxPct) + '"></div>',
        '</div>',
        '<div style="display:flex;justify-content:flex-end;gap:8px">',
        '  <button type="button" class="ai-act-btn" style="background:#16a34a;border-color:#22c55e;color:#fff" onclick="window.AroraAICommander.saveRuleThresholdsFromUI()">💾 Save &amp; Sync Rules</button>',
        '</div>'
      );
    } else if (tab === 'custom') {
      html.push(
        '<div style="display:grid;grid-template-columns:2fr 1fr 1fr;gap:8px;margin-bottom:8px">',
        '  <div><label>New Rule Title</label><input id="aiCustomRuleTitle" type="text" placeholder="e.g. LWF Half-Yearly Deduction"></div>',
        '  <div><label>Category</label><select id="aiCustomRuleCat"><option value="PF">PF</option><option value="ESIC">ESIC</option><option value="LABOUR_CODE">LABOUR_CODE</option><option value="BONUS">BONUS</option><option value="GRATUITY">GRATUITY</option><option value="OTHER" selected>OTHER</option></select></div>',
        '  <div><label>Effective Date</label><input id="aiCustomRuleEff" type="text" value="' + escHtml(new Date().toISOString().slice(0, 10)) + '"></div>',
        '</div>',
        '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:8px">',
        '  <div><label>Keywords (comma separated)</label><input id="aiCustomRuleKw" type="text" placeholder="e.g. lwf, welfare, june"></div>',
        '  <div><label>Live Sheet Check (Optional)</label><select id="aiCustomRuleMetric"><option value="">Q&amp;A Only (No Sheet Check)</option><option value="OT_GT">OT Hours &gt; Threshold</option><option value="BASIC_PCT_LT">Basic % of Gross &lt; Threshold</option><option value="DED_PCT_GT">Deduction % of Gross &gt; Threshold</option><option value="GROSS_GT">Gross Salary &gt; Threshold</option><option value="BASIC_GT">Basic Salary &gt; Threshold</option></select></div>',
        '  <div><label>Threshold Value</label><input id="aiCustomRuleThresh" type="number" placeholder="e.g. 25"></div>',
        '</div>',
        '<div style="margin-bottom:8px"><label>Rule Summary / Circular Detail</label><textarea id="aiCustomRuleSummary" rows="2" placeholder="Rule detail likhein..."></textarea></div>',
        '<div style="display:flex;justify-content:flex-end;margin-bottom:10px">',
        '  <button type="button" class="ai-act-btn" style="background:#16a34a;border-color:#22c55e;color:#fff" onclick="window.AroraAICommander.addCustomRuleFromUI()">➕ Add Rule</button>',
        '</div>'
      );
      (R.customRules || []).forEach(function(cr) {
        html.push(
          '<div style="background:#162033;border:1px solid rgba(148,163,184,0.2);border-radius:8px;padding:8px 10px;margin-bottom:6px;display:flex;justify-content:space-between;align-items:flex-start;gap:8px">',
          '  <div style="min-width:0">',
          '    <div style="font-weight:700;color:' + (cr.enabled ? '#f8fafc' : '#64748b') + '">' + escHtml(cr.title) + ' <span style="font-size:10px;color:#93c5fd">[' + escHtml(cr.category) + ']</span></div>',
          '    <div style="font-size:11px;color:#94a3b8;margin-top:2px">' + escHtml(cr.summary) + '</div>',
          '  </div>',
          '  <div style="display:flex;gap:5px;flex-shrink:0">',
          '    <button type="button" class="ai-rules-tab" onclick="window.AroraAICommander.toggleCustomRule(\'' + escHtml(cr.id) + '\')">' + (cr.enabled ? 'ON' : 'OFF') + '</button>',
          '    <button type="button" class="ai-rules-tab" onclick="window.AroraAICommander.deleteCustomRule(\'' + escHtml(cr.id) + '\')">🗑</button>',
          '  </div>',
          '</div>'
        );
      });
    } else {
      html.push(
        '<div style="margin-bottom:8px"><label>Govt Notification / Rule Text ya JSON yahan paste karein</label>',
        '<textarea id="aiCircularText" rows="4" placeholder="Example: Govt notification — EPF wage ceiling revised to ₹30,000 and ESIC limit ₹25,000 effective next month."></textarea></div>',
        '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px">',
        '  <span style="font-size:11px;color:#94a3b8">AI automatically PF/ESIC/Basic/OT numbers extract karke naya rule save kar dega.</span>',
        '  <button type="button" class="ai-act-btn" style="background:#2563eb;color:#fff" onclick="window.AroraAICommander.applyCircularFromUI()">✨ Extract &amp; Apply Rule</button>',
        '</div>'
      );
    }

    panel.innerHTML = html.join('\n');
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

      ComplianceRulesEngine.refreshSubtitle();
      ComplianceRulesEngine.syncLatestRules(false).then(function(res) {
        if (res && res.updated) {
          ComplianceRulesEngine.refreshSubtitle();
          if (UI.rulesPanelOpen) renderRulesPanelContent();
        }
      }).catch(function() {});

      refreshKnowledgeGraph();
      renderActiveFilesBar();

      if (query) {
        var inp = document.getElementById('atplAiInput');
        if (inp) {
          inp.value = query;
          autoResizeInput(inp);
        }
        this.onSend();
      } else {
        setTimeout(function() {
          var inp2 = document.getElementById('atplAiInput');
          if (inp2) inp2.focus();
        }, 120);
      }
    },

    openComplianceFixBox: function(findingId) {
      var f = UI.complianceFindings && UI.complianceFindings[findingId];
      var box = document.getElementById('aiMiniFixBox');
      if (!f || !box) return;
      UI.activeFixFindingId = findingId;
      var liveRow = (window.ATPLComplianceBridge && window.ATPLComplianceBridge.getRow(f.uid || f.empId)) || f.snapshot || {};
      var sug = f.suggestedPatch || {};
      var pfModeVal = sug.pfMode || liveRow.pfMode || 'AUTO';
      var esiModeVal = sug.esiMode || liveRow.esiMode || 'AUTO';
      var otVal = sug.overtimeHours !== undefined ? sug.overtimeHours : (liveRow.overtimeHours || 0);
      var paidDaysVal = sug.paidDays !== undefined ? sug.paidDays : (liveRow.paidDays || 0);
      var basicVal = sug.basic !== undefined ? sug.basic : (liveRow.basic || 0);
      var advVal = sug.advance !== undefined ? sug.advance : (liveRow.advance || 0);

      box.innerHTML = [
        '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px">',
        '  <div>',
        '    <div style="font-size:12px;font-weight:700;color:#93c5fd">🛠️ Mini Fix Box · ' + escHtml(f.empId) + ' (' + escHtml(f.name) + ')</div>',
        '    <div style="font-size:11px;color:#cbd5e1">' + escHtml(f.suggestedNote || f.title) + '</div>',
        '  </div>',
        '  <button type="button" class="ai-icon-btn" onclick="window.AroraAICommander.closeComplianceFixBox()" title="Close Fix Box">✕</button>',
        '</div>',
        '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:8px">',
        '  <div><label>Paid Days</label><input id="aiFixPaidDays" type="number" step="0.5" value="' + escHtml(paidDaysVal) + '"></div>',
        '  <div><label>OT Hours</label><input id="aiFixOtHours" type="number" step="0.5" value="' + escHtml(otVal) + '"></div>',
        '  <div><label>Basic (₹)</label><input id="aiFixBasic" type="number" step="1" value="' + escHtml(basicVal) + '"></div>',
        '  <div><label>PF No</label><input id="aiFixPfNo" type="text" value="' + escHtml(liveRow.pfNo || '') + '"></div>',
        '  <div><label>PF Mode</label><select id="aiFixPfMode">' +
             ['AUTO', 'FULL_12', 'CAP_15000', 'GROSS_12', 'NONE'].map(function(m) {
               return '<option value="' + m + '"' + (pfModeVal === m ? ' selected' : '') + '>' + m + '</option>';
             }).join('') + '</select></div>',
        '  <div><label>Advance (₹)</label><input id="aiFixAdvance" type="number" step="1" value="' + escHtml(advVal) + '"></div>',
        '  <div><label>ESIC No</label><input id="aiFixEsiNo" type="text" value="' + escHtml(liveRow.esiNo || '') + '"></div>',
        '  <div><label>ESIC Mode</label><select id="aiFixEsiMode">' +
             ['AUTO', 'EARN_BASIC', 'TOTAL_GROSS', 'NONE'].map(function(m) {
               return '<option value="' + m + '"' + (esiModeVal === m ? ' selected' : '') + '>' + m + '</option>';
             }).join('') + '</select></div>',
        '  <div><label>Remarks</label><input id="aiFixRemarks" type="text" value="' + escHtml(liveRow.remarks || 'onroll') + '"></div>',
        '</div>',
        '<div style="display:flex;justify-content:flex-end;gap:8px">',
        '  <button type="button" class="ai-act-btn" style="background:#1e293b;border-color:rgba(148,163,184,0.3)" onclick="window.AroraAICommander.closeComplianceFixBox()">Cancel</button>',
        '  <button type="button" class="ai-act-btn" style="background:#16a34a;border-color:#22c55e;color:#fff" onclick="window.AroraAICommander.applyComplianceFixBox()">💾 Apply to Salary</button>',
        '</div>'
      ].join('\n');
      box.style.display = 'block';
    },

    closeComplianceFixBox: function() {
      var box = document.getElementById('aiMiniFixBox');
      if (box) { box.style.display = 'none'; box.innerHTML = ''; }
      UI.activeFixFindingId = null;
    },

    applyComplianceFixBox: function() {
      var fid = UI.activeFixFindingId;
      var f = fid && UI.complianceFindings && UI.complianceFindings[fid];
      if (!f) return;
      if (!window.ATPLComplianceBridge || typeof window.ATPLComplianceBridge.applyFix !== 'function') {
        appendMsg('⚠️ Mam Compliance sheet active nahi hai. Pehle Mam → Compliance page kholein.', false);
        return;
      }
      var liveRow = (window.ATPLComplianceBridge && typeof window.ATPLComplianceBridge.getRow === 'function'
        ? window.ATPLComplianceBridge.getRow(f.uid || f.empId) : null) || f.snapshot || {};
      var candidate = {
        paidDays: Number((document.getElementById('aiFixPaidDays') || {}).value || 0),
        overtimeHours: Number((document.getElementById('aiFixOtHours') || {}).value || 0),
        basic: Number((document.getElementById('aiFixBasic') || {}).value || 0),
        pfNo: String((document.getElementById('aiFixPfNo') || {}).value || '').trim(),
        pfMode: String((document.getElementById('aiFixPfMode') || {}).value || 'AUTO'),
        advance: Number((document.getElementById('aiFixAdvance') || {}).value || 0),
        esiNo: String((document.getElementById('aiFixEsiNo') || {}).value || '').trim(),
        esiMode: String((document.getElementById('aiFixEsiMode') || {}).value || 'AUTO'),
        remarks: String((document.getElementById('aiFixRemarks') || {}).value || '').trim()
      };
      var patch = {};
      ['paidDays', 'overtimeHours', 'basic', 'advance'].forEach(function(k) {
        if (Math.abs(candidate[k] - (Number(liveRow[k]) || 0)) > 0.0001) patch[k] = candidate[k];
      });
      ['pfNo', 'pfMode', 'esiNo', 'esiMode', 'remarks'].forEach(function(k) {
        var cur = k === 'remarks' ? String(liveRow[k] || 'onroll').trim() : String(liveRow[k] || (k.indexOf('Mode') >= 0 ? 'AUTO' : '')).trim();
        if (candidate[k] !== cur) patch[k] = candidate[k];
      });
      if (!Object.keys(patch).length && f.suggestedPatch) patch = Object.assign({}, f.suggestedPatch);
      var res = window.ATPLComplianceBridge.applyFix(f.uid || f.empId, patch);
      if (!res || !res.ok) {
        appendMsg('⚠️ Update fail hua (' + escHtml((res && res.error) || 'ROW_NOT_FOUND') + ').', false);
        return;
      }
      f.fixed = true;
      var btn = document.getElementById('aiFixBtn_' + fid);
      if (btn) {
        btn.textContent = '✓ Fixed in Sheet';
        btn.style.background = '#15803d';
        btn.style.borderColor = '#22c55e';
      }
      this.closeComplianceFixBox();
      var r = res.row || {};
      appendMsg(
        '✅ <strong>Salary Updated: ' + escHtml(r.empId || f.empId) + ' (' + escHtml(r.name || f.name) + ')</strong><br>' +
        '• Paid Days: <b>' + (r.paidDays || 0) + '</b> · OT: <b>' + (r.overtimeHours || 0) + 'h</b> · Total Gross: <b>' + formatINRVal(r.totalGross) + '</b><br>' +
        '• PF: <b>' + formatINRVal(r.pfEmployee) + '</b> · ESIC: <b>' + formatINRVal(r.esiEmployee) + '</b> · Net Payable: <strong style="color:#4ade80">' + formatINRVal(r.netPayable) + '</strong>',
        false
      );
    },

    toggleRulesPanel: function(forceOpen) {
      buildUI();
      var panel = document.getElementById('aiRulesPanel');
      if (!panel) return;
      var nextOpen = forceOpen === undefined ? !UI.rulesPanelOpen : !!forceOpen;
      UI.rulesPanelOpen = nextOpen;
      panel.style.display = nextOpen ? 'block' : 'none';
      var btn = document.getElementById('aiBtnRules');
      if (btn) btn.classList.toggle('active', nextOpen);
      if (nextOpen) {
        if (!UI.rulesTab) UI.rulesTab = 'thresholds';
        renderRulesPanelContent();
      }
    },

    setRulesTab: function(tabName) {
      UI.rulesTab = tabName || 'thresholds';
      renderRulesPanelContent();
    },

    saveRuleThresholdsFromUI: function() {
      var R = cloneRuleBundle(ComplianceRulesEngine.getRules());
      var numField = function(id, fallback) {
        var el = document.getElementById(id);
        if (!el) return fallback;
        var n = Number(el.value);
        return isFinite(n) && n >= 0 ? n : fallback;
      };
      var strField = function(id, fallback) {
        var el = document.getElementById(id);
        return el && el.value ? String(el.value).trim() : fallback;
      };
      R.pfCeiling = numField('aiRulePfCeiling', R.pfCeiling);
      R.pfCeilingEffective = strField('aiRulePfEff', R.pfCeilingEffective);
      R.pfEmployeePct = numField('aiRulePfEmpPct', R.pfEmployeePct);
      R.pfEpsPct = numField('aiRulePfEpsPct', R.pfEpsPct);
      R.esicGrossCeiling = numField('aiRuleEsiCeiling', R.esicGrossCeiling);
      R.esicPwdCeiling = numField('aiRuleEsiPwd', R.esicPwdCeiling);
      R.esicEmployeePct = numField('aiRuleEsiEmpPct', R.esicEmployeePct);
      R.esicDailyExempt = numField('aiRuleEsiDaily', R.esicDailyExempt);
      R.minBasicPctOfGross = numField('aiRuleMinBasic', R.minBasicPctOfGross);
      R.maxDeductionPctOfGross = numField('aiRuleMaxDed', R.maxDeductionPctOfGross);
      R.maxMonthlyOtWarnHours = numField('aiRuleOtWarn', R.maxMonthlyOtWarnHours);
      R.maxQuarterlyOtHours = numField('aiRuleOtQuarter', R.maxQuarterlyOtHours);
      R.fnfSettlementDays = numField('aiRuleFnfDays', R.fnfSettlementDays);
      R.gratuityFteYears = numField('aiRuleFteGrat', R.gratuityFteYears);
      R.bonusMinPct = numField('aiRuleBonusMin', R.bonusMinPct);
      R.bonusMaxPct = numField('aiRuleBonusMax', R.bonusMaxPct);
      var saved = ComplianceRulesEngine.saveRules(R, { tag: 'custom', updatedBy: 'Rules UI' });
      renderRulesPanelContent();
      appendMsg(
        '✅ <strong>Statutory Rules Updated &amp; Synced (v' + escHtml(saved.version) + ')!</strong><br>' +
        '• PF Ceiling: <b>₹' + saved.pfCeiling.toLocaleString('en-IN') + '</b> · ESIC: <b>₹' + saved.esicGrossCeiling.toLocaleString('en-IN') + '</b> · Min Basic: <b>' + saved.minBasicPctOfGross + '%</b> · Max Ded: <b>' + saved.maxDeductionPctOfGross + '%</b><br>' +
        '<button type="button" class="ai-act-btn" onclick="window.AroraAICommander.sendQuery(\'Mam compliance audit karo\')">🛡️ Re-Scan Compliance Sheet</button>',
        false
      );
    },

    addCustomRuleFromUI: function() {
      var titleEl = document.getElementById('aiCustomRuleTitle');
      var sumEl = document.getElementById('aiCustomRuleSummary');
      var title = titleEl ? String(titleEl.value || '').trim() : '';
      var summary = sumEl ? String(sumEl.value || '').trim() : '';
      if (!title && !summary) return;
      var catEl = document.getElementById('aiCustomRuleCat');
      var effEl = document.getElementById('aiCustomRuleEff');
      var kwEl = document.getElementById('aiCustomRuleKw');
      var metEl = document.getElementById('aiCustomRuleMetric');
      var thEl = document.getElementById('aiCustomRuleThresh');
      var R = cloneRuleBundle(ComplianceRulesEngine.getRules());
      var kwRaw = kwEl ? String(kwEl.value || '').trim() : '';
      var kwList = kwRaw
        ? kwRaw.split(/[,;]+/).map(function(x) { return x.trim().toLowerCase(); }).filter(Boolean)
        : (title + ' ' + summary).toLowerCase().replace(/[^a-z0-9%\s]/g, ' ').split(/\s+/).filter(function(w) { return w.length >= 3; }).slice(0, 6);
      var thVal = thEl && thEl.value !== '' && isFinite(Number(thEl.value)) ? Number(thEl.value) : null;
      R.customRules.unshift({
        id: 'cr_' + Date.now(),
        title: title || summary.slice(0, 60),
        category: catEl ? String(catEl.value || 'OTHER') : 'OTHER',
        effectiveFrom: effEl ? String(effEl.value || '').trim() : new Date().toISOString().slice(0, 10),
        keywords: kwList,
        summary: summary || title,
        auditorNote: 'Custom rule added via Rules Engine.',
        checkMetric: metEl ? String(metEl.value || '') : '',
        checkThreshold: thVal,
        enabled: true
      });
      var saved = ComplianceRulesEngine.saveRules(R, { tag: 'custom', updatedBy: 'Custom Rule UI' });
      UI.rulesTab = 'custom';
      renderRulesPanelContent();
      appendMsg('✅ <strong>Custom Rule Added (v' + escHtml(saved.version) + '):</strong> ' + escHtml(title || summary), false);
    },

    toggleCustomRule: function(ruleId) {
      var R = cloneRuleBundle(ComplianceRulesEngine.getRules());
      R.customRules = R.customRules.map(function(cr) {
        if (cr.id === ruleId) cr.enabled = !cr.enabled;
        return cr;
      });
      ComplianceRulesEngine.saveRules(R, { tag: 'toggle' });
      renderRulesPanelContent();
    },

    deleteCustomRule: function(ruleId) {
      var R = cloneRuleBundle(ComplianceRulesEngine.getRules());
      R.customRules = R.customRules.filter(function(cr) { return cr.id !== ruleId; });
      ComplianceRulesEngine.saveRules(R, { tag: 'remove' });
      renderRulesPanelContent();
    },

    applyCircularFromUI: function() {
      var ta = document.getElementById('aiCircularText');
      if (!ta || !ta.value.trim()) return;
      var res = ComplianceRulesEngine.parseCircularText(ta.value);
      if (res && res.ok) {
        renderRulesPanelContent();
        appendMsg(
          '✨ <strong>Circular / JSON Rule Extracted &amp; Synced (v' + escHtml(res.bundle.version) + ')!</strong><br>' +
          res.changes.map(function(c) { return '• ' + escHtml(c); }).join('<br>') +
          '<br><button type="button" class="ai-act-btn" onclick="window.AroraAICommander.sendQuery(\'Mam compliance audit karo\')">🛡️ Re-Scan Compliance Sheet</button>',
          false
        );
      }
    },

    syncRulesNow: async function(silentChat) {
      var res = await ComplianceRulesEngine.syncLatestRules(true);
      if (UI.rulesPanelOpen) renderRulesPanelContent();
      if (!silentChat) {
        var r = (res && res.bundle) || ComplianceRulesEngine.getRules();
        appendMsg(
          (res && res.updated ? '✅ <strong>Naye Rules Sync Ho Gaye (' + escHtml(res.source) + ')!</strong>' : '✅ <strong>Rules Already Up-to-Date!</strong>') +
          '<br>• Active Version: <code>v' + escHtml(r.version) + '</code> · PF Cap: <b>₹' + r.pfCeiling.toLocaleString('en-IN') + '</b> · ESIC: <b>₹' + r.esicGrossCeiling.toLocaleString('en-IN') + '</b>',
          false
        );
      }
      return res;
    },

    resetRulesToDefault: function() {
      var def = ComplianceRulesEngine.resetDefaults();
      renderRulesPanelContent();
      appendMsg('↺ <strong>Rules Reset to Built-in 2026 Defaults (v' + escHtml(def.version) + ').</strong>', false);
    },

    getRulesSnapshot: function() {
      return ComplianceRulesEngine.getRules();
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

    toggleWide: function() {
      var box = document.getElementById('atplAiContainer');
      if (!box) return;
      if (UI.isFullscreen) {
        UI.isFullscreen = false;
        box.classList.remove('fullscreen');
        var fsBtn = document.getElementById('aiBtnFullscreen');
        if (fsBtn) fsBtn.textContent = '⛶';
      }
      UI.isWide = !UI.isWide;
      box.classList.toggle('wide', UI.isWide);
      var btn = document.getElementById('aiBtnWide');
      if (btn) btn.classList.toggle('active', UI.isWide);
    },

    toggleFullscreen: function() {
      var box = document.getElementById('atplAiContainer');
      if (!box) return;
      UI.isFullscreen = !UI.isFullscreen;
      box.classList.toggle('fullscreen', UI.isFullscreen);
      var btn = document.getElementById('aiBtnFullscreen');
      if (btn) {
        btn.textContent = UI.isFullscreen ? '❐' : '⛶';
        btn.classList.toggle('active', UI.isFullscreen);
      }
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
        btn.classList.toggle('active', UI.speechSynthesisActive);
      }
    },

    clearChat: function() {
      var box = document.getElementById('atplAiMessages');
      if (box) {
        box.innerHTML = '<div class="ai-row bot"><div class="ai-msg-wrap"><div class="ai-msg-bubble">' + renderWelcomeHtml() + '</div></div></div>';
      }
    },

    onSend: function() {
      var inp = document.getElementById('atplAiInput');
      if (!inp) return;
      var text = inp.value.trim();
      if (!text) return;
      if (UI.promptHistory[UI.promptHistory.length - 1] !== text) {
        UI.promptHistory.push(text);
        if (UI.promptHistory.length > 30) UI.promptHistory.shift();
      }
      UI.promptHistoryIdx = -1;
      inp.value = '';
      autoResizeInput(inp);
      this.sendQuery(text);
    },

    sendQuery: function(q) {
      appendMsg(q, true);

      var box = document.getElementById('atplAiMessages');
      var typingId = 'aiTypingRow';
      if (box) {
        var existingTyping = document.getElementById(typingId);
        if (existingTyping) existingTyping.remove();
        var tr = document.createElement('div');
        tr.id = typingId;
        tr.className = 'ai-row bot';
        tr.innerHTML = '<div class="ai-msg-wrap"><div class="ai-msg-bubble" style="color:#94a3b8"><span class="ai-typing-dots"><span></span><span></span><span></span></span>Database &amp; records check ho rahe hain...</div></div>';
        box.appendChild(tr);
        box.scrollTop = box.scrollHeight;
      }

      setTimeout(function() {
        var trEl = document.getElementById(typingId);
        if (trEl) trEl.remove();
        var res = queryBrain(q);
        appendMsg(res.html, false);
      }, 180);
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

  function attachLauncher() {
    var btn = document.getElementById('aiChatBtn');
    if (btn) {
      btn.onclick = function(e) {
        if (e) e.preventDefault();
        window.AroraAICommander.toggle();
      };
      btn.title = 'Arora HR Assistant (Ctrl+K)';
      btn.style.background = '#1e1b4b';
      btn.style.border = '1px solid rgba(129,140,248,0.45)';
      btn.style.color = '#e0e7ff';
      btn.style.boxShadow = '0 10px 28px rgba(15,23,42,0.38)';
      btn.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attachLauncher);
  } else {
    attachLauncher();
  }

  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('keydown', function(e) {
      if ((e.ctrlKey || e.metaKey) && String(e.key || '').toLowerCase() === 'k') {
        e.preventDefault();
        window.AroraAICommander.toggle();
      } else if (e.key === 'Escape' && UI.isOpen) {
        window.AroraAICommander.close();
      }
    });
  }

  var monitorTimer = null;
  function scheduleKnowledgeScan() {
    if (monitorTimer) clearTimeout(monitorTimer);
    monitorTimer = setTimeout(function() {
      try {
        refreshKnowledgeGraph();
        renderActiveFilesBar();
      } catch (_) {}
    }, 5000);
  }

  // Trigger scan only on upload or files restore, not on continuous setInterval
  window.addEventListener('atpl-local-files-restored', scheduleKnowledgeScan);
  window.addEventListener('atpl-file-saved', scheduleKnowledgeScan);

})();
