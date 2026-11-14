import test from 'node:test';
import assert from 'node:assert/strict';
import {setup} from '../src/setup.js';
const origin='https://pilot.example';
const env={SETUP_SECRET:'test-setup',FRAME_CLIENT_ID:'test-client',FRAME_CLIENT_SECRET:'test-client-secret',SLACK_TOKEN:'test-bot',ENABLED:'false'};
function storage(){const data=new Map();return {get:async k=>structuredClone(data.get(k)),put:async(k,v)=>data.set(k,structuredClone(v)),delete:async k=>data.delete(k)};}
const post=(path,secret='test-setup',from=origin)=>new Request(origin+path,{method:'POST',headers:{Origin:from,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({secret})});
test('setup page preserves same-origin headers for protected form submissions',async()=>{
  const response=await setup(new Request(origin+'/setup'),env,storage());
  assert.equal(response.headers.get('Referrer-Policy'),'same-origin');
});
test('setup rejects wrong secret and cross-origin requests',async()=>{
  const s=storage();
  assert.equal((await setup(post('/setup/frame/start','bad'),env,s)).status,403);
  assert.equal((await setup(post('/setup/frame/start','test-setup','https://other.example'),env,s)).status,403);
  assert.equal(await s.get('frameSetup'),undefined);
});
test('authorization redirect uses exact callback and a secure session cookie',async()=>{
  const result=await setup(post('/setup/frame/start'),env,storage());const dest=new URL(result.headers.get('Location'));
  assert.equal(dest.origin,'https://ims-na1.adobelogin.com');
  assert.equal(dest.searchParams.get('redirect_uri'),origin+'/setup/frame/callback');
  assert.ok(dest.searchParams.get('state'));assert.match(result.headers.get('Set-Cookie'),/HttpOnly; Secure; SameSite=Lax/);
  assert.ok(!dest.href.includes(env.SETUP_SECRET));assert.ok(!dest.href.includes(env.FRAME_CLIENT_SECRET));
});
test('callback requires both state and the independent cookie',async()=>{
  const s=storage();const begin=await setup(post('/setup/frame/start'),env,s);const state=new URL(begin.headers.get('Location')).searchParams.get('state');
  const cb=new Request(origin+'/setup/frame/callback?code=test-code&state='+state);
  assert.equal((await setup(cb,env,s,()=>{throw new Error('must not exchange');})).status,400);
});
test('callback stores tokens without returning them and rejects replay',async()=>{
  const s=storage();const begin=await setup(post('/setup/frame/start'),env,s,fetch,()=>0);
  const state=new URL(begin.headers.get('Location')).searchParams.get('state');const cookie=begin.headers.get('Set-Cookie').split(';')[0];
  const cb=()=>new Request(origin+'/setup/frame/callback?code=test-code&state='+state,{headers:{Cookie:cookie}});
  const exchange=async()=>Response.json({access_token:'private-access',refresh_token:'private-refresh',expires_in:3600});
  const result=await setup(cb(),env,s,exchange,()=>1000);const body=await result.text();
  assert.equal((await s.get('frameOAuth')).refreshToken,'private-refresh');assert.ok(!body.includes('private-'));
  assert.equal((await setup(cb(),env,s,exchange,()=>1001)).status,400);
});
test('expired callback cannot exchange credentials',async()=>{
  const s=storage();const begin=await setup(post('/setup/frame/start'),env,s,fetch,()=>0);
  const state=new URL(begin.headers.get('Location')).searchParams.get('state');const cookie=begin.headers.get('Set-Cookie').split(';')[0];
  const result=await setup(new Request(origin+'/setup/frame/callback?code=test-code&state='+state,{headers:{Cookie:cookie}}),env,s,()=>{throw new Error('must not exchange');},()=>600001);
  assert.equal(result.status,400);
});
test('Slack identity check returns only identity fields',async()=>{
  const result=await setup(post('/setup/slack/check'),env,storage(),async()=>Response.json({ok:true,user_id:'U123',team_id:'T123',other:'private'}));
  assert.deepEqual(await result.json(),{ok:true,userId:'U123',teamId:'T123'});
});
test('setup cannot replace a connection while the pilot is enabled',async()=>{
  assert.equal((await setup(post('/setup/frame/start'),{...env,ENABLED:'true'},storage())).status,409);
});
test('manual pilot scan requires the setup code and delegates exactly once',async()=>{
  let count=0;const run=async()=>{count++;return Response.json({ok:true});};
  assert.equal((await setup(post('/setup/pilot/run','wrong'),env,storage(),fetch,Date.now,run)).status,403);
  assert.equal(count,0);
  assert.deepEqual(await (await setup(post('/setup/pilot/run'),env,storage(),fetch,Date.now,run)).json(),{ok:true});
  assert.equal(count,1);
});
