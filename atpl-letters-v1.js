/**
 * ATPL HR LETTERS & LEAVE APPLICATION ENGINE (V1.0)
 * Dedicated module for Arora Textiles Private Limited HR ERP.
 * Features:
 *  - Exact company Leave Application Letter format matching approved PDF layout
 *  - Employee Master live lookup by Emp Code or Name (fills Name, Designation, Department & Signature)
 *  - Automatic inclusive leave day counter + automatic Next Available / Return Date (+1 day, manually editable)
 *  - Authorized Signatory selector (Sarthak ji, Manish ji, Ayush ji)
 *  - Employee Leave History panel (per-employee + all-employees view, Load, Download .doc, Print/PDF, Delete)
 *  - Word (.doc) & A4 Print/Save-PDF export without window.open/alert
 *  - Non-blocking cross-browser persistence (localStorage, BroadcastChannel, SSE, /api/sync/leave-letters)
 */
(function (window) {
  'use strict';

  var STORAGE_KEY = 'ATPL_LeaveLettersV1';
  var TOMBSTONE_KEY = 'ATPL_LeaveLettersTombstonesV1';
  var CHANNEL_NAME = 'ATPL_ERP_TRIGGER_BUS';
  var SIGNED_BY_OPTIONS = ['Sarthak ji', 'Manish ji', 'Ayush ji'];

  var LETTER_TYPES = [
    { id: 'LEAVE', label: 'Leave Application Letter' }
  ];

  function todayISO() {
    var d = new Date();
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function parseISODateParts(iso) {
    if (!iso || typeof iso !== 'string') return null;
    var m = iso.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    var y = parseInt(m[1], 10);
    var mo = parseInt(m[2], 10);
    var d = parseInt(m[3], 10);
    if (!y || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return { y: y, m: mo, d: d };
  }

  function addDaysISO(iso, deltaDays) {
    var p = parseISODateParts(iso);
    if (!p) return '';
    var dt = new Date(Date.UTC(p.y, p.m - 1, p.d + (Number(deltaDays) || 0)));
    var y = dt.getUTCFullYear();
    var m = String(dt.getUTCMonth() + 1).padStart(2, '0');
    var d = String(dt.getUTCDate()).padStart(2, '0');
    return y + '-' + m + '-' + d;
  }

  function diffDaysInclusive(fromISO, toISO) {
    var f = parseISODateParts(fromISO);
    var t = parseISODateParts(toISO);
    if (!f || !t) return 0;
    var ms = Date.UTC(t.y, t.m - 1, t.d) - Date.UTC(f.y, f.m - 1, f.d);
    if (ms < 0) return 0;
    return Math.round(ms / 86400000) + 1;
  }

  function formatDateDDMMYYYY(iso) {
    var p = parseISODateParts(iso);
    if (!p) return iso ? String(iso) : '__/__/____';
    return String(p.d).padStart(2, '0') + '/' + String(p.m).padStart(2, '0') + '/' + p.y;
  }

  function formatDateDDMMYY(iso) {
    var p = parseISODateParts(iso);
    if (!p) return iso ? String(iso) : '__/__/__';
    return String(p.d).padStart(2, '0') + '/' + String(p.m).padStart(2, '0') + '/' + String(p.y).slice(-2);
  }

  function normalizeCode(code) {
    if (code == null) return '';
    return String(code).trim().replace(/\.0+$/, '').toLowerCase().replace(/^0+/, '');
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

  var state = {
    records: [],
    tombstones: {},
    historyScope: 'employee', // 'employee' | 'all'
    historySearch: '',
    statusMessage: '',
    statusTone: 'info',
    returnDateManual: false,
    editingId: null,
    form: {
      letterType: 'LEAVE',
      letterDate: todayISO(),
      empCode: '',
      empName: '',
      designation: '',
      department: '',
      fromDate: todayISO(),
      toDate: todayISO(),
      days: 1,
      returnDate: addDaysISO(todayISO(), 1),
      reason: 'some personal reason',
      signedBy: 'Sarthak ji'
    }
  };

  function getEmployeeMasterList() {
    var list = [];
    if (window.EM && Array.isArray(window.EM.data) && window.EM.data.length) {
      list = window.EM.data;
    } else if (Array.isArray(window.EMP_MASTER_DATA) && window.EMP_MASTER_DATA.length) {
      list = window.EMP_MASTER_DATA;
    } else {
      try {
        var raw = window.localStorage && (
          window.localStorage.getItem('AroraTextilesEmployeeMasterV3') ||
          window.localStorage.getItem('ATPL_EmployeeMaster_V3') ||
          window.localStorage.getItem('EM_DATA')
        );
        if (raw) {
          var parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) list = parsed;
          else if (parsed && Array.isArray(parsed.data)) list = parsed.data;
          else if (parsed && Array.isArray(parsed.employees)) list = parsed.employees;
        }
      } catch (_) {}
    }

    var out = [];
    var seen = {};
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (!e || typeof e !== 'object') continue;
      var code = String(e.emp_id || e.empCode || e.emp_code || e.code || e.id || '').trim();
      if (!code) continue;
      var norm = normalizeCode(code) || code.toLowerCase();
      if (seen[norm]) continue;
      seen[norm] = true;
      out.push({
        empCode: code,
        empName: String(e.name || e.emp_name || e.empName || e.employee_name || '').trim(),
        designation: String(e.desig || e.designation || e.post || '').trim(),
        department: String(e.dept || e.department || '').trim(),
        phone: String(e.phone_no || e.mobile || e.phone || '').trim()
      });
    }
    return out;
  }

  function findEmployeeByCode(code) {
    var raw = String(code || '').trim();
    if (!raw) return null;
    var norm = normalizeCode(raw);
    var list = getEmployeeMasterList();
    for (var i = 0; i < list.length; i++) {
      if (String(list[i].empCode).trim().toLowerCase() === raw.toLowerCase()) return list[i];
    }
    for (var j = 0; j < list.length; j++) {
      if (norm && normalizeCode(list[j].empCode) === norm) return list[j];
    }
    return null;
  }

  function searchEmployees(query) {
    var q = String(query || '').trim().toLowerCase();
    var list = getEmployeeMasterList();
    if (!q) return list.slice(0, 12);
    var hits = [];
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (
        e.empCode.toLowerCase().indexOf(q) >= 0 ||
        e.empName.toLowerCase().indexOf(q) >= 0 ||
        e.department.toLowerCase().indexOf(q) >= 0 ||
        e.designation.toLowerCase().indexOf(q) >= 0
      ) {
        hits.push(e);
        if (hits.length >= 12) break;
      }
    }
    return hits;
  }

  function loadFromLocalStorage() {
    try {
      if (!window.localStorage) return;
      var raw = window.localStorage.getItem(STORAGE_KEY);
      var parsed = raw ? JSON.parse(raw) : [];
      var tombRaw = window.localStorage.getItem(TOMBSTONE_KEY);
      state.tombstones = tombRaw ? (JSON.parse(tombRaw) || {}) : {};
      if (Array.isArray(parsed)) {
        state.records = parsed.filter(function (r) {
          return r && r.id && !state.tombstones[r.id];
        });
      }
    } catch (_) {
      state.records = [];
    }
  }

  function saveToLocalStorage() {
    try {
      if (!window.localStorage) return;
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state.records));
      window.localStorage.setItem(TOMBSTONE_KEY, JSON.stringify(state.tombstones || {}));
    } catch (_) {}
  }

  function broadcastLocalEvent(type, payload) {
    try {
      if (typeof window.BroadcastChannel === 'function') {
        var ch = new window.BroadcastChannel(CHANNEL_NAME);
        ch.postMessage({ type: type, payload: payload, ts: Date.now() });
        ch.close();
      }
    } catch (_) {}
  }

  function notifyToast(msg) {
    if (typeof window.showToast === 'function') {
      try { window.showToast(msg); } catch (_) {}
    }
  }

  function setStatus(msg, tone) {
    state.statusMessage = msg || '';
    state.statusTone = tone || 'info';
  }

  function mergeServerRecords(serverList) {
    if (!Array.isArray(serverList)) return;
    var map = {};
    state.records.forEach(function (r) {
      if (r && r.id && !state.tombstones[r.id]) map[r.id] = r;
    });
    serverList.forEach(function (sr) {
      if (!sr || !sr.id || state.tombstones[sr.id]) return;
      var ex = map[sr.id];
      if (!ex || String(sr.updatedAt || '') >= String(ex.updatedAt || '')) {
        map[sr.id] = sr;
      }
    });
    state.records = Object.keys(map).map(function (k) { return map[k]; }).sort(function (a, b) {
      return String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || ''));
    });
    saveToLocalStorage();
  }

  function syncNow() {
    if (typeof window.fetch !== 'function') return Promise.resolve({ ok: true, localOnly: true });
    return window.fetch('/api/sync/leave-letters')
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (data) {
        if (data && data.ok && Array.isArray(data.records)) {
          mergeServerRecords(data.records);
          renderUI();
        }
        return { ok: true, count: state.records.length };
      })
      .catch(function (err) {
        return { ok: false, error: err && err.message ? err.message : 'sync error' };
      });
  }

  function pushRecordToServer(rec) {
    if (typeof window.fetch !== 'function' || !rec || !rec.id) return Promise.resolve();
    return window.fetch('/api/sync/leave-letter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rec)
    }).catch(function () {});
  }

  function deleteRecordOnServer(id) {
    if (typeof window.fetch !== 'function' || !id) return Promise.resolve();
    return window.fetch('/api/sync/leave-letter/' + encodeURIComponent(id), {
      method: 'DELETE'
    }).catch(function () {});
  }

  function recalcFormDates(options) {
    options = options || {};
    var f = state.form;
    f.days = diffDaysInclusive(f.fromDate, f.toDate);
    if (options.forceAutoReturn || !state.returnDateManual) {
      if (f.toDate) {
        f.returnDate = addDaysISO(f.toDate, 1);
      }
    }
  }

  function setFormField(field, value, opts) {
    opts = opts || {};
    var f = state.form;
    if (field === 'empCode') {
      f.empCode = String(value || '');
      var match = findEmployeeByCode(f.empCode);
      if (match) {
        f.empName = match.empName || f.empName;
        f.designation = match.designation || '';
        f.department = match.department || '';
      }
    } else if (field === 'fromDate') {
      f.fromDate = String(value || '');
      if (f.toDate && f.fromDate && f.toDate < f.fromDate) {
        f.toDate = f.fromDate;
        if (!state.returnDateManual) f.returnDate = addDaysISO(f.toDate, 1);
      }
      recalcFormDates({ forceAutoReturn: !state.returnDateManual });
    } else if (field === 'toDate') {
      f.toDate = String(value || '');
      state.returnDateManual = false;
      recalcFormDates({ forceAutoReturn: true });
    } else if (field === 'returnDate') {
      f.returnDate = String(value || '');
      state.returnDateManual = true;
    } else if (field === 'days') {
      var n = parseInt(value, 10);
      f.days = isFinite(n) && n >= 0 ? n : 0;
    } else if (field in f) {
      f[field] = String(value == null ? '' : value);
    }
    if (!opts.silent) {
      refreshPreviewAndCalculatedDom();
    }
  }

  function resetReturnDateAuto() {
    state.returnDateManual = false;
    recalcFormDates({ forceAutoReturn: true });
    renderUI();
  }

  function buildLetterInnerHtml(rec) {
    rec = rec || state.form;
    var empCode = String(rec.empCode || '').trim() || '_____';
    var empName = String(rec.empName || '').trim() || 'Employee Name';
    var designation = String(rec.designation || '').trim() || '__________';
    var department = String(rec.department || '').trim() || '__________';
    var days = Number(rec.days || diffDaysInclusive(rec.fromDate, rec.toDate) || 0);
    var daysWord = days === 1 ? 'Day' : 'Days';
    var letterDateTxt = formatDateDDMMYY(rec.letterDate);
    var fromTxt = formatDateDDMMYYYY(rec.fromDate);
    var toTxt = formatDateDDMMYYYY(rec.toDate);
    var returnTxt = formatDateDDMMYYYY(rec.returnDate || addDaysISO(rec.toDate, 1));
    var reasonTxt = String(rec.reason || 'some personal reason').trim() || 'some personal reason';
    var signedBy = String(rec.signedBy || 'Sarthak ji').trim();

    return (
      '<div class="atpl-letter-sheet" style="font-family:\'Times New Roman\',Times,serif;color:#000000;background:#ffffff;line-height:1.42;font-size:13.5px;">' +
        '<div style="text-align:center;font-weight:700;margin-bottom:18px;">' +
          '<div style="font-size:18px;letter-spacing:0.3px;margin-bottom:3px;">ARORA TEXTILES PVT LTD</div>' +
          '<div style="font-size:13.5px;margin-bottom:2px;">(Manufacturers of Suppliers of Carpet Woollen Yarn)</div>' +
          '<div style="font-size:13.5px;margin-bottom:2px;">Add:-E-90,91, IGC, Khara-334601, Bikaner (Rajasthan)</div>' +
          '<div style="font-size:13.5px;">E-mail:-arorawool@gmail.com:, Mobile No:-9858121113</div>' +
        '</div>' +

        '<div style="text-align:right;font-size:13.5px;margin-bottom:14px;">' + esc(letterDateTxt) + '</div>' +

        '<div style="font-weight:700;font-size:13.5px;line-height:1.35;margin-bottom:16px;">' +
          '<div>The Respected Directors</div>' +
          '<div>Arora Textiles Pvt Ltd</div>' +
          '<div>Khara-334601, Bikaner (Rajasthan)</div>' +
        '</div>' +

        '<div style="font-size:13.5px;margin-bottom:12px;">From,</div>' +

        '<div style="font-size:13.5px;line-height:1.55;margin-bottom:22px;">' +
          '<div>' + esc(empName) + '</div>' +
          '<div><b>Employee ID:</b> ' + esc(empCode) + '</div>' +
          '<div><b>Designation:</b> ' + esc(designation) + '</div>' +
          '<div><b>Department:</b> ' + esc(department) + '</div>' +
        '</div>' +

        '<div style="text-align:center;font-weight:700;text-decoration:underline;font-size:14px;margin-bottom:14px;">Subject: Leave Application</div>' +

        '<div style="font-size:13.5px;margin-bottom:12px;">Dear Sir,</div>' +

        '<p style="margin:0 0 11px 0;font-size:13.5px;text-align:left;">' +
          'With humble request, I am writing this letter to inform you and to get permission to take <b>' + esc(days) + ' ' + esc(daysWord) + '</b> of leave from <b>' + esc(fromTxt) + '</b> to <b>' + esc(toTxt) + '</b> because of ' + esc(reasonTxt) + '.' +
        '</p>' +

        '<p style="margin:0 0 11px 0;font-size:13.5px;text-align:left;">' +
          'I feel confident that my team members should be able to continue the exceptional work during my absence.' +
        '</p>' +

        '<p style="margin:0 0 11px 0;font-size:13.5px;text-align:left;">' +
          'I hope you will understand my situation and grant me leave for <b>' + esc(days) + ' ' + esc(daysWord) + '</b>. I will return to work immediately after the leave i.e., on <b>' + esc(returnTxt) + '</b>' +
        '</p>' +

        '<p style="margin:0 0 11px 0;font-size:13.5px;text-align:left;">In case of any emergency, I will be available on my mobile.</p>' +

        '<p style="margin:0 0 10px 0;font-size:13.5px;text-align:left;">I shall be obliged to you in this matter.</p>' +

        '<div style="text-align:center;font-weight:700;text-decoration:underline;font-size:14px;margin:10px 0 46px 0;">(Thanking You)</div>' +

        '<table style="width:100%;border-collapse:collapse;font-family:\'Times New Roman\',Times,serif;font-size:13.5px;color:#000000;">' +
          '<tr>' +
            '<td style="width:33%;text-align:center;vertical-align:top;border:none;padding:0;">' +
              '<div>Sincerely</div>' +
              '<div style="margin-top:2px;">(' + esc(empName) + ')</div>' +
            '</td>' +
            '<td style="width:34%;text-align:center;vertical-align:top;border:none;padding:0;">' +
              '<div>Arora Textiles Pvt Ltd</div>' +
              '<div style="margin-top:2px;">(Director)</div>' +
              (signedBy ? '<div style="margin-top:3px;font-size:12px;">(' + esc(signedBy) + ')</div>' : '') +
            '</td>' +
            '<td style="width:33%;text-align:center;vertical-align:top;border:none;padding:0;">' +
              '<div>HR Department</div>' +
              '<div style="margin-top:2px;">(HOD)</div>' +
            '</td>' +
          '</tr>' +
        '</table>' +
      '</div>'
    );
  }

  function buildDownloadDocumentHtml(rec, mode) {
    rec = rec || state.form;
    var isWord = mode === 'word';
    var inner = buildLetterInnerHtml(rec);
    if (isWord) {
      return (
        '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">' +
        '<head><meta charset="utf-8"><title>Leave Application - ' + esc(rec.empName || rec.empCode || 'Employee') + '</title>' +
        '<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->' +
        '<style>' +
        '@page Section1 { size: 210mm 297mm; margin: 18mm 20mm 18mm 20mm; }' +
        'div.Section1 { page: Section1; font-family: "Times New Roman", Times, serif; }' +
        'body { font-family: "Times New Roman", Times, serif; margin: 0; color: #000; }' +
        'p { margin: 0 0 10px 0; }' +
        '</style></head>' +
        '<body><div class="Section1">' + inner + '</div></body></html>'
      );
    }
    return (
      '<!DOCTYPE html><html><head><meta charset="utf-8">' +
      '<title>Leave Application - ' + esc(rec.empName || rec.empCode || 'Employee') + '</title>' +
      '<style>' +
      '@page { size: A4; margin: 18mm 20mm; }' +
      'html, body { background: #fff; color: #000; font-family: "Times New Roman", Times, serif; margin: 0; padding: 0; }' +
      '@media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }' +
      '</style></head><body>' + inner + '</body></html>'
    );
  }

  function buildRecordPayloadFromForm() {
    var f = state.form;
    var days = diffDaysInclusive(f.fromDate, f.toDate) || Number(f.days || 0);
    var now = new Date().toISOString();

    var existing = null;
    if (state.editingId) {
      existing = state.records.find(function (r) { return r && r.id === state.editingId; }) || null;
    }
    if (!existing) {
      var codeNorm = normalizeCode(f.empCode);
      existing = state.records.find(function (r) {
        return r &&
          normalizeCode(r.empCode) === codeNorm &&
          r.fromDate === f.fromDate &&
          r.toDate === f.toDate &&
          (r.letterType || 'LEAVE') === (f.letterType || 'LEAVE');
      }) || null;
    }

    var id = existing ? existing.id : ('ltr_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7));
    return {
      id: id,
      letterType: f.letterType || 'LEAVE',
      letterDate: f.letterDate || todayISO(),
      empCode: String(f.empCode || '').trim(),
      empName: String(f.empName || '').trim(),
      designation: String(f.designation || '').trim(),
      department: String(f.department || '').trim(),
      fromDate: f.fromDate || '',
      toDate: f.toDate || '',
      days: days,
      returnDate: f.returnDate || addDaysISO(f.toDate, 1),
      returnDateManual: !!state.returnDateManual,
      reason: String(f.reason || 'some personal reason').trim() || 'some personal reason',
      signedBy: String(f.signedBy || 'Sarthak ji').trim(),
      createdAt: existing && existing.createdAt ? existing.createdAt : now,
      updatedAt: now
    };
  }

  function validateForm() {
    var f = state.form;
    if (!String(f.empCode || '').trim()) {
      setStatus('Employee Code daaliye (ya Employee Master list se select karein).', 'error');
      return false;
    }
    if (!String(f.empName || '').trim()) {
      setStatus('Employee Name zaroori hai.', 'error');
      return false;
    }
    if (!parseISODateParts(f.fromDate) || !parseISODateParts(f.toDate)) {
      setStatus('Valid Leave From Date aur To Date select karein.', 'error');
      return false;
    }
    var days = diffDaysInclusive(f.fromDate, f.toDate);
    if (days <= 0) {
      setStatus('Leave To Date, From Date ke barabar ya uske baad honi chahiye.', 'error');
      return false;
    }
    return true;
  }

  function saveCurrentLetter(opts) {
    opts = opts || {};
    if (!validateForm()) {
      renderUI();
      return null;
    }
    var payload = buildRecordPayloadFromForm();
    delete state.tombstones[payload.id];
    var idx = -1;
    for (var i = 0; i < state.records.length; i++) {
      if (state.records[i] && state.records[i].id === payload.id) { idx = i; break; }
    }
    if (idx >= 0) state.records[idx] = payload;
    else state.records.unshift(payload);

    state.editingId = payload.id;
    saveToLocalStorage();
    broadcastLocalEvent('leave_letter_saved', payload);
    pushRecordToServer(payload);

    if (!opts.quiet) {
      setStatus('Leave record saved (' + payload.empName + ' · ' + payload.days + ' Days).', 'success');
      notifyToast('Leave record saved for ' + payload.empName);
      renderUI();
    }
    return payload;
  }

  function sanitizeFilenamePart(s) {
    return String(s || 'Employee').trim().replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'Employee';
  }

  function downloadRecordDoc(rec) {
    rec = rec || saveCurrentLetter({ quiet: true });
    if (!rec) {
      renderUI();
      return false;
    }
    var html = buildDownloadDocumentHtml(rec, 'word');
    var filename = 'Leave_Application_' + sanitizeFilenamePart(rec.empCode) + '_' + sanitizeFilenamePart(rec.empName) + '_' + (rec.fromDate || todayISO()) + '.doc';

    try {
      if (typeof window.Blob === 'function' && window.URL && typeof window.URL.createObjectURL === 'function' && window.document && window.document.createElement) {
        var blob = new window.Blob(['\ufeff', html], { type: 'application/msword;charset=utf-8' });
        var url = window.URL.createObjectURL(blob);
        var a = window.document.createElement('a');
        a.href = url;
        a.download = filename;
        a.style.display = 'none';
        window.document.body.appendChild(a);
        a.click();
        window.document.body.removeChild(a);
        setTimeout(function () {
          try { window.URL.revokeObjectURL(url); } catch (_) {}
        }, 1500);
      }
      setStatus('Downloaded ' + filename + ' & saved to Leave History.', 'success');
      notifyToast('Leave Letter downloaded: ' + filename);
      renderUI();
      return { ok: true, filename: filename, html: html };
    } catch (err) {
      setStatus('Download error: ' + (err && err.message ? err.message : 'failed'), 'error');
      renderUI();
      return false;
    }
  }

  function printRecordLetter(rec) {
    rec = rec || saveCurrentLetter({ quiet: true });
    if (!rec) {
      renderUI();
      return false;
    }
    var docHtml = buildDownloadDocumentHtml(rec, 'print');
    try {
      var doc = window.document;
      var old = doc.getElementById('atplLetterPrintFrame');
      if (old && old.parentNode) old.parentNode.removeChild(old);

      var iframe = doc.createElement('iframe');
      iframe.id = 'atplLetterPrintFrame';
      iframe.style.position = 'fixed';
      iframe.style.right = '0';
      iframe.style.bottom = '0';
      iframe.style.width = '0';
      iframe.style.height = '0';
      iframe.style.border = '0';
      iframe.style.visibility = 'hidden';
      doc.body.appendChild(iframe);

      var cw = iframe.contentWindow;
      var cdoc = cw ? cw.document : iframe.contentDocument;
      if (cdoc) {
        cdoc.open();
        cdoc.write(docHtml);
        cdoc.close();
      }
      setTimeout(function () {
        try {
          if (cw) {
            cw.focus();
            cw.print();
          }
        } catch (_) {}
      }, 150);

      setStatus('Print / Save PDF ready (' + rec.empName + ') & saved to Leave History.', 'success');
      renderUI();
      return true;
    } catch (err) {
      setStatus('Print preview failed: ' + (err && err.message ? err.message : 'error'), 'error');
      renderUI();
      return false;
    }
  }

  function loadRecordIntoForm(id) {
    var rec = state.records.find(function (r) { return r && r.id === id; });
    if (!rec) return false;
    state.editingId = rec.id;
    state.returnDateManual = !!rec.returnDateManual;
    state.form = {
      letterType: rec.letterType || 'LEAVE',
      letterDate: rec.letterDate || todayISO(),
      empCode: rec.empCode || '',
      empName: rec.empName || '',
      designation: rec.designation || '',
      department: rec.department || '',
      fromDate: rec.fromDate || todayISO(),
      toDate: rec.toDate || todayISO(),
      days: Number(rec.days || diffDaysInclusive(rec.fromDate, rec.toDate) || 0),
      returnDate: rec.returnDate || addDaysISO(rec.toDate, 1),
      reason: rec.reason || 'some personal reason',
      signedBy: rec.signedBy || 'Sarthak ji'
    };
    setStatus('Loaded historical leave letter for ' + (rec.empName || rec.empCode) + '.', 'info');
    renderUI();
    return true;
  }

  function startNewLetter() {
    var keepCode = state.form.empCode;
    var keepName = state.form.empName;
    var keepDesig = state.form.designation;
    var keepDept = state.form.department;
    var keepSigned = state.form.signedBy || 'Sarthak ji';
    var td = todayISO();
    state.editingId = null;
    state.returnDateManual = false;
    state.form = {
      letterType: 'LEAVE',
      letterDate: td,
      empCode: keepCode,
      empName: keepName,
      designation: keepDesig,
      department: keepDept,
      fromDate: td,
      toDate: td,
      days: 1,
      returnDate: addDaysISO(td, 1),
      reason: 'some personal reason',
      signedBy: keepSigned
    };
    setStatus('New leave letter ready.', 'info');
    renderUI();
  }

  function deleteRecord(id) {
    if (!id) return false;
    state.tombstones[id] = new Date().toISOString();
    state.records = state.records.filter(function (r) { return r && r.id !== id; });
    if (state.editingId === id) state.editingId = null;
    saveToLocalStorage();
    broadcastLocalEvent('leave_letter_deleted', { id: id });
    deleteRecordOnServer(id);
    setStatus('Leave record deleted from history.', 'info');
    renderUI();
    return true;
  }

  function getEmployeeHistory(empCode) {
    var norm = normalizeCode(empCode);
    if (!norm) return [];
    return state.records.filter(function (r) {
      return r && !state.tombstones[r.id] && normalizeCode(r.empCode) === norm;
    }).sort(function (a, b) {
      return String(b.fromDate || b.updatedAt || '').localeCompare(String(a.fromDate || a.updatedAt || ''));
    });
  }

  function getFilteredHistory() {
    var list = state.historyScope === 'employee' && String(state.form.empCode || '').trim()
      ? getEmployeeHistory(state.form.empCode)
      : state.records.filter(function (r) { return r && !state.tombstones[r.id]; });

    var q = String(state.historySearch || '').trim().toLowerCase();
    if (!q) return list;
    return list.filter(function (r) {
      return (
        String(r.empCode || '').toLowerCase().indexOf(q) >= 0 ||
        String(r.empName || '').toLowerCase().indexOf(q) >= 0 ||
        String(r.department || '').toLowerCase().indexOf(q) >= 0 ||
        String(r.designation || '').toLowerCase().indexOf(q) >= 0 ||
        String(r.reason || '').toLowerCase().indexOf(q) >= 0 ||
        String(r.signedBy || '').toLowerCase().indexOf(q) >= 0
      );
    });
  }

  function ensureStyles() {
    var doc = window.document;
    if (!doc || !doc.head || doc.getElementById('atpl-letters-v1-style')) return;
    var s = doc.createElement('style');
    s.id = 'atpl-letters-v1-style';
    s.textContent = [
      '#letterModuleContainer{font-family:"Plus Jakarta Sans",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#0f172a;padding:18px 22px 32px;background:#f8fafc;min-height:100%;}',
      '.ltr-shell{max-width:1440px;margin:0 auto;display:flex;flex-direction:column;gap:16px;}',
      '.ltr-topbar{background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;padding:16px 20px;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;}',
      '.ltr-title{font-size:18px;font-weight:800;letter-spacing:-0.3px;color:#0f172a;margin:0;}',
      '.ltr-sub{font-size:12px;color:#64748b;margin-top:2px;}',
      '.ltr-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center;}',
      '.ltr-btn{display:inline-flex;align-items:center;gap:6px;padding:8px 14px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;border:1px solid #cbd5e1;background:#ffffff;color:#1e293b;transition:background .15s,border-color .15s;}',
      '.ltr-btn:hover{background:#f1f5f9;border-color:#94a3b8;}',
      '.ltr-btn-primary{background:#4f46e5;border-color:#4f46e5;color:#ffffff;}',
      '.ltr-btn-primary:hover{background:#4338ca;border-color:#4338ca;}',
      '.ltr-btn-dark{background:#0f172a;border-color:#0f172a;color:#ffffff;}',
      '.ltr-btn-dark:hover{background:#1e293b;}',
      '.ltr-btn-xs{padding:4px 8px;font-size:11px;border-radius:6px;}',
      '.ltr-status{padding:9px 14px;border-radius:8px;font-size:12px;font-weight:600;border:1px solid #cbd5e1;background:#ffffff;color:#334155;}',
      '.ltr-status.success{background:#f0fdf4;border-color:#bbf7d0;color:#166534;}',
      '.ltr-status.error{background:#fef2f2;border-color:#fecaca;color:#991b1b;}',
      '.ltr-grid{display:grid;grid-template-columns:minmax(360px,460px) minmax(420px,1fr);gap:16px;align-items:start;}',
      '@media(max-width:1180px){.ltr-grid{grid-template-columns:1fr;}}',
      '.ltr-col{display:flex;flex-direction:column;gap:16px;}',
      '.ltr-panel{background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;}',
      '.ltr-panel-head{padding:12px 16px;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;justify-content:space-between;gap:8px;background:#ffffff;}',
      '.ltr-panel-title{font-size:13px;font-weight:800;color:#0f172a;}',
      '.ltr-panel-body{padding:16px;}',
      '.ltr-form-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;}',
      '.ltr-field-full{grid-column:1 / -1;}',
      '.ltr-lbl{display:block;font-size:11px;font-weight:700;color:#475569;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.3px;}',
      '.ltr-input,.ltr-select{width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;font-size:12.5px;color:#0f172a;background:#ffffff;font-variant-numeric:tabular-nums;}',
      '.ltr-input:focus,.ltr-select:focus{outline:none;border-color:#4f46e5;box-shadow:0 0 0 3px rgba(79,70,229,0.12);}',
      '.ltr-days-box{display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border:1px solid #cbd5e1;border-radius:8px;background:#f8fafc;font-variant-numeric:tabular-nums;}',
      '.ltr-days-num{font-size:18px;font-weight:800;color:#4f46e5;}',
      '.ltr-emp-wrap{position:relative;}',
      '.ltr-suggest{position:absolute;left:0;right:0;top:100%;margin-top:4px;background:#ffffff;border:1px solid #cbd5e1;border-radius:8px;box-shadow:0 10px 25px rgba(15,23,42,0.12);z-index:40;max-height:220px;overflow-y:auto;display:none;}',
      '.ltr-suggest.open{display:block;}',
      '.ltr-suggest-item{padding:8px 10px;cursor:pointer;border-bottom:1px solid #f1f5f9;font-size:12px;display:flex;justify-content:space-between;gap:8px;}',
      '.ltr-suggest-item:hover{background:#f5f3ff;}',
      '.ltr-paper-wrap{background:#f1f5f9;padding:18px;display:flex;justify-content:center;overflow-x:auto;}',
      '.ltr-paper{width:100%;max-width:740px;background:#ffffff;border:1px solid #cbd5e1;padding:38px 46px;box-shadow:0 4px 16px rgba(15,23,42,0.06);}',
      '.ltr-hist-tabs{display:flex;gap:6px;}',
      '.ltr-tab-btn{padding:5px 10px;border-radius:6px;font-size:11px;font-weight:700;border:1px solid #cbd5e1;background:#ffffff;color:#475569;cursor:pointer;}',
      '.ltr-tab-btn.active{background:#0f172a;border-color:#0f172a;color:#ffffff;}',
      '.ltr-kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:12px;}',
      '.ltr-kpi{border:1px solid #e2e8f0;border-radius:8px;padding:10px 12px;background:#f8fafc;}',
      '.ltr-kpi-v{font-size:17px;font-weight:800;color:#0f172a;font-variant-numeric:tabular-nums;}',
      '.ltr-kpi-l{font-size:11px;color:#64748b;margin-top:2px;}',
      '.ltr-table-wrap{overflow-x:auto;}',
      '.ltr-table{width:100%;border-collapse:collapse;font-size:12px;}',
      '.ltr-table th{text-align:left;padding:8px 10px;background:#f8fafc;border-bottom:1px solid #e2e8f0;color:#475569;font-weight:700;font-size:11px;white-space:nowrap;}',
      '.ltr-table td{padding:9px 10px;border-bottom:1px solid #f1f5f9;color:#0f172a;vertical-align:middle;font-variant-numeric:tabular-nums;}',
      '.ltr-table tr:hover td{background:#f8fafc;}'
    ].join('');
    doc.head.appendChild(s);
  }

  function refreshPreviewAndCalculatedDom() {
    var doc = window.document;
    if (!doc) return;
    var f = state.form;
    var daysEl = doc.getElementById('ltrDaysValue');
    if (daysEl) daysEl.textContent = String(f.days || 0);
    var daysLbl = doc.getElementById('ltrDaysWord');
    if (daysLbl) daysLbl.textContent = Number(f.days) === 1 ? 'Day' : 'Days';

    var retEl = doc.getElementById('ltrReturnDate');
    if (retEl && retEl.value !== f.returnDate) retEl.value = f.returnDate || '';
    var retHint = doc.getElementById('ltrReturnHint');
    if (retHint) retHint.textContent = state.returnDateManual ? 'Manual date active' : 'Auto (+1 day after leave)';

    var nameEl = doc.getElementById('ltrEmpName');
    if (nameEl && nameEl.value !== f.empName && doc.activeElement !== nameEl) nameEl.value = f.empName || '';
    var desigEl = doc.getElementById('ltrDesignation');
    if (desigEl && desigEl.value !== f.designation && doc.activeElement !== desigEl) desigEl.value = f.designation || '';
    var deptEl = doc.getElementById('ltrDepartment');
    if (deptEl && deptEl.value !== f.department && doc.activeElement !== deptEl) deptEl.value = f.department || '';

    var preview = doc.getElementById('ltrLivePreviewSheet');
    if (preview) preview.innerHTML = buildLetterInnerHtml(f);

    var histBody = doc.getElementById('ltrHistoryBodyWrap');
    if (histBody) histBody.innerHTML = renderHistoryInnerHtml();
  }

  function renderSuggestionsHtml(query) {
    var hits = searchEmployees(query);
    if (!hits.length) return '';
    return hits.map(function (e) {
      return (
        '<div class="ltr-suggest-item" data-emp-code="' + esc(e.empCode) + '">' +
          '<div><strong>' + esc(e.empCode) + '</strong> · ' + esc(e.empName || '—') + '</div>' +
          '<div style="color:#64748b;font-size:11px">' + esc([e.designation, e.department].filter(Boolean).join(' · ')) + '</div>' +
        '</div>'
      );
    }).join('');
  }

  function renderHistoryInnerHtml() {
    var f = state.form;
    var hasEmp = Boolean(String(f.empCode || '').trim());
    var empHistory = hasEmp ? getEmployeeHistory(f.empCode) : [];
    var rows = getFilteredHistory();
    var totalDays = empHistory.reduce(function (s, r) { return s + (Number(r.days) || 0); }, 0);
    var lastLeave = empHistory.length ? formatDateDDMMYYYY(empHistory[0].toDate || empHistory[0].fromDate) : '—';

    var kpisHtml = '';
    if (state.historyScope === 'employee' && hasEmp) {
      kpisHtml = (
        '<div class="ltr-kpis">' +
          '<div class="ltr-kpi"><div class="ltr-kpi-v">' + empHistory.length + '</div><div class="ltr-kpi-l">Leaves (' + esc(f.empCode) + ')</div></div>' +
          '<div class="ltr-kpi"><div class="ltr-kpi-v">' + totalDays + ' Days</div><div class="ltr-kpi-l">Total Leave Days</div></div>' +
          '<div class="ltr-kpi"><div class="ltr-kpi-v">' + esc(lastLeave) + '</div><div class="ltr-kpi-l">Last Leave Date</div></div>' +
        '</div>'
      );
    } else {
      var allActive = state.records.filter(function (r) { return r && !state.tombstones[r.id]; });
      var allDays = allActive.reduce(function (s, r) { return s + (Number(r.days) || 0); }, 0);
      kpisHtml = (
        '<div class="ltr-kpis">' +
          '<div class="ltr-kpi"><div class="ltr-kpi-v">' + allActive.length + '</div><div class="ltr-kpi-l">Total Leave Letters</div></div>' +
          '<div class="ltr-kpi"><div class="ltr-kpi-v">' + allDays + ' Days</div><div class="ltr-kpi-l">Cumulative Days</div></div>' +
          '<div class="ltr-kpi"><div class="ltr-kpi-v">' + rows.length + '</div><div class="ltr-kpi-l">Showing Records</div></div>' +
        '</div>'
      );
    }

    var tableRows = rows.length ? rows.map(function (r) {
      var period = formatDateDDMMYY(r.fromDate) + ' → ' + formatDateDDMMYY(r.toDate);
      return (
        '<tr>' +
          '<td><div style="font-weight:700">' + esc(r.empCode) + ' · ' + esc(r.empName) + '</div><div style="font-size:11px;color:#64748b">' + esc([r.designation, r.department].filter(Boolean).join(' · ')) + '</div></td>' +
          '<td><div>' + esc(period) + '</div><div style="font-size:11px;color:#64748b">Return: ' + esc(formatDateDDMMYYYY(r.returnDate)) + '</div></td>' +
          '<td style="font-weight:800;color:#4f46e5">' + esc(r.days) + ' d</td>' +
          '<td><div>' + esc(r.signedBy || '—') + '</div><div style="font-size:11px;color:#64748b">' + esc(r.reason || '') + '</div></td>' +
          '<td style="white-space:nowrap">' +
            '<button type="button" class="ltr-btn ltr-btn-xs" data-ltr-action="load" data-ltr-id="' + esc(r.id) + '">Open</button> ' +
            '<button type="button" class="ltr-btn ltr-btn-xs" data-ltr-action="download" data-ltr-id="' + esc(r.id) + '">.doc</button> ' +
            '<button type="button" class="ltr-btn ltr-btn-xs" style="color:#b91c1c;border-color:#fecaca" data-ltr-action="delete" data-ltr-id="' + esc(r.id) + '">Del</button>' +
          '</td>' +
        '</tr>'
      );
    }).join('') : (
      '<tr><td colspan="5" style="text-align:center;padding:24px;color:#64748b">' +
        (state.historyScope === 'employee' && hasEmp
          ? 'Is employee (' + esc(f.empCode) + ') ki abhi koi saved leave history nahi hai. Save ya Download karte hi record yahan aa jayega.'
          : 'Koi leave record nahi mila.') +
      '</td></tr>'
    );

    return (
      kpisHtml +
      '<div style="margin-bottom:10px">' +
        '<input id="ltrHistorySearchInput" class="ltr-input" type="search" placeholder="History search by Code, Name, Dept, Reason, Signatory..." value="' + esc(state.historySearch) + '">' +
      '</div>' +
      '<div class="ltr-table-wrap">' +
        '<table class="ltr-table">' +
          '<thead><tr><th>Employee</th><th>Leave Dates</th><th>Days</th><th>Signed / Reason</th><th>Actions</th></tr></thead>' +
          '<tbody>' + tableRows + '</tbody>' +
        '</table>' +
      '</div>'
    );
  }

  function renderUI() {
    var doc = window.document;
    if (!doc) return;
    var container = doc.getElementById('letterModuleContainer');
    if (!container) return;
    ensureStyles();

    var f = state.form;
    var empListCount = getEmployeeMasterList().length;

    container.innerHTML = (
      '<div class="ltr-shell">' +
        '<div class="ltr-topbar">' +
          '<div>' +
            '<h1 class="ltr-title">HR Letters &amp; Leave Application</h1>' +
            '<div class="ltr-sub">Employee Master se auto-fill, automatic leave days + return date calculation, exact company format download aur employee leave history.</div>' +
          '</div>' +
          '<div class="ltr-actions">' +
            '<button type="button" id="ltrBtnNew" class="ltr-btn">+ New Letter</button>' +
            '<button type="button" id="ltrBtnSave" class="ltr-btn">Save History</button>' +
            '<button type="button" id="ltrBtnPrint" class="ltr-btn ltr-btn-dark">Print / Save PDF</button>' +
            '<button type="button" id="ltrBtnDownloadDoc" class="ltr-btn ltr-btn-primary">Download Word (.doc)</button>' +
          '</div>' +
        '</div>' +

        (state.statusMessage ? '<div class="ltr-status ' + esc(state.statusTone) + '">' + esc(state.statusMessage) + '</div>' : '') +

        '<div class="ltr-grid">' +
          '<div class="ltr-col">' +
            '<div class="ltr-panel">' +
              '<div class="ltr-panel-head">' +
                '<div class="ltr-panel-title">Leave Letter Details</div>' +
                '<div style="font-size:11px;color:#64748b">Master Loaded: <strong>' + empListCount + '</strong></div>' +
              '</div>' +
              '<div class="ltr-panel-body">' +
                '<div class="ltr-form-grid">' +
                  '<div>' +
                    '<label class="ltr-lbl" for="ltrTemplateType">Letter Format</label>' +
                    '<select id="ltrTemplateType" class="ltr-select">' +
                      LETTER_TYPES.map(function (t) {
                        return '<option value="' + esc(t.id) + '"' + (f.letterType === t.id ? ' selected' : '') + '>' + esc(t.label) + '</option>';
                      }).join('') +
                    '</select>' +
                  '</div>' +
                  '<div>' +
                    '<label class="ltr-lbl" for="ltrLetterDate">Letter Date</label>' +
                    '<input id="ltrLetterDate" type="date" class="ltr-input" value="' + esc(f.letterDate) + '">' +
                  '</div>' +

                  '<div class="ltr-field-full ltr-emp-wrap">' +
                    '<label class="ltr-lbl" for="ltrEmpCode">Employee Code (Auto-Lookup)</label>' +
                    '<input id="ltrEmpCode" type="text" class="ltr-input" autocomplete="off" placeholder="Emp Code daaliye (e.g. 25447) ya Naam type karein..." value="' + esc(f.empCode) + '">' +
                    '<div id="ltrEmpSuggest" class="ltr-suggest"></div>' +
                  '</div>' +

                  '<div class="ltr-field-full">' +
                    '<label class="ltr-lbl" for="ltrEmpName">Employee Name (Auto Signature Niche)</label>' +
                    '<input id="ltrEmpName" type="text" class="ltr-input" placeholder="Employee Name" value="' + esc(f.empName) + '">' +
                  '</div>' +

                  '<div>' +
                    '<label class="ltr-lbl" for="ltrDesignation">Designation</label>' +
                    '<input id="ltrDesignation" type="text" class="ltr-input" placeholder="Auto / Designation" value="' + esc(f.designation) + '">' +
                  '</div>' +
                  '<div>' +
                    '<label class="ltr-lbl" for="ltrDepartment">Department</label>' +
                    '<input id="ltrDepartment" type="text" class="ltr-input" placeholder="Auto / Department" value="' + esc(f.department) + '">' +
                  '</div>' +

                  '<div>' +
                    '<label class="ltr-lbl" for="ltrFromDate">Leave From Date</label>' +
                    '<input id="ltrFromDate" type="date" class="ltr-input" value="' + esc(f.fromDate) + '">' +
                  '</div>' +
                  '<div>' +
                    '<label class="ltr-lbl" for="ltrToDate">Leave To Date</label>' +
                    '<input id="ltrToDate" type="date" class="ltr-input" value="' + esc(f.toDate) + '">' +
                  '</div>' +

                  '<div>' +
                    '<label class="ltr-lbl">Total Leave Days (Auto)</label>' +
                    '<div class="ltr-days-box">' +
                      '<span><span id="ltrDaysValue" class="ltr-days-num">' + esc(f.days) + '</span> <span id="ltrDaysWord" style="font-size:12px;font-weight:700;color:#334155">' + (Number(f.days) === 1 ? 'Day' : 'Days') + '</span></span>' +
                      '<span style="font-size:11px;color:#64748b">Inclusive</span>' +
                    '</div>' +
                  '</div>' +
                  '<div>' +
                    '<label class="ltr-lbl" for="ltrReturnDate" style="display:flex;justify-content:space-between;align-items:center">' +
                      '<span>Next Available / Return Date</span>' +
                      '<button type="button" id="ltrBtnResetReturn" style="border:none;background:none;color:#4f46e5;font-size:10px;font-weight:700;cursor:pointer;padding:0">Auto (+1d)</button>' +
                    '</label>' +
                    '<input id="ltrReturnDate" type="date" class="ltr-input" value="' + esc(f.returnDate) + '">' +
                    '<div id="ltrReturnHint" style="font-size:10px;color:#64748b;margin-top:3px">' + (state.returnDateManual ? 'Manual date active' : 'Auto (+1 day after leave)') + '</div>' +
                  '</div>' +

                  '<div>' +
                    '<label class="ltr-lbl" for="ltrSignedBy">Signed By (Director)</label>' +
                    '<select id="ltrSignedBy" class="ltr-select">' +
                      SIGNED_BY_OPTIONS.map(function (s) {
                        return '<option value="' + esc(s) + '"' + (f.signedBy === s ? ' selected' : '') + '>' + esc(s) + '</option>';
                      }).join('') +
                    '</select>' +
                  '</div>' +
                  '<div>' +
                    '<label class="ltr-lbl" for="ltrReason">Leave Reason</label>' +
                    '<input id="ltrReason" type="text" class="ltr-input" placeholder="some personal reason" value="' + esc(f.reason) + '">' +
                  '</div>' +
                '</div>' +
              '</div>' +
            '</div>' +

            '<div class="ltr-panel">' +
              '<div class="ltr-panel-head">' +
                '<div class="ltr-panel-title">Employee Leave History</div>' +
                '<div class="ltr-hist-tabs">' +
                  '<button type="button" id="ltrScopeEmpBtn" class="ltr-tab-btn' + (state.historyScope === 'employee' ? ' active' : '') + '">This Emp</button>' +
                  '<button type="button" id="ltrScopeAllBtn" class="ltr-tab-btn' + (state.historyScope === 'all' ? ' active' : '') + '">All Records</button>' +
                '</div>' +
              '</div>' +
              '<div class="ltr-panel-body" id="ltrHistoryBodyWrap">' +
                renderHistoryInnerHtml() +
              '</div>' +
            '</div>' +
          '</div>' +

          '<div class="ltr-panel">' +
            '<div class="ltr-panel-head">' +
              '<div class="ltr-panel-title">Live A4 Letter Format Preview (Exact Print &amp; Download Layout)</div>' +
              '<div style="font-size:11px;color:#64748b">Times New Roman · A4 Portrait</div>' +
            '</div>' +
            '<div class="ltr-paper-wrap">' +
              '<div class="ltr-paper" id="ltrLivePreviewSheet">' +
                buildLetterInnerHtml(f) +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>'
    );

    bindDomEvents(container);
  }

  function bindDomEvents(container) {
    var doc = window.document;
    if (!doc) return;

    function on(id, ev, fn) {
      var el = doc.getElementById(id);
      if (el) el.addEventListener(ev, fn);
      return el;
    }

    on('ltrBtnNew', 'click', startNewLetter);
    on('ltrBtnSave', 'click', function () { saveCurrentLetter(); });
    on('ltrBtnDownloadDoc', 'click', function () { downloadRecordDoc(); });
    on('ltrBtnPrint', 'click', function () { printRecordLetter(); });
    on('ltrBtnResetReturn', 'click', resetReturnDateAuto);

    on('ltrScopeEmpBtn', 'click', function () {
      state.historyScope = 'employee';
      renderUI();
    });
    on('ltrScopeAllBtn', 'click', function () {
      state.historyScope = 'all';
      renderUI();
    });

    on('ltrTemplateType', 'change', function (e) { setFormField('letterType', e.target.value); });
    on('ltrLetterDate', 'change', function (e) { setFormField('letterDate', e.target.value); });
    on('ltrEmpName', 'input', function (e) { setFormField('empName', e.target.value); });
    on('ltrDesignation', 'input', function (e) { setFormField('designation', e.target.value); });
    on('ltrDepartment', 'input', function (e) { setFormField('department', e.target.value); });
    on('ltrFromDate', 'change', function (e) { setFormField('fromDate', e.target.value); });
    on('ltrToDate', 'change', function (e) { setFormField('toDate', e.target.value); });
    on('ltrReturnDate', 'change', function (e) { setFormField('returnDate', e.target.value); });
    on('ltrSignedBy', 'change', function (e) { setFormField('signedBy', e.target.value); });
    on('ltrReason', 'input', function (e) { setFormField('reason', e.target.value); });

    var codeInput = doc.getElementById('ltrEmpCode');
    var suggestBox = doc.getElementById('ltrEmpSuggest');
    if (codeInput) {
      codeInput.addEventListener('input', function (e) {
        var val = e.target.value;
        setFormField('empCode', val);
        if (suggestBox) {
          var sHtml = val.trim() ? renderSuggestionsHtml(val) : '';
          suggestBox.innerHTML = sHtml;
          suggestBox.classList.toggle('open', Boolean(sHtml));
        }
      });
      codeInput.addEventListener('focus', function (e) {
        if (suggestBox) {
          var sHtml = renderSuggestionsHtml(e.target.value);
          suggestBox.innerHTML = sHtml;
          suggestBox.classList.toggle('open', Boolean(sHtml));
        }
      });
      codeInput.addEventListener('blur', function () {
        setTimeout(function () {
          if (suggestBox) suggestBox.classList.remove('open');
        }, 180);
      });
    }

    if (suggestBox) {
      suggestBox.addEventListener('mousedown', function (e) {
        var item = e.target && e.target.closest ? e.target.closest('[data-emp-code]') : null;
        if (!item) return;
        e.preventDefault();
        var chosen = item.getAttribute('data-emp-code') || '';
        setFormField('empCode', chosen);
        if (codeInput) codeInput.value = state.form.empCode;
        suggestBox.classList.remove('open');
        refreshPreviewAndCalculatedDom();
      });
    }

    container.addEventListener('input', function (e) {
      if (e.target && e.target.id === 'ltrHistorySearchInput') {
        state.historySearch = e.target.value || '';
        var tbodyWrap = doc.getElementById('ltrHistoryBodyWrap');
        if (tbodyWrap) {
          var rows = tbodyWrap.querySelector('tbody');
          if (rows) {
            var filtered = getFilteredHistory();
            rows.innerHTML = filtered.length ? filtered.map(function (r) {
              var period = formatDateDDMMYY(r.fromDate) + ' → ' + formatDateDDMMYY(r.toDate);
              return (
                '<tr>' +
                  '<td><div style="font-weight:700">' + esc(r.empCode) + ' · ' + esc(r.empName) + '</div><div style="font-size:11px;color:#64748b">' + esc([r.designation, r.department].filter(Boolean).join(' · ')) + '</div></td>' +
                  '<td><div>' + esc(period) + '</div><div style="font-size:11px;color:#64748b">Return: ' + esc(formatDateDDMMYYYY(r.returnDate)) + '</div></td>' +
                  '<td style="font-weight:800;color:#4f46e5">' + esc(r.days) + ' d</td>' +
                  '<td><div>' + esc(r.signedBy || '—') + '</div><div style="font-size:11px;color:#64748b">' + esc(r.reason || '') + '</div></td>' +
                  '<td style="white-space:nowrap">' +
                    '<button type="button" class="ltr-btn ltr-btn-xs" data-ltr-action="load" data-ltr-id="' + esc(r.id) + '">Open</button> ' +
                    '<button type="button" class="ltr-btn ltr-btn-xs" data-ltr-action="download" data-ltr-id="' + esc(r.id) + '">.doc</button> ' +
                    '<button type="button" class="ltr-btn ltr-btn-xs" style="color:#b91c1c;border-color:#fecaca" data-ltr-action="delete" data-ltr-id="' + esc(r.id) + '">Del</button>' +
                  '</td>' +
                '</tr>'
              );
            }).join('') : '<tr><td colspan="5" style="text-align:center;padding:20px;color:#64748b">No matching leave records.</td></tr>';
          }
        }
      }
    });

    container.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('[data-ltr-action]') : null;
      if (!btn) return;
      var action = btn.getAttribute('data-ltr-action');
      var id = btn.getAttribute('data-ltr-id');
      if (action === 'load') {
        loadRecordIntoForm(id);
      } else if (action === 'download') {
        var rec = state.records.find(function (r) { return r && r.id === id; });
        if (rec) downloadRecordDoc(rec);
      } else if (action === 'delete') {
        deleteRecord(id);
      }
    });
  }

  function setupListeners() {
    if (window.__ATPL_LETTERS_LISTENERS__) return;
    window.__ATPL_LETTERS_LISTENERS__ = true;

    try {
      window.addEventListener('storage', function (ev) {
        if (ev && (ev.key === STORAGE_KEY || ev.key === TOMBSTONE_KEY)) {
          loadFromLocalStorage();
          renderUI();
        }
      });
    } catch (_) {}

    try {
      if (typeof window.BroadcastChannel === 'function') {
        var ch = new window.BroadcastChannel(CHANNEL_NAME);
        ch.onmessage = function (ev) {
          var d = ev && ev.data;
          if (!d) return;
          if (d.type === 'leave_letter_saved' || d.type === 'leave_letter_deleted') {
            loadFromLocalStorage();
            renderUI();
          }
        };
      }
    } catch (_) {}

    try {
      if (typeof window.EventSource === 'function' && window.location && /^https?:/.test(window.location.protocol)) {
        var es = new window.EventSource('/api/sync/events');
        es.addEventListener('leave_letter_saved', function (ev) {
          try {
            var rec = JSON.parse(ev.data || '{}');
            if (rec && rec.id) {
              mergeServerRecords([rec]);
              renderUI();
            }
          } catch (_) {}
        });
        es.addEventListener('leave_letter_deleted', function (ev) {
          try {
            var d = JSON.parse(ev.data || '{}');
            if (d && d.id) {
              state.tombstones[d.id] = d.deleted_at || new Date().toISOString();
              state.records = state.records.filter(function (r) { return r && r.id !== d.id; });
              saveToLocalStorage();
              renderUI();
            }
          } catch (_) {}
        });
      }
    } catch (_) {}
  }

  function boot() {
    loadFromLocalStorage();
    recalcFormDates({ forceAutoReturn: true });
    setupListeners();
    if (window.document && window.document.readyState === 'loading') {
      window.document.addEventListener('DOMContentLoaded', function () {
        renderUI();
        syncNow();
      }, { once: true });
    } else {
      renderUI();
      syncNow();
    }
  }

  window.ATPLLettersManager = {
    SIGNED_BY_OPTIONS: SIGNED_BY_OPTIONS.slice(),
    LETTER_TYPES: LETTER_TYPES.slice(),
    state: state,
    diffDaysInclusive: diffDaysInclusive,
    addDaysISO: addDaysISO,
    formatDateDDMMYYYY: formatDateDDMMYYYY,
    formatDateDDMMYY: formatDateDDMMYY,
    findEmployeeByCode: findEmployeeByCode,
    searchEmployees: searchEmployees,
    setFormField: setFormField,
    resetReturnDateAuto: resetReturnDateAuto,
    buildLetterInnerHtml: buildLetterInnerHtml,
    buildDownloadDocumentHtml: buildDownloadDocumentHtml,
    saveCurrentLetter: saveCurrentLetter,
    downloadRecordDoc: downloadRecordDoc,
    printRecordLetter: printRecordLetter,
    loadRecordIntoForm: loadRecordIntoForm,
    startNewLetter: startNewLetter,
    deleteRecord: deleteRecord,
    getEmployeeHistory: getEmployeeHistory,
    getFilteredHistory: getFilteredHistory,
    renderUI: renderUI,
    syncNow: syncNow
  };

  boot();
})(typeof window !== 'undefined' ? window : globalThis);
