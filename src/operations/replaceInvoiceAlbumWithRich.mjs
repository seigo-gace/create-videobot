/**
 * Update the CURRENT invoice purchase message in-place.
 * Never create another public listing, change an immutable Stars receipt,
 * touch any purchased native-paid-media message, or force another invoice.
 */
export async function replaceInvoiceAlbumWithRich({pool,telegramApi,getVerifiedVideoTopic,cleanupOld=true}={}){
 if(typeof pool?.query!=='function'||typeof telegramApi!=='function'||
   typeof getVerifiedVideoTopic!=='function')throw Error('VIDEO_INPLACE_DEPENDENCIES_MISSING');
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
  throw Error('VIDEO_INPLACE_ORIGINAL_UNVERIFIED');
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
  throw Error('VIDEO_INPLACE_PREVIOUS_BUYER_UNVERIFIED');
 const topic=await getVerifiedVideoTopic({
  purpose:'video_sale',sellerId:String(old.seller_user_id),listingId:id
 });
 if(topic?.verified!==true||topic?.enabled!==true||topic.purpose!=='video_sale'||
   topic.board!=='video_chat'||topic.id!==Number(old.topic_id)||
   !Number.isSafeInteger(topic.chatId)||topic.chatId>=0||
   !Number.isSafeInteger(topic.threadId)||topic.threadId<=0)
  throw Error('VIDEO_INPLACE_TOPIC_UNVERIFIED');
 const caption=old.title+(old.description?'\n'+old.description:'');
 if(!caption.trim()||caption.length>1024)throw Error('VIDEO_INPLACE_CAPTION_INVALID');
 const action='vid:buy:'+id+':'+old.revision;
 if(Buffer.byteLength(action,'utf8')>64)throw Error('VIDEO_INPLACE_BUTTON_INVALID');
 const label='⭐ '+old.price_stars+' Starsで本編を購入';
 const request={
  chat_id:topic.chatId,message_id:buttonId,
  rich_message:{blocks:[{
    type:'collage',
    blocks:[
      {type:'photo',photo:{type:'photo',media:old.thumbnail_file_id,has_spoiler:true}},
      {type:'video',video:{type:'video',media:old.sample_file_id,has_spoiler:true}}
    ],
    caption:{text:caption}
  }]},
  reply_markup:{inline_keyboard:[[{text:label,callback_data:action}]]}
 };
 // Never call sendRichMessage/sendMessage here. This must preserve the
 // current purchase message ID and cannot post a new offer.
 const edited=await telegramApi('editMessageText',request);
 const actual=edited?.reply_markup?.inline_keyboard?.[0]?.[0];
 const rich=edited?.rich_message?.blocks;
 const collage=Array.isArray(rich)?rich.find(x=>x?.type==='collage'):null;
 const attached=collage?.blocks;
 if(edited?.message_id!==buttonId||edited?.chat?.id!==topic.chatId||
   edited?.media_group_id!=null||
   !Array.isArray(attached)||attached.length!==2||
   attached[0]?.type!=='photo'||attached[1]?.type!=='video'||
   // Telegram's returned RichBlockPhoto/Video place has_spoiler on the
   // block, not on the input's nested InputMedia. Never delete the original
   // covered previews unless BOTH replacement previews are covered.
   attached[0]?.has_spoiler!==true||attached[1]?.has_spoiler!==true||
   collage.caption?.text!==caption||
   actual?.text!==label||actual?.callback_data!==action)
  throw Error('VIDEO_INPLACE_TELEGRAM_ACK_UNKNOWN_KEEP_OLD_ALBUM');
 const historyAfter=(await pool.query(
  "SELECT COUNT(*)::int AS n FROM videobot_stars_ledger WHERE kind='paid'")).rows[0].n;
 if(historyAfter!==historyBefore)throw Error('VIDEO_INPLACE_LEDGER_CHANGED');
 const removed=[];
 if(cleanupOld){
   // Only this listing's free preview members, never the previous
   // native-Starlock posts or their purchased video.
   for(const messageId of [...preview].reverse()){
     try{
       const ack=await telegramApi('deleteMessage',{
         chat_id:topic.chatId,message_id:messageId
       });
       removed.push({messageId,deleted:ack===true});
       if(ack!==true)break;
     }catch{
       removed.push({messageId,deleted:false});break;
     }
   }
 }
 return {
   edited:true,listingId:id,originalPurchaseMessageId:buttonId,
   oneMessageCollageVerified:true,captionVerified:true,oneTapCallbackVerified:true,
   previousBuyerTransactions:historic,ledgerUnchanged:true,
   previewMessageIds:preview,removed,
   freePreviewFullyRemoved:cleanupOld&&removed.length===2&&removed.every(x=>x.deleted===true)
 };
}
