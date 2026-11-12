import {randomBytes} from 'node:crypto';
import {menuPage} from './menuPanel.mjs';

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
export function createStickerSalesFlow({api,sessionStore,screenTransport,salesStore,packInventory,publishSnapshot,topicPublisher,giftStore}={}){
 if(typeof api!=='function'||typeof sessionStore?.read!=='function'||
    typeof sessionStore?.write!=='function'||typeof sessionStore?.setScreen!=='function'||
    typeof screenTransport?.show!=='function'||typeof salesStore?.reserveOrder!=='function'||
    typeof salesStore?.capturePayment!=='function'||typeof packInventory?.getOwnedPack!=='function'||
    typeof publishSnapshot!=='function'||(giftStore!==undefined&&giftStore!==null&&
    ['prepare','redeem','getReceived','listReceived','deliveryRows','claimItem','itemSent','itemUnknown','redeliver','status'].some(k=>typeof giftStore[k]!=='function'))||
    (topicPublisher!==undefined&&topicPublisher!==null&&
    (typeof topicPublisher.publish!=='function'||typeof topicPublisher.edit!=='function'||
     typeof topicPublisher.remove!=='function')))throw Error('STICKER_SALE_DEPENDENCIES_MISSING');
 async function show(userId,old,patch){
   const revision=(old?.revision??0)+1,session={...old,...patch,revision};
   await sessionStore.write(userId,revision-1,session);
   const d=session.stickerSale??{},b=(name,action)=>button(name,action,revision);
   let text,keyboard=[];
   switch(session.screen){
    case 'sticker_sale_price':
      text='💰 パック販売価格を1〜25000 Starsの整数で送信してください。動画の30%管理費はこの商品へ適用しません。';
      keyboard=[[b('↩ メニューへ','sale:cancel')]];break;
    case 'sticker_sale_confirm':
      text='💰 '+d.title+'\n価格：'+d.price+' Stars\n'+MONEY_TERMS+
        '\n\n公開する商品版は後から上書きしません。';
      keyboard=[[b('✅ この版を公開','sale:publish')],[b('↩ 価格を修正','sale:price'),b('中止','sale:cancel')]];break;
    case 'sticker_sale_published':
      text='✅ 商品版を登録しました。購入者向けリンク：\n'+d.link+
        '\n\n商品版は固定され、パックの編集で購入者の版が変わることはありません。'+
        (d.topicStatus==='sent'?'\n\n投稿先：'+d.groupTitle+'／'+d.topicTitle:
         '\n\n⚠️ 投稿先Topicの接続・公開をまだ確認できません。Topicへの投稿完了ではありません。');
      keyboard=[
        ...(d.topicStatus==='sent'?[
          [b('✏️ 投稿文を編集','sale:post_edit'),b('🗑 投稿を削除','sale:post_delete')],
          [{text:'🔗 投稿先を開く',url:d.topicLink}]
        ]:[]),
        [b('↩ メニューへ','sale:cancel')]
      ];break;
    case 'sticker_sale_post_edit':
      text='✏️ 投稿の紹介文だけを入力してください（400文字以内）。商品素材・価格・購入済み権利は変更しません。';
      keyboard=[[b('↩ 戻る','sale:post_back')]];break;
    case 'sticker_sale_post_delete_confirm':
      text='⚠️ 公開投稿を削除すると新規販売を停止します。すでに購入された商品の再取得権利と決済履歴は残します。';
      keyboard=[[b('🗑 投稿を削除','sale:post_delete_confirm')],[b('↩ やめる','sale:post_back')]];break;
    case 'sticker_sale_post_deleted':
      text='✅ 公開投稿を削除し、商品の新規販売を停止しました。購入済み権利は維持されています。';
      keyboard=[[b('↩ メニューへ','sale:cancel')]];break;
    case 'sticker_sale_post_unknown':
      text='⚠️ Topic投稿または編集・削除の結果を確認できません。二重操作を防ぐため再送しません。管理者による実状態の照合が必要です。';
      keyboard=[[b('↩ メニューへ','sale:cancel')]];break;
    case 'sticker_sale_publish_unknown':
      text='⚠️ 商品版の登録結果を確認できません。二重作成を防ぐため、同じ商品番号で状態を確認します。';
      keyboard=[[b('🔄 登録状態を確認','sale:check_publish')],
        [b('📦 同じ商品番号で続ける','sale:retry_publish')],
        [b('↩ メニューへ','sale:cancel')]];break;
    case 'sticker_sale_offer':
      text='📦 '+d.title+'（版'+d.version+'）\n価格：'+d.price+' Stars\n\n'+MONEY_TERMS;
      keyboard=[[b('同意して購入へ','sale:accept')],[b('↩ 戻る','sale:cancel')]];break;
    case 'sticker_sale_agreed':
      text='購入内容：'+d.title+'\n価格：'+d.price+
        ' Stars\n購入条件を承諾しました。次にTelegram公式のStars請求へ進みます。';
      keyboard=[[b('⭐ Starsで購入','sale:pay')],[b('↩ 戻る','sale:offer')]];break;
    case 'sticker_sale_invoice':
      text='⭐ Telegramの請求書を送信しました。お支払い完了後に素材を受け取れます。';
      keyboard=[[b('📦 購入済み商品','sale:purchases'),b('決済サポート','sale:support')]];break;
    case 'sticker_sale_invoice_unknown':
      text='⚠️ 請求書送信結果を確認できません。二重請求防止のため再発行しません。届いた請求書で決済するか、決済状況を確認してください。';
      keyboard=[[b('📦 購入済み商品','sale:purchases')]];break;
    case 'sticker_sale_support':
      text='🆘 Stars購入・納品に関する問題を1〜1000文字で送信してください（5文字以上）。\n決済番号などの個人情報は必要最小限にしてください。'+
        (d.supportError?'\n⚠️ 入力は5〜1000文字にしてください。':'');
      keyboard=[[b('↩ メニューへ','sale:cancel')]];break;
    case 'sticker_sale_support_done':
      text='✅ 決済に関するお問い合わせを受付台帳へ保存しました。運営側で確認が必要です。自動返金・自動解決を約束するものではありません。';
      keyboard=[[b('↩ メニューへ','sale:cancel')]];break;
    case 'sticker_sale_purchases':
      text='📦 購入済み商品（最大10件）\n再取得は追加Stars不要です。';
      keyboard=[...(d.purchases??[]).map((p,i)=>[b(p.title+'（版'+p.version+'）','sale:owned:'+i)]),
        ...(giftStore?[[b('🎁 受け取ったプレゼント','sale:gift_inbox')]]:[]),
        [b('↩ 戻る','sale:cancel')]];break;
    case 'sticker_sale_gift_ready':
      text='🎁 プレゼントの準備ができました。\n'+
        '［相手を選んで送る］からTelegramで送り先を指定してください。\n'+
        '受取リンクは1回限り有効です。最初に開いて受領した人に確定するため、転送されないようご注意ください。\n'+
        '購入済み商品はあなたの手元にも残ります。追加Starsは発生しません。';
      keyboard=[[{text:'🎁 相手を選んで送る',url:d.shareUrl}],
        [b('↩ 購入済み商品に戻る','sale:gift_back')]];break;
    case 'sticker_sale_gift_unknown':
      text='⚠️ プレゼントの作成結果を確認できません。二重作成防止のため、同じプレゼント番号で再確認します。';
      keyboard=[[b('🔄 同じプレゼントを確認','sale:gift_retry')],
        [b('↩ 購入済み商品に戻る','sale:gift_back')]];break;
    case 'sticker_sale_gift_unavailable':
      text='🎁 このプレゼントは受け取れません。すでに別の人が受領したか、リンクが正しくありません。送り主に確認してください。';
      keyboard=[[b('📦 購入済み・受取済み','sale:purchases')],[b('↩ メニュー','sale:cancel')]];break;
    case 'sticker_sale_gift_inbox':
      text='🎁 受け取ったプレゼント（最大10件）\n再取得にもStarsはかかりません。';
      keyboard=[...(d.receivedGifts??[]).map((g,i)=>[
        b(g.title+'（版'+g.version+'）','sale:received:'+i)]),
        [b('📦 購入済みに戻る','sale:purchases')]];break;
    case 'sticker_sale_delivery':
      text=(d.giftId?'🎁 プレゼントを受け取りました。':'✅ 購入を確認しました。')+
        '素材はこのDMへ順番に送信します。\n'+
        '途中で止まった場合は［続ける］、受け取り直す場合は［再取得］を選んでください。'+
        (d.deliveryWarning?'\n⚠️ 未確認の送信があります。二重送信を防ぐため自動再送は行いません。':'');
      keyboard=[[b('📥 続けて受け取る','sale:next'),b('🔄 無料で再取得','sale:redeliver')],
        ...(d.orderId&&d.mode==='buyer'&&giftStore?[[b('🎁 プレゼントする','sale:gift')]]:[]),
        [b('📦 購入済み・受取済み','sale:purchases'),b('決済サポート','sale:support')]];break;
    default:throw Error('STICKER_SALE_SCREEN_INVALID');
   }
   const result=await screenTransport.show(userId,session.screenMessageId??null,{
     text,reply_markup:{inline_keyboard:keyboard}});
   if(result?.messageId!==session.screenMessageId)
     await sessionStore.setScreen(userId,revision,result.messageId);
   return {handled:true,revision,messageId:result?.messageId};
 }
 async function exitSale(userId,old){
   const revision=old.revision+1;
   const next={...old,revision,screen:'home',stickerSale:null};
   await sessionStore.write(userId,old.revision,next);
   const result=await screenTransport.show(userId,next.screenMessageId??null,menuPage('home'));
   if(result?.messageId!==next.screenMessageId)
     await sessionStore.setScreen(userId,revision,result.messageId);
   return {handled:true};
 }
 async function sendToTopic(userId,d){
   if(!topicPublisher)return {topicStatus:'not_connected'};
   try{
     const post=await topicPublisher.publish({
       sellerId:userId,productId:d.productId});
     if(post.posted!==true)return {topicStatus:'unverified'};
     return {topicStatus:'sent',groupTitle:post.groupTitle,
       topicTitle:post.topicTitle,topicLink:post.link};
   }catch{
     return {topicStatus:'unverified'};
   }
 }
 async function finishPublish(userId,d){
   const product=await salesStore.getPublished(d.productId);
   if(!product||String(product.seller_user_id)!==String(userId)||
      product.pack_name!==d.packName||Number(product.price_stars)!==d.price)
     throw Error('STICKER_SALE_PUBLISH_RECEIPT_MISMATCH');
   const me=await api('getMe',{});
   if(me?.is_bot!==true||typeof me.username!=='string')
     throw Error('STICKER_SALE_BOT_IDENTITY_UNAVAILABLE');
   const topic=await sendToTopic(userId,d);
   return show(userId,await sessionStore.read(userId),{
     screen:'sticker_sale_published',stickerSale:{...d,version:product.version,
       link:'https://t.me/'+me.username+'?start=buy_'+d.productId,...topic}
   });
 }
 async function attemptPublish(userId,d){
   const existing=await salesStore.getPublished(d.productId);
   if(!existing)
     await publishSnapshot({sellerId:userId,packName:d.packName,
       priceStars:d.price,productId:d.productId});
   return finishPublish(userId,d);
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
 async function giftReady(userId,d){
   if(!giftStore||!d.giftId||!d.giftToken||!d.orderId)
     throw Error('STICKER_GIFT_SESSION_INVALID');
   const paid=await salesStore.getPaidOrder(d.orderId,userId);
   if(!paid)throw Error('STICKER_GIFT_PURCHASE_UNVERIFIED');
   await giftStore.prepare({giftId:d.giftId,token:d.giftToken,
     donorOrderId:d.orderId,donorId:userId});
   const me=await api('getMe',{});
   if(me?.is_bot!==true||typeof me.username!=='string'||
      !/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(me.username))
     throw Error('STICKER_GIFT_BOT_NOT_VERIFIED');
   const deepLink='https://t.me/'+me.username+'?start=gift_'+d.giftToken;
   const shareUrl='https://t.me/share/url?url='+encodeURIComponent(deepLink)+
     '&text='+encodeURIComponent('🎁 ステッカーをプレゼントします。Botを開いて受け取ってください。');
   return show(userId,await sessionStore.read(userId),{
     screen:'sticker_sale_gift_ready',
     stickerSale:{...d,shareUrl}
   });
 }
 async function redeemGift(userId,secret){
   if(!giftStore)return {handled:true,unavailable:true};
   try{
     const receipt=await giftStore.redeem({token:secret,recipientId:userId});
     return receiveOrder(userId,receipt.giftId,1,{gift:true});
   }catch{
     const current=await sessionStore.read(userId);
     return show(userId,current,{screen:'sticker_sale_gift_unavailable',
       stickerSale:{mode:'gift_recipient'}});
   }
 }
  async function deliverSome(userId,orderId,attempt,{gift=false}={}){
   const provider=gift?giftStore:salesStore;
   const order=gift?
     await provider?.getReceived(orderId,userId):
     await provider.getPaidOrder(orderId,userId);
   if(!order)throw Error('STICKER_SALE_ENTITLEMENT_REQUIRED');
   const items=typeof order.items==='string'?JSON.parse(order.items):order.items;
   const statuses=gift?
     await provider.deliveryRows(orderId,attempt):
     await provider.getDeliveryRows(orderId,attempt);
   let count=0,warning=false;
   for(const row of statuses){
     if(row.status==='unknown'||row.status==='sending')warning=true;
     if(row.status!=='pending'||count>=3)continue;
     const item=gift?
       await giftStore.claimItem({giftId:orderId,recipientId:userId,attempt,index:row.item_index}):
       await salesStore.claimItem({orderId,buyerId:userId,attempt,index:row.item_index});
     if(!item)continue;
     try{
       const sent=await api('sendSticker',{chat_id:userId,sticker:item.file_id});
       if(!Number.isSafeInteger(sent?.message_id)||sent.message_id<=0)
         throw Error('STICKER_SALE_DELIVERY_UNKNOWN');
       if(gift)
         await giftStore.itemSent({giftId:orderId,attempt,index:row.item_index,messageId:sent.message_id});
       else
         await salesStore.itemSent({orderId,attempt,index:row.item_index,messageId:sent.message_id});
     }catch{
       if(gift)
         await giftStore.itemUnknown({giftId:orderId,attempt,index:row.item_index}).catch(()=>{});
       else
         await salesStore.itemUnknown({orderId,attempt,index:row.item_index}).catch(()=>{});
       warning=true;
     }
     count++;
   }
   return {warning,remaining:Math.max(0,items.length-statuses.filter(r=>r.status==='sent').length-count)};
 }
 async function receiveOrder(userId,orderId,attempt,{gift=false}={}){
   const current=await sessionStore.read(userId);
   const result=await deliverSome(userId,orderId,attempt,{gift});
   return show(userId,current,{screen:'sticker_sale_delivery',
     stickerSale:{...current?.stickerSale,mode:gift?'gift_recipient':'buyer',
       orderId:gift?null:orderId,giftId:gift?orderId:null,
       attempt,deliveryWarning:result.warning}});
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
   if(m?.text&&/^\/start(?:@[A-Za-z0-9_]+)?\s+gift_[A-Za-z0-9_-]{32}$/.test(m.text.trim())){
     const {userId}=actor(update);
     return redeemGift(userId,m.text.trim().split('gift_')[1]);
   }
   if(m?.text&&/^\/paysupport(?:@[A-Za-z0-9_]+)?$/.test(m.text.trim())){
     const {userId}=actor(update);
     const old=await sessionStore.read(userId);
     return show(userId,old,{screen:'sticker_sale_support',
       stickerSale:{...old?.stickerSale,mode:'buyer',supportError:false}});
   }
   if(m?.text&&/^\/start(?:@[A-Za-z0-9_]+)?\s+buy_sp_[a-f0-9]{24}$/.test(m.text.trim())){
     const {userId}=actor(update);
     return openOffer(userId,m.text.trim().split('buy_')[1]);
   }
   if(m?.text&&/^\/start(?:@[A-Za-z0-9_]+)?(?:\s|$)/.test(m.text.trim())){
     const {userId}=actor(update);
     const old=await sessionStore.read(userId);
     if(old?.screen==='sticker_sale_publishing'||old?.screen==='sticker_sale_publish_unknown')
       return show(userId,old,{screen:'sticker_sale_publish_unknown'});
   }
   if(!cb?.data?.startsWith('sale:')) {
     if(m?.chat?.type==='private'){
       const old=await sessionStore.read(m.chat.id);
       if(old?.screen==='sticker_sale_support'){
         const {userId}=actor(update);
         try{
           const details=String(m.text??'').trim();
           if(details.length<5||details.length>1000)
             return show(userId,old,{screen:'sticker_sale_support',
               stickerSale:{...old.stickerSale,supportError:true}});
           await salesStore.createPaymentSupport({buyerId:userId,
             orderId:old.stickerSale?.orderId??null,details});
           return show(userId,old,{screen:'sticker_sale_support_done',
             stickerSale:{...old.stickerSale,supportError:false}});
         }finally{await api('deleteMessage',{chat_id:userId,message_id:m.message_id}).catch(()=>{});}
       }
       if(old?.screen==='sticker_sale_post_edit'&&old?.stickerSale?.mode==='seller'){
         const {userId}=actor(update);
         try{
           const desc=String(m.text??'').trim();
           if(desc.length>400||!desc)
             return show(userId,old,{screen:'sticker_sale_post_edit'});
           try{
             if(!topicPublisher)throw Error('STICKER_TOPIC_OWNER_UNAVAILABLE');
             await topicPublisher.edit({sellerId:userId,
               productId:old.stickerSale.productId,description:desc});
             return show(userId,old,{screen:'sticker_sale_published',
               stickerSale:{...old.stickerSale,description:desc}});
           }catch{
             return show(userId,old,{screen:'sticker_sale_post_unknown'});
           }
         }finally{await api('deleteMessage',{chat_id:userId,message_id:m.message_id}).catch(()=>{});}
       }
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
   if(action==='sale:cancel')return exitSale(userId,old);
   if(action==='sale:support')
     return show(userId,old,{screen:'sticker_sale_support',
       stickerSale:{...d,mode:'buyer',supportError:false}});
   if(action==='sale:post_edit'&&old.screen==='sticker_sale_published'&&
      d.mode==='seller'&&d.topicStatus==='sent'&&topicPublisher)
     return show(userId,old,{screen:'sticker_sale_post_edit'});
   if(action==='sale:post_delete'&&old.screen==='sticker_sale_published'&&
      d.mode==='seller'&&d.topicStatus==='sent'&&topicPublisher)
     return show(userId,old,{screen:'sticker_sale_post_delete_confirm'});
   if(action==='sale:post_back'&&['sticker_sale_post_edit','sticker_sale_post_delete_confirm'].includes(old.screen))
     return show(userId,old,{screen:'sticker_sale_published'});
   if(action==='sale:post_delete_confirm'&&old.screen==='sticker_sale_post_delete_confirm'&&
      d.mode==='seller'&&d.topicStatus==='sent'&&topicPublisher){
     // Claim the DM revision before Telegram deletion, preserving old
     // purchase entitlements and avoiding a repeat from a stale button.
     await sessionStore.write(userId,old.revision,{
       ...old,revision:old.revision+1,screen:'sticker_sale_post_deleting'});
     try{
       const removed=await topicPublisher.remove({sellerId:userId,productId:d.productId});
       if(removed.verified!==true)throw Error('STICKER_TOPIC_DELETE_NOT_VERIFIED');
       return show(userId,await sessionStore.read(userId),{
         screen:'sticker_sale_post_deleted',stickerSale:{...d,topicStatus:'deleted'}});
     }catch{
       return show(userId,await sessionStore.read(userId),{
         screen:'sticker_sale_post_unknown',stickerSale:{...d,topicStatus:'unverified'}});
     }
   }
   if(action==='sale:gift'&&old.screen==='sticker_sale_delivery'&&
      d.mode==='buyer'&&d.orderId&&giftStore){
     // The one-time link is prepared after CAS saves the operation ID and
     // 192-bit bearer secret; the same operation can be retried after a crash.
     const pending={...d,giftId:'sg_'+randomBytes(12).toString('hex'),
       giftToken:randomBytes(24).toString('base64url')};
     await sessionStore.write(userId,old.revision,{
       ...old,revision:old.revision+1,
       screen:'sticker_sale_gift_preparing',stickerSale:pending});
     try{return await giftReady(userId,pending);}
     catch{return show(userId,await sessionStore.read(userId),{
       screen:'sticker_sale_gift_unknown',stickerSale:pending});}
   }
   if(action==='sale:gift_retry'&&old.screen==='sticker_sale_gift_unknown'&&
      d.orderId&&d.giftToken&&giftStore){
     try{return await giftReady(userId,d);}
     catch{return show(userId,await sessionStore.read(userId),{
       screen:'sticker_sale_gift_unknown'});}
   }
   if(action==='sale:gift_back'&&
      ['sticker_sale_gift_ready','sticker_sale_gift_unknown'].includes(old.screen)&&
      d.orderId)
     return receiveOrder(userId,d.orderId,d.attempt??1);
   if(action==='sale:gift_inbox'&&giftStore){
     const receivedGifts=await giftStore.listReceived(userId);
     return show(userId,old,{screen:'sticker_sale_gift_inbox',
       stickerSale:{...d,receivedGifts,mode:'gift_recipient'}});
   }
   if(action.startsWith('sale:received:')&&old.screen==='sticker_sale_gift_inbox'&&giftStore){
     const i=Number(action.slice('sale:received:'.length));
     const entry=d.receivedGifts?.[i];
     if(!entry)return {handled:true,staleButton:true};
     return receiveOrder(userId,entry.gift_id,1,{gift:true});
   }
   if(action==='sale:price'&&d.mode==='seller')
     return show(userId,old,{screen:'sticker_sale_price'});
   if(action==='sale:publish'&&old.screen==='sticker_sale_confirm'&&d.mode==='seller'){
     const pending={...d,productId:'sp_'+randomBytes(12).toString('hex')};
     await sessionStore.write(userId,old.revision,{
       ...old,revision:old.revision+1,screen:'sticker_sale_publishing',
       stickerSale:pending});
     try{return await attemptPublish(userId,pending);}
     catch{
       return show(userId,await sessionStore.read(userId),{
         screen:'sticker_sale_publish_unknown',stickerSale:pending});
     }
   }
   if((action==='sale:check_publish'||action==='sale:retry_publish')&&
      old.screen==='sticker_sale_publish_unknown'&&d.mode==='seller'&&validId(d.productId)){
     if(action==='sale:check_publish'){
       try{return await finishPublish(userId,d);}
       catch{return show(userId,old,{screen:'sticker_sale_publish_unknown'});}
     }
     try{return await attemptPublish(userId,d);}
     catch{return show(userId,await sessionStore.read(userId),{
       screen:'sticker_sale_publish_unknown'});}
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
     return receiveOrder(userId,d.giftId??d.orderId,d.attempt??1,
       {gift:Boolean(d.giftId)});
   if(action==='sale:redeliver'&&old.screen==='sticker_sale_delivery'){
     const gift=Boolean(d.giftId);
     const created=gift?
       await giftStore.redeliver(d.giftId,userId):
       await salesStore.createRedelivery(d.orderId,userId);
     return receiveOrder(userId,d.giftId??d.orderId,created.attempt,{gift});
   }
   return {handled:true,staleButton:true};
 }
 return Object.freeze({handle,payments,beginSell,openOffer,receiveOrder});
}
