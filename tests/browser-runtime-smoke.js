const fs=require('node:fs');
const puppeteer=require('puppeteer-core');

(async()=>{
  const candidates=[process.env.CHROME_PATH,'/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium','/usr/bin/chromium-browser'].filter(Boolean);
  const chrome=candidates.find(p=>fs.existsSync(p));
  if(!chrome)throw new Error('Chrome executable not found on CI runner');

  const browser=await puppeteer.launch({executablePath:chrome,headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
  const page=await browser.newPage();
  const pageErrors=[],consoleErrors=[],failed=[];
  page.on('pageerror',e=>pageErrors.push(String(e&&e.stack||e)));
  page.on('console',m=>{if(m.type()==='error'){const t=m.text();if(!/Failed to load resource/i.test(t))consoleErrors.push(t)}});
  page.on('requestfailed',r=>{
    const u=r.url();
    if(/^https?:\/\/127\.0\.0\.1:4173\//.test(u))failed.push(u+' :: '+(r.failure()?.errorText||'failed'));
  });

  const started=Date.now();
  await page.goto('http://127.0.0.1:4173/index.html',{waitUntil:'domcontentloaded',timeout:15000});
  await new Promise(r=>setTimeout(r,2200));
  const bootMs=Date.now()-started;

  const result=await page.evaluate(async()=>{
    const ciUser={id:'__ci_admin__',name:'CI Admin',admin:true,access:['*'],active:true};
    localStorage.setItem('ATPL_UserAccess_V1',JSON.stringify([ciUser]));
    sessionStorage.setItem('ATPL_UserSession_V5',JSON.stringify({id:ciUser.id}));
    sessionStorage.setItem('ATPL_RemoteToken_V1','ci-local-token');
    sessionStorage.setItem('ATPL_SharedToken_V1','ci-local-token');
    const login=document.getElementById('uaLogin');if(login)login.style.display='none';
    document.body.classList.remove('uaLocked');
    document.querySelectorAll('[id^="page-"]').forEach(p=>{p.hidden=false;p.classList.remove('uaDeniedPage','uaNoAccess');p.style.removeProperty('display');p.removeAttribute('aria-hidden')});
    document.querySelectorAll('.vitem').forEach(v=>{v.hidden=false;v.style.removeProperty('display');v.removeAttribute('aria-hidden')});
    const landing=document.getElementById('landingPage');if(landing)landing.style.display='none';
    const navs=[...document.querySelectorAll('.vitem[onclick*="goPage"]')];
    const targets=[...new Set(navs.map(x=>{const m=String(x.getAttribute('onclick')||'').match(/goPage\(['"]([^'"]+)['"]\)/);return m&&m[1]}).filter(Boolean))];
    const failures=[];
    for(const t of targets){
      try{
        if(typeof window.goPage!=='function'){failures.push(t+': goPage missing');continue}
        window.goPage(t);
        await new Promise(r=>setTimeout(r,90));
        const p=document.getElementById('page-'+t);
        if(!p)failures.push(t+': page missing after navigation');
        else if(!p.classList.contains('active'))failures.push(t+': page did not become active');
      }catch(e){failures.push(t+': '+String(e&&e.message||e))}
    }
    const forbidden=['Salary Lookup','Salary Sync','ESIC DOL Filler'].filter(x=>document.body.innerText.includes(x));
    const requiredModules={
      cloudBroker:!!window.ATPLCloudAPI,
      mobileHardfix:!!window.ATPLMobileSharedHardfixV1,
      cloudSync:!!window.ATPLCloudSyncV1,
      durable:!!window.ATPLDurableEverythingV1,
      dolVault:!!window.ATPLDOLCloudV4
    };
    return {targets,failures,forbidden,requiredModules};
  });

  await browser.close();
  if(bootMs>10000)throw new Error('DOM/runtime startup exceeded 10s: '+bootMs+'ms');
  if(pageErrors.length)throw new Error('Uncaught page errors:\n'+pageErrors.join('\n---\n'));
  if(consoleErrors.length)throw new Error('Console errors:\n'+consoleErrors.join('\n---\n'));
  if(failed.length)throw new Error('Failed local resources:\n'+failed.join('\n'));
  if(result.failures.length)throw new Error('Navigation failures:\n'+result.failures.join('\n'));
  if(result.forbidden.length)throw new Error('Removed feature text still rendered: '+result.forbidden.join(', '));
  const missing=Object.entries(result.requiredModules).filter(([,v])=>!v).map(([k])=>k);
  if(missing.length)throw new Error('Critical runtime modules missing: '+missing.join(', '));
  console.log(JSON.stringify({ok:true,bootMs,navTargets:result.targets.length,modules:result.requiredModules}));
})().catch(e=>{console.error(e&&e.stack||e);process.exit(1)});
