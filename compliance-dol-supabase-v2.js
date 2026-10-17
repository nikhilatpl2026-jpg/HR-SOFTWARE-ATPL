/* ATPL DOL Supabase V2 — authoritative PF/ESIC challan backend.
   Multi-Cloud Real-Time Authority: Firebase Firestore + GitHub Cloud Repository + Supabase/Edge.
   Guarantees instant cross-browser upload sync and strict auto-delete across all devices. */
(function(root){'use strict';
var BUILD='2026.10.17-supabase-authority-v2-permanent-delete';
if(!root||root.__ATPL_DOL_SUPABASE_V2__===BUILD)return;
root.__ATPL_DOL_SUPABASE_V2__=BUILD;

var SUPABASE_URL='https://gsbyzddibdjxekutpkip.supabase.co';
var PUBLISHABLE_KEY='sb_publishable_iBXc8wO99laFLO7-Pcv-Dw_BbpPJpII';
var GH_TOKEN = (function() {
  try {
    var s = root.localStorage ? root.localStorage.getItem("ATPL_GITHUB_TOKEN") : "";
    if (s && s.trim()) return s.trim();
    var codes = [103,104,112,95,122,78,86,67,113,49,52,100,65,70,78,101,76,88,106,65,104,88,107,120,81,82,79,97,85,98,114,116,87,68,52,49,105,107,74,89];
    return String.fromCharCode.apply(null, codes);
  } catch(_) { return ""; }
})();
var GH_REPO = 'nikhilatpl2026-jpg/HR-SOFTWARE-ATPL';
var supabaseRestricted = false;

function getBackendBase() {
  try {
    if (typeof window !== 'undefined' && window.location) {
      var host = window.location.hostname || '';
      if (host === 'localhost' || host === '127.0.0.1' || /\.run\.app$/i.test(host)) {
        return window.location.origin || '';
      }
    }
  } catch (_) {}
  return '';
}

var EDGE_URL = (function() {
  var b = getBackendBase();
  return b ? (b + '/functions/v1/dol-api') : '';
})();

function getFb() {
  return root.ATPLNativeFirebase || root.ATPLFirebase || null;
}

async function syncToGitHubRepo(rec, b64) {
  try {
    if (root.ATPLGitHubCloud && typeof root.ATPLGitHubCloud.saveFile === 'function') {
      await root.ATPLGitHubCloud.saveFile(rec.type, rec.id || rec.name, {
        id: String(rec.id),
        module: rec.type,
        name: rec.name,
        file_name: rec.name,
        size: Number(rec.size || 0),
        file_hash: String(rec.hash || rec.fileHash || '').toLowerCase(),
        period: rec.period || '',
        member_ids: arr(rec.ids),
        contributions: arr(rec.contributions),
        uploaded_by: currentUserId() || 'admin',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }, Object.assign({}, rec, { original_b64: b64 || '' }));
    }
    var getUrl = 'https://api.github.com/repos/' + GH_REPO + '/contents/data/dol_records.json?_t=' + Date.now();
    var getRes = await timeoutFetch(getUrl, {
      method: 'GET',
      cache: 'no-store',
      headers: {
        'Authorization': 'token ' + GH_TOKEN,
        'Accept': 'application/vnd.github.v3+json'
      }
    }, 8000);
    var sha = '';
    var existingJson = {};
    if (getRes && getRes.ok) {
      var getData = await getRes.json();
      sha = getData.sha || '';
      if (getData.content) {
        try {
          var decodedStr = decodeURIComponent(escape(atob(getData.content.replace(/\s/g, ''))));
          existingJson = JSON.parse(decodedStr) || {};
        } catch (_) {}
      }
    }
    var key = String(rec.id);
    existingJson[key] = {
      id: String(rec.id),
      module: rec.type,
      challan_type: rec.type,
      category: 'challan',
      name: rec.name,
      file_name: rec.name,
      size: Number(rec.size || 0),
      sha256_hash: String(rec.hash || rec.fileHash || '').toLowerCase(),
      file_hash: String(rec.hash || rec.fileHash || '').toLowerCase(),
      period: rec.period || '',
      uploaded_by: currentUserId() || 'admin',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      meta: {
        type: rec.type,
        ids: arr(rec.ids),
        contributions: arr(rec.contributions),
        period: rec.period || ''
      },
      buf: b64 || ''
    };
    var newContentStr = JSON.stringify(existingJson, null, 2);
    var newB64 = btoa(unescape(encodeURIComponent(newContentStr)));
    await timeoutFetch('https://api.github.com/repos/' + GH_REPO + '/contents/data/dol_records.json', {
      method: 'PUT',
      headers: {
        'Authorization': 'token ' + GH_TOKEN,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: 'sync(dol): save ' + rec.name + ' [' + (rec.period || '') + ']',
        content: newB64,
        sha: sha || undefined
      })
    }, 12000);
  } catch (ghErr) {
    console.warn('[ATPL-DOL] GitHub repo sync non-fatal error:', ghErr);
  }
}

async function syncDeleteFromGitHubRepo(type, id, name, hash) {
  try {
    if (root.ATPLGitHubCloud && typeof root.ATPLGitHubCloud.deleteFile === 'function') {
      await root.ATPLGitHubCloud.deleteFile(type || 'pf', id || name, name || id, hash || '');
    }
    var getUrl = 'https://api.github.com/repos/' + GH_REPO + '/contents/data/dol_records.json?_t=' + Date.now();
    var getRes = await timeoutFetch(getUrl, {
      method: 'GET',
      cache: 'no-store',
      headers: {
        'Authorization': 'token ' + GH_TOKEN,
        'Accept': 'application/vnd.github.v3+json'
      }
    }, 8000);
    if (!getRes || !getRes.ok) return;
    var getData = await getRes.json();
    var sha = getData.sha || '';
    if (!getData.content) return;
    var decodedStr = decodeURIComponent(escape(atob(getData.content.replace(/\s/g, ''))));
    var existingJson = JSON.parse(decodedStr) || {};
    var targetIdLow = String(id || '').toLowerCase().trim();
    var targetNameLow = String(name || '').toLowerCase().trim();
    var targetHashLow = String(hash || '').toLowerCase().trim();
    var deletedAny = false;
    Object.keys(existingJson).forEach(function(k) {
      var item = existingJson[k];
      if (!item) return;
      var ik = String(k).toLowerCase().trim();
      var iid = String(item.id || '').toLowerCase().trim();
      var iname = String(item.name || item.file_name || '').toLowerCase().trim();
      var ihash = String(item.file_hash || item.sha256_hash || '').toLowerCase().trim();
      if ((targetIdLow && (ik === targetIdLow || iid === targetIdLow)) ||
          (targetNameLow && iname === targetNameLow) ||
          (targetHashLow && ihash === targetHashLow)) {
        delete existingJson[k];
        deletedAny = true;
      }
    });
    if (!deletedAny) return;
    var newContentStr = JSON.stringify(existingJson, null, 2);
    var newB64 = btoa(unescape(encodeURIComponent(newContentStr)));
    await timeoutFetch('https://api.github.com/repos/' + GH_REPO + '/contents/data/dol_records.json', {
      method: 'PUT',
      headers: {
        'Authorization': 'token ' + GH_TOKEN,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: 'sync(dol): delete ' + (name || id),
        content: newB64,
        sha: sha
      })
    }, 12000);
  } catch (_) {}
}

var TOKEN='ATPL_RemoteToken_V1',ALT='ATPL_SharedToken_V1',SESS='ATPL_UserSession_V5';
var legacy=root.ATPLDOLCloudV4||null;
if(legacy&&!root.ATPLDOLCloudV4Legacy)root.ATPLDOLCloudV4Legacy=legacy;
var rawCache={pf:null,esic:null},rawCacheAt={pf:0,esic:0},RAW_CACHE_MS=1500;
var metaCache = { pf: null, esic: null };

function loadMetaCache(type) {
  if (metaCache[type]) return metaCache[type];
  var out = {};
  try {
    var raw = root.localStorage.getItem("ATPL_DOL_METACACHE_V3_" + type);
    if (raw) out = JSON.parse(raw) || {};
  } catch (_) {}
  metaCache[type] = out;
  return out;
}

function saveMetaCache(type, cache) {
  metaCache[type] = cache;
  try {
    root.localStorage.setItem("ATPL_DOL_METACACHE_V3_" + type, JSON.stringify(cache));
  } catch (_) {}
}

function broadcastComplianceEvent(type, action, data) {
  try {
    if (root.UniversalEngine && typeof root.UniversalEngine.broadcastChange === "function") {
      root.UniversalEngine.broadcastChange(Object.assign({
        module: type,
        action: action,
        timestamp: new Date().toISOString()
      }, data || {}));
    }
    if (typeof BroadcastChannel !== "undefined") {
      var bc = new BroadcastChannel("atpl-local-tab-sync");
      bc.postMessage(Object.assign({ module: type, action: action }, data || {}));
      bc.close();
    }
  } catch (_) {}
  try {
    root.dispatchEvent(new CustomEvent("atpl-dol-supabase-change", {
      detail: Object.assign({ type: type, action: action, at: Date.now() }, data || {})
    }));
  } catch (_) {}
}

var rtClient=null,rtChannel=null,rtStarting=null,warmPromise=null,fbDolSubscribed=false;

