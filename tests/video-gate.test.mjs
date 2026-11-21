import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import health from '../api/health.js';

function response() {
  return {
    headers: {}, statusCode: 200, body: null,
    setHeader(k,v) { this.headers[k]=v; },
    status(code) { this.statusCode=code; return this; },
    json(value) { this.body=value; return this; }
  };
}

test('video backend remains disabled without both settings', () => {
  const keys=['VIDEO_AI_ENABLED','VIDEO_AI_ACCESS_CODE'];
  const old=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  try {
    delete process.env.VIDEO_AI_ENABLED;
    delete process.env.VIDEO_AI_ACCESS_CODE;
    let res=response(); health({},res);
    assert.equal(res.statusCode,200);
    assert.equal(res.body.videoEnabled,false);
    process.env.VIDEO_AI_ENABLED='true';
    res=response(); health({},res);
    assert.equal(res.body.videoEnabled,false);
    process.env.VIDEO_AI_ACCESS_CODE='example-access-code-123';
    res=response(); health({},res);
    assert.equal(res.body.videoEnabled,true);
    assert.equal(JSON.stringify(res.body).includes('example-access-code-123'),false);
  } finally {
    for(const [k,v] of Object.entries(old)) {
      if(v===undefined)delete process.env[k]; else process.env[k]=v;
    }
  }
});

test('video page clearly disables MP4 generation and links to free prompt workflow', () => {
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  assert.match(html,/videoEnabled=!!j\.videoEnabled/);
  assert.match(html,/\$\("generate"\)\.disabled=m==="video"&&!videoEnabled/);
  assert.match(html,/if\(mode==="video"\)\{if\(!videoEnabled\)/);
  assert.match(html,/href="\/agensi\.html#executorHeading"/);
});
