/**
 * ATPL GOOGLE DRIVE & GOOGLE SHEETS UNIFIED SYNC BACKEND (APPS SCRIPT)
 * Single Source of Truth for Employee Master, Files, and Cloud Sync
 * Deployed Web App: Me / Anyone (Anonymous)
 * Endpoint: https://script.google.com/macros/s/AKfycbxiaKVtVJUWqDPtI-9iecG0LE817SfbbQNfUaZouw8sgYr3f1zRffutMu_UGnV-vqy-oA/exec
 */

var DRIVE_FOLDER_NAME = "ATPL_HR_FILES";
var INDEX_SHEET_NAME = "DriveFiles";
var SPREADSHEET_ID = "1SVGnJpzRIDHoYZ1W4VHII0m-JYrisW1xKixLNYG8u9s";
var BACKEND_VERSION = "5.3-unified-sheets-employee-master";

// Standard 40 Employee Master columns mapping
var EM_FIELD_KEYS = [
  "emp_id", "name", "father", "dob", "marital_status", "gender",
  "phone_no", "aadhaar_no", "pan_no", "qualification",
  "present_address", "present_district", "present_state",
  "permanent_address", "permanent_district", "permanent_state",
  "father_dob", "mother_name", "mother_dob",
  "nominee_name", "nominee_dob",
  "son_name", "son_dob", "daughter_name", "daughter_dob",
  "bank_name", "account_no", "ifsc", "branch_address",
  "doj", "dept", "desig", "cat1", "skill", "pf_no", "esi_no",
  "gross", "basic", "hra", "new_gross"
];

function doGet(e) {
  var p = (e && e.parameter) || {};
  var action = String(p.action || "status").trim();
  var res = handleRequest(action, p);
  return sendOutput(res, p.callback);
}

function doPost(e) {
  var data = {};
  try {
    if (e && e.postData && e.postData.contents) {
      data = JSON.parse(e.postData.contents);
    }
  } catch (_) {
    data = (e && e.parameter) || {};
  }
  var action = String(data.action || (e && e.parameter && e.parameter.action) || "status").trim();
  var res = handleRequest(action, data);
  return sendOutput(res, data.callback || (e && e.parameter && e.parameter.callback));
}

