/* ATPL Bank A/C Verifier V4 Enhancement
   Runs on the proven V1 verifier core. Adds:
   - Compliance Salary / Diff Salary modes
   - persistent Master + Current working files per mode
   - persistent selectable previous-sheet library (1-3 active)
   - recoverable delete/archive + restore
   - exact missing/extra/changed digit explanation
   - cloud-sync hooks through ERP Durable Everything
*/
(function(g){'use strict';
if(!g||g.__ATPL_BANK_VERIFIER_V4__)return;
g.__ATPL_BANK_VERIFIER_V4__='2026.09.18-v4';

var DB_NAME='ATPL_BANK_VERIFIER_PRIVATE_V3',DB_VER=2,REF_STORE='previousSheets',WORK_STORE='workingFiles';
var MODE_KEY='ATPL_BankVerifier_Mode_V4';
var mode='compliance',refs=[],switching=false,observer=null,booted=false,booting=false;
try{var m=localStorage.getItem(MODE_KEY);if(m==='diff'||m==='compliance')mode=m}catch(_){}

function q(id){return document.getElementById(id)}
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function base(){return g.ATPLBankAccountVerifierV1||null}
function state(){var a=base();return a&&a.state?a.state:null}
function wait(ms){return new Promise(function(r){setTimeout(r,ms)})}
function openDb(){return new Promise(function(ok,no){try{var r=indexedDB.open(DB_NAME,DB_VER);r.onupgradeneeded=function(){var d=r.result;if(!d.objectStoreNames.contains(REF_STORE))d.createObjectStore(REF_STORE,{keyPath:'id'});if(!d.objectStoreNames.contains(WORK_STORE))d.createObjectStore(WORK_STORE,{keyPath:'id'})};r.onsuccess=function(){ok(r.result)};r.onerror=function(){no(r.error)}}catch(e){no(e)}})}
async function getAll(store){try{var d=await openDb();return await new Promise(function(ok){var t=d.transaction(store,'readonly'),r=t.objectStore(store).getAll();r.onsuccess=function(){d.close();ok(r.result||[])};r.onerror=function(){d.close();ok([])}})}catch(_){return[]}}
async function getOne(store,id){try{var d=await openDb();return await new Promise(function(ok){var t=d.transaction(store,'readonly'),r=t.objectStore(store).get(id);r.onsuccess=function(){d.close();ok(r.result||null)};r.onerror=function(){d.close();ok(null)}})}catch(_){return null}}
async function put(store,obj){var d=await openDb();return new Promise(function(ok,no){var t=d.transaction(store,'readwrite');t.objectStore(store).put(obj);t.oncomplete=function(){d.close();ok(true)};t.onerror=function(){var e=t.error;d.close();no(e)}})}
function notifyCloud(){try{if(g.ATPLDurableEverythingV1&&typeof g.ATPLDurableEverythingV1.sync==='function')setTimeout(function(){g.ATPLDurableEverythingV1.sync()},250)}catch(_){}}
function uid(prefix){return prefix+'_'+Date.now()+'_'+Math.random().toString(36).slice(2,8)}
function fileFromRecord(r){try{return new File([r.buffer],r.fileName||'Bank.xlsx',{type:r.type||'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',lastModified:r.lastModified||Date.now()})}catch(_){var b=new Blob([r.buffer],{type:r.type||'application/octet-stream'});b.name=r.fileName||'Bank.xlsx';return b}}
function setFiles(input,file){var dt=new DataTransfer();dt.items.add(file);input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}))}
async function feed(inputId,rec,role){
  var input=q(inputId),s=state();if(!input||!rec||!s)return false;
  var marker=Date.now();switching=true;
  try{setFiles(input,fileFromRecord(rec));for(var i=0;i<80;i++){await wait(40);var obj=role==='master'?s.master:role==='current'?s.current:s.histories[Number(role.slice(1))];if(obj&&obj.fileName===rec.fileName&&Date.parse(obj.loadedAt||0)<=Date.now()+1000)return true}}finally{switching=false}
  return false;
}
async function saveWorking(role,file){
  if(!file)return;var buf=await file.arrayBuffer(),rec={id:mode+':'+role,mode:mode,role:role,fileName:file.name,type:file.type||'',lastModified:file.lastModified||0,size:file.size||buf.byteLength,savedAt:new Date().toISOString(),buffer:buf};
  await put(WORK_STORE,rec);notifyCloud();renderWorkSaved(role,rec);
}
function renderWorkSaved(role,rec){var meta=q('bavMeta-'+role);if(meta&&rec)meta.textContent=(meta.textContent||'').replace(/\s*•\s*Auto-saved.*$/,'')+' • Auto-saved';}
async function restoreWorking(role){var r=await getOne(WORK_STORE,mode+':'+role);if(r)await feed('bavInput-'+role,r,role);return r}
async function loadRefs(){refs=await getAll(REF_STORE);renderLibrary();return refs}
function modeRefs(includeArchived){return refs.filter(function(r){return(r.mode||'compliance')===mode&&(includeArchived||!r.archived)}).sort(function(a,b){return Date.parse(b.savedAt||0)-Date.parse(a.savedAt||0)})}
function selectedRefs(){return modeRefs(false).filter(function(r){return!!r.selected}).slice(0,3)}
async function saveReferenceFiles(files){
  files=Array.from(files||[]);if(!files.length)return;
  for(var i=0;i<files.length;i++){var f=files[i];if(!/\.(xlsx|xls|csv)$/i.test(f.name))continue;var buf=await f.arrayBuffer();await put(REF_STORE,{id:uid(mode),mode:mode,fileName:f.name,type:f.type||'',lastModified:f.lastModified||0,size:f.size||buf.byteLength,savedAt:new Date().toISOString(),selected:false,archived:false,buffer:buf})}
  await loadRefs();notifyCloud();setStatus(files.length+' previous sheet(s) saved in '+modeLabel()+'.',false);
}
async function toggleRef(id,on){
  var r=refs.find(function(x){return x.id===id});if(!r)return;
  if(on&&selectedRefs().filter(function(x){return x.id!==id}).length>=3){setStatus('Maximum 3 previous sheets select kar sakte ho.',true);renderLibrary();return}
  r.selected=!!on;r.archived=false;r.savedAt=new Date().toISOString();await put(REF_STORE,r);await loadRefs();await applySelected();notifyCloud();
}
async function archiveRef(id){
  var r=refs.find(function(x){return x.id===id});if(!r)return;
  if(!confirm('Is sheet ko Saved Library se hata kar Recycle Bin me move karein? Data permanently delete nahi hoga.'))return;
  r.archived=true;r.selected=false;r.archivedAt=new Date().toISOString();r.savedAt=new Date().toISOString();await put(REF_STORE,r);await loadRefs();await applySelected();notifyCloud();setStatus('Sheet Recycle Bin me move ho gayi. Restore kabhi bhi kar sakte ho.',false);
}
async function restoreRef(id){var r=refs.find(function(x){return x.id===id});if(!r)return;r.archived=false;r.archivedAt='';r.savedAt=new Date().toISOString();await put(REF_STORE,r);await loadRefs();notifyCloud();setStatus('Sheet restored.',false)}
async function applySelected(){
  var s=state();if(!s)return;
  s.histories=[null,null,null];['h0','h1','h2'].forEach(function(id){var el=q('bavInput-'+id);if(el)el.value=''});
  var a=selectedRefs();for(var i=0;i<a.length;i++)await feed('bavInput-h'+i,a[i],'h'+i);
  var meta=q('bavV4Selected');if(meta)meta.textContent=a.length+' selected';
}
function modeLabel(){return mode==='diff'?'Diff Salary':'Compliance Salary'}
function setStatus(msg,bad){var x=q('bavV4Status');if(!x)return;x.textContent=msg||'';x.style.color=bad?'#b91c1c':'#047857'}
function renderLibrary(){
  var box=q('bavV4Library');if(!box)return;
  var active=modeRefs(false),trash=modeRefs(true).filter(function(r){return r.archived}),sel=active.filter(function(r){return r.selected}).length;
  var h='<div class="bav4-libhead"><div><b>Saved Previous Bank Sheets — '+esc(modeLabel())+'</b><div class="bav4-help">1, 2 ya maximum 3 sheets select karo. 3 compulsory nahi hain.</div></div><span class="bav4-count" id="bavV4Selected">'+sel+' selected</span></div>';
  if(!active.length)h+='<div class="bav4-empty">Abhi koi previous sheet saved nahi hai.</div>';
  else h+='<div class="bav4-refgrid">'+active.map(function(r){return'<div class="bav4-ref '+(r.selected?'selected':'')+'"><label><input type="checkbox" data-bav4-select="'+esc(r.id)+'" '+(r.selected?'checked':'')+'> <b>'+esc(r.fileName)+'</b></label><div class="bav4-refmeta">'+new Date(r.savedAt||Date.now()).toLocaleString()+' · '+Math.round((r.size||0)/1024)+' KB</div><button data-bav4-delete="'+esc(r.id)+'">🗑 Delete</button></div>'}).join('')+'</div>';
  if(trash.length)h+='<details class="bav4-trash"><summary>♻ Recycle Bin ('+trash.length+')</summary>'+trash.map(function(r){return'<div class="bav4-trashrow"><span>'+esc(r.fileName)+'</span><button data-bav4-restore="'+esc(r.id)+'">Restore</button></div>'}).join('')+'</details>';
  box.innerHTML=h;
}
function setModeButtons(){['compliance','diff'].forEach(function(x){var b=q('bavMode-'+x);if(b)b.classList.toggle('active',mode===x)});var t=q('bavModeTitle');if(t)t.textContent=modeLabel()}
async function switchMode(next){
  if(next!== 'compliance'&&next!=='diff'||next===mode)return;
  mode=next;try{localStorage.setItem(MODE_KEY,mode)}catch(_){}
  setModeButtons();switching=true;try{var a=base();if(a&&typeof a.reset==='function')a.reset()}finally{switching=false}
  await loadRefs();await restoreWorking('master');await restoreWorking('current');await applySelected();enhanceIssues();setStatus(modeLabel()+' data loaded.',false);
}
function installUi(){
  if(q('bavV4Mode'))return true;
  var page=q('page-bankverify');if(!page)return false;
  var hero=page.querySelector('.bav-hero'),grid=page.querySelector('.bav-grid');if(!hero||!grid)return false;
  var safe=hero.querySelector('.bav-safe');if(safe)safe.textContent='☁ Auto-save: Master, Current aur saved previous sheets mode-wise persistent rahenge.';
  var sub=hero.querySelector('.bav-sub');if(sub)sub.textContent='Master + available previous bank/salary sheets ko current month se employee-wise compare karta hai. 1-3 previous sheets optional hain; exact missing/extra/changed digit bhi batata hai.';
  var modeBox=document.createElement('div');modeBox.id='bavV4Mode';modeBox.className='bav4-mode';modeBox.innerHTML='<div><b>Bank Sheet Type:</b> <span id="bavModeTitle"></span></div><div class="bav4-modeBtns"><button id="bavMode-compliance">✅ Compliance Salary</button><button id="bavMode-diff">↔️ Diff Salary</button></div>';grid.parentNode.insertBefore(modeBox,grid);
  ['h0','h1','h2'].forEach(function(id){var inp=q('bavInput-'+id);if(inp){var card=inp.closest('.bav-card');if(card)card.style.display='none'}});
  grid.style.gridTemplateColumns='repeat(2,minmax(240px,1fr))';
  var lib=document.createElement('div');lib.className='bav4-library';lib.innerHTML='<div class="bav4-uploadrow"><div><b>💾 Save Previous Bank Sheet</b><div class="bav4-help">Ye library '+modeLabel()+' ke liye alag save rahegi.</div></div><label class="bav-upload">📂 Add Previous Sheet(s)<input id="bavV4RefInput" type="file" accept=".xlsx,.xls,.csv" multiple></label></div><div id="bavV4Library"></div><div id="bavV4Status" class="bav4-status"></div>';grid.parentNode.insertBefore(lib,grid.nextSibling);
  var foot=page.querySelector('.bav-foot');if(foot)foot.innerHTML='Safety: explicit Delete bhi permanent destroy nahi karta — sheet Recycle Bin me jati hai. Current corrections working copy me auto-save hoti hain; original local source file untouched rehta hai.';
  q('bavMode-compliance').onclick=function(){switchMode('compliance')};q('bavMode-diff').onclick=function(){switchMode('diff')};
  q('bavV4RefInput').addEventListener('change',function(){saveReferenceFiles(this.files);this.value=''});
  lib.addEventListener('change',function(e){var id=e.target&&e.target.getAttribute('data-bav4-select');if(id)toggleRef(id,e.target.checked)});
  lib.addEventListener('click',function(e){var b=e.target&&e.target.closest?e.target.closest('[data-bav4-delete],[data-bav4-restore]'):null;if(!b)return;var id=b.getAttribute('data-bav4-delete')||b.getAttribute('data-bav4-restore');if(b.hasAttribute('data-bav4-delete'))archiveRef(id);else restoreRef(id)});
  ['master','current'].forEach(function(role){var inp=q('bavInput-'+role);if(inp)inp.addEventListener('change',function(){if(!switching&&this.files&&this.files[0])saveWorking(role,this.files[0])})});
  setModeButtons();return true;
}
function moveNav(){var sal=q('cat-sal'),bank=q('vn-bankverify'),audit=q('vn-audit'),lookup=q('vn-lookup');if(!sal||!bank)return;if(audit&&audit.parentNode===sal)sal.insertBefore(bank,audit.nextSibling);else if(lookup&&lookup.parentNode===sal)sal.insertBefore(bank,lookup)}
function addCss(){
  if(q('bav4-style'))return;var s=document.createElement('style');s.id='bav4-style';s.textContent='.bav4-mode{display:flex;justify-content:space-between;align-items:center;gap:10px;background:#fff;border:1px solid #dbeafe;border-radius:13px;padding:12px 14px;margin-bottom:10px;font-size:11px;color:#334155}.bav4-modeBtns{display:flex;gap:7px;flex-wrap:wrap}.bav4-modeBtns button{padding:8px 11px;border:1px solid #cbd5e1;background:#fff;border-radius:9px;font-size:10px;font-weight:800;cursor:pointer}.bav4-modeBtns button.active{background:#1d4ed8;color:#fff;border-color:#1d4ed8}.bav4-library{margin:10px 0 14px;background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:13px}.bav4-uploadrow,.bav4-libhead{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}.bav4-help{font-size:9px;color:#64748b;margin-top:3px}.bav4-status{font-size:10px;font-weight:700;min-height:15px;margin-top:8px}.bav4-count{font-size:9px;background:#eff6ff;color:#1d4ed8;border-radius:999px;padding:4px 8px;font-weight:800}.bav4-refgrid{display:grid;grid-template-columns:repeat(3,minmax(180px,1fr));gap:8px;margin-top:10px}.bav4-ref{border:1px solid #e2e8f0;border-radius:10px;padding:9px;background:#f8fafc;font-size:10px}.bav4-ref.selected{border-color:#60a5fa;background:#eff6ff}.bav4-ref label{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.bav4-refmeta{font-size:8px;color:#64748b;margin:5px 0}.bav4-ref button,.bav4-trashrow button{border:1px solid #fecaca;background:#fff;color:#b91c1c;border-radius:6px;padding:4px 7px;font-size:8px;font-weight:800;cursor:pointer}.bav4-empty{padding:16px;text-align:center;color:#94a3b8;font-size:10px}.bav4-trash{margin-top:10px;font-size:9px;color:#64748b}.bav4-trashrow{display:flex;justify-content:space-between;gap:8px;align-items:center;padding:5px 0;border-bottom:1px solid #f1f5f9}.bav4-trashrow button{color:#047857;border-color:#a7f3d0}.bav4-exact{display:block;margin-top:3px;color:#7c2d12;font-weight:900}@media(max-width:900px){.bav4-refgrid{grid-template-columns:1fr}.bav4-mode{align-items:flex-start;flex-direction:column}}';document.head.appendChild(s)
}
function exactOps(cur,ref){
  cur=String(cur==null?'':cur).replace(/[\s'\x60-]+/g,'').toUpperCase();ref=String(ref==null?'':ref).replace(/[\s'\x60-]+/g,'').toUpperCase();
  if(!cur||!ref||cur===ref)return'';
  var n=cur.length,m=ref.length,dp=Array.from({length:n+1},function(){return Array(m+1).fill(0)}),i,j;
  for(i=0;i<=n;i++)dp[i][0]=i;for(j=0;j<=m;j++)dp[0][j]=j;
  for(i=1;i<=n;i++)for(j=1;j<=m;j++){var cost=cur[i-1]===ref[j-1]?0:1;dp[i][j]=Math.min(dp[i-1][j]+1,dp[i][j-1]+1,dp[i-1][j-1]+cost)}
  i=n;j=m;var ops=[];
  while(i>0||j>0){
    if(i>0&&j>0&&cur[i-1]===ref[j-1]&&dp[i][j]===dp[i-1][j-1]){i--;j--;continue}
    if(i>0&&j>0&&dp[i][j]===dp[i-1][j-1]+1){ops.push('Position '+j+': '+cur[i-1]+' should be '+ref[j-1]);i--;j--;continue}
    if(j>0&&dp[i][j]===dp[i][j-1]+1){ops.push('Missing digit '+ref[j-1]+' at position '+j);j--;continue}
    if(i>0){ops.push('Extra digit '+cur[i-1]+' at position '+Math.max(1,j+1));i--;continue}
  }
  ops.reverse();if(ops.length>4)return ops.slice(0,4).join(' • ')+' • +'+(ops.length-4)+' more';return ops.join(' • ');
}
function enhanceIssues(){
  var s=state();if(!s||!Array.isArray(s.issues))return;
  s.issues.forEach(function(x){var exp=x.expected&&x.expected.account||x.master&&x.master.account||'';if(!exp)(x.histories||[]).some(function(h){if(h&&h.account){exp=h.account;return true}return false});var det=exactOps(x.current&&x.current.account,exp);if(det){x.exactDigitDetail=det;if(x.message.indexOf(det)<0)x.message=x.message+' • '+det}});
  var area=q('bavResults');if(!area)return;area.querySelectorAll('tr[data-i]').forEach(function(tr){var i=Number(tr.getAttribute('data-i')),x=s.issues[i],el=tr.querySelectorAll('td')[6]&&tr.querySelectorAll('td')[6].querySelector('.bav-bad');if(x&&el&&el.textContent!==x.message)el.textContent=x.message})
}
function watchResults(){var area=q('bavResults');if(!area||observer)return;observer=new MutationObserver(function(){setTimeout(enhanceIssues,0)});observer.observe(area,{childList:true,subtree:true});enhanceIssues()}
function patchCorrectionAutosave(){
  var area=q('bavResults');if(!area||area.__bav4Auto)return;area.__bav4Auto=1;
  document.addEventListener('click',function(e){var b=e.target&&e.target.closest?e.target.closest('[data-correct]'):null;if(!b)return;setTimeout(async function(){var s=state();if(!s||!s.current)return;try{var buf=g.XLSX.write(s.current.wb,{bookType:'xlsx',type:'array',compression:true});await put(WORK_STORE,{id:mode+':current',mode:mode,role:'current',fileName:s.current.fileName,type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',size:buf.byteLength,savedAt:new Date().toISOString(),buffer:buf});notifyCloud();setStatus('Corrected Current working sheet auto-saved.',false)}catch(err){console.warn(err)}},350)},true)
}
async function reloadLibrary(){await loadRefs();renderLibrary();return true}
async function restoreMode(){
  switching=true;try{await loadRefs();await restoreWorking('master');await restoreWorking('current');await applySelected()}finally{switching=false}
  setModeButtons();enhanceIssues();
}
async function boot(){
  if(booted||booting||!base())return false;booting=true;
  try{
    addCss();for(var i=0;i<20&&!installUi();i++)await wait(50);if(!installUi())return false;
    moveNav();watchResults();patchCorrectionAutosave();await restoreMode();
    if(!document.__atplBankLibraryHook){document.__atplBankLibraryHook=1;document.addEventListener('atpl-bank-library-synced',function(){reloadLibrary()})}
    g.ATPLBankAccountVerifierV4={version:'2026.09.19-lazy-fast10',reloadLibrary:reloadLibrary,mode:function(){return mode},exactOps:exactOps};
    booted=true;return true
  }finally{booting=false}
}
function start(){if(base())boot();document.addEventListener('atpl-bank-core-ready',function(){boot()})}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})(window);
