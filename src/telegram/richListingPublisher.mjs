import {videoOfferLink} from './videoInvoiceSales.mjs';

/** Single Telegram RichMessage containing one photo+video collage and one
 * Stars invoice purchase keyboard. Never sends the paid full video publicly.
 * Legacy records remain intact, including original purchaser entitlements.
 */
export async function publishRichVideoListing({
 listing,store,telegramApi,getVerifiedVideoTopic,allowExistingInvoiceReplacement=false
}={}){
 const reject=(reason)=>{const e=new Error(reason);e.code='VIDEO_PUBLICATION_PRE_SEND_REJECTED';throw e;};
 if(!listing||typeof listing.id!=='string'||!/^[A-Za-z0-9_-]{1,40}$/.test(listing.id)||
   typeof listing.sellerId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(listing.sellerId)||
   !Number.isSafeInteger(listing.revision)||listing.revision<1||
   typeof listing.title!=='string'||!listing.title.trim()||
   typeof listing.description!=='string'||
   !listing.thumbnail?.fileId||!listing.sample?.fileId||!listing.paidVideo?.fileId||
   listing.sample.fileId===listing.paidVideo.fileId||
   listing.thumbnail.fileId===listing.paidVideo.fileId||
   !Number.isFinite(listing.sample.durationSeconds)||
   listing.sample.durationSeconds<=0||listing.sample.durationSeconds>30||
   listing.rightsVerified!==true||listing.adultConsentVerified!==true||
   listing.ownerConfirmedPublish!==true||listing.feeTermsAccepted!==true||
   listing.managementFeeBps!==3000||
   !Number.isSafeInteger(listing.priceStars)||
   listing.priceStars<1||listing.priceStars>25000)
    reject('RICH_VIDEO_LISTING_NOT_READY');
 if(typeof telegramApi!=='function'||typeof getVerifiedVideoTopic!=='function'||
   ['read','claim','recordSent','markUnknown','findOtherDelivery','findLegacyOffer']
    .some(k=>typeof store?.[k]!=='function'))reject('RICH_VIDEO_DEPENDENCIES_MISSING');
 const text=listing.title+(listing.description?'\n'+listing.description:'');
 if(text.length>1024)reject('RICH_VIDEO_DESCRIPTION_TOO_LONG');
 const key=listing.id+':'+listing.revision;
 const prior=await store.read(key);
 if(prior?.status==='sent'&&Number.isSafeInteger(prior.messageId)&&prior.messageId>0)
  return {posted:true,alreadySent:true,richMessageId:prior.messageId};
 if(prior)throw Error('RICH_VIDEO_PUBLICATION_REQUIRES_RECONCILE');
 const other=await store.findOtherDelivery({listingId:listing.id,key});
 if(other)reject('RICH_VIDEO_ANOTHER_VERSION_ALREADY_PUBLISHED');
 const legacy=await store.findLegacyOffer({listingId:listing.id,key});
 if(legacy.length>0){
  const old=legacy[0];
  if(!allowExistingInvoiceReplacement||legacy.length!==1||
     old.key!==key||old.saleMode!=='invoice'||old.status!=='sent'||
     !Array.isArray(old.freeIds)||old.freeIds.length!==2||
     !Number.isSafeInteger(old.paidMessageId)||old.paidMessageId<=0)
    reject('RICH_VIDEO_EXISTING_OFFER_REQUIRES_RECONCILE');
 }
 const topic=await getVerifiedVideoTopic({
   purpose:'video_sale',sellerId:listing.sellerId,listingId:listing.id
 });
 if(!topic||topic.verified!==true||topic.enabled!==true||
   topic.purpose!=='video_sale'||topic.board!=='video_chat'||
   !Number.isSafeInteger(topic.chatId)||topic.chatId>=0||
   !Number.isSafeInteger(topic.threadId)||topic.threadId<=0||
   !Number.isSafeInteger(topic.id)||topic.id<=0||
   typeof topic.title!=='string'||!topic.title.trim())
   reject('RICH_VIDEO_TOPIC_NOT_VERIFIED');
 if(legacy.length && legacy[0].topicId!==topic.id)
   reject('RICH_VIDEO_LEGACY_TOPIC_MISMATCH');
 const me=await telegramApi('getMe',{});
 if(me?.is_bot!==true)reject('RICH_VIDEO_BOT_IDENTITY_NOT_VERIFIED');
 const url=videoOfferLink(me.username,listing.id,listing.revision);
 const label='⭐ '+listing.priceStars+' Starsで本編を購入';
 const request={
  chat_id:topic.chatId,message_thread_id:topic.threadId,
  rich_message:{blocks:[
   {type:'collage',blocks:[
    {type:'photo',photo:{type:'photo',media:listing.thumbnail.fileId,has_spoiler:true}},
    {type:'video',video:{type:'video',media:listing.sample.fileId,has_spoiler:true}}
   ]},
   {type:'paragraph',text}
  ]},
  reply_markup:{inline_keyboard:[[{text:label,url}]]}
 };
 // A durable claim precedes the one and only public posting request.
 const claimed=await store.claim({key,listingId:listing.id,revision:listing.revision,topicId:topic.id});
 if(claimed?.claimed!==true)throw Error('RICH_VIDEO_PUBLICATION_REQUIRES_RECONCILE');
 try{
  const sent=await telegramApi('sendRichMessage',request);
  const button=sent?.reply_markup?.inline_keyboard?.[0]?.[0];
  const blocks=sent?.rich_message?.blocks;
  const collage=Array.isArray(blocks)?blocks.find(b=>b.type==='collage'):null;
  const types=collage?.blocks?.map(b=>b.type);
  if(!Number.isSafeInteger(sent?.message_id)||sent.message_id<=0||
     sent.chat?.id!==topic.chatId||
     (sent.message_thread_id!=null&&sent.message_thread_id!==topic.threadId)||
     sent.media_group_id!=null||
     !Array.isArray(types)||!types.includes('photo')||!types.includes('video')||
     button?.text!==label||button?.url!==url)
   throw Error('RICH_VIDEO_TELEGRAM_ACK_UNKNOWN');
  await store.recordSent(key,sent.message_id);
  return {posted:true,alreadySent:false,richMessageId:sent.message_id,saleMode:'invoice'};
 }catch(error){
  await store.markUnknown(key);
  throw error;
 }
}
