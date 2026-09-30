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
        modal.style.cssText = 'position:fixed;top:10%;left:10%;width:80%;height:80%;background:#1e293b;color:#f8fafc;z-index:999999;border-radius:12px;box-shadow:0 25px 50px -12px rgba(0,0,0,0.5);display:flex;flex-direction:column;font-family:sans-serif;overflow:hidden;border:1px solid #475569;';
        
        var header = document.createElement('div');
        header.style.cssText = 'padding:16px;background:#0f172a;border-bottom:1px solid #334155;display:flex;justify-content:space-between;align-items:center;';
        header.innerHTML = '<h2 style="margin:0;font-size:18px;color:#38bdf8;">??? ATPL Cloud Debugger & Health Check</h2>';
        
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
        rightCol.style.cssText = 'flex:1;display:flex;flex-direction:column;gap:15px;background:#000;padding:15px;border-radius:8px;font-family:monospace;font-size:12px;overflow:auto;';
        
        modal.appendChild(header);
        modal.appendChild(content);
        content.appendChild(leftCol);
        content.appendChild(rightCol);

        var actionsBox = document.createElement('div');
        actionsBox.style.cssText = 'background:#334155;padding:15px;border-radius:8px;';
        actionsBox.innerHTML = '<h3 style="margin-top:0;margin-bottom:10px;">Fix Tools</h3>';
        
        var btnKillCache = document.createElement('button');
        btnKillCache.innerText = '??? NUKE CACHE & HARD REFRESH';
        btnKillCache.style.cssText = 'width:100%;padding:10px;background:#dc2626;color:white;border:none;border-radius:6px;font-weight:bold;cursor:pointer;margin-bottom:10px;';
        btnKillCache.onclick = async function() {
            btnKillCache.innerText = 'Nuking...';
            try {
                if(navigator.serviceWorker){
                    var regs = await navigator.serviceWorker.getRegistrations();
                    for (var i=0; i<regs.length; i++) await regs[i].unregister();
                }
                if(window.caches){
                    var keys = await caches.keys();
                    for (var j=0; j<keys.length; j++) await caches.delete(keys[j]);
                }
                localStorage.removeItem('ATPL_ALL_SALARY_CLEARED_AT');
                alert("Cache completely nuked! Browser will now hard reload.");
                window.location.reload(true);
            } catch(e) { alert("Error nuking cache: " + e); }
        };
        actionsBox.appendChild(btnKillCache);

        var btnCheckDb = document.createElement('button');
        btnCheckDb.innerText = '?? Scan Backend Cloud Database';
        btnCheckDb.style.cssText = 'width:100%;padding:10px;background:#2563eb;color:white;border:none;border-radius:6px;font-weight:bold;cursor:pointer;';
        btnCheckDb.onclick = async function() {
            if (!window.supabase) return alert("Supabase missing!");
            rightCol.innerHTML = '<div style="color:yellow">Scanning Supabase...</div>';
            try {
                var sClient = window.supabase.createClient('https://gsbyzddibdjxekutpkip.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdzYnl6ZGRpYmRqeGVrdXRwa2lwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAwNTk1NzcsImV4cCI6MjEwNTYzNTU3N30.Bz5NyhVtuJm1MjljiDsnW4036E3qZWgqyEWll7ZqzcI'); var res = await sClient.from('hr_files').select('filename, doc_type, size, uploaded_at');
                if (res.error) throw res.error;
                var data = res.data;
                var html = '<div style="color:#22c55e">Backend scan successful! Found ' + data.length + ' rows.</div><hr>';
                html += '<table style="width:100%;text-align:left;border-collapse:collapse;"><tr><th>Filename</th><th>Type</th><th>Time</th></tr>';
                data.forEach(function(d) {
                    var color = d.doc_type.indexOf('tombstone') > -1 ? '#ef4444' : '#3b82f6';
                    html += '<tr style="border-bottom:1px solid #333;">';
                    html += '<td style="padding:4px 0">' + d.filename + '</td>';
                    html += '<td style="color:' + color + '">' + d.doc_type + '</td>';
                    html += '<td style="font-size:10px;color:#94a3b8">' + new Date(d.uploaded_at).toLocaleTimeString() + '</td>';
                    html += '</tr>';
                });
                html += '</table>';
                rightCol.innerHTML = html;
            } catch(e) {
                rightCol.innerHTML = '<div style="color:red">Error: ' + String(e.message || e) + '</div>';
            }
        };
        actionsBox.appendChild(btnCheckDb);
        leftCol.appendChild(actionsBox);

        var logBox = document.createElement('div');
        logBox.style.cssText = 'flex:1;background:#334155;padding:15px;border-radius:8px;overflow:auto;';
        logBox.innerHTML = '<h3 style="margin-top:0;margin-bottom:10px;">Live Error Logs <button id="btnCopyLogs" style="float:right;background:#10b981;border:none;border-radius:4px;padding:4px 8px;cursor:pointer;color:#fff;">Copy</button></h3>';
        
        var logContent = document.createElement('div');
        logContent.style.cssText = 'font-family:monospace;font-size:11px;white-space:pre-wrap;color:#fca5a5;';
        setInterval(function() {
            logContent.innerText = logBuffer.join('\n') || 'No errors yet...';
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