/**
 * Telegram represents the free spoiler gallery and Stars-locked video as
 * separate messages. This module builds the free two-item album only.
 * No network call, token, GATE bypass or publishing side effects here.
 */
export function buildFreeAlbumRequest({ chatId, messageThreadId, thumbnailFileId, sampleFileId, caption = '' } = {}) {
  if (!Number.isSafeInteger(chatId) || chatId === 0) throw new Error('invalid chat');
  if (messageThreadId !== undefined && (!Number.isSafeInteger(messageThreadId) || messageThreadId <= 0)) throw new Error('invalid topic');
  for (const [key, value] of Object.entries({ thumbnailFileId, sampleFileId })) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{3,256}$/.test(value)) throw new Error('invalid ' + key);
  }
  if (typeof caption !== 'string' || caption.length > 1024) throw new Error('invalid caption');
  return {
    chat_id: chatId,
    ...(messageThreadId ? { message_thread_id: messageThreadId } : {}),
    media: [
      { type: 'photo', media: thumbnailFileId, has_spoiler: true, ...(caption ? { caption } : {}) },
      { type: 'video', media: sampleFileId, has_spoiler: true }
    ]
  };
}

/**
 * Returns two distinct Telegram API requests and keeps correlation in the
 * owner product ID. A future publisher must persist both message IDs and
 * recover partial sends before treating a listing as published.
 */
export function buildListingMessagePlan({ listingId, freeAlbum, paidMedia } = {}) {
  if (typeof listingId !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(listingId)) throw new Error('invalid listing');
  if (!freeAlbum || !Array.isArray(freeAlbum.media) || freeAlbum.media.length !== 2 || !paidMedia || !Array.isArray(paidMedia.media)) throw new Error('invalid listing messages');
  if (freeAlbum.chat_id !== paidMedia.chat_id || (freeAlbum.message_thread_id ?? null) !== (paidMedia.message_thread_id ?? null)) throw new Error('listing topic mismatch');
  return Object.freeze({
    listingId,
    steps: [
      { method: 'sendMediaGroup', params: freeAlbum, role: 'free_preview' },
      { method: 'sendPaidMedia', params: paidMedia, role: 'paid_video' }
    ],
    publishableWithoutDurableRecovery: false
  });
}
