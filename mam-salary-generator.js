/*
 * ATPL Mam -> Compliance salary generator.
 *
 * This module is deliberately isolated from the older ERP features. It learns a
 * reusable employee rule profile from a consultant salary workbook, accepts a
 * small Mam workbook (Employee Code, Employee Name, Manual Amount), enriches it
 * from Employee Master and exports the currently edited grid back to Excel.
 */
(function(root){'use strict';

const MAIN_HEADERS=[
  'S.No.','Employee ID','Name of employee','Fathers Name','D.O.B','D-O-J',
  'PF NO','ESI NO','Gender','Department','Designation','Catgrory 01','Basic',
  'Gross Total Salary','Paid Days','Over Time Hours','Total Gross salary',
  'Manual Amount','Diff. Amount','PF@12%','ESIC @0.75%','Advance Deduction',
  'Total Deduction','Net Payable','Remarks'
];
const CATEGORY_HEADERS=[
  'S.No.','Employee ID','Name of employee','Catgrory 01','Total Gross salary',
  'Manual Amount','Diff. Amount','PF@12%','ESIC @0.75%','Advance Deduction',
  'Total Deduction','Net Payable','Remarks'
];
const PROFILE_KEY='ATPL_MamCompliance_GeneratorProfiles_V2';
const DEFAULT_SETTINGS={
  month:'',monthDays:31,maxOtHours:32,pfCeiling:15000,
  pfEmployeeRate:0.12,pfEmployerRate:0.13,
  esiEmployeeRate:0.0075,esiEmployerRate:0.0325
};

function text(v){return v===null||v===undefined?'':String(v).trim()}
function norm(v){return text(v).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()}
function nameKey(v){return norm(v).replace(/\s+/g,' ')}
function cleanCode(v){return text(v).replace(/\.0$/,'')}
function codeKey(v){
  const c=cleanCode(v).replace(/\s+/g,'').toUpperCase();
  return /^\d+$/.test(c)?(c.replace(/^0+/,'')||'0'):c;
}
function number(v){
  if(typeof v==='number'&&Number.isFinite(v))return v;
  if(typeof v!=='string'||!v.trim()||/^#/.test(v.trim()))return null;
  const n=Number(v.replace(/[₹,\s]/g,''));return Number.isFinite(n)?n:null;
}
function round2(v){return Math.round((Number(v||0)+Number.EPSILON)*100)/100}
function round0(v){return Math.round(Number(v||0)+Number.EPSILON)}
function uniq(a){return [...new Set((a||[]).filter(Boolean))]}
function validIdentifier(v){const n=norm(v);return !!n&&!['na','n a','nil','none','0','not available'].includes(n)}
function excelDate(v){
  if(typeof v!=='number'||v<20000||v>80000)return text(v);
  const d=new Date(Date.UTC(1899,11,30)+Math.floor(v)*86400000);
  return String(d.getUTCDate()).padStart(2,'0')+'-'+String(d.getUTCMonth()+1).padStart(2,'0')+'-'+d.getUTCFullYear();
}
function daysInMonth(month){
  const m=/^(\d{4})-(\d{2})$/.exec(text(month));
  return m?new Date(Date.UTC(+m[1],+m[2],0)).getUTCDate():31;
}
function monthOf(value){
  const s=text(value).replace(/[_/]/g,' ');
  const names=['january','february','march','april','may','june','july','august','september','october','november','december'];
  const m=s.match(/(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[\s-]*(20\d{2}|\d{2})/i);
  if(!m)return '';
  const short={jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,sept:9,oct:10,nov:11,dec:12};
  const token=m[1].toLowerCase(),mi=names.indexOf(token)+1||short[token],year=m[2].length===2?'20'+m[2]:m[2];
  return year+'-'+String(mi).padStart(2,'0');
}
function settingsOf(input){
  const s=Object.assign({},DEFAULT_SETTINGS,input||{});
  s.month=text(s.month);s.monthDays=number(s.monthDays)||daysInMonth(s.month);
  ['maxOtHours','pfCeiling','pfEmployeeRate','pfEmployerRate','esiEmployeeRate','esiEmployerRate'].forEach(k=>{const n=number(s[k]);s[k]=n===null?DEFAULT_SETTINGS[k]:n});
  return s;
}
function aliases(){return Array.prototype.slice.call(arguments).map(norm)}
function columnIndex(headers,list){
  const h=headers.map(norm),a=list.map(norm);
  for(const x of a){const i=h.indexOf(x);if(i>=0)return i}
  return -1;
}
const CODE_ALIASES=aliases('code','emp code','employee code','employee id','emp id','card no','employee no');
const NAME_ALIASES=aliases('name','emp name','employee name','name of employee','employee');
const AMOUNT_ALIASES=aliases('manual amount','manual amt','amount','total','salary amount','mam amount','net amount');

function mamHeader(rows){
  for(let i=0;i<Math.min(30,rows.length);i++){
    const h=(rows[i]||[]).map(norm),ci=h.findIndex(x=>CODE_ALIASES.includes(x)),ai=h.findIndex(x=>AMOUNT_ALIASES.includes(x));
    if(ci>=0&&ai>=0)return i;
  }
  return -1;
}
function parseMam(rows,sheet,file){
  rows=Array.isArray(rows)?rows:[];sheet=text(sheet)||'Sheet1';file=text(file)||'Mam workbook';
  let hi=mamHeader(rows),ci=-1,ni=-1,ai=-1,category=sheet;
  if(hi>=0){
    const h=rows[hi]||[];ci=columnIndex(h,CODE_ALIASES);ni=columnIndex(h,NAME_ALIASES);ai=columnIndex(h,AMOUNT_ALIASES);
    if(ni<0)ni=ci+1;
    const nh=text(h[ni]);if(nh&&!NAME_ALIASES.includes(norm(nh)))category=nh;
  }
  const out=[];
  for(let r=hi>=0?hi+1:0;r<rows.length;r++){
    const a=rows[r]||[];
    if(hi<0){
      let found=false;
      for(let start=0;start<Math.min(4,Math.max(0,a.length-2));start++){
        if(text(a[start+1])&&number(a[start+2])!==null){ci=start;ni=start+1;ai=start+2;found=true;break}
      }
      if(!found)continue;
    }
    if(CODE_ALIASES.includes(norm(a[ci]))){
      const nextCategory=text(a[ni]);if(nextCategory&&!NAME_ALIASES.includes(norm(nextCategory)))category=nextCategory;
      continue;
    }
    const id=cleanCode(a[ci]),name=text(a[ni]),amount=number(a[ai]);
    if(!id&&!name)continue;
    if(/^(total|grand total|amount)$/i.test(name))continue;
    if(!id&&/^(total|grand total)$/i.test(text(a[ci])))continue;
    out.push({
      code:id,name,amount:amount===null?null:round2(amount),category,
      source:file+' / '+sheet+' / row '+(r+1),sourceRow:r+1
    });
  }
  return out;
}

const REF_ALIASES={
  empId:aliases('employee id','emp code','employee code','code'),
  name:aliases('name of employee','employee name','emp name','name'),
  father:aliases('fathers name','father name','father s name'),
  dob:aliases('d o b','dob','date of birth'),
  doj:aliases('d o j','doj','date of joining'),
  pfNo:aliases('pf no','pf number','uan','uan no'),
  esiNo:aliases('esi no','esic no','esi number','ip no'),
  gender:aliases('gender','sex'),department:aliases('department','dept'),
  designation:aliases('designation','desig'),
  category:aliases('catgrory 01','category 01','category','cat 1'),
  basic:aliases('basic','basic salary'),gross:aliases('gross total salary','gross salary','gross'),
  paidDays:aliases('paid days','working days'),overtimeHours:aliases('over time hours','overtime hours','ot hours'),
  totalGross:aliases('total gross salary','gross earned salary'),manualAmount:aliases('manual amount','mam amount'),
  diffAmount:aliases('diff amount','difference amount'),pfEmployee:aliases('pf 12','pf employee'),
  esiEmployee:aliases('esic 0 75','esi 0 75','esic employee','esi employee'),
  advance:aliases('advance deduction','advance'),totalDeduction:aliases('total deduction'),
  netPayable:aliases('net payable','net paid'),remarks:aliases('remarks','remark')
};
function referenceHeader(rows){
  for(let i=0;i<Math.min(30,rows.length);i++){
    const h=rows[i]||[];
    if(columnIndex(h,REF_ALIASES.empId)>=0&&columnIndex(h,REF_ALIASES.name)>=0&&columnIndex(h,REF_ALIASES.manualAmount)>=0&&columnIndex(h,REF_ALIASES.paidDays)>=0)return i;
  }
  return -1;
}
function parseReference(rows,sheet,file){
  rows=Array.isArray(rows)?rows:[];sheet=text(sheet)||'Main Sheet';file=text(file)||'Consultant workbook';
  const hi=referenceHeader(rows);if(hi<0)throw Error('Consultant Main Sheet ke required headers nahi mile.');
  const header=rows[hi]||[],ix={};Object.keys(REF_ALIASES).forEach(k=>ix[k]=columnIndex(header,REF_ALIASES[k]));
  const out=[];
  for(let r=hi+1;r<rows.length;r++){
    const a=rows[r]||[],name=text(a[ix.name]),id=cleanCode(a[ix.empId]);
    if(!name||/^(total|grand total)$/i.test(name))continue;
    const get=k=>ix[k]<0?null:a[ix[k]];
    out.push({
      empId:id,name,father:text(get('father')),dob:excelDate(get('dob')),doj:excelDate(get('doj')),
      pfNo:cleanCode(get('pfNo')),esiNo:cleanCode(get('esiNo')),gender:text(get('gender')),
      department:text(get('department')),designation:text(get('designation')),category:text(get('category')),
      basic:number(get('basic')),gross:number(get('gross')),paidDays:number(get('paidDays')),
      overtimeHours:number(get('overtimeHours')),totalGross:number(get('totalGross')),
      manualAmount:number(get('manualAmount')),diffAmount:number(get('diffAmount')),
      pfEmployee:number(get('pfEmployee')),esiEmployee:number(get('esiEmployee')),advance:number(get('advance')),
      totalDeduction:number(get('totalDeduction')),netPayable:number(get('netPayable')),remarks:text(get('remarks')),
      source:file+' / '+sheet+' / row '+(r+1),sourceRow:r+1
    });
  }
  const month=monthOf(rows.slice(0,hi).flat().join(' '))||monthOf(file);
  return {rows:out,month,monthDays:daysInMonth(month),sheet,file};
}

function knownBonusMonthly(mode,basic,gross,custom){
  if(number(custom)!==null)return Number(custom);
  if(mode==='BASIC_833')return Number(basic||0)*0.0833;
  if(mode==='GROSS_10')return Number(gross||0)*0.10;
  if(mode==='CUSTOM')return Number(custom||0);
  return 0;
}
function calculateGross(values,settings){
  const s=settingsOf(settings),days=Math.max(0,Number(values.paidDays||0)),ot=Math.max(0,Number(values.overtimeHours||0));
  const gross=Number(values.gross||0),bonus=knownBonusMonthly(values.bonusMode,values.basic,values.gross,values.bonusMonthly);
  return round0((gross+bonus)*days/s.monthDays+(gross/104)*ot);
}
function inferBonus(row,monthDays){
  const days=Number(row.paidDays||0),gross=Number(row.gross||0),basic=Number(row.basic||0),ot=Number(row.overtimeHours||0),total=number(row.totalGross);
  if(!days||!gross||total===null)return {bonusMode:'NONE',bonusMonthly:0};
  const custom=(total-gross*days/monthDays-(gross/104)*ot)*monthDays/days;
  const choices=[
    {bonusMode:'NONE',bonusMonthly:0},
    {bonusMode:'BASIC_833',bonusMonthly:basic*0.0833},
    {bonusMode:'GROSS_10',bonusMonthly:gross*0.10}
  ].map(x=>Object.assign(x,{gap:Math.abs(x.bonusMonthly-custom)})).sort((a,b)=>a.gap-b.gap);
  const tolerance=Math.max(2,Math.abs(custom)*0.015);
  return choices[0].gap<=tolerance?{bonusMode:choices[0].bonusMode,bonusMonthly:round2(custom)}:{bonusMode:'CUSTOM',bonusMonthly:round2(custom)};
}
function learnProfile(row,settings){
  const s=settingsOf(settings),bonus=inferBonus(row,s.monthDays),basicEarned=Number(row.basic||0)*Number(row.paidDays||0)/s.monthDays;
  const pf=Number(row.pfEmployee||0),pfCap=round0(Math.min(basicEarned,s.pfCeiling)*s.pfEmployeeRate),pfFull=round0(basicEarned*s.pfEmployeeRate);
  let pfMode='NONE',pfCustomRate=s.pfEmployeeRate;
  if(pf>0){
    if(Math.abs(pf-pfCap)<=1)pfMode='CAP';
    else if(Math.abs(pf-pfFull)<=1)pfMode='FULL';
    else {pfMode='CUSTOM';pfCustomRate=basicEarned?pf/basicEarned:s.pfEmployeeRate}
  }
  const esiMode=Number(row.esiEmployee||0)>0?'BASIC':'NONE';
  const normalNet=round0(Number(row.totalGross||0)-Number(row.pfEmployee||0)-Number(row.esiEmployee||0)-Number(row.advance||0));
  return {
    empId:row.empId,name:row.name,father:row.father,dob:row.dob,doj:row.doj,pfNo:row.pfNo,esiNo:row.esiNo,
    gender:row.gender,department:row.department,designation:row.designation,category:row.category,
    basic:row.basic,gross:row.gross,paidDays:row.paidDays||0,overtimeHours:row.overtimeHours||0,
    manualAmount:row.manualAmount,totalGross:row.totalGross,advance:row.advance||0,remarks:row.remarks,
    bonusMode:bonus.bonusMode,bonusMonthly:bonus.bonusMonthly,pfMode,pfCustomRate,esiMode,
    paymentHold:Number(row.netPayable||0)===0&&normalNet>1,
    source:row.source
  };
}
function buildProfileSet(reference,settings){
  const ref=Array.isArray(reference)?{rows:reference}:reference||{rows:[]};
  const s=settingsOf(Object.assign({},settings||{},{month:ref.month||settings&&settings.month,monthDays:ref.monthDays||settings&&settings.monthDays}));
  const byCode={},byName={},byNameCategory={},nameCounts={},compositeCounts={},duplicateCodes=[];
  (ref.rows||[]).forEach(r=>{const nk=nameKey(r.name);if(nk)nameCounts[nk]=(nameCounts[nk]||0)+1});
  (ref.rows||[]).forEach(r=>{const ck=nameKey(r.name)+'|'+norm(r.category);if(nameKey(r.name))compositeCounts[ck]=(compositeCounts[ck]||0)+1});
  (ref.rows||[]).forEach(r=>{
    const p=learnProfile(r,s),ck=codeKey(p.empId),nk=nameKey(p.name),composite=nk+'|'+norm(p.category);
    if(ck){if(byCode[ck])duplicateCodes.push(p.empId);else byCode[ck]=p}
    if(nk&&nameCounts[nk]===1)byName[nk]=p;
    if(nk&&compositeCounts[composite]===1)byNameCategory[composite]=p;
  });
  return {version:2,createdAt:new Date().toISOString(),month:ref.month||s.month,monthDays:s.monthDays,sourceFile:ref.file||'',byCode,byName,byNameCategory,duplicateCodes:uniq(duplicateCodes),count:Object.keys(byCode).length};
}

function indexEmployees(employees){
  const byCode={},byName={},nameCounts={};
  (employees||[]).forEach(e=>{const nk=nameKey(e.name);if(nk)nameCounts[nk]=(nameCounts[nk]||0)+1});
  (employees||[]).forEach(e=>{
    const ck=codeKey(e.emp_id||e.employee_id||e.code),nk=nameKey(e.name);
    if(ck&&!byCode[ck])byCode[ck]=e;
    if(nk&&nameCounts[nk]===1)byName[nk]=e;
  });
  return {byCode,byName,count:Object.keys(byCode).length};
}
function addOnce(a,message){if(message&&!a.includes(message))a.push(message)}
function findBestBreakup(target,values,settings){
  const s=settingsOf(settings),wanted=number(target);
  if(wanted===null)return {paidDays:0,overtimeHours:0,totalGross:0,gap:null,derived:true};
  const priorDays=Math.max(0,Math.min(s.monthDays,round0(values.paidDays||0))),priorOt=Math.max(0,Math.min(s.maxOtHours,round0(values.overtimeHours||0)));
  const priorGross=calculateGross(Object.assign({},values,{paidDays:priorDays,overtimeHours:priorOt}),s);
  const referenceManual=number(values.referenceManualAmount);
  if(referenceManual!==null&&Math.abs(wanted-referenceManual)<=1)return {paidDays:priorDays,overtimeHours:priorOt,totalGross:priorGross,gap:round2(wanted-priorGross),derived:true,reusedReference:true};
  if(priorGross<=wanted&&Math.abs(wanted-priorGross)<=Math.max(2,wanted*0.001))return {paidDays:priorDays,overtimeHours:priorOt,totalGross:priorGross,gap:round2(wanted-priorGross),derived:true};
  let best=null;
  for(let d=0;d<=s.monthDays;d++)for(let ot=0;ot<=s.maxOtHours;ot++){
    const total=calculateGross(Object.assign({},values,{paidDays:d,overtimeHours:ot}),s),gap=wanted-total;
    if(gap<0)continue;
    const score=gap*10000+Math.abs(d-priorDays)*10+Math.abs(ot-priorOt);
    if(!best||score<best.score)best={paidDays:d,overtimeHours:ot,totalGross:total,gap:round2(gap),score};
  }
  if(!best){
    const total=calculateGross(Object.assign({},values,{paidDays:0,overtimeHours:0}),s);
    best={paidDays:0,overtimeHours:0,totalGross:total,gap:round2(wanted-total),score:0};
  }
  return {paidDays:best.paidDays,overtimeHours:best.overtimeHours,totalGross:best.totalGross,gap:best.gap,derived:true};
}
function pfWages(row,settings){
  const s=settingsOf(settings),earned=Number(row.basic||0)*Number(row.paidDays||0)/s.monthDays;
  return row.pfMode==='CAP'?Math.min(earned,s.pfCeiling):row.pfMode==='NONE'?0:earned;
}
function esiWages(row,settings){
  const s=settingsOf(settings);return row.esiMode==='NONE'?0:Number(row.basic||0)*Number(row.paidDays||0)/s.monthDays;
}
function recalculateRow(row,settings){
  const s=settingsOf(settings);row.issues=Array.isArray(row.baseIssues)?row.baseIssues.slice():[];row.warnings=Array.isArray(row.baseWarnings)?row.baseWarnings.slice():[];
  row.paidDays=Math.max(0,number(row.paidDays)||0);row.overtimeHours=Math.max(0,number(row.overtimeHours)||0);
  row.basic=Math.max(0,number(row.basic)||0);row.gross=Math.max(0,number(row.gross)||0);row.manualAmount=number(row.manualAmount);
  row.advance=Math.max(0,number(row.advance)||0);
  if(row.paidDays>s.monthDays)addOnce(row.issues,'Paid days month days se zyada hai');
  if(row.overtimeHours>s.maxOtHours)addOnce(row.warnings,'OT learned reference range se zyada hai');
  row.totalGross=calculateGross(row,s);row.diffAmount=row.manualAmount===null?null:round2(row.manualAmount-row.totalGross);
  const pw=pfWages(row,s),ew=esiWages(row,s);
  const pfRate=row.pfMode==='CUSTOM'?Number(row.pfCustomRate||s.pfEmployeeRate):s.pfEmployeeRate;
  row.pfEmployee=row.pfMode==='NONE'?0:round0(pw*pfRate);
  row.esiEmployee=row.esiMode==='NONE'?0:round0(ew*s.esiEmployeeRate);
  row.totalDeduction=round0(row.pfEmployee+row.esiEmployee+row.advance);
  row.netPayable=row.paymentHold?0:round0(row.totalGross-row.totalDeduction);
  if(row.manualAmount===null)addOnce(row.issues,'Manual Amount missing / invalid');
  if(!row.empId)addOnce(row.issues,'Employee Code missing');
  if(!row.name)addOnce(row.issues,'Employee Name missing');
  if(!row.basic||!row.gross)addOnce(row.issues,'Basic / Gross salary missing');
  if(row.diffAmount!==null&&row.diffAmount<0)addOnce(row.warnings,'Generated gross Manual Amount se zyada hai');
  if(row.paymentHold)addOnce(row.warnings,'Payment hold learned from consultant remarks/net');
  row.status=row.issues.length?'REVIEW':'READY';return row;
}
function generateRows(mamRows,employees,profileSet,settings){
  const s=settingsOf(settings),profiles=profileSet||{byCode:{},byName:{}},master=indexEmployees(employees),counts={};
  const original=mamRows||[],groups={};original.forEach(m=>{const k=codeKey(m.code);if(k)(groups[k]||(groups[k]=[])).push(m)});
  const selected=[];
  original.forEach(m=>{
    const k=codeKey(m.code),group=k?groups[k]:null;
    if(!group||group.length===1){selected.push(m);return}
    if(group[0]!==m)return;
    const p=(profiles.byCode||{})[k];
    if(!p){group.forEach(x=>selected.push(Object.assign({},x,{_unresolvedDuplicate:true,_duplicateGroup:group})));return}
    const target=number(p.manualAmount),choice=group.slice().sort((a,b)=>{
      if(target!==null)return Math.abs(Number(a.amount||0)-target)-Math.abs(Number(b.amount||0)-target);
      return Number(b.amount||0)-Number(a.amount||0);
    })[0];
    selected.push(Object.assign({},choice,{_duplicateGroup:group,_duplicateResolved:true}));
  });
  selected.forEach(m=>{const k=codeKey(m.code);if(k)counts[k]=(counts[k]||0)+1});
  return selected.map((m,i)=>{
    const inputKey=codeKey(m.code),composite=nameKey(m.name)+'|'+norm(m.category),profile=inputKey?(profiles.byCode||{})[inputKey]:((profiles.byNameCategory||{})[composite]||(profiles.byName||{})[nameKey(m.name)]||null);
    const resolvedKey=inputKey||codeKey(profile&&profile.empId),emp=resolvedKey?master.byCode[resolvedKey]:null;
    const issues=[],warnings=[];
    if(m._unresolvedDuplicate||inputKey&&counts[inputKey]>1)addOnce(issues,'Duplicate Employee Code in Mam sheet');
    if(m._duplicateResolved)addOnce(issues,'Duplicate Mam code auto-resolved; ignored amounts: '+m._duplicateGroup.filter(x=>x.source!==m.source).map(x=>number(x.amount)).join(', '));
    if(!profile)addOnce(issues,'Consultant rule profile missing');
    if(!emp)addOnce(issues,'Employee Master record missing');
    if(!inputKey&&profile)addOnce(warnings,'Unique name se consultant code match hua');
    if(emp&&m.name&&nameKey(emp.name)!==nameKey(m.name))addOnce(warnings,'Mam name Employee Master se different hai');
    if(profile&&m.name&&nameKey(profile.name)!==nameKey(m.name))addOnce(warnings,'Mam name consultant reference se different hai');
    const personal=(key,masterKey)=>text(emp&&emp[masterKey||key])||text(profile&&profile[key]);
    const basic=number(profile&&profile.basic)!==null?number(profile.basic):number(emp&&emp.basic);
    const gross=number(profile&&profile.gross)!==null?number(profile.gross):number(emp&&emp.gross);
    if(profile&&emp&&number(emp.basic)!==null&&Math.abs(Number(profile.basic||0)-Number(emp.basic||0))>1)addOnce(warnings,'Reference Basic Employee Master se different hai');
    if(profile&&emp&&number(emp.gross)!==null&&Math.abs(Number(profile.gross||0)-Number(emp.gross||0))>1)addOnce(warnings,'Reference Gross Employee Master se different hai');
    const r={
      _index:i,empId:cleanCode(emp&&emp.emp_id)||cleanCode(profile&&profile.empId)||cleanCode(m.code),
      name:text(m.name)||personal('name'),father:personal('father'),dob:personal('dob'),doj:personal('doj'),
      pfNo:personal('pfNo','pf_no'),esiNo:personal('esiNo','esi_no'),gender:personal('gender'),
      department:personal('department','dept'),designation:personal('designation','desig'),
      category:text(profile&&profile.category)||text(emp&&(emp.cat2||emp.cat1))||text(m.category)||'OTHER',
      basic:basic||0,gross:gross||0,paidDays:Number(profile&&profile.paidDays||0),overtimeHours:Number(profile&&profile.overtimeHours||0),
      manualAmount:m.amount,referenceManualAmount:number(profile&&profile.manualAmount),advance:Number(profile&&profile.advance||0),remarks:text(profile&&profile.remarks),
      bonusMode:text(profile&&profile.bonusMode)||'BASIC_833',bonusMonthly:profile?Number(profile.bonusMonthly||0):Number(basic||0)*0.0833,
      pfMode:text(profile&&profile.pfMode)||(validIdentifier(personal('pfNo','pf_no'))?'CAP':'NONE'),
      pfCustomRate:Number(profile&&profile.pfCustomRate||s.pfEmployeeRate),
      esiMode:text(profile&&profile.esiMode)||(validIdentifier(personal('esiNo','esi_no'))?'BASIC':'NONE'),
      paymentHold:!!(profile&&profile.paymentHold),bankName:personal('bankName','bank_name'),ifsc:personal('ifsc'),accountNo:personal('accountNo','account_no'),
      source:m.source,masterMatched:!!emp,profileMatched:!!profile,baseIssues:issues,baseWarnings:warnings
    };
    if(!r.bankName||!r.ifsc||!r.accountNo)addOnce(r.baseWarnings,'Bank details incomplete in Employee Master');
    const fit=findBestBreakup(r.manualAmount,r,s);r.paidDays=fit.paidDays;r.overtimeHours=fit.overtimeHours;
    addOnce(r.baseWarnings,'Paid Days / OT Manual Amount se auto-derived; attendance se verify karein');
    return recalculateRow(r,s);
  });
}

function mainValues(row,i){return [
  i+1,text(row.empId),row.name,row.father,row.dob,row.doj,row.pfNo,row.esiNo,row.gender,row.department,row.designation,row.category,
  row.basic,row.gross,row.paidDays,row.overtimeHours,row.totalGross,row.manualAmount,row.diffAmount,row.pfEmployee,row.esiEmployee,
  row.advance,row.totalDeduction,row.netPayable,row.remarks
]}
function categoryValues(row,i){return [i+1,text(row.empId),row.name,row.category,row.totalGross,row.manualAmount,row.diffAmount,row.pfEmployee,row.esiEmployee,row.advance,row.totalDeduction,row.netPayable,row.remarks]}
function safeSheetName(value,used){
  let base=text(value).replace(/[\\/?*\[\]:]/g,' ').replace(/\s+/g,' ').trim().slice(0,31)||'OTHER',name=base,n=2;
  while(used.has(name.toLowerCase())){const suffix=' '+n++;name=base.slice(0,31-suffix.length)+suffix}
  used.add(name.toLowerCase());return name;
}
function buildExportModel(rows,settings,meta){
  const s=settingsOf(settings),m=meta||{},sheets=[],used=new Set();
  const title='Salary Sheet Month of '+(s.month||'Selected Month');
  const main=[Array(MAIN_HEADERS.length).fill(''),Array(MAIN_HEADERS.length).fill(''),MAIN_HEADERS.slice()];main[0][0]=title;
  rows.forEach((r,i)=>main.push(mainValues(r,i)));
  const total=Array(MAIN_HEADERS.length).fill('');total[2]='TOTAL';[12,13,16,17,18,19,20,21,22,23].forEach(c=>total[c]=round2(rows.reduce((sum,r)=>sum+(number(mainValues(r,0)[c])||0),0)));main.push(total);
  sheets.push({name:safeSheetName('Main Sheet',used),rows:main,headerRow:2,mergeTitle:true});
  const groups={};rows.forEach(r=>{const k=text(r.category)||'OTHER';(groups[k]||(groups[k]=[])).push(r)});
  Object.keys(groups).sort().forEach(category=>{
    const data=[CATEGORY_HEADERS.slice()];groups[category].forEach((r,i)=>data.push(categoryValues(r,i)));
    const t=Array(CATEGORY_HEADERS.length).fill('');t[2]='TOTAL';[4,5,6,7,8,9,10,11].forEach(c=>t[c]=round2(groups[category].reduce((sum,r)=>sum+(number(categoryValues(r,0)[c])||0),0)));data.push(t);
    sheets.push({name:safeSheetName(category,used),rows:data,headerRow:0});
  });
  sheets.push({name:safeSheetName('BANK DETAILS',used),headerRow:0,rows:[
    ['S.No.','Employee ID','Employee Name','Bank Name','IFSC Code','Account Number','Net Payable','Payment Status','Review'],
    ...rows.map((r,i)=>[i+1,text(r.empId),r.name,r.bankName,r.ifsc,text(r.accountNo),r.netPayable,r.paymentHold?'HOLD':r.status,uniq(r.issues.concat(r.warnings)).join('; ')])
  ]});
  sheets.push({name:safeSheetName('STATUTORY SUMMARY',used),headerRow:0,rows:[
    ['S.No.','Employee ID','Employee Name','PF Wages','PF Employee','PF Employer','ESI Wages','ESI Employee','ESI Employer','Employer Contribution Total','Rule Status'],
    ...rows.map((r,i)=>{const pw=pfWages(r,s),ew=esiWages(r,s),pe=r.pfEmployee,per=r.pfMode==='NONE'?0:round0(pw*s.pfEmployerRate),ee=r.esiEmployee,eer=r.esiMode==='NONE'?0:round0(ew*s.esiEmployerRate);return [i+1,text(r.empId),r.name,round2(pw),pe,per,round2(ew),ee,eer,per+eer,r.status]})
  ]});
  sheets.push({name:safeSheetName('REVIEW',used),headerRow:0,rows:[
    ['S.No.','Employee ID','Employee Name','Status','Blocking checks','Warnings','Mam Source'],
    ...rows.filter(r=>r.issues.length||r.warnings.length).map((r,i)=>[i+1,text(r.empId),r.name,r.status,r.issues.join('; '),r.warnings.join('; '),r.source])
  ]});
  sheets.push({name:safeSheetName('REPORT NOTES',used),headerRow:0,rows:[
    ['Item','Detail'],['Payroll month',s.month],['Mam source file',m.mamFile||''],['Mam source sheet',m.mamSheet||''],
    ['Consultant rule profile',m.profileSource||'Saved browser profile / defaults'],['Employee Master records',m.masterCount||0],
    ['Calculation basis','Paid Days and OT are reverse-calculated from Manual Amount using the learned consultant pattern. They are derived values, not attendance evidence.'],
    ['Salary data','Personal and bank data prefer Employee Master. Consultant reference is used as fallback and for employee-specific calculation profiles.'],
    ['PF / ESIC','Rates and bases mirror the imported consultant workbook/settings. Employer figures are a planning summary and require payroll/consultant review.'],
    ['Editing','This workbook contains the latest values visible in the software grid at download time.'],
    ['Review','Rows marked REVIEW or HOLD must be checked before payment or statutory filing.']
  ]});
  return {sheets,settings:s};
}
function makeWorkbook(XLSX,rows,settings,meta){
  const model=buildExportModel(rows,settings,meta),wb=XLSX.utils.book_new();
  model.sheets.forEach(sh=>{
    const ws=XLSX.utils.aoa_to_sheet(sh.rows),maxCols=Math.max(1,...sh.rows.map(r=>r.length));
    if(sh.mergeTitle)ws['!merges']=[{s:{r:0,c:0},e:{r:0,c:maxCols-1}}];
    ws['!cols']=Array.from({length:maxCols},(_,c)=>({wch:c===2?28:c===0?8:[3,4,5,6,7,8,9,10,11,12,24].includes(c)?18:15}));
    if(sh.rows.length>sh.headerRow+1)ws['!autofilter']={ref:XLSX.utils.encode_range({r:sh.headerRow,c:0},{r:sh.rows.length-1,c:maxCols-1})};
    Object.keys(ws).filter(k=>!k.startsWith('!')).forEach(k=>{
      const cell=ws[k],pos=XLSX.utils.decode_cell(k);
      if(cell.t==='n')cell.z='#,##0.00';
      if(pos.c===1||/^(PF NO|ESI NO|IFSC Code|Account Number)$/.test(text(sh.rows[sh.headerRow]&&sh.rows[sh.headerRow][pos.c])))cell.z='@';
    });
    XLSX.utils.book_append_sheet(wb,ws,sh.name);
  });
  wb.Props={Title:'ATPL Mam Compliance Salary',Subject:'Editable compliance salary workbook',Author:'Arora Textiles HR Software',CreatedDate:new Date()};
  return wb;
}

const API={
  MAIN_HEADERS,CATEGORY_HEADERS,DEFAULT_SETTINGS,PROFILE_KEY,norm,nameKey,cleanCode,codeKey,number,daysInMonth,monthOf,
  mamHeader,parseMam,referenceHeader,parseReference,settingsOf,calculateGross,inferBonus,learnProfile,buildProfileSet,
  indexEmployees,findBestBreakup,pfWages,esiWages,recalculateRow,generateRows,mainValues,categoryValues,buildExportModel,makeWorkbook
};
if(typeof module!=='undefined'&&module.exports){module.exports=API;return}
if(root.__MAM_SALARY_GENERATOR__)return;root.__MAM_SALARY_GENERATOR__=API;

const $=id=>document.getElementById(id);
const esc=v=>String(v===null||v===undefined?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const todayMonth=()=>new Date().toISOString().slice(0,7);
const UI={
  settings:settingsOf({month:todayMonth(),monthDays:daysInMonth(todayMonth())}),
  profiles:null,mamSheets:[],mamRows:[],rows:[],employees:[],mamFile:'',mamSheet:'',
  page:0,pageSize:40,filter:'all',search:'',message:'',messageError:false
};

function loadProfiles(){
  try{
    const p=JSON.parse(localStorage.getItem(PROFILE_KEY)||'null');
    if(p&&p.version===2&&p.byCode&&p.byName&&p.byNameCategory)return p;
  }catch(e){}
  return {version:2,byCode:{},byName:{},byNameCategory:{},count:0,duplicateCodes:[]};
}
function employeeMaster(){
  const sources=[];
  try{const saved=JSON.parse(localStorage.getItem('AroraTextilesEmployeeMasterV3')||'null');if(Array.isArray(saved))sources.push(saved)}catch(e){}
  try{if(root.EM&&Array.isArray(root.EM.data))sources.push(root.EM.data)}catch(e){}
  try{if(Array.isArray(root.EMP_MASTER_DATA))sources.push(root.EMP_MASTER_DATA)}catch(e){}
  const seen={},out=[];
  sources.forEach(list=>list.forEach(emp=>{const k=codeKey(emp&&emp.emp_id);if(k&&!seen[k]){seen[k]=1;out.push(emp)}}));
  return out;
}
function setMessage(message,error){
  UI.message=message;UI.messageError=!!error;
  const el=$('mcgNotice');if(el){el.textContent=message;el.className=error?'mcg-error':''}
}
function readSheets(file){
  return file.arrayBuffer().then(buffer=>{
    const wb=root.XLSX.read(buffer,{type:'array',cellDates:false,cellNF:false,cellText:true});
    return wb.SheetNames.map(name=>{
      const ws=wb.Sheets[name],rows=root.XLSX.utils.sheet_to_json(ws,{header:1,raw:true,defval:null,blankrows:false});
      Object.keys(ws).filter(k=>k[0]!=='!'&&ws[k]).forEach(k=>{
        const cell=ws[k],c=root.XLSX.utils.decode_cell(k);if(!rows[c.r])rows[c.r]=[];
        if(cell.t==='e')rows[c.r][c.c]=cell.w||'#ERROR';
        else if(cell.t==='n'&&/^0\d+$/.test(text(cell.w))&&text(cell.w).length>text(cell.v).length)rows[c.r][c.c]=text(cell.w);
      });
      return {name,rows};
    });
  });
}
function updateSourceSelect(){
  const select=$('mcgSheet');if(!select)return;
  select.innerHTML=UI.mamSheets.length?UI.mamSheets.map(s=>'<option value="'+esc(s.name)+'">'+esc(s.name)+' ('+s.parsed.length+' rows)</option>').join(''):'<option value="">Upload Mam file</option>';
  if(UI.mamSheet)select.value=UI.mamSheet;
}
function rebuild(){
  UI.employees=employeeMaster();
  UI.settings.monthDays=daysInMonth(UI.settings.month);
  UI.rows=generateRows(UI.mamRows,UI.employees,UI.profiles,UI.settings);UI.page=0;render();
}
async function importMam(file){
  if(!file)return;setMessage('Mam Excel read ho rahi hai…');
  try{
    const sheets=await readSheets(file);
    UI.mamSheets=sheets.map(s=>Object.assign({},s,{parsed:parseMam(s.rows,s.name,file.name)})).filter(s=>s.parsed.length);
    if(!UI.mamSheets.length)throw Error('Mam rows nahi mili. Columns: Employee Code, Employee Name, Manual Amount rakhein.');
    const primary=UI.mamSheets.find(s=>/^sheet\s*1$/i.test(s.name))||UI.mamSheets.reduce((a,b)=>a.parsed.length>=b.parsed.length?a:b);
    UI.mamFile=file.name;UI.mamSheet=primary.name;UI.mamRows=primary.parsed;
    const fm=monthOf(file.name);if(fm){UI.settings.month=fm;$('mcgMonth').value=fm}
    updateSourceSelect();rebuild();
    const review=UI.rows.filter(r=>r.issues.length).length;
    setMessage(file.name+': '+UI.rows.length+' employees generated. '+review+' rows Review me hain. Grid edit karke Download Excel karein.',false);
  }catch(e){setMessage(e.message||String(e),true)}finally{if($('mcgMamFile'))$('mcgMamFile').value=''}
}
async function importReference(file){
  if(!file)return;setMessage('Consultant file se employee-wise rules seekh raha hai…');
  try{
    const sheets=await readSheets(file),main=sheets.find(s=>norm(s.name)==='main sheet'&&referenceHeader(s.rows)>=0)||sheets.find(s=>referenceHeader(s.rows)>=0);
    if(!main)throw Error('Consultant workbook me valid Main Sheet nahi mili.');
    const ref=parseReference(main.rows,main.name,file.name);
    if(!ref.rows.length)throw Error('Consultant Main Sheet me employee rows nahi mili.');
    const refSettings=settingsOf(Object.assign({},UI.settings,{month:ref.month||UI.settings.month,monthDays:ref.monthDays||UI.settings.monthDays}));
    UI.profiles=buildProfileSet(ref,refSettings);
    let stored=true;try{localStorage.setItem(PROFILE_KEY,JSON.stringify(UI.profiles))}catch(e){stored=false}
    if(ref.month){UI.settings.month=ref.month;UI.settings.monthDays=ref.monthDays;$('mcgMonth').value=ref.month}
    rebuild();
    setMessage(UI.profiles.count+' consultant employee profiles learned'+(stored?' aur is browser me save ho gaye.':' (browser save unavailable; page close karne se pehle kaam finish karein).'),!stored);
  }catch(e){setMessage(e.message||String(e),true)}finally{if($('mcgRefFile'))$('mcgRefFile').value=''}
}
function filteredRows(){
  const q=norm(UI.search);
  return UI.rows.filter(r=>{
    const matchesFilter=UI.filter==='all'||(UI.filter==='review'&&r.issues.length)||(UI.filter==='warning'&&!r.issues.length&&r.warnings.length)||(UI.filter==='ready'&&!r.issues.length);
    return matchesFilter&&(!q||norm([r.empId,r.name,r.category,r.department,r.status,r.issues.join(' '),r.warnings.join(' ')].join(' ')).includes(q));
  });
}
function money(v){return number(v)===null?'—':Number(v).toLocaleString('en-IN',{maximumFractionDigits:2})}
const GRID_COLUMNS=[
  {label:'S.No.',key:'serial',width:'56px'},
  {label:'Employee ID',key:'empId',edit:'text',width:'105px'},
  {label:'Name of employee',key:'name',edit:'text',width:'210px'},
  {label:'Fathers Name',key:'father',edit:'text',width:'170px'},
  {label:'D.O.B',key:'dob',edit:'text',width:'115px'},
  {label:'D-O-J',key:'doj',edit:'text',width:'115px'},
  {label:'PF NO',key:'pfNo',edit:'text',width:'135px'},
  {label:'ESI NO',key:'esiNo',edit:'text',width:'125px'},
  {label:'Gender',key:'gender',edit:'text',width:'95px'},
  {label:'Department',key:'department',edit:'text',width:'150px'},
  {label:'Designation',key:'designation',edit:'text',width:'150px'},
  {label:'Catgrory 01',key:'category',edit:'text',width:'155px'},
  {label:'Basic',key:'basic',edit:'number',money:true,width:'110px'},
  {label:'Gross Total Salary',key:'gross',edit:'number',money:true,width:'125px'},
  {label:'Paid Days',key:'paidDays',edit:'number',width:'90px'},
  {label:'Over Time Hours',key:'overtimeHours',edit:'number',width:'95px'},
  {label:'Total Gross salary',key:'totalGross',money:true,width:'125px'},
  {label:'Manual Amount',key:'manualAmount',edit:'number',money:true,width:'120px'},
  {label:'Diff. Amount',key:'diffAmount',money:true,width:'110px'},
  {label:'PF@12%',key:'pfEmployee',money:true,width:'95px'},
  {label:'ESIC @0.75%',key:'esiEmployee',money:true,width:'100px'},
  {label:'Advance Deduction',key:'advance',edit:'number',money:true,width:'115px'},
  {label:'Total Deduction',key:'totalDeduction',money:true,width:'115px'},
  {label:'Net Payable',key:'netPayable',money:true,width:'115px'},
  {label:'Remarks',key:'remarks',edit:'text',width:'160px'},
  {label:'Bonus Rule',key:'bonusMode',edit:'select',options:['NONE','BASIC_833','GROSS_10','CUSTOM'],width:'120px'},
  {label:'Bonus / Month',key:'bonusMonthly',edit:'number',money:true,width:'115px'},
  {label:'PF Rule',key:'pfMode',edit:'select',options:['NONE','CAP','FULL','CUSTOM'],width:'95px'},
  {label:'ESI Rule',key:'esiMode',edit:'select',options:['NONE','BASIC'],width:'95px'},
  {label:'Payment',key:'paymentHold',edit:'select',options:['PAY','HOLD'],width:'90px'},
  {label:'Bank Name',key:'bankName',edit:'text',width:'145px'},
  {label:'IFSC',key:'ifsc',edit:'text',width:'120px'},
  {label:'Account No.',key:'accountNo',edit:'text',width:'145px'},
  {label:'Review',key:'review',width:'300px'}
];
function cellHtml(row,col,serial){
  if(col.key==='serial')return '<span>'+serial+'</span>';
  if(col.key==='review'){
    const issue=row.issues.join('; '),warning=row.warnings.join('; ');
    return '<div class="mcg-review-text">'+(issue?'<b>'+esc(issue)+'</b>':'')+(warning?'<span>'+esc(warning)+'</span>':'<span>Checks clear</span>')+'</div>';
  }
  if(col.edit==='select'){
    const value=col.key==='paymentHold'?(row.paymentHold?'HOLD':'PAY'):text(row[col.key]);
    return '<select data-field="'+col.key+'">'+col.options.map(x=>'<option'+(x===value?' selected':'')+'>'+x+'</option>').join('')+'</select>';
  }
  if(col.edit){
    const value=row[col.key]===null||row[col.key]===undefined?'':row[col.key];
    return '<input data-field="'+col.key+'" type="'+col.edit+'"'+(col.edit==='number'?' step="any"':'')+' value="'+esc(value)+'">';
  }
  return '<span class="mcg-value">'+(col.money?money(row[col.key]):esc(row[col.key]))+'</span>';
}
function render(){
  if(!$('mcgTable'))return;
  const list=filteredRows(),pages=Math.max(1,Math.ceil(list.length/UI.pageSize));UI.page=Math.max(0,Math.min(UI.page,pages-1));
  const start=UI.page*UI.pageSize,shown=list.slice(start,start+UI.pageSize),review=UI.rows.filter(r=>r.issues.length).length,warn=UI.rows.filter(r=>!r.issues.length&&r.warnings.length).length;
  const stats=[
    ['Employees',UI.rows.length],['Master matched',UI.rows.filter(r=>r.masterMatched).length],['Rule matched',UI.rows.filter(r=>r.profileMatched).length],
    ['Ready',UI.rows.length-review],['Review',review],['Net Payable','₹'+money(UI.rows.reduce((sum,r)=>sum+(number(r.netPayable)||0),0))]
  ];
  $('mcgStats').innerHTML=stats.map(x=>'<div><b>'+esc(x[1])+'</b><span>'+esc(x[0])+'</span></div>').join('');
  $('mcgTable').innerHTML='<colgroup>'+GRID_COLUMNS.map(c=>'<col style="width:'+c.width+';min-width:'+c.width+'">').join('')+'</colgroup><thead><tr>'+GRID_COLUMNS.map(c=>'<th>'+esc(c.label)+'</th>').join('')+'</tr></thead><tbody>'+shown.map((r,j)=>'<tr data-index="'+r._index+'" class="'+(r.paymentHold?'mcg-hold ':r.issues.length?'mcg-review ':r.warnings.length?'mcg-warning ':'')+'">'+GRID_COLUMNS.map(c=>'<td>'+cellHtml(r,c,start+j+1)+'</td>').join('')+'</tr>').join('')+'</tbody>';
  $('mcgPageText').textContent=(list.length?start+1:0)+'–'+Math.min(start+UI.pageSize,list.length)+' of '+list.length+' · Page '+(UI.page+1)+'/'+pages;
  $('mcgPrev').disabled=UI.page===0;$('mcgNext').disabled=UI.page>=pages-1;$('mcgDownload').disabled=!UI.rows.length;
  $('mcgRuleStatus').textContent=(UI.profiles&&UI.profiles.count||0)+' learned rules · '+UI.employees.length+' Employee Master records · '+warn+' warning-only rows';
  if(UI.message)setMessage(UI.message,UI.messageError);
}
function handleGridChange(event){
  const input=event.target.closest('[data-field]'),tr=event.target.closest('tr[data-index]');if(!input||!tr)return;
  const row=UI.rows[Number(tr.dataset.index)],field=input.dataset.field;if(!row)return;
  if(field==='paymentHold')row.paymentHold=input.value==='HOLD';
  else if(input.type==='number')row[field]=number(input.value);
  else row[field]=input.value;
  if(['bonusMode','basic','gross'].includes(field)&&row.bonusMode!=='CUSTOM')row.bonusMonthly=row.bonusMode==='BASIC_833'?Number(row.basic||0)*0.0833:row.bonusMode==='GROSS_10'?Number(row.gross||0)*0.10:0;
  if(['manualAmount','basic','gross','bonusMode','bonusMonthly'].includes(field)){
    const fit=findBestBreakup(row.manualAmount,row,UI.settings);row.paidDays=fit.paidDays;row.overtimeHours=fit.overtimeHours;
  }
  recalculateRow(row,UI.settings);render();
}
function downloadExcel(){
  if(!UI.rows.length)return;
  try{
    const wb=makeWorkbook(root.XLSX,UI.rows,UI.settings,{mamFile:UI.mamFile,mamSheet:UI.mamSheet,profileSource:UI.profiles&&UI.profiles.sourceFile,masterCount:UI.employees.length});
    root.XLSX.writeFile(wb,'ATPL_Mam_Compliance_'+(UI.settings.month||'Salary')+'.xlsx',{compression:true});
    setMessage('Excel download ready: Main Sheet, category tabs, Bank Details, Statutory Summary aur Review included.',false);
  }catch(e){setMessage('Excel download nahi ho paaya: '+(e.message||e),true)}
}
function applySettings(){
  UI.settings.month=$('mcgMonth').value||UI.settings.month;
  UI.settings.monthDays=daysInMonth(UI.settings.month);
  ['pfEmployeeRate','pfEmployerRate','esiEmployeeRate','esiEmployerRate','pfCeiling','maxOtHours'].forEach(k=>{const el=$('mcg_'+k),n=el?number(el.value):null;if(n!==null)UI.settings[k]=n});
  UI.rows.forEach(row=>{const fit=findBestBreakup(row.manualAmount,row,UI.settings);row.paidDays=fit.paidDays;row.overtimeHours=fit.overtimeHours;recalculateRow(row,UI.settings)});render();
}
function checkAccessAndOpen(){
  let session=null,users=[];try{session=JSON.parse(sessionStorage.getItem('ATPL_UserSession_V5')||'null');users=JSON.parse(localStorage.getItem('ATPL_UserAccess_V1')||'[]')}catch(e){}
  const user=Array.isArray(users)&&session?users.find(x=>String(x.id).toLowerCase()===String(session.id).toLowerCase()):null;
  if(user&&!user.admin&&!(user.access||[]).includes('mamsalary'))return alert('Is feature ka access nahi diya gaya.');
  if(typeof root.goPage==='function')root.goPage('mamsalary');
}
function addPage(){
  const old=$('page-mamsalary');if(old)old.remove();
  const page=document.createElement('div');page.id='page-mamsalary';page.className='page';page.innerHTML=`
    <div class="mcg-app">
      <header class="mcg-header"><div><small>ARORA TEXTILES · COMPLIANCE WORKSPACE</small><h2>Mam → Compliance Salary</h2><p>3-column Mam sheet upload karein, full editable compliance workbook download karein.</p></div><div class="mcg-header-actions"><button id="mcgWindow">Window view</button><button id="mcgBack">Back to ERP</button></div></header>
      <section class="mcg-toolbar">
        <label>Payroll Month<input id="mcgMonth" type="month" value="${esc(UI.settings.month)}"></label>
        <label class="mcg-file primary">1. Upload Mam Sheet<input id="mcgMamFile" type="file" accept=".xlsx,.xls"></label>
        <label class="mcg-file">Learn Consultant Rules<input id="mcgRefFile" type="file" accept=".xlsx,.xls"></label>
        <label>Mam Source Sheet<select id="mcgSheet"><option value="">Upload Mam file</option></select></label>
        <button id="mcgRefresh">Refresh Employee Master</button><button id="mcgDownload" class="mcg-download" disabled>Download Excel</button>
      </section>
      <details class="mcg-settings"><summary>Calculation settings (consultant pattern)</summary><div>
        <label>PF Employee rate<input id="mcg_pfEmployeeRate" type="number" step="0.0001" value="${UI.settings.pfEmployeeRate}"></label>
        <label>PF Employer rate<input id="mcg_pfEmployerRate" type="number" step="0.0001" value="${UI.settings.pfEmployerRate}"></label>
        <label>ESI Employee rate<input id="mcg_esiEmployeeRate" type="number" step="0.0001" value="${UI.settings.esiEmployeeRate}"></label>
        <label>ESI Employer rate<input id="mcg_esiEmployerRate" type="number" step="0.0001" value="${UI.settings.esiEmployerRate}"></label>
        <label>PF ceiling<input id="mcg_pfCeiling" type="number" value="${UI.settings.pfCeiling}"></label>
        <label>Max OT hours<input id="mcg_maxOtHours" type="number" value="${UI.settings.maxOtHours}"></label>
        <button id="mcgApplySettings">Apply settings</button><button id="mcgClearRules">Clear saved consultant rules</button>
      </div></details>
      <div id="mcgNotice" role="status">Pehli baar consultant ki Main Sheet se rules learn karayein. Uske baad har month sirf Mam sheet upload karni hai.</div>
      <div id="mcgStats" class="mcg-stats"></div>
      <section class="mcg-filterbar"><label>Find employee<input id="mcgSearch" placeholder="Code, name, department, issue"></label><label>Show<select id="mcgFilter"><option value="all">All rows</option><option value="review">Review required</option><option value="warning">Warnings only</option><option value="ready">Ready rows</option></select></label><button id="mcgClearMam">Clear Mam import</button><span id="mcgRuleStatus"></span></section>
      <div class="mcg-grid"><table id="mcgTable"></table></div>
      <footer><span><i></i> Editable cell &nbsp; <em></em> Review required &nbsp; Paid Days / OT auto-derived hain—attendance verify karein.</span><div><button id="mcgPrev">Previous</button><b id="mcgPageText">0 rows</b><button id="mcgNext">Next</button></div></footer>
    </div>`;
  const anchor=$('page-sync');(anchor&&anchor.parentNode||document.body).appendChild(page);
}
function addStyle(){
  if($('mcgStyle'))return;const style=document.createElement('style');style.id='mcgStyle';style.textContent=`
    #page-mamsalary{padding:0;background:#eef3f8;color:#14263d;font:13px Inter,Arial,sans-serif}
    #page-mamsalary.active:not(.mcg-window){position:fixed!important;inset:0!important;z-index:99999!important;display:block!important;overflow:hidden!important}
    #page-mamsalary .mcg-app{height:100vh;display:flex;flex-direction:column;gap:10px;padding:14px 16px;box-sizing:border-box}
    #page-mamsalary.mcg-window .mcg-app{height:calc(100vh - 82px);min-height:560px}
    .mcg-header{display:flex;justify-content:space-between;gap:18px;align-items:center}.mcg-header h2{font-size:25px;margin:3px 0}.mcg-header p{margin:0;color:#64748b}.mcg-header small{font-size:10px;letter-spacing:1.4px;color:#087969}.mcg-header-actions{display:flex;gap:8px}
    #page-mamsalary button{border:1px solid #cbd5e1;border-radius:6px;background:white;color:#17304c;padding:9px 12px;font-weight:650;cursor:pointer}#page-mamsalary button:disabled{opacity:.4;cursor:default}
    .mcg-toolbar,.mcg-filterbar,.mcg-settings>div{display:flex;gap:10px;align-items:end;flex-wrap:wrap}.mcg-toolbar label,.mcg-filterbar label,.mcg-settings label{display:flex;flex-direction:column;gap:4px;color:#5d6d82;font-size:10px;font-weight:700}
    #page-mamsalary input,#page-mamsalary select{border:1px solid #cbd5e1;border-radius:5px;background:#fff;color:#172b45;padding:8px;box-sizing:border-box}.mcg-file{position:relative;border:1px solid #b6c5d6;background:#fff;padding:9px 12px;border-radius:6px;color:#28425f!important;cursor:pointer}.mcg-file.primary{background:#e7f5f1;border-color:#70b8aa;color:#0b6e5e!important}.mcg-file input{position:absolute;inset:0;opacity:0;cursor:pointer}.mcg-download{background:#087f6b!important;color:#fff!important;border-color:#087f6b!important}
    .mcg-settings{background:#fff;border:1px solid #d9e2ec;border-radius:7px;padding:7px 10px}.mcg-settings summary{cursor:pointer;font-weight:700;color:#456078}.mcg-settings>div{padding-top:10px}.mcg-settings input{width:110px}
    #mcgNotice{padding:9px 12px;border-radius:6px;background:#e4f2ee;color:#195d52;border-left:4px solid #31937f}#mcgNotice.mcg-error{background:#fff0e7;color:#9a3412;border-left-color:#e57437}
    .mcg-stats{display:grid;grid-template-columns:repeat(6,minmax(110px,1fr));gap:8px}.mcg-stats div{background:#fff;border:1px solid #dce5ee;border-radius:7px;padding:9px 11px;display:flex;align-items:center;gap:9px}.mcg-stats b{font-size:20px}.mcg-stats span{font-size:10px;color:#64748b}
    .mcg-filterbar{align-items:center}.mcg-filterbar #mcgRuleStatus{margin-left:auto;color:#64748b;font-size:11px}.mcg-filterbar input{width:240px}
    .mcg-grid{flex:1;min-height:170px;overflow:auto;border:1px solid #cbd8e5;border-radius:7px;background:#fff}.mcg-grid table{border-collapse:separate;border-spacing:0;table-layout:fixed;min-width:4420px;font-size:11px}.mcg-grid th,.mcg-grid td{height:39px;padding:0;border-right:1px solid #e1e8ef;border-bottom:1px solid #e1e8ef;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.mcg-grid th{position:sticky;top:0;z-index:4;background:#dfe8f1;color:#344d68;padding:8px;text-align:left;white-space:normal;height:45px}.mcg-grid td{background:#fff;text-align:right}.mcg-grid tr:nth-child(even) td{background:#f8fafc}.mcg-grid tr.mcg-review td{background:#fff4e8}.mcg-grid tr.mcg-warning td{background:#fffcf0}.mcg-grid tr.mcg-hold td{background:#fdebec}
    .mcg-grid td:nth-child(1),.mcg-grid th:nth-child(1){position:sticky;left:0;z-index:3}.mcg-grid td:nth-child(2),.mcg-grid th:nth-child(2){position:sticky;left:56px;z-index:3}.mcg-grid td:nth-child(3),.mcg-grid th:nth-child(3){position:sticky;left:161px;z-index:3;border-right:2px solid #9fb2c7}.mcg-grid th:nth-child(-n+3){z-index:6;background:#dfe8f1}.mcg-grid tr:nth-child(even) td:nth-child(-n+3){background:#f8fafc}.mcg-grid tr.mcg-review td:nth-child(-n+3){background:#fff4e8}.mcg-grid tr.mcg-warning td:nth-child(-n+3){background:#fffcf0}.mcg-grid tr.mcg-hold td:nth-child(-n+3){background:#fdebec}
    .mcg-grid input,.mcg-grid select{width:100%;height:100%;border:0!important;border-radius:0!important;padding:7px!important;background:#fff8d9!important;text-align:inherit;font:inherit}.mcg-grid input:focus,.mcg-grid select:focus{outline:2px solid #259b85;outline-offset:-2px}.mcg-grid td:nth-child(2),.mcg-grid td:nth-child(3),.mcg-grid td:nth-child(4),.mcg-grid td:nth-child(25),.mcg-grid td:nth-child(n+31){text-align:left}.mcg-value{padding:0 8px}.mcg-review-text{display:flex;flex-direction:column;gap:2px;padding:4px 8px;text-align:left;white-space:normal;line-height:1.2}.mcg-review-text b{color:#b45309;font-size:10px}.mcg-review-text span{color:#6b7280;font-size:9px}
    #page-mamsalary footer{display:flex;justify-content:space-between;align-items:center;gap:10px;color:#607086;font-size:10px}#page-mamsalary footer>div{display:flex;align-items:center;gap:9px}#page-mamsalary footer i,#page-mamsalary footer em{display:inline-block;width:12px;height:12px;border:1px solid #e4c850;background:#fff8d9;vertical-align:middle}#page-mamsalary footer em{background:#fff4e8;border-color:#e9a768}
    @media(max-width:900px){#page-mamsalary .mcg-app{padding:8px;gap:6px}.mcg-stats{grid-template-columns:repeat(3,1fr)}.mcg-header p{display:none}.mcg-header h2{font-size:20px}.mcg-filterbar #mcgRuleStatus{width:100%;margin-left:0}}
  `;document.head.appendChild(style);
}
function bind(){
  $('mcgMamFile').onchange=e=>importMam(e.target.files[0]);$('mcgRefFile').onchange=e=>importReference(e.target.files[0]);
  $('mcgSheet').onchange=e=>{const sh=UI.mamSheets.find(s=>s.name===e.target.value);if(sh){UI.mamSheet=sh.name;UI.mamRows=sh.parsed;rebuild();setMessage(sh.name+' selected: '+sh.parsed.length+' rows generated.',false)}};
  $('mcgMonth').onchange=applySettings;$('mcgApplySettings').onclick=applySettings;$('mcgRefresh').onclick=()=>{rebuild();setMessage('Latest Employee Master data reload ho gaya.',false)};
  $('mcgDownload').onclick=downloadExcel;$('mcgSearch').oninput=e=>{UI.search=e.target.value;UI.page=0;render()};$('mcgFilter').onchange=e=>{UI.filter=e.target.value;UI.page=0;render()};
  $('mcgPrev').onclick=()=>{UI.page--;render()};$('mcgNext').onclick=()=>{UI.page++;render()};$('mcgTable').onchange=handleGridChange;
  $('mcgClearMam').onclick=()=>{UI.mamSheets=[];UI.mamRows=[];UI.rows=[];UI.mamFile='';UI.mamSheet='';updateSourceSelect();render();setMessage('Mam import clear ho gaya. Saved consultant rules safe hain.',false)};
  $('mcgClearRules').onclick=()=>{if(!confirm('Saved consultant calculation rules clear karne hain? Employee Master aur baaki ERP data change nahi hoga.'))return;localStorage.removeItem(PROFILE_KEY);UI.profiles=loadProfiles();rebuild();setMessage('Saved consultant rules clear ho gaye. Dobara consultant Main Sheet upload karein.',false)};
  $('mcgBack').onclick=()=>{if(typeof root.goPage==='function')root.goPage('sync')};$('mcgWindow').onclick=()=>{const on=$('page-mamsalary').classList.toggle('mcg-window');$('mcgWindow').textContent=on?'Full screen':'Window view'};
}
function addNav(){
  const old=$('vn-mamsalary');if(old)old.remove();const nav=document.createElement('div');nav.id='vn-mamsalary';nav.className='vitem';nav.innerHTML='<span class="vi">🧾</span>Mam → Compliance';nav.onclick=checkAccessAndOpen;
  nav.setAttribute('onclick',"goPage('mamsalary')");nav.onclick=checkAccessAndOpen;
  const anchor=$('vn-sync');if(anchor)anchor.parentNode.insertBefore(nav,anchor.nextSibling);
}
function start(){
  UI.profiles=loadProfiles();UI.employees=employeeMaster();addStyle();addPage();addNav();bind();render();
  if(UI.profiles.count)setMessage(UI.profiles.count+' saved consultant rules ready hain. Ab Mam sheet upload karein.',false);
}
function boot(){
  if(root.XLSX)return start();const script=document.createElement('script');script.src='https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';script.onload=start;script.onerror=()=>console.error('Mam Compliance Generator: Excel library unavailable');document.head.appendChild(script);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})(typeof window!=='undefined'?window:globalThis);
