'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

function read(name){return fs.readFileSync(path.join(__dirname,'..',name),'utf8')}

const mobile=read('erp-mobile-shared-hardfix-v1.js');
const login=mobile.slice(mobile.indexOf('async function hardLogin'),mobile.indexOf('function captureClick'));
const unlockAt=login.indexOf('unlockApp(lr.user,true)');
assert(unlockAt>0,'successful cloud login must unlock the app');
assert(!login.slice(0,unlockAt).includes('await pullMaster'),'login must not wait for Employee Master hydration');
assert(!login.slice(0,unlockAt).includes('await pullUsers'),'login must not wait for the user-list refresh');
assert(login.indexOf('hydrateAfterLogin(lr.user)')>unlockAt,'shared hydration must start after the UI unlocks');
assert(mobile.includes("ATPLCloudAPI.ping()"),'login endpoint should be pre-warmed');

const dol=read('compliance-dol-rebuild-v2.js');
assert(dol.includes("x.record&&x.record.id"),'batch acknowledgement must use the durable API record id');
assert(dol.includes('if(cloudSyncPromise)return cloudSyncPromise'),'DOL sync must be single-flight');
assert(dol.includes('cloudWriteTail'),'DOL cloud writes must be serialized');
assert(dol.includes('pending.slice(0,CLOUD_BATCH_SIZE)'),'legacy migration must upload in bounded batches');
assert(dol.indexOf("await Promise.all([pullCloudIndex('esic'),pullCloudIndex('pf')])")<dol.indexOf('pending.slice(0,CLOUD_BATCH_SIZE)'),'cloud records must reconcile before pending local migration');
assert(!/migrateDbFilesToVault\(\);await syncCloudIndexes\(\)/.test(dol),'DOL boot must not block local UI on cloud migration');

const account=read('erp-account-cloud-restore-v1.js');
assert(account.includes('root.ATPLAccountCloudRestoreV1='),'account orchestration must have its own public API');
assert(!account.includes('root.ATPLCloudSharedStorageV1={'),'account orchestration must not overwrite the file-sharing API');
assert(account.includes('Promise.allSettled'),'independent shared-data pulls should run in parallel');

const files=read('erp-cloud-shared-storage-v1.js');
assert(files.indexOf("action:'getSystemRecords'")<files.indexOf("action:'getEmployeeMaster'"),'file sync should use the split system-record endpoint first');
assert(files.includes('root.ATPLCloudAPI.request'),'file sync must use the shared request broker');
assert(files.includes('root.pako.ungzip'),'mobile browsers need a gzip decoding fallback');

const html=read('index.html');
const sharedAt=html.indexOf('erp-cloud-shared-storage-v1.js?v=20260919-shared-files2');
const durableAt=html.indexOf('erp-durable-everything-v1.js?v=20260919-broker2');
assert(sharedAt>0&&sharedAt<durableAt,'shared-file storage must load before the durable orchestrator');
assert(!html.includes('</script>\\n<script src="employee-master-confirmed-save-v1.js'),'script tags must not contain a literal escaped newline');

console.log('shared-cross-device-final.test.js: all assertions passed');
