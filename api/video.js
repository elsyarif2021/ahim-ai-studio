import {timingSafeEqual} from "node:crypto";
const error=(res,status,message)=>res.status(status).json({error:String(message).slice(0,420)});
export default async function handler(req,res){
 res.setHeader("Cache-Control","no-store");
 if(req.method!=="POST")return error(res,405,"POST required");
 if(process.env.VIDEO_AI_ENABLED!=="true")return error(res,503,"Text-to-Video belum diaktifkan pemilik aplikasi. Biaya video memerlukan persetujuan.");
 const secret=process.env.VIDEO_AI_ACCESS_CODE;
 if(!secret||secret.length<12)return error(res,503,"VIDEO_AI_ACCESS_CODE minimal 12 karakter harus diatur di Vercel.");
 const supplied=req.body?.access_code;
 if(typeof supplied!=="string")return error(res,403,"Kode akses tidak valid.");
 const a=Buffer.from(secret),b=Buffer.from(supplied);
 if(a.length!==b.length||!timingSafeEqual(a,b))return error(res,403,"Kode akses video salah.");
 if(req.body?.confirm_cost!==true)return error(res,400,"Konfirmasi biaya wajib diisi.");
 const {prompt,duration=5,aspect_ratio="9:16",resolution="480p"}=req.body||{};
 if(typeof prompt!=="string"||prompt.trim().length<8||prompt.length>1600)return error(res,400,"Prompt harus 8–1600 karakter.");
 if(![5,10].includes(duration)||!["9:16","16:9","1:1"].includes(aspect_ratio)||!["480p","720p"].includes(resolution))return error(res,400,"Durasi, rasio atau resolusi tidak didukung.");
 const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;
 if(!account||!token)return error(res,503,"Cloudflare belum dikonfigurasi.");
 try{
 const response=await fetch("https://api.cloudflare.com/client/v4/accounts/"+encodeURIComponent(account)+"/ai/run",{
  method:"POST",headers:{"Authorization":"Bearer "+token,"Content-Type":"application/json"},
  body:JSON.stringify({model:"xai/grok-imagine-video",input:{prompt:prompt.trim(),aspect_ratio,duration,resolution}}),
  signal:AbortSignal.timeout(55000)
 });
 const text=await response.text();
 let data;try{data=JSON.parse(text)}catch{data=null}
 if(!response.ok)return error(res,response.status===429?429:502,response.status===402?"Kredit Cloudflare AI Gateway tidak cukup.":"Cloudflare HTTP "+response.status+": "+text.slice(0,250));
 if(data?.success===false)return error(res,502,JSON.stringify(data.errors||"Model menolak permintaan."));
 const obj=data?.result??data;
 const url=obj?.video??obj?.result?.video??obj?.output?.video;
 if(typeof url==="string"){
   const u=new URL(url);
   if(u.protocol!=="https:")return error(res,502,"URL video tidak aman.");
   return res.status(200).json({status:"completed",video_url:u.href,model:"xai/grok-imagine-video"});
 }
 if((obj?.state||obj?.status||"").toLowerCase().match(/pending|queued|processing|running/))
   return res.status(202).json({status:"processing",message:"Cloudflare belum mengembalikan video selesai. Belum tersedia polling pada versi ini."});
 return error(res,502,"Cloudflare tidak mengembalikan tautan video MP4: "+JSON.stringify(obj).slice(0,220));
 }catch(e){return error(res,502,e.name==="TimeoutError"?"Pembuatan video melebihi batas Vercel. Job mungkin masih berjalan dan dapat dikenai biaya.":e.message)}
}