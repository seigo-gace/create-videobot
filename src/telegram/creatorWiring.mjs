import {createCreatorBotUpdateHandler} from './creatorBot.mjs';
import {createCreatorWebhookAdmission} from './creatorWebhookAdmission.mjs';
import {publishVideoListing} from './paidListingPublisher.mjs';
import {createPostgresCreatorSessionStore} from '../sales/pgCreatorSessions.mjs';
import {createPostgresListingStore} from '../sales/pgListings.mjs';
import {createPostgresPostingReceiptStore} from '../sales/pgPostingReceipts.mjs';
import {createPostgresStarsLedger} from '../sales/pgStarsLedger.mjs';
import {createPostgresWebhookUpdateStore} from '../sales/pgWebhookUpdates.mjs';
import {createVideoMediaProcessor} from './mediaProcessor.mjs';
import {createVideoBotScreenTransport} from './creatorScreenTransport.mjs';
import {createTelegramVideoFetcher} from './telegramFileFetch.mjs';
import {createTelegramPrivateMediaUploader} from './privateMediaUpload.mjs';
import {createStickerWizard} from './stickerWizard.mjs';
import {convertStickerMedia} from '../stickers/mediaConverter.mjs';
import {registerStickerAsset,reconcileStickerRegistration,createStickerSetShortName} from '../stickers/packRegistration.mjs';
import {createPostgresStickerInventory} from '../stickers/pgStickerInventory.mjs';
import {createPostgresStickerSales} from '../stickers/pgStickerSales.mjs';
import {createPostgresStickerPaidPhoto} from '../stickers/pgStickerPaidPhoto.mjs';
import {createPostgresStickerGifts} from '../stickers/pgStickerGifts.mjs';
import {createPostgresStickerTopicPosts} from '../stickers/pgStickerTopicPosts.mjs';
import {createStickerTopicPublisher} from '../stickers/topicPublication.mjs';
import {createStickerPaidCover} from '../stickers/stickerPaidCover.mjs';
import {createCreatorStickerTopicEntryPin} from '../stickers/creatorTopicEntryPin.mjs';
import {createPostgresStickerEntryPin} from '../stickers/pgStickerEntryPin.mjs';
import {createStickerSalesFlow} from './stickerSales.mjs';
import {editStickerPack,replaceStickerItem,verifyStickerPackEditSnapshot} from '../stickers/stickerPackManagement.mjs';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

/**
 * Source-only wiring for the existing VideoBot owner. This does NOT create an
 * HTTP server, register a webhook, start a bot, or approve a sale.
 *
 * Existing GATE/Topic/Review/Release and DM screen providers are injected
 * as verified read-only contracts. Missing any provider means no module.
 */
