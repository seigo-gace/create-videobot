import test from 'node:test';
import assert from 'node:assert/strict';
import {createPostgresStarsLedger} from '../src/sales/pgStarsLedger.mjs';

const purchase={update_id:430,purchased_paid_media:{from:{id:77},paid_media_payload:'myvid:1'}};
const transaction=()=>({id:'transaction-true-123',amount:300,source:{
  type:'user',transaction_type:'paid_media_payment',
  paid_media_payload:'myvid:1',user:{id:77}
}});
function fixture(){
 const rows=[],calls=[],state={
  delivery_key:'myvid:1',listing_id:'myvid',price_stars:300,
  seller_user_id:'44',status:'sent',paid_message_id:15,listing_status:'published',
  management_fee_bps:3000,fee_policy_id:'video-admin-30-20261107',fee_terms_accepted_at:'seller-confirmed'
 };
 const pool={
  async query(sql,args){
   calls.push({sql,args});
   if(sql.startsWith('SELECT r.listing_id')){
     const p=args[0];
     return {rows:p===state.delivery_key&&state.status==='sent'&&state.listing_status==='published'
        ?[{listing_id:'myvid',price_stars:300,seller_user_id:'44',
          management_fee_bps:state.management_fee_bps,fee_policy_id:state.fee_policy_id,
          fee_terms_accepted_at:state.fee_terms_accepted_at}]:[]};
   }
   if(sql.startsWith('INSERT INTO videobot_stars_ledger') && sql.includes("SELECT p.telegram_transaction_id")) {
     const original=rows.find(r=>r.telegram_transaction_id===args[0]&&r.kind==='paid');
     const existing=rows.find(r=>r.telegram_transaction_id===args[0]&&r.kind==='refunded');
     if(!original||existing)return {rowCount:0,rows:[]};
     rows.push({...original,kind:'refunded'});
     return {rowCount:1,rows:[{ledger_id:rows.length}]};
   }
   if(sql.startsWith('INSERT INTO videobot_stars_ledger')){
     const [key,id,buyer,stars,updateId,seller]=args;
     if(key!==state.delivery_key||state.status!=='sent'||state.listing_status!=='published'||
       stars!==state.price_stars||String(seller)!==String(state.seller_user_id))
       return {rowCount:0,rows:[]};
     if(rows.some(r=>r.telegram_transaction_id===id&&r.kind==='paid'))
       return {rowCount:0,rows:[]};
     rows.push({telegram_transaction_id:id,kind:'paid',delivery_key:key,listing_id:'myvid',
       seller_user_id:'44',buyer_user_id:String(buyer),stars,updateId,
       management_fee_bps:3000,fee_policy_id:'video-admin-30-20261107'});
     return {rowCount:1,rows:[{ledger_id:1}]};
   }
   if(sql.startsWith("SELECT kind,stars,listing_id,buyer_user_id")) {
     const existing=rows.find(r=>r.telegram_transaction_id===args[0]&&r.kind==='refunded');
     return {rows:existing?[{...existing}]:[]};
   }
   if(sql.startsWith('SELECT delivery_key')){
     const found=rows.find(r=>r.telegram_transaction_id===args[0]);
     return {rows:found?[found]:[]};
   }
   if(sql.startsWith('SELECT COALESCE(SUM')){
     const match=rows.filter(r=>String(r.seller_user_id)===String(args[0]));
     const gross=match.filter(r=>r.kind==='paid').reduce((n,r)=>n+r.stars,0);
     const refunds=match.filter(r=>r.kind==='refunded').reduce((n,r)=>n+r.stars,0);
     return {rows:[{gross_stars:String(gross),net_stars:String(gross-refunds)}]};
   }
   if(sql.startsWith('SELECT kind,stars')){
     return {rows:rows.filter(r=>String(r.seller_user_id)===String(args[0]))
       .slice(-10).reverse().map(r=>({kind:r.kind,stars:r.stars}))};
   }
   throw new Error('unexpected SQL statement');
  }
 };
 const tgCalls=[];
 const telegramApi=async(method,args)=>{
   tgCalls.push({method,args});
   return {transactions:[transaction()]};
 };
 return {pool,rows,calls,state,tgCalls,telegramApi};
}
test('Telegram purchase update is corroborated before unique SQL ledger insert',async()=>{
 const x=fixture(),ledger=createPostgresStarsLedger(x);
 assert.deepEqual(await ledger.confirmPurchase(purchase),
  {recorded:true,duplicate:false,listingId:'myvid'});
 assert.equal(x.tgCalls[0].method,'getStarTransactions');
 assert.equal(x.rows.length,1);
 assert.equal(x.rows[0].seller_user_id,'44');
 assert.equal(x.rows[0].buyer_user_id,'77');
 const summary=await ledger.getSummary(44);
 assert.deepEqual(summary,{grossStars:300,netRecordedStars:300,managementFeeTenths:900,creatorShareTenths:2100,
    feePolicyId:'video-admin-30-20261107',payoutReady:false});
 assert.deepEqual(await ledger.getHistory(44),[{type:'sale',stars:300}]);
 assert.deepEqual(await ledger.getHistory(45),[]);
});
test('duplicate Telegram purchase does not duplicate revenue or post-event balance',async()=>{
 const x=fixture(),ledger=createPostgresStarsLedger(x);
 const first=await ledger.confirmPurchase(purchase);
 const replay=await ledger.confirmPurchase(purchase);
 assert.equal(first.duplicate,false);
 assert.equal(replay.duplicate,true);
 assert.equal(x.rows.length,1);
});
test('purchase notification and malicious amount alone can never create Stars earnings',async()=>{
 const x=fixture();
 x.telegramApi=async()=>({transactions:[]});
 const ledger=createPostgresStarsLedger(x);
 await assert.rejects(()=>ledger.confirmPurchase(purchase),/unverified/);
 assert.equal(x.rows.length,0);
});
test('immutable sale receipt required and wrong buyer/price never persist',async()=>{
 const x=fixture(),ledger=createPostgresStarsLedger(x);
 x.state.status='needs_reconcile';
 await assert.rejects(()=>ledger.confirmPurchase(purchase),/receipt not found/);
 x.state.status='sent';
 x.telegramApi=async()=>({transactions:[{...transaction(),amount:999}]});
 const other=createPostgresStarsLedger(x);
 await assert.rejects(()=>other.confirmPurchase(purchase),/mismatch/);
 assert.equal(x.rows.length,0);
});
test('double use of same official charge for different payload raises ledger conflict',async()=>{
 const x=fixture(),ledger=createPostgresStarsLedger(x);
 await ledger.confirmPurchase(purchase);
 x.rows[0].buyer_user_id='999';
 await assert.rejects(()=>ledger.confirmPurchase(purchase),/transaction conflict/);
 assert.equal(x.rows.length,1);
});
test('invalid seller IDs are rejected before SQL and no payouts can be requested',async()=>{
 const x=fixture(),ledger=createPostgresStarsLedger(x);
 await assert.rejects(()=>ledger.getSummary(-1),/owner/);
 await assert.rejects(()=>ledger.getHistory(0),/owner/);
 assert.throws(()=>createPostgresStarsLedger(),/trusted/);
 assert.equal(x.calls.length,0);
});

