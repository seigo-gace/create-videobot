import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {prepareSampleVideo} from '../sales/sampleMedia.mjs';
import {prepareMissingPreviewAssets} from '../sales/autoPreview.mjs';

/** Bridges existing media processors with the trusted Telegram media store.
 * fetchSource returns {path,cleanup?}. saveGenerated returns a Telegram
 * file_id from an owner-approved PRIVATE staging storage. Neither this module
 * nor the domain processors choose a channel, group, token or storage owner.
 */
export function createVideoMediaProcessor({
  fetchSource, saveGenerated, storageApproved=false,
  run, ffmpeg='ffmpeg', ffprobe='ffprobe', workRoot=tmpdir()
}={}) {
  if(typeof fetchSource!=='function'||typeof saveGenerated!=='function')
    throw new Error('trusted media storage adapters required');
  const options={...(run?{run}:{}),ffmpeg,ffprobe};
  async function withSource(fileId,callback) {
    if(typeof fileId!=='string'||!fileId.trim())throw new Error('Telegram media file reference required');
    const dir=await mkdtemp(join(workRoot,'videobot-media-'));
    let opened=null;
    try {
      opened=await fetchSource(fileId,dir);
      if(typeof opened?.path!=='string')throw new Error('downloaded media unavailable');
      return await callback(opened.path,dir);
    } finally {
      if(typeof opened?.cleanup==='function')await opened.cleanup();
      await rm(dir,{recursive:true,force:true});
    }
  }
  async function uploadPrepared(path,type) {
    if(storageApproved!==true)throw new Error('approved private media storage unavailable');
    const result=await saveGenerated({path,type});
    if(typeof result?.fileId!=='string'||!result.fileId.trim())throw new Error('uploaded media has no Telegram file ID');
    return result.fileId;
  }
  return {
    async prepareUserSample(video) {
      if(typeof video?.file_id!=='string')throw new Error('sample video required');
      return withSource(video.file_id,async(path,dir)=>{
        const result=await prepareSampleVideo({...options,inputPath:path,outputPath:join(dir,'sample.mp4')});
        const fileId=result.kind==='original'
          ? video.file_id : await uploadPrepared(result.path,'video');
        return {fileId,durationSeconds:result.durationSeconds};
      });
    },
    async prepareMissingPreviews(draft) {
      if(!draft?.paidVideo?.fileId)throw new Error('paid video required for automatic preview');
      if(draft.thumbnail&&draft.sample)return {};
      return withSource(draft.paidVideo.fileId,async(path,dir)=>{
        const prepared=await prepareMissingPreviewAssets({
          ...options,sourcePath:path,thumbnail:draft.thumbnail,sample:draft.sample,
          thumbnailOutputPath:join(dir,'thumb.jpg'),sampleOutputPath:join(dir,'sample.mp4')
        });
        const refs={};
        if(!draft.thumbnail)refs.thumbnail={fileId:await uploadPrepared(prepared.thumbnail.path,'photo')};
        if(!draft.sample)refs.sample={
          fileId:await uploadPrepared(prepared.sample.path,'video'),
          durationSeconds:prepared.sample.durationSeconds
        };
        return refs;
      });
    }
  };
}
