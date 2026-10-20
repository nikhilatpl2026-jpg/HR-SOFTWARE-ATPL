/**
 * ATPL staging relay key guard (Google Apps Script).
 * Copy into separate private Apps Script file. DO NOT enable POST yet.
 * A caller must have the secret held in Cloud Run Secret Manager.
 * This function MUST be called in ATPL_API_Bridge.gs before processPost_().
 */
function atplStageVerifyRelaySecret_(body) {
  var key=PropertiesService.getScriptProperties().getProperty('ATPL_STAGE_RELAY_KEY')||'';
  var candidate=String(body&&body.relaySecret||'');
  if(!/^[A-Za-z0-9_-]{48,128}$/.test(key))throw new Error('STAGING_RELAY_NOT_CONFIGURED');
  var max=Math.max(key.length,candidate.length);
  var difference=key.length^candidate.length;
  for(var i=0;i<max;i++){
    difference|=(key.charCodeAt(i)||0)^(candidate.charCodeAt(i)||0);
  }
  if(difference!==0)throw new Error('RELAY_UNAUTHORIZED');
  return true;
}
/** This safe test DOES NOT enable public traffic. */
function atplStageRelayLockTest(){
  var props=PropertiesService.getScriptProperties();
  if(props.getProperty('ATPL_STAGE_POST_ENABLED')==='true')
    throw new Error('POST is already enabled; disable before this test');
  var rejected=false;
  try{atplStageVerifyRelaySecret_({relaySecret:'wrong'});}catch(e){rejected=true;}
  if(!rejected)throw new Error('Relay authentication failure');
  Logger.log('SUCCESS - UNTRUSTED RELAY IS REJECTED');
  Logger.log('SUCCESS - POST STILL DISABLED');
  return {ok:true,stagingOnly:true};
}
