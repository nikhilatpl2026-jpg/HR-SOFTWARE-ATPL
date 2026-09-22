/* ATPL DOL Supabase V1 — single authoritative DOL backend adapter.
   Supabase owns challan metadata + original files.
   Existing Apps Script DOL client is preserved only as ATPLDOLCloudV4Legacy for explicit migration/recovery work.
   No recurring polling. Cross-browser refresh is event-driven through Supabase Realtime. */
(function(root){'use strict';
var BUILD='2026.09.22-supabase-authority-v3-stable-first-load';
if(!root||root.__ATPL_DOL_SUPABASE_V1__===BUILD)return;
root.__ATPL_DOL_SUPABASE_V1__=BUILD;

var SUPABASE_URL='https://gsbyzddibdjxekutpkip.supabase.co';
var PUBLISHABLE_KEY='sb_publishable_iBXc8wO99laFLO7-Pcv-Dw_BbpPJpII';
var EDGE_URL=SUPABASE_URL+'/functions/v1/dol-api';
var TOKEN='ATPL_RemoteToken_V1',ALT='ATPL_SharedToken_V1';
var legacy=root.ATPLDOLCloudV4||null;
if(legacy&&!root.ATPLDOLCloudV4Legacy)root.ATPLDOLCloudV4Legacy=legacy;
var rawCache={pf:null,esic:null},rawCacheAt={pf:0,esic:0},RAW_CACHE_MS=2500;
var rtClient=null,rtChannel=null,rtStarting=null,migrationPromises={pf:null,esic:null},migrationChecked={pf:false,esic:false},migrationReports={pf:null,esic:null};

function tok(){try{return String(root.sessionStorage.getItem(TOKEN)||root.sessionStorage.getItem(ALT)||'')}catch(_){return''}}
function wait(ms){return new Promise(function(r){root.setTimeout(r,ms)})}
function timeoutFetch(url,opt,ms){
  var ctrl=new AbortController(),timer=root.setTimeout(function(){ctrl.abort()},ms||20000);
  opt=Object.assign({},opt||{},{signal:ctrl.signal});
  return fetch(url,opt).finally(function(){root.clearTimeout(timer)})
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
function arr(v){return Array.isArray(v)?v:[]}
function normalizeId(v){return String(v==null?'':v).replace(/\s+/g,'').toUpperCase()}
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
  var d=await edgeJson({action:'list',type:type},26000),rows=arr(d.records);
  rawCache[type]=rows;rawCacheAt[type]=Date.now();return rows
}
function migrationProgress(type,msg,done,report){
  try{root.dispatchEvent(new CustomEvent('atpl-dol-migration-progress',{detail:{type:type,message:msg,done:!!done,report:report||null}}))}catch(_){}
}
function migrationReport(type){
  return migrationReports[String(type||'').toLowerCase()]||null
}
async function maybeStartLegacyMigration(type){
  type=String(type||'').toLowerCase();if(type!=='pf'&&type!=='esic')return{migrated:0,skipped:0,failed:0,failures:[]};
  if(migrationPromises[type])return migrationPromises[type];
  if(migrationChecked[type])return migrationReports[type]||{migrated:0,skipped:0,failed:0,failures:[]};
  if(!legacy||typeof legacy.list!=='function'||typeof legacy.fileBlob!=='function'){
    migrationChecked[type]=true;
    migrationReports[type]={migrated:0,skipped:0,failed:0,failures:[],reason:'legacy-client-unavailable'};
    return migrationReports[type]
  }
  migrationPromises[type]=(async function(){
    migrationProgress(type,'Checking old '+type.toUpperCase()+' challans for one-time migration…',false);
    var current=(await listRaw(type,true)).map(mapRow),byHash={};
    current.forEach(function(r){if(r.fileHash)byHash[String(r.fileHash).toLowerCase()]=r});
    var oldRows=await legacy.list(type);oldRows=Array.isArray(oldRows)?oldRows:[];
    var migrated=0,skipped=0,failed=0,failures=[];
    if(!oldRows.length){
      var emptyReport={migrated:0,skipped:0,failed:0,failures:[]};
      migrationChecked[type]=true;migrationReports[type]=emptyReport;
      migrationProgress(type,'No old '+type.toUpperCase()+' challans need migration.',true,emptyReport);
      return emptyReport
    }
    for(var i=0;i<oldRows.length;i++){
      var old=oldRows[i]||{},blob=null,buf=null,hash=String(old.fileHash||old.fingerprint||old.hash||'').toLowerCase();
      try{
        migrationProgress(type,'Migrating old challan '+(i+1)+' / '+oldRows.length+' · '+String(old.name||'challan'),false);
        if(hash&&byHash[hash]&&byHash[hash].hasOriginalFile){
          skipped++;
          try{if(typeof legacy.deleteRecord==='function')await legacy.deleteRecord(old)}catch(e){console.warn('Legacy cleanup deferred after verified Supabase duplicate',old&&old.name,e)}
          continue
        }
        blob=await legacy.fileBlob(old,function(p){migrationProgress(type,'Migrating '+(i+1)+' / '+oldRows.length+' · '+p+'% · '+String(old.name||'challan'),false)});
        if(!blob)throw new Error('Original file unavailable in old vault');
        buf=await blob.arrayBuffer();
        if(!hash){
          var dig=await root.crypto.subtle.digest('SHA-256',buf);hash=Array.from(new Uint8Array(dig)).map(function(b){return b.toString(16).padStart(2,'0')}).join('')
        }
        if(byHash[hash]&&byHash[hash].hasOriginalFile){
          skipped++;
          try{if(typeof legacy.deleteRecord==='function')await legacy.deleteRecord(old)}catch(e){console.warn('Legacy cleanup deferred after verified Supabase duplicate',old&&old.name,e)}
          continue
        }
        var ids=[].concat(arr(old.digitIds),arr(old.alnumIds),arr(old.ids)).map(String).filter(Boolean);
        var work={type:type,name:String(old.name||'challan'),size:Number(old.size||blob.size||buf.byteLength)||buf.byteLength,hash:hash,period:String(old.period||''),periodSource:String(old.periodSource||'legacy'),ids:Array.from(new Set(ids)),contributions:arr(old.contributions),mime:String(old.mime||blob.type||'application/octet-stream')};
        var out=await upload(work,buf),saved=out&&out.record||null;
        if(!saved||!saved.id||saved.type!==type||!saved.hasOriginalFile||!saved.filePath)throw new Error('Supabase save did not return a complete stored record');
        if(hash&&saved.fileHash&&String(saved.fileHash).toLowerCase()!==hash)throw new Error('Supabase SHA-256 does not match legacy original');
        byHash[hash]=saved;
        if(out.duplicate)skipped++;else migrated++;
        try{if(typeof legacy.deleteRecord==='function')await legacy.deleteRecord(old)}catch(e){console.warn('Legacy cleanup deferred after Supabase migration',old&&old.name,e)}
        rawCache[type]=null;rawCacheAt[type]=0;await wait(0)
      }catch(e){
        failed++;
        failures.push({name:String(old.name||'challan'),reason:String(e&&e.message||e)});
        console.warn('Old DOL migration needs manual re-upload',old&&old.name,e)
      }finally{blob=null;buf=null}
    }
    var report={migrated:migrated,skipped:skipped,failed:failed,failures:failures};
    migrationChecked[type]=true;migrationReports[type]=report;
    migrationProgress(type,'One-time '+type.toUpperCase()+' migration finished · '+migrated+' moved · '+skipped+' already safe'+(failed?' · '+failed+' need manual re-upload':''),true,report);
    rawCache[type]=null;rawCacheAt[type]=0;
    try{root.dispatchEvent(new CustomEvent('atpl-dol-supabase-change',{detail:{type:type,at:Date.now(),migration:true,report:report}}))}catch(_){}
    return report
  })().catch(function(e){
    var report={migrated:0,skipped:0,failed:1,failures:[{name:'migration',reason:String(e&&e.message||e)}]};
    migrationChecked[type]=true;migrationReports[type]=report;
    console.warn('One-time DOL migration failed',type,e);migrationProgress(type,'Old challan migration failed · '+String(e&&e.message||e),true,report);return report
  }).finally(function(){migrationPromises[type]=null});
  return migrationPromises[type]
}
async function list(type){
  type=String(type||'').toLowerCase();if(type!=='pf'&&type!=='esic')throw new Error('Invalid challan type');
  if(!migrationChecked[type]){
    await maybeStartLegacyMigration(type)
  }
  var rows=await listRaw(type,true);
  return rows.map(mapRow)
}
async function check(hash){
  hash=String(hash||'').toLowerCase();if(!hash)return{ok:true,duplicate:false};
  var types=['pf','esic'];
  for(var i=0;i<types.length;i++){
    try{
      var rows=await listRaw(types[i],true),hit=rows.find(function(r){return String(r.file_hash||'').toLowerCase()===hash});
      if(hit)return{ok:true,duplicate:true,record:mapRow(hit)}
    }catch(_){}
  }
  return{ok:true,duplicate:false}
}
function currentUserId(){
  try{var s=JSON.parse(root.sessionStorage.getItem('ATPL_UserSession_V5')||'null');return s&&s.id?String(s.id):''}catch(_){return''}
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
  form.append('file_size',String(Number(rec&&rec.size||buf.byteLength)||buf.byteLength));form.append('mime_type',mime);
  form.append('file',new Blob([buf],{type:mime}),String(rec&&rec.name||'challan'));
  if(progress)progress(8);
  var res=await timeoutFetch(EDGE_URL,{method:'POST',headers:edgeHeaders(false),body:form},60000),d=null;
  try{d=await res.json()}catch(_){}
  if(!res.ok||!d||d.ok===false)throw new Error(d&&d.error||('Supabase challan upload failed ('+res.status+')'));
  rawCache[type]=null;rawCacheAt[type]=0;if(progress)progress(100);
  var mapped=mapRow(d.record||{}),count=arr(rec&&rec.contributions).length||ids.length;
  if(!mapped.id||mapped.type!==type||!mapped.filePath||!mapped.hasOriginalFile)throw new Error('Supabase upload returned an incomplete stored record');
  var expectedHash=String(rec&&rec.hash||rec&&rec.fileHash||'').toLowerCase();if(expectedHash&&mapped.fileHash&&mapped.fileHash!==expectedHash)throw new Error('Supabase SHA-256 verification failed');
  return{duplicate:!!d.duplicate,record:mapped,index:{ok:true,count:count,record:mapped}}
}
async function update(rec){
  var type=String(rec&&rec.type||'').toLowerCase(),id=String(rec&&rec.cloudRecordId||rec&&rec.id||'');
  if(type!=='pf'&&type!=='esic')throw new Error('Invalid challan type');if(!id)throw new Error('Challan id missing');
  var d=await edgeJson({action:'updatePeriod',type:type,id:id,period:String(rec&&rec.period||'')},22000);
  rawCache[type]=null;rawCacheAt[type]=0;return mapRow(d.record||{})
}
async function remove(rec){
  var type=String(rec&&rec.type||'').toLowerCase(),id=String(rec&&rec.cloudRecordId||rec&&rec.id||'');
  if(type!=='pf'&&type!=='esic')throw new Error('Invalid challan type');if(!id)throw new Error('Challan id missing');
  var d=await edgeJson({action:'delete',type:type,id:id},30000);
  rawCache[type]=null;rawCacheAt[type]=0;
  return d
}
async function signedFile(rec){
  var type=String(rec&&rec.type||'').toLowerCase(),id=String(rec&&rec.cloudRecordId||rec&&rec.id||'');
  if(type!=='pf'&&type!=='esic')throw new Error('Invalid challan type');if(!id)throw new Error('Challan id missing');
  return edgeJson({action:'file',type:type,id:id},22000)
}
async function fileBlob(rec,progress){
  if(progress)progress(3);
  var info=await signedFile(rec);if(!info.url)throw new Error('Signed file URL missing');
  if(progress)progress(10);
  var res=await timeoutFetch(info.url,{method:'GET'},45000);if(!res.ok)throw new Error('Original file download failed ('+res.status+')');
  var total=Number(res.headers.get('content-length')||0);
  if(res.body&&res.body.getReader){
    var reader=res.body.getReader(),chunks=[],done=0;
    while(true){
      var part=await reader.read();if(part.done)break;chunks.push(part.value);done+=part.value.byteLength;
      if(progress&&total)progress(Math.min(99,10+Math.round(done/total*89)))
    }
    if(progress)progress(100);return new Blob(chunks,{type:info.mime||rec.mime||'application/octet-stream'})
  }
  var blob=await res.blob();if(progress)progress(100);return blob
}
async function searchIndex(type,ids){
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
      matches[id].push({
        recordId:String(r.id||''),type:type,memberId:id,
        employeeName:String(detail.employeeName||detail.employee_name||''),
        details:detail.details&&typeof detail.details==='object'?detail.details:{libraryIndex:true},
        period:period,sourceChallan:String(r.file_name||''),uploadedAt:String(r.created_at||''),updatedAt:String(r.updated_at||'')
      })
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
    if(existing){existing.addEventListener('load',function(){resolve(root.supabase)} ,{once:true});existing.addEventListener('error',function(){reject(new Error('Supabase realtime library failed'))},{once:true});return}
    var s=root.document.createElement('script');s.src='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';s.async=true;s.dataset.atplSupabaseJs='1';
    s.onload=function(){if(root.supabase&&root.supabase.createClient)resolve(root.supabase);else reject(new Error('Supabase realtime library unavailable'))};
    s.onerror=function(){reject(new Error('Supabase realtime library failed to load'))};(root.document.head||root.document.documentElement).appendChild(s)
  })
}
async function startRealtime(){
  if(rtChannel)return true;if(rtStarting)return rtStarting;
  rtStarting=(async function(){
    var lib=await loadRealtimeLib();rtClient=lib.createClient(SUPABASE_URL,PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
    rtChannel=rtClient.channel('atpl-dol-sync-v1')
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'dol_sync_events'},function(payload){
        var type=String(payload&&payload.new&&payload.new.challan_type||'').toLowerCase();if(type!=='pf'&&type!=='esic')return;
        rawCache[type]=null;rawCacheAt[type]=0;
        try{root.dispatchEvent(new CustomEvent('atpl-dol-supabase-change',{detail:{type:type,at:Date.now(),event:payload&&payload.new||null}}))}catch(_){}
      })
      .subscribe(function(status){
        if(status==='SUBSCRIBED'){
          try{root.dispatchEvent(new CustomEvent('atpl-dol-realtime-status',{detail:{connected:true,status:status,at:Date.now()}}))}catch(_){}
          return
        }
        if(status==='CHANNEL_ERROR'||status==='TIMED_OUT'||status==='CLOSED'){
          console.warn('DOL realtime status',status);
          var dead=rtChannel;rtChannel=null;
          try{if(rtClient&&dead)rtClient.removeChannel(dead)}catch(_){}
          try{root.dispatchEvent(new CustomEvent('atpl-dol-realtime-status',{detail:{connected:false,status:status,at:Date.now()}}))}catch(_){}
        }
      });
    return true
  })().catch(function(e){console.warn('DOL realtime unavailable',e);rtChannel=null;return false}).finally(function(){rtStarting=null});
  return rtStarting
}
function stopRealtime(){
  try{if(rtClient&&rtChannel)rtClient.removeChannel(rtChannel)}catch(_){}rtChannel=null;rtClient=null
}
var api={
  authority:'supabase',provider:'supabase',probe:function(){return Promise.resolve(true)},list:list,check:check,upload:upload,
  saveContributionIndex:saveContributionIndex,searchIndex:searchIndex,update:update,deleteRecord:remove,fileBlob:fileBlob,
  startRealtime:startRealtime,stopRealtime:stopRealtime,migrateLegacy:maybeStartLegacyMigration,migrationReport:migrationReport,legacyClient:legacy,supported:function(){return true},supportState:function(){return true},
  version:function(){return BUILD}
};
root.ATPLDOLCloudV4=api;
root.ATPLDOLSupabaseV1=api;
function resumeRealtime(){if(!rtChannel)startRealtime()}
root.addEventListener('online',resumeRealtime);
try{root.document.addEventListener('atpl-authenticated',resumeRealtime)}catch(_){}
if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',function(){startRealtime()},{once:true});else startRealtime();
})(window);
