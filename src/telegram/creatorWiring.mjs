import {createCreatorBotUpdateHandler} from './creatorBot.mjs';
import {createCreatorWebhookAdmission} from './creatorWebhookAdmission.mjs';
import {publishVideoListing} from './paidListingPublisher.mjs';
import {createPostgresCreatorSessionStore} from '../sales/pgCreatorSessions.mjs';
import {createPostgresListingStore} from '../sales/pgListings.mjs';
import {createPostgresPostingReceiptStore} from '../sales/pgPostingReceipts.mjs';
import {createPostgresStarsLedger} from '../sales/pgStarsLedger.mjs';
import {createVideoMediaProcessor} from './mediaProcessor.mjs';

/**
 * Source-only wiring for the existing VideoBot owner. This does NOT create an
 * HTTP server, register a webhook, start a bot, or approve a sale.
 *
 * Existing GATE/Topic/Review/Release and DM screen providers are injected
 * as verified read-only contracts. Missing any provider means no module.
 */
export function createVideoBotSourceModule({
  pool,telegramApi,screenTransport,gateOwner,mediaPorts,webhookSecret,
  mediaRun,storageApproved=false
}={}) {
  if(typeof pool?.query!=='function'||typeof telegramApi!=='function'||
      typeof screenTransport?.show!=='function'||!gateOwner||
      !mediaPorts||typeof mediaPorts.fetchSource!=='function'||
      typeof mediaPorts.saveGenerated!=='function')
    throw new Error('VideoBot source module missing owned dependencies');
  for(const name of ['getVerifiedVideoTopic','verifyMembership','verifyReview','verifyRelease']) {
    if(typeof gateOwner[name]!=='function')throw new Error('verified GATE owner provider missing: '+name);
  }
  const sessionStore=createPostgresCreatorSessionStore(pool);
  const listingStore=createPostgresListingStore(pool);
  const receiptStore=createPostgresPostingReceiptStore(pool);
  const starsLedger=createPostgresStarsLedger({pool,telegramApi});
  const mediaProcessor=createVideoMediaProcessor({
    ...mediaPorts,run:mediaRun,storageApproved
  });
  const publishListing=listing=>publishVideoListing({
    listing,store:receiptStore,telegramApi,
    getVerifiedVideoTopic:gateOwner.getVerifiedVideoTopic,
    verifyMembership:gateOwner.verifyMembership,
    verifyReview:gateOwner.verifyReview,
    verifyRelease:gateOwner.verifyRelease
  });
  const handleCreatorUpdate=createCreatorBotUpdateHandler({
    api:telegramApi,sessionStore,listingStore,
    screenTransport,mediaProcessor,publishListing,
    salesProvider:starsLedger,starsLedger
  });
  const handleTelegramWebhook=createCreatorWebhookAdmission({
    expectedSecret:webhookSecret,handleCreatorUpdate
  });
  return Object.freeze({
    handleTelegramWebhook,
    // Named components for deterministic Source/isolated DB verification.
    listingStore,sessionStore,receiptStore,starsLedger,
    publishListing,handleCreatorUpdate
  });
}
