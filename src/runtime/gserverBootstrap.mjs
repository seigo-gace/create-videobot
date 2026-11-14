import { runtimeConfig,readPrivateToken } from './config.mjs';
import { normalizeBotEvent,postGserverEvent } from '../integrations/gserverEvents.mjs';
import { randomUUID } from 'node:crypto';
const config=runtimeConfig();
const token=readPrivateToken(config.botTokenFile);
const event=normalizeBotEvent({bot:'create-videobot',event_id:randomUUID(),event:'bot.started',level:'info'});
// Diagnostic bootstrap only. Never contact Telegram or receive sales/purchase data.
const result=await postGserverEvent({event,baseUrl:config.gserverBaseUrl,token});
if(!result.acceptedLocally) throw new Error('Gserver local admission refused');
process.stdout.write('Gserver Bot event locally accepted; no Telegram runtime started\n');
