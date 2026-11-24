import test from 'node:test';
import assert from 'node:assert/strict';
import {createPostgresListingStore} from '../src/sales/pgListings.mjs';

function fakeDb(){
  const rows=new Map(),queries=[],receipts=new Map();
  function defaults(id,owner,d){
    return {listing_id:id,seller_user_id:owner,revision:1,title:d[0],price_stars:d[1],
      price_mode:d[2],thumbnail_file_id:d[3],sample_file_id:d[4],
      sample_duration_seconds:d[5],paid_video_file_id:d[6],
      rights_verified:d[7],adult_consent_verified:d[8],fee_terms_accepted_at:d[9]?d[13]:null,
      management_fee_bps:3000,description:d[10]??'',creator_terms_version:d[11]??null,creator_terms_url:d[12]??null,second_thumbnail_file_id:d[14]??null,status:'draft'};
  }
  const query=async(sql,params)=>{
    queries.push({sql,params});
    if(sql.startsWith('SELECT * FROM videobot_listings WHERE seller_user_id=$1 AND status')){
      return {rows:[...rows.values()].filter(r=>r.seller_user_id===params[0]&&r.status!=='removed')};
    }
    if(sql.startsWith('SELECT * FROM videobot_listings WHERE seller_user_id=$1 AND listing_id=$2')){
      const r=rows.get(params[1]);return {rows:r?.seller_user_id===params[0]&&r.status!=='removed'?[r]:[]};
    }
    if(sql.startsWith('INSERT INTO videobot_listings')){
      const [id,owner,...draft]=params;
      if(rows.has(id))return {rowCount:0,rows:[]};
      const r=defaults(id,owner,draft);rows.set(id,r);
      return {rowCount:1,rows:[r]};
    }
    if(sql.startsWith('UPDATE videobot_listings SET title=')){
      const [owner,id,revision,...draft]=params;
      const old=rows.get(id);
      if(!old||old.seller_user_id!==owner||old.revision!==revision||
        !['draft','ready'].includes(old.status))return {rowCount:0,rows:[]};
      const next={...old,...defaults(id,owner,draft),revision:revision+1,status:old.status};
      rows.set(id,next);return {rowCount:1,rows:[next]};
    }
    if(sql.startsWith("UPDATE videobot_listings AS l SET status='published'")){
      const [owner,id,revision,freeMessageIds,paidMessageId]=params,old=rows.get(id);
      const receipt=receipts.get(id+':'+revision);
      if(!old||old.seller_user_id!==owner||old.revision!==revision||
         !['draft','ready'].includes(old.status)||!old.rights_verified||
         !old.adult_consent_verified||!old.fee_terms_accepted_at||
         old.creator_terms_version!=='1.0'||!old.creator_terms_url||old.management_fee_bps!==3000||!old.title||!old.price_stars||
         !old.thumbnail_file_id||!old.sample_file_id||!old.paid_video_file_id||
         receipt?.status!=='sent'||
         JSON.stringify(receipt.freeMessageIds)!==JSON.stringify(freeMessageIds)||
         receipt.paidMessageId!==paidMessageId)
        return {rowCount:0,rows:[]};
      old.status='published';old.revision++;
      return {rowCount:1,rows:[old]};
    }
    if(sql.startsWith("UPDATE videobot_listings SET status='removed'")){
      const [owner,id,revision]=params,old=rows.get(id);
      if(!old||old.seller_user_id!==owner||old.revision!==revision||
        !['draft','ready'].includes(old.status))return {rowCount:0,rows:[]};
      old.status='removed';old.revision++;return {rowCount:1,rows:[{listing_id:id}]};
    }
    throw new Error('unknown SQL');
  };
  return {rows,queries,receipts,query};
}
function example(overrides={}){
  return {title:'夏の思い出',priceStars:300,priceMode:'preset',thumbnail:{fileId:'photo001'},
    sample:{fileId:'sample001',durationSeconds:30},paidVideo:{fileId:'paid001'},
    rightsVerified:true,adultConsentVerified:true,
    termsVersion:'1.0',termsUrl:'https://example.test/createvdobot-terms.html',
    termsAcceptedAt:'2026-11-19T12:00:00.000Z',...overrides};
}
test('private video listing create/read/update retains other properties and seller ownership',async()=>{
  const db=fakeDb(),store=createPostgresListingStore(db);
  const first=await store.createDraft(33,'vid001',example());
  assert.equal(first.revision,1);
  assert.equal(first.description,'');
  assert.equal(first.sample.durationSeconds,30);
  assert.equal((await store.listByOwner(33)).length,1);
  assert.equal((await store.getOwned(44,'vid001')),null);
  assert.equal((await store.getOwned(33,'vid001')).paidVideo.fileId,'paid001');
  const newDraft=example({title:'変更済',thumbnail:{fileId:'photo002'}});
  const second=await store.updateDraft(33,'vid001',1,newDraft);
  assert.equal(second.revision,2);
  assert.equal(second.paidVideo.fileId,'paid001');
  assert.equal(second.thumbnail.fileId,'photo002');
  assert.ok(db.queries.every(x=>x.sql.includes('videobot_listings')));
});
test('reject stale update/owner and prevent published purchases from mutating',async()=>{
  const db=fakeDb(),store=createPostgresListingStore(db);
  await store.createDraft(33,'vid001',example());
  await assert.rejects(()=>store.createDraft(33,'vid001',example()),/ALREADY_EXISTS/);
  await assert.rejects(()=>store.updateDraft(33,'vid001',5,example()),/STALE_OR_PUBLISHED/);
  await assert.rejects(()=>store.updateDraft(44,'vid001',1,example()),/STALE_OR_PUBLISHED/);
  db.rows.get('vid001').status='published';
  await assert.rejects(()=>store.updateDraft(33,'vid001',1,example()),/STALE_OR_PUBLISHED/);
  await assert.rejects(()=>store.removeUnpublished(33,'vid001',1),/STALE_OR_PUBLISHED/);
  assert.equal(db.rows.get('vid001').status,'published');
});
test('unpublished removal is logical and preserves record instead of DELETE',async()=>{
  const db=fakeDb(),store=createPostgresListingStore(db);
  await store.createDraft(33,'vid001',example());
  assert.deepEqual(await store.removeUnpublished(33,'vid001',1),{removed:true,id:'vid001'});
  assert.equal(await store.getOwned(33,'vid001'),null);
  assert.equal((await store.listByOwner(33)).length,0);
  assert.equal(db.rows.size,1);
  assert.equal(db.rows.get('vid001').status,'removed');
  assert.equal(db.queries.some(q=>/DELETE FROM/i.test(q.sql)),false);
});
test('reject invalid prices and overlength or unverified free samples before SQL writes',async()=>{
  const db=fakeDb(),store=createPostgresListingStore(db);
  await assert.rejects(()=>store.createDraft(33,'v1',example({priceStars:25001})),/price/);
  await assert.rejects(()=>store.createDraft(33,'v1',example({sample:{fileId:'s001',durationSeconds:60.2}})),/60.1 seconds/);
  await assert.rejects(()=>store.createDraft(-1,'v1',example()),/owner/);
  assert.equal(db.queries.length,0);
});

