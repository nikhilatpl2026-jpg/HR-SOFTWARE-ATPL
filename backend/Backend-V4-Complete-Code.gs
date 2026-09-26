// ARORA ERP BACKEND V4 — COMPLETE READY-TO-PASTE CODE.GS
// Production contract: Users + EmployeeMaster + Activity + split SystemRecords + dedicated PF/ESIC DOL records + original-file vault.
// Deploy as a NEW VERSION of the EXISTING Web App so the /exec URL does not change.
// Execute as: Me. Access: keep the existing production access setting.

var SPREADSHEET_ID = '1SVGnJpzRIDHoYZ1W4VHII0m-JYrisW1xKixLNYG8u9s';
var SHEET_NAME = 'Users';
var MASTER_SHEET = 'EmployeeMaster';
var ACTIVITY_SHEET = 'Activity';
var TOKEN_TTL = 21600;
var BACKEND_VERSION = '5.2-dol-orphan-index-cleanup';
var DOL_SHEET = 'DOLRecords';
var DOL_PARTS_SHEET = 'DOLUploadParts';
var DOL_CONTRIBUTIONS_SHEET = 'DOLContributions';
var DOL_DELETED_SHEET = 'DOLDeleted';
var COMPLIANCE_SHEET = 'ComplianceCalendar';
var COMPLIANCE_NOTIFICATIONS_SHEET = 'ComplianceNotifications';
var DOL_FOLDER_NAME = 'Arora ERP DOL Challans';
var DOL_FILE_CHUNK = 500000; // larger read chunks: fewer round-trips for cross-device Open/Download
var DOL_UPLOAD_PART_MAX = 40000;


function doGet(e) {
  var p = (e && e.parameter) || {};
  try {
    ensureUsersSheet_();
    ensureDataSheets_();
    var action = String(p.action || 'ping');
    var data;
    if (action === 'ping') data = {ok:true, service:'Arora ERP Shared Backend', version:BACKEND_VERSION};
    else if (action === 'login') data = login_(p);
    else if (action === 'listUsers') data = listUsers_(p);
    else if (action === 'saveUser') data = saveUser_(p);
    else if (action === 'deleteUser') data = deleteUser_(p);
    else if (action === 'logout') data = logout_(p);
    else if (action === 'getEmployeeMaster') data = getEmployeeMaster_(p);
    else if (action === 'getSystemRecords') data = getSystemRecords_(p);
    else if (action === 'upsertEmployeeMaster') data = upsertEmployeeMaster_(p);
    else if (action === 'deleteEmployeeMaster') data = deleteEmployeeMaster_(p);
    else if (action === 'appendActivity') data = appendActivity_(p);
    else if (action === 'listActivity') data = listActivity_(p);
    else if (action === 'getDOLRecords') data = getDOLRecords_(p);
    else if (action === 'checkDOLDuplicate') data = checkDOLDuplicate_(p);
    else if (action === 'beginDOLUpload') data = beginDOLUpload_(p);
    else if (action === 'appendDOLChunk') data = appendDOLChunk_(p);
    else if (action === 'commitDOLUpload') data = commitDOLUpload_(p);
    else if (action === 'updateDOLRecord') data = updateDOLRecord_(p);
    else if (action === 'deleteDOLRecord') data = deleteDOLRecord_(p);
    else if (action === 'getDOLFileInfo') data = getDOLFileInfo_(p);
    else if (action === 'getDOLFileChunk') data = getDOLFileChunk_(p);
    else if (action === 'beginDOLIndex') data = beginDOLIndex_(p);
    else if (action === 'finalizeDOLIndex') data = finalizeDOLIndex_(p);
    else if (action === 'searchDOLIndex') data = searchDOLIndex_(p);
    else if (action === 'listComplianceCalendar') data = listComplianceCalendar_(p);
    else data = {ok:false, error:'Unknown action'};
    return output_(data, p.callback);
  } catch (err) {
    return output_({ok:false, error:String(err && err.message ? err.message : err)}, p.callback);
  }
}


function output_(obj, callback) {
  var json = JSON.stringify(obj);
  if (callback) {
    var cb = String(callback).replace(/[^A-Za-z0-9_.$]/g, '');
    return ContentService.createTextOutput(cb + '(' + json + ');').setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}


function ensureUsersSheet_() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) sh = ss.insertSheet(SHEET_NAME);
  var headers = ['user_id','user_name','password_hash','is_admin','feature_access','active','updated_at'];
  if (sh.getLastRow() === 0) sh.getRange(1,1,1,headers.length).setValues([headers]);
  else {
    var row = sh.getRange(1,1,1,headers.length).getValues()[0];
    if (String(row[0]) !== 'user_id') sh.getRange(1,1,1,headers.length).setValues([headers]);
  }
  sh.setFrozenRows(1);
  if (sh.getLastRow() < 2) sh.appendRow(['admin','Owner / Admin',sha256_('admin123'),true,'["*"]',true,new Date().toISOString()]);
  return sh;
}


function ensureDataSheets_() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var ms = ss.getSheetByName(MASTER_SHEET) || ss.insertSheet(MASTER_SHEET);
  var as = ss.getSheetByName(ACTIVITY_SHEET) || ss.insertSheet(ACTIVITY_SHEET);
  var mh = ['emp_id','record_json','updated_by','updated_at'];
  var ah = ['event_id','user_id','user_name','event_type','page','action','meta_json','created_at'];
  if (ms.getLastRow() === 0) ms.getRange(1,1,1,mh.length).setValues([mh]);
  if (as.getLastRow() === 0) as.getRange(1,1,1,ah.length).setValues([ah]);
  ms.setFrozenRows(1); as.setFrozenRows(1);
  return {master:ms,activity:as};
}


