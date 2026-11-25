import { validatePaidVideoDraft } from '../sales/listing.mjs';
const STATES=new Set(['awaiting_media','awaiting_price','awaiting_rights','ready_for_review']);
export function beginSale(sellerId) {
 if(typeof sellerId!=='string'|| !/^[A-Za-z0-9_-]{1,128}$/.test(sellerId)) throw new Error('invalid seller');
 return {sellerId,state:'awaiting_media',fileId:null,priceStars:null,rightsVerified:false,adultConsentVerified:false};
}
export function transitionSale(draft,action) {
 if(!draft || !STATES.has(draft.state) || !action || typeof action.type!=='string') throw new Error('invalid workflow');
 if(action.type==='cancel') return {state:'cancelled',sellerId:draft.sellerId};
 if(draft.state==='awaiting_media' && action.type==='media') {
   if(typeof action.fileId!=='string'|| !/^[A-Za-z0-9_-]{3,256}$/.test(action.fileId)) throw new Error('invalid Telegram media ID');
   return {...draft,fileId:action.fileId,state:'awaiting_price'};
 }
 if(draft.state==='awaiting_price' && action.type==='price') {
   if(!Number.isSafeInteger(action.stars)||action.stars<1||action.stars>25000) throw new Error('invalid price');
   return {...draft,priceStars:action.stars,state:'awaiting_rights'};
 }
 if(draft.state==='awaiting_rights' && action.type==='confirm_rights') {
   if(action.rightsVerified!==true||action.adultConsentVerified!==true) throw new Error('rights and adult consent required');
   return {...draft,rightsVerified:true,adultConsentVerified:true,state:'ready_for_review'};
 }
 throw new Error('unexpected step');
}
export function finalizeDraft(draft) {
 if(draft.state!=='ready_for_review') throw new Error('draft not ready');
 return validatePaidVideoDraft({sellerId:draft.sellerId,priceStars:draft.priceStars,rightsVerified:draft.rightsVerified,adultConsentVerified:draft.adultConsentVerified,telegramMedia:[{fileId:draft.fileId}]});
}
