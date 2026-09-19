// ARORA ERP BACKEND V4 — PF/ESIC DOL CLOUD MASTER PATCH
// Apply to the existing Apps Script Code.gs used by the live ERP.
// This patch does NOT replace Employee Master / Users / Activity logic.
// It adds a dedicated, backend-authoritative PF/ESIC DOL store + original-file vault.
//
// 1) Add these constants near the top of Code.gs:
var DOL_SHEET = 'DOLRecords';
var DOL_PARTS_SHEET = 'DOLUploadParts';
var DOL_FOLDER_NAME = 'Arora ERP DOL Challans';
var DOL_FILE_CHUNK = 45000; // base64 chars returned per read chunk

// 2) Add these routes inside doGet(e):
// else if (action === 'getDOLRecords') data = getDOLRecords_(p);
// else if (action === 'checkDOLDuplicate') data = checkDOLDuplicate_(p);
// else if (action === 'beginDOLUpload') data = beginDOLUpload_(p);
// else if (action === 'appendDOLChunk') data = appendDOLChunk_(p);
// else if (action === 'commitDOLUpload') data = commitDOLUpload_(p);
// else if (action === 'updateDOLRecord') data = updateDOLRecord_(p);
// else if (action === 'deleteDOLRecord') data = deleteDOLRecord_(p);
// else if (action === 'getDOLFileInfo') data = getDOLFileInfo_(p);
// else if (action === 'getDOLFileChunk') data = getDOLFileChunk_(p);

// 3) Paste everything below into Code.gs.

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

function beginDOLUpload_(p) {
  var u = requireUser_(p.token);
  var type = String(p.type||'').toLowerCase(), hash = String(p.file_hash||'').toLowerCase();
  if (type!=='pf' && type!=='esic') return {ok:false,error:'Invalid DOL type'};
  if (!hash) return {ok:false,error:'file_hash required'};
  var dup = findDolByHash_(hash);
  if (dup) return {ok:true,duplicate:true,record:publicDol_(dup)};
  var uploadId = Utilities.getUuid().replace(/-/g,'');
  var cache = CacheService.getScriptCache();
  cache.put('ATPL_DOL_UPLOAD_'+uploadId, JSON.stringify({
    user_id:u.id,type:type,file_hash:hash,name:String(p.name||'challan'),
    size:Number(p.size||0)||0,mime:String(p.mime||'application/octet-stream'),
    period:String(p.period||''),period_source:String(p.period_source||''),
    digit_ids:parseJsonArray_(p.digit_ids_json||'[]'),
    alnum_ids:parseJsonArray_(p.alnum_ids_json||'[]'),
    created_at:new Date().toISOString()
  }), 21600);
  return {ok:true,duplicate:false,upload_id:uploadId};
}

function appendDOLChunk_(p) {
  var u = requireUser_(p.token);
  var uploadId = String(p.upload_id||''), idx = Number(p.part_index);
  var data = String(p.data||'');
  if (!uploadId || !isFinite(idx) || idx < 0 || !data) return {ok:false,error:'Invalid upload chunk'};
  if (data.length > 60000) return {ok:false,error:'Chunk too large'};
  var cache = CacheService.getScriptCache();
  var meta = cache.get('ATPL_DOL_UPLOAD_'+uploadId);
  if (!meta) return {ok:false,error:'Upload session expired'};
  var m = JSON.parse(meta);
  if (String(m.user_id) !== String(u.id)) return {ok:false,error:'Upload owner mismatch'};
  var ph = ensureDolSheets_().parts;
  var lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    ph.appendRow([uploadId,idx,data,u.id,new Date().toISOString()]);
  } finally { lock.releaseLock(); }
  return {ok:true,part_index:idx};
}

