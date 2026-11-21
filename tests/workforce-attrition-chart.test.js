'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const attrition = require('../workforce-attrition-chart.js');

function createSvgDomHarness() {
  const docEl = { tagName: 'HTML', style: {} };

  function makeNode(tag, ns) {
    const attrs = {};
    const styleObj = {};
    const listeners = {};
    const classSet = new Set();
    const node = {
      tagName: String(tag || 'div').toUpperCase(),
      namespaceURI: ns || 'http://www.w3.org/1999/xhtml',
      nodeType: 1,
      parentNode: null,
      children: [],
      childNodes: [],
      attributes: {},
      style: new Proxy(styleObj, {
        set(target, prop, val) {
          target[prop] = val;
          return true;
        },
        get(target, prop) {
          if (prop === 'setProperty') return (k, v) => { target[k] = v; };
          if (prop === 'removeProperty') return (k) => { delete target[k]; };
          if (prop === 'getPropertyValue') return (k) => target[k] || '';
          return target[prop] || '';
        }
      }),
      classList: {
        add(...cls) { cls.forEach(c => classSet.add(c)); },
        remove(...cls) { cls.forEach(c => classSet.delete(c)); },
        toggle(c, force) {
          if (force === undefined) {
            if (classSet.has(c)) classSet.delete(c); else classSet.add(c);
          } else if (force) classSet.add(c); else classSet.delete(c);
        },
        contains(c) { return classSet.has(c); }
      },
      set className(v) {
        classSet.clear();
        String(v || '').split(/\s+/).filter(Boolean).forEach(c => classSet.add(c));
        attrs.class = String(v || '');
      },
      get className() {
        return Array.from(classSet).join(' ');
      },
      _textContent: '',
      set textContent(v) {
        this._textContent = String(v == null ? '' : v);
        if (v === '') {
          this.children = [];
          this.childNodes = [];
        }
      },
      get textContent() { return this._textContent; },
      _innerHTML: '',
      set innerHTML(v) {
        this._innerHTML = String(v || '');
        if (v === '') {
          this.children = [];
          this.childNodes = [];
        }
      },
      get innerHTML() {
        if (this._innerHTML) return this._innerHTML;
        return this.children.map(c => c.innerHTML || c.textContent || '').join('');
      },
      get ownerDocument() { return doc; },
      get firstChild() { return this.childNodes[0] || null; },
      get nextSibling() {
        if (!this.parentNode) return null;
        const idx = this.parentNode.childNodes.indexOf(this);
        return idx >= 0 ? (this.parentNode.childNodes[idx + 1] || null) : null;
      },
      getBoundingClientRect() {
        return { width: 920, height: 290, top: 0, left: 0, right: 920, bottom: 290 };
      },
      clientWidth: 920,
      clientHeight: 290,
      setAttribute(k, v) {
        attrs[k] = String(v);
        if (k === 'class') this.className = v;
      },
      setAttributeNS(_, k, v) { this.setAttribute(k, v); },
      getAttribute(k) { return Object.prototype.hasOwnProperty.call(attrs, k) ? attrs[k] : null; },
      hasAttribute(k) { return Object.prototype.hasOwnProperty.call(attrs, k); },
      removeAttribute(k) { delete attrs[k]; },
      appendChild(child) {
        if (!child) return child;
        if (child.parentNode) child.parentNode.removeChild(child);
        child.parentNode = this;
        this.children.push(child);
        this.childNodes.push(child);
        return child;
      },
      insertBefore(newChild, refChild) {
        if (!refChild) return this.appendChild(newChild);
        if (newChild.parentNode) newChild.parentNode.removeChild(newChild);
        newChild.parentNode = this;
        const idx = this.childNodes.indexOf(refChild);
        if (idx < 0) return this.appendChild(newChild);
        this.childNodes.splice(idx, 0, newChild);
        this.children.splice(idx, 0, newChild);
        return newChild;
      },
      removeChild(child) {
        const i = this.childNodes.indexOf(child);
        if (i >= 0) this.childNodes.splice(i, 1);
        const j = this.children.indexOf(child);
        if (j >= 0) this.children.splice(j, 1);
        if (child) child.parentNode = null;
        return child;
      },
      remove() {
        if (this.parentNode) this.parentNode.removeChild(this);
      },
      addEventListener(type, fn) {
        listeners[type] = listeners[type] || [];
        listeners[type].push(fn);
      },
      removeEventListener(type, fn) {
        if (!listeners[type]) return;
        listeners[type] = listeners[type].filter(f => f !== fn);
      },
      dispatchEvent(ev) {
        const list = listeners[ev && ev.type] || [];
        list.forEach(fn => fn.call(this, ev));
        return true;
      },
      matches(selector) {
        return String(selector || '').split(',').some(sel => {
          const s = sel.trim();
          if (!s) return false;
          if (s.startsWith('.')) return classSet.has(s.slice(1));
          if (s.startsWith('#')) return attrs.id === s.slice(1);
          return this.tagName.toLowerCase() === s.toLowerCase();
        });
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
      },
      getTotalLength() { return 480; }
    };
    return node;
  }

  const doc = {
    documentElement: docEl,
    defaultView: null,
    createElement(tag) { return makeNode(tag, 'http://www.w3.org/1999/xhtml'); },
    createElementNS(ns, tag) { return makeNode(tag, ns); },
    createTextNode(txt) { return { nodeType: 3, textContent: String(txt || '') }; },
    querySelector() { return null; },
    querySelectorAll() { return []; }
  };

  return { doc, makeNode };
}