function sha256_(text) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(text), Utilities.Charset.UTF_8);
  return bytes.map(function(b){ var v=b<0?b+256:b; return ('0'+v.toString(16)).slice(-2); }).join('');
}
function rows_() {
  var sh=ensureUsersSheet_(), n=sh.getLastRow(); if(n<2)return [];
  return sh.getRange(2,1,n-1,7).getValues().map(function(r,i){return {row:i+2,id:String(r[0]||''),name:String(r[1]||''),hash:String(r[2]||''),admin:r[3]===true||String(r[3]).toLowerCase()==='true',access:parseAccess_(r[4]),active:!(r[5]===false||String(r[5]).toLowerCase()==='false'),updated:String(r[6]||'')};}).filter(function(u){return u.id;});
}
function parseAccess_(v){if(Array.isArray(v))return v;var s=String(v||'').trim();if(!s)return[];try{var a=JSON.parse(s);if(Array.isArray(a))return a.map(String);}catch(_){}return s.split(',').map(function(x){return x.trim();}).filter(String);}
function findUser_(id){var key=String(id||'').toLowerCase(),all=rows_();for(var i=0;i<all.length;i++)if(all[i].id.toLowerCase()===key)return all[i];return null;}
function issueToken_(u){var token=Utilities.getUuid().replace(/-/g,'')+Utilities.getUuid().replace(/-/g,'');CacheService.getScriptCache().put('ATPL_TOKEN_'+token,JSON.stringify({id:u.id,admin:u.admin}),TOKEN_TTL);return token;}
function auth_(token){if(!token)return null;var raw=CacheService.getScriptCache().get('ATPL_TOKEN_'+token);if(!raw)return null;try{var s=JSON.parse(raw),u=findUser_(s.id);if(!u||!u.active)return null;return u;}catch(_){return null;}}
function requireUser_(token){var u=auth_(token);if(!u)throw new Error('Valid login session required');return u;}
function requireAdmin_(token){var u=requireUser_(token);if(!u.admin)throw new Error('Admin session required');return u;}
function hasFeature_(u,feature){if(!u)return false;if(u.admin)return true;var key=String(feature||'').toLowerCase();return (u.access||[]).some(function(x){x=String(x||'').toLowerCase();return x==='*'||x===key;});}
function requireFeature_(token,feature){var u=requireUser_(token);if(!hasFeature_(u,feature))throw new Error('Access denied for '+feature);return u;}
function requireAnyFeature_(token,features){var u=requireUser_(token);for(var i=0;i<features.length;i++)if(hasFeature_(u,features[i]))return u;throw new Error('Access denied');}
function dolFeature_(type){return String(type||'').toLowerCase()==='pf'?'pftodol':'esictodol';}
function publicUser_(u){return {id:u.id,name:u.name,admin:u.admin,access:u.admin?['*']:u.access,active:u.active,updated:u.updated};}
function login_(p){var id=String(p.user_id||'').trim(),hash=String(p.password_hash||'').trim().toLowerCase(),u=findUser_(id);if(!u||!u.active||!hash||u.hash.toLowerCase()!==hash)return {ok:false,error:'Wrong User ID or Password.'};return {ok:true,token:issueToken_(u),user:publicUser_(u)};}
function listUsers_(p){requireAdmin_(p.token);return {ok:true,users:rows_().map(publicUser_)};}
function saveUser_(p){requireAdmin_(p.token);var id=String(p.user_id||'').trim(),name=String(p.user_name||'').trim(),hash=String(p.password_hash||'').trim().toLowerCase(),access=parseAccess_(p.feature_access||'[]'),admin=String(p.is_admin||'').toLowerCase()==='true';if(!id||!name)return {ok:false,error:'Name and User ID required.'};if(!admin&&!access.length)return {ok:false,error:'Select at least one feature.'};var sh=ensureUsersSheet_(),old=findUser_(id);if(old){if(old.admin&&!admin)return {ok:false,error:'Owner admin cannot be converted to normal user.'};if(!hash)hash=old.hash;sh.getRange(old.row,1,1,7).setValues([[id,name,hash,admin,JSON.stringify(admin?['*']:access),true,new Date().toISOString()]]);}else{if(!hash)return {ok:false,error:'Password required for new user.'};sh.appendRow([id,name,hash,admin,JSON.stringify(admin?['*']:access),true,new Date().toISOString()]);}return {ok:true,user:publicUser_(findUser_(id))};}
function deleteUser_(p){requireAdmin_(p.token);var u=findUser_(p.user_id);if(!u)return {ok:true};if(u.admin)return {ok:false,error:'Owner admin cannot be deleted.'};ensureUsersSheet_().deleteRow(u.row);return {ok:true};}
function logout_(p){if(p.token)CacheService.getScriptCache().remove('ATPL_TOKEN_'+p.token);return {ok:true};}


function masterRows_(){var sh=ensureDataSheets_().master,n=sh.getLastRow();if(n<2)return[];return sh.getRange(2,1,n-1,4).getValues().map(function(r,i){return {row:i+2,emp_id:String(r[0]||''),json:String(r[1]||''),updated_by:String(r[2]||''),updated_at:String(r[3]||'')};}).filter(function(x){return x.emp_id;});}
function findMaster_(id){var key=String(id||'').trim().toLowerCase(),all=masterRows_();for(var i=0;i<all.length;i++)if(all[i].emp_id.toLowerCase()===key)return all[i];return null;}
function getEmployeeMaster_(p){
  requireAnyFeature_(p.token,['empmaster','cmd','files','audit','machineaudit','bankverify','dolverify','ff','hrdocs','mamsalary']);
  var out=[];
  masterRows_().forEach(function(x){
    if (String(x.emp_id||'').indexOf('__ATPL_SYS__')===0) return;
    try{
      var r=JSON.parse(x.json);
      if (r && r._atpl_system===true) return;
      r._cloud_updated_by=x.updated_by;
      r._cloud_updated_at=x.updated_at;
      out.push(r);
    }catch(_){}
  });
  return {ok:true,records:out,count:out.length,version:BACKEND_VERSION};
}
function getSystemRecords_(p){
  var u=requireUser_(p.token);
  var out=[],kind=String(p.kind||'').trim();
  masterRows_().forEach(function(x){
    var isSystem=String(x.emp_id||'').indexOf('__ATPL_SYS__')===0;
    try{
      var r=JSON.parse(x.json);
      if (!isSystem && !(r && r._atpl_system===true)) return;
      if (kind && String(r.object_kind||'')!==kind) return;
      if (!systemKindAllowed_(u,String(r.object_kind||''))) return;
      r._cloud_updated_by=x.updated_by;
      r._cloud_updated_at=x.updated_at;
      out.push(r);
    }catch(_){}
  });
  return {ok:true,records:out,count:out.length,kind:kind||'all',version:BACKEND_VERSION};
}

