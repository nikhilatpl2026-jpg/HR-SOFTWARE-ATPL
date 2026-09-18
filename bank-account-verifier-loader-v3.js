/* ATPL Bank Account Verifier V3 loader - nav init hotfix */
(function(g){'use strict';
if(g.__ATPL_BANK_ACCOUNT_VERIFIER_LOADER_V3_HOTFIX__)return;
g.__ATPL_BANK_ACCOUNT_VERIFIER_LOADER_V3_HOTFIX__=1;

function fail(err){
  console.error('ATPL Bank A/C Verifier V3 load failed:',err);
  try{
    var n=document.getElementById('bav-loader-error');
    if(!n){n=document.createElement('div');n.id='bav-loader-error';document.body.appendChild(n);}
    n.style.cssText='position:fixed;right:14px;bottom:14px;z-index:999999;background:#fff1f2;color:#be123c;border:1px solid #fecdd3;padding:10px 12px;border-radius:10px;font:600 11px Arial;max-width:380px';
    n.textContent='Bank A/C Verifier load failed. Refresh once. '+(err&&err.message?err.message:'');
  }catch(_){}
}

function ensureBankNav(){
  if(typeof g.nav==='function')return;
  g.nav=function(){
    try{
      var d=g.document,existing=d.getElementById('vn-bankverify');
      if(existing)return existing;
      var sub=d.getElementById('cat-sal');
      if(!sub)throw new Error('Salary navigation container not found');
      var item=d.createElement('div');
      item.className='vitem';
      item.id='vn-bankverify';
      item.setAttribute('onclick',"goPage('bankverify')");
      item.innerHTML='<span class="vi">🏦</span>Bank A/C Verifier';
      var anchor=d.getElementById('vn-audit'),lookup=d.getElementById('vn-lookup');
      if(anchor&&anchor.parentNode===sub)sub.insertBefore(item,anchor.nextSibling);
      else if(lookup&&lookup.parentNode===sub)sub.insertBefore(item,lookup);
      else sub.appendChild(item);
      return item;
    }catch(e){console.error('Bank verifier nav init failed:',e);return null;}
  };
}

async function boot(){
  try{
    if(g.__ATPL_BANK_ACCOUNT_VERIFIER_V3__&&document.getElementById('page-bankverify')&&document.getElementById('vn-bankverify'))return;
    ensureBankNav();
    if(typeof DecompressionStream!=='function')throw new Error('Browser gzip support unavailable');
    var r=await fetch('bank-account-verifier-v3.js.gz.b64?v=20260918-5',{cache:'no-store',credentials:'same-origin'});
    if(!r.ok)throw new Error('HTTP '+r.status);
    var b64=(await r.text()).replace(/\s+/g,''),bin=atob(b64),bytes=new Uint8Array(bin.length);
    for(var i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);
    var stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    var code=await new Response(stream).text();
    var s=document.createElement('script');
    s.type='text/javascript';
    s.text=code+'\n//# sourceURL=bank-account-verifier-v3.js';
    (document.head||document.documentElement).appendChild(s);
    if(s.parentNode)s.parentNode.removeChild(s);
    if(!g.__ATPL_BANK_ACCOUNT_VERIFIER_V3__)throw new Error('Module initialization flag missing');
    if(!document.getElementById('vn-bankverify'))throw new Error('Bank Verifier navigation did not mount');
    if(!document.getElementById('page-bankverify'))throw new Error('Bank Verifier page did not mount');
    var old=document.getElementById('bav-loader-error');if(old)old.remove();
  }catch(e){fail(e);}
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);
else boot();
})(window);