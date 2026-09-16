/* ATPL Mam Compliance V5 scoped runtime loader V2.
   Keeps V5 isolated, accepts ATPL Mam formats, auto-selects salary month,
   and makes exact-month payroll source parsing/calculation visible without silently certifying inferred statutory bases. */
(function(g){'use strict';
  function finish(done,err){try{if(typeof done==='function')done(err||null);}catch(_){}}
  function replaceBlock(code,startToken,endToken,replacement){
    var s=code.indexOf(startToken),e=s<0?-1:code.indexOf(endToken,s);
    if(s<0||e<0||e<=s)return code;
    return code.slice(0,s)+replacement+code.slice(e);
  }

  function patchMamImporter(code){
    var replacement=`function mamHeaderRole(v){
 const n=norm(v);if(!n)return'';
 if(AN.code.includes(n)||/^(employee|emp|staff|worker)\\s*(id|code|no|number)$/.test(n)||/^(id|code)$/.test(n)||/^(employee|emp)\\s*(id|code|no|number)\\s*[a-z]?$/.test(n))return'code';
 if(AN.name.includes(n)||/^(employee|emp|staff|worker)\\s*name$/.test(n)||/^name\\s*(of)?\\s*(employee|emp|staff|worker)$/.test(n)||/^card\\s*(no|number)(\\s*\\d+)?$/.test(n)||/^card\\s*\\d+$/.test(n)||/^staff\\s*name$/.test(n))return'name';
 if(['manual amount','manual amt','mannual amount','mam amount','mam amt','salary amount','salary amt','amount','amt','manual salary','manual payment','diff salary','salary diff','difference salary','difference amount','payment amount','pay amount','net amount','total','total amount','total amt','salary','net payable','payment'].includes(n))return'amount';
 if(/(manual|mannual|mam|diff|difference).*(amount|amt|salary|payment)/.test(n)||/(amount|amt|salary|payment).*(manual|mannual|mam|diff|difference)/.test(n))return'amount';
 if(['s no','sno','sr no','serial no','serial number','serial','index'].includes(n)||/^(s|sr)\\s*no$/.test(n))return'serial';
 return'';
}
function mamNumericRatio(rows,hi,c){let seen=0,ok=0;for(let r=hi+1;r<Math.min(rows.length,hi+41);r++){const a=rows[r]||[],v=c<a.length?a[c]:null;if(text(v)==='')continue;seen++;if(num(v)!==null)ok++;}return seen?ok/seen:0;}
function parseMamRows(rows,sheet,file){
 rows=Array.isArray(rows)?rows:[];let best=null;
 for(let i=0;i<Math.min(80,rows.length);i++){
   const raw=rows[i]||[],roles=raw.map(mamHeaderRole);
   let ci=roles.indexOf('code'),ni=roles.indexOf('name'),ai=roles.indexOf('amount');
   const serialCols=new Set();roles.forEach((x,c)=>{if(x==='serial')serialCols.add(c)});
   const nonEmpty=[];for(let c=0;c<raw.length;c++)if(text(raw[c])!=='')nonEmpty.push(c);
   const maxCols=Math.max(raw.length,6);
   if(ci>=0&&ni<0&&ai>=0&&nonEmpty.length===3)ni=nonEmpty.find(c=>c!==ci&&c!==ai);
   if(ci>=0&&ni>=0&&ai<0){
     const numeric=[];for(let c=0;c<maxCols;c++){if(c===ci||c===ni||serialCols.has(c))continue;const ratio=mamNumericRatio(rows,i,c);if(ratio>=0.40)numeric.push({c,ratio});}
     numeric.sort((a,b)=>b.ratio-a.ratio);if(numeric[0]&&numeric[0].ratio>=0.55)ai=numeric[0].c;
   }
   if(ci>=0&&ai>=0){
     if(ni<0){const rem=nonEmpty.filter(c=>c!==ci&&c!==ai&&!serialCols.has(c));if(rem.length===1)ni=rem[0];}
     const amountHeader=ai<raw.length?mamHeaderRole(raw[ai]):'';
     const score=10+(ni>=0?4:0)+(amountHeader==='amount'?4:0)+Math.min(3,mamNumericRatio(rows,i,ai)*3);
     if(!best||score>best.score)best={i,C:ci,N:ni,M:ai,score};
   }
 }
 if(!best)throw Error('Mam salary columns identify nahi hue. Supported: Code | Card No. 1 | Total, ya Employee Code | Employee Name | Manual Amount.');
 const hi=best.i,C=best.C,N=best.N,M=best.M,out=[];
 for(let r=hi+1;r<rows.length;r++){
   const a=rows[r]||[],code=codeDisplay(C<a.length?a[C]:null),name=N>=0&&N<a.length?text(a[N]):'',amt=num(M<a.length?a[M]:null);
   if(!code&&!name)continue;
   const nc=norm(code),nn=norm(name);
   if(['code','employee code','employee id','emp code','emp id'].includes(nc))continue;
   if(/^card (no|number)\\b/.test(nn)||nn==='staff name'||nn==='employee name'||nn==='name')continue;
   if(/^(total|grand total|subtotal|sum)$/.test(nn)&&!code)continue;
   out.push({empCode:code,empName:name,manualAmount:amt,source:{type:'MAM',file,sheet,row:r+1,headerRow:hi+1}});
 }
 if(!out.length)throw Error('Mam salary headers mil gaye, lekin employee salary rows nahi mile.');
 return out;
}
`;
    return replaceBlock(code,'function parseMamRows(','function parseMamWorkbook(',replacement);
  }

  function patchMonthlyParser(code){
    var colMap=`function colMap(headers){
 const hs=(headers||[]).map(norm),m={};
 function dynamic(k,z){
   if(k==='name'&&(/^card\\s*(no|number)\\s*\\d+$/.test(z)||/^card\\s*\\d+$/.test(z)||z==='staff name'||z==='employee'))return true;
   if(k==='paidDays'&&['days','total days','pay days'].includes(z))return true;
   if(k==='advance'&&['adv','advance amount'].includes(z))return true;
   if(k==='totalGross'&&['total','gross total','total salary','earned total'].includes(z))return true;
   return false;
 }
 Object.keys(AN).forEach(k=>{m[k]=-1;for(let i=0;i<hs.length;i++){if(AN[k].includes(hs[i])||dynamic(k,hs[i])){m[k]=i;break;}}});return m;
}
`;
    code=replaceBlock(code,'function colMap(headers){','function headerScore(',colMap);
    var old="if(!code&&!name)continue;if(/^(total|grand total|subtotal)$/i.test(name))continue;";
    var neu="if(!code&&!name)continue;const nc=norm(code),nn=norm(name);if(['code','employee code','employee id','emp code','emp id'].includes(nc)||/^card (no|number)\\b/.test(nn)||nn==='staff name'||nn==='employee name')continue;if(/^(total|grand total|subtotal)$/i.test(name))continue;";
    if(code.indexOf(old)>=0)code=code.replace(old,neu);
    return code;
  }

  function patchMonthDetection(code){
    var replacement=`async function readMam(file){
 const buf=await file.arrayBuffer(),wb=root.XLSX.read(buf,{type:'array',cellDates:false,cellText:true}),best=parseMamWorkbook(root.XLSX,wb,file.name);
 const ev=[file.name].concat(wb.SheetNames||[]);(wb.SheetNames||[]).slice(0,3).forEach(sn=>{const rows=sheetMatrix(root.XLSX,wb.Sheets[sn]);for(let i=0;i<Math.min(8,rows.length);i++)ev.push((rows[i]||[]).slice(0,8).join(' '));});
 const months=uniq(ev.flatMap(detectMonthKeys));best.detectedMonths=months;
 if(months.length===1&&months[0]!==UI.month){UI.month=months[0];UI.monthlyRows=[];UI.monthlyMeta=null;const mi=$('mc5Month');if(mi)mi.value=UI.month;saveUiState();best.monthAutoSelected=true;}
 UI.mamFile=file.name;UI.mamImportedAt=new Date().toISOString();UI.mamRows=best.rows;return best;
}
`;
    code=replaceBlock(code,'async function readMam(file){','async function loadExactMonthSource(){',replacement);
    var old="setNotice(`${b.rows.length} Mam rows loaded. Ab Generate Compliance Salary click karein.`,false);";
    var neu="setNotice(`${b.rows.length} Mam rows loaded.${b.monthAutoSelected?' Month auto-selected: '+UI.month+'.':''} Ab Generate Compliance Salary click karein.`,false);";
    if(code.indexOf(old)>=0)code=code.replace(old,neu);
    return code;
  }

  function patchSourceSelection(code){
    var replacement=`async function loadExactMonthSource(){
 const files=await getSavedSalaryFiles(),accepted=[],mamKeys=new Set((UI.mamRows||[]).map(x=>codeKey(x.empCode)).filter(Boolean));
 for(const f of files){try{const buf=f.buf instanceof ArrayBuffer?f.buf:(f.buf&&f.buf.buffer)||f.buf;if(!buf)continue;const x=normalizeSavedWorkbook(root.XLSX,buf,f.name,UI.month);if(!x.accepted)continue;const ix=indexRecords(x.rows||[],z=>z),dupes=Object.keys(ix.dupes||{}).length;let overlap=0,unique=0;Object.keys(ix.byCode||{}).forEach(k=>{if(!Array.isArray(ix.byCode[k])){unique++;if(mamKeys.has(k))overlap++;}});const cleanRatio=unique?1-dupes/Math.max(1,unique+dupes):0;const label=norm((x.file||'')+' '+(x.sheet||''));const nameBoost=/main|salary|payroll|formula|compliance|compilance/.test(label)?250:/attendance|card wise|department|dept/.test(label)?-100:0;x._score=overlap*1000+unique*3+cleanRatio*100-dupes*150+nameBoost;x._overlap=overlap;x._dupes=dupes;x.saved=f.saved||'';accepted.push(x);}catch(_){}}
 if(!accepted.length){UI.monthlyRows=[];UI.monthlyMeta=null;return null;}
 accepted.sort((a,b)=>b._score-a._score||b._overlap-a._overlap||b.rows.length-a.rows.length);const best=accepted[0];UI.monthlyRows=best.rows;UI.monthlyMeta=best;return best;
}
`;
    return replaceBlock(code,'async function loadExactMonthSource(){','function duplicateCount(',replacement);
  }

  function patchProvisionalStatutory(code){
    var resolve=`function resolveStatus(monthly,master,key,groups){
 const a=text(monthly&&monthly[key]),b=text(master&&master[key]);const ca=activeStatus(a,groups),cb=activeStatus(b,groups);
 if(ca!=='UNKNOWN'&&cb!=='UNKNOWN'&&ca!==cb)return {status:'CONFLICT',monthly:a,master:b};
 if(ca!=='UNKNOWN')return {status:ca,raw:a,source:'MONTHLY'};if(cb!=='UNKNOWN')return {status:cb,raw:b,source:'MASTER'};
 if(key==='pfStatus'&&((monthly&&(monthly.uan||monthly.pfMemberId))||(master&&(master.uan||master.pfMemberId))))return {status:'ACTIVE',raw:'Identifier present',source:'INFERRED_ID',inferred:true};
 if(key==='esiStatus'&&((monthly&&monthly.esiNo)||(master&&master.esiNo)))return {status:'ACTIVE',raw:'Identifier present',source:'INFERRED_ID',inferred:true};
 return {status:'UNKNOWN',raw:'',source:''};
}
`;
    code=replaceBlock(code,'function resolveStatus(monthly,master,key,groups){','function exceptionFromSource(',resolve);
    var pfOld="const pfGroups=RULES?RULES.pf.statuses:{active:[],inactive:[]},pfS=resolveStatus(src,master,'pfStatus',pfGroups);row.pfCoverage=pfS.status;row.pfWage=num(src.pfWage)!==null?num(src.pfWage):num(master.pfWage);row.pfEmployee=0;row.pfEmployer=0;row.eps=0;";
    var pfNew="const pfGroups=RULES?RULES.pf.statuses:{active:[],inactive:[]},pfS=resolveStatus(src,master,'pfStatus',pfGroups);row.pfCoverage=pfS.status;row.pfWage=num(src.pfWage)!==null?num(src.pfWage):num(master.pfWage);row._pfWageDerived=false;if(row.pfWage===null&&pfS.status==='ACTIVE'&&row.basic!==null&&row.paidDays!==null){row.pfWage=r2(row.basic*Math.max(0,Math.min(row.paidDays,md))/md);row._pfWageDerived=true;}row.pfEmployee=0;row.pfEmployer=0;row.eps=0;if(pfS.inferred)addIssue(row,'PF_STATUS_INFERRED_FROM_ID','PF membership provisionally inferred from existing UAN/PF identifier; verify membership/status before Final.',false);if(row._pfWageDerived)addIssue(row,'PF_WAGE_PROVISIONAL','PF Wage provisionally derived from Basic × Paid Days / Month Days because sourced PF Wage is missing.',false);";
    if(code.indexOf(pfOld)>=0)code=code.replace(pfOld,pfNew);
    var esiOld="const esiGroups=RULES?RULES.esi.statuses:{active:[],inactive:[]},esiS=resolveStatus(src,master,'esiStatus',esiGroups);row.esiCoverage=esiS.status;row.esiWage=num(src.esiWage)!==null?num(src.esiWage):num(master.esiWage);row.esiEmployee=0;row.esiEmployer=0;";
    var esiNew="const esiGroups=RULES?RULES.esi.statuses:{active:[],inactive:[]},esiS=resolveStatus(src,master,'esiStatus',esiGroups);row.esiCoverage=esiS.status;row.esiWage=num(src.esiWage)!==null?num(src.esiWage):num(master.esiWage);row._esiWageDerived=false;if(row.esiWage===null&&esiS.status==='ACTIVE'&&row.grossEarned!==null){row.esiWage=r2(row.grossEarned);row._esiWageDerived=true;}row.esiEmployee=0;row.esiEmployer=0;if(esiS.inferred)addIssue(row,'ESIC_STATUS_INFERRED_FROM_ID','ESIC coverage provisionally inferred from existing ESIC/IP identifier; verify contribution-period status before Final.',false);if(row._esiWageDerived)addIssue(row,'ESI_WAGE_PROVISIONAL','ESI Wage provisionally derived from Total Gross because sourced ESI Wage is missing; verify component exclusions before Final.',false);";
    if(code.indexOf(esiOld)>=0)code=code.replace(esiOld,esiNew);
    return code;
  }

  function patchNotice(code){
    var old="UI.monthlyMeta?`Generated from Mam + Employee Master + ${UI.monthlyMeta.file} (${UI.monthlyMeta.sheet}). ${s.blocked} blocked, ${s.warning} warning.`:`Preview generated. ${s.blocked} rows blocked because exact ${UI.month} saved payroll/attendance source was not found.`";
    var neu="UI.monthlyMeta?`Generated from Mam + Employee Master + ${UI.monthlyMeta.file} (${UI.monthlyMeta.sheet}). ${s.blocked} blocked, ${s.warning} warning. Source overlap: ${UI.monthlyMeta._overlap||0} employees.`:`Preview generated. ${s.blocked} rows blocked because exact ${UI.month} saved payroll/attendance source was not found.`";
    if(code.indexOf(old)>=0)code=code.replace(old,neu);return code;
  }

  function patchAll(code){code=String(code||'');code=patchMamImporter(code);code=patchMonthlyParser(code);code=patchMonthDetection(code);code=patchSourceSelection(code);code=patchProvisionalStatutory(code);code=patchNotice(code);return code;}
  function executeScoped(code){
    if(g.__MAM_COMPLIANCE_V5__)return true;code=patchAll(code);
    var s=document.createElement('script');s.type='text/javascript';s.text='(function(root){\n'+code+'\n})(window);\n//# sourceURL=mam-compliance-v5.scoped-v2.js';
    (document.head||document.documentElement).appendChild(s);if(s.parentNode)s.parentNode.removeChild(s);return !!g.__MAM_COMPLIANCE_V5__;
  }
  function load(done){
    if(g.__MAM_COMPLIANCE_V5__)return finish(done);if(typeof fetch!=='function')return finish(done,new Error('Fetch unavailable for scoped V5 loader'));
    fetch('mam-compliance-v5.js?v=20260916-calc-source-v2',{cache:'no-store',credentials:'same-origin'}).then(function(r){if(!r.ok)throw new Error('Mam V5 source HTTP '+r.status);return r.text();}).then(function(code){if(!executeScoped(code))throw new Error('Mam V5 scoped V2 initialization failed');finish(done);}).catch(function(err){console.error('ATPL Mam V5 scoped V2 loader failed:',err);finish(done,err);});
  }
  g.ATPLLoadMamComplianceV5ScopedV2=load;
  g.__ATPL_MAM_V5_PATCH_V2__={patchAll:patchAll};
})(window);
