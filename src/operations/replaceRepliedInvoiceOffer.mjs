/**
 * Replace an old reply-linked invoice offer with ONE new reply-free rich message.
 * Keep the same product/delivery key and prior purchasers; do not change
 * historical payments, old native-paid-media, or charge buyers again.
 */
export async function replaceRepliedInvoiceOffer({pool,telegramApi,getVerifiedVideoTopic,deleteOld=true}={}){
 if((typeof pool?.query!=='function'||typeof pool?.connect!=='function')||typeof telegramApi!=='function'||
   typeof getVerifiedVideoTopic!=='function')throw Error('VIDEO_REPLACEMENT_DEPENDENCIES_MISSING');
 const id='v26nov24invoice';
 const items=(await pool.query(
  `SELECT l.*,r.delivery_key,r.topic_id,r.status AS old_receipt_status,
          r.sale_mode,r.free_message_ids,r.paid_message_id
     FROM videobot_listings l
     JOIN videobot_post_receipts r ON l.listing_id=r.listing_id
    WHERE l.listing_id=$1 AND r.delivery_key=l.listing_id||':'||l.revision::text`,[id])).rows;
 if(items.length!==1)throw Error('VIDEO_INPLACE_RECEIPT_AMBIGUOUS');
 const old=items[0];
 const preview=old.free_message_ids?.map(Number);
 const buttonId=Number(old.paid_message_id);
 if(old.status!=='published'||old.sale_mode!=='invoice'||old.old_receipt_status!=='sent'||
   old.rights_verified!==true||old.adult_consent_verified!==true||
   old.fee_terms_accepted_at==null||Number(old.management_fee_bps)!==3000||
   !old.paid_video_file_id||!old.thumbnail_file_id||!old.sample_file_id||
   old.sample_file_id===old.paid_video_file_id||
   old.thumbnail_file_id===old.paid_video_file_id||
   preview?.length!==2||preview.some(x=>!Number.isSafeInteger(x)||x<=0)||
   !Number.isSafeInteger(buttonId)||buttonId<=0||
   new Set([...preview,buttonId]).size!==3||
   !Number.isSafeInteger(Number(old.topic_id))||Number(old.topic_id)<=0)
  throw Error('VIDEO_REPLACEMENT_ORIGINAL_UNVERIFIED');
 const historyBefore=(await pool.query(
  "SELECT COUNT(*)::int AS n FROM videobot_stars_ledger WHERE kind='paid'")).rows[0].n;
 const historic=(await pool.query(
  `SELECT COUNT(*)::int AS n
     FROM videobot_stars_ledger p
     JOIN videobot_listings original ON original.listing_id=p.listing_id
    WHERE p.kind='paid' AND original.seller_user_id=$1
      AND original.paid_video_file_id=$2`,
  [old.seller_user_id,old.paid_video_file_id])).rows[0].n;
 if(historic<1||historyBefore<historic)
  throw Error('VIDEO_REPLACEMENT_BUYERS_UNVERIFIED');
 const topic=await getVerifiedVideoTopic({
  purpose:'video_sale',sellerId:String(old.seller_user_id),listingId:id
 });
 if(topic?.verified!==true||topic?.enabled!==true||topic.purpose!=='video_sale'||
   topic.board!=='video_chat'||topic.id!==Number(old.topic_id)||
   !Number.isSafeInteger(topic.chatId)||topic.chatId>=0||
   !Number.isSafeInteger(topic.threadId)||topic.threadId<=0)
  throw Error('VIDEO_REPLACEMENT_TOPIC_UNVERIFIED');
 const caption=old.title+(old.description?'\n'+old.description:'');
 if(!caption.trim()||caption.length>1024)throw Error('VIDEO_REPLACEMENT_CAPTION_INVALID');
 const action='vid:buy:'+id+':'+old.revision;
 if(Buffer.byteLength(action,'utf8')>64)throw Error('VIDEO_REPLACEMENT_BUTTON_INVALID');
 const label='⭐ '+old.price_stars+' Starsで本編を購入';

 const key=id+':'+old.revision;
 const countOrders=async()=>Number((await pool.query(
  "SELECT COUNT(*)::int AS n FROM videobot_video_invoice_orders WHERE delivery_key=$1",[key])).rows[0].n);
 const ordersBefore=await countOrders();
 if(!Number.isSafeInteger(ordersBefore)||ordersBefore<0)
  throw Error('VIDEO_REPLACEMENT_INVOICE_HISTORY_UNKNOWN');
 const prior=(await pool.query(
  "SELECT status,message_id FROM videobot_rich_offer_receipts WHERE delivery_key=$1",[key])).rows;
 if(prior.length){
  if(prior.length===1 && prior[0].status==='sent' &&
     Number(prior[0].message_id)===buttonId)
   return {alreadyReplaced:true,newMessageId:buttonId,oldRemoved:false};
  throw Error('VIDEO_REPLACEMENT_PRIOR_OUTCOME_REQUIRES_RECONCILE');
 }
 const claimed=await pool.query(
  "INSERT INTO videobot_rich_offer_receipts(delivery_key,listing_id,revision,topic_id,status) VALUES($1,$2,$3,$4,'sending') ON CONFLICT(delivery_key) DO NOTHING RETURNING delivery_key",
  [key,id,Number(old.revision),Number(old.topic_id)]);
 if(claimed.rowCount!==1)throw Error('VIDEO_REPLACEMENT_CLAIM_CONFLICT');
 const request={
  chat_id:topic.chatId,message_thread_id:topic.threadId,
  rich_message:{blocks:[{type:'collage',blocks:[
   {type:'photo',photo:{type:'photo',media:old.thumbnail_file_id,has_spoiler:true}},
   {type:'video',video:{type:'video',media:old.sample_file_id,has_spoiler:true}}
  ],caption:{text:caption}}]},
  reply_markup:{inline_keyboard:[[{text:label,callback_data:action}]]}
 };
 // IMPORTANT: no reply_parameters or reply_to_message_id in new message.
 // Never publish the paid full-video file or create a second invoice order.
 let newId;
 try{
  const sent=await telegramApi('sendRichMessage',request);
  newId=Number(sent?.message_id);
  const collage=sent?.rich_message?.blocks?.find(b=>b?.type==='collage');
  const attached=collage?.blocks;
  const button=sent?.reply_markup?.inline_keyboard?.[0]?.[0];
  if(!Number.isSafeInteger(newId)||newId<=0||newId===buttonId||
     sent?.chat?.id!==topic.chatId||
     (sent.message_thread_id!=null&&sent.message_thread_id!==topic.threadId)||
     sent.reply_to_message!=null||sent.reply_to_message_id!=null||
     sent.media_group_id!=null||!Array.isArray(attached)||attached.length!==2||
     attached[0]?.type!=='photo'||attached[1]?.type!=='video'||
     attached[0]?.has_spoiler!==true||attached[1]?.has_spoiler!==true||
     collage.caption?.text!==caption||
     button?.text!==label||button?.callback_data!==action)
    throw Error('VIDEO_REPLACEMENT_TELEGRAM_ACK_UNKNOWN');
 }catch(err){
  await pool.query(
   "UPDATE videobot_rich_offer_receipts SET status='needs_reconcile',updated_at=NOW() WHERE delivery_key=$1 AND status='sending'",[key]);
  throw err;
 }
 // Only the active public message ID changes. Historical buyer/invoice
 // rows retain exactly the same delivery_key and existing entitlement.
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  const swapped=await client.query(
   "UPDATE videobot_post_receipts SET paid_message_id=$3,updated_at=NOW() WHERE delivery_key=$1 AND paid_message_id=$2 AND status='sent' AND sale_mode='invoice' AND topic_id=$4 RETURNING delivery_key",
   [key,buttonId,newId,Number(old.topic_id)]);
  if(swapped.rowCount!==1)throw Error('VIDEO_REPLACEMENT_OLD_RECEIPT_STALE');
  const rich=await client.query(
   "UPDATE videobot_rich_offer_receipts SET message_id=$2,status='sent',updated_at=NOW() WHERE delivery_key=$1 AND status='sending' AND message_id IS NULL RETURNING delivery_key",
   [key,newId]);
  if(rich.rowCount!==1)throw Error('VIDEO_REPLACEMENT_NEW_RECEIPT_STALE');
  await client.query('COMMIT');
 }catch(err){await client.query('ROLLBACK').catch(()=>{});throw err}
 finally{client.release()}
 const updated=(await pool.query(
  "SELECT paid_message_id,status,sale_mode FROM videobot_post_receipts WHERE delivery_key=$1",[key])).rows[0];
 const receipt=(await pool.query(
  "SELECT message_id,status FROM videobot_rich_offer_receipts WHERE delivery_key=$1",[key])).rows[0];
 const ledgerAfter=(await pool.query(
  "SELECT COUNT(*)::int AS n FROM videobot_stars_ledger WHERE kind='paid'")).rows[0].n;
 if(Number(updated?.paid_message_id)!==newId||updated?.status!=='sent'||
    updated?.sale_mode!=='invoice'||receipt?.status!=='sent'||
    Number(receipt?.message_id)!==newId||ledgerAfter<historyBefore||
    await countOrders()<ordersBefore)
  throw Error('VIDEO_REPLACEMENT_READBACK_KEEP_OLD');
 let oldRemoved=false;
 if(deleteOld){
  try{oldRemoved=(await telegramApi('deleteMessage',{
   chat_id:topic.chatId,message_id:buttonId}))===true}
  catch{oldRemoved=false}
 }
 return {listingId:id,oldMessageId:buttonId,newMessageId:newId,
  replyFree:true,collageAndButtonVerified:true,oldRemoved,
  historicalBuyersPreserved:true,previousBuyerTransactions:historic,
  existingInvoiceOrdersPreserved:true,previousInvoiceOrders:ordersBefore};
}
