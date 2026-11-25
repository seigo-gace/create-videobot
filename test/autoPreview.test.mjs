import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareMissingPreviewAssets } from '../src/sales/autoPreview.mjs';

async function fixture(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'videobot-autofill-'));
  try {
    const src = join(dir,'main.mp4');
    const jpg = join(dir,'auto.jpg');
    const mp4 = join(dir,'auto.mp4');
    await writeFile(src,'paid source must not be touched');
    return await fn({dir,src,jpg,mp4});
  } finally {
    await rm(dir,{recursive:true,force:true});
  }
}
function runFake({duration,failSample=false,calls=[]}) {
  return async (command,args) => {
    calls.push({command,args});
    if(command==='ffprobe')return {stdout: args.includes('-select_streams')?'':String(args.at(-1).includes('.montage-') ? (duration>60 ? 60 : duration/3) : duration)};
    if(command==='ffmpeg') {
      if(args.at(-1).includes('.montage-') && failSample)throw new Error('mock sample failure');
      await writeFile(args.at(-1),'generated');
      return {stdout:''};
    }
    throw new Error('unexpected command');
  };
}

test('missing both: generate two images and one montage without replacing main', () => fixture(async({src,jpg,mp4})=>{
  const calls=[];
  const second=join(src,'..','second.jpg');
  const result=await prepareMissingPreviewAssets({sourcePath:src,thumbnailOutputPath:jpg,secondThumbnailOutputPath:second,sampleOutputPath:mp4,run:runFake({duration:80,calls})});
  assert.equal(result.secondThumbnail.path,second);
  assert.equal(await readFile(second,'utf8'),'generated');
  assert.deepEqual([result.thumbnail.kind,result.sample.kind],['generated','clipped']);
  assert.equal(result.sample.durationSeconds,60);
  assert.equal((await readFile(src,'utf8')),'paid source must not be touched');
  assert.equal(await readFile(jpg,'utf8'),'generated');
  assert.equal(await readFile(mp4,'utf8'),'generated');
  assert.equal(calls.filter(x=>x.command==='ffmpeg').length,3);
  const montage=calls.find(x=>x.args.includes('-filter_complex'));
  assert.equal(montage.args.filter(x=>x==='-i').length,4);
  assert.ok(montage.args.includes('concat=n=4:v=1:a=0[v]')||montage.args.some(x=>x.includes('concat=n=4:v=1:a=0[v]')));
  assert.equal(montage.args.filter((x,i)=>x==='15'&&montage.args[i-1]==='-t').length,4);
  const inputs=montage.args.flatMap((x,i)=>x==='-i'?[i]:[]);
  assert.equal(inputs.length,4);
  for(const i of inputs)assert.deepEqual(montage.args.slice(i-2,i),['-threads','1']);
  assert.deepEqual(montage.args.slice(montage.args.indexOf('-c:v'),montage.args.indexOf('-c:v')+4),['-c:v','libx264','-threads:v','1']);
}));
test('short paid main generates a strictly shorter free sample', () => fixture(async({src,jpg,mp4})=>{
  const calls=[];
  const result=await prepareMissingPreviewAssets({sourcePath:src,thumbnailOutputPath:jpg,sampleOutputPath:mp4,run:runFake({duration:15,calls})});
  assert.equal(result.sample.kind,'clipped');
  assert.equal(result.sample.durationSeconds,5);
  const videoCut=calls.filter(x=>x.command==='ffmpeg').find(x=>x.args.includes('-t'));
  assert.equal(videoCut.args[videoCut.args.lastIndexOf('-t')+1],'5');
}));
test('manual assets remain unchanged and only missing item is auto-generated', () => fixture(async({src,jpg,mp4})=>{
  const thumb={fileId:'manual_photo'};
  const r=await prepareMissingPreviewAssets({sourcePath:src,thumbnail:thumb,sampleOutputPath:mp4,run:runFake({duration:45})});
  assert.deepEqual(r.thumbnail,{kind:'existing',value:thumb});
  assert.equal(r.sample.kind,'clipped');
  assert.deepEqual((await readdir(join(src,'..'))).sort(),['auto.mp4','main.mp4']);
  const unchanged=await prepareMissingPreviewAssets({sourcePath:src,thumbnail:thumb,sample:{fileId:'manual_sample'}});
  assert.equal(unchanged.sample.kind,'existing');
  assert.equal(unchanged.thumbnail.kind,'existing');
}));
test('failed sample does not leave a partial auto thumbnail or tamper with original',()=>fixture(async({src,jpg,mp4,dir})=>{
  await assert.rejects(()=>prepareMissingPreviewAssets({sourcePath:src,thumbnailOutputPath:jpg,sampleOutputPath:mp4,run:runFake({duration:42,failSample:true})}),/mock sample failure/);
  assert.deepEqual((await readdir(dir)).sort(),['main.mp4']);
  assert.equal(await readFile(src,'utf8'),'paid source must not be touched');
}));
test('one-second paid video gets strictly shorter automatic free sample',()=>fixture(async({src,jpg,mp4})=>{
 const calls=[];
 const result=await prepareMissingPreviewAssets({
  sourcePath:src,thumbnailOutputPath:jpg,sampleOutputPath:mp4,
  run:runFake({duration:1.4,calls})
 });
 assert.equal(result.thumbnail.kind,'generated');
 assert.equal(result.sample.kind,'clipped');
 assert.ok(result.sample.durationSeconds<1.4);
 const clip=calls.find(c=>c.command==='ffmpeg'&&c.args.includes('-t'));
 assert.ok(Number(clip.args[clip.args.indexOf('-t')+1])<1.4);
}));
test('unplayably tiny video fails without publishing original',()=>fixture(async({src,jpg,mp4,dir})=>{
 await assert.rejects(()=>prepareMissingPreviewAssets({
  sourcePath:src,thumbnailOutputPath:jpg,sampleOutputPath:mp4,
  run:runFake({duration:0.1})}),/shorter than playable/);
 assert.deepEqual((await readdir(dir)).sort(),['main.mp4']);
}));
