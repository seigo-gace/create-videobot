import {readFileSync} from 'node:fs';
import pg from 'pg';
import {setDefaultResultOrder} from 'node:dns';
import {setDefaultAutoSelectFamily} from 'node:net';
import {readPrivateToken} from '../runtime/config.mjs';
import {createCreatorTelegramFetch} from '../runtime/creatorEgress.mjs';
import {createTelegramBotApi} from '../telegram/botApi.mjs';
import {createGateOwner} from '../../owner/gateOwner.mjs';
import {replaceInvoiceAlbumWithRich} from './replaceInvoiceAlbumWithRich.mjs';

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
 const owner=await createGateOwner({pool,telegramApi:api});
 const outcome=await replaceInvoiceAlbumWithRich({
   pool,telegramApi:api,getVerifiedVideoTopic:owner.getVerifiedVideoTopic,
   cleanupOld:true
 });
 console.log('VIDEO_EXISTING_MESSAGE_EDIT='+JSON.stringify(outcome));
 if(outcome.edited!==true||outcome.ledgerUnchanged!==true||
   outcome.oneMessageCollageVerified!==true||
   outcome.oneTapCallbackVerified!==true)
  throw Error('VIDEO_INPLACE_EDIT_NOT_VERIFIED');
 if(!outcome.freePreviewFullyRemoved)process.exitCode=4;
}finally{await network.close();await pool.end()}