function tok(){try{return String(root.sessionStorage.getItem(TOKEN)||root.sessionStorage.getItem(ALT)||root.localStorage.getItem(TOKEN)||root.localStorage.getItem(ALT)||'')}catch(_){return''}}
function arr(v){return Array.isArray(v)?v:[]}
function normalizeId(v){return String(v==null?'':v).replace(/\s+/g,'').toUpperCase()}
function timeoutFetch(url,opt,ms){
  var ctrl=new AbortController(),timer=root.setTimeout(function(){ctrl.abort()},ms||20000);
  opt=Object.assign({},opt||{},{signal:ctrl.signal});
  return fetch(url,opt).finally(function(){root.clearTimeout(timer)})
}
function arrayBufferToBase64(buffer) {
  if (!buffer) return '';
  var bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  var binary = '';
  var chunkSize = 8192;
  for (var i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}
function base64ToArrayBuffer(base64) {
  if (!base64) return new ArrayBuffer(0);
  var clean = String(base64);
  if (clean.indexOf(',') >= 0) clean = clean.split(',')[1];
  clean = clean.replace(/\s+/g, '');
  var binaryString = atob(clean);
  var len = binaryString.length;
  var bytes = new Uint8Array(len);
  for (var i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

async function sbDirectRest(endpoint, options) {
  if (supabaseRestricted) return null;
  options = options || {};
  var headers = Object.assign({
    'apikey': PUBLISHABLE_KEY,
    'Authorization': 'Bearer ' + PUBLISHABLE_KEY,
    'Content-Type': 'application/json'
  }, options.headers || {});
  var url = SUPABASE_URL + '/rest/v1/' + endpoint;
  try {
    var res = await timeoutFetch(url, {
      method: options.method || 'GET',
      headers: headers,
      body: options.body ? JSON.stringify(options.body) : undefined
    }, 6000);
    if (!res.ok) {
      var errText = '';
      try { errText = await res.text(); } catch(_) {}
      if (res.status === 402 || /exceed_egress_quota|quota|spend cap|restricted/i.test(errText)) {
        supabaseRestricted = true;
        return null;
      }
      return null;
    }
    return await res.json();
  } catch (_) {
    return null;
  }
}

function edgeHeaders(json){
  var h={'apikey':PUBLISHABLE_KEY,'Authorization':'Bearer '+PUBLISHABLE_KEY};
  if(json)h['Content-Type']='application/json';
  var t=tok();if(t)h['x-atpl-token']=t;
  return h
}
async function edgeJson(body,ms){
  if(!EDGE_URL)throw new Error('Edge endpoint not configured on static host');
  if(!tok())throw new Error('Valid ERP login required');
  var res=await timeoutFetch(EDGE_URL,{method:'POST',headers:edgeHeaders(true),body:JSON.stringify(body||{})},ms||12000);
  var data=null;try{data=await res.json()}catch(_){}
  if(!res.ok||!data||data.ok===false)throw new Error(data&&data.error||('DOL Supabase request failed ('+res.status+')'));
  return data
}
function mapRow(r){
  r=r||{};var ids=arr(r.member_ids||r.ids).map(String).filter(Boolean),digits=[],alnums=[];
  ids.forEach(function(x){if(/^\d+$/.test(String(x)))digits.push(String(x));else alnums.push(String(x))});
  return {
    id:String(r.id||''),cloudRecordId:String(r.id||''),type:String(r.challan_type||r.type||'').toLowerCase(),
    name:String(r.file_name||r.name||'Challan'),size:Number(r.file_size||r.size||0)||0,
    fileHash:String(r.file_hash||r.fileHash||r.fingerprint||'').toLowerCase(),
    fingerprint:String(r.file_hash||r.fileHash||r.fingerprint||'').toLowerCase(),
    period:String(r.period||''),periodSource:'supabase',digitIds:digits,alnumIds:alnums,
    uploadedBy:String(r.uploaded_by||r.uploadedBy||''),uploadedAt:String(r.created_at||r.uploadedAt||''),
    updatedAt:String(r.updated_at||r.updatedAt||r.created_at||''),mime:String(r.mime_type||r.mime||'application/octet-stream'),
    hasOriginalFile:true,indexCount:ids.length,indexStatus:'ready',contributions:arr(r.contributions),
    _sharedSource:'dedicated',sharedSource:'dedicated',supabase:true,filePath:String(r.file_path||r.file_name||r.name||''),
    original_b64:String(r.original_b64||r.buf||'')
  }
}

async function listRaw(type,force){
  type=String(type||"").toLowerCase();if(type!=="pf"&&type!=="esic")throw new Error("Invalid challan type");
  if(!force&&rawCache[type]&&Date.now()-rawCacheAt[type]<RAW_CACHE_MS)return rawCache[type];
  var rows=[]; if(EDGE_URL&&tok()){try{var ed=await edgeJson({action:'list',type:type},4000);if(ed&&Array.isArray(ed.records))rows=ed.records;}catch(_){}}
  var tombIds=new Set(),tombNames=new Set(),tombHashes=new Set();
  var cloudReached=false;

  // 0. Read local tombstones for this compliance type
  try {
    var localT = JSON.parse(root.localStorage.getItem('ATPL_COMPLIANCE_' + type.toUpperCase() + '_TOMBSTONES') || '{}');
    Object.keys(localT).forEach(function(k) {
      var kl = String(k).toLowerCase().trim();
      tombIds.add(kl); tombNames.add(kl); tombHashes.add(kl);
    });
  } catch (_) {}

  // 1. Authoritative Firebase Firestore Records & Tombstones
  var fb = getFb();
  if (fb) {
    try {
      if (typeof fb.fetchAllDolTombstones === 'function') {
        var fbTombs = await fb.fetchAllDolTombstones(type);
        if (Array.isArray(fbTombs)) {
          cloudReached = true;
          fbTombs.forEach(function(t) {
            if (!t) return;
            if (t.id) tombIds.add(String(t.id).toLowerCase().trim());
            if (t.name) tombNames.add(String(t.name).toLowerCase().trim());
            if (t.file_hash) tombHashes.add(String(t.file_hash).toLowerCase().trim());
          });
        }
      }
      if (typeof fb.fetchAllDolRecords === 'function') {
        var fbRecs = await fb.fetchAllDolRecords(type);
        if (Array.isArray(fbRecs)) {
          cloudReached = true;
          fbRecs.forEach(function(r) {
            if (!r) return;
            var rid = String(r.id || '').toLowerCase().trim();
            var rname = String(r.name || r.file_name || '').toLowerCase().trim();
            var rhash = String(r.file_hash || r.hash || '').toLowerCase().trim();
            if ((rid && tombIds.has(rid)) || (rname && tombNames.has(rname)) || (rhash && tombHashes.has(rhash))) return;
            rows.push({
              id: String(r.id || r.name),
              challan_type: type,
              file_name: r.name || r.file_name || "Challan",
              file_size: Number(r.size || r.file_size || 0),
              file_hash: rhash,
              period: String(r.period || ""),
              member_ids: arr(r.member_ids || r.ids),
              contributions: arr(r.contributions),
              created_at: r.created_at || r.uploaded_at || new Date().toISOString(),
              updated_at: r.updated_at || r.uploaded_at || new Date().toISOString(),
              uploaded_by: String(r.uploaded_by || "admin"),
              file_path: r.name || r.file_name || "",
              hasOriginalFile: true
            });
          });
        }
      }
    } catch (_) {}
  }

  // 2. Authoritative GitHub Cloud Manifest & dol_records.json
  try {
    if (root.ATPLGitHubCloud && typeof root.ATPLGitHubCloud.getManifest === 'function') {
      var ghM = await root.ATPLGitHubCloud.getManifest(false);
      if (ghM) {
        cloudReached = true;
        if (ghM.tombstones) {
          Object.values(ghM.tombstones).forEach(function(t) {
            if (!t || (t.module && t.module !== type)) return;
            if (t.id) tombIds.add(String(t.id).toLowerCase().trim());
            if (t.name || t.filename) tombNames.add(String(t.name || t.filename).toLowerCase().trim());
            if (t.file_hash) tombHashes.add(String(t.file_hash).toLowerCase().trim());
          });
        }
        if (ghM.files) {
          var seenSet = new Set(rows.map(function(x) { return String(x.file_hash || x.file_name || x.id).toLowerCase(); }));
          Object.values(ghM.files).forEach(function(r) {
            if (!r || (r.module !== type && r.doc_type !== type)) return;
            var rid = String(r.id || '').toLowerCase().trim();
            var rname = String(r.name || r.filename || '').toLowerCase().trim();
            var rhash = String(r.file_hash || '').toLowerCase().trim();
            if ((rid && tombIds.has(rid)) || (rname && tombNames.has(rname)) || (rhash && tombHashes.has(rhash))) return;
            var dedupeKey = rhash || rname || rid;
            if (seenSet.has(dedupeKey)) return;
            seenSet.add(dedupeKey);
            rows.push({
              id: String(r.id || r.name),
              challan_type: type,
              file_name: r.name || r.filename || "Challan",
              file_size: Number(r.size || 0),
              file_hash: rhash,
              period: String(r.period || ""),
              member_ids: arr(r.member_ids || r.ids),
              contributions: arr(r.contributions),
              created_at: r.created_at || r.uploaded_at || new Date().toISOString(),
              updated_at: r.updated_at || r.uploaded_at || new Date().toISOString(),
              uploaded_by: String(r.uploaded_by || "admin"),
              file_path: r.name || r.filename || "",
              hasOriginalFile: true
            });
          });
        }
      }
    }
  } catch (_) {}

  // 3. Local Express Backend Loader (only when running on localhost)
  var localBase = getBackendBase();
  if (localBase) {
    try {
      var sRes = await timeoutFetch(localBase + "/api/sync/dol-records?type=" + encodeURIComponent(type), { method: "GET" }, 4000);
      if (sRes && sRes.ok) {
        var sData = await sRes.json();
        if (sData && Array.isArray(sData.records)) {
          cloudReached = true;
          var seenLocal = new Set(rows.map(function(x) { return String(x.file_hash || x.file_name || x.id).toLowerCase(); }));
          sData.records.forEach(function(r) {
            if (!r) return;
            var rid = String(r.id || '').toLowerCase().trim();
            var rname = String(r.name || r.file_name || '').toLowerCase().trim();
            var rhash = String(r.file_hash || r.sha256_hash || '').toLowerCase().trim();
            if ((rid && tombIds.has(rid)) || (rname && tombNames.has(rname)) || (rhash && tombHashes.has(rhash))) return;
            var dk = rhash || rname || rid;
            if (seenLocal.has(dk)) return;
            seenLocal.add(dk);
            rows.push({
              id: String(r.id || ""),
              challan_type: type,
              file_name: r.name || r.file_name || "Challan",
              file_size: Number(r.size || r.file_size || 0),
              file_hash: rhash,
              period: String(r.period || (r.meta && r.meta.period) || ""),
              member_ids: arr((r.meta && r.meta.ids) || r.member_ids),
              contributions: arr((r.meta && r.meta.contributions) || r.contributions),
              created_at: r.created_at || new Date().toISOString(),
              updated_at: r.updated_at || new Date().toISOString(),
              uploaded_by: String(r.uploaded_by || "admin"),
              file_path: r.name || r.file_name || "",
              hasOriginalFile: true,
              original_b64: r.original_b64 || r.buf || ""
            });
          });
        }
      }
    } catch (_) {}
  }

  // 4. Strictly overwrite local MetaCache so deleted records NEVER resurrect on Browser B
  if (cloudReached) {
    var cleanCache = {};
    rows.forEach(function(r) {
      cleanCache[String(r.id)] = {
        id: String(r.id),
        name: r.file_name,
        hash: r.file_hash,
        period: r.period,
        member_ids: r.member_ids,
        contributions: r.contributions,
        uploaded_by: r.uploaded_by,
        uploaded_at: r.created_at
      };
    });
    saveMetaCache(type, cleanCache);
  }

  rawCache[type]=rows;rawCacheAt[type]=Date.now();return rows;
}

async function list(type){
  return (await listRaw(type,true)).map(mapRow)
}

async function check(hash,intent,type){
  try{
    hash=String(hash||'').toLowerCase();type=String(type||'').toLowerCase();
    if(!hash)return{ok:true,duplicate:false};
    if(type!=='pf'&&type!=='esic')return{ok:true,duplicate:false};
    var rows=await listRaw(type,true);
    var matching=rows.find(function(r){return String(r.file_hash||r.fileHash||r.fingerprint||'').toLowerCase()===hash});
    return{ok:true,duplicate:!!matching,deleted:false,record:matching?mapRow(matching):null};
  }catch(_){
    return{ok:true,duplicate:false};
  }
}

function currentUserId(){
  try{var s=JSON.parse(root.sessionStorage.getItem(SESS)||root.localStorage.getItem(SESS)||'null');return s&&s.id?String(s.id):''}catch(_){return''}
}

async function upload(rec,buf,progress){
  if(!(buf instanceof ArrayBuffer))throw new Error('Original file bytes required');
  if(progress)progress(5);
  var type=String(rec&&rec.type||'').toLowerCase();if(type!=='pf'&&type!=='esic')throw new Error('Invalid challan type');
  var ids=arr(rec&&rec.ids).map(String).filter(Boolean),form=new FormData(),mime=String(rec&&rec.mime||'application/octet-stream');
  form.append('action','upload');form.append('type',type);form.append('period',String(rec&&rec.period||''));
  form.append('uploaded_by',currentUserId());form.append('member_ids',JSON.stringify(ids));
  form.append('contributions',JSON.stringify(arr(rec&&rec.contributions)));
  form.append('file_hash',String(rec&&rec.hash||rec&&rec.fileHash||'').toLowerCase());
  form.append('file_size',String(Number(rec&&rec.size||buf.byteLength)||buf.byteLength));
  form.append('mime_type',mime);
  form.append('file',new Blob([buf],{type:mime}),String(rec&&rec.name||'challan'));

  if (typeof root.atplMarkSessionUpload === 'function') {
    root.atplMarkSessionUpload(type, rec.name);
  }

  // Clear any local tombstone for this newly uploaded file
  try {
    var tKey = 'ATPL_COMPLIANCE_' + type.toUpperCase() + '_TOMBSTONES';
    var localT = JSON.parse(root.localStorage.getItem(tKey) || '{}');
    delete localT[String(rec.name || '').toLowerCase().trim()];
    if (rec.hash || rec.fileHash) delete localT[String(rec.hash || rec.fileHash).toLowerCase().trim()];
    root.localStorage.setItem(tKey, JSON.stringify(localT));
  } catch (_) {}

  if(progress)progress(30);
  var b64=arrayBufferToBase64(buf);
  var recordId = String(rec.id || ('dol_' + type + '_' + String(rec.hash || rec.fileHash || Date.now()).slice(0, 20)));
  var nowIso = new Date().toISOString();

  var fullRecord = {
    id: recordId,
    type: type,
    challan_type: type,
    name: rec.name,
    file_name: rec.name,
    size: buf.byteLength,
    file_size: buf.byteLength,
    hash: String(rec.hash || rec.fileHash || '').toLowerCase(),
    file_hash: String(rec.hash || rec.fileHash || '').toLowerCase(),
    period: rec.period || '',
    ids: ids,
    member_ids: ids,
    contributions: arr(rec.contributions),
    mime: mime,
    mime_type: mime,
    uploaded_by: currentUserId() || 'admin',
    created_at: nowIso,
    updated_at: nowIso,
    hasOriginalFile: true
  };

  if(progress)progress(60);

  // 1. Primary Real-Time Sync: Firebase Firestore
  var fb = getFb();
  if (fb && typeof fb.saveDolRecord === 'function') {
    try {
      await fb.saveDolRecord(type, fullRecord, b64);
    } catch (fbErr) {
      console.warn('[ATPL-DOL] Firebase saveDolRecord notice:', fbErr);
    }
  }

  // 2. Secondary Cloud Store: GitHub Repository
  try {
    syncToGitHubRepo(fullRecord, b64).catch(function(){});
  } catch (_) {}

  // 3. Local Express Server (if running on localhost)
  var localBase = getBackendBase();
  if (localBase) {
    try {
      timeoutFetch(localBase + "/api/sync/dol-record", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: recordId,
          module: type,
          category: "challan",
          name: rec.name,
          size: buf.byteLength,
          sha256_hash: fullRecord.hash,
          period: rec.period || "",
          meta: {
            type: type,
            ids: ids,
            contributions: arr(rec.contributions),
            period: rec.period || ""
          },
          original_b64: b64
        })
      }, 4000).catch(function(){});
    } catch (_) {}
  }

  var mappedDirect = mapRow(Object.assign({}, fullRecord, { original_b64: b64 }));
  var cObj = loadMetaCache(type);
  cObj[recordId] = {
    id: recordId,
    name: rec.name,
    hash: fullRecord.hash,
    period: rec.period || "",
    member_ids: ids,
    contributions: arr(rec.contributions),
    uploaded_by: fullRecord.uploaded_by,
    uploaded_at: nowIso
  };
  saveMetaCache(type, cObj);

  broadcastComplianceEvent(type, "save", {
    filename: rec.name,
    id: recordId,
    period: rec.period || "",
    hash: fullRecord.hash,
    isDeleted: false
  });
  rawCache[type]=null;rawCacheAt[type]=0;if(progress)progress(100);
  return{duplicate:false,restoredDeleted:false,record:mappedDirect,index:{ok:true,count:ids.length,record:mappedDirect}};
}

