/* Arora ERP — Mobile Shared Data Hard Fix V1
   Guarantees backend-first login and same-account cross-device Employee Master hydration.
   Additive hard-fix: capture-phase login owns the login button so legacy local login cannot win.
*/
(function(root){
'use strict';
var BUILD='2026.09.19-mobile-shared-hardfix1';
if(!root||root.__ATPL_MOBILE_SHARED_HARDFIX__===BUILD)return;
root.__ATPL_MOBILE_SHARED_HARDFIX__=BUILD;

var API='https://script.google.com/macros/s/AKfycby99_893hVtbWOQr67ikxIwiq81MWW8JAa2LuxTu67JBxjQ_iWb-YkqhBmW0RrHU512SQ/exec';
var USERS='ATPL_UserAccess_V1',SESS='ATPL_UserSession_V5',TOKEN='ATPL_RemoteToken_V1',ALT='ATPL_SharedToken_V1',MASTER='AroraTextilesEmployeeMasterV3';
var busy=false,lastMasterPull=0;

function q(id){return root.document.getElementById(id)}
function text(v){return v==null?'':String(v).trim()}
function J(s,d){try{return JSON.parse(s)}catch(_){return d}}
function tok(){try{return text(root.sessionStorage.getItem(TOKEN)||root.sessionStorage.getItem(ALT)||'')}catch(_){return''}}
function sess(){try{var s=J(root.sessionStorage.getItem(SESS)||'null',null);return s&&s.id?s:null}catch(_){return null}}
function current(){var s=sess();if(!s)return null;var a=J(root.localStorage.getItem(USERS)||'[]',[]),id=text(s.id).toLowerCase();return (Array.isArray(a)?a:[]).find(function(u){return text(u&&u.id).toLowerCase()===id})||null}
function api(p,timeout){return new Promise(function(ok,no){
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
  root.sessionStorage.setItem(SESS,JSON.stringify({id:user.id}));
  root.sessionStorage.setItem(TOKEN,token);root.sessionStorage.setItem(ALT,token)
}
function has(u,p){return !!u&&(u.admin===true||(Array.isArray(u.access)&&(u.access.indexOf('*')>=0||u.access.indexOf(p)>=0)))}
function applyAccess(){
  var u=current();if(!u)return;
  Array.prototype.forEach.call(root.document.querySelectorAll('.vitem[id^="vn-"]'),function(el){var id=el.id.slice(3),ok=id==='useraccess'?u.admin===true:has(u,id);el.hidden=!ok;if(ok){el.classList.remove('uaNoAccess');el.style.removeProperty('display');el.removeAttribute('aria-hidden')}else{el.classList.add('uaNoAccess');el.style.setProperty('display','none','important');el.setAttribute('aria-hidden','true')}});
  Array.prototype.forEach.call(root.document.querySelectorAll('[id^="page-"]'),function(pg){var id=pg.id.slice(5),ok=id==='useraccess'?u.admin===true:has(u,id);if(ok){pg.hidden=false;pg.classList.remove('uaDeniedPage','uaNoAccess');pg.style.removeProperty('display');pg.removeAttribute('aria-hidden')}else{pg.hidden=true;pg.classList.add('uaDeniedPage');pg.style.setProperty('display','none','important')}});
  var who=q('uaWho'),lo=q('uaLogoutBtn');if(who){who.style.display='inline-flex';who.textContent='👤 '+text(u.name||u.id)}if(lo)lo.style.display='inline-flex'
}
function cleanMaster(a){return (Array.isArray(a)?a:[]).filter(function(r){var id=text(r&&r.emp_id);return r&&r._atpl_system!==true&&id.indexOf('__ATPL_SYS__')!==0})}
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
  var t=tok();if(!t)return 0;if(!force&&Date.now()-lastMasterPull<8000)return cleanMaster(J(root.localStorage.getItem(MASTER)||'[]',[])).length;
  lastMasterPull=Date.now();var r=await api({action:'getEmployeeMaster',token:t},25000);
  if(!(r&&r.ok&&Array.isArray(r.records)))throw new Error(r&&r.error||'Employee Master cloud load failed');
  return injectMaster(r.records)
}
async function pullUsers(user){
  if(!(user&&user.admin===true))return [user];
  try{var r=await api({action:'listUsers',token:tok()},12000);if(r&&r.ok&&Array.isArray(r.users)&&r.users.length){root.localStorage.setItem(USERS,JSON.stringify(r.users));return r.users}}catch(_){}
  return [user]
}
async function backgroundShared(){
  try{if(root.ATPLSharedActivityV2&&typeof root.ATPLSharedActivityV2.syncCloud==='function')await root.ATPLSharedActivityV2.syncCloud()}catch(e){console.warn('Activity background pull failed',e)}
  try{if(root.ATPLComplianceDOLV2&&typeof root.ATPLComplianceDOLV2.syncCloud==='function')await root.ATPLComplianceDOLV2.syncCloud()}catch(e){console.warn('DOL background pull failed',e)}
  try{if(root.ATPLCloudSharedStorageV1&&typeof root.ATPLCloudSharedStorageV1.syncNow==='function')root.ATPLCloudSharedStorageV1.syncNow()}catch(_){}
}
function firstAllowed(u){var x=Array.prototype.find.call(root.document.querySelectorAll('.vitem[id^="vn-"]'),function(el){return has(u,el.id.slice(3))});return x?x.id.slice(3):null}
async function hardLogin(ev){
  if(ev){ev.preventDefault();ev.stopPropagation();if(ev.stopImmediatePropagation)ev.stopImmediatePropagation()}
  if(busy)return;var id=q('uaLoginId'),pw=q('uaLoginPass');if(!id||!pw)return;
  var uid=id.value.trim(),pass=pw.value;if(!uid||!pass){setStatus('User ID aur Password enter karo.',true);return}
  busy=true;setStatus('');busyBtn(true,'VERIFYING...');
  try{
    var h=await sha256(pass),lr=await api({action:'login',user_id:uid,password_hash:h},15000);
    if(!(lr&&lr.ok&&lr.user&&lr.token))throw new Error(lr&&lr.error||'Wrong User ID or Password.');
    setSession(lr.user,lr.token);await pullUsers(lr.user);applyAccess();
    busyBtn(true,'LOADING EMPLOYEES...');
    var count=await pullMaster(true);
    var login=q('uaLogin');if(login)login.style.display='none';root.document.body.classList.remove('uaLocked');
    var landing=q('landingPage');if(landing){landing.style.display='flex';landing.style.opacity='1';landing.style.visibility='visible';landing.style.pointerEvents='auto'}
    applyAccess();var u=current()||lr.user,p=firstAllowed(u);if(p&&typeof root.goPage==='function')try{root.goPage(p)}catch(_){}
    setStatus('');try{if(typeof root.showToast==='function')root.showToast('☁ '+count+' employee records loaded from shared cloud')}catch(_){}
    setTimeout(backgroundShared,0)
  }catch(e){setStatus(e&&e.message?e.message:String(e),true)}
  finally{busy=false;busyBtn(false)}
}
function captureClick(ev){var b=ev.target&&ev.target.closest?ev.target.closest('#uaLoginBtn'):null;if(b)hardLogin(ev)}
function captureEnter(ev){if(ev.key!=='Enter')return;var p=q('uaLoginPass');if(p&&ev.target===p)hardLogin(ev)}
function hookNav(){
  root.document.addEventListener('click',function(ev){
    var x=ev.target&&ev.target.closest?ev.target.closest('#vn-empmaster,#vn-employee,#vn-emaster,#vn-employees'):null;
    if(x&&tok())setTimeout(function(){pullMaster(true).catch(function(e){console.warn(e)})},40);
    var d=ev.target&&ev.target.closest?ev.target.closest('#vn-esictodol,#vn-pftodol'):null;
    if(d&&tok())setTimeout(backgroundShared,80)
  },true)
}
function boot(){
  root.document.addEventListener('click',captureClick,true);root.document.addEventListener('keydown',captureEnter,true);hookNav();
  root.addEventListener('focus',function(){if(tok())pullMaster(false).then(function(){backgroundShared()}).catch(function(){})});
  root.addEventListener('online',function(){if(tok())pullMaster(true).then(function(){backgroundShared()}).catch(function(){})});
  root.document.addEventListener('visibilitychange',function(){if(!root.document.hidden&&tok())pullMaster(false).then(function(){backgroundShared()}).catch(function(){})});
  if(tok()&&sess())pullMaster(true).then(function(){applyAccess();backgroundShared()}).catch(function(){})
}
root.ATPLMobileSharedHardFix={login:hardLogin,pullMaster:function(){return pullMaster(true)},syncAll:async function(){var n=await pullMaster(true);await backgroundShared();return n},version:function(){return BUILD}};
if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})(window);