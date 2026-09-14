'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const api=require('../mam-compliance-v5.js');
const fx=require('./fixtures/mam-compliance-v5-fixtures.js');
const src=fs.readFileSync(path.join(__dirname,'..','mam-compliance-v5.js'),'utf8');
const rules=fs.readFileSync(path.join(__dirname,'..','mam-compliance-rules-india-v1.js'),'utf8');
assert(src.includes("lokesh:true"),'Lokesh Salary Type must default ON');
assert(src.includes("DB_STORE='salaryFiles'"),'V5 must read existing saved salaryFiles store');
assert(src.includes("'readonly'"),'Monthly source access must be read-only');
assert(!/objectStore\([^)]*\)\.put\(/.test(src),'V5 must not mutate stored payroll source');
assert(!src.includes("localStorage.setItem('AroraTextilesEmployeeMasterV3'"),'V5 must not write Employee Master');
assert(!src.includes('emSave')&&!src.includes('doLogin=function'),'V5 must not override Employee Master/auth functions');
assert(rules.includes('INDIA-HR-COMPLIANCE-2026.09-v1'));
assert(rules.includes('sourcePolicy'));

const before=JSON.stringify({m:fx.mam,e:fx.master,p:fx.monthly});
const a=api.buildComplianceRows(fx.mam,fx.master,fx.monthly,'2026-09');
const b=api.buildComplianceRows(fx.mam,fx.master,fx.monthly,'2026-09');
assert.deepStrictEqual(a.map(x=>[x.empCode,x.netPayable,x.auditStatus]),b.map(x=>[x.empCode,x.netPayable,x.auditStatus]));
assert.strictEqual(JSON.stringify({m:fx.mam,e:fx.master,p:fx.monthly}),before,'Source arrays must remain unchanged');

console.log('mam-compliance-v5-regression.test.js: all assertions passed');
