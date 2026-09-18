/* ATPL Machine Rate Audit Worker V2
   Permanent responsiveness build:
   - File is read inside the worker (main UI never holds the workbook buffer).
   - Sheets are scanned directly by cell address (no full sheet_to_json matrix duplication).
   - Only compact preview rows are returned to the UI.
   - Full export is generated inside the worker on demand.
*/
'use strict';
importScripts('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');

var lastAudit=null;
function norm(v){return String(v==null?'':v).trim().toLowerCase().replace(/\s+/g,' ')}
function rawMachine(v){return String(v==null?'':v).trim().toUpperCase().replace(/[\s\-_/]+/g,'')}
function num(v){if(typeof v==='number'&&isFinite(v))return v;var s=String(v==null?'':v).replace(/[₹,\s]/g,'').trim();if(!s)return null;var n=Number(s);return isFinite(n)?n:null}
function machineOk(s){return /^C\d+[A-Z0-9.]*$/.test(s)}
function codeText(v){if(typeof v==='number'&&isFinite(v))return String(Math.trunc(v));return String(v==null?'':v).trim()}
function cardFromSheet(sn){var m=String(sn||'').match(/card\s*no\.?[-\s]*([0-9]+)/i);return m?String(Number(m[1])):''}
function cardFromMachine(mc){var m=String(mc||'').match(/^C(\d+)/);return m?String(Number(m[1])):''}
function isMonthlyRate(v){return v!=null&&v>=1000}
function isKgRate(v){return v!=null&&v>0&&v<100}
function stripKgSuffix(raw,rate){
  var mc=rawMachine(raw),n=Number(rate);if(!mc||!isFinite(n))return mc;
  var forms=[String(n),n.toFixed(1),n.toFixed(2),n.toFixed(3)].filter(function(x,i,a){return a.indexOf(x)===i}).sort(function(a,b){return b.length-a.length});
  for(var i=0;i<forms.length;i++){
    var f=forms[i].replace(/0+$/,'').replace(/\.$/,'');
    var variants=[forms[i],f];
    for(var j=0;j<variants.length;j++){
      var s=variants[j].toUpperCase();
      if(s&&mc.length>s.length&&mc.slice(-s.length)===s){
        var base=mc.slice(0,-s.length).replace(/[.]$/,'');
        if(/^C\d+[A-Z0-9]*$/.test(base))return base;
      }
    }
  }
  return mc;
}
function canonicalMachine(raw,rate,mode){return mode==='kg'?stripKgSuffix(raw,rate):rawMachine(raw)}
function cellValue(ws,R,C){var cell=ws[XLSX.utils.encode_cell({r:R,c:C})];return cell?cell.v:null}
function findHeader(ws,range){
  var lastR=Math.min(range.e.r,range.s.r+11),maxC=range.e.c;
  for(var r=range.s.r;r<=lastR;r++){
    var code=-1,loc=-1,sal=-1,name=-1;
    for(var c=range.s.c;c<=maxC;c++){
      var x=norm(cellValue(ws,r,c));
      if(code<0&&(x==='code'||x==='emp code'||x==='employee code'||x==='staff code'||x==='worker code'||x==='card no'))code=c;
      if(loc<0&&(x==='loc'||x==='loc.'||x==='location'||x==='loctation'||x.indexOf('location')>=0||x.indexOf('loctation')>=0))loc=c;
      if(sal<0&&(x==='salary'||x==='salry'||x==='rate'||x==='salary rate'||x.indexOf('salary')>=0||x.indexOf('salry')>=0))sal=c;
      if(name<0&&(x==='name'||x==='employee name'||x==='emp name'||x==='staff name'||x==='worker name'))name=c;
    }
    if(code>=0&&loc>=0&&sal>=0){if(name<0)name=Math.min(maxC,code+1);return{row:r,code:code,name:name,loc:loc,salary:sal}}
  }
  return null;
}
function mostCommon(counter){
  var keys=Object.keys(counter),best=null,bestCount=-1,tie=false;
  keys.forEach(function(k){var n=counter[k];if(n>bestCount){best=k;bestCount=n;tie=false}else if(n===bestCount){tie=true}});
  return{rate:best==null?null:Number(best),count:bestCount,tie:tie};
}
function compactGroup(x){
  return{key:x.key,sheet:x.sheet,card:x.card,machine:x.machine,rows:x.rows.slice(0,80),rowCount:x.rows.length,rates:x.rates,rateList:x.rateList,common:x.common,commonCount:x.commonCount,tie:x.tie,mismatch:x.mismatch,min:x.min,max:x.max,delta:x.delta};
}
function analyze(buffer,mode){
  postMessage({type:'progress',stage:'Opening workbook in background',percent:6});
  var wb=XLSX.read(buffer,{type:'array',cellDates:false,cellText:false,cellStyles:false,cellFormula:false});
  var groups={},scannedSheets=0,employeeKeys={},names=wb.SheetNames||[],total=Math.max(1,names.length);
  for(var si=0;si<names.length;si++){
    var sn=names[si],ws=wb.Sheets[sn];
    if(ws&&ws['!ref']){
      var range;
      try{range=XLSX.utils.decode_range(ws['!ref'])}catch(_){range=null}
      if(range){
        var hdr=findHeader(ws,range);
        if(hdr){
          var sheetHad=false,sheetCard=cardFromSheet(sn);
          for(var r=hdr.row+1;r<=range.e.r;r++){
            var rate=num(cellValue(ws,r,hdr.salary));
            if(mode==='monthly'&&!isMonthlyRate(rate))continue;
            if(mode==='kg'&&!isKgRate(rate))continue;
            var raw=rawMachine(cellValue(ws,r,hdr.loc));if(!machineOk(raw))continue;
            var mc=canonicalMachine(raw,rate,mode);if(!machineOk(mc))continue;
            sheetHad=true;
            var empCode=codeText(cellValue(ws,r,hdr.code)),name=String(cellValue(ws,r,hdr.name)==null?'':cellValue(ws,r,hdr.name)).trim(),machineCard=cardFromMachine(mc);
            var rec={sheet:sn,row:r+1,card:sheetCard,machine:mc,rawMachine:raw,code:empCode,name:name,rate:rate,crossCard:!!(sheetCard&&machineCard&&sheetCard!==machineCard)};
            if(empCode||name)employeeKeys[(empCode||'')+'|'+name.toLowerCase()]=1;
            var key=sn+'||'+mc;
            if(!groups[key])groups[key]={key:key,sheet:sn,card:sheetCard,machine:mc,rows:[],rates:{}};
            groups[key].rows.push(rec);var rk=String(rate);groups[key].rates[rk]=(groups[key].rates[rk]||0)+1;
          }
          if(sheetHad)scannedSheets++;
        }
      }
    }
    if(si%3===0||si===names.length-1)postMessage({type:'progress',stage:'Scanning sheets',percent:10+Math.round(((si+1)/total)*72),sheet:sn});
  }
  postMessage({type:'progress',stage:'Building compact audit',percent:88});
  var list=Object.keys(groups).map(function(k){
    var x=groups[k],rates=Object.keys(x.rates).map(Number).sort(function(a,b){return a-b}),common=mostCommon(x.rates);
    x.rateList=rates;x.common=common.rate;x.commonCount=common.count;x.tie=common.tie;x.mismatch=rates.length>1;
    x.min=rates.length?rates[0]:null;x.max=rates.length?rates[rates.length-1]:null;x.delta=rates.length?x.max-x.min:0;
    return x;
  }).sort(function(a,b){if(a.mismatch!==b.mismatch)return a.mismatch?-1:1;return a.sheet.localeCompare(b.sheet)||a.machine.localeCompare(b.machine)});
  lastAudit={groups:list,mode:mode,scannedSheets:scannedSheets,scannedEmployees:Object.keys(employeeKeys).length,sheetCount:names.length};
  var compact=list.map(compactGroup),issueCount=list.reduce(function(n,x){return n+(x.mismatch?1:0)},0);
  wb=null;groups=null;employeeKeys=null;
  return{groups:compact,issuesCount:issueCount,scannedSheets:scannedSheets,scannedEmployees:lastAudit.scannedEmployees,sheetCount:names.length};
}
function makeExport(fileName,mode){
  if(!lastAudit||!lastAudit.groups)return null;
  var label=mode==='kg'?'RATE/KG':'MONTHLY RATE';
  var rows=[['MACHINE '+label+' AUDIT'],['Source File',fileName||''],['Mode',label],['Generated',new Date().toLocaleString()],[],['Sheet','Machine Code','Raw Location','Emp Code','Employee','Rate','Most Used Rate','Difference','Status','Source Row']];
  lastAudit.groups.forEach(function(gp){gp.rows.forEach(function(r){var diff=gp.common==null?'':r.rate-gp.common;rows.push([gp.sheet,gp.machine,r.rawMachine,r.code,r.name,r.rate,gp.tie?'':gp.common,gp.tie?'':diff,gp.mismatch?'MISMATCH':'OK',r.row])})});
  var summary=[['MACHINE '+label+' SUMMARY'],[],['Sheet','Machine Code','Employees','Rates Found','Most Used Rate','Spread','Status']];
  lastAudit.groups.forEach(function(gp){summary.push([gp.sheet,gp.machine,gp.rows.length,gp.rateList.map(function(x){return x+' x'+gp.rates[String(x)]}).join(' | '),gp.tie?'':gp.common,gp.delta,gp.mismatch?'MISMATCH':'OK'])});
  var out=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(out,XLSX.utils.aoa_to_sheet(summary),'SUMMARY');
  XLSX.utils.book_append_sheet(out,XLSX.utils.aoa_to_sheet(rows),'DETAIL');
  var data=XLSX.write(out,{bookType:'xlsx',type:'array',compression:true});
  var base=String(fileName||'audit').replace(/\.(xlsx|xls|csv)$/i,'');
  return{buffer:data,filename:'Machine_'+(mode==='kg'?'RateKG':'MonthlyRate')+'_Audit_'+base+'.xlsx'};
}
self.onmessage=async function(e){
  var d=e.data||{};
  try{
    if(d.type==='scan'){
      lastAudit=null;
      var buffer=d.buffer||null;
      if(!buffer&&d.file){
        if(typeof FileReaderSync==='function')buffer=(new FileReaderSync()).readAsArrayBuffer(d.file);
        else if(d.file.arrayBuffer)buffer=await d.file.arrayBuffer();
      }
      if(!buffer)throw new Error('Workbook data unavailable');
      var result=analyze(buffer,d.mode||'monthly');
      buffer=null;
      postMessage({type:'done',jobId:d.jobId,result:result});
      return;
    }
    if(d.type==='export'){
      postMessage({type:'progress',jobId:d.jobId,stage:'Preparing export in background',percent:94});
      var ex=makeExport(d.fileName,d.mode||'monthly');
      if(!ex)throw new Error('Audit data is not ready');
      postMessage({type:'exportDone',jobId:d.jobId,filename:ex.filename,buffer:ex.buffer},[ex.buffer]);
    }
  }catch(err){
    postMessage({type:'error',jobId:d.jobId,message:err&&err.message?err.message:String(err)});
  }
};