/* Arora Textiles HR ERP Data Assistant runtime — payload is local to this repo; no network fetch. */
(function(){
'use strict';
if(window.__ARORA_HR_DATA_ASSISTANT_LOADER__) return;
window.__ARORA_HR_DATA_ASSISTANT_LOADER__=1;
function fail(e){
  console.error('HR ERP Data Assistant failed to load',e);
  try{
    var box=document.getElementById('aiChatBox');
    if(box) box.dataset.assistantError='1';
  }catch(_){}
}
try{
  var b64=window.__ARORA_AI_GZ||'';
  if(!b64) throw new Error('Assistant payload is missing');
  if(typeof DecompressionStream!=='function') throw new Error('Browser does not support required local decompression');
  var bin=atob(b64), bytes=new Uint8Array(bin.length);
  for(var i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i);
  var stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  new Response(stream).text().then(function(code){
    try{ (0,eval)(code); }
    catch(e){ fail(e); }
    finally{ try{ delete window.__ARORA_AI_GZ; }catch(_){} }
  },fail);
}catch(e){ fail(e); }
})();
