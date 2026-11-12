import {randomBytes} from 'node:crypto';

const button=(text,action,rev)=>({text,callback_data:action+'|r'+rev});
const MONEY_TERMS='Telegramの公開パックは購入者だけに限定できず、第三者への再共有も防止できません。購入対象は現時点の素材版です。素材はBotのDMへ送ります。購入済みの再取得に追加Starsは請求しませんが、Telegramのファイル保持が失効した素材の再送は保証できません。通常の自己都合返金メニューはありません。公式の決済異議は /paysupport で受け付けます。';
const validId=id=>typeof id==='string'&&/^sp_[a-f0-9]{24}$/.test(id);
function actor(update){
 const m=update?.callback_query?.message??update?.message;
 const from=update?.callback_query?.from??update?.message?.from;
 if(m?.chat?.type!=='private'||m.chat.id!==from?.id||!Number.isSafeInteger(from.id)||from.id<=0)
   throw Error('STICKER_SALE_OWNER_REQUIRED');
 return {userId:from.id,messageId:m.message_id};
}
export function createStickerSalesFlow({api,sessionStore,screenTransport,salesStore,packInventory,publishSnapshot}={}){
 if(typeof api!=='function'||typeof sessionStore?.read!=='function'||
    typeof sessionStore?.write!=='function'||typeof sessionStore?.setScreen!=='function'||
    typeof screenTransport?.show!=='function'||typeof salesStore?.reserveOrder!=='function'||
    typeof salesStore?.capturePayment!=='function'||typeof packInventory?.getOwnedPack!=='function'||
    typeof publishSnapshot!=='function')throw Error('STICKER_SALE_DEPENDENCIES_MISSING');
 async function show(userId,old,patch){
   const revision=(old?.revision??0)+1,session={...old,...patch,revision};
   await sessionStore.write(userId,revision-1,session);
   const d=session.stickerSale??{},b=(name,action)=>button(name,action,revision);
   let text,keyboard=[];
   switch(session.screen){
    case 'sticker_sale_price':
      text='💰 パック販売価格を1〜25000 Starsの整数で送信してください。動画の30%管理費はこの商品へ適用しません。';
      keyboard=[[b('↩ パックへ','sale:cancel')]];break;
    case 'sticker_sale_confirm':
      text='💰 '+d.title+'\n価格：'+d.price+' Stars\n'+MONEY_TERMS+
        '\n\n公開する商品版は後から上書きしません。';
      keyboard=[[b('✅ この版を公開','sale:publish')],[b('↩ 価格を修正','sale:price'),b('中止','sale:cancel')]];break;
    case 'sticker_sale_published':
      text='✅ 商品版を登録しました。購入者向けリンク：\n'+d.link+
        '\n\n商品版は固定され、パックの編集で購入者の版が変わることはありません。';
      keyboard=[[b('↩ メニューへ','sale:cancel')]];break;
    case 'sticker_sale_offer':
      text='📦 '+d.title+'（版'+d.version+'）\n価格：'+d.price+' Stars\n\n'+MONEY_TERMS;
      keyboard=[[b('同意して購入へ','sale:accept')],[b('↩ 戻る','sale:cancel')]];break;
    case 'sticker_sale_agreed':
      text='購入内容：'+d.title+'\n価格：'+d.price+
        ' Stars\n購入条件を承諾しました。次にTelegram公式のStars請求へ進みます。';
      keyboard=[[b('⭐ Starsで購入','sale:pay')],[b('↩ 戻る','sale:offer')]];break;
    case 'sticker_sale_invoice':
      text='⭐ Telegramの請求書を送信しました。お支払い完了後に素材を受け取れます。';
      keyboard=[[b('📦 購入済み商品','sale:purchases')]];break;
    case 'sticker_sale_invoice_unknown':
      text='⚠️ 請求書送信結果を確認できません。二重請求防止のため再発行しません。届いた請求書で決済するか、決済状況を確認してください。';
      keyboard=[[b('📦 購入済み商品','sale:purchases')]];break;
    case 'sticker_sale_purchases':
      text='📦 購入済み商品（最大10件）\n再取得は追加Stars不要です。';
      keyboard=[...(d.purchases??[]).map((p,i)=>[b(p.title+'（版'+p.version+'）','sale:owned:'+i)]),
        [b('↩ 戻る','sale:cancel')]];break;
    case 'sticker_sale_delivery':
      text='✅ 購入を確認しました。素材はこのDMへ順番に送信します。\n'+
        '途中で止まった場合は［続ける］、受け取り直す場合は［再取得］を選んでください。'+
        (d.deliveryWarning?'\n⚠️ 未確認の送信があります。二重送信を防ぐため自動再送は行いません。':'');
      keyboard=[[b('📥 続けて受け取る','sale:next'),b('🔄 無料で再取得','sale:redeliver')],
        [b('📦 購入済み商品','sale:purchases')]];break;
    default:throw Error('STICKER_SALE_SCREEN_INVALID');
   }
   const result=await screenTransport.show(userId,session.screenMessageId??null,{
     text,reply_markup:{inline_keyboard:keyboard}});
   if(result?.messageId!==session.screenMessageId)
     await sessionStore.setScreen(userId,revision,result.messageId);
   return {handled:true,revision,messageId:result?.messageId};
 }
 async function beginSell({ownerId,packName}){
   const pack=await packInventory.getOwnedPack(ownerId,packName);
   if(!pack)throw Error('STICKER_SALE_PACK_OWNER_REQUIRED');
   const old=await sessionStore.read(ownerId);
   if(old?.stickerPending||old?.stickerEditPending)return {handled:true,locked:true};
   return show(ownerId,old,{screen:'sticker_sale_price',stickerSale:{
     mode:'seller',packName,title:pack.title,kind:pack.kind
   }});
 }
 async function openOffer(userId,productId){
   if(!validId(productId))return {handled:true,invalidProduct:true};
   const product=await salesStore.getPublished(productId);
   if(!product||product.status!=='published')
     return {handled:true,unavailable:true};
   const old=await sessionStore.read(userId);
   if(old?.stickerPending||old?.stickerEditPending)return {handled:true,locked:true};
   return show(userId,old,{screen:'sticker_sale_offer',stickerSale:{
     mode:'buyer',productId:product.product_id,title:product.title,
     version:product.version,price:Number(product.price_stars)
   }});
 }
 async function sendInvoice(userId,session){
   const draft=session.stickerSale;
   const order=await salesStore.reserveOrder({productId:draft.productId,buyerId:userId});
   if(order.invoice_state==='paid')
     return receiveOrder(userId,order.order_id,1);
   if(order.invoice_state!=='prepared'){
     return show(userId,await sessionStore.read(userId),{
       screen:order.invoice_state==='sent'?'sticker_sale_invoice':'sticker_sale_invoice_unknown',
       stickerSale:{...draft,orderId:order.order_id}
     });
   }
   const claimed=await salesStore.startInvoice(order.order_id,userId);
   if(!claimed)
     return show(userId,await sessionStore.read(userId),{
       screen:'sticker_sale_invoice_unknown',stickerSale:{...draft,orderId:order.order_id}
     });
   try{
     const message=await api('sendInvoice',{
       chat_id:userId,title:String(draft.title).slice(0,32),
       description:'購入したステッカー素材版をBot DMでお届けします。',
       payload:'stk:'+order.order_id,currency:'XTR',
       prices:[{label:String(draft.title).slice(0,32),amount:Number(claimed.price_stars)}]
     });
     if(!Number.isSafeInteger(message?.message_id)||message.message_id<=0)
       throw Error('STICKER_SALE_INVOICE_RESULT_UNKNOWN');
     await salesStore.invoiceSent(order.order_id,userId,message.message_id);
     return show(userId,await sessionStore.read(userId),{
       screen:'sticker_sale_invoice',stickerSale:{...draft,orderId:order.order_id}
     });
   }catch{
     await salesStore.invoiceUnknown(order.order_id);
     return show(userId,await sessionStore.read(userId),{
       screen:'sticker_sale_invoice_unknown',stickerSale:{...draft,orderId:order.order_id}
     });
   }
 }
 async function deliverSome(userId,orderId,attempt){
   const order=await salesStore.getPaidOrder(orderId,userId);
   if(!order)throw Error('STICKER_SALE_NOT_PURCHASED');
   const items=typeof order.items==='string'?JSON.parse(order.items):order.items;
   const statuses=await salesStore.getDeliveryRows(orderId,attempt);
   let count=0,warning=false;
   for(const row of statuses){
     if(row.status==='unknown'||row.status==='sending')warning=true;
     if(row.status!=='pending'||count>=3)continue;
     const item=await salesStore.claimItem({orderId,buyerId:userId,attempt,index:row.item_index});
     if(!item)continue;
     try{
       const sent=await api('sendSticker',{chat_id:userId,sticker:item.file_id});
       if(!Number.isSafeInteger(sent?.message_id)||sent.message_id<=0)
         throw Error('STICKER_SALE_DELIVERY_UNKNOWN');
       await salesStore.itemSent({orderId,attempt,index:row.item_index,messageId:sent.message_id});
     }catch{
       await salesStore.itemUnknown({orderId,attempt,index:row.item_index}).catch(()=>{});
       warning=true;
     }
     count++;
   }
   return {warning,remaining:Math.max(0,items.length-statuses.filter(r=>r.status==='sent').length-count)};
 }
 async function receiveOrder(userId,orderId,attempt){
   const current=await sessionStore.read(userId);
   const result=await deliverSome(userId,orderId,attempt);
   return show(userId,current,{screen:'sticker_sale_delivery',
     stickerSale:{...current?.stickerSale,mode:'buyer',orderId,attempt,
       deliveryWarning:result.warning}});
 }
 async function payments(update){
   if(update?.pre_checkout_query){
     const q=update.pre_checkout_query;
     const ok=await salesStore.checkPreCheckout(q).catch(()=>false);
     await api('answerPreCheckoutQuery',{pre_checkout_query_id:q.id,ok,
       ...(ok?{}:{error_message:'注文内容を確認できません。重複決済を防ぐため購入を中止しました。'})});
     return {handled:true,preCheckoutApproved:ok};
   }
   const m=update?.message,sp=m?.successful_payment;
   if(!sp||!/^stk:so_[a-f0-9]{24}$/.test(String(sp.invoice_payload??'')))
     return {handled:false};
   const {userId}=actor(update);
   const saved=await salesStore.capturePayment({
     buyerId:userId,successfulPayment:sp,updateId:update.update_id});
   // A verified paid receipt MUST be acknowledged even if Telegram delivery
   // fails: payment retry must never become a second charge.
   try{await receiveOrder(userId,saved.orderId,1);}catch{/* paid receipt stays durable */}
   return {handled:true,paymentRecorded:true,duplicate:saved.duplicate};
 }
 async function handle(update){
   const m=update?.message,cb=update?.callback_query;
   if(m?.text&&/^\/start(?:@[A-Za-z0-9_]+)?\s+buy_sp_[a-f0-9]{24}$/.test(m.text.trim())){
     const {userId}=actor(update);
     return openOffer(userId,m.text.trim().split('buy_')[1]);
   }
   if(!cb?.data?.startsWith('sale:')) {
     if(m?.chat?.type==='private'){
       const old=await sessionStore.read(m.chat.id);
       if(old?.screen==='sticker_sale_price'&&old?.stickerSale?.mode==='seller'){
         const {userId}=actor(update);
         try{
           const value=String(m.text??'').trim();
           const stars=Number(value);
           if(!/^[1-9][0-9]{0,4}$/.test(value)||stars>25000)
             return show(userId,old,{screen:'sticker_sale_price'});
           return show(userId,old,{screen:'sticker_sale_confirm',
             stickerSale:{...old.stickerSale,price:stars}});
         }finally{await api('deleteMessage',{chat_id:userId,message_id:m.message_id}).catch(()=>{});}
       }
     }
     return {handled:false};
   }
   const {userId,messageId}=actor(update);
   await api('answerCallbackQuery',{callback_query_id:cb.id});
   const old=await sessionStore.read(userId);
   const match=/^(sale:[a-z_]+(?::[0-9]+)?)\|r([1-9][0-9]*)$/.exec(cb.data);
   if(!match||Number(match[2])!==old?.revision||old?.screenMessageId!==messageId)
     return {handled:true,staleButton:true};
   if(old.stickerPending||old.stickerEditPending)return {handled:true,locked:true};
   const action=match[1],d=old.stickerSale??{};
   if(action==='sale:cancel')
     return show(userId,old,{screen:'sticker_sale_purchases',
       stickerSale:{mode:'buyer',purchases:await salesStore.listPurchases(userId)}});
   if(action==='sale:price'&&d.mode==='seller')
     return show(userId,old,{screen:'sticker_sale_price'});
   if(action==='sale:publish'&&old.screen==='sticker_sale_confirm'&&d.mode==='seller'){
     // Revision is claimed BEFORE any irreversible publish. A timed-out
     // request cannot be repeated by a stale button.
     await sessionStore.write(userId,old.revision,{
       ...old,revision:old.revision+1,screen:'sticker_sale_publishing'});
     const product=await publishSnapshot({
       sellerId:userId,packName:d.packName,priceStars:d.price});
     const me=await api('getMe',{});
     if(me?.is_bot!==true||typeof me.username!=='string')
       throw Error('STICKER_SALE_BOT_IDENTITY_UNAVAILABLE');
     const fresh=await sessionStore.read(userId);
     return show(userId,fresh,{screen:'sticker_sale_published',
       stickerSale:{...d,productId:product.productId,
         link:'https://t.me/'+me.username+'?start=buy_'+product.productId}});
   }
   if(action==='sale:offer'&&d.mode==='buyer')
     return openOffer(userId,d.productId);
   if(action==='sale:accept'&&old.screen==='sticker_sale_offer')
     return show(userId,old,{screen:'sticker_sale_agreed',
       stickerSale:{...d,accepted:true}});
   if(action==='sale:pay'&&old.screen==='sticker_sale_agreed'&&d.accepted===true)
     return sendInvoice(userId,old);
   if(action==='sale:purchases'){
     const purchases=await salesStore.listPurchases(userId);
     return show(userId,old,{screen:'sticker_sale_purchases',
       stickerSale:{...d,mode:'buyer',purchases}});
   }
   if(action.startsWith('sale:owned:')&&old.screen==='sticker_sale_purchases'){
     const idx=Number(action.slice('sale:owned:'.length));
     const selected=d.purchases?.[idx];
     if(!selected)return {handled:true,staleButton:true};
     return receiveOrder(userId,selected.order_id,1);
   }
   if(action==='sale:next'&&old.screen==='sticker_sale_delivery')
     return receiveOrder(userId,d.orderId,d.attempt??1);
   if(action==='sale:redeliver'&&old.screen==='sticker_sale_delivery'){
     const created=await salesStore.createRedelivery(d.orderId,userId);
     return receiveOrder(userId,d.orderId,created.attempt);
   }
   return {handled:true,staleButton:true};
 }
 return Object.freeze({handle,payments,beginSell,openOffer,receiveOrder});
}
