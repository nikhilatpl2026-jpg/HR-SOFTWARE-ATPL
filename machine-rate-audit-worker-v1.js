/* ATPL Machine Rate Audit Worker V1
   Heavy XLSX parsing + machine-rate analysis runs off the UI thread. */
'use strict';
importScripts('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');

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
function findHeader(rows){
  var lim=Math.min(rows.length,12);
  for(var r=0;r<lim;r++){
    var row=rows[r]||[],h=row.map(norm),code=-1,loc=-1,sal=-1,name=-1;
    for(var c=0;c<h.length;c++){
      var x=h[c];
      if(code<0&&(x==='code'||x==='emp code'||x==='employee code'||x==='staff code'||x==='worker code'||x==='card no'))code=c;
      if(loc<0&&(x==='loc'||x==='loc.'||x==='location'||x==='loctation'||x.indexOf('location')>=0||x.indexOf('loctation')>=0))loc=c;
      if(sal<0&&(x==='salary'||x==='salry'||x==='rate'||x==='salary rate'||x.indexOf('salary')>=0||x.indexOf('salry')>=0))sal=c;
      if(name<0&&(x==='name'||x==='employee name'||x==='emp name'||x==='staff name'||x==='worker name'))name=c;
    }
    if(code>=0&&loc>=0&&sal>=0){if(name<0)name=code+1<h.length?code+1:1;return{row:r,code:code,name:name,loc:loc,salary:sal}}
  }
  return null;
}
function mostCommon(counter){
  var keys=Object.keys(counter),best=null,bestCount=-1,tie=false;
  keys.forEach(function(k){var n=counter[k];if(n>bestCount){best=k;bestCount=n;tie=false}else if(n===bestCount){tie=true}});
  return{rate:best==null?null:Number(best),count:bestCount,tie:tie};
}
function analyze(buffer,mode){
  postMessage({type:'progress',stage:'Reading workbook',percent:8});
  var wb=XLSX.read(buffer,{type:'array',cellDates:false,cellText:true});
  var groups={},allRows=[],scannedSheets=0,employeeKeys={},names=wb.SheetNames||[],total=Math.max(1,names.length);
  for(var si=0;si<names.length;si++){
    var sn=names[si],ws=wb.Sheets[sn];
    if(ws&&ws['!ref']){
      var rows=XLSX.utils.sheet_to_json(ws,{header:1,raw:true,defval:null,blankrows:true});
      var hdr=findHeader(rows);
      if(hdr){
        var sheetHad=false,sheetCard=cardFromSheet(sn);
        for(var r=hdr.row+1;r<rows.length;r++){
          var row=rows[r]||[],rate=num(row[hdr.salary]);
          if(mode==='monthly'&&!isMonthlyRate(rate))continue;
          if(mode==='kg'&&!isKgRate(rate))continue;
          var raw=rawMachine(row[hdr.loc]);if(!machineOk(raw))continue;
          var mc=canonicalMachine(raw,rate,mode);if(!machineOk(mc))continue;
          sheetHad=true;
          var empCode=codeText(row[hdr.code]),name=String(row[hdr.name]==null?'':row[hdr.name]).trim(),machineCard=cardFromMachine(mc);
          var rec={sheet:sn,row:r+1,card:sheetCard,machine:mc,rawMachine:raw,code:empCode,name:name,rate:rate,crossCard:!!(sheetCard&&machineCard&&sheetCard!==machineCard)};
          allRows.push(rec);if(empCode||name)employeeKeys[(empCode||'')+'|'+name.toLowerCase()]=1;
          var key=sn+'||'+mc;
          if(!groups[key])groups[key]={key:key,sheet:sn,card:sheetCard,machine:mc,rows:[],rates:{}};
          groups[key].rows.push(rec);var rk=String(rate);groups[key].rates[rk]=(groups[key].rates[rk]||0)+1;
        }
        if(sheetHad)scannedSheets++;
      }
    }
    if(si%2===0)postMessage({type:'progress',stage:'Scanning sheets',percent:10+Math.round(((si+1)/total)*70),sheet:sn});
  }
  postMessage({type:'progress',stage:'Building audit',percent:86});
  var list=Object.keys(groups).map(function(k){
    var x=groups[k],rates=Object.keys(x.rates).map(Number).sort(function(a,b){return a-b}),common=mostCommon(x.rates);
    x.rateList=rates;x.common=common.rate;x.commonCount=common.count;x.tie=common.tie;x.mismatch=rates.length>1;
    x.min=rates.length?rates[0]:null;x.max=rates.length?rates[rates.length-1]:null;x.delta=rates.length?x.max-x.min:0;
    x.outliers=x.rows.filter(function(r){return common.rate!=null&&r.rate!==common.rate});return x;
  }).sort(function(a,b){if(a.mismatch!==b.mismatch)return a.mismatch?-1:1;return a.sheet.localeCompare(b.sheet)||a.machine.localeCompare(b.machine)});
  return{groups:list,issues:list.filter(function(x){return x.mismatch}),rows:allRows,scannedSheets:scannedSheets,scannedEmployees:Object.keys(employeeKeys).length,sheetCount:names.length};
}
self.onmessage=function(e){
  var d=e.data||{};
  if(d.type!=='scan')return;
  try{
    var result=analyze(d.buffer,d.mode||'monthly');
    postMessage({type:'done',jobId:d.jobId,result:result});
  }catch(err){
    postMessage({type:'error',jobId:d.jobId,message:err&&err.message?err.message:String(err)});
  }
};