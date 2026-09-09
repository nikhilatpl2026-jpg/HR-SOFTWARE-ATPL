/* Employee Master enhancement layer — HR Workplace UI removed. */
(function(){
'use strict';

/* =========================================================
   1) SAFE EXCEL IMPORT MAPPING
   ========================================================= */
var CORE=['emp_id','name','father','dob','doj','pf_no','esi_no','bank_name','ifsc','account_no','gender','dept','desig','cat1','cat2','basic','hra','gross'];
var EXTRA=[
 {k:'aadhaar_no',l:'AADHAAR NO',t:'text'},
 {k:'phone_no',l:'PHONE NO',t:'tel'},
 {k:'qualification',l:'QUALIFICATION',t:'text'},
 {k:'present_address',l:'PRESENT ADDRESS',t:'textarea'},
 {k:'permanent_address',l:'PERMANENT ADDRESS',t:'textarea'},
 {k:'marital_status',l:'MARITAL STATUS',t:'select',o:['','SINGLE','MARRIED','DIVORCED','WIDOWED','SEPARATED']},
 {k:'nominee_name',l:'NOMINEE NAME',t:'text'},
 {k:'nominee_relation',l:'RELATION WITH NOMINEE',t:'text'},
 {k:'nominee_dob',l:'DOB OF NOMINEE',t:'date'}
];
var AL={
 emp_id:['emp code','employee code','employee id','emp id','employee no','employee number','code'],
 name:['name','employee name','emp name','worker name','staff name'],
 father:['father','father name','fathers name','father s name','fathername','guardian name'],
 dob:['dob','d o b','date of birth','birth date','birthdate'],
 doj:['doj','d o j','date of joining','joining date','join date','date joined'],
 pf_no:['pf no','pf number','pf account','pf account no','uan','uan no','uan number'],
 esi_no:['esi no','esi number','esic no','esic number','ip no','ip number','insurance no','insurance number'],
 bank_name:['bank','bank name','banker'],
 ifsc:['ifsc','ifsc code','ifsc number'],
 account_no:['account','account no','account number','bank account','bank account no','a c no','a c number'],
 gender:['gender','sex'],
 dept:['department','dept','department name'],
 desig:['designation','desig','post','job title'],
 cat1:['category','category 01','category 1','cat','cat 1','employee category'],
 cat2:['category 02','category 2','cat 2','sub category','subcategory'],
 basic:['basic','basic salary','basic wages','basic pay'],
 hra:['hra','house rent allowance','house rent','hra allowance'],
 gross:['gross','gross salary','gross wages','gross earning','gross pay'],
 aadhaar_no:['aadhaar','aadhaar no','aadhaar number','aadhar','aadhar no','uid'],
 phone_no:['phone','phone no','phone number','mobile','mobile no','mobile number','contact','contact no'],
 qualification:['qualification','education','educational qualification'],
 present_address:['present address','current address','residential address'],
 permanent_address:['permanent address','parmanent address','native address'],
 marital_status:['marital status','marital','marriage status'],
 nominee_name:['nominee','nominee name'],
 nominee_relation:['nominee relation','relation with nominee','relation nominee','relationship with nominee'],
 nominee_dob:['nominee dob','dob of nominee','nominee date of birth']
};
function norm(x){return String(x==null?'':x).toLowerCase().replace(/[\u00a0]/g,' ').replace(/[.\-_\/\\()&:#]+/g,' ').replace(/\s+/g,' ').trim()}
function dateOut(x){
 if(x==null||x==='')return '';
 if(x instanceof Date&&!isNaN(x.getTime()))return String(x.getDate()).padStart(2,'0')+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+x.getFullYear();
 var s=String(x).trim(),m=s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/);
 return m?m[1].padStart(2,'0')+'-'+m[2].padStart(2,'0')+'-'+(m[3].length===2?'20'+m[3]:m[3]):s;
}
function value(k,x){
 if(k==='dob'||k==='doj'||k==='nominee_dob')return dateOut(x);
 if(k==='basic'||k==='hra'||k==='gross'){var n=parseFloat(String(x||'').replace(/,/g,'').replace(/[₹$]/g,'').trim());return isFinite(n)?n:0}
 var s=String(x==null?'':x).trim();
 if(k==='gender'){var g=s.toUpperCase();return /FEMALE|WOMAN/.test(g)||g==='F'?'FEMALE':/MALE|MAN/.test(g)||g==='M'?'MALE':g}
 return s;
}
function mapHeaders(header){
 var m={};Object.keys(AL).forEach(function(k){m[k]=-1});
 (header||[]).forEach(function(c,i){var q=norm(c);Object.keys(AL).forEach(function(k){if(m[k]<0&&AL[k].some(function(a){return q===norm(a)}))m[k]=i})});
 return m;
}
function headerScore(row){var s=0;Object.keys(AL).forEach(function(k){if((row||[]).some(function(c){var q=norm(c);return AL[k].some(function(a){return q===norm(a)})}))s++});return s}
function fromMapped(row,m){
 var e={};CORE.forEach(function(k){e[k]=value(k,m[k]>=0?row[m[k]]:'')});
 EXTRA.forEach(function(x){e[x.k]=m[x.k]>=0?value(x.k,row[m[x.k]]):''});
 e.status='NEW JOINING';return e;
}
function from16(row){
 var p=['emp_id','name','father','dob','doj','pf_no','esi_no','bank_name','ifsc','account_no','gender','dept','cat1','basic','hra','gross'],e={};
 p.forEach(function(k,i){e[k]=value(k,row[i]===undefined?'':row[i])});
 e.desig='';e.cat2='';EXTRA.forEach(function(x){e[x.k]=''});e.status='NEW JOINING';return e;
}
window.emParseBulkPaste=function(){
 var area=document.getElementById('emBulkPasteArea');if(!area||!area.value.trim())return;
 var rs=area.value.replace(/\r/g,'').split('\n').filter(function(x){return x.trim()}).map(function(x){return x.split('\t')});
 var hasHeader=headerScore(rs[0]||[])>=2, emps;
 if(hasHeader){var m=mapHeaders(rs[0]);emps=rs.slice(1).map(function(r){return fromMapped(r,m)})}else emps=rs.map(from16);
 emps=emps.filter(function(e){return e.emp_id||e.name});window.EM_BULK_ROWS=emps;
 if(typeof renderBulkPreview==='function')renderBulkPreview();
 var b=document.getElementById('emBulkSaveBtn');if(b){b.disabled=!emps.length;b.style.opacity=emps.length?'1':'.4'}
 var i=document.getElementById('emPasteInfo');if(i)i.textContent='✅ '+emps.length+' employee rows detected. '+(hasHeader?'Excel headers auto-mapped exactly.':'Exact 16-column format mapped exactly.');
};
function saveMaster(){try{localStorage.setItem('AroraTextilesEmployeeMasterV3',JSON.stringify(EM.data))}catch(e){}}
function mergeEmployee(e){
 var code=String(e.emp_id||'').trim();if(!code)return;
 var idx=EM.data.findIndex(function(x){return String(x.emp_id||'').trim()===code});
 if(idx>=0)EM.data[idx]=Object.assign({},EM.data[idx],e);else EM.data.push(e);
}
window.emSaveBulk=function(){if(!window.EM_BULK_ROWS||!EM_BULK_ROWS.length)return;EM_BULK_ROWS.forEach(mergeEmployee);saveMaster();if(typeof emFilter==='function')emFilter();EM_BULK_ROWS=[];alert('✅ Employee data saved successfully.');if(typeof emCloseModal==='function')emCloseModal()};

/* =========================================================
   2) FILL MORE — TRUE VERTICAL FORM
   ========================================================= */
function esc(x){return String(x==null?'':x).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
function extraMarkup(e){
 e=e||{};
 var html='';
 EXTRA.forEach(function(x){
  var val=e[x.k]||'';
  html+='<div class="arora-extra-field">';
  html+='<div class="arora-extra-label">'+x.l+'</div>';
  if(x.t==='textarea') html+='<textarea id="arora_extra_'+x.k+'" rows="3" placeholder="Enter '+x.l.toLowerCase()+'">'+esc(val)+'</textarea>';
  else if(x.t==='select'){
   html+='<select id="arora_extra_'+x.k+'">';x.o.forEach(function(o){html+='<option value="'+esc(o)+'" '+(String(val)===String(o)?'selected':'')+'>'+esc(o||'Select '+x.l.toLowerCase())+'</option>'});html+='</select>';
  }else html+='<input id="arora_extra_'+x.k+'" type="'+x.t+'" value="'+esc(val)+'" placeholder="Enter '+x.l.toLowerCase()+'">';
  html+='</div>';
 });
 return html;
}
function injectStyles(){
 if(document.getElementById('aroraExtraStyles'))return;
 var s=document.createElement('style');s.id='aroraExtraStyles';s.textContent='\
#aroraFillMorePanel{margin-top:14px;border:1px solid #475569;border-radius:12px;background:#111827;padding:12px;color:#fff;}\
#aroraFillMoreHeader{display:flex;align-items:center;justify-content:space-between;gap:10px;}\
#aroraFillMoreHeader b{font-size:13px;}\
#aroraFillMoreBtn{border:1px solid #818cf8!important;background:#312e81!important;color:#fff!important;border-radius:8px!important;padding:8px 13px!important;font-weight:900!important;cursor:pointer!important;}\
#aroraFillMoreBody{display:none;margin-top:12px;}\
#aroraFillMoreBody.open{display:block;}\
.arora-extra-field{display:block;margin:0 0 11px 0;}\
.arora-extra-label{font-size:10px;font-weight:900;color:#cbd5e1;margin-bottom:5px;letter-spacing:.3px;}\
#aroraFillMoreBody input,#aroraFillMoreBody textarea,#aroraFillMoreBody select{box-sizing:border-box;width:100%;display:block;background:#0b1220!important;color:#fff!important;border:1px solid #64748b!important;border-radius:7px!important;padding:9px 10px!important;font-size:12px!important;outline:none;}\
#aroraFillMoreBody textarea{resize:vertical;min-height:70px;}\
#aroraStatusBox{margin-top:10px;padding:10px;border:1px solid #475569;border-radius:9px;background:#111827;}\
#aroraStatusBox label{display:block;font-size:10px;font-weight:900;color:#cbd5e1;margin-bottom:5px;}\
#aroraStatusBox select{width:100%;box-sizing:border-box;background:#0b1220;color:#fff;border:1px solid #64748b;border-radius:7px;padding:9px;font-weight:800;}\
';document.head.appendChild(s);
}
function findModalHost(){return document.getElementById('emModalFields')||document.getElementById('emSingleRow')||document.querySelector('#emModal .modal-body')||document.querySelector('#emModal form')}
function currentEmployee(){try{if(typeof EM!=='undefined'&&EM.editIdx>=0&&EM.data[EM.editIdx])return EM.data[EM.editIdx]}catch(e){}return {status:'NEW JOINING'} }
function injectFillMore(){
 injectStyles();
 var modal=document.getElementById('emModal');if(!modal||getComputedStyle(modal).display==='none')return;
 var host=findModalHost();if(!host)return;
 var panel=document.getElementById('aroraFillMorePanel');
 if(!panel){
  panel=document.createElement('div');panel.id='aroraFillMorePanel';panel.innerHTML='<div id="aroraFillMoreHeader"><div><b>＋ Fill More</b><div style="font-size:9px;color:#94a3b8;margin-top:3px">Additional employee details — vertical form</div></div><button type="button" id="aroraFillMoreBtn">＋ Fill More</button></div><div id="aroraFillMoreBody">'+extraMarkup(currentEmployee())+'</div><div id="aroraStatusBox"><label>EMPLOYEE STATUS</label><select id="aroraStatusSelect"><option value="ACTIVE">ACTIVE</option><option value="INACTIVE">INACTIVE</option><option value="NEW JOINING">NEW JOINING</option></select></div>';
  host.parentNode.appendChild(panel);
  document.getElementById('aroraFillMoreBtn').onclick=function(){var b=document.getElementById('aroraFillMoreBody'),open=!b.classList.contains('open');b.classList.toggle('open',open);this.textContent=open?'− Hide More':'＋ Fill More';};
 }
 var emp=currentEmployee(),st=document.getElementById('aroraStatusSelect');if(st)st.value=emp.status||'NEW JOINING';
}
function readExtra(){
 var out={};EXTRA.forEach(function(x){var el=document.getElementById('arora_extra_'+x.k);out[x.k]=el?String(el.value||'').trim():''});var st=document.getElementById('aroraStatusSelect');out.status=st?st.value:'ACTIVE';return out;
}
function saveExtraToEmployee(){
 try{
  var idx=typeof EM!=='undefined'?EM.editIdx:-1;if(idx>=0&&EM.data[idx]){Object.assign(EM.data[idx],readExtra());saveMaster();return}
  var codeEl=document.getElementById('emf_emp_id'),code=codeEl?String(codeEl.value||'').trim():'';if(code&&typeof EM!=='undefined'){var j=EM.data.findIndex(function(e){return String(e.emp_id||'').trim()===code});if(j>=0){Object.assign(EM.data[j],readExtra());saveMaster()}}
 }catch(e){}
}
/* Capture the modal even if the original app redraws it. */
var lastOpenState=false;
function monitor(){
 var modal=document.getElementById('emModal');
 if(modal){var visible=getComputedStyle(modal).display!=='none';if(visible){injectFillMore();lastOpenState=true}else if(lastOpenState){lastOpenState=false}}
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',function(){injectStyles();setInterval(monitor,300)});else{injectStyles();setInterval(monitor,300)}
/* Save extra fields whenever the app's Save button/form is used. */
document.addEventListener('click',function(ev){
 var t=ev.target;if(!t)return;
 var txt=(t.textContent||'').trim().toLowerCase();
 if((txt==='save'||txt==='💾 save'||txt.indexOf('save employee')>=0)&&document.getElementById('emModal')){setTimeout(saveExtraToEmployee,80)}
});
})();
