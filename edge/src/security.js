export function apiError(status, message) {
  return Response.json({ error: message }, { status });
}

export function readLimitFromEnv(env, key, fallback, maximum) {
  const n = Number(env[key]);
  return Number.isInteger(n) && n > 0 ? Math.min(n, maximum) : fallback;
}

export async function readLimited(request, maxBytes) {
  const header = Number(request.headers.get('content-length') || 0);
  if (header > maxBytes) throw Object.assign(new Error('Ukuran permintaan melebihi batas.'), { status: 413 });
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => {});
        throw Object.assign(new Error('Ukuran permintaan melebihi batas.'), { status: 413 });
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

export async function parseJson(c, max = 18000) {
  if (!(c.req.header('content-type') || '').toLowerCase().includes('application/json')) {
    throw Object.assign(new Error('Gunakan application/json.'), { status: 415 });
  }
  const bytes = await readLimited(c.req.raw, max);
  if (!bytes.byteLength) throw Object.assign(new Error('JSON tidak boleh kosong.'), { status: 400 });
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw Object.assign(new Error('Format JSON tidak valid.'), { status: 400 }); }
}

// Atomic D1 quota, unlike KV counters (which are eventually consistent).
export async function consumeQuota(db, userId, limit, now = Date.now()) {
  const hourBucket = Math.floor(now / 3600000);
  const row = await db.prepare(
    "INSERT INTO quotas (user_id,hour_bucket,request_count) VALUES (?,?,1) ON CONFLICT(user_id,hour_bucket) DO UPDATE SET request_count=request_count+1 WHERE request_count < ? RETURNING request_count"
  ).bind(userId, hourBucket, limit).first();
  return row !== null;
}

export function safeContentType(type) {
  return ['image/png','image/jpeg','image/webp','audio/mpeg','audio/wav','audio/ogg','application/pdf'].includes(type);
}
