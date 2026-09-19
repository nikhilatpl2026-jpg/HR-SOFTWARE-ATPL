const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ROOT=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(ROOT,p),'utf8');
const html=read('index.html');

test('all root JavaScript and inline ERP scripts parse',()=>{
  const js=fs.readdirSync(ROOT).filter(x=>x.endsWith('.js'));
  for(const file of js) assert.doesNotThrow(()=>new Function(read(file)),file+' syntax');
  const inline=[...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1]).filter(x=>x.trim());
  inline.forEach((src,i)=>assert.doesNotThrow(()=>new Function(src),'index inline script #'+(i+1)));
});

test('all local script references exist',()=>{
  const refs=[...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map(m=>m[1].split('?')[0]).filter(x=>!/^https?:/i.test(x));
  refs.forEach(ref=>assert.ok(fs.existsSync(path.join(ROOT,ref)),'missing script '+ref));
});

test('static HTML ids are unique',()=>{
  const markup=html.replace(/<script\b[\s\S]*?<\/script>/gi,'');
  const ids=[...markup.matchAll(/\bid=["']([^"']+)["']/gi)].map(m=>m[1]),seen=new Set(),dups=[];
  ids.forEach(id=>seen.has(id)?dups.push(id):seen.add(id));
  assert.deepEqual([...new Set(dups)],[]);
});

test('navigation controls resolve to real or explicitly dynamic pages',()=>{
  const markup=html.replace(/<script\b[\s\S]*?<\/script>/gi,'');
  const targets=[...markup.matchAll(/goPage\(['"]([^'"]+)['"]\)/g)].map(m=>m[1]);
  const dynamic=new Set(['esictodol','pftodol']);
  targets.forEach(t=>assert.ok(dynamic.has(t)||html.includes('id="page-'+t+'"')||html.includes("id='page-"+t+"'"),'dead goPage target '+t));
});

test('every static button has an action hook',()=>{
  const markup=html.replace(/<script\b[\s\S]*?<\/script>/gi,'');
  const buttons=[...markup.matchAll(/<button\b([^>]*)>/gi)].map(m=>m[1]);
  const dead=buttons.filter(a=>!(/\bon\w+\s*=|\bid\s*=|\bdata-[\w-]+\s*=|\btype\s*=\s*["']submit["']/i.test(a)));
  assert.equal(dead.length,0,'buttons without onclick/id/data hook: '+dead.slice(0,5).join(' | '));
});

test('User Access save/delete commit UI only after backend confirmation',()=>{
  const s=read('shared-auth.js');
  function body(name,next){
    const i=s.indexOf('async function '+name+'('),j=s.indexOf(next,i);assert.ok(i>=0&&j>i,name+' function boundary');return s.slice(i,j);
  }
  const save=body('saveFast','async function delFast');
  assert.ok(save.indexOf("api({action:'saveUser'")>=0);
  assert.ok(save.indexOf("api({action:'saveUser'")<save.indexOf('upsert(r.user)'),'save UI must mutate after backend response');
  assert.equal(save.includes('__pending:true'),false,'no optimistic saved user');
  const del=body('delFast','function randomSecret');
  assert.ok(del.indexOf("api({action:'deleteUser'")>=0);
  assert.ok(del.indexOf("api({action:'deleteUser'")<del.indexOf('fastUsers=fastUsers.filter'),'delete UI must mutate after backend response');
});

test('fallback login unlocks UI before noncritical hydration',()=>{
  const s=read('shared-auth.js'),i=s.indexOf('async function remoteLogin()'),j=s.indexOf('function renderChecks',i),b=s.slice(i,j);
  const unlock=b.indexOf("document.body.classList.remove('uaLocked')");
  const hydrate=b.indexOf('hydrateSharedData(r.user,r.token)');
  assert.ok(unlock>=0&&hydrate>unlock,'fallback login must not block UI on full sync');
  assert.equal(/await\s+hydrateSharedData/.test(b),false);
});

test('critical modules use installation/build guards',()=>{
  const files=['erp-cloud-api-broker-v1.js','erp-mobile-shared-hardfix-v1.js','erp-cloud-sync-v1.js','compliance-dol-cloud-v4.js','compliance-dol-rebuild-v2.js'];
  files.forEach(f=>{const s=read(f);assert.ok(/__ATPL_[A-Z0-9_]+/.test(s),f+' missing idempotent install guard')});
});
