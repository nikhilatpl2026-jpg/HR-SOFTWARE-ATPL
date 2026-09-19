/* ATPL ERP Durable Everything V1
   Goal: keep user-entered ERP state durable across refresh/login/device changes without deleting existing data.
   Covers: shared file uploads, in-app edits, MAM/local UI settings, and Bank A/C Verifier saved references.
   Existing Employee Master / HR Docs / Activity cloud modules remain authoritative for those datasets. */
(function(root){'use strict';
  if(!root||root.__ATPL_DURABLE_EVERYTHING_V1__)return;
  root.__ATPL_DURABLE_EVERYTHING_V1__='2026.09.19-authoritative-dol-final8';

  var API='https://script.google.com/macros/s/AKfycby99_893hVtbWOQr67ikxIwiq81MWW8JAa2LuxTu67JBxjQ_iWb-YkqhBmW0RrHU512SQ/exec';
  var TOKEN='ATPL_RemoteToken_V1',ALT_TOKEN='ATPL_SharedToken_V1',SESS='ATPL_UserSession_V5',SYS='__ATPL_SYS__';
  var STAMP='ATPL_DurableStateStamp_V1',STATE_KEY='global_ui_state_v1';
  var BANK_DB='ATPL_BANK_VERIFIER_PRIVATE_V3',BANK_VER=2,BANK_STORE='previousSheets',BANK_WORK_STORE='workingFiles';
  var DOL_DB='ATPL_COMPLIANCE_DOL_V1',DOL_VER=1,DOL_STORE='files';
  var DOL_KIND_LEGACY='compliance_dol_v1',DOL_KIND_ESIC='esic_dol_v2',DOL_KIND_PF='pf_dol_v2';
  var CHUNK=900,MAX_CHUNKS=450,CONCURRENCY=3;
  var running=false,pending=false,lastRun=0,lastStateHash='',lastBankPush={},lastDolPush={},fileSaveQueue={},fileSaveTimer=0,fileSaveRunning=false,dolLegacyMigrationPromise=null;

  function text(v){return v==null?'':String(v).trim()}
  function J(v,d){try{return JSON.parse(v)}catch(_){return d}}
  function token(){try{var a=root.sessionStorage.getItem(TOKEN)||'',b=root.sessionStorage.getItem(ALT_TOKEN)||'',t=a||b;if(t){if(!a)root.sessionStorage.setItem(TOKEN,t);if(!b)root.sessionStorage.setItem(ALT_TOKEN,t)}return t}catch(_){return''}}
  function session(){try{var s=J(root.sessionStorage.getItem(SESS)||'null',null);return s&&s.id?s:null}catch(_){return null}}
  function api(params,timeout){/* broker-routed-durable */if(root.ATPLCloudAPI)return root.ATPLCloudAPI.request(params,{timeout:timeout,source:'durable'});return new Promise(function(resolve,reject){var cb='__atpl_durable_'+Date.now()+'_'+Math.random().toString(36).slice(2),s=root.document.createElement('script'),done=false,t=setTimeout(function(){finish();reject(new Error('Durable cloud timeout'))},timeout||20000);function finish(){if(done)return;done=true;clearTimeout(t);try{delete root[cb]}catch(_){root[cb]=undefined}if(s.parentNode)s.parentNode.removeChild(s)}root[cb]=function(data){finish();resolve(data||{})};params=Object.assign({},params||{},{callback:cb,_ts:Date.now()});var qs=Object.keys(params).map(function(k){return encodeURIComponent(k)+'='+encodeURIComponent(params[k]==null?'':String(params[k]))}).join('&');s.onerror=function(){finish();reject(new Error('Durable cloud connect failed'))};s.async=true;s.src=API+'?'+qs;(root.document.head||root.document.documentElement).appendChild(s)})}
  function fnv(s){var h=2166136261;for(var i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}return('00000000'+(h>>>0).toString(16)).slice(-8)}
  function safeKey(kind,key){return kind.slice(0,2).toUpperCase()+'_'+fnv(String(key||'').toLowerCase())}
  function metaId(k){return SYS+'META__'+k}
  function chunkId(k,i){return SYS+'CHUNK__'+k+'__'+('000'+i.toString(36)).slice(-3)}
  function bytesToB64(bytes){var out='',step=0x8000;for(var i=0;i<bytes.length;i+=step)out+=String.fromCharCode.apply(null,bytes.subarray(i,Math.min(bytes.length,i+step)));return btoa(out)}
  function b64ToBytes(s){var bin=atob(s),a=new Uint8Array(bin.length);for(var i=0;i<bin.length;i++)a[i]=bin.charCodeAt(i);return a}
  async function encodeObject(obj){var raw=new TextEncoder().encode(JSON.stringify(obj)),bytes=raw,encoding='utf8-base64';if(typeof root.CompressionStream==='function'){try{var cs=new root.CompressionStream('gzip'),ab=await new Response(new Blob([raw]).stream().pipeThrough(cs)).arrayBuffer();bytes=new Uint8Array(ab);encoding='gzip-base64'}catch(_){}}return{encoding:encoding,data:bytesToB64(bytes),rawBytes:raw.length,packedBytes:bytes.length}}
  async function decodeObject(encoding,data){
  var bytes=b64ToBytes(data);
  if(encoding==='gzip-base64'){
    if(typeof root.DecompressionStream==='function'){
      var ds=new root.DecompressionStream('gzip'),ab=await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer();bytes=new Uint8Array(ab)
    }else if(root.pako&&typeof root.pako.ungzip==='function'){
      bytes=root.pako.ungzip(bytes)
    }else{
      throw new Error('GZIP decoder unavailable on this browser')
    }
  }
  return JSON.parse(new TextDecoder().decode(bytes))
}
  async function upsert(id,record,attempt){var tk=token();if(!tk)throw new Error('Login token missing');var d=await api({action:'upsertEmployeeMaster',token:tk,emp_id:id,record_json:JSON.stringify(Object.assign({emp_id:id,_atpl_system:true},record))},22000);if(d&&d.ok)return true;if(!attempt){await new Promise(function(r){setTimeout(r,650)});return upsert(id,record,1)}throw new Error(d&&d.error||'Durable cloud save failed')}
  async function removeRemote(id,attempt){var tk=token();if(!tk)throw new Error('Login token missing');var d=await api({action:'deleteEmployeeMaster',token:tk,emp_id:id},22000);if(d&&d.ok)return true;if(!attempt){await new Promise(function(r){setTimeout(r,500)});return removeRemote(id,1)}throw new Error(d&&d.error||'Durable cloud delete failed')}
  async function pool(tasks,limit){var at=0,failed=null;async function worker(){while(!failed){var i=at++;if(i>=tasks.length)return;try{await tasks[i]()}catch(e){failed=e;return}}}var ws=[];for(var n=0;n<Math.min(limit,tasks.length);n++)ws.push(worker());await Promise.all(ws);if(failed)throw failed}
  function recordsFor(records,key){var meta=null,chunks={};(records||[]).forEach(function(r){if(r&&r.object_key===key&&r._atpl_kind==='meta')meta=r;else if(r&&r.object_key===key&&r._atpl_kind==='chunk')chunks[Number(r.index)]=String(r.data||'')});return{meta:meta,chunks:chunks}}
  async function saveObject(kind,key,payload,info){var packed=await encodeObject(payload),parts=[];for(var i=0;i<packed.data.length;i+=CHUNK)parts.push(packed.data.slice(i,i+CHUNK));if(parts.length>MAX_CHUNKS)throw new Error('Durable cloud copy too large ('+parts.length+' chunks)');var k=safeKey(kind,key),u=session()||{},tasks=parts.map(function(part,idx){return function(){return upsert(chunkId(k,idx),{_atpl_kind:'chunk',object_kind:kind,object_key:k,index:idx,data:part})}});await pool(tasks,CONCURRENCY);var now=new Date().toISOString();await upsert(metaId(k),{_atpl_kind:'meta',object_kind:kind,object_key:k,key_text:String(key||''),name:text(info&&info.name||key),saved_at:text(info&&info.saved_at||now)||now,uploaded_at:now,uploaded_by:u.id||'',uploaded_name:u.name||'',encoding:packed.encoding,chunks:parts.length,raw_bytes:packed.rawBytes,packed_bytes:packed.packedBytes});return true}
  async function loadObject(records,meta){if(!meta||!meta.object_key)return null;var x=recordsFor(records,meta.object_key),n=Number(meta.chunks||0),parts=[];for(var i=0;i<n;i++){if(typeof x.chunks[i]!=='string')throw new Error('Incomplete durable object '+meta.name);parts.push(x.chunks[i])}return decodeObject(meta.encoding,parts.join(''))}
  async function fetchRemote(){
  if(!token())return[];
  var d;
  try{
    d=await api({action:'getSystemRecords',token:token()},14000);
    if(d&&d.ok&&Array.isArray(d.records))return d.records;
  }catch(_){}
  d=await api({action:'getEmployeeMaster',token:token()},22000);
  if(!(d&&d.ok&&Array.isArray(d.records)))throw new Error(d&&d.error||'Durable records unavailable');
  return d.records.filter(function(r){return r&&(r._atpl_system===true||text(r.emp_id).indexOf(SYS)===0)})
}

  function allowedLocalKey(k){k=String(k||'');if(!k||k===STAMP)return false;if(/token|session|password|credential|secret/i.test(k))return false;if(k==='ATPL_UserAccess_V1'||k==='AroraTextilesEmployeeMasterV3')return false;if(/^hrdoc_/i.test(k))return false;return /^ATPL_MamCompliance_/i.test(k)||/^ATPL_BankVerifier_/i.test(k)||/^ATPL_.*(?:UI|State|Profile|Rule|Setting|Preference|Auditor)/i.test(k)||/^AroraTextilesHRDocTypes/i.test(k)||/^arora_hr_doc_types$/i.test(k)}
  function collectState(){var values={};try{for(var i=0;i<root.localStorage.length;i++){var k=root.localStorage.key(i);if(allowedLocalKey(k))values[k]=root.localStorage.getItem(k)}}catch(_){}var stamp=Number(root.localStorage.getItem(STAMP)||0)||0;return{version:1,updatedAt:stamp,values:values}}
  function hashState(o){var s=JSON.stringify(o&&o.values||{}),h=2166136261;for(var i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}return String(h>>>0)}
  function touchState(){try{root.localStorage.setItem(STAMP,String(Date.now()))}catch(_){}schedule(1200)}
  function patchLocalStorage(){try{var p=root.Storage&&root.Storage.prototype;if(!p||p.__atplDurableEverything)return;var set=p.setItem,rem=p.removeItem;p.setItem=function(k,v){var r=set.call(this,k,v);if(this===root.localStorage&&allowedLocalKey(k)&&!root.__ATPL_DURABLE_APPLYING__)touchState();return r};p.removeItem=function(k){var r=rem.call(this,k);if(this===root.localStorage&&allowedLocalKey(k)&&!root.__ATPL_DURABLE_APPLYING__)touchState();return r};p.__atplDurableEverything=true}catch(_){}}
  async function syncState(records){var key=safeKey('durable_state',STATE_KEY),x=recordsFor(records,key),remote=x.meta?await loadObject(records,x.meta):null,local=collectState(),localTs=Number(local.updatedAt||0),remoteTs=Number(remote&&remote.updatedAt||Date.parse(x.meta&&x.meta.saved_at||'')||0),merged=Object.assign({},remote&&remote.values||{},local.values||{});if(remote&&remoteTs>localTs){root.__ATPL_DURABLE_APPLYING__=1;try{Object.keys(remote.values||{}).forEach(function(k){if(allowedLocalKey(k))root.localStorage.setItem(k,String(remote.values[k]))});root.localStorage.setItem(STAMP,String(remoteTs))}finally{root.__ATPL_DURABLE_APPLYING__=0}local=collectState();lastStateHash=hashState(local);return true}var h=hashState({values:merged});if(!x.meta||h!==lastStateHash||localTs>remoteTs){var ts=Math.max(Date.now(),localTs,remoteTs);root.__ATPL_DURABLE_APPLYING__=1;try{Object.keys(merged).forEach(function(k){if(allowedLocalKey(k)&&root.localStorage.getItem(k)==null)root.localStorage.setItem(k,String(merged[k]))});root.localStorage.setItem(STAMP,String(ts))}finally{root.__ATPL_DURABLE_APPLYING__=0}await saveObject('durable_state',STATE_KEY,{version:1,updatedAt:ts,values:merged},{name:'ERP durable UI/state',saved_at:new Date(ts).toISOString()});lastStateHash=h}return true}

  function openBankDb(){return new Promise(function(ok,no){try{var r=root.indexedDB.open(BANK_DB,BANK_VER);r.onupgradeneeded=function(){var d=r.result;if(!d.objectStoreNames.contains(BANK_STORE))d.createObjectStore(BANK_STORE,{keyPath:'id'});if(!d.objectStoreNames.contains(BANK_WORK_STORE))d.createObjectStore(BANK_WORK_STORE,{keyPath:'id'})};r.onsuccess=function(){ok(r.result)};r.onerror=function(){no(r.error)}}catch(e){no(e)}})}
  async function bankRows(store){try{var d=await openBankDb();return await new Promise(function(ok){if(!d.objectStoreNames.contains(store)){d.close();ok([]);return}var r=d.transaction(store,'readonly').objectStore(store).getAll();r.onsuccess=function(){d.close();ok(r.result||[])};r.onerror=function(){d.close();ok([])}})}catch(_){return[]}}
  async function putBank(store,rec){var d=await openBankDb();return new Promise(function(ok,no){try{var t=d.transaction(store,'readwrite');t.objectStore(store).put(rec);t.oncomplete=function(){d.close();ok(true)};t.onerror=function(){var e=t.error;d.close();no(e)}}catch(e){d.close();no(e)}})}
  function trimRows(rows){rows=(rows||[]).map(function(r){r=Array.isArray(r)?r.slice():[];while(r.length&&String(r[r.length-1]==null?'':r[r.length-1]).trim()==='')r.pop();return r});while(rows.length&&(!rows[rows.length-1]||!rows[rows.length-1].some(function(v){return String(v==null?'':v).trim()!==''})))rows.pop();return rows}
  function workbookPayload(name,buf){if(!root.XLSX)throw new Error('Excel engine unavailable');var wb=root.XLSX.read(buf,{type:'array',cellDates:false,cellText:true});return{v:2,name:name,sheets:wb.SheetNames.map(function(sn){var rows=root.XLSX.utils.sheet_to_json(wb.Sheets[sn],{header:1,raw:false,defval:''});return{name:sn,rows:trimRows(rows)}})}}
  function payloadBuffer(p){if(!root.XLSX||!p||!Array.isArray(p.sheets))throw new Error('Shared workbook invalid');var wb=root.XLSX.utils.book_new();p.sheets.forEach(function(s){var ws=root.XLSX.utils.aoa_to_sheet(Array.isArray(s.rows)?s.rows:[]);root.XLSX.utils.book_append_sheet(wb,ws,String(s.name||'Sheet').slice(0,31)||'Sheet')});return root.XLSX.write(wb,{bookType:'xlsx',type:'array',compression:true})}
  async function bankPayload(rec,kind){return{version:2,id:rec.id,mode:rec.mode||'compliance',role:rec.role||'',fileName:rec.fileName||'Bank.xlsx',type:rec.type||'',lastModified:rec.lastModified||0,size:rec.size||0,savedAt:rec.savedAt||new Date().toISOString(),selected:!!rec.selected,archived:!!rec.archived,archivedAt:rec.archivedAt||'',workbook:workbookPayload(rec.fileName||'Bank.xlsx',rec.buffer),kind:kind}}
  function ms(v){var n=Date.parse(v||'');return isFinite(n)?n:0}
  async function syncBankKind(records,opt){
    var metas=records.filter(function(r){return r._atpl_kind==='meta'&&r.object_kind===opt.kind}),local=await bankRows(opt.store),by={},rm={};local.forEach(function(r){if(r&&r.id)by[String(r.id)]=r});metas.forEach(function(m){rm[String(m.key_text||'')]=m});
    var changed=0,i;
    for(i=0;i<metas.length;i++){var m=metas[i],id=String(m.key_text||''),old=by[id];if(!id)continue;if(old&&ms(old.savedAt)>=ms(m.saved_at))continue;try{var p=await loadObject(records,m);if(!p||!p.id||!p.workbook)continue;var buf=payloadBuffer(p.workbook),rec={id:p.id,mode:p.mode||'compliance',role:p.role||'',fileName:p.fileName||p.workbook.name||'Bank.xlsx',type:p.type||'',lastModified:p.lastModified||0,size:p.size||buf.byteLength,savedAt:p.savedAt||m.saved_at||m.uploaded_at,selected:!!p.selected,archived:!!p.archived,archivedAt:p.archivedAt||'',buffer:buf};await putBank(opt.store,rec);by[id]=rec;changed++}catch(e){console.warn('Durable bank pull failed',id,e)}}
    local=await bankRows(opt.store);
    for(i=0;i<local.length;i++){var r=local[i];if(!r||!r.id)continue;var m0=rm[String(r.id)],push=!m0||ms(r.savedAt)>ms(m0.saved_at);var lk=opt.kind+':'+r.id;if(!push||lastBankPush[lk])continue;lastBankPush[lk]=1;try{var bp=await bankPayload(r,opt.kind);await saveObject(opt.kind,r.id,bp,{name:(r.mode||'')+' · '+(r.role||'')+' · '+(r.fileName||r.id),saved_at:r.savedAt||new Date().toISOString()});delete lastBankPush[lk]}catch(e){delete lastBankPush[lk];console.warn('Durable bank save failed',r&&r.fileName,e)}}
    return changed
  }
  async function syncBank(records){if(!root.indexedDB||!root.XLSX)return false;var a=await syncBankKind(records,{kind:'bank_ref_v3',store:BANK_STORE}),b=await syncBankKind(records,{kind:'bank_work_v4',store:BANK_WORK_STORE});if(a||b){try{root.document.dispatchEvent(new CustomEvent('atpl-bank-library-synced',{detail:{references:a,working:b}}))}catch(_){}try{if(root.ATPLBankAccountVerifierV4&&typeof root.ATPLBankAccountVerifierV4.reloadLibrary==='function')root.ATPLBankAccountVerifierV4.reloadLibrary()}catch(_){}}return true}

  function openDolDb(){return new Promise(function(ok,no){try{var r=root.indexedDB.open(DOL_DB,DOL_VER);r.onupgradeneeded=function(){var d=r.result;if(!d.objectStoreNames.contains(DOL_STORE))d.createObjectStore(DOL_STORE,{keyPath:'id'})};r.onsuccess=function(){ok(r.result)};r.onerror=function(){no(r.error)}}catch(e){no(e)}})}
  async function dolRows(){try{var d=await openDolDb();return await new Promise(function(ok){var r=d.transaction(DOL_STORE,'readonly').objectStore(DOL_STORE).getAll();r.onsuccess=function(){d.close();ok(r.result||[])};r.onerror=function(){d.close();ok([])}})}catch(_){return[]}}
  async function putDol(rec){var d=await openDolDb();return new Promise(function(ok,no){var t=d.transaction(DOL_STORE,'readwrite');t.objectStore(DOL_STORE).put(rec);t.oncomplete=function(){d.close();ok(true)};t.onerror=function(){var e=t.error;d.close();no(e)}})}
  async function deleteDolLocal(id){try{var d=await openDolDb();return await new Promise(function(ok,no){var t=d.transaction(DOL_STORE,'readwrite');t.objectStore(DOL_STORE).delete(id);t.oncomplete=function(){d.close();ok(true)};t.onerror=function(){var e=t.error;d.close();no(e)}})}catch(e){return false}}
  function dolPayload(r){return{id:r.id,type:r.type,name:r.name,size:r.size||0,lastModified:r.lastModified||0,uploadedAt:r.uploadedAt||'',updatedAt:r.updatedAt||r.uploadedAt||new Date().toISOString(),period:r.period||'',periodSource:r.periodSource||'',detail:r.detail||'',digitIds:Array.isArray(r.digitIds)?r.digitIds:[],alnumIds:Array.isArray(r.alnumIds)?r.alnumIds:[],fileHash:r.fileHash||'',fingerprint:r.fingerprint||'',parseVersion:r.parseVersion||'',cloudConfirmedAt:r.cloudConfirmedAt||'',duplicateOf:r.duplicateOf||'',archived:!!r.archived,archivedAt:r.archivedAt||''}}
  function dolStrongPfText(v){
    return /\b(?:ECR|ECR\s+STATEMENT|ECR\s+CHALLAN|EPF|EPFO|PF\s+CHALLAN|PROVIDENT\s+FUND|UAN|TRRN|GROSS\s+EPF\s+WAGES|MEMBER\s+ID)\b/.test(String(v||'').toUpperCase())
  }
  function dolLooksLikePfInEsic(r){
    if(!r||String(r.type||'')!=='esic')return false;
    var ids=[].concat(Array.isArray(r.ids)?r.ids:[],Array.isArray(r.digitIds)?r.digitIds:[],Array.isArray(r.alnumIds)?r.alnumIds:[]).map(String),twelve=ids.filter(function(x){return /^\d{12}$/.test(x.replace(/\D/g,''))}).length,establishment=ids.some(function(x){return /^[A-Z]{2,6}\d{7,}[A-Z0-9]*$/.test(x.toUpperCase().replace(/[^A-Z0-9]/g,''))}),sample=[r.name,r.detail,r.parseVersion].join(' ');
    return establishment||twelve>=3||dolStrongPfText(sample)
  }
  function dolKind(type){return String(type||'').toLowerCase()==='pf'?DOL_KIND_PF:DOL_KIND_ESIC}
  function dolAllowedKind(kind){return kind===DOL_KIND_LEGACY||kind===DOL_KIND_ESIC||kind===DOL_KIND_PF}
  function dolFingerprint(r){return text(r&& (r.fileHash||r.fingerprint||r.hash)).toLowerCase()}
  function dolLogicalName(name){return text(name).toLowerCase().replace(/\.[^.]+$/,'').replace(/\(\s*\d+\s*\)$/,'').replace(/[^a-z0-9]+/g,'')}
  function dolLogicalKey(r){var h=dolFingerprint(r);if(h)return'h:'+h;var n=dolLogicalName(r&&r.name),p=text(r&&r.period);return n&&p?'np:'+n+'|'+p:''}
  function dolCanonicalId(type,p){var h=dolFingerprint(p);return h?'v2_'+type+'_'+h.slice(0,24):String(p&&p.id||'')}
  function dolRemoteType(p,kind){
    if(kind===DOL_KIND_PF)return'pf';
    if(kind===DOL_KIND_ESIC){
      var q=Object.assign({},p,{type:'esic'});
      return dolLooksLikePfInEsic(q)?'pf':'esic'
    }
    var t=text(p&&p.type).toLowerCase(),q2=Object.assign({},p,{type:'esic'});
    if(t==='pf'||dolLooksLikePfInEsic(q2))return'pf';
    return'esic'
  }
  async function migrateLegacyDolCloud(records,candidates){
    if(dolLegacyMigrationPromise)return dolLegacyMigrationPromise;
    dolLegacyMigrationPromise=(async function(){
      var typed={};
      (candidates||[]).forEach(function(p){if(!p||p._dolKind===DOL_KIND_LEGACY)return;var k=dolLogicalKey(p);if(k)typed[p._dolKind+'|'+k]=1});
      var moved=0;
      for(var i=0;i<(candidates||[]).length;i++){
        var p=candidates[i];if(!p||p._dolKind!==DOL_KIND_LEGACY)continue;
        var type=dolRemoteType(p,DOL_KIND_LEGACY),target=dolKind(type),lk=dolLogicalKey(p);if(!lk||typed[target+'|'+lk])continue;
        var cp=Object.assign({},p,{type:type});delete cp._dolKind;delete cp._dolSavedAt;delete cp._cloudVerified;
        cp.id=dolCanonicalId(type,cp)||String(cp.id||'');
        var payload=dolPayload(cp),now=new Date().toISOString();payload.type=type;payload.id=cp.id;payload.cloudConfirmedAt=payload.cloudConfirmedAt||now;
        try{
          await saveObject(target,payload.id,payload,{name:type+' · '+(payload.name||payload.id),saved_at:payload.updatedAt||payload.uploadedAt||now});
          typed[target+'|'+lk]=1;moved++
        }catch(e){console.warn('Legacy DOL typed migration failed',payload&&payload.name,e)}
        if(i%3===2)await new Promise(function(r){setTimeout(r,0)})
      }
      return moved
    })().finally(function(){dolLegacyMigrationPromise=null});
    return dolLegacyMigrationPromise
  }
  async function syncDol(records){
    // V1 local DOL cache is compatibility-only now. The V2 module owns cloud sync.
    // Never auto-push legacy local rows: that was able to resurrect old PF-as-ESIC records.
    return true
  }

  function sameDolPayload(a,b){
    if(!a||!b)return false;
    if(String(a.id||'')!==String(b.id||'')||String(a.type||'')!==String(b.type||'')||String(a.period||'')!==String(b.period||''))return false;
    if(String(a.fileHash||'')&&String(b.fileHash||''))return String(a.fileHash)===String(b.fileHash);
    if(String(a.fingerprint||'')&&String(b.fingerprint||''))return String(a.fingerprint)===String(b.fingerprint);
    return JSON.stringify(Array.isArray(a.digitIds)?a.digitIds:[])===JSON.stringify(Array.isArray(b.digitIds)?b.digitIds:[])&&JSON.stringify(Array.isArray(a.alnumIds)?a.alnumIds:[])===JSON.stringify(Array.isArray(b.alnumIds)?b.alnumIds:[]);
  }
  async function getComplianceDolRecords(type){
    if(!token()||!session())throw new Error('Valid login required for challan cloud access');
    type=String(type||'').toLowerCase();if(type!=='esic'&&type!=='pf')throw new Error('Invalid challan type');
    var records=await fetchRemote(),metas=records.filter(function(r){return r&&r._atpl_kind==='meta'&&dolAllowedKind(r.object_kind)}),candidates=[];
    for(var i=0;i<metas.length;i++){
      var m=metas[i];
      try{
        var p=await loadObject(records,m);if(!p||!p.id)continue;
        p.type=dolRemoteType(p,m.object_kind);
        p.buffer=null;p.cloudConfirmedAt=p.cloudConfirmedAt||m.saved_at||m.uploaded_at||new Date().toISOString();p._cloudVerified=true;p._dolKind=m.object_kind;p._dolSavedAt=m.saved_at||m.uploaded_at||'';
        candidates.push(p)
      }catch(e){console.warn('Compliance challan cloud read failed',m&&m.key_text,e)}
    }
    await migrateLegacyDolCloud(records,candidates);
    var pfKeys={};
    candidates.forEach(function(p){if(p&&p.type==='pf'){var k=dolLogicalKey(p);if(k)pfKeys[k]=1}});
    var best={};
    candidates.forEach(function(p){
      if(!p||p.type!==type)return;
      var key=dolLogicalKey(p)||('id:'+String(p.id||''));
      if(type==='esic'&&key&&pfKeys[key])return;
      var score=p._dolKind===dolKind(type)?3:(p._dolKind===DOL_KIND_LEGACY?1:0),old=best[key],oldScore=old?(old._dolKind===dolKind(type)?3:(old._dolKind===DOL_KIND_LEGACY?1:0)):-1;
      if(!old||score>oldScore||(score===oldScore&&ms(p._dolSavedAt)>ms(old._dolSavedAt)))best[key]=p
    });
    return Object.keys(best).map(function(k){var p=best[k];delete p._dolKind;delete p._dolSavedAt;return p})
  }

  async function saveComplianceDolConfirmed(rec){
    if(!token()||!session())throw new Error('Valid login required for challan save');
    if(!rec||!rec.id||!rec.type)throw new Error('Invalid challan record');
    if(dolLooksLikePfInEsic(rec))throw new Error('PF challan cannot be saved inside ESIC');
    rec.type=String(rec.type||'').toLowerCase();if(rec.type!=='esic'&&rec.type!=='pf')throw new Error('Invalid challan type');
    var kind=dolKind(rec.type),p=dolPayload(rec),now=new Date().toISOString();p.cloudConfirmedAt=now;
    await saveObject(kind,p.id,p,{name:(p.type||'')+' · '+(p.name||p.id),saved_at:p.updatedAt||p.uploadedAt||now});
    var records=await fetchRemote(),meta=records.filter(function(r){return r&&r._atpl_kind==='meta'&&r.object_kind===kind&&String(r.key_text||'')===String(p.id)}).sort(function(a,b){return ms(b.saved_at||b.uploaded_at)-ms(a.saved_at||a.uploaded_at)})[0];
    if(!meta)throw new Error('Backend save not found during read-back');
    var back=await loadObject(records,meta);
    if(!sameDolPayload(p,back))throw new Error('Backend read-back mismatch for challan');
    back.buffer=null;back.cloudConfirmedAt=back.cloudConfirmedAt||now;back._cloudVerified=true;
    await putDol(Object.assign({},rec,back,{buffer:rec.buffer||null}));
    return back
  }

  async function saveComplianceDolBatchConfirmed(list){
    if(!token()||!session())throw new Error('Valid login required for challan save');
    list=Array.isArray(list)?list.filter(function(r){return r&&r.id&&['esic','pf'].indexOf(String(r.type||'').toLowerCase())>=0}):[];
    if(!list.length)return{ok:true,saved:0,failed:0,results:[]};
    if(list.some(dolLooksLikePfInEsic))throw new Error('PF challan cannot be saved inside ESIC');
    var localExisting=await dolRows(),localById={};localExisting.forEach(function(r){if(r&&r.id)localById[String(r.id)]=r});
    var prepared=list.map(function(rec){rec=Object.assign({},rec,{type:String(rec.type||'').toLowerCase()});var p=dolPayload(rec),now=new Date().toISOString(),kind=dolKind(rec.type);p.cloudConfirmedAt=now;return{rec:rec,p:p,kind:kind,now:now,error:''}}),at=0;
    async function worker(){
      while(true){
        var i=at++;if(i>=prepared.length)return;var x=prepared[i];
        try{await saveObject(x.kind,x.p.id,x.p,{name:(x.p.type||'')+' · '+(x.p.name||x.p.id),saved_at:x.p.updatedAt||x.p.uploadedAt||x.now})}
        catch(e){x.error=e&&e.message?e.message:String(e)}
      }
    }
    var ws=[];for(var w=0;w<Math.min(2,prepared.length);w++)ws.push(worker());await Promise.all(ws);
    var remote;try{remote=await fetchRemote()}catch(e){remote=[];prepared.forEach(function(x){if(!x.error)x.error='Backend read-back failed: '+(e&&e.message?e.message:e)})}
    var metas={};remote.forEach(function(r){if(r&&r._atpl_kind==='meta'&&dolAllowedKind(r.object_kind))metas[String(r.object_kind)+'|'+String(r.key_text||'')]=r});
    var out=[];
    for(var j=0;j<prepared.length;j++){
      var x=prepared[j];
      if(x.error){out.push({ok:false,error:x.error,record:x.rec});continue}
      try{
        var meta=metas[x.kind+'|'+String(x.p.id||'')];if(!meta)throw new Error('Backend save not found during read-back');
        var back=await loadObject(remote,meta);if(!sameDolPayload(x.p,back))throw new Error('Backend read-back mismatch for challan');
        back.buffer=null;back.cloudConfirmedAt=back.cloudConfirmedAt||x.now;back._cloudVerified=true;
        var oldLocal=localById[String(x.rec.id)]||{};await putDol(Object.assign({},oldLocal,x.rec,back,{buffer:x.rec.buffer||oldLocal.buffer||null,viewerSheets:x.rec.viewerSheets||oldLocal.viewerSheets||null}));
        out.push({ok:true,record:back})
      }catch(e2){out.push({ok:false,error:e2&&e2.message?e2.message:String(e2),record:x.rec})}
    }
    var saved=out.filter(function(x){return x.ok}).length;
    return{ok:saved===out.length,saved:saved,failed:out.length-saved,results:out}
  }

  async function deleteComplianceDolBatchConfirmed(ids){
    if(!token()||!session())throw new Error('Valid login required for challan delete');
    ids=Array.from(new Set((ids||[]).map(String).filter(Boolean)));if(!ids.length)return{ok:true,deleted:0,failed:0,results:[]};
    var records=await fetchRemote(),targets=[];
    ids.forEach(function(id){
      var metas=records.filter(function(r){return r&&r._atpl_kind==='meta'&&dolAllowedKind(r.object_kind)&&String(r.key_text||'')===id}),remoteIds=[];
      metas.forEach(function(m){records.forEach(function(r){if(r&&r.object_key===m.object_key&&r.emp_id)remoteIds.push(String(r.emp_id))})});
      remoteIds=Array.from(new Set(remoteIds)).sort(function(a,b){return a.indexOf('__META__')>=0?1:b.indexOf('__META__')>=0?-1:0});
      targets.push({id:id,remoteIds:remoteIds})
    });
    var results=[];
    for(var i=0;i<targets.length;i++){
      var t=targets[i],err='';
      try{for(var j=0;j<t.remoteIds.length;j++)await removeRemote(t.remoteIds[j]);await deleteDolLocal(t.id)}
      catch(e){err=e&&e.message?e.message:String(e)}
      results.push({id:t.id,ok:!err,error:err})
    }
    var verify=await fetchRemote(),left={};verify.forEach(function(r){if(r&&r._atpl_kind==='meta'&&dolAllowedKind(r.object_kind)&&ids.indexOf(String(r.key_text||''))>=0)left[String(r.key_text||'')]=1});
    results.forEach(function(x){if(x.ok&&left[x.id]){x.ok=false;x.error='Backend delete verification failed'}});
    var deleted=results.filter(function(x){return x.ok}).length;return{ok:deleted===results.length,deleted:deleted,failed:results.length-deleted,results:results}
  }
  async function deleteComplianceDolConfirmed(id){var r=await deleteComplianceDolBatchConfirmed([id]);if(!r.ok)throw new Error(r.results&&r.results[0]&&r.results[0].error||'Challan delete failed');return true}

  function displayCell(cell){if(!cell)return'';if(cell.w!=null)return String(cell.w);if(cell.v==null)return'';if(cell.v instanceof Date)return cell.v.toISOString();return String(cell.v)}
  function writeCellValue(ws,R,C,val){var addr=root.XLSX.utils.encode_cell({r:R,c:C}),cell=ws[addr]||{},s=String(val==null?'':val),cur=displayCell(cell);if(cur===s)return false;if(s===''){if(cell&&cell.f)delete cell.f;cell.t='s';cell.v='';cell.w='';ws[addr]=cell;return true}if(cell&&cell.f)delete cell.f;var num=Number(String(s).replace(/,/g,''));if(s!==''&&isFinite(num)&&/^[-+]?\d+(?:\.\d+)?$/.test(s)&&!(s.length>1&&s[0]==='0')){cell.t='n';cell.v=num;delete cell.w}else{cell.t='s';cell.v=s;cell.w=s}ws[addr]=cell;return true}
  function syncSheetsIntoWorkbook(f){if(!f||!f.wb||!f.sheets||!root.XLSX)return 0;var changes=0;f.wb.SheetNames.forEach(function(sn){var ws=f.wb.Sheets[sn],rows=f.sheets[sn]||[];if(!ws)return;for(var R=0;R<rows.length;R++){var row=rows[R]||[];for(var C=0;C<row.length;C++)if(writeCellValue(ws,R,C,row[C]))changes++}});return changes}
  function idle(){return new Promise(function(resolve){try{if(typeof root.requestIdleCallback==='function')root.requestIdleCallback(function(){resolve()},{timeout:700});else root.setTimeout(resolve,30)}catch(_){root.setTimeout(resolve,30)}})}
  async function persistFileIndex(fi){
    try{
      if(!Array.isArray(root.FILES)||!root.XLSX||typeof root.saveFileToDB!=='function')return false;
      fi=Number(fi);var f=root.FILES[fi];if(!f||!f.wb)return false;
      await idle();
      syncSheetsIntoWorkbook(f);
      var buf=root.XLSX.write(f.wb,{bookType:'xlsx',type:'array',compression:true});
      f.buf=buf;f.savedAt=new Date().toISOString();
      return await new Promise(function(resolve){root.saveFileToDB(f.name,buf,function(){resolve(true)})});
    }catch(e){console.warn('Durable changed-file autosave skipped',fi,e);return false}
  }
  function queueFileIndices(indices){
    (indices||[]).forEach(function(i){i=Number(i);if(isFinite(i)&&i>=0)fileSaveQueue[i]=1});
    if(fileSaveTimer)root.clearTimeout(fileSaveTimer);
    fileSaveTimer=root.setTimeout(flushFileQueue,1800);
  }
  async function flushFileQueue(){
    if(fileSaveRunning)return;
    fileSaveRunning=true;fileSaveTimer=0;
    try{
      var ids=Object.keys(fileSaveQueue).map(Number).sort(function(a,b){return a-b});fileSaveQueue={};
      for(var i=0;i<ids.length;i++){await persistFileIndex(ids[i]);await idle()}
    }finally{
      fileSaveRunning=false;
      if(Object.keys(fileSaveQueue).length)fileSaveTimer=root.setTimeout(flushFileQueue,1200);
    }
  }
  async function persistAllFiles(){
    if(!Array.isArray(root.FILES))return false;
    queueFileIndices(root.FILES.map(function(_,i){return i}));
    return true;
  }
  function wrapMutation(name){
    try{
      var fn=root[name];if(typeof fn!=='function'||fn.__atplDurableWrapped)return;
      function w(){
        var args=Array.prototype.slice.call(arguments),r=fn.apply(this,args);
        if(name==='saveInlineEdits'&&isFinite(Number(args[0])))queueFileIndices([Number(args[0])]);
        else if((name==='cmdFillTime'||name==='cmdFillCol')&&Array.isArray(root.FILES))queueFileIndices(root.FILES.map(function(_,i){return i}));
        return r;
      }
      w.__atplDurableWrapped=true;w.__original=fn;root[name]=w;
    }catch(_){}
  }
  function hookMutations(){['saveInlineEdits','cmdFillTime','cmdFillCol'].forEach(wrapMutation)}

  function badge(msg,bad){try{var id='atplDurableEverythingBadge',b=root.document.getElementById(id);if(!b){var h=root.document.querySelector('.header-right');if(!h)return;b=root.document.createElement('span');b.id=id;b.style.cssText='display:inline-flex;font-size:9px;padding:4px 7px;border-radius:999px;font-weight:800;border:1px solid #a7f3d0;background:#ecfdf5;color:#047857';h.appendChild(b)}b.textContent=msg||'☁ Auto-Save ON';if(bad){b.style.background='#fef2f2';b.style.color='#b91c1c';b.style.borderColor='#fecaca'}else{b.style.background='#ecfdf5';b.style.color='#047857';b.style.borderColor='#a7f3d0'}}catch(_){}}
  function schedule(ms){if(pending)return;pending=true;setTimeout(function(){pending=false;run(false)},ms||500)}
  async function run(force){if(running||!token()||!session())return false;if(!force&&Date.now()-lastRun<7000)return false;running=true;lastRun=Date.now();badge('☁ Auto-Save Syncing');try{hookMutations();var records=await fetchRemote();await syncState(records);await syncBank(records);await syncDol(records);try{if(root.ATPLCloudSharedStorageV1&&typeof root.ATPLCloudSharedStorageV1.syncNow==='function')await root.ATPLCloudSharedStorageV1.syncNow()}catch(_){}try{if(root.ATPLCloudSyncV1&&typeof root.ATPLCloudSyncV1.pullMaster==='function')await root.ATPLCloudSyncV1.pullMaster()}catch(_){}badge('☁ Auto-Save ON');return true}catch(e){console.warn('Durable Everything sync issue',e);badge('☁ Auto-Save Retry',true);return false}finally{running=false}}

  function boot(){patchLocalStorage();hookMutations();badge('☁ Auto-Save Ready');setTimeout(function(){run(true)},2200);root.addEventListener('online',function(){setTimeout(function(){run(true)},200)});root.addEventListener('focus',function(){run(false)});root.document.addEventListener('visibilitychange',function(){if(!root.document.hidden)run(false)});root.document.addEventListener('atpl-compliance-dol-local-change',function(){setTimeout(function(){run(true)},300)});root.document.addEventListener('click',function(e){var x=e.target&&e.target.closest?e.target.closest('#uaLoginBtn,#vn-empmaster,#vn-mamsalary,#vn-sync,#vn-hrdocs,#vn-bankverify'):null;if(x)setTimeout(function(){run(true)},500)},true);root.document.addEventListener('change',function(e){var x=e.target;if(!x)return;if(x.id==='bavSaveRefInput'||x.hasAttribute&&x.hasAttribute('data-ref-select'))setTimeout(function(){run(true)},1200)},true);setInterval(function(){if(!root.document.hidden)run(false)},90000);setInterval(hookMutations,5000)}

  root.ATPLDurableEverythingV1={sync:function(){return run(true)},persistFiles:persistAllFiles,persistFile:persistFileIndex,saveComplianceDolConfirmed:saveComplianceDolConfirmed,saveComplianceDolBatchConfirmed:saveComplianceDolBatchConfirmed,deleteComplianceDolConfirmed:deleteComplianceDolConfirmed,deleteComplianceDolBatchConfirmed:deleteComplianceDolBatchConfirmed,getComplianceDolRecords:getComplianceDolRecords,status:function(){return{token:!!token(),session:!!session(),lastRun:lastRun,running:running,pendingFiles:Object.keys(fileSaveQueue).length}}};
  if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})(window);
