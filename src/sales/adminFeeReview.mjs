import {
  splitStarsExact,MANAGEMENT_FEE_POLICY_ID,formatTenths
} from './managementFee.mjs';

/**
 * Read-only operator evidence for VideoBot financial review.
 * Administrator authentication MUST come from the existing GATE/admin owner;
 * this module does not create a second admin list, token or payment endpoint.
 *
 * A "creator share" is an accounting quote, never a transferable balance.
 */
export function createAdminFeeReview({verifyAdmin,starsLedger}={}) {
  if(typeof verifyAdmin!=='function'||
     typeof starsLedger?.getSummary!=='function'||
     typeof starsLedger?.getHistory!=='function')
    throw new Error('trusted admin verification and existing ledger required');

  return async function reviewSeller({adminId,sellerId}={}) {
    if(!Number.isSafeInteger(adminId)||adminId<=0||
       !Number.isSafeInteger(sellerId)||sellerId<=0)
      throw new Error('invalid review identities');
    const allowed=await verifyAdmin({
      adminId,permission:'video_sales_ledger_read',sellerId
    });
    if(allowed!==true)throw new Error('ADMIN_REVIEW_DENIED');

    const summary=await starsLedger.getSummary(sellerId);
    const history=await starsLedger.getHistory(sellerId);
    if(!summary||summary.payoutReady!==false||
       summary.feePolicyId!==MANAGEMENT_FEE_POLICY_ID||
       !Number.isSafeInteger(summary.grossStars)||summary.grossStars<0||
       !Number.isSafeInteger(summary.netRecordedStars)||summary.netRecordedStars<0||
       summary.netRecordedStars>summary.grossStars ||
       !Array.isArray(history)||history.length>10)
      throw new Error('ledger audit source incomplete');

    const split=splitStarsExact(summary.netRecordedStars);
    if(summary.managementFeeTenths!==split.managementFeeTenths ||
       summary.creatorShareTenths!==split.creatorShareTenths)
      throw new Error('30 percent audit mismatch');

    for(const row of history) {
      if(!row||!['sale','refund'].includes(row.type)||
         !Number.isSafeInteger(row.stars)||row.stars<1)
        throw new Error('invalid Stars history evidence');
    }

    return Object.freeze({
      sellerId,
      grossStars:summary.grossStars,
      refundDeductedStars:summary.grossStars-summary.netRecordedStars,
      netRecordedStars:summary.netRecordedStars,
      managementFeeTenths:split.managementFeeTenths,
      creatorShareTenths:split.creatorShareTenths,
      managementFeeDisplay:formatTenths(split.managementFeeTenths)+' Stars',
      creatorShareDisplay:formatTenths(split.creatorShareTenths)+' Stars',
      feePolicyId:MANAGEMENT_FEE_POLICY_ID,
      history:Object.freeze(history.map(x=>Object.freeze({...x}))),
      availablePayoutStars:null,
      payoutVerified:false,
      scope:'READ_ONLY_FINANCIAL_EVIDENCE',
      explanation:'売上から運営管理費30%を控除。投稿者分70%は計算上の値で、実払出可能残高ではありません。'
    });
  };
}
