/**
 * ATPL Central File Sync — Clean Bridge to Google Drive + Sheet Master Engine
 */
(function(window) {
  'use strict';

  var fileMap = new Map();

  var ATPLCentralFileSync = {
    version: '2026.11.01-GDRIVE-BRIDGE',
    apiBase: '',
    connected: true,
    fileMap: fileMap,

    init: function() {
      if (window.ATPLRealtimeSyncEngine) {
        window.ATPLRealtimeSyncEngine.init();
      }
    },

    uploadFile: async function(module, fileObj, meta, onProgress) {
      if (onProgress) onProgress('preparing', 20);
      var name = fileObj.name;
      var rawBuf = fileObj.buf instanceof ArrayBuffer ? fileObj.buf : (fileObj instanceof Blob ? await fileObj.arrayBuffer() : null);
      var b64 = rawBuf ? window.atplBufToB64(rawBuf) : (typeof fileObj.buf === 'string' ? fileObj.buf : '');
      var now = new Date().toISOString();

      if (module === 'salary' && rawBuf && window.parseWB && window.wbToSheets) {
        var wb = window.parseWB(rawBuf);
        var sheets = window.wbToSheets(wb);
        var entry = { id: name, name: name, wb: wb, sheets: sheets, buf: rawBuf, savedAt: now };
        fileMap.set(name.toLowerCase().trim(), entry);
        window.FILES = (window.FILES || []).filter(function(x) { return x && x.name.toLowerCase() !== name.toLowerCase(); });
        window.FILES.push(entry);
      }

      if (onProgress) onProgress('uploading', 60);
      if (module === 'salary') {
        await window.ATPLRealtimeSyncEngine.saveSalaryFile(name, { original_b64: b64, name: name }, { name: name, saved_at: now });
      } else if (module === 'hr_doc') {
        await window.ATPLRealtimeSyncEngine.saveHrDoc(fileObj);
      } else if (module === 'pf' || module === 'esic') {
        await window.ATPLRealtimeSyncEngine.saveComplianceDoc(module, name, fileObj);
      }
      if (onProgress) onProgress('saved', 100);
      return { id: name, name: name, created_at: now };
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
      if (module === 'salary') {
        return await window.ATPLRealtimeSyncEngine.deleteSalaryFile(idOrName);
      } else if (module === 'hr_doc') {
        return await window.ATPLRealtimeSyncEngine.deleteHrDoc(idOrName, idOrName);
      } else {
        return await window.ATPLRealtimeSyncEngine.deleteComplianceDoc(module, idOrName, idOrName);
      }
    },

    clearModule: async function(module) {
      if (module === 'salary') {
        return await window.ATPLRealtimeSyncEngine.clearAllSalaryFiles();
      }
      return true;
    },

    reconcileAll: async function(force) {
      if (window.ATPLRealtimeSyncEngine) {
        return await window.ATPLRealtimeSyncEngine.triggerUniversalReconciliation(!!force);
      }
    }
  };

  window.ATPLCentralFileSync = ATPLCentralFileSync;
})(window);
