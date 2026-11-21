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

test('durable admission answers replay without repeating purchase ledger action',async()=>{
 const records=new Map();let posted=0;
 const updateStore={
  async claim(id,hash){
   const old=records.get(id);
   if(old) {
    if(old.hash!==hash)throw Error('WEBHOOK_UPDATE_FINGERPRINT_CONFLICT');
    if(old.status!=='completed')throw Error('WEBHOOK_UPDATE_NEEDS_RECONCILE');
    return {claimed:false,completed:true,handled:old.handled};
   }
   records.set(id,{hash,status:'processing',handled:null});
   return {claimed:true};
  },
  async complete(id,handled){const row=records.get(id);row.status='completed';row.handled=handled;},
  async markUnknown(id){records.get(id).status='needs_reconcile';}
 };
 const handleCreatorUpdate=async()=>{posted++;return {handled:true};};
 const admission=createCreatorWebhookAdmission({
  expectedSecret:secret,handleCreatorUpdate,updateStore
 });
 const body=Buffer.from(JSON.stringify(purchase));
 const first=await admission({secretHeader:secret,body});
 const replay=await admission({secretHeader:secret,body});
 assert.equal(first.accepted,true);
 assert.equal(replay.duplicate,true);
 assert.equal(posted,1);
 await assert.rejects(()=>admission({
  secretHeader:secret,body:Buffer.from(JSON.stringify({...purchase,purchased_paid_media:{...purchase.purchased_paid_media,paid_media_payload:'another:2'}}))
 }),/FINGERPRINT_CONFLICT/);
 assert.equal(posted,1);
});
test('uncertain Telegram side-effect never reprocesses a failed update',async()=>{
 const records=new Map(),id=purchase.update_id;
 let tries=0;
 const updateStore={
  async claim(_,fingerprint) {
   if(records.has(id))throw Error('WEBHOOK_UPDATE_NEEDS_RECONCILE');
   records.set(id,{fingerprint,status:'processing'});
   return {claimed:true};
  },
  async complete(){throw Error('unreachable');},
  async markUnknown(){records.get(id).status='needs_reconcile';}
 };
 const admission=createCreatorWebhookAdmission({
  expectedSecret:secret,updateStore,
  handleCreatorUpdate:async()=>{tries++;throw Error('unknown payment processing state');}
 });
 const body=Buffer.from(JSON.stringify(purchase));
 await assert.rejects(()=>admission({secretHeader:secret,body}),/unknown payment/);
 assert.equal(records.get(id).status,'needs_reconcile');
 await assert.rejects(()=>admission({secretHeader:secret,body}),/NEEDS_RECONCILE/);
 assert.equal(tries,1);
});


test('recovery flag only applies to private plain start, never sticker registration or payment',async()=>{
 const types=[];
 const updateStore={
  claim:async(_id,_hash,flags)=>{types.push(flags);return {claimed:true};},
  complete:async()=>{},markUnknown:async()=>{}
 };
 const admission=createCreatorWebhookAdmission({
  expectedSecret:secret,updateStore,handleCreatorUpdate:async()=>({handled:true})
 });
 const base={message:{chat:{id:42,type:'private'},from:{id:42},text:'/start'}};
 for(const [id,message,expected] of [
  [300,base,true],
  [301,{message:{...base.message,text:'/start sticker'}},false],
  [302,{message:{...base.message,chat:{id:-1,type:'group'}}},false],
  [303,purchase,false]
 ]){
  await admission({secretHeader:secret,body:Buffer.from(JSON.stringify({update_id:id,...message}))});
  assert.equal(types.at(-1).recoverNavigation,expected);
 }
});
