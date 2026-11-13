// STK-04. GateApp-Bot remains the only authority for live Topic routing,
// membership, release policy and pinned entry. No t.me URL suffix is an ID.
import {STICKER_MANAGEMENT_FEE_POLICY_ID} from '../sales/managementFee.mjs';
function validProduct(p){
 if(!p||typeof p.product_id!=='string'||!/^sp_[a-f0-9]{24}$/.test(p.product_id)||
    !Number.isSafeInteger(Number(p.price_stars))||Number(p.price_stars)<1||
    Number(p.price_stars)>25000||typeof p.title!=='string'||!p.title)
   throw Error('STICKER_TOPIC_PRODUCT_INVALID');
}
function stickerPaidCaption({product,description=''}={}){
 validProduct(product);
 if(Number(product.management_fee_bps)!==3000||
    product.fee_policy_id!==STICKER_MANAGEMENT_FEE_POLICY_ID||
    !product.fee_terms_accepted_at)throw Error('STICKER_PAID_PHOTO_FEE_NOT_VERIFIED');
 if(typeof description!=='string'||description.length>400||/[\0]/.test(description))
   throw Error('STICKER_TOPIC_DESCRIPTION_INVALID');
 const message='🎨 '+product.title+'\n⭐ '+Number(product.price_stars)+' Stars\n'+
   '商品：ステッカー・絵文字パックの固定版素材。\n'+
   'このStars付き画像を購入すると、CreateVdobotで素材を受け取る権利が記録されます。'+
   '購入後は［ステッカーを受け取る］からDMへ移動してください。\n'+
   '公開ステッカーセットは購入者だけに制限できず、再共有を防げません。'+
   '購入前にこの条件をご確認ください。\n'+
   '運営管理費30%／投稿者分70%。通常の自己都合返金ボタンはありません。'+
   (description?'\n'+description:'');
 if(message.length>1024)throw Error('STICKER_PAID_PHOTO_CAPTION_LIMIT');
 return message;
}
function topicGuard(topic){
 if(!topic||topic.board!=='video_chat'||topic.purpose!=='sticker'||
    topic.enabled!==true||topic.verified!==true||
    !Number.isSafeInteger(topic.chatId)||topic.chatId>=0||
    !Number.isSafeInteger(topic.threadId)||topic.threadId<=0||
    topic.groupTitle!=='ビデオChatの掲示板'||
    topic.title!=='ステッカーの公開と販売')
   throw Error('STICKER_TOPIC_NOT_VERIFIED');
 return topic;
}
const botName=s=>{if(typeof s!=='string'||!/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(s))
 throw Error('STICKER_TOPIC_BOT_INVALID');return s;};
