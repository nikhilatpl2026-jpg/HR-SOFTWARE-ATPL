/* ATPL ERP Cloud Shared Storage V1
   Cross-user/device sharing for Salary/Mam saved workbooks and HR Document records.
   Powered by Firebase Firestore Real-Time Cloud Engine + Resilient Local Fallback. */
(function(root){'use strict';
 var BUILD='2026.09.26-firebase-realtime-cross-sync-v1';
 if(!root||root.__ATPL_CLOUD_SHARED_STORAGE_V1__===BUILD)return;root.__ATPL_CLOUD_SHARED_STORAGE_V1__=BUILD;
 var API='https://script.google.com/macros/s/AKfycby99_893hVtbWOQr67ikxIwiq81MWW8JAa2LuxTu67JBxjQ_iWb-YkqhBmW0RrHU512SQ/exec';
 var TOKEN='ATPL_RemoteToken_V1',ALT='ATPL_SharedToken_V1',SESS='ATPL_UserSession_V5',SYS='__ATPL_SYS__';
 var SALARY_DB='AroraTextiles',SALARY_VER=1,SALARY_STORE='salaryFiles';
 var HR_DB='AroraTextilesHRDocs',HR_VER=1,HR_STORE='documents';
 var CHUNK=900,MAX_CHUNKS=450,CONCURRENCY=3,lastPull=0,pulling=null,remoteRecords=[];
 var TOMB_STORAGE_KEY='ATPL_SALARY_TOMBSTONES_V2',HR_TOMB_KEY='ATPL_HR_TOMBSTONES_V2';
 var firebaseUnsubscribe=null;

 function text(v){return v==null?'':String(v).trim()}
 function J(v,d){try{return JSON.parse(v)}catch(_){return d}}
 function token(){try{return root.sessionStorage.getItem(TOKEN)||root.sessionStorage.getItem(ALT)||root.localStorage.getItem(TOKEN)||root.localStorage.getItem(ALT)||''}catch(_){return''}}
 function user(){try{var s=J(root.sessionStorage.getItem(SESS)||root.localStorage.getItem(SESS)||'null',null);return s&&s.id?{id:String(s.id),name:String(s.name||s.id)}:null}catch(_){return null}}
 function api(params,timeout){if(root.ATPLCloudAPI)return root.ATPLCloudAPI.request(params,{timeout:timeout,source:'shared-files'});return new Promise(function(resolve,reject){var cb='__atpl_store_'+Date.now()+'_'+Math.random().toString(36).slice(2),s=root.document.createElement('script'),done=false,t=setTimeout(function(){finish();reject(new Error('Shared storage timeout'))},timeout||18000);function finish(){if(done)return;done=true;clearTimeout(t);try{delete root[cb]}catch(_){root[cb]=undefined}if(s.parentNode)s.parentNode.removeChild(s)}root[cb]=function(data){finish();resolve(data||{})};params=Object.assign({},params||{},{callback:cb,_ts:Date.now()});var qs=Object.keys(params).map(function(k){return encodeURIComponent(k)+'='+encodeURIComponent(params[k]==null?'':String(params[k]))}).join('&');s.onerror=function(){finish();reject(new Error('Shared storage connect failed'))};s.async=true;s.src=API+'?'+qs;(root.document.head||root.document.documentElement).appendChild(s)})}
 function fnv(s){var h=2166136261;for(var i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}return('00000000'+(h>>>0).toString(16)).slice(-8)}
 function safeKey(kind,key){return kind.slice(0,2).toUpperCase()+'_'+fnv(String(key||'').toLowerCase())}
 function metaId(k){return SYS+'META__'+k}
 function chunkId(k,i){return SYS+'CHUNK__'+k+'__'+('000'+i.toString(36)).slice(-3)}
 function tombId(k){return SYS+'TOMB__'+k}
 function bytesToB64(bytes){var out='',step=0x8000;for(var i=0;i<bytes.length;i+=step)out+=String.fromCharCode.apply(null,bytes.subarray(i,Math.min(bytes.length,i+step)));return btoa(out)}
 function b64ToBytes(s){var bin=atob(s),a=new Uint8Array(bin.length);for(var i=0;i<bin.length;i++)a[i]=bin.charCodeAt(i);return a}
 async function encodeObject(obj){var raw=new TextEncoder().encode(JSON.stringify(obj)),bytes=raw,encoding='utf8-base64';if(typeof root.CompressionStream==='function'){try{var cs=new root.CompressionStream('gzip'),ab=await new Response(new Blob([raw]).stream().pipeThrough(cs)).arrayBuffer();bytes=new Uint8Array(ab);encoding='gzip-base64'}catch(_){}}return{encoding:encoding,data:bytesToB64(bytes),rawBytes:raw.length,packedBytes:bytes.length}}
 async function decodeObject(encoding,data){var bytes=b64ToBytes(data);if(encoding==='gzip-base64'){if(typeof root.DecompressionStream==='function'){var ds=new root.DecompressionStream('gzip'),ab=await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer();bytes=new Uint8Array(ab)}else if(root.pako&&typeof root.pako.ungzip==='function')bytes=root.pako.ungzip(bytes);else throw new Error('GZIP decoder unavailable on this browser')}return JSON.parse(new TextDecoder().decode(bytes))}
 async function upsert(id,record,attempt){var tk=token();if(!tk)throw new Error('Login token missing');var d=await api({action:'upsertEmployeeMaster',token:tk,emp_id:id,record_json:JSON.stringify(Object.assign({emp_id:id,_atpl_system:true},record))},20000);if(d&&d.ok)return true;if(!attempt){await new Promise(function(r){setTimeout(r,700)});return upsert(id,record,1)}throw new Error(d&&d.error||'Cloud record save failed')}
 async function remove(id){var tk=token();if(!tk)return false;try{var d=await api({action:'deleteEmployeeMaster',token:tk,emp_id:id},16000);return !!(d&&d.ok)}catch(_){return false}}
 async function pool(tasks,limit){var at=0,failed=null;async function worker(){while(!failed){var i=at++;if(i>=tasks.length)return;try{await tasks[i]()}catch(e){failed=e;return}}}var ws=[];for(var n=0;n<Math.min(limit,tasks.length);n++)ws.push(worker());await Promise.all(ws);if(failed)throw failed}
 function setBadge(state,msg){try{var id='atplCloudFilesBadge',b=root.document.getElementById(id);if(!b){var h=root.document.querySelector('.header-right');if(!h)return;b=root.document.createElement('span');b.id=id;b.style.cssText='display:inline-flex;font-size:9px;padding:4px 7px;border-radius:999px;font-weight:700;border:1px solid #bfdbfe;background:#eff6ff;color:#1d4ed8';h.appendChild(b)}b.textContent=msg||'🔥 Firebase Live';if(state==='bad'){b.style.background='#fef2f2';b.style.color='#b91c1c';b.style.borderColor='#fecaca'}else if(state==='busy'){b.style.background='#fff7ed';b.style.color='#c2410c';b.style.borderColor='#fed7aa'}else{b.style.background='#ecfdf5';b.style.color='#047857';b.style.borderColor='#a7f3d0'}}catch(_){}}
 function storageLabel(msg){try{var x=root.document.getElementById('storageLbl');if(x&&msg)x.textContent=msg}catch(_){}}
 function isSystem(r){return !!r&&(r._atpl_system===true||text(r.emp_id).indexOf(SYS)===0)}
 async function fetchRemote(force){if(!token())return[];if(!force&&remoteRecords.length&&Date.now()-lastPull<10000)return remoteRecords.slice();var d;try{d=await api({action:'getSystemRecords',token:token()},14000);if(d&&d.ok&&Array.isArray(d.records)){remoteRecords=d.records;lastPull=Date.now();return remoteRecords.slice()}}catch(_){}d=await api({action:'getEmployeeMaster',token:token()},22000);if(!(d&&d.ok&&Array.isArray(d.records)))throw new Error(d&&d.error||'Shared records unavailable');remoteRecords=d.records.filter(isSystem);lastPull=Date.now();return remoteRecords.slice()}
 function recordsFor(records,key){var meta=null,chunks={};(records||[]).forEach(function(r){if(r&&r.object_key===key&&r._atpl_kind==='meta')meta=r;else if(r&&r.object_key===key&&r._atpl_kind==='chunk')chunks[Number(r.index)]=String(r.data||'')});return{meta:meta,chunks:chunks}}
 async function saveObject(kind,key,payload,info){var packed=await encodeObject(payload),parts=[];for(var i=0;i<packed.data.length;i+=CHUNK)parts.push(packed.data.slice(i,i+CHUNK));if(parts.length>MAX_CHUNKS)throw new Error('Cloud copy is too large for current shared bridge ('+parts.length+' chunks).');var k=safeKey(kind,key),u=user()||{},tasks=parts.map(function(part,idx){return function(){return upsert(chunkId(k,idx),{_atpl_kind:'chunk',object_kind:kind,object_key:k,index:idx,data:part})}});setBadge('busy','☁ Saving '+text(info&&info.name||kind)+'…');await pool(tasks,CONCURRENCY);var now=new Date().toISOString();await upsert(metaId(k),{_atpl_kind:'meta',object_kind:kind,object_key:k,key_text:String(key||''),name:text(info&&info.name||key),saved_at:text(info&&info.saved_at||now)||now,uploaded_at:now,uploaded_by:u.id||'',uploaded_name:u.name||'',encoding:packed.encoding,chunks:parts.length,raw_bytes:packed.rawBytes,packed_bytes:packed.packedBytes});remoteRecords=[];lastPull=0;setBadge('ok','🔥 Firebase Live');return true}
 async function loadObject(records,meta){if(!meta||!meta.object_key)return null;var x=recordsFor(records,meta.object_key),n=Number(meta.chunks||0),parts=[];for(var i=0;i<n;i++){if(typeof x.chunks[i]!=='string')throw new Error('Incomplete cloud object '+meta.name);parts.push(x.chunks[i])}return decodeObject(meta.encoding,parts.join(''))}
 function trimRows(rows){rows=(rows||[]).map(function(r){r=Array.isArray(r)?r.slice():[];while(r.length&&String(r[r.length-1]==null?'':r[r.length-1]).trim()==='')r.pop();return r});while(rows.length&&(!rows[rows.length-1]||!rows[rows.length-1].some(function(v){return String(v==null?'':v).trim()!==''})))rows.pop();return rows}
 function workbookPayload(name,buf){if(!root.XLSX)throw new Error('Excel engine unavailable');var wb=root.XLSX.read(buf,{type:'array',cellDates:false,cellText:true});return{v:1,name:name,sheets:wb.SheetNames.map(function(sn){var rows=root.XLSX.utils.sheet_to_json(wb.Sheets[sn],{header:1,raw:false,defval:''});return{name:sn,rows:trimRows(rows)}})}}
 function payloadBuffer(p){if(!root.XLSX||!p||!Array.isArray(p.sheets))throw new Error('Shared workbook invalid');var wb=root.XLSX.utils.book_new();p.sheets.forEach(function(s){var ws=root.XLSX.utils.aoa_to_sheet(Array.isArray(s.rows)?s.rows:[]);root.XLSX.utils.book_append_sheet(wb,ws,String(s.name||'Sheet').slice(0,31)||'Sheet')});return root.XLSX.write(wb,{bookType:'xlsx',type:'array',compression:true})}
 function openDb(name,ver,store,keyPath){return new Promise(function(ok,no){try{var r=indexedDB.open(name,ver);r.onupgradeneeded=function(){if(!r.result.objectStoreNames.contains(store))r.result.createObjectStore(store,keyPath?{keyPath:keyPath}:undefined)};r.onsuccess=function(){ok(r.result)};r.onerror=function(){no(r.error)}}catch(e){no(e)}})}
 async function salaryRows(){try{var d=await openDb(SALARY_DB,SALARY_VER,SALARY_STORE,'name');return await new Promise(function(ok){var r=d.transaction(SALARY_STORE,'readonly').objectStore(SALARY_STORE).getAll();r.onsuccess=function(){d.close();ok(r.result||[])};r.onerror=function(){d.close();ok([])}})}catch(_){return[]}}
 async function putSalary(name,buf,saved){var d=await openDb(SALARY_DB,SALARY_VER,SALARY_STORE,'name');return new Promise(function(ok,no){var t=d.transaction(SALARY_STORE,'readwrite');t.objectStore(SALARY_STORE).put({name:name,buf:buf,saved:saved||new Date().toISOString()});t.oncomplete=function(){d.close();ok(true)};t.onerror=function(){var e=t.error;d.close();no(e)}})}
 async function deleteSalaryFromDb(name){try{var d=await openDb(SALARY_DB,SALARY_VER,SALARY_STORE,'name');return new Promise(function(ok){var t=d.transaction(SALARY_STORE,'readwrite');t.objectStore(SALARY_STORE).delete(name);t.oncomplete=function(){d.close();ok(true)};t.onerror=function(){d.close();ok(false)}})}catch(_){return false}}
 async function hrRows(){try{var d=await openDb(HR_DB,HR_VER,HR_STORE,'id');return await new Promise(function(ok){var r=d.transaction(HR_STORE,'readonly').objectStore(HR_STORE).getAll();r.onsuccess=function(){d.close();ok(r.result||[])};r.onerror=function(){d.close();ok([])}})}catch(_){return[]}}
 async function putHrDoc(doc){var d=await openDb(HR_DB,HR_VER,HR_STORE,'id');return new Promise(function(ok,no){var t=d.transaction(HR_STORE,'readwrite');t.objectStore(HR_STORE).put(doc);t.oncomplete=function(){d.close();ok(true)};t.onerror=function(){var e=t.error;d.close();no(e)}})}
 async function deleteHrDocFromDb(id){try{var d=await openDb(HR_DB,HR_VER,HR_STORE,'id');return new Promise(function(ok){var t=d.transaction(HR_STORE,'readwrite');t.objectStore(HR_STORE).delete(id);t.oncomplete=function(){d.close();ok(true)};t.onerror=function(){d.close();ok(false)}})}catch(_){return false}}
 function dateMs(v){var n=Date.parse(v||'');return isFinite(n)?n:0}

 function getLocalSalaryTombstones(){return J(root.localStorage.getItem(TOMB_STORAGE_KEY)||'{}',{})}
 function saveLocalSalaryTombstone(name){var t=getLocalSalaryTombstones();t[String(name).toLowerCase()]=new Date().toISOString();root.localStorage.setItem(TOMB_STORAGE_KEY,JSON.stringify(t))}
 function clearLocalSalaryTombstone(name){var t=getLocalSalaryTombstones();delete t[String(name).toLowerCase()];root.localStorage.setItem(TOMB_STORAGE_KEY,JSON.stringify(t))}

 function getLocalHrTombstones(){return J(root.localStorage.getItem(HR_TOMB_KEY)||'{}',{})}
 function saveLocalHrTombstone(id){var t=getLocalHrTombstones();t[String(id).toLowerCase()]=new Date().toISOString();root.localStorage.setItem(HR_TOMB_KEY,JSON.stringify(t))}

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

   var local=await salaryRows(),changed=0,cloudAuthoritative=(Array.isArray(records)&&records.length>0);

   // Purge tombstoned or cloud-deleted files locally in this browser
   for(var j=0;j<local.length;j++){
     var row=local[j],lk=String(row.name||'').toLowerCase();
     var isTomb=!!tombstones[lk],isMissing=cloudAuthoritative&&!remoteBy[lk];
     if(isTomb||isMissing){
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
   if(changed)refreshSalaryUi();
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
     var row=local[i];if(!row||!row.name||!row.buf)continue;
     var key=String(row.name).toLowerCase();
     if(tombstones[key]){
       console.log('[Auto-Delete] Purging tombstoned local file instead of re-pushing:',row.name);
       await deleteSalaryFromDb(row.name);
       continue;
     }
     var m=remoteBy[key],localTs=dateMs(row.saved),remoteTs=dateMs(m&&m.saved_at);
     if(cloudAuthoritative&&!m){
       console.log('[Auto-Delete] Purging tombstoned local file instead of re-pushing:',row.name);
       await deleteSalaryFromDb(row.name);
       saveLocalSalaryTombstone(row.name);
       continue;
     }
     if(m&&remoteTs>=localTs)continue;
     if(!row._justUploaded&&!m)continue;
     try{
       var payload=workbookPayload(row.name,row.buf);
       await saveObject('salary_file',row.name,payload,{name:row.name,saved_at:row.saved||new Date().toISOString()});
       clearLocalSalaryTombstone(row.name);
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
     var isTomb=!!tombstones[hk],isMissing=cloudAuthoritative&&!remoteBy[hk];
     if(isTomb||isMissing){
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

 async function refreshSalaryUi(){
   try{
     var rows = await salaryRows();
     var tombs = getLocalSalaryTombstones();
     rows = (rows || []).filter(function(r){ return r && r.name && !tombs[String(r.name).toLowerCase()]; });
     if(typeof root.parseWB==='function' && typeof root.wbToSheets==='function'){
       root.FILES = rows.map(function(r){
         var wb = root.parseWB(r.buf);
         return {name:r.name, wb:wb, sheets:root.wbToSheets(wb), buf:r.buf, savedAt:r.saved};
       });
       ['renderFiles','renderSheets','updStats','renderAllFilesPage','populateNJSelects'].forEach(function(n){
         try{ if(typeof root[n]==='function') root[n](); }catch(_){}
       });
       storageLabel(root.FILES.length+' files saved · 🔥 Realtime Sync');
       var cnt = root.document ? root.document.getElementById('fileCount') : null;
       if(cnt) cnt.textContent = '(' + root.FILES.length + ')';
     }
     if(typeof root.loadAllFromDB==='function'){
       try{ root.loadAllFromDB(function(){}); }catch(_){}
     }
   }catch(e){ console.warn('refreshSalaryUi failed', e); }
 }

 function refreshHrUi(){
   try{
     var ref=typeof root.hrDocGetDocs==='function'?root.hrDocGetDocs():null;
     if(!Array.isArray(ref))return;
     hrRows().then(function(all){
       ref.splice.apply(ref,[0,ref.length].concat(all));
       if(typeof root.hrDocRender==='function')root.hrDocRender();
     });
   }catch(_){}
 }

 /* ==============================================================
    FIREBASE FIRESTORE REALTIME SYNC HANDLERS
    ============================================================== */
 async function handleFirebaseFilesUpdate(payload){
   var remoteList=payload.all||[];
   var removedNames=(payload.removedNames||[]).map(function(n){return String(n).toLowerCase()});
   var remoteByName={};
   remoteList.forEach(function(doc){
     if(doc&&doc.name){remoteByName[String(doc.name).toLowerCase()]=doc}
   });

   var local=await salaryRows();
   var changed=0;

   // 1. Strict Auto-Delete: Remove local files that were deleted in Firebase
   for(var j=0;j<local.length;j++){
     var row=local[j];
     var lk=String(row.name||'').toLowerCase();
     var isExplicitRemoved=removedNames.indexOf(lk)>=0;
     var isNotPresentInCloud=!remoteByName[lk];
     if(isExplicitRemoved||isNotPresentInCloud){
       console.log('[Firebase Auto-Delete] Purging removed file:',row.name);
       await deleteSalaryFromDb(row.name);
       saveLocalSalaryTombstone(row.name);
       if(typeof root.deleteFromDB==='function'&&root.deleteFromDB.__original){
         try{root.deleteFromDB.__original(row.name)}catch(_){}
       }
       if(Array.isArray(root.FILES)){
         root.FILES=root.FILES.filter(function(f){return !f||String(f.name||'').toLowerCase()!==lk});
       }
       changed++;
     }
   }

   // 2. Load or update files from Firebase
   for(var i=0;i<remoteList.length;i++){
     var doc=remoteList[i];
     if(!doc||!doc.name||(!doc.sheets&&!doc.sheets_b64&&!doc.is_gzip))continue;
     var rk=String(doc.name).toLowerCase();
     var old=local.find(function(x){return String(x.name||'').toLowerCase()===rk});
     if(old&&dateMs(old.saved)>=dateMs(doc.saved_at||doc.uploaded_at))continue;

     try{
       var sheetData=null;
       if(root.ATPLFirebase&&typeof root.ATPLFirebase.decodeDocPayload==='function'){
         sheetData=await root.ATPLFirebase.decodeDocPayload(doc);
       }
       if(!sheetData&&doc.sheets){
         sheetData=typeof doc.sheets==='string'?J(doc.sheets,null):doc.sheets;
       }
       if(sheetData){
         var p={v:1,name:doc.name,sheets:Array.isArray(sheetData.sheets)?sheetData.sheets:sheetData};
         var buf=payloadBuffer(p);
         await putSalary(doc.name,buf,doc.saved_at||doc.uploaded_at);
         changed++;
       }
     }catch(e){console.warn('Firebase parse buffer warning',doc.name,e)}
   }

   if(changed||local.length!==remoteList.length){
     refreshSalaryUi();
   }
   setBadge('ok','🔥 Firebase Live ('+remoteList.length+')');
   storageLabel(remoteList.length+' files saved · 🔥 Realtime');
 }

 var firebaseTombUnsubscribe=null;
 async function handleFirebaseTombstonesUpdate(tombstonesList){
   if(!Array.isArray(tombstonesList)||!tombstonesList.length)return;
   var local=await salaryRows(),changed=0;
   var tombMap={};
   tombstonesList.forEach(function(t){
     if(t&&t.name){
       var k=String(t.name).toLowerCase();
       tombMap[k]=true;
       saveLocalSalaryTombstone(t.name);
     }
   });
   for(var j=0;j<local.length;j++){
     var row=local[j],lk=String(row.name||'').toLowerCase();
     if(tombMap[lk]){
       console.log('[Firebase Auto-Delete] Purging removed file:',row.name);
       await deleteSalaryFromDb(row.name);
       saveLocalSalaryTombstone(row.name);
       if(typeof root.deleteFromDB==='function'&&root.deleteFromDB.__original){
         try{root.deleteFromDB.__original(row.name)}catch(_){}
       }
       if(Array.isArray(root.FILES)){
         root.FILES=root.FILES.filter(function(f){return !f||String(f.name||'').toLowerCase()!==lk});
       }
       changed++;
     }
   }
   if(changed)refreshSalaryUi();
 }

 function startFirebaseListener(){
   if(!root.ATPLFirebase||typeof root.ATPLFirebase.subscribeSalaryFiles!=='function')return false;
   if(firebaseUnsubscribe)return true;
   try{
     firebaseUnsubscribe=root.ATPLFirebase.subscribeSalaryFiles(function(update){
       handleFirebaseFilesUpdate(update).catch(function(e){console.error('Firebase update error',e)});
     },function(err){
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

     console.log('[ATPL-Storage] Realtime Firebase Firestore listener connected');
     setBadge('ok','🔥 Firebase Live');
     return true;
   }catch(e){
     console.warn('Firebase listener initialization failed',e);
     return false;
   }
 }

 async function syncNow(force){
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
   var savedTs=saved||new Date().toISOString();
   clearLocalSalaryTombstone(name);
   var p=workbookPayload(name,buf);

   // 1. Primary: Save directly to Firebase Firestore
   if(root.ATPLFirebase&&typeof root.ATPLFirebase.saveSalaryFile==='function'){
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
   saveLocalSalaryTombstone(name);
   var k=safeKey('salary_file',name);
   if(Array.isArray(root.FILES)){
     root.FILES=root.FILES.filter(function(f){return !f||String(f.name||'').toLowerCase()!==String(name).toLowerCase()});
   }
   refreshSalaryUi();
   storageLabel('Deleting from cloud · '+name);

   // 1. Delete local from IndexedDB
   await deleteSalaryFromDb(name);

   // 2. Primary: Delete from Firebase Firestore (triggers real-time auto-delete across all phones and browsers)
   if(root.ATPLFirebase&&typeof root.ATPLFirebase.deleteSalaryFile==='function'){
     try{
       await root.ATPLFirebase.deleteSalaryFile(name,user()?user().id:'admin');
       console.log('[Firebase] File deleted from Firestore:',name);
     }catch(fe){
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
     var files=Array.isArray(root.FILES)?root.FILES.slice():[];
     return old.call(this,function(){
       try{if(cb)cb()}finally{
         if(root.ATPLFirebase&&typeof root.ATPLFirebase.clearAllSalaryFiles==='function'){
           root.ATPLFirebase.clearAllSalaryFiles(user()?user().id:'admin').catch(function(){});
         }
         files.forEach(function(f){if(f&&f.name)cloudDeleteSalary(f.name)});
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
         try{if(cb)cb()}finally{if(token()&&d&&d.id)cloudSaveHr(d)}
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
     var before=typeof root.hrDocGetDocs==='function'?(root.hrDocGetDocs()||[]).some(function(x){return x.id===id}):false,ret=old.apply(this,arguments);
     setTimeout(async function(){
       var still=typeof root.hrDocGetDocs==='function'?(root.hrDocGetDocs()||[]).some(function(x){return x.id===id}):false;
       if(before&&!still){
         saveLocalHrTombstone(id);
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
       }
     },500);
     return ret;
   }
   del.__atplCloudShared=true;
   root.hrDocDelete=del;
 }

 function boot(){
   setBadge('ok','🔥 Firebase Connecting…');
   hookSalary();hookSalaryDelete();hookClearDb();hookHr();hookHrDelete();

   // Start Firebase Realtime Listener
   startFirebaseListener();

   // Proactive instant fetch on boot for immediate 0ms sync
   if(root.ATPLFirebase&&typeof root.ATPLFirebase.fetchAllSalaryFiles==='function'){
     root.ATPLFirebase.fetchAllSalaryFiles().then(function(fbFiles){
       handleFirebaseFilesUpdate({all:fbFiles,removedNames:[]});
     }).catch(function(){});
   }
   if(root.ATPLFirebase&&typeof root.ATPLFirebase.fetchAllTombstones==='function'){
     root.ATPLFirebase.fetchAllTombstones().then(function(tombs){
       handleFirebaseTombstonesUpdate(tombs);
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
     setTimeout(function(){hookSalary();hookSalaryDelete();hookClearDb();hookHr();hookHrDelete();startFirebaseListener();syncNow(true)},600);
   });
   root.addEventListener('online',function(){
     setTimeout(function(){startFirebaseListener();syncNow(true)},800);
   });
   root.document.addEventListener('visibilitychange',function(){
     if(!root.document.hidden){
       startFirebaseListener();
       if(token())setTimeout(function(){syncNow(false)},300);
     }
   });
   root.addEventListener('focus',function(){
     startFirebaseListener();
     if(token())setTimeout(function(){syncNow(false)},300);
   });
   root.document.addEventListener('click',function(e){
     var x=e.target&&e.target.closest?e.target.closest('#vn-cmd,#vn-files,#vn-mamsalary,#vn-sync,#vn-hrdocs,#vn-empmaster,#vn-challan,#vn-audit,#vn-machineaudit'):null;
     if(x){
       startFirebaseListener();
       if(token())setTimeout(function(){syncNow(false)},150);
     }
   },false);

   // Auto background sync interval
   setInterval(function(){
     if(!root.document.hidden){
       startFirebaseListener();
       if(token())syncNow(false);
     }
   },20000);

   if(root.BroadcastChannel){
     try{
       var bc=new root.BroadcastChannel('ATPL_ERP_SHARED_V2');
       bc.onmessage=function(ev){
         if(ev&&ev.data&&(ev.data.type==='salary_file_deleted'||ev.data.type==='salary_file_saved')){
           syncNow(true);
         }
       };
     }catch(_){}
   }
 }

 root.ATPLCloudSharedStorageV1={
   syncNow:function(f){return syncNow(!!f)},
   saveSalary:cloudSaveSalary,
   deleteSalary:cloudDeleteSalary,
   saveHrDoc:cloudSaveHr,
   startFirebaseListener:startFirebaseListener,
   status:function(){return{build:BUILD,lastPull:lastPull,remoteSystemRecords:remoteRecords.length,token:!!token(),firebase:!!root.ATPLFirebase,files:Array.isArray(root.FILES)?root.FILES.length:0}}
 };

 if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})(window);
