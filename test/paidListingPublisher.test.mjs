import test from 'node:test';
import assert from 'node:assert/strict';
import { publishVideoListing } from '../src/telegram/paidListingPublisher.mjs';

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
      return method==='sendMediaGroup'?[{message_id:10,media_group_id:'album_001'},{message_id:11,media_group_id:'album_001'}]:{message_id:12,chat:{id:-100123},message_thread_id:777,paid_media:{star_count:300,paid_media:[{type:'preview'}]}};
    },...overrides};
}
test('uses existing paid/free builders, requires approval and persists both response ids',async()=>{
  const d=deps();
  const result=await publishVideoListing(d);
  assert.deepEqual(d.calls.map(x=>x.method),['sendMediaGroup','sendPaidMedia']);
  assert.deepEqual(d.calls[0].params.media.map(x=>x.has_spoiler),[true,true]);
  assert.equal(d.calls[1].params.star_count,300);
  assert.equal(d.calls[1].params.payload,'sale001:1');
  assert.equal(d.calls[0].params.message_thread_id,777);
  assert.equal(d.calls[1].params.message_thread_id,777);
  assert.deepEqual(result.freeMessageIds,[10,11]);
  assert.equal(result.paidMessageId,12);
  const repeat=await publishVideoListing(d);
  assert.equal(repeat.alreadySent,true);
  assert.equal(d.calls.length,2);
});
test('an ungrouped or mismatched Telegram album response is not marked as published or retried',async()=>{
 for(const response of [
   [{message_id:10},{message_id:11}],
   [{message_id:10,media_group_id:'album_a'},{message_id:11,media_group_id:'album_b'}],
   [{message_id:10,media_group_id:'album_a'},{message_id:10,media_group_id:'album_a'}]
 ]) {
   const d=deps({telegramApi:async(method)=>{
     d.calls.push({method});
     if(method==='sendMediaGroup')return response;
     throw Error('paid-media must not be sent after invalid free album');
   }});
   await assert.rejects(()=>publishVideoListing(d),/media_group_id mismatch/);
   const state=await d.store.read('sale001:1');
   assert.equal(state.status,'needs_reconcile');
   assert.equal(state.freeMessageIds,null);
   assert.deepEqual(d.calls.map(x=>x.method),['sendMediaGroup']);
   await assert.rejects(()=>publishVideoListing(d),/PUBLISH_NEEDS_RECONCILE/);
   assert.equal(d.calls.length,1);
 }
});

test('paid-message acknowledgement without official Stars payload is never treated as published',async()=>{
 for(const result of [
   {message_id:12,chat:{id:-100123},message_thread_id:777},
   {message_id:12,chat:{id:-100123},message_thread_id:777,paid_media:{star_count:0,paid_media:[{type:'preview'}]}},
   {message_id:12,chat:{id:-100123},message_thread_id:777,paid_media:{star_count:300,paid_media:[]}},
   {message_id:12,chat:{id:-100999},message_thread_id:777,paid_media:{star_count:300,paid_media:[{type:'preview'}]}}
 ]) {
   const d=deps({telegramApi:async(method,params)=>{
     d.calls.push({method,params});
     return method==='sendMediaGroup'?
       [{message_id:10,media_group_id:'album_001'},{message_id:11,media_group_id:'album_001'}]:result;
   }});
   await assert.rejects(()=>publishVideoListing(d),/native Stars lock not confirmed/);
   assert.equal((await d.store.read('sale001:1')).status,'needs_reconcile');
   assert.deepEqual(d.calls.map(x=>x.method),['sendMediaGroup','sendPaidMedia']);
   await assert.rejects(()=>publishVideoListing(d),/PUBLISH_NEEDS_RECONCILE/);
 }
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
    if(method==='sendMediaGroup')return [{message_id:22,media_group_id:'album_002'},{message_id:23,media_group_id:'album_002'}];
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
 assert.equal(d.calls[0].params.media[0].caption,undefined);
 assert.match(d.calls[1].params.caption,/30秒の無料見本/);
 assert.equal(d.calls[1].params.payload,'sale001:1');
});

test('public preview and native Stars post contain only creator-supplied title and description',async()=>{
 const d=deps();
 d.listing.description='見本の説明';
 await publishVideoListing(d);
 const free=d.calls[0].params;
 const paid=d.calls[1].params;
 assert.equal(free.media.length,2);
 assert.deepEqual(free.media.map(x=>x.has_spoiler),[true,true]);
 assert.equal(free.media[0].caption,undefined);
 assert.equal(paid.caption,'夏の思い出\n見本の説明');
 assert.equal(paid.star_count,300);
 assert.equal(paid.media[0].type,'video');
 for(const caption of [paid.caption]){
  assert.doesNotMatch(caption,/購入前|購入者都合|返金|Telegram公式|https?:\/\//);
 }
 const noDescription=deps();
 await publishVideoListing(noDescription);
 assert.equal(noDescription.calls[0].params.media[0].caption,undefined);
 assert.equal(noDescription.calls[1].params.caption,'夏の思い出');
});

test('fails before any Telegram call if free sample is too long or is identical to paid main',async()=>{
 for(const patch of [
   {sample:{fileId:'sample001',durationSeconds:31}},
   {sample:{fileId:'main001',durationSeconds:30}},
   {sample:{fileId:'sample001',durationSeconds:NaN}},
   {sample:{fileId:'sample001',durationSeconds:0}}
 ]){
   const d=deps();
   Object.assign(d.listing,patch);
   await assert.rejects(()=>publishVideoListing(d),error=>
     error.code==='VIDEO_PUBLICATION_PRE_SEND_REJECTED' &&
     error.message==='VIDEO_FREE_SAMPLE_NOT_SAFE_FOR_PUBLICATION');
   assert.equal(d.calls.length,0);
   assert.equal(d.store.map.size,0);
 }
});

test('existing published revision blocks a second free album or Stars video',async()=>{
 const d=deps();
 d.store.findOtherDelivery=async({listingId,key})=>{
   assert.equal(listingId,'sale001');
   assert.equal(key,'sale001:1');
   return {key:'sale001:2',status:'sent'};
 };
 await assert.rejects(()=>publishVideoListing(d),e=>
   e.code==='VIDEO_PUBLICATION_PRE_SEND_REJECTED' &&
   e.message==='VIDEO_EXISTING_PUBLICATION_REQUIRES_EDIT');
 assert.equal(d.calls.length,0);
 assert.equal(d.store.map.size,0);
});
