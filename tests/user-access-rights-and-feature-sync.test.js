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