export function createVideoBotSourceModule({
  pool,telegramApi,screenTransport,gateOwner,mediaPorts,webhookSecret,
  mediaRun,storageApproved=false,botToken,verifyPrivateMediaStore,fetchImpl,
  stickerShopBaseUrl=null
}={}) {
  if(typeof pool?.query!=='function'||typeof telegramApi!=='function'||
      (screenTransport!=null&&typeof screenTransport?.show!=='function')||!gateOwner||
      (mediaPorts!=null&&(typeof mediaPorts.fetchSource!=='function'||
       typeof mediaPorts.saveGenerated!=='function')))
    throw new Error('VideoBot source module missing owned dependencies');
  for(const name of ['getVerifiedVideoTopic','verifyMembership','verifyReview','verifyRelease']) {
    if(typeof gateOwner[name]!=='function')throw new Error('verified GATE owner provider missing: '+name);
  }
  const screen=screenTransport??createVideoBotScreenTransport(telegramApi);
  // Host can supply existing media ports, or this narrow Bot API adapter
  // may be constructed using an injected private token plus an existing
  // verified private-storage provider. Neither case creates a storage chat.
  const ports=mediaPorts??{
    fetchSource:createTelegramVideoFetcher({telegramApi,token:botToken,fetchImpl}),
    saveGenerated:createTelegramPrivateMediaUploader({
      token:botToken,verifyStorage:verifyPrivateMediaStore,fetchImpl
    })
  };
  const sessionStore=createPostgresCreatorSessionStore(pool);
  const listingStore=createPostgresListingStore(pool);
  const receiptStore=createPostgresPostingReceiptStore(pool);
  const updateStore=createPostgresWebhookUpdateStore(pool);
  const starsLedger=createPostgresStarsLedger({pool,telegramApi});
  const stickerInventory=createPostgresStickerInventory(pool);
  const stickerSalesStore=createPostgresStickerSales(pool);
  const stickerPaidPhoto=createPostgresStickerPaidPhoto({pool,telegramApi});
  const stickerGifts=createPostgresStickerGifts(pool);
  const stickerTopicPosts=createPostgresStickerTopicPosts(pool);
  // GateApp-Bot owns live topic verification; never fabricate a Topic ID
  // from a t.me/c message URL. This port remains unavailable until the
  // actual GateApp verified sticker-topic + review owners are supplied.
  // The adopted product is always a pack catalog, never a paid-image
  // paywall. The Bot DM provides a native Telegram pack preview and Stars
  // invoice if a public Mini App origin has not been configured.
  const stickerTopicPublisher=
   
    typeof gateOwner.getVerifiedStickerTopic==='function'&&
    typeof gateOwner.verifyStickerReview==='function'
    ?createStickerTopicPublisher({
      telegramApi,getVerifiedStickerTopic:gateOwner.getVerifiedStickerTopic,
      verifyMembership:gateOwner.verifyMembership,
      verifyReview:gateOwner.verifyStickerReview,
      verifyRelease:gateOwner.verifyRelease,
      receiptStore:stickerTopicPosts,salesStore:stickerSalesStore,
      catalogMode:true,
       createPaidCover:createStickerPaidCover({fetchSource:ports.fetchSource})
    }):null;
  // STK-04: CreateVdobot owns its own public Topic entry message and pin.
  // GateApp supplies only the verified read-only Topic address and does not
  // send, edit, or pin CreateVdobot-owned Telegram messages.
  const ownEntryPin=
    typeof gateOwner.getVerifiedStickerEntryTopic==='function'
    ?createCreatorStickerTopicEntryPin({
      telegramApi,
      getVerifiedStickerEntryTopic:gateOwner.getVerifiedStickerEntryTopic,
      receiptStore:createPostgresStickerEntryPin(pool)
    }):null;
  const ensureStickerEntryPin=async()=>{
    if(!ownEntryPin)
      return {acknowledged:false,readbackVerified:false,reason:'VERIFIED_TOPIC_OWNER_PORT_NOT_CONNECTED'};
    return ownEntryPin();
  };
  const mediaProcessor=createVideoMediaProcessor({
    ...ports,run:mediaRun,storageApproved
  });
  const publishListing=listing=>publishVideoListing({
    listing,store:receiptStore,telegramApi,
    getVerifiedVideoTopic:gateOwner.getVerifiedVideoTopic,
    verifyMembership:gateOwner.verifyMembership,
    verifyReview:gateOwner.verifyReview,
    verifyRelease:gateOwner.verifyRelease
  });
  const stickerPublisher=async({owner,draft,onUploaded,onBeforeMutation})=>{
    if(!Number.isSafeInteger(owner)||owner<=0||!draft?.fileId||!draft?.title)
      throw new Error('STICKER_PUBLISH_INPUT_INVALID');
    const scratch=await mkdtemp(join(tmpdir(),'cv-sticker-fetch-'));
    let fetched=null,converted=null;
    try {
      fetched=await ports.fetchSource(draft.fileId,scratch);
      converted=await convertStickerMedia({
        sourcePath:fetched.path,
        kind:draft.kind==='custom_emoji'?'emoji':'sticker'
      });
      const identity=await telegramApi('getMe',{});
      if(typeof identity?.username!=='string'||identity.is_bot!==true)
        throw new Error('STICKER_BOT_IDENTITY_INVALID');
      const packName=draft.setName??
        createStickerSetShortName({owner,botUsername:identity.username,nonce:draft.nonce});
      const operationId='s'+String(owner)+'_'+draft.nonce;
      let packWritePossible=false;
      try{
        await stickerInventory.beginRegistration({operationId,ownerId:owner,
          packName,kind:draft.kind,sourceFileId:draft.fileId});
      }catch(error){
        // An unclaimed operation must not race an older in-flight receipt.
        const locked=new Error('STICKER_REGISTRATION_CLAIM_UNVERIFIED');
        locked.registrationLocked=true;
        throw locked;
      }
      try{
        return await registerStickerAsset({telegramApi,owner,
          botUsername:identity.username,title:draft.title,nonce:draft.nonce,
          kind:draft.kind,format:converted.format,mediaPath:converted.path,
          existingSetName:draft.setName??null,
          onUploaded:async receipt=>{
            await stickerInventory.uploaded({operationId,ownerId:owner,
              format:receipt.format,fileUniqueId:receipt.fileUniqueId});
            await onUploaded?.(receipt);
          },
          onBeforeMutation:async receipt=>{
            // Record the DM/session phase first. If this fails, the DB
            // receipt is still pre-mutation and can be safely abandoned.
            await onBeforeMutation?.(receipt);
            await stickerInventory.submitting({operationId,ownerId:owner});
            // Both durable receipts now precede the Telegram write.
            packWritePossible=true;
          },
          onVerified:async receipt=>{
            const item=receipt.item;
            await stickerInventory.confirmRegistration({
              operationId,ownerId:owner,packName:receipt.name,kind:draft.kind,
              title:draft.title,format:receipt.format,fileId:item.file_id,
              fileUniqueId:item.file_unique_id,position:item.position,
              emoji:item.emoji??'🙂',isDefault:draft.setName==null,
              freshPackProof:receipt.proof==='unique_new_pack',
              acknowledgedAppendProof:receipt.proof==='unique_acknowledged_append'
            });
          }});
      }catch(error){
        if(packWritePossible&&error?.definitiveTelegramRejection===true){
          // Only an explicit Telegram 400 after remote readback is terminal.
          // A timed-out operation must never take this release path.
          await stickerInventory.recordDefinitiveRejection({operationId,ownerId:owner});
          const safe=new Error('STICKER_TELEGRAM_REGISTRATION_REJECTED');
          safe.safeToRetryVerified=true;
          throw safe;
        }
        if(!packWritePossible){
          // No create/add API call can have occurred. Release the DB claim
          // conditionally; submission_started is NEVER deleted.
          // Only confirmed release allows reuse of this draft/nonce.
          try{
            await stickerInventory.abandonBeforeMutation({operationId,ownerId:owner});
          }catch{
            const locked=new Error('STICKER_PRE_MUTATION_ABORT_NOT_CONFIRMED');
            locked.registrationLocked=true;
            throw locked;
          }
          const safe=new Error(error instanceof Error?error.message:'STICKER_PUBLISH_FAILED');
          safe.preMutationVerified=true;
          throw safe;
        }
        await stickerInventory.needsReconcile({operationId,ownerId:owner}).catch(()=>{});
        const locked=new Error('STICKER_REGISTRATION_RESULT_UNKNOWN');
        locked.registrationLocked=true;
        throw locked;
      }
    }finally{
      await converted?.cleanup();
      await fetched?.cleanup();
      await rm(scratch,{recursive:true,force:true});
    }
  };
  // A crashed pre-mutation conversion/upload may leave only a receipt.
  // Release it ONLY when both the session and DB prove Telegram pack writes
  // were not started. Never unlock a submission_started operation.
  const releasePendingSticker=async({owner,pending})=>{
    if(!Number.isSafeInteger(owner)||owner<=0||
       typeof pending?.nonce!=='string'||
       !['preparing','uploaded'].includes(pending.phase))
      return {released:false};
    const operationId='s'+String(owner)+'_'+pending.nonce;
    const receipt=await stickerInventory.getRegistration({operationId,ownerId:owner});
    if(!receipt)return {released:true};
    if(!['preparing','uploaded'].includes(receipt.phase))
      return {released:false};
    const result=await stickerInventory.abandonBeforeMutation({operationId,ownerId:owner});
    return {released:result.abandoned===true};
  };
  const stickerReconcile=async({owner,pending})=>{
    const identity=await telegramApi('getMe',{});
    if(typeof identity?.username!=='string'||identity.is_bot!==true)
      throw new Error('STICKER_BOT_IDENTITY_INVALID');
    const name=pending.packName??pending.setName??
      createStickerSetShortName({owner,botUsername:identity.username,nonce:pending.nonce});
    if(!pending.fileUniqueId||!pending.format)
      return {status:'unknown',verified:false};
    const result=await reconcileStickerRegistration({telegramApi,name,
      kind:pending.kind,format:pending.format,
      fileUniqueId:pending.fileUniqueId,
      expectedTitle:pending.title,isNewPack:pending.setName==null});
    if(result.verified===true){
      const operationId='s'+String(owner)+'_'+pending.nonce;
      const stored=await stickerInventory.getRegistration({operationId,ownerId:owner});
      if(!stored||stored.pack_name!==name||stored.file_unique_id!==pending.fileUniqueId)
        return {status:'unknown',verified:false};
      await stickerInventory.confirmRegistration({
        operationId,ownerId:owner,packName:name,kind:pending.kind,
        title:pending.title,format:pending.format,
        fileId:result.item.file_id,fileUniqueId:result.item.file_unique_id,
        position:result.item.position,emoji:result.item.emoji??'🙂',
        isDefault:pending.setName==null,
        freshPackProof:result.proof==='unique_new_pack'
      });
    }
    return result;
  };
  // Owner-scoped STK-02 port. No duplicate pack edit on uncertain results:
  // the wizard stores its pending edit before invoking this mutation.
  const stickerPackEditor=async({owner,packName,action,stickerUniqueId,
    title,position,emoji,sourceFileId,newUniqueId,
    onUploaded,onBeforeMutation,verifyOnly=false})=>{
    const record=await stickerInventory.getOwnedPack(owner,packName);
    if(!record)throw new Error('STICKER_PACK_OWNER_NOT_VERIFIED');
    const identity=await telegramApi('getMe',{});
    if(identity?.is_bot!==true||typeof identity.username!=='string')
      throw new Error('STICKER_BOT_IDENTITY_INVALID');
    let set;
    if(verifyOnly){
      set=await telegramApi('getStickerSet',{name:packName});
      if(!verifyStickerPackEditSnapshot({set,name:packName,kind:record.kind,
        action,stickerUniqueId,title,position,emoji,newUniqueId}))
        return {verified:false,status:'not_observed'};
    }else if(action==='replace_item'){
      if(typeof sourceFileId!=='string'||!sourceFileId||
         typeof onUploaded!=='function'||typeof onBeforeMutation!=='function')
        throw new Error('STICKER_REPLACEMENT_INPUT_INVALID');
      const scratch=await mkdtemp(join(tmpdir(),'cv-sticker-replace-'));
      let fetched=null,converted=null,packWritePossible=false;
      try{
        fetched=await ports.fetchSource(sourceFileId,scratch);
        converted=await convertStickerMedia({
          sourcePath:fetched.path,
          kind:record.kind==='custom_emoji'?'emoji':'sticker',
          format:record.format
        });
        const bytes=await readFile(converted.path);
        const result=await replaceStickerItem({telegramApi,owner,
          botUsername:identity.username,
          record:{ownerId:owner,name:packName,kind:record.kind},
          stickerUniqueId,bytes:new Uint8Array(bytes),format:converted.format,
          onUploaded,
          onBeforeMutation:async receipt=>{
            await onBeforeMutation(receipt);
            packWritePossible=true;
          }});
        if(result.verified!==true)throw new Error('STICKER_REPLACE_RESULT_UNKNOWN');
        set=result.set;
      }catch(error){
        if(!packWritePossible){
          const safe=new Error(error instanceof Error?error.message:
            'STICKER_REPLACEMENT_PRE_MUTATION_FAILED');
          safe.preMutationVerified=true;
          throw safe;
        }
        throw error;
      }finally{
        await converted?.cleanup();
        await fetched?.cleanup();
        await rm(scratch,{recursive:true,force:true});
      }
    }else{
      const result=await editStickerPack({telegramApi,owner,
        botUsername:identity.username,
        record:{ownerId:owner,name:packName,kind:record.kind},
        action,stickerUniqueId,title,position,emoji});
      if(result.verified!==true)throw new Error('STICKER_PACK_EDIT_RESULT_UNKNOWN');
      set=result.set;
    }
    const synced=await stickerInventory.syncOwnedPackSnapshot({
      ownerId:owner,packName,set});
    return {verified:true,synced,packName};
  };
  const stickerSales=createStickerSalesFlow({
    api:telegramApi,sessionStore,screenTransport:screen,
    salesStore:stickerSalesStore,giftStore:stickerGifts,packInventory:stickerInventory,
    topicPublisher:stickerTopicPublisher,paidPhotoStore:stickerPaidPhoto,
    stickerShopBaseUrl,
    publishSnapshot:async({sellerId,packName,priceStars,productId,sellerFeeAccepted})=>{
      const own=await stickerInventory.getOwnedPack(sellerId,packName);
      if(!own)throw Error('STICKER_SALE_PACK_OWNER_REQUIRED');
      const set=await telegramApi('getStickerSet',{name:packName});
      if(!set||set.name!==packName||set.sticker_type!==own.kind)
        throw Error('STICKER_SALE_SET_NOT_VERIFIED');
      // Captures all Telegram item IDs and price in an immutable product
      // version; later pack CRUD does not mutate these purchased references.
      return stickerSalesStore.publish({sellerId,packName,set,priceStars,productId,sellerFeeAccepted});
    }
  });
  const stickerWizard=createStickerWizard({
    api:telegramApi,sessionStore,screenTransport:screen,
    publishSticker:stickerPublisher,reconcileSticker:stickerReconcile,
    releasePendingSticker,packInventory:stickerInventory,editPack:stickerPackEditor,
    beginStickerSale:stickerSales.beginSell,stickerShopBaseUrl
  });
  const handleCreatorUpdate=createCreatorBotUpdateHandler({
    api:telegramApi,sessionStore,listingStore,
    screenTransport:screen,mediaProcessor,publishListing,
    salesProvider:starsLedger,starsLedger,
    stickerHandler:stickerWizard.handle,
    stickerSalesHandler:stickerSales.handle,
    stickerSalesPayments:stickerSales.payments,
    stickerPaidPhotoPurchase:stickerSales.paidMediaPurchase
  });
  const handleTelegramWebhook=createCreatorWebhookAdmission({
    expectedSecret:webhookSecret,handleCreatorUpdate,updateStore
  });
  return Object.freeze({
    handleTelegramWebhook,
    // Named components for deterministic Source/isolated DB verification.
    listingStore,sessionStore,receiptStore,starsLedger,updateStore,
    stickerInventory,stickerSalesStore,stickerPaidPhoto,stickerGifts,stickerTopicPosts,stickerWizard,ensureStickerEntryPin,publishListing,handleCreatorUpdate
  });
}
