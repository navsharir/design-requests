import {DurableObject} from 'cloudflare:workers';
import {Api} from './api.js';
import {Engine} from './engine.js';
import {frameAccessToken} from './frame-auth.js';
import {setup} from './setup.js';

function boards(env) {
  const list = JSON.parse(env.BOARD_MAP || '[]');
  if (!Array.isArray(list) || !list.length) throw new Error('Configure BOARD_MAP');
  for (const b of list) for (const key of ['boardId','linkColumnId','contentFolderId','slackChannelId']) {
    if (typeof b[key] !== 'string' || !b[key]) throw new Error(`Missing board setting: ${key}`);
  }
  return list;
}
export default {
  async fetch(request,env) {
    if(new URL(request.url).pathname.startsWith('/setup')) return env.BOARDS.getByName('sync-v1').fetch(request);
    if(new URL(request.url).pathname==='/health')return env.BOARDS.getByName('sync-v1').fetch('https://internal/status');
    return Response.json({service:'Monday → Frame.io folders'});
  },
  async scheduled(_event, env, ctx) {
    if (env.ENABLED !== 'true') return;
    for (const key of ['MONDAY_TOKEN','FRAME_ACCOUNT_ID']) if (!env[key]) throw new Error(`Missing secret: ${key}`);
    if (!env.FRAME_TOKEN && !(env.FRAME_CLIENT_ID && env.FRAME_CLIENT_SECRET)) throw new Error('Connect Frame.io OAuth');
    // All boards share one object so shared parent folders cannot race each other.
    boards(env);
    ctx.waitUntil(env.BOARDS.getByName('sync-v1').fetch('https://internal/tick'));
  }
};
export class BoardSync extends DurableObject {
  async fetch(request) {
    if(new URL(request.url).pathname.startsWith('/setup'))return setup(request,this.env,this.ctx.storage,fetch,Date.now,()=>this.runOnce());
    if(new URL(request.url).pathname==='/status')return Response.json({enabled:this.env.ENABLED==='true',mode:'folders-only',lastRun:await this.ctx.storage.get('lastRun'),lastRunOk:await this.ctx.storage.get('lastRunOk')},{headers:{'Cache-Control':'no-store'}});
    return this.runOnce();
  }
  async runOnce() {
    if (this.running) return Response.json({busy:true});
    this.running = true;
    try {
      const reports=[];
      for (const board of boards(this.env)) {
        const prefix = `board:${board.boardId}:`;
        const storage = this.ctx.storage;
        const store = {
          get:key=>storage.get(prefix+key), put:(key,value)=>storage.put(prefix+key,value), delete:key=>storage.delete(prefix+key),
          list:async ({prefix:p})=>{
            const all = new Map(); let startAfter;
            while (true) {
              const page = await storage.list({prefix:prefix+p,limit:1000,...(startAfter ? {startAfter} : {})});
              for (const [key,value] of page) all.set(key.slice(prefix.length),value);
              if (page.size < 1000) return all;
              startAfter = [...page.keys()].at(-1);
            }
          }
        };
        try {
          const api = new Api(this.env);
          const authStore = {get:k=>storage.get(k),put:(k,v)=>storage.put(k,v)};
          api.tokenProvider=()=>{api.checkBudget();return frameAccessToken(this.env,authStore,(...args)=>api.request(...args));};
          board.testItemId=this.env.TEST_ITEM_ID;
          board.activationCutoff=this.env.ACTIVATED_AT;
          const result = await new Engine(api,store,board).run();
          if(board.testItemId){const test=await api.item(board.testItemId);result.test={createdAt:test.created_at,startedAt:await store.get('startedAt'),linked:test.column_values.find(c=>c.id===board.linkColumnId)?.value};}
          console.log(JSON.stringify({boardId:board.boardId,...result}));
          const errors=await storage.list({prefix:prefix+'error:',limit:20});
          reports.push({boardId:board.boardId,...result,errors:[...errors].map(([key,value])=>({itemId:key.slice((prefix+'error:').length),message:value.message}))});
        } catch (error) {
          if (error.code === 'BATCH_LIMIT') { console.log(JSON.stringify({boardId:board.boardId,batched:true})); reports.push({boardId:board.boardId,batched:true});continue; }
          await storage.put(prefix+'lastError',{message:error.message,at:new Date().toISOString()});
          console.error(JSON.stringify({boardId:board.boardId,failed:true}));
          reports.push({boardId:board.boardId,failed:true,message:error.message});
        }
      }
      await this.ctx.storage.put('lastRun',new Date().toISOString());
      await this.ctx.storage.put('lastRunOk',reports.every(r=>!r.failed));
      return Response.json({ok:reports.every(r=>!r.failed),boards:reports},{headers:{'Cache-Control':'no-store'}});
    } finally { this.running = false; }
  }
}
