/* ATPL Mam Compliance V5 legacy root shim — SAFE NO-OP.
   Kept only for browsers that may still have an older mam-salary.js cached.
   IMPORTANT: never assign window.root; that can collide with the ERP DOM/runtime.
   Current Mam V5 uses a scoped loader in mam-salary.js instead. */
(function(g){
  'use strict';
  var api={
    install:function(){return true;},
    deprecated:true,
    reason:'Scoped V5 loader now supplies root privately without changing globals.'
  };
  if(typeof module==='object'&&module.exports)module.exports=api;
  else g.ATPLMamV5RuntimeRootFixV1=api;
})(typeof window!=='undefined'?window:globalThis);
