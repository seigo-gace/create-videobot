import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {createStickerShopServer} from '../src/stickers/shopHttp.mjs';

const token='987654321:'+'b'.repeat(40),now=1700000000000;
const packName='s71_112233aabb_by_CreateVdobot';
function signed(ownerId=71){
 const data={auth_date:String(Math.floor(now/1000)),user:JSON.stringify({id:ownerId,first_name:'Owner'})};
 const secret=createHmac('sha256','WebAppData').update(token).digest();
 const values=Object.entries(data).sort(([a],[b])=>a.localeCompare(b,'en'))
  .map(([a,b])=>a+'='+b).join('\n');
 return new URLSearchParams({...data,hash:createHmac('sha256',secret).update(values).digest('hex')}).toString();
}
function fixture(){
 const items=Array.from({length:12},(_,i)=>({
  file_id:'file_'+i,file_unique_id:'unique_'+i,position:i,emoji:'😀'
 }));
 let page=0,selected=null;
 const inventory={
  async getOwnedPack(id,name){
   return id===71&&name===packName?{
    pack_name:packName,title:'My image pack',kind:'regular'}:null;
  },
  async listOwnedItems({ownerId,packName:name,limit,offset}){
   assert.equal(ownerId,71);assert.equal(name,packName);
   return items.slice(offset,offset+limit);
  }
 };
 const sessionStore={async read(id){
  return id===71?{screen:'sticker_pack_items',stickerSelectedPack:{pack_name:packName},
   stickerItemPage:page,stickerItemRows:items.slice(page*10,page*10+10),
   stickerPending:null,stickerEditPending:null}:null;
 }};
 const salesStore={getPublished:async()=>null,reserveOrder:async()=>{},
  startInvoice:async()=>{},invoiceLinkReady:async()=>{},invoiceUnknown:async()=>{}};
 const server=createStickerShopServer({
  pool:{query:async()=>({rows:[],rowCount:0})},salesStore,
  telegramApi:async()=>null,botToken:token,
  inventory,sessionStore,
  selectItem:async selection=>{selected=selection;return {handled:true};},
  preview:async()=>Buffer.from('GIF89a'),
  now:()=>now
 });
 return {server,setPage:n=>{page=n;},getSelected:()=>selected};
}
test('owner sees 10 animated image thumbnails and tapping selects the exact current pack item',async()=>{
 const f=fixture();
 await new Promise(resolve=>f.server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+f.server.address().port;
 const post=async(path,data={})=>{
  const r=await fetch(base+path,{method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({initData:signed(),packName,...data})});
  return {status:r.status,body:await r.json()};
 };
 try{
  const page=await fetch(base+'/shop/my-pack?pack='+packName);
  assert.equal(page.status,200);
  assert.match(await page.text(),/ステッカーパック/);
  const data=await post('/api/my-pack/catalog');
  assert.equal(data.status,200);
  assert.equal(data.body.items.length,10);
  assert.equal(data.body.items[0].index,0);
  assert.match(data.body.items[0].preview,/\/api\/my-pack\/preview\//);
  const image=await fetch(base+data.body.items[0].preview);
  assert.equal(image.status,200);
  assert.equal(image.headers.get('content-type'),'image/gif');
  const picked=await post('/api/my-pack/select',{index:3});
  assert.equal(picked.status,200);
  assert.deepEqual(f.getSelected(),{ownerId:71,packName,index:3});
  f.setPage(1);
  const next=await post('/api/my-pack/catalog');
  assert.equal(next.body.items.length,2);
  assert.equal(next.body.page,2);
  const image2=await fetch(base+next.body.items[0].preview);
  assert.equal(image2.status,200);
  const invalid=await post('/api/my-pack/select',{index:10});
  assert.notEqual(invalid.status,200);
  const impersonation=await post('/api/my-pack/catalog',{initData:signed(72)});
  assert.notEqual(impersonation.status,200);
 }finally{await new Promise(resolve=>f.server.close(resolve));}
});
