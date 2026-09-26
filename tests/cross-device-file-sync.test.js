const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const code = fs.readFileSync(path.join(__dirname, '..', 'erp-cloud-shared-storage-v1.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('erp-cloud-shared-storage-v1 contains auto-delete, tombstones and delete hook', () => {
  assert.ok(code.includes('hookSalaryDelete'), 'hookSalaryDelete must be registered');
  assert.ok(code.includes('cloudDeleteSalary'), 'cloudDeleteSalary must exist');
  assert.ok(code.includes('saveLocalSalaryTombstone'), 'local tombstone recorder must exist');
  assert.ok(code.includes('deleteSalaryFromDb'), 'local DB deletion must exist');
  assert.ok(code.includes('ATPL_SALARY_TOMBSTONES_V2'), 'tombstone storage key must be set');
  assert.ok(code.includes('_atpl_kind:\'tombstone\''), 'tombstone kind must be saved to cloud');
  assert.ok(code.includes('salary_file_tombstone') || code.includes('object_kind:\'salary_file\''), 'salary file tombstone kind must be handled');
  assert.ok(code.includes('[Auto-Delete] Purging removed file locally'), 'pullSalary must auto-delete removed files');
  assert.ok(code.includes('Purging tombstoned local file instead of re-pushing'), 'pushSalary must never resurrect tombstoned files');
  assert.ok(code.includes('ATPL_ERP_SHARED_V2'), 'broadcast channel must be connected');
});

test('Firebase real-time sync integration exists and is loaded', () => {
  assert.ok(indexHtml.includes('atpl-firebase-bundle.js'), 'index.html must load atpl-firebase-bundle.js');
  assert.ok(code.includes('ATPLFirebase'), 'erp-cloud-shared-storage-v1 must reference ATPLFirebase');
  assert.ok(code.includes('subscribeSalaryFiles'), 'erp-cloud-shared-storage-v1 must subscribe to Firestore files');
  assert.ok(code.includes('deleteSalaryFile'), 'erp-cloud-shared-storage-v1 must call deleteSalaryFile');
  assert.ok(code.includes('saveSalaryFile'), 'erp-cloud-shared-storage-v1 must call saveSalaryFile');
  assert.ok(code.includes('[Firebase Auto-Delete] Purging removed file'), 'Strict Firebase auto-delete logic must be implemented');
});

test('Backend allows salary_file tombstones', () => {
  const backend = fs.readFileSync(path.join(__dirname, '..', 'backend', 'Backend-V4-Complete-Code.gs'), 'utf8');
  assert.ok(backend.includes("kind.indexOf('salary_file')>=0"), 'Backend must permit salary_file and salary_file_tombstone');
  assert.ok(backend.includes("kind.indexOf('hr_doc')>=0"), 'Backend must permit hr_doc and hr_doc_tombstone');
});
