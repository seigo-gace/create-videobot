import {createHmac,timingSafeEqual} from 'node:crypto';
const hmac=(key,text)=>createHmac('sha256',key).update(text).digest();
const checkToken=t=>typeof t==='string'&&/^\d+:[A-Za-z0-9_-]{30,}$/.test(t);

/** Verify Telegram Mini App initData on the trusted backend only.
 * Never trust initDataUnsafe, user IDs from the browser, or stale auth.
 */
export function verifyStickerShopInitData(raw,botToken,{now=Date.now(),maxAge=600}={}){
 if(!checkToken(botToken)||typeof raw!=='string'||raw.length<30||raw.length>4096)
  throw Error('STICKER_SHOP_AUTH_INVALID');
 if(!Number.isSafeInteger(now)||maxAge<60||maxAge>900)
  throw Error('STICKER_SHOP_AUTH_CLOCK_INVALID');
 const params=new URLSearchParams(raw);
 const entries=[...params.entries()];
 if(entries.some(([key])=>params.getAll(key).length!==1)||
    !/^[a-fA-F0-9]{64}$/.test(params.get('hash')??''))
  throw Error('STICKER_SHOP_AUTH_FORMAT_INVALID');
 const supplied=Buffer.from(params.get('hash'),'hex');
 const check=entries.filter(([key])=>key!=='hash'&&key!=='signature')
   .sort(([a],[b])=>a.localeCompare(b,'en'))
   .map(([key,val])=>key+'='+val).join('\n');
 const secret=hmac('WebAppData',botToken);
 const actual=hmac(secret,check);
 if(!timingSafeEqual(supplied,actual))
  throw Error('STICKER_SHOP_AUTH_SIGNATURE_INVALID');
 const ts=Number(params.get('auth_date'));
 if(!Number.isSafeInteger(ts)||ts<=0||Math.floor(now/1000)-ts>maxAge||
    ts-Math.floor(now/1000)>60)
  throw Error('STICKER_SHOP_AUTH_EXPIRED');
 let person;
 try{person=JSON.parse(params.get('user')??'null');}
 catch{throw Error('STICKER_SHOP_AUTH_USER_INVALID');}
 if(!Number.isSafeInteger(person?.id)||person.id<=0||person.is_bot===true)
  throw Error('STICKER_SHOP_AUTH_USER_INVALID');
 return Object.freeze({buyerId:person.id,authDate:ts});
}

export function createStickerShopPreviewToken({productId,index,buyerId,botToken,now=Date.now()}={}){
 if(!/^sp_[a-f0-9]{24}$/.test(productId??'')||
    !Number.isSafeInteger(index)||index<0||index>=200||
    !Number.isSafeInteger(buyerId)||buyerId<=0||!checkToken(botToken))
  throw Error('STICKER_SHOP_PREVIEW_TOKEN_INVALID');
 const expiry=Math.floor(now/1000)+300;
 const data=[productId,index,buyerId,expiry].join(':');
 const secret=hmac('StickerShopPreview',botToken);
 return Buffer.from(data).toString('base64url')+'.'+
   hmac(secret,data).toString('base64url');
}
export function verifyStickerShopPreviewToken(raw,{productId,index,botToken,now=Date.now()}={}){
 if(typeof raw!=='string'||raw.length>256||!checkToken(botToken))
  throw Error('STICKER_SHOP_PREVIEW_TOKEN_INVALID');
 const parts=raw.split('.');
 if(parts.length!==2)throw Error('STICKER_SHOP_PREVIEW_TOKEN_INVALID');
 let data,provided;
 try{data=Buffer.from(parts[0],'base64url').toString('utf8');
  provided=Buffer.from(parts[1],'base64url');}catch{throw Error('STICKER_SHOP_PREVIEW_TOKEN_INVALID');}
 const secret=hmac('StickerShopPreview',botToken),computed=hmac(secret,data);
 if(provided.length!==computed.length||!timingSafeEqual(provided,computed))
  throw Error('STICKER_SHOP_PREVIEW_TOKEN_INVALID');
 const values=data.split(':');
 if(values.length!==4||values[0]!==productId||Number(values[1])!==index||
    !Number.isSafeInteger(Number(values[2]))||Number(values[2])<=0||
    !Number.isSafeInteger(Number(values[3]))||
    Number(values[3])<Math.floor(now/1000)||
    Number(values[3])>Math.floor(now/1000)+360)
  throw Error('STICKER_SHOP_PREVIEW_TOKEN_INVALID');
 return {buyerId:Number(values[2])};
}
