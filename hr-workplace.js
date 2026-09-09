/* Arora Textiles — Employee Master additional fields only.
   Existing Excel Paste and existing Employee Master logic are intentionally untouched. */
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
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function getCurrentEmployee() {
    try {
      if (typeof EM !== 'undefined' && EM.editIdx >= 0 && EM.data && EM.data[EM.editIdx]) {
        return EM.data[EM.editIdx];
      }
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
      if (typeof EM !== 'undefined' && EM.data) {
        localStorage.setItem('AroraTextilesEmployeeMasterV3', JSON.stringify(EM.data));
      }
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
      '#aroraEmpExtraHint{margin-top:9px;font-size:9px;color:#64748b;}'
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
        var text = opt || 'Select Marital Status';
        h += '<option value="' + esc(opt) + '"' + (String(value) === String(opt) ? ' selected' : '') + '>' + esc(text) + '</option>';
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
    injectCss();
    var modal = document.getElementById('emModal');
    var singlePanel = document.getElementById('emTabPanel-single');
    var singleRow = document.getElementById('emSingleRow');
    if (!modal || !singlePanel || !singleRow) return;
    if (getComputedStyle(modal).display === 'none') return;

    var existing = document.getElementById('aroraEmpExtraWrap');
    if (existing) {
      fillPanelFromEmployee();
      return;
    }

    var wrap = document.createElement('div');
    wrap.id = 'aroraEmpExtraWrap';
    var html = '<button type="button" id="aroraEmpExtraToggle">＋ View More / Fill More</button>' +
      '<div id="aroraEmpExtraPanel"><div id="aroraEmpExtraTitle">Additional Employee Details</div>';
    var emp = getCurrentEmployee();
    EXTRA_FIELDS.forEach(function (f) { html += fieldHtml(f, emp[f.key] == null ? '' : emp[f.key]); });
    html += '<div id="aroraEmpExtraHint">These fields are saved with the employee record. Existing Excel Paste remains unchanged.</div></div>';
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
      if (idx < 0 && code) {
        idx = EM.data.findIndex(function (e) {
          return String(e.emp_id || '').trim() === String(code).trim();
        });
      }
      if (idx >= 0 && EM.data[idx]) {
        Object.assign(EM.data[idx], values);
        saveMaster();
        if (typeof emFilter === 'function') emFilter();
        else if (typeof emRenderTable === 'function') emRenderTable();
      }
    } catch (e) {}
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
    var modal = document.getElementById('emModal');
    if (!modal || getComputedStyle(modal).display === 'none') return;
    buildInlinePanel();
  }

  function boot() {
    injectCss();
    monitor();
    var obs = new MutationObserver(function () { monitor(); });
    obs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
    setInterval(monitor, 500);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