function commitDOLUpload_(p) {
  var u = requireUser_(p.token);
  var uploadId = String(p.upload_id||'');
  var cache = CacheService.getScriptCache();
  var raw = cache.get('ATPL_DOL_UPLOAD_'+uploadId);
  if (!raw) return {ok:false,error:'Upload session expired'};
  var meta = JSON.parse(raw);
  if (String(meta.user_id)!==String(u.id)) return {ok:false,error:'Upload owner mismatch'};

  var dup = findDolByHash_(meta.file_hash);
  if (dup) {
    cleanupDolParts_(uploadId);
    cache.remove('ATPL_DOL_UPLOAD_'+uploadId);
    return {ok:true,duplicate:true,record:publicDol_(dup)};
  }

  var ph = ensureDolSheets_().parts, n = ph.getLastRow(), parts=[];
  if (n>=2) {
    var rows = ph.getRange(2,1,n-1,5).getValues();
    rows.forEach(function(r){if(String(r[0])===uploadId)parts.push({idx:Number(r[1]),data:String(r[2]||'')})});
  }
  if (!parts.length) return {ok:false,error:'No upload parts found'};
  parts.sort(function(a,b){return a.idx-b.idx});
  var b64 = parts.map(function(x){return x.data}).join('');
  var bytes;
  try { bytes = Utilities.base64Decode(b64); } catch (_) { return {ok:false,error:'Invalid file payload'}; }

  var blob = Utilities.newBlob(bytes, meta.mime||'application/octet-stream', meta.name||'challan');
  var folder = dolFolder_(), file = folder.createFile(blob);
  var now = new Date().toISOString();
  var id = 'dol_'+meta.type+'_'+String(meta.file_hash).slice(0,24);
  var sh = ensureDolSheets_().records;
  var row = [
    id,meta.type,meta.name,meta.file_hash,meta.period||'',meta.period_source||'',
    JSON.stringify(meta.digit_ids||[]),JSON.stringify(meta.alnum_ids||[]),
    Number(meta.size||bytes.length)||bytes.length,meta.mime||'application/octet-stream',
    file.getId(),file.getUrl(),u.id,now,now
  ];
  var lock = LockService.getScriptLock(); lock.waitLock(10000);
  try { sh.appendRow(row); } finally { lock.releaseLock(); }

  cleanupDolParts_(uploadId);
  cache.remove('ATPL_DOL_UPLOAD_'+uploadId);
  return {ok:true,duplicate:false,record:publicDol_(findDolById_(id))};
}

function cleanupDolParts_(uploadId) {
  var ph = ensureDolSheets_().parts, n = ph.getLastRow();
  if (n<2) return;
  var rows = ph.getRange(2,1,n-1,5).getValues(), keep=[];
  rows.forEach(function(r){if(String(r[0])!==String(uploadId))keep.push(r)});
  ph.getRange(2,1,Math.max(1,n-1),5).clearContent();
  if (keep.length) ph.getRange(2,1,keep.length,5).setValues(keep);
}

function updateDOLRecord_(p) {
  requireUser_(p.token);
  var old = findDolById_(p.id);
  if (!old) return {ok:false,error:'DOL record not found'};
  var type = String(p.type||old.type).toLowerCase();
  if (type!=='pf' && type!=='esic') return {ok:false,error:'Invalid DOL type'};
  var sh = ensureDolSheets_().records, now = new Date().toISOString();
  var row = [
    old.id,type,String(p.name||old.name),old.file_hash,
    String(p.period!=null?p.period:old.period),String(p.period_source||old.period_source),
    p.digit_ids_json?String(p.digit_ids_json):JSON.stringify(old.digit_ids),
    p.alnum_ids_json?String(p.alnum_ids_json):JSON.stringify(old.alnum_ids),
    old.size,old.mime,old.drive_file_id,old.drive_url,old.uploaded_by,old.uploaded_at,now
  ];
  sh.getRange(old.row,1,1,15).setValues([row]);
  return {ok:true,record:publicDol_(findDolById_(old.id))};
}

function deleteDOLRecord_(p) {
  var u = requireUser_(p.token);
  var old = findDolById_(p.id);
  if (!old) return {ok:true};
  if (old.drive_file_id) {
    try { DriveApp.getFileById(old.drive_file_id).setTrashed(true); } catch (_) {}
  }
  var sh = ensureDolSheets_().records;
  var lock = LockService.getScriptLock(); lock.waitLock(10000);
  try { sh.deleteRow(old.row); } finally { lock.releaseLock(); }
  return {ok:true,deleted:old.id,deleted_by:u.id};
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