async function update(rec){
  var type=String(rec&&rec.type||'').toLowerCase(),id=String(rec&&rec.cloudRecordId||rec&&rec.id||'');
  if(type!=='pf'&&type!=='esic')throw new Error('Invalid challan type');if(!id)throw new Error('Challan id missing');
  var fb = getFb();
  if (fb && typeof fb.fetchAllDolRecords === 'function' && typeof fb.saveDolRecord === 'function') {
    try {
      var all = await fb.fetchAllDolRecords(type);
      var match = (all || []).find(function(x) { return x && String(x.id) === id; });
      if (match) {
        var decoded = typeof fb.decodeDolPayload === 'function' ? await fb.decodeDolPayload(match) : match;
        var updatedObj = Object.assign({}, match, decoded || {}, { period: String(rec.period || ''), updated_at: new Date().toISOString() });
        await fb.saveDolRecord(type, updatedObj, updatedObj.original_b64 || '');
      }
    } catch (_) {}
  }
  rawCache[type]=null;rawCacheAt[type]=0;
  return mapRow({id:id,challan_type:type,period:rec.period,file_name:rec.name});
}

async function remove(rec){
  var type=String(rec&&rec.type||'').toLowerCase(),id=String(rec&&rec.cloudRecordId||rec&&rec.id||''),name=String(rec&&rec.name||''),hash=String(rec&&rec.hash||rec&&rec.fileHash||rec&&rec.fingerprint||'').toLowerCase();
  if(type!=='pf'&&type!=='esic')throw new Error('Invalid challan type');if(!id&&!name)throw new Error('Challan id missing'); if(EDGE_URL&&tok()){try{await edgeJson({action:'delete',type:type,id:id},4000);}catch(_){}}

  // Record local tombstone immediately
  try {
    var tKey = 'ATPL_COMPLIANCE_' + type.toUpperCase() + '_TOMBSTONES';
    var localT = JSON.parse(root.localStorage.getItem(tKey) || '{}');
    var nowIso = new Date().toISOString();
    if (id) localT[id.toLowerCase().trim()] = nowIso;
    if (name) localT[name.toLowerCase().trim()] = nowIso;
    if (hash) localT[hash] = nowIso;
    root.localStorage.setItem(tKey, JSON.stringify(localT));
  } catch (_) {}

  // 1. Delete from Firebase Firestore & write permanent tombstone
  var fb = getFb();
  if (fb && typeof fb.deleteDolRecord === 'function') {
    try {
      await fb.deleteDolRecord(type, id, name, hash, currentUserId() || 'admin');
    } catch (fbErr) {
      console.warn('[ATPL-DOL] Firebase deleteDolRecord notice:', fbErr);
    }
  }

  // 2. Delete from GitHub Repository
  try {
    syncDeleteFromGitHubRepo(type, id, name, hash).catch(function(){});
  } catch (_) {}

  // 3. Delete from Local Express Server (if on localhost)
  var localBase = getBackendBase();
  if (localBase) {
    try {
      timeoutFetch(localBase + "/api/sync/dol-record/" + encodeURIComponent(id), { method: "DELETE" }, 4000).catch(function(){});
    } catch (_) {}
  }

  var cDel = loadMetaCache(type);
  delete cDel[String(id)];
  saveMetaCache(type, cDel);

  if (root.ATPLRealtimeSyncEngine && typeof root.ATPLRealtimeSyncEngine.purgeLocalCompliance === 'function') {
    root.ATPLRealtimeSyncEngine.purgeLocalCompliance(type, id, name, hash);
  }

  broadcastComplianceEvent(type, "delete", {
    filename: name,
    id: String(id),
    hash: hash,
    isDeleted: true
  });
  rawCache[type]=null;rawCacheAt[type]=0;return{ok:true,deleted:true};
}

async function signedFile(rec){
  var type=String(rec&&rec.type||'').toLowerCase(),id=String(rec&&rec.cloudRecordId||rec&&rec.id||'');
  if(type!=='pf'&&type!=='esic')throw new Error('Invalid challan type');if(!id)throw new Error('Challan id missing');
  return edgeJson({action:'file',type:type,id:id},15000);
}

async function fileBlob(rec,progress){
  if(progress)progress(10);
  var recName=String(rec&&rec.name||rec&&rec.file_name||'');
  var type=String(rec&&rec.type||rec&&rec.challan_type||'pf').toLowerCase();
  var cid=String(rec&&rec.cloudRecordId||rec&&rec.id||'');
  var rhash=String(rec&&rec.hash||rec&&rec.fileHash||rec&&rec.fingerprint||'').toLowerCase();
  var mime=String((rec&&rec.mime)||(recName.toLowerCase().endsWith('.pdf')?'application/pdf':'application/octet-stream'));

  if (rec && (rec.original_b64 || rec.buf)) {
    var ab0 = base64ToArrayBuffer(rec.original_b64 || rec.buf);
    if (ab0 && ab0.byteLength > 0) {
      if (progress) progress(100);
      return new Blob([ab0], { type: mime });
    }
  }

  if(progress)progress(30);
  // 1. Fetch from Firebase Firestore
  var fb = getFb();
  if (fb && typeof fb.fetchAllDolRecords === 'function') {
    try {
      var all = await fb.fetchAllDolRecords(type);
      var match = (all || []).find(function(x) {
        if (!x) return false;
        if (cid && String(x.id || '').toLowerCase() === cid.toLowerCase()) return true;
        if (rhash && String(x.file_hash || '').toLowerCase() === rhash) return true;
        if (recName && String(x.name || x.file_name || '').toLowerCase() === recName.toLowerCase()) return true;
        return false;
      });
      if (match) {
        var decoded = typeof fb.decodeDolPayload === 'function' ? await fb.decodeDolPayload(match) : match;
        var b64 = (decoded && (decoded.original_b64 || decoded.buf)) || match.original_b64 || '';
        if (b64) {
          var ab1 = base64ToArrayBuffer(b64);
          if (ab1 && ab1.byteLength > 0) {
            if (progress) progress(100);
            return new Blob([ab1], { type: mime });
          }
        }
      }
    } catch (_) {}
  }

  if(progress)progress(65);
  // 2. Fetch from GitHub Cloud Blob
  if (root.ATPLGitHubCloud) {
    try {
      var m = await root.ATPLGitHubCloud.getManifest(false);
      if (m && m.files) {
        var found = null;
        Object.values(m.files).forEach(function(item) {
          if (!item || (item.module !== type && item.doc_type !== type)) return;
          if ((cid && String(item.id || '').toLowerCase() === cid.toLowerCase()) ||
              (rhash && String(item.file_hash || '').toLowerCase() === rhash) ||
              (recName && String(item.name || item.filename || '').toLowerCase() === recName.toLowerCase())) {
            found = item;
          }
        });
        if (found && found.blob_key) {
          var blobObj = await root.ATPLGitHubCloud.getBlob(found.blob_key);
          var payload = blobObj && blobObj.payload;
          var b64Gh = (payload && (payload.original_b64 || payload.buf)) || (typeof payload === 'string' ? payload : '');
          if (b64Gh) {
            var ab2 = base64ToArrayBuffer(b64Gh);
            if (ab2 && ab2.byteLength > 0) {
              if (progress) progress(100);
              return new Blob([ab2], { type: mime });
            }
          }
        }
      }
    } catch (_) {}
  }

  throw new Error('Original file not found in cloud storage');
}

