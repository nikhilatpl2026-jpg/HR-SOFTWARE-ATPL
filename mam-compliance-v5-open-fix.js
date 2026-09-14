/* ATPL Mam Compliance V5 — direct open fix. Isolated navigation patch only. */
(function(root){'use strict';
if(root.__MAM_COMPLIANCE_V5_OPEN_FIX__)return;
root.__MAM_COMPLIANCE_V5_OPEN_FIX__=1;
function $(id){return document.getElementById(id);}
function openV5(){
  var pg=$('page-mamsalary');
  if(!pg)return false;
  document.querySelectorAll('.page').forEach(function(p){p.classList.remove('active');});
  document.querySelectorAll('.vitem').forEach(function(n){n.classList.remove('active');});
  pg.classList.add('active');
  var nav=$('vn-mamsalary'); if(nav)nav.classList.add('active');
  return true;
}
function bind(){
  var nav=$('vn-mamsalary');
  if(nav){
    nav.removeAttribute('onclick');
    nav.onclick=function(e){if(e){e.preventDefault();e.stopPropagation();}openV5();return false;};
  }
}
root.openMamComplianceV5=openV5;
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});else bind();
})(typeof window!=='undefined'?window:globalThis);
