import {splitStarsExact,MANAGEMENT_FEE_BASIS_POINTS,MANAGEMENT_FEE_POLICY_ID,STICKER_MANAGEMENT_FEE_POLICY_ID} from './managementFee.mjs';

function owner(id){
 if(!Number.isSafeInteger(id)||id<=0)throw Error('invalid unified Stars seller');
 return id;
}
function amount(value){
 const n=typeof value==='string'&&/^[0-9]+$/.test(value)?Number(value):value;
 if(!Number.isSafeInteger(n)||n<0||n>Number.MAX_SAFE_INTEGER/10)
  throw Error('unified Stars accounting amount invalid');
 return n;
}
function rowsOf(result){
 if(!Array.isArray(result?.rows))throw Error('unified Stars accounting database unavailable');
 return result.rows;
}
/**
 * Read-only projection over THREE immutable payment owners.
 * Video PaidMedia, sticker/emoji XTR invoices and sticker PaidPhoto retain their
 * separate charge keys, ownership checks, refund/fulfilment and delivery logs.
 * This is a creator-wide accounting VIEW, not a new payment ledger or wallet.
 *
 * Never infer a payout from a posted sale: the bot owns its Stars balance.
 */
export const CREATOR_STARS_EVENTS_SQL=`
 SELECT 'video'::text AS source,
        CASE WHEN l.kind='refunded' THEN 'refund' ELSE 'sale' END AS type,
        l.stars, l.recorded_at AS happened_at,
        'video:'||l.ledger_id::text AS event_key,
        (l.management_fee_bps=${MANAGEMENT_FEE_BASIS_POINTS}
         AND l.fee_policy_id='${MANAGEMENT_FEE_POLICY_ID}') AS fee_ok
 FROM videobot_stars_ledger l
 WHERE l.seller_user_id=$1
 UNION ALL
 SELECT 'sticker_pack'::text AS source,'sale'::text AS type,
        o.price_stars AS stars,o.paid_at AS happened_at,
        'sticker_invoice:'||o.order_id AS event_key,
        (o.management_fee_bps=${MANAGEMENT_FEE_BASIS_POINTS}
         AND o.fee_policy_id='${STICKER_MANAGEMENT_FEE_POLICY_ID}'
         AND o.management_fee_tenths=o.price_stars*3
         AND o.creator_share_tenths=o.price_stars*7
         AND p.management_fee_bps=${MANAGEMENT_FEE_BASIS_POINTS}
         AND p.fee_policy_id='${STICKER_MANAGEMENT_FEE_POLICY_ID}'
         AND p.fee_terms_accepted_at IS NOT NULL) AS fee_ok
 FROM videobot_sticker_orders o
 JOIN videobot_sticker_products p ON p.product_id=o.product_id
 WHERE p.seller_user_id=$1 AND o.invoice_state='paid'
   AND o.telegram_payment_charge_id IS NOT NULL AND o.paid_at IS NOT NULL
 UNION ALL
 SELECT 'sticker_paid_photo'::text AS source,'sale'::text AS type,
        s.stars,s.paid_at AS happened_at,
        'sticker_paid_photo:'||s.sale_id::text AS event_key,
        (s.management_fee_bps=${MANAGEMENT_FEE_BASIS_POINTS}
         AND s.fee_policy_id='${STICKER_MANAGEMENT_FEE_POLICY_ID}'
         AND s.management_fee_tenths=s.stars*3
         AND s.creator_share_tenths=s.stars*7
         AND p.management_fee_bps=${MANAGEMENT_FEE_BASIS_POINTS}
         AND p.fee_policy_id='${STICKER_MANAGEMENT_FEE_POLICY_ID}'
         AND p.fee_terms_accepted_at IS NOT NULL) AS fee_ok
 FROM videobot_sticker_paid_photo_sales s
 JOIN videobot_sticker_products p ON p.product_id=s.product_id
 WHERE p.seller_user_id=$1`;

const SUMMARY_SQL=`WITH events AS (${CREATOR_STARS_EVENTS_SQL})
SELECT COALESCE(SUM(CASE WHEN type='sale' THEN stars ELSE 0 END),0) AS gross_stars,
       COALESCE(SUM(CASE WHEN type='sale' THEN stars ELSE -stars END),0) AS net_stars,
       COALESCE(SUM(CASE WHEN type='sale' AND source='video' THEN stars ELSE 0 END),0) AS video_gross_stars,
       COALESCE(SUM(CASE WHEN type='sale' AND source<>'video' THEN stars ELSE 0 END),0) AS sticker_gross_stars,
       COALESCE(BOOL_AND(fee_ok),TRUE) AS fees_valid
FROM events`;
const HISTORY_SQL=`WITH events AS (${CREATOR_STARS_EVENTS_SQL})
SELECT source,type,stars,fee_ok FROM events
ORDER BY happened_at DESC,event_key DESC LIMIT 10`;

export function createPostgresUnifiedStarsSales({pool}={}){
 if(typeof pool?.query!=='function')throw Error('unified Stars accounting pool required');
 return Object.freeze({
  async getSummary(sellerId){
   const found=rowsOf(await pool.query(SUMMARY_SQL,[owner(sellerId)]));
   if(found.length!==1)throw Error('unified Stars summary unavailable');
   const r=found[0];
   if(r.fees_valid!==true)throw Error('unified Stars fee agreement requires reconciliation');
   const grossStars=amount(r.gross_stars),netRecordedStars=amount(r.net_stars);
   const videoGrossStars=amount(r.video_gross_stars),stickerGrossStars=amount(r.sticker_gross_stars);
   if(netRecordedStars>grossStars || videoGrossStars+stickerGrossStars!==grossStars)
    throw Error('unified Stars accounting mismatch');
   const fee=splitStarsExact(netRecordedStars);
   return {grossStars,netRecordedStars,videoGrossStars,stickerGrossStars,
    managementFeeTenths:fee.managementFeeTenths,creatorShareTenths:fee.creatorShareTenths,
    // A creator's share is an obligation, NOT an officially transferable wallet.
    payoutReady:false};
  },
  async getHistory(sellerId){
   const found=rowsOf(await pool.query(HISTORY_SQL,[owner(sellerId)]));
   return found.map(row=>{
    if(row.fee_ok!==true)throw Error('unified Stars fee agreement requires reconciliation');
    if(!['video','sticker_pack','sticker_paid_photo'].includes(row.source)||
       !['sale','refund'].includes(row.type)||
       (row.type==='refund'&&row.source!=='video'))
      throw Error('unified Stars history event invalid');
    const stars=amount(row.stars);
    if(stars<1)throw Error('unified Stars history amount invalid');
    return {type:row.type,stars,source:row.source};
   });
  }
 });
}
