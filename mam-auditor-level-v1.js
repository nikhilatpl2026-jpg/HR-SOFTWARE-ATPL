/* ATPL Mam Compliance — Auditor Level Selector V1
   Presentation + audit strictness only. Statutory calculations are never changed by auditor level. */
(function(root,factory){
  var api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  else { root.ATPLMamAuditorLevelV1=api; api.install(root); }
})(typeof window!=='undefined'?window:globalThis,function(){'use strict';
  var KEY='ATPL_MamAuditorLevel_V1';
  var LEVELS=[
    {value:1,key:'BASIC',label:'Basic',rank:6,scope:'Internal HR Review'},
    {value:2,key:'STANDARD',label:'Standard',rank:7,scope:'Compliance Review'},
    {value:3,key:'HIGH',label:'High',rank:8,scope:'External Auditor Ready'},
    {value:4,key:'VERY_HIGH',label:'Very High',rank:9,scope:'Buyer / Brand Audit Ready'},
    {value:5,key:'MAXIMUM',label:'Maximum',rank:10,scope:'IWAY-style Internal Readiness'}
  ];
  function text(v){return v==null?'':String(v).trim()}
  function norm(v){return text(v).toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim()}
  function num(v){var s=text(v).replace(/[₹,\s]/g,'');if(!s)return null;var n=Number(s);return Number.isFinite(n)?n:null}
  function levelOf(v){var n=Math.max(1,Math.min(5,parseInt(v,10)||3));return LEVELS[n-1]}
  function addReason(out,code,msg,row){var k=(row&&row.code||'')+'|'+code;if(!out._seen[k]){out._seen[k]=1;out.reasons.push({code:code,message:msg,row:row||null})}}
  function assessRows(levelValue,rows,fields){
    var L=levelOf(levelValue),out={level:L,blockers:0,reasons:[],_seen:{}};rows=Array.isArray(rows)?rows:[];fields=fields||{};
    rows.forEach(function(r){
      var status=text(r.status).toUpperCase(),diff=Math.abs(num(r.diff)||0),manual=num(r.manual)||0,gross=num(r.gross)||0,pd=num(r.paidDays);
      if(status==='BLOCKED') addReason(out,'SOURCE_BLOCKED','Existing compliance source/rule blocker must be resolved.',r);
      if(L.value>=2){
        [['department','Department'],['designation','Designation'],['category','Category']].forEach(function(x){if(fields[x[0]]&&!text(r[x[0]]))addReason(out,'MISSING_'+x[0].toUpperCase(),x[1]+' missing for selected auditor level.',r)});
      }
      if(L.value>=3){
        if(status==='WARNING') addReason(out,'WARNING_PENDING','Warning/review item must be cleared for High or above.',r);
        [['dob','DOB'],['doj','DOJ']].forEach(function(x){if(fields[x[0]]&&!text(r[x[0]]))addReason(out,'MISSING_'+x[0].toUpperCase(),x[1]+' missing for external-audit readiness.',r)});
      }
      if(L.value>=4){
        if(fields.paidDays&&(pd===null||pd<0||pd>31)&&(manual>0||gross>0))addReason(out,'PAID_DAYS_REVIEW','Paid Days missing/invalid for Very High audit level.',r);
        if(fields.diff&&diff>1)addReason(out,'MANUAL_DIFF_REVIEW','Manual vs compliance difference must be cleared for Very High or above.',r);
      }
      if(L.value>=5){
        if(status!=='READY')addReason(out,'NOT_FULLY_READY','Maximum level requires every employee row to be READY.',r);
        if(fields.diff&&diff>0.01)addReason(out,'ZERO_DIFF_REQUIRED','Maximum level requires zero unexplained manual difference.',r);
        if(text(r.issues)&&!/^[-—]?$/.test(text(r.issues)))addReason(out,'ISSUE_TRAIL_PENDING','Maximum level requires all listed issues to be resolved.',r);
      }
    });
    out.blockers=out.reasons.length;delete out._seen;return out;
  }
  function headerIndex(table){var m={},ths=table?table.querySelectorAll('thead th'):[];Array.prototype.forEach.call(ths,function(th,i){m[norm(th.textContent)]=i});return m}
  function pick(map,names){for(var i=0;i<names.length;i++){var k=norm(names[i]);if(Object.prototype.hasOwnProperty.call(map,k))return map[k]}return -1}
  function readRows(doc){
    var t=doc.getElementById('mc5Table');if(!t)return {rows:[],fields:{}};var h=headerIndex(t);
    var idx={code:pick(h,['Employee ID']),status:pick(h,['Audit Status']),diff:pick(h,['Diff Amount']),manual:pick(h,['Manual Amount']),gross:pick(h,['Total Gross Salary','Gross Earned']),department:pick(h,['Department']),designation:pick(h,['Designation']),category:pick(h,['Category 01','Category']),dob:pick(h,['DOB']),doj:pick(h,['DOJ']),paidDays:pick(h,['Paid Days']),issues:pick(h,['Issues','Remarks'])};
    var fields={};Object.keys(idx).forEach(function(k){fields[k]=idx[k]>=0});var rows=[];
    Array.prototype.forEach.call(t.querySelectorAll('tbody tr'),function(tr){var c=tr.children,get=function(k){var i=idx[k];return i>=0&&c[i]?text(c[i].textContent):''};rows.push({code:get('code'),status:get('status')||(tr.classList.contains('blocked')?'BLOCKED':tr.classList.contains('warning')?'WARNING':tr.classList.contains('ready')?'READY':''),diff:get('diff'),manual:get('manual'),gross:get('gross'),department:get('department'),designation:get('designation'),category:get('category'),dob:get('dob'),doj:get('doj'),paidDays:get('paidDays'),issues:get('issues')})});
    return {rows:rows,fields:fields};
  }
  function stored(root){try{return Math.max(1,Math.min(5,parseInt(root.localStorage.getItem(KEY),10)||3))}catch(_){return 3}}
  function save(root,v){try{root.localStorage.setItem(KEY,String(v))}catch(_){}}
  function css(doc){if(doc.getElementById('mc5AuditorCss'))return;var s=doc.createElement('style');s.id='mc5AuditorCss';s.textContent='#mc5AuditorCard{width:178px;min-height:74px;background:#fff;border:1px solid #e5e7eb;border-radius:22px;padding:11px 14px 9px;box-shadow:0 10px 30px rgba(15,23,42,.10);display:flex;flex-direction:column;justify-content:center;gap:5px;align-self:stretch}#mc5AuditorTop{display:flex;align-items:center;justify-content:center;gap:5px;font-size:13px;font-weight:800;color:#111827;line-height:1}#mc5AuditorTop b{font-size:18px;color:#94a3b8;font-weight:500;transform:translateY(-1px)}#mc5AuditorRange{appearance:none;-webkit-appearance:none;width:100%;height:6px;border-radius:999px;outline:0;margin:5px 0 1px;cursor:pointer;background:linear-gradient(90deg,#1689ff 50%,#e5e7eb 50%)}#mc5AuditorRange::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:23px;height:23px;border-radius:50%;background:#fff;border:1px solid #cbd5e1;box-shadow:0 2px 8px rgba(15,23,42,.18);cursor:pointer}#mc5AuditorRange::-moz-range-thumb{width:23px;height:23px;border-radius:50%;background:#fff;border:1px solid #cbd5e1;box-shadow:0 2px 8px rgba(15,23,42,.18);cursor:pointer}#mc5AuditorMeta{text-align:center;font-size:8.5px;color:#64748b;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}#mc5AuditorGate{display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:7px;background:#eff6ff;border-left:4px solid #1689ff;color:#1e3a8a;font-size:10px;font-weight:650}#mc5AuditorGate.bad{background:#fff7ed;border-left-color:#ea580c;color:#9a3412}#mc5AuditorGate strong{font-size:11px}';doc.head.appendChild(s)}
  function install(root){
    if(!root||!root.document||root.__ATPL_MAM_AUDITOR_LEVEL_V1__)return;root.__ATPL_MAM_AUDITOR_LEVEL_V1__=1;var doc=root.document,state={level:stored(root),busy:false,last:null};
    function ensure(){var bar=doc.querySelector('#page-mamsalary .toolbar'),gen=doc.getElementById('mc5Generate');if(!bar||!gen)return false;css(doc);if(!doc.getElementById('mc5AuditorCard')){var card=doc.createElement('div');card.id='mc5AuditorCard';card.innerHTML='<div id="mc5AuditorTop"><span id="mc5AuditorLabel"></span><b>›</b></div><input id="mc5AuditorRange" type="range" min="1" max="5" step="1"><div id="mc5AuditorMeta"></div>';bar.insertBefore(card,gen);var r=doc.getElementById('mc5AuditorRange');r.value=String(state.level);r.addEventListener('input',function(){state.level=parseInt(r.value,10)||3;save(root,state.level);paint();gate(true)});r.addEventListener('change',function(){if(root.ATPLSharedActivityV2&&root.ATPLSharedActivityV2.log)root.ATPLSharedActivityV2.log('auditor_level','mamsalary','Auditor level changed to '+levelOf(state.level).label,{level:state.level,rank:levelOf(state.level).rank})})}if(!doc.getElementById('mc5AuditorGate')){var g=doc.createElement('div');g.id='mc5AuditorGate';var n=doc.getElementById('mc5Notice');if(n&&n.parentNode)n.parentNode.insertBefore(g,n.nextSibling)}paint();return true}
    function paint(){var L=levelOf(state.level),r=doc.getElementById('mc5AuditorRange'),lab=doc.getElementById('mc5AuditorLabel'),m=doc.getElementById('mc5AuditorMeta');if(!r)return;var pct=(L.value-1)/4*100;r.value=String(L.value);r.style.background='linear-gradient(90deg,#1689ff '+pct+'%,#e5e7eb '+pct+'%)';if(lab)lab.textContent=L.label;if(m)m.textContent='Audit Rank '+L.rank+'/10 · '+L.scope}
    function gate(show){if(state.busy)return;state.busy=true;try{if(!ensure())return;var data=readRows(doc),a=assessRows(state.level,data.rows,data.fields),f=doc.getElementById('mc5Final'),g=doc.getElementById('mc5AuditorGate'),L=levelOf(state.level),baseBlocked=data.rows.length===0||data.rows.some(function(x){return text(x.status).toUpperCase()==='BLOCKED'});if(f){f.disabled=baseBlocked||a.blockers>0;f.dataset.auditorLevel=L.key;f.dataset.auditorRank=String(L.rank);f.dataset.auditorBlockers=String(a.blockers);f.title=f.disabled?(a.blockers?a.blockers+' auditor-level checks pending':'Existing compliance blockers pending'):'Ready for '+L.label+' audit gate'}if(g){g.classList.toggle('bad',a.blockers>0);g.innerHTML='<strong>'+L.label+' · Rank '+L.rank+'/10</strong><span>'+(a.blockers?a.blockers+' stricter auditor check(s) pending. Draft allowed; Final blocked.':'Selected auditor level checks passed. Final still follows core compliance blockers.')+'</span>'}state.last=a;if(show&&a.blockers){var n=doc.getElementById('mc5Notice');if(n){n.textContent=L.label+' auditor gate: '+a.blockers+' item(s) resolve karein. Auditor level calculation amounts ko change nahi karta.';n.classList.add('bad')}}}finally{state.busy=false}}
    doc.addEventListener('click',function(e){var b=e.target&&e.target.closest?e.target.closest('#mc5Final'):null;if(!b)return;gate(false);if(state.last&&state.last.blockers>0){e.preventDefault();e.stopPropagation();if(e.stopImmediatePropagation)e.stopImmediatePropagation();var L=levelOf(state.level),n=doc.getElementById('mc5Notice');if(n){n.textContent='Final Excel blocked at '+L.label+' ('+L.rank+'/10): '+state.last.blockers+' auditor check(s) pending. Draft Excel available hai.';n.classList.add('bad')}}},true);
    function boot(){if(ensure()){gate(false);var table=doc.getElementById('mc5Table'),stats=doc.getElementById('mc5Stats');if(root.MutationObserver&&table){var mo=new MutationObserver(function(){setTimeout(function(){gate(false)},0)});mo.observe(table,{childList:true,subtree:true,characterData:true})}if(root.MutationObserver&&stats){var mo2=new MutationObserver(function(){setTimeout(function(){gate(false)},0)});mo2.observe(stats,{childList:true,subtree:true})}return}setTimeout(boot,120)}
    if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',boot,{once:true});else boot();return {getLevel:function(){return levelOf(state.level)},assess:function(){var d=readRows(doc);return assessRows(state.level,d.rows,d.fields)},refresh:function(){gate(false)}};
  }
  return {KEY:KEY,LEVELS:LEVELS,levelOf:levelOf,assessRows:assessRows,install:install};
});
