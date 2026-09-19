const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function harness(){
 const pending=[],timers=new Set();
 const root={navigator:{onLine:true},setTimeout(fn,ms){const t=setTimeout(()=>{timers.delete(t);fn()},Math.min(ms,ms===160?1:ms));timers.add(t);return t;},clearTimeout(t){clearTimeout(t);timers.delete(t);}};
 const head={appendChild(s){s.parentNode=head;pending.push(s)},removeChild(s){s.parentNode=null}};
 root.document={head,createElement:()=>({}),dispatchEvent(){}};
 vm.runInNewContext(fs.readFileSync('erp-cloud-api-broker-v1.js','utf8'),{window:root});
 return {api:root.ATPLCloudAPI,pending,reply(i,d){const s=pending[i];root[new URL(s.src).searchParams.get('callback')](d);},close(){for(const t of timers)clearTimeout(t)}};
}
const tick=()=>new Promise(r=>setTimeout(r,180));
test('parameter delimiters cannot collide and share a response',async()=>{
 const h=harness();try{
 const a=h.api.request({action:'getEmployeeMaster',token:'a&x=b'}),b=h.api.request({action:'getEmployeeMaster',token:'a',x:'b'});
 await tick();assert.equal(h.pending.length,2);h.reply(0,{ok:true,records:['A']});h.reply(1,{ok:true,records:['B']});
 assert.deepEqual((await a).records,['A']);assert.deepEqual((await b).records,['B']);
 }finally{h.close()}
});
test('late read cannot refill cache or satisfy read after successful write',async()=>{
 const h=harness();try{
 const old=h.api.request({action:'getEmployeeMaster',token:'t'});
 const write=h.api.request({action:'upsertEmployeeMaster',token:'t',emp_id:'A',record_json:'{}'});
 await tick();h.reply(1,{ok:true});await write;
 const fresh=h.api.request({action:'getEmployeeMaster',token:'t'});await tick();
 assert.equal(h.pending.length,3);h.reply(0,{ok:true,records:['old']});h.reply(2,{ok:true,records:['new']});
 await old;assert.deepEqual((await fresh).records,['new']);
 assert.deepEqual((await h.api.request({action:'getEmployeeMaster',token:'t'})).records,['new']);
 }finally{h.close()}
});
