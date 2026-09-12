const c=require('../hr-ai-v9-core.js');
function rec(code,name,month,year,extra={}){return Object.assign({empCode:String(code),empName:name,nameNorm:c.norm(name),department:'Dept'+((code%3)+1),month,year,monthKey:year*100+month,monthLabel:c.parseMonth(`${month}-${year}`).label,source:`Salary ${month}-${year}.xlsx`,sheet:'Main Sheet',sourceType:'payroll',rowIndex:code},extra)}
const names=['Manisha Juneja','Hiten Kumar','Ramesh Lal','Sohan Singh','Sumer Singh','Sampat Ji','Surender Ji','Riyaz Hussain','Ajay Kumar','Anjali Barman','Mohan Das','Karan Singh','Pooja Sharma','Vikas Jain','Meena Devi','Rahul Kumar','Imran Khan','Sunita Devi','Arjun Ram','Nitin Joshi'];
let records=[];
for(let i=0;i<20;i++){const code=22001+i,name=names[i];for(let m=3;m<=8;m++){const pf=800+i*20+(m-3)*30;records.push(rec(code,name,m,2026,{pfEmployee:pf,esicEmployee:100+i*2,workingDays:20+(m%7),salaryNet:18000+i*500+(m-3)*200,otHours:i+m,otAmount:(i+m)*100,bonus:500+i*10,bankAccount:'00'+code,uan:'UAN'+code}));}}
records=records.map(r=>r.empCode==='22001'&&r.month===7?Object.assign({},r,{pfEmployee:4200}):r);
records.push({empCode:'22002',empName:'Hiten Kumar',nameNorm:c.norm('Hiten Kumar'),month:0,year:0,monthKey:0,source:'Employee Master',sheet:'Master',sourceType:'master',pfNumber:'101984291942',uan:'100200300400',bankAccount:'0022002'});
records.push({empCode:'22009',empName:'Ajay Kumar',nameNorm:c.norm('Ajay Kumar'),month:0,year:0,monthKey:0,source:'Employee Master',sheet:'Master',sourceType:'master',bankAccount:'99999999'});
records.push(rec(22003,'Ramesh Lal',7,2026,{pfEmployee:9999,salaryNet:19500,esicEmployee:104,workingDays:20,otHours:9}));
const normProbe=c.normalizeObject({'Emp Code':'22001','Employee Name':'Manisha Juneja','PF No':'101984291942','PF Deduction':4200,'Employer PF 13%':4550,'ESIC Deduction':125,'Net Payment':30500},{source:'July 2026 Salary.xlsx',sheet:'Main Sheet',sourceType:'payroll'});
if(!normProbe||normProbe.pfEmployee!==4200||normProbe.pfNumber!=='101984291942'||normProbe.pfEmployer!==4550)throw new Error('PF field separation failed');
let tests=[];
function add(name,q,check,ctx={}){tests.push({name,q,check,ctx});}
for(let i=0;i<10;i++){let code=22001+i,name=names[i],m=3+(i%6),expected=records.find(r=>r.empCode===String(code)&&r.month===m&&r.year===2026&&r.sourceType==='payroll').pfEmployee;if(code===22003&&m===7)continue;add(`pf name ${i}`,`${name} ki ${c.parseMonth(`${m}-2026`).label} PF deduction kitni hai?`,r=>r.handled&&r.text.includes(name)&&r.text.includes('₹'+expected.toLocaleString('en-IN')));add(`wd code ${i}`,`${code} ke ${c.parseMonth(`${m}-2026`).label} working days bata`,r=>r.handled&&r.text.includes(String(code))&&r.text.includes('Working days'));add(`salary ${i}`,`${name} ${c.parseMonth(`${m}-2026`).label} salary bata`,r=>r.handled&&r.text.includes('Net salary'));add(`esic ${i}`,`${code} ${c.parseMonth(`${m}-2026`).label} ESIC deduction`,r=>r.handled&&r.text.includes('ESIC deduction'));}
for(let i=0;i<10;i++)add(`latest ${i}`,`${names[i]} ne last salary kab li?`,r=>r.handled&&r.text.includes('August 2026'));
for(let i=0;i<10;i++)add(`last3 ${i}`,`${22001+i} ka last 3 months salary PF ESIC working days OT bata`,r=>r.handled&&r.text.includes('last 3 months')&&r.text.includes('June 2026')&&r.text.includes('August 2026'));
const typo=['Manisa Juneja','Hiten Kmar','Rames Lal','Sohan Sing','Sumer Sing','Sampat Ji','Surender J','Riyaz Husain','Ajay Kmar','Anjali Barman'];for(let i=0;i<10;i++)add(`typo ${i}`,`${typo[i]} ki May 2026 PF bata`,r=>r.handled&&r.text.includes(names[i]));
add('highest ot','July 2026 me sabse jyada OT kisne kiya?',r=>r.handled&&r.text.includes('highest OT hours'));
add('dept total','July 2026 department-wise salary total bata',r=>r.handled&&r.text.includes('Department-wise net salary total'));
add('pf count','July 2026 me PF me kitne bande?',r=>r.handled&&r.text.includes('PF deduction applicable/value > 0 employees'));
add('pf change','Last 3 months me PF 25% se zyada increase wale bata',r=>r.handled&&r.text.includes('Manisha Juneja'));
add('bank change','bank account kiska change hua historical master me?',r=>r.handled&&r.text.includes('Ajay Kumar'));
add('conflict','Ramesh Lal ki July 2026 PF deduction bata',r=>r.handled&&r.conflict===true&&r.text.includes('conflicting'));
add('strict month','Manisha Juneja ki July 2025 PF deduction bata',r=>r.handled&&r.text.includes('exact PF deduction data nahi mila'));
add('pf number not deduction','Hiten Kumar ki PF number bata',r=>r.handled&&r.text.includes('101984291942'));
add('uan','Hiten Kumar ka UAN bata',r=>r.handled&&r.text.includes('100200300400'));
add('gross missing','Manisha Juneja July 2026 gross bata',r=>r.handled&&r.text.includes('exact Gross salary data nahi mila'));
for(let i=0;i<10;i++){const x={empCode:String(22001+i),nameNorm:c.norm(names[i]),monthKey:202607};add(`follow ${i}`,'May wali PF bata',r=>r.handled&&r.text.includes(names[i])&&r.text.includes('May 2026'),x);}
for(let i=10;i<20;i++){let code=22001+i,name=names[i];add(`extra pf ${i}`,`${code} ka August 2026 PF bata`,r=>r.handled&&r.text.includes(String(code)));add(`extra sal ${i}`,`${name} ki June 2026 salary bata`,r=>r.handled&&r.text.includes(name)&&r.text.includes('June 2026'));}
let pass=0,fail=[];for(const t of tests){let r;try{r=c.answer(records,t.q,t.ctx);}catch(e){r={error:e};}let ok=false;try{ok=t.check(r);}catch(e){}if(ok)pass++;else fail.push({name:t.name,q:t.q,r});}
const pct=pass/tests.length*100;console.log(`V9 ACCURACY TEST: ${pass}/${tests.length} = ${pct.toFixed(1)}%`);if(fail.length){for(const f of fail.slice(0,20))console.log('FAIL',f.name,'|',f.q,'|',f.r&&f.r.text||f.r);}if(pct<90)process.exit(1);
