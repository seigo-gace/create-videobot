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
const run=promisify(execFile);

if(process.env.VIDEO_FFMPEG_INTEGRATION==='1'){
 test('REAL FFmpeg: >1 hour source creates 30s sample and thumbnail while preserving original',async()=>{
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
       sourcePath:src,thumbnailOutputPath:thumb,sampleOutputPath:sample
     });
     assert.equal(output.thumbnail.kind,'generated');
     assert.equal(output.sample.kind,'clipped');
     assert.ok(output.sample.durationSeconds>0&&output.sample.durationSeconds<=30);
     assert.ok((await stat(thumb)).size>0);
     assert.ok((await stat(sample)).size>0);
     assert.equal(createHash('sha256').update(await readFile(src)).digest('hex'),before);
   }finally{await rm(dir,{recursive:true,force:true});}
 });
}
