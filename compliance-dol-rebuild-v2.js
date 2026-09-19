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
var BUILD='2026.09.19-cloud-only-final17-fast10';
if(!root)return;
if(root.__ATPL_COMPLIANCE_DOL_REBUILD_V2__===BUILD)return;
root.__ATPL_COMPLIANCE_DOL_REBUILD_V2__=BUILD;

var DB_NAME='ATPL_COMPLIANCE_DOL_V2', DB_VER=1, STORE='challans';
var state={esic:{rows:[],index:{},periods:[]},pf:{rows:[],index:{},periods:[]}};
var excelWorker=null,excelSeq=0,excelPending={};
var cloudSyncPromises={esic:null,pf:null},cloudLastSync={esic:0,pf:0},cloudRetryTimer=0,cloudWriteTail=Promise.resolve(),CLOUD_BATCH_SIZE=16;
function bounded(p,ms,label){
  return new Promise(function(resolve,reject){
    var done=false,t=setTimeout(function(){if(done)return;done=true;reject(new Error((label||'Cloud sync')+' timeout'))},ms);
    Promise.resolve(p).then(function(v){if(done)return;done=true;clearTimeout(t);resolve(v)},function(e){if(done)return;done=true;clearTimeout(t);reject(e)})
  })
}
async function localPreview(type){
  try{
    var rows=(await dbAll()).filter(function(r){return r&&r.type===type&&!r.archived});
    var seen={};rows=rows.filter(function(r){var k=r.hash?'h:'+r.hash:'id:'+r.id;if(seen[k])return false;seen[k]=1;return true});
    if(rows.length){
      state[type].rows=rows.sort(function(a,b){return String(b.period||'').localeCompare(String(a.period||''))||String(b.uploadedAt||'').localeCompare(String(a.uploadedAt||''))});
      rebuildIndex(type);renderFiles(type);setStatus(type,'Cached challans ready ✓ · cloud refresh running…');
      return true
    }
  }catch(e){console.warn('DOL local preview failed',type,e)}
  return false
}
var viewer={url:'',type:'',id:'',sheet:0,page:1,pageSize:100,sheets:null};
var storageState={opfs:false,persisted:false,checked:false,rootName:'ATPL-Compliance-DOL-V2'};
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
function validId(type,v){var d=normalizeDigits(v);if(type==='esic')return d&&d.length===10?d:'';if(d&&d.length===12)return d;return normalizeAlpha(v)}
function fileMime(name){var e=String(name||'').split('.').pop().toLowerCase();if(e==='pdf')return'application/pdf';if(e==='csv')return'text/csv';return'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}
function uid(type,hash){return'v2_'+type+'_'+String(hash||'').slice(0,24)}
function recordIds(r){return Array.from(new Set([].concat(Array.isArray(r&&r.ids)?r.ids:[],Array.isArray(r&&r.digitIds)?r.digitIds:[],Array.isArray(r&&r.alnumIds)?r.alnumIds:[]).map(String).filter(Boolean)))}
function pfEvidence(ids,text){
  ids=Array.isArray(ids)?ids.map(String):[];text=String(text||'').toUpperCase();
  var twelve=ids.filter(function(x){return /^\d{12}$/.test(normalizeDigits(x))}).length;
  var establishment=ids.some(function(x){return /^[A-Z]{2,6}\d{7,}[A-Z0-9]*$/.test(normalizeAlpha(x))});
  var strongText=/\b(?:ECR|ECR\s+STATEMENT|ECR\s+CHALLAN|EPF|EPFO|PF\s+CHALLAN|PROVIDENT\s+FUND|UAN|TRRN|GROSS\s+EPF\s+WAGES|MEMBER\s+ID)\b/.test(text);
  return establishment||twelve>=3||strongText||/[A-Z]{2,6}[\s\/_-]*[A-Z]{2,5}[\s\/_-]*\d{7}/.test(text)
}
function detectedDocumentType(name,ids,text){
  var sample=String(name||'')+' '+String(text||'');if(pfEvidence(ids,sample))return'pf';
  return /\b(?:ESIC|E\.?S\.?I\.?C|EMPLOYEES?\s+STATE\s+INSURANCE|INSURANCE\s+(?:NO|NUMBER)|IP\s+(?:NO|NUMBER))\b/i.test(sample)?'esic':''
}
function looksLikePfRecord(r){return !!(r&&r.type==='esic'&&pfEvidence(recordIds(r),r.name||''))}
function logicalName(name){return String(name||'').toLowerCase().replace(/\.[^.]+$/,'').replace(/\(\s*\d+\s*\)$/,'').replace(/[^a-z0-9]+/g,'')}

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


async function requestPersistentStorage(){
  if(storageState.checked)return storageState;
  storageState.checked=true;
  try{
    storageState.opfs=!!(root.navigator&&root.navigator.storage&&root.navigator.storage.getDirectory);
    if(root.navigator&&root.navigator.storage){
      if(typeof root.navigator.storage.persisted==='function')storageState.persisted=await root.navigator.storage.persisted();
      if(!storageState.persisted&&typeof root.navigator.storage.persist==='function')storageState.persisted=await root.navigator.storage.persist();
    }
  }catch(e){console.warn('Persistent storage request failed',e)}
  return storageState
}
function fsSafeName(name){
  return String(name||'challan').replace(/[\\/:*?"<>|]/g,'_').replace(/\s+/g,' ').trim().slice(0,120)||'challan'
}
async function opfsRoot(){
  await requestPersistentStorage();
  if(!storageState.opfs)return null;
  try{
    var rootDir=await root.navigator.storage.getDirectory();
    return await rootDir.getDirectoryHandle(storageState.rootName,{create:true})
  }catch(e){console.warn('OPFS unavailable',e);storageState.opfs=false;return null}
}
async function opfsDirFor(rec,create){
  var base=await opfsRoot();if(!base)return null;
  var t=await base.getDirectoryHandle(String(rec.type||'misc'),{create:create!==false});
  var y=rec.period?String(rec.period).slice(0,4):'Unknown';
  return await t.getDirectoryHandle(y,{create:create!==false})
}
async function opfsSave(rec,blob){
  if(!(blob instanceof Blob))return false;
  var dir=await opfsDirFor(rec,true);if(!dir)return false;
  var fname=String(rec.hash||rec.id||Date.now()).slice(0,24)+'__'+fsSafeName(rec.name),fh=await dir.getFileHandle(fname,{create:true}),w=await fh.createWritable();
  await w.write(blob);await w.close();rec.opfsPath=[String(rec.type||'misc'),rec.period?String(rec.period).slice(0,4):'Unknown',fname];rec.storage='opfs';return true
}
async function opfsRead(rec){
  if(!rec||!Array.isArray(rec.opfsPath)||rec.opfsPath.length!==3)return null;
  try{
    var base=await opfsRoot();if(!base)return null;
    var t=await base.getDirectoryHandle(rec.opfsPath[0],{create:false}),y=await t.getDirectoryHandle(rec.opfsPath[1],{create:false}),fh=await y.getFileHandle(rec.opfsPath[2],{create:false});
    return await fh.getFile()
  }catch(_){return null}
}
async function opfsDelete(rec){
  if(!rec||!Array.isArray(rec.opfsPath)||rec.opfsPath.length!==3)return false;
  try{
    var base=await opfsRoot();if(!base)return false;
    var t=await base.getDirectoryHandle(rec.opfsPath[0],{create:false}),y=await t.getDirectoryHandle(rec.opfsPath[1],{create:false});
    await y.removeEntry(rec.opfsPath[2]);return true
  }catch(_){return false}
}
function manifestRow(r){
  return{id:r.id,version:r.version||2,type:r.type,name:r.name,size:r.size||0,lastModified:r.lastModified||0,hash:r.hash||'',period:r.period||'',periodSource:r.periodSource||'',ids:r.ids||[],parseStatus:r.parseStatus||'',parseError:r.parseError||'',uploadedAt:r.uploadedAt||'',updatedAt:r.updatedAt||'',opfsPath:r.opfsPath||null,storage:r.storage||'',migrated:!!r.migrated}
}
async function writeVaultManifest(){
  var base=await opfsRoot();if(!base)return false;
  try{
    var rows=(await dbAll()).map(manifestRow),fh=await base.getFileHandle('manifest.json',{create:true}),w=await fh.createWritable();
    await w.write(JSON.stringify({version:2,updatedAt:new Date().toISOString(),rows:rows}));await w.close();return true
  }catch(e){console.warn('Vault manifest write failed',e);return false}
}
async function readVaultManifest(){
  var base=await opfsRoot();if(!base)return[];
  try{
    var fh=await base.getFileHandle('manifest.json',{create:false}),file=await fh.getFile(),j=JSON.parse(await file.text());
    return Array.isArray(j&&j.rows)?j.rows:[]
  }catch(_){return[]}
}
async function restoreVaultRecords(){
  var rows=await readVaultManifest();if(!rows.length)return 0;
  var current=await dbAll(),have={};current.forEach(function(r){have[String(r.id)]=1});var restored=0;
  for(var i=0;i<rows.length;i++){
    var r=rows[i];if(!r||!r.id||have[String(r.id)])continue;
    var file=await opfsRead(r);if(!file)continue;
    await dbPut(Object.assign({},r,{blob:null,viewerSheets:null,storage:'opfs'}));restored++;if(restored%10===0)await tick()
  }
  return restored
}
async function migrateDbFilesToVault(){
  var all=await dbAll(),changed=0;
  for(var i=0;i<all.length;i++){
    var r=all[i];if(!r||r.storage==='opfs'&&r.opfsPath)continue;
    var blob=r.blob instanceof Blob?r.blob:null;
    if(!blob&&r.buffer)blob=new Blob([r.buffer],{type:fileMime(r.name)});
    if(!blob)continue;
    try{
      if(await opfsSave(r,blob)){r.blob=null;r.buffer=null;r.viewerSheets=null;await dbPut(r);changed++}
    }catch(e){console.warn('Vault migration skipped',r&&r.name,e)}
    if(i%5===0)await tick()
  }
  if(changed)await writeVaultManifest();
  return changed
}
async function getStoredBlob(rec){
  if(rec&&rec.blob instanceof Blob)return rec.blob;
  var f=await opfsRead(rec);if(f)return f;
  if(rec&&rec.buffer)return new Blob([rec.buffer],{type:fileMime(rec.name)});
  return null
}
async function moveVaultFileForPeriod(rec,newPeriod){
  var blob=await getStoredBlob(rec),old=rec.opfsPath?rec.opfsPath.slice():null;if(!blob)return false;
  rec.period=newPeriod||'';if(await opfsSave(rec,blob)){if(old){try{await opfsDelete({opfsPath:old})}catch(_){}}return true}
  return false
}
function storageLabel(){
  if(storageState.opfs&&storageState.persisted)return'☁ Shared backend master';
  if(storageState.opfs)return'☁ Shared backend master · local viewer cache';
  return'☁ Shared backend master · local viewer cache';
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
    if(d.length===10)set.add(d);
    var dm=s.match(/\d(?:[\d\s/_.-]{6,24}\d)/g)||[];
    dm.forEach(function(x){var y=normalizeDigits(x);if(y.length===10)set.add(y)})
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
      "function add(type,v,set){var s=String(v==null?'':v).trim();if(!s)return;if(type==='esic'){(s.match(/\\b\\d{10}\\b/g)||[]).forEach(function(x){var z=digs(x);if(z&&z.length===10)set[z]=1})}else{s.split(/[\\s,;|]+/).forEach(function(x){var d=digs(x),a=alp(x),z=d&&d.length===12?d:a;if(z)set[z]=1});(s.match(/\\b\\d{12}\\b/g)||[]).forEach(function(x){set[x]=1})}}",
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
async function parsePdf(buf,type,progress){
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
  return{ids:x.ids||[],period:per.period,periodSource:per.source,sheets:x.sheets||null,detectedType:detectedDocumentType(name,x.ids||[],x.sample||'')}
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
  return '<div class="cd2-shell" data-type="'+type+'" data-cd2-ui="cloud-only-final17-fast10">'+
    '<div class="cd2-head"><div><div class="cd2-kicker">COMPLIANCE DOL · CLOUD MASTER V3</div><div class="cd2-title">'+icon+' '+title+'</div><div class="cd2-sub">Library <b>shared backend se live load hoti hai</b>; local browser data list decide nahi karta. <b>Latest matched contribution month = DOL month.</b></div></div>'+
    '<div><button type="button" class="cd2-upload" data-cd2-pick="'+type+'">＋ Upload Challans</button><input id="cd2-'+type+'-upload" type="file" accept=".pdf,.xlsx,.xls,.csv" multiple style="display:none"></div></div>'+
    '<div class="cd2-strip"><span id="cd2-'+type+'-storage">'+esc(storageLabel())+'</span><span>🔎 Challan Search</span><span>📁 Year Folders</span><span>⬇ Download</span><span>📅 Missing Month Tracker</span><span>🗑 Delete only by you</span></div>'+
    '<div id="cd2-'+type+'-status" class="cd2-status">Ready.</div>'+
    '<div class="cd2-grid">'+
      '<section class="cd2-card"><div class="cd2-cardhead"><div><b>Saved Challan Library</b><small id="cd2-'+type+'-coverage">0 files</small></div><button data-cd2-refresh="'+type+'">↻ Refresh</button></div>'+
        '<div class="cd2-libtools"><input id="cd2-'+type+'-libsearch" placeholder="Search challan name / month / year..."><select id="cd2-'+type+'-yearfilter"><option value="">All years</option></select></div>'+
        '<div id="cd2-'+type+'-missing" class="cd2-missing"></div>'+
        '<div id="cd2-'+type+'-files" class="cd2-files"></div></section>'+
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
  var blob=await getStoredBlob(rec);if(!blob){$('cd2-vbody').innerHTML='<div class="cd2-empty cd2-bad">Original file missing from local vault.</div>';return}
  var ext=String(rec.name||'').split('.').pop().toLowerCase();
  if(ext==='pdf'){viewer.url=URL.createObjectURL(blob);$('cd2-vbody').innerHTML='<iframe title="PDF challan viewer" src="'+esc(viewer.url)+'#toolbar=1&navpanes=0"></iframe>';return}
  try{
    var buf=await blob.arrayBuffer(),parsed=rec.viewerSheets&&rec.viewerSheets.length?{sheets:rec.viewerSheets}:await parseExcel(buf,type,function(p){$('cd2-vbody').innerHTML='<div class="cd2-empty">Preparing Excel viewer… '+p+'%</div>'});
    viewer.sheets=parsed.sheets||[];viewer.sheet=0;viewer.page=1;if(!viewer.sheets.length)throw new Error('No sheets found');
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
  var api=durableApi(),hadLocal=(state[type].rows||[]).length>0;
  if(!hadLocal)hadLocal=await localPreview(type);
  if(!cloudLoginReady()||!api||typeof api.getComplianceDolRecords!=='function'){
    setStatus(type,hadLocal?'Cached challans shown · cloud login required for latest sync.':'Cloud login required for challan library.',!hadLocal);return false
  }
  try{
    var remote=await bounded(api.getComplianceDolRecords(type),8500,'Challan cloud sync'),local=await dbAll(),byId={},byHash={};
    local.filter(function(r){return r&&r.type===type}).forEach(function(r){byId[String(r.id)]=r;if(r.hash)byHash[String(r.hash)]=r});
    var rows=(remote||[]).map(function(x){
      var r=localRecordFromCloud(x),old=byId[String(r.id)]||(r.hash&&byHash[String(r.hash)])||null;
      if(old){r.blob=old.blob||null;r.viewerSheets=old.viewerSheets||null;r.opfsPath=old.opfsPath||null;r.storage=old.storage||'cloud-index';r.cloudOnly=!(r.blob||r.opfsPath)}
      return r
    });
    var seen={};rows=rows.filter(function(r){var k=r.hash?'h:'+r.hash:'id:'+r.id;if(seen[k])return false;seen[k]=1;return true});
    state[type].rows=rows.sort(function(a,b){return String(b.period||'').localeCompare(String(a.period||''))||String(b.uploadedAt||'').localeCompare(String(a.uploadedAt||''))});
    rebuildIndex(type);renderFiles(type);setStatus(type,'Shared backend loaded ✓ · '+rows.length+' challan'+(rows.length===1?'':'s')+'.');return true
  }catch(e){
    if(!(state[type].rows||[]).length)await localPreview(type);
    renderFiles(type);setStatus(type,(state[type].rows||[]).length?'Cached challans shown · cloud refresh timed out. Retry available.':'Cloud library load failed: '+(e.message||e),true);return false
  }
}
function addLibraryCss(){
  if($('cd2-library-style'))return;
  var s=document.createElement('style');s.id='cd2-library-style';s.textContent=
  '.cd2-libtools{display:grid;grid-template-columns:minmax(0,1fr) 130px;gap:7px;margin-bottom:8px}.cd2-libtools input,.cd2-libtools select{border:1px solid #cbd5e1;border-radius:8px;padding:8px 9px;font-size:9px;background:#fff;color:#0f172a}.cd2-missing{margin-bottom:9px}.cd2-missbox{border:1px solid #e2e8f0;border-radius:10px;background:#f8fafc;padding:9px}.cd2-misshead{display:flex;justify-content:space-between;gap:8px;align-items:center;margin-bottom:7px}.cd2-misshead b{font-size:10px;color:#0f172a}.cd2-misshead span{font-size:8px;color:#64748b}.cd2-monthgrid{display:flex;flex-wrap:wrap;gap:4px}.cd2-monthchip{padding:4px 6px;border-radius:999px;font-size:8px;font-weight:800;border:1px solid #e2e8f0;background:#fff;color:#475569}.cd2-monthchip.ok{background:#ecfdf5;border-color:#bbf7d0;color:#166534}.cd2-monthchip.miss{background:#fff7ed;border-color:#fed7aa;color:#c2410c}.cd2-yearfolder{border:1px solid #e2e8f0;border-radius:11px;background:#fff;overflow:hidden}.cd2-yearfolder+ .cd2-yearfolder{margin-top:7px}.cd2-yearfolder summary{cursor:pointer;list-style:none;padding:9px 10px;background:#f8fafc;display:flex;align-items:center;justify-content:space-between;font-size:10px;font-weight:900;color:#1e293b}.cd2-yearfolder summary::-webkit-details-marker{display:none}.cd2-foldercount{font-size:8px;color:#64748b;font-weight:750}.cd2-yearbody{display:flex;flex-direction:column;gap:6px;padding:7px}.cd2-file{grid-template-columns:minmax(0,1fr) 112px auto auto auto!important}.cd2-dl{color:#1d4ed8;border-color:#bfdbfe;background:#eff6ff}@media(max-width:1100px){.cd2-file{grid-template-columns:minmax(0,1fr) 105px auto auto!important}.cd2-file .cd2-dl{grid-column:auto}.cd2-libtools{grid-template-columns:1fr}}';
  document.head.appendChild(s)
}
function libraryYearRows(type){
  var rows=state[type].rows||[],map={};
  rows.forEach(function(r){var y=r.period?String(r.period).slice(0,4):'Unknown';(map[y]||(map[y]=[])).push(r)});
  return map
}
function syncYearFilter(type){
  var sel=$('cd2-'+type+'-yearfilter');if(!sel)return;
  var current=sel.value,years=Object.keys(libraryYearRows(type)).filter(function(y){return y!=='Unknown'}).sort().reverse();
  sel.innerHTML='<option value="">All years</option>'+years.map(function(y){return'<option value="'+y+'">'+y+'</option>'}).join('')+(libraryYearRows(type).Unknown?'<option value="Unknown">Month not set</option>':'');
  if(Array.from(sel.options).some(function(o){return o.value===current}))sel.value=current
}
function renderMissingMonths(type){
  var box=$('cd2-'+type+'-missing');if(!box)return;
  var rows=state[type].rows||[],sel=$('cd2-'+type+'-yearfilter'),chosen=sel&&sel.value&&sel.value!=='Unknown'?sel.value:'';
  var years=Array.from(new Set(rows.map(function(r){return r.period?String(r.period).slice(0,4):''}).filter(Boolean))).sort().reverse();
  var year=chosen||(years[0]||String(new Date().getFullYear()));
  var now=new Date(),currentYear=String(now.getFullYear()),limit=year===currentYear?(now.getMonth()+1):12;
  var uploaded=new Set(rows.filter(function(r){return r.period&&String(r.period).slice(0,4)===year}).map(function(r){return Number(String(r.period).slice(5,7))}));
  var names=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],chips=[],missing=[];
  for(var m=1;m<=limit;m++){var ok=uploaded.has(m);if(!ok)missing.push(names[m-1]);chips.push('<span class="cd2-monthchip '+(ok?'ok':'miss')+'">'+names[m-1]+' '+(ok?'✓':'Missing')+'</span>')}
  box.innerHTML='<div class="cd2-missbox"><div class="cd2-misshead"><b>📅 '+esc(year)+' Challan Coverage</b><span>'+(missing.length?missing.length+' missing month'+(missing.length===1?'':'s'):'All expected months uploaded ✓')+'</span></div><div class="cd2-monthgrid">'+chips.join('')+'</div></div>'
}
async function downloadChallan(type,id){
  var rec=await dbGet(id);if(!rec){setStatus(type,'Download failed — saved file not found',true);return}
  try{
    var blob=await getStoredBlob(rec);if(!blob)throw new Error('Original file missing from local vault');
    var url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=rec.name||('challan_'+id);document.body.appendChild(a);a.click();a.remove();
    setTimeout(function(){try{URL.revokeObjectURL(url)}catch(_){}},1500);setStatus(type,'Downloaded ✓ — '+(rec.name||'challan'))
  }catch(e){setStatus(type,'Download failed — '+(e.message||e),true)}
}

function renderFiles(type){
  var rows=state[type].rows||[],box=$('cd2-'+type+'-files'),cov=$('cd2-'+type+'-coverage');if(!box)return;
  syncYearFilter(type);
  var search=$('cd2-'+type+'-libsearch'),yearSel=$('cd2-'+type+'-yearfilter'),qv=String(search&&search.value||'').toLowerCase().trim(),yf=String(yearSel&&yearSel.value||'');
  var periods=state[type].periods||[],bad=rows.filter(function(r){return r.parseStatus==='error'||!(r.ids||[]).length}).length;
  cov.textContent=rows.length+' saved file'+(rows.length===1?'':'s')+(periods.length?' · '+periodLabel(periods[0])+' → '+periodLabel(periods[periods.length-1]):'')+(bad?' · '+bad+' need indexing':'');
  renderMissingMonths(type);
  var filtered=rows.filter(function(r){
    var y=r.period?String(r.period).slice(0,4):'Unknown';
    if(yf&&y!==yf)return false;
    if(!qv)return true;
    var hay=[r.name,r.period,periodLabel(r.period||''),y].join(' ').toLowerCase();
    return hay.indexOf(qv)>=0
  });
  if(!filtered.length){box.innerHTML='<div class="cd2-empty">'+(rows.length?'No challan matches this search/filter.':'No V2 challans yet. Upload all ESIC/PF challans here.')+'</div>';return}
  var groups={};
  filtered.forEach(function(r){var y=r.period?String(r.period).slice(0,4):'Unknown';(groups[y]||(groups[y]=[])).push(r)});
  var years=Object.keys(groups).sort(function(a,b){if(a==='Unknown')return 1;if(b==='Unknown')return-1;return b.localeCompare(a)});
  box.innerHTML=years.map(function(y){
    var items=groups[y].sort(function(a,b){return String(b.period||'').localeCompare(String(a.period||''))||String(b.uploadedAt||'').localeCompare(String(a.uploadedAt||''))});
    var body=items.map(function(r){
      var indexed=(r.ids||[]).length>0&&r.parseStatus!=='error',meta=indexed?((r.ids||[]).length+' indexed IDs'):'⚠ Needs indexing';
      if(r.parseStatus==='processing')meta='⏳ Indexing…';
      return'<div class="cd2-file '+(!r.period||!indexed?'warn':'')+'"><div><div class="cd2-fn">'+esc(r.name)+'</div><div class="cd2-fm">'+(r.period?periodLabel(r.period)+' · ':'')+Math.round((r.size||0)/1024)+' KB · '+meta+' · SHA '+esc(String(r.hash||'').slice(0,10))+(r.parseError?' · '+esc(r.parseError):'')+'</div></div><input type="month" data-cd2-period="'+esc(r.id)+'" value="'+esc(r.period||'')+'"><button class="cd2-btn" data-cd2-view="'+esc(r.id)+'">👁 Open</button><button class="cd2-btn cd2-dl" data-cd2-download="'+esc(r.id)+'">⬇ Download</button><button class="cd2-btn cd2-del" data-cd2-delete="'+esc(r.id)+'">🗑 Delete</button></div>'
    }).join('');
    return'<details class="cd2-yearfolder" open><summary><span>📁 '+esc(y==='Unknown'?'Month Not Set':y)+'</span><span class="cd2-foldercount">'+items.length+' challan'+(items.length===1?'':'s')+'</span></summary><div class="cd2-yearbody">'+body+'</div></details>'
  }).join('')
}
async function updatePeriod(type,id,period){
  var r=(state[type].rows||[]).find(function(x){return String(x.id)===String(id)})||await dbGet(id);if(!r)return;
  try{
    r=Object.assign({},r,{period:period||'',periodSource:'manual',updatedAt:new Date().toISOString()});
    var api=durableApi();if(!api||typeof api.saveComplianceDolConfirmed!=='function')throw new Error('Cloud backend unavailable');
    await api.saveComplianceDolConfirmed(cloudRecordFromLocal(r));
    var local=await dbGet(id);if(local){local.period=r.period;local.periodSource='manual';local.updatedAt=r.updatedAt;local.cloudSynced=true;await dbPut(local)}
    await refresh(type);setStatus(type,'Month saved in shared backend ✓ — '+(r.period?periodLabel(r.period):'month cleared'))
  }catch(e){setStatus(type,'Month update failed — '+(e.message||e),true)}
}
async function deleteOne(type,id){
  var r=(state[type].rows||[]).find(function(x){return String(x.id)===String(id)})||await dbGet(id);if(!r)return;
  if(!confirm('Permanently delete this challan and every duplicate copy from shared backend?\n\n'+(r.name||id)+(r.period?'\n'+periodLabel(r.period):'')))return;
  setStatus(type,'Deleting permanently…');
  try{
    var api=durableApi();if(!api||typeof api.deleteComplianceDolConfirmed!=='function')throw new Error('Cloud backend unavailable');
    var target=cloudRecordFromLocal(r);target.hash=r.hash||target.fileHash||'';target.cloudRecordId=r.cloudRecordId||'';
    await api.deleteComplianceDolConfirmed(target);

    var all=await dbAll(),sameName=logicalName(r.name),samePeriod=String(r.period||''),purged=0;
    for(var i=0;i<all.length;i++){
      var x=all[i];if(!x||x.type!==type)continue;
      var same=String(x.id)===String(r.id)||
        (r.hash&&x.hash&&String(x.hash)===String(r.hash))||
        (r.cloudRecordId&&String(x.cloudRecordId||'')===String(r.cloudRecordId))||
        (!r.hash&&sameName&&logicalName(x.name)===sameName&&(!samePeriod||String(x.period||'')===samePeriod));
      if(!same)continue;
      try{await opfsDelete(x)}catch(_){}
      await dbDelete(x.id);purged++
    }
    await writeVaultManifest();
    try{if(root.ATPLCloudAPI&&typeof root.ATPLCloudAPI.clearCache==='function')root.ATPLCloudAPI.clearCache()}catch(_){}
    await refresh(type);

    var still=(state[type].rows||[]).some(function(x){
      return String(x.id)===String(r.id)||
        (r.hash&&x.hash&&String(x.hash)===String(r.hash))||
        (r.cloudRecordId&&String(x.cloudRecordId||'')===String(r.cloudRecordId))||
        (!r.hash&&sameName&&logicalName(x.name)===sameName&&(!samePeriod||String(x.period||'')===samePeriod))
    });
    if(still)throw new Error('Delete verification failed — same challan still exists in cloud');
    setStatus(type,'Deleted permanently ✓ — '+(r.name||'challan')+(purged>1?' · '+purged+' local copies cleared':''))
  }catch(e){
    try{if(root.ATPLCloudAPI&&typeof root.ATPLCloudAPI.clearCache==='function')root.ATPLCloudAPI.clearCache()}catch(_){}
    await refresh(type);
    setStatus(type,'Delete failed — '+(e.message||e),true)
  }
}

function cloudRecordFromLocal(r){
  var ids=Array.isArray(r&&r.ids)?r.ids:[],digits=[],alnums=[];
  ids.forEach(function(x){var s=String(x||'');if(/^\d+$/.test(s))digits.push(s);else if(s)alnums.push(s)});
  return{id:r.cloudRecordId||r.id,type:r.type,name:r.name,size:r.size||0,lastModified:r.lastModified||0,uploadedAt:r.uploadedAt||'',updatedAt:r.updatedAt||r.uploadedAt||new Date().toISOString(),period:r.period||'',periodSource:r.periodSource||'',detail:'ATPL DOL V2 shared cloud index',digitIds:digits,alnumIds:alnums,fileHash:r.hash||'',fingerprint:r.hash||'',parseVersion:'v3-cloud-only-final13-delete-fix',cloudConfirmedAt:r.cloudConfirmedAt||''}
}
function localRecordFromCloud(r){
  var ids=Array.from(new Set([].concat(Array.isArray(r&&r.digitIds)?r.digitIds:[],Array.isArray(r&&r.alnumIds)?r.alnumIds:[]).map(String).filter(Boolean))),hash=String(r&&r.fileHash||r&&r.fingerprint||''),type=String(r&&r.type||'');
  var id=hash&&type?uid(type,hash):String(r&&r.id||'');
  return{id:id||String(r&&r.id||uid(type||'esic',hash)),cloudRecordId:String(r&&r.id||''),version:2,type:type,name:String(r&&r.name||'Cloud challan'),size:Number(r&&r.size||0)||0,lastModified:Number(r&&r.lastModified||0)||0,hash:hash,period:String(r&&r.period||''),periodSource:String(r&&r.periodSource||'cloud'),ids:ids,parseStatus:ids.length?'ready':'error',parseError:ids.length?'':'Cloud index has no IDs',uploadedAt:String(r&&r.uploadedAt||''),updatedAt:String(r&&r.updatedAt||r&&r.uploadedAt||new Date().toISOString()),blob:null,viewerSheets:null,storage:'cloud-index',cloudSynced:true,cloudConfirmedAt:String(r&&r.cloudConfirmedAt||''),cloudOnly:true}
}
async function sanitizeLocalTypeMixups(){
  var all=await dbAll(),pf=all.filter(function(r){return r&&r.type==='pf'}),fixed=0;
  function exactPfTwin(r){
    if(!r||r.type!=='esic')return null;
    return pf.find(function(p){
      if(!p)return false;
      if(r.hash&&p.hash&&String(r.hash)===String(p.hash))return true;
      return !!(r.period&&p.period&&r.period===p.period&&logicalName(r.name)&&logicalName(r.name)===logicalName(p.name))
    })||null
  }
  var bad=all.filter(function(r){return looksLikePfRecord(r)||!!exactPfTwin(r)});
  for(var i=0;i<bad.length;i++){
    var r=bad[i],match=exactPfTwin(r);
    if(!match&&looksLikePfRecord(r)&&r.hash){
      var ids=recordIds(r).map(function(x){return validId('pf',x)}).filter(Boolean),nr=Object.assign({},r,{id:uid('pf',r.hash),type:'pf',ids:Array.from(new Set(ids)),parseStatus:ids.length?'ready':'error',parseError:ids.length?'':'No valid PF/UAN number detected',updatedAt:new Date().toISOString(),cloudSynced:false,cloudConfirmedAt:'',cloudOnly:false,opfsPath:null,storage:'cloud-index',blob:null});
      var stored=await getStoredBlob(r),moved=false;
      if(stored){try{moved=await opfsSave(nr,stored)}catch(_){moved=false}if(!moved){nr.blob=stored;nr.storage='indexeddb'}}
      await dbPut(nr);pf.push(nr);if(moved)await opfsDelete(r)
    }
    await opfsDelete(r);await dbDelete(r.id);fixed++;if(i%5===0)await tick()
  }
  if(fixed)await writeVaultManifest();return fixed
}
async function dedupeLocalRecords(){
  var all=await dbAll(),groups={},changed=0;
  all.forEach(function(r){
    if(!r||['esic','pf'].indexOf(r.type)<0)return;
    var key=r.hash?r.type+'|h|'+String(r.hash):r.type+'|np|'+logicalName(r.name)+'|'+String(r.period||'')+'|'+String(r.size||0);
    if(!groups[key])groups[key]=[];groups[key].push(r)
  });
  var keys=Object.keys(groups);
  for(var k=0;k<keys.length;k++){
    var rows=groups[keys[k]];if(rows.length<2)continue;
    rows.sort(function(a,b){
      function q(r){var n=0;if(r.storage==='opfs'||r.blob instanceof Blob||r.buffer)n+=20;if((r.ids||[]).length)n+=8;if(r.period)n+=4;if(r.parseStatus==='ready')n+=3;if(r.cloudSynced)n+=1;return n+(Date.parse(r.updatedAt||r.uploadedAt||'')||0)/1e15}
      return q(b)-q(a)
    });
    var best=rows[0],canonical=best.hash?uid(best.type,best.hash):best.id,ids=Array.from(new Set([].concat.apply([],rows.map(recordIds)))),merged=Object.assign({},best,{id:canonical,ids:ids,parseStatus:ids.length?'ready':best.parseStatus,parseError:ids.length?'':best.parseError});
    if(!merged.period){var pr=rows.find(function(x){return!!x.period});if(pr){merged.period=pr.period;merged.periodSource=pr.periodSource}}
    var donor=rows.find(function(x){return x.storage==='opfs'&&x.opfsPath})||rows.find(function(x){return x.blob instanceof Blob||x.buffer});
    if(donor&&donor!==best){merged.storage=donor.storage;merged.opfsPath=donor.opfsPath||null;merged.blob=donor.blob||null;merged.buffer=donor.buffer||null}
    await dbPut(merged);
    for(var i=0;i<rows.length;i++)if(String(rows[i].id)!==String(canonical))await dbDelete(rows[i].id);
    changed++;if(k%5===0)await tick()
  }
  if(changed)await writeVaultManifest();return changed
}

async function pushCloudIndex(rec){
  var api=durableApi();if(!api||typeof api.saveComplianceDolConfirmed!=='function')return false;
  if(looksLikePfRecord(rec))return false;
  try{
    var back=await api.saveComplianceDolConfirmed(cloudRecordFromLocal(rec));rec.cloudSynced=true;rec.cloudOnly=false;rec.cloudConfirmedAt=String(back&&back.cloudConfirmedAt||new Date().toISOString());await dbPut(rec);return true
  }catch(e){console.warn('DOL V2 cloud index save failed',rec&&rec.name,e);return false}
}
async function pushCloudBatchNow(list){
  list=(list||[]).filter(function(r){return r&&!looksLikePfRecord(r)});if(!list.length)return{saved:0,failed:0};
  var api=durableApi();if(!api)return{saved:0,failed:list.length};
  try{
    if(typeof api.saveComplianceDolBatchConfirmed==='function'){
      var res=await api.saveComplianceDolBatchConfirmed(list.map(cloudRecordFromLocal)),ok={};
      (res&&res.results||[]).forEach(function(x){var id=x&&(x.id||(x.record&&x.record.id));if(x&&x.ok&&id)ok[String(id)]=1});
      for(var i=0;i<list.length;i++){if(ok[String(list[i].id)]){list[i].cloudSynced=true;list[i].cloudOnly=false;list[i].cloudConfirmedAt=new Date().toISOString();await dbPut(list[i])}}
      return{saved:Number(res&&res.saved||0),failed:Number(res&&res.failed||0)}
    }
    var saved=0;for(var j=0;j<list.length;j++)if(await pushCloudIndex(list[j]))saved++;return{saved:saved,failed:list.length-saved}
  }catch(e){console.warn('DOL V2 cloud batch failed',e);return{saved:0,failed:list.length}}
}
function pushCloudBatch(list){
  list=(list||[]).filter(Boolean).slice();
  var run=cloudWriteTail.catch(function(){}).then(function(){return pushCloudBatchNow(list)});
  cloudWriteTail=run.catch(function(){});
  return run
}
async function pullCloudIndex(type){
  var api=durableApi();if(!api||typeof api.getComplianceDolRecords!=='function')return false;
  try{
    var remote=await api.getComplianceDolRecords(type),local=await dbAll(),sameType=local.filter(function(r){return r&&r.type===type}),byId={},byHash={},remoteIds={},remoteHashes={};
    sameType.forEach(function(r){byId[String(r.id)]=r;if(r.hash)byHash[String(r.hash)]=r});
    for(var i=0;i<remote.length;i++){
      var rr=localRecordFromCloud(remote[i]);if(!rr.type||rr.type!==type)continue;
      if(looksLikePfRecord(rr)){await dbDelete(rr.id);continue}
      if(rr.hash)remoteHashes[String(rr.hash)]=1;remoteIds[String(rr.id)]=1;
      var old=byId[rr.id]||(rr.hash&&byHash[rr.hash])||null;
      if(old){
        var preserve={blob:old.blob||null,viewerSheets:old.viewerSheets||null,storage:old.storage||rr.storage,opfsPath:old.opfsPath||null,cloudOnly:!old.blob&&!old.opfsPath};
        var newer=Date.parse(rr.updatedAt||'')>=Date.parse(old.updatedAt||'');
        var merged=newer?Object.assign({},old,rr,preserve):Object.assign({},rr,old,{id:rr.id,cloudSynced:true,cloudConfirmedAt:rr.cloudConfirmedAt||old.cloudConfirmedAt||'',cloudOnly:preserve.cloudOnly});
        merged.id=rr.id;merged.cloudSynced=true;
        await dbPut(merged);
        if(old.id!==merged.id)await dbDelete(old.id);
        byId[merged.id]=merged;if(merged.hash)byHash[merged.hash]=merged
      }else{await dbPut(rr);byId[rr.id]=rr;if(rr.hash)byHash[rr.hash]=rr}
      if(i%8===0)await tick()
    }
    await dedupeLocalRecords();
    var verify=(await dbAll()).filter(function(r){return r&&r.type===type});
    for(var j=0;j<verify.length;j++){
      var r=verify[j],present=(r.hash&&remoteHashes[String(r.hash)])||remoteIds[String(r.id)];
      // Cloud-only rows are a cache. If backend no longer has them, remove them so every login/device converges.
      if(!present&&r.cloudOnly){
        await dbDelete(r.id);
        if(j%12===0)await tick();
        continue
      }
      if(!present&&r.storage==='cloud-index'&&!r.blob&&!r.opfsPath){
        await dbDelete(r.id);
        if(j%12===0)await tick();
        continue
      }
      if(!r.cloudOnly&&!!r.cloudSynced!==!!present){
        r.cloudSynced=!!present;if(!present)r.cloudConfirmedAt='';await dbPut(r)
      }
      if(j%12===0)await tick()
    }
    await dedupeLocalRecords();
    await refresh(type);return true
  }catch(e){console.warn('DOL V2 cloud pull failed',type,e);return false}
}
function cloudLoginReady(){try{return !!(root.sessionStorage.getItem('ATPL_RemoteToken_V1')||root.sessionStorage.getItem('ATPL_SharedToken_V1'))}catch(_){return false}}
function scheduleCloudRetry(){
  if(cloudRetryTimer||!cloudLoginReady())return;
  cloudRetryTimer=setTimeout(function(){cloudRetryTimer=0;syncCloudIndexes()},700)
}
function activeDolType(){
  var e=$('page-esictodol'),p=$('page-pftodol');
  if(e&&e.classList.contains('active'))return'esic';
  if(p&&p.classList.contains('active'))return'pf';
  return''
}
function syncCloudType(type,force){
  type=String(type||'').toLowerCase();if(type!=='esic'&&type!=='pf')return Promise.resolve(false);
  if(!cloudLoginReady())return Promise.resolve(false);
  if(cloudSyncPromises[type])return cloudSyncPromises[type];
  if(!force&&Date.now()-cloudLastSync[type]<8000)return Promise.resolve(true);
  cloudLastSync[type]=Date.now();
  cloudSyncPromises[type]=Promise.resolve(refresh(type)).then(function(ok){
    if(ok)setStatus(type,'Shared backend loaded ✓ · same library for every login/device.');
    return !!ok
  }).catch(function(e){console.warn('DOL '+type+' refresh failed',e);return false}).finally(function(){cloudSyncPromises[type]=null});
  return cloudSyncPromises[type]
}
function syncCloudIndexes(type){
  type=String(type||activeDolType()||'').toLowerCase();
  if(type==='esic'||type==='pf')return syncCloudType(type,true);
  return Promise.resolve(false)
}

async function upload(type,fileList){
  var files=Array.isArray(fileList)?fileList.slice():Array.from(fileList||[]);if(!files.length){setStatus(type,'No file selected',true);return}
  await requestPersistentStorage();var st=$('cd2-'+type+'-storage');if(st)st.textContent='☁ Shared backend master · local cache only for Open/Download';
  var api=durableApi();if(!cloudLoginReady()||!api||typeof api.getComplianceDolRecords!=='function'){setStatus(type,'Login/cloud backend required before upload.',true);return}
  var remoteBoth=await Promise.all([api.getComplianceDolRecords('esic'),api.getComplianceDolRecords('pf')]),byHash={},otherByHash={};
  (remoteBoth[type==='esic'?0:1]||[]).forEach(function(x){var h=String(x.fileHash||x.fingerprint||'');if(h)byHash[h]=localRecordFromCloud(x)});
  (remoteBoth[type==='esic'?1:0]||[]).forEach(function(x){var h=String(x.fileHash||x.fingerprint||'');if(h)otherByHash[h]=localRecordFromCloud(x)});
  var saved=0,indexed=0,dups=0,attached=0,warns=[],cloudQueue=[];
  for(var i=0;i<files.length;i++){
    var f=files[i];setStatus(type,'Saving '+(i+1)+' / '+files.length+' · '+f.name);
    try{
      if(!/\.(pdf|xlsx|xls|csv)$/i.test(f.name))throw new Error('Unsupported file type');
      var buf=await f.arrayBuffer(),hash=await sha256(buf),existing=byHash[hash]||null,cross=otherByHash[hash]||null;
      if(cross){
        dups++;warns.push(f.name+': already belongs to '+(cross.type==='pf'?'PF → DOL':'ESIC → DOL')+' — cross-module duplicate blocked');buf=null;continue
      }
      if(existing){
        // Backend already owns this hash. Keep a local copy only for Open/Download on this device.
        var localExisting=await dbGet(existing.id);
        if(!localExisting){
          var attachBlob=new Blob([buf],{type:fileMime(f.name)}),cacheRec=Object.assign({},existing,{blob:null,storage:'indexeddb',cloudOnly:false});
          var vaultedAttach=false;try{vaultedAttach=await opfsSave(cacheRec,attachBlob)}catch(_){}
          if(!vaultedAttach)cacheRec.blob=attachBlob;cacheRec.storage=vaultedAttach?'opfs':'indexeddb';await dbPut(cacheRec);await writeVaultManifest();attached++
        }
        dups++;setStatus(type,'Already exists in shared backend ✓ — '+f.name);continue
      }
      var quick=inferPeriod(f.name,''),blob=new Blob([buf],{type:fileMime(f.name)}),rec={id:uid(type,hash),version:2,type:type,name:f.name,size:f.size,lastModified:f.lastModified||0,hash:hash,period:quick.period,periodSource:quick.source,ids:[],parseStatus:'processing',parseError:'',uploadedAt:new Date().toISOString(),updatedAt:new Date().toISOString(),blob:null,viewerSheets:null,storage:'indexeddb',cloudSynced:false,cloudOnly:false};
      var vaulted=false;try{vaulted=await opfsSave(rec,blob)}catch(_){}
      if(!vaulted)rec.blob=blob;
      await dbPut(rec);await writeVaultManifest();byHash[hash]=rec;saved++;await refresh(type);setStatus(type,'Saved locally ✓ · indexing '+(i+1)+' / '+files.length+' · '+f.name+' · 0%');
      try{
        var parsed=await parseBuffer(buf,f.name,type,function(p){setStatus(type,'Saved ✓ · indexing '+(i+1)+' / '+files.length+' · '+f.name+' · '+p+'%')});
        if(parsed.detectedType&&parsed.detectedType!==type){
          await opfsDelete(rec);await dbDelete(rec.id);delete byHash[hash];saved--;warns.push(f.name+': '+(parsed.detectedType==='pf'?'PF challan detected — upload only in PF → DOL':'ESIC challan detected — upload only in ESIC → DOL'));buf=null;blob=null;await refresh(type);continue
        }
        rec.ids=parsed.ids||[];if(!rec.period&&parsed.period){rec.period=parsed.period;rec.periodSource=parsed.periodSource}
        rec.parseStatus=rec.ids.length?'ready':'error';rec.parseError=rec.ids.length?'':'No valid '+(type==='esic'?'ESIC/IP':'PF/UAN')+' number detected';if(rec.ids.length)indexed++;else warns.push(f.name+': no IDs detected');
      }catch(pe){rec.parseStatus='error';rec.parseError=String(pe&&pe.message||pe);warns.push(f.name+': '+rec.parseError)}
      rec.updatedAt=new Date().toISOString();await dbPut(rec);await writeVaultManifest();cloudQueue.push(rec);buf=null;blob=null;await refresh(type);await tick()
    }catch(e){warns.push(f.name+': '+(e.message||e));console.warn('V2 challan upload failed',f.name,e)}
  }
  var cloud={saved:0,failed:0};if(cloudQueue.length){setStatus(type,'Uploading to shared backend…');cloud=await pushCloudBatch(cloudQueue);await writeVaultManifest()}
  await refresh(type);var msg=[];if(cloud.saved)msg.push(cloud.saved+' saved in shared backend ✓');if(attached)msg.push(attached+' local viewer cache attached ✓');if(indexed)msg.push(indexed+' indexed ✓');if(cloud.failed)msg.push(cloud.failed+' NOT saved — retry required');if(dups)msg.push(dups+' duplicate skipped ✓');if(warns.length)msg.push(warns.slice(0,2).join(' | ')+(warns.length>2?' | +'+(warns.length-2)+' more':''));
  setStatus(type,msg.join(' · ')||'No files saved',!!cloud.failed||(!cloud.saved&&!attached&&!!warns.length))
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
        var rawIds=[].concat(r.digitIds||[],r.alnumIds||[]),targetType=looksLikePfRecord({type:r.type,name:r.name,ids:rawIds})?'pf':r.type;
        var ids=Array.from(new Set(rawIds.map(function(x){return validId(targetType,x)}).filter(Boolean)));if(!ids.length)continue;
        var nr={id:uid(targetType,hash),version:2,type:targetType,name:r.name||'Legacy challan',size:r.size||buf.byteLength,lastModified:r.lastModified||0,hash:hash,period:r.period||'',periodSource:r.periodSource||'legacy',ids:ids,uploadedAt:r.uploadedAt||new Date().toISOString(),updatedAt:new Date().toISOString(),blob:new Blob([buf],{type:fileMime(r.name)}),viewerSheets:r.viewerSheets||null,migrated:true,cloudSynced:false,cloudOnly:false};
        await dbPut(nr);hashes[hash]=1;moved++;await tick()
      }catch(e){console.warn('V2 legacy migration skipped',e)}
    }
    if(moved)console.info('Compliance DOL V2 migrated',moved,'local challan files')
  }catch(e){console.warn('V2 legacy migration unavailable',e)}
}
function wire(type){
  var inp=$('cd2-'+type+'-upload'),pick=document.querySelector('[data-cd2-pick="'+type+'"]'),libSearch=$('cd2-'+type+'-libsearch'),yearFilter=$('cd2-'+type+'-yearfilter');
  if(!inp||!pick)return;
  pick.onclick=async function(){await requestPersistentStorage();var st=$('cd2-'+type+'-storage');if(st)st.textContent=storageLabel();inp.click()};
  inp.addEventListener('change',function(){var fs=Array.from(this.files||[]);this.value='';if(fs.length)upload(type,fs);else setStatus(type,'No file selected',true)});
  var sb=document.querySelector('[data-cd2-search="'+type+'"]');if(sb)sb.onclick=function(){search(type)};
  var rb=document.querySelector('[data-cd2-refresh="'+type+'"]');if(rb)rb.onclick=function(){refresh(type)};
  if(libSearch)libSearch.addEventListener('input',function(){renderFiles(type)});
  if(yearFilter)yearFilter.addEventListener('change',function(){renderFiles(type)});
  var files=$('cd2-'+type+'-files');if(!files)return;
  files.addEventListener('change',function(e){var id=e.target.getAttribute('data-cd2-period');if(id)updatePeriod(type,id,e.target.value)});
  files.addEventListener('click',function(e){var v=e.target.closest&&e.target.closest('[data-cd2-view]');if(v){openViewer(type,v.getAttribute('data-cd2-view'));return}var dl=e.target.closest&&e.target.closest('[data-cd2-download]');if(dl){downloadChallan(type,dl.getAttribute('data-cd2-download'));return}var d=e.target.closest&&e.target.closest('[data-cd2-delete]');if(d)deleteOne(type,d.getAttribute('data-cd2-delete'))})
}

function mountLatest(type){
  var page=ensurePage(type);if(!page)return false;
  var shell=page.querySelector('.cd2-shell'),ok=shell&&shell.getAttribute('data-cd2-ui')==='cloud-only-final17-fast10'&&$('cd2-'+type+'-libsearch')&&$('cd2-'+type+'-yearfilter');
  if(ok){localPreview(type).then(function(){return syncCloudType(type,false)});return true}
  page.innerHTML=pageHtml(type);wire(type);
  localPreview(type).then(function(){return syncCloudType(type,true)}).catch(function(e){console.warn('DOL remount refresh failed',e)});
  return true
}
function patchNavigation(){
  if(typeof root.goPage!=='function'||root.goPage.__cd2PersistentWrapped)return;
  var old=root.goPage;
  function wrapped(name){
    var r=old.apply(this,arguments);
    if(name==='esictodol')mountLatest('esic');
    if(name==='pftodol')mountLatest('pf');
    return r
  }
  wrapped.__cd2PersistentWrapped=true;wrapped.__original=old;root.goPage=wrapped
}

async function boot(){
  addCss();addLibraryCss();ensureViewer();ensureNav('esic');ensureNav('pf');
  setTimeout(function(){requestPersistentStorage().catch(function(e){console.warn('Persistent storage setup deferred',e)})},1800);
  var ep=ensurePage('esic'),pp=ensurePage('pf');if(!ep||!pp)throw new Error('ERP content container not found');
  ep.innerHTML=pageHtml('esic');pp.innerHTML=pageHtml('pf');wire('esic');wire('pf');patchNavigation();
  var se=$('cd2-esic-storage'),sp=$('cd2-pf-storage');if(se)se.textContent='☁ Shared backend master';if(sp)sp.textContent='☁ Shared backend master';
  setStatus('esic','Ready · open ESIC → DOL to load shared library.');
  setStatus('pf','Ready · open PF → DOL to load shared library.');
  root.addEventListener('online',function(){var t=activeDolType();if(t)setTimeout(function(){syncCloudType(t,true)},700)});
}
function start(){setTimeout(function(){boot().catch(function(e){console.error('Compliance DOL V2 boot failed',e)})},180)}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();

root.ATPLComplianceDOLV2={refresh:refresh,open:function(type,id){return openViewer(type,id)},syncCloud:syncCloudIndexes,version:function(){return root.__ATPL_COMPLIANCE_DOL_REBUILD_V2__}};
})(window);
