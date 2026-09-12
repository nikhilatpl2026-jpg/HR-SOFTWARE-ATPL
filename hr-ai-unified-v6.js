/* Arora ERP AI V6 — unified, lazy, hybrid local+LLM assistant. */
(function(){
'use strict';
if(window.__ARORA_AI_V6__) return;
window.__ARORA_AI_V6__=1;

var BACKEND='https://script.google.com/macros/s/AKfycbyqcm2R4CxBBV0Xq-xS_h_Rzh1a3NQZ8JCjqL3eOzIdlI81tfYZOVVwVppmfdQPNsAGCg/exec';
var MAX_ROWS=8, MAX_CONTEXT_CHARS=4600, MAX_ROW_CHARS=480;
var rowsCache=null, searchIndex=null, overlay=null, busy=false;
var chat=[];
var pending=window.__ARORA_AI_PENDING||'';
window.__ARORA_AI_PENDING='';

function esc(s){return String(s==null?'':s).replace(/[&<>\"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c];});}
function norm(s){return String(s||'').toLowerCase().replace(/[^a-z0-9\u0900-\u097f]+/g,' ').replace(/\s+/g,' ').trim();}
function stripLeadZero(s){s=String(s||'').replace(/\D/g,''); return (s.replace(/^0+/,'')||'0');}
function extractCode(q){var m=String(q||'').match(/\b0*\d{3,8}\b/);return m?m[0]:'';}
function delay(){return new Promise(function(r){setTimeout(r,0);});}
function monthTokens(q){
  var n=norm(q), map=[['january','jan','01'],['february','feb','02'],['march','mar','03'],['april','apr','04'],['may','may','05'],['june','jun','06'],['july','jul','07'],['august','aug','08'],['september','sep','09'],['october','oct','10'],['november','nov','11'],['december','dec','12']];
  for(var i=0;i<map.length;i++) if(n.indexOf(map[i][0])>=0||new RegExp('\\b'+map[i][1]+'\\b').test(n)) return map[i];
  var mm=String(q||'').match(/\b(0?[1-9]|1[0-2])[-\/.](20\d{2}|\d{2})\b/); if(mm){var m=('0'+mm[1]).slice(-2);return ['', '', m];}
  return null;
}
function intent(q){
  var n=norm(q);
  if(/working|workng|worked|paid days|w days|wd\b/.test(n)) return 'workingDays';
  if(/\bpf\b|epf|provident/.test(n)) return 'pf';
  if(/esic|\besi\b/.test(n)) return 'esic';
  if(/overtime|\bot\b/.test(n)) return /hour/.test(n)?'otHours':'ot';
  if(/bonus/.test(n)) return 'bonus';
  if(/bank|account|ifsc/.test(n)) return 'bank';
  if(/salary|selry|slry|net pay|payment|gross/.test(n)){
    if(/last|latest|kab|konse month|kaunse month/.test(n)) return 'lastSalary';
    if(/change|badla|increase|decrease/.test(n)) return 'salaryChange';
    return 'salary';
  }
  return 'general';
}
function queryTokens(q){
  var stop={ki:1,ka:1,ke:1,ko:1,kya:1,hai:1,he:1,h:1,bhai:1,me:1,mein:1,tha:1,thi:1,the:1,ne:1,aur:1,se:1,kab:1,bata:1,batao:1,kitna:1,kitni:1,amount:1,emp:1,employee:1,code:1};
  return norm(q).split(' ').filter(function(x){return x.length>1&&!stop[x];});
}
function aliasesFor(q){
  var t=intent(q), a=[];
  if(t==='pf')a=['pf','epf','provident fund','employee pf','pf amount','pf deduction'];
  if(t==='esic')a=['esic','esi','employee esi','esi amount','esic amount'];
  if(t==='workingDays')a=['working days','worked days','paid days','w days','wd'];
  if(t==='salary'||t==='lastSalary'||t==='salaryChange')a=['salary','net payment','net pay','gross','payable','net salary'];
  if(t==='ot'||t==='otHours')a=['ot','overtime','ot hours','ot amount'];
  if(t==='bonus')a=['bonus'];
  if(t==='bank')a=['bank','account no','account number','ifsc'];
  var mt=monthTokens(q); if(mt)a=a.concat(mt.filter(Boolean));
  return a;
}
function flatten(v,depth,out,key){
  if(depth>3||out.length>120||v==null)return;
  if(typeof v==='string'||typeof v==='number'||typeof v==='boolean'){
    var s=String(v);if(s.length>260)s=s.slice(0,260);out.push((key?key+': ':'')+s);return;
  }
  if(Array.isArray(v)){for(var i=0;i<Math.min(v.length,24);i++)flatten(v[i],depth+1,out,key);return;}
  if(typeof v==='object')Object.keys(v).slice(0,90).forEach(function(k){if(!/blob|buffer|bytes|filedata|base64/i.test(k))flatten(v[k],depth+1,out,k);});
}
function rowText(r){var o=[];flatten(r,0,o,'');return o.join(' | ');}
function getStoreAll(dbName,store){
  return new Promise(function(resolve){
    try{
      var rq=indexedDB.open(dbName);
      rq.onerror=function(){resolve([]);};
      rq.onsuccess=function(){
        var db=rq.result;if(!db.objectStoreNames.contains(store)){db.close();return resolve([]);}
        var tx=db.transaction(store,'readonly'),g=tx.objectStore(store).getAll();
        g.onsuccess=function(){var x=g.result||[];db.close();resolve(x);};g.onerror=function(){db.close();resolve([]);};
      };
    }catch(_){resolve([]);}
  });
}
async function loadRows(force){
  if(rowsCache&&!force)return rowsCache;
  var all=[];
  try{var dbrows=await getStoreAll('ATPL_HR_AI_PRO','rows');if(dbrows.length)all=all.concat(dbrows);}catch(_){ }
  try{if(window.EM&&Array.isArray(window.EM.data))window.EM.data.forEach(function(r){all.push({__source:'Employee Master',data:r});});}catch(_){ }
  if(all.length<100){
    try{if(Array.isArray(window.FILES))window.FILES.forEach(function(f){if(f&&Array.isArray(f.sheets))f.sheets.forEach(function(sh){var rs=sh.rows||sh.data||[];if(Array.isArray(rs))rs.slice(0,2500).forEach(function(r){all.push({__source:(f.name||'ERP File')+' / '+(sh.name||'Sheet'),data:r});});});});}catch(_){ }
  }
  rowsCache=all;searchIndex=null;return all;
}
async function ensureIndex(){
  if(searchIndex)return searchIndex;
  var rows=await loadRows(false), idx=[];
  for(var i=0;i<rows.length;i++){
    var text=rowText(rows[i]);
    idx.push({raw:rows[i],text:text,n:norm(text)});
    if(i&&i%1000===0)await delay();
  }
  searchIndex=idx;return idx;
}
function score(x,q,qt,als,code){
  var n=x.n,s=0;
  if(code){
    var c=stripLeadZero(code), re=new RegExp('\\b0*'+c+'\\b');
    if(n.indexOf(norm(code))>=0)s+=120;else if(re.test(n))s+=105;else return -1;
  }
  for(var i=0;i<qt.length;i++)if(n.indexOf(qt[i])>=0)s+=9;
  for(var j=0;j<als.length;j++)if(n.indexOf(norm(als[j]))>=0)s+=7;
  if(/salary|pf|esic|esi|working|bank|ot|bonus/.test(n))s+=1;
  return s;
}
async function retrieve(q){
  var idx=await ensureIndex(),qt=queryTokens(q),als=aliasesFor(q),code=extractCode(q),sc=[];
  for(var i=0;i<idx.length;i++){
    var s=score(idx[i],q,qt,als,code);if(s>0)sc.push({s:s,x:idx[i]});
    if(i&&i%3000===0)await delay();
  }
  sc.sort(function(a,b){return b.s-a.s;});
  var seen={},picked=[];
  for(var j=0;j<sc.length&&picked.length<MAX_ROWS;j++){
    var t=sc[j].x.text.replace(/\s+/g,' ').trim();if(!t||seen[t])continue;seen[t]=1;
    if(t.length>MAX_ROW_CHARS)t=t.slice(0,MAX_ROW_CHARS)+'…';picked.push({text:t,raw:sc[j].x.raw});
  }
  return {picked:picked,total:idx.length,count:picked.length};
}
function parseNumberAfter(text,labels){
  var s=String(text||'');
  for(var i=0;i<labels.length;i++){
    var l=labels[i].replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    var re=new RegExp('(?:^|[|,;\\s])'+l+'\\s*[:=\\-]?\\s*(?:rs\\.?|₹)?\\s*([0-9][0-9,]*(?:\\.[0-9]+)?)','i');
    var m=s.match(re);if(m)return m[1];
  }
  return '';
}
function extractMonth(text){
  var s=String(text||'').toLowerCase(), names=['january','february','march','april','may','june','july','august','september','october','november','december'];
  for(var i=0;i<12;i++){
    var sh=names[i].slice(0,3), re=new RegExp('(?:'+names[i]+'|'+sh+')[\\s_\\-/]*(20\\d{2}|\\d{2})?','i'),m=s.match(re);
    if(m){var y=m[1]?Number(m[1].length===2?'20'+m[1]:m[1]):0;return {m:i+1,y:y,label:names[i].charAt(0).toUpperCase()+names[i].slice(1)+(y?' '+y:'')};}
  }
  var n=s.match(/\b(20\d{2})[-\/.](0[1-9]|1[0-2])\b/);if(n)return {m:+n[2],y:+n[1],label:n[2]+'/'+n[1]};
  var n2=s.match(/\b(0?[1-9]|1[0-2])[-\/.](20\d{2}|\d{2})\b/);if(n2){var yy=+n2[2];if(yy<100)yy+=2000;return {m:+n2[1],y:yy,label:n2[1]+'/'+yy};}
  return null;
}
function monthMatchesQuestion(text,q){
  var mt=monthTokens(q);if(!mt)return true;var n=norm(text);return mt.some(function(x){return x&&n.indexOf(norm(x))>=0;});
}
function localAnswer(q,r){
  if(!r.picked.length)return '';
  var it=intent(q), code=extractCode(q), labels, unit='';
  if(it==='workingDays'){labels=['working days','worked days','paid days','w days','wd'];unit=' working days';}
  else if(it==='pf'){labels=['employee pf','pf amount','pf deduction','epf','pf'];unit=' PF';}
  else if(it==='esic'){labels=['employee esic','employee esi','esic amount','esi amount','esic','esi'];unit=' ESIC';}
  else if(it==='otHours'){labels=['ot hours','overtime hours'];unit=' OT hours';}
  else if(it==='ot'){labels=['ot amount','overtime amount','ot'];unit=' OT';}
  else if(it==='bonus'){labels=['bonus amount','bonus'];unit=' bonus';}
  else if(it==='salary'){labels=['net payment','net pay','net salary','salary','gross'];unit=' salary';}
  if(labels){
    var vals=[];
    for(var i=0;i<r.picked.length;i++){
      var t=r.picked[i].text;if(!monthMatchesQuestion(t,q))continue;var v=parseNumberAfter(t,labels);if(v)vals.push({v:v,t:t,m:extractMonth(t)});
    }
    if(vals.length){
      var uniq={};vals.forEach(function(x){uniq[x.v]=1;});var ks=Object.keys(uniq), mt=vals[0].m;
      if(ks.length===1)return (code?'Emp Code '+code:'Employee')+(mt?' — '+mt.label:'')+': '+ks[0]+unit+'.\nSource: local ERP record.';
      if(ks.length>1)return '⚠ Same employee/month ke matching records me different '+unit.trim()+' values mili: '+ks.slice(0,4).join(', ')+'. Main guess nahi karunga; source records review karo.';
    }
  }
  if(it==='lastSalary'){
    var ms=[];
    r.picked.forEach(function(x){var m=extractMonth(x.text);if(m&&( /salary|net payment|gross|payable/i.test(x.text)))ms.push(m);});
    if(ms.length){ms.sort(function(a,b){return ((b.y||0)*12+b.m)-((a.y||0)*12+a.m);});return (code?'Emp Code '+code:'Employee')+' ka latest salary record: '+ms[0].label+'.\nSource: local ERP salary record.';}
  }
  return '';
}
function buildContext(q,r){
  var lines=r.picked.map(function(x,i){return 'R'+(i+1)+': '+x.text;});
  var ctx='ERP evidence only. Use exact values; do not invent. Question: '+q+'\n'+lines.join('\n');
  return ctx.length>MAX_CONTEXT_CHARS?ctx.slice(0,MAX_CONTEXT_CHARS):ctx;
}
function recentHistory(){return chat.slice(0,-1).filter(function(m){return m.role==='user'||m.role==='assistant';}).slice(-2).map(function(m){return {role:m.role,content:String(m.text||'').slice(0,220)};});}
async function callLLM(q,ctx){
  var body=new URLSearchParams();body.set('question',q+'\nReply briefly (normally under 100 words) unless I ask for detail.');body.set('context',ctx||'');body.set('history',JSON.stringify(recentHistory()));
  var c=new AbortController(),tm=setTimeout(function(){c.abort();},35000);
  try{
    var resp=await fetch(BACKEND,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},body:body.toString(),signal:c.signal,redirect:'follow'}),txt=await resp.text(),data;
    try{data=JSON.parse(txt);}catch(_){throw new Error('Backend response invalid');}
    if(!data.ok)throw new Error(data.error||'LLM backend error');if(!String(data.answer||'').trim())throw new Error('Empty answer');return String(data.answer).trim();
  }finally{clearTimeout(tm);}
}
function saveChat(){try{localStorage.setItem('ARORA_AI_V6_CHAT',JSON.stringify(chat.slice(-80)));}catch(_){}}
function loadChat(){try{var x=JSON.parse(localStorage.getItem('ARORA_AI_V6_CHAT')||'[]');if(Array.isArray(x))chat=x;}catch(_){chat=[];}}
function add(role,text,meta){chat.push({role:role,text:String(text||''),meta:meta||''});saveChat();render();}
function render(){
  if(!overlay)return;var box=overlay.querySelector('#aiv6msgs');if(!box)return;
  box.innerHTML=chat.map(function(m,i){var u=m.role==='user';return '<div class="aiv6msg '+(u?'u':'a')+'"><div class="aiv6bubble">'+esc(m.text).replace(/\n/g,'<br>')+'</div><div class="aiv6meta">'+(m.meta?esc(m.meta)+' · ':'')+(u?'<button data-act="edit" data-i="'+i+'">Edit</button> ':'')+'<button data-act="del" data-i="'+i+'">Delete</button></div></div>';}).join('');box.scrollTop=box.scrollHeight;
}
function css(){return '<style id="aiv6css">#aroraAIV6{position:fixed;inset:0;z-index:2147483000;background:#f5f7fb;display:flex;flex-direction:column;font-family:Inter,Arial,sans-serif;color:#0f172a}#aroraAIV6 .head{height:62px;background:#0f1b35;color:#fff;display:flex;align-items:center;padding:0 18px;gap:10px}#aroraAIV6 .title{font-weight:800;font-size:17px}#aroraAIV6 .sub{font-size:11px;color:#b6c2d8;margin-top:2px}#aroraAIV6 .sp{flex:1}#aroraAIV6 .pill{border:1px solid #ffffff33;background:#ffffff12;color:#fff;border-radius:18px;padding:7px 11px;cursor:pointer}#aroraAIV6 .body{display:flex;flex:1;min-height:0}#aroraAIV6 aside{width:245px;background:#fff;border-right:1px solid #e2e8f0;padding:14px;overflow:auto}#aroraAIV6 .label{font-size:10px;font-weight:800;color:#94a3b8;letter-spacing:1.2px;margin:7px 0}#aroraAIV6 .quick{display:block;width:100%;text-align:left;border:1px solid #e2e8f0;background:#fff;border-radius:9px;padding:9px;margin:7px 0;cursor:pointer}#aroraAIV6 .status{margin-top:15px;padding:10px;border-radius:10px;background:#ecfdf5;border:1px solid #a7f3d0;font-size:11px;line-height:1.5;color:#047857}#aroraAIV6 main{flex:1;display:flex;flex-direction:column;min-width:0}#aiv6msgs{flex:1;overflow:auto;padding:24px 30px}#aroraAIV6 .aiv6msg{display:flex;flex-direction:column;margin:12px 0;max-width:76%}#aroraAIV6 .aiv6msg.u{margin-left:auto;align-items:flex-end}#aroraAIV6 .aiv6bubble{padding:12px 14px;border-radius:13px;background:#fff;border:1px solid #e2e8f0;box-shadow:0 2px 7px #0001;line-height:1.5;font-size:14px}#aroraAIV6 .u .aiv6bubble{background:#3930a3;color:#fff;border-color:#3930a3}#aroraAIV6 .aiv6meta{font-size:10px;color:#94a3b8;margin:4px 5px}#aroraAIV6 .aiv6meta button{border:0;background:none;color:#64748b;cursor:pointer;font-size:10px;padding:0 3px}#aroraAIV6 .composer{padding:12px 16px;background:#fff;border-top:1px solid #e2e8f0;display:flex;gap:9px}#aiv6input{flex:1;border:1px solid #cbd5e1;border-radius:11px;padding:12px 14px;font:inherit;outline:none}#aiv6send{border:0;border-radius:11px;background:#4f46e5;color:#fff;padding:0 20px;font-weight:700;cursor:pointer}#aiv6send:disabled{opacity:.55}@media(max-width:800px){#aroraAIV6 aside{display:none}#aiv6msgs{padding:16px 10px}#aroraAIV6 .aiv6msg{max-width:93%}}</style>';}
function ensureUI(){
  if(overlay&&document.body.contains(overlay))return overlay;if(!document.getElementById('aiv6css'))document.head.insertAdjacentHTML('beforeend',css());
  overlay=document.createElement('div');overlay.id='aroraAIV6';overlay.innerHTML='<div class="head"><div><div class="title">🧠 Arora ERP AI Assistant</div><div class="sub">Lazy-load · Local ERP answers + Groq LLM · Hindi / English / Hinglish</div></div><div class="sp"></div><button class="pill" id="aiv6sync">↻ Sync Data</button><button class="pill" id="aiv6clear">Clear Chat</button><button class="pill" id="aiv6close">✕ Close</button></div><div class="body"><aside><div class="label">QUICK TESTS</div><button class="quick">26286 ne last konse month me salary li?</button><button class="quick">Manisha Juneja ki July PF amount kitni hai?</button><button class="quick">00135 ki August working days kitni thi?</button><button class="quick">ESIC ke current general rules samjhao</button><div class="status" id="aiv6status"><b>Startup safe mode ON</b><br>AI data tabhi read karega jab aap question poochoge. Login/reload par heavy scan nahi chalega.</div></aside><main><div id="aiv6msgs"></div><div class="composer"><input id="aiv6input" placeholder="Kuch bhi poochho — spelling galat ho to bhi try karega"><button id="aiv6send">Send</button></div></main></div>';document.body.appendChild(overlay);
  overlay.querySelector('#aiv6close').onclick=function(){overlay.style.display='none';};
  overlay.querySelector('#aiv6sync').onclick=async function(){rowsCache=null;searchIndex=null;this.disabled=true;this.textContent='Syncing…';await loadRows(true);this.disabled=false;this.textContent='↻ Sync Data';add('assistant','Data cache refresh ho gaya. Latest indexed ERP records next question me use honge.');};
  overlay.querySelector('#aiv6clear').onclick=function(){if(confirm('AI chat history clear karni hai?')){chat=[];saveChat();render();}};
  overlay.querySelector('#aiv6send').onclick=send;overlay.querySelector('#aiv6input').onkeydown=function(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send();}};
  overlay.querySelectorAll('.quick').forEach(function(b){b.onclick=function(){overlay.querySelector('#aiv6input').value=b.textContent;send();};});
  overlay.querySelector('#aiv6msgs').onclick=function(e){var b=e.target.closest('button[data-act]');if(!b)return;var i=+b.dataset.i;if(b.dataset.act==='del'){chat.splice(i,1);saveChat();render();}else{var m=chat[i];if(m){overlay.querySelector('#aiv6input').value=m.text;chat.splice(i,1);saveChat();render();overlay.querySelector('#aiv6input').focus();}}};
  render();return overlay;
}
async function send(){
  var ui=ensureUI(),inp=ui.querySelector('#aiv6input'),btn=ui.querySelector('#aiv6send'),st=ui.querySelector('#aiv6status'),q=inp.value.trim();if(!q||busy)return;inp.value='';add('user',q);busy=true;btn.disabled=true;btn.textContent='Searching…';st.innerHTML='<b>Searching local ERP…</b><br>Only relevant records will be sent to LLM.';
  try{
    var r=await retrieve(q), local=localAnswer(q,r);
    if(local){add('assistant',local,'Local ERP · '+r.count+' matches');st.innerHTML='<b>Answered locally</b><br>No LLM tokens used for this exact payroll lookup.';return;}
    btn.textContent='Thinking…';var ctx=buildContext(q,r),ans=await callLLM(q,ctx);add('assistant',ans,(r.count?'ERP evidence: '+r.count+' records':'General LLM answer'));st.innerHTML='<b>LLM answer ready</b><br>Compact context used to protect free Groq limit.';
  }catch(e){
    var msg=String(e&&e.message||e);
    if(/413|too large|tokens per minute|rate_limit/i.test(msg))msg='Groq free token-per-minute limit abhi busy hai. Exact ERP lookups local mode me chalenge; general LLM question ke liye ~1 minute baad try karo.';
    else if(/abort/i.test(msg))msg='LLM response timeout hua. Local ERP data safe hai; question dobara try karo.';
    add('assistant',msg,'Safe fallback');st.innerHTML='<b>Safe fallback active</b><br>ERP data change nahi hua.';
  }finally{busy=false;btn.disabled=false;btn.textContent='Send';}
}
function open(){var x=ensureUI();x.style.display='flex';setTimeout(function(){var i=x.querySelector('#aiv6input');if(i){if(pending){i.value=pending;pending='';send();}else i.focus();}},30);}
loadChat();
window.AroraAIV6={open:open,send:send,sync:function(){rowsCache=null;searchIndex=null;}};
window.toggleAIChat=open;
window.sendAIMsg=function(){var old=document.getElementById('aiInput');if(old&&old.value){pending=old.value;old.value='';}open();};
window.aiQuick=function(q){pending=q;open();};
if(pending)setTimeout(open,0);
})();
