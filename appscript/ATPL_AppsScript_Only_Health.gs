/**
 * ATPL Drive / Sheets: Cloud-Run-free staging form transport.
 *
 * This ONLY accepts a HEALTH probe, and returns no employee/file data.
 * It is safe to test while the existing doPost API is fully disabled.
 * Google Apps Script's web app supports HTML form posts without CORS fetch.
 * HtmlService may require embedding permission / cookies depending on browser.
 *
 * ADD TO EXISTING doPost(e), as the VERY FIRST line inside the function:
 *
 * if (e && e.parameter && e.parameter.atpl_form_probe === '1')
 *   return atplFormHealthResponse_(e);
 *
 * Do NOT replace the existing doPost or set ATPL_STAGE_POST_ENABLED=true.
 */
function atplFormHealthResponse_(e) {
  var params=(e && e.parameter)||{};
  var requestId=String(params.request_id||'');
  if(!/^[a-zA-Z0-9_-]{15,100}$/.test(requestId)) requestId='INVALID_REQUEST';
  var result;
  if (String(params.action||'')!=='health') {
    result={ok:false,error:'HEALTH_ONLY_STAGING'};
  } else {
    result={
      ok:true,
      service:'ATPL Apps Script-only Drive Bridge',
      environment:'STAGING',
      liveERPConnected:false,
      dataWritesEnabled:false
    };
  }
  // Only the same non-private health response is transmitted.
  var packet={
    channel:'ATPL_FORM_HEALTH_V1',
    requestId:requestId,
    result:result
  };
  // Embed valid JSON without letting user input escape into executable HTML.
  var json=JSON.stringify(packet).replace(/</g,'\\u003c')
       .replace(/>/g,'\\u003e').replace(/&/g,'\\u0026');
  var html='<!doctype html><html><head><meta charset="utf-8"></head>'
    +'<body><script>window.top.postMessage('+json+', "*");</'
    +'script></body></html>';
  return HtmlService.createHtmlOutput(html)
    .setTitle('ATPL Secure Staging Health')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
/** Run in Apps Script editor (no data changes). */
function atplFormHealthSelfTest() {
  var result=atplFormHealthResponse_({parameter:{
    atpl_form_probe:'1',
    request_id:'ATPLHEALTHPROBE123456',
    action:'health'
  }});
  var html=result.getContent();
  if(html.indexOf('ATPL_FORM_HEALTH_V1')<0 ||
     html.indexOf('dataWritesEnabled')<0)throw new Error('Health transport error');
  var blocked=atplFormHealthResponse_({parameter:{
    atpl_form_probe:'1',
    request_id:'ATPLHEALTHPROBE123456',
    action:'employeeSave'
  }}).getContent();
  if(blocked.indexOf('HEALTH_ONLY_STAGING')<0)throw new Error('Unsafe data action');
  Logger.log('SUCCESS - STAGING FORM TRANSPORT PREPARED');
  Logger.log('SUCCESS - ALL DATA ACTIONS BLOCKED');
  return {ok:true,healthOnly:true};
}
