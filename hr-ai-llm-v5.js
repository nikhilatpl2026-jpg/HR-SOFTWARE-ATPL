/* Arora ERP AI LLM V5 — lightweight, on-demand context retrieval. */
(function(){
'use strict';
if(window.__ARORA_LLM_V5__) return;
window.__ARORA_LLM_V5__ = 1;

var BACKEND='https://script.google.com/macros/s/AKfycbyqcm2R4CxBBV0Xq-xS_h_Rzh1a3NQZ8JCjqL3eOzIdlI81tfYZOVVwVppmfdQPNsAGCg/exec';
var MAX_CONTEXT_CHARS=8500;
var MAX_ROWS=16;
var OLD_TOGGLE=window.toggleAIChat;
var chat=[];
var rowsCache=null;
var overlay=null;

function esc(s){return String(s==null?'':s).replace(/[&<>\"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c];});}
function norm(s){return String(s||'').toLowerCase().replace(/[^a-z0-9\u0900-\u097f]+/g,' ').trim();}
function tokens(q){
  var t=norm(q).split(/\s+/).filter(function(x){return x.length>1;});
  var stop={ki:1,ka:1,ke:1,ko:1,kya:1,hai:1,he:1,h:1,bhai:1,me:1,mein:1,tha:1,thi:1,the:1,ne:1,aur:1,se:1,kab:1,bata:1,batao:1,amount:1};
  return t.filter(function(x){return !stop[x];});
}
function aliases(q){
  var n=norm(q), a=[];
  if(/\bpf\b|epf|provident/.test(n)) a.push('pf','epf','provident fund','employee pf');
  if(/esic|esi/.test(n)) a.push('esic','esi','employee esi');
  if(/salary|selry|slry|payment|net pay/.test(n)) a.push('salary','net payment','net pay','gross','payable');
  if(/working|workng|w days|wd|paid days/.test(n)) a.push('working days','worked days','paid days','wd','w days');
  if(/bank|account|ifsc/.test(n)) a.push('bank','account no','account number','ifsc');
  if(/ot|overtime/.test(n)) a.push('ot','overtime','ot hours','ot amount');
  if(/bonus/.test(n)) a.push('bonus');
  if(/july|jul/.test(n)) a.push('jul','july','07','2026-07');
  if(/august|aug/.test(n)) a.push('aug','august','08','2026-08');
  if(/june|jun/.test(n)) a.push('jun','june','06','2026-06');
  if(/may/.test(n)) a.push('may','05','2026-05');
  if(/april|apr/.test(n)) a.push('apr','april','04','2026-04');
  if(/march|mar/.test(n)) a.push('mar','march','03','2026-03');
  if(/february|feb/.test(n)) a.push('feb','february','02','2026-02');
  return a;
}
function flatten(v,depth,out,key){
  if(depth>2||out.length>100) return;
  if(v==null) return;
  if(typeof v==='string'||typeof v==='number'||typeof v==='boolean'){
    var s=String(v); if(s.length>300)s=s.slice(0,300); out.push((key?key+': ':'')+s); return;
  }
  if(Array.isArray(v)){ for(var i=0;i<Math.min(v.length,20);i++) flatten(v[i],depth+1,out,key); return; }
  if(typeof v==='object'){
    Object.keys(v).slice(0,80).forEach(function(k){
      if(/blob|buffer|bytes|filedata|base64/i.test(k))return;
      flatten(v[k],depth+1,out,k);
    });
  }
}
function rowText(r){var o=[];flatten(r,0,o,'');return o.join(' | ');}
function getStoreAll(dbName,store){
  return new Promise(function(resolve){
    var rq=indexedDB.open(dbName);
    rq.onerror=function(){resolve([]);};
    rq.onsuccess=function(){
      var db=rq.result;
      if(!db.objectStoreNames.contains(store)){db.close();return resolve([]);}
      var tx=db.transaction(store,'readonly'), os=tx.objectStore(store), g=os.getAll();
      g.onsuccess=function(){var x=g.result||[];db.close();resolve(x);};
      g.onerror=function(){db.close();resolve([]);};
    };
  });
}
async function loadRows(){
  if(rowsCache) return rowsCache;
  var all=[];
  try{all=all.concat(await getStoreAll('ATPL_HR_AI_PRO','rows'));}catch(_){ }
  try{
    if(window.EM&&Array.isArray(window.EM.data)){
      window.EM.data.forEach(function(r){all.push({__source:'Employee Master',data:r});});
    }
  }catch(_){ }
  try{
    if(Array.isArray(window.FILES)){
      window.FILES.forEach(function(f){
        if(f&&Array.isArray(f.sheets)) f.sheets.forEach(function(sh){
          var rs=sh.rows||sh.data||[];
          if(Array.isArray(rs)) rs.slice(0,3000).forEach(function(r){all.push({__source:(f.name||'ERP File')+' / '+(sh.name||'Sheet'),data:r});});
        });
      });
    }
  }catch(_){ }
  rowsCache=all;
  return all;
}
function scoreRow(txt,q,qt,als){
  var n=norm(txt), score=0;
  var code=(String(q).match(/\b0*\d{3,8}\b/)||[])[0];
  if(code){
    var c1=code.replace(/^0+/,'')||'0';
    if(n.indexOf(code.toLowerCase())>=0) score+=80;
    else if(new RegExp('\\b0*'+c1+'\\b').test(n)) score+=70;
    else return -1;
  }
  qt.forEach(function(t){if(n.indexOf(t)>=0)score+=8;});
  als.forEach(function(a){if(n.indexOf(norm(a))>=0)score+=5;});
  if(/salary|pf|esic|esi|working|bank|ot|bonus/.test(n)) score+=1;
  return score;
}
async function buildContext(q){
  var rows=await loadRows(), qt=tokens(q), als=aliases(q), scored=[];
  for(var i=0;i<rows.length;i++){
    var txt=rowText(rows[i]);
    var s=scoreRow(txt,q,qt,als);
    if(s>0) scored.push({s:s,t:txt});
  }
  scored.sort(function(a,b){return b.s-a.s;});
  var seen={}, picked=[];
  for(var j=0;j<scored.length&&picked.length<MAX_ROWS;j++){
    var t=scored[j].t.replace(/\s+/g,' ').trim();
    if(!t||seen[t])continue;seen[t]=1;
    if(t.length>700)t=t.slice(0,700)+'…';
    picked.push(t);
  }
  var header='LOCAL ERP RETRIEVAL: '+picked.length+' most relevant records selected from '+rows.length+' indexed rows.\nQuestion: '+q+'\n';
  var ctx=header+picked.map(function(x,i){return 'R'+(i+1)+': '+x;}).join('\n');
  if(ctx.length>MAX_CONTEXT_CHARS)ctx=ctx.slice(0,MAX_CONTEXT_CHARS)+'\n[Context capped safely to stay within free LLM token limit]';
  return {context:ctx,count:picked.length,total:rows.length};
}
function recentHistory(){return chat.slice(0,-1).slice(-6).map(function(m){return {role:m.role,content:String(m.text||'').slice(0,500)};});}
async function callLLM(q,ctx){
  var body=new URLSearchParams();
  body.set('question',q);
  body.set('context',ctx);
  body.set('history',JSON.stringify(recentHistory()));
  var c=new AbortController(), tm=setTimeout(function(){c.abort();},45000);
  try{
    var r=await fetch(BACKEND,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},body:body.toString(),signal:c.signal,redirect:'follow'});
    var txt=await r.text(), data;
    try{data=JSON.parse(txt);}catch(_){throw new Error('Backend response samajh nahi aaya.');}
    if(!data.ok)throw new Error(data.error||'LLM backend error');
    if(!String(data.answer||'').trim())throw new Error('Answer empty mila.');
    return String(data.answer).trim();
  }finally{clearTimeout(tm);}
}
function saveChat(){try{localStorage.setItem('ARORA_LLM_V5_CHAT',JSON.stringify(chat.slice(-60)));}catch(_){}}
function loadChat(){try{var x=JSON.parse(localStorage.getItem('ARORA_LLM_V5_CHAT')||'[]');if(Array.isArray(x))chat=x;}catch(_){chat=[];}}
function render(){
  if(!overlay)return;
  var msgs=overlay.querySelector('#v5msgs'); if(!msgs)return;
  msgs.innerHTML=chat.map(function(m,i){
    var u=m.role==='user';
    return '<div class="v5msg '+(u?'u':'a')+'"><div class="v5bubble">'+esc(m.text).replace(/\n/g,'<br>')+'</div><div class="v5meta">'+(m.meta?esc(m.meta)+' · ':'')+(u?'<button data-act="edit" data-i="'+i+'">Edit</button> ':'')+'<button data-act="del" data-i="'+i+'">Delete</button></div></div>';
  }).join('');
  msgs.scrollTop=msgs.scrollHeight;
}
function css(){return '<style id="v5css">#aroraLLMV5{position:fixed;inset:0;z-index:2147483000;background:#f5f7fb;display:flex;flex-direction:column;font-family:Inter,Arial,sans-serif;color:#0f172a}#aroraLLMV5 .v5head{height:64px;background:#0f1b35;color:#fff;display:flex;align-items:center;padding:0 18px;gap:12px;box-shadow:0 2px 10px #0002}#aroraLLMV5 .v5title{font-weight:800;font-size:17px}#aroraLLMV5 .v5sub{font-size:11px;color:#a8b4cc;margin-top:3px}#aroraLLMV5 .v5head .sp{flex:1}#aroraLLMV5 button{font:inherit}#aroraLLMV5 .pill{border:1px solid #ffffff33;background:#ffffff12;color:#fff;border-radius:18px;padding:7px 12px;cursor:pointer}#aroraLLMV5 .v5body{display:flex;flex:1;min-height:0}#aroraLLMV5 .v5side{width:250px;background:#fff;border-right:1px solid #e2e8f0;padding:14px;overflow:auto}#aroraLLMV5 .label{font-size:10px;font-weight:800;color:#94a3b8;letter-spacing:1.4px;margin:8px 0}#aroraLLMV5 .quick{display:block;width:100%;text-align:left;border:1px solid #e2e8f0;background:#fff;border-radius:10px;padding:9px 10px;margin:7px 0;cursor:pointer;color:#334155}#aroraLLMV5 .note{margin-top:16px;padding:10px;border-radius:10px;background:#ecfdf5;border:1px solid #a7f3d0;font-size:11px;line-height:1.5;color:#047857}#aroraLLMV5 .main{flex:1;min-width:0;display:flex;flex-direction:column}#v5msgs{flex:1;overflow:auto;padding:26px 34px}#aroraLLMV5 .v5msg{display:flex;flex-direction:column;margin:12px 0;max-width:75%}#aroraLLMV5 .v5msg.u{margin-left:auto;align-items:flex-end}#aroraLLMV5 .v5msg.a{margin-right:auto;align-items:flex-start}#aroraLLMV5 .v5bubble{padding:12px 14px;border-radius:13px;background:#fff;border:1px solid #e2e8f0;box-shadow:0 2px 7px #0000000d;line-height:1.48;font-size:14px;white-space:normal}#aroraLLMV5 .u .v5bubble{background:#3930a3;color:#fff;border-color:#3930a3}#aroraLLMV5 .v5meta{font-size:10px;color:#94a3b8;margin:4px 5px}#aroraLLMV5 .v5meta button{border:0;background:none;color:#64748b;cursor:pointer;font-size:10px;padding:0 3px}#aroraLLMV5 .composer{padding:13px 18px;border-top:1px solid #e2e8f0;background:#fff;display:flex;gap:10px}#v5input{flex:1;border:1px solid #cbd5e1;border-radius:12px;padding:12px 14px;font:inherit;outline:none}#v5send{border:0;border-radius:12px;background:#4f46e5;color:#fff;padding:0 20px;font-weight:700;cursor:pointer}#v5send:disabled{opacity:.55;cursor:wait}@media(max-width:800px){#aroraLLMV5 .v5side{display:none}#v5msgs{padding:18px 12px}#aroraLLMV5 .v5msg{max-width:92%}}</style>';}
function ensureUI(){
  if(overlay&&document.body.contains(overlay))return overlay;
  if(!document.getElementById('v5css'))document.head.insertAdjacentHTML('beforeend',css());
  overlay=document.createElement('div');overlay.id='aroraLLMV5';
  overlay.innerHTML='<div class="v5head"><div><div class="v5title">🧠 Arora ERP AI — LLM Brain</div><div class="v5sub">Groq + compact ERP retrieval · Hindi · English · Hinglish</div></div><div class="sp"></div><button class="pill" id="v5sync">↻ Sync Data</button><button class="pill" id="v5legacy">Local Data Tools</button><button class="pill" id="v5close">✕ Close</button></div><div class="v5body"><aside class="v5side"><div class="label">ASK NATURALLY</div><button class="quick">26286 ne last konse month me salary li?</button><button class="quick">Manisha Juneja ki July PF amount kitni hai?</button><button class="quick">00135 ki August working days kitni thi?</button><button class="quick">Last month PF kis kis ka increase hua?</button><div class="note"><b>Smart context limit ON</b><br>AI ab sirf sabse relevant ERP records bhejta hai, isliye Groq free token-limit error avoid hoga.</div></aside><main class="main"><div id="v5msgs"></div><div class="composer"><input id="v5input" placeholder="Kuch bhi poochho — galat spelling/Hinglish bhi chalega"><button id="v5send">Send</button></div></main></div>';
  document.body.appendChild(overlay);
  overlay.querySelector('#v5close').onclick=function(){overlay.style.display='none';};
  overlay.querySelector('#v5sync').onclick=function(){rowsCache=null;addMsg('assistant','Data cache refresh ho gaya. Agle question par latest indexed ERP records read honge.');};
  overlay.querySelector('#v5legacy').onclick=function(){overlay.style.display='none';try{if(typeof OLD_TOGGLE==='function')OLD_TOGGLE();}catch(_){}};
  overlay.querySelectorAll('.quick').forEach(function(b){b.onclick=function(){overlay.querySelector('#v5input').value=b.textContent;send();};});
  overlay.querySelector('#v5send').onclick=send;
  overlay.querySelector('#v5input').onkeydown=function(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send();}};
  overlay.querySelector('#v5msgs').onclick=function(e){var b=e.target.closest('button[data-act]');if(!b)return;var i=+b.dataset.i;if(b.dataset.act==='del'){chat.splice(i,1);saveChat();render();}else if(b.dataset.act==='edit'){var m=chat[i];if(m){overlay.querySelector('#v5input').value=m.text;chat.splice(i,1);saveChat();render();overlay.querySelector('#v5input').focus();}}};
  render();return overlay;
}
function addMsg(role,text,meta){chat.push({role:role,text:text,meta:meta||''});saveChat();render();}
async function send(){
  var ui=ensureUI(), inp=ui.querySelector('#v5input'), btn=ui.querySelector('#v5send'), q=inp.value.trim();
  if(!q||btn.disabled)return;inp.value='';addMsg('user',q);btn.disabled=true;btn.textContent='Thinking…';
  try{
    var r=await buildContext(q);
    var a=await callLLM(q,r.context);
    addMsg('assistant',a,'ERP context: '+r.count+' relevant records');
  }catch(e){
    var msg=String(e&&e.message||e);
    if(/413|too large|tokens per minute|Request too large/i.test(msg)) msg='Free LLM token limit hit hui. V5 compact context active hai; Sync Data karke question dobara try karo.';
    else if(/abort/i.test(msg)) msg='LLM response timeout hua. Question dobara try karo.';
    addMsg('assistant','LLM backend issue: '+msg);
  }finally{btn.disabled=false;btn.textContent='Send';}
}
function open(){var x=ensureUI();x.style.display='flex';setTimeout(function(){var i=x.querySelector('#v5input');if(i)i.focus();},50);}
loadChat();
window.toggleAIChat=open;
window.sendAIMsg=function(){var old=document.getElementById('aiInput');open();if(old&&old.value){ensureUI().querySelector('#v5input').value=old.value;old.value='';}send();};
window.aiQuick=function(q){open();ensureUI().querySelector('#v5input').value=q;send();};
window.AroraLLM={open:open,send:send,sync:function(){rowsCache=null;}};
function hook(){var b=document.getElementById('aiChatBtn');if(b)b.onclick=open;}
hook();setTimeout(hook,500);setTimeout(hook,1800);
})();
