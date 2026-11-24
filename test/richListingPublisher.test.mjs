import test from 'node:test';
import assert from 'node:assert/strict';
import {publishRichVideoListing} from '../src/telegram/richListingPublisher.mjs';
const topic={id:3,chatId:-100444,threadId:25,purpose:'video_sale',
 board:'video_chat',title:'動画販売',enabled:true,verified:true};
const listing=()=>({id:'video1',revision:1,sellerId:'1002',
 title:'サムネ＋サンプル',description:'本編は購入後にDMで受信',
 thumbnail:{fileId:'thumbnailFile'},sample:{fileId:'sampleFile',durationSeconds:23},
 paidVideo:{fileId:'privateFullVideo'},rightsVerified:true,
 adultConsentVerified:true,feeTermsAccepted:true,managementFeeBps:3000,
 ownerConfirmedPublish:true,priceStars:10});
function fake(){
 let rec=null,legacy=[],seq=0;const calls=[];
 const store={
  async read(){return rec;},
  async findOtherDelivery(){return null;},
  async findLegacyOffer(){return legacy;},
  async claim(){if(rec)return {claimed:false};rec={status:'sending',messageId:null};return {claimed:true};},
  async recordSent(key,id){assert.equal(rec.status,'sending');rec={status:'sent',messageId:id};},
  async markUnknown(){if(rec?.status==='sending')rec={status:'needs_reconcile',messageId:null};}
 };
 const api=async(method,params)=>{
  calls.push({method,params});seq++;
  if(method==='getMe')return {is_bot:true,username:'CreateVdobot'};
  if(method==='sendRichMessage')return {
   message_id:200,chat:{id:topic.chatId},message_thread_id:25,
   rich_message:params.rich_message,reply_markup:params.reply_markup
  };
  throw Error('unexpected method '+method);
 };
 return {calls,store,listing:listing(),telegramApi:api,
  getVerifiedVideoTopic:async()=>topic,
  setLegacy(v){legacy=v},get record(){return rec}};
}
test('one public RichMessage has spoiler photo+sample collage and inline button, no separate message',async()=>{
 const d=fake(),result=await publishRichVideoListing(d);
 assert.equal(result.richMessageId,200);
 assert.equal(result.saleMode,'invoice');
 assert.deepEqual(d.calls.map(x=>x.method),['sendRichMessage']);
 const req=d.calls[0].params;
 assert.deepEqual(req.rich_message.blocks.map(x=>x.type),['collage']);
 assert.equal(req.rich_message.blocks[0].caption.text,'サムネ＋サンプル\n本編は購入後にDMで受信');
 const collage=req.rich_message.blocks[0].blocks;
 assert.deepEqual(collage.map(x=>x.type),['photo','video']);
 assert.deepEqual(collage.map(x=>x.photo?.has_spoiler??x.video?.has_spoiler),[true,true]);
 assert.equal(collage[0].photo.media,'thumbnailFile');
 assert.equal(collage[1].video.media,'sampleFile');
 assert.equal(req.reply_markup.inline_keyboard[0][0].text,'⭐ 10 Starsで本編を購入');
 assert.equal(req.reply_markup.inline_keyboard[0][0].callback_data,'vid:buy:video1:1');
 assert.equal(JSON.stringify(req).includes('privateFullVideo'),false);
 assert.equal(JSON.stringify(req).includes('start=vid_'),false);
 assert.equal(req.chat_id,topic.chatId);
 assert.equal(d.record.status,'sent');
 assert.equal(d.record.messageId,200);
});
test('idempotent re-entry never sends a second public message',async()=>{
 const d=fake();await publishRichVideoListing(d);
 const again=await publishRichVideoListing(d);
 assert.equal(again.alreadySent,true);
 assert.deepEqual(d.calls.map(x=>x.method),['sendRichMessage']);
});
test('rejected or unsafe samples, missing rights and invalid prices never send',async()=>{
 const patches=[
  d=>d.listing.sample.durationSeconds=31,
  d=>d.listing.sample.fileId='privateFullVideo',
  d=>d.listing.thumbnail.fileId='privateFullVideo',
  d=>d.listing.rightsVerified=false,
  d=>d.listing.feeTermsAccepted=false,
  d=>d.listing.priceStars=0,
  d=>d.listing.managementFeeBps=0
 ];
 for(const patch of patches){
  const d=fake();patch(d);
  await assert.rejects(()=>publishRichVideoListing(d),e=>e.code==='VIDEO_PUBLICATION_PRE_SEND_REJECTED');
  assert.equal(d.calls.length,0);
 }
});
test('old same-key invoice receipt is protected unless explicitly verified replacement',async()=>{
 const d=fake();
 d.setLegacy([{key:'video1:1',status:'sent',saleMode:'invoice',freeIds:[10,11],
  paidMessageId:12,topicId:3}]);
 await assert.rejects(()=>publishRichVideoListing(d),/RICH_VIDEO_EXISTING_OFFER_REQUIRES_RECONCILE/);
 assert.equal(d.calls.length,0);
 const ok=await publishRichVideoListing({...d,allowExistingInvoiceReplacement:true});
 assert.equal(ok.richMessageId,200);
});
test('previous native Starlock receipt must not be overwritten',async()=>{
 const d=fake();d.setLegacy([{key:'video1:1',status:'sent',saleMode:'paid_media',
 freeIds:[10,11],paidMessageId:12,topicId:3}]);
 await assert.rejects(()=>publishRichVideoListing({...d,allowExistingInvoiceReplacement:true}),
 /RICH_VIDEO_EXISTING_OFFER_REQUIRES_RECONCILE/);
 assert.equal(d.calls.length,0);
});
test('Telegram acknowledgment lacking purchase button becomes unknown, not a success',async()=>{
 const d=fake();const real=d.telegramApi;
 d.telegramApi=async(method,params)=>{
  const result=await real(method,params);
  return method==='sendRichMessage'?{...result,reply_markup:undefined}:result;
 };
 await assert.rejects(()=>publishRichVideoListing(d),/RICH_VIDEO_TELEGRAM_ACK_UNKNOWN/);
 assert.equal(d.record.status,'needs_reconcile');
 await assert.rejects(()=>publishRichVideoListing(d),/RICH_VIDEO_PUBLICATION_REQUIRES_RECONCILE/);
 assert.equal(d.calls.length,1);
});
test('failed Telegram transport does not trigger a duplicate send',async()=>{
 const d=fake();const real=d.telegramApi;
 d.telegramApi=async(method,params)=>{
  if(method==='sendRichMessage'){d.calls.push({method,params});throw Error('network lost after send');}
  return real(method,params);
 };
 await assert.rejects(()=>publishRichVideoListing(d),/network lost/);
 assert.equal(d.record.status,'needs_reconcile');
 await assert.rejects(()=>publishRichVideoListing(d),/RICH_VIDEO_PUBLICATION_REQUIRES_RECONCILE/);
 assert.deepEqual(d.calls.map(x=>x.method),['sendRichMessage']);
});
