import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readdir,readFile,stat,rm,writeFile,open} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createTelegramVideoFetcher} from '../src/telegram/telegramFileFetch.mjs';

const dummy='1234:'+'A'.repeat(36);
async function fixture(fn){
 const dir=await mkdtemp(join(tmpdir(),'video-fetch-'));
 try{return await fn(dir);}finally{await rm(dir,{recursive:true,force:true});}
}
const body=async function*(){yield Buffer.from('media');};
test('getFile adapter streams approved Telegram path into a mode-0600 temporary file',()=>fixture(async dir=>{
 let requestedMethod=null, downloaded=false;
 const fetcher=createTelegramVideoFetcher({
   token:dummy,
   telegramApi:async(method)=>{requestedMethod=method;return {file_path:'videos/source.mp4',file_size:5};},
   fetchImpl:async(url,opt)=>{
     assert.ok(url.startsWith('https://api.telegram.org/file/bot'));
     assert.equal(opt.redirect,'error');
     downloaded=true;
     return {ok:true,body:body()};
   }
 });
 const result=await fetcher('file001',dir);
 assert.equal(requestedMethod,'getFile');
 assert.equal(downloaded,true);
 assert.equal((await readFile(result.path,'utf8')),'media');
 assert.equal((await stat(result.path)).mode & 0o777,0o600);
 await result.cleanup();
 assert.deepEqual(await readdir(dir),[]);
}));
test('denies path traversal, oversized declared length and streaming overflow',()=>fixture(async dir=>{
 for(const path of ['../secret','/absolute/path','http://evil','file//bad.mp4']){
   const fetcher=createTelegramVideoFetcher({token:dummy,telegramApi:async()=>({file_path:path}),fetchImpl:async()=>{throw new Error('should not fetch');}});
   await assert.rejects(()=>fetcher('file001',dir),/path invalid/);
 }
 const tooLarge=createTelegramVideoFetcher({token:dummy,maxBytes:3,
   telegramApi:async()=>({file_path:'videos/source.mp4',file_size:4}),
   fetchImpl:async()=>{throw new Error('should not fetch');}});
 await assert.rejects(()=>tooLarge('file001',dir),/exceeds Bot API/);
 const overflow=createTelegramVideoFetcher({token:dummy,maxBytes:3,
   telegramApi:async()=>({file_path:'videos/source.mp4',file_size:2}),
   fetchImpl:async()=>({ok:true,body:body()})});
 await assert.rejects(()=>overflow('file001',dir),/exceeds configured limit/);
 assert.deepEqual(await readdir(dir),[]);
}));
test('does not follow redirects or leave partial file on HTTP rejection',()=>fixture(async dir=>{
 const fetcher=createTelegramVideoFetcher({token:dummy,
   telegramApi:async()=>({file_path:'videos/source.mp4',file_size:2}),
   fetchImpl:async()=>({ok:false})});
 await assert.rejects(()=>fetcher('file001',dir),/download failed/);
 assert.deepEqual(await readdir(dir),[]);
}));

test('retries short writes to preserve every byte and cleans up on a stalled write',()=>fixture(async dir=>{
 const payload=Buffer.from('complete paid-video preview');
 const writes=[];
 let stored=Buffer.alloc(0),closed=false,removed=false;
 const fetcher=createTelegramVideoFetcher({
   token:dummy,
   telegramApi:async()=>({file_path:'videos/source.mp4',file_size:payload.length}),
   fetchImpl:async()=>({ok:true,body:(async function*(){yield payload;})()}),
   openFile:async(path,flags,mode)=>{
     assert.equal(flags,'wx');
     assert.equal(mode,0o600);
     writes.push(path);
     return {
       async write(buffer,offset,length){
         const n=Math.min(3,length);
         stored=Buffer.concat([stored,buffer.subarray(offset,offset+n)]);
         return {bytesWritten:n};
       },
       async sync(){},
       async close(){closed=true;}
     };
   }
 });
 const result=await fetcher('file001',dir);
 assert.equal(stored.toString(),payload.toString());
 assert.equal(closed,true);
 await result.cleanup();
 assert.equal(writes.length,1);
 const stalled=createTelegramVideoFetcher({
   token:dummy,
   telegramApi:async()=>({file_path:'videos/source.mp4'}),
   fetchImpl:async()=>({ok:true,body:(async function*(){yield Buffer.from('abc');})()}),
   openFile:async(path)=>({
     async write(){return {bytesWritten:0};},
     async close(){removed=true;}
   })
 });
 await assert.rejects(()=>stalled('file001',dir),/incomplete Telegram media write/);
 assert.equal(removed,true);
 assert.deepEqual(await readdir(dir),[]);
}));

test('approved local Bot API reads large source without 20MB cloud download or copy',()=>fixture(async dir=>{
 const root=join(dir,'verified-media');
 await import('node:fs/promises').then(fs=>fs.mkdir(root));
 const source=join(root,'original.mp4');
 const f=await open(source,'wx',0o600);
 await f.truncate(21_000_000);await f.close();
 const fetcher=createTelegramVideoFetcher({
  token:dummy,localFileRoot:root,maxBytes:2_000_000_000,
  telegramApi:async(method)=>({file_path:source,file_size:21_000_000}),
  fetchImpl:async()=>{throw Error('public download must not run');}
 });
 const item=await fetcher('large_media_001',dir);
 assert.equal(item.path,source);
 await item.cleanup();
 assert.equal((await stat(source)).size,21_000_000,'shared file is never deleted');
}));
test('local Bot API cannot read paths outside verified share',()=>fixture(async dir=>{
 const root=join(dir,'approved');
 await import('node:fs/promises').then(fs=>fs.mkdir(root));
 const external=join(dir,'private.mp4');
 await writeFile(external,'never disclose');
 const fetcher=createTelegramVideoFetcher({
  token:dummy,localFileRoot:root,maxBytes:2_000_000_000,
  telegramApi:async()=>({file_path:external,file_size:14})
 });
 await assert.rejects(()=>fetcher('valid_media_01',dir),/outside verified private root/);
 assert.throws(()=>createTelegramVideoFetcher({token:dummy,telegramApi:async()=>({}),localFileRoot:'/',maxBytes:2_000_000_000}),/verified local/);
}));
