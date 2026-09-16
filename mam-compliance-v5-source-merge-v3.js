/* ATPL Mam Compliance source merge V3.1.
   Reuses V2 source patches, merges split monthly sheets without double-counting,
   and allows provisional salary calculations from Employee Master + Paid Days. */
(function(g){'use strict';
 function finish(done,err){try{if(typeof done==='function')done(err||null)}catch(_){}}
 function replaceBlock(code,a,b,repl){var s=code.indexOf(a),e=s<0?-1:code.indexOf(b,s);return s>=0&&e>s?code.slice(0,s)+repl+code.slice(e):code}
 function extraPatch(code){
   code=String(code||'');
   var old="if(k==='advance'&&['adv','advance amount'].includes(z))return true;\n   if(k==='totalGross'&&['total','gross total','total salary','earned total'].includes(z))return true;";
   var neu="if(k==='advance'&&['adv','adv.','advance amount'].includes(z))return true;\n   if((k==='gross'||k==='contractGross')&&['salary','monthly salary','salry'].includes(z))return true;\n   if(k==='totalGross'&&['total','total 1','gross total','total salary','earned total','total amt','total amount'].includes(z))return true;";
   if(code.indexOf(old)>=0)code=code.replace(old,neu);

   var repl=`function mergeMonthlyRows_(rows,file){
 const by={},order=[],seen={};
 function nmerge(a,b){a=num(a);b=num(b);if(a===null)return b;if(b===null)return a;if(Math.abs(a-b)<0.01)return a;return Math.max(a,b);}
 function first(a,b){return text(a)!==''?a:b;}
 (rows||[]).forEach(r=>{const k=codeKey(r.empCode);if(!k)return;const fp=[k,norm(r.empName),num(r.paidDays),num(r.totalGross),num(r.baseEarned),num(r.advance),num(r.otHours),num(r.otAmount)].join('|');if(seen[fp])return;seen[fp]=1;
  if(!by[k]){by[k]=Object.assign({},r,{source:Object.assign({},r.source,{type:'MONTHLY_MERGED',file:file,sheets:[r.source&&r.source.sheet].filter(Boolean),rows:[r.source&&r.source.row].filter(Boolean)})});order.push(k);return;}
  const x=by[k];x.empName=first(x.empName,r.empName);x.paidDays=nmerge(x.paidDays,r.paidDays);x.workingDays=nmerge(x.workingDays,r.workingDays);x.otHours=nmerge(x.otHours,r.otHours);x.otAmount=nmerge(x.otAmount,r.otAmount);x.totalGross=nmerge(x.totalGross,r.totalGross);x.baseEarned=nmerge(x.baseEarned,r.baseEarned);x.otherDeduction=nmerge(x.otherDeduction,r.otherDeduction);
  const av=[num(x.advance),num(r.advance)].filter(v=>v!==null);x.advance=av.length?Math.max.apply(Math,av):null;
  ['otRate','otApproval','deductionApproval','pfStatus','pfWage','higherPf','higherPfEvidence','esiStatus','esiWage','esiDailyWage','esiContinuation','uan','pfMemberId','esiNo','basic','hra','gross','contractGross','statutoryWage','totalDeductionSource','normalHourlyRate','department','designation','category','remarks'].forEach(f=>{if((x[f]===null||x[f]===undefined||text(x[f])==='')&&(r[f]!==null&&r[f]!==undefined&&text(r[f])!==''))x[f]=r[f];});
  x.fieldPresence=Object.assign({},x.fieldPresence||{});Object.keys(r.fieldPresence||{}).forEach(f=>{x.fieldPresence[f]=x.fieldPresence[f]||r.fieldPresence[f]});x.source.sheets=uniq((x.source.sheets||[]).concat(r.source&&r.source.sheet||[]));x.source.rows=(x.source.rows||[]).concat(r.source&&r.source.row||[]);
 });return order.map(k=>by[k]);
}
function normalizeSavedWorkbook(XLSX,buf,file,targetMonth){
 const wb=XLSX.read(buf,{type:'array',cellDates:false,cellText:true}),ev=monthMatchesExact(workbookMonthEvidence(XLSX,wb,file),targetMonth);if(!ev.match)return{accepted:false,months:ev.keys,file};
 const candidates=[];wb.SheetNames.forEach(sn=>{const rows=sheetMatrix(XLSX,wb.Sheets[sn]),hi=findHeader(rows);if(hi<0)return;const data=normalizeMonthlyRows(rows,sn,file);if(!data.length)return;const n=norm(sn),strong=/main|formula|salary|payroll|wage|compliance|compilance/.test(n),score=headerScore(rows[hi]||[])+(strong?12:/bank|account|category/.test(n)?-6:0)+Math.min(10,data.length/80);candidates.push({sheet:sn,rows:data,strong,strongScore:score});});
 if(!candidates.length)return{accepted:false,months:ev.keys,file,reason:'NO_PAYROLL_SHEET'};
 const strong=candidates.filter(x=>x.strong).sort((a,b)=>b.strongScore-a.strongScore||b.rows.length-a.rows.length)[0];if(strong&&strong.rows.length>=20)return{accepted:true,file,sheet:strong.sheet,rows:strong.rows,months:ev.keys,sourceMode:'PRIMARY_SHEET'};
 const all=[];candidates.forEach(x=>all.push.apply(all,x.rows));const merged=mergeMonthlyRows_(all,file);return merged.length?{accepted:true,file,sheet:'MERGED '+candidates.length+' SHEETS',rows:merged,months:ev.keys,sourceMode:'MERGED_SHEETS',sourceSheets:candidates.map(x=>x.sheet)}:{accepted:false,months:ev.keys,file,reason:'NO_PAYROLL_ROWS'};
}
`;
   code=replaceBlock(code,'function normalizeSavedWorkbook(','function masterArray(',repl);

   var sourceLoader=`async function loadExactMonthSource(){
 const files=await getSavedSalaryFiles(),accepted=[],mamKeys=new Set((UI.mamRows||[]).map(x=>codeKey(x.empCode)).filter(Boolean));
 for(const f of files){try{const buf=f.buf instanceof ArrayBuffer?f.buf:(f.buf&&f.buf.buffer)||f.buf;if(!buf)continue;const x=normalizeSavedWorkbook(root.XLSX,buf,f.name,UI.month);if(!x.accepted)continue;const paidCount=(x.rows||[]).filter(z=>num(z.paidDays)!==null).length,grossCount=(x.rows||[]).filter(z=>num(z.totalGross)!==null||num(z.baseEarned)!==null||num(z.contractGross)!==null||num(z.gross)!==null).length;if(!paidCount)continue;const ix=indexRecords(x.rows||[],z=>z),dupes=Object.keys(ix.dupes||{}).length;let overlap=0,unique=0;Object.keys(ix.byCode||{}).forEach(k=>{if(!Array.isArray(ix.byCode[k])){unique++;if(mamKeys.has(k))overlap++;}});const cleanRatio=unique?1-dupes/Math.max(1,unique+dupes):0;const label=norm((x.file||'')+' '+(x.sheet||''));const nameBoost=/main|salary|payroll|formula|compliance|compilance/.test(label)?250:/attendance|card wise|department|dept/.test(label)?-100:0;const sourceCoverage=(paidCount+grossCount)/Math.max(1,(x.rows||[]).length*2);x._score=overlap*1000+unique*3+cleanRatio*100+sourceCoverage*200-dupes*150+nameBoost;x._overlap=overlap;x._dupes=dupes;x._paidCount=paidCount;x._grossCount=grossCount;x.saved=f.saved||'';accepted.push(x);}catch(err){console.warn('Mam monthly source skipped:',f&&f.name,err);}}
 if(!accepted.length){UI.monthlyRows=[];UI.monthlyMeta=null;return null;}
 accepted.sort((a,b)=>b._score-a._score||b._overlap-a._overlap||b.rows.length-a.rows.length);const best=accepted[0];UI.monthlyRows=best.rows;UI.monthlyMeta=best;return best;
}
`;
   code=replaceBlock(code,'async function loadExactMonthSource(){','function duplicateCount(',sourceLoader);

   var oldAssign="row.paidDays=num(src.paidDays);row.workingDays=num(src.workingDays);row.otHours=num(src.otHours);row.otRate=num(src.otRate);row.otAmount=num(src.otAmount);row.advance=src.fieldPresence&&src.fieldPresence.advance?(num(src.advance)||0):null;row.otherApprovedDeduction=src.fieldPresence&&src.fieldPresence.otherDeduction?(num(src.otherDeduction)||0):null;row.normalHourlyRate=num(src.normalHourlyRate);";
   var newAssign="row.paidDays=num(src.paidDays);row.workingDays=num(src.workingDays);row.otHours=num(src.otHours);row.otRate=num(src.otRate);row.otAmount=num(src.otAmount);const _fp=src.fieldPresence||{};row._advanceDefaultZero=!_fp.advance;row._otherDeductionDefaultZero=!_fp.otherDeduction;row.advance=_fp.advance?(num(src.advance)||0):0;row.otherApprovedDeduction=_fp.otherDeduction?(num(src.otherDeduction)||0):0;row.normalHourlyRate=num(src.normalHourlyRate);";
   if(code.indexOf(oldAssign)>=0)code=code.replace(oldAssign,newAssign);

   var oldGross="row.grossEarned=num(src.totalGross);if(row.grossEarned===null&&num(src.baseEarned)!==null){if((row.otHours||0)>0&&row.otAmount===null)addIssue(row,'GROSS_CALC_BLOCKED','Cannot build Total Gross without OT Amount.',true);else row.grossEarned=r2(num(src.baseEarned)+(row.otAmount||0));}\n if(row.grossEarned===null)addIssue(row,'GROSS_PAYABLE_MISSING','Calculated/approved Total Gross Salary missing in selected-month source.',true);else row.ruleTrail.push({field:'Total Gross Salary',source:'MONTHLY',value:row.grossEarned,rule:'Approved month payroll source; never reverse-engineered from Mam amount'});";
   var newGross="row.grossEarned=num(src.totalGross);if(row.grossEarned===null&&num(src.baseEarned)!==null){if((row.otHours||0)>0&&row.otAmount===null)addIssue(row,'GROSS_CALC_BLOCKED','Cannot build Total Gross without OT Amount.',true);else row.grossEarned=r2(num(src.baseEarned)+(row.otAmount||0));}\n if(row.grossEarned===null&&row.contractGross!==null&&row.paidDays!==null){if((row.otHours||0)>0&&row.otAmount===null)addIssue(row,'GROSS_CALC_BLOCKED','Cannot build Total Gross without OT Amount.',true);else{const _days=Math.max(0,Math.min(row.paidDays,md)),_base=r2(row.contractGross*_days/md);row.grossEarned=r2(_base+(row.otAmount||0));addIssue(row,'GROSS_DERIVED_FROM_STRUCTURE','Total Gross provisionally derived from Employee Master Gross × Paid Days / Month Days'+((row.otAmount||0)?' + sourced OT Amount':'')+'. Verify company proration rule before Final.',false);row.ruleTrail.push({field:'Total Gross Salary',source:'EMPLOYEE_MASTER + MONTHLY',value:row.grossEarned,base:row.contractGross,paidDays:row.paidDays,rule:'Provisional proration fallback'});}}\n if(row.grossEarned===null)addIssue(row,'GROSS_PAYABLE_MISSING','Calculated/approved Total Gross Salary missing in selected-month source and Employee Master salary structure.',true);else if(!(row.auditIssues||[]).some(x=>x.code==='GROSS_DERIVED_FROM_STRUCTURE'))row.ruleTrail.push({field:'Total Gross Salary',source:'MONTHLY',value:row.grossEarned,rule:'Approved month payroll source; never reverse-engineered from Mam amount'});";
   if(code.indexOf(oldGross)>=0)code=code.replace(oldGross,newGross);

   var oldDed="if(row.advance===null)addIssue(row,'ADVANCE_SOURCE_MISSING','Advance value/source is absent for selected month.',true);if(row.otherApprovedDeduction===null)addIssue(row,'OTHER_DEDUCTION_SOURCE_MISSING','Other approved deduction field/source is absent for selected month.',true);if((row.otherApprovedDeduction||0)>0&&!text(src.deductionApproval))addIssue(row,'DEDUCTION_APPROVAL_MISSING','Other deduction exists without approval evidence.',true);";
   var newDed="if(row._advanceDefaultZero)addIssue(row,'ADVANCE_SOURCE_MISSING','Advance column absent in selected-month source; treated as 0 provisionally.',false);if(row._otherDeductionDefaultZero)addIssue(row,'OTHER_DEDUCTION_SOURCE_MISSING','Other deduction column absent in selected-month source; treated as 0 provisionally.',false);if((row.otherApprovedDeduction||0)>0&&!text(src.deductionApproval))addIssue(row,'DEDUCTION_APPROVAL_MISSING','Other deduction exists without approval evidence.',true);";
   if(code.indexOf(oldDed)>=0)code=code.replace(oldDed,newDed);

   return code;
 }
 function execute(code){
   if(g.__MAM_COMPLIANCE_V5__)return true;
   var base=g.__ATPL_MAM_V5_PATCH_V2__&&g.__ATPL_MAM_V5_PATCH_V2__.patchAll;if(typeof base!=='function')throw new Error('V2 patch transformer unavailable');
   code=extraPatch(base(String(code||'')));
   var s=document.createElement('script');s.type='text/javascript';s.text='(function(root){\n'+code+'\n})(window);\n//# sourceURL=mam-compliance-v5.source-merge-v3.1.js';(document.head||document.documentElement).appendChild(s);if(s.parentNode)s.parentNode.removeChild(s);return !!g.__MAM_COMPLIANCE_V5__;
 }
 function load(done){if(g.__MAM_COMPLIANCE_V5__)return finish(done);fetch('mam-compliance-v5.js?v=20260916-source-merge4',{cache:'no-store',credentials:'same-origin'}).then(r=>{if(!r.ok)throw new Error('Mam core HTTP '+r.status);return r.text()}).then(code=>{if(!execute(code))throw new Error('Mam source merge V3.1 init failed');finish(done)}).catch(err=>{console.error('ATPL Mam source merge V3.1 failed:',err);finish(done,err)})}
 g.ATPLLoadMamComplianceV5SourceMergeV3=load;
})(window);
