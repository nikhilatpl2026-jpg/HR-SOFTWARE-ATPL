'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const code=fs.readFileSync(path.join(__dirname,'../appscript/ATPL_AppsScript_Only_Health.gs'),'utf8');
function htmlServiceMock(){
  return {
    XFrameOptionsMode:{ALLOWALL:'ALLOWALL'},
    createHtmlOutput:function(html){return {
      getContent:()=>html,
      setTitle(){return this},
      setXFrameOptionsMode(m){if(m!=='ALLOWALL')throw Error('missing ALLOWALL');return this}
    }}
  };
}
const ctx={HtmlService:htmlServiceMock(),Logger:{log(){}},console};
vm.createContext(ctx);vm.runInContext(code,ctx);
test('safe staging health response never returns employee data',()=>{
  const r=ctx.atplFormHealthResponse_({parameter:{action:'health',request_id:'PROBE_1234567890123456'}});
  const body=r.getContent();
  assert.ok(body.includes('ATPL_FORM_HEALTH_V1'));
  assert.ok(body.includes('"dataWritesEnabled":false'));
  assert.ok(body.includes('"liveERPConnected":false'));
  assert.ok(body.includes('window.top.postMessage('));
  assert.ok(!body.includes('password_hash'));
});
test('data and credential actions fail closed',()=>{
  for(const action of ['employeeSave','fileSave','login','changesSince','fileDelete']){
    const body=ctx.atplFormHealthResponse_({parameter:{action,request_id:'PROBE_1234567890123456'}}).getContent();
    assert.ok(body.includes('HEALTH_ONLY_STAGING'));
    assert.ok(!body.includes('STAGING_TEST_SECRET'));
  }
});
test('request id cannot inject scripts or HTML',()=>{
  const body=ctx.atplFormHealthResponse_({parameter:{
    action:'health',request_id:'xx</script><script>alert(1)</script>'
  }}).getContent();
  assert.ok(!body.includes('alert(1)'));
  assert.ok(body.includes('"requestId":"INVALID_REQUEST"'));
});
test('script editor self-test does not write',()=>{
  const r=ctx.atplFormHealthSelfTest();
  assert.equal(r.ok,true);assert.equal(r.healthOnly,true);
});
