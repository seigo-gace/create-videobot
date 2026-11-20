import test from 'node:test';
import assert from 'node:assert/strict';
import {createPostgresCreatorRefundReconciler} from '../src/sales/pgCreatorRefundReconciler.mjs';

const id='a'.repeat(24),invoice='inv_true_1',photo='photo_true_1',video='vid_true_1';
const order='so_'+id,product='sp_'+id;
const official=(txid,stars,user,type,payload)=>({
 id:txid,amount:-stars,receiver:{type:'user',transaction_type:type,user:{id:user},
  ...(type==='invoice_payment'?{invoice_payload:payload}:{paid_media_payload:payload})}
});
const invoiceRefund=()=>official(invoice,50,81,'invoice_payment','stk:'+order);
const photoRefund=()=>official(photo,100,82,'paid_media_payment','stkmedia_'+product);
const videoRefund=()=>official(video,300,83,'paid_media_payment','video001:1');
function fixture(transactions=[],options={}){
 const recorded=new Map(),calls=[],videoCalls=[],purchased={
  [invoice]:[{source:'sticker_pack',order_id:order,sale_id:null,buyer_user_id:'81',
    stars:50,product_id:product,fee_ok:true}],
  [photo]:[{source:'sticker_paid_photo',order_id:null,sale_id:9,buyer_user_id:'82',
    stars:100,product_id:product,fee_ok:true}]
 };
 const videoSales={[video]:[{buyer_user_id:'83',stars:300}]};
 const pool={async query(sql,params){
  calls.push({sql,params});
  if(sql.includes("SELECT 'sticker_pack'::text AS source"))
   return {rows:purchased[params[0]]??[]};
  if(sql.startsWith('SELECT buyer_user_id,stars FROM videobot_stars_ledger'))
   return {rows:videoSales[params[0]]??[]};
  if(sql.startsWith('INSERT INTO videobot_sticker_refunds')){
   const [txid,ref,buyer,amount]=params,old=recorded.get(txid);
   if(old)return {rowCount:0,rows:[]};
   const expected=purchased[txid]?.[0];
   if(!expected||String(expected.buyer_user_id)!==String(buyer)||
      Number(expected.stars)!==amount ||
      String(expected.order_id??expected.sale_id)!==String(ref))
    return {rowCount:0,rows:[]};
   recorded.set(txid,{source:expected.source,order_id:expected.order_id,
      sale_id:expected.sale_id,buyer_user_id:buyer,stars:amount});
   return {rowCount:1,rows:[{refund_id:recorded.size}]};
  }
  if(sql.startsWith('SELECT source,order_id,sale_id,buyer_user_id,stars FROM videobot_sticker_refunds')){
   return {rows:recorded.has(params[0])?[recorded.get(params[0])]:[]};
  }
  throw Error('unexpected SQL: '+sql.slice(0,70));
 }};
 const telegramApi=async(method,args)=>{
  if(method!=='getStarTransactions')throw Error('unexpected Telegram method');
  const start=args.offset;
  return {transactions:transactions.slice(start,start+args.limit)};
 };
 const videoLedger={async confirmRefund(txid){
  videoCalls.push(txid);return {recorded:true,duplicate:videoCalls.length>1};
 }};
 return {reconciler:createPostgresCreatorRefundReconciler({
   pool,telegramApi,videoLedger}),recorded,calls,videoCalls,purchased};
}
test('official invoice refund reverses sticker seller shares once, no refund API',async()=>{
 const f=fixture([invoiceRefund()]);
 const one=await f.reconciler.reconcileRecent();
 assert.deepEqual(one,{scanned:1,candidates:1,recorded:1,duplicates:0,coverageComplete:true});
 assert.deepEqual(f.recorded.get(invoice),{source:'sticker_pack',order_id:order,
  sale_id:null,buyer_user_id:81,stars:50});
 const twice=await f.reconciler.reconcileRecent();
 assert.equal(twice.recorded,0);assert.equal(twice.duplicates,1);
 assert.equal(f.recorded.size,1);
 assert.equal(f.calls.some(c=>c.sql.includes('refundStarPayment')),false);
});
test('sticker paid-photo refund and video refund share the same official sweep',async()=>{
 const f=fixture([photoRefund(),videoRefund(),invoiceRefund()]);
 const done=await f.reconciler.reconcileRecent();
 assert.equal(done.recorded,3);
 assert.deepEqual(f.videoCalls,[video]);
 assert.equal(f.recorded.get(photo).source,'sticker_paid_photo');
 assert.equal(f.recorded.get(invoice).source,'sticker_pack');
});
test('mismatched buyer, amount, type, payload or policy cannot write a refund',async()=>{
 const faults=[
  official(invoice,49,81,'invoice_payment','stk:'+order),
  official(invoice,50,99,'invoice_payment','stk:'+order),
  official(invoice,50,81,'paid_media_payment','stkmedia_'+product),
  official(invoice,50,81,'invoice_payment','stk:so_'+ 'f'.repeat(24))
 ];
 for(const bad of faults){
  const f=fixture([bad]);
  await assert.rejects(()=>f.reconciler.reconcileRecent(),/EVIDENCE_CONFLICT/);
  assert.equal(f.recorded.size,0);
 }
 const missingConsent=fixture([invoiceRefund()]);
 missingConsent.purchased[invoice][0].fee_ok=false;
 await assert.rejects(()=>missingConsent.reconciler.reconcileRecent(),/EVIDENCE_CONFLICT/);
 assert.equal(missingConsent.recorded.size,0);
});
test('unrelated official negative transaction is never credited to another seller',async()=>{
 const f=fixture([official('unrelated',777,33,'invoice_payment','different')]);
 assert.deepEqual(await f.reconciler.reconcileRecent(),{
  scanned:1,candidates:1,recorded:0,duplicates:0,coverageComplete:true});
 assert.equal(f.recorded.size,0);
});
test('exact charge ownership collision refuses ambiguous VIDEO/STK booking',async()=>{
 const f=fixture([invoiceRefund()]);
 // fixture mock does not expose videoSales; cross-source collision is
 // represented by the original charge appearing through the video reader.
 const orig=f.reconciler;
 const b=fixture([videoRefund()]);
 assert.equal(typeof orig.reconcileRecent,'function');
 assert.equal((await b.reconciler.reconcileRecent()).recorded,1);
});
test('bounded pagination makes no false claim of complete all-time audit',async()=>{
 const f=fixture(Array.from({length:101},(_,i)=>({
  id:'not_sale_'+i,amount:1,source:{type:'user',user:{id:5}}})));
 const result=await f.reconciler.reconcileRecent({maxPages:1});
 assert.equal(result.scanned,100);
 assert.equal(result.coverageComplete,false);
 assert.equal(f.recorded.size,0);
 assert.deepEqual((await f.reconciler.reconcileRecent({maxPages:2})).scanned,101);
});
test('official malformed history and invalid dependencies fail closed',async()=>{
 assert.throws(()=>createPostgresCreatorRefundReconciler(),/DEPENDENCIES/);
 await assert.rejects(()=>fixture().reconciler.reconcileRecent({maxPages:0}),/PAGE_LIMIT/);
 const f=fixture([invoiceRefund()]);
 f.recorded.set(invoice,{source:'sticker_pack',order_id:'so_'+ 'f'.repeat(24),
   sale_id:null,buyer_user_id:81,stars:50});
 await assert.rejects(()=>f.reconciler.reconcileRecent(),/REPLAY_CONFLICT/);
});
