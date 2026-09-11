/* ATPL ERP upgrade compatibility loader — safe mode. No network fetch/decode. */
(function(){'use strict';
if(window.__ATPL_ERP_UPGRADES_LOADER_SAFE__)return;
window.__ATPL_ERP_UPGRADES_LOADER_SAFE__=1;
var old=document.getElementById('atplUpgradeLoadError');
if(old)old.remove();
try{window.dispatchEvent(new CustomEvent('atpl:erp-upgrades-ready',{detail:{safeMode:true}}));}catch(_){ }
})();
