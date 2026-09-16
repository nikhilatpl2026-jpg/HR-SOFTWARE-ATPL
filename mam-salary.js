/* ATPL Mam Salary bootstrap — Compliance V5 first, then July V4, NEXT v3, generator, stable legacy. */
(function(){'use strict';
if(window.__ATPL_MAM_STABLE_BOOTSTRAP__)return;
window.__ATPL_MAM_STABLE_BOOTSTRAP__=1;
function load(src,done){var s=document.createElement('script');s.src=src;s.async=false;s.onload=function(){if(done)done()};s.onerror=function(){console.error('ATPL module load failed:',src);if(done)done(new Error(src+' load failed'))};document.head.appendChild(s)}
function loadAuthRecovery(){load('shared-auth-recovery-v1.js?v=20260914-authrecovery2')}
function loadShared(){load('erp-shared-activity-v2.js?v=20260914-shared2')}
function loadLokeshLock(done){load('mam-lokesh-format-lock-v1.js?v=20260915-lokeshlock1',done)}
function loadScopedV5(done){load('mam-compliance-v5-scoped-loader-v1.js?v=20260916-rootscope1',function(err){if(err||typeof window.ATPLLoadMamComplianceV5ScopedV1!=='function')return done(err||new Error('Scoped V5 loader unavailable'));window.ATPLLoadMamComplianceV5ScopedV1(done)})}
function legacy(){load('mam-salary-v2-legacy.js?v=20260911-stable1')}
function generatorFallback(){load('mam-salary-generator.js?v=20260914-generator1',function(err){if(err)legacy()})}
function v3Fallback(){load('mam-salary-next-v3.js?v=20260914-next3a',function(err){if(err||!window.__MAM_SALARY_NEXT_V3__)generatorFallback()})}
function v4Fallback(){load('mam-salary-july-v4.js?v=20260914-july4',function(err){if(err||!window.__MAM_SALARY_JULY_V4__)v3Fallback()})}
function v5(){loadLokeshLock(function(){load('mam-compliance-rules-india-v1.js?v=20260914-rules1a',function(ruleErr){
  if(ruleErr||!window.ATPLComplianceRulesIndiaV1)return v4Fallback();
  loadScopedV5(function(err){
    var old=document.getElementById('atplUpgradeLoadError');if(old)old.remove();
    if(err||!window.__MAM_COMPLIANCE_V5__)return v4Fallback();
    load('mam-compliance-v5-open-fix.js?v=20260914-openfix1',function(){load('mam-auditor-level-v1.js?v=20260914-auditor1')});
  });
})})}
loadAuthRecovery();
loadShared();
v5();
})();
