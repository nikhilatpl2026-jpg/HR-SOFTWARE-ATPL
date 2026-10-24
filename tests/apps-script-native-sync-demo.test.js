'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../appscript/ATPL_Native_Sync_Demo_STAGING.gs'),'utf8');
function harness(){
 let tab=null;
 function sheet(){
  return {values:[],getRange(row,col,n,m){const ref=this;return {
   getValues:()=>[ref.values[row-1]||Array(m).fill('')],
   setValues(x){ref.values[row-1]=x[0]}
  }},setFrozenRows(){}};
 }
 const output=[];
 const ctx={
  SpreadsheetApp:{openById(id){
   assert.equal(id,'1AMPJRxoSugAMCOK4-Zj2X3GFfIWGsjlTFdHFSvWaMBY');
   return {getSheetByName(n){assert.equal(n,'Native_Sync_Test');return tab},
    insertSheet(n){assert.equal(n,'Native_Sync_Test');tab=sheet();return tab}};
  },flush(){}},
  LockService:{getScriptLock(){return{waitLock(){},releaseLock(){}}}},
  HtmlService:{createHtmlOutput(s){return{getContent(){return s},setTitle(){return this}}}},
  Logger:{log(s){output.push(s)}},
  Date
 };
 vm.createContext(ctx);
 vm.runInContext(source,ctx);
 return {ctx,output,getSheet:()=>tab};
}
test('demo is confined to isolated synthetic test sheet',()=>{
 const {ctx}=harness(),before=ctx.atplNativeSyncDemoGet();
 assert.equal(before.revision,0);
 assert.equal(before.deleted,true);
 const saved=ctx.atplNativeSyncDemoSave('TAB_A',0);
 assert.equal(saved.value,'TAB_A');
 assert.equal(saved.revision,1);
 const deleted=ctx.atplNativeSyncDemoDelete(1);
 assert.equal(deleted.deleted,true);
 assert.equal(deleted.revision,2);
 const attempt=ctx.atplNativeSyncDemoSave('STALE_TAB',1);
 assert.equal(attempt.ok,false);
 assert.equal(attempt.error,'STALE_REVISION_BLOCKED');
 assert.equal(ctx.atplNativeSyncDemoGet().deleted,true);
});
test('input guards and false revision do not overwrite existing record',()=>{
 const {ctx}=harness();
 assert.equal(ctx.atplNativeSyncDemoSave('=HYPERLINK()',0).error,'INVALID_TEST_VALUE');
 assert.equal(ctx.atplNativeSyncDemoSave('GOOD_VALUE',-1).error,'INVALID_REVISION');
 assert.equal(ctx.atplNativeSyncDemoSave('GOOD_VALUE',0).ok,true);
 assert.equal(ctx.atplNativeSyncDemoSave('STALE',0).error,'STALE_REVISION_BLOCKED');
 assert.equal(ctx.atplNativeSyncDemoGet().value,'GOOD_VALUE');
});
test('script editor smoke test and browser page are staging only',()=>{
 const {ctx,output}=harness();
 assert.equal(ctx.atplNativeSyncDemoSelfTest().ok,true);
 assert.ok(output.includes('SUCCESS - STALE TAB RESTORE BLOCKED'));
 const page=ctx.atplNativeSyncDemoPage().getContent();
 assert.match(page,/google\.script\.run/);
 assert.match(page,/setInterval\(refresh,3000\)/);
 assert.doesNotMatch(page,/\/api\/sync\/employee-master|firebase\.initializeApp/);
});
