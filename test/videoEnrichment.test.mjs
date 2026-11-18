import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createVideoEnrichment} from '../src/collection/videoEnrichment.mjs';

test('Chinese caption translated to Japanese, two distinct frames produced',async()=>{
  const root=await mkdtemp(join(tmpdir(),'video-thumbs-'));
  const timestamps=[];
  try{
    const enriching=createVideoEnrichment({
      translateToJapanese:async ({text,sourceLanguage,targetLanguage})=>{
        assert.equal(text,'中文介绍');assert.equal(sourceLanguage,'zh');assert.equal(targetLanguage,'ja');
        return '日本語の説明';
      },
      resolveStoredVideo:async ()=>'/storage/video.mp4',
      thumbnailDirectory:root,
      run:async (bin,args)=>{
        if(bin==='ffprobe')return {stdout:'100.0\n'};
        assert.equal(bin,'ffmpeg');
        timestamps.push(Number(args[args.indexOf('-ss')+1]));
        await writeFile(args.at(-1),'jpeg');
        return {stdout:''};
      }
    });
    const result=await enriching.enrich({storageKey:'stored/1',caption:'中文介绍',channelId:111,messageId:22});
    assert.equal(result.captionJapanese,'日本語の説明');
    assert.notEqual(result.thumbnail1,result.thumbnail2);
    assert.deepEqual(timestamps,[25,75]);
  }finally{await rm(root,{recursive:true,force:true});}
});
