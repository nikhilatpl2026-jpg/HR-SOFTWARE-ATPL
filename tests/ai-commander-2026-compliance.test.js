const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('Arora AI Commander 2026 Compliance Brain & Mini Fix Box', async (t) => {
  const rootDir = path.join(__dirname, '..');
  const aiCode = fs.readFileSync(path.join(rootDir, 'arora-ai-commander-v10.js'), 'utf8');

  function makeHarness(rows, monthKey = '2026-11') {
    const els = {};
    function makeEl(tag, id) {
      const classes = new Set();
      const children = [];
      return {
        children,
        tagName: String(tag || 'div').toUpperCase(),
        id: id || '',
        style: {},
        value: '',
        scrollHeight: 40,
        scrollTop: 0,
        _html: '',
        textContent: '',
        innerText: '',
        setAttribute() {},
        addEventListener() {},
        focus() {},
        remove() {},
        classList: {
          toggle(c, force) {
            if (force === undefined) { if (classes.has(c)) { classes.delete(c); return false; } classes.add(c); return true; }
            if (force) classes.add(c); else classes.delete(c);
            return !!force;
          },
          add(c) { classes.add(c); },
          remove(c) { classes.delete(c); },
          contains(c) { return classes.has(c); }
        },
        appendChild(ch) {
          children.push(ch);
          if (ch && ch.id) els[ch.id] = ch;
        },
        get innerHTML() { return this._html; },
        set innerHTML(v) {
          this._html = String(v || '');
          const idMatches = this._html.matchAll(/id="([^"]+)"/g);
          for (const m of idMatches) {
            if (!els[m[1]]) els[m[1]] = makeEl('div', m[1]);
          }
          const valMatches = this._html.matchAll(/id="([^"]+)"[^>]*value="([^"]*)"/g);
          for (const m of valMatches) {
            if (els[m[1]]) els[m[1]].value = m[2];
          }
          const selMatches = this._html.matchAll(/<select id="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g);
          for (const m of selMatches) {
            const optSel = m[2].match(/value="([^"]*)" selected/);
            if (els[m[1]]) els[m[1]].value = optSel ? optSel[1] : '';
          }
        }
      };
    }

    const appliedFixes = [];
    els.aiChatBtn = makeEl('div', 'aiChatBtn');
    const sandbox = {
      console, Math, Date, JSON, Number, String, Array, Object, Boolean, RegExp, parseInt, parseFloat, isNaN,
      setTimeout: (fn) => { fn(); return 1; },
      clearTimeout: () => {},
      navigator: { clipboard: { writeText: async () => {} } },
      ATPLComplianceBridge: {
        getActiveSheetSnapshot: () => ({
          id: monthKey,
          month: monthKey,
          monthLabel: monthKey,
          rowsCount: rows.length,
          rows
        }),
        getRow: (uid) => rows.find((r) => r.uid === uid || r.empId === uid) || null,
        applyFix: (uid, patch) => {
          appliedFixes.push({ uid, patch });
          const target = rows.find((r) => r.uid === uid || r.empId === uid);
          Object.assign(target, patch);
          target.pfEmployee = patch.pfMode === 'NONE' ? 0 : Math.round((target.earnBasic || target.basic || 0) * 0.12);
          target.netPayable = Math.round((target.totalGross || 10000) - target.pfEmployee - (target.esiEmployee || 0) - (target.advance || 0));
          return { ok: true, row: Object.assign({}, target) };
        },
        openRowInspector: () => true
      },
      document: {
        readyState: 'complete',
        head: makeEl('head'),
        body: makeEl('body'),
        createElement: (t) => makeEl(t),
        getElementById: (id) => els[id] || null,
        addEventListener: () => {}
      },
      addEventListener: () => {}
    };
    sandbox.window = sandbox;
    vm.runInNewContext(aiCode, sandbox);
    return { sandbox, els, appliedFixes };
  }

  function collectHtml(node) {
    if (!node) return '';
    let out = node._html || '';
    if (Array.isArray(node.children)) {
      for (const c of node.children) out += collectHtml(c);
    }
    return out;
  }

  await t.test('1. Latest 2026 PF ₹25,000 ceiling and Labour Codes rules are reflected in AI responses', () => {
    const { sandbox, els } = makeHarness([]);
    sandbox.AroraAICommander.open();
    let lastBotHtml = '';
    const origAppend = els.atplAiMessages.appendChild;
    els.atplAiMessages.appendChild = function (ch) {
      origAppend.call(this, ch);
      if (ch && ch.className && ch.className.includes('bot')) {
        lastBotHtml = collectHtml(ch);
      }
    };

    sandbox.AroraAICommander.sendQuery('PF ceiling rule kya hai?');
    assert.ok(lastBotHtml.includes('25,000'), 'PF response must state ₹25,000 ceiling');
    assert.ok(lastBotHtml.includes('3,000'), 'PF response must state ₹3,000 max employee share');

    sandbox.AroraAICommander.sendQuery('new labour code 50% rule batao');
    assert.ok(lastBotHtml.includes('50%'), 'Labour Code response must cover 50% rule');
    assert.ok(lastBotHtml.includes('2 working days'), 'Labour Code response must mention 2 working days F&F rule');

    sandbox.AroraAICommander.sendQuery('ESIC rule kya hai?');
    assert.ok(lastBotHtml.includes('21,000'), 'ESIC response must state ₹21,000 ceiling');
    assert.ok(lastBotHtml.includes('176'), 'ESIC response must state ₹176 daily wage exemption');
  });

  await t.test('2. Live Auditor Brain catches PF/ESIC ID traps, 25k cap, Days vs OT trap, 50% deduction & peer outliers, and Mini Fix Box applies changes', () => {
    const sampleRows = [
      { uid: 'u1', empId: '25191', name: 'UMMAID SINGH', department: 'FELTING', paidDays: 26, workingDays: 22, overtimeHours: 4, basic: 12000, gross: 15000, earnBasic: 12000, totalGross: 16500, pfNo: 'NA', esiNo: 'ESI101', pfEmployee: 1440, esiEmployee: 124, totalDeduction: 1564, netPayable: 14936, pfMode: 'FULL_12', esiMode: 'TOTAL_GROSS' },
      { uid: 'u2', empId: '25202', name: 'RAJU SHARMA', department: 'FELTING', paidDays: 4, workingDays: 3, overtimeHours: 32, basic: 14000, gross: 16000, earnBasic: 2000, totalGross: 6000, pfNo: 'PF202', esiNo: 'ESI202', pfEmployee: 240, esiEmployee: 45, totalDeduction: 3500, netPayable: 2500, advance: 3215, pfMode: 'FULL_12', esiMode: 'TOTAL_GROSS' },
      { uid: 'u3', empId: '25303', name: 'MANOJ VERMA', department: 'FELTING', paidDays: 26, workingDays: 24, overtimeHours: 6, basic: 22000, gross: 24000, earnBasic: 22000, totalGross: 25500, pfNo: 'PF303', esiNo: 'NA', pfEmployee: 1800, esiEmployee: 0, totalDeduction: 1800, netPayable: 23700, pfMode: 'CAP_15000', esiMode: 'NONE' },
      { uid: 'u4', empId: '25404', name: 'SURESH KUMAR', department: 'FELTING', paidDays: 26, workingDays: 24, overtimeHours: 4, basic: 15000, gross: 18000, earnBasic: 15000, totalGross: 19000, pfNo: 'PF404', esiNo: 'ESI404', pfEmployee: 1800, esiEmployee: 143, totalDeduction: 1943, netPayable: 17057, pfMode: 'FULL_12', esiMode: 'TOTAL_GROSS' }
    ];

    const { sandbox, els, appliedFixes } = makeHarness(sampleRows, '2026-11');
    let lastHtml = '';
    sandbox.AroraAICommander.open();
    const origAppend = els.atplAiMessages.appendChild;
    els.atplAiMessages.appendChild = function (ch) {
      origAppend.call(this, ch);
      if (ch && ch.className && ch.className.includes('bot')) {
        lastHtml = collectHtml(ch);
      }
    };

    sandbox.AroraAICommander.sendQuery('Mam compliance audit karo');
    assert.ok(lastHtml.includes('25191'), 'Audit output must flag 25191 PF without ID');
    assert.ok(lastHtml.includes('25202'), 'Audit output must flag 25202 Days vs OT & 50% deduction');
    assert.ok(lastHtml.includes('25303'), 'Audit output must flag 25303 old 15k PF ceiling');
    assert.ok(lastHtml.includes('25,000'), 'Audit output must mention ₹25,000 PF cap');
    assert.ok(lastHtml.includes('Accept &amp; Fix'), 'Audit output must render Accept & Fix buttons');
    // Check that findings were populated in Mini Fix Box registry
    // Open fix box for first finding (PF without ID for 25191)
    assert.ok(els.aiMiniFixBox, 'aiMiniFixBox must exist in dialog');
    // Verify cf_0_25191 was registered and opens cleanly
    sandbox.AroraAICommander.openComplianceFixBox('cf_0_25191');
    assert.equal(els.aiMiniFixBox.style.display, 'block');
    assert.ok(els.aiMiniFixBox.innerHTML.includes('25191'));
    assert.equal(els.aiFixPfMode.value, 'NONE');

    // Apply fix and confirm ATPLComplianceBridge.applyFix runs cleanly
    sandbox.AroraAICommander.applyComplianceFixBox();
    assert.equal(appliedFixes.length, 1);
    assert.equal(appliedFixes[0].uid, 'u1');
    assert.equal(appliedFixes[0].patch.pfMode, 'NONE');
    assert.equal(els.aiMiniFixBox.style.display, 'none');

    // Also verify Days-vs-OT finding (cf_1_25202) and 25k cap finding exist
    sandbox.AroraAICommander.openComplianceFixBox('cf_1_25202');
    assert.equal(els.aiMiniFixBox.style.display, 'block');
    assert.ok(els.aiMiniFixBox.innerHTML.includes('25202'));
  });
});
