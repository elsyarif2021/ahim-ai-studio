import { timingSafeEqual } from 'node:crypto';

const MODEL = 'xai/grok-imagine-video';
const PUBLIC_ORIGIN = 'https://ahim-ai-studio.vercel.app';
const fail = (res, code, message) => res.status(code).json({ error: String(message).slice(0, 240) });
const configured = () =>
  process.env.VIDEO_AI_ENABLED === 'true' &&
  process.env.VIDEO_AI_BILLING_CONFIRMED === 'true' &&
  !!process.env.VIDEO_AI_ACCESS_CODE &&
  process.env.VIDEO_AI_ACCESS_CODE.length >= 24 &&
  !!process.env.CLOUDFLARE_ACCOUNT_ID &&
  !!process.env.CLOUDFLARE_API_TOKEN;

function allowedOrigin() {
  const host = String(process.env.VERCEL_URL || '');
  if (process.env.VERCEL_ENV === 'preview' &&
      /^ahim-ai-studio-[a-z0-9-]+\.vercel\.app$/i.test(host)) {
    return 'https://' + host;
  }
  return PUBLIC_ORIGIN;
}

function safeCodeMatch(expected, supplied) {
  if (typeof supplied !== 'string' || supplied.length > 256) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}

function parseCloudflareResponse(data) {
  const result = data?.result ?? data;
  const url = result?.video ?? result?.result?.video ?? result?.output?.video;
  if (typeof url === 'string') {
    try {
      const target = new URL(url);
      if (target.protocol === 'https:') return { status: 'completed', video_url: target.href, model: MODEL };
    } catch { /* invalid URL */ }
  }
  const state = String(data?.state || result?.state || data?.status || result?.status || '').toLowerCase();
  if (/^(pending|queued|processing|running|submitted|in_progress)$/.test(state)) {
    return { status: 'processing', message: 'Video masih diproses oleh Cloudflare; jangan mengirim ulang untuk menghindari biaya ganda.' };
  }
  return null;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, private');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'POST') return fail(res, 405, 'Gunakan POST.');
  if (!configured()) return fail(res, 503, 'Text-to-Video belum siap. Periksa aktivasi, persetujuan billing, kode akses, dan Cloudflare.');
  const origin = req.headers?.origin;
  if (origin && origin !== allowedOrigin()) return fail(res, 403, 'Asal permintaan tidak diizinkan.');
  if (!/^application\/json(?:\s*;|$)/i.test(String(req.headers?.['content-type'] || ''))) {
    return fail(res, 415, 'Gunakan application/json.');
  }
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fail(res, 400, 'Format permintaan tidak valid.');
  if (!safeCodeMatch(process.env.VIDEO_AI_ACCESS_CODE, body.access_code)) return fail(res, 403, 'Kode akses video salah.');
  if (body.confirm_cost !== true) return fail(res, 400, 'Konfirmasi biaya per video wajib disetujui.');
  const { prompt, duration = 5, aspect_ratio = '16:9', resolution = '480p' } = body;
  if (typeof prompt !== 'string' || prompt.trim().length < 8 || prompt.length > 1600) return fail(res, 400, 'Prompt harus 8–1600 karakter.');
  // Limited rollout: one inexpensive tier only until provider spend controls are verified.
  if (duration !== 5 || resolution !== '480p' || !['9:16', '16:9', '1:1'].includes(aspect_ratio)) {
    return fail(res, 400, 'Mode uji coba hanya mendukung 5 detik, 480p, dan rasio 9:16 / 16:9 / 1:1.');
  }
  try {
    const url = 'https://api.cloudflare.com/client/v4/accounts/' +
      encodeURIComponent(process.env.CLOUDFLARE_ACCOUNT_ID) + '/ai/run';
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + process.env.CLOUDFLARE_API_TOKEN,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: MODEL,
        input: { prompt: prompt.trim(), duration, aspect_ratio, resolution }
      }),
      redirect: 'error',
      signal: AbortSignal.timeout(53000)
    });
    if (!response.ok) {
      if (response.status === 429) return fail(res, 429, 'Batas pemakaian Cloudflare tercapai.');
      if (response.status === 402) return fail(res, 402, 'Kredit Cloudflare tidak mencukupi.');
      return fail(res, 502, 'Cloudflare menolak permintaan video (HTTP ' + response.status + ').');
    }
    const text = await response.text();
    if (text.length > 100000) return fail(res, 502, 'Respons Cloudflare terlalu besar.');
    let data;
    try { data = JSON.parse(text); } catch { return fail(res, 502, 'Format respons Cloudflare tidak valid.'); }
    if (data?.success === false) return fail(res, 502, 'Model video tidak dapat memproses permintaan.');
    const output = parseCloudflareResponse(data);
    if (!output) return fail(res, 502, 'Cloudflare belum mengembalikan URL MP4 atau status pekerjaan yang dikenal.');
    return res.status(output.status === 'processing' ? 202 : 200).json(output);
  } catch (e) {
    if (e?.name === 'TimeoutError') {
      return fail(res, 504, 'Batas waktu tercapai. Pekerjaan mungkin masih berjalan dan dikenai biaya; jangan langsung mencoba ulang.');
    }
    return fail(res, 502, 'Layanan video sedang tidak tersedia.');
  }
}
