/** VideoBot-only PostgreSQL delivery receipts.
 * The existing GATE / MPB database is not modified. Caller provides a
 * private PostgreSQL connection with query(sql,params) and applies migration.
 * Atomic conditional writes ensure duplicate callback/retry cannot claim
 * the same listing+revision or overwrite an acknowledged message.
 */
const KEY=/^[A-Za-z0-9_-]{1,40}:[1-9][0-9]*$/;
const ID=/^[A-Za-z0-9_-]{1,40}$/;
function validKey(key) {
  if(typeof key!=='string'||!KEY.test(key))throw new Error('invalid delivery key');
  return key;
}
function positiveInt(x,name) {
  if(!Number.isSafeInteger(x)||x<=0)throw new Error('invalid '+name);
  return x;
}
function requireOne(result,reason) {
  if(result?.rowCount!==1)throw new Error(reason);
}
export function createPostgresPostingReceiptStore(pool) {
  if(typeof pool?.query!=='function')throw new Error('private SQL pool required');
  return {
    async claim({key,listingId,revision,topicId}) {
      validKey(key);
      if(typeof listingId!=='string'||!ID.test(listingId)||
         key!==listingId+':'+revision)throw new Error('invalid listing/revision');
      positiveInt(revision,'revision');
      positiveInt(topicId,'verified topic id');
      const r=await pool.query(
        "INSERT INTO videobot_post_receipts (delivery_key,listing_id,revision,topic_id,status) VALUES ($1,$2,$3,$4,'sending') ON CONFLICT (delivery_key) DO NOTHING RETURNING delivery_key",
        [key,listingId,revision,topicId]
      );
      return {claimed:r.rowCount===1};
    },
    async read(key) {
      validKey(key);
      const r=await pool.query(
        "SELECT status,free_message_ids,paid_message_id FROM videobot_post_receipts WHERE delivery_key=$1",
        [key]
      );
      if(!r.rows?.length)return null;
      const row=r.rows[0];
      return {status:row.status,freeMessageIds:row.free_message_ids ?? null,
        paidMessageId:row.paid_message_id==null?null:Number(row.paid_message_id)};
    },
    async recordFree(key,ids) {
      validKey(key);
      if(!Array.isArray(ids)||ids.length!==2||ids.some(id=>!Number.isSafeInteger(id)||id<=0)||ids[0]===ids[1])
        throw new Error('two valid distinct free message IDs required');
      const r=await pool.query(
        "UPDATE videobot_post_receipts SET free_message_ids=$2::bigint[],updated_at=NOW() WHERE delivery_key=$1 AND status='sending' AND free_message_ids IS NULL RETURNING delivery_key",
        [key,ids]
      );
      requireOne(r,'FREE_RECEIPT_STALE');
    },
    async recordPaid(key,id) {
      validKey(key);positiveInt(id,'paid message ID');
      const r=await pool.query(
        "UPDATE videobot_post_receipts SET paid_message_id=$2,status='sent',updated_at=NOW() WHERE delivery_key=$1 AND status='sending' AND free_message_ids IS NOT NULL AND paid_message_id IS NULL RETURNING delivery_key",
        [key,id]
      );
      requireOne(r,'PAID_RECEIPT_STALE');
    },
    async markUnknown(key) {
      validKey(key);
      await pool.query(
        "UPDATE videobot_post_receipts SET status='needs_reconcile',updated_at=NOW() WHERE delivery_key=$1 AND status='sending'",
        [key]
      );
    }
  };
}
