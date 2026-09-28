const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const storageCode = fs.readFileSync(path.join(__dirname, '..', 'erp-cloud-shared-storage-v1.js'), 'utf8');
const syncCode = fs.readFileSync(path.join(__dirname, '..', 'atpl-permanent-sync-v1.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('Manual Delete Only and Anti-Hang Sync Protection', () => {
  // 1. Files in browser must never be deleted just because they are missing from remote Apps Script
  assert.ok(storageCode.includes('isMissing=false; // Protected'), 'isMissing must never be true to protect local browser files');

  // 2. Tombstone deletion requires tombstone timestamp to be strictly newer than file saved time
  assert.ok(storageCode.includes('isTomb=tombTime>fileTime;'), 'isTomb must compare tombTime > fileTime');
  assert.ok(storageCode.includes('clearLocalSalaryTombstone(name);'), 'explicit salary save can clear a superseded tombstone');
  // A background restore must preserve deletion history; exercise actual races below.

  // 3. Concurrency lock and debounce in Firebase listener to prevent infinite CPU hang loops
  assert.ok(storageCode.includes('var isHandlingFirebaseFiles=false;'), 'must have concurrency lock flag');
  assert.ok(storageCode.includes('lastFirebaseSyncTime'), 'must debounce rapid Firestore snapshots');

  // 4. atpl-permanent-sync must not hide or filter re-saved files based on stale tombstones
  assert.ok(syncCode.includes('fileTime >= tombTime'), 'sync must preserve files saved after deletion');

  // 5. saveFileToDB in index.html clears stale tombstones
  assert.ok(indexHtml.includes('localStorage.getItem(\'ATPL_SALARY_TOMBSTONES_V2\')'), 'saveFileToDB must clear stale tombstone on save');

  // 6. Clear all files records timestamp so cloud sync never resurrects deleted files
  assert.ok(storageCode.includes('ATPL_ALL_SALARY_CLEARED_AT'), 'storage must check ATPL_ALL_SALARY_CLEARED_AT to prevent resurrecting cleared files');
  assert.ok(indexHtml.includes('ATPL_ALL_SALARY_CLEARED_AT'), 'clearAllFiles must record ATPL_ALL_SALARY_CLEARED_AT');
});

require('./salary-delete-restore-barrier.test.cjs');
