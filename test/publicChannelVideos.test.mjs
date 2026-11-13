import test from 'node:test';
import assert from 'node:assert/strict';
import {createPublicChannelVideoCollector} from '../src/collection/publicChannelVideos.mjs';
import {createPostgresPublicChannelVideoCatalog} from '../src/collection/pgPublicChannelVideos.mjs';

test('collects joined public videos through resident IPC and never visits private channels',async()=>{
  const calls=[];
  const collector=createPublicChannelVideoCollector({
    residentUserbot:{
      async listJoinedPublicChannels(){return [{id:123,username:'publicChannel',title:'Public',isPublic:true},{id:345,isPublic:false}];},
      async listChannelVideos(args){calls.push(['list',args.channelId]);return [{messageId:77,kind:'video',caption:'sample'}];},
      async downloadVideo(args){calls.push(['download',args.channelId,args.messageId]);return {storageKey:'files/77.mp4'};}
    },
    catalog:{async hasDownload(){return false;},async recordDownload(v){calls.push(['record',v.messageId]);return {inserted:true};}}
  });
  assert.deepEqual(await collector.collectOnce(),{channels:1,downloaded:1,alreadyPresent:0,failed:0});
  assert.deepEqual(calls,[['list',123],['download',123,77],['record',77]]);
});
test('requires resident port, not a second Telegram session',()=>{
  assert.throws(()=>createPublicChannelVideoCollector({residentUserbot:{},catalog:{recordDownload(){},hasDownload(){}}}),/RESIDENT_USERBOT_PORT_UNAVAILABLE/);
});
test('catalog uses idempotent channel and message key',async()=>{
  let statement='';
  const catalog=createPostgresPublicChannelVideoCatalog({async query(sql){statement=sql;return {rowCount:0,rows:[]};}});
  assert.deepEqual(await catalog.recordDownload({channelId:1,channelUsername:'publicA',channelTitle:'A',messageId:2,storageKey:'a'}),{inserted:false});
  assert.match(statement,/ON CONFLICT \(channel_id,message_id\) DO NOTHING/);
});
