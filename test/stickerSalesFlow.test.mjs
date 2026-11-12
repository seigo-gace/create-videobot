import test from 'node:test';
import assert from 'node:assert/strict';
import {createStickerSalesFlow} from '../src/telegram/stickerSales.mjs';

const productId='sp_'+'a'.repeat(24);
const orderId='so_'+'b'.repeat(24);
function fixture(){
 const states=new Map();
 const calls=[];
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
 let phase='none',paid=false,invoiceCount=0;
 const salesStore={
  getPublished:async id=>id===productId?{product_id:productId,title:'Demo pack',
    price_stars:50,version:1,status:'published'}:null,
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
  listPurchases:async()=>paid?[{order_id:orderId,title:'Demo pack',version:1}]:[]
 };
 const api=async(method,args)=>{
   calls.push({method,args});
   if(method==='sendInvoice'){invoiceCount++;return {message_id:500};}
   if(method==='sendSticker')return {message_id:600+calls.length};
   if(method==='getMe')return {is_bot:true,username:'CreateVdobot'};
   return true;
 };
 const flow=createStickerSalesFlow({
   api,sessionStore:store,screenTransport:{show:async()=>({messageId:301})},
   salesStore,packInventory:{getOwnedPack:async()=>({pack_name:'pack',title:'Demo pack',kind:'regular'})},
   publishSnapshot:async()=>({productId,version:1})
 });
 const msg=(user,text)=>({message:{from:{id:user},chat:{id:user,type:'private'},message_id:302,text}});
 const cb=(user,action)=>({callback_query:{id:'query',data:action+'|r'+init(user).revision,
   from:{id:user},message:{chat:{id:user,type:'private'},message_id:301}}});
 return {flow,calls,msg,cb,state:init,salesStore,get phase(){return phase;},get invoiceCount(){return invoiceCount;}};
}

test('seller publishes a fixed snapshot through the same DM session; no fee is added',async()=>{
 const f=fixture();
 await f.flow.beginSell({ownerId:42,packName:'pack'});
 assert.equal(f.state(42).screen,'sticker_sale_price');
 await f.flow.handle(f.msg(42,'50'));
 assert.equal(f.state(42).screen,'sticker_sale_confirm');
 await f.flow.handle(f.cb(42,'sale:publish'));
 assert.equal(f.state(42).screen,'sticker_sale_published');
 assert.match(f.state(42).stickerSale.link,/start=buy_sp_/);
 assert.equal(f.state(42).draft.paidVideo.id,'preserve');
 assert.equal(f.calls.filter(c=>c.method==='sendInvoice').length,0);
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
