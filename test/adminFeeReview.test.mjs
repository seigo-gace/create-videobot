import test from 'node:test';
import assert from 'node:assert/strict';
import {createAdminFeeReview} from '../src/sales/adminFeeReview.mjs';

function fixture(overrides={}) {
 const seen=[];
 const handler=createAdminFeeReview({
  verifyAdmin:async request=>{seen.push({type:'auth',request});return true;},
  starsLedger:{
   async getSummary(sellerId){seen.push({type:'summary',sellerId});return {
    grossStars:400,netRecordedStars:300,managementFeeTenths:900,
    creatorShareTenths:2100,feePolicyId:'video-admin-30-20261107',
    payoutReady:false
   };},
   async getHistory(sellerId){seen.push({type:'history',sellerId});
    return [{type:'sale',stars:300},{type:'refund',stars:100}];}
  },
  ...overrides
 });
 return {handler,seen};
}
test('only existing-owner verified admin reads fee report and gets exact 30/70 after refunds',async()=>{
 const {handler,seen}=fixture();
 const report=await handler({adminId:2,sellerId:44});
 assert.deepEqual(seen.map(x=>x.type),['auth','summary','history']);
 assert.equal(seen[0].request.permission,'video_sales_ledger_read');
 assert.equal(report.grossStars,400);
 assert.equal(report.refundDeductedStars,100);
 assert.equal(report.netRecordedStars,300);
 assert.equal(report.managementFeeDisplay,'90 Stars');
 assert.equal(report.creatorShareDisplay,'210 Stars');
 assert.equal(report.history.length,2);
 assert.equal(report.availablePayoutStars,null);
 assert.equal(report.payoutVerified,false);
 assert.equal(report.scope,'READ_ONLY_FINANCIAL_EVIDENCE');
 assert.ok(Object.isFrozen(report));
});
test('no manager identity/bypassed GATE privilege can read seller ledger',async()=>{
 let queried=0;
 const review=createAdminFeeReview({
  verifyAdmin:async()=>false,
  starsLedger:{
   async getSummary(){queried++;return null;},
   async getHistory(){queried++;return [];}
  }
 });
 await assert.rejects(()=>review({adminId:1,sellerId:44}),/ADMIN_REVIEW_DENIED/);
 assert.equal(queried,0);
 await assert.rejects(()=>review({adminId:0,sellerId:44}),/invalid review identities/);
 assert.equal(queried,0);
});
test('mismatched fee split, unexpected payout or unverified policy fails closed',async()=>{
 const reports=[
  {grossStars:300,netRecordedStars:300,managementFeeTenths:999,
   creatorShareTenths:2100,feePolicyId:'video-admin-30-20261107',payoutReady:false},
  {grossStars:300,netRecordedStars:300,managementFeeTenths:900,
   creatorShareTenths:2100,feePolicyId:'unknown',payoutReady:false},
  {grossStars:300,netRecordedStars:300,managementFeeTenths:900,
   creatorShareTenths:2100,feePolicyId:'video-admin-30-20261107',payoutReady:true}
 ];
 for(const summary of reports) {
  const review=createAdminFeeReview({
   verifyAdmin:async()=>true,
   starsLedger:{getSummary:async()=>summary,getHistory:async()=>[]}
  });
  await assert.rejects(()=>review({adminId:7,sellerId:44}),/audit source incomplete|audit mismatch/);
 }
});
test('valid fractional fee remains an accounting quote, never an executable payout',async()=>{
 const review=createAdminFeeReview({
  verifyAdmin:async()=>true,
  starsLedger:{
   getSummary:async()=>({grossStars:101,netRecordedStars:101,
    managementFeeTenths:303,creatorShareTenths:707,
    feePolicyId:'video-admin-30-20261107',payoutReady:false}),
   getHistory:async()=>[{type:'sale',stars:101}]
  }
 });
 const r=await review({adminId:7,sellerId:44});
 assert.equal(r.managementFeeDisplay,'30.3 Stars');
 assert.equal(r.creatorShareDisplay,'70.7 Stars');
 assert.equal(r.availablePayoutStars,null);
});
