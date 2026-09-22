const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');

test('contribution parser returns latest real month despite gaps',()=>{
  const code=read('compliance-dol-index-v1.js');
  const ctx={module:{exports:{}},exports:{}};vm.runInNewContext(code,ctx);
  const api=ctx.module.exports;
  assert.equal(api.latest([{period:'2026-02'},{period:'2026-04'},{period:'2026-06'}]).period,'2026-06');
  const esic=api.fromRows([['IP Number','Employee Name','Total Contribution'],['1234567890','Asha','500']],'esic');
  assert.deepEqual(Array.from(esic.ids),['1234567890']);
  assert.equal(esic.contributions[0].employeeName,'Asha');
  assert.equal(esic.contributions[0].details.totalContribution,'500');
  const merged=api.mergeMatches(
    [{recordId:'jan',period:'2026-01',sourceChallan:'Jan.pdf',details:{totalContribution:'500'}}],
    [{recordId:'jan',period:'2026-01',sourceChallan:'Jan.pdf',details:{}},{recordId:'may',period:'2026-05',sourceChallan:'May.pdf',details:{}}]
  );
  assert.deepEqual(Array.from(merged,x=>x.period),['2026-01','2026-05']);
  assert.equal(api.latest(merged).period,'2026-05','loaded challan ID index must repair a partial backend contribution index');
});

test('backend DOL search supplements partial detailed rows per challan',()=>{
  const code=read('backend/Backend-V4-Complete-Code.gs'),ctx={console};vm.runInNewContext(code,ctx);
  const id='100330064649';
  ctx.requireFeature_=()=>({});ctx.dolFeature_=x=>x;
  ctx.dolContributionRows_=()=>[{record_id:'jan',type:'pf',member_id:id,employee_name:'Worker',details_json:'{}',period:'2026-01',source_name:'Jan.pdf'}];
  ctx.dolRows_=()=>[
    {id:'jan',type:'pf',name:'Jan.pdf',file_hash:'a',period:'2026-01',period_source:'filename',digit_ids:[id],alnum_ids:[],size:1,mime:'application/pdf',drive_file_id:'1',uploaded_by:'u',uploaded_at:'',updated_at:'',index_count:1,index_status:'ready'},
    {id:'may',type:'pf',name:'May.pdf',file_hash:'b',period:'2026-05',period_source:'filename',digit_ids:[id],alnum_ids:[],size:1,mime:'application/pdf',drive_file_id:'2',uploaded_by:'u',uploaded_at:'',updated_at:'',index_count:0,index_status:'pending'}
  ];
  ctx.publicDol_=r=>({id:r.id,type:r.type,name:r.name,period:r.period,digitIds:r.digit_ids,alnumIds:r.alnum_ids,indexStatus:r.index_status});
  const out=ctx.searchDOLIndex_({token:'t',type:'pf',ids_json:JSON.stringify([id])});
  assert.deepEqual(Array.from(out.matches[id],x=>x.period),['2026-01','2026-05']);
});

test('backend DOL hard-delete removes only the matching hash and records a tombstone',()=>{
  const code=read('backend/Backend-V4-Complete-Code.gs'),ctx={console};vm.runInNewContext(code,ctx);
  const removedRows=[],removedContributions=[],tombstones=[],trashed=[];
  ctx.requireUser_=()=>({id:'admin',admin:true});
  ctx.LockService={getScriptLock:()=>({waitLock(){},releaseLock(){}})};
  ctx.hasFeature_=()=>true;ctx.dolFeature_=x=>x;
  ctx.dolRows_=()=>[
    {id:'legacy-a',row:2,type:'pf',name:'PF May.pdf',file_hash:'samehash',period:'2026-05',drive_file_id:'drive-a'},
    {id:'cloud-a',row:3,type:'pf',name:'PF May (1).pdf',file_hash:'samehash',period:'2026-05',drive_file_id:'drive-b'},
    {id:'other-month',row:4,type:'pf',name:'PF May.pdf',file_hash:'otherhash',period:'2026-04',drive_file_id:'drive-c'}
  ];
  ctx.upsertDolDeletedUnlocked_=(...args)=>tombstones.push(args);
  ctx.DriveApp={getFileById:id=>({setTrashed:v=>trashed.push([id,v])})};
  ctx.deleteDolContributionsManyUnlocked_=ids=>removedContributions.push(...ids);
  ctx.ensureDolSheets_=()=>({records:{deleteRow:r=>removedRows.push(r)}});
  const out=ctx.deleteDOLRecord_({token:'t',id:'legacy-a',type:'pf',file_hash:'samehash',name:'PF May.pdf',period:'2026-05'});
  assert.equal(out.ok,true);assert.equal(out.deleted_count,2);
  assert.deepEqual(removedRows,[3,2]);
  assert.deepEqual(removedContributions.sort(),['cloud-a','legacy-a']);
  assert.deepEqual(trashed.map(x=>x[0]).sort(),['drive-a','drive-b']);
  assert.equal(tombstones.length,1);
});

