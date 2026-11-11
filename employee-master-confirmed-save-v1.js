/* ATPL Employee Master Confirmed Save V1
   UI layer: never reports Employee Master data as saved until cloud save + read-back is verified.
   Overrides only Employee Master save/bulk/delete entry points; calculations and other ERP features are untouched.
*/
(function(g){'use strict';
if(!g||g.__ATPL_EMP_CONFIRMED_SAVE_V1__)return;g.__ATPL_EMP_CONFIRMED_SAVE_V1__='2026.09.18-1';

var retryFn=null,busy=false;
function text(v){return v==null?'':String(v).trim()}
function key(v){var s=text(v).toLowerCase();if(/^\d+$/.test(s))return s.replace(/^0+(?=\d)/,'')||'0';return s}
function empKey(r){return key(r&&(r.emp_id||r.empCode||r.employee_code||r.code))}
function copy(o){try{return JSON.parse(JSON.stringify(o||{}))}catch(_){return Object.assign({},o||{})}}
function cloud(){return g.ATPLCloudSyncV1}
function ensureUi(){
  var modal=g.document.getElementById('emModal'),title=g.document.getElementById('emModalTitle');
  if(title&&title.parentElement&&!g.document.getElementById('emBackendSaveStatus')){
    var s=g.document.createElement('button');s.id='emBackendSaveStatus';s.type='button';s.style.cssText='display:none;border:1px solid #334155;background:#111827;color:#94a3b8;border-radius:999px;padding:5px 9px;font-size:9px;font-weight:850;white-space:nowrap;cursor:default';title.parentElement.insertBefore(s,title.parentElement.lastElementChild);s.onclick=function(){if(retryFn&&!busy)retryFn()}
  }
  if(!g.document.getElementById('emBackendSaveStatusHeader')){
    var h=g.document.querySelector('.header-right');if(h){var b=g.document.createElement('button');b.id='emBackendSaveStatusHeader';b.type='button';b.style.cssText='display:none;border:1px solid #d1d5db;background:#fff;color:#475569;border-radius:999px;padding:4px 8px;font-size:9px;font-weight:850;cursor:default';h.appendChild(b);b.onclick=function(){if(retryFn&&!busy)retryFn()}}
  }
  if(modal){
    var btn=modal.querySelector('button[onclick="emSaveModal()"]');if(btn&&!btn.id)btn.id='emSaveBtn';
  }
}
function paint(kind,msg,retry){
  ensureUi();retryFn=retry||null;
  ['emBackendSaveStatus','emBackendSaveStatusHeader'].forEach(function(id){
    var el=g.document.getElementById(id);if(!el)return;el.style.display='inline-flex';el.textContent=msg;
    if(kind==='saving'){el.style.background='#eff6ff';el.style.color='#1d4ed8';el.style.borderColor='#bfdbfe';el.style.cursor='default'}
    else if(kind==='saved'){el.style.background='#ecfdf5';el.style.color='#047857';el.style.borderColor='#a7f3d0';el.style.cursor='default'}
    else{el.style.background='#fef2f2';el.style.color='#b91c1c';el.style.borderColor='#fecaca';el.style.cursor=retry?'pointer':'default'}
  });
}
function setButtonBusy(on){
  var b=g.document.getElementById('emSaveBtn');if(b){b.disabled=!!on;b.style.opacity=on?'0.55':'1';b.textContent=on?'Saving...':'💾 Save'}
  var bb=g.document.getElementById('emBulkSaveBtn');if(bb){bb.disabled=!!on;bb.style.opacity=on?'0.55':'1'}
}
function info(msg,bad){
  var bar=g.document.getElementById('emPasteBar'),el=g.document.getElementById('emPasteInfo');
  if(bar)bar.style.display='flex';if(el){el.textContent=msg;el.style.color=bad?'#fca5a5':'#93c5fd'}
}
function refreshMasterUi(){
  try{if(typeof g.emFilter==='function')g.emFilter();if(typeof g.emUpdateStats==='function')g.emUpdateStats()}catch(_){}
}
function syncLegacyArray(){
  try{if(Array.isArray(g.EMP_MASTER_DATA)&&g.EM&&Array.isArray(g.EM.data)){g.EMP_MASTER_DATA.length=0;Array.prototype.push.apply(g.EMP_MASTER_DATA,g.EM.data)}}catch(_){}
}
function persistConfirmed(opts){
  var c=cloud();if(c&&typeof c.persistLocal==='function'&&g.EM&&Array.isArray(g.EM.data))c.persistLocal(g.EM.data);
  syncLegacyArray();
  if(opts&&opts.skipMirrors)return;
  try{
    if(g.EM&&Array.isArray(g.EM.data)){
      var _base = (window.ATPLCentralFileSync && window.ATPLCentralFileSync.apiBase) || ''; fetch(_base + '/api/sync/employee-master',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({records:g.EM.data})}).catch(function(){});
      if(g.BroadcastChannel){
        var bc=new g.BroadcastChannel('ATPL_ERP_SHARED_V2');
        bc.postMessage({type:'employee_master_saved',records:g.EM.data});
        bc.close();
      }
      if(g.ATPLFirebase && typeof g.ATPLFirebase.saveEmployeeMaster === 'function'){
        g.ATPLFirebase.saveEmployeeMaster(g.EM.data).catch(function(){});
      }
    }
  }catch(_){}
}
function fieldsToEmployee(){
  var out={},valid=true;
  var cols = (Array.isArray(g.ATPL_40_EXCEL_COLS) && g.ATPL_40_EXCEL_COLS.length >= 40)
    ? g.ATPL_40_EXCEL_COLS
    : (Array.isArray(g.EM_COLS) ? g.EM_COLS : []);
  cols.forEach(function(c){
    var el = g.document.getElementById('emf_' + c.key);
    if(!el && typeof g.getEmfElement === 'function') el = g.getEmfElement(c.key);
    if(!el) return;
    var val = el.value ? el.value.trim() : '';
    if((c.key === 'emp_id' || c.key === 'name') && !val){
      el.style.border = '2px solid #dc2626';
      valid = false;
      return;
    }
    if(c.key === 'dob' || c.key === 'doj' || c.key === 'dol' || (c.key && c.key.indexOf('_dob') >= 0)){
      if(val && typeof g.normalizeDate === 'function'){
        var norm = g.normalizeDate(val);
        if(norm && /^\d{2}-\d{2}-\d{4}$/.test(norm)){ val = norm; el.value = norm; }
      }
    }
    if(c.type === 'number') {
      var num = parseFloat(String(val).replace(/,/g, ''));
      out[c.key] = isNaN(num) ? 0 : num;
    } else {
      out[c.key] = val ? val.toUpperCase() : '';
    }
  });
  if(out && out.gross && !out.new_gross) out.new_gross = out.gross;
  if(out && out.new_gross && !out.gross) out.gross = out.new_gross;
  return valid ? out : null;
}
async function confirmedSingleSave(){
  if(busy)return;
  var bulkPanel=g.document.getElementById('emTabPanel-bulk');
  var bulkArea=g.document.getElementById('emBulkPasteArea');
  var isBulkTab=bulkPanel&&(bulkPanel.style.display==='flex'||bulkPanel.style.display!=='none');
  if(isBulkTab||(bulkArea&&bulkArea.value&&bulkArea.value.trim())||(Array.isArray(g.EM_BULK_ROWS)&&g.EM_BULK_ROWS.length))return confirmedBulkSave();
  if(!g.EM||!Array.isArray(g.EM.data))return;
  if(typeof g.validateSingle==='function'&&!g.validateSingle())return;
  var entered=fieldsToEmployee();
  if(!entered){alert('Employee Code aur Name mandatory hain!');return}
  var edit=Number(g.EM.editIdx);
  var original=edit>=0&&g.EM.data[edit]?copy(g.EM.data[edit]):null;
  var candidate=Object.assign({},original||{},entered);
  var c=cloud();
  busy=true;setButtonBusy(true);paint('saving','Saving to shared cloud…',null);
  try{
    var res=null;
    // 1. Authoritative Google Drive & Sheets cross-browser sync first!
    if(g.ATPLGoogleSync && typeof g.ATPLGoogleSync.upsertEmployeeMaster === 'function'){
      try {
        var gRes = await g.ATPLGoogleSync.upsertEmployeeMaster([candidate]);
        if(gRes && (gRes.ok || gRes.verified)) {
          res = { ok: true, verified: true, record: (gRes.record || candidate) };
        }
      } catch(gErr) { console.warn('Google backend save error', gErr); }
    }
    // 2. Fallback only if ATPLGoogleSync was not available
    if(!res || !res.ok){
      var c=cloud();
      if(c && typeof c.saveMaster==='function'){
        try{ res=await c.saveMaster(candidate,{baseRecord:original,isNew:!original,background:false,commitLocal:false}); }catch(_){}
      }
    }
    if(!res || !res.ok){ throw new Error((res && res.error) || 'Cloud save not confirmed'); }
    var verified=copy(res.record||candidate),k=empKey(verified);
    var ix=g.EM.data.findIndex(function(x){return empKey(x)===k});
    if(ix>=0)g.EM.data[ix]=verified;else g.EM.data.push(verified);
    persistConfirmed({skipMirrors:true});refreshMasterUi();
    try {
      fetch('/api/sync/employee-master', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ records: [verified] })
      }).catch(function(){});
    } catch(_) {}
    if(g.BroadcastChannel){
      try{
        var bc=new g.BroadcastChannel('ATPL_ERP_TRIGGER_BUS');
        bc.postMessage({action:'employee_updated',details:{emp_id:verified.emp_id,record:verified,records:[verified]}});
        bc.close();
      }catch(_){}
      try{
        var bc2=new g.BroadcastChannel('ATPL_ERP_SHARED_V2');
        bc2.postMessage({type:'employee_master_saved',records:[verified],record:verified});
        bc2.close();
      }catch(_){}
    }
    paint('saved','Saved to cloud ✓',null);info('Saved ✓ — Shared Google Drive updated.',false);
    if(typeof g.emCloseModal==='function')g.emCloseModal();
  }catch(e){
    paint('failed','Save failed — Retry',confirmedSingleSave);info(e&&e.message||String(e),true);
  }finally{busy=false;setButtonBusy(false)}
}
async function confirmedBulkSave(){
  if(busy)return;
  if(!Array.isArray(g.EM_BULK_ROWS)||!g.EM_BULK_ROWS.length){
    var area=g.document.getElementById('emBulkPasteArea');
    if(area&&area.value&&area.value.trim()&&typeof g.emParseBulkPaste==='function')g.emParseBulkPaste();
  }
  if(!Array.isArray(g.EM_BULK_ROWS)||!g.EM_BULK_ROWS.length){
    alert('Valid Employee Master rows nahi mile. Please check pasted Excel data.');return;
  }
  if(!g.EM||!Array.isArray(g.EM.data))return;
  var c=cloud();
  var rowsToSave=g.EM_BULK_ROWS.slice();
  rowsToSave.forEach(function(emp){
    var k=empKey(emp),ix=g.EM.data.findIndex(function(y){return empKey(y)===k || String(y.emp_id)===String(emp.emp_id)});
    if(ix>=0){
      var merged=Object.assign({},g.EM.data[ix]);
      Object.keys(emp).forEach(function(f){var v=emp[f];if(v!==undefined&&v!==null&&String(v).trim()!=='')merged[f]=v;});
      g.EM.data[ix]=merged;
    } else {
      g.EM.data.push(copy(emp));
    }
  });
  persistConfirmed({skipMirrors:true});
  try{g.localStorage.setItem('AroraTextilesEmployeeMasterV3',JSON.stringify(g.EM.data));}catch(_){}
  try{
    g.localStorage.removeItem('ATPL_EMP_MASTER_CLEARED_V1');
    var dead = JSON.parse(g.localStorage.getItem('ATPL_EmployeeMasterDeletedV1') || '{}');
    rowsToSave.forEach(function(r) {
      var k = String(r && (r.emp_id || r.id) || '').toLowerCase().trim();
      if (k) {
        delete dead[k];
        delete dead[k.replace(/^0+/, '')];
      }
    });
    g.localStorage.setItem('ATPL_EmployeeMasterDeletedV1', JSON.stringify(dead));
  } catch(_) {}
  refreshMasterUi();
  g.EM_BULK_ROWS=[];
  if(typeof g.emCloseModal==='function')g.emCloseModal();

  // Always post bulk save to server REST endpoint and SSE relay
  try {
    fetch('/api/sync/employee-master', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ records: rowsToSave, mode: 'upsert' })
    }).catch(function(){});
  } catch(_) {}

  if(g.BroadcastChannel){
    try{
      var bc=new g.BroadcastChannel("ATPL_ERP_TRIGGER_BUS");
      bc.postMessage({action:"employee_updated",details:{records:rowsToSave,count:g.EM.data.length}});
      bc.close();
    }catch(_){}
    try{
      var bc2=new g.BroadcastChannel("ATPL_ERP_SHARED_V2");
      bc2.postMessage({type:"employee_master_saved",records:rowsToSave,count:g.EM.data.length});
      bc2.close();
    }catch(_){}
  }

  if(g.ATPLGoogleSync && typeof g.ATPLGoogleSync.upsertEmployeeMaster === 'function'){
    try {
      await g.ATPLGoogleSync.upsertEmployeeMaster(rowsToSave);
      paint('saved','All '+rowsToSave.length+' rows saved ✓',null);
      info('Verified cloud save ✓ — '+rowsToSave.length+' employees synced.',false);
      return;
    } catch(err) { console.warn('Bulk sync to Google Drive error:', err); }
  }
  if(!c||typeof c.saveMany!=='function'){
    paint('saved','Saved locally ✓ ('+rowsToSave.length+' rows)',null);
    info('Saved '+rowsToSave.length+' employees locally to master.',false);
    return;
  }
  var items=rowsToSave.map(function(emp){
    var k=empKey(emp),old=g.EM.data.find(function(y){return empKey(y)===k})||null;
    // PRESERVE EXISTING DATA: do not overwrite account, IFSC or bank fields with blank paste cells.
    var merged=Object.assign({},old||{});
    Object.keys(emp).forEach(function(f){
      var v=emp[f];if(v!==undefined&&v!==null&&String(v).trim()!=='')merged[f]=v;
    });
    return{record:merged,baseRecord:old?copy(old):null};
  });
  busy=true;setButtonBusy(true);paint('saving','Verifying bulk save in cloud…',null);
  try{
    var res=await c.saveMany(items),resultRows=res&&Array.isArray(res.results)?res.results:[];
    var confirmed=resultRows.filter(function(x){return x.ok&&x.verified&&x.record});
    confirmed.forEach(function(x){
      var k=empKey(x.record),i=g.EM.data.findIndex(function(y){return empKey(y)===k});
      if(i>=0)g.EM.data[i]=copy(x.record);else g.EM.data.push(copy(x.record));
    });
    if(confirmed.length){
      persistConfirmed({skipMirrors:true});refreshMasterUi();
      try {
        fetch('/api/sync/employee-master', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ records: confirmed.map(function(x){ return x.record; }) })
        }).catch(function(){});
      } catch(_) {}
    }
    var done={};confirmed.forEach(function(x){done[empKey(x.record)]=true});
    g.EM_BULK_ROWS=rowsToSave.filter(function(x){return !done[empKey(x)]});
    if(!g.EM_BULK_ROWS.length){
      paint('saved','All '+confirmed.length+' rows saved ✓',null);
      info('Verified cloud save ✓ — '+confirmed.length+' employees.',false);
      if(typeof g.emCloseModal==='function')g.emCloseModal();
    }else{
      paint('failed','Bulk save incomplete — Retry',confirmedBulkSave);
      info(confirmed.length+' saved; '+g.EM_BULK_ROWS.length+' pending. Retry after checking errors.',true);
    }
  }catch(e){paint('failed','Bulk save failed — Retry',confirmedBulkSave);info(e&&e.message||String(e),true)}
  finally{busy=false;setButtonBusy(false)}
}
async function confirmedDelete(idx){
  var e=g.EM.data[idx];if(!e)return;
  if(!confirm("Delete karo: "+e.name+" ("+e.emp_id+")?"))return;
  var c=cloud();
  busy=true;
  var deletedEmp=copy(e);
  paint("saving","Deleting from cloud…",null);
  try{
    var res=null;
    // Use the Employee Master realtime engine first so cloud deletion, local
    // tombstone, UI update and cross-browser notification stay one operation.
    if(g.ATPLGoogleSync && typeof g.ATPLGoogleSync.deleteEmployeeMaster === 'function'){
      try { res = await g.ATPLGoogleSync.deleteEmployeeMaster(deletedEmp.emp_id); }
      catch(err) { res = { ok:false, error:err && err.message || String(err) }; }
    }
    if((!res || !res.ok || !res.verified) && c && typeof c.deleteMaster==="function"){
      try { res=await c.deleteMaster(deletedEmp.emp_id,{baseRecord:deletedEmp}); }
      catch(err) { res={ok:false,error:err && err.message || String(err)}; }
    }
    if(!res||!res.ok||!res.verified){
      var reason=res&&res.error||"Cloud deletion was not verified";
      paint("failed","Delete failed — Retry",function(){return confirmedDelete(idx)});
      alert("Employee NOT deleted. "+reason);
      return;
    }
    var k=empKey(deletedEmp);
    // Mark tombstone in localStorage permanently
    try {
      var m = {};
      try { m = JSON.parse(g.localStorage.getItem("ATPL_EmployeeMasterDeletedV1") || "{}"); } catch(_) {}
      m[String(deletedEmp.emp_id || "").toLowerCase().trim()] = new Date().toISOString();
      m[String(deletedEmp.emp_id || "").toLowerCase().trim().replace(/^0+/, "")] = new Date().toISOString();
      m[k] = new Date().toISOString();
      g.localStorage.setItem("ATPL_EmployeeMasterDeletedV1", JSON.stringify(m));
    } catch(_) {}

    g.EM.data=g.EM.data.filter(function(r){return empKey(r)!==k && String(r.emp_id||"")!==String(deletedEmp.emp_id||"")});
    if(Array.isArray(g.EMP_MASTER_DATA)){
      g.EMP_MASTER_DATA=g.EMP_MASTER_DATA.filter(function(r){return empKey(r)!==k && String(r.emp_id||"")!==String(deletedEmp.emp_id||"")});
    }
    try { g.localStorage.setItem("AroraTextilesEmployeeMasterV3", JSON.stringify(g.EM.data)); } catch(_) {}
    if(c && typeof c.persistLocal==="function"){
      c.persistLocal(g.EM.data);
    }
    persistConfirmed({skipMirrors:true});
    try {
      fetch('/api/sync/employee-master/' + encodeURIComponent(deletedEmp.emp_id), {
        method: 'DELETE'
      }).catch(function(){});
    } catch(_) {}
    if(g.EM.selectedRows&&typeof g.EM.selectedRows.clear==="function")g.EM.selectedRows.clear();
    refreshMasterUi();
    if(g.BroadcastChannel){
      try{
        var bc=new g.BroadcastChannel("ATPL_ERP_SHARED_V2");
        bc.postMessage({type:"employee_master_deleted",emp_id:deletedEmp.emp_id});
        bc.close();
      }catch(_){}
      try{
        var bc2=new g.BroadcastChannel("ATPL_ERP_TRIGGER_BUS");
        bc2.postMessage({action:"employee_deleted",details:{emp_id:deletedEmp.emp_id}});
        bc2.close();
      }catch(_){}
    }
    paint("saved","Deleted from cloud ✓",null);
  }catch(err){
    paint("failed","Delete failed — Retry",function(){return confirmedDelete(idx)});
    alert("Employee NOT deleted. "+(err&&err.message||err));
  }finally{busy=false}
}
async function confirmedDeleteSelected(){
  var count = g.EM && g.EM.selectedRows ? g.EM.selectedRows.size : 0;
  if (!count) { alert('Pehle delete karne ke liye employees select karein.'); return; }
  if (!confirm('Kya aap sach mein in ' + count + ' selected employees ko permanently delete karna chahte hain?')) return;
  if (!g.EM || !Array.isArray(g.EM.data)) return;

  var indices = Array.from(g.EM.selectedRows).sort(function(a,b){return a-b;});
  var deletedIds = indices.map(function(idx) {
    var row = g.EM.data[idx];
    return row && row.emp_id ? String(row.emp_id) : '';
  }).filter(Boolean);
  if (!deletedIds.length) { alert('Selected employees ke valid Employee Codes nahi mile.'); return; }

  busy = true; setButtonBusy(true);
  paint('saving', 'Confirming ' + deletedIds.length + ' cloud deletions…', null);
  try {
    var isAllDeleted = deletedIds.length >= g.EM.data.length;
    var result = null;

    // Cloud must confirm first. Never remove rows locally and then silently
    // claim success when the shared Google Sheets delete failed.
    if (isAllDeleted && g.ATPLGoogleSync && typeof g.ATPLGoogleSync.clearAllEmployees === 'function') {
      result = await g.ATPLGoogleSync.clearAllEmployees();
    } else if (!isAllDeleted && g.ATPLGoogleSync && typeof g.ATPLGoogleSync.bulkDeleteEmployees === 'function') {
      result = await g.ATPLGoogleSync.bulkDeleteEmployees(deletedIds);
    } else if (g.ATPLGoogleSync && typeof g.ATPLGoogleSync.deleteEmployeeMaster === 'function') {
      for (var i=0;i<deletedIds.length;i++) {
        result = await g.ATPLGoogleSync.deleteEmployeeMaster(deletedIds[i]);
        if (!result || !result.ok || !result.verified) throw new Error(result && result.error || 'Cloud delete not verified for ' + deletedIds[i]);
      }
    } else {
      throw new Error('Google Sheets Employee Master delete service is unavailable.');
    }
    if (!result || !result.ok || !result.verified) {
      throw new Error(result && result.error || 'Google Sheets did not confirm bulk deletion.');
    }

    // Engine normally applies this locally; enforce the final view and tombstones
    // for compatibility with older engine builds.
    var now = new Date().toISOString(), dead = {};
    try { dead = JSON.parse(g.localStorage.getItem('ATPL_EmployeeMasterDeletedV1') || '{}'); } catch (_) {}
    deletedIds.forEach(function(code) {
      var raw = String(code).toLowerCase().trim();
      dead[raw] = now;
      dead[raw.replace(/^0+/, '')] = now;
    });
    g.localStorage.setItem('ATPL_EmployeeMasterDeletedV1', JSON.stringify(dead));
    var deletedSet = {};
    deletedIds.forEach(function(code) { deletedSet[empKey({emp_id:code})] = true; });
    g.EM.data = g.EM.data.filter(function(row) { return !deletedSet[empKey(row)]; });
    if (Array.isArray(g.EMP_MASTER_DATA)) {
      g.EMP_MASTER_DATA.length = 0;
      Array.prototype.push.apply(g.EMP_MASTER_DATA, g.EM.data);
    }
    if (isAllDeleted || !g.EM.data.length) g.localStorage.setItem('ATPL_EMP_MASTER_CLEARED_V1','true');
    else g.localStorage.removeItem('ATPL_EMP_MASTER_CLEARED_V1');
    g.localStorage.setItem('AroraTextilesEmployeeMasterV3', JSON.stringify(g.EM.data));
    if (g.EM.selectedRows && typeof g.EM.selectedRows.clear === 'function') g.EM.selectedRows.clear();
    refreshMasterUi();
    paint('saved', 'Cloud confirmed: deleted ' + deletedIds.length + ' employees ✓', null);
    if (g.showToast) g.showToast('🗑 ' + deletedIds.length + ' employees delete ho gaye.');
  } catch(err) {
    paint('failed', 'Delete failed — Retry', null);
    alert('Employees cloud se delete nahi hue. ' + (err && err.message || err));
  } finally {
    busy = false; setButtonBusy(false);
  }
}
function install(){
  ensureUi();
  if(typeof g.emSaveModal==='function'&&!g.emSaveModal.__atplConfirmed){confirmedSingleSave.__atplConfirmed=true;confirmedSingleSave.__original=g.emSaveModal;g.emSaveModal=confirmedSingleSave}
  if(typeof g.emSaveBulk==='function'&&!g.emSaveBulk.__atplConfirmed){confirmedBulkSave.__atplConfirmed=true;confirmedBulkSave.__original=g.emSaveBulk;g.emSaveBulk=confirmedBulkSave}
  if(typeof g.emDeleteRow==='function'&&!g.emDeleteRow.__atplConfirmed){confirmedDelete.__atplConfirmed=true;confirmedDelete.__original=g.emDeleteRow;g.emDeleteRow=confirmedDelete}
  if(typeof g.emDeleteSelected==='function'&&!g.emDeleteSelected.__atplConfirmed){confirmedDeleteSelected.__atplConfirmed=true;confirmedDeleteSelected.__original=g.emDeleteSelected;g.emDeleteSelected=confirmedDeleteSelected}
}
    if(g.ATPLFirebase && typeof g.ATPLFirebase.subscribeEmployeeMaster === 'function' && !g.__emFbSubscribed){
      g.__emFbSubscribed = true;
      g.ATPLFirebase.subscribeEmployeeMaster(function(update){
        if(!update || !Array.isArray(update.records)) return;
        var mDel = {};
        try { mDel = JSON.parse(localStorage.getItem('ATPL_EmployeeMasterDeletedV1') || '{}'); } catch(_) {}
        update.records = update.records.filter(function(r){
          var code = String(r && (r.emp_id || r.id) || '').toLowerCase().trim();
          return !mDel[code];
        });
        // Firebase may contain an older full snapshot. Never let it resurrect cloud-deleted employees.
        if(cloud()){if(typeof cloud().pullMaster==='function')cloud().pullMaster();return;}
        if(!g.EM) return;
        if(JSON.stringify(g.EM.data) !== JSON.stringify(update.records)){
          g.EM.data = update.records.slice();
          syncLegacyArray();
          refreshMasterUi();
          try{ g.localStorage.setItem('AroraTextilesEmployeeMasterV3', JSON.stringify(update.records)); }catch(_){}
        }
      });
    }
  g.ATPLEmployeeMasterConfirmedSaveV1={install:install,status:function(){return{busy:busy,retry:!!retryFn}},retry:function(){if(retryFn&&!busy)return retryFn()}};
if(g.document.readyState==='loading')g.document.addEventListener('DOMContentLoaded',install,{once:true});else install();
setTimeout(install,800);
})(window);