import {appendFileSync} from 'node:fs';

/**
 * One-time, bounded cleanup of this Bot's own duplicate video-sales receipts.
 * Safeguards: precisely one paid receipt, identical product/video/seller/topic,
 * no invoice buyers, under the Telegram deletion age limit, no survivor IDs.
 * Does not change any purchase, ledger or receipt.
 */
export async function cleanupDuplicateVideoOffers({pool,api,auditFile,auditWrite=appendFileSync,chatId=-1002373696859,now=Date.now()}){
 if(typeof pool?.query!=='function'||typeof api!=='function'||
    typeof auditFile!=='string'||!auditFile.startsWith('/var/lib/videobot/media-work/'))
   throw Error('VIDEO_CLEANUP_DEPENDENCIES');
 const {rows}=await pool.query(`SELECT r.delivery_key,r.topic_id,r.paid_message_id,r.free_message_ids,
 r.status,r.updated_at,l.title,l.price_stars,l.seller_user_id,l.paid_video_file_id
 FROM videobot_post_receipts r JOIN videobot_listings l ON l.listing_id=r.listing_id
 WHERE r.status='sent' ORDER BY r.updated_at ASC`);
 const {rows:paid}=await pool.query(
   "SELECT DISTINCT delivery_key FROM videobot_stars_ledger WHERE kind='paid' AND delivery_key IS NOT NULL");
 const {rows:invoice}=await pool.query(
   "SELECT COUNT(*)::int AS n FROM videobot_video_invoice_orders WHERE telegram_payment_charge_id IS NOT NULL");
 const paidKeys=new Set(paid.map(p=>p.delivery_key));
 const keepers=rows.filter(r=>paidKeys.has(r.delivery_key));
 if(keepers.length!==1||invoice[0]?.n!==0)
   throw Error('VIDEO_CLEANUP_PURCHASED_RECONCILE_REQUIRED');
 const keep=keepers[0];
 const same=(a,b)=>String(a)===String(b);
 const duplicates=rows.filter(r=>r.delivery_key!==keep.delivery_key &&
   same(r.topic_id,keep.topic_id)&&same(r.seller_user_id,keep.seller_user_id) &&
   r.title===keep.title&&same(r.price_stars,keep.price_stars) &&
   r.paid_video_file_id===keep.paid_video_file_id&&!paidKeys.has(r.delivery_key));
 if(duplicates.length<1||duplicates.length>15)
   throw Error('VIDEO_CLEANUP_COUNT_UNVERIFIED');
 const allIds=r=>[r.paid_message_id,...(r.free_message_ids??[])].map(Number);
 const keepIds=allIds(keep),dropIds=duplicates.flatMap(allIds);
 if(keepIds.length!==3||new Set(keepIds).size!==3||
    !keepIds.every(id=>Number.isSafeInteger(id)&&id>0)||
    dropIds.length!==duplicates.length*3||
    dropIds.some(id=>!Number.isSafeInteger(id)||id<=0||keepIds.includes(id)))
   throw Error('VIDEO_CLEANUP_RECEIPT_IDS_UNSAFE');
 if(duplicates.some(r=>{
   const d=r.updated_at instanceof Date?r.updated_at:new Date(r.updated_at);
   return !Number.isFinite(d.getTime())||now-d.getTime()>46*3600_000;
 }))throw Error('VIDEO_CLEANUP_TELEGRAM_AGE_UNSAFE');
 const me=await api('getMe',{}),chat=await api('getChat',{chat_id:chatId});
 if(me?.is_bot!==true||me?.username?.toLowerCase()!=='createvdobot'||
    chat?.id!==chatId||chat?.is_forum!==true)
   throw Error('VIDEO_CLEANUP_IDENTITY_UNVERIFIED');
 const member=await api('getChatMember',{chat_id:chatId,user_id:me.id});
 if(!['creator','administrator'].includes(member?.status)||
    member.status==='administrator'&&member.can_delete_messages!==true)
   throw Error('VIDEO_CLEANUP_PERMISSION_UNVERIFIED');
 const status=(await pool.query(
   "SELECT COUNT(*)::int AS n FROM videobot_stars_ledger WHERE kind='paid' AND delivery_key=$1",
   [keep.delivery_key])).rows[0]?.n;
 if(!(status>0))throw Error('VIDEO_CLEANUP_SURVIVOR_PURCHASE_LOST');
 // Several old failed publishes reused the same sample album.
 // The protected sale IDs were already excluded; remove each other message once.
 const uniqueTargets=[],seen=new Set();
 for(const r of duplicates){
   for(const id of allIds(r)){
     if(seen.has(id))continue;
     seen.add(id);uniqueTargets.push({r,id});
   }
 }
 let deleted=0;
 for(const {r,id} of uniqueTargets){
     // Record intention BEFORE irreversible network I/O. Unknown replies remain
     // visible in the on-disk audit; no automatic retries or ambiguous success.
     auditWrite(auditFile,JSON.stringify({
       at:new Date().toISOString(),action:'delete_intent',delivery_key:r.delivery_key,
       message_id:id,protected_delivery_key:keep.delivery_key})+'\n',{mode:0o600});
     const done=await api('deleteMessage',{chat_id:chatId,message_id:id});
     if(done!==true)throw Error('VIDEO_CLEANUP_ACK_UNKNOWN');
     auditWrite(auditFile,JSON.stringify({
       at:new Date().toISOString(),action:'delete_ack',delivery_key:r.delivery_key,
       message_id:id,protected_delivery_key:keep.delivery_key})+'\n',{mode:0o600});
     deleted++;
 }
 return {deleted,kept:keepIds.length,duplicates:duplicates.length};
}
