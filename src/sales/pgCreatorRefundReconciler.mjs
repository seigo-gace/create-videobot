import {MANAGEMENT_FEE_BASIS_POINTS,STICKER_MANAGEMENT_FEE_POLICY_ID} from './managementFee.mjs';

function positive(value,label) {
 const n=typeof value==='string'&&/^[0-9]+$/.test(value)?Number(value):value;
 if(!Number.isSafeInteger(n)||n<1)throw Error('STARS_REFUND_'+label+'_INVALID');
 return n;
}
function rows(result) {
 if(!Array.isArray(result?.rows))throw Error('STARS_REFUND_DATABASE_UNAVAILABLE');
 return result.rows;
}
function validRefundCandidate(tx) {
 return typeof tx?.id==='string'&&tx.id.length>=1&&tx.id.length<=256&&
   Number.isSafeInteger(tx.amount)&&tx.amount<0&&tx.amount>=-25000&&
   (tx.nanostar_amount===undefined||tx.nanostar_amount===0)&&
   tx.receiver?.type==='user'&&
   ['invoice_payment','paid_media_payment'].includes(tx.receiver?.transaction_type)&&
   Number.isSafeInteger(tx.receiver?.user?.id)&&tx.receiver.user.id>0;
}
// Only original payment IDs, official outgoing negative amount, original buyer,
// product-specific transaction type and fee consent can create a reversal.
// Unknown official charges are NOT attributed to another seller.
const ORIGINALS_SQL=`
 SELECT 'sticker_pack'::text AS source,o.order_id,NULL::bigint AS sale_id,
        o.buyer_user_id,o.price_stars AS stars,p.product_id,
        (o.invoice_state='paid' AND o.paid_at IS NOT NULL
         AND o.management_fee_bps=${MANAGEMENT_FEE_BASIS_POINTS}
         AND o.fee_policy_id='${STICKER_MANAGEMENT_FEE_POLICY_ID}'
         AND o.management_fee_tenths=o.price_stars*3
         AND o.creator_share_tenths=o.price_stars*7
         AND p.management_fee_bps=${MANAGEMENT_FEE_BASIS_POINTS}
         AND p.fee_policy_id='${STICKER_MANAGEMENT_FEE_POLICY_ID}'
         AND p.fee_terms_accepted_at IS NOT NULL) AS fee_ok
 FROM videobot_sticker_orders o
 JOIN videobot_sticker_products p ON p.product_id=o.product_id
 WHERE o.telegram_payment_charge_id=$1
 UNION ALL
 SELECT 'sticker_paid_photo'::text AS source,NULL::text AS order_id,s.sale_id,
        s.buyer_user_id,s.stars,p.product_id,
        (s.management_fee_bps=${MANAGEMENT_FEE_BASIS_POINTS}
         AND s.fee_policy_id='${STICKER_MANAGEMENT_FEE_POLICY_ID}'
         AND s.management_fee_tenths=s.stars*3
         AND s.creator_share_tenths=s.stars*7
         AND p.management_fee_bps=${MANAGEMENT_FEE_BASIS_POINTS}
         AND p.fee_policy_id='${STICKER_MANAGEMENT_FEE_POLICY_ID}'
         AND p.fee_terms_accepted_at IS NOT NULL) AS fee_ok
 FROM videobot_sticker_paid_photo_sales s
 JOIN videobot_sticker_products p ON p.product_id=s.product_id
 WHERE s.telegram_transaction_id=$1`;

const INSERT_PACK=`INSERT INTO videobot_sticker_refunds
 (telegram_transaction_id,source,order_id,buyer_user_id,stars,management_fee_tenths,creator_share_tenths)
 SELECT o.telegram_payment_charge_id,'sticker_pack',o.order_id,o.buyer_user_id,o.price_stars,
        o.price_stars*3,o.price_stars*7
 FROM videobot_sticker_orders o
 JOIN videobot_sticker_products p ON p.product_id=o.product_id
 WHERE o.telegram_payment_charge_id=$1 AND o.order_id=$2
   AND o.buyer_user_id=$3 AND o.price_stars=$4 AND o.invoice_state='paid'
   AND o.management_fee_bps=3000 AND o.fee_policy_id='sticker-admin-30-20261113'
   AND o.management_fee_tenths=o.price_stars*3
   AND o.creator_share_tenths=o.price_stars*7
   AND p.management_fee_bps=3000 AND p.fee_policy_id='sticker-admin-30-20261113'
   AND p.fee_terms_accepted_at IS NOT NULL
 ON CONFLICT DO NOTHING RETURNING refund_id`;
