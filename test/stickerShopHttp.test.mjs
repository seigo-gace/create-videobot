import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {createStickerShopServer} from '../src/stickers/shopHttp.mjs';
const token='987654321:'+'b'.repeat(40),pid='sp_'+'e'.repeat(24),now=1700000000000;
function signed(){
 const d={auth_date:String(Math.floor(now/1000)),user:JSON.stringify({id:71,first_name:'Shopper'})};
 const secret=createHmac('sha256','WebAppData').update(token).digest();
 const data=Object.entries(d).sort(([a],[b])=>a.localeCompare(b,'en')).map(([k,v])=>k+'='+v).join('\n');
 return new URLSearchParams({...d,hash:createHmac('sha256',secret).update(data).digest('hex')}).toString();
}
test('catalog renders every sticker, checks terms and issues one reusable XTR link',async()=>{
 const calls=[];let prepared=false,state='prepared',invoiceUrl=null;
 const product={product_id:pid,version:1,title:'ちびキャラ',kind:'regular',status:'published',
  price_stars:50,management_fee_bps:3000,fee_policy_id:'sticker-admin-30-20261113',
  fee_terms_accepted_at:'2026-11-13',items:[{file_id:'aBcDEF_10'},{file_id:'aBcDEF_11'}]};
 const pool={query:async(sql,args)=>{
  if(sql.includes('videobot_sticker_paid_photo_sales'))return {rowCount:0,rows:[]};
  if(sql.includes('videobot_sticker_orders')&&sql.includes("invoice_state='paid'"))
   return {rowCount:0,rows:[]};
  throw Error('Unexpected SQL');
 }};
 const salesStore={
  getPublished:async id=>{assert.equal(id,pid);return product;},
  reserveOrder:async({productId,buyerId})=>{
   assert.equal(productId,pid);assert.equal(buyerId,71);
   return {order_id:'so_'+'c'.repeat(24),invoice_state:state,invoice_url:invoiceUrl};
  },
  startInvoice:async()=>{assert.equal(state,'prepared');state='sending';prepared=true;return {price_stars:50};},
  invoiceLinkReady:async(_,__,url)=>{state='link_ready';invoiceUrl=url;},
  invoiceUnknown:async()=>{state='unknown';}
 };
 const api=async(name,body)=>{
  assert.equal(name,'createInvoiceLink');calls.push(body);
  return 'https://t.me/$xtrSticker071';
 };
 const server=createStickerShopServer({pool,salesStore,telegramApi:api,botToken:token,
  preview:async()=>Buffer.from('GIF89a'),now:()=>now});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 const post=async(path,body)=>{
  const r=await fetch(base+path,{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({initData:signed(),productId:pid,...body})});
  return {status:r.status,data:await r.json()};
 };
 try{
  let page=await fetch(base+'/shop?product='+pid);
  assert.equal(page.status,200);assert.match(await page.text(),/パックを読み込み中/);
  assert.match(page.headers.get('content-security-policy')??'',/frame-ancestors https:\/\/web\.telegram\.org/);
  assert.equal(page.headers.has('x-frame-options'),false);
  let catalog=await post('/api/catalog');
  assert.equal(catalog.status,200);
  assert.equal(catalog.data.items.length,2);
  assert.equal(catalog.data.priceStars,50);
  assert.ok(catalog.data.items[0].url.includes('/api/preview/'));
  const pic=await fetch(base+catalog.data.items[0].url);
  assert.equal(pic.status,200);assert.equal(pic.headers.get('content-type'),'image/gif');
  const forbidden=await post('/api/invoice',{acceptTerms:false});
  assert.equal(forbidden.status,400);assert.equal(calls.length,0);
  const purchase=await post('/api/invoice',{acceptTerms:true});
  assert.equal(purchase.status,200);assert.equal(purchase.data.invoiceUrl,invoiceUrl);
  assert.equal(prepared,true);
  assert.equal(calls.length,1);
  assert.equal(calls[0].currency,'XTR');assert.equal(calls[0].prices[0].amount,50);
  const retry=await post('/api/invoice',{acceptTerms:true});
  assert.equal(retry.data.invoiceUrl,invoiceUrl);assert.equal(calls.length,1);
  const forged=await post('/api/invoice',{initData:'auth_date=123&hash=abc',acceptTerms:true});
  assert.equal(forged.status,403);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
