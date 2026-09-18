/* ATPL Machine Rate Auditor V3
   Existing audit rules preserved.
   Adds dynamic isolated Card/Sheet toggles and one-pass cached results.
*/
(function(g){'use strict';
if(!g||g.__ATPL_MACHINE_RATE_AUDITOR_V3__)return;
g.__ATPL_MACHINE_RATE_AUDITOR_V3__='2026.09.18-card-v1';

var state={file:null,modes:{},groups:[],cards:[],activeCard:'',filter:'all',mode:'monthly',scannedSheets:0,scannedEmployees:0,sheetCount:0,issuesCount:0,scanning:false,viewLimit:10};
var scanWorker=null,scanJob=0;
function q(id){return document.getElementById(id)}
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function rawMachine(v){return String(v==null?'':v).trim().toUpperCase().replace(/[\s\-_/]+/g,'')}
function money(v){var n=Number(v);if(!isFinite(n))return '—';var dec=Math.abs(n-Math.round(n))>0.0001?2:0;try{return '₹'+n.toLocaleString('en-IN',{minimumFractionDigits:dec,maximumFractionDigits:2})}catch(_){return '₹'+n.toFixed(dec)}}
function kg(v){var n=Number(v);if(!isFinite(n))return '—';return n.toFixed(Math.abs(n-Math.round(n))<0.0001?0:2).replace(/0+$/,'').replace(/\.$/,'')+' /kg'}
function rateText(v){return state.mode==='kg'?kg(v):money(v)}
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
function currentCard(){
  if(!state.cards.length)return null;
  for(var i=0;i<state.cards.length;i++)if(state.cards[i].key===state.activeCard)return state.cards[i];
  return state.cards[0];
}
function applyMode(next,keepCard){
  var d=state.modes&&state.modes[next]||{groups:[],cards:[],issuesCount:0,scannedSheets:0,scannedEmployees:0};
  var old=keepCard?state.activeCard:'';
  state.mode=next;state.groups=d.groups||[];state.cards=d.cards||[];state.issuesCount=Number(d.issuesCount)||0;state.scannedSheets=Number(d.scannedSheets)||0;state.scannedEmployees=Number(d.scannedEmployees)||0;state.viewLimit=10;
  if(old&&state.cards.some(function(c){return c.key===old}))state.activeCard=old;
  else state.activeCard=state.cards.length?state.cards[0].key:'';
  ['monthly','kg'].forEach(function(x){var b=q('mraMode-'+x);if(b)b.classList.toggle('active',x===next)});
  var t=q('mraModeHint');if(t)t.textContent=next==='kg'?'Rate/KG mode: 1.80 / 2.25 / 3.25 type values compare honge. Embedded suffix (C1R1.80) → machine C1R.':'Rate mode: ₹14,500 / ₹15,500 type monthly rates compare honge.';
  renderCardBar();
}
function setMode(next){
  if(next!=='monthly'&&next!=='kg')return;
  if(state.modes&&state.modes[next]){applyMode(next,true);render();return}
  state.mode=next;
  ['monthly','kg'].forEach(function(x){var b=q('mraMode-'+x);if(b)b.classList.toggle('active',x===next)});
}
function makePage(){
  if(q('page-machineaudit'))return;
  var content=document.querySelector('.content');if(!content)return;
  var page=document.createElement('div');page.className='page';page.id='page-machineaudit';
  page.innerHTML='<div class="mra-shell">'+
    '<div class="mra-head"><div><div class="mra-eyebrow">SALARY PAYROLL / MACHINE CONTROL</div><div class="mra-title">Machine Rate Audit</div><div class="mra-sub">Exact same machine code ke andar rate consistency check. C1C ≠ C1O ≠ C1R ≠ C1CH. Har workbook sheet/card independently audit hota hai.</div></div><label class="mra-upload">📤 Upload Attendance / Salary Sheet<input id="mraFile" type="file" accept=".xlsx,.xls,.csv"></label></div>'+
    '<div class="mra-modebar"><div><b>Compare By</b><span id="mraModeHint">Rate mode: ₹14,500 / ₹15,500 type monthly rates compare honge.</span></div><div class="mra-modeBtns"><button id="mraMode-monthly" class="active">₹ Rate</button><button id="mraMode-kg">⚖ Rate/KG</button></div></div>'+
    '<div class="mra-filebar" id="mraFileBar"><span class="mra-fileicon">📄</span><div><b>No file selected</b><small>Attendance workbook upload karo</small></div><span class="mra-ready">READY</span></div>'+
    '<div class="mra-cardbar" id="mraCardBar" style="display:none"></div>'+
    '<div class="mra-kpis"><div class="mra-kpi"><span>Machines Scanned</span><b id="mraMachines">0</b><small>selected card only</small></div><div class="mra-kpi"><span>Employees</span><b id="mraEmployees">0</b><small>selected card only</small></div><div class="mra-kpi danger"><span>Mismatch Groups</span><b id="mraMismatch">0</b><small>selected card only</small></div><div class="mra-kpi"><span>Sheets Scanned</span><b id="mraSheets">0</b><small>selected card status</small></div></div>'+
    '<div class="mra-toolbar"><div><b>Rate Consistency Exceptions</b><small>Errors and warnings never cross the selected sheet/card.</small></div><div class="mra-tools"><select id="mraFilter"><option value="all">All machine groups</option><option value="mismatch">Mismatch only</option><option value="ok">Consistent only</option></select><button id="mraDownload" disabled>⬇ Export Audit</button></div></div>'+
    '<div class="mra-body" id="mraResults"><div class="mra-empty"><div>⚙️</div><b>Machine Rate Audit Ready</b><span>Workbook upload karo. Saare cards/sheets automatically detect honge.</span></div></div></div>';
  content.appendChild(page);
  q('mraFile').addEventListener('change',onFile);
  q('mraFilter').addEventListener('change',function(){state.filter=this.value;state.viewLimit=10;render()});
  q('mraDownload').addEventListener('click',download);
  q('mraMode-monthly').addEventListener('click',function(){setMode('monthly')});
  q('mraMode-kg').addEventListener('click',function(){setMode('kg')});
}
function addCss(){
  if(q('mra-style'))return;var s=document.createElement('style');s.id='mra-style';
  s.textContent='#page-machineaudit{background:#f6f7fb!important;overflow:auto!important}.mra-shell{padding:18px;overflow:auto;min-height:100%}.mra-head{display:flex;justify-content:space-between;gap:20px;align-items:center;background:linear-gradient(135deg,#fff,#fbfbff);border:1px solid #e5e7eb;border-radius:14px;padding:19px 20px;box-shadow:0 1px 3px rgba(15,23,42,.04)}.mra-eyebrow{font-size:8px;font-weight:900;letter-spacing:1.3px;color:#7c3aed;margin-bottom:5px}.mra-title{font-size:21px;font-weight:850;color:#111827;letter-spacing:-.45px}.mra-sub{font-size:10px;color:#64748b;margin-top:5px;max-width:760px;line-height:1.65}.mra-upload{position:relative;display:inline-flex;align-items:center;justify-content:center;min-width:215px;padding:10px 13px;border-radius:9px;background:#312e81;color:#fff;font-size:10px;font-weight:800;cursor:pointer}.mra-upload input{position:absolute;inset:0;opacity:0;cursor:pointer}.mra-modebar{display:flex;justify-content:space-between;gap:12px;align-items:center;margin-top:10px;padding:10px 12px;background:#fff;border:1px solid #e5e7eb;border-radius:10px}.mra-modebar>div:first-child{display:flex;flex-direction:column;gap:3px}.mra-modebar b{font-size:10px;color:#334155}.mra-modebar span{font-size:8px;color:#94a3b8}.mra-modeBtns{display:flex;gap:5px;background:#f3f4f6;padding:3px;border-radius:9px}.mra-modeBtns button{border:0;background:transparent;color:#64748b;border-radius:7px;padding:7px 11px;font-size:9px;font-weight:850;cursor:pointer}.mra-modeBtns button.active{background:#312e81;color:#fff;box-shadow:0 1px 2px rgba(15,23,42,.12)}.mra-filebar{margin-top:10px;display:flex;align-items:center;gap:10px;background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:10px 13px;font-size:10px}.mra-filebar>div{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}.mra-filebar b{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#334155}.mra-filebar small{color:#94a3b8}.mra-fileicon{font-size:18px}.mra-ready{font-size:8px;font-weight:900;color:#15803d;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:999px;padding:4px 7px}.mra-cardbar{margin-top:10px;display:flex;gap:6px;align-items:center;overflow-x:auto;padding:8px;background:#fff;border:1px solid #e5e7eb;border-radius:10px}.mra-cardbtn{border:1px solid #dbe3ef;background:#f8fafc;color:#475569;border-radius:8px;padding:7px 11px;font-size:9px;font-weight:850;white-space:nowrap;cursor:pointer}.mra-cardbtn.active{background:#312e81;color:#fff;border-color:#312e81}.mra-cardbtn.warn:not(.active){border-color:#f59e0b;background:#fffbeb;color:#92400e}.mra-kpis{display:grid;grid-template-columns:repeat(4,minmax(150px,1fr));gap:8px;margin-top:10px}.mra-kpi{background:#fff;border:1px solid #e5e7eb;border-radius:11px;padding:11px 13px;display:flex;flex-direction:column;gap:4px;box-shadow:0 1px 2px rgba(15,23,42,.02)}.mra-kpi span{font-size:8px;text-transform:uppercase;letter-spacing:.8px;color:#64748b;font-weight:800}.mra-kpi b{font-size:21px;color:#111827}.mra-kpi small{font-size:8px;color:#94a3b8}.mra-kpi.danger b{color:#dc2626}.mra-toolbar{margin-top:10px;display:flex;align-items:center;justify-content:space-between;gap:10px;background:#fff;border:1px solid #e5e7eb;border-radius:10px 10px 0 0;padding:11px 13px}.mra-toolbar>div:first-child{display:flex;flex-direction:column;gap:2px}.mra-toolbar b{font-size:11px;color:#334155}.mra-toolbar small{font-size:8px;color:#94a3b8}.mra-tools{display:flex;gap:6px}.mra-tools select,.mra-tools button{height:30px;border:1px solid #d1d5db;border-radius:7px;background:#fff;padding:0 9px;font-size:9px;font-weight:700;color:#475569}.mra-tools button{background:#312e81;color:#fff;border-color:#312e81;cursor:pointer}.mra-tools button:disabled{opacity:.35;cursor:not-allowed}.mra-body{background:#fff;border:1px solid #e5e7eb;border-top:0;border-radius:0 0 10px 10px;min-height:280px;padding:10px}.mra-empty{min-height:220px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:7px;color:#94a3b8;text-align:center}.mra-empty>div{font-size:38px;opacity:.35}.mra-empty b{font-size:13px;color:#475569}.mra-empty span{font-size:9px;max-width:500px;line-height:1.6}.mra-warning{margin-bottom:8px;padding:9px 11px;border:1px solid #fde68a;background:#fffbeb;border-radius:8px;color:#92400e;font-size:9px;font-weight:700}.mra-group{border:1px solid #e5e7eb;border-radius:9px;margin-bottom:8px;overflow:hidden}.mra-group.bad{border-color:#fecaca}.mra-gh{display:grid;grid-template-columns:140px 170px 1fr 130px;gap:10px;align-items:center;padding:10px 12px;background:#f8fafc}.mra-group.bad .mra-gh{background:#fff7f7}.mra-machine{font-size:12px;font-weight:900;color:#312e81}.mra-sheet{font-size:9px;color:#64748b;font-weight:700}.mra-rates{display:flex;gap:5px;flex-wrap:wrap}.mra-rate{font-size:9px;font-weight:850;padding:4px 7px;border-radius:999px;background:#f1f5f9;color:#475569;border:1px solid #e2e8f0}.mra-rate.bad{background:#fef2f2;color:#b91c1c;border-color:#fecaca}.mra-status{text-align:right}.mra-pill{display:inline-flex;padding:4px 7px;border-radius:999px;font-size:8px;font-weight:900}.mra-pill.bad{background:#fee2e2;color:#b91c1c}.mra-pill.ok{background:#dcfce7;color:#15803d}.mra-table{width:100%;border-collapse:collapse}.mra-table th{position:static!important;background:#fff!important;color:#94a3b8!important;border:0!important;border-top:1px solid #eef2f7!important;border-bottom:1px solid #eef2f7!important;padding:6px 10px!important;font-size:8px!important}.mra-table td{padding:7px 10px!important;font-size:9px!important;border:0!important;border-bottom:1px solid #f3f4f6!important}.mra-table tr:last-child td{border-bottom:0!important}.mra-table tr.outlier td{background:#fff7f7!important}.mra-diff{font-weight:900;color:#dc2626}.mra-muted{color:#94a3b8}.mra-note{padding:8px 10px;font-size:8px;color:#92400e;background:#fffbeb;border-top:1px solid #fde68a}.mra-summarybad{margin-bottom:9px;padding:9px 11px;border:1px solid #fecaca;background:#fef2f2;border-radius:8px;color:#991b1b;font-size:9px;font-weight:700}@media(max-width:900px){.mra-kpis{grid-template-columns:repeat(2,1fr)}.mra-head,.mra-toolbar,.mra-modebar{align-items:flex-start;flex-direction:column}.mra-gh{grid-template-columns:1fr 1fr}.mra-upload{width:100%}}';
  document.head.appendChild(s)
}
function ensureNav(){var sub=q('cat-sal');if(!sub)return;var item=q('vn-machineaudit');if(!item){item=document.createElement('div');item.className='vitem';item.id='vn-machineaudit';item.setAttribute('onclick',"goPage('machineaudit')");item.innerHTML='<span class="vi">⚙️</span>Machine Rate Audit';var audit=q('vn-audit'),bank=q('vn-bankverify');if(audit&&audit.parentNode===sub)sub.insertBefore(item,audit.nextSibling);else if(bank&&bank.parentNode===sub)sub.insertBefore(item,bank);else sub.appendChild(item)}}
function patchGo(){if(typeof g.goPage!=='function'||g.goPage.__mraWrapped)return;var old=g.goPage;function w(name){var r=old.apply(this,arguments);if(name==='machineaudit'){var sub=q('cat-sal');if(sub)sub.classList.remove('collapsed');var arr=q('arr-sal');if(arr)arr.style.transform='rotate(0deg)'}return r}w.__mraWrapped=true;w.__original=old;g.goPage=w}
function setScanUi(stage,percent){
  var box=q('mraResults');if(!box)return;
  var p=Math.max(0,Math.min(100,Number(percent)||0));
  box.innerHTML='<div class="mra-empty"><div>⚙️</div><b>'+esc(stage||'Scanning workbook…')+'</b><span>Background worker me one-pass processing ho rahi hai — ERP use kar sakte ho.</span><div style="width:min(420px,80%);height:7px;border-radius:99px;background:#e5e7eb;overflow:hidden;margin-top:8px"><i style="display:block;height:100%;width:'+p+'%;background:#4f46e5;border-radius:99px;transition:width .2s"></i></div><span>'+p+'%</span></div>';
}
function stopWorker(){try{if(scanWorker){scanWorker.terminate();scanWorker=null}}catch(_){}}
function renderCardBar(){
  var bar=q('mraCardBar');if(!bar)return;
  if(!state.cards.length){bar.style.display='none';bar.innerHTML='';return}
  bar.style.display='flex';
  var html='';
  state.cards.forEach(function(c){html+='<button class="mra-cardbtn '+(c.key===state.activeCard?'active ':'')+((c.warnings||[]).length?'warn':'')+'" data-card="'+esc(c.key)+'" title="'+esc(c.sheet||c.key)+'">'+esc(c.label||c.key)+((c.warnings||[]).length?' ⚠':'')+'</button>'});
  bar.innerHTML=html;
  Array.prototype.forEach.call(bar.querySelectorAll('.mra-cardbtn'),function(btn){btn.onclick=function(){state.activeCard=this.getAttribute('data-card')||'';state.viewLimit=10;renderCardBar();render()}});
}
async function scanFile(file){
  if(!file)return;
  stopWorker();state.file=file;state.modes={};state.groups=[];state.cards=[];state.activeCard='';state.scanning=true;state.filter='all';state.viewLimit=10;
  if(q('mraFilter'))q('mraFilter').value='all';if(q('mraDownload'))q('mraDownload').disabled=true;renderCardBar();setScanUi('Reading workbook in background…',3);
  try{
    if(typeof Worker!=='function')throw new Error('Browser Web Worker support unavailable');
    var job=++scanJob;scanWorker=new Worker('machine-rate-audit-worker-v1.js?v=20260918-card5');
    scanWorker.onmessage=function(ev){
      var d=ev.data||{};if(job!==scanJob)return;
      if(d.type==='progress'){if(state.scanning)setScanUi(d.stage||'Scanning sheets…',d.percent||10);return}
      if(d.type==='error'){state.scanning=false;stopWorker();setScanUi('Audit failed',0);alert('Machine Rate Audit file read nahi kar paya: '+(d.message||'Unknown error'));return}
      if(d.type==='done'){
        var r=d.result||{};state.modes=r.modes||{};state.sheetCount=r.sheetCount||0;state.scanning=false;applyMode(state.mode,false);render();
        var fb=q('mraFileBar');if(fb)fb.innerHTML='<span class="mra-fileicon">📊</span><div><b>'+esc(file.name)+'</b><small>'+state.sheetCount+' workbook sheets/cards · one-pass background audit · '+state.scannedSheets+' valid for '+(state.mode==='kg'?'Rate/KG':'monthly rate')+'</small></div><span class="mra-ready">AUDITED</span>';
        if(q('mraDownload'))q('mraDownload').disabled=false;return
      }
      if(d.type==='exportDone'){
        var btn=q('mraDownload');if(btn){btn.disabled=false;btn.textContent='⬇ Export Audit'}
        try{var blob=new Blob([d.buffer],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=d.filename||'Machine_Rate_Audit.xlsx';document.body.appendChild(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(url)},1500)}catch(ex){console.error(ex);alert('Audit export download nahi ho paya. Dobara try karo.')}return
      }
    };
    scanWorker.onerror=function(err){if(job!==scanJob)return;state.scanning=false;stopWorker();console.error(err);setScanUi('Audit worker failed',0);alert('Machine Rate Audit worker error. Page refresh karke dobara try karo.')};
    scanWorker.postMessage({type:'scan',jobId:job,file:file});
  }catch(err){state.scanning=false;stopWorker();console.error(err);alert('Machine Rate Audit file read nahi kar paya: '+(err&&err.message?err.message:err))}
}
async function onFile(e){var file=e.target.files&&e.target.files[0];if(!file)return;await scanFile(file)}
function visibleGroups(){
  var a=state.groups.filter(function(x){return !state.activeCard||x.cardKey===state.activeCard});
  if(state.filter==='mismatch')return a.filter(function(x){return x.mismatch});
  if(state.filter==='ok')return a.filter(function(x){return !x.mismatch});
  return a;
}
function render(){
  if(!q('mraResults'))return;
  var card=currentCard(),allGroups=visibleGroups(),groups=allGroups.slice(0,state.viewLimit),box=q('mraResults');
  q('mraMachines').textContent=card?card.machines:0;q('mraEmployees').textContent=card?card.employees:0;q('mraMismatch').textContent=card?card.mismatches:0;q('mraSheets').textContent=card?(card.valid?1:0):0;
  if(!state.file){box.innerHTML='<div class="mra-empty"><div>⚙️</div><b>Machine Rate Audit Ready</b><span>Workbook upload karo. Saare cards/sheets automatically detect honge.</span></div>';return}
  var html='';
  if(card&&(card.warnings||[]).length)card.warnings.forEach(function(w){html+='<div class="mra-warning">⚠ '+esc(card.label||card.key)+': '+esc(w)+'</div>'});
  if(card&&card.mismatches)html+='<div class="mra-summarybad">⚠ '+card.mismatches+' exact machine group(s) me different '+(state.mode==='kg'?'rate/kg':'monthly rates')+' mili hain — sirf '+esc(card.label||card.key)+'.</div>';
  if(!groups.length){html+='<div class="mra-empty"><div>✅</div><b>No '+(state.mode==='kg'?'Rate/KG':'monthly rate')+' rows to show for '+esc(card?(card.label||card.key):'selected card')+'</b><span>Dusra Card ya Compare By mode select karke dekho.</span></div>';box.innerHTML=html;return}
  groups.forEach(function(gp){
    var rates=gp.rateList.map(function(r){return'<span class="mra-rate '+(gp.mismatch?'bad':'')+'">'+rateText(r)+' <small>×'+gp.rates[String(r)]+'</small></span>'}).join('');
    html+='<div class="mra-group '+(gp.mismatch?'bad':'')+'"><div class="mra-gh"><div><div class="mra-machine">'+esc(gp.machine)+'</div><div class="mra-sheet">'+esc(gp.sheet)+'</div></div><div class="mra-rates">'+rates+'</div><div style="font-size:9px;color:#64748b">'+(gp.rowCount||gp.rows.length)+' employee row(s) · '+(gp.mismatch?'Spread '+rateText(gp.delta):'Same '+(state.mode==='kg'?'rate/kg':'rate'))+'</div><div class="mra-status"><span class="mra-pill '+(gp.mismatch?'bad':'ok')+'">'+(gp.mismatch?'RATE MISMATCH':'CONSISTENT')+'</span></div></div>';
    html+='<table class="mra-table"><thead><tr><th>EMP CODE</th><th>EMPLOYEE</th><th>MACHINE</th><th>'+(state.mode==='kg'?'RATE/KG':'RATE')+'</th><th>COMMON</th><th>DIFFERENCE</th><th>ROW</th></tr></thead><tbody>';
    gp.rows.slice(0,40).forEach(function(r){var out=gp.mismatch&&gp.common!=null&&r.rate!==gp.common,diff=gp.common==null?0:r.rate-gp.common;html+='<tr class="'+(out?'outlier':'')+'"><td>'+esc(r.code||'—')+'</td><td><b>'+esc(r.name||'—')+'</b></td><td>'+esc(r.machine)+(r.rawMachine!==r.machine?'<div class="mra-muted">raw: '+esc(r.rawMachine)+'</div>':'')+'</td><td><b>'+rateText(r.rate)+'</b></td><td>'+(!gp.tie&&gp.common!=null?rateText(gp.common):'<span class="mra-muted">No clear standard</span>')+'</td><td class="'+(out?'mra-diff':'mra-muted')+'">'+(out?(diff>0?'+':'')+(state.mode==='kg'?kg(diff):money(diff)):'—')+'</td><td>'+r.row+'</td></tr>'});
    if((gp.rowCount||gp.rows.length)>40)html+='<tr><td colspan="7" class="mra-muted" style="text-align:center">Showing 40 of '+(gp.rowCount||gp.rows.length)+' rows — export contains all rows</td></tr>';
    html+='</tbody></table>';if(gp.mismatch)html+='<div class="mra-note">Rule: <b>'+esc(gp.sheet)+' + '+esc(gp.machine)+'</b> ke andar '+(state.mode==='kg'?'rate/kg':'monthly rate')+' same expected hai. '+(gp.tie?'Dominant rate clear nahi hai; group review karo.':'Most-used reference '+rateText(gp.common)+' hai. Software automatic salary/rate change nahi karta.')+'</div>';html+='</div>';
  });
  if(allGroups.length>groups.length)html+='<div style="display:flex;justify-content:center;padding:10px"><button id="mraLoadMore" style="border:1px solid #c7d2fe;background:#eef2ff;color:#3730a3;border-radius:8px;padding:8px 14px;font-size:9px;font-weight:850;cursor:pointer">Load More ('+(allGroups.length-groups.length)+' remaining)</button></div>';
  box.innerHTML=html;var more=q('mraLoadMore');if(more)more.onclick=function(){state.viewLimit+=10;render()};
}
function download(){
  if(!state.file||!scanWorker)return;
  var btn=q('mraDownload');if(btn){btn.disabled=true;btn.textContent='Preparing…'}
  try{scanWorker.postMessage({type:'export',jobId:scanJob,mode:state.mode,fileName:state.file.name})}
  catch(err){if(btn){btn.disabled=false;btn.textContent='⬇ Export Audit'}console.error(err);alert('Audit export start nahi ho paya. Dobara try karo.')}
}
g.ATPLMachineRateAuditorV3={version:'2026.09.18-card-v1',stripKgSuffix:stripKgSuffix,rawMachine:rawMachine,scanFile:scanFile,status:function(){return{scanning:state.scanning,groups:state.groups.length,cards:state.cards.map(function(c){return c.label}),activeCard:state.activeCard,mode:state.mode}}};
g.ATPLMachineRateAuditorV2=g.ATPLMachineRateAuditorV3;
function boot(){addCss();makePage();ensureNav();patchGo();setTimeout(function(){ensureNav();patchGo()},800)}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})(window);