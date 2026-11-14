import {createHash} from 'node:crypto';
import {verifyStickerShopInitData,createStickerShopPreviewToken,
 verifyStickerShopPreviewToken} from './shopAuth.mjs';

const validName=name=>typeof name==='string'&&/^[A-Za-z][A-Za-z0-9_]{1,63}$/.test(name);
const productId=(ownerId,packName)=>'sp_'+createHash('sha256')
 .update(ownerId+':'+packName).digest('hex').slice(0,24);
const reply=(res,status,data)=>{
 res.writeHead(status,{'content-type':'application/json; charset=utf-8',
  'cache-control':'no-store','x-content-type-options':'nosniff'});
 res.end(JSON.stringify(data));
};

export function createStickerOwnerGallery({inventory,sessionStore,selectItem,preview,botToken,
 now=()=>Date.now()}={}){
 if(typeof inventory?.getOwnedPack!=='function'||
    typeof inventory?.listOwnedItems!=='function'||
    typeof sessionStore?.read!=='function'||
    typeof selectItem!=='function'||typeof preview!=='function'||
    typeof botToken!=='string')throw Error('STICKER_GALLERY_DEPENDENCIES_MISSING');

 async function current(ownerId,packName){
  if(!validName(packName))throw Error('STICKER_GALLERY_PACK_INVALID');
  const session=await sessionStore.read(ownerId);
  const editing=session?.screen==='sticker_pack_items'&&
    session.stickerSelectedPack?.pack_name===packName;
  const listing=session?.screen==='sticker_packs'&&
    session.stickerPackRows?.some(row=>row.pack_name===packName&&
      row.kind===session.stickerPackKind);
  if((!editing&&!listing)||session.stickerPending||session.stickerEditPending)
   throw Error('STICKER_GALLERY_SESSION_STALE');
  const pack=await inventory.getOwnedPack(ownerId,packName);
  if(!pack)throw Error('STICKER_GALLERY_PACK_MISSING');
  return {session,pack};
 }
 return async function gallery({req,res,url,body}){
  if(req.method==='GET'&&url.pathname.startsWith('/api/my-pack/preview/')){
   const m=/^\/api\/my-pack\/preview\/([1-9][0-9]{0,15})\/([A-Za-z][A-Za-z0-9_]{1,63})\/([0-9]{1,3})$/.exec(url.pathname);
   if(!m)return reply(res,404,{error:'not_found'});
   const ownerId=Number(m[1]),packName=m[2],index=Number(m[3]);
   if(!Number.isSafeInteger(ownerId)||!validName(packName)||index>=200)
    throw Error('STICKER_GALLERY_PREVIEW_INVALID');
   const signed=verifyStickerShopPreviewToken(url.searchParams.get('t'),{
    productId:productId(ownerId,packName),index,botToken,now:now()});
   if(signed.buyerId!==ownerId)throw Error('STICKER_GALLERY_PREVIEW_OWNER_INVALID');
   if(!await inventory.getOwnedPack(ownerId,packName))
    throw Error('STICKER_GALLERY_PACK_MISSING');
   const rows=await inventory.listOwnedItems({ownerId,packName,limit:1,offset:index});
   if(rows.length!==1)throw Error('STICKER_GALLERY_PREVIEW_ITEM_INVALID');
   const bytes=await preview({productId:productId(ownerId,packName),index,item:rows[0]});
   res.writeHead(200,{'content-type':'image/gif',
    'cache-control':'private,max-age=240','x-content-type-options':'nosniff'});
   res.end(bytes);return;
  }
  if(req.method!=='POST'||!['/api/my-pack/catalog','/api/my-pack/select'].includes(url.pathname))
   return reply(res,404,{error:'not_found'});
  const {buyerId:ownerId}=verifyStickerShopInitData(body?.initData,botToken,{now:now()});
  const packName=body?.packName;
  const {session,pack}=await current(ownerId,packName);
  const page=body?.page??0;
  if(!Number.isSafeInteger(page)||page<0||page>=20)
   throw Error('STICKER_GALLERY_PAGE_INVALID');
  if(url.pathname==='/api/my-pack/catalog'){
   const rows=await inventory.listOwnedItems({ownerId,packName,limit:10,offset:page*10});
   const ahead=rows.length===10?await inventory.listOwnedItems({
     ownerId,packName,limit:1,offset:(page+1)*10}):[];
   return reply(res,200,{title:pack.title,kind:pack.kind,page:page+1,
    hasNext:ahead.length>0,hasPrevious:page>0,
    items:rows.map((item,index)=>{
     const offset=page*10+index;
     const t=createStickerShopPreviewToken({
      productId:productId(ownerId,packName),index:offset,buyerId:ownerId,
      botToken,now:now()});
     return {index,preview:'/api/my-pack/preview/'+ownerId+'/'+packName+
      '/'+offset+'?t='+encodeURIComponent(t)};
    })});
  }
  const index=body?.index;
  if(!Number.isSafeInteger(index)||index<0||index>=10)
   throw Error('STICKER_GALLERY_SELECTION_INVALID');
  await selectItem({ownerId,packName,index,page});
  reply(res,200,{selected:true});
 };
}