test('official Telegram negative refund is idempotently recorded without transferring Stars',async()=>{
 const x=fixture();
 await createPostgresStarsLedger(x).confirmPurchase(purchase);
 x.telegramApi=async(method,params)=>{
   x.tgCalls.push({method,params});
   return {transactions:[{id:'transaction-true-123',amount:-300,
     receiver:{type:'user',user:{id:77}}}]};
 };
 const ledger=createPostgresStarsLedger(x);
 assert.deepEqual(await ledger.confirmRefund('transaction-true-123'),
   {recorded:true,duplicate:false});
 assert.deepEqual(await ledger.confirmRefund('transaction-true-123'),
   {recorded:true,duplicate:true});
 assert.deepEqual(await ledger.getSummary(44),
   {grossStars:300,netRecordedStars:0,managementFeeTenths:0,creatorShareTenths:0,
    feePolicyId:'video-admin-30-20261107',payoutReady:false});
 assert.deepEqual(await ledger.getHistory(44),[
   {type:'refund',stars:300},{type:'sale',stars:300}
 ]);
 assert.ok(x.tgCalls.every(c=>c.method==='getStarTransactions'));
});
test('refund with unknown sale, wrong buyer, or wrong amount fails closed',async()=>{
 const x=fixture();
 const before=createPostgresStarsLedger(x);
 await assert.rejects(()=>before.confirmRefund('no-such-charge'),/original verified/);
 await before.confirmPurchase(purchase);
 for(const wrong of [
   {id:'transaction-true-123',amount:-299,receiver:{type:'user',user:{id:77}}},
   {id:'transaction-true-123',amount:-300,receiver:{type:'user',user:{id:66}}},
   {id:'transaction-true-123',amount:300,source:{type:'user',user:{id:77}}}
 ]) {
   const bad=createPostgresStarsLedger({
     pool:x.pool,telegramApi:async()=>({transactions:[wrong]})
   });
   await assert.rejects(()=>bad.confirmRefund('transaction-true-123'),/not verified/);
 }
 assert.equal(x.rows.filter(r=>r.kind==='refunded').length,0);
});

test('sales record is rejected without seller acceptance of the 30 percent management fee',async()=>{
 const x=fixture();x.state.fee_terms_accepted_at=null;
 await assert.rejects(()=>createPostgresStarsLedger(x).confirmPurchase(purchase),/management-fee acceptance missing/);
 assert.equal(x.rows.length,0);
});
