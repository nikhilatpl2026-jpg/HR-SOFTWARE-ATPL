const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('HR Documents UI markup, clean light filter bar, no horizontal overflow traps, and category bar', () => {
  assert.ok(indexHtml.includes('id="hrDocFilterBar"'), 'must include hrDocFilterBar');
  assert.ok(indexHtml.includes('class="hr-search-wrap"'), 'must wrap hrDocSearch in hr-search-wrap');
  assert.ok(indexHtml.includes('id="hrDocCategoryBar"'), 'must include hrDocCategoryBar');
  assert.ok(indexHtml.includes('onclick="hrDocExportExcel()"'), 'must include Export Excel button');
  assert.ok(indexHtml.includes('id="hrDocAttachmentFilter"'), 'must include attachment filter directly in HTML');
  assert.ok(!indexHtml.includes('#page-hrdocs>div:nth-of-type(2){background:#1e293b!important'), 'must remove dark navy filter bar override');
  assert.ok(!indexHtml.includes('#page-hrdocs .hr-doc-card{min-width:1100px!important'), 'must not force 1100px desktop min-width on hr-doc-card');
});

test('HR Documents runtime ARender, KPI click filters, category chips, preview button, and Excel export', () => {
  const sIdx = indexHtml.indexOf('<style id="aroraAllDocsVisibilityFix">');
  const scriptStart = indexHtml.indexOf('<script>', sIdx) + '<script>'.length;
  const scriptEnd = indexHtml.indexOf('</script>', scriptStart);
  const blockCode = indexHtml.slice(scriptStart, scriptEnd);

  const makeEl = (id, tag = 'div') => {
    const options = tag === 'select' ? [{ value: 'ALL', textContent: 'All' }, { value: 'HR Policy', textContent: 'HR Policy' }, { value: 'Safety', textContent: 'Safety' }] : [];
    const el = {
      id,
      tagName: tag.toUpperCase(),
      value: tag === 'select' ? 'ALL' : '',
      innerHTML: '',
      textContent: '',
      dataset: {},
      options,
      classList: {
        _set: new Set(),
        add(c) { this._set.add(c); },
        contains(c) { return this._set.has(c); }
      },
      addEventListener() {},
      appendChild(opt) { options.push(opt); }
    };
    return el;
  };

  const els = {
    hrDocSearch: makeEl('hrDocSearch', 'input'),
    hrDocStatusFilter: makeEl('hrDocStatusFilter', 'select'),
    hrDocTypeFilter: makeEl('hrDocTypeFilter', 'select'),
    hrDocAttachmentFilter: makeEl('hrDocAttachmentFilter', 'select'),
    hrDocCategoryBar: makeEl('hrDocCategoryBar'),
    hrDocStats: makeEl('hrDocStats'),
    hrDocResults: makeEl('hrDocResults')
  };

  const sampleDocs = [
    {
      id: 'd1',
      document_name: 'Fire Safety Audit',
      doc_type: 'Safety',
      holder: 'Arora Textiles Private Limited',
      issue_date: '2026-01-10',
      last_renewal_date: '2026-06-01',
      expiry_date: '2027-01-10',
      file_name: 'fire_audit.pdf',
      file_data: 'data:application/pdf;base64,JVBERi0='
    },
    {
      id: 'd2',
      document_name: 'POSH Policy',
      doc_type: 'HR Policy',
      remarks: 'Annual compliance',
      expiry_date: '2020-01-01'
    }
  ];

  let exportedFile = null;
  let exportedRows = null;
  let toastMsg = '';

  const sandbox = {
    window: {
      hrDocGetDocs: () => sampleDocs,
      hrDocStatus: (d) => d.id === 'd2' ? { k: 'EXPIRED', n: -5, label: 'Expired' } : { k: 'VALID', n: 50, label: 'Valid' },
      hrDocClearSearch: () => {},
      showToast: (m) => { toastMsg = m; },
      XLSX: {
        utils: {
          json_to_sheet: (rows) => { exportedRows = rows; return {}; },
          book_new: () => ({}),
          book_append_sheet: () => {}
        },
        writeFile: (_wb, name) => { exportedFile = name; }
      }
    },
    document: {
      readyState: 'complete',
      getElementById: (id) => els[id] || null,
      createElement: (tag) => makeEl('', tag)
    },
    dateText: (v) => v || '—',
    setTimeout: () => {},
    console,
    Array,
    Set,
    Object,
    String,
    Number,
    Date,
    Promise
  };
  sandbox.window.window = sandbox.window;
  sandbox.window.XLSX = sandbox.window.XLSX;
  sandbox.XLSX = sandbox.window.XLSX;

  vm.runInNewContext(blockCode, sandbox);
  sandbox.window.hrDocRender();

  // Check clickable KPI cards
  assert.ok(els.hrDocStats.innerHTML.includes('stat-total'), 'KPI Total card must have color class');
  assert.ok(els.hrDocStats.innerHTML.includes('stat-valid'), 'KPI Valid card must have color class');
  assert.ok(els.hrDocStats.innerHTML.includes('stat-due'), 'KPI Due card must have color class');
  assert.ok(els.hrDocStats.innerHTML.includes('stat-expired'), 'KPI Expired card must have color class');
  assert.ok(els.hrDocStats.innerHTML.includes('hrDocSetStatusFilter'), 'KPI cards must be clickable');

  // Check quick category chips
  assert.ok(els.hrDocCategoryBar.innerHTML.includes('All <span class="hr-cat-count">2</span>'), 'Category bar must show All count');
  assert.ok(els.hrDocCategoryBar.innerHTML.includes('Safety <span class="hr-cat-count">1</span>'), 'Category bar must show Safety count');

  // Check table rows: Preview button, Renewed date, type pill, Edit/Delete, no 1239px inline grid lock
  assert.ok(els.hrDocResults.innerHTML.includes('👁 Preview'), 'Table must render Preview button for attached file');
  assert.ok(els.hrDocResults.innerHTML.includes('Renewed: 2026-06-01'), 'Table must show last renewal date');
  assert.ok(els.hrDocResults.innerHTML.includes('hr-type-pill'), 'Table must render doc type pill');
  assert.ok(!els.hrDocResults.innerHTML.includes('125px 110px 125px 155px 230px 190px'), 'Must not lock grid width to 1239px');

  // Test KPI click filtering
  sandbox.window.hrDocSetStatusFilter('EXPIRED');
  assert.equal(els.hrDocStatusFilter.value, 'EXPIRED');
  assert.ok(els.hrDocResults.innerHTML.includes('POSH Policy'));
  assert.ok(!els.hrDocResults.innerHTML.includes('Fire Safety Audit'));

  // Test Excel export on filtered view
  sandbox.window.hrDocExportExcel();
  assert.ok(exportedFile && exportedFile.endsWith('.xlsx'), 'Export must generate xlsx file');
  assert.equal(exportedRows.length, 1);
  assert.equal(exportedRows[0]['Document Name'], 'POSH Policy');
  assert.ok(toastMsg.includes('export'), 'Export must show toast');

  // Test Category chip filtering
  sandbox.window.hrDocSetStatusFilter('ALL');
  sandbox.window.hrDocSetTypeFilter('Safety');
  assert.equal(els.hrDocTypeFilter.value, 'Safety');
  assert.ok(els.hrDocResults.innerHTML.includes('Fire Safety Audit'));
  assert.ok(!els.hrDocResults.innerHTML.includes('POSH Policy'));
});
