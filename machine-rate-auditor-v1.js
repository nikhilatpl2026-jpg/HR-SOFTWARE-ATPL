/* ATPL Machine Rate Auditor V2
   Independent from existing Salary Audit.
   Modes:
   - Monthly Rate: salary values like 14500 / 15500 / 18000.
   - Rate/KG: piece/kg values like 1.80 / 2.25 / 3.25.
   Comparison is always SAME sheet + SAME exact machine code.
*/
(function(g){'use strict';
if(!g||g.__ATPL_MACHINE_RATE_AUDITOR_V2__)return;
g.__ATPL_MACHINE_RATE_AUDITOR_V2__='2026.09.18-2';

var state={file:null,wb:null,groups:[],issues:[],rows:[],filter:'all',mode:'monthly',scannedSheets:0,scannedEmployees:0};
function q(id){return document.getElementById(id)}
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function norm(v){return String(v==null?'':v).trim().toLowerCase().replace(/\s+/g,' ')}
function rawMachine(v){return String(v==null?'':v).trim().toUpperCase().replace(/[\s\-_/]+/g,'')}
function num(v){if(typeof v==='number'&&isFinite(v))return v;var s=String(v==null?'':v).replace(/[₹,\s]/g,'').trim();if(!s)return null;var n=Number(s);return isFinite(n)?n:null}
function money(v){var n=Number(v);if(!isFinite(n))return '—';var dec=Math.abs(n-Math.round(n))>0.0001?2:0;try{return '₹'+n.toLocaleString('en-IN',{minimumFractionDigits:dec,maximumFractionDigits:2})}catch(_){return '₹'+n.toFixed(dec)}}
function kg(v){var n=Number(v);if(!isFinite(n))return '—';return n.toFixed(Math.abs(n-Math.round(n))<0.0001?0:2).replace(/0+$/,'').replace(/\.$/,'')+' /kg'}
function rateText(v){return state.mode==='kg'?kg(v):money(v)}
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
function canonicalMachine(raw,rate){return state.mode==='kg'?stripKgSuffix(raw,rate):rawMachine(raw)}

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
function analyzeWorkbook(wb){
  var groups={},allRows=[],scannedSheets=0,employeeKeys={};
  (wb.SheetNames||[]).forEach(function(sn){
    var ws=wb.Sheets[sn];if(!ws||!ws['!ref'])return;
    var rows=XLSX.utils.sheet_to_json(ws,{header:1,raw:true,defval:null,blankrows:true});
    var hdr=findHeader(rows);if(!hdr)return;
    var sheetHad=false,sheetCard=cardFromSheet(sn);
    for(var r=hdr.row+1;r<rows.length;r++){
      var row=rows[r]||[],rate=num(row[hdr.salary]);
      if(state.mode==='monthly'&&!isMonthlyRate(rate))continue;
      if(state.mode==='kg'&&!isKgRate(rate))continue;
      var raw=rawMachine(row[hdr.loc]);if(!machineOk(raw))continue;
      var mc=canonicalMachine(raw,rate);if(!machineOk(mc))continue;
      sheetHad=true;
      var empCode=codeText(row[hdr.code]),name=String(row[hdr.name]==null?'':row[hdr.name]).trim(),machineCard=cardFromMachine(mc);
      var rec={sheet:sn,row:r+1,card:sheetCard,machine:mc,rawMachine:raw,code:empCode,name:name,rate:rate,crossCard:!!(sheetCard&&machineCard&&sheetCard!==machineCard)};
      allRows.push(rec);if(empCode||name)employeeKeys[(empCode||'')+'|'+name.toLowerCase()]=1;
      var key=sn+'||'+mc;
      if(!groups[key])groups[key]={key:key,sheet:sn,card:sheetCard,machine:mc,rows:[],rates:{}};
      groups[key].rows.push(rec);var rk=String(rate);groups[key].rates[rk]=(groups[key].rates[rk]||0)+1;
    }
    if(sheetHad)scannedSheets++;
  });
  var list=Object.keys(groups).map(function(k){
    var x=groups[k],rates=Object.keys(x.rates).map(Number).sort(function(a,b){return a-b}),common=mostCommon(x.rates);
    x.rateList=rates;x.common=common.rate;x.commonCount=common.count;x.tie=common.tie;x.mismatch=rates.length>1;
    x.min=rates.length?rates[0]:null;x.max=rates.length?rates[rates.length-1]:null;x.delta=rates.length?x.max-x.min:0;
    x.outliers=x.rows.filter(function(r){return common.rate!=null&&r.rate!==common.rate});return x;
  }).sort(function(a,b){if(a.mismatch!==b.mismatch)return a.mismatch?-1:1;return a.sheet.localeCompare(b.sheet)||a.machine.localeCompare(b.machine)});
  state.groups=list;state.issues=list.filter(function(x){return x.mismatch});state.rows=allRows;state.scannedSheets=scannedSheets;state.scannedEmployees=Object.keys(employeeKeys).length;
}
function setMode(next){
  if(next!=='monthly'&&next!=='kg')return;
  state.mode=next;
  ['monthly','kg'].forEach(function(x){var b=q('mraMode-'+x);if(b)b.classList.toggle('active',x===next)});
  var t=q('mraModeHint');if(t)t.textContent=next==='kg'?'Rate/KG mode: 1.80 / 2.25 / 3.25 type values compare honge. Embedded suffix (C1R1.80) → machine C1R.':'Rate mode: ₹14,500 / ₹15,500 type monthly rates compare honge.';
  if(state.wb){analyzeWorkbook(state.wb);render()}
}
function makePage(){
  if(q('page-machineaudit'))return;
  var content=document.querySelector('.content');if(!content)return;
  var page=document.createElement('div');page.className='page';page.id='page-machineaudit';
  page.innerHTML='<div class="mra-shell">'+
    '<div class="mra-head"><div><div class="mra-eyebrow">SALARY PAYROLL / MACHINE CONTROL</div><div class="mra-title">Machine Rate Audit</div><div class="mra-sub">Exact same machine code ke andar rate consistency check. C1C ≠ C1O ≠ C1R ≠ C1CH. Rate/KG mode piece-rate rows ko alag scan karta hai.</div></div><label class="mra-upload">📤 Upload Attendance / Salary Sheet<input id="mraFile" type="file" accept=".xlsx,.xls,.csv"></label></div>'+
    '<div class="mra-modebar"><div><b>Compare By</b><span id="mraModeHint">Rate mode: ₹14,500 / ₹15,500 type monthly rates compare honge.</span></div><div class="mra-modeBtns"><button id="mraMode-monthly" class="active">₹ Rate</button><button id="mraMode-kg">⚖ Rate/KG</button></div></div>'+
    '<div class="mra-filebar" id="mraFileBar"><span class="mra-fileicon">📄</span><div><b>No file selected</b><small>Attendance workbook upload karo</small></div><span class="mra-ready">READY</span></div>'+
    '<div class="mra-kpis"><div class="mra-kpi"><span>Machines Scanned</span><b id="mraMachines">0</b><small>exact machine groups</small></div><div class="mra-kpi"><span>Employees</span><b id="mraEmployees">0</b><small>with selected rate type</small></div><div class="mra-kpi danger"><span>Mismatch Groups</span><b id="mraMismatch">0</b><small>same machine, different rate</small></div><div class="mra-kpi"><span>Sheets Scanned</span><b id="mraSheets">0</b><small>valid sheets</small></div></div>'+
    '<div class="mra-toolbar"><div><b>Rate Consistency Exceptions</b><small>Comparison never crosses machine code or card sheet.</small></div><div class="mra-tools"><select id="mraFilter"><option value="all">All machine groups</option><option value="mismatch">Mismatch only</option><option value="ok">Consistent only</option></select><button id="mraDownload" disabled>⬇ Export Audit</button></div></div>'+
    '<div class="mra-body" id="mraResults"><div class="mra-empty"><div>⚙️</div><b>Machine Rate Audit Ready</b><span>Workbook upload karo, phir ₹ Rate ya Rate/KG choose karo.</span></div></div></div>';
  content.appendChild(page);
  q('mraFile').addEventListener('change',onFile);
  q('mraFilter').addEventListener('change',function(){state.filter=this.value;render()});
  q('mraDownload').addEventListener('click',download);
  q('mraMode-monthly').addEventListener('click',function(){setMode('monthly')});
  q('mraMode-kg').addEventListener('click',function(){setMode('kg')});
}
function addCss(){
  if(q('mra-style'))return;var s=document.createElement('style');s.id='mra-style';
  s.textContent='#page-machineaudit{background:#f6f7fb!important;overflow:auto!important}.mra-shell{padding:18px;overflow:auto;min-height:100%}.mra-head{display:flex;justify-content:space-between;gap:20px;align-items:center;background:linear-gradient(135deg,#fff,#fbfbff);border:1px solid #e5e7eb;border-radius:14px;padding:19px 20px;box-shadow:0 1px 3px rgba(15,23,42,.04)}.mra-eyebrow{font-size:8px;font-weight:900;letter-spacing:1.3px;color:#7c3aed;margin-bottom:5px}.mra-title{font-size:21px;font-weight:850;color:#111827;letter-spacing:-.45px}.mra-sub{font-size:10px;color:#64748b;margin-top:5px;max-width:760px;line-height:1.65}.mra-upload{position:relative;display:inline-flex;align-items:center;justify-content:center;min-width:215px;padding:10px 13px;border-radius:9px;background:#312e81;color:#fff;font-size:10px;font-weight:800;cursor:pointer}.mra-upload input{position:absolute;inset:0;opacity:0;cursor:pointer}.mra-modebar{display:flex;justify-content:space-between;gap:12px;align-items:center;margin-top:10px;padding:10px 12px;background:#fff;border:1px solid #e5e7eb;border-radius:10px}.mra-modebar>div:first-child{display:flex;flex-direction:column;gap:3px}.mra-modebar b{font-size:10px;color:#334155}.mra-modebar span{font-size:8px;color:#94a3b8}.mra-modeBtns{display:flex;gap:5px;background:#f3f4f6;padding:3px;border-radius:9px}.mra-modeBtns button{border:0;background:transparent;color:#64748b;border-radius:7px;padding:7px 11px;font-size:9px;font-weight:850;cursor:pointer}.mra-modeBtns button.active{background:#312e81;color:#fff;box-shadow:0 1px 2px rgba(15,23,42,.12)}.mra-filebar{margin-top:10px;display:flex;align-items:center;gap:10px;background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:10px 13px;font-size:10px}.mra-filebar>div{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}.mra-filebar b{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#334155}.mra-filebar small{color:#94a3b8}.mra-fileicon{font-size:18px}.mra-ready{font-size:8px;font-weight:900;color:#15803d;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:999px;padding:4px 7px}.mra-kpis{display:grid;grid-template-columns:repeat(4,minmax(150px,1fr));gap:8px;margin-top:10px}.mra-kpi{background:#fff;border:1px solid #e5e7eb;border-radius:11px;padding:11px 13px;display:flex;flex-direction:column;gap:4px;box-shadow:0 1px 2px rgba(15,23,42,.02)}.mra-kpi span{font-size:8px;text-transform:uppercase;letter-spacing:.8px;color:#64748b;font-weight:800}.mra-kpi b{font-size:21px;color:#111827}.mra-kpi small{font-size:8px;color:#94a3b8}.mra-kpi.danger b{color:#dc2626}.mra-toolbar{margin-top:10px;display:flex;align-items:center;justify-content:space-between;gap:10px;background:#fff;border:1px solid #e5e7eb;border-radius:10px 10px 0 0;padding:11px 13px}.mra-toolbar>div:first-child{display:flex;flex-direction:column;gap:2px}.mra-toolbar b{font-size:11px;color:#334155}.mra-toolbar small{font-size:8px;color:#94a3b8}.mra-tools{display:flex;gap:6px}.mra-tools select,.mra-tools button{height:30px;border:1px solid #d1d5db;border-radius:7px;background:#fff;padding:0 9px;font-size:9px;font-weight:700;color:#475569}.mra-tools button{background:#312e81;color:#fff;border-color:#312e81;cursor:pointer}.mra-tools button:disabled{opacity:.35;cursor:not-allowed}.mra-body{background:#fff;border:1px solid #e5e7eb;border-top:0;border-radius:0 0 10px 10px;min-height:280px;padding:10px}.mra-empty{min-height:260px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:7px;color:#94a3b8;text-align:center}.mra-empty>div{font-size:38px;opacity:.35}.mra-empty b{font-size:13px;color:#475569}.mra-empty span{font-size:9px;max-width:500px;line-height:1.6}.mra-group{border:1px solid #e5e7eb;border-radius:9px;margin-bottom:8px;overflow:hidden}.mra-group.bad{border-color:#fecaca}.mra-gh{display:grid;grid-template-columns:140px 170px 1fr 130px;gap:10px;align-items:center;padding:10px 12px;background:#f8fafc}.mra-group.bad .mra-gh{background:#fff7f7}.mra-machine{font-size:12px;font-weight:900;color:#312e81}.mra-sheet{font-size:9px;color:#64748b;font-weight:700}.mra-rates{display:flex;gap:5px;flex-wrap:wrap}.mra-rate{font-size:9px;font-weight:850;padding:4px 7px;border-radius:999px;background:#f1f5f9;color:#475569;border:1px solid #e2e8f0}.mra-rate.bad{background:#fef2f2;color:#b91c1c;border-color:#fecaca}.mra-status{text-align:right}.mra-pill{display:inline-flex;padding:4px 7px;border-radius:999px;font-size:8px;font-weight:900}.mra-pill.bad{background:#fee2e2;color:#b91c1c}.mra-pill.ok{background:#dcfce7;color:#15803d}.mra-table{width:100%;border-collapse:collapse}.mra-table th{position:static!important;background:#fff!important;color:#94a3b8!important;border:0!important;border-top:1px solid #eef2f7!important;border-bottom:1px solid #eef2f7!important;padding:6px 10px!important;font-size:8px!important}.mra-table td{padding:7px 10px!important;font-size:9px!important;border:0!important;border-bottom:1px solid #f3f4f6!important}.mra-table tr:last-child td{border-bottom:0!important}.mra-table tr.outlier td{background:#fff7f7!important}.mra-diff{font-weight:900;color:#dc2626}.mra-muted{color:#94a3b8}.mra-note{padding:8px 10px;font-size:8px;color:#92400e;background:#fffbeb;border-top:1px solid #fde68a}.mra-summarybad{margin-bottom:9px;padding:9px 11px;border:1px solid #fecaca;background:#fef2f2;border-radius:8px;color:#991b1b;font-size:9px;font-weight:700}@media(max-width:900px){.mra-kpis{grid-template-columns:repeat(2,1fr)}.mra-head,.mra-toolbar,.mra-modebar{align-items:flex-start;flex-direction:column}.mra-gh{grid-template-columns:1fr 1fr}.mra-upload{width:100%}}';
  document.head.appendChild(s)
}
function ensureNav(){var sub=q('cat-sal');if(!sub)return;var item=q('vn-machineaudit');if(!item){item=document.createElement('div');item.className='vitem';item.id='vn-machineaudit';item.setAttribute('onclick',"goPage('machineaudit')");item.innerHTML='<span class="vi">⚙️</span>Machine Rate Audit';var audit=q('vn-audit'),bank=q('vn-bankverify');if(audit&&audit.parentNode===sub)sub.insertBefore(item,audit.nextSibling);else if(bank&&bank.parentNode===sub)sub.insertBefore(item,bank);else sub.appendChild(item)}}
function patchGo(){if(typeof g.goPage!=='function'||g.goPage.__mraWrapped)return;var old=g.goPage;function w(name){var r=old.apply(this,arguments);if(name==='machineaudit'){var sub=q('cat-sal');if(sub)sub.classList.remove('collapsed');var arr=q('arr-sal');if(arr)arr.style.transform='rotate(0deg)'}return r}w.__mraWrapped=true;w.__original=old;g.goPage=w}
async function onFile(e){
  var file=e.target.files&&e.target.files[0];if(!file)return;
  try{
    q('mraResults').innerHTML='<div class="mra-empty"><div>⏳</div><b>Reading workbook…</b><span>Large workbook ko responsive way me scan kiya ja raha hai.</span></div>';
    await new Promise(function(r){setTimeout(r,0)});
    var buf=await file.arrayBuffer(),wb=XLSX.read(buf,{type:'array',cellDates:false,cellText:true});
    state.file=file;state.wb=wb;state.filter='all';q('mraFilter').value='all';analyzeWorkbook(wb);render();
    q('mraFileBar').innerHTML='<span class="mra-fileicon">📊</span><div><b>'+esc(file.name)+'</b><small>'+wb.SheetNames.length+' workbook sheets · '+state.scannedSheets+' '+(state.mode==='kg'?'KG-rate':'monthly-rate')+' sheets scanned</small></div><span class="mra-ready">AUDITED</span>';q('mraDownload').disabled=false;
  }catch(err){console.error(err);alert('Machine Rate Audit file read nahi kar paya: '+(err&&err.message?err.message:err))}
}
function visibleGroups(){if(state.filter==='mismatch')return state.groups.filter(function(x){return x.mismatch});if(state.filter==='ok')return state.groups.filter(function(x){return !x.mismatch});return state.groups}
function render(){
  if(!q('mraResults'))return;
  q('mraMachines').textContent=state.groups.length;q('mraEmployees').textContent=state.scannedEmployees;q('mraMismatch').textContent=state.issues.length;q('mraSheets').textContent=state.scannedSheets;
  var groups=visibleGroups(),box=q('mraResults');
  if(!state.file){box.innerHTML='<div class="mra-empty"><div>⚙️</div><b>Machine Rate Audit Ready</b><span>Workbook upload karo, phir ₹ Rate ya Rate/KG choose karo.</span></div>';return}
  if(!groups.length){box.innerHTML='<div class="mra-empty"><div>✅</div><b>No '+(state.mode==='kg'?'Rate/KG':'monthly rate')+' rows found</b><span>Mode change karke dekho ya workbook structure check karo.</span></div>';return}
  var html='';if(state.issues.length)html+='<div class="mra-summarybad">⚠ '+state.issues.length+' exact machine group(s) me different '+(state.mode==='kg'?'rate/kg':'monthly rates')+' mili hain.</div>';
  groups.forEach(function(gp){
    var rates=gp.rateList.map(function(r){return'<span class="mra-rate '+(gp.mismatch?'bad':'')+'">'+rateText(r)+' <small>×'+gp.rates[String(r)]+'</small></span>'}).join('');
    html+='<div class="mra-group '+(gp.mismatch?'bad':'')+'"><div class="mra-gh"><div><div class="mra-machine">'+esc(gp.machine)+'</div><div class="mra-sheet">'+esc(gp.sheet)+'</div></div><div class="mra-rates">'+rates+'</div><div style="font-size:9px;color:#64748b">'+gp.rows.length+' employee row(s) · '+(gp.mismatch?'Spread '+rateText(gp.delta):'Same '+(state.mode==='kg'?'rate/kg':'rate'))+'</div><div class="mra-status"><span class="mra-pill '+(gp.mismatch?'bad':'ok')+'">'+(gp.mismatch?'RATE MISMATCH':'CONSISTENT')+'</span></div></div>';
    html+='<table class="mra-table"><thead><tr><th>EMP CODE</th><th>EMPLOYEE</th><th>MACHINE</th><th>'+(state.mode==='kg'?'RATE/KG':'RATE')+'</th><th>COMMON</th><th>DIFFERENCE</th><th>ROW</th></tr></thead><tbody>';
    gp.rows.forEach(function(r){var out=gp.mismatch&&gp.common!=null&&r.rate!==gp.common,diff=gp.common==null?0:r.rate-gp.common;html+='<tr class="'+(out?'outlier':'')+'"><td>'+esc(r.code||'—')+'</td><td><b>'+esc(r.name||'—')+'</b></td><td>'+esc(r.machine)+(r.rawMachine!==r.machine?'<div class="mra-muted">raw: '+esc(r.rawMachine)+'</div>':'')+'</td><td><b>'+rateText(r.rate)+'</b></td><td>'+(!gp.tie&&gp.common!=null?rateText(gp.common):'<span class="mra-muted">No clear standard</span>')+'</td><td class="'+(out?'mra-diff':'mra-muted')+'">'+(out?(diff>0?'+':'')+(state.mode==='kg'?kg(diff):money(diff)):'—')+'</td><td>'+r.row+'</td></tr>'});
    html+='</tbody></table>';if(gp.mismatch)html+='<div class="mra-note">Rule: <b>'+esc(gp.sheet)+' + '+esc(gp.machine)+'</b> ke andar '+(state.mode==='kg'?'rate/kg':'monthly rate')+' same expected hai. '+(gp.tie?'Dominant rate clear nahi hai; group review karo.':'Most-used reference '+rateText(gp.common)+' hai. Software automatic salary/rate change nahi karta.')+'</div>';html+='</div>';
  });box.innerHTML=html;
}
function download(){
  if(!state.file||!state.wb)return;
  var label=state.mode==='kg'?'RATE/KG':'MONTHLY RATE',rows=[['MACHINE '+label+' AUDIT'],['Source File',state.file.name],['Mode',label],['Generated',new Date().toLocaleString()],[],['Sheet','Machine Code','Raw Location','Emp Code','Employee','Rate','Most Used Rate','Difference','Status','Source Row']];
  state.groups.forEach(function(gp){gp.rows.forEach(function(r){var diff=gp.common==null?'':r.rate-gp.common;rows.push([gp.sheet,gp.machine,r.rawMachine,r.code,r.name,r.rate,gp.tie?'':gp.common,gp.tie?'':diff,gp.mismatch?'MISMATCH':'OK',r.row])})});
  var summary=[['MACHINE '+label+' SUMMARY'],[],['Sheet','Machine Code','Employees','Rates Found','Most Used Rate','Spread','Status']];state.groups.forEach(function(gp){summary.push([gp.sheet,gp.machine,gp.rows.length,gp.rateList.map(function(x){return x+' x'+gp.rates[String(x)]}).join(' | '),gp.tie?'':gp.common,gp.delta,gp.mismatch?'MISMATCH':'OK'])});
  var out=XLSX.utils.book_new();XLSX.utils.book_append_sheet(out,XLSX.utils.aoa_to_sheet(summary),'SUMMARY');XLSX.utils.book_append_sheet(out,XLSX.utils.aoa_to_sheet(rows),'DETAIL');XLSX.writeFile(out,'Machine_'+(state.mode==='kg'?'RateKG':'MonthlyRate')+'_Audit_'+state.file.name.replace(/\.(xlsx|xls|csv)$/i,'')+'.xlsx');
}
function boot(){addCss();makePage();ensureNav();patchGo();setTimeout(function(){ensureNav();patchGo()},800)}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})(window);