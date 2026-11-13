/** Native Stars-paid PHOTO is the purchase UI; the merchandise is a sticker pack.
 * Video sales, invoices and their ledgers are never touched here.
 */
export function createStickerPaidPhotoFlow({api,sessionStore,show,paidPhotoStore}={}){
 if(typeof api!=='function'||typeof sessionStore?.read!=='function'||typeof show!=='function'||
    !paidPhotoStore||['capturePurchase','getEntitlement','getSale','listPurchases','deliveryRows',
     'claimItem','itemSent','itemUnknown','redeliver'].some(k=>typeof paidPhotoStore[k]!=='function'))
  throw Error('STICKER_PAID_PHOTO_FLOW_UNAVAILABLE');
 async function receive(userId,saleId,attempt=1){
  const receipt=await paidPhotoStore.getSale({buyerId:userId,saleId});
  if(!receipt)throw Error('STICKER_PAID_PHOTO_ENTITLEMENT_REQUIRED');
  const items=typeof receipt.items==='string'?JSON.parse(receipt.items):receipt.items;
  const rows=await paidPhotoStore.deliveryRows({saleId,attempt});
  if(!Array.isArray(items)||rows.length!==items.length)
    throw Error('STICKER_PAID_PHOTO_DELIVERY_COUNT_MISMATCH');
  let count=0,warning=false;
  for(const row of rows){
   if(row.status==='unknown'||row.status==='sending')warning=true;
   if(row.status!=='pending'||count>=3)continue;
   const item=await paidPhotoStore.claimItem({saleId,buyerId:userId,attempt,index:row.item_index});
   if(!item)continue;
   try{
    const sent=await api('sendSticker',{chat_id:userId,sticker:item.file_id});
    if(!Number.isSafeInteger(sent?.message_id)||sent.message_id<=0)
      throw Error('STICKER_PAID_PHOTO_DELIVERY_UNKNOWN');
    await paidPhotoStore.itemSent({saleId,attempt,index:row.item_index,messageId:sent.message_id});
   }catch{
    await paidPhotoStore.itemUnknown({saleId,attempt,index:row.item_index}).catch(()=>{});
    warning=true;
   }
   count++;
  }
  const old=await sessionStore.read(userId);
  return show(userId,old,{screen:'sticker_sale_paid_delivery',
   stickerSale:{mode:'paid_photo',paidPhotoSaleId:saleId,productId:receipt.product_id,
    title:receipt.title,version:Number(receipt.version),attempt,deliveryWarning:warning}});
 }
 async function claim(userId,productId){
  const q=await paidPhotoStore.getEntitlement({buyerId:userId,productId});
  if(!q){
   const old=await sessionStore.read(userId);
   if(old?.stickerPending||old?.stickerEditPending)return {handled:true,locked:true};
   return show(userId,old,{screen:'sticker_sale_paid_unpaid',
    stickerSale:{mode:'paid_photo',productId}});
  }
  return receive(userId,Number(q.sale_id),1);
 }
 async function purchased(update){
  const result=await paidPhotoStore.capturePurchase(update);
  return {handled:true,purchaseRecorded:result.recorded===true,
   duplicate:result.duplicate===true,productId:result.productId};
 }
 async function callback({action,userId,old,d}){
  if(action==='sale:paid_check'&&old.screen==='sticker_sale_paid_unpaid'&&
     d.mode==='paid_photo'&&/^sp_[a-f0-9]{24}$/.test(d.productId??''))
    return claim(userId,d.productId);
  if(action==='sale:paid_next'&&old.screen==='sticker_sale_paid_delivery'&&
     d.mode==='paid_photo'&&Number.isSafeInteger(d.paidPhotoSaleId))
    return receive(userId,d.paidPhotoSaleId,d.attempt??1);
  if(action==='sale:paid_redeliver'&&old.screen==='sticker_sale_paid_delivery'&&
     d.mode==='paid_photo'&&Number.isSafeInteger(d.paidPhotoSaleId)){
    const next=await paidPhotoStore.redeliver({saleId:d.paidPhotoSaleId,buyerId:userId});
    return receive(userId,d.paidPhotoSaleId,next.attempt);
  }
  return {handled:true,staleButton:true};
 }
 return Object.freeze({receive,claim,purchased,callback,listPurchases:paidPhotoStore.listPurchases});
}
