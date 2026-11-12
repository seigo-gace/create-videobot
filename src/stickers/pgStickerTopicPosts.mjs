const product=id=>{if(typeof id!=='string'||!/^sp_[a-f0-9]{24}$/.test(id))throw Error('STICKER_TOPIC_PRODUCT_INVALID');return id;};
const owner=id=>{if(!Number.isSafeInteger(id)||id<=0)throw Error('STICKER_TOPIC_OWNER_INVALID');return id;};
const positive=id=>{if(!Number.isSafeInteger(id)||id<=0)throw Error('STICKER_TOPIC_MESSAGE_INVALID');return id;};
export function createPostgresStickerTopicPosts(pool){
 if(typeof pool?.query!=='function')throw Error('STICKER_TOPIC_DB_REQUIRED');
 return {
  async claim({productId,sellerId,topic,text}={}){
    const p=product(productId),seller=owner(sellerId);
    if(!topic||!Number.isSafeInteger(topic.chatId)||topic.chatId>=0||
       !Number.isSafeInteger(topic.threadId)||topic.threadId<=0||
       typeof topic.groupTitle!=='string'||!topic.groupTitle||
       typeof topic.title!=='string'||!topic.title||
       typeof text!=='string'||!text.trim()||text.length>4096)
      throw Error('STICKER_TOPIC_DESTINATION_INVALID');
    const q=await pool.query(
      "INSERT INTO videobot_sticker_topic_posts (product_id,seller_user_id,chat_id,message_thread_id,group_title,topic_title,display_text,status)"+
      " SELECT $1,$2,$3,$4,$5,$6,$7,'sending'"+
      " WHERE EXISTS (SELECT 1 FROM videobot_sticker_products p WHERE p.product_id=$1 AND p.seller_user_id=$2 AND p.status='published')"+
      " ON CONFLICT (product_id) DO NOTHING RETURNING product_id",
      [p,seller,topic.chatId,topic.threadId,topic.groupTitle,topic.title,text]);
    if(q.rowCount===1)return {claimed:true};
    const existing=await this.getOwned(p,seller);
    if(!existing)throw Error('STICKER_TOPIC_OWNER_OR_PRODUCT_MISMATCH');
    if(existing.chat_id!==topic.chatId||
       Number(existing.message_thread_id)!==topic.threadId)
      throw Error('STICKER_TOPIC_ROUTE_CHANGED');
    return {claimed:false,status:existing.status,messageId:existing.telegram_message_id};
  },
  async getOwned(productId,sellerId){
    const q=await pool.query(
      "SELECT product_id,seller_user_id,chat_id,message_thread_id,group_title,topic_title,display_text,status,telegram_message_id"+
      " FROM videobot_sticker_topic_posts WHERE product_id=$1 AND seller_user_id=$2",
      [product(productId),owner(sellerId)]);
    return q.rows?.[0]??null;
  },
  async recorded(productId,sellerId,messageId){
    const q=await pool.query(
      "UPDATE videobot_sticker_topic_posts SET status='sent',telegram_message_id=$3,updated_at=NOW()"+
      " WHERE product_id=$1 AND seller_user_id=$2 AND status='sending' RETURNING product_id",
      [product(productId),owner(sellerId),positive(messageId)]);
    if(q.rowCount!==1)throw Error('STICKER_TOPIC_DELIVERY_STALE');
  },
  async unknown(productId,sellerId){
    await pool.query(
      "UPDATE videobot_sticker_topic_posts SET status='needs_reconcile',updated_at=NOW()"+
      " WHERE product_id=$1 AND seller_user_id=$2 AND status IN ('sending','sent')",
      [product(productId),owner(sellerId)]);
  },
  async edited(productId,sellerId,text){
    if(typeof text!=='string'||!text.trim()||text.length>4096)
      throw Error('STICKER_TOPIC_TEXT_INVALID');
    const q=await pool.query(
      "UPDATE videobot_sticker_topic_posts SET display_text=$3,updated_at=NOW()"+
      " WHERE product_id=$1 AND seller_user_id=$2 AND status='sent' RETURNING product_id",
      [product(productId),owner(sellerId),text]);
    if(q.rowCount!==1)throw Error('STICKER_TOPIC_EDIT_RECEIPT_STALE');
  },
  async deleted(productId,sellerId){
    const q=await pool.query(
      "UPDATE videobot_sticker_topic_posts SET status='deleted',updated_at=NOW()"+
      " WHERE product_id=$1 AND seller_user_id=$2 AND status='sent' RETURNING product_id",
      [product(productId),owner(sellerId)]);
    if(q.rowCount!==1)throw Error('STICKER_TOPIC_DELETE_RECEIPT_STALE');
  }
 };
}
