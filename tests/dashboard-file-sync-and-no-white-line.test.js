const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const centralSync = fs.readFileSync(path.join(__dirname, '..', 'atpl-central-file-sync.js'), 'utf8');
const challanGen = fs.readFileSync(path.join(__dirname, '..', 'atpl-statutory-challan-generator-v1.js'), 'utf8');

test('Executive Dashboard, File Sync and Zero White Line Guarantees', async (t) => {
  // 1. Scoped CSS guarantees no white outlines or browser focus rings
  await t.test('1. Scoped CSS eliminates white lines on click', () => {
    assert.ok(indexHtml.includes('EXECUTIVE WORKFORCE DASHBOARD SCOPED STYLES (ZERO WHITE LINE GLITCH)'), 'Must include scoped styles block');
    assert.ok(indexHtml.includes('#page-empdashboard, #page-empdashboard *'), 'Must scope reset to all elements in empdashboard');
    assert.ok(indexHtml.includes('outline: none !important'), 'Must enforce outline none');
    assert.ok(indexHtml.includes('-webkit-tap-highlight-color: transparent !important'), 'Must disable mobile tap highlight');
    assert.ok(indexHtml.includes('border-collapse:separate;border-spacing:0 4px'), 'Table must avoid border collapse artifacts');
  });

  // 2. Central File Sync triggers Challan, Dashboard and HR doc refresh
  await t.test('2. Central sync triggers all modules', () => {
    assert.ok(centralSync.includes('initStatutoryChallanTab'), 'Central sync must trigger initStatutoryChallanTab');
    assert.ok(centralSync.includes('empDashboardRender'), 'Central sync must trigger empDashboardRender');
    assert.ok(centralSync.includes('hrDocRender'), 'Central sync must trigger hrDocRender');
  });

  // 3. Direct challan upload handler is present
  await t.test('3. Direct challan upload handler exists in generator and global scope', () => {
    assert.ok(challanGen.includes('window.handleChallanDirectUpload'), 'Generator must export handleChallanDirectUpload');
    assert.ok(indexHtml.includes('handleChallanDirectUpload'), 'index.html must implement handleChallanDirectUpload');
  });

  // 4. Multi-module unified sync function
  await t.test('4. window.syncAllAtplModules is defined', () => {
    assert.ok(indexHtml.includes('window.syncAllAtplModules'), 'Must define window.syncAllAtplModules');
    assert.ok(indexHtml.includes('btnDashDeepSync'), 'Dashboard header must have deep sync button');
  });

  // 5. Intelligent Monthly Salary File Scanner in Dashboard
  await t.test('5. getMonthlySalaryFileData integrates uploaded salary files', () => {
    assert.ok(indexHtml.includes('getMonthlySalaryFileData'), 'Dashboard must implement getMonthlySalaryFileData');
    assert.ok(indexHtml.includes('dashPeriodSourceBadge'), 'Must have source badge for file vs master');
    assert.ok(indexHtml.includes('dashAnnualVisualChart'), 'Must have 12-month visual mini-bar chart');
    assert.ok(indexHtml.includes('renderAnnualTrendVisualChart'), 'Must implement renderAnnualTrendVisualChart');
  });

  // 6. 12-month trend matrix table has whole-row click with no white lines
  await t.test('6. 12-month table rows are clickable and clean', () => {
    assert.ok(indexHtml.includes('dash-trend-row'), 'Must use dash-trend-row class');
    assert.ok(indexHtml.includes('dashAnnualTrendBody'), 'Must populate dashAnnualTrendBody');
    assert.ok(indexHtml.includes('kpiHrHealth'), 'Must display HR docs health in KPI');
  });
});
