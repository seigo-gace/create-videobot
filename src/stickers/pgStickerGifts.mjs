import {createHash} from 'node:crypto';

const giftId=x=>{if(typeof x!=='string'||!/^sg_[a-f0-9]{24}$/.test(x))
 throw Error('STICKER_GIFT_ID_INVALID');return x;};
const orderId=x=>{if(typeof x!=='string'||!/^so_[a-f0-9]{24}$/.test(x))
 throw Error('STICKER_GIFT_ORDER_INVALID');return x;};
const owner=x=>{if(!Number.isSafeInteger(x)||x<=0)
 throw Error('STICKER_GIFT_USER_INVALID');return x;};
const attempt=x=>{if(!Number.isSafeInteger(x)||x<1||x>1000)
 throw Error('STICKER_GIFT_ATTEMPT_INVALID');return x;};
const index=x=>{if(!Number.isSafeInteger(x)||x<0||x>199)
 throw Error('STICKER_GIFT_INDEX_INVALID');return x;};
const token=x=>{if(typeof x!=='string'||!/^[A-Za-z0-9_-]{32}$/.test(x))
 throw Error('STICKER_GIFT_TOKEN_INVALID');return x;};
const digest=x=>createHash('sha256').update(token(x),'utf8').digest('hex');
const itemsOf=x=>typeof x==='string'?JSON.parse(x):x;