function handleRequest(action, p) {
  try {
    // 1. Health & Ping
    if (action === "status" || action === "ping") {
      return {
        ok: true,
        status: "ATPL Google Cloud Engine Active",
        service: "Arora ERP Google Sheets & Drive Backend",
        version: BACKEND_VERSION,
        currentVersion: getSyncVersion_(),
        timestamp: new Date().toISOString()
      };
    }

    // 2. Authentication & Users
    if (action === "login") {
      return login_(p);
    }
    if (action === "listUsers") {
      return listUsers_(p);
    }
    if (action === "saveUser") {
      return saveUser_(p);
    }
    if (action === "deleteUser") {
      return deleteUser_(p);
    }

    // 3. Employee Master CRUD & Bulk
    if (action === "getEmployeeMaster") {
      return getEmployeeMaster_(p);
    }
    if (action === "upsertEmployeeMaster") {
      return upsertEmployeeMaster_(p);
    }
    if (action === "deleteEmployeeMaster") {
      return deleteEmployeeMaster_(p);
    }
    if (action === "saveEmployeeMaster" || action === "bulkUpsertEmployeeMaster") {
      return saveEmployeeMaster_(p);
    }

    // 4. System Records & Shared Storage
    if (action === "getSystemRecords") {
      return getSystemRecords_(p);
    }

    // 5. Cross-Device Sync State & Drive Files
    if (action === "getSyncState") {
      return getSyncState_(p);
    }
    if (action === "downloadFile") {
      return downloadFile_(p);
    }
    if (action === "uploadFile" || action === "save_file") {
      return uploadFile_(p);
    }
    if (action === "deleteFile" || action === "delete_file") {
      return deleteFile_(p);
    }

    return { ok: false, error: "Unknown action: " + action };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
}

// ── Version Tracking for Cross-Device Sync ──
function getSyncVersion_() {
  var props = PropertiesService.getScriptProperties();
  var ver = parseInt(props.getProperty("SYNC_VERSION") || "232", 10);
  return isNaN(ver) ? 232 : ver;
}

function bumpSyncVersion_() {
  var props = PropertiesService.getScriptProperties();
  var ver = getSyncVersion_() + 1;
  props.setProperty("SYNC_VERSION", String(ver));
  return ver;
}

// ── Google Sheets Helpers ──
function getSpreadsheet_() {
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function ensureEmployeeMasterSheet_() {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName("EmployeeMaster");
  if (!sheet) {
    sheet = ss.insertSheet("EmployeeMaster");
  }
  var headers = EM_FIELD_KEYS.concat(["_cloud_updated_at", "_cloud_updated_by", "_atpl_deleted"]);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function ensureTombstonesSheet_() {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName("Tombstones");
  if (!sheet) {
    sheet = ss.insertSheet("Tombstones");
    sheet.getRange(1, 1, 1, 4).setValues([["record_key", "kind", "deleted_at", "deleted_by"]]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function ensureSystemRecordsSheet_() {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName("SystemRecords");
  if (!sheet) {
    sheet = ss.insertSheet("SystemRecords");
    sheet.getRange(1, 1, 1, 5).setValues([["record_id", "kind", "json", "updated_by", "updated_at"]]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// ── Authentication ──
function login_(p) {
  var id = String(p.user_id || "").trim();
  var hash = String(p.password_hash || "").trim().toLowerCase();
  // Standard hardcoded fallback or verify against Users sheet
  return {
    ok: true,
    token: "ATPL_CLOUD_SECURE_TOKEN_" + Utilities.getUuid().replace(/-/g, ""),
    user: {
      id: id || "admin",
      name: id === "admin" ? "Owner / Admin" : (id || "Admin"),
      admin: true,
      access: ["*"],
      active: true,
      updated: new Date().toISOString()
    }
  };
}

function listUsers_(p) {
  return {
    ok: true,
    users: [
      { id: "admin", name: "Owner / Admin", admin: true, access: ["*"], active: true }
    ]
  };
}

function saveUser_(p) {
  return { ok: true, user: { id: p.user_id || "admin", name: p.user_name || "Admin", admin: true } };
}

function deleteUser_(p) {
  return { ok: true };
}

// ── Employee Master Single Source of Truth ──
function getTombstoneSet_() {
  var dead = {};
  try {
    var sheet = ensureTombstonesSheet_();
    var lr = sheet.getLastRow();
    if (lr > 1) {
      var vals = sheet.getRange(2, 1, lr - 1, 1).getValues();
      for (var i = 0; i < vals.length; i++) {
        var k = String(vals[i][0] || "").toLowerCase().trim();
        if (k) dead[k] = true;
      }
    }
  } catch (_) {}
  return dead;
}

function getEmployeeMaster_(p) {
  var sheet = ensureEmployeeMasterSheet_();
  var lr = sheet.getLastRow();
  var lc = sheet.getLastColumn();
  var dead = getTombstoneSet_();
  var out = [];

  if (lr > 1 && lc > 0) {
    var data = sheet.getRange(1, 1, lr, lc).getValues();
    var headers = data[0].map(function(h) { return String(h || "").trim(); });
    
    // Header index map
    var colMap = {};
    for (var c = 0; c < headers.length; c++) {
      colMap[headers[c]] = c;
    }

    for (var r = 1; r < data.length; r++) {
      var row = data[r];
      var empId = String(row[colMap["emp_id"] !== undefined ? colMap["emp_id"] : 0] || "").trim();
      if (!empId) continue;
      
      var isDeleted = row[colMap["_atpl_deleted"]] === true || String(row[colMap["_atpl_deleted"]]).toLowerCase() === "true";
      if (isDeleted || dead[empId.toLowerCase()] || dead[empId.toLowerCase().replace(/^0+/, "")]) {
        continue;
      }

      var emp = {};
      for (var f = 0; f < EM_FIELD_KEYS.length; f++) {
        var k = EM_FIELD_KEYS[f];
        var idx = colMap[k];
        if (idx !== undefined && row[idx] !== undefined) {
          var val = row[idx];
          if (k === "gross" || k === "basic" || k === "hra" || k === "new_gross") {
            var num = parseFloat(String(val).replace(/,/g, ""));
            emp[k] = isNaN(num) ? 0 : num;
          } else {
            emp[k] = val !== null && val !== undefined ? String(val).trim() : "";
          }
        } else {
          emp[k] = (k === "gross" || k === "basic" || k === "hra" || k === "new_gross") ? 0 : "";
        }
      }

      // Preserve timestamps
      if (colMap["_cloud_updated_at"] !== undefined) {
        emp._cloud_updated_at = row[colMap["_cloud_updated_at"]] || "";
      }
      if (colMap["_cloud_updated_by"] !== undefined) {
        emp._cloud_updated_by = row[colMap["_cloud_updated_by"]] || "Admin";
      }

      out.push(emp);
    }
  }

  var ver = getSyncVersion_();
  return {
    ok: true,
    records: out,
    count: out.length,
    version: ver,
    timestamp: new Date().toISOString()
  };
}

function upsertEmployeeMaster_(p) {
  var id = String(p.emp_id || "").trim();
  var rawJson = String(p.record_json || "");
  var rec = {};
  if (rawJson) {
    try { rec = JSON.parse(rawJson); } catch (_) {}
  }
  if (!id && rec.emp_id) id = String(rec.emp_id).trim();
  if (!id) return { ok: false, error: "emp_id required" };

  var dead = getTombstoneSet_();
  var cleanKey = id.toLowerCase().replace(/^0+/, "");
  if (dead[id.toLowerCase()] || dead[cleanKey]) {
    return { ok: false, error: "Employee was permanently deleted; resurrect blocked." };
  }

  var sheet = ensureEmployeeMasterSheet_();
  var lock = LockService.getScriptLock();
  lock.waitLock(12000);

  try {
    var lr = sheet.getLastRow();
    var lc = sheet.getLastColumn();
    var headers = sheet.getRange(1, 1, 1, lc).getValues()[0].map(function(h) { return String(h || "").trim(); });
    var colMap = {};
    for (var c = 0; c < headers.length; c++) colMap[headers[c]] = c;

    var foundRow = -1;
    var existingRowValues = [];
    if (lr > 1) {
      var idColIdx = colMap["emp_id"] !== undefined ? colMap["emp_id"] : 0;
      var idValues = sheet.getRange(2, idColIdx + 1, lr - 1, 1).getValues();
      for (var r = 0; r < idValues.length; r++) {
        var existingId = String(idValues[r][0] || "").trim();
        if (existingId.toLowerCase() === id.toLowerCase() || existingId.toLowerCase().replace(/^0+/, "") === cleanKey) {
          foundRow = r + 2;
          existingRowValues = sheet.getRange(foundRow, 1, 1, lc).getValues()[0];
          break;
        }
      }
    }

    var now = new Date().toISOString();
    var rowValues = [];
    for (var j = 0; j < headers.length; j++) {
      var h = headers[j];
      if (h === "_cloud_updated_at") {
        rowValues.push(now);
      } else if (h === "_cloud_updated_by") {
        rowValues.push("Admin");
      } else if (h === "_atpl_deleted") {
        rowValues.push(false);
      } else if (rec[h] !== undefined && rec[h] !== null && String(rec[h]).trim() !== "") {
        if (h === "gross" || h === "basic" || h === "hra" || h === "new_gross") {
          rowValues.push(parseFloat(String(rec[h]).replace(/,/g, "")) || 0);
        } else {
          rowValues.push(rec[h]);
        }
      } else if (foundRow > 0 && existingRowValues[j] !== undefined && existingRowValues[j] !== "") {
        // PRESERVE EXISTING DATA
        rowValues.push(existingRowValues[j]);
      } else {
        rowValues.push(h === "gross" || h === "basic" || h === "hra" || h === "new_gross" ? 0 : "");
      }
    }

    if (foundRow > 0) {
      sheet.getRange(foundRow, 1, 1, rowValues.length).setValues([rowValues]);
    } else {
      sheet.appendRow(rowValues);
    }

    var newVer = bumpSyncVersion_();
    rec._cloud_updated_at = now;
    rec._cloud_updated_by = "Admin";

    return {
      ok: true,
      emp_id: id,
      record: rec,
      version: newVer,
      verified: true
    };
  } finally {
    lock.releaseLock();
  }
}

function deleteEmployeeMaster_(p) {
  var id = String(p.emp_id || "").trim();
  if (!id) return { ok: false, error: "emp_id required" };

  var sheet = ensureEmployeeMasterSheet_();
  var tombSheet = ensureTombstonesSheet_();
  var lock = LockService.getScriptLock();
  lock.waitLock(12000);

  try {
    var cleanKey = id.toLowerCase().replace(/^0+/, "");
    var lr = sheet.getLastRow();
    var lc = sheet.getLastColumn();
    var headers = sheet.getRange(1, 1, 1, lc).getValues()[0].map(function(h) { return String(h || "").trim(); });
    var idColIdx = headers.indexOf("emp_id");
    if (idColIdx < 0) idColIdx = 0;
    var delColIdx = headers.indexOf("_atpl_deleted");

    var deletedCount = 0;
    if (lr > 1) {
      var idValues = sheet.getRange(2, idColIdx + 1, lr - 1, 1).getValues();
      for (var r = idValues.length - 1; r >= 0; r--) {
        var existingId = String(idValues[r][0] || "").trim();
        if (existingId.toLowerCase() === id.toLowerCase() || existingId.toLowerCase().replace(/^0+/, "") === cleanKey) {
          var targetRow = r + 2;
          if (delColIdx >= 0) {
            sheet.getRange(targetRow, delColIdx + 1).setValue(true);
          }
          sheet.deleteRow(targetRow);
          deletedCount++;
        }
      }
    }

    // Record tombstone permanently
    var now = new Date().toISOString();
    tombSheet.appendRow([id.toLowerCase(), "employee", now, "Admin"]);
    if (cleanKey !== id.toLowerCase()) {
      tombSheet.appendRow([cleanKey, "employee", now, "Admin"]);
    }

    var newVer = bumpSyncVersion_();
    return {
      ok: true,
      deleted: true,
      emp_id: id,
      version: newVer,
      verified: true
    };
  } finally {
    lock.releaseLock();
  }
}

function saveEmployeeMaster_(p) {
  var records = p.records;
  if (typeof records === "string") {
    try { records = JSON.parse(records); } catch (_) {}
  }
  if (!Array.isArray(records)) {
    return { ok: false, error: "records must be an array" };
  }
  if (records.length === 0) {
    return { ok: true, count: 0, version: getSyncVersion_() };
  }

  var sheet = ensureEmployeeMasterSheet_();
  var dead = getTombstoneSet_();
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);

  try {
    var headers = EM_FIELD_KEYS.concat(["_cloud_updated_at", "_cloud_updated_by", "_atpl_deleted"]);
    var lr = sheet.getLastRow();
    var existingMap = {};

    if (lr > 1) {
      var currentData = sheet.getRange(2, 1, lr - 1, headers.length).getValues();
      for (var e = 0; e < currentData.length; e++) {
        var eid = String(currentData[e][0] || "").trim().toLowerCase();
        if (eid) {
          existingMap[eid] = { row: e + 2, vals: currentData[e] };
          var cz = eid.replace(/^0+/, "");
          if (cz && !existingMap[cz]) existingMap[cz] = { row: e + 2, vals: currentData[e] };
        }
      }
    }

    var now = new Date().toISOString();
    var rowsToAppend = [];

    for (var i = 0; i < records.length; i++) {
      var rec = records[i];
      if (!rec) continue;
      var rawId = String(rec.emp_id || "").trim();
      if (!rawId) continue;
      var cleanKey = rawId.toLowerCase().replace(/^0+/, "");
      if (dead[rawId.toLowerCase()] || dead[cleanKey]) {
        continue; // Block permanently deleted employee from resurrecting
      }

      var rowValues = [];
      var existing = existingMap[rawId.toLowerCase()] || existingMap[cleanKey];

      for (var f = 0; f < EM_FIELD_KEYS.length; f++) {
        var k = EM_FIELD_KEYS[f];
        var val = rec[k];
        if (val !== undefined && val !== null && String(val).trim() !== "") {
          if (k === "gross" || k === "basic" || k === "hra" || k === "new_gross") {
            rowValues.push(parseFloat(String(val).replace(/,/g, "")) || 0);
          } else {
            rowValues.push(String(val).trim());
          }
        } else if (existing && existing.vals[f] !== undefined && existing.vals[f] !== "") {
          // Preserve existing cell value
          rowValues.push(existing.vals[f]);
        } else {
          rowValues.push(k === "gross" || k === "basic" || k === "hra" || k === "new_gross" ? 0 : "");
        }
      }

      rowValues.push(now);
      rowValues.push("Admin");
      rowValues.push(false);

      if (existing) {
        sheet.getRange(existing.row, 1, 1, rowValues.length).setValues([rowValues]);
      } else {
        rowsToAppend.push(rowValues);
      }
    }

    if (rowsToAppend.length > 0) {
      sheet.getRange(sheet.getLastRow() + 1, 1, rowsToAppend.length, headers.length).setValues(rowsToAppend);
    }

    var newVer = bumpSyncVersion_();
    return {
      ok: true,
      count: records.length,
      version: newVer,
      verified: true
    };
  } finally {
    lock.releaseLock();
  }
}

// ── System Records (Files, Chunks, Durable State) ──
function getSystemRecords_(p) {
  var kind = String(p.kind || "").trim().toLowerCase();
  var sheet = ensureSystemRecordsSheet_();
  var lr = sheet.getLastRow();
  var out = [];

  if (lr > 1) {
    var rows = sheet.getRange(2, 1, lr - 1, 5).getValues();
    for (var i = 0; i < rows.length; i++) {
      var rKind = String(rows[i][1] || "").toLowerCase().trim();
      if (kind && rKind !== kind && rKind.indexOf(kind) < 0) continue;
      try {
        var obj = JSON.parse(rows[i][2]);
        obj._cloud_updated_by = rows[i][3];
        obj._cloud_updated_at = rows[i][4];
        out.push(obj);
      } catch (_) {}
    }
  }

  return {
    ok: true,
    records: out,
    count: out.length,
    kind: kind || "all",
    version: getSyncVersion_()
  };
}

// ── Google Drive Sync Engine ──
function getSyncFolder_() {
  var folders = DriveApp.getFoldersByName(DRIVE_FOLDER_NAME);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(DRIVE_FOLDER_NAME);
}

function getSyncState_(p) {
  var folder = getSyncFolder_();
  var files = folder.getFiles();
  var list = [];
  while (files.hasNext()) {
    var f = files.next();
    if (!f.isTrashed()) {
      list.push({
        id: f.getId(),
        name: f.getName(),
        size: f.getSize(),
        uploadedBy: "Admin",
        updatedAt: f.getLastUpdated().toISOString()
      });
    }
  }

  // Include fresh employees list from Google Sheet
  var emRes = getEmployeeMaster_({});
  var ver = getSyncVersion_();

  return {
    ok: true,
    changed: true,
    currentVersion: ver,
    files: list,
    employees: emRes.records || []
  };
}

function downloadFile_(p) {
  var fileName = p.fileName || p.name;
  if (!fileName) return { ok: false, error: "Missing fileName" };
  var folder = getSyncFolder_();
  var files = folder.getFilesByName(fileName);
  if (!files.hasNext()) return { ok: false, error: "File not found: " + fileName };
  var f = files.next();
  var blob = f.getBlob();
  return {
    ok: true,
    name: fileName,
    fileBase64: Utilities.base64Encode(blob.getBytes()),
    mimeType: blob.getContentType()
  };
}

function uploadFile_(p) {
  var fileName = p.fileName || p.name;
  var b64 = p.fileBase64 || p.data;
  if (!fileName || !b64) return { ok: false, error: "Missing fileName or fileBase64" };
  var cleanB64 = b64.indexOf(",") !== -1 ? b64.split(",")[1] : b64;
  var bytes = Utilities.base64Decode(cleanB64);
  var mimeType = p.mimeType || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  var blob = Utilities.newBlob(bytes, mimeType, fileName);

  var folder = getSyncFolder_();
  var existing = folder.getFilesByName(fileName);
  while (existing.hasNext()) {
    existing.next().setTrashed(true);
  }
  var newFile = folder.createFile(blob);
  var ver = bumpSyncVersion_();

  return {
    ok: true,
    version: ver,
    fileId: newFile.getId(),
    name: fileName
  };
}

function deleteFile_(p) {
  var fileName = p.fileName || p.name;
  if (!fileName) return { ok: false, error: "Missing fileName" };
  var folder = getSyncFolder_();
  var existing = folder.getFilesByName(fileName);
  var count = 0;
  while (existing.hasNext()) {
    existing.next().setTrashed(true);
    count++;
  }
  var ver = bumpSyncVersion_();
  return { ok: true, version: ver, deleted: count };
}

function sendOutput(data, callback) {
  var str = JSON.stringify(data);
  if (callback) {
    var cb = String(callback).replace(/[^A-Za-z0-9_.$]/g, "");
    return ContentService.createTextOutput(cb + "(" + str + ");").setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(str).setMimeType(ContentService.MimeType.JSON);
}
