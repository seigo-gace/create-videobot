const FINGERPRINT=/^[a-f0-9]{64}$/;
function updateId(id) {
  if(!Number.isSafeInteger(id)||id<0)throw new Error('invalid Telegram update ID');
  return id;
}
function fingerprint(hex) {
  if(typeof hex!=='string'||!FINGERPRINT.test(hex))throw new Error('invalid webhook fingerprint');
  return hex;
}
/**
 * Bot-owned PostgreSQL CAS for each Telegram webhook update.
 *
 * Completed updates replay as harmless acknowledgments. In-progress or
 * unknown-result updates cannot be claimed again. Operators must reconcile
 * them from existing product/receipt/ledger evidence before any retry.
 */
export function createPostgresWebhookUpdateStore(pool) {
 if(typeof pool?.query!=='function')throw new Error('private webhook SQL pool required');
 return {
  async claim(id,digest,{recoverStickerPayment=false}={}) {
   updateId(id);fingerprint(digest);
   const added=await pool.query(
     "INSERT INTO videobot_webhook_updates (update_id,payload_sha256,status) VALUES ($1,$2,'processing') ON CONFLICT (update_id) DO NOTHING RETURNING update_id",
     [id,digest]
   );
   if(added?.rowCount===1)return {claimed:true};
   const prev=await pool.query(
     "SELECT payload_sha256,status,handled FROM videobot_webhook_updates WHERE update_id=$1",
     [id]
   );
   if(prev?.rows?.length!==1)throw new Error('WEBHOOK_UPDATE_STATE_UNKNOWN');
   const row=prev.rows[0];
   if(row.payload_sha256!==digest)throw new Error('WEBHOOK_UPDATE_FINGERPRINT_CONFLICT');
   if(row.status==='completed'&&typeof row.handled==='boolean')
     return {claimed:false,completed:true,handled:row.handled};
   // A Telegram successful_payment has a stable charge ID and is captured
   // idempotently in the independent sticker ledger. Only that exact payload
   // may be safely retried after a known failed handler.
   if(recoverStickerPayment===true&&row.status==='needs_reconcile'){
     const recovered=await pool.query(
       "UPDATE videobot_webhook_updates SET status='processing',updated_at=NOW()"+
       " WHERE update_id=$1 AND payload_sha256=$2 AND status='needs_reconcile'"+
       " AND handled IS NULL RETURNING update_id",[id,digest]);
     if(recovered.rowCount===1)return {claimed:true,recovered:true};
   }
   throw new Error('WEBHOOK_UPDATE_NEEDS_RECONCILE');
  },
  async complete(id,handled) {
   updateId(id);
   if(typeof handled!=='boolean')throw new Error('invalid webhook completion');
   const r=await pool.query(
     "UPDATE videobot_webhook_updates SET status='completed',handled=$2,updated_at=NOW() WHERE update_id=$1 AND status='processing' AND handled IS NULL RETURNING update_id",
     [id,handled]
   );
   if(r?.rowCount!==1)throw new Error('WEBHOOK_UPDATE_COMPLETION_STALE');
  },
  async markUnknown(id) {
   updateId(id);
   const r=await pool.query(
     "UPDATE videobot_webhook_updates SET status='needs_reconcile',updated_at=NOW() WHERE update_id=$1 AND status='processing' RETURNING update_id",
     [id]
   );
   if(r?.rowCount!==1)throw new Error('WEBHOOK_UPDATE_RECONCILE_REQUIRED');
  }
 };
}
