/* ATPL Mam Compliance — Lokesh Format Lock V2
   Performance-safe: no document-wide MutationObserver. All auditor levels keep the same Lokesh layout. */
(function(root,factory){
  var api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  else { root.ATPLMamLokeshFormatLockV2=api; api.install(root); }
})(typeof window!=='undefined'?window:globalThis,function(){'use strict';
  var KEY='ATPL_MamCompliance_V5_UI',FORMAT='LOKESH';
  function parse(raw){try{var x=JSON.parse(raw||'{}');return x&&typeof x==='object'&&!Array.isArray(x)?x:{}}catch(_){return {}}}
  function normalizeState(raw){var s=parse(raw);s.lokesh=true;s.format=FORMAT;s.formatLocked=true;return s}
  function forceStorage(root){try{var old=root.localStorage.getItem(KEY)||'',next=JSON.stringify(normalizeState(old));if(old!==next)root.localStorage.setItem(KEY,next)}catch(_){}}
  function addCss(root){var d=root.document;if(!d||d.getElementById('mc5LokeshLockCss'))return;var s=d.createElement('style');s.id='mc5LokeshLockCss';s.textContent='.lokesh-format-locked{background:#f0fdf4!important;border-color:#86efac!important;color:#166534!important;font-weight:800!important}.lokesh-format-locked i{background:#16a34a!important}.lokesh-format-locked:after{content:"ALL LEVELS";font-size:8px;font-weight:900;color:#15803d;margin-left:2px;letter-spacing:.35px}';d.head.appendChild(s)}
  function enforceDom(root){var d=root.document;if(!d)return false;var box=d.getElementById('mc5Lokesh');if(!box)return false;
    if(!box.checked)box.checked=true;if(!box.disabled)box.disabled=true;
    if(box.getAttribute('aria-checked')!=='true')box.setAttribute('aria-checked','true');
    if(box.getAttribute('aria-disabled')!=='true')box.setAttribute('aria-disabled','true');
    if(box.title!=='Lokesh format is locked for every auditor level')box.title='Lokesh format is locked for every auditor level';
    var wrap=box.closest&&box.closest('.switch-wrap');if(wrap){if(!wrap.classList.contains('lokesh-format-locked'))wrap.classList.add('lokesh-format-locked');var span=wrap.querySelector('span');if(span&&span.textContent!=='Lokesh Format · Locked')span.textContent='Lokesh Format · Locked';var wt='Basic to Maximum: same Lokesh salary format. Auditor level changes checking strictness only.';if(wrap.title!==wt)wrap.title=wt;}
    return true;
  }
  function install(root){if(!root||!root.document||root.__ATPL_MAM_LOKESH_FORMAT_LOCK_V2__)return;root.__ATPL_MAM_LOKESH_FORMAT_LOCK_V2__=1;forceStorage(root);addCss(root);var d=root.document;
    function apply(){forceStorage(root);return enforceDom(root)}
    function retry(n){if(apply()||n<=0)return;root.setTimeout(function(){retry(n-1)},120)}
    d.addEventListener('change',function(e){if(e.target&&e.target.id==='mc5Lokesh'){e.preventDefault();e.stopPropagation();if(e.stopImmediatePropagation)e.stopImmediatePropagation();e.target.checked=true;forceStorage(root)}},true);
    d.addEventListener('click',function(e){var t=e.target&&e.target.closest?e.target.closest('#vn-mamsalary'):null;if(t)root.setTimeout(apply,0)},false);
    if(d.readyState==='loading')d.addEventListener('DOMContentLoaded',function(){retry(30)},{once:true});else retry(30);
  }
  function formatForLevel(){return FORMAT}
  return {KEY:KEY,FORMAT:FORMAT,normalizeState:normalizeState,formatForLevel:formatForLevel,install:install};
});
