/* ATPL UI Cleanup V2 — CSS-first, lightweight. No full-body MutationObserver. */
(function(g){'use strict';
if(g.__ATPL_UI_CLEANUP_V2__)return;g.__ATPL_UI_CLEANUP_V2__='2026.09.18-2';
function css(){
  if(document.getElementById('atpl-ui-cleanup-style'))return;
  var s=document.createElement('style');s.id='atpl-ui-cleanup-style';
  s.textContent='#vn-compliance,#vn-newjoin,#vn-misspunch,#vn-formula{display:none!important}';
  (document.head||document.documentElement).appendChild(s);
}
function cleanQuick(){
  css();
  ['vn-compliance','vn-newjoin','vn-misspunch','vn-formula'].forEach(function(id){var x=document.getElementById(id);if(x)x.style.setProperty('display','none','important')});
  var groups=document.querySelectorAll('.qcmds .qg-lbl');
  for(var i=0;i<groups.length;i++){var h=groups[i];if((h.textContent||'').trim().toLowerCase()==='✨ new joiners'.toLowerCase()){h.style.setProperty('display','none','important');var n=h.nextElementSibling;if(n&&n.classList.contains('qc'))n.style.setProperty('display','none','important')}}
}
function boot(){cleanQuick();setTimeout(cleanQuick,700);setTimeout(cleanQuick,2200)}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})(window);