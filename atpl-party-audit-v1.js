/**
 * ATPL PARTY AUDIT VAULT & GOOGLE DRIVE SYNC (V1.0)
 * Organizes Audit-Ready Documents by Party Audit Name (RWS, MWS, Inditex & custom buyer audits)
 * with button-driven workflow, IndexedDB binary cache, Express server sync, and Google Drive Vault sync.
 */
(function (root) {
  'use strict';

  var MODULE_VERSION = '2026.11.23-party-audit-v1';
  if (root.__ATPL_PARTY_AUDIT_INIT__ === MODULE_VERSION) return;
  root.__ATPL_PARTY_AUDIT_INIT__ = MODULE_VERSION;

  var VAULT_STORAGE_KEY = 'ATPL_PartyAuditVaultV1';
  var TOMB_STORAGE_KEY = 'ATPL_PartyAuditTombstonesV1';
  var PARTY_TOMB_STORAGE_KEY = 'ATPL_PartyAuditPartyTombstonesV1';
  var PENDING_STORAGE_KEY = 'ATPL_PartyAuditPendingV1';
  var LAST_SYNC_STORAGE_KEY = 'ATPL_PartyAuditLastSyncV1';

  var DRIVE_VAULT_FILE = 'ATPL_PARTY_AUDIT_VAULT_V1.json';
  var DRIVE_ATT_PREFIX = 'atpl_party_audit_att_';
  var DEFAULT_GAS_URL = 'https://script.google.com/macros/s/AKfycbxiaKVtVJUWqDPtI-9iecG0LE817SfbbQNfUaZouw8sgYr3f1zRffutMu_UGnV-vqy-oA/exec';

  var IDB_NAME = 'ATPL_PartyAuditDB_V1';
  var IDB_STORE = 'attachments';
  var CHANNEL_NAME = 'ATPL_ERP_TRIGGER_BUS';
  var CLIENT_ID = 'paudit_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);

  var CATEGORIES = [
    'Statutory & Payroll',
    'Buyer Policy & COC',
    'Traceability & Certificates',
    'Health, Safety & Env',
    'HR & Training',
    'Facility & Licenses'
  ];

  var STATUS_META = {
    ready: { label: 'Audit Ready', bg: '#ecfdf5', fg: '#047857', border: '#a7f3d0' },
    review: { label: 'In Review', bg: '#eff6ff', fg: '#1d4ed8', border: '#bfdbfe' },
    pending: { label: 'Needs Update', bg: '#fffbeb', fg: '#b45309', border: '#fde68a' }
  };

  var DEFAULT_PARTIES = [
    {
      id: 'RWS',
      name: 'RWS',
      fullName: 'Responsible Wool Standard (RWS)',
      scope: 'Wool traceability, animal welfare, social & chain-of-custody audit readiness',
      auditDate: '',
      auditor: 'Control Union / Third-Party',
      locked: false,
      checklist: [
        { title: 'RWS Scope Certificate', category: 'Traceability & Certificates' },
        { title: 'Transaction Certificates (TC) — Raw & Yarn Lots', category: 'Traceability & Certificates' },
        { title: 'Wool Lot Traceability & Mass Balance Register', category: 'Traceability & Certificates' },
        { title: 'Social, Wage & Working Hours Compliance File', category: 'Statutory & Payroll' },
        { title: 'Worker Health, Safety & Chemical Handling Training', category: 'HR & Training' },
        { title: 'RWS SOP & Internal Self-Assessment Report', category: 'Buyer Policy & COC' }
      ]
    },
    {
      id: 'MWS',
      name: 'MWS',
      fullName: 'MWS Buyer & Compliance Audit',
      scope: 'Mill compliance, payroll audit, statutory returns & safety readiness',
      auditDate: '',
      auditor: 'Buyer Compliance Team',
      locked: false,
      checklist: [
        { title: 'Factory License & Establishment Registration', category: 'Facility & Licenses' },
        { title: 'PF & ESIC Monthly Challans & ECR Copies', category: 'Statutory & Payroll' },
        { title: 'Minimum Wage, Salary & Bonus Register', category: 'Statutory & Payroll' },
        { title: 'Attendance, Overtime & Leave Audit Sheet', category: 'Statutory & Payroll' },
        { title: 'Fire Safety NOC & Building Stability Certificate', category: 'Health, Safety & Env' },
        { title: 'Pollution / ETP & Boiler Inspection Compliance', category: 'Health, Safety & Env' }
      ]
    },
    {
      id: 'INDITEX',
      name: 'Inditex',
      fullName: 'Inditex Social & Technical Audit',
      scope: 'Inditex Code of Conduct, Green to Wear / ZDHC, wages & OHS compliance',
      auditDate: '',
      auditor: 'Inditex Sustainability / Audit',
      locked: false,
      checklist: [
        { title: 'Inditex Code of Conduct & Minimum Requirements', category: 'Buyer Policy & COC' },
        { title: 'Salary Register, Payslips & Bank Payout Proof', category: 'Statutory & Payroll' },
        { title: 'PF, ESIC & Statutory Welfare Registers', category: 'Statutory & Payroll' },
        { title: 'Health, Safety, PPE & Emergency Evacuation Log', category: 'Health, Safety & Env' },
        { title: 'ZDHC Chemical Inventory & Wastewater Test Report', category: 'Health, Safety & Env' },
        { title: 'Grievance Mechanism & Anti-Harassment Policy', category: 'HR & Training' }
      ]
    }
  ];

  var state = {
    parties: [],
    docs: [],
    tombstones: {},
    partyTombstones: {},
    pending: { docSaves: {}, docDeletes: {}, partySaves: {}, partyDeletes: {} },
    selectedPartyId: 'ALL',
    statusFilter: 'ALL',
    categoryFilter: 'ALL',
    expiringOnly: false,
    searchQuery: '',
    sortBy: 'newest',
    showChecklist: true,
    syncing: false,
    syncText: 'Ready',
    syncError: '',
    lastSyncAt: '',
    hydratedMap: {}
  };

  var writeChain = Promise.resolve();
  var syncInFlight = null;
  var stylesInjected = false;
  var listenersBound = false;
  var pollTimer = null;

  // ── Utilities ──
  function safeJsonParse(s, fallback) {
    try { return JSON.parse(s); } catch (_) { return fallback; }
  }

  function dateMs(v) {
    if (typeof v === 'number' && isFinite(v)) return v;
    if (!v) return 0;
    var n = Date.parse(String(v));
    return isFinite(n) ? n : 0;
  }

  function safeKey(v) {
    return String(v || '').trim().replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 96) || 'item';
  }

  function normalizePartyId(nameOrId) {
    var clean = String(nameOrId || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    return clean || ('PARTY_' + Date.now());
  }

  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatBytes(bytes) {
    var n = Number(bytes) || 0;
    if (n <= 0) return '0 KB';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / (1024 * 1024)).toFixed(2) + ' MB';
  }

  function formatShortDate(iso) {
    if (!iso) return '—';
    var s = String(iso).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    var d = new Date(s);
    if (isNaN(d.getTime())) return s.slice(0, 16);
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function formatDateTime(iso) {
    if (!iso) return 'Never';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  function currentUserLabel() {
    try {
      if (root.ATPLPermissionGuard && typeof root.ATPLPermissionGuard.currentUser === 'function') {
        var u = root.ATPLPermissionGuard.currentUser();
        if (u) return u.name || u.id || 'Admin';
      }
      var raw = (root.sessionStorage && root.sessionStorage.getItem('ATPL_UserSession_V5')) ||
                (root.localStorage && root.localStorage.getItem('ATPL_UserSession_V5')) || '';
      var sess = safeJsonParse(raw, null);
      if (sess && (sess.name || sess.id)) return sess.name || sess.id;
    } catch (_) {}
    return 'Admin';
  }

  function canDo(action) {
    try {
      if (root.ATPLPermissionGuard && typeof root.ATPLPermissionGuard.can === 'function') {
        return !!root.ATPLPermissionGuard.can(action);
      }
    } catch (_) {}
    return true;
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
    var el = doc.getElementById('paToastBox');
    if (!el) {
      el = doc.createElement('div');
      el.id = 'paToastBox';
      el.className = 'pa-toast';
      doc.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(el._timer);
    el._timer = setTimeout(function () { el.classList.remove('show'); }, 3400);
  }

  function isServerAvailable() {
    try {
      var host = String(root.location && root.location.hostname || '').toLowerCase();
      var proto = String(root.location && root.location.protocol || '');
      if (!/^https?:$/.test(proto)) return false;
      if (host === 'localhost' || host === '127.0.0.1' || /\.run\.app$/i.test(host)) {
        return typeof root.fetch === 'function';
      }
      return false;
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

  function queueWrite(fn) {
    var next = writeChain.catch(function () {}).then(fn);
    writeChain = next.catch(function () {});
    return next;
  }

  function stripFromWindowFiles() {
    try {
      if (!Array.isArray(root.FILES)) return;
      root.FILES = root.FILES.filter(function (f) {
        if (!f || !f.name) return true;
        var low = String(f.name).toLowerCase().trim();
        if (low === DRIVE_VAULT_FILE.toLowerCase()) return false;
        if (low.indexOf(DRIVE_ATT_PREFIX) === 0) return false;
        return true;
      });
    } catch (_) {}
  }

  // ── Base64 & Encoding Helpers ──
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
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(input, 'utf8').toString('base64');
    }
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

  function dataUrlToBlob(dataUrl, fallbackMime) {
    var s = String(dataUrl || '');
    var mime = fallbackMime || 'application/octet-stream';
    var b64 = s;
    var match = s.match(/^data:([^;]+);base64,(.+)$/);
    if (match) {
      mime = match[1] || mime;
      b64 = match[2];
    }
    var bin = atob(b64);
    var arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new root.Blob([arr], { type: mime });
  }

  function fileToDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var reader = new root.FileReader();
      reader.onload = function () { resolve(String(reader.result || '')); };
      reader.onerror = function () { reject(reader.error || new Error('File read failed')); };
      reader.readAsDataURL(file);
    });
  }

  // ── Google Apps Script / Drive Transport ──
  async function callGas(action, params, timeoutMs) {
    var endpoint = getGasUrl();
    if (!endpoint) return { ok: false, error: 'Google Drive GAS URL missing' };
    if (typeof root.fetch !== 'function') return { ok: false, error: 'fetch unavailable' };
    var payload = Object.assign({ action: action, sender: CLIENT_ID, _ts: Date.now() }, params || {});
    var ctrl = (typeof root.AbortController !== 'undefined') ? new root.AbortController() : null;
    var timer = ctrl ? setTimeout(function () { try { ctrl.abort(); } catch (_) {} }, timeoutMs || 35000) : null;
    try {
      var res = await root.fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload),
        signal: ctrl ? ctrl.signal : undefined
      });
      if (timer) clearTimeout(timer);
      if (!res || !res.ok) return { ok: false, error: 'HTTP ' + (res ? res.status : 'error') };
      var txt = await res.text();
      return safeJsonParse(txt, { ok: false, error: 'Invalid JSON from Drive GAS' });
    } catch (e) {
      if (timer) clearTimeout(timer);
      return { ok: false, error: (e && e.message) || 'Network error' };
    }
  }

  async function downloadJsonFromDrive(fileName) {
    var res = await callGas('downloadFile', { fileName: fileName }, 32000);
    if (!res || !res.ok || !res.fileBase64) {
      var err = String(res && res.error || '');
      if (/not found/i.test(err)) return { found: false, data: null };
      return { found: false, transientError: err || 'Drive download failed', data: null };
    }
    var parsed = safeJsonParse(base64ToUtf8(res.fileBase64), null);
    if (!parsed || typeof parsed !== 'object') {
      return { found: false, transientError: 'Invalid Drive JSON payload', data: null };
    }
    return { found: true, data: parsed };
  }

  async function uploadJsonToDrive(fileName, obj) {
    var b64 = await utf8ToBase64(JSON.stringify(obj));
    if (!b64) throw new Error('Base64 encode failed');
    var res = await callGas('uploadFile', {
      fileName: fileName,
      module: 'vault',
      fileBase64: b64,
      mimeType: 'application/json'
    }, 45000);
    if (!res || !res.ok) throw new Error((res && res.error) || 'Drive upload failed');
    return res;
  }

  async function deleteFileFromDrive(fileName) {
    if (!fileName) return { ok: true };
    return await callGas('deleteFile', { fileName: fileName }, 25000);
  }

  // ── IndexedDB Binary Attachment Store ──
  function openIdb() {
    return new Promise(function (resolve) {
      try {
        if (!root.indexedDB) return resolve(null);
        var req = root.indexedDB.open(IDB_NAME, 1);
        req.onupgradeneeded = function (e) {
          var db = e.target.result;
          if (!db.objectStoreNames.contains(IDB_STORE)) {
            db.createObjectStore(IDB_STORE, { keyPath: 'id' });
          }
        };
        req.onsuccess = function (e) { resolve(e.target.result); };
        req.onerror = function () { resolve(null); };
      } catch (_) {
        resolve(null);
      }
    });
  }

  async function idbGetAtt(id) {
    if (!id) return null;
    var db = await openIdb();
    if (!db) return null;
    return new Promise(function (resolve) {
      try {
        var req = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(id);
        req.onsuccess = function () { try { db.close(); } catch (_) {} resolve(req.result || null); };
        req.onerror = function () { try { db.close(); } catch (_) {} resolve(null); };
      } catch (_) {
        try { db.close(); } catch (_) {}
        resolve(null);
      }
    });
  }

  async function idbPutAtt(record) {
    if (!record || !record.id) return false;
    var db = await openIdb();
    if (!db) return false;
    return new Promise(function (resolve) {
      try {
        var tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).put(record);
        tx.oncomplete = function () { try { db.close(); } catch (_) {} resolve(true); };
        tx.onerror = function () { try { db.close(); } catch (_) {} resolve(false); };
      } catch (_) {
        try { db.close(); } catch (_) {}
        resolve(false);
      }
    });
  }

  async function idbDeleteAtt(id) {
    if (!id) return false;
    var db = await openIdb();
    if (!db) return false;
    return new Promise(function (resolve) {
      try {
        var tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).delete(id);
        tx.oncomplete = function () { try { db.close(); } catch (_) {} resolve(true); };
        tx.onerror = function () { try { db.close(); } catch (_) {} resolve(false); };
      } catch (_) {
        try { db.close(); } catch (_) {}
        resolve(false);
      }
    });
  }

  // ── Data Normalization & Merge Logic (Pure / Testable) ──
  function docAttFileName(id) {
    return DRIVE_ATT_PREFIX + safeKey(id) + '.json';
  }

  function hasInlineBytes(doc) {
    if (!doc) return false;
    if (doc.file_data && typeof doc.file_data === 'string' && doc.file_data.length > 8) return true;
    if (Array.isArray(doc.files) && doc.files.some(function (f) { return f && f.data && String(f.data).length > 8; })) return true;
    return false;
  }

  function docMetaOnly(doc) {
    if (!doc) return null;
    var rawFiles = Array.isArray(doc.files) ? doc.files : [];
    var metaFiles = rawFiles.map(function (f) {
      return {
        name: f.name || '',
        type: f.type || '',
        size: Number(f.size) || 0
      };
    }).filter(function (f) { return f.name; });
    var hasAtt = Boolean(
      doc.has_attachment ||
      doc.file_name ||
      metaFiles.length ||
      hasInlineBytes(doc)
    );
    var copy = Object.assign({}, doc);
    delete copy.file_data;
    if (metaFiles.length) {
      copy.files = metaFiles;
    } else if (copy.file_name) {
      copy.files = [{ name: copy.file_name, type: copy.file_type || '', size: Number(copy.file_size) || 0 }];
    } else {
      copy.files = [];
    }
    copy.has_attachment = hasAtt;
    copy.attachment_count = copy.files.length || (hasAtt ? 1 : 0);
    copy.drive_attachment_file = hasAtt ? (doc.drive_attachment_file || docAttFileName(doc.id)) : '';
    return copy;
  }

  function buildAttachmentPayload(doc) {
    var list = [];
    if (Array.isArray(doc.files)) {
      list = doc.files.filter(function (f) { return f && f.data; }).map(function (f) {
        return { name: f.name || 'document', type: f.type || '', size: Number(f.size) || 0, data: f.data };
      });
    }
    if (!list.length && doc.file_data) {
      list = [{
        name: doc.file_name || 'document',
        type: doc.file_type || '',
        size: Number(doc.file_size) || 0,
        data: doc.file_data
      }];
    }
    return {
      v: 1,
      id: doc.id,
      updated_at: doc.updated_at || new Date().toISOString(),
      file_name: doc.file_name || (list[0] && list[0].name) || '',
      file_type: doc.file_type || (list[0] && list[0].type) || '',
      file_size: Number(doc.file_size) || (list[0] && list[0].size) || 0,
      file_data: doc.file_data || (list[0] && list[0].data) || null,
      files: list
    };
  }

  function normalizeParty(p) {
    if (!p) return null;
    var name = String(p.name || p.id || '').trim();
    if (!name) return null;
    var id = normalizePartyId(p.id || name);
    var checklist = Array.isArray(p.checklist) ? p.checklist.map(function (item) {
      if (typeof item === 'string') return { title: item.trim(), category: 'Buyer Policy & COC' };
      return {
        title: String(item && item.title || '').trim(),
        category: String(item && item.category || 'Buyer Policy & COC').trim() || 'Buyer Policy & COC'
      };
    }).filter(function (item) { return item.title; }) : [];
    return {
      id: id,
      name: name,
      fullName: String(p.fullName || p.full_name || name).trim(),
      scope: String(p.scope || '').trim(),
      auditDate: String(p.auditDate || p.audit_date || '').trim(),
      auditor: String(p.auditor || '').trim(),
      checklist: checklist,
      updated_at: p.updated_at || new Date().toISOString()
    };
  }

  function normalizeDoc(d) {
    if (!d || !d.id) return null;
    var statusRaw = String(d.status || 'ready').toLowerCase();
    var status = (statusRaw === 'ready' || statusRaw === 'review' || statusRaw === 'pending') ? statusRaw : 'ready';
    var partyId = normalizePartyId(d.partyId || d.party_id || d.partyName || 'RWS');
    return Object.assign({}, d, {
      id: String(d.id),
      partyId: partyId,
      partyName: String(d.partyName || d.party_name || partyId).trim(),
      title: String(d.title || d.document_name || d.file_name || 'Untitled Audit Document').trim(),
      category: String(d.category || 'Statutory & Payroll').trim(),
      refNo: String(d.refNo || d.ref_no || '').trim(),
      auditPeriod: String(d.auditPeriod || d.audit_period || '').trim(),
      expiryDate: String(d.expiryDate || d.expiry_date || '').trim(),
      status: status,
      remarks: String(d.remarks || '').trim(),
      uploadedBy: String(d.uploadedBy || d.uploaded_by || 'Admin').trim(),
      created_at: d.created_at || d.updated_at || new Date().toISOString(),
      updated_at: d.updated_at || d.created_at || new Date().toISOString()
    });
  }

  function mergeTombstoneMaps(a, b) {
    var out = {};
    [a || {}, b || {}].forEach(function (src) {
      Object.keys(src).forEach(function (k) {
        var kl = String(k).toLowerCase();
        var v = src[k];
        var ts = dateMs(typeof v === 'string' ? v : (v && v.deleted_at));
        if (!ts) return;
        var prevTs = dateMs(out[kl]);
        if (ts > prevTs) out[kl] = new Date(ts).toISOString();
      });
    });
    return out;
  }

  function mergeParties(baseList, overlayList, partyTombstones) {
    var byId = {};
    function ingest(raw) {
      var p = normalizeParty(raw);
      if (!p) return;
      var kl = p.id.toLowerCase();
      var tTs = partyTombstones && partyTombstones[kl] ? dateMs(partyTombstones[kl]) : 0;
      var pTs = dateMs(p.updated_at);
      if (tTs && tTs >= pTs) return;
      var old = byId[kl];
      if (!old || pTs >= dateMs(old.updated_at)) {
        byId[kl] = p;
      }
    }
    (baseList || []).forEach(ingest);
    (overlayList || []).forEach(ingest);
    return Object.keys(byId).map(function (k) { return byId[k]; });
  }

  function mergeDocs(baseList, overlayList, tombstones) {
    var byId = {};
    function ingest(raw) {
      var d = normalizeDoc(raw);
      if (!d) return;
      var kl = d.id.toLowerCase();
      var dTs = dateMs(d.updated_at || d.created_at);
      var tTs = tombstones && tombstones[kl] ? dateMs(tombstones[kl]) : 0;
      if (tTs && tTs >= dTs) return;
      var old = byId[kl];
      if (!old) {
        byId[kl] = docMetaOnly(d);
        return;
      }
      var oldTs = dateMs(old.updated_at || old.created_at);
      var winner = dTs >= oldTs ? d : old;
      var donor = dTs >= oldTs ? old : d;
      var merged = Object.assign({}, donor, winner);
      if (!winner.has_attachment && donor.has_attachment && !winner._attachment_removed) {
        merged.has_attachment = true;
        merged.file_name = winner.file_name || donor.file_name || '';
        merged.file_type = winner.file_type || donor.file_type || '';
        merged.file_size = winner.file_size || donor.file_size || 0;
        merged.files = (Array.isArray(winner.files) && winner.files.length) ? winner.files : (donor.files || []);
        merged.drive_attachment_file = winner.drive_attachment_file || donor.drive_attachment_file || docAttFileName(merged.id);
      }
      byId[kl] = docMetaOnly(merged);
    }
    (baseList || []).forEach(ingest);
    (overlayList || []).forEach(ingest);
    return Object.keys(byId).map(function (k) { return byId[k]; });
  }

  // ── Local Persistence ──
  function loadLocalState() {
    var vault = readStorageJson(VAULT_STORAGE_KEY, null);
    var docTombs = readStorageJson(TOMB_STORAGE_KEY, {});
    var partyTombs = readStorageJson(PARTY_TOMB_STORAGE_KEY, {});
    var pending = readStorageJson(PENDING_STORAGE_KEY, {});

    state.tombstones = mergeTombstoneMaps(docTombs, {});
    state.partyTombstones = mergeTombstoneMaps(partyTombs, {});
    state.pending = {
      docSaves: (pending && pending.docSaves) || {},
      docDeletes: (pending && pending.docDeletes) || {},
      partySaves: (pending && pending.partySaves) || {},
      partyDeletes: (pending && pending.partyDeletes) || {}
    };

    var hasStoredParties = vault && Array.isArray(vault.parties) && vault.parties.length > 0;
    var seedParties = hasStoredParties ? vault.parties : DEFAULT_PARTIES.map(function (p) {
      return Object.assign({}, p, { updated_at: '2026-01-01T00:00:00.000Z' });
    });
    // Ensure RWS, MWS, Inditex exist unless explicitly tombstoned by user
    var mergedDefaults = mergeParties(
      DEFAULT_PARTIES.map(function (p) { return Object.assign({}, p, { updated_at: '2026-01-01T00:00:00.000Z' }); }),
      seedParties,
      state.partyTombstones
    );
    state.parties = mergedDefaults;
    state.docs = mergeDocs(vault && vault.docs ? vault.docs : [], [], state.tombstones);
    state.lastSyncAt = (root.localStorage && root.localStorage.getItem(LAST_SYNC_STORAGE_KEY)) || '';
    saveLocalState();
  }

  function saveLocalState() {
    var cleanDocs = state.docs.map(docMetaOnly).filter(Boolean);
    writeStorageJson(VAULT_STORAGE_KEY, {
      version: 1,
      updatedAt: new Date().toISOString(),
      parties: state.parties,
      docs: cleanDocs
    });
    writeStorageJson(TOMB_STORAGE_KEY, state.tombstones);
    writeStorageJson(PARTY_TOMB_STORAGE_KEY, state.partyTombstones);
    writeStorageJson(PENDING_STORAGE_KEY, state.pending);
    if (state.lastSyncAt && root.localStorage) {
      try { root.localStorage.setItem(LAST_SYNC_STORAGE_KEY, state.lastSyncAt); } catch (_) {}
    }
    updateSidebarBadge();
  }

  function updateSidebarBadge() {
    var doc = root.document;
    if (!doc) return;
    var badge = doc.getElementById('partyAuditBadge');
    if (!badge) return;
    var count = state.docs.length;
    badge.textContent = String(count);
    badge.style.display = count > 0 ? '' : 'none';
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
    try {
      root.__ATPL_INTERNAL_STORAGE_WRITE = true;
      if (root.localStorage) root.localStorage.setItem('ATPL_TRIGGER_EVENT', JSON.stringify(payload));
    } catch (_) {} finally {
      root.__ATPL_INTERNAL_STORAGE_WRITE = false;
    }
  }

  // ── Google Drive + Express Server Cloud Sync ──
  async function pushToExpressServer(fullDocWithBytes) {
    if (!isServerAvailable()) return false;
    try {
      var res = await root.fetch('/api/sync/party-audits/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parties: state.parties,
          partyTombstones: state.partyTombstones,
          docs: state.docs.map(docMetaOnly),
          tombstones: state.tombstones,
          attDoc: fullDocWithBytes && hasInlineBytes(fullDocWithBytes) ? buildAttachmentPayload(fullDocWithBytes) : null
        })
      });
      return !!(res && res.ok);
    } catch (_) {
      return false;
    }
  }

  async function pullFromExpressServer() {
    if (!isServerAvailable()) return null;
    try {
      var res = await root.fetch('/api/sync/party-audits');
      if (!res || !res.ok) return null;
      var data = await res.json();
      return (data && data.ok) ? data : null;
    } catch (_) {
      return null;
    }
  }

  async function syncNow(manual) {
    if (syncInFlight) return syncInFlight;
    syncInFlight = (async function () {
      state.syncing = true;
      state.syncError = '';
      state.syncText = 'Syncing with Google Drive…';
      renderHeaderSyncStatus();

      try {
        // 1. Flush any pending attachment uploads first
        var pendingSaveKeys = Object.keys(state.pending.docSaves || {});
        for (var i = 0; i < pendingSaveKeys.length; i++) {
          var pk = pendingSaveKeys[i];
          var cachedAtt = await idbGetAtt(pk);
          if (cachedAtt && hasInlineBytes(cachedAtt)) {
            await uploadJsonToDrive(docAttFileName(pk), buildAttachmentPayload(cachedAtt));
          }
          delete state.pending.docSaves[pk];
        }

        // 2. Delete any pending Drive attachment files
        var pendingDelKeys = Object.keys(state.pending.docDeletes || {});
        for (var j = 0; j < pendingDelKeys.length; j++) {
          var dk = pendingDelKeys[j];
          await deleteFileFromDrive(docAttFileName(dk)).catch(function () {});
          delete state.pending.docDeletes[dk];
        }

        // 3. Download remote Drive vault + optional Express Server state
        var driveDl = await downloadJsonFromDrive(DRIVE_VAULT_FILE);
        var srvData = await pullFromExpressServer();

        var remoteVault = (driveDl && driveDl.found && driveDl.data) ? driveDl.data : null;
        var mergedTombs = mergeTombstoneMaps(
          state.tombstones,
          mergeTombstoneMaps(remoteVault && remoteVault.tombstones, srvData && srvData.tombstones)
        );
        var mergedPartyTombs = mergeTombstoneMaps(
          state.partyTombstones,
          mergeTombstoneMaps(remoteVault && remoteVault.partyTombstones, srvData && srvData.partyTombstones)
        );

        var combinedParties = mergeParties(
          mergeParties(remoteVault && remoteVault.parties ? remoteVault.parties : [], srvData && srvData.parties ? srvData.parties : [], mergedPartyTombs),
          state.parties,
          mergedPartyTombs
        );
        var combinedDocs = mergeDocs(
          mergeDocs(remoteVault && remoteVault.docs ? remoteVault.docs : [], srvData && srvData.docs ? srvData.docs : [], mergedTombs),
          state.docs,
          mergedTombs
        );

        state.tombstones = mergedTombs;
        state.partyTombstones = mergedPartyTombs;
        state.parties = combinedParties;
        state.docs = combinedDocs;

        // 4. Write back authoritative merged vault to Google Drive & Server
        var newVault = {
          version: 1,
          updatedAt: new Date().toISOString(),
          parties: state.parties,
          partyTombstones: state.partyTombstones,
          docs: state.docs.map(docMetaOnly),
          tombstones: state.tombstones
        };

        var driveOk = false;
        try {
          await uploadJsonToDrive(DRIVE_VAULT_FILE, newVault);
          driveOk = true;
        } catch (driveErr) {
          state.syncError = (driveErr && driveErr.message) || 'Google Drive upload error';
        }

        var srvOk = await pushToExpressServer(null);

        if (driveOk || srvOk) {
          state.lastSyncAt = newVault.updatedAt;
          state.syncText = driveOk ? 'Google Drive Synced' : 'Server Synced';
        } else if (driveDl && driveDl.transientError) {
          state.syncText = 'Local Saved (Drive Retry Queued)';
          state.syncError = driveDl.transientError;
        }

        saveLocalState();
        stripFromWindowFiles();
        renderUI();
        if (manual) {
          notify(driveOk
            ? ('Google Drive synced (' + state.docs.length + ' audit docs, ' + state.parties.length + ' parties)')
            : ('Local/Server saved — Drive sync warning: ' + (state.syncError || 'check GAS URL')));
        }
        return { ok: driveOk || srvOk, docs: state.docs.length, parties: state.parties.length, error: state.syncError || '' };
      } catch (err) {
        state.syncError = (err && err.message) || 'Sync error';
        state.syncText = 'Sync Warning';
        if (manual) notify('Audit sync error: ' + state.syncError);
        return { ok: false, error: state.syncError };
      } finally {
        state.syncing = false;
        syncInFlight = null;
        renderHeaderSyncStatus();
      }
    })();
    return syncInFlight;
  }

  async function saveDocAndSync(docObj, hadNewAttachment) {
    var normalized = normalizeDoc(docObj);
    if (!normalized) return { ok: false, error: 'Invalid document data' };
    var k = normalized.id.toLowerCase();
    var nowIso = new Date().toISOString();
    normalized.updated_at = nowIso;

    // Clear tombstone if recreated
    if (state.tombstones[k]) delete state.tombstones[k];

    if (hadNewAttachment && hasInlineBytes(normalized)) {
      var attPayload = buildAttachmentPayload(normalized);
      await idbPutAtt(attPayload);
      state.hydratedMap[normalized.id] = attPayload;
      state.pending.docSaves[normalized.id] = nowIso;
    }

    var meta = docMetaOnly(normalized);
    var idx = state.docs.findIndex(function (d) { return d && String(d.id).toLowerCase() === k; });
    if (idx >= 0) state.docs[idx] = meta;
    else state.docs.unshift(meta);
    saveLocalState();
    renderUI();

    return await queueWrite(async function () {
      var driveAttOk = true;
      if (hadNewAttachment && hasInlineBytes(normalized)) {
        try {
          await uploadJsonToDrive(meta.drive_attachment_file || docAttFileName(meta.id), buildAttachmentPayload(normalized));
          delete state.pending.docSaves[normalized.id];
          saveLocalState();
        } catch (e) {
          driveAttOk = false;
        }
      }
      await pushToExpressServer(normalized);
      var syncRes = await syncNow(false);
      dispatchTrigger('party_audit_saved', { id: normalized.id, partyId: normalized.partyId, updated_at: nowIso });
      return { ok: driveAttOk && syncRes.ok, id: normalized.id };
    });
  }

  async function deleteDocAndSync(id) {
    if (!id) return { ok: false, error: 'Missing doc id' };
    var k = String(id).toLowerCase();
    var existing = state.docs.find(function (d) { return d && String(d.id).toLowerCase() === k; });
    var maxTs = existing ? dateMs(existing.updated_at || existing.created_at) : 0;
    var delIso = new Date(Math.max(Date.now(), maxTs + 1000)).toISOString();

    state.tombstones[k] = delIso;
    state.docs = state.docs.filter(function (d) { return d && String(d.id).toLowerCase() !== k; });
    delete state.hydratedMap[id];
    delete state.pending.docSaves[id];
    state.pending.docDeletes[id] = delIso;
    await idbDeleteAtt(id);
    saveLocalState();
    renderUI();

    return await queueWrite(async function () {
      try {
        await deleteFileFromDrive(docAttFileName(id));
        delete state.pending.docDeletes[id];
        saveLocalState();
      } catch (_) {}
      if (isServerAvailable()) {
        try {
          await root.fetch('/api/sync/party-audit/' + encodeURIComponent(id), { method: 'DELETE' });
        } catch (_) {}
      }
      var syncRes = await syncNow(false);
      dispatchTrigger('party_audit_deleted', { id: id, deleted_at: delIso });
      return { ok: syncRes.ok, id: id };
    });
  }

  async function savePartyAndSync(partyObj) {
    var p = normalizeParty(partyObj);
    if (!p) return { ok: false, error: 'Party name required' };
    p.updated_at = new Date().toISOString();
    var kl = p.id.toLowerCase();
    if (state.partyTombstones[kl]) delete state.partyTombstones[kl];

    var idx = state.parties.findIndex(function (x) { return x && x.id.toLowerCase() === kl; });
    if (idx >= 0) state.parties[idx] = p;
    else state.parties.push(p);

    // Update partyName on linked docs if renamed
    state.docs.forEach(function (d) {
      if (d && d.partyId && d.partyId.toLowerCase() === kl) {
        d.partyName = p.name;
      }
    });

    state.selectedPartyId = p.id;
    saveLocalState();
    renderUI();

    return await queueWrite(async function () {
      var res = await syncNow(false);
      dispatchTrigger('party_audit_party_saved', { id: p.id, updated_at: p.updated_at });
      return res;
    });
  }

  async function deletePartyAndSync(partyId) {
    if (!partyId) return { ok: false };
    var kl = String(partyId).toLowerCase();
    var delIso = new Date(Date.now() + 1000).toISOString();
    state.partyTombstones[kl] = delIso;
    state.parties = state.parties.filter(function (p) { return p && p.id.toLowerCase() !== kl; });

    // Also tombstone documents belonging to this party so orphan docs don't linger
    var docsToDrop = state.docs.filter(function (d) { return d && String(d.partyId || '').toLowerCase() === kl; });
    for (var i = 0; i < docsToDrop.length; i++) {
      var did = docsToDrop[i].id;
      state.tombstones[did.toLowerCase()] = delIso;
      state.pending.docDeletes[did] = delIso;
      await idbDeleteAtt(did);
    }
    state.docs = state.docs.filter(function (d) { return d && String(d.partyId || '').toLowerCase() !== kl; });
    if (state.selectedPartyId.toLowerCase() === kl) state.selectedPartyId = 'ALL';
    saveLocalState();
    renderUI();

    return await queueWrite(async function () {
      var res = await syncNow(false);
      dispatchTrigger('party_audit_party_deleted', { id: partyId, deleted_at: delIso });
      return res;
    });
  }

  async function hydrateAttachment(doc) {
    if (!doc || !doc.id) return null;
    if (state.hydratedMap[doc.id] && hasInlineBytes(state.hydratedMap[doc.id])) {
      return state.hydratedMap[doc.id];
    }
    // 1. Check IndexedDB
    var idbHit = await idbGetAtt(doc.id);
    if (idbHit && hasInlineBytes(idbHit)) {
      state.hydratedMap[doc.id] = idbHit;
      return idbHit;
    }
    // 2. Check Express Server if available
    if (isServerAvailable()) {
      try {
        var srvRes = await root.fetch('/api/sync/party-audit-att/' + encodeURIComponent(doc.id));
        if (srvRes && srvRes.ok) {
          var sj = await srvRes.json();
          if (sj && sj.ok && sj.att && hasInlineBytes(sj.att)) {
            await idbPutAtt(sj.att);
            state.hydratedMap[doc.id] = sj.att;
            return sj.att;
          }
        }
      } catch (_) {}
    }
    // 3. Download from Google Drive per-doc attachment JSON
    var attFile = doc.drive_attachment_file || docAttFileName(doc.id);
    var dl = await downloadJsonFromDrive(attFile);
    if (dl && dl.found && dl.data && hasInlineBytes(dl.data)) {
      await idbPutAtt(dl.data);
      state.hydratedMap[doc.id] = dl.data;
      return dl.data;
    }
    return null;
  }

  // ── Styles (Scoped to #page-partyaudit & .pa-modal-overlay) ──
  function ensureStyles() {
    var doc = root.document;
    if (!doc || stylesInjected || doc.getElementById('atplPartyAuditStyles')) {
      stylesInjected = true;
      return;
    }
    stylesInjected = true;
    var css = [
      '#page-partyaudit { background:#f8fafc; color:#0f172a; font-family:Inter,system-ui,-apple-system,sans-serif; }',
      '.pa-wrap { max-width:1440px; margin:0 auto; padding:16px 22px 36px; display:flex; flex-direction:column; gap:14px; }',
      '.pa-header { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:12px; background:#ffffff; border:1px solid #e2e8f0; border-radius:14px; padding:14px 20px; }',
      '.pa-title-block h1 { margin:0; font-size:21px; font-weight:800; letter-spacing:-0.02em; color:#0f172a; display:flex; align-items:center; gap:9px; }',
      '.pa-title-block p { margin:4px 0 0; font-size:13px; color:#475569; }',
      '.pa-header-actions { display:flex; flex-wrap:wrap; align-items:center; gap:8px; }',
      '.pa-sync-meta { font-size:12px; color:#64748b; margin-right:6px; font-variant-numeric:tabular-nums; }',
      '.pa-btn { display:inline-flex; align-items:center; justify-content:center; gap:7px; height:38px; padding:0 15px; border-radius:10px; font-size:13px; font-weight:700; cursor:pointer; border:1px solid #cbd5e1; background:#ffffff; color:#0f172a; transition:background .15s,border-color .15s,transform .1s; white-space:nowrap; font-family:inherit; }',
      '.pa-btn:hover { background:#f1f5f9; border-color:#94a3b8; }',
      '.pa-btn:active { transform:translateY(1px); }',
      '.pa-btn-primary { background:#0f172a; color:#ffffff; border-color:#0f172a; }',
      '.pa-btn-primary:hover { background:#1e293b; border-color:#1e293b; }',
      '.pa-btn-accent { background:#1d4ed8; color:#ffffff; border-color:#1d4ed8; }',
      '.pa-btn-accent:hover { background:#1e40af; border-color:#1e40af; }',
      '.pa-btn-sm { height:32px; padding:0 11px; font-size:12px; border-radius:8px; }',
      '.pa-btn-danger { color:#b91c1c; border-color:#fecaca; background:#fff; }',
      '.pa-btn-danger:hover { background:#fef2f2; border-color:#f87171; }',

      /* KPI Cards */
      '.pa-kpis { display:grid; grid-template-columns:repeat(5,minmax(0,1fr)); gap:11px; }',
      '.pa-kpi { background:#ffffff; border:1px solid #cbd5e1; border-radius:12px; padding:13px 15px; display:flex; flex-direction:column; align-items:flex-start; gap:4px; text-align:left; cursor:pointer; font-family:inherit; transition:border-color .15s,background .15s,transform .1s; }',
      '.pa-kpi:hover { border-color:#64748b; background:#f8fafc; }',
      '.pa-kpi:active { transform:translateY(1px); }',
      '.pa-kpi.active { border-color:#0f172a; box-shadow:0 0 0 1px #0f172a inset; }',
      '.pa-kpi.kpi-green { background:#f0fdf4; border-color:#bbf7d0; }',
      '.pa-kpi.kpi-green:hover { background:#dcfce7; border-color:#4ade80; }',
      '.pa-kpi.kpi-green.active { border-color:#15803d; box-shadow:0 0 0 1px #15803d inset; }',
      '.pa-kpi.kpi-amber { background:#fffbeb; border-color:#fde68a; }',
      '.pa-kpi.kpi-amber:hover { background:#fef3c7; border-color:#f59e0b; }',
      '.pa-kpi.kpi-amber.active { border-color:#b45309; box-shadow:0 0 0 1px #b45309 inset; }',
      '.pa-kpi.kpi-rose { background:#fff1f2; border-color:#fecdd3; }',
      '.pa-kpi.kpi-rose:hover { background:#ffe4e6; border-color:#fb7185; }',
      '.pa-kpi.kpi-rose.active { border-color:#be123c; box-shadow:0 0 0 1px #be123c inset; }',
      '.pa-kpi-top { width:100%; display:flex; align-items:center; justify-content:space-between; gap:6px; }',
      '.pa-kpi-label { font-size:11.5px; font-weight:700; color:#475569; text-transform:uppercase; letter-spacing:0.04em; }',
      '.pa-kpi-hint { font-size:10.5px; font-weight:700; color:#64748b; }',
      '.pa-kpi-val { font-size:24px; font-weight:800; color:#0f172a; font-variant-numeric:tabular-nums; line-height:1.15; }',
      '.pa-kpi-sub { font-size:11.5px; color:#64748b; font-variant-numeric:tabular-nums; }',

      /* Button-Type Party Selector Grid */
      '.pa-section { background:#ffffff; border:1px solid #e2e8f0; border-radius:14px; padding:16px 20px; display:flex; flex-direction:column; gap:14px; }',
      '.pa-sec-head { display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap; }',
      '.pa-sec-title { font-size:13px; font-weight:800; text-transform:uppercase; letter-spacing:0.05em; color:#334155; }',
      '.pa-party-grid { display:flex; flex-wrap:wrap; gap:10px; }',
      '.pa-party-btn { min-width:155px; flex:0 1 auto; display:flex; flex-direction:column; align-items:flex-start; gap:6px; padding:12px 15px; border-radius:12px; border:1px solid #cbd5e1; background:#f8fafc; color:#0f172a; cursor:pointer; transition:all .15s; text-align:left; font-family:inherit; }',
      '.pa-party-btn:hover { background:#f1f5f9; border-color:#94a3b8; }',
      '.pa-party-btn.active { background:#0f172a; border-color:#0f172a; color:#ffffff; }',
      '.pa-party-btn-top { width:100%; display:flex; align-items:center; justify-content:space-between; gap:10px; font-size:15px; font-weight:800; }',
      '.pa-party-count { font-size:12px; font-weight:700; font-variant-numeric:tabular-nums; opacity:0.85; }',
      '.pa-party-btn-sub { font-size:11px; opacity:0.75; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:200px; }',
      '.pa-party-prog { width:100%; height:4px; border-radius:4px; background:rgba(148,163,184,0.28); overflow:hidden; }',
      '.pa-party-prog > i { display:block; height:100%; background:#10b981; border-radius:4px; }',

      /* Active Party Info & Checklist Buttons */
      '.pa-party-banner { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:12px; padding:12px 15px; border-radius:10px; background:#f8fafc; border:1px solid #e2e8f0; }',
      '.pa-party-banner-info h2 { margin:0; font-size:16px; font-weight:800; color:#0f172a; }',
      '.pa-party-banner-info p { margin:3px 0 0; font-size:12px; color:#475569; }',
      '.pa-checklist-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:9px; }',
      '.pa-chk-btn { display:flex; align-items:center; justify-content:space-between; gap:10px; padding:10px 13px; border-radius:10px; border:1px solid #cbd5e1; background:#ffffff; color:#0f172a; cursor:pointer; text-align:left; font-family:inherit; transition:all .15s; }',
      '.pa-chk-btn:hover { border-color:#1d4ed8; background:#eff6ff; }',
      '.pa-chk-btn.done { border-color:#a7f3d0; background:#ecfdf5; color:#065f46; }',
      '.pa-chk-btn.done:hover { border-color:#34d399; background:#d1fae5; }',
      '.pa-chk-txt { display:flex; flex-direction:column; gap:2px; min-width:0; }',
      '.pa-chk-title { font-size:12.5px; font-weight:700; line-height:1.3; }',
      '.pa-chk-cat { font-size:11px; opacity:0.75; }',
      '.pa-chk-action { font-size:12px; font-weight:800; flex-shrink:0; }',

      /* Filter Button Rows & Search */
      '.pa-filters { display:flex; flex-direction:column; gap:10px; }',
      '.pa-filter-row { display:flex; flex-wrap:wrap; align-items:center; gap:7px; }',
      '.pa-filter-lbl { font-size:11px; font-weight:700; text-transform:uppercase; color:#64748b; margin-right:4px; min-width:68px; }',
      '.pa-fbtn { height:32px; padding:0 12px; border-radius:8px; border:1px solid #cbd5e1; background:#ffffff; color:#334155; font-size:12px; font-weight:700; cursor:pointer; font-family:inherit; transition:all .12s; white-space:nowrap; }',
      '.pa-fbtn:hover { background:#f1f5f9; border-color:#94a3b8; }',
      '.pa-fbtn.active { background:#1d4ed8; border-color:#1d4ed8; color:#ffffff; }',
      '.pa-search-bar { display:flex; flex-wrap:wrap; gap:10px; align-items:center; }',
      '.pa-input { height:38px; padding:0 12px; border:1px solid #cbd5e1; border-radius:10px; font-size:13px; color:#0f172a; background:#ffffff; font-family:inherit; outline:none; }',
      '.pa-input:focus { border-color:#1d4ed8; }',
      '.pa-search-inp { flex:1; min-width:220px; }',

      /* Documents List */
      '.pa-doc-list { display:flex; flex-direction:column; gap:10px; }',
      '.pa-doc-row { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:12px; padding:14px 16px; border:1px solid #e2e8f0; border-radius:12px; background:#ffffff; transition:border-color .15s; }',
      '.pa-doc-row:hover { border-color:#94a3b8; }',
      '.pa-doc-main { flex:1; min-width:260px; display:flex; flex-direction:column; gap:4px; }',
      '.pa-doc-title-line { display:flex; align-items:center; gap:9px; flex-wrap:wrap; }',
      '.pa-doc-title { font-size:15px; font-weight:800; color:#0f172a; }',
      '.pa-doc-ref { font-size:12px; font-weight:600; color:#475569; font-variant-numeric:tabular-nums; }',
      '.pa-doc-meta { font-size:12.5px; color:#475569; line-height:1.45; }',
      '.pa-doc-remarks { font-size:12px; color:#64748b; font-style:italic; }',
      '.pa-doc-actions { display:flex; flex-wrap:wrap; align-items:center; gap:6px; }',
      '.pa-status-btn { height:32px; padding:0 11px; border-radius:8px; font-size:12px; font-weight:800; cursor:pointer; border:1px solid transparent; font-family:inherit; white-space:nowrap; }',
      '.pa-empty { padding:42px 20px; text-align:center; border:1px dashed #cbd5e1; border-radius:12px; background:#f8fafc; color:#475569; }',
      '.pa-empty h3 { margin:0 0 6px; font-size:16px; color:#0f172a; }',
      '.pa-empty p { margin:0 0 14px; font-size:13px; }',

      /* Modals */
      '.pa-modal-overlay { position:fixed; inset:0; background:rgba(15,23,42,0.58); z-index:99990; display:flex; align-items:center; justify-content:center; padding:18px; }',
      '.pa-modal { background:#ffffff; color:#0f172a; border-radius:14px; border:1px solid #cbd5e1; width:100%; max-width:640px; max-height:92vh; display:flex; flex-direction:column; overflow:hidden; }',
      '.pa-modal-lg { max-width:980px; height:88vh; }',
      '.pa-modal-head { display:flex; align-items:center; justify-content:space-between; padding:15px 20px; border-bottom:1px solid #e2e8f0; }',
      '.pa-modal-head h3 { margin:0; font-size:16px; font-weight:800; }',
      '.pa-modal-body { padding:18px 20px; overflow-y:auto; display:flex; flex-direction:column; gap:13px; flex:1; }',
      '.pa-modal-foot { padding:13px 20px; border-top:1px solid #e2e8f0; display:flex; justify-content:flex-end; gap:8px; background:#f8fafc; }',
      '.pa-form-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; }',
      '.pa-field { display:flex; flex-direction:column; gap:5px; }',
      '.pa-field.full { grid-column:1 / -1; }',
      '.pa-field label { font-size:12px; font-weight:700; color:#334155; }',
      '.pa-textarea { min-height:72px; padding:9px 12px; border:1px solid #cbd5e1; border-radius:10px; font-size:13px; font-family:inherit; resize:vertical; }',
      '.pa-dropzone { border:2px dashed #94a3b8; border-radius:12px; padding:16px; text-align:center; background:#f8fafc; cursor:pointer; }',
      '.pa-dropzone:hover { border-color:#1d4ed8; background:#eff6ff; }',
      '.pa-preview-frame { width:100%; height:100%; min-height:460px; border:1px solid #e2e8f0; border-radius:10px; background:#f1f5f9; }',
      '.pa-toast { position:fixed; bottom:22px; right:22px; background:#0f172a; color:#ffffff; padding:11px 16px; border-radius:10px; font-size:13px; font-weight:600; z-index:99999; opacity:0; pointer-events:none; transition:opacity .2s; }',
      '.pa-toast.show { opacity:1; }',
      '@media (max-width:1180px) { .pa-kpis { grid-template-columns:repeat(3,minmax(0,1fr)); } }', '@media (max-width:1024px) { .pa-checklist-grid { grid-template-columns:repeat(2,minmax(0,1fr)); } }', '@media (max-width:900px) { .pa-kpis { grid-template-columns:repeat(2,minmax(0,1fr)); } .pa-checklist-grid { grid-template-columns:1fr; } .pa-form-grid { grid-template-columns:1fr; } .pa-wrap { padding:14px; } }'
    ].join('\n');
    var styleEl = doc.createElement('style');
    styleEl.id = 'atplPartyAuditStyles';
    styleEl.textContent = css;
    (doc.head || doc.documentElement).appendChild(styleEl);
  }

  // ── Render Logic ──
  function getFilteredDocs() {
    var q = state.searchQuery.trim().toLowerCase();
    var selParty = state.selectedPartyId;
    var stFilter = state.statusFilter;
    var catFilter = state.categoryFilter;

    var list = state.docs.filter(function (d) {
      if (!d) return false;
      if (selParty !== 'ALL' && String(d.partyId || '').toLowerCase() !== selParty.toLowerCase()) return false;
      if (stFilter !== 'ALL' && d.status !== stFilter) return false;
      if (catFilter !== 'ALL' && d.category !== catFilter) return false;
      if (state.expiringOnly) {
        if (!d.expiryDate) return false;
        var expMs = dateMs(d.expiryDate);
        if (!expMs || expMs > (Date.now() + 30 * 86400000)) return false;
      }
      if (q) {
        var hay = [d.title, d.partyName, d.partyId, d.category, d.refNo, d.file_name, d.remarks, d.uploadedBy, d.auditPeriod]
          .join(' ').toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });

    list.sort(function (a, b) {
      if (state.sortBy === 'title') return String(a.title || '').localeCompare(String(b.title || ''));
      if (state.sortBy === 'expiry') {
        var ea = a.expiryDate ? dateMs(a.expiryDate) : 9e15;
        var eb = b.expiryDate ? dateMs(b.expiryDate) : 9e15;
        return ea - eb;
      }
      return dateMs(b.updated_at || b.created_at) - dateMs(a.updated_at || a.created_at);
    });
    return list;
  }

  function renderHeaderSyncStatus() {
    var doc = root.document;
    if (!doc) return;
    var el = doc.getElementById('paSyncStatusLine');
    if (el) {
      el.textContent = state.syncing
        ? 'Syncing with Google Drive…'
        : (state.syncText + (state.lastSyncAt ? ' · Last: ' + formatDateTime(state.lastSyncAt) : ''));
    }
    var btn = doc.getElementById('paSyncBtn');
    if (btn) {
      btn.disabled = !!state.syncing;
      btn.textContent = state.syncing ? 'Syncing Drive…' : 'Sync Google Drive';
    }
  }

  function partyStats(partyId) {
    var docs = state.docs.filter(function (d) {
      return d && (partyId === 'ALL' || String(d.partyId || '').toLowerCase() === String(partyId).toLowerCase());
    });
    var ready = docs.filter(function (d) { return d.status === 'ready'; }).length;
    var review = docs.filter(function (d) { return d.status === 'review'; }).length;
    var pending = docs.filter(function (d) { return d.status === 'pending'; }).length;
    var cutoff = Date.now() + 30 * 86400000;
    var expiring = docs.filter(function (d) {
      if (!d.expiryDate) return false;
      var ms = dateMs(d.expiryDate);
      return ms > 0 && ms <= cutoff;
    }).length;
    return { total: docs.length, ready: ready, review: review, pending: pending, expiring: expiring };
  }

  function isChecklistItemDone(party, itemTitle) {
    var target = String(itemTitle || '').trim().toLowerCase();
    return state.docs.some(function (d) {
      if (!d || String(d.partyId || '').toLowerCase() !== party.id.toLowerCase()) return false;
      var t = String(d.title || '').trim().toLowerCase();
      return t === target || t.indexOf(target) >= 0 || target.indexOf(t) >= 0;
    });
  }

  function renderUI() {
    var doc = root.document;
    if (!doc) return;
    ensureStyles();
    updateSidebarBadge();

    var container = doc.getElementById('partyAuditContainer');
    if (!container) return;

    var activeParty = state.selectedPartyId === 'ALL'
      ? null
      : state.parties.find(function (p) { return p && p.id.toLowerCase() === state.selectedPartyId.toLowerCase(); }) || null;
    if (state.selectedPartyId !== 'ALL' && !activeParty) {
      state.selectedPartyId = 'ALL';
    }

    var scopedStats = partyStats(state.selectedPartyId);
    var readyPct = scopedStats.total ? Math.round((scopedStats.ready / scopedStats.total) * 100) : 0;
    var filteredDocs = getFilteredDocs();
    var canUpload = canDo('upload');
    var canEdit = canDo('edit');
    var canDelete = canDo('delete');

    var html = [];
    html.push('<div class="pa-wrap">');

    // Header
    html.push('<div class="pa-header">');
    html.push('  <div class="pa-title-block">');
    html.push('    <h1>🛡️ Audit — Party Audit-Ready Documents</h1>');
    html.push('    <p>Organize buyer &amp; compliance audit documents by Party Name (RWS, MWS, Inditex &amp; custom audits) with Google Drive sync.</p>');
    html.push('  </div>');
    html.push('  <div class="pa-header-actions">');
    html.push('    <span class="pa-sync-meta" id="paSyncStatusLine">' + esc(state.syncing ? 'Syncing with Google Drive…' : (state.syncText + (state.lastSyncAt ? ' · Last: ' + formatDateTime(state.lastSyncAt) : ''))) + '</span>');
    html.push('    <button type="button" class="pa-btn" id="paSyncBtn" data-pa-act="sync">' + (state.syncing ? 'Syncing Drive…' : 'Sync Google Drive') + '</button>');
    html.push('    <button type="button" class="pa-btn" id="paExportBtn" data-pa-act="export">Export Register</button>');
    if (canUpload) {
      html.push('    <button type="button" class="pa-btn" id="paAddPartyBtn" data-pa-act="add-party">+ Add Party Audit</button>');
      html.push('    <button type="button" class="pa-btn pa-btn-accent" id="paUploadDocBtn" data-pa-act="open-upload">+ Upload Audit Doc</button>');
    }
    html.push('  </div>');
    html.push('</div>');

    // Interactive Button-Type KPI Cards
    var chkTotal = (activeParty && Array.isArray(activeParty.checklist)) ? activeParty.checklist.length : 0;
    var chkDone = (activeParty && chkTotal) ? activeParty.checklist.filter(function (c) { return isChecklistItemDone(activeParty, c.title); }).length : 0;
    var chkPct = chkTotal ? Math.round((chkDone / chkTotal) * 100) : 0;
    html.push('<div class="pa-kpis">');
    if (activeParty) {
      html.push('  <button type="button" class="pa-kpi" data-pa-act="toggle-checklist">');
      html.push('    <div class="pa-kpi-top"><span class="pa-kpi-label">' + esc(activeParty.name) + ' Checklist</span><span class="pa-kpi-hint">' + chkPct + '%</span></div>');
      html.push('    <span class="pa-kpi-val">' + chkDone + ' / ' + chkTotal + '</span>');
      html.push('    <span class="pa-kpi-sub">Checklist items ready · Click to toggle</span>');
      html.push('  </button>');
    } else {
      html.push('  <button type="button" class="pa-kpi" data-pa-act="add-party">');
      html.push('    <div class="pa-kpi-top"><span class="pa-kpi-label">Active Parties</span><span class="pa-kpi-hint">+ Add</span></div>');
      html.push('    <span class="pa-kpi-val">' + state.parties.length + '</span>');
      html.push('    <span class="pa-kpi-sub">RWS, MWS, Inditex &amp; custom audits</span>');
      html.push('  </button>');
    }
    html.push('  <button type="button" class="pa-kpi ' + (state.statusFilter === 'ALL' && !state.expiringOnly ? 'active' : '') + '" data-pa-act="filter-status" data-val="ALL">');
    html.push('    <div class="pa-kpi-top"><span class="pa-kpi-label">' + (activeParty ? esc(activeParty.name) + ' Docs' : 'Total Audit Docs') + '</span><span class="pa-kpi-hint">Show All</span></div>');
    html.push('    <span class="pa-kpi-val">' + scopedStats.total + '</span>');
    html.push('    <span class="pa-kpi-sub">' + filteredDocs.length + ' shown in register</span>');
    html.push('  </button>');
    html.push('  <button type="button" class="pa-kpi kpi-green ' + (state.statusFilter === 'ready' && !state.expiringOnly ? 'active' : '') + '" data-pa-act="filter-status" data-val="ready">');
    html.push('    <div class="pa-kpi-top"><span class="pa-kpi-label" style="color:#065f46">Audit Ready</span><span class="pa-kpi-hint" style="color:#047857">' + readyPct + '%</span></div>');
    html.push('    <span class="pa-kpi-val" style="color:#047857">' + scopedStats.ready + '</span>');
    html.push('    <span class="pa-kpi-sub" style="color:#065f46">Click to filter ready docs</span>');
    html.push('  </button>');
    html.push('  <button type="button" class="pa-kpi kpi-amber ' + (state.statusFilter === 'pending' && !state.expiringOnly ? 'active' : '') + '" data-pa-act="filter-status" data-val="pending">');
    html.push('    <div class="pa-kpi-top"><span class="pa-kpi-label" style="color:#92400e">Needs Update</span><span class="pa-kpi-hint" style="color:#b45309">Filter</span></div>');
    html.push('    <span class="pa-kpi-val" style="color:#b45309">' + (scopedStats.pending + scopedStats.review) + '</span>');
    html.push('    <span class="pa-kpi-sub" style="color:#92400e">' + scopedStats.pending + ' needs update · ' + scopedStats.review + ' in review</span>');
    html.push('  </button>');
    html.push('  <button type="button" class="pa-kpi kpi-rose ' + (state.expiringOnly ? 'active' : '') + '" data-pa-act="filter-expiring">');
    html.push('    <div class="pa-kpi-top"><span class="pa-kpi-label" style="color:#9f1239">Expiring (≤30d)</span><span class="pa-kpi-hint" style="color:#be123c">' + (state.expiringOnly ? 'Active' : 'Check') + '</span></div>');
    html.push('    <span class="pa-kpi-val" style="color:#be123c">' + scopedStats.expiring + '</span>');
    html.push('    <span class="pa-kpi-sub" style="color:#9f1239">Expired or due within 30 days</span>');
    html.push('  </button>');
    html.push('</div>');

    // Button-Type Party Selector Section
    html.push('<div class="pa-section">');
    html.push('  <div class="pa-sec-head">');
    html.push('    <span class="pa-sec-title">Select Party Audit</span>');
    html.push('    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">');
    if (activeParty) {
      html.push('      <button type="button" class="pa-btn pa-btn-sm" data-pa-act="toggle-checklist">' + (state.showChecklist ? 'Hide Checklist' : 'Show Checklist') + '</button>');
      if (canEdit) html.push('      <button type="button" class="pa-btn pa-btn-sm" data-pa-act="edit-party" data-party-id="' + esc(activeParty.id) + '">Edit Party</button>');
      if (canDelete) html.push('      <button type="button" class="pa-btn pa-btn-sm pa-btn-danger" data-pa-act="delete-party" data-party-id="' + esc(activeParty.id) + '">Delete Party</button>');
    }
    html.push('    </div>');
    html.push('  </div>');

    html.push('  <div class="pa-party-grid">');
    var allSt = partyStats('ALL');
    var allPct = allSt.total ? Math.round((allSt.ready / allSt.total) * 100) : 0;
    html.push('    <button type="button" class="pa-party-btn ' + (state.selectedPartyId === 'ALL' ? 'active' : '') + '" data-pa-act="select-party" data-party-id="ALL">');
    html.push('      <div class="pa-party-btn-top"><span>All Parties</span><span class="pa-party-count">' + allSt.ready + '/' + allSt.total + '</span></div>');
    html.push('      <span class="pa-party-btn-sub">Combined Audit Repository</span>');
    html.push('      <div class="pa-party-prog"><i style="width:' + allPct + '%"></i></div>');
    html.push('    </button>');

    state.parties.forEach(function (p) {
      var st = partyStats(p.id);
      var pct = st.total ? Math.round((st.ready / st.total) * 100) : 0;
      var isAct = state.selectedPartyId.toLowerCase() === p.id.toLowerCase();
      html.push('    <button type="button" class="pa-party-btn ' + (isAct ? 'active' : '') + '" data-pa-act="select-party" data-party-id="' + esc(p.id) + '">');
      html.push('      <div class="pa-party-btn-top"><span>' + esc(p.name) + '</span><span class="pa-party-count">' + st.ready + '/' + st.total + '</span></div>');
      html.push('      <span class="pa-party-btn-sub">' + esc(p.fullName || p.name) + '</span>');
      html.push('      <div class="pa-party-prog"><i style="width:' + pct + '%"></i></div>');
      html.push('    </button>');
    });
    if (canUpload) {
      html.push('    <button type="button" class="pa-party-btn" style="border-style:dashed;justify-content:center;align-items:center;min-width:140px" data-pa-act="add-party">');
      html.push('      <span style="font-size:13px;font-weight:800">+ New Party</span>');
      html.push('      <span class="pa-party-btn-sub">H&amp;M, SEDEX, BSCI...</span>');
      html.push('    </button>');
    }
    html.push('  </div>');

    if (activeParty) {
      html.push('  <div class="pa-party-banner">');
      html.push('    <div class="pa-party-banner-info">');
      html.push('      <h2>' + esc(activeParty.fullName || activeParty.name) + '</h2>');
      html.push('      <p>' + esc(activeParty.scope || 'Party audit compliance repository') +
        (activeParty.auditDate ? ' · Target Audit Date: ' + esc(formatShortDate(activeParty.auditDate)) : '') +
        (activeParty.auditor ? ' · Auditor: ' + esc(activeParty.auditor) : '') + '</p>');
      html.push('    </div>');
      if (canUpload) {
        html.push('    <button type="button" class="pa-btn pa-btn-primary pa-btn-sm" data-pa-act="open-upload" data-party-id="' + esc(activeParty.id) + '">+ Upload for ' + esc(activeParty.name) + '</button>');
      }
      html.push('  </div>');

      if (state.showChecklist && Array.isArray(activeParty.checklist) && activeParty.checklist.length) {
        html.push('  <div>');
        html.push('    <div class="pa-sec-title" style="margin-bottom:8px;font-size:11.5px">' + esc(activeParty.name) + ' Audit Readiness Checklist (Click any item to upload)</div>');
        html.push('    <div class="pa-checklist-grid">');
        activeParty.checklist.forEach(function (chk) {
          var done = isChecklistItemDone(activeParty, chk.title);
          html.push('      <button type="button" class="pa-chk-btn ' + (done ? 'done' : '') + '" data-pa-act="checklist-upload" data-party-id="' + esc(activeParty.id) + '" data-doc-title="' + esc(chk.title) + '" data-doc-cat="' + esc(chk.category) + '">');
          html.push('        <div class="pa-chk-txt"><span class="pa-chk-title">' + esc(chk.title) + '</span><span class="pa-chk-cat">' + esc(chk.category) + '</span></div>');
          html.push('        <span class="pa-chk-action">' + (done ? '✓ Ready' : '+ Upload') + '</span>');
          html.push('      </button>');
        });
        html.push('    </div>');
        html.push('  </div>');
      }
    }
    html.push('</div>');

    // Filter Buttons + Search + Document List
    html.push('<div class="pa-section">');
    html.push('  <div class="pa-filters">');
    html.push('    <div class="pa-filter-row">');
    html.push('      <span class="pa-filter-lbl">Status</span>');
    [
      { id: 'ALL', label: 'All' },
      { id: 'ready', label: 'Audit Ready' },
      { id: 'review', label: 'In Review' },
      { id: 'pending', label: 'Needs Update' }
    ].forEach(function (opt) {
      html.push('      <button type="button" class="pa-fbtn ' + (state.statusFilter === opt.id ? 'active' : '') + '" data-pa-act="filter-status" data-val="' + opt.id + '">' + opt.label + '</button>');
    });
    html.push('    </div>');

    html.push('    <div class="pa-filter-row">');
    html.push('      <span class="pa-filter-lbl">Category</span>');
    html.push('      <button type="button" class="pa-fbtn ' + (state.categoryFilter === 'ALL' ? 'active' : '') + '" data-pa-act="filter-cat" data-val="ALL">All Categories</button>');
    CATEGORIES.forEach(function (cat) {
      html.push('      <button type="button" class="pa-fbtn ' + (state.categoryFilter === cat ? 'active' : '') + '" data-pa-act="filter-cat" data-val="' + esc(cat) + '">' + esc(cat) + '</button>');
    });
    html.push('    </div>');

    html.push('    <div class="pa-search-bar">');
    html.push('      <input type="search" class="pa-input pa-search-inp" id="paSearchInput" placeholder="Search document title, certificate ref no, file name, or remarks…" value="' + esc(state.searchQuery) + '" />');
    html.push('      <select class="pa-input" id="paSortSelect" aria-label="Sort audit documents">');
    html.push('        <option value="newest"' + (state.sortBy === 'newest' ? ' selected' : '') + '>Sort: Latest Updated</option>');
    html.push('        <option value="title"' + (state.sortBy === 'title' ? ' selected' : '') + '>Sort: Title (A–Z)</option>');
    html.push('        <option value="expiry"' + (state.sortBy === 'expiry' ? ' selected' : '') + '>Sort: Expiry / Validity</option>');
    html.push('      </select>');
    html.push('    </div>');
    html.push('  </div>');

    if (!filteredDocs.length) {
      html.push('  <div class="pa-empty">');
      html.push('    <h3>No audit documents match this view</h3>');
      html.push('    <p>' + (activeParty ? ('Upload audit-ready documents for ' + esc(activeParty.name) + ' or click any checklist button above.') : 'Select a party audit (RWS, MWS, Inditex) or upload your first audit-ready document.') + '</p>');
      if (canUpload) {
        html.push('    <button type="button" class="pa-btn pa-btn-accent" data-pa-act="open-upload">+ Upload Audit Document</button>');
      }
      html.push('  </div>');
    } else {
      html.push('  <div class="pa-doc-list">');
      filteredDocs.forEach(function (d) {
        var st = STATUS_META[d.status] || STATUS_META.ready;
        var attLabel = d.file_name
          ? (esc(d.file_name) + (d.file_size ? ' (' + formatBytes(d.file_size) + ')' : '') + (d.attachment_count > 1 ? ' +' + (d.attachment_count - 1) + ' more' : ''))
          : 'Metadata only (no file)';
        var metaParts = [
          esc(d.partyName || d.partyId),
          esc(d.category),
          attLabel,
          d.auditPeriod ? ('Period: ' + esc(d.auditPeriod)) : '',
          d.expiryDate ? ('Valid till: ' + esc(formatShortDate(d.expiryDate))) : '',
          'Updated: ' + esc(formatDateTime(d.updated_at || d.created_at)),
          d.uploadedBy ? ('By ' + esc(d.uploadedBy)) : ''
        ].filter(Boolean);

        html.push('    <div class="pa-doc-row" data-doc-id="' + esc(d.id) + '">');
        html.push('      <div class="pa-doc-main">');
        html.push('        <div class="pa-doc-title-line">');
        html.push('          <span class="pa-doc-title">' + esc(d.title) + '</span>');
        if (d.refNo) html.push('          <span class="pa-doc-ref">Ref: ' + esc(d.refNo) + '</span>');
        html.push('        </div>');
        html.push('        <div class="pa-doc-meta">' + metaParts.join(' · ') + '</div>');
        if (d.remarks) html.push('        <div class="pa-doc-remarks">' + esc(d.remarks) + '</div>');
        html.push('      </div>');
        html.push('      <div class="pa-doc-actions">');
        html.push('        <button type="button" class="pa-status-btn" style="background:' + st.bg + ';color:' + st.fg + ';border-color:' + st.border + '" title="Click to toggle status" data-pa-act="cycle-status" data-doc-id="' + esc(d.id) + '">' + esc(st.label) + '</button>');
        if (d.has_attachment) {
          html.push('        <button type="button" class="pa-btn pa-btn-sm" data-pa-act="preview-doc" data-doc-id="' + esc(d.id) + '">Preview</button>');
          html.push('        <button type="button" class="pa-btn pa-btn-sm" data-pa-act="download-doc" data-doc-id="' + esc(d.id) + '">Download</button>');
          html.push('        <button type="button" class="pa-btn pa-btn-sm" data-pa-act="print-doc" data-doc-id="' + esc(d.id) + '">Print</button>');
        }
        if (canEdit) {
          html.push('        <button type="button" class="pa-btn pa-btn-sm" data-pa-act="edit-doc" data-doc-id="' + esc(d.id) + '">Edit</button>');
        }
        if (canDelete) {
          html.push('        <button type="button" class="pa-btn pa-btn-sm pa-btn-danger" data-pa-act="delete-doc" data-doc-id="' + esc(d.id) + '">Delete</button>');
        }
        html.push('      </div>');
        html.push('    </div>');
      });
      html.push('  </div>');
    }

    html.push('</div>'); // /section
    html.push('</div>'); // /pa-wrap

    container.innerHTML = html.join('\n');
    bindContainerInputs();
  }

  function bindContainerInputs() {
    var doc = root.document;
    if (!doc) return;
    var sInp = doc.getElementById('paSearchInput');
    if (sInp) {
      sInp.oninput = function () {
        state.searchQuery = sInp.value || '';
        renderUI();
        var next = doc.getElementById('paSearchInput');
        if (next) {
          next.focus();
          try { next.setSelectionRange(next.value.length, next.value.length); } catch (_) {}
        }
      };
    }
    var sortSel = doc.getElementById('paSortSelect');
    if (sortSel) {
      sortSel.onchange = function () {
        state.sortBy = sortSel.value || 'newest';
        renderUI();
      };
    }
  }

  // ── Modals (Upload/Edit Doc, Add/Edit Party, Preview, Confirm Delete) ──
  function closeModal() {
    var doc = root.document;
    if (!doc) return;
    var existing = doc.getElementById('paModalOverlay');
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
  }

  function openConfirmModal(title, message, confirmLabel, onConfirm) {
    closeModal();
    var doc = root.document;
    if (!doc || !doc.body) return;
    var ov = doc.createElement('div');
    ov.id = 'paModalOverlay';
    ov.className = 'pa-modal-overlay';
    ov.innerHTML = [
      '<div class="pa-modal" style="max-width:440px">',
      '  <div class="pa-modal-head"><h3>' + esc(title) + '</h3><button type="button" class="pa-btn pa-btn-sm" id="paMClose">Close</button></div>',
      '  <div class="pa-modal-body"><p style="margin:0;font-size:13.5px;line-height:1.5;color:#334155">' + esc(message) + '</p></div>',
      '  <div class="pa-modal-foot">',
      '    <button type="button" class="pa-btn" id="paMCancel">Cancel</button>',
      '    <button type="button" class="pa-btn pa-btn-danger" id="paMOk" style="background:#dc2626;color:#fff;border-color:#dc2626">' + esc(confirmLabel || 'Delete') + '</button>',
      '  </div>',
      '</div>'
    ].join('');
    doc.body.appendChild(ov);
    ov.querySelector('#paMClose').onclick = closeModal;
    ov.querySelector('#paMCancel').onclick = closeModal;
    ov.querySelector('#paMOk').onclick = async function () {
      ov.querySelector('#paMOk').disabled = true;
      closeModal();
      await onConfirm();
    };
  }

  function openPartyModal(existingParty) {
    closeModal();
    var doc = root.document;
    if (!doc || !doc.body) return;
    var isEdit = Boolean(existingParty);
    var chkLines = (existingParty && Array.isArray(existingParty.checklist))
      ? existingParty.checklist.map(function (c) { return c.title; }).join(', ')
      : 'Scope Certificate, Payroll & Wage Register, PF & ESIC Challans, Health & Safety Records';

    var ov = doc.createElement('div');
    ov.id = 'paModalOverlay';
    ov.className = 'pa-modal-overlay';
    ov.innerHTML = [
      '<div class="pa-modal">',
      '  <div class="pa-modal-head"><h3>' + (isEdit ? 'Edit Party Audit' : 'Add New Party Audit') + '</h3><button type="button" class="pa-btn pa-btn-sm" id="paMClose">Close</button></div>',
      '  <div class="pa-modal-body">',
      '    <div class="pa-form-grid">',
      '      <div class="pa-field"><label>Party Audit Name (Button Label) *</label><input class="pa-input" id="paPName" placeholder="e.g. RWS, MWS, Inditex, H&M, SEDEX" value="' + esc(existingParty ? existingParty.name : '') + '" ' + (isEdit ? 'readonly style="background:#f1f5f9"' : '') + ' /></div>',
      '      <div class="pa-field"><label>Full Audit Standard / Title</label><input class="pa-input" id="paPFull" placeholder="e.g. Inditex Social & Technical Audit" value="' + esc(existingParty ? existingParty.fullName : '') + '" /></div>',
      '      <div class="pa-field"><label>Target Audit Date</label><input type="date" class="pa-input" id="paPDate" value="' + esc(existingParty ? existingParty.auditDate : '') + '" /></div>',
      '      <div class="pa-field"><label>Auditor / Agency</label><input class="pa-input" id="paPAuditor" placeholder="e.g. Control Union / Intertek / SGS" value="' + esc(existingParty ? existingParty.auditor : '') + '" /></div>',
      '      <div class="pa-field full"><label>Audit Scope / Notes</label><input class="pa-input" id="paPScope" placeholder="e.g. Social compliance, wages, safety & chemical records" value="' + esc(existingParty ? existingParty.scope : '') + '" /></div>',
      '      <div class="pa-field full"><label>Quick Checklist Items (comma-separated)</label><textarea class="pa-textarea" id="paPChk">' + esc(chkLines) + '</textarea></div>',
      '    </div>',
      '  </div>',
      '  <div class="pa-modal-foot">',
      '    <button type="button" class="pa-btn" id="paMCancel">Cancel</button>',
      '    <button type="button" class="pa-btn pa-btn-accent" id="paPSave">' + (isEdit ? 'Save Party Changes' : 'Create Party Audit') + '</button>',
      '  </div>',
      '</div>'
    ].join('');
    doc.body.appendChild(ov);
    ov.querySelector('#paMClose').onclick = closeModal;
    ov.querySelector('#paMCancel').onclick = closeModal;
    ov.querySelector('#paPSave').onclick = async function () {
      var name = String(ov.querySelector('#paPName').value || '').trim();
      if (!name) {
        notify('Please enter Party Audit Name');
        return;
      }
      var chkRaw = String(ov.querySelector('#paPChk').value || '');
      var checklist = chkRaw.split(',').map(function (s) { return s.trim(); }).filter(Boolean).map(function (t) {
        var existingItem = existingParty && Array.isArray(existingParty.checklist)
          ? existingParty.checklist.find(function (c) { return c.title.toLowerCase() === t.toLowerCase(); })
          : null;
        return { title: t, category: (existingItem && existingItem.category) || 'Buyer Policy & COC' };
      });
      var btn = ov.querySelector('#paPSave');
      btn.disabled = true;
      btn.textContent = 'Saving…';
      await savePartyAndSync({
        id: existingParty ? existingParty.id : normalizePartyId(name),
        name: name,
        fullName: String(ov.querySelector('#paPFull').value || '').trim() || name,
        auditDate: String(ov.querySelector('#paPDate').value || '').trim(),
        auditor: String(ov.querySelector('#paPAuditor').value || '').trim(),
        scope: String(ov.querySelector('#paPScope').value || '').trim(),
        checklist: checklist
      });
      closeModal();
      notify('Party Audit saved & synced to Google Drive: ' + name);
    };
  }

  function openUploadModal(opts) {
    closeModal();
    var doc = root.document;
    if (!doc || !doc.body) return;
    opts = opts || {};
    var existingDoc = opts.doc || null;
    var defaultPartyId = existingDoc ? existingDoc.partyId : (opts.partyId || (state.selectedPartyId !== 'ALL' ? state.selectedPartyId : (state.parties[0] && state.parties[0].id) || 'RWS'));
    var selectedFiles = [];

    var ov = doc.createElement('div');
    ov.id = 'paModalOverlay';
    ov.className = 'pa-modal-overlay';

    var partyOptions = state.parties.map(function (p) {
      var sel = p.id.toLowerCase() === String(defaultPartyId).toLowerCase() ? ' selected' : '';
      return '<option value="' + esc(p.id) + '"' + sel + '>' + esc(p.name) + ' — ' + esc(p.fullName) + '</option>';
    }).join('');

    var catOptions = CATEGORIES.map(function (c) {
      var targetCat = existingDoc ? existingDoc.category : (opts.category || CATEGORIES[0]);
      var sel = c === targetCat ? ' selected' : '';
      return '<option value="' + esc(c) + '"' + sel + '>' + esc(c) + '</option>';
    }).join('');

    var curStatus = existingDoc ? existingDoc.status : 'ready';

    ov.innerHTML = [
      '<div class="pa-modal">',
      '  <div class="pa-modal-head"><h3>' + (existingDoc ? 'Edit Audit Document' : 'Upload Audit-Ready Document') + '</h3><button type="button" class="pa-btn pa-btn-sm" id="paMClose">Close</button></div>',
      '  <div class="pa-modal-body">',
      '    <div class="pa-form-grid">',
      '      <div class="pa-field"><label>Party Audit *</label><select class="pa-input" id="paDParty">' + partyOptions + '</select></div>',
      '      <div class="pa-field"><label>Document Category</label><select class="pa-input" id="paDCat">' + catOptions + '</select></div>',
      '      <div class="pa-field full"><label>Document Title *</label><input class="pa-input" id="paDTitle" placeholder="e.g. RWS Scope Certificate 2026 / Inditex Salary Register" value="' + esc(existingDoc ? existingDoc.title : (opts.title || '')) + '" /></div>',
      '      <div class="pa-field"><label>Certificate / Reference No.</label><input class="pa-input" id="paDRef" placeholder="e.g. CU-891234 / TC-2026-04" value="' + esc(existingDoc ? existingDoc.refNo : '') + '" /></div>',
      '      <div class="pa-field"><label>Audit Period / Month</label><input class="pa-input" id="paDPeriod" placeholder="e.g. FY 2026-27 / Nov 2026" value="' + esc(existingDoc ? existingDoc.auditPeriod : '') + '" /></div>',
      '      <div class="pa-field"><label>Valid Till / Expiry Date</label><input type="date" class="pa-input" id="paDExp" value="' + esc(existingDoc ? existingDoc.expiryDate : '') + '" /></div>',
      '      <div class="pa-field"><label>Readiness Status</label><select class="pa-input" id="paDStatus">',
      '        <option value="ready"' + (curStatus === 'ready' ? ' selected' : '') + '>Audit Ready</option>',
      '        <option value="review"' + (curStatus === 'review' ? ' selected' : '') + '>In Review</option>',
      '        <option value="pending"' + (curStatus === 'pending' ? ' selected' : '') + '>Needs Update</option>',
      '      </select></div>',
      '      <div class="pa-field full"><label>Attach Audit File(s) (PDF, Image, Excel, Word)</label>',
      '        <label class="pa-dropzone" for="paDFile">',
      '          <div style="font-size:13px;font-weight:700;color:#0f172a" id="paDFileLbl">' + (existingDoc && existingDoc.file_name ? ('Current: ' + esc(existingDoc.file_name) + ' — click to replace') : 'Click to choose PDF, JPG, PNG, XLSX, DOCX or CSV') + '</div>',
      '          <div style="font-size:11.5px;color:#64748b;margin-top:3px">Files sync securely to Google Drive &amp; IndexedDB cache</div>',
      '          <input type="file" id="paDFile" multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.xlsx,.xls,.csv,.doc,.docx,.txt" style="display:none" />',
      '        </label>',
      '      </div>',
      '      <div class="pa-field full"><label>Audit Remarks / Auditor Notes</label><textarea class="pa-textarea" id="paDRemarks" placeholder="Optional inspection notes, annexure details, corrective action…">' + esc(existingDoc ? existingDoc.remarks : '') + '</textarea></div>',
      '    </div>',
      '  </div>',
      '  <div class="pa-modal-foot">',
      '    <button type="button" class="pa-btn" id="paMCancel">Cancel</button>',
      '    <button type="button" class="pa-btn pa-btn-accent" id="paDSave">' + (existingDoc ? 'Save & Sync to Drive' : 'Upload & Sync to Drive') + '</button>',
      '  </div>',
      '</div>'
    ].join('');

    doc.body.appendChild(ov);
    ov.querySelector('#paMClose').onclick = closeModal;
    ov.querySelector('#paMCancel').onclick = closeModal;

    var fileInp = ov.querySelector('#paDFile');
    var fileLbl = ov.querySelector('#paDFileLbl');
    fileInp.onchange = function () {
      selectedFiles = Array.prototype.slice.call(fileInp.files || []);
      if (selectedFiles.length) {
        var totalSize = selectedFiles.reduce(function (sum, f) { return sum + (f.size || 0); }, 0);
        fileLbl.textContent = selectedFiles.length === 1
          ? ('Selected: ' + selectedFiles[0].name + ' (' + formatBytes(totalSize) + ')')
          : ('Selected ' + selectedFiles.length + ' files (' + formatBytes(totalSize) + ')');
        var titleInp = ov.querySelector('#paDTitle');
        if (titleInp && !titleInp.value.trim()) {
          titleInp.value = selectedFiles[0].name.replace(/\.[^.]+$/, '');
        }
      }
    };

    ov.querySelector('#paDSave').onclick = async function () {
      var partyId = ov.querySelector('#paDParty').value;
      var partyObj = state.parties.find(function (p) { return p.id === partyId; });
      var title = String(ov.querySelector('#paDTitle').value || '').trim();
      if (!title) {
        notify('Please enter a Document Title');
        return;
      }
      var saveBtn = ov.querySelector('#paDSave');
      saveBtn.disabled = true;
      saveBtn.textContent = 'Uploading & Syncing…';

      try {
        var encodedFiles = [];
        for (var i = 0; i < selectedFiles.length; i++) {
          var f = selectedFiles[i];
          var dataUrl = await fileToDataUrl(f);
          encodedFiles.push({
            name: f.name,
            type: f.type || 'application/octet-stream',
            size: Number(f.size) || 0,
            data: dataUrl
          });
        }

        var id = existingDoc ? existingDoc.id : ('PA_' + normalizePartyId(partyId) + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6));
        var docRecord = Object.assign({}, existingDoc || {}, {
          id: id,
          partyId: partyId,
          partyName: partyObj ? partyObj.name : partyId,
          title: title,
          category: ov.querySelector('#paDCat').value || 'Statutory & Payroll',
          refNo: String(ov.querySelector('#paDRef').value || '').trim(),
          auditPeriod: String(ov.querySelector('#paDPeriod').value || '').trim(),
          expiryDate: String(ov.querySelector('#paDExp').value || '').trim(),
          status: ov.querySelector('#paDStatus').value || 'ready',
          remarks: String(ov.querySelector('#paDRemarks').value || '').trim(),
          uploadedBy: currentUserLabel(),
          created_at: existingDoc ? existingDoc.created_at : new Date().toISOString()
        });

        var hasNewAtt = encodedFiles.length > 0;
        if (hasNewAtt) {
          docRecord.file_name = encodedFiles[0].name;
          docRecord.file_type = encodedFiles[0].type;
          docRecord.file_size = encodedFiles.reduce(function (s, x) { return s + (x.size || 0); }, 0);
          docRecord.file_data = encodedFiles[0].data;
          docRecord.files = encodedFiles;
          docRecord.has_attachment = true;
          docRecord.attachment_count = encodedFiles.length;
          docRecord.drive_attachment_file = docAttFileName(id);
        }

        closeModal();
        await saveDocAndSync(docRecord, hasNewAtt);
        notify('Saved & synced "' + docRecord.title + '" to Google Drive');
      } catch (err) {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Upload & Sync to Drive';
        notify('Upload failed: ' + ((err && err.message) || err));
      }
    };
  }

  async function openPreviewModal(docId) {
    var docMeta = state.docs.find(function (d) { return d && d.id === docId; });
    if (!docMeta) return;
    notify('Loading preview from cache / Google Drive…');
    var att = await hydrateAttachment(docMeta);
    if (!att || !hasInlineBytes(att)) {
      notify('Attachment not available yet — try Sync Google Drive');
      return;
    }

    var fileList = (Array.isArray(att.files) && att.files.length)
      ? att.files
      : [{ name: att.file_name || docMeta.title, type: att.file_type || '', size: att.file_size || 0, data: att.file_data }];

    closeModal();
    var doc = root.document;
    var ov = doc.createElement('div');
    ov.id = 'paModalOverlay';
    ov.className = 'pa-modal-overlay';

    var switcher = fileList.length > 1
      ? ('<div style="display:flex;gap:6px;flex-wrap:wrap">' + fileList.map(function (f, i) {
          return '<button type="button" class="pa-fbtn ' + (i === 0 ? 'active' : '') + '" data-att-idx="' + i + '">' + esc(f.name || ('File ' + (i + 1))) + '</button>';
        }).join('') + '</div>')
      : '';

    ov.innerHTML = [
      '<div class="pa-modal pa-modal-lg">',
      '  <div class="pa-modal-head">',
      '    <div><h3>' + esc(docMeta.title) + '</h3><div style="font-size:12px;color:#64748b;margin-top:2px">' + esc(docMeta.partyName) + ' · ' + esc(docMeta.category) + '</div></div>',
      '    <div style="display:flex;gap:8px;align-items:center">',
      '      <button type="button" class="pa-btn pa-btn-sm" id="paPPrevDl">Download</button>',
      '      <button type="button" class="pa-btn pa-btn-sm" id="paPPrevPr">Print</button>',
      '      <button type="button" class="pa-btn pa-btn-sm" id="paMClose">Close</button>',
      '    </div>',
      '  </div>',
      '  <div class="pa-modal-body">' + switcher + '<div id="paPrevStage" style="flex:1;min-height:420px;display:flex;flex-direction:column"></div></div>',
      '</div>'
    ].join('');

    doc.body.appendChild(ov);
    var activeIdx = 0;
    var activeBlobUrl = '';

    function cleanupBlob() {
      if (activeBlobUrl && root.URL && typeof root.URL.revokeObjectURL === 'function') {
        try { root.URL.revokeObjectURL(activeBlobUrl); } catch (_) {}
        activeBlobUrl = '';
      }
    }

    function renderStage(idx) {
      cleanupBlob();
      activeIdx = idx;
      var f = fileList[idx];
      var stage = ov.querySelector('#paPrevStage');
      if (!f || !f.data || !stage) return;
      var fname = String(f.name || '').toLowerCase();
      var ftype = String(f.type || '').toLowerCase();

      if (ftype.indexOf('image/') === 0 || /\.(png|jpe?g|webp|gif)$/i.test(fname)) {
        stage.innerHTML = '<div style="flex:1;display:flex;align-items:center;justify-content:center;background:#0f172a;border-radius:10px;padding:12px;overflow:auto"><img src="' + esc(f.data) + '" alt="' + esc(f.name) + '" style="max-width:100%;max-height:100%;object-fit:contain;border-radius:6px" /></div>';
        return;
      }

      if (ftype.indexOf('pdf') >= 0 || /\.pdf$/i.test(fname)) {
        try {
          var blob = dataUrlToBlob(f.data, 'application/pdf');
          activeBlobUrl = root.URL.createObjectURL(blob);
          stage.innerHTML = '<iframe class="pa-preview-frame" src="' + activeBlobUrl + '" title="' + esc(f.name) + '"></iframe>';
        } catch (_) {
          stage.innerHTML = '<iframe class="pa-preview-frame" src="' + esc(f.data) + '" title="' + esc(f.name) + '"></iframe>';
        }
        return;
      }

      if (/\.(xlsx|xls|csv)$/i.test(fname) && root.XLSX) {
        try {
          var b64 = String(f.data).split(',')[1] || f.data;
          var wb = root.XLSX.read(b64, { type: 'base64' });
          var firstSheet = wb.SheetNames[0];
          var tableHtml = firstSheet ? root.XLSX.utils.sheet_to_html(wb.Sheets[firstSheet]) : '<p>Empty workbook</p>';
          stage.innerHTML = '<div style="overflow:auto;border:1px solid #cbd5e1;border-radius:10px;padding:12px;background:#fff;font-size:12px">' + tableHtml + '</div>';
          return;
        } catch (_) {}
      }

      stage.innerHTML = '<div class="pa-empty"><h3>' + esc(f.name) + '</h3><p>Preview not inline for this format (' + esc(f.type || 'document') + '). Click Download to open locally.</p></div>';
    }

    renderStage(0);

    ov.querySelectorAll('[data-att-idx]').forEach(function (btn) {
      btn.onclick = function () {
        ov.querySelectorAll('[data-att-idx]').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        renderStage(Number(btn.getAttribute('data-att-idx')) || 0);
      };
    });

    ov.querySelector('#paPPrevDl').onclick = function () {
      var f = fileList[activeIdx];
      if (f) triggerFileDownload(f.data, f.name || 'audit-document', f.type);
    };
    ov.querySelector('#paPPrevPr').onclick = function () {
      printAuditDoc(docId);
    };
    ov.querySelector('#paMClose').onclick = function () {
      cleanupBlob();
      closeModal();
    };
  }

  function triggerFileDownload(dataUrl, fileName, mimeType) {
    var doc = root.document;
    if (!doc || !dataUrl) return;
    try {
      var blob = dataUrlToBlob(dataUrl, mimeType);
      var url = root.URL.createObjectURL(blob);
      var a = doc.createElement('a');
      a.href = url;
      a.download = fileName || 'audit-document';
      doc.body.appendChild(a);
      a.click();
      setTimeout(function () {
        if (a.parentNode) a.parentNode.removeChild(a);
        try { root.URL.revokeObjectURL(url); } catch (_) {}
      }, 400);
    } catch (_) {
      var a2 = doc.createElement('a');
      a2.href = dataUrl;
      a2.download = fileName || 'audit-document';
      doc.body.appendChild(a2);
      a2.click();
      setTimeout(function () { if (a2.parentNode) a2.parentNode.removeChild(a2); }, 200);
    }
  }

  async function downloadAuditDoc(docId) {
    var docMeta = state.docs.find(function (d) { return d && d.id === docId; });
    if (!docMeta) return;
    var att = await hydrateAttachment(docMeta);
    if (!att || !hasInlineBytes(att)) {
      notify('File bytes not found on device or Drive yet');
      return;
    }
    var list = (Array.isArray(att.files) && att.files.length)
      ? att.files
      : [{ name: att.file_name || docMeta.file_name || docMeta.title, type: att.file_type, data: att.file_data }];
    list.forEach(function (f) {
      if (f && f.data) triggerFileDownload(f.data, f.name || docMeta.title, f.type);
    });
  }

  async function printAuditDoc(docId) {
    var docMeta = state.docs.find(function (d) { return d && d.id === docId; });
    if (!docMeta) return;
    var att = await hydrateAttachment(docMeta);
    if (!att || !hasInlineBytes(att)) {
      notify('Attachment not available to print');
      return;
    }
    var f = (Array.isArray(att.files) && att.files[0]) || { name: att.file_name, type: att.file_type, data: att.file_data };
    var doc = root.document;
    var oldFrame = doc.getElementById('paPrintIframe');
    if (oldFrame && oldFrame.parentNode) oldFrame.parentNode.removeChild(oldFrame);

    var iframe = doc.createElement('iframe');
    iframe.id = 'paPrintIframe';
    iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
    doc.body.appendChild(iframe);

    var fname = String(f.name || '').toLowerCase();
    var ftype = String(f.type || '').toLowerCase();
    if (ftype.indexOf('pdf') >= 0 || /\.pdf$/i.test(fname)) {
      var blobUrl = root.URL.createObjectURL(dataUrlToBlob(f.data, 'application/pdf'));
      iframe.onload = function () {
        setTimeout(function () {
          try { iframe.contentWindow.focus(); iframe.contentWindow.print(); } catch (_) {}
        }, 250);
      };
      iframe.src = blobUrl;
      return;
    }

    var idoc = iframe.contentDocument || iframe.contentWindow.document;
    idoc.open();
    if (ftype.indexOf('image/') === 0 || /\.(png|jpe?g|webp|gif)$/i.test(fname)) {
      idoc.write('<!doctype html><html><body style="margin:18px;font-family:sans-serif"><h3>' + esc(docMeta.title) + ' (' + esc(docMeta.partyName) + ')</h3><img src="' + f.data + '" style="max-width:100%;height:auto" /></body></html>');
    } else {
      idoc.write('<!doctype html><html><body style="margin:24px;font-family:sans-serif"><h2>' + esc(docMeta.title) + '</h2><p>Party: ' + esc(docMeta.partyName) + ' · Category: ' + esc(docMeta.category) + ' · Ref: ' + esc(docMeta.refNo || '—') + '</p><p>File: ' + esc(f.name) + '</p></body></html>');
    }
    idoc.close();
    setTimeout(function () {
      try { iframe.contentWindow.focus(); iframe.contentWindow.print(); } catch (_) {}
    }, 250);
  }

  function exportAuditRegisterCsv() {
    var rows = getFilteredDocs();
    var headers = ['Party Audit', 'Document Title', 'Category', 'Status', 'Ref No', 'Audit Period', 'Expiry Date', 'File Name', 'Uploaded By', 'Updated At', 'Remarks'];
    var csvEscape = function (v) {
      var s = String(v == null ? '' : v).replace(/"/g, '""');
      return '"' + s + '"';
    };
    var lines = [headers.map(csvEscape).join(',')];
    rows.forEach(function (d) {
      lines.push([
        d.partyName || d.partyId,
        d.title,
        d.category,
        (STATUS_META[d.status] && STATUS_META[d.status].label) || d.status,
        d.refNo || '',
        d.auditPeriod || '',
        d.expiryDate || '',
        d.file_name || '',
        d.uploadedBy || '',
        d.updated_at || '',
        d.remarks || ''
      ].map(csvEscape).join(','));
    });
    var csvStr = '\uFEFF' + lines.join('\r\n');
    var blob = new root.Blob([csvStr], { type: 'text/csv;charset=utf-8;' });
    var url = root.URL.createObjectURL(blob);
    var doc = root.document;
    var a = doc.createElement('a');
    a.href = url;
    a.download = 'ATPL_Party_Audit_Register_' + (state.selectedPartyId === 'ALL' ? 'ALL' : state.selectedPartyId) + '.csv';
    doc.body.appendChild(a);
    a.click();
    setTimeout(function () {
      if (a.parentNode) a.parentNode.removeChild(a);
      try { root.URL.revokeObjectURL(url); } catch (_) {}
    }, 300);
    notify('Exported ' + rows.length + ' audit document records');
  }

  // ── Event Delegation ──
  function bindEvents() {
    if (listenersBound) return;
    listenersBound = true;
    var doc = root.document;
    if (!doc) return;

    doc.addEventListener('click', function (ev) {
      var target = ev.target && ev.target.closest ? ev.target.closest('[data-pa-act]') : null;
      if (!target) return;
      var act = target.getAttribute('data-pa-act');
      var partyId = target.getAttribute('data-party-id');
      var docId = target.getAttribute('data-doc-id');

      if (act === 'sync') {
        syncNow(true);
      } else if (act === 'export') {
        exportAuditRegisterCsv();
      } else if (act === 'add-party') {
        openPartyModal(null);
      } else if (act === 'edit-party') {
        var pEdit = state.parties.find(function (p) { return p.id === partyId; });
        if (pEdit) openPartyModal(pEdit);
      } else if (act === 'delete-party') {
        var pDel = state.parties.find(function (p) { return p.id === partyId; });
        if (pDel) {
          openConfirmModal(
            'Delete Party Audit',
            'Delete "' + pDel.name + '" and its linked audit documents across Google Drive?',
            'Delete Party',
            function () { return deletePartyAndSync(pDel.id); }
          );
        }
      } else if (act === 'select-party') {
        state.selectedPartyId = partyId || 'ALL';
        state.expiringOnly = false;
        renderUI();
      } else if (act === 'toggle-checklist') {
        state.showChecklist = !state.showChecklist;
        renderUI();
      } else if (act === 'open-upload') {
        openUploadModal({ partyId: partyId || undefined });
      } else if (act === 'checklist-upload') {
        openUploadModal({
          partyId: partyId,
          title: target.getAttribute('data-doc-title') || '',
          category: target.getAttribute('data-doc-cat') || CATEGORIES[0]
        });
      } else if (act === 'filter-status') {
        state.expiringOnly = false;
        state.statusFilter = target.getAttribute('data-val') || 'ALL';
        renderUI();
      } else if (act === 'filter-expiring') {
        state.expiringOnly = !state.expiringOnly;
        if (state.expiringOnly) state.sortBy = 'expiry';
        renderUI();
      } else if (act === 'filter-cat') {
        state.categoryFilter = target.getAttribute('data-val') || 'ALL';
        renderUI();
      } else if (act === 'cycle-status') {
        if (!canDo('edit')) { notify('Edit permission required'); return; }
        var cur = state.docs.find(function (d) { return d.id === docId; });
        if (!cur) return;
        var order = ['ready', 'review', 'pending'];
        var nextStatus = order[(order.indexOf(cur.status) + 1) % order.length];
        saveDocAndSync(Object.assign({}, cur, { status: nextStatus }), false);
        notify('Status updated to ' + STATUS_META[nextStatus].label);
      } else if (act === 'preview-doc') {
        openPreviewModal(docId);
      } else if (act === 'download-doc') {
        downloadAuditDoc(docId);
      } else if (act === 'print-doc') {
        printAuditDoc(docId);
      } else if (act === 'edit-doc') {
        var curEdit = state.docs.find(function (d) { return d.id === docId; });
        if (curEdit) openUploadModal({ doc: curEdit });
      } else if (act === 'delete-doc') {
        var curDel = state.docs.find(function (d) { return d.id === docId; });
        if (curDel) {
          openConfirmModal(
            'Delete Audit Document',
            'Delete "' + curDel.title + '" from this party audit & Google Drive?',
            'Delete Document',
            function () { return deleteDocAndSync(curDel.id); }
          );
        }
      }
    });

    // Cross-tab BroadcastChannel
    if (typeof root.BroadcastChannel !== 'undefined') {
      try {
        var bc = new root.BroadcastChannel(CHANNEL_NAME);
        bc.onmessage = function (e) {
          var msg = e && e.data;
          if (!msg || msg.sender === CLIENT_ID) return;
          if (String(msg.action || '').indexOf('party_audit') === 0) {
            loadLocalState();
            renderUI();
            syncNow(false);
          }
        };
      } catch (_) {}
    }

    // Storage event listener
    root.addEventListener('storage', function (e) {
      if (!e || root.__ATPL_INTERNAL_STORAGE_WRITE) return;
      if (e.key === VAULT_STORAGE_KEY || e.key === TOMB_STORAGE_KEY || e.key === PARTY_TOMB_STORAGE_KEY) {
        loadLocalState();
        renderUI();
      }
    });

    // Focus / visibility sync
    root.addEventListener('focus', function () { syncNow(false); });
    if (doc.addEventListener) {
      doc.addEventListener('visibilitychange', function () {
        if (!doc.hidden) syncNow(false);
      });
    }

    try {
      if (doc && typeof doc.addEventListener === 'function') {
        doc.addEventListener('atpl-cloud-token-ready', function () { syncNow(false); });
        doc.addEventListener('atpl-authenticated', function () { syncNow(false); });
      }
    } catch (_) {}

    try {
      if (typeof root.EventSource === 'function' && isServerAvailable()) {
        var es = new root.EventSource('/api/sync/events');
        es.addEventListener('party_audits_updated', function () {
          syncNow(false);
        });
        es.addEventListener('party_audit_saved', function (ev) {
          try {
            var d = JSON.parse(ev.data || '{}');
            if (d && d.id) {
              state.docs = mergeDocs(state.docs, [d], state.tombstones);
              saveLocalState();
              renderUI();
            }
          } catch (_) {}
        });
        es.addEventListener('party_audit_deleted', function (ev) {
          try {
            var d = JSON.parse(ev.data || '{}');
            if (d && d.id) {
              var kl = String(d.id).toLowerCase();
              state.tombstones[kl] = d.deleted_at || new Date().toISOString();
              state.docs = state.docs.filter(function (x) { return x && String(x.id).toLowerCase() !== kl; });
              saveLocalState();
              renderUI();
            }
          } catch (_) {}
        });
      }
    } catch (_) {}

    // Periodic poll only when user is viewing the Audit page
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(function () {
      var pg = doc.getElementById('page-partyaudit');
      if (pg && pg.classList.contains('active') && !doc.hidden) {
        syncNow(false);
      }
    }, 25000);
  }

  function init() {
    loadLocalState();
    stripFromWindowFiles();
    bindEvents();
    renderUI();
    setTimeout(function () { syncNow(false); }, 600);
  }

  if (root.document && root.document.readyState === 'loading') {
    root.document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  root.ATPLPartyAudit = {
    version: MODULE_VERSION,
    DRIVE_VAULT_FILE: DRIVE_VAULT_FILE,
    DEFAULT_PARTIES: DEFAULT_PARTIES,
    init: init,
    renderUI: renderUI,
    syncNow: syncNow,
    saveDocAndSync: saveDocAndSync,
    deleteDocAndSync: deleteDocAndSync,
    savePartyAndSync: savePartyAndSync,
    deletePartyAndSync: deletePartyAndSync,
    hydrateAttachment: hydrateAttachment,
    openUploadModal: openUploadModal,
    openPartyModal: openPartyModal,
    getState: function () { return state; },
    _mergeDocs: mergeDocs,
    _mergeParties: mergeParties,
    _mergeTombstoneMaps: mergeTombstoneMaps,
    _docMetaOnly: docMetaOnly,
    _docAttFileName: docAttFileName
  };
})(typeof window !== 'undefined' ? window : globalThis);
