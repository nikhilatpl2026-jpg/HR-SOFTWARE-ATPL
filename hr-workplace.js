/* Employee Master enhancement layer — HR Workplace UI removed. */
(function(){
'use strict';

/* =========================================================
   EMPLOYEE MASTER — EXTRA DETAILS + STATUS + EXCEL MAPPING
   ========================================================= */
var EXTRA=[
 {k:'aadhaar_no',l:'AADHAAR NO',t:'text',ph:'Enter Aadhaar No.'},
 {k:'phone_no',l:'PHONE NO',t:'tel',ph:'Enter Phone No.'},
 {k:'qualification',l:'QUALIFICATION',t:'text',ph:'Enter Qualification'},
 {k:'present_address',l:'PRESENT ADDRESS',t:'textarea',ph:'Enter Present Address'},
 {k:'permanent_address',l:'PERMANENT ADDRESS',t:'textarea',ph:'Enter Permanent Address'},
 {k:'marital_status',l:'MARITAL STATUS',t:'select',o:['','SINGLE','MARRIED','DIVORCED','WIDOWED','SEPARATED']},
 {k:'nominee_name',l:'NOMINEE NAME',t:'text',ph:'Enter Nominee Name'},
 {k:'nominee_relation',l:'RELATION WITH NOMINEE',t:'text',ph:'e.g. Wife / Father / Mother / Son'},
 {k:'nominee_dob',l:'DOB OF NOMINEE',t:'date'}
];
var CORE=['emp_id','name','father','dob','doj','pf_no','esi_no','bank_name','ifsc','account_no','gender','dept','desig','cat1','cat2','basic','hra','gross'];
var AL={
 emp_id:['emp code','employee code','employee id','emp id','employee no','employee number','code'],name:['name','employee name','emp name','worker name','staff name'],father:['father','father name','fathers name','father s name','fathername','guardian name'],dob:['dob','d o b','date of birth','birth date','birthdate'],doj:['doj','d o j','date of joining','joining date','join date','date joined'],pf_no:['pf no','pf number','pf account','pf account no','uan','uan no','uan number'],esi_no:['esi no','esi number','esic no','esic number','ip no','ip number','insurance no','insurance number'],bank_name:['bank','bank name','banker'],ifsc:['ifsc','ifsc code','ifsc number'],account_no:['account','account no','account number','bank account','bank account no','a c no','a c number'],gender:['gender','sex'],dept:['department','dept','department name'],desig:['designation','desig','post','job title'],cat1:['category','category 01','category 1','cat','cat 1','employee category'],cat2:['category 02','category 2','cat 2','sub category','subcategory'],basic:['basic','basic salary','basic wages','basic pay'],hra:['hra','house rent allowance','house rent','hra allowance'],gross:['gross','gross salary','gross wages','gross earning','gross pay'],
 aadhaar_no:['aadhaar','aadhaar no','aadhaar number','aadhar','aadhar no','uid'],phone_no:['phone','phone no','phone number','mobile','mobile no','mobile number','contact','contact no'],qualification:['qualification','education','educational qualification'],present_address:['present address','current address','residential address'],permanent_address:['permanent address','parmanent address','native address'],marital_status:['marital status','marital','marriage status'],nominee_name:['nominee','nominee name'],nominee_relation:['nominee relation','relation with nominee','relation nominee','relationship with nominee'],nominee_dob:['nominee dob','dob of nominee','nominee date of birth']
};
function norm(x){return String(x==null?'':x).toLowerCase().replace(/[\u00a0]/g,' ').replace(/[.\-_\/\\()&:#]+/g,' ').replace(/\s+/g,' ').trim()}
function dateOut(x){if(x==null||x==='')return '';if(x instanceof Date&&!isNaN(x.getTime()))return String(x.getDate()).padStart(2,'0')+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+x.getFullYear();var s=String(x).trim(),m=s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/);return m?m[1].padStart(2,'0')+'-'+m[2].padStart(2,'0')+'-'+(m[3].length===2?'20'+m[3]:m[3]):s}
function value(k,x){if(k==='dob'||k==='doj'||k==='nominee_dob')return dateOut(x);if(k==='basic'||k==='hra'||k==='gross'){var q=parseFloat(String(x||'').replace(/,/g,'').replace(/[₹$]/g,'').trim());return isFinite(q)?q:0}var s=String(x==null?'':x).trim();if(k==='gender'){var g=s.toUpperCase();return /FEMALE|WOMAN/.test(g)||g==='F'?'FEMALE':/MALE|MAN/.test(g)||g==='M'?'MALE':g}return s}
function mapHeaders(h){var m={};Object.keys(AL).forEach(function(k){m[k]=-1});(h||[]).forEach(function(c,i){var q=norm(c);Object.keys(AL).forEach(function(k){if(m[k]<0&&AL[k].some(function(a){return q===norm(a)}))m[k]=i})});return m}
function headerScore(r){var s=0;Object.keys(AL).forEach(function(k){if((r||[]).some(function(c){var q=norm(c);return AL[k].some(function(a){return q===norm(a)})}))s++});return s}
function fromMapped(row,m){var e={};CORE.forEach(function(k){e[k]=value(k,m[k]>=0?row[m[k]]:'')});EXTRA.forEach(function(x){e[x.k]=m[x.k]>=0?value(x.k,row[m[x.k]]):''});e.status='NEW JOINING';return e}
function from16(row){var p=['emp_id','name','father','dob','doj','pf_no','esi_no','bank_name','ifsc','account_no','gender','dept','cat1','basic','hra','gross'],e={};p.forEach(function(k,i){e[k]=value(k,row[i]===undefined?'':row[i])});e.desig='';e.cat2='';EXTRA.forEach(function(x){e[x.k]=''});e.status='NEW JOINING';return e}
window.emParseBulkPaste=function(){var a=document.getElementById('emBulkPasteArea');if(!a||!a.value.trim())return;var rs=a.value.replace(/\r/g,'').split('\n').filter(function(x){return x.trim()}).map(function(x){return x.split('\t')});var h=headerScore(rs[0]||[])>=2,emps=h?rs.slice(1).map(function(r){return fromMapped(r,mapHeaders(rs[0]))}):rs.map(from16);emps=emps.filter(function(e){return e.emp_id||e.name});window.EM_BULK_ROWS=emps;if(typeof renderBulkPreview==='function')renderBulkPreview();var b=document.getElementById('emBulkSaveBtn');if(b){b.disabled=!emps.length;b.style.opacity=emps.length?'1':'.4}var i=document.getElementById('emPasteInfo');if(i)i.textContent='✅ '+emps.length+' employee rows detected. '+(h?'Excel headers auto-mapped exactly.':'Exact 16-column format mapped exactly.');addRemapButton()};
function saveMaster(){try{localStorage.setItem('AroraTextilesEmployeeMasterV3',JSON.stringify(EM.data))}catch(e){}}
function mergeEmployee(e){var code=String(e.emp_id||'').trim();if(!code)return;var i=EM.data.findIndex(function(x){return String(x.emp_id||'').trim()===code});if(i>=0)EM.data[i]=Object.assign({},EM.data[i],e);else EM.data.push(e)}
window.emSaveBulk=function(){if(!window.EM_BULK_ROWS||!EM_BULK_ROWS.length)return;EM_BULK_ROWS.forEach(mergeEmployee);saveMaster();if(typeof emFilter==='function')emFilter();EM_BULK_ROWS=[];alert('✅ Employee data saved successfully.');if(typeof emCloseModal==='function')emCloseModal()};

/* =========================================================
   TRUE FILL-MORE MODAL — LIKE HR DOCUMENT FORM
   ========================================================= */
function esc(x){return String(x==null?'':x).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
function styles(){if(document.getElementById('aroraEmployeeExtraCSS'))return;var s=document.createElement('style');s.id='aroraEmployeeExtraCSS';s.textContent='\
#aroraFillMoreTrigger{display:inline-flex!important;align-items:center!important;gap:6px!important;margin-left:10px!important;padding:7px 12px!important;border:1px solid #818cf8!important;border-radius:8px!important;background:#312e81!important;color:#fff!important;font-size:11px!important;font-weight:900!important;cursor:pointer!important;}\
#aroraEmpStatusStrip{display:flex;align-items:center;gap:8px;margin:8px 0 10px;padding:8px 10px;border:1px solid #334155;border-radius:9px;background:#0b1220;color:#fff;}\
#aroraEmpStatusStrip label{font-size:10px;font-weight:900;color:#cbd5e1;}\
#aroraEmpStatusStrip select{background:#111827;color:#fff;border:1px solid #64748b;border-radius:7px;padding:6px 9px;font-size:11px;font-weight:800;outline:none;}\
#aroraExtraOverlay{position:fixed;inset:0;z-index:100000;display:none;align-items:center;justify-content:center;background:rgba(15,23,42,.72);padding:18px;}\
#aroraExtraCard{width:min(720px,96vw);max-height:92vh;overflow:auto;background:#fff;color:#0f172a;border-radius:16px;box-shadow:0 30px 90px rgba(0,0,0,.5);border:1px solid #cbd5e1;}\
#aroraExtraHead{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;background:linear-gradient(90deg,#0284c7,#0ea5e9);color:#fff;}\
#aroraExtraHead b{font-size:16px;}\
#aroraExtraClose{width:30px;height:30px;border:0;border-radius:50%;background:rgba(255,255,255,.18);color:#fff;font-size:18px;cursor:pointer;}\
#aroraExtraSub{font-size:10px;opacity:.85;margin-top:3px;}\
#aroraExtraBody{padding:18px 20px;}\
.arora-extra-field{margin-bottom:13px;}\
.arora-extra-field label{display:block;font-size:10px;font-weight:900;color:#475569;letter-spacing:.3px;margin-bottom:5px;text-transform:uppercase;}\
.arora-extra-field input,.arora-extra-field textarea,.arora-extra-field select{display:block;width:100%;box-sizing:border-box;border:1px solid #cbd5e1;border-radius:8px;background:#fff;color:#0f172a;padding:10px 11px;font-size:12px;outline:none;}\
.arora-extra-field input:focus,.arora-extra-field textarea:focus,.arora-extra-field select:focus{border-color:#0284c7;box-shadow:0 0 0 3px rgba(14,165,233,.12);}\
.arora-extra-field textarea{min-height:74px;resize:vertical;}\
#aroraExtraStatus{padding:12px;border:1px solid #cbd5e1;border-radius:9px;background:#f8fafc;margin-top:4px;}\
#aroraExtraStatus label{display:block;font-size:10px;font-weight:900;color:#475569;margin-bottom:5px;}\
#aroraExtraStatus select{width:100%;box-sizing:border-box;border:1px solid #cbd5e1;border-radius:8px;padding:10px;background:#fff;font-weight:800;}\
#aroraExtraFoot{display:flex;justify-content:flex-end;gap:8px;padding:13px 20px;border-top:1px solid #e2e8f0;background:#f8fafc;}\
#aroraExtraFoot button{border:1px solid #cbd5e1;border-radius:8px;padding:9px 15px;font-weight:800;cursor:pointer;}\
#aroraExtraSave{background:#0284c7!important;color:#fff!important;border-color:#0284c7!important;}\
';document.head.appendChild(s)}
function current(){try{if(typeof EM!=='undefined'&&EM.editIdx>=0&&EM.data[EM.editIdx])return EM.data[EM.editIdx]}catch(e){}return {status:'NEW JOINING'}}
function buildOverlay(){if(document.getElementById('aroraExtraOverlay'))return;var o=document.createElement('div');o.id='aroraExtraOverlay';o.innerHTML='<div id="aroraExtraCard"><div id="aroraExtraHead"><div><b>👤 Additional Employee Details</b><div id="aroraExtraSub">Employee personal, address & nominee information</div></div><button type="button" id="aroraExtraClose">×</button></div><div id="aroraExtraBody"></div><div id="aroraExtraFoot"><button type="button" id="aroraExtraCancel">Cancel</button><button type="button" id="aroraExtraSave">💾 Save Details</button></div></div>';document.body.appendChild(o);document.getElementById('aroraExtraClose').onclick=closeExtra;document.getElementById('aroraExtraCancel').onclick=closeExtra;document.getElementById('aroraExtraSave').onclick=saveExtraDraft;o.addEventListener('click',function(e){if(e.target===o)closeExtra()})}
function openExtra(){styles();buildOverlay();var e=current(),body=document.getElementById('aroraExtraBody'),html='';EXTRA.forEach(function(x){var val=e[x.k]||'';html+='<div class="arora-extra-field"><label>'+x.l+'</label>';if(x.t==='textarea')html+='<textarea id="arora_extra_'+x.k+'" placeholder="'+esc(x.ph||'')+'">'+esc(val)+'</textarea>';else if(x.t==='select'){html+='<select id="arora_extra_'+x.k+'">';x.o.forEach(function(q){html+='<option value="'+esc(q)+'" '+(String(q)===String(val)?'selected':'')+'>'+esc(q||'Select marital status')+'</option>'});html+='</select>'}else html+='<input id="arora_extra_'+x.k+'" type="'+x.t+'" value="'+esc(val)+'" placeholder="'+esc(x.ph||'')+'">';html+='</div>'});html+='<div id="aroraExtraStatus"><label>EMPLOYEE STATUS</label><select id="aroraExtraStatusSelect"><option value="ACTIVE">ACTIVE</option><option value="INACTIVE">INACTIVE</option><option value="NEW JOINING">NEW JOINING</option></select></div>';body.innerHTML=html;document.getElementById('aroraExtraStatusSelect').value=e.status||'NEW JOINING';document.getElementById('aroraExtraOverlay').style.display='flex'}
function closeExtra(){var o=document.getElementById('aroraExtraOverlay');if(o)o.style.display='none'}
function draft(){var out={};EXTRA.forEach(function(x){var el=document.getElementById('arora_extra_'+x.k);out[x.k]=el?String(el.value||'').trim():''});var st=document.getElementById('aroraExtraStatusSelect');out.status=st?st.value:'ACTIVE';return out}
function saveExtraDraft(){var d=draft(),code='';try{var ce=document.getElementById('emf_emp_id');if(ce)code=String(ce.value||'').trim()}catch(e){}window.__aroraExtraDraft={code:code,data:d};try{localStorage.setItem('AroraTextsEmployeeExtraDraft',JSON.stringify(window.__aroraExtraDraft))}catch(e){};closeExtra();alert('✅ Additional employee details saved. Main Save karte hi employee record ke saath attach ho jayenge.')}
function applyDraft(){try{var dr=window.__aroraExtraDraft;var raw=localStorage.getItem('AroraTextsEmployeeExtraDraft');if(!dr&&raw)dr=JSON.parse(raw);if(!dr)return;var idx=-1,code=String(dr.code||'').trim();if(typeof EM!=='undefined'){if(EM.editIdx>=0)idx=EM.editIdx;if(idx<0&&code)idx=EM.data.findIndex(function(e){return String(e.emp_id||'').trim()===code});if(idx>=0&&EM.data[idx]){Object.assign(EM.data[idx],dr.data);saveMaster();window.__aroraExtraDraft=null;localStorage.removeItem('AroraTextsEmployeeExtraDraft');if(typeof emFilter==='function')emFilter()}}}catch(e){}}
function statusStrip(){var modal=document.getElementById('emModal'),single=document.getElementById('emSingleRow');if(!modal||getComputedStyle(modal).display==='none'||!single)return;styles();var old=document.getElementById('aroraEmpStatusStrip');if(old)old.remove();var st=document.createElement('div');st.id='aroraEmpStatusStrip';var e=current();st.innerHTML='<label>EMPLOYEE STATUS</label><select id="aroraMainStatus"><option>ACTIVE</option><option>INACTIVE</option><option>NEW JOINING</option></select>';single.parentNode.insertBefore(st,single);document.getElementById('aroraMainStatus').value=e.status||'NEW JOINING'}
function trigger(){var modal=document.getElementById('emModal');if(!modal||getComputedStyle(modal).display==='none')return;styles();buildOverlay();var title=document.getElementById('emModalTitle');if(title){var b=document.getElementById('aroraFillMoreTrigger');if(b)b.remove();b=document.createElement('button');b.id='aroraFillMoreTrigger';b.type='button';b.textContent='＋ Fill More';b.onclick=openExtra;title.parentNode.appendChild(b)}statusStrip()}
function wrapSave(){if(typeof window.emSaveModal!=='function'||window.__aroraSaveWrapped)return;var original=window.emSaveModal;window.emSaveModal=function(){var st=document.getElementById('aroraMainStatus'),d=window.__aroraExtraDraft;if(d&&st)d.data.status=st.value;original.apply(this,arguments);setTimeout(applyDraft,120);};window.__aroraSaveWrapped=true}
function monitor(){try{trigger();wrapSave()}catch(e){}}
function boot(){styles();buildOverlay();setInterval(monitor,250);monitor()}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
