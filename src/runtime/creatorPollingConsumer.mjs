import {createHash} from 'node:crypto';

/**
 * The SAME CreatorBot update handler is used for Webhook and for long polling.
 * No second Bot, no parallel webhook receiver, no best-effort skips.
 * A successful handler+DB receipt precedes offset advancement.
 */
export function createCreatorPollingConsumer({telegramApi,handleTelegramWebhook,
  webhookSecret,pool}={}){
 if(typeof telegramApi!=='function'||typeof handleTelegramWebhook!=='function'||
    typeof webhookSecret!=='string'||webhookSecret.length<20||
    typeof pool?.query!=='function')
  throw Error('CREATOR_POLL_OWNER_DEPENDENCIES_MISSING');
 let ingressVerified=false;
 async function verifyIngress(){
  const x=await telegramApi('getWebhookInfo',{});
  if(!x||typeof x.url!=='string'||x.url!=='')
    throw Error('CREATOR_POLL_EXISTING_WEBHOOK_MUST_NOT_BE_REPLACED');
  ingressVerified=true;
  return x;
 }
 async function lastOffset(){
  const r=await pool.query(
    "SELECT last_update_id FROM videobot_poll_cursor WHERE consumer_id='createvdobot'");
  return r.rows?.length?Number(r.rows[0].last_update_id):null;
 }
 async function recordOffset(value){
  if(!Number.isSafeInteger(value)||value<0)throw Error('CREATOR_POLL_OFFSET_INVALID');
  const r=await pool.query(`INSERT INTO videobot_poll_cursor(consumer_id,last_update_id)
    VALUES ('createvdobot',$1)
    ON CONFLICT(consumer_id) DO UPDATE SET
     last_update_id=GREATEST(videobot_poll_cursor.last_update_id,EXCLUDED.last_update_id),
     updated_at=NOW() RETURNING last_update_id`,[value]);
  if(r.rowCount!==1||Number(r.rows?.[0]?.last_update_id)<value)
    throw Error('CREATOR_POLL_OFFSET_NOT_DURABLE');
 }
 async function pollBatch({timeout=8}={}){
  if(!ingressVerified)await verifyIngress();
  if(!Number.isSafeInteger(timeout)||timeout<0||timeout>10)
    throw Error('CREATOR_POLL_TIMEOUT_INVALID');
  const last=await lastOffset();
  const updates=await telegramApi('getUpdates',{
    ...(last===null?{}:{offset:last+1}),
    limit:25,timeout,
    allowed_updates:['message','callback_query','pre_checkout_query',
      'purchased_paid_media']
  });
  if(!Array.isArray(updates))throw Error('CREATOR_POLL_RESPONSE_INVALID');
  let accepted=0,quarantined=0;
  for(const update of updates){
   const id=update?.update_id;
   if(!Number.isSafeInteger(id)||id<0)
     throw Error('CREATOR_POLL_UPDATE_ID_INVALID');
   if(last!==null&&id<=last)continue;
   const buf=Buffer.from(JSON.stringify(update));
   if(buf.length>262144)throw Error('CREATOR_POLL_UPDATE_TOO_LARGE');
   // The existing source module's webhook admission claims and commits
   // the same update receipt. It is NOT exposed as an HTTP listener here.
   let result;
   try {
     result=await handleTelegramWebhook({secretHeader:webhookSecret,body:buf});
   } catch(error) {
     if(error?.message!=='WEBHOOK_UPDATE_NEEDS_RECONCILE')throw error;
     // On a second attempt, admission has already recorded this exact
     // update as unknown. Preserve its full original payload privately and
     // durably before advancing the cursor. NEVER re-run its effects here.
     // This prevents one uncertain post/payment from freezing all new DMs.
     const digest=createHash('sha256').update(buf).digest('hex');
     const kept=await pool.query(`INSERT INTO videobot_poll_quarantine
       (update_id,payload_sha256,payload,reason)
       VALUES ($1,$2,$3::jsonb,'WEBHOOK_UPDATE_NEEDS_RECONCILE')
       ON CONFLICT (update_id) DO UPDATE SET updated_at=NOW()
       WHERE videobot_poll_quarantine.payload_sha256=EXCLUDED.payload_sha256
       RETURNING update_id`,[id,digest,buf.toString('utf8')]);
     if(kept?.rowCount!==1 || Number(kept.rows?.[0]?.update_id)!==id)
       throw Error('CREATOR_POLL_QUARANTINE_NOT_DURABLE');
     await recordOffset(id);
     quarantined++;
     continue;
   }
   if(result?.accepted!==true||result.updateId!==id)
     throw Error('CREATOR_POLL_UPDATE_NOT_ACCEPTED');
   await recordOffset(id);
   accepted++;
  }
  return {accepted,quarantined,received:updates.length,lastUpdateId:await lastOffset()};
 }
 return Object.freeze({pollBatch,verifyIngress,lastOffset});
}
