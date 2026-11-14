import test from 'node:test';
import assert from 'node:assert/strict';
import {scanBoardBatch} from '../src/batch.js';
import {Api} from '../src/api.js';
const boards=Array.from({length:19},(_,i)=>({boardId:String(i)}));
const storage=()=>{const data=new Map();return {get:async k=>data.get(k),put:async(k,v)=>data.set(k,v)};};
test('all boards share one 40-request budget and later boards resume next scan',async()=>{
 const store=storage(),seen=new Set();
 for(let run=0;run<2;run++){
  const api=new Api({},async()=>({ok:true,json:async()=>({})}));
  const batch=await scanBoardBatch(boards,store,async b=>{
   for(let j=0;j<3;j++)await api.request('https://example.com');
   seen.add(b.boardId);return {boardId:b.boardId};
  });
  assert.ok(api.calls<=40);assert.equal(batch.batched,true);
 }
 assert.equal(seen.size,19);
});
test('interrupted board is retried before moving on',async()=>{
 const store=storage();let blocked=true;
 const scan=async b=>{if(b.boardId==='1'&&blocked){const e=new Error('budget');e.code='BATCH_LIMIT';throw e;}return b;};
 assert.equal((await scanBoardBatch(boards.slice(0,3),store,scan)).reports.length,1);
 blocked=false;const next=await scanBoardBatch(boards.slice(0,3),store,scan);
 assert.deepEqual(next.reports.map(b=>b.boardId),['1','2','0']);
});
test('a returned board failure does not starve other boards',async()=>{
 const result=await scanBoardBatch(boards.slice(0,3),storage(),async b=>({boardId:b.boardId,failed:b.boardId==='0'}));
 assert.equal(result.reports.length,3);assert.equal(result.batched,false);
});
