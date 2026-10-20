'use strict';
const crypto = require('node:crypto');
function normalize(value) { return String(value || '').trim().toLowerCase(); }
function hashPayload(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }
function secureEqual(a,b) {
  const aa=Buffer.from(String(a||'')), bb=Buffer.from(String(b||''));
  return aa.length===bb.length && crypto.timingSafeEqual(aa,bb);
}
function tombKeys(mod,id,name,hash) {
  return [id,name,hash].filter(Boolean).map(x=>normalize(mod)+':'+normalize(x));
}
module.exports={normalize,hashPayload,secureEqual,tombKeys};
