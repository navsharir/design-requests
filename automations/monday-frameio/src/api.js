const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export class Api {
  constructor(env, transport = fetch) { this.env = env; this.transport = transport; this.calls = 0; }
  checkBudget() {
    if (this.calls >= 40) { const error = new Error('Continue on next scheduled batch'); error.code = 'BATCH_LIMIT'; throw error; }
  }
  async request(url, options = {}) {
    this.checkBudget(); this.calls++;
    // Do not retry writes: a lost response does not mean the write failed.
    const res = await this.transport(url, {...options, signal: AbortSignal.timeout(20000)});
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }
  async monday(query, variables) {
    const json = await this.request('https://api.monday.com/v2', {
      method: 'POST', headers: {'Content-Type': 'application/json', Authorization: this.env.MONDAY_TOKEN, 'API-Version': '2026-10'},
      body: JSON.stringify({query, variables})
    });
    if (json.errors?.length || !json.data) throw new Error('Monday API rejected request');
    return json.data;
  }
  async *items(board) {
    const fields = 'id name created_at column_values { id value text }';
    let page = (await this.monday(`query($ids:[ID!]!) { boards(ids:$ids) { items_page(limit:100) { cursor items { ${fields} } } } }`, {ids:[board.boardId]})).boards?.[0]?.items_page;
    if (!page) throw new Error('Monday board unavailable');
    while (true) {
      yield* page.items;
      if (!page.cursor) break;
      page = (await this.monday(`query($cursor:String!) { next_items_page(limit:100,cursor:$cursor) { cursor items { ${fields} } } }`, {cursor:page.cursor})).next_items_page;
    }
  }
  async item(id) {
    const item = (await this.monday('query($ids:[ID!]!) { items(ids:$ids) { id name created_at column_values { id value text } } }', {ids:[id]})).items?.[0];
    if (!item) throw new Error('Monday item unavailable');
    return item;
  }
  async link(board, itemId, url) {
    await this.monday('mutation($board:ID!,$item:ID!,$values:JSON!) { change_multiple_column_values(board_id:$board,item_id:$item,column_values:$values) { id } }', {
      board:board.boardId, item:itemId, values:JSON.stringify({[board.linkColumnId]:{url,text:'Frame.io'}})
    });
  }
  async frame(path, options = {}) {
    await sleep(650); // Stay below folder-create and folder-list limits.
    return this.request(`https://api.frame.io/v4/accounts/${encodeURIComponent(this.env.FRAME_ACCOUNT_ID)}/${path}`, {
      ...options, headers:{Authorization:`Bearer ${this.env.FRAME_TOKEN}`, 'Content-Type':'application/json'}
    });
  }
  async children(folderId) {
    const all = []; let path = `folders/${encodeURIComponent(folderId)}/children?page_size=100`;
    const visited = new Set();
    while (path) {
      if (visited.has(path)) throw new Error('Frame pagination loop');
      visited.add(path);
      const page = await this.frame(path); all.push(...page.data);
      if (!page.links?.next) break;
      const next = new URL(page.links.next, 'https://api.frame.io');
      const prefix = `/v4/accounts/${encodeURIComponent(this.env.FRAME_ACCOUNT_ID)}/`;
      if (next.origin !== 'https://api.frame.io' || !next.pathname.startsWith(prefix)) throw new Error('Unexpected Frame pagination URL');
      path = next.pathname.slice(prefix.length) + next.search;
    }
    return all;
  }
  async createFolder(parent, name) {
    return (await this.frame(`folders/${encodeURIComponent(parent)}/folders`, {method:'POST',body:JSON.stringify({data:{name}})})).data;
  }
  async complete(fileId) { return (await this.frame(`files/${encodeURIComponent(fileId)}/status`)).data.upload_complete === true; }
  async versions(id) {
    const result = await this.frame(`version_stacks/${encodeURIComponent(id)}`);
    return result.data;
  }
  async post(channel, text) {
    const result = await this.request('https://slack.com/api/chat.postMessage', {method:'POST',
      headers:{Authorization:`Bearer ${this.env.SLACK_TOKEN}`,'Content-Type':'application/json'},
      body:JSON.stringify({channel,text,unfurl_links:false,unfurl_media:false})});
    if (!result.ok) throw new Error('Slack rejected message');
    return result.ts;
  }
}
