import test from 'node:test';
import assert from 'node:assert/strict';
import {publishVideoListing} from '../src/telegram/paidListingPublisher.mjs';

const topic={id:9,purpose:'video_sale',board:'video_chat',
  chatId:-100123,threadId:777,title:'動画販売',enabled:true,verified:true};
function listing(){
 return {id:'sale001',sellerId:'creator1',revision:1,
  title:'販売動画',description:'無料見本を確認してください。',
  priceStars:300,thumbnail:{fileId:'photo001'},
  sample:{fileId:'sample001',durationSeconds:30},
  paidVideo:{fileId:'main001'},rightsVerified:true,
  adultConsentVerified:true,feeTermsAccepted:true,
  ownerConfirmedPublish:true,managementFeeBps:3000};
}
function memoryStore(){
 const map=new Map();
 return {map,
  async claim({key,saleMode}){
   assert.equal(saleMode,'invoice');
   if(map.has(key))return {claimed:false};
   map.set(key,{status:'sending',freeMessageIds:null,paidMessageId:null});
   return {claimed:true};
  },
  async read(key){return map.get(key)??null;},
  async recordFree(key,ids){
   const v=map.get(key);assert.equal(v?.status,'sending');
   assert.equal(v?.freeMessageIds,null);
   map.set(key,{...v,freeMessageIds:ids});
  },
  async recordPaid(key,id){
   const v=map.get(key);assert.equal(v?.status,'sending');
   assert.equal(v?.paidMessageId,null);
   map.set(key,{...v,paidMessageId:id,status:'sent'});
  },
  async markUnknown(key){
   const v=map.get(key);
   if(v)map.set(key,{...v,status:'needs_reconcile'});
  }
 };
}
function deps(overrides={}){
 const calls=[],store=memoryStore(),item=listing();
 const api=async(method,params)=>{
  calls.push({method,params});
  if(method==='sendMediaGroup')
   return [{message_id:10,media_group_id:'g1'},
           {message_id:11,media_group_id:'g1'}];
  if(method==='getMe')return {is_bot:true,username:'CreateVdobot'};
  if(method==='sendMessage')
   return {message_id:12,chat:{id:topic.chatId},message_thread_id:topic.threadId,
    reply_markup:params.reply_markup};
  throw Error('Unexpected Telegram call '+method);
 };
 return {listing:item,store,calls,getVerifiedVideoTopic:async()=>topic,
  telegramApi:api,...overrides};
}
test('publishes only spoiler thumbnail + sample album then a separate inline purchase button below',async()=>{
 const d=deps(),result=await publishVideoListing(d);
 assert.equal(result.saleMode,'invoice');
 assert.deepEqual(d.calls.map(x=>x.method),['sendMediaGroup','getMe','sendMessage']);
 const album=d.calls[0].params;
 assert.equal(album.message_thread_id,777);
 assert.deepEqual(album.media.map(x=>x.type),['photo','video']);
 assert.deepEqual(album.media.map(x=>x.has_spoiler),[true,true]);
 assert.equal(album.media[0].caption,'販売動画\n無料見本を確認してください。');
 assert.equal(album.media[1].caption,undefined);
 const offer=d.calls[2].params;
 assert.equal(offer.message_thread_id,777);
 assert.equal(Object.hasOwn(offer,'reply_parameters'),false);
 assert.equal(Object.hasOwn(offer,'reply_to_message_id'),false);
 assert.equal(offer.reply_markup.inline_keyboard[0][0].text,'⭐ 300 Starsで本編を購入');
 assert.equal(offer.reply_markup.inline_keyboard[0][0].url,
  'https://t.me/CreateVdobot?start=vid_sale001_r1');
 assert.equal(offer.chat_id,-100123);
 assert.equal(JSON.stringify(d.calls).includes('main001'),false);
 assert.deepEqual(result.freeMessageIds,[10,11]);
 assert.equal(result.paidMessageId,12);
 assert.equal(d.store.map.get('sale001:1').status,'sent');
});
test('repeated publication returns same receipt without any Telegram call',async()=>{
 const d=deps();await publishVideoListing(d);
 const n=d.calls.length,result=await publishVideoListing(d);
 assert.equal(result.alreadySent,true);
 assert.equal(result.paidMessageId,12);
 assert.equal(d.calls.length,n);
});
test('native Starlock is explicitly rejected without Telegram sends or a new ledger entry',async()=>{
 const d=deps();
 await assert.rejects(()=>publishVideoListing({...d,saleMode:'paid_media'}),e=>
  e.code==='VIDEO_PUBLICATION_PRE_SEND_REJECTED' &&
  e.message==='VIDEO_NATIVE_STARLOCK_PUBLICATION_DISABLED');
 assert.equal(d.calls.length,0);
 assert.equal(d.store.map.size,0);
});
test('missing rights, fee, price or owner confirmation never creates any offer',async()=>{
 for(const patch of [
  {rightsVerified:false},{adultConsentVerified:false},
  {feeTermsAccepted:false},{managementFeeBps:0},
  {priceStars:0},{priceStars:25001},{ownerConfirmedPublish:false}
 ]){
  const d=deps();Object.assign(d.listing,patch);
  await assert.rejects(()=>publishVideoListing(d),/not ready/);
  assert.equal(d.calls.length,0);
  assert.equal(d.store.map.size,0);
 }
});
test('oversized sample or leaked main video is rejected before posting',async()=>{
 for(const sample of [
  {fileId:'sample001',durationSeconds:31},
  {fileId:'main001',durationSeconds:30},
  {fileId:'sample001',durationSeconds:0}
 ]){
  const d=deps();d.listing.sample=sample;
  await assert.rejects(()=>publishVideoListing(d),e=>
   e.code==='VIDEO_PUBLICATION_PRE_SEND_REJECTED');
  assert.equal(d.calls.length,0);
 }
});
test('invalid or unavailable GATE verified target prevents Telegram posts',async()=>{
 const d=deps({getVerifiedVideoTopic:async()=>({...topic,verified:false})});
 await assert.rejects(()=>publishVideoListing(d),e=>e.code==='VIDEO_PUBLICATION_PRE_SEND_REJECTED');
 assert.equal(d.calls.length,0);
});
test('different active receipt for same listing prevents a duplicate offer',async()=>{
 const d=deps();d.store.findOtherDelivery=async()=>({key:'sale001:2',status:'sent'});
 await assert.rejects(()=>publishVideoListing(d),e=>
  e.code==='VIDEO_PUBLICATION_PRE_SEND_REJECTED' &&
  e.message==='VIDEO_EXISTING_PUBLICATION_REQUIRES_EDIT');
 assert.equal(d.calls.length,0);
});
test('bad album acknowledgement is uncertain and cannot be reposted blindly',async()=>{
 const d=deps({telegramApi:async(method)=>{
  d.calls.push(method);return [{message_id:10,media_group_id:'a'},
    {message_id:11,media_group_id:'b'}];
 }});
 await assert.rejects(()=>publishVideoListing(d),/media_group_id mismatch/);
 assert.equal(d.store.map.get('sale001:1').status,'needs_reconcile');
 await assert.rejects(()=>publishVideoListing(d),/PUBLISH_NEEDS_RECONCILE/);
 assert.equal(d.calls.length,1);
});
test('failed button send after confirmed album preserves album IDs and blocks duplicate send',async()=>{
 const d=deps();
 d.telegramApi=async(method,params)=>{
  d.calls.push({method,params});
  if(method==='sendMediaGroup')
   return [{message_id:10,media_group_id:'a'},
    {message_id:11,media_group_id:'a'}];
  if(method==='getMe')return {is_bot:true,username:'CreateVdobot'};
  throw Error('simulated network timeout');
 };
 await assert.rejects(()=>publishVideoListing(d),/timeout/);
 const saved=d.store.map.get('sale001:1');
 assert.equal(saved.status,'needs_reconcile');
 assert.deepEqual(saved.freeMessageIds,[10,11]);
 await assert.rejects(()=>publishVideoListing(d),/PUBLISH_NEEDS_RECONCILE/);
 assert.deepEqual(d.calls.map(x=>x.method),['sendMediaGroup','getMe','sendMessage']);
});
test('a message without the actual inline button is not declared published',async()=>{
 const d=deps();
 const original=d.telegramApi;
 d.telegramApi=async(method,params)=>{
  const result=await original(method,params);
  return method==='sendMessage'?{...result,reply_markup:undefined}:result;
 };
 await assert.rejects(()=>publishVideoListing(d),/VIDEO_INVOICE_BUTTON_ACK_UNKNOWN/);
 assert.equal(d.store.map.get('sale001:1').status,'needs_reconcile');
});
test('identity missing after album never invents a purchase URL',async()=>{
 const d=deps();const original=d.telegramApi;
 d.telegramApi=async(method,params)=>{
  if(method==='getMe')return {is_bot:false};
  return original(method,params);
 };
 await assert.rejects(()=>publishVideoListing(d),/VIDEO_INVOICE_BOT_IDENTITY_NOT_VERIFIED/);
 assert.equal(d.store.map.get('sale001:1').status,'needs_reconcile');
 assert.equal(d.calls.filter(x=>x.method==='sendMessage').length,0);
});
