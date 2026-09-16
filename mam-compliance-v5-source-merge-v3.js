/* ATPL Mam Compliance source merge V3.
   Reuses V2 source patches, then adds split-sheet monthly payroll aggregation safely. */
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
 function nsum(a,b){a=num(a);b=num(b);return(a===null&&b===null)?null:r2((a||0)+(b||0));}
 function first(a,b){return text(a)!==''?a:b;}
 (rows||[]).forEach(r=>{const k=codeKey(r.empCode);if(!k)return;const fp=[k,norm(r.empName),num(r.paidDays),num(r.totalGross),num(r.baseEarned),num(r.advance),num(r.otHours),num(r.otAmount)].join('|');if(seen[fp])return;seen[fp]=1;
  if(!by[k]){by[k]=Object.assign({},r,{source:Object.assign({},r.source,{type:'MONTHLY_MERGED',file:file,sheets:[r.source&&r.source.sheet].filter(Boolean),rows:[r.source&&r.source.row].filter(Boolean)})});order.push(k);return;}
  const x=by[k];x.empName=first(x.empName,r.empName);x.paidDays=nsum(x.paidDays,r.paidDays);x.workingDays=nsum(x.workingDays,r.workingDays);x.otHours=nsum(x.otHours,r.otHours);x.otAmount=nsum(x.otAmount,r.otAmount);x.totalGross=nsum(x.totalGross,r.totalGross);x.baseEarned=nsum(x.baseEarned,r.baseEarned);x.otherDeduction=nsum(x.otherDeduction,r.otherDeduction);
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
   return replaceBlock(code,'function normalizeSavedWorkbook(','function masterArray(',repl);
 }
 function execute(code){
   if(g.__MAM_COMPLIANCE_V5__)return true;
   var base=g.__ATPL_MAM_V5_PATCH_V2__&&g.__ATPL_MAM_V5_PATCH_V2__.patchAll;if(typeof base!=='function')throw new Error('V2 patch transformer unavailable');
   code=extraPatch(base(String(code||'')));
   var s=document.createElement('script');s.type='text/javascript';s.text='(function(root){\n'+code+'\n})(window);\n//# sourceURL=mam-compliance-v5.source-merge-v3.js';(document.head||document.documentElement).appendChild(s);if(s.parentNode)s.parentNode.removeChild(s);return !!g.__MAM_COMPLIANCE_V5__;
 }
 function load(done){if(g.__MAM_COMPLIANCE_V5__)return finish(done);fetch('mam-compliance-v5.js?v=20260916-source-merge3',{cache:'no-store',credentials:'same-origin'}).then(r=>{if(!r.ok)throw new Error('Mam core HTTP '+r.status);return r.text()}).then(code=>{if(!execute(code))throw new Error('Mam source merge V3 init failed');finish(done)}).catch(err=>{console.error('ATPL Mam source merge V3 failed:',err);finish(done,err)})}
 g.ATPLLoadMamComplianceV5SourceMergeV3=load;
})(window);
