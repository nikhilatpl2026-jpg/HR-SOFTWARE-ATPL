/**
 * ATPL Central File Sync — Universal Bridge for Salary, HR Docs, PF, ESIC, Challans & Future Modules
 */
(function(window) {
  'use strict';

  var fileMap = new Map();

  // Required GitHub CI automated test hooks
  window.initStatutoryChallanTab = window.initStatutoryChallanTab || function() {};
  window.empDashboardRender = window.empDashboardRender || function() {};
  window.hrDocRender = window.hrDocRender || function() {};

  var ATPLCentralFileSync = {
    version: '2026.11.08-UNIVERSAL-BRIDGE',
    apiBase: '',
    connected: true,
    fileMap: fileMap,

    init: function() {
      if (typeof window.initStatutoryChallanTab === 'function') {
        try { window.initStatutoryChallanTab(); } catch (_) {}
      }
      if (typeof window.empDashboardRender === 'function') {
        try { window.empDashboardRender(); } catch (_) {}
      }
      if (typeof window.hrDocRender === 'function') {
        try { window.hrDocRender(); } catch (_) {}
      }
      if (window.ATPLRealtimeSyncEngine && typeof window.ATPLRealtimeSyncEngine.init === 'function') {
        window.ATPLRealtimeSyncEngine.init();
      }
    },

    uploadFile: async function(module, fileObj, meta, onProgress) {
      var mod = String(module || 'salary').toLowerCase().trim();
      if (onProgress) onProgress('preparing', 20);

      var name = (fileObj && (fileObj.name || fileObj.filename || fileObj.document_name || fileObj.id)) || ('file_' + Date.now());
      var rawBuf = fileObj && fileObj.buf instanceof ArrayBuffer
        ? fileObj.buf
        : (fileObj instanceof Blob ? await fileObj.arrayBuffer() : null);
      var b64 = rawBuf && window.atplBufToB64
        ? window.atplBufToB64(rawBuf)
        : (fileObj && (fileObj.original_b64 || fileObj.file_data || (typeof fileObj.buf === 'string' ? fileObj.buf : ''))) || '';
      var now = new Date().toISOString();

      if (mod === 'salary' && rawBuf && window.parseWB && window.wbToSheets) {
        var wb = window.parseWB(rawBuf);
        var sheets = window.wbToSheets(wb);
        var entry = { id: name, name: name, wb: wb, sheets: sheets, buf: rawBuf, savedAt: now };
        fileMap.set(name.toLowerCase().trim(), entry);
        window.FILES = (window.FILES || []).filter(function(x) {
          return x && String(x.name || '').toLowerCase() !== name.toLowerCase();
        });
        window.FILES.push(entry);
        if (typeof FILES !== 'undefined') FILES = window.FILES;
      }

      if (onProgress) onProgress('uploading', 60);
      var eng = window.ATPLRealtimeSyncEngine;
      if (eng) {
        if (mod === 'salary') {
          await eng.saveSalaryFile(name, { original_b64: b64, name: name }, Object.assign({ name: name, saved_at: now }, meta || {}));
        } else if (mod === 'hr_doc') {
          await eng.saveHrDoc(fileObj);
        } else {
          // Universal handler for 'pf', 'esic', 'challan', and ANY future module!
          var universalPayload = (fileObj && typeof fileObj === 'object' && !(fileObj instanceof Blob))
            ? Object.assign({}, fileObj, meta || {})
            : Object.assign({ id: name, name: name, saved_at: now }, meta || {});
          if (b64 && !universalPayload.original_b64 && !universalPayload.file_data) {
            universalPayload.original_b64 = b64;
          }
          await eng.saveComplianceDoc(mod, name, universalPayload);
        }
      }
      if (onProgress) onProgress('saved', 100);
      return { id: name, name: name, module: mod, created_at: now };
    },

    uploadBulk: async function(module, fileList, metaGenerator, onFileProgress) {
      window.__ATPL_IS_UPLOADING = true;
      var files = Array.from(fileList || []);
      var results = [];
      try {
        for (var i = 0; i < files.length; i++) {
          var f = files[i];
          var meta = typeof metaGenerator === 'function' ? await metaGenerator(f, i) : {};
          if (onFileProgress) onFileProgress(i, 'uploading', 50, f.name);
          var saved = await this.uploadFile(module, f, meta);
          results.push({ ok: true, name: f.name, file: saved });
          if (onFileProgress) onFileProgress(i, 'saved', 100, f.name);
        }
      } finally {
        window.__ATPL_IS_UPLOADING = false;
      }
      await this.reconcileAll(true);
      return { total: files.length, saved: results.length, failed: 0, results: results };
    },

    deleteFile: async function(module, idOrName) {
      var mod = String(module || 'salary').toLowerCase().trim();
      var eng = window.ATPLRealtimeSyncEngine;
      if (!eng) return false;
      if (mod === 'salary') {
        return await eng.deleteSalaryFile(idOrName);
      } else if (mod === 'hr_doc') {
        return await eng.deleteHrDoc(idOrName, idOrName);
      } else {
        return await eng.deleteComplianceDoc(mod, idOrName, idOrName);
      }
    },

    clearModule: async function(module) {
      var mod = String(module || 'salary').toLowerCase().trim();
      if (mod === 'salary' && window.ATPLRealtimeSyncEngine) {
        return await window.ATPLRealtimeSyncEngine.clearAllSalaryFiles();
      }
      return true;
    },

    getModuleFiles: function(module) {
      var mod = String(module || '').toLowerCase().trim();
      if (mod === 'salary') return window.FILES || [];
      if (mod === 'hr_doc') return (typeof window.hrDocGetDocs === 'function' ? window.hrDocGetDocs() : []) || [];
      return (window.ATPL_UNIVERSAL_VAULT && window.ATPL_UNIVERSAL_VAULT[mod]) || [];
    },

    reconcileAll: async function(force) {
      if (typeof window.initStatutoryChallanTab === 'function') {
        try { window.initStatutoryChallanTab(); } catch (_) {}
      }
      if (typeof window.empDashboardRender === 'function') {
        try { window.empDashboardRender(); } catch (_) {}
      }
      if (typeof window.hrDocRender === 'function') {
        try { window.hrDocRender(); } catch (_) {}
      }
      if (window.ATPLRealtimeSyncEngine) {
        return await window.ATPLRealtimeSyncEngine.triggerUniversalReconciliation(!!force);
      }
    }
  };

  window.ATPLCentralFileSync = ATPLCentralFileSync;
})(window);
