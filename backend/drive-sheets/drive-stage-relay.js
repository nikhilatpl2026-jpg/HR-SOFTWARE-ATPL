'use strict';
/**
 * Optional Google Drive + Sheets staging relay.
 * DISABLED by default. A relay key must also be validated by Apps Script BEFORE
 * enabling the Apps Script POST handler or granting public web-app access.
 * Never pass relay secrets to GitHub Pages or commit production credentials.
 */
const ACTIONS=new Set(['login','logout','session','employeeSave','employeeDelete','fileSave','fileDelete','changesSince']);
const ALLOWED_ORIGIN='https://nikhilatpl2026-jpg.github.io';
const SCRIPT_EXEC_RE=/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{30,}\/exec$/;

function allowedOrigin(origin){return origin===ALLOWED_ORIGIN;}
function hasValidConfig(env){
  return env.ATPL_DRIVE_STAGE_RELAY_ENABLED==='1' &&
    SCRIPT_EXEC_RE.test(String(env.ATPL_DRIVE_STAGE_EXEC_URL||'')) &&
    /^[A-Za-z0-9_-]{48,128}$/.test(String(env.ATPL_DRIVE_STAGE_RELAY_KEY||''));
}
function cleanRequest(body){
  if(!body||typeof body!=='object'||Array.isArray(body))return {error:'INVALID_BODY'};
  const action=String(body.action||'');
  if(!ACTIONS.has(action))return {error:'INVALID_ACTION'};
  if('relaySecret' in body||'relayKey' in body||'accessToken' in body)return {error:'FORBIDDEN_FIELD'};
  if(action==='login'){
    if(typeof body.user_id!=='string'||body.user_id.length>80||
      !/^[a-f0-9]{64}$/i.test(String(body.password_hash||'')))return {error:'INVALID_LOGIN_REQUEST'};
  }else if(!/^[a-z0-9]{64}$/i.test(String(body.token||'')))return {error:'SESSION_REQUIRED'};
  const fields={
    login:['user_id','password_hash'],logout:['token'],session:['token'],
    employeeSave:['token','record'],employeeDelete:['token','empCode'],
    fileSave:['token','payload'],fileDelete:['token','fileId','module'],
    changesSince:['token','version']
  }[action];
  const cleaned={action};
  for(const key of fields)if(Object.prototype.hasOwnProperty.call(body,key))cleaned[key]=body[key];
  return {value:cleaned};
}
function normalizeForwardResult(json){
  return !json||typeof json!=='object'||Array.isArray(json)||typeof json.ok!=='boolean'
    ? {error:'INVALID_SCRIPT_RESPONSE'} : {value:json};
}
function createDriveStageRelayRouter(express,fetchImpl,env){
  const app=express.Router(), upstream=fetchImpl||global.fetch, config=env||process.env;
  app.use((_req,res,next)=>{res.set('Cache-Control','no-store');next();});
  app.get('/status',(_req,res)=>res.json({ok:true,mode:'STAGING',
    relayConfigured:hasValidConfig(config),liveERPConnected:false}));
  app.post('/request',async(req,res)=>{
    // Origin is an extra browser restriction, NOT login/authentication.
    if(!allowedOrigin(req.get('origin')))return res.status(403).json({ok:false,error:'ORIGIN_NOT_ALLOWED'});
    if(!hasValidConfig(config))return res.status(503).json({ok:false,error:'STAGING_RELAY_DISABLED'});
    const cleaned=cleanRequest(req.body);
    if(cleaned.error)return res.status(400).json({ok:false,error:cleaned.error});
    const body=JSON.stringify({...cleaned.value,relaySecret:config.ATPL_DRIVE_STAGE_RELAY_KEY});
    if(Buffer.byteLength(body,'utf8')>7*1024*1024)
      return res.status(413).json({ok:false,error:'REQUEST_TOO_LARGE'});
    try{
      const response=await upstream(config.ATPL_DRIVE_STAGE_EXEC_URL,{
        method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8','Accept':'application/json'},
        body,redirect:'follow',signal:AbortSignal.timeout(25000)
      });
      if(!response.ok)return res.status(502).json({ok:false,error:'APPS_SCRIPT_UNAVAILABLE'});
      const type=response.headers.get('content-type')||'';
      if(!type.includes('application/json')&&!type.includes('text/plain'))
        return res.status(502).json({ok:false,error:'APPS_SCRIPT_NOT_JSON'});
      const raw=await response.text();
      if(raw.length>1024*1024)return res.status(502).json({ok:false,error:'SCRIPT_RESPONSE_TOO_LARGE'});
      let result;
      try{result=JSON.parse(raw);}catch(_){return res.status(502).json({ok:false,error:'APPS_SCRIPT_NOT_JSON'});}
      const verified=normalizeForwardResult(result);
      if(verified.error)return res.status(502).json({ok:false,error:verified.error});
      return res.json(verified.value);
    }catch(_){
      // No logging of credentials, user IDs, tokens, secrets or returned data.
      return res.status(502).json({ok:false,error:'STAGING_BACKEND_UNAVAILABLE'});
    }
  });
  app.all('*',(_req,res)=>res.status(405).json({ok:false,error:'METHOD_NOT_ALLOWED'}));
  return app;
}
module.exports={createDriveStageRelayRouter,cleanRequest,hasValidConfig,allowedOrigin,normalizeForwardResult};
