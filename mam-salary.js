/* ATPL Mam Salary bootstrap — fast lazy build.
   Startup only creates the nav. Heavy compliance modules load on first open. */
(function(){'use strict';
if(window.__ATPL_MAM_STABLE_BOOTSTRAP__)return;
window.__ATPL_MAM_STABLE_BOOTSTRAP__='2026.09.19-lazy-fast10';
var loading=null,loaded=false;

function load(src,done){
  var s=document.createElement('script'),finished=false;
  var t=setTimeout(function(){if(finished)return;finished=true;if(s.parentNode)s.parentNode.removeChild(s);if(done)done(new Error(src+' timeout'))},7000);
  s.src=src;s.async=false;
  s.onload=function(){if(finished)return;finished=true;clearTimeout(t);if(done)done()};
  s.onerror=function(){if(finished)return;finished=true;clearTimeout(t);console.error('ATPL module load failed:',src);if(done)done(new Error(src+' load failed'))};
  document.head.appendChild(s)
}
function loadLokeshLock(done){load('mam-lokesh-format-lock-v2.js?v=20260916-lokeshlock2',done)}
function loadScopedV1(done){load('mam-compliance-v5-scoped-loader-v1.js?v=20260916-real-mam-format1',function(err){if(err||typeof window.ATPLLoadMamComplianceV5ScopedV1!=='function')return done(err||new Error('Scoped V1 loader unavailable'));window.ATPLLoadMamComplianceV5ScopedV1(done)})}
function runScopedV2(done){if(typeof window.ATPLLoadMamComplianceV5ScopedV2!=='function')return loadScopedV1(done);window.ATPLLoadMamComplianceV5ScopedV2(function(v2err){if(v2err&&!window.__MAM_COMPLIANCE_V5__)return loadScopedV1(done);done(v2err)})}
function loadScopedV3(done){load('mam-compliance-v5-scoped-loader-v2.js?v=20260916-calc-source4',function(v2scriptErr){if(v2scriptErr)return loadScopedV1(done);load('mam-compliance-v5-source-merge-v3.js?v=20260916-source-merge5',function(v3scriptErr){if(v3scriptErr||typeof window.ATPLLoadMamComplianceV5SourceMergeV3!=='function')return runScopedV2(done);window.ATPLLoadMamComplianceV5SourceMergeV3(function(v3err){if(v3err&&!window.__MAM_COMPLIANCE_V5__)return runScopedV2(done);done(v3err)})})})}
function legacy(done){load('mam-salary-v2-legacy.js?v=20260911-stable1',done)}
function generatorFallback(done){load('mam-salary-generator.js?v=20260914-generator1',function(err){if(err)return legacy(done);done&&done()})}
function v3Fallback(done){load('mam-salary-next-v3.js?v=20260914-next3a',function(err){if(err||!window.__MAM_SALARY_NEXT_V3__)return generatorFallback(done);done&&done()})}
function v4Fallback(done){load('mam-salary-july-v4.js?v=20260914-july4',function(err){if(err||!window.__MAM_SALARY_JULY_V4__)return v3Fallback(done);done&&done()})}
function v5(done){loadLokeshLock(function(){load('mam-compliance-rules-india-v1.js?v=20260914-rules1a',function(ruleErr){
  if(ruleErr||!window.ATPLComplianceRulesIndiaV1)return v4Fallback(done);
  loadScopedV3(function(err){
    var old=document.getElementById('atplUpgradeLoadError');if(old)old.remove();
    if(err||!window.__MAM_COMPLIANCE_V5__)return v4Fallback(done);
    load('mam-compliance-v5-open-fix.js?v=20260914-openfix1',function(){load('mam-auditor-level-v1.js?v=20260914-auditor1',function(){done&&done()})});
  });
})})}

function ensureNav(){
  if(document.getElementById('vn-mamsalary'))return;
  var anchor=document.getElementById('vn-sync');if(!anchor||!anchor.parentNode)return;
  var nav=document.createElement('div');nav.id='vn-mamsalary';nav.className='vitem';nav.innerHTML='<span class="vi">🧾</span>Mam → Compliance';
  nav.onclick=function(ev){if(ev){ev.preventDefault();ev.stopPropagation()}openMam()};
  anchor.parentNode.insertBefore(nav,anchor.nextSibling);
}
function openWhenReady(){
  var n=0;(function wait(){
    if(document.getElementById('page-mamsalary')){if(typeof window.goPage==='function')window.goPage('mamsalary');return}
    if(++n<80)setTimeout(wait,50);
    else alert('Mam → Compliance load nahi hua. Dobara click karo.')
  })()
}
function loadNow(){
  if(loaded||window.__MAM_COMPLIANCE_V5__){loaded=true;return Promise.resolve(true)}
  if(loading)return loading;
  loading=new Promise(function(resolve,reject){
    v5(function(err){if(err&&!window.__MAM_COMPLIANCE_V5__){loading=null;reject(err);return}loaded=true;resolve(true)})
  });
  return loading
}
function openMam(){
  var n=document.getElementById('vn-mamsalary');if(n)n.innerHTML='<span class="vi">⏳</span>Mam → Compliance';
  loadNow().then(function(){openWhenReady()}).catch(function(e){console.error(e);alert('Mam → Compliance load issue: '+(e&&e.message?e.message:e));ensureNav()})
}
window.ATPLLoadMamSalary=loadNow;
function start(){ensureNav()}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();