import test from 'node:test';
import assert from 'node:assert/strict';
import {createStickerTopicPublisher,topicMessageLink} from '../src/stickers/topicPublication.mjs';
const productId='sp_'+'a'.repeat(24);
const live={purpose:'sticker',board:'video_chat',enabled:true,verified:true,
 chatId:-1002373696859,threadId:102,groupTitle:'ビデオChatの掲示板',
 title:'ステッカーの公開と販売'};
function fixture({unknown=false,wrongTopic=false,missingStars=false}={}){
 let receipt=null,paused=false,writes=[];
 const product={product_id:productId,seller_user_id:42,pack_name:'seller_pack',
  status:'published',price_stars:50,title:'Demo',items:[{file_id:'file1'}],
   management_fee_bps:3000,fee_policy_id:'sticker-admin-30-20261113',
   fee_terms_accepted_at:'2026-11-13'};
 const store={
  claim:async({productId,sellerId,topic,text})=>{
   assert.equal(sellerId,42);assert.equal(topic.threadId,102);
   if(receipt)return {claimed:false,status:receipt.status,
     messageId:receipt.telegram_message_id};
   receipt={productId,sellerId,status:'sending',display_text:text,
     chat_id:topic.chatId,message_thread_id:topic.threadId};
   return {claimed:true};
  },
  getOwned:async(id,seller)=>id===productId&&seller===42?receipt:null,
  recorded:async(_p,_s,id)=>{receipt.status='sent';receipt.telegram_message_id=id;},
  unknown:async()=>{receipt.status='needs_reconcile';},
  edited:async(_p,_s,text)=>{receipt.display_text=text;},
  deleted:async()=>{receipt.status='deleted';}
 };
 const api=async(method,params)=>{
   writes.push({method,params});
   if(method==='getMe')return {id:901,is_bot:true,username:'CreateVdobot'};
   if(method==='getChat')return {id:live.chatId,type:'supergroup',is_forum:true};
   if(method==='getChatMember')return {status:'administrator'};
   if(unknown&&method==='sendPaidMedia')throw Error('Telegram timed out');
   if(method==='sendPaidMedia')return {message_id:506,chat:{id:live.chatId},
     message_thread_id:wrongTopic?777:live.threadId,is_topic_message:true,
     from:{id:901},...(missingStars?{}:{
       paid_media:{star_count:50,paid_media:[{type:'preview',width:512,height:512}]}
     })};
   if(method==='editMessageCaption')return {message_id:506};
   if(method==='deleteMessage')return true;
   throw Error('Unexpected Telegram call');
 };
 const pub=createStickerTopicPublisher({
   telegramApi:api,getVerifiedStickerTopic:async()=>({...live}),
   verifyMembership:async()=>true,verifyReview:async()=>true,verifyRelease:async()=>true,
   receiptStore:store,createPaidCover:async()=>new Uint8Array([255,216,255]),salesStore:{
     getPublished:async()=>({...product,status:paused?'paused':'published'}),
     pauseProduct:async()=>{paused=true;return {paused:true};}
   }
 });
 return {pub,writes,get receipt(){return receipt;},get paused(){return paused;}};
}
test('STK-04 verified owner routes to designated Topic only and stores message ID',async()=>{
 const f=fixture();
 const sent=await f.pub.publish({sellerId:42,productId});
 assert.equal(sent.posted,true);
 assert.equal(sent.messageId,506);
 assert.equal(sent.groupTitle,'ビデオChatの掲示板');
 assert.equal(sent.topicTitle,'ステッカーの公開と販売');
 assert.equal(sent.link,'https://t.me/c/2373696859/506');
 assert.equal(f.writes.find(x=>x.method==='sendPaidMedia').params.message_thread_id,102);
 const repeat=await f.pub.publish({sellerId:42,productId});
 assert.equal(repeat.alreadySent,true);
 assert.equal(f.writes.filter(x=>x.method==='sendPaidMedia').length,1);
});
test('STK-04 edit only alters post text and delete pauses new sales but preserves ownership',async()=>{
 const f=fixture();
 await f.pub.publish({sellerId:42,productId});
 await f.pub.edit({sellerId:42,productId,description:'New description'});
 assert.match(f.receipt.display_text,/New description/);
 const removed=await f.pub.remove({sellerId:42,productId});
 assert.equal(removed.verified,true);
 assert.equal(f.paused,true);
 assert.equal(f.receipt.status,'deleted');
 assert.equal(f.writes.filter(x=>x.method==='deleteMessage').length,1);
});
test('STK-04 uncertain public write is locked without a second Telegram send',async()=>{
 const f=fixture({unknown:true});
 await assert.rejects(()=>f.pub.publish({sellerId:42,productId}),/timed out/);
 assert.equal(f.receipt.status,'needs_reconcile');
 await assert.rejects(()=>f.pub.publish({sellerId:42,productId}),/NEEDS_RECONCILE/);
 assert.equal(f.writes.filter(x=>x.method==='sendPaidMedia').length,1);
});
test('STK-04 rejects unverified board/thread and fabricated links before Telegram mutation',async()=>{
 const f=fixture();
 assert.throws(()=>topicMessageLink(-1002373696859,0),/LINK_INVALID/);
 await assert.rejects(()=>f.pub.publish({sellerId:99,productId}),/OWNER_MISMATCH/);
 assert.equal(f.writes.some(x=>x.method==='sendPaidMedia'),false);
});

test('STK-04 blocks a Telegram response that landed in another Topic',async()=>{
 const f=fixture({wrongTopic:true});
 await assert.rejects(()=>f.pub.publish({sellerId:42,productId}),/VERIFIED_TOPIC/);
 assert.equal(f.receipt.status,'needs_reconcile');
 assert.equal(f.writes.filter(x=>x.method==='sendPaidMedia').length,1);
 await assert.rejects(()=>f.pub.publish({sellerId:42,productId}),/NEEDS_RECONCILE/);
});

test('STK-04 cannot mark a plain or non-paid message as a Stars sale',async()=>{
 const f=fixture({missingStars:true});
 await assert.rejects(()=>f.pub.publish({sellerId:42,productId}),/VERIFIED_TOPIC/);
 assert.equal(f.receipt.status,'needs_reconcile');
 assert.equal(f.writes.filter(x=>x.method==='sendPaidMedia').length,1);
});