test('published status requires both Telegram receipts and rights/consent; paid media becomes immutable',async()=>{
  const db=fakeDb(),store=createPostgresListingStore(db);
  await store.createDraft(33,'vid002',example({feeTermsAccepted:true}));
  const receipt={posted:true,freeMessageIds:[101,102],paidMessageId:103};
  await assert.rejects(()=>store.markPublished(33,'vid002',1,{posted:true,paidMessageId:103}),/receipt required/);
  await assert.rejects(()=>store.markPublished(33,'vid002',1,{...receipt,freeMessageIds:[-1,102]}),/receipt required/);
  assert.equal(db.rows.get('vid002').status,'draft');
  await assert.rejects(()=>store.markPublished(33,'vid002',1,receipt),/RECONCILE/);
  db.receipts.set('vid002:1',{status:'sent',freeMessageIds:[101,102],paidMessageId:103});
  const published=await store.markPublished(33,'vid002',1,receipt);
  assert.equal(published.status,'published');
  assert.equal(published.revision,2);
  await assert.rejects(()=>store.updateDraft(33,'vid002',2,example({priceStars:500})),/STALE_OR_PUBLISHED/);
  await assert.rejects(()=>store.removeUnpublished(33,'vid002',2),/STALE_OR_PUBLISHED/);
  assert.equal(db.rows.get('vid002').price_stars,300);
});

