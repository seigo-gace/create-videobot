import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyCreateVdoBot} from '../src/telegram/identityCheck.mjs';
import {plannedProfile} from '../src/telegram/profileSetup.mjs';
test('identity and profile pass for verified matching bot',async()=>{
 const p=plannedProfile(), api=async method=>{
  if(method==='getMe')return {is_bot:true,username:'CreateVdobot'};
  if(method==='getMyCommands')return p.commands;
  if(method==='getMyName')return {name:p.name};
  if(method==='getMyDescription')return {description:p.description};
  if(method==='getMyShortDescription')return {short_description:p.short_description};
 };
 assert.deepEqual(await verifyCreateVdoBot({api}),{identityVerified:true,profileVerified:true});
});
test('refuse other bot before reading profile',async()=>{
 let count=0;
 await assert.rejects(()=>verifyCreateVdoBot({api:async()=>{count++;return {is_bot:true,username:'different_bot'}}}));
 assert.equal(count,1);
});
test('detect drift without modifying Telegram profile',async()=>{
 const api=async method=> method==='getMe'?{is_bot:true,username:'CreateVdobot'}:method==='getMyCommands'?[]:{name:'Different'};
 await assert.rejects(()=>verifyCreateVdoBot({api}),/profile drift/);
});
