'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../appscript/ATPL_Native_Health_STAGING.gs'),'utf8');
const ctx={
 HtmlService:{
  createHtmlOutput(h){return{getContent(){return h},setTitle(){return this}};}
 },
 Logger:{log(){}}
};
vm.createContext(ctx);
vm.runInContext(source,ctx);
test('native transport returns safe staging-only state',()=>{
 const d=ctx.atplNativeHealthPing();
 assert.equal(d.ok,true);assert.equal(d.environment,'STAGING');
 assert.equal(d.dataWritesEnabled,false);assert.equal(d.liveERPConnected,false);
 assert.equal(d.transport,'google.script.run');
});
test('HTMLService uses google.script.run (no cloud proxy or record writes)',()=>{
 const page=ctx.atplNativeHealthPage_().getContent();
 assert.match(page,/google\.script\.run/);
 assert.match(page,/atplNativeHealthPing\(\)/);
 assert.doesNotMatch(page,/window\.fetch|employeeSave|POST_ENABLED|password_hash/);
 assert.equal(ctx.atplNativeHealthSelfTest().ok,true);
});
