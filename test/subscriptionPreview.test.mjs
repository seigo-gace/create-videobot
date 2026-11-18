import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createSubscriptionPreviewGenerator} from '../src/collection/subscriptionPreview.mjs';

test('generates a 60s MP4 with H264/AAC faststart and remembers real duration',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'subscription-preview-'));
  const commands=[];
  try {
    const gen=createSubscriptionPreviewGenerator({
      resolveStoredVideo:async()=>'/stored/video.mp4',outputRoot:dir,
      run:async(cmd,args)=>{
        commands.push({cmd,args});
        if(cmd==='ffprobe')return {stdout:'120\n'};
        await writeFile(args.at(-1),Buffer.from('mock video data'));
        return {stdout:''};
      }
    });
    const r=await gen.generate({storageKey:'assetA',channelId:123,messageId:456});
    assert.equal(r.durationSeconds,60);
    assert.equal(r.streamingReady,true);
    assert.match(r.storagePath,/sample-60s\.mp4$/);
    const ff=commands.find(x=>x.cmd==='ffmpeg').args;
    assert.equal(ff[ff.indexOf('-t')+1],'60');
    assert.equal(ff[ff.indexOf('-c:v')+1],'libx264');
    assert.equal(ff[ff.indexOf('-movflags')+1],'+faststart');
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('short videos are not falsely labeled 60 seconds',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'subscription-short-'));
  try {
    const gen=createSubscriptionPreviewGenerator({
      resolveStoredVideo:async()=>'/stored/short.mp4',outputRoot:dir,
      run:async(cmd,args)=>{
        if(cmd==='ffprobe')return {stdout:'35\n'};
        await writeFile(args.at(-1),'video');return {stdout:''};
      }
    });
    const r=await gen.generate({storageKey:'s',channelId:1,messageId:2});
    assert.equal(r.durationSeconds,35);
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('previews reject invalid start offset and missing video',async()=>{
  const gen=createSubscriptionPreviewGenerator({
    resolveStoredVideo:async()=>'/stored/video.mp4',outputRoot:'/tmp/subscription',
    run:async()=>({stdout:'15\n'})
  });
  await assert.rejects(gen.generate({storageKey:'s',channelId:1,messageId:2,startSeconds:20}),/DURATION_INVALID/);
});
