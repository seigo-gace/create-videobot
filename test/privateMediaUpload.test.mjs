import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,truncate} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createTelegramPrivateMediaUploader,createCreatorDmPreviewUploader} from '../src/telegram/privateMediaUpload.mjs';

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

test('generated creator previews upload only to their owner DM and delete staging message',()=>fileTest(async path=>{
 const calls=[];
 const uploader=createCreatorDmPreviewUploader({token,
  telegramApi:async(method,params)=>{calls.push({method,params});return true;},
  fetchImpl:async(url,opts)=>{
   calls.push({url,opts});
   assert.ok(url.endsWith('/sendVideo'));
   assert.equal(opts.body.get('chat_id'),'33');
   assert.equal(opts.body.get('protect_content'),'true');
   return {ok:true,json:async()=>({ok:true,result:{message_id:71,video:{file_id:'dm_video_file'}}})};
  }
 });
 assert.deepEqual(await uploader({path,type:'video',ownerId:33}),{fileId:'dm_video_file'});
 assert.deepEqual(calls.at(-1),{method:'deleteMessage',params:{chat_id:33,message_id:71}});
 await assert.rejects(()=>uploader({path,type:'video',ownerId:-10033}),/owner/);
 assert.equal(calls.length,2);
}));

test('23 MB Telegram document reupload uses streaming local API and never buffers entire file',()=>fileTest(async path=>{
 await truncate(path,23_200_000);
 let uploads=0,deleted=0;
 const uploader=createCreatorDmPreviewUploader({
   token,baseUrl:'http://telegram-bot-api:8081',maxBytes:2_000_000_000,
   telegramApi:async(method,params)=>{
     assert.equal(method,'deleteMessage');
     assert.equal(params.chat_id,33);
     deleted++;return true;
   },
   fetchImpl:async(url,opts)=>{
     uploads++;
     assert.ok(url.endsWith('/sendVideo'));
     assert.equal(opts.duplex,'half');
     assert.match(opts.headers['content-type'],/^multipart\/form-data; boundary=gace/);
     assert.ok(Number(opts.headers['content-length'])>23_200_000);
     assert.equal(typeof opts.body.get,'undefined','not buffered FormData');
     const collected=[];
     let count=0;
     for await(const chunk of opts.body){
       count+=chunk.length;
       if(count<600)collected.push(Buffer.from(chunk));
     }
     assert.equal(count,Number(opts.headers['content-length']));
     const header=Buffer.concat(collected).toString('utf8');
     assert.match(header,/name="chat_id"/);
     assert.match(header,/name="video"; filename="creator-sample.mp4"/);
     return {ok:true,json:async()=>({ok:true,result:{message_id:72,video:{file_id:'large_dm_file'}}})};
   }
 });
 assert.deepEqual(await uploader({path,type:'video',ownerId:33}),{fileId:'large_dm_file'});
 assert.equal(uploads,1);
 assert.equal(deleted,1);
}));
test('large MP4 cannot be uploaded through public Bot API or an unverified size increase',()=>fileTest(async path=>{
 await truncate(path,23_200_000);
 let called=0;
 const publicUploader=createCreatorDmPreviewUploader({
   token,maxBytes:2_000_000_000,
   telegramApi:async()=>true,
   fetchImpl:async()=>{called++;throw Error('must not call');}
 });
 await assert.rejects(()=>publicUploader({path,type:'video',ownerId:33}),/size boundary invalid/);
 assert.equal(called,0);
}));
