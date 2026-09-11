/* ATPL ERP upgrades loader. Loads the staged upgrade bundle without changing existing modules. */
(function(){'use strict';
if(window.__ATPL_ERP_UPGRADES_LOADER__)return;window.__ATPL_ERP_UPGRADES_LOADER__=1;
function decodeBase64Safe(text){
  var b64=String(text||'').replace(/^\uFEFF/,'').trim().replace(/\s+/g,'').replace(/-/g,'+').replace(/_/g,'/');
  b64=b64.replace(/[^A-Za-z0-9+/=]/g,'');
  while(b64.length%4)b64+='=';
  return atob(b64);
}
async function boot(){
  var res=await fetch('erp-upgrades.js.gz.b64?v=20260911-2',{cache:'no-store'});
  if(!res.ok)throw new Error('ERP upgrade bundle not found: '+res.status);
  var raw=decodeBase64Safe(await res.text()),bytes=new Uint8Array(raw.length);
  for(var i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
  if(typeof DecompressionStream!=='function')throw new Error('This browser does not support upgrade decompression. Please use current Chrome/Edge.');
  var ds=new DecompressionStream('gzip');
  var code=await new Response(new Blob([bytes]).stream().pipeThrough(ds)).text();
  (0,eval)(code+'\n//# sourceURL=erp-upgrades.js');
  window.dispatchEvent(new CustomEvent('atpl:erp-upgrades-ready'));
}
boot().catch(function(err){console.error('ATPL ERP upgrades load failed',err);var el=document.getElementById('atplUpgradeLoadError');if(!el){el=document.createElement('div');el.id='atplUpgradeLoadError';el.style.cssText='position:fixed;right:12px;bottom:12px;z-index:999999;background:#7f1d1d;color:#fff;padding:10px 12px;border-radius:8px;font:12px Arial;max-width:360px';document.body.appendChild(el)}el.textContent='ERP upgrade module load issue: '+(err&&err.message?err.message:'Unknown error');});
})();
