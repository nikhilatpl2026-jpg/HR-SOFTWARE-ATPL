'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

function mkStorage(init) {
  const m = new Map(Object.entries(init || {}));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k)
  };
}

function makeFakeSidebarEl(id, labelParts, opts) {
  opts = opts || {};
  const classes = new Set(opts.classes || ['vitem']);
  const makeNode = (cls, txt) => ({ className: cls, textContent: txt, parentNode: null });
  const children = labelParts.map((p) => (typeof p === 'string' ? { textContent: p, isText: true } : makeNode(p.cls, p.text)));
  const el = {
    id: 'vn-' + id,
    hidden: !!opts.hidden,
    style: { display: opts.display || '' },
    classList: {
      contains: (c) => classes.has(c),
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c)
    },
    getAttribute: (k) => (k === 'aria-hidden' && opts.ariaHidden ? 'true' : null),
    get textContent() {
      return children.map((c) => c.textContent).join('');
    },
    cloneNode: () => {
      let cloned = children.map((c) => ({ className: c.className || '', textContent: c.textContent }));
      const wrapper = {
        querySelectorAll: (sel) => {
          const toks = sel.split(',').map((s) => s.trim());
          return cloned.filter((n) =>
            toks.some((t) => {
              if (t === '[class*="badge"]') return /badge/i.test(n.className);
              if (t.startsWith('.')) return n.className.split(/\s+/).includes(t.slice(1));
              return false;
            })
          ).map((n) => ({
            parentNode: {
              removeChild: () => {
                cloned = cloned.filter((x) => x !== n);
              }
            }
          }));
        },
        get textContent() {
          return cloned.map((c) => c.textContent).join('');
        }
      };
      return wrapper;
    }
  };
  return el;
}

function bootGuard(opts) {
  opts = opts || {};
  const sess = mkStorage(opts.session || {});
  const local = mkStorage(opts.local || {});
  const sidebarEls = opts.sidebarEls || [];
  const docListeners = {};
  const doc = {
    readyState: 'complete',
    querySelectorAll: (sel) => {
      if (sel === '.vitem[id^="vn-"]') return sidebarEls;
      return [];
    },
    querySelector: () => null,
    getElementById: () => null,
    createElement: () => ({ id: '', textContent: '' }),
    head: { appendChild: () => {} },
    documentElement: { appendChild: () => {} },
    addEventListener: (ev, fn) => {
      docListeners[ev] = docListeners[ev] || [];
      docListeners[ev].push(fn);
    },
    dispatchEvent: () => {}
  };
  const win = {
    sessionStorage: sess,
    localStorage: local,
    document: doc,
    setTimeout: () => 1,
    getComputedStyle: (el) => ({ display: (el.style && el.style.display) || 'flex' }),
    CustomEvent: function (t, o) { this.type = t; this.detail = o && o.detail; },
    MutationObserver: function () { this.observe = () => {}; },
    ATPLSharedActivityV2: opts.activity || null,
    showToast: opts.onToast || null
  };
  win.window = win;
  vm.runInNewContext(read('erp-permission-guard-v1.js'), Object.assign(win, { window: win }));
  return { win, docListeners };
}

