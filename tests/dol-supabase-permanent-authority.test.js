const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const index = fs.readFileSync('index.html','utf8');
const rebuild = fs.readFileSync('compliance-dol-rebuild-v2.js','utf8');
const adapter = fs.readFileSync('compliance-dol-supabase-v2.js','utf8');
const edge = fs.readFileSync('supabase/functions/dol-api/index.ts','utf8');

test('service worker update never force reloads active ERP session', () => {
  assert.equal(index.includes('window.location.reload()'), false);
  assert.match(index, /__ATPL_UPDATE_READY__/);
});

test('DOL loader order is legacy adapter, Supabase override, then UI rebuild', () => {
  const legacy = index.indexOf('compliance-dol-cloud-v4.js');
  const supa = index.indexOf('compliance-dol-supabase-v2.js');
  const ui = index.indexOf('compliance-dol-rebuild-v2.js');
  assert.ok(legacy >= 0);
  assert.ok(supa > legacy);
  assert.ok(ui > supa);
});

test('Supabase adapter is authoritative for list upload delete and files', () => {
  assert.match(adapter, /authority:'supabase'/);
  assert.match(adapter, /action:'list'/);
  assert.match(adapter, /action:'delete'/);
  assert.match(adapter, /action:'file'/);
  assert.match(adapter, /action:'upload'/);
  assert.match(adapter, /atpl-dol-sync-v2/);
  assert.match(adapter, /warmAuth/);
});

test('DOL UI does not render browser cache as authority in Supabase mode', () => {
  assert.match(rebuild, /if\(vaultApi\(\)&&vaultApi\(\)\.authority==='supabase'\)return false/);
  assert.match(rebuild, /mode:'supabase'/);
  assert.match(rebuild, /Deleted permanently from Supabase/);
  assert.match(rebuild, /directPurged/);
});

test('server prevents deleted challan resurrection and caches verified ERP auth', () => {
  assert.match(edge, /const TOMBSTONES = "dol_tombstones"/);
  assert.match(edge, /const AUTH_SESSIONS = "dol_auth_sessions"/);
  assert.match(edge, /Permanent delete ledger failed/);
  assert.match(edge, /deletedHashes\.has\(hash\)/);
  assert.match(edge, /runtime_authority: "supabase"/);
  assert.match(edge, /auth_cache_minutes: 60/);

  const deleteAt = edge.indexOf('.from(TOMBSTONES)\n        .upsert');
  const dbDeleteAt = edge.indexOf('.from(TABLE)\n        .delete()', deleteAt);
  assert.ok(deleteAt >= 0, 'server tombstone must be written');
  assert.ok(dbDeleteAt > deleteAt, 'permanent tombstone must be written before DB row deletion');
});

test('legacy cleanup cannot gate authoritative Supabase delete', () => {
  const start = edge.indexOf('if (action === "delete")');
  const end = edge.indexOf('if (action === "upload")', start);
  const block = edge.slice(start,end);
  const announce = block.indexOf('await announce(supabase, type)');
  const legacy = block.indexOf('deleteDOLRecord');
  assert.ok(announce >= 0);
  assert.ok(legacy > announce, 'legacy cleanup should happen only after authoritative delete succeeds');
});
