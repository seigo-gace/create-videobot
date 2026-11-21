import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFreeAlbumRequest, buildListingMessagePlan } from '../src/telegram/freeAlbum.mjs';
import { buildPaidMediaRequest } from '../src/telegram/paidMedia.mjs';

test('thumbnail and sample are one spoiler gallery; paid main is a separate message', () => {
  const base = { chatId:-1001234567890, messageThreadId:42 };
  const free = buildFreeAlbumRequest({ ...base, thumbnailFileId:'photo001', sampleFileId:'sample001',caption:'夏の思い出' });
  const paid = buildPaidMediaRequest({ ...base, mediaFileId:'main001', priceStars:300 });
  assert.equal(free.media.length,2);
  assert.deepEqual(free.media.map(m=>m.type),['photo','video']);
  assert.deepEqual(free.media.map(m=>m.has_spoiler),[true,true]);
  assert.equal(free.media[0].caption,'夏の思い出');
  const plan = buildListingMessagePlan({ listingId:'listing1',freeAlbum:free,paidMedia:paid });
  assert.deepEqual(plan.steps.map(x=>x.method),['sendMediaGroup','sendPaidMedia']);
  assert.equal(plan.publishableWithoutDurableRecovery,false);
  assert.equal(plan.steps[1].params.star_count,300);
});
test('reject missing album media or mismatched paid destination', () => {
  const free = buildFreeAlbumRequest({chatId:1,thumbnailFileId:'photo001',sampleFileId:'sample001'});
  const paid = buildPaidMediaRequest({chatId:2,mediaFileId:'main001',priceStars:100});
  assert.throws(()=>buildListingMessagePlan({listingId:'listing1',freeAlbum:free,paidMedia:paid}),/mismatch/);
  assert.throws(()=>buildFreeAlbumRequest({chatId:1,thumbnailFileId:'',sampleFileId:'sample001'}),/thumbnail/);
  assert.throws(()=>buildFreeAlbumRequest({chatId:1,thumbnailFileId:'photo001',sampleFileId:'sample001',caption:'a'.repeat(1025)}),/caption/);
});
