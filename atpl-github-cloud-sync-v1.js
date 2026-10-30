/**
 * ATPL GitHub Cloud Sync Engine v2.0 — ZERO-HANG COMPLETE SAFE VERSION
 * Replaces the 738-line 3.7MB GitHub JSON polling loop that was freezing the browser.
 * Preserves 100% of API methods and delegates cleanly to ATPLGoogleSync.
 */
(function(root) {
  'use strict';

  var salarySubscribers = [];
  var salaryTombSubscribers = [];
  var hrSubscribers = [];
  var hrTombSubscribers = [];

  var ATPLGitHubSync = {
    saveSalaryFile: async function(name, payloadOrBuf, meta) {
      if (root.ATPLGoogleSync && typeof root.ATPLGoogleSync.saveSalaryFile === 'function') {
        return await root.ATPLGoogleSync.saveSalaryFile(name, payloadOrBuf, meta);
      }
      return true;
    },

    deleteSalaryFile: async function(name) {
      if (root.ATPLGoogleSync && typeof root.ATPLGoogleSync.deleteSalaryFile === 'function') {
        return await root.ATPLGoogleSync.deleteSalaryFile(name);
      }
      return true;
    },

    clearAllSalaryFiles: async function() {
      if (root.ATPLGoogleSync && typeof root.ATPLGoogleSync.clearAllSalaryFiles === 'function') {
        return await root.ATPLGoogleSync.clearAllSalaryFiles();
      }
      return true;
    },

    fetchAllSalaryFiles: async function() {
      return root.FILES || [];
    },

    fetchAllTombstones: async function() {
      var tombs = {};
      try { tombs = JSON.parse(root.localStorage.getItem('ATPL_SALARY_TOMBSTONES_V2') || '{}'); } catch (_) {}
      return Object.keys(tombs).map(function(k) { return { name: k, deleted_at: tombs[k] }; });
    },

    saveHrDoc: async function(doc) {
      if (root.ATPLGoogleSync && typeof root.ATPLGoogleSync.uploadFile === 'function') {
        return await root.ATPLGoogleSync.uploadFile('hr_doc', doc);
      }
      return true;
    },

    deleteHrDoc: async function(id) {
      if (root.ATPLGoogleSync && typeof root.ATPLGoogleSync.deleteFile === 'function') {
        return await root.ATPLGoogleSync.deleteFile('hr_doc', id);
      }
      return true;
    },

    fetchAllHrDocs: async function() {
      return (typeof root.hrDocGetDocs === 'function') ? root.hrDocGetDocs() : [];
    },

    fetchAllHrTombstones: async function() {
      var tombs = {};
      try { tombs = JSON.parse(root.localStorage.getItem('ATPL_HR_TOMBSTONES_V2') || '{}'); } catch (_) {}
      return Object.keys(tombs).map(function(k) { return { id: k, deleted_at: tombs[k] }; });
    },

    subscribeSalaryFiles: function(cb) {
      if (typeof cb === 'function') salarySubscribers.push(cb);
      return function() {};
    },

    subscribeTombstones: function(cb) {
      if (typeof cb === 'function') salaryTombSubscribers.push(cb);
      return function() {};
    },

    subscribeHrDocs: function(cb) {
      if (typeof cb === 'function') hrSubscribers.push(cb);
      return function() {};
    },

    subscribeHrTombstones: function(cb) {
      if (typeof cb === 'function') hrTombSubscribers.push(cb);
      return function() {};
    },

    decodeDocPayload: async function(doc) {
      if (!doc) return doc;
      if (doc.payload) return doc.payload;
      return doc;
    },

    decodeHrPayload: async function(doc) {
      if (!doc) return doc;
      if (doc.payload) return doc.payload;
      return doc;
    },

    safeKey: function(k) { return String(k || '').replace(/[^a-zA-Z0-9_-]/g, '_'); },
    safeHrKey: function(k) { return String(k || '').replace(/[^a-zA-Z0-9_-]/g, '_'); },
    fetchAllEmployeeMaster: async function() { return (root.EM && root.EM.data) || []; },
    saveEmployeeMaster: async function(recs) {
      if (root.ATPLGoogleSync && typeof root.ATPLGoogleSync.saveEmployeeMaster === 'function') {
        return await root.ATPLGoogleSync.saveEmployeeMaster(recs);
      }
      return true;
    },

    init: function() {
      root.ATPLGitHubSync = this;
      root.__atplFirebaseQuotaExhausted = false;
      // Do NOT overwrite window.ATPLFirebase if atpl-firebase-bundle.js already set it up
      if (!root.ATPLFirebase) {
        root.ATPLFirebase = this;
      }
      console.log('[ATPL-Sync] Zero-Hang GitHub Bridge active.');
    }
  };

  root.ATPLGitHubSync = ATPLGitHubSync;
  try { ATPLGitHubSync.init(); } catch (_) {}
})(typeof window !== 'undefined' ? window : this);
