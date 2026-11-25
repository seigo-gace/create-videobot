import {parsePaidMediaPurchase,reconcilePaidMediaPurchase} from '../sales/telegramPurchase.mjs';
import {STICKER_MANAGEMENT_FEE_POLICY_ID,MANAGEMENT_FEE_BASIS_POINTS,splitStarsExact} from '../sales/managementFee.mjs';

const productKey=x=>{if(typeof x!=='string'||!/^sp_[a-f0-9]{24}$/.test(x))throw Error('STICKER_PHOTO_PRODUCT_INVALID');return x;};
const owner=x=>{if(!Number.isSafeInteger(x)||x<=0)throw Error('STICKER_PHOTO_USER_INVALID');return x;};
const pos=(x,what)=>{if(!Number.isSafeInteger(x)||x<=0)throw Error('STICKER_PHOTO_'+what+'_INVALID');return x;};
const payloadFor=id=>'stkmedia_'+productKey(id);
const itemsOf=x=>typeof x==='string'?JSON.parse(x):x;

/**
 * Only the sticker pack product, not the paid preview photo, is the purchased
 * entitlement. A PaidMediaPurchased update has NO independent amount proof;
 * only matched Bot API getStarTransactions can create durable sale rights.
 */
export function createPostgresStickerPaidPhoto({pool,telegramApi}={}){
 if(typeof pool?.connect!=='function'||typeof pool?.query!=='function'||
    typeof telegramApi!=='function')
  throw Error('STICKER_PHOTO_STORE_DEPENDENCY_MISSING');
 return Object.freeze({
  async capturePurchase(update){
   const payload=update?.purchased_paid_media?.paid_media_payload;
   if(typeof payload!=='string'||!/^stkmedia_sp_[a-f0-9]{24}$/.test(payload))
     throw Error('STICKER_PHOTO_PURCHASE_PAYLOAD_INVALID');
   const productId=payload.slice('stkmedia_'.length);
   const q=await pool.query(
     "SELECT p.product_id,p.price_stars,p.management_fee_bps,p.fee_policy_id,p.fee_terms_accepted_at,p.items,t.status AS topic_status,t.telegram_message_id FROM videobot_sticker_products p JOIN videobot_sticker_topic_posts t ON t.product_id=p.product_id WHERE p.product_id=$1",
     [productId]);
   const product=q.rows?.[0];
   if(!product||!['sent','deleted'].includes(product.topic_status)||
      !pos(Number(product.telegram_message_id),'TOPIC_MESSAGE')||
      Number(product.management_fee_bps)!==MANAGEMENT_FEE_BASIS_POINTS||
      product.fee_policy_id!==STICKER_MANAGEMENT_FEE_POLICY_ID||
      !product.fee_terms_accepted_at)
     throw Error('STICKER_PHOTO_PUBLICATION_NOT_VERIFIED');
   const purchase=parsePaidMediaPurchase(update,x=>
     x===payload?{id:productId,priceStars:Number(product.price_stars)}:null);
   const verified=await reconcilePaidMediaPurchase({purchase,telegramApi});
   if(verified.verifiedByTelegram!==true||verified.listingId!==productId||
      verified.stars!==Number(product.price_stars)||verified.buyerId!==purchase.buyerId)
     throw Error('STICKER_PHOTO_VERIFIED_CHARGE_MISMATCH');
   const split=splitStarsExact(verified.stars);
   const cx=await pool.connect();
   let committed=false;
   try{
     await cx.query('BEGIN');
     const old=await cx.query(
       "SELECT sale_id,product_id,buyer_user_id,stars,management_fee_bps,fee_policy_id,management_fee_tenths,creator_share_tenths FROM videobot_sticker_paid_photo_sales WHERE telegram_transaction_id=$1 FOR UPDATE",
       [verified.telegramTransactionId]);
     if(old.rows.length){
       const row=old.rows[0];
       if(row.product_id!==productId||Number(row.buyer_user_id)!==purchase.buyerId||
          Number(row.stars)!==verified.stars||
          Number(row.management_fee_bps)!==MANAGEMENT_FEE_BASIS_POINTS||
          row.fee_policy_id!==STICKER_MANAGEMENT_FEE_POLICY_ID||
          Number(row.management_fee_tenths)!==split.managementFeeTenths||
          Number(row.creator_share_tenths)!==split.creatorShareTenths)
         throw Error('STICKER_PHOTO_DUPLICATE_CONFLICT');
       await cx.query('COMMIT');committed=true;
       return {recorded:true,duplicate:true,saleId:Number(row.sale_id),productId};
     }
     const saved=await cx.query(
       "INSERT INTO videobot_sticker_paid_photo_sales (telegram_transaction_id,telegram_update_id,product_id,buyer_user_id,stars,management_fee_bps,fee_policy_id,management_fee_tenths,creator_share_tenths) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING sale_id",
       [verified.telegramTransactionId,update.update_id,productId,purchase.buyerId,verified.stars,
        MANAGEMENT_FEE_BASIS_POINTS,STICKER_MANAGEMENT_FEE_POLICY_ID,
        split.managementFeeTenths,split.creatorShareTenths]);
     if(saved.rowCount!==1)throw Error('STICKER_PHOTO_CHARGE_NOT_DURABLE');
     const saleId=Number(saved.rows[0].sale_id),items=itemsOf(product.items);
     if(!Array.isArray(items)||items.length<1||items.length>200||
        items.some(x=>typeof x?.file_id!=='string'||!x.file_id))
       throw Error('STICKER_PHOTO_PRODUCT_ITEMS_UNAVAILABLE');
     const delivery=await cx.query(
       "INSERT INTO videobot_sticker_paid_photo_delivery (sale_id,attempt,item_index) SELECT $1,1,generate_series(0,$2) RETURNING item_index",
       [saleId,items.length-1]);
     if(delivery.rowCount!==items.length)
       throw Error('STICKER_PHOTO_DELIVERY_NOT_DURABLE');
     await cx.query('COMMIT');committed=true;
     return {recorded:true,duplicate:false,saleId,productId};
   }catch(error){if(!committed)await cx.query('ROLLBACK').catch(()=>{});throw error;}
   finally{cx.release();}
  },
  async hasTopicPublication(productId){
   const r=await pool.query(
     "SELECT status FROM videobot_sticker_topic_posts WHERE product_id=$1",
     [productKey(productId)]);
   return r.rows?.length>0&&r.rows[0].status!=='deleted';
  },
  async getEntitlement({buyerId,productId}={}){
   const q=await pool.query(
     "SELECT s.sale_id,s.product_id,p.title,p.version,p.items FROM videobot_sticker_paid_photo_sales s JOIN videobot_sticker_products p ON p.product_id=s.product_id WHERE s.buyer_user_id=$1 AND s.product_id=$2 ORDER BY s.sale_id ASC LIMIT 1",
     [owner(buyerId),productKey(productId)]);
   return q.rows?.[0]??null;
  },
  async getSale({buyerId,saleId}={}){
   const q=await pool.query(
     "SELECT s.sale_id,s.product_id,p.title,p.version,p.items FROM videobot_sticker_paid_photo_sales s JOIN videobot_sticker_products p ON p.product_id=s.product_id WHERE s.buyer_user_id=$1 AND s.sale_id=$2",
     [owner(buyerId),pos(saleId,'SALE')]);
   return q.rows?.[0]??null;
  },
  async listPurchases(buyerId){
   const q=await pool.query(
     "SELECT DISTINCT ON (s.product_id) s.sale_id,s.product_id,p.title,p.version FROM videobot_sticker_paid_photo_sales s JOIN videobot_sticker_products p ON p.product_id=s.product_id WHERE s.buyer_user_id=$1 ORDER BY s.product_id,s.sale_id ASC LIMIT 10",
     [owner(buyerId)]);
   return q.rows.map(r=>({order_id:'paidphoto:'+Number(r.sale_id),title:r.title,
      version:Number(r.version),product_id:r.product_id,paid_photo:true}));
  },
  async deliveryRows({saleId,attempt}={}){
   const q=await pool.query(
     "SELECT item_index,status FROM videobot_sticker_paid_photo_delivery WHERE sale_id=$1 AND attempt=$2 ORDER BY item_index",
     [pos(saleId,'SALE'),pos(attempt,'ATTEMPT')]);
   return q.rows;
  },
  async claimItem({saleId,buyerId,attempt,index}={}){
   if(!Number.isSafeInteger(index)||index<0||index>199)
     throw Error('STICKER_PHOTO_ITEM_INVALID');
   const q=await pool.query(
     "UPDATE videobot_sticker_paid_photo_delivery d SET status='sending',updated_at=NOW() FROM videobot_sticker_paid_photo_sales s JOIN videobot_sticker_products p ON p.product_id=s.product_id WHERE d.sale_id=s.sale_id AND d.sale_id=$1 AND s.buyer_user_id=$2 AND d.attempt=$3 AND d.item_index=$4 AND d.status='pending' RETURNING p.items",
     [pos(saleId,'SALE'),owner(buyerId),pos(attempt,'ATTEMPT'),index]);
   if(q.rowCount!==1)return null;
   return itemsOf(q.rows[0].items)[index]??null;
  },
  async itemSent({saleId,attempt,index,messageId}={}){
   const q=await pool.query(
     "UPDATE videobot_sticker_paid_photo_delivery SET status='sent',telegram_message_id=$4,updated_at=NOW() WHERE sale_id=$1 AND attempt=$2 AND item_index=$3 AND status='sending' RETURNING item_index",
     [pos(saleId,'SALE'),pos(attempt,'ATTEMPT'),index,pos(messageId,'MESSAGE')]);
   if(q.rowCount!==1)throw Error('STICKER_PHOTO_DELIVERY_RECEIPT_CONFLICT');
  },
  async itemUnknown({saleId,attempt,index}={}){
   await pool.query(
     "UPDATE videobot_sticker_paid_photo_delivery SET status='unknown',updated_at=NOW() WHERE sale_id=$1 AND attempt=$2 AND item_index=$3 AND status='sending'",
     [pos(saleId,'SALE'),pos(attempt,'ATTEMPT'),index]);
  },
  async redeliver({saleId,buyerId}={}){
   const cx=await pool.connect();let committed=false;
   try{
    await cx.query('BEGIN');
    const q=await cx.query(
      "SELECT s.sale_id,p.items FROM videobot_sticker_paid_photo_sales s JOIN videobot_sticker_products p ON p.product_id=s.product_id WHERE s.sale_id=$1 AND s.buyer_user_id=$2 FOR UPDATE OF s",
      [pos(saleId,'SALE'),owner(buyerId)]);
    if(q.rowCount!==1)throw Error('STICKER_PHOTO_ENTITLEMENT_REQUIRED');
    const max=await cx.query("SELECT COALESCE(MAX(attempt),0)::int AS n FROM videobot_sticker_paid_photo_delivery WHERE sale_id=$1",[saleId]);
    const attempt=Number(max.rows[0].n)+1;
    if(attempt>1000)throw Error('STICKER_PHOTO_DELIVERY_ATTEMPTS_EXCEEDED');
    const items=itemsOf(q.rows[0].items);
    const ins=await cx.query(
      "INSERT INTO videobot_sticker_paid_photo_delivery(sale_id,attempt,item_index) SELECT $1,$2,generate_series(0,$3) RETURNING item_index",
      [saleId,attempt,items.length-1]);
    if(ins.rowCount!==items.length)throw Error('STICKER_PHOTO_DELIVERY_RETRY_NOT_DURABLE');
    await cx.query('COMMIT');committed=true;return {attempt};
   }catch(e){if(!committed)await cx.query('ROLLBACK').catch(()=>{});throw e;}
   finally{cx.release();}
  }
 });
}
