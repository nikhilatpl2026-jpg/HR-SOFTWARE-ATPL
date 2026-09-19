// ARORA ERP BACKEND V4 — PF/ESIC DOL CLOUD MASTER PATCH
// Apply to the existing Apps Script Code.gs used by the live ERP.
// This patch does NOT replace Employee Master / Users / Activity logic.
// It adds a dedicated, backend-authoritative PF/ESIC DOL store + original-file vault.
//
// 1) Add these constants near the top of Code.gs:
var DOL_SHEET = 'DOLRecords';
var DOL_PARTS_SHEET = 'DOLUploadParts';
var DOL_FOLDER_NAME = 'Arora ERP DOL Challans';
var DOL_FILE_CHUNK = 500000; // larger read chunks: fewer round-trips for cross-device Open/Download
var DOL_UPLOAD_PART_MAX = 40000; // safely below the Google Sheets 50k-character cell limit

// 2) Add these routes inside doGet(e):
// else if (action === 'getDOLRecords') data = getDOLRecords_(p);
// else if (action === 'checkDOLDuplicate') data = checkDOLDuplicate_(p);
// else if (action === 'beginDOLUpload') data = beginDOLUpload_(p);
// else if (action === 'appendDOLChunk') data = appendDOLChunk_(p);
// Large upload parts use doPost below: action=appendDOLChunkBatch
// else if (action === 'commitDOLUpload') data = commitDOLUpload_(p);
// else if (action === 'updateDOLRecord') data = updateDOLRecord_(p);
// else if (action === 'deleteDOLRecord') data = deleteDOLRecord_(p);
// else if (action === 'getDOLFileInfo') data = getDOLFileInfo_(p);
// else if (action === 'getDOLFileChunk') data = getDOLFileChunk_(p);

// 3) Paste everything below into Code.gs.

function doPost(e) {
  var p = (e && e.parameter) || {};
  var requestId = String(p.request_id || '');
  var data;
  try {
    ensureUsersSheet_();
    ensureDataSheets_();
    var action = String(p.action || '');
    if (action === 'appendDOLChunkBatch') data = appendDOLChunkBatch_(p);
    else data = {ok:false,error:'Unknown POST action'};
  } catch (err) {
    data = {ok:false,error:String(err && err.message ? err.message : err)};
  }
  var payload = JSON.stringify({channel:'ATPL_DOL_V4_POST',request_id:requestId,data:data}).replace(/</g,'\\u003c');
  return HtmlService.createHtmlOutput('<script>parent.postMessage('+payload+',"*");</script>')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function dolBytesSha256_(bytes) {
  var dig = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes);
  return dig.map(function(b){var v=b<0?b+256:b;return ('0'+v.toString(16)).slice(-2);}).join('');
}

function dolUploadMeta_(uploadId) {
  var raw = CacheService.getScriptCache().get('ATPL_DOL_UPLOAD_'+String(uploadId||''));
  if (!raw) throw new Error('Upload session expired');
  return JSON.parse(raw);
}

function dolExistingPartMap_(uploadId) {
  var ph=ensureDolSheets_().parts,n=ph.getLastRow(),map={};
  if(n<2)return map;
  ph.getRange(2,1,n-1,5).getValues().forEach(function(r){
    if(String(r[0])===String(uploadId))map[String(Number(r[1]))]=String(r[2]||'');
  });
  return map;
}

