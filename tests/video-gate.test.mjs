import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import video from '../api/video.js';
import health from '../api/health.js';

const keys=['VIDEO_AI_ENABLED','VIDEO_AI_BILLING_CONFIRMED','VIDEO_AI_ACCESS_CODE',
  'CLOUDFLARE_ACCOUNT_ID','CLOUDFLARE_API_TOKEN','VERCEL_ENV','VERCEL_URL'];
const SECRET='example-test-only-access-code-0000';
function reply(){
  return {code:200,headers:{},body:null,
    setHeader(k,v){this.headers[k]=v;},
    status(v){this.code=v;return this;},
    json(v){this.body=v;return this;}};
}
async function call(body, headers={'content-type':'application/json'}){
  const res=reply();await video({method:'POST',headers,body},res);return res;
}
async function withEnv(values, callback) {
  const original=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  try {
    for (const key of keys) delete process.env[key];
    Object.assign(process.env,values);
    return await callback();
  } finally {
    for (const [key,value] of Object.entries(original))
      if(value===undefined)delete process.env[key];else process.env[key]=value;
  }
}
const READY={
  VIDEO_AI_ENABLED:'true',VIDEO_AI_BILLING_CONFIRMED:'true',
  VIDEO_AI_ACCESS_CODE:SECRET,CLOUDFLARE_ACCOUNT_ID:'mock-account',CLOUDFLARE_API_TOKEN:'mock-token'
};
const valid={prompt:'A cinematic sunrise over green mountains in Indonesia',duration:5,
  aspect_ratio:'16:9',resolution:'480p',access_code:SECRET,confirm_cost:true};

test('backend defaults to disabled and never calls Cloudflare when disabled', async ()=>{
  await withEnv({},async()=>{
    const res=await call(valid);
    assert.equal(res.code,503);
    assert.match(res.body.error,/belum siap/i);
    const status=reply();health({},status);assert.equal(status.body.videoEnabled,false);
  });
});
test('billing authorization, access code and Cloudflare credentials are all required',async()=>{
  await withEnv({...READY,VIDEO_AI_BILLING_CONFIRMED:'false'},async()=>{
    assert.equal((await call(valid)).code,503);
  });
  await withEnv({...READY,VIDEO_AI_ACCESS_CODE:'weak'},async()=>{
    assert.equal((await call(valid)).code,503);
  });
  await withEnv(READY,async()=>{
    assert.equal((await call({...valid,access_code:'wrong'})).code,403);
    assert.equal((await call({...valid,confirm_cost:false})).code,400);
    assert.equal((await call(valid,{'content-type':'text/plain'})).code,415);
    assert.equal((await call(valid,{origin:'https://attacker.invalid','content-type':'application/json'})).code,403);
    assert.equal((await call({...valid,duration:10})).code,400);
    assert.equal((await call({...valid,resolution:'720p'})).code,400);
    const status=reply();health({},status);assert.equal(status.body.videoEnabled,true);
    assert.equal(JSON.stringify(status.body).includes(SECRET),false);
  });
});
test('Cloudflare completed response is mapped into secure video URL',async()=>{
  await withEnv(READY,async()=>{
    const original=globalThis.fetch;
    let calls=0;
    globalThis.fetch=async(url,opt)=>{
      calls++;
      assert.match(url,/api\.cloudflare\.com\/client\/v4\/accounts\/mock-account\/ai\/run/);
      assert.equal(JSON.parse(opt.body).model,'xai/grok-imagine-video');
      assert.equal(JSON.parse(opt.body).input.duration,5);
      return new Response(JSON.stringify({state:'Completed',result:{video:'https://example.org/sample.mp4'}}),{status:200});
    };
    try{
      const res=await call(valid);
      assert.equal(res.code,200);
      assert.equal(res.body.status,'completed');
      assert.equal(res.body.video_url,'https://example.org/sample.mp4');
      assert.equal(calls,1);
    } finally {globalThis.fetch=original;}
  });
});
test('unified frontend protects paid video with quote, consent, and one-click render',()=>{
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  assert.match(html,/id="videoMode"/);
  assert.match(html,/id="approveVideo"/);
  assert.match(html,/video-quote/);
  assert.match(html,/video-run/);
  assert.match(html,/window\.confirm\('Setuju menggunakan saldo Agensi/);
  assert.match(html,/clearQuote\(\)/);
  assert.doesNotMatch(html,/<nav(?:\s|>)/);
});
