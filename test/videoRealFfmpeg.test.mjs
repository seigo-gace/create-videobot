import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {prepareMissingPreviewAssets} from '../src/sales/autoPreview.mjs';
import {probeDurationSeconds} from '../src/sales/sampleMedia.mjs';
import {optimizePaidMp4} from '../src/sales/paidVideoOptimize.mjs';
const run=promisify(execFile);

if(process.env.VIDEO_FFMPEG_INTEGRATION==='1'){
 test('REAL FFmpeg: >1 hour source creates 60s four-part sample and two thumbnails while preserving original',async()=>{
   const dir=await mkdtemp(join(tmpdir(),'cv-long-video-'));
   const src=join(dir,'one-hour.mp4'),thumb=join(dir,'thumb.jpg'),sample=join(dir,'sample.mp4');
   try{
     // One hour of simple frames is CPU-cheap yet exercises real container,
     // ffprobe duration, sampling, FFmpeg, and disk output end to end.
     await run('ffmpeg',['-nostdin','-hide_banner','-loglevel','error',
       '-f','lavfi','-i','color=c=blue:s=64x64:r=1',
       '-t','3601','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p',
       '-y',src],{timeout:120000,maxBuffer:1024*1024});
     const before=createHash('sha256').update(await readFile(src)).digest('hex');
     const duration=await probeDurationSeconds(src);
     assert.ok(duration>3600,'source must genuinely exceed one hour');
     const output=await prepareMissingPreviewAssets({
       sourcePath:src,thumbnailOutputPath:thumb,secondThumbnailOutputPath:join(dir,'thumb2.jpg'),sampleOutputPath:sample
     });
     assert.equal(output.thumbnail.kind,'generated');
     assert.equal(output.sample.kind,'clipped');
     assert.ok(Math.abs(output.sample.durationSeconds-60)<0.15);
     assert.ok((await stat(join(dir,'thumb2.jpg'))).size>0);
     assert.ok((await stat(thumb)).size>0);
     assert.ok((await stat(sample)).size>0);
     assert.equal(createHash('sha256').update(await readFile(src)).digest('hex'),before);
   }finally{await rm(dir,{recursive:true,force:true});}
 });
}

if(process.env.VIDEO_FFMPEG_INTEGRATION==='1'){
 test('REAL FFmpeg: moderately compress a real 720p H264 MP4 only when smaller',async()=>{
   const dir=await mkdtemp(join(tmpdir(),'cv-paid-opt-'));
   const src=join(dir,'main.mp4'),target=join(dir,'optimized.mp4');
   try {
     await run('ffmpeg',['-nostdin','-hide_banner','-loglevel','error',
       '-f','lavfi','-i','testsrc2=s=1280x720:r=24',
       '-t','16','-c:v','libx264','-preset','ultrafast','-qp','0',
       '-pix_fmt','yuv420p','-movflags','+faststart','-y',src],
       {timeout:180000,maxBuffer:1024*1024});
     const originalSize=(await stat(src)).size;
     assert.ok(originalSize>24_000_000,
       'fixture must be a substantial high-bitrate 720p MP4, not a tiny fake');
     const digest=createHash('sha256').update(await readFile(src)).digest('hex');
     const outcome=await optimizePaidMp4({inputPath:src,outputPath:target});
     assert.equal(outcome.kind,'optimized');
     assert.ok(outcome.bytes<originalSize*0.9);
     assert.ok(Math.abs(outcome.durationSeconds-16)<0.2);
     assert.equal(createHash('sha256').update(await readFile(src)).digest('hex'),digest);
   }finally{await rm(dir,{recursive:true,force:true});}
 });
}

if(process.env.VIDEO_FFMPEG_INTEGRATION==='1'){
 test('REAL FFmpeg: four different synthetic scenes appear once each in one 60-second video',async()=>{
   const dir=await mkdtemp(join(tmpdir(),'cv-four-scenes-'));
   const src=join(dir,'synthetic.mp4'),thumb=join(dir,'thumb.jpg'),second=join(dir,'thumb2.jpg'),sample=join(dir,'sample.mp4');
   try{
     const colors=['red','lime','blue','yellow'];
     await run('ffmpeg',['-nostdin','-hide_banner','-loglevel','error',
       ...colors.flatMap(c=>['-f','lavfi','-i','color=c='+c+':s=96x64:r=10:d=20']),
       '-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=80',
       '-filter_complex','[0:v][1:v][2:v][3:v]concat=n=4:v=1:a=0[v]',
       '-map','[v]','-map','4:a:0','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-c:a','aac','-y',src],
       {timeout:120000,maxBuffer:1024*1024});
     const digest=createHash('sha256').update(await readFile(src)).digest('hex');
     const out=await prepareMissingPreviewAssets({sourcePath:src,thumbnailOutputPath:thumb,secondThumbnailOutputPath:second,sampleOutputPath:sample});
     assert.ok(Math.abs(out.sample.durationSeconds-60)<0.15);
     assert.notDeepEqual(await readFile(thumb),await readFile(second));
     const expected=[[255,0,0],[0,255,0],[0,0,255],[255,255,0]];
     for(const [index,at] of [5,20,35,50].entries()){
       const {stdout}=await run('ffmpeg',['-nostdin','-hide_banner','-loglevel','error','-ss',String(at),'-i',sample,
         '-frames:v','1','-vf','scale=1:1','-pix_fmt','rgb24','-f','rawvideo','pipe:1'],{encoding:'buffer',timeout:30000,maxBuffer:1024});
       assert.equal(stdout.length,3);
       assert.ok(expected[index].every((v,i)=>Math.abs(v-stdout[i])<=35),'unexpected scene at '+at+' seconds');
     }
     const {stdout}=await run('ffprobe',['-v','error','-show_entries','stream=codec_type,codec_name','-of','json',sample]);
     const streams=JSON.parse(stdout).streams;
     assert.ok(streams.some(s=>s.codec_type==='video'&&s.codec_name==='h264'));
     assert.ok(streams.some(s=>s.codec_type==='audio'&&s.codec_name==='aac'));
     assert.equal(createHash('sha256').update(await readFile(src)).digest('hex'),digest);
   }finally{await rm(dir,{recursive:true,force:true});}
 });
}
