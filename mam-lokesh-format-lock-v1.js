/* ATPL Mam Compliance — Lokesh Format Lock V1
   All auditor levels use the same Lokesh-style presentation. Auditor level changes audit strictness only. */
(function(root,factory){
  var api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  else { root.ATPLMamLokeshFormatLockV1=api; api.install(root); }
})(typeof window!=='undefined'?window:globalThis,function(){'use strict';
  var KEY='ATPL_MamCompliance_V5_UI';
  var FORMAT='LOKESH';
  function parse(raw){try{var x=JSON.parse(raw||'{}');return x&&typeof x==='object'&&!Array.isArray(x)?x:{}}catch(_){return {}}}
  function normalizeState(raw){var s=parse(raw);s.lokesh=true;s.format=FORMAT;s.formatLocked=true;return s}
  function forceStorage(root){try{root.localStorage.setItem(KEY,JSON.stringify(normalizeState(root.localStorage.getItem(KEY))))}catch(_){}}
  function enforceDom(root){var d=root.document;if(!d)return false;var box=d.getElementById('mc5Lokesh');if(!box)return false;box.checked=true;box.disabled=true;box.setAttribute('aria-checked','true');box.setAttribute('aria-disabled','true');box.title='Lokesh format is locked for every auditor level';var wrap=box.closest&&box.closest('.switch-wrap');if(wrap){wrap.classList.add('lokesh-format-locked');var span=wrap.querySelector('span');if(span)span.textContent='Lokesh Format · Locked';wrap.title='Basic to Maximum: same Lokesh salary format. Auditor level changes checking strictness only.';}return true}
  function addCss(root){var d=root.document;if(!d||d.getElementById('mc5LokeshLockCss'))return;var s=d.createElement('style');s.id='mc5LokeshLockCss';s.textContent='.lokesh-format-locked{background:#f0fdf4!important;border-color:#86efac!important;color:#166534!important;font-weight:800!important}.lokesh-format-locked i{background:#16a34a!important}.lokesh-format-locked:after{content:"ALL LEVELS";font-size:8px;font-weight:900;color:#15803d;margin-left:2px;letter-spacing:.35px}';d.head.appendChild(s)}
  function install(root){if(!root||!root.document||root.__ATPL_MAM_LOKESH_FORMAT_LOCK_V1__)return;root.__ATPL_MAM_LOKESH_FORMAT_LOCK_V1__=1;forceStorage(root);addCss(root);var d=root.document;function apply(){forceStorage(root);enforceDom(root)}
    d.addEventListener('change',function(e){if(e.target&&e.target.id==='mc5Lokesh'){e.preventDefault();e.stopPropagation();if(e.stopImmediatePropagation)e.stopImmediatePropagation();e.target.checked=true;forceStorage(root)}},true);
    if(root.MutationObserver){var mo=new root.MutationObserver(function(){apply()});mo.observe(d.documentElement,{childList:true,subtree:true});}
    if(d.readyState==='loading')d.addEventListener('DOMContentLoaded',apply,{once:true});else apply();
  }
  function formatForLevel(){return FORMAT}
  return {KEY:KEY,FORMAT:FORMAT,normalizeState:normalizeState,formatForLevel:formatForLevel,install:install};
});
