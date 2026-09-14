'use strict';
const assert=require('assert');
const api=require('../mam-salary-next-v3.js');

function refRows(){
  return [
    ['Salary Sheet Month of August-26'],[],api.MAIN_HEADERS,
    [1,'00135','ALPHA','F A','01-01-1990','01-01-2020','PF001','ESI001','MALE','PROD','OP','CARD 1',19915,27660,29,0,27427,27660,233,1800,140,0,1940,25487,''],
    [2,'00387','BETA','F B','02-02-1990','02-02-2020','PF002','NA','MALE','PROD','OP','CARD 1',24552,34100,31,0,34100,34100,0,1800,0,0,1800,32300,''],
    [3,'00538','GAMMA','F C','03-03-1990','03-03-2020','PF003','NA','FEMALE','STAFF','MGR','CARD 2',35280,63000,31,0,63000,63000,0,4234,0,0,4234,58766,''],
    [4,'10583','RIYAJUL','F D','04-04-1990','04-04-2020','PF004','ESI004','MALE','PROD','OP','CARD 3',20880,29000,31,0,30739,21235,0,2506,157,9504,12167,18572,''],
    [5,'00439','SHIKARI','F E','05-05-1990','05-05-2020','NA','NA','MALE','PROD','OP','CARD 7',21960,30500,26,5,27047,27100,27100,0,0,0,1800,0,'AGE PROBLEM'],
    [6,'00999','NO CARD','','','','NA','NA','MALE','','','CARD 7',0,0,0,0,0,7290,7290,0,0,0,0,0,'WITHOUT CARD']
  ];
}

const ref=api.parseReference(refRows(),'Main Sheet','Sent 02 Sheet Aug-26.xlsx');
assert.strictEqual(ref.month,'2026-08');
assert.strictEqual(ref.rows.length,6);
const profiles=api.buildProfileSet(ref,{month:'2026-08',monthDays:31});
assert.strictEqual(profiles.count,6);
assert.strictEqual(profiles.byCode['135'].grossRule,'BASIC_833');
assert.strictEqual(profiles.byCode['387'].grossRule,'NONE');
assert.strictEqual(profiles.byCode['538'].pfMode,'FULL');
assert.strictEqual(profiles.byCode['135'].pfMode,'CAP');
assert.strictEqual(profiles.byCode['135'].esiMode,'BASIC_PRORATED');
assert.strictEqual(profiles.byCode['10583'].advanceMode,'GROSS_MINUS_MANUAL');
assert.strictEqual(profiles.byCode['10583'].diffMode,'ZERO');
assert.strictEqual(profiles.byCode['439'].diffMode,'MANUAL');
assert.strictEqual(profiles.byCode['439'].otherDeduction,1800);
assert.strictEqual(profiles.byCode['439'].paymentHold,true);
assert.strictEqual(profiles.byCode['999'].zeroPayrollHold,true);

const mam=api.parseMam([
  ['Emp Code','Emp Name','Manual Amount'],
  ['00135','Alpha',27660],
  ['10583','Riyajul',21235],
  ['00439','Shikari',27100],
  ['00999','No Card',7290]
],'MAM','Mam Aug.xlsx');
const master=[
  {emp_id:'00135',name:'ALPHA',father:'MASTER F',dob:'10-10-1991',doj:'01-01-2021',pf_no:'PFM',esi_no:'ESIM',gender:'MALE',dept:'PROD',desig:'OP',cat1:'CARD 1',basic:19915,gross:27660,bank_name:'BANK',ifsc:'TEST0000001',account_no:'0000012345'},
  {emp_id:'10583',name:'RIYAJUL',pf_no:'PF004',esi_no:'ESI004',basic:20880,gross:29000,bank_name:'BANK2',ifsc:'TEST0000002',account_no:'0000099999'},
  {emp_id:'00439',name:'SHIKARI',basic:21960,gross:30500},
  {emp_id:'00999',name:'NO CARD',basic:0,gross:0}
];
const rows=api.generateRows(mam,master,profiles,{month:'2026-08',monthDays:31,maxOtHours:64});
assert.strictEqual(rows.length,4);
assert.strictEqual(rows[0].empId,'00135');
assert.strictEqual(rows[0].father,'MASTER F');
assert.strictEqual(rows[0].accountNo,'0000012345');
assert.strictEqual(rows[0].paidDays,29);
assert.strictEqual(rows[0].overtimeHours,0);
assert.strictEqual(rows[0].workConfidence,'CONSULTANT_EXACT');
assert.strictEqual(rows[0].totalGross,27427);
assert.strictEqual(rows[0].pfEmployee,1800);
assert.strictEqual(rows[0].esiEmployee,140);
assert.strictEqual(rows[1].advance,9504);
assert.strictEqual(rows[1].diffAmount,0);
assert.strictEqual(rows[2].otherDeduction,1800);
assert.strictEqual(rows[2].netPayable,0);
assert.strictEqual(rows[3].paidDays,0);
assert.strictEqual(rows[3].netPayable,0);

rows[0].manualAmount=28000;
const fit=api.fitWork(rows[0].manualAmount,rows[0],{month:'2026-08',monthDays:31,maxOtHours:64});
rows[0].paidDays=fit.paidDays;rows[0].overtimeHours=fit.overtimeHours;rows[0].workConfidence=fit.confidence;
api.recalculateRow(rows[0],{month:'2026-08',monthDays:31,maxOtHours:64});
assert(['AUTO_EXACT','AUTO_DERIVED'].includes(rows[0].workConfidence));

const dups=api.generateRows([
  {code:'00135',name:'ALPHA',amount:27660,category:'CARD 1',source:'row 1'},
  {code:'135',name:'ALPHA',amount:28000,category:'CARD 1',source:'row 2'}
],master,profiles,{month:'2026-08',monthDays:31});
assert.strictEqual(dups.length,2);
assert(dups.every(r=>r.issues.some(x=>x.includes('Duplicate Employee Code'))));

rows[0].advanceMode='MANUAL';rows[0].advance=777;api.recalculateRow(rows[0],{month:'2026-08',monthDays:31});
const model=api.buildExportModel(rows,{month:'2026-08',monthDays:31},{mamFile:'Mam.xlsx',mamSheet:'MAM',profileSource:'Consultant.xlsx',masterCount:4});
assert.deepStrictEqual(model.sheets[0].rows[2],api.MAIN_HEADERS);
assert.strictEqual(model.sheets[0].rows[3][21],777);
for(const name of ['BANK DETAILS','STATUTORY SUMMARY','RULE AUDIT','REVIEW','REPORT NOTES']) assert(model.sheets.some(s=>s.name===name),name+' missing');
assert.strictEqual(model.sheets.find(s=>s.name==='BANK DETAILS').rows[1][5],'0000012345');

console.log('mam-next-v3.test.js: all assertions passed');
