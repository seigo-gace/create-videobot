import {applySalesEvent} from './ledger.mjs';
export function parsePaidMediaPurchase(update,lookupListing){
 if(!update || !Number.isSafeInteger(update.update_id) || typeof lookupListing!=='function')throw new Error('invalid update');
 const payload=update.purchased_paid_media?.paid_media_payload;
 if(typeof payload!=='string'||payload.length<1||payload.length>128)throw new Error('invalid paid media payload');
 const listing=lookupListing(payload);
 if(!listing||typeof listing.id!=='string'||!Number.isSafeInteger(listing.priceStars)||listing.priceStars<1)throw new Error('unknown purchased listing');
 return {updateId:update.update_id,listingId:listing.id,expectedStars:listing.priceStars,confirmedPayment:false};
}
export function applyVerifiedCharge(state,event){
 if(event?.verifiedByTelegram!==true)throw new Error('payment not independently verified');
 return applySalesEvent(state,{id:event.eventId,kind:event.kind,listingId:event.listingId,chargeId:event.chargeId,stars:event.stars});
}
