import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {lstat,statfs,unlink} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
const exec=promisify(execFile);

/**
 * Optimize a paid MP4 only when it is demonstrably worthwhile.
 * Source remains immutable; an unsuitable/large/low-bitrate original is reused.
 * Video is H.264 CRF 22, original resolution and frame cadence; audio AAC 128k.
 * Actual smaller output must be validated before it may replace the sale copy.
 * This is a preparation operation, NOT a public Telegram send.
 */
export async function optimizePaidMp4({
 inputPath,outputPath,run=exec,ffmpeg='ffmpeg',ffprobe='ffprobe',diskStat=statfs
}={}){
 if(typeof inputPath!=='string'||!inputPath.startsWith('/')||
    typeof outputPath!=='string'||!outputPath.startsWith('/')||
    !outputPath.endsWith('.mp4')||resolve(inputPath)===resolve(outputPath))
   throw Error('creator optimizer requires distinct absolute MP4 paths');
 const source=await lstat(inputPath);
 if(!source.isFile()||source.isSymbolicLink()||source.size<1)
   throw Error('creator optimizer source file invalid');
 const {stdout}=await run(ffprobe,[
  '-v','error','-show_entries','format=duration,bit_rate:stream=codec_type,codec_name,width,height',
  '-of','json',inputPath
 ],{timeout:30000,maxBuffer:262144});
 let details;
 try{details=JSON.parse(String(stdout));}catch{throw Error('creator optimizer media probe invalid');}
 const duration=Number(details?.format?.duration);
 const video=details?.streams?.find(x=>x.codec_type==='video');
 const rate=Number(details?.format?.bit_rate);
 if(!Number.isFinite(duration)||duration<=0||!video||
    !Number.isInteger(video.width)||!Number.isInteger(video.height)||
    video.width<1||video.height<1)
   throw Error('creator optimizer video probe invalid');
 // Efficient MP4 should not be transcoded pointlessly. Re-encoding an
 // already-small product wastes time, electricity and adds quality loss.
 const bitrate=Number.isFinite(rate)&&rate>0?rate:source.size*8/duration;
 const ceiling=Math.min(7_500_000,Math.max(1_200_000,video.width*video.height*3.0));
 if(source.size<24_000_000||bitrate<=ceiling||
    duration>7200) return {kind:'original',path:inputPath,reason:'already_efficient_or_long',
     bytes:source.size,durationSeconds:duration};
 // Never attempt a potentially multi-GB re-encode without enough scratch
 // space for a second independent copy and reserved operating capacity.
 const fs=await diskStat(dirname(outputPath),{bigint:true});
 const free=BigInt(fs.bavail)*BigInt(fs.bsize);
 const needed=BigInt(source.size)+64n*1024n*1024n;
 if(free<needed)throw Error('CREATOR_OPTIMIZE_DISK_CAPACITY_INSUFFICIENT');
 const tmp=resolve(dirname(outputPath),'.paid-optimized-'+randomUUID()+'.mp4');
 try{
   // No enlargement or FPS increase. CRF 22 gives a moderate H.264 balance,
   // and capped bitrate prevents high-rate sources from bloating output.
   await run(ffmpeg,[
     '-nostdin','-hide_banner','-loglevel','error','-i',inputPath,
     '-map','0:v:0','-map','0:a?','-c:v','libx264','-preset','veryfast',
     '-crf','22','-maxrate',String(Math.round(ceiling)),
     '-bufsize',String(Math.round(ceiling*2)),
     '-pix_fmt','yuv420p','-c:a','aac','-b:a','128k',
     '-movflags','+faststart','-y',tmp
   ],{timeout:900000,maxBuffer:1048576});
   const generated=await lstat(tmp);
   if(!generated.isFile()||generated.isSymbolicLink()||generated.size<1)
     throw Error('creator optimized output invalid');
   // At least 10% smaller; otherwise preserve exact original quality.
   if(generated.size>source.size*0.9)
     return {kind:'original',path:inputPath,reason:'not_materially_smaller',
       bytes:source.size,durationSeconds:duration};
   const checked=await run(ffprobe,[
     '-v','error','-show_entries','format=duration:stream=codec_type,codec_name,width,height',
     '-of','json',tmp
   ],{timeout:30000,maxBuffer:262144});
   let result;
   try{result=JSON.parse(String(checked.stdout));}catch{throw Error('creator optimized verification invalid');}
   const v=result?.streams?.find(x=>x.codec_type==='video');
   const seconds=Number(result?.format?.duration);
   if(v?.codec_name!=='h264'||v.width!==video.width||v.height!==video.height||
     !Number.isFinite(seconds)||Math.abs(seconds-duration)>Math.max(0.2,duration*0.001))
     throw Error('creator optimized video mismatch');
   // No hardlink/rename overwrite of an unrelated file.
   const {link}=await import('node:fs/promises');
   await link(tmp,outputPath);
   return {kind:'optimized',path:outputPath,bytes:generated.size,
     originalBytes:source.size,durationSeconds:seconds};
 }finally{await unlink(tmp).catch(e=>{if(e.code!=='ENOENT')throw e;});}
}
