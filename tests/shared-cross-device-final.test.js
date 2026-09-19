'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
function read(name){return fs.readFileSync(path.join(__dirname,'..',name),'utf8')}

const mobile=read('erp-mobile-shared-hardfix-v1.js');
const login=mobile.slice(mobile.indexOf('async function hardLogin'),mobile.indexOf('function captureClick'));
const unlockAt=login.indexOf('unlockApp(lr.user,true)');
assert(unlockAt>0,'successful backend login must unlock the app');
assert(!login.slice(0,unlockAt).includes('await pullMaster'),'login must not block on Employee Master hydration');
assert(!login.slice(0,unlockAt).includes('await pullUsers'),'login must not block on admin user-list hydration');
assert(login.indexOf('hydrateAfterLogin(lr.user)')>unlockAt,'shared hydration starts only after UI unlock');
assert(mobile.includes("action:'getEmployeeMaster'"),'Employee Master must hydrate from shared backend');
assert(mobile.includes('7000'),'critical Employee Master pull must be bounded');
assert(!mobile.includes('ATPLCloudAPI.ping()'),'startup must not add an eager duplicate ping');

const master=read('erp-cloud-sync-v1.js');
assert(master.includes('backend-confirmed Employee Master persistence'),'Employee Master sync contract must be backend confirmed');
assert(master.includes('fetchCloud()'),'save path must support cloud read-back');
assert(master.includes('conflictCheck'),'cross-device conflicting edits must be detected');
assert(master.includes('visibilitychange'),'foreground refresh must be event-driven');
assert(!master.includes('setInterval('),'Employee Master must not poll forever');

const dol=read('compliance-dol-rebuild-v2.js');
const v4=read('compliance-dol-cloud-v4.js');
assert(dol.includes("function durableApi(){return root.ATPLDurableEverythingV1||null}"),'DOL dependency resolver must exist');
assert(dol.includes("if(type==='esic')return d&&d.length===10?d:''"),'ESIC IDs must be exactly 10 digits');
assert(dol.includes('sanitizeLocalTypeMixups'),'legacy PF-in-ESIC rows must be sanitized');
assert(dol.includes('parsed.detectedType&&parsed.detectedType!==type'),'wrong-type uploads must be rejected');
assert(dol.includes('v.fileBlob(rec,progress)'),'second-device Open/Download must be able to fetch original bytes');
assert(v4.includes("action:'checkDOLDuplicate'"),'DOL upload must check SHA duplicate in backend');
assert(v4.includes("action:'commitDOLUpload'"),'DOL save must require explicit backend commit');
assert(v4.includes("form.method='POST'"),'large original-file upload must avoid oversized GET URLs');

const account=read('erp-account-cloud-restore-v1.js');
assert(account.includes('root.ATPLAccountCloudRestoreV1='),'account orchestration must keep its own API');
assert(!account.includes('root.ATPLCloudSharedStorageV1={'),'account orchestration must not overwrite shared-file storage API');

const durable=read('erp-durable-everything-v1.js');
assert(durable.includes('dolLooksLikePfInEsic'),'compatibility writes must enforce PF/ESIC separation');
assert(durable.includes('PF challan cannot be saved inside ESIC'),'compatibility DOL guard must remain');
assert(!durable.includes('setInterval('),'durable sync must be event-driven rather than polling');

const html=read('index.html');
const brokerAt=html.indexOf('erp-cloud-api-broker-v1.js');
const v4At=html.indexOf('compliance-dol-cloud-v4.js');
const dolAt=html.indexOf('compliance-dol-rebuild-v2.js');
assert(brokerAt>0&&v4At>brokerAt&&dolAt>v4At,'broker -> DOL V4 client -> DOL UI load order must be deterministic');
assert(!html.includes('Salary Sync')&&!html.includes('Salary Lookup')&&!html.includes('ESIC DOL Filler'),'retired features must stay removed');

console.log('shared-cross-device-final.test.js: all assertions passed');
