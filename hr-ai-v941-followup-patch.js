/* Arora ERP AI V9.4.1 — deterministic follow-up memory for structured aggregate answers.
   This patch does not rebuild or change the cached payroll database. */
(function(root){
'use strict';
var C=root&&root.AroraAIV9Core;
if(!C||C.__v941FollowupPatched)return;
C.__v941FollowupPatched=true;
var previousAnswer=C.answer;

function norm(s){return C.norm?C.norm(s):String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();}
function lastN(q){var m=norm(q).match(/(?:last|pichle|pichla|pichli)\s+(\d{1,2})\s*(?:month|months|mahine|mahina)/);return m?Math.max(1,+m[1]):0;}
function followupWords(q){
  var n=' '+norm(q)+' ';
  return /\b(?:aur|or)\s+koi\b/.test(n)||
         /\bkisi\s+aur\b/.test(n)||
         /\bbas\s+(?:itne|itni|itna|yehi|yahi)\b/.test(n)||
         /\b(?:koi|kisi).*\b(?:nahi|nahin|nai)\b.*\b(?:change|changed|hua|hue|badla|badli)\b/.test(n)||
         /\b(?:complete|full)\s+list\b/.test(n)||
         /\b(?:sabhi|saare|sare)\b/.test(n);
}
function isGlobalChangeAnswer(r,q){
  if(!r||!r.handled||!r.text||!lastN(q))return false;
  return /\s+changes\s+—\s+/i.test(String(r.text));
}
function enrichGlobalContext(r,q){
  if(!isGlobalChangeAnswer(r,q))return r;
  var text=String(r.text||''),lines=text.split(/\r?\n/),count=0;
  for(var i=1;i<lines.length;i++){
    var x=lines[i].trim();
    if(!x||/^⚠/.test(x))continue;
    if(/:\s+/.test(x))count++;
  }
  var cm=text.match(/(\d+)\s+conflicting employee\/month records?\s+exclude/i);
  var old=r.context||{};
  r.context=Object.assign({},old,{
    lastIntent:'globalChanges',
    lastN:lastN(q),
    lastChangeField:old.field||(C.parseFieldIntent?C.parseFieldIntent(q):''),
    lastChangeCount:count,
    lastChangeConflicts:cm?Number(cm[1]):0,
    lastChangeTruncated:count>=80,
    lastChangeQuery:String(q||'')
  });
  return r;
}
function structuredFollowup(q,ctx){
  if(!ctx||ctx.lastIntent!=='globalChanges'||!ctx.lastN||!followupWords(q))return null;
  var f=ctx.lastChangeField||ctx.field||'salaryNet';
  var lab=C.fieldLabel?C.fieldLabel(f):f;
  var count=Number(ctx.lastChangeCount||0),conf=Number(ctx.lastChangeConflicts||0),txt='';
  if(ctx.lastChangeTruncated){
    txt='Pichli '+lab+' change list me first '+count+' clean results dikhaye gaye the. List 80-result display limit tak pahunchi thi, isliye main “aur koi nahi” confirm nahi karunga.';
  }else if(count>0){
    txt='Haan bhai, clean '+lab+' comparison ke hisaab se pichli list me total '+count+' employees mile the. Iske alawa koi aur clean change record nahi mila.';
  }else{
    txt='Haan bhai, clean '+lab+' comparison me koi changed employee record nahi mila.';
  }
  if(conf>0)txt+='\n⚠ '+conf+' conflicting employee/month record(s) exclude hue the, isliye un cases ko change/no-change ke liye confirm nahi kiya gaya.';
  return {handled:true,text:txt,context:ctx};
}

C.answer=function(records,q,ctx){
  records=Array.isArray(records)?records:[];
  ctx=ctx||{};
  var follow=structuredFollowup(q,ctx);
  if(follow)return follow;
  return enrichGlobalContext(previousAnswer(records,q,ctx),q);
};
C.version='9.4.1';
})(typeof self!=='undefined'?self:globalThis);
