import {createHash} from 'node:crypto';

function safeId(x){return Number.isSafeInteger(x)&&x>0;}
export function creatorOwnerUpdate(update){
 const message=update?.message??update?.callback_query?.message;
 const sender=update?.message?.from??update?.callback_query?.from;
 if(!message||message.chat?.type!=='private'||!safeId(message.chat?.id)||
    message.chat.id!==sender?.id)return null;
 // Payment delivery bypasses owner DM worker. The existing payment ledger and
 // pre-checkout responder remain on the immediate ordered ingress path.
 if(update?.message?.successful_payment)return null;
 return sender.id;
}
export function creatorUpdateJobKind(update){
 const msg=update?.message;
 if(msg?.video||msg?.document?.mime_type==='video/mp4')return 'heavy';
 const data=update?.callback_query?.data;
 if(typeof data==='string'&&
   (/^menu:listing(?:\|r[0-9]+)?$/.test(data)||
    /^(?:preview:|review:edit|edit:paidVideo)/.test(data)))return 'heavy';
 return 'normal';
}

/** Private SQL outbox owned by the ONE polling process.
 * Persistent enqueue precedes Telegram offset advancement, while the existing
 * webhook receipt still guards outbound effects. A crashed in-progress update
 * must never be blindly repeated.
 */
