const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');

test('contribution parser returns latest real month despite gaps',()=>{
  const code=read('compliance-dol-index-v1.js');
  const ctx={module:{exports:{}},exports:{}};vm.runInNewContext(code,ctx);
  const api=ctx.module.exports;
  assert.equal(api.latest([{period:'2026-02'},{period:'2026-04'},{period:'2026-06'}]).period,'2026-06');
  const esic=api.fromRows([['IP Number','Employee Name','Total Contribution'],['1234567890','Asha','500']],'esic');
  assert.deepEqual(Array.from(esic.ids),['1234567890']);
  assert.equal(esic.contributions[0].employeeName,'Asha');
  assert.equal(esic.contributions[0].details.totalContribution,'500');
});

test('production V5 enforces permissions and strict PF/ESIC backend boundaries',()=>{
  const b=read('backend/Backend-V4-Complete-Code.gs');
  assert.match(b,/requireFeature_\(p\.token,dolFeature_\(type\)\)/);
  assert.match(b,/hasFeature_\(u,dolFeature_\(meta\.type\)\)/);
  assert.match(b,/systemKindAllowed_/);
  assert.match(b,/DOL_CONTRIBUTIONS_SHEET/);
  assert.match(b,/dolFolder_\(meta\.type,meta\.period\)/);
  assert.match(b,/deleteDolContributionsUnlocked_\(old\.id\)/);
  ['beginDOLIndex','finalizeDOLIndex','searchDOLIndex','listComplianceCalendar','upsertDOLContributionBatch','upsertComplianceCalendar','deleteComplianceCalendar','claimComplianceNotification'].forEach(a=>assert.ok(b.includes("action === '"+a+"'"),a));
});

test('calendar and challan production UI contracts are mounted',()=>{
  const h=read('index.html'),c=read('compliance-calendar-v1.js'),d=read('compliance-dol-rebuild-v2.js');
  assert.ok(h.includes('compliance-calendar-v1.js'));
  ['vn-compliancecalendar','page-compliancecalendar','TRAINING','LEGAL DOCUMENTS','listComplianceCalendar','upsertComplianceCalendar','deleteComplianceCalendar'].forEach(x=>assert.ok(c.includes(x),x));
  ['monthfilter','downloadSelected','data-cd2-select','JSZip','Missing'].forEach(x=>assert.ok(d.includes(x),x));
});

test('shared sync is backend-authoritative without recurring poll',()=>{
  const restore=read('erp-account-cloud-restore-v1.js'),durable=read('erp-durable-everything-v1.js'),guard=read('erp-permission-guard-v1.js');
  assert.equal(restore.includes('setInterval('),false);
  assert.ok(durable.includes("action:'getSystemRecords'"));
  assert.ok(guard.includes('MutationObserver'));
  assert.ok(guard.includes('atpl-authenticated'));
});
