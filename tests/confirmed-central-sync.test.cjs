const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync('atpl-central-file-sync.js', 'utf8');
function browser(fetch) {
  const storage = new Map();
  const w = {location:{origin:'https://example.github.io'}, FILES:[],
    parseWB: b => ({value:new Uint8Array(b)[0]}), wbToSheets: wb => [wb]};
  const ctx = {window:w,document:{readyState:'loading',addEventListener(){}},
    localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},
    fetch,AbortController,ArrayBuffer,Uint8Array,Blob,File,TextEncoder,Map,Set,Date,Promise,
    crypto:require('node:crypto').webcrypto,atob,btoa,console,
    setTimeout:()=>1,clearTimeout(){},setInterval:()=>1};
  vm.runInNewContext(source,ctx);
  return {w, engine:w.ATPLCentralFileSync, storage};
}
function response(data) {return {ok:true,status:200,redirected:false,headers:{get:()=> 'application/json'},json:async()=>data};}
function file(name='one.xlsx') {return {id:name,name,buf:new Uint8Array([1]).buffer,wb:{value:1},savedAt:'2026-10-01',syncStatus:'saved',sha256_hash:'old'};}
function seed(b,f=file()) {b.engine.fileMap.set(f.name.toLowerCase(),f);b.w.FILES=[f];return f;}
test('auth HTML cannot erase local data or report a successful sync',async()=>{
 const b=browser(async()=>({ok:true,redirected:true,headers:{get:()=> 'text/html'}}));seed(b);
 b.w.ATPLFirebase={fetchAllSalaryFiles:async()=>[]};
 assert.equal(await b.engine.reconcileAll(),false);assert.equal(b.engine.fileMap.size,1);
 assert.match(b.engine.lastError,/production API/);assert.equal(b.engine.lastSyncTime,0);
});
test('failed delete and clear preserve local copies and tombstones',async()=>{
 const b=browser(async()=>{throw Error('offline')});seed(b);
 await assert.rejects(b.engine.deleteFile('salary','one.xlsx'),/offline/);
 await assert.rejects(b.engine.clearModule('salary'),/offline/);
 assert.equal(b.engine.fileMap.size,1);assert.equal(b.storage.size,0);
});
test('bulk failed upload is counted as failed and retains pending bytes',async()=>{
 const b=browser(async()=>response({ok:false,error:'not saved'}));
 // A failed request retry delay runs immediately in this harness.
 // Only this upload requires timers; use a successful HTTP error on all three attempts.
 const storage=new Map();
 const ctx={window:b.w,document:{readyState:'loading',addEventListener(){}},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},fetch:async()=>response({ok:false,error:'not saved'}),AbortController,ArrayBuffer,Uint8Array,Blob,File,TextEncoder,Map,Set,Date,Promise,crypto:require('node:crypto').webcrypto,atob,btoa,console,setTimeout:(fn,ms)=>{if(ms===2000)queueMicrotask(fn);return 1;},clearTimeout(){}};
 vm.runInNewContext(source,ctx);
 const engine=b.w.ATPLCentralFileSync;
 const r=await engine.uploadBulk('salary',[{name:'one.xlsx',buffer:new Uint8Array([7]).buffer}]);
 assert.equal(r.saved,0);assert.equal(r.failed,1);assert.equal(engine.fileMap.get('one.xlsx').syncStatus,'pending');
});
test('same-count replacement downloads changed bytes',async()=>{
 const b=browser(async()=>response({ok:true,files:[{id:'one.xlsx',name:'one.xlsx',module:'salary',sha256_hash:'new',buf:btoa(String.fromCharCode(9)),created_at:'2026-10-05'}]}));seed(b);
 assert.equal(await b.engine.reconcileAll(),true);assert.equal(b.engine.fileMap.get('one.xlsx').wb.value,9);
});
test('confirmed remote deletion removes saved file but preserves pending upload',async()=>{
 const b=browser(async()=>response({ok:true,files:[],tombstones:{}}));seed(b);
 b.engine.fileMap.set('pending.xlsx',{...file('pending.xlsx'),syncStatus:'pending'});
 assert.equal(await b.engine.reconcileAll(),true);assert.equal(b.engine.fileMap.has('one.xlsx'),false);assert.equal(b.engine.fileMap.has('pending.xlsx'),true);
});
test('two isolated browsers converge after upload, replacement and deletion',async()=>{
 let rows=[];
 const backend=async(url,opt={})=>{
  if(opt.method==='POST'){const p=JSON.parse(opt.body);rows=[p];return response({ok:true,file:p});}
  if(opt.method==='DELETE'){rows=[];return response({ok:true});}
  return response({ok:true,files:rows,tombstones:{}});
 };
 const a=browser(backend),b=browser(backend);
 await a.engine.uploadFile('salary',{name:'one.xlsx',buffer:new Uint8Array([3]).buffer});
 assert.equal(await b.engine.reconcileAll(),true);assert.equal(b.engine.fileMap.get('one.xlsx').wb.value,3);
 await a.engine.uploadFile('salary',{name:'one.xlsx',buffer:new Uint8Array([4]).buffer});
 assert.equal(await b.engine.reconcileAll(),true);assert.equal(b.engine.fileMap.get('one.xlsx').wb.value,4);
 await a.engine.deleteFile('salary','one.xlsx');
 assert.equal(await b.engine.reconcileAll(),true);assert.equal(b.engine.fileMap.size,0);
});
