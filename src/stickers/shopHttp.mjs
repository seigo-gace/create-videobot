import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {verifyStickerShopInitData,createStickerShopPreviewToken,
 verifyStickerShopPreviewToken} from './shopAuth.mjs';
import {STICKER_MANAGEMENT_FEE_POLICY_ID} from '../sales/managementFee.mjs';

const productId=id=>typeof id==='string'&&/^sp_[a-f0-9]{24}$/.test(id);
const unpack=r=>typeof r.items==='string'?JSON.parse(r.items):r.items;
const respond=(res,status,value)=>{
 const body=JSON.stringify(value);
 res.writeHead(status,{'content-type':'application/json; charset=utf-8',
  'cache-control':'no-store','x-content-type-options':'nosniff',
  'referrer-policy':'no-referrer'});
 res.end(body);
};
async function readBody(req){
 let total=0,parts=[];
 for await(const chunk of req){
  total+=chunk.length;
  if(total>8192)throw Error('STICKER_SHOP_REQUEST_TOO_LARGE');
  parts.push(chunk);
 }
 let data;
 try{data=JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{throw Error('STICKER_SHOP_JSON_INVALID');}
 if(!data||typeof data!=='object'||Array.isArray(data))
  throw Error('STICKER_SHOP_JSON_INVALID');
 return data;
}
const validProduct=p=>p?.status==='published'&&
  Number(p.price_stars)>=1&&Number(p.price_stars)<=25000&&
  Number(p.management_fee_bps)===3000&&
  p.fee_policy_id===STICKER_MANAGEMENT_FEE_POLICY_ID&&
  p.fee_terms_accepted_at&&
  Array.isArray(unpack(p))&&unpack(p).length>0&&unpack(p).length<=200;
function safeLink(url){
 return typeof url==='string'&&url.length<2048&&
  /^https:\/\/t\.me\/\$[A-Za-z0-9_-]+$/.test(url);
}
function validateDependencies({pool,salesStore,telegramApi,botToken,preview}){
 if(typeof pool?.query!=='function'||typeof salesStore?.getPublished!=='function'||
    typeof salesStore?.reserveOrder!=='function'||
    typeof salesStore?.startInvoice!=='function'||
    typeof salesStore?.invoiceLinkReady!=='function'||
    typeof salesStore?.invoiceUnknown!=='function'||
    typeof telegramApi!=='function'||typeof preview!=='function'||
    typeof botToken!=='string')
  throw Error('STICKER_SHOP_DEPENDENCIES_NOT_VERIFIED');
}
export function createStickerShopHandler({pool,salesStore,telegramApi,botToken,preview,
 now=()=>Date.now()}={}){
 validateDependencies({pool,salesStore,telegramApi,botToken,preview});
 async function purchased(buyerId,id){
  const p=await pool.query("SELECT 1 FROM videobot_sticker_orders WHERE buyer_user_id=$1 AND product_id=$2 AND invoice_state='paid' LIMIT 1",
   [buyerId,id]);
  if(p.rowCount)return true;
  const photo=await pool.query("SELECT 1 FROM videobot_sticker_paid_photo_sales WHERE buyer_user_id=$1 AND product_id=$2 LIMIT 1",
   [buyerId,id]);
  return photo.rowCount>0;
 }
 async function productFor(id){
  if(!productId(id))throw Error('STICKER_SHOP_PRODUCT_INVALID');
  const product=await salesStore.getPublished(id);
  if(!validProduct(product))throw Error('STICKER_SHOP_PRODUCT_UNAVAILABLE');
  return product;
 }
 const staticPaths=Object.freeze({
  '/shop':{name:'index.html',type:'text/html; charset=utf-8'},
  '/shop/app.js':{name:'app.js',type:'application/javascript; charset=utf-8'},
  '/shop/style.css':{name:'style.css',type:'text/css; charset=utf-8'}
 });
 const sendStatic=async(path,res)=>{
  const entry=staticPaths[path];if(!entry)return false;
  const content=await readFile(new URL('../../web/sticker-shop/'+entry.name,import.meta.url));
  res.writeHead(200,{'content-type':entry.type,'cache-control':'public,max-age=300',
    'x-content-type-options':'nosniff','referrer-policy':'no-referrer',
    'content-security-policy':"default-src 'none'; script-src 'self' https://telegram.org; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors https://web.telegram.org https://*.telegram.org"});
  res.end(content);return true;
 };
 return async function handler(req,res){
  try{
   if(req.method==='GET'&&req.url==='/health'){
    return respond(res,200,{ready:true,service:'CreateVdobot sticker shop'});
   }
   const url=new URL(req.url,'http://127.0.0.1');
   if(req.method==='GET'&&staticPaths[url.pathname]){
    await sendStatic(url.pathname,res);return;
   }
   if(req.method==='GET'&&url.pathname.startsWith('/api/preview/')){
    const matched=url.pathname.match(/^\/api\/preview\/(sp_[a-f0-9]{24})\/(\d{1,3})$/);
    if(!matched)return respond(res,404,{error:'not_found'});
    const id=matched[1],index=Number(matched[2]);
    verifyStickerShopPreviewToken(url.searchParams.get('t'),{
     productId:id,index,botToken,now:now()});
    const p=await productFor(id),items=unpack(p);
    if(index>=items.length)return respond(res,404,{error:'not_found'});
    const bytes=await preview({productId:id,index,item:items[index]});
    res.writeHead(200,{'content-type':'image/gif','cache-control':'private,max-age=240',
     'x-content-type-options':'nosniff','referrer-policy':'no-referrer'});
    res.end(bytes);return;
   }
   if(req.method!=='POST'||!['/api/catalog','/api/invoice','/api/status'].includes(url.pathname))
    return respond(res,404,{error:'not_found'});
   const body=await readBody(req);
   const {buyerId}=verifyStickerShopInitData(body.initData,botToken,{now:now()});
   const p=await productFor(body.productId);
   if(url.pathname==='/api/catalog'){
    const items=unpack(p);
    const list=items.map((item,i)=>({
     index:i,url:'/api/preview/'+p.product_id+'/'+i+'?t='+
       encodeURIComponent(createStickerShopPreviewToken({
        productId:p.product_id,index:i,buyerId,botToken,now:now()}))
    }));
    return respond(res,200,{title:p.title,version:Number(p.version),
      kind:p.kind,priceStars:Number(p.price_stars),count:items.length,
      purchased:await purchased(buyerId,p.product_id),items:list});
   }
   if(url.pathname==='/api/status')
    return respond(res,200,{purchased:await purchased(buyerId,p.product_id)});
   // The consent checkbox is user-operated and verified again by this API.
   if(body.acceptTerms!==true)
    return respond(res,400,{error:'terms_required'});
   if(await purchased(buyerId,p.product_id))
    return respond(res,200,{purchased:true});
   const order=await salesStore.reserveOrder({productId:p.product_id,buyerId});
   if(order.invoice_state==='paid')
    return respond(res,200,{purchased:true});
   if(order.invoice_state==='link_ready'&&safeLink(order.invoice_url))
    return respond(res,200,{invoiceUrl:order.invoice_url,purchased:false});
   if(order.invoice_state!=='prepared')
    return respond(res,409,{error:'invoice_already_issued_or_unconfirmed'});
   const claimed=await salesStore.startInvoice(order.order_id,buyerId);
   if(!claimed)return respond(res,409,{error:'invoice_in_progress'});
   let urlValue;
   try{
    urlValue=await telegramApi('createInvoiceLink',{
     title:String(p.title).slice(0,32),
     description:'ステッカーパック固定版の素材一式（版 '+Number(p.version)+'）。購入後CreateVdobotのDMへ納品。',
     payload:'stk:'+order.order_id,currency:'XTR',
     prices:[{label:String(p.title).slice(0,32),amount:Number(p.price_stars)}]
    });
    if(!safeLink(urlValue))throw Error('STICKER_SHOP_INVOICE_URL_INVALID');
    await salesStore.invoiceLinkReady(order.order_id,buyerId,urlValue);
   }catch{
    await salesStore.invoiceUnknown(order.order_id);
    throw Error('STICKER_SHOP_INVOICE_UNKNOWN');
   }
   return respond(res,200,{invoiceUrl:urlValue,purchased:false});
  }catch(error){
   // Preserve the ambiguity of a possibly-created invoice and avoid leaking
   // Bot tokens, Telegram URLs, user names or database error details.
   const code=String(error?.message??'');
   const bad=/INVALID|AUTH_|TOKEN_|REQUEST_TOO_LARGE|JSON_INVALID|terms_required/.test(code);
   const unavailable=/UNAVAILABLE|NOT_VERIFIED|INVOICE_UNKNOWN|PREVIEW_BUSY/.test(code);
   respond(res,bad?403:unavailable?409:500,
     {error:bad?'invalid_request':unavailable?'not_available':'server_error'});
  }
 };
}
export function createStickerShopServer(options){
 return createServer(createStickerShopHandler(options));
}
