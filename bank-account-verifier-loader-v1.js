/* ATPL Bank Account Verifier V1 loader — isolated module. */
(function(g){'use strict';
if(g.__ATPL_BANK_ACCOUNT_VERIFIER_LOADER_V1__)return;g.__ATPL_BANK_ACCOUNT_VERIFIER_LOADER_V1__=1;
function fail(err){console.error('ATPL Bank Account Verifier failed to load:',err);try{var n=document.createElement('div');n.style.cssText='position:fixed;right:14px;bottom:14px;z-index:999999;background:#fff1f2;color:#be123c;border:1px solid #fecdd3;padding:10px 12px;border-radius:10px;font:600 11px Arial;max-width:360px';n.textContent='Bank A/C Verifier load failed. Refresh once. '+(err&&err.message?err.message:'');document.body.appendChild(n);}catch(_){}}
async function boot(){
 try{
  if(g.__ATPL_BANK_ACCOUNT_VERIFIER_V1__)return;
  if(typeof DecompressionStream!=='function')throw new Error('Browser gzip support unavailable');
  var r=await fetch('bank-account-verifier-v1.js.gz.b64?v=20260918-1',{cache:'no-store',credentials:'same-origin'});if(!r.ok)throw new Error('HTTP '+r.status);
  var b64=(await r.text()).replace(/\s+/g,''),bin=atob(b64),bytes=new Uint8Array(bin.length);for(var i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);
  var stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));var code=await new Response(stream).text();
  var s=document.createElement('script');s.type='text/javascript';s.text=code+'\n//# sourceURL=bank-account-verifier-v1.js';(document.head||document.documentElement).appendChild(s);if(s.parentNode)s.parentNode.removeChild(s);
  if(!g.__ATPL_BANK_ACCOUNT_VERIFIER_V1__)throw new Error('Module initialization failed');
 }catch(e){fail(e);}
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})(window);
