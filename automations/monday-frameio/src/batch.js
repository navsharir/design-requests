// One shared API budget per invocation; resume the interrupted board next time.
export async function scanBoardBatch(boards,store,scan) {
  const cursor=await store.get('nextBoard');
  const start=Math.max(0,boards.findIndex(b=>b.boardId===cursor));
  const ordered=[...boards.slice(start),...boards.slice(0,start)];
  const reports=[];
  for(const board of ordered) {
    try { reports.push(await scan(board)); }
    catch(error) {
      if(error.code!=='BATCH_LIMIT')throw error;
      await store.put('nextBoard',board.boardId);
      return {reports,batched:true};
    }
    const index=boards.findIndex(b=>b.boardId===board.boardId);
    await store.put('nextBoard',boards[(index+1)%boards.length].boardId);
  }
  return {reports,batched:false};
}
