import {DurableObject} from 'cloudflare:workers';
import {Api} from './api.js';
import {Engine} from './engine.js';

function boards(env) {
  const list = JSON.parse(env.BOARD_MAP || '[]');
  if (!Array.isArray(list) || !list.length) throw new Error('Configure BOARD_MAP');
  for (const b of list) for (const key of ['boardId','linkColumnId','contentFolderId','slackChannelId']) {
    if (typeof b[key] !== 'string' || !b[key]) throw new Error(`Missing board setting: ${key}`);
  }
  return list;
}
export default {
  async fetch() { return Response.json({service:'Monday → Frame.io review automation'}); },
  async scheduled(_event, env, ctx) {
    if (env.ENABLED !== 'true') return;
    for (const key of ['MONDAY_TOKEN','FRAME_TOKEN','FRAME_ACCOUNT_ID','SLACK_TOKEN']) if (!env[key]) throw new Error(`Missing secret: ${key}`);
    // All boards share one object so shared parent folders cannot race each other.
    boards(env);
    ctx.waitUntil(env.BOARDS.getByName('sync-v1').fetch('https://internal/tick'));
  }
};
export class BoardSync extends DurableObject {
  async fetch() {
    if (this.running) return Response.json({busy:true});
    this.running = true;
    try {
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
          const result = await new Engine(new Api(this.env),store,board).run();
          console.log(JSON.stringify({boardId:board.boardId,...result}));
        } catch (error) {
          await storage.put(prefix+'lastError',{message:error.message,at:new Date().toISOString()});
          console.error(JSON.stringify({boardId:board.boardId,failed:true}));
        }
      }
      await this.ctx.storage.put('lastRun',new Date().toISOString());
      return Response.json({ok:true});
    } finally { this.running = false; }
  }
}
