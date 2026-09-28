const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync(__dirname+'/../index.html','utf8');
const storage=fs.readFileSync(__dirname+'/../erp-cloud-shared-storage-v1.js','utf8');
for(const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
 if(!/src=|type=["'](?:module|application\/)/i.test(match[1]))new vm.Script(match[2]);
}
new vm.Script(storage);
const helper=html.slice(html.indexOf('function atplSalaryRestoreAllowed('),html.indexOf('var isRestoringAborted = false;'));
const direct=html.slice(html.indexOf('function atplUsesSharedSalaryCloud('),html.indexOf('// Background sync loop - ultra lightweight'));
function context(){
 const values=new Map(),writes=[];
 const c={Date,JSON,console,Promise,Uint8Array,setTimeout,FILES:[],isAtplDirectSyncing:false,
 localStorage:{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)},
 DB:{transaction:()=>({objectStore:()=>({put:r=>writes.push(r),delete:()=>{}})})},DB_STORE:'salaryFiles',
 parseWB:()=>({SheetNames:[]}),wbToSheets:()=>({}),atplB64ToBuf:x=>x,atplBufToB64:x=>x,
 renderFiles(){},renderSheets(){},updStats(){},renderAllFilesPage(){},populateNJSelects(){},updateRealtimeCloudBadge(){}};
 c.window=c;vm.createContext(c);vm.runInContext(helper+direct,c);return {c,values,writes};
}
(async()=>{
 const old='2026-09-28T09:00:00Z',cut='2026-09-28T10:00:00Z',fresh='2026-09-28T11:00:00Z';
 let {c,values}=context();assert.equal(c.atplSalaryRestoreAllowed('a',old),true);
 values.set('ATPL_ALL_SALARY_CLEARED_AT',cut);
 for(const ts of [old,cut,undefined,'bad'])assert.equal(c.atplSalaryRestoreAllowed('a',ts),false);
 assert.equal(c.atplSalaryRestoreAllowed('a',fresh),true);
 values.delete('ATPL_ALL_SALARY_CLEARED_AT');values.set('ATPL_SALARY_TOMBSTONES_V2',JSON.stringify({'a.xlsx':cut}));
 assert.equal(c.atplSalaryRestoreAllowed('A.XLSX',old),false);assert.equal(c.atplSalaryRestoreAllowed('A.XLSX',fresh),true);
 // Static repository fallback cannot revive a cleared file, even on a repeat sync.
 let run=context();run.values.set('ATPL_ALL_SALARY_CLEARED_AT',cut);
 run.c.fetch=async url=>url.includes('salary_files.json')?{ok:true,json:async()=>({a:{name:'a.xlsx',buf:'bytes',saved:old}})}:{ok:false};
 await run.c.atplDirectServerSync(true);await run.c.atplDirectServerSync(true);
 assert.equal(run.c.FILES.length,0);assert.equal(run.writes.length,0);assert.equal(run.values.get('ATPL_ALL_SALARY_CLEARED_AT'),cut);
 // A download already awaiting its response must re-check the barrier.
 run=context();let release,started;
 const waiting=new Promise(r=>started=r);
 run.c.fetch=async url=>url.includes('files-meta')?{ok:true,json:async()=>({ok:true,salary_files:[{name:'a.xlsx',saved:old}],salary_tombstones:{}})}:new Promise(r=>{release=r;started();});
 const sync=run.c.atplDirectServerSync(true);await waiting;
 run.values.set('ATPL_ALL_SALARY_CLEARED_AT',cut);
 release({json:async()=>({ok:true,file:{buf:'bytes',saved:old}})});await sync;
 assert.equal(run.c.FILES.length,0);assert.equal(run.writes.length,0);
 // A deliberate later upload is still restorable; markers remain intact.
 run=context();run.values.set('ATPL_ALL_SALARY_CLEARED_AT',cut);
 run.c.fetch=async()=>({ok:true,json:async()=>({ok:true,salary_files:[{name:'a.xlsx',saved:fresh,buf:'bytes'}],salary_tombstones:{}})});
 await run.c.atplDirectServerSync(true);assert.equal(run.c.FILES.length,1);assert.equal(run.writes.length,1);
 console.log('PASS: script syntax, deletion timestamp cases, static resurrection, repeated sync, in-flight Clear All, later re-upload');
})().catch(e=>{console.error(e);process.exitCode=1});
