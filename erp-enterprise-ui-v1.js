/* ATPL Enterprise ERP Visual Layer V1
   Cosmetic only: makes the existing ERP feel closer to a clean modern enterprise HR/payroll product.
   No payroll/salary calculation logic is changed here. */
(function(g){'use strict';
if(!g||g.__ATPL_ENTERPRISE_UI_V1__)return;
g.__ATPL_ENTERPRISE_UI_V1__='2026.09.18-1';

var PAGE_NAMES={
  cmd:'Dashboard / Smart Commands',
  files:'Dashboard / All Files',
  sync:'Salary Payroll / Salary Sync',
  mamsalary:'Salary Payroll / Mam → Compliance',
  audit:'Salary Payroll / Salary Audit',
  machineaudit:'Salary Payroll / Machine Rate Audit',
  bankverify:'Salary Payroll / Bank A/C Verifier',
  lookup:'Salary Payroll / Salary Lookup',
  dol:'Employee / Date of Leaving',
  dolverify:'Employee / DOL Verifier',
  ff:'Employee / F&F Settlement',
  empmaster:'Employee / Employee Master',
  hrdocs:'Employee / HR Documents',
  esic:'Tools / ESIC DOL Filler',
  esictodol:'Compliance / ESIC → DOL',
  pftodol:'Compliance / PF → DOL'
};

function addCss(){
  if(document.getElementById('atpl-enterprise-ui-v1-style'))return;
  var s=document.createElement('style');
  s.id='atpl-enterprise-ui-v1-style';
  s.textContent=[
    'body{background:#f7f8fb!important;color:#111827!important;}',
    '.header{height:58px!important;background:#ffffff!important;border-bottom:1px solid #e5e7eb!important;box-shadow:0 1px 2px rgba(15,23,42,.03)!important;padding:0 18px!important;}',
    '.logo-box{background:linear-gradient(135deg,#4f46e5,#7c3aed)!important;box-shadow:none!important;border-radius:10px!important;}',
    '.logo-name{color:#111827!important;font-size:14px!important}.logo-name span{color:#4f46e5!important}.logo-sub{color:#94a3b8!important;font-size:8px!important;letter-spacing:.65px!important;}',
    '.header-right #dsBtn{background:#f5f3ff!important;border:1px solid #ddd6fe!important;color:#5b21b6!important;box-shadow:none!important;}',
    '.storage-badge{background:#f0fdf4!important;border:1px solid #bbf7d0!important;color:#15803d!important;box-shadow:none!important;}',
    '.storage-badge .dot{background:#22c55e!important;box-shadow:none!important;}',
    '#vnav{width:228px!important;background:#fbfbfc!important;border-right:1px solid #e5e7eb!important;box-shadow:4px 0 18px rgba(15,23,42,.025)!important;color:#334155!important;}',
    '#vnav>div:first-child{padding:17px 14px 10px!important;border-bottom:1px solid #eef0f3!important;background:#fff!important;}',
    '#vnav>div:first-child>div{color:#9ca3af!important;font-size:8px!important;letter-spacing:1.5px!important;}',
    '.vnav-group{border-bottom:1px solid #f0f1f4!important;padding:5px 0!important;}',
    '.vnav-cat{padding:8px 14px!important;color:#64748b!important;font-size:9px!important;letter-spacing:.8px!important;font-weight:800!important;}',
    '.vnav-cat:hover{color:#334155!important;background:#f8fafc!important;}',
    '.vnav-arrow{color:#94a3b8!important;}',
    '.vitem{margin:2px 8px!important;padding:8px 10px 8px 12px!important;border-left:0!important;border-radius:7px!important;color:#475569!important;font-size:11px!important;font-weight:600!important;gap:8px!important;}',
    '.vitem:hover{color:#312e81!important;background:#f5f3ff!important;border-left:0!important;}',
    '.vitem.active{color:#312e81!important;background:linear-gradient(90deg,#ede9fe,#f5f3ff)!important;border-left:0!important;box-shadow:inset 3px 0 0 #4f46e5!important;font-weight:800!important;}',
    '.vi{width:17px!important;font-size:12px!important;opacity:.9!important;}',
    '.vbadge{font-size:8px!important;padding:1px 5px!important;animation:none!important;}',
    '#sidebarToggle{color:#94a3b8!important;border-top:1px solid #eef0f3!important;background:#fff!important;}',
    '#sidebarToggle:hover{color:#4f46e5!important;}',
    '.content{background:#f7f8fb!important;}',
    '.page-top{margin:14px 16px 0!important;padding:16px!important;border:1px solid #e5e7eb!important;border-radius:12px!important;background:#fff!important;box-shadow:0 1px 2px rgba(15,23,42,.02)!important;}',
    '.page-title{font-size:17px!important;color:#111827!important}.page-sub{color:#64748b!important;}',
    '.stats{margin:12px 16px 0!important;padding:0!important;background:transparent!important;border:0!important;gap:8px!important;}',
    '.stat{flex:1!important;min-height:58px!important;background:#fff!important;border:1px solid #e5e7eb!important;border-radius:10px!important;padding:9px 12px!important;box-shadow:0 1px 2px rgba(15,23,42,.02)!important;}',
    '.stat-val{color:#312e81!important;font-weight:800!important}.stat-lbl{color:#64748b!important;}',
    '.cmd-bar{margin:14px 16px 0!important;border:1px solid #e5e7eb!important;border-radius:12px!important;background:#fff!important;}',
    '.cmd-file-filter{margin:12px 16px 0!important;border:1px solid #e5e7eb!important;border-radius:10px!important;background:#fff!important;}',
    '.out-tabs{margin:12px 16px 0!important;border:1px solid #e5e7eb!important;border-radius:10px 10px 0 0!important;background:#fff!important;}',
    '.out-pane{margin:0 16px 14px!important;background:#fff!important;border:1px solid #e5e7eb!important;border-top:0!important;border-radius:0 0 10px 10px!important;}',
    '.tbl-scroll,.log-scroll{background:#fff!important;}',
    'th{background:#f8fafc!important;color:#475569!important;border-color:#e5e7eb!important;font-weight:800!important;}',
    'td{border-color:#eef2f7!important;}',
    '.audit-block-title{background:#f8fafc!important;color:#334155!important;border-bottom:1px solid #e5e7eb!important;}',
    '.atable th{background:#f8fafc!important;color:#64748b!important;border-bottom:1px solid #e5e7eb!important;}',
    '.audit-block{border:1px solid #e5e7eb!important;border-radius:10px!important;overflow:hidden!important;box-shadow:none!important;}',
    '.dl-bar{background:#fff!important;border-top:1px solid #e5e7eb!important;}',
    '.erp-breadcrumb{display:flex;align-items:center;gap:7px;margin-left:18px;padding-left:18px;border-left:1px solid #e5e7eb;min-width:0;color:#94a3b8;font-size:10px;font-weight:700;white-space:nowrap;}',
    '.erp-breadcrumb .erp-bc-parent{color:#64748b}.erp-breadcrumb .erp-bc-current{color:#111827;font-weight:800}.erp-breadcrumb .erp-bc-sep{color:#cbd5e1;}',
    '.erp-header-user{display:flex;align-items:center;gap:7px;padding:5px 8px;border:1px solid #e5e7eb;border-radius:8px;background:#fff;color:#475569;font-size:10px;font-weight:700;}',
    '@media(max-width:900px){#vnav{width:190px!important}.erp-breadcrumb{display:none!important;}}'
  ].join('');
  document.head.appendChild(s);
}

function activeName(){
  var p=document.querySelector('.page.active');
  return p&&p.id?p.id.replace(/^page-/,''):'cmd';
}
function setCrumb(name){
  var bc=document.getElementById('erpBreadcrumb');if(!bc)return;
  var label=PAGE_NAMES[name]||String(name||'Dashboard');
  var parts=label.split(' / ');
  bc.innerHTML='<span class="erp-bc-parent">'+(parts[0]||'ERP')+'</span><span class="erp-bc-sep">›</span><span class="erp-bc-current">'+(parts[1]||parts[0]||'Dashboard')+'</span>';
}
function installHeader(){
  var h=document.querySelector('.header');if(!h)return;
  if(!document.getElementById('erpBreadcrumb')){
    var bc=document.createElement('div');bc.id='erpBreadcrumb';bc.className='erp-breadcrumb';
    var right=h.querySelector('.header-right');h.insertBefore(bc,right||null);
  }
  setCrumb(activeName());
}
function patchGoPage(){
  if(typeof g.goPage!=='function'||g.goPage.__erpUiWrapped)return;
  var old=g.goPage;
  function wrapped(name){
    var r=old.apply(this,arguments);
    setTimeout(function(){setCrumb(name)},0);
    return r;
  }
  wrapped.__erpUiWrapped=true;wrapped.__original=old;g.goPage=wrapped;
}
function cleanNav(){
  var sub=document.getElementById('cat-sal');
  if(sub){
    var order=['vn-sync','vn-mamsalary','vn-audit','vn-machineaudit','vn-bankverify','vn-lookup'];
    var prev=null;
    order.forEach(function(id){var el=document.getElementById(id);if(!el||el.parentNode!==sub)return;if(prev&&prev.nextSibling!==el)sub.insertBefore(el,prev.nextSibling);prev=el});
  }
}
function boot(){
  addCss();installHeader();patchGoPage();cleanNav();
  setTimeout(function(){installHeader();patchGoPage();cleanNav();setCrumb(activeName())},700);
  setTimeout(function(){patchGoPage();cleanNav()},2200);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})(window);