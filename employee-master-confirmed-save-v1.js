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
function persistConfirmed(){
  var c=cloud();if(c&&typeof c.persistLocal==='function'&&g.EM&&Array.isArray(g.EM.data))c.persistLocal(g.EM.data);
  syncLegacyArray()
}
function fieldsToEmployee(){
  var out={},valid=true,cols=Array.isArray(g.EM_COLS)?g.EM_COLS:[];
  cols.forEach(function(c){
    var el=g.document.getElementById('emf_'+c.key);if(!el)return;var val=el.value?el.value.trim():'';
    if((c.key==='emp_id'||c.key==='name')&&!val){el.style.border='2px solid #dc2626';valid=false;return}
    if(c.type==='number')out[c.key]=parseFloat(val)||0;else out[c.key]=val?val.toUpperCase():''
  });
  return valid?out:null
}
async function confirmedSingleSave(){
  if(busy)return;ensureUi();
  if(!g.EM||!Array.isArray(g.EM.data)){paint('failed','Save Failed — Retry',confirmedSingleSave);return}
  var entered=fieldsToEmployee();if(!entered){alert('Employee Code aur Name mandatory hain!');return}
  var edit=Number(g.EM.editIdx),original=edit>=0&&g.EM.data[edit]?copy(g.EM.data[edit]):null,candidate=Object.assign({},original||{},entered),c=cloud();
  if(!c||typeof c.saveMaster!=='function'){paint('failed','Save Failed — Retry',confirmedSingleSave);info('Shared backend save service unavailable. Data ko Saved mark nahi kiya gaya.',true);return}
  busy=true;setButtonBusy(true);paint('saving','Saving...',null);info('Saving to shared backend…',false);
  try{
    var res=await c.saveMaster(candidate,{baseRecord:original,isNew:edit<0});
    if(!(res&&res.ok&&res.verified)){
      var why=res&&res.error||'Backend did not confirm the save';
      if(res&&res.duplicate){paint('failed','Employee Already Exists',null);info(why+' Existing record ko refresh karke Edit karo; overwrite nahi kiya gaya.',true);return}
      paint('failed','Save Failed — Retry',confirmedSingleSave);info((res&&res.conflict?'Conflict: ':'')+why+' Data local Saved mark nahi hui.',true);return
    }
    var confirmed=res.record||candidate;
    if(edit>=0&&g.EM.data[edit])g.EM.data[edit]=confirmed;else g.EM.data.push(confirmed);
    persistConfirmed();refreshMasterUi();paint('saved','Saved ✓',null);info('Saved ✓ — backend read-back confirmed.',false);
    if(typeof g.emCloseModal==='function')g.emCloseModal()
  }catch(e){paint('failed','Save Failed — Retry',confirmedSingleSave);info('Save failed: '+(e&&e.message?e.message:e),true)}
  finally{busy=false;setButtonBusy(false)}
}
async function confirmedBulkSave(){
  if(busy||!Array.isArray(g.EM_BULK_ROWS)||!g.EM_BULK_ROWS.length)return;ensureUi();
  var c=cloud();if(!c||typeof c.saveMany!=='function'){paint('failed','Save Failed — Retry',confirmedBulkSave);info('Shared backend bulk save service unavailable.',true);return}
  var items=g.EM_BULK_ROWS.map(function(emp){var k=empKey(emp),old=(g.EM&&Array.isArray(g.EM.data)?g.EM.data.find(function(x){return empKey(x)===k}):null);return{record:Object.assign({},old||{},copy(emp)),baseRecord:old?copy(old):null}});
  busy=true;setButtonBusy(true);paint('saving','Saving...',null);info('Saving '+items.length+' employee row(s) to shared backend…',false);
  try{
    var res=await c.saveMany(items),results=res&&Array.isArray(res.results)?res.results:[],ok=0,fail=0;
    results.forEach(function(x){
      if(!x.ok){fail++;return}ok++;var rec=x.record||x.input;if(!rec)return;var k=empKey(rec),idx=g.EM.data.findIndex(function(y){return empKey(y)===k});if(idx>=0)g.EM.data[idx]=rec;else g.EM.data.push(rec)
    });
    if(ok){persistConfirmed();refreshMasterUi()}
    if(fail){paint('failed','Save Failed — Retry',confirmedBulkSave);info(ok+' saved ✓, '+fail+' failed/conflicted. Failed rows ko Saved mark nahi kiya gaya. Click Retry after reviewing.',true);return}
    paint('saved','Saved ✓',null);info('Saved ✓ — '+ok+' employee row(s) backend read-back confirmed.',false);g.EM_BULK_ROWS=[];if(typeof g.emCloseModal==='function')g.emCloseModal()
  }catch(e){paint('failed','Save Failed — Retry',confirmedBulkSave);info('Bulk save failed: '+(e&&e.message?e.message:e),true)}
  finally{busy=false;setButtonBusy(false)}
}
async function confirmedDelete(idx){
  if(busy||!g.EM||!Array.isArray(g.EM.data))return;var e=g.EM.data[idx];if(!e)return;
  if(!confirm('Delete karo: '+e.name+' ('+e.emp_id+')?'))return;
  var c=cloud();if(!c||typeof c.deleteMaster!=='function'){paint('failed','Save Failed — Retry',function(){confirmedDelete(idx)});return}
  busy=true;paint('saving','Saving...',null);
  try{
    var res=await c.deleteMaster(e.emp_id,{baseRecord:copy(e)});
    if(!(res&&res.ok&&res.verified)){paint('failed','Save Failed — Retry',function(){confirmedDelete(idx)});info('Delete failed: '+(res&&res.error||'backend confirmation missing'),true);return}
    g.EM.data.splice(idx,1);persistConfirmed();if(g.EM.selectedRows&&typeof g.EM.selectedRows.clear==='function')g.EM.selectedRows.clear();refreshMasterUi();paint('saved','Saved ✓',null)
  }catch(err){paint('failed','Save Failed — Retry',function(){confirmedDelete(idx)});info('Delete failed: '+(err&&err.message?err.message:err),true)}
  finally{busy=false}
}
function install(){
  ensureUi();
  if(typeof g.emSaveModal==='function'&&!g.emSaveModal.__atplConfirmed){confirmedSingleSave.__atplConfirmed=true;confirmedSingleSave.__original=g.emSaveModal;g.emSaveModal=confirmedSingleSave}
  if(typeof g.emSaveBulk==='function'&&!g.emSaveBulk.__atplConfirmed){confirmedBulkSave.__atplConfirmed=true;confirmedBulkSave.__original=g.emSaveBulk;g.emSaveBulk=confirmedBulkSave}
  if(typeof g.emDeleteRow==='function'&&!g.emDeleteRow.__atplConfirmed){confirmedDelete.__atplConfirmed=true;confirmedDelete.__original=g.emDeleteRow;g.emDeleteRow=confirmedDelete}
}
g.ATPLEmployeeMasterConfirmedSaveV1={install:install,status:function(){return{busy:busy,retry:!!retryFn}},retry:function(){if(retryFn&&!busy)return retryFn()}};
if(g.document.readyState==='loading')g.document.addEventListener('DOMContentLoaded',install,{once:true});else install();
setTimeout(install,800);
})(window);