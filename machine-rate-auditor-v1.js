/* ATPL Machine Rate Auditor V1
   Independent from existing Salary Audit. It reads attendance/payroll workbooks and flags
   inconsistent rates only inside the SAME sheet + SAME exact machine/location code.
   Example: Card no-1 C1C compares only with Card no-1 C1C. C1R/C1CH/C1O/C3C are separate. */
(function(g){'use strict';
if(!g||g.__ATPL_MACHINE_RATE_AUDITOR_V1__)return;
g.__ATPL_MACHINE_RATE_AUDITOR_V1__='2026.09.18-1';

var state={file:null,wb:null,groups:[],issues:[],rows:[],filter:'all',scannedSheets:0,scannedEmployees:0};
function q(id){return document.getElementById(id)}
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function norm(v){return String(v==null?'':v).trim().toLowerCase().replace(/\s+/g,' ')}
function machine(v){return String(v==null?'':v).trim().toUpperCase().replace(/[\s\-_/]+/g,'')}
function num(v){
  if(typeof v==='number'&&isFinite(v))return v;
  var s=String(v==null?'':v).replace(/[₹,\s]/g,'').trim();
  if(!s)return null;var n=Number(s);return isFinite(n)?n:null;
}
function money(v){
  var n=Number(v);if(!isFinite(n))return '—';
  var dec=Math.abs(n-Math.round(n))>0.0001?2:0;
  try{return '₹'+n.toLocaleString('en-IN',{minimumFractionDigits:dec,maximumFractionDigits:2})}catch(_){return '₹'+n.toFixed(dec)}
}
function machineOk(s){return /^C\d+[A-Z0-9.]*$/.test(s)}
function cardFromSheet(sn){var m=String(sn||'').match(/card\s*no\.?[-\s]*([0-9]+)/i);return m?String(Number(m[1])):''}
function cardFromMachine(mc){var m=String(mc||'').match(/^C(\d+)/);return m?String(Number(m[1])):''}
function codeText(v){if(typeof v==='number'&&isFinite(v))return String(Math.trunc(v));return String(v==null?'':v).trim()}

function findHeader(rows){
  var lim=Math.min(rows.length,12);
  for(var r=0;r<lim;r++){
    var row=rows[r]||[],h=row.map(norm);
    var code=-1,loc=-1,sal=-1,name=-1;
    for(var c=0;c<h.length;c++){
      var x=h[c];
      if(code<0&&(x==='code'||x==='emp code'||x==='employee code'||x==='staff code'||x==='worker code'||x==='card no'))code=c;
      if(loc<0&&(x==='loc'||x==='loc.'||x==='location'||x==='loctation'||x.indexOf('location')>=0||x.indexOf('loctation')>=0))loc=c;
      if(sal<0&&(x==='salary'||x==='salry'||x==='rate'||x==='salary rate'||x.indexOf('salary')>=0||x.indexOf('salry')>=0))sal=c;
      if(name<0&&(x==='name'||x==='employee name'||x==='emp name'||x==='staff name'||x==='worker name'))name=c;
    }
    if(code>=0&&loc>=0&&sal>=0){
      if(name<0)name=code+1<h.length?code+1:1;
      return{row:r,code:code,name:name,loc:loc,salary:sal};
    }
  }
  return null;
}
function mostCommon(counter){
  var keys=Object.keys(counter),best=null,bestCount=-1,tie=false;
  keys.forEach(function(k){var n=counter[k];if(n>bestCount){best=k;bestCount=n;tie=false}else if(n===bestCount){tie=true}});
  return{rate:best==null?null:Number(best),count:bestCount,tie:tie};
}
function analyzeWorkbook(wb){
  var groups={},allRows=[],scannedSheets=0,employeeKeys={};
  (wb.SheetNames||[]).forEach(function(sn){
    var ws=wb.Sheets[sn];if(!ws||!ws['!ref'])return;
    var rows=XLSX.utils.sheet_to_json(ws,{header:1,raw:true,defval:null,blankrows:true});
    var hdr=findHeader(rows);if(!hdr)return;
    scannedSheets++;
    var sheetCard=cardFromSheet(sn);
    for(var r=hdr.row+1;r<rows.length;r++){
      var row=rows[r]||[];
      var mc=machine(row[hdr.loc]);if(!machineOk(mc))continue;
      var rate=num(row[hdr.salary]);if(rate==null||rate<=0)continue;
      var empCode=codeText(row[hdr.code]),name=String(row[hdr.name]==null?'':row[hdr.name]).trim();
      var machineCard=cardFromMachine(mc);
      var rec={sheet:sn,row:r+1,card:sheetCard,machine:mc,code:empCode,name:name,rate:rate,crossCard:!!(sheetCard&&machineCard&&sheetCard!==machineCard)};
      allRows.push(rec);if(empCode||name)employeeKeys[(empCode||'')+'|'+name.toLowerCase()]=1;
      var key=sn+'||'+mc;
      if(!groups[key])groups[key]={key:key,sheet:sn,card:sheetCard,machine:mc,rows:[],rates:{}};
      groups[key].rows.push(rec);
      var rk=String(rate);groups[key].rates[rk]=(groups[key].rates[rk]||0)+1;
    }
  });
  var list=Object.keys(groups).map(function(k){
    var g0=groups[k],rateKeys=Object.keys(g0.rates).map(Number).sort(function(a,b){return a-b}),common=mostCommon(g0.rates);
    g0.rateList=rateKeys;g0.common=common.rate;g0.commonCount=common.count;g0.tie=common.tie;g0.mismatch=rateKeys.length>1;
    g0.min=rateKeys.length?rateKeys[0]:null;g0.max=rateKeys.length?rateKeys[rateKeys.length-1]:null;g0.delta=rateKeys.length?g0.max-g0.min:0;
    g0.outliers=g0.rows.filter(function(x){return common.rate!=null&&x.rate!==common.rate});
    return g0;
  }).sort(function(a,b){if(a.mismatch!==b.mismatch)return a.mismatch?-1:1;return a.sheet.localeCompare(b.sheet)||a.machine.localeCompare(b.machine)});
  state.groups=list;state.issues=list.filter(function(x){return x.mismatch});state.rows=allRows;state.scannedSheets=scannedSheets;state.scannedEmployees=Object.keys(employeeKeys).length;
}
function makePage(){
  if(q('page-machineaudit'))return;
  var content=document.querySelector('.content');if(!content)return;
  var page=document.createElement('div');page.className='page';page.id='page-machineaudit';
  page.innerHTML=
  '<div class="mra-shell">'+
    '<div class="mra-head">'+
      '<div><div class="mra-eyebrow">SALARY PAYROLL / MACHINE CONTROL</div><div class="mra-title">Machine Rate Audit</div><div class="mra-sub">Same card sheet + same exact machine code ki employee rates compare hoti hain. C1C ≠ C1R ≠ C1CH ≠ C1O; C1C ko C3C se kabhi compare nahi kiya jayega.</div></div>'+
      '<label class="mra-upload">📤 Upload Attendance / Salary Sheet<input id="mraFile" type="file" accept=".xlsx,.xls,.csv"></label>'+
    '</div>'+
    '<div class="mra-filebar" id="mraFileBar"><span class="mra-fileicon">📄</span><div><b>No file selected</b><small>Attendance workbook upload karo</small></div><span class="mra-ready">READY</span></div>'+
    '<div class="mra-kpis">'+
      '<div class="mra-kpi"><span>Machines Scanned</span><b id="mraMachines">0</b><small>exact machine groups</small></div>'+
      '<div class="mra-kpi"><span>Employees</span><b id="mraEmployees">0</b><small>with machine rate</small></div>'+
      '<div class="mra-kpi danger"><span>Mismatch Groups</span><b id="mraMismatch">0</b><small>same machine, different rate</small></div>'+
      '<div class="mra-kpi"><span>Sheets Scanned</span><b id="mraSheets">0</b><small>valid attendance sheets</small></div>'+
    '</div>'+
    '<div class="mra-toolbar">'+
      '<div><b>Rate Consistency Exceptions</b><small>Only exact machine-code mismatches are shown as errors.</small></div>'+
      '<div class="mra-tools"><select id="mraFilter"><option value="all">All machine groups</option><option value="mismatch">Mismatch only</option><option value="ok">Consistent only</option></select><button id="mraDownload" disabled>⬇ Export Audit</button></div>'+
    '</div>'+
    '<div class="mra-body" id="mraResults"><div class="mra-empty"><div>⚙️</div><b>Machine Rate Audit Ready</b><span>Attendance workbook upload karo. Software sheet-wise exact machine code aur salary/rate compare karega.</span></div></div>'+
  '</div>';
  content.appendChild(page);
  q('mraFile').addEventListener('change',onFile);
  q('mraFilter').addEventListener('change',function(){state.filter=this.value;render()});
  q('mraDownload').addEventListener('click',download);
}
function addCss(){
  if(q('mra-style'))return;var s=document.createElement('style');s.id='mra-style';
  s.textContent=
  '#page-machineaudit{background:#f7f8fb!important;overflow:auto!important}.mra-shell{padding:16px;overflow:auto;min-height:100%}.mra-head{display:flex;justify-content:space-between;gap:20px;align-items:center;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:18px 20px}.mra-eyebrow{font-size:8px;font-weight:900;letter-spacing:1.3px;color:#8b5cf6;margin-bottom:5px}.mra-title{font-size:20px;font-weight:850;color:#111827;letter-spacing:-.4px}.mra-sub{font-size:10px;color:#64748b;margin-top:5px;max-width:760px;line-height:1.6}.mra-upload{position:relative;display:inline-flex;align-items:center;justify-content:center;min-width:215px;padding:10px 13px;border-radius:8px;background:#312e81;color:#fff;font-size:10px;font-weight:800;cursor:pointer;box-shadow:0 1px 2px rgba(15,23,42,.08)}.mra-upload input{position:absolute;inset:0;opacity:0;cursor:pointer}.mra-filebar{margin-top:10px;display:flex;align-items:center;gap:10px;background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:10px 13px;font-size:10px}.mra-filebar>div{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}.mra-filebar b{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#334155}.mra-filebar small{color:#94a3b8}.mra-fileicon{font-size:18px}.mra-ready{font-size:8px;font-weight:900;color:#15803d;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:999px;padding:4px 7px}.mra-kpis{display:grid;grid-template-columns:repeat(4,minmax(150px,1fr));gap:8px;margin-top:10px}.mra-kpi{background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:11px 13px;display:flex;flex-direction:column;gap:4px}.mra-kpi span{font-size:8px;text-transform:uppercase;letter-spacing:.8px;color:#64748b;font-weight:800}.mra-kpi b{font-size:20px;color:#111827}.mra-kpi small{font-size:8px;color:#94a3b8}.mra-kpi.danger b{color:#dc2626}.mra-toolbar{margin-top:10px;display:flex;align-items:center;justify-content:space-between;gap:10px;background:#fff;border:1px solid #e5e7eb;border-radius:10px 10px 0 0;padding:11px 13px}.mra-toolbar>div:first-child{display:flex;flex-direction:column;gap:2px}.mra-toolbar b{font-size:11px;color:#334155}.mra-toolbar small{font-size:8px;color:#94a3b8}.mra-tools{display:flex;gap:6px}.mra-tools select,.mra-tools button{height:30px;border:1px solid #d1d5db;border-radius:7px;background:#fff;padding:0 9px;font-size:9px;font-weight:700;color:#475569}.mra-tools button{background:#312e81;color:#fff;border-color:#312e81;cursor:pointer}.mra-tools button:disabled{opacity:.35;cursor:not-allowed}.mra-body{background:#fff;border:1px solid #e5e7eb;border-top:0;border-radius:0 0 10px 10px;min-height:280px;padding:10px}.mra-empty{min-height:260px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:7px;color:#94a3b8;text-align:center}.mra-empty>div{font-size:38px;opacity:.35}.mra-empty b{font-size:13px;color:#475569}.mra-empty span{font-size:9px;max-width:500px;line-height:1.6}.mra-group{border:1px solid #e5e7eb;border-radius:9px;margin-bottom:8px;overflow:hidden}.mra-group.bad{border-color:#fecaca}.mra-gh{display:grid;grid-template-columns:140px 150px 1fr 130px;gap:10px;align-items:center;padding:10px 12px;background:#f8fafc}.mra-group.bad .mra-gh{background:#fff7f7}.mra-machine{font-size:12px;font-weight:900;color:#312e81}.mra-sheet{font-size:9px;color:#64748b;font-weight:700}.mra-rates{display:flex;gap:5px;flex-wrap:wrap}.mra-rate{font-size:9px;font-weight:850;padding:4px 7px;border-radius:999px;background:#f1f5f9;color:#475569;border:1px solid #e2e8f0}.mra-rate.bad{background:#fef2f2;color:#b91c1c;border-color:#fecaca}.mra-status{text-align:right}.mra-pill{display:inline-flex;padding:4px 7px;border-radius:999px;font-size:8px;font-weight:900}.mra-pill.bad{background:#fee2e2;color:#b91c1c}.mra-pill.ok{background:#dcfce7;color:#15803d}.mra-table{width:100%;border-collapse:collapse}.mra-table th{position:static!important;background:#fff!important;color:#94a3b8!important;border:0!important;border-top:1px solid #eef2f7!important;border-bottom:1px solid #eef2f7!important;padding:6px 10px!important;font-size:8px!important}.mra-table td{padding:7px 10px!important;font-size:9px!important;border:0!important;border-bottom:1px solid #f3f4f6!important}.mra-table tr:last-child td{border-bottom:0!important}.mra-table tr.outlier td{background:#fff7f7!important}.mra-diff{font-weight:900;color:#dc2626}.mra-muted{color:#94a3b8}.mra-note{padding:8px 10px;font-size:8px;color:#92400e;background:#fffbeb;border-top:1px solid #fde68a}.mra-summarybad{margin-bottom:9px;padding:9px 11px;border:1px solid #fecaca;background:#fef2f2;border-radius:8px;color:#991b1b;font-size:9px;font-weight:700}@media(max-width:900px){.mra-kpis{grid-template-columns:repeat(2,1fr)}.mra-head,.mra-toolbar{align-items:flex-start;flex-direction:column}.mra-gh{grid-template-columns:1fr 1fr}.mra-upload{width:100%}}';
  document.head.appendChild(s)
}
function ensureNav(){
  var sub=q('cat-sal');if(!sub)return;
  var item=q('vn-machineaudit');
  if(!item){item=document.createElement('div');item.className='vitem';item.id='vn-machineaudit';item.setAttribute('onclick',"goPage('machineaudit')");item.innerHTML='<span class="vi">⚙️</span>Machine Rate Audit';var audit=q('vn-audit'),bank=q('vn-bankverify');if(audit&&audit.parentNode===sub)sub.insertBefore(item,audit.nextSibling);else if(bank&&bank.parentNode===sub)sub.insertBefore(item,bank);else sub.appendChild(item)}
}
function patchGo(){
  if(typeof g.goPage!=='function'||g.goPage.__mraWrapped)return;
  var old=g.goPage;function w(name){var r=old.apply(this,arguments);if(name==='machineaudit'){var sub=q('cat-sal');if(sub)sub.classList.remove('collapsed');var arr=q('arr-sal');if(arr)arr.style.transform='rotate(0deg)'}return r}
  w.__mraWrapped=true;w.__original=old;g.goPage=w;
}
async function onFile(e){
  var file=e.target.files&&e.target.files[0];if(!file)return;
  try{
    var buf=await file.arrayBuffer(),wb=XLSX.read(buf,{type:'array',cellDates:false,cellText:true});
    state.file=file;state.wb=wb;state.filter='all';q('mraFilter').value='all';
    analyzeWorkbook(wb);render();
    q('mraFileBar').innerHTML='<span class="mra-fileicon">📊</span><div><b>'+esc(file.name)+'</b><small>'+wb.SheetNames.length+' workbook sheets · '+state.scannedSheets+' rate-capable sheets scanned</small></div><span class="mra-ready">AUDITED</span>';
    q('mraDownload').disabled=false;
  }catch(err){console.error(err);alert('Machine Rate Audit file read nahi kar paya: '+(err&&err.message?err.message:err))}
}
function visibleGroups(){
  if(state.filter==='mismatch')return state.groups.filter(function(x){return x.mismatch});
  if(state.filter==='ok')return state.groups.filter(function(x){return !x.mismatch});
  return state.groups;
}
function render(){
  q('mraMachines').textContent=state.groups.length;q('mraEmployees').textContent=state.scannedEmployees;q('mraMismatch').textContent=state.issues.length;q('mraSheets').textContent=state.scannedSheets;
  var groups=visibleGroups(),box=q('mraResults');
  if(!state.file){box.innerHTML='<div class="mra-empty"><div>⚙️</div><b>Machine Rate Audit Ready</b><span>Attendance workbook upload karo. Software sheet-wise exact machine code aur salary/rate compare karega.</span></div>';return}
  if(!groups.length){box.innerHTML='<div class="mra-empty"><div>✅</div><b>No groups in this filter</b><span>Filter change karke doosre machine groups dekho.</span></div>';return}
  var html='';
  if(state.issues.length)html+='<div class="mra-summarybad">⚠ '+state.issues.length+' exact machine group(s) me different rates mili hain. Same code ke employee rows neeche highlight hain.</div>';
  groups.forEach(function(gp){
    var rates=gp.rateList.map(function(r){return'<span class="mra-rate '+(gp.mismatch?'bad':'')+'">'+money(r)+' <small>×'+gp.rates[String(r)]+'</small></span>'}).join('');
    html+='<div class="mra-group '+(gp.mismatch?'bad':'')+'"><div class="mra-gh"><div><div class="mra-machine">'+esc(gp.machine)+'</div><div class="mra-sheet">'+esc(gp.sheet)+'</div></div><div class="mra-rates">'+rates+'</div><div style="font-size:9px;color:#64748b">'+gp.rows.length+' employee row(s) · '+(gp.mismatch?'Rate spread '+money(gp.delta):'Same rate')+'</div><div class="mra-status"><span class="mra-pill '+(gp.mismatch?'bad':'ok')+'">'+(gp.mismatch?'RATE MISMATCH':'CONSISTENT')+'</span></div></div>';
    html+='<table class="mra-table"><thead><tr><th>EMP CODE</th><th>EMPLOYEE</th><th>MACHINE</th><th>RATE</th><th>COMMON RATE</th><th>DIFFERENCE</th><th>ROW</th></tr></thead><tbody>';
    gp.rows.forEach(function(r){
      var out=gp.mismatch&&gp.common!=null&&r.rate!==gp.common,diff=gp.common==null?0:r.rate-gp.common;
      html+='<tr class="'+(out?'outlier':'')+'"><td>'+esc(r.code||'—')+'</td><td><b>'+esc(r.name||'—')+'</b></td><td>'+esc(r.machine)+'</td><td><b>'+money(r.rate)+'</b></td><td>'+(!gp.tie&&gp.common!=null?money(gp.common):'<span class="mra-muted">No clear standard</span>')+'</td><td class="'+(out?'mra-diff':'mra-muted')+'">'+(out?(diff>0?'+':'')+money(diff).replace('₹','₹'):'—')+'</td><td>'+r.row+'</td></tr>';
    });
    html+='</tbody></table>';
    if(gp.mismatch)html+='<div class="mra-note">Rule: <b>'+esc(gp.sheet)+' + '+esc(gp.machine)+'</b> ke andar rate same expected hai. '+(gp.tie?'Is group me dominant/common rate clear nahi hai, isliye dono rates review karo.':'Most-used rate '+money(gp.common)+' ko reference ke roop me dikhaya gaya hai; software automatic salary change nahi karta.')+'</div>';
    html+='</div>';
  });
  box.innerHTML=html;
}
function download(){
  if(!state.file||!state.wb)return;
  var rows=[['MACHINE RATE AUDIT'],['Source File',state.file.name],['Generated',new Date().toLocaleString()],[],['Sheet','Machine Code','Emp Code','Employee','Rate','Most Used Rate','Difference','Status','Source Row']];
  state.groups.forEach(function(gp){gp.rows.forEach(function(r){var diff=gp.common==null?0:r.rate-gp.common;rows.push([gp.sheet,gp.machine,r.code,r.name,r.rate,gp.tie?'':gp.common,gp.tie?'':diff,gp.mismatch?'MISMATCH':'OK',r.row])})});
  var summary=[['MACHINE RATE SUMMARY'],[],['Sheet','Machine Code','Employees','Rates Found','Most Used Rate','Spread','Status']];
  state.groups.forEach(function(gp){summary.push([gp.sheet,gp.machine,gp.rows.length,gp.rateList.map(function(x){return x+' x'+gp.rates[String(x)]}).join(' | '),gp.tie?'':gp.common,gp.delta,gp.mismatch?'MISMATCH':'OK'])});
  var out=XLSX.utils.book_new();XLSX.utils.book_append_sheet(out,XLSX.utils.aoa_to_sheet(summary),'SUMMARY');XLSX.utils.book_append_sheet(out,XLSX.utils.aoa_to_sheet(rows),'DETAIL');
  XLSX.writeFile(out,'Machine_Rate_Audit_'+state.file.name.replace(/\.(xlsx|xls|csv)$/i,'')+'.xlsx');
}
function boot(){addCss();makePage();ensureNav();patchGo();setTimeout(function(){ensureNav();patchGo()},1000);setInterval(ensureNav,5000)}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})(window);