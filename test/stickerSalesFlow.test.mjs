import test from 'node:test';
import assert from 'node:assert/strict';
import {createStickerSalesFlow} from '../src/telegram/stickerSales.mjs';
import {PRICE_PRESETS} from '../src/telegram/creatorUi.mjs';

const productId='sp_'+'a'.repeat(24);
const orderId='so_'+'b'.repeat(24);
function fixture(stickerShopBaseUrl=null){
 const states=new Map();
 const calls=[];
 const panels=[];
 const rows=[{item_index:0,status:'pending'},{item_index:1,status:'pending'}];
 const init=user=>states.get(user)??{revision:1,screen:'home',screenMessageId:301,draft:{paidVideo:{id:'preserve'}}};
 const store={
  read:async user=>structuredClone(init(user)),
  write:async(user,rev,next)=>{
    assert.equal(rev,init(user).revision);
    states.set(user,structuredClone(next));
  },
  setScreen:async(user,rev,id)=>{assert.equal(rev,init(user).revision);states.get(user).screenMessageId=id;}
 };
 let phase='none',paid=false,invoiceCount=0,sellerPublished=null,supportCases=[];
 const gifts=new Map(),giftDeliveries=new Map();
 let giftPrepares=0;
 const salesStore={
  getPublished:async id=>id===productId?{product_id:productId,title:'Demo pack',
    price_stars:50,version:1,status:'published',pack_name:'demo_by_CreateVdobot',kind:'regular',management_fee_bps:3000,fee_policy_id:'sticker-admin-30-20261113',fee_terms_accepted_at:'2026-11-13'}:
    sellerPublished?.productId===id?{product_id:id,pack_name:'pack',
      seller_user_id:42,price_stars:50,version:1,title:'Demo pack',status:'published',management_fee_bps:3000,fee_policy_id:'sticker-admin-30-20261113',fee_terms_accepted_at:'2026-11-13'}:null,
  reserveOrder:async({buyerId})=>{
    assert.equal(buyerId,81);
    if(phase==='none'){phase='prepared';return {order_id:orderId,price_stars:50,invoice_state:'prepared'};}
    return {order_id:orderId,price_stars:50,invoice_state:phase};
  },
  startInvoice:async()=>{assert.equal(phase,'prepared');phase='sending';return {price_stars:50};},
  invoiceSent:async()=>{phase='sent';},
  invoiceUnknown:async()=>{phase='unknown';},
  checkPreCheckout:async q=>phase==='sent'&&q.currency==='XTR'&&q.total_amount===50&&q.from?.id===81,
  capturePayment:async({buyerId,successfulPayment})=>{
    assert.equal(buyerId,81);assert.equal(successfulPayment.currency,'XTR');
    const duplicate=paid;paid=true;phase='paid';return {orderId,duplicate};
  },
  getPaidOrder:async(id,buyer)=>id===orderId&&buyer===81&&paid?
    {order_id:orderId,items:[{file_id:'file1'},{file_id:'file2'}]}:null,
  getDeliveryRows:async()=>structuredClone(rows),
  claimItem:async({index})=>{
    if(rows[index].status!=='pending')return null;
    rows[index].status='sending';return {file_id:'file'+(index+1)};
  },
  itemSent:async({index,messageId})=>{assert.ok(messageId>0);rows[index].status='sent';},
  itemUnknown:async({index})=>{rows[index].status='unknown';},
  createRedelivery:async()=>({attempt:2}),
  listPurchases:async()=>paid?[{order_id:orderId,title:'Demo pack',version:1}]:[],
  createPaymentSupport:async data=>{supportCases.push(data);return {ticketId:'ss_'+ 'f'.repeat(24)};}
 };
 const giftStore={
  async prepare({giftId,donorId,donorOrderId,token}){
    assert.equal(donorId,81);assert.equal(donorOrderId,orderId);
    assert.equal(paid,true);
    const current=gifts.get(giftId);
    if(current){
      assert.equal(current.token,token);
      return {giftId,created:false};
    }
    giftPrepares++;
    gifts.set(giftId,{giftId,token,recipientId:null});
    return {giftId,created:true};
  },
  async status({giftId,donorId}){
    const g=gifts.get(giftId);
    return donorId===81&&g?{gift_id:giftId,recipient_user_id:g.recipientId}:null;
  },
  async redeem({token,recipientId}){
    const gift=[...gifts.values()].find(g=>g.token===token);
    if(!gift)throw Error('STICKER_GIFT_LINK_NOT_FOUND');
    if(recipientId===81)throw Error('STICKER_GIFT_SELF_RECEIPT_DENIED');
    if(gift.recipientId&&gift.recipientId!==recipientId)
      throw Error('STICKER_GIFT_ALREADY_RECEIVED');
    const newReceipt=gift.recipientId===null;
    gift.recipientId=recipientId;
    if(newReceipt)giftDeliveries.set(gift.giftId+':1',
      [{item_index:0,status:'pending'},{item_index:1,status:'pending'}]);
    return {giftId:gift.giftId,newReceipt};
  },
  async getReceived(gid,recipientId){
    const g=gifts.get(gid);
    return g?.recipientId===recipientId?{
      gift_id:gid,items:[{file_id:'file1'},{file_id:'file2'}],title:'Demo pack',version:1}:null;
  },
  async listReceived(recipientId){
    return [...gifts.values()].filter(g=>g.recipientId===recipientId)
      .map(g=>({gift_id:g.giftId,title:'Demo pack',version:1}));
  },
  async deliveryRows(gid,attempt){return structuredClone(giftDeliveries.get(gid+':'+attempt)??[]);},
  async claimItem({giftId,recipientId,attempt,index}){
    if(gifts.get(giftId)?.recipientId!==recipientId)return null;
    const rows=giftDeliveries.get(giftId+':'+attempt);
    if(rows[index].status!=='pending')return null;
    rows[index].status='sending';
    return {file_id:'file'+(index+1)};
  },
  async itemSent({giftId,attempt,index,messageId}){
    assert.ok(messageId>0);
    giftDeliveries.get(giftId+':'+attempt)[index].status='sent';
  },
  async itemUnknown({giftId,attempt,index}){
    giftDeliveries.get(giftId+':'+attempt)[index].status='unknown';
  },
  async redeliver(gid,recipientId){
    if(gifts.get(gid)?.recipientId!==recipientId)throw Error('STICKER_GIFT_NOT_RECEIVED');
    giftDeliveries.set(gid+':2',[{item_index:0,status:'pending'},{item_index:1,status:'pending'}]);
    return {attempt:2};
  }
 };
 const api=async(method,args)=>{
   calls.push({method,args});
   if(method==='sendInvoice'){invoiceCount++;return {message_id:500};}
   if(method==='sendSticker')return {message_id:600+calls.length};
   if(method==='getMe')return {is_bot:true,username:'CreateVdobot'};
   return true;
 };
 const flow=createStickerSalesFlow({
   api,sessionStore:store,screenTransport:{show:async(_id,_old,panel)=>{panels.push(panel);return {messageId:301};}},
   salesStore,giftStore,stickerShopBaseUrl,packInventory:{getOwnedPack:async()=>({pack_name:'pack',title:'Demo pack',kind:'regular'})},
   publishSnapshot:async args=>{sellerPublished={productId:args.productId};return {productId:args.productId,version:1};}
 });
 const msg=(user,text)=>({message:{from:{id:user},chat:{id:user,type:'private'},message_id:302,text}});
 const cb=(user,action)=>({callback_query:{id:'query',data:action+'|r'+init(user).revision,
   from:{id:user},message:{chat:{id:user,type:'private'},message_id:301}}});
 return {flow,calls,panels,msg,cb,state:init,salesStore,supportCases,gifts,
   seed:(user,patch)=>states.set(user,{...structuredClone(init(user)),...patch}),
   get giftPrepares(){return giftPrepares;},get phase(){return phase;},
   get invoiceCount(){return invoiceCount;}};
}

test('seller chooses a preset and accepts 30% fee in the same DM',async()=>{
 const f=fixture();
 await f.flow.beginSell({ownerId:42,packName:'pack'});
 assert.equal(f.state(42).screen,'sticker_sale_price');
 await f.flow.handle(f.cb(42,'sale:price:50'));
 assert.equal(f.state(42).screen,'sticker_sale_confirm');
 await f.flow.handle(f.cb(42,'sale:publish'));
 assert.equal(f.state(42).screen,'sticker_sale_published');
 assert.match(f.state(42).stickerSale.link,/start=claim_sp_/);
 assert.equal(f.state(42).draft.paidVideo.id,'preserve');
 assert.equal(f.calls.filter(c=>c.method==='sendInvoice').length,0);
});
test('sticker Stars presets and custom option use the same creator price contract',async()=>{
 assert.deepEqual(PRICE_PRESETS,[50,100,300,500,1000]);
 const f=fixture();
 await f.flow.beginSell({ownerId:42,packName:'pack'});
 await f.flow.handle(f.cb(42,'sale:custom_price'));
 assert.equal(f.state(42).screen,'sticker_sale_custom_price');
 await f.flow.handle(f.msg(42,'101'));
 assert.equal(f.state(42).stickerSale.price,101);
 await f.flow.handle(f.cb(42,'sale:price'));
 await f.flow.handle(f.cb(42,'sale:price:300'));
 assert.equal(f.state(42).stickerSale.price,300);
 assert.equal(f.state(42).stickerSale.priceMode,'preset');
});
test('TGtumbler shop web app uses hentaigay.org and rejects unrelated domain',async()=>{
 const f=fixture('https://shop.hentaigay.org/');
 await f.flow.handle(f.msg(81,'/start buy_'+productId));
 const buttons=f.panels.at(-1).reply_markup.inline_keyboard.flat();
 assert.equal(buttons.find(b=>b.web_app)?.web_app.url,
   'https://shop.hentaigay.org/shop?product='+productId);
 assert.equal(f.invoiceCount,0);
 assert.throws(()=>fixture('https://shop.g-acebot.com/'),
   /STICKER_SHOP_BASE_URL_INVALID/);
 assert.throws(()=>fixture('https://hentaigay.org.evil.example/'),
   /STICKER_SHOP_BASE_URL_INVALID/);
});

test('catalog fallback displays actual Telegram pack before consent and XTR invoice',async()=>{
 const f=fixture();
 await f.flow.handle(f.msg(81,'/start buy_'+productId));
 const panel=f.panels.at(-1);
 const buttons=panel.reply_markup.inline_keyboard.flat();
 const preview=buttons.find(x=>x.text.includes('パックの中身'));
 assert.equal(preview.url,'https://t.me/addstickers/demo_by_CreateVdobot');
 assert.equal(buttons.some(x=>x.callback_data?.startsWith('sale:accept|r')),true);
 assert.equal(f.invoiceCount,0);
 await f.flow.handle(f.cb(81,'sale:accept'));
 await f.flow.handle(f.cb(81,'sale:pay'));
 assert.equal(f.invoiceCount,1);
});
test('buyer must accept terms before a single XTR invoice, then payment delivers',async()=>{
 const f=fixture();
 await f.flow.handle(f.msg(81,'/start buy_'+productId));
 assert.equal(f.state(81).screen,'sticker_sale_offer');
 assert.match(f.state(81).stickerSale.title,/Demo/);
 assert.equal(f.invoiceCount,0);
 const premature=await f.flow.handle(f.cb(81,'sale:pay'));
 assert.equal(premature.staleButton,true);
 assert.equal(f.invoiceCount,0);
 await f.flow.handle(f.cb(81,'sale:accept'));
 assert.equal(f.state(81).screen,'sticker_sale_agreed');
 await f.flow.handle(f.cb(81,'sale:pay'));
 assert.equal(f.state(81).screen,'sticker_sale_invoice');
 assert.equal(f.invoiceCount,1);
 const invoice=f.calls.find(c=>c.method==='sendInvoice').args;
 assert.equal(invoice.currency,'XTR');
 assert.deepEqual(invoice.prices,[{label:'Demo pack',amount:50}]);
 assert.equal(invoice.payload,'stk:'+orderId);
 assert.equal(invoice.provider_token,undefined);
 assert.equal(await f.salesStore.checkPreCheckout({from:{id:81},currency:'XTR',total_amount:50}),true);
 const q=await f.flow.payments({pre_checkout_query:{id:'p1',from:{id:81},currency:'XTR',total_amount:50}});
 assert.equal(q.preCheckoutApproved,true);
 assert.ok(f.calls.some(c=>c.method==='answerPreCheckoutQuery'&&c.args.ok===true));
 const success={invoice_payload:'stk:'+orderId,currency:'XTR',
   total_amount:50,telegram_payment_charge_id:'charge-81'};
 const accepted=await f.flow.payments({update_id:70,message:{
   chat:{id:81,type:'private'},from:{id:81},message_id:400,successful_payment:success}});
 assert.equal(accepted.paymentRecorded,true);
 assert.equal(f.state(81).screen,'sticker_sale_delivery');
 assert.equal(f.calls.filter(c=>c.method==='sendSticker').length,2);
 const again=await f.flow.payments({update_id:71,message:{
   chat:{id:81,type:'private'},from:{id:81},message_id:401,successful_payment:success}});
 assert.equal(again.duplicate,true);
 assert.equal(f.calls.filter(c=>c.method==='sendSticker').length,2);
 assert.equal(f.invoiceCount,1);
});
test('unexpected precheckout is refused instead of charging',async()=>{
 const f=fixture();
 const result=await f.flow.payments({pre_checkout_query:{id:'q-bad',
   currency:'XTR',total_amount:50,from:{id:999}}});
 assert.equal(result.preCheckoutApproved,false);
 assert.ok(f.calls.some(c=>c.method==='answerPreCheckoutQuery'&&c.args.ok===false));
});
test('stale pay button cannot issue another Stars invoice',async()=>{
 const f=fixture();
 await f.flow.handle(f.msg(81,'/start buy_'+productId));
 await f.flow.handle(f.cb(81,'sale:accept'));
 const original=f.cb(81,'sale:pay');
 await f.flow.handle(original);
 const stale=await f.flow.handle(original);
 assert.equal(stale.staleButton,true);
 assert.equal(f.invoiceCount,1);
});

test('paysupport stores a buyer case and never invokes a refund API',async()=>{
 const f=fixture();
 await f.flow.handle(f.msg(81,'/paysupport'));
 assert.equal(f.state(81).screen,'sticker_sale_support');
 await f.flow.handle(f.msg(81,'My Stars were charged but no items arrived'));
 assert.equal(f.supportCases.length,1);
 assert.equal(f.supportCases[0].buyerId,81);
 assert.equal(f.state(81).screen,'sticker_sale_support_done');
 assert.equal(f.calls.filter(x=>/refund/i.test(x.method)).length,0);
});

test('purchased sticker can be gifted to a chosen Telegram recipient with a one-time link',async()=>{
 const f=fixture();
 // Use the existing paid order flow; no separate charge or video ledger.
 await f.flow.handle(f.msg(81,'/start buy_'+productId));
 await f.flow.handle(f.cb(81,'sale:accept'));
 await f.flow.handle(f.cb(81,'sale:pay'));
 const payment={invoice_payload:'stk:'+orderId,currency:'XTR',
  total_amount:50,telegram_payment_charge_id:'paid_once'};
 await f.flow.payments({update_id:300,message:{chat:{id:81,type:'private'},
  from:{id:81},message_id:400,successful_payment:payment}});
 assert.equal(f.state(81).screen,'sticker_sale_delivery');
 const click=f.cb(81,'sale:gift');
 await f.flow.handle(click);
 assert.equal(f.state(81).screen,'sticker_sale_gift_ready');
 assert.equal(f.giftPrepares,1);
 const link=f.state(81).stickerSale.shareUrl;
 const parsed=new URL(link);
 assert.equal(parsed.hostname,'t.me');
 assert.equal(parsed.pathname,'/share/url');
 const redeemLink=new URL(parsed.searchParams.get('url'));
 assert.match(redeemLink.searchParams.get('start'),/^gift_[A-Za-z0-9_-]{32}$/);
 const stale=await f.flow.handle(click);
 assert.equal(stale.staleButton,true);
 assert.equal(f.giftPrepares,1);
 const token=redeemLink.searchParams.get('start').slice(5);
 const before=f.calls.filter(x=>x.method==='sendSticker').length;
 await f.flow.handle(f.msg(80,'/start gift_'+token));
 assert.equal(f.state(80).screen,'sticker_sale_delivery');
 assert.equal(f.state(80).stickerSale.mode,'gift_recipient');
 assert.equal(f.calls.filter(x=>x.method==='sendSticker').length,before+2);
 const refresh=await f.flow.handle(f.cb(81,'sale:gift_check'));
 assert.equal(refresh.handled,true);
 assert.equal(f.state(81).screen,'sticker_sale_gift_claimed');
 assert.equal(f.state(81).stickerSale.shareUrl,null);
 assert.equal(f.invoiceCount,1);
 assert.equal((await f.salesStore.getPaidOrder(orderId,81))?.order_id,orderId);
 const second=await f.flow.handle(f.msg(82,'/start gift_'+token));
 assert.equal(f.state(82).screen,'sticker_sale_gift_unavailable');
 assert.equal(f.calls.filter(x=>x.method==='sendInvoice').length,1);
 const self=await f.flow.handle(f.msg(81,'/start gift_'+token));
 assert.equal(f.state(81).screen,'sticker_sale_gift_unavailable');
 assert.ok(self.handled);
 await f.flow.handle(f.cb(80,'sale:purchases'));
 await f.flow.handle(f.cb(80,'sale:gift_inbox'));
 assert.equal(f.state(80).screen,'sticker_sale_gift_inbox');
 await f.flow.handle(f.cb(80,'sale:received:0'));
 assert.equal(f.state(80).screen,'sticker_sale_delivery');
 await f.flow.handle(f.cb(80,'sale:redeliver'));
 assert.equal(f.state(80).stickerSale.attempt,2);
 assert.equal(f.calls.filter(x=>x.method==='sendSticker').length,before+4);
 assert.equal(f.invoiceCount,1);
});
test('unpaid or unowned stickers cannot issue gift links and no invoice is sent',async()=>{
 const f=fixture();
 await f.flow.handle(f.msg(81,'/start buy_'+productId));
 const bad=await f.flow.handle(f.cb(81,'sale:gift'));
 assert.equal(bad.staleButton,true);
 assert.equal(f.giftPrepares,0);
 assert.equal(f.invoiceCount,0);
});

test('recipient with an unresolved sticker pack mutation cannot redeem until reconciled',async()=>{
 const f=fixture();
 await f.flow.handle(f.msg(81,'/start buy_'+productId));
 await f.flow.handle(f.cb(81,'sale:accept'));
 await f.flow.handle(f.cb(81,'sale:pay'));
 await f.flow.payments({update_id:311,message:{chat:{id:81,type:'private'},
   from:{id:81},successful_payment:{invoice_payload:'stk:'+orderId,
     currency:'XTR',total_amount:50,telegram_payment_charge_id:'charge-lock'}}});
 await f.flow.handle(f.cb(81,'sale:gift'));
 const gift=[...f.gifts.values()][0];
 f.seed(80,{screen:'sticker_reconcile',stickerPending:{status:'needs_reconcile'}});
 const denied=await f.flow.handle(f.msg(80,'/start gift_'+gift.token));
 assert.equal(denied.registrationLocked,true);
 assert.equal(gift.recipientId,null);
 assert.equal(f.state(80).screen,'sticker_reconcile');
});

test('sales cancel returns to sticker menu, never paid-video home',async()=>{
 const f=fixture();
 await f.flow.handle(f.msg(81,'/start buy_'+productId));
 assert.equal(f.state(81).screen,'sticker_sale_offer');
 await f.flow.handle(f.cb(81,'sale:cancel'));
 assert.equal(f.state(81).screen,'sticker_choose');
 assert.match(f.panels.at(-1).text,/ステッカー・絵文字/);
 assert.doesNotMatch(f.panels.at(-1).text,/クリエータービデオ/);
 assert.deepEqual(f.state(81).draft,{paidVideo:{id:'preserve'}});
});

test('sales cannot erase unresolved sticker registration by exiting',async()=>{
 const f=fixture();
 await f.flow.handle(f.msg(81,'/start buy_'+productId));
 const pending={status:'needs_reconcile',kind:'regular',nonce:'deadbeef'};
 f.seed(81,{stickerPending:pending});
 const denied=await f.flow.handle(f.cb(81,'sale:cancel'));
 assert.equal(denied.locked,true);
 assert.equal(f.state(81).screen,'sticker_sale_offer');
 assert.deepEqual(f.state(81).stickerPending,pending);
});
