# AHIM Cloudflare Edge API — staging only

This package is an isolated Cloudflare Workers/Hono backend for AHIM AI Studio.
**The Vercel frontend and existing Vercel API routes remain unchanged.** Running tests
or opening this pull request will not switch user traffic to this Worker.

## Architecture

- **Hono**: routes, CORS and status/error handling.
- **Cloudflare Access JWT**: verified with remote JWKs (issuer, audience, RS256); fail closed.
  Users are identified by a SHA-256 hash of the verified JWT subject, not a client-supplied user ID.
- **D1**: users, history, media ownership, and atomic hourly quotas; parameterized SQL.
- **KV**: non-sensitive model-list cache (10 minute TTL). KV is not used as an authoritative quota counter.
- **R2**: per-user private objects with ownership checked in D1; downloads use attachment/no-store.
- **Workers AI**: text, promptkilat, and image generation through environment AI bindings.
  Models are allowlisted by route; provider availability and quality must be verified against your Cloudflare account.

### Endpoints

| Method | Path | Access | Behavior |
|---|---|---|---|
| GET | /health | Public | Service availability, does not prove backing providers work |
| GET | /v1/me | Access JWT | Profile |
| GET | /v1/models | Access JWT | Cached model configuration |
| POST | /v1/generate | Access JWT | JSON with task: chat, promptkilat or image |
| GET | /v1/history | Access JWT | User-scoped results |
| POST | /v1/media | Access JWT | Raw binary upload (8 MB max) |
| GET | /v1/media/:id | Access JWT | Owner-only attachment |
| DELETE | /v1/media/:id | Access JWT | Owner-only deletion |

AI response (text): JSON {id,task,model,text}. Image response: JSON
{id,task,model,asset_id,download_url}; image bytes must be fetched with a
second authenticated request. This differs from the existing /api/ai binary response:
**do not switch the current frontend until a tested adapter has been added.**

Video generation, Sonex TTS and the Agensi connector remain on the existing Vercel backend.
The Worker is not intended to replace these integrations in this change.

## Prerequisites

Node.js 22+, Cloudflare account, permission to create Workers, D1, KV, R2,
Workers AI; Cloudflare Zero Trust/Access application for this Worker.
Billing, inference quotas, R2 eligibility, and access policies vary by account.

### Local install, build and test

From the repository root:

    cd edge
    npm install
    npm run check
    npm test
    npm run build
    npm run migrate:local
    npm run dev

The Vitest suite runs with Cloudflare's Worker runtime and local D1/KV/R2
bindings. Worker AI is mocked for deterministic tests. It does NOT perform
billable AI inference or prove remote model deployment succeeds.

### Cloudflare Access setup (required)

1. Add an Access policy for **the exact Worker hostname** and permitted
   identities in Cloudflare Zero Trust.
2. Copy the Cloudflare Access team domain such as
   your-team.cloudflareaccess.com and the application's AUD tag.
3. Copy .dev.vars.example to .dev.vars (which is ignored by Git), fill
   ACCESS_TEAM_DOMAIN and ACCESS_AUD.
4. Never use a trust-on-first-use header, an unverified identity header, or
   a client-visible admin secret instead of Access signature verification.
5. Test an authorized user and rejected user before exposing the Worker.
   On production routes, Access must also protect requests before they reach
   the application (defense in depth).

Even if Access is misconfigured at the edge, API routes will reject missing
or invalid signed JWTs. There is intentionally **no dev auth bypass**.
The Access JWT is read from the Cf-Access-Jwt-Assertion header.

### Staging provisioning (manual owner action)

This repository contains **no Cloudflare API tokens** and no live binding IDs.
The Wrangler config uses automatic provisioning for D1/KV/R2 where supported.
Do not run remote deployment until the correct Cloudflare account is selected.

    npx wrangler login
    npx wrangler whoami
    # Set ACCESS_TEAM_DOMAIN and ACCESS_AUD in Cloudflare dashboard
    # or using npx wrangler secret put NAME for each secret.
    npx wrangler deploy

Once provisioning finishes, review/update binding resource IDs and names,
then apply the staging migration (it does not run automatically):

    npx wrangler d1 migrations apply ahim-edge-staging --remote

Run your staged smoke tests using a valid Access session. Use:

    npx wrangler tail

You must not apply migrations to an existing production database without an
approved backup and migration plan.

### Vercel integration gate

Do not set a frontend Worker URL or proxy yet. Before cutover:
- Deploy Worker to an approved staging hostname.
- Configure authenticated user flow from the Vercel frontend. Browser
  cross-origin Access cookies may be blocked; use a same-site custom domain
  or a Vercel BFF with verified end-user identity and scoped service auth.
- Add a Vercel API adapter to preserve existing /api/ai responses.
- Verify chat, promptkilat, image, TTS, Agensi, uploads, quota errors, and
  rollback on HP and desktop.
- Enable routing behind an explicit feature flag, with old Vercel API as
  fallback only for approved routes, never bypassing auth.

### Operational guardrails

- Set account-side request/spend budgets. Model calls may incur cost.
- D1 hourly quota is 20 requests/user by default (AI generations and uploads).
  Change MAX_AI_PER_HOUR only after capacity review.
- Uploaded files are private but D1 metadata may persist after R2 delete
  errors. Configure retention/privacy policies and periodically reconcile
  orphaned objects.
- Logging should not include Authorization tokens, email addresses,
  prompt bodies or entire provider payloads.
- Explicit CORS origin allows AHIM Vercel domain only.
- This is a staging build, **not a production deployment**.