const INSERT_PHOTO=`INSERT INTO videobot_sticker_refunds
 (telegram_transaction_id,source,sale_id,buyer_user_id,stars,management_fee_tenths,creator_share_tenths)
 SELECT s.telegram_transaction_id,'sticker_paid_photo',s.sale_id,s.buyer_user_id,s.stars,
        s.stars*3,s.stars*7
 FROM videobot_sticker_paid_photo_sales s
 JOIN videobot_sticker_products p ON p.product_id=s.product_id
 WHERE s.telegram_transaction_id=$1 AND s.sale_id=$2 AND s.buyer_user_id=$3
   AND s.stars=$4 AND s.management_fee_bps=3000
   AND s.fee_policy_id='sticker-admin-30-20261113'
   AND s.management_fee_tenths=s.stars*3
   AND s.creator_share_tenths=s.stars*7
   AND p.management_fee_bps=3000 AND p.fee_policy_id='sticker-admin-30-20261113'
   AND p.fee_terms_accepted_at IS NOT NULL
 ON CONFLICT DO NOTHING RETURNING refund_id`;

/**
 * Read-only Telegram transaction reconciliation; it NEVER initiates a refund,
 * transfers Stars, changes delivery rights, or invents seller payouts.
 *
 * The one existing poller persists a paginated audit cursor. It restarts from
 * offset zero after a complete traversal; partial scans never assert full
 * coverage. Failed scans do not advance the cursor.
 */
