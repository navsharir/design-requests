import test from 'node:test';
import assert from 'node:assert/strict';
import {frameAccessToken} from '../src/frame-auth.js';
const env={FRAME_CLIENT_ID:'test-client',FRAME_CLIENT_SECRET:'test-secret',FRAME_REFRESH_TOKEN:'test-refresh'};
function storage(){let value;return {get:async()=>structuredClone(value),put:async(_k,v)=>{value=structuredClone(v);}};}
test('reuses current access token across worker invocations',async()=>{
  const s=storage();let requests=0;
  const request=async()=>{requests++;return{access_token:'test-access',refresh_token:'rotated-refresh',expires_in:3600};};
  assert.equal(await frameAccessToken(env,s,request,()=>0),'test-access');
  assert.equal(await frameAccessToken(env,s,request,()=>1000),'test-access');
  assert.equal(requests,1);
});
test('persists and uses rotated refresh token after access token expires',async()=>{
  const s=storage();let sent=[];
  const request=async(_url,o)=>{sent.push(new URLSearchParams(o.body).get('refresh_token'));return{access_token:'test-access',refresh_token:'rotated-refresh',expires_in:3600};};
  await frameAccessToken(env,s,request,()=>0);await frameAccessToken(env,s,request,()=>3600000);
  assert.deepEqual(sent,['test-refresh','rotated-refresh']);
});
test('does not replay refresh after an uncertain response',async()=>{
  const s=storage();let requests=0;const request=async()=>{requests++;throw new Error('network');};
  await assert.rejects(()=>frameAccessToken(env,s,request,()=>0));
  await assert.rejects(()=>frameAccessToken(env,s,request,()=>1),/interrupted/);assert.equal(requests,1);
});
test('supports an explicitly configured direct token',async()=>{
  assert.equal(await frameAccessToken({FRAME_TOKEN:'test-direct'},storage(),()=>{throw new Error('unexpected');}),'test-direct');
});
