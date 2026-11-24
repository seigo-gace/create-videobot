import test from 'node:test';
import assert from 'node:assert/strict';
import {replaceInvoiceAlbumWithRich} from '../src/operations/replaceInvoiceAlbumWithRich.mjs';

const old=()=>({
 listing_id:'v26nov24invoice',revision:1,status:'published',
 sale_mode:'invoice',old_receipt_status:'sent',
 seller_user_id:1001,title:'肉便器',description:'サンプルテスト',
 price_stars:10,thumbnail_file_id:'thumbABC',
 sample_file_id:'sampleXYZ',paid_video_file_id:'FULL_PRIVATE_VIDEO',
 rights_verified:true,adult_consent_verified:true,
 fee_terms_accepted_at:'2026-11-20',management_fee_bps:3000,
 topic_id:3,free_message_ids:[101,102],paid_message_id:103
});
const topic={id:3,chatId:-100222,threadId:63,verified:true,enabled:true,
 purpose:'video_sale',board:'video_chat'};
function deps(){
 let row=old(),history=1,ack=true,removeAt=null;const calls=[];
 const pool={query:async(sql)=>{
  if(sql.includes('FROM videobot_listings l')&&sql.includes('videobot_post_receipts r'))
   return {rows:[row]};
  if(sql.includes('COUNT(*)::int AS n FROM videobot_stars_ledger WHERE kind'))
   return {rows:[{n:history}]};
  if(sql.includes('JOIN videobot_listings original'))
   return {rows:[{n:history}]};
  throw Error('Unexpected SQL '+sql.slice(0,80));
 }};
 const telegramApi=async(method,params)=>{
  calls.push({method,params});
  if(method==='editMessageText'){
   if(!ack)return {
     message_id:103,chat:{id:topic.chatId},
     rich_message:params.rich_message
   };
   return {message_id:103,chat:{id:topic.chatId},
    rich_message:params.rich_message,
    reply_markup:params.reply_markup};
  }
  if(method==='deleteMessage')return params.message_id!==removeAt;
  throw Error('No other Telegram method is permitted: '+method);
 };
 return {pool,telegramApi,getVerifiedVideoTopic:async()=>topic,calls,
  setRow(v){row={...row,...v}},
  setHistory(v){history=v},noMarkup(){ack=false},failDelete(id){removeAt=id}};
}
test('edits SAME purchase message to collage with caption and one-tap callback, removes only free duplicate previews',async()=>{
 const d=deps();
 const r=await replaceInvoiceAlbumWithRich(d);
 assert.equal(r.edited,true);
 assert.equal(r.originalPurchaseMessageId,103);
 assert.equal(r.freePreviewFullyRemoved,true);
 assert.deepEqual(d.calls.map(c=>c.method),
  ['editMessageText','deleteMessage','deleteMessage']);
 const c=d.calls[0].params;
 assert.equal(c.message_id,103);
 assert.equal(c.chat_id,topic.chatId);
 assert.deepEqual(c.rich_message.blocks.map(x=>x.type),['collage']);
 const media=c.rich_message.blocks[0].blocks;
 assert.deepEqual(media.map(x=>x.type),['photo','video']);
 assert.deepEqual(media.map(x=>x.photo?.has_spoiler??x.video?.has_spoiler),[true,true]);
 assert.equal(c.rich_message.blocks[0].caption.text,'肉便器\nサンプルテスト');
 assert.equal(c.reply_markup.inline_keyboard[0][0].callback_data,'vid:buy:v26nov24invoice:1');
 assert.equal(c.reply_markup.inline_keyboard[0][0].text,'⭐ 10 Starsで本編を購入');
 assert.equal(JSON.stringify(c).includes('FULL_PRIVATE_VIDEO'),false);
 assert.deepEqual(d.calls.slice(1).map(x=>x.params.message_id),[102,101]);
 assert.equal(r.ledgerUnchanged,true);
});
test('never edits old post if buyer entitlement not verified',async()=>{
 const d=deps();d.setHistory(0);
 await assert.rejects(()=>replaceInvoiceAlbumWithRich(d),/PREVIOUS_BUYER_UNVERIFIED/);
 assert.deepEqual(d.calls,[]);
});
test('no markup in Telegram reply means no free media removal',async()=>{
 const d=deps();d.noMarkup();
 await assert.rejects(()=>replaceInvoiceAlbumWithRich(d),/ACK_UNKNOWN_KEEP_OLD_ALBUM/);
 assert.deepEqual(d.calls.map(x=>x.method),['editMessageText']);
});
test('a rejected edit cannot create a fallback public message',async()=>{
 const d=deps();
 d.telegramApi=async(method)=>{
  d.calls.push({method});
  throw Error('network uncertain');
 };
 await assert.rejects(()=>replaceInvoiceAlbumWithRich(d),/network uncertain/);
 assert.deepEqual(d.calls.map(x=>x.method),['editMessageText']);
});
test('failed removal leaves old album state explicit, buyer ledger still unchanged',async()=>{
 const d=deps();d.failDelete(102);
 const r=await replaceInvoiceAlbumWithRich(d);
 assert.equal(r.edited,true);
 assert.equal(r.freePreviewFullyRemoved,false);
 assert.deepEqual(d.calls.map(x=>x.method),['editMessageText','deleteMessage']);
});
