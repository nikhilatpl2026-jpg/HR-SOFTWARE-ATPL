const C=require('../hr-ai-v9-core.js');require('../hr-ai-v93-query-patch.js')(C);
function r(code,name,m,y,extra={}){return Object.assign({empCode:String(code),empName:name,nameNorm:C.norm(name),month:m,year:y,monthKey:y*100+m,monthLabel:C.parseMonth(`${m}-${y}`).label,source:`${C.parseMonth(`${m}-${y}`).label} Salary Sheet Atpl Final.xls`,sheet:'Main Sheet',sourceType:'payroll',rowIndex:10},extra)}
let rows=[];
rows.push(r(26448,'NIKHIL',3,2026,{salaryNet:16235,fieldSources:{salaryNet:'Manual Amount'},sheet:'Formula Sheet'}));
rows.push(r(26448,'NIKHIL',3,2026,{salaryNet:17000,fieldSources:{salaryNet:'Net Payment'},sheet:'Main Sheet'}));
rows.push(r(26448,'NIKHIL',5,2026,{salaryNet:18050,fieldSources:{salaryNet:'Manual Amount'},sheet:'Formula Sheet'}));
rows.push(r(26448,'NIKHIL',5,2026,{salaryNet:19000,fieldSources:{salaryNet:'Net Payment'},sheet:'Main Sheet'}));
for(const [code,name,vals] of [[22157,'A Worker',[20000,21000,21000]],[22158,'B Worker',[18000,18000,18000]],[22159,'C Worker',[22000,22500,23000]]]){[6,7,8].forEach((m,i)=>rows.push(r(code,name,m,2026,{gross:vals[i],salaryNet:vals[i]-1000,fieldSources:{gross:'Gross Salary',salaryNet:'Net Payment'}})));}
rows.push({empCode:'',empName:'GROSS SALARY',nameNorm:C.norm('GROSS SALARY'),month:4,year:2026,monthKey:202604,monthLabel:'April 2026',source:'Formula Sheet',sheet:'Formula Sheet',sourceType:'payroll',gross:999999,fieldSources:{gross:'Gross Salary'}});
function assert(ok,msg){if(!ok){console.error('FAIL',msg);process.exit(1);}}
let a=C.answer(rows,'MARCH 2026 ME EMP CODE 26448 KI MANUAL AMOUNT KITNI THI',{});assert(a.handled,'manual handled');assert(/Manual Amount ₹16,235/.test(a.text),'manual amount exact');assert(!/Net salary/.test(a.text),'manual not net label');assert(a.context.field==='manualAmount','manual context field');
let b=C.answer(rows,'MAY 2026 ME',a.context);assert(b.handled,'followup handled');assert(/May 2026/.test(b.text)&&/Manual Amount ₹18,050/.test(b.text),'month-only followup reused employee + field');
let c=C.answer(rows,'LAST 3 MONTHS ME KONSE KONSE ESA BANDE JINKI GROSS SALARY ME CHANGES HUA USSKI LIST DE MERKO',{});assert(c.handled,'gross change handled');assert(/Gross salary changes/.test(c.text),'gross change title');assert(/A Worker/.test(c.text)&&/C Worker/.test(c.text),'changed employees included');assert(!/B Worker/.test(c.text),'unchanged employee excluded');assert(!/GROSS SALARY \— last 1 months/.test(c.text),'pseudo employee not selected');
let d=C.answer(rows,'EMP CODE 26448 KI MARCH 2026 NET SALARY KITNI THI',{});assert(/Net salary ₹17,000/.test(d.text),'net salary excludes manual amount source');
console.log('V9.3 SCREENSHOT REGRESSION: 4/4 = 100.0%');
