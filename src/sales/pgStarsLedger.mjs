import {parsePaidMediaPurchase,reconcilePaidMediaPurchase} from './telegramPurchase.mjs';

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
        "SELECT r.listing_id,l.price_stars,l.seller_user_id FROM videobot_post_receipts r JOIN videobot_listings l ON l.listing_id=r.listing_id WHERE r.delivery_key=$1 AND r.status='sent' AND r.paid_message_id IS NOT NULL AND l.status IN ('published','paused')",
        [key]
      );
      const result=validatedResult(selected);
      if(result.length!==1)throw new Error('published Stars item receipt not found');
      const listing=result[0];
      const purchase=parsePaidMediaPurchase(update,payload=>
        payload===key?{id:listing.listing_id,priceStars:Number(listing.price_stars)}:null
      );
      const verified=await reconcilePaidMediaPurchase({purchase,telegramApi});
      const write=await pool.query(
        "INSERT INTO videobot_stars_ledger (telegram_transaction_id,kind,delivery_key,listing_id,seller_user_id,buyer_user_id,stars,telegram_update_id) SELECT $2,'paid',r.delivery_key,r.listing_id,l.seller_user_id,$3,$4,$5 FROM videobot_post_receipts r JOIN videobot_listings l ON l.listing_id=r.listing_id WHERE r.delivery_key=$1 AND r.status='sent' AND r.paid_message_id IS NOT NULL AND l.status IN ('published','paused') AND l.price_stars=$4 AND l.seller_user_id=$6 ON CONFLICT (telegram_transaction_id,kind) DO NOTHING RETURNING ledger_id",
        [key,verified.telegramTransactionId,verified.buyerId,verified.stars,
          purchase.updateId,listing.seller_user_id]
      );
      if(write?.rowCount===1)return {recorded:true,duplicate:false,listingId:purchase.listingId};
      const existing=await pool.query(
        "SELECT delivery_key,listing_id,seller_user_id,buyer_user_id,stars FROM videobot_stars_ledger WHERE telegram_transaction_id=$1 AND kind='paid'",
        [verified.telegramTransactionId]
      );
      const rows=validatedResult(existing);
      if(rows.length!==1 || rows[0].delivery_key!==key ||
        rows[0].listing_id!==purchase.listingId ||
        String(rows[0].seller_user_id)!==String(listing.seller_user_id) ||
        String(rows[0].buyer_user_id)!==String(verified.buyerId) ||
        safeAmount(rows[0].stars)!==verified.stars)
        throw new Error('Stars transaction conflict requires reconciliation');
      return {recorded:true,duplicate:true,listingId:purchase.listingId};
    },
    /** Seller-specific verified income only. No hypothetical 70/30 or payouts. */
    async getSummary(ownerId) {
      owner(ownerId);
      const q=await pool.query(
        "SELECT COALESCE(SUM(CASE WHEN kind='paid' THEN stars ELSE 0 END),0) AS gross_stars, COALESCE(SUM(CASE WHEN kind='paid' THEN stars ELSE -stars END),0) AS net_stars FROM videobot_stars_ledger WHERE seller_user_id=$1",
        [ownerId]
      );
      const row=validatedResult(q)[0];
      if(!row)throw new Error('Stars balance query unavailable');
      // "net" is not "withdrawable". Bot owns the actual Stars balance.
      return {grossStars:safeAmount(row.gross_stars),netRecordedStars:safeAmount(row.net_stars),
        payoutReady:false};
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
