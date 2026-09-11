/* Arora Textiles HR ERP Data Assistant PRO V2 runtime — local repo payload only. */
(function(){
'use strict';
if(window.__ARORA_HR_AI_PRO_LOADER__) return;
window.__ARORA_HR_AI_PRO_LOADER__=1;
function fail(e){
  console.error('HR ERP Data Assistant PRO failed to load',e);
  try{var b=document.getElementById('aiChatBtn');if(b)b.title='AI PRO load error — refresh page';}catch(_){}
}
try{
  var b64=window.__ARORA_AI_PRO_GZ||'';
  if(!b64) throw new Error('AI PRO payload missing');
  if(typeof DecompressionStream!=='function') throw new Error('Browser does not support local gzip decompression');
  var bin=atob(b64),bytes=new Uint8Array(bin.length);
  for(var i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);
  var stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  new Response(stream).text().then(function(code){
    try{(0,eval)(code);}catch(e){fail(e);}finally{try{delete window.__ARORA_AI_PRO_GZ;}catch(_){}}
  },fail);
}catch(e){fail(e);}
})();