export function createPostgresCreatorRefundReconciler({pool,telegramApi,videoLedger}={}){
 if(typeof pool?.query!=='function'||typeof telegramApi!=='function'||
    typeof videoLedger?.confirmRefund!=='function')
  throw Error('STARS_REFUND_TRUSTED_DEPENDENCIES_REQUIRED');
 async function reconcileTransaction(tx){
  if(!validRefundCandidate(tx))return {processed:false};
  const originals=rows(await pool.query(ORIGINALS_SQL,[tx.id]));
  const video=rows(await pool.query(
    "SELECT buyer_user_id,stars FROM videobot_stars_ledger WHERE telegram_transaction_id=$1 AND kind='paid'",
    [tx.id]));
  if(originals.length+video.length>1)
    throw Error('STARS_REFUND_CHARGE_OWNER_COLLISION');
  if(video.length===1){
   const sale=video[0];
   if(tx.receiver.transaction_type!=='paid_media_payment'||
      positive(sale.stars,'VIDEO_PRICE')!==-tx.amount||
      String(sale.buyer_user_id)!==String(tx.receiver.user.id))
    throw Error('STARS_REFUND_VIDEO_EVIDENCE_CONFLICT');
   const outcome=await videoLedger.confirmRefund(tx.id);
   return {processed:true,recorded:outcome.recorded===true,duplicate:outcome.duplicate===true,source:'video'};
  }
  if(!originals.length)return {processed:false};
  const sale=originals[0],invoice=sale.source==='sticker_pack';
  if(sale.fee_ok!==true||positive(sale.stars,'PRICE')!==-tx.amount||
     String(sale.buyer_user_id)!==String(tx.receiver.user.id)||
     tx.receiver.transaction_type!==(invoice?'invoice_payment':'paid_media_payment')||
     (invoice && tx.receiver.invoice_payload!==undefined &&
       tx.receiver.invoice_payload!=='stk:'+sale.order_id)||
     (!invoice && tx.receiver.paid_media_payload!==undefined &&
       tx.receiver.paid_media_payload!=='stkmedia_'+sale.product_id))
    throw Error('STARS_REFUND_STICKER_EVIDENCE_CONFLICT');
  const ref=invoice?sale.order_id:positive(sale.sale_id,'SALE');
  const params=[tx.id,ref,tx.receiver.user.id,-tx.amount];
  const written=await pool.query(invoice?INSERT_PACK:INSERT_PHOTO,params);
  if(written?.rowCount===1)
   return {processed:true,recorded:true,duplicate:false,source:sale.source};
  const prior=rows(await pool.query(
    "SELECT source,order_id,sale_id,buyer_user_id,stars FROM videobot_sticker_refunds WHERE telegram_transaction_id=$1",
    [tx.id]));
  if(prior.length!==1||prior[0].source!==sale.source||
     String(prior[0].buyer_user_id)!==String(sale.buyer_user_id)||
     Number(prior[0].stars)!==-tx.amount||
     (invoice?prior[0].order_id!==sale.order_id:
       String(prior[0].sale_id)!==String(sale.sale_id)))
   throw Error('STARS_REFUND_REPLAY_CONFLICT');
  return {processed:true,recorded:true,duplicate:true,source:sale.source};
 }
 async function scan({maxPages=3,startOffset=0}={}){
  if(!Number.isSafeInteger(maxPages)||maxPages<1||maxPages>20)
   throw Error('STARS_REFUND_PAGE_LIMIT_INVALID');
  if(!Number.isSafeInteger(startOffset)||startOffset<0||startOffset>2_000_000_000)
   throw Error('STARS_REFUND_CURSOR_INVALID');
  let scanned=0,candidates=0,recorded=0,duplicates=0,hasMore=false;
  const seen=new Set();
  for(let page=0;page<maxPages;page++){
   const offset=startOffset+page*100;
   if(offset>2_000_000_000)throw Error('STARS_REFUND_CURSOR_EXHAUSTED');
   const result=await telegramApi('getStarTransactions',{offset,limit:100});
   const transactions=result?.transactions;
   if(!Array.isArray(transactions)||transactions.length>100)
    throw Error('STARS_REFUND_OFFICIAL_HISTORY_UNAVAILABLE');
   for(const tx of transactions){
    scanned++;
    if(!validRefundCandidate(tx))continue;
    if(seen.has(tx.id))continue;
    seen.add(tx.id);candidates++;
    const outcome=await reconcileTransaction(tx);
    if(outcome.recorded){if(outcome.duplicate)duplicates++;else recorded++;}
   }
   if(transactions.length<100){hasMore=false;break;}
   hasMore=page===maxPages-1;
  }
  return {scanned,candidates,recorded,duplicates,coverageComplete:!hasMore};
 }
 return Object.freeze({
  async reconcileTransaction(tx){return reconcileTransaction(tx);},
  async reconcileRecent({maxPages=3}={}){return scan({maxPages});},
  async reconcileIncremental({maxPages=3}={}){
   const fetched=rows(await pool.query(
    'SELECT next_offset FROM videobot_stars_refund_audit_cursor WHERE cursor_id=1'));
   if(fetched.length>1)throw Error('STARS_REFUND_CURSOR_DUPLICATE');
   const startOffset=fetched.length?Number(fetched[0].next_offset):0;
   const result=await scan({maxPages,startOffset});
   const nextOffset=result.coverageComplete?0:startOffset+maxPages*100;
   if(nextOffset>2_000_000_000)throw Error('STARS_REFUND_CURSOR_EXHAUSTED');
   // CAS also rejects a second poller overwriting another running audit.
   const saved=await pool.query(`INSERT INTO videobot_stars_refund_audit_cursor
    (cursor_id,next_offset,last_complete_at) VALUES (1,$1,CASE WHEN $3 THEN NOW() ELSE NULL END)
    ON CONFLICT (cursor_id) DO UPDATE SET next_offset=EXCLUDED.next_offset,
      last_complete_at=CASE WHEN $3 THEN NOW()
        ELSE videobot_stars_refund_audit_cursor.last_complete_at END,
      updated_at=NOW()
    WHERE videobot_stars_refund_audit_cursor.next_offset=$2
    RETURNING next_offset`,[nextOffset,startOffset,result.coverageComplete]);
   if(saved?.rowCount!==1||Number(saved.rows?.[0]?.next_offset)!==nextOffset)
    throw Error('STARS_REFUND_CURSOR_CAS_CONFLICT');
   return {...result,nextOffset};
  }
 });
}
