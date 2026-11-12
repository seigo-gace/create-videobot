import pg from 'pg';
import {applyCreatorSchema} from './creatorMigrate.mjs';
import {createPostgresStickerInventory} from '../stickers/pgStickerInventory.mjs';
import {createPostgresStickerSales} from '../stickers/pgStickerSales.mjs';
import {createPostgresStickerGifts} from '../stickers/pgStickerGifts.mjs';
import {createPostgresStickerTopicPosts} from '../stickers/pgStickerTopicPosts.mjs';
const {Pool}=pg;
if(process.env.CI_DOCKER_DB_TEST_ONLY!=='YES' ||
   !/^postgres:\/\/videobot_ci:ci_only_not_a_secret@127\.0\.0\.1:5432\/videobot_migration_ci$/.test(process.env.CI_VIDEO_DB_DSN||'')){
 throw new Error('local disposable Docker CI database only');
}
const pool=new Pool({connectionString:process.env.CI_VIDEO_DB_DSN,max:1});
try {
 const result=await applyCreatorSchema({pool});
 if(result.applied!==true||result.migrations!==10)throw new Error('ten migrations not confirmed');
 const q=await pool.query("SELECT to_regclass('videobot_webhook_updates') IS NOT NULL AS webhook, to_regclass('videobot_stars_ledger') IS NOT NULL AS ledger, to_regclass('videobot_sticker_packs') IS NOT NULL AS packs, to_regclass('videobot_sticker_items') IS NOT NULL AS items, to_regclass('videobot_sticker_registration_receipts') IS NOT NULL AS receipts, to_regclass('videobot_sticker_products') IS NOT NULL AS products, to_regclass('videobot_sticker_orders') IS NOT NULL AS orders, to_regclass('videobot_sticker_delivery_items') IS NOT NULL AS deliveries, to_regclass('videobot_sticker_payment_support') IS NOT NULL AS support, to_regclass('videobot_sticker_topic_posts') IS NOT NULL AS topic_posts, to_regclass('videobot_sticker_gifts') IS NOT NULL AS gifts, to_regclass('videobot_sticker_gift_delivery_items') IS NOT NULL AS gift_deliveries");
 if(q.rows.length!==1||!Object.values(q.rows[0]).every(v=>v===true))
   throw new Error('Docker-installed schema not readable');
 // A second real transaction must be idempotent on a migrated database.
 const repeat=await applyCreatorSchema({pool});
 if(repeat.applied!==true||repeat.migrations!==10)throw new Error('schema re-application invalid');
 // Exercise the actual Node adapter against PostgreSQL, not an in-memory fake.
 const inventory=createPostgresStickerInventory(pool);
 // Regression: a failed conversion/upload before the Telegram pack-write
 // may release its receipt, while a submitted/unknown write never may.
 const retryId='s42_ci_retry';
 const retryName='s42_ci_retry_by_CreateVdobot';
 await inventory.beginRegistration({operationId:retryId,ownerId:42,
   packName:retryName,kind:'regular',sourceFileId:'source_for_retry'});
 await inventory.uploaded({operationId:retryId,ownerId:42,format:'static',
   fileUniqueId:'unique_before_mutation'});
 const released=await inventory.abandonBeforeMutation({operationId:retryId,ownerId:42});
 if(released.abandoned!==true||
    await inventory.getRegistration({operationId:retryId,ownerId:42})!==null)
   throw new Error('STICKER_PRE_MUTATION_RELEASE_FAILED');
 await inventory.beginRegistration({operationId:retryId,ownerId:42,
   packName:retryName,kind:'regular',sourceFileId:'source_for_retry'});
 await inventory.uploaded({operationId:retryId,ownerId:42,format:'static',
   fileUniqueId:'unique_before_mutation'});
 await inventory.submitting({operationId:retryId,ownerId:42});
 const uncertainDenied=await inventory.abandonBeforeMutation({
   operationId:retryId,ownerId:42
 }).then(()=>false,e=>e?.message==='STICKER_PRE_MUTATION_ABORT_NOT_CONFIRMED');
 if(!uncertainDenied||
    (await inventory.getRegistration({operationId:retryId,ownerId:42}))?.phase!=='submission_started')
   throw new Error('STICKER_UNKNOWN_RECEIPT_MUST_REMAIN_LOCKED');
 const id='s42_ciabcdef';
 const name='s42_ciabcdef_by_CreateVdobot';
 await inventory.beginRegistration({operationId:id,ownerId:42,
   packName:name,kind:'regular',sourceFileId:'ci_source_file'});
 await inventory.uploaded({operationId:id,ownerId:42,format:'static',
   fileUniqueId:'ci_unique_sticker'});
 await inventory.submitting({operationId:id,ownerId:42});
 await inventory.confirmRegistration({operationId:id,ownerId:42,
   packName:name,kind:'regular',title:'CI Sticker pack',format:'static',
   fileId:'ci_sticker_file_id',fileUniqueId:'ci_unique_sticker',position:0});
 const found=await inventory.listPacks(42);
 const foreign=await inventory.listPacks(99);
 const receipt=await inventory.getRegistration({operationId:id,ownerId:42});
 if(found.length!==1||found[0].pack_name!==name||foreign.length!==0||
    receipt?.phase!=='registered')
   throw new Error('STICKER_PERSISTENT_RECEIPT_READBACK_FAILED');
 await inventory.confirmRegistration({operationId:id,ownerId:42,
   packName:name,kind:'regular',title:'CI Sticker pack',format:'static',
   fileId:'ci_sticker_file_id',fileUniqueId:'ci_unique_sticker',position:0});
 const duplicate=await inventory.beginRegistration({operationId:id,ownerId:42,
   packName:name,kind:'regular',sourceFileId:'ci_source_file'}).then(()=>false,
     error=>error?.message==='STICKER_REGISTRATION_ALREADY_CLAIMED');
 if(!duplicate)throw new Error('STICKER_DUPLICATE_OPERATION_NOT_DENIED');
 // STK-02: real PostgreSQL snapshot synchronization is owner-scoped and
 // atomically replaces item positions after verified Telegram readback.
 const snapshot={name,title:'Updated sticker title',sticker_type:'regular',
   stickers:[{file_id:'file_one',file_unique_id:'unique_one',emoji:'🙂'},
             {file_id:'file_two',file_unique_id:'unique_two',emoji:'😀'}]};
 const synced=await inventory.syncOwnedPackSnapshot({
   ownerId:42,packName:name,set:snapshot});
 const storedItems=await inventory.listOwnedItems({ownerId:42,packName:name});
 const storedPack=await inventory.getOwnedPack(42,name);
 const foreignItems=await inventory.listOwnedItems({ownerId:99,packName:name});
 if(!synced.synced||synced.itemCount!==2||storedPack.title!=='Updated sticker title'||
    storedItems.length!==2||storedItems[1].file_unique_id!=='unique_two'||
    storedItems[1].position!==1||foreignItems.length)
   throw new Error('STICKER_PACK_EDIT_SQL_SYNC_FAILED');
 const denied=await inventory.syncOwnedPackSnapshot({
   ownerId:99,packName:name,set:snapshot
 }).then(()=>false,e=>e?.message==='STICKER_PACK_OWNER_CONFLICT');
 if(!denied)throw new Error('STICKER_PACK_EDIT_FOREIGN_OWNER_ALLOWED');
 const reduced=await inventory.syncOwnedPackSnapshot({
   ownerId:42,packName:name,set:{...snapshot,stickers:[snapshot.stickers[1]]}});
 if(!reduced.synced||
    (await inventory.listOwnedItems({ownerId:42,packName:name})).length!==1)
   throw new Error('STICKER_PACK_EDIT_DELETE_SQL_SYNC_FAILED');

 // STK-03: real committed invoice/product/entitlement isolation, not mocks.
 const sales=createPostgresStickerSales(pool);
 const fixedProductId='sp_'+'a'.repeat(24);
 const sold=await sales.publish({sellerId:42,packName:name,set:snapshot,
   priceStars:50,productId:fixedProductId});
 const repeatedProduct=await sales.publish({sellerId:42,packName:name,set:snapshot,
   priceStars:50,productId:fixedProductId});
 if(repeatedProduct.productId!==sold.productId||repeatedProduct.duplicate!==true)
   throw new Error('STICKER_STARS_PRODUCT_IDEMPOTENCY_FAILED');
 const product=await sales.getPublished(sold.productId);
 if(!product||product.version!==1||product.price_stars!==50||product.items.length!==2)
   throw new Error('STICKER_STARS_PRODUCT_PUBLISH_FAILED');
 const order=await sales.reserveOrder({productId:sold.productId,buyerId:99});
 const second=await sales.reserveOrder({productId:sold.productId,buyerId:99});
 if(!order.newOrder||second.newOrder||order.order_id!==second.order_id)
   throw new Error('STICKER_STARS_ORDER_IDEMPOTENCY_FAILED');
 const premature=await sales.checkPreCheckout({
   invoice_payload:'stk:'+order.order_id,currency:'XTR',total_amount:50,from:{id:99}});
 if(premature)throw new Error('STICKER_STARS_PRECHECKOUT_BEFORE_INVOICE_ALLOWED');
 const begun=await sales.startInvoice(order.order_id,99);
 if(!begun||await sales.startInvoice(order.order_id,99)!==null)
   throw new Error('STICKER_STARS_DOUBLE_INVOICE_ALLOWED');
 const pre=await sales.checkPreCheckout({
   invoice_payload:'stk:'+order.order_id,currency:'XTR',total_amount:50,from:{id:99}});
 const wrongPrice=await sales.checkPreCheckout({
   invoice_payload:'stk:'+order.order_id,currency:'XTR',total_amount:51,from:{id:99}});
 const wrongBuyer=await sales.checkPreCheckout({
   invoice_payload:'stk:'+order.order_id,currency:'XTR',total_amount:50,from:{id:98}});
 if(!pre||wrongPrice||wrongBuyer)
   throw new Error('STICKER_STARS_PRECHECKOUT_VALIDATION_FAILED');
 await sales.invoiceSent(order.order_id,99,333);
 const payment={invoice_payload:'stk:'+order.order_id,
   currency:'XTR',total_amount:50,telegram_payment_charge_id:'ci_stk_charge_1'};
 const recorded=await sales.capturePayment({buyerId:99,successfulPayment:payment,updateId:1000});
 const replay=await sales.capturePayment({buyerId:99,successfulPayment:payment,updateId:1000});
 if(recorded.duplicate||!replay.duplicate)
   throw new Error('STICKER_STARS_DUPLICATE_PAYMENT_FAILED');
 const foreignPaid=await sales.getPaidOrder(order.order_id,98);
 if(foreignPaid!==null)throw new Error('STICKER_STARS_ENTITLEMENT_OWNER_BROKEN');
 const first=await sales.claimItem({orderId:order.order_id,buyerId:99,attempt:1,index:0});
 const double=await sales.claimItem({orderId:order.order_id,buyerId:99,attempt:1,index:0});
 if(first?.file_unique_id!=='unique_one'||double!==null)
   throw new Error('STICKER_STARS_DELIVERY_CAS_BROKEN');
 await sales.itemSent({orderId:order.order_id,attempt:1,index:0,messageId:555});
 const receiptRows=await sales.getDeliveryRows(order.order_id,1);
 if(receiptRows[0].status!=='sent'||receiptRows[1].status!=='pending')
   throw new Error('STICKER_STARS_DELIVERY_RECEIPT_BROKEN');
 const extra=await sales.createRedelivery(order.order_id,99);
 if(extra.attempt!==2||(await sales.getDeliveryRows(order.order_id,2)).length!==2)
   throw new Error('STICKER_STARS_REDELIVERY_BROKEN');
 const unauthorized=await sales.createRedelivery(order.order_id,100)
   .then(()=>false,e=>e?.message==='STICKER_SALE_NOT_PURCHASED');
 if(!unauthorized)throw new Error('STICKER_STARS_UNAUTHORIZED_REDELIVERY');
 const originalVersion=await sales.getPublished(sold.productId);
 if(originalVersion.items[0].file_unique_id!=='unique_one')
   throw new Error('STICKER_STARS_IMMUTABLE_ITEMS_CHANGED');
 const supportCase=await sales.createPaymentSupport({
   buyerId:99,orderId:order.order_id,details:'CI purchase dispute example'});
 const supportRow=await pool.query(
   "SELECT buyer_user_id,order_id,status FROM videobot_sticker_payment_support WHERE ticket_id=$1",
   [supportCase.ticketId]);
 if(supportRow.rowCount!==1||supportRow.rows[0].buyer_user_id!=='99'&&
    String(supportRow.rows[0].buyer_user_id)!=='99')
   throw new Error('STICKER_STARS_SUPPORT_NOT_STORED');
 const foreignSupport=await sales.createPaymentSupport({
   buyerId:98,orderId:order.order_id,details:'Foreign support case'})
   .then(()=>false,e=>e.message==='STICKER_SALE_SUPPORT_OWNER_MISMATCH');
 if(!foreignSupport)throw new Error('STICKER_STARS_SUPPORT_FOREIGN_OWNER');
 // STK-03 gift: only a paid buyer can issue, each 192-bit secret is
 // single-recipient, the donor keeps the original paid entitlement.
 const gifts=createPostgresStickerGifts(pool);
 const giftId='sg_'+'d'.repeat(24),secret='R'.repeat(32);
 const prepared=await gifts.prepare({giftId,donorOrderId:order.order_id,
   donorId:99,token:secret});
 const retryGift=await gifts.prepare({giftId,donorOrderId:order.order_id,
   donorId:99,token:secret});
 if(!prepared.created||retryGift.created)
   throw Error('STICKER_GIFT_PREPARE_IDEMPOTENCY');
 const foreignGift=await gifts.prepare({giftId:'sg_'+'e'.repeat(24),
   donorOrderId:order.order_id,donorId:98,token:'S'.repeat(32)})
   .then(()=>false,e=>e?.message==='STICKER_GIFT_OPERATION_CONFLICT_OR_NOT_PAID');
 if(!foreignGift)throw Error('STICKER_GIFT_FOREIGN_DONOR_ISSUED');
 const donorRejection=await gifts.redeem({token:secret,recipientId:99})
   .then(()=>false,e=>e?.message==='STICKER_GIFT_SELF_RECEIPT_DENIED');
 if(!donorRejection)throw Error('STICKER_GIFT_SELF_RECEIPT_GRANTED');
 const received=await gifts.redeem({token:secret,recipientId:98});
 const duplicateReceive=await gifts.redeem({token:secret,recipientId:98});
 if(!received.newReceipt||duplicateReceive.newReceipt||
    received.giftId!==giftId)
   throw Error('STICKER_GIFT_REDEEM_NOT_IDEMPOTENT');
 const thief=await gifts.redeem({token:secret,recipientId:100})
   .then(()=>false,e=>e?.message==='STICKER_GIFT_ALREADY_RECEIVED');
 if(!thief)throw Error('STICKER_GIFT_SECOND_RECIPIENT_ALLOWED');
 const foreignView=await gifts.getReceived(giftId,100);
 const giftOrder=await gifts.getReceived(giftId,98);
 const donorOrder=await sales.getPaidOrder(order.order_id,99);
 const inbox=await gifts.listReceived(98);
 if(foreignView!==null||giftOrder?.items?.length!==2||
    donorOrder?.invoice_state!=='paid'||inbox.length!==1)
   throw Error('STICKER_GIFT_ENTITLEMENT_ISOLATION');
 const receivedItem=await gifts.claimItem({giftId,recipientId:98,attempt:1,index:0});
 const repeatedItem=await gifts.claimItem({giftId,recipientId:98,attempt:1,index:0});
 if(receivedItem?.file_unique_id!=='unique_one'||repeatedItem!==null)
   throw Error('STICKER_GIFT_DELIVERY_CAS_FAILED');
 await gifts.itemSent({giftId,attempt:1,index:0,messageId:556});
 const giftRows=await gifts.deliveryRows(giftId,1);
 if(giftRows[0].status!=='sent'||giftRows[1].status!=='pending')
   throw Error('STICKER_GIFT_RECEIPT_INVALID');
 const redelivery=await gifts.redeliver(giftId,98);
 if(redelivery.attempt!==2||(await gifts.deliveryRows(giftId,2)).length!==2)
   throw Error('STICKER_GIFT_REDELIVERY_INVALID');
 const unauthGiftRedelivery=await gifts.redeliver(giftId,100)
   .then(()=>false,e=>e?.message==='STICKER_GIFT_NOT_RECEIVED');
 if(!unauthGiftRedelivery)
   throw Error('STICKER_GIFT_REDELIVERY_OWNER_BROKEN');
 const allGifts=await pool.query('SELECT COUNT(*)::integer AS total FROM videobot_sticker_gifts');
 const allOrders=await pool.query('SELECT COUNT(*)::integer AS total FROM videobot_sticker_orders');
 if(allGifts.rows[0].total!==1||allOrders.rows[0].total!==1)
   throw Error('STICKER_GIFT_CREATED_EXTRA_CHARGE_OR_ORDER');
 process.stdout.write('DOCKER_NODE_POSTGRES_STICKER_GIFTS=PASS\\n');
 const topicStore=createPostgresStickerTopicPosts(pool);
 const topic={chatId:-1002373696859,threadId:102,groupTitle:'ビデオChatの掲示板',
   title:'ステッカーの公開と販売'};
 const topicClaim=await topicStore.claim({productId:sold.productId,
   sellerId:42,topic,text:'Verified sale message'});
 const repeatClaim=await topicStore.claim({productId:sold.productId,
   sellerId:42,topic,text:'Verified sale message'});
 if(!topicClaim.claimed||repeatClaim.claimed||repeatClaim.status!=='sending')
   throw new Error('STICKER_TOPIC_POST_CLAIM_BROKEN');
 await topicStore.recorded(sold.productId,42,444);
 const ownedTopic=await topicStore.getOwned(sold.productId,42);
 const foreignTopic=await topicStore.getOwned(sold.productId,99);
 if(ownedTopic.status!=='sent'||Number(ownedTopic.telegram_message_id)!==444||foreignTopic!==null)
   throw new Error('STICKER_TOPIC_POST_OWNER_READBACK_BROKEN');
 await topicStore.edited(sold.productId,42,'Edited verified message');
 await topicStore.deleted(sold.productId,42);
 if((await topicStore.getOwned(sold.productId,42)).status!=='deleted')
   throw new Error('STICKER_TOPIC_DELETE_RECEIPT_BROKEN');
 process.stdout.write('DOCKER_NODE_POSTGRES_STICKER_TOPIC=PASS\n');

 process.stdout.write('DOCKER_NODE_POSTGRES_STICKER_STARS=PASS\n');

 process.stdout.write('DOCKER_NODE_POSTGRES_STICKER_INVENTORY=PASS\n');
 process.stdout.write('DOCKER_NODE_POSTGRES_MIGRATION=PASS\n');
}finally{await pool.end();}
