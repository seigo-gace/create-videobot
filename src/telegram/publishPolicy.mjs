import { buildPaidMediaRequest } from './paidMedia.mjs';
/** Server-owned verification dependencies. No caller-supplied gateVerified or approved booleans. */
export async function publishWithGate({sellerId,listingId,targetChatId,messageThreadId,mediaFileId,priceStars,verifyGate,verifyReview,telegramApi}) {
 if(typeof sellerId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(sellerId)) throw new Error('invalid seller');
 if(typeof listingId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(listingId)) throw new Error('invalid listing');
 if(typeof verifyGate!=='function'||typeof verifyReview!=='function'||typeof telegramApi!=='function') throw new Error('trusted dependency unavailable');
 // Validate request before any external privileged action.
 const params=buildPaidMediaRequest({chatId:targetChatId,messageThreadId,mediaFileId,priceStars});
 const gate=await verifyGate({sellerId,chatId:targetChatId});
 if(gate!==true) throw new Error('GATE membership not verified');
 const reviewed=await verifyReview({sellerId,listingId});
 if(reviewed!==true) throw new Error('listing not approved');
 const response=await telegramApi('sendPaidMedia',params);
 if(!response || !Number.isSafeInteger(response.message_id) || response.message_id<=0) throw new Error('Telegram send not acknowledged');
 return {posted:true,messageId:response.message_id};
}
