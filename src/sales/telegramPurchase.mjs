import {applySalesEvent} from './ledger.mjs';
import {createHash} from 'node:crypto';
export function parsePaidMediaPurchase(update,lookupListing){
 if(!update || !Number.isSafeInteger(update.update_id) || typeof lookupListing!=='function')throw new Error('invalid update');
 const payload=update.purchased_paid_media?.paid_media_payload;
 if(typeof payload!=='string'||payload.length<1||Buffer.byteLength(payload,'utf8')>128)throw new Error('invalid paid media payload');
 const buyerId=update.purchased_paid_media?.from?.id;
 if(!Number.isSafeInteger(buyerId)||buyerId<=0)throw new Error('purchase buyer missing');
 const listing=lookupListing(payload);
 if(!listing||typeof listing.id!=='string'||!Number.isSafeInteger(listing.priceStars)||listing.priceStars<1)throw new Error('unknown purchased listing');
 return {updateId:update.update_id,payload,listingId:listing.id,buyerId,expectedStars:listing.priceStars,confirmedPayment:false};
}
export function applyVerifiedCharge(state,event){
 if(event?.verifiedByTelegram!==true)throw new Error('payment not independently verified');
 return applySalesEvent(state,{id:event.eventId,kind:event.kind,listingId:event.listingId,chargeId:event.chargeId,stars:event.stars});
}

/** Telegram PaidMediaPurchased has buyer+payload but NO charge/price evidence.
 * getStarTransactions must independently corroborate the immutable listed price,
 * buyer, paid-media payload, and a positive Stars transaction before ledger credit.
 * A listing record or update from the webhook is not proof of settled revenue.
 * Caller must persist the returned charge idempotently and continuously reconcile
 * refunds/chargebacks; matching is not a payout authorization.
 */
export async function reconcilePaidMediaPurchase({purchase,telegramApi,maxPages=3}={}) {
 if(typeof telegramApi!=='function'||!Number.isSafeInteger(maxPages)||maxPages<1||maxPages>20)
  throw new Error('trusted Telegram transaction reader required');
 if(!purchase||!Number.isSafeInteger(purchase.updateId)||
    !Number.isSafeInteger(purchase.buyerId)||purchase.buyerId<=0||
    typeof purchase.payload!=='string'||Buffer.byteLength(purchase.payload,'utf8')>128||
    typeof purchase.listingId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(purchase.listingId)||
    !Number.isSafeInteger(purchase.expectedStars)||purchase.expectedStars<1||
    purchase.confirmedPayment!==false)throw new Error('unverified purchase intent required');
 let candidates=[];
 for(let page=0;page<maxPages;page++) {
  const res=await telegramApi('getStarTransactions',{offset:page*100,limit:100});
  if(!Array.isArray(res?.transactions))throw new Error('Telegram transactions unavailable');
  for(const transaction of res.transactions){
    if(transaction?.source?.type!=='user'||
       transaction.source.transaction_type!=='paid_media_payment'||
       transaction.source.paid_media_payload!==purchase.payload||
       transaction.source.user?.id!==purchase.buyerId)continue;
    candidates.push(transaction);
  }
  if(res.transactions.length<100)break;
 }
 if(candidates.some(t=>!Number.isSafeInteger(t.amount)||t.amount!==purchase.expectedStars||
   typeof t.id!=='string'||!t.id.length||t.receiver))
   throw new Error('paid media Stars transaction mismatch or refund requires reconciliation');
 if(candidates.length!==1)throw new Error('paid media transaction unverified or ambiguous');
 const transaction=candidates[0];
 const idDigest=createHash('sha256').update(transaction.id).digest('hex');
 return {
  verifiedByTelegram:true,eventId:'paid_'+idDigest.slice(0,40),kind:'paid',
  listingId:purchase.listingId,chargeId:'charge_'+idDigest.slice(0,40),
  stars:transaction.amount,buyerId:purchase.buyerId,
  telegramTransactionId:transaction.id
 };
}
