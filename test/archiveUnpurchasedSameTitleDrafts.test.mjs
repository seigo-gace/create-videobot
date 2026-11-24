import test from 'node:test';
import assert from 'node:assert/strict';
import {archiveUnpurchasedSameTitleDrafts} from '../src/operations/archiveUnpurchasedSameTitleDrafts.mjs';
function fixture({buyer=true,eligible=2,changed=false}={}){
 const calls=[];let released=false;
 const client={async query(sql,args=[]){
   calls.push({sql,args});
   if(sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK')return {};
   if(sql.startsWith('SELECT seller_user_id,title'))
     return {rows:[{seller_user_id:22,title:'肉便器'}]};
   if(sql.includes('AS verified_buyer'))return {rows:[{verified_buyer:buyer}]};
   if(sql.startsWith('SELECT COUNT(*)')&&sql.includes('videobot_listings l WHERE'))
     return {rows:[{n:eligible}]};
   if(sql.startsWith('SELECT COUNT(*)')&&sql.includes('videobot_listings WHERE'))
     return {rows:[{n:calls.some(x=>x.sql.startsWith('UPDATE '))?4:6}]};
   if(sql.startsWith('UPDATE videobot_listings l'))
     return {rowCount:changed?1:eligible,rows:[]};
   throw Error('unexpected SQL: '+sql.slice(0,80));
 },release(){released=true;}};
 return {pool:{connect:async()=>client},calls,get released(){return released}};
}
test('dry-run identifies drafts without modifying public posts or buyer records',async()=>{
 const f=fixture();
 const result=await archiveUnpurchasedSameTitleDrafts({pool:f.pool});
 assert.deepEqual(result,{before:6,eligible:2,archived:0,applied:false,buyerProtected:true});
 assert(!f.calls.some(x=>x.sql.startsWith('UPDATE ')));
 assert(f.calls.some(x=>x.sql==='ROLLBACK'));
 assert(f.released);
});
test('only draft/ready with no receipts, payments, orders or unresolved session is archived',async()=>{
 const f=fixture();
 const result=await archiveUnpurchasedSameTitleDrafts({pool:f.pool,apply:true});
 assert.deepEqual(result,{before:6,eligible:2,archived:2,applied:true,buyerProtected:true});
 const update=f.calls.find(x=>x.sql.startsWith('UPDATE videobot_listings'));
 assert(update.sql.includes("l.status IN ('draft','ready')"));
 assert(update.sql.includes('NOT EXISTS(SELECT 1 FROM videobot_post_receipts'));
 assert(update.sql.includes('NOT EXISTS(SELECT 1 FROM videobot_stars_ledger'));
 assert(update.sql.includes('NOT EXISTS(SELECT 1 FROM videobot_video_invoice_orders'));
 assert(update.sql.includes('videobot_creator_sessions'));
 assert(f.calls.some(x=>x.sql==='COMMIT'));
 assert(f.released);
});
test('buyer absent stops before mutation and rolls transaction back',async()=>{
 const f=fixture({buyer:false});
 await assert.rejects(()=>archiveUnpurchasedSameTitleDrafts({pool:f.pool,apply:true}),
  /NO_VERIFIED_BUYER_STOP/);
 assert(!f.calls.some(x=>x.sql.startsWith('UPDATE ')));
 assert(f.calls.some(x=>x.sql==='ROLLBACK'));
});
test('concurrent update loses CAS, rolls back all archive candidates',async()=>{
 const f=fixture({changed:true});
 await assert.rejects(()=>archiveUnpurchasedSameTitleDrafts({pool:f.pool,apply:true}),
  /CONCURRENT_CHANGE/);
 assert(!f.calls.some(x=>x.sql==='COMMIT'));
 assert(f.calls.some(x=>x.sql==='ROLLBACK'));
});
