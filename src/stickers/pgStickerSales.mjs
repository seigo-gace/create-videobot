import {randomBytes} from 'node:crypto';

const id=(prefix)=>prefix+'_'+randomBytes(12).toString('hex');
function positive(n,label){if(!Number.isSafeInteger(n)||n<=0)throw Error('STICKER_SALE_'+label+'_INVALID');return n;}
function price(n){if(!Number.isSafeInteger(n)||n<1||n>25000)throw Error('STICKER_SALE_PRICE_INVALID');return n;}
function key(s,prefix){if(typeof s!=='string'||!new RegExp('^'+prefix+'_[a-f0-9]{24}$').test(s))throw Error('STICKER_SALE_KEY_INVALID');return s;}
function pack(s){if(typeof s!=='string'||! /^[A-Za-z][A-Za-z0-9_]{1,63}$/.test(s))throw Error('STICKER_SALE_PACK_INVALID');return s;}
const snapshot=set=>{
 if(!set||!['regular','custom_emoji'].includes(set.sticker_type)||
    typeof set.title!=='string'||!set.title.trim()||set.title.length>64||
    !Array.isArray(set.stickers)||!set.stickers.length||set.stickers.length>200)
   throw Error('STICKER_SALE_SNAPSHOT_INVALID');
 const items=set.stickers.map(s=>{
   if(typeof s.file_id!=='string'||!s.file_id||typeof s.file_unique_id!=='string'||!s.file_unique_id)
     throw Error('STICKER_SALE_ITEM_INVALID');
   return {file_id:s.file_id,file_unique_id:s.file_unique_id};
 });
 if(new Set(items.map(s=>s.file_unique_id)).size!==items.length)
   throw Error('STICKER_SALE_ITEM_DUPLICATE');
 return items;
};
const itemsOf=row=>typeof row?.items==='string'?JSON.parse(row.items):row?.items;
export function createPostgresStickerSales(pool){
 if(typeof pool?.query!=='function'||typeof pool?.connect!=='function')
   throw Error('STICKER_SALE_DB_REQUIRED');
 return {
  async publish({sellerId,packName,set,priceStars,productId}={}){
   const seller=positive(sellerId,'SELLER'),name=pack(packName),stars=price(priceStars),product=key(productId,'sp');
   if(set?.name!==name)throw Error('STICKER_SALE_SNAPSHOT_PACK_MISMATCH');
   const items=snapshot(set),client=await pool.connect();
   try{
     await client.query('BEGIN');
     const found=await client.query(
       "SELECT kind FROM videobot_sticker_packs WHERE pack_name=$1 AND owner_user_id=$2 AND status='active' FOR UPDATE",
       [name,seller]);
     if(found.rowCount!==1||found.rows[0].kind!==set.sticker_type)
       throw Error('STICKER_SALE_PACK_OWNER_MISMATCH');
     const previous=await client.query(
       "SELECT product_id,version,seller_user_id,pack_name,kind,title,price_stars,items FROM videobot_sticker_products WHERE product_id=$1",
       [product]);
     if(previous.rowCount===1){
       const row=previous.rows[0];
       if(String(row.seller_user_id)!==String(seller)||row.pack_name!==name||
          row.kind!==set.sticker_type||row.title!==set.title||
          Number(row.price_stars)!==stars||
          JSON.stringify(itemsOf(row))!==JSON.stringify(items))
         throw Error('STICKER_SALE_PUBLISH_IDEMPOTENCY_CONFLICT');
       await client.query('COMMIT');
       return {productId:product,version:Number(row.version),priceStars:stars,duplicate:true};
     }
     const version=await client.query(
       "SELECT COALESCE(MAX(version),0)+1 AS next FROM videobot_sticker_products WHERE pack_name=$1",
       [name]);
     const result=await client.query(
       "INSERT INTO videobot_sticker_products (product_id,pack_name,version,seller_user_id,kind,title,price_stars,items) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb) RETURNING product_id,version",
       [product,name,Number(version.rows[0].next),seller,set.sticker_type,
        set.title,stars,JSON.stringify(items)]);
     await client.query('COMMIT');
     return {productId:result.rows[0].product_id,version:Number(result.rows[0].version),priceStars:stars};
   }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
  },
  async getPublished(productId){
   const q=await pool.query(
     "SELECT product_id,pack_name,version,seller_user_id,title,kind,price_stars,items,status FROM videobot_sticker_products WHERE product_id=$1",
     [key(productId,'sp')]);
   return q.rows[0]??null;
  },
  async reserveOrder({productId,buyerId}={}){
   const product=key(productId,'sp'),buyer=positive(buyerId,'BUYER');
   const q=await pool.query(
     "INSERT INTO videobot_sticker_orders (order_id,product_id,buyer_user_id,price_stars,terms_accepted_at) SELECT $1,p.product_id,$3,p.price_stars,NOW() FROM videobot_sticker_products p WHERE p.product_id=$2 AND p.status='published' ON CONFLICT(product_id,buyer_user_id) DO NOTHING RETURNING order_id,invoice_state,price_stars",
     [id('so'),product,buyer]);
   if(q.rowCount===1)return {...q.rows[0],newOrder:true};
   const existing=await pool.query(
     "SELECT o.order_id,o.invoice_state,o.price_stars FROM videobot_sticker_orders o WHERE o.product_id=$1 AND o.buyer_user_id=$2",
     [product,buyer]);
   if(existing.rowCount!==1)throw Error('STICKER_SALE_NOT_AVAILABLE');
   return {...existing.rows[0],newOrder:false};
  },
  async startInvoice(orderId,buyerId){
   const q=await pool.query(
     "UPDATE videobot_sticker_orders SET invoice_state='sending' WHERE order_id=$1 AND buyer_user_id=$2 AND invoice_state='prepared' RETURNING order_id,product_id,price_stars",
     [key(orderId,'so'),positive(buyerId,'BUYER')]);
   return q.rows[0]??null;
  },
  async invoiceSent(orderId,buyerId,messageId){
   const q=await pool.query(
     "UPDATE videobot_sticker_orders SET invoice_state='sent',invoice_message_id=$3 WHERE order_id=$1 AND buyer_user_id=$2 AND invoice_state='sending' RETURNING order_id",
     [key(orderId,'so'),positive(buyerId,'BUYER'),positive(messageId,'INVOICE_MESSAGE')]);
   if(q.rowCount!==1)throw Error('STICKER_SALE_INVOICE_RECEIPT_CONFLICT');
  },
  async invoiceUnknown(orderId){
   await pool.query(
     "UPDATE videobot_sticker_orders SET invoice_state='unknown' WHERE order_id=$1 AND invoice_state='sending'",
     [key(orderId,'so')]);
  },
  async checkPreCheckout(query){
   const payload=query?.invoice_payload;
   if(typeof payload!=='string'||!/^stk:so_[a-f0-9]{24}$/.test(payload))
     return false;
   const q=await pool.query(
     "SELECT o.buyer_user_id,o.price_stars,o.invoice_state,p.status FROM videobot_sticker_orders o JOIN videobot_sticker_products p ON p.product_id=o.product_id WHERE o.order_id=$1",
     [payload.slice(4)]);
   if(q.rowCount!==1)return false;
   const row=q.rows[0];
   return String(row.buyer_user_id)===String(query.from?.id)&&
     query.currency==='XTR'&&Number(row.price_stars)===query.total_amount&&
     row.status==='published'&&['sending','sent','unknown','paid'].includes(row.invoice_state);
  },
  async capturePayment({buyerId,successfulPayment,updateId}={}){
   const buyer=positive(buyerId,'BUYER'),payment=successfulPayment;
   const payload=payment?.invoice_payload;
   if(typeof payload!=='string'||!/^stk:so_[a-f0-9]{24}$/.test(payload)||
      payment.currency!=='XTR'||typeof payment.telegram_payment_charge_id!=='string'||
      !payment.telegram_payment_charge_id||!Number.isSafeInteger(updateId)||updateId<0)
     throw Error('STICKER_SALE_PAYMENT_INVALID');
   const orderId=payload.slice(4),client=await pool.connect();
   try{
     await client.query('BEGIN');
     const q=await client.query(
       "SELECT o.order_id,o.buyer_user_id,o.price_stars,o.invoice_state,o.telegram_payment_charge_id,p.items FROM videobot_sticker_orders o JOIN videobot_sticker_products p ON p.product_id=o.product_id WHERE o.order_id=$1 FOR UPDATE OF o",
       [orderId]);
     if(q.rowCount!==1)throw Error('STICKER_SALE_ORDER_MISSING');
     const row=q.rows[0],files=itemsOf(row);
     if(String(row.buyer_user_id)!==String(buyer)||
        Number(row.price_stars)!==payment.total_amount)
       throw Error('STICKER_SALE_PAYMENT_MISMATCH');
     if(row.invoice_state==='paid') {
       if(row.telegram_payment_charge_id!==payment.telegram_payment_charge_id)
         throw Error('STICKER_SALE_PAYMENT_CONFLICT');
       await client.query('COMMIT');return {orderId,duplicate:true};
     }
     if(!['sending','sent','unknown'].includes(row.invoice_state))
       throw Error('STICKER_SALE_UNISSUED_INVOICE');
     const changed=await client.query(
       "UPDATE videobot_sticker_orders SET invoice_state='paid',telegram_payment_charge_id=$2,payment_update_id=$3,paid_at=NOW() WHERE order_id=$1 AND invoice_state IN ('sending','sent','unknown') RETURNING order_id",
       [orderId,payment.telegram_payment_charge_id,updateId]);
     if(changed.rowCount!==1)throw Error('STICKER_SALE_PAYMENT_CAS_FAILED');
     for(let i=0;i<files.length;i++)
       await client.query(
         "INSERT INTO videobot_sticker_delivery_items (order_id,attempt,item_index,status) VALUES ($1,1,$2,'pending')",
         [orderId,i]);
     await client.query('COMMIT');return {orderId,duplicate:false};
   }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
  },
  async getPaidOrder(orderId,buyerId){
   const q=await pool.query(
     "SELECT o.order_id,o.buyer_user_id,o.invoice_state,p.title,p.items,p.version,p.product_id FROM videobot_sticker_orders o JOIN videobot_sticker_products p ON p.product_id=o.product_id WHERE o.order_id=$1 AND o.buyer_user_id=$2 AND o.invoice_state='paid'",
     [key(orderId,'so'),positive(buyerId,'BUYER')]);
   return q.rows[0]??null;
  },
  async listPurchases(buyerId){
   const q=await pool.query(
     "SELECT o.order_id,p.title,p.version FROM videobot_sticker_orders o JOIN videobot_sticker_products p ON p.product_id=o.product_id WHERE o.buyer_user_id=$1 AND o.invoice_state='paid' ORDER BY o.paid_at DESC LIMIT 10",
     [positive(buyerId,'BUYER')]);
   return q.rows;
  },
  async createRedelivery(orderId,buyerId){
   const client=await pool.connect();
   try{
     await client.query('BEGIN');
     const q=await client.query(
       "SELECT o.order_id,p.items FROM videobot_sticker_orders o JOIN videobot_sticker_products p ON p.product_id=o.product_id WHERE o.order_id=$1 AND o.buyer_user_id=$2 AND o.invoice_state='paid' FOR UPDATE OF o",
       [key(orderId,'so'),positive(buyerId,'BUYER')]);
     if(q.rowCount!==1)throw Error('STICKER_SALE_NOT_PURCHASED');
     const latest=await client.query(
       "SELECT COALESCE(MAX(attempt),0)+1 AS attempt FROM videobot_sticker_delivery_items WHERE order_id=$1",
       [orderId]);
     const attempt=Number(latest.rows[0].attempt);
     if(attempt<=1||attempt>1000)throw Error('STICKER_SALE_REDELIVERY_LIMIT');
     const files=itemsOf(q.rows[0]);
     for(let i=0;i<files.length;i++)
       await client.query(
         "INSERT INTO videobot_sticker_delivery_items (order_id,attempt,item_index,status) VALUES($1,$2,$3,'pending')",
         [orderId,attempt,i]);
     await client.query('COMMIT');return {attempt};
   }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
  },
  async createPaymentSupport({buyerId,orderId=null,details}={}){
   const buyer=positive(buyerId,'BUYER');
   if(typeof details!=='string'||details.trim().length<5||details.length>1000)
     throw Error('STICKER_SALE_SUPPORT_DETAILS_INVALID');
   if(orderId!==null)key(orderId,'so');
   const result=await pool.query(
     "INSERT INTO videobot_sticker_payment_support (ticket_id,buyer_user_id,order_id,details)"+
     " SELECT $1,$2,o.order_id,$4 FROM (SELECT $3::text AS requested) v"+
     " LEFT JOIN videobot_sticker_orders o ON o.order_id=v.requested AND o.buyer_user_id=$2"+
     " WHERE v.requested IS NULL OR o.order_id IS NOT NULL RETURNING ticket_id",
     [id('ss'),buyer,orderId,details.trim()]);
   if(result.rowCount!==1)throw Error('STICKER_SALE_SUPPORT_OWNER_MISMATCH');
   return {ticketId:result.rows[0].ticket_id};
  },
  async getDeliveryRows(orderId,attempt){
   const q=await pool.query(
     "SELECT item_index,status,telegram_message_id FROM videobot_sticker_delivery_items WHERE order_id=$1 AND attempt=$2 ORDER BY item_index ASC",
     [key(orderId,'so'),positive(attempt,'ATTEMPT')]);
   return q.rows;
  },
  async claimItem({orderId,buyerId,attempt,index}){
   const q=await pool.query(
     "UPDATE videobot_sticker_delivery_items d SET status='sending',updated_at=NOW() FROM videobot_sticker_orders o JOIN videobot_sticker_products p ON p.product_id=o.product_id WHERE d.order_id=o.order_id AND d.order_id=$1 AND d.attempt=$2 AND d.item_index=$3 AND o.buyer_user_id=$4 AND o.invoice_state='paid' AND d.status='pending' RETURNING p.items",
     [key(orderId,'so'),positive(attempt,'ATTEMPT'),index,positive(buyerId,'BUYER')]);
   if(q.rowCount!==1)return null;
   return itemsOf(q.rows[0])[index]??null;
  },
  async itemSent({orderId,attempt,index,messageId}){
   const q=await pool.query(
     "UPDATE videobot_sticker_delivery_items SET status='sent',telegram_message_id=$4,updated_at=NOW() WHERE order_id=$1 AND attempt=$2 AND item_index=$3 AND status='sending' RETURNING item_index",
     [key(orderId,'so'),positive(attempt,'ATTEMPT'),index,positive(messageId,'MESSAGE')]);
   if(q.rowCount!==1)throw Error('STICKER_SALE_DELIVERY_RECEIPT_CONFLICT');
  },
  async itemUnknown({orderId,attempt,index}){
   await pool.query(
     "UPDATE videobot_sticker_delivery_items SET status='unknown',updated_at=NOW() WHERE order_id=$1 AND attempt=$2 AND item_index=$3 AND status='sending'",
     [key(orderId,'so'),positive(attempt,'ATTEMPT'),index]);
  }
 };
}
