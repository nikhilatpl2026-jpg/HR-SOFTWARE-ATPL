/* ATPL UI Cleanup V1 — keep requested unused navigation hidden without deleting data/code. */
(function(g){'use strict';
if(g.__ATPL_UI_CLEANUP_V1__)return;g.__ATPL_UI_CLEANUP_V1__='2026.09.18-1';
var HIDE_IDS=['vn-compliance','vn-newjoin','vn-misspunch','vn-formula'];
function css(){
  if(document.getElementById('atpl-ui-cleanup-style'))return;
  var s=document.createElement('style');s.id='atpl-ui-cleanup-style';
  s.textContent='#vn-compliance,#vn-newjoin,#vn-misspunch,#vn-formula{display:none!important}';
  (document.head||document.documentElement).appendChild(s);
}
function clean(){
  css();
  HIDE_IDS.forEach(function(id){var x=document.getElementById(id);if(x){x.style.setProperty('display','none','important');x.setAttribute('aria-hidden','true')}});
  try{
    var groups=document.querySelectorAll('.qcmds .qg-lbl');
    groups.forEach(function(h){
      if((h.textContent||'').trim().toLowerCase()==='✨ new joiners'.toLowerCase()){
        var n=h.nextElementSibling;if(n&&n.classList.contains('qc'))n.style.setProperty('display','none','important');
        h.style.setProperty('display','none','important');
      }
    });
  }catch(_){}
}
function boot(){
  clean();
  try{
    var mo=new MutationObserver(function(){clean()});
    mo.observe(document.body,{childList:true,subtree:true});
    g.__ATPL_UI_CLEANUP_OBSERVER__=mo;
  }catch(_){}
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})(window);