test('computes 12-month attrition series (Left vs Active), seasonal spikes & department filtering accurately', () => {
  const employees = [
    // 20 permanent active workers across 2 departments
    ...Array.from({ length: 12 }, (_, i) => ({
      emp_id: 'W' + (i + 1),
      name: 'Weaver ' + (i + 1),
      dept: 'WEAVING',
      doj: '01-01-2023',
      dol: '',
      status: 'ACTIVE'
    })),
    ...Array.from({ length: 8 }, (_, i) => ({
      emp_id: 'S' + (i + 1),
      name: 'Staff ' + (i + 1),
      dept: 'OFFICE STAFF',
      doj: '01-01-2023',
      dol: '',
      status: 'ACTIVE'
    })),
    // Normal exit in Feb 2025 (1 exit)
    { emp_id: 'L1', name: 'Exit Feb', dept: 'WEAVING', doj: '10-05-2024', dol: '15-02-2025', status: 'LEFT' },
    // Seasonal spike in Jun 2025 (4 exits out of ~24 = ~16%!)
    { emp_id: 'L2', name: 'Exit Jun 1', dept: 'WEAVING', doj: '10-05-2024', dol: '05-06-2025', status: 'LEFT' },
    { emp_id: 'L3', name: 'Exit Jun 2', dept: 'WEAVING', doj: '10-05-2024', dol: '12-06-2025', status: 'LEFT' },
    { emp_id: 'L4', name: 'Exit Jun 3', dept: 'WEAVING', doj: '10-05-2024', dol: '20-06-2025', status: 'LEFT' },
    { emp_id: 'L5', name: 'Exit Jun 4', dept: 'OFFICE STAFF', doj: '10-05-2024', dol: '25-06-2025', status: 'LEFT' },
    // Exit in Aug 2025 (1 exit)
    { emp_id: 'L6', name: 'Exit Aug', dept: 'OFFICE STAFF', doj: '01-02-2025', dol: '2025-08-18', status: 'LEFT' }
  ];

  // Compliance sheet for Jun 2025 also marks L2 as 0 paidDays — must NOT double-count L2!
  const complianceSheetsByYm = {
    '2025-06': {
      month: '2025-06',
      rows: [
        { empId: 'L2', name: 'Exit Jun 1', department: 'WEAVING', paidDays: 0, isLeft: true }
      ]
    }
  };

  const res = attrition.computeAttritionSeries(employees, {
    anchorYear: 2025,
    anchorMonthNum: 9,
    windowMode: 'rolling12',
    dept: 'ALL',
    complianceSheetsByYm
  });

  assert.equal(res.points.length, 12);
  assert.equal(res.points[0].ym, '2024-10');
  assert.equal(res.points[11].ym, '2025-09');
  assert.deepEqual(res.departments, ['OFFICE STAFF', 'WEAVING']);

  const jun = res.points.find(p => p.ym === '2025-06');
  assert.ok(jun, 'June 2025 point missing');
  assert.equal(jun.left, 4, 'June exits must be 4 without double-counting compliance sheet L2');
  assert.equal(jun.isSpike, true, 'June 2025 should be flagged as seasonal turnover spike');
  assert.ok(jun.attritionRatePct > 14 && jun.attritionRatePct < 20);

  const feb = res.points.find(p => p.ym === '2025-02');
  assert.equal(feb.left, 1);
  assert.equal(feb.joined, 1, 'L6 joined in Feb 2025');
  assert.equal(feb.isSpike, false);

  assert.equal(res.summary.totalLeft, 6);
  assert.equal(res.summary.peakPoint.ym, '2025-06');

  // Verify department filter isolates WEAVING (3 exits in June instead of 4)
  const weavingOnly = attrition.computeAttritionSeries(employees, {
    anchorYear: 2025,
    anchorMonthNum: 9,
    windowMode: 'calendar',
    dept: 'WEAVING',
    complianceSheetsByYm
  });
  assert.equal(weavingOnly.points[0].ym, '2025-01');
  assert.equal(weavingOnly.points[11].ym, '2025-12');
  const junWeaving = weavingOnly.points.find(p => p.ym === '2025-06');
  assert.equal(junWeaving.left, 3);
  assert.equal(junWeaving.active, 15);
});

test('renders interactive D3 v7 SVG line chart (Left vs Active, spike bands, axes & click handler)', () => {
  const { doc } = createSvgDomHarness();
  const d3Code = fs.readFileSync(path.join(ROOT, 'd3.v7.min.js'), 'utf8');
  const sandbox = {
    document: doc,
    window: {
      matchMedia: () => ({ matches: true })
    },
    console,
    Math,
    Date,
    Number,
    String,
    Array,
    Object,
    Map,
    Set
  };
  sandbox.window.document = doc;
  sandbox.self = sandbox.window;
  doc.defaultView = sandbox.window;
  vm.createContext(sandbox);
  vm.runInContext(d3Code, sandbox);
  const d3Lib = sandbox.d3;
  assert.ok(d3Lib && typeof d3Lib.line === 'function', 'd3.v7.min.js should expose d3.line');

  const container = doc.createElement('div');
  const series = attrition.computeAttritionSeries([
    ...Array.from({ length: 15 }, (_, i) => ({
      emp_id: 'E' + i, name: 'Emp ' + i, dept: 'SPINNING', doj: '01-01-2024', status: 'ACTIVE'
    })),
    { emp_id: 'X1', name: 'Quit 1', dept: 'SPINNING', doj: '01-01-2024', dol: '10-05-2025', status: 'LEFT' },
    { emp_id: 'X2', name: 'Quit 2', dept: 'SPINNING', doj: '01-01-2024', dol: '18-05-2025', status: 'LEFT' },
    { emp_id: 'X3', name: 'Quit 3', dept: 'SPINNING', doj: '01-01-2024', dol: '22-05-2025', status: 'LEFT' }
  ], {
    anchorYear: 2025,
    anchorMonthNum: 9,
    windowMode: 'rolling12'
  });

  let clickedPoint = null;
  const renderInfo = attrition.renderAttritionD3LineChart(container, series, {
    d3: d3Lib,
    mode: 'rate_vs_active',
    selectedYm: '2025-09',
    onMonthSelect: (pt) => { clickedPoint = pt; }
  });

  assert.ok(renderInfo && renderInfo.points.length === 12);
  const svg = container.querySelector('svg');
  assert.ok(svg, 'SVG should be appended by D3');
  assert.ok(svg.querySelector('.attr-line-primary').getAttribute('d').startsWith('M'), 'Primary attrition line path missing');
  assert.ok(svg.querySelector('.attr-line-active').getAttribute('d').startsWith('M'), 'Active workforce comparison line path missing');
  assert.ok(svg.querySelector('.attr-area-primary').getAttribute('d').startsWith('M'), 'Area fill path missing');
  assert.equal(svg.querySelectorAll('.attr-node').length, 12, 'Should render 12 monthly nodes');
  assert.equal(svg.querySelectorAll('.attr-spike-band').length, 1, 'May 2025 spike band should be rendered');

  // Verify click on a node invokes onMonthSelect
  const mayNode = svg.querySelectorAll('.attr-node').find(n => (n.getAttribute('aria-label') || '').includes('May 2025'));
  assert.ok(mayNode, 'May 2025 node missing');
  mayNode.dispatchEvent({ type: 'click', target: mayNode });
  assert.equal(clickedPoint && clickedPoint.ym, '2025-05');

  // Verify empty state renders cleanly without throwing
  const emptyBox = doc.createElement('div');
  const emptySeries = attrition.computeAttritionSeries([], { anchorYear: 2025, anchorMonthNum: 9 });
  const emptyRes = attrition.renderAttritionD3LineChart(emptyBox, emptySeries, { d3: d3Lib });
  assert.equal(emptyRes, null);
  assert.ok(emptyBox.innerHTML.includes('No workforce or salary records available'));
});

test('index.html wires d3.v7.min.js, workforce-attrition-chart.js & valid dashboard JS syntax', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.ok(html.includes('<script src="d3.v7.min.js"></script>'), 'index.html should load d3.v7.min.js');
  assert.ok(html.includes('<script src="workforce-attrition-chart.js?v=1"></script>'), 'index.html should load workforce-attrition-chart.js');
  assert.ok(html.includes('id="dashAttritionSection"'), 'index.html should contain dashAttritionSection');
  assert.ok(html.includes('id="dashAttritionD3Chart"'), 'index.html should contain dashAttritionD3Chart');
  assert.ok(html.includes('renderAttritionSection('), 'empDashboardRender should call renderAttritionSection');

  // Verify syntax of main dashboard inline script block containing DASH_STATE
  const marker = 'window.DASH_STATE = {';
  const idx = html.indexOf(marker);
  assert.ok(idx > 0, 'DASH_STATE missing');
  const scriptStart = html.lastIndexOf('<script>', idx);
  const scriptEnd = html.indexOf('</script>', idx);
  assert.ok(scriptStart > 0 && scriptEnd > scriptStart);
  const scriptBody = html.slice(scriptStart + '<script>'.length, scriptEnd);
  // Compile with vm.Script to catch any syntax errors in the edited inline <script>
  new vm.Script(scriptBody);
});
