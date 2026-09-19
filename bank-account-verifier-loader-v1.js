/* ATPL Bank Account Verifier V1 loader — stable visible-nav recovery build. */
(function(g){'use strict';
if(g.__ATPL_BANK_ACCOUNT_VERIFIER_LOADER_V1_STABLE__)return;
g.__ATPL_BANK_ACCOUNT_VERIFIER_LOADER_V1_STABLE__='2026.09.19-lazy-fast10';
var booting=false,retries=0;

function ensureNav(){
  try{
    var d=g.document,item=d.getElementById('vn-bankverify'),sub=d.getElementById('cat-sal');
    if(!sub)return null;
    if(!item){
      item=d.createElement('div');
      item.className='vitem';
      item.id='vn-bankverify';
      item.innerHTML='<span class="vi">🏦</span>Bank A/C Verifier';
      var audit=d.getElementById('vn-audit'),lookup=d.getElementById('vn-lookup');
      if(audit&&audit.parentNode===sub)sub.insertBefore(item,audit.nextSibling);
      else if(lookup&&lookup.parentNode===sub)sub.insertBefore(item,lookup);
      else sub.appendChild(item);
    }
    item.onclick=function(ev){if(ev){ev.preventDefault();ev.stopPropagation()}openBank()};
    return item;
  }catch(e){console.error('Bank verifier nav recovery failed',e);return null}
}

function toast(msg,bad){
  try{
    var n=document.getElementById('bav-loader-status');
    if(!n){n=document.createElement('div');n.id='bav-loader-status';document.body.appendChild(n)}
    n.style.cssText='position:fixed;right:14px;bottom:14px;z-index:999999;background:'+(bad?'#fff1f2':'#eff6ff')+';color:'+(bad?'#be123c':'#1d4ed8')+';border:1px solid '+(bad?'#fecdd3':'#bfdbfe')+';padding:10px 12px;border-radius:10px;font:700 11px Arial;max-width:380px;box-shadow:0 8px 24px rgba(15,23,42,.12)';
    n.textContent=msg;
    if(!bad)setTimeout(function(){if(n&&n.parentNode)n.parentNode.removeChild(n)},2200);
  }catch(_){}
}

function cleanupDupNav(){
  try{
    var all=document.querySelectorAll('#vn-bankverify');
    for(var i=1;i<all.length;i++)all[i].remove();
    ensureNav();
  }catch(_){}
}

function openBank(){
  ensureNav();
  var p=document.getElementById('page-bankverify');
  if(p&&typeof g.goPage==='function'){
    g.goPage('bankverify');
    cleanupDupNav();
    return;
  }
  toast('🏦 Bank A/C Verifier loading…',false);
  boot(true).then(function(){
    var pg=document.getElementById('page-bankverify');
    if(pg&&typeof g.goPage==='function')g.goPage('bankverify');
    else toast('Bank A/C Verifier load nahi hua. Ctrl+Shift+R ek baar karo.',true);
  });
}
g.ATPLBankVerifierOpen=openBank;

async function boot(force){
  if(booting)return false;
  ensureNav();
  if(g.__ATPL_BANK_ACCOUNT_VERIFIER_V1__&&document.getElementById('page-bankverify')){cleanupDupNav();return true}
  booting=true;
  try{
    if(typeof DecompressionStream!=='function')throw new Error('Browser gzip support unavailable');
    var r=await fetch('bank-account-verifier-v1.js.gz.b64?v=20260918-stable2',{cache:'no-store',credentials:'same-origin'});
    if(!r.ok)throw new Error('HTTP '+r.status);
    var b64=(await r.text()).replace(/\s+/g,''),bin=atob(b64),bytes=new Uint8Array(bin.length);
    for(var i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);
    var stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    var code=await new Response(stream).text();
    var s=document.createElement('script');
    s.type='text/javascript';
    s.text=code+'\n//# sourceURL=bank-account-verifier-v1.js';
    (document.head||document.documentElement).appendChild(s);
    if(s.parentNode)s.parentNode.removeChild(s);
    await new Promise(function(r){setTimeout(r,0)});
    if(!g.__ATPL_BANK_ACCOUNT_VERIFIER_V1__)throw new Error('Module initialization failed');
    if(!document.getElementById('page-bankverify'))throw new Error('Bank Verifier page missing after init');
    cleanupDupNav();
    var old=document.getElementById('bav-loader-status');if(old)old.remove();
    retries=0;
    try{document.dispatchEvent(new CustomEvent('atpl-bank-core-ready'))}catch(_){}
    return true;
  }catch(e){
    console.error('ATPL Bank Account Verifier failed to load:',e);
    ensureNav();
    retries++;
    toast('Bank A/C Verifier load issue: '+(e&&e.message?e.message:'Unknown error'),true);
    if(!force&&retries<3)setTimeout(function(){boot(false)},1200*retries);
    return false;
  }finally{booting=false}
}

function start(){ensureNav()}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})(window);
