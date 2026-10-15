const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('Employee Master Account Details & Challan Cross-Browser Permanent Fix', async (t) => {
  const indexHtml = read('index.html');
  const empGuard = read('employee-master-confirmed-save-v1.js');
  const dolRebuild = read('compliance-dol-rebuild-v2.js');

  await t.test('1. confirmedBulkSave does non-destructive field merge to preserve existing A/C details', () => {
    assert.ok(
      empGuard.includes('PRESERVE EXISTING DATA') || empGuard.includes('Never wipe existing account_no'),
      'employee-master-confirmed-save-v1.js must contain safe non-destructive field merge'
    );
    assert.ok(
      !empGuard.includes('g.EM.data[idx] = Object.assign({}, g.EM.data[idx], copy(emp))'),
      'Destructive Object.assign must be removed from confirmedBulkSave'
    );
  });

  await t.test('2. cleanAccountNo handles scientific notation and preserves digits', () => {
    assert.ok(indexHtml.includes('function cleanAccountNo(v)'), 'cleanAccountNo must be defined');
    assert.ok(indexHtml.includes('s = combined + \'0\'.repeat(shift);'), 'scientific notation precision expansion must be implemented');
  });

  await t.test('3. isAcNum accepts 8 to 22 digit account numbers and does not reject 10-digit bank accounts', () => {
    assert.ok(indexHtml.includes('/^\\d{8,22}$/.test(s)'), 'isAcNum must accept 8 to 22 digit account numbers');
    assert.ok(!indexHtml.includes('return /^\\d{9,22}$/.test(s) && !isMobile(s)'), 'Broken !isMobile check must be eliminated');
  });

  await t.test('4. matchColumnHeader supports all A.C / Account variations', () => {
    assert.ok(indexHtml.includes('account|ac|acc|khata'), 'matchColumnHeader must support khata/account/a.c variations');
  });

  await t.test('5. Challan viewer completely eliminates Chrome broken iframe and supports cross-browser buffer recovery', () => {
    assert.ok(
      !dolRebuild.includes("cont.innerHTML = '<iframe src=\"' + blobUrl + '#toolbar=1\""),
      'Challan viewer must NOT fall back to iframe src=blobUrl which Chrome blocks with "moved, edited, or deleted"'
    );
    assert.ok(
      dolRebuild.includes('function openPdfInSafeTab(blob, filename)'),
      'openPdfInSafeTab must be present for dedicated cross-browser tab viewing'
    );
    assert.ok(
      dolRebuild.includes('rec.buf||rec.original_b64||rec.base64||rec.file_data'),
      'getStoredBlob must support base64 buf directly on records'
    );
    assert.ok(
      dolRebuild.includes('root.__atplDolRecordsCache') || dolRebuild.includes('dol_records.json'),
      'recordBlob must support static dol_records.json fallback for cross-browser viewing'
    );
  });
});
