/* ATPL DOL Contribution Index V1 — pure parsing helpers used by browser and tests. */
(function(root,factory){
  var api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.ATPLDOLIndexV1=api;
})(typeof window!=='undefined'?window:this,function(){
'use strict';

function text(v){return v==null?'':String(v).replace(/\s+/g,' ').trim()}
function digits(v){
  var s=text(v).replace(/^['"]|['"]$/g,'').replace(/\.0+$/,'');
  if(/^\d+$/.test(s))return s;
  if(/^\d[\d\s/_.-]*\d$/.test(s))return s.replace(/\D/g,'');
  return''
}
function alpha(v){return text(v).toUpperCase().replace(/[^A-Z0-9]/g,'')}
function validId(type,v){
  var d=digits(v),a=alpha(v);if(type==='esic')return d.length===10?d:'';
  if(d.length===12)return d;
  return a.length>=8&&a.length<=32&&/\d/.test(a)?a:''
}
function header(v){return text(v).toLowerCase().replace(/[^a-z0-9]/g,'')}
function role(type,v){
  var h=header(v);if(!h)return'';
  if(type==='esic'&&/^(ip|ipno|ipnumber|insuranceno|insurancenumber|esic|esicno|esicnumber|esi|esino|esinumber)$/.test(h))return'id';
  if(type==='pf'&&/^(uan|uanno|uannumber|pfno|pfnumber|memberid|memberno|pfmemberid|pfmemberno)$/.test(h))return'id';
  if(/^(employeename|empname|membername|ipname|insuredpersonname|name)$/.test(h))return'name';
  if(/^(days|paiddays|contributiondays|nodays|workingdays)$/.test(h))return'days';
  if(/^(grosswages|totalwages|wages|gross|monthlywages)$/.test(h))return'wages';
  if(/^(employershare|employercontribution|ercontribution|ershare|employeramount)$/.test(h))return'employerContribution';
  if(/^(employeeshare|employeecontribution|eecontribution|eeshare|employeeamount|ipcontribution)$/.test(h))return'employeeContribution';
  if(/^(totalcontribution|contributionamount|totalamount|totalcontributionamount)$/.test(h))return'totalContribution';
  if(/^(epfwages|pfwages)$/.test(h))return'pfWages';
  if(/^(epswages|pensionwages)$/.test(h))return'pensionWages';
  if(/^(epfcontribution|pfcontribution)$/.test(h))return'pfContribution';
  if(/^(epscontribution|pensioncontribution)$/.test(h))return'pensionContribution';
  if(/^(ncpdays)$/.test(h))return'ncpDays';
  return''
}
function cleanValue(v){var s=text(v);return s.length>120?s.slice(0,120):s}
function bestHeader(rows,type){
  var best=null,limit=Math.min(35,(rows||[]).length);
  for(var r=0;r<limit;r++){
    var map={},score=0,row=rows[r]||[];
    for(var c=0;c<row.length;c++){var k=role(type,row[c]);if(k&&!Object.prototype.hasOwnProperty.call(map,k)){map[k]=c;score+=k==='id'?8:1}}
    if(map.id!=null&&(!best||score>best.score))best={row:r,map:map,score:score}
  }
  return best
}
function mergeEntry(out,entry){
  var old=out[entry.memberId];if(!old){out[entry.memberId]=entry;return}
  if(!old.employeeName&&entry.employeeName)old.employeeName=entry.employeeName;
  Object.keys(entry.details||{}).forEach(function(k){if(!old.details[k]&&entry.details[k])old.details[k]=entry.details[k]})
}
function fromRows(rows,type){
  rows=Array.isArray(rows)?rows:[];var h=bestHeader(rows,type),out={},ids={};
  if(h){
    for(var r=h.row+1;r<rows.length;r++){
      var row=rows[r]||[],id=validId(type,row[h.map.id]);if(!id)continue;
      var details={};Object.keys(h.map).forEach(function(k){if(k==='id'||k==='name')return;var v=cleanValue(row[h.map[k]]);if(v)details[k]=v});
      mergeEntry(out,{memberId:id,employeeName:h.map.name==null?'':cleanValue(row[h.map.name]),details:details});ids[id]=1
    }
  }
  if(!Object.keys(ids).length){
    rows.forEach(function(row){(row||[]).forEach(function(v){var id=validId(type,v);if(id){ids[id]=1;if(!out[id])out[id]={memberId:id,employeeName:'',details:{}}}})})
  }
  return{ids:Object.keys(ids),contributions:Object.keys(out).map(function(k){return out[k]})}
}
function fromSheets(sheets,type){
  var ids={},entries={};(Array.isArray(sheets)?sheets:[]).forEach(function(sh){
    var p=fromRows(sh&&sh.rows,type);p.ids.forEach(function(id){ids[id]=1});p.contributions.forEach(function(e){mergeEntry(entries,e)})
  });
  return{ids:Object.keys(ids),contributions:Object.keys(entries).map(function(k){return entries[k]})}
}
function nameFromLine(line,id){
  var at=line.indexOf(id),rest=at>=0?line.slice(at+id.length):line;
  rest=rest.replace(/^\s*[-:|,]?\s*/,'');
  var parts=rest.split(/\s{2,}|\t|\|/).map(text).filter(Boolean),name=parts[0]||'';
  if(!name||/^[-+]?\d[\d,./-]*$/.test(name))return'';
  return name.replace(/\s+[-+]?\d[\d,./-]*(?:\s+[-+]?\d[\d,./-]*)*$/,'').slice(0,120)
}
function fromTextLines(lines,type){
  var ids={},out={};(Array.isArray(lines)?lines:[]).forEach(function(raw){
    var line=text(raw),matches=type==='esic'?(line.match(/\b\d{10}\b/g)||[]):(line.match(/\b\d{12}\b|\b[A-Z]{2,6}[A-Z0-9/_.-]{6,28}\b/gi)||[]);
    matches.forEach(function(x){var id=validId(type,x);if(!id)return;ids[id]=1;mergeEntry(out,{memberId:id,employeeName:nameFromLine(line,x),details:{line:line.slice(0,300)}})})
  });
  return{ids:Object.keys(ids),contributions:Object.keys(out).map(function(k){return out[k]})}
}
function latest(matches){
  var rows=(Array.isArray(matches)?matches:[]).filter(function(x){return /^20\d{2}-(0[1-9]|1[0-2])$/.test(text(x&&x.period))});
  rows.sort(function(a,b){return text(a.period).localeCompare(text(b.period))||text(a.updatedAt).localeCompare(text(b.updatedAt))});
  return rows.length?rows[rows.length-1]:null
}
function detailsText(d){
  d=d&&typeof d==='object'?d:{};var labels={days:'Days',wages:'Wages',pfWages:'PF Wages',pensionWages:'Pension Wages',employeeContribution:'Employee',employerContribution:'Employer',totalContribution:'Total',pfContribution:'PF',pensionContribution:'Pension'};
  return Object.keys(labels).filter(function(k){return text(d[k])}).map(function(k){return labels[k]+': '+text(d[k])}).join(' · ')
}
return{validId:validId,fromRows:fromRows,fromSheets:fromSheets,fromTextLines:fromTextLines,latest:latest,detailsText:detailsText};
});
