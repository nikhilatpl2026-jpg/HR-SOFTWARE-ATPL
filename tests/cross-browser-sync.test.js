const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

test('atpl-google-drive-sync.js syntax and exports verification', () => {
  const code = fs.readFileSync(path.join(__dirname, '..', 'atpl-google-drive-sync.js'), 'utf8');
  assert.doesNotThrow(() => {
    new vm.Script(code);
  }, 'atpl-google-drive-sync.js must compile without syntax errors');

  // Verify that it exposes all required sync interfaces
  assert.ok(code.includes('window.ATPLGoogleSync = UnifiedSyncEngine;'));
  assert.ok(code.includes('window.ATPLCentralFileSync = UnifiedSyncEngine;'));
  assert.ok(code.includes('window.ATPLRealtimeSyncEngine = UnifiedSyncEngine;'));
  assert.ok(code.includes('window.UniversalEngine = UnifiedSyncEngine;'));
  assert.ok(code.includes('pollSyncState(true);'));
  assert.ok(code.includes('setupSSE();'));
});

test('server.js forwards file uploads and deletes to Google Apps Script Drive backend', () => {
  const serverCode = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.ok(serverCode.includes("syncToGoogleAppsScript('uploadFile'"), 'server.js must forward uploads to Google Apps Script');
  assert.ok(serverCode.includes("syncToGoogleAppsScript('deleteFile'"), 'server.js must forward deletions to Google Apps Script');
  assert.ok(serverCode.includes("syncToGoogleAppsScript('saveEmployeeMaster'"), 'server.js must forward employee master saves to Google Sheets');
  assert.ok(serverCode.includes("syncToGoogleAppsScript('deleteEmployeeMaster'"), 'server.js must forward employee master deletions to Google Sheets');
  assert.ok(serverCode.includes("app.get('/api/sync/events'"), 'server.js must provide real-time SSE stream');
});

test('atpl-google-drive-sync.js handles single-arg and two-arg deleteFile cleanly', () => {
  const code = fs.readFileSync(path.join(__dirname, '..', 'atpl-google-drive-sync.js'), 'utf8');
  assert.ok(code.includes("if (idOrName !== undefined && idOrName !== null && idOrName !== '')"));
});

test('employee-master-confirmed-save-v1.js notifies /api/sync/employee-master on save and delete', () => {
  const code = fs.readFileSync(path.join(__dirname, '..', 'employee-master-confirmed-save-v1.js'), 'utf8');
  assert.ok(code.includes("fetch('/api/sync/employee-master'"), 'Must notify /api/sync/employee-master on save');
  assert.ok(code.includes("fetch('/api/sync/employee-master/'"), 'Must notify /api/sync/employee-master on delete');
  assert.ok(code.includes("g.EM_BULK_ROWS=rowsToSave.filter"), 'Must use rowsToSave in confirmedBulkSave');
});
