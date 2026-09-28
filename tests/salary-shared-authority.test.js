const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync(__dirname+'/../index.html','utf8');
const helper=html.slice(html.indexOf('function atplSalaryRestoreAllowed('),html.indexOf('var isRestoringAborted = false;'));
const code=fs.readFileSync(__dirname+'/../erp-cloud-shared-storage-v1.js','utf8');
function device(server){
 const local=new Map(),rows=new Map(),labels={};
 local.set('ATPL_RemoteToken_V1','test-session');local.set('ATPL_UserSession_V5',JSON.stringify({id:'test-owner'}));
 const storage={getItem:k=>local.get(k)||null,setItem:(k,v)=>local.set(k,v),removeItem:k=>local.delete(k)};
 const indexedDB={open(){const req={};queueMicrotask(()=>{req.result={close(){},transaction(){const tx={};tx.objectStore=()=>({
 getAll(){const r={};queueMicrotask(()=>{r.result=[...rows.values()].map(v=>({...v}));r.onsuccess?.()});return r},
 put(r){rows.set(r.name,{...r});queueMicrotask(()=>tx.oncomplete?.())},
 delete(name){rows.delete(name);queueMicrotask(()=>tx.oncomplete?.())},
 clear(){rows.clear();queueMicrotask(()=>tx.oncomplete?.())}
 });return tx}};req.onsuccess?.()});return req}};
 const root={location:{hostname:'example.github.io'},FILES:[],localStorage:storage,sessionStorage:storage,indexedDB,
 document:{readyState:'loading',addEventListener(){},getElementById(id){return labels[id]||(labels[id]={textContent:''})}},
 addEventListener(){},parseWB:buf=>({bytes:[...new Uint8Array(buf)]}),wbToSheets:wb=>({Sheet:wb.bytes}),
 ATPLFirebase:{fetchAllSalaryFiles:async()=>{throw Error('Disabled Firebase must not intercept salary sync')}},
 __atplFirebaseQuotaExhausted:true,updateRealtimeCloudBadge:(count,status,message)=>{root.badge={count,status,message}},
 ATPLCloudAPI:{request:async p=>{
   if(server.fail)throw Error('offline');
   assert.equal(p.token,'test-session');
   if(p.action==='getSystemRecords')return {ok:true,records:[...server.records.values()].map(x=>({...x}))};
   if(p.action==='upsertEmployeeMaster'){
     const r=JSON.parse(p.record_json);if(server.pause&&r._atpl_kind==='chunk')await server.pause();
     server.records.set(p.emp_id,r);return {ok:true};
   }
   throw Error('Unexpected endpoint '+p.action);
 }} };
 const ctx=vm.createContext({window:root,localStorage:storage,indexedDB,console,Date,JSON,Promise,Math,TextEncoder,TextDecoder,Uint8Array,ArrayBuffer,
 btoa:s=>Buffer.from(s,'binary').toString('base64'),atob:s=>Buffer.from(s,'base64').toString('binary'),setTimeout,clearTimeout,setInterval(){}});
 vm.runInContext(helper+'\nwindow.atplSalaryRestoreAllowed=atplSalaryRestoreAllowed;\n'+code,ctx);
 return {root,rows,local,labels,api:root.ATPLCloudSharedStorageV1};
}
const stamp=()=>new Date().toISOString();
function seed(d,name,bytes,at=stamp()){d.rows.set(name,{name,buf:Uint8Array.from(bytes).buffer,saved:at});return at}
test('two isolated browsers converge on upload, replacement, delete, refresh and re-upload',async()=>{
 const server={records:new Map()},a=device(server),b=device(server);
 let at=seed(a,'pay.xlsx',[1,2,3]);assert.equal(await a.api.saveSalary('pay.xlsx',null,at),true);
 assert.equal(await b.api.syncNow(true),true);assert.deepEqual([...new Uint8Array(b.rows.get('pay.xlsx').buf)],[1,2,3]);
 at=new Date(Date.now()+1000).toISOString();seed(a,'pay.xlsx',[4,5,6],at);await a.api.saveSalary('pay.xlsx',null,at);await b.api.syncNow(true);
 assert.deepEqual([...b.root.FILES[0].wb.bytes],[4,5,6]);
 // Use an old timestamp so the explicit later delete wins.
 for(const r of server.records.values())if(r._atpl_kind==='meta')r.saved_at='2026-01-01T00:00:00Z';
 a.rows.get('pay.xlsx').saved='2026-01-01T00:00:00Z';b.rows.get('pay.xlsx').saved='2026-01-01T00:00:00Z';
 assert.equal(await a.api.deleteSalary('pay.xlsx'),true);assert.equal(await b.api.syncNow(true),true);assert.equal(b.rows.size,0);
 const c=device(server);assert.equal(await c.api.syncNow(true),true);assert.equal(c.rows.size,0);
 at=new Date(Date.now()+2000).toISOString();seed(a,'pay.xlsx',[9],at);await a.api.saveSalary('pay.xlsx',null,at);await b.api.syncNow(true);
 assert.deepEqual([...new Uint8Array(b.rows.get('pay.xlsx').buf)],[9]);
});
test('failed deletes persist in outbox and retry; offline device does not resurrect deleted upload',async()=>{
 const server={records:new Map()},a=device(server),b=device(server);
 let at=seed(a,'old.xlsx',[1],'2026-01-01T00:00:00Z');await a.api.saveSalary('old.xlsx',null,at);await b.api.syncNow(true);
 server.fail=true;assert.equal(await a.api.deleteSalary('old.xlsx'),false);assert.equal(a.api.status().salaryPending,1);assert.equal(a.root.badge.status,'error');
 server.fail=false;assert.equal(await a.api.syncNow(true),true);assert.equal(a.api.status().salaryPending,0);
 await b.api.syncNow(true);assert.equal(b.rows.size,0);assert.equal(b.api.status().salaryPending,0);
});
test('shared clear-all reaches existing and newly opened browsers without deleting later uploads',async()=>{
 const server={records:new Map()},a=device(server),b=device(server);
 let at=seed(a,'one.xlsx',[1],'2026-01-01T00:00:00Z');await a.api.saveSalary('one.xlsx',null,at);await b.api.syncNow(true);
 assert.equal(await a.api.clearSalary(),true);await b.api.syncNow(true);assert.equal(b.rows.size,0);
 const c=device(server);await c.api.syncNow(true);assert.equal(c.rows.size,0);
 at=new Date(Date.now()+2000).toISOString();seed(a,'new.xlsx',[2],at);await a.api.saveSalary('new.xlsx',null,at);await c.api.syncNow(true);
 assert.equal(c.rows.size,1);assert.equal(c.rows.has('new.xlsx'),true);
});
test('failed upload is not published and original bytes survive retry',async()=>{
 const server={records:new Map(),fail:true},a=device(server),b=device(server);
 const at=seed(a,'file.xlsx',[0,255,128,50]);assert.equal(await a.api.saveSalary('file.xlsx',null,at),false);assert.equal(a.api.status().salaryPending,1);
 server.fail=false;await a.api.syncNow(true);await b.api.syncNow(true);assert.deepEqual([...new Uint8Array(b.rows.get('file.xlsx').buf)],[0,255,128,50]);
});
test('delete on browser B wins while browser A still uploads chunks',async()=>{
 const server={records:new Map()},a=device(server),b=device(server);
 let unblock,entered;const started=new Promise(r=>entered=r);
 server.pause=()=>new Promise(r=>{unblock=r;entered()});
 const at=seed(a,'slow.xlsx',[1,2,3],'2026-01-01T00:00:00Z');
 const pending=a.api.saveSalary('slow.xlsx',null,at);await started;
 await b.api.deleteSalary('slow.xlsx');server.pause=null;unblock();await pending;
 await a.api.syncNow(true);await b.api.syncNow(true);
 assert.equal(a.rows.size,0);assert.equal(b.rows.size,0);
 assert.equal([...server.records.values()].some(r=>r._atpl_kind==='meta'),false);
});
test('no success when authentication is missing; local bytes and pending work survive',async()=>{
 const server={records:new Map()},a=device(server);const at=seed(a,'local.xlsx',[7]);
 a.local.delete('ATPL_RemoteToken_V1');assert.equal(await a.api.saveSalary('local.xlsx',null,at),false);
 assert.equal(a.rows.size,1);assert.equal(a.api.status().salaryPending,1);assert.equal(server.records.size,0);
 a.local.set('ATPL_RemoteToken_V1','test-session');assert.equal(await a.api.syncNow(true),true);
});
