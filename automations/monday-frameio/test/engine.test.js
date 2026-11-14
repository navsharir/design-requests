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
  assert.equal(f.count,5); assert.ok(r.linked); assert.ok(r.editsId);
  await f.engine.provision(f.item); assert.equal(f.count,5);
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
test('activation boundary excludes historical items',async()=>{
  const f=fixture(); await f.engine.run(); assert.equal(f.count,0); assert.equal(await f.store.get('startedAt'),now().toISOString());
});
test('one failed concept does not block subsequent concepts',async()=>{
  const f=fixture(); await f.store.put('startedAt','2026-11-14T10:00:00Z');
  const bad={...f.item,id:'bad',name:'Item'};
  f.api.items=async function*(){yield bad;yield f.item;};
  const result=await f.engine.run(); assert.equal(result.failed,1); assert.equal(f.count,5);
});
test('batch limit before a write does not leave an uncertain pending record',async()=>{
  const f=fixture(); f.api.checkBudget=()=>{const e=new Error('batch');e.code='BATCH_LIMIT';throw e;};
  await assert.rejects(()=>f.engine.ensure('content','2026','year',true),e=>e.code==='BATCH_LIMIT');
  assert.equal(await f.store.get('year'),undefined); assert.equal(f.count,0);
});

test('reuses an existing month with a full month name',async()=>{
  const f=fixture(); const existing=await f.api.createFolder('content','11 - November');
  const month=await f.engine.ensure('content','11 - NOV','month',true);
  assert.equal(month.id,existing.id);assert.equal(f.count,1);
});
test('folder-only mode never calls the Slack review path',async()=>{
  const f=fixture();await f.store.put('startedAt','2026-11-14T10:00:00Z');
  f.engine.board={...board,reviewEnabled:false};
  f.engine.review=async()=>{throw new Error('must not review');};
  assert.deepEqual(await f.engine.run(),{failed:0});assert.equal(f.api.posts,0);
});
test('pilot allowlist leaves unrelated new items unchanged',async()=>{
  const f=fixture();await f.store.put('startedAt','2026-11-14T10:00:00Z');
  f.engine.board={...board,testItemId:'other',reviewEnabled:false};
  await f.engine.run();assert.equal(f.count,0);assert.equal(f.item.column_values[0].value,null);
});


test('repairs Raw on an already-linked pilot without duplicating Edits or rewriting Monday',async()=>{
 const f=fixture();const r=await f.engine.provision(f.item);
 assert.ok(r.rawId);assert.equal(f.folders.get(r.folderId).filter(x=>x.name==='Raw').length,1);
 const legacy={...r};delete legacy.rawId;await f.store.put('item:one',legacy);
 f.api.link=async()=>{throw new Error('must not rewrite link');};
 const repaired=await f.engine.provision(f.item);
 assert.equal(repaired.rawId,r.rawId);assert.equal(f.count,5);
});

test('adds a genuinely missing Raw folder to the existing linked pilot',async()=>{
 const f=fixture();const concept=await f.api.createFolder('content','Existing pilot');
 const edits=await f.api.createFolder(concept.id,'Edits');
 await f.store.put('item:one',{id:'one',name:f.item.name,linked:true,folderId:concept.id,editsId:edits.id,url:concept.view_url});
 f.item.column_values[0].value=JSON.stringify({url:concept.view_url});
 f.api.link=async()=>{throw new Error('must not rewrite Monday');};
 const r=await f.engine.provision(f.item);assert.ok(r.rawId);
 assert.deepEqual(f.folders.get(concept.id).map(x=>x.name).sort(),['Edits','Raw']);
 await f.engine.provision(f.item);assert.equal(f.count,3);
});
