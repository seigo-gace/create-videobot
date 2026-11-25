import test from 'node:test';
import assert from 'node:assert/strict';
import {createCreatorHttpService} from '../src/runtime/creatorHttpService.mjs';

const secret='s'.repeat(28);
async function runService(callback,readiness=async()=>true){
 const svc=createCreatorHttpService({handleTelegramWebhook:callback,readiness,port:0});
 const addr=await svc.listen();
 return {svc,url:'http://127.0.0.1:'+addr.port};
}
test('actual private HTTP listener admits only secret-protected Telegram POST updates',async()=>{
 let seen=0;const x=await runService(async({body,secretHeader})=>{
  assert.equal(secretHeader,secret);
  assert.equal(JSON.parse(body.toString()).update_id,432);
  seen++;
 });
 try{
  const health=await fetch(x.url+'/healthz');
  assert.equal(health.status,200);
  const good=await fetch(x.url+'/telegram/creator',{
   method:'POST',headers:{'X-Telegram-Bot-Api-Secret-Token':secret,
      'Content-Type':'application/json'},
   body:JSON.stringify({update_id:432})
  });
  assert.equal(good.status,200);
  assert.equal((await good.json()).status,'accepted');
  assert.equal(seen,1);
  const bad=await fetch(x.url+'/telegram/creator',{
   method:'POST',headers:{'X-Telegram-Bot-Api-Secret-Token':'wrong'},
   body:JSON.stringify({update_id:433})
  });
  assert.equal(bad.status,401);
  assert.equal(seen,1);
  const unknown=await fetch(x.url+'/bad');
  assert.equal(unknown.status,404);
 }finally{await x.svc.close();}
});
test('never acknowledge uncommitted webhook or disclose internal exception to remote caller',async()=>{
 const x=await runService(async()=>{throw new Error('private database token xyz not readable');});
 try{
  const r=await fetch(x.url+'/telegram/creator',{
   method:'POST',headers:{'X-Telegram-Bot-Api-Secret-Token':secret},
   body:JSON.stringify({update_id:2})
  });
  assert.equal(r.status,503);
  const text=await r.text();
  assert.doesNotMatch(text,/token xyz|database/);
  assert.match(text,/processing-unavailable/);
 }finally{await x.svc.close();}
});
test('readiness is explicitly gated, health is not proof of dependent services',async()=>{
 const x=await runService(async()=>true,async()=>false);
 try{
  assert.equal((await fetch(x.url+'/healthz')).status,200);
  assert.equal((await fetch(x.url+'/readyz')).status,503);
 }finally{await x.svc.close();}
});
test('configured payload cap blocks oversized Telegram updates before application code',async()=>{
 let seen=0;
 const x=await runService(async()=>{seen++});
 try{
  const r=await fetch(x.url+'/telegram/creator',{
   method:'POST',headers:{'X-Telegram-Bot-Api-Secret-Token':secret},
   body:'x'.repeat(280000)
  });
  assert.equal(r.status,413);
  assert.equal(seen,0);
 }finally{await x.svc.close();}
});
test('reject unauthorized exposure settings and invalid handlers',()=>{
 assert.throws(()=>createCreatorHttpService(),/invalid Creator HTTP/);
 assert.throws(()=>createCreatorHttpService({
  handleTelegramWebhook:async()=>true,host:'example.com'
 }),/invalid Creator HTTP/);
 assert.throws(()=>createCreatorHttpService({
  handleTelegramWebhook:async()=>true,maxBytes:1000000
 }),/invalid Creator HTTP/);
});
