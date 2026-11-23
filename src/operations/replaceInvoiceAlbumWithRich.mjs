import {createPostgresRichOfferReceiptStore} from '../sales/pgRichVideoReceipts.mjs';
import {publishRichVideoListing} from '../telegram/richListingPublisher.mjs';

/** One-time public replacement of the same purchased video without changing
 * seller, SKU, Stars price, entitlement history or financial transactions.
 * Only the superseded three-message INVOICE post may be cleaned up.
 * A historic native Stars paid-media post is never a deletion target.
 */
export async function replaceInvoiceAlbumWithRich({pool,telegramApi,getVerifiedVideoTopic,cleanupOld=true}={}){
 if(typeof pool?.query!=='function'||typeof telegramApi!=='function'||
   typeof getVerifiedVideoTopic!=='function')throw Error('RICH_VIDEO_REISSUE_DEPENDENCIES');
 const id='v26nov24invoice';
 const items=(await pool.query(
  `SELECT l.*,r.delivery_key,r.topic_id,r.status AS old_receipt_status,
          r.sale_mode,r.free_message_ids,r.paid_message_id
     FROM videobot_listings l
     JOIN videobot_post_receipts r ON l.listing_id=r.listing_id
    WHERE l.listing_id=$1 AND r.delivery_key=l.listing_id||':'||l.revision::text`,
  [id])).rows;
 if(items.length!==1)throw Error('RICH_VIDEO_OLD_INVOICE_AMBIGUOUS');
 const old=items[0];
 if(old.status!=='published'||old.sale_mode!=='invoice'||old.old_receipt_status!=='sent'||
   old.rights_verified!==true||old.adult_consent_verified!==true||
   old.fee_terms_accepted_at==null||Number(old.management_fee_bps)!==3000||
   old.fee_policy_id!=='video-admin-30-20261107'||
   !old.paid_video_file_id||!old.thumbnail_file_id||!old.sample_file_id||
   old.sample_file_id===old.paid_video_file_id||
   old.thumbnail_file_id===old.paid_video_file_id||
   !Array.isArray(old.free_message_ids)||old.free_message_ids.length!==2||
   !old.paid_message_id||!Number.isSafeInteger(Number(old.topic_id)))
  throw Error('RICH_VIDEO_OLD_PRODUCT_OR_RIGHTS_NOT_READY');
 const historyBefore=(await pool.query(
  "SELECT COUNT(*)::int AS n FROM videobot_stars_ledger WHERE kind='paid'")).rows[0].n;
 const eligible=(await pool.query(
  `SELECT COUNT(*)::int AS n
    FROM videobot_stars_ledger p
    JOIN videobot_listings prev ON prev.listing_id=p.listing_id
   WHERE p.kind='paid' AND prev.seller_user_id=$1
     AND prev.paid_video_file_id=$2`,
  [old.seller_user_id,old.paid_video_file_id])).rows[0].n;
 if(eligible<1||historyBefore<eligible)throw Error('RICH_VIDEO_HISTORIC_BUYER_NOT_VERIFIED');
 const listing={
   id:old.listing_id,sellerId:String(old.seller_user_id),revision:Number(old.revision),
   title:old.title,description:old.description??'',priceStars:Number(old.price_stars),
   thumbnail:{fileId:old.thumbnail_file_id},sample:{
     fileId:old.sample_file_id,durationSeconds:Number(old.sample_duration_seconds)},
   paidVideo:{fileId:old.paid_video_file_id},rightsVerified:true,
   adultConsentVerified:true,ownerConfirmedPublish:true,
   feeTermsAccepted:true,managementFeeBps:3000
 };
 const store=createPostgresRichOfferReceiptStore(pool);
 const receipt=await publishRichVideoListing({
   listing,store,telegramApi,getVerifiedVideoTopic,
   allowExistingInvoiceReplacement:true
 });
 if(receipt.posted!==true||!Number.isSafeInteger(receipt.richMessageId))
   throw Error('RICH_VIDEO_REISSUE_RECEIPT_INVALID');
 const key=id+':'+listing.revision;
 const confirmed=await store.read(key);
 if(confirmed?.status!=='sent'||confirmed.messageId!==receipt.richMessageId)
   throw Error('RICH_VIDEO_REISSUE_RECEIPT_NOT_DURABLE');
 const historyAfter=(await pool.query(
  "SELECT COUNT(*)::int AS n FROM videobot_stars_ledger WHERE kind='paid'")).rows[0].n;
 if(historyBefore!==historyAfter)throw Error('RICH_VIDEO_PURCHASE_LEDGER_CHANGED');
 const topic=await getVerifiedVideoTopic({purpose:'video_sale',sellerId:listing.sellerId,listingId:id});
 if(topic?.verified!==true||topic?.enabled!==true||topic.purpose!=='video_sale'||
   topic.board!=='video_chat'||topic.id!==Number(old.topic_id))
  throw Error('RICH_VIDEO_CLEANUP_TOPIC_UNVERIFIED');
 const legacyIds=[
   Number(old.paid_message_id),
   ...old.free_message_ids.map(Number).reverse()
 ];
 if(new Set(legacyIds).size!==3||
    legacyIds.some(v=>!Number.isSafeInteger(v)||v<=0||v===receipt.richMessageId))
  throw Error('RICH_VIDEO_OLD_MESSAGE_IDS_INVALID');
 const removal=[];
 if(cleanupOld){
  for(const messageId of legacyIds){
    try{
      const ack=await telegramApi('deleteMessage',{chat_id:topic.chatId,message_id:messageId});
      removal.push({messageId,deleted:ack===true});
      if(ack!==true)break;
    }catch{
      removal.push({messageId,deleted:false});
      break;
    }
  }
 }
 return {posted:true,alreadySent:receipt.alreadySent===true,
  listingId:id,richMessageId:receipt.richMessageId,
  historicBuyerTransactions:eligible,paidLedgerUnchanged:true,
  oldMessages:legacyIds,removed:removal,oldPostFullyRemoved:cleanupOld&&removal.length===3&&
    removal.every(x=>x.deleted===true)};
}
