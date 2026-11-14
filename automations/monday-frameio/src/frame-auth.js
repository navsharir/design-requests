// Adobe access tokens expire. Persist refreshed credentials in the Durable Object
// before using them, so normal Worker restarts do not revert a rotated token.
export async function frameAccessToken(env, store, request, now = Date.now) {
  if (env.FRAME_TOKEN) return env.FRAME_TOKEN;
  if (!env.FRAME_CLIENT_ID || !env.FRAME_CLIENT_SECRET) throw new Error('Frame.io OAuth credentials are missing');
  let saved = await store.get('frameOAuth');
  if (!saved) {
    if (!env.FRAME_REFRESH_TOKEN) throw new Error('Connect Frame.io first');
    saved = {refreshToken:env.FRAME_REFRESH_TOKEN};
    await store.put('frameOAuth',saved);
  }
  if (saved.accessToken && saved.expiresAt > now()+60000) return saved.accessToken;
  if (saved.refreshPending) throw new Error('Frame.io token refresh was interrupted; reconnect Frame.io');
  // Never replay an uncertain rotating refresh token after a lost response.
  await store.put('frameOAuth',{...saved,refreshPending:true});
  const tokens = await request('https://ims-na1.adobelogin.com/ims/token/v3', {
    method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({client_id:env.FRAME_CLIENT_ID,client_secret:env.FRAME_CLIENT_SECRET,grant_type:'refresh_token',refresh_token:saved.refreshToken}).toString()
  });
  if (!tokens.access_token || !Number.isFinite(Number(tokens.expires_in)) || Number(tokens.expires_in)<=0) throw new Error('Frame.io OAuth refresh returned incomplete credentials');
  const next={refreshToken:tokens.refresh_token || saved.refreshToken,accessToken:tokens.access_token,expiresAt:now()+Number(tokens.expires_in)*1000};
  await store.put('frameOAuth',next);
  return next.accessToken;
}
