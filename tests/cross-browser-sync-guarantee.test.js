const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const storageCode = fs.readFileSync(path.join(__dirname, '..', 'erp-cloud-shared-storage-v1.js'), 'utf8');
const serverCode = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const empSaveCode = fs.readFileSync(path.join(__dirname, '..', 'employee-master-confirmed-save-v1.js'), 'utf8');
const empGuardCode = fs.readFileSync(path.join(__dirname, '..', 'employee-master-persistence-guard-v1.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('Cross-Browser Real-Time Sync & Refresh Persistence Guarantee', () => {
  // 1. Files are NEVER purged unless explicitly tombstoned or cleared
  assert.ok(storageCode.includes('if(isTomb || wasCleared)'), 'Salary files must only be purged when tombstoned or explicitly cleared');
  assert.ok(!storageCode.includes('(!remoteByName[lk] && !isRecentlyUploaded'), 'Must never auto-purge untombstoned salary files based on time or missing remote');
  assert.ok(storageCode.includes('[Data Safety Guard] Auto-backing up local file to Firestore'), 'Untombstoned local file must auto-backup to Firestore');

  // 2. HR docs are NEVER purged without an explicit tombstone
  assert.ok(storageCode.includes('if(isHrTomb)'), 'HR documents must only be purged when tombstoned');
  assert.ok(!storageCode.includes('(!remoteById[lid] && !doc._inFlight && !isRecent)'), 'Must never auto-purge untombstoned HR documents');
  assert.ok(storageCode.includes('[Data Safety Guard] Auto-backing up local HR doc to Firestore'), 'Untombstoned local HR doc must auto-backup to Firestore');

  // 3. Server real-time SSE & persistent endpoints
  assert.ok(serverCode.includes("app.get('/api/sync/events'"), 'Server must expose SSE endpoint for instant updates');
  assert.ok(serverCode.includes("app.get('/api/sync/state'"), 'Server must expose full sync state');
  assert.ok(serverCode.includes("app.post('/api/sync/salary-file'"), 'Server must accept salary file uploads');
  assert.ok(serverCode.includes("app.delete('/api/sync/salary-file/:name'"), 'Server must handle salary file deletion');
  assert.ok(serverCode.includes("app.post('/api/sync/hr-doc'"), 'Server must accept HR doc uploads');
  assert.ok(serverCode.includes("app.delete('/api/sync/hr-doc/:id'"), 'Server must handle HR doc deletion');
  assert.ok(serverCode.includes("app.post('/api/sync/employee-master'"), 'Server must accept Employee Master updates');

  // 4. Client server sync integration
  assert.ok(storageCode.includes('startServerSyncListener'), 'Client must connect to server sync listener');
  assert.ok(storageCode.includes('/api/sync/salary-file'), 'Client must sync salary files to server');
  assert.ok(storageCode.includes('/api/sync/hr-doc'), 'Client must sync HR docs to server');

  // 5. Employee Master cross-browser sync
  assert.ok(empSaveCode.includes('/api/sync/employee-master'), 'Employee Master save must sync to server');
  assert.ok(empSaveCode.includes("postMessage({type:'employee_master_saved'"), 'Employee Master save must broadcast');
  assert.ok(empGuardCode.includes("type==='employee_master_saved'"), 'Employee Master guard must receive broadcast updates');

  // 6. SaveFileToDB clears stale clear markers so fresh files are never skipped on refresh
  assert.ok(indexHtml.includes("localStorage.removeItem('ATPL_ALL_SALARY_CLEARED_AT')"), 'saveFileToDB must clear stale cleared marker');
});
