'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../appscript/ATPL_Employee_Migration_Audit_READ_ONLY.gs'),'utf8');
function harness(legacyRows,stageRows,oldHeader,stageHeader){
 const logs=[],writes=[];
 function mk(rows){
  return {
   getLastRow(){return rows.length},
   getLastColumn(){return rows[0]?.length||0},
   getRange(r,c,count,n){
    return {getValues:()=>Array.from({length:count},(_,i)=>{
      const row=rows[r-1+i]||[];
      return Array.from({length:n},(_,j)=>row[c-1+j]??'');
    }),
    setValues(){writes.push('write')}};
   }
  };
 }
 const sheets={
  '1SVGnJpzRIDHoYZ1W4VHII0m-JYrisW1xKixLNYG8u9s':mk([
   oldHeader||['emp_id','record_json','updated_by','updated_at'],...legacyRows
  ]),
  '1AMPJRxoSugAMCOK4-Zj2X3GFfIWGsjlTFdHFSvWaMBY':mk([
   stageHeader||['Employee_Code','Employee_Name'],...stageRows
  ])
 };
 const ctx={
  SpreadsheetApp:{openById(id){const s=sheets[id];assert.ok(s,'unknown ID');return{
   getSheetByName(name){assert.ok(['EmployeeMaster','Employee_Master'].includes(name));return s}
  }}},
  Logger:{log(msg){logs.push(msg)}}
 };
 vm.createContext(ctx);vm.runInContext(source,ctx);
 return {ctx,logs,writes};
}
test('counts all record categories without revealing values or writing',()=>{
 const h=harness([
 ['101',JSON.stringify({emp_id:'101',empName:'Private Employee One'})],
 ['102',JSON.stringify({emp_id:'102',_atpl_deleted:true})],
 ['__ATPL_SYS__ANY',JSON.stringify({_atpl_system:true})],
 ['bad','{garbled json'],
 ['101',JSON.stringify({emp_id:'101'})],
 ['103',JSON.stringify({emp_id:'wrong'})],
 ],[['101','Private One'],['333','Private Two']]);
 const r=h.ctx.atplEmployeeMigrationAuditReadOnly();
 assert.equal(r.legacyTotalRows,6);
 assert.equal(r.legacyActiveEmployees,2);
 assert.equal(r.legacyTombstones,1);
 assert.equal(r.legacySystemRecords,1);
 assert.equal(r.legacyInvalidJson,1);
 assert.equal(r.legacyDuplicateActiveIds,1);
 assert.equal(r.legacyCodeMismatch,1);
 assert.equal(r.overlapCount,1);
 assert.equal(r.stagingOnlyCount,1);
 assert.equal(r.legacyOnlyCount,1);
 assert.deepEqual(h.writes,[]);
 assert.doesNotMatch(h.logs.join('\n'),/Private Employee|Private One|Private Two/);
 assert.equal(r.migrationReady,false);
});
test('does not create sheets or change anything for empty datasets',()=>{
 const h=harness([],[]);
 const r=h.ctx.atplEmployeeMigrationAuditReadOnly();
 assert.equal(r.legacyActiveEmployees,0);
 assert.equal(r.stagingEmployeeCodes,0);
 assert.deepEqual(h.writes,[]);
});
test('rejects missing expected schema to avoid bad migration decisions',()=>{
 const h=harness([],[],['wrong','record_json','updated_by','updated_at']);
 assert.throws(()=>h.ctx.atplEmployeeMigrationAuditReadOnly(),/LEGACY_MASTER_FORMAT_CHANGED/);
});
