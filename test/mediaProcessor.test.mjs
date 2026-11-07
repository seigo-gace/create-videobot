import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile,readdir,mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createVideoMediaProcessor} from '../src/telegram/mediaProcessor.mjs';

async function setup(fn){
 const base=await mkdtemp(join(tmpdir(),'video-pipeline-'));
 const calls=[];
 const fetchSource=async(fileId,dir)=>{
   const path=join(dir,'source.mp4');
   await writeFile(path,'source-'+fileId);
   return {path};
 };
 const saveGenerated=async({path,type})=>{
   calls.push({type,path});
   return {fileId:type==='photo'?'photo_auto':'video_auto'};
 };
 function fakeRun(duration){
   return async(command,args)=>{
     if(command==='ffprobe')return {stdout:String(args.at(-1).includes('.sample-')?(duration>30?30:Math.floor(duration/3*100)/100):duration)};
     if(command==='ffmpeg') {
       await writeFile(args.at(-1),'generated data');
       return {stdout:''};
     }
     throw new Error('unexpected processor');
   };
 }
 try {return await fn({base,calls,fetchSource,saveGenerated,fakeRun});}
 finally {await rm(base,{recursive:true,force:true});}
}
test('overlength user sample is cut to 30 and uploaded using private storage port',()=>setup(async f=>{
 const p=createVideoMediaProcessor({fetchSource:f.fetchSource,saveGenerated:f.saveGenerated,
    storageApproved:true,run:f.fakeRun(90),workRoot:f.base});
 const result=await p.prepareUserSample({file_id:'src100'});
 assert.deepEqual(result,{fileId:'video_auto',durationSeconds:30});
 assert.deepEqual(f.calls.map(x=>x.type),['video']);
 assert.deepEqual(await readdir(f.base),[]);
}));
test('short enough sample reuses original Telegram file_id without new media upload',()=>setup(async f=>{
 const p=createVideoMediaProcessor({fetchSource:f.fetchSource,saveGenerated:f.saveGenerated,
   storageApproved:false,run:f.fakeRun(16),workRoot:f.base});
 const result=await p.prepareUserSample({file_id:'original001'});
 assert.equal(result.fileId,'original001');
 assert.equal(result.durationSeconds,16);
 assert.equal(f.calls.length,0);
}));
test('main video fills only missing photo and sample from existing AutoPreview processor',()=>setup(async f=>{
 const p=createVideoMediaProcessor({fetchSource:f.fetchSource,saveGenerated:f.saveGenerated,
   storageApproved:true,run:f.fakeRun(50),workRoot:f.base});
 const refs=await p.prepareMissingPreviews({paidVideo:{fileId:'main001'}});
 assert.deepEqual(refs,{thumbnail:{fileId:'photo_auto'},sample:{fileId:'video_auto',durationSeconds:30}});
 assert.deepEqual(f.calls.map(x=>x.type),['photo','video']);
 assert.deepEqual(await readdir(f.base),[]);
 const one=await p.prepareMissingPreviews({paidVideo:{fileId:'main002'},
   thumbnail:{fileId:'manual'}});
 assert.deepEqual(one,{sample:{fileId:'video_auto',durationSeconds:30}});
}));
test('unapproved storage refuses generation upload and cleans downloaded media',()=>setup(async f=>{
 const p=createVideoMediaProcessor({fetchSource:f.fetchSource,saveGenerated:f.saveGenerated,
   storageApproved:false,run:f.fakeRun(50),workRoot:f.base});
 await assert.rejects(()=>p.prepareMissingPreviews({paidVideo:{fileId:'main001'}}),/approved private media storage unavailable/);
 assert.equal(f.calls.length,0);
 assert.deepEqual(await readdir(f.base),[]);
}));
