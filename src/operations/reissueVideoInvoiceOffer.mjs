import {createPostgresListingStore} from '../sales/pgListings.mjs';
import {createPostgresPostingReceiptStore} from '../sales/pgPostingReceipts.mjs';
import {publishVideoListing} from '../telegram/paidListingPublisher.mjs';

// A single documented sale offer, not one paid Telegram message per previous
// test version. Historical ledger rows remain owned by their original receipt.
export const REISSUE_LISTING_ID='v26nov24invoice';

export async function publishReissuedInvoiceOffer({pool,telegramApi,getVerifiedVideoTopic}={}){
 if(typeof pool?.query!=='function'||typeof telegramApi!=='function'||
    typeof getVerifiedVideoTopic!=='function')throw Error('VIDEO_REISSUE_DEPENDENCIES');
 const paid=(await pool.query(
   "SELECT DISTINCT delivery_key FROM videobot_stars_ledger WHERE kind='paid' AND delivery_key IS NOT NULL"
 )).rows;
 if(paid.length!==1)throw Error('VIDEO_REISSUE_PURCHASE_HISTORY_AMBIGUOUS');
 const origin=(await pool.query(
  `SELECT r.delivery_key,r.topic_id,l.*
   FROM videobot_post_receipts r
   JOIN videobot_listings l ON l.listing_id=r.listing_id
   WHERE r.delivery_key=$1 AND r.status='sent' AND r.sale_mode='paid_media'`,
  [paid[0].delivery_key])).rows;
 if(origin.length!==1)throw Error('VIDEO_REISSUE_ORIGINAL_PRODUCT_UNVERIFIED');
 const old=origin[0];
 if(old.rights_verified!==true||old.adult_consent_verified!==true||
    old.fee_terms_accepted_at==null||
    Number(old.management_fee_bps)!==3000||
    !old.paid_video_file_id||!old.thumbnail_file_id||!old.sample_file_id||
    old.sample_file_id===old.paid_video_file_id||
    !(Number(old.sample_duration_seconds)>0)||
    Number(old.sample_duration_seconds)>30)
   throw Error('VIDEO_REISSUE_RIGHTS_OR_MEDIA_NOT_READY');
 const topic=await getVerifiedVideoTopic({
   purpose:'video_sale',sellerId:String(old.seller_user_id),listingId:old.listing_id
 });
 if(topic?.verified!==true||topic?.enabled!==true||
    topic?.purpose!=='video_sale'||topic?.board!=='video_chat'||
    topic.threadId!==Number(old.topic_id))
   throw Error('VIDEO_REISSUE_OWNER_TOPIC_MISMATCH');
 // The original seller, approved media, price, and consent evidence are copied
 // exactly. Nothing in the old product, paid receipt, or ledger is rewritten.
 const inserted=await pool.query(
  `INSERT INTO videobot_listings (
     listing_id,seller_user_id,revision,title,price_stars,price_mode,
     thumbnail_file_id,sample_file_id,sample_duration_seconds,
     paid_video_file_id,rights_verified,adult_consent_verified,status,
     fee_terms_accepted_at,description,creator_terms_version,creator_terms_url,
     management_fee_bps,fee_policy_id)
    SELECT $1,seller_user_id,1,title,price_stars,price_mode,
      thumbnail_file_id,sample_file_id,sample_duration_seconds,
      paid_video_file_id,rights_verified,adult_consent_verified,'ready',
      fee_terms_accepted_at,description,creator_terms_version,creator_terms_url,
      management_fee_bps,fee_policy_id
    FROM videobot_listings
    WHERE listing_id=$2 AND rights_verified=TRUE AND
          adult_consent_verified=TRUE AND fee_terms_accepted_at IS NOT NULL
    ON CONFLICT (listing_id) DO NOTHING RETURNING listing_id`,
  [REISSUE_LISTING_ID,old.listing_id]);
 const store=createPostgresListingStore(pool);
 const listing=await store.getOwned(Number(old.seller_user_id),REISSUE_LISTING_ID);
 if(!listing||listing.paidVideo?.fileId!==old.paid_video_file_id||
    listing.sample?.fileId!==old.sample_file_id||
    listing.thumbnail?.fileId!==old.thumbnail_file_id||
    listing.priceStars!==Number(old.price_stars)||
    listing.status!=='ready'&&listing.status!=='published')
   throw Error('VIDEO_REISSUE_CLONE_NOT_VERIFIED');
 // Only one new persistent offer key; reruns use existing receipts and never
 // post a second invoice/Stars item after an ambiguous Telegram response.
 const receipt=await publishVideoListing({
   listing:{...listing,ownerConfirmedPublish:true},
   getVerifiedVideoTopic,store:createPostgresPostingReceiptStore(pool),
   telegramApi,saleMode:'invoice'
 });
 if(receipt?.posted!==true||!Array.isArray(receipt.freeMessageIds)||
    receipt.freeMessageIds.length!==2||!Number.isSafeInteger(receipt.paidMessageId))
   throw Error('VIDEO_REISSUE_PUBLISH_RECEIPT_INVALID');
 const published=await pool.query(
  `UPDATE videobot_listings SET status='published',updated_at=NOW()
   WHERE listing_id=$1 AND status='ready' RETURNING listing_id`,
  [REISSUE_LISTING_ID]);
 if(published.rowCount!==1&&listing.status!=='published')
   throw Error('VIDEO_REISSUE_PUBLISHED_STATUS_UNKNOWN');
 return {listingId:REISSUE_LISTING_ID,posted:receipt.posted,
   alreadySent:receipt.alreadySent===true,freeMessageIds:receipt.freeMessageIds,
   paidMessageId:receipt.paidMessageId,sourcePaidKey:old.delivery_key};
}
