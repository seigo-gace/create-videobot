import test from 'node:test';
import assert from 'node:assert/strict';
import {createCreatorTelegramFetch} from '../src/runtime/creatorEgress.mjs';

test('CreateVdobot Telegram fetch scopes an IPv4 dispatcher without changing request data',async()=>{
 const calls=[];
 const transport=createCreatorTelegramFetch(async(url,init)=>{
   calls.push({url,init});
   return {ok:true};
 });
 try{
   const body=new Uint8Array([1,2,3]);
   const reply=await transport.fetch('https://api.telegram.org/botTEST/getMe',{
     method:'POST',headers:{'content-type':'application/json'},body
   });
   assert.equal(reply.ok,true);
   assert.equal(calls.length,1);
   assert.equal(calls[0].url,'https://api.telegram.org/botTEST/getMe');
   assert.equal(calls[0].init.method,'POST');
   assert.strictEqual(calls[0].init.body,body);
   assert.equal(typeof calls[0].init.dispatcher.dispatch,'function');
 }finally{
   await transport.close();
 }
});

test('CreateVdobot Telegram fetch rejects missing provider',()=>{
 assert.throws(()=>createCreatorTelegramFetch(null),/CREATOR_FETCH_PROVIDER_REQUIRED/);
});
