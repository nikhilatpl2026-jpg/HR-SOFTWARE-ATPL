/* Employee Master extension — event-driven, no polling/observer. */
(function(){
'use strict';

var EXTRA=[
 ['aadhaar_no','Aadhaar Number','text'],
 ['phone_no','Phone Number','tel'],
 ['qualification','Qualification','text'],
 ['present_address','Present Address','textarea'],
 ['permanent_address','Permanent Address','textarea'],
 ['marital_status','Marital Status','select'],
 ['nominee_name','Nominee Name','text'],
 ['nominee_relation','Relationship with Nominee','text'],
 ['nominee_dob','Nominee DOB','date']
];
var CORE=['emp_id','name','father','dob','doj','pf_no','esi_no','bank_name','ifsc','account_no','gender','dept','cat1','basic','hra','gross'];
var ORDER=CORE.concat(EXTRA.map(function(x){return x[0];}));
var EXPECTED='Expected columns: Code | Name | Father | DOB | DOJ | PF No | ESI No | Bank | IFSC | Account | Gender | Dept | Category | Basic | HRA | Gross | Aadhaar Number | Phone Number | Qualification | Present Address | Permanent Address | Marital Status | Nominee Name | Relationship with Nominee | Nominee DOB';

var ALIASES={
 emp_id:['code','emp code','employee code','employee id','emp id'],
 name:['name','employee name','emp name'],
 father:['father','father name','fathers name','father s name'],
 dob:['dob','d o b','date of birth'],
 doj:['doj','d o j','date of joining','joining date'],
 pf_no:['pf no','pf number','uan','uan no'],
 esi_no:['esi no','esi number','esic no','ip no'],
 bank_name:['bank','bank name'],
 ifsc:['ifsc','ifsc code'],
 account_no:['account','account no','account number','a c no'],
 gender:['gender','sex'],
 dept:['dept','department'],
 cat1:['category','category 1','category 01','cat'],
 basic:['basic','basic salary','basic wages'],
 hra:['hra','house rent allowance'],
 gross:['gross','gross salary','gross wages'],
 aadhaar_no:['aadhaar','aadhaar no','aadhaar number','aadhar','aadhar no'],
 phone_no:['phone','phone no','phone number','mobile','mobile no','mobile number'],
 qualification:['qualification','education','educational qualification'],
 present_address:['present address','current address'],
 permanent_address:['permanent address','parmanent address'],
 marital_status:['marital status','marital'],
 nominee_name:['nominee','nominee name'],
 nominee_relation:['relationship with nominee','relation with nominee','nominee relation'],
 nominee_dob:['nominee dob','dob of nominee','nominee date of birth']
};

function norm(v){return String(v==null?'':v).toLowerCase().replace(/[.\-_\/\\()&:#]+/g,' ').replace(/\s+/g,' ').trim();}
function esc(v){return String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function val(k,v){
 var s=String(v==null?'':v).trim();
 if(k==='basic'||k==='hra'||k==='gross'){
  var n=parseFloat(s.replace(/,/g,''));
  return isFinite(n)?n:0;
 }
 return s;
}
function saveMaster(){
 try{if(typeof EM!=='undefined'&&EM.data)localStorage.setItem('AroraTextilesEmployeeMasterV3',JSON.stringify(EM.data));}catch(e){}
}

function patchExpected(){
 var bulk=document.getElementById('emTabPanel-bulk');
 if(!bulk)return;
 var spans=bulk.querySelectorAll('span');
 for(var i=0;i<spans.length;i++){
  var t=(spans[i].textContent||'').replace(/\s+/g,' ').trim();
  if(t.indexOf('Expected columns:')===0){
   spans[i].textContent=EXPECTED;
   spans[i].style.whiteSpace='normal';
   spans[i].style.lineHeight='1.7';
   return;
  }
 }
}

function mapHeader(h){
 var m={};
 Object.keys(ALIASES).forEach(function(k){m[k]=-1;});
 h.forEach(function(c,i){
  var z=norm(c);
  Object.keys(ALIASES).forEach(function(k){
   if(m[k]<0&&ALIASES[k].some(function(a){return z===norm(a);})){m[k]=i;}
  });
 });
 return m;
}
function headerScore(r){
 var s=0;
 (r||[]).forEach(function(c){
  var z=norm(c);
  if(Object.keys(ALIASES).some(function(k){return ALIASES[k].some(function(a){return z===norm(a);});}))s++;
 });
 return s;
}

function installPaste(){
 if(window.__atplExtraPasteInstalled||typeof window.emParseBulkPaste!=='function')return;
 var original=window.emParseBulkPaste;
 window.emParseBulkPaste=function(){
  var a=document.getElementById('emBulkPasteArea');
  var raw=a?String(a.value||'').trim():'';
  if(!raw)return original.apply(this,arguments);

  var rows=raw.replace(/\r/g,'').split('\n').filter(function(x){return x.trim();}).map(function(x){return x.split('\t');});
  if(!rows.length)return original.apply(this,arguments);

  var hasHeader=headerScore(rows[0])>=2;
  var hasExtra=hasHeader
   ? /(aadhaar|aadhar|phone|mobile|qualification|present address|permanent address|marital|nominee)/i.test(rows[0].join(' '))
   : rows.some(function(r){return r.length>16;});
  if(!hasExtra)return original.apply(this,arguments);

  var m=hasHeader?mapHeader(rows[0]):null;
  var data=hasHeader?rows.slice(1):rows;
  var out=[];
  data.forEach(function(r){
   if(!r.some(function(x){return String(x||'').trim();}))return;
   var e={};
   if(hasHeader){
    Object.keys(ALIASES).forEach(function(k){e[k]=val(k,m[k]>=0?r[m[k]]:'');});
   }else{
    ORDER.forEach(function(k,i){e[k]=val(k,r[i]===undefined?'':r[i]);});
   }
   if(e.desig===undefined)e.desig='';
   if(e.cat2===undefined)e.cat2='';
   if(e.emp_id||e.name)out.push(e);
  });

  window.EM_BULK_ROWS=out;
  if(typeof renderBulkPreview==='function')renderBulkPreview();
  var b=document.getElementById('emBulkSaveBtn');
  if(b){b.disabled=!out.length;b.style.opacity=out.length?'1':'.4';}
  var bar=document.getElementById('emPasteBar'),info=document.getElementById('emPasteInfo');
  if(bar)bar.style.display='flex';
  if(info)info.textContent='✅ '+out.length+' employee rows detected. Additional fields supported.';
 };
 window.__atplExtraPasteInstalled=true;
}

function injectCss(){
 if(document.getElementById('atplExtraCss'))return;
 var s=document.createElement('style');
 s.id='atplExtraCss';
 s.textContent=[
 '#atplMoreWrap{display:block;min-width:100%;padding:12px 16px;background:#0f172a;border-top:1px solid #334155}',
 '#atplMoreBtn{padding:8px 14px;border:1px solid #6366f1;border-radius:8px;background:#312e81;color:#fff;font-size:11px;font-weight:800;cursor:pointer}',
 '#atplMoreBody{display:none;margin-top:12px;padding:14px;border:1px solid #334155;border-radius:10px;background:#111827}',
 '#atplMoreBody.open{display:block}',
 '.atplF{margin-bottom:11px}',
 '.atplF label{display:block;margin-bottom:5px;font-size:9px;font-weight:800;color:#94a3b8;text-transform:uppercase}',
 '.atplF input,.atplF textarea,.atplF select{width:100%;box-sizing:border-box;padding:9px 10px;border:1px solid #475569;border-radius:7px;background:#0b1220;color:#fff;font-size:12px}',
 '.atplF textarea{min-height:72px;resize:vertical}',
 '#atplView{position:fixed;inset:0;z-index:100005;display:none;align-items:center;justify-content:center;background:rgba(2,6,23,.82);padding:18px}',
 '#atplViewCard{width:min(760px,96vw);max-height:92vh;display:flex;flex-direction:column;background:#fff;border-radius:15px;overflow:hidden}',
 '#atplViewHead{padding:15px 18px;background:linear-gradient(135deg,#075985,#0ea5e9);color:#fff;display:flex;align-items:center}',
 '#atplViewClose{margin-left:auto;border:0;border-radius:50%;width:31px;height:31px;background:rgba(255,255,255,.18);color:#fff;font-size:18px;cursor:pointer}',
 '#atplViewBody{overflow:auto;padding:16px 18px;background:#f8fafc}',
 '.atplV{margin-bottom:10px}',
 '.atplV label{display:block;margin-bottom:4px;font-size:9px;font-weight:900;color:#64748b;text-transform:uppercase}',
 '.atplVal{padding:9px 11px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;color:#0f172a;font-size:12px;white-space:pre-wrap}'
 ].join('');
 document.head.appendChild(s);
}

function current(){
 try{return EM.editIdx>=0&&EM.data[EM.editIdx]?EM.data[EM.editIdx]:{};}catch(e){return {};}
}
function removeMore(){var old=document.getElementById('atplMoreWrap');if(old)old.remove();}
function buildMore(){
 removeMore();
 var panel=document.getElementById('emTabPanel-single'),row=document.getElementById('emSingleRow');
 if(!panel||!row)return;
 var e=current(),w=document.createElement('div');
 w.id='atplMoreWrap';
 var h='<button type="button" id="atplMoreBtn">＋ View More / Fill More</button><div id="atplMoreBody">';
 EXTRA.forEach(function(x){
  var v=e[x[0]]||'';
  h+='<div class="atplF"><label>'+x[1]+'</label>';
  if(x[2]==='textarea')h+='<textarea id="atpl_'+x[0]+'">'+esc(v)+'</textarea>';
  else if(x[2]==='select')h+='<select id="atpl_'+x[0]+'"><option value="">Select Marital Status</option><option>SINGLE</option><option>MARRIED</option><option>DIVORCED</option><option>WIDOWED</option><option>SEPARATED</option></select>';
  else h+='<input id="atpl_'+x[0]+'" type="'+x[2]+'" value="'+esc(v)+'">';
  h+='</div>';
 });
 h+='</div>';
 w.innerHTML=h;
 row.parentNode.insertBefore(w,row.nextSibling);
 EXTRA.forEach(function(x){var z=document.getElementById('atpl_'+x[0]);if(z)z.value=e[x[0]]||'';});
 var b=document.getElementById('atplMoreBtn'),body=document.getElementById('atplMoreBody');
 b.onclick=function(){var open=!body.classList.contains('open');body.classList.toggle('open',open);b.textContent=open?'− View Less':'＋ View More / Fill More';};
}
function readExtra(){
 var d={};
 EXTRA.forEach(function(x){var z=document.getElementById('atpl_'+x[0]);d[x[0]]=z?String(z.value||'').trim():'';});
 return d;
}
function formCode(){
 var r=document.getElementById('emSingleRow');
 var z=r&&r.querySelector('input,select');
 return z?String(z.value||'').trim():'';
}
function installSave(){
 if(window.__atplSaveInstalled||typeof window.emSaveModal!=='function')return;
 var original=window.emSaveModal;
 window.emSaveModal=function(){
  var code=formCode();
  var idx=(typeof EM!=='undefined'&&typeof EM.editIdx==='number')?EM.editIdx:-1;
  var extra=document.getElementById('atplMoreWrap')?readExtra():{};
  var result=original.apply(this,arguments);
  try{
   var target=idx>=0?idx:EM.data.findIndex(function(e){return String(e.emp_id||'').trim()===code;});
   if(target>=0&&EM.data[target]){
    Object.assign(EM.data[target],extra);
    saveMaster();
   }
  }catch(e){}
  return result;
 };
 window.__atplSaveInstalled=true;
}

function installOpenHooks(){
 if(!window.__atplOpenAddInstalled&&typeof window.emOpenAdd==='function'){
  var add=window.emOpenAdd;
  window.emOpenAdd=function(){removeMore();var r=add.apply(this,arguments);buildMore();return r;};
  window.__atplOpenAddInstalled=true;
 }
 if(!window.__atplOpenEditInstalled&&typeof window.emOpenEdit==='function'){
  var edit=window.emOpenEdit;
  window.emOpenEdit=function(){removeMore();var r=edit.apply(this,arguments);buildMore();return r;};
  window.__atplOpenEditInstalled=true;
 }
}

function buildView(){
 if(document.getElementById('atplView'))return;
 var o=document.createElement('div');
 o.id='atplView';
 o.innerHTML='<div id="atplViewCard"><div id="atplViewHead"><div><strong>👤 Employee Complete Details</strong><div id="atplViewSub" style="font-size:10px;opacity:.85;margin-top:2px"></div></div><button id="atplViewClose">×</button></div><div id="atplViewBody"></div></div>';
 document.body.appendChild(o);
 document.getElementById('atplViewClose').onclick=function(){o.style.display='none';};
 o.onclick=function(e){if(e.target===o)o.style.display='none';};
}
function installView(){
 if(window.__atplViewInstalled||typeof window.emViewEmp!=='function')return;
 window.emViewEmp=function(i){
  try{
   var e=EM.data[i];if(!e)return;
   buildView();
   document.getElementById('atplViewSub').textContent=(e.name||'Employee')+' • Code: '+(e.emp_id||'—');
   var labels={emp_id:'Employee Code',name:'Employee Name',father:"Father's Name",dob:'D.O.B',doj:'D.O.J',pf_no:'PF No.',esi_no:'ESI No.',bank_name:'Bank Name',ifsc:'IFSC Code',account_no:'Account No.',gender:'Gender',dept:'Department',desig:'Designation',cat1:'Category 01',cat2:'Category 02',basic:'Basic',hra:'HRA',gross:'Gross'};
   EXTRA.forEach(function(x){labels[x[0]]=x[1];});
   var keys=['emp_id','name','father','dob','doj','pf_no','esi_no','bank_name','ifsc','account_no','gender','dept','desig','cat1','cat2','basic','hra','gross'].concat(EXTRA.map(function(x){return x[0];}));
   var h='';
   keys.forEach(function(k){var v=e[k];if(v===undefined||v===null||v==='')v='—';h+='<div class="atplV"><label>'+esc(labels[k]||k)+'</label><div class="atplVal">'+esc(v)+'</div></div>';});
   document.getElementById('atplViewBody').innerHTML=h;
   document.getElementById('atplView').style.display='flex';
  }catch(err){}
 };
 window.__atplViewInstalled=true;
}

function init(){
 injectCss();
 patchExpected();
 installPaste();
 installSave();
 installOpenHooks();
 installView();
 buildView();
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});
else init();
})();
