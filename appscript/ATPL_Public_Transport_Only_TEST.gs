/**
 * ATPL GitHub URL -> Apps Script browser bridge feasibility test.
 * STANDALONE PROJECT ONLY. DO NOT PASTE INTO THE REAL ATPL ERP BACKEND.
 *
 * No SpreadsheetApp, DriveApp, passwords, sessions, or private data.
 * Only two endpoints: safe informational GET + health-only form POST.
 *
 * Publish THIS EMPTY TEST-ONLY project as Web App:
 * Execute as: Me. Access: Anyone. Copy the /exec URL.
 *
 * Then load that /exec URL into the existing
 * tools/atpl-apps-script-only-health-test.html browser tester.
 */
function doGet(e) {
  return HtmlService.createHtmlOutput(
    '<!doctype html><meta charset="utf-8"><h2>ATPL Public Transport TEST ONLY</h2>' +
    '<p>No employee records or private data are connected to this project.</p>'
  ).setTitle('ATPL Health-Only Test');
}

function doPost(e) {
  var p = e && e.parameter || {};
  var requestId = String(p.request_id || '');
  var valid = p.atpl_form_probe === '1' &&
    p.action === 'health' &&
    /^[A-Za-z0-9_-]{15,100}$/.test(requestId);

  if (!valid) {
    return HtmlService.createHtmlOutput('<p>HEALTH_ONLY_TEST: request rejected</p>')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  // The message never contains or requests private data or credentials.
  var packet = {
    channel: 'ATPL_FORM_HEALTH_V1',
    requestId: requestId,
    result: {
      ok: true,
      environment: 'STAGING',
      dataWritesEnabled: false,
      liveERPConnected: false,
      publicHealthOnly: true
    }
  };
  var safe = JSON.stringify(packet).replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
  return HtmlService.createHtmlOutput(
    '<!doctype html><html><body><script>window.top.postMessage(' +
    safe + ', "*")</' + 'script></body></html>'
  ).setTitle('ATPL Transport Health Response')
   .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function atplPublicTransportHealthSelfTest() {
  var request = {parameter: {
    atpl_form_probe: '1',
    action: 'health',
    request_id: 'ATPLHEALTHREQUEST123'
  }};
  var html = doPost(request).getContent();
  if (html.indexOf('ATPL_FORM_HEALTH_V1') < 0 ||
      html.indexOf('dataWritesEnabled') < 0) {
    throw new Error('Health response missing');
  }
  var rejected = doPost({parameter: {
    atpl_form_probe: '1',
    action: 'employeeSave',
    request_id: 'ATPLHEALTHREQUEST123'
  }}).getContent();
  if (rejected.indexOf('request rejected') < 0) {
    throw new Error('Write attempt was not rejected');
  }
  Logger.log('SUCCESS - PUBLIC TEST PROJECT RETURNS ONLY A HEALTH RESPONSE');
  Logger.log('SUCCESS - EMPLOYEE SAVE/DELETE REQUESTS ARE BLOCKED');
  Logger.log('NO GOOGLE DRIVE OR SHEETS DATA IS CONNECTED');
  return {ok: true, healthOnly: true};
}
