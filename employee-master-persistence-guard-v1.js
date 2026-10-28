/* ATPL Employee Master Persistence Guard V1
   Keeps local Employee Master snapshot authoritative until cloud confirms pending edits.
   Does not alter Employee Master business rules or calculations. */
(function(g){'use strict';
if(!g||g.__ATPL_EMP_MASTER_PERSISTENCE_GUARD_V1__)return;
g.__ATPL_EMP_MASTER_PERSISTENCE_GUARD_V1__='2026.09.18-1';
var KEY='AroraTextilesEmployeeMasterV3';

function text(v){return v==null?'':String(v).trim()}
function codeOf(r){return text(r&&(r.emp_id||r.empCode||r.employee_code||r.code)).toLowerCase()}
function read(){
  try{var a=JSON.parse(localStorage.getItem(KEY)||'[]');return Array.isArray(a)?a:[]}catch(_){return[]}
}
function merge(base,local){
  var map={},order=[];
  (Array.isArray(base)?base:[]).forEach(function(r){var k=codeOf(r);if(!k)return;if(!map[k])order.push(k);map[k]=r});
  (Array.isArray(local)?local:[]).forEach(function(r){
    var k=codeOf(r);if(!k)return;if(!map[k])order.push(k);
    var existing=map[k]||{};
    var merged=Object.assign({},existing);
    Object.keys(r).forEach(function(p){
      var v=r[p];
      if(v!==undefined && v!==null && String(v).trim()!==""){
        merged[p]=v;
      }
    });
    map[k]=merged;
  });
  return order.map(function(k){return map[k]});
}
function persist(){
  try{
    if(g.EM&&Array.isArray(g.EM.data))localStorage.setItem(KEY,JSON.stringify(g.EM.data));
  }catch(_){}
}
function hydrate(){
  try{
    if(!g.EM||!Array.isArray(g.EM.data))return false;
    var local=read();
    if(local && local.length > 600) {
      console.warn("[ATPL Guard] Purging inflated employee cache: " + local.length);
      local = [];
      try { localStorage.removeItem(KEY); } catch(_) {}
    }
    // Never union an old local snapshot with the active Employee Master.
    // A deleted employee must not be re-created by a stale browser cache.
    if(!g.EM.data.length&&local.length){
      var deleted={};
      try{deleted=JSON.parse(localStorage.getItem('ATPL_EmployeeMasterDeletedV1')||'{}')}catch(_){}
      g.EM.data=local.filter(function(r){return !deleted[codeOf(r)]});
      if(Array.isArray(g.EMP_MASTER_DATA)){
        g.EMP_MASTER_DATA.length=0;
        Array.prototype.push.apply(g.EMP_MASTER_DATA,g.EM.data);
      }
    }else if(g.EM.data.length){
      persist();
    }
    if(typeof g.emUpdateStats==='function')g.emUpdateStats();
    return true;
  }catch(e){console.warn('Employee Master persistence hydrate failed',e);return false}
}
function wrapSave(){
  var fn=g.emSaveModal;
  if(typeof fn!=='function'||fn.__atplPersistWrapped||fn.__atplConfirmed||g.ATPLEmployeeMasterConfirmedSaveV1)return;
  function w(){
    var r=fn.apply(this,arguments);
    setTimeout(function(){persist();try{if(g.ATPLCloudSyncV1&&typeof g.ATPLCloudSyncV1.wake==='function')g.ATPLCloudSyncV1.wake()}catch(_){}},0);
    return r;
  }
  w.__atplPersistWrapped=true;w.__original=fn;g.emSaveModal=w;
}
function boot(){
  hydrate();wrapSave();
  document.addEventListener('visibilitychange',function(){if(document.hidden)persist()});
  g.addEventListener('beforeunload',persist);
  if(g.BroadcastChannel){
    try{
      var bc=new g.BroadcastChannel('ATPL_ERP_SHARED_V2');
      bc.addEventListener('message',function(ev){
        var msg=ev&&ev.data;
        if(!msg)return;
        if(msg.type==='employee_master_deleted'&&msg.emp_id){
          var k=codeOf({emp_id:msg.emp_id});
          if(g.EM&&Array.isArray(g.EM.data))g.EM.data=g.EM.data.filter(function(r){return codeOf(r)!==k});
          persist();
        }
        // Trust only the backend for cross-tab snapshots; never restore a stale broadcast.
        if((msg.type==='employee_master_saved'||msg.type==='master'||msg.type==='employee_master_deleted')&&g.ATPLCloudSyncV1){
          g.ATPLCloudSyncV1.pullMaster();
        }
            });
    }catch(_){}
  }
  setTimeout(function(){hydrate();wrapSave()},500);
}
g.ATPLEmployeeMasterPersistenceV1={hydrate:hydrate,persist:persist};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})(window);