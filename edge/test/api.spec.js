import { describe, test, expect, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import { createApp } from '../src/api.js';

const auth = async (request) => ({
  id: request.header('X-Test-Actor') || 'test-alice',
  email: null
});
const app = createApp({ authenticate: auth });
const makeEnv = (overrides={})=>({
  DB: env.DB,
  CONFIG_KV: env.CONFIG_KV,
  MEDIA: env.MEDIA,
  AI: { run: vi.fn(async ()=>({ response:'Jawaban AI tersedia.' })) },
  PUBLIC_APP_ORIGIN:'https://ahim-ai-studio.vercel.app',
  MAX_AI_PER_HOUR:'2',
  MAX_UPLOAD_BYTES:'8388608',
  CHAT_MODEL:'@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  IMAGE_MODEL:'@cf/black-forest-labs/flux-1-schnell',
  ...overrides
});
const actor=(a)=>({'X-Test-Actor':a});
const jsonHeaders=(a)=>({...actor(a),'Content-Type':'application/json'});

describe('AHIM Cloudflare Edge',()=>{
  test('health is public and independent from bindings',async()=>{
    const res=await app.request('http://localhost/health',{},makeEnv());
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe('ok');
  });

  test('production identity middleware fails closed without Access config',async()=>{
    const live=createApp();
    const res=await live.request('http://localhost/v1/me',{},makeEnv());
    expect(res.status).toBe(503);
  });

  test('rejects unsigned identity even when Access is configured',async()=>{
    const live=createApp();
    const res=await live.request('http://localhost/v1/me',{},makeEnv({
      ACCESS_TEAM_DOMAIN:'example.cloudflareaccess.com',
      ACCESS_AUD:'example-audience'
    }));
    expect(res.status).toBe(401);
  });

  test('rejects untrusted browser origins',async()=>{
    const res=await app.request('http://localhost/v1/me',{headers:{Origin:'https://attacker.invalid'}},makeEnv());
    expect(res.status).toBe(403);
  });

  test('preflight only permits the explicit Vercel frontend origin',async()=>{
    const res=await app.request('http://localhost/v1/me',{method:'OPTIONS',headers:{Origin:'https://ahim-ai-studio.vercel.app'}},makeEnv());
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://ahim-ai-studio.vercel.app');
  });

  test('authenticated profile is inserted into D1',async()=>{
    const res=await app.request('http://localhost/v1/me',{headers:actor('test-profile')},makeEnv());
    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe('test-profile');
    const row=await env.DB.prepare('SELECT id FROM users WHERE id=?').bind('test-profile').first();
    expect(row.id).toBe('test-profile');
  });

  test('validates generator payload and prevents unchecked tasks',async()=>{
    for(const body of [
      JSON.stringify({task:'admin',prompt:'Hello'}),
      JSON.stringify({task:'chat',prompt:''}),
      JSON.stringify({task:'chat',prompt:'Hello',other:'not allowed'}),
      '{invalid}'
    ]){
      const res=await app.request('http://localhost/v1/generate',{method:'POST',headers:jsonHeaders('test-validation'),body},makeEnv());
      expect(res.status).toBe(400);
    }
  });

  test('stores AI results, isolates history, and atomically caps quota',async()=>{
    const bindings=makeEnv();
    for(let i=0;i<2;i++){
      const res=await app.request('http://localhost/v1/generate',{
        method:'POST',headers:jsonHeaders('test-quota'),
        body:JSON.stringify({task:'chat',prompt:'Materi Sosiologi '+i})
      },bindings);
      expect(res.status).toBe(200);
      expect((await res.json()).text).toBe('Jawaban AI tersedia.');
    }
    expect(bindings.AI.run).toHaveBeenCalledTimes(2);
    const blocked=await app.request('http://localhost/v1/generate',{
      method:'POST',headers:jsonHeaders('test-quota'),
      body:JSON.stringify({task:'chat',prompt:'Ketiga'})
    },bindings);
    expect(blocked.status).toBe(429);
    const mine=await app.request('http://localhost/v1/history',{headers:actor('test-quota')},bindings);
    const yours=await app.request('http://localhost/v1/history',{headers:actor('test-other')},bindings);
    expect((await mine.json()).items.length).toBe(2);
    expect((await yours.json()).items.length).toBe(0);
  });

  test('KV-backed model list returns configured names',async()=>{
    const res=await app.request('http://localhost/v1/models',{headers:actor('test-models')},makeEnv());
    expect(res.status).toBe(200);
    expect((await res.json()).models).toHaveLength(3);
  });

  test('R2 media uploads remain private to the owner',async()=>{
    const bindings=makeEnv();
    const post=await app.request('http://localhost/v1/media',{
      method:'POST',headers:{...actor('test-asset-a'),'Content-Type':'image/png'},
      body:new Uint8Array([137,80,78,71,13,10,26,10,1,2,3])
    },bindings);
    expect(post.status).toBe(201);
    const item=await post.json();
    expect(item.id).toMatch(/^[0-9a-f-]{36}$/);
    const own=await app.request('http://localhost/v1/media/'+item.id,{headers:actor('test-asset-a')},bindings);
    expect(own.status).toBe(200);
    expect(own.headers.get('content-disposition')).toContain('attachment');
    const other=await app.request('http://localhost/v1/media/'+item.id,{headers:actor('test-asset-b')},bindings);
    expect(other.status).toBe(404);
    const del=await app.request('http://localhost/v1/media/'+item.id,{method:'DELETE',headers:actor('test-asset-a')},bindings);
    expect(del.status).toBe(200);
    expect((await del.json()).deleted).toBe(true);
  });

  test('AI-generated image stores a private R2 asset',async()=>{
    const bytes=String.fromCharCode(255,216,255,217);
    const bindings=makeEnv({AI:{run:vi.fn(async()=>({image:btoa(bytes)}))}});
    const create=await app.request('http://localhost/v1/generate',{
      method:'POST',headers:jsonHeaders('test-image-generate'),
      body:JSON.stringify({task:'image',prompt:'Ilustrasi tanaman hijau'})
    },bindings);
    expect(create.status).toBe(200);
    const result=await create.json();
    expect(result.asset_id).toMatch(/^[0-9a-f-]{36}$/);
    const file=await app.request('http://localhost'+result.download_url,{headers:actor('test-image-generate')},bindings);
    expect(file.status).toBe(200);
    expect(file.headers.get('content-type')).toContain('image/jpeg');
  });

  test('rejects unsafe media content types before uploading',async()=>{
    const bindings=makeEnv();
    const res=await app.request('http://localhost/v1/media',{
      method:'POST',headers:{...actor('test-asset-c'),'Content-Type':'text/html'},body:'<script>alert(1)</script>'
    },bindings);
    expect(res.status).toBe(415);
  });
});
