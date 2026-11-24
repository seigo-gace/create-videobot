import test from 'node:test';
import assert from 'node:assert/strict';
import {ensureRichOfferClaimTable} from '../src/operations/ensureRichOfferClaimTable.mjs';
test('creates only additive rich receipt claim storage; never alters buyer or invoice tables',async()=>{
 const calls=[];
 const pool={query:async sql=>{
  calls.push(sql);
  return sql.startsWith('SELECT')?{rows:[{available:true}]}:{rowCount:0};
 }};
 await ensureRichOfferClaimTable(pool);
 assert.equal(calls.length,3);
 assert.match(calls[0],/^CREATE TABLE IF NOT EXISTS videobot_rich_offer_receipts/);
 assert.match(calls[1],/^CREATE INDEX IF NOT EXISTS videobot_rich_offer_reconcile/);
 assert(!calls.some(q=>/\bDROP\b|\bDELETE\b|\bUPDATE\b|\bTRUNCATE\b|\bALTER TABLE\b|videobot_stars_ledger|videobot_video_invoice_orders/i.test(q)));
});
test('fails closed when receipt storage remains unavailable',async()=>{
 await assert.rejects(()=>ensureRichOfferClaimTable({
  query:async sql=>sql.startsWith('SELECT')?{rows:[{available:false}]}:{rowCount:0}
 }),/VIDEO_RICH_RECEIPT_SCHEMA_UNAVAILABLE/);
});
