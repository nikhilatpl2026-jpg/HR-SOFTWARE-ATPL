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
  (Array.isArray(local)?local:[]).forEach(function(r){var k=codeOf(r);if(!k)return;if(!map[k])order.push(k);map[k]=r});
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
    if(!local.length){
      localStorage.setItem(KEY,JSON.stringify(g.EM.data));
      return true;
    }
    var merged=merge(g.EM.data,local);
    g.EM.data=merged;
    if(Array.isArray(g.EMP_MASTER_DATA)){
      g.EMP_MASTER_DATA.length=0;
      Array.prototype.push.apply(g.EMP_MASTER_DATA,merged);
    }
    localStorage.setItem(KEY,JSON.stringify(merged));
    if(typeof g.emUpdateStats==='function')g.emUpdateStats();
    return true;
  }catch(e){console.warn('Employee Master persistence hydrate failed',e);return false}
}
function wrapSave(){
  var fn=g.emSaveModal;
  if(typeof fn!=='function'||fn.__atplPersistWrapped)return;
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
  setTimeout(function(){hydrate();wrapSave()},500);
}
g.ATPLEmployeeMasterPersistenceV1={hydrate:hydrate,persist:persist};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})(window);