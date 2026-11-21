import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ai from '../api/ai.js';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const api=readFileSync(new URL('../api/agensi.js',import.meta.url),'utf8');

test('Prompt Kilat Studio is a single workspace with no separate left navigation',()=>{
  assert.doesNotMatch(html,/<nav(?:\s|>)/i);
  assert.doesNotMatch(html,/\bid="navitems"/);
  assert.match(html,/Prompt Kilat, <span>Langsung Jadi/);
  assert.match(html,/\bid="generate"/);
  assert.match(html,/routeType\(\)/);
});

test('all former left-side tools are integrated into one prompt generator',()=>{
  for(const label of ['Video AI','Gambar ke Video','Suara MP3','Analisis Gambar',
    'Transkripsi Audio','Analisis Video','Chat AI','Gambar AI','Artikel','LKPD','Poster',
    'Worksheet','Slide','Infografis'])assert.ok(html.includes(label),'Missing '+label);
  assert.match(html,/task:'studio'/);
  assert.match(html,/task:'image'/);
  assert.match(html,/task:'tts'/);
  assert.match(html,/video-quote/);
  assert.match(html,/video-run/);
  assert.match(html,/video-check/);
  assert.match(html,/downloadResult\(\)/);
  assert.match(html,/imageResult\(blob\)/);
});

test('embedded browser application script compiles without missing braces or invalid syntax',()=>{
  const m=html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(m,'Missing client script');
  assert.doesNotThrow(()=>new Function(m[1]));
});

test('image-to-video is a real route using public image URL rather than a placeholder',()=>{
  assert.match(html,/image_url:task==='imagevideo'/);
  assert.match(api,/image_url/);
  assert.match(api,/acceptableImageUrl/);
  assert.match(api,/image\?\{image\}/);
});

function response(){
  return {statusCode:200,headers:{},data:null,
    setHeader(k,v){this.headers[k]=v;},
    status(code){this.statusCode=code;return this;},
    json(value){this.data=value;return this;},
    send(value){this.data=value;return this;}};
}
async function withMockModel(callback){
  const before={id:process.env.CLOUDFLARE_ACCOUNT_ID,token:process.env.CLOUDFLARE_API_TOKEN};
  const original=globalThis.fetch;
  const calls=[];
  process.env.CLOUDFLARE_ACCOUNT_ID='test-account';process.env.CLOUDFLARE_API_TOKEN='test-token';
  globalThis.fetch=async(url,options)=>{
    const input=JSON.parse(options.body);
    calls.push({url,input});
    if(url.endsWith('/@cf/black-forest-labs/flux-1-schnell'))return new Response(JSON.stringify({success:true,result:{image:Buffer.from('image-bytes').toString('base64')}}),{status:200,headers:{'content-type':'application/json'}});
    return new Response(JSON.stringify({success:true,result:{response:'Materi pelajaran lengkap yang siap dipakai oleh guru.'}}),{status:200,headers:{'content-type':'application/json'}});
  };
  try{await callback(calls);}
  finally{
    globalThis.fetch=original;
    if(before.id===undefined)delete process.env.CLOUDFLARE_ACCOUNT_ID;else process.env.CLOUDFLARE_ACCOUNT_ID=before.id;
    if(before.token===undefined)delete process.env.CLOUDFLARE_API_TOKEN;else process.env.CLOUDFLARE_API_TOKEN=before.token;
  }
}
test('actual image generation delivers image bytes rather than a text prompt',async()=>{
  await withMockModel(async calls=>{
    const res=response();
    await ai({method:'POST',body:{task:'image',prompt:'Illustrated green Islamic classroom'}},res);
    assert.equal(res.statusCode,200);
    assert.equal(res.headers['Content-Type'],'image/jpeg');
    assert.equal(res.data.toString(),'image-bytes');
    assert.equal(calls.length,1);
  });
});
test('text Studio creates finished content rather than a Prompt Kilat prompt',async()=>{
  await withMockModel(async calls=>{
    const res=response();
    await ai({method:'POST',body:{task:'studio',prompt:JSON.stringify({ide:'Materi peran sosial',jenis:'Materi Pelajaran',bahasa:'Indonesia'})}},res);
    assert.equal(res.statusCode,200);
    assert.match(res.data.text,/Materi pelajaran lengkap/);
    assert.match(calls[0].input.messages[0].content,/KONTEN AKHIR/);
    assert.match(calls[0].input.messages[0].content,/bukan penulis prompt/);
  });
});
