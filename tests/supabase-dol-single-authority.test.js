const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ROOT=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(ROOT,p),'utf8');

test('Supabase DOL files parse and load in authority order',()=>{
  const h=read('index.html'),s=read('compliance-dol-supabase-v1.js'),r=read('compliance-dol-rebuild-v2.js');
  assert.doesNotThrow(()=>new Function(s),'supabase adapter syntax');
  assert.doesNotThrow(()=>new Function(r),'rebuild syntax');
  const legacy=h.indexOf('compliance-dol-cloud-v4.js');
  const supa=h.indexOf('compliance-dol-supabase-v1.js');
  const rebuild=h.indexOf('compliance-dol-rebuild-v2.js');
  assert.ok(legacy>0&&legacy<supa&&supa<rebuild,'legacy -> supabase -> rebuild loader order');
  assert.ok(h.includes('supabase-authority4-server-migration'));
  assert.ok(h.includes('production19-stable-supabase-first-load'));
});

test('Supabase adapter is the only normal DOL authority and has no polling',()=>{
  const s=read('compliance-dol-supabase-v1.js');
  assert.ok(s.includes("authority:'supabase'"));
  assert.ok(s.includes("var legacy=root.ATPLDOLCloudV4||null"));
  assert.ok(s.includes("root.ATPLDOLCloudV4=api"));
  assert.equal(s.includes('setInterval('),false);
  assert.equal(s.includes('syncEventExists('),false,'migration must not be skipped by an unrelated sync event');
  const listBody=s.slice(s.indexOf('async function list(type)'),s.indexOf('async function check(hash)'));
  assert.ok(listBody.includes('await listRaw(type,true)'));
  assert.equal(listBody.includes('maybeStartLegacyMigration'),false,'browser list must not run legacy migration');
});

test('Edge request/response mapping matches DOL contract',()=>{
  const s=read('compliance-dol-supabase-v1.js');
  ['dol_challans','dol_sync_events'].forEach(()=>{});
  ["action:'list'","action:'updatePeriod'","action:'delete'","action:'file'"].forEach(x=>assert.ok(s.includes(x),x));
  ["form.append('action','upload')","form.append('type',type)","form.append('period'","form.append('uploaded_by'","form.append('member_ids'","form.append('contributions'","form.append('file_hash'","form.append('file_size'","form.append('mime_type'","form.append('file'"].forEach(x=>assert.ok(s.includes(x),x));
  ['r.challan_type','r.file_name','r.file_path','r.file_hash','r.mime_type','r.file_size','r.uploaded_by','r.member_ids','r.contributions','r.created_at','r.updated_at'].forEach(x=>assert.ok(s.includes(x),x));
  assert.ok(s.includes("hasOriginalFile:!!String(r.file_path||'')"));
  assert.ok(s.includes('Supabase upload returned an incomplete stored record'));
  assert.ok(s.includes('Supabase SHA-256 verification failed'));
});

test('Realtime is event driven through dol_sync_events with recovery hooks',()=>{
  const s=read('compliance-dol-supabase-v1.js');
  assert.ok(s.includes("table:'dol_sync_events'"));
  assert.ok(s.includes("event:'INSERT'"));
  assert.ok(s.includes("status==='SUBSCRIBED'"));
  assert.ok(s.includes("status==='CHANNEL_ERROR'||status==='TIMED_OUT'||status==='CLOSED'"));
  assert.ok(s.includes("root.addEventListener('online',resumeRealtime)"));
  assert.ok(s.includes("document.addEventListener('atpl-authenticated',resumeRealtime)"));
  assert.equal(s.includes('setInterval('),false);
});

test('Open and Download are Supabase signed-file first, not local-cache first',()=>{
  const r=read('compliance-dol-rebuild-v2.js'),s=read('compliance-dol-supabase-v1.js');
  const a=r.indexOf('async function recordBlob(type,rec,progress)');
  const b=r.indexOf('function periodLabel',a);
  const body=r.slice(a,b);
  assert.ok(body.indexOf("v&&v.authority==='supabase'")>=0);
  assert.ok(body.indexOf("v.fileBlob(rec,progress)")>=0);
  assert.ok(body.indexOf("v.fileBlob(rec,progress)")<body.indexOf('getStoredBlob(rec)'),'Supabase must be consulted before local cache');
  assert.ok(s.includes("var info=await signedFile(rec);if(!info.url)throw new Error('Signed file URL missing')"));
  assert.ok(s.includes("var res=await timeoutFetch(info.url,{method:'GET'},45000)"));
});

