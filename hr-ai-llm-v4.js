/* Arora ERP LLM V4 runtime — additive local payload loader. */
(function(){
'use strict';
if(window.__ARORA_LLM_V4_LOADER__)return;window.__ARORA_LLM_V4_LOADER__=1;
function fail(e){console.error('Arora ERP LLM V4 failed to load',e);}
try{var b64=window.__ARORA_LLM_V4_GZ||'';if(!b64)throw new Error('LLM V4 payload missing');if(typeof DecompressionStream!=='function')throw new Error('Browser decompression unsupported');var bin=atob(b64),bytes=new Uint8Array(bin.length);for(var i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);var stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));new Response(stream).text().then(function(code){try{(0,eval)(code);}catch(e){fail(e);}finally{try{delete window.__ARORA_LLM_V4_GZ;}catch(_){}}},fail);}catch(e){fail(e);}
})();
