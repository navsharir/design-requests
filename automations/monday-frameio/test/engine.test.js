import test from 'node:test';
import assert from 'node:assert/strict';
import {Engine,monthPath,folderName,linkValue} from '../src/engine.js';

const board = {boardId:'123',linkColumnId:'frame',contentFolderId:'content',slackChannelId:'review'};
const now = () => new Date('2026-11-14T12:00:00Z');
function fixture() {
  const data = new Map(); const folders = new Map([['content',[]]]); let counter = 0;
  const store = {get:async k=>structuredClone(data.get(k)),put:async (k,v)=>data.set(k,structuredClone(v)),delete:async k=>data.delete(k),list:async ({prefix})=>new Map([...data].filter(([k])=>k.startsWith(prefix)))};
  const item = {id:'one',name:'New concept',created_at:'2026-11-14T11:00:00Z',column_values:[{id:'frame',value:null}]};
  const api = {
    async *items(){ yield item; }, item:async()=>structuredClone(item),
    children:async id=>structuredClone(folders.get(id)||[]),
    createFolder:async(parent,name)=> { const f={id:`f${++counter}`,name,type:'folder',view_url:`https://next.frame.io/project/project/f${counter}`}; folders.get(parent).push(f); folders.set(f.id,[]); return f; },
    link:async(_b,_id,url)=>{item.column_values[0].value=JSON.stringify({url});},
    complete:async()=>true, post:async()=>{api.posts++;return '123.456';}, posts:0
  };
  const engine = new Engine(api,store,board,now);
  return {engine,api,store,data,folders,item,get count(){return counter;}};
}
test('month uses London local time at a UTC month boundary',()=>{
  assert.deepEqual(monthPath(new Date('2026-03-31T23:30:00Z')),['2026','04 - APR']);
});
test('sanitize concept names and reject placeholder names',()=>{
  assert.equal(folderName(' Hello / world\n '),'Hello world');
  assert.throws(()=>folderName('New item'));
});
test('preserves existing debrief link',async()=>{
  const f=fixture(); f.item.column_values[0].value=JSON.stringify({url:'https://existing'});
  assert.equal(await f.engine.provision(f.item),null); assert.equal(f.count,0);
});
test('missing configured column fails rather than overwriting another column',()=>{
  assert.throws(()=>linkValue({column_values:[]},'frame'));
});
test('creates year/month/concept/Edits and writes Monday link once',async()=>{
  const f=fixture(); const r=await f.engine.provision(f.item);
  assert.equal(f.count,4); assert.ok(r.linked); assert.ok(r.editsId);
  await f.engine.provision(f.item); assert.equal(f.count,4);
  assert.equal(JSON.parse(f.item.column_values[0].value).url,r.url);
});
test('lost folder response recovers by exact saved name without creating twice',async()=>{
  const f=fixture(); const create=f.api.createFolder;
  f.api.createFolder=async(...args)=>{await create(...args);throw new Error('timeout');};
  await assert.rejects(()=>f.engine.ensure('content','2026','year',true));
  f.api.createFolder=create;
  const folder=await f.engine.ensure('content','2026','year',true);
  assert.equal(folder.id,'f1'); assert.equal(f.count,1);
});
test('uncertain create with no visible folder stops instead of risking duplicate',async()=>{
  const f=fixture(); await f.store.put('year',{pending:true,name:'2026'});
  await assert.rejects(()=>f.engine.ensure('content','2026','year',true),/Uncertain/);
  assert.equal(f.count,0);
});
test('same-name unrelated concept is not silently reused',async()=>{
  const f=fixture(); await f.api.createFolder('content','Existing concept');
  await assert.rejects(()=>f.engine.ensure('content','Existing concept','other'),/already exists/);
});
test('Monday link written during provisioning is preserved',async()=>{
  const f=fixture(); f.api.item=async()=>({...f.item,column_values:[{id:'frame',value:'{"url":"https://debrief"}'}]});
  await assert.rejects(()=>f.engine.provision(f.item),/link changed/);
  assert.equal(f.item.column_values[0].value,null);
});
test('month remains pinned across interrupted run and month rollover',async()=>{
  const f=fixture(); await f.store.put('item:one',{id:'one',name:'New concept',month:['2026','10 - OCT'],createdAt:'2026-10-31'});
  await f.engine.provision(f.item); assert.equal(f.folders.get('f1')[0].name,'10 - OCT');
});
test('only complete uploads post and repeated scans do not repost',async()=>{
  const f=fixture(); const r=await f.engine.provision(f.item);
  f.folders.get(r.editsId).push({id:'video',type:'file',name:'v1.mp4',view_url:'https://next.frame.io/project/p/view/video'});
  f.api.complete=async()=>false; await f.engine.review(r); assert.equal(f.api.posts,0);
  f.api.complete=async()=>true; await f.engine.review(r); await f.engine.review(r); assert.equal(f.api.posts,1);
});
test('lost Slack response is held for reconciliation and not sent twice',async()=>{
  const f=fixture(); const r=await f.engine.provision(f.item);
  f.folders.get(r.editsId).push({id:'video',type:'file',name:'v1.mp4',view_url:'https://next.frame.io/project/p/view/video'});
  f.api.post=async()=>{f.api.posts++;throw new Error('timeout');};
  await assert.rejects(()=>f.engine.review(r)); await assert.rejects(()=>f.engine.review(r),/Uncertain Slack/);
  assert.equal(f.api.posts,1);
});
test('new head version is reviewed separately',async()=>{
  const f=fixture(); const r=await f.engine.provision(f.item);
  f.folders.get(r.editsId).push({id:'stack',type:'version_stack'});
  let id='v1'; f.api.versions=async()=>({head_version:{id,type:'file',name:id,view_url:`https://next.frame.io/project/p/view/${id}`}});
  await f.engine.review(r); id='v2'; await f.engine.review(r); assert.equal(f.api.posts,2);
});
test('activation boundary excludes historical items',async()=>{
  const f=fixture(); await f.engine.run(); assert.equal(f.count,0); assert.equal(await f.store.get('startedAt'),now().toISOString());
});
test('one failed concept does not block subsequent concepts',async()=>{
  const f=fixture(); await f.store.put('startedAt','2026-11-14T10:00:00Z');
  const bad={...f.item,id:'bad',name:'Item'};
  f.api.items=async function*(){yield bad;yield f.item;};
  const result=await f.engine.run(); assert.equal(result.failed,1); assert.equal(f.count,4);
});
