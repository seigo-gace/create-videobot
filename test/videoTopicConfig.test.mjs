import test from 'node:test';
import assert from 'node:assert/strict';
import {configuredVideoSaleTopic} from '../owner/gateOwner.mjs';

test('creator video sale topic is explicit and never borrowed from sticker topic',()=>{
 const topic=configuredVideoSaleTopic({
  VIDEOBOT_VIDEO_SALE_THREAD_ID:'1234',
  VIDEOBOT_VIDEO_SALE_TOPIC_TITLE:'稼げる有料動画'
 });
 assert.equal(topic.chatId,-1002373696859);
 assert.equal(topic.threadId,1234);
 assert.equal(topic.id,1234);
 assert.equal(topic.purpose,'video_sale');
 assert.equal(topic.board,'video_chat');
});
test('no default to a URL or unconfigured video destination',()=>{
 for(const env of [{},{VIDEOBOT_VIDEO_SALE_THREAD_ID:'4672',
   VIDEOBOT_VIDEO_SALE_TOPIC_TITLE:''},{VIDEOBOT_VIDEO_SALE_THREAD_ID:'https://t.me/c/2373696859/1695',
   VIDEOBOT_VIDEO_SALE_TOPIC_TITLE:'動画'}]){
  assert.throws(()=>configuredVideoSaleTopic(env),/VIDEO_SALE_TOPIC_CONFIGURATION_MISSING/);
 }
});
