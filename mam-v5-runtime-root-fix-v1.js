/* ATPL Mam Compliance V5 runtime root compatibility fix.
   V5 browser runtime refers to `root`; classic scripts resolve global object properties as globals.
   This file must load before mam-compliance-v5.js. */
(function(g){
  'use strict';
  var api={
    install:function(target){
      if(!target)return false;
      try{target.root=target;}catch(_){return false;}
      return target.root===target;
    }
  };
  if(typeof module==='object'&&module.exports)module.exports=api;
  else{
    g.ATPLMamV5RuntimeRootFixV1=api;
    api.install(g);
  }
})(typeof window!=='undefined'?window:globalThis);
