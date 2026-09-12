/* Tiny lazy loader for Arora ERP AI PRO V9.4 Cache First. No ERP data work runs at startup. */
(function(){
'use strict';
if(window.__ARORA_AI_LAZY_V92__)return;window.__ARORA_AI_LAZY_V92__=1;
var loading=null;
function loadSrc(src){return new Promise(function(resolve,reject){var s=document.createElement('script');s.src=src;s.async=false;s.onload=resolve;s.onerror=function(){reject(new Error('AI module load failed: '+src));};document.head.appendChild(s);});}
function openAI(q){
  if(q)window.__ARORA_AI_PENDING=q;
  if(window.AroraAIV92&&typeof window.AroraAIV92.open==='function'){window.AroraAIV92.open(q||'');return;}
  if(loading)return;
  loading=loadSrc('hr-ai-v92-ui.js?v=20260912-14')
    .then(function(){return new Promise(function(resolve,reject){var tries=0;(function waitReady(){if(window.AroraAIV92&&typeof window.AroraAIV92.open==='function'){resolve();window.AroraAIV92.open(q||'');return;}if(++tries>120){reject(new Error('AI V9.4 init timeout'));return;}setTimeout(waitReady,40);})();});})
    .catch(function(e){loading=null;console.error(e);alert('AI Assistant V9.4 load nahi hua. Page refresh karke dobara try karo.');});
}
window.toggleAIChat=function(){openAI('');};
window.sendAIMsg=function(){var i=document.getElementById('aiInput'),q=i&&i.value?i.value:'';if(i)i.value='';openAI(q);};
window.aiQuick=function(q){openAI(q||'');};
function hook(){var b=document.getElementById('aiChatBtn');if(b)b.onclick=function(e){if(e)e.preventDefault();openAI('');};}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',hook,{once:true});else hook();
document.addEventListener('click',function(e){var b=e.target&&e.target.closest?e.target.closest('#aiChatBtn'):null;if(b){e.preventDefault();openAI('');}},{capture:true});
})();
