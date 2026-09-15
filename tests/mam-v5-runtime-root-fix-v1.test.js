'use strict';
const assert=require('assert');
const api=require('../mam-v5-runtime-root-fix-v1.js');
const fake={};
assert.strictEqual(api.install(fake),true,'runtime root binding must install');
assert.strictEqual(fake.root,fake,'root must point to the runtime global object');
console.log('mam-v5-runtime-root-fix-v1.test.js: all assertions passed');
