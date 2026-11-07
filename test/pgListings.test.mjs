import test from 'node:test';
import assert from 'node:assert/strict';
import {createPostgresListingStore} from '../src/sales/pgListings.mjs';

function fakeDb(){
  const rows=new Map(),queries=[];
  function defaults(id,owner,d){
    return {listing_id:id,seller_user_id:owner,revision:1,title:d[0],price_stars:d[1],
      price_mode:d[2],thumbnail_file_id:d[3],sample_file_id:d[4],
      sample_duration_seconds:d[5],paid_video_file_id:d[6],
      rights_verified:d[7],adult_consent_verified:d[8],status:'draft'};
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
    if(sql.startsWith("UPDATE videobot_listings SET status='removed'")){
      const [owner,id,revision]=params,old=rows.get(id);
      if(!old||old.seller_user_id!==owner||old.revision!==revision||
        !['draft','ready'].includes(old.status))return {rowCount:0,rows:[]};
      old.status='removed';old.revision++;return {rowCount:1,rows:[{listing_id:id}]};
    }
    throw new Error('unknown SQL');
  };
  return {rows,queries,query};
}
function example(overrides={}){
  return {title:'夏の思い出',priceStars:300,priceMode:'preset',thumbnail:{fileId:'photo001'},
    sample:{fileId:'sample001',durationSeconds:30},paidVideo:{fileId:'paid001'},
    rightsVerified:true,adultConsentVerified:true,...overrides};
}
test('private video listing create/read/update retains other properties and seller ownership',async()=>{
  const db=fakeDb(),store=createPostgresListingStore(db);
  const first=await store.createDraft(33,'vid001',example());
  assert.equal(first.revision,1);
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
  await assert.rejects(()=>store.createDraft(33,'v1',example({sample:{fileId:'s001',durationSeconds:30.1}})),/30 seconds/);
  await assert.rejects(()=>store.createDraft(-1,'v1',example()),/owner/);
  assert.equal(db.queries.length,0);
});
