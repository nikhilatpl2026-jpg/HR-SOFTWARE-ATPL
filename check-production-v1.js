/* ATPL Check Production V1
 * Standalone add-on. Reads daily quantity columns, allocates by actual machine/location code,
 * supports machine rates, employee/machine/card summaries and Excel export.
 */
(function(g){
'use strict';
if(!g||g.__ATPL_CHECK_PRODUCTION_V1__)return;
g.__ATPL_CHECK_PRODUCTION_V1__='2026.11.12-v1';
var S={rows:[],rates:{},file:'',month:'',card:'ALL',search:'',loaded:false};
function q(id){return document.getElementById(id)}
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])})}
function n(v){if(typeof v==='number'&&isFinite(v))return v;var x=Number(String(v==null?'':v).replace(/[₹,\s]/g,''));return isFinite(x)?x:0}
function fmt(v){return Number(v||0).toLocaleString('en-IN',{maximumFractionDigits:2})}
function norm(v){return String(v==null?'':v).trim().toLowerCase().replace(/\s+/g,' ')}
function machine(v){return String(v==null?'':v).trim().toUpperCase().replace(/[\s._/-]+/g,'')}
function cardOf(m){var x=machine(m).match(/^C(\d+)/);return x?'CARD '+String(Number(x[1])).padStart(2,'0'):'UNASSIGNED'}
function headers(ws,range){
 var last=Math.min(range.e.r,range.s.r+10);
 for(var r=range.s.r;r<=last;r++){
  var h={row:r,code:-1,name:-1,loc:-1,rate:-1,days:[]};
  for(var c=range.s.c;c<=range.e.c;c++){
   var v=ws[XLSX.utils.encode_cell({r:r,c:c})],x=norm(v&&v.v);
   if(h.code<0&&/^(code|emp code|employee code|staff code|worker code|token)$/.test(x))h.code=c;
   if(h.name<0&&/^(name|employee name|emp name|staff name|worker name)$/.test(x))h.name=c;
   if(h.loc<0&&/^(loc|loc\.|location|loctation|machine|machine code)$/.test(x))h.loc=c;
   if(h.rate<0&&/^(rate|unit rate|production rate|rate\/kg|rate per kg|per unit)$/.test(x))h.rate=c;
   var day=Number(x.replace(/[^0-9]/g,''));
   if(day>=1&&day<=31&&String(day)===x.replace(/^0+/,'')&&x!=='')h.days.push({day:day,col:c});
  }
  if(h.code>=0&&h.loc>=0&&h.days.length>=5){if(h.name<0)h.name=h.code+1;return h}
 }
 return null;
}
function parse(wb){
 var rows=[],dupes={},warnings=[],sheetCount=0;
 (wb.SheetNames||[]).forEach(function(sn){
  var ws=wb.Sheets[sn];if(!ws||!ws['!ref'])return;
  var rg=XLSX.utils.decode_range(ws['!ref']),h=headers(ws,rg);
  if(!h){warnings.push(sn+': employee/location/day columns not identified');return}
  sheetCount++;
  for(var r=h.row+1;r<=rg.e.r;r++){
   var code=String((ws[XLSX.utils.encode_cell({r:r,c:h.code})]||{}).v||'').trim();
   var name=String((ws[XLSX.utils.encode_cell({r:r,c:h.name})]||{}).v||'').trim();
   var raw=(ws[XLSX.utils.encode_cell({r:r,c:h.loc})]||{}).v;
   var mc=machine(raw);
   if(!code&&!name)continue;
   var daily={};var qty=0;
   h.days.forEach(function(d){var v=(ws[XLSX.utils.encode_cell({r:r,c:d.col})]||{}).v;var val=n(v);if(v!==null&&v!==undefined&&String(v).trim()!==''){daily[d.day]=val;qty+=val}});
   if(!mc&&!qty)continue;
   var card=cardOf(mc),rate=h.rate>=0?n((ws[XLSX.utils.encode_cell({r:r,c:h.rate})]||{}).v):0;
   var sig=[sn,code.toUpperCase(),name.toUpperCase(),mc,JSON.stringify(daily),rate].join('|');
   if(dupes[sig])continue;dupes[sig]=1;
   rows.push({code:code,name:name,machine:mc,card:card,sheet:sn,row:r+1,daily:daily,qty:Math.round(qty*1000)/1000,sourceRate:rate});
  }
 });
 return{rows:rows,warnings:warnings,sheetCount:sheetCount};
}
function recalc(){
 S.rows.forEach(function(r){var key=r.machine||'UNASSIGNED';r.rate=r.sourceRate>0?r.sourceRate:n(S.rates[key]);r.value=Math.round(r.qty*r.rate*100)/100});
}
function summary(){
 var emp={},cards={},machines={},qty=0,value=0;
 S.rows.forEach(function(r){
  qty+=r.qty;value+=r.value;
  var ek=r.code||r.name||('ROW'+r.row);
  if(!emp[ek])emp[ek]={code:r.code,name:r.name,qty:0,value:0,machines:{},rows:[]};
  emp[ek].qty+=r.qty;emp[ek].value+=r.value;emp[ek].machines[r.machine]=1;emp[ek].rows.push(r);
  if(!cards[r.card])cards[r.card]={card:r.card,qty:0,value:0,employees:{},machines:{}};
  cards[r.card].qty+=r.qty;cards[r.card].value+=r.value;cards[r.card].employees[ek]=1;cards[r.card].machines[r.machine]=1;
  if(!machines[r.machine])machines[r.machine]={machine:r.machine,card:r.card,qty:0,value:0,employees:{}};
  machines[r.machine].qty+=r.qty;machines[r.machine].value+=r.value;machines[r.machine].employees[ek]=1;
 });
 return{employees:Object.keys(emp).map(function(k){return emp[k]}),cards:Object.keys(cards).map(function(k){return cards[k]}),machines:Object.keys(machines).map(function(k){return machines[k]}),qty:qty,value:value};
}
function page(){
 var p=q('page-checkproduction');
 if(!p){var root=document.querySelector('.content')||document.querySelector('.main')||document.body;p=document.createElement('div');p.className='page';p.id='page-checkproduction';p.style.display='none';root.appendChild(p)}
 p.innerHTML='<div style="padding:18px 22px;max-width:1500px;margin:auto;color:#0f172a">'+
 '<div style="background:linear-gradient(135deg,#172554,#1d4ed8,#0891b2);padding:20px 22px;border-radius:14px;color:white;display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap"><div><div style="font-size:21px;font-weight:900">🏭 Check Production</div><div style="font-size:12px;opacity:.88;margin-top:5px">Upload monthly card-wise workbook · machine-code allocation · daily quantity & production value</div></div><div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><button id="cpUpload" style="padding:9px 14px;border:0;border-radius:8px;background:#fff;color:#1d4ed8;font-weight:800;cursor:pointer">📂 Upload Excel</button><input id="cpFile" type="file" accept=".xlsx,.xls,.csv" style="display:none"><button id="cpExport" style="padding:9px 14px;border:1px solid #bfdbfe;border-radius:8px;background:#1e40af;color:#fff;font-weight:800;cursor:pointer">⬇ Export Excel</button></div></div>'+
 '<div id="cpStatus" style="margin:12px 0;padding:11px 14px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:9px;color:#1e40af;font-size:12px">Upload your monthly workbook to calculate card-wise and machine-wise quantities. Rate can be entered per machine below.</div>'+
 '<div id="cpKpis" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin:12px 0"></div>'+
 '<div style="display:flex;gap:8px;flex-wrap:wrap;margin:12px 0"><select id="cpCard" style="padding:9px;border:1px solid #cbd5e1;border-radius:8px"><option value="ALL">All Cards</option></select><input id="cpSearch" placeholder="Search employee code / name / machine" style="min-width:240px;padding:9px;border:1px solid #cbd5e1;border-radius:8px;flex:1"><span id="cpFileName" style="font-size:11px;color:#64748b;align-self:center"></span></div>'+
 '<div style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:14px;margin:12px 0"><div style="font-weight:850;margin-bottom:9px">Machine-wise Rate Setup</div><div style="font-size:11px;color:#64748b;margin-bottom:10px">Rate is taken from an explicit Rate column if present; otherwise enter the production rate for each machine. Monthly salary is never treated as a production rate.</div><div id="cpRates" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:8px"></div></div>'+
 '<div style="background:white;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden"><div style="padding:13px 15px;border-bottom:1px solid #e2e8f0;font-weight:850">Card-wise Production Summary</div><div id="cpCards" style="overflow:auto"></div></div>'+
 '<div style="background:white;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;margin-top:12px"><div style="padding:13px 15px;border-bottom:1px solid #e2e8f0;font-weight:850">Employee & Machine Details</div><div id="cpRows" style="overflow:auto"></div></div></div>';
 bind();render();
}
function table(head,body){return'<table style="width:100%;border-collapse:collapse;font-size:12px;white-space:nowrap"><thead><tr>'+head.map(function(x){return'<th style="text-align:left;padding:10px;background:#f8fafc;color:#475569;border-bottom:1px solid #e2e8f0">'+x+'</th>'}).join('')+'</tr></thead><tbody>'+body+'</tbody></table>'}
function render(){
 if(!q('page-checkproduction'))return;
 recalc();var s=summary();
 q('cpKpis').innerHTML=[['Total Employees',s.employees.length],['Machine Entries',S.rows.length],['Total Quantity',fmt(s.qty)],['Production Value','₹'+fmt(s.value)]].map(function(x){return'<div style="background:white;border:1px solid #e2e8f0;border-radius:11px;padding:13px"><div style="font-size:10px;color:#64748b;font-weight:800;text-transform:uppercase">'+x[0]+'</div><div style="font-size:21px;font-weight:900;margin-top:5px">'+x[1]+'</div></div>'}).join('');
 var cards=s.cards.slice().sort(function(a,b){return a.card.localeCompare(b.card)});
 q('cpCard').innerHTML='<option value="ALL">All Cards</option>'+cards.map(function(c){return'<option value="'+esc(c.card)+'">'+esc(c.card)+'</option>'}).join('');
 q('cpCard').value=S.card;q('cpFileName').textContent=S.file;
 q('cpRates').innerHTML=s.machines.map(function(m){var k=m.machine||'UNASSIGNED';var rate=S.rates[k]||0;return'<label style="font-size:11px;color:#475569;border:1px solid #e2e8f0;border-radius:8px;padding:8px;display:flex;align-items:center;justify-content:space-between;gap:8px"><b>'+esc(k||'Unassigned')+'</b><input class="cpRateInput" data-machine="'+esc(k)+'" type="number" min="0" step="0.01" value="'+esc(rate)+'" placeholder="Rate" style="width:90px;padding:6px;border:1px solid #cbd5e1;border-radius:6px"></label>'}).join('')||'<span style="font-size:11px;color:#94a3b8">Upload a workbook to configure machine rates.</span>';
 q('cpCards').innerHTML=cards.length?table(['Card (from machine code)','Employees','Machines','Total Quantity','Production Value'],cards.map(function(c){return'<tr><td style="padding:10px;border-bottom:1px solid #f1f5f9;font-weight:800">'+esc(c.card)+'</td><td style="padding:10px;border-bottom:1px solid #f1f5f9">'+Object.keys(c.employees).length+'</td><td style="padding:10px;border-bottom:1px solid #f1f5f9">'+Object.keys(c.machines).length+'</td><td style="padding:10px;border-bottom:1px solid #f1f5f9">'+fmt(c.qty)+'</td><td style="padding:10px;border-bottom:1px solid #f1f5f9;font-weight:800">₹'+fmt(c.value)+'</td></tr>'}).join('')):'<div style="padding:24px;color:#64748b;text-align:center">No workbook loaded yet.</div>';
 var search=(S.search||'').toLowerCase();
 var filtered=S.rows.filter(function(r){return(S.card==='ALL'||r.card===S.card)&&(!search||[r.code,r.name,r.machine,r.card].join(' ').toLowerCase().indexOf(search)>=0)});
 q('cpRows').innerHTML=filtered.length?table(['Employee Code','Employee Name','Source Sheet','Machine / Location','Allocated Card','Daily Qty (1–31)','Total Qty','Rate','Production Value'],filtered.map(function(r){var days=Object.keys(r.daily).sort(function(a,b){return Number(a)-Number(b)}).map(function(d){return d+': '+fmt(r.daily[d])}).join(' · ');return'<tr><td style="padding:9px;border-bottom:1px solid #f1f5f9;font-weight:800">'+esc(r.code)+'</td><td style="padding:9px;border-bottom:1px solid #f1f5f9">'+esc(r.name)+'</td><td style="padding:9px;border-bottom:1px solid #f1f5f9">'+esc(r.sheet)+'</td><td style="padding:9px;border-bottom:1px solid #f1f5f9;font-weight:800">'+esc(r.machine||'—')+'</td><td style="padding:9px;border-bottom:1px solid #f1f5f9">'+esc(r.card)+'</td><td style="padding:9px;border-bottom:1px solid #f1f5f9;max-width:280px;white-space:normal">'+esc(days||'—')+'</td><td style="padding:9px;border-bottom:1px solid #f1f5f9">'+fmt(r.qty)+'</td><td style="padding:9px;border-bottom:1px solid #f1f5f9">'+(r.rate?'₹'+fmt(r.rate):'<span style="color:#b45309">Set rate</span>')+'</td><td style="padding:9px;border-bottom:1px solid #f1f5f9;font-weight:800">₹'+fmt(r.value)+'</td></tr>'}).join('')):'<div style="padding:24px;color:#64748b;text-align:center">No matching employee entries.</div>';
}
function bind(){
 q('cpUpload').onclick=function(){q('cpFile').click()};
 q('cpFile').onchange=function(){var f=this.files&&this.files[0];if(!f)return;if(typeof XLSX==='undefined'){alert('Excel reader is not loaded.');return}var rd=new FileReader();rd.onload=function(e){try{var wb=XLSX.read(new Uint8Array(e.target.result),{type:'array'});var result=parse(wb);S.rows=result.rows;S.file=f.name;S.month=(f.name.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[-_ ]?\d{2,4}/i)||[])[0]||'';S.loaded=true;S.card='ALL';S.search='';var machines={};S.rows.forEach(function(r){machines[r.machine]=1});Object.keys(machines).forEach(function(m){if(S.rates[m]==null)S.rates[m]=0});render();var msg='Loaded '+S.rows.length+' employee-machine rows from '+result.sheetCount+' card sheets. Card allocation follows actual machine/location code.';if(result.warnings.length)msg+=' Warnings: '+result.warnings.join(' | ');q('cpStatus').textContent=msg;if(!S.rows.length)alert('No compatible daily quantity rows found. Check the uploaded workbook headers.')}catch(err){console.error(err);alert('Could not read workbook: '+err.message)}};rd.readAsArrayBuffer(f)};
 q('cpCard').onchange=function(){S.card=this.value;render()};
 q('cpSearch').oninput=function(){S.search=this.value;render()};
 q('cpRates').onchange=function(e){var t=e.target;if(t&&t.classList.contains('cpRateInput')){S.rates[t.getAttribute('data-machine')]=n(t.value);render()}};
 q('cpExport').onclick=exportXlsx;
}
function exportXlsx(){
 if(!S.rows.length){alert('Upload workbook first.');return}if(typeof XLSX==='undefined'){alert('Excel export library unavailable.');return}
 var s=summary(),wb=XLSX.utils.book_new();
 var cardRows=[['Card','Employees','Machines','Total Quantity','Production Value']];s.cards.forEach(function(c){cardRows.push([c.card,Object.keys(c.employees).length,Object.keys(c.machines).length,c.qty,c.value])});
 var detail=[['Employee Code','Employee Name','Source Sheet','Source Row','Machine Code','Allocated Card','Total Quantity','Rate','Production Value']];
 S.rows.forEach(function(r){detail.push([r.code,r.name,r.sheet,r.row,r.machine,r.card,r.qty,r.rate,r.value])});
 var daily=[['Employee Code','Employee Name','Machine Code','Allocated Card','Day','Quantity']];S.rows.forEach(function(r){Object.keys(r.daily).forEach(function(d){daily.push([r.code,r.name,r.machine,r.card,Number(d),r.daily[d]])})});
 XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(cardRows),'Card Summary');
 XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(detail),'Employee Machine');
 XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(daily),'Daily Qty');
 XLSX.writeFile(wb,'ATPL_Check_Production_'+(S.month||'Report')+'.xlsx');
}
function ensureNav(){
 var sub=q('cat-sal');if(!sub)return;
 if(!q('vn-checkproduction')){var item=document.createElement('div');item.className='vitem';item.id='vn-checkproduction';item.setAttribute('onclick','goPage("checkproduction")');item.innerHTML='<span class="vi">🏭</span>Check Production <span class="vbadge" style="background:#2563eb">NEW</span>';var anchor=q('vn-attendanceaudit')||q('vn-machineaudit');if(anchor&&anchor.parentNode===sub)sub.insertBefore(item,anchor.nextSibling);else sub.appendChild(item)}
}
function patchGoPage(){
 if(typeof g.goPage!=='function'||g.goPage.__cpWrapped)return;
 var orig=g.goPage;function wrapped(name){var out=orig.apply(this,arguments);if(name==='checkproduction'){var sub=q('cat-sal');if(sub)sub.classList.remove('collapsed');var arr=q('arr-sal');if(arr)arr.style.transform='rotate(0deg)';page();var p=q('page-checkproduction');if(p)p.style.display='block'}return out}
 wrapped.__cpWrapped=true;wrapped.__original=orig;g.goPage=wrapped;
}
function boot(){ensureNav();patchGoPage();if(q('page-checkproduction'))return}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
setTimeout(boot,700);setTimeout(boot,1800);
g.ATPLCheckProduction={state:S,parseWorkbook:parse,render:render,exportExcel:exportXlsx};
})(window);