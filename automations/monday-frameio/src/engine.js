export function linkValue(item, columnId) {
  const column = item.column_values.find(c => c.id === columnId);
  if (!column) throw new Error('Configured Frame.io column missing');
  if (!column.value) return null;
  const value = typeof column.value === 'string' ? JSON.parse(column.value) : column.value;
  return value?.url || (column.text ? column.text : null);
}
export function monthPath(date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {timeZone:'Europe/London', year:'numeric',month:'2-digit'}).formatToParts(date).map(p=>[p.type,p.value]));
  const names = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  return [parts.year, `${parts.month} - ${names[Number(parts.month)-1]}`];
}
export function folderName(name) {
  const clean = name.normalize('NFC').replace(/[\u0000-\u001f\u007f/\\]/g,' ').replace(/\s+/g,' ').trim().slice(0,180);
  if (!clean || /^(new item|item)$/i.test(clean)) throw new Error('Concept needs a name');
  return clean;
}

export class Engine {
  constructor(api, store, board, now = () => new Date()) { Object.assign(this,{api,store,board,now}); }
  async ensure(parent, name, key, shared = false) {
    const saved = await this.store.get(key);
    if (saved?.id) return saved;
    const children = await this.api.children(parent);
    const matches = children.filter(c => c.type === 'folder' && (c.name === (saved?.name || name) || (shared && !saved?.pending && /^\d{2} - /.test(name) && c.name.startsWith(name.slice(0,5)))));
    if (matches.length > 1) throw new Error('Ambiguous folder name');
    if (matches.length && (shared || saved?.pending)) {
      await this.store.put(key,matches[0]); return matches[0];
    }
    // Never silently bind two distinct Monday concepts to the same named folder.
    if (matches.length) throw new Error('Folder name already exists; link it manually or rename the concept');
    if (saved?.pending) throw new Error('Uncertain folder creation: check Frame.io before resetting the pending record');
    this.api.checkBudget?.();
    await this.store.put(key,{pending:true,name,parent});
    const folder = await this.api.createFolder(parent,name);
    if (!folder?.id || !folder.view_url) throw new Error('Frame folder response incomplete');
    await this.store.put(key,folder); return folder;
  }
  async provision(item) {
    const key = `item:${item.id}`;
    let record = await this.store.get(key);
    if (record?.linked) {
      // Repair previously provisioned pilot folders without touching their existing link or Edits.
      if (!record.rawId) {
        const raw = await this.ensure(record.folderId,'Raw',`${key}:raw`,true);
        record = {...record,rawId:raw.id};
        await this.store.put(key,record);
      }
      return record;
    }
    if (linkValue(item,this.board.linkColumnId)) return null;
    if (!record) {
      const name = folderName(item.name);
      record = {id:item.id,name,month:monthPath(this.now()),createdAt:this.now().toISOString()};
      await this.store.put(key,record);
    }
    let parent = this.board.contentFolderId;
    for (const segment of record.month) {
      const folder = await this.ensure(parent,segment,`shared:${parent}:${segment}`,true);
      parent = folder.id;
    }
    const concept = await this.ensure(parent,record.name,`${key}:concept`);
    const raw = await this.ensure(concept.id,'Raw',`${key}:raw`,true);
    const edits = await this.ensure(concept.id,'Edits',`${key}:edits`,true);
    // Re-read just before write: the debrief workflow might have populated the link.
    const current = await this.api.item(item.id);
    const existing = linkValue(current,this.board.linkColumnId);
    if (existing && existing !== concept.view_url) throw new Error('Frame.io link changed; reconciliation needed');
    if (!existing) await this.api.link(this.board,item.id,concept.view_url);
    record = {...record,linked:true,folderId:concept.id,rawId:raw.id,editsId:edits.id,url:concept.view_url};
    await this.store.put(key,record);
    return record;
  }
  async run() {
    let startedAt = await this.store.get('startedAt');
    if (!startedAt) { startedAt = this.now().toISOString(); await this.store.put('startedAt',startedAt); }
    if(this.board.activationCutoff && Date.parse(this.board.activationCutoff)>Date.parse(startedAt))startedAt=this.board.activationCutoff;
    const failures = [];
    for await (const item of this.api.items(this.board)) {
      if(this.board.testItemId && item.id!==this.board.testItemId)continue;
      // A persisted activation boundary prevents accidental historical backfill.
      if (!item.created_at || Date.parse(item.created_at) < Date.parse(startedAt)) continue;
      // Give the debrief integration two minutes to finish writing its own link.
      if (this.now().getTime() - Date.parse(item.created_at) < 120000) continue;
      try {
        await this.provision(item);
        await this.store.delete(`error:${item.id}`);
      } catch (error) {
        if (error.code === 'BATCH_LIMIT') throw error;
        await this.store.put(`error:${item.id}`,{message:error.message,at:this.now().toISOString()});
        failures.push(item.id);
      }
    }
    // The existing 10Ten Bot handles all review messages and editor/reviewer tags.
    // This service only creates folders and writes Monday links.
    return {failed:[...new Set(failures)].length};
  }
}
