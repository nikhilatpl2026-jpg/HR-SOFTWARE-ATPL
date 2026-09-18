/* ATPL Compliance DOL Finder V1
   Two independent tools:
   - ESIC → DOL: exact ESIC/IP number across all uploaded challans.
   - PF → DOL: exact UAN/PF member id across all uploaded challans.
   Finds LAST contribution month among ALL uploaded periods; gaps do not stop the scan.
*/
(function(g){'use strict';
if(!g||g.__ATPL_COMPLIANCE_DOL_V1__)return;
g.__ATPL_COMPLIANCE_DOL_V1__='2026.09.18-perf-view1';

var DB='ATPL_COMPLIANCE_DOL_V1',VER=1,STORE='files';
var cache={esic:[],pf:[]},lastResults={esic:[],pf:[]},searchMode={esic:'single',pf:'single'},searchIndex={esic:{},pf:{}},coveragePeriods={esic:[],pf:[]},cloudReady={esic:false,pf:false};
var excelWorker=null,excelJob=0,excelPending={};
var viewer={open:false,type:'',id:'',mode:'',pdf:null,page:1,pages:1,zoom:1.15,sheet:0,scrollTop:0};
var MONTHS={jan:1,january:1,feb:2,february:2,mar:3,march:3,apr:4,april:4,may:5,jun:6,june:6,jul:7,july:7,aug:8,august:8,sep:9,sept:9,september:9,oct:10,october:10,nov:11,november:11,dec:12,december:12};
function q(id){return document.getElementById(id)}
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function sleep(ms){return new Promise(function(r){setTimeout(r,ms||0)})}
function uid(t){return t+'_'+Date.now()+'_'+Math.random().toString(36).slice(2,8)}
function notifyChange(){try{document.dispatchEvent(new CustomEvent('atpl-compliance-dol-local-change'))}catch(_){}}
function periodLabel(p){if(!p)return'Period required';var a=p.split('-'),d=new Date(Number(a[0]),Number(a[1])-1,1);return d.toLocaleString('en-IN',{month:'short',year:'numeric'})}
function cmpPeriod(a,b){return String(a||'').localeCompare(String(b||''))}
function expandScientific(v){
  var s=String(v==null?'':v).trim(),m=s.match(/^([+-]?)(\d+)(?:\.(\d*))?[eE]([+-]?\d+)$/);if(!m)return s;
  var sign=m[1]==='-'?'-':'',ints=m[2],frac=m[3]||'',exp=parseInt(m[4],10),digits=ints+frac,pos=ints.length+exp;
  if(pos<=0)digits='0'.repeat(-pos)+digits,pos=0;
  if(pos>=digits.length)digits=digits+'0'.repeat(pos-digits.length);
  else digits=digits.slice(0,pos)+'.'+digits.slice(pos);
  digits=digits.replace(/^0+(?=\d)/,'').replace(/\.0+$/,'');return sign+(digits||'0')
}
function canonDigits(v){
  if(typeof v==='number'&&isFinite(v)){if(Math.floor(v)!==v)return'';return String(v)}
  var s=String(v==null?'':v).trim().replace(/^['"]|['"]$/g,'');if(!s)return'';
  if(/[eE]/.test(s))s=expandScientific(s);
  s=s.replace(/\.0+$/,'').trim();
  if(/^\d+$/.test(s))return s;
  if(/^\d[\d\s/_-]*\d$/.test(s))return s.replace(/\D/g,'');
  return''
}
function canonAlpha(v){return String(v==null?'':v).toUpperCase().replace(/[^A-Z0-9]/g,'')}
function validEsic(v){var x=canonDigits(v);return x.length>=8&&x.length<=20?x:''}
function validPf(v){var a=canonAlpha(v),d=canonDigits(v);if(d.length===12)return d;return a.length>=8&&a.length<=32&&/\d/.test(a)?a:''}
function normalizeQuery(type,v){return type==='esic'?validEsic(v):validPf(v)}
function hashFallback(s){var h1=2166136261,h2=5381;for(var i=0;i<s.length;i++){h1^=s.charCodeAt(i);h1=Math.imul(h1,16777619);h2=((h2<<5)+h2)^s.charCodeAt(i)}return('00000000'+(h1>>>0).toString(16)).slice(-8)+('00000000'+(h2>>>0).toString(16)).slice(-8)}
async function hashText(s){
  try{if(g.crypto&&g.crypto.subtle){var TE=g.TextEncoder||TextEncoder,ab=await g.crypto.subtle.digest('SHA-256',new TE().encode(String(s)));return Array.from(new Uint8Array(ab)).map(function(b){return b.toString(16).padStart(2,'0')}).join('')}}catch(_){}
  return hashFallback(String(s))
}
async function hashBuffer(buf){
  try{if(g.crypto&&g.crypto.subtle){var ab=await g.crypto.subtle.digest('SHA-256',buf.slice(0));return Array.from(new Uint8Array(ab)).map(function(b){return b.toString(16).padStart(2,'0')}).join('')}}catch(_){}
  var a=new Uint8Array(buf),h1=2166136261,h2=5381;for(var i=0;i<a.length;i++){h1^=a[i];h1=Math.imul(h1,16777619);h2=((h2<<5)+h2)^a[i]}return('00000000'+(h1>>>0).toString(16)).slice(-8)+('00000000'+(h2>>>0).toString(16)).slice(-8)
}
async function fingerprintFor(type,digits,alnums){
  var ids=type==='esic'?(digits||[]):Array.from(new Set([].concat(digits||[],alnums||[])));
  ids=ids.map(String).filter(Boolean).sort();return hashText(type+'|'+ids.join('|'))
}
function duplicateKey(r){if(r&&r.fileHash)return String(r.type||'')+'|sha256|'+String(r.fileHash);return String(r&&r.type||'')+'|legacy|'+String(r&&r.id||'')}
function cloudApi(){var a=g.ATPLDurableEverythingV1;return a&&typeof a.saveComplianceDolConfirmed==='function'&&typeof a.saveComplianceDolBatchConfirmed==='function'&&typeof a.getComplianceDolRecords==='function'?a:null}
function withTimeout(p,ms,msg){return Promise.race([p,new Promise(function(_,rej){setTimeout(function(){rej(new Error(msg||'Operation timeout'))},ms)})])}
function setStatus(type,phase,msg,pct){
  var s=q(type+'DolStatus');if(!s)return;var p=Math.max(0,Math.min(100,Number(pct)||0));
  s.innerHTML='<div style="display:flex;justify-content:space-between;gap:8px"><b>'+esc(phase||'')+'</b><span>'+esc(msg||'')+'</span></div><div class="cdf-progress"><i style="width:'+p+'%"></i></div>'
}

function openDb(){return new Promise(function(ok,no){try{var r=indexedDB.open(DB,VER);r.onupgradeneeded=function(){var d=r.result;if(!d.objectStoreNames.contains(STORE))d.createObjectStore(STORE,{keyPath:'id'})};r.onsuccess=function(){ok(r.result)};r.onerror=function(){no(r.error)}}catch(e){no(e)}})}
async function dbAll(){try{var d=await openDb();return await new Promise(function(ok){var r=d.transaction(STORE,'readonly').objectStore(STORE).getAll();r.onsuccess=function(){d.close();ok(r.result||[])};r.onerror=function(){d.close();ok([])}})}catch(_){return[]}}
async function dbPut(rec){var d=await openDb();return new Promise(function(ok,no){var t=d.transaction(STORE,'readwrite');t.objectStore(STORE).put(rec);t.oncomplete=function(){d.close();ok(true)};t.onerror=function(){var e=t.error;d.close();no(e)}})}
async function dbGet(id){try{var d=await openDb();return await new Promise(function(ok){var r=d.transaction(STORE,'readonly').objectStore(STORE).get(id);r.onsuccess=function(){d.close();ok(r.result||null)};r.onerror=function(){d.close();ok(null)}})}catch(_){return null}}
function parsePeriodCore(s){
  s=String(s||'').toLowerCase();
  var m=s.match(/\b(20\d{2})[\s._\/-](0?[1-9]|1[0-2])\b/);if(m)return m[1]+'-'+String(Number(m[2])).padStart(2,'0');
  m=s.match(/\b(0?[1-9]|1[0-2])[\s._\/-](20\d{2})\b/);if(m)return m[2]+'-'+String(Number(m[1])).padStart(2,'0');
  m=s.match(/\b(0?[1-9]|1[0-2])[\s._\/-](\d{2})\b/);if(m){var y=Number(m[2]);if(y>=20&&y<=40)return'20'+String(y).padStart(2,'0')+'-'+String(Number(m[1])).padStart(2,'0')}
  m=s.match(/(?:^|[^a-z0-9])(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)[\s._\/-]*(20\d{2}|\d{2})(?=$|[^0-9])/);
  if(m){var mo=MONTHS[m[1]],yy=m[2].length===2?'20'+m[2]:m[2];if(mo)return yy+'-'+String(mo).padStart(2,'0')}
  m=s.match(/(?:^|[^0-9])(20\d{2}|\d{2})[\s._\/-]*(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?=$|[^a-z0-9])/);
  if(m){var mo2=MONTHS[m[2]],yy2=m[1].length===2?'20'+m[1]:m[1];if(mo2)return yy2+'-'+String(mo2).padStart(2,'0')}
  return'';
}
function inferPeriod(name,text){
  var p=parsePeriodCore(name);if(p)return{period:p,source:'filename'};
  var low=String(text||'').toLowerCase(),keys=['contribution period','wage period','challan month','contribution month','month'];
  for(var i=0;i<keys.length;i++){var pos=low.indexOf(keys[i]);if(pos>=0){var s=low.slice(pos,Math.min(low.length,pos+120)),x=parsePeriodCore(s);if(x)return{period:x,source:'document'}}}
  return{period:'',source:'manual-required'};
}
function addTokens(text,digits,alnums){
  var s=String(text==null?'':text).trim();if(!s)return;
  var d=canonDigits(text),a=canonAlpha(s);
  if(d.length>=8&&d.length<=20)digits.add(d);
  if(a.length>=8&&a.length<=32&&/\d/.test(a))alnums.add(a);
  var dm=s.match(/\d(?:[\d\s/_.-]{6,24}\d)/g)||[];
  dm.forEach(function(x){var y=canonDigits(x);if(y.length>=8&&y.length<=20)digits.add(y)});
  var am=s.match(/[A-Za-z0-9][A-Za-z0-9/_.-]{7,31}/g)||[];
  am.forEach(function(x){var y=canonAlpha(x);if(y.length>=8&&y.length<=32&&/\d/.test(y))alnums.add(y)});
}
function headerLooksLike(type,v){
  var x=String(v==null?'':v).toLowerCase().replace(/[^a-z0-9]/g,'');
  if(type==='esic')return /^(ip|ipno|ipnumber|insuranceno|insurancenumber|esic|esicno|esicnumber|esi|esino|esinumber)$/.test(x);
  return /^(uan|uanno|uannumber|pfno|pfnumber|memberid|memberno|pfmemberid|pfmemberno)$/.test(x)
}
async function parseExcelMain(buf,type){
  var wb=XLSX.read(buf,{type:'array',cellDates:false,cellText:true}),digits=new Set(),alnums=new Set(),sample='',cells=0,specific=0,fallbackDigits=new Set(),fallbackAlnums=new Set(),viewerSheets=[];
  for(var si=0;si<wb.SheetNames.length;si++){
    var sn=wb.SheetNames[si],ws=wb.Sheets[sn];if(!ws||!ws['!ref']){viewerSheets.push({name:sn,rows:[]});continue}
    var range=XLSX.utils.decode_range(ws['!ref']),cols=new Set(),viewRows=[];
    for(var hr=range.s.r;hr<=Math.min(range.e.r,range.s.r+19);hr++)for(var hc=range.s.c;hc<=range.e.c;hc++){var hcell=ws[XLSX.utils.encode_cell({r:hr,c:hc})];if(hcell&&headerLooksLike(type,hcell.v!=null?hcell.v:hcell.w))cols.add(hc)}
    for(var R=range.s.r;R<=range.e.r;R++){
      var viewRow=[];
      for(var C=range.s.c;C<=range.e.c;C++){
        var cell=ws[XLSX.utils.encode_cell({r:R,c:C})];if(!cell){viewRow.push('');continue}
        var raw=cell.v!=null?cell.v:cell.w,display=cell.w!=null?cell.w:raw;viewRow.push(display==null?'':String(display));if(raw==null||raw==='')continue;
        if(sample.length<20000)sample+=' '+String(display);cells++;
        addTokens(raw,fallbackDigits,fallbackAlnums);
        if(cols.has(C)){
          var before=digits.size+(alnums.size);addTokens(raw,digits,alnums);if(typeof raw!=='number'&&display!==raw)addTokens(display,digits,alnums);if(digits.size+alnums.size>before)specific++;
        }
      }
      viewRows.push(viewRow);if(R%120===0)await sleep(0);
    }
    viewerSheets.push({name:sn,rows:viewRows});await sleep(0);
  }
  if(!specific){digits=fallbackDigits;alnums=fallbackAlnums}
  return{digits:Array.from(digits),alnums:Array.from(alnums),sample:sample.slice(0,20000),detail:wb.SheetNames.length+' sheets · '+cells+' cells scanned · '+(specific?'ID column indexed':'safe fallback scan'),viewerSheets:viewerSheets}
}


function excelWorkerReady(){
  if(excelWorker)return true;if(typeof Worker!=='function')return false;
  try{
    excelWorker=new Worker('compliance-dol-worker-v2.js?v=20260918-1');
    excelWorker.onmessage=function(ev){var d=ev.data||{},x=excelPending[d.jobId];if(!x)return;if(d.type==='progress'){if(x.progress)x.progress(d.stage,d.percent);return}delete excelPending[d.jobId];if(d.type==='done')x.resolve(d.result||{});else x.reject(new Error(d.message||'Excel parse failed'))};
    excelWorker.onerror=function(e){Object.keys(excelPending).forEach(function(k){excelPending[k].reject(new Error('Excel parser worker failed'));delete excelPending[k]});try{excelWorker.terminate()}catch(_){}excelWorker=null};
    return true
  }catch(_){excelWorker=null;return false}
}
function parseExcelWorker(buf,type,onProgress){
  if(!excelWorkerReady())return parseExcelMain(buf,type);
  return new Promise(function(resolve,reject){var id=++excelJob,copy=buf.slice(0);excelPending[id]={resolve:resolve,reject:reject,progress:onProgress};excelWorker.postMessage({jobId:id,type:type,buffer:copy},[copy])})
}
async function parseExcel(buf,type,onProgress){return parseExcelWorker(buf,type,onProgress)}
async function parsePdf(buf){
  if(!g.pdfjsLib)throw new Error('PDF engine unavailable');
  try{if(g.pdfjsLib.GlobalWorkerOptions)g.pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'}catch(_){}
  var doc=await g.pdfjsLib.getDocument({data:new Uint8Array(buf.slice(0))}).promise,digits=new Set(),alnums=new Set(),sample='',items=0;
  for(var p=1;p<=doc.numPages;p++){
    var page=await doc.getPage(p),tc=await page.getTextContent(),arr=tc.items||[],txt=arr.map(function(x){return x.str||''}).join(' ');
    for(var i=0;i<arr.length;i++){
      var cur=arr[i],s=cur.str||'';addTokens(s,digits,alnums);
      if(i<arr.length-1){
        var nx=arr[i+1],a=canonDigits(s),b=canonDigits(nx.str||''),y1=cur.transform&&cur.transform[5],y2=nx.transform&&nx.transform[5],x1=cur.transform&&cur.transform[4],x2=nx.transform&&nx.transform[4],gap=(x1!=null&&x2!=null)?x2-(x1+(cur.width||0)):999;
        if(a&&b&&a.length<12&&b.length<12&&a.length+b.length>=8&&a.length+b.length<=20&&y1!=null&&y2!=null&&Math.abs(y1-y2)<1.5&&gap>-2&&gap<10)addTokens(s+(nx.str||''),digits,alnums);
      }
    }
    if(sample.length<12000)sample+=' '+txt;items+=arr.length;await sleep(0);
  }
  if(items<5||(digits.size===0&&alnums.size===0))throw new Error('Scanned/image PDF ya unreadable challan. Accuracy ke liye Excel/CSV ya selectable-text PDF upload karo.');
  return{digits:Array.from(digits),alnums:Array.from(alnums),sample:sample.slice(0,12000),detail:doc.numPages+' PDF pages · '+items+' text items scanned'};
}
async function parseBuffer(buf,name,type,onProgress){
  name=name||'';var ext=(name.split('.').pop()||'').toLowerCase(),parsed;
  if(ext==='pdf')parsed=await parsePdf(buf);else if(['xlsx','xls','csv'].indexOf(ext)>=0)parsed=await parseExcel(buf,type,onProgress);else throw new Error('Unsupported file: '+name);
  var per=inferPeriod(name,parsed.sample),fp=await fingerprintFor(type,parsed.digits,parsed.alnums);
  if(type==='esic'&&!parsed.digits.length)throw new Error('Parse Failed — valid ESIC/IP numbers not found.');
  if(type==='pf'&&!parsed.digits.length&&!parsed.alnums.length)throw new Error('Parse Failed — valid UAN/PF IDs not found.');
  return{buffer:buf,digits:parsed.digits,alnums:parsed.alnums,sample:parsed.sample,detail:parsed.detail,period:per.period,periodSource:per.source,fingerprint:fp,viewerSheets:parsed.viewerSheets||null}
}
async function parseFile(file,type,onProgress){
  var buf=await file.arrayBuffer(),fileHash=await hashBuffer(buf),p=await parseBuffer(buf,file.name||'',type,onProgress);p.fileHash=fileHash;return p
}
async function reindexStored(r,type){
  if(!r||!r.buffer)return r;
  if(!r.fileHash)r.fileHash=await hashBuffer(r.buffer);
  var p=await parseBuffer(r.buffer,r.name||'',type);r.digitIds=p.digits;r.alnumIds=p.alnums;r.detail=p.detail;r.fingerprint=p.fingerprint;r.viewerSheets=p.viewerSheets||r.viewerSheets||null;r.parseVersion='3';
  if(!r.period&&p.period){r.period=p.period;r.periodSource=p.periodSource}
  r.updatedAt=new Date().toISOString();return r
}

function pageIds(type){return{page:'page-'+type+'todol',nav:'vn-'+type+'todol',file:type+'DolFiles',result:type+'DolResults',input:type+'DolSingle',multi:type+'DolMulti',status:type+'DolStatus',mode:type+'DolMode'}}
function typeLabel(t){return t==='esic'?'ESIC → DOL':'PF → DOL'}
function idLabel(t){return t==='esic'?'ESIC / IP Number':'UAN / PF Member ID'}
function ensureNav(type){
  var ids=pageIds(type),item=q(ids.nav),sub=q('cat-tools');if(!sub)return;
  if(!item){item=document.createElement('div');item.className='vitem';item.id=ids.nav;item.setAttribute('onclick',"goPage('"+type+"todol')");item.innerHTML='<span class="vi">'+(type==='esic'?'🩺':'🧾')+'</span>'+typeLabel(type);var esic=q('vn-esic');if(type==='esic'&&esic&&esic.parentNode===sub)sub.insertBefore(item,esic.nextSibling);else sub.appendChild(item)}
}
function makePage(type){
  var ids=pageIds(type);if(q(ids.page))return;var content=document.querySelector('.content');if(!content)return;
  var page=document.createElement('div');page.className='page';page.id=ids.page;
  page.innerHTML='<div class="cdf-shell">'+
    '<div class="cdf-head"><div><div class="cdf-eye">COMPLIANCE / CONTRIBUTION HISTORY</div><div class="cdf-title">'+typeLabel(type)+'</div><div class="cdf-sub">Pichle 1–2 saal ke challans upload karo. Software exact '+idLabel(type)+' ko <b>saare uploaded months</b> me check karke last contribution month batayega. Beech ke gaps search ko stop nahi karte.</div></div><label class="cdf-upload">＋ Upload Challans<input id="'+type+'DolUpload" type="file" accept=".xlsx,.xls,.csv,.pdf" multiple></label></div>'+
    '<div class="cdf-guard"><b>Accuracy Guard</b><span>Exact normalized number matching · every uploaded challan scanned · unresolved matched month par result block · no “first gap = exit” assumption.</span></div>'+
    '<div class="cdf-grid"><div class="cdf-library"><div class="cdf-secHead"><div><b>Saved Challan Library</b><span id="'+type+'DolCoverage">0 files</span></div><span class="cdf-local">☁ Backend confirmed</span></div><div id="'+ids.file+'" class="cdf-filelist"></div></div>'+
    '<div class="cdf-search"><div class="cdf-secHead"><div><b>Find Last Contribution Month</b><span>Single ya multiple '+(type==='esic'?'ESIC':'UAN/PF')+' search</span></div></div>'+
      '<div class="cdf-tabs"><button data-cdf-mode="'+type+'-single" class="active">Single</button><button data-cdf-mode="'+type+'-multiple">Multiple</button></div>'+
      '<div id="'+type+'DolPaneSingle" class="cdf-pane active"><label>'+idLabel(type)+'</label><div class="cdf-searchrow"><input id="'+ids.input+'" placeholder="'+(type==='esic'?'e.g. 2706516566':'e.g. 100118067651 / PF member ID')+'"><button data-cdf-search="'+type+'">Search All Challans</button></div></div>'+
      '<div id="'+type+'DolPaneMultiple" class="cdf-pane"><label>Multiple '+idLabel(type)+' — one per line / comma separated</label><textarea id="'+ids.multi+'" placeholder="Enter multiple IDs here..."></textarea><button data-cdf-search="'+type+'">Find DOL Month for All</button></div>'+
      '<div id="'+ids.status+'" class="cdf-status"></div>'+
    '</div></div>'+
    '<div class="cdf-resultHead"><div><b>Results</b><span>“Last contribution” = latest matched month among every uploaded challan.</span></div><button id="'+type+'DolExport" disabled>⬇ Export Result</button></div>'+
    '<div id="'+ids.result+'" class="cdf-results"><div class="cdf-empty"><div>🔎</div><b>No search yet</b><span>Challans upload karke '+idLabel(type)+' search karo.</span></div></div>'+
  '</div>';content.appendChild(page);
}
function addCss(){
  if(q('cdf-style'))return;var s=document.createElement('style');s.id='cdf-style';
  s.textContent='#page-esictodol,#page-pftodol{background:#f6f7fb!important;overflow:auto!important}.cdf-shell{padding:18px;min-height:100%}.cdf-head{display:flex;justify-content:space-between;align-items:center;gap:18px;padding:19px 20px;background:linear-gradient(135deg,#fff,#fbfdff);border:1px solid #e5e7eb;border-radius:14px;box-shadow:0 1px 3px rgba(15,23,42,.04)}.cdf-eye{font-size:8px;letter-spacing:1.2px;font-weight:900;color:#2563eb}.cdf-title{font-size:21px;font-weight:850;color:#111827;margin-top:3px}.cdf-sub{font-size:10px;color:#64748b;line-height:1.65;max-width:760px;margin-top:5px}.cdf-upload{position:relative;padding:10px 14px;background:#1e3a8a;color:#fff;border-radius:9px;font-size:10px;font-weight:850;cursor:pointer;white-space:nowrap}.cdf-upload input{position:absolute;inset:0;opacity:0;cursor:pointer}.cdf-guard{margin-top:9px;display:flex;gap:9px;align-items:center;padding:8px 11px;border-radius:9px;background:#eff6ff;border:1px solid #bfdbfe;color:#1e40af;font-size:8px}.cdf-guard b{font-size:8px;white-space:nowrap}.cdf-grid{display:grid;grid-template-columns:minmax(360px,.9fr) minmax(440px,1.1fr);gap:10px;margin-top:10px}.cdf-library,.cdf-search{background:#fff;border:1px solid #e5e7eb;border-radius:11px;padding:12px}.cdf-secHead{display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:9px}.cdf-secHead>div{display:flex;flex-direction:column;gap:2px}.cdf-secHead b{font-size:11px;color:#334155}.cdf-secHead span{font-size:8px;color:#94a3b8}.cdf-local{font-size:8px!important;color:#15803d!important;background:#f0fdf4;border:1px solid #bbf7d0;padding:4px 6px;border-radius:999px}.cdf-filelist{max-height:310px;overflow:auto;display:flex;flex-direction:column;gap:6px}.cdf-file{display:grid;grid-template-columns:1fr 118px auto;gap:7px;align-items:center;border:1px solid #e5e7eb;background:#fafafa;border-radius:8px;padding:8px}.cdf-file.warn{border-color:#fde68a;background:#fffbeb}.cdf-fileName{font-size:9px;font-weight:800;color:#334155;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.cdf-fileMeta{font-size:7.5px;color:#94a3b8;margin-top:2px}.cdf-file input[type=month]{width:118px;border:1px solid #d1d5db;border-radius:6px;padding:5px;font-size:8px;background:#fff}.cdf-file button{border:1px solid #fed7aa;background:#fff7ed;color:#c2410c;border-radius:6px;padding:5px 7px;font-size:8px;font-weight:800;cursor:pointer}.cdf-file.archived{opacity:.55}.cdf-tabs{display:flex;background:#f3f4f6;border-radius:8px;padding:3px;width:max-content;margin-bottom:10px}.cdf-tabs button{border:0;background:transparent;border-radius:6px;padding:6px 11px;font-size:8px;font-weight:850;color:#64748b;cursor:pointer}.cdf-tabs button.active{background:#1e3a8a;color:#fff}.cdf-pane{display:none}.cdf-pane.active{display:block}.cdf-pane label{display:block;font-size:8px;font-weight:850;color:#64748b;margin-bottom:5px;text-transform:uppercase;letter-spacing:.5px}.cdf-searchrow{display:flex;gap:6px}.cdf-search input,.cdf-search textarea{width:100%;border:1px solid #d1d5db;border-radius:8px;padding:9px 10px;font:inherit;font-size:10px;outline:none}.cdf-search textarea{min-height:88px;resize:vertical}.cdf-search input:focus,.cdf-search textarea:focus{border-color:#3b82f6;box-shadow:0 0 0 3px #dbeafe}.cdf-search button[data-cdf-search]{border:0;background:#1e3a8a;color:#fff;border-radius:8px;padding:0 12px;font-size:9px;font-weight:850;cursor:pointer;white-space:nowrap}.cdf-paneMultiple button{margin-top:6px}.cdf-status{min-height:16px;margin-top:8px;font-size:8px;font-weight:700;color:#64748b}.cdf-resultHead{margin-top:10px;display:flex;justify-content:space-between;align-items:center;padding:10px 12px;background:#fff;border:1px solid #e5e7eb;border-radius:10px 10px 0 0}.cdf-resultHead>div{display:flex;flex-direction:column;gap:2px}.cdf-resultHead b{font-size:11px;color:#334155}.cdf-resultHead span{font-size:8px;color:#94a3b8}.cdf-resultHead button{border:1px solid #c7d2fe;background:#eef2ff;color:#3730a3;border-radius:7px;padding:6px 9px;font-size:8px;font-weight:850;cursor:pointer}.cdf-resultHead button:disabled{opacity:.35;cursor:not-allowed}.cdf-results{background:#fff;border:1px solid #e5e7eb;border-top:0;border-radius:0 0 10px 10px;min-height:220px;padding:10px}.cdf-empty{min-height:200px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;color:#94a3b8}.cdf-empty>div{font-size:34px}.cdf-empty b{font-size:12px;color:#475569}.cdf-empty span{font-size:8px}.cdf-table{width:100%;border-collapse:collapse}.cdf-table th{position:static!important;background:#f8fafc!important;color:#64748b!important;border:1px solid #eef2f7!important;padding:7px 8px!important;font-size:8px!important}.cdf-table td{border:1px solid #eef2f7!important;padding:7px 8px!important;font-size:9px!important;vertical-align:top}.cdf-last{font-size:11px;font-weight:900;color:#1e3a8a}.cdf-good{color:#15803d;font-weight:850}.cdf-warn{color:#b45309;font-weight:850}.cdf-bad{color:#b91c1c;font-weight:850}.cdf-timeline{display:flex;gap:3px;flex-wrap:wrap}.cdf-month{font-size:7px;padding:3px 5px;border-radius:999px;background:#eef2ff;color:#3730a3;border:1px solid #c7d2fe}.cdf-sources{font-size:7.5px;color:#64748b;line-height:1.5;max-width:290px}.cdf-progress{height:5px;background:#e5e7eb;border-radius:99px;overflow:hidden;margin-top:6px}.cdf-progress>i{display:block;height:100%;background:#2563eb;width:0;transition:width .2s}@media(max-width:1000px){.cdf-grid{grid-template-columns:1fr}.cdf-head{align-items:flex-start;flex-direction:column}.cdf-upload{width:100%;text-align:center}.cdf-file{grid-template-columns:1fr 118px}}';
  document.head.appendChild(s)
}
async function pullCloud(type){
  var api=cloudApi();if(!api)return false;
  var remote=await api.getComplianceDolRecords(type),local=await dbAll(),by={};local.forEach(function(r){if(r&&r.id)by[String(r.id)]=r});
  for(var i=0;i<remote.length;i++){
    var rr=remote[i],old=by[String(rr.id)];
    if(!old||String(rr.updatedAt||rr.uploadedAt||'')>=String(old.updatedAt||old.uploadedAt||'')){rr.buffer=old&&old.buffer?old.buffer:null;rr.cloudConfirmedAt=rr.cloudConfirmedAt||new Date().toISOString();await dbPut(rr)}
  }
  return true
}
async function migratePending(type){
  var api=cloudApi();if(!api)return{ok:false,migrated:0,failed:0,duplicates:0};
  var all=await dbAll(),confirmed={},list=all.filter(function(r){return r.type===type&&!r.cloudConfirmedAt}),migrated=0,failed=0,duplicates=0;
  all.filter(function(r){return r.type===type&&r.cloudConfirmedAt&&r.fingerprint}).forEach(function(r){confirmed[duplicateKey(r)]=r});
  for(var i=0;i<list.length;i++){
    var r=list[i];
    try{
      if(r.buffer&&r.parseVersion!=='2')r=await reindexStored(r,type);
      if(!r.fingerprint)r.fingerprint=await fingerprintFor(type,r.digitIds||[],r.alnumIds||[]);
      r.parseVersion='2';
      var dk=duplicateKey(r),dup=confirmed[dk];
      if(dup){r.archived=true;r.archivedAt=r.archivedAt||new Date().toISOString();r.duplicateOf=dup.id;r.cloudConfirmedAt=dup.cloudConfirmedAt;await dbPut(r);duplicates++;continue}
      var back=await api.saveComplianceDolConfirmed(r);r.cloudConfirmedAt=back.cloudConfirmedAt||new Date().toISOString();await dbPut(r);confirmed[dk]=r;migrated++;
    }catch(e){failed++;console.warn('Legacy challan backend migration failed',r&&r.name,e)}
    await sleep(0)
  }
  return{ok:failed===0,migrated:migrated,failed:failed,duplicates:duplicates}
}
async function refresh(type){
  var all=await dbAll();cache[type]=all.filter(function(r){return r.type===type});renderFiles(type);renderCoverage(type);
}

function renderCoverage(type){
  var active=cache[type].filter(function(r){return!r.archived}),known=Array.from(new Set(active.map(function(r){return r.period}).filter(Boolean))).sort(),u=active.filter(function(r){return!r.period}).length,txt=active.length+' files';
  if(known.length)txt+=' · '+periodLabel(known[0])+' → '+periodLabel(known[known.length-1]);if(u)txt+=' · '+u+' need month';var x=q(type+'DolCoverage');if(x)x.textContent=txt;
}
function renderFiles(type){
  var box=q(type+'DolFiles');if(!box)return;var list=cache[type].slice().sort(function(a,b){return cmpPeriod(b.period,a.period)||String(b.uploadedAt).localeCompare(String(a.uploadedAt))});
  if(!list.length){box.innerHTML='<div class="cdf-empty" style="min-height:150px"><div>📚</div><b>No challans saved</b><span>1–2 years ke challans ek saath upload kar sakte ho.</span></div>';return}
  box.innerHTML=list.map(function(r){
    var confirmed=!!r.cloudConfirmedAt,cloud=confirmed?'<span class="cdf-good">Saved ✓ backend</span>':'<span class="cdf-bad">Save Failed / pending retry</span>';
    return'<div class="cdf-file '+(!r.period?'warn ':'')+(r.archived?'archived':'')+'" data-id="'+esc(r.id)+'"><div><div class="cdf-fileName">'+esc(r.name)+'</div><div class="cdf-fileMeta">'+esc(r.detail||'')+' · '+Math.round((r.size||0)/1024)+' KB · '+(r.periodSource==='manual'?'manual month':r.periodSource||'')+' · '+cloud+'</div></div><input type="month" data-cdf-period="'+esc(r.id)+'" value="'+esc(r.period||'')+'" '+(r.archived?'disabled':'')+'><button data-cdf-archive="'+esc(r.id)+'">'+(r.archived?'Restore':'Archive')+'</button></div>'
  }).join('');
}

async function uploadFiles(type,files){
  files=Array.from(files||[]);if(!files.length)return;var status=q(type+'DolStatus'),api=cloudApi(),ok=0,failed=0,dupes=0,errors=[];
  if(!api){if(status)status.textContent='Save Failed — shared backend service unavailable.';return}
  try{await pullCloud(type)}catch(e){if(status)status.textContent='Save Failed — backend could not be loaded: '+(e.message||e);return}
  var existing=await dbAll();
  for(var i=0;i<files.length;i++){
    var f=files[i];
    if(status)status.innerHTML='Reading '+(i+1)+' / '+files.length+': <b>'+esc(f.name)+'</b><div class="cdf-progress"><i style="width:'+Math.round((i/files.length)*100)+'%"></i></div>';
    try{
      var p=await parseFile(f,type),dk=type+'|'+(p.period||'')+'|'+p.fingerprint,dup=existing.find(function(r){return duplicateKey(r)===dk&&r.cloudConfirmedAt});
      if(dup){dupes++;if(status)status.textContent='Duplicate skipped: '+f.name+' — '+(p.period?periodLabel(p.period):'month unresolved');continue}
      var now=new Date().toISOString(),rec={id:uid(type),type:type,name:f.name,size:f.size,lastModified:f.lastModified||0,uploadedAt:now,updatedAt:now,period:p.period,periodSource:p.periodSource,detail:p.detail,digitIds:p.digits,alnumIds:p.alnums,fingerprint:p.fingerprint,parseVersion:'2',archived:false,buffer:p.buffer};
      if(status)status.textContent='Saving to backend: '+f.name+'…';
      var back=await api.saveComplianceDolConfirmed(rec);rec.cloudConfirmedAt=back.cloudConfirmedAt||new Date().toISOString();await dbPut(rec);existing.push(rec);ok++;notifyChange()
    }catch(e){failed++;console.error(e);var em=String(e&&e.message||e),kind=/parse|not found|unreadable|pdf engine|unsupported file/i.test(em)?'Parse Failed':/backend|cloud|read-back|login|save/i.test(em)?'Save Failed':'Upload Failed';errors.push(kind+' — '+f.name+': '+em);if(status)status.textContent=errors[errors.length-1]}
    await sleep(0)
  }
  await refresh(type);
  if(status){
    if(failed)status.textContent=(ok?ok+' Saved ✓ · ':'')+errors.slice(0,3).join(' | ')+(errors.length>3?' | +'+(errors.length-3)+' more':'')+(dupes?' · '+dupes+' duplicate skipped':'');
    else status.textContent='Saved ✓ — '+ok+' challan(s) backend confirmed'+(dupes?' · '+dupes+' duplicate skipped':'')+'.'+(cache[type].some(function(r){return!r.period&&r.cloudConfirmedAt})?' Yellow files ka month set karo.':'')
  }
}

function containsId(rec,type,id){
  if(type==='esic')return (rec.digitIds||[]).indexOf(id)>=0;
  if(/^\d{12}$/.test(id))return (rec.digitIds||[]).indexOf(id)>=0||(rec.alnumIds||[]).indexOf(id)>=0;
  return (rec.alnumIds||[]).indexOf(id)>=0;
}
function parseInputs(type){
  var ids=pageIds(type),raw=searchMode[type]==='single'?(q(ids.input).value||''):(q(ids.multi).value||''),parts=searchMode[type]==='single'?[raw]:raw.split(/[\n,;]+/),out=[],seen={};
  parts.forEach(function(x){var id=normalizeQuery(type,x);if(id&&!seen[id]){seen[id]=1;out.push(id)}});return out;
}
async function search(type){
  var queries=parseInputs(type),status=q(type+'DolStatus');if(!queries.length){status.textContent='Valid '+idLabel(type)+' enter karo.';return}
  status.textContent='Loading all backend-confirmed challans…';
  try{await pullCloud(type);var mig=await migratePending(type);if(mig.migrated)await pullCloud(type);await refresh(type)}catch(e){status.textContent='Search Failed — backend challans load nahi hue: '+(e.message||e);return}
  var files=cache[type].filter(function(r){return!r.archived&&!!r.cloudConfirmedAt}),unique={},confirmed=[];
  files.forEach(function(r){var k=duplicateKey(r)||r.id;if(!unique[k]){unique[k]=1;confirmed.push(r)}});
  files=confirmed;
  var knownPeriods=Array.from(new Set(files.map(function(r){return r.period}).filter(Boolean))).sort(),results=[];
  queries.forEach(function(id){
    var matches=files.filter(function(r){return containsId(r,type,id)}),unresolved=matches.filter(function(r){return!r.period}),known=matches.filter(function(r){return!!r.period}).sort(function(a,b){return cmpPeriod(a.period,b.period)});
    var last=known.length?known[known.length-1].period:'',later=last?knownPeriods.filter(function(p){return p>last}).length:0,months=Array.from(new Set(known.map(function(r){return r.period}))).sort();
    results.push({id:id,matches:matches,unresolved:unresolved,known:known,last:last,laterChecked:later,months:months});
  });
  lastResults[type]=results;renderResults(type);q(type+'DolExport').disabled=false;status.textContent='✅ '+queries.length+' ID(s) ko '+files.length+' backend-confirmed challan files me complete scan kiya gaya.';
}

function renderResults(type){
  var box=q(type+'DolResults'),res=lastResults[type]||[];if(!res.length){box.innerHTML='<div class="cdf-empty"><div>🔎</div><b>No search yet</b></div>';return}
  var h='<table class="cdf-table"><thead><tr><th>'+idLabel(type)+'</th><th>LAST CONTRIBUTION MONTH</th><th>MATCHED MONTHS</th><th>AFTER LAST</th><th>SOURCES / STATUS</th></tr></thead><tbody>';
  res.forEach(function(r){
    var lastCell,status,src=r.matches.map(function(x){return (x.period?periodLabel(x.period):'MONTH REQUIRED')+' — '+x.name}).join('<br>');
    if(!r.matches.length){lastCell='<span class="cdf-bad">Not found</span>';status='<span class="cdf-bad">No exact match in uploaded challans</span>'}
    else if(r.unresolved.length){lastCell='<span class="cdf-warn">Blocked: set month</span>';status='<span class="cdf-warn">'+r.unresolved.length+' matched file(s) have unresolved month. No DOL guess made.</span>'}
    else{lastCell='<span class="cdf-last">'+periodLabel(r.last)+'</span><div class="cdf-good">Suggested DOL month / last contribution</div>';status='<span class="cdf-good">All matched periods resolved</span>'}
    h+='<tr><td><b>'+esc(r.id)+'</b></td><td>'+lastCell+'</td><td><div class="cdf-timeline">'+(r.months.length?r.months.map(function(p){return'<span class="cdf-month">'+periodLabel(p)+'</span>'}).join(''):'—')+'</div></td><td>'+(r.last?'<b>'+r.laterChecked+'</b> later uploaded period(s) checked with no match':'—')+'</td><td><div class="cdf-sources">'+src+'</div><div style="margin-top:4px">'+status+'</div></td></tr>';
  });h+='</tbody></table>';box.innerHTML=h;
}
function setMode(type,mode){
  searchMode[type]=mode;document.querySelectorAll('[data-cdf-mode^="'+type+'-"]').forEach(function(b){b.classList.toggle('active',b.getAttribute('data-cdf-mode')===type+'-'+mode)});q(type+'DolPaneSingle').classList.toggle('active',mode==='single');q(type+'DolPaneMultiple').classList.toggle('active',mode==='multiple');
}
async function setPeriod(type,id,p){
  var r=cache[type].find(function(x){return x.id===id});if(!r)return;var oldPeriod=r.period,oldSource=r.periodSource,oldUpdated=r.updatedAt;
  var api=cloudApi(),status=q(type+'DolStatus');r.period=p||'';r.periodSource=p?'manual':'manual-required';r.updatedAt=new Date().toISOString();
  try{if(!api)throw new Error('shared backend unavailable');var back=await api.saveComplianceDolConfirmed(r);r.cloudConfirmedAt=back.cloudConfirmedAt||new Date().toISOString();await dbPut(r);if(status)status.textContent='Saved ✓ — challan month backend confirmed.';await refresh(type);notifyChange()}
  catch(e){r.period=oldPeriod;r.periodSource=oldSource;r.updatedAt=oldUpdated;if(status)status.textContent='Save Failed — month update not stored: '+(e.message||e);await refresh(type)}
}
async function archive(type,id){
  var r=cache[type].find(function(x){return x.id===id});if(!r)return;var oldArchived=r.archived,oldAt=r.archivedAt,oldUpdated=r.updatedAt,api=cloudApi(),status=q(type+'DolStatus');
  r.archived=!r.archived;r.archivedAt=r.archived?new Date().toISOString():'';r.updatedAt=new Date().toISOString();
  try{if(!api)throw new Error('shared backend unavailable');var back=await api.saveComplianceDolConfirmed(r);r.cloudConfirmedAt=back.cloudConfirmedAt||new Date().toISOString();await dbPut(r);if(status)status.textContent='Saved ✓ — challan status backend confirmed.';await refresh(type);notifyChange()}
  catch(e){r.archived=oldArchived;r.archivedAt=oldAt;r.updatedAt=oldUpdated;if(status)status.textContent='Save Failed — challan status not stored: '+(e.message||e);await refresh(type)}
}

function exportResults(type){
  var res=lastResults[type]||[];if(!res.length)return;
  var data=[['COMPLIANCE DOL FINDER — '+typeLabel(type)],['Generated',new Date().toLocaleString()],[],[idLabel(type),'Last Contribution Month','Matched Months','Later Uploaded Periods Checked','Matched Files','Status']];
  res.forEach(function(r){data.push([r.id,r.unresolved.length?'PERIOD REQUIRED':r.last||'NOT FOUND',r.months.map(periodLabel).join(' | '),r.last?r.laterChecked:'',r.matches.map(function(x){return (x.period||'MONTH REQUIRED')+' - '+x.name}).join(' | '),!r.matches.length?'NOT FOUND':r.unresolved.length?'BLOCKED - SET MONTH':'OK'])});
  var out=XLSX.utils.book_new();XLSX.utils.book_append_sheet(out,XLSX.utils.aoa_to_sheet(data),'RESULT');XLSX.writeFile(out,(type==='esic'?'ESIC':'PF')+'_to_DOL_Result.xlsx');
}
function wire(type){
  q(type+'DolUpload').addEventListener('change',function(){uploadFiles(type,this.files);this.value=''});
  document.querySelectorAll('[data-cdf-mode^="'+type+'-"]').forEach(function(b){b.addEventListener('click',function(){setMode(type,this.getAttribute('data-cdf-mode').split('-')[1])})});
  document.querySelectorAll('[data-cdf-search="'+type+'"]').forEach(function(b){b.addEventListener('click',function(){search(type)})});
  q(type+'DolExport').addEventListener('click',function(){exportResults(type)});
  q(type+'DolFiles').addEventListener('change',function(e){var id=e.target.getAttribute('data-cdf-period');if(id)setPeriod(type,id,e.target.value)});
  q(type+'DolFiles').addEventListener('click',function(e){var b=e.target.closest&&e.target.closest('[data-cdf-archive]');if(b)archive(type,b.getAttribute('data-cdf-archive'))});
}
function patchGo(){
  if(typeof g.goPage!=='function'||g.goPage.__cdfWrapped)return;var old=g.goPage;function w(name){var r=old.apply(this,arguments);if(name==='esictodol'||name==='pftodol'){var sub=q('cat-tools');if(sub)sub.classList.remove('collapsed');var arr=q('arr-tools');if(arr)arr.style.transform='rotate(0deg)'}return r}w.__cdfWrapped=true;w.__original=old;g.goPage=w;
}
g.ATPLComplianceDolV1={version:'2026.09.18-5',parsePeriod:parsePeriodCore,normalizeQuery:normalizeQuery,containsId:containsId,periodLabel:periodLabel,parseFile:parseFile,fingerprintFor:fingerprintFor,pullCloud:pullCloud};
async function boot(){
  addCss();['esic','pf'].forEach(function(t){ensureNav(t);makePage(t);wire(t)});patchGo();
  await Promise.all([refresh('esic'),refresh('pf')]);
  setTimeout(async function(){
    for(var i=0;i<2;i++){var t=i?'pf':'esic';try{await pullCloud(t);var m=await migratePending(t);if(m.migrated)await pullCloud(t);await refresh(t)}catch(e){console.warn('Challan cloud boot sync skipped',t,e)}}
  },1800);
  document.addEventListener('atpl-compliance-dol-synced',function(){refresh('esic');refresh('pf')});
  setTimeout(function(){ensureNav('esic');ensureNav('pf');patchGo()},800);
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})(window);