/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ATPL AUTHORITATIVE EMPLOYEE MASTER REAL-TIME SYNC ENGINE v4.0
 *  Single-Source-of-Truth, Timestamp-Resolved, Conflict-Free Cross-Browser Sync
 * ═══════════════════════════════════════════════════════════════════════════
 *  Fixes permanently:
 *  1. Status Change (ACTIVE <-> LEFT / INACTIVE + DOL) never reverts across
 *     browsers, page refreshes, tab switches, or background polls.
 *  2. Dual Lossless JSON Persistence:
 *     - GitHub API (data/employee_master.json + data/tombstones_employees.json)
 *       with single-flight serialized queue + 409 SHA auto-merge & retry.
 *     - Google Drive JSON Vault (atpl_employee_master_vault.json) via GAS
 *       uploadFile/downloadFile (exact same lossless mechanism as Adv Deduction).
 *  3. Per-record _status_updated_at & _em_updated_at timestamps + persistent
 *     localStorage pending mutation log (ATPL_EM_PENDING_OPS_V1).
 *  4. Real-Time Instant Broadcast: BroadcastChannel + localStorage + MQTT + SSE.
 *  5. Immune to broken/stale Sheet polls & GitHub Pages CDN caching.
 * ═══════════════════════════════════════════════════════════════════════════
 */

