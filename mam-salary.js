/* ATPL Mam Salary bootstrap — Compliance V5 first, then July V4, NEXT v3, generator, stable legacy. */
(function(){'use strict';
if(window.__ATPL_MAM_STABLE_BOOTSTRAP__)return;
window.__ATPL_MAM_STABLE_BOOTSTRAP__=1;
function load(src,done){var s=document.createElement('script');s.src=src;s.async=false;s.onload=function(){if(done)done()};s.onerror=function(){console.error('ATPL module load failed:',src);if(done)done(new Error(src+' load failed'))};document.head.appendChild(s)}
function loadAuthRecovery(){load('shared-auth-recovery-v1.js?v=20260914-authrecovery2')}
function loadShared(){load('erp-shared-activity-v2.js?v=20260916-shared3')}
function loadCloud(){load('erp-cloud-sync-v1.js?v=20260917-cloud4')}
function loadSharedStore(){load('erp-cloud-shared-storage-v1.js?v=20260916-sharedstore1')}
function loadPersistenceGuard(){load('erp-persistence-guard-v1.js?v=20260917-permanent1')}
function loadLokeshLock(done){load('mam-lokesh-format-lock-v2.js?v=20260916-lokeshlock2',done)}
function loadScopedV1(done){load('mam-compliance-v5-scoped-loader-v1.js?v=20260916-real-mam-format1',function(err){if(err||typeof window.ATPLLoadMamComplianceV5ScopedV1!=='function')return done(err||new Error('Scoped V1 loader unavailable'));window.ATPLLoadMamComplianceV5ScopedV1(done)})}
function runScopedV2(done){if(typeof window.ATPLLoadMamComplianceV5ScopedV2!=='function')return loadScopedV1(done);window.ATPLLoadMamComplianceV5ScopedV2(function(v2err){if(v2err&&!window.__MAM_COMPLIANCE_V5__)return loadScopedV1(done);done(v2err)})}
function loadScopedV3(done){load('mam-compliance-v5-scoped-loader-v2.js?v=20260916-calc-source4',function(v2scriptErr){if(v2scriptErr)return loadScopedV1(done);load('mam-compliance-v5-source-merge-v3.js?v=20260916-source-merge5',function(v3scriptErr){if(v3scriptErr||typeof window.ATPLLoadMamComplianceV5SourceMergeV3!=='function')return runScopedV2(done);window.ATPLLoadMamComplianceV5SourceMergeV3(function(v3err){if(v3err&&!window.__MAM_COMPLIANCE_V5__)return runScopedV2(done);done(v3err)})})})}
function legacy(){load('mam-salary-v2-legacy.js?v=20260911-stable1')}
function generatorFallback(){load('mam-salary-generator.js?v=20260914-generator1',function(err){if(err)legacy()})}
function v3Fallback(){load('mam-salary-next-v3.js?v=20260914-next3a',function(err){if(err||!window.__MAM_SALARY_NEXT_V3__)generatorFallback()})}
function v4Fallback(){load('mam-salary-july-v4.js?v=20260914-july4',function(err){if(err||!window.__MAM_SALARY_JULY_V4__)v3Fallback()})}
function v5(){loadLokeshLock(function(){load('mam-compliance-rules-india-v1.js?v=20260914-rules1a',function(ruleErr){
  if(ruleErr||!window.ATPLComplianceRulesIndiaV1)return v4Fallback();
  loadScopedV3(function(err){
    var old=document.getElementById('atplUpgradeLoadError');if(old)old.remove();
    if(err||!window.__MAM_COMPLIANCE_V5__)return v4Fallback();
    load('mam-compliance-v5-open-fix.js?v=20260914-openfix1',function(){load('mam-auditor-level-v1.js?v=20260914-auditor1')});
  });
})})}
loadAuthRecovery();
loadShared();
loadCloud();
loadSharedStore();
loadPersistenceGuard();
v5();
})();