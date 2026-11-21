import test from 'node:test';
import assert from 'node:assert/strict';
import { publishVideoListing, paidVideoPreviewLink } from '../src/telegram/paidListingPublisher.mjs';

function listing(){
  return {id:'sale001', sellerId:'creator1', revision:1, title:'夏の思い出', priceStars:300,
    thumbnail:{fileId:'photo001'}, sample:{fileId:'sample001',durationSeconds:30},
    paidVideo:{fileId:'main001'},rightsVerified:true,adultConsentVerified:true,ownerConfirmedPublish:true,feeTermsAccepted:true,managementFeeBps:3000};
}
function memoryReceiptStore() {
  const map=new Map();
  return {
    map,
    async claim({key,topicId}) {
      if(map.has(key))return {claimed:false};
      map.set(key,{status:'sending',topicId,freeMessageIds:null,paidMessageId:null});
      return {claimed:true};
    },
    async read(key){return map.get(key)??null;},
    async recordFree(key,freeMessageIds){
      const row=map.get(key);
      if(row?.status!=='sending'||row.freeMessageIds)throw new Error('receipt stale');
      map.set(key,{...row,freeMessageIds});
    },
    async recordPaid(key,paidMessageId){
      const row=map.get(key);
      if(row?.status!=='sending'||!row.freeMessageIds)throw new Error('receipt stale');
      map.set(key,{...row,paidMessageId,status:'sent'});
    },
    async markUnknown(key){
      const row=map.get(key);
      if(row)map.set(key,{...row,status:'needs_reconcile'});
    }
  };
}
function deps(overrides={}){
  const calls=[],store=memoryReceiptStore();
  return {listing:listing(),store,calls,
    getVerifiedVideoTopic:async()=>({id:9,purpose:'video_sale',board:'video_chat',chatId:-100123,threadId:777,title:'💰稼げる有料動画投稿',enabled:true,verified:true}),

    telegramApi:async (method,params)=>{
      calls.push({method,params});
      return method==='sendMediaGroup'?[{message_id:10},{message_id:11}]:{message_id:12};
    },...overrides};
}
test('uses existing paid/free builders, requires approval and persists both response ids',async()=>{
  const d=deps();
  const result=await publishVideoListing(d);
  assert.deepEqual(d.calls.map(x=>x.method),['sendMediaGroup','sendPaidMedia','editMessageReplyMarkup']);
  assert.deepEqual(d.calls[0].params.media.map(x=>x.has_spoiler),[true,true]);
  assert.equal(d.calls[1].params.star_count,300);
  assert.equal(d.calls[1].params.payload,'sale001:1');
  assert.equal(d.calls[0].params.message_thread_id,777);
  assert.equal(d.calls[1].params.message_thread_id,777);
  assert.deepEqual(result.freeMessageIds,[10,11]);
  assert.equal(result.paidMessageId,12);
  const repeat=await publishVideoListing(d);
  assert.equal(repeat.alreadySent,true);
  assert.equal(d.calls.length,3);
});
test('invalid configured topic prevents any send',async()=>{
  for(const override of [
    {getVerifiedVideoTopic:async()=>({purpose:'announcement',board:'video_chat',enabled:true,verified:true,chatId:-100123,threadId:777,title:'bad'})},
  ]){
    const d=deps(override);
    await assert.rejects(()=>publishVideoListing(d));
    assert.equal(d.calls.length,0);
    assert.equal(d.store.map.size,0);
  }
});
test('unconnected video GATE is marked as a definitive pre-send refusal',async()=>{
 const d=deps({getVerifiedVideoTopic:async()=>{throw new Error('VIDEO_TOPIC_NOT_CONNECTED');}});
 await assert.rejects(()=>publishVideoListing(d),e=>
   e.code==='VIDEO_PUBLICATION_PRE_SEND_REJECTED'&&/VIDEO_TOPIC_NOT_CONNECTED/.test(e.message));
 assert.equal(d.calls.length,0);
 assert.equal(d.store.map.size,0);
});

test('paid failure after free album is kept unknown and cannot automatically resend',async()=>{
  const d=deps({telegramApi:async (method)=>{
    d.calls.push({method});
    if(method==='sendMediaGroup')return [{message_id:22},{message_id:23}];
    throw new Error('simulated timeout after paid request');
  }});
  await assert.rejects(()=>publishVideoListing(d),/simulated timeout/);
  const state=await d.store.read('sale001:1');
  assert.equal(state.status,'needs_reconcile');
  assert.deepEqual(state.freeMessageIds,[22,23]);
  await assert.rejects(()=>publishVideoListing(d),/PUBLISH_NEEDS_RECONCILE/);
  assert.deepEqual(d.calls.map(x=>x.method),['sendMediaGroup','sendPaidMedia']);
});
test('missing seller consent and source tokens never bypass publish guards',async()=>{
  const d=deps();
  d.listing.ownerConfirmedPublish=false;
  await assert.rejects(()=>publishVideoListing(d),/not ready/);
  assert.equal(d.store.map.size,0);
});

test('reject missing seller 30-percent consent before any free or paid Telegram send',async()=>{
 for(const override of [{feeTermsAccepted:false},{managementFeeBps:0}]) {
   const d=deps();Object.assign(d.listing,override);
   await assert.rejects(()=>publishVideoListing(d),/fee agreement required/);
   assert.equal(d.calls.length,0);
   assert.equal(d.store.map.size,0);
 }
});

test('optional video description appears on both free gallery and official tap-to-unlock Stars video',async()=>{
 const d=deps();
 d.listing.description='30秒の無料見本。全編はStarsで視聴できます。';
 await publishVideoListing(d);
 assert.equal(d.calls[0].method,'sendMediaGroup');
 assert.equal(d.calls[0].params.media.length,2);
 assert.equal(d.calls[1].method,'sendPaidMedia');
 assert.equal(d.calls[1].params.media[0].type,'video');
 assert.equal(d.calls[1].params.star_count,300);
 assert.match(d.calls[0].params.media[0].caption,/30秒の無料見本/);
 assert.match(d.calls[1].params.caption,/30秒の無料見本/);
 assert.equal(d.calls[1].params.payload,'sale001:1');
});

test('buyer can read no-voluntary-refund notice before the official Stars unlock',async()=>{
  const d=deps();
  d.listing.description='見本の説明';
  await publishVideoListing(d);
  for(const caption of [d.calls[0].params.media[0].caption,d.calls[1].params.caption]){
    assert.match(caption,/見本の説明/);
    assert.match(caption,/300 Stars/);
    assert.match(caption,/購入者都合の通常返金なし/);
    assert.match(caption,/法令・Telegram公式の正当な例外/);
    assert.ok(caption.length<=1024);
  }
  assert.deepEqual(d.calls.map(c=>c.method),['sendMediaGroup','sendPaidMedia','editMessageReplyMarkup']);
});

test('free preview links to the paid message without exposing the video file or resending',async()=>{
  const d=deps();
  const result=await publishVideoListing(d);
  assert.equal(result.previewLinked,true);
  assert.deepEqual(d.calls.map(c=>c.method),['sendMediaGroup','sendPaidMedia','editMessageReplyMarkup']);
  assert.equal(d.calls[2].params.message_id,10);
  assert.equal(d.calls[2].params.reply_markup.inline_keyboard[0][0].url,'https://t.me/c/123/12');
  assert.equal(d.calls[2].params.reply_markup.inline_keyboard[0][0].text,'⭐ Stars本編・購入はこちら');
  assert.equal(d.calls[2].params.media,undefined);
  await publishVideoListing(d);
  assert.equal(d.calls.length,3);
  assert.throws(()=>paidVideoPreviewLink({chatId:1,freeMessageId:10,paidMessageId:11}),/invalid/);
});
test('preview-link failure never retries paid media or loses acknowledged receipt',async()=>{
  const d=deps();
  d.telegramApi=async(method,params)=>{
    d.calls.push({method,params});
    if(method==='sendMediaGroup')return [{message_id:10},{message_id:11}];
    if(method==='sendPaidMedia')return {message_id:12};
    throw Error('telegram cannot edit');
  };
  const result=await publishVideoListing(d);
  assert.equal(result.posted,true);
  assert.equal(result.previewLinked,false);
  assert.equal((await d.store.read('sale001:1')).status,'sent');
  await publishVideoListing(d);
  assert.equal(d.calls.filter(x=>x.method==='sendPaidMedia').length,1);
});
