import test from 'node:test';
import assert from 'node:assert/strict';
import {
 MANAGEMENT_FEE_PERCENT,CREATOR_SHARE_PERCENT,
 MANAGEMENT_FEE_BASIS_POINTS,MANAGEMENT_FEE_POLICY_ID,
 splitStarsExact,formatTenths,managementFeeDisclosure
} from '../src/sales/managementFee.mjs';

test('Master adopted 30% management fee and 70% creator share with exact accounting',()=>{
 assert.equal(MANAGEMENT_FEE_PERCENT,30);
 assert.equal(CREATOR_SHARE_PERCENT,70);
 assert.equal(MANAGEMENT_FEE_BASIS_POINTS,3000);
 assert.equal(MANAGEMENT_FEE_POLICY_ID,'video-admin-30-20261107');
 for(const [gross,fee,creator] of [[0,0,0],[50,150,350],[100,300,700],[300,900,2100],[1000,3000,7000],[101,303,707],[25000,75000,175000]]){
  const result=splitStarsExact(gross);
  assert.equal(result.managementFeeTenths,fee);
  assert.equal(result.creatorShareTenths,creator);
  assert.equal(fee+creator,gross*10);
 }
});
test('fractional Star is shown accurately, not arbitrarily rounded and not treated as payout',()=>{
 const s=splitStarsExact(101);
 assert.equal(s.integralSettlementReady,false);
 assert.equal(formatTenths(s.managementFeeTenths),'30.3');
 assert.equal(formatTenths(s.creatorShareTenths),'70.7');
 const msg=managementFeeDisclosure(101);
 assert.match(msg,/運営管理費/);
 assert.match(msg,/30%/);
 assert.match(msg,/70%/);
 assert.match(msg,/端数処理は未決定/);
 assert.match(msg,/引き出し可能残高ではありません/);
});
test('a 300 Stars sale shows a 90 Stars fee and a 210 Stars creator share',()=>{
 const msg=managementFeeDisclosure(300);
 assert.match(msg,/300 Stars販売 → 管理費90 Stars／投稿者分210 Stars/);
 assert.equal(splitStarsExact(300).integralSettlementReady,true);
 assert.equal(managementFeeDisclosure().includes('売上の30%'),true);
});
test('reject invalid negative or unsafe Stars amounts',()=>{
 for(const n of [-1,0.5,NaN,Infinity,Number.MAX_SAFE_INTEGER,'100']){
  assert.throws(()=>splitStarsExact(n),/invalid gross Stars/);
 }
 assert.throws(()=>formatTenths(-1),/invalid tenths/);
});
