/* ATPL Firebase Local Lightweight Stub (Zero-overhead, Hang-free) */
(function() {
  "use strict";
  function noop() {}
  async function asyncNoop() { return { ok: true, docs: [] }; }
  var saveHrDocFb = async function() { return true; };
  var deleteHrDocFb = async function() { return true; };
  var fetchAllHrDocsFb = async function() { return []; };
  var subscribeHrDocsFb = function() { return noop; };
  var subscribeHrTombstonesFb = function() { return noop; };
  var decodeHrDocFb = async function(d) { return d; };
  var kI = async function() { return true; };
  var r_ = async function() { return true; };
  var MI = async function() { return true; };
  var VI = async function(doc) { return doc; };
  var s_ = async function() { return []; };
  var GI = async function() { return []; };
  var HI = function() { return noop; };
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
      safeHrKey:hrKey
    };
  }
})();