function appendDOLChunkBatch_(p) {
  var u=requireUser_(p.token),uploadId=String(p.upload_id||''),parts;
  if(!uploadId) return {ok:false,error:'upload_id required'};
  var meta=dolUploadMeta_(uploadId);
  if(String(meta.user_id)!==String(u.id))return {ok:false,error:'Upload owner mismatch'};
  try{parts=JSON.parse(String(p.parts_json||'[]'));}catch(_){return {ok:false,error:'Invalid parts_json'};}
  if(!Array.isArray(parts)||!parts.length||parts.length>12)return {ok:false,error:'Invalid upload part batch'};
  var total=0,normalized=[];
  for(var i=0;i<parts.length;i++){
    var idx=Number(parts[i]&&parts[i].idx),data=String(parts[i]&&parts[i].data||'');
    if(!isFinite(idx)||idx<0||Math.floor(idx)!==idx||!data)return {ok:false,error:'Invalid upload part'};
    if(data.length>DOL_UPLOAD_PART_MAX)return {ok:false,error:'Upload part too large'};
    total+=data.length;if(total>480000)return {ok:false,error:'Upload batch too large'};
    normalized.push({idx:idx,data:data});
  }
  var ph=ensureDolSheets_().parts,lock=LockService.getScriptLock();lock.waitLock(15000);
  try{
    var existing=dolExistingPartMap_(uploadId),rows=[];
    normalized.forEach(function(x){
      var k=String(x.idx);
      if(Object.prototype.hasOwnProperty.call(existing,k)){
        if(existing[k]!==x.data)throw new Error('Upload retry data mismatch at part '+x.idx);
        return;
      }
      existing[k]=x.data;
      rows.push([uploadId,x.idx,x.data,u.id,new Date().toISOString()]);
    });
    if(rows.length)ph.getRange(ph.getLastRow()+1,1,rows.length,5).setValues(rows);
    return {ok:true,received:normalized.length,written:rows.length};
  }finally{lock.releaseLock();}
}

function cleanupDolPartsUnlocked_(uploadId) {
  var ph=ensureDolSheets_().parts,n=ph.getLastRow();
  if(n<2)return;
  var rows=ph.getRange(2,1,n-1,5).getValues(),keep=[];
  rows.forEach(function(r){if(String(r[0])!==String(uploadId))keep.push(r)});
  ph.getRange(2,1,Math.max(1,n-1),5).clearContent();
  if(keep.length)ph.getRange(2,1,keep.length,5).setValues(keep);
}

function ensureDolSheets_() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sh = ss.getSheetByName(DOL_SHEET) || ss.insertSheet(DOL_SHEET);
  var ph = ss.getSheetByName(DOL_PARTS_SHEET) || ss.insertSheet(DOL_PARTS_SHEET);
  var headers = [
    'id','type','name','file_hash','period','period_source',
    'digit_ids_json','alnum_ids_json','size','mime','drive_file_id','drive_url',
    'uploaded_by','uploaded_at','updated_at'
  ];
  var pheaders = ['upload_id','part_index','data','user_id','created_at'];
  if (sh.getLastRow() === 0) sh.getRange(1,1,1,headers.length).setValues([headers]);
  else sh.getRange(1,1,1,headers.length).setValues([headers]);
  if (ph.getLastRow() === 0) ph.getRange(1,1,1,pheaders.length).setValues([pheaders]);
  else ph.getRange(1,1,1,pheaders.length).setValues([pheaders]);
  sh.setFrozenRows(1); ph.setFrozenRows(1);
  return {records:sh,parts:ph};
}

