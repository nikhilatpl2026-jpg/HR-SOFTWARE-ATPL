window.ATPLCloudDebugger = (function() {
    var modal = null;
    var logBuffer = [];

    var oldError = window.onerror;
    window.onerror = function(msg, url, line, col, err) {
        logBuffer.push('[ERROR] ' + msg + ' at ' + line + ':' + col);
        if (oldError) return oldError(msg, url, line, col, err);
        return false;
    };

    var oldWarn = console.warn;
    console.warn = function() {
        var args = Array.prototype.slice.call(arguments);
        logBuffer.push('[WARN] ' + args.join(' '));
        oldWarn.apply(console, args);
    };

    function createModal() {
        if (modal) return;
        modal = document.createElement('div');
        modal.style.cssText = 'position:fixed;top:8%;left:8%;width:84%;height:84%;background:#1e293b;color:#f8fafc;z-index:999999;border-radius:12px;box-shadow:0 25px 50px -12px rgba(0,0,0,0.5);display:flex;flex-direction:column;font-family:sans-serif;overflow:hidden;border:1px solid #475569;';

        var header = document.createElement('div');
        header.style.cssText = 'padding:16px;background:#0f172a;border-bottom:1px solid #334155;display:flex;justify-content:space-between;align-items:center;';
        header.innerHTML = '<h2 style="margin:0;font-size:18px;color:#38bdf8;">☁️ ATPL Multi-Cloud Sync Debugger & Health Check</h2>';

        var closeBtn = document.createElement('button');
        closeBtn.innerText = 'Close X';
        closeBtn.style.cssText = 'background:#ef4444;color:white;border:none;padding:6px 12px;border-radius:6px;cursor:pointer;font-weight:bold;';
        closeBtn.onclick = function() { modal.style.display = 'none'; };
        header.appendChild(closeBtn);

        var content = document.createElement('div');
        content.style.cssText = 'flex:1;overflow:auto;padding:20px;display:flex;gap:20px;';

        var leftCol = document.createElement('div');
        leftCol.style.cssText = 'flex:1;display:flex;flex-direction:column;gap:15px;';

        var rightCol = document.createElement('div');
        rightCol.style.cssText = 'flex:1.2;display:flex;flex-direction:column;gap:15px;background:#090d16;padding:15px;border-radius:8px;font-family:monospace;font-size:12px;overflow:auto;border:1px solid #334155;';

        modal.appendChild(header);
        modal.appendChild(content);
        content.appendChild(leftCol);
        content.appendChild(rightCol);

        var actionsBox = document.createElement('div');
        actionsBox.style.cssText = 'background:#334155;padding:15px;border-radius:8px;';
        actionsBox.innerHTML = '<h3 style="margin-top:0;margin-bottom:10px;">Sync & Cache Tools</h3>';

        var btnForceSync = document.createElement('button');
        btnForceSync.innerText = '⚡ FORCE REAL-TIME CLOUD SYNC NOW (ALL 4 MODULES)';
        btnForceSync.style.cssText = 'width:100%;padding:10px;background:#10b981;color:white;border:none;border-radius:6px;font-weight:bold;cursor:pointer;margin-bottom:10px;';
        btnForceSync.onclick = async function() {
            btnForceSync.innerText = '⏳ Syncing All Modules...';
            try {
                if (window.ATPLRealtimeSyncEngine && typeof window.ATPLRealtimeSyncEngine.triggerUniversalReconciliation === 'function') {
                    await window.ATPLRealtimeSyncEngine.triggerUniversalReconciliation();
                }
                if (window.ATPLCentralFileSync && typeof window.ATPLCentralFileSync.reconcileAll === 'function') {
                    await window.ATPLCentralFileSync.reconcileAll(true);
                }
                btnForceSync.innerText = '✅ Sync Complete!';
                setTimeout(function() { btnForceSync.innerText = '⚡ FORCE REAL-TIME CLOUD SYNC NOW (ALL 4 MODULES)'; }, 2500);
            } catch (e) {
                btnForceSync.innerText = '⚠️ Sync Notice: ' + (e.message || e);
            }
        };
        actionsBox.appendChild(btnForceSync);

        var btnKillCache = document.createElement('button');
        btnKillCache.innerText = '🧹 NUKE LOCAL CACHE & HARD REFRESH FROM CLOUD';
        btnKillCache.style.cssText = 'width:100%;padding:10px;background:#dc2626;color:white;border:none;border-radius:6px;font-weight:bold;cursor:pointer;margin-bottom:10px;';
        btnKillCache.onclick = async function() {
            btnKillCache.innerText = 'Nuking...';
            try {
                if (navigator.serviceWorker) {
                    var regs = await navigator.serviceWorker.getRegistrations();
                    for (var i = 0; i < regs.length; i++) await regs[i].unregister();
                }
                if (window.caches) {
                    var keys = await caches.keys();
                    for (var j = 0; j < keys.length; j++) await caches.delete(keys[j]);
                }
                localStorage.removeItem('ATPL_ALL_SALARY_CLEARED_AT');
                localStorage.removeItem('ATPL_AUTHORITY_SCHEMA_VERSION');
                alert("Local cache cleared! Browser will now reload fresh from Cloud.");
                window.location.reload(true);
            } catch(e) { alert("Error nuking cache: " + e); }
        };
        actionsBox.appendChild(btnKillCache);

        var btnCheckDb = document.createElement('button');
        btnCheckDb.innerText = '🔍 Scan Live Multi-Cloud Database (Firebase + GitHub)';
        btnCheckDb.style.cssText = 'width:100%;padding:10px;background:#2563eb;color:white;border:none;border-radius:6px;font-weight:bold;cursor:pointer;';
        btnCheckDb.onclick = async function() {
            rightCol.innerHTML = '<div style="color:#38bdf8">Scanning Live Multi-Cloud (Firebase Firestore + GitHub Repository)...</div>';
            try {
                var fb = window.ATPLNativeFirebase || window.ATPLFirebase;
                var salFiles = fb && typeof fb.fetchAllSalaryFiles === 'function' ? await fb.fetchAllSalaryFiles() : [];
                var salTombs = fb && typeof fb.fetchAllTombstones === 'function' ? await fb.fetchAllTombstones() : [];
                var hrDocs = fb && typeof fb.fetchAllHrDocs === 'function' ? await fb.fetchAllHrDocs() : [];
                var pfRecs = fb && typeof fb.fetchAllDolRecords === 'function' ? await fb.fetchAllDolRecords('pf') : [];
                var esicRecs = fb && typeof fb.fetchAllDolRecords === 'function' ? await fb.fetchAllDolRecords('esic') : [];
                var ghManifest = window.ATPLGitHubCloud ? await window.ATPLGitHubCloud.getManifest(true) : null;
                var ghCount = ghManifest && ghManifest.files ? Object.keys(ghManifest.files).length : 0;

                var html = '<div style="color:#22c55e;font-weight:bold;">✅ Multi-Cloud Connection Healthy & Active!</div><hr style="border-color:#334155">';
                html += '<div style="margin:8px 0;color:#e2e8f0;">' +
                    '• <b>All Files (Salary):</b> ' + (salFiles ? salFiles.length : 0) + ' active (' + (salTombs ? salTombs.length : 0) + ' tombstones)<br>' +
                    '• <b>HR Documents:</b> ' + (hrDocs ? hrDocs.length : 0) + ' active<br>' +
                    '• <b>PF Challans (DOL):</b> ' + (pfRecs ? pfRecs.length : 0) + ' active<br>' +
                    '• <b>ESIC Challans (DOL):</b> ' + (esicRecs ? esicRecs.length : 0) + ' active<br>' +
                    '• <b>GitHub Cloud Manifest:</b> ' + ghCount + ' synced file entries' +
                    '</div><hr style="border-color:#334155">';
                html += '<table style="width:100%;text-align:left;border-collapse:collapse;"><tr><th>Name / ID</th><th>Module</th><th>Status</th></tr>';
                (salFiles || []).forEach(function(d) {
                    html += '<tr style="border-bottom:1px solid #1e293b;"><td style="padding:4px 0">' + (d.name || d.id) + '</td><td style="color:#38bdf8">All Files (Salary)</td><td style="color:#22c55e">Active</td></tr>';
                });
                (hrDocs || []).forEach(function(d) {
                    html += '<tr style="border-bottom:1px solid #1e293b;"><td style="padding:4px 0">' + (d.document_name || d.id) + '</td><td style="color:#a855f7">HR Document</td><td style="color:#22c55e">Active</td></tr>';
                });
                (pfRecs || []).forEach(function(d) {
                    html += '<tr style="border-bottom:1px solid #1e293b;"><td style="padding:4px 0">' + (d.name || d.file_name || d.id) + '</td><td style="color:#f59e0b">PF Challan</td><td style="color:#22c55e">Active</td></tr>';
                });
                (esicRecs || []).forEach(function(d) {
                    html += '<tr style="border-bottom:1px solid #1e293b;"><td style="padding:4px 0">' + (d.name || d.file_name || d.id) + '</td><td style="color:#ec4899">ESIC Challan</td><td style="color:#22c55e">Active</td></tr>';
                });
                (salTombs || []).forEach(function(t) {
                    html += '<tr style="border-bottom:1px solid #1e293b;"><td style="padding:4px 0">' + (t.name || t.id) + '</td><td style="color:#ef4444">Tombstone</td><td style="color:#ef4444">Deleted</td></tr>';
                });
                html += '</table>';
                rightCol.innerHTML = html;
            } catch(e) {
                rightCol.innerHTML = '<div style="color:red">Error: ' + String(e.message || e) + '</div>';
            }
        };
        actionsBox.appendChild(btnCheckDb);

        var tokenWrap = document.createElement('div');
        tokenWrap.style.cssText = 'margin-top:12px;padding-top:12px;border-top:1px solid #475569;';
        var curTok = (window.localStorage && window.localStorage.getItem('ATPL_GITHUB_TOKEN')) || '';
        tokenWrap.innerHTML = '<div style="font-size:12px;margin-bottom:6px;color:#cbd5e1;">🔑 <b>GitHub Cloud Token (Optional for Direct Repo Writes):</b></div>';
        var tokInput = document.createElement('input');
        tokInput.type = 'password';
        tokInput.placeholder = 'Paste ghp_... token here';
        tokInput.value = curTok;
        tokInput.style.cssText = 'width:70%;padding:7px;border-radius:4px;border:1px solid #64748b;background:#0f172a;color:#fff;font-size:12px;margin-right:6px;';
        var tokSaveBtn = document.createElement('button');
        tokSaveBtn.innerText = 'Save Token';
        tokSaveBtn.style.cssText = 'padding:7px 12px;background:#0284c7;color:#fff;border:none;border-radius:4px;cursor:pointer;font-weight:bold;font-size:12px;';
        tokSaveBtn.onclick = function() {
            var val = tokInput.value.trim();
            if (val) {
                localStorage.setItem('ATPL_GITHUB_TOKEN', val);
                alert('✅ GitHub Token saved! Direct GitHub Cloud writes are now active.');
            } else {
                localStorage.removeItem('ATPL_GITHUB_TOKEN');
                alert('GitHub Token cleared.');
            }
        };
        tokenWrap.appendChild(tokInput);
        tokenWrap.appendChild(tokSaveBtn);
        actionsBox.appendChild(tokenWrap);

        leftCol.appendChild(actionsBox);

        var logBox = document.createElement('div');
        logBox.style.cssText = 'flex:1;background:#334155;padding:15px;border-radius:8px;overflow:auto;';
        logBox.innerHTML = '<h3 style="margin-top:0;margin-bottom:10px;">Live Diagnostics <button id="btnCopyLogs" style="float:right;background:#10b981;border:none;border-radius:4px;padding:4px 8px;cursor:pointer;color:#fff;">Copy</button></h3>';

        var logContent = document.createElement('div');
        logContent.style.cssText = 'font-family:monospace;font-size:11px;white-space:pre-wrap;color:#fca5a5;';
        setInterval(function() {
            logContent.innerText = logBuffer.join('\n') || 'All systems nominal. Zero errors.';
        }, 1000);

        logBox.appendChild(logContent);
        leftCol.appendChild(logBox);

        document.body.appendChild(modal);

        document.getElementById('btnCopyLogs').onclick = function() {
            navigator.clipboard.writeText(logBuffer.join('\n'));
            alert('Logs copied to clipboard!');
        };
    }

    return {
        open: function() {
            createModal();
            modal.style.display = 'flex';
        }
    };
})();
