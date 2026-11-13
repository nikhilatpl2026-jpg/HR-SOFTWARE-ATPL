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
    removeItem: (k) => m.delete(k),
    _map: m
  };
}

test('modified auth and worker files parse without syntax errors', () => {
  [
    'erp-permission-guard-v1.js',
    'erp-mobile-shared-hardfix-v1.js',
    'hr-workplace.js',
    'shared-auth.js',
    'erp-cloud-api-broker-v1.js',
    'sw.js'
  ].forEach((f) => {
    assert.doesNotThrow(() => new Function(read(f)), f + ' must be valid JS');
  });
});

test('index.html head script clears previous sessions and tokens on every load/refresh and preserves ERP data', () => {
  const html = read('index.html');
  const m = html.match(/<head>\s*<script>([\s\S]*?)<\/script>/i);
  assert.ok(m, 'head inline script must exist');
  const scriptBody = m[1];
  assert.ok(scriptBody.includes('ATPL_UserSession_V5'));
  assert.ok(scriptBody.includes('pageshow'));

  const sess = mkStorage({
    ATPL_UserSession_V5: '{"id":"admin"}',
    ATPL_RemoteToken_V1: 'tok123',
    ATPL_SharedToken_V1: 'tok123'
  });
  const local = mkStorage({
    ATPL_UserSession_V5: '{"id":"admin"}',
    ATPL_RemoteToken_V1: 'tok123',
    ATPL_SharedToken_V1: 'tok123',
    ATPL_UserAccess_V1: '[{"id":"admin","admin":true}]',
    AroraTextilesEmployeeMasterV3: '[{"emp_id":"101"}]'
  });

  const listeners = {};
  const uaLogin = { style: { display: 'none' } };
  const loginScreen = { style: { display: 'flex' } };
  const body = {
    classes: new Set(),
    classList: {
      add: (c) => body.classes.add(c),
      remove: (c) => body.classes.delete(c)
    }
  };
  const doc = {
    body,
    addEventListener: () => {},
    getElementById: (id) => (id === 'uaLogin' ? uaLogin : id === 'loginScreen' ? loginScreen : null)
  };
  const win = {
    sessionStorage: sess,
    localStorage: local,
    location: { hostname: 'nikhilatpl2026-jpg.github.io' },
    document: doc,
    addEventListener: (ev, fn) => {
      listeners[ev] = listeners[ev] || [];
      listeners[ev].push(fn);
    }
  };
  win.window = win;
  win.self = win;
  win.top = win;
  win.navigator = {};

  vm.runInNewContext(scriptBody, Object.assign(win, { document: doc, sessionStorage: sess, localStorage: local, navigator: {} }));

  assert.equal(sess.getItem('ATPL_UserSession_V5'), null);
  assert.equal(sess.getItem('ATPL_RemoteToken_V1'), null);
  assert.equal(sess.getItem('ATPL_SharedToken_V1'), null);
  assert.equal(local.getItem('ATPL_UserSession_V5'), null);
  assert.equal(local.getItem('ATPL_RemoteToken_V1'), null);
  assert.equal(local.getItem('ATPL_SharedToken_V1'), null);
  assert.equal(local.getItem('ATPL_UserAccess_V1'), '[{"id":"admin","admin":true}]');
  assert.equal(local.getItem('AroraTextilesEmployeeMasterV3'), '[{"emp_id":"101"}]');

  // Simulate bfcache pageshow restore after an active session
  sess.setItem('ATPL_UserSession_V5', '{"id":"admin"}');
  (listeners.pageshow || []).forEach((fn) => fn({ persisted: true }));
  assert.equal(sess.getItem('ATPL_UserSession_V5'), null);
  assert.ok(body.classes.has('uaLocked'));
  assert.equal(uaLogin.style.display, 'flex');
});

test('erp-permission-guard-v1 never resurrects session from localStorage into sessionStorage', () => {
  const sess = mkStorage({});
  const local = mkStorage({
    ATPL_UserSession_V5: '{"id":"admin","admin":true}',
    ATPL_UserAccess_V1: '[{"id":"admin","admin":true}]'
  });
  const doc = {
    readyState: 'complete',
    querySelectorAll: () => [],
    querySelector: () => null,
    getElementById: () => null,
    addEventListener: () => {}
  };
  const win = {
    sessionStorage: sess,
    localStorage: local,
    document: doc,
    setTimeout: () => 1,
    MutationObserver: function () { this.observe = () => {}; }
  };
  win.window = win;
  vm.runInNewContext(read('erp-permission-guard-v1.js'), Object.assign(win, { window: win }));
  assert.equal(win.ATPLPermissionGuard.currentUser(), null);
  assert.equal(sess.getItem('ATPL_UserSession_V5'), null);
});
