/* ATPL ERP upgrades loader. Loads the staged upgrade bundle without changing existing modules. */
(function(){'use strict';
if(window.__ATPL_ERP_UPGRADES_LOADER__)return;window.__ATPL_ERP_UPGRADES_LOADER__=1;
function decodeBase64Bytes(text){
  var s=String(text||'').replace(/^\uFEFF/,'').replace(/\s+/g,'').replace(/-/g,'+').replace(/_/g,'/').replace(/[^A-Za-z0-9+/=]/g,'');
  while(s.length%4)s+='=';
  var abc='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/',out=[];
  for(var i=0;i<s.length;i+=4){
    var a=abc.indexOf(s.charAt(i)),b=abc.indexOf(s.charAt(i+1)),c=s.charAt(i+2)==='='?-1:abc.indexOf(s.charAt(i+2)),d=s.charAt(i+3)==='='?-1:abc.indexOf(s.charAt(i+3));
    if(a<0||b<0)continue;
    out.push((a<<2)|(b>>4));
    if(c>=0){out.push(((b&15)<<4)|(c>>2));if(d>=0)out.push(((c&3)<<6)|d)}
  }
  return new Uint8Array(out);
}
async function boot(){
  var res=await fetch('erp-upgrades.js.gz.b64?v=20260911-3',{cache:'no-store'});
  if(!res.ok)throw new Error('ERP upgrade bundle not found: '+res.status);
  var bytes=decodeBase64Bytes(await res.text());
  if(bytes.length<2||bytes[0]!==31||bytes[1]!==139)throw new Error('Upgrade bundle invalid/cached. Please hard refresh once.');
  if(typeof DecompressionStream!=='function')throw new Error('This browser does not support upgrade decompression. Please use current Chrome/Edge.');
  var ds=new DecompressionStream('gzip');
  var code=await new Response(new Blob([bytes]).stream().pipeThrough(ds)).text();
  (0,eval)(code+'\n//# sourceURL=erp-upgrades.js');
  var old=document.getElementById('atplUpgradeLoadError');if(old)old.remove();
  window.dispatchEvent(new CustomEvent('atpl:erp-upgrades-ready'));
}
boot().catch(function(err){console.error('ATPL ERP upgrades load failed',err);var el=document.getElementById('atplUpgradeLoadError');if(!el){el=document.createElement('div');el.id='atplUpgradeLoadError';el.style.cssText='position:fixed;right:12px;bottom:12px;z-index:999999;background:#7f1d1d;color:#fff;padding:10px 12px;border-radius:8px;font:12px Arial;max-width:360px';document.body.appendChild(el)}el.textContent='ERP upgrade module load issue: '+(err&&err.message?err.message:'Unknown error');});
})();
