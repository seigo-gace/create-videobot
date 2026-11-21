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
  verifyMembership,
  verifyReview,
  verifyRelease,
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
  for (const fn of [getVerifiedVideoTopic,verifyMembership,verifyReview,verifyRelease,telegramApi]) {
    if (typeof fn !== 'function') throw new Error('trusted provider missing');
  }
  for (const name of ['claim','recordFree','recordPaid','markUnknown','read']) {
    if (typeof store?.[name] !== 'function') throw new Error('durable receipt store required');
  }

  const topic = await getVerifiedVideoTopic({purpose:'video_sale', sellerId:listing.sellerId, listingId:listing.id});
  if (!topic || topic.purpose !== 'video_sale' || topic.board !== 'video_chat' ||
      topic.enabled !== true || topic.verified !== true ||
      !Number.isSafeInteger(topic.chatId) || topic.chatId >= 0 ||
      !Number.isSafeInteger(topic.threadId) || topic.threadId < 1 ||
      typeof topic.title !== 'string' || !topic.title.trim()) {
    throw new Error('verified sale topic unavailable');
  }

  if (await verifyMembership({ sellerId: listing.sellerId, chatId: topic.chatId }) !== true)
    throw new Error('GATE membership not verified');
  if (await verifyReview({ sellerId: listing.sellerId, listingId: listing.id, revision:listing.revision }) !== true)
    throw new Error('listing review not approved');
  if (await verifyRelease({ purpose:'video_sale', chatId:topic.chatId, threadId:topic.threadId }) !== true)
    throw new Error('video sale release not verified');

  const base={chatId:topic.chatId,messageThreadId:topic.threadId};
  const free=buildFreeAlbumRequest({ ...base, thumbnailFileId:listing.thumbnail.fileId,
    sampleFileId:listing.sample.fileId,caption:listing.title });
  const key=listing.id + ':' + listing.revision;
  // Telegram's purchased_paid_media update identifies the sale by payload.
  // No payload means no useful paid-media purchase notification.
  const paid=buildPaidMediaRequest({ ...base,mediaFileId:listing.paidVideo.fileId,
    priceStars:listing.priceStars,caption:listing.title,payload:key });
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
