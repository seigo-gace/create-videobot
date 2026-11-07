/**
 * Adopted 2026-11-07: 30% administration fee on verified paid-video sales,
 * 70% creator's share. This is NOT a Telegram platform fee and NOT a payout.
 *
 * Telegram Stars payouts are integral; fractional-Star allocation/rounding
 * and the legal creator recipient path are NOT yet approved. We retain exact
 * 1/10-Star accounting quotes and block actual settlements until resolved.
 */
export const MANAGEMENT_FEE_PERCENT=30;
export const CREATOR_SHARE_PERCENT=70;
export const MANAGEMENT_FEE_BASIS_POINTS=3000;
export const MANAGEMENT_FEE_POLICY_ID='video-admin-30-20261107';

export function splitStarsExact(grossStars) {
  if(!Number.isSafeInteger(grossStars)||grossStars<0||grossStars>Number.MAX_SAFE_INTEGER/10)
    throw new Error('invalid gross Stars for management fee');
  const feeTenths=grossStars*3;
  const creatorTenths=grossStars*7;
  return {
    grossStars,
    managementFeeTenths:feeTenths,
    creatorShareTenths:creatorTenths,
    feePercent:MANAGEMENT_FEE_PERCENT,
    creatorPercent:CREATOR_SHARE_PERCENT,
    policyId:MANAGEMENT_FEE_POLICY_ID,
    integralSettlementReady:feeTenths%10===0 && creatorTenths%10===0
  };
}
export function formatTenths(tenths) {
  if(!Number.isSafeInteger(tenths)||tenths<0)throw new Error('invalid tenths Stars');
  return (tenths%10===0?String(tenths/10):
    String(Math.floor(tenths/10))+'.'+String(tenths%10));
}
/** This is an existing-video-only disclosure. No new screen/buttons. */
export function managementFeeDisclosure(priceStars=null) {
  const lines=[
    '📋 販売手数料：売上の30%を運営管理費として差し引きます。',
    '投稿者の取り分：残り70%です。',
    '返金が発生した場合、対象売上と対応する管理費・投稿者分を取り消します。'
  ];
  if(priceStars!==null && priceStars!==undefined) {
    const split=splitStarsExact(priceStars);
    lines.push('例：'+priceStars+' Stars販売 → 管理費'+formatTenths(split.managementFeeTenths)+
      ' Stars／投稿者分'+formatTenths(split.creatorShareTenths)+' Stars（計算上）');
    if(!split.integralSettlementReady)
      lines.push('※ 1 Star未満の精算端数が発生します。端数処理は未決定です。');
  }
  lines.push('※ 計算上の投稿者分は引き出し可能残高ではありません。Starsの実払出方法は未検証です。');
  return lines.join('\n');
}
