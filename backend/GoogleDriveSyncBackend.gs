/**
 * ATPL GOOGLE DRIVE & GOOGLE SHEETS SYNC BACKEND (APPS SCRIPT)
 * Deployed Web App: Me / Anyone (Anonymous)
 * Endpoint: https://script.google.com/macros/s/AKfycbzXRtJxaZwSazLG3rcI3wJNUwursJC4zEl9-yqIzbbcNyuBXH2gdkCc1fooGPcgHe-Uig/exec
 */

var DRIVE_FOLDER_NAME = "ATPL_HR_FILES";
var INDEX_SHEET_NAME = "DriveFiles";
var SPREADSHEET_ID = "1SVGnJpzRIDHoYZ1W4VHII0m-JYrisW1xKixLNYG8u9s";

function doGet(e) {
  var p = (e && e.parameter) || {};
  var action = p.action || "status";
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
  var action = data.action || (e && e.parameter && e.parameter.action) || "status";
  var res = handleRequest(action, data);
  return sendOutput(res, data.callback || (e && e.parameter && e.parameter.callback));
}

function handleRequest(action, p) {
  try {
    if (action === "status" || action === "ping") {
      return { ok: true, status: "ATPL Google Cloud Engine Active", timestamp: new Date().toISOString() };
    }
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
    if (action === "saveEmployeeMaster") {
      return saveEmployeeMaster_(p);
    }
    return { ok: false, error: "Unknown action: " + action };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
}

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

  // Also include employees cache from Spreadsheet if available
  var employees = [];
  try {
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName("EmployeeMaster");
    if (sheet) {
      var rows = sheet.getDataRange().getValues();
      if (rows.length > 1) {
        var headers = rows[0];
        for (var i = 1; i < rows.length; i++) {
          var r = rows[i];
          var obj = {};
          for (var j = 0; j < headers.length; j++) {
            obj[headers[j]] = r[j];
          }
          employees.push(obj);
        }
      }
    }
  } catch (_) {}

  var scriptProps = PropertiesService.getScriptProperties();
  var ver = parseInt(scriptProps.getProperty("SYNC_VERSION") || "71", 10);

  return {
    ok: true,
    changed: true,
    currentVersion: ver,
    files: list,
    employees: employees
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

  var scriptProps = PropertiesService.getScriptProperties();
  var ver = parseInt(scriptProps.getProperty("SYNC_VERSION") || "71", 10) + 1;
  scriptProps.setProperty("SYNC_VERSION", String(ver));

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

  var scriptProps = PropertiesService.getScriptProperties();
  var ver = parseInt(scriptProps.getProperty("SYNC_VERSION") || "71", 10) + 1;
  scriptProps.setProperty("SYNC_VERSION", String(ver));

  return { ok: true, version: ver, deleted: count };
}

function saveEmployeeMaster_(p) {
  var records = p.records;
  if (typeof records === "string") {
    try { records = JSON.parse(records); } catch (_) {}
  }
  if (!Array.isArray(records)) return { ok: false, error: "Records must be an array" };

  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName("EmployeeMaster");
  if (!sheet) sheet = ss.insertSheet("EmployeeMaster");

  if (records.length === 0) return { ok: true };
  var headers = Object.keys(records[0]);
  var rows = [headers];
  for (var i = 0; i < records.length; i++) {
    var rec = records[i];
    var row = [];
    for (var j = 0; j < headers.length; j++) {
      row.push(rec[headers[j]] !== undefined ? rec[headers[j]] : "");
    }
    rows.push(row);
  }

  sheet.clearContents();
  sheet.getRange(1, 1, rows.length, headers.length).setValues(rows);

  var scriptProps = PropertiesService.getScriptProperties();
  var ver = parseInt(scriptProps.getProperty("SYNC_VERSION") || "71", 10) + 1;
  scriptProps.setProperty("SYNC_VERSION", String(ver));

  return { ok: true, version: ver, count: records.length };
}

function sendOutput(data, callback) {
  var str = JSON.stringify(data);
  if (callback) {
    return ContentService.createTextOutput(callback + "(" + str + ")").setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(str).setMimeType(ContentService.MimeType.JSON);
}
