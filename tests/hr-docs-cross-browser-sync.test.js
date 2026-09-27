const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const storageCode = fs.readFileSync(path.join(__dirname, '..', 'erp-cloud-shared-storage-v1.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const bundleCode = fs.readFileSync(path.join(__dirname, '..', 'atpl-firebase-bundle.js'), 'utf8');

test('HR Documents Firebase Firestore sync integration', () => {
  // Bundle methods
  assert.ok(bundleCode.includes('saveHrDoc:saveHrDocFb'), 'bundle must export saveHrDoc');
  assert.ok(bundleCode.includes('deleteHrDoc:deleteHrDocFb'), 'bundle must export deleteHrDoc');
  assert.ok(bundleCode.includes('fetchAllHrDocs:fetchAllHrDocsFb'), 'bundle must export fetchAllHrDocs');
  assert.ok(bundleCode.includes('subscribeHrDocs:subscribeHrDocsFb'), 'bundle must export subscribeHrDocs');
  assert.ok(bundleCode.includes('subscribeHrTombstones:subscribeHrTombstonesFb'), 'bundle must export subscribeHrTombstones');

  // Shared storage integration
  assert.ok(storageCode.includes('handleFirebaseHrUpdate'), 'storage must handle realtime HR updates');
  assert.ok(storageCode.includes('handleFirebaseHrTombstonesUpdate'), 'storage must handle realtime HR tombstones');
  assert.ok(storageCode.includes('[Firebase HR Auto-Delete] Purging removed HR doc'), 'storage must auto-delete removed HR docs');
  assert.ok(storageCode.includes('subscribeHrDocs'), 'storage must subscribe to HR docs');
  assert.ok(storageCode.includes('fetchAllHrDocs'), 'storage must fetch all HR docs on boot');

  // Index.html integration
  assert.ok(indexHtml.includes('ATPL_HR_TOMBSTONES_V2'), 'index.html must use ATPL_HR_TOMBSTONES_V2');
  assert.ok(indexHtml.includes('window.ATPLFirebase.deleteHrDoc'), 'index.html must trigger deleteHrDoc on remove');
});
