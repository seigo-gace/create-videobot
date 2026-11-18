import test from 'node:test';
import assert from 'node:assert/strict';
import {createSubscriptionMediaPipeline} from '../src/collection/subscriptionMediaPipeline.mjs';

function setup({eligible=true}={}) {
  let generated=0,uploaded=0,sent=0;
  const files={};
  const pipeline=createSubscriptionMediaPipeline({
    catalog:{async findOne(){return {
      channel_title:'公開チャンネルA',storage_key:'private/videoA.mp4',caption_ja:'日本語で説明'
    };}},
    previewGenerator:{async generate(){
      generated++;
      return {storagePath:'/tmp/60s.mp4',durationSeconds:60,streamingReady:true};
    }},
    assetStore:{
      async readAssets(){return files.row??null;},
      async saveAssets(value){files.row={
        full_file_id:value.fullFileId,sample_file_id:value.sampleFileId,
        streaming_ready:true
      };}
    },
    resolveStoredVideo:async()=>'/tmp/full.mp4',
    uploadVideo:async({path})=>{uploaded++;return {fileId:'file:'+path};},
    verifyRights:async()=>eligible
      ?{redistributionApproved:true,commercialUseApproved:true,sampleEditApproved:true}
      :{redistributionApproved:true,commercialUseApproved:false,sampleEditApproved:true},
    publish:async(video)=>{sent++;return {video,published:true};}
  });
  return {pipeline,metrics:()=>({generated,uploaded,sent})};
}
test('collect, preview, upload and publish passes original and sample file ids',async()=>{
  const {pipeline,metrics}=setup();
  const r=await pipeline.publishCollected({channelId:100,messageId:20});
  assert.equal(r.published,true);
  assert.equal(r.video.fullFileId,'file:/tmp/full.mp4');
  assert.equal(r.video.sampleFileId,'file:/tmp/60s.mp4');
  assert.equal(r.video.captionJapanese,'日本語で説明');
  assert.equal(r.video.commercialUseApproved,true);
  assert.deepEqual(metrics(),{generated:1,uploaded:2,sent:1});
  await pipeline.publishCollected({channelId:100,messageId:20});
  assert.deepEqual(metrics(),{generated:1,uploaded:2,sent:2});
});
test('no preview/upload/publish on unverified re-distribution rights',async()=>{
  const {pipeline,metrics}=setup({eligible:false});
  await assert.rejects(pipeline.publishCollected({channelId:100,messageId:20}),/RIGHTS_UNVERIFIED/);
  assert.deepEqual(metrics(),{generated:0,uploaded:0,sent:0});
});
