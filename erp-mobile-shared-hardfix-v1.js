/* Arora ERP — Mobile Shared Data Hard Fix V1
   Guarantees backend-first login and same-account cross-device Employee Master hydration.
   Additive hard-fix: capture-phase login owns the login button so legacy local login cannot win.
*/
(function(root){
'use strict';
var BUILD='2026.09.21-permission-sync2';
if(!root||root.__ATPL_MOBILE_SHARED_HARDFIX__===BUILD)return;
root.__ATPL_MOBILE_SHARED_HARDFIX__=BUILD;

var API='https://script.google.com/macros/s/AKfycby99_893hVtbWOQr67ikxIwiq81MWW8JAa2LuxTu67JBxjQ_iWb-YkqhBmW0RrHU512SQ/exec';
var USERS='ATPL_UserAccess_V1',SESS='ATPL_UserSession_V5',TOKEN='ATPL_RemoteToken_V1',ALT='ATPL_SharedToken_V1',MASTER='AroraTextilesEmployeeMasterV3';
var busy=false,lastMasterPull=0,backgroundRun=null;

function q(id){return root.document.getElementById(id)}
function text(v){return v==null?'':String(v).trim()}
function J(s,d){try{return JSON.parse(s)}catch(_){return d}}
function tok(){try{return text(root.sessionStorage.getItem(TOKEN)||root.sessionStorage.getItem(ALT)||'')}catch(_){return''}}
function sess(){try{var s=J(root.sessionStorage.getItem(SESS)||'null',null);return s&&s.id?s:null}catch(_){return null}}
function current(){var s=sess();if(!s)return null;var a=J(root.localStorage.getItem(USERS)||'[]',[]),id=text(s.id).toLowerCase();return (Array.isArray(a)?a:[]).find(function(u){return text(u&&u.id).toLowerCase()===id})||(s.access||s.admin===true?s:null)}
function api(p,timeout){/* broker-routed-login-authority */if(root.ATPLCloudAPI)return root.ATPLCloudAPI.request(p,{timeout:timeout,source:'login-authority'});return new Promise(function(ok,no){
  var cb='__atpl_mobile_'+Date.now()+'_'+Math.random().toString(36).slice(2),sc=root.document.createElement('script'),done=false,t=setTimeout(function(){finish();no(new Error('Cloud connection timeout'))},timeout||18000);
  function finish(){if(done)return;done=true;clearTimeout(t);try{delete root[cb]}catch(_){root[cb]=undefined}if(sc.parentNode)sc.parentNode.removeChild(sc)}
  root[cb]=function(x){finish();ok(x||{})};p=Object.assign({},p||{},{callback:cb,_ts:Date.now()});
  sc.onerror=function(){finish();no(new Error('Cloud server connect failed'))};sc.async=true;
  sc.src=API+'?'+Object.keys(p).map(function(k){return encodeURIComponent(k)+'='+encodeURIComponent(p[k]==null?'':String(p[k]))}).join('&');
  (root.document.head||root.document.documentElement).appendChild(sc)
})}
async function sha256(v){
  if(!(root.crypto&&root.crypto.subtle&&root.TextEncoder))throw new Error('Secure login unavailable in this browser');
  var b=await root.crypto.subtle.digest('SHA-256',new root.TextEncoder().encode(String(v)));
  return Array.prototype.map.call(new Uint8Array(b),function(x){return('0'+x.toString(16)).slice(-2)}).join('')
}
function setStatus(msg,bad){
  var e=q('uaLoginErr');if(e){e.textContent=msg||'';e.style.color=bad?'#b91c1c':'#047857'}
}
function busyBtn(on,msg){
  var b=q('uaLoginBtn');if(!b)return;if(!b.dataset.mobileBase)b.dataset.mobileBase=b.textContent||'Login';
  b.disabled=!!on;b.style.opacity=on?'.7':'1';b.textContent=on?(msg||'LOADING...'):b.dataset.mobileBase
}
function setSession(user,token){
  root.localStorage.setItem(USERS,JSON.stringify([user]));
  root.sessionStorage.setItem(SESS,JSON.stringify({id:user.id,name:user.name||user.id,admin:user.admin===true,access:Array.isArray(user.access)?user.access:[]}));
  root.sessionStorage.setItem(TOKEN,token);root.sessionStorage.setItem(ALT,token)
}
function has(u,p){return !!u&&(u.admin===true||(Array.isArray(u.access)&&(u.access.indexOf('*')>=0||u.access.indexOf(p)>=0)))}
function canUseMaster(u){
  if(root.ATPLPermissionGuard&&typeof root.ATPLPermissionGuard.canUseMaster==='function')return root.ATPLPermissionGuard.canUseMaster(u);
  var needs=['cmd','files','audit','machineaudit','bankverify','dol','dolverify','ff','empmaster','hrdocs','mamsalary'];
  return !!u&&(u.admin===true||needs.some(function(x){return has(u,x)}))
}
function applyAccess(){
  var u=current();if(!u)return;
  Array.prototype.forEach.call(root.document.querySelectorAll('.vitem[id^="vn-"]'),function(el){var id=el.id.slice(3),ok=id==='useraccess'?u.admin===true:has(u,id);el.hidden=!ok;if(ok){el.classList.remove('uaNoAccess');el.style.removeProperty('display');el.removeAttribute('aria-hidden')}else{el.classList.add('uaNoAccess');el.style.setProperty('display','none','important');el.setAttribute('aria-hidden','true')}});
  Array.prototype.forEach.call(root.document.querySelectorAll('[id^="page-"]'),function(pg){var id=pg.id.slice(5),ok=id==='useraccess'?u.admin===true:has(u,id);if(ok){pg.hidden=false;pg.classList.remove('uaDeniedPage','uaNoAccess');pg.style.removeProperty('display');pg.removeAttribute('aria-hidden')}else{pg.hidden=true;pg.classList.add('uaDeniedPage');pg.style.setProperty('display','none','important')}});
  var who=q('uaWho'),lo=q('uaLogoutBtn');if(who){who.style.display='inline-flex';who.textContent='👤 '+text(u.name||u.id)}if(lo)lo.style.display='inline-flex'
}
function cleanMaster(a){return (Array.isArray(a)?a:[]).filter(function(r){var id=text(r&&r.emp_id);return r&&r._atpl_system!==true&&id.indexOf('__ATPL_SYS__')!==0})}
function clearMasterView(){
  try{root.localStorage.setItem(MASTER,'[]')}catch(_){}
  try{if(root.EM&&Array.isArray(root.EM.data)){root.EM.data.length=0;if(typeof root.emFilter==='function')root.emFilter();if(typeof root.emUpdateStats==='function')root.emUpdateStats()}if(Array.isArray(root.EMP_MASTER_DATA))root.EMP_MASTER_DATA.length=0}catch(_){}
  return 0
}
function injectMaster(records){
  records=cleanMaster(records);
  root.localStorage.setItem(MASTER,JSON.stringify(records));
  try{
    if(root.EM&&Array.isArray(root.EM.data)){root.EM.data.length=0;Array.prototype.push.apply(root.EM.data,records);if(typeof root.emFilter==='function')root.emFilter();if(typeof root.emUpdateStats==='function')root.emUpdateStats()}
    if(Array.isArray(root.EMP_MASTER_DATA)){root.EMP_MASTER_DATA.length=0;Array.prototype.push.apply(root.EMP_MASTER_DATA,records)}
    if(root.BroadcastChannel){var bc=new root.BroadcastChannel('ATPL_ERP_SHARED_V2');bc.postMessage({type:'master',data:records});bc.close()}
  }catch(e){console.warn('Mobile master UI inject warning',e)}
  try{root.document.dispatchEvent(new CustomEvent('atpl-mobile-master-loaded',{detail:{count:records.length}}))}catch(_){}
  return records.length
}
async function pullMaster(force){
  var u=current()||sess();if(!canUseMaster(u))return clearMasterView();
  var t=tok();if(!t)return 0;if(!force&&Date.now()-lastMasterPull<8000)return cleanMaster(J(root.localStorage.getItem(MASTER)||'[]',[])).length;
  lastMasterPull=Date.now();var r=await api({action:'getEmployeeMaster',token:t},7000);
  if(!(r&&r.ok&&Array.isArray(r.records)))throw new Error(r&&r.error||'Employee Master cloud load failed');
  return injectMaster(r.records)
}
async function pullUsers(user){
  if(!(user&&user.admin===true))return [user];
  try{var r=await api({action:'listUsers',token:tok()},6000);if(r&&r.ok&&Array.isArray(r.users)&&r.users.length){root.localStorage.setItem(USERS,JSON.stringify(r.users));return r.users}}catch(_){}
  return [user]
}
function backgroundShared(){
  if(backgroundRun)return backgroundRun;
  var jobs=[];
  try{
    if(root.ATPLAccountCloudRestoreV1&&typeof root.ATPLAccountCloudRestoreV1.syncNow==='function')jobs.push(root.ATPLAccountCloudRestoreV1.syncNow(true));
    else{
      if(root.ATPLSharedActivityV2&&typeof root.ATPLSharedActivityV2.syncCloud==='function')jobs.push(root.ATPLSharedActivityV2.syncCloud());
      if(root.ATPLComplianceDOLV2&&typeof root.ATPLComplianceDOLV2.syncCloud==='function')jobs.push(root.ATPLComplianceDOLV2.syncCloud());
      if(root.ATPLCloudSharedStorageV1&&typeof root.ATPLCloudSharedStorageV1.syncNow==='function')jobs.push(root.ATPLCloudSharedStorageV1.syncNow());
      if(root.ATPLDurableEverythingV1&&typeof root.ATPLDurableEverythingV1.sync==='function')jobs.push(root.ATPLDurableEverythingV1.sync())
    }
  }catch(e){console.warn('Shared background sync start failed',e)}
  backgroundRun=Promise.allSettled(jobs.map(function(x){return Promise.resolve(x)})).finally(function(){backgroundRun=null});
  return backgroundRun
}
function firstAllowed(u){var x=Array.prototype.find.call(root.document.querySelectorAll('.vitem[id^="vn-"]'),function(el){return has(u,el.id.slice(3))});return x?x.id.slice(3):null}
function unlockApp(user,navigate){
  var login=q('uaLogin');if(login)login.style.display='none';root.document.body.classList.remove('uaLocked');
  var landing=q('landingPage');if(landing){landing.style.display='flex';landing.style.opacity='1';landing.style.visibility='visible';landing.style.pointerEvents='auto'}
  applyAccess();if(navigate!==false){var p=firstAllowed(user||current());if(p&&typeof root.goPage==='function')try{root.goPage(p)}catch(_){}}
}
function hydrateAfterLogin(user){
  // Critical login path only: users + Employee Master. Heavy modules sync lazily after UI is usable.
  var jobs=[pullUsers(user),canUseMaster(user)?pullMaster(true):Promise.resolve(clearMasterView())];
  Promise.allSettled(jobs).then(function(results){
    applyAccess();var count=results[1]&&results[1].status==='fulfilled'?Number(results[1].value||0):0;
    try{root.document.dispatchEvent(new CustomEvent('atpl-shared-data-ready',{detail:{employees:count}}))}catch(_){}
    try{if(typeof root.showToast==='function')root.showToast(count?'☁ Shared data ready · '+count+' employees':'☁ Shared data sync complete')}catch(_){}
    root.setTimeout(function(){backgroundShared().catch(function(e){console.warn('Deferred shared hydration failed',e)})},2200);
  }).catch(function(e){console.warn('Post-login shared hydration failed',e)})
}
async function hardLogin(ev){
  if(ev){ev.preventDefault();ev.stopPropagation();if(ev.stopImmediatePropagation)ev.stopImmediatePropagation()}
  if(busy)return;var id=q('uaLoginId'),pw=q('uaLoginPass');if(!id||!pw)return;
  var uid=id.value.trim(),pass=pw.value;if(!uid||!pass){setStatus('User ID aur Password enter karo.',true);return}
  busy=true;setStatus('');busyBtn(true,'VERIFYING...');
  try{
    var h=await sha256(pass),lr=await api({action:'login',user_id:uid,password_hash:h},9000);
    if(!(lr&&lr.ok&&lr.user&&lr.token))throw new Error(lr&&lr.error||'Wrong User ID or Password.');
    setSession(lr.user,lr.token);unlockApp(lr.user,true);setStatus('');
    try{root.document.dispatchEvent(new CustomEvent('atpl-authenticated',{detail:{user:lr.user}}))}catch(_){}
    try{if(typeof root.showToast==='function')root.showToast('Login successful ✓ · shared data syncing')}catch(_){}
    setTimeout(function(){hydrateAfterLogin(lr.user)},0)
  }catch(e){setStatus(e&&e.message?e.message:String(e),true)}
  finally{busy=false;busyBtn(false)}
}
function captureClick(ev){var b=ev.target&&ev.target.closest?ev.target.closest('#uaLoginBtn'):null;if(b)hardLogin(ev)}
function captureEnter(ev){if(ev.key!=='Enter')return;var p=q('uaLoginPass');if(p&&ev.target===p)hardLogin(ev)}
function hookNav(){
  root.document.addEventListener('click',function(ev){
    var x=ev.target&&ev.target.closest?ev.target.closest('#vn-empmaster,#vn-employee,#vn-emaster,#vn-employees'):null;
    if(x&&tok())setTimeout(function(){pullMaster(true).catch(function(e){console.warn(e)})},80);
    // PF/ESIC DOL owns its own lazy refresh. Do not launch whole-ERP background sync from these buttons.
  },true)
}
function boot(){
  root.document.addEventListener('click',captureClick,true);root.document.addEventListener('keydown',captureEnter,true);hookNav();
  root.addEventListener('online',function(){if(tok())root.setTimeout(function(){hydrateAfterLogin(current()||sess())},700)});
  if(tok()&&sess()){unlockApp(current()||sess(),false);setTimeout(function(){hydrateAfterLogin(current()||sess())},900)}
}
root.ATPLMobileSharedHardFix={login:hardLogin,pullMaster:function(){return pullMaster(true)},syncAll:async function(){var n=await pullMaster(true);await backgroundShared();return n},version:function(){return BUILD}};
root.ATPLMobileSharedHardfixV1=root.ATPLMobileSharedHardFix;
if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})(window);
