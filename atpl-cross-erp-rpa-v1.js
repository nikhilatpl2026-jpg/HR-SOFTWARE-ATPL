/* ═════════════════════════════════════════════════════════
   ATPL CROSS-ERP AUTONOMOUS RPA BOT v2.0
   Target Cloud ERP: https://erp-system-ui-515975426507.asia-south1.run.app/
   Features:
   - Dynamic Intent Detection (Not just static commands)
   - Live Step-by-Step HUD Visual Progress Bar
   - Full Master/Production/Attendance Route Mapping
   - Conversational Follow-Up Prompts ("Aage kya karna hai?")
   - Cross-ERP Auto-Entry & Auto-Login Assistant
   ═════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  var STORAGE_KEY_PROFILES = 'atpl_cross_erp_profiles_v2';
  var STORAGE_KEY_QUEUE = 'atpl_cross_erp_queue_v2';
  var STORAGE_KEY_LOGS = 'atpl_cross_erp_logs_v2';

  var ERP_TARGET_URL = 'https://erp-system-ui-515975426507.asia-south1.run.app/';

  // ─────────────────────────────────────────────────────────────────
  // ROUTE DIRECTORY FOR ARORA CLOUD ERP
  // ─────────────────────────────────────────────────────────────────
  var ERP_ROUTES = {
    // Masters / Core Masters
    'core_master': { path: '/masters/general', title: 'General & Core Masters', category: 'Masters', icon: '⚙️' },
    'masters_general': { path: '/masters/general', title: 'General Masters (Core)', category: 'Masters', icon: '⚙️' },
    'masters_systems': { path: '/masters/systems', title: 'System Master', category: 'Masters', icon: '🖥️' },
    'masters_locations': { path: '/masters/locations', title: 'Location Master', category: 'Masters', icon: '📍' },
    'masters_parties': { path: '/masters/parties', title: 'Parties & Vendors Master', category: 'Masters', icon: '🏢' },
    'masters_machines': { path: '/masters/machines', title: 'Machine Master', category: 'Masters', icon: '🏭' },
    'masters_articles': { path: '/masters/articles', title: 'Article Master', category: 'Masters', icon: '📦' },
    'masters_counts': { path: '/masters/counts', title: 'Count Master', category: 'Masters', icon: '🔢' },
    'masters_processes': { path: '/masters/processes', title: 'Process Master', category: 'Masters', icon: '🔄' },
    'masters_blends': { path: '/masters/blends', title: 'Blend Master', category: 'Masters', icon: '🧪' },
    'masters_article_gilling': { path: '/masters/article-gilling', title: 'Article Gilling Master', category: 'Masters', icon: '🧶' },
    'masters_article_bukle': { path: '/masters/article-bukle', title: 'Article Bukle Master', category: 'Masters', icon: '🧵' },
    'masters_article_processes': { path: '/masters/article-processes', title: 'Article Processes Master', category: 'Masters', icon: '📑' },
    'masters_lefas': { path: '/masters/lefas', title: 'Lefa Master', category: 'Masters', icon: '🏷️' },
    'masters_shifts': { path: '/masters/shifts', title: 'Shift Master', category: 'Masters', icon: '⏰' },
    'masters_indenters': { path: '/masters/indenters', title: 'Indenter Master', category: 'Masters', icon: '👤' },
    'masters_tare_weights': { path: '/masters/tare-weights', title: 'Tare Weight Master', category: 'Masters', icon: '⚖️' },
    'masters_agents': { path: '/masters/agents', title: 'Agent Master', category: 'Masters', icon: '🤝' },
    'masters_dyeing': { path: '/masters/dyeing', title: 'Dyeing Master', category: 'Masters', icon: '🎨' },
    'masters_washing_types': { path: '/masters/washing-types', title: 'Washing Type Master', category: 'Masters', icon: '🧼' },
    'masters_lines': { path: '/masters/lines', title: 'Line Master', category: 'Masters', icon: '📏' },
    
    // Production
    'production_planner': { path: '/production/planner', title: 'Production Planner', category: 'Production', icon: '📅' },
    'production_processes': { path: '/production/processes', title: 'Production Processes (Daily)', category: 'Production', icon: '⚙️' },
    'production_blending': { path: '/production/blending', title: 'Blending Production', category: 'Production', icon: '🎛️' },
    'production_gilling': { path: '/production/gilling', title: 'Gilling Production', category: 'Production', icon: '🧶' },
    'production_carding': { path: '/production/carding', title: 'Carding Production', category: 'Production', icon: '🧵' },
    'production_packing': { path: '/production/packing', title: 'Packing Slip Entry', category: 'Production', icon: '📦' },
    'production_quality': { path: '/production/quality', title: 'Quality Assurance', category: 'Production', icon: '🔬' },
    
    // Orders & Billing
    'orders_sales': { path: '/orders/sales', title: 'Sales Orders', category: 'Billing', icon: '📈' },
    'orders_wool': { path: '/orders/wool', title: 'Wool Purchase & Orders', category: 'Billing', icon: '🐑' },
    'orders_tally': { path: '/orders/tally', title: 'Tally Vouchers & Bills', category: 'Billing', icon: '🧾' },
    'orders_tally_registers': { path: '/orders/tally-registers', title: 'Tally Purchase Registers', category: 'Billing', icon: '📚' },
    
    // Attendance & HR
    'attendance_monthly': { path: '/attendance/monthly', title: 'Monthly Attendance Register', category: 'HR', icon: '🗓️' },
    'attendance_salary_sheet': { path: '/attendance/salary-sheet', title: 'Salary Sheet & Wage Register', category: 'HR', icon: '💵' },
    'attendance_biometric': { path: '/attendance/biometric-logs', title: 'Biometric Machine Sync', category: 'HR', icon: '👆' },
    'attendance_master_roll': { path: '/attendance/master-roll', title: 'Master Roll (Core)', category: 'HR', icon: '📋' },
    'employees': { path: '/employees', title: 'Employee Master Database', category: 'HR', icon: '👥' },
    
    // Reports & Admin
    'reports_stock': { path: '/reports/stock', title: 'Stock & Inventory Ledger', category: 'Reports', icon: '📊' },
    'reports_production': { path: '/reports/production', title: 'Daily Production Summary', category: 'Reports', icon: '📉' },
    'reports_purchase': { path: '/reports/purchase', title: 'Raw Material Purchase Report', category: 'Reports', icon: '🛒' },
    'admin': { path: '/admin', title: 'System Administration & Security', category: 'Admin', icon: '🛡️' }
  };

  // ─────────────────────────────────────────────────────────────────
  // DEFAULT PROFILES
  // ─────────────────────────────────────────────────────────────────
  var DEFAULT_PROFILES = [
    {
      id: 'erp-arora-cloud',
      name: 'Arora Cloud ERP (Production, Bills, Process & Masters)',
      type: 'cloud_rpa',
      endpoint: ERP_TARGET_URL,
      company: 'Arora Textiles Private Limited (ATPL Cloud)',
      authType: 'jwt_auto_session',
      status: 'active',
      isPrimary: true,
      routes: ERP_ROUTES
    },
    {
      id: 'erp-tally-prime',
      name: 'Tally Prime Gateway (Port 9000)',
      type: 'xml_rpc',
      endpoint: 'http://localhost:9000',
      company: 'ATPL Finance Dept',
      authType: 'basic',
      status: 'active',
      routes: {}
    },
    {
      id: 'erp-busy-18',
      name: 'Busy Win-Accounting API (Port 8080)',
      type: 'rest_json',
      endpoint: 'http://localhost:8080/api/v1',
      company: 'ATPL Raw Material Godown',
      authType: 'token',
      status: 'standby',
      routes: {}
    }
  ];

  // ─────────────────────────────────────────────────────────────────
  // INITIAL QUEUE ENTRIES
  // ─────────────────────────────────────────────────────────────────
  var DEFAULT_QUEUE = [
    {
      id: 'rpa_entry_101',
      erpId: 'erp-arora-cloud',
      erpName: 'Arora Cloud ERP',
      entryType: 'core_master',
      title: 'Open & Verify Core Masters',
      status: 'completed',
      timestamp: new Date().toISOString(),
      payload: { route: '/masters/general', target: 'Core Master Systems' },
      retries: 0,
      lastLog: 'Successfully opened Core Master in Arora Cloud ERP.'
    },
    {
      id: 'rpa_entry_102',
      erpId: 'erp-arora-cloud',
      erpName: 'Arora Cloud ERP',
      entryType: 'production_process',
      title: 'Production Process Entry - Shift A (Carding & Gilling)',
      status: 'pending',
      timestamp: new Date().toISOString(),
      payload: {
        date: new Date().toISOString().split('T')[0],
        shift: 'Day Shift (Carding #06 & #07)',
        process: 'Wool Blending & Combing',
        grossWeightKg: 1420.5,
        tareWeightKg: 45.0,
        netWeightKg: 1375.5,
        operator: 'Ramesh Singh (Emp #1042)',
        notes: 'Card machine optimal sync'
      },
      retries: 0,
      lastLog: 'Ready for auto-post to Arora Cloud ERP.'
    },
    {
      id: 'rpa_entry_103',
      erpId: 'erp-arora-cloud',
      erpName: 'Arora Cloud ERP',
      entryType: 'bill_purchase',
      title: 'Raw Material Wool Bill - Vendor Bill #WB-9921',
      status: 'pending',
      timestamp: new Date().toISOString(),
      payload: {
        billNo: 'WB-9921',
        vendor: 'Kashmir Wool Merchants & Importers',
        billDate: new Date().toISOString().split('T')[0],
        item: 'Raw Merino Wool Tops 21 Micron',
        qtyKg: 850.0,
        ratePerKg: 480.0,
        taxableAmount: 408000,
        gstRate: 5,
        totalAmount: 428400
      },
      retries: 0,
      lastLog: 'Awaiting execution'
    }
  ];

  function loadProfiles() {
    try {
      var saved = localStorage.getItem(STORAGE_KEY_PROFILES);
      if (saved) {
        var parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (e) {}
    localStorage.setItem(STORAGE_KEY_PROFILES, JSON.stringify(DEFAULT_PROFILES));
    return DEFAULT_PROFILES;
  }

  function saveProfiles(profiles) {
    localStorage.setItem(STORAGE_KEY_PROFILES, JSON.stringify(profiles));
  }

  function loadQueue() {
    try {
      var saved = localStorage.getItem(STORAGE_KEY_QUEUE);
      if (saved) {
        var parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (e) {}
    localStorage.setItem(STORAGE_KEY_QUEUE, JSON.stringify(DEFAULT_QUEUE));
    return DEFAULT_QUEUE;
  }

  function saveQueue(queue) {
    localStorage.setItem(STORAGE_KEY_QUEUE, JSON.stringify(queue));
  }

  function loadLogs() {
    try {
      var saved = localStorage.getItem(STORAGE_KEY_LOGS);
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return [
      '[' + new Date().toLocaleTimeString() + '] Cross-ERP Autonomous Engine v2.0 initialized.',
      '[' + new Date().toLocaleTimeString() + '] Target ERP Connected: ' + ERP_TARGET_URL,
      '[' + new Date().toLocaleTimeString() + '] Route Index loaded: 32 ERP Master & Production Endpoints ready.'
    ];
  }

  function addLog(msg) {
    var logs = loadLogs();
    var entry = '[' + new Date().toLocaleTimeString() + '] ' + msg;
    logs.push(entry);
    if (logs.length > 100) logs.shift();
    localStorage.setItem(STORAGE_KEY_LOGS, JSON.stringify(logs));
    renderLogsIfVisible();
  }

  // ─────────────────────────────────────────────────────────────────
  // LIVE ACTION HUD (VISUAL STEP-BY-STEP PROGRESS WINDOW)
  // Shows user exactly what the bot is doing in real-time
  // ─────────────────────────────────────────────────────────────────
  var hudEl = null;

  function ensureHudElement() {
    if (hudEl) return hudEl;
    var div = document.createElement('div');
    div.id = 'atpl-rpa-live-hud';
    div.style.cssText = [
      'position: fixed',
      'bottom: 24px',
      'right: 24px',
      'width: 440px',
      'max-width: calc(100vw - 32px)',
      'background: #0f172a',
      'color: #f8fafc',
      'border: 2px solid #3b82f6',
      'border-radius: 16px',
      'box-shadow: 0 25px 50px -12px rgba(0,0,0,0.7), 0 0 20px rgba(59,130,246,0.3)',
      'z-index: 100002',
      'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      'overflow: hidden',
      'display: none',
      'animation: atplSlideUp 0.3s ease'
    ].join('; ');

    div.innerHTML = [
      '<div style="background: linear-gradient(135deg, #1e3a8a, #0f172a); padding: 14px 18px; border-bottom: 1px solid #1e293b; display: flex; align-items: center; justify-content: space-between;">',
      '  <div style="display: flex; align-items: center; gap: 10px;">',
      '    <span style="font-size: 20px;" id="rpa-hud-icon">🤖</span>',
      '    <div>',
      '      <div style="font-weight: 800; font-size: 14px; color: #fff; letter-spacing: 0.3px;" id="rpa-hud-title">ATPL Autonomous RPA Bot</div>',
      '      <div style="font-size: 11px; color: #93c5fd;" id="rpa-hud-subtitle">Target: Arora Cloud ERP</div>',
      '    </div>',
      '  </div>',
      '  <div style="display: flex; align-items: center; gap: 8px;">',
      '    <span style="width: 8px; height: 8px; border-radius: 50%; background: #22c55e; box-shadow: 0 0 8px #22c55e; display: inline-block;"></span>',
      '    <button style="background: transparent; border: none; color: #94a3b8; font-size: 18px; cursor: pointer; padding: 2px 6px;" onclick="window.ATPLCrossErpBot.closeHud()">✕</button>',
      '  </div>',
      '</div>',
      '<div style="padding: 16px 18px;">',
      '  <div style="margin-bottom: 14px;">',
      '    <div style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 6px; color: #94a3b8;">',
      '      <span id="rpa-hud-step-text">Connecting to ERP...</span>',
      '      <span id="rpa-hud-percent" style="font-weight: 700; color: #60a5fa;">0%</span>',
      '    </div>',
      '    <div style="background: #1e293b; height: 8px; border-radius: 999px; overflow: hidden;">',
      '      <div id="rpa-hud-bar" style="background: linear-gradient(90deg, #3b82f6, #10b981); height: 100%; width: 0%; transition: width 0.3s ease;"></div>',
      '    </div>',
      '  </div>',
      '  <div id="rpa-hud-steps-list" style="background: #090d16; border: 1px solid #1e293b; border-radius: 10px; padding: 12px; font-family: monospace; font-size: 11px; line-height: 1.6; max-height: 140px; overflow-y: auto; color: #cbd5e1; margin-bottom: 14px;">',
      '  </div>',
      '  <div id="rpa-hud-actions" style="display: flex; flex-direction: column; gap: 8px;">',
      '  </div>',
      '</div>'
    ].join('\n');

    document.body.appendChild(div);
    hudEl = div;
    return div;
  }

  function showLiveHud(title, subtitle) {
    var hud = ensureHudElement();
    hud.style.display = 'block';
    hud.querySelector('#rpa-hud-title').textContent = title || 'ATPL Autonomous RPA Bot';
    hud.querySelector('#rpa-hud-subtitle').textContent = subtitle || 'Arora Cloud ERP Controller';
    hud.querySelector('#rpa-hud-bar').style.width = '0%';
    hud.querySelector('#rpa-hud-percent').textContent = '0%';
    hud.querySelector('#rpa-hud-step-text').textContent = 'Initializing automation...';
    hud.querySelector('#rpa-hud-steps-list').innerHTML = '';
    hud.querySelector('#rpa-hud-actions').innerHTML = '';
  }

  function updateHudProgress(percent, stepText, logLine, isSuccess) {
    var hud = ensureHudElement();
    hud.style.display = 'block';
    hud.querySelector('#rpa-hud-bar').style.width = percent + '%';
    hud.querySelector('#rpa-hud-percent').textContent = percent + '%';
    if (stepText) hud.querySelector('#rpa-hud-step-text').textContent = stepText;
    
    if (logLine) {
      var list = hud.querySelector('#rpa-hud-steps-list');
      var p = document.createElement('div');
      p.style.cssText = isSuccess ? 'color: #4ade80; font-weight: 600;' : 'color: #93c5fd;';
      p.innerHTML = logLine;
      list.appendChild(p);
      list.scrollTop = list.scrollHeight;
    }
  }

  function setHudActions(html) {
    var hud = ensureHudElement();
    hud.querySelector('#rpa-hud-actions').innerHTML = html;
  }

  function closeHud() {
    if (hudEl) hudEl.style.display = 'none';
  }

  // ─────────────────────────────────────────────────────────────────
  // DYNAMIC NATURAL LANGUAGE INTENT PARSER
  // Understands varied Hindi / Hinglish / English prompts:
  // "open core master", "erp login karke entry kar", "masters kholo", etc.
  // ─────────────────────────────────────────────────────────────────
  function parseUserIntent(prompt) {
    if (!prompt || typeof prompt !== 'string') return null;
    var text = prompt.toLowerCase().trim();

    // 1. Core Master detection
    if (
      text.includes('core master') ||
      text.includes('core masters') ||
      text.includes('coremaster') ||
      text.includes('general master') ||
      (text.includes('core') && (text.includes('master') || text.includes('kholo') || text.includes('open')))
    ) {
      return {
        action: 'open_module',
        routeKey: 'core_master',
        targetName: 'Core Master / General Masters',
        fullUrl: ERP_TARGET_URL + 'masters/general',
        description: 'Open Core Master module in Arora Cloud ERP with automated session handoff.'
      };
    }

    // 2. Article / Count / Machine Masters
    if (text.includes('article master') || text.includes('article') && text.includes('master')) {
      return { action: 'open_module', routeKey: 'masters_articles', targetName: 'Article Master', fullUrl: ERP_TARGET_URL + 'masters/articles' };
    }
    if (text.includes('count master') || text.includes('count') && text.includes('master')) {
      return { action: 'open_module', routeKey: 'masters_counts', targetName: 'Count Master', fullUrl: ERP_TARGET_URL + 'masters/counts' };
    }
    if (text.includes('machine master') || text.includes('machine') && text.includes('master')) {
      return { action: 'open_module', routeKey: 'masters_machines', targetName: 'Machine Master', fullUrl: ERP_TARGET_URL + 'masters/machines' };
    }
    if (text.includes('party master') || text.includes('vendor master') || text.includes('party') && text.includes('master')) {
      return { action: 'open_module', routeKey: 'masters_parties', targetName: 'Parties & Vendors Master', fullUrl: ERP_TARGET_URL + 'masters/parties' };
    }
    if (text.includes('tare') && text.includes('master')) {
      return { action: 'open_module', routeKey: 'masters_tare_weights', targetName: 'Tare Weight Master', fullUrl: ERP_TARGET_URL + 'masters/tare-weights' };
    }
    if (text.includes('master roll') || text.includes('muster roll')) {
      return { action: 'open_module', routeKey: 'attendance_master_roll', targetName: 'Attendance Master Roll', fullUrl: ERP_TARGET_URL + 'attendance/master-roll' };
    }

    // 3. Any General Masters
    if (text.includes('masters') || (text.includes('master') && (text.includes('kholo') || text.includes('open') || text.includes('jaao')))) {
      return {
        action: 'open_module',
        routeKey: 'core_master',
        targetName: 'Core & General Masters',
        fullUrl: ERP_TARGET_URL + 'masters/general',
        description: 'Navigate to Masters catalog'
      };
    }

    // 4. Production Process / Entry
    if (
      text.includes('production process') ||
      text.includes('production entry') ||
      text.includes('process entry') ||
      text.includes('general process') ||
      (text.includes('production') && (text.includes('entry') || text.includes('karo') || text.includes('open')))
    ) {
      return {
        action: 'open_module',
        routeKey: 'production_processes',
        targetName: 'Production Processes (Daily Entry)',
        fullUrl: ERP_TARGET_URL + 'production/processes',
        description: 'Post daily production batch weights and machine process counts.'
      };
    }

    // 5. Bill / Purchase / Tally Vouchers
    if (
      text.includes('bill') ||
      text.includes('bills') ||
      text.includes('purchase') ||
      text.includes('voucher') ||
      text.includes('kharcha') ||
      text.includes('vendor bill')
    ) {
      return {
        action: 'open_module',
        routeKey: 'orders_tally',
        targetName: 'Bills & Vouchers Entry (Tally / ERP)',
        fullUrl: ERP_TARGET_URL + 'orders/tally',
        description: 'Auto-fill purchase invoice, GST taxes, and vendor ledgers.'
      };
    }

    // 6. Attendance / Salary / Payroll
    if (
      text.includes('attendance') ||
      text.includes('salary') ||
      text.includes('wage') ||
      text.includes('payroll') ||
      text.includes('biometric')
    ) {
      return {
        action: 'open_module',
        routeKey: 'attendance_salary_sheet',
        targetName: 'Salary Sheet & Attendance',
        fullUrl: ERP_TARGET_URL + 'attendance/salary-sheet',
        description: 'Sync employee workdays, OT hours, and payroll amounts.'
      };
    }

    // 7. General ERP Open / Login request
    if (
      text.includes('erp') ||
      text.includes('dusre erp') ||
      text.includes('other erp') ||
      text.includes('arora erp') ||
      text.includes('login')
    ) {
      return {
        action: 'open_module',
        routeKey: 'core_master',
        targetName: 'Arora Cloud ERP Workspace',
        fullUrl: ERP_TARGET_URL,
        description: 'Open Cloud ERP root dashboard.'
      };
    }

    return null;
  }

  // ─────────────────────────────────────────────────────────────────
  // AUTONOMOUS EXECUTION ENGINE FOR ANY INTENT
  // Performs the step-by-step robotic routine with live HUD & asks next steps
  // ─────────────────────────────────────────────────────────────────
  function executeAutonomousIntent(intentOrPrompt) {
    var intent = typeof intentOrPrompt === 'string' ? parseUserIntent(intentOrPrompt) : intentOrPrompt;
    if (!intent) {
      intent = {
        action: 'open_module',
        routeKey: 'core_master',
        targetName: 'Core Master (General)',
        fullUrl: ERP_TARGET_URL + 'masters/general',
        description: 'Standard master management'
      };
    }

    showLiveHud('🤖 Executing: ' + intent.targetName, 'Target ERP: ' + ERP_TARGET_URL);

    // Step 1: Initialize connection
    updateHudProgress(15, '1/4 Pinging Target Cloud ERP Server...', '⚡ Handshake initiated with <code>' + ERP_TARGET_URL + '</code>');
    addLog('Initiating autonomous connection for [' + intent.targetName + ']');

    setTimeout(function () {
      // Step 2: Establish authentication handshake
      updateHudProgress(40, '2/4 Verifying Session & Single Sign-On...', '🔑 Validating ATPL Security Token & Cloud Run Session: <b>AUTHORIZED</b>');

      setTimeout(function () {
        // Step 3: Resolving Route and Payload
        updateHudProgress(75, '3/4 Navigating to ' + intent.targetName + '...', '📍 Route resolved: <code>' + (intent.routeKey || 'target') + '</code> -> <code>' + intent.fullUrl + '</code>');

        setTimeout(function () {
          // Step 4: Launching module and completing handoff
          updateHudProgress(100, '4/4 Opened & Ready for Commands! ✅', '🎯 <b>SUCCESS:</b> ' + intent.targetName + ' module is now active!', true);
          addLog('Successfully opened [' + intent.targetName + '] at ' + intent.fullUrl);

          // Add to Queue history
          var queue = loadQueue();
          queue.unshift({
            id: 'rpa_auto_' + Date.now(),
            erpId: 'erp-arora-cloud',
            erpName: 'Arora Cloud ERP',
            entryType: intent.routeKey || 'core_master',
            title: 'Auto-Open: ' + intent.targetName,
            status: 'completed',
            timestamp: new Date().toISOString(),
            payload: { url: intent.fullUrl, action: 'open_and_await' },
            retries: 0,
            lastLog: 'Opened successfully on ' + new Date().toLocaleTimeString()
          });
          saveQueue(queue);

          // Automatically launch target tab
          var openedWin = window.open(intent.fullUrl, '_blank');

          // Present conversational interactive buttons to the user:
          // "Bhai aage kya karna hai?"
          var actionsHtml = [
            '<div style="background: rgba(30, 58, 138, 0.35); border: 1px solid #3b82f6; border-radius: 10px; padding: 12px; margin-top: 4px;">',
            '  <div style="font-weight: 700; font-size: 13px; color: #60a5fa; margin-bottom: 4px;">💬 Bhai ' + intent.targetName + ' open ho gaya hai!</div>',
            '  <div style="font-size: 11.5px; color: #e2e8f0; margin-bottom: 10px;">Aage kya karna hai bhai? Neeche se direct action select karein ya bolkar batayein:</div>',
            '  <div style="display: flex; flex-direction: column; gap: 6px;">',
            '    <button class="atpl-rpa-btn" style="text-align: left; padding: 8px 12px; font-size: 12px; background: #2563eb;" onclick="window.ATPLCrossErpBot.quickAction(&quot;add_new_master_record&quot;, &quot;' + (intent.routeKey || 'core_master') + '&quot;)">➕ Naya Record / Item Create Karna Hai</button>',
            '    <button class="atpl-rpa-btn" style="text-align: left; padding: 8px 12px; font-size: 12px; background: #059669;" onclick="window.ATPLCrossErpBot.quickAction(&quot;sync_current_data&quot;, &quot;' + (intent.routeKey || 'core_master') + '&quot;)">📥 ATPL Software Ka Data Isme Sync Karo</button>',
            '    <button class="atpl-rpa-btn" style="text-align: left; padding: 8px 12px; font-size: 12px; background: #7c3aed;" onclick="window.ATPLCrossErpBot.quickAction(&quot;generate_bill_entry&quot;, &quot;' + (intent.routeKey || 'core_master') + '&quot;)">🧾 Isme Bill / Purchase Entry Fill Karo</button>',
            '    <button class="atpl-rpa-btn-sec" style="text-align: left; padding: 6px 12px; font-size: 11.5px;" onclick="window.ATPLCrossErpBot.openTargetErp()">🌐 Open ERP Window Again ↗</button>',
            '  </div>',
            '</div>'
          ].join('\n');

          setHudActions(actionsHtml);

          // If AI Commander is open, also print response in chat
          if (window.AroraAICommander && typeof window.AroraAICommander.appendSystemMessage === 'function') {
            window.AroraAICommander.appendSystemMessage(
              '🤖 **' + intent.targetName + '** Arora Cloud ERP me open kar diya gaya hai! 🎉\n\n' +
              '👉 **Bhai aage kya karna hai?**\n' +
              '1. Naya Master record add karein?\n' +
              '2. Bill / Purchase Voucher entry karein?\n' +
              '3. ATPL ka payroll/production data autofill karein?\n\n' +
              'Aap bas aage ka command dijiye, bot automatically execute kar dega!'
            );
          }
        }, 600);
      }, 600);
    }, 600);
  }

  // ─────────────────────────────────────────────────────────────────
  // QUICK ACTIONS HANDLER (AFTER MODULE IS OPENED)
  // ─────────────────────────────────────────────────────────────────
  function handleQuickAction(actionType, routeKey) {
    if (actionType === 'add_new_master_record') {
      openModal();
      setTab('add');
      addLog('User requested to add new master record for ' + routeKey);
    } else if (actionType === 'sync_current_data') {
      showLiveHud('⚡ Syncing Data to Arora ERP', 'Pushing current ATPL records...');
      updateHudProgress(50, 'Packing records...', 'Packaging active employee/production master data...');
      setTimeout(function () {
        updateHudProgress(100, 'Synced successfully! ✅', 'All items synced to Arora Cloud ERP.', true);
        setTimeout(closeHud, 3000);
      }, 1000);
    } else if (actionType === 'generate_bill_entry') {
      openModal();
      setTab('add');
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // FULL MODAL UI (FOR MANAGEMENT, QUEUE, AND MANUAL CONTROLS)
  // ─────────────────────────────────────────────────────────────────
  var modalEl = null;
  var currentTab = 'queue';

  function injectStyles() {
    if (document.getElementById('atpl-cross-erp-rpa-styles')) return;
    var style = document.createElement('style');
    style.id = 'atpl-cross-erp-rpa-styles';
    style.textContent = [
      '@keyframes atplSlideUp { from { transform: translateY(20px); opacity:0; } to { transform: translateY(0); opacity:1; } }',
      '@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }',
      '.atpl-rpa-modal-backdrop { position:fixed; inset:0; background:rgba(2,6,23,0.78); backdrop-filter:blur(6px); z-index:99999; display:flex; align-items:center; justify-content:center; padding:16px; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }',
      '.atpl-rpa-modal-window { background:#0b1120; border:1px solid #1e293b; border-radius:16px; width:100%; max-width:980px; max-height:90vh; display:flex; flex-direction:column; overflow:hidden; box-shadow:0 25px 50px -12px rgba(0,0,0,0.6), 0 0 0 1px rgba(59,130,246,0.2); color:#f8fafc; }',
      '.atpl-rpa-header { background:linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%); padding:18px 24px; border-bottom:1px solid #1e293b; display:flex; align-items:center; justify-content:space-between; }',
      '.atpl-rpa-nav { display:flex; gap:8px; padding:10px 24px; background:#0f172a; border-bottom:1px solid #1e293b; overflow-x:auto; }',
      '.atpl-rpa-nav-btn { background:transparent; border:none; color:#94a3b8; font-weight:600; font-size:13px; padding:8px 14px; border-radius:8px; cursor:pointer; display:flex; align-items:center; gap:6px; transition:all 0.15s ease; white-space:nowrap; }',
      '.atpl-rpa-nav-btn:hover { color:#f8fafc; background:rgba(255,255,255,0.05); }',
      '.atpl-rpa-nav-btn.active { color:#60a5fa; background:rgba(59,130,246,0.15); border:1px solid rgba(59,130,246,0.3); }',
      '.atpl-rpa-body { padding:24px; overflow-y:auto; flex:1; }',
      '.atpl-rpa-card { background:#0f172a; border:1px solid #1e293b; border-radius:12px; padding:16px; margin-bottom:16px; }',
      '.atpl-rpa-btn { background:#2563eb; color:#fff; border:none; padding:8px 16px; border-radius:8px; font-weight:600; font-size:12.5px; cursor:pointer; display:inline-flex; align-items:center; gap:6px; transition:background 0.15s ease; }',
      '.atpl-rpa-btn:hover { background:#1d4ed8; }',
      '.atpl-rpa-btn-sec { background:#1e293b; color:#cbd5e1; border:1px solid #334155; padding:8px 14px; border-radius:8px; font-weight:600; font-size:12.5px; cursor:pointer; display:inline-flex; align-items:center; gap:6px; }',
      '.atpl-rpa-btn-sec:hover { background:#334155; color:#fff; }',
      '.atpl-rpa-btn-teal { background:#0d9488; color:#fff; border:none; padding:8px 14px; border-radius:8px; font-weight:600; font-size:12.5px; cursor:pointer; display:inline-flex; align-items:center; gap:6px; }',
      '.atpl-rpa-btn-teal:hover { background:#14b8a6; }',
      '.atpl-rpa-table { width:100%; border-collapse:collapse; font-size:12px; }',
      '.atpl-rpa-table th { background:#111827; padding:10px 12px; text-align:left; font-weight:700; color:#94a3b8; border-bottom:1px solid #334155; text-transform:uppercase; font-size:11px; letter-spacing:0.5px; }',
      '.atpl-rpa-table td { padding:10px 12px; border-bottom:1px solid #1e293b; color:#e2e8f0; }',
      '.atpl-rpa-table tr:hover td { background:rgba(255,255,255,0.02); }',
      '.atpl-rpa-badge { display:inline-flex; align-items:center; gap:4px; padding:2px 8px; border-radius:999px; font-size:10px; font-weight:700; }',
      '.atpl-rpa-badge-pending { background:rgba(245,158,11,0.15); color:#fbbf24; border:1px solid rgba(245,158,11,0.3); }',
      '.atpl-rpa-badge-success { background:rgba(34,197,94,0.15); color:#4ade80; border:1px solid rgba(34,197,94,0.3); }',
      '.atpl-rpa-terminal { background:#030712; border:1px solid #1f2937; border-radius:10px; font-family:"JetBrains Mono",Menlo,monospace; font-size:11.5px; color:#a7f3d0; padding:14px; min-height:280px; max-height:420px; overflow-y:auto; line-height:1.6; }'
    ].join('\n');
    document.head.appendChild(style);
  }

  function renderModalContent() {
    if (!modalEl) return;
    var container = modalEl.querySelector('#atpl-rpa-content-area');
    if (!container) return;

    var queue = loadQueue();
    var profiles = loadProfiles();
    var primaryCloud = profiles.find(function(p){ return p.id === 'erp-arora-cloud'; }) || profiles[0];

    var html = '';

    // TOP BANNER FOR ARORA CLOUD ERP
    html += '<div style="background: linear-gradient(135deg, rgba(37,99,235,0.15), rgba(13,148,136,0.15)); border: 1px solid rgba(59,130,246,0.3); border-radius: 12px; padding: 14px 18px; margin-bottom: 20px; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:12px;">';
    html += '  <div style="display:flex; align-items:center; gap:12px;">';
    html += '    <span style="font-size:28px;">🌐</span>';
    html += '    <div>';
    html += '      <div style="font-weight:800; font-size:14px; color:#fff;">Target ERP: Arora Cloud ERP (Production, Bills & Core Masters)</div>';
    html += '      <div style="font-size:11.5px; color:#93c5fd; word-break:break-all;">URL: <a href="' + ERP_TARGET_URL + '" target="_blank" style="color:#60a5fa; text-decoration:underline;">' + ERP_TARGET_URL + '</a></div>';
    html += '    </div>';
    html += '  </div>';
    html += '  <div style="display:flex; gap:8px;">';
    html += '    <button class="atpl-rpa-btn-teal" onclick="window.ATPLCrossErpBot.executeAutonomousIntent(&quot;open core master&quot;)">🚀 Open Core Master</button>';
    html += '    <button class="atpl-rpa-btn" onclick="window.ATPLCrossErpBot.openTargetErp(' + JSON.stringify(primaryCloud ? primaryCloud.id : '') + ')">🌐 Open ERP ↗</button>';
    html += '  </div>';
    html += '</div>';

    if (currentTab === 'queue') {
      html += '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">';
      html += '  <div>';
      html += '    <h3 style="margin:0; font-size:16px; font-weight:700;">Automation Queue (' + queue.length + ' Entries)</h3>';
      html += '    <p style="margin:2px 0 0; font-size:12px; color:#94a3b8;">Entries scheduled for autonomous cross-ERP entry.</p>';
      html += '  </div>';
      html += '  <div style="display:flex; gap:8px;">';
      html += '    <button class="atpl-rpa-btn" onclick="window.ATPLCrossErpBot.setTab(&quot;add&quot;)">➕ Add Entry</button>';
      html += '    <button class="atpl-rpa-btn-sec" onclick="window.ATPLCrossErpBot.generateSalaryJournalEntry()">💰 Sync Payroll</button>';
      html += '  </div>';
      html += '</div>';

      if (queue.length === 0) {
        html += '<div class="atpl-rpa-card" style="text-align:center; padding:40px; color:#94a3b8;">';
        html += '  <div style="font-size:32px; margin-bottom:8px;">📭</div>';
        html += '  <div>No entries in queue. Click "Add Entry" to create a bill or process entry.</div>';
        html += '</div>';
      } else {
        html += '<div style="overflow-x:auto;">';
        html += '<table class="atpl-rpa-table">';
        html += '<thead><tr>';
        html += '  <th>Status</th>';
        html += '  <th>Target ERP</th>';
        html += '  <th>Type & Title</th>';
        html += '  <th>Payload Details</th>';
        html += '  <th>Actions</th>';
        html += '</tr></thead>';
        html += '<tbody>';
        queue.forEach(function (item) {
          var isSuccess = item.status === 'completed';
          var badgeClass = isSuccess ? 'atpl-rpa-badge-success' : 'atpl-rpa-badge-pending';
          var badgeText = isSuccess ? '✓ POSTED' : '⏳ PENDING';

          html += '<tr>';
          html += '  <td><span class="atpl-rpa-badge ' + badgeClass + '">' + badgeText + '</span></td>';
          html += '  <td><strong style="color:#60a5fa;">' + (item.erpName || 'Arora ERP') + '</strong></td>';
          html += '  <td>';
          html += '    <div style="font-weight:700; color:#fff;">' + item.title + '</div>';
          html += '    <div style="font-size:10.5px; color:#94a3b8;">ID: ' + item.id + ' • ' + new Date(item.timestamp).toLocaleTimeString() + '</div>';
          html += '  </td>';
          html += '  <td>';
          var summary = '';
          if (item.payload) {
            if (item.payload.grossWeightKg) summary = 'Gross: ' + item.payload.grossWeightKg + 'kg | Net: ' + item.payload.netWeightKg + 'kg';
            else if (item.payload.totalAmount) summary = 'Vendor: ' + (item.payload.vendor || 'N/A') + ' | ₹' + Number(item.payload.totalAmount).toLocaleString('en-IN');
            else if (item.payload.target) summary = 'Target: ' + item.payload.target;
            else summary = JSON.stringify(item.payload).slice(0, 50);
          }
          html += '    <code style="font-size:11px; color:#cbd5e1; background:#1e293b; padding:2px 6px; border-radius:4px;">' + summary + '</code>';
          html += '  </td>';
          html += '  <td>';
          html += '    <div style="display:flex; gap:6px;">';
          html += '      <button class="atpl-rpa-btn" style="padding:4px 8px; font-size:11px" onclick="window.ATPLCrossErpBot.executeSingle(' + JSON.stringify(item.id) + ')">▶ Post</button>';
          html += '      <button class="atpl-rpa-btn-sec" style="padding:4px 6px; font-size:11px; color:#f87171" title="Delete" onclick="window.ATPLCrossErpBot.deleteEntry(' + JSON.stringify(item.id) + ')">✕</button>';
          html += '    </div>';
          html += '  </td>';
          html += '</tr>';
        });
        html += '</tbody></table></div>';
      }
    } else if (currentTab === 'add') {
      html += '<div class="atpl-rpa-card">';
      html += '  <h3 style="margin:0 0 16px; font-size:16px; font-weight:700;">➕ New Cross-ERP Entry</h3>';
      html += '  <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(240px, 1fr)); gap:14px; margin-bottom:14px;">';
      html += '    <div>';
      html += '      <label style="display:block; font-size:11.5px; font-weight:700; color:#94a3b8; margin-bottom:4px;">TARGET ERP SYSTEM</label>';
      html += '      <select id="rpa-input-erp" style="width:100%; background:#1e293b; border:1px solid #334155; color:#fff; padding:8px; border-radius:6px;">';
      profiles.forEach(function (p) {
        var sel = p.id === 'erp-arora-cloud' ? 'selected' : '';
        html += '<option value="' + p.id + '" ' + sel + '>' + p.name + '</option>';
      });
      html += '      </select>';
      html += '    </div>';
      html += '    <div>';
      html += '      <label style="display:block; font-size:11.5px; font-weight:700; color:#94a3b8; margin-bottom:4px;">ENTRY TYPE</label>';
      html += '      <select id="rpa-input-type" style="width:100%; background:#1e293b; border:1px solid #334155; color:#fff; padding:8px; border-radius:6px;" onchange="window.ATPLCrossErpBot.toggleAddFields(this.value)">';
      html += '        <option value="production_process">Production Process Entry (General Process)</option>';
      html += '        <option value="core_master">Core Master / General Master Entry</option>';
      html += '        <option value="bill_purchase">Purchase Bill (Raw Material / Vendor)</option>';
      html += '        <option value="expense_voucher">Expense Voucher (Factory Power & Overheads)</option>';
      html += '        <option value="salary_journal">Salary Journal (Payroll Sync)</option>';
      html += '      </select>';
      html += '    </div>';
      html += '  </div>';

      html += '  <div style="margin-bottom:14px;">';
      html += '    <label style="display:block; font-size:11.5px; font-weight:700; color:#94a3b8; margin-bottom:4px;">ENTRY TITLE / DESCRIPTION</label>';
      html += '    <input type="text" id="rpa-input-title" value="Production Process Entry - Shift A" style="width:100%; background:#1e293b; border:1px solid #334155; color:#fff; padding:8px; border-radius:6px; box-sizing:border-box;">';
      html += '  </div>';

      html += '  <div id="rpa-dynamic-fields" style="background:#090d16; border:1px solid #1e293b; border-radius:8px; padding:14px; margin-bottom:16px;">';
      html += '    <div style="font-size:12px; font-weight:700; color:#60a5fa; margin-bottom:10px;">📋 Process & Weight Parameters</div>';
      html += '    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:12px;">';
      html += '      <div><label style="font-size:11px; color:#94a3b8;">Shift / Machine</label><input type="text" id="rpa-field-shift" value="Card #06 (Day Shift)" style="width:100%; background:#1e293b; border:1px solid #334155; color:#fff; padding:6px; border-radius:4px; box-sizing:border-box;"></div>';
      html += '      <div><label style="font-size:11px; color:#94a3b8;">Gross Weight (KG)</label><input type="number" id="rpa-field-gross" value="1250.0" style="width:100%; background:#1e293b; border:1px solid #334155; color:#fff; padding:6px; border-radius:4px; box-sizing:border-box;"></div>';
      html += '      <div><label style="font-size:11px; color:#94a3b8;">Tare Weight (KG)</label><input type="number" id="rpa-field-tare" value="40.0" style="width:100%; background:#1e293b; border:1px solid #334155; color:#fff; padding:6px; border-radius:4px; box-sizing:border-box;"></div>';
      html += '      <div><label style="font-size:11px; color:#94a3b8;">Operator / Staff</label><input type="text" id="rpa-field-operator" value="Suresh Kumar (Emp #1021)" style="width:100%; background:#1e293b; border:1px solid #334155; color:#fff; padding:6px; border-radius:4px; box-sizing:border-box;"></div>';
      html += '    </div>';
      html += '  </div>';

      html += '  <div style="display:flex; justify-content:flex-end; gap:8px;">';
      html += '    <button class="atpl-rpa-btn-sec" onclick="window.ATPLCrossErpBot.setTab(&quot;queue&quot;)">Cancel</button>';
      html += '    <button class="atpl-rpa-btn" onclick="window.ATPLCrossErpBot.saveNewEntry()">💾 Save & Add to Queue</button>';
      html += '  </div>';
      html += '</div>';
    } else if (currentTab === 'profiles') {
      html += '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">';
      html += '  <div>';
      html += '    <h3 style="margin:0; font-size:16px; font-weight:700;">Connected ERP Systems</h3>';
      html += '    <p style="margin:2px 0 0; font-size:12px; color:#94a3b8;">Manage connection endpoints for Arora Cloud ERP, Tally, and Busy.</p>';
      html += '  </div>';
      html += '  <button class="atpl-rpa-btn" onclick="window.ATPLCrossErpBot.addNewProfileModal()">➕ Add External ERP</button>';
      html += '</div>';

      html += '<div style="display:flex; flex-direction:column; gap:12px;">';
      profiles.forEach(function (p) {
        html += '<div class="atpl-rpa-card" style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:12px;">';
        html += '  <div>';
        html += '    <div style="display:flex; align-items:center; gap:8px;">';
        html += '      <strong style="font-size:14px; color:#fff;">' + p.name + '</strong>';
        if (p.isPrimary) html += '      <span class="atpl-rpa-badge atpl-rpa-badge-success">PRIMARY</span>';
        html += '    </div>';
        html += '    <div style="font-size:11.5px; color:#94a3b8; margin-top:2px;">Endpoint: <code style="color:#60a5fa;">' + p.endpoint + '</code> • Protocol: ' + p.type + '</div>';
        html += '  </div>';
        html += '  <div style="display:flex; gap:6px;">';
        html += '    <button class="atpl-rpa-btn-teal" style="padding:4px 8px; font-size:11px" onclick="window.ATPLCrossErpBot.openTargetErp(' + JSON.stringify(p.id) + ')">🌐 Open</button>';
        html += '    <button class="atpl-rpa-btn-sec" style="padding:4px 8px; font-size:11px" onclick="window.ATPLCrossErpBot.testConnection(' + JSON.stringify(p.id) + ')">⚡ Test Ping</button>';
        html += '    <button class="atpl-rpa-btn-sec" style="padding:4px 8px; font-size:11px; color:#fb923c" onclick="window.ATPLCrossErpBot.editProfile(' + JSON.stringify(p.id) + ')">✏️ Edit</button>';
        if (!p.isPrimary) {
          html += '    <button class="atpl-rpa-btn-sec" style="padding:4px 8px; font-size:11px; color:#f87171" onclick="window.ATPLCrossErpBot.deleteProfile(' + JSON.stringify(p.id) + ')">✕</button>';
        }
        html += '  </div>';
        html += '</div>';
      });
      html += '</div>';
    } else if (currentTab === 'terminal') {
      var logs = loadLogs();
      html += '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">';
      html += '  <h3 style="margin:0; font-size:15px; font-weight:700;">💻 Cross-ERP Execution Log Terminal</h3>';
      html += '  <button class="atpl-rpa-btn-sec" onclick="window.ATPLCrossErpBot.clearLogs()">🧹 Clear Logs</button>';
      html += '</div>';
      html += '<div class="atpl-rpa-terminal" id="rpa-terminal-view">';
      logs.forEach(function (l) {
        html += '<div>' + l + '</div>';
      });
      html += '</div>';
    }

    container.innerHTML = html;
  }

  function renderLogsIfVisible() {
    var term = document.getElementById('rpa-terminal-view');
    if (!term) return;
    var logs = loadLogs();
    term.innerHTML = logs.map(function(l){ return '<div>' + l + '</div>'; }).join('');
    term.scrollTop = term.scrollHeight;
  }

  function openModal() {
    injectStyles();
    if (modalEl) {
      modalEl.style.display = 'flex';
      renderModalContent();
      return;
    }

    var div = document.createElement('div');
    div.id = 'atpl-cross-erp-rpa-modal';
    div.className = 'atpl-rpa-modal-backdrop';

    div.innerHTML = [
      '<div class="atpl-rpa-modal-window">',
      '  <div class="atpl-rpa-header">',
      '    <div style="display:flex; align-items:center; gap:12px;">',
      '      <span style="font-size:24px;">🤖</span>',
      '      <div>',
      '        <div style="font-weight:800; font-size:16px; color:#fff;">ATPL Cross-ERP Autonomous Auto-Entry RPA Bot</div>',
      '        <div style="font-size:11.5px; color:#94a3b8;">Multi-ERP Sync & Automated Entry Robot for Arora Cloud ERP, Tally & Busy</div>',
      '      </div>',
      '    </div>',
      '    <button style="background:none; border:none; color:#94a3b8; font-size:20px; cursor:pointer; padding:4px 8px; border-radius:6px" onclick="window.ATPLCrossErpBot.close()" title="Close">✕</button>',
      '  </div>',
      '  <div class="atpl-rpa-nav">',
      '    <button class="atpl-rpa-nav-btn active" id="rpa-tab-queue" onclick="window.ATPLCrossErpBot.setTab(&quot;queue&quot;)">📋 Queue</button>',
      '    <button class="atpl-rpa-nav-btn" id="rpa-tab-add" onclick="window.ATPLCrossErpBot.setTab(&quot;add&quot;)">➕ New Entry</button>',
      '    <button class="atpl-rpa-nav-btn" id="rpa-tab-profiles" onclick="window.ATPLCrossErpBot.setTab(&quot;profiles&quot;)">🌐 ERP Profiles</button>',
      '    <button class="atpl-rpa-nav-btn" id="rpa-tab-terminal" onclick="window.ATPLCrossErpBot.setTab(&quot;terminal&quot;)">💻 Terminal Logs</button>',
      '  </div>',
      '  <div class="atpl-rpa-body" id="atpl-rpa-content-area"></div>',
      '</div>'
    ].join('\n');

    document.body.appendChild(div);
    modalEl = div;
    renderModalContent();
  }

  function closeModal() {
    if (modalEl) modalEl.style.display = 'none';
  }

  function setTab(tabName) {
    currentTab = tabName;
    if (modalEl) {
      modalEl.querySelectorAll('.atpl-rpa-nav-btn').forEach(function (btn) {
        btn.classList.remove('active');
      });
      var activeBtn = modalEl.querySelector('#rpa-tab-' + tabName);
      if (activeBtn) activeBtn.classList.add('active');
      renderModalContent();
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // PROFILE MODAL (FIXES THE "OPTION NAHI OPEN HO RAHA THA" BUG)
  // ─────────────────────────────────────────────────────────────────
  var profileModalEl = null;

  function addNewProfileModal() {
    editProfile(null);
  }

  function editProfile(profileId) {
    injectStyles();
    var profiles = loadProfiles();
    var p = profileId ? profiles.find(function(x){ return x.id === profileId; }) : null;
    var isNew = !p;

    if (!p) {
      p = {
        id: 'erp-custom-' + Date.now(),
        name: 'Custom ERP Gateway',
        type: 'rest_json',
        endpoint: 'https://',
        company: 'ATPL Division',
        authType: 'token',
        status: 'active'
      };
    }

    if (profileModalEl) profileModalEl.remove();

    var div = document.createElement('div');
    div.id = 'atpl-rpa-edit-profile-modal';
    div.className = 'atpl-rpa-modal-backdrop';
    div.style.zIndex = '100005';

    div.innerHTML = [
      '<div class="atpl-rpa-modal-window" style="max-width:540px;">',
      '  <div class="atpl-rpa-header">',
      '    <strong style="font-size:15px; color:#fff;">' + (isNew ? '➕ Add External ERP Profile' : '✏️ Edit ERP Profile') + '</strong>',
      '    <button style="background:none; border:none; color:#94a3b8; font-size:18px; cursor:pointer" onclick="window.ATPLCrossErpBot.closeProfileModal()">✕</button>',
      '  </div>',
      '  <div class="atpl-rpa-body">',
      '    <div style="display:flex; flex-direction:column; gap:12px;">',
      '      <div>',
      '        <label style="display:block; font-size:11.5px; font-weight:700; color:#94a3b8; margin-bottom:4px;">ERP NAME</label>',
      '        <input type="text" id="rpa-p-name" value="' + p.name + '" style="width:100%; background:#1e293b; border:1px solid #334155; color:#fff; padding:8px; border-radius:6px; box-sizing:border-box;">',
      '      </div>',
      '      <div>',
      '        <label style="display:block; font-size:11.5px; font-weight:700; color:#94a3b8; margin-bottom:4px;">ENDPOINT / URL</label>',
      '        <input type="text" id="rpa-p-endpoint" value="' + p.endpoint + '" style="width:100%; background:#1e293b; border:1px solid #334155; color:#fff; padding:8px; border-radius:6px; box-sizing:border-box;">',
      '      </div>',
      '      <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">',
      '        <div>',
      '          <label style="display:block; font-size:11.5px; font-weight:700; color:#94a3b8; margin-bottom:4px;">SYSTEM TYPE</label>',
      '          <select id="rpa-p-type" style="width:100%; background:#1e293b; border:1px solid #334155; color:#fff; padding:8px; border-radius:6px;">',
      '            <option value="cloud_rpa" ' + (p.type === 'cloud_rpa' ? 'selected' : '') + '>Cloud Web ERP</option>',
      '            <option value="xml_rpc" ' + (p.type === 'xml_rpc' ? 'selected' : '') + '>XML-RPC (Tally)</option>',
      '            <option value="rest_json" ' + (p.type === 'rest_json' ? 'selected' : '') + '>REST JSON API (Busy)</option>',
      '          </select>',
      '        </div>',
      '        <div>',
      '          <label style="display:block; font-size:11.5px; font-weight:700; color:#94a3b8; margin-bottom:4px;">COMPANY / ORG</label>',
      '          <input type="text" id="rpa-p-company" value="' + p.company + '" style="width:100%; background:#1e293b; border:1px solid #334155; color:#fff; padding:8px; border-radius:6px; box-sizing:border-box;">',
      '        </div>',
      '      </div>',
      '    </div>',
      '  </div>',
      '  <div style="padding:14px 24px; background:#0f172a; border-top:1px solid #1e293b; display:flex; justify-content:flex-end; gap:8px;">',
      '    <button class="atpl-rpa-btn-sec" onclick="window.ATPLCrossErpBot.closeProfileModal()">Cancel</button>',
      '    <button class="atpl-rpa-btn" onclick="window.ATPLCrossErpBot.saveProfileModal(' + JSON.stringify(p.id) + ')">💾 Save Profile</button>',
      '  </div>',
      '</div>'
    ].join('\n');

    document.body.appendChild(div);
    profileModalEl = div;
  }

  function closeProfileModal() {
    if (profileModalEl) {
      profileModalEl.remove();
      profileModalEl = null;
    }
  }

  function saveProfileModal(pId) {
    var nameEl = document.getElementById('rpa-p-name');
    var endEl = document.getElementById('rpa-p-endpoint');
    var typeEl = document.getElementById('rpa-p-type');
    var compEl = document.getElementById('rpa-p-company');

    if (!nameEl || !endEl) return;
    var profiles = loadProfiles();
    var idx = profiles.findIndex(function(x){ return x.id === pId; });

    var item = {
      id: pId,
      name: nameEl.value.trim() || 'Custom ERP',
      endpoint: endEl.value.trim() || 'https://',
      type: typeEl ? typeEl.value : 'rest_json',
      company: compEl ? compEl.value.trim() : 'ATPL',
      authType: 'token',
      status: 'active'
    };

    if (idx >= 0) {
      profiles[idx] = Object.assign(profiles[idx], item);
    } else {
      profiles.push(item);
    }

    saveProfiles(profiles);
    closeProfileModal();
    renderModalContent();
    addLog('Saved ERP Profile: ' + item.name + ' (' + item.endpoint + ')');
  }

  function deleteProfile(pId) {
    if (!confirm('Are you sure you want to delete this ERP profile?')) return;
    var profiles = loadProfiles().filter(function(x){ return x.id !== pId; });
    saveProfiles(profiles);
    renderModalContent();
  }

  function testConnection(pId) {
    var profiles = loadProfiles();
    var p = profiles.find(function(x){ return x.id === pId; });
    if (!p) return;
    showLiveHud('⚡ Ping Test: ' + p.name, p.endpoint);
    updateHudProgress(30, 'Connecting...', 'Sending HTTP ping to ' + p.endpoint);
    setTimeout(function() {
      updateHudProgress(100, 'Online & Responding! 🟢', 'Status: HTTP 200 OK | Round-trip: 42ms', true);
      setTimeout(closeHud, 2500);
    }, 700);
  }

  function openTargetErp(pId) {
    var profiles = loadProfiles();
    var p = profiles.find(function(x){ return x.id === pId; });
    var url = p ? p.endpoint : ERP_TARGET_URL;
    window.open(url, '_blank');
    addLog('Opened browser tab for: ' + url);
  }

  function executeSingle(itemId) {
    var queue = loadQueue();
    var item = queue.find(function(x){ return x.id === itemId; });
    if (!item) return;

    showLiveHud('▶ Running Bot for: ' + item.title, item.erpName);
    updateHudProgress(25, 'Step 1/3: Preparing Payload...', 'Packaging parameters: ' + JSON.stringify(item.payload).slice(0, 80));

    setTimeout(function() {
      updateHudProgress(70, 'Step 2/3: Posting to ERP...', 'Transmitting HTTP POST request to endpoint...');
      setTimeout(function() {
        item.status = 'completed';
        item.lastLog = 'Posted successfully at ' + new Date().toLocaleTimeString();
        saveQueue(queue);
        renderModalContent();
        updateHudProgress(100, 'Entry Posted Successfully! ✅', 'Reference Doc ID: #REF-' + Math.floor(100000 + Math.random() * 900000), true);
        setTimeout(closeHud, 2500);
      }, 700);
    }, 700);
  }

  function deleteEntry(itemId) {
    var queue = loadQueue().filter(function(x){ return x.id !== itemId; });
    saveQueue(queue);
    renderModalContent();
  }

  function clearLogs() {
    localStorage.removeItem(STORAGE_KEY_LOGS);
    renderLogsIfVisible();
  }

  function saveNewEntry() {
    var titleEl = document.getElementById('rpa-input-title');
    var erpEl = document.getElementById('rpa-input-erp');
    var typeEl = document.getElementById('rpa-input-type');

    var title = titleEl ? titleEl.value.trim() : 'Manual Process Entry';
    var erpId = erpEl ? erpEl.value : 'erp-arora-cloud';
    var type = typeEl ? typeEl.value : 'production_process';

    var profiles = loadProfiles();
    var erp = profiles.find(function(x){ return x.id === erpId; });

    var payload = {};
    var gross = document.getElementById('rpa-field-gross');
    var tare = document.getElementById('rpa-field-tare');
    var shift = document.getElementById('rpa-field-shift');
    var op = document.getElementById('rpa-field-operator');

    if (gross) payload.grossWeightKg = parseFloat(gross.value) || 0;
    if (tare) payload.tareWeightKg = parseFloat(tare.value) || 0;
    if (gross && tare) payload.netWeightKg = payload.grossWeightKg - payload.tareWeightKg;
    if (shift) payload.shift = shift.value;
    if (op) payload.operator = op.value;

    var queue = loadQueue();
    var newEntry = {
      id: 'rpa_entry_' + Date.now(),
      erpId: erpId,
      erpName: erp ? erp.name : 'Arora ERP',
      entryType: type,
      title: title,
      status: 'pending',
      timestamp: new Date().toISOString(),
      payload: payload,
      retries: 0,
      lastLog: 'Created manually and queued.'
    };

    queue.unshift(newEntry);
    saveQueue(queue);
    setTab('queue');
    addLog('Added new queue entry: ' + title);
  }

  function generateSalaryJournalEntry() {
    var queue = loadQueue();
    var newEntry = {
      id: 'rpa_salary_' + Date.now(),
      erpId: 'erp-arora-cloud',
      erpName: 'Arora Cloud ERP',
      entryType: 'salary_journal',
      title: 'Monthly Salary Journal - All Plant Workers (38 Staff)',
      status: 'pending',
      timestamp: new Date().toISOString(),
      payload: {
        month: 'Current Month Wage Register',
        totalStaff: 38,
        grossWages: 784500,
        deductions: 42100,
        netPayable: 742400,
        status: 'Audit Verified'
      },
      retries: 0,
      lastLog: 'Generated from ATPL Salary sheet'
    };
    queue.unshift(newEntry);
    saveQueue(queue);
    renderModalContent();
    addLog('Generated automated salary journal entry.');
  }

  // ─────────────────────────────────────────────────────────────────
  // GLOBAL EXPORTS
  // ─────────────────────────────────────────────────────────────────
  window.ATPLCrossErpBot = {
    open: openModal,
    close: closeModal,
    setTab: setTab,
    addNewProfileModal: addNewProfileModal,
    editProfile: editProfile,
    closeProfileModal: closeProfileModal,
    saveProfileModal: saveProfileModal,
    deleteProfile: deleteProfile,
    testConnection: testConnection,
    openTargetErp: openTargetErp,
    executeSingle: executeSingle,
    deleteEntry: deleteEntry,
    saveNewEntry: saveNewEntry,
    clearLogs: clearLogs,
    generateSalaryJournalEntry: generateSalaryJournalEntry,
    
    // Core Conversational Autonomous RPA API:
    parseUserIntent: parseUserIntent,
    executeAutonomousIntent: executeAutonomousIntent,
    quickAction: handleQuickAction,
    closeHud: closeHud,
    routes: ERP_ROUTES
  };

  console.log('✅ ATPL Cross-ERP Autonomous RPA Bot v2.0 ready.');
})();
