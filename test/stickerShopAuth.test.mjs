import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {verifyStickerShopInitData,createStickerShopPreviewToken,
 verifyStickerShopPreviewToken} from '../src/stickers/shopAuth.mjs';
const token='123456789:'+'a'.repeat(40),now=1700000000000,productId='sp_'+'e'.repeat(24);
function signed(userId=71,when=Math.floor(now/1000)){
 const data={auth_date:String(when),user:JSON.stringify({id:userId,first_name:'Test'})};
 const check=Object.entries(data).sort(([a],[b])=>a.localeCompare(b,'en')).map(([k,v])=>k+'='+v).join('\n');
 const secret=createHmac('sha256','WebAppData').update(token).digest();
 const hash=createHmac('sha256',secret).update(check).digest('hex');
 return new URLSearchParams({...data,hash}).toString();
}
test('Mini App signed initData binds identity without browser-controlled buyer ID',()=>{
 assert.equal(verifyStickerShopInitData(signed(),token,{now}).buyerId,71);
 assert.throws(()=>verifyStickerShopInitData(signed().replace('71','72'),token,{now}),/SIGNATURE_INVALID/);
 assert.throws(()=>verifyStickerShopInitData(signed(71,Math.floor(now/1000)-901),token,{now}),/EXPIRED/);
 assert.throws(()=>verifyStickerShopInitData(signed()+'&user=other',token,{now}),/FORMAT_INVALID/);
});
test('preview URLs sign exactly the product and item, expire and cannot be forged',()=>{
 const t=createStickerShopPreviewToken({productId,index:0,buyerId:71,botToken:token,now});
 assert.deepEqual(verifyStickerShopPreviewToken(t,{productId,index:0,botToken:token,now}),{buyerId:71});
 assert.throws(()=>verifyStickerShopPreviewToken(t,{productId,index:1,botToken:token,now}),/TOKEN_INVALID/);
 assert.throws(()=>verifyStickerShopPreviewToken(t,{productId,index:0,botToken:token,now:now+400000}),/TOKEN_INVALID/);
 assert.throws(()=>verifyStickerShopPreviewToken(t.slice(0,-2)+'xx',{productId,index:0,botToken:token,now}),/TOKEN_INVALID/);
});
