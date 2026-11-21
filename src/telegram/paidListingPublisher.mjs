import { buildFreeAlbumRequest } from './freeAlbum.mjs';
import { buildPaidMediaRequest } from './paidMedia.mjs';
/** Paid video stays separate from the free media group under Telegram Bot API.
 * Link the existing preview to the official Stars purchase message without
 * re-uploading, deleting, or making the paid file public.
 */
export function paidVideoPreviewLink({chatId,freeMessageId,paidMessageId}={}) {
  if(!Number.isSafeInteger(chatId)||chatId>=0||
     !Number.isSafeInteger(freeMessageId)||freeMessageId<=0||
     !Number.isSafeInteger(paidMessageId)||paidMessageId<=0||
     freeMessageId===paidMessageId)throw new Error('invalid linked video receipt');
  const internalId=String(chatId).slice(4);
  if(!/^[0-9]+$/.test(internalId)||!String(chatId).startsWith('-100'))
    throw new Error('invalid supergroup link');
  return {
    chat_id:chatId,message_id:freeMessageId,
    reply_markup:{inline_keyboard:[[{text:'⭐ Stars本編・購入はこちら',url:`https://t.me/c/${internalId}/${paidMessageId}`}]]}
  };
}


/**
 * VideoBot owns the Stars-media-specific two-step transport.
 * GATE/Topic/feature-release truth and durable MPB-like delivery claims are
 * PROVIDED by their existing owners. This module must not self-certify them.
 *
 * The store must atomically implement claim(), recordFree(), recordPaid(),
 * markUnknown(), and read(). Unknown outcomes are never retried blindly.
 */
export async function publishVideoListing({
  listing,
  getVerifiedVideoTopic,
  store,
  telegramApi
} = {}) {
  if (!listing || typeof listing.id !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(listing.id) ||
      typeof listing.sellerId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(listing.sellerId) ||
      !Number.isSafeInteger(listing.revision) || listing.revision < 1 ||
      typeof listing.title !== 'string' || !listing.title.trim() ||
      !listing.thumbnail?.fileId || !listing.sample?.fileId || !listing.paidVideo?.fileId ||
      listing.rightsVerified !== true || listing.adultConsentVerified !== true ||
      listing.ownerConfirmedPublish !== true ||
      listing.feeTermsAccepted !== true || listing.managementFeeBps !== 3000)
      throw new Error('listing not ready for publication: seller fee agreement required');
  for (const fn of [getVerifiedVideoTopic,telegramApi]) {
    if (typeof fn !== 'function') throw new Error('trusted provider missing');
  }
  for (const name of ['claim','recordFree','recordPaid','markUnknown','read']) {
    if (typeof store?.[name] !== 'function') throw new Error('durable receipt store required');
  }

  // Until the durable delivery claim, no Telegram send is possible. Distinguish
  // these definitive prerequisites from an unknown post-send result.
  let topic;
  try {
    topic = await getVerifiedVideoTopic({purpose:'video_sale', sellerId:listing.sellerId, listingId:listing.id});
  if (!topic || topic.purpose !== 'video_sale' || topic.board !== 'video_chat' ||
      topic.enabled !== true || topic.verified !== true ||
      !Number.isSafeInteger(topic.chatId) || topic.chatId >= 0 ||
      !Number.isSafeInteger(topic.threadId) || topic.threadId < 1 ||
      typeof topic.title !== 'string' || !topic.title.trim()) {
    throw new Error('verified sale topic unavailable');
  }

  } catch (cause) {
    const failure=new Error(cause instanceof Error?cause.message:'video publication prerequisites unavailable',{cause});
    failure.code='VIDEO_PUBLICATION_PRE_SEND_REJECTED';
    throw failure;
  }
  const base={chatId:topic.chatId,messageThreadId:topic.threadId};
  // The buyer sees the no-voluntary-refund rule before Telegram's native
  // Stars purchase confirmation. Never offer a Bot refund workflow here;
  // mandatory legal/Telegram payment corrections remain independent.
  const buyerNotice='購入前に内容と価格（'+listing.priceStars+' Stars）を確認してください。購入者都合の通常返金なし（法令・Telegram公式の正当な例外を除く）。';
  const caption=listing.title+(listing.description?'\n'+listing.description:'')+'\n\n'+buyerNotice;
  if(caption.length>1024)throw new Error('video caption too long');
  const free=buildFreeAlbumRequest({ ...base, thumbnailFileId:listing.thumbnail.fileId,
    sampleFileId:listing.sample.fileId,caption });
  const key=listing.id + ':' + listing.revision;
  // Telegram's purchased_paid_media update identifies the sale by payload.
  // No payload means no useful paid-media purchase notification.
  const paid=buildPaidMediaRequest({ ...base,mediaFileId:listing.paidVideo.fileId,
    priceStars:listing.priceStars,caption,payload:key });
  const claim=await store.claim({key,listingId:listing.id,revision:listing.revision,topicId:topic.id});
  if (!claim || claim.claimed !== true) {
    const prior=await store.read(key);
    if (prior?.status === 'sent' && Number.isSafeInteger(prior.paidMessageId))
      return { posted:true, alreadySent:true, freeMessageIds:prior.freeMessageIds, paidMessageId:prior.paidMessageId };
    throw new Error('PUBLISH_NEEDS_RECONCILE');
  }

  const existing=await store.read(key);
  if (existing?.status !== 'sending') throw new Error('PUBLISH_NEEDS_RECONCILE');
  try {
    // Unknown outcome after a request means no automatic second attempt.
    if (!existing.freeMessageIds) {
      const preview=await telegramApi('sendMediaGroup',free);
      if (!Array.isArray(preview) || preview.length !== 2 ||
          preview.some(m=>!Number.isSafeInteger(m?.message_id)||m.message_id<=0))
        throw new Error('free album acknowledgment invalid');
      await store.recordFree(key,preview.map(m=>m.message_id));
    }
    const paidResult=await telegramApi('sendPaidMedia',paid);
    if (!Number.isSafeInteger(paidResult?.message_id) || paidResult.message_id <= 0)
      throw new Error('paid media acknowledgment invalid');
    await store.recordPaid(key,paidResult.message_id);
    // A native mixed free/paid album is not supported by Telegram.
    // A preview jump is the non-destructive alternative. Paid delivery has
    // already been acknowledged: failure to edit the preview must not cause
    // another paid-media send or invalidate the durable send receipt.
    let previewLinked=false;
    try {
      await telegramApi('editMessageReplyMarkup',paidVideoPreviewLink({
        chatId:topic.chatId,freeMessageId:existing.freeMessageIds?.[0] ??
          (await store.read(key)).freeMessageIds?.[0],paidMessageId:paidResult.message_id
      }));
      previewLinked=true;
    } catch { /* Existing paid receipt remains final; do not retry paid media. */ }
    return {
      previewLinked,
      posted:true,alreadySent:false,
      freeMessageIds:(await store.read(key)).freeMessageIds,paidMessageId:paidResult.message_id
    };
  } catch (error) {
    // Either call may have reached Telegram. Without readback this is unknown.
    await store.markUnknown(key);
    throw error;
  }
}
