// Arora ERP Backend V3 mobile split patch
// Apply these changes inside the existing Apps Script Code.gs.
// Purpose: keep employee reads small and move challan/system reads to a separate endpoint.

// 1) Add this variable near the existing constants:
var BACKEND_VERSION = '3.0-mobile-split';

// 2) In doGet(e), add this route:
// else if (action === 'getSystemRecords') data = getSystemRecords_(p);

// 3) Replace the existing getEmployeeMaster_(p) with:
function getEmployeeMaster_(p){
  requireUser_(p.token);
  var out=[];
  masterRows_().forEach(function(x){
    if (String(x.emp_id||'').indexOf('__ATPL_SYS__')===0) return;
    try{
      var r=JSON.parse(x.json);
      if (r && r._atpl_system===true) return;
      r._cloud_updated_by=x.updated_by;
      r._cloud_updated_at=x.updated_at;
      out.push(r);
    }catch(_){}
  });
  return {ok:true,records:out,count:out.length,version:BACKEND_VERSION};
}

// 4) Add this new function:
function getSystemRecords_(p){
  requireUser_(p.token);
  var out=[],kind=String(p.kind||'').trim();
  masterRows_().forEach(function(x){
    var isSystem=String(x.emp_id||'').indexOf('__ATPL_SYS__')===0;
    try{
      var r=JSON.parse(x.json);
      if (!isSystem && !(r && r._atpl_system===true)) return;
      if (kind && String(r.object_kind||'')!==kind) return;
      r._cloud_updated_by=x.updated_by;
      r._cloud_updated_at=x.updated_at;
      out.push(r);
    }catch(_){}
  });
  return {ok:true,records:out,count:out.length,kind:kind||'all',version:BACKEND_VERSION};
}

// 5) Change ping response to expose the deployed build:
// data = {ok:true, service:'Arora ERP Shared Backend', version:BACKEND_VERSION};
