import {randomBytes} from 'node:crypto';
const ORDER=/^vi_[a-f0-9]{24}$/;
const SKU=/^[A-Za-z0-9_-]{1,40}$/;
const pos=x=>Number.isSafeInteger(x)&&x>0;
function keyId(id){if(typeof id!=='string'||!ORDER.test(id))throw Error('VIDEO_INVOICE_ORDER_INVALID');return id;}
function cleanRow(r){
 if(!r)return null;
 return {orderId:r.order_id,status:r.status,priceStars:Number(r.price_stars),
   title:r.title,listingId:r.listing_id,buyerId:Number(r.buyer_user_id)};
}
function first(r){return r?.rows?.[0]??null;}
function affected(r){return r?.rowCount===1;}
/**
 * CreateVdobot-only durable video invoice orders. No sticker rows, no GATE DB.
 * One order per listing/revision/buyer; all remote I/O is preceded by a claim.
 */
export function createPostgresVideoInvoiceStore(pool){
 if(typeof pool?.query!=='function')throw Error('VIDEO_INVOICE_DB_REQUIRED');
 return {
  async claimLegacyDelivery({buyerId,listingId,revision,buyerInitiated=false}){
   if(!pos(buyerId)||typeof listingId!=='string'||!SKU.test(listingId)||!pos(revision))
     throw Error('VIDEO_LEGACY_BUYER_INVALID');
   // Compare the verified original purchaser, seller, and exact full video
   // reference. This cannot authorize a different seller's product or sample.
   const r=await pool.query(
    `WITH active_offers AS (
       SELECT delivery_key,listing_id,revision FROM videobot_post_receipts
        WHERE status='sent' AND sale_mode='invoice' AND paid_message_id IS NOT NULL
       UNION
       SELECT delivery_key,listing_id,revision FROM videobot_rich_offer_receipts
        WHERE status='sent' AND message_id IS NOT NULL
     ), eligible AS (
       SELECT r.delivery_key,l.paid_video_file_id AS video_file_id,l.title,
              p.telegram_transaction_id
       FROM active_offers r
       JOIN videobot_listings l ON l.listing_id=r.listing_id
       JOIN videobot_stars_ledger p ON p.buyer_user_id=$1 AND p.kind='paid'
       JOIN videobot_listings old_l ON old_l.listing_id=p.listing_id
         AND old_l.seller_user_id=l.seller_user_id
         AND old_l.paid_video_file_id=l.paid_video_file_id
       WHERE r.listing_id=$2 AND r.revision=$3
         AND l.status='published' AND l.rights_verified=TRUE
         AND l.adult_consent_verified=TRUE AND l.fee_terms_accepted_at IS NOT NULL
         AND l.paid_video_file_id IS NOT NULL
       ORDER BY p.telegram_transaction_id LIMIT 1
     ), claimed AS (
       INSERT INTO videobot_video_legacy_deliveries
         (delivery_key,buyer_user_id,original_telegram_transaction_id,
          video_file_id,title,status)
       SELECT delivery_key,$1,telegram_transaction_id,video_file_id,title,
              'delivering' FROM eligible
       ON CONFLICT (delivery_key,buyer_user_id) DO NOTHING
       RETURNING delivery_key
     )
     SELECT e.delivery_key,e.video_file_id,e.title,
            EXISTS(SELECT 1 FROM claimed) AS claimed
     FROM eligible e`,
    [buyerId,listingId,revision]);
   const x=first(r);
   if(!x)return {legacy:false};
   let claimed=x.claimed===true;
   // A previous Telegram timeout/unknown acknowledgement must never
   // trigger an automatic retry. The verified buyer may explicitly reopen
   // the offer in the Bot DM to ask for the same paid video again at no cost.
   if(!claimed && buyerInitiated===true){
     const retry=await pool.query(
       `UPDATE videobot_video_legacy_deliveries d
         SET status='delivering',updated_at=NOW()
        WHERE d.delivery_key=$1 AND d.buyer_user_id=$2
          AND d.status='delivery_unknown'
          AND d.video_file_id=$3
          AND EXISTS (SELECT 1 FROM videobot_stars_ledger p
                      WHERE p.telegram_transaction_id=d.original_telegram_transaction_id
                        AND p.buyer_user_id=$2 AND p.kind='paid')
        RETURNING d.delivery_key`,
       [x.delivery_key,buyerId,x.video_file_id]);
     claimed=retry.rowCount===1;
   }
   return {legacy:true,claimed,
     deliveryKey:x.delivery_key,fileId:x.video_file_id,title:x.title};
  },
  async markLegacyDelivered({deliveryKey,buyerId,messageId}){
   if(typeof deliveryKey!=='string'||!pos(buyerId)||!pos(messageId))
     throw Error('VIDEO_LEGACY_DELIVERY_INVALID');
   const r=await pool.query(
    `UPDATE videobot_video_legacy_deliveries
     SET status='delivered',delivered_message_id=$3,updated_at=NOW()
     WHERE delivery_key=$1 AND buyer_user_id=$2 AND status='delivering'
     RETURNING delivery_key`,
    [deliveryKey,buyerId,messageId]);
   if(!affected(r))throw Error('VIDEO_LEGACY_DELIVERY_PERSIST_UNKNOWN');
  },
  async markLegacyUnknown({deliveryKey,buyerId}){
   if(typeof deliveryKey!=='string'||!pos(buyerId))
     throw Error('VIDEO_LEGACY_DELIVERY_INVALID');
   await pool.query(
    `UPDATE videobot_video_legacy_deliveries
     SET status='delivery_unknown',updated_at=NOW()
     WHERE delivery_key=$1 AND buyer_user_id=$2 AND status='delivering'`,
    [deliveryKey,buyerId]);
  },
  async reserve({buyerId,listingId,revision}){
   if(!pos(buyerId)||typeof listingId!=='string'||!SKU.test(listingId)||!pos(revision))
     throw Error('VIDEO_INVOICE_RESERVE_INVALID');
   const key=listingId+':'+revision;
   const result=await pool.query(
    `WITH active_offers AS (
       SELECT delivery_key,listing_id,revision FROM videobot_post_receipts
        WHERE status='sent' AND sale_mode='invoice' AND paid_message_id IS NOT NULL
       UNION
       SELECT delivery_key,listing_id,revision FROM videobot_rich_offer_receipts
        WHERE status='sent' AND message_id IS NOT NULL
     )
     INSERT INTO videobot_video_invoice_orders
     (order_id,delivery_key,listing_id,buyer_user_id,seller_user_id,price_stars,video_file_id,title,status)
     SELECT $1,r.delivery_key,l.listing_id,$2,l.seller_user_id,
            l.price_stars,l.paid_video_file_id,l.title,'prepared'
       FROM active_offers r JOIN videobot_listings l ON l.listing_id=r.listing_id
      WHERE r.delivery_key=$3
        AND l.status='published' AND l.rights_verified=TRUE
        AND l.adult_consent_verified=TRUE AND l.paid_video_file_id IS NOT NULL
        AND l.price_stars BETWEEN 1 AND 25000 AND l.fee_terms_accepted_at IS NOT NULL
        AND l.management_fee_bps=3000 AND l.fee_policy_id='video-admin-30-20261107'
     ON CONFLICT (delivery_key,buyer_user_id) DO UPDATE
       SET updated_at=videobot_video_invoice_orders.updated_at
     RETURNING *`,
    ['vi_'+randomBytes(12).toString('hex'),buyerId,key]);
   const resultRow=cleanRow(first(result));
   if(!resultRow)throw Error('VIDEO_INVOICE_OFFER_NOT_PUBLISHED');
   return resultRow;
  },
  async markSending({orderId,buyerId}){
   keyId(orderId);if(!pos(buyerId))throw Error('VIDEO_INVOICE_BUYER_INVALID');
   const r=await pool.query(
    "UPDATE videobot_video_invoice_orders SET status='sending',updated_at=NOW() WHERE order_id=$1 AND buyer_user_id=$2 AND status='prepared' RETURNING *",
    [orderId,buyerId]);
   return cleanRow(first(r));
  },
  async markInvoiceSent({orderId,messageId}){
   keyId(orderId);if(!pos(messageId))throw Error('VIDEO_INVOICE_MESSAGE_INVALID');
   const r=await pool.query(
    "UPDATE videobot_video_invoice_orders SET status='sent',invoice_message_id=$2,updated_at=NOW() WHERE order_id=$1 AND status='sending' RETURNING order_id",
    [orderId,messageId]);
   if(!affected(r))throw Error('VIDEO_INVOICE_SENT_STATE_UNKNOWN');
  },
  async markInvoiceUnknown({orderId}){
   keyId(orderId);
   await pool.query(
    "UPDATE videobot_video_invoice_orders SET status='invoice_unknown',updated_at=NOW() WHERE order_id=$1 AND status='sending'",
    [orderId]);
  },
  async verifyCheckout({orderId,buyerId,amount}){
   if(!ORDER.test(orderId??'')||!pos(buyerId)||!pos(amount))return false;
   const r=await pool.query(
    "SELECT 1 FROM videobot_video_invoice_orders WHERE order_id=$1 AND buyer_user_id=$2 AND status IN ('sent','invoice_unknown') AND price_stars=$3",
    [orderId,buyerId,amount]);
   return r.rows?.length===1;
  },
  async capturePayment({orderId,buyerId,payment,updateId}){
   keyId(orderId);if(!pos(buyerId)||!Number.isSafeInteger(updateId)||updateId<0||
       payment?.currency!=='XTR'||!pos(payment.total_amount)||
       payment.invoice_payload!=='vid:'+orderId||
       typeof payment.telegram_payment_charge_id!=='string'||
       !payment.telegram_payment_charge_id.length)
     throw Error('VIDEO_INVOICE_PAYMENT_INVALID');
   const charge=payment.telegram_payment_charge_id;
   // Charge acknowledgement and 70/30 sale ledger are one SQL statement:
   // a ledger error rolls back the order state instead of losing revenue.
   const written=await pool.query(
    `WITH paid AS (
       UPDATE videobot_video_invoice_orders
         SET status='paid',telegram_payment_charge_id=$3,
             telegram_update_id=$4,updated_at=NOW()
       WHERE order_id=$1 AND buyer_user_id=$2 AND price_stars=$5
         AND status IN ('sent','invoice_unknown')
         AND telegram_payment_charge_id IS NULL
       RETURNING *
     ), credited AS (
       INSERT INTO videobot_stars_ledger
         (telegram_transaction_id,kind,delivery_key,listing_id,seller_user_id,
          buyer_user_id,stars,telegram_update_id,management_fee_bps,fee_policy_id)
       SELECT p.telegram_payment_charge_id,'paid',p.delivery_key,p.listing_id,
              p.seller_user_id,p.buyer_user_id,p.price_stars,p.telegram_update_id,
              l.management_fee_bps,l.fee_policy_id
         FROM paid p JOIN videobot_listings l ON l.listing_id=p.listing_id
        WHERE l.fee_terms_accepted_at IS NOT NULL AND l.management_fee_bps=3000
          AND l.fee_policy_id='video-admin-30-20261107'
       RETURNING ledger_id
     )
     SELECT p.order_id FROM paid p WHERE (SELECT COUNT(*) FROM credited)=1`,
    [orderId,buyerId,charge,updateId,payment.total_amount]);
   if(affected(written))return {duplicate:false,orderId};
   const r=await pool.query(
    "SELECT telegram_payment_charge_id,price_stars,status FROM videobot_video_invoice_orders WHERE order_id=$1 AND buyer_user_id=$2",
    [orderId,buyerId]);
   const prev=first(r);
   if(!prev||prev.telegram_payment_charge_id!==charge||
      Number(prev.price_stars)!==payment.total_amount||
      !['paid','delivering','delivered','delivery_unknown'].includes(prev.status))
     throw Error('VIDEO_INVOICE_PAYMENT_CONFLICT');
   return {duplicate:true,orderId};
  },
  async allowBuyerDeliveryRetry({orderId,buyerId}){
   // Payment stays recorded; only an explicit buyer-initiated redelivery
   // after an uncertain Telegram send may unlock another attempt.
   keyId(orderId);if(!pos(buyerId))throw Error('VIDEO_INVOICE_BUYER_INVALID');
   const r=await pool.query(
     "UPDATE videobot_video_invoice_orders SET status='paid',updated_at=NOW() WHERE order_id=$1 AND buyer_user_id=$2 AND status='delivery_unknown' AND telegram_payment_charge_id IS NOT NULL RETURNING order_id",
     [orderId,buyerId]);
   return r.rowCount===1;
  },
  async claimDelivery({orderId,buyerId}){
   keyId(orderId);if(!pos(buyerId))throw Error('VIDEO_INVOICE_BUYER_INVALID');
   const r=await pool.query(
    `UPDATE videobot_video_invoice_orders
     SET status='delivering',updated_at=NOW()
     WHERE order_id=$1 AND buyer_user_id=$2 AND status='paid'
       AND telegram_payment_charge_id IS NOT NULL
     RETURNING video_file_id,title`,
    [orderId,buyerId]);
   const item=first(r);
   return item?{fileId:item.video_file_id,title:item.title}:null;
  },
  async markDelivered({orderId,messageId}){
   keyId(orderId);if(!pos(messageId))throw Error('VIDEO_INVOICE_DELIVERY_ID_INVALID');
   const r=await pool.query(
    "UPDATE videobot_video_invoice_orders SET status='delivered',delivered_message_id=$2,updated_at=NOW() WHERE order_id=$1 AND status='delivering' RETURNING order_id",
    [orderId,messageId]);
   if(!affected(r))throw Error('VIDEO_INVOICE_DELIVERY_PERSIST_UNKNOWN');
  },
  async markDeliveryUnknown({orderId}){
   keyId(orderId);
   await pool.query(
    "UPDATE videobot_video_invoice_orders SET status='delivery_unknown',updated_at=NOW() WHERE order_id=$1 AND status='delivering'",
    [orderId]);
  }
 };
}
