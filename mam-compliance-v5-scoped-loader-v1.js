/* ATPL Mam Compliance V5 scoped runtime loader.
   Executes V5 with a private `root` binding so the rest of ERP globals remain untouched. */
(function(g){'use strict';
  function finish(done,err){try{if(typeof done==='function')done(err||null);}catch(_){}}
  function executeScoped(code){
    if(g.__MAM_COMPLIANCE_V5__)return true;
    var s=document.createElement('script');
    s.type='text/javascript';
    s.text='(function(root){\n'+String(code||'')+'\n})(window);\n//# sourceURL=mam-compliance-v5.scoped.js';
    (document.head||document.documentElement).appendChild(s);
    if(s.parentNode)s.parentNode.removeChild(s);
    return !!g.__MAM_COMPLIANCE_V5__;
  }
  function load(done){
    if(g.__MAM_COMPLIANCE_V5__)return finish(done);
    if(typeof fetch!=='function')return finish(done,new Error('Fetch unavailable for scoped V5 loader'));
    fetch('mam-compliance-v5.js?v=20260916-rootscope1',{cache:'no-store',credentials:'same-origin'})
      .then(function(r){if(!r.ok)throw new Error('Mam V5 source HTTP '+r.status);return r.text();})
      .then(function(code){if(!executeScoped(code))throw new Error('Mam V5 scoped initialization failed');finish(done);})
      .catch(function(err){console.error('ATPL Mam V5 scoped loader failed:',err);finish(done,err);});
  }
  g.ATPLLoadMamComplianceV5ScopedV1=load;
})(window);
