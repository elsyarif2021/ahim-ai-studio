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
async function call(method='GET',query={op:'status'},headers={}){
  const req={method,query,headers},res=response();
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