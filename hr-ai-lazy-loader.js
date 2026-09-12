/* Tiny lazy loader for Arora ERP AI PRO V8. No ERP data work runs at startup. */
(function(){
'use strict';
if(window.__ARORA_AI_LAZY__)return;window.__ARORA_AI_LAZY__=1;
var loading=null;
function loadSrc(src){return new Promise(function(resolve,reject){var s=document.createElement('script');s.src=src;s.async=false;s.onload=resolve;s.onerror=function(){reject(new Error('AI module load failed: '+src));};document.head.appendChild(s);});}
function openAI(q){
  if(q)window.__ARORA_AI_PENDING=q;
  if(window.AroraAIV8&&typeof window.AroraAIV8.open==='function'){window.AroraAIV8.open();return;}
  if(loading)return;
  window.__ARORA_AI_V8_B64='';
  loading=loadSrc('hr-ai-fast-v8-p1.js?v=20260912-8')
    .then(function(){return loadSrc('hr-ai-fast-v8-p2.js?v=20260912-8');})
    .then(function(){return loadSrc('hr-ai-fast-v8-p3.js?v=20260912-8');})
    .then(function(){return loadSrc('hr-ai-fast-v8-p4a.js?v=20260912-8');})
    .then(function(){return loadSrc('hr-ai-fast-v8-p4b.js?v=20260912-8');})
    .then(function(){return loadSrc('hr-ai-fast-v8.js?v=20260912-8');})
    .then(function(){return new Promise(function(resolve,reject){var tries=0;(function waitReady(){if(window.AroraAIV8&&typeof window.AroraAIV8.open==='function'){resolve();window.AroraAIV8.open();return;}if(++tries>100){reject(new Error('AI V8 init timeout'));return;}setTimeout(waitReady,40);})();});})
    .catch(function(e){loading=null;console.error(e);alert('AI Assistant load nahi hua. Page refresh karke dobara try karo.');});
}
window.toggleAIChat=function(){openAI('');};
window.sendAIMsg=function(){var i=document.getElementById('aiInput'),q=i&&i.value?i.value:'';if(i)i.value='';openAI(q);};
window.aiQuick=function(q){openAI(q||'');};
function hook(){var b=document.getElementById('aiChatBtn');if(b)b.onclick=function(e){if(e)e.preventDefault();openAI('');};}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',hook,{once:true});else hook();
document.addEventListener('click',function(e){var b=e.target&&e.target.closest?e.target.closest('#aiChatBtn'):null;if(b){e.preventDefault();openAI('');}},{capture:true});
})();