function systemKindAllowed_(u,kind){
  kind=String(kind||'').toLowerCase();
  if(u.admin)return true;
  if(kind==='hr_doc'||kind.indexOf('hr_doc')>=0)return hasFeature_(u,'hrdocs');
  if(kind==='bank_ref_v3'||kind==='bank_work_v4')return hasFeature_(u,'bankverify');
  if(kind==='esic_dol_v2'||kind.indexOf('esic')>=0)return hasFeature_(u,'esictodol');
  if(kind==='pf_dol_v2'||kind.indexOf('pf_dol')>=0)return hasFeature_(u,'pftodol');
  if(kind==='durable_state'||kind==='tombstone')return true;
  if(kind==='salary_file'||kind.indexOf('salary_file')>=0)return ['cmd','files','audit','machineaudit','mamsalary','dolverify','ff'].some(function(f){return hasFeature_(u,f)});
  return false;
}

function upsertEmployeeMaster_(p){var u=requireUser_(p.token),id=String(p.emp_id||'').trim(),raw=String(p.record_json||'');if(!id||!raw)return {ok:false,error:'emp_id and record_json required'};var obj;try{obj=JSON.parse(raw);}catch(_){return {ok:false,error:'Invalid employee JSON'};}var system=id.indexOf('__ATPL_SYS__')===0||obj._atpl_system===true;if(system){if(id.indexOf('__ATPL_SYS__')!==0||obj._atpl_system!==true)return {ok:false,error:'Invalid system record'};if(!systemKindAllowed_(u,String(obj.object_kind||'')))return {ok:false,error:'Access denied for system record'};}else if(!hasFeature_(u,'empmaster'))return {ok:false,error:'Access denied for Employee Master'};obj.emp_id=String(obj.emp_id||id).trim();if(obj.emp_id.toLowerCase()!==id.toLowerCase())return {ok:false,error:'Employee code mismatch'};var sh=ensureDataSheets_().master,lock=LockService.getScriptLock();lock.waitLock(10000);try{var old=findMaster_(id);if(old){try{var prev=JSON.parse(old.json);if(!!prev._atpl_system!==!!obj._atpl_system||String(prev.object_kind||'')!==String(obj.object_kind||''))return {ok:false,error:'Record category cannot be changed'};}catch(_){}}var now=new Date().toISOString(),row=[id,JSON.stringify(obj),u.id,now];if(old)sh.getRange(old.row,1,1,4).setValues([row]);else sh.appendRow(row);return {ok:true,emp_id:id,updated_by:u.id,updated_at:now};}finally{lock.releaseLock();}}
function deleteEmployeeMaster_(p){var u=requireUser_(p.token),old=findMaster_(p.emp_id);if(!old)return {ok:true};try{var obj=JSON.parse(old.json);if(obj._atpl_system===true){if(!systemKindAllowed_(u,String(obj.object_kind||'')))return {ok:false,error:'Access denied'};}else if(!hasFeature_(u,'empmaster'))return {ok:false,error:'Access denied'};}catch(_){if(!hasFeature_(u,'empmaster'))return {ok:false,error:'Access denied'};}var lock=LockService.getScriptLock();lock.waitLock(10000);try{ensureDataSheets_().master.deleteRow(old.row);return {ok:true,deleted:String(p.emp_id||''),deleted_by:u.id};}finally{lock.releaseLock();}}


function appendActivity_(p){var u=requireUser_(p.token),sh=ensureDataSheets_().activity,now=new Date().toISOString(),id=Utilities.getUuid();var meta=String(p.meta_json||'{}');try{JSON.parse(meta);}catch(_){meta='{}';}var lock=LockService.getScriptLock();lock.waitLock(10000);try{sh.appendRow([id,u.id,u.name,String(p.event_type||'activity'),String(p.page||''),String(p.action_text||p.action_name||''),meta,now]);}finally{lock.releaseLock();}return {ok:true,event_id:id,created_at:now};}
function listActivity_(p){requireAdmin_(p.token);var sh=ensureDataSheets_().activity,n=sh.getLastRow();if(n<2)return {ok:true,events:[]};var count=Math.min(2000,n-1),start=Math.max(2,n-count+1),rows=sh.getRange(start,1,count,8).getValues(),out=rows.map(function(r){var m={};try{m=JSON.parse(String(r[6]||'{}'));}catch(_){}return {id:String(r[0]||''),user_id:String(r[1]||''),user_name:String(r[2]||''),type:String(r[3]||''),page:String(r[4]||''),action:String(r[5]||''),meta:m,iso:String(r[7]||''),ts:new Date(r[7]).getTime()||0};});return {ok:true,events:out.reverse()};}

