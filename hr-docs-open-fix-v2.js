/* Arora ERP — HR Documents Open/Preview Fix V2
   Isolated fix: uses public HR Docs API, not private DOCS scope. */
(function(){
'use strict';
if(window.__ATPL_HRDOC_OPEN_FIX_V2__) return;
window.__ATPL_HRDOC_OPEN_FIX_V2__=1;

var USERS='ATPL_UserAccess_V1', SESS='ATPL_UserSession_V5';
function json(s,d){try{return JSON.parse(s)}catch(_){return d}}
function currentUser(){
  var sess=json(sessionStorage.getItem(SESS)||'null',null);
  if(!sess||!sess.id)return null;
  var us=json(localStorage.getItem(USERS)||'[]',[]);
  var id=String(sess.id).toLowerCase();
  return (Array.isArray(us)?us:[]).find(function(u){return String(u&&u.id||'').toLowerCase()===id})||{id:sess.id,name:sess.id,admin:false};
}
function canView(d){
  var u=currentUser();
  if(!u)return false;
  if(u.admin===true)return true;
  var assigned=String(d&&d.assigned_user_id||'').trim().toLowerCase();
  var visibility=String(d&&d.visibility||'').trim().toLowerCase();
  return !assigned||visibility==='all'||assigned===String(u.id||'').trim().toLowerCase();
}
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function docs(){try{var a=window.hrDocGetDocs&&window.hrDocGetDocs();return Array.isArray(a)?a:[]}catch(_){return[]}}
function firstName(d){
  var n=String(d&&d.file_name||'Attachment');
  return n.indexOf(' + ')>=0?n.split(' + ')[0]:n;
}
function filesFor(d){
  if(Array.isArray(d&&d.file_data_list)&&d.file_data_list.length){
    return d.file_data_list.filter(function(f){return f&&f.data}).map(function(f,i){return {name:f.name||('Attachment '+(i+1)),type:f.type||'',data:f.data}});
  }
  if(d&&d.file_data)return [{name:firstName(d),type:d.file_type||'',data:d.file_data}];
  return [];
}
function extOf(f){var n=String(f&&f.name||'').toLowerCase(),p=n.lastIndexOf('.');return p>=0?n.slice(p+1):''}
function mimeOf(f){
  var t=String(f&&f.type||'').toLowerCase();
  if(t)return t;
  var s=String(f&&f.data||'');
  var m=s.match(/^data:([^;,]+)/i);return m?String(m[1]).toLowerCase():'';
}
function actionBar(f,index,total){
  var h=document.createElement('div');
  h.style.cssText='display:flex;align-items:center;gap:10px;width:100%;padding:9px 12px;background:#f8fafc;border-bottom:1px solid #e2e8f0;position:sticky;top:0;z-index:2';
  var nm=document.createElement('div');nm.style.cssText='font-size:11px;font-weight:800;color:#0f172a;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1';nm.textContent=(total>1?(index+1)+'/'+total+' · ':'')+(f.name||'Attachment');h.appendChild(nm);
  var b=document.createElement('button');b.type='button';b.textContent='↗ Open Original';b.style.cssText='border:1px solid #cbd5e1;background:#fff;border-radius:7px;padding:6px 9px;font-size:10px;font-weight:700;cursor:pointer;color:#0f172a';b.onclick=function(){try{var w=window.open();if(w){w.opener=null;w.location=f.data}else{var a=document.createElement('a');a.href=f.data;a.target='_blank';a.rel='noopener';document.body.appendChild(a);a.click();a.remove()}}catch(e){alert('File open nahi ho saki: '+(e.message||e))}};h.appendChild(b);
  return h;
}
async function renderOne(f,index,total){
  var section=document.createElement('section');section.style.cssText='width:100%;background:#fff;border-bottom:10px solid #e2e8f0';section.appendChild(actionBar(f,index,total));
  var view=document.createElement('div');view.style.cssText='width:100%;min-height:420px;display:flex;align-items:center;justify-content:center;background:#fff';section.appendChild(view);
  var ext=extOf(f),mime=mimeOf(f),data=f.data;
  try{
    if(mime==='application/pdf'||ext==='pdf'){
      var frame=document.createElement('iframe');frame.src=data;frame.title=f.name||'PDF';frame.style.cssText='width:100%;height:72vh;min-height:620px;border:0;background:#fff';view.appendChild(frame);
    }else if(mime.indexOf('image/')===0||['jpg','jpeg','png','webp','gif','bmp'].indexOf(ext)>=0){
      var img=document.createElement('img');img.src=data;img.alt=f.name||'Document image';img.style.cssText='display:block;max-width:100%;max-height:78vh;object-fit:contain;margin:auto;padding:12px';view.appendChild(img);
    }else if(mime.indexOf('text/')===0||ext==='txt'){
      var txt=await (await fetch(data)).text(),pre=document.createElement('pre');pre.style.cssText='width:100%;min-height:420px;padding:20px;white-space:pre-wrap;overflow:auto;font:12px/1.55 monospace';pre.textContent=txt;view.appendChild(pre);
    }else if((ext==='xlsx'||ext==='xls')&&window.XLSX){
      var ab=await (await fetch(data)).arrayBuffer(),wb=XLSX.read(ab,{type:'array'}),wrap=document.createElement('div');wrap.style.cssText='width:100%;height:70vh;overflow:auto;padding:15px';wb.SheetNames.forEach(function(sn){var t=document.createElement('h3');t.textContent=sn;t.style.margin='10px 0';wrap.appendChild(t);var holder=document.createElement('div');holder.innerHTML=XLSX.utils.sheet_to_html(wb.Sheets[sn]);wrap.appendChild(holder)});view.appendChild(wrap);
    }else if(ext==='docx'&&window.mammoth){
      var a2=await (await fetch(data)).arrayBuffer(),r=await mammoth.convertToHtml({arrayBuffer:a2}),w2=document.createElement('div');w2.style.cssText='width:100%;height:70vh;overflow:auto;padding:30px;line-height:1.6';w2.innerHTML=r.value;view.appendChild(w2);
    }else{
      view.innerHTML='<div style="padding:35px;text-align:center;color:#475569"><div style="font-size:34px;margin-bottom:12px">📄</div><b>'+esc(f.name||'Attachment')+'</b><br><br>Preview available nahi hai. Upar <b>Open Original</b> use karo.</div>';
    }
  }catch(err){
    view.innerHTML='<div style="padding:35px;text-align:center;color:#b91c1c">⚠️ Preview error: '+esc(err&&err.message?err.message:err)+'<br><br>Upar <b>Open Original</b> try karo.</div>';
  }
  return section;
}
async function openFixed(id){
  var d=docs().find(function(x){return String(x&&x.id)===String(id)});
  if(!d){alert('Document record nahi mila. HR Documents page refresh karke try karo.');return}
  if(!canView(d)){alert('Is document ka access aapko assigned nahi hai.');return}
  var fs=filesFor(d);
  if(!fs.length){alert('Is HR document ke saath attachment saved nahi hai.');return}
  var box=document.getElementById('hrFilePreview'),body=document.getElementById('hrPreviewBody'),title=document.getElementById('hrPreviewTitle');
  if(!box||!body){alert('Document preview window load nahi hui. Ctrl+F5 karke try karo.');return}
  if(title)title.textContent=fs.length>1?'Attachments — '+(d.document_name||'HR Document'):(fs[0].name||d.document_name||'Document Preview');
  body.innerHTML='<div style="padding:30px;text-align:center">⏳ Opening attachment…</div>';box.style.display='flex';
  var frag=document.createDocumentFragment();
  for(var i=0;i<fs.length;i++)frag.appendChild(await renderOne(fs[i],i,fs.length));
  body.innerHTML='';body.appendChild(frag);
}
openFixed.__atplOpenFixV2=true;
function install(){
  if(typeof window.hrDocGetDocs!=='function'){setTimeout(install,100);return}
  window.hrDocOpenFile=openFixed;
  window.hrDocOpenRaw=function(id){
    var d=docs().find(function(x){return String(x&&x.id)===String(id)});if(!d||!canView(d))return;var f=filesFor(d)[0];if(!f)return;var a=document.createElement('a');a.href=f.data;a.target='_blank';a.rel='noopener';document.body.appendChild(a);a.click();a.remove();
  };
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();
