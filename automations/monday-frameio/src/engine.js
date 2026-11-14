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
const escape = text => text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

export class Engine {
  constructor(api, store, board, now = () => new Date()) { Object.assign(this,{api,store,board,now}); }
  async ensure(parent, name, key, shared = false) {
    const saved = await this.store.get(key);
    if (saved?.id) return saved;
    const children = await this.api.children(parent);
    const matches = children.filter(c => c.type === 'folder' && c.name === (saved?.name || name));
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
    if (record?.linked) return record;
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
    const edits = await this.ensure(concept.id,'Edits',`${key}:edits`,true);
    // Re-read just before write: the debrief workflow might have populated the link.
    const current = await this.api.item(item.id);
    const existing = linkValue(current,this.board.linkColumnId);
    if (existing && existing !== concept.view_url) throw new Error('Frame.io link changed; reconciliation needed');
    if (!existing) await this.api.link(this.board,item.id,concept.view_url);
    record = {...record,linked:true,folderId:concept.id,editsId:edits.id,url:concept.view_url};
    await this.store.put(key,record);
    return record;
  }
  async review(record) {
    const assets = await this.api.children(record.editsId);
    for (let asset of assets) {
      if (asset.type === 'version_stack') {
        const stack = await this.api.versions(asset.id);
        asset = stack.head_version;
      }
      if (asset?.type !== 'file' || !asset.id) continue;
      const key = `sent:${record.id}:${asset.id}`;
      const previous = await this.store.get(key);
      if (previous?.sent) continue;
      // A lost Slack response must be checked by an operator, never auto-reposted.
      if (previous?.pending) throw new Error('Uncertain Slack delivery; inspect review channel and resolve pending record');
      if (!await this.api.complete(asset.id)) continue;
      if (!asset.view_url?.startsWith('https://next.frame.io/')) throw new Error('Missing Frame viewer link');
      const monday = `https://10tencreatives.monday.com/boards/${this.board.boardId}/pulses/${record.id}`;
      const text = `Edit ready for review: ${escape(record.name)}\n${escape(asset.name)}\n<${asset.view_url}|Review in Frame.io> · <${monday}|Open Monday item>`;
      this.api.checkBudget?.();
      await this.store.put(key,{pending:true,fileId:asset.id,at:this.now().toISOString()});
      const ts = await this.api.post(this.board.slackChannelId,text);
      await this.store.put(key,{sent:true,ts});
    }
  }
  async run() {
    let startedAt = await this.store.get('startedAt');
    if (!startedAt) { startedAt = this.now().toISOString(); await this.store.put('startedAt',startedAt); }
    const failures = [];
    for await (const item of this.api.items(this.board)) {
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
    // Continue monitoring already-linked concepts, including those moved off the board.
    const tracked = await this.store.list({prefix:'item:'});
    const reviewCursor = await this.store.get('reviewCursor');
    for (const [key,record] of tracked) {
      if (key.split(':').length !== 2 || !record.linked) continue;
      if (reviewCursor && key <= reviewCursor) continue;
      try { await this.review(record); }
      catch (error) {
        if (error.code === 'BATCH_LIMIT') throw error;
        await this.store.put(`error:${record.id}`,{message:error.message,at:this.now().toISOString()}); failures.push(record.id);
      }
      await this.store.put('reviewCursor',key);
    }
    await this.store.delete('reviewCursor');
    return {failed: [...new Set(failures)].length};
  }
}
