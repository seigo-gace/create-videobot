import {Agent} from 'undici';

/**
 * CreateVdobot-only Telegram transport. On this Gserver host a direct IPv4
 * HTTPS client succeeds while Undici's default fetch connection times out.
 * This dispatcher is scoped to Bot API and private media requests, not global.
 */
export function createCreatorTelegramFetch(fetchImpl=globalThis.fetch) {
  if(typeof fetchImpl!=='function')throw Error('CREATOR_FETCH_PROVIDER_REQUIRED');
  const dispatcher=new Agent({connect:{family:4,timeout:20_000}});
  return Object.freeze({
    fetch:(url,init={})=>fetchImpl(url,{...init,dispatcher}),
    async close(){await dispatcher.close();}
  });
}
