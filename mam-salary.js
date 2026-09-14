/* ATPL Mam Salary bootstrap — July V4 first, then NEXT v3, generator, stable legacy. */
(function(){'use strict';
if(window.__ATPL_MAM_STABLE_BOOTSTRAP__)return;
window.__ATPL_MAM_STABLE_BOOTSTRAP__=1;
function load(src,done){var s=document.createElement('script');s.src=src;s.async=false;s.onload=function(){if(done)done()};s.onerror=function(){console.error('ATPL module load failed:',src);if(done)done(new Error(src+' load failed'))};document.head.appendChild(s)}
function legacy(){load('mam-salary-v2-legacy.js?v=20260911-stable1')}
function generatorFallback(){load('mam-salary-generator.js?v=20260914-generator1',function(err){if(err)legacy()})}
function v3Fallback(){load('mam-salary-next-v3.js?v=20260914-next3a',function(err){if(err||!window.__MAM_SALARY_NEXT_V3__)generatorFallback()})}
load('mam-salary-july-v4.js?v=20260914-july4',function(err){
  var old=document.getElementById('atplUpgradeLoadError');if(old)old.remove();
  if(err||!window.__MAM_SALARY_JULY_V4__)v3Fallback();
});
})();
