const EVENTS = new Set(['bot.started','bot.stopped','bot.error','bot.recovered','bot.request.completed','bot.request.failed','bot.update.received','bot.delivery.completed','bot.delivery.failed']);
const BOTS = new Set(['create-videobot']);
export function normalizeBotEvent(value) {
  if (!value || !BOTS.has(value.bot) || !EVENTS.has(value.event)) throw new Error('invalid bot event');
  if (typeof value.event_id !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(value.event_id)) throw new Error('invalid event id');
  if (value.level !== undefined && !['info','warn','error'].includes(value.level)) throw new Error('invalid level');
  if (value.outcome !== undefined && !['PASS','FAIL','RETRY','SKIP'].includes(value.outcome)) throw new Error('invalid outcome');
  if (value.outcome==='FAIL' && value.level==='info') throw new Error('failed operations require warning or error');
  if (value.error_code !== undefined && (typeof value.error_code !== 'string' || !/^[A-Z][A-Z0-9_]{0,47}$/.test(value.error_code))) throw new Error('invalid error code');
  const result = {bot:value.bot,event_id:value.event_id,event:value.event};
  for (const field of ['level','outcome','error_code']) if (value[field]!==undefined) result[field] = value[field];
  return result;
}
/** The calling app must use an authenticated, private Gserver network endpoint; public addresses are forbidden by deployment policy. */
export async function postGserverEvent({event,baseUrl,token,fetchImpl=globalThis.fetch,timeoutMs=3000}) {
  const payload=normalizeBotEvent(event);
  if (typeof baseUrl!=='string' || !baseUrl || /[?#]/.test(baseUrl)) throw new Error('invalid Gserver address');
  const url=new URL(baseUrl);
  if (!['http:','https:'].includes(url.protocol) || url.username || url.password || url.pathname!=='/' || !url.hostname) throw new Error('invalid Gserver address');
  if (typeof token!=='string' || token.length<20 || /[\r\n]/.test(token)) throw new Error('Bot-only token unavailable');
  if (!Number.isSafeInteger(timeoutMs)||timeoutMs<100||timeoutMs>10000) throw new Error('invalid timeout');
  const response=await fetchImpl(new URL('/bot/events',url).href,{
    method:'POST',
    headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},
    body:JSON.stringify(payload),
    signal:AbortSignal.timeout(timeoutMs),
    redirect:'error'
  });
  // Do not return response body: may contain identifiers or credentials.
  if (response.status===202) return {acceptedLocally:true,remoteDelivered:false};
  if ([401,403,409,422,503].includes(response.status)) return {acceptedLocally:false,remoteDelivered:false,status:response.status};
  throw new Error('Gserver transport failed');
}