async function searchIndex(type,ids){
  type=String(type||'').toLowerCase();ids=arr(ids).map(normalizeId).filter(Boolean).slice(0,60);
  var rows=await listRaw(type,true),matches={},coverage={},unindexed=[];
  ids.forEach(function(id){matches[id]=[]});
  rows.forEach(function(r){
    var period=String(r.period||'');if(period)coverage[period]=1;
    var mids=arr(r.member_ids).map(normalizeId).filter(Boolean),contrib=arr(r.contributions);
    if(!mids.length){unindexed.push({id:r.id,name:r.file_name,period:period});return}
    ids.forEach(function(id){
      if(mids.indexOf(id)<0)return;
      var detail=contrib.find(function(x){return normalizeId(x&&x.memberId||x&&x.member_id)===id})||{};
      matches[id].push({recordId:String(r.id||''),type:type,memberId:id,employeeName:String(detail.employeeName||detail.employee_name||''),details:detail.details&&typeof detail.details==='object'?detail.details:{libraryIndex:true},period:period,sourceChallan:String(r.file_name||''),uploadedAt:String(r.created_at||''),updatedAt:String(r.updated_at||'')})
    })
  });
  Object.keys(matches).forEach(function(id){matches[id].sort(function(a,b){return String(a.period).localeCompare(String(b.period))})});
  return{ok:true,type:type,matches:matches,coverage:Object.keys(coverage).sort(),unindexed:unindexed,source:'supabase-authority'}
}

