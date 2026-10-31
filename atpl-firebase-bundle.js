/* ATPL Firebase & Google Cloud Sync Bundle (Zero-overhead, Hang-free) */
(function() {
  "use strict";
  function noop() {}

  var saveHrDocFb = async function(docObj) {
    if (!docObj) return true;
    docObj = Object.assign({}, docObj, { updated_at:String(docObj.updated_at||new Date().toISOString()) });
    if (window.ATPLGoogleSync && typeof window.ATPLGoogleSync.uploadFile === 'function') {
      try { await window.ATPLGoogleSync.uploadFile('hr_doc', docObj); } catch(_) {}
    }
    return true;
  };
  var deleteHrDocFb = async function(id) {
    if (window.ATPLGoogleSync && typeof window.ATPLGoogleSync.deleteFile === 'function') {
      try { await window.ATPLGoogleSync.deleteFile('hr_doc', id); } catch(_) {}
    }
    return true;
  };
  var fetchAllHrDocsFb = async function() {
    return (typeof window.hrDocGetDocs === 'function') ? window.hrDocGetDocs() : [];
  };
  var subscribeHrDocsFb = function() { return noop; };
  var subscribeHrTombstonesFb = function() { return noop; };
  var decodeHrDocFb = async function(d) { return d; };

  var kI = async function(name, payload, meta) {
    if (window.ATPLGoogleSync && typeof window.ATPLGoogleSync.saveSalaryFile === 'function') {
      try { await window.ATPLGoogleSync.saveSalaryFile(name, payload, meta); } catch(_) {}
    }
    return true;
  };
  var r_ = async function(name) {
    if (window.ATPLGoogleSync && typeof window.ATPLGoogleSync.deleteSalaryFile === 'function') {
      try { await window.ATPLGoogleSync.deleteSalaryFile(name); } catch(_) {}
    }
    return true;
  };
  var MI = async function() {
    if (window.ATPLGoogleSync && typeof window.ATPLGoogleSync.clearAllSalaryFiles === 'function') {
      try { await window.ATPLGoogleSync.clearAllSalaryFiles(); } catch(_) {}
    }
    return true;
  };
  var VI = async function(doc) { return doc; };
  var s_ = async function() {
    return window.FILES || [];
  };
  var GI = async function() {
    var tombs = {};
    try { tombs = JSON.parse(localStorage.getItem('ATPL_SALARY_TOMBSTONES_V2') || '{}'); } catch(_) {}
    return Object.keys(tombs).map(function(k) { return { name: k, deleted_at: tombs[k] }; });
  };
  var HI = function(cb) {
    if (typeof cb === 'function') {
      window.addEventListener('storage', function(ev) {
        if (ev.key === 'ATPL_TRIGGER_EVENT') {
          try {
            var d = JSON.parse(ev.newValue);
            if (d && d.action === 'file_uploaded') cb({ all: window.FILES || [] });
          } catch(_) {}
        }
      });
    }
    return noop;
  };
  var UI = function() { return noop; };
  var zo = function(k) { return String(k || "").replace(/[^a-zA-Z0-9_-]/g, "_"); };
  var hrKey = function(k) { return String(k || "").replace(/[^a-zA-Z0-9_-]/g, "_"); };

  if (typeof window !== "undefined") {
    window.__atplFirebaseQuotaExhausted = false;
    window.ATPLFirebase = {
      init: noop,
      saveSalaryFile: kI,
      deleteSalaryFile: r_,
      clearAllSalaryFiles: MI,
      decodeDocPayload: VI,
      fetchAllSalaryFiles: s_,
      fetchAllTombstones: GI,
      subscribeSalaryFiles: HI,
      subscribeTombstones: UI,
      safeKey: zo,
      saveHrDoc:saveHrDocFb,
      deleteHrDoc:deleteHrDocFb,
      decodeHrPayload:decodeHrDocFb,
      fetchAllHrDocs:fetchAllHrDocsFb,
      fetchAllHrTombstones:fetchAllHrDocsFb,
      subscribeHrDocs:subscribeHrDocsFb,
      subscribeHrTombstones:subscribeHrTombstonesFb,
      safeHrKey:hrKey,
      fetchAllEmployeeMaster:async function(){
        return (window.EM && window.EM.data) || [];
      }
    };
  }
})();