function dolFolder_() {
  var it = DriveApp.getFoldersByName(DOL_FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(DOL_FOLDER_NAME);
}

function dolRows_() {
  var sh = ensureDolSheets_().records, n = sh.getLastRow();
  if (n < 2) return [];
  return sh.getRange(2,1,n-1,15).getValues().map(function(r,i){
    return {
      row:i+2,
      id:String(r[0]||''),
      type:String(r[1]||'').toLowerCase(),
      name:String(r[2]||''),
      file_hash:String(r[3]||'').toLowerCase(),
      period:String(r[4]||''),
      period_source:String(r[5]||''),
      digit_ids:parseJsonArray_(r[6]),
      alnum_ids:parseJsonArray_(r[7]),
      size:Number(r[8]||0)||0,
      mime:String(r[9]||'application/octet-stream'),
      drive_file_id:String(r[10]||''),
      drive_url:String(r[11]||''),
      uploaded_by:String(r[12]||''),
      uploaded_at:String(r[13]||''),
      updated_at:String(r[14]||'')
    };
  }).filter(function(x){ return x.id; });
}

function parseJsonArray_(v) {
  try {
    var a = JSON.parse(String(v||'[]'));
    return Array.isArray(a) ? a.map(String) : [];
  } catch (_) {
    return [];
  }
}

function publicDol_(r) {
  return {
    id:r.id,type:r.type,name:r.name,fileHash:r.file_hash,fingerprint:r.file_hash,
    period:r.period,periodSource:r.period_source,digitIds:r.digit_ids,alnumIds:r.alnum_ids,
    size:r.size,mime:r.mime,hasOriginalFile:!!r.drive_file_id,
    uploadedBy:r.uploaded_by,uploadedAt:r.uploaded_at,updatedAt:r.updated_at
  };
}

function findDolById_(id) {
  var k = String(id||'');
  var rows = dolRows_();
  for (var i=0;i<rows.length;i++) if (rows[i].id === k) return rows[i];
  return null;
}

function findDolByHash_(hash) {
  var k = String(hash||'').toLowerCase();
  if (!k) return null;
  var rows = dolRows_();
  for (var i=0;i<rows.length;i++) if (rows[i].file_hash === k) return rows[i];
  return null;
}

function getDOLRecords_(p) {
  requireUser_(p.token);
  var type = String(p.type||'').toLowerCase();
  if (type !== 'pf' && type !== 'esic') return {ok:false,error:'Invalid DOL type'};
  var out = dolRows_().filter(function(r){return r.type===type}).map(publicDol_);
  return {ok:true,type:type,records:out,count:out.length,source:'DOLRecords'};
}

function checkDOLDuplicate_(p) {
  requireUser_(p.token);
  var hash = String(p.file_hash||p.hash||'').toLowerCase();
  if (!hash) return {ok:false,error:'file_hash required'};
  var r = findDolByHash_(hash);
  return {ok:true,duplicate:!!r,record:r?publicDol_(r):null};
}

function cleanupStaleDolParts_() {
  var props=PropertiesService.getScriptProperties(),now=Date.now(),key='ATPL_DOL_PART_CLEANUP_TS';
  var last=Number(props.getProperty(key)||0);if(now-last<3600000)return;
  var lock=LockService.getScriptLock();if(!lock.tryLock(1500))return;
  try{
    var saved=props.getProperties();Object.keys(saved).forEach(function(k){if(k.indexOf('ATPL_DOL_UPLOAD_')!==0)return;try{if(now-Date.parse(JSON.parse(saved[k]).created_at)>8*60*60*1000)props.deleteProperty(k)}catch(_){}});
    var ph=ensureDolSheets_().parts,n=ph.getLastRow();if(n<2){props.setProperty(key,String(now));return}
    var rows=ph.getRange(2,1,n-1,5).getValues(),cut=now-(8*60*60*1000),keep=[],removed=0;
    rows.forEach(function(r){var ts=Date.parse(String(r[4]||''))||0;if(ts&&ts>=cut)keep.push(r);else removed++});
    if(removed){ph.getRange(2,1,n-1,5).clearContent();if(keep.length)ph.getRange(2,1,keep.length,5).setValues(keep)}
    props.setProperty(key,String(now));
  }finally{lock.releaseLock();}
}

function beginDOLUpload_(p) {
  var u = requireUser_(p.token);
  cleanupStaleDolParts_();
  var type = String(p.type||'').toLowerCase(), hash = String(p.file_hash||'').toLowerCase();
  if (type!=='pf' && type!=='esic') return {ok:false,error:'Invalid DOL type'};
  if (!hash) return {ok:false,error:'file_hash required'};
  var dup = findDolByHash_(hash);
  if (dup) return {ok:true,duplicate:true,record:publicDol_(dup)};
  var uploadId = Utilities.getUuid().replace(/-/g,'');
  var cache = CacheService.getScriptCache();
  var uploadMeta=JSON.stringify({
    user_id:u.id,type:type,file_hash:hash,name:String(p.name||'challan'),
    size:Number(p.size||0)||0,mime:String(p.mime||'application/octet-stream'),
    period:String(p.period||''),period_source:String(p.period_source||''),
    digit_ids:parseJsonArray_(p.digit_ids_json||'[]'),
    alnum_ids:parseJsonArray_(p.alnum_ids_json||'[]'),
    created_at:new Date().toISOString()
  });
  PropertiesService.getScriptProperties().setProperty('ATPL_DOL_UPLOAD_'+uploadId,JSON.stringify({user_id:u.id,type:type,file_hash:hash,created_at:new Date().toISOString(),receipt_only:true}));
  cache.put('ATPL_DOL_UPLOAD_'+uploadId,uploadMeta,21600);
  return {ok:true,duplicate:false,upload_id:uploadId};
}

function appendDOLChunk_(p) {
  var u=requireUser_(p.token),uploadId=String(p.upload_id||''),idx=Number(p.part_index),data=String(p.data||'');
  if(!uploadId||!isFinite(idx)||idx<0||Math.floor(idx)!==idx||!data)return {ok:false,error:'Invalid upload chunk'};
  if(data.length>DOL_UPLOAD_PART_MAX)return {ok:false,error:'Chunk too large'};
  var meta=dolUploadMeta_(uploadId);if(String(meta.user_id)!==String(u.id))return {ok:false,error:'Upload owner mismatch'};
  var ph=ensureDolSheets_().parts,lock=LockService.getScriptLock();lock.waitLock(15000);
  try{
    var existing=dolExistingPartMap_(uploadId),k=String(idx);
    if(Object.prototype.hasOwnProperty.call(existing,k)){
      if(existing[k]!==data)return {ok:false,error:'Upload retry data mismatch'};
      return {ok:true,part_index:idx,reused:true};
    }
    ph.appendRow([uploadId,idx,data,u.id,new Date().toISOString()]);
    return {ok:true,part_index:idx};
  }finally{lock.releaseLock();}
}

function commitDOLUpload_(p) {
  var u=requireUser_(p.token),uploadId=String(p.upload_id||''),cache=CacheService.getScriptCache(),raw=cache.get('ATPL_DOL_UPLOAD_'+uploadId)||PropertiesService.getScriptProperties().getProperty('ATPL_DOL_UPLOAD_'+uploadId);
  if(!raw){try{cleanupDolParts_(uploadId)}catch(_){}return {ok:false,error:'Upload session expired'};}
  var meta=JSON.parse(raw);if(String(meta.user_id)!==String(u.id))return {ok:false,error:'Upload owner mismatch'};
  var completed=findDolByHash_(meta.file_hash);
  if(completed)return {ok:true,duplicate:true,record:publicDol_(completed)};
  if(meta.receipt_only)return {ok:false,error:'Upload session expired; retry the original file'};
  var ph=ensureDolSheets_().parts,n=ph.getLastRow(),partMap={};
  if(n>=2){
    ph.getRange(2,1,n-1,5).getValues().forEach(function(r){
      if(String(r[0])!==uploadId)return;var idx=Number(r[1]),data=String(r[2]||''),k=String(idx);
      if(Object.prototype.hasOwnProperty.call(partMap,k)&&partMap[k]!==data)throw new Error('Conflicting duplicate upload part '+idx);
      partMap[k]=data;
    });
  }
  var keys=Object.keys(partMap).map(Number).sort(function(a,b){return a-b});
  if(!keys.length)return {ok:false,error:'No upload parts found'};
  for(var i=0;i<keys.length;i++)if(keys[i]!==i)return {ok:false,error:'Upload part sequence incomplete at '+i};
  var b64=keys.map(function(k){return partMap[String(k)]}).join(''),bytes;
  try{bytes=Utilities.base64Decode(b64);}catch(_){return {ok:false,error:'Invalid file payload'};}
  b64='';
  var actualHash=dolBytesSha256_(bytes);
  if(actualHash!==String(meta.file_hash||'').toLowerCase())return {ok:false,error:'SHA-256 verification failed'};
  if(meta.type==='esic'&&/\b(?:ECR|EPF|EPFO|PF\s+CHALLAN|PROVIDENT\s+FUND|UAN|TRRN)\b/i.test(String(meta.name||'')))return {ok:false,error:'PF file blocked from ESIC'};
  var lock=LockService.getScriptLock(),file=null,committed=false;lock.waitLock(20000);
  try{
    var dup=findDolByHash_(meta.file_hash);
    if(dup){try{cleanupDolPartsUnlocked_(uploadId)}catch(_){}return {ok:true,duplicate:true,record:publicDol_(dup)};}
    var blob=Utilities.newBlob(bytes,meta.mime||'application/octet-stream',meta.name||'challan');
    file=dolFolder_().createFile(blob);
    var now=new Date().toISOString(),id='dol_'+meta.type+'_'+String(meta.file_hash).slice(0,24),sh=ensureDolSheets_().records;
    sh.appendRow([id,meta.type,meta.name,meta.file_hash,meta.period||'',meta.period_source||'',JSON.stringify(meta.digit_ids||[]),JSON.stringify(meta.alnum_ids||[]),Number(meta.size||bytes.length)||bytes.length,meta.mime||'application/octet-stream',file.getId(),file.getUrl(),u.id,now,now]);
    committed=true;
    try{cleanupDolPartsUnlocked_(uploadId)}catch(_){}
    return {ok:true,duplicate:false,record:publicDol_(findDolById_(id))};
  }catch(e){
    if(file&&!committed){try{file.setTrashed(true);}catch(_){}}
    throw e;
  }finally{lock.releaseLock();}
}

function cleanupDolParts_(uploadId) {
  var lock=LockService.getScriptLock();lock.waitLock(15000);
  try{cleanupDolPartsUnlocked_(uploadId);}finally{lock.releaseLock();}
}

function updateDOLRecord_(p) {
  requireUser_(p.token);var lock=LockService.getScriptLock();lock.waitLock(15000);
  try{
    var old=findDolById_(p.id);if(!old)return {ok:false,error:'DOL record not found'};
    var requested=String(p.type||old.type).toLowerCase();
    if(requested!==old.type)return {ok:false,error:'Challan category cannot be changed; delete and upload in the correct module'};
    var sh=ensureDolSheets_().records,now=new Date().toISOString();
    sh.getRange(old.row,1,1,15).setValues([[
      old.id,old.type,String(p.name||old.name),old.file_hash,String(p.period!=null?p.period:old.period),String(p.period_source||old.period_source),
      p.digit_ids_json?String(p.digit_ids_json):JSON.stringify(old.digit_ids),p.alnum_ids_json?String(p.alnum_ids_json):JSON.stringify(old.alnum_ids),
      old.size,old.mime,old.drive_file_id,old.drive_url,old.uploaded_by,old.uploaded_at,now
    ]]);
    return {ok:true,record:publicDol_(findDolById_(old.id))};
  }finally{lock.releaseLock();}
}

function deleteDOLRecord_(p) {
  var u=requireUser_(p.token),lock=LockService.getScriptLock();lock.waitLock(15000),file=null,trashed=false;
  try{
    var old=findDolById_(p.id);if(!old)return {ok:true,deleted:String(p.id||''),already_missing:true};
    if(old.drive_file_id){file=DriveApp.getFileById(old.drive_file_id);file.setTrashed(true);trashed=true;}
    try{ensureDolSheets_().records.deleteRow(old.row);}
    catch(e){if(trashed&&file){try{file.setTrashed(false);}catch(_){}}throw e;}
    return {ok:true,deleted:old.id,deleted_by:u.id};
  }finally{lock.releaseLock();}
}

function getDOLFileInfo_(p) {
  requireUser_(p.token);
  var old = findDolById_(p.id);
  if (!old || !old.drive_file_id) return {ok:false,error:'Original file not found'};
  var f = DriveApp.getFileById(old.drive_file_id), bytes = f.getBlob().getBytes();
  var b64len = Utilities.base64Encode(bytes).length;
  return {
    ok:true,id:old.id,name:old.name,mime:old.mime,size:old.size,
    chunk_size:DOL_FILE_CHUNK,chunks:Math.ceil(b64len/DOL_FILE_CHUNK)
  };
}

function getDOLFileChunk_(p) {
  requireUser_(p.token);
  var old = findDolById_(p.id), idx = Number(p.part_index||0);
  if (!old || !old.drive_file_id) return {ok:false,error:'Original file not found'};
  if (!isFinite(idx) || idx<0) return {ok:false,error:'Invalid chunk index'};
  var b64 = Utilities.base64Encode(DriveApp.getFileById(old.drive_file_id).getBlob().getBytes());
  var start = idx * DOL_FILE_CHUNK;
  return {
    ok:true,id:old.id,part_index:idx,
    data:b64.slice(start,start+DOL_FILE_CHUNK),
    done:start+DOL_FILE_CHUNK>=b64.length
  };
}
