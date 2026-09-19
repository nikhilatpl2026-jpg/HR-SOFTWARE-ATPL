/* Arora ERP — Account Cloud Restore V1
   Same authenticated ERP login should hydrate shared company data on every browser/device.
   Additive: does not replace existing module logic.
*/
(function(root){
'use strict';
var BUILD='2026.09.19-shared-orchestrator2';
if(!root||root.__ATPL_ACCOUNT_CLOUD_RESTORE_V1__===BUILD)return;
root.__ATPL_ACCOUNT_CLOUD_RESTORE_V1__=BUILD;

var API='https://script.google.com/macros/s/AKfycby99_893hVtbWOQr67ikxIwiq81MWW8JAa2LuxTu67JBxjQ_iWb-YkqhBmW0RrHU512SQ/exec';
var TOKEN='ATPL_RemoteToken_V1',ALT='ATPL_SharedToken_V1',SESS='ATPL_UserSession_V5',USERS='ATPL_UserAccess_V1';
var running=null,lastRun=0,timer=0;

function J(s,d){try{return JSON.parse(s)}catch(_){return d}}
function text(v){return v==null?'':String(v).trim()}
function token(){try{return text(root.sessionStorage.getItem(TOKEN)||root.sessionStorage.getItem(ALT)||'')}catch(_){return''}}
function session(){try{var s=J(root.sessionStorage.getItem(SESS)||'null',null);return s&&s.id?s:null}catch(_){return null}}
function jsonp(p,timeout){/* broker-routed-account */if(root.ATPLCloudAPI)return root.ATPLCloudAPI.request(p,{timeout:timeout,source:'account-restore'});return new Promise(function(ok,no){
  var cb='__atpl_acr_'+Date.now()+'_'+Math.random().toString(36).slice(2),sc=root.document.createElement('script'),done=false,t=setTimeout(function(){finish();no(new Error('Account cloud timeout'))},timeout||12000);
  function finish(){if(done)return;done=true;clearTimeout(t);try{delete root[cb]}catch(_){root[cb]=undefined}if(sc.parentNode)sc.parentNode.removeChild(sc)}
  root[cb]=function(x){finish();ok(x||{})};p=Object.assign({},p||{},{callback:cb,_ts:Date.now()});
  sc.onerror=function(){finish();no(new Error('Account cloud connect failed'))};
  sc.async=true;sc.src=API+'?'+Object.keys(p).map(function(k){return encodeURIComponent(k)+'='+encodeURIComponent(p[k]==null?'':String(p[k]))}).join('&');
  (root.document.head||root.document.documentElement).appendChild(sc)
})}
function currentUser(){
  var s=session();if(!s)return null;
  var a=J(root.localStorage.getItem(USERS)||'[]',[]),id=text(s.id).toLowerCase(),u=(Array.isArray(a)?a:[]).find(function(x){return text(x&&x.id).toLowerCase()===id});
  return u||{id:s.id,name:s.id,admin:false,access:[]}
}
function has(u,id){return !!u&&(u.admin===true||(Array.isArray(u.access)&&(u.access.indexOf('*')>=0||u.access.indexOf(id)>=0)))}
function applyAccess(){
  var u=currentUser();if(!u)return;
  Array.prototype.forEach.call(root.document.querySelectorAll('.vitem[id^="vn-"]'),function(el){
    var id=el.id.slice(3),ok=id==='useraccess'?u.admin===true:has(u,id);
    if(ok){el.hidden=false;el.classList.remove('uaNoAccess');el.style.removeProperty('display');el.removeAttribute('aria-hidden')}
    else{el.hidden=true;el.classList.add('uaNoAccess');el.style.setProperty('display','none','important');el.setAttribute('aria-hidden','true')}
  });
  Array.prototype.forEach.call(root.document.querySelectorAll('[id^="page-"]'),function(pg){
    var id=pg.id.slice(5),ok=id==='useraccess'?u.admin===true:has(u,id);
    if(ok){pg.hidden=false;pg.classList.remove('uaDeniedPage','uaNoAccess');pg.style.removeProperty('display');pg.removeAttribute('aria-hidden')}
    else{pg.hidden=true;pg.classList.add('uaDeniedPage');pg.style.setProperty('display','none','important');pg.setAttribute('aria-hidden','true')}
  });
  var who=root.document.getElementById('uaWho');if(who){who.style.display='inline-flex';who.textContent='👤 '+text(u.name||u.id)}
}
async function syncUsers(){
  var t=token();if(!t)return false;
  try{
    var r=await jsonp({action:'listUsers',token:t},12000);
    if(!(r&&r.ok&&Array.isArray(r.users)))return false;
    root.localStorage.setItem(USERS,JSON.stringify(r.users));applyAccess();
    try{root.document.dispatchEvent(new CustomEvent('atpl-account-users-synced',{detail:{count:r.users.length}}))}catch(_){}
    return true
  }catch(_){return false}
}
function badge(msg,bad){
  try{
    var b=root.document.getElementById('atplAccountCloudBadge');
    if(!b){var h=root.document.querySelector('.header-right');if(!h)return;b=root.document.createElement('span');b.id='atplAccountCloudBadge';b.style.cssText='font-size:9px;padding:4px 7px;border-radius:999px;border:1px solid #a7f3d0;background:#ecfdf5;color:#047857;font-weight:800;display:none';h.appendChild(b)}
    b.style.display=token()?'inline-flex':'none';b.textContent=msg||'☁ Account Sync';b.style.borderColor=bad?'#fecaca':'#a7f3d0';b.style.background=bad?'#fef2f2':'#ecfdf5';b.style.color=bad?'#b91c1c':'#047857'
  }catch(_){}
}
function syncNow(force){
  if(!token()||!session())return Promise.resolve(false);
  if(running)return running;
  if(!force&&Date.now()-lastRun<7000)return Promise.resolve(false);
  lastRun=Date.now();badge('☁ Restoring shared data…');
  running=(async function(){
    var jobs=[syncUsers()];
    if(root.ATPLMobileSharedHardFix&&typeof root.ATPLMobileSharedHardFix.pullMaster==='function')jobs.push(root.ATPLMobileSharedHardFix.pullMaster());
    else if(root.ATPLCloudSyncV1&&typeof root.ATPLCloudSyncV1.pullMaster==='function')jobs.push(root.ATPLCloudSyncV1.pullMaster());
    if(root.ATPLSharedActivityV2&&typeof root.ATPLSharedActivityV2.syncCloud==='function')jobs.push(root.ATPLSharedActivityV2.syncCloud());
    if(root.ATPLComplianceDOLV2&&typeof root.ATPLComplianceDOLV2.syncCloud==='function')jobs.push(root.ATPLComplianceDOLV2.syncCloud());
    if(root.ATPLCloudSharedStorageV1&&typeof root.ATPLCloudSharedStorageV1.syncNow==='function')jobs.push(root.ATPLCloudSharedStorageV1.syncNow());
    if(root.ATPLDurableEverythingV1&&typeof root.ATPLDurableEverythingV1.sync==='function')jobs.push(root.ATPLDurableEverythingV1.sync());
    var results=await Promise.allSettled(jobs.map(function(x){return Promise.resolve(x)}));
    results.forEach(function(x){if(x.status==='rejected')console.warn('Account shared-data job failed',x.reason)});
    applyAccess();badge('☁ Shared Data Ready');
    try{root.document.dispatchEvent(new CustomEvent('atpl-account-cloud-restored',{detail:{at:new Date().toISOString()}}))}catch(_){}
    return true
  })().catch(function(e){console.warn('Account cloud restore issue',e);badge('☁ Sync Retry',true);return false}).finally(function(){running=null});
  return running
}
function schedule(ms){clearTimeout(timer);timer=setTimeout(function(){syncNow(true)},ms==null?150:ms)}
function patchTokenWrites(){
  try{
    var p=root.Storage&&root.Storage.prototype;if(!p||p.__atplAccountRestore)return;var old=p.setItem;
    p.setItem=function(k,v){var r=old.call(this,k,v);if(this===root.sessionStorage&&(String(k)===TOKEN||String(k)===ALT||String(k)===SESS))schedule(120);return r};
    p.__atplAccountRestore=true
  }catch(_){}
}
function boot(){
  patchTokenWrites();badge('☁ Account Sync');schedule(900);
  root.document.addEventListener('atpl-authenticated',function(){schedule(0)});
  root.addEventListener('focus',function(){syncNow(false)});
  root.addEventListener('online',function(){syncNow(true)});
  root.document.addEventListener('visibilitychange',function(){if(!root.document.hidden)syncNow(false)});
  root.setInterval(function(){if(!root.document.hidden&&token())syncNow(false)},120000)
}
root.ATPLAccountCloudRestoreV1={syncNow:function(force){return syncNow(force!==false)},syncUsers:syncUsers,status:function(){return{build:BUILD,token:!!token(),session:!!session(),running:!!running,lastRun:lastRun}}};
if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})(window);
