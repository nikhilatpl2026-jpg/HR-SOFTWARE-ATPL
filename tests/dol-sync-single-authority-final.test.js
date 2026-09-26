const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ROOT=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(ROOT,p),'utf8');

test('DOL loads legacy adapter, then Supabase authority, then rebuild UI',()=>{
  const h=read('index.html'),s=read('compliance-dol-supabase-v1.js'),r=read('compliance-dol-rebuild-v2.js');
  assert.doesNotThrow(()=>new Function(s));
  assert.doesNotThrow(()=>new Function(r));
  const legacy=h.indexOf('compliance-dol-cloud-v4.js');
  const supa=h.indexOf('compliance-dol-supabase-v1.js');
  const rebuild=h.indexOf('compliance-dol-rebuild-v2.js');
  assert.ok(legacy>0&&legacy<supa&&supa<rebuild);
});

test('Supabase is the normal PF/ESIC DOL authority',()=>{
  const s=read('compliance-dol-supabase-v1.js'),r=read('compliance-dol-rebuild-v2.js');
  assert.ok(s.includes("authority:'supabase'"));
  assert.ok(r.includes("v&&v.authority==='supabase'&&typeof v.list==='function'"));
  assert.ok(r.includes("await direct.deleteRecord(r)"));
  assert.ok(r.includes("v&&v.authority==='supabase'&&typeof v.update==='function'"));
  assert.equal(s.includes('setInterval('),false);
});

test('cross-browser invalidation is Realtime-event driven',()=>{
  const s=read('compliance-dol-supabase-v1.js'),e=read('supabase/functions/dol-api/index.ts');
  assert.ok(s.includes("table:'dol_sync_events'"));
  assert.ok(s.includes("event:'INSERT'"));
  assert.ok(e.includes('await announce(supabase, type)'));
});

test('migration schema matches Edge Function legacy contract',()=>{
  const m=read('supabase/migrations/20260922_dol_single_authority.sql');
  for(const col of ['legacy_source_id','legacy_source_kind','legacy_source_key','source_version']) assert.ok(m.includes(col),col);
});
