/* ATPL ERP Persistence Guard V1 — keeps shared cloud data durable across refresh, restart and reconnect. */
(function(root){'use strict';
  if(!root||root.__ATPL_PERSISTENCE_GUARD_V1__)return;root.__ATPL_PERSISTENCE_GUARD_V1__=1;
  var REMOTE='ATPL_RemoteToken_V1',SHARED='ATPL_SharedToken_V1',SESS='ATPL_UserSession_V5';
  var timer=0,lastRun=0,running=false;
  function hasSession(){try{var s=JSON.parse(root.sessionStorage.getItem(SESS)||'null');return !!(s&&s.id)}catch(_){return false}}
  function syncToken(){try{var a=root.sessionStorage.getItem(REMOTE)||'',b=root.sessionStorage.getItem(SHARED)||'',t=a||b;if(t){if(!a)root.sessionStorage.setItem(REMOTE,t);if(!b)root.sessionStorage.setItem(SHARED,t)}return t}catch(_){return''}}
  async function run(force){
    if(running||!hasSession()||!syncToken())return false;
    if(!force&&Date.now()-lastRun<45000)return false;
    running=true;lastRun=Date.now();
    try{
      var jobs=[];
      if(root.ATPLCloudSyncV1&&typeof root.ATPLCloudSyncV1.pullMaster==='function')jobs.push(Promise.resolve(root.ATPLCloudSyncV1.pullMaster()).catch(function(){return false}));
      if(root.ATPLSharedActivityV2&&typeof root.ATPLSharedActivityV2.syncCloud==='function')jobs.push(Promise.resolve(root.ATPLSharedActivityV2.syncCloud()).catch(function(){return false}));
      await Promise.all(jobs);return true;
    }finally{running=false}
  }
  function badge(){try{if(root.document.getElementById('atplPermanentDataBadge'))return;var h=root.document.querySelector('.header-right');if(!h)return;var b=root.document.createElement('span');b.id='atplPermanentDataBadge';b.textContent='☁ Permanent Data';b.title='Shared ERP data is stored in cloud and re-synced after reconnect/login.';b.style.cssText='display:inline-flex;font-size:9px;padding:4px 7px;border-radius:999px;background:#ecfdf5;color:#047857;border:1px solid #a7f3d0;font-weight:700';h.appendChild(b)}catch(_){}}
  function boot(){
    badge();syncToken();if(hasSession()&&syncToken())setTimeout(function(){run(false)},7000);
    root.document.addEventListener('atpl-authenticated',function(){setTimeout(function(){run(false)},2200)});
    root.addEventListener('online',function(){setTimeout(function(){run(false)},1000)});
    timer=root.setInterval(function(){if(root.document.hidden)return;run(false)},300000);
  }
  root.ATPLPersistenceGuardV1={sync:function(){return run(true)},status:function(){return{session:hasSession(),token:!!syncToken(),lastRun:lastRun,running:running}}};
  if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})(window);
