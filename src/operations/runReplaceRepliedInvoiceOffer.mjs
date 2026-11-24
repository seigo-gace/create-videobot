import {readFileSync} from 'node:fs';
import pg from 'pg';
import {setDefaultResultOrder} from 'node:dns';
import {setDefaultAutoSelectFamily} from 'node:net';
import {readPrivateToken} from '../runtime/config.mjs';
import {createCreatorTelegramFetch} from '../runtime/creatorEgress.mjs';
import {createTelegramBotApi} from '../telegram/botApi.mjs';
import {createGateOwner} from '../../owner/gateOwner.mjs';
import {replaceRepliedInvoiceOffer} from './replaceRepliedInvoiceOffer.mjs';
import {ensureRichOfferClaimTable} from './ensureRichOfferClaimTable.mjs';

setDefaultResultOrder('ipv4first');
setDefaultAutoSelectFamily(false);
if(process.env.VIDEOBOT_DB_NAME!=='videobot'||process.env.VIDEO_SALE_MODE!=='invoice')
 throw Error('RICH_INVOICE_RUNTIME_OWNER_OR_MODE_NOT_VERIFIED');
const pool=new pg.Pool({
 host:process.env.VIDEOBOT_DB_HOST,
 user:process.env.VIDEOBOT_DB_USER,database:process.env.VIDEOBOT_DB_NAME,
 password:readFileSync('/run/secrets/videobot_db_password','utf8').trim(),
 max:1,connectionTimeoutMillis:4500
});
const network=createCreatorTelegramFetch();
try{
 const api=createTelegramBotApi({
   token:readPrivateToken(process.env.VIDEOBOT_TELEGRAM_TOKEN_FILE),
   fetchImpl:network.fetch,timeoutMs:25000
 });
 await ensureRichOfferClaimTable(pool);
 const owner=await createGateOwner({pool,telegramApi:api});
 const outcome=await replaceRepliedInvoiceOffer({
   pool,telegramApi:api,getVerifiedVideoTopic:owner.getVerifiedVideoTopic,
   deleteOld:true
 });
 console.log('VIDEO_REPLY_FREE_REPLACEMENT='+JSON.stringify(outcome));
 if(outcome.alreadyReplaced===true){
  console.log('VIDEO_PREVIOUS_REPLACEMENT_RECEIPT=PASS');
 }else if(outcome.replyFree!==true||outcome.collageAndButtonVerified!==true||
          outcome.historicalBuyersPreserved!==true||
          outcome.existingInvoiceOrdersPreserved!==true)
  throw Error('VIDEO_REPLACEMENT_VERIFICATION_FAILED');
 else if(outcome.oldRemoved!==true){
  console.log('VIDEO_NEW_POST_COMMITTED_OLD_REMOVAL_NOT_CONFIRMED');
  process.exitCode=6;
 }else{
  console.log('VIDEO_REPLY_FREE_REPLACEMENT=PASS');
 }
}finally{await network.close();await pool.end()}
