import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile,mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {convertStickerMedia} from '../src/stickers/mediaConverter.mjs';

test('rejects input errors before launching a media process',async()=>{
  await assert.rejects(convertStickerMedia({sourcePath:'relative.jpg'}),/PATH_INVALID/);
  await assert.rejects(convertStickerMedia({sourcePath:'/no-such-sticker-file.png'}));
  const dir=await mkdtemp(join(tmpdir(),'cv-sticker-test-'));
  try {
    const f=join(dir,'empty.png');await writeFile(f,'');
    await assert.rejects(convertStickerMedia({sourcePath:f}),/INPUT_SIZE_INVALID/);
    await writeFile(f,'irrelevant');
    await assert.rejects(convertStickerMedia({sourcePath:f,kind:'invalid'}),/KIND_INVALID/);
    await assert.rejects(convertStickerMedia({sourcePath:f,format:'invalid'}),/FORMAT_INVALID/);
  }finally{await rm(dir,{recursive:true,force:true});}
});
