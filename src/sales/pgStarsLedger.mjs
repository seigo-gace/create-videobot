import {parsePaidMediaPurchase,reconcilePaidMediaPurchase} from './telegramPurchase.mjs';
import {splitStarsExact,MANAGEMENT_FEE_BASIS_POINTS,MANAGEMENT_FEE_POLICY_ID} from './managementFee.mjs';

function owner(id) {
  if(!Number.isSafeInteger(id)||id<=0)throw new Error('invalid Stars ledger owner');
  return id;
}
function safeAmount(value) {
  const n=typeof value==='string' && /^-?[0-9]+$/.test(value) ? Number(value) : value;
  if(!Number.isSafeInteger(n)||n<0)throw new Error('Stars ledger amount outside integer range');
  return n;
}
function validatedResult(result) {
  if(!result||!Array.isArray(result.rows))throw new Error('Stars ledger database unavailable');
  return result.rows;
}
/**
 * Persist only independently corroborated purchase transactions. The update
 * itself contains buyer+payload but no charge amount, so no economic record is
 * created until Telegram getStarTransactions returns matching evidence.
 *
 * Ownership/price are re-read from immutable sale receipts + listings. This
 * module never changes the existing GATE/MPB tables and never pays a creator.
 */
export function createPostgresStarsLedger({pool,telegramApi}={}) {
  if(typeof pool?.query!=='function'||typeof telegramApi!=='function')
    throw new Error('trusted VideoBot ledger and Telegram reader required');
  return {
    async confirmPurchase(update) {
      const key=update?.purchased_paid_media?.paid_media_payload;
      if(typeof key!=='string'||!/^[A-Za-z0-9_-]{1,40}:[1-9][0-9]*$/.test(key))
        throw new Error('invalid Stars purchase product payload');
      const selected=await pool.query(
        "SELECT r.listing_id,l.price_stars,l.seller_user_id,l.management_fee_bps,l.fee_policy_id,l.fee_terms_accepted_at FROM videobot_post_receipts r JOIN videobot_listings l ON l.listing_id=r.listing_id WHERE r.delivery_key=$1 AND r.status='sent' AND r.paid_message_id IS NOT NULL AND l.status IN ('published','paused')",
        [key]
      );
      const result=validatedResult(selected);
      if(result.length!==1)throw new Error('published Stars item receipt not found');
      const listing=result[0];
      if(listing.fee_terms_accepted_at==null || Number(listing.management_fee_bps)!==MANAGEMENT_FEE_BASIS_POINTS ||
         listing.fee_policy_id!==MANAGEMENT_FEE_POLICY_ID)
        throw new Error('seller 30 percent management-fee acceptance missing');
      const purchase=parsePaidMediaPurchase(update,payload=>
        payload===key?{id:listing.listing_id,priceStars:Number(listing.price_stars)}:null
      );
      const verified=await reconcilePaidMediaPurchase({purchase,telegramApi});
      const write=await pool.query(
        "INSERT INTO videobot_stars_ledger (telegram_transaction_id,kind,delivery_key,listing_id,seller_user_id,buyer_user_id,stars,telegram_update_id,management_fee_bps,fee_policy_id) SELECT $2,'paid',r.delivery_key,r.listing_id,l.seller_user_id,$3,$4,$5,l.management_fee_bps,l.fee_policy_id FROM videobot_post_receipts r JOIN videobot_listings l ON l.listing_id=r.listing_id WHERE r.delivery_key=$1 AND r.status='sent' AND r.paid_message_id IS NOT NULL AND l.status IN ('published','paused') AND l.price_stars=$4 AND l.seller_user_id=$6 AND l.fee_terms_accepted_at IS NOT NULL AND l.management_fee_bps=3000 AND l.fee_policy_id='video-admin-30-20261107' ON CONFLICT (telegram_transaction_id,kind) DO NOTHING RETURNING ledger_id",
        [key,verified.telegramTransactionId,verified.buyerId,verified.stars,
          purchase.updateId,listing.seller_user_id]
      );
      if(write?.rowCount===1)return {recorded:true,duplicate:false,listingId:purchase.listingId};
      const existing=await pool.query(
        "SELECT delivery_key,listing_id,seller_user_id,buyer_user_id,stars,management_fee_bps,fee_policy_id FROM videobot_stars_ledger WHERE telegram_transaction_id=$1 AND kind='paid'",
        [verified.telegramTransactionId]
      );
      const rows=validatedResult(existing);
      if(rows.length!==1 || rows[0].delivery_key!==key ||
        rows[0].listing_id!==purchase.listingId ||
        String(rows[0].seller_user_id)!==String(listing.seller_user_id) ||
        String(rows[0].buyer_user_id)!==String(verified.buyerId) ||
        safeAmount(rows[0].stars)!==verified.stars ||
        Number(rows[0].management_fee_bps)!==MANAGEMENT_FEE_BASIS_POINTS ||
        rows[0].fee_policy_id!==MANAGEMENT_FEE_POLICY_ID)
        throw new Error('Stars transaction conflict requires reconciliation');
      return {recorded:true,duplicate:true,listingId:purchase.listingId};
    },
    /** Read-only refund reconciliation. This does NOT call refundStarPayment,
     * transfer Stars or change already-purchased media rights. It records a
     * negative transaction only after the Bot API confirms a matching outgoing
     * reversal for a previously credited purchase.
     */
    async confirmRefund(telegramTransactionId,maxPages=3) {
      if(typeof telegramTransactionId!=='string'||telegramTransactionId.length<1||
         telegramTransactionId.length>256||!Number.isSafeInteger(maxPages)||
         maxPages<1||maxPages>20)throw new Error('invalid refund reconciliation request');
      const paid=await pool.query(
        "SELECT delivery_key,listing_id,seller_user_id,buyer_user_id,stars FROM videobot_stars_ledger WHERE telegram_transaction_id=$1 AND kind='paid'",
        [telegramTransactionId]
      );
      const rows=validatedResult(paid);
      if(rows.length!==1)throw new Error('original verified Stars sale not found');
      const sale=rows[0],expected=safeAmount(sale.stars);
      let refunds=[];
      for(let page=0;page<maxPages;page++) {
        const tx=await telegramApi('getStarTransactions',{offset:page*100,limit:100});
        if(!Array.isArray(tx?.transactions))throw new Error('Telegram refund history unavailable');
        for(const item of tx.transactions) {
          if(item?.id!==telegramTransactionId)continue;
          if(item.receiver?.type==='user'&&
             String(item.receiver.user?.id)===String(sale.buyer_user_id)) {
            refunds.push(item);
          }
        }
        if(tx.transactions.length<100)break;
      }
      if(refunds.length!==1 || refunds[0].amount!==-expected)
        throw new Error('official Stars refund not verified or ambiguous');
      const written=await pool.query(
        "INSERT INTO videobot_stars_ledger (telegram_transaction_id,kind,delivery_key,listing_id,seller_user_id,buyer_user_id,stars,telegram_update_id,management_fee_bps,fee_policy_id) SELECT p.telegram_transaction_id,'refunded',p.delivery_key,p.listing_id,p.seller_user_id,p.buyer_user_id,p.stars,NULL,p.management_fee_bps,p.fee_policy_id FROM videobot_stars_ledger p WHERE p.telegram_transaction_id=$1 AND p.kind='paid' ON CONFLICT(telegram_transaction_id,kind) DO NOTHING RETURNING ledger_id",
        [telegramTransactionId]
      );
      if(written?.rowCount===1)return {recorded:true,duplicate:false};
      const existing=await pool.query(
        "SELECT kind,stars,listing_id,buyer_user_id FROM videobot_stars_ledger WHERE telegram_transaction_id=$1 AND kind='refunded'",
        [telegramTransactionId]
      );
      const matches=validatedResult(existing);
      if(matches.length!==1||matches[0].kind!=='refunded'||safeAmount(matches[0].stars)!==expected||
         matches[0].listing_id!==sale.listing_id||
         String(matches[0].buyer_user_id)!==String(sale.buyer_user_id))
        throw new Error('Stars refund persistence conflict');
      return {recorded:true,duplicate:true};
    },
    /** Seller-only verified gross/net, then exact accounting-only 30/70 quote. */
    async getSummary(ownerId) {
      owner(ownerId);
      const q=await pool.query(
        "SELECT COALESCE(SUM(CASE WHEN kind='paid' THEN stars ELSE 0 END),0) AS gross_stars, COALESCE(SUM(CASE WHEN kind='paid' THEN stars ELSE -stars END),0) AS net_stars FROM videobot_stars_ledger WHERE seller_user_id=$1",
        [ownerId]
      );
      const row=validatedResult(q)[0];
      if(!row)throw new Error('Stars balance query unavailable');
      // "net" is not "withdrawable". Bot owns the actual Stars balance.
      const netRecordedStars=safeAmount(row.net_stars);
      const split=splitStarsExact(netRecordedStars);
      return {grossStars:safeAmount(row.gross_stars),netRecordedStars,
        managementFeeTenths:split.managementFeeTenths,creatorShareTenths:split.creatorShareTenths,
        feePolicyId:MANAGEMENT_FEE_POLICY_ID,payoutReady:false};
    },
    async getHistory(ownerId) {
      owner(ownerId);
      const q=await pool.query(
        "SELECT kind,stars FROM videobot_stars_ledger WHERE seller_user_id=$1 ORDER BY recorded_at DESC,ledger_id DESC LIMIT 10",
        [ownerId]
      );
      return validatedResult(q).map(row=>({
        type:row.kind==='paid'?'sale':row.kind==='refunded'?'refund':'invalid',
        stars:safeAmount(row.stars)
      }));
    }
  };
}
