import test from 'node:test';
import assert from 'node:assert/strict';
import { publishVideoListing } from '../src/telegram/paidListingPublisher.mjs';

function listing(){
  return {id:'sale001', sellerId:'creator1', revision:1, title:'夏の思い出', priceStars:300,
    thumbnail:{fileId:'photo001'}, sample:{fileId:'sample001',durationSeconds:30},
    paidVideo:{fileId:'main001'},rightsVerified:true,adultConsentVerified:true,ownerConfirmedPublish:true};
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
    verifyMembership:async()=>true,verifyReview:async()=>true,verifyRelease:async()=>true,
    telegramApi:async (method,params)=>{
      calls.push({method,params});
      return method==='sendMediaGroup'?[{message_id:10},{message_id:11}]:{message_id:12};
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
test('denied GATE, review, release or topic prevents any send',async()=>{
  for(const override of [
    {verifyMembership:async()=>false},
    {verifyReview:async()=>false},
    {verifyRelease:async()=>false},
    {getVerifiedVideoTopic:async()=>({purpose:'announcement',board:'video_chat',enabled:true,verified:true,chatId:-100123,threadId:777,title:'bad'})},
  ]){
    const d=deps(override);
    await assert.rejects(()=>publishVideoListing(d));
    assert.equal(d.calls.length,0);
    assert.equal(d.store.map.size,0);
  }
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
