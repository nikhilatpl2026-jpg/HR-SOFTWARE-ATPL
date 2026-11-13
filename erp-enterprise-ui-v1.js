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
  checkproduction:'Salary Payroll / Check Production',
  bankverify:'Salary Payroll / Bank A/C Verifier',
  lookup:'Salary Payroll / Salary Lookup',
  dol:'Employee / Date of Leaving',
  dolverify:'Employee / DOL Verifier',
  ff:'Employee / F&F Settlement',
  empmaster:'Employee / Employee Master',
  servicehistory:'Employee / Service History',
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
    'body{background:#f8fafc!important;color:#0f172a!important;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif!important;}',
    '.header{height:56px!important;background:#ffffff!important;border-bottom:1px solid #e2e8f0!important;box-shadow:0 1px 3px rgba(0,0,0,0.03)!important;padding:0 20px!important;display:flex!important;align-items:center!important;justify-content:space-between!important;}',
    '.logo-box{background:linear-gradient(135deg,#4f46e5,#6366f1)!important;box-shadow:none!important;border-radius:10px!important;width:34px!important;height:34px!important;display:flex!important;align-items:center!important;justify-content:center!important;font-size:18px!important;}',
    '.logo-name{color:#0f172a!important;font-size:14px!important;font-weight:800!important;letter-spacing:-0.2px!important;}.logo-name span{color:#4f46e5!important;font-weight:900!important;}.logo-sub{color:#64748b!important;font-size:9px!important;letter-spacing:.3px!important;font-weight:500!important;}',
    /* ── Hide items highlighted in yellow by user ── */
    '#testBtn,#cloudSyncModalBtn,#dsBtn,#deepScanPanel,#atplDurableEverythingBadge,#atplAccountCloudBadge,#atplCloudSyncBadge,#vn-test,#cat-dash #vn-test{display:none!important;}',
    '#atplCloudFilesBadge{display:none!important;}',
    /* ── Header right actions & badges ── */
    '.header-right{display:flex!important;align-items:center!important;gap:10px!important;}',
    '#crossSyncBtn,.erp-cross-sync-btn{display:inline-flex!important;align-items:center!important;gap:6px!important;padding:6px 14px!important;background:#f0f9ff!important;border:1px solid #bae6fd!important;color:#0284c7!important;border-radius:20px!important;font-size:11px!important;font-weight:700!important;cursor:pointer!important;transition:all .15s ease!important;}',
    '#crossSyncBtn:hover,.erp-cross-sync-btn:hover{background:#e0f2fe!important;border-color:#7dd3fc!important;color:#0369a1!important;transform:translateY(-1px)!important;box-shadow:0 2px 5px rgba(2,132,199,0.12)!important;}',
    '.storage-badge{display:inline-flex!important;align-items:center!important;gap:6px!important;padding:5px 12px!important;background:#f8fafc!important;border:1px solid #e2e8f0!important;color:#475569!important;font-size:11px!important;font-weight:600!important;border-radius:20px!important;box-shadow:none!important;}',
    '.storage-badge .dot{width:7px!important;height:7px!important;background:#22c55e!important;border-radius:50%!important;box-shadow:0 0 0 2px rgba(34,197,94,0.2)!important;}',
    /* ── Clean Sidebar & Panel Toggles ── */
    '#vnav{width:228px!important;background:#ffffff!important;border-right:1px solid #e2e8f0!important;box-shadow:1px 0 3px rgba(0,0,0,0.02)!important;color:#334155!important;transition:width .22s ease,opacity .2s ease!important;}',
    '#vnav.nav-hidden{width:0!important;min-width:0!important;max-width:0!important;padding:0!important;border-right:none!important;opacity:0!important;pointer-events:none!important;overflow:hidden!important;}',
    '.sidebar{transition:width .22s ease,opacity .2s ease!important;}',
    '.sidebar.sidebar-hidden{width:0!important;min-width:0!important;max-width:0!important;padding:0!important;border-right:none!important;box-shadow:none!important;opacity:0!important;pointer-events:none!important;overflow:hidden!important;}',
    '.erp-header-toggle-btn{display:inline-flex!important;align-items:center!important;gap:7px!important;padding:6px 13px!important;background:#ffffff!important;border:1px solid #cbd5e1!important;color:#334155!important;border-radius:8px!important;font-size:12px!important;font-weight:700!important;cursor:pointer!important;transition:all .15s ease!important;box-shadow:0 1px 2px rgba(0,0,0,0.03)!important;}',
    '.erp-header-toggle-btn:hover{background:#f1f5f9!important;border-color:#94a3b8!important;color:#0f172a!important;transform:translateY(-1px)!important;}',
    '.erp-header-toggle-btn.active{background:#ede9fe!important;border-color:#818cf8!important;color:#4338ca!important;box-shadow:0 1px 4px rgba(79,70,229,0.18)!important;}',
    '.erp-header-toggle-btn.collapsed{background:#f8fafc!important;border-color:#e2e8f0!important;color:#64748b!important;}',
    '.erp-toggle-count-badge{padding:1px 6px!important;border-radius:10px!important;font-size:10px!important;font-weight:800!important;background:#4f46e5!important;color:#ffffff!important;}',
    '#sidebarToggle{display:none!important;}',
    '#vnav>div:first-child{padding:16px 14px 10px!important;border-bottom:1px solid #f1f5f9!important;background:#ffffff!important;}',
    '#vnav>div:first-child>div{color:#94a3b8!important;font-size:9px!important;letter-spacing:1px!important;font-weight:700!important;}',
    '.vnav-group{border-bottom:1px solid #f1f5f9!important;padding:6px 0!important;}',
    '.vnav-cat{padding:8px 14px!important;color:#64748b!important;font-size:10px!important;letter-spacing:.6px!important;font-weight:800!important;text-transform:uppercase!important;}',
    '.vnav-cat:hover{color:#0f172a!important;background:#f8fafc!important;}',
    '.vnav-arrow{color:#94a3b8!important;}',
    '.vitem{margin:2px 8px!important;padding:8px 12px!important;border-left:0!important;border-radius:8px!important;color:#475569!important;font-size:12px!important;font-weight:600!important;gap:9px!important;transition:all .15s ease!important;}',
    '.vitem:hover{color:#4338ca!important;background:#f5f3ff!important;}',
    '.vitem.active{color:#4338ca!important;background:#ede9fe!important;font-weight:800!important;box-shadow:inset 3px 0 0 #4f46e5!important;}',
    '.vi{width:18px!important;font-size:13px!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;}',
    '.vbadge{font-size:9px!important;padding:2px 6px!important;border-radius:12px!important;font-weight:700!important;}',
    /* ── Content & ERP Workspace ── */
    '.content{background:#f8fafc!important;}',
    '.page-top{margin:16px 24px 0!important;padding:18px 24px!important;border:1px solid #e2e8f0!important;border-radius:14px!important;background:#ffffff!important;box-shadow:0 1px 3px rgba(0,0,0,0.03)!important;}',
    '.page-title{font-size:18px!important;font-weight:800!important;color:#0f172a!important;letter-spacing:-0.3px!important;}.page-sub{color:#64748b!important;font-size:12px!important;margin-top:3px!important;}',
    /* ── Clean Metric Cards & Inputs ── */
    '.stats{margin:14px 24px 0!important;padding:0!important;background:transparent!important;border:0!important;gap:12px!important;}',
    '.stat{flex:1!important;min-height:64px!important;background:#ffffff!important;border:1px solid #e2e8f0!important;border-radius:12px!important;padding:12px 16px!important;box-shadow:0 1px 3px rgba(0,0,0,0.02)!important;}',
    '.stat-val{color:#4338ca!important;font-size:22px!important;font-weight:800!important;}.stat-lbl{color:#64748b!important;font-size:11px!important;font-weight:600!important;}',
    '.card.info,.card.safe,.card.warn{background:#ffffff!important;border:1px solid #e2e8f0!important;border-radius:12px!important;box-shadow:0 1px 3px rgba(0,0,0,0.02)!important;padding:14px 18px!important;}',
    '.card.info .card-val{color:#4f46e5!important;font-weight:800!important;}',
    '.card.safe .card-val{color:#059669!important;font-weight:800!important;}',
    '.card.warn .card-val{color:#d97706!important;font-weight:800!important;}',
    '.card-lbl{color:#64748b!important;font-size:11px!important;font-weight:600!important;text-transform:uppercase!important;letter-spacing:0.5px!important;margin-top:2px!important;}',
    /* ── Form Inputs, Selects, Buttons ── */
    'input[type="text"],input[type="search"],input[type="password"],input[type="date"],select{border:1px solid #cbd5e1!important;border-radius:8px!important;padding:7px 12px!important;font-size:12px!important;background:#ffffff!important;color:#0f172a!important;transition:border-color .15s ease, box-shadow .15s ease!important;}',
    'input:focus,select:focus{border-color:#6366f1!important;outline:none!important;box-shadow:0 0 0 3px rgba(99,102,241,0.15)!important;}',
    '.cmd-bar{margin:14px 24px 0!important;padding:14px 20px!important;border:1px solid #e2e8f0!important;border-radius:14px!important;background:#ffffff!important;box-shadow:0 1px 3px rgba(0,0,0,0.02)!important;}',
    '.cmd-file-filter{margin:12px 24px 0!important;padding:8px 14px!important;border:1px solid #e2e8f0!important;border-radius:10px!important;background:#ffffff!important;}',
    '.out-tabs{margin:12px 24px 0!important;border:1px solid #e2e8f0!important;border-radius:12px 12px 0 0!important;background:#ffffff!important;}',
    '.out-pane{margin:0 24px 16px!important;background:#ffffff!important;border:1px solid #e2e8f0!important;border-top:0!important;border-radius:0 0 12px 12px!important;}',
    '.dl-bar{margin:0 24px 16px!important;border-radius:0 0 12px 12px!important;border:1px solid #e2e8f0!important;border-top:0!important;}',
    '.tbl-scroll,.log-scroll{background:#ffffff!important;}',
    'th{background:#f8fafc!important;color:#475569!important;border-color:#e2e8f0!important;font-weight:700!important;font-size:11px!important;}',
    'td{border-color:#f1f5f9!important;font-size:12px!important;}',
    '.audit-block-title{background:#f8fafc!important;color:#334155!important;border-bottom:1px solid #e2e8f0!important;}',
    '.atable th{background:#f8fafc!important;color:#64748b!important;border-bottom:1px solid #e2e8f0!important;}',
    '.audit-block{border:1px solid #e2e8f0!important;border-radius:12px!important;overflow:hidden!important;box-shadow:none!important;}',
    '.dl-bar{background:#ffffff!important;border-top:1px solid #e2e8f0!important;}',
    '.erp-breadcrumb{display:flex;align-items:center;gap:7px;margin-left:18px;padding-left:18px;border-left:1px solid #e2e8f0;min-width:0;color:#94a3b8;font-size:11px;font-weight:600;white-space:nowrap;}',
    '.erp-breadcrumb .erp-bc-parent{color:#64748b;font-weight:600;}.erp-breadcrumb .erp-bc-current{color:#0f172a;font-weight:800;}.erp-breadcrumb .erp-bc-sep{color:#cbd5e1;}',
    '.erp-header-user{display:flex;align-items:center;gap:7px;padding:5px 10px;border:1px solid #e2e8f0;border-radius:20px;background:#ffffff;color:#475569;font-size:11px;font-weight:700;}',
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
  if(!g.__ATPL_SERVICE_HISTORY_LOADER_V1__){
    g.__ATPL_SERVICE_HISTORY_LOADER_V1__=true;
    var sh=document.createElement('script');
    sh.src='service-history-v1.js?v=20261111-1';
    sh.async=true;
    sh.onerror=function(){console.error('[ATPL Service History] Module failed to load.');};
    (document.head||document.documentElement).appendChild(sh);
  }
  setTimeout(function(){installHeader();patchGoPage();cleanNav();setCrumb(activeName())},700);
  setTimeout(function(){patchGoPage();cleanNav()},2200);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})(window);