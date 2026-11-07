import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createTelegramPrivateMediaUploader} from '../src/telegram/privateMediaUpload.mjs';

const token='1234:'+'A'.repeat(36);
async function fileTest(fn){
 const dir=await mkdtemp(join(tmpdir(),'video-upload-'));
 try{const path=join(dir,'sample.mp4');await writeFile(path,'mp4-data');return await fn(path);}
 finally{await rm(dir,{recursive:true,force:true});}
}
test('only verified private owner storage can receive a multipart generated sample',()=>fileTest(async path=>{
 const calls=[];
 const upload=createTelegramPrivateMediaUploader({
   token,verifyStorage:async()=>({kind:'private_video_media_store',private:true,verified:true,chatId:-100555}),
   fetchImpl:async(url,opts)=>{
     calls.push({url,opts});
     assert.ok(url.endsWith('/sendVideo'));
     assert.equal(opts.body.get('chat_id'),'-100555');
     assert.equal(opts.body.get('protect_content'),'true');
     assert.equal(opts.body.get('has_spoiler'),'true');
     assert.equal(opts.body.get('video').size,8);
     return {ok:true,json:async()=>({ok:true,result:{message_id:56,video:{file_id:'saved_media_001'}}})};
   }
 });
 const result=await upload({path,type:'video'});
 assert.deepEqual(result,{fileId:'saved_media_001',messageId:56});
 assert.equal(calls.length,1);
}));
test('photo response file_id extraction is distinct from video',()=>fileTest(async path=>{
 const upload=createTelegramPrivateMediaUploader({
   token,verifyStorage:async()=>({kind:'private_video_media_store',private:true,verified:true,chatId:-100555}),
   fetchImpl:async(url)=>{assert.ok(url.endsWith('/sendPhoto'));
     return {ok:true,json:async()=>({ok:true,result:{message_id:56,photo:[{file_id:'p_small'},{file_id:'p_large'}]}})};}
 });
 assert.equal((await upload({path,type:'photo'})).fileId,'p_large');
}));
test('denies unverified or public storage and excessive files without API calls',()=>fileTest(async path=>{
 let called=false;
 const upload=createTelegramPrivateMediaUploader({
   token,verifyStorage:async()=>({kind:'private_video_media_store',private:false,verified:true,chatId:-100555}),
   fetchImpl:async()=>{called=true;throw Error('must not call');}
 });
 await assert.rejects(()=>upload({path,type:'video'}),/not verified/);
 assert.equal(called,false);
 const limited=createTelegramPrivateMediaUploader({
   token,maxBytes:2,verifyStorage:async()=>({kind:'private_video_media_store',private:true,verified:true,chatId:-100555}),
   fetchImpl:async()=>{called=true;throw Error('must not call');}
 });
 await assert.rejects(()=>limited({path,type:'video'}),/not safe to upload/);
 assert.equal(called,false);
}));
