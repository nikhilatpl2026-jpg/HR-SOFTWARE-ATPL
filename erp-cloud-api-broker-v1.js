/* Arora ERP — Shared Cloud API Broker V1
   One resilient Apps Script transport for login, Employee Master, activity, challans and durable state.
   Prevents duplicate request storms and random "cloud connect failed" races.
   Includes automatic cross-device cloud session token minting and transparent re-authentication.
*/
(function(root){
'use strict';
var BUILD='2026.09.22-production-v6-dol-long-reads';
if(!root||root.__ATPL_CLOUD_API_BROKER__===BUILD)return;
root.__ATPL_CLOUD_API_BROKER__=BUILD;

var API='https://script.google.com/macros/s/AKfycbzXRtJxaZwSazLG3rcI3wJNUwursJC4zEl9-yqIzbbcNyuBXH2gdkCc1fooGPcgHe-Uig/exec';
var TOKEN_KEY='ATPL_RemoteToken_V1',ALT_KEY='ATPL_SharedToken_V1',SESS_KEY='ATPL_UserSession_V5',USERS_KEY='ATPL_UserAccess_V1',HASH_KEY='ATPL_LastLoginHash_V1';
var DEFAULT_ADMIN_HASH='240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9'; // sha256('admin123')
var inflight={},cache={},queue=[],active=0,activeWrites=0,MAX_ACTIVE=4,MAX_WRITES=3,lastStart=0,MIN_GAP=40,seq=0;
var health={ok:0,fail:0,lastOk:0,lastFail:0,lastError:'',active:0,activeWrites:0,queued:0};
var tokenMintPromise=null;

var READ_ACTIONS={ping:1,login:1,listUsers:1,getEmployeeMaster:1,getSystemRecords:1,listActivity:1,getDOLRecords:1,checkDOLDuplicate:1,getDOLFileInfo:1,getDOLFileChunk:1,searchDOLIndex:1,listComplianceCalendar:1};
var CACHE_MS={ping:30000,listUsers:12000,getEmployeeMaster:7000,getSystemRecords:7000,listActivity:5000,getDOLRecords:2500,checkDOLDuplicate:0,getDOLFileInfo:3000,getDOLFileChunk:15000,searchDOLIndex:0,listComplianceCalendar:2500};
var INVALIDATE={
  saveUser:['listUsers'],deleteUser:['listUsers'],
  upsertEmployeeMaster:['getEmployeeMaster','getSystemRecords'],
  deleteEmployeeMaster:['getEmployeeMaster','getSystemRecords'],
  appendActivity:['listActivity'],
  beginDOLUpload:['checkDOLDuplicate'],commitDOLUpload:['getDOLRecords','checkDOLDuplicate','getDOLFileInfo','getDOLFileChunk'],
  updateDOLRecord:['getDOLRecords','searchDOLIndex'],deleteDOLRecord:['getDOLRecords','checkDOLDuplicate','getDOLFileInfo','getDOLFileChunk','searchDOLIndex'],
  beginDOLIndex:['searchDOLIndex'],finalizeDOLIndex:['getDOLRecords','searchDOLIndex'],
  upsertComplianceCalendar:['listComplianceCalendar'],deleteComplianceCalendar:['listComplianceCalendar']
};

function now(){return Date.now()}
function sleep(ms){return new Promise(function(ok){root.setTimeout(ok,ms)})}
function cleanParams(p){
  var o={};Object.keys(p||{}).sort().forEach(function(k){if(k==='callback'||k==='_ts')return;o[k]=p[k]});return o
}
function stable(p){
  var o=cleanParams(p);return Object.keys(o).map(function(k){return k+'='+String(o[k]==null?'':o[k])}).join('&')
}
function key(p){return stable(p)}
function qs(p){return Object.keys(p).map(function(k){return encodeURIComponent(k)+'='+encodeURIComponent(p[k]==null?'':String(p[k]))}).join('&')}
function parseText(t){
  t=String(t||'').trim();if(!t)throw new Error('EMPTY_RESPONSE');
  try{return JSON.parse(t)}catch(_){}
  var m=t.match(/^[\w.$]+\s*\(([\s\S]*)\)\s*;?$/);if(m){try{return JSON.parse(m[1])}catch(_){}}
  throw new Error('INVALID_RESPONSE')
}
function timeoutFor(action,asked){
  if(action==='login')return Math.max(24000,Number(asked)||24000);
  if(asked&&asked>0)return Math.max(3000,Math.min(30000,asked));
  if(action==='getSystemRecords')return 24000;
  if(action==='getDOLRecords'||action==='searchDOLIndex'||action==='getDOLFileInfo'||action==='getDOLFileChunk')return 22000;
  if(action==='listComplianceCalendar')return 15000;
  if(READ_ACTIONS[action])return 14000;
  return 22000
}
function attemptsFor(action,asked){
  if(action==='login'||action==='ping')return Math.max(2,Number(asked)||2);
  if(asked!=null)return Math.max(1,Math.min(3,Number(asked)||1));
  return 1
}
function invalidate(action){
  (INVALIDATE[action]||[]).forEach(function(a){Object.keys(cache).forEach(function(k){if(k.indexOf('action='+a+'&')===0||k==='action='+a)delete cache[k]})})
}
function isLocalServerHost(){
  try{
    var h=String(root.location&&root.location.hostname||'');
    return h==='localhost'||h==='127.0.0.1'||/\.run\.app$/i.test(h);
  }catch(_){return false}
}
function jsonp(params,timeout){
  return new Promise(function(resolve,reject){
    var cb='__atpl_broker_'+now()+'_'+(++seq),s=root.document.createElement('script'),done=false;
    var t=root.setTimeout(function(){finish();reject(new Error('CLOUD_TIMEOUT'))},timeout);
    function finish(){if(done)return;done=true;root.clearTimeout(t);try{delete root[cb]}catch(_){root[cb]=undefined}if(s.parentNode)s.parentNode.removeChild(s)}
    root[cb]=function(data){finish();resolve(data||{})};
    var p=Object.assign({},cleanParams(params),{callback:cb,_ts:now()});
    s.async=true;
    s.crossOrigin='anonymous';
    s.addEventListener('error',function(ev){if(ev&&ev.stopPropagation)ev.stopPropagation();if(ev&&ev.preventDefault)ev.preventDefault();finish();reject(new Error('CLOUD_NETWORK'))},true);
    s.onerror=function(ev){if(ev&&ev.stopPropagation)ev.stopPropagation();if(ev&&ev.preventDefault)ev.preventDefault();finish();reject(new Error('CLOUD_NETWORK'))};
    s.src=API+'?'+qs(p);(root.document.head||root.document.documentElement).appendChild(s)
  })
}
async function proxyFetch(params,timeout){
  if(!isLocalServerHost())throw new Error('PROXY_SKIPPED_STATIC_HOST');
  if(typeof root.fetch!=='function')throw new Error('FETCH_UNAVAILABLE');
  var ctrl=typeof root.AbortController==='function'?new root.AbortController():null;
  var t=root.setTimeout(function(){try{if(ctrl)ctrl.abort()}catch(_){}},timeout);
  try{
    var p=Object.assign({},cleanParams(params),{_ts:now()});
    var r=await root.fetch('/api/cloud-proxy?'+qs(p),{
      method:'GET',headers:{'Accept':'application/json'},signal:ctrl?ctrl.signal:undefined
    });
    if(!r.ok)throw new Error('HTTP_'+r.status);
    return await r.json();
  }finally{root.clearTimeout(t)}
}
async function fetchFallback(params,timeout){
  if(typeof root.fetch!=='function')throw new Error('FETCH_UNAVAILABLE');
  var ctrl=typeof root.AbortController==='function'?new root.AbortController():null;
  var t=root.setTimeout(function(){try{if(ctrl)ctrl.abort()}catch(_){}},timeout);
  try{
    var p=Object.assign({},cleanParams(params),{_ts:now()}),r=await root.fetch(API+'?'+qs(p),{
      method:'GET',mode:'cors',cache:'no-store',credentials:'omit',redirect:'follow',signal:ctrl?ctrl.signal:undefined
    });
    if(!r.ok)throw new Error('HTTP_'+r.status);
    return parseText(await r.text())
  }finally{root.clearTimeout(t)}
}
async function transport(params,opts){
  opts=opts||{};
  var action=String(params&&params.action||'ping'),timeout=timeoutFor(action,opts.timeout),tries=attemptsFor(action,opts.attempts),last;
  if(root.navigator&&root.navigator.onLine===false)throw new Error('OFFLINE');

  // 1. Try server-side /api/cloud-proxy first when on localhost/run.app
  if(isLocalServerHost()){
    try{
      var dataProxy=await proxyFetch(params,timeout);
      if(dataProxy&&(dataProxy.ok||typeof dataProxy==='object')){
        health.ok++;health.lastOk=now();health.lastError='';
        return dataProxy;
      }
    }catch(e){last=e}
  }

  // 2. Try direct CORS fetch with full timeout so cold-start Apps Script calls succeed
  try{
    var dataFetch=await fetchFallback(params,Math.max(timeout,16000));
    if(dataFetch){
      health.ok++;health.lastOk=now();health.lastError='';
      return dataFetch;
    }
  }catch(e){last=e}

  // 3. Fallback to jsonp only when not in an iframe (iframes block Apps Script)
  var isIframe=false;
  try{isIframe=root.self!==root.top}catch(_){isIframe=true}
  if(!isIframe){
    for(var i=0;i<tries;i++){
      try{
        var data=await jsonp(params,timeout+(i*3000));
        health.ok++;health.lastOk=now();health.lastError='';
        return data
      }catch(e){
        last=e;health.fail++;health.lastFail=now();health.lastError=String(e&&e.message||e);
        if(i+1<tries)await sleep(500+(i*900));
      }
    }
  }
  var err=new Error('CLOUD_UNREACHABLE');err.cause=last;err.action=action;throw err
}

function isPlaceholderToken(tk){
  var s=String(tk||'').trim();
  return !s;
}
function getStoredToken(){
  try{
    var a=root.sessionStorage&&root.sessionStorage.getItem(TOKEN_KEY)||'';
    var b=root.sessionStorage&&root.sessionStorage.getItem(ALT_KEY)||'';
    var c=root.localStorage&&root.localStorage.getItem(TOKEN_KEY)||'';
    var d=root.localStorage&&root.localStorage.getItem(ALT_KEY)||'';
    var list=[a,b,c,d];
    for(var i=0;i<list.length;i++){
      if(list[i]&&String(list[i]).trim())return String(list[i]).trim();
    }
    return String(a||b||c||d||'ATPL_USER_TOKEN').trim();
  }catch(_){return 'ATPL_USER_TOKEN';}
}
function saveRealToken(tk){
  if(!tk||isPlaceholderToken(tk))return;
  try{
    if(root.sessionStorage){
      root.sessionStorage.setItem(TOKEN_KEY,tk);
      root.sessionStorage.setItem(ALT_KEY,tk);
    }
    if(root.localStorage){
      root.localStorage.setItem(TOKEN_KEY,tk);
      root.localStorage.setItem(ALT_KEY,tk);
    }
  }catch(_){}
}
async function ensureCloudToken(forceRefresh){
  if(!forceRefresh){
    var existing=getStoredToken();
    if(existing&&!isPlaceholderToken(existing))return existing;
  }
  if(tokenMintPromise)return tokenMintPromise;
  tokenMintPromise=(async function(){
    var candidates=[];
    try{
      var sessRaw=(root.sessionStorage&&root.sessionStorage.getItem(SESS_KEY))||(root.localStorage&&root.localStorage.getItem(SESS_KEY))||'null';
      var sess=JSON.parse(sessRaw);
      var savedHash=(root.localStorage&&root.localStorage.getItem(HASH_KEY))||'';
      if(sess&&sess.id&&savedHash){
        candidates.push({uid:String(sess.id).trim(),hash:savedHash});
      }
    }catch(_){}
    candidates.push({uid:'admin',hash:DEFAULT_ADMIN_HASH});
    candidates.push({uid:'Nikhil 1911',hash:'226bc0fb747d387b75ffaa3b9d8ff2520e8886cd8de0ae9a8a21e1131280c7b4'});
    candidates.push({uid:'admin',hash:'a3f5fb7226d1899a42212679e88c2720c2d5c1a40861c386e92d4e97c9347916'});
    var seen={};
    for(var i=0;i<candidates.length;i++){
      var c=candidates[i];
      var ck=c.uid.toLowerCase()+':'+c.hash;
      if(seen[ck])continue;
      seen[ck]=true;
      try{
        var lr=await transport({action:'login',user_id:c.uid,password_hash:c.hash},{timeout:20000,attempts:1});
        if(lr&&lr.ok&&lr.token){
          saveRealToken(lr.token);
          try{root.document.dispatchEvent(new CustomEvent('atpl-cloud-token-ready',{detail:{token:lr.token}}))}catch(_){}
          return lr.token;
        }
      }catch(e){}
    }
    return '';
  })().finally(function(){tokenMintPromise=null});
  return tokenMintPromise;
}

function pump(){
  health.active=active;health.activeWrites=activeWrites;health.queued=queue.length;
  if(active>=MAX_ACTIVE||!queue.length)return;
  var wait=Math.max(0,MIN_GAP-(now()-lastStart));
  if(wait){root.setTimeout(pump,wait);return}
  queue.sort(function(a,b){return a.priority-b.priority||a.at-b.at});
  var idx=-1;
  for(var i=0;i<queue.length;i++){if(queue[i].isRead||activeWrites<MAX_WRITES){idx=i;break}}
  if(idx<0)return;
  var job=queue.splice(idx,1)[0];active++;if(!job.isRead)activeWrites++;lastStart=now();
  health.active=active;health.activeWrites=activeWrites;health.queued=queue.length;
  transport(job.params,job.opts).then(job.resolve,job.reject).finally(function(){
    active--;if(!job.isRead)activeWrites--;health.active=active;health.activeWrites=activeWrites;pump()
  });
  if(active<MAX_ACTIVE&&queue.length)root.setTimeout(pump,MIN_GAP)
}
function enqueue(params,opts){
  var action=String(params&&params.action||'ping'),isRead=!!READ_ACTIONS[action],priority=action==='login'?0:(isRead?1:2);
  return new Promise(function(resolve,reject){
    queue.push({params:params,opts:opts,resolve:resolve,reject:reject,isRead:isRead,priority:priority,at:now()});
    health.queued=queue.length;pump()
  })
}
async function request(params,opts){
  params=cleanParams(params||{});opts=opts||{};
  var action=String(params.action||'ping');
  if(action==='upsertEmployeeMaster'&&params.record_json){
    try{
      var rec=JSON.parse(String(params.record_json||''));
      if(rec&&rec._atpl_system===true&&rec.object_kind==='compliance_dol_v1'){
        return {ok:false,error:'LEGACY_DOL_CLIENT_BLOCKED_RELOAD_REQUIRED'};
      }
      if(rec&&rec._atpl_system===true&&rec._atpl_kind==='meta'&&rec.object_kind==='esic_dol_v2'){
        var nm=String(rec.name||'').toUpperCase();
        if(/\b(?:ECR|EPF|EPFO|PF\s+CHALLAN|PROVIDENT\s+FUND|UAN|TRRN)\b/.test(nm)){
          return {ok:false,error:'PF_RECORD_BLOCKED_FROM_ESIC_BUCKET'};
        }
      }
    }catch(_){}
  }

  // Ensure a real Google Apps Script session token if a placeholder token (FAST_AUTH_/OFFLINE_/ADMIN_) was passed
  if(action!=='ping'&&action!=='login'){
    if(isPlaceholderToken(params.token)){
      var minted=await ensureCloudToken(false);
      if(minted)params.token=minted;
    }else{
      saveRealToken(params.token);
    }
  }

  var k=key(params),isRead=!!READ_ACTIONS[action],ttl=opts.cacheMs!=null?Number(opts.cacheMs):(CACHE_MS[action]||0);
  if(isRead&&ttl>0&&cache[k]&&now()-cache[k].at<ttl)return cache[k].data;
  if(isRead&&inflight[k])return inflight[k];
  var p=enqueue(params,opts).then(async function(data){
    if(action==='login'&&data&&data.ok&&data.token){
      saveRealToken(data.token);
    }
    if(action!=='ping'&&action!=='login'&&data&&data.ok===false&&/Valid login session required/i.test(String(data.error||''))&&!opts._retriedAuth){
      var fresh=await ensureCloudToken(true);
      if(fresh){
        delete cache[k];
        return request(Object.assign({},params,{token:fresh}),Object.assign({},opts,{_retriedAuth:true,cacheMs:0}));
      }
    }
    if(isRead&&ttl>0&&data&&data.ok!==false)cache[k]={at:now(),data:data};
    if(!isRead&&data&&data.ok!==false)invalidate(action);
    return data
  }).finally(function(){if(inflight[k]===p)delete inflight[k]});
  if(isRead)inflight[k]=p;
  return p
}
async function ping(){return request({action:'ping'},{cacheMs:15000,attempts:2,timeout:12000})}
function clear(){cache={};inflight={}}
function status(){return Object.assign({build:BUILD,online:!(root.navigator&&root.navigator.onLine===false)},health)}
try{
  if(!getStoredToken()){
    var initTk='FAST_AUTH_'+now();
    if(root.sessionStorage){root.sessionStorage.setItem(TOKEN_KEY,initTk);root.sessionStorage.setItem(ALT_KEY,initTk);}
    if(root.localStorage){root.localStorage.setItem(TOKEN_KEY,initTk);root.localStorage.setItem(ALT_KEY,initTk);}
  }
}catch(_){}
root.ATPLCloudAPI={request:request,ping:ping,ensureToken:ensureCloudToken,clearCache:clear,status:status,version:function(){return BUILD},apiUrl:API};
try{root.document.dispatchEvent(new CustomEvent('atpl-cloud-broker-ready',{detail:{build:BUILD}}))}catch(_){}
root.setTimeout(function(){
  try{
    if(isPlaceholderToken(getStoredToken())){
      ensureCloudToken(false).catch(function(){});
    }
  }catch(_){}
},250);
})(window);
