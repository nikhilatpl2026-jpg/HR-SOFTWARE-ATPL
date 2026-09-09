/*
 * Legacy compatibility patch for the existing index.html script reference.
 * HR Workplace UI is intentionally REMOVED. This file contains only the
 * Employee Master Excel/TSV paste parser fix.
 */
(function(){
  'use strict';

  function norm(v){
    return String(v==null?'':v)
      .toLowerCase()
      .replace(/[\u00a0]/g,' ')
      .replace(/[.\-_\/\\()&:#]+/g,' ')
      .replace(/\s+/g,' ')
      .trim();
  }

  function dateValue(v){
    if(v==null || v==='') return '';
    var s=String(v).trim();
    var m=s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/);
    if(m){
      var y=m[3].length===2?'20'+m[3]:m[3];
      return String(m[1]).padStart(2,'0')+'-'+String(m[2]).padStart(2,'0')+'-'+y;
    }
    return s;
  }

  function numberValue(v){
    if(v==null || v==='') return 0;
    var n=parseFloat(String(v).replace(/,/g,'').replace(/[₹$]/g,'').trim());
    return isFinite(n)?n:0;
  }

  var aliases={
    emp_id:['emp code','employee code','employee id','emp id','employee no','employee number','code'],
    name:['name','employee name','employee full name','emp name','worker name','staff name'],
    father:['father','father name','fathers name','father s name','fathername','guardian name','father husband name'],
    dob:['dob','d o b','date of birth','birth date','birthdate'],
    doj:['doj','d o j','date of joining','joining date','join date','date joined'],
    pf_no:['pf no','pf number','pf account','pf account no','pf account number','uan','uan no','uan number'],
    esi_no:['esi no','esi number','esic no','esic number','ip no','ip number','insurance no','insurance number'],
    bank_name:['bank','bank name','banker','banker name'],
    ifsc:['ifsc','ifsc code','ifsc number'],
    account_no:['account','account no','account number','bank account','bank account no','bank account number','a c no','a c number'],
    gender:['gender','sex'],
    dept:['department','dept','department name'],
    desig:['designation','desig','post','job title'],
    cat1:['category','category 01','category 1','cat','cat 1','employee category'],
    cat2:['category 02','category 2','cat 2','sub category','subcategory','category 02 name'],
    basic:['basic','basic salary','basic wages','basic pay','basic wage'],
    hra:['hra','house rent allowance','house rent','hra allowance'],
    gross:['gross','gross salary','gross wages','gross earning','gross earnings','gross pay']
  };

  var fields=['emp_id','name','father','dob','doj','pf_no','esi_no','bank_name','ifsc','account_no','gender','dept','desig','cat1','cat2','basic','hra','gross'];

  function headerMap(header){
    var map={};
    fields.forEach(function(k){map[k]=-1;});
    header.forEach(function(cell,i){
      var h=norm(cell); if(!h) return;
      fields.some(function(k){
        var found=aliases[k].some(function(a){return h===norm(a);});
        if(found && map[k]===-1){map[k]=i;return true;}
        return false;
      });
    });
    return map;
  }

  function makeEmployee(row,map,positional16){
    var e={};
    if(positional16){
      /* EXACT 16-column format shown in the Employee Master paste help:
         Code | Name | Father | DOB | DOJ | PF | ESI | Bank | IFSC |
         Account | Gender | Dept | Category | Basic | HRA | Gross
         There is deliberately NO Designation / Category-02 column here. */
      var p=['emp_id','name','father','dob','doj','pf_no','esi_no','bank_name','ifsc','account_no','gender','dept','cat1','basic','hra','gross'];
      p.forEach(function(k,i){
        var v=(row[i]===undefined||row[i]===null)?'':row[i];
        if(k==='dob'||k==='doj') v=dateValue(v);
        else if(k==='basic'||k==='hra'||k==='gross') v=numberValue(v);
        else v=String(v).trim();
        if(k==='gender'){
          var g=v.toUpperCase();
          if(/FEMALE|WOMAN/.test(g))v='FEMALE';
          else if(/^F$/.test(g))v='FEMALE';
          else if(/MALE|MAN/.test(g))v='MALE';
          else if(/^M$/.test(g))v='MALE';
          else v=g;
        }
        e[k]=v;
      });
      e.desig='';
      e.cat2='';
      return e;
    }

    fields.forEach(function(k){
      var i=map[k],v=i>=0?row[i]:'';
      if(k==='dob'||k==='doj')v=dateValue(v);
      else if(k==='basic'||k==='hra'||k==='gross')v=numberValue(v);
      else v=String(v==null?'':v).trim();
      if(k==='gender'){
        var g=v.toUpperCase();
        if(/FEMALE|WOMAN/.test(g))v='FEMALE';
        else if(/^F$/.test(g))v='FEMALE';
        else if(/MALE|MAN/.test(g))v='MALE';
        else if(/^M$/.test(g))v='MALE';
        else v=g;
      }
      e[k]=v;
    });
    return e;
  }

  function looksLikeHeader(row){
    var score=0;
    (row||[]).forEach(function(v){
      var h=norm(v); if(!h)return;
      Object.keys(aliases).some(function(k){
        if(aliases[k].some(function(a){return h===norm(a);})){score++;return true;}
        return false;
      });
    });
    return score>=2;
  }

  window.emParseBulkPaste=function(){
    var area=document.getElementById('emBulkPasteArea');
    if(!area)return;
    var raw=area.value||'';
    if(!raw.trim())return;

    /* Keep tabs exactly as Excel copied them. Never collapse whitespace. */
    var lines=raw.replace(/\r/g,'').split('\n').filter(function(x){return x.trim()!=='';});
    var rows=lines.map(function(line){return line.split('\t');});
    if(!rows.length)return;

    var hasHeader=looksLikeHeader(rows[0]);
    var header=hasHeader?rows[0]:null;
    var data=hasHeader?rows.slice(1):rows;
    var emps=[];

    if(hasHeader){
      var map=headerMap(header);
      data.forEach(function(row){
        if(!row.some(function(v){return String(v==null?'':v).trim()!=='';}))return;
        var e=makeEmployee(row,map,false);
        if(e.emp_id||e.name)emps.push(e);
      });
    }else{
      /* IMPORTANT: the software's visible paste instructions use 16 columns.
         Parse those columns by exact position. This prevents Father's Name from
         ever shifting into Employee Name when Designation/Category-02 are absent. */
      data.forEach(function(row){
        if(!row.some(function(v){return String(v==null?'':v).trim()!=='';}))return;
        var count=row.length;
        var is16=count<=16;
        var e=makeEmployee(row,null,is16);
        if(e.emp_id||e.name)emps.push(e);
      });
    }

    window.EM_BULK_ROWS=emps;
    if(typeof renderBulkPreview==='function')renderBulkPreview();
    var btn=document.getElementById('emBulkSaveBtn');
    if(btn){btn.disabled=!emps.length;btn.style.opacity=emps.length?'1':'.4';}
    var info=document.getElementById('emPasteInfo'),bar=document.getElementById('emPasteBar');
    if(bar)bar.style.display='flex';
    if(info)info.textContent='✅ '+emps.length+' employee rows detected. Excel columns mapped exactly — review then Save All.';
  };

  /* If the old inline paste handler calls the function before this file's
     assignment is complete, expose it again on the next event-loop turn. */
  setTimeout(function(){
    if(typeof window.emParseBulkPaste==='function') return;
  },0);
})();
