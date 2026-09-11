/* ATPL Mam Salary stable bootstrap — loads the existing working salary module only. */
(function(){'use strict';
if(window.__ATPL_MAM_STABLE_BOOTSTRAP__)return;
window.__ATPL_MAM_STABLE_BOOTSTRAP__=1;
function load(src,done){var s=document.createElement('script');s.src=src;s.async=false;s.onload=function(){if(done)done()};s.onerror=function(){console.error('ATPL module load failed:',src);if(done)done(new Error(src+' load failed'))};document.head.appendChild(s)}
load('mam-salary-v2-legacy.js?v=20260911-stable1',function(err){
  var old=document.getElementById('atplUpgradeLoadError');if(old)old.remove();
  if(err)console.error(err);
});
})();
