const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync('atpl-central-file-sync.js','utf8');
function session(fetch){
 const values=new Map();
 const c={console,fetch,AbortController,ArrayBuffer,Uint8Array,Blob,File:class{},TextEncoder,crypto:require('node:crypto').webcrypto,
 atob,btoa,setTimeout,clearTimeout,setInterval(){},CustomEvent:class{},
 location:{origin:'https://example.github.io'},document:{readyState:'loading',addEventListener(){}},
 localStorage:{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v)},
 addEventListener(){},dispatchEvent(){},FILES:[],parseWB:buf=>({value:Buffer.from(buf).toString(),SheetNames:['Sheet1']}),wbToSheets:()=>({Sheet1:[]})};
 c.window=c;vm.createContext(c);vm.runInContext(source,c);return {c,sync:c.ATPLCentralFileSync,values};
}
const json=data=>({ok:true,status:200,headers:{get:()=> 'application/json'},json:async()=>data});
const file=(name='a.xlsx',savedAt='2026-10-05T10:00:00Z')=>({name,savedAt,buf:new ArrayBuffer(1),wb:{}});
test('HTML backend does not confirm upload or prune local files',async()=>{
 const {sync,c}=session(async()=>({ok:true,redirected:true,headers:{get:()=> 'text/html'}}));
 sync.fileMap.set('a.xlsx',file());sync.syncToWindowFiles();
 await assert.rejects(sync.uploadFile('salary',{name:'b.xlsx',buf:btoa('data')}),/login\/HTML/);
 assert.equal(await sync.reconcileAll(),false);assert.equal(c.FILES.length,1);
});
test('failed delete retains local file and tombstones',async()=>{
 const {sync,c,values}=session(async()=>{throw new Error('offline')});sync.fileMap.set('a.xlsx',file());sync.syncToWindowFiles();
 await assert.rejects(sync.deleteFile('salary','a.xlsx'),/offline/);assert.equal(c.FILES.length,1);assert.equal(values.size,0);
 await assert.rejects(sync.clearModule(),/offline/);assert.equal(c.FILES.length,1);
});
test('empty server list is not evidence of deletion',async()=>{
 const {sync,c}=session(async()=>json({ok:true,files:[],tombstones:{}}));sync.fileMap.set('a.xlsx',file());sync.syncToWindowFiles();
 assert.equal(await sync.reconcileAll(),true);assert.equal(c.FILES.length,1);
});
test('name-only delete event does not match empty IDs on unrelated files',()=>{
 const {sync,c}=session();sync.fileMap.set('a.xlsx',file());sync.fileMap.set('b.xlsx',file('b.xlsx'));sync.syncToWindowFiles();
 sync.handleRemoteFileDeleted({name:'a.xlsx'});assert.equal(c.FILES.length,1);assert.equal(c.FILES[0].name,'b.xlsx');
 sync.handleRemoteFileDeleted({name:'b.xlsx',module:'esic'});assert.equal(c.FILES.length,1);
});
test('two independent sessions converge on upload, replacement, deletion and re-upload',async()=>{
 let rows=[],tombstones={},revision=0;
 const server=async(url,opts={})=>{
  if(opts.method==='POST'){
   const f=JSON.parse(opts.body); f.id='server-id';f.created_at=new Date(Date.UTC(2026,9,5,11,++revision)).toISOString();
   rows=[f];tombstones={};return json({ok:true,file:f});
  }
  if(opts.method==='DELETE'){rows=[];tombstones={'a.xlsx':{module:'salary',deleted_at:'2026-10-05T11:02:30Z'}};return json({ok:true,deleted:true});}
  return json({ok:true,files:rows,tombstones});
 };
 const a=session(server),b=session(server);
 await a.sync.uploadFile('salary',{name:'a.xlsx',buf:btoa('first')});await b.sync.reconcileAll();assert.equal(b.c.FILES[0].wb.value,'first');
 await a.sync.uploadFile('salary',{name:'a.xlsx',buf:btoa('replacement')});await b.sync.reconcileAll();assert.equal(b.c.FILES[0].wb.value,'replacement');
 await a.sync.deleteFile('salary','a.xlsx');await b.sync.reconcileAll();assert.equal(b.c.FILES.length,0);
 await a.sync.uploadFile('salary',{name:'a.xlsx',buf:btoa('new upload')});await b.sync.reconcileAll();assert.equal(b.c.FILES[0].wb.value,'new upload');
});
test('bulk failure count reflects actual server results',async()=>{
 const {sync}=session(async()=>{throw new Error('offline')});
 const result=await sync.uploadBulk('salary',[{name:'a.xlsx',buf:btoa('x')}]);assert.equal(result.failed,1);assert.equal(result.saved,0);
});
test('inline scripts parse after async UI changes',()=>{
 const html=fs.readFileSync('index.html','utf8');
 for(const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) if(!/src=|type=["'](?:module|application\/)/i.test(match[1])) new vm.Script(match[2]);
});
