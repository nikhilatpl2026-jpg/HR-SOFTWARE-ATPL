/* Arora ERP — Permission Guard V2
   Re-applies feature access after lazy/dynamic modules mount, discovers live sidebar features cleanly,
   and enforces per-user Upload / Edit / Delete / View rights across all ERP modules.
*/
(function(root){
'use strict';
var BUILD='2026.11.13-permission-authority3';
if(!root||root.__ATPL_PERMISSION_GUARD__===BUILD)return;
root.__ATPL_PERMISSION_GUARD__=BUILD;

var USERS='ATPL_UserAccess_V1',SESS='ATPL_UserSession_V5',timer=0,observer=null;
var RIGHT_MODE='__right_mode:v1',ACT_PREFIX='__act:';
var MASTER_READ={cmd:1,files:1,audit:1,machineaudit:1,bankverify:1,dol:1,dolverify:1,ff:1,empmaster:1,hrdocs:1,mamsalary:1,challan:1,empdashboard:1,test:1,compliancecalendar:1,advance:1,servicehistory:1};
var KNOWN_HIDDEN={compliance:1,newjoin:1,misspunch:1,formula:1,test:1,cmd:1,attendanceaudit:1,empdashboard:1};

function json(v,d){try{return JSON.parse(v)}catch(_){return d}}
function text(v){return v==null?'':String(v).trim()}
function isOwner(id){return /^(admin|nikhil\s*1911|arora|hr)$/i.test(text(id))}
function isActionToken(tok){return typeof tok==='string'&&tok.indexOf('__')===0}

function featureIdsOnly(access){
  if(!Array.isArray(access))return [];
  var seen={},out=[];
  for(var i=0;i<access.length;i++){
    var t=text(access[i]);
    if(!t||isActionToken(t)||seen[t])continue;
    seen[t]=1;out.push(t);
  }
  return out;
}

function getRights(u){
  if(!u)return {configured:false,view:false,upload:false,edit:false,delete:false};
  if(u.admin===true||String(u.admin).toLowerCase()==='true'||isOwner(u.id)){
    return {configured:true,view:true,upload:true,edit:true,delete:true};
  }
  var acc=Array.isArray(u.access)?u.access:[];
  var configured=acc.indexOf(RIGHT_MODE)>=0;
  if(!configured){
    // Backward compatibility for legacy users created before granular rights existed
    return {configured:false,view:true,upload:true,edit:true,delete:true};
  }
  return {
    configured:true,
    view:acc.indexOf(ACT_PREFIX+'view')>=0||acc.indexOf('*')>=0||featureIdsOnly(acc).length>0,
    upload:acc.indexOf(ACT_PREFIX+'upload')>=0,
    edit:acc.indexOf(ACT_PREFIX+'edit')>=0,
    delete:acc.indexOf(ACT_PREFIX+'delete')>=0
  };
}

function buildAccessList(featureIds,rights){
  var out=[],seen={};
  (Array.isArray(featureIds)?featureIds:[]).forEach(function(id){
    var k=text(id);
    if(!k||isActionToken(k)||seen[k])return;
    seen[k]=1;out.push(k);
  });
  var r=rights||{};
  out.push(RIGHT_MODE);
  if(r.view!==false)out.push(ACT_PREFIX+'view');
  if(r.upload)out.push(ACT_PREFIX+'upload');
  if(r.edit)out.push(ACT_PREFIX+'edit');
  if(r.delete)out.push(ACT_PREFIX+'delete');
  return out;
}

function cleanFeatureName(el){
  if(!el)return '';
  try{
    var raw='';
    if(typeof el.cloneNode==='function'){
      var clone=el.cloneNode(true);
      if(clone&&typeof clone.querySelectorAll==='function'){
        Array.prototype.forEach.call(clone.querySelectorAll('.vi,.vbadge,.badge,.uaBadge,[class*="badge"],sup'),function(n){
          if(n&&n.parentNode)n.parentNode.removeChild(n);
        });
      }
      raw=text(clone&&clone.textContent);
    }else{
      raw=text(el.textContent);
    }
    raw=raw.replace(/\s+/g,' ').trim();
    // Remove only leading non-ASCII pictographs/symbols (never ASCII words like "AI", "PF", "ESIC")
    raw=raw.replace(/^[^\x00-\x7F\u00C0-\u024F]+\s*/g,'').trim();
    raw=raw.replace(/\s+(?:NEW|LIVE|BETA)$/i,'').replace(/\s+\d+$/,'').trim();
    if(raw)return raw;
  }catch(_){}
  var id=text(el.id||'');
  return id.indexOf('vn-')===0?id.slice(3):id;
}

function isFeatureVisibleInSidebar(el){
  if(!el||!el.id||el.id.indexOf('vn-')!==0)return false;
  var id=el.id.slice(3);
  if(!id||id==='useraccess')return false;
  if(el.getAttribute&&el.getAttribute('data-ua-hide')==='1')return false;
  var isNoAccess=el.classList&&el.classList.contains('uaNoAccess');
  if(!isNoAccess&&(el.hidden||el.getAttribute&&el.getAttribute('aria-hidden')==='true')){
    return false;
  }
  if(!isNoAccess&&el.style&&String(el.style.display||'').toLowerCase()==='none'){
    return false;
  }
  try{
    if(!isNoAccess&&typeof root.getComputedStyle==='function'){
      var cs=root.getComputedStyle(el);
      if(cs&&cs.display==='none')return false;
    }else if(KNOWN_HIDDEN[id]){
      return false;
    }
  }catch(_){
    if(KNOWN_HIDDEN[id])return false;
  }
  return true;
}

function liveFeatures(includeAll){
  var doc=root.document;
  if(!doc||typeof doc.querySelectorAll!=='function')return [];
  var seen={},out=[];
  Array.prototype.forEach.call(doc.querySelectorAll('.vitem[id^="vn-"]'),function(el){
    if(!el||!el.id)return;
    var id=el.id.slice(3);
    if(!id||id==='useraccess'||seen[id])return;
    if(!includeAll&&!isFeatureVisibleInSidebar(el))return;
    seen[id]=1;
    out.push({id:id,name:cleanFeatureName(el)||id,el:el});
  });
  return out;
}

function featureLabelMap(){
  var map={};
  liveFeatures(true).forEach(function(f){map[f.id]=f.name});
  return map;
}

function formatFeatureNames(u){
  if(!u)return '';
  if(u.admin===true||String(u.admin).toLowerCase()==='true'||isOwner(u.id))return 'All Features';
  var map=featureLabelMap();
  var ids=featureIdsOnly(u.access);
  if(!ids.length)return 'No features';
  return ids.map(function(id){return map[id]||id}).join(', ');
}

function rightsSummary(u){
  var r=getRights(u);
  if(!u||u.admin===true||String(u.admin).toLowerCase()==='true'||isOwner(u.id))return 'Full Admin Access';
  var parts=['View'];
  if(r.upload)parts.push('Upload');
  if(r.edit)parts.push('Edit');
  if(r.delete)parts.push('Delete');
  return parts.join(' + ');
}

function current(){
  try{
    var s=json(root.sessionStorage.getItem(SESS)||'null',null);
    if(!s||!s.id)return null;
    var list=json(root.localStorage.getItem(USERS)||'[]',[]),id=text(s.id).toLowerCase();
    var u=(Array.isArray(list)?list:[]).find(function(x){return text(x&&x.id).toLowerCase()===id});
    var adm=isOwner(id)||s.admin===true||String(s.admin).toLowerCase()==='true'||!!(u&&(u.admin===true||String(u.admin).toLowerCase()==='true'));
    var acc=adm?['*']:(u&&Array.isArray(u.access)&&u.access.length?u.access:(Array.isArray(s.access)&&s.access.length?s.access:['*']));
    var resolved={id:u&&u.id||s.id,name:u&&u.name||s.name||s.id,admin:adm,access:acc};
    resolved.rights=getRights(resolved);
    return resolved;
  }catch(_){return null}
}

function has(u,feature){
  if(!u)return true;
  if(isActionToken(feature))return false;
  if(feature==='dashboard')feature='cmd';
  if(u.admin===true||String(u.admin).toLowerCase()==='true'||isOwner(u.id))return true;
  return Array.isArray(u.access)&&(u.access.indexOf('*')>=0||u.access.indexOf(feature)>=0);
}

function canPerform(action,u){
  var cur=u||current();
  if(!cur)return false;
  var r=getRights(cur);
  if(action==='upload'||action==='add'||action==='create')return !!r.upload;
  if(action==='edit'||action==='update'||action==='save')return !!r.edit;
  if(action==='delete'||action==='remove')return !!r.delete;
  return !!r.view;
}

function setVisible(el,ok){
  if(!el)return;
  if(ok){el.hidden=false;el.classList.remove('uaNoAccess','uaDeniedPage');el.style.removeProperty('display');el.removeAttribute('aria-hidden')}
  else{el.hidden=true;el.classList.add('uaNoAccess');el.style.setProperty('display','none','important');el.setAttribute('aria-hidden','true')}
}

function ensureStyle(){
  var doc=root.document;
  if(!doc||doc.getElementById('atplPermGuardCss'))return;
  var st=doc.createElement('style');
  st.id='atplPermGuardCss';
  st.textContent='.uaActionDisabled{opacity:.42!important;cursor:not-allowed!important;filter:grayscale(.35)!important}';
  (doc.head||doc.documentElement).appendChild(st);
}

function classifyControl(el){
  if(!el)return null;
  if(el.closest&&el.closest('#uaLogin,#uaPage,#atplActivityCenter,#vnav,.sidebar,#uaLogoutBtn'))return null;
  if(!el.closest||!el.closest('[id^="page-"]'))return null;
  var explicit=el.getAttribute&&el.getAttribute('data-ua-action');
  if(explicit==='upload'||explicit==='edit'||explicit==='delete'||explicit==='view')return explicit;

  var tag=String(el.tagName||'').toUpperCase();
  if(tag==='INPUT'&&String(el.type||'').toLowerCase()==='file')return 'upload';
  if(el.classList&&el.classList.contains('dropzone'))return 'upload';

  var rawLabel=[
    el.getAttribute&&el.getAttribute('aria-label'),
    el.getAttribute&&el.getAttribute('title'),
    el.textContent,
    el.value,
    el.id,
    el.getAttribute&&el.getAttribute('onclick')
  ].filter(Boolean).join(' ').replace(/\s+/g,' ').trim();
  var lower=rawLabel.toLowerCase();

  // Never block read-only / navigation / export / search / filter controls
  if(/\b(search|filter|reset filter|clear filter|clear search|download|export|print|open|view|preview|close|cancel|back|refresh|sync now|pull|zip|pdf|excel|next|prev|previous|page\s+\d|show|hide|collapse|expand)\b/.test(lower)
     && !/\b(delete|remove|trash|upload|import|save|edit|update|add\s+new|add\s+employee|add\s+advance|deduct)\b/.test(lower)){
    return null;
  }

  if((el.hasAttribute&&(el.hasAttribute('data-del')||el.hasAttribute('data-delete')||el.hasAttribute('data-adv-del')||el.hasAttribute('data-cd2-del')||el.hasAttribute('data-fast-del')||el.hasAttribute('data-r-del')))
     || /\b(delete|remove|trash|clear\s*all|purge)\b|🗑/i.test(rawLabel)){
    if(!/\b(clear\s+filter|clear\s+search)\b/i.test(rawLabel))return 'delete';
  }
  if((el.hasAttribute&&(el.hasAttribute('data-upload')||el.hasAttribute('data-adv-add')))
     || /dropzone|fileinput/i.test(String(el.id||'')+' '+String(el.className||''))
     || /\b(upload|bulk\s*import|import\s+excel|import\s+csv|add\s+new|add\s+employee|add\s+advance|add\s+record|new\s+record|new\s+entry|create\s+entry|\+\s*upload|\+\s*add)\b|⬆/i.test(rawLabel)){
    return 'upload';
  }
  if((el.hasAttribute&&(el.hasAttribute('data-edit')||el.hasAttribute('data-adv-edit')||el.hasAttribute('data-fast-edit')||el.hasAttribute('data-r-edit')))
     || /\b(edit|save\s+changes|save\s+record|save\s+user|update|modify|deduct|reverse|set\s+dol|mark\s+left|mark\s+active|approve)\b|✏/i.test(rawLabel)
     || /^save$/i.test(text(el.textContent))){
    return 'edit';
  }
  return null;
}

function applyActionLocks(u){
  ensureStyle();
  var doc=root.document;
  if(!doc)return;
  var r=getRights(u);
  var controls=doc.querySelectorAll('[id^="page-"] button,[id^="page-"] [role="button"],[id^="page-"] input[type="file"],[id^="page-"] .dropzone,[id^="page-"] [data-del],[id^="page-"] [data-delete],[id^="page-"] [data-edit]');
  Array.prototype.forEach.call(controls,function(el){
    var act=classifyControl(el);
    if(!act||act==='view')return;
    var allowed=!!r[act];
    if(allowed){
      if(el.classList)el.classList.remove('uaActionDisabled');
      if(el.dataset&&el.dataset.uaLockedTitle!==undefined){
        if(el.dataset.uaPrevTitle)el.setAttribute('title',el.dataset.uaPrevTitle);
        else el.removeAttribute('title');
        delete el.dataset.uaLockedTitle;
      }
      if(el.tagName==='INPUT'&&el.type==='file'&&el.dataset&&el.dataset.uaLockedDisabled==='1'){
        el.disabled=false;
        delete el.dataset.uaLockedDisabled;
      }
    }else{
      if(el.classList)el.classList.add('uaActionDisabled');
      if(el.dataset&&el.dataset.uaLockedTitle===undefined){
        el.dataset.uaPrevTitle=el.getAttribute('title')||'';
        el.dataset.uaLockedTitle='1';
      }
      el.setAttribute('title','Admin ne aapke liye '+act.toUpperCase()+' permission band ki hui hai.');
      if(el.tagName==='INPUT'&&el.type==='file'){
        el.disabled=true;
        if(el.dataset)el.dataset.uaLockedDisabled='1';
      }
    }
  });
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
  applyActionLocks(u);
  return true;
}

function schedule(){if(timer)return;timer=root.setTimeout(apply,30)}

function denied(feature){
  try{if(typeof root.showToast==='function')root.showToast('Is feature ka access nahi diya gaya.');else root.alert('Is feature ka access nahi diya gaya.')}catch(_){}
  try{root.document.dispatchEvent(new CustomEvent('atpl-access-denied',{detail:{feature:feature}}))}catch(_){}
}

function deniedAction(action,label){
  var titles={upload:'Upload / Add',edit:'Edit / Update',delete:'Delete / Remove'};
  var msg='🚫 Aapke User ID ko '+(titles[action]||action)+' ki permission nahi di gayi hai.';
  try{if(typeof root.showToast==='function')root.showToast(msg);else root.alert(msg)}catch(_){}
  try{
    var activePg=root.document.querySelector('[id^="page-"].active:not([hidden])');
    var pageId=activePg?activePg.id.slice(5):'';
    if(root.ATPLSharedActivityV2&&typeof root.ATPLSharedActivityV2.log==='function'){
      root.ATPLSharedActivityV2.log('blocked_'+action,pageId,'Blocked '+action+': '+(label||'button'),{denied_action:action});
    }
  }catch(_){}
  try{root.document.dispatchEvent(new CustomEvent('atpl-action-denied',{detail:{action:action,label:label}}))}catch(_){}
}

function installGoGuard(){
  if(typeof root.goPage!=='function'||root.goPage.__atplPermissionGuard)return false;
  var old=root.goPage;
  function guarded(name){
    var u=current();
    if(u&&!has(u,String(name||''))){denied(String(name||''));return false}
    var res=old.apply(this,arguments);
    root.setTimeout(function(){var cu=current();if(cu)applyActionLocks(cu)},40);
    return res;
  }
  guarded.__atplPermissionGuard=true;guarded.__original=old;root.goPage=guarded;return true
}

function clickGuard(ev){
  var el=ev.target&&ev.target.closest?ev.target.closest('.vitem[id^="vn-"]'):null;
  if(el){
    var u=current();if(!u)return;
    var feature=el.id.slice(3),ok=feature==='useraccess'?!!(u&&u.admin===true):has(u,feature);
    if(ok)return;
    ev.preventDefault();ev.stopPropagation();if(ev.stopImmediatePropagation)ev.stopImmediatePropagation();denied(feature);
    return;
  }
  var u2=current();
  if(!u2||u2.admin===true||isOwner(u2.id))return;
  var target=ev.target&&ev.target.closest?ev.target.closest('button,[role="button"],a,input[type="file"],input[type="submit"],label,.dropzone,[data-del],[data-delete],[data-edit],[onclick]'):ev.target;
  if(!target)return;
  var act=classifyControl(target);
  if(!act||act==='view')return;
  var rights=getRights(u2);
  if(rights[act])return;
  ev.preventDefault();ev.stopPropagation();if(ev.stopImmediatePropagation)ev.stopImmediatePropagation();
  var lab=text(target.getAttribute&&target.getAttribute('aria-label')||target.title||target.textContent||target.value||target.id).slice(0,80);
  deniedAction(act,lab);
}

function fileChangeOrDropGuard(ev){
  var u=current();
  if(!u||u.admin===true||isOwner(u.id))return;
  var r=getRights(u);
  if(r.upload)return;
  var t=ev.target;
  if(!t||!t.closest||!t.closest('[id^="page-"]'))return;
  if((t.tagName==='INPUT'&&t.type==='file')||(t.closest&&t.closest('.dropzone,[id*="dropzone" i]'))){
    ev.preventDefault();ev.stopPropagation();if(ev.stopImmediatePropagation)ev.stopImmediatePropagation();
    deniedAction('upload',t.id||'File upload');
  }
}

function watchDynamicModules(){
  if(observer||!root.MutationObserver)return;
  observer=new MutationObserver(function(list){
    if(list.some(function(x){return x.addedNodes&&x.addedNodes.length}))schedule()
  });
  var nav=root.document.getElementById('vnav'),content=root.document.querySelector('.content');
  if(nav)observer.observe(nav,{childList:true,subtree:true});
  if(content)observer.observe(content,{childList:true,subtree:true});
}

function canUseMaster(u){
  u=u||current();if(!u)return false;if(u.admin===true||isOwner(u.id))return true;
  return Object.keys(MASTER_READ).some(function(k){return MASTER_READ[k]&&has(u,k)})
}

function boot(){installGoGuard();watchDynamicModules();apply();root.setTimeout(function(){installGoGuard();apply()},900)}

root.ATPLPermissionGuard={
  apply:apply,
  currentUser:current,
  hasFeature:function(f){return has(current(),f)},
  canUseMaster:canUseMaster,
  cleanFeatureName:cleanFeatureName,
  liveFeatures:liveFeatures,
  featureLabelMap:featureLabelMap,
  featureIdsOnly:featureIdsOnly,
  getRights:getRights,
  buildAccessList:buildAccessList,
  canPerform:canPerform,
  rightsSummary:rightsSummary,
  formatFeatureNames:formatFeatureNames,
  classifyControl:classifyControl,
  version:function(){return BUILD}
};

root.document.addEventListener('click',clickGuard,true);
root.document.addEventListener('change',fileChangeOrDropGuard,true);
root.document.addEventListener('drop',fileChangeOrDropGuard,true);
['atpl-authenticated','atpl-account-users-synced','atpl-modules-changed'].forEach(function(n){
  root.document.addEventListener(n,function(){schedule()})
});
if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})(window);
