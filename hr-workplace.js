/* Arora Textiles — Employee Master additional fields extension.
   Existing core Employee Master behaviour is preserved. */
(function () {
  'use strict';

  var EXTRA_FIELDS = [
    { key: 'aadhaar_no', label: 'Aadhaar Number', type: 'text', placeholder: 'Enter Aadhaar Number' },
    { key: 'phone_no', label: 'Phone Number', type: 'tel', placeholder: 'Enter Phone Number' },
    { key: 'qualification', label: 'Qualification', type: 'text', placeholder: 'Enter Qualification' },
    { key: 'present_address', label: 'Present Address', type: 'textarea', placeholder: 'Enter Present Address' },
    { key: 'permanent_address', label: 'Permanent Address', type: 'textarea', placeholder: 'Enter Permanent Address' },
    { key: 'marital_status', label: 'Marital Status', type: 'select', options: ['', 'SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED', 'SEPARATED'] },
    { key: 'nominee_name', label: 'Nominee Name', type: 'text', placeholder: 'Enter Nominee Name' },
    { key: 'nominee_relation', label: 'Relationship with Nominee', type: 'text', placeholder: 'e.g. Wife / Husband / Father / Mother / Son / Daughter' },
    { key: 'nominee_dob', label: 'Nominee DOB', type: 'date', placeholder: '' }
  ];

  var CORE_16 = [
    'emp_id','name','father','dob','doj','pf_no','esi_no','bank_name',
    'ifsc','account_no','gender','dept','cat1','basic','hra','gross'
  ];

  var VIEW_FIELDS = [
    ['emp_id','Employee Code'],['name','Employee Name'],['father',"Father's Name"],
    ['dob','D.O.B'],['doj','D.O.J'],['pf_no','PF No.'],['esi_no','ESI No.'],
    ['bank_name','Bank Name'],['ifsc','IFSC Code'],['account_no','Account No.'],
    ['gender','Gender'],['dept','Department'],['desig','Designation'],['cat1','Category 01'],
    ['cat2','Category 02'],['basic','Basic'],['hra','HRA'],['gross','Gross'],
    ['aadhaar_no','Aadhaar Number'],['phone_no','Phone Number'],['qualification','Qualification'],
    ['present_address','Present Address'],['permanent_address','Permanent Address'],
    ['marital_status','Marital Status'],['nominee_name','Nominee Name'],
    ['nominee_relation','Relationship with Nominee'],['nominee_dob','Nominee DOB']
  ];

  window.ARORA_EMP_EXTRA_FIELDS = EXTRA_FIELDS.slice();
  window.ARORA_EMP_EXTRA_EXCEL_ALIASES = {
    aadhaar_no: ['aadhaar', 'aadhaar no', 'aadhaar number', 'aadhar', 'aadhar no'],
    phone_no: ['phone', 'phone no', 'phone number', 'mobile', 'mobile no', 'mobile number'],
    qualification: ['qualification', 'education', 'educational qualification'],
    present_address: ['present address', 'current address'],
    permanent_address: ['permanent address', 'parmanent address'],
    marital_status: ['marital status', 'marital'],
    nominee_name: ['nominee', 'nominee name'],
    nominee_relation: ['relationship with nominee', 'relation with nominee', 'nominee relation'],
    nominee_dob: ['nominee dob', 'dob of nominee', 'nominee date of birth']
  };

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function getCurrentEmployee() {
    try {
      if (typeof EM !== 'undefined' && EM.editIdx >= 0 && EM.data && EM.data[EM.editIdx]) return EM.data[EM.editIdx];
    } catch (e) {}
    return {};
  }

  function getEmployeeCodeFromForm() {
    var row = document.getElementById('emSingleRow');
    if (!row) return '';
    var first = row.querySelector('input,select,textarea');
    return first ? String(first.value || '').trim() : '';
  }

  function saveMaster() {
    try {
      if (typeof EM !== 'undefined' && EM.data) localStorage.setItem('AroraTextilesEmployeeMasterV3', JSON.stringify(EM.data));
    } catch (e) {}
  }

  function injectCss() {
    if (document.getElementById('aroraEmpExtraCss')) return;
    var style = document.createElement('style');
    style.id = 'aroraEmpExtraCss';
    style.textContent = [
      '#aroraEmpExtraWrap{display:block;min-width:100%;padding:12px 16px 16px;background:#0f172a;border-top:1px solid #334155;}',
      '#aroraEmpExtraToggle{display:inline-flex;align-items:center;gap:7px;padding:8px 14px;border:1px solid #6366f1;border-radius:8px;background:#312e81;color:#fff;font-size:11px;font-weight:800;cursor:pointer;}',
      '#aroraEmpExtraToggle:hover{background:#3730a3;}',
      '#aroraEmpExtraPanel{display:none;margin-top:12px;padding:14px;border:1px solid #334155;border-radius:10px;background:#111827;}',
      '#aroraEmpExtraPanel.open{display:block;}',
      '#aroraEmpExtraTitle{font-size:12px;font-weight:800;color:#f1f5f9;margin-bottom:12px;}',
      '.aroraEmpExtraField{display:block;margin-bottom:11px;}',
      '.aroraEmpExtraField:last-child{margin-bottom:0;}',
      '.aroraEmpExtraField label{display:block;margin-bottom:5px;font-size:9px;font-weight:800;letter-spacing:.7px;text-transform:uppercase;color:#94a3b8;}',
      '.aroraEmpExtraField input,.aroraEmpExtraField textarea,.aroraEmpExtraField select{display:block;width:100%;box-sizing:border-box;padding:9px 10px;border:1px solid #475569;border-radius:7px;background:#0b1220;color:#f8fafc;font-size:12px;outline:none;}',
      '.aroraEmpExtraField textarea{min-height:74px;resize:vertical;}',
      '.aroraEmpExtraField input:focus,.aroraEmpExtraField textarea:focus,.aroraEmpExtraField select:focus{border-color:#6366f1;box-shadow:0 0 0 2px rgba(99,102,241,.15);}',
      '#aroraEmpExtraHint{margin-top:9px;font-size:9px;color:#64748b;}',
      '#aroraEmpViewOverlay{position:fixed;inset:0;z-index:100005;display:none;align-items:center;justify-content:center;background:rgba(2,6,23,.82);padding:18px;}',
      '#aroraEmpViewCard{width:min(760px,96vw);max-height:92vh;overflow:hidden;display:flex;flex-direction:column;background:#fff;border-radius:15px;box-shadow:0 30px 90px rgba(0,0,0,.55);}',
      '#aroraEmpViewHead{padding:15px 18px;background:linear-gradient(135deg,#075985,#0ea5e9);color:#fff;display:flex;align-items:center;gap:10px;}',
      '#aroraEmpViewHead strong{font-size:15px;}#aroraEmpViewHead small{display:block;font-size:10px;opacity:.85;margin-top:2px;}',
      '#aroraEmpViewClose{margin-left:auto;width:31px;height:31px;border:0;border-radius:50%;background:rgba(255,255,255,.18);color:#fff;font-size:18px;cursor:pointer;}',
      '#aroraEmpViewBody{overflow:auto;padding:16px 18px;background:#f8fafc;}',
      '.aroraViewField{display:block;margin-bottom:10px;}',
      '.aroraViewField label{display:block;margin-bottom:4px;font-size:9px;font-weight:900;letter-spacing:.6px;text-transform:uppercase;color:#64748b;}',
      '.aroraViewValue{min-height:38px;padding:9px 11px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;color:#0f172a;font-size:12px;white-space:pre-wrap;word-break:break-word;}',
      '#aroraEmpViewFoot{padding:12px 18px;border-top:1px solid #e2e8f0;background:#fff;display:flex;justify-content:flex-end;}',
      '#aroraEmpViewFoot button{padding:8px 14px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;font-weight:800;cursor:pointer;}'
    ].join('');
    document.head.appendChild(style);
  }

  function fieldHtml(field, value) {
    var id = 'arora_emp_extra_' + field.key;
    var h = '<div class="aroraEmpExtraField"><label for="' + id + '">' + esc(field.label) + '</label>';
    if (field.type === 'textarea') {
      h += '<textarea id="' + id + '" placeholder="' + esc(field.placeholder || '') + '">' + esc(value) + '</textarea>';
    } else if (field.type === 'select') {
      h += '<select id="' + id + '">';
      field.options.forEach(function (opt) {
        h += '<option value="' + esc(opt) + '"' + (String(value) === String(opt) ? ' selected' : '') + '>' + esc(opt || 'Select Marital Status') + '</option>';
      });
      h += '</select>';
    } else {
      h += '<input id="' + id + '" type="' + field.type + '" value="' + esc(value) + '" placeholder="' + esc(field.placeholder || '') + '">';
    }
    h += '</div>';
    return h;
  }

  function fillPanelFromEmployee() {
    var emp = getCurrentEmployee();
    EXTRA_FIELDS.forEach(function (f) {
      var el = document.getElementById('arora_emp_extra_' + f.key);
      if (el) el.value = emp[f.key] == null ? '' : emp[f.key];
    });
  }

  function buildInlinePanel() {
    var modal = document.getElementById('emModal');
    var singlePanel = document.getElementById('emTabPanel-single');
    var singleRow = document.getElementById('emSingleRow');
    if (!modal || !singlePanel || !singleRow || getComputedStyle(modal).display === 'none') return;

    var existing = document.getElementById('aroraEmpExtraWrap');
    if (existing) { fillPanelFromEmployee(); return; }

    var wrap = document.createElement('div');
    wrap.id = 'aroraEmpExtraWrap';
    var html = '<button type="button" id="aroraEmpExtraToggle">＋ View More / Fill More</button>' +
      '<div id="aroraEmpExtraPanel"><div id="aroraEmpExtraTitle">Additional Employee Details</div>';
    var emp = getCurrentEmployee();
    EXTRA_FIELDS.forEach(function (f) { html += fieldHtml(f, emp[f.key] == null ? '' : emp[f.key]); });
    html += '<div id="aroraEmpExtraHint">These fields are saved with this employee record.</div></div>';
    wrap.innerHTML = html;

    if (singleRow.nextSibling) singlePanel.insertBefore(wrap, singleRow.nextSibling);
    else singlePanel.appendChild(wrap);

    var toggle = document.getElementById('aroraEmpExtraToggle');
    var panel = document.getElementById('aroraEmpExtraPanel');
    toggle.addEventListener('click', function () {
      var open = !panel.classList.contains('open');
      panel.classList.toggle('open', open);
      toggle.textContent = open ? '− View Less' : '＋ View More / Fill More';
      if (open) fillPanelFromEmployee();
    });
  }

  function readExtraFields() {
    var out = {};
    EXTRA_FIELDS.forEach(function (f) {
      var el = document.getElementById('arora_emp_extra_' + f.key);
      out[f.key] = el ? String(el.value || '').trim() : '';
    });
    return out;
  }

  function attachToEmployee(code, editIdx, values) {
    try {
      if (typeof EM === 'undefined' || !EM.data) return;
      var idx = (typeof editIdx === 'number' && editIdx >= 0) ? editIdx : -1;
      if (idx < 0 && code) idx = EM.data.findIndex(function (e) { return String(e.emp_id || '').trim() === String(code).trim(); });
      if (idx >= 0 && EM.data[idx]) {
        Object.assign(EM.data[idx], values);
        saveMaster();
        if (typeof emFilter === 'function') emFilter();
        else if (typeof emRenderTable === 'function') emRenderTable();
      }
    } catch (e) {}
  }

  function updateExpectedColumns() {
    var bulk = document.getElementById('emTabPanel-bulk');
    if (!bulk) return;
    var full = 'Expected columns: Code | Name | Father | DOB | DOJ | PF No | ESI No | Bank | IFSC | Account | Gender | Dept | Category | Basic | HRA | Gross | Aadhaar Number | Phone Number | Qualification | Present Address | Permanent Address | Marital Status | Nominee Name | Relationship with Nominee | Nominee DOB';
    var nodes = bulk.querySelectorAll('div');
    for (var i = 0; i < nodes.length; i++) {
      var t = String(nodes[i].textContent || '').trim();
      if (t.indexOf('Expected columns:') === 0) {
        nodes[i].textContent = full;
        nodes[i].style.whiteSpace = 'normal';
        nodes[i].style.lineHeight = '1.7';
        break;
      }
    }
  }

  function buildViewOverlay() {
    if (document.getElementById('aroraEmpViewOverlay')) return;
    var o = document.createElement('div');
    o.id = 'aroraEmpViewOverlay';
    o.innerHTML = '<div id="aroraEmpViewCard">' +
      '<div id="aroraEmpViewHead"><div><strong>👤 Employee Complete Details</strong><small id="aroraEmpViewSub"></small></div><button type="button" id="aroraEmpViewClose">×</button></div>' +
      '<div id="aroraEmpViewBody"></div>' +
      '<div id="aroraEmpViewFoot"><button type="button" id="aroraEmpViewClose2">Close</button></div></div>';
    document.body.appendChild(o);
    function closeView(){ o.style.display = 'none'; }
    document.getElementById('aroraEmpViewClose').onclick = closeView;
    document.getElementById('aroraEmpViewClose2').onclick = closeView;
    o.addEventListener('click', function(e){ if (e.target === o) closeView(); });
  }

  function openVerticalView(idx) {
    try {
      if (typeof EM === 'undefined' || !EM.data || !EM.data[idx]) return;
      injectCss(); buildViewOverlay();
      var e = EM.data[idx];
      document.getElementById('aroraEmpViewSub').textContent = (e.name || 'Employee') + ' • Code: ' + (e.emp_id || '—');
      var h = '';
      VIEW_FIELDS.forEach(function (p) {
        var val = e[p[0]];
        if (val === undefined || val === null || val === '') val = '—';
        h += '<div class="aroraViewField"><label>' + esc(p[1]) + '</label><div class="aroraViewValue">' + esc(val) + '</div></div>';
      });
      document.getElementById('aroraEmpViewBody').innerHTML = h;
      document.getElementById('aroraEmpViewOverlay').style.display = 'flex';
    } catch (err) {}
  }

  function installViewOverride() {
    if (window.__aroraVerticalViewInstalled) return;
    if (typeof window.emViewEmp !== 'function') return;
    window.__aroraOriginalViewEmp = window.emViewEmp;
    window.emViewEmp = function (idx) { openVerticalView(idx); };
    window.__aroraVerticalViewInstalled = true;
  }

  function installExtendedPaste() {
    if (window.__aroraExtendedPasteInstalled) return;
    if (typeof window.emParseBulkPaste !== 'function') return;
    var original = window.emParseBulkPaste;
    window.emParseBulkPaste = function () {
      var area = document.getElementById('emBulkPasteArea');
      var raw = area ? String(area.value || '').trim() : '';
      if (!raw) return original.apply(this, arguments);
      var rows = raw.replace(/\r/g, '').split('\n').filter(function (x) { return x.trim(); }).map(function (x) { return x.split('\t'); });
      if (!rows.length) return original.apply(this, arguments);

      var firstLower = rows[0].join('|').toLowerCase();
      var hasExtraHeader = /aadhaar|aadhar|phone|mobile|qualification|present address|permanent address|nominee/.test(firstLower);
      var has25Cols = rows.some(function (r) { return r.length >= 25; });
      if (!hasExtraHeader && !has25Cols) return original.apply(this, arguments);

      var start = hasExtraHeader ? 1 : 0;
      var emps = [];
      for (var r = start; r < rows.length; r++) {
        var row = rows[r];
        if (!row.some(function (x) { return String(x || '').trim(); })) continue;
        var e = {};
        CORE_16.forEach(function (k, i) {
          var val = row[i] == null ? '' : String(row[i]).trim();
          if (k === 'basic' || k === 'hra' || k === 'gross') e[k] = parseFloat(val.replace(/,/g, '')) || 0;
          else e[k] = val;
        });
        e.desig = '';
        e.cat2 = '';
        EXTRA_FIELDS.forEach(function (f, i) { e[f.key] = row[16 + i] == null ? '' : String(row[16 + i]).trim(); });
        if (e.emp_id || e.name) emps.push(e);
      }
      window.EM_BULK_ROWS = emps;
      if (typeof renderBulkPreview === 'function') renderBulkPreview();
      var btn = document.getElementById('emBulkSaveBtn');
      if (btn) { btn.disabled = emps.length === 0; btn.style.opacity = emps.length ? '1' : '0.4'; }
      var info = document.getElementById('emPasteInfo');
      if (info) info.textContent = '✅ ' + emps.length + ' rows ready — additional employee fields included.';
    };
    window.__aroraExtendedPasteInstalled = true;
  }

  document.addEventListener('click', function (ev) {
    var btn = ev.target && ev.target.closest ? ev.target.closest('button') : null;
    if (!btn) return;
    var modal = document.getElementById('emModal');
    if (!modal || getComputedStyle(modal).display === 'none') return;
    var text = String(btn.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (text === 'save' || text.indexOf('save employee') >= 0 || text.indexOf('💾 save') >= 0) {
      var panel = document.getElementById('aroraEmpExtraPanel');
      if (!panel) return;
      var code = getEmployeeCodeFromForm();
      var editIdx = (typeof EM !== 'undefined' && typeof EM.editIdx === 'number') ? EM.editIdx : -1;
      var values = readExtraFields();
      setTimeout(function () { attachToEmployee(code, editIdx, values); }, 80);
    }
  }, true);

  function monitor() {
    updateExpectedColumns();
    installViewOverride();
    installExtendedPaste();
    var modal = document.getElementById('emModal');
    if (modal && getComputedStyle(modal).display !== 'none') buildInlinePanel();
  }

  function boot() {
    injectCss();
    buildViewOverlay();
    monitor();
    var obs = new MutationObserver(function () { monitor(); });
    obs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
    setInterval(monitor, 500);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
