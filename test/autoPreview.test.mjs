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
    if(command==='ffprobe')return {stdout: String(args.at(-1).includes('.sample-') ? (duration>30 ? 30 : Math.floor(duration / 3 * 100)/100) : duration)};
    if(command==='ffmpeg') {
      if(args.at(-1).includes('.sample-') && failSample)throw new Error('mock sample failure');
      await writeFile(args.at(-1),'generated');
      return {stdout:''};
    }
    throw new Error('unexpected command');
  };
}

test('missing both: generate one image and beginning sample without replacing main', () => fixture(async({src,jpg,mp4})=>{
  const calls=[];
  const result=await prepareMissingPreviewAssets({sourcePath:src,thumbnailOutputPath:jpg,sampleOutputPath:mp4,run:runFake({duration:80,calls})});
  assert.deepEqual([result.thumbnail.kind,result.sample.kind],['generated','clipped']);
  assert.equal(result.sample.durationSeconds,30);
  assert.equal((await readFile(src,'utf8')),'paid source must not be touched');
  assert.equal(await readFile(jpg,'utf8'),'generated');
  assert.equal(await readFile(mp4,'utf8'),'generated');
  assert.equal(calls.filter(x=>x.command==='ffmpeg').length,2);
}));
test('short paid main generates a strictly shorter free sample', () => fixture(async({src,jpg,mp4})=>{
  const calls=[];
  const result=await prepareMissingPreviewAssets({sourcePath:src,thumbnailOutputPath:jpg,sampleOutputPath:mp4,run:runFake({duration:15,calls})});
  assert.equal(result.sample.kind,'clipped');
  assert.equal(result.sample.durationSeconds,5);
  const videoCut=calls.filter(x=>x.command==='ffmpeg').find(x=>x.args.includes('-t'));
  assert.equal(videoCut.args[videoCut.args.indexOf('-t')+1],'5');
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
test('very short paid video is never made freely available in full',()=>fixture(async({src,jpg,mp4,dir})=>{
  await assert.rejects(()=>prepareMissingPreviewAssets({sourcePath:src,thumbnailOutputPath:jpg,sampleOutputPath:mp4,run:runFake({duration:1.4})}),/too short/);
  assert.deepEqual((await readdir(dir)).sort(),['main.mp4']);
}));
