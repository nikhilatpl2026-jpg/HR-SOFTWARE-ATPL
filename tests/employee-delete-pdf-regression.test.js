'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

function storage(initial) {
  const items = Object.assign({}, initial || {});
  return {getItem:key=>Object.prototype.hasOwnProperty.call(items,key)?items[key]:null,
    setItem:(key,value)=>{items[key]=String(value)}, removeItem:key=>{delete items[key]}};
}
function setupCloud(initial) {
  let records = initial.map(r=>({...r}));
  const local = storage(),session = storage({'ATPL_RemoteToken_V1':'test-token'});
  const root = {
    localStorage:local,sessionStorage:session,
    document:{readyState:'loading',addEventListener:()=>{},getElementById:()=>null},
    addEventListener:()=>{},setTimeout:()=>0,clearTimeout:()=>{},console,
    ATPLCloudAPI:{request:async req=>{
      if(req.action==='getEmployeeMaster')return{ok:true,records:records.map(r=>({...r}))};
      if(req.action==='deleteEmployeeMaster'){records=records.filter(r=>String(r.emp_id)!==String(req.emp_id));return{ok:true}};
      if(req.action==='upsertEmployeeMaster'){records.push(JSON.parse(req.record_json));return{ok:true}};
      throw new Error('Unexpected action '+req.action);
    }}
  };
  vm.runInNewContext(read('erp-cloud-sync-v1.js'),{window:root,console,setTimeout:root.setTimeout});
  return{root,local,records:()=>records};
}

test('fresh cloud read verifies delete even when previous GET was cached',async()=>{
  const record={emp_id:'2401',name:'Example Employee'};
  const {root,local,records}=setupCloud([record]);
  const deleted=await root.ATPLCloudSyncV1.deleteMaster(record.emp_id,{baseRecord:record});
  assert.equal(deleted.ok,true);
  assert.equal(deleted.verified,true);
  assert.equal(records().length,0);
  assert.ok(JSON.parse(local.getItem('ATPL_EmployeeMasterDeletedV1'))['2401']);
  const stale=await root.ATPLCloudSyncV1.saveMaster(record,{baseRecord:record});
  assert.equal(stale.ok,false,'stale tab cannot reupload a deleted employee');
  assert.equal(records().length,0);
});

test('Employee Master UI preserves employee when server deletion fails',async()=>{
  const alerts=[],original={emp_id:'2402',name:'Example Employee'};
  const root={
    EM:{data:[{...original}],selectedRows:new Set()},emDeleteRow:()=>{},
    emFilter:()=>{},emUpdateStats:()=>{},
    document:{readyState:'complete',getElementById:()=>null,querySelector:()=>null},
    localStorage:storage(),
    ATPLCloudSyncV1:{deleteMaster:async()=>({ok:false,error:'cloud offline'}),persistLocal:()=>true}
  };
  vm.runInNewContext(read('employee-master-confirmed-save-v1.js'),{window:root,confirm:()=>true,alert:x=>alerts.push(x),setTimeout:()=>0,console});
  await root.emDeleteRow(0);
  assert.equal(root.EM.data.length,1);
  assert.match(alerts.join(' '),/NOT deleted/i);
});

test('Employee Master UI only removes employee after verified cloud delete',async()=>{
  let finish;
  const pending=new Promise(resolve=>{finish=resolve});
  const local=storage(),root={
    EM:{data:[{emp_id:'2403',name:'Test'}],selectedRows:new Set()},emDeleteRow:()=>{},
    emFilter:()=>{},emUpdateStats:()=>{},localStorage:local,
    document:{readyState:'complete',getElementById:()=>null,querySelector:()=>null},
    ATPLCloudSyncV1:{deleteMaster:()=>pending,persistLocal:recs=>{local.setItem('master',JSON.stringify(recs));return true}}
  };
  vm.runInNewContext(read('employee-master-confirmed-save-v1.js'),{window:root,confirm:()=>true,alert:()=>{},setTimeout:()=>0,console});
  const running=root.emDeleteRow(0);
  assert.equal(root.EM.data.length,1,'UI cannot delete before server confirms');
  finish({ok:true,verified:true});
  await running;
  assert.equal(root.EM.data.length,0);
  assert.equal(local.getItem('master'),'[]');
});

test('Apps Script backend retains tombstones and rejects stale resurrection',()=>{
  const source=read('backend/Backend-V4-Complete-Code.gs');
  const ctx={console};
  vm.runInNewContext(source,ctx);
  let existing={row:2,emp_id:'2404',json:JSON.stringify({emp_id:'2404',name:'Deleted Example'})};
  ctx.requireUser_=()=>({id:'admin'});
  ctx.hasFeature_=()=>true;
  ctx.findMaster_=()=>existing;
  ctx.LockService={getScriptLock:()=>({waitLock:()=>{},releaseLock:()=>{}})};
  ctx.ensureDataSheets_=()=>({master:{
    getRange:()=>({setValues:arr=>{existing={...existing,emp_id:arr[0][0],json:arr[0][1]}}}),
    appendRow:()=>{throw new Error('Deleted employee should not be inserted')}
  }});
  let out=ctx.deleteEmployeeMaster_({emp_id:'2404',token:'test'});
  assert.equal(out.ok,true);
  assert.equal(JSON.parse(existing.json)._atpl_deleted,true);
  out=ctx.upsertEmployeeMaster_({emp_id:'2404',record_json:JSON.stringify({emp_id:'2404',name:'Old device'}),token:'test'});
  assert.equal(out.ok,false);
  assert.match(out.error,/permanently deleted/i);
});

test('PDF preview uses bundled same-origin PDF.js worker and never embeds a broken blob',()=>{
  const src=read('compliance-dol-rebuild-v2.js');
  assert.ok(src.includes("workerSrc = 'pdf.worker.min.js'"));
  assert.ok(src.includes('disableWorker: false'));
  assert.ok(src.includes("header.indexOf('%PDF-')"));
  const fallback=src.slice(src.indexOf('// Do not embed blob URLs as a fallback'),src.indexOf('})()'));
  assert.ok(!fallback.includes('<object data='));
  assert.ok(!fallback.includes('<embed src='));
});
