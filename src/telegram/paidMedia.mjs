/** Only builds Telegram Bot API sendPaidMedia parameters; caller must enforce verified GATE membership and operator approval. */
export function buildPaidMediaRequest({chatId,mediaFileId,priceStars,caption=''}) {
 if(!Number.isSafeInteger(chatId)||chatId===0) throw new Error('invalid chat');
 if(typeof mediaFileId!=='string'||!mediaFileId.trim()) throw new Error('invalid media');
 if(!Number.isSafeInteger(priceStars)||priceStars<1||priceStars>1000000) throw new Error('invalid Stars price');
 if(typeof caption!=='string'||caption.length>1024) throw new Error('invalid caption');
 return {chat_id:chatId,star_count:priceStars,media:[{type:'video',media:mediaFileId}],...(caption?{caption}:{})};
}
export async function sendPaidVideo({telegramApi,gateVerified,approved,params}) {
 if(gateVerified!==true||approved!==true) throw new Error('GATE verification and approval required');
 if(typeof telegramApi!=='function') throw new Error('Telegram adapter missing');
 return telegramApi('sendPaidMedia',buildPaidMediaRequest(params));
}
