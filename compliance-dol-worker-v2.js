/* ATPL Compliance Challan Worker V2
   Isolated Excel/CSV parser for ESIC/PF challans.
   Keeps XLSX parsing off the ERP main UI thread.
*/
'use strict';
importScripts('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');

function normDigits(v){
  if(typeof v==='number'&&isFinite(v)){if(Math.floor(v)!==v)return'';return String(v)}
  var s=String(v==null?'':v).trim().replace(/^['"]|['"]$/g,'');if(!s)return'';
  var m=s.match(/^([+-]?)(\d+)(?:\.(\d*))?[eE]([+-]?\d+)$/);
  if(m){
    var sign=m[1]==='-'?'-':'',ints=m[2],frac=m[3]||'',exp=parseInt(m[4],10),digits=ints+frac,pos=ints.length+exp;
    if(pos<=0){digits='0'.repeat(-pos)+digits;pos=0}
    if(pos>=digits.length)digits=digits+'0'.repeat(pos-digits.length);else digits=digits.slice(0,pos)+'.'+digits.slice(pos);
    s=sign+digits.replace(/^0+(?=\d)/,'').replace(/\.0+$/,'')
  }
  s=s.replace(/\.0+$/,'').trim();
  if(/^\d+$/.test(s))return s;
  if(/^\d[\d\s/_-]*\d$/.test(s))return s.replace(/\D/g,'');
  return''
}
function normAlpha(v){return String(v==null?'':v).toUpperCase().replace(/[^A-Z0-9]/g,'')}
function headerLooksLike(type,v){
  var x=String(v==null?'':v).toLowerCase().replace(/[^a-z0-9]/g,'');
  if(type==='esic')return /^(ip|ipno|ipnumber|insuranceno|insurancenumber|esic|esicno|esicnumber|esi|esino|esinumber)$/.test(x);
  return /^(uan|uanno|uannumber|pfno|pfnumber|memberid|memberno|pfmemberid|pfmemberno)$/.test(x)
}
function addTokens(v,digits,alnums){
  var s=String(v==null?'':v).trim();if(!s)return;
  var d=normDigits(v),a=normAlpha(s);
  if(d.length>=8&&d.length<=20)digits.add(d);
  if(a.length>=8&&a.length<=32&&/\d/.test(a))alnums.add(a);
  var dm=s.match(/\d(?:[\d\s/_.-]{6,24}\d)/g)||[];
  dm.forEach(function(x){var y=normDigits(x);if(y.length>=8&&y.length<=20)digits.add(y)});
  var am=s.match(/[A-Za-z0-9][A-Za-z0-9/_.-]{7,31}/g)||[];
  am.forEach(function(x){var y=normAlpha(x);if(y.length>=8&&y.length<=32&&/\d/.test(y))alnums.add(y)});
}
function cell(ws,r,c){return ws[XLSX.utils.encode_cell({r:r,c:c})]}
function parse(buffer,type){
  var wb=XLSX.read(buffer,{type:'array',cellDates:false,cellText:true,cellStyles:false,cellFormula:false});
  var digits=new Set(),alnums=new Set(),fallbackDigits=new Set(),fallbackAlnums=new Set(),sample='',cells=0,specific=0,viewerSheets=[];
  for(var si=0;si<wb.SheetNames.length;si++){
    var sn=wb.SheetNames[si],ws=wb.Sheets[sn];if(!ws||!ws['!ref']){viewerSheets.push({name:sn,rows:[]});continue}
    var range=XLSX.utils.decode_range(ws['!ref']),cols=new Set(),rows=[];
    for(var hr=range.s.r;hr<=Math.min(range.e.r,range.s.r+19);hr++){
      for(var hc=range.s.c;hc<=range.e.c;hc++){
        var h=cell(ws,hr,hc);if(h&&headerLooksLike(type,h.v!=null?h.v:h.w))cols.add(hc)
      }
    }
    for(var R=range.s.r;R<=range.e.r;R++){
      var row=[];
      for(var C=range.s.c;C<=range.e.c;C++){
        var ce=cell(ws,R,C),raw=ce?(ce.v!=null?ce.v:ce.w):'',display=ce?(ce.w!=null?ce.w:raw):'';
        row.push(display==null?'':String(display));
        if(raw==null||raw==='')continue;
        cells++;if(sample.length<20000)sample+=' '+String(display);
        addTokens(raw,fallbackDigits,fallbackAlnums);
        if(cols.has(C)){var before=digits.size+alnums.size;addTokens(raw,digits,alnums);if(typeof raw!=='number'&&display!==raw)addTokens(display,digits,alnums);if(digits.size+alnums.size>before)specific++}
      }
      rows.push(row)
    }
    viewerSheets.push({name:sn,rows:rows});
    postMessage({type:'progress',stage:'Parsing '+sn,percent:Math.round(((si+1)/Math.max(1,wb.SheetNames.length))*90)})
  }
  if(!specific){digits=fallbackDigits;alnums=fallbackAlnums}
  return{digits:Array.from(digits),alnums:Array.from(alnums),sample:sample.slice(0,20000),detail:wb.SheetNames.length+' sheets · '+cells+' cells scanned · '+(specific?'ID column indexed':'safe fallback scan'),viewerSheets:viewerSheets}
}
self.onmessage=function(e){
  var d=e.data||{};
  try{var result=parse(d.buffer,d.type||'esic');postMessage({type:'done',jobId:d.jobId,result:result})}
  catch(err){postMessage({type:'error',jobId:d.jobId,message:err&&err.message?err.message:String(err)})}
};