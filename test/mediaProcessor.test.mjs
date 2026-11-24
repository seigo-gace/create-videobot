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
   return {fileId:type==='photo'?(path.endsWith('thumb-2.jpg')?'photo_auto_2':'photo_auto'):'video_auto'};
 };
 function fakeRun(duration){
   return async(command,args)=>{
     if(command==='ffprobe'){
       if(args.includes('json'))return {stdout:JSON.stringify({format:{duration:String(duration),bit_rate:'1000000'},
         streams:[{codec_type:'video',codec_name:'h264',width:640,height:360}]})};
       if(args.includes('-select_streams'))return {stdout:''};
       return {stdout:String(args.at(-1).includes('.montage-')?(duration>60?60:duration/3):args.at(-1).includes('.sample-')?(duration>30?30:Math.floor(duration/3*100)/100):duration)};
     }
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
 assert.deepEqual(refs,{thumbnail:{fileId:'photo_auto',secondFileId:'photo_auto_2'},sample:{fileId:'video_auto',durationSeconds:50/3}});
 assert.deepEqual(f.calls.map(x=>x.type),['photo','photo','video']);
 assert.deepEqual(await readdir(f.base),[]);
 const one=await p.prepareMissingPreviews({paidVideo:{fileId:'main002'},
   thumbnail:{fileId:'manual'}});
 assert.deepEqual(one,{thumbnail:{fileId:'manual',secondFileId:'photo_auto_2'},sample:{fileId:'video_auto',durationSeconds:50/3}});
}));
test('unapproved storage refuses generation upload and cleans downloaded media',()=>setup(async f=>{
 const p=createVideoMediaProcessor({fetchSource:f.fetchSource,saveGenerated:f.saveGenerated,
   storageApproved:false,run:f.fakeRun(50),workRoot:f.base});
 await assert.rejects(()=>p.prepareMissingPreviews({paidVideo:{fileId:'main001'}}),/approved private media storage unavailable/);
 assert.equal(f.calls.length,0);
 assert.deepEqual(await readdir(f.base),[]);
}));

test('insufficient scratch space stops before source download, transcoding and Telegram sends',()=>setup(async f=>{
 let fetched=0,uploaded=0,processed=0;
 const p=createVideoMediaProcessor({
   fetchSource:async()=>{fetched++;return f.fetchSource('main',f.base);},
   saveGenerated:async()=>{uploaded++;return {fileId:'should_not_exist'};},
   storageApproved:true,workRoot:f.base,
   diskStat:async()=>{processed++;return {bavail:1n,bsize:4096n};}
 });
 await assert.rejects(()=>p.prepareMissingPreviews({paidVideo:{fileId:'main'}}),
   /CREATOR_PREVIEW_SCRATCH_SPACE_INSUFFICIENT/);
 assert.equal(processed,1);
 assert.equal(fetched,0);
 assert.equal(uploaded,0);
 assert.deepEqual(await readdir(f.base),[]);
}));
