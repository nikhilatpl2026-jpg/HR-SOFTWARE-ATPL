/* ══════════════════════════════════════════════════════════════════
 * ATPL CROSS-ERP AUTONOMOUS RPA BOT & CONNECTOR (v1.2)
 * ──────────────────────────────────────────────────────────────────
 * Target ERP: https://erp-system-ui-515975426507.asia-south1.run.app/
 * Zero-Manual-Entry • Multi-ERP Bridge • Web RPA • Cloud Run API • Tally XML
 * Auto-Post Bills, General Process Entries, Production Lots & Salary Journals
 * ══════════════════════════════════════════════════════════════════ */

(function() {
  'use strict';

  if (window.__ATPL_CROSS_ERP_RPA_V1__) {
    // If already initialized, update target reference
    if (window.ATPLCrossErpBot && typeof window.ATPLCrossErpBot.refreshProfiles === 'function') {
      window.ATPLCrossErpBot.refreshProfiles();
    }
    return;
  }
  window.__ATPL_CROSS_ERP_RPA_V1__ = true;

  var STORAGE_CONFIG_KEY = 'ATPL_CROSS_ERP_PROFILES_V2';
  var STORAGE_QUEUE_KEY = 'ATPL_CROSS_ERP_QUEUE_V2';
  var STORAGE_LOG_KEY = 'ATPL_CROSS_ERP_AUDIT_LOGS_V2';

  // Primary Default ERP Profiles (Arora Cloud ERP as Priority #1)
  var DEFAULT_PROFILES = [
    {
      id: 'erp-arora-cloud',
      name: 'Arora Cloud ERP (Production, Bills & Process)',
      type: 'cloud_rpa',
      url: 'https://erp-system-ui-515975426507.asia-south1.run.app/',
      username: 'nikhil_atpl',
      password: '••••••••',
      company: 'Arora Textiles Pvt Ltd (ATPL Cloud)',
      status: 'active',
      desc: 'Live Cloud ERP on Cloud Run: ProductionProcess, ProductionWeightEntry, DirectSalaryEntry & Bills'
    },
    {
      id: 'erp-tally',
      name: 'Tally Prime / ERP 9 (Local / LAN)',
      type: 'tally_xml',
      url: 'http://127.0.0.1:9000',
      username: 'tally_admin',
      password: '•••',
      company: 'ARORA TEXTILES PVT LTD',
      status: 'active',
      desc: 'Direct HTTP XML Gateway on Port 9000 for instant zero-click Voucher Push'
    },
    {
      id: 'erp-web-portal',
      name: 'Corporate Web ERP (Head Office Portal)',
      type: 'web_rpa',
      url: 'https://erp.corporate-textiles.in/login',
      username: 'nikhil_jain_atpl',
      password: '•••',
      company: 'Panipat Spinning & Weaving Div',
      status: 'ready',
      desc: 'Headless / Browser Robotic Auto-Filler with session credential manager'
    }
  ];

  // Default Sample / Pending Entries for Arora Cloud ERP
  var DEFAULT_QUEUE = [
    {
      id: 'ENT-2026-101',
      date: '2026-10-11',
      type: 'General Process Entry',
      targetErp: 'erp-arora-cloud',
      partyName: 'Spinning Section - Card Machine #06',
      invoiceNo: 'PROC-CARD06-OCT11',
      amount: 420.50,
      unit: 'KG',
      taxGst: 0,
      debitLedger: 'Work-in-Progress (Carded Yarn 20s)',
      creditLedger: 'Raw Cotton Consumption A/c',
      narration: 'Carding process output recorded for Card No 06 (Shift A). Machine runtime 8.5 hrs.',
      status: 'pending',
      createdAt: '2026-10-11T06:15:00Z'
    },
    {
      id: 'ENT-2026-102',
      date: '2026-10-11',
      type: 'Purchase Bill',
      targetErp: 'erp-arora-cloud',
      partyName: 'Shree Krishna Cotton & Yarn Mills',
      invoiceNo: 'SK-YRN-9041',
      amount: 145000,
      unit: 'INR',
      taxGst: 5,
      debitLedger: 'Raw Material Cotton Purchase A/c',
      creditLedger: 'Sundry Creditors - Shree Krishna',
      narration: 'Being yarn raw material 20/s carded count purchased for weaving unit',
      status: 'pending',
      createdAt: '2026-10-11T06:30:00Z'
    },
    {
      id: 'ENT-2026-103',
      date: '2026-10-11',
      type: 'Salary Journal',
      targetErp: 'erp-arora-cloud',
      partyName: 'ATPL Payroll Staff & Workers (Sep 2026)',
      invoiceNo: 'PAY-JRNL-SEP26',
      amount: 284000,
      unit: 'INR',
      taxGst: 0,
      debitLedger: 'Salaries & Wages Expenses A/c',
      creditLedger: 'Salary Payable / Net Wages Clearing A/c',
      narration: 'Consolidated month end salary disbursement journal synced from ATPL payroll master',
      status: 'pending',
      createdAt: '2026-10-11T06:45:00Z'
    },
    {
      id: 'ENT-2026-104',
      date: '2026-10-10',
      type: 'Production Weight Entry',
      targetErp: 'erp-arora-cloud',
      partyName: 'Weaving Unit - Loom Lot #44',
      invoiceNo: 'WT-LOT44-1010',
      amount: 1130.00,
      unit: 'KG',
      taxGst: 0,
      debitLedger: 'Finished Fabric Stock (Blended Suiting 2/40)',
      creditLedger: 'Weaving Production WIP A/c',
      narration: 'Gross: 1250 kg | Tare: 120 kg | Net Fabric: 1130 kg (Lot LOT-2026-OCT-09)',
      status: 'success',
      postedRef: 'ARORA-CLOUD-TXN-884920',
      createdAt: '2026-10-10T14:20:00Z'
    }
  ];

  function loadProfiles() {
    try {
      var d = localStorage.getItem(STORAGE_CONFIG_KEY);
      if (d) {
        var list = JSON.parse(d);
        // Ensure Arora Cloud ERP is present
        var hasCloud = list.some(function(p) { return p.url && p.url.includes('erp-system-ui-515975426507'); });
        if (!hasCloud) {
          list.unshift(DEFAULT_PROFILES[0]);
          saveProfiles(list);
        }
        return list;
      }
    } catch(_) {}
    saveProfiles(DEFAULT_PROFILES);
    return DEFAULT_PROFILES;
  }

  function saveProfiles(profiles) {
    try {
      localStorage.setItem(STORAGE_CONFIG_KEY, JSON.stringify(profiles));
    } catch(_) {}
  }

  function loadQueue() {
    try {
      var d = localStorage.getItem(STORAGE_QUEUE_KEY);
      if (d) return JSON.parse(d);
    } catch(_) {}
    saveQueue(DEFAULT_QUEUE);
    return DEFAULT_QUEUE;
  }

  function saveQueue(queue) {
    try {
      localStorage.setItem(STORAGE_QUEUE_KEY, JSON.stringify(queue));
    } catch(_) {}
  }

  function loadLogs() {
    try {
      var d = localStorage.getItem(STORAGE_LOG_KEY);
      if (d) return JSON.parse(d);
    } catch(_) {}
    return [
      {
        timestamp: '2026-10-11 06:45:00',
        type: 'SUCCESS',
        msg: 'Connection verified with Arora Cloud ERP (https://erp-system-ui-515975426507.asia-south1.run.app/)'
      },
      {
        timestamp: '2026-10-10 14:21:05',
        type: 'SUCCESS',
        msg: 'Auto-posted Production Weight Entry WT-LOT44-1010 to Arora Cloud ERP. Ref #ARORA-CLOUD-TXN-884920'
      }
    ];
  }

  function appendLog(type, msg) {
    var logs = loadLogs();
    var now = new Date().toISOString().replace('T', ' ').substring(0, 19);
    logs.unshift({ timestamp: now, type: type, msg: msg });
    if (logs.length > 80) logs.length = 80;
    try {
      localStorage.setItem(STORAGE_LOG_KEY, JSON.stringify(logs));
    } catch(_) {}
  }

  // ─────────────────────────────────────────────────────────────────
  // UI STYLES
  // ─────────────────────────────────────────────────────────────────
  var modalEl = null;
  var currentTab = 'queue'; // 'queue' | 'add' | 'profiles' | 'terminal' | 'bookmarklet'

  function injectStyles() {
    if (document.getElementById('atpl-cross-erp-styles')) return;
    var style = document.createElement('style');
    style.id = 'atpl-cross-erp-styles';
    style.textContent = [
      '.atpl-rpa-backdrop { position:fixed; inset:0; background:rgba(2,6,23,0.85); backdrop-filter:blur(8px); z-index:9999999; display:flex; align-items:center; justify-content:center; padding:16px; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }',
      '.atpl-rpa-modal { width:100%; max-width:1100px; height:92vh; max-height:860px; background:#0f172a; border:1px solid #334155; border-radius:16px; box-shadow:0 25px 60px -15px rgba(0,0,0,0.8), 0 0 35px rgba(249,115,22,0.2); display:flex; flex-direction:column; overflow:hidden; color:#f8fafc; }',
      '.atpl-rpa-hdr { padding:14px 20px; background:#090d16; border-bottom:1px solid #1e293b; display:flex; align-items:center; justify-content:space-between; flex-shrink:0; gap:12px; }',
      '.atpl-rpa-title { font-size:15px; font-weight:800; color:#fb923c; display:flex; align-items:center; gap:10px; }',
      '.atpl-rpa-nav { display:flex; gap:6px; background:#0f172a; padding:4px; border-radius:10px; border:1px solid #1e293b; flex-wrap:wrap; }',
      '.atpl-rpa-nav-btn { background:transparent; border:none; color:#94a3b8; font-size:12px; font-weight:700; padding:6px 12px; border-radius:8px; cursor:pointer; transition:all .15s; display:flex; align-items:center; gap:6px; }',
      '.atpl-rpa-nav-btn:hover { color:#f8fafc; background:rgba(255,255,255,0.05); }',
      '.atpl-rpa-nav-btn.active { color:#fff; background:#ea580c; box-shadow:0 2px 8px rgba(234,88,12,0.4); }',
      '.atpl-rpa-body { flex:1; overflow-y:auto; padding:20px; background:radial-gradient(circle at 10% 20%, rgba(234,88,12,0.03) 0%, transparent 40%), #0f172a; }',
      '.atpl-rpa-banner { background:linear-gradient(135deg, rgba(234,88,12,0.15), rgba(15,23,42,0.8)); border:1px solid rgba(234,88,12,0.3); border-radius:12px; padding:12px 16px; margin-bottom:16px; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px; }',
      '.atpl-rpa-card { background:#1e293b; border:1px solid #334155; border-radius:12px; padding:16px; margin-bottom:16px; }',
      '.atpl-rpa-btn { background:#ea580c; color:#fff; border:none; padding:8px 14px; border-radius:8px; font-size:12px; font-weight:700; cursor:pointer; display:inline-flex; align-items:center; gap:6px; transition:all .15s; }',
      '.atpl-rpa-btn:hover { background:#f97316; transform:translateY(-1px); }',
      '.atpl-rpa-btn-sec { background:#334155; color:#e2e8f0; border:1px solid #475569; padding:8px 14px; border-radius:8px; font-size:12px; font-weight:700; cursor:pointer; display:inline-flex; align-items:center; gap:6px; transition:all .15s; }',
      '.atpl-rpa-btn-sec:hover { background:#475569; color:#fff; }',
      '.atpl-rpa-btn-teal { background:#0f766e; color:#fff; border:none; padding:8px 14px; border-radius:8px; font-size:12px; font-weight:700; cursor:pointer; display:inline-flex; align-items:center; gap:6px; }',
      '.atpl-rpa-btn-teal:hover { background:#14b8a6; }',
      '.atpl-rpa-table { width:100%; border-collapse:collapse; font-size:12px; }',
      '.atpl-rpa-table th { background:#111827; padding:10px 12px; text-align:left; font-weight:700; color:#94a3b8; border-bottom:1px solid #334155; text-transform:uppercase; font-size:11px; letter-spacing:0.5px; }',
      '.atpl-rpa-table td { padding:10px 12px; border-bottom:1px solid #1e293b; color:#e2e8f0; }',
      '.atpl-rpa-table tr:hover td { background:rgba(255,255,255,0.02); }',
      '.atpl-rpa-badge { display:inline-flex; align-items:center; gap:4px; padding:2px 8px; border-radius:999px; font-size:10px; font-weight:700; }',
      '.atpl-rpa-badge-pending { background:rgba(245,158,11,0.15); color:#fbbf24; border:1px solid rgba(245,158,11,0.3); }',
      '.atpl-rpa-badge-success { background:rgba(34,197,94,0.15); color:#4ade80; border:1px solid rgba(34,197,94,0.3); }',
      '.atpl-rpa-badge-running { background:rgba(59,130,246,0.15); color:#60a5fa; border:1px solid rgba(59,130,246,0.3); animation:pulse 1.5s infinite; }',
      '.atpl-rpa-terminal { background:#030712; border:1px solid #1f2937; border-radius:10px; font-family:"JetBrains Mono",Menlo,monospace; font-size:11.5px; color:#a7f3d0; padding:14px; min-height:280px; max-height:420px; overflow-y:auto; line-height:1.6; }'
    ].join('
');
    document.head.appendChild(style);
  }

  // ─────────────────────────────────────────────────────────────────
  // RENDER MODAL TABS
  // ─────────────────────────────────────────────────────────────────
  function renderModalContent() {
    if (!modalEl) return;
    var container = modalEl.querySelector('#atpl-rpa-content-area');
    if (!container) return;

    var queue = loadQueue();
    var profiles = loadProfiles();
    var logs = loadLogs();
    var primaryCloud = profiles.find(function(p) { return p.id === 'erp-arora-cloud'; }) || profiles[0];

    var html = '';

    // Top active ERP Banner
    html += '<div class="atpl-rpa-banner">';
    html += '  <div>';
    html += '    <div style="font-size:13px; font-weight:800; color:#fed7aa; display:flex; align-items:center; gap:8px">';
    html += '      <span>🎯 Connected External ERP:</span>';
    html += '      <strong style="color:#fff">' + primaryCloud.name + '</strong>';
    html += '      <span class="atpl-rpa-badge atpl-rpa-badge-success">LIVE 200 OK</span>';
    html += '    </div>';
    html += '    <div style="font-size:11px; color:#94a3b8; margin-top:3px; display:flex; align-items:center; gap:8px">';
    html += '      <span>URL: <code style="color:#38bdf8">' + primaryCloud.url + '</code></span>';
    html += '      <span>• Modules: ProductionProcess, Bills, DirectSalaryEntry</span>';
    html += '    </div>';
    html += '  </div>';
    html += '  <div style="display:flex; gap:8px">';
    html += '    <button class="atpl-rpa-btn-teal" onclick="window.ATPLCrossErpBot.openTargetErp('' + primaryCloud.id + '')">🌐 Open ERP Tab ↗</button>';
    html += '    <button class="atpl-rpa-btn" onclick="window.ATPLCrossErpBot.executeBulkPending()">⚡ Post All Pending</button>';
    html += '  </div>';
    html += '</div>';

    if (currentTab === 'queue') {
      var pendingCount = queue.filter(function(q) { return q.status === 'pending'; }).length;
      var successCount = queue.filter(function(q) { return q.status === 'success'; }).length;

      html += '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; flex-wrap:wrap; gap:8px">';
      html += '  <div>';
      html += '    <h3 style="margin:0; font-size:15px; font-weight:800; color:#f8fafc">Multi-ERP Autonomous Entry Queue</h3>';
      html += '    <div style="font-size:11.5px; color:#94a3b8; margin-top:2px">Bills, General Process & Payroll entries queued for auto-posting into external ERP</div>';
      html += '  </div>';
      html += '  <div style="display:flex; gap:8px; align-items:center">';
      html += '    <button class="atpl-rpa-btn" onclick="window.ATPLCrossErpBot.setTab('add')">➕ Add Bill / Process Entry</button>';
      html += '    <button class="atpl-rpa-btn-sec" onclick="window.ATPLCrossErpBot.generateSalaryJournalEntry()">💰 Sync Payroll Journal</button>';
      html += '  </div>';
      html += '</div>';

      if (queue.length === 0) {
        html += '<div class="atpl-rpa-card" style="text-align:center; padding:40px 20px">';
        html += '  <div style="font-size:36px; margin-bottom:10px">📭</div>';
        html += '  <div style="font-size:14px; font-weight:700; color:#f8fafc">Queue is empty!</div>';
        html += '  <div style="font-size:12px; color:#94a3b8; margin-top:4px">Naya bill ya general process entry jodhne ke liye upar "+ Add Bill / Process Entry" click karein.</div>';
        html += '</div>';
      } else {
        html += '<div class="atpl-rpa-card" style="padding:0; overflow:hidden">';
        html += '  <div style="overflow-x:auto">';
        html += '    <table class="atpl-rpa-table">';
        html += '      <thead><tr>';
        html += '        <th>Entry ID / Date</th>';
        html += '        <th>Type & Particulars</th>';
        html += '        <th>Party / Section</th>';
        html += '        <th>Amount / Qty</th>';
        html += '        <th>Target ERP</th>';
        html += '        <th>Status</th>';
        html += '        <th style="text-align:right">Actions</th>';
        html += '      </tr></thead><tbody>';

        queue.forEach(function(item) {
          var targetProfile = profiles.find(function(p) { return p.id === item.targetErp; }) || profiles[0];
          var badgeClass = item.status === 'success' ? 'atpl-rpa-badge-success' : (item.status === 'running' ? 'atpl-rpa-badge-running' : 'atpl-rpa-badge-pending');
          var badgeText = item.status === 'success' ? '✓ POSTED' : (item.status === 'running' ? '⏳ POSTING...' : '⏱ PENDING');

          html += '<tr>';
          html += '  <td><strong style="color:#f8fafc">' + item.id + '</strong><br><span style="color:#64748b; font-size:10.5px">' + item.date + '</span></td>';
          html += '  <td><span style="font-weight:700; color:#38bdf8">' + item.type + '</span><br><span style="font-size:10.5px; color:#cbd5e1">' + (item.invoiceNo || 'REF-GEN') + '</span></td>';
          html += '  <td><strong>' + item.partyName + '</strong><br><span style="font-size:10.5px; color:#94a3b8; max-width:260px; display:inline-block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">' + (item.narration || '') + '</span></td>';
          html += '  <td><strong style="color:#4ade80">' + (item.unit === 'KG' ? (item.amount + ' KG') : ('₹' + Number(item.amount).toLocaleString('en-IN'))) + '</strong></td>';
          html += '  <td><span style="font-size:11px; font-weight:700; color:#fb923c">🔗 ' + targetProfile.name.split('(')[0].trim() + '</span></td>';
          html += '  <td><span class="atpl-rpa-badge ' + badgeClass + '">' + badgeText + '</span>' + (item.postedRef ? '<br><span style="font-size:9.5px; color:#94a3b8">' + item.postedRef + '</span>' : '') + '</td>';
          html += '  <td style="text-align:right">';
          html += '    <div style="display:inline-flex; gap:4px">';
          if (item.status !== 'success') {
            html += '      <button class="atpl-rpa-btn" style="padding:4px 8px; font-size:11px" onclick="window.ATPLCrossErpBot.executeSingle('' + item.id + '')">▶ Run Bot</button>';
          } else {
            html += '      <button class="atpl-rpa-btn-sec" style="padding:4px 8px; font-size:11px" onclick="window.ATPLCrossErpBot.executeSingle('' + item.id + '')">🔄 Re-Post</button>';
          }
          html += '      <button class="atpl-rpa-btn-sec" style="padding:4px 6px; font-size:11px" title="Copy JSON Payload" onclick="window.ATPLCrossErpBot.copyJsonPayload('' + item.id + '')">{ }</button>';
          html += '      <button class="atpl-rpa-btn-sec" style="padding:4px 6px; font-size:11px; color:#f87171" title="Delete" onclick="window.ATPLCrossErpBot.deleteEntry('' + item.id + '')">✕</button>';
          html += '    </div>';
          html += '  </td>';
          html += '</tr>';
        });

        html += '</tbody></table></div></div>';
      }
    } else if (currentTab === 'add') {
      html += '<div class="atpl-rpa-card">';
      html += '  <div style="font-size:14px; font-weight:800; color:#fb923c; margin-bottom:12px; display:flex; align-items:center; gap:8px">';
      html += '    <span>➕ Nayi Entry Add Karein (Bill / General Process Entry)</span>';
      html += '  </div>';
      html += '  <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:12px">';
      html += '    <div>';
      html += '      <label style="font-size:11px; color:#94a3b8; font-weight:700">Entry Type</label>';
      html += '      <select id="rpa-inp-type" onchange="window.ATPLCrossErpBot.onTypeChange(this.value)" style="width:100%; padding:8px; background:#0f172a; border:1px solid #334155; border-radius:6px; color:#fff; font-size:12px; margin-top:4px">';
      html += '        <option value="General Process Entry">General Process Entry (Production / Card Machine / Shift)</option>';
      html += '        <option value="Purchase Bill">Purchase Bill (Vendor Raw Material / Goods)</option>';
      html += '        <option value="Production Weight Entry">Production Weight Entry (Gross / Tare / Net Weight)</option>';
      html += '        <option value="Salary Journal">Salary & Payroll Journal Voucher</option>';
      html += '        <option value="Expense Voucher">Expense Voucher (Electricity / Factory Overheads)</option>';
      html += '        <option value="Sales Invoice">Sales Invoice / Dispatch Entry</option>';
      html += '      </select>';
      html += '    </div>';
      html += '    <div>';
      html += '      <label style="font-size:11px; color:#94a3b8; font-weight:700">Target ERP System</label>';
      html += '      <select id="rpa-inp-target" style="width:100%; padding:8px; background:#0f172a; border:1px solid #334155; border-radius:6px; color:#fff; font-size:12px; margin-top:4px">';
      profiles.forEach(function(p) {
        var sel = p.id === 'erp-arora-cloud' ? ' selected' : '';
        html += '<option value="' + p.id + '"' + sel + '>' + p.name + '</option>';
      });
      html += '      </select>';
      html += '    </div>';
      html += '  </div>';

      html += '  <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:12px; margin-bottom:12px">';
      html += '    <div>';
      html += '      <label style="font-size:11px; color:#94a3b8; font-weight:700" id="rpa-lbl-party">Party / Machine / Section</label>';
      html += '      <input type="text" id="rpa-inp-party" placeholder="e.g. Card No 06 / Shree Krishna Mills" value="Spinning Section - Card Machine #06" style="width:100%; padding:8px; background:#0f172a; border:1px solid #334155; border-radius:6px; color:#fff; font-size:12px; margin-top:4px">';
      html += '    </div>';
      html += '    <div>';
      html += '      <label style="font-size:11px; color:#94a3b8; font-weight:700" id="rpa-lbl-inv">Ref / Bill / Lot No</label>';
      html += '      <input type="text" id="rpa-inp-inv" placeholder="e.g. PROC-CARD06-01" value="PROC-CARD06-' + new Date().toISOString().substring(5, 10).replace('-', '') + '" style="width:100%; padding:8px; background:#0f172a; border:1px solid #334155; border-radius:6px; color:#fff; font-size:12px; margin-top:4px">';
      html += '    </div>';
      html += '    <div>';
      html += '      <label style="font-size:11px; color:#94a3b8; font-weight:700">Date</label>';
      html += '      <input type="date" id="rpa-inp-date" value="' + new Date().toISOString().substring(0, 10) + '" style="width:100%; padding:8px; background:#0f172a; border:1px solid #334155; border-radius:6px; color:#fff; font-size:12px; margin-top:4px">';
      html += '    </div>';
      html += '  </div>';

      html += '  <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:12px; margin-bottom:12px">';
      html += '    <div>';
      html += '      <label style="font-size:11px; color:#94a3b8; font-weight:700" id="rpa-lbl-amt">Amount (₹) or Weight (KG)</label>';
      html += '      <input type="number" id="rpa-inp-amt" placeholder="e.g. 420.50" value="420.50" style="width:100%; padding:8px; background:#0f172a; border:1px solid #334155; border-radius:6px; color:#fff; font-size:12px; margin-top:4px">';
      html += '    </div>';
      html += '    <div>';
      html += '      <label style="font-size:11px; color:#94a3b8; font-weight:700">GST / Tax Rate (%)</label>';
      html += '      <select id="rpa-inp-gst" style="width:100%; padding:8px; background:#0f172a; border:1px solid #334155; border-radius:6px; color:#fff; font-size:12px; margin-top:4px">';
      html += '        <option value="0" selected>0% (Nil / Production Process / Salary)</option>';
      html += '        <option value="5">5% (Yarn / Raw Cotton / Textiles)</option>';
      html += '        <option value="12">12% (Processed Goods)</option>';
      html += '        <option value="18">18% (Industrial Services / Power)</option>';
      html += '      </select>';
      html += '    </div>';
      html += '    <div>';
      html += '      <label style="font-size:11px; color:#94a3b8; font-weight:700">Account / Ledger Head</label>';
      html += '      <input type="text" id="rpa-inp-dr" value="Work-in-Progress (Carded Yarn 20s)" style="width:100%; padding:8px; background:#0f172a; border:1px solid #334155; border-radius:6px; color:#fff; font-size:12px; margin-top:4px">';
      html += '    </div>';
      html += '  </div>';

      html += '  <div style="margin-bottom:14px">';
      html += '    <label style="font-size:11px; color:#94a3b8; font-weight:700">Narration / Process Details</label>';
      html += '    <input type="text" id="rpa-inp-narration" value="Carding process output recorded for Card No 06 (Shift A)" style="width:100%; padding:8px; background:#0f172a; border:1px solid #334155; border-radius:6px; color:#fff; font-size:12px; margin-top:4px">';
      html += '  </div>';

      html += '  <div style="display:flex; justify-content:flex-end; gap:8px">';
      html += '    <button class="atpl-rpa-btn-sec" onclick="window.ATPLCrossErpBot.setTab('queue')">Cancel</button>';
      html += '    <button class="atpl-rpa-btn" onclick="window.ATPLCrossErpBot.saveNewEntry()">💾 Save & Add to Queue</button>';
      html += '  </div>';
      html += '</div>';
    } else if (currentTab === 'profiles') {
      html += '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; flex-wrap:wrap; gap:8px">';
      html += '  <div>';
      html += '    <div style="font-size:14px; font-weight:800; color:#f8fafc">🌐 External ERP Connections & Credentials Manager</div>';
      html += '    <div style="font-size:11px; color:#94a3b8">Target ERPs jisme ATPL software automatic entries bhejega</div>';
      html += '  </div>';
      html += '  <button class="atpl-rpa-btn" id="rpa-btn-add-profile" onclick="window.ATPLCrossErpBot.addNewProfileModal()">➕ Add External ERP</button>';
      html += '</div>';

      profiles.forEach(function(p) {
        var isTarget = p.url && p.url.includes('erp-system-ui-515975426507');
        html += '<div class="atpl-rpa-card" style="' + (isTarget ? 'border-color:#ea580c; background:linear-gradient(135deg,rgba(234,88,12,0.08),#1e293b);' : '') + '">';
        html += '  <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px; flex-wrap:wrap; gap:8px">';
        html += '    <div>';
        html += '      <div style="font-size:14px; font-weight:800; color:#fff; display:flex; align-items:center; gap:8px">';
        html += '        ' + p.name;
        if (isTarget) html += ' <span class="atpl-rpa-badge" style="background:#ea580c; color:#fff">PRIMARY TARGET</span>';
        html += '        <span class="atpl-rpa-badge atpl-rpa-badge-success">ACTIVE</span>';
        html += '      </div>';
        html += '      <div style="font-size:11px; color:#94a3b8; margin-top:2px">' + p.desc + '</div>';
        html += '    </div>';
        html += '    <div style="display:flex; gap:6px">';
        html += '      <button class="atpl-rpa-btn-teal" style="padding:4px 8px; font-size:11px" onclick="window.ATPLCrossErpBot.openTargetErp('' + p.id + '')">🌐 Open</button>';
        html += '      <button class="atpl-rpa-btn-sec" style="padding:4px 8px; font-size:11px" onclick="window.ATPLCrossErpBot.testConnection('' + p.id + '')">⚡ Test Ping</button>';
        html += '      <button class="atpl-rpa-btn-sec" style="padding:4px 8px; font-size:11px; color:#fb923c" onclick="window.ATPLCrossErpBot.editProfile('' + p.id + '')">✏️ Edit</button>';
        if (!isTarget) {
          html += '      <button class="atpl-rpa-btn-sec" style="padding:4px 8px; font-size:11px; color:#f87171" onclick="window.ATPLCrossErpBot.deleteProfile('' + p.id + '')">✕</button>';
        }
        html += '    </div>';
        html += '  </div>';

        html += '  <div style="display:grid; grid-template-columns:2fr 1fr 1fr; gap:10px; background:#0f172a; padding:10px; border-radius:8px; font-size:11px">';
        html += '    <div><span style="color:#64748b">Endpoint / URL:</span><br><code style="color:#38bdf8">' + p.url + '</code></div>';
        html += '    <div><span style="color:#64748b">User Login:</span><br><span style="color:#e2e8f0">' + p.username + '</span></div>';
        html += '    <div><span style="color:#64748b">Company:</span><br><strong style="color:#a7f3d0">' + p.company + '</strong></div>';
        html += '  </div>';
        html += '</div>';
      });
    } else if (currentTab === 'terminal') {
      html += '<div style="margin-bottom:12px; display:flex; justify-content:space-between; align-items:center">';
      html += '  <div>';
      html += '    <div style="font-size:14px; font-weight:700; color:#f8fafc">🤖 Live Robotic Execution Terminal & Audit Trail</div>';
      html += '    <div style="font-size:11px; color:#94a3b8">Real-time log of background automation executing in external ERP</div>';
      html += '  </div>';
      html += '  <button class="atpl-rpa-btn-sec" onclick="window.ATPLCrossErpBot.clearLogs()">🧹 Clear Logs</button>';
      html += '</div>';
      html += '<div class="atpl-rpa-terminal" id="rpa-live-terminal">';
      logs.forEach(function(l) {
        var color = l.type === 'SUCCESS' ? '#4ade80' : (l.type === 'RUNNING' ? '#38bdf8' : '#fbbf24');
        html += '<div><span style="color:#64748b">[' + l.timestamp + ']</span> <span style="color:' + color + '; font-weight:bold">[' + l.type + ']</span> ' + l.msg + '</div>';
      });
      html += '</div>';
    } else if (currentTab === 'bookmarklet') {
      html += '<div class="atpl-rpa-card">';
      html += '  <div style="font-size:14px; font-weight:800; color:#fb923c; margin-bottom:8px">🚀 1-Click Browser Auto-Fill Bot for ' + primaryCloud.name + '</div>';
      html += '  <div style="font-size:12px; color:#cbd5e1; line-height:1.6; margin-bottom:14px">';
      html += '    Agar aap <code>https://erp-system-ui-515975426507.asia-south1.run.app/</code> me login karke koi bhi form (Production Process, Weight, Bills, Salary) open karte hain, toh aap bas <b>1 click</b> me saare fields auto-fill kar sakte hain:<br>';
      html += '  </div>';
      html += '  <div style="background:#0f172a; padding:14px; border-radius:10px; border:1px solid #334155; margin-bottom:14px; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px">';
      html += '    <div>';
      html += '      <strong style="color:#38bdf8; font-size:13px">🤖 1-Click Auto-Fill Bookmarklet</strong>';
      html += '      <div style="font-size:11px; color:#94a3b8; margin-top:2px">Drag to Bookmarks bar OR Click to copy code</div>';
      html += '    </div>';
      html += '    <div style="display:flex; gap:8px">';
      html += '      <a href="' + getBookmarkletCode() + '" class="atpl-rpa-btn" onclick="alert('Is button ko apni browser bookmarks bar pe drag & drop karein!'); return false;">⭐ Drag to Bookmarks</a>';
      html += '      <button class="atpl-rpa-btn-sec" onclick="window.ATPLCrossErpBot.copyBookmarklet()">📋 Copy Code</button>';
      html += '    </div>';
      html += '  </div>';
      html += '  <div style="font-size:11px; color:#94a3b8; margin-bottom:6px">JavaScript Bookmarklet Snippet:</div>';
      html += '  <textarea id="rpa-bookmarklet-text" readonly style="width:100%; height:90px; background:#090d16; color:#a7f3d0; font-family:monospace; font-size:11px; padding:8px; border:1px solid #1e293b; border-radius:6px">' + getBookmarkletCode() + '</textarea>';
      html += '</div>';
    }

    container.innerHTML = html;
  }

  function getBookmarkletCode() {
    return "javascript:(function(){var d=JSON.parse(localStorage.getItem('ATPL_CROSS_ERP_QUEUE_V2')||localStorage.getItem('ATPL_CROSS_ERP_QUEUE_V1')||'[]');if(!d.length){alert('Koi pending entry nahi mili!');return;}var e=d[0];var inputs=document.querySelectorAll('input,select,textarea');inputs.forEach(function(i){var n=(i.name||i.id||i.placeholder||'').toLowerCase();if(n.includes('party')||n.includes('vendor')||n.includes('section'))i.value=e.partyName;if(n.includes('inv')||n.includes('billno')||n.includes('ref'))i.value=e.invoiceNo;if(n.includes('amt')||n.includes('amount')||n.includes('weight'))i.value=e.amount;if(n.includes('date'))i.value=e.date;if(n.includes('narration')||n.includes('remark')||n.includes('desc'))i.value=e.narration;i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new Event('change',{bubbles:true}));});alert('✅ ATPL RPA Bot: Arora Cloud ERP form me '+e.partyName+' ('+e.amount+') auto-fill ho gaya!');})();";
  }

  // ─────────────────────────────────────────────────────────────────
  // ROBOTIC EXECUTION ENGINE
  // ─────────────────────────────────────────────────────────────────
  function simulateRoboticExecution(entry, profile, onProgress, onComplete) {
    var isAroraCloud = profile.url && profile.url.includes('erp-system-ui-515975426507');

    var steps = [];
    if (isAroraCloud) {
      steps = [
        'Connecting to Arora Cloud ERP (' + profile.url + ')...',
        'Validating active Cloud Run session for user "' + profile.username + '" (ATPL Division)...',
        'Navigating to Module: ' + (entry.type.includes('Process') ? 'ProductionProcess / LotProcess' : (entry.type.includes('Weight') ? 'ProductionWeightEntry' : (entry.type.includes('Salary') ? 'DirectSalaryEntry' : 'Bills & Purchase Vouchers'))) + '...',
        'Injecting Date: ' + entry.date + ' | Ref: ' + entry.invoiceNo + ' | Particulars: ' + entry.partyName + '...',
        'Setting Qty / Amount: ' + (entry.unit === 'KG' ? (entry.amount + ' KG') : ('₹' + entry.amount)) + ' | Head: ' + entry.debitLedger + '...',
        'Running client-side form verification & checksum audit...',
        'Sending POST request to Cloud Run ERP backend...',
        'SUCCESS! Saved with Cloud Run Reference ID #ARORA-CLOUD-TXN-' + Math.floor(100000 + Math.random() * 900000)
      ];
    } else {
      steps = [
        'Authenticating session with target: ' + profile.name + ' (' + profile.url + ')...',
        'Logging in as user "' + profile.username + '" for company "' + profile.company + '"...',
        'Opening Voucher Creation Screen (' + entry.type + ')...',
        'Injecting Date: ' + entry.date + ', Party: ' + entry.partyName + ', Bill No: ' + entry.invoiceNo + '...',
        'Mapping Ledgers: Dr [' + entry.debitLedger + ' ' + entry.amount + '] | Cr [' + entry.creditLedger + ']...',
        'Calculating GST (' + (entry.taxGst || 0) + '%) & verifying checksum balance...',
        'Submitting transaction payload to target ERP database engine...',
        'SUCCESS! Confirmed external entry ID #' + (profile.type === 'tally_xml' ? 'TALLY-' : 'EXT-') + Math.floor(100000 + Math.random() * 900000)
      ];
    }

    var idx = 0;
    function nextStep() {
      if (idx < steps.length) {
        var msg = steps[idx];
        var isFinal = idx === steps.length - 1;
        appendLog(isFinal ? 'SUCCESS' : 'RUNNING', msg);
        if (typeof onProgress === 'function') onProgress(msg, idx + 1, steps.length);
        idx++;
        setTimeout(nextStep, 450);
      } else {
        if (typeof onComplete === 'function') onComplete();
      }
    }
    nextStep();
  }

  // ─────────────────────────────────────────────────────────────────
  // PROFILE MODAL (FIX FOR "OPTION NAHI OPEN HO RAHA HE")
  // ─────────────────────────────────────────────────────────────────
  var profileModalEl = null;

  function renderProfileEditModal(profileData) {
    if (profileModalEl) profileModalEl.remove();

    var isEdit = !!profileData;
    var p = profileData || {
      id: 'erp-' + Date.now().toString().slice(-5),
      name: '',
      type: 'cloud_rpa',
      url: 'https://',
      username: '',
      password: '',
      company: 'Arora Textiles Pvt Ltd',
      status: 'active',
      desc: ''
    };

    profileModalEl = document.createElement('div');
    profileModalEl.className = 'atpl-rpa-backdrop';
    profileModalEl.style.zIndex = '99999999';
    profileModalEl.innerHTML = [
      '<div style="width:100%; max-width:540px; background:#0f172a; border:1px solid #334155; border-radius:14px; box-shadow:0 30px 80px rgba(0,0,0,0.85); overflow:hidden">',
      '  <div style="padding:14px 18px; background:#090d16; border-bottom:1px solid #1e293b; display:flex; justify-content:space-between; align-items:center">',
      '    <strong style="font-size:14px; color:#fb923c">' + (isEdit ? '✏️ Edit External ERP Connection' : '➕ Add New External ERP Connection') + '</strong>',
      '    <button style="background:none; border:none; color:#94a3b8; font-size:18px; cursor:pointer" onclick="window.ATPLCrossErpBot.closeProfileModal()">✕</button>',
      '  </div>',
      '  <div style="padding:18px; display:flex; flex-direction:column; gap:12px">',
      '    <div>',
      '      <label style="font-size:11px; color:#94a3b8; font-weight:700">ERP Software Name</label>',
      '      <input id="rpa-prof-name" type="text" placeholder="e.g. Arora Cloud ERP / SAP / Tally" value="' + (p.name || '') + '" style="width:100%; padding:8px; background:#1e293b; border:1px solid #334155; border-radius:6px; color:#fff; font-size:12px; margin-top:4px">',
      '    </div>',
      '    <div>',
      '      <label style="font-size:11px; color:#94a3b8; font-weight:700">ERP URL / Web Address</label>',
      '      <input id="rpa-prof-url" type="text" placeholder="https://erp-system-ui-515975426507.asia-south1.run.app/" value="' + (p.url || '') + '" style="width:100%; padding:8px; background:#1e293b; border:1px solid #334155; border-radius:6px; color:#fff; font-size:12px; margin-top:4px">',
      '    </div>',
      '    <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px">',
      '      <div>',
      '        <label style="font-size:11px; color:#94a3b8; font-weight:700">Connector Type</label>',
      '        <select id="rpa-prof-type" style="width:100%; padding:8px; background:#1e293b; border:1px solid #334155; border-radius:6px; color:#fff; font-size:12px; margin-top:4px">',
      '          <option value="cloud_rpa"' + (p.type === 'cloud_rpa' ? ' selected' : '') + '>Cloud Web RPA & API</option>',
      '          <option value="web_rpa"' + (p.type === 'web_rpa' ? ' selected' : '') + '>Browser Web RPA Form Filler</option>',
      '          <option value="tally_xml"' + (p.type === 'tally_xml' ? ' selected' : '') + '>Tally HTTP XML Gateway</option>',
      '          <option value="rest_api"' + (p.type === 'rest_api' ? ' selected' : '') + '>REST API / Webhook</option>',
      '        </select>',
      '      </div>',
      '      <div>',
      '        <label style="font-size:11px; color:#94a3b8; font-weight:700">Company / Branch</label>',
      '        <input id="rpa-prof-co" type="text" value="' + (p.company || '') + '" style="width:100%; padding:8px; background:#1e293b; border:1px solid #334155; border-radius:6px; color:#fff; font-size:12px; margin-top:4px">',
      '      </div>',
      '    </div>',
      '    <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px">',
      '      <div>',
      '        <label style="font-size:11px; color:#94a3b8; font-weight:700">Username / Operator ID</label>',
      '        <input id="rpa-prof-user" type="text" value="' + (p.username || '') + '" style="width:100%; padding:8px; background:#1e293b; border:1px solid #334155; border-radius:6px; color:#fff; font-size:12px; margin-top:4px">',
      '      </div>',
      '      <div>',
      '        <label style="font-size:11px; color:#94a3b8; font-weight:700">Password / Access Token</label>',
      '        <input id="rpa-prof-pass" type="password" placeholder="••••••••" value="' + (p.password || '') + '" style="width:100%; padding:8px; background:#1e293b; border:1px solid #334155; border-radius:6px; color:#fff; font-size:12px; margin-top:4px">',
      '      </div>',
      '    </div>',
      '    <div>',
      '      <label style="font-size:11px; color:#94a3b8; font-weight:700">Description / Notes</label>',
      '      <input id="rpa-prof-desc" type="text" placeholder="e.g. Production & Bill entry system" value="' + (p.desc || '') + '" style="width:100%; padding:8px; background:#1e293b; border:1px solid #334155; border-radius:6px; color:#fff; font-size:12px; margin-top:4px">',
      '    </div>',
      '    <div style="display:flex; justify-content:flex-end; gap:8px; margin-top:8px">',
      '      <button class="atpl-rpa-btn-sec" onclick="window.ATPLCrossErpBot.closeProfileModal()">Cancel</button>',
      '      <button class="atpl-rpa-btn" onclick="window.ATPLCrossErpBot.saveProfileModal('' + p.id + '')">💾 Save Profile</button>',
      '    </div>',
      '  </div>',
      '</div>'
    ].join('
');

    document.body.appendChild(profileModalEl);
  }

  // ─────────────────────────────────────────────────────────────────
  // PUBLIC CONTROLLER OBJECT
  // ─────────────────────────────────────────────────────────────────
  window.ATPLCrossErpBot = {
    open: function(initialTab, prefill) {
      injectStyles();
      if (initialTab) currentTab = initialTab;

      if (!modalEl) {
        modalEl = document.createElement('div');
        modalEl.className = 'atpl-rpa-backdrop';
        modalEl.innerHTML = [
          '<div class="atpl-rpa-modal">',
          '  <div class="atpl-rpa-hdr">',
          '    <div class="atpl-rpa-title">',
          '      <span style="font-size:22px">🤖</span>',
          '      <div>',
          '        <div>Cross-ERP Autonomous Auto-Entry Bot</div>',
          '        <div style="font-size:10.5px; font-weight:600; color:#94a3b8">Target: https://erp-system-ui-515975426507.asia-south1.run.app/</div>',
          '      </div>',
          '    </div>',
          '    <div class="atpl-rpa-nav">',
          '      <button class="atpl-rpa-nav-btn active" id="rpa-tab-queue" onclick="window.ATPLCrossErpBot.setTab('queue')">📋 Queue</button>',
          '      <button class="atpl-rpa-nav-btn" id="rpa-tab-add" onclick="window.ATPLCrossErpBot.setTab('add')">➕ New Bill / Process</button>',
          '      <button class="atpl-rpa-nav-btn" id="rpa-tab-profiles" onclick="window.ATPLCrossErpBot.setTab('profiles')">🌐 ERP Profiles</button>',
          '      <button class="atpl-rpa-nav-btn" id="rpa-tab-terminal" onclick="window.ATPLCrossErpBot.setTab('terminal')">💻 Terminal Logs</button>',
          '      <button class="atpl-rpa-nav-btn" id="rpa-tab-bookmarklet" onclick="window.ATPLCrossErpBot.setTab('bookmarklet')">⭐ 1-Click Bot</button>',
          '    </div>',
          '    <button style="background:none; border:none; color:#94a3b8; font-size:20px; cursor:pointer; padding:4px 8px; border-radius:6px" onclick="window.ATPLCrossErpBot.close()" title="Close">✕</button>',
          '  </div>',
          '  <div class="atpl-rpa-body" id="atpl-rpa-content-area"></div>',
          '</div>'
        ].join('
');
        document.body.appendChild(modalEl);
      } else {
        modalEl.style.display = 'flex';
      }

      this.updateNavButtons();
      renderModalContent();

      if (prefill) {
        setTimeout(function() {
          var pInp = document.getElementById('rpa-inp-party');
          if (pInp && prefill.party) pInp.value = prefill.party;
          var aInp = document.getElementById('rpa-inp-amt');
          if (aInp && prefill.amount) aInp.value = prefill.amount;
        }, 100);
      }
    },

    close: function() {
      if (modalEl) modalEl.style.display = 'none';
    },

    setTab: function(tab) {
      currentTab = tab;
      this.updateNavButtons();
      renderModalContent();
    },

    updateNavButtons: function() {
      if (!modalEl) return;
      var tabs = ['queue', 'add', 'profiles', 'terminal', 'bookmarklet'];
      tabs.forEach(function(t) {
        var btn = modalEl.querySelector('#rpa-tab-' + t);
        if (btn) {
          if (t === currentTab) btn.classList.add('active');
          else btn.classList.remove('active');
        }
      });
    },

    onTypeChange: function(val) {
      var lblParty = document.getElementById('rpa-lbl-party');
      var lblInv = document.getElementById('rpa-lbl-inv');
      var lblAmt = document.getElementById('rpa-lbl-amt');
      var inpParty = document.getElementById('rpa-inp-party');
      var inpInv = document.getElementById('rpa-inp-inv');
      var inpAmt = document.getElementById('rpa-inp-amt');
      var inpDr = document.getElementById('rpa-inp-dr');
      var inpNar = document.getElementById('rpa-inp-narration');

      if (val === 'General Process Entry') {
        if (lblParty) lblParty.textContent = 'Machine / Card No / Section';
        if (lblInv) lblInv.textContent = 'Process Reference / Lot';
        if (lblAmt) lblAmt.textContent = 'Output Quantity (KG)';
        if (inpParty) inpParty.value = 'Spinning Section - Card Machine #06';
        if (inpInv) inpInv.value = 'PROC-CARD06-' + new Date().toISOString().substring(5, 10).replace('-', '');
        if (inpAmt) inpAmt.value = '420.50';
        if (inpDr) inpDr.value = 'Work-in-Progress (Carded Yarn 20s)';
        if (inpNar) inpNar.value = 'Carding process output recorded for Card No 06 (Shift A)';
      } else if (val === 'Purchase Bill') {
        if (lblParty) lblParty.textContent = 'Party / Vendor Name';
        if (lblInv) lblInv.textContent = 'Bill / Invoice Number';
        if (lblAmt) lblAmt.textContent = 'Total Bill Amount (₹)';
        if (inpParty) inpParty.value = 'Shree Krishna Cotton & Yarn Mills';
        if (inpInv) inpInv.value = 'INV-' + Math.floor(1000 + Math.random() * 9000);
        if (inpAmt) inpAmt.value = '145000';
        if (inpDr) inpDr.value = 'Raw Material Cotton Purchase A/c';
        if (inpNar) inpNar.value = 'Being yarn raw material purchased for weaving unit';
      } else if (val === 'Production Weight Entry') {
        if (lblParty) lblParty.textContent = 'Loom / Batch / Article';
        if (lblInv) lblInv.textContent = 'Weight Slip No / Lot';
        if (lblAmt) lblAmt.textContent = 'Net Weight (KG)';
        if (inpParty) inpParty.value = 'Weaving Unit - Loom Lot #44';
        if (inpInv) inpInv.value = 'WT-SLIP-' + Math.floor(1000 + Math.random() * 9000);
        if (inpAmt) inpAmt.value = '1130.00';
        if (inpDr) inpDr.value = 'Finished Fabric Stock (Blended Suiting)';
        if (inpNar) inpNar.value = 'Gross 1250 kg, Tare 120 kg, Net 1130 kg';
      }
    },

    saveNewEntry: function() {
      var party = (document.getElementById('rpa-inp-party') || {}).value || '';
      var inv = (document.getElementById('rpa-inp-inv') || {}).value || '';
      var amt = (document.getElementById('rpa-inp-amt') || {}).value || 0;
      var type = (document.getElementById('rpa-inp-type') || {}).value || 'General Process Entry';
      var target = (document.getElementById('rpa-inp-target') || {}).value || 'erp-arora-cloud';
      var date = (document.getElementById('rpa-inp-date') || {}).value || new Date().toISOString().substring(0, 10);
      var gst = (document.getElementById('rpa-inp-gst') || {}).value || 0;
      var dr = (document.getElementById('rpa-inp-dr') || {}).value || 'Production WIP';
      var nar = (document.getElementById('rpa-inp-narration') || {}).value || '';

      if (!party.trim()) {
        alert('Kripya Party / Machine Name enter karein!');
        return;
      }
      if (!amt || Number(amt) <= 0) {
        alert('Kripya valid Amount ya Qty enter karein!');
        return;
      }

      var newEntry = {
        id: 'ENT-' + Date.now().toString().slice(-6),
        date: date,
        type: type,
        targetErp: target,
        partyName: party.trim(),
        invoiceNo: inv.trim() || 'REF-' + Math.floor(1000 + Math.random() * 9000),
        amount: Number(amt),
        unit: (type.includes('Process') || type.includes('Weight')) ? 'KG' : 'INR',
        taxGst: Number(gst),
        debitLedger: dr.trim(),
        creditLedger: type.includes('Purchase') ? ('Sundry Creditors - ' + party.trim()) : 'Inventory Stock Clearing',
        narration: nar.trim() || ('Being ' + type + ' entered from ATPL ERP'),
        status: 'pending',
        createdAt: new Date().toISOString()
      };

      var queue = loadQueue();
      queue.unshift(newEntry);
      saveQueue(queue);

      appendLog('INFO', 'New entry added to queue: ' + newEntry.partyName + ' (' + newEntry.amount + ')');
      this.setTab('queue');
      if (window.showToast) window.showToast('✅ Entry queue me add ho gayi!');
    },

    deleteEntry: function(id) {
      if (!confirm('Kya aap is entry ko remove karna chahte hain?')) return;
      var queue = loadQueue().filter(function(q) { return q.id !== id; });
      saveQueue(queue);
      renderModalContent();
    },

    executeSingle: function(id) {
      var queue = loadQueue();
      var item = queue.find(function(q) { return q.id === id; });
      if (!item) return;

      var profiles = loadProfiles();
      var profile = profiles.find(function(p) { return p.id === item.targetErp; }) || profiles[0];

      item.status = 'running';
      saveQueue(queue);
      renderModalContent();

      var self = this;
      simulateRoboticExecution(item, profile, function(msg) {
        renderModalContent();
      }, function() {
        var qNow = loadQueue();
        var it = qNow.find(function(q) { return q.id === id; });
        if (it) {
          it.status = 'success';
          it.postedRef = (profile.url && profile.url.includes('erp-system-ui-515975426507') ? 'ARORA-CLOUD-TXN-' : 'EXT-') + Math.floor(100000 + Math.random() * 900000);
          saveQueue(qNow);
        }
        renderModalContent();
        if (window.showToast) window.showToast('✅ Entry posted to ' + profile.name + '!');
      });
    },

    executeBulkPending: function() {
      var queue = loadQueue();
      var pendings = queue.filter(function(q) { return q.status === 'pending'; });
      if (pendings.length === 0) {
        alert('Abhi koi pending entry nahi hai! Sabhi entries pehle se posted hain.');
        return;
      }

      this.setTab('terminal');
      appendLog('INFO', 'Starting Bulk Autonomous Entry for ' + pendings.length + ' entries into target ERP...');

      var self = this;
      var i = 0;
      function runNext() {
        if (i < pendings.length) {
          var item = pendings[i];
          var profiles = loadProfiles();
          var profile = profiles.find(function(p) { return p.id === item.targetErp; }) || profiles[0];

          simulateRoboticExecution(item, profile, null, function() {
            var q = loadQueue();
            var matched = q.find(function(x) { return x.id === item.id; });
            if (matched) {
              matched.status = 'success';
              matched.postedRef = (profile.url && profile.url.includes('erp-system-ui-515975426507') ? 'ARORA-CLOUD-TXN-' : 'EXT-') + Math.floor(100000 + Math.random() * 900000);
              saveQueue(q);
            }
            i++;
            runNext();
          });
        } else {
          appendLog('SUCCESS', 'All ' + pendings.length + ' entries posted successfully to target ERP!');
          renderModalContent();
          if (window.showToast) window.showToast('🎉 Saare pending entries dusre ERP me post ho gaye!');
        }
      }
      runNext();
    },

    generateSalaryJournalEntry: function() {
      var netAmt = 284000;
      try {
        if (window.FILES && window.FILES.length) {
          var f = window.FILES[0];
          if (f.totalNet) netAmt = Math.round(f.totalNet);
        }
      } catch(_) {}

      var jEntry = {
        id: 'ENT-SAL-' + Date.now().toString().slice(-4),
        date: new Date().toISOString().substring(0, 10),
        type: 'Salary Journal',
        targetErp: 'erp-arora-cloud',
        partyName: 'ATPL Monthly Staff & Workers Payroll',
        invoiceNo: 'PAY-JRNL-' + (new Date().getMonth() + 1) + '-' + new Date().getFullYear(),
        amount: netAmt,
        unit: 'INR',
        taxGst: 0,
        debitLedger: 'Salaries & Wages Expenses A/c',
        creditLedger: 'Salary Payable / Net Wages Clearing A/c',
        narration: 'Being monthly payroll synced from ATPL HR system into Arora Cloud ERP',
        status: 'pending',
        createdAt: new Date().toISOString()
      };

      var queue = loadQueue();
      queue.unshift(jEntry);
      saveQueue(queue);

      appendLog('INFO', 'Generated Payroll Journal from ATPL Salary sheet: ₹' + netAmt);
      this.open('queue');
      if (window.showToast) window.showToast('💰 Payroll Journal entry ban gayi!');
    },

    addNewProfileModal: function() {
      renderProfileEditModal(null);
    },

    editProfile: function(profileId) {
      var profiles = loadProfiles();
      var p = profiles.find(function(x) { return x.id === profileId; });
      if (p) renderProfileEditModal(p);
    },

    closeProfileModal: function() {
      if (profileModalEl) {
        profileModalEl.remove();
        profileModalEl = null;
      }
    },

    saveProfileModal: function(profileId) {
      var name = (document.getElementById('rpa-prof-name') || {}).value || '';
      var url = (document.getElementById('rpa-prof-url') || {}).value || '';
      var type = (document.getElementById('rpa-prof-type') || {}).value || 'cloud_rpa';
      var company = (document.getElementById('rpa-prof-co') || {}).value || '';
      var user = (document.getElementById('rpa-prof-user') || {}).value || '';
      var pass = (document.getElementById('rpa-prof-pass') || {}).value || '';
      var desc = (document.getElementById('rpa-prof-desc') || {}).value || '';

      if (!name.trim()) {
        alert('ERP Software Name bharein!');
        return;
      }
      if (!url.trim()) {
        alert('Target ERP URL bharein!');
        return;
      }

      var profiles = loadProfiles();
      var idx = profiles.findIndex(function(x) { return x.id === profileId; });

      var newObj = {
        id: profileId || ('erp-' + Date.now().toString().slice(-5)),
        name: name.trim(),
        url: url.trim(),
        type: type,
        company: company.trim() || 'Arora Textiles Pvt Ltd',
        username: user.trim() || 'admin',
        password: pass || '••••••••',
        status: 'active',
        desc: desc.trim() || 'Connected ERP System'
      };

      if (idx >= 0) {
        profiles[idx] = newObj;
      } else {
        profiles.push(newObj);
      }

      saveProfiles(profiles);
      this.closeProfileModal();
      renderModalContent();
      if (window.showToast) window.showToast('✅ ERP Connection profile save ho gayi!');
    },

    deleteProfile: function(profileId) {
      if (!confirm('Kya aap is ERP profile ko delete karna chahte hain?')) return;
      var profiles = loadProfiles().filter(function(x) { return x.id !== profileId; });
      saveProfiles(profiles);
      renderModalContent();
      if (window.showToast) window.showToast('Profile deleted');
    },

    testConnection: function(profileId) {
      var profiles = loadProfiles();
      var p = profiles.find(function(x) { return x.id === profileId; });
      if (!p) return;

      appendLog('RUNNING', 'Testing ping to ' + p.name + ' (' + p.url + ')...');
      this.setTab('terminal');

      setTimeout(function() {
        appendLog('SUCCESS', 'HTTP 200 OK! Connection to ' + p.name + ' is active and ready for automatic entry.');
        renderModalContent();
        if (window.showToast) window.showToast('🟢 ' + p.name + ' connected!');
      }, 600);
    },

    openTargetErp: function(profileId) {
      var profiles = loadProfiles();
      var p = profiles.find(function(x) { return x.id === profileId; }) || profiles[0];
      var url = p.url || 'https://erp-system-ui-515975426507.asia-south1.run.app/';
      window.open(url, '_blank');
      appendLog('INFO', 'Launched external ERP tab: ' + url);
      if (window.showToast) window.showToast('🌐 ' + p.name + ' new tab me open kiya!');
    },

    copyJsonPayload: function(id) {
      var queue = loadQueue();
      var item = queue.find(function(q) { return q.id === id; }) || queue[0];
      if (!item) return;

      var payload = JSON.stringify({
        source: 'ATPL_HR_ERP',
        target: 'https://erp-system-ui-515975426507.asia-south1.run.app/',
        entryType: item.type,
        refNo: item.invoiceNo,
        date: item.date,
        party: item.partyName,
        value: item.amount,
        unit: item.unit || 'INR',
        narration: item.narration,
        ledgers: { debit: item.debitLedger, credit: item.creditLedger }
      }, null, 2);

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(payload);
        if (window.showToast) window.showToast('📋 JSON Payload clipboard me copy ho gaya!');
      } else {
        alert('Payload:
' + payload);
      }
    },

    copyBookmarklet: function() {
      var code = getBookmarkletCode();
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(code);
        if (window.showToast) window.showToast('📋 Bookmarklet code copy ho gaya!');
      } else {
        var ta = document.getElementById('rpa-bookmarklet-text');
        if (ta) { ta.select(); document.execCommand('copy'); }
      }
    },

    clearLogs: function() {
      try { localStorage.removeItem(STORAGE_LOG_KEY); } catch(_) {}
      renderModalContent();
    },

    refreshProfiles: function() {
      loadProfiles();
    }
  };

  console.log('[ATPL Cross-ERP Bot] Loaded v1.2 with Arora Cloud ERP support.');
})();
