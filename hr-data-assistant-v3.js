/* Arora Textiles HR ERP Data Assistant V3 runtime — local repo payload, additive only. */
(function(){
'use strict';
if(window.__ARORA_HR_AI_V3_LOADER__)return;
window.__ARORA_HR_AI_V3_LOADER__=1;
function fail(e){console.error('HR ERP Data Assistant V3 failed to load',e);try{var b=document.getElementById('aiChatBox');if(b)b.dataset.v3Error='1';}catch(_){} }
try{
 var b64=window.__ARORA_AI_V3_GZ||'';
 if(!b64)throw new Error('V3 payload missing');
 if(typeof DecompressionStream!=='function')throw new Error('Browser local decompression unsupported');
 var bin=atob(b64),bytes=new Uint8Array(bin.length);
 for(var i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);
 var stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
 new Response(stream).text().then(function(code){try{(0,eval)(code);}catch(e){fail(e);}finally{try{delete window.__ARORA_AI_V3_GZ;}catch(_){}}},fail);
}catch(e){fail(e);}
})();
