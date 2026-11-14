import test from 'node:test';
import assert from 'node:assert/strict';
import {Api} from '../src/api.js';
test('Frame pagination follows every next page',async()=>{
  const api=new Api({FRAME_ACCOUNT_ID:'account'}); let count=0;
  api.frame=async()=>++count===1?{data:[{id:'a'}],links:{next:'/v4/accounts/account/folders/f/children?after=x'}}:{data:[{id:'b'}],links:{}};
  assert.deepEqual((await api.children('f')).map(x=>x.id),['a','b']);
});
test('Frame pagination rejects a different account or host',async()=>{
  const api=new Api({FRAME_ACCOUNT_ID:'account'});
  api.frame=async()=>({data:[],links:{next:'https://example.com/collect'}});
  await assert.rejects(()=>api.children('f'),/Unexpected/);
});
test('Monday GraphQL errors stop work even when HTTP succeeds',async()=>{
  const api=new Api({});api.request=async()=>({errors:[{message:'secret details'}]});
  await assert.rejects(()=>api.monday('query {}',{}),/Monday API rejected/);
});
test('write timeout is not automatically retried',async()=>{
  let attempts=0; const api=new Api({},async()=>{attempts++;throw new Error('timeout');});
  await assert.rejects(()=>api.post('channel','text')); assert.equal(attempts,1);
});
