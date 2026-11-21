'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

function extractSidebarScript(html) {
  const startTag = '<script id="atplSidebarReorderScript">';
  const startIdx = html.indexOf(startTag);
  assert.ok(startIdx >= 0, 'atplSidebarReorderScript tag missing from index.html');
  const bodyStart = startIdx + startTag.length;
  const bodyEnd = html.indexOf('</script>', bodyStart);
  assert.ok(bodyEnd > bodyStart, 'closing script tag missing for atplSidebarReorderScript');
  return html.slice(bodyStart, bodyEnd);
}

function createSidebarDomHarness() {
  const byId = new Map();
  const store = Object.create(null);

  function matchSingle(node, sel) {
    const parts = sel.trim().split(/\s+/);
    if (parts.length > 1) {
      // Support simple ancestor descendant like "#vnav .vnav-sub" or ".vnav-group > .vnav-cat"
      if (parts.includes('>')) {
        const idx = parts.indexOf('>');
        const parentSel = parts.slice(0, idx).join(' ');
        const childSel = parts.slice(idx + 1).join(' ');
        return matchSingle(node, childSel) && node.parentNode && matchSingle(node.parentNode, parentSel);
      }
      const last = parts[parts.length - 1];
      if (!matchSingle(node, last)) return false;
      let cur = node.parentNode;
      let pIdx = parts.length - 2;
      while (cur && pIdx >= 0) {
        if (matchSingle(cur, parts[pIdx])) pIdx--;
        cur = cur.parentNode;
      }
      return pIdx < 0;
    }
    const s = parts[0];
    if (!s) return false;
    // Compound like .vnav-sub.vnav-drag-over
    const tokens = s.match(/([#.][^#.]+|^[^#.]+)/g) || [s];
    return tokens.every((tok) => {
      if (tok.startsWith('#')) return node.id === tok.slice(1);
      if (tok.startsWith('.')) return node.classList.contains(tok.slice(1));
      return node.tagName.toLowerCase() === tok.toLowerCase();
    });
  }

  function makeNode(tag, opts = {}) {
    const classSet = new Set();
    const attrs = {};
    const listeners = {};
    const styleObj = {};
    let _id = '';

    const node = {
      tagName: String(tag || 'div').toUpperCase(),
      nodeType: 1,
      parentNode: null,
      children: [],
      hidden: Boolean(opts.hidden),
      _textContent: opts.textContent || '',
      _rectTop: opts.top || 0,
      _rectHeight: opts.height || 34,
      style: new Proxy(styleObj, {
        set(t, k, v) {
          t[k] = v;
          return true;
        },
        get(t, k) {
          if (k === 'setProperty') return (p, v) => { t[p] = v; };
          if (k === 'removeProperty') return (p) => { delete t[p]; };
          return t[k] !== undefined ? t[k] : '';
        }
      }),
      get id() { return _id; },
      set id(v) {
        if (_id && byId.get(_id) === node) byId.delete(_id);
        _id = String(v || '');
        if (_id) byId.set(_id, node);
        attrs.id = _id;
      },
      classList: {
        add(...cls) { cls.forEach((c) => classSet.add(c)); },
        remove(...cls) { cls.forEach((c) => classSet.delete(c)); },
        toggle(c, force) {
          if (force === undefined) {
            if (classSet.has(c)) { classSet.delete(c); return false; }
            classSet.add(c); return true;
          }
          if (force) classSet.add(c); else classSet.delete(c);
          return Boolean(force);
        },
        contains(c) { return classSet.has(c); }
      },
      set className(v) {
        classSet.clear();
        String(v || '').split(/\s+/).filter(Boolean).forEach((c) => classSet.add(c));
      },
      get className() { return Array.from(classSet).join(' '); },
      get textContent() { return this._textContent; },
      set textContent(v) { this._textContent = String(v == null ? '' : v); },
      get firstElementChild() { return this.children[0] || null; },
      get nextElementSibling() {
        if (!this.parentNode) return null;
        const idx = this.parentNode.children.indexOf(this);
        return idx >= 0 ? (this.parentNode.children[idx + 1] || null) : null;
      },
      get nextSibling() { return this.nextElementSibling; },
      get scrollHeight() {
        if (!this.classList.contains('vnav-sub')) return 40;
        let visCount = 0;
        for (const ch of this.children) {
          if (
            ch.classList.contains('vitem') &&
            !ch.hidden &&
            !ch.classList.contains('uaNoAccess') &&
            !ch.classList.contains('vnav-search-hide') &&
            ch.getAttribute('aria-hidden') !== 'true' &&
            !/^vn-(cmd|ai-commander|test|attendanceaudit|challan|empdashboard|dol|dolverify)$/.test(ch.id || '') &&
            String(ch.style.display || '').toLowerCase() !== 'none'
          ) {
            visCount++;
          }
        }
        return visCount * 36;
      },
      get offsetHeight() { return this.scrollHeight; },
      getBoundingClientRect() {
        const idx = this.parentNode ? Math.max(0, this.parentNode.children.indexOf(this)) : 0;
        const top = this._rectTop || idx * 34;
        return { top, height: this._rectHeight, bottom: top + this._rectHeight, left: 0, right: 200, width: 200 };
      },
      setAttribute(k, v) {
        attrs[k] = String(v);
        if (k === 'id') this.id = v;
        if (k === 'class') this.className = v;
      },
      getAttribute(k) { return Object.prototype.hasOwnProperty.call(attrs, k) ? attrs[k] : null; },
      removeAttribute(k) { delete attrs[k]; },
      contains(target) {
        let cur = target;
        while (cur) {
          if (cur === this) return true;
          cur = cur.parentNode;
        }
        return false;
      },
      closest(sel) {
        let cur = this;
        while (cur) {
          if (cur.matches(sel)) return cur;
          cur = cur.parentNode;
        }
        return null;
      },
      matches(selector) {
        return String(selector || '').split(',').some((s) => matchSingle(this, s));
      },
      appendChild(child) {
        if (child.parentNode) child.parentNode.removeChild(child);
        child.parentNode = this;
        this.children.push(child);
        return child;
      },
      insertBefore(newChild, refChild) {
        if (!refChild) return this.appendChild(newChild);
        if (newChild.parentNode) newChild.parentNode.removeChild(newChild);
        newChild.parentNode = this;
        const idx = this.children.indexOf(refChild);
        if (idx < 0) return this.appendChild(newChild);
        this.children.splice(idx, 0, newChild);
        return newChild;
      },
      removeChild(child) {
        const idx = this.children.indexOf(child);
        if (idx >= 0) this.children.splice(idx, 1);
        if (child) child.parentNode = null;
        return child;
      },
      addEventListener(type, fn) {
        listeners[type] = listeners[type] || [];
        listeners[type].push(fn);
      },
      dispatchEvent(ev) {
        const e = Object.assign({
          preventDefault() { this.defaultPrevented = true; },
          stopPropagation() { this.stopped = true; },
          dataTransfer: { effectAllowed: '', dropEffect: '', setData() {}, getData() { return ''; } }
        }, ev);
        const list = listeners[e.type] || [];
        list.forEach((fn) => fn.call(this, e));
        return e;
      },
      querySelectorAll(selector) {
        const out = [];
        const walk = (root) => {
          for (const ch of root.children) {
            if (ch.matches(selector)) out.push(ch);
            walk(ch);
          }
        };
        walk(this);
        return out;
      },
      querySelector(selector) {
        return this.querySelectorAll(selector)[0] || null;
      }
    };

    if (opts.id) node.id = opts.id;
    if (opts.className) node.className = opts.className;
    if (opts.display) node.style.display = opts.display;
    if (opts.ariaHidden) node.setAttribute('aria-hidden', 'true');
    if (opts.onclick) node.setAttribute('onclick', opts.onclick);
    return node;
  }

  const root = makeNode('div', { id: 'root' });
  const vnav = makeNode('div', { id: 'vnav' });
  const arrangeBtn = makeNode('button', { id: 'vnavArrangeBtn', textContent: '↕ Shift' });
  const resetBtn = makeNode('button', { id: 'vnavResetOrderBtn', textContent: '↺' });
  vnav.appendChild(arrangeBtn);
  vnav.appendChild(resetBtn);
  root.appendChild(vnav);

  function addSection(catId, arrId, label, items) {
    const grp = makeNode('div', { className: 'vnav-group' });
    const hdr = makeNode('div', { className: 'vnav-cat', textContent: label });
    const arr = makeNode('span', { id: arrId, className: 'vnav-arrow', textContent: '▾' });
    hdr.appendChild(arr);
    const sub = makeNode('div', { id: catId, className: 'vnav-sub' });
    items.forEach((it) => sub.appendChild(it));
    grp.appendChild(hdr);
    grp.appendChild(sub);
    vnav.appendChild(grp);
    return { grp, hdr, arr, sub };
  }

  const dash = addSection('cat-dash', 'arr-dash', 'Dashboard', [
    makeNode('div', { id: 'vn-cmd', className: 'vitem', hidden: true, ariaHidden: true, display: 'none', textContent: 'Smart Commands' }),
    makeNode('div', { id: 'vn-files', className: 'vitem', textContent: 'All Files', onclick: "goPage('files')" })
  ]);

  const sal = addSection('cat-sal', 'arr-sal', 'Salary', [
    makeNode('div', { id: 'vn-mamsalary', className: 'vitem', textContent: 'Mam -> Compliance', onclick: "goPage('mamsalary')" }),
    makeNode('div', { id: 'vn-audit', className: 'vitem', textContent: 'Salary Audit', onclick: "goPage('audit')" }),
    makeNode('div', { id: 'vn-advance', className: 'vitem', textContent: 'Advance Management', onclick: "goPage('advance')" })
  ]);

  const emp = addSection('cat-emp', 'arr-emp', 'Employee', [
    makeNode('div', { id: 'vn-empdashboard', className: 'vitem', hidden: true, ariaHidden: true, display: 'none', textContent: 'Workforce Dashboard' }),
    makeNode('div', { id: 'vn-ff', className: 'vitem', textContent: 'F&F Settlement', onclick: "goPage('ff')" }),
    makeNode('div', { id: 'vn-empmaster', className: 'vitem', textContent: 'Employee Master', onclick: "goPage('empmaster')" }),
    makeNode('div', { id: 'vn-letter', className: 'vitem', textContent: 'Letter', onclick: "goPage('letter')" })
  ]);

  const tools = addSection('cat-tools', 'arr-tools', 'Tools', [
    makeNode('div', { id: 'vn-esictodol', className: 'vitem', textContent: 'ESIC -> DOL', onclick: "goPage('esictodol')" }),
    makeNode('div', { id: 'vn-pftodol', className: 'vitem', textContent: 'PF -> DOL', onclick: "goPage('pftodol')" })
  ]);

  const doc = {
    readyState: 'complete',
    getElementById(id) { return byId.get(id) || null; },
    createElement(tag) { return makeNode(tag); },
    querySelectorAll(sel) { return root.querySelectorAll(sel); },
    querySelector(sel) { return root.querySelector(sel); },
    addEventListener() {}
  };

  const localStorageMock = {
    getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem(k, v) { store[k] = String(v); },
    removeItem(k) { delete store[k]; }
  };

  const win = {
    document: doc,
    localStorage: localStorageMock,
    getComputedStyle(el) { return { display: el.style.display || 'flex' }; },
    setTimeout,
    clearTimeout
  };

  return { doc, win, vnav, dash, sal, emp, tools, makeNode, store };
}

test('index.html has clean syntax in sidebar CSS, toggleVcat, toggleAllVcats, and ATPLSidebarReorder', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

  // CSS rules: no 500px clamp on .vnav-sub, plus cross-section indicators
  assert.ok(!/\.vnav-sub\s*\{[^}]*500px/.test(html), '.vnav-sub must not clamp max-height at 500px');
  assert.ok(html.includes('.vnav-drop-before') && html.includes('.vnav-drop-after'), 'directional drop styles required');
  assert.ok(html.includes('.vnav-group.vnav-section-drop'), 'section drop highlight required');
  assert.ok(html.includes('.vnav-empty-sub'), 'empty section dropzone CSS required');

  // Compile ATPLSidebarReorder script
  const sidebarScript = extractSidebarScript(html);
  new vm.Script(sidebarScript);

  // Compile inline script containing toggleVcat & goPage()
  const tvIdx = html.indexOf('function toggleVcat(catId)');
  assert.ok(tvIdx > 0, 'toggleVcat missing');
  const tvStart = html.lastIndexOf('<script>', tvIdx);
  const tvEnd = html.indexOf('</script>', tvIdx);
  new vm.Script(html.slice(tvStart + '<script>'.length, tvEnd));

  // Compile inline script containing toggleAllVcats
  const taIdx = html.indexOf('function toggleAllVcats()');
  assert.ok(taIdx > 0, 'toggleAllVcats missing');
  const taStart = html.lastIndexOf('<script>', taIdx);
  const taEnd = html.indexOf('</script>', taIdx);
  new vm.Script(html.slice(taStart + '<script>'.length, taEnd));

  // Verify goPage() looks up moved item's current parent section and calls syncSectionHeights()
  const goSnippet = html.slice(html.indexOf('function goPage(name)'), html.indexOf('function toggleVcat(catId)'));
  assert.ok(goSnippet.includes("activeVitem.closest('.vnav-sub')"), 'goPage() should resolve moved item current .vnav-sub');
  assert.ok(goSnippet.includes('syncSectionHeights()'), 'goPage() should resync height when auto-expanding');
});

test('cross-section drag-and-drop moves features between sections, resizes section heights dynamically (>500px & 0px), and persists order', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const sidebarScript = extractSidebarScript(html);
  const { win, vnav, dash, sal, emp, tools, makeNode, store } = createSidebarDomHarness();

  const sandbox = {
    window: win,
    document: win.document,
    setTimeout: (fn) => { if (typeof fn === 'function') fn(); return 1; },
    clearTimeout: () => {},
    console
  };
  vm.createContext(sandbox);
  vm.runInContext(sidebarScript, sandbox);

  const api = win.ATPLSidebarReorder;
  assert.ok(api, 'ATPLSidebarReorder should initialize on window');

  // Initial section heights reflect visible items only (dash has 1 visible + 1 hidden = 36+6 = 42px)
  assert.equal(dash.sub.style.maxHeight, '42px');
  assert.equal(sal.sub.style.maxHeight, '114px'); // 3 * 36 + 6
  assert.equal(emp.sub.style.maxHeight, '114px'); // 3 visible + 1 hidden
  assert.equal(tools.sub.style.maxHeight, '78px'); // 2 * 36 + 6

  // 1) Drag 'vn-mamsalary' from SALARY and drop onto bottom half of 'vn-empmaster' in EMPLOYEE
  const mamEl = win.document.getElementById('vn-mamsalary');
  const empMasterEl = win.document.getElementById('vn-empmaster');
  mamEl.dispatchEvent({ type: 'dragstart' });
  assert.ok(vnav.classList.contains('vnav-dragging-active'), 'vnav-dragging-active should toggle during drag');

  // Bottom half of vn-empmaster (top=68, height=34 => clientY=95 > 85)
  empMasterEl.dispatchEvent({ type: 'dragover', clientY: 95 });
  assert.ok(empMasterEl.classList.contains('vnav-drop-after'));
  assert.ok(emp.grp.classList.contains('vnav-section-drop'));

  empMasterEl.dispatchEvent({ type: 'drop', clientY: 95 });
  mamEl.dispatchEvent({ type: 'dragend' });

  assert.equal(mamEl.parentNode, emp.sub, 'vn-mamsalary should now live inside #cat-emp');
  assert.deepEqual(
    emp.sub.children.map((c) => c.id),
    ['vn-empdashboard', 'vn-ff', 'vn-empmaster', 'vn-mamsalary', 'vn-letter']
  );
  // Section heights dynamically adjusted: SALARY shrank (114 -> 78), EMPLOYEE grew (114 -> 150)
  assert.equal(sal.sub.style.maxHeight, '78px');
  assert.equal(emp.sub.style.maxHeight, '150px');

  // Persisted to localStorage
  const saved = JSON.parse(store['ATPL_SidebarMenuOrder_V1']);
  assert.ok(!saved['cat-sal'].includes('vn-mamsalary'));
  assert.deepEqual(saved['cat-emp'], ['vn-empdashboard', 'vn-ff', 'vn-empmaster', 'vn-mamsalary', 'vn-letter']);

  // 2) Dragging onto a collapsed section header (.vnav-cat) auto-expands it and inserts at top
  tools.sub.classList.add('collapsed');
  tools.arr.textContent = '▸';
  api.syncSectionHeights();
  assert.equal(tools.sub.style.maxHeight, '0px');

  mamEl.dispatchEvent({ type: 'dragstart' });
  tools.hdr.dispatchEvent({ type: 'dragover' });
  assert.ok(!tools.sub.classList.contains('collapsed'), 'Collapsed section should auto-expand on dragover');
  assert.equal(tools.arr.textContent, '▾');
  tools.hdr.dispatchEvent({ type: 'drop' });
  mamEl.dispatchEvent({ type: 'dragend' });

  assert.equal(mamEl.parentNode, tools.sub);
  assert.equal(tools.sub.children[0].id, 'vn-mamsalary', 'Header drop places item at top of section');
  assert.equal(tools.sub.style.maxHeight, '114px');

  // 3) Emptying a section shrinks it to 0px idle and 44px while dragging/arranging; dropping into empty box restores it
  const filesEl = win.document.getElementById('vn-files');
  filesEl.dispatchEvent({ type: 'dragstart' });
  sal.hdr.dispatchEvent({ type: 'drop' });
  filesEl.dispatchEvent({ type: 'dragend' });

  assert.ok(dash.sub.classList.contains('vnav-empty-sub'));
  assert.equal(dash.sub.style.maxHeight, '0px', 'Empty section should shrink to 0px when not dragging');

  // Enter Shift arrange mode -> empty section opens dropzone (44px)
  api.toggle();
  assert.equal(dash.sub.style.maxHeight, '44px');
  api.toggle(); // exit Shift mode

  // Drag vn-files back onto empty dash.sub directly
  filesEl.dispatchEvent({ type: 'dragstart' });
  dash.sub.dispatchEvent({ type: 'dragover' });
  dash.sub.dispatchEvent({ type: 'drop' });
  filesEl.dispatchEvent({ type: 'dragend' });
  assert.equal(filesEl.parentNode, dash.sub);
  assert.equal(dash.sub.style.maxHeight, '42px');

  // 4) Dynamic height grows cleanly beyond 500px when many items are moved into one section (no 500px cutoff)
  for (let i = 1; i <= 15; i++) {
    emp.sub.appendChild(makeNode('div', { id: 'vn-extra-' + i, className: 'vitem', textContent: 'Extra ' + i }));
  }
  api.syncSectionHeights();
  const empHeightPx = parseInt(emp.sub.style.maxHeight, 10);
  assert.ok(empHeightPx > 500, 'Section height should exceed 500px cleanly (got ' + empHeightPx + 'px)');

  // 5) resetOrder() returns items back to their original data-orig-cat sections
  api.resetOrder();
  assert.equal(mamEl.parentNode, sal.sub, 'vn-mamsalary should return to #cat-sal on reset');
  assert.equal(filesEl.parentNode, dash.sub, 'vn-files should return to #cat-dash on reset');
  assert.equal(win.document.getElementById('vnavResetOrderBtn').style.display, 'none');
});

test('moveItem (▲/▼ buttons), reload applyOrderMap, and collapsed-section restore across boundaries work accurately', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const sidebarScript = extractSidebarScript(html);
  const { win, dash, sal, emp } = createSidebarDomHarness();

  const sandbox = {
    window: win,
    document: win.document,
    setTimeout: (fn) => { if (typeof fn === 'function') fn(); return 1; },
    clearTimeout: () => {},
    console
  };
  vm.createContext(sandbox);
  vm.runInContext(sidebarScript, sandbox);

  const api = win.ATPLSidebarReorder;
  const mamEl = win.document.getElementById('vn-mamsalary');

  // Move vn-mamsalary UP past top of SALARY -> crosses into bottom of DASHBOARD
  api.moveItem(mamEl, -1);
  assert.equal(mamEl.parentNode, dash.sub);
  assert.equal(dash.sub.children[dash.sub.children.length - 1], mamEl);
  assert.equal(dash.sub.style.maxHeight, '78px');
  assert.equal(sal.sub.style.maxHeight, '78px');

  // Move vn-mamsalary back DOWN past bottom of DASHBOARD -> crosses back into top of SALARY
  api.moveItem(mamEl, 1);
  assert.equal(mamEl.parentNode, sal.sub);
  assert.equal(sal.sub.children[0], mamEl);

  // Move vn-advance (last in SALARY) DOWN -> crosses into top of EMPLOYEE (auto-expanding EMPLOYEE if collapsed)
  emp.sub.classList.add('collapsed');
  const advEl = win.document.getElementById('vn-advance');
  api.moveItem(advEl, 1);
  assert.equal(advEl.parentNode, emp.sub);
  assert.ok(!emp.sub.classList.contains('collapsed'));

  // Simulate reload: reset DOM back to default order, then apply saved cross-section map
  const savedSnapshot = JSON.parse(JSON.stringify(api.collectCurrentOrder()));
  api.resetOrder();
  assert.equal(advEl.parentNode, sal.sub);

  api.applyOrderMap(savedSnapshot);
  assert.equal(advEl.parentNode, emp.sub, 'applyOrderMap must restore saved cross-section placements');
  assert.equal(emp.sub.style.maxHeight, '150px');
  assert.equal(sal.sub.style.maxHeight, '78px');
});
