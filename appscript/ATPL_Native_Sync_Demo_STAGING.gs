/**
 * ATPL Apps Script-only NATIVE SYNC DEMO - STAGING ONLY.
 * This is a separate, deliberately synthetic Google Sheets record test.
 * NO Employee_Master, File_Index, Drive files, old ERP or doPost modified.
 *
 * In existing doGet(e), add BEFORE the original logic:
 * if (e && e.parameter && e.parameter.atpl_native_sync_demo === '1')
 *   return atplNativeSyncDemoPage();
 *
 * After saving, run atplNativeSyncDemoSelfTest in the Apps Script editor.
 * Then visit your existing /dev URL with ?atpl_native_sync_demo=1.
 * The web app access setting must remain "Only myself".
 */

var ATPL_NATIVE_DEMO_BOOK_ID_ = '1AMPJRxoSugAMCOK4-Zj2X3GFfIWGsjlTFdHFSvWaMBY';
var ATPL_NATIVE_DEMO_TAB_ = 'Native_Sync_Test';

function atplNativeDemoSheet_() {
  var book = SpreadsheetApp.openById(ATPL_NATIVE_DEMO_BOOK_ID_);
  var sheet = book.getSheetByName(ATPL_NATIVE_DEMO_TAB_);
  if (!sheet) {
    sheet = book.insertSheet(ATPL_NATIVE_DEMO_TAB_);
    sheet.getRange(1, 1, 1, 4)
      .setValues([['Test_Value', 'Revision', 'Is_Deleted', 'Updated_At']]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function atplNativeDemoState_(sheet) {
  var row = sheet.getRange(2, 1, 1, 4).getValues()[0];
  var rev = Number(row[1]) || 0;
  var deleted = rev === 0 || String(row[2]).toLowerCase() === 'true';
  return {
    ok: true,
    environment: 'STAGING',
    testOnly: true,
    liveERPConnected: false,
    revision: rev,
    deleted: deleted,
    value: deleted ? '' : String(row[0] || ''),
    updatedAt: row[3] ? String(row[3]) : ''
  };
}

function atplNativeSyncDemoGet() {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    return atplNativeDemoState_(atplNativeDemoSheet_());
  } finally {
    lock.releaseLock();
  }
}

function atplNativeSyncDemoWrite_(operation, expectedRevision, value) {
  if (typeof expectedRevision !== 'number' ||
      !Number.isSafeInteger(expectedRevision) ||
      expectedRevision < 0) {
    return {ok:false, error:'INVALID_REVISION'};
  }
  if (operation !== 'save' && operation !== 'delete') {
    return {ok:false, error:'INVALID_OPERATION'};
  }
  if (operation === 'save' &&
      (typeof value !== 'string' ||
       !/^[A-Za-z0-9 _-]{1,80}$/.test(value))) {
    return {ok:false, error:'INVALID_TEST_VALUE'};
  }
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sheet = atplNativeDemoSheet_();
    var current = atplNativeDemoState_(sheet);
    if (expectedRevision !== current.revision) {
      return {ok:false, error:'STALE_REVISION_BLOCKED',
        current:current};
    }
    sheet.getRange(2, 1, 1, 4).setValues([[
      operation === 'delete' ? '' : value,
      current.revision + 1,
      operation === 'delete',
      new Date().toISOString()
    ]]);
    SpreadsheetApp.flush();
    return atplNativeDemoState_(sheet);
  } finally {
    lock.releaseLock();
  }
}

function atplNativeSyncDemoSave(value, expectedRevision) {
  return atplNativeSyncDemoWrite_('save', expectedRevision, value);
}

function atplNativeSyncDemoDelete(expectedRevision) {
  return atplNativeSyncDemoWrite_('delete', expectedRevision, '');
}

function atplNativeSyncDemoSelfTest() {
  var before = atplNativeSyncDemoGet();
  var saved = atplNativeSyncDemoSave(
    'DEMO_' + String(new Date().getTime()), before.revision);
  if (!saved.ok || saved.deleted || saved.revision !== before.revision + 1) {
    throw new Error('STAGING save failed');
  }
  var removed = atplNativeSyncDemoDelete(saved.revision);
  if (!removed.ok || !removed.deleted ||
      removed.revision !== saved.revision + 1) {
    throw new Error('STAGING delete failed');
  }
  var stale = atplNativeSyncDemoSave('STALE_OLD_TAB', saved.revision);
  if (stale.ok || stale.error !== 'STALE_REVISION_BLOCKED') {
    throw new Error('STALE restore was not blocked');
  }
  Logger.log('SUCCESS - GOOGLE SHEETS TEST RECORD SAVE');
  Logger.log('SUCCESS - GOOGLE SHEETS TEST RECORD DELETE');
  Logger.log('SUCCESS - STALE TAB RESTORE BLOCKED');
  Logger.log('NO REAL EMPLOYEE OR FILE DATA MODIFIED');
  return {ok:true, testOnly:true, revision:removed.revision};
}

function atplNativeSyncDemoPage() {
  var html = [
'<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">',
'<meta charset="utf-8"><title>ATPL Native Sync - STAGING</title>',
'<style>body{font:16px system-ui,Arial,sans-serif;max-width:720px;margin:28px auto;padding:22px;color:#17263a}',
'h2{font-size:23px}p{line-height:1.45}input{padding:12px;width:95%;border:1px solid #9aabbe;border-radius:8px}',
'button{margin:10px 7px 12px 0;padding:11px 18px;border:0;border-radius:8px;color:white;background:#175eb8;cursor:pointer}',
'button:disabled{opacity:.4}#state{background:#eff3f7;padding:15px;border-radius:10px;white-space:pre-wrap}',
'.note{border:1px solid #d1dce6;padding:12px;border-radius:8px}.err{color:#ae2424}.ok{color:#126d45}</style></head><body>',
'<h2>ATPL Google Sheets — Cross-tab Sync Test</h2>',
'<p class="note"><b>STAGING ONLY.</b> This changes only the <b>Native_Sync_Test</b> tab in the staging spreadsheet,',
'not employee details, salary, PDF files, or the live GitHub ERP.</p>',
'<p>Open this same URL in <b>two tabs</b> (signed into the Apps Script owner account).',
'Save or Delete in one tab; the other should update in about 3 seconds.</p>',
'<label for="value">Dummy test value</label><br>',
'<input id="value" placeholder="E.g. TEST_BROWSER_A" maxlength="80" value="TEST_BROWSER_A">',
'<div><button id="save" disabled>Save test value</button>',
'<button id="del" disabled>Delete test value</button>',
'<button id="refresh">Refresh now</button></div>',
'<div id="message" role="status">Connecting to Google Sheets...</div>',
'<pre id="state">Waiting for staging state...</pre>',
'<script>',
'(function(){',
'var current=null,busy=false; var state=document.getElementById("state");',
'var msg=document.getElementById("message");',
'function display(v){',
'if(!v||v.ok!==true||v.testOnly!==true){msg.textContent="ERROR - invalid staging state";return;}',
'current=v;',
'state.textContent=JSON.stringify({revision:v.revision,deleted:v.deleted,value:v.value,updatedAt:v.updatedAt},null,2);',
'document.getElementById("save").disabled=busy;',
'document.getElementById("del").disabled=busy;',
'}',
'function fail(e){busy=false;msg.className="err";msg.textContent="ERROR: "+String((e&&e.message)||e);',
'if(current){document.getElementById("save").disabled=false;document.getElementById("del").disabled=false;}}',
'function success(v){busy=false;',
'if(v&&v.error==="STALE_REVISION_BLOCKED"){msg.className="err";msg.textContent="STALE TAB BLOCKED - data refreshed safely";display(v.current);return;}',
'if(v&&v.ok&&v.testOnly){msg.className="ok";msg.textContent="SUCCESS - Google Sheets saved. Revision "+v.revision;display(v);return;}',
'msg.className="err";msg.textContent="ERROR: "+(v&&v.error||"Unknown error");}',
'function refresh(){if(busy)return;google.script.run.withSuccessHandler(function(v){',
'if(!current||v.revision!==current.revision){msg.className="ok";msg.textContent="SYNC UPDATED - Revision "+v.revision;}',
'display(v);}).withFailureHandler(fail).atplNativeSyncDemoGet();}',
'document.getElementById("save").addEventListener("click",function(){if(!current||busy)return;',
'var value=document.getElementById("value").value.trim();',
'if(!/^[A-Za-z0-9 _-]{1,80}$/.test(value)){msg.className="err";msg.textContent="Enter 1-80 letters, digits, spaces, underscore or hyphen";return;}',
'busy=true;google.script.run.withSuccessHandler(success).withFailureHandler(fail).atplNativeSyncDemoSave(value,current.revision);',
'});',
'document.getElementById("del").addEventListener("click",function(){if(!current||busy)return;',
'busy=true;google.script.run.withSuccessHandler(success).withFailureHandler(fail).atplNativeSyncDemoDelete(current.revision);',
'});',
'document.getElementById("refresh").addEventListener("click",refresh);',
'if(!(window.google&&google.script&&google.script.run)){',
'msg.className="err";msg.textContent="ERROR - Apps Script native transport not available";return;}',
'refresh();setInterval(refresh,3000);',
'})();',
'</script></body></html>'
  ].join('\n');
  return HtmlService.createHtmlOutput(html)
    .setTitle('ATPL Google Sheets Cross-tab Sync - STAGING');
}
