/* Arora ERP — Shared Cloud API Broker V1
   One resilient Apps Script transport for login, Employee Master, activity, challans and durable state.
   Prevents duplicate request storms and random "cloud connect failed" races.
*/
(function(root){
'use strict';
var BUILD='2026.09.21-production-v5';
if(!root||root.__ATPL_CLOUD_API_BROKER__===BUILD)return;
root.__ATPL_CLOUD_API_BROKER__=BUILD;

var API='https://script.google.com/macros/s/AKfycby99_893hVtbWOQr67ikxIwiq81MWW8JAa2LuxTu67JBxjQ_iWb-YkqhBmW0RrHU512SQ/exec';
var inflight={},cache={},queue=[],active=0,activeWrites=0,MAX_ACTIVE=2,MAX_WRITES=1,lastStart=0,MIN_GAP=160,seq=0;
var health={ok:0,fail:0,lastOk:0,lastFail:0,lastError:'',active:0,activeWrites:0,queued:0};

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
  if(asked&&asked>0)return Math.max(3000,Math.min(12000,asked));
  if(action==='login')return 9000;
  if(READ_ACTIONS[action])return 8000;
  return 12000
}
function attemptsFor(action,asked){
  if(asked!=null)return Math.max(1,Math.min(2,Number(asked)||1));
  return 1
}
function invalidate(action){
  (INVALIDATE[action]||[]).forEach(function(a){Object.keys(cache).forEach(function(k){if(k.indexOf('action='+a+'&')===0||k==='action='+a)delete cache[k]})})
}
function jsonp(params,timeout){
  return new Promise(function(resolve,reject){
    var cb='__atpl_broker_'+now()+'_'+(++seq),s=root.document.createElement('script'),done=false;
    var t=root.setTimeout(function(){finish();reject(new Error('CLOUD_TIMEOUT'))},timeout);
    function finish(){if(done)return;done=true;root.clearTimeout(t);try{delete root[cb]}catch(_){root[cb]=undefined}if(s.parentNode)s.parentNode.removeChild(s)}
    root[cb]=function(data){finish();resolve(data||{})};
    var p=Object.assign({},cleanParams(params),{callback:cb,_ts:now()});
    s.async=true;s.referrerPolicy='no-referrer';s.onerror=function(){finish();reject(new Error('CLOUD_NETWORK'))};
    s.src=API+'?'+qs(p);(root.document.head||root.document.documentElement).appendChild(s)
  })
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
  var action=String(params&&params.action||'ping'),timeout=timeoutFor(action,opts.timeout),tries=attemptsFor(action,opts.attempts),last;
  if(root.navigator&&root.navigator.onLine===false)throw new Error('OFFLINE');
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
  // JSONP is the canonical Apps Script transport. Do not start a second long
  // CORS/fetch request after a read timeout unless a caller explicitly asks for it.
  if(opts.fetchFallback===true&&READ_ACTIONS[action]){
    try{
      var d=await fetchFallback(params,Math.max(3000,Math.min(timeout,7000)));
      health.ok++;health.lastOk=now();health.lastError='';return d
    }catch(e){last=e;health.fail++;health.lastFail=now();health.lastError=String(e&&e.message||e)}
  }
  var err=new Error('CLOUD_UNREACHABLE');err.cause=last;err.action=action;throw err
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
  var k=key(params),isRead=!!READ_ACTIONS[action],ttl=opts.cacheMs!=null?Number(opts.cacheMs):(CACHE_MS[action]||0);
  if(isRead&&ttl>0&&cache[k]&&now()-cache[k].at<ttl)return cache[k].data;
  if(isRead&&inflight[k])return inflight[k];
  var p=enqueue(params,opts).then(function(data){
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
root.ATPLCloudAPI={request:request,ping:ping,clearCache:clear,status:status,version:function(){return BUILD},apiUrl:API};
try{root.document.dispatchEvent(new CustomEvent('atpl-cloud-broker-ready',{detail:{build:BUILD}}))}catch(_){}
})(window);
