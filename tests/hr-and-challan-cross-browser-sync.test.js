const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const storageCode = fs.readFileSync(path.join(__dirname, '..', 'erp-cloud-shared-storage-v1.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const bundleCode = fs.readFileSync(path.join(__dirname, '..', 'atpl-firebase-bundle.js'), 'utf8');
const hrActivityCode = fs.readFileSync(path.join(__dirname, '..', 'hr-docs-activity-v1.js'), 'utf8');

test('Cross-Browser HR Documents and Challan Sync Guarantees', () => {
  // 1. Firebase bundle stores updated_at in metadata
  assert.ok(bundleCode.includes('updated_at:String(docObj.updated_at||new Date().toISOString())'), 'bundle must write updated_at to HR doc metadata');

  // 2. Shared storage updates in-memory DOCS array and refreshes Challan
  assert.ok(storageCode.includes('rem.updated_at||rem.saved_at||rem.uploaded_at||rem.created_at'), 'storage must inspect all timestamp variants');
  assert.ok(storageCode.includes("initStatutoryChallanTab"), 'storage refresh must invoke initStatutoryChallanTab');

  // 3. hr-docs-activity-v1 must not destroy DOCS array on navigation
  assert.ok(!hrActivityCode.includes("r.splice(0,r.length)"), 'hr-docs-activity must never clear documents on navigation');
  assert.ok(hrActivityCode.includes("localStorage.getItem('ATPL_UserSession_V5')"), 'hr-docs-activity must recognize local sessions across browsers');

  // 4. index.html must provide manual HR sync and direct Firebase subscriptions
  assert.ok(indexHtml.includes('triggerManualHrSync'), 'index.html must provide triggerManualHrSync');
  assert.ok(indexHtml.includes('subscribeHrDocs'), 'index.html must subscribe to HR documents');
  assert.ok(indexHtml.includes('subscribeHrTombstones'), 'index.html must subscribe to HR tombstones');
  assert.ok(indexHtml.includes('btnSyncHrDocs'), 'index.html must provide Sync HR Documents button');
});
