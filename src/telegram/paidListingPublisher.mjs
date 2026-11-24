import { buildFreeAlbumRequest } from './freeAlbum.mjs';
import { buildPaidMediaRequest } from './paidMedia.mjs';
import {videoOfferLink} from './videoInvoiceSales.mjs';

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
  telegramApi,
  saleMode='paid_media'
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
  // The private preview preparation can fail or be bypassed by a stale draft.
  // Never publish the main file as a free sample or accept an overlong sample.
  // Check before the durable claim and before any Telegram send.
  if (!Number.isFinite(listing.sample.durationSeconds) ||
      listing.sample.durationSeconds <= 0 ||
      listing.sample.durationSeconds > 60.1 ||
      listing.sample.fileId === listing.paidVideo.fileId) {
    const error = new Error('VIDEO_FREE_SAMPLE_NOT_SAFE_FOR_PUBLICATION');
    error.code = 'VIDEO_PUBLICATION_PRE_SEND_REJECTED';
    throw error;
  }
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
  if(!['paid_media','invoice'].includes(saleMode))
    throw new Error('VIDEO_SALE_MODE_UNVERIFIED');
  const base={chatId:topic.chatId,messageThreadId:topic.threadId};
  // Public listing captions contain only the creator's title and optional description.
  // Telegram's native paid-media UI owns the Stars price and purchase prompt.
  const caption=listing.title+(listing.description?'\n'+listing.description:'');
  if(caption.length>1024)throw new Error('video caption too long');
  const free=buildFreeAlbumRequest({ ...base, thumbnailFileId:listing.thumbnail.fileId,
    secondThumbnailFileId:listing.thumbnail.secondFileId, sampleFileId:listing.sample.fileId });
  const key=listing.id + ':' + listing.revision;
  // Telegram's purchased_paid_media update identifies the sale by payload.
  // No payload means no useful paid-media purchase notification.
  const paid=saleMode==='paid_media'?buildPaidMediaRequest({ ...base,mediaFileId:listing.paidVideo.fileId,
    priceStars:listing.priceStars,caption,payload:key }):null;
  // Reopening an already acknowledged publication is idempotent even if
  // historical duplicate versions exist. This branch causes no Telegram I/O.
  const ownReceipt=await store.read(key);
  if (ownReceipt?.status==='sent' &&
      Array.isArray(ownReceipt.freeMessageIds) &&
      [2,3].includes(ownReceipt.freeMessageIds.length) &&
      Number.isSafeInteger(ownReceipt.paidMessageId)) {
    return {posted:true,alreadySent:true,
      freeMessageIds:ownReceipt.freeMessageIds,
      paidMessageId:ownReceipt.paidMessageId};
  }
  // A listing's revision is an editing version, not authorization to post
  // another paid purchase item. Preserve both old paid posts and receipts;
  // never silently issue a duplicate Stars offer for an existing listing.
  if (typeof store.findOtherDelivery === 'function') {
    const other=await store.findOtherDelivery({listingId:listing.id,key});
    if (other) {
      const error=new Error('VIDEO_EXISTING_PUBLICATION_REQUIRES_EDIT');
      error.code='VIDEO_PUBLICATION_PRE_SEND_REJECTED';
      throw error;
    }
  }
  if(!listing.thumbnail.secondFileId){
    const error=new Error('VIDEO_SECOND_THUMBNAIL_REQUIRED');
    error.code='VIDEO_PUBLICATION_PRE_SEND_REJECTED';
    throw error;
  }
  const claim=await store.claim({key,listingId:listing.id,revision:listing.revision,topicId:topic.id,saleMode});
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
      if (!Array.isArray(preview) || preview.length !== free.media.length ||
          preview.some(m=>!Number.isSafeInteger(m?.message_id)||m.message_id<=0) ||
          new Set(preview.map(m=>m.message_id)).size!==preview.length ||
          typeof preview[0].media_group_id !== 'string' ||
          !preview[0].media_group_id ||
          preview.some(m=>m.media_group_id!==preview[0].media_group_id))
        throw new Error('free album acknowledgment invalid: media_group_id mismatch');
      await store.recordFree(key,preview.map(m=>m.message_id));
    }
    if(saleMode==='invoice') {
      const preview=(await store.read(key))?.freeMessageIds;
      const sampleMessageId=preview?.at(-1);
      if(!Number.isSafeInteger(sampleMessageId)||sampleMessageId<=0)
        throw new Error('VIDEO_INVOICE_SAMPLE_RECEIPT_MISSING');
      // A group callback cannot open a first-time private chat with the Bot.
      // Use the official Telegram Bot deep link; the buyer initiates their DM.
      const identity=await telegramApi('getMe',{});
      if(identity?.is_bot!==true)
        throw new Error('VIDEO_INVOICE_BOT_IDENTITY_NOT_VERIFIED');
      const url=videoOfferLink(identity.username,listing.id,listing.revision);
      const attached=await telegramApi('editMessageReplyMarkup',{
        chat_id:topic.chatId,message_id:sampleMessageId,
        reply_markup:{inline_keyboard:[[{text:'⭐ '+listing.priceStars+'で購入',url}]]}
      });
      if(attached!==true && attached?.alreadyCurrent!==true &&
         attached?.message_id!==sampleMessageId)
        throw new Error('VIDEO_INVOICE_BUTTON_ACK_UNKNOWN');
      await store.recordPaid(key,sampleMessageId);
      return {posted:true,alreadySent:false,saleMode:'invoice',
        freeMessageIds:preview,paidMessageId:sampleMessageId};
    }
    const paidResult=await telegramApi('sendPaidMedia',paid);
    if (!Number.isSafeInteger(paidResult?.message_id) || paidResult.message_id <= 0 ||
        paidResult.chat?.id !== topic.chatId ||
        (paidResult.message_thread_id != null && paidResult.message_thread_id !== topic.threadId) ||
        !paidResult.paid_media ||
        paidResult.paid_media.star_count !== listing.priceStars ||
        !Array.isArray(paidResult.paid_media.paid_media) ||
        paidResult.paid_media.paid_media.length !== 1)
      throw new Error('paid media acknowledgment invalid: native Stars lock not confirmed');
    await store.recordPaid(key,paidResult.message_id);
    return {
      posted:true,alreadySent:false,
      freeMessageIds:(await store.read(key)).freeMessageIds,paidMessageId:paidResult.message_id,saleMode:'paid_media'
    };
  } catch (error) {
    // Either call may have reached Telegram. Without readback this is unknown.
    await store.markUnknown(key);
    throw error;
  }
}
