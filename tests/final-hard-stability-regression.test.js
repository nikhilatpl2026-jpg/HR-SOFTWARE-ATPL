const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ROOT=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(ROOT,p),'utf8');

test('critical JavaScript files parse',()=>{
  ['erp-cloud-api-broker-v1.js','erp-mobile-shared-hardfix-v1.js','erp-cloud-sync-v1.js','erp-durable-everything-v1.js','compliance-dol-cloud-v4.js','compliance-dol-rebuild-v2.js','compliance-calendar-v1.js'].forEach(p=>{
    assert.doesNotThrow(()=>new Function(read(p)),p+' syntax');
  });
  assert.doesNotThrow(()=>new Function(read('backend/Backend-V4-DOL-Cloud-Master-Patch.gs')),'backend patch syntax');
  assert.doesNotThrow(()=>new Function(read('backend/Backend-V4-Complete-Code.gs')),'complete backend syntax');
});

test('retired features are completely absent while protected salary features remain',()=>{
  const h=read('index.html');
  ['Salary Lookup','Salary Sync','ESIC DOL Filler','id="vn-lookup"','id="vn-sync"','id="vn-esic"','id="page-lookup"','id="page-sync"','id="page-esic"','function runLookup','function runESICDOL','function esicLoadStatement'].forEach(x=>assert.equal(h.includes(x),false,'must remove '+x));
  ['Salary Audit','Machine Rate Audit','Compliance Calculator','id="vn-esictodol"','id="vn-pftodol"'].forEach(x=>assert.equal(h.includes(x),true,'must preserve '+x));
});

test('DOL V4 client loads before DOL module and broker knows dedicated routes',()=>{
  const h=read('index.html'),broker=read('erp-cloud-api-broker-v1.js');
  assert.ok(h.indexOf('compliance-dol-cloud-v4.js')>0);
  assert.ok(h.indexOf('compliance-dol-cloud-v4.js')<h.indexOf('compliance-dol-rebuild-v2.js'));
  ['getDOLRecords','checkDOLDuplicate','getDOLFileInfo','getDOLFileChunk','commitDOLUpload','deleteDOLRecord'].forEach(x=>assert.ok(broker.includes(x),x));
});

test('challan module has explicit dependency resolver and cross-device original-file path',()=>{
  const s=read('compliance-dol-rebuild-v2.js');
  assert.ok(s.includes('function durableApi(){return root.ATPLDurableEverythingV1||null}'));
  assert.ok(s.includes('function vaultApi(){return root.ATPLDOLCloudV4||null}'));
  assert.ok(s.includes('v.fileBlob(rec,progress)'));
  assert.ok(s.includes('vaultApi().upload(rec,buf'));
  assert.ok(s.includes("backend-confirmed ✓"));
  assert.equal(s.includes('Saved locally ✓'),false);
  assert.ok(s.includes("var rec=(state[type].rows||[]).find"),'open/download must use cloud state when IndexedDB is empty');
});

test('challan search is index-only and does not parse PDFs/Excel during search',()=>{
  const s=read('compliance-dol-rebuild-v2.js');
  const start=s.indexOf('function search(type)');
  const end=s.indexOf('async function migrateLegacy',start);
  assert.ok(start>0&&end>start);
  const body=s.slice(start,end);
  assert.equal(/parseBuffer\(|parsePdf\(|parseExcel\(/.test(body),false);
  assert.ok(s.includes('function localSearchPack(type,qs)'));
  assert.ok(s.includes('mergeSearchPacks(type,qs,pack,local)'));
});

test('PF and ESIC have strict type guards and immutable backend category',()=>{
  const s=read('compliance-dol-rebuild-v2.js'),b=read('backend/Backend-V4-DOL-Cloud-Master-Patch.gs');
  assert.ok(s.includes("r&&r.type==='esic'&&pfEvidence"));
  assert.ok(s.includes("parsed.detectedType&&parsed.detectedType!==type"));
  assert.ok(s.includes('cross-module duplicate blocked'));
  assert.ok(b.includes('PF file blocked from ESIC'));
  assert.ok(b.includes('Challan category cannot be changed'));
});

test('backend upload is idempotent, integrity-checked and exact-delete safe',()=>{
  const b=read('backend/Backend-V4-DOL-Cloud-Master-Patch.gs'),c=read('compliance-dol-cloud-v4.js');
  ['appendDOLChunkBatch_','dolExistingPartMap_','Upload retry data mismatch','SHA-256 verification failed','LockService.getScriptLock','findDolByHash_','setTrashed(false)'].forEach(x=>assert.ok(b.includes(x),x));
  assert.ok(c.includes("form.method='POST'"));
  assert.ok(c.includes('POST_PART_CHARS=40000'));
  assert.ok(c.includes("action:'checkDOLDuplicate'"));
  assert.ok(c.includes("action:'commitDOLUpload'"));
  assert.ok(c.includes("action:'deleteDOLRecord'"));
});

test('startup sync is event-driven with bounded critical cloud waits',()=>{
  const mobile=read('erp-mobile-shared-hardfix-v1.js'),cloud=read('erp-cloud-sync-v1.js'),dur=read('erp-durable-everything-v1.js'),h=read('index.html');
  assert.equal(cloud.includes('setInterval('),false);
  assert.equal(dur.includes('setInterval('),false);
  assert.equal(h.includes('setInterval(aroraRemoveHistory'),false);
  assert.ok(mobile.includes("getEmployeeMaster',token:t},7000"));
  assert.ok(mobile.includes("user_id:uid,password_hash:h},9000"));
  assert.ok(cloud.includes("visibilitychange"));
  assert.ok(dur.includes("requestIdleCallback"));
});

test('no per-file cloud refresh loop in challan upload',()=>{
  const s=read('compliance-dol-rebuild-v2.js');
  const a=s.indexOf('async function upload(type,fileList)'),b=s.indexOf('function parseQueries',a),body=s.slice(a,b);
  const n=(body.match(/await refresh\(type\)/g)||[]).length;
  assert.equal(n,1,'upload should perform one final refresh only');
});

test('DOL original file bytes never ride EmployeeMaster metadata payload',()=>{
  const d=read('erp-durable-everything-v1.js');
  const i=d.indexOf('function dolPayload');
  assert.ok(i>0);
  const body=d.slice(i,d.indexOf('\n  }',i)+4);
  assert.equal(/buffer\s*:|blob\s*:|base64/i.test(body),false);
});


test('complete backend exposes every production route',()=>{
  const b=read('backend/Backend-V4-Complete-Code.gs');
  ['login','listUsers','saveUser','deleteUser','getEmployeeMaster','getSystemRecords','upsertEmployeeMaster','deleteEmployeeMaster','appendActivity','listActivity','getDOLRecords','checkDOLDuplicate','beginDOLUpload','commitDOLUpload','updateDOLRecord','deleteDOLRecord','getDOLFileInfo','getDOLFileChunk'].forEach(a=>assert.ok(b.includes("action === '"+a+"'"),'missing backend route '+a));
  assert.ok(b.includes('function doPost(e)'));
  assert.ok(b.includes("action === 'appendDOLChunkBatch'"));
  assert.ok(b.includes("BACKEND_VERSION = '5.1-dol-delete-search-repair'"));
});


test('complete Backend V4 stays aligned with latest DOL resilience contract',()=>{
  const b=read('backend/Backend-V4-Complete-Code.gs');
  assert.ok(b.includes('var DOL_FILE_CHUNK = 500000'),'complete backend must use reduced-round-trip DOL reads');
  assert.ok(b.includes('function cleanupStaleDolParts_()'),'complete backend must clean abandoned upload parts');
  assert.ok(/function beginDOLUpload_\(p\)[\s\S]*?cleanupStaleDolParts_\(\)/.test(b),'DOL upload start must trigger bounded stale-part cleanup');
  assert.ok(b.includes("if(!raw){try{cleanupDolParts_(uploadId)}catch(_){}return {ok:false,error:'Upload session expired'};}"),'expired uploads must purge orphaned chunks');
  assert.ok(b.includes("var DOL_DELETED_SHEET = 'DOLDeleted'"),'deleted hashes need a shared tombstone ledger');
  assert.ok(b.includes("error:'DOL_RECORD_DELETED'"),'stale-device migration must not resurrect a deleted hash');
  assert.ok(b.includes('deleteDolContributionsManyUnlocked_'),'hard delete must remove every matching contribution row');
});


test('DOL search drops orphan contribution rows after a challan is deleted',()=>{
  const s=read('compliance-dol-rebuild-v2.js'),b=read('backend/Backend-V4-Complete-Code.gs');
  assert.ok(s.includes('function filterSearchPackToLiveLibrary(type,qs,pack,rows)'));
  assert.ok(s.includes('filterSearchPackToLiveLibrary(type,qs,pack,freshRows)'));
  assert.ok(s.includes('backend-index filtered by live challan library'));
  assert.ok(b.includes("BACKEND_VERSION = '5.2-dol-orphan-index-cleanup'"));
  assert.ok(b.includes('function dolContributionDeleteName_(v)'));
  assert.ok(b.includes('orphan_contributions_removed'));
  assert.ok(b.includes('matches.concat([q])'));
});

test('Training and Legal compliance calendar supports full-screen retraining and expiry workflow',()=>{
  const c=read('compliance-calendar-v1.js'),h=read('index.html');
  ['ccFull','requestFullscreen','TRAINING','LEGAL DOCUMENTS','Next Retraining / Renewal Date','Expiry Date','Renewal / Follow-up Date','ccStats'].forEach(x=>assert.ok(c.includes(x),x));
  assert.ok(h.includes('compliance-calendar-v1.js?v=20260922-fullscreen2'));
});
