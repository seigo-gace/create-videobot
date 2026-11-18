/**
 * End-to-end bridge from downloaded Userbot file to Telegram file_ids.
 * Does not change existing paid-media sales, any session, or subscription fee.
 * Uploading is supplied by the existing verified private media owner.
 */
function validSource(channelId,messageId) {
  if(!Number.isSafeInteger(channelId)||channelId<=0||
     !Number.isSafeInteger(messageId)||messageId<=0)
    throw Error('SUBSCRIPTION_SOURCE_ID_INVALID');
}
function verifiedFileId(result) {
  if(typeof result?.fileId!=='string'||!result.fileId.trim())
    throw Error('SUBSCRIPTION_MEDIA_UPLOAD_NOT_CONFIRMED');
  return result.fileId;
}
export function createSubscriptionMediaPipeline({
  catalog,previewGenerator,assetStore,resolveStoredVideo,
  uploadVideo,verifyRights,publish
}={}) {
  for(const fn of [catalog?.findOne,previewGenerator?.generate,assetStore?.readAssets,
    assetStore?.saveAssets,resolveStoredVideo,uploadVideo,verifyRights,publish]) {
    if(typeof fn!=='function')throw Error('SUBSCRIPTION_MEDIA_PIPELINE_PORT_MISSING');
  }
  return {
    async publishCollected({channelId,messageId,title}={}) {
      validSource(channelId,messageId);
      const source=await catalog.findOne(channelId,messageId);
      if(!source?.storage_key)throw Error('SUBSCRIPTION_SOURCE_NOT_COLLECTED');
      // Rights/evidence is owned by the publisher's adopted project, not
      // inferred from the public visibility of the original Telegram message.
      const rights=await verifyRights({channelId,messageId,source});
      if(rights?.redistributionApproved!==true||
         rights?.commercialUseApproved!==true||
         rights?.sampleEditApproved!==true)
        throw Error('SUBSCRIPTION_SOURCE_RIGHTS_UNVERIFIED');
      let assets=await assetStore.readAssets({channelId,messageId});
      if(assets?.streaming_ready!==true || !assets?.full_file_id ||
         !assets?.sample_file_id) {
        const sample=await previewGenerator.generate({
          storageKey:source.storage_key,channelId,messageId
        });
        if(sample?.streamingReady!==true || typeof sample.storagePath!=='string')
          throw Error('SUBSCRIPTION_PREVIEW_NOT_STREAMABLE');
        const fullPath=await resolveStoredVideo(source.storage_key);
        const fullFileId=verifiedFileId(await uploadVideo({path:fullPath,type:'video'}));
        const sampleFileId=verifiedFileId(await uploadVideo({
          path:sample.storagePath,type:'video'
        }));
        await assetStore.saveAssets({channelId,messageId,
          previewStorageKey:sample.storagePath,
          durationSeconds:sample.durationSeconds,
          fullFileId,sampleFileId});
        assets=await assetStore.readAssets({channelId,messageId});
      }
      if(assets?.streaming_ready!==true||!assets?.full_file_id||!assets?.sample_file_id)
        throw Error('SUBSCRIPTION_MEDIA_ASSETS_UNVERIFIED');
      return publish({
        channelId,messageId,
        title:typeof title==='string'&&title.trim()?title:source.channel_title,
        captionJapanese:source.caption_ja,
        fullFileId:assets.full_file_id,
        sampleFileId:assets.sample_file_id,
        sampleStreamingReady:true,
        redistributionApproved:true,
        commercialUseApproved:true,
        sampleEditApproved:true
      });
    }
  };
}