function doPost(e) {
  var p = (e && e.parameter) || {};
  var requestId = String(p.request_id || '');
  var data,action='';
  try {
    ensureUsersSheet_();
    ensureDataSheets_();
    action = String(p.action || '');
    if (action === 'appendDOLChunkBatch') data = appendDOLChunkBatch_(p);
    else if (action === 'upsertDOLContributionBatch') data = upsertDOLContributionBatch_(p);
    else if (action === 'upsertComplianceCalendar') data = upsertComplianceCalendar_(p);
    else if (action === 'deleteComplianceCalendar') data = deleteComplianceCalendar_(p);
    else if (action === 'claimComplianceNotification') data = claimComplianceNotification_(p);
    else data = {ok:false,error:'Unknown POST action'};
  } catch (err) {
    data = {ok:false,error:String(err && err.message ? err.message : err)};
  }
  var channel=String(action||'').indexOf('Compliance')>=0?'ATPL_CALENDAR_POST':'ATPL_DOL_V4_POST';
  var payload = JSON.stringify({channel:channel,request_id:requestId,data:data}).replace(/</g,'\\u003c');
  return HtmlService.createHtmlOutput('<script>parent.postMessage('+payload+',"*");<\\/script>')
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
  if(!hasFeature_(u,dolFeature_(meta.type)))return {ok:false,error:'Access denied'};
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
  var ch = ss.getSheetByName(DOL_CONTRIBUTIONS_SHEET) || ss.insertSheet(DOL_CONTRIBUTIONS_SHEET);
  var dh = ss.getSheetByName(DOL_DELETED_SHEET) || ss.insertSheet(DOL_DELETED_SHEET);
  var headers = [
    'id','type','name','file_hash','period','period_source',
    'digit_ids_json','alnum_ids_json','size','mime','drive_file_id','drive_url',
    'uploaded_by','uploaded_at','updated_at','index_count','index_status'
  ];
  var pheaders = ['upload_id','part_index','data','user_id','created_at'];
  var cheaders = ['record_id','type','member_id','employee_name','details_json','period','source_name','updated_at'];
  var dheaders = ['type','file_hash','name_key','period','deleted_by','deleted_at','record_ids_json'];
  if (sh.getLastRow() === 0) sh.getRange(1,1,1,headers.length).setValues([headers]);
  else sh.getRange(1,1,1,headers.length).setValues([headers]);
  if (ph.getLastRow() === 0) ph.getRange(1,1,1,pheaders.length).setValues([pheaders]);
  else ph.getRange(1,1,1,pheaders.length).setValues([pheaders]);
  if (ch.getLastRow() === 0) ch.getRange(1,1,1,cheaders.length).setValues([cheaders]);
  else ch.getRange(1,1,1,cheaders.length).setValues([cheaders]);
  if (dh.getLastRow() === 0) dh.getRange(1,1,1,dheaders.length).setValues([dheaders]);
  else dh.getRange(1,1,1,dheaders.length).setValues([dheaders]);
  sh.setFrozenRows(1); ph.setFrozenRows(1); ch.setFrozenRows(1); dh.setFrozenRows(1);
  return {records:sh,parts:ph,contributions:ch,deleted:dh};
}

