import { createRemoteJWKSet, jwtVerify } from 'jose';

const keySets = new Map();

function accessSettings(env) {
  const domain = String(env.ACCESS_TEAM_DOMAIN || '').trim().toLowerCase();
  const aud = String(env.ACCESS_AUD || '').trim();
  if (!/^[a-z0-9][a-z0-9.-]*\.cloudflareaccess\.com$/.test(domain) || !aud) {
    throw Object.assign(new Error('Cloudflare Access belum dikonfigurasi.'), { status: 503 });
  }
  return { domain, aud };
}

async function hashIdentity(sub) {
  const bytes = new TextEncoder().encode(sub);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), x => x.toString(16).padStart(2, '0')).join('');
}

export async function verifyAccessIdentity(request, env) {
  const { domain, aud } = accessSettings(env);
  const assertion = request.header('Cf-Access-Jwt-Assertion');
  if (!assertion || assertion.length > 10000) {
    throw Object.assign(new Error('Autentikasi Cloudflare Access diperlukan.'), { status: 401 });
  }
  const issuer = 'https://' + domain;
  let jwks = keySets.get(domain);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(issuer + '/cdn-cgi/access/certs'));
    keySets.set(domain, jwks);
  }
  try {
    const { payload } = await jwtVerify(assertion, jwks, { issuer, audience: aud, algorithms: ['RS256'] });
    if (typeof payload.sub !== 'string' || payload.sub.length < 1 || payload.sub.length > 320) {
      throw new Error('Missing subject');
    }
    const email = typeof payload.email === 'string' && payload.email.length <= 254 ? payload.email : null;
    return { id: await hashIdentity(payload.sub), email };
  } catch {
    throw Object.assign(new Error('Token Cloudflare Access tidak sah atau kedaluwarsa.'), { status: 401 });
  }
}

export async function ensureUser(db, user) {
  await db.prepare(
    "INSERT INTO users (id,email) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET email=excluded.email,last_seen_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')"
  ).bind(user.id, user.email).run();
}
