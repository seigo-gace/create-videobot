import test from 'node:test';
import assert from 'node:assert/strict';
import {createCreatorWebhookAdmission} from '../src/telegram/creatorWebhookAdmission.mjs';
import {createCreatorBotUpdateHandler} from '../src/telegram/creatorBot.mjs';

const secret='S'.repeat(25);
const purchase={update_id:95,purchased_paid_media:{
 from:{id:345},paid_media_payload:'myvideo:1'
}};
function handlerWithLedger(ledger){
 return createCreatorBotUpdateHandler({
  api:async()=>true,
  sessionStore:{read:async()=>null,write:async()=>null,setScreen:async()=>null},
  listingStore:{listByOwner:async()=>[],getOwned:async()=>null},
  screenTransport:{show:async()=>({messageId:2})},
  starsLedger:ledger
 });
}
test('Telegram paid media purchase is handled only by a trusted reconciled ledger',async()=>{
 let seen=0;
 const router=handlerWithLedger({confirmPurchase:async update=>{
  seen++;assert.equal(update.purchased_paid_media.paid_media_payload,'myvideo:1');
  return {recorded:true,duplicate:seen>1};
 }});
 const admission=createCreatorWebhookAdmission({expectedSecret:secret,handleCreatorUpdate:router});
 const bytes=Buffer.from(JSON.stringify(purchase),'utf8');
 assert.deepEqual(await admission({secretHeader:secret,body:bytes}),
  {accepted:true,handled:true,updateId:95});
 assert.deepEqual(await admission({secretHeader:secret,body:bytes}),
  {accepted:true,handled:true,updateId:95});
 assert.equal(seen,2);
});
test('wrong secret stops all business effects before decoding the update',async()=>{
 let seen=0;
 const admission=createCreatorWebhookAdmission({
  expectedSecret:secret,
  handleCreatorUpdate:async()=>{seen++;return {handled:true};}
 });
 await assert.rejects(()=>admission({secretHeader:'X'.repeat(25),body:Buffer.from('invalid JSON')}),/authorization failed/);
 assert.equal(seen,0);
 await assert.rejects(()=>admission({secretHeader:secret,body:Buffer.from('invalid JSON')}),/invalid Telegram JSON/);
 assert.equal(seen,0);
});
test('purchase confirmation failure or unconnected ledger is never acknowledged',async()=>{
 const raw=Buffer.from(JSON.stringify(purchase));
 const unavailable=createCreatorWebhookAdmission({
  expectedSecret:secret,handleCreatorUpdate:handlerWithLedger(null)
 });
 await assert.rejects(()=>unavailable({secretHeader:secret,body:raw}),/ledger unavailable/);
 const notVerified=createCreatorWebhookAdmission({
  expectedSecret:secret,handleCreatorUpdate:async()=>({handled:false})
 });
 await assert.rejects(()=>notVerified({secretHeader:secret,body:raw}),/not durably handled/);
});
test('invalid update size and missing parameters are rejected',()=>{
 assert.throws(()=>createCreatorWebhookAdmission({expectedSecret:'weak',handleCreatorUpdate:async()=>({})}),/unavailable/);
 assert.throws(()=>createCreatorWebhookAdmission({expectedSecret:secret,maxBytes:1e9,handleCreatorUpdate:async()=>({})}),/unavailable/);
});
