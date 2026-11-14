import { timingSafeEqual } from 'node:crypto';
export function verifyTelegramWebhookHeader(actual, expected) {
 if(typeof expected!=='string'||expected.length<20||typeof actual!=='string') throw new Error('webhook authorization unavailable');
 const a=Buffer.from(actual),b=Buffer.from(expected);
 if(a.length!==b.length || !timingSafeEqual(a,b)) throw new Error('webhook authorization failed');
 return true;
}
export function validateTelegramUpdateSize(raw, maxBytes=262144) {
 if(!Buffer.isBuffer(raw) || raw.length===0||raw.length>maxBytes) throw new Error('invalid Telegram webhook body');
 let data;try {data=JSON.parse(raw.toString('utf8'));}catch {throw new Error('invalid Telegram JSON');}
 if(!Number.isSafeInteger(data?.update_id)) throw new Error('invalid Telegram update id');
 return data;
}
