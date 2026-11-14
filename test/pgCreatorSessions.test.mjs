import test from 'node:test';
import assert from 'node:assert/strict';
import {createPostgresCreatorSessionStore} from '../src/sales/pgCreatorSessions.mjs';

function mockPool(){
  const data=new Map();
  return {data,async query(sql,params){
    const key=params[0],row=data.get(key);
    if(sql.startsWith('SELECT revision')){
      return {rowCount:row?1:0,rows:row?[{revision:row.revision,screen_message_id:row.screen,state:row.data}]:[]};
    }
    if(sql.startsWith('INSERT INTO videobot_creator_sessions')){
      if(row)return {rowCount:0,rows:[]};
      data.set(key,{revision:params[1],screen:params[2],data:JSON.parse(params[3])});
      return {rowCount:1,rows:[{revision:params[1]}]};
    }
    if(sql.startsWith('UPDATE videobot_creator_sessions SET revision=')){
      if(!row||row.revision!==params[4])return {rowCount:0,rows:[]};
      data.set(key,{revision:params[1],screen:params[2],data:JSON.parse(params[3])});
      return {rowCount:1,rows:[{revision:params[1]}]};
    }
    if(sql.startsWith('UPDATE videobot_creator_sessions SET screen_message_id=')){
      if(!row||row.revision!==params[1])return {rowCount:0,rows:[]};
      row.screen=params[2];return {rowCount:1,rows:[{owner_user_id:key}]};
    }
    throw new Error('unexpected SQL');
  }};
}
test('VideoBot creator sessions survive re-instantiation using same durable DB',async()=>{
  const pool=mockPool();
  const a=createPostgresCreatorSessionStore(pool);
  await a.write(123,0,{revision:1,screenMessageId:55,waiting:'title',draft:{mode:'create',title:'開発中'}});
  const b=createPostgresCreatorSessionStore(pool);
  assert.deepEqual(await b.read(123),{revision:1,screenMessageId:55,waiting:'title',draft:{mode:'create',title:'開発中'}});
  await b.write(123,1,{revision:2,screenMessageId:55,waiting:null,draft:{mode:'create',title:'完成'}});
  await b.setScreen(123,2,66);
  assert.equal((await a.read(123)).screenMessageId,66);
  assert.equal((await a.read(123)).draft.title,'完成');
});
test('stale callback revisions cannot overwrite preserved draft',async()=>{
  const s=createPostgresCreatorSessionStore(mockPool());
  await s.write(123,0,{revision:1,draft:{title:'alpha'}});
  await s.write(123,1,{revision:2,draft:{title:'beta'}});
  await assert.rejects(()=>s.write(123,1,{revision:2,draft:{title:'stale'}}),/REVISION_STALE/);
  await assert.rejects(()=>s.setScreen(123,1,8),/REVISION_STALE/);
  assert.equal((await s.read(123)).draft.title,'beta');
});
test('rejects fake owner, tampered revision and invalid message id',async()=>{
  const s=createPostgresCreatorSessionStore(mockPool());
  await assert.rejects(()=>s.read(-1),/creator ID/);
  await assert.rejects(()=>s.write(3,0,{revision:9}),/revision mismatch/);
  await assert.rejects(()=>s.setScreen(3,1,0),/message/);
});
