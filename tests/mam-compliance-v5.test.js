'use strict';
const assert=require('assert');
const api=require('../mam-compliance-v5.js');
const fx=require('./fixtures/mam-compliance-v5-fixtures.js');
const month='2026-09';
let rows=api.buildComplianceRows(fx.mam,fx.master,fx.monthly,month);
assert.strictEqual(rows.length,2,'No Mam row may disappear');
assert.strictEqual(rows[0].empCode,'00135','Leading-zero code must survive');
assert.strictEqual(rows[0].auditStatus,'READY');
assert.strictEqual(rows[0].pfEmployee,1800);
assert.strictEqual(rows[0].pfEmployer,1800);
assert.strictEqual(rows[0].eps,1250);
assert.strictEqual(rows[0].esiEmployee,150);
assert.strictEqual(rows[0].esiEmployer,650);
assert.strictEqual(rows[0].totalDeduction,2100);
assert.strictEqual(rows[0].netPayable,17900);
assert.strictEqual(rows[0].diffAmount,0);
assert.strictEqual(api.canFinalExport(rows),true,'Resolved rows must allow final export');

let missing=api.buildComplianceRows([fx.mam[0]],fx.master,[],month);
assert.strictEqual(missing.length,1);
assert.strictEqual(missing[0].auditStatus,'BLOCKED');
assert(missing[0].auditIssues.some(x=>x.code==='MONTH_SOURCE_MISSING'));
assert(missing[0].auditIssues.some(x=>x.code==='PAID_DAYS_MISSING'));
assert.strictEqual(api.canFinalExport(missing),false);

let dupMam=[fx.mam[0],Object.assign({},fx.mam[0],{source:{type:'MAM',file:'x.xlsx',sheet:'Sheet1',row:9}})];
let dupRows=api.buildComplianceRows(dupMam,fx.master,fx.monthly,month);
assert.strictEqual(dupRows.length,2);
assert(dupRows.every(r=>r.auditIssues.some(x=>x.code==='MAM_DUPLICATE')));

let badMonthly=[Object.assign({},fx.monthly[0],{pfWage:null,esiWage:null,pfStatus:'',esiStatus:'',fieldPresence:{advance:true,otherDeduction:true}})];
let bad=api.buildComplianceRows([fx.mam[0]],fx.master.map(x=>Object.assign({},x,{pf_status:'',esi_status:''})),badMonthly,month)[0];
assert.strictEqual(bad.auditStatus,'BLOCKED');
assert(bad.auditIssues.some(x=>x.code==='PF_STATUS_REVIEW'));
assert(bad.auditIssues.some(x=>x.code==='ESIC_REVIEW_REQUIRED'));

let changedMam=[Object.assign({},fx.mam[0],{manualAmount:25000})];
let changed=api.buildComplianceRows(changedMam,fx.master,fx.monthly,month)[0];
assert.strictEqual(changed.paidDays,30);
assert.strictEqual(changed.otHours,0);
assert.strictEqual(changed.grossEarned,20000);
assert.strictEqual(changed.diffAmount,5000);
assert(changed.auditIssues.some(x=>x.code==='MANUAL_AMOUNT_DIFFERENCE'));

let otSrc=Object.assign({},fx.monthly[0],{otHours:4,otRate:null,otAmount:1000,otApproval:'NO',totalGross:21000});
let ot=api.buildComplianceRows([Object.assign({},fx.mam[0],{manualAmount:21000})],fx.master,[otSrc],month)[0];
assert(ot.auditIssues.some(x=>x.code==='OT_RATE_MISSING'));
assert(ot.auditIssues.some(x=>x.code==='OT_APPROVAL_MISSING'));
assert.strictEqual(ot.auditStatus,'BLOCKED');

let dedSrc=Object.assign({},fx.monthly[0],{advance:10000,otherDeduction:2000,deductionApproval:'YES'});
let ded=api.buildComplianceRows([fx.mam[0]],fx.master,[dedSrc],month)[0];
assert(ded.auditIssues.some(x=>x.code==='DEDUCTION_LIMIT_REVIEW'));

const cats=api.categoryMap(rows);
assert.strictEqual(cats['CARD NO-12'].length,2);
const modelOn=api.buildExportModel(rows,{lokesh:true,month});
const modelOff=api.buildExportModel(rows,{lokesh:false,month});
assert.strictEqual(modelOn.summary.employees,modelOff.summary.employees,'Template toggle must not destroy data');
assert.strictEqual(modelOn.summary.netPayable,modelOff.summary.netPayable);
assert(modelOn.sheets.some(s=>s.name==='Main Sheet'));
assert(modelOn.sheets.some(s=>s.name==='CARD NO-12'));
assert(modelOn.sheets.some(s=>s.name==='Review'));
assert(modelOn.sheets.some(s=>s.name==='Statutory Summary'));
assert(modelOn.sheets.some(s=>s.name==='Reconciliation'));
assert(modelOn.sheets.some(s=>s.name==='Source Log'));
const mainCount=modelOn.sheets.find(s=>s.name==='Main Sheet').rows.length-4;
const catCount=modelOn.sheets.filter(s=>!['Main Sheet','Review','Statutory Summary','Reconciliation','Source Log','Calculation Audit'].includes(s.name)).reduce((a,s)=>a+s.rows.length-4,0);
assert.strictEqual(mainCount,catCount,'Category row count must exactly reconcile to Main Sheet');

console.log('mam-compliance-v5.test.js: all assertions passed');