test('auto feature discovery extracts clean names without truncating AI/Bank/Date/Employee or keeping badges/hidden items', () => {
  const sidebarEls = [
    makeFakeSidebarEl('ai-commander', [{ cls: 'vi', text: '🤖' }, 'AI Commander (v10)']),
    makeFakeSidebarEl('files', [{ cls: 'vi', text: '📂' }, 'All Files']),
    makeFakeSidebarEl('test', [{ cls: 'vi', text: '🧪' }, 'Test Feature'], { display: 'none' }),
    makeFakeSidebarEl('audit', [{ cls: 'vi', text: '🔍' }, 'Salary Audit ', { cls: 'vbadge', text: '0' }]),
    makeFakeSidebarEl('challan', [{ cls: 'vi', text: '🏛️' }, 'PF & ESIC Challan ', { cls: 'vbadge', text: 'NEW' }]),
    makeFakeSidebarEl('bankverify', [{ cls: 'vi', text: '🏦' }, 'Bank A/C Verifier']),
    makeFakeSidebarEl('dol', [{ cls: 'vi', text: '📅' }, 'Date of Leaving']),
    makeFakeSidebarEl('empmaster', [{ cls: 'vi', text: '🗂️' }, 'Employee Master ', { cls: 'vbadge', text: '496' }]),
    makeFakeSidebarEl('hrdocs', [{ cls: 'vi', text: '📚' }, 'HR Documents ', { cls: 'vbadge', text: '2' }]),
    makeFakeSidebarEl('esictodol', [{ cls: 'vi', text: '🩺' }, 'ESIC → DOL']),
    makeFakeSidebarEl('newmod', [{ cls: 'vi', text: '✨' }, 'Overtime Tracker'])
  ];

  const { win } = bootGuard({ sidebarEls });
  const feats = win.ATPLPermissionGuard.liveFeatures(false);
  const byId = Object.fromEntries(feats.map((f) => [f.id, f.name]));

  assert.equal(byId['ai-commander'], 'AI Commander (v10)');
  assert.equal(byId.files, 'All Files');
  assert.equal(byId.test, undefined, 'hidden Test Feature must automatically disappear');
  assert.equal(byId.audit, 'Salary Audit');
  assert.equal(byId.challan, 'PF & ESIC Challan');
  assert.equal(byId.bankverify, 'Bank A/C Verifier');
  assert.equal(byId.dol, 'Date of Leaving');
  assert.equal(byId.empmaster, 'Employee Master');
  assert.equal(byId.hrdocs, 'HR Documents');
  assert.equal(byId.esictodol, 'ESIC → DOL');
  assert.equal(byId.newmod, 'Overtime Tracker', 'newly mounted sidebar feature must automatically appear');
});

test('action rights encode into access array cleanly and restrict Upload/Edit/Delete while allowing View/Export', () => {
  const logs = [];
  const toasts = [];
  const encodedAccess = (() => {
    const { win } = bootGuard();
    return win.ATPLPermissionGuard.buildAccessList(['empmaster', 'hrdocs'], {
      view: true,
      upload: true,
      edit: false,
      delete: false
    });
  })();

  assert.ok(encodedAccess.includes('empmaster'));
  assert.ok(encodedAccess.includes('__right_mode:v1'));
  assert.ok(encodedAccess.includes('__act:upload'));
  assert.equal(encodedAccess.includes('__act:edit'), false);
  assert.equal(encodedAccess.includes('__act:delete'), false);

  const { win, docListeners } = bootGuard({
    session: { ATPL_UserSession_V5: JSON.stringify({ id: 'ram01' }) },
    local: { ATPL_UserAccess_V1: JSON.stringify([{ id: 'ram01', name: 'Ram', admin: false, access: encodedAccess }]) },
    activity: { log: (t, p, a, m) => logs.push({ t, p, a, m }) },
    onToast: (m) => toasts.push(m)
  });

  const g = win.ATPLPermissionGuard;
  assert.equal(g.featureIdsOnly(encodedAccess).join(','), 'empmaster,hrdocs');
  assert.equal(g.canPerform('view'), true);
  assert.equal(g.canPerform('upload'), true);
  assert.equal(g.canPerform('edit'), false);
  assert.equal(g.canPerform('delete'), false);

  function mkBtn(text, extra) {
    extra = extra || {};
    const btn = {
      tagName: 'BUTTON',
      textContent: text,
      id: extra.id || '',
      value: '',
      classList: { contains: () => false },
      hasAttribute: (k) => !!extra[k],
      getAttribute: (k) => extra[k] || null,
      closest: (sel) => {
        if (sel.includes('#uaLogin')) return null;
        if (sel.includes('[id^="page-"]')) return { id: 'page-empmaster' };
        if (sel.includes('button')) return btn;
        return null;
      }
    };
    return btn;
  }

  // Delete click must be blocked & logged
  let prevented = false, stopped = false;
  docListeners.click.forEach((fn) => fn({
    target: mkBtn('🗑 Delete Employee', { 'data-del': '1' }),
    preventDefault: () => { prevented = true; },
    stopPropagation: () => { stopped = true; },
    stopImmediatePropagation: () => {}
  }));
  assert.equal(prevented, true);
  assert.equal(stopped, true);
  assert.equal(logs[0].t, 'blocked_delete');
  assert.ok(toasts[0].includes('Delete'));

  // Edit click must be blocked
  let editBlocked = false;
  docListeners.click.forEach((fn) => fn({
    target: mkBtn('✏ Save Changes', { 'data-edit': '1' }),
    preventDefault: () => { editBlocked = true; },
    stopPropagation: () => {},
    stopImmediatePropagation: () => {}
  }));
  assert.equal(editBlocked, true);
  assert.equal(logs[1].t, 'blocked_edit');

  // Upload & Download clicks must remain allowed
  let uploadBlocked = false, downloadBlocked = false;
  docListeners.click.forEach((fn) => fn({
    target: mkBtn('⬆ Upload Challan', { 'data-upload': '1' }),
    preventDefault: () => { uploadBlocked = true; },
    stopPropagation: () => {},
    stopImmediatePropagation: () => {}
  }));
  docListeners.click.forEach((fn) => fn({
    target: mkBtn('Download Excel'),
    preventDefault: () => { downloadBlocked = true; },
    stopPropagation: () => {},
    stopImmediatePropagation: () => {}
  }));
  assert.equal(uploadBlocked, false);
  assert.equal(downloadBlocked, false);
});


