'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname,'..','compliance-dol-rebuild-v2.js'),'utf8');
const from=source.indexOf('async function snapshotChallanBlob(');
const to=source.indexOf('async function moveVaultFileForPeriod(',from);
assert.ok(from>=0&&to>from,'Expected local file snapshot and restore routines');

class MutatingOPFSFile extends Blob {
  constructor(bytes) {super([bytes],{type:'application/pdf'});this.modified=false}
  async arrayBuffer(){
    if(this.modified)throw new DOMException('The requested file could not be read, typically due to permission problems that have occurred after a reference to a file was acquired.','NotReadableError');
    return super.arrayBuffer();
  }
}
function makeReader(opfsRead){
  const scope={Blob,Uint8Array,ArrayBuffer,atob,console,
    opfsRead,fileMime:()=> 'application/pdf'};
  vm.runInNewContext(source.slice(from,to)+'\nthis.getStoredBlob=getStoredBlob;this.snapshotChallanBlob=snapshotChallanBlob;',scope);
  return scope;
}
test('OPFS original stays readable even if cloud repair overwrites backing file',async()=>{
  const original=new MutatingOPFSFile('%PDF-1.4\nvalid test bytes');
  const {getStoredBlob}=makeReader(async()=>original);
  const stable=await getStoredBlob({name:'ESIC Statement January 2025.pdf',opfsPath:['esic','2025','original']});
  assert.ok(stable instanceof Blob);
  original.modified=true; // cloud promotion wrote to OPFS after read
  assert.match(Buffer.from(await stable.arrayBuffer()).toString('ascii'),/^%PDF-1.4/);
  await assert.rejects(original.arrayBuffer(),/file could not be read/);
});
test('Expired cached Blob falls back to fresh readable OPFS file',async()=>{
  const expired=new MutatingOPFSFile('%PDF-1.4 original');expired.modified=true;
  const live=new MutatingOPFSFile('%PDF-1.4 recovered');
  const {getStoredBlob}=makeReader(async()=>live);
  const stable=await getStoredBlob({name:'PF May.pdf',blob:expired,opfsPath:['pf','2025','test']});
  assert.match(Buffer.from(await stable.arrayBuffer()).toString('ascii'),/recovered/);
});
test('No readable browser file yields null instead of silently claiming a valid document',async()=>{
  const expired=new MutatingOPFSFile('%PDF-1.4');expired.modified=true;
  const {getStoredBlob}=makeReader(async()=>expired);
  const result=await getStoredBlob({name:'PF May.pdf',opfsPath:['pf','2025','test']});
  assert.equal(result,null);
});
test('Old PDF blob cache is never cleared without a durable OPFS path',()=>{
  assert.ok(source.includes("blob:rec.opfsPath?null:await snapshotChallanBlob(blob"));
  assert.ok(source.includes("var safeOriginal=await snapshotChallanBlob(blob"));
  assert.ok(source.includes("var pdfBlob=safeOriginal;"));
});
