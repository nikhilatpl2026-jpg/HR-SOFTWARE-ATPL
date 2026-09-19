const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function backend(file='Backend-V4-Complete-Code.gs') {
  const c=vm.createContext({console});
  vm.runInContext(fs.readFileSync('backend/'+file,'utf8'),c);
  return c;
}
for (const file of ['Backend-V4-Complete-Code.gs','Backend-V4-DOL-Cloud-Master-Patch.gs']) {
  test(file+': POST returns executable closing script tag',()=>{
    const c=backend(file);
    c.ensureUsersSheet_=c.ensureDataSheets_=()=>{};
    c.HtmlService={XFrameOptionsMode:{ALLOWALL:1},createHtmlOutput:html=>({html,setXFrameOptionsMode(){return this;}})};
    const out=c.doPost({parameter:{request_id:'test'}});
    assert.ok(out.html.endsWith('</script>'),out.html);
  });
  test(file+': duplicate indices in one upload batch write once',()=>{
    const c=backend(file); let written=[];
    c.requireUser_=()=>({id:'test'});c.dolUploadMeta_=()=>({user_id:'test'});
    c.LockService={getScriptLock:()=>({waitLock(){},releaseLock(){}})};
    c.dolExistingPartMap_=()=>({});
    c.ensureDolSheets_=()=>({parts:{getLastRow:()=>1,getRange:()=>({setValues:r=>written=r})}});
    const r=c.appendDOLChunkBatch_({upload_id:'u',parts_json:JSON.stringify([{idx:0,data:'YQ=='},{idx:0,data:'YQ=='}])});
    assert.equal(r.ok,true);assert.equal(written.length,1);
  });
  test(file+': conflicting indices reject entire batch before writing',()=>{
    const c=backend(file);let writes=0;
    c.requireUser_=()=>({id:'test'});c.dolUploadMeta_=()=>({user_id:'test'});
    c.LockService={getScriptLock:()=>({waitLock(){},releaseLock(){}})};
    c.dolExistingPartMap_=()=>({});
    c.ensureDolSheets_=()=>({parts:{getLastRow:()=>1,getRange:()=>({setValues:()=>writes++})}});
    assert.throws(()=>c.appendDOLChunkBatch_({upload_id:'u',parts_json:JSON.stringify([{idx:0,data:'YQ=='},{idx:0,data:'Yg=='}])}),/mismatch/);
    assert.equal(writes,0);
  });
  test(file+': commit retry after lost response returns existing record',()=>{
    const c=backend(file),meta={user_id:'test',type:'pf',file_hash:'hash'};
    c.requireUser_=()=>({id:'test'});
    c.CacheService={getScriptCache:()=>({get:()=>null})};
    c.PropertiesService={getScriptProperties:()=>({getProperty:()=>JSON.stringify(meta)})};
    c.findDolByHash_=()=>({id:'saved',type:'pf',file_hash:'hash'});
    c.cleanupDolParts_=()=>{};
    const r=c.commitDOLUpload_({upload_id:'u'});assert.equal(r.ok,true);assert.equal(r.record.id,'saved');
  });
  test(file+': cleanup failure cannot trash a committed original',()=>{
    const c=backend(file),meta={user_id:'test',type:'pf',file_hash:'hash',name:'pf.pdf'};let trashed=false,stored=false;
    c.requireUser_=()=>({id:'test'});
    c.CacheService={getScriptCache:()=>({get:()=>JSON.stringify(meta),remove(){}})};
    c.PropertiesService={getScriptProperties:()=>({getProperty:()=>JSON.stringify(meta),setProperty(){},deleteProperty(){}})};
    c.LockService={getScriptLock:()=>({waitLock(){},releaseLock(){}})};
    c.Utilities={base64Decode:()=>[1],newBlob:()=>({})};c.dolBytesSha256_=()=> 'hash';
    c.ensureDolSheets_=()=>({parts:{getLastRow:()=>2,getRange:()=>({getValues:()=>[['u',0,'AQ==']]})},records:{appendRow(){stored=true;}}});
    c.findDolByHash_=()=>null;c.findDolById_=()=>({id:'saved',type:'pf',file_hash:'hash'});
    c.dolFolder_=()=>({createFile:()=>({getId:()=> 'file',getUrl:()=> 'url',setTrashed(v){trashed=v;}})});
    c.cleanupDolPartsUnlocked_=()=>{throw new Error('cleanup unavailable');};
    const r=c.commitDOLUpload_({upload_id:'u'});
    assert.equal(stored,true);assert.equal(trashed,false);assert.equal(r.ok,true);
  });
}
test('employee delete locates row after acquiring lock',()=>{
  const c=backend();let locked=false,deleted;
  c.requireUser_=()=>({id:'test'});
  c.LockService={getScriptLock:()=>({waitLock(){locked=true;},releaseLock(){locked=false;}})};
  c.findMaster_=()=>({row:locked?2:3});c.ensureDataSheets_=()=>({master:{deleteRow:r=>deleted=r}});
  c.deleteEmployeeMaster_({emp_id:'A'});assert.equal(deleted,2);
});
test('employee stale version is rejected inside write lock',()=>{
  const c=backend();let writes=0;
  c.requireUser_=()=>({id:'test'});c.findMaster_=()=>({row:2,json:'{}',updated_at:'new'});
  c.LockService={getScriptLock:()=>({waitLock(){},releaseLock(){}})};
  c.ensureDataSheets_=()=>({master:{getRange:()=>({setValues:()=>writes++})}});
  const r=c.upsertEmployeeMaster_({emp_id:'A',record_json:'{"emp_id":"A"}',expected_updated_at:'old'});
  assert.equal(r.ok,false);assert.equal(writes,0);
});
test('activity retry stores one event and detects request-id reuse',()=>{
 const c=backend();let rows=[];
 c.requireUser_=()=>({id:'test',name:'Tester'});c.Utilities={getUuid:()=> 'generated'};
 c.LockService={getScriptLock:()=>({waitLock(){},releaseLock(){}})};
 c.ensureDataSheets_=()=>({activity:{getLastRow:()=>rows.length+1,getRange:(start)=>({getValues:()=>[rows[start-2]],createTextFinder:id=>({matchEntireCell(){return this},useRegularExpression(){return this},findNext(){const i=rows.findIndex(r=>r[0]===id);return i<0?null:{getRow:()=>i+2}}})}),appendRow:r=>rows.push(r)}});
 const p={event_id:'event-1',event_type:'save',page:'employee',action_text:'Saved test',meta_json:'{}'};
 const a=c.appendActivity_(p),b=c.appendActivity_(p);
 assert.equal(a.event_id,b.event_id);assert.equal(rows.length,1);
 assert.equal(c.appendActivity_({...p,action_text:'Different action'}).ok,false);assert.equal(rows.length,1);
});
test('ping needs no spreadsheet reads or writes',()=>{
 const c=backend();c.ensureUsersSheet_=c.ensureDataSheets_=()=>{throw new Error('unexpected sheet I/O')};c.output_=x=>x;
 const result=c.doGet({parameter:{action:'ping'}});assert.equal(result.ok,true);
});
