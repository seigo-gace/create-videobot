import http from 'node:http';
import { once } from 'node:events';

/**
 * Private HTTP adapter for the existing Creator webhook admission.
 * A trusted HTTPS ingress must terminate TLS and route exactly the POST path.
 * Never expose this listener directly on the public Internet.
 */
export function createCreatorHttpService({
  handleTelegramWebhook,readiness=async()=>true,
  host='127.0.0.1',port=8766,
  path='/telegram/creator',maxBytes=262144
}={}) {
  if(typeof handleTelegramWebhook!=='function'||
     typeof readiness!=='function'||
     typeof host!=='string'|| !['127.0.0.1','::1','0.0.0.0'].includes(host)||
     !Number.isSafeInteger(port)||port<0||port>65535||
     path!=='/telegram/creator'||
     !Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>262144)
    throw new Error('invalid Creator HTTP ingress configuration');

  const server=http.createServer(async(req,res)=>{
    function answer(status,message) {
      if(res.headersSent || res.destroyed)return;
      res.writeHead(status,{
        'content-type':'application/json; charset=utf-8',
        'cache-control':'no-store',
        'x-content-type-options':'nosniff'
      });
      res.end(JSON.stringify({ok:status===200,status:message}));
    }
    const pathname=req.url?.split('?')[0];
    if(req.method==='GET'&&pathname==='/healthz'){
      req.resume();return answer(200,'alive');
    }
    if(req.method==='GET'&&pathname==='/readyz'){
      req.resume();
      try {return answer(await readiness()===true?200:503,'readiness');}
      catch {return answer(503,'readiness');}
    }
    if(req.method!=='POST'||pathname!==path){
      req.resume();return answer(404,'not-found');
    }
    const header=req.headers['x-telegram-bot-api-secret-token'];
    if(typeof header!=='string'||header.length<20||header.length>256||
       /[^A-Za-z0-9_-]/.test(header)){
      req.resume();return answer(401,'unauthorized');
    }
    const pieces=[];
    let length=0;
    try {
      for await (const chunk of req){
        length+=chunk.length;
        if(length>maxBytes){return answer(413,'too-large');}
        pieces.push(chunk);
      }
      if(length===0)return answer(400,'invalid-update');
      await handleTelegramWebhook({secretHeader:header,body:Buffer.concat(pieces,length)});
      return answer(200,'accepted');
    } catch(error) {
      // No private update, token, SQL or buyer details in HTTP replies.
      if(/webhook authorization failed/i.test(error?.message||'')){
        return answer(401,'unauthorized');
      }
      if(/invalid Telegram JSON|invalid Telegram update/i.test(error?.message||'')){
        return answer(400,'invalid-update');
      }
      return answer(503,'processing-unavailable');
    }
  });
  return Object.freeze({
    async listen(){
      if(server.listening)throw new Error('Creator HTTP already listening');
      server.listen({host,port});
      await once(server,'listening');
      const addr=server.address();
      return Object.freeze({host:addr.address,port:addr.port,path});
    },
    async close(){
      if(!server.listening)return;
      await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
    },
    server
  });
}
