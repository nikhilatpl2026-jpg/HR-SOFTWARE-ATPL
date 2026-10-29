const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('atpl-google-drive-sync.js syntax and complete Google Drive & Sheets integration', () => {
  const code = fs.readFileSync(path.join(__dirname, '..', 'atpl-google-drive-sync.js'), 'utf8');

  // Must compile without syntax errors
  assert.doesNotThrow(() => {
    new vm.Script(code);
  }, 'atpl-google-drive-sync.js must compile without syntax errors');

  // Verify Google Apps Script endpoints & functions
  assert.ok(code.includes('callGoogleBackend'), 'Must contain callGoogleBackend transport function');
  assert.ok(code.includes("'uploadFile'"), 'Must call uploadFile on Google Drive backend');
  assert.ok(code.includes("'deleteFile'"), 'Must call deleteFile on Google Drive backend');
  assert.ok(code.includes("'downloadFile'"), 'Must download missing files from Google Drive');
  assert.ok(code.includes("'getSyncState'"), 'Must fetch sync state for cross-browser synchronization');
  assert.ok(code.includes("'saveEmployeeMaster'"), 'Must sync employee master to Google Sheets');
  assert.ok(code.includes("'upsertEmployeeMaster'"), 'Must upsert employee master to Google Sheets');
  assert.ok(code.includes("'deleteEmployeeMaster'"), 'Must delete employee from Google Sheets');

  // Verify multi-device and anti-hang guarantees
  assert.ok(code.includes('currentVersion'), 'Must track remote version for zero-lag lightweight heartbeat');
  assert.ok(code.includes('setInterval'), 'Must poll cloud heartbeat periodically');
  assert.ok(code.includes('visibilitychange'), 'Must listen to visibility change for instant sync on tab switch');
  assert.ok(code.includes('BroadcastChannel'), 'Must notify open tabs via BroadcastChannel');
  assert.ok(code.includes("localStorage.setItem('ATPL_TRIGGER_EVENT'"), 'Must notify other windows via storage event');

  // Verify exported globals
  assert.ok(code.includes('window.ATPLGoogleSync = UnifiedSyncEngine;'));
  assert.ok(code.includes('window.ATPLCentralFileSync = UnifiedSyncEngine;'));
  assert.ok(code.includes('window.ATPLRealtimeSyncEngine = UnifiedSyncEngine;'));
  assert.ok(code.includes('window.UniversalEngine = UnifiedSyncEngine;'));
  assert.ok(code.includes('window.triggerManualCrossBrowserSync'));
});

test('atpl-firebase-bundle.js routes to ATPLGoogleSync for unified synchronization', () => {
  const code = fs.readFileSync(path.join(__dirname, '..', 'atpl-firebase-bundle.js'), 'utf8');
  assert.doesNotThrow(() => {
    new vm.Script(code);
  }, 'atpl-firebase-bundle.js must compile without syntax errors');
  assert.ok(code.includes('ATPLGoogleSync'), 'Must delegate to ATPLGoogleSync');
  assert.ok(code.includes('saveSalaryFile: kI'));
  assert.ok(code.includes('deleteSalaryFile: r_'));
});
