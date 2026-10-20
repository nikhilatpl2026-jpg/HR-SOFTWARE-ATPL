'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {hasValidConfig,allowedOrigin,cleanRequest,normalizeForwardResult}=
  require('../backend/drive-sheets/drive-stage-relay');
const good={ATPL_DRIVE_STAGE_RELAY_ENABLED:'1',
 ATPL_DRIVE_STAGE_EXEC_URL:'https://script.google.com/macros/s/'+'A'.repeat(70)+'/exec',
 ATPL_DRIVE_STAGE_RELAY_KEY:'B'.repeat(64)};
test('staging fails closed until activated and refuses /dev',()=>{
 assert.equal(hasValidConfig({...good,ATPL_DRIVE_STAGE_RELAY_ENABLED:'0'}),false);
 assert.equal(hasValidConfig({...good,ATPL_DRIVE_STAGE_RELAY_KEY:'short'}),false);
 assert.equal(hasValidConfig({...good,ATPL_DRIVE_STAGE_EXEC_URL:good.ATPL_DRIVE_STAGE_EXEC_URL.replace('/exec','/dev')}),false);
 assert.equal(hasValidConfig(good),true);
});
test('only intended browser origin allowed',()=>{
 assert.equal(allowedOrigin('https://nikhilatpl2026-jpg.github.io'),true);
 for(const origin of [null,undefined,'https://other.example','https://nikhilatpl2026-jpg.github.io.attacker.test'])
   assert.equal(allowedOrigin(origin),false);
});
test('login validates hash, private writes require sessions and secrets are not accepted',()=>{
 assert.equal(cleanRequest({action:'arbitrary'}).error,'INVALID_ACTION');
 assert.equal(cleanRequest({action:'employeeSave'}).error,'SESSION_REQUIRED');
 assert.equal(cleanRequest({action:'login',user_id:'admin',password_hash:'abc'}).error,'INVALID_LOGIN_REQUEST');
 assert.equal(cleanRequest({action:'login',user_id:'admin',password_hash:'c'.repeat(64),relaySecret:'leaked'}).error,'FORBIDDEN_FIELD');
 assert.deepEqual(cleanRequest({action:'session',token:'c'.repeat(64),injected:'BAD'}).value,
   {action:'session',token:'c'.repeat(64)});
});
test('provider response must be structured JSON with ok flag',()=>{
 assert.equal(normalizeForwardResult({ok:true}).value.ok,true);
 assert.equal(normalizeForwardResult({status:200}).error,'INVALID_SCRIPT_RESPONSE');
});