test("broker routes auth/users to AKfycby99 and Drive/Master to ATPL_GAS_URL, and non-admin restricted login never grants all features", async () => {
  const fetchCalls = [];
  const storage = (init = {}) => {
    const m = new Map(Object.entries(init));
    return {
      getItem: k => (m.has(k) ? m.get(k) : null),
      setItem: (k, v) => m.set(k, String(v)),
      removeItem: k => m.delete(k)
    };
  };
  function makeEl(id, extra = {}) {
    const classes = new Set(extra.classes || []);
    const attrs = new Map(Object.entries(extra.attrs || {}));
    const listeners = {};
    const el = {
      id,
      tagName: extra.tagName || "DIV",
      type: extra.type || "",
      hidden: false,
      disabled: false,
      value: extra.value || "",
      textContent: extra.textContent || id,
      innerHTML: "",
      dataset: {},
      children: [],
      classList: {
        add: (...a) => a.forEach(x => classes.add(x)),
        remove: (...a) => a.forEach(x => classes.delete(x)),
        contains: x => classes.has(x),
        toggle: (x, f) => (f === undefined ? (classes.has(x) ? classes.delete(x) : classes.add(x)) : (f ? classes.add(x) : classes.delete(x)))
      },
      style: {
        _map: {},
        setProperty: (k, v) => { el.style._map[k] = v; el.style[k] = v; },
        removeProperty: k => { delete el.style._map[k]; delete el.style[k]; }
      },
      setAttribute: (k, v) => attrs.set(k, String(v)),
      getAttribute: k => (attrs.has(k) ? attrs.get(k) : null),
      removeAttribute: k => attrs.delete(k),
      hasAttribute: k => attrs.has(k),
      addEventListener: (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); },
      appendChild: ch => { el.children.push(ch); return ch; },
      remove: () => {},
      querySelectorAll: () => [],
      closest: () => null,
      cloneNode: () => makeEl(id, extra)
    };
    return el;
  }

  const vnAudit = makeEl("vn-audit", { classes: ["vitem"], textContent: "Salary Audit" });
  const vnEmp = makeEl("vn-empmaster", { classes: ["vitem"], textContent: "Employee Master" });
  const vnDol = makeEl("vn-dol", { classes: ["vitem"], textContent: "Date of Leaving" });
  const vnCmd = makeEl("vn-cmd", { classes: ["vitem"], textContent: "Smart Commands" });
  const vnUa = makeEl("vn-useraccess", { classes: ["vitem"], textContent: "User Access" });
  const pgAudit = makeEl("page-audit", { classes: ["page"] });
  const pgEmp = makeEl("page-empmaster", { classes: ["page"] });
  const pgDol = makeEl("page-dol", { classes: ["page"] });
  const pgCmd = makeEl("page-cmd", { classes: ["page"] });
  const grpDash = makeEl("grp-dash", { classes: ["vnav-group"] });
  grpDash.querySelectorAll = sel => (sel.includes(".vitem") ? [vnCmd] : []);
  const grpSal = makeEl("grp-sal", { classes: ["vnav-group"] });
  grpSal.querySelectorAll = sel => (sel.includes(".vitem") ? [vnAudit] : []);
  const grpEmp = makeEl("grp-emp", { classes: ["vnav-group"] });
  grpEmp.querySelectorAll = sel => (sel.includes(".vitem") ? [vnEmp, vnDol, vnUa] : []);

  const byId = {
    "vn-audit": vnAudit, "vn-empmaster": vnEmp, "vn-dol": vnDol, "vn-cmd": vnCmd, "vn-useraccess": vnUa,
    "page-audit": pgAudit, "page-empmaster": pgEmp, "page-dol": pgDol, "page-cmd": pgCmd,
    uaLoginId: makeEl("uaLoginId", { value: "1234" }),
    uaLoginPass: makeEl("uaLoginPass", { value: "pass123" }),
    uaLoginBtn: makeEl("uaLoginBtn", { tagName: "BUTTON" }),
    uaLoginErr: makeEl("uaLoginErr"),
    uaLogin: makeEl("uaLogin"),
    landingPage: makeEl("landingPage"),
    uaWho: makeEl("uaWho"),
    uaLogoutBtn: makeEl("uaLogoutBtn")
  };

  const docListeners = {};
  const win = {
    ATPL_GAS_URL: "https://script.google.com/macros/s/AKfycbxiaKVtVJUWqDPtI-9iecG0LE817SfbbQNfUaZouw8sgYr3f1zRffutMu_UGnV-vqy-oA/exec",
    location: { hostname: "nikhilatpl2026-jpg.github.io" },
    innerWidth: 1280,
    localStorage: storage(),
    sessionStorage: storage(),
    navigator: { onLine: true },
    CustomEvent: function (t, o) { this.type = t; this.detail = o && o.detail; },
    AbortController: globalThis.AbortController,
    setTimeout: fn => { return 0; },
    clearTimeout: () => {},
    addEventListener: () => {},
    alert: () => {},
    goPage: p => { byId._lastPage = p; },
    fetch: async url => {
      fetchCalls.push(url);
      if (url.includes("action=login")) {
        const u = new URL(url);
        const uid = u.searchParams.get("user_id");
        return {
          ok: true,
          text: async () => JSON.stringify({
            ok: true,
            token: "ATPL_CLOUD_SECURE_TOKEN_test123",
            user: { id: uid, name: "Worker 1234", admin: false, access: ["audit", "empmaster", "__right_mode:v1", "__act:view"] }
          })
        };
      }
      return { ok: true, text: async () => JSON.stringify({ ok: true, records: [] }) };
    },
    document: {
      readyState: "complete",
      head: { appendChild: () => {} },
      documentElement: { appendChild: () => {} },
      body: makeEl("body"),
      getElementById: id => byId[id] || null,
      createElement: tag => makeEl("dyn", { tagName: tag.toUpperCase() }),
      dispatchEvent: () => {},
      addEventListener: (ev, fn) => { (docListeners[ev] = docListeners[ev] || []).push(fn); },
      querySelector: () => null,
      querySelectorAll: sel => {
        if (sel.includes(".vitem")) return [vnCmd, vnAudit, vnEmp, vnDol, vnUa];
        if (sel.includes("[id^=\"page-\"]")) return [pgCmd, pgAudit, pgEmp, pgDol];
        if (sel.includes(".vnav-group")) return [grpDash, grpSal, grpEmp];
        return [];
      }
    }
  };
  win.window = win;
  win.self = win;

  const ctx = vm.createContext(win);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "erp-cloud-api-broker-v1.js"), "utf8"), ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "erp-mobile-shared-hardfix-v1.js"), "utf8"), ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "erp-permission-guard-v1.js"), "utf8"), ctx);

  // 1. Broker URL routing assertions
  assert.ok(win.ATPLCloudAPI.urlForAction("login").includes("AKfycby99_893hVtbWOQr67ikxIwiq81MWW8JAa2LuxTu67JBxjQ_iWb-YkqhBmW0RrHU512SQ"));
  assert.ok(win.ATPLCloudAPI.urlForAction("saveUser").includes("AKfycby99_893hVtbWOQr67ikxIwiq81MWW8JAa2LuxTu67JBxjQ_iWb-YkqhBmW0RrHU512SQ"));
  assert.ok(win.ATPLCloudAPI.urlForAction("listUsers").includes("AKfycby99_893hVtbWOQr67ikxIwiq81MWW8JAa2LuxTu67JBxjQ_iWb-YkqhBmW0RrHU512SQ"));
  assert.ok(win.ATPLCloudAPI.urlForAction("getEmployeeMaster").includes("AKfycbxiaKVtVJUWqDPtI-9iecG0LE817SfbbQNfUaZouw8sgYr3f1zRffutMu_UGnV-vqy-oA"));

  // 2. Non-admin cached user without plaintext password must NOT skip password verification; real login hits AKfycby99
  win.localStorage.setItem("ATPL_UserAccess_V1", JSON.stringify([{ id: "1234", name: "Worker 1234", admin: false, access: ["audit", "empmaster"] }]));
  await win.ATPLMobileSharedHardFix.login();

  assert.ok(fetchCalls.some(u => u.includes("AKfycby99_") && u.includes("action=login") && u.includes("user_id=1234")), "login must route to AKfycby99");
  const cur = win.ATPLPermissionGuard.currentUser();
  assert.equal(cur.id, "1234");
  assert.equal(cur.admin, false);
  assert.equal(win.ATPLPermissionGuard.hasFeature("audit"), true);
  assert.equal(win.ATPLPermissionGuard.hasFeature("empmaster"), true);
  assert.equal(win.ATPLPermissionGuard.hasFeature("dol"), false);
  assert.equal(win.ATPLPermissionGuard.hasFeature("cmd"), false);
  assert.equal(win.ATPLPermissionGuard.hasFeature("useraccess"), false);

  // Sidebar + pages strictly restricted
  assert.equal(vnAudit.hidden, false);
  assert.equal(vnEmp.hidden, false);
  assert.equal(vnDol.hidden, true);
  assert.equal(vnCmd.hidden, true);
  assert.equal(vnUa.hidden, true);
  assert.equal(grpDash.hidden, true);
  assert.equal(byId.landingPage.style.display, "none");

  // Direct goPage attempt to disallowed feature is blocked
  byId._lastPage = null;
  assert.equal(win.goPage("dol"), false);
  assert.equal(byId._lastPage, null);

  // Empty non-admin access must NEVER default to ["*"]
  win.localStorage.setItem("ATPL_UserAccess_V1", JSON.stringify([{ id: "empty01", name: "Empty", admin: false, access: [] }]));
  win.sessionStorage.setItem("ATPL_UserSession_V5", JSON.stringify({ id: "empty01", admin: false, access: [] }));
  const emptyUser = win.ATPLPermissionGuard.currentUser();
  assert.equal(emptyUser.admin, false);
  assert.deepEqual(Array.from(emptyUser.access), []);
  assert.equal(win.ATPLPermissionGuard.hasFeature("audit"), false);
});