export function publicStickerText({product,description=''}={}){
 validProduct(product);
 if(typeof description!=='string'||description.length>400||/[\0]/.test(description))
   throw Error('STICKER_TOPIC_DESCRIPTION_INVALID');
 return '🎨 '+product.title+'\n⭐ '+Number(product.price_stars)+' Stars\n'+
   '公開パックは購入者限定にできません。購入前に条件を確認してください。'+
   (description?'\n\n'+description:'');
}
export function topicMessageLink(chatId,messageId){
 if(!Number.isSafeInteger(chatId)||chatId>=0||
    !Number.isSafeInteger(messageId)||messageId<=0||
    !String(Math.abs(chatId)).startsWith('100'))
   throw Error('STICKER_TOPIC_LINK_INVALID');
 return 'https://t.me/c/'+String(Math.abs(chatId)).slice(3)+'/'+messageId;
}
export function createStickerTopicPublisher({telegramApi,getVerifiedStickerTopic,
  verifyMembership,verifyRelease,verifyReview,receiptStore,salesStore,createPaidCover}={}){
 if(typeof telegramApi!=='function'||typeof getVerifiedStickerTopic!=='function'||
    typeof verifyMembership!=='function'||typeof verifyRelease!=='function'||
    typeof verifyReview!=='function'||typeof createPaidCover!=='function'||typeof receiptStore?.claim!=='function'||
    typeof receiptStore?.getOwned!=='function'||typeof salesStore?.getPublished!=='function')
   throw Error('STICKER_TOPIC_TRUSTED_OWNER_MISSING');
 const identity=async()=>{
   const me=await telegramApi('getMe',{});
   if(me?.is_bot!==true||!Number.isSafeInteger(me.id)||me.id<=0)
     throw Error('STICKER_TOPIC_BOT_IDENTITY_INVALID');
   return {id:me.id,username:botName(me.username)};
 };
 const assertOwnPostingAccess=async({topic,botId})=>{
   const chat=await telegramApi('getChat',{chat_id:topic.chatId});
   if(chat?.id!==topic.chatId||chat.type!=='supergroup'||chat.is_forum!==true)
     throw Error('STICKER_TOPIC_GROUP_NOT_VERIFIED');
   const member=await telegramApi('getChatMember',{chat_id:topic.chatId,user_id:botId});
   if(!['administrator','creator'].includes(member?.status))
     throw Error('STICKER_TOPIC_BOT_ADMIN_NOT_VERIFIED');
 };
 const guard=async({sellerId,productId})=>{
   const product=await salesStore.getPublished(productId);
   if(!product||String(product.seller_user_id)!==String(sellerId)||
      product.status!=='published')throw Error('STICKER_TOPIC_PRODUCT_OWNER_MISMATCH');
   validProduct(product);
   const topic=topicGuard(await getVerifiedStickerTopic({
     sellerId,productId,purpose:'sticker'}));
   if(await verifyMembership({sellerId:String(sellerId),chatId:topic.chatId})!==true)
     throw Error('STICKER_TOPIC_MEMBER_UNVERIFIED');
   if(await verifyReview({sellerId:String(sellerId),productId})!==true)
     throw Error('STICKER_TOPIC_REVIEW_UNVERIFIED');
   if(await verifyRelease({purpose:'sticker',chatId:topic.chatId,
     threadId:topic.threadId})!==true)
     throw Error('STICKER_TOPIC_RELEASE_UNVERIFIED');
   return {product,topic};
 };
 async function publish({sellerId,productId,description=''}={}){
   const {product,topic}=await guard({sellerId,productId});
   const bot=await identity();
   await assertOwnPostingAccess({topic,botId:bot.id});
   const username=bot.username;
   const text=stickerPaidCaption({product,description});
   // A real sticker image is converted to a paid PHOTO cover; this is not a video
   // product. Cover conversion happens before any durable claim or Telegram send.
   const cover=await createPaidCover(product);
   if(!(cover instanceof Uint8Array)||cover.byteLength<1||cover.byteLength>10000000)
     throw Error('STICKER_PAID_PHOTO_COVER_INVALID');
   const claimed=await receiptStore.claim({productId,sellerId,topic,text});
   if(!claimed.claimed){
     if(claimed.status==='sent'&&Number(claimed.messageId)>0)
       return {posted:true,alreadySent:true,chatId:topic.chatId,
         messageId:Number(claimed.messageId),groupTitle:topic.groupTitle,
         topicTitle:topic.title,link:topicMessageLink(topic.chatId,Number(claimed.messageId))};
     throw Error('STICKER_TOPIC_POST_NEEDS_RECONCILE');
   }
   try{
     const sent=await telegramApi('sendPaidMedia',{
       chat_id:topic.chatId,message_thread_id:topic.threadId,
       star_count:Number(product.price_stars),
       media:[{type:'photo',media:'attach://sticker_cover'}],
       sticker_cover_bytes:cover,
       payload:'stkmedia_'+productId,caption:text,
       reply_markup:{inline_keyboard:[[{text:'📦 ステッカーを受け取る',
         url:'https://t.me/'+username+'?start=claim_'+productId}]]}
     });
     if(!Number.isSafeInteger(sent?.message_id)||sent.message_id<=0||
        sent?.chat?.id!==topic.chatId||
        sent?.message_thread_id!==topic.threadId||
        sent?.is_topic_message!==true||
        sent?.from?.id!==bot.id)
       throw Error('STICKER_TOPIC_SEND_NOT_IN_VERIFIED_TOPIC');
     await receiptStore.recorded(productId,sellerId,sent.message_id);
     return {posted:true,alreadySent:false,chatId:topic.chatId,
       messageId:sent.message_id,groupTitle:topic.groupTitle,
       topicTitle:topic.title,link:topicMessageLink(topic.chatId,sent.message_id)};
   }catch(e){
     await receiptStore.unknown(productId,sellerId).catch(()=>{});
     throw e;
   }
 }
 async function edit({sellerId,productId,description}={}){
   const current=await receiptStore.getOwned(productId,sellerId);
   if(current?.status!=='sent'||!Number.isSafeInteger(Number(current.telegram_message_id)))
     throw Error('STICKER_TOPIC_NOT_EDITABLE');
   const product=await salesStore.getPublished(productId);
   if(!product||String(product.seller_user_id)!==String(sellerId))
     throw Error('STICKER_TOPIC_PRODUCT_OWNER_MISMATCH');
   const {username}=await identity(),text=stickerPaidCaption({product,description});
   try{
     const r=await telegramApi('editMessageCaption',{
       chat_id:Number(current.chat_id),message_id:Number(current.telegram_message_id),
       caption:text,reply_markup:{inline_keyboard:[[{text:'📦 ステッカーを受け取る',
         url:'https://t.me/'+username+'?start=claim_'+productId}]]}
     });
     if(!r)throw Error('STICKER_TOPIC_EDIT_NOT_CONFIRMED');
     await receiptStore.edited(productId,sellerId,text);
     return {verified:true};
   }catch{
     await receiptStore.unknown(productId,sellerId).catch(()=>{});
     throw Error('STICKER_TOPIC_EDIT_RESULT_UNKNOWN');
   }
 }
 async function remove({sellerId,productId}={}){
   const current=await receiptStore.getOwned(productId,sellerId);
   if(current?.status!=='sent'||!Number.isSafeInteger(Number(current.telegram_message_id)))
     throw Error('STICKER_TOPIC_NOT_DELETABLE');
   // Disallow new orders BEFORE irreversible Telegram deletion.
   await salesStore.pauseProduct(productId,sellerId);
   try{
     const result=await telegramApi('deleteMessage',{
       chat_id:Number(current.chat_id),message_id:Number(current.telegram_message_id)});
     if(result!==true)throw Error('STICKER_TOPIC_DELETE_NOT_CONFIRMED');
     await receiptStore.deleted(productId,sellerId);
     return {verified:true,ordersPreserved:true};
   }catch{
     await receiptStore.unknown(productId,sellerId).catch(()=>{});
     throw Error('STICKER_TOPIC_DELETE_RESULT_UNKNOWN');
   }
 }
 return Object.freeze({publish,edit,remove});
}
