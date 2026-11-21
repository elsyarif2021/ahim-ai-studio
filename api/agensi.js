import { randomBytes, createHash, createCipheriv, createDecipheriv, timingSafeEqual } from 'node:crypto';

const RESOURCE='https://mcp.agensi.io/mcp/auth';
const METADATA='https://mcp.agensi.io/.well-known/oauth-authorization-server';
const ORIGIN='https://ahim-ai-studio.vercel.app';
const COOKIE_TX='ahim_agensi_tx';
const COOKIE_ACCESS='ahim_agensi_access';
const COOKIE_REFRESH='ahim_agensi_refresh';
const COOKIE_VIDEO_QUOTE='ahim_agensi_video_quote';
const COOKIE_VIDEO_JOB='ahim_agensi_video_job';
const VIDEO_MODELS={
 silent:{id:'replicate.video-gen.seedance-1-lite',name:'Seedance 1 Lite',priceCeiling:0.5,resolution:'480p',audio:false},
 sound:{id:'openrouter.x.kwaivgi-kling-v3-0-std',name:'Kling v3.0 Standard',priceCeiling:1.5,resolution:'720p',audio:true}
};
function appOrigin(){
  const host=String(process.env.VERCEL_URL||'');
  if(process.env.VERCEL_ENV==='preview' && /^ahim-ai-studio-[a-z0-9-]+\.vercel\.app$/i.test(host))return 'https://'+host;
  return ORIGIN;
}
const MAX_JSON=160000;

