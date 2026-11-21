import {mkdtemp,rm,statfs,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {prepareSampleVideo,probeDurationSeconds} from '../sales/sampleMedia.mjs';
import {prepareMissingPreviewAssets} from '../sales/autoPreview.mjs';
import {optimizePaidMp4} from '../sales/paidVideoOptimize.mjs';

/** Bridges existing media processors with the trusted Telegram media store.
 * fetchSource returns {path,cleanup?}. saveGenerated returns a Telegram
 * file_id from an owner-approved PRIVATE staging storage. Neither this module
 * nor the domain processors choose a channel, group, token or storage owner.
 */
export function createVideoMediaProcessor({
  fetchSource, saveGenerated, storageApproved=false,
  run, ffmpeg='ffmpeg', ffprobe='ffprobe', workRoot=tmpdir(),diskStat=statfs
}={}) {
  if(typeof fetchSource!=='function'||typeof saveGenerated!=='function')
    throw new Error('trusted media storage adapters required');
  const options={...(run?{run}:{}),ffmpeg,ffprobe};
  // This workspace is a dedicated disk-backed bind mount in production.
  // 512 MiB is the minimum *operational reserve*, not a claim that it can
  // hold a multi-GB output. optimizePaidMp4 separately checks full source
  // size before beginning its bounded FFmpeg second-copy generation.
  const checkScratchSpace=async()=>{
    const st=await lstat(workRoot);
    if(!st.isDirectory()||st.isSymbolicLink())
      throw Error('CREATOR_MEDIA_WORK_ROOT_INVALID');
    const fs=await diskStat(workRoot,{bigint:true});
    const free=BigInt(fs?.bavail)*BigInt(fs?.bsize);
    if(free<512n*1024n*1024n)
      throw Error('CREATOR_PREVIEW_SCRATCH_SPACE_INSUFFICIENT');
  };
  async function withSource(fileId,callback) {
    if(typeof fileId!=='string'||!fileId.trim())throw new Error('Telegram media file reference required');
    await checkScratchSpace();
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
  async function uploadPrepared(path,type,ownerId) {
    if(storageApproved!==true)throw new Error('approved private media storage unavailable');
    const result=await saveGenerated({path,type,ownerId});
    if(typeof result?.fileId!=='string'||!result.fileId.trim())throw new Error('uploaded media has no Telegram file ID');
    return result.fileId;
  }
  return {
    // A Telegram document file_id cannot be reused as a video file_id.
    // Verify the actual file and upload it through the existing private
    // video staging adapter before the creator editor receives it.
    async normalizeVideoDocument(document,ownerId) {
      if(document?.mime_type!=='video/mp4' ||
         typeof document.file_id!=='string' ||
         !Number.isSafeInteger(ownerId)||ownerId<=0)
        throw new Error('MP4動画ファイルを送信してください。');
      return withSource(document.file_id,async(path,dir)=>{
        await probeDurationSeconds(path,options);
        const optimized=await optimizePaidMp4({...options,inputPath:path,
          outputPath:join(dir,'paid-optimized.mp4')});
        const fileId=await uploadPrepared(optimized.path,'video',ownerId);
        return {file_id:fileId};
      });
    },
    async optimizeMainVideo(video,ownerId) {
      if(typeof video?.file_id!=='string'||!video.file_id.trim()||
         !Number.isSafeInteger(ownerId)||ownerId<=0)
        throw Error('MP4 video/owner missing');
      return withSource(video.file_id,async(path,dir)=>{
        const output=await optimizePaidMp4({...options,inputPath:path,
          outputPath:join(dir,'paid-optimized.mp4')});
        if(output.kind!=='optimized')return {file_id:video.file_id,optimized:false};
        const fileId=await uploadPrepared(output.path,'video',ownerId);
        return {file_id:fileId,optimized:true};
      });
    },
    async prepareUserSample(video) {
      if(typeof video?.file_id!=='string')throw new Error('sample video required');
      return withSource(video.file_id,async(path,dir)=>{
        const result=await prepareSampleVideo({...options,inputPath:path,outputPath:join(dir,'sample.mp4')});
        const fileId=result.kind==='original'
          ? video.file_id : await uploadPrepared(result.path,'video',video.ownerId);
        return {fileId,durationSeconds:result.durationSeconds};
      });
    },
    async prepareMissingPreviews(draft) {
      if(!draft?.paidVideo?.fileId)throw new Error('paid video required for automatic preview');
      if(draft.thumbnail&&draft.sample)return {};
      await checkScratchSpace();
      return withSource(draft.paidVideo.fileId,async(path,dir)=>{
        const prepared=await prepareMissingPreviewAssets({
          ...options,sourcePath:path,thumbnail:draft.thumbnail,sample:draft.sample,
          thumbnailOutputPath:join(dir,'thumb.jpg'),sampleOutputPath:join(dir,'sample.mp4')
        });
        const refs={};
        if(!draft.thumbnail)refs.thumbnail={fileId:await uploadPrepared(prepared.thumbnail.path,'photo',Number(draft.sellerId))};
        if(!draft.sample)refs.sample={
          fileId:await uploadPrepared(prepared.sample.path,'video',Number(draft.sellerId)),
          durationSeconds:prepared.sample.durationSeconds
        };
        return refs;
      });
    }
  };
}
