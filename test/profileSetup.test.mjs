import test from 'node:test';
import assert from 'node:assert/strict';
import {applyProfile,plannedProfile} from '../src/telegram/profileSetup.mjs';
test('refuses wrong bot identity without writes',async()=>{
 let writes=0; const api=async m=>{if(m.startsWith('set'))writes++;return {username:'other_bot',is_bot:true}};
 await assert.rejects(()=>applyProfile({api,expectedUsername:'@video_shop_bot',confirmChange:true}));
 assert.equal(writes,0);
});
test('defaults to read-only preview',async()=>{
 let writes=0;
 const api=async m=>{if(m==='getMe')return {username:'video_shop_bot',is_bot:true};if(m.startsWith('set'))writes++;if(m==='getMyCommands')return [];return {name:'',description:'',short_description:''}};
 const r=await applyProfile({api,expectedUsername:'@video_shop_bot'});
 assert.equal(r.applied,false);assert.equal(writes,0);assert.ok(r.desired.description);
});
test('explicit update verifies all new fields',async()=>{
 let current={name:'',description:'',short_description:'',commands:[]};
 const api=async(m,p)=>{if(m==='getMe')return {username:'video_shop_bot',is_bot:true};
  if(m.startsWith('set')){const key={setMyName:'name',setMyDescription:'description',setMyShortDescription:'short_description',setMyCommands:'commands'}[m];current[key]=p[key];return true;}
  const key={getMyName:'name',getMyDescription:'description',getMyShortDescription:'short_description',getMyCommands:'commands'}[m];
  return key==='commands'?current.commands:{[key]:current[key]};};
 const r=await applyProfile({api,expectedUsername:'@video_shop_bot',confirmChange:true});
 assert.equal(r.applied,true);assert.deepEqual(r.verified,plannedProfile());
});
