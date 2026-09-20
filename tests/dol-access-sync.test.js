const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const read=p=>fs.readFileSync(require('node:path').join(__dirname,'..',p),'utf8');
function backend(){const c={};vm.createContext(c);vm.runInContext(read('backend/Backend-V4-Complete-Code.gs'),c);c.requireUser_=()=>({id:'worker',admin:false,access:['pftodol']});return c}
test('DOL list and original-file reads enforce feature access',()=>{
 const c=backend();c.dolRows_=()=>[{id:'pf',type:'pf'},{id:'esic',type:'esic'}];
 assert.equal(c.getDOLRecords_({token:'t',type:'pf'}).records.length,1);
 assert.throws(()=>c.getDOLRecords_({token:'t',type:'esic'}),/access denied/);
 c.findDolById_=()=>({type:'esic',drive_file_id:'private'});
 assert.throws(()=>c.getDOLFileInfo_({token:'t',id:'esic'}),/access denied/);
 assert.throws(()=>c.getDOLFileChunk_({token:'t',id:'esic'}),/access denied/);
});
test('delete removes one row, retries safely, and releases lock when forbidden',()=>{
 const c=backend();let released=0,deleted=[],trashed=[];
 c.LockService={getScriptLock:()=>({waitLock(){},releaseLock(){released++}})};
 c.findDolById_=id=>id==='missing'?null:{id,type:id==='esic'?'esic':'pf',row:4,drive_file_id:'file'};
 c.DriveApp={getFileById:()=>({setTrashed:v=>trashed.push(v)})};
 c.ensureDolSheets_=()=>({records:{deleteRow:r=>deleted.push(r)}});
 assert.equal(c.deleteDOLRecord_({token:'t',id:'pf'}).deleted,'pf');
 assert.equal(c.deleteDOLRecord_({token:'t',id:'missing'}).already_missing,true);
 assert.throws(()=>c.deleteDOLRecord_({token:'t',id:'esic'}),/access denied/);
 assert.deepEqual(deleted,[4]);assert.deepEqual(trashed,[true]);assert.equal(released,3);
});
test('failed sheet delete restores original file',()=>{
 const c=backend(),trashed=[];c.LockService={getScriptLock:()=>({waitLock(){},releaseLock(){}})};
 c.findDolById_=()=>({id:'pf',type:'pf',row:4,drive_file_id:'file'});
 c.DriveApp={getFileById:()=>({setTrashed:v=>trashed.push(v)})};
 c.ensureDolSheets_=()=>({records:{deleteRow(){throw Error('sheet unavailable')}}});
 assert.throws(()=>c.deleteDOLRecord_({token:'t',id:'pf'}),/sheet unavailable/);
 assert.deepEqual(trashed,[true,false]);
});
test('a pre-delete read cannot repopulate cache or satisfy post-delete verification',async()=>{
 const requests=[];const root={navigator:{onLine:true},setTimeout,clearTimeout};
 root.document={createElement:()=>({}),head:{appendChild(s){requests.push(s)}},dispatchEvent(){}};
 const c={window:root,CustomEvent:function(){}};vm.createContext(c);vm.runInContext(read('erp-cloud-api-broker-v1.js'),c);
 const api=root.ATPLCloudAPI,params={action:'getDOLRecords',type:'pf',token:'t'};
 const old=api.request(params);api.clearCache();
 const newer=api.request(params);
 const respond=(i,records)=>{const cb=new URL(requests[i].src).searchParams.get('callback');root[cb]({ok:true,records})};
 respond(0,['deleted']);await old;
 await new Promise(r=>setTimeout(r,180));assert.equal(requests.length,2);
 respond(1,[]);await newer;
 assert.deepEqual((await api.request(params)).records,[]);
});
function ui(){const c={window:{},document:{readyState:'loading',addEventListener(){}},console,setTimeout,clearTimeout};vm.createContext(c);let s=read('compliance-dol-rebuild-v2.js');s=s.replace('})(window);','root.test={cloudRecords:cloudRecords,localPreview:localPreview};})(window);');vm.runInContext(s,c);return c.window;}
test('network failure does not start a second compatibility request',async()=>{
 const w=ui();let legacy=0;w.ATPLDOLCloudV4={list:async()=>{throw Error('CLOUD_UNREACHABLE')},supportState:()=>null};w.ATPLDurableEverythingV1={getComplianceDolRecords:async()=>{legacy++;return[]}};
 await assert.rejects(w.test.cloudRecords('pf'),/CLOUD_UNREACHABLE/);assert.equal(legacy,0);
 w.ATPLDOLCloudV4.list=async()=>{throw Error('DOL_V4_UNAVAILABLE')};await w.test.cloudRecords('pf');assert.equal(legacy,1);
});
test('unverified device cache is never shown before backend authorization',async()=>{assert.equal(await ui().test.localPreview('pf'),false)});
