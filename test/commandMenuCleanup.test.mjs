import test from 'node:test';
import assert from 'node:assert/strict';
import {clearCreatorCommandMenu} from '../src/telegram/commandMenuCleanup.mjs';

test('legacy /start and /help lists are removed across global scopes and languages',async()=>{
 const calls=[];
 const api=async (method,params)=>{
  calls.push({method,params});
  if(method==='deleteMyCommands')return true;
  if(method==='getMyCommands')return [];
  if(method==='setChatMenuButton')return true;
  if(method==='getChatMenuButton')return {type:'default'};
  throw Error('unexpected Telegram call');
 };
 const result=await clearCreatorCommandMenu(api);
 assert.deepEqual(result,{commandsEmpty:true,scopesVerified:12,menuButtonType:'default'});
 assert.equal(calls.filter(c=>c.method==='deleteMyCommands').length,12);
 assert.equal(calls.filter(c=>c.method==='getMyCommands').length,12);
 assert.deepEqual(calls.filter(c=>c.method==='setChatMenuButton').map(c=>c.params),
  [{menu_button:{type:'default'}}]);
 assert.equal(calls.length,26);
});
test('stale registered commands fail readback and stop incomplete reset',async()=>{
 const methods=[];
 const api=async method=>{
  methods.push(method);
  if(method==='deleteMyCommands')return true;
  if(method==='getMyCommands')return [{command:'help',description:'legacy'}];
  throw Error('unexpected');
 };
 await assert.rejects(clearCreatorCommandMenu(api),/CREATOR_COMMANDS_STILL_REGISTERED/);
 assert.deepEqual(methods,['deleteMyCommands','getMyCommands']);
});
test('Telegram commands menu UI may remain despite an empty command list',async()=>{
 const api=async method=>{
  if(method==='deleteMyCommands'||method==='setChatMenuButton')return true;
  if(method==='getMyCommands')return [];
  if(method==='getChatMenuButton')return {type:'commands'};
  throw Error('unexpected');
 };
 const result=await clearCreatorCommandMenu(api);
 assert.equal(result.commandsEmpty,true);
 assert.equal(result.menuButtonType,'commands');
});