const b64=x=>Buffer.from(x).toString('base64url');
function secretKey(){
  const secret=process.env.AGENSI_SESSION_SECRET;
  if(!secret || secret.length<32) throw Object.assign(new Error('AGENSI_SESSION_SECRET belum diatur (minimal 32 karakter).'),{status:503});
  return createHash('sha256').update(secret).digest();
}
function seal(data){
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',secretKey(),iv);
  const encrypted=Buffer.concat([cipher.update(JSON.stringify(data),'utf8'),cipher.final()]);
  return b64(Buffer.concat([iv,cipher.getAuthTag(),encrypted]));
}
function unseal(value){
  if(!value) return null;
  try{
    const buf=Buffer.from(value,'base64url');if(buf.length<29)return null;
    const decipher=createDecipheriv('aes-256-gcm',secretKey(),buf.subarray(0,12));
    decipher.setAuthTag(buf.subarray(12,28));
    return JSON.parse(Buffer.concat([decipher.update(buf.subarray(28)),decipher.final()]).toString('utf8'));
  }catch{return null;}
}
function cookies(req){
  return Object.fromEntries((req.headers.cookie||'').split(';').map(s=>s.trim()).filter(Boolean).map(s=>{
    const i=s.indexOf('=');return [s.slice(0,i),s.slice(i+1)];
  }).filter(x=>x[0]&&!x[0].includes(' ')));
}
function setCookies(res,entries){
  const existing=res.getHeader?.('Set-Cookie')||[];
  const map=new Map();
  for(const cookie of (Array.isArray(existing)?existing:[existing])){
    if(typeof cookie==='string'&&cookie.includes('='))map.set(cookie.split('=')[0],cookie);
  }
  for(const [name,value,seconds] of entries){
    map.set(name,name+'='+value+'; Path=/api/agensi; HttpOnly; Secure; SameSite=Lax; Max-Age='+seconds);
  }
  res.setHeader('Set-Cookie',[...map.values()]);
}
function removeCookies(res,names){setCookies(res,names.map(n=>[n,'',0]));}
function fail(res,status,message){return res.status(status).json({error:message});}
function allowed(url){
  const u=new URL(url);
  if(u.protocol!=='https:' || !['mcp.agensi.io','www.agensi.io','agensi.io'].includes(u.hostname)) throw new Error('Endpoint OAuth Agensi tidak dikenal.');
  return u.href;
}
async function requestJson(url,options={}){
  const r=await fetch(allowed(url),{...options,signal:AbortSignal.timeout(15000),redirect:'error'});
  const body=await r.text();
  if(body.length>MAX_JSON)throw new Error('Respons Agensi terlalu besar.');
  let data;try{data=JSON.parse(body);}catch{throw new Error('Respons Agensi bukan JSON.');}
  if(!r.ok)throw Object.assign(new Error(data.error_description||data.error||'Agensi HTTP '+r.status),{status:r.status===429?429:502});
  return data;
}
function cbUrl(){return appOrigin()+'/api/agensi?op=callback';}
function safeEqual(a,b){
  const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));
  return x.length===y.length && timingSafeEqual(x,y);
}
function accessCookie(token,seconds){return [COOKIE_ACCESS,seal({value:token,exp:Date.now()+seconds*1000}),seconds];}
function refreshCookie(info,seconds=30*24*3600){return [COOKIE_REFRESH,seal(info),seconds];}
function unpackTool(reply){
  if(reply.error)throw new Error(reply.error.message||'Kesalahan RPC.');
  if(reply.result?.isError)throw new Error(reply.result.content?.[0]?.text||'Agensi tool gagal.');
  const parts=reply.result?.content||[];
  const text=parts.filter(x=>x.type==='text').map(x=>x.text).join('\n');
  if(!text)return reply.result?.structuredContent||reply.result||{};
  try{return JSON.parse(text);}catch{return {message:text.slice(0,4000)};}
}
async function rpcPost(token,method,params,sessionId,id){
  const headers={'Authorization':'Bearer '+token,'Content-Type':'application/json','Accept':'application/json, text/event-stream','MCP-Protocol-Version':'2025-06-18'};
  if(sessionId)headers['Mcp-Session-Id']=sessionId;
  const r=await fetch(RESOURCE,{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',...(id===null?{}:{id}),method,...(params?{params}:{})}),redirect:'error',signal:AbortSignal.timeout(18000)});
  if(!r.ok)throw Object.assign(new Error('MCP Agensi HTTP '+r.status),{status:r.status===401?401:502});
  let payload=null;
  if(id!==null){
    const raw=await r.text();
    if(raw.length>MAX_JSON)throw new Error('Respons MCP terlalu besar.');
    if((r.headers.get('content-type')||'').includes('text/event-stream')){
      for(const line of raw.split(/\r?\n/)){if(line.startsWith('data:')){try{const parsed=JSON.parse(line.slice(5).trim());if(parsed.id===id)payload=parsed;}catch{}}}
    }else{payload=JSON.parse(raw);}
    if(!payload)throw new Error('MCP tidak mengembalikan hasil.');
  }else{await r.arrayBuffer();}
  return {data:payload,sessionId:r.headers.get('mcp-session-id')||sessionId};
}
async function toolCall(token,name,args){
  const init=await rpcPost(token,'initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'AHIM AI Studio',version:'1.0.0'}},null,1);
  if(init.data?.error)throw new Error(init.data.error.message||'MCP init gagal.');
  const sid=init.sessionId;
  await rpcPost(token,'notifications/initialized',null,sid,null);
  const reply=await rpcPost(token,'tools/call',{name,arguments:args},sid,2);
  return unpackTool(reply.data);
}
async function getToken(req,res){
  const all=cookies(req);
  const a=unseal(all[COOKIE_ACCESS]);
  if(a?.value && a.exp>Date.now()+90*1000)return a.value;
  const info=unseal(all[COOKIE_REFRESH]);
  if(!info?.refresh_token)throw Object.assign(new Error('Belum terhubung. Hubungkan akun Agensi terlebih dahulu.'),{status:401});
  const body=new URLSearchParams({grant_type:'refresh_token',refresh_token:info.refresh_token,client_id:info.client_id});
  const next=await requestJson(info.token_endpoint,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body});
  if(!next.access_token || !next.refresh_token)throw Object.assign(new Error('Sesi Agensi berakhir. Hubungkan ulang.'),{status:401});
  const ttl=Math.max(60,Math.min(3600,Number(next.expires_in)||3600));
  setCookies(res,[accessCookie(next.access_token,ttl),refreshCookie({...info,refresh_token:next.refresh_token})]);
  return next.access_token;
}
function statuses(req){
  const all=cookies(req),access=unseal(all[COOKIE_ACCESS]),refresh=unseal(all[COOKIE_REFRESH]);
  return {configured:!!(process.env.AGENSI_SESSION_SECRET?.length>=32),connected:!!(refresh?.refresh_token),videoAuthorized:!!(refresh?.scope||'').includes('install'),accessActive:!!(access?.exp>Date.now())};
}

function videoPreviewOnly(){
  if(process.env.VERCEL_ENV!=='preview')throw Object.assign(new Error('Text-to-Video Agensi hanya tersedia pada Preview yang terautentikasi.'),{status:503});
}
function videoSession(req){
  const info=unseal(cookies(req)[COOKIE_REFRESH]);
  if(!info?.refresh_token)throw Object.assign(new Error('Hubungkan akun Agensi terlebih dahulu.'),{status:401});
  if(!String(info.scope||'').split(' ').includes('install'))throw Object.assign(new Error('Hubungkan ulang Agensi dengan izin video terlebih dahulu.'),{status:403});
}
function videoRequest(req){
  const origin=req.headers?.origin;
  if(origin!==appOrigin())throw Object.assign(new Error('Asal permintaan tidak diizinkan.'),{status:403});
  if(!/^application\/json(?:\s*;|$)/i.test(String(req.headers?.['content-type']||'')))
    throw Object.assign(new Error('Gunakan application/json.'),{status:415});
  if(!req.body || typeof req.body!=='object'||Array.isArray(req.body))
    throw Object.assign(new Error('Format permintaan tidak valid.'),{status:400});
}
function secureVideoUrl(url){
  try{const u=new URL(url);return u.protocol==='https:'?u.href:null;}catch{return null;}
}
function sanitizeVideoJob(data){
  const jobId=typeof data.job_id==='string'&&/^[a-zA-Z0-9_-]{8,100}$/.test(data.job_id)?data.job_id:null;
  const files=Array.isArray(data.files)?data.files.slice(0,3).map(x=>({
    url:secureVideoUrl(x?.url),
    type:typeof x?.type==='string'?x.type:null
  })).filter(x=>x.url):[];
  return {status:String(data.status||'unknown').slice(0,60),job_id:jobId,files,
    charged_usd:typeof data.charged_usd==='number'?data.charged_usd:null};
}
function acceptableImageUrl(value){
  if(typeof value!=='string'||value.length>2000)return null;
  try{
    const u=new URL(value);
    const h=u.hostname.toLowerCase();
    if(u.protocol!=='https:'||u.username||u.password||u.port)return null;
    if(!h.includes('.')||h==='localhost'||h.endsWith('.local')||/^[0-9.]+$/.test(h)||h.includes(':')||h.endsWith('.internal'))return null;
    return u.href;
  }catch{return null;}
}
async function quoteVideo(req,res){
  videoRequest(req);videoSession(req);videoPreviewOnly();
  const {prompt,duration=5,aspect_ratio='16:9',resolution='480p',video_mode='silent',image_url}=req.body;
  const selected=VIDEO_MODELS[video_mode];
  if(!selected)return fail(res,400,'Mode video tidak dikenal.');
  if(typeof prompt!=='string'||prompt.trim().length<8||prompt.length>1600)
    return fail(res,400,'Prompt harus 8–1600 karakter.');
  if(duration!==5||resolution!==selected.resolution||!['16:9','9:16','1:1'].includes(aspect_ratio))
    return fail(res,400,'Mode Agensi hanya 5 detik, resolusi sesuai model.');
  const image=typeof image_url==='string'&&image_url.trim()?acceptableImageUrl(image_url.trim()):null;
  if(image_url&&!image)return fail(res,400,'URL referensi harus berupa gambar HTTPS publik yang valid.');
  if(image&&video_mode!=='silent')return fail(res,400,'Gambar ke Video untuk sementara hanya memakai Seedance tanpa audio.');
  const token=await getToken(req,res);
  const reply=await toolCall(token,'quote_tool',{
    skill_slug:'ai-video-prompt-director',
    tool:selected.id,
    request:video_mode==='sound'?{body:{model:'kwaivgi/kling-v3.0-std',prompt:prompt.trim(),duration,resolution,aspect_ratio,generate_audio:true}}:
      {body:{input:{prompt:prompt.trim(),duration,resolution,aspect_ratio,...(image?{image}:{})}}},
    summary:'Satu video 5 detik '+resolution+(selected.audio?' dengan suara':' tanpa suara')+' dari AHIM AI Studio',
    reason:'Menghitung harga video sebelum pengguna menyetujuinya.'
  });
  const amount=Number(reply.price_usd);
  if(reply.status!=='quote'||typeof reply.quote_id!=='string'||
    !Number.isFinite(amount)||amount<=0||amount>selected.priceCeiling)
    return fail(res,502,'Harga Agensi tidak valid atau melampaui batas model terpilih.');
  const now=Date.now(),expires=now+Math.min(300000,Math.max(30000,
    Date.parse(reply.expires_at||'')-now||300000));
  setCookies(res,[[COOKIE_VIDEO_QUOTE,seal({id:reply.quote_id,price:amount,
    expires,subject:prompt.trim(),video_mode,has_image:!!image}),300],[COOKIE_VIDEO_JOB,'',0]]);
  return res.status(200).json({quote_id:reply.quote_id,price_usd:amount,
    model:selected.name,video_mode,audio_requested:selected.audio,from_image:!!image,duration,resolution,aspect_ratio,expires_at:new Date(expires).toISOString(),
    requires_confirmation:true});
}
async function runVideo(req,res){
  videoRequest(req);videoSession(req);videoPreviewOnly();
  if(req.body.confirm_cost!==true)return fail(res,400,'Persetujuan biaya diperlukan.');
  const saved=unseal(cookies(req)[COOKIE_VIDEO_QUOTE]);
  if(!saved||saved.expires<Date.now()||typeof saved.id!=='string')
    return fail(res,400,'Penawaran sudah habis. Buat penawaran baru.');
  if(req.body.quote_id!==saved.id||req.body.price_usd!==saved.price)
    return fail(res,400,'Harga atau ID penawaran tidak cocok.');
  const token=await getToken(req,res);
  const reply=await toolCall(token,'run_tool',{
    quote_id:saved.id,confirm:true,price_usd:saved.price,
    reason:'Menjalankan video 5 detik mode '+saved.video_mode+' sesuai penawaran yang disetujui pengguna.'
  });
  const data=sanitizeVideoJob(reply);
  if(data.job_id)setCookies(res,[[COOKIE_VIDEO_JOB,seal({id:data.job_id,created:Date.now()}),7200],
    [COOKIE_VIDEO_QUOTE,'',0]]);
  else setCookies(res,[[COOKIE_VIDEO_QUOTE,'',0]]);
  return res.status(200).json(data);
}
async function checkVideo(req,res){
  videoRequest(req);videoSession(req);videoPreviewOnly();
  const saved=unseal(cookies(req)[COOKIE_VIDEO_JOB]);
  if(!saved||!saved.id||Date.now()-saved.created>7200000)
    return fail(res,404,'Tidak ada pekerjaan video aktif untuk sesi ini.');
  const token=await getToken(req,res);
  const reply=await toolCall(token,'check_job',{job_id:saved.id,
    reason:'Memeriksa progres pembuatan video Agensi.'});
  return res.status(200).json(sanitizeVideoJob(reply));
}

export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store, private');res.setHeader('X-Content-Type-Options','nosniff');
  const op=String(req.query.op||'status');
  try{
    if(op==='status' && req.method==='GET')return res.status(200).json(statuses(req));
    if(op==='connect' && req.method==='GET'){
      secretKey();
      const meta=await requestJson(METADATA);
      for(const field of ['authorization_endpoint','token_endpoint','registration_endpoint'])if(!meta[field])throw new Error('Metadata OAuth Agensi tidak lengkap: '+field);
      const registration=await requestJson(meta.registration_endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
        client_name:'AHIM AI Studio',redirect_uris:[cbUrl()],grant_types:['authorization_code','refresh_token'],
        response_types:['code'],token_endpoint_auth_method:'none'
      })});
      if(!registration.client_id)throw new Error('Agensi tidak memberikan client_id.');
      const verifier=b64(randomBytes(48)),state=b64(randomBytes(24));
      const scope=req.query.video==='1'?'read install':'read';
      const challenge=b64(createHash('sha256').update(verifier).digest());
      const tx={state,verifier,client_id:registration.client_id,token_endpoint:allowed(meta.token_endpoint),scope,created:Date.now()};
      setCookies(res,[[COOKIE_TX,seal(tx),600]]);
      const auth=new URL(allowed(meta.authorization_endpoint));
      for(const [k,v] of Object.entries({response_type:'code',client_id:tx.client_id,redirect_uri:cbUrl(),scope,state,code_challenge:challenge,code_challenge_method:'S256',resource:RESOURCE}))auth.searchParams.set(k,v);
      return res.redirect(302,auth.href);
    }
    if(op==='callback' && req.method==='GET'){
      const tx=unseal(cookies(req)[COOKIE_TX]);
      if(req.query.error)return res.redirect(302,'/agensi.html?error=oauth_denied');
      if(!tx || Date.now()-tx.created>600000 || !safeEqual(tx.state,req.query.state) || typeof req.query.code!=='string')return res.redirect(302,'/agensi.html?error=state_invalid');
      const body=new URLSearchParams({grant_type:'authorization_code',client_id:tx.client_id,code:req.query.code,code_verifier:tx.verifier,redirect_uri:cbUrl(),resource:RESOURCE});
      const data=await requestJson(tx.token_endpoint,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body});
      if(!data.access_token || !data.refresh_token)throw new Error('Token OAuth Agensi tidak lengkap.');
      const ttl=Math.max(60,Math.min(3600,Number(data.expires_in)||3600));
      setCookies(res,[accessCookie(data.access_token,ttl),refreshCookie({refresh_token:data.refresh_token,client_id:tx.client_id,token_endpoint:tx.token_endpoint,scope:tx.scope}),[COOKIE_TX,'',0]]);
      return res.redirect(302,'/agensi.html?connected=1');
    }
    if(op==='video-quote' && req.method==='POST')return await quoteVideo(req,res);
    if(op==='video-run' && req.method==='POST')return await runVideo(req,res);
    if(op==='video-check' && req.method==='POST')return await checkVideo(req,res);
    if(op==='disconnect' && req.method==='POST'){
      removeCookies(res,[COOKIE_TX,COOKIE_ACCESS,COOKIE_REFRESH,COOKIE_VIDEO_QUOTE,COOKIE_VIDEO_JOB]);
      return res.status(200).json({connected:false});
    }
    if(op==='search' && req.method==='GET'){
      const q=String(req.query.q||'').trim();
      if(!q || q.length>150)return fail(res,400,'Kata kunci harus 1–150 karakter.');
      const token=await getToken(req,res);
      const list=await toolCall(token,'search_skills',{query:q,limit:12,reason:'Mencari skill dari AHIM AI Studio.'});
      if(!Array.isArray(list))return fail(res,502,'Format hasil pencarian Agensi tidak sesuai.');
      return res.status(200).json({skills:list.map(x=>({
        slug:String(x.slug||'').slice(0,120),name:String(x.name||'').slice(0,160),
        best_for:String(x.best_for||'').slice(0,480),price_usd:Number(x.price_usd)||0,
        pricing_type:String(x.pricing_type||'free'),url:typeof x.url==='string'&&x.url.startsWith('https://agensi.io/')?x.url:null,
        requires:Array.isArray(x.requires)?x.requires.slice(0,8):[]
      }))});
    }
    if(op==='library' && req.method==='GET'){
      const token=await getToken(req,res);
      const list=await toolCall(token,'my_library',{limit:30});
      return res.status(200).json({library:Array.isArray(list)?list:[],note:'Library akun Agensi pengguna.'});
    }
    return fail(res,405,'Metode atau operasi tidak tersedia.');
  }catch(e){
    const status=[400,401,403,404,415,429,503].includes(e.status)?e.status:502;
    return fail(res,status,status===502?'Koneksi Agensi gagal: '+String(e.message||'error').slice(0,180):String(e.message||'error').slice(0,180));
  }
}