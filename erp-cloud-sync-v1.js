/* ATPL ERP Cloud Sync V1.3 — backend-confirmed Employee Master persistence.
   Safety goals:
   - "Saved" means backend write + cloud read-back verification succeeded.
   - Same employee saves are serialized; stale queued requests cannot overtake newer ones.
   - Cloud version metadata is preserved locally for conflict detection.
   - Old/stale browser copies are blocked from silently overwriting newer cloud data.
   - Existing shared modules and legacy local writes remain compatible.
*/
(function(root){'use strict';
  if(!root||root.__ATPL_ERP_CLOUD_SYNC_V13__)return;root.__ATPL_ERP_CLOUD_SYNC_V13__=1;
  var API='https://script.google.com/macros/s/AKfycby99_893hVtbWOQr67ikxIwiq81MWW8JAa2LuxTu67JBxjQ_iWb-YkqhBmW0RrHU512SQ/exec';
  var MASTER='AroraTextilesEmployeeMasterV3',TOKEN='ATPL_RemoteToken_V1',ALT_TOKEN='ATPL_SharedToken_V1',SESS='ATPL_UserSession_V5',USERS='ATPL_UserAccess_V1',SYS='__ATPL_SYS__',DIRTY='ATPL_EmployeeMasterPendingV3';
  var backendReady=null,syncing=false,running=0,MAX=2,lastPull=0,wakeTimer=0,queueMap={},queueOrder=[],chains={},conflicts={},dirty=normalizePending(J(root.localStorage.getItem(DIRTY)||'{}',{}));

  function text(v){return v==null?'':String(v).trim()}
  function J(v,d){try{return JSON.parse(v)}catch(_){return d}}
  function idKey(v){var s=text(v).toLowerCase();if(/^\d+$/.test(s)){var z=s.replace(/^0+(?=\d)/,'');return z||'0'}return s}
  function normalizePending(o){var x={};Object.keys(o||{}).forEach(function(k){x[idKey(k)]=Number(o[k]&&o[k].ts||o[k])||Date.now()});return x}
  function tok(){try{var a=root.sessionStorage.getItem(TOKEN)||root.localStorage.getItem(TOKEN)||'',b=root.sessionStorage.getItem(ALT_TOKEN)||root.localStorage.getItem(ALT_TOKEN)||'',t=a||b;if(t){if(!a)root.sessionStorage.setItem(TOKEN,t);if(!b)root.sessionStorage.setItem(ALT_TOKEN,t)}return t}catch(_){return''}}
  function session(){try{var s=J(root.sessionStorage.getItem(SESS)||root.localStorage.getItem(SESS)||'null',null);if(!s||!s.id)return null;var us=J(root.localStorage.getItem(USERS)||'[]',[]),u=(Array.isArray(us)?us:[]).find(function(x){return idKey(x&&x.id)===idKey(s.id)});return u||{id:s.id,name:s.id,admin:false}}catch(_){return null}}
  function codeOf(r){return text(r&&(r.emp_id||r.empCode||r.employee_code||r.code))}
  function keyOf(r){return idKey(codeOf(r))}
  function isSystemRecord(r){var id=codeOf(r);return id.indexOf(SYS)===0||!!(r&&r._atpl_system)}
  function employeeRecords(a){return (Array.isArray(a)?a:[]).filter(function(r){return !isSystemRecord(r)})}
  function cleanRecord(r){var o={};Object.keys(r||{}).forEach(function(k){if(k.indexOf('_cloud_')!==0&&k.indexOf('_local_')!==0)o[k]=r[k]});return o}
  function stableRecord(r){var c=cleanRecord(r),o={};Object.keys(c).sort().forEach(function(k){o[k]=c[k]});return JSON.stringify(o)}
  function samePayload(a,b){return !!a&&!!b&&stableRecord(a)===stableRecord(b)}
  function cloudRecord(r){var o=cleanRecord(r);if(r&&r._cloud_updated_at)o._cloud_updated_at=text(r._cloud_updated_at);if(r&&r._cloud_updated_by)o._cloud_updated_by=text(r._cloud_updated_by);return o}
  function savePending(){try{root.localStorage.setItem(DIRTY,JSON.stringify(dirty))}catch(_){}}
  function markDirty(r){var k=keyOf(r);if(!k)return;dirty[k]=Date.now();savePending()}
  function clearDirty(id){var k=idKey(id);if(dirty[k]){delete dirty[k];savePending()}if(conflicts[k])delete conflicts[k]}
  function api(params,timeout){/* broker-routed-cloud-sync */if(root.ATPLCloudAPI)return root.ATPLCloudAPI.request(params,{timeout:timeout,source:'employee-master'});return new Promise(function(resolve,reject){var cb='__atpl_cloud_'+Date.now()+'_'+Math.random().toString(36).slice(2),s=root.document.createElement('script'),done=false,t=setTimeout(function(){finish();reject(new Error('Cloud sync timeout'))},timeout||15000);function finish(){if(done)return;done=true;clearTimeout(t);try{delete root[cb]}catch(_){root[cb]=undefined}if(s.parentNode)s.parentNode.removeChild(s)}root[cb]=function(data){finish();resolve(data||{})};params=params||{};params.callback=cb;params._ts=Date.now();var qs=Object.keys(params).map(function(k){return encodeURIComponent(k)+'='+encodeURIComponent(params[k]==null?'':String(params[k]))}).join('&');s.onerror=function(){finish();reject(new Error('Cloud sync connect failed'))};s.async=true;s.src=API+'?'+qs;(root.document.head||root.document.documentElement).appendChild(s)})}
  function markBackend(data){if(data&&data.ok===false&&/unknown action/i.test(text(data.error))){backendReady=false;return false}if(data&&data.ok===true){backendReady=true;return true}return backendReady===true}
  async function fetchCloud(){var token=tok();if(!token)throw new Error('Login token missing');var d=await api({action:'getEmployeeMaster',token:token},8000);if(!markBackend(d)||!Array.isArray(d.records))throw new Error(d&&d.error||'Employee Master backend unavailable');return employeeRecords(d.records)}
  function remoteMap(records){var m={};employeeRecords(records).forEach(function(r){var k=keyOf(r);if(k)m[k]=r});return m}
  function conflictCheck(record,baseRecord,remote){
    if(!remote)return null;
    if(samePayload(record,remote))return null;
    var base=baseRecord||record,baseVer=text(base&&base._cloud_updated_at),remoteVer=text(remote&&remote._cloud_updated_at);
    if(baseVer&&remoteVer){
      if(baseVer!==remoteVer&&!samePayload(base,remote))return{conflict:true,error:'A newer backend version already exists.',remote:cloudRecord(remote)};
      return null;
    }
    if(baseRecord&&samePayload(baseRecord,remote))return null;
    if(!baseVer&&!baseRecord)return{conflict:true,error:'Cloud version is newer or unknown. Refresh before overwriting this employee.',remote:cloudRecord(remote)};
    if(baseRecord&&!samePayload(baseRecord,remote))return{conflict:true,error:'This employee changed on another browser/device. Refresh and review before saving.',remote:cloudRecord(remote)};
    return null;
  }
  function persistLocal(records){
    try{syncing=true;records=employeeRecords(records).map(cloudRecord);root.localStorage.setItem(MASTER,JSON.stringify(records));return true}catch(_){return false}finally{syncing=false}
  }
  function renderMaster(a){
    try{
      syncing=true;a=employeeRecords(a).map(cloudRecord);root.localStorage.setItem(MASTER,JSON.stringify(a));
      if(root.EM&&Array.isArray(root.EM.data)){root.EM.data=a.slice();if(typeof root.emFilter==='function')root.emFilter();if(typeof root.emUpdateStats==='function')root.emUpdateStats()}
      if(Array.isArray(root.EMP_MASTER_DATA)){root.EMP_MASTER_DATA.length=0;Array.prototype.push.apply(root.EMP_MASTER_DATA,a)}
      if(root.BroadcastChannel){try{var bc=new root.BroadcastChannel('ATPL_ERP_SHARED_V2');bc.postMessage({type:'master',data:a});bc.close()}catch(_){}}
    }finally{syncing=false}
  }
  function mergeCloud(local,cloud){
    var map={},order=[];
    employeeRecords(local).forEach(function(r){var k=keyOf(r);if(!k)return;if(!map[k])order.push(k);map[k]=r});
    employeeRecords(cloud).forEach(function(r){
      var k=keyOf(r);if(!k)return;if(!map[k])order.push(k);
      if(!dirty[k]){map[k]=cloudRecord(r);return}
      if(map[k]&&samePayload(map[k],r)){map[k]=cloudRecord(r);clearDirty(k)}
      else if(map[k]&&text(map[k]._cloud_updated_at)&&text(r._cloud_updated_at)!==text(map[k]._cloud_updated_at))conflicts[k]={remote:cloudRecord(r),error:'Cloud changed while local edit is pending.'};
    });
    return order.map(function(k){return map[k]})
  }
  function serialize(k,fn){
    var prev=chains[k]||Promise.resolve(),next=prev.catch(function(){}).then(fn),tracked;
    tracked=next.finally(function(){if(chains[k]===tracked)delete chains[k]});chains[k]=tracked;
    return tracked
  }
  async function upsertRaw(record){
    var id=codeOf(record),token=tok();if(!id||isSystemRecord(record)||!token)throw new Error('Valid employee/login required');
    var d=await api({action:'upsertEmployeeMaster',token:token,emp_id:id,record_json:JSON.stringify(cleanRecord(record))},18000);
    if(!markBackend(d)||!d.ok)throw new Error(d&&d.error||'Backend save failed');
    return d
  }
  function saveMaster(record,opts){
    opts=opts||{};var k=keyOf(record);if(!k)return Promise.resolve({ok:false,error:'Employee code required'});
    return serialize(k,async function(){
      try{
        var remote=remoteMap(await fetchCloud())[k]||null;
        if(opts.isNew&&remote&&!samePayload(record,remote)){
          var exists={conflict:true,error:'Employee code already exists in shared backend. Refresh Employee Master and edit the existing employee instead.',remote:cloudRecord(remote)};
          conflicts[k]=exists;return{ok:false,conflict:true,duplicate:true,error:exists.error,remote:exists.remote}
        }
        var conf=conflictCheck(record,opts.baseRecord||null,remote);
        if(conf){conflicts[k]=conf;return{ok:false,conflict:true,error:conf.error,remote:conf.remote}}
        if(remote&&samePayload(record,remote)){
          var already=cloudRecord(remote);clearDirty(k);if(opts.commitLocal)commitConfirmed(already);return{ok:true,record:already,verified:true,noChange:true}
        }
        await upsertRaw(record);
        var verify=remoteMap(await fetchCloud())[k]||null;
        if(!verify||!samePayload(record,verify))throw new Error('Backend did not confirm the exact saved employee record');
        var confirmed=cloudRecord(verify);clearDirty(k);if(opts.commitLocal)commitConfirmed(confirmed);
        return{ok:true,record:confirmed,verified:true}
      }catch(e){
        if(opts.background)markDirty(record);
        return{ok:false,error:e&&e.message?e.message:String(e)}
      }
    })
  }
  function commitConfirmed(rec){
    var local=employeeRecords(J(root.localStorage.getItem(MASTER)||'[]',[])),k=keyOf(rec),found=false;
    local=local.map(function(r){if(keyOf(r)===k){found=true;return cloudRecord(rec)}return r});if(!found)local.push(cloudRecord(rec));
    persistLocal(local);
    if(root.EM&&Array.isArray(root.EM.data)){var idx=root.EM.data.findIndex(function(r){return keyOf(r)===k});if(idx>=0)root.EM.data[idx]=cloudRecord(rec);else root.EM.data.push(cloudRecord(rec))}
  }
  async function saveMany(items){
    items=Array.isArray(items)?items:[];if(!items.length)return{ok:true,saved:0,failed:0,results:[]};
    var remoteRecords;
    try{remoteRecords=await fetchCloud()}catch(e){return{ok:false,saved:0,failed:items.length,results:items.map(function(x){return{ok:false,error:e.message,record:x&&x.record}})}}
    var rm=remoteMap(remoteRecords),safe=[],results=[];
    items.forEach(function(it){
      var r=it&&it.record||it,k=keyOf(r),conf=k?conflictCheck(r,it&&it.baseRecord||null,rm[k]||null):{conflict:false,error:'Employee code required'};
      if(!k)results.push({ok:false,error:'Employee code required',record:r});
      else if(conf){conflicts[k]=conf;results.push({ok:false,conflict:true,error:conf.error,remote:conf.remote,record:r})}
      else if(rm[k]&&samePayload(r,rm[k]))results.push({ok:true,record:cloudRecord(rm[k]),verified:true,noChange:true});
      else safe.push({record:r,key:k});
    });
    var at=0,writeErrors={};
    async function worker(){while(true){var i=at++;if(i>=safe.length)return;var x=safe[i];try{await serialize(x.key,function(){return upsertRaw(x.record)});}catch(e){writeErrors[x.key]=e&&e.message?e.message:String(e)}}}
    var ws=[];for(var n=0;n<Math.min(2,safe.length);n++)ws.push(worker());await Promise.all(ws);
    var verifyRecords=[];
    try{verifyRecords=await fetchCloud()}catch(e){safe.forEach(function(x){if(!writeErrors[x.key])writeErrors[x.key]='Save sent but backend read-back failed: '+e.message})}
    var vm=remoteMap(verifyRecords);
    safe.forEach(function(x){var v=vm[x.key];if(writeErrors[x.key])results.push({ok:false,error:writeErrors[x.key],record:x.record});else if(!v||!samePayload(x.record,v))results.push({ok:false,error:'Backend read-back mismatch',record:x.record});else{clearDirty(x.key);results.push({ok:true,record:cloudRecord(v),verified:true})}});
    var saved=results.filter(function(x){return x.ok}).length,failed=results.length-saved;
    return{ok:failed===0,saved:saved,failed:failed,results:results}
  }
  function deleteMaster(id,opts){
    opts=opts||{};var k=idKey(id);if(!k)return Promise.resolve({ok:false,error:'Employee code required'});
    return serialize(k,async function(){
      try{
        var records=await fetchCloud(),remote=remoteMap(records)[k]||null;
        if(remote&&opts.baseRecord){
          var conf=conflictCheck(opts.baseRecord,opts.baseRecord,remote);
          if(conf&&!samePayload(opts.baseRecord,remote)){conflicts[k]=conf;return{ok:false,conflict:true,error:conf.error,remote:conf.remote}}
        }else if(remote&&!opts.baseRecord)return{ok:false,conflict:true,error:'Refresh Employee Master before deleting this record.',remote:cloudRecord(remote)};
        var d=await api({action:'deleteEmployeeMaster',token:tok(),emp_id:codeOf(remote||opts.baseRecord||{emp_id:id})},18000);
        if(!markBackend(d)||!d.ok)throw new Error(d&&d.error||'Backend delete failed');
        var verify=remoteMap(await fetchCloud())[k];if(verify)throw new Error('Backend delete was not confirmed');
        clearDirty(k);return{ok:true,verified:true}
      }catch(e){return{ok:false,error:e&&e.message?e.message:String(e)}}
    })
  }
  function pushRecord(r){
    var k=keyOf(r);if(!k||conflicts[k]||backendReady===false)return Promise.resolve(false);
    markDirty(r);return saveMaster(r,{baseRecord:r,background:true,commitLocal:true}).then(function(x){return !!(x&&x.ok)})
  }
  function pump(){
    while(running<MAX&&queueOrder.length){
      var k=queueOrder.shift(),r=queueMap[k];delete queueMap[k];if(!r)continue;
      running++;pushRecord(r).finally(function(){running--;pump()})
    }
  }
  function enqueue(records){
    employeeRecords(records).forEach(function(r){var k=keyOf(r);if(!k||conflicts[k])return;var isNew=!queueMap[k];queueMap[k]=r;if(isNew)queueOrder.push(k)});pump()
  }
  function changed(before,after){
    var b={},out=[];employeeRecords(before).forEach(function(r){var k=keyOf(r);if(k)b[k]=stableRecord(r)});
    employeeRecords(after).forEach(function(r){var k=keyOf(r);if(k&&b[k]!==stableRecord(r))out.push(r)});return out
  }
  function retryPending(){
    try{
      if(!tok()||backendReady===false)return;
      var local=employeeRecords(J(root.localStorage.getItem(MASTER)||'[]',[])),map={};local.forEach(function(r){var k=keyOf(r);if(k)map[k]=r});
      var retry=[];Object.keys(dirty).forEach(function(k){if(map[k]&&!conflicts[k])retry.push(map[k])});if(retry.length)enqueue(retry)
    }catch(_){}
  }
  function pullMaster(force){
    var token=tok();if(!token||backendReady===false)return Promise.resolve(false);if(!force&&Date.now()-lastPull<8000)return Promise.resolve(false);lastPull=Date.now();
    return fetchCloud().then(function(cloud){var local=employeeRecords(J(root.localStorage.getItem(MASTER)||'[]',[]));if(!cloud.length){var u=session();if(u&&u.admin===true&&local.length)enqueue(local);return true}var merged=mergeCloud(local,cloud);if(JSON.stringify(merged)!==JSON.stringify(local))renderMaster(merged);return true}).catch(function(){return false})
  }
  function syncSharedModules(){try{if(root.ATPLSharedActivityV2&&typeof root.ATPLSharedActivityV2.syncCloud==='function')root.ATPLSharedActivityV2.syncCloud()}catch(_){}}
  function wakeCloud(delay){try{if(wakeTimer)root.clearTimeout(wakeTimer);wakeTimer=root.setTimeout(function(){wakeTimer=0;if(!tok())return;retryPending();probe();syncSharedModules()},delay==null?80:delay)}catch(_){}}
  function patchStorage(){
    try{
      var proto=root.Storage&&root.Storage.prototype;if(!proto||proto.__atplCloudMasterV13)return;var old=proto.setItem;
      proto.setItem=function(k,v){
        var sk=String(k),isMaster=this===root.localStorage&&sk===MASTER&&!syncing,isToken=this===root.sessionStorage&&(sk===TOKEN||sk===ALT_TOKEN),before=isMaster?employeeRecords(J(this.getItem(k)||'[]',[])):null;
        if(isMaster){try{v=JSON.stringify(employeeRecords(J(String(v||'[]'),[])))}catch(_){}}
        var res=old.call(this,k,v);
        if(isMaster){var after=employeeRecords(J(String(v||'[]'),[])),c=changed(before,after);if(c.length){c.forEach(markDirty);enqueue(c)}}
        if(isToken&&text(v))wakeCloud(60);return res
      };proto.__atplCloudMasterV13=true
    }catch(_){}
  }
  function addStatusBadge(){try{if(root.document.getElementById('atplCloudSyncBadge'))return;var h=root.document.querySelector('.header-right');if(!h)return;var b=root.document.createElement('span');b.id='atplCloudSyncBadge';b.style.cssText='display:none;font-size:9px;padding:4px 7px;border-radius:999px;background:#ecfdf5;color:#047857;border:1px solid #a7f3d0;font-weight:700';b.textContent='☁ Shared Data';h.appendChild(b)}catch(_){}}
  function paint(){var b=root.document.getElementById('atplCloudSyncBadge');if(!b)return;b.style.display=backendReady===true?'inline-flex':'none';b.textContent=Object.keys(conflicts).length?'⚠ Shared Data Conflict':'☁ Shared Data';b.style.background=Object.keys(conflicts).length?'#fffbeb':'#ecfdf5';b.style.color=Object.keys(conflicts).length?'#92400e':'#047857'}
  function probe(){if(!tok())return Promise.resolve(false);return fetchCloud().then(function(cloud){paint();var local=employeeRecords(J(root.localStorage.getItem(MASTER)||'[]',[]));if(cloud.length){var merged=mergeCloud(local,cloud);if(JSON.stringify(merged)!==JSON.stringify(local))renderMaster(merged)}else{var u=session();if(u&&u.admin===true&&local.length)enqueue(local)}return true}).catch(function(){paint();return false})}
  function boot(){patchStorage();addStatusBadge();tok();root.setTimeout(probe,2600);root.addEventListener('online',function(){wakeCloud(500)});root.document.addEventListener('visibilitychange',function(){if(!root.document.hidden&&tok()&&Date.now()-lastPull>60000)wakeCloud(250)});root.document.addEventListener('click',function(e){var x=e.target&&e.target.closest?e.target.closest('#vn-employee,#vn-emaster,#vn-emp,#vn-employees,#vn-empmaster'):null;if(x)root.setTimeout(function(){retryPending();pullMaster(true);syncSharedModules()},120)},false)}
  root.ATPLCloudSyncV1={
    pullMaster:function(){return pullMaster(true)},
    pushMaster:function(r){return saveMaster(r,{baseRecord:r,background:true,commitLocal:true})},
    saveMaster:saveMaster,
    saveMany:saveMany,
    deleteMaster:deleteMaster,
    persistLocal:persistLocal,
    wake:function(){wakeCloud(0)},
    status:function(){return{backendReady:backendReady,queued:queueOrder.length,running:running,token:!!tok(),pending:Object.keys(dirty).length,conflicts:Object.keys(conflicts).length}},
    isSystemRecord:isSystemRecord
  };
  if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})(window);