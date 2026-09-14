'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const api=require('../mam-salary-july-v4.js');
const H=api.MAIN_HEADERS;
const rows=[
 ['Arora Textiles Pvt. Ltd.'],['Salary Sheet Month of July-26'],[],H,
 [1,'00135','ALPHA','F A','01-01-1990','01-01-2020','PF001','ESI001','MALE','PROD','OP','STAFF','STAFF',19915,7745,27660,31,25,4,0,2,29,0,18630,7245,25875,1552,0,27427,27660,233,1800,140,0,1940,25487,1950,605,'ACTIVE'],
 [2,'00538','FULL PF','F B','02-02-1990','02-02-2020','PF002','NA','FEMALE','ACC','MGR','STAFF','STAFF',35280,27720,63000,31,27,4,0,0,31,0,35280,27720,63000,0,0,63000,63000,0,4234,0,0,4234,58766,4339,0,'ACTIVE'],
 [3,'00530','ADVANCE','F C','03-03-1990','03-03-2020','PF003','ESI003','MALE','ACC','OP','STAFF','STAFF',20880,8120,29000,31,27,4,0,0,31,0,20880,8120,29000,1739,0,30739,21235,0,2506,157,9504,12167,18572,2568,679,'ACTIVE'],
 [4,'00999','HALF DAY','F D','04-04-1990','04-04-2020','NA','ESI004','FEMALE','PROD','OP','CARD','CARD',15120,5880,21000,31,1.5,0,0,29.5,1.5,0,732,285,1017,61,0,1078,1200,122,0,5,0,5,1073,0,24,'ACTIVE']
];
const ref=api.parseReference(rows,'Main Sheet','July.xlsx');
assert.strictEqual(ref.month,'2026-07');assert.strictEqual(ref.rows.length,4);
const profiles=api.buildProfileSet(ref,{month:'2026-07',monthDays:31,otDivisor:124});
assert.strictEqual(profiles.byCode['135'].bonusMode,'BASIC_833');
assert.strictEqual(profiles.byCode['135'].pfMode,'CAP');
assert.strictEqual(profiles.byCode['538'].pfMode,'FULL');
assert.strictEqual(profiles.byCode['530'].advanceMode,'GROSS_MINUS_MANUAL');
const master=ref.rows.map(r=>({emp_id:r.empId,name:r.name,basic:r.basic,hra:r.hra,gross:r.gross,pf_no:r.pfNo,esi_no:r.esiNo,bank_name:'BANK',ifsc:'TEST0000001',account_no:'000123'}));
const mam=ref.rows.map(r=>({code:r.empId,name:r.name,amount:r.manualAmount,category:r.category2,source:'Mam'}));
const out=api.generateRows(mam,master,profiles,{month:'2026-07',monthDays:31,otDivisor:124,maxOtHours:64,maxSundayAllow:5});
assert.strictEqual(out[0].earnedBonus,1552);assert.strictEqual(out[0].pfEmployee,1800);assert.strictEqual(out[0].esiEmployee,140);assert.strictEqual(out[0].pfEmployer,1950);
assert.strictEqual(out[1].pfEmployee,4234);assert.strictEqual(out[1].pfEmployer,4339);
assert.strictEqual(out[2].advance,9504);assert.strictEqual(out[2].diffAmount,0);assert.strictEqual(out[2].netPayable,18572);
assert.strictEqual(out[3].workingDays,1.5);assert.strictEqual(out[3].paidDays,1.5);assert.strictEqual(out[3].earnedBasic,732);
const otRow=Object.assign({},out[0],{workingDays:25,sunAllow:4,overtimeHours:4,workConfidence:'MANUAL_EDIT'});api.recalculateRow(otRow,{month:'2026-07',monthDays:31,otDivisor:124});assert.strictEqual(otRow.earnedOt,892);
const model=api.buildExportModel(out,{month:'2026-07',monthDays:31,otDivisor:124},{profileSource:'July.xlsx',mamFile:'Mam.xlsx'});
for(const name of ['Main Sheet','Account Sheet','Differance Sheet','DEPT WISE','BANK DETAILS','RULE AUDIT','REVIEW','REPORT NOTES']) assert(model.sheets.some(s=>s.name===name),name+' missing');
const loader=fs.readFileSync(path.join(__dirname,'..','mam-salary.js'),'utf8');assert(loader.includes('mam-salary-july-v4.js'));assert(loader.includes('mam-salary-next-v3.js'));
console.log('mam-july-v4.test.js: all assertions passed');
