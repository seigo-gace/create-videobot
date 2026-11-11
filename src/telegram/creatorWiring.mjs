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
import {mkdtemp,rm} from 'node:fs/promises';
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
  mediaRun,storageApproved=false,botToken,verifyPrivateMediaStore,fetchImpl
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
      await stickerInventory.beginRegistration({operationId,ownerId:owner,
        packName,kind:draft.kind,sourceFileId:draft.fileId});
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
            await stickerInventory.submitting({operationId,ownerId:owner});
            await onBeforeMutation?.(receipt);
          },
          onVerified:async receipt=>{
            const item=receipt.item;
            await stickerInventory.confirmRegistration({
              operationId,ownerId:owner,packName:receipt.name,kind:draft.kind,
              title:draft.title,format:receipt.format,fileId:item.file_id,
              fileUniqueId:item.file_unique_id,position:item.position,
              emoji:item.emoji??'🙂',isDefault:draft.setName==null
            });
          }});
      }catch(error){
        await stickerInventory.needsReconcile({operationId,ownerId:owner}).catch(()=>{});
        throw error;
      }
    }finally{
      await converted?.cleanup();
      await fetched?.cleanup();
      await rm(scratch,{recursive:true,force:true});
    }
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
      fileUniqueId:pending.fileUniqueId});
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
        isDefault:pending.setName==null
      });
    }
    return result;
  };
  const stickerWizard=createStickerWizard({
    api:telegramApi,sessionStore,screenTransport:screen,
    publishSticker:stickerPublisher,reconcileSticker:stickerReconcile,
    packInventory:stickerInventory
  });
  const handleCreatorUpdate=createCreatorBotUpdateHandler({
    api:telegramApi,sessionStore,listingStore,
    screenTransport:screen,mediaProcessor,publishListing,
    salesProvider:starsLedger,starsLedger,
    stickerHandler:stickerWizard.handle
  });
  const handleTelegramWebhook=createCreatorWebhookAdmission({
    expectedSecret:webhookSecret,handleCreatorUpdate,updateStore
  });
  return Object.freeze({
    handleTelegramWebhook,
    // Named components for deterministic Source/isolated DB verification.
    listingStore,sessionStore,receiptStore,starsLedger,updateStore,
    stickerInventory,publishListing,handleCreatorUpdate
  });
}
