import {splitStarsExact} from './managementFee.mjs';
/**
 * Pure ledger transition. Caller must persist event IDs and ledger atomically
 * in the final Gserver adapter; no actual payout or Stars redemption is performed.
 */
export function applySalesEvent(state, event) {
  if (!state || !Array.isArray(state.events) || !Array.isArray(state.entries)) throw new Error('invalid ledger state');
  if (!event || !/^[A-Za-z0-9_-]{8,128}$/.test(event.id || '') || !/^[A-Za-z0-9_-]{1,128}$/.test(event.listingId || '')) throw new Error('invalid event');
  if (!['paid','refunded'].includes(event.kind)) throw new Error('unsupported event');
  if (!Number.isSafeInteger(event.stars) || event.stars <= 0) throw new Error('invalid Stars amount');
  if (state.events.includes(event.id)) return {state, applied:false};
  const sale = state.entries.find(x=>x.listingId===event.listingId && x.chargeId===event.chargeId && x.kind==='paid');
  if (event.kind==='refunded' && (!sale || state.entries.some(x=>x.kind==='refunded' && x.chargeId===event.chargeId))) throw new Error('refund has no unmatched sale');
  if (event.kind==='refunded' && sale.stars !== event.stars) throw new Error('refund amount mismatch');
  if (event.kind==='paid' && (typeof event.chargeId !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(event.chargeId) || state.entries.some(x=>x.kind==='paid' && x.chargeId===event.chargeId))) throw new Error('duplicate or invalid charge');
  const entry = Object.freeze({kind:event.kind, listingId:event.listingId, chargeId:event.chargeId, stars:event.stars});
  return {state:{events:[...state.events,event.id],entries:[...state.entries,entry]},applied:true};
}
export function starsNetForListing(state, listingId) {
  return state.entries.filter(x=>x.listingId===listingId).reduce((v,x)=>v + (x.kind==='paid'?x.stars:-x.stars),0);
}

/** Derived accounting-only 30/70 split on the EXISTING immutable ledger.
 * Retains starsNetForListing as gross minus refunds; never authorizes payout.
 */
export function sellerFeeBreakdownForListing(state,listingId) {
 const netStars=starsNetForListing(state,listingId);
 if(!Number.isSafeInteger(netStars)||netStars<0)
  throw new Error('unbalanced refund ledger for fee computation');
 return splitStarsExact(netStars);
}