export function createPostgresOwnerUpdateQueue(pool,{maxPending=1000}={}){
 if(typeof pool?.query!=='function'||!Number.isSafeInteger(maxPending)||
    maxPending<1||maxPending>10000)throw Error('OWNER_JOB_QUEUE_CONFIG_INVALID');
 async function enqueue(update){
  const id=update?.update_id,owner=creatorOwnerUpdate(update);
  if(!Number.isSafeInteger(id)||id<0||!safeId(owner))
    throw Error('OWNER_JOB_ENQUEUE_INVALID');
  const payload=JSON.stringify(update);
  if(Buffer.byteLength(payload)>262144)throw Error('OWNER_JOB_PAYLOAD_TOO_LARGE');
  const digest=createHash('sha256').update(payload).digest('hex');
  const previous=await pool.query(
   'SELECT payload_sha256,owner_id FROM videobot_owner_update_jobs WHERE update_id=$1',[id]);
  if(previous.rows?.length){
   const row=previous.rows[0];
   if(row.payload_sha256!==digest||Number(row.owner_id)!==owner)
     throw Error('OWNER_JOB_FINGERPRINT_CONFLICT');
   return {enqueued:true,duplicate:true,updateId:id};
  }
  const pending=await pool.query(
   "SELECT COUNT(*)::integer AS count FROM videobot_owner_update_jobs WHERE status IN ('queued','running')"
  );
  if(Number(pending.rows?.[0]?.count)>=maxPending)
    throw Error('OWNER_JOB_BACKPRESSURE');
  const kind=creatorUpdateJobKind(update);
  const insert=await pool.query(
   `INSERT INTO videobot_owner_update_jobs
     (update_id,owner_id,job_kind,payload_sha256,payload,status)
     VALUES($1,$2,$3,$4,$5::jsonb,'queued')
     ON CONFLICT(update_id) DO UPDATE SET updated_at=videobot_owner_update_jobs.updated_at
     WHERE videobot_owner_update_jobs.payload_sha256=EXCLUDED.payload_sha256
       AND videobot_owner_update_jobs.owner_id=EXCLUDED.owner_id
     RETURNING update_id`,
   [id,owner,kind,digest,payload]);
  if(insert.rowCount!==1||Number(insert.rows?.[0]?.update_id)!==id)
    throw Error('OWNER_JOB_FINGERPRINT_CONFLICT');
  return {enqueued:true,updateId:id,jobKind:kind};
 }
 async function recover(){
  const completed=await pool.query(`UPDATE videobot_owner_update_jobs j
    SET status='completed',completed_at=NOW(),updated_at=NOW()
    WHERE j.status='running'
      AND EXISTS (SELECT 1 FROM videobot_webhook_updates w
        WHERE w.update_id=j.update_id AND w.status='completed')
    RETURNING update_id`);
  const unstarted=await pool.query(`UPDATE videobot_owner_update_jobs j
    SET status='queued',started_at=NULL,updated_at=NOW()
    WHERE j.status='running'
      AND NOT EXISTS (SELECT 1 FROM videobot_webhook_updates w
        WHERE w.update_id=j.update_id)
    RETURNING update_id`);
  const ambiguous=await pool.query(`UPDATE videobot_owner_update_jobs
    SET status='needs_reconcile',updated_at=NOW()
    WHERE status='running' RETURNING update_id`);
  return {confirmed:completed.rowCount??0,unstarted:unstarted.rowCount??0,
    needsReconcile:ambiguous.rowCount??0};
 }
 let claimChain=Promise.resolve();
 async function claimSql(){
  const r=await pool.query(`WITH candidate AS (
    SELECT j.update_id FROM videobot_owner_update_jobs j
    WHERE j.status='queued'
      AND NOT EXISTS (SELECT 1 FROM videobot_owner_update_jobs earlier
       WHERE earlier.owner_id=j.owner_id AND earlier.update_id<j.update_id
        AND earlier.status IN ('queued','running','needs_reconcile'))
      AND (j.job_kind<>'heavy' OR NOT EXISTS
       (SELECT 1 FROM videobot_owner_update_jobs h
         WHERE h.status='running' AND h.job_kind='heavy'))
    ORDER BY j.update_id LIMIT 1 FOR UPDATE OF j SKIP LOCKED
   ) UPDATE videobot_owner_update_jobs j
   SET status='running',started_at=NOW(),updated_at=NOW()
   FROM candidate c WHERE j.update_id=c.update_id
   RETURNING j.update_id,j.owner_id,j.job_kind,j.payload`);
  if(r.rowCount===0)return null;
  if(r.rowCount!==1)throw Error('OWNER_JOB_CLAIM_CONFLICT');
  const row=r.rows[0];
  return {id:Number(row.update_id),ownerId:Number(row.owner_id),
    kind:row.job_kind,update:row.payload};
 }
 // Serialise claims in the only polling process, so the first heavy job
 // commits its running state before the next selector sees the quota.
 function claim(){
  const next=claimChain.then(()=>claimSql());
  claimChain=next.then(()=>undefined,()=>undefined);
  return next;
 }
 async function completed(job){
  const r=await pool.query(`UPDATE videobot_owner_update_jobs
   SET status='completed',completed_at=NOW(),updated_at=NOW()
   WHERE update_id=$1 AND owner_id=$2 AND status='running'
   RETURNING update_id`,[job.id,job.ownerId]);
  if(r.rowCount!==1)throw Error('OWNER_JOB_COMPLETION_NOT_DURABLE');
 }
 async function unknown(job){
  const r=await pool.query(`UPDATE videobot_owner_update_jobs
    SET status='needs_reconcile',updated_at=NOW()
    WHERE update_id=$1 AND owner_id=$2 AND status='running' RETURNING update_id`,
    [job.id,job.ownerId]);
  if(r.rowCount!==1)throw Error('OWNER_JOB_UNKNOWN_NOT_DURABLE');
 }
 async function runOne(handleTelegramWebhook,webhookSecret){
  if(typeof handleTelegramWebhook!=='function'||typeof webhookSecret!=='string'||
     webhookSecret.length<20)throw Error('OWNER_JOB_HANDLER_NOT_AVAILABLE');
  const job=await claim();
  if(!job)return {hadWork:false};
  try{
   const payload=Buffer.from(JSON.stringify(job.update));
   const result=await handleTelegramWebhook({secretHeader:webhookSecret,body:payload});
   if(result?.accepted!==true||result.updateId!==job.id)
     throw Error('OWNER_JOB_NOT_ACCEPTED');
   await completed(job);
   return {hadWork:true,confirmed:true,jobKind:job.kind,updateId:job.id};
  }catch(err){
   // Do NOT replay a Telegram mutation with an uncertain outcome.
   await unknown(job);
   return {hadWork:true,needsReconcile:true,jobKind:job.kind,updateId:job.id,
     reason:err?.message==='WEBHOOK_UPDATE_NEEDS_RECONCILE'?'PREEXISTING_UNKNOWN':'HANDLER_RESULT_UNKNOWN'};
  }
 }
 return Object.freeze({enqueue,recover,claim,completed,unknown,runOne});
}
