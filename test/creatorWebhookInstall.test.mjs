import test from 'node:test';
import assert from 'node:assert/strict';
import {installCreatorWebhook} from '../src/telegram/creatorWebhookInstall.mjs';

const url='https://video.example.test/telegram/creator';
const ingress={verified:true,purpose:'create_videobot_webhook',url};
const secret='secret-token-0123456789ABCDE';
const updates=['message','callback_query','purchased_paid_media'];
function provider({oldUrl='',ready=true,active=updates}={}){
 const calls=[];
 let current=oldUrl;
 const api=async(method,args)=>{
  calls.push({method,args});
  if(method==='getMe')return {is_bot:true,username:'CreateVdoBot'};
  if(method==='getWebhookInfo')return {url:current,allowed_updates:active,pending_update_count:2};
  if(method==='setWebhook'){current=args.url;return true;}
  throw Error('unexpected Telegram method');
 };
 return {api,calls,ready:async()=>ready};
}
test('real ready owner ingress is installed without dropping pending paid-media purchase updates',async()=>{
 const p=provider();
 const r=await installCreatorWebhook({
  telegramApi:p.api,url,verifiedIngress:ingress,secretToken:secret,checkReadiness:p.ready
 });
 assert.equal(r.installed,true);
 assert.deepEqual(r.updates,updates);
 const set=p.calls.find(x=>x.method==='setWebhook');
 assert.ok(set);
 assert.equal(set.args.url,url);
 assert.equal(set.args.drop_pending_updates,false);
 assert.equal(set.args.max_connections,8);
 assert.deepEqual(set.args.allowed_updates,updates);
 assert.ok(!JSON.stringify(r).includes(secret));
});
test('different existing active webhook is never overwritten, even if new endpoint is verified',async()=>{
 const p=provider({oldUrl:'https://previous.example.test/telegram/creator'});
 await assert.rejects(()=>installCreatorWebhook({
  telegramApi:p.api,url,verifiedIngress:ingress,secretToken:secret,checkReadiness:p.ready
 }),/ANOTHER_TELEGRAM_WEBHOOK_ALREADY_ACTIVE/);
 assert.equal(p.calls.filter(x=>x.method==='setWebhook').length,0);
});
test('unready private Bot listener cannot register webhook',async()=>{
 const p=provider({ready:false});
 await assert.rejects(()=>installCreatorWebhook({
  telegramApi:p.api,url,verifiedIngress:ingress,secretToken:secret,checkReadiness:p.ready
 }),/listener not ready/);
 assert.equal(p.calls.length,0);
});
test('reject different owner URL, unverified ingress and insecure address before Telegram calls',async()=>{
 for(const bad of [
  {url:'http://video.example.test/telegram/creator',verifiedIngress:{...ingress,url:'http://video.example.test/telegram/creator'}},
  {url:'https://video.example.test/wrong',verifiedIngress:{...ingress,url:'https://video.example.test/wrong'}},
  {url,verifiedIngress:{...ingress,verified:false}},
  {url:'https://127.0.0.1/telegram/creator',verifiedIngress:{...ingress,url:'https://127.0.0.1/telegram/creator'}},
  {url:'https://video.example.test/telegram/creator?secret=leak',verifiedIngress:{...ingress,url:'https://video.example.test/telegram/creator?secret=leak'}}
 ]){
  const p=provider();
  await assert.rejects(()=>installCreatorWebhook({
   ...bad,telegramApi:p.api,secretToken:secret,checkReadiness:p.ready
  }),/verified CreatorBot HTTPS ingress required|invalid CreatorBot HTTPS endpoint/);
  assert.equal(p.calls.length,0);
 }
});
test('Telegram allowed update readback mismatch is unknown state, not a successful webhook',async()=>{
 const p=provider({active:['message']});
 await assert.rejects(()=>installCreatorWebhook({
  telegramApi:p.api,url,verifiedIngress:ingress,secretToken:secret,checkReadiness:p.ready
 }),/WEBHOOK_RESULT_NEEDS_RECONCILE/);
});
