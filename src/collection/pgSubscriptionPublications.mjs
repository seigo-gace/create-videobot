/**
 * Persist-first Telegram posting receipts: a lost Telegram acknowledgement
 * must NEVER trigger automatic re-send. There is no fabricated reconciliation.
 */
const kinds=new Set(['member_full','sample']);
function key(v) {
  if(!Number.isSafeInteger(v?.channelId)||v.channelId<=0||
     !Number.isSafeInteger(v?.messageId)||v.messageId<=0||
     !kinds.has(v.kind)) throw Error('SUBSCRIPTION_RECEIPT_KEY_INVALID');
  return [v.channelId,v.messageId,v.kind];
}
export function createPgSubscriptionPublicationStore(pool) {
  if(typeof pool?.query!=='function')throw Error('SUBSCRIPTION_DB_UNAVAILABLE');
  return {
    async read(v) {
      const r=await pool.query(
        'SELECT status,telegram_message_id,target_chat_id,target_thread_id FROM videobot_subscription_publications WHERE source_channel_id=$1 AND source_message_id=$2 AND kind=$3',
        key(v));
      return r.rows[0]??null;
    },
    async claim(v) {
      const keys=key(v);
      if(!Number.isSafeInteger(v.targetChatId)||v.targetChatId>=0||
         (v.targetThreadId!=null&&(!Number.isSafeInteger(v.targetThreadId)||v.targetThreadId<=0)))
        throw Error('SUBSCRIPTION_TARGET_INVALID');
      const r=await pool.query(
        'INSERT INTO videobot_subscription_publications (source_channel_id,source_message_id,kind,target_chat_id,target_thread_id,status) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING kind',
        [...keys,v.targetChatId,v.targetThreadId??null,'sending']);
      return {claimed:r.rowCount===1};
    },
    async sent(v,telegramMessageId) {
      if(!Number.isSafeInteger(telegramMessageId)||telegramMessageId<=0)
        throw Error('SUBSCRIPTION_TELEGRAM_RECEIPT_INVALID');
      const r=await pool.query(
        "UPDATE videobot_subscription_publications SET status='sent',telegram_message_id=$4,updated_at=NOW() WHERE source_channel_id=$1 AND source_message_id=$2 AND kind=$3 AND status='sending' RETURNING kind",
        [...key(v),telegramMessageId]);
      if(r.rowCount!==1)throw Error('SUBSCRIPTION_RECEIPT_UPDATE_UNKNOWN');
    },
    async markUnknown(v) {
      const r=await pool.query(
        "UPDATE videobot_subscription_publications SET status='needs_reconcile',updated_at=NOW() WHERE source_channel_id=$1 AND source_message_id=$2 AND kind=$3 AND status='sending' RETURNING kind",
        key(v));
      return r.rowCount===1;
    },
    async recordPreview({channelId,messageId,storageKey,durationSeconds}) {
      if(typeof storageKey!=='string'||!storageKey.trim()||
         !Number.isFinite(durationSeconds)||durationSeconds<=0||durationSeconds>60)
        throw Error('SUBSCRIPTION_PREVIEW_INVALID');
      const r=await pool.query(
        "INSERT INTO videobot_subscription_previews (source_channel_id,source_message_id,preview_storage_key,duration_seconds,streaming_ready) VALUES ($1,$2,$3,$4,TRUE) ON CONFLICT (source_channel_id,source_message_id) DO UPDATE SET preview_storage_key=EXCLUDED.preview_storage_key,duration_seconds=EXCLUDED.duration_seconds,streaming_ready=TRUE,updated_at=NOW() RETURNING source_message_id",
        [channelId,messageId,storageKey,durationSeconds]);
      return r.rowCount===1;
    }
  };
}
