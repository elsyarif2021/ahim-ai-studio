import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/agensi.js';

function response(){
  return {
    code:200,headers:{},body:undefined,redirected:null,
    setHeader(name,value){this.headers[name]=value;},
    status(code){this.code=code;return this;},
    json(value){this.body=value;return this;},
    redirect(code,url){this.code=code;this.redirected=url;return this;}
  };
}
async function call(method='GET',query={op:'status'},headers={},body){
  const req={method,query,headers,body},res=response();
  await handler(req,res);return res;
}
test('status does not expose private tokens or secrets',async()=>{
  const res=await call();
  assert.equal(res.code,200);
  assert.equal(res.body.connected,false);
  assert.equal(typeof res.body.configured,'boolean');
  assert.equal(res.body.token,undefined);
  assert.match(res.headers['Cache-Control'],/no-store/);
});
test('search validates missing query without making a remote request',async()=>{
  const res=await call('GET',{op:'search',q:''});
  assert.equal(res.code,400);assert.match(res.body.error,/kata kunci/i);
});
test('search cannot run without authentication',async()=>{
  const res=await call('GET',{op:'search',q:'frontend'});
  assert.equal(res.code,401);assert.match(res.body.error,/hubungkan/i);
});
test('disconnect requires POST and clears all session cookies',async()=>{
  const invalid=await call('GET',{op:'disconnect'});assert.equal(invalid.code,405);
  const ok=await call('POST',{op:'disconnect'});
  assert.equal(ok.code,200);assert.equal(ok.body.connected,false);
  const cookies=ok.headers['Set-Cookie'];assert.equal(cookies.length,3);
  for(const cookie of cookies){assert.match(cookie,/HttpOnly/);assert.match(cookie,/Secure/);assert.match(cookie,/Max-Age=0/);}
});
test('unknown operation is rejected',async()=>{
  const res=await call('GET',{op:'unknown'});assert.equal(res.code,405);
});
test('OAuth callback refuses nonexistent transaction',async()=>{
  const res=await call('GET',{op:'callback',code:'fake',state:'fake'});
  assert.equal(res.code,302);assert.match(res.redirected,/state_invalid/);
});
test('video prompt executor is disabled by default',async()=>{
  const res=await call('POST',{op:'execute'},{origin:'https://ahim-ai-studio.vercel.app','content-type':'application/json'},{
    skill_slug:'ai-video-prompt-director',idea:'A train crossing a mountain bridge',consent:true
  });
  assert.equal(res.code,503);
  assert.match(res.body.error,/belum diaktifkan/i);
});
test('video prompt executor validates origin, supported skill, consent and input without network calls',async()=>{
  const before={enabled:process.env.AGENSI_TEXT_EXEC_ENABLED,account:process.env.CLOUDFLARE_ACCOUNT_ID,token:process.env.CLOUDFLARE_API_TOKEN};
  process.env.AGENSI_TEXT_EXEC_ENABLED='true';
  process.env.CLOUDFLARE_ACCOUNT_ID='test-account';
  process.env.CLOUDFLARE_API_TOKEN='test-token';
  const valid={skill_slug:'ai-video-prompt-director',idea:'Golden sunlight on quiet farmland',consent:true};
  const headers={origin:'https://ahim-ai-studio.vercel.app','content-type':'application/json'};
  try{
    assert.equal((await call('POST',{op:'execute'},{...headers,origin:'https://attacker.example'},valid)).code,403);
    assert.equal((await call('POST',{op:'execute'},{origin:headers.origin},valid)).code,415);
    assert.equal((await call('POST',{op:'execute'},headers,{...valid,skill_slug:'paid-untrusted-skill'})).code,400);
    assert.equal((await call('POST',{op:'execute'},headers,{...valid,consent:false})).code,400);
    assert.equal((await call('POST',{op:'execute'},headers,{...valid,idea:' '})).code,400);
    const noSession=await call('POST',{op:'execute'},headers,valid);
    assert.equal(noSession.code,401);
    assert.match(noSession.body.error,/hubungkan/i);
  }finally{
    for(const [key,value] of Object.entries({
      AGENSI_TEXT_EXEC_ENABLED:before.enabled,
      CLOUDFLARE_ACCOUNT_ID:before.account,
      CLOUDFLARE_API_TOKEN:before.token
    })){if(value===undefined)delete process.env[key];else process.env[key]=value;}
  }
});

test('Vercel preview origin is explicit and rejects arbitrary hosts',async()=>{
  const keys=['VERCEL_ENV','VERCEL_URL','AGENSI_TEXT_EXEC_ENABLED','CLOUDFLARE_ACCOUNT_ID','CLOUDFLARE_API_TOKEN'];
  const previous=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  try{
    process.env.VERCEL_ENV='preview';
    process.env.VERCEL_URL='ahim-ai-studio-abc123-owner.vercel.app';
    process.env.AGENSI_TEXT_EXEC_ENABLED='true';
    process.env.CLOUDFLARE_ACCOUNT_ID='test-account';
    process.env.CLOUDFLARE_API_TOKEN='test-token';
    const payload={skill_slug:'ai-video-prompt-director',idea:'Camera pans over a green river valley',consent:true};
    const headers={'content-type':'application/json',origin:'https://ahim-ai-studio-abc123-owner.vercel.app'};
    assert.equal((await call('POST',{op:'execute'},headers,payload)).code,401);
    assert.equal((await call('POST',{op:'execute'},{...headers,origin:'https://evil.vercel.app'},payload)).code,403);
    process.env.VERCEL_URL='evil.vercel.app';
    assert.equal((await call('POST',{op:'execute'},headers,payload)).code,403);
  }finally{
    for(const [k,v] of Object.entries(previous)){if(v===undefined)delete process.env[k];else process.env[k]=v;}
  }
});
