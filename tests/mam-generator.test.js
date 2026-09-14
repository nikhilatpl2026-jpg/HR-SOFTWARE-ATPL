'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const api=require('../mam-salary-generator.js');

function referenceRows(){
  return [
    ['Salary Sheet Month of August-26'],
    [],
    api.MAIN_HEADERS,
    [1,'00135','ALPHA WORKER','FATHER A','01-01-1990','01-01-2020','PF001','ESI001','MALE','PRODUCTION','OPERATOR','CARD NO. 1',15120,21000,30,4,21883,21890,7,1756,110,500,2366,19517,''],
    [2,101,'NO CARD WORKER','','','','NA','NA','MALE','','','CARD NO. 7',0,0,0,0,0,7290,7290,0,0,0,0,0,'WITHOUT CARD']
  ];
}

// Repeated category headers are separators, not employee rows. Grand totals are ignored.
const mam=api.parseMam([
  ['Code','Card No. 1','Total'],
  [135,'Alpha Worker',21890.25],
  ['Code','Card No. 7',null],
  [null,'No Card Worker',7290],
  [null,null,29180.25]
],'Sheet1','Mam.xlsx');
assert.strictEqual(mam.length,2);
assert.strictEqual(mam[0].category,'Card No. 1');
assert.strictEqual(mam[1].category,'Card No. 7');

const reference=api.parseReference(referenceRows(),'Main Sheet','Consultant.xlsx');
assert.strictEqual(reference.month,'2026-08');
assert.strictEqual(reference.rows.length,2);
const profiles=api.buildProfileSet(reference,{month:'2026-08',monthDays:31});
assert.strictEqual(profiles.count,2);
assert.strictEqual(profiles.byNameCategory['no card worker|card no 7'].empId,'101');

const master=[{
  emp_id:'00135',name:'ALPHA WORKER',father:'MASTER FATHER',dob:'02-02-1990',doj:'03-03-2020',
  pf_no:'PF-MASTER',esi_no:'ESI-MASTER',gender:'MALE',dept:'MASTER DEPT',desig:'MASTER ROLE',cat2:'CARD NO. 1',
  basic:15120,gross:21000,bank_name:'TEST BANK',ifsc:'TEST0000001',account_no:'000012345678'
}];
const generated=api.generateRows(mam,master,profiles,{month:'2026-08',monthDays:31});
assert.strictEqual(generated.length,2);
assert.strictEqual(generated[0].empId,'00135','Employee Master leading zeros must win');
assert.strictEqual(generated[0].father,'MASTER FATHER','Personal fields must prefer Employee Master');
assert.strictEqual(generated[0].bankName,'TEST BANK');
assert.strictEqual(generated[1].empId,'101','Blank Mam code should resolve only through unique name + category');
assert(generated[1].issues.includes('Employee Master record missing'));
assert(generated[0].warnings.some(x=>x.includes('auto-derived')));

// Employee calculations are deterministic and immediately react to edited grid values.
const row=generated[0];
const oldNet=row.netPayable;
row.advance=750;
api.recalculateRow(row,{month:'2026-08',monthDays:31});
assert.strictEqual(row.totalDeduction,row.pfEmployee+row.esiEmployee+750);
assert.strictEqual(row.netPayable,oldNet-250);

// A duplicate code is resolved against the learned consultant amount and explicitly flagged.
const duplicate=api.generateRows([
  {code:'135',name:'Alpha Worker',amount:3200,category:'OTHER',source:'row 1'},
  {code:'00135',name:'Alpha Worker',amount:21890,category:'CARD NO. 1',source:'row 2'}
],master,profiles,{month:'2026-08',monthDays:31});
assert.strictEqual(duplicate.length,1);
assert.strictEqual(duplicate[0].manualAmount,21890);
assert(duplicate[0].issues.some(x=>x.includes('Duplicate Mam code auto-resolved')));
assert(duplicate[0].issues.some(x=>x.includes('3200')));

// Export mirrors the latest edited values and keeps the consultant's exact main columns.
const model=api.buildExportModel(generated,{month:'2026-08',monthDays:31},{mamFile:'Mam.xlsx',mamSheet:'Sheet1',masterCount:1});
assert.deepStrictEqual(model.sheets[0].rows[2],api.MAIN_HEADERS);
assert.strictEqual(model.sheets[0].rows[3][21],750);
assert(model.sheets.some(s=>s.name==='BANK DETAILS'));
assert(model.sheets.some(s=>s.name==='STATUTORY SUMMARY'));
assert(model.sheets.some(s=>s.name==='REVIEW'));
assert.strictEqual(model.sheets.find(s=>s.name==='BANK DETAILS').rows[1][5],'000012345678');

// Loader changes are scoped to this module and retain a stable legacy fallback.
const loader=fs.readFileSync(path.join(__dirname,'..','mam-salary.js'),'utf8');
assert(loader.includes('mam-salary-generator.js'));
assert(loader.includes('mam-salary-v2-legacy.js'));

console.log('mam-generator.test.js: all assertions passed');
