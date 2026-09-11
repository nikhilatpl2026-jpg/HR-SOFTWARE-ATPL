/* ATPL Mam Salary bootstrap — preserves the existing working module, then applies requested ERP upgrades. */
(function(){'use strict';
if(window.__ATPL_MAM_UPGRADE_BOOTSTRAP__)return;window.__ATPL_MAM_UPGRADE_BOOTSTRAP__=1;
function load(src,done){var s=document.createElement('script');s.src=src;s.async=false;s.onload=function(){if(done)done()};s.onerror=function(){console.error('ATPL module load failed:',src);if(done)done(new Error(src+' load failed'))};document.head.appendChild(s)}
load('mam-salary-v2-legacy.js?v=20260911a',function(err){if(err)return;load('erp-upgrades-loader.js?v=20260911a')});
})();
