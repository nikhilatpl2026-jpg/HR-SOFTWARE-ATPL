/* ATPL ERP Cloud Shared Storage V1
   Cross-user/device sharing for Salary/Mam saved workbooks and HR Document records.
   Powered by Firebase Firestore Real-Time Cloud Engine + Resilient Local Fallback. */
(function(root){'use strict';
 // Request non-evictable persistent browser storage
 if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.persist) {
   navigator.storage.persist().then(function(persistent) {
     if (persistent) console.log('[ATPL-Storage] Browser granted permanent non-evictable storage protection.');
   }).catch(function(){});
 }
 var BUILD='2026.09.28-permanent-cross-browser-delete-v2';
 if(!root||root.__ATPL_CLOUD_SHARED_STORAGE_V1__===BUILD)return;root.__ATPL_CLOUD_SHARED_STORAGE_V1__=BUILD;
 var API='https://script.google.com/macros/s/AKfycby99_893hVtbWOQr67ikxIwiq81MWW8JAa2LuxTu67JBxjQ_iWb-YkqhBmW0RrHU512SQ/exec';
 var TOKEN='ATPL_RemoteToken_V1',ALT='ATPL_SharedToken_V1',SESS='ATPL_UserSession_V5',SYS='__ATPL_SYS__';
 var SALARY_DB='AroraTextiles',SALARY_VER=1,SALARY_STORE='salaryFiles';
 var HR_DB='AroraTextilesHRDocs',HR_VER=1,HR_STORE='documents';
 var CHUNK=900,MAX_CHUNKS=450,CONCURRENCY=3,lastPull=0,pulling=null,remoteRecords=[];
 var TOMB_STORAGE_KEY='ATPL_SALARY_TOMBSTONES_V2',HR_TOMB_KEY='ATPL_HR_TOMBSTONES_V2';
 var firebaseUnsubscribe=null;
 var sharedSalaryAuthority=(!root.ATPLFirebase||!!root.__atplFirebaseQuotaExhausted)&&!!(root.location && /(^|\.)github\.io$/i.test(root.location.hostname));
 var salarySyncFlight=null, salarySyncAt=0, salaryWriteFlight=null;
 var SALARY_OUTBOX='ATPL_SALARY_OUTBOX_V1', SALARY_CLEAR_KEY='__ALL_SALARY__';


 function text(v){return v==null?'':String(v).trim()}
 function J(v,d){try{return JSON.parse(v)}catch(_){return d}}
 function token(){try{return root.sessionStorage.getItem(TOKEN)||root.sessionStorage.getItem(ALT)||root.localStorage.getItem(TOKEN)||root.localStorage.getItem(ALT)||''}catch(_){return''}}
 function user(){try{var s=J(root.sessionStorage.getItem(SESS)||root.localStorage.getItem(SESS)||'null',null);return s&&s.id?{id:String(s.id),name:String(s.name||s.id)}:null}catch(_){return null}}
 function api(params,timeout){if(root.ATPLCloudAPI)return root.ATPLCloudAPI.request(params,{timeout:timeout,source:'shared-files',cacheMs:params&&params.action==='getSystemRecords'?0:undefined});return new Promise(function(resolve,reject){var cb='__atpl_store_'+Date.now()+'_'+Math.random().toString(36).slice(2),s=root.document.createElement('script'),done=false,t=setTimeout(function(){finish();reject(new Error('Shared storage timeout'))},timeout||18000);function finish(){if(done)return;done=true;clearTimeout(t);try{delete root[cb]}catch(_){root[cb]=undefined}if(s.parentNode)s.parentNode.removeChild(s)}root[cb]=function(data){finish();resolve(data||{})};params=Object.assign({},params||{},{callback:cb,_ts:Date.now()});var qs=Object.keys(params).map(function(k){return encodeURIComponent(k)+'='+encodeURIComponent(params[k]==null?'':String(params[k]))}).join('&');s.onerror=function(){finish();reject(new Error('Shared storage connect failed'))};s.async=true;s.src=API+'?'+qs;(root.document.head||root.document.documentElement).appendChild(s)})}
 function fnv(s){var h=2166136261;for(var i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}return('00000000'+(h>>>0).toString(16)).slice(-8)}
 function safeKey(kind,key){return kind.slice(0,2).toUpperCase()+'_'+fnv(String(key||'').toLowerCase())}
 function metaId(k){return SYS+'META__'+k}
 function chunkId(k,i){return SYS+'CHUNK__'+k+'__'+('000'+i.toString(36)).slice(-3)}
 function tombId(k){return SYS+'TOMB__'+k}
 function bytesToB64(bytes){
  if(!bytes)return '';
  var u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  var out='',step=0x4000;
  for(var i=0;i<u8.length;i+=step)
    out+=String.fromCharCode.apply(null,u8.subarray(i,Math.min(u8.length,i+step)));
  return btoa(out);
 }
 function b64ToBytes(s){var bin=atob(s),a=new Uint8Array(bin.length);for(var i=0;i<bin.length;i++)a[i]=bin.charCodeAt(i);return a}
 function bufToB64(buf){if(!buf)return '';if(typeof buf==='string')return buf;return bytesToB64(buf)}
 function b64ToBuf(s){if(!s||typeof s!=='string')return null;return b64ToBytes(s).buffer}
 async function encodeObject(obj){var raw=new TextEncoder().encode(JSON.stringify(obj)),bytes=raw,encoding='utf8-base64';if(typeof root.CompressionStream==='function'){try{var cs=new root.CompressionStream('gzip'),ab=await new Response(new Blob([raw]).stream().pipeThrough(cs)).arrayBuffer();bytes=new Uint8Array(ab);encoding='gzip-base64'}catch(_){}}return{encoding:encoding,data:bytesToB64(bytes),rawBytes:raw.length,packedBytes:bytes.length}}
 async function decodeObject(encoding,data){var bytes=b64ToBytes(data);if(encoding==='gzip-base64'){if(typeof root.DecompressionStream==='function'){var ds=new root.DecompressionStream('gzip'),ab=await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer();bytes=new Uint8Array(ab)}else if(root.pako&&typeof root.pako.ungzip==='function')bytes=root.pako.ungzip(bytes);else throw new Error('GZIP decoder unavailable on this browser')}return JSON.parse(new TextDecoder().decode(bytes))}
 async function upsert(id,record,attempt){var tk=token();if(!tk)throw new Error('Login token missing');var d=await api({action:'upsertEmployeeMaster',token:tk,emp_id:id,record_json:JSON.stringify(Object.assign({emp_id:id,_atpl_system:true},record))},20000);if(d&&d.ok)return true;if(!attempt){await new Promise(function(r){setTimeout(r,700)});return upsert(id,record,1)}throw new Error(d&&d.error||'Cloud record save failed')}
 async function remove(id){var tk=token();if(!tk)return false;try{var d=await api({action:'deleteEmployeeMaster',token:tk,emp_id:id},16000);return !!(d&&d.ok)}catch(_){return false}}
 async function pool(tasks,limit){var at=0,failed=null;async function worker(){while(!failed){var i=at++;if(i>=tasks.length)return;try{await tasks[i]()}catch(e){failed=e;return}}}var ws=[];for(var n=0;n<Math.min(limit,tasks.length);n++)ws.push(worker());await Promise.all(ws);if(failed)throw failed}
 function setBadge(state,msg){try{if(typeof root.updateRealtimeCloudBadge==='function'){var count=Array.isArray(root.FILES)?root.FILES.length:0;root.updateRealtimeCloudBadge(count,state==='busy'?'syncing':state==='bad'?'error':'ok',msg);return}var id='atplCloudFilesBadge',b=root.document.getElementById(id);if(!b){var h=root.document.querySelector('.header-right');if(!h)return;b=root.document.createElement('span');b.id=id;b.style.cssText='display:inline-flex;font-size:10px;padding:4px 9px;border-radius:999px;font-weight:700;border:1px solid #a7f3d0;background:#ecfdf5;color:#047857';h.appendChild(b)}var cnt=Array.isArray(root.FILES)?root.FILES.length:0;b.textContent=msg||('☁️ Realtime Cloud ('+cnt+' files)');if(state==='bad'){b.style.background='#fef2f2';b.style.color='#b91c1c';b.style.borderColor='#fecaca'}else if(state==='busy'){b.style.background='#fff7ed';b.style.color='#c2410c';b.style.borderColor='#fed7aa'}else{b.style.background='#ecfdf5';b.style.color='#047857';b.style.borderColor='#a7f3d0'}}catch(_){}}
 function storageLabel(msg){try{var x=root.document.getElementById('storageLbl');if(x&&msg)x.textContent=msg}catch(_){}}
 function isSystem(r){return !!r&&(r._atpl_system===true||text(r.emp_id).indexOf(SYS)===0)}
 async function fetchRemote(force){if(!token())return[];if(!force&&remoteRecords.length&&Date.now()-lastPull<10000)return remoteRecords.slice();var d;try{d=await api({action:'getSystemRecords',token:token()},14000);if(d&&d.ok&&Array.isArray(d.records)){remoteRecords=d.records;lastPull=Date.now();return remoteRecords.slice()}}catch(_){}d=await api({action:'getEmployeeMaster',token:token()},22000);if(!(d&&d.ok&&Array.isArray(d.records)))throw new Error(d&&d.error||'Shared records unavailable');remoteRecords=d.records.filter(isSystem);lastPull=Date.now();return remoteRecords.slice()}
 function recordsFor(records,key){var meta=null,chunks={};(records||[]).forEach(function(r){if(r&&r.object_key===key&&r._atpl_kind==='meta')meta=r;else if(r&&r.object_key===key&&r._atpl_kind==='chunk')chunks[Number(r.index)]=String(r.data||'')});return{meta:meta,chunks:chunks}}
 async function saveObject(kind,key,payload,info){var packed=await encodeObject(payload),parts=[];for(var i=0;i<packed.data.length;i+=CHUNK)parts.push(packed.data.slice(i,i+CHUNK));if(parts.length>MAX_CHUNKS)throw new Error('Cloud copy is too large for current shared bridge ('+parts.length+' chunks).');var k=safeKey(kind,key),u=user()||{},tasks=parts.map(function(part,idx){return function(){return upsert(chunkId(k,idx),{_atpl_kind:'chunk',object_kind:kind,object_key:k,index:idx,data:part})}});setBadge('busy','☁ Saving '+text(info&&info.name||kind)+'…');await pool(tasks,CONCURRENCY);var now=new Date().toISOString();await upsert(metaId(k),{_atpl_kind:'meta',object_kind:kind,object_key:k,key_text:String(key||''),name:text(info&&info.name||key),saved_at:text(info&&info.saved_at||now)||now,uploaded_at:now,uploaded_by:u.id||'',uploaded_name:u.name||'',encoding:packed.encoding,chunks:parts.length,raw_bytes:packed.rawBytes,packed_bytes:packed.packedBytes});remoteRecords=[];lastPull=0;setBadge('ok','🔥 Firebase Live');return true}
 async function loadObject(records,meta){if(!meta||!meta.object_key)return null;var x=recordsFor(records.filter(function(r){return r._atpl_kind!=='chunk'||String(r.generation||'')===String(meta.generation||'')}),meta.object_key),n=Number(meta.chunks||0),parts=[];for(var i=0;i<n;i++){if(typeof x.chunks[i]!=='string')throw new Error('Incomplete cloud object '+meta.name);parts.push(x.chunks[i])}return decodeObject(meta.encoding,parts.join(''))}
 function trimRows(rows){rows=(rows||[]).map(function(r){r=Array.isArray(r)?r.slice():[];while(r.length&&String(r[r.length-1]==null?'':r[r.length-1]).trim()==='')r.pop();return r});while(rows.length&&(!rows[rows.length-1]||!rows[rows.length-1].some(function(v){return String(v==null?'':v).trim()!==''})))rows.pop();return rows}
 function workbookPayload(name,buf){if(!root.XLSX)throw new Error('Excel engine unavailable');var wb=root.XLSX.read(buf,{type:'array',cellDates:false,cellText:true});return{v:1,name:name,sheets:wb.SheetNames.map(function(sn){var rows=root.XLSX.utils.sheet_to_json(wb.Sheets[sn],{header:1,raw:false,defval:''});return{name:sn,rows:trimRows(rows)}})}}
 function payloadBuffer(p){if(p&&p.original_b64)return b64ToBuf(p.original_b64);if(!root.XLSX||!p||!Array.isArray(p.sheets))throw new Error('Shared workbook invalid');var wb=root.XLSX.utils.book_new();p.sheets.forEach(function(s){var ws=root.XLSX.utils.aoa_to_sheet(Array.isArray(s.rows)?s.rows:[]);root.XLSX.utils.book_append_sheet(wb,ws,String(s.name||'Sheet').slice(0,31)||'Sheet')});return root.XLSX.write(wb,{bookType:'xlsx',type:'array',compression:true})}
 function openDb(name,ver,store,keyPath){return new Promise(function(ok,no){try{var r=indexedDB.open(name,ver);r.onupgradeneeded=function(){if(!r.result.objectStoreNames.contains(store))r.result.createObjectStore(store,keyPath?{keyPath:keyPath}:undefined)};r.onsuccess=function(){ok(r.result)};r.onerror=function(){no(r.error)}}catch(e){no(e)}})}
 async function salaryRows(){try{var d=await openDb(SALARY_DB,SALARY_VER,SALARY_STORE,'name');return await new Promise(function(ok){var r=d.transaction(SALARY_STORE,'readonly').objectStore(SALARY_STORE).getAll();r.onsuccess=function(){d.close();ok(r.result||[])};r.onerror=function(){d.close();ok([])}})}catch(_){return[]}}
 function salaryRestoreAllowed(name,saved){
   return typeof root.atplSalaryRestoreAllowed==='function' && root.atplSalaryRestoreAllowed(name,saved);
 }
 async function putSalary(name,buf,saved){
    if(!salaryRestoreAllowed(name,saved))return false;
    var actualBuf = buf;
    if(typeof buf==='string'){
      try{
        var dec=b64ToBuf(buf);
        if(dec)actualBuf=dec;
      }catch(_){}
    }
    var d=await openDb(SALARY_DB,SALARY_VER,SALARY_STORE,'name');
    if(!salaryRestoreAllowed(name,saved)){d.close();return false;}
    return new Promise(function(ok,no){
      var t=d.transaction(SALARY_STORE,'readwrite');
      t.objectStore(SALARY_STORE).put({name:name,buf:actualBuf,saved:saved||new Date().toISOString()});
      t.oncomplete=function(){d.close();ok(true)};
      t.onerror=function(){var e=t.error;d.close();no(e)}
    });
  }
 async function deleteSalaryFromDb(name){try{var d=await openDb(SALARY_DB,SALARY_VER,SALARY_STORE,'name');return new Promise(function(ok){var t=d.transaction(SALARY_STORE,'readwrite');t.objectStore(SALARY_STORE).delete(name);t.oncomplete=function(){d.close();ok(true)};t.onerror=function(){d.close();ok(false)}})}catch(_){return false}}
 async function clearSalaryDb(){
   try{
     var d=await openDb(SALARY_DB,SALARY_VER,SALARY_STORE,'name');
     return new Promise(function(ok){
       var t=d.transaction(SALARY_STORE,'readwrite');
       t.objectStore(SALARY_STORE).clear();
       t.oncomplete=function(){d.close();ok(true)};
       t.onerror=function(){d.close();ok(false)};
     });
   }catch(_){return false}
 }
 async function hrRows(){try{var d=await openDb(HR_DB,HR_VER,HR_STORE,'id');return await new Promise(function(ok){var r=d.transaction(HR_STORE,'readonly').objectStore(HR_STORE).getAll();r.onsuccess=function(){d.close();ok(r.result||[])};r.onerror=function(){d.close();ok([])}})}catch(_){return[]}}
 async function putHrDoc(doc){var d=await openDb(HR_DB,HR_VER,HR_STORE,'id');return new Promise(function(ok,no){var t=d.transaction(HR_STORE,'readwrite');t.objectStore(HR_STORE).put(doc);t.oncomplete=function(){d.close();ok(true)};t.onerror=function(){var e=t.error;d.close();no(e)}})}
 async function deleteHrDocFromDb(id){try{var d=await openDb(HR_DB,HR_VER,HR_STORE,'id');return new Promise(function(ok){var t=d.transaction(HR_STORE,'readwrite');t.objectStore(HR_STORE).delete(id);t.oncomplete=function(){d.close();ok(true)};t.onerror=function(){d.close();ok(false)}})}catch(_){return false}}
 function dateMs(v){var n=Date.parse(v||'');return isFinite(n)?n:0}

 function getLocalSalaryTombstones(){return J(root.localStorage.getItem(TOMB_STORAGE_KEY)||'{}',{})}
 function saveLocalSalaryTombstone(name){var t=getLocalSalaryTombstones();t[String(name).toLowerCase()]=new Date().toISOString();root.localStorage.setItem(TOMB_STORAGE_KEY,JSON.stringify(t))}
 function clearLocalSalaryTombstone(name){var t=getLocalSalaryTombstones();delete t[String(name).toLowerCase()];root.localStorage.setItem(TOMB_STORAGE_KEY,JSON.stringify(t))}

 function getLocalHrTombstones(){return J(root.localStorage.getItem(HR_TOMB_KEY)||'{}',{})}
 function saveLocalHrTombstone(id){var t=getLocalHrTombstones();t[String(id).toLowerCase()]=new Date().toISOString();root.localStorage.setItem(HR_TOMB_KEY,JSON.stringify(t))}
 function clearLocalHrTombstone(id){var t=getLocalHrTombstones();delete t[String(id).toLowerCase()];root.localStorage.setItem(HR_TOMB_KEY,JSON.stringify(t))}

 async function pullSalary(records){
   var localTombs=getLocalSalaryTombstones(),tombstones={};
   (records||[]).forEach(function(r){
     if(r&&(r._atpl_kind==='tombstone'||r.object_kind==='salary_file_tombstone'||(r.object_kind==='salary_file'&&r.deleted===true))){
       var k=String(r.key_text||r.name||'').toLowerCase();if(k)tombstones[k]=r.deleted_at||true;
     }
   });
   Object.keys(localTombs).forEach(function(k){if(localTombs[k])tombstones[k.toLowerCase()]=localTombs[k]});

   var metas=(records||[]).filter(function(r){return r&&r._atpl_kind==='meta'&&r.object_kind==='salary_file'&&r.deleted!==true}),remoteBy={};
   metas.forEach(function(m){var k=String(m.name||m.key_text||'').toLowerCase();if(!tombstones[k])remoteBy[k]=m});

   var local=await salaryRows(),changed=0;
   var allowAutoCrossBrowserDelete=true; // PERMANENT FIX: Admin delete must purge on ALL browsers
   for(var j=0;j<local.length;j++){
     var row=local[j],lk=String(row.name||'').toLowerCase();
     var tombVal=tombstones[lk];
     var tombTime=typeof tombVal==='string'?dateMs(tombVal):(tombVal===true?Infinity:0);
     var fileTime=dateMs(row.saved);
     var isTomb=tombTime>fileTime;
     var isMissing=false; // Protected against accidental wipe
     if(allowAutoCrossBrowserDelete && (isTomb||isMissing)){
       console.log('[Auto-Delete] Purging removed file locally:',row.name,isTomb?'(tombstone)':'(cloud-removed)');
       await deleteSalaryFromDb(row.name);
       if(Array.isArray(root.FILES)){root.FILES=root.FILES.filter(function(f){return !f||String(f.name||'').toLowerCase()!==lk})}
       changed++;
     }
   }

   // Pull new or updated files from cloud
   var activeKeys=Object.keys(remoteBy);
   for(var i=0;i<activeKeys.length;i++){
     var m=remoteBy[activeKeys[i]],lk=activeKeys[i],old=local.find(function(x){return String(x.name||'').toLowerCase()===lk});
     if(old&&dateMs(old.saved)>=dateMs(m.saved_at))continue;
     try{
       var p=await loadObject(records,m),buf=payloadBuffer(p);
       await putSalary(m.name||p.name,buf,m.saved_at||m.uploaded_at);
       changed++;
     }catch(e){console.warn('Shared salary pull failed',m.name,e)}
   }
   if(changed>0)refreshSalaryUi();
   return changed;
 }

 async function pushSalary(records){
   var localTombs=getLocalSalaryTombstones(),tombstones={};
   (records||[]).forEach(function(r){
     if(r&&(r._atpl_kind==='tombstone'||r.object_kind==='salary_file_tombstone'||(r.object_kind==='salary_file'&&r.deleted===true))){
       var k=String(r.key_text||r.name||'').toLowerCase();if(k)tombstones[k]=true;
     }
   });
   Object.keys(localTombs).forEach(function(k){if(localTombs[k])tombstones[k.toLowerCase()]=true});

   var metas=(records||[]).filter(function(r){return r&&r._atpl_kind==='meta'&&r.object_kind==='salary_file'&&r.deleted!==true}),remoteBy={};
   metas.forEach(function(m){remoteBy[String(m.name||m.key_text||'').toLowerCase()]=m});

   var local=await salaryRows(),pushed=0,failed=0,cloudAuthoritative=(Array.isArray(records)&&records.length>0);
   for(var i=0;i<local.length;i++){
     var row=local[i];if(!row||!row.name||!row.buf||!salaryRestoreAllowed(row.name,row.saved))continue;
     var key=String(row.name).toLowerCase();
     var tombVal=tombstones[key];
     var tombTime=typeof tombVal==='string'?dateMs(tombVal):(tombVal===true?Infinity:0);
     var fileTime=dateMs(row.saved);
     if(tombTime>fileTime){
       console.log('[Auto-Delete] Purging tombstoned local file instead of re-pushing:',row.name);
       await deleteSalaryFromDb(row.name);
       continue;
     }else if(tombVal){
       // Preserve deletion history during background migration.
     }
     var m=remoteBy[key],localTs=dateMs(row.saved),remoteTs=dateMs(m&&m.saved_at);
     if(m&&remoteTs>=localTs)continue;
       try{
       var payload=workbookPayload(row.name,row.buf);
       await saveObject('salary_file',row.name,payload,{name:row.name,saved_at:row.saved||new Date().toISOString()});
       // Preserve deletion history during background migration.
       pushed++;
     }catch(e){failed++;console.warn('Existing local file cloud migration failed',row.name,e)}
     if(i%2===1)await new Promise(function(r){setTimeout(r,0)});
   }
   return{pushed:pushed,failed:failed};
 }

 async function pullHr(records){
   var localTombs=getLocalHrTombstones(),tombstones={};
   (records||[]).forEach(function(r){
     if(r&&(r._atpl_kind==='tombstone'||r.object_kind==='hr_doc_tombstone'||(r.object_kind==='hr_doc'&&r.deleted===true))){
       var k=String(r.key_text||r.id||'').toLowerCase();if(k)tombstones[k]=true;
     }
   });
   Object.keys(localTombs).forEach(function(k){if(localTombs[k])tombstones[k.toLowerCase()]=true});

   var metas=(records||[]).filter(function(r){return r&&r._atpl_kind==='meta'&&r.object_kind==='hr_doc'&&r.deleted!==true}),remoteBy={};
   metas.forEach(function(m){var k=String(m.key_text||m.name||'').toLowerCase();if(!tombstones[k])remoteBy[k]=m});

   var local=await hrRows(),changed=0,cloudAuthoritative=(Array.isArray(records)&&records.length>0);

   for(var j=0;j<local.length;j++){
     var doc=local[j],hk=String(doc.id||'').toLowerCase();
     var isTomb=!!tombstones[hk];
     if(isTomb){
       console.log('[Auto-Delete] Purging tombstoned HR doc:',doc.document_name||doc.id);
       await deleteHrDocFromDb(doc.id);
       changed++;
     }
   }

   for(var i=0;i<metas.length;i++){
     var m=metas[i],old=local.find(function(x){return String(x.id||'').toLowerCase()===String(m.key_text||'').toLowerCase()});
     if(old&&dateMs(old.updated_at)>=dateMs(m.saved_at))continue;
     try{
       var d=await loadObject(records,m);if(!d||!d.id)continue;
       if(d._cloud_attachment_omitted&&old){d.file_data=old.file_data||d.file_data;d.file_data_list=old.file_data_list||d.file_data_list}
       await putHrDoc(d);changed++;
     }catch(e){console.warn('Shared HR document pull failed',m.name,e)}
   }
   if(changed)refreshHrUi();
   return changed;
 }

 var isRefreshingUi=false;
 var lastRefreshTime=0;
 async function refreshSalaryUi(force){
   var allClearedAt = dateMs(root.localStorage.getItem('ATPL_ALL_SALARY_CLEARED_AT'));
   var now=Date.now();
   if(isRefreshingUi) return;
   if(!force && (now - lastRefreshTime < 1200)) return;
   isRefreshingUi = true;
   try{
     var rows = await salaryRows();
     rows = (rows || []).filter(function(r){
       if (!r || !r.name || !r.buf) return false;
       var rTime = dateMs(r.saved);
       if (!salaryRestoreAllowed(r.name,r.saved)) return false;
       return true;
     });
     if(typeof root.parseWB==='function' && typeof root.wbToSheets==='function'){
       var curFiles = Array.isArray(root.FILES) ? root.FILES : [];
       var changed = false;
       var nextFiles = [];
       for(var i=0; i<rows.length; i++){
         var r = rows[i];
         var existing = curFiles.find(function(f){
           return f && f.name === r.name && f.wb && dateMs(f.savedAt) === dateMs(r.saved);
         });
         if(existing){
           nextFiles.push(existing);
         } else if(r.buf){
           changed = true;
           try {
             var wbBuf = r.buf;
             if (typeof wbBuf === 'string') {
               wbBuf = b64ToBuf(wbBuf) || wbBuf;
             }
             var wb = root.parseWB(wbBuf);
             nextFiles.push({name:r.name, wb:wb, sheets:root.wbToSheets(wb), buf:wbBuf, savedAt:r.saved});
           } catch(pe) {
             console.warn('Workbook parse failed for', r.name, pe);
           }
         }
       }
       root.FILES = nextFiles;
       if(changed || curFiles.length !== nextFiles.length || force){
         ['renderFiles','renderSheets','updStats','renderAllFilesPage','populateNJSelects'].forEach(function(n){
           try{ if(typeof root[n]==='function') root[n](); }catch(_){}
         });
       }
       storageLabel(root.FILES.length+' files saved · Realtime Sync');
       var cnt = root.document ? root.document.getElementById('fileCount') : null;
       if(cnt) cnt.textContent = '(' + root.FILES.length + ')';
     }
     if(typeof root.loadAllFromDB==='function'){
       try{ root.loadAllFromDB(function(){}); }catch(_){}
     }
   }catch(e){ console.warn('refreshSalaryUi failed', e); }
   finally{
     isRefreshingUi = false;
     lastRefreshTime = Date.now();
   }
 }

 function refreshHrUi(){
   try{
     var ref=typeof root.hrDocGetDocs==='function'?root.hrDocGetDocs():null;
     if(!Array.isArray(ref))return;
     hrRows().then(function(all){
       all=(all||[]).filter(function(x){return x && x.id});
       ref.splice.apply(ref,[0,ref.length].concat(all));
       if(typeof root.hrDocRender==='function')root.hrDocRender();
       if(typeof root.hrDocCheckAlerts==='function')root.hrDocCheckAlerts(false);
       var b=root.document?root.document.getElementById('hrDocsBadge'):null;
       if(b){
         b.textContent=String(ref.length);
         b.style.display=ref.length>0?'inline-flex':'none';
       }
     });
   }catch(_){}
 }

 /* ==============================================================
    FIREBASE FIRESTORE REALTIME SYNC HANDLERS
    ============================================================== */
 var isHandlingFirebaseFiles=false;
 var lastFirebaseSyncTime=0;
 async function handleFirebaseFilesUpdate(payload){
   if(isHandlingFirebaseFiles)return;
   var now=Date.now();
   if(now-lastFirebaseSyncTime<1200)return;
   isHandlingFirebaseFiles=true;
   try{
     var remoteList=payload.all||[];
     var remoteByName={};
     remoteList.forEach(function(doc){
       if(doc&&doc.name)remoteByName[String(doc.name).toLowerCase()]=doc;
     });
     var local=await salaryRows();
     var changed=0;

     // FIX: merge Firestore-side tombstones BEFORE the Data Safety Guard runs, so a browser that still
     // holds a stale local copy never re-uploads a file that was deleted elsewhere.
     var removedSet={};
     (payload.removedNames||[]).forEach(function(n){removedSet[String(n).toLowerCase()]=true});
     try{
       if(root.ATPLFirebase&&typeof root.ATPLFirebase.fetchAllTombstones==='function'){
         var fbTombs=await root.ATPLFirebase.fetchAllTombstones();
         var mergedTombs=getLocalSalaryTombstones(),touched=false;
         (fbTombs||[]).forEach(function(t){
           if(!t||!t.name)return;
           if(t.name==='__ALL__'){
             var ca=t.cleared_at||t.deleted_at;
             if(ca&&dateMs(ca)>dateMs(root.localStorage.getItem('ATPL_ALL_SALARY_CLEARED_AT'))){try{root.localStorage.setItem('ATPL_ALL_SALARY_CLEARED_AT',ca)}catch(_){}}
             return;
           }
           var tk=String(t.name).toLowerCase(),tv=t.deleted_at||new Date().toISOString();
           if(!mergedTombs[tk]||dateMs(tv)>dateMs(mergedTombs[tk])){mergedTombs[tk]=tv;touched=true}
         });
         if(touched){try{root.localStorage.setItem(TOMB_STORAGE_KEY,JSON.stringify(mergedTombs))}catch(_){}}
       }
     }catch(tombErr){console.warn('Tombstone pre-check warning',tombErr)}

     var tombs=getLocalSalaryTombstones();
      var allClearedAt=dateMs(root.localStorage.getItem('ATPL_ALL_SALARY_CLEARED_AT'));

      for(var j=0;j<local.length;j++){
        var row=local[j];
        var lk=String(row.name||'').toLowerCase();
        var tombVal=tombs[lk];
        var tombTime=typeof tombVal==='string'?dateMs(tombVal):(tombVal===true?Infinity:0);
        var fileTime=dateMs(row.saved);
        var isTomb=tombTime>fileTime;
        var wasCleared=allClearedAt && allClearedAt >= fileTime;
        var isRecentlyUploaded = (Date.now() - fileTime < 15000);

        if(isTomb || wasCleared){
          if (!remoteByName[lk]) {
            console.log('[Firebase Auto-Delete] Purging removed file:',row.name);
            await deleteSalaryFromDb(row.name);
            saveLocalSalaryTombstone(row.name);
            changed++;
          }
        } else if(!isTomb && !wasCleared && !(typeof removedSet !== 'undefined' && removedSet[lk]) && row.buf && !row._inFlight && !remoteByName[lk]){
          console.log('[Data Safety Guard] Auto-backing up local file to Firestore:', row.name);
          cloudSaveSalary(row.name, row.buf, row.saved).catch(function(){});
        }
      }

      // Live cross-browser delete propagation from Firestore removed doc changes
     if(Array.isArray(payload.removedNames) && payload.removedNames.length){
       for(var r=0; r<payload.removedNames.length; r++){
         var remName=payload.removedNames[r];
         var remLk=String(remName).toLowerCase();
         var had=local.some(function(x){return String(x.name||'').toLowerCase()===remLk});
         if(had){
           console.log('[Firebase Cross-Browser Delete] Purging removed file:', remName);
           await deleteSalaryFromDb(remName);
           saveLocalSalaryTombstone(remName);
           changed++;
         }
       }
     }

     // Load or update files from Firebase if remote has newer files
     for(var i=0;i<remoteList.length;i++){
       var doc=remoteList[i];
       if(!doc||!doc.name||(!doc.sheets&&!doc.sheets_b64&&!doc.is_gzip))continue;
       var rk=String(doc.name).toLowerCase();
       var docTime=dateMs(doc.saved_at||doc.uploaded_at);
       if(!salaryRestoreAllowed(doc.name,doc.saved_at||doc.uploaded_at))continue;
       var old=local.find(function(x){return String(x.name||'').toLowerCase()===rk});
       if(old&&dateMs(old.saved)>=docTime&&old.buf)continue;

       try{
         var sheetData=null;
         if(root.ATPLFirebase&&typeof root.ATPLFirebase.decodeDocPayload==='function'){
           sheetData=await root.ATPLFirebase.decodeDocPayload(doc);
         }
         if(!sheetData&&doc.sheets){
           sheetData=typeof doc.sheets==='string'?J(doc.sheets,null):doc.sheets;
         }
         if(sheetData){
           var origB64 = sheetData.original_b64 || (sheetData.payload && sheetData.payload.original_b64) || null;
           var p={v:1,name:doc.name,original_b64:origB64,sheets:Array.isArray(sheetData.sheets)?sheetData.sheets:sheetData};
           var buf = origB64 ? b64ToBuf(origB64) : payloadBuffer(p);
           if(buf){
             await putSalary(doc.name,buf,doc.saved_at||doc.uploaded_at);
             changed++;
           }
         }
       }catch(e){console.warn('Firebase parse buffer warning',doc.name,e)}
     }

     if(changed>0){
       refreshSalaryUi();
     }
     setBadge('ok','🔥 Firebase Live ('+remoteList.length+')');
     storageLabel(remoteList.length+' files in cloud · Realtime');
   }finally{
     isHandlingFirebaseFiles=false;
     lastFirebaseSyncTime=Date.now();
   }
 }

 var firebaseTombUnsubscribe=null;
 var firebaseHrUnsubscribe=null;
 var firebaseHrTombUnsubscribe=null;

 async function handleFirebaseHrUpdate(payload){
   var remoteList=payload.all||[];
   var local=await hrRows(),changed=0;
   var remoteById={};
   remoteList.forEach(function(d){
     if(d&&d.id)remoteById[String(d.id).toLowerCase()]=d;
   });
   // FIX: merge Firestore-side HR tombstones first so a stale local copy is purged, not re-uploaded.
   try{
     if(root.ATPLFirebase&&typeof root.ATPLFirebase.fetchAllHrTombstones==='function'){
       var fbHrT=await root.ATPLFirebase.fetchAllHrTombstones();
       var mergedHr=getLocalHrTombstones(),hrTouched=false;
       (fbHrT||[]).forEach(function(t){
         if(!t||!t.id)return;
         var hk=String(t.id).toLowerCase(),hv=t.deleted_at||new Date().toISOString();
         if(!mergedHr[hk]||dateMs(hv)>dateMs(mergedHr[hk])){mergedHr[hk]=hv;hrTouched=true}
       });
       if(hrTouched){try{root.localStorage.setItem(HR_TOMB_KEY,JSON.stringify(mergedHr))}catch(_){}}
     }
   }catch(hrTombErr){console.warn('HR tombstone pre-check warning',hrTombErr)}
   for(var j=0;j<local.length;j++){
      var doc=local[j],lid=String(doc.id||'').toLowerCase();
      var docTime=dateMs(doc.updated_at||doc.created_at);
      var hrTombs=getLocalHrTombstones();
      var hrTombVal=hrTombs[lid];
      var hrTombTime=typeof hrTombVal==='string'?dateMs(hrTombVal):(hrTombVal===true?Infinity:0);
      var isHrTomb=hrTombTime>docTime;
      if(isHrTomb){
        console.log('[Firebase HR Auto-Delete] Purging removed HR doc:', doc.document_name||doc.id);
        await deleteHrDocFromDb(doc.id);
        changed++;
      } else if(!remoteById[lid] && !doc._inFlight){
        console.log('[Data Safety Guard] Auto-backing up local HR doc to Firestore:', doc.id);
        cloudSaveHr(doc).catch(function(){});
        if(root.ATPLFirebase&&typeof root.ATPLFirebase.saveHrDoc==='function'){
          root.ATPLFirebase.saveHrDoc(doc).catch(function(){});
        }
      }
    }
   var activeIds=Object.keys(remoteById);
   for(var i=0;i<activeIds.length;i++){
     var rem=remoteById[activeIds[i]],lid=activeIds[i];
     var old=local.find(function(x){return String(x.id||'').toLowerCase()===lid});
     if(old&&dateMs(old.updated_at)>=dateMs(rem.updated_at||rem.created_at))continue;
     try{
       var fullDoc=rem;
       if(root.ATPLFirebase&&typeof root.ATPLFirebase.decodeHrPayload==='function'){
         var decoded=await root.ATPLFirebase.decodeHrPayload(rem);
         if(decoded)fullDoc=decoded;
       }
       await putHrDoc(fullDoc);
       changed++;
     }catch(e){console.warn('Firebase HR doc save warning',rem.id,e)}
   }
   if(changed>0)refreshHrUi();
 }

 async function handleFirebaseHrTombstonesUpdate(tombstonesList){
    if(!Array.isArray(tombstonesList)||!tombstonesList.length)return;
    var local=await hrRows(),changed=0;
    var tombMap={};
    tombstonesList.forEach(function(t){
      if(t&&t.id){
        var k=String(t.id).toLowerCase();
        tombMap[k]=t.deleted_at||new Date().toISOString();
      }
    });
    for(var j=0;j<local.length;j++){
      var doc=local[j],lid=String(doc.id||'').toLowerCase();
      var tTime=tombMap[lid]?dateMs(tombMap[lid]):0;
      var docTime=dateMs(doc.updated_at||doc.created_at);
      if(tTime && tTime >= docTime){
        console.log('[Firebase HR Auto-Delete] Purging removed HR doc across browsers:',doc.document_name||doc.id);
        await deleteHrDocFromDb(doc.id);
        changed++;
      }
    }
    if(changed>0)refreshHrUi();
  }
  async function handleFirebaseTombstonesUpdate(tombstonesList){
    if(!Array.isArray(tombstonesList)||!tombstonesList.length)return;
    var local=await salaryRows(),changed=0;
    var tombs=getLocalSalaryTombstones();
    var now=new Date().toISOString();
    tombstonesList.forEach(function(t){
      if(t&&t.name){
        var k=String(t.name).toLowerCase();
        var tTime=t.deleted_at||now;
        tombs[k]=tTime;
        if(t.name==='__ALL__' && t.cleared_at && (Date.now() - dateMs(t.cleared_at) < 60000)){
          try{ root.localStorage.setItem('ATPL_ALL_SALARY_CLEARED_AT', t.cleared_at); }catch(_){}
        }
      }
    });
    try{ root.localStorage.setItem(TOMB_STORAGE_KEY, JSON.stringify(tombs)); }catch(_){}

    var allClearedAt = dateMs(root.localStorage.getItem('ATPL_ALL_SALARY_CLEARED_AT'));
    for(var j=0;j<local.length;j++){
      var row=local[j];
      var lk=String(row.name||'').toLowerCase();
      var tombVal=tombs[lk];
      var tombTime=typeof tombVal==='string'?dateMs(tombVal):(tombVal===true?Infinity:0);
      var fileTime=dateMs(row.saved);
      var isTomb=tombTime>fileTime;
      if(isTomb || (allClearedAt && allClearedAt >= fileTime)){
        console.log('[Firebase Cross-Browser Tombstone Sync] Removing deleted file across browsers:', row.name);
        await deleteSalaryFromDb(row.name);
        changed++;
      }
    }
    if(changed>0){
      refreshSalaryUi();
    }
  }

 function startFirebaseListener(){
   if(sharedSalaryAuthority)return false;
   if(root.__atplFirebaseQuotaExhausted) return false;
   if(!root.ATPLFirebase||typeof root.ATPLFirebase.subscribeSalaryFiles!=='function')return false;
   if(firebaseUnsubscribe)return true;
   try{
     firebaseUnsubscribe=root.ATPLFirebase.subscribeSalaryFiles(function(update){
       handleFirebaseFilesUpdate(update).catch(function(e){console.error('Firebase update error',e)});
     },function(err){
       if(/quota|resource-exhausted/i.test(String(err && (err.message || err.code)))){
         root.__atplFirebaseQuotaExhausted = true;
         if(typeof firebaseUnsubscribe==='function')try{firebaseUnsubscribe()}catch(_){}
         firebaseUnsubscribe = null;
       }
       console.warn('Firebase subscription warning',err);
       setBadge('bad','🔥 Firebase offline');
     });

     if(typeof root.ATPLFirebase.subscribeTombstones==='function'){
       firebaseTombUnsubscribe=root.ATPLFirebase.subscribeTombstones(function(tombs){
         handleFirebaseTombstonesUpdate(tombs).catch(function(e){console.error('Firebase tombstone error',e)});
       },function(err){
         console.warn('Firebase tombstone subscription warning',err);
       });
     }

     if(typeof root.ATPLFirebase.subscribeHrDocs==='function'){
       firebaseHrUnsubscribe=root.ATPLFirebase.subscribeHrDocs(function(update){
         handleFirebaseHrUpdate(update).catch(function(e){console.error('Firebase HR update error',e)});
       },function(err){
         console.warn('Firebase HR subscription warning',err);
       });
     }

     if(typeof root.ATPLFirebase.subscribeHrTombstones==='function'){
       firebaseHrTombUnsubscribe=root.ATPLFirebase.subscribeHrTombstones(function(tombs){
         handleFirebaseHrTombstonesUpdate(tombs).catch(function(e){console.error('Firebase HR tombstone error',e)});
       },function(err){
         console.warn('Firebase HR tombstone subscription warning',err);
       });
     }

     console.log('[ATPL-Storage] Realtime Firebase Firestore listener connected');
     setBadge('ok','🔥 Firebase Live');
     return true;
   }catch(e){
     console.warn('Firebase listener initialization failed',e);
     return false;
   }
 }

 async function syncNow(force){
   if(sharedSalaryAuthority)return syncSharedSalary(force);
   if(root.ATPLFirebase&&typeof root.ATPLFirebase.fetchAllSalaryFiles==='function'){
     try{
       var fbFiles=await root.ATPLFirebase.fetchAllSalaryFiles();
       await handleFirebaseFilesUpdate({all:fbFiles,removedNames:[]});
       return true;
     }catch(e){console.warn('Firebase manual fetch warning',e)}
   }
   if(!token())return false;
   if(pulling)return pulling;
   if(!force&&Date.now()-lastPull<8000)return true;
   setBadge('busy','☁ Syncing files…');
   pulling=fetchRemote(true).then(async function(r){
     await pullSalary(r);
     var migrated=await pushSalary(r);
     if(migrated.pushed){r=await fetchRemote(true);await pullSalary(r)}
     await pullHr(r);
     refreshSalaryUi();
     if(migrated.failed)setBadge('bad','☁ '+migrated.failed+' file(s) pending');
     else setBadge('ok','🔥 Firebase Live ('+root.FILES.length+')');
     return migrated.failed===0;
   }).catch(function(e){
     console.warn('Shared storage sync failed',e);
     setBadge('bad','☁ Sync issue');
     return false;
   }).finally(function(){pulling=null});
   return pulling;
 }

 async function cloudSaveSalary(name,buf,saved){
   if(sharedSalaryAuthority)return queueSharedSalary('save',name,saved||new Date().toISOString());
   var savedTs=saved||new Date().toISOString();
   if(!salaryRestoreAllowed(name,savedTs))return false;
   clearLocalSalaryTombstone(name);

   // 0. Server Sync
   try{
     var b64Data = bufToB64(buf);
     if(b64Data){
       fetch('/api/sync/salary-file',{
         method:'POST',
         headers:{'Content-Type':'application/json'},
         body:JSON.stringify({name:name,buf:b64Data,saved:savedTs,uploaded_by:user()?user().id:'admin'})
       }).catch(function(){});
     }
     if(root.BroadcastChannel){
       try{
         var bc=new root.BroadcastChannel('ATPL_ERP_SHARED_V2');
         bc.postMessage({type:'salary_file_saved',name:name,buf:b64Data,saved:savedTs});
         bc.close();
       }catch(_){}
     }
   }catch(_){}

   var p=null;
   try{ p=workbookPayload(name,buf); }catch(_){}
   if(!p) p={v:1,name:name};
   p.original_b64 = bufToB64(buf);

   // 1. Primary: Save directly to Firebase Firestore
   if(!root.__atplFirebaseQuotaExhausted && root.ATPLFirebase && typeof root.ATPLFirebase.saveSalaryFile==='function'){
     try{
       var rowsCount=0;
       if(p&&Array.isArray(p.sheets)){
         p.sheets.forEach(function(s){rowsCount+=Math.max(0,(s.rows||[]).length-1)});
       }
       await root.ATPLFirebase.saveSalaryFile(name,p,{
         name:name,
         saved_at:savedTs,
         rows_count:rowsCount,
         sheets_count:p.sheets?p.sheets.length:1,
         uploaded_by:user()?user().id:'admin'
       });
       storageLabel('Saved to Firebase Realtime · '+name);
       setBadge('ok','🔥 Firebase Live ('+root.FILES.length+')');
       if(typeof root.showToast==='function')root.showToast('🔥 File "'+name+'" cloud aur sabhi devices par live save ho gayi.');
       return true;
     }catch(fe){
       if(/quota|resource-exhausted/i.test(String(fe && (fe.message || fe.code)))) {
         root.__atplFirebaseQuotaExhausted = true;
       }
       console.warn('Firebase direct save warning, using fallback',fe);
     }
   }

   // 2. Fallback: Google Apps Script shared bridge
   try{
     await saveObject('salary_file',name,p,{name:name,saved_at:savedTs});
     storageLabel('Saved locally + cloud · '+name);
     if(root.BroadcastChannel){
       try{var bc=new root.BroadcastChannel('ATPL_ERP_SHARED_V2');bc.postMessage({type:'salary_file_saved',name:name});bc.close()}catch(_){}
     }
     return true;
   }catch(e){
     console.warn('Salary cloud save failed',e);
     setBadge('bad','☁ File save issue');
     storageLabel('Saved locally · cloud retry needed');
     return false;
   }
 }

 async function cloudDeleteSalary(name){
   if(sharedSalaryAuthority)return queueSharedSalary('delete',name,new Date().toISOString());
   saveLocalSalaryTombstone(name);
   var k=safeKey('salary_file',name);
   if(Array.isArray(root.FILES)){
     root.FILES=root.FILES.filter(function(f){return !f||String(f.name||'').toLowerCase()!==String(name).toLowerCase()});
   }
   refreshSalaryUi();
   storageLabel('Deleting from cloud · '+name);

   // Server Sync delete
   try{
     fetch('/api/sync/salary-file/'+encodeURIComponent(name),{method:'DELETE'}).catch(function(){});
   }catch(_){}

   // 1. Delete local from IndexedDB
   await deleteSalaryFromDb(name);

   // 2. Primary: Delete from Firebase Firestore (triggers real-time auto-delete across all phones and browsers)
   if(!root.__atplFirebaseQuotaExhausted && root.ATPLFirebase && typeof root.ATPLFirebase.deleteSalaryFile==='function'){
     try{
       await root.ATPLFirebase.deleteSalaryFile(name,user()?user().id:'admin');
       console.log('[Firebase] File deleted from Firestore:',name);
     }catch(fe){
       if(/quota|resource-exhausted/i.test(String(fe && (fe.message || fe.code)))) {
         root.__atplFirebaseQuotaExhausted = true;
       }
       console.warn('Firebase direct delete warning',fe);
     }
   }

   // 3. Fallback: Clean chunks and meta from Apps Script
   try{
     var records=remoteRecords.slice();
     var x=recordsFor(records,k);
     var n=Number(x.meta&&x.meta.chunks||0);
     await remove(metaId(k));
     for(var i=0;i<n;i++)await remove(chunkId(k,i));

     // Write persistent delete tombstone in Apps Script
     var tombIdVal=tombId(k),u=user()||{};
     await upsert(tombIdVal,{
       _atpl_kind:'tombstone',
       object_kind:'salary_file',
       object_key:k,
       key_text:String(name),
       deleted:true,
       deleted_at:new Date().toISOString(),
       deleted_by:u.id||''
     });
   }catch(_){}

   remoteRecords=[];lastPull=0;
   storageLabel(root.FILES.length+' files saved · 🗑 Deleted');
   if(typeof root.showToast==='function')root.showToast('🗑 File "'+name+'" cloud aur sabhi devices se auto-delete ho gayi.');

   if(root.BroadcastChannel){
     try{var bc=new root.BroadcastChannel('ATPL_ERP_SHARED_V2');bc.postMessage({type:'salary_file_deleted',name:name});bc.close()}catch(_){}
   }
   return true;
 }

 async function cloudSaveHr(doc){
   try{
     fetch('/api/sync/hr-doc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(doc)}).catch(function(){});
   }catch(_){}
   try{
     return await saveObject('hr_doc',doc.id,doc,{name:doc.document_name||doc.id,saved_at:doc.updated_at||new Date().toISOString()});
   }catch(e){
     if(/too large/i.test(String(e&&e.message))){
       try{
         var slim=Object.assign({},doc,{file_data:null,file_data_list:null,_cloud_attachment_omitted:true,_cloud_attachment_names:(doc.file_data_list||[]).map(function(x){return x.name}).filter(Boolean)});
         await saveObject('hr_doc',doc.id,slim,{name:doc.document_name||doc.id,saved_at:doc.updated_at||new Date().toISOString()});
         setBadge('bad','☁ Large file local only');
         return false;
       }catch(_){}
     }
     console.warn('HR document cloud save failed',e);
     setBadge('bad','☁ File save issue');
     return false;
   }
 }

 function hookSalary(){
   if(typeof root.saveFileToDB!=='function'||root.saveFileToDB.__atplCloudShared)return false;
   var old=root.saveFileToDB;
   function wrapped(name,buf,cb){
     var saved=new Date().toISOString();
     return old.call(this,name,buf,function(){
       try{if(cb)cb()}finally{cloudSaveSalary(name,buf,saved)}
     });
   }
   wrapped.__atplCloudShared=true;
   wrapped.__original=old;
   root.saveFileToDB=wrapped;
   return true;
 }

 function hookSalaryDelete(){
   if(typeof root.deleteFromDB!=='function'||root.deleteFromDB.__atplCloudShared)return false;
   var old=root.deleteFromDB;
   function wrapped(name,cb){
     return old.call(this,name,function(){
       try{if(cb)cb()}finally{cloudDeleteSalary(name)}
     });
   }
   wrapped.__atplCloudShared=true;
   wrapped.__original=old;
   root.deleteFromDB=wrapped;
   return true;
 }

 function hookClearDb(){
   if(typeof root.clearDB!=='function'||root.clearDB.__atplCloudShared)return false;
   var old=root.clearDB;
   function wrapped(cb){
     if(sharedSalaryAuthority){
       var cleared=root.localStorage.getItem('ATPL_ALL_SALARY_CLEARED_AT')||new Date().toISOString();
       queueSharedSalary('clear',SALARY_CLEAR_KEY,cleared);
       return old.call(this,cb);
     }
     var files=Array.isArray(root.FILES)?root.FILES.slice():[];
     root.FILES = [];
     var now=new Date().toISOString();
     try{
       root.localStorage.setItem('ATPL_ALL_SALARY_CLEARED_AT',now);
       var tombs=getLocalSalaryTombstones();
       files.forEach(function(f){if(f&&f.name)tombs[String(f.name).toLowerCase()]=now});
       root.localStorage.setItem(TOMB_STORAGE_KEY,JSON.stringify(tombs));
     }catch(_){}
     clearSalaryDb().catch(function(){});
     try{fetch('/api/sync/salary-clear-all',{method:'POST'}).catch(function(){});}catch(_){}
     if(root.ATPLFirebase&&typeof root.ATPLFirebase.clearAllSalaryFiles==='function'){
       root.ATPLFirebase.clearAllSalaryFiles(user()?user().id:'admin').catch(function(){});
     }
     return old.call(this,function(){
       try{if(cb)cb()}finally{
         storageLabel('0 files saved · Clean');
         var cnt=root.document?root.document.getElementById('fileCount'):null;
         if(cnt)cnt.textContent='(0)';
         ['renderFiles','renderSheets','updStats','renderAllFilesPage','populateNJSelects'].forEach(function(n){
           try{if(typeof root[n]==='function')root[n]()}catch(_){}
         });
       }
     });
   }
   wrapped.__atplCloudShared=true;
   wrapped.__original=old;
   root.clearDB=wrapped;
   return true;
 }

 function hookHr(){
   if(typeof root.hrDocPut==='function'&&!root.hrDocPut.__atplCloudShared){
     var old=root.hrDocPut;
     function put(d,cb){
       return old.call(this,d,function(){
         try{if(cb)cb()}finally{
           if(d&&d.id){
             clearLocalHrTombstone(d.id);
             try{fetch('/api/sync/hr-doc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)}).catch(function(){});}catch(_){}
             if(root.ATPLFirebase&&typeof root.ATPLFirebase.saveHrDoc==='function'){
               root.ATPLFirebase.saveHrDoc(d).catch(function(e){console.warn('Firebase HR save failed',e)});
             }
             if(token())cloudSaveHr(d);
           }
         }
       });
     }
     put.__atplCloudShared=true;
     root.hrDocPut=put;
   }
   return !!root.hrDocPut;
 }

 function hookHrDelete(){
   if(typeof root.hrDocDelete!=='function'||root.hrDocDelete.__atplCloudShared)return;
   var old=root.hrDocDelete;
   function del(id){
     var d=typeof root.hrDocGetDocs==='function'?(root.hrDocGetDocs()||[]).find(function(x){return x.id===id}):null;
     var docName=d?d.document_name:id;
     saveLocalHrTombstone(id);
     try{fetch('/api/sync/hr-doc/'+encodeURIComponent(id),{method:'DELETE'}).catch(function(){});}catch(_){}
     if(root.ATPLFirebase&&typeof root.ATPLFirebase.deleteHrDoc==='function'){
       root.ATPLFirebase.deleteHrDoc(id,docName,user()?user().id:'admin').catch(function(e){console.warn('Firebase HR delete failed',e)});
     }
     var before=typeof root.hrDocGetDocs==='function'?(root.hrDocGetDocs()||[]).some(function(x){return x.id===id}):false,ret=old.apply(this,arguments);
     setTimeout(async function(){
       var still=typeof root.hrDocGetDocs==='function'?(root.hrDocGetDocs()||[]).some(function(x){return x.id===id}):false;
       if(before&&!still){
         saveLocalHrTombstone(id);
         if(root.ATPLFirebase&&typeof root.ATPLFirebase.deleteHrDoc==='function'){
           root.ATPLFirebase.deleteHrDoc(id,docName,user()?user().id:'admin').catch(function(_){});
         }
         if(token()){
           try{
             var k=safeKey('hr_doc',id),records=remoteRecords.slice(),x=recordsFor(records,k),n=Number(x.meta&&x.meta.chunks||0);
             await remove(metaId(k));
             for(var i=0;i<n;i++)await remove(chunkId(k,i));
             var tombIdVal=tombId(k),u=user()||{};
             await upsert(tombIdVal,{
               _atpl_kind:'tombstone',
               object_kind:'hr_doc',
               object_key:k,
               key_text:String(id),
               deleted:true,
               deleted_at:new Date().toISOString(),
               deleted_by:u.id||''
             });
             remoteRecords=[];lastPull=0;
           }catch(_){}
         }
       }
     },200);
     return ret;
   }
   del.__atplCloudShared=true;
   root.hrDocDelete=del;
 }

 var isReconcilingServer = false;
 var lastServerSync = 0;
 async function syncWithServer(force){
   if(sharedSalaryAuthority)return syncSharedSalary(force);
   if(isReconcilingServer) return;
   var now = Date.now();
   if(!force && (now - lastServerSync < 4000)) return;
   isReconcilingServer = true;
   try{
     var localFiles = await salaryRows();
     var tombs = getLocalSalaryTombstones();
     var allClearedAt = dateMs(root.localStorage.getItem('ATPL_ALL_SALARY_CLEARED_AT'));

     var validLocal = (localFiles || []).filter(function(f){
       if(!f || !f.name || !f.buf) return false;
       var rTime = dateMs(f.saved);
       if(allClearedAt && allClearedAt >= rTime) return false;
       var lk = String(f.name).toLowerCase();
       var tombVal = tombs[lk];
       var tombTime = typeof tombVal === 'string' ? dateMs(tombVal) : (tombVal === true ? Infinity : 0);
       if(tombTime && tombTime > rTime) return false;
       return true;
     });

     var localMap = {};
     validLocal.forEach(function(f){ localMap[String(f.name).toLowerCase()] = f; });
     if(Array.isArray(root.FILES)){
       root.FILES.forEach(function(rf){
         if(rf && rf.name && rf.buf && salaryRestoreAllowed(rf.name,rf.savedAt)){
           var rk = String(rf.name).toLowerCase();
           if(!localMap[rk]){
             localMap[rk] = { name: rf.name, buf: rf.buf, saved: rf.savedAt || new Date().toISOString() };
           }
         }
       });
     }

     var stRes = null;
     var st = null;
     try {
       stRes = await fetch('/api/sync/state?summary=1');
       if (stRes && stRes.ok) {
         st = await stRes.json();
       }
     } catch(_) {}

     if (!st || !st.ok) {
       // Static fallback for GitHub Pages (nikhilatpl2026-jpg.github.io/HR-SOFTWARE-ATPL/)
       try {
         var sRes = await fetch('./data/salary_files.json');
         if (!sRes || !sRes.ok) sRes = await fetch('data/salary_files.json');
         if (sRes && sRes.ok) {
           var sData = await sRes.json();
           var sList = [];
           for (var sk in sData) {
             if (sData[sk] && sData[sk].name && sData[sk].buf) {
               sList.push(sData[sk]);
             }
           }
           if (sList.length > 0) {
             st = { ok: true, salary_files: sList, salary_tombstones: {} };
           }
         }
       } catch(_) {}
     }
     if(!st || !st.ok) return;

     // 1. Check if server has files that local is missing -> download into local!
     var changedSalary = false;
     var serverMap = {};
     if(Array.isArray(st.salary_files)){
       for(var i=0; i<st.salary_files.length; i++){
         var sf = st.salary_files[i];
         if(!sf || !sf.name) continue;
         var sfk = String(sf.name).toLowerCase();
         serverMap[sfk] = sf;
         var sTombs = st.salary_tombstones || {};
         if(sTombs[sfk] || !salaryRestoreAllowed(sf.name,sf.saved)) continue;

         var localFile = localMap[sfk];
         if(!localFile || (dateMs(sf.saved) > dateMs(localFile.saved))){
           try {
             var sBuf = sf.buf;
             if (!sBuf) {
               var sRes = await fetch('/api/sync/salary-file/' + encodeURIComponent(sf.name));
               var sJson = await sRes.json();
               if(sJson && sJson.ok && sJson.file && sJson.file.buf){
                 sBuf = sJson.file.buf;
               }
             }
             if(sBuf){
               var dec = typeof sBuf === 'string' ? b64ToBuf(sBuf) : sBuf;
               if(dec){
                 await putSalary(sf.name, dec, sf.saved);
                 // Remote snapshots never erase local deletion barriers.
                 changedSalary = true;
               }
             }
           } catch(_){}
         }
       }
     }
     if(changedSalary) {
       await refreshSalaryUi(true);
     }

     // 2. Check if local has files that server is missing -> push each file individually and await it!
     var localList = Object.values(localMap);
     for(var j=0; j<localList.length; j++){
       var lf = localList[j];
       var lk = String(lf.name).toLowerCase();
       if(!salaryRestoreAllowed(lf.name,lf.saved) || (st.salary_tombstones||{})[lk])continue;
       var sFile = serverMap[lk];
       if(!sFile || !sFile.buf || dateMs(lf.saved) > dateMs(sFile.saved)){
         try {
           var b64 = bufToB64(lf.buf);
           if(b64){
             await fetch('/api/sync/salary-file', {
               method: 'POST',
               headers: { 'Content-Type': 'application/json' },
               body: JSON.stringify({
                 name: lf.name,
                 buf: b64,
                 saved: lf.saved || new Date().toISOString(),
                 uploaded_by: user() ? user().id : 'browser-sync'
               })
             });
           }
         } catch(upErr){
           console.warn('[Sync-Upload] Single file push error for', lf.name, upErr);
         }
       }
     }

     // 3. Sync HR Docs
     var localHr = await hrRows();
     var localHrIds = {};
     (localHr || []).forEach(function(h){ if(h && h.id) localHrIds[String(h.id).toLowerCase()] = h; });
     var changedHr = false;
     if(Array.isArray(st.hr_docs)){
       for(var m=0; m<st.hr_docs.length; m++){
         var hd = st.hr_docs[m];
         if(!hd || !hd.id) continue;
         var hdk = String(hd.id).toLowerCase();
         if(!localHrIds[hdk]){
           await putHrDoc(hd);
           changedHr = true;
         }
       }
     }
     if(changedHr) refreshHrUi();

     // 4. Sync Employee Master
     if(Array.isArray(st.employee_master) && st.employee_master.length){
       var curEm = (root.EM && Array.isArray(root.EM.data)) ? root.EM.data : [];
       if(!curEm.length){
         if(root.EM) root.EM.data = st.employee_master.slice();
         if(Array.isArray(root.EMP_MASTER_DATA)){
           root.EMP_MASTER_DATA.length = 0;
           Array.prototype.push.apply(root.EMP_MASTER_DATA, st.employee_master);
         }
         root.localStorage.setItem('AroraTextilesEmployeeMasterV3', JSON.stringify(st.employee_master));
         if(typeof root.emFilter === 'function') root.emFilter();
         if(typeof root.emUpdateStats === 'function') root.emUpdateStats();
       }
     }

     lastServerSync = Date.now();
   }catch(err){
     console.warn('[Sync-State] Server sync note:', err.message);
   }finally{
     isReconcilingServer = false;
   }
 }

 function startServerSyncListener(){
   if(root.location && /(^|\.)github\.io$/i.test(root.location.hostname)){
     // On static GitHub Pages, real-time sync is powered exclusively by Firebase WebSocket
     return;
   }
   if(sharedSalaryAuthority){
     return;
   }
   if(typeof root.EventSource==='undefined')return;
   try{
     // Immediate initial bidirectional sync
     syncWithServer(true);
     [800, 2500, 6000].forEach(function(delay){
       setTimeout(function(){ syncWithServer(false); }, delay);
     });

     // Periodic fallback check every 7 seconds
     setInterval(function(){
       if(!root.document.hidden){
         syncWithServer(false);
       }
     }, 7000);

     var es=new root.EventSource('/api/sync/events');
     es.addEventListener('salary_file_saved',async function(e){
       try{
         var item=JSON.parse(e.data);
         var d=item.data;
         if(!d||!d.name)return;
         if(!salaryRestoreAllowed(d.name,d.saved))return;
         if(d.buf){
           var realBuf = typeof d.buf === 'string' ? b64ToBuf(d.buf) : d.buf;
           await putSalary(d.name,realBuf,d.saved);
           refreshSalaryUi(true);
         }else{
           try{
             var sRes = await fetch('/api/sync/salary-file/' + encodeURIComponent(d.name));
             var sJson = await sRes.json();
             if(sJson && sJson.ok && sJson.file && sJson.file.buf){
               var realBuf = typeof sJson.file.buf === 'string' ? b64ToBuf(sJson.file.buf) : sJson.file.buf;
               await putSalary(d.name,realBuf,sJson.file.saved);
               refreshSalaryUi(true);
             }
           }catch(_){
             syncWithServer(true);
           }
         }
       }catch(_){}
     });
     es.addEventListener('sync_state_updated',function(){
       syncWithServer(true);
     });
     es.addEventListener('salary_file_deleted',async function(e){
       try{
         var item=JSON.parse(e.data);
         var d=item.data;
         if(!d||!d.name)return;
         saveLocalSalaryTombstone(d.name);
         await deleteSalaryFromDb(d.name);
         if(Array.isArray(root.FILES)){
           root.FILES=root.FILES.filter(function(f){return !f||String(f.name).toLowerCase()!==String(d.name).toLowerCase()});
         }
         refreshSalaryUi(true);
       }catch(_){}
     });
     es.addEventListener('salary_clear_all',async function(e){
       try{
         var item=JSON.parse(e.data);
         root.localStorage.setItem('ATPL_ALL_SALARY_CLEARED_AT',(item.data&&item.data.cleared_at)||new Date().toISOString());
         root.FILES=[];
         await clearSalaryDb();
         refreshSalaryUi(true);
       }catch(_){}
     });
     es.addEventListener('hr_doc_saved',async function(e){
       try{
         var item=JSON.parse(e.data);
         var doc=item.data;
         if(!doc||!doc.id)return;
         await putHrDoc(doc);
         refreshHrUi();
       }catch(_){}
     });
     es.addEventListener('hr_doc_deleted',async function(e){
       try{
         var item=JSON.parse(e.data);
         var d=item.data;
         if(!d||!d.id)return;
         saveLocalHrTombstone(d.id);
         await deleteHrDocFromDb(d.id);
         refreshHrUi();
       }catch(_){}
     });
     es.addEventListener('employee_master_updated',function(e){
       try{
         var item=JSON.parse(e.data);
         var recs=item.data&&item.data.records;
         if(Array.isArray(recs)&&recs.length){
           if(root.EM&&Array.isArray(root.EM.data)){root.EM.data=recs.slice();}
           if(Array.isArray(root.EMP_MASTER_DATA)){root.EMP_MASTER_DATA.length=0;Array.prototype.push.apply(root.EMP_MASTER_DATA,recs);}
           root.localStorage.setItem('AroraTextilesEmployeeMasterV3',JSON.stringify(recs));
           if(typeof root.emFilter==='function')root.emFilter();
           if(typeof root.emUpdateStats==='function')root.emUpdateStats();
         }
       }catch(_){}
     });
     es.onerror = function(){
       setTimeout(function(){ syncWithServer(false); }, 3000);
     };
   }catch(err){
     console.warn('Server sync error',err);
   }
 }


 // Static GitHub Pages uses the authenticated shared bridge, never /api or repository snapshots.
 function outboxKey(){var u=user();return SALARY_OUTBOX+'_'+(u?u.id:'signed-out')}
 function readSalaryOutbox(){return J(root.localStorage.getItem(outboxKey())||'{}',{})}
 function putSalaryOperation(op){var q=readSalaryOutbox();q[String(op.name).toLowerCase()]=op;root.localStorage.setItem(outboxKey(),JSON.stringify(q))}
 function ackSalaryOperation(op){var q=readSalaryOutbox(),k=String(op.name).toLowerCase();if(q[k]&&q[k].id===op.id){delete q[k];root.localStorage.setItem(outboxKey(),JSON.stringify(q))}}
 function salaryPending(){return Object.keys(readSalaryOutbox()).length}
 function mergeSalaryDeletes(records){
   var tombs=getLocalSalaryTombstones(),clear=dateMs(root.localStorage.getItem('ATPL_ALL_SALARY_CLEARED_AT'));
   records.forEach(function(r){
     if(!r||r._atpl_kind!=='tombstone'||r.object_kind!=='salary_file')return;
     var stamp=dateMs(r.deleted_at),name=String(r.key_text||r.name||'').toLowerCase();
     if(name===SALARY_CLEAR_KEY.toLowerCase()){clear=Math.max(clear,stamp);return}
     if(name && stamp>dateMs(tombs[name]))tombs[name]=r.deleted_at;
   });
   root.localStorage.setItem(TOMB_STORAGE_KEY,JSON.stringify(tombs));
   if(clear)root.localStorage.setItem('ATPL_ALL_SALARY_CLEARED_AT',new Date(clear).toISOString());
 }
 async function salarySnapshot(){
   if(!token())throw new Error('Sign in to sync files');
   var result=await api({action:'getSystemRecords',kind:'salary_file',token:token()},22000);
   if(!result||!result.ok||!Array.isArray(result.records))throw new Error(result&&result.error||'Shared salary read failed');
   return result.records.filter(function(r){return r&&r.object_kind==='salary_file'});
 }
async function applySalarySnapshot(records){
  mergeSalaryDeletes(records);
  var rows=await salaryRows(),by={},purged=0;
  for(var row of rows){
    if(!salaryRestoreAllowed(row.name,row.saved)){
      console.log('[Permanent Sync] Auto-deleting cloud-tombstoned file across browsers:', row.name);
      if(!await deleteSalaryFromDb(row.name))throw new Error('Local delete failed: '+row.name);
      purged++;
    }else by[String(row.name).toLowerCase()]=row;
  }
  // Only explicit tombstones remove files. An empty successful snapshot does not erase local work.
  if(Array.isArray(root.FILES)){
    var beforeLen=root.FILES.length;
    root.FILES=root.FILES.filter(function(f){return f&&salaryRestoreAllowed(f.name,f.savedAt||f.saved)});
    if(root.FILES.length!==beforeLen)purged+=(beforeLen-root.FILES.length);
  }
  if(purged>0){
    try{if(typeof root.renderFiles==='function')root.renderFiles()}catch(_){}
    try{if(typeof root.renderAllFilesPage==='function')root.renderAllFilesPage()}catch(_){}
    try{if(typeof root.updStats==='function')root.updStats()}catch(_){}
  }
  var metas=records.filter(function(r){return r._atpl_kind==='meta'&&r.deleted!==true});
   for(var meta of metas){
     var name=meta.name||meta.key_text,stamp=meta.saved_at||meta.uploaded_at;
     if(!salaryRestoreAllowed(name,stamp))continue;
     var old=by[String(name).toLowerCase()];
     if(old&&dateMs(old.saved)>=dateMs(stamp))continue;
     var matching=meta.generation?records.filter(function(r){return r._atpl_kind!=='chunk'||r.generation===meta.generation}):records;
     var payload=await loadObject(matching,meta);
     await putSalary(name,payloadBuffer(payload),stamp);
   }
   await refreshSalaryUi(true);
 }
 async function writeSalaryOperation(op){
   if(op.type==='delete'||op.type==='clear'){
     var prior=(await salarySnapshot()).find(function(r){return r._atpl_kind==='tombstone'&&String(r.key_text).toLowerCase()===String(op.name).toLowerCase()});
     if(prior&&dateMs(prior.deleted_at)>=dateMs(op.at))return;
     // Tombstone is the commit. Leave old chunks intact so an overlapping new upload cannot be deleted.
     await upsert(tombId(safeKey('salary_file',op.name)),{
       _atpl_kind:'tombstone',object_kind:'salary_file',object_key:safeKey('salary_file',op.name),
       key_text:op.name,deleted:true,deleted_at:op.at,deleted_by:(user()||{}).id||''
     });
     return;
   }
   if(!salaryRestoreAllowed(op.name,op.at))return;
   var rows=await salaryRows(),row=rows.find(function(r){return String(r.name).toLowerCase()===String(op.name).toLowerCase()});
   if(!row||!row.buf)throw new Error('Upload bytes unavailable locally: '+op.name);
   var current=readSalaryOutbox()[String(op.name).toLowerCase()];
   if(current&&current.id!==op.id)return; // A later operation owns this filename.
   op.at=row.saved||op.at;
   if(!salaryRestoreAllowed(op.name,op.at))return;
   var payload={v:2,name:row.name,original_b64:bufToB64(row.buf)},packed=await encodeObject(payload);
   var parts=[];for(var at=0;at<packed.data.length;at+=CHUNK)parts.push(packed.data.slice(at,at+CHUNK));
   var key=safeKey('salary_file',row.name),generation=op.id;
   var tasks=parts.map(function(data,index){return async function(){
     if(!salaryRestoreAllowed(op.name,op.at))throw new Error('Upload superseded by delete');
     await upsert(chunkId(key+'_'+generation,index),{_atpl_kind:'chunk',object_kind:'salary_file',object_key:key,generation:generation,index:index,data:data});
   }});
   await pool(tasks,CONCURRENCY);
   if(!salaryRestoreAllowed(op.name,op.at))return;
   var latest=await salarySnapshot();mergeSalaryDeletes(latest);
   if(!salaryRestoreAllowed(op.name,op.at))return;
   var newer=latest.find(function(r){return r._atpl_kind==='meta'&&r.object_key===key&&dateMs(r.saved_at)>dateMs(op.at)});
   if(newer)return;
   await upsert(metaId(key),{_atpl_kind:'meta',object_kind:'salary_file',object_key:key,key_text:row.name,name:row.name,
     generation:generation,saved_at:op.at,uploaded_at:new Date().toISOString(),uploaded_by:(user()||{}).id||'',
     encoding:packed.encoding,chunks:parts.length,raw_bytes:packed.rawBytes,packed_bytes:packed.packedBytes});
 }
 async function flushSalaryOutbox(){
   if(salaryWriteFlight)return salaryWriteFlight;
   salaryWriteFlight=(async function(){
     if(!token())throw new Error('Sign in to sync files');
     var q=readSalaryOutbox(),ops=Object.keys(q).map(function(k){return q[k]});
     ops.sort(function(a,b){return (a.type==='save'?1:0)-(b.type==='save'?1:0)||dateMs(a.at)-dateMs(b.at)});
     for(var op of ops){await writeSalaryOperation(op);ackSalaryOperation(op)}
   })();
   try{await salaryWriteFlight}finally{salaryWriteFlight=null}
 }
 async function queueSharedSalary(type,name,at){
   var op={type:type,name:name,at:at,id:Date.now().toString(36)+'_'+Math.random().toString(36).slice(2)};
   try{
     putSalaryOperation(op);
     if(type==='delete')saveLocalSalaryTombstone(name);
     if(type==='clear')root.localStorage.setItem('ATPL_ALL_SALARY_CLEARED_AT',at);
     storageLabel('Cloud sync pending · '+name);setBadge('busy','Cloud sync pending');
     // Pull tombstones first, including deletes performed on another device while this one was offline.
     return await syncSharedSalary(true);
   }catch(e){storageLabel('Cloud sync pending · '+e.message);setBadge('bad','Cloud sync pending');return false}
 }
 async function syncSharedSalary(force){
   if(salarySyncFlight)return salarySyncFlight;
   if(!token()){setBadge('bad','Sign in to sync files');return false}
   if(!force&&Date.now()-salarySyncAt<6500)return !salaryPending();
   salarySyncFlight=(async function(){
     try{
       setBadge('busy','Checking shared files…');
       var records=await salarySnapshot();
       await applySalarySnapshot(records);
       // Reconcile existing local uploads once against real shared records, never static JSON.
       var rows=await salaryRows(),remote={};
       records.forEach(function(r){if(r._atpl_kind==='meta')remote[String(r.name||r.key_text).toLowerCase()]=r});
       var q=readSalaryOutbox();
       rows.forEach(function(row){
         var key=String(row.name).toLowerCase(),m=remote[key];
         if(!q[key]&&salaryRestoreAllowed(row.name,row.saved)&&(!m||dateMs(row.saved)>dateMs(m.saved_at))){
           putSalaryOperation({type:'save',name:row.name,at:row.saved||new Date(0).toISOString(),id:Date.now().toString(36)+'_'+Math.random().toString(36).slice(2)});
         }
       });
       var hadPending=salaryPending();
       await flushSalaryOutbox();
       if(hadPending)await applySalarySnapshot(await salarySnapshot());
       salarySyncAt=Date.now();
       if(salaryPending()){storageLabel('Changes queued · cloud sync pending');setBadge('busy','Cloud sync pending');return false}
       storageLabel(root.FILES.length+' files · cloud confirmed');setBadge('ok','Shared files synced');return true;
     }catch(e){storageLabel('Cloud sync pending · '+e.message);setBadge('bad','Cloud unavailable · retry pending');return false}
   })();
   try{return await salarySyncFlight}finally{salarySyncFlight=null}
 }

 function boot(){
   setBadge('ok','🔥 Firebase Live');
   hookSalary();hookSalaryDelete();hookClearDb();hookHr();hookHrDelete();
   startServerSyncListener();

   // Start Firebase Realtime Listener
   startFirebaseListener();

   // Proactive instant fetch on boot for immediate 0ms sync (only if quota not exhausted)
   if(!root.__atplFirebaseQuotaExhausted && root.ATPLFirebase && typeof root.ATPLFirebase.fetchAllSalaryFiles==='function'){
     root.ATPLFirebase.fetchAllSalaryFiles().then(function(fbFiles){
       handleFirebaseFilesUpdate({all:fbFiles,removedNames:[]});
     }).catch(function(){});
   }
   if(!root.__atplFirebaseQuotaExhausted && root.ATPLFirebase && typeof root.ATPLFirebase.fetchAllTombstones==='function'){
     root.ATPLFirebase.fetchAllTombstones().then(function(tombs){
       handleFirebaseTombstonesUpdate(tombs);
     }).catch(function(){});
   }

   if(!root.__atplFirebaseQuotaExhausted && root.ATPLFirebase && typeof root.ATPLFirebase.fetchAllHrDocs==='function'){
     root.ATPLFirebase.fetchAllHrDocs().then(function(fbDocs){
       handleFirebaseHrUpdate({all:fbDocs,removedIds:[]});
     }).catch(function(){});
   }
   if(!root.__atplFirebaseQuotaExhausted && root.ATPLFirebase && typeof root.ATPLFirebase.fetchAllHrTombstones==='function'){
     root.ATPLFirebase.fetchAllHrTombstones().then(function(tombs){
       handleFirebaseHrTombstonesUpdate(tombs);
     }).catch(function(){});
   }

   [400,1200,3000].forEach(function(ms){
     setTimeout(function(){
       hookSalary();hookSalaryDelete();hookClearDb();hookHr();hookHrDelete();
       startFirebaseListener();
       if(token())syncNow(false);
     },ms);
   });

   root.document.addEventListener('atpl-authenticated',function(){
     setTimeout(function(){hookSalary();hookSalaryDelete();hookClearDb();hookHr();hookHrDelete();startFirebaseListener();syncNow(true);syncWithServer(true)},600);
   });
   root.addEventListener('online',function(){
     setTimeout(function(){startFirebaseListener();syncNow(true);syncWithServer(true)},800);
   });
   root.document.addEventListener('atpl-local-files-restored',function(){
     setTimeout(function(){syncWithServer(true)},300);
   });
   root.document.addEventListener('visibilitychange',function(){
     if(!root.document.hidden){
       startFirebaseListener();
       syncWithServer(false);
       if(token())setTimeout(function(){syncNow(false)},300);
     }
   });
   root.addEventListener('focus',function(){
     startFirebaseListener();
     syncWithServer(false);
     if(token())setTimeout(function(){syncNow(false)},300);
   });
   root.document.addEventListener('click',function(e){
     var x=e.target&&e.target.closest?e.target.closest('#vn-cmd,#vn-files,#vn-mamsalary,#vn-sync,#vn-hrdocs,#vn-empmaster,#vn-challan,#vn-audit,#vn-machineaudit'):null;
     if(x){
       startFirebaseListener();
       syncWithServer(false);
       if(token())setTimeout(function(){syncNow(false)},150);
     }
   },false);

   // Gentle background sync interval - only reconnects listener if idle
   setInterval(function(){
     if(!root.document.hidden && token()){
       startFirebaseListener();
     }
   }, 120000);

   if(root.BroadcastChannel){
     try{
       var bc=new root.BroadcastChannel('ATPL_ERP_SHARED_V2');
       bc.onmessage=function(ev){
         if(ev&&ev.data&&(ev.data.type==='salary_file_deleted'||ev.data.type==='salary_file_saved')){
           syncNow(true);
           syncWithServer(true);
         }
       };
     }catch(_){}
   }
 }

 root.atplForceSyncAllFiles=function(){return syncWithServer(true);};

 root.ATPLCloudSharedStorageV1={
   clearSalary:function(){return queueSharedSalary('clear',SALARY_CLEAR_KEY,new Date().toISOString())},
   syncNow:function(f){return syncNow(!!f)},
   forceSyncAllFiles:function(){return syncWithServer(true);},
   saveSalary:cloudSaveSalary,
   deleteSalary:cloudDeleteSalary,
   saveHrDoc:cloudSaveHr,
   startFirebaseListener:startFirebaseListener,
   status:function(){return{build:BUILD,lastPull:lastPull,remoteSystemRecords:remoteRecords.length,token:!!token(),salaryAuthority:sharedSalaryAuthority?'apps-script':'legacy',salaryPending:sharedSalaryAuthority?salaryPending():0,firebase:!!root.ATPLFirebase,files:Array.isArray(root.FILES)?root.FILES.length:0}}
 };

 if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})(window);