function dolRootFolder_() {
  var it = DriveApp.getFoldersByName(DOL_FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(DOL_FOLDER_NAME);
}
function childFolder_(parent,name){var it=parent.getFoldersByName(name);return it.hasNext()?it.next():parent.createFolder(name);}
function dolFolder_(type,period){var root=dolRootFolder_(),typed=childFolder_(root,String(type||'unknown').toUpperCase()),year=/^(\d{4})-/.exec(String(period||''));return childFolder_(typed,year?year[1]:'Month Not Set');}

function dolRows_() {
  var sh = ensureDolSheets_().records, n = sh.getLastRow();
  if (n < 2) return [];
  return sh.getRange(2,1,n-1,17).getValues().map(function(r,i){
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
      updated_at:String(r[14]||''),
      index_count:Number(r[15]||0)||0,
      index_status:String(r[16]||'pending')
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
    uploadedBy:r.uploaded_by,uploadedAt:r.uploaded_at,updatedAt:r.updated_at,
    indexCount:r.index_count,indexStatus:r.index_status
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

function dolNameKey_(name){return String(name||'').toLowerCase().replace(/\.[^.]+$/,'').replace(/\(\s*\d+\s*\)$/,'').replace(/[^a-z0-9]+/g,'');}
function dolDeletedRows_(){
  var sh=ensureDolSheets_().deleted,n=sh.getLastRow();if(n<2)return[];
  return sh.getRange(2,1,n-1,7).getValues().map(function(r,i){return{row:i+2,type:String(r[0]||'').toLowerCase(),file_hash:String(r[1]||'').toLowerCase(),name_key:String(r[2]||''),period:String(r[3]||''),deleted_by:String(r[4]||''),deleted_at:String(r[5]||''),record_ids:parseJsonArray_(r[6])};});
}
function dolDeletedMatch_(type,hash,name,period){
  type=String(type||'').toLowerCase();hash=String(hash||'').toLowerCase();var nk=dolNameKey_(name),per=String(period||'');
  var rows=dolDeletedRows_();for(var i=0;i<rows.length;i++){var r=rows[i];if(r.type!==type)continue;if(hash&&r.file_hash===hash)return r;if(!hash&&nk&&r.name_key===nk&&r.period===per)return r;}return null;
}
function clearDolDeletedUnlocked_(type,hash,name,period){
  var sh=ensureDolSheets_().deleted,n=sh.getLastRow();if(n<2)return 0;type=String(type||'').toLowerCase();hash=String(hash||'').toLowerCase();var nk=dolNameKey_(name),per=String(period||''),rows=sh.getRange(2,1,n-1,7).getValues(),keep=[],removed=0;
  rows.forEach(function(r){var same=String(r[0]||'').toLowerCase()===type&&((hash&&String(r[1]||'').toLowerCase()===hash)||(!hash&&nk&&String(r[2]||'')===nk&&String(r[3]||'')===per));if(same)removed++;else keep.push(r)});
  if(removed){sh.getRange(2,1,n-1,7).clearContent();if(keep.length)sh.getRange(2,1,keep.length,7).setValues(keep)}return removed;
}
function upsertDolDeletedUnlocked_(type,hash,name,period,userId,recordIds){
  type=String(type||'').toLowerCase();hash=String(hash||'').toLowerCase();var nk=dolNameKey_(name),per=String(period||''),sh=ensureDolSheets_().deleted,old=dolDeletedMatch_(type,hash,name,period),row=[type,hash,nk,per,String(userId||''),new Date().toISOString(),JSON.stringify(recordIds||[])];
  if(old)sh.getRange(old.row,1,1,7).setValues([row]);else sh.appendRow(row);
}
function dolRecordMatchesDelete_(r,p){
  if(!r)return false;var type=String(p.type||r.type||'').toLowerCase();if(type&&r.type!==type)return false;
  var id=String(p.id||''),hash=String(p.file_hash||p.hash||'').toLowerCase(),name=dolNameKey_(p.name),period=String(p.period||'');
  if(id&&r.id===id)return true;if(hash&&r.file_hash===hash)return true;return !!(name&&dolNameKey_(r.name)===name&&String(r.period||'')===period);
}

function getDOLRecords_(p) {
  var type = String(p.type||'').toLowerCase();
  if (type !== 'pf' && type !== 'esic') return {ok:false,error:'Invalid DOL type'};
  requireFeature_(p.token,dolFeature_(type));
  var out = dolRows_().filter(function(r){return r.type===type}).map(publicDol_);
  return {ok:true,type:type,records:out,count:out.length,source:'DOLRecords'};
}

function checkDOLDuplicate_(p) {
  var u=requireAnyFeature_(p.token,['pftodol','esictodol']);
  var hash = String(p.file_hash||p.hash||'').toLowerCase();
  if (!hash) return {ok:false,error:'file_hash required'};
  var r = findDolByHash_(hash);
  var deleted=dolDeletedRows_().some(function(x){return x.file_hash===hash});
  return {ok:true,duplicate:!!r,deleted:!r&&deleted,record:r&&hasFeature_(u,dolFeature_(r.type))?publicDol_(r):null};
}

function cleanupStaleDolParts_() {
  var props=PropertiesService.getScriptProperties(),now=Date.now(),key='ATPL_DOL_PART_CLEANUP_TS';
  var last=Number(props.getProperty(key)||0);if(now-last<3600000)return;
  var lock=LockService.getScriptLock();if(!lock.tryLock(1500))return;
  try{
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
  var type = String(p.type||'').toLowerCase(), hash = String(p.file_hash||'').toLowerCase(),intent=String(p.upload_intent||'legacy_migration').toLowerCase();
  if (type!=='pf' && type!=='esic') return {ok:false,error:'Invalid DOL type'};
  if(!hasFeature_(u,dolFeature_(type)))return {ok:false,error:'Access denied'};
  if (!hash) return {ok:false,error:'file_hash required'};
  var dup = findDolByHash_(hash);
  if (dup) return {ok:true,duplicate:true,record:hasFeature_(u,dolFeature_(dup.type))?publicDol_(dup):null};
  var deleted=dolDeletedMatch_(type,hash,p.name,p.period);
  if(deleted&&intent!=='user_upload')return {ok:false,error:'DOL_RECORD_DELETED',deleted:true};
  if(deleted){var dlock=LockService.getScriptLock();dlock.waitLock(10000);try{clearDolDeletedUnlocked_(type,hash,p.name,p.period)}finally{dlock.releaseLock();}}
  var uploadId = Utilities.getUuid().replace(/-/g,'');
  var cache = CacheService.getScriptCache();
  cache.put('ATPL_DOL_UPLOAD_'+uploadId, JSON.stringify({
    user_id:u.id,type:type,file_hash:hash,name:String(p.name||'challan'),
    size:Number(p.size||0)||0,mime:String(p.mime||'application/octet-stream'),
    period:String(p.period||''),period_source:String(p.period_source||''),
    digit_ids:parseJsonArray_(p.digit_ids_json||'[]'),
    alnum_ids:parseJsonArray_(p.alnum_ids_json||'[]'),
    upload_intent:intent,
    created_at:new Date().toISOString()
  }), 21600);
  return {ok:true,duplicate:false,upload_id:uploadId};
}

function appendDOLChunk_(p) {
  var u=requireUser_(p.token),uploadId=String(p.upload_id||''),idx=Number(p.part_index),data=String(p.data||'');
  if(!uploadId||!isFinite(idx)||idx<0||Math.floor(idx)!==idx||!data)return {ok:false,error:'Invalid upload chunk'};
  if(data.length>DOL_UPLOAD_PART_MAX)return {ok:false,error:'Chunk too large'};
  var meta=dolUploadMeta_(uploadId);if(!hasFeature_(u,dolFeature_(meta.type)))return {ok:false,error:'Access denied'};if(String(meta.user_id)!==String(u.id))return {ok:false,error:'Upload owner mismatch'};
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
  var u=requireUser_(p.token),uploadId=String(p.upload_id||''),cache=CacheService.getScriptCache(),raw=cache.get('ATPL_DOL_UPLOAD_'+uploadId);
  if(!raw){try{cleanupDolParts_(uploadId)}catch(_){}return {ok:false,error:'Upload session expired'};}
  var meta=JSON.parse(raw);if(!hasFeature_(u,dolFeature_(meta.type)))return {ok:false,error:'Access denied'};if(String(meta.user_id)!==String(u.id))return {ok:false,error:'Upload owner mismatch'};
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
  var lock=LockService.getScriptLock();lock.waitLock(20000),file=null;
  try{
    var deleted=dolDeletedMatch_(meta.type,meta.file_hash,meta.name,meta.period);
    if(deleted){cleanupDolPartsUnlocked_(uploadId);cache.remove('ATPL_DOL_UPLOAD_'+uploadId);return {ok:false,error:'DOL_RECORD_DELETED',deleted:true};}
    var dup=findDolByHash_(meta.file_hash);
    if(dup){cleanupDolPartsUnlocked_(uploadId);cache.remove('ATPL_DOL_UPLOAD_'+uploadId);return {ok:true,duplicate:true,record:hasFeature_(u,dolFeature_(dup.type))?publicDol_(dup):null};}
    var blob=Utilities.newBlob(bytes,meta.mime||'application/octet-stream',meta.name||'challan');
    file=dolFolder_(meta.type,meta.period).createFile(blob);
    var now=new Date().toISOString(),id='dol_'+meta.type+'_'+String(meta.file_hash).slice(0,24),sh=ensureDolSheets_().records;
    sh.appendRow([id,meta.type,meta.name,meta.file_hash,meta.period||'',meta.period_source||'',JSON.stringify(meta.digit_ids||[]),JSON.stringify(meta.alnum_ids||[]),Number(meta.size||bytes.length)||bytes.length,meta.mime||'application/octet-stream',file.getId(),file.getUrl(),u.id,now,now,0,'pending']);
    cleanupDolPartsUnlocked_(uploadId);cache.remove('ATPL_DOL_UPLOAD_'+uploadId);
    return {ok:true,duplicate:false,record:publicDol_(findDolById_(id))};
  }catch(e){
    if(file){try{file.setTrashed(true);}catch(_){}}
    throw e;
  }finally{lock.releaseLock();}
}

function cleanupDolParts_(uploadId) {
  var lock=LockService.getScriptLock();lock.waitLock(15000);
  try{cleanupDolPartsUnlocked_(uploadId);}finally{lock.releaseLock();}
}

function updateDOLRecord_(p) {
  var u=requireUser_(p.token);var lock=LockService.getScriptLock();lock.waitLock(15000);
  try{
    var old=findDolById_(p.id);if(!old)return {ok:false,error:'DOL record not found'};
    if(!hasFeature_(u,dolFeature_(old.type)))return {ok:false,error:'Access denied'};
    var requested=String(p.type||old.type).toLowerCase();
    if(requested!==old.type)return {ok:false,error:'Challan category cannot be changed; delete and upload in the correct module'};
    var sh=ensureDolSheets_().records,now=new Date().toISOString(),newPeriod=String(p.period!=null?p.period:old.period);
    sh.getRange(old.row,1,1,17).setValues([[
      old.id,old.type,String(p.name||old.name),old.file_hash,newPeriod,String(p.period_source||old.period_source),
      p.digit_ids_json?String(p.digit_ids_json):JSON.stringify(old.digit_ids),p.alnum_ids_json?String(p.alnum_ids_json):JSON.stringify(old.alnum_ids),
      old.size,old.mime,old.drive_file_id,old.drive_url,old.uploaded_by,old.uploaded_at,now,old.index_count,old.index_status
    ]]);
    if(old.drive_file_id&&newPeriod!==old.period){var f=DriveApp.getFileById(old.drive_file_id),target=dolFolder_(old.type,newPeriod),parents=f.getParents();target.addFile(f);while(parents.hasNext()){var parent=parents.next();if(parent.getId()!==target.getId())parent.removeFile(f);}}
    return {ok:true,record:publicDol_(findDolById_(old.id))};
  }finally{lock.releaseLock();}
}

function deleteDOLRecord_(p) {
  var u=requireUser_(p.token),lock=LockService.getScriptLock();lock.waitLock(15000);
  try{
    var rows=dolRows_(),id=String(p.id||''),exact=null;
    for(var i=0;i<rows.length;i++)if(rows[i].id===id){exact=rows[i];break}
    var q={id:id,type:String(p.type||exact&&exact.type||'').toLowerCase(),file_hash:String(p.file_hash||p.hash||exact&&exact.file_hash||'').toLowerCase(),name:String(p.name||exact&&exact.name||''),period:String(p.period||exact&&exact.period||'')};
    if(q.type&&q.type!=='pf'&&q.type!=='esic')return {ok:false,error:'Invalid DOL type'};
    if(q.type&&!hasFeature_(u,dolFeature_(q.type)))return {ok:false,error:'Access denied'};
    var matches=rows.filter(function(r){return dolRecordMatchesDelete_(r,q)});
    if(!matches.length){
      if(q.type&&(q.file_hash||q.name))upsertDolDeletedUnlocked_(q.type,q.file_hash,q.name,q.period,u.id,id?[id]:[]);
      var orphanRemoved=deleteDolContributionsManyUnlocked_(id?[id]:[],[q]);
      return {ok:true,deleted:id,deleted_count:0,already_missing:true,orphan_contributions_removed:orphanRemoved};
    }
    for(var m=0;m<matches.length;m++)if(!hasFeature_(u,dolFeature_(matches[m].type)))return {ok:false,error:'Access denied'};
    upsertDolDeletedUnlocked_(q.type||matches[0].type,q.file_hash||matches[0].file_hash,q.name||matches[0].name,q.period||matches[0].period,u.id,matches.map(function(r){return r.id}));
    var warnings=[];
    matches.forEach(function(r){if(!r.drive_file_id)return;try{DriveApp.getFileById(r.drive_file_id).setTrashed(true)}catch(e){warnings.push('Original file already missing: '+r.id)}});
    var removedContributions=deleteDolContributionsManyUnlocked_(matches.map(function(r){return r.id}),matches.concat([q]));
    var sh=ensureDolSheets_().records;matches.map(function(r){return r.row}).sort(function(a,b){return b-a}).forEach(function(row){sh.deleteRow(row)});
    return {ok:true,deleted:matches[0].id,deleted_ids:matches.map(function(r){return r.id}),deleted_count:matches.length,deleted_contributions:removedContributions,deleted_by:u.id,warnings:warnings};
  }finally{lock.releaseLock();}
}

function getDOLFileInfo_(p) {
  var u=requireUser_(p.token);
  var old = findDolById_(p.id);
  if(old&&!hasFeature_(u,dolFeature_(old.type)))return {ok:false,error:'Access denied'};
  if (!old || !old.drive_file_id) return {ok:false,error:'Original file not found'};
  var f = DriveApp.getFileById(old.drive_file_id), bytes = f.getBlob().getBytes();
  var b64len = Utilities.base64Encode(bytes).length;
  return {
    ok:true,id:old.id,name:old.name,mime:old.mime,size:old.size,
    chunk_size:DOL_FILE_CHUNK,chunks:Math.ceil(b64len/DOL_FILE_CHUNK)
  };
}

function getDOLFileChunk_(p) {
  var u=requireUser_(p.token);
  var old = findDolById_(p.id), idx = Number(p.part_index||0);
  if(old&&!hasFeature_(u,dolFeature_(old.type)))return {ok:false,error:'Access denied'};
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

function dolContributionRows_(){var sh=ensureDolSheets_().contributions,n=sh.getLastRow();if(n<2)return[];return sh.getRange(2,1,n-1,8).getValues().map(function(r,i){return {row:i+2,record_id:String(r[0]||''),type:String(r[1]||''),member_id:String(r[2]||''),employee_name:String(r[3]||''),details_json:String(r[4]||'{}'),period:String(r[5]||''),source_name:String(r[6]||''),updated_at:String(r[7]||'')}});}
function dolContributionDeleteName_(v){return String(v||'').toLowerCase().replace(/^\[(?:archived duplicate)\]\s*/,'').replace(/^(?:pf|esic)\s*·\s*/,'').replace(/\(\s*\d+\s*\)/g,'').replace(/[^a-z0-9]+/g,'');}
function deleteDolContributionsManyUnlocked_(recordIds,targets){
  var ids={};(recordIds||[]).forEach(function(id){id=String(id||'');if(id)ids[id]=1});
  var targetKeys={};(targets||[]).forEach(function(t){
    t=t||{};var type=String(t.type||'').toLowerCase(),name=dolContributionDeleteName_(t.name),period=String(t.period||'');
    if(type&&name)targetKeys[type+'|'+name+'|'+period]=1
  });
  var sh=ensureDolSheets_().contributions,n=sh.getLastRow();if(n<2)return 0;
  var rows=sh.getRange(2,1,n-1,8).getValues(),removed=0,keep=rows.filter(function(r){
    if(ids[String(r[0]||'')]){removed++;return false}
    var key=String(r[1]||'').toLowerCase()+'|'+dolContributionDeleteName_(r[6])+'|'+String(r[5]||'');
    if(targetKeys[key]){removed++;return false}
    return true
  });
  sh.getRange(2,1,n-1,8).clearContent();if(keep.length)sh.getRange(2,1,keep.length,8).setValues(keep);return removed
}
function deleteDolContributionsUnlocked_(recordId){deleteDolContributionsManyUnlocked_([recordId]);}
function setDolIndexStatus_(recordId,count,status){var r=findDolById_(recordId);if(!r)return;ensureDolSheets_().records.getRange(r.row,16,1,2).setValues([[Number(count||0),String(status||'pending')]]);}
function beginDOLIndex_(p){var u=requireUser_(p.token),r=findDolById_(p.id);if(!r)return {ok:false,error:'DOL record not found'};if(!hasFeature_(u,dolFeature_(r.type)))return {ok:false,error:'Access denied'};var lock=LockService.getScriptLock();lock.waitLock(15000);try{deleteDolContributionsUnlocked_(r.id);setDolIndexStatus_(r.id,0,'processing');return {ok:true,id:r.id};}finally{lock.releaseLock();}}
function upsertDOLContributionBatch_(p){var u=requireUser_(p.token),r=findDolById_(p.id),items;if(!r)return {ok:false,error:'DOL record not found'};if(!hasFeature_(u,dolFeature_(r.type)))return {ok:false,error:'Access denied'};try{items=JSON.parse(String(p.entries_json||p.records_json||'[]'));}catch(_){return {ok:false,error:'Invalid records_json'};}if(!Array.isArray(items)||items.length>500)return {ok:false,error:'Invalid contribution batch'};var normalized=[],seen={};items.forEach(function(x){var id=String(x.memberId||x.member_id||'').replace(/\s+/g,'').toUpperCase();if(!id||seen[id])return;seen[id]=true;normalized.push([r.id,r.type,id,String(x.employeeName||x.employee_name||''),JSON.stringify(x.details||{}),r.period,r.name,new Date().toISOString()]);});var lock=LockService.getScriptLock();lock.waitLock(15000);try{var sh=ensureDolSheets_().contributions,old=dolContributionRows_(),existing={};old.forEach(function(x){if(x.record_id===r.id)existing[x.member_id]=x.row});normalized.forEach(function(row){var at=existing[row[2]];if(at)sh.getRange(at,1,1,8).setValues([row]);else sh.appendRow(row)});return {ok:true,written:normalized.length};}finally{lock.releaseLock();}}
function finalizeDOLIndex_(p){var u=requireUser_(p.token),r=findDolById_(p.id);if(!r)return {ok:false,error:'DOL record not found'};if(!hasFeature_(u,dolFeature_(r.type)))return {ok:false,error:'Access denied'};var count=dolContributionRows_().filter(function(x){return x.record_id===r.id}).length;setDolIndexStatus_(r.id,count,'ready');return {ok:true,id:r.id,count:count,record:publicDol_(findDolById_(r.id))};}
function searchDOLIndex_(p){
  var type=String(p.type||'').toLowerCase();requireFeature_(p.token,dolFeature_(type));var ids=[];
  try{ids=JSON.parse(String(p.ids_json||'[]'))}catch(_){}
  if(!Array.isArray(ids)||!ids.length)ids=[p.member_id||p.query||''];
  ids=ids.map(function(x){return String(x||'').replace(/\s+/g,'').toUpperCase()}).filter(String);
  var out={},detailed={};ids.forEach(function(id){out[id]=[]});
  dolContributionRows_().forEach(function(x){
    var mid=String(x.member_id||'').replace(/\s+/g,'').toUpperCase();if(x.type!==type||ids.indexOf(mid)<0)return;
    var details={};try{details=JSON.parse(x.details_json||'{}')}catch(_){}
    detailed[x.record_id+'|'+mid]=1;out[mid].push({recordId:x.record_id,type:x.type,memberId:mid,employeeName:x.employee_name,details:details,period:x.period,sourceChallan:x.source_name})
  });
  var unindexed=[],coverage={},records=dolRows_();
  records.forEach(function(r){
    if(r.type!==type)return;if(r.period)coverage[r.period]=1;if(r.index_status!=='ready')unindexed.push(publicDol_(r));
    var legacy=r.digit_ids.concat(r.alnum_ids).map(function(x){return String(x).replace(/\s+/g,'').toUpperCase()});
    ids.forEach(function(id){if(legacy.indexOf(id)<0||detailed[r.id+'|'+id])return;out[id].push({recordId:r.id,type:r.type,memberId:id,employeeName:'',details:{libraryIndex:true},period:r.period,sourceChallan:r.name})})
  });
  Object.keys(out).forEach(function(id){out[id].sort(function(a,b){return String(a.period).localeCompare(String(b.period))||String(a.recordId).localeCompare(String(b.recordId))})});
  return {ok:true,type:type,matches:out,coverage:Object.keys(coverage).sort(),unindexed:unindexed};
}

function ensureComplianceSheets_(){var ss=SpreadsheetApp.openById(SPREADSHEET_ID),sh=ss.getSheetByName(COMPLIANCE_SHEET)||ss.insertSheet(COMPLIANCE_SHEET),nh=ss.getSheetByName(COMPLIANCE_NOTIFICATIONS_SHEET)||ss.insertSheet(COMPLIANCE_NOTIFICATIONS_SHEET);var h=['id','type','title','department','last_date','due_date','responsible','trainer','notes','status','reminder_days','issue_date','expiry_date','next_action_date','completed_at','created_by','created_at','updated_by','updated_at','revision'],hn=['notification_key','record_id','user_id','state','created_at'];sh.getRange(1,1,1,h.length).setValues([h]);nh.getRange(1,1,1,hn.length).setValues([hn]);sh.setFrozenRows(1);nh.setFrozenRows(1);return {records:sh,notifications:nh};}
function complianceRows_(){var sh=ensureComplianceSheets_().records,n=sh.getLastRow();if(n<2)return[];return sh.getRange(2,1,n-1,20).getValues().map(function(r,i){return {row:i+2,id:String(r[0]||''),type:String(r[1]||''),title:String(r[2]||''),department:String(r[3]||''),lastDate:String(r[4]||''),dueDate:String(r[5]||''),responsible:String(r[6]||''),trainer:String(r[7]||''),notes:String(r[8]||''),status:String(r[9]||''),reminderDays:Number(r[10]||7)||0,issueDate:String(r[11]||''),expiryDate:String(r[12]||''),nextActionDate:String(r[13]||''),completedAt:String(r[14]||''),createdBy:String(r[15]||''),createdAt:String(r[16]||''),updatedBy:String(r[17]||''),updatedAt:String(r[18]||''),revision:Number(r[19]||1)||1};}).filter(function(x){return x.id});}
function listComplianceCalendar_(p){requireFeature_(p.token,'compliancecalendar');var rows=complianceRows_(),since=String(p.updated_since||'');if(since)rows=rows.filter(function(x){return x.updatedAt>since});return {ok:true,records:rows,count:rows.length,serverTime:new Date().toISOString()};}
function complianceRowValues_(x,u,old){var now=new Date().toISOString(),type=String(x.type||'training').toLowerCase();if(type!=='training'&&type!=='legal')throw new Error('Invalid compliance type');var title=String(x.title||'').trim();if(!title)throw new Error('Name is required');var status=String(x.status||'upcoming'),completed=status==='completed'?String(x.completedAt||(old&&old.completedAt)||now):'';return [old?old.id:'cal_'+Utilities.getUuid().replace(/-/g,''),type,title,String(x.department||''),String(x.lastDate||''),String(x.dueDate||''),String(x.responsible||''),String(x.trainer||''),String(x.notes||''),status,Math.max(0,Number(x.reminderDays||7)||0),String(x.issueDate||''),String(x.expiryDate||''),String(x.nextActionDate||''),completed,old?old.createdBy:u.id,old?old.createdAt:now,u.id,now,old?old.revision+1:1];}
function upsertComplianceCalendar_(p){var u=requireFeature_(p.token,'compliancecalendar'),obj;try{obj=JSON.parse(String(p.record_json||'{}'));}catch(_){return {ok:false,error:'Invalid record_json'}}var lock=LockService.getScriptLock();lock.waitLock(15000);try{var old=null;if(obj.id)complianceRows_().some(function(x){if(x.id===String(obj.id)){old=x;return true}return false});if(old&&Number(obj.revision||0)!==old.revision)return {ok:false,error:'This record was updated on another device. Refresh and retry.',conflict:true,current:old};var row=complianceRowValues_(obj,u,old),sh=ensureComplianceSheets_().records;if(old)sh.getRange(old.row,1,1,20).setValues([row]);else sh.appendRow(row);return {ok:true,record:complianceRows_().filter(function(x){return x.id===row[0]})[0]};}finally{lock.releaseLock();}}
function deleteComplianceCalendar_(p){var u=requireFeature_(p.token,'compliancecalendar'),id=String(p.id||''),lock=LockService.getScriptLock();lock.waitLock(15000);try{var old=null;complianceRows_().some(function(x){if(x.id===id){old=x;return true}return false});if(!old)return {ok:true,deleted:id,alreadyMissing:true};if(Number(p.revision||0)!==old.revision)return {ok:false,error:'This record was updated on another device. Refresh and retry.',conflict:true,current:old};ensureComplianceSheets_().records.deleteRow(old.row);return {ok:true,deleted:id,deletedBy:u.id};}finally{lock.releaseLock();}}
function claimComplianceNotification_(p){var u=requireFeature_(p.token,'compliancecalendar'),key=String(p.notification_key||''),id=String(p.id||''),state=String(p.state||'');if(!key||!id)return {ok:false,error:'notification_key and id required'};var lock=LockService.getScriptLock();lock.waitLock(10000);try{var sh=ensureComplianceSheets_().notifications,n=sh.getLastRow();if(n>=2){var rows=sh.getRange(2,1,n-1,5).getValues();for(var i=0;i<rows.length;i++)if(String(rows[i][0])===key)return {ok:true,claimed:false};}sh.appendRow([key,id,u.id,state,new Date().toISOString()]);return {ok:true,claimed:true};}finally{lock.releaseLock();}}
