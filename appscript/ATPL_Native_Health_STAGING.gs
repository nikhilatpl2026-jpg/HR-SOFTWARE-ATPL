/**
 * SAFE FALLBACK — Apps Script native HTMLService and google.script.run
 *
 * Existing ATPL_API_Bridge.gs -> locate function doGet(e) {
 * INSERT AS FIRST STATEMENT INSIDE doGet:
 *
 *   if (e && e.parameter && e.parameter.atpl_native_test === '1') {
 *     return atplNativeHealthPage_();
 *   }
 *
 * No changes to doPost; POST remains disabled; staging only.
 */
function atplNativeHealthPing() {
  return {
    ok: true,
    environment: 'STAGING',
    backend: 'Google Apps Script',
    transport: 'google.script.run',
    liveERPConnected: false,
    dataWritesEnabled: false
  };
}

function atplNativeHealthPage_() {
  var html = [
    '<!doctype html><html><head>',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<style>body{font:16px system-ui,Arial,sans-serif;max-width:680px;margin:48px auto;padding:20px;color:#172337}',
    'h2{font-size:22px}#result{white-space:pre-wrap;border:1px solid #d6dde5;border-radius:10px;padding:16px}',
    '.ok{color:#08794a}.bad{color:#b42318}</style></head><body>',
    '<h2>ATPL Apps Script — Native Connection Test</h2>',
    '<p>This test sends no employee, password or file data.</p>',
    '<pre id="result">Connecting to Apps Script...</pre>',
    '<script>',
    '(function(){',
    'var output=document.getElementById("result");',
    'if(!(window.google&&google.script&&google.script.run)){',
    'output.textContent="ERROR: google.script.run unavailable";output.className="bad";return;}',
    'google.script.run.withSuccessHandler(function(data){',
    'if(data&&data.ok===true&&data.environment==="STAGING"&&data.dataWritesEnabled===false){',
    'output.textContent="SUCCESS — Apps Script connection works!\\n"+JSON.stringify(data,null,2);',
    'output.className="ok";',
    '}else{output.textContent="ERROR: Unexpected staging response";output.className="bad";}',
    '}).withFailureHandler(function(err){',
    'output.textContent="ERROR: "+String(err&&err.message||"Connection failed");output.className="bad";',
    '}).atplNativeHealthPing();',
    '})();',
    '</script></body></html>'
  ].join('');
  return HtmlService.createHtmlOutput(html).setTitle('ATPL Native Staging Connection Test');
}

function atplNativeHealthSelfTest() {
  var p = atplNativeHealthPing();
  if (!p.ok || p.environment !== 'STAGING' || p.dataWritesEnabled !== false) {
    throw new Error('Health test not safe');
  }
  var page = atplNativeHealthPage_().getContent();
  if (page.indexOf('google.script.run') < 0 || page.indexOf('atplNativeHealthPing') < 0) {
    throw new Error('HTMLService connection code missing');
  }
  Logger.log('SUCCESS - NATIVE GOOGLE APPS SCRIPT UI PREPARED');
  Logger.log('SUCCESS - NO EMPLOYEE DATA, NO FILES, NO POST WRITES');
  return {ok:true,stagingOnly:true};
}
