/* ATPL DOL Cloud V4 client — dedicated backend-authoritative challan records + original-file vault.
   Uses JSONP for small control/read calls and hidden-form POST + postMessage for large upload parts.
   No DOL bytes are stored in EmployeeMaster. */
(function(root){'use strict';
var BUILD='2026.09.22-production-v9-long-read-authority';
if(!root||root.__ATPL_DOL_CLOUD_V4__===BUILD)return;
root.__ATPL_DOL_CLOUD_V4__=BUILD;
var TOKEN='ATPL_RemoteToken_V1',ALT='ATPL_SharedToken_V1',support=null,probePromise=null;
var POST_PART_CHARS=40000,POST_BATCH_PARTS=8,postSeq=0;

function tok(){try{return String(root.sessionStorage.getItem(TOKEN)||root.sessionStorage.getItem(ALT)||'')}catch(_){return''}}
function errMsg(e){return String(e&&e.message||e||'Cloud request failed')}
function api(p,opt){
  if(!tok()&&p.action!=='ping')return Promise.reject(new Error('Valid login required'));
  if(!root.ATPLCloudAPI||typeof root.ATPLCloudAPI.request!=='function')return Promise.reject(new Error('Cloud API broker unavailable'));
  p=Object.assign({},p||{});if(tok()&&!p.token)p.token=tok();
  return root.ATPLCloudAPI.request(p,Object.assign({source:'dol-v4',timeout:8000,attempts:1,cacheMs:0},opt||{}))
}
function unknown(d){return !!(d&&d.ok===false&&/unknown action|not found/i.test(String(d.error||'')))}
async function probe(){
  if(support!==null)return support;
  if(probePromise)return probePromise;
  probePromise=api({action:'getDOLRecords',type:'esic'},{timeout:18000,cacheMs:1500,attempts:2}).then(function(d){
    if(unknown(d)){support=false;return false}
    if(!(d&&d.ok&&Array.isArray(d.records)))throw new Error(d&&d.error||'DOL V4 probe failed');
    support=true;return true
  }).catch(function(e){if(/unknown action/i.test(errMsg(e)))support=false;else support=null;return false}).finally(function(){probePromise=null});
  return probePromise
}
async function list(type){
  type=String(type||'').toLowerCase();if(type!=='pf'&&type!=='esic')throw new Error('Invalid challan type');
  var d=await api({action:'getDOLRecords',type:type},{timeout:22000,cacheMs:0,attempts:2});
  if(unknown(d)){support=false;throw new Error('DOL_V4_UNAVAILABLE')}
  if(!(d&&d.ok&&Array.isArray(d.records)))throw new Error(d&&d.error||'Challan list failed');
  support=true;return d.records
}
async function check(hash,intent){
  var d=await api({action:'checkDOLDuplicate',file_hash:String(hash||'').toLowerCase(),upload_intent:String(intent||'user_upload')},{timeout:6500,cacheMs:0});
  if(unknown(d)){support=false;throw new Error('DOL_V4_UNAVAILABLE')}
  if(!(d&&d.ok))throw new Error(d&&d.error||'Duplicate check failed');support=true;return d
}
function postForm(action,params,timeout){
  return new Promise(function(resolve,reject){
    var id='atpl_dol_post_'+Date.now()+'_'+(++postSeq),iframe=root.document.createElement('iframe'),form=root.document.createElement('form'),done=false;
    iframe.name=id;iframe.style.display='none';form.style.display='none';form.method='POST';form.target=id;
    form.action=(root.ATPLCloudAPI&&root.ATPLCloudAPI.apiUrl)||'https://script.google.com/macros/s/AKfycby99_893hVtbWOQr67ikxIwiq81MWW8JAa2LuxTu67JBxjQ_iWb-YkqhBmW0RrHU512SQ/exec';
    function finish(e,data){if(done)return;done=true;root.clearTimeout(timer);root.removeEventListener('message',onMsg);try{form.remove();iframe.remove()}catch(_){}if(e)reject(e);else resolve(data)}
    function onMsg(ev){var d=ev&&ev.data;if(!d||d.channel!=='ATPL_DOL_V4_POST'||d.request_id!==id)return;var out=d.data||{};if(out.ok===false)finish(new Error(out.error||'Upload part failed'));else finish(null,out)}
    root.addEventListener('message',onMsg);
    var timer=root.setTimeout(function(){finish(new Error('DOL upload part timeout'))},timeout||15000);
    var p=Object.assign({action:action,token:tok(),request_id:id},params||{});
    Object.keys(p).forEach(function(k){var x=root.document.createElement('input');x.type='hidden';x.name=k;x.value=p[k]==null?'':String(p[k]);form.appendChild(x)});
    (root.document.body||root.document.documentElement).appendChild(iframe);(root.document.body||root.document.documentElement).appendChild(form);
    try{form.submit()}catch(e){finish(e)}
  })
}
async function toBase64(buf){
  return new Promise(function(ok,no){try{var r=new FileReader();r.onerror=function(){no(r.error||new Error('File encode failed'))};r.onload=function(){var s=String(r.result||''),i=s.indexOf(',');ok(i>=0?s.slice(i+1):s)};r.readAsDataURL(new Blob([buf]))}catch(e){no(e)}})
}
async function upload(rec,buf,progress){
  if(!(buf instanceof ArrayBuffer))throw new Error('Original file bytes required');
  var intent=String(rec.uploadIntent||'user_upload'),dup=await check(rec.hash,intent);
  if(dup.duplicate){
    if(!dup.record)throw new Error('Exact same file is already saved in another restricted challan module');
    var ex=dup.record||{};if(String(ex.type||'')!==String(rec.type||''))throw new Error('Exact same file already belongs to '+(ex.type==='pf'?'PF → DOL':'ESIC → DOL'));
    return{duplicate:true,record:ex}
  }
  var digits=[],alnums=[];(rec.ids||[]).forEach(function(x){x=String(x||'');if(/^\d+$/.test(x))digits.push(x);else if(x)alnums.push(x)});
  var begin=await api({action:'beginDOLUpload',type:rec.type,file_hash:rec.hash,name:rec.name,size:rec.size||buf.byteLength,mime:rec.mime||'',period:rec.period||'',period_source:rec.periodSource||'',digit_ids_json:JSON.stringify(digits),alnum_ids_json:JSON.stringify(alnums),upload_intent:intent},{timeout:10000,attempts:2});
  if(!(begin&&begin.ok))throw new Error(begin&&begin.error||'Upload start failed');
  if(begin.duplicate){
    if(!begin.record)throw new Error('Exact same file is already saved in another restricted challan module');
    var ex2=begin.record||{};if(String(ex2.type||'')!==String(rec.type||''))throw new Error('Exact same file already belongs to '+(ex2.type==='pf'?'PF → DOL':'ESIC → DOL'));
    return{duplicate:true,record:ex2}
  }
  var b64=await toBase64(buf),parts=[];for(var i=0;i<b64.length;i+=POST_PART_CHARS)parts.push(b64.slice(i,i+POST_PART_CHARS));b64='';
  for(var at=0;at<parts.length;at+=POST_BATCH_PARTS){
    var batch=parts.slice(at,at+POST_BATCH_PARTS).map(function(data,j){return{idx:at+j,data:data}});
    await postForm('appendDOLChunkBatch',{upload_id:begin.upload_id,parts_json:JSON.stringify(batch)},18000);
    if(progress)progress(Math.min(96,Math.round(((at+batch.length)/Math.max(1,parts.length))*92)+3));
    await new Promise(function(r){root.setTimeout(r,0)})
  }
  parts.length=0;
  var commit=await api({action:'commitDOLUpload',upload_id:begin.upload_id},{timeout:12000,attempts:2});
  if(!(commit&&commit.ok&&commit.record))throw new Error(commit&&commit.error||'Upload commit failed');
  if(String(commit.record.type||'')!==String(rec.type||''))throw new Error('Backend category verification failed');
  var indexResult=null,indexWarning='';
  if(!commit.duplicate&&Array.isArray(rec.contributions)){
    try{indexResult=await saveContributionIndex(commit.record.id,rec.type,rec.contributions,progress)}
    catch(e){indexWarning=errMsg(e)}
  }
  return{duplicate:!!commit.duplicate,record:indexResult&&indexResult.record||commit.record,index:indexResult,indexWarning:indexWarning}
}
async function saveContributionIndex(recordId,type,entries,progress){
  entries=(Array.isArray(entries)?entries:[]).map(function(x){return{memberId:String(x&&x.memberId||''),employeeName:String(x&&x.employeeName||'').slice(0,160),details:x&&typeof x.details==='object'?x.details:{}}}).filter(function(x){return!!x.memberId});
  var begin=await api({action:'beginDOLIndex',id:recordId,type:type},{timeout:9000,attempts:2});
  if(unknown(begin))throw new Error('Detailed contribution index requires Backend V5 deployment');
  if(!(begin&&begin.ok))throw new Error(begin&&begin.error||'Contribution index start failed');
  var step=24;
  for(var at=0;at<entries.length;at+=step){
    var batch=entries.slice(at,at+step);
    await postForm('upsertDOLContributionBatch',{id:recordId,type:type,entries_json:JSON.stringify(batch)},18000);
    if(progress)progress(Math.min(99,96+Math.round(((at+batch.length)/Math.max(1,entries.length))*3)));
    await new Promise(function(r){root.setTimeout(r,0)})
  }
  var done=await api({action:'finalizeDOLIndex',id:recordId,type:type},{timeout:10000,attempts:2});
  if(!(done&&done.ok&&done.record))throw new Error(done&&done.error||'Contribution index finalization failed');
  return done
}
async function searchIndex(type,ids){
  type=String(type||'').toLowerCase();ids=(Array.isArray(ids)?ids:[]).map(String).filter(Boolean).slice(0,60);
  var d=await api({action:'searchDOLIndex',type:type,ids_json:JSON.stringify(ids)},{timeout:22000,cacheMs:0,attempts:2});
  if(unknown(d))throw new Error('DOL_INDEX_V5_UNAVAILABLE');
  if(!(d&&d.ok&&d.matches))throw new Error(d&&d.error||'Contribution search failed');
  return d
}
async function update(rec){
  var d=await api({action:'updateDOLRecord',id:rec.cloudRecordId||rec.id,type:rec.type,name:rec.name||'',period:rec.period||'',period_source:rec.periodSource||'',digit_ids_json:JSON.stringify((rec.ids||[]).filter(function(x){return /^\d+$/.test(String(x))})),alnum_ids_json:JSON.stringify((rec.ids||[]).filter(function(x){return !/^\d+$/.test(String(x))}))},{timeout:9000,attempts:2});
  if(!(d&&d.ok&&d.record))throw new Error(d&&d.error||'Challan update failed');return d.record
}
function deleteName(v){return String(v||'').toLowerCase().replace(/\.[^.]+$/,'').replace(/\(\s*\d+\s*\)$/,'').replace(/[^a-z0-9]+/g,'')}
function sameDeleteTarget(rec,row){
  rec=rec||{};row=row||{};var rt=String(rec.type||'').toLowerCase(),xt=String(row.type||'').toLowerCase();if(rt&&xt&&rt!==xt)return false;
  var ids=[rec.cloudRecordId,rec.id].map(function(x){return String(x||'')}).filter(Boolean),xid=String(row.id||row.cloudRecordId||'');if(xid&&ids.indexOf(xid)>=0)return true;
  var h=String(rec.hash||rec.fileHash||rec.fingerprint||'').toLowerCase(),xh=String(row.hash||row.fileHash||row.fingerprint||'').toLowerCase();if(h&&xh&&h===xh)return true;
  var n=deleteName(rec.name),xn=deleteName(row.name),p=String(rec.period||''),xp=String(row.period||'');return !!(n&&xn&&n===xn&&p===xp)
}
async function remove(rec){
  try{if(root.ATPLCloudAPI&&typeof root.ATPLCloudAPI.clearCache==='function')root.ATPLCloudAPI.clearCache()}catch(_){}
  var type=String(rec&&rec.type||'').toLowerCase(),base={action:'deleteDOLRecord',id:rec.cloudRecordId||rec.id,type:type,file_hash:String(rec.hash||rec.fileHash||rec.fingerprint||'').toLowerCase(),name:String(rec.name||''),period:String(rec.period||'')};
  var d=await api(base,{timeout:22000,attempts:1,cacheMs:0});if(!(d&&d.ok))throw new Error(d&&d.error||'Challan delete failed');
  // Older records can carry a legacy/local id. Resolve and hard-delete every
  // backend row with the same SHA/name+month, then read back before success.
  for(var pass=0;pass<3;pass++){
    try{if(root.ATPLCloudAPI&&typeof root.ATPLCloudAPI.clearCache==='function')root.ATPLCloudAPI.clearCache()}catch(_){}
    var rows=await list(type),left=rows.filter(function(x){return sameDeleteTarget(rec,x)});if(!left.length)break;
    if(pass===2)throw new Error('Delete verification failed — challan still exists in shared backend');
    for(var i=0;i<left.length;i++){
      var one=await api(Object.assign({},base,{id:left[i].id||left[i].cloudRecordId||''}),{timeout:22000,attempts:1,cacheMs:0});
      if(!(one&&one.ok))throw new Error(one&&one.error||'Duplicate challan delete failed')
    }
  }
  try{if(root.ATPLCloudAPI&&typeof root.ATPLCloudAPI.clearCache==='function')root.ATPLCloudAPI.clearCache()}catch(_){}
  return d
}
function b64Bytes(s){var bin=atob(String(s||'')),a=new Uint8Array(bin.length);for(var i=0;i<bin.length;i++)a[i]=bin.charCodeAt(i);return a}
async function fileBlob(rec,progress){
  var id=rec.cloudRecordId||rec.id,info=await api({action:'getDOLFileInfo',id:id},{timeout:9000,cacheMs:3000});
  if(!(info&&info.ok))throw new Error(info&&info.error||'Original file unavailable');
  var chunks=Number(info.chunks||0);if(!chunks)throw new Error('Original file is empty');
  var arrays=[],total=0;
  for(var i=0;i<chunks;i++){
    var d=await api({action:'getDOLFileChunk',id:id,part_index:i},{timeout:10000,cacheMs:15000,attempts:2});
    if(!(d&&d.ok&&Number(d.part_index)===i))throw new Error(d&&d.error||'File chunk '+i+' failed');
    var a=b64Bytes(d.data);arrays.push(a);total+=a.length;if(progress)progress(Math.round(((i+1)/chunks)*100));await new Promise(function(r){root.setTimeout(r,0)})
  }
  var all=new Uint8Array(total),off=0;arrays.forEach(function(a){all.set(a,off);off+=a.length});arrays.length=0;
  return new Blob([all],{type:info.mime||rec.mime||'application/octet-stream'})
}
root.ATPLDOLCloudV4={probe:probe,list:list,check:check,upload:upload,saveContributionIndex:saveContributionIndex,searchIndex:searchIndex,update:update,deleteRecord:remove,fileBlob:fileBlob,supported:function(){return support===true},supportState:function(){return support},version:function(){return BUILD}};
})(window);
