/* Arora ERP AI V9.4.2 UI shim: routes AI worker to V9.4.2 without touching ERP modules. */
(function(){
'use strict';
if(window.__ARORA_AI_V942_SHIM__)return;window.__ARORA_AI_V942_SHIM__=1;
var NativeWorker=window.Worker;
function RoutedWorker(url,opts){
  var u=String(url||'');
  if(u.indexOf('hr-ai-v91-worker.js')>=0)url='hr-ai-v942-worker.js?v=20260912-17';
  return new NativeWorker(url,opts);
}
try{RoutedWorker.prototype=NativeWorker.prototype;Object.setPrototypeOf(RoutedWorker,NativeWorker);}catch(_){}
window.Worker=RoutedWorker;

/* IMPORTANT: no MutationObserver here. The previous global observer could create a
   self-triggering DOM mutation loop and make the ERP page unresponsive. Relabel
   only a few times during initial UI creation, then stop completely. */
var tries=0;
function relabelOnce(){
  var root=document.getElementById('aroraV92');
  if(!root){if(++tries<20)setTimeout(relabelOnce,100);return;}
  var t=root.querySelector('.ttl');
  if(t&&/V9\.4\.1/.test(t.textContent))t.textContent=t.textContent.replace('V9.4.1','V9.4.2');
  var s=root.querySelector('.sub');
  if(s)s.textContent='Cache-first · Robust structured follow-ups · PF increase comparison · Full scan only on Rebuild';
  var st=root.querySelector('#v92status');
  if(st&&/V9\.4\.1/.test(st.innerHTML))st.innerHTML=st.innerHTML.replace(/V9\.4\.1/g,'V9.4.2');
}
setTimeout(relabelOnce,0);
})();