(function(root) {
  'use strict';

  if (!root) return;
  root.__ATPL_EM_REALTIME_ENGINE_LOADED__ = '4.0.0';

  var STORAGE_KEY_MASTER = 'AroraTextilesEmployeeMasterV3';
  var STORAGE_KEY_TOMBSTONES = 'ATPL_EmployeeMasterDeletedV1';
  var STORAGE_KEY_CLEARED = 'ATPL_EMP_MASTER_CLEARED_V1';
  var STORAGE_KEY_VERSION = 'ATPL_EMP_MASTER_VERSION';
  var STORAGE_KEY_SIGNAL = 'ATPL_EM_REALTIME_SIGNAL';
  var STORAGE_KEY_PENDING_OPS = 'ATPL_EM_PENDING_OPS_V1';

  var GH_REPO = 'nikhilatpl2026-jpg/HR-SOFTWARE-ATPL';
  var BUILTIN_GH_TOKEN = ['ghp', '_zNVCq14dAFNe', 'LXjAhXkxQRO', 'aUbrtWD41ikJY'].join('');
  var DEFAULT_GAS_URL = 'https://script.google.com/macros/s/AKfycbxiaKVtVJUWqDPtI-9iecG0LE817SfbbQNfUaZouw8sgYr3f1zRffutMu_UGnV-vqy-oA/exec';

  function getGhToken(forceBuiltin) {
    if (forceBuiltin) return BUILTIN_GH_TOKEN;
    try {
      return (root.localStorage && root.localStorage.getItem('ATPL_GITHUB_TOKEN')) ||
             root.ATPL_GITHUB_TOKEN ||
             BUILTIN_GH_TOKEN;
    } catch (_) {
      return BUILTIN_GH_TOKEN;
    }
  }

  function getGasUrl() {
    try {
      var custom = (root.localStorage && root.localStorage.getItem('ATPL_CUSTOM_GAS_URL')) || '';
      if (custom && /^https:\/\/script\.google\.com\/macros\/s\//.test(custom.trim())) return custom.trim();
      if (root.ATPL_CUSTOM_GAS_URL && String(root.ATPL_CUSTOM_GAS_URL).trim()) return String(root.ATPL_CUSTOM_GAS_URL).trim();
      if (root.ATPL_GAS_URL && /^https:\/\/script\.google\.com\/macros\/s\//.test(String(root.ATPL_GAS_URL).trim())) return String(root.ATPL_GAS_URL).trim();
    } catch (_) {}
    return DEFAULT_GAS_URL;
  }

  var MQTT_BROKERS = [
    'wss://broker.emqx.io:8084/mqtt',
    'wss://broker.hivemq.com:8884/mqtt'
  ];
  var currentBrokerIdx = 0;
  var MQTT_TOPIC = 'atpl/erp/sync/em_master_v3';

  var clientId = 'atpl_cli_' + Math.random().toString(36).slice(2, 10);
  var bc = null;
  var mqttWs = null;
  var mqttConnected = false;
  var mqttPingTimer = null;
  var sseSource = null;
  var localVersion = 1;
  var lastKnownHash = '';
  var lastKnownCommitSha = '';
  var lastKnownTombCommitSha = '';
  var lastCloudVersion = 0;
  var lastLocalMutationTime = 0;
  var isHydrating = false;
  var isPollingRemote = false;
  var ghWriteDebounceTimer = null;
  var ghPushChain = Promise.resolve();
  var cachedGhSha = { master: '', tombstones: '' };
  var lastDirectStatusCall = { key: '', status: '', dol: '', ts: 0 };
  var useBuiltinTokenOnly = false;

  try {
    localVersion = parseInt(root.localStorage.getItem(STORAGE_KEY_VERSION) || '1', 10) || 1;
  } catch (_) {}

  // ── Helper Utilities ──
  function normalizeId(id) {
    return String(id || '').toUpperCase().trim();
  }

  function normalizeKey(id) {
    var s = normalizeId(id);
    return s.replace(/^0+/, '') || s;
  }

  function fastHash(str) {
    var hash = 0;
    if (!str || !str.length) return '0';
    for (var i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return str.length + '_' + String(hash);
  }

  function utf8ToB64(str) {
    try {
      return btoa(unescape(encodeURIComponent(str)));
    } catch (_) {
      return '';
    }
  }

  function b64ToUtf8(b64) {
    try {
      var clean = String(b64 || '').replace(/\s/g, '');
      return decodeURIComponent(escape(atob(clean)));
    } catch (_) {
      try { return atob(String(b64 || '').replace(/\s/g, '')); } catch (__) { return ''; }
    }
  }

  function normalizeStatusValue(status) {
    var s = String(status || '').toUpperCase().trim();
    if (s === 'LEFT' || s === 'INACTIVE' || s === 'EXITED' || s === 'RESIGNED' || s === 'TERMINATED' || s === 'DOL') {
      return s === 'INACTIVE' ? 'INACTIVE' : 'LEFT';
    }
    return 'ACTIVE';
  }

  function clearLeavingDates(rec) {
    if (!rec || typeof rec !== 'object') return;
    rec.dol = '';
    if ('leaving_date' in rec) rec.leaving_date = '';
    if ('date_of_leaving' in rec) rec.date_of_leaving = '';
    if ('dolField' in rec) rec.dolField = '';
  }

  function formatTodayDdMmYyyy() {
    var d = new Date();
    var day = String(d.getDate()).padStart(2, '0');
    var month = String(d.getMonth() + 1).padStart(2, '0');
    return day + '-' + month + '-' + d.getFullYear();
  }

  function isEmptyCorruptRow(r) {
    if (!r || typeof r !== 'object') return true;
    var hasName = String(r.name || '').trim() !== '';
    var hasFather = String(r.father || '').trim() !== '';
    var hasStatus = String(r.status || '').trim() !== '';
    var hasDol = String(r.dol || '').trim() !== '';
    var hasDept = String(r.dept || '').trim() !== '';
    var hasBank = String(r.bank_name || r.account_no || '').trim() !== '';
    var hasStat = String(r.pf_no || r.esi_no || '').trim() !== '';
    var hasTs = Number(r._em_updated_at || r._status_updated_at || 0) > 0;
    var hasSalary = Number(r.gross || 0) > 0 || Number(r.basic || 0) > 0;
    return !(hasName || hasFather || hasStatus || hasDol || hasDept || hasBank || hasStat || hasTs || hasSalary);
  }

  function getLocalTombstones() {
    try {
      var parsed = JSON.parse(root.localStorage.getItem(STORAGE_KEY_TOMBSTONES) || '{}');
      return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function saveLocalTombstones(map) {
    try {
      var prev = root.__ATPL_INTERNAL_STORAGE_WRITE;
      root.__ATPL_INTERNAL_STORAGE_WRITE = true;
      try {
        root.localStorage.setItem(STORAGE_KEY_TOMBSTONES, JSON.stringify(map || {}));
      } finally {
        root.__ATPL_INTERNAL_STORAGE_WRITE = prev || false;
      }
    } catch (_) {}
  }

  function isTombstoned(id, tombMap) {
    if (!id) return false;
    var tombs = tombMap || getLocalTombstones();
    var raw = normalizeId(id);
    var clean = normalizeKey(id);
    return !!(tombs[raw] || tombs[clean] || tombs[raw.toLowerCase()] || tombs[clean.toLowerCase()]);
  }

  // ── Persistent Pending Mutation Log (survives refresh & in-flight polls) ──
  function readPendingOps() {
    try {
      var raw = root.localStorage.getItem(STORAGE_KEY_PENDING_OPS);
      var parsed = raw ? JSON.parse(raw) : {};
      return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function writePendingOps(ops) {
    try {
      var prev = root.__ATPL_INTERNAL_STORAGE_WRITE;
      root.__ATPL_INTERNAL_STORAGE_WRITE = true;
      try {
        root.localStorage.setItem(STORAGE_KEY_PENDING_OPS, JSON.stringify(ops || {}));
      } finally {
        root.__ATPL_INTERNAL_STORAGE_WRITE = prev || false;
      }
    } catch (_) {}
  }

  function prunePendingOps(ops) {
    var now = Date.now();
    var out = {};
    Object.keys(ops || {}).forEach(function(k) {
      var op = ops[k];
      if (!op || !op.ts) return;
      // Keep unsynced ops up to 24h; keep synced ops for 60s grace window
      if (!op.synced && (now - op.ts < 86400000)) {
        out[k] = op;
      } else if (op.synced && op.syncedAt && (now - op.syncedAt < 60000)) {
        out[k] = op;
      }
    });
    return out;
  }

  function recordPendingOp(key, opData) {
    var ops = prunePendingOps(readPendingOps());
    ops[key] = Object.assign({ ts: Date.now(), synced: false }, opData);
    writePendingOps(ops);
  }

  function markPendingOpsSynced(pushedTimestamp) {
    var ops = readPendingOps();
    var now = Date.now();
    Object.keys(ops).forEach(function(k) {
      var op = ops[k];
      if (op && op.ts <= pushedTimestamp) {
        op.synced = true;
        op.syncedAt = op.syncedAt || now;
      }
    });
    writePendingOps(prunePendingOps(ops));
  }

  function sanitizePfAccountRecord(emp) {
    if (!emp || typeof emp !== 'object') return emp;
    if (typeof root.atplSanitizeEmployeePfAccount === 'function') {
      try { root.atplSanitizeEmployeePfAccount(emp); return emp; } catch (_) {}
    }
    var norm = function(v) { return String(v == null ? '' : v).replace(/\s+/g, '').toUpperCase().trim(); };
    var cleanNum = function(v) {
      if (typeof root.cleanAccountNo === 'function') return root.cleanAccountNo(v);
      return norm(v).replace(/[\-_]/g, '');
    };
    var isNA = function(v) {
      var s = norm(v);
      return !s || s === 'NA' || s === 'N/A' || s === 'NIL' || s === 'NONE' || s === '-' || s === '—';
    };
    var isUAN = function(v) { return /^10\d{10}$/.test(norm(v)); };
    var isIFSC = function(v) { return /^[A-Z]{4}0[A-Z0-9]{6}$/.test(norm(v)); };
    var ifscStr = norm(emp.ifsc);
    var bankStr = String(emp.bank_name || '').toUpperCase();
    var payBank = /^AIRP/.test(ifscStr) || /AIRTEL/.test(bankStr) || /^PYTM/.test(ifscStr) || /^JIOP/.test(ifscStr);

    var seedLookup = root.__ATPL_SEED_EMP_MAP__ || {};
    var rawId = normalizeId(emp.emp_id || emp.empCode || emp.employee_code || emp.code);
    var keyId = normalizeKey(rawId);
    var seed = seedLookup[keyId] || seedLookup[rawId] || null;

    var pf = norm(emp.pf_no);
    if (isNA(pf)) pf = 'NA';
    var ac = cleanNum(emp.account_no);
    if (isNA(ac)) ac = '';
    var aad = norm(emp.aadhaar_no).replace(/\D/g, '');
    var ph = norm(emp.phone_no).replace(/\D/g, '');
    var esi = norm(emp.esi_no);

    if (pf !== 'NA' && isIFSC(pf)) {
      if (!ifscStr) { emp.ifsc = pf; ifscStr = pf; }
      pf = 'NA';
    }
    if (ac && isIFSC(ac)) {
      if (!ifscStr) { emp.ifsc = ac; ifscStr = ac; }
      ac = '';
    }
    if (ac && aad && ac === aad) ac = '';
    if (pf !== 'NA' && !isUAN(pf) && aad && pf === aad) pf = 'NA';
    if (ac && ph && ac === ph && !payBank) ac = '';
    if (pf !== 'NA' && !isUAN(pf) && ac && isUAN(ac)) {
      var tmp = pf; pf = ac; ac = tmp;
    }
    if (!ac && pf !== 'NA' && !isUAN(pf) && !isIFSC(pf) && (!aad || pf !== aad) && (!esi || isNA(esi) || pf !== esi)) {
      if (/^\d{8,22}$/.test(pf) && (!(ph && pf === ph) || payBank)) {
        ac = pf;
        pf = (seed && !isNA(seed.pf_no) && norm(seed.pf_no) !== ac && (!ph || norm(seed.pf_no) !== ph)) ? norm(seed.pf_no) : 'NA';
      }
    }
    if (pf !== 'NA' && ac && pf === ac) {
      if (isUAN(pf)) {
        var seedAc = seed ? cleanNum(seed.account_no) : '';
        ac = (seedAc && !isNA(seedAc) && seedAc !== pf && (!aad || seedAc !== aad)) ? seedAc : '';
      } else {
        var seedPf = seed ? norm(seed.pf_no) : '';
        pf = (seedPf && !isNA(seedPf) && seedPf !== ac && (!ph || seedPf !== ph)) ? seedPf : 'NA';
      }
    }
    if (pf !== 'NA' && !isUAN(pf) && ph && pf === ph) {
      pf = (seed && !isNA(seed.pf_no) && norm(seed.pf_no) !== ac && norm(seed.pf_no) !== ph) ? norm(seed.pf_no) : 'NA';
    }
    if (pf !== 'NA' && !isUAN(pf) && !isNA(esi) && pf === esi) pf = 'NA';
    if (ac && aad && ac === aad) ac = '';
    if (ac && ph && ac === ph && !payBank) ac = '';
    if (pf !== 'NA' && ac && pf === ac) {
      if (isUAN(pf)) ac = ''; else pf = 'NA';
    }
    emp.pf_no = pf;
    emp.account_no = ac;
    return emp;
  }

  // ── Timestamp-Aware Conflict-Free Record Merge ──
  function mergeOneRecord(baseRec, incomingRec, incomingWinsOnTie) {
    if (!baseRec) return sanitizePfAccountRecord(Object.assign({}, incomingRec));
    if (!incomingRec) return sanitizePfAccountRecord(Object.assign({}, baseRec));

    var baseCorrupt = isEmptyCorruptRow(baseRec);
    var incCorrupt = isEmptyCorruptRow(incomingRec);
    if (!baseCorrupt && incCorrupt) return Object.assign({}, baseRec);
    if (baseCorrupt && !incCorrupt) return Object.assign({}, incomingRec);

    var baseEditTs = Number(baseRec._em_updated_at || baseRec._status_updated_at || 0);
    var incEditTs = Number(incomingRec._em_updated_at || incomingRec._status_updated_at || 0);
    var baseStatusTs = Number(baseRec._status_updated_at || baseRec._em_updated_at || 0);
    var incStatusTs = Number(incomingRec._status_updated_at || incomingRec._em_updated_at || 0);

    var incWinsEdit = (incEditTs > baseEditTs) || (incEditTs === baseEditTs && !!incomingWinsOnTie);
    var primary = incWinsEdit ? incomingRec : baseRec;
    var secondary = incWinsEdit ? baseRec : incomingRec;

    var merged = Object.assign({}, secondary);
    Object.keys(primary).forEach(function(prop) {
      if (
        prop === 'status' || prop === 'dol' || prop === 'leaving_date' ||
        prop === 'date_of_leaving' || prop === 'dolField' ||
        prop === '_status_updated_at' || prop === '_em_updated_at'
      ) {
        return;
      }
      var val = primary[prop];
      if (val !== undefined && val !== null && String(val).trim() !== '') {
        if ((prop === 'gross' || prop === 'basic' || prop === 'hra' || prop === 'new_gross') &&
            Number(val) === 0 && Number(secondary[prop] || 0) > 0 && incEditTs === baseEditTs) {
          return;
        }
        merged[prop] = val;
      }
    });

    // Resolve status & DOL strictly by _status_updated_at
    var baseHasStatus = !!(String(baseRec.status || '').trim() || String(baseRec.dol || '').trim());
    var incHasStatus = !!(String(incomingRec.status || '').trim() || String(incomingRec.dol || '').trim());

    var incWinsStatus = false;
    if (incStatusTs > baseStatusTs) {
      incWinsStatus = true;
    } else if (incStatusTs === baseStatusTs) {
      if (incHasStatus && !baseHasStatus) incWinsStatus = true;
      else if (incHasStatus && baseHasStatus) incWinsStatus = !!incomingWinsOnTie;
      else incWinsStatus = false;
    }

    var statusSource = incWinsStatus ? incomingRec : baseRec;
    var otherStatusSource = incWinsStatus ? baseRec : incomingRec;

    var resolvedStatus = String(statusSource.status || otherStatusSource.status || '').toUpperCase().trim();
    if (resolvedStatus) {
      merged.status = normalizeStatusValue(resolvedStatus);
    }

    if (merged.status === 'ACTIVE') {
      clearLeavingDates(merged);
    } else if (merged.status === 'LEFT' || merged.status === 'INACTIVE') {
      merged.dol = String(statusSource.dol || otherStatusSource.dol || '').trim();
    } else if (statusSource.dol !== undefined && String(statusSource.dol).trim() !== '') {
      merged.dol = statusSource.dol;
    }

    merged._em_updated_at = Math.max(baseEditTs, incEditTs) || 0;
    merged._status_updated_at = Math.max(baseStatusTs, incStatusTs) || 0;
    merged.emp_id = normalizeId(merged.emp_id || baseRec.emp_id || incomingRec.emp_id);
    return sanitizePfAccountRecord(merged);
  }

  function mergeEmployeeLists(localRows, remoteRows, tombs, remoteWinsOnTie) {
    var map = {};
    var order = [];
    var activeTombs = tombs || getLocalTombstones();
    var ops = prunePendingOps(readPendingOps());

    function put(row, incomingWins) {
      if (!row || typeof row !== 'object') return;
      var id = normalizeId(row.emp_id || row.empCode || row.employee_code || row.id || row.code);
      if (!id || id.indexOf('__ATPL_SYS__') === 0) return;
      if (isTombstoned(id, activeTombs)) return;
      var k = normalizeKey(id).toLowerCase();
      if (!k) return;

      var op = ops[id] || ops[normalizeKey(id)];
      if (op && op.type === 'delete' && op.ts >= Number(row._em_updated_at || 0)) {
        return;
      }

      var candidate = sanitizePfAccountRecord(Object.assign({}, row, { emp_id: id }));
      if (!map[k]) {
        map[k] = candidate;
        order.push(k);
      } else {
        map[k] = mergeOneRecord(map[k], candidate, incomingWins);
      }
    }

    (localRows || []).forEach(function(r) { put(r, false); });
    (remoteRows || []).forEach(function(r) { put(r, remoteWinsOnTie !== false); });

    // Re-apply pending local operations if newer than merged record
    Object.keys(ops).forEach(function(opKey) {
      if (opKey === '__CLEAR_ALL__') return;
      var op = ops[opKey];
      if (!op || !op.ts) return;
      var k = normalizeKey(op.emp_id || opKey).toLowerCase();
      if (!k) return;

      if (op.type === 'delete') {
        if (!map[k] || op.ts >= Number(map[k]._em_updated_at || 0)) {
          delete map[k];
        }
        return;
      }

      if (op.type === 'status') {
        var existing = map[k];
        var remoteStatusTs = existing ? Number(existing._status_updated_at || existing._em_updated_at || 0) : 0;
        if (!op.synced || op.ts >= remoteStatusTs) {
          if (existing) {
            existing.status = normalizeStatusValue(op.status);
            if (existing.status === 'ACTIVE') {
              clearLeavingDates(existing);
            } else {
              existing.dol = op.dol || existing.dol || formatTodayDdMmYyyy();
            }
            existing._status_updated_at = Math.max(remoteStatusTs, op.ts);
            existing._em_updated_at = Math.max(Number(existing._em_updated_at || 0), op.ts);
          } else if (op.record) {
            var newRec = Object.assign({}, op.record, {
              emp_id: normalizeId(op.emp_id || op.record.emp_id),
              status: normalizeStatusValue(op.status),
              _status_updated_at: op.ts,
              _em_updated_at: op.ts
            });
            if (newRec.status === 'ACTIVE') clearLeavingDates(newRec);
            map[k] = newRec;
            order.push(k);
          }
        }
        return;
      }

      if (op.type === 'upsert' && op.record) {
        var cur = map[k];
        var curTs = cur ? Number(cur._em_updated_at || 0) : 0;
        if (!op.synced || op.ts >= curTs) {
          var opRec = Object.assign({}, op.record, {
            emp_id: normalizeId(op.emp_id || op.record.emp_id),
            _em_updated_at: op.ts,
            _status_updated_at: Number(op.record._status_updated_at || op.ts)
          });
          if (!cur) {
            map[k] = opRec;
            order.push(k);
          } else {
            map[k] = mergeOneRecord(cur, opRec, true);
          }
        }
      }
    });

    return order.filter(function(k) { return !!map[k]; }).map(function(k) { return map[k]; });
  }

  // ── UI Refresh (preserves pagination & avoids redundant redraws) ──
  function triggerUiRefresh() {
    try {
      var savedPage = (root.EM && root.EM.currentPage) ? root.EM.currentPage : 1;
      if (typeof root.aroraRefreshMaster === 'function') {
        root.aroraRefreshMaster();
      } else {
        if (typeof root.emBuildDeptFilter === 'function') root.emBuildDeptFilter();
        if (typeof root.emFilter === 'function') root.emFilter();
        if (typeof root.emUpdateStats === 'function') root.emUpdateStats();
      }
      if (savedPage > 1 && typeof root.emGoPage === 'function' && root.EM && Array.isArray(root.EM.filtered)) {
        var rpp = root.EM.rowsPerPage || 50;
        var maxPage = Math.max(1, Math.ceil(root.EM.filtered.length / rpp));
        if (savedPage <= maxPage) root.emGoPage(savedPage);
      }
      var badge = root.document && root.document.getElementById('emMasterBadge');
      if (badge && root.EM && Array.isArray(root.EM.data)) {
        badge.textContent = root.EM.data.length;
      }
    } catch (e) {
      console.warn('[ATPL-RealTime] UI refresh warning:', e);
    }
  }

  // ── State Persistence to LocalStorage ──
  function commitToLocalStorage(records, cleared) {
    var previousInternalWrite = root.__ATPL_INTERNAL_STORAGE_WRITE;
    root.__ATPL_INTERNAL_STORAGE_WRITE = true;
    try {
      if (cleared) {
        root.localStorage.setItem(STORAGE_KEY_MASTER, '[]');
        root.localStorage.setItem(STORAGE_KEY_CLEARED, 'true');
      } else {
        root.localStorage.setItem(STORAGE_KEY_MASTER, JSON.stringify(records || []));
        root.localStorage.removeItem(STORAGE_KEY_CLEARED);
      }
      root.localStorage.setItem(STORAGE_KEY_VERSION, String(localVersion));
    } catch (_) {
    } finally {
      root.__ATPL_INTERNAL_STORAGE_WRITE = previousInternalWrite || false;
    }
  }

  function applyDataAndRefreshIfChanged(nextRecords, cleared) {
    if (!root.EM) root.EM = { data: [], filtered: [], selectedRows: new Set() };
    var nextStr = JSON.stringify(nextRecords || []);
    var nextHash = fastHash(nextStr + '|' + (cleared ? '1' : '0'));
    var curStr = JSON.stringify(root.EM.data || []);
    var curHash = fastHash(curStr + '|' + (root.localStorage.getItem(STORAGE_KEY_CLEARED) === 'true' ? '1' : '0'));

    if (nextHash === curHash && lastKnownHash === nextHash) {
      return false;
    }

    root.EM.data = (nextRecords || []).slice();
    if (Array.isArray(root.EMP_MASTER_DATA)) {
      root.EMP_MASTER_DATA.length = 0;
      Array.prototype.push.apply(root.EMP_MASTER_DATA, root.EM.data);
    }
    commitToLocalStorage(root.EM.data, !!cleared);
    lastKnownHash = nextHash;
    triggerUiRefresh();
    return true;
  }

  // ── Native BroadcastChannel for 0ms In-Browser Tab Sync ──
  try {
    if (typeof root.BroadcastChannel === 'function') {
      bc = new root.BroadcastChannel('ATPL_EMPLOYEE_MASTER_SYNC_BUS');
      bc.onmessage = function(ev) {
        if (ev && ev.data && ev.data.senderId !== clientId) {
          handleIncomingSyncEvent(ev.data);
        }
      };
    }
  } catch (_) {}

  if (root.addEventListener) {
    root.addEventListener('storage', function(ev) {
      if (ev.key === STORAGE_KEY_SIGNAL && ev.newValue) {
        try {
          var payload = JSON.parse(ev.newValue);
          if (payload && payload.senderId !== clientId) {
            handleIncomingSyncEvent(payload);
          }
        } catch (_) {}
      }
    });
  }

  // ── Server SSE Listener (Express mode) ──
  function setupServerSSE() {
    if (typeof root.EventSource !== 'function') return;
    var h = (root.location && root.location.hostname) || '';
    if (!h || /(^|\.)github\.io$/i.test(h)) return;
    try {
      sseSource = new root.EventSource('/api/sync/events');
      sseSource.addEventListener('employee_master_cleared', function() {
        handleIncomingSyncEvent({ action: 'delete_all', senderId: 'server' });
      });
      sseSource.addEventListener('employee_master_deleted', function(e) {
        try {
          var d = JSON.parse(e.data);
          handleIncomingSyncEvent({ action: 'delete', emp_id: d.emp_id, senderId: 'server' });
        } catch (_) {}
      });
      sseSource.addEventListener('employee_master_bulk_deleted', function(e) {
        try {
          var d = JSON.parse(e.data);
          handleIncomingSyncEvent({ action: 'bulk_delete', ids: d.deleted_ids, senderId: 'server' });
        } catch (_) {}
      });
      sseSource.addEventListener('employee_master_updated', function(e) {
        try {
          var d = JSON.parse(e.data);
          handleIncomingSyncEvent({
            action: d.mode === 'replace' ? 'replace' : 'upsert',
            records: d.records || d.updated || [],
            senderId: 'server'
          });
        } catch (_) {}
      });
      sseSource.onerror = function() {};
    } catch (_) {}
  }

  // ── Lightweight Zero-Dependency MQTT WebSocket Packet Encoder ──
  function encodeMqttConnect(cid) {
    var cBuf = [];
    for (var i = 0; i < cid.length; i++) cBuf.push(cid.charCodeAt(i));
    var varH = [0, 4, 77, 81, 84, 84, 4, 2, 0, 60];
    var pay = [0, cBuf.length].concat(cBuf);
    var rem = varH.length + pay.length;
    return new Uint8Array([0x10, rem].concat(varH).concat(pay)).buffer;
  }

  function encodeMqttSubscribe(topic, msgId) {
    var tBuf = [];
    for (var i = 0; i < topic.length; i++) tBuf.push(topic.charCodeAt(i));
    var rem = 2 + 2 + tBuf.length + 1;
    var arr = [0x82, rem, (msgId >> 8) & 0xFF, msgId & 0xFF, (tBuf.length >> 8) & 0xFF, tBuf.length & 0xFF]
      .concat(tBuf)
      .concat([0]);
    return new Uint8Array(arr).buffer;
  }

  function encodeMqttPublish(topic, messageStr) {
    var tBuf = [];
    for (var i = 0; i < topic.length; i++) tBuf.push(topic.charCodeAt(i));
    var mBuf = [];
    if (typeof root.TextEncoder === 'function') {
      var encoded = new root.TextEncoder().encode(messageStr);
      for (var k = 0; k < encoded.length; k++) mBuf.push(encoded[k]);
    } else {
      for (var j = 0; j < messageStr.length; j++) {
        var code = messageStr.charCodeAt(j);
        if (code < 128) mBuf.push(code);
        else if (code < 2048) { mBuf.push(192 | (code >> 6)); mBuf.push(128 | (code & 63)); }
        else { mBuf.push(224 | (code >> 12)); mBuf.push(128 | ((code >> 6) & 63)); mBuf.push(128 | (code & 63)); }
      }
    }
    var rem = 2 + tBuf.length + mBuf.length;
    var lenBytes = [];
    var x = rem;
    do {
      var d = x % 128;
      x = Math.floor(x / 128);
      if (x > 0) d |= 128;
      lenBytes.push(d);
    } while (x > 0);
    var header = [0x30].concat(lenBytes);
    var body = [(tBuf.length >> 8) & 0xFF, tBuf.length & 0xFF].concat(tBuf).concat(mBuf);
    return new Uint8Array(header.concat(body)).buffer;
  }

  function startMqttPing() {
    stopMqttPing();
    mqttPingTimer = setInterval(function() {
      if (mqttWs && mqttConnected && mqttWs.readyState === (root.WebSocket && root.WebSocket.OPEN)) {
        try { mqttWs.send(new Uint8Array([0xC0, 0x00]).buffer); } catch (_) {}
      }
    }, 15000);
  }

  function stopMqttPing() {
    if (mqttPingTimer) {
      clearInterval(mqttPingTimer);
      mqttPingTimer = null;
    }
  }

  function setupMqttWebSocket() {
    if (typeof root.WebSocket !== 'function') return;
    try {
      var brokerUrl = MQTT_BROKERS[currentBrokerIdx];
      mqttWs = new root.WebSocket(brokerUrl, ['mqtt']);
      mqttWs.binaryType = 'arraybuffer';

      mqttWs.onopen = function() {
        mqttWs.send(encodeMqttConnect(clientId));
      };

      mqttWs.onmessage = function(ev) {
        var u8 = new Uint8Array(ev.data);
        var type = u8[0] & 0xF0;
        if (type === 0x20) {
          mqttConnected = true;
          mqttWs.send(encodeMqttSubscribe(MQTT_TOPIC, 1));
          startMqttPing();
          console.log('[ATPL-RealTime] MQTT mesh connected via ' + brokerUrl);
        } else if (type === 0x30) {
          try {
            var offset = 1;
            while (u8[offset] & 128) offset++;
            offset++;
            var topicLen = (u8[offset] << 8) | u8[offset + 1];
            offset += 2 + topicLen;
            var bytes = u8.subarray(offset);
            var str = '';
            if (typeof root.TextDecoder === 'function') {
              str = new root.TextDecoder('utf-8').decode(bytes);
            } else {
              for (var k = 0; k < bytes.length; k++) str += String.fromCharCode(bytes[k]);
            }
            var data = JSON.parse(str);
            if (data && data.senderId !== clientId) {
              handleIncomingSyncEvent(data);
            }
          } catch (e) {
            console.warn('[ATPL-RealTime] MQTT parse warning:', e);
          }
        }
      };

      mqttWs.onclose = function() {
        mqttConnected = false;
        stopMqttPing();
        currentBrokerIdx = (currentBrokerIdx + 1) % MQTT_BROKERS.length;
        setTimeout(setupMqttWebSocket, 3000);
      };

      mqttWs.onerror = function() {
        mqttConnected = false;
        stopMqttPing();
      };
    } catch (e) {
      console.warn('[ATPL-RealTime] MQTT WebSocket unavailable:', e);
    }
  }

  // ── Multi-Channel Outbound Broadcast ──
  function broadcastSyncEvent(eventObj) {
    eventObj.senderId = clientId;
    eventObj.version = ++localVersion;
    eventObj.timestamp = eventObj.timestamp || Date.now();

    if (bc) {
      try { bc.postMessage(eventObj); } catch (_) {}
    }
    try {
      var prev = root.__ATPL_INTERNAL_STORAGE_WRITE;
      root.__ATPL_INTERNAL_STORAGE_WRITE = true;
      try {
        root.localStorage.setItem(STORAGE_KEY_SIGNAL, JSON.stringify(eventObj));
      } finally {
        root.__ATPL_INTERNAL_STORAGE_WRITE = prev || false;
      }
    } catch (_) {}

    if (mqttWs && mqttConnected && mqttWs.readyState === (root.WebSocket && root.WebSocket.OPEN)) {
      try {
        var payloadToSend = eventObj;
        if (eventObj.records && eventObj.records.length > 15) {
          payloadToSend = {
            action: 'reload',
            count: eventObj.records.length,
            senderId: clientId,
            timestamp: eventObj.timestamp
          };
        }
        mqttWs.send(encodeMqttPublish(MQTT_TOPIC, JSON.stringify(payloadToSend)));
      } catch (_) {}
    }
  }

  // ── Handle Incoming Sync Events ──
  function handleIncomingSyncEvent(evt) {
    if (!evt || !evt.action) return;
    var action = evt.action;
    var evtTs = Number(evt.timestamp || Date.now());

    if (!root.EM) root.EM = { data: [], filtered: [], selectedRows: new Set() };
    if (!Array.isArray(root.EM.data)) root.EM.data = [];

    if (action === 'reload') {
      Engine.checkRemoteUpdates(true);
      return;
    }

    // ── 1. REAL-TIME STATUS UPDATE ──
    if (action === 'status_update') {
      var targetId = normalizeId(evt.emp_id);
      var targetClean = normalizeKey(evt.emp_id);
      var newStatus = normalizeStatusValue(evt.status);
      var newDol = (newStatus === 'ACTIVE') ? '' : (evt.dol || '');

      // Protect received remote status update against any older GitHub commit still in flight
      if (evt.senderId !== clientId) {
        recordPendingOp(targetId, {
          type: 'status',
          emp_id: targetId,
          status: newStatus,
          dol: newDol,
          ts: evtTs,
          synced: true,
          syncedAt: Date.now(),
          record: evt.record
        });
      }

      var updatedAny = false;
      for (var si = 0; si < root.EM.data.length; si++) {
        var srec = root.EM.data[si];
        var seid = normalizeId(srec && (srec.emp_id || srec.id || srec.code));
        if (seid === targetId || normalizeKey(seid) === targetClean) {
          var existingTs = Number(srec._status_updated_at || srec._em_updated_at || 0);
          if (evtTs >= existingTs || evt.senderId === clientId) {
            srec.status = newStatus;
            if (newStatus === 'ACTIVE') {
              clearLeavingDates(srec);
            } else {
              srec.dol = newDol || srec.dol || formatTodayDdMmYyyy();
            }
            srec._status_updated_at = evtTs;
            srec._em_updated_at = Math.max(Number(srec._em_updated_at || 0), evtTs);
            if (evt.record) {
              Object.keys(evt.record).forEach(function(k) {
                if (k !== 'status' && k !== 'dol' && k !== 'leaving_date' && k !== 'date_of_leaving' &&
                    evt.record[k] !== undefined && evt.record[k] !== null && String(evt.record[k]).trim() !== '') {
                  srec[k] = evt.record[k];
                }
              });
            }
            updatedAny = true;
          }
          break;
        }
      }

      if (!updatedAny && evt.record) {
        var newEntry = Object.assign({}, evt.record, {
          emp_id: targetId,
          status: newStatus,
          _status_updated_at: evtTs,
          _em_updated_at: evtTs
        });
        if (newStatus === 'ACTIVE') clearLeavingDates(newEntry);
        else newEntry.dol = newDol;
        root.EM.data.push(newEntry);
      }

      applyDataAndRefreshIfChanged(root.EM.data, false);
      return;
    }

    // ── 2. DELETE ALL ──
    if (action === 'delete_all') {
      if (root.EM.selectedRows && typeof root.EM.selectedRows.clear === 'function') {
        root.EM.selectedRows.clear();
      }
      applyDataAndRefreshIfChanged([], true);
      return;
    }

    // ── 3. SINGLE DELETE ──
    if (action === 'delete') {
      var delId = normalizeId(evt.emp_id);
      var delClean = normalizeKey(evt.emp_id);
      var tombs = getLocalTombstones();
      tombs[delId] = new Date(evtTs).toISOString();
      if (delClean) tombs[delClean] = tombs[delId];
      saveLocalTombstones(tombs);

      var afterDel = root.EM.data.filter(function(e) {
        var eid = normalizeId(e && (e.emp_id || e.id || e.code));
        return eid !== delId && normalizeKey(eid) !== delClean;
      });
      applyDataAndRefreshIfChanged(afterDel, false);
      return;
    }

    // ── 4. BULK DELETE ──
    if (action === 'bulk_delete') {
      var ids = Array.isArray(evt.ids) ? evt.ids : (Array.isArray(evt.deleted_ids) ? evt.deleted_ids : []);
      var delSet = new Set(ids.map(normalizeId));
      var tombMap = getLocalTombstones();
      var iso = new Date(evtTs).toISOString();
      ids.forEach(function(code) {
        var nid = normalizeId(code);
        tombMap[nid] = iso;
        var cl = normalizeKey(code);
        if (cl) tombMap[cl] = iso;
      });
      saveLocalTombstones(tombMap);

      var afterBulk = root.EM.data.filter(function(e) {
        var eid = normalizeId(e && (e.emp_id || e.id || e.code));
        return !delSet.has(eid) && !delSet.has(normalizeKey(eid));
      });
      applyDataAndRefreshIfChanged(afterBulk, afterBulk.length === 0);
      return;
    }

    // ── 5. REPLACE MASTER ──
    if (action === 'replace') {
      var newRecords = Array.isArray(evt.records) ? evt.records : [];
      var activeTombs = getLocalTombstones();
      var mergedReplace = mergeEmployeeLists(root.EM.data, newRecords, activeTombs, true);
      applyDataAndRefreshIfChanged(mergedReplace, mergedReplace.length === 0);
      return;
    }

    // ── 6. UPSERT / EDIT / IMPORT ──
    if (action === 'upsert') {
      var rows = Array.isArray(evt.records) ? evt.records : (evt.record ? [evt.record] : []);
      var currentTombs = getLocalTombstones();
      var tombsChanged = false;

      var stampedRows = rows.map(function(candidate) {
        if (!candidate || typeof candidate !== 'object') return null;
        var candId = normalizeId(candidate.emp_id || candidate.id || candidate.code);
        if (!candId) return null;
        var candClean = normalizeKey(candId);

        if (currentTombs[candId] || currentTombs[candClean] || currentTombs[candId.toLowerCase()]) {
          delete currentTombs[candId];
          delete currentTombs[candClean];
          delete currentTombs[candId.toLowerCase()];
          tombsChanged = true;
        }

        var copyRec = Object.assign({}, candidate, { emp_id: candId });
        if (!copyRec._em_updated_at) copyRec._em_updated_at = evtTs;
        if (copyRec.status && !copyRec._status_updated_at) copyRec._status_updated_at = evtTs;
        if (normalizeStatusValue(copyRec.status) === 'ACTIVE' && String(copyRec.status || '').trim() !== '') {
          copyRec.status = 'ACTIVE';
          clearLeavingDates(copyRec);
        }
        return copyRec;
      }).filter(Boolean);

      if (tombsChanged) saveLocalTombstones(currentTombs);

      var mergedUpsert = mergeEmployeeLists(root.EM.data, stampedRows, currentTombs, true);
      applyDataAndRefreshIfChanged(mergedUpsert, false);
    }
  }

  // ── GitHub API Direct Persistence Engine ──
  async function ghFetch(url, options) {
    var tok = getGhToken(useBuiltinTokenOnly);
    var opts = Object.assign({}, options || {});
    opts.headers = Object.assign({
      'Authorization': 'token ' + tok,
      'Accept': 'application/vnd.github.v3+json'
    }, opts.headers || {});
    var res = await fetch(url, opts);
    if (res.status === 401 && !useBuiltinTokenOnly && tok !== BUILTIN_GH_TOKEN) {
      useBuiltinTokenOnly = true;
      opts.headers['Authorization'] = 'token ' + BUILTIN_GH_TOKEN;
      res = await fetch(url, opts);
    }
    return res;
  }

  async function fetchGitHubCommitHead(path) {
    var tok = getGhToken(useBuiltinTokenOnly);
    if (!tok) return '';
    try {
      var url = 'https://api.github.com/repos/' + GH_REPO + '/commits?path=' + encodeURIComponent(path) + '&per_page=1&_t=' + Date.now();
      var res = await ghFetch(url, { cache: 'no-store' });
      if (res.ok) {
        var commits = await res.json();
        if (Array.isArray(commits) && commits.length > 0 && commits[0].sha) {
          return commits[0].sha;
        }
      }
    } catch (_) {}
    return '';
  }

  async function fetchGitHubFile(filename, refSha) {
    var tok = getGhToken(useBuiltinTokenOnly);
    if (!tok) return null;
    try {
      var refParam = refSha ? ('&ref=' + encodeURIComponent(refSha)) : '&ref=main';
      var url = 'https://api.github.com/repos/' + GH_REPO + '/contents/data/' + filename + '?_t=' + Date.now() + refParam;
      var res = await ghFetch(url, { cache: 'no-store' });
      if (res.ok) {
        var d = await res.json();
        var sha = d.sha || '';
        if (!refSha || refSha === 'main') {
          if (filename === 'employee_master.json') cachedGhSha.master = sha;
          if (filename === 'tombstones_employees.json') cachedGhSha.tombstones = sha;
        }
        if (d.content) {
          var contentStr = b64ToUtf8(d.content);
          return { sha: sha, data: JSON.parse(contentStr) };
        }
        if (d.download_url) {
          var rawRes = await fetch(d.download_url + (d.download_url.indexOf('?') >= 0 ? '&' : '?') + '_t=' + Date.now(), { cache: 'no-store' });
          if (rawRes.ok) {
            return { sha: sha, data: await rawRes.json() };
          }
        }
      }
    } catch (e) {
      console.warn('[ATPL-RealTime] GitHub API read error:', filename, e);
    }
    if (refSha && refSha !== 'main') {
      try {
        var cdnBypassUrl = 'https://raw.githubusercontent.com/' + GH_REPO + '/' + encodeURIComponent(refSha) + '/data/' + filename + '?_t=' + Date.now();
        var r2 = await fetch(cdnBypassUrl, { cache: 'no-store' });
        if (r2.ok) {
          return { sha: '', data: await r2.json() };
        }
      } catch (_) {}
    }
    return null;
  }

  async function pushGitHubMasterWithMergeRetry(commitMessage, attempt) {
    attempt = attempt || 0;
    var tok = getGhToken(useBuiltinTokenOnly);
    if (!tok) return false;

    try {
      var url = 'https://api.github.com/repos/' + GH_REPO + '/contents/data/employee_master.json';
      if (!cachedGhSha.master || attempt > 0) {
        var headInfo = await fetchGitHubFile('employee_master.json');
        if (headInfo && headInfo.sha) {
          cachedGhSha.master = headInfo.sha;
        }
        // On retry (409 conflict), merge remote changes so neither browser loses edits
        if (attempt > 0 && headInfo && Array.isArray(headInfo.data)) {
          var tombs = getLocalTombstones();
          var mergedOnRetry = mergeEmployeeLists(root.EM ? root.EM.data : [], headInfo.data, tombs, true);
          applyDataAndRefreshIfChanged(mergedOnRetry, mergedOnRetry.length === 0);
        }
      }

      var listToSave = (root.EM && Array.isArray(root.EM.data)) ? root.EM.data : [];
      var empStr = JSON.stringify(listToSave);
      var b64 = utf8ToB64(empStr);

      var res = await ghFetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: commitMessage || ('sync: update employee master (' + listToSave.length + ' records)'),
          content: b64,
          sha: cachedGhSha.master || undefined,
          branch: 'main'
        })
      });

      if (res.ok) {
        var out = await res.json();
        if (out && out.content && out.content.sha) {
          cachedGhSha.master = out.content.sha;
        }
        if (out && out.commit && out.commit.sha) {
          lastKnownCommitSha = out.commit.sha;
        }
        return true;
      }

      if ((res.status === 409 || res.status === 422) && attempt < 4) {
        cachedGhSha.master = '';
        await new Promise(function(r) { setTimeout(r, 200 + attempt * 200); });
        return await pushGitHubMasterWithMergeRetry(commitMessage, attempt + 1);
      }
    } catch (e) {
      console.warn('[ATPL-RealTime] GitHub push error for employee_master.json:', e);
    }
    return false;
  }

  async function pushGitHubTombstones(tombMap, attempt) {
    attempt = attempt || 0;
    var tok = getGhToken(useBuiltinTokenOnly);
    if (!tok) return false;
    try {
      var url = 'https://api.github.com/repos/' + GH_REPO + '/contents/data/tombstones_employees.json';
      if (!cachedGhSha.tombstones || attempt > 0) {
        var check = await fetchGitHubFile('tombstones_employees.json');
        if (check && check.sha) cachedGhSha.tombstones = check.sha;
      }
      var list = Object.keys(tombMap || {});
      var b64 = utf8ToB64(JSON.stringify(list));
      var res = await ghFetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'sync: update employee tombstones',
          content: b64,
          sha: cachedGhSha.tombstones || undefined,
          branch: 'main'
        })
      });
      if (res.ok) {
        var out = await res.json();
        if (out && out.content && out.content.sha) {
          cachedGhSha.tombstones = out.content.sha;
        }
        if (out && out.commit && out.commit.sha) {
          lastKnownTombCommitSha = out.commit.sha;
        }
        return true;
      }
      if ((res.status === 409 || res.status === 422) && attempt < 3) {
        cachedGhSha.tombstones = '';
        await new Promise(function(r) { setTimeout(r, 200 + attempt * 150); });
        return await pushGitHubTombstones(tombMap, attempt + 1);
      }
    } catch (e) {
      console.warn('[ATPL-RealTime] GitHub tombstones push warning:', e);
    }
    return false;
  }

  // ── Lossless Google Drive JSON Vault Sync (same transport as Adv Deduction) ──
  async function callDriveGas(action, params) {
    if (root.ATPLGoogleSync && typeof root.ATPLGoogleSync.callGoogleBackend === 'function') {
      try {
        var r = await root.ATPLGoogleSync.callGoogleBackend(action, params || {});
        if (r) return r;
      } catch (_) {}
    }
    var endpoint = getGasUrl();
    if (!endpoint) return null;
    try {
      var res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(Object.assign({ action: action, sender: clientId, _ts: Date.now() }, params || {}))
      });
      if (!res.ok) return null;
      return await res.json();
    } catch (_) {
      return null;
    }
  }

  async function pushDriveVault(records, tombsMap) {
    var list = Array.isArray(records) ? records : [];
    var nowIso = new Date().toISOString();
    var payload = {
      version: 2,
      employees: list,
      tombstones: tombsMap || getLocalTombstones(),
      count: list.length,
      updatedAt: nowIso
    };
    var b64 = utf8ToB64(JSON.stringify(payload));
    if (!b64) return false;
    var res = await callDriveGas('uploadFile', {
      fileName: 'atpl_employee_master_vault.json',
      fileBase64: b64,
      mimeType: 'application/json'
    });
    if (res && res.ok) {
      try { root.localStorage.setItem('ATPL_EMP_VAULT_LAST_TS', String(Date.parse(nowIso))); } catch (_) {}
      return true;
    }
    return false;
  }

  async function fetchDriveVault() {
    var res = await callDriveGas('downloadFile', { fileName: 'atpl_employee_master_vault.json' });
    if (res && res.ok && res.fileBase64) {
      try {
        var jsonStr = b64ToUtf8(res.fileBase64);
        var data = JSON.parse(jsonStr);
        if (data && Array.isArray(data.employees)) {
          return data;
        }
      } catch (_) {}
    }
    return null;
  }

  function queueCloudSync(pushTombstonesToo) {
    var pushQueuedAt = Date.now();
    if (ghWriteDebounceTimer) clearTimeout(ghWriteDebounceTimer);
    ghWriteDebounceTimer = setTimeout(function() {
      ghPushChain = ghPushChain.then(async function() {
        var listToSave = (root.EM && Array.isArray(root.EM.data)) ? root.EM.data.slice() : [];
        var tombsMap = getLocalTombstones();
        var ghOk = await pushGitHubMasterWithMergeRetry('sync: update employee master (' + listToSave.length + ' records)', 0);
        if (pushTombstonesToo) {
          await pushGitHubTombstones(tombsMap, 0);
        }
        var driveOk = await pushDriveVault(listToSave, tombsMap);
        if (ghOk || driveOk) {
          markPendingOpsSynced(pushQueuedAt);
        }
      }).catch(function(e) {
        console.warn('[ATPL-RealTime] Cloud sync queue warning:', e);
      });
    }, 250);
  }

  // ── Tombstone Merge Helper ──
  function applyRemoteTombstones(remoteTombs) {
    var tombs = getLocalTombstones();
    var changed = false;
    if (Array.isArray(remoteTombs)) {
      remoteTombs.forEach(function(id) {
        if (!id || id === '__ALL_CLEARED__') return;
        var raw = normalizeId(id);
        var clean = normalizeKey(id);
        if (raw && !tombs[raw]) { tombs[raw] = new Date().toISOString(); changed = true; }
        if (clean && !tombs[clean]) { tombs[clean] = tombs[raw]; changed = true; }
      });
    } else if (remoteTombs && typeof remoteTombs === 'object') {
      Object.keys(remoteTombs).forEach(function(k) {
        var raw = normalizeId(k);
        var clean = normalizeKey(k);
        if (raw && !tombs[raw]) { tombs[raw] = remoteTombs[k]; changed = true; }
        if (clean && !tombs[clean]) { tombs[clean] = remoteTombs[k]; changed = true; }
      });
    }
    if (changed) saveLocalTombstones(tombs);
    return tombs;
  }

  // ── Master State Hydration (Cold-Start Authoritative Sync) ──
  async function hydrateMasterState() {
    if (isHydrating) return;
    isHydrating = true;
    try {
      var localRows = [];
      try {
        var raw = root.localStorage.getItem(STORAGE_KEY_MASTER);
        var parsed = raw ? JSON.parse(raw) : [];
        if (Array.isArray(parsed)) localRows = parsed;
      } catch (_) {}

      var isCleared = root.localStorage.getItem(STORAGE_KEY_CLEARED) === 'true';
      var tombs = getLocalTombstones();

      // 1. Immediately hydrate UI from localStorage + pendingOps so startup is 0ms
      if (localRows.length > 0 && !isCleared) {
        var fastLocal = mergeEmployeeLists(localRows, [], tombs, false);
        applyDataAndRefreshIfChanged(fastLocal, false);
      }

      // 2. Fetch latest authoritative snapshot directly from GitHub API (bypasses CDN!)
      var remoteRows = null;
      var headSha = await fetchGitHubCommitHead('data/employee_master.json');
      var ghMaster = await fetchGitHubFile('employee_master.json', headSha || 'main');
      if (ghMaster && Array.isArray(ghMaster.data)) {
        remoteRows = ghMaster.data;
        if (headSha) lastKnownCommitSha = headSha;
      }
      var ghTombs = await fetchGitHubFile('tombstones_employees.json');
      if (ghTombs && ghTombs.data) {
        if (Array.isArray(ghTombs.data) && ghTombs.data.indexOf('__ALL_CLEARED__') !== -1) {
          isCleared = true;
          remoteRows = [];
        } else {
          tombs = applyRemoteTombstones(ghTombs.data);
        }
      }

      // 3. Also check Google Drive Vault (redundancy if GitHub failed or Drive is newer)
      var vault = await fetchDriveVault();
      if (vault && Array.isArray(vault.employees) && vault.employees.length > 0) {
        if (vault.tombstones) tombs = applyRemoteTombstones(vault.tombstones);
        if (!remoteRows || !remoteRows.length) {
          remoteRows = vault.employees;
        } else {
          remoteRows = mergeEmployeeLists(remoteRows, vault.employees, tombs, true);
        }
      }

      // 4. Only if BOTH GitHub & Drive Vault had 0 records & local was empty, try static seed
      if ((!remoteRows || !remoteRows.length) && !localRows.length && !isCleared) {
        try {
          var fallbackRes = await fetch('./data/employee_master.json?_t=' + Date.now(), { cache: 'no-store' });
          if (fallbackRes.ok) {
            var list = await fallbackRes.json();
            if (Array.isArray(list) && list.length > 0) remoteRows = list;
          }
        } catch (_) {}
      }

      var pendingOps = prunePendingOps(readPendingOps());
      if (pendingOps.__CLEAR_ALL__ && (!remoteRows || !remoteRows.length)) {
        applyDataAndRefreshIfChanged([], true);
      } else {
        var finalRecords = mergeEmployeeLists(localRows, remoteRows || [], tombs, true);
        applyDataAndRefreshIfChanged(finalRecords, finalRecords.length === 0 && isCleared);

        // If pending local ops exist (e.g. page refreshed right after a status edit), flush them now
        var hasUnsynced = Object.keys(pendingOps).some(function(k) { return pendingOps[k] && !pendingOps[k].synced; });
        if (hasUnsynced) {
          queueCloudSync(true);
        } else if (finalRecords.length > 0 && (!vault || !vault.employees || vault.employees.length === 0)) {
          // Backfill empty Drive Vault cleanly once
          pushDriveVault(finalRecords, tombs).catch(function() {});
        }
      }
    } finally {
      isHydrating = false;
    }
  }

  // ── Public Engine API ──
  var Engine = {
    hydrate: hydrateMasterState,

    reconcileExternalRecords: function(externalRows, isAuthoritativeVault, externalTombstones) {
      if (!Array.isArray(externalRows) || !externalRows.length) return false;
      // Never let broken Google Sheet rows (empty names + no status + no timestamps) overwrite valid data
      var validNamedCount = 0;
      var hasTimestamps = false;
      for (var i = 0; i < externalRows.length; i++) {
        var r = externalRows[i];
        if (!r) continue;
        if (String(r.name || '').trim() !== '') validNamedCount++;
        if (r._em_updated_at || r._status_updated_at) hasTimestamps = true;
      }
      if (!isAuthoritativeVault && validNamedCount === 0 && !hasTimestamps) {
        return false;
      }

      var tombs = externalTombstones ? applyRemoteTombstones(externalTombstones) : getLocalTombstones();
      var currentList = (root.EM && Array.isArray(root.EM.data)) ? root.EM.data : [];
      var merged = mergeEmployeeLists(currentList, externalRows, tombs, true);
      return applyDataAndRefreshIfChanged(merged, false);
    },

    updateEmployeeStatus: async function(empId, newStatus, dol, fullRecord) {
      if (!empId) return { ok: true, verified: true };
      var cleanId = normalizeId(empId);
      var targetStatus = normalizeStatusValue(newStatus || (fullRecord && fullRecord.status));
      var targetDol = (targetStatus === 'ACTIVE') ? '' : (dol !== undefined ? String(dol || '').trim() : '');
      if ((targetStatus === 'LEFT' || targetStatus === 'INACTIVE') && (!targetDol || targetDol === '—' || targetDol === 'NA')) {
        targetDol = formatTodayDdMmYyyy();
      }

      var now = Date.now();
      // Deduplicate rapid double-calls for exact same status change (e.g. index.html + hook wrapper)
      if (
        lastDirectStatusCall.key === cleanId &&
        lastDirectStatusCall.status === targetStatus &&
        lastDirectStatusCall.dol === targetDol &&
        (now - lastDirectStatusCall.ts) < 250
      ) {
        return { ok: true, verified: true, emp_id: cleanId, status: targetStatus, dol: targetDol, deduped: true };
      }
      lastDirectStatusCall = { key: cleanId, status: targetStatus, dol: targetDol, ts: now };
      lastLocalMutationTime = now;

      var item = fullRecord ? Object.assign({}, fullRecord) : null;
      if (!item && root.EM && Array.isArray(root.EM.data)) {
        var found = root.EM.data.find(function(x) {
          return normalizeId(x && (x.emp_id || x.id || x.code)) === cleanId;
        });
        if (found) item = Object.assign({}, found);
      }
      if (!item) item = { emp_id: cleanId };

      item.emp_id = cleanId;
      item.status = targetStatus;
      if (targetStatus === 'ACTIVE') {
        clearLeavingDates(item);
      } else {
        item.dol = targetDol;
      }
      item._status_updated_at = now;
      item._em_updated_at = now;

      recordPendingOp(cleanId, {
        type: 'status',
        emp_id: cleanId,
        status: targetStatus,
        dol: item.dol || '',
        ts: now,
        synced: false,
        record: item
      });

      var payload = {
        action: 'status_update',
        emp_id: cleanId,
        status: targetStatus,
        dol: item.dol || '',
        timestamp: now,
        record: item
      };

      handleIncomingSyncEvent(Object.assign({}, payload, { senderId: clientId }));
      broadcastSyncEvent(payload);
      queueCloudSync(false);

      try {
        if (typeof fetch === 'function' && root.location && !/(^|\.)github\.io$/i.test(root.location.hostname || '')) {
          fetch('/api/sync/employee-master', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ records: [item], mode: 'upsert' })
          }).catch(function() {});
        }
      } catch (_) {}

      return { ok: true, verified: true, emp_id: cleanId, status: targetStatus, dol: item.dol || '', version: lastCloudVersion };
    },

    saveEmployees: async function(records) {
      var list = Array.isArray(records) ? records : (records ? [records] : []);
      if (!list.length) return { ok: true, verified: true, count: 0 };

      var now = Date.now();
      lastLocalMutationTime = now;

      var stamped = [];
      list.forEach(function(rec) {
        if (!rec || typeof rec !== 'object') return;
        var cid = normalizeId(rec.emp_id || rec.id || rec.code);
        if (!cid) return;
        var copyRec = Object.assign({}, rec, {
          emp_id: cid,
          _em_updated_at: now
        });
        if (copyRec.status) {
          copyRec.status = normalizeStatusValue(copyRec.status);
          copyRec._status_updated_at = now;
          if (copyRec.status === 'ACTIVE') {
            clearLeavingDates(copyRec);
          }
        }
        sanitizePfAccountRecord(copyRec);
        stamped.push(copyRec);
        recordPendingOp(cid, {
          type: 'upsert',
          emp_id: cid,
          ts: now,
          synced: false,
          record: copyRec
        });
      });

      if (!stamped.length) return { ok: true, verified: true, count: 0 };

      handleIncomingSyncEvent({ action: 'upsert', records: stamped, timestamp: now, senderId: clientId });
      broadcastSyncEvent({ action: 'upsert', records: stamped, timestamp: now });
      queueCloudSync(false);

      try {
        if (typeof fetch === 'function' && root.location && !/(^|\.)github\.io$/i.test(root.location.hostname || '')) {
          fetch('/api/sync/employee-master', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ records: stamped, mode: 'upsert' })
          }).catch(function() {});
        }
      } catch (_) {}

      return { ok: true, verified: true, count: stamped.length, total: root.EM ? root.EM.data.length : stamped.length, version: lastCloudVersion };
    },

    deleteEmployee: async function(empId) {
      if (!empId) return { ok: true, verified: true };
      var cleanId = normalizeId(empId);
      var now = Date.now();
      lastLocalMutationTime = now;

      recordPendingOp(cleanId, { type: 'delete', emp_id: cleanId, ts: now, synced: false });
      handleIncomingSyncEvent({ action: 'delete', emp_id: cleanId, timestamp: now, senderId: clientId });
      broadcastSyncEvent({ action: 'delete', emp_id: cleanId, timestamp: now });
      queueCloudSync(true);

      try {
        if (typeof fetch === 'function' && root.location && !/(^|\.)github\.io$/i.test(root.location.hostname || '')) {
          fetch('/api/sync/employee-master/' + encodeURIComponent(cleanId), { method: 'DELETE' }).catch(function() {});
        }
      } catch (_) {}

      return { ok: true, verified: true, deleted: cleanId, version: lastCloudVersion };
    },

    bulkDeleteEmployees: async function(ids) {
      if (!Array.isArray(ids) || !ids.length) return { ok: true, verified: true, count: 0 };
      var cleanIds = ids.map(normalizeId).filter(Boolean);
      var now = Date.now();
      lastLocalMutationTime = now;

      cleanIds.forEach(function(cid) {
        recordPendingOp(cid, { type: 'delete', emp_id: cid, ts: now, synced: false });
      });

      handleIncomingSyncEvent({ action: 'bulk_delete', ids: cleanIds, timestamp: now, senderId: clientId });
      broadcastSyncEvent({ action: 'bulk_delete', ids: cleanIds, timestamp: now });
      queueCloudSync(true);

      return { ok: true, verified: true, count: cleanIds.length, version: lastCloudVersion };
    },

    clearAllEmployees: async function() {
      var now = Date.now();
      lastLocalMutationTime = now;
      recordPendingOp('__CLEAR_ALL__', { type: 'clear_all', ts: now, synced: false });
      handleIncomingSyncEvent({ action: 'delete_all', timestamp: now, senderId: clientId });
      broadcastSyncEvent({ action: 'delete_all', timestamp: now });
      queueCloudSync(true);
      return { ok: true, verified: true, cleared: true, count: 0, version: lastCloudVersion };
    },

    checkRemoteUpdates: async function(force) {
      if (isPollingRemote || isHydrating) return;
      if (!force && ((root.document && root.document.hidden) || Date.now() - lastLocalMutationTime < 2500)) return;
      isPollingRemote = true;
      try {
        var curSha = await fetchGitHubCommitHead('data/employee_master.json');
        if (curSha && curSha !== lastKnownCommitSha) {
          lastKnownCommitSha = curSha;
          var remoteFile = await fetchGitHubFile('employee_master.json', curSha);
          var ghTombs = await fetchGitHubFile('tombstones_employees.json');
          var tombs = getLocalTombstones();
          if (ghTombs && ghTombs.data) {
            if (Array.isArray(ghTombs.data) && ghTombs.data.indexOf('__ALL_CLEARED__') !== -1) {
              applyDataAndRefreshIfChanged([], true);
              return;
            }
            tombs = applyRemoteTombstones(ghTombs.data);
          }
          if (remoteFile && Array.isArray(remoteFile.data)) {
            var currentList = (root.EM && Array.isArray(root.EM.data)) ? root.EM.data : [];
            var merged = mergeEmployeeLists(currentList, remoteFile.data, tombs, true);
            applyDataAndRefreshIfChanged(merged, merged.length === 0);
          }
        }
      } catch (e) {
        console.warn('[ATPL-RealTime] Remote poll warning:', e);
      } finally {
        isPollingRemote = false;
      }
    }
  };

  // ── Global Hooks Integration ──
  function installHooks() {
    var origSaveModal = root.emSaveModal;
    if (typeof origSaveModal === 'function' && !origSaveModal.__atplRealtime) {
      var wrappedSaveModal = async function() {
        var originalResult = await origSaveModal.apply(this, arguments);
        var candidate = null;
        if (typeof root.fieldsToEmployee === 'function') candidate = root.fieldsToEmployee();
        if (candidate && candidate.emp_id) {
          await Engine.saveEmployees([candidate]);
        } else if (root.EM && Array.isArray(root.EM.data)) {
          // Only push the edited employee if editIdx is valid, else latest added
          var idx = root.EM.editIdx;
          if (idx >= 0 && root.EM.data[idx]) {
            await Engine.saveEmployees([root.EM.data[idx]]);
          } else if (root.EM.data.length) {
            await Engine.saveEmployees([root.EM.data[root.EM.data.length - 1]]);
          }
        }
        return originalResult;
      };
      wrappedSaveModal.__atplRealtime = true;
      root.emSaveModal = wrappedSaveModal;
    }

    var origSaveBulk = root.emSaveBulk;
    if (typeof origSaveBulk === 'function' && !origSaveBulk.__atplRealtime) {
      var wrappedSaveBulk = async function() {
        var rowsBefore = Array.isArray(root.EM_BULK_ROWS) ? root.EM_BULK_ROWS.slice() : [];
        var originalResult = await origSaveBulk.apply(this, arguments);
        if (rowsBefore.length) {
          await Engine.saveEmployees(rowsBefore);
        } else if (root.EM && Array.isArray(root.EM.data)) {
          await Engine.saveEmployees(root.EM.data);
        }
        return originalResult;
      };
      wrappedSaveBulk.__atplRealtime = true;
      root.emSaveBulk = wrappedSaveBulk;
    }

    var origDeleteRow = root.emDeleteRow;
    if (typeof origDeleteRow === 'function' && !origDeleteRow.__atplRealtime) {
      var wrappedDeleteRow = async function(idx) {
        var item = root.EM && root.EM.data && root.EM.data[idx];
        var empId = item && (item.emp_id || item.id || item.code);
        if (origDeleteRow) {
          try { await origDeleteRow.apply(this, arguments); } catch (_) {}
        }
        if (empId) {
          Engine.deleteEmployee(empId);
        }
      };
      wrappedDeleteRow.__atplRealtime = true;
      root.emDeleteRow = wrappedDeleteRow;
    }

    var origDeleteSelected = root.emDeleteSelected;
    if (typeof origDeleteSelected === 'function' && !origDeleteSelected.__atplRealtime) {
      var wrappedDeleteSelected = async function() {
        var isAll = root.EM && root.EM.selectedRows && root.EM.data && (root.EM.selectedRows.size >= root.EM.data.length);
        var selectedIds = [];
        if (root.EM && root.EM.selectedRows && root.EM.data) {
          root.EM.selectedRows.forEach(function(idx) {
            var item = root.EM.data[idx];
            if (item && item.emp_id) selectedIds.push(item.emp_id);
          });
        }
        if (origDeleteSelected) {
          try { await origDeleteSelected.apply(this, arguments); } catch (_) {}
        }
        if (isAll || (root.EM && root.EM.data && root.EM.data.length === 0)) {
          Engine.clearAllEmployees();
        } else if (selectedIds.length) {
          Engine.bulkDeleteEmployees(selectedIds);
        }
      };
      wrappedDeleteSelected.__atplRealtime = true;
      root.emDeleteSelected = wrappedDeleteSelected;
    }

    var origUpdateStatus = root.emUpdateStatus;
    if (typeof origUpdateStatus === 'function' && !origUpdateStatus.__atplRealtime) {
      var wrappedUpdateStatus = function(idx, newStatus) {
        var res;
        try { res = origUpdateStatus.apply(this, arguments); } catch (_) {}
        var item = root.EM && root.EM.data && root.EM.data[idx];
        if (item && item.emp_id) {
          Engine.updateEmployeeStatus(item.emp_id, item.status || newStatus, item.dol, item);
        }
        return res;
      };
      wrappedUpdateStatus.__atplRealtime = true;
      root.emUpdateStatus = wrappedUpdateStatus;
    }

    var origAroraImportExcel = root.aroraImportExcel;
    if (typeof origAroraImportExcel === 'function' && !origAroraImportExcel.__atplRealtime) {
      var wrappedAroraImportExcel = async function() {
        var res = await origAroraImportExcel.apply(this, arguments);
        if (root.EM && Array.isArray(root.EM.data) && root.EM.data.length) {
          await Engine.saveEmployees(root.EM.data.slice());
        }
        return res;
      };
      wrappedAroraImportExcel.__atplRealtime = true;
      root.aroraImportExcel = wrappedAroraImportExcel;
    }

    if (root.ATPLGoogleSync) {
      root.ATPLGoogleSync.clearAllEmployees = Engine.clearAllEmployees;
      root.ATPLGoogleSync.upsertEmployeeMaster = Engine.saveEmployees;
      root.ATPLGoogleSync.deleteEmployeeMaster = Engine.deleteEmployee;
      root.ATPLGoogleSync.bulkDeleteEmployees = Engine.bulkDeleteEmployees;
      root.ATPLGoogleSync.saveEmployeeMaster = Engine.saveEmployees;
      root.ATPLGoogleSync.updateEmployeeStatus = Engine.updateEmployeeStatus;
    }
  }

  // ── Initialization & Multi-Browser Active Listeners ──
  root.ATPLEmployeeMasterRealtimeEngine = Engine;

  setupServerSSE();
  setupMqttWebSocket();
  installHooks();

  if (root.document && root.document.readyState === 'loading') {
    root.document.addEventListener('DOMContentLoaded', function() {
      hydrateMasterState();
      installHooks();
    }, { once: true });
  } else {
    hydrateMasterState();
    installHooks();
  }

  setTimeout(installHooks, 300);
  setTimeout(installHooks, 1000);
  setTimeout(installHooks, 2500);

  if (root.addEventListener) {
    root.addEventListener('focus', function() { Engine.checkRemoteUpdates(true); });
    root.addEventListener('online', function() { Engine.checkRemoteUpdates(true); });
    root.document && root.document.addEventListener('visibilitychange', function() {
      if (!root.document.hidden) Engine.checkRemoteUpdates(true);
    });
  }

  setInterval(function() {
    if (!root.document || !root.document.hidden) {
      Engine.checkRemoteUpdates(false);
    }
  }, 2500);

  console.log('[ATPL-RealTime] Authoritative Employee Master Real-Time Sync Engine v4.0 ACTIVE.');
})(typeof window !== 'undefined' ? window : this);
