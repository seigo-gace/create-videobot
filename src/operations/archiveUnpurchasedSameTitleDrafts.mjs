/** One-time buyer-safe archive of same-title private draft duplicates.
 * Never removes public sale messages, invoice orders, Stars buyers, or
 * a draft whose delivery or publication outcome is unresolved.
 */
export async function archiveUnpurchasedSameTitleDrafts({pool,anchorId='v26nov24invoice',apply=false}={}){
 if(typeof pool?.connect!=='function'||!/^[A-Za-z0-9_-]{1,40}$/.test(anchorId))
  throw Error('VIDEO_ARCHIVE_REQUIRE_PRIVATE_DATABASE');
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  const anchor=(await client.query(
   'SELECT seller_user_id,title FROM videobot_listings WHERE listing_id=$1 FOR SHARE',[anchorId])).rows;
  if(anchor.length!==1||!anchor[0].seller_user_id||!anchor[0].title)
   throw Error('VIDEO_ARCHIVE_ANCHOR_MISSING');
  const {seller_user_id:owner,title}=anchor[0];
  const all=(await client.query(
   "SELECT COUNT(*)::int AS n FROM videobot_listings WHERE seller_user_id=$1 AND title=$2 AND status<>'removed'",
   [owner,title])).rows[0].n;
  if(!Number.isSafeInteger(all)||all<2||all>15)
   throw Error('VIDEO_ARCHIVE_GROUP_UNVERIFIED');
  const buyer=(await client.query(
   `SELECT (
     EXISTS(SELECT 1 FROM videobot_stars_ledger t JOIN videobot_listings l ON l.listing_id=t.listing_id
       WHERE l.seller_user_id=$1 AND l.title=$2 AND t.kind='paid')
     OR EXISTS(SELECT 1 FROM videobot_video_invoice_orders o JOIN videobot_listings l ON l.listing_id=o.listing_id
       WHERE l.seller_user_id=$1 AND l.title=$2
       AND o.status IN ('paid','delivering','delivered','delivery_unknown'))
   ) AS verified_buyer`,[owner,title])).rows[0]?.verified_buyer;
  if(buyer!==true)throw Error('VIDEO_ARCHIVE_NO_VERIFIED_BUYER_STOP');
  const filter=`l.seller_user_id=$1 AND l.title=$2 AND l.listing_id<>$3
      AND l.status IN ('draft','ready')
      AND NOT EXISTS(SELECT 1 FROM videobot_post_receipts r WHERE r.listing_id=l.listing_id)
      AND NOT EXISTS(SELECT 1 FROM videobot_stars_ledger t WHERE t.listing_id=l.listing_id)
      AND NOT EXISTS(SELECT 1 FROM videobot_video_invoice_orders o WHERE o.listing_id=l.listing_id)
      AND NOT EXISTS(SELECT 1 FROM videobot_creator_sessions s WHERE s.owner_user_id=l.seller_user_id
        AND (s.state->'pendingVideoDraft'->>'listingId'=l.listing_id
        OR (s.state->'draft'->>'listingId'=l.listing_id
          AND s.state->>'publishing' IN ('needs_reconcile','in_progress'))))`;
  const args=[owner,title,anchorId];
  const candidate=(await client.query('SELECT COUNT(*)::int AS n FROM videobot_listings l WHERE '+filter,args)).rows[0].n;
  if(!Number.isSafeInteger(candidate)||candidate<0||candidate>=all)
   throw Error('VIDEO_ARCHIVE_CANDIDATE_UNVERIFIED');
  let archived=0;
  if(apply&&candidate>0){
   const r=await client.query("UPDATE videobot_listings l SET status='removed',revision=revision+1,updated_at=NOW() WHERE "+filter+' RETURNING l.listing_id',args);
   if(r.rowCount!==candidate)throw Error('VIDEO_ARCHIVE_CONCURRENT_CHANGE');
   archived=r.rowCount;
   const checked=(await client.query('SELECT COUNT(*)::int AS n FROM videobot_listings WHERE seller_user_id=$1 AND title=$2 AND status<>\'removed\'',[owner,title])).rows[0].n;
   if(checked!==all-archived)throw Error('VIDEO_ARCHIVE_READBACK_MISMATCH');
  }
  await client.query(apply?'COMMIT':'ROLLBACK');
  return {before:all,eligible:candidate,archived,applied:apply,buyerProtected:true};
 }catch(error){
  await client.query('ROLLBACK').catch(()=>{});
  throw error;
 }finally{client.release()}
}
