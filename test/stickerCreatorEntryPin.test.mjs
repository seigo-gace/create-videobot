import test from 'node:test';
import assert from 'node:assert/strict';
import {createCreatorStickerTopicEntryPin} from '../src/stickers/creatorTopicEntryPin.mjs';

const topic={board:'video_chat',purpose:'sticker',title:'ステッカーの公開と販売',
 groupTitle:'ビデオChatの掲示板',chatId:-1002373696859,threadId:4640,
 verified:true,enabled:true};
function setup({role='administrator',wrongBot=false,sendUnknown=false,
 claimed=true,topicOverride={}}={}){
 const writes=[],receipts=[];
 const api=async(method,params)=>{
  writes.push({method,params});
  if(method==='getMe')return {is_bot:true,username:wrongBot?'GayBBS_bot':'CreateVdobot',id:42};
  if(method==='getChat')return {id:topic.chatId,type:'supergroup',is_forum:true};
  if(method==='getChatMember')return {status:role,can_pin_messages:role==='administrator'};
  if(method==='sendMessage'){
   if(sendUnknown)throw Error('TIMEOUT_AFTER_SEND');
   return {message_id:4655,chat:{id:topic.chatId},message_thread_id:4640,
     is_topic_message:true,from:{id:42}};
  }
  if(method==='pinChatMessage')return true;
  throw Error('UNEXPECTED_METHOD');
 };
 const store={
  claim:async()=>claimed?{claimed:true}:{claimed:false,status:'pinned_ack',messageId:4655},
  sent:async arg=>receipts.push({phase:'sent',...arg}),
  pinRequested:async arg=>receipts.push({phase:'pin_requested',...arg}),
  pinned:async arg=>receipts.push({phase:'pinned_ack',...arg}),
  unknown:async arg=>receipts.push({phase:'needs_reconcile',...arg})
 };
 const ensure=createCreatorStickerTopicEntryPin({
   telegramApi:api,getVerifiedStickerEntryTopic:async()=>({...topic,...topicOverride}),
   receiptStore:store
 });
 return {ensure,writes,receipts};
}
test('STK-04 CreatorBot posts and pins its own DM button to verified exact Topic',async()=>{
 const x=setup();
 const done=await x.ensure();
 assert.equal(done.acknowledged,true);
 assert.equal(done.messageId,4655);
 assert.equal(done.readbackVerified,false);
 assert.deepEqual(x.writes.map(y=>y.method),
   ['getMe','getChat','getChatMember','sendMessage','pinChatMessage']);
 const sent=x.writes.find(y=>y.method==='sendMessage').params;
 assert.equal(sent.chat_id,-1002373696859);
 assert.equal(sent.message_thread_id,4640);
 assert.equal(sent.reply_markup.inline_keyboard[0][0].url,
   'https://t.me/CreateVdobot?start=sticker');
 assert.deepEqual(x.receipts.map(x=>x.phase),['sent','pin_requested','pinned_ack']);
});
test('STK-04 never pins using GayBBS or without Creator admin rights',async()=>{
 for(const opts of [{wrongBot:true},{role:'member'}]){
  const x=setup(opts);
  await assert.rejects(x.ensure(),/BOT_UNVERIFIED|ADMIN_REQUIRED/);
  assert.equal(x.writes.some(y=>y.method==='sendMessage'),false);
 }
});
test('STK-04 invalid or swapped Topic rejects before mutation',async()=>{
 for(const topicOverride of [{threadId:0},{purpose:'room'},{title:'Other'}]){
  const x=setup({topicOverride});
  await assert.rejects(x.ensure(),/TOPIC_UNVERIFIED/);
  assert.equal(x.writes.length,0);
 }
});
test('STK-04 duplicate confirmed receipt is idempotent, no second write',async()=>{
 const x=setup({claimed:false});
 const r=await x.ensure();
 assert.equal(r.alreadyPinned,true);
 assert.equal(x.writes.some(y=>y.method==='sendMessage'),false);
});
test('STK-04 uncertain Telegram send is locked for reconciliation',async()=>{
 const x=setup({sendUnknown:true});
 await assert.rejects(x.ensure(),/TIMEOUT_AFTER_SEND/);
 assert.deepEqual(x.receipts.map(x=>x.phase),['needs_reconcile']);
 assert.equal(x.writes.filter(y=>y.method==='sendMessage').length,1);
});

test('STK-04 production entry follows Master exact group/topic IDs',async()=>{
 const {registeredTopic}=await import('../src/runtime/creatorStickerPinMain.mjs');
 assert.equal(registeredTopic.chatId,-1002373696859);
 assert.equal(registeredTopic.threadId,4640);
});
