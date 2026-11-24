/** One-message RichMessage sale offer receipts in the VideoBot-owned database.
 * Old paid-media and invoice-album receipts are immutable historical evidence.
 */
const KEY=/^[A-Za-z0-9_-]{1,40}:[1-9][0-9]*$/;
const ID=/^[A-Za-z0-9_-]{1,40}$/;
const positive=n=>Number.isSafeInteger(n)&&n>0;
function valid(key){if(typeof key!=='string'||!KEY.test(key))throw Error('RICH_RECEIPT_KEY_INVALID');return key;}
export function createPostgresRichOfferReceiptStore(pool){
 if(typeof pool?.query!=='function')throw Error('RICH_RECEIPT_POOL_REQUIRED');
 return {
  async read(key){
   const r=await pool.query(
    'SELECT status,message_id FROM videobot_rich_offer_receipts WHERE delivery_key=$1',[valid(key)]);
   const item=r.rows?.[0];
   if(!item)return null;
   const id=item.message_id==null?null:Number(item.message_id);
   if(id!==null&&!positive(id))throw Error('RICH_RECEIPT_MESSAGE_ID_INVALID');
   return {status:item.status,messageId:id};
  },
  async claim({key,listingId,revision,topicId}){
   valid(key);
   if(typeof listingId!=='string'||!ID.test(listingId)||key!==listingId+':'+revision||
     !positive(revision)||!positive(topicId))throw Error('RICH_RECEIPT_CLAIM_INVALID');
   const r=await pool.query(
    "INSERT INTO videobot_rich_offer_receipts (delivery_key,listing_id,revision,topic_id,status) VALUES ($1,$2,$3,$4,'sending') ON CONFLICT (delivery_key) DO NOTHING RETURNING delivery_key",
    [key,listingId,revision,topicId]);
   return {claimed:r.rowCount===1};
  },
  async findOtherDelivery({listingId,key}){
   if(typeof listingId!=='string'||!ID.test(listingId))throw Error('RICH_RECEIPT_LISTING_INVALID');
   valid(key);
   const r=await pool.query(
    "SELECT delivery_key,status FROM videobot_rich_offer_receipts WHERE listing_id=$1 AND delivery_key<>$2 AND status IN ('sending','sent','needs_reconcile') LIMIT 1",
    [listingId,key]);
   return r.rows?.[0]??null;
  },
  async findLegacyOffer({listingId,key}){
   if(typeof listingId!=='string'||!ID.test(listingId))throw Error('RICH_RECEIPT_LISTING_INVALID');
   valid(key);
   const r=await pool.query(
    "SELECT delivery_key,status,sale_mode,free_message_ids,paid_message_id,topic_id FROM videobot_post_receipts WHERE listing_id=$1 AND status IN ('sending','sent','needs_reconcile') ORDER BY updated_at LIMIT 2",[listingId]);
   return (r.rows??[]).map(x=>({
    key:x.delivery_key,status:x.status,saleMode:x.sale_mode,
    freeIds:x.free_message_ids?.map(Number)??null,
    paidMessageId:x.paid_message_id==null?null:Number(x.paid_message_id),
    topicId:Number(x.topic_id)
   }));
  },
  async recordSent(key,messageId){
   valid(key);if(!positive(messageId))throw Error('RICH_RECEIPT_ACK_INVALID');
   const r=await pool.query(
    "UPDATE videobot_rich_offer_receipts SET status='sent',message_id=$2,updated_at=NOW() WHERE delivery_key=$1 AND status='sending' AND message_id IS NULL RETURNING delivery_key",
    [key,messageId]);
   if(r.rowCount!==1)throw Error('RICH_RECEIPT_ACK_STALE');
  },
  async markUnknown(key){
   await pool.query(
    "UPDATE videobot_rich_offer_receipts SET status='needs_reconcile',updated_at=NOW() WHERE delivery_key=$1 AND status='sending'",[valid(key)]);
  }
 };
}
