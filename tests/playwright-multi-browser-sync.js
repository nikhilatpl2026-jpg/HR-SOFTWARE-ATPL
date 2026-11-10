const { chromium } = require('playwright');
const assert = require('node:assert/strict');

(async () => {
  console.log('--- Starting Dual-Browser E2E Live Sync Test ---');
  const browser = await chromium.launch({ headless: true });
  
  try {
    // Context 1: Desktop Browser
    const context1 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page1 = await context1.newPage();

    // Context 2: Mobile / Second Browser
    const context2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page2 = await context2.newPage();

    console.log('1. Loading http://localhost:3000 on Browser 1 and Browser 2...');
    await page1.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });
    await page2.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });

    // Wait 2 seconds for initial sync and UI hydration
    await page1.waitForTimeout(2000);
    await page2.waitForTimeout(2000);

    // Switch to Employee Master on both browsers
    console.log('2. Switching both browsers to Employee Master view...');
    await page1.evaluate(() => {
      const btn = document.querySelector('button[onclick*="showView(\'master\')"]') || document.querySelector('[data-view="master"]');
      if (btn) btn.click();
      if (typeof window.showView === 'function') window.showView('master');
    });
    await page2.evaluate(() => {
      const btn = document.querySelector('button[onclick*="showView(\'master\')"]') || document.querySelector('[data-view="master"]');
      if (btn) btn.click();
      if (typeof window.showView === 'function') window.showView('master');
    });

    await page1.waitForTimeout(1000);
    await page2.waitForTimeout(1000);

    // Check count on both browsers
    const count1Initial = await page1.evaluate(() => (window.EM && Array.isArray(window.EM.data)) ? window.EM.data.length : 0);
    const count2Initial = await page2.evaluate(() => (window.EM && Array.isArray(window.EM.data)) ? window.EM.data.length : 0);
    console.log(`Initial Employee count: Browser 1 = ${count1Initial}, Browser 2 = ${count2Initial}`);
    assert.strictEqual(count1Initial, count2Initial, 'Both browsers must have identical initial count');

    // 3. Test Real-Time Delete Sync across browsers
    console.log('3. Testing DELETE SYNC: Clearing all employees from Browser 1...');
    await page1.evaluate(async () => {
      if (window.ATPLGoogleSync && typeof window.ATPLGoogleSync.clearAllEmployees === 'function') {
        await window.ATPLGoogleSync.clearAllEmployees();
      } else {
        await fetch('/api/sync/employee-master', { method: 'DELETE' });
      }
    });

    // Wait up to 3 seconds for Browser 2 to receive real-time sync event
    let clearedOnB2 = false;
    for (let i = 0; i < 30; i++) {
      const c2 = await page2.evaluate(() => (window.EM && Array.isArray(window.EM.data)) ? window.EM.data.length : 0);
      if (c2 === 0) {
        clearedOnB2 = true;
        break;
      }
      await page2.waitForTimeout(100);
    }
    assert.ok(clearedOnB2, 'Browser 2 must automatically reflect 0 employees when Browser 1 deletes all');
    console.log('✓ Real-time delete sync confirmed! Browser 2 instantly reached 0 employees.');

    // 4. Test Real-Time Add Sync across browsers
    console.log('4. Testing ADD SYNC: Adding new employee 99001 in Browser 1...');
    const testEmp = {
      emp_id: '99001',
      name: 'ANIL KAPOOR',
      dept: 'PROCESSING & FINISHING',
      gross: 35000,
      basic: 25200,
      hra: 9800
    };
    await page1.evaluate(async (emp) => {
      if (window.EM && Array.isArray(window.EM.data)) {
        window.EM.data.push(emp);
      }
      await fetch('/api/sync/employee-master', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ records: [emp], mode: 'upsert' })
      });
      if (window.ATPLGoogleSync && typeof window.ATPLGoogleSync.upsertEmployeeMaster === 'function') {
        window.ATPLGoogleSync.upsertEmployeeMaster([emp]);
      }
    }, testEmp);

    let addedOnB2 = false;
    for (let i = 0; i < 30; i++) {
      const found = await page2.evaluate(() => {
        return window.EM && Array.isArray(window.EM.data) && window.EM.data.some(e => String(e.emp_id) === '99001');
      });
      if (found) {
        addedOnB2 = true;
        break;
      }
      await page2.waitForTimeout(100);
    }
    assert.ok(addedOnB2, 'Browser 2 must automatically reflect new employee 99001 added in Browser 1');
    console.log('✓ Real-time add sync confirmed! Browser 2 instantly received employee 99001.');

    // 5. Test Real-Time Edit Sync across browsers
    console.log('5. Testing EDIT SYNC: Modifying employee 99001 in Browser 1...');
    const updatedEmp = {
      emp_id: '99001',
      name: 'ANIL KAPOOR (GENERAL MANAGER)',
      dept: 'CORPORATE HQ',
      gross: 65000,
      basic: 46800,
      hra: 18200
    };
    await page1.evaluate(async (emp) => {
      const idx = window.EM.data.findIndex(e => String(e.emp_id) === '99001');
      if (idx >= 0) window.EM.data[idx] = Object.assign({}, window.EM.data[idx], emp);
      await fetch('/api/sync/employee-master', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ records: [emp], mode: 'upsert' })
      });
    }, updatedEmp);

    let editedOnB2 = false;
    for (let i = 0; i < 30; i++) {
      const empB2 = await page2.evaluate(() => {
        return window.EM && Array.isArray(window.EM.data) ? window.EM.data.find(e => String(e.emp_id) === '99001') : null;
      });
      if (empB2 && empB2.name === 'ANIL KAPOOR (GENERAL MANAGER)' && empB2.gross === 65000) {
        editedOnB2 = true;
        break;
      }
      await page2.waitForTimeout(100);
    }
    assert.ok(editedOnB2, 'Browser 2 must automatically reflect updated name and salary');
    console.log('✓ Real-time edit sync confirmed! Browser 2 instantly updated name to ANIL KAPOOR (GENERAL MANAGER) and gross to 65000.');

    // 6. Test Page Refresh Persistence on Browser 2
    console.log('6. Testing Refresh Persistence: Reloading Browser 2...');
    await page2.reload({ waitUntil: 'domcontentloaded' });
    await page2.waitForTimeout(1500);

    const empAfterReload = await page2.evaluate(() => {
      return window.EM && Array.isArray(window.EM.data) ? window.EM.data.find(e => String(e.emp_id) === '99001') : null;
    });
    assert.ok(empAfterReload, 'Employee 99001 must persist permanently on Browser 2 after refresh');
    assert.strictEqual(empAfterReload.name, 'ANIL KAPOOR (GENERAL MANAGER)');
    assert.strictEqual(empAfterReload.gross, 65000);
    console.log('✓ Persistence confirmed! Employee 99001 persisted permanently after page refresh.');

    // Restore initial 454 dataset for production readiness
    console.log('7. Restoring original Employee Master records in server database...');
    const originalVaultJson = fs.readFileSync(path.join(__dirname, '..', 'data', 'employee_master.json'), 'utf8');
    const originalRecords = JSON.parse(originalVaultJson);
    await page1.evaluate(async (records) => {
      await fetch('/api/sync/employee-master', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ records: records, mode: 'replace' })
      });
    }, originalRecords);
    await page1.waitForTimeout(1000);

    console.log('=== ALL REAL-TIME MULTI-BROWSER TESTS PASSED 100%! ===');
    await browser.close();
    process.exit(0);
  } catch (err) {
    console.error('Playwright Test Failed:', err);
    await browser.close();
    process.exit(1);
  }
})();
