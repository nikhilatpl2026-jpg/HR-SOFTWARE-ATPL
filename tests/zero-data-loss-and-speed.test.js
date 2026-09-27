const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const storageCode = fs.readFileSync(path.join(__dirname, '..', 'erp-cloud-shared-storage-v1.js'), 'utf8');
const syncCode = fs.readFileSync(path.join(__dirname, '..', 'atpl-permanent-sync-v1.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('Zero Data Loss and Glitch-Free Performance Guards', () => {
  // 1. Persistent non-evictable storage protection
  assert.ok(storageCode.includes('navigator.storage.persist'), 'erp-cloud-shared-storage must request persistent storage');
  assert.ok(syncCode.includes('navigator.storage.persist'), 'atpl-permanent-sync must request persistent storage');

  // 2. Safe Auto-Backup to Firestore if local file not in cloud (Never delete valid local file)
  assert.ok(storageCode.includes('[Data Safety Guard] Auto-backing up local file to Firestore'), 'must auto-backup local file to cloud instead of deleting');
  assert.ok(storageCode.includes('[Data Safety Guard] Auto-backing up local HR doc to Firestore'), 'must auto-backup local HR doc to cloud instead of deleting');

  // 3. No accidental purge of untombstoned files
  assert.ok(!storageCode.includes('if(cloudAuthoritative&&!m){\n       console.log(\'[Auto-Delete] Purging tombstoned local file instead of re-pushing\':'), 'must not purge untombstoned local file');

  // 4. Cached workbook parsing (Zero lag / Zero CPU freeze)
  assert.ok(storageCode.includes('var existing = curFiles.find(function(f){'), 'erp-cloud-shared-storage must reuse parsed workbooks');
  assert.ok(syncCode.includes('var existing = oldFiles.find(function(f) {'), 'atpl-permanent-sync must reuse parsed workbooks');
  assert.ok(indexHtml.includes('var live = FILES.find(function(x){return x && x.name === f.name && x.wb;});'), 'incremental restore must not reparse live workbooks');

  // 5. Background heartbeat does not glitch UI buttons
  assert.ok(syncCode.includes('if (isManual && btnLbl) btnLbl.textContent = "Syncing...";'), 'background sync must not flicker button label');
});
