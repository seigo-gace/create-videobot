import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,stat,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {optimizePaidMp4} from '../src/sales/paidVideoOptimize.mjs';
async function fileTest(fn){
 const dir=await mkdtemp(join(tmpdir(),'paid-mp4-opt-'));
 try{
  const input=join(dir,'original.mp4'),output=join(dir,'optimized.mp4');
  await writeFile(input,Buffer.alloc(25_000_000,7));
  return await fn({input,output});
 }finally{await rm(dir,{recursive:true,force:true});}
}
function probe(bitRate=20_000_000){
 return JSON.stringify({format:{duration:'60',bit_rate:String(bitRate)},
  streams:[{codec_type:'video',codec_name:'h264',width:1920,height:1080}]});
}
test('already efficient original does not invoke FFmpeg or lose its bytes',()=>fileTest(async({input,output})=>{
 let calls=0;
 const r=await optimizePaidMp4({inputPath:input,outputPath:output,
  run:async(_,args)=>{calls++;return {stdout:probe(2_000_000)};}});
 assert.equal(r.kind,'original');
 assert.equal(calls,1);
 assert.equal((await stat(input)).size,25_000_000);
 await assert.rejects(()=>stat(output),{code:'ENOENT'});
}));
test('meaningfully smaller candidate is verified and adopted, original stays intact',()=>fileTest(async({input,output})=>{
 let probes=0;
 const r=await optimizePaidMp4({inputPath:input,outputPath:output,
  diskStat:async()=>({bavail:1000000n,bsize:4096n}),
  run:async(cmd,args)=>{
   if(cmd==='ffprobe'){probes++;return {stdout:probe()};}
   if(cmd==='ffmpeg'){await writeFile(args.at(-1),Buffer.alloc(19_000_000,3));return {stdout:''};}
   throw Error('unexpected tool');
  }});
 assert.equal(r.kind,'optimized');
 assert.equal(probes,2);
 assert.equal(r.originalBytes,25_000_000);
 assert.equal(r.bytes,19_000_000);
 assert.equal((await stat(output)).size,19_000_000);
 const bytes=await readFile(input);
 assert.equal(bytes[0],7);
}));
test('failed capacity check avoids encoding and leaves original unchanged',()=>fileTest(async({input,output})=>{
 let encodes=0;
 await assert.rejects(()=>optimizePaidMp4({inputPath:input,outputPath:output,
  diskStat:async()=>({bavail:100n,bsize:4096n}),
  run:async(cmd)=>{if(cmd==='ffmpeg')encodes++;return {stdout:probe()};}
 }),/DISK_CAPACITY/);
 assert.equal(encodes,0);
 assert.equal((await stat(input)).size,25_000_000);
}));
test('candidate without 10 percent savings keeps unmodified original',()=>fileTest(async({input,output})=>{
 const r=await optimizePaidMp4({inputPath:input,outputPath:output,
  diskStat:async()=>({bavail:1000000n,bsize:4096n}),
  run:async(cmd,args)=>{
   if(cmd==='ffprobe')return {stdout:probe()};
   if(cmd==='ffmpeg'){await writeFile(args.at(-1),Buffer.alloc(23_000_000));return {stdout:''};}
  }});
 assert.equal(r.kind,'original');
 assert.equal(r.reason,'not_materially_smaller');
 await assert.rejects(()=>stat(output),{code:'ENOENT'});
}));
