const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function harness(){
 let resolveDelete;
 const A={emp_id:'A',name:'Employee A'},B={emp_id:'B',name:'Employee B'};
 const root={EM:{data:[A,B],selectedRows:new Set()},emDeleteRow(){},document:{readyState:'complete',getElementById:()=>null,querySelector:()=>null},ATPLCloudSyncV1:{deleteMaster:()=>new Promise(r=>resolveDelete=r),persistLocal(){}}};
 vm.runInNewContext(fs.readFileSync('employee-master-confirmed-save-v1.js','utf8'),{window:root,setTimeout(){},confirm:()=>true});
 return {root,A,B,resolve:r=>resolveDelete(r)};
}
test('delete acknowledgement removes selected ID even if sync reordered rows',async()=>{
 const h=harness(),pending=h.root.emDeleteRow(0);h.root.EM.data=[h.B,h.A];h.resolve({ok:true,verified:true});await pending;
 assert.deepEqual(h.root.EM.data,[h.B]);
});
test('delete acknowledgement does not remove another row when sync already removed target',async()=>{
 const h=harness(),pending=h.root.emDeleteRow(0);h.root.EM.data=[h.B];h.resolve({ok:true,verified:true});await pending;
 assert.deepEqual(h.root.EM.data,[h.B]);
});
test('failed delete keeps existing record',async()=>{
 const h=harness(),pending=h.root.emDeleteRow(0);h.resolve({ok:false,error:'backend unavailable'});await pending;
 assert.deepEqual(h.root.EM.data,[h.A,h.B]);
});