test('published listing requires explicit 30 percent fee acceptance snapshot',async()=>{
 const db=fakeDb(),store=createPostgresListingStore(db);
 await store.createDraft(33,'fee001',example());
 db.receipts.set('fee001:1',{status:'sent',freeMessageIds:[81,82],paidMessageId:83});
 await assert.rejects(()=>store.markPublished(33,'fee001',1,{
   posted:true,freeMessageIds:[81,82],paidMessageId:83
 }),/RECONCILE/);
 const accepted=await store.updateDraft(33,'fee001',1,example({feeTermsAccepted:true}));
 db.receipts.set('fee001:2',{status:'sent',freeMessageIds:[91,92],paidMessageId:93});
 const approved=await store.markPublished(33,'fee001',2,{
   posted:true,freeMessageIds:[91,92],paidMessageId:93
 });
 assert.equal(accepted.feeTermsAccepted,true);
 assert.equal(approved.status,'published');
 assert.equal(approved.managementFeeBps,3000);
});

test('optional video description persists with the existing owner listing and is length limited',async()=>{
 const db=fakeDb(),store=createPostgresListingStore(db);
 const first=await store.createDraft(33,'description_video',example({description:'最初の説明'}));
 assert.equal(first.description,'最初の説明');
 const changed=await store.updateDraft(33,'description_video',1,example({description:'差し替え説明'}));
 assert.equal(changed.description,'差し替え説明');
 assert.equal((await store.getOwned(33,'description_video')).description,'差し替え説明');
 await assert.rejects(()=>store.createDraft(33,'overlong',example({description:'a'.repeat(801)})),/description/);
});

test('posting agreement keeps version and URL in database, and legacy unversioned approval cannot publish',async()=>{
 const db=fakeDb(),store=createPostgresListingStore(db);
 const initial=await store.createDraft(33,'terms_ok',example({feeTermsAccepted:true}));
 assert.equal(initial.termsVersion,'1.0');
 assert.equal(initial.termsUrl,'https://example.test/createvdobot-terms.html');
 assert.equal(initial.termsAcceptedAt,'2026-11-19T12:00:00.000Z');
 assert.ok(initial.termsAcceptedAt);
 const invalid=example({feeTermsAccepted:true,termsVersion:null});
 await assert.rejects(()=>store.createDraft(33,'terms_invalid',invalid),/versioned creator terms/);
 assert.equal(db.rows.has('terms_invalid'),false);
});

test('updated creator draft retains exact original acceptance timestamp; clearing terms removes it',async()=>{
 const db=fakeDb(),store=createPostgresListingStore(db);
 const accepted=example({feeTermsAccepted:true,termsAcceptedAt:'2026-11-19T12:34:56.789Z'});
 const first=await store.createDraft(33,'time001',accepted);
 assert.equal(first.termsAcceptedAt,accepted.termsAcceptedAt);
 const next=await store.updateDraft(33,'time001',first.revision,accepted);
 assert.equal(next.termsAcceptedAt,accepted.termsAcceptedAt);
 const cleared=await store.updateDraft(33,'time001',next.revision,example({feeTermsAccepted:false}));
 assert.equal(cleared.feeTermsAccepted,false);
 assert.equal(cleared.termsAcceptedAt,null);
 assert.equal(cleared.termsVersion,null);
 assert.equal(cleared.termsUrl,null);
});
