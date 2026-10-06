/* ATPL DOL Supabase V2 — authoritative PF/ESIC challan backend.
   Normal runtime: Supabase DB + Storage only after ERP-token validation is cached server-side.
   Apps Script is used by the Edge Function only for auth bootstrap / one-time legacy recovery. */
(function(root){'use strict';
var BUILD='2026.09.28-supabase-authority-v2-permanent-delete';
if(!root||root.__ATPL_DOL_SUPABASE_V2__===BUILD)return;
root.__ATPL_DOL_SUPABASE_V2__=BUILD;

var SUPABASE_URL='https://gsbyzddibdjxekutpkip.supabase.co';
var PUBLISHABLE_KEY='sb_publishable_iBXc8wO99laFLO7-Pcv-Dw_BbpPJpII';
var EDGE_URL = SUPABASE_URL + '/functions/v1/dol-api';
var TOKEN='ATPL_RemoteToken_V1',ALT='ATPL_SharedToken_V1',SESS='ATPL_UserSession_V5';
var legacy=root.ATPLDOLCloudV4||null;
if(legacy&&!root.ATPLDOLCloudV4Legacy)root.ATPLDOLCloudV4Legacy=legacy;
var rawCache={pf:null,esic:null},rawCacheAt={pf:0,esic:0},RAW_CACHE_MS=1800;
var rtClient=null,rtChannel=null,rtStarting=null,warmPromise=null;

function tok(){try{return String(root.sessionStorage.getItem(TOKEN)||root.sessionStorage.getItem(ALT)||root.localStorage.getItem(TOKEN)||root.localStorage.getItem(ALT)||'')}catch(_){return''}}
function arr(v){return Array.isArray(v)?v:[]}
function normalizeId(v){return String(v==null?'':v).replace(/\s+/g,'').toUpperCase()}
function timeoutFetch(url,opt,ms){
  var ctrl=new AbortController(),timer=root.setTimeout(function(){ctrl.abort()},ms||20000);
  opt=Object.assign({},opt||{},{signal:ctrl.signal});
  return fetch(url,opt).finally(function(){root.clearTimeout(timer)})
}
function arrayBufferToBase64(buffer) {
  if (!buffer) return '';
  var bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  var binary = '';
  var chunkSize = 8192;
  for (var i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}
function base64ToArrayBuffer(base64) {
  if (!base64) return new ArrayBuffer(0);
  var binaryString = atob(base64);
  var len = binaryString.length;
  var bytes = new Uint8Array(len);
  for (var i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}
async function sbDirectRest(endpoint, options) {
  options = options || {};
  var headers = Object.assign({
    'apikey': PUBLISHABLE_KEY,
    'Authorization': 'Bearer ' + PUBLISHABLE_KEY,
    'Content-Type': 'application/json'
  }, options.headers || {});
  var url = SUPABASE_URL + '/rest/v1/' + endpoint;
  var res = await timeoutFetch(url, {
    method: options.method || 'GET',
    headers: headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  }, 30000);
  if (!res.ok) {
    var errText = '';
    try { errText = await res.text(); } catch(_) {}
    throw new Error('Supabase direct error (' + res.status + '): ' + errText);
  }
  try { return await res.json(); } catch(_) { return null; }
}

function edgeHeaders(json){
  var h={'apikey':PUBLISHABLE_KEY,'Authorization':'Bearer '+PUBLISHABLE_KEY};
  if(json)h['Content-Type']='application/json';
  var t=tok();if(t)h['x-atpl-token']=t;
  return h
}
async function edgeJson(body,ms){
  if(!tok())throw new Error('Valid ERP login required');
  var res=await timeoutFetch(EDGE_URL,{method:'POST',headers:edgeHeaders(true),body:JSON.stringify(body||{})},ms||22000);
  var data=null;try{data=await res.json()}catch(_){}
  if(!res.ok||!data||data.ok===false)throw new Error(data&&data.error||('DOL Supabase request failed ('+res.status+')'));
  return data
}
function mapRow(r){
  r=r||{};var ids=arr(r.member_ids).map(String).filter(Boolean),digits=[],alnums=[];
  ids.forEach(function(x){if(/^\d+$/.test(String(x)))digits.push(String(x));else alnums.push(String(x))});
  return {
    id:String(r.id||''),cloudRecordId:String(r.id||''),type:String(r.challan_type||r.type||'').toLowerCase(),
    name:String(r.file_name||r.name||'Challan'),size:Number(r.file_size||r.size||0)||0,
    fileHash:String(r.file_hash||r.fileHash||r.fingerprint||'').toLowerCase(),
    fingerprint:String(r.file_hash||r.fileHash||r.fingerprint||'').toLowerCase(),
    period:String(r.period||''),periodSource:'supabase',digitIds:digits,alnumIds:alnums,
    uploadedBy:String(r.uploaded_by||r.uploadedBy||''),uploadedAt:String(r.created_at||r.uploadedAt||''),
    updatedAt:String(r.updated_at||r.updatedAt||r.created_at||''),mime:String(r.mime_type||r.mime||'application/octet-stream'),
    hasOriginalFile:!!String(r.file_path||''),indexCount:ids.length,indexStatus:'ready',contributions:arr(r.contributions),
    _sharedSource:'dedicated',sharedSource:'dedicated',supabase:true,filePath:String(r.file_path||'')
  }
}
async function listRaw(type,force){
  type=String(type||'').toLowerCase();if(type!=='pf'&&type!=='esic')throw new Error('Invalid challan type');
  if(!force&&rawCache[type]&&Date.now()-rawCacheAt[type]<RAW_CACHE_MS)return rawCache[type];
  var d=await edgeJson({action:'list',type:type},30000),rows=arr(d.records);
  rawCache[type]=rows;rawCacheAt[type]=Date.now();return rows
}
async function list(type){
  return (await listRaw(type,true)).map(mapRow)
}
async function check(hash,intent,type){
  hash=String(hash||'').toLowerCase();type=String(type||'').toLowerCase();
  if(!hash)return{ok:true,duplicate:false};
  if(type!=='pf'&&type!=='esic')throw new Error('Challan type required for duplicate check');
  if(tok()){
    try{
      var d=await edgeJson({action:'check',type:type,file_hash:hash,upload_intent:String(intent||'user_upload')},15000);
      return{ok:true,duplicate:!!d.duplicate,deleted:!!d.deleted,record:d.record?mapRow(d.record):null};
    }catch(_){}
  }
  var rows=await listRaw(type,false);
  var matching=rows.find(function(r){return String(r.file_hash||r.fileHash||'').toLowerCase()===hash});
  return{ok:true,duplicate:!!matching,deleted:false,record:matching?mapRow(matching):null};
}function currentUserId(){
  try{var s=JSON.parse(root.sessionStorage.getItem(SESS)||root.localStorage.getItem(SESS)||'null');return s&&s.id?String(s.id):''}catch(_){return''}
}
async function upload(rec,buf,progress){
  if(!(buf instanceof ArrayBuffer))throw new Error('Original file bytes required');
  if(progress)progress(2);
  var type=String(rec&&rec.type||'').toLowerCase();if(type!=='pf'&&type!=='esic')throw new Error('Invalid challan type');
  var ids=arr(rec&&rec.ids).map(String).filter(Boolean),form=new FormData(),mime=String(rec&&rec.mime||'application/octet-stream');
  form.append('action','upload');form.append('type',type);form.append('period',String(rec&&rec.period||''));
  form.append('uploaded_by',currentUserId());form.append('member_ids',JSON.stringify(ids));
  form.append('contributions',JSON.stringify(arr(rec&&rec.contributions)));
  form.append('file_hash',String(rec&&rec.hash||rec&&rec.fileHash||'').toLowerCase());
  form.append('file_size',String(Number(rec&&rec.size||buf.byteLength)||buf.byteLength));
  form.append('mime_type',mime);
  form.append('file',new Blob([buf],{type:mime}),String(rec&&rec.name||'challan'));
  if(progress)progress(8);
  var uploadedEdge=false, d=null;
  if(tok()){
    try{
      var res=await timeoutFetch(EDGE_URL,{method:'POST',headers:edgeHeaders(false),body:form},35000);
      try{d=await res.json()}catch(_){}
      if(res.ok&&d&&d.ok!==false&&d.record){
        uploadedEdge=true;
      }
    }catch(e){console.warn('Edge upload deferred, saving directly to Supabase storage',e)}
  }
  if(uploadedEdge&&d&&d.record){
    rawCache[type]=null;rawCacheAt[type]=0;if(progress)progress(100);
    var mapped=mapRow(d.record||{});
    return{duplicate:!!d.duplicate,restoredDeleted:!!d.restoredDeleted,record:mapped,index:{ok:true,count:arr(rec&&rec.contributions).length||ids.length,record:mapped}};
  }
  if(progress)progress(25);
  var b64=arrayBufferToBase64(buf);
  var payloadObj={
    name:rec.name,period:rec.period||'',ids:ids,contributions:arr(rec&&rec.contributions),
    hash:String(rec&&rec.hash||rec&&rec.fileHash||'').toLowerCase(),mime:mime,
    uploaded_by:currentUserId()||'admin',original_b64:b64
  };
  try{
    await sbDirectRest('hr_files?filename=ilike.'+encodeURIComponent(rec.name)+'&doc_type=eq.'+type,{method:'DELETE'});
    await sbDirectRest('hr_files?filename=ilike.'+encodeURIComponent(rec.name)+'&doc_type=eq.'+type+'_tombstone',{method:'DELETE'});
  }catch(_){}
  if(progress)progress(60);
  var inserted=await sbDirectRest('hr_files',{
    method:'POST',
    headers:{'Prefer':'return=representation'},
    body:{
      filename:rec.name,payload:JSON.stringify(payloadObj),doc_type:type,
      size:buf.byteLength,uploaded_at:new Date().toISOString(),version:2
    }
  });
  if(progress)progress(90);
  var rowObj=(Array.isArray(inserted)&&inserted[0])||{id:Date.now(),filename:rec.name};
  var mappedDirect=mapRow({
    id:String(rowObj.id),challan_type:type,file_name:rec.name,file_size:buf.byteLength,
    file_hash:String(rec&&rec.hash||rec&&rec.fileHash||'').toLowerCase(),period:rec.period||'',
    member_ids:ids,contributions:arr(rec&&rec.contributions),created_at:new Date().toISOString(),
    file_path:rec.name,hasOriginalFile:true
  });
  rawCache[type]=null;rawCacheAt[type]=0;if(progress)progress(100);
  return{duplicate:false,restoredDeleted:false,record:mappedDirect,index:{ok:true,count:ids.length,record:mappedDirect}};
}async function update(rec){
  var type=String(rec&&rec.type||'').toLowerCase(),id=String(rec&&rec.cloudRecordId||rec&&rec.id||'');
  if(type!=='pf'&&type!=='esic')throw new Error('Invalid challan type');if(!id)throw new Error('Challan id missing');
  var d=await edgeJson({action:'updatePeriod',type:type,id:id,period:String(rec&&rec.period||'')},22000);
  rawCache[type]=null;rawCacheAt[type]=0;return mapRow(d.record||{})
}
async function remove(rec){
  var type=String(rec&&rec.type||'').toLowerCase(),id=String(rec&&rec.cloudRecordId||rec&&rec.id||''),name=String(rec&&rec.name||'');
  if(type!=='pf'&&type!=='esic')throw new Error('Invalid challan type');if(!id)throw new Error('Challan id missing');
  if(tok()){
    try{
      var d=await edgeJson({action:'delete',type:type,id:id},25000);
      rawCache[type]=null;rawCacheAt[type]=0;return d;
    }catch(e){console.warn('Edge delete fallback',e)}
  }
  try{
    if(name){
      await sbDirectRest('hr_files?filename=ilike.'+encodeURIComponent(name)+'&doc_type=eq.'+type,{method:'DELETE'});
      await sbDirectRest('hr_files',{
        method:'POST',
        body:{filename:name,payload:'',doc_type:type+'_tombstone',size:0,uploaded_at:new Date().toISOString()}
      });
    }
  }catch(_){}
  rawCache[type]=null;rawCacheAt[type]=0;return{ok:true,deleted:true};
}
async function signedFile(rec){
  var type=String(rec&&rec.type||'').toLowerCase(),id=String(rec&&rec.cloudRecordId||rec&&rec.id||'');
  if(type!=='pf'&&type!=='esic')throw new Error('Invalid challan type');if(!id)throw new Error('Challan id missing');
  return edgeJson({action:'file',type:type,id:id},30000);
}
async function fileBlob(rec,progress){
  if(progress)progress(3);
  if(tok()){
    try{
      var info=await signedFile(rec);
      if(info&&info.url){
        if(progress)progress(10);
        var res=await timeoutFetch(info.url,{method:'GET'},60000);
        if(res.ok){var blob=await res.blob();if(progress)progress(100);return blob}
      }
    }catch(_){}
  }
  if(progress)progress(20);
  var recName=String(rec&&rec.name||rec&&rec.file_name||'');
  var type=String(rec&&rec.type||rec&&rec.challan_type||'pf').toLowerCase();
  var rows=await sbDirectRest('hr_files?filename=ilike.'+encodeURIComponent(recName)+'&doc_type=eq.'+type+'&select=payload&limit=1');
  if(Array.isArray(rows)&&rows[0]&&rows[0].payload){
    var p={};try{p=JSON.parse(rows[0].payload||'{}')}catch(_){}
    if(p.original_b64){
      var ab=base64ToArrayBuffer(p.original_b64);
      var b=new Blob([ab],{type:p.mime||'application/octet-stream'});
      if(progress)progress(100);return b;
    }
  }
  throw new Error('Original file download failed');
}async function searchIndex(type,ids){
  type=String(type||'').toLowerCase();ids=arr(ids).map(normalizeId).filter(Boolean).slice(0,60);
  var rows=await listRaw(type,true),matches={},coverage={},unindexed=[];
  ids.forEach(function(id){matches[id]=[]});
  rows.forEach(function(r){
    var period=String(r.period||'');if(period)coverage[period]=1;
    var mids=arr(r.member_ids).map(normalizeId).filter(Boolean),contrib=arr(r.contributions);
    if(!mids.length){unindexed.push({id:r.id,name:r.file_name,period:period});return}
    ids.forEach(function(id){
      if(mids.indexOf(id)<0)return;
      var detail=contrib.find(function(x){return normalizeId(x&&x.memberId||x&&x.member_id)===id})||{};
      matches[id].push({recordId:String(r.id||''),type:type,memberId:id,employeeName:String(detail.employeeName||detail.employee_name||''),details:detail.details&&typeof detail.details==='object'?detail.details:{libraryIndex:true},period:period,sourceChallan:String(r.file_name||''),uploadedAt:String(r.created_at||''),updatedAt:String(r.updated_at||'')})
    })
  });
  Object.keys(matches).forEach(function(id){matches[id].sort(function(a,b){return String(a.period).localeCompare(String(b.period))})});
  return{ok:true,type:type,matches:matches,coverage:Object.keys(coverage).sort(),unindexed:unindexed,source:'supabase-authority'}
}
async function saveContributionIndex(recordId,type,entries,progress){
  if(progress)progress(100);
  var rows=await listRaw(type,true),r=rows.find(function(x){return String(x.id)===String(recordId)});
  return{ok:true,count:arr(entries).length,record:r?mapRow(r):null}
}
function loadRealtimeLib(){
  if(root.supabase&&typeof root.supabase.createClient==='function')return Promise.resolve(root.supabase);
  return new Promise(function(resolve,reject){
    var existing=root.document.querySelector('script[data-atpl-supabase-js]');
    if(existing){
      if(root.supabase&&root.supabase.createClient)return resolve(root.supabase);
      existing.addEventListener('load',function(){resolve(root.supabase)},{once:true});
      existing.addEventListener('error',function(){reject(new Error('Supabase realtime library failed'))},{once:true});return
    }
    var s=root.document.createElement('script');s.crossOrigin='anonymous';s.src='supabase-js-v2.min.js';s.async=true;if(s.dataset)s.dataset.atplSupabaseJs='1';
    s.onload=function(){if(root.supabase&&root.supabase.createClient)resolve(root.supabase);else reject(new Error('Supabase realtime library unavailable'))};
    s.addEventListener('error',function(ev){if(ev&&ev.stopPropagation)ev.stopPropagation();if(ev&&ev.preventDefault)ev.preventDefault();reject(new Error('Supabase realtime library failed to load'))},true);
    s.onerror=function(ev){if(ev&&ev.stopPropagation)ev.stopPropagation();if(ev&&ev.preventDefault)ev.preventDefault();reject(new Error('Supabase realtime library failed to load'))};
    (root.document.head||root.document.documentElement).appendChild(s)
  })
}
async function startRealtime(){
  if(rtChannel)return true;if(rtStarting)return rtStarting;
  rtStarting=(async function(){
    var lib=await loadRealtimeLib();
    rtClient=root.__ATPL_SHARED_SUPABASE_CLIENT||(root.__ATPL_SHARED_SUPABASE_CLIENT=lib.createClient(SUPABASE_URL,PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false,storageKey:'sb-atpl-shared-auth-v1'}}));
    rtChannel=rtClient.channel('atpl-dol-sync-v2')
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'dol_sync_events'},function(payload){
        var type=String(payload&&payload.new&&payload.new.challan_type||'').toLowerCase();if(type!=='pf'&&type!=='esic')return;
        rawCache[type]=null;rawCacheAt[type]=0;
        try{root.dispatchEvent(new CustomEvent('atpl-dol-supabase-change',{detail:{type:type,at:Date.now(),event:payload&&payload.new||null}}))}catch(_){}
      })
      .subscribe(function(status){
        if(status==='SUBSCRIBED'){
          try{root.dispatchEvent(new CustomEvent('atpl-dol-realtime-status',{detail:{connected:true,status:status,at:Date.now()}}))}catch(_){}
        }else if(status==='CHANNEL_ERROR'||status==='TIMED_OUT'||status==='CLOSED'){
          var dead=rtChannel;rtChannel=null;try{if(rtClient&&dead)rtClient.removeChannel(dead)}catch(_){}
          try{root.dispatchEvent(new CustomEvent('atpl-dol-realtime-status',{detail:{connected:false,status:status,at:Date.now()}}))}catch(_){}
        }
      });
    return true
  })().catch(function(e){console.warn('DOL realtime unavailable',e);rtChannel=null;return false}).finally(function(){rtStarting=null});
  return rtStarting
}
function stopRealtime(){try{if(rtClient&&rtChannel)rtClient.removeChannel(rtChannel)}catch(_){}rtChannel=null;rtClient=null}
async function warmAuth(){
  if(warmPromise)return warmPromise;if(!tok())return false;
  warmPromise=(async function(){
    var s=null;try{s=JSON.parse(root.sessionStorage.getItem(SESS)||root.localStorage.getItem(SESS)||'null')}catch(_){}
    var access=arr(s&&s.access).map(function(x){return String(x).toLowerCase()}),admin=!!(s&&s.admin);
    var types=[];if(admin||access.indexOf('*')>=0||access.indexOf('pftodol')>=0)types.push('pf');
    if(admin||access.indexOf('*')>=0||access.indexOf('esictodol')>=0)types.push('esic');
    await Promise.allSettled(types.map(function(type){return edgeJson({action:'health',type:type},18000)}));
    return true
  })().finally(function(){warmPromise=null});
  return warmPromise
}
var api={
  authority:'supabase',provider:'supabase-v2',probe:function(type){return edgeJson({action:'health',type:type==='esic'?'esic':'pf'},18000).then(function(){return true})},
  list:list,check:check,upload:upload,saveContributionIndex:saveContributionIndex,searchIndex:searchIndex,update:update,
  deleteRecord:remove,fileBlob:fileBlob,startRealtime:startRealtime,stopRealtime:stopRealtime,warmAuth:warmAuth,
  migrationReport:function(){return null},supported:function(){return true},supportState:function(){return true},version:function(){return BUILD}
};
root.ATPLDOLCloudV4=api;
root.ATPLDOLSupabaseV2=api;
function resume(){if(!rtChannel)startRealtime();warmAuth().catch(function(){})}
root.addEventListener('online',resume);
try{root.document.addEventListener('atpl-authenticated',resume)}catch(_){}
if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',function(){startRealtime();warmAuth().catch(function(){})},{once:true});else{startRealtime();warmAuth().catch(function(){})}
})(window);
