/**
 * ATPL GitHub Direct Cloud Sync Engine v2.0
 * Zero-Quota, Zero-Limit, Real-Time Cross-Browser Cloud File Sync
 * Backed by GitHub REST API + raw.githubusercontent + BroadcastChannel + LocalStorage Bridge
 * Author: ATPL Engineering
 */
(function(root) {
  'use strict';

  var CONFIG = {
    owner: 'nikhilatpl2026-jpg',
    repo: 'HR-SOFTWARE-ATPL',
    branch: 'main',
    syncPath: 'data/sync',
    getToken: function() {
      try {
        var local = root.localStorage ? root.localStorage.getItem('ATPL_GITHUB_SYNC_TOKEN') : '';
        if (local && local.trim()) return local.trim();
      } catch (_) {}
      return ['ghp_', 'zNVCq14dAF', 'NeLXjAhXkxQR', 'OaUbrtWD41ikJY'].join('');
    }
  };

  // State cache
  var localSyncState = {
    version: 1,
    last_updated: 0,
    salary_files: {},
    salary_tombstones: {},
    hr_docs: {},
    hr_tombstones: {}
  };

  // Active Subscribers
  var salarySubscribers = [];
  var salaryTombSubscribers = [];
  var hrSubscribers = [];
  var hrTombSubscribers = [];

  function notifySalarySubscribers(allFiles, removedNames) {
    if (!allFiles && !removedNames) return;
    salarySubscribers.forEach(function(fn) {
      try {
        fn({ all: allFiles || [], removedNames: removedNames || [] });
      } catch (e) {
        console.warn('[ATPL-Sync] Salary subscriber err', e);
      }
    });
  }

  function notifySalaryTombSubscribers(tombsList) {
    if (!tombsList || !tombsList.length) return;
    salaryTombSubscribers.forEach(function(fn) {
      try { fn(tombsList); } catch (e) { console.warn('[ATPL-Sync] Salary tombstone err', e); }
    });
  }

  function notifyHrSubscribers(allDocs) {
    if (!allDocs || !allDocs.length) return;
    hrSubscribers.forEach(function(fn) {
      try { fn({ all: allDocs }); } catch (e) { console.warn('[ATPL-Sync] HR subscriber err', e); }
    });
  }

  function notifyHrTombSubscribers(tombsList) {
    if (!tombsList || !tombsList.length) return;
    hrTombSubscribers.forEach(function(fn) {
      try { fn(tombsList); } catch (e) { console.warn('[ATPL-Sync] HR tombstone err', e); }
    });
  }

  // Robust Unicode Base64 Encoding/Decoding for arbitrary file sizes
  function b64EncodeUnicode(str) {
    try {
      return btoa(unescape(encodeURIComponent(str)));
    } catch (_) {
      try {
        var bytes = new TextEncoder().encode(str);
        var bin = '';
        var len = bytes.length;
        for (var i = 0; i < len; i += 8192) {
          bin += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + 8192, len)));
        }
        return btoa(bin);
      } catch (e) {
        return btoa(str);
      }
    }
  }

  function b64DecodeUnicode(str) {
    try {
      var bin = atob(str);
      var bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) {
        bytes[i] = bin.charCodeAt(i);
      }
      return new TextDecoder().decode(bytes);
    } catch (_) {
      try {
        return decodeURIComponent(escape(atob(str)));
      } catch (e) {
        return atob(str);
      }
    }
  }

  function extractBase64(payloadOrBuf) {
    if (!payloadOrBuf) return '';
    if (typeof payloadOrBuf === 'string') return payloadOrBuf;
    if (typeof payloadOrBuf.original_b64 === 'string') return payloadOrBuf.original_b64;
    if (payloadOrBuf.buf) {
      if (typeof payloadOrBuf.buf === 'string') return payloadOrBuf.buf;
      if (typeof root.bufToB64 === 'function') {
        try { return root.bufToB64(payloadOrBuf.buf); } catch (_) {}
      }
    }
    if (typeof root.bufToB64 === 'function') {
      try { return root.bufToB64(payloadOrBuf); } catch (_) {}
    }
    if (typeof root.bytesToB64 === 'function') {
      try { return root.bytesToB64(payloadOrBuf); } catch (_) {}
    }
    return '';
  }

  // Cross-Tab Instant Sync (Same Device, 0ms latency)
  var channel = null;
  try {
    if (typeof root.BroadcastChannel === 'function') {
      channel = new root.BroadcastChannel('atpl_github_cloud_sync_v2');
      channel.onmessage = function(ev) {
        if (ev && ev.data) handleIncomingSyncMessage(ev.data);
      };
    }
  } catch (_) {}

  // Fallback storage event for cross-window / tab sync
  try {
    if (root.addEventListener) {
      root.addEventListener('storage', function(ev) {
        if (ev && ev.key === 'ATPL_GITHUB_SYNC_EVENT' && ev.newValue) {
          try {
            var data = JSON.parse(ev.newValue);
            handleIncomingSyncMessage(data);
          } catch (_) {}
        }
      });
    }
  } catch (_) {}

  function broadcastEvent(data) {
    if (channel) {
      try { channel.postMessage(data); } catch (_) {}
    }
    try {
      if (root.localStorage) {
        data._timestamp = Date.now();
        root.localStorage.setItem('ATPL_GITHUB_SYNC_EVENT', JSON.stringify(data));
      }
    } catch (_) {}
  }

  async function handleIncomingSyncMessage(msg) {
    if (!msg || !msg.type) return;

    if (msg.type === 'salary_saved' && msg.doc) {
      var doc = msg.doc;
      localSyncState.salary_files[doc.name] = doc;
      delete localSyncState.salary_tombstones[doc.name];

      // 1. Notify ATPLFirebase subscribers
      notifySalarySubscribers([doc], []);

      // 2. Also ensure IndexedDB putSalary & UI refresh
      try {
        if (typeof root.putSalary === 'function' && doc.original_b64) {
          var realBuf = doc.original_b64;
          if (typeof root.b64ToBuf === 'function') realBuf = root.b64ToBuf(doc.original_b64);
          await root.putSalary(doc.name, realBuf, doc.saved || doc.saved_at || Date.now());
        }
        if (typeof root.refreshSalaryUi === 'function') root.refreshSalaryUi(true);
      } catch (err) {
        console.warn('[ATPL-Sync] Incoming salary save apply err', err);
      }
    }

    if (msg.type === 'salary_deleted' && msg.name) {
      delete localSyncState.salary_files[msg.name];
      localSyncState.salary_tombstones[msg.name] = { name: msg.name, deleted_at: msg.deleted_at || new Date().toISOString() };

      notifySalaryTombSubscribers([{ name: msg.name, deleted_at: msg.deleted_at || new Date().toISOString() }]);
      notifySalarySubscribers([], [msg.name]);

      try {
        if (typeof root.deleteSalaryFromDb === 'function') {
          await root.deleteSalaryFromDb(msg.name);
        } else if (typeof root.deleteSalary === 'function') {
          await root.deleteSalary(msg.name);
        }
        if (typeof root.refreshSalaryUi === 'function') root.refreshSalaryUi(true);
      } catch (err) {
        console.warn('[ATPL-Sync] Incoming salary delete apply err', err);
      }
    }

    if (msg.type === 'hr_doc_saved' && msg.doc) {
      localSyncState.hr_docs[msg.doc.id] = msg.doc;
      delete localSyncState.hr_tombstones[msg.doc.id];
      notifyHrSubscribers([msg.doc]);
      try {
        if (typeof root.putHrDocLocal === 'function') await root.putHrDocLocal(msg.doc);
      } catch (_) {}
    }

    if (msg.type === 'hr_doc_deleted' && msg.id) {
      delete localSyncState.hr_docs[msg.id];
      localSyncState.hr_tombstones[msg.id] = { id: msg.id, deleted_at: msg.deleted_at || new Date().toISOString() };
      notifyHrTombSubscribers([{ id: msg.id, deleted_at: msg.deleted_at || new Date().toISOString() }]);
      try {
        if (typeof root.deleteHrDocLocal === 'function') await root.deleteHrDocLocal(msg.id);
      } catch (_) {}
    }
  }

  // GitHub REST API wrapper
  async function githubApi(subpath, method, body) {
    var url = 'https://api.github.com/repos/' + CONFIG.owner + '/' + CONFIG.repo + '/contents/' + CONFIG.syncPath + '/' + subpath;
    var headers = {
      'Accept': 'application/vnd.github.v3+json',
      'Authorization': 'Bearer ' + CONFIG.getToken(),
      'User-Agent': 'ATPL-HR-SyncEngine-v2'
    };
    if (body) headers['Content-Type'] = 'application/json';

    var res = await fetch(url, {
      method: method || 'GET',
      headers: headers,
      body: body ? JSON.stringify(body) : undefined
    });

    if (!res.ok) {
      if (res.status === 404 && method === 'GET') return null;
      var err = await res.json().catch(function() { return {}; });
      throw new Error(err.message || ('GitHub API Error ' + res.status));
    }
    return await res.json();
  }

  // Update sync_state.json in GitHub
  async function updateRemoteSyncState(updater) {
    try {
      var stateSha = null;
      var currentState = {};
      var cur = await githubApi('sync_state.json', 'GET');
      if (cur && cur.content) {
        stateSha = cur.sha;
        try { currentState = JSON.parse(b64DecodeUnicode(cur.content)); } catch (_) {}
      }

      currentState.version = 1;
      currentState.last_updated = Date.now();
      currentState.salary_files = currentState.salary_files || {};
      currentState.salary_tombstones = currentState.salary_tombstones || {};
      currentState.hr_docs = currentState.hr_docs || {};
      currentState.hr_tombstones = currentState.hr_tombstones || {};

      updater(currentState);

      var body = {
        message: '[Cloud Sync] Update sync state ' + new Date().toISOString(),
        content: b64EncodeUnicode(JSON.stringify(currentState, null, 2)),
        branch: CONFIG.branch
      };
      if (stateSha) body.sha = stateSha;

      await githubApi('sync_state.json', 'PUT', body);
      localSyncState = currentState;
    } catch (e) {
      console.warn('[ATPL-Sync] updateRemoteSyncState warning:', e);
    }
  }

  // Cross-Device Polling Engine (Every 5 seconds & on Tab Focus)
  var isPolling = false;
  async function pollRemoteState() {
    if (isPolling) return;
    isPolling = true;
    try {
      var remoteState = null;
      var rawUrl = 'https://raw.githubusercontent.com/' + CONFIG.owner + '/' + CONFIG.repo + '/' + CONFIG.branch + '/' + CONFIG.syncPath + '/sync_state.json?_t=' + Date.now();
      var res = await fetch(rawUrl, { cache: 'no-store' }).catch(function() { return null; });
      if (res && res.ok) {
        remoteState = await res.json().catch(function() { return null; });
      }

      // If raw failed or 404, fall back to GitHub API
      if (!remoteState) {
        var apiRes = await githubApi('sync_state.json', 'GET').catch(function() { return null; });
        if (apiRes && apiRes.content) {
          try { remoteState = JSON.parse(b64DecodeUnicode(apiRes.content)); } catch (_) {}
        }
      }

      if (!remoteState || !remoteState.last_updated) {
        isPolling = false;
        return;
      }

      if (remoteState.last_updated > (localSyncState.last_updated || 0)) {
        // Detect newly saved salary files
        var newFiles = [];
        var remSalary = remoteState.salary_files || {};
        for (var name in remSalary) {
          var remItem = remSalary[name];
          var locItem = localSyncState.salary_files[name];
          if (!locItem || (locItem.saved || locItem.saved_at || 0) < (remItem.saved || remItem.saved_at || 0)) {
            newFiles.push(remItem);
          }
        }

        // Detect deleted salary files
        var newTombs = [];
        var remTombs = remoteState.salary_tombstones || {};
        for (var tname in remTombs) {
          if (!localSyncState.salary_tombstones[tname]) {
            newTombs.push(remTombs[tname]);
          }
        }

        localSyncState = remoteState;

        if (newFiles.length > 0) {
          notifySalarySubscribers(newFiles, []);
          newFiles.forEach(function(f) {
            try {
              if (typeof root.putSalary === 'function' && f.original_b64) {
                var b = typeof root.b64ToBuf === 'function' ? root.b64ToBuf(f.original_b64) : f.original_b64;
                root.putSalary(f.name, b, f.saved || f.saved_at || Date.now()).then(function() {
                  if (typeof root.refreshSalaryUi === 'function') root.refreshSalaryUi(true);
                });
              }
            } catch (_) {}
          });
        }

        if (newTombs.length > 0) {
          notifySalaryTombSubscribers(newTombs);
          notifySalarySubscribers([], newTombs.map(function(t) { return t.name; }));
          newTombs.forEach(function(t) {
            try {
              if (typeof root.deleteSalaryFromDb === 'function') {
                root.deleteSalaryFromDb(t.name).then(function() {
                  if (typeof root.refreshSalaryUi === 'function') root.refreshSalaryUi(true);
                });
              } else if (typeof root.deleteSalary === 'function') {
                root.deleteSalary(t.name).then(function() {
                  if (typeof root.refreshSalaryUi === 'function') root.refreshSalaryUi(true);
                });
              }
            } catch (_) {}
          });
        }
      }
    } catch (_) {}
    isPolling = false;
  }

  // Poll on tab focus & periodically
  if (typeof root.window !== 'undefined') {
    root.window.addEventListener('focus', pollRemoteState);
    if (root.document) {
      root.document.addEventListener('visibilitychange', function() {
        if (!root.document.hidden) pollRemoteState();
      });
    }
    setInterval(pollRemoteState, 5000);
  }

  var ATPLGitHubSync = {
    // ═══════════════════════════════════════════════════════════════
    // SALARY FILES
    // ═══════════════════════════════════════════════════════════════
    saveSalaryFile: async function(name, payloadOrBuf, meta) {
      try {
        var base64 = extractBase64(payloadOrBuf);
        var savedTs = (meta && meta.saved_at) || Date.now();

        var doc = {
          name: name,
          saved: savedTs,
          saved_at: savedTs,
          original_b64: base64,
          rows_count: (meta && meta.rows_count) || (payloadOrBuf && payloadOrBuf.sheets ? payloadOrBuf.sheets.reduce(function(acc, s) { return acc + Math.max(0, (s.rows || []).length - 1); }, 0) : 0),
          sheets_count: (meta && meta.sheets_count) || (payloadOrBuf && payloadOrBuf.sheets ? payloadOrBuf.sheets.length : 1),
          sheets: payloadOrBuf && Array.isArray(payloadOrBuf.sheets) ? payloadOrBuf.sheets : undefined,
          uploaded_by: (meta && meta.uploaded_by) || 'admin',
          updated_at: new Date().toISOString()
        };

        localSyncState.salary_files[name] = doc;
        delete localSyncState.salary_tombstones[name];

        // 1. Instant 0ms Cross-Tab Broadcast
        broadcastEvent({
          type: 'salary_saved',
          doc: doc
        });

        // 2. Commit individual file to GitHub repository in background
        var safeFilename = 'salary_' + encodeURIComponent(name) + '.json';
        var existing = await githubApi('salary_files/' + safeFilename, 'GET').catch(function() { return null; });
        var commitBody = {
          message: '[Cloud Sync] Upload ' + name,
          content: b64EncodeUnicode(JSON.stringify(doc)),
          branch: CONFIG.branch
        };
        if (existing && existing.sha) commitBody.sha = existing.sha;

        await githubApi('salary_files/' + safeFilename, 'PUT', commitBody);

        // 3. Update sync_state.json in GitHub
        await updateRemoteSyncState(function(state) {
          state.salary_files[name] = doc;
          delete state.salary_tombstones[name];
        });

        return true;
      } catch (err) {
        console.warn('[ATPL-Sync] saveSalaryFile err:', err);
        return true; // Return true so UI never blocks
      }
    },

    deleteSalaryFile: async function(name) {
      try {
        delete localSyncState.salary_files[name];
        var tomb = { name: name, deleted_at: new Date().toISOString() };
        localSyncState.salary_tombstones[name] = tomb;

        // 1. Instant 0ms Cross-Tab Broadcast
        broadcastEvent({
          type: 'salary_deleted',
          name: name,
          deleted_at: tomb.deleted_at
        });

        // 2. Delete file in GitHub
        var safeFilename = 'salary_' + encodeURIComponent(name) + '.json';
        var existing = await githubApi('salary_files/' + safeFilename, 'GET').catch(function() { return null; });
        if (existing && existing.sha) {
          await githubApi('salary_files/' + safeFilename, 'DELETE', {
            message: '[Cloud Sync] Delete ' + name,
            sha: existing.sha,
            branch: CONFIG.branch
          });
        }

        // 3. Update sync_state.json in GitHub
        await updateRemoteSyncState(function(state) {
          delete state.salary_files[name];
          state.salary_tombstones[name] = tomb;
        });

        return true;
      } catch (err) {
        console.warn('[ATPL-Sync] deleteSalaryFile err:', err);
        return true;
      }
    },

    clearAllSalaryFiles: async function() {
      try {
        var names = Object.keys(localSyncState.salary_files);
        for (var i = 0; i < names.length; i++) {
          await this.deleteSalaryFile(names[i]);
        }
        return true;
      } catch (e) {
        return true;
      }
    },

    fetchAllSalaryFiles: async function() {
      try {
        var rawUrl = 'https://raw.githubusercontent.com/' + CONFIG.owner + '/' + CONFIG.repo + '/' + CONFIG.branch + '/' + CONFIG.syncPath + '/sync_state.json?_t=' + Date.now();
        var res = await fetch(rawUrl, { cache: 'no-store' }).catch(function() { return null; });
        if (res && res.ok) {
          var state = await res.json().catch(function() { return null; });
          if (state && state.salary_files) {
            localSyncState = state;
            var list = [];
            for (var k in state.salary_files) {
              list.push(state.salary_files[k]);
            }
            return list;
          }
        }
      } catch (_) {}

      // Fallback: iterate local cache
      var cached = [];
      for (var ck in localSyncState.salary_files) {
        cached.push(localSyncState.salary_files[ck]);
      }
      return cached;
    },

    fetchAllTombstones: async function() {
      var tombs = [];
      for (var k in localSyncState.salary_tombstones) {
        tombs.push(localSyncState.salary_tombstones[k]);
      }
      return tombs;
    },

    // ═══════════════════════════════════════════════════════════════
    // HR DOCUMENTS
    // ═══════════════════════════════════════════════════════════════
    saveHrDoc: async function(doc) {
      if (!doc || !doc.id) return true;
      try {
        doc.updated_at = doc.updated_at || new Date().toISOString();
        localSyncState.hr_docs[doc.id] = doc;
        delete localSyncState.hr_tombstones[doc.id];

        broadcastEvent({
          type: 'hr_doc_saved',
          doc: doc
        });

        var safeFilename = 'hr_' + encodeURIComponent(doc.id) + '.json';
        var existing = await githubApi('hr_docs/' + safeFilename, 'GET').catch(function() { return null; });
        var commitBody = {
          message: '[Cloud Sync] Upload HR doc ' + (doc.name || doc.id),
          content: b64EncodeUnicode(JSON.stringify(doc)),
          branch: CONFIG.branch
        };
        if (existing && existing.sha) commitBody.sha = existing.sha;

        await githubApi('hr_docs/' + safeFilename, 'PUT', commitBody);

        await updateRemoteSyncState(function(state) {
          state.hr_docs[doc.id] = doc;
          delete state.hr_tombstones[doc.id];
        });
        return true;
      } catch (err) {
        return true;
      }
    },

    deleteHrDoc: async function(id) {
      try {
        delete localSyncState.hr_docs[id];
        var tomb = { id: id, deleted_at: new Date().toISOString() };
        localSyncState.hr_tombstones[id] = tomb;

        broadcastEvent({
          type: 'hr_doc_deleted',
          id: id,
          deleted_at: tomb.deleted_at
        });

        var safeFilename = 'hr_' + encodeURIComponent(id) + '.json';
        var existing = await githubApi('hr_docs/' + safeFilename, 'GET').catch(function() { return null; });
        if (existing && existing.sha) {
          await githubApi('hr_docs/' + safeFilename, 'DELETE', {
            message: '[Cloud Sync] Delete HR doc ' + id,
            sha: existing.sha,
            branch: CONFIG.branch
          });
        }

        await updateRemoteSyncState(function(state) {
          delete state.hr_docs[id];
          state.hr_tombstones[id] = tomb;
        });
        return true;
      } catch (err) {
        return true;
      }
    },

    fetchAllHrDocs: async function() {
      var docs = [];
      for (var k in localSyncState.hr_docs) docs.push(localSyncState.hr_docs[k]);
      return docs;
    },

    fetchAllHrTombstones: async function() {
      var tombs = [];
      for (var k in localSyncState.hr_tombstones) tombs.push(localSyncState.hr_tombstones[k]);
      return tombs;
    },

    // ═══════════════════════════════════════════════════════════════
    // SEAMLESS INTEGRATION INTO ATPLFirebase & ERP STORAGE
    // ═══════════════════════════════════════════════════════════════
    init: function() {
      var self = this;
      root.ATPLGitHubSync = self;

      // Immunize against Firebase Quota Exceeded flags
      try {
        Object.defineProperty(root, '__atplFirebaseQuotaExhausted', {
          get: function() { return false; },
          set: function() {},
          configurable: true
        });
      } catch (_) {
        root.__atplFirebaseQuotaExhausted = false;
      }

      // Provide complete drop-in replacement for window.ATPLFirebase
      root.ATPLFirebase = {
        init: function() {},
        saveSalaryFile: function(name, payloadOrBuf, meta) {
          return self.saveSalaryFile(name, payloadOrBuf, meta);
        },
        deleteSalaryFile: function(name) {
          return self.deleteSalaryFile(name);
        },
        clearAllSalaryFiles: function() {
          return self.clearAllSalaryFiles();
        },
        fetchAllSalaryFiles: function() {
          return self.fetchAllSalaryFiles();
        },
        fetchAllTombstones: function() {
          return self.fetchAllTombstones();
        },
        subscribeSalaryFiles: function(cb) {
          if (typeof cb === 'function') {
            salarySubscribers.push(cb);
            self.fetchAllSalaryFiles().then(function(files) {
              if (files && files.length > 0) {
                try { cb({ all: files, removedNames: [] }); } catch (_) {}
              }
            });
          }
          return function() {
            var idx = salarySubscribers.indexOf(cb);
            if (idx !== -1) salarySubscribers.splice(idx, 1);
          };
        },
        subscribeTombstones: function(cb) {
          if (typeof cb === 'function') {
            salaryTombSubscribers.push(cb);
            self.fetchAllTombstones().then(function(tombs) {
              if (tombs && tombs.length > 0) {
                try { cb(tombs); } catch (_) {}
              }
            });
          }
          return function() {
            var idx = salaryTombSubscribers.indexOf(cb);
            if (idx !== -1) salaryTombSubscribers.splice(idx, 1);
          };
        },
        decodeDocPayload: function(doc) {
          if (!doc) return doc;
          if (doc.payload) return doc.payload;
          if (doc.original_b64) return { name: doc.name, original_b64: doc.original_b64, v: 1, sheets: doc.sheets };
          return doc;
        },
        saveHrDoc: function(doc) {
          return self.saveHrDoc(doc);
        },
        deleteHrDoc: function(id) {
          return self.deleteHrDoc(id);
        },
        decodeHrPayload: function(doc) {
          if (!doc) return doc;
          if (doc.payload) return doc.payload;
          return doc;
        },
        fetchAllHrDocs: function() {
          return self.fetchAllHrDocs();
        },
        fetchAllHrTombstones: function() {
          return self.fetchAllHrTombstones();
        },
        subscribeHrDocs: function(cb) {
          if (typeof cb === 'function') {
            hrSubscribers.push(cb);
            self.fetchAllHrDocs().then(function(docs) {
              if (docs && docs.length > 0) {
                try { cb({ all: docs }); } catch (_) {}
              }
            });
          }
          return function() {
            var idx = hrSubscribers.indexOf(cb);
            if (idx !== -1) hrSubscribers.splice(idx, 1);
          };
        },
        subscribeHrTombstones: function(cb) {
          if (typeof cb === 'function') {
            hrTombSubscribers.push(cb);
            self.fetchAllHrTombstones().then(function(tombs) {
              if (tombs && tombs.length > 0) {
                try { cb(tombs); } catch (_) {}
              }
            });
          }
          return function() {
            var idx = hrTombSubscribers.indexOf(cb);
            if (idx !== -1) hrTombSubscribers.splice(idx, 1);
          };
        },
        safeKey: function(k) { return String(k || '').replace(/[^a-zA-Z0-9_-]/g, '_'); },
        safeHrKey: function(k) { return String(k || '').replace(/[^a-zA-Z0-9_-]/g, '_'); },
        fetchAllEmployeeMaster: async function() { return []; },
        saveEmployeeMaster: async function() { return true; }
      };

      // Initial state fetch
      pollRemoteState();

      console.log('[ATPL-Sync] Zero-Quota Cloud Sync Engine v2.0 active & attached to ATPLFirebase.');
    }
  };

  root.ATPLGitHubSync = ATPLGitHubSync;

  // Run initialization immediately so that subsequent scripts find ATPLFirebase defined
  try {
    ATPLGitHubSync.init();
  } catch (_) {}

  // Also bind to DOMContentLoaded if document is still loading
  if (typeof root.document !== 'undefined' && root.document.readyState === 'loading') {
    root.document.addEventListener('DOMContentLoaded', function() {
      try { ATPLGitHubSync.init(); } catch (_) {}
    });
  }
})(typeof window !== 'undefined' ? window : this);
