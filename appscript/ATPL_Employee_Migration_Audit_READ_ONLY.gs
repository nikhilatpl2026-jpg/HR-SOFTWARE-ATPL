/**
 * ATPL ERP - Employee Master migration AUDIT, read-only.
 *
 * PURPOSE:
 * Compare legacy EmployeeMaster(JSON) to staged Employee_Master(columns).
 * DO NOT transfer, overwrite, edit, delete, export, or disclose employee data.
 * The live GitHub ERP is NOT connected by running this function.
 *
 * Run atplEmployeeMigrationAuditReadOnly() from Apps Script editor.
 * Share ONLY counts from execution log, not names, bank details, passwords.
 */
var ATPL_AUDIT_LEGACY_BOOK_ID_ = '1SVGnJpzRIDHoYZ1W4VHII0m-JYrisW1xKixLNYG8u9s';
var ATPL_AUDIT_LEGACY_TAB_ = 'EmployeeMaster';
var ATPL_AUDIT_STAGE_BOOK_ID_ = '1AMPJRxoSugAMCOK4-Zj2X3GFfIWGsjlTFdHFSvWaMBY';
var ATPL_AUDIT_STAGE_TAB_ = 'Employee_Master';

function atplEmployeeAuditInventory_() {
  var oldBook=SpreadsheetApp.openById(ATPL_AUDIT_LEGACY_BOOK_ID_);
  var stageBook=SpreadsheetApp.openById(ATPL_AUDIT_STAGE_BOOK_ID_);
  var oldSheet=oldBook.getSheetByName(ATPL_AUDIT_LEGACY_TAB_);
  var stageSheet=stageBook.getSheetByName(ATPL_AUDIT_STAGE_TAB_);
  if(!oldSheet || !stageSheet) throw new Error('EXPECTED_EMPLOYEE_MASTER_SHEET_MISSING');
  var oldHeaders=oldSheet.getRange(1,1,1,4).getValues()[0].map(String);
  if(oldHeaders.join('|')!=='emp_id|record_json|updated_by|updated_at') {
    throw new Error('LEGACY_MASTER_FORMAT_CHANGED');
  }
  var stageCols=stageSheet.getLastColumn();
  if(stageCols<2)throw new Error('STAGING_EMPLOYEE_MASTER_FORMAT_CHANGED');
  var stageHeader=stageSheet.getRange(1,1,1,stageCols).getValues()[0].map(String);
  if(stageHeader[0]!=='Employee_Code')throw new Error('STAGING_EMPLOYEE_MASTER_FORMAT_CHANGED');

  var oldCount=Math.max(0,oldSheet.getLastRow()-1);
  var stageCount=Math.max(0,stageSheet.getLastRow()-1);
  if(oldCount>40000 || stageCount>40000)throw new Error('AUDIT_RANGE_EXCEEDS_SAFE_LIMIT');
  var oldRows=oldCount?oldSheet.getRange(2,1,oldCount,2).getValues():[];
  var stageRows=stageCount?stageSheet.getRange(2,1,stageCount,1).getValues():[];
  var report={
    ok:true,mode:'READ_ONLY',liveERPConnected:false,
    legacyTotalRows:oldCount,
    legacyActiveEmployees:0,
    legacyTombstones:0,
    legacySystemRecords:0,
    legacyInvalidJson:0,
    legacyMissingId:0,
    legacyDuplicateActiveIds:0,
    legacyCodeMismatch:0,
    legacyRecordsWithExtraFields:0,
    stagingEmployeeCodes:0,
    stagingDuplicateCodes:0,
    overlapCount:0,
    legacyOnlyCount:0,
    stagingOnlyCount:0,
    // A migration must preserve record_json rather than projecting all
    // employee fields into 15 fixed columns.
    requiresLosslessRecordJson:true,
    oldDataCopied:false
  };
  var oldIds=Object.create(null),stageIds=Object.create(null);
  for(var i=0;i<oldRows.length;i++){
    var id=String(oldRows[i][0]||'').trim();
    var raw=String(oldRows[i][1]||'').trim();
    if(!id){report.legacyMissingId++;continue;}
    var obj;
    try{obj=JSON.parse(raw);if(!obj||typeof obj!=='object'||Array.isArray(obj))throw new Error('Bad JSON');}
    catch(_){report.legacyInvalidJson++;continue;}
    if(id.indexOf('__ATPL_SYS__')===0 || obj._atpl_system===true){
      report.legacySystemRecords++;continue;
    }
    if(obj._atpl_deleted===true){
      report.legacyTombstones++;continue;
    }
    if(obj.emp_id && String(obj.emp_id).trim().toLowerCase()!==id.toLowerCase()){
      report.legacyCodeMismatch++;
    }
    var key=id.toLowerCase();
    if(oldIds[key]){report.legacyDuplicateActiveIds++;continue;}
    oldIds[key]=true;
    report.legacyActiveEmployees++;
    if(Object.keys(obj).length>15)report.legacyRecordsWithExtraFields++;
  }
  for(var j=0;j<stageRows.length;j++){
    var stageId=String(stageRows[j][0]||'').trim().toLowerCase();
    if(!stageId)continue;
    if(stageIds[stageId]){report.stagingDuplicateCodes++;continue;}
    stageIds[stageId]=true;report.stagingEmployeeCodes++;
    if(oldIds[stageId])report.overlapCount++;
    else report.stagingOnlyCount++;
  }
  report.legacyOnlyCount=report.legacyActiveEmployees-report.overlapCount;
  report.migrationReady=false; // requires backup + verified field-preserving migration
  return report;
}

function atplEmployeeMigrationAuditReadOnly() {
  var summary=atplEmployeeAuditInventory_();
  Logger.log('SUCCESS - LEGACY EMPLOYEE AUDIT READ ONLY');
  Logger.log('Legacy rows: '+summary.legacyTotalRows);
  Logger.log('Legacy active employees: '+summary.legacyActiveEmployees);
  Logger.log('Legacy deleted tombstones: '+summary.legacyTombstones);
  Logger.log('Legacy system records: '+summary.legacySystemRecords);
  Logger.log('Legacy invalid JSON: '+summary.legacyInvalidJson);
  Logger.log('Legacy duplicate active IDs: '+summary.legacyDuplicateActiveIds);
  Logger.log('Legacy ID mismatches: '+summary.legacyCodeMismatch);
  Logger.log('Staging employee codes: '+summary.stagingEmployeeCodes);
  Logger.log('Overlapping IDs: '+summary.overlapCount);
  Logger.log('Legacy-only IDs: '+summary.legacyOnlyCount);
  Logger.log('Staging-only IDs: '+summary.stagingOnlyCount);
  Logger.log('IMPORTANT - NO EMPLOYEE RECORDS WERE COPIED OR CHANGED');
  return summary;
}
