import test from 'node:test';
import assert from 'node:assert/strict';
import {stickerGeometry} from '../src/stickers/geometry.mjs';

test('long side is exactly 512 for stickers without distortion', () => {
  assert.deepEqual(stickerGeometry(1920,1080), {
    kind:'sticker',drawWidth:512,drawHeight:288,canvasWidth:512,canvasHeight:288,
    left:0,top:0,right:0,bottom:0
  });
  const p=stickerGeometry(1080,1920);
  assert.equal(p.drawWidth,288);
  assert.equal(p.drawHeight,512);
  assert.equal(p.canvasHeight,512);
});
test('emoji preserves artwork ratio within centered transparent 100 square', () => {
  assert.deepEqual(stickerGeometry(1920,1080,'emoji'), {
    kind:'emoji',drawWidth:100,drawHeight:56,canvasWidth:100,canvasHeight:100,
    left:0,top:22,right:0,bottom:22
  });
  assert.deepEqual(stickerGeometry(600,800,'emoji'), {
    kind:'emoji',drawWidth:75,drawHeight:100,canvasWidth:100,canvasHeight:100,
    left:12,top:0,right:13,bottom:0
  });
});
test('square and extreme aspect ratios remain bounded', () => {
  for (const kind of ['sticker','emoji']) {
    for (const [w,h] of [[1,1],[1,100000],[100000,1],[801,600],[600,801]]) {
      const g=stickerGeometry(w,h,kind);
      const side=kind==='sticker'?512:100;
      assert.equal(Math.max(g.drawWidth,g.drawHeight),side);
      assert.ok(g.drawWidth>=1&&g.drawHeight>=1);
      assert.ok(g.drawWidth<=g.canvasWidth&&g.drawHeight<=g.canvasHeight);
      assert.equal(g.left+g.drawWidth+g.right,g.canvasWidth);
      assert.equal(g.top+g.drawHeight+g.bottom,g.canvasHeight);
    }
  }
});
test('rejects invalid dimensions and kinds', () => {
  for (const [w,h] of [[0,1],[-1,2],[1,NaN],[1,1.2],[Infinity,1]]) {
    assert.throws(()=>stickerGeometry(w,h));
  }
  assert.throws(()=>stickerGeometry(3,2,'video'));
});
