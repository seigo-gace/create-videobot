import test from 'node:test';
import assert from 'node:assert/strict';
import {registerCreatorWebhookFromPrivateMounts} from '../src/runtime/creatorWebhookInstallMain.mjs';

const url='https://video.example.test/telegram/creator';
function fixture({ready=true,existing='',ownerValid=true}={}){
 const calls=[];
 const env={
  NODE_ENV:'production',VIDEOBOT_WEBHOOK_REGISTER:'YES',
  VIDEOBOT_GATE_OWNER_ADAPTER:'/opt/videobot/owner/gateOwner.mjs',
  VIDEOBOT_TELEGRAM_TOKEN_FILE:'/run/secrets/video_token',
  VIDEOBOT_WEBHOOK_SECRET_FILE:'/run/secrets/video_webhook_secret',
  VIDEOBOT_WEBHOOK_URL:url
 };
 let webhook=existing;
 const fetchImpl=async(target,options)=>{
  if(target==='http://videobot-telegram:8766/readyz'){
    calls.push('ready');return {status:ready?200:503};
  }
  const method=target.split('/').at(-1);
  calls.push(method);
  let result;
  if(method==='getMe')result={is_bot:true,username:'CreateVdoBot'};
  else if(method==='getWebhookInfo')result={url:webhook,allowed_updates:['message','callback_query','purchased_paid_media'],pending_update_count:3};
  else if(method==='setWebhook'){
    const params=JSON.parse(options.body);
    assert.equal(params.drop_pending_updates,false);
    webhook=params.url;result=true;
  }else throw Error('unexpected bot method: '+method);
  return {status:200,json:async()=>({ok:true,result})};
 };
 return {
  env,
  readSecret:p=>p.includes('webhook_secret')?'S'.repeat(30):'1234:'+('a'.repeat(38)),
  importOwner:async()=>({verifyCreatorIngress:async()=>({
    verified:ownerValid,purpose:'create_videobot_webhook',url
  })}),
  fetchImpl,calls
 };
}
test('explicit owner-verified webhook command checks private readiness before setWebhook',async()=>{
 const f=fixture();
 const r=await registerCreatorWebhookFromPrivateMounts(f);
 assert.equal(r.installed,true);
 assert.deepEqual(f.calls,['ready','getMe','getWebhookInfo','setWebhook','getWebhookInfo']);
});
test('private runtime unready keeps Telegram webhook unmodified',async()=>{
 const f=fixture({ready:false});
 await assert.rejects(()=>registerCreatorWebhookFromPrivateMounts(f),/listener not ready/);
 assert.deepEqual(f.calls,['ready']);
});
test('an existing unrelated Telegram webhook is never overwritten',async()=>{
 const f=fixture({existing:'https://other.example.test/telegram/creator'});
 await assert.rejects(()=>registerCreatorWebhookFromPrivateMounts(f),/ANOTHER_TELEGRAM_WEBHOOK_ALREADY_ACTIVE/);
 assert.equal(f.calls.includes('setWebhook'),false);
});
test('same-name untrusted owner cannot register a public ingress',async()=>{
 const f=fixture({ownerValid:false});
 await assert.rejects(()=>registerCreatorWebhookFromPrivateMounts(f),/verified CreatorBot HTTPS ingress required/);
 assert.equal(f.calls.includes('setWebhook'),false);
});
test('absent mounted secrets or wrong owner module do not call Telegram',async()=>{
 const f=fixture();
 await assert.rejects(()=>registerCreatorWebhookFromPrivateMounts({...f,
  env:{...f.env,VIDEOBOT_TELEGRAM_TOKEN_FILE:'relative-token'}
 }),/private CreatorBot token mounts required/);
 assert.deepEqual(f.calls,[]);
});
