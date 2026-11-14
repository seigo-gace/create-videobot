import test from 'node:test';
import assert from 'node:assert/strict';
import {createSubscriptionPublisher} from '../src/collection/subscriptionPublisher.mjs';
import {createOfficialSubscriptionInvite} from '../src/collection/subscriptionInvite.mjs';

function targets() {
  return {
    verified:true,rightsApproved:true,
    subscription:{verified:true,type:'channel',chatId:-1004396338340,priceStars:300,
      periodSeconds:2592000,inviteUrl:'https://t.me/+ValidSubscription1'},
    topic:{verified:true,board:'video_chat',groupTitle:'ビデオChatの掲示板',
      enabled:true,chatId:-1002373696859,threadId:123,
      threadIdVerified:true,referenceUrl:'https://t.me/c/2373696859/4672',
      referenceMessageId:4672}
  };
}
function video() {
  return {channelId:1001,messageId:12,redistributionApproved:true,
    commercialUseApproved:true,sampleEditApproved:true,
    fullFileId:'FULL_FILE_ID',sampleFileId:'SAMPLE_FILE_ID',
    sampleStreamingReady:true,title:'動画A',captionJapanese:'動画Aの紹介文'};
}
function memoryStore() {
  const data=new Map();
  const k=o=>[o.channelId,o.messageId,o.kind].join(':');
  return {
    data,
    async read(o){return data.get(k(o))??null;},
    async claim(o){
      if(data.has(k(o)))return {claimed:false};
      data.set(k(o),{status:'sending',target_chat_id:o.targetChatId,
        target_thread_id:o.targetThreadId??null});
      return {claimed:true};
    },
    async sent(o,messageId){
      const row=data.get(k(o));
      if(row.status!=='sending')throw Error('INVALID_RECEIPT_STATE');
      Object.assign(row,{status:'sent',telegram_message_id:messageId});
    },
    async markUnknown(o){data.get(k(o)).status='needs_reconcile';}
  };
}
test('full member video before topic teaser; uses direct official subscription URL',async()=>{
  const events=[],store=memoryStore();
  const publisher=createSubscriptionPublisher({
    telegramApi:async(method,args)=>{
      assert.equal(method,'sendVideo');
      events.push(args);
      return {message_id:events.length,chat:{id:args.chat_id},
        ...(args.message_thread_id?{message_thread_id:args.message_thread_id,is_topic_message:true}:{})};
    },
    verifiedTargets:async()=>targets(),
    verifyBotPostingAccess:async()=>true,receipts:store
  });
  const first=await publisher.publish(video());
  assert.equal(first.published,true);
  assert.deepEqual(events.map(x=>x.chat_id),[-1004396338340,-1002373696859]);
  assert.equal(events[0].video,'FULL_FILE_ID');
  assert.equal(events[1].video,'SAMPLE_FILE_ID');
  assert.equal(events[1].message_thread_id,123);
  assert.equal(events[1].reply_markup.inline_keyboard[0][0].url,targets().subscription.inviteUrl);
  assert.match(events[1].caption,/300 Stars/);
  assert.equal((await publisher.publish(video())).full.alreadySent,true);
  assert.equal(events.length,2,'never sends duplicate video');
});
test('no teaser if member video delivery fails or is uncertain',async()=>{
  let count=0;const store=memoryStore();
  const p=createSubscriptionPublisher({
    telegramApi:async()=>{count++;throw Error('timeout');},
    verifiedTargets:async()=>targets(),verifyBotPostingAccess:async()=>true,receipts:store
  });
  await assert.rejects(p.publish(video()),/timeout/);
  assert.equal(count,1);
  assert.equal(store.data.get('1001:12:member_full').status,'needs_reconcile');
  await assert.rejects(p.publish(video()),/NEEDS_RECONCILE/);
  assert.equal(count,1);
});
test('after full success and sample failure only sample is locked; no full duplicate',async()=>{
  let count=0;const store=memoryStore();
  const p=createSubscriptionPublisher({
    telegramApi:async(method,args)=>{
      count++;
      if(count===2)throw Error('sample timeout');
      return {message_id:999,chat:{id:args.chat_id}};
    },
    verifiedTargets:async()=>targets(),verifyBotPostingAccess:async()=>true,receipts:store
  });
  await assert.rejects(p.publish(video()),/sample timeout/);
  assert.equal(store.data.get('1001:12:member_full').status,'sent');
  assert.equal(store.data.get('1001:12:sample').status,'needs_reconcile');
  await assert.rejects(p.publish(video()),/NEEDS_RECONCILE/);
  assert.equal(count,2);
});
test('no publication without explicit redistribution, commercial, sample-edit permission',async()=>{
  const store=memoryStore();let calls=0;
  const p=createSubscriptionPublisher({
    telegramApi:async()=>{calls++;},verifiedTargets:async()=>targets(),
    verifyBotPostingAccess:async()=>true,receipts:store
  });
  await assert.rejects(p.publish({...video(),commercialUseApproved:false}),/NOT_PUBLISHABLE/);
  assert.equal(calls,0);
});
test('channel invite uses official Stars subscription, no individual invoice',async()=>{
  const calls=[];
  const create=createOfficialSubscriptionInvite({
    verifyChannelAdmin:async()=>true,
    telegramApi:async(method,args)=>{
      calls.push({method,args});
      return {invite_link:'https://t.me/+ValidSubscription1',
        subscription_price:400,subscription_period:2592000};
    }
  });
  const link=await create({channelId:-1004396338340,priceStars:400});
  assert.equal(link.periodSeconds,2592000);
  assert.deepEqual(calls.map(x=>x.method),['createChatSubscriptionInviteLink']);
  assert.equal(calls[0].args.subscription_price,400);
});

test('sample topic link must not silently become thread ID',async()=>{
  const store=memoryStore();let sent=0;
  const t=targets();t.topic.threadIdVerified=false;
  const p=createSubscriptionPublisher({
    telegramApi:async()=>{sent++;},
    verifiedTargets:async()=>t,
    verifyBotPostingAccess:async()=>true,
    receipts:store
  });
  await assert.rejects(p.publish(video()),/MASTER_SAMPLE_TOPIC_NOT_VERIFIED/);
  assert.equal(sent,0);
});

test('other private channels cannot become subscription destination',async()=>{
 const store=memoryStore(),target=targets();target.subscription.chatId=-100333;
 let count=0;
 const p=createSubscriptionPublisher({telegramApi:async()=>{count++},
  verifiedTargets:async()=>target,verifyBotPostingAccess:async()=>true,receipts:store});
 await assert.rejects(p.publish(video()),/SUBSCRIPTION_MASTER_CHANNEL_MISMATCH/);
 assert.equal(count,0);
});

test('official paid invite cannot be issued for an unrelated channel',async()=>{
 let called=0;
 const create=createOfficialSubscriptionInvite({
  verifyChannelAdmin:async()=>{called++;return true},
  telegramApi:async()=>{called++;return {}}
 });
 await assert.rejects(create({channelId:-100333,priceStars:400}),/SUBSCRIPTION_MASTER_CHANNEL_MISMATCH/);
 assert.equal(called,0);
});
