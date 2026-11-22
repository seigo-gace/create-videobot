import { buildFreeAlbumRequest } from './freeAlbum.mjs';
import { buildPaidMediaRequest } from './paidMedia.mjs';

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
  // Public listing captions contain only the creator's title and optional description.
  // Telegram's native paid-media UI owns the Stars price and purchase prompt.
  const caption=listing.title+(listing.description?'\n'+listing.description:'');
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
          preview.some(m=>!Number.isSafeInteger(m?.message_id)||m.message_id<=0) ||
          preview[0].message_id === preview[1].message_id ||
          typeof preview[0].media_group_id !== 'string' ||
          !preview[0].media_group_id ||
          preview[0].media_group_id !== preview[1].media_group_id)
        throw new Error('free album acknowledgment invalid: media_group_id mismatch');
      await store.recordFree(key,preview.map(m=>m.message_id));
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
      freeMessageIds:(await store.read(key)).freeMessageIds,paidMessageId:paidResult.message_id
    };
  } catch (error) {
    // Either call may have reached Telegram. Without readback this is unknown.
    await store.markUnknown(key);
    throw error;
  }
}
