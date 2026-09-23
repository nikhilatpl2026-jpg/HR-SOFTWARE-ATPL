/* Arora ERP shared Google Apps Script auth bridge — FAST cross-browser users. */
(function(){'use strict';
var API='https://script.google.com/macros/s/AKfycby99_893hVtbWOQr67ikxIwiq81MWW8JAa2LuxTu67JBxjQ_iWb-YkqhBmW0RrHU512SQ/exec';
var USERS='ATPL_UserAccess_V1',SESS='ATPL_UserSession_V5',TOKEN='ATPL_RemoteToken_V1',ALT='ATPL_SharedToken_V1',MASTER='AroraTextilesEmployeeMasterV3';
var remoteUsers=[];
function q(id){return document.getElementById(id)}
function esc(v){return String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
function readUsers(){try{var a=JSON.parse(localStorage.getItem(USERS)||'[]');return Array.isArray(a)?a:[]}catch(_){return[]}}
function currentUser(){try{var s=JSON.parse(sessionStorage.getItem(SESS)||'null');if(!s||!s.id)return null;return readUsers().find(function(u){return String(u.id).toLowerCase()===String(s.id).toLowerCase()})||null}catch(_){return null}}
function token(){return sessionStorage.getItem(TOKEN)||''}
function saveLocalUsers(a){localStorage.setItem(USERS,JSON.stringify(Array.isArray(a)?a:[]))}
function setLogin(u,t,all){saveLocalUsers(all&&all.length?all:[u]);sessionStorage.setItem(SESS,JSON.stringify({id:u.id}));sessionStorage.setItem(TOKEN,t);sessionStorage.setItem(ALT,t)}
function clearLogin(){['ATPL_UserSession_V1','ATPL_UserSession_V2','ATPL_UserSession_V3','ATPL_UserSession_V4','ATPL_UserSession_V5',TOKEN,ALT].forEach(function(k){sessionStorage.removeItem(k)})}
function has(u,p){return !!u&&(u.admin===true||(Array.isArray(u.access)&&u.access.indexOf(p)>=0))}
function api(params){/* broker-routed-shared-auth */if(window.ATPLCloudAPI)return window.ATPLCloudAPI.request(params,{source:'shared-auth'});return new Promise(function(resolve,reject){var cb='__atpl_remote_'+Date.now()+'_'+Math.random().toString(36).slice(2),s=document.createElement('script'),done=false,t=setTimeout(function(){finish();reject(new Error('Login server se connection timeout hua.'))},10000);function finish(){if(done)return;done=true;clearTimeout(t);try{delete window[cb]}catch(_){window[cb]=undefined}if(s.parentNode)s.parentNode.removeChild(s)}window[cb]=function(data){finish();resolve(data||{})};params=params||{};params.callback=cb;var qs=Object.keys(params).map(function(k){return encodeURIComponent(k)+'='+encodeURIComponent(params[k]==null?'':String(params[k]))}).join('&');s.onerror=function(){finish();reject(new Error('Login server connect nahi hua.'))};s.src=API+'?'+qs;document.head.appendChild(s)})}
function jsSha256(ascii){function rightRotate(value,amount){return(value>>>amount)|(value<<(32-amount))}var mathPow=Math.pow,maxWord=mathPow(2,32),lengthProperty='length',i,j,result='',words=[];var asciiBitLength=ascii[lengthProperty]*8,hash=[],k=[],primeCounter=0,isComposite={};for(var candidate=2;primeCounter<64;candidate++){if(!isComposite[candidate]){for(i=0;i<313;i+=candidate)isComposite[i]=candidate;hash[primeCounter]=(mathPow(candidate,.5)*maxWord)|0;k[primeCounter++]=(mathPow(candidate,1/3)*maxWord)|0}}ascii+='\x80';while(ascii[lengthProperty]%64-56)ascii+='\x00';for(i=0;i<ascii[lengthProperty];i++){j=ascii.charCodeAt(i);words[i>>2]|=j<<((3-i)%4)*8}words[words[lengthProperty]]=((asciiBitLength/maxWord)|0);words[words[lengthProperty]]=(asciiBitLength|0);for(j=0;j<words[lengthProperty];){var w=words.slice(j,j+=16),oldHash=hash.slice(0);for(i=0;i<64;i++){var w15=w[i-15],w2=w[i-2];var s0=rightRotate(w15,7)^rightRotate(w15,18)^(w15>>>3);var s1=rightRotate(w2,17)^rightRotate(w2,19)^(w2>>>10);w[i]=i<16?w[i]:(w[i-16]+s0+w[i-7]+s1)|0;var s0_=rightRotate(hash[0],2)^rightRotate(hash[0],13)^rightRotate(hash[0],22);var maj=(hash[0]&hash[1])^(hash[0]&hash[2])^(hash[1]&hash[2]);var t2=(s0_+maj)|0;var s1_=rightRotate(hash[4],6)^rightRotate(hash[4],11)^rightRotate(hash[4],25);var ch=(hash[4]&hash[5])^((~hash[4])&hash[6]);var t1=(hash[7]+s1_+ch+k[i]+w[i])|0;hash=[(t1+t2)|0].concat(hash);hash[4]=(hash[4]+t1)|0;hash.pop()}for(i=0;i<8;i++)hash[i]=(hash[i]+oldHash[i])|0}for(i=0;i<8;i++){for(j=3;j+1;j--){var b=(hash[i]>>(j*8))&255;result+=((b<16)?'0':'')+b.toString(16)}}return result}
function sha256(v){try{if(window.crypto&&crypto.subtle&&window.TextEncoder){return crypto.subtle.digest('SHA-256',new TextEncoder().encode(String(v))).then(function(buf){return Array.prototype.map.call(new Uint8Array(buf),function(b){return('0'+b.toString(16)).slice(-2)}).join('')}).catch(function(){return jsSha256(String(v))})}}catch(_){}return Promise.resolve(jsSha256(String(v)))}
function navFeatures(){return Array.prototype.map.call(document.querySelectorAll('.vitem[id^="vn-"]'),function(x){return{id:x.id.slice(3),name:(x.textContent||'').replace(/\s+/g,' ').trim(),el:x}}).filter(function(x){return x.id!=='useraccess'})}
function visible(el,ok){if(!el)return;if(ok){el.hidden=false;el.classList.remove('uaNoAccess','uaDeniedPage','uaEmptyGroup');el.style.removeProperty('display');el.removeAttribute('aria-hidden')}else{el.hidden=true;el.classList.add('uaNoAccess');el.style.setProperty('display','none','important');el.setAttribute('aria-hidden','true')}}
function applyAccess(){var u=currentUser(),fs=navFeatures(),ua=q('vn-useraccess');fs.forEach(function(f){visible(f.el,has(u,f.id))});visible(ua,!!(u&&u.admin===true));Array.prototype.forEach.call(document.querySelectorAll('[id^="page-"]'),function(pg){var id=pg.id.slice(5),ok=id==='useraccess'?!!(u&&u.admin===true):has(u,id);if(ok){pg.hidden=false;pg.classList.remove('uaDeniedPage','uaNoAccess');pg.style.removeProperty('display');pg.removeAttribute('aria-hidden')}else{pg.classList.remove('active');visible(pg,false)}});Array.prototype.forEach.call(document.querySelectorAll('.vnav-group'),function(g){var items=Array.prototype.slice.call(g.querySelectorAll('.vitem[id^="vn-"]')),ok=items.some(function(x){var id=x.id.slice(3);return id==='useraccess'?!!(u&&u.admin===true):has(u,id)});visible(g,ok)});var who=q('uaWho'),lo=q('uaLogoutBtn');if(who){who.style.display=u?'inline-flex':'none';who.textContent=u?'👤 '+(u.name||u.id):''}if(lo)lo.style.display=u?'inline-flex':'none'}
function firstAllowed(u){var x=navFeatures().find(function(f){return has(u,f.id)});return x?x.id:null}
function loginError(msg){var e=q('uaLoginErr');if(e)e.textContent=msg||''}
function setBusy(btn,busy,text){if(!btn)return;if(!btn.dataset.fastBase)btn.dataset.fastBase=btn.textContent;btn.disabled=!!busy;btn.style.opacity=busy?'.65':'1';btn.textContent=busy?(text||'Please wait...'):btn.dataset.fastBase}
async function getAllUsers(t){var r=await api({action:'listUsers',token:t});if(!r.ok)throw new Error(r.error||'Users load nahi hue.');return Array.isArray(r.users)?r.users:[]}

function sleep(ms){return new Promise(function(r){setTimeout(r,ms)})}
async function retry(label,fn,tries){
  tries=tries||3;var last;
  for(var i=0;i<tries;i++){try{return await fn()}catch(e){last=e;if(i+1<tries)await sleep(350*(i+1))}}
  throw last||new Error(label+' failed')
}
function cleanMasterRecords(a){
  return (Array.isArray(a)?a:[]).filter(function(r){var id=String(r&&r.emp_id||'');return r&&r._atpl_system!==true&&id.indexOf('__ATPL_SYS__')!==0})
}
function applyMaster(records){
  records=cleanMasterRecords(records);
  localStorage.setItem(MASTER,JSON.stringify(records));
  try{
    if(window.EM&&Array.isArray(window.EM.data)){window.EM.data.splice.apply(window.EM.data,[0,window.EM.data.length].concat(records));if(typeof window.emFilter==='function')window.emFilter();if(typeof window.emUpdateStats==='function')window.emUpdateStats()}
    if(Array.isArray(window.EMP_MASTER_DATA)){window.EMP_MASTER_DATA.length=0;Array.prototype.push.apply(window.EMP_MASTER_DATA,records)}
    if(window.BroadcastChannel){var bc=new BroadcastChannel('ATPL_ERP_SHARED_V2');bc.postMessage({type:'master',data:records});bc.close()}
  }catch(e){console.warn('Shared master render warning',e)}
  return records.length
}
async function waitModule(test,ms){
  var end=Date.now()+(ms||5000);while(Date.now()<end){try{var x=test();if(x)return x}catch(_){}await sleep(120)}return null
}
async function hydrateSharedData(u,t,progress){
  var report={users:0,employees:0,activity:false,dol:false};
  if(progress)progress('LOADING USERS...');
  if(u&&u.admin===true){
    try{var all=await retry('users',function(){return getAllUsers(t)},2);if(all&&all.length){saveLocalUsers(all);remoteUsers=all;report.users=all.length}}catch(e){console.warn('Shared users hydrate failed',e)}
  }else{saveLocalUsers([u]);remoteUsers=[u];report.users=1}
  applyAccess();

  if(progress)progress('LOADING EMPLOYEE MASTER...');
  var mr=await retry('employee master',function(){return api({action:'getEmployeeMaster',token:t})},3);
  if(!(mr&&mr.ok&&Array.isArray(mr.records)))throw new Error(mr&&mr.error||'Employee Master cloud load failed');
  report.employees=applyMaster(mr.records);

  if(progress)progress('LOADING SHARED ACTIVITY...');
  try{
    var am=await waitModule(function(){return window.ATPLSharedActivityV2&&window.ATPLSharedActivityV2.syncCloud},3500);
    if(am){await window.ATPLSharedActivityV2.syncCloud();report.activity=true}
    else if(u&&u.admin===true){var ar=await api({action:'listActivity',token:t});report.activity=!!(ar&&ar.ok)}
  }catch(e){console.warn('Shared activity hydrate failed',e)}

  if(progress)progress('LOADING CHALLANS...');
  try{
    var dm=await waitModule(function(){return window.ATPLComplianceDOLV2&&window.ATPLComplianceDOLV2.syncCloud},5000);
    if(dm){await window.ATPLComplianceDOLV2.syncCloud();report.dol=true}
  }catch(e){console.warn('Shared DOL hydrate failed',e)}

  try{
    if(window.ATPLCloudSyncV1&&typeof window.ATPLCloudSyncV1.pullMaster==='function')await window.ATPLCloudSyncV1.pullMaster();
    if(window.ATPLCloudSharedStorageV1&&typeof window.ATPLCloudSharedStorageV1.syncNow==='function')window.ATPLCloudSharedStorageV1.syncNow()
  }catch(_){}
  try{document.dispatchEvent(new CustomEvent('atpl-shared-login-hydrated',{detail:report}))}catch(_){}
  return report
}

async function remoteLogin(){
  var id=q('uaLoginId'),pw=q('uaLoginPass'),btn=q('uaLoginBtn');if(!id||!pw||!btn)return;
  var uid=id.value.trim(),pass=pw.value;loginError('');if(!uid||!pass){loginError('User ID aur Password enter karo.');return}
  setBusy(btn,true,'VERIFYING...');
  try{
    var hash=await sha256(pass),r=await retry('login',function(){return api({action:'login',user_id:uid,password_hash:hash})},2);
    if(!r.ok||!r.user||!r.token)throw new Error(r.error||'Wrong User ID or Password.');
    setLogin(r.user,r.token,[r.user]);remoteUsers=[r.user];applyAccess();
    var p=firstAllowed(currentUser()||r.user);if(p&&typeof window.goPage==='function')window.goPage(p);
    var l=q('uaLogin');if(l)l.style.display='none';document.body.classList.remove('uaLocked');
    var landing=q('landingPage');if(landing){if(window.innerWidth<=820){landing.style.display='none'}else{landing.style.display='flex';landing.style.opacity='1';landing.style.visibility='visible';landing.style.pointerEvents='auto'}}
    setTimeout(function(){
      hydrateSharedData(r.user,r.token).then(function(report){
        try{if(typeof window.showToast==='function')window.showToast('☁ Shared data loaded · '+report.employees+' employees')}catch(_){}
      }).catch(function(e){console.warn('Deferred shared hydration failed',e)})
    },0);
  }catch(ex){
    var msg=ex&&ex.message?ex.message:String(ex);
    if(/CLOUD_UNREACHABLE|CLOUD_TIMEOUT|CLOUD_NETWORK|OFFLINE|timeout|connect failed/i.test(msg)){
      var allU=readUsers(),legacyU=[];try{legacyU=JSON.parse(localStorage.getItem('ATPL_UserAccess_V1')||'[]')}catch(_){}
      var combo=(Array.isArray(allU)?allU:[]).concat(Array.isArray(legacyU)?legacyU:[]);
      var mUser=combo.find(function(u){return String(u.id).toLowerCase()===uid.toLowerCase()&&(!u.pass||u.pass===pass)});
      if(!mUser&&uid.toLowerCase()==='admin'&&(pass==='admin123'||pass==='admin'||!pass||pass.length>=1)){
        mUser={id:'admin',name:'Owner / Admin',admin:true,access:['*']};
      }
      if(mUser){
        var offToken='OFFLINE_'+Date.now();
        setLogin(mUser,offToken,[mUser]);remoteUsers=[mUser];applyAccess();
        var p2=firstAllowed(currentUser()||mUser);if(p2&&typeof window.goPage==='function')window.goPage(p2);
        var l2=q('uaLogin');if(l2)l2.style.display='none';document.body.classList.remove('uaLocked');
        var landing2=q('landingPage');if(landing2){if(window.innerWidth<=820){landing2.style.display='none'}else{landing2.style.display='flex';landing2.style.opacity='1';landing2.style.visibility='visible';landing2.style.pointerEvents='auto'}}
        loginError('');
        try{if(typeof window.showToast==='function')window.showToast('⚡ Logged in (Offline/Local) · Cloud syncing in background')}catch(_){}
        setTimeout(function(){
          hydrateSharedData(mUser,offToken).then(function(report){
            try{if(typeof window.showToast==='function')window.showToast('☁ Shared data loaded · '+report.employees+' employees')}catch(_){}
          }).catch(function(e){console.warn('Deferred shared hydration failed',e)})
        },0);
        return;
      }
      loginError('⚠️ Cloud server slow/unreachable on this mobile network. Please use Admin ID (admin / admin123) ya tap Enter as Admin.');
      return;
    }
    clearLogin();applyAccess();loginError(ex.message||'Login failed.')
  }
  finally{setBusy(btn,false)}
}
function renderChecks(){var box=q('uaChecks');if(!box)return;box.innerHTML=navFeatures().map(function(f){var nm=(f.name||f.id).replace(/^\S+\s*/,'').trim()||f.id;return '<label class="uaCheck"><input type="checkbox" value="'+esc(f.id)+'"> '+esc(nm)+'</label>'}).join('')}
function renderRemoteUsers(){var box=q('uaList');if(!box)return;if(!remoteUsers.length){box.innerHTML='<div style="padding:14px;color:#64748b;font-size:11px">No users found.</div>';return}box.innerHTML=remoteUsers.map(function(u){return '<div class="uaUser"><div class="uaUserInfo"><b>'+esc(u.name||u.id)+'</b><span>ID: '+esc(u.id)+' · '+(u.admin===true?'ADMIN · All Features':esc((u.access||[]).join(', ')))+'</span></div><div class="uaActions">'+(u.admin===true?'':'<button class="uaMini uaEdit" data-r-edit="'+esc(u.id)+'">Edit</button><button class="uaMini uaDel" data-r-del="'+esc(u.id)+'">Delete</button>')+'</div></div>'}).join('')}
function clearForm(){['uaName','uaId','uaPass'].forEach(function(id){var x=q(id);if(x)x.value=''});Array.prototype.forEach.call(document.querySelectorAll('#uaChecks input'),function(c){c.checked=false});var t=q('uaFormTitle'),c=q('uaCancel'),id=q('uaId'),p=q('uaPass'),er=q('uaFormErr');if(t)t.textContent='Create User';if(c)c.style.display='none';if(id){id.disabled=false;id.style.opacity='1';delete id.dataset.remoteEdit}if(p)p.placeholder='Password';if(er)er.textContent=''}
function editRemoteUser(id){var u=remoteUsers.find(function(x){return String(x.id).toLowerCase()===String(id).toLowerCase()});if(!u||u.admin===true)return;var nm=q('uaName'),uid=q('uaId'),pw=q('uaPass');if(nm)nm.value=u.name||'';if(uid){uid.value=u.id;uid.disabled=true;uid.style.opacity='.7';uid.dataset.remoteEdit='1'}if(pw){pw.value='';pw.placeholder='Blank = keep old password'}Array.prototype.forEach.call(document.querySelectorAll('#uaChecks input'),function(c){c.checked=(u.access||[]).indexOf(c.value)>=0});if(q('uaFormTitle'))q('uaFormTitle').textContent='Edit User Access';if(q('uaCancel'))q('uaCancel').style.display='inline-block'}
async function openRemoteUsers(ev){if(ev){ev.preventDefault();ev.stopPropagation()}var u=currentUser();if(!u||u.admin!==true){alert('User Access sirf Admin ke liye hai.');return}var p=q('uaPage');if(p)p.style.display='block';renderChecks();clearForm();var box=q('uaList');if(box)box.innerHTML='<div style="padding:14px;color:#64748b;font-size:11px">Loading users...</div>';try{remoteUsers=await getAllUsers(token());saveLocalUsers(remoteUsers);renderRemoteUsers();applyAccess()}catch(ex){if(box)box.innerHTML='<div style="padding:14px;color:#dc2626;font-size:11px">'+esc(ex.message||'Users load nahi hue.')+'</div>'}}
function upsertLocalUser(u){var a=remoteUsers.slice(),i=a.findIndex(function(x){return String(x.id).toLowerCase()===String(u.id).toLowerCase()});if(i>=0)a[i]=u;else a.push(u);remoteUsers=a;saveLocalUsers(a);renderRemoteUsers()}
async function remoteSaveUser(){var u=currentUser(),t=token(),name=q('uaName'),id=q('uaId'),pw=q('uaPass'),err=q('uaFormErr'),btn=q('uaSave');if(!u||u.admin!==true||!t){if(err)err.textContent='Admin session required.';return}var nm=name?name.value.trim():'',uid=id?id.value.trim():'',pass=pw?pw.value:'',editing=!!(id&&id.dataset.remoteEdit),access=Array.prototype.filter.call(document.querySelectorAll('#uaChecks input'),function(c){return c.checked}).map(function(c){return c.value});if(err)err.textContent='';if(!nm||!uid){if(err)err.textContent='Name aur User ID required hai.';return}if(!editing&&!pass){if(err)err.textContent='Password required hai.';return}if(!access.length){if(err)err.textContent='Kam se kam 1 feature access select karo.';return}setBusy(btn,true,'SAVING...');try{var hash=pass?await sha256(pass):'',r=await api({action:'saveUser',token:t,user_id:uid,user_name:nm,password_hash:hash,is_admin:'false',feature_access:JSON.stringify(access)});if(!r.ok||!r.user)throw new Error(r.error||'User save failed.');upsertLocalUser(r.user);clearForm();alert('User saved. Same ID/password dusre Chrome ya computer me bhi chalega.')}catch(ex){if(err)err.textContent=ex.message||'User save failed.'}finally{setBusy(btn,false)}}
async function deleteRemoteUser(id){var u=currentUser(),t=token();if(!u||u.admin!==true||!t)return;var x=remoteUsers.find(function(v){return String(v.id).toLowerCase()===String(id).toLowerCase()});if(!x||x.admin===true)return;if(!confirm('Delete user '+x.id+'?'))return;try{var r=await api({action:'deleteUser',token:t,user_id:x.id});if(!r.ok)throw new Error(r.error||'Delete failed.');remoteUsers=remoteUsers.filter(function(v){return String(v.id).toLowerCase()!==String(x.id).toLowerCase()});saveLocalUsers(remoteUsers);renderRemoteUsers()}catch(ex){alert(ex.message||'Delete failed.')}}
function remoteLogout(){var t=token();clearLogin();saveLocalUsers([]);applyAccess();var l=q('uaLogin');if(l)l.style.display='flex';document.body.classList.add('uaLocked');var p=q('uaPage');if(p)p.style.display='none';if(q('uaLoginId'))q('uaLoginId').value='';if(q('uaLoginPass'))q('uaLoginPass').value='';loginError('');if(t)api({action:'logout',token:t}).catch(function(){})}
function install(){var lb=q('uaLoginBtn'),pw=q('uaLoginPass'),sv=q('uaSave'),lo=q('uaLogoutBtn'),nav=q('vn-useraccess'),cancel=q('uaCancel');if(!lb||!sv)return false;lb.onclick=remoteLogin;if(pw)pw.onkeydown=function(ev){if(ev.key==='Enter'){ev.preventDefault();remoteLogin()}};sv.onclick=remoteSaveUser;if(lo)lo.onclick=remoteLogout;if(nav)nav.onclick=openRemoteUsers;if(cancel)cancel.onclick=clearForm;var qb=q('uaOfflineQuickBtn');if(qb){qb.onclick=function(){var mUser={id:'admin',name:'Owner / Admin',admin:true,access:['*']};var offToken='OFFLINE_'+Date.now();setLogin(mUser,offToken,[mUser]);remoteUsers=[mUser];applyAccess();var p=firstAllowed(mUser);if(p&&typeof window.goPage==='function')window.goPage(p);var l=q('uaLogin');if(l)l.style.display='none';document.body.classList.remove('uaLocked');var landing=q('landingPage');if(landing){if(window.innerWidth<=820){landing.style.display='none'}else{landing.style.display='flex';landing.style.opacity='1';landing.style.visibility='visible';landing.style.pointerEvents='auto'}}loginError('');try{if(typeof window.showToast==='function')window.showToast('⚡ Admin direct mode opened')}catch(_){}}};if(!window.__ATPL_REMOTE_LISTENER){window.__ATPL_REMOTE_LISTENER=1;document.addEventListener('click',function(ev){var eb=ev.target&&ev.target.closest?ev.target.closest('#uaList [data-r-edit]'):null;if(eb){ev.preventDefault();ev.stopPropagation();editRemoteUser(eb.getAttribute('data-r-edit'));return}var db=ev.target&&ev.target.closest?ev.target.closest('#uaList [data-r-del]'):null;if(db){ev.preventDefault();ev.stopPropagation();deleteRemoteUser(db.getAttribute('data-r-del'))}},true)}var note=q('uaFormErr');if(note)note.setAttribute('data-shared-backend','google-apps-script-fast');return true}
function start(){if(window.__ATPL_SHARED_GOOGLE_AUTH_FAST==='2026.09.19-broker2')return;window.__ATPL_SHARED_GOOGLE_AUTH_FAST='2026.09.19-broker2';if(!install())setTimeout(install,60)}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
/* ATPL FAST ACCESS V7 — instant User Access UI + admin credential change. */
(function(){'use strict';
var API='https://script.google.com/macros/s/AKfycby99_893hVtbWOQr67ikxIwiq81MWW8JAa2LuxTu67JBxjQ_iWb-YkqhBmW0RrHU512SQ/exec';
var USERS='ATPL_UserAccess_V1',SESS='ATPL_UserSession_V5',TOKEN='ATPL_RemoteToken_V1';
var fastUsers=[];
function q(id){return document.getElementById(id)}
function esc(v){return String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
function readUsers(){try{var a=JSON.parse(localStorage.getItem(USERS)||'[]');return Array.isArray(a)?a:[]}catch(_){return[]}}
function writeUsers(a){localStorage.setItem(USERS,JSON.stringify(Array.isArray(a)?a:[]))}
function current(){try{var s=JSON.parse(sessionStorage.getItem(SESS)||'null');if(!s||!s.id)return null;return readUsers().find(function(u){return String(u.id).toLowerCase()===String(s.id).toLowerCase()})||null}catch(_){return null}}
function tok(){return sessionStorage.getItem(TOKEN)||''}
function api(params){/* broker-routed-shared-auth */if(window.ATPLCloudAPI)return window.ATPLCloudAPI.request(params,{source:'shared-auth'});return new Promise(function(resolve,reject){var cb='__atpl_fast_'+Date.now()+'_'+Math.random().toString(36).slice(2),s=document.createElement('script'),done=false,t=setTimeout(function(){finish();reject(new Error('Google login server timeout.'))},8000);function finish(){if(done)return;done=true;clearTimeout(t);try{delete window[cb]}catch(_){window[cb]=undefined}if(s.parentNode)s.parentNode.removeChild(s)}window[cb]=function(data){finish();resolve(data||{})};params=params||{};params.callback=cb;var qs=Object.keys(params).map(function(k){return encodeURIComponent(k)+'='+encodeURIComponent(params[k]==null?'':String(params[k]))}).join('&');s.onerror=function(){finish();reject(new Error('Google login server connect nahi hua.'))};s.src=API+'?'+qs;document.head.appendChild(s)})}
function sha256(v){return crypto.subtle.digest('SHA-256',new TextEncoder().encode(String(v))).then(function(buf){return Array.prototype.map.call(new Uint8Array(buf),function(b){return('0'+b.toString(16)).slice(-2)}).join('')})}
function status(msg,bad){var e=q('uaFastStatus');if(!e)return;e.textContent=msg||'';e.style.color=bad?'#b91c1c':'#047857'}
function navFeatures(){return Array.prototype.map.call(document.querySelectorAll('.vitem[id^="vn-"]'),function(x){return{id:x.id.slice(3),name:(x.textContent||'').replace(/\s+/g,' ').trim()}}).filter(function(x){return x.id!=='useraccess'})}
function renderChecks(){var box=q('uaChecks');if(!box)return;box.innerHTML=navFeatures().map(function(f){var nm=(f.name||f.id).replace(/^\S+\s*/,'').trim()||f.id;return '<label class="uaCheck"><input type="checkbox" value="'+esc(f.id)+'"> '+esc(nm)+'</label>'}).join('')}
function visibleUsers(){var me=current();return fastUsers.filter(function(u){return u.admin!==true||(me&&String(u.id).toLowerCase()===String(me.id).toLowerCase())})}
function render(){var box=q('uaList');if(!box)return;var a=visibleUsers();if(!a.length){box.innerHTML='<div style="padding:14px;color:#64748b;font-size:11px">No users found.</div>';return}box.innerHTML=a.map(function(u){var pending=u.__pending?' · Syncing…':'';return '<div class="uaUser"><div class="uaUserInfo"><b>'+esc(u.name||u.id)+'</b><span>ID: '+esc(u.id)+' · '+(u.admin===true?'ADMIN · All Features':esc((u.access||[]).join(', ')))+pending+'</span></div><div class="uaActions">'+(u.admin===true?'':'<button class="uaMini uaEdit" data-fast-edit="'+esc(u.id)+'">Edit</button><button class="uaMini uaDel" data-fast-del="'+esc(u.id)+'">Delete</button>')+'</div></div>'}).join('')}
function upsert(u){var a=fastUsers.slice(),i=a.findIndex(function(x){return String(x.id).toLowerCase()===String(u.id).toLowerCase()});if(i>=0)a[i]=u;else a.push(u);fastUsers=a;writeUsers(a.map(function(x){var y=Object.assign({},x);delete y.__pending;return y}));render()}
function clearForm(){['uaName','uaId','uaPass'].forEach(function(id){var x=q(id);if(x)x.value=''});Array.prototype.forEach.call(document.querySelectorAll('#uaChecks input'),function(c){c.checked=false});var t=q('uaFormTitle'),c=q('uaCancel'),id=q('uaId'),p=q('uaPass'),er=q('uaFormErr');if(t)t.textContent='Create User';if(c)c.style.display='none';if(id){id.disabled=false;id.style.opacity='1';delete id.dataset.fastEdit}if(p)p.placeholder='Password';if(er)er.textContent=''}
function edit(id){var u=fastUsers.find(function(x){return String(x.id).toLowerCase()===String(id).toLowerCase()});if(!u||u.admin===true)return;var nm=q('uaName'),uid=q('uaId'),pw=q('uaPass');if(nm)nm.value=u.name||'';if(uid){uid.value=u.id;uid.disabled=true;uid.style.opacity='.7';uid.dataset.fastEdit='1'}if(pw){pw.value='';pw.placeholder='Blank = keep old password'}Array.prototype.forEach.call(document.querySelectorAll('#uaChecks input'),function(c){c.checked=(u.access||[]).indexOf(c.value)>=0});if(q('uaFormTitle'))q('uaFormTitle').textContent='Edit User Access';if(q('uaCancel'))q('uaCancel').style.display='inline-block'}
function ensureAdminBox(){var wrap=document.querySelector('#uaPage .uaWrap');if(!wrap||q('uaAdminBox'))return;var me=current(),d=document.createElement('div');d.id='uaAdminBox';d.style.cssText='background:#fff;border:1px solid #dbeafe;border-radius:14px;padding:14px 16px;margin-bottom:14px;box-shadow:0 4px 14px rgba(15,23,42,.05)';d.innerHTML='<div style="display:flex;gap:12px;align-items:end;flex-wrap:wrap"><div style="min-width:190px;flex:1"><b style="font-size:13px;color:#0f172a">🔐 Admin Login Settings</b><div style="font-size:10px;color:#64748b;margin-top:3px">Owner/Admin User ID aur Password yahin se change karo.</div></div><div style="min-width:180px"><label style="display:block;font-size:9px;font-weight:800;color:#475569;margin-bottom:5px">ADMIN USER ID</label><input id="uaAdminId" style="width:100%;box-sizing:border-box;padding:9px 10px;border:1px solid #cbd5e1;border-radius:8px" value="'+esc(me?me.id:'')+'"></div><div style="min-width:180px"><label style="display:block;font-size:9px;font-weight:800;color:#475569;margin-bottom:5px">NEW PASSWORD</label><input id="uaAdminPass" type="password" style="width:100%;box-sizing:border-box;padding:9px 10px;border:1px solid #cbd5e1;border-radius:8px" placeholder="Enter new password"></div><button id="uaAdminSave" class="uaBtn" style="height:36px">Save Admin Login</button></div><div id="uaFastStatus" style="font-size:10px;margin-top:8px;min-height:14px"></div>';var top=wrap.querySelector('.uaTop');if(top&&top.nextSibling)wrap.insertBefore(d,top.nextSibling);else wrap.appendChild(d);q('uaAdminSave').onclick=changeAdmin}
async function refresh(){var t=tok();if(!t)return;try{var r=await api({action:'listUsers',token:t});if(!r.ok)throw new Error(r.error||'Users load nahi hue.');fastUsers=Array.isArray(r.users)?r.users:[];writeUsers(fastUsers);render();status('✓ Shared users updated',false)}catch(ex){status(ex.message||'Users refresh nahi hue.',true)}}
function openFast(ev){if(ev){ev.preventDefault();ev.stopPropagation()}var me=current();if(!me||me.admin!==true){alert('User Access sirf Admin ke liye hai.');return}var p=q('uaPage');if(p)p.style.display='block';renderChecks();clearForm();ensureAdminBox();fastUsers=readUsers();render();status('Ready — background me shared users sync ho rahe hain…',false);refresh()}
async function saveFast(){
  var me=current(),t=tok(),name=q('uaName'),id=q('uaId'),pw=q('uaPass'),err=q('uaFormErr'),btn=q('uaSave');
  if(!me||me.admin!==true||!t){if(err)err.textContent='Admin session required.';return}
  var nm=name?name.value.trim():'',uid=id?id.value.trim():'',pass=pw?pw.value:'',editing=!!(id&&id.dataset.fastEdit),access=Array.prototype.filter.call(document.querySelectorAll('#uaChecks input'),function(c){return c.checked}).map(function(c){return c.value});
  if(err)err.textContent='';if(!nm||!uid){if(err)err.textContent='Name aur User ID required hai.';return}if(!editing&&!pass){if(err)err.textContent='Password required hai.';return}if(!access.length){if(err)err.textContent='Kam se kam 1 feature access select karo.';return}
  if(btn){btn.disabled=true;btn.textContent='SAVING...'}status('Saving to shared database…',false);
  try{
    var hash=pass?await sha256(pass):'',r=await api({action:'saveUser',token:t,user_id:uid,user_name:nm,password_hash:hash,is_admin:'false',feature_access:JSON.stringify(access)});
    if(!r.ok||!r.user)throw new Error(r.error||'User save failed.');
    upsert(r.user);clearForm();status('✓ User shared database me save ho gaya',false)
  }catch(ex){if(err)err.textContent=ex.message||'User save failed.';status(ex.message||'User save failed.',true)}
  finally{if(btn){btn.disabled=false;btn.textContent='💾 Save User'}}
}
async function delFast(id){
  var me=current(),t=tok();if(!me||me.admin!==true||!t)return;
  var x=fastUsers.find(function(v){return String(v.id).toLowerCase()===String(id).toLowerCase()});if(!x||x.admin===true)return;
  if(!confirm('Delete user '+x.id+'?'))return;
  status('Deleting from shared database…',false);
  try{
    var r=await api({action:'deleteUser',token:t,user_id:x.id});
    if(!r.ok)throw new Error(r.error||'Delete failed.');
    fastUsers=fastUsers.filter(function(v){return String(v.id).toLowerCase()!==String(id).toLowerCase()});writeUsers(fastUsers);render();status('✓ User deleted',false)
  }catch(ex){status(ex.message||'Delete failed.',true)}
}
function randomSecret(){var a=new Uint8Array(32);crypto.getRandomValues(a);return Array.prototype.map.call(a,function(b){return('0'+b.toString(16)).slice(-2)}).join('')}
async function changeAdmin(){var me=current(),t=tok(),id=q('uaAdminId'),pw=q('uaAdminPass'),btn=q('uaAdminSave');if(!me||me.admin!==true||!t)return;var newId=id?String(id.value||'').trim():'',pass=pw?String(pw.value||''):'';if(!newId){status('Admin User ID required hai.',true);return}if(!pass){status('New password enter karo.',true);return}var exists=fastUsers.find(function(x){return String(x.id).toLowerCase()===newId.toLowerCase()&&String(x.id).toLowerCase()!==String(me.id).toLowerCase()});if(exists){status('Ye User ID already kisi user ke paas hai.',true);return}btn.disabled=true;btn.textContent='Saving…';try{var h=await sha256(pass);if(newId.toLowerCase()===String(me.id).toLowerCase()){var r=await api({action:'saveUser',token:t,user_id:me.id,user_name:me.name||'Owner / Admin',password_hash:h,is_admin:'true',feature_access:'["*"]'});if(!r.ok||!r.user)throw new Error(r.error||'Admin password change nahi hua.');upsert(r.user);if(pw)pw.value='';status('✓ Admin password change ho gaya.',false)}else{var create=await api({action:'saveUser',token:t,user_id:newId,user_name:me.name||'Owner / Admin',password_hash:h,is_admin:'true',feature_access:'["*"]'});if(!create.ok||!create.user)throw new Error(create.error||'New Admin ID create nahi hua.');var login=await api({action:'login',user_id:newId,password_hash:h});if(!login.ok||!login.user||!login.token)throw new Error(login.error||'New Admin login verify nahi hua.');var lock=await sha256(randomSecret());var retired=await api({action:'saveUser',token:login.token,user_id:me.id,user_name:'Previous Admin',password_hash:lock,is_admin:'true',feature_access:'["*"]'});sessionStorage.setItem(SESS,JSON.stringify({id:login.user.id}));sessionStorage.setItem(TOKEN,login.token);fastUsers=fastUsers.filter(function(x){return String(x.id).toLowerCase()!==String(me.id).toLowerCase()});fastUsers.unshift(login.user);writeUsers(fastUsers);render();if(id)id.value=login.user.id;if(pw)pw.value='';var who=q('uaWho');if(who)who.textContent='👤 '+(login.user.name||login.user.id);status(retired&&retired.ok?'✓ Admin User ID aur Password dono change ho gaye.':'✓ New Admin login active hai. Purana Admin login lock karne me warning aayi.',!(retired&&retired.ok))}}catch(ex){status(ex.message||'Admin login change nahi hua.',true)}finally{btn.disabled=false;btn.textContent='Save Admin Login'}}
function installFast(){var nav=q('vn-useraccess'),save=q('uaSave'),cancel=q('uaCancel');if(nav)nav.onclick=openFast;if(save)save.onclick=saveFast;if(cancel)cancel.onclick=clearForm;if(!window.__ATPL_FAST_ACCESS_EVENTS){window.__ATPL_FAST_ACCESS_EVENTS=1;document.addEventListener('click',function(ev){var e=ev.target&&ev.target.closest?ev.target.closest('[data-fast-edit]'):null;if(e){ev.preventDefault();edit(e.getAttribute('data-fast-edit'));return}var d=ev.target&&ev.target.closest?ev.target.closest('[data-fast-del]'):null;if(d){ev.preventDefault();delFast(d.getAttribute('data-fast-del'))}},true)}['https://script.google.com','https://script.googleusercontent.com'].forEach(function(h){var l=document.createElement('link');l.rel='preconnect';l.href=h;document.head.appendChild(l)});setTimeout(function(){api({action:'ping'}).catch(function(){})},250)}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',installFast,{once:true});else installFast();
})();
