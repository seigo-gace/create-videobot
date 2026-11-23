/**
 * Video invoice path only. Native sendPaidMedia and sticker invoices remain
 * independent. All charge, entitlement and delivery state must be durable.
 */
const SKU=/^[A-Za-z0-9_-]{1,40}$/;
const ORDER=/^vi_[a-f0-9]{24}$/;
export const videoInvoicePayload=id=>{
  if(!ORDER.test(id))throw Error('VIDEO_INVOICE_ORDER_INVALID');
  return 'vid:'+id;
};
export function videoOfferLink(username,listingId,revision){
  if(typeof username!=='string'||!/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(username)||
     typeof listingId!=='string'||!SKU.test(listingId)||
     !Number.isSafeInteger(revision)||revision<1)
    throw Error('VIDEO_INVOICE_LINK_INVALID');
  const param='vid_'+listingId+'_r'+revision;
  if(param.length>64)throw Error('VIDEO_INVOICE_LINK_TOO_LONG');
  return 'https://t.me/'+username+'?start='+param;
}
export function createVideoInvoiceSalesFlow({api,store}={}){
  if(typeof api!=='function'||!store||
    ['reserve','markSending','markInvoiceSent','markInvoiceUnknown','verifyCheckout',
     'capturePayment','claimDelivery','markDelivered','markDeliveryUnknown']
    .some(k=>typeof store[k]!=='function'))throw Error('VIDEO_INVOICE_PORTS_MISSING');

  async function purchase(userId,listingId,revision){
    if(!Number.isSafeInteger(userId)||userId<=0||!SKU.test(listingId)||
       !Number.isSafeInteger(revision)||revision<1)throw Error('VIDEO_INVOICE_BUYER_INVALID');
    const order=await store.reserve({buyerId:userId,listingId,revision});
    if(order?.status==='paid'||order?.status==='delivered'||order?.status==='delivering'||order?.status==='delivery_unknown'){
      if(order.status==='paid')await deliver(order.orderId,userId);
      return {handled:true,alreadyPurchased:true};
    }
    if(order?.status!=='prepared')return {handled:true,invoiceState:order?.status??'unknown'};
    const started=await store.markSending({orderId:order.orderId,buyerId:userId});
    if(!started)return {handled:true,invoiceState:'unknown'};
    try{
      const sent=await api('sendInvoice',{
        chat_id:userId,
        title:String(started.title).slice(0,32),
        description:'購入確認後、動画本編をこのチャットにお届けします。',
        payload:videoInvoicePayload(started.orderId),
        currency:'XTR',
        prices:[{label:'動画本編',amount:started.priceStars}]
      });
      if(!Number.isSafeInteger(sent?.message_id)||sent.message_id<=0)
        throw Error('VIDEO_INVOICE_ACK_UNKNOWN');
      await store.markInvoiceSent({orderId:started.orderId,messageId:sent.message_id});
      return {handled:true,invoiceSent:true,messageId:sent.message_id};
    }catch{
      await store.markInvoiceUnknown({orderId:started.orderId});
      return {handled:true,invoiceState:'unknown'};
    }
  }

  async function deliver(orderId,buyerId){
    // A paid order is never sent to a group, never before an authenticated
    // successful_payment and never retried automatically after unknown I/O.
    const claim=await store.claimDelivery({orderId,buyerId});
    if(!claim)return {handled:true,deliveryPending:true};
    try{
      const sent=await api('sendVideo',{
        chat_id:buyerId,video:claim.fileId,protect_content:true,
        caption:claim.title
      });
      if(!Number.isSafeInteger(sent?.message_id)||sent.message_id<=0||
         sent.chat?.id!==buyerId)throw Error('VIDEO_INVOICE_DELIVERY_ACK_UNKNOWN');
      await store.markDelivered({orderId,messageId:sent.message_id});
      return {handled:true,delivered:true};
    }catch{
      await store.markDeliveryUnknown({orderId});
      return {handled:true,deliveryUnknown:true};
    }
  }

  async function handle(update){
    const cb=update?.callback_query;
    if(typeof cb?.data==='string'&&cb.data.startsWith('vid:buy:')){
      const m=/^vid:buy:([A-Za-z0-9_-]{1,40}):([1-9][0-9]*)$/.exec(cb.data);
      if(!m||!Number.isSafeInteger(cb.from?.id)||cb.from.id<=0)throw Error('VIDEO_INVOICE_BUTTON_INVALID');
      await api('answerCallbackQuery',{callback_query_id:cb.id,
        text:'購入用の請求書をBotとのチャットへ送ります。'});
      return purchase(cb.from.id,m[1],Number(m[2]));
    }
    const q=update?.pre_checkout_query;
    if(q && typeof q.invoice_payload==='string' && q.invoice_payload.startsWith('vid:')){
      const id=q.invoice_payload.slice(4);
      const valid=ORDER.test(id)&&q.currency==='XTR'&&
        await store.verifyCheckout({orderId:id,buyerId:q.from?.id,
          amount:q.total_amount}).catch(()=>false);
      await api('answerPreCheckoutQuery',{
        pre_checkout_query_id:q.id,ok:valid===true,
        ...(valid===true?{}:{error_message:'注文を確認できません。決済を中止しました。'})
      });
      return {handled:true,preCheckoutApproved:valid===true};
    }
    const m=update?.message,sp=m?.successful_payment;
    if(sp && typeof sp.invoice_payload==='string' && sp.invoice_payload.startsWith('vid:')){
      const orderId=sp.invoice_payload.slice(4);
      if(!ORDER.test(orderId)||m.chat?.type!=='private'||
        m.from?.id!==m.chat?.id||!Number.isSafeInteger(update.update_id))
        throw Error('VIDEO_INVOICE_PAYMENT_IDENTITY_INVALID');
      const captured=await store.capturePayment({
        orderId,buyerId:m.from.id,payment:sp,updateId:update.update_id
      });
      const sent=await deliver(orderId,m.from.id);
      return {handled:true,paymentRecorded:true,duplicate:captured.duplicate,...sent};
    }
    if(m?.chat?.type==='private'&&typeof m.text==='string'){
      const match=/^\/start(?:@[A-Za-z0-9_]+)?\s+vid_([A-Za-z0-9_-]{1,40})_r([1-9][0-9]*)$/.exec(m.text.trim());
      if(match)return purchase(m.from?.id,match[1],Number(match[2]));
    }
    return {handled:false};
  }
  return Object.freeze({handle,purchase,deliver});
}
