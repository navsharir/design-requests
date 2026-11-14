const html = body => new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Bambuu pilot setup</title><style>body{font:18px system-ui;max-width:620px;margin:60px auto;padding:20px}input,button{font:inherit;padding:12px;margin:12px 0;width:100%;box-sizing:border-box}</style><h1>Bambuu Frame.io connection</h1>${body}`, {headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://ims-na1.adobelogin.com; frame-ancestors 'none'",'Referrer-Policy':'same-origin'}});
const digest = async value => new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));
async function equal(a,b) { const x=await digest(a),y=await digest(b);let diff=0;for(let i=0;i<x.length;i++)diff|=x[i]^y[i];return diff===0; }
const fingerprint = async value => [...await digest(value)].map(x=>x.toString(16).padStart(2,'0')).join('');
const clearCookie = '__Host-fio-setup=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0';
export async function setup(request,env,store,transport=fetch,now=Date.now,runPilot) {
  const url=new URL(request.url);
  if (!env.SETUP_SECRET) return html('<p>Setup credentials are not configured yet. The pilot remains disabled.</p>');
  if (env.ENABLED === 'true') return new Response('Disable the pilot before reconnecting Frame.io.',{status:409});
  if (url.pathname==='/setup' && request.method==='GET') {
    const connected=!!(await store.get('frameOAuth'))?.refreshToken;
    return html(`<p>${connected?'A Frame.io connection is saved.':'Connect the team account to finish the pilot setup.'}</p><p>Only the Cloudflare account operator should use this page.</p><form method="post" action="/setup/frame/start"><label>Setup code<input type="password" name="secret" required autocomplete="off"></label><button>Connect Frame.io</button></form><form method="post" action="/setup/slack/check"><label>Setup code<input type="password" name="secret" required autocomplete="off"></label><button>Check Slack connection</button></form><form method="post" action="/setup/pilot/run"><label>Setup code<input type="password" name="secret" required autocomplete="off"></label><button>Run one pilot scan</button></form>`);
  }
  if (['/setup/frame/start','/setup/slack/check','/setup/pilot/run'].includes(url.pathname) && request.method==='POST') {
    if (request.headers.get('Origin')!==url.origin) return new Response('Invalid origin',{status:403});
    if (Number(request.headers.get('Content-Length')||0)>4096) return new Response('Too large',{status:413});
    const raw=await request.text(); if(raw.length>4096)return new Response('Too large',{status:413});
    if(!await equal(new URLSearchParams(raw).get('secret')||'',env.SETUP_SECRET))return new Response('Invalid setup code',{status:403});
    if(url.pathname==='/setup/pilot/run')return runPilot ? await runPilot() : new Response('Unavailable',{status:503});
    if(url.pathname==='/setup/slack/check') {
      if(!env.SLACK_TOKEN)return new Response('Slack is not configured',{status:503});
      const response=await transport('https://slack.com/api/auth.test',{method:'POST',headers:{Authorization:`Bearer ${env.SLACK_TOKEN}`},signal:AbortSignal.timeout(20000)});
      const result=await response.json();return Response.json({ok:result.ok===true,userId:result.user_id,teamId:result.team_id},{headers:{'Cache-Control':'no-store'}});
    }
    if(!env.FRAME_CLIENT_ID || !env.FRAME_CLIENT_SECRET)return new Response('Frame.io app credentials are missing',{status:503});
    const state=crypto.randomUUID(),cookie=crypto.randomUUID();
    await store.put('frameSetup',{stateHash:await fingerprint(state),cookieHash:await fingerprint(cookie),expiresAt:now()+600000,origin:url.origin});
    const target=new URL('https://ims-na1.adobelogin.com/ims/authorize/v2');
    Object.entries({client_id:env.FRAME_CLIENT_ID,redirect_uri:url.origin+'/setup/frame/callback',response_type:'code',scope:'openid email profile offline_access additional_info.roles',state}).forEach(([k,v])=>target.searchParams.set(k,v));
    const page=html(`<p>Continue to Adobe to connect the approved team account.</p><a href="${target.href.replaceAll('&','&amp;')}">Continue to Adobe</a>`);page.headers.set('Set-Cookie',`__Host-fio-setup=${cookie}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);page.headers.set('Location',target.href);return page;
  }
  if(url.pathname==='/setup/frame/callback' && request.method==='GET') {
    if(!env.FRAME_CLIENT_ID || !env.FRAME_CLIENT_SECRET)return new Response('Frame.io app credentials are missing',{status:503});
    const saved=await store.get('frameSetup');
    const cookie=(request.headers.get('Cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('__Host-fio-setup='))?.slice('__Host-fio-setup='.length)||'';
    if(!saved || saved.expiresAt<now() || saved.origin!==url.origin || !await equal(await fingerprint(url.searchParams.get('state')||''),saved.stateHash) || !await equal(await fingerprint(cookie),saved.cookieHash))return new Response('Invalid or expired authorization session',{status:400});
    await store.delete('frameSetup');
    if(url.searchParams.has('error') || !url.searchParams.get('code'))return html('<p>Authorization was not completed. Start a fresh connection.</p>');
    const response=await transport('https://ims-na1.adobelogin.com/ims/token/v3',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:env.FRAME_CLIENT_ID,client_secret:env.FRAME_CLIENT_SECRET,grant_type:'authorization_code',code:url.searchParams.get('code'),redirect_uri:url.origin+'/setup/frame/callback'}).toString(),signal:AbortSignal.timeout(20000)});
    const token=await response.json();
    if(!response.ok || !token.access_token || !token.refresh_token || !Number.isFinite(Number(token.expires_in)) || Number(token.expires_in)<=0)return new Response('Adobe authorization exchange failed; reconnect Frame.io.',{status:400,headers:{'Cache-Control':'no-store','Set-Cookie':clearCookie}});
    await store.put('frameOAuth',{accessToken:token.access_token,refreshToken:token.refresh_token,expiresAt:now()+Number(token.expires_in)*1000});
    const result=html('<p>Frame.io is connected. The pilot is still disabled until its live test is started.</p>');result.headers.set('Set-Cookie',clearCookie);return result;
  }
  return new Response('Not found',{status:404});
}
