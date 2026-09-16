/* ATPL Mam Compliance V5 scoped runtime loader.
   Executes V5 with a private `root` binding so the rest of ERP globals remain untouched.
   Also hardens only the Mam 3-column importer; statutory calculations/export rules remain unchanged. */
(function(g){'use strict';
  function finish(done,err){try{if(typeof done==='function')done(err||null);}catch(_){}}

  function patchMamImporter(code){
    code=String(code||'');
    var start=code.indexOf('function parseMamRows(');
    var end=code.indexOf('function parseMamWorkbook(',start);
    if(start<0||end<0||end<=start)return code;
    var replacement=`function mamHeaderRole(v){
 const n=norm(v);if(!n)return'';
 if(AN.code.includes(n)||/^(employee|emp|staff|worker|card)\\s*(id|code|no|number)$/.test(n)||/^(id|code)$/.test(n)||/^(employee|emp)\\s*(id|code|no|number)\\s*[a-z]?$/.test(n))return'code';
 if(AN.name.includes(n)||/^(employee|emp|staff|worker)\\s*name$/.test(n)||/^name\\s*(of)?\\s*(employee|emp|staff|worker)$/.test(n))return'name';
 if(['manual amount','manual amt','mannual amount','mam amount','mam amt','salary amount','salary amt','amount','amt','manual salary','manual payment','diff salary','salary diff','difference salary','difference amount','payment amount','pay amount','net amount'].includes(n))return'amount';
 if(/(manual|mannual|mam|diff|difference).*(amount|amt|salary|payment)/.test(n)||/(amount|amt|salary|payment).*(manual|mannual|mam|diff|difference)/.test(n))return'amount';
 return'';
}
function mamNumericRatio(rows,hi,c){let seen=0,ok=0;for(let r=hi+1;r<Math.min(rows.length,hi+31);r++){const a=rows[r]||[],v=a[c];if(text(v)==='')continue;seen++;if(num(v)!==null)ok++;}return seen?ok/seen:0;}
function parseMamRows(rows,sheet,file){
 rows=Array.isArray(rows)?rows:[];let best=null;
 for(let i=0;i<Math.min(60,rows.length);i++){
   const raw=rows[i]||[],h=raw.map(norm),roles=raw.map(mamHeaderRole);
   let ci=roles.indexOf('code'),ni=roles.indexOf('name'),ai=roles.indexOf('amount');
   const nonEmpty=[];for(let c=0;c<raw.length;c++)if(text(raw[c])!=='')nonEmpty.push(c);
   if(ci>=0&&ni<0&&ai>=0&&nonEmpty.length===3){ni=nonEmpty.find(c=>c!==ci&&c!==ai);}
   if(ci>=0&&ni>=0&&ai<0){
     const rem=nonEmpty.filter(c=>c!==ci&&c!==ni),numeric=rem.map(c=>({c,ratio:mamNumericRatio(rows,i,c)})).sort((a,b)=>b.ratio-a.ratio);
     if(rem.length===1&&numeric[0]&&numeric[0].ratio>=0.55)ai=numeric[0].c;
     else if(numeric[0]&&numeric[0].ratio>=0.80&&numeric[0].ratio>(numeric[1]?numeric[1].ratio:0)+0.20)ai=numeric[0].c;
   }
   if(ci>=0&&ai>=0){
     if(ni<0){const rem=nonEmpty.filter(c=>c!==ci&&c!==ai);if(rem.length===1)ni=rem[0];}
     const score=10+(ni>=0?4:0)+(mamHeaderRole(raw[ai])==='amount'?3:0)+Math.min(3,mamNumericRatio(rows,i,ai)*3);
     if(!best||score>best.score)best={i,C:ci,N:ni,M:ai,score};
   }
 }
 if(!best)throw Error('Mam sheet me Employee Code/ID aur Manual Amount columns reliably identify nahi hue. Expected: Employee Code | Employee Name | Manual Amount.');
 const hi=best.i,C=best.C,N=best.N,M=best.M,out=[];
 for(let r=hi+1;r<rows.length;r++){
   const a=rows[r]||[],code=codeDisplay(a[C]),name=N>=0?text(a[N]):'',amt=num(a[M]);
   if(!code&&!name&&amt===null)continue;
   if(/^(total|grand total|subtotal)$/i.test(name)&&!code)continue;
   if(!code&&amt===null)continue;
   out.push({empCode:code,empName:name,manualAmount:amt,source:{type:'MAM',file,sheet,row:r+1,headerRow:hi+1}});
 }
 if(!out.length)throw Error('Mam sheet headers mil gaye, lekin employee salary rows nahi mile.');
 return out;
}
`;
    return code.slice(0,start)+replacement+code.slice(end);
  }

  function executeScoped(code){
    if(g.__MAM_COMPLIANCE_V5__)return true;
    code=patchMamImporter(code);
    var s=document.createElement('script');
    s.type='text/javascript';
    s.text='(function(root){\n'+String(code||'')+'\n})(window);\n//# sourceURL=mam-compliance-v5.scoped.js';
    (document.head||document.documentElement).appendChild(s);
    if(s.parentNode)s.parentNode.removeChild(s);
    return !!g.__MAM_COMPLIANCE_V5__;
  }
  function load(done){
    if(g.__MAM_COMPLIANCE_V5__)return finish(done);
    if(typeof fetch!=='function')return finish(done,new Error('Fetch unavailable for scoped V5 loader'));
    fetch('mam-compliance-v5.js?v=20260916-importflex2',{cache:'no-store',credentials:'same-origin'})
      .then(function(r){if(!r.ok)throw new Error('Mam V5 source HTTP '+r.status);return r.text();})
      .then(function(code){if(!executeScoped(code))throw new Error('Mam V5 scoped initialization failed');finish(done);})
      .catch(function(err){console.error('ATPL Mam V5 scoped loader failed:',err);finish(done,err);});
  }
  g.ATPLLoadMamComplianceV5ScopedV1=load;
})(window);
