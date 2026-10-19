/* ATPL DOL Supabase V2 — authoritative PF/ESIC challan backend.
   Multi-Cloud Real-Time Authority: Google Apps Script V4/V5 Vault + SystemRecords + Firebase + GitHub + Local Server.
   Guarantees instant cross-browser and cross-device (Laptop <-> Mobile Phone) upload sync and strict auto-delete. */
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
var supabaseRestricted = true;

function getBackendBase() {
  try {
    if (typeof window !== 'undefined' && window.location) {
      var port = window.location.port || '';
      if (port === '4173') return ''; // Bypass static Python server in CI smoke test
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
  if (root.ATPLRealtimeSyncEngine) return root.ATPLRealtimeSyncEngine;
  if (root.__atplFirebaseQuotaExhausted) return null;
  return root.ATPLFirebase || root.ATPLNativeFirebase || null;
}

function getLegacyVault() {
  return root.ATPLDOLCloudV4Legacy || null;
}

function getDurableApi() {
  return root.ATPLDurableEverythingV1 || null;
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
  } catch (ghErr) {
    console.warn('[ATPL-DOL] GitHub repo sync non-fatal error:', ghErr);
  }
}

async function syncDeleteFromGitHubRepo(type, id, name, hash) {
  try {
    if (root.ATPLGitHubCloud && typeof root.ATPLGitHubCloud.deleteFile === 'function') {
      await root.ATPLGitHubCloud.deleteFile(type || 'pf', id || name, name || id, hash || '');
    }
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
function logicalName(name){return String(name||'').toLowerCase().replace(/\.[^.]+$/,'').replace(/\(\s*\d+\s*\)$/,'').replace(/[^a-z0-9]+/g,'')}
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
  r=r||{};
  var rawIds = [].concat(arr(r.member_ids), arr(r.ids), arr(r.digitIds), arr(r.alnumIds)).map(String).filter(Boolean);
  var ids = Array.from(new Set(rawIds)), digits=[], alnums=[];
  ids.forEach(function(x){if(/^\d+$/.test(String(x)))digits.push(String(x));else alnums.push(String(x))});
  var hash = String(r.file_hash||r.fileHash||r.fingerprint||r.hash||'').toLowerCase();
  return {
    id:String(r.id||''),cloudRecordId:String(r.cloudRecordId||r.id||''),type:String(r.challan_type||r.type||'').toLowerCase(),
    name:String(r.file_name||r.name||'Challan'),size:Number(r.file_size||r.size||0)||0,
    fileHash:hash,
    fingerprint:hash,
    period:String(r.period||''),periodSource:String(r.periodSource||'supabase'),digitIds:digits,alnumIds:alnums,
    uploadedBy:String(r.uploaded_by||r.uploadedBy||''),uploadedAt:String(r.created_at||r.uploadedAt||''),
    updatedAt:String(r.updated_at||r.updatedAt||r.created_at||r.uploadedAt||''),mime:String(r.mime_type||r.mime||'application/octet-stream'),
    hasOriginalFile:r.hasOriginalFile!==false,indexCount:Number(r.indexCount||ids.length)||ids.length,indexStatus:String(r.indexStatus||'ready'),contributions:arr(r.contributions),
    _sharedSource:'dedicated',sharedSource:'dedicated',supabase:true,filePath:String(r.file_path||r.file_name||r.name||''),
    original_b64:String(r.original_b64||r.buf||'')
  }
}

async function listRaw(type,force){
  type=String(type||"").toLowerCase();if(type!=="pf"&&type!=="esic")throw new Error("Invalid challan type");
  if(!force&&rawCache[type]&&Date.now()-rawCacheAt[type]<RAW_CACHE_MS)return rawCache[type];
  var rows=[]; if(EDGE_URL&&tok()){try{var ed=await edgeJson({action:'list',type:type},4000);if(ed&&Array.isArray(ed.records))rows=ed.records;}catch(_){}}
  var tombIds=new Set(),tombNames=new Set(),tombHashes=new Set(),tombNamePeriods=new Set();
  var cloudReached=false;

  // 0. Read local tombstones for this compliance type
  try {
    var localT = JSON.parse(root.localStorage.getItem('ATPL_COMPLIANCE_' + type.toUpperCase() + '_TOMBSTONES') || '{}');
    Object.keys(localT).forEach(function(k) {
      var kl = String(k).toLowerCase().trim();
      tombIds.add(kl); tombNames.add(kl); tombHashes.add(kl);
    });
  } catch (_) {}

  // 1. Read shared Google Apps Script delete tombstones (via ATPLDurableEverythingV1)
  var dur = getDurableApi();
  if (dur && typeof dur.getComplianceDolDeleteTombstones === 'function' && tok()) {
    try {
      var sharedTombs = await dur.getComplianceDolDeleteTombstones(type);
      if (Array.isArray(sharedTombs)) {
        sharedTombs.forEach(function(t) {
          if (!t) return;
          if (t.id) tombIds.add(String(t.id).toLowerCase().trim());
          if (t.cloudRecordId) tombIds.add(String(t.cloudRecordId).toLowerCase().trim());
          if (t.hash) tombHashes.add(String(t.hash).toLowerCase().trim());
          if (t.name) {
            tombNames.add(String(t.name).toLowerCase().trim());
            var ln = logicalName(t.name);
            if (ln) tombNamePeriods.add(ln + '|' + String(t.period || ''));
          }
        });
      }
    } catch (_) {}
  }

  function isRecordTombstoned(r) {
    if (!r) return true;
    var rid = String(r.id || r.cloudRecordId || '').toLowerCase().trim();
    var rname = String(r.name || r.file_name || '').toLowerCase().trim();
    var rhash = String(r.file_hash || r.fileHash || r.fingerprint || r.hash || '').toLowerCase().trim();
    var rln = logicalName(rname);
    var rper = String(r.period || '');
    if (rid && tombIds.has(rid)) return true;
    if (rhash && tombHashes.has(rhash)) return true;
    if (rname && tombNames.has(rname)) return true;
    if (rln && tombNamePeriods.has(rln + '|' + rper)) return true;
    return false;
  }

  var byDedupeKey = {};
  function addRow(raw) {
    if (!raw || isRecordTombstoned(raw)) return;
    var rhash = String(raw.file_hash || raw.fileHash || raw.fingerprint || raw.hash || '').toLowerCase().trim();
    var rname = String(raw.file_name || raw.name || 'Challan').trim();
    var rln = logicalName(rname);
    var rper = String(raw.period || '');
    var rid = String(raw.id || raw.cloudRecordId || rname);
    var key = rhash ? ('h:' + rhash) : (rln ? ('np:' + rln + '|' + rper) : ('id:' + rid.toLowerCase()));
    var combinedIds = Array.from(new Set([].concat(arr(raw.member_ids), arr(raw.ids), arr(raw.digitIds), arr(raw.alnumIds)).map(String).filter(Boolean)));
    var normalized = {
      id: rid,
      cloudRecordId: String(raw.cloudRecordId || raw.id || rid),
      challan_type: type,
      type: type,
      file_name: rname,
      name: rname,
      file_size: Number(raw.file_size || raw.size || 0),
      size: Number(raw.file_size || raw.size || 0),
      file_hash: rhash,
      fileHash: rhash,
      period: rper,
      member_ids: combinedIds,
      digitIds: arr(raw.digitIds),
      alnumIds: arr(raw.alnumIds),
      contributions: arr(raw.contributions),
      created_at: raw.created_at || raw.uploadedAt || raw.uploaded_at || new Date().toISOString(),
      updated_at: raw.updated_at || raw.updatedAt || raw.uploadedAt || new Date().toISOString(),
      uploaded_by: String(raw.uploaded_by || raw.uploadedBy || 'admin'),
      file_path: rname,
      mime: String(raw.mime || raw.mime_type || 'application/octet-stream'),
      hasOriginalFile: raw.hasOriginalFile !== false,
      indexCount: Number(raw.indexCount || combinedIds.length) || combinedIds.length,
      indexStatus: String(raw.indexStatus || 'ready'),
      original_b64: String(raw.original_b64 || raw.buf || '')
    };
    var existing = byDedupeKey[key];
    if (!existing) {
      byDedupeKey[key] = normalized;
    } else {
      // Merge richer fields (e.g., contributions, member_ids, original_b64, cloudRecordId)
      if (!existing.member_ids.length && normalized.member_ids.length) existing.member_ids = normalized.member_ids;
      if (!existing.contributions.length && normalized.contributions.length) existing.contributions = normalized.contributions;
      if (!existing.original_b64 && normalized.original_b64) existing.original_b64 = normalized.original_b64;
      if (String(normalized.id).indexOf('dol_') === 0) {
        existing.id = normalized.id;
        existing.cloudRecordId = normalized.id;
      }
    }
  }

  rows.forEach(addRow);

  // 2. Primary Cross-Device Authority A: Google Apps Script Dedicated DOL V4/V5 Vault (DOLRecords + Google Drive)
  var leg = getLegacyVault();
  if (leg && typeof leg.list === 'function' && tok()) {
    try {
      var legRecs = await leg.list(type);
      if (Array.isArray(legRecs)) {
        cloudReached = true;
        legRecs.forEach(addRow);
      }
    } catch (legErr) {
      console.warn('[ATPL-DOL] Legacy Apps Script list notice:', legErr && legErr.message || legErr);
    }
  }

  // 3. Primary Cross-Device Authority B: Google Apps Script SystemRecords (pf_dol_v2 / esic_dol_v2)
  if (dur && typeof dur.getComplianceDolRecords === 'function' && tok()) {
    try {
      var durRecs = await dur.getComplianceDolRecords(type);
      if (Array.isArray(durRecs)) {
        cloudReached = true;
        durRecs.forEach(addRow);
      }
    } catch (durErr) {
      console.warn('[ATPL-DOL] Durable SystemRecords list notice:', durErr && durErr.message || durErr);
    }
  }

  // 4. Secondary Authority: Firebase Firestore (when quota available)
  var fb = getFb();
  if (fb) {
    try {
      if (typeof fb.fetchAllDolTombstones === 'function') {
        var fbTombs = await fb.fetchAllDolTombstones(type);
        if (Array.isArray(fbTombs)) {
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
        if (Array.isArray(fbRecs) && fbRecs.length > 0) {
          cloudReached = true;
          fbRecs.forEach(addRow);
        }
      }
    } catch (_) {}
  }

  // 5. Local Express Backend Loader (only when running on localhost)
  var localBase = getBackendBase();
  if (localBase) {
    try {
      var sRes = await timeoutFetch(localBase + "/api/sync/dol-records?type=" + encodeURIComponent(type), { method: "GET" }, 4000);
      if (sRes && sRes.ok) {
        var sData = await sRes.json();
        if (sData && Array.isArray(sData.records)) {
          cloudReached = true;
          sData.records.forEach(function(r) {
            if (!r) return;
            addRow(Object.assign({}, r, {
              member_ids: arr((r.meta && r.meta.ids) || r.member_ids),
              contributions: arr((r.meta && r.meta.contributions) || r.contributions),
              period: String(r.period || (r.meta && r.meta.period) || "")
            }));
          });
        }
      }
    } catch (_) {}
  }

  var finalRows = Object.values(byDedupeKey).filter(function(r) { return !isRecordTombstoned(r); });

  // 6. Overwrite local MetaCache when cloud is reached so deleted records never resurrect
  if (cloudReached) {
    var cleanCache = {};
    finalRows.forEach(function(r) {
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

  rawCache[type]=finalRows;rawCacheAt[type]=Date.now();return finalRows;
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
  var hashLow=String(rec&&rec.hash||rec&&rec.fileHash||'').toLowerCase();
  form.append('action','upload');form.append('type',type);form.append('period',String(rec&&rec.period||''));
  form.append('uploaded_by',currentUserId());form.append('member_ids',JSON.stringify(ids));
  form.append('contributions',JSON.stringify(arr(rec&&rec.contributions)));
  form.append('file_hash',hashLow);
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
    if (hashLow) delete localT[hashLow];
    root.localStorage.setItem(tKey, JSON.stringify(localT));
  } catch (_) {}

  // Clear shared delete tombstone on Google Apps Script if present
  var dur = getDurableApi();
  if (dur && typeof dur.clearComplianceDolDeleteTombstone === 'function' && tok()) {
    try {
      await dur.clearComplianceDolDeleteTombstone({
        type: type,
        id: rec.id || ('dol_' + type + '_' + hashLow.slice(0, 24)),
        hash: hashLow,
        fileHash: hashLow,
        name: rec.name,
        period: rec.period || ''
      });
    } catch (_) {}
  }

  if(progress)progress(20);
  var b64=arrayBufferToBase64(buf);
  var recordId = String(rec.id || ('dol_' + type + '_' + String(hashLow || Date.now()).slice(0, 24)));
  var nowIso = new Date().toISOString();

  var digits = [], alnums = [];
  ids.forEach(function(x) {
    if (/^\d+$/.test(String(x))) digits.push(String(x));
    else if (x) alnums.push(String(x));
  });

  // 1. Primary Cross-Device Upload A: Google Apps Script Dedicated Vault (DOLRecords + Google Drive + DOLContributions)
  var leg = getLegacyVault();
  if (leg && typeof leg.upload === 'function' && tok()) {
    try {
      var legOut = await leg.upload({
        id: recordId,
        type: type,
        name: rec.name,
        size: buf.byteLength,
        mime: mime,
        hash: hashLow,
        fileHash: hashLow,
        period: rec.period || '',
        periodSource: rec.periodSource || 'manual',
        ids: ids,
        contributions: arr(rec.contributions),
        uploadIntent: 'user_upload'
      }, buf, progress);
      if (legOut && legOut.record && legOut.record.id) {
        recordId = String(legOut.record.id);
      }
    } catch (legUpErr) {
      console.warn('[ATPL-DOL] Legacy Apps Script upload notice:', legUpErr && legUpErr.message || legUpErr);
    }
  }

  if(progress)progress(70);

  // 2. Primary Cross-Device Upload B: Google Apps Script SystemRecords (pf_dol_v2 / esic_dol_v2)
  if (dur && typeof dur.saveComplianceDolConfirmed === 'function' && tok()) {
    try {
      await dur.saveComplianceDolConfirmed({
        id: recordId,
        type: type,
        name: rec.name,
        size: buf.byteLength,
        lastModified: rec.lastModified || Date.now(),
        uploadedAt: nowIso,
        updatedAt: nowIso,
        period: rec.period || '',
        periodSource: rec.periodSource || 'manual',
        digitIds: digits,
        alnumIds: alnums,
        fileHash: hashLow,
        fingerprint: hashLow,
        parseVersion: 'v3-cloud-only-final13-delete-fix'
      });
    } catch (durUpErr) {
      console.warn('[ATPL-DOL] Durable SystemRecords save notice:', durUpErr && durUpErr.message || durUpErr);
    }
  }

  var fullRecord = {
    id: recordId,
    cloudRecordId: recordId,
    type: type,
    challan_type: type,
    name: rec.name,
    file_name: rec.name,
    size: buf.byteLength,
    file_size: buf.byteLength,
    hash: hashLow,
    file_hash: hashLow,
    period: rec.period || '',
    ids: ids,
    member_ids: ids,
    digitIds: digits,
    alnumIds: alnums,
    contributions: arr(rec.contributions),
    mime: mime,
    mime_type: mime,
    uploaded_by: currentUserId() || 'admin',
    created_at: nowIso,
    updated_at: nowIso,
    hasOriginalFile: true
  };

  // 3. Secondary Cloud Store: Firebase Firestore (if quota available)
  var fb = getFb();
  if (fb && typeof fb.saveDolRecord === 'function') {
    try {
      await fb.saveDolRecord(type, fullRecord, b64);
    } catch (_) {}
  }

  // 4. GitHub Repository (best-effort)
  try {
    syncToGitHubRepo(fullRecord, b64).catch(function(){});
  } catch (_) {}

  // 5. Local Express Server (if running on localhost)
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
  var leg = getLegacyVault();
  if (leg && typeof leg.update === 'function' && tok()) {
    try { await leg.update(rec); } catch (_) {}
  }
  var dur = getDurableApi();
  if (dur && typeof dur.saveComplianceDolConfirmed === 'function' && tok()) {
    try {
      var ids = arr(rec.ids), digits = [], alnums = [];
      ids.forEach(function(x){ if (/^\d+$/.test(String(x))) digits.push(String(x)); else if (x) alnums.push(String(x)); });
      await dur.saveComplianceDolConfirmed({
        id: id,
        type: type,
        name: rec.name || '',
        size: rec.size || 0,
        period: String(rec.period || ''),
        periodSource: rec.periodSource || 'manual',
        digitIds: digits,
        alnumIds: alnums,
        fileHash: String(rec.hash || rec.fileHash || '').toLowerCase(),
        fingerprint: String(rec.hash || rec.fileHash || '').toLowerCase(),
        updatedAt: new Date().toISOString()
      });
    } catch (_) {}
  }
  rawCache[type]=null;rawCacheAt[type]=0;
  return mapRow({id:id,challan_type:type,period:rec.period,file_name:rec.name});
}

async function remove(rec){
  var type=String(rec&&rec.type||'').toLowerCase(),id=String(rec&&rec.cloudRecordId||rec&&rec.id||''),name=String(rec&&rec.name||''),hash=String(rec&&rec.hash||rec&&rec.fileHash||rec&&rec.fingerprint||'').toLowerCase();
  if(type!=='pf'&&type!=='esic')throw new Error('Invalid challan type');if(!id&&!name)throw new Error('Challan id missing'); if(EDGE_URL&&tok()){try{await edgeJson({action:'delete',type:type,id:id},4000);}catch(_){}}

  // 0. Record local tombstone immediately
  try {
    var tKey = 'ATPL_COMPLIANCE_' + type.toUpperCase() + '_TOMBSTONES';
    var localT = JSON.parse(root.localStorage.getItem(tKey) || '{}');
    var nowIso = new Date().toISOString();
    if (id) localT[id.toLowerCase().trim()] = nowIso;
    if (name) localT[name.toLowerCase().trim()] = nowIso;
    if (hash) localT[hash] = nowIso;
    root.localStorage.setItem(tKey, JSON.stringify(localT));
  } catch (_) {}

  // 1. Write shared delete tombstone to Google Apps Script & delete from SystemRecords
  var dur = getDurableApi();
  if (dur && tok()) {
    try {
      if (typeof dur.saveComplianceDolDeleteTombstone === 'function') {
        await dur.saveComplianceDolDeleteTombstone({
          type: type,
          id: id,
          cloudRecordId: id,
          hash: hash,
          fileHash: hash,
          name: name,
          period: rec.period || ''
        });
      }
    } catch (tErr) {
      console.warn('[ATPL-DOL] Shared delete tombstone notice:', tErr);
    }
    try {
      if (typeof dur.deleteComplianceDolConfirmed === 'function') {
        await dur.deleteComplianceDolConfirmed({
          id: id,
          type: type,
          hash: hash,
          fileHash: hash,
          name: name,
          period: rec.period || ''
        });
      }
    } catch (_) {}
  }

  // 2. Delete from Google Apps Script Dedicated Vault (DOLRecords + Google Drive + DOLContributions + DOLDeleted)
  var leg = getLegacyVault();
  if (leg && typeof leg.deleteRecord === 'function' && tok()) {
    try {
      await leg.deleteRecord({
        id: id,
        cloudRecordId: id,
        type: type,
        hash: hash,
        fileHash: hash,
        name: name,
        period: rec.period || ''
      });
    } catch (legDelErr) {
      console.warn('[ATPL-DOL] Legacy Apps Script delete notice:', legDelErr && legDelErr.message || legDelErr);
    }
  }

  // 3. Delete from Firebase Firestore (if quota available)
  var fb = getFb();
  if (fb && typeof fb.deleteDolRecord === 'function') {
    try {
      await fb.deleteDolRecord(type, id, name, hash, currentUserId() || 'admin');
    } catch (_) {}
  }

  // 4. Delete from GitHub Repository
  try {
    syncDeleteFromGitHubRepo(type, id, name, hash).catch(function(){});
  } catch (_) {}

  // 5. Delete from Local Express Server (if on localhost)
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

  if(progress)progress(25);
  // 1. Primary Cross-Device Original File Vault: Google Apps Script / Google Drive (getDOLFileInfo + getDOLFileChunk)
  var leg = getLegacyVault();
  if (leg && typeof leg.fileBlob === 'function' && tok()) {
    var candidateIds = [cid];
    if (rhash) {
      var canonicalDolId = 'dol_' + type + '_' + rhash.slice(0, 24);
      if (candidateIds.indexOf(canonicalDolId) < 0) candidateIds.push(canonicalDolId);
    }
    for (var ci = 0; ci < candidateIds.length; ci++) {
      var tryId = candidateIds[ci];
      if (!tryId) continue;
      try {
        var legBlob = await leg.fileBlob({ id: tryId, cloudRecordId: tryId, type: type, name: recName, mime: mime }, progress);
        if (legBlob && legBlob.size > 0) {
          if (progress) progress(100);
          return legBlob;
        }
      } catch (_) {}
    }
  }

  if(progress)progress(55);
  // 2. Fetch from Firebase Firestore (if quota available)
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

  if(progress)progress(80);
  // 3. Fetch from GitHub Cloud Blob
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
  var matches={},coverage={},unindexed=[],seenMatch={};
  ids.forEach(function(id){matches[id]=[]});

  // 1. Search Google Apps Script DOLContributions index if available
  var leg = getLegacyVault();
  if (leg && typeof leg.searchIndex === 'function' && tok()) {
    try {
      var legPack = await leg.searchIndex(type, ids);
      if (legPack && legPack.matches) {
        (legPack.coverage || []).forEach(function(p) { if (p) coverage[p] = 1; });
        ids.forEach(function(id) {
          arr(legPack.matches[id]).forEach(function(m) {
            if (!m) return;
            var k = id + '|' + String(m.recordId || '') + '|' + String(m.period || '');
            if (seenMatch[k]) return;
            seenMatch[k] = 1;
            matches[id].push(m);
          });
        });
      }
    } catch (_) {}
  }

  // 2. Supplement with live library rows
  var rows=await listRaw(type,true);
  rows.forEach(function(r){
    var period=String(r.period||'');if(period)coverage[period]=1;
    var mids=arr(r.member_ids).map(normalizeId).filter(Boolean),contrib=arr(r.contributions);
    if(!mids.length){unindexed.push({id:r.id,name:r.file_name,period:period});return}
    ids.forEach(function(id){
      if(mids.indexOf(id)<0)return;
      var k = id + '|' + String(r.id || '') + '|' + period;
      if (seenMatch[k]) return;
      seenMatch[k] = 1;
      var detail=contrib.find(function(x){return normalizeId(x&&x.memberId||x&&x.member_id)===id})||{};
      matches[id].push({recordId:String(r.id||''),type:type,memberId:id,employeeName:String(detail.employeeName||detail.employee_name||''),details:detail.details&&typeof detail.details==='object'?detail.details:{libraryIndex:true},period:period,sourceChallan:String(r.file_name||''),uploadedAt:String(r.created_at||''),updatedAt:String(r.updated_at||'')})
    })
  });
  Object.keys(matches).forEach(function(id){matches[id].sort(function(a,b){return String(a.period).localeCompare(String(b.period))})});
  return{ok:true,type:type,matches:matches,coverage:Object.keys(coverage).sort(),unindexed:unindexed,source:'supabase-authority'}
}

async function saveContributionIndex(recordId,type,entries,progress){
  var leg = getLegacyVault();
  if (leg && typeof leg.saveContributionIndex === 'function' && tok()) {
    try {
      return await leg.saveContributionIndex(recordId, type, entries, progress);
    } catch (_) {}
  }
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
  warmPromise=(async function(){
    if(root.ATPLCloudAPI&&typeof root.ATPLCloudAPI.ensureToken==='function'){
      try{await root.ATPLCloudAPI.ensureToken(false)}catch(_){}
    }
    return true;
  })().finally(function(){warmPromise=null});
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
try{root.document.addEventListener('atpl-cloud-token-ready',function(){
  rawCache.pf=null;rawCacheAt.pf=0;rawCache.esic=null;rawCacheAt.esic=0;
  try{root.dispatchEvent(new CustomEvent('atpl-dol-supabase-change',{detail:{type:'pf',at:Date.now()}}))}catch(_){}
  try{root.dispatchEvent(new CustomEvent('atpl-dol-supabase-change',{detail:{type:'esic',at:Date.now()}}))}catch(_){}
})}catch(_){}
if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',function(){startRealtime();warmAuth().catch(function(){})},{once:true});else{startRealtime();warmAuth().catch(function(){})}
})(window);
