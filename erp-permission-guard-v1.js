/* Arora ERP — Permission Guard V1
   Re-applies feature access after lazy/dynamic modules mount and blocks direct
   navigation to modules that are not present in the authenticated user's grant.
*/
(function(root){
'use strict';
var BUILD='2026.09.21-permission-authority1';
if(!root||root.__ATPL_PERMISSION_GUARD__===BUILD)return;
root.__ATPL_PERMISSION_GUARD__=BUILD;

var USERS='ATPL_UserAccess_V1',SESS='ATPL_UserSession_V5',timer=0,observer=null;
var MASTER_READ={cmd:1,files:1,audit:1,machineaudit:1,bankverify:1,dol:1,dolverify:1,ff:1,empmaster:1,hrdocs:1,mamsalary:1};

function json(v,d){try{return JSON.parse(v)}catch(_){return d}}
function text(v){return v==null?'':String(v).trim()}
function current(){
  try{
    var s=json(root.sessionStorage.getItem(SESS)||'null',null);if(!s||!s.id)return null;
    var list=json(root.localStorage.getItem(USERS)||'[]',[]),id=text(s.id).toLowerCase();
    var u=(Array.isArray(list)?list:[]).find(function(x){return text(x&&x.id).toLowerCase()===id});
    return u||{id:s.id,name:s.name||s.id,admin:s.admin===true,access:Array.isArray(s.access)?s.access:[]}
  }catch(_){return null}
}
function has(u,feature){
  return !!u&&(u.admin===true||(Array.isArray(u.access)&&(u.access.indexOf('*')>=0||u.access.indexOf(feature)>=0)))
}
function setVisible(el,ok){
  if(!el)return;
  if(ok){el.hidden=false;el.classList.remove('uaNoAccess','uaDeniedPage');el.style.removeProperty('display');el.removeAttribute('aria-hidden')}
  else{el.hidden=true;el.classList.add('uaNoAccess');el.style.setProperty('display','none','important');el.setAttribute('aria-hidden','true')}
}
function apply(){
  timer=0;var u=current();if(!u)return false;
  Array.prototype.forEach.call(root.document.querySelectorAll('.vitem[id^="vn-"]'),function(el){
    var feature=el.id.slice(3),ok=feature==='useraccess'?u.admin===true:has(u,feature);setVisible(el,ok)
  });
  Array.prototype.forEach.call(root.document.querySelectorAll('[id^="page-"]'),function(pg){
    var feature=pg.id.slice(5),ok=feature==='useraccess'?u.admin===true:has(u,feature);
    setVisible(pg,ok);if(!ok)pg.classList.remove('active')
  });
  Array.prototype.forEach.call(root.document.querySelectorAll('.vnav-group'),function(group){
    var any=Array.prototype.some.call(group.querySelectorAll('.vitem[id^="vn-"]'),function(el){return !el.hidden});
    setVisible(group,any)
  });
  return true
}
function schedule(){if(timer)return;timer=root.setTimeout(apply,30)}
function denied(feature){
  try{if(typeof root.showToast==='function')root.showToast('Is feature ka access nahi diya gaya.');else root.alert('Is feature ka access nahi diya gaya.')}catch(_){}
  try{root.document.dispatchEvent(new CustomEvent('atpl-access-denied',{detail:{feature:feature}}))}catch(_){}
}
function installGoGuard(){
  if(typeof root.goPage!=='function'||root.goPage.__atplPermissionGuard)return false;
  var old=root.goPage;
  function guarded(name){var u=current();if(u&&!has(u,String(name||''))){denied(String(name||''));return false}return old.apply(this,arguments)}
  guarded.__atplPermissionGuard=true;guarded.__original=old;root.goPage=guarded;return true
}
function clickGuard(ev){
  var el=ev.target&&ev.target.closest?ev.target.closest('.vitem[id^="vn-"]'):null;if(!el)return;
  var u=current(),feature=el.id.slice(3),ok=feature==='useraccess'?!!(u&&u.admin===true):has(u,feature);
  if(ok)return;ev.preventDefault();ev.stopPropagation();if(ev.stopImmediatePropagation)ev.stopImmediatePropagation();denied(feature)
}
function watchDynamicModules(){
  if(observer||!root.MutationObserver)return;
  observer=new MutationObserver(function(list){
    if(list.some(function(x){return x.addedNodes&&x.addedNodes.length}))schedule()
  });
  var nav=root.document.getElementById('vnav'),content=root.document.querySelector('.content');
  if(nav)observer.observe(nav,{childList:true,subtree:true});
  if(content)observer.observe(content,{childList:true,subtree:false})
}
function canUseMaster(u){u=u||current();if(!u)return false;if(u.admin===true)return true;return Object.keys(MASTER_READ).some(function(k){return MASTER_READ[k]&&has(u,k)})}
function boot(){installGoGuard();watchDynamicModules();apply();root.setTimeout(function(){installGoGuard();apply()},900)}

root.ATPLPermissionGuard={apply:apply,currentUser:current,hasFeature:function(f){return has(current(),f)},canUseMaster:canUseMaster,version:function(){return BUILD}};
root.document.addEventListener('click',clickGuard,true);
['atpl-authenticated','atpl-account-users-synced','atpl-modules-changed'].forEach(function(n){root.document.addEventListener(n,function(){schedule()})});
if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})(window);
