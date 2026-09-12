/* Arora ERP AI PRO V8 fast cached runtime — split payload loader. */
(function(){
'use strict';
if(window.__ARORA_AI_V8_BOOT__)return;window.__ARORA_AI_V8_BOOT__=1;
function fail(e){console.error('AI V8 load failed',e);alert('AI Assistant load nahi hua. Refresh karke try karo.');}
try{
  var b=window.__ARORA_AI_V8_B64||'';
  if(!b||b.length<12000)throw new Error('AI V8 payload incomplete: '+b.length);
  if(typeof DecompressionStream!=='function')throw new Error('Browser decompression unsupported');
  var x=atob(b),u=new Uint8Array(x.length);
  for(var i=0;i<x.length;i++)u[i]=x.charCodeAt(i);
  var s=new Blob([u]).stream().pipeThrough(new DecompressionStream('gzip'));
  new Response(s).text().then(function(c){try{(0,eval)(c);}catch(e){fail(e);}finally{try{delete window.__ARORA_AI_V8_B64;}catch(_){}}},fail);
}catch(e){fail(e);}
})();
