export function validatePaidVideoDraft(draft) {
  if (!draft || !/^[A-Za-z0-9_-]{1,128}$/.test(draft.sellerId||'')) throw new Error('seller verification required');
  if (draft.adultConsentVerified !== true || draft.rightsVerified !== true) throw new Error('rights and adult consent verification required');
  if (!Number.isSafeInteger(draft.priceStars) || draft.priceStars < 1 || draft.priceStars > 25000) throw new Error('invalid Stars price');
  if (!Array.isArray(draft.telegramMedia) || draft.telegramMedia.length !== 1 || !draft.telegramMedia[0]?.fileId) throw new Error('media reference required');
  return Object.freeze({sellerId:draft.sellerId,priceStars:draft.priceStars,telegramMedia:draft.telegramMedia.map(x=>({fileId:x.fileId})),review:'pending'});
}
