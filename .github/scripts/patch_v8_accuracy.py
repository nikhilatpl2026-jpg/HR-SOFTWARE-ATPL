from pathlib import Path
import re,base64,gzip,math
parts=['p1','p2','p3','p4a','p4b']
b=''
for p in parts:
 s=Path(f'hr-ai-fast-v8-{p}.js').read_text()
 m=re.search(r"\+'([^']+)'",s)
 if not m: raise SystemExit('missing '+p)
 b+=m.group(1)
js=gzip.decompress(base64.b64decode(b)).decode()

def subfn(name,nextname,new):
 global js
 pat=rf"function {name}\(.*?(?=\nfunction {nextname}\()"
 js2,n=re.subn(pat,lambda _m:new,js,count=1,flags=re.S)
 if n!=1: raise SystemExit('replace failed '+name)
 js=js2

subfn('fieldVal','inferDoc',"""function fieldVal(d,field){var aliases=SYN[field]||[field],keys=Object.keys(d.kv||{}),cand=[];for(var i=0;i<keys.length;i++){var raw=norm(keys[i]),nk=nkey(raw),v=d.kv[keys[i]];if(String(v==null?'':v).trim()==='')continue;if(field==='pf'&&/(?:pf|epf)/.test(raw)&&/(?:no|number|account|uan|member|establishment|wage|rate|percent|employer)/.test(raw))continue;if(field==='esic'&&/(?:esi|esic)/.test(raw)&&/(?:no|number|account|employer|wage|rate|percent)/.test(raw))continue;var score=0;for(var a=0;a<aliases.length;a++){var na=nkey(aliases[a]);if(nk===na)score=Math.max(score,120-a);else if(nk.endsWith(na))score=Math.max(score,90-a);else if(nk.indexOf(na)>=0)score=Math.max(score,55-a);}if(!score)continue;if(field==='pf'){if(/pf.*deduction|deduction.*pf|employee.*pf|pf.*employee|pf.*amount|amount.*pf|epf.*employee/.test(raw))score+=45;if(raw==='pf'||raw==='epf')score+=30;}if(field==='esic'&&/deduction|employee|amount/.test(raw))score+=30;cand.push({s:score,v:v});}cand.sort(function(a,b){return b.s-a.s;});return cand.length?cand[0].v:'';}
""")
subfn('numericField','fmtN',"""function numericField(d,f){var v=fieldVal(d,f),n=num(v);if(isNaN(n))return null;if(f==='pf'&&(n<0||n>100000))return null;if(f==='esic'&&(n<0||n>50000))return null;if(f==='wd'&&(n<0||n>31))return null;if((f==='salary'||f==='gross')&&(n<0||n>10000000))return null;if((f==='ot'||f==='bonus')&&(n<0||n>1000000))return null;return n;}
""")
subfn('employeeLabel','fieldIntent',"""function employeeLabel(d){return (d.name||'Employee')+(d.code?' ('+d.code+')':'');}
function resolveEntity(q){var c=extractCode(q);if(c)return {code:c,name:''};var nq=' '+norm(q)+' ',best=null;for(var i=0;i<docs.length;i++){var d=docs[i];if(!d.nn||d.nn.length<3)continue;if(nq.indexOf(' '+d.nn+' ')>=0&&(!best||d.nn.length>best.name.length))best={code:d.code||'',name:d.nn};}return best;}
function strictRows(q,rs){var e=resolveEntity(q);if(!e)return rs;var out=[];for(var i=0;i<docs.length;i++){var d=docs[i];if((e.code&&d.code===e.code)||(e.name&&d.nn===e.name))out.push(d);}return out.length?out:rs;}
""")
subfn('exactLookup','latestSalary',"""function exactLookup(q,rs){var f=fieldIntent(q),qm=queryMonth(q);rs=strictRows(q,rs);if(!f||!rs.length||/highest|lowest|sabse|total|average|avg|compare|change|increase|decrease|department|last\\s+\\d+/.test(norm(q)))return '';var vals=[];for(var i=0;i<rs.length;i++){var d=rs[i];if(qm&&(!d.month||d.month.m!==qm.m||(qm.y&&d.month.y!==qm.y)))continue;var v=(f==='bank'||f==='uan'||f==='doj'||f==='dol')?fieldVal(d,f):numericField(d,f);if(v!==null&&v!==''&&!vals.some(function(x){return String(x.v)===String(v);}))vals.push({v:v,d:d});}if(vals.length===1){var x=vals[0],u={pf:' PF deduction',esic:' ESIC deduction',wd:' working days',ot:' OT',bonus:' bonus',salary:' salary',gross:' gross'}[f]||'';return employeeLabel(x.d)+(x.d.month?' — '+x.d.month.label:'')+': '+(typeof x.v==='number'?fmtN(x.v):x.v)+u+'.\\nSource: '+x.d.source;}return '';}
""")
repls=[
("function latestSalary(q,rs){","function latestSalary(q,rs){rs=strictRows(q,rs);"),
("function lastNCompare(q,rs){","function lastNCompare(q,rs){rs=strictRows(q,rs);"),
("var cq=contextQ(q),rs=search(cq,40),ans='';","var cq=contextQ(q),rs=strictRows(cq,search(cq,40)),ans='';"),
("var ev=search(cq,MAX_EVIDENCE),ctx=buildContext(cq,ev);","var ev=strictRows(cq,search(cq,MAX_EVIDENCE)),ctx=buildContext(cq,ev);"),
("Use ERP evidence exactly; never invent. If evidence is insufficient, say so.","Use ERP evidence exactly; never invent. Never answer with another employee's data. For PF use PF deduction/employee PF amount only, never PF number/UAN/member/account/wage. If exact employee + requested month/year evidence is insufficient, say exact data was not found.")]
for a,z in repls:
 if a not in js: raise SystemExit('marker missing '+a[:40])
 js=js.replace(a,z,1)
packed=base64.b64encode(gzip.compress(js.encode(),9,mtime=0)).decode()
step=math.ceil(len(packed)/5)
for i,p in enumerate(parts):
 ch=packed[i*step:(i+1)*step]
 Path(f'hr-ai-fast-v8-{p}.js').write_text("window.__ARORA_AI_V8_B64=(window.__ARORA_AI_V8_B64||'')+'"+ch+"';\n")
lp=Path('hr-ai-lazy-loader.js'); lp.write_text(re.sub(r'v=20260912-\d+','v=20260912-9',lp.read_text()))
ip=Path('index.html'); ip.write_text(re.sub(r'<script src="hr-ai-lazy-loader\.js\?v=[^"]+"></script>','<script src="hr-ai-lazy-loader.js?v=20260912-9"></script>',ip.read_text()))
for x in ['resolveEntity','strictRows','PF deduction','n>100000','Never answer with another employee']:
 if x not in js: raise SystemExit('guard missing '+x)
print('V8 strict accuracy patch ready')
