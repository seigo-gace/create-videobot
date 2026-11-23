import {readFileSync} from 'node:fs';
import pg from 'pg';
import {setDefaultResultOrder} from 'node:dns';
import {setDefaultAutoSelectFamily} from 'node:net';
import {readPrivateToken} from '../runtime/config.mjs';
import {createCreatorTelegramFetch} from '../runtime/creatorEgress.mjs';
import {createTelegramBotApi} from '../telegram/botApi.mjs';
import {createGateOwner} from '../../owner/gateOwner.mjs';
import {publishReissuedInvoiceOffer} from './reissueVideoInvoiceOffer.mjs';

setDefaultResultOrder('ipv4first');
setDefaultAutoSelectFamily(false);
if(process.env.VIDEOBOT_DB_NAME!=='videobot')
  throw Error('VIDEO_REISSUE_DATABASE_NOT_VERIFIED');
if(process.env.VIDEO_SALE_MODE==='paid_media')
  throw Error('VIDEO_REISSUE_MUST_USE_INVOICE');
const pool=new pg.Pool({
 host:process.env.VIDEOBOT_DB_HOST,
 user:process.env.VIDEOBOT_DB_USER,
 database:process.env.VIDEOBOT_DB_NAME,
 password:readFileSync('/run/secrets/videobot_db_password','utf8').trim(),
 max:1,connectionTimeoutMillis:4500
});
const net=createCreatorTelegramFetch();
try{
 const api=createTelegramBotApi({
   token:readPrivateToken(process.env.VIDEOBOT_TELEGRAM_TOKEN_FILE),
   fetchImpl:net.fetch,timeoutMs:25000
 });
 const owner=await createGateOwner({pool,telegramApi:api});
 const result=await publishReissuedInvoiceOffer({
   pool,telegramApi:api,getVerifiedVideoTopic:owner.getVerifiedVideoTopic
 });
 console.log('VIDEO_REISSUE_INVOICE_POSTED='+result.posted);
 console.log('VIDEO_REISSUE_INVOICE_KEY='+result.listingId+':1');
 console.log('VIDEO_REISSUE_NEW_MESSAGE_ID='+result.paidMessageId);
}finally{await net.close();await pool.end()}
