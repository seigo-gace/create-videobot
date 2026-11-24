import test from 'node:test';
import assert from 'node:assert/strict';
import {replaceRepliedInvoiceOffer} from '../src/operations/replaceRepliedInvoiceOffer.mjs';
const topic={id:3,chatId:-100222,threadId:63,verified:true,enabled:true,
 purpose:'video_sale',board:'video_chat'};
function fixture(){
 const row={listing_id:'v26nov24invoice',revision:1,status:'published',
  sale_mode:'invoice',old_receipt_status:'sent',seller_user_id:1001,
  title:'肉便器',description:'サンプルテスト',price_stars:10,
  thumbnail_file_id:'THUMB',sample_file_id:'SAMPLE',paid_video_file_id:'PRIVATE_FULL',
  rights_verified:true,adult_consent_verified:true,
  fee_terms_accepted_at:'2026-11-23',management_fee_bps:3000,
  topic_id:3,free_message_ids:[101,102],paid_message_id:103};
 let claim=null,mode='normal',oldDeletion=true,allowCutover=true;
 const calls=[];
 const query=async(sql,params=[])=>{
  calls.push({type:'sql',sql,params});
  if(sql.includes('FROM videobot_listings l')&&sql.includes('JOIN videobot_post_receipts r'))
    return {rows:[row]};
  if(sql.includes('JOIN videobot_listings original'))return {rows:[{n:1}]};
  if(sql.includes('FROM videobot_stars_ledger WHERE kind'))return {rows:[{n:1}]};
  if(sql.includes('FROM videobot_video_invoice_orders'))return {rows:[{n:2}]};
  if(sql.includes('SELECT status,message_id FROM videobot_rich_offer_receipts'))return {rows:claim?[claim]:[]};
  if(sql.includes('INSERT INTO videobot_rich_offer_receipts')){
   if(claim)return {rowCount:0};
   claim={status:'sending',message_id:null};return {rowCount:1};
  }
  if(sql.includes("SET status='needs_reconcile'")){claim.status='needs_reconcile';return {rowCount:1}};
  if(sql.includes('SELECT paid_message_id,status,sale_mode FROM videobot_post_receipts'))
   return {rows:[{paid_message_id:row.paid_message_id,status:'sent',sale_mode:'invoice'}]};
  if(sql.includes('SELECT message_id,status FROM videobot_rich_offer_receipts'))return {rows:[claim]};
  throw Error('unexpected SQL '+sql.slice(0,70));
 };
 const pool={query,async connect(){
  return {async query(sql,params=[]){
   calls.push({type:'tx',sql,params});
   if(['BEGIN','COMMIT','ROLLBACK'].includes(sql))return {};
   if(sql.includes('UPDATE videobot_post_receipts')){
    if(!allowCutover)return {rowCount:0};
    row.paid_message_id=params[2];return {rowCount:1};
   }
   if(sql.includes('UPDATE videobot_rich_offer_receipts')){
    claim.status='sent';claim.message_id=params[1];return {rowCount:1};
   }
   throw Error('Unexpected TX SQL');
  },release(){}};
 }};
 const telegramApi=async(method,params)=>{
  calls.push({type:'telegram',method,params});
  if(method==='sendRichMessage'){
   if(mode==='timeout')throw Error('TELEGRAM_UNCERTAIN');
   const collage=params.rich_message.blocks[0];
   return {message_id:104,chat:{id:topic.chatId},message_thread_id:topic.threadId,
    ...(mode==='reply'?{reply_to_message:{message_id:102}}:{}),
    rich_message:{blocks:[{...collage,blocks:collage.blocks.map(x=>({
     ...x,has_spoiler:mode==='uncovered'?false:true}))}]},
    reply_markup:params.reply_markup};
  }
  if(method==='deleteMessage')return oldDeletion;
  throw Error('Unexpected Telegram call '+method);
 };
 return {pool,telegramApi,getVerifiedVideoTopic:async()=>topic,calls,
  get row(){return row},get claim(){return claim},
  setMode(x){mode=x},setCutover(x){allowCutover=x},setDeletion(x){oldDeletion=x}};
}
test('one reply-free RichMessage replaces original active ID while keeping purchases and same delivery key',async()=>{
 const d=fixture(),r=await replaceRepliedInvoiceOffer(d);
 assert.equal(r.newMessageId,104);assert.equal(r.oldMessageId,103);
 assert.equal(r.oldRemoved,true);
 assert.equal(r.historicalBuyersPreserved,true);
 assert.equal(r.existingInvoiceOrdersPreserved,true);
 assert.equal(d.row.paid_message_id,104);
 const calls=d.calls.filter(x=>x.type==='telegram');
 assert.deepEqual(calls.map(x=>x.method),['sendRichMessage','deleteMessage']);
 assert.equal(calls[1].params.message_id,103);
 const send=calls[0].params;
 assert.equal(Object.hasOwn(send,'reply_parameters'),false);
 assert.equal(Object.hasOwn(send,'reply_to_message_id'),false);
 assert.equal(send.reply_markup.inline_keyboard[0][0].callback_data,
  'vid:buy:v26nov24invoice:1');
 assert.deepEqual(send.rich_message.blocks[0].blocks.map(x=>x.type),['photo','video']);
 assert.equal(JSON.stringify(send).includes('PRIVATE_FULL'),false);
 const committed=d.calls.findIndex(x=>x.sql==='COMMIT');
 assert(committed>=0&&d.calls.findIndex(x=>x.method==='deleteMessage')>committed);
 assert.equal(d.claim.status,'sent');
});
test('unknown send blocks reissue and leaves old post intact',async()=>{
 const d=fixture();d.setMode('timeout');
 await assert.rejects(()=>replaceRepliedInvoiceOffer(d),/TELEGRAM_UNCERTAIN/);
 assert.equal(d.claim.status,'needs_reconcile');
 assert.equal(d.row.paid_message_id,103);
 await assert.rejects(()=>replaceRepliedInvoiceOffer(d),/REQUIRES_RECONCILE/);
 assert.deepEqual(d.calls.filter(x=>x.type==='telegram').map(x=>x.method),['sendRichMessage']);
});
test('an acknowledgement with old reply header or uncovered sample never deletes previous purchase post',async()=>{
 for(const mode of ['reply','uncovered']){
  const d=fixture();d.setMode(mode);
  await assert.rejects(()=>replaceRepliedInvoiceOffer(d),/TELEGRAM_ACK_UNKNOWN/);
  assert.equal(d.claim.status,'needs_reconcile');
  assert.equal(d.row.paid_message_id,103);
  assert.equal(d.calls.filter(x=>x.method==='deleteMessage').length,0);
 }
});
test('receipt cutover failure leaves old public post and existing ledger untouched',async()=>{
 const d=fixture();d.setCutover(false);
 await assert.rejects(()=>replaceRepliedInvoiceOffer(d),/OLD_RECEIPT_STALE/);
 assert.equal(d.row.paid_message_id,103);
 assert.equal(d.calls.filter(x=>x.method==='deleteMessage').length,0);
});
test('failed old deletion reports it without repeating the new rich send',async()=>{
 const d=fixture();d.setDeletion(false);
 const r=await replaceRepliedInvoiceOffer(d);
 assert.equal(r.oldRemoved,false);assert.equal(d.row.paid_message_id,104);
 const again=await replaceRepliedInvoiceOffer(d);
 assert.equal(again.alreadyReplaced,true);
 assert.equal(d.calls.filter(x=>x.method==='sendRichMessage').length,1);
});