export function createPostgresStickerGifts(pool){
 if(typeof pool?.query!=='function'||typeof pool?.connect!=='function')
   throw Error('STICKER_GIFT_DB_REQUIRED');
 return Object.freeze({
  async prepare({giftId:gid,donorOrderId,donorId,token:secret}={}){
   const id=giftId(gid),origin=orderId(donorOrderId),
     donor=owner(donorId),hash=digest(secret);
   const r=await pool.query(
     "INSERT INTO videobot_sticker_gifts (gift_id,donor_order_id,donor_user_id,token_sha256)"+
     " SELECT $1,o.order_id,$3,$4 FROM videobot_sticker_orders o"+
     " WHERE o.order_id=$2 AND o.buyer_user_id=$3 AND o.invoice_state='paid'"+
     " ON CONFLICT (gift_id) DO NOTHING RETURNING gift_id",
     [id,origin,donor,hash]);
   if(r.rowCount===1)return {giftId:id,created:true};
   const existing=await pool.query(
     "SELECT gift_id FROM videobot_sticker_gifts"+
     " WHERE gift_id=$1 AND donor_order_id=$2 AND donor_user_id=$3 AND token_sha256=$4",
     [id,origin,donor,hash]);
   if(existing.rowCount!==1)throw Error('STICKER_GIFT_OPERATION_CONFLICT_OR_NOT_PAID');
   return {giftId:id,created:false};
  },
  async status({giftId:gid,donorId}={}){
   const r=await pool.query(
     "SELECT gift_id,recipient_user_id,redeemed_at FROM videobot_sticker_gifts"+
     " WHERE gift_id=$1 AND donor_user_id=$2",
     [giftId(gid),owner(donorId)]);
   return r.rows?.[0]??null;
  },
  async redeem({token:secret,recipientId}={}){
   const hash=digest(secret),recipient=owner(recipientId),client=await pool.connect();
   try{
     await client.query('BEGIN');
     const r=await client.query(
       "SELECT g.gift_id,g.donor_user_id,g.recipient_user_id,o.invoice_state,p.items"+
       " FROM videobot_sticker_gifts g"+
       " JOIN videobot_sticker_orders o ON o.order_id=g.donor_order_id"+
       " JOIN videobot_sticker_products p ON p.product_id=o.product_id"+
       " WHERE g.token_sha256=$1 FOR UPDATE OF g",
       [hash]);
     if(r.rowCount!==1)throw Error('STICKER_GIFT_LINK_NOT_FOUND');
     const row=r.rows[0];
     if(String(row.donor_user_id)===String(recipient))
       throw Error('STICKER_GIFT_SELF_RECEIPT_DENIED');
     if(row.invoice_state!=='paid')
       throw Error('STICKER_GIFT_DONOR_PURCHASE_UNVERIFIED');
     if(row.recipient_user_id!==null){
       if(String(row.recipient_user_id)!==String(recipient))
         throw Error('STICKER_GIFT_ALREADY_RECEIVED');
       await client.query('COMMIT');
       return {giftId:row.gift_id,newReceipt:false};
     }
     const items=itemsOf(row.items);
     if(!Array.isArray(items)||items.length<1||items.length>200)
       throw Error('STICKER_GIFT_SOURCE_EMPTY');
     await client.query(
       "UPDATE videobot_sticker_gifts SET recipient_user_id=$2,redeemed_at=NOW()"+
       " WHERE gift_id=$1 AND recipient_user_id IS NULL",
       [row.gift_id,recipient]);
     for(let i=0;i<items.length;i++)
       await client.query(
         "INSERT INTO videobot_sticker_gift_delivery_items"+
         " (gift_id,attempt,item_index,status) VALUES($1,1,$2,'pending')",
         [row.gift_id,i]);
     await client.query('COMMIT');
     return {giftId:row.gift_id,newReceipt:true};
   }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}
   finally{client.release();}
  },
  async getReceived(gid,recipientId){
   const r=await pool.query(
     "SELECT g.gift_id,g.recipient_user_id,p.title,p.version,p.items"+
     " FROM videobot_sticker_gifts g"+
     " JOIN videobot_sticker_orders o ON o.order_id=g.donor_order_id"+
     " JOIN videobot_sticker_products p ON p.product_id=o.product_id"+
     " WHERE g.gift_id=$1 AND g.recipient_user_id=$2 AND g.redeemed_at IS NOT NULL",
     [giftId(gid),owner(recipientId)]);
   return r.rows?.[0]??null;
  },
  async listReceived(recipientId){
   const r=await pool.query(
     "SELECT g.gift_id,p.title,p.version FROM videobot_sticker_gifts g"+
     " JOIN videobot_sticker_orders o ON o.order_id=g.donor_order_id"+
     " JOIN videobot_sticker_products p ON p.product_id=o.product_id"+
     " WHERE g.recipient_user_id=$1 AND g.redeemed_at IS NOT NULL"+
     " ORDER BY g.redeemed_at DESC,g.gift_id DESC LIMIT 10",
     [owner(recipientId)]);
   return r.rows;
  },
  async deliveryRows(gid,tryNumber){
   const r=await pool.query(
     "SELECT item_index,status,telegram_message_id"+
     " FROM videobot_sticker_gift_delivery_items"+
     " WHERE gift_id=$1 AND attempt=$2 ORDER BY item_index ASC",
     [giftId(gid),attempt(tryNumber)]);
   return r.rows;
  },
  async claimItem({giftId:gid,recipientId,attempt:tryNumber,index:itemIndex}={}){
   const r=await pool.query(
     "UPDATE videobot_sticker_gift_delivery_items d"+
     " SET status='sending',updated_at=NOW()"+
     " FROM videobot_sticker_gifts g"+
     " JOIN videobot_sticker_orders o ON o.order_id=g.donor_order_id"+
     " JOIN videobot_sticker_products p ON p.product_id=o.product_id"+
     " WHERE d.gift_id=g.gift_id AND d.gift_id=$1 AND d.attempt=$2"+
     " AND d.item_index=$3 AND g.recipient_user_id=$4"+
     " AND g.redeemed_at IS NOT NULL AND o.invoice_state='paid'"+
     " AND d.status='pending' RETURNING p.items",
     [giftId(gid),attempt(tryNumber),index(itemIndex),owner(recipientId)]);
   if(r.rowCount!==1)return null;
   const files=itemsOf(r.rows[0].items);
   return files?.[itemIndex]??null;
  },
  async itemSent({giftId:gid,attempt:tryNumber,index:itemIndex,messageId}={}){
   if(!Number.isSafeInteger(messageId)||messageId<=0)
     throw Error('STICKER_GIFT_MESSAGE_INVALID');
   const r=await pool.query(
     "UPDATE videobot_sticker_gift_delivery_items"+
     " SET status='sent',telegram_message_id=$4,updated_at=NOW()"+
     " WHERE gift_id=$1 AND attempt=$2 AND item_index=$3 AND status='sending'"+
     " RETURNING item_index",
     [giftId(gid),attempt(tryNumber),index(itemIndex),messageId]);
   if(r.rowCount!==1)throw Error('STICKER_GIFT_DELIVERY_RECEIPT_CONFLICT');
  },
  async itemUnknown({giftId:gid,attempt:tryNumber,index:itemIndex}={}){
   await pool.query(
     "UPDATE videobot_sticker_gift_delivery_items"+
     " SET status='unknown',updated_at=NOW()"+
     " WHERE gift_id=$1 AND attempt=$2 AND item_index=$3 AND status='sending'",
     [giftId(gid),attempt(tryNumber),index(itemIndex)]);
  },
  async redeliver(gid,recipientId){
   const id=giftId(gid),recipient=owner(recipientId),client=await pool.connect();
   try{
     await client.query('BEGIN');
     const q=await client.query(
       "SELECT g.gift_id,p.items FROM videobot_sticker_gifts g"+
       " JOIN videobot_sticker_orders o ON o.order_id=g.donor_order_id"+
       " JOIN videobot_sticker_products p ON p.product_id=o.product_id"+
       " WHERE g.gift_id=$1 AND g.recipient_user_id=$2 AND g.redeemed_at IS NOT NULL"+
       " AND o.invoice_state='paid' FOR UPDATE OF g",
       [id,recipient]);
     if(q.rowCount!==1)throw Error('STICKER_GIFT_NOT_RECEIVED');
     const latest=await client.query(
       "SELECT COALESCE(MAX(attempt),0)+1 AS attempt"+
       " FROM videobot_sticker_gift_delivery_items WHERE gift_id=$1",
       [id]);
     const next=Number(latest.rows[0].attempt);
     if(next<=1||next>1000)throw Error('STICKER_GIFT_REDELIVERY_LIMIT');
     const files=itemsOf(q.rows[0].items);
     for(let i=0;i<files.length;i++)
       await client.query(
         "INSERT INTO videobot_sticker_gift_delivery_items"+
         " (gift_id,attempt,item_index,status) VALUES($1,$2,$3,'pending')",
         [id,next,i]);
     await client.query('COMMIT');
     return {attempt:next};
   }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}
   finally{client.release();}
  }
 });
}
