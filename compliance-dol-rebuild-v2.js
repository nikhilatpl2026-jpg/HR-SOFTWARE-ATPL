/* ATPL Compliance DOL Rebuild V2
   Clean isolated ESIC -> DOL and PF -> DOL library.
   Local-first original file persistence in IndexedDB.
   Rules:
   - exact SHA-256 duplicate blocking
   - original PDF/Excel bytes stay in V2 IndexedDB across refresh/login on this browser
   - built-in viewer
   - permanent local delete
   - indexed search, no re-parse on every search
   - latest matched contribution month = DOL month; gaps do not stop the scan
   - chunked/worker parsing to reduce UI freezes
*/
(function(root){
'use strict';
if(!root||root.__ATPL_COMPLIANCE_DOL_REBUILD_V2__)return;
root.__ATPL_COMPLIANCE_DOL_REBUILD_V2__='2026.09.19-upload-first3';

var DB_NAME='ATPL_COMPLIANCE_DOL_V2', DB_VER=1, STORE='challans';
var state={esic:{rows:[],index:{},periods:[]},pf:{rows:[],index:{},periods:[]}};
var excelWorker=null,excelSeq=0,excelPending={};
var viewer={url:'',type:'',id:'',sheet:0,page:1,pageSize:100,sheets:null};
var MONTHS={jan:1,january:1,feb:2,february:2,mar:3,march:3,apr:4,april:4,may:5,jun:6,june:6,jul:7,july:7,aug:8,august:8,sep:9,sept:9,september:9,oct:10,october:10,nov:11,november:11,dec:12,december:12};

function $(id){return document.getElementById(id)}
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]})}
function tick(){return new Promise(function(r){setTimeout(r,0)})}
function periodLabel(p){if(!p)return'Month required';var a=String(p).split('-'),d=new Date(Number(a[0]),Number(a[1])-1,1);return d.toLocaleString('en-IN',{month:'short',year:'numeric'})}
function cleanName(s){return String(s||'').toLowerCase().replace(/\(\d+\)(?=\.[^.]+$)/,'').replace(/\s+/g,' ').trim()}
function normalizeDigits(v){
  if(typeof v==='number'&&isFinite(v)){if(Math.floor(v)!==v)return'';return String(v)}
  var s=String(v==null?'':v).trim().replace(/^['"]|['"]$/g,'');if(!s)return'';
  if(/[eE]/.test(s)){var n=Number(s);if(isFinite(n)&&Math.floor(n)===n)s=String(n)}
  s=s.replace(/\.0+$/,'').trim();
  if(/^\d+$/.test(s))return s;
  if(/^\d[\d\s/_-]*\d$/.test(s))return s.replace(/\D/g,'');
  return''
}
function normalizeAlpha(v){var s=String(v==null?'':v).toUpperCase().replace(/[^A-Z0-9]/g,'');return s.length>=8&&s.length<=32&&/\d/.test(s)?s:''}
function validId(type,v){if(type==='esic')return normalizeDigits(v);var d=normalizeDigits(v);if(d&&d.length===12)return d;return normalizeAlpha(v)}
function fileMime(name){var e=String(name||'').split('.').pop().toLowerCase();if(e==='pdf')return'application/pdf';if(e==='csv')return'text/csv';return'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}
function uid(type,hash){return'v2_'+type+'_'+String(hash||'').slice(0,24)}

function openDb(){
  return new Promise(function(resolve,reject){
    try{
      var req=indexedDB.open(DB_NAME,DB_VER);
      req.onupgradeneeded=function(){
        var db=req.result,st;
        if(!db.objectStoreNames.contains(STORE)){
          st=db.createObjectStore(STORE,{keyPath:'id'});
          st.createIndex('type','type',{unique:false});
          st.createIndex('hash','hash',{unique:false});
          st.createIndex('period','period',{unique:false});
        }
      };
      req.onsuccess=function(){resolve(req.result)};
      req.onerror=function(){reject(req.error||new Error('IndexedDB open failed'))}
    }catch(e){reject(e)}
  })
}
async function dbAll(){
  var db=await openDb();
  return new Promise(function(resolve){
    var tx=db.transaction(STORE,'readonly'),r=tx.objectStore(STORE).getAll();
    r.onsuccess=function(){db.close();resolve(r.result||[])};
    r.onerror=function(){db.close();resolve([])}
  })
}
async function dbGet(id){
  var db=await openDb();
  return new Promise(function(resolve){
    var tx=db.transaction(STORE,'readonly'),r=tx.objectStore(STORE).get(id);
    r.onsuccess=function(){db.close();resolve(r.result||null)};
    r.onerror=function(){db.close();resolve(null)}
  })
}
async function dbPut(rec){
  var db=await openDb();
  return new Promise(function(resolve,reject){
    var tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).put(rec);
    tx.oncomplete=function(){db.close();resolve(true)};
    tx.onerror=function(){var e=tx.error;db.close();reject(e)}
  })
}
async function dbDelete(id){
  var db=await openDb();
  return new Promise(function(resolve,reject){
    var tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).delete(id);
    tx.oncomplete=function(){db.close();resolve(true)};
    tx.onerror=function(){var e=tx.error;db.close();reject(e)}
  })
}

async function sha256(buf){
  if(!(root.crypto&&root.crypto.subtle))throw new Error('Secure SHA-256 unavailable in this browser');
  var out=await root.crypto.subtle.digest('SHA-256',buf);
  return Array.from(new Uint8Array(out)).map(function(b){return b.toString(16).padStart(2,'0')}).join('')
}

function parsePeriodCore(s){
  s=String(s||'').toLowerCase();
  var m=s.match(/\b(20\d{2})[\s._\/-](0?[1-9]|1[0-2])\b/);if(m)return m[1]+'-'+String(Number(m[2])).padStart(2,'0');
  m=s.match(/\b(0?[1-9]|1[0-2])[\s._\/-](20\d{2})\b/);if(m)return m[2]+'-'+String(Number(m[1])).padStart(2,'0');
  m=s.match(/\b(0?[1-9]|1[0-2])[\s._\/-](\d{2})\b/);if(m){var y=Number(m[2]);if(y>=20&&y<=40)return'20'+String(y).padStart(2,'0')+'-'+String(Number(m[1])).padStart(2,'0')}
  m=s.match(/(?:^|[^a-z0-9])(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)[\s._\/-]*(20\d{2}|\d{2})(?=$|[^0-9])/);
  if(m){var mo=MONTHS[m[1]],yy=m[2].length===2?'20'+m[2]:m[2];if(mo)return yy+'-'+String(mo).padStart(2,'0')}
  m=s.match(/(?:^|[^0-9])(20\d{2}|\d{2})[\s._\/-]*(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?=$|[^a-z0-9])/);
  if(m){var mo2=MONTHS[m[2]],yy2=m[1].length===2?'20'+m[1]:m[1];if(mo2)return yy2+'-'+String(mo2).padStart(2,'0')}
  return''
}
function inferPeriod(name,text){
  var p=parsePeriodCore(name);if(p)return{period:p,source:'filename'};
  var low=String(text||'').toLowerCase(),keys=['contribution period','wage period','challan month','contribution month'];
  for(var i=0;i<keys.length;i++){var pos=low.indexOf(keys[i]);if(pos>=0){var x=parsePeriodCore(low.slice(pos,pos+160));if(x)return{period:x,source:'document'}}}
  return{period:'',source:'manual'}
}
function collectToken(type,value,set){
  var s=String(value==null?'':value).trim();if(!s)return;
  var d=normalizeDigits(value),a=normalizeAlpha(s);
  if(type==='esic'){
    if(d.length>=8&&d.length<=20)set.add(d);
    var dm=s.match(/\d(?:[\d\s/_.-]{6,24}\d)/g)||[];
    dm.forEach(function(x){var y=normalizeDigits(x);if(y.length>=8&&y.length<=20)set.add(y)})
  }else{
    if(d.length===12)set.add(d);
    if(a.length>=8&&a.length<=32&&/\d/.test(a))set.add(a);
    var am=s.match(/[A-Za-z0-9][A-Za-z0-9/_.-]{7,31}/g)||[];
    am.forEach(function(x){var y=normalizeAlpha(x),z=normalizeDigits(x);if(z.length===12)set.add(z);else if(y.length>=8&&y.length<=32&&/\d/.test(y))set.add(y)})
  }
}
function ensureExcelWorker(){
  if(excelWorker)return true;
  try{
    var src=[
      "self.importScripts('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');",
      "function digs(v){var s=String(v==null?'':v).trim().replace(/^['\\\"]|['\\\"]$/g,'').replace(/\\.0+$/,'');return /^\\d{8,20}$/.test(s)?s:''}",
      "function alp(v){var s=String(v==null?'':v).toUpperCase().replace(/[^A-Z0-9]/g,'');return s.length>=8&&s.length<=32&&/\\d/.test(s)?s:''}",
      "function add(type,v,set){var s=String(v==null?'':v).trim();if(!s)return;if(type==='esic'){(s.match(/\\b\\d{8,20}\\b/g)||[]).forEach(function(x){var z=digs(x);if(z)set[z]=1})}else{s.split(/[\\s,;|]+/).forEach(function(x){var d=digs(x),a=alp(x),z=d&&d.length===12?d:a;if(z)set[z]=1});(s.match(/\\b\\d{12}\\b/g)||[]).forEach(function(x){set[x]=1})}}",
      "self.onmessage=function(e){var d=e.data||{},id=d.id;try{var wb=XLSX.read(d.buffer,{type:'array',cellDates:false,cellText:true}),set={},sample='',sheets=[];wb.SheetNames.forEach(function(sn,si){var rows=XLSX.utils.sheet_to_json(wb.Sheets[sn],{header:1,raw:false,defval:''});for(var r=0;r<rows.length;r++){var row=rows[r]||[];for(var c=0;c<row.length;c++){add(d.type,row[c],set);if(sample.length<12000)sample+=' '+String(row[c]||'')}}sheets.push({name:sn,rows:rows});self.postMessage({id:id,progress:true,pct:Math.round((si+1)/wb.SheetNames.length*100)})});self.postMessage({id:id,ok:true,ids:Object.keys(set),sample:sample.slice(0,12000),sheets:sheets},[])}catch(err){self.postMessage({id:id,ok:false,error:String(err&&err.message||err)})}}"
    ].join('\n');
    excelWorker=new Worker(URL.createObjectURL(new Blob([src],{type:'text/javascript'})));
    excelWorker.onmessage=function(e){var d=e.data||{},p=excelPending[d.id];if(!p)return;if(d.progress){if(p.progress)p.progress(d.pct||0);return}delete excelPending[d.id];if(d.ok)p.resolve(d);else p.reject(new Error(d.error||'Excel parse failed'))};
    excelWorker.onerror=function(e){Object.keys(excelPending).forEach(function(k){excelPending[k].reject(new Error(e.message||'Excel worker failed'));delete excelPending[k]})};
    return true
  }catch(e){console.warn('V2 Excel worker unavailable',e);return false}
}
function parseExcel(buf,type,progress){
  function main(){
    return Promise.resolve().then(async function(){
      if(!root.XLSX)throw new Error('Excel engine unavailable');
      var wb=root.XLSX.read(buf,{type:'array',cellDates:false,cellText:true}),set=new Set(),sample='',sheets=[];
      for(var si=0;si<wb.SheetNames.length;si++){
        var sn=wb.SheetNames[si],rows=root.XLSX.utils.sheet_to_json(wb.Sheets[sn],{header:1,raw:false,defval:''});
        for(var r=0;r<rows.length;r++){
          var row=rows[r]||[];for(var cc=0;cc<row.length;cc++){collectToken(type,row[cc],set);if(sample.length<12000)sample+=' '+String(row[cc]||'')}
          if(r%250===0)await tick()
        }
        sheets.push({name:sn,rows:rows});if(progress)progress(Math.round((si+1)/wb.SheetNames.length*100));await tick()
      }
      return{ids:Array.from(set),sample:sample.slice(0,12000),sheets:sheets}
    })
  }
  if(!ensureExcelWorker())return main();
  return new Promise(function(resolve,reject){
    var id=++excelSeq;excelPending[id]={resolve:resolve,reject:reject,progress:progress};
    var copy=buf.slice(0);excelWorker.postMessage({id:id,type:type,buffer:copy},[copy])
  }).catch(function(err){console.warn('Excel worker fallback',err);return main()})
}
async async function parsePdf(buf,type,progress){
  if(!root.pdfjsLib)throw new Error('PDF engine unavailable');
  if(root.pdfjsLib.GlobalWorkerOptions)root.pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  var doc=await root.pdfjsLib.getDocument({data:new Uint8Array(buf.slice(0))}).promise,set=new Set(),sample='',items=0;
  for(var p=1;p<=doc.numPages;p++){
    var page=await doc.getPage(p),tc=await page.getTextContent(),arr=tc.items||[],txt='';
    for(var i=0;i<arr.length;i++){
      var cur=arr[i],s=cur.str||'';collectToken(type,s,set);txt+=' '+s;items++;
      if(i<arr.length-1){
        var nx=arr[i+1],a=normalizeDigits(s),b=normalizeDigits(nx.str||''),y1=cur.transform&&cur.transform[5],y2=nx.transform&&nx.transform[5],x1=cur.transform&&cur.transform[4],x2=nx.transform&&nx.transform[4],gap=(x1!=null&&x2!=null)?x2-(x1+(cur.width||0)):999;
        if(a&&b&&a.length<12&&b.length<12&&a.length+b.length>=8&&a.length+b.length<=20&&y1!=null&&y2!=null&&Math.abs(y1-y2)<1.8&&gap>-3&&gap<14)collectToken(type,a+b,set)
      }
    }
    if(sample.length<12000)sample+=' '+txt;
    try{page.cleanup()}catch(_){}
    if(progress)progress(Math.round(p/doc.numPages*100));await tick()
  }
  try{doc.cleanup()}catch(_){}
  if(items<5)throw new Error('Scanned/image PDF: text layer not found');
  return{ids:Array.from(set),sample:sample.slice(0,12000),sheets:null}
}
async function parseBuffer(buf,name,type,progress){
  var ext=String(name||'').split('.').pop().toLowerCase(),x;
  if(ext==='pdf')x=await parsePdf(buf,type,progress);
  else if(['xlsx','xls','csv'].indexOf(ext)>=0)x=await parseExcel(buf,type,progress);
  else throw new Error('Unsupported file type: '+name);
  var per=inferPeriod(name,x.sample);
  return{ids:x.ids||[],period:per.period,periodSource:per.source,sheets:x.sheets||null}
}

function ensurePage(type){
  var id='page-'+type+'todol',page=$(id);if(page)return page;
  var content=document.querySelector('.content');if(!content)return null;
  page=document.createElement('div');page.className='page';page.id=id;content.appendChild(page);return page
}
function ensureNav(type){
  var id='vn-'+type+'todol',item=$(id),sub=$('cat-tools');if(item||!sub)return;
  item=document.createElement('div');item.className='vitem';item.id=id;item.setAttribute('onclick',"goPage('"+type+"todol')");item.innerHTML='<span class="vi">'+(type==='esic'?'🩺':'🧾')+'</span>'+(type==='esic'?'ESIC → DOL':'PF → DOL');
  var esic=$('vn-esic');if(type==='esic'&&esic&&esic.parentNode===sub)sub.insertBefore(item,esic.nextSibling);else sub.appendChild(item)
}

function pageHtml(type){
  var label=type==='esic'?'ESIC / IP Number':'UAN / PF Member ID',icon=type==='esic'?'🩺':'🧾',title=type==='esic'?'ESIC → DOL':'PF → DOL';
  return '<div class="cd2-shell" data-type="'+type+'">'+
    '<div class="cd2-head"><div><div class="cd2-kicker">COMPLIANCE DOL · CLEAN V2</div><div class="cd2-title">'+icon+' '+title+'</div><div class="cd2-sub">Challan pehle save hoga, phir index hoga. <b>Latest matched contribution month = DOL month</b>; beech ke missing months ignore honge.</div></div>'+
    '<div><button type="button" class="cd2-upload" data-cd2-pick="'+type+'">＋ Upload Challans</button><input id="cd2-'+type+'-upload" type="file" accept=".pdf,.xlsx,.xls,.csv" multiple style="display:none"></div></div>'+
    '<div class="cd2-strip"><span>💾 File first saved</span><span>👁 In-app viewer</span><span>🗑 Permanent delete</span><span>⚡ Search index — no re-parse</span><span>🧠 SHA-256 duplicate guard</span></div>'+
    '<div id="cd2-'+type+'-status" class="cd2-status">Ready.</div>'+
    '<div class="cd2-grid">'+
      '<section class="cd2-card"><div class="cd2-cardhead"><div><b>Saved Challan Library</b><small id="cd2-'+type+'-coverage">0 files</small></div><button data-cd2-refresh="'+type+'">↻ Refresh</button></div><div id="cd2-'+type+'-files" class="cd2-files"></div></section>'+
      '<section class="cd2-card"><div class="cd2-cardhead"><div><b>Find DOL Month</b><small>Exact ID search across successfully indexed challans</small></div></div>'+
        '<div class="cd2-search"><label>'+label+'</label><textarea id="cd2-'+type+'-query" placeholder="One or multiple IDs — space / comma / new line"></textarea><button data-cd2-search="'+type+'">Find DOL Month</button></div>'+
        '<div id="cd2-'+type+'-results" class="cd2-results"><div class="cd2-empty">Search an ID to see its contribution timeline.</div></div>'+
      '</section>'+
    '</div></div>'
}
function addCss(){
  if($('cd2-style'))return;var s=document.createElement('style');s.id='cd2-style';s.textContent=
  '#page-esictodol,#page-pftodol{overflow:auto!important;background:#f6f8fc!important}.cd2-shell{padding:18px;min-height:100%;font-family:Inter,Arial,sans-serif}.cd2-head{display:flex;align-items:center;justify-content:space-between;gap:20px;background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:20px;box-shadow:0 4px 16px rgba(15,23,42,.04)}.cd2-kicker{font-size:9px;font-weight:900;letter-spacing:1.6px;color:#4f46e5}.cd2-title{font-size:22px;font-weight:900;color:#0f172a;margin-top:3px}.cd2-sub{font-size:11px;color:#64748b;max-width:820px;line-height:1.6;margin-top:5px}.cd2-upload{position:relative;background:#312e81;color:#fff;border-radius:10px;padding:12px 16px;font-size:11px;font-weight:850;cursor:pointer;white-space:nowrap}.cd2-upload input{position:absolute;inset:0;opacity:0;cursor:pointer}.cd2-strip{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0}.cd2-strip span{font-size:9px;font-weight:750;color:#334155;background:#fff;border:1px solid #e2e8f0;border-radius:999px;padding:6px 9px}.cd2-status{min-height:34px;padding:8px 11px;background:#eef2ff;border:1px solid #c7d2fe;color:#3730a3;border-radius:10px;font-size:10px;font-weight:750;margin-bottom:10px}.cd2-grid{display:grid;grid-template-columns:minmax(420px,.95fr) minmax(460px,1.05fr);gap:12px}.cd2-card{background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:12px;min-width:0}.cd2-cardhead{display:flex;justify-content:space-between;gap:10px;align-items:flex-start;margin-bottom:10px}.cd2-cardhead b{display:block;font-size:12px;color:#0f172a}.cd2-cardhead small{display:block;font-size:9px;color:#94a3b8;margin-top:2px}.cd2-cardhead button{border:1px solid #e2e8f0;background:#f8fafc;color:#475569;border-radius:7px;padding:5px 8px;font-size:9px;font-weight:800;cursor:pointer}.cd2-files{display:flex;flex-direction:column;gap:7px;max-height:520px;overflow:auto}.cd2-file{display:grid;grid-template-columns:minmax(0,1fr) 118px auto auto;gap:7px;align-items:center;border:1px solid #e2e8f0;border-radius:10px;padding:9px;background:#fafafa}.cd2-file.warn{border-color:#f59e0b;background:#fffbeb}.cd2-fn{font-size:10px;font-weight:850;color:#1e293b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.cd2-fm{font-size:8px;color:#94a3b8;margin-top:3px;line-height:1.5}.cd2-file input{width:118px;border:1px solid #cbd5e1;border-radius:7px;padding:6px;font-size:9px;background:#fff}.cd2-btn{border:1px solid #cbd5e1;background:#fff;border-radius:7px;padding:6px 8px;font-size:9px;font-weight:850;cursor:pointer}.cd2-del{color:#b91c1c;border-color:#fecaca;background:#fff7f7}.cd2-search label{display:block;font-size:9px;font-weight:850;color:#475569;margin-bottom:5px}.cd2-search textarea{width:100%;min-height:92px;resize:vertical;border:1px solid #cbd5e1;border-radius:10px;padding:10px;font:11px/1.5 JetBrains Mono,monospace}.cd2-search>button{margin-top:7px;width:100%;border:0;border-radius:9px;padding:10px;background:#312e81;color:#fff;font-size:10px;font-weight:900;cursor:pointer}.cd2-results{margin-top:12px;overflow:auto;max-height:440px}.cd2-empty{padding:34px 12px;text-align:center;color:#94a3b8;font-size:10px}.cd2-table{width:100%;border-collapse:collapse;font-size:9px}.cd2-table th{position:sticky;top:0;background:#f8fafc;color:#64748b;text-align:left;padding:7px;border-bottom:1px solid #e2e8f0}.cd2-table td{vertical-align:top;padding:8px 7px;border-bottom:1px solid #f1f5f9}.cd2-last{font-size:11px;font-weight:900;color:#166534}.cd2-bad{color:#b91c1c;font-weight:800}.cd2-warn{color:#b45309;font-weight:800}.cd2-months{display:flex;flex-wrap:wrap;gap:3px}.cd2-months span{background:#eef2ff;color:#3730a3;border-radius:999px;padding:3px 6px;font-size:8px;font-weight:800}.cd2-view{position:fixed;inset:0;background:rgba(15,23,42,.78);z-index:99999;display:none;align-items:center;justify-content:center;padding:22px}.cd2-view.show{display:flex}.cd2-modal{width:min(1180px,96vw);height:min(820px,92vh);background:#fff;border-radius:16px;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 30px 80px rgba(0,0,0,.35)}.cd2-vh{height:50px;display:flex;align-items:center;gap:10px;padding:0 14px;border-bottom:1px solid #e2e8f0}.cd2-vtitle{min-width:0;flex:1}.cd2-vtitle b{display:block;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.cd2-vtitle span{display:block;font-size:8px;color:#94a3b8;margin-top:2px}.cd2-vh button,.cd2-vh select{border:1px solid #cbd5e1;background:#fff;border-radius:7px;padding:6px 8px;font-size:9px;font-weight:800}.cd2-vbody{flex:1;min-height:0;background:#f8fafc;overflow:auto}.cd2-vbody iframe{width:100%;height:100%;border:0;background:#fff}.cd2-xls{min-width:100%;border-collapse:collapse;background:#fff;font-size:10px}.cd2-xls td{border:1px solid #e2e8f0;padding:5px 7px;white-space:nowrap}.cd2-vfoot{height:42px;border-top:1px solid #e2e8f0;display:flex;align-items:center;justify-content:center;gap:8px;font-size:9px;color:#64748b}@media(max-width:1000px){.cd2-grid{grid-template-columns:1fr}.cd2-file{grid-template-columns:minmax(0,1fr) 110px auto auto}}';
  document.head.appendChild(s)
}
function ensureViewer(){
  if($('cd2-viewer'))return;
  var d=document.createElement('div');d.id='cd2-viewer';d.className='cd2-view';d.innerHTML='<div class="cd2-modal"><div class="cd2-vh"><div class="cd2-vtitle"><b id="cd2-vname">Challan</b><span id="cd2-vmeta"></span></div><select id="cd2-vsheet" style="display:none"></select><button id="cd2-vclose">✕ Close</button></div><div id="cd2-vbody" class="cd2-vbody"></div><div id="cd2-vfoot" class="cd2-vfoot" style="display:none"><button id="cd2-vprev">← Prev</button><span id="cd2-vpage">1 / 1</span><button id="cd2-vnext">Next →</button></div></div>';
  document.body.appendChild(d);
  $('cd2-vclose').onclick=closeViewer;
  $('cd2-viewer').onclick=function(e){if(e.target===this)closeViewer()};
  $('cd2-vsheet').onchange=function(){viewer.sheet=Number(this.value)||0;viewer.page=1;renderExcelPage()};
  $('cd2-vprev').onclick=function(){if(viewer.page>1){viewer.page--;renderExcelPage()}};
  $('cd2-vnext').onclick=function(){var sh=viewer.sheets&&viewer.sheets[viewer.sheet],pages=Math.max(1,Math.ceil(((sh&&sh.rows)||[]).length/viewer.pageSize));if(viewer.page<pages){viewer.page++;renderExcelPage()}}
}
function closeViewer(){
  if(viewer.url){try{URL.revokeObjectURL(viewer.url)}catch(_){}viewer.url=''}
  viewer.sheets=null;$('cd2-viewer').classList.remove('show');$('cd2-vbody').innerHTML='';$('cd2-vfoot').style.display='none';$('cd2-vsheet').style.display='none'
}
async function openViewer(type,id){
  ensureViewer();var rec=await dbGet(id);if(!rec){setStatus(type,'Open failed — saved record not found',true);return}
  $('cd2-vname').textContent=rec.name||'Challan';$('cd2-vmeta').textContent=(rec.period?periodLabel(rec.period):'Month required')+' · SHA-256 '+String(rec.hash||'').slice(0,16)+'…';
  $('cd2-viewer').classList.add('show');$('cd2-vbody').innerHTML='<div class="cd2-empty">Opening challan…</div>';
  var ext=String(rec.name||'').split('.').pop().toLowerCase();
  if(ext==='pdf'){
    var blob=rec.blob instanceof Blob?rec.blob:new Blob([rec.buffer||new ArrayBuffer(0)],{type:'application/pdf'});
    viewer.url=URL.createObjectURL(blob);$('cd2-vbody').innerHTML='<iframe title="PDF challan viewer" src="'+esc(viewer.url)+'#toolbar=1&navpanes=0"></iframe>';return
  }
  try{
    var buf=rec.blob instanceof Blob?await rec.blob.arrayBuffer():rec.buffer;
    var parsed=rec.viewerSheets&&rec.viewerSheets.length?{sheets:rec.viewerSheets}:await parseExcel(buf,type,function(p){$('cd2-vbody').innerHTML='<div class="cd2-empty">Preparing Excel viewer… '+p+'%</div>'});
    if(!rec.viewerSheets&&parsed.sheets){rec.viewerSheets=parsed.sheets;try{await dbPut(rec)}catch(_){}}
    viewer.sheets=parsed.sheets||[];viewer.sheet=0;viewer.page=1;
    if(!viewer.sheets.length)throw new Error('No sheets found');
    var sel=$('cd2-vsheet');sel.innerHTML=viewer.sheets.map(function(s,i){return'<option value="'+i+'">'+esc(s.name||('Sheet '+(i+1)))+'</option>'}).join('');sel.style.display=viewer.sheets.length>1?'inline-block':'none';$('cd2-vfoot').style.display='flex';renderExcelPage()
  }catch(e){$('cd2-vbody').innerHTML='<div class="cd2-empty cd2-bad">Could not open Excel challan: '+esc(e.message||e)+'</div>'}
}
function renderExcelPage(){
  var sh=viewer.sheets&&viewer.sheets[viewer.sheet];if(!sh)return;
  var rows=sh.rows||[],pages=Math.max(1,Math.ceil(rows.length/viewer.pageSize));viewer.page=Math.max(1,Math.min(pages,viewer.page));
  var from=(viewer.page-1)*viewer.pageSize,to=Math.min(rows.length,from+viewer.pageSize),max=0;for(var i=from;i<to;i++)max=Math.max(max,(rows[i]||[]).length);
  var h='<table class="cd2-xls"><tbody>';for(var r=from;r<to;r++){h+='<tr><td style="background:#f8fafc;color:#94a3b8">'+(r+1)+'</td>';for(var c=0;c<max;c++)h+='<td>'+esc((rows[r]||[])[c]||'')+'</td>';h+='</tr>'}h+='</tbody></table>';
  $('cd2-vbody').innerHTML=h;$('cd2-vpage').textContent=viewer.page+' / '+pages+' · '+esc(sh.name||'Sheet')
}

function setStatus(type,msg,bad){var x=$('cd2-'+type+'-status');if(!x)return;x.textContent=msg;x.style.background=bad?'#fef2f2':'#eef2ff';x.style.borderColor=bad?'#fecaca':'#c7d2fe';x.style.color=bad?'#b91c1c':'#3730a3'}
function rebuildIndex(type){
  var rows=state[type].rows||[],idx={},periods=new Set();
  rows.forEach(function(r){if(r.period)periods.add(r.period);(r.ids||[]).forEach(function(id){var v=validId(type,id);if(v)(idx[v]||(idx[v]=[])).push(r)})});
  Object.keys(idx).forEach(function(k){idx[k].sort(function(a,b){return String(a.period||'').localeCompare(String(b.period||''))})});
  state[type].index=idx;state[type].periods=Array.from(periods).sort()
}
async function refresh(type){
  var all=await dbAll();state[type].rows=all.filter(function(r){return r&&r.type===type}).sort(function(a,b){return String(b.period||'').localeCompare(String(a.period||''))||String(b.uploadedAt||'').localeCompare(String(a.uploadedAt||''))});rebuildIndex(type);renderFiles(type)
}
function renderFiles(type){
  var rows=state[type].rows||[],box=$('cd2-'+type+'-files'),cov=$('cd2-'+type+'-coverage');if(!box)return;
  var periods=state[type].periods||[],bad=rows.filter(function(r){return r.parseStatus==='error'||!(r.ids||[]).length}).length;
  cov.textContent=rows.length+' saved file'+(rows.length===1?'':'s')+(periods.length?' · '+periodLabel(periods[0])+' → '+periodLabel(periods[periods.length-1]):'')+(bad?' · '+bad+' need indexing':'');
  if(!rows.length){box.innerHTML='<div class="cd2-empty">No V2 challans yet. Upload all ESIC/PF challans here.</div>';return}
  box.innerHTML=rows.map(function(r){
    var indexed=(r.ids||[]).length>0&&r.parseStatus!=='error',meta=indexed?((r.ids||[]).length+' indexed IDs'):'⚠ Needs indexing';
    if(r.parseStatus==='processing')meta='⏳ Indexing…';
    return'<div class="cd2-file '+(!r.period||!indexed?'warn':'')+'"><div><div class="cd2-fn">'+esc(r.name)+'</div><div class="cd2-fm">'+Math.round((r.size||0)/1024)+' KB · '+meta+' · SHA '+esc(String(r.hash||'').slice(0,10))+(r.parseError?' · '+esc(r.parseError):'')+'</div></div><input type="month" data-cd2-period="'+esc(r.id)+'" value="'+esc(r.period||'')+'"><button class="cd2-btn" data-cd2-view="'+esc(r.id)+'">👁 Open</button><button class="cd2-btn cd2-del" data-cd2-delete="'+esc(r.id)+'">🗑 Delete</button></div>'
  }).join('')
}
async function updatePeriod(type,id,period){
  var r=await dbGet(id);if(!r)return;r.period=period||'';r.periodSource='manual';r.updatedAt=new Date().toISOString();await dbPut(r);await refresh(type);setStatus(type,'Month saved ✓ — '+(r.period?periodLabel(r.period):'month cleared'))
}
async function deleteOne(type,id){
  var r=await dbGet(id);if(!r)return;
  if(!confirm('Permanently delete this challan from V2 library?\\n\\n'+(r.name||id)+(r.period?'\\n'+periodLabel(r.period):'')))return;
  try{await dbDelete(id);await refresh(type);setStatus(type,'Deleted permanently ✓ — '+(r.name||'challan'))}catch(e){setStatus(type,'Delete failed — '+(e.message||e),true)}
}
async async function upload(type,fileList){
  var files=Array.isArray(fileList)?fileList.slice():Array.from(fileList||[]);if(!files.length){setStatus(type,'No file selected',true);return}
  var all=await dbAll(),byHash={};all.filter(function(r){return r.type===type}).forEach(function(r){if(r.hash)byHash[r.hash]=r});
  var saved=0,indexed=0,dups=0,warns=[];
  for(var i=0;i<files.length;i++){
    var f=files[i];setStatus(type,'Saving '+(i+1)+' / '+files.length+' · '+f.name);
    try{
      if(!/\.(pdf|xlsx|xls|csv)$/i.test(f.name))throw new Error('Unsupported file type');
      var buf=await f.arrayBuffer(),hash=await sha256(buf);
      if(byHash[hash]){dups++;setStatus(type,'Already saved ✓ — '+f.name);continue}
      var quick=inferPeriod(f.name,''),rec={id:uid(type,hash),version:2,type:type,name:f.name,size:f.size,lastModified:f.lastModified||0,hash:hash,period:quick.period,periodSource:quick.source,ids:[],parseStatus:'processing',parseError:'',uploadedAt:new Date().toISOString(),updatedAt:new Date().toISOString(),blob:new Blob([buf],{type:fileMime(f.name)}),viewerSheets:null};
      await dbPut(rec);byHash[hash]=rec;saved++;await refresh(type);setStatus(type,'Saved ✓ · indexing '+(i+1)+' / '+files.length+' · '+f.name+' · 0%');
      try{
        var parsed=await parseBuffer(buf,f.name,type,function(p){setStatus(type,'Saved ✓ · indexing '+(i+1)+' / '+files.length+' · '+f.name+' · '+p+'%')});
        rec.ids=parsed.ids||[];if(!rec.period&&parsed.period){rec.period=parsed.period;rec.periodSource=parsed.periodSource}
        rec.viewerSheets=parsed.sheets||null;rec.parseStatus=rec.ids.length?'ready':'error';rec.parseError=rec.ids.length?'':'No valid '+(type==='esic'?'ESIC/IP':'PF/UAN')+' number detected';
        if(rec.ids.length)indexed++;else warns.push(f.name+': no IDs detected');
      }catch(pe){
        rec.parseStatus='error';rec.parseError=String(pe&&pe.message||pe);warns.push(f.name+': '+rec.parseError)
      }
      rec.updatedAt=new Date().toISOString();await dbPut(rec);buf=null;await refresh(type);await tick()
    }catch(e){warns.push(f.name+': '+(e.message||e));console.warn('V2 challan upload failed',f.name,e)}
  }
  await refresh(type);
  var msg=[];if(saved)msg.push(saved+' file saved ✓');if(indexed)msg.push(indexed+' indexed ✓');if(dups)msg.push(dups+' duplicate skipped ✓');if(warns.length)msg.push(warns.slice(0,2).join(' | ')+(warns.length>2?' | +'+(warns.length-2)+' more':''));
  setStatus(type,msg.join(' · ')||'No files saved',!saved&&!!warns.length)
}
function parseQueries(type){
  var raw=String($('cd2-'+type+'-query').value||''),parts=raw.split(/[\s,;|]+/),out=[];
  parts.forEach(function(x){var v=validId(type,x);if(v&&out.indexOf(v)<0)out.push(v)});return out
}
function search(type){
  var qs=parseQueries(type),box=$('cd2-'+type+'-results');if(!qs.length){setStatus(type,'Enter a valid '+(type==='esic'?'ESIC/IP number':'UAN/PF ID'),true);return}
  var idx=state[type].index||{},coverage=state[type].periods||[],unindexed=(state[type].rows||[]).filter(function(r){return r.parseStatus==='error'||!(r.ids||[]).length});
  var h='<table class="cd2-table"><thead><tr><th>ID</th><th>DOL MONTH</th><th>MATCHED CONTRIBUTIONS</th><th>CHECK</th></tr></thead><tbody>';
  qs.forEach(function(id){
    var m=(idx[id]||[]).slice(),unresolved=m.filter(function(r){return!r.period}),known=m.filter(function(r){return!!r.period}).sort(function(a,b){return a.period.localeCompare(b.period)}),months=Array.from(new Set(known.map(function(r){return r.period}))).sort(),last=months.length?months[months.length-1]:'',later=last?coverage.filter(function(p){return p>last}).length:0;
    var blocking=unindexed.filter(function(r){return !last||!r.period||r.period>=last});
    var dol=!m.length?'<span class="cd2-bad">Not found</span>':unresolved.length?'<span class="cd2-warn">Set month first</span>':blocking.length?'<span class="cd2-warn">Index incomplete</span><div style="font-size:8px;margin-top:2px">'+blocking.length+' challan(s) need indexing</div>':'<span class="cd2-last">'+periodLabel(last)+'</span><div style="font-size:8px;color:#166534;margin-top:2px">Latest contribution = DOL</div>';
    var check=!m.length?'No exact ID match':unresolved.length?unresolved.length+' matched challan(s) need month':blocking.length?'Cannot certify latest month until pending challans are indexed':later+' later uploaded month(s) checked with no contribution';
    h+='<tr><td><b>'+esc(id)+'</b></td><td>'+dol+'</td><td><div class="cd2-months">'+(months.length?months.map(function(p){return'<span>'+periodLabel(p)+'</span>'}).join(''):'—')+'</div></td><td>'+esc(check)+'</td></tr>'
  });
  h+='</tbody></table>';box.innerHTML=h;setStatus(type,'Search complete ✓ · gaps ignored · latest matched contribution month used as DOL · no file re-parse'+(unindexed.length?' · '+unindexed.length+' saved challan(s) still need indexing':''))
}
async function migrateLegacy(){
  if(!root.indexedDB)return;
  try{
    var req=indexedDB.open('ATPL_COMPLIANCE_DOL_V1',1),db=await new Promise(function(ok,no){req.onsuccess=function(){ok(req.result)};req.onerror=function(){no(req.error)};req.onupgradeneeded=function(){try{req.transaction.abort()}catch(_){}}});
    if(!db.objectStoreNames.contains('files')){db.close();return}
    var old=await new Promise(function(ok){var r=db.transaction('files','readonly').objectStore('files').getAll();r.onsuccess=function(){ok(r.result||[])};r.onerror=function(){ok([])}});db.close();
    var current=await dbAll(),hashes={};current.forEach(function(r){if(r.hash)hashes[r.hash]=1});
    var moved=0;
    for(var i=0;i<old.length;i++){
      var r=old[i];if(!r||['esic','pf'].indexOf(r.type)<0||!r.buffer)continue;
      try{
        var buf=r.buffer instanceof ArrayBuffer?r.buffer:(r.buffer.buffer||null);if(!buf)continue;
        var hash=r.fileHash||await sha256(buf);if(hashes[hash])continue;
        var ids=Array.from(new Set([].concat(r.digitIds||[],r.alnumIds||[]).map(function(x){return validId(r.type,x)}).filter(Boolean)));if(!ids.length)continue;
        var nr={id:uid(r.type,hash),version:2,type:r.type,name:r.name||'Legacy challan',size:r.size||buf.byteLength,lastModified:r.lastModified||0,hash:hash,period:r.period||'',periodSource:r.periodSource||'legacy',ids:ids,uploadedAt:r.uploadedAt||new Date().toISOString(),updatedAt:new Date().toISOString(),blob:new Blob([buf],{type:fileMime(r.name)}),viewerSheets:r.viewerSheets||null,migrated:true};
        await dbPut(nr);hashes[hash]=1;moved++;await tick()
      }catch(e){console.warn('V2 legacy migration skipped',e)}
    }
    if(moved)console.info('Compliance DOL V2 migrated',moved,'local challan files')
  }catch(e){console.warn('V2 legacy migration unavailable',e)}
}
function wire(type){
  var inp=$('cd2-'+type+'-upload'),pick=document.querySelector('[data-cd2-pick="'+type+'"]');
  pick.onclick=function(){inp.click()};
  inp.addEventListener('change',function(){var fs=Array.from(this.files||[]);this.value='';if(fs.length)upload(type,fs);else setStatus(type,'No file selected',true)});
  document.querySelector('[data-cd2-search="'+type+'"]').onclick=function(){search(type)};
  document.querySelector('[data-cd2-refresh="'+type+'"]').onclick=function(){refresh(type)};
  $('cd2-'+type+'-files').addEventListener('change',function(e){var id=e.target.getAttribute('data-cd2-period');if(id)updatePeriod(type,id,e.target.value)});
  $('cd2-'+type+'-files').addEventListener('click',function(e){var v=e.target.closest&&e.target.closest('[data-cd2-view]');if(v){openViewer(type,v.getAttribute('data-cd2-view'));return}var d=e.target.closest&&e.target.closest('[data-cd2-delete]');if(d)deleteOne(type,d.getAttribute('data-cd2-delete'))})
}
async function boot(){
  addCss();ensureViewer();ensureNav('esic');ensureNav('pf');
  var ep=ensurePage('esic'),pp=ensurePage('pf');if(!ep||!pp)throw new Error('ERP content container not found');
  ep.innerHTML=pageHtml('esic');pp.innerHTML=pageHtml('pf');wire('esic');wire('pf');
  await migrateLegacy();await Promise.all([refresh('esic'),refresh('pf')]);
  setStatus('esic','V2 ready ✓ — original files stay saved on this browser/device. Upload all ESIC challans.');
  setStatus('pf','V2 ready ✓ — original files stay saved on this browser/device. Upload all PF challans.');
}
function start(){setTimeout(function(){boot().catch(function(e){console.error('Compliance DOL V2 boot failed',e)})},180)}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();

root.ATPLComplianceDOLV2={refresh:refresh,open:function(type,id){return openViewer(type,id)},version:function(){return root.__ATPL_COMPLIANCE_DOL_REBUILD_V2__}};
})(window);