test('production V5 enforces permissions and strict PF/ESIC backend boundaries',()=>{
  const b=read('backend/Backend-V4-Complete-Code.gs');
  assert.match(b,/requireFeature_\(p\.token,dolFeature_\(type\)\)/);
  assert.match(b,/hasFeature_\(u,dolFeature_\(meta\.type\)\)/);
  assert.match(b,/systemKindAllowed_/);
  assert.match(b,/DOL_CONTRIBUTIONS_SHEET/);
  assert.match(b,/dolFolder_\(meta\.type,meta\.period\)/);
  assert.match(b,/deleteDolContributionsManyUnlocked_\(matches\.map/);
  ['beginDOLIndex','finalizeDOLIndex','searchDOLIndex','listComplianceCalendar','upsertDOLContributionBatch','upsertComplianceCalendar','deleteComplianceCalendar','claimComplianceNotification'].forEach(a=>assert.ok(b.includes("action === '"+a+"'"),a));
});

test('calendar and challan production UI contracts are mounted',()=>{
  const h=read('index.html'),c=read('compliance-calendar-v1.js'),d=read('compliance-dol-rebuild-v2.js');
  assert.ok(h.includes('compliance-calendar-v1.js?v=20260922-fullscreen3'));
  ['vn-compliancecalendar','page-compliancecalendar','TRAINING','LEGAL DOCUMENTS','listComplianceCalendar','upsertComplianceCalendar','deleteComplianceCalendar','ccFull','requestFullscreen','Next Retraining / Renewal Date','Expiry Date','ccStats'].forEach(x=>assert.ok(c.includes(x),x));
  ['monthfilter','downloadSelected','data-cd2-select','JSZip','Missing'].forEach(x=>assert.ok(d.includes(x),x));
});

test('shared sync is backend-authoritative without recurring poll',()=>{
  const restore=read('erp-account-cloud-restore-v1.js'),durable=read('erp-durable-everything-v1.js'),guard=read('erp-permission-guard-v1.js');
  assert.equal(restore.includes('setInterval('),false);
  assert.ok(durable.includes("action:'getSystemRecords'"));
  assert.ok(guard.includes('MutationObserver'));
  assert.ok(guard.includes('atpl-authenticated'));
});

test('live index cache-busts Sep-21 shared authority scripts',()=>{
  const h=read('index.html');
  [
    'erp-mobile-shared-hardfix-v1.js?v=20260921-permission-sync2',
    'erp-durable-everything-v1.js?v=20260921-system-records-authority14-dol-delete',
    'erp-account-cloud-restore-v1.js?v=20260921-permission-orchestrator3'
  ].forEach(x=>assert.ok(h.includes(x),x));
  ['erp-mobile-shared-hardfix-v1.js?v=20260919-final-stability','erp-durable-everything-v1.js?v=20260919-final-stability','erp-account-cloud-restore-v1.js?v=20260919-stability1'].forEach(x=>assert.equal(h.includes(x),false,x));
});

test('PF or ESIC challan-only access cannot directly read Employee Master',()=>{
  const b=read('backend/Backend-V4-Complete-Code.gs');
  const start=b.indexOf('function getEmployeeMaster_(p)');
  const end=b.indexOf('function getSystemRecords_(p)',start);
  assert.ok(start>0&&end>start);
  const body=b.slice(start,end);
  assert.ok(body.includes("requireAnyFeature_(p.token,['empmaster','cmd','files','audit','machineaudit','bankverify','dolverify','ff','hrdocs','mamsalary'])"));
  assert.equal(body.includes("'esictodol'"),false);
  assert.equal(body.includes("'pftodol'"),false);
});

test('DOL legacy bridge remains active in V10 and treats already-missing delete as success',()=>{
  const h=read('index.html'),d=read('compliance-dol-rebuild-v2.js');
  assert.ok(h.includes('compliance-dol-rebuild-v2.js?v=20260922-production10'));
  assert.equal(h.includes('compliance-dol-rebuild-v2.js?v=20260921-production5'),false);
  [
    "production-v10-live-library-authority",
    "prepareLegacyMigration",
    "scheduleLegacyV5Migration",
    "isMissingCloudRecordError",
    "Removed stale legacy/cache challan",
    "purgeLegacyLocalMatches",
    "if(isAnyDeleteTombstoned(targetType,nr))continue"
  ].forEach(x=>assert.ok(d.includes(x),x));
  assert.ok(d.includes("await migrateLegacy()"));
  assert.ok(d.includes("await migrateDbFilesToVault()"));
});

test('DOL delete is shared across devices and search repairs from fresh cloud library',()=>{
  const h=read('index.html'),d=read('compliance-dol-rebuild-v2.js'),c=read('compliance-dol-cloud-v4.js'),dur=read('erp-durable-everything-v1.js');
  assert.ok(h.includes('erp-durable-everything-v1.js?v=20260921-system-records-authority14-dol-delete'));
  assert.ok(h.includes('compliance-dol-index-v1.js?v=20260921-index2'));
  assert.ok(h.includes('compliance-dol-cloud-v4.js?v=20260921-production8'));
  assert.ok(h.includes('compliance-dol-rebuild-v2.js?v=20260922-production10'));
  [
    'production-v10-live-library-authority',
    'ATPL_DOL_DELETE_TOMBSTONES_V2',
    'loadSharedDeleteTombstones',
    'saveSharedDeleteTombstone',
    'clearSharedDeleteTombstone',
    'isSharedDeleteTombstoned',
    'isAnyDeleteTombstoned',
    'sameDeleteIdentity',
    'purgeLegacyLocalMatches',
    'librarySearchPack',
    'await v.list(type)',
    'locking delete across all devices',
    'shared delete lock'
  ].forEach(x=>assert.ok(d.includes(x),x));
  [
    'system-records-authority14-dol-delete',
    "DOL_KIND_ESIC_DELETE='esic_dol_deleted_v1'",
    "DOL_KIND_PF_DELETE='pf_dol_deleted_v1'",
    'saveComplianceDolDeleteTombstone',
    'getComplianceDolDeleteTombstones',
    'clearComplianceDolDeleteTombstone'
  ].forEach(x=>assert.ok(dur.includes(x),x));
  assert.ok(c.includes('production-v8-final-delete-dol'));
  assert.ok(c.includes('sameDeleteTarget'));
  assert.ok(c.includes("getDOLRecords',type:type},{timeout:8000,cacheMs:0"));
  assert.ok(c.includes("timeout:22000,attempts:1"));
  const searchStart=d.indexOf('async function searchAsync(type,qs,box)');
  const searchEnd=d.indexOf('function search(type)',searchStart);
  const searchBody=d.slice(searchStart,searchEnd);
  assert.ok(searchBody.includes('await v.list(type)'));
  assert.ok(searchBody.includes('filterSearchPackToLiveLibrary(type,qs,pack,freshRows)'));
  assert.ok(d.includes('backend-index filtered by live challan library'));
  assert.equal(/parseBuffer\(|parsePdf\(|parseExcel\(/.test(searchBody),false);
});