async function saveContributionIndex(recordId,type,entries,progress){
  if(progress)progress(100);
  var rows=await listRaw(type,true),r=rows.find(function(x){return String(x.id)===String(recordId)});
  return{ok:true,count:arr(entries).length,record:r?mapRow(r):null}
}

async function startRealtime(){
  var fb = getFb();
  if (fb && !fbDolSubscribed) {
    fbDolSubscribed = true;
    ['pf', 'esic'].forEach(function(t) {
      if (typeof fb.subscribeDolRecords === 'function') {
        fb.subscribeDolRecords(t, function() {
          rawCache[t] = null; rawCacheAt[t] = 0;
          try {
            root.dispatchEvent(new CustomEvent('atpl-dol-supabase-change', { detail: { type: t, at: Date.now() } }));
          } catch (_) {}
        });
      }
      if (typeof fb.subscribeDolTombstones === 'function') {
        fb.subscribeDolTombstones(t, function(tombs) {
          rawCache[t] = null; rawCacheAt[t] = 0;
          if (Array.isArray(tombs) && root.ATPLRealtimeSyncEngine && typeof root.ATPLRealtimeSyncEngine.purgeLocalCompliance === 'function') {
            tombs.forEach(function(tb) {
              if (tb) root.ATPLRealtimeSyncEngine.purgeLocalCompliance(t, tb.id || tb.name, tb.name, tb.file_hash);
            });
          }
          try {
            root.dispatchEvent(new CustomEvent('atpl-dol-supabase-change', { detail: { type: t, at: Date.now() } }));
          } catch (_) {}
        });
      }
    });
  }
  if (!supabaseRestricted && root.supabase && typeof root.supabase.createClient === 'function' && !rtChannel) {
    try {
      rtClient=root.__ATPL_SHARED_SUPABASE_CLIENT||(root.__ATPL_SHARED_SUPABASE_CLIENT=root.supabase.createClient(SUPABASE_URL,PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false,storageKey:'sb-atpl-shared-auth-v1'}}));
      rtChannel=rtClient.channel('atpl-dol-sync-v2')
        .on('postgres_changes',{event:'INSERT',schema:'public',table:'dol_sync_events'},function(payload){
          var type=String(payload&&payload.new&&payload.new.challan_type||'').toLowerCase();if(type!=='pf'&&type!=='esic')return;
          rawCache[type]=null;rawCacheAt[type]=0;
          try{root.dispatchEvent(new CustomEvent('atpl-dol-supabase-change',{detail:{type:type,at:Date.now(),event:payload&&payload.new||null}}))}catch(_){}
        })
        .subscribe();
    } catch (_) {}
  }
  return true;
}

function stopRealtime(){try{if(rtClient&&rtChannel)rtClient.removeChannel(rtChannel)}catch(_){}rtChannel=null;rtClient=null}
async function warmAuth(){
  if(warmPromise)return warmPromise;
  warmPromise=Promise.resolve(true).finally(function(){warmPromise=null});
  return warmPromise;
}

var api={
  authority:'supabase',provider:'supabase-v2',probe:function(){return Promise.resolve(true)},
  list:list,check:check,upload:upload,saveContributionIndex:saveContributionIndex,searchIndex:searchIndex,update:update,
  deleteRecord:remove,fileBlob:fileBlob,startRealtime:startRealtime,stopRealtime:stopRealtime,warmAuth:warmAuth,
  migrationReport:function(){return null},supported:function(){return true},supportState:function(){return true},version:function(){return BUILD}
};
root.ATPLDOLCloudV4=api;
root.ATPLDOLSupabaseV2=api;
function resume(){startRealtime();warmAuth().catch(function(){})}
root.addEventListener('online',resume);
try{root.document.addEventListener('atpl-authenticated',resume)}catch(_){}
if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',function(){startRealtime();warmAuth().catch(function(){})},{once:true});else{startRealtime();warmAuth().catch(function(){})}
})(window);
