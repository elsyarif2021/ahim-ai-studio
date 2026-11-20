import { Hono } from 'hono';
import { z } from 'zod';
import { verifyAccessIdentity, ensureUser } from './auth.js';
import { parseJson, readLimited, consumeQuota, readLimitFromEnv, safeContentType } from './security.js';

const taskSchema = z.object({
  task: z.enum(['chat', 'promptkilat', 'image']),
  prompt: z.string().trim().min(1).max(8000),
}).strict();

const PROMPT_KILAT = [
  'Anda adalah Prompt Kilat Ultimate.',
  'Buat prompt visual siap salin dengan komponen:',
  '[DESKRIPSI VISUAL UTAMA], Jenis Desain, Tema, Color Palette, Character Style,',
  'Illustration Style, Font Style, Layout, Main Visual, Icon Elements, Border Elements,',
  'Texture, Background Style, Text Effects, Icon Set, Lighting, Mood, Text Content, Quality, Rasio.',
  'Pertahankan tulisan asli pengguna secara persis.',
  'Untuk video buat prompt bahasa Inggris dengan adegan maksimal 10 detik.',
  'Untuk Auto 5 Gaya hasilkan tepat lima prompt yang berbeda.'
].join(' ');

const MODELS = {
  chat: { label: 'Text', defaultModel: '@cf/meta/llama-3.3-70b-instruct-fp8-fast' },
  promptkilat: { label: 'Visual prompt', defaultModel: '@cf/meta/llama-3.3-70b-instruct-fp8-fast' },
  image: { label: 'Image', defaultModel: '@cf/black-forest-labs/flux-1-schnell' },
};

function nowId() { return crypto.randomUUID(); }
function user(c) { return c.get('user'); }
function formatError(e) {
  const code = [400, 401, 403, 413, 415, 429, 503].includes(e.status) ? e.status : 500;
  const msg = code === 500 ? 'Kesalahan internal. Silakan coba kembali.' : String(e.message).slice(0, 200);
  return { code, msg };
}
function imageBytes(output) {
  if (output instanceof Uint8Array) return output;
  const b64 = typeof output?.image === 'string' ? output.image : output?.result?.image;
  if (typeof b64 !== 'string' || b64.length > 11500000) throw Object.assign(new Error('Gambar AI kosong atau terlalu besar.'), {status:502});
  try { return Uint8Array.from(atob(b64), x => x.charCodeAt(0)); }
  catch { throw Object.assign(new Error('Format gambar AI tidak valid.'), {status:502}); }
}
async function putMedia(c, data, type, id = nowId()) {
  const owner = user(c).id;
  const key = owner + '/' + id;
  if (!data.byteLength || data.byteLength > 8388608) throw Object.assign(new Error('Media tidak valid atau melebihi 8MB.'), {status:413});
  await c.env.MEDIA.put(key, data, {httpMetadata:{contentType:type}});
  try {
    await c.env.DB.prepare(
      'INSERT INTO media (id,user_id,object_key,content_type,size_bytes) VALUES (?,?,?,?,?)'
    ).bind(id, owner, key, type, data.byteLength).run();
  } catch (e) { await c.env.MEDIA.delete(key); throw e; }
  return id;
}

export function createApp({authenticate = verifyAccessIdentity} = {}) {
  const app = new Hono();

  app.use('*', async (c, next) => {
    const origin = c.req.header('Origin');
    const configured = c.env?.PUBLIC_APP_ORIGIN;
    if (origin && origin !== configured) return c.json({error:'Origin tidak diizinkan.'},403);
    c.header('Cache-Control','no-store');
    c.header('X-Content-Type-Options','nosniff');
    c.header('Referrer-Policy','no-referrer');
    if (origin && origin === configured) {
      c.header('Access-Control-Allow-Origin',origin);
      c.header('Vary','Origin');
      c.header('Access-Control-Allow-Credentials','true');
      c.header('Access-Control-Allow-Headers','Content-Type, Cf-Access-Jwt-Assertion');
      c.header('Access-Control-Allow-Methods','GET, POST, DELETE, OPTIONS');
    }
    if (c.req.method === 'OPTIONS') return c.body(null,204);
    await next();
  });

  app.get('/health', c => c.json({
    status:'ok', service:'AHIM Cloudflare Edge (staging)', version:'0.1.0',
    frontend:'https://ahim-ai-studio.vercel.app'
  }));

  app.use('/v1/*', async (c,next) => {
    if (!c.env?.DB) return c.json({error:'Binding D1 tidak ditemukan.'},503);
    try {
      const identity = await authenticate(c.req,c.env);
      if (!identity?.id || !/^[a-z0-9_-]{4,128}$/i.test(identity.id)) return c.json({error:'Identitas tidak valid.'},401);
      await ensureUser(c.env.DB,identity);
      c.set('user',identity);
    } catch (e) {
      const {code,msg} = formatError(e);
      return c.json({error:msg},code);
    }
    await next();
  });

  app.get('/v1/me',c=>c.json({id:user(c).id,email:user(c).email}));

  app.get('/v1/models',async c=>{
    let cached;
    try {cached=await c.env.CONFIG_KV.get('public-models:v1','json');}
    catch {cached=null;}
    if (!Array.isArray(cached)) {
      cached=Object.entries(MODELS).map(([task,v])=>({
        task,model:task==='image'?c.env.IMAGE_MODEL||v.defaultModel:c.env.CHAT_MODEL||v.defaultModel,
        available:'configured_not_verified'
      }));
      try {await c.env.CONFIG_KV.put('public-models:v1',JSON.stringify(cached),{expirationTtl:600});}
      catch { /* KV cache is best effort, never needed for core API */ }
    }
    return c.json({models:cached});
  });

  app.post('/v1/generate',async c=>{
    const payload=taskSchema.safeParse(await parseJson(c));
    if (!payload.success)return c.json({error:'Task atau prompt tidak valid.',fields:payload.error.issues.map(i=>i.path.join('.'))},400);
    if (!c.env.AI || !c.env.MEDIA || !c.env.DB)return c.json({error:'Binding AI/D1/R2 belum tersedia.'},503);
    const {task,prompt}=payload.data;
    const limit=readLimitFromEnv(c.env,'MAX_AI_PER_HOUR',20,100);
    if (!(await consumeQuota(c.env.DB,user(c).id,limit))) {
      c.header('Retry-After','3600');
      return c.json({error:'Kuota API per jam sudah tercapai.'},429);
    }
    const id=nowId(),model=task==='image'?c.env.IMAGE_MODEL||MODELS.image.defaultModel:c.env.CHAT_MODEL||MODELS.chat.defaultModel;
    let output;
    try {
      if (task==='image') output=await c.env.AI.run(model,{prompt:prompt.slice(0,2000),steps:4});
      else output=await c.env.AI.run(model,{messages:[
        {role:'system',content:task==='promptkilat'?PROMPT_KILAT:'Anda adalah asisten AHIM AI. Jawab dengan tepat, sopan, dan terstruktur.'},
        {role:'user',content:prompt}
      ],max_tokens:task==='promptkilat'?3200:2200,temperature:task==='promptkilat'?0.5:0.25});
      if (task==='image') {
        const bytes=imageBytes(output);
        const assetId=await putMedia(c,bytes,'image/jpeg');
        await c.env.DB.prepare(
          'INSERT INTO generations (id,user_id,task,prompt,asset_id,model,status) VALUES (?,?,?,?,?,?,?)'
        ).bind(id,user(c).id,task,prompt,assetId,model,'completed').run();
        return c.json({id,task,model,asset_id:assetId,download_url:'/v1/media/'+assetId});
      }
      const text=typeof output?.response==='string'?output.response:typeof output?.text==='string'?output.text:null;
      if (!text?.trim())throw new Error('Model tidak mengembalikan teks.');
      await c.env.DB.prepare(
        'INSERT INTO generations (id,user_id,task,prompt,result_text,model,status) VALUES (?,?,?,?,?,?,?)'
      ).bind(id,user(c).id,task,prompt,text,model,'completed').run();
      return c.json({id,task,model,text});
    } catch (e) {
      // Do not store failed prompts or upstream diagnostics in logs.
      await c.env.DB.prepare(
        'INSERT INTO generations (id,user_id,task,prompt,model,status) VALUES (?,?,?,?,?,?)'
      ).bind(id,user(c).id,task,prompt,model,'failed').run().catch(()=>{});
      return c.json({error:'Generasi gagal. Periksa status model dan batas Workers AI.'},502);
    }
  });

  app.get('/v1/history',async c=>{
    const limit=Math.min(50,Math.max(1,Number.parseInt(c.req.query('limit')||'20',10)||20));
    const offset=Math.min(1000,Math.max(0,Number.parseInt(c.req.query('offset')||'0',10)||0));
    const result=await c.env.DB.prepare(
      'SELECT id,task,model,status,result_text,asset_id,created_at FROM generations WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?'
    ).bind(user(c).id,limit,offset).all();
    return c.json({items:result.results||[],limit,offset});
  });

  app.post('/v1/media',async c=>{
    if (!c.env.MEDIA)return c.json({error:'Binding R2 belum tersedia.'},503);
    const contentType=(c.req.header('content-type')||'').split(';')[0].toLowerCase().trim();
    if (!safeContentType(contentType)) return c.json({error:'Tipe file tidak didukung.'},415);
    const maxBytes=readLimitFromEnv(c.env,'MAX_UPLOAD_BYTES',8388608,8388608);
    const bytes=await readLimited(c.req.raw,maxBytes);
    if (!bytes.byteLength)return c.json({error:'File kosong.'},400);
    const limit=readLimitFromEnv(c.env,'MAX_AI_PER_HOUR',20,100);
    if (!(await consumeQuota(c.env.DB,user(c).id,limit)))return c.json({error:'Kuota pemakaian per jam tercapai.'},429);
    const id=await putMedia(c,bytes,contentType);
    return c.json({id,content_type:contentType,size_bytes:bytes.byteLength,download_url:'/v1/media/'+id},201);
  });

  app.get('/v1/media/:id',async c=>{
    const id=c.req.param('id');
    if (!/^[0-9a-f-]{36}$/i.test(id))return c.json({error:'ID file tidak valid.'},400);
    const record=await c.env.DB.prepare(
      'SELECT object_key,content_type FROM media WHERE id=? AND user_id=?'
    ).bind(id,user(c).id).first();
    if (!record)return c.json({error:'File tidak ditemukan.'},404);
    const object=await c.env.MEDIA.get(record.object_key);
    if (!object)return c.json({error:'File tidak ditemukan di R2.'},404);
    return new Response(object.body,{headers:{
      'Content-Type':record.content_type,
      'Content-Disposition':'attachment; filename="AHIM-media"',
      'Cache-Control':'no-store, private',
      'X-Content-Type-Options':'nosniff'
    }});
  });

  app.delete('/v1/media/:id',async c=>{
    const id=c.req.param('id');
    if (!/^[0-9a-f-]{36}$/i.test(id))return c.json({error:'ID file tidak valid.'},400);
    const record=await c.env.DB.prepare(
      'SELECT object_key FROM media WHERE id=? AND user_id=?'
    ).bind(id,user(c).id).first();
    if (!record)return c.json({error:'File tidak ditemukan.'},404);
    await c.env.MEDIA.delete(record.object_key);
    await c.env.DB.prepare('DELETE FROM media WHERE id=? AND user_id=?').bind(id,user(c).id).run();
    return c.json({deleted:true});
  });

  app.notFound(c=>c.json({error:'Endpoint tidak ditemukan.'},404));
  app.onError((e,c)=>{
    const {code,msg}=formatError(e);
    return c.json({error:msg},code);
  });
  return app;
}