test('Delete and period update are Supabase-authoritative and purge browser copies',()=>{
  const r=read('compliance-dol-rebuild-v2.js');
  const d0=r.indexOf('async function deleteOne(type,id)');
  const d1=r.indexOf('function cloudRecordFromLocal',d0);
  const del=r.slice(d0,d1);
  assert.ok(del.includes("direct&&direct.authority==='supabase'"));
  assert.ok(del.includes('await direct.deleteRecord(r)'));
  assert.ok(del.includes('await opfsDelete(dx)'));
  assert.ok(del.includes('await dbDelete(dx.id)'));
  assert.ok(del.includes('await purgeLegacyLocalMatches(type,r)'));
  assert.ok(del.includes('await refresh(type)'));
  const u0=r.indexOf('async function updatePeriod(type,id,period)');
  const u1=r.indexOf('async function deleteOne',u0);
  const upd=r.slice(u0,u1);
  assert.ok(upd.includes("v&&v.authority==='supabase'&&typeof v.update==='function'"));
});

test('Legacy browser migration is retained only as an unused recovery helper',()=>{
  const s=read('compliance-dol-supabase-v1.js');
  const a=s.indexOf('async function maybeStartLegacyMigration(type)');
  const b=s.indexOf('async function list(type)',a);
  const m=s.slice(a,b);
  assert.ok(m.includes('await legacy.list(type)'));
  assert.ok(m.includes('await legacy.fileBlob(old'));
  assert.ok(m.includes('byHash[hash]&&byHash[hash].hasOriginalFile'));
  assert.ok(m.includes('var out=await upload(work,buf)'));
  assert.ok(m.includes("throw new Error('Supabase save did not return a complete stored record')"));
  assert.ok(m.includes("failures.push({name:String(old.name||'challan'),reason:String(e&&e.message||e)})"));
  assert.ok(m.includes('need manual re-upload'));
  assert.ok(s.includes('migrationReport:migrationReport'));
  const listBody=s.slice(s.indexOf('async function list(type)'),s.indexOf('async function check(hash)'));
  assert.equal(listBody.includes('maybeStartLegacyMigration'),false);
});

test('PF and ESIC stay isolated and duplicate check is fresh across both types',()=>{
  const s=read('compliance-dol-supabase-v1.js'),r=read('compliance-dol-rebuild-v2.js');
  assert.ok(s.includes("var types=['pf','esic']"));
  assert.ok(s.includes('listRaw(types[i],true)'));
  assert.ok(r.includes("parsed.detectedType&&parsed.detectedType!==type"));
  assert.ok(r.includes('cross-module duplicate blocked'));
  assert.ok(/if\(v&&v\.authority==='supabase'&&typeof v\.list==='function'\)[\s\S]*?return\{mode:'supabase',records:dedicated,dedicatedCount:dedicated\.length,legacyCount:0/.test(r));
});

test('Supabase authority does not schedule normal-runtime legacy historical repairs',()=>{
  const r=read('compliance-dol-rebuild-v2.js');
  assert.ok(r.includes("supabaseAuthority=!!(authority&&authority.authority==='supabase')"));
  assert.equal(r.includes("authority.migrateLegacy('pf');authority.migrateLegacy('esic')"),false,'Supabase migration must not run in the background');
  assert.ok(r.includes("if(promotable.length&&!(vaultApi()&&vaultApi().authority==='supabase'))"));
  assert.equal(r.includes('setInterval('),false);
});


test('Deployable dol-api is service-role only and migration locks browser access',()=>{
  const e=read('supabase/functions/dol-api/index.ts');
  const m=read('supabase/migrations/20260922_dol_single_authority.sql');
  const cfg=read('supabase/config.toml');
  assert.ok(e.includes('SUPABASE_SERVICE_ROLE_KEY'));
  assert.ok(e.includes('createClient(SUPABASE_URL, SERVICE_ROLE_KEY'));
  assert.equal(e.includes('SUPABASE_ANON_KEY'),false);
  assert.ok(e.includes('x-atpl-token'));
  assert.ok(e.includes('getDOLRecords'));
  assert.ok(e.includes('action === "health"'));
  assert.ok(e.includes('dol_sync_events'));
  assert.ok(e.includes('createSignedUrl(row.file_path, 300)'));
  assert.ok(e.includes('ensureLegacyIndex'));
  assert.ok(e.includes('materializeLegacyOriginal'));
  assert.ok(e.includes('dol_migration_state'));
  assert.ok(e.includes('legacy_source_id'));
  assert.ok(e.includes('await supabase.storage.from(BUCKET).remove([row.file_path])'));
  assert.ok(m.includes('revoke all on table public.dol_challans from anon, authenticated'));
  assert.ok(m.includes("grant select, insert, update, delete on table public.dol_challans to service_role"));
  assert.ok(m.includes("alter publication supabase_realtime add table public.dol_sync_events"));
  assert.ok(m.includes('dol_migration_state'));
  assert.ok(m.includes('legacy_source_id'));
  assert.ok(cfg.includes('[functions.dol-api]'));
  assert.ok(cfg.includes('verify_jwt = false'));
});
