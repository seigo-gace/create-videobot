import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {convertStickerMedia} from '../src/stickers/mediaConverter.mjs';
const exec=promisify(execFile);
async function ff(...args){await exec('ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-y',...args],{timeout:30000});}

test('REAL FFmpeg JPG -> sticker PNG and emoji PNG with aspect preservation',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'cv-real-sticker-'));
 const jpg=join(dir,'original.jpg');
 let s=null,e=null;
 try{
  await ff('-f','lavfi','-i','color=c=red:s=800x600:d=1','-frames:v','1',jpg);
  s=await convertStickerMedia({sourcePath:jpg,kind:'sticker'});
  e=await convertStickerMedia({sourcePath:jpg,kind:'emoji'});
  assert.equal(s.format,'static');assert.equal(s.check.codec,'png');
  assert.deepEqual([s.check.width,s.check.height],[512,384]);
  assert.equal(e.check.codec,'png');
  assert.deepEqual([e.check.width,e.check.height],[100,100]);
  assert.equal(e.geometry.drawWidth,100);
  assert.equal(e.geometry.drawHeight,75);
 }finally{await s?.cleanup();await e?.cleanup();await rm(dir,{recursive:true,force:true});}
});
test('REAL FFmpeg MP4 -> <=3-second VP9 sticker and emoji, with no audio',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'cv-real-sticker-video-'));
 const mp4=join(dir,'original.mp4');
 let s=null,e=null;
 try{
  await ff('-f','lavfi','-i','color=c=blue:s=320x240:r=15:d=3.6',
    '-c:v','libx264','-pix_fmt','yuv420p',mp4);
  s=await convertStickerMedia({sourcePath:mp4,kind:'sticker'});
  e=await convertStickerMedia({sourcePath:mp4,kind:'emoji'});
  assert.equal(s.format,'video');assert.equal(s.check.codec,'vp9');
  assert.deepEqual([s.check.width,s.check.height],[512,384]);
  assert.equal(e.check.codec,'vp9');
  assert.deepEqual([e.check.width,e.check.height],[100,100]);
  assert.ok(s.check.bytes<=256*1024);
  assert.ok(e.check.bytes<=256*1024);
 }finally{await s?.cleanup();await e?.cleanup();await rm(dir,{recursive:true,force:true});}
});
