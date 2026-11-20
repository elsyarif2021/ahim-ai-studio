# Agensi Skills Hub for AHIM AI Studio

## Overview
This integration adds a read-only, user-authorized Agensi marketplace and account-library interface to the existing AHIM website. It **does not** replace the existing Cloudflare AI and Sonex providers or expose an Agensi token to client-side JavaScript.

- UI: \`/agensi.html\`
- Backend: \`/api/agensi\`
- Provider: \`https://mcp.agensi.io/mcp/auth\` (Streamable HTTP MCP)
- Sign-in: OAuth 2.1 authorization code + PKCE (S256), dynamic client registration.
- Scopes: \`read\` only.
- Storage: AES-256-GCM encrypted HttpOnly, Secure, SameSite=Lax browser cookies.
- Vercel env: \`AGENSI_SESSION_SECRET\` (at least 32 random characters), configured for preview/production.

## Supported UI flows
1. Browse static marketplace suggestions while signed out.
2. Click **Hubungkan Agensi**, acknowledge provider's one-active-agent restriction, complete OAuth at Agensi.
3. Search skills via MCP \`search_skills\` and view official marketplace links.
4. View the signed-in account's library via \`my_library\`.
5. Disconnect by clearing this site's OAuth cookies.

**Important:** Agensi currently allows one active agent per account. Completing sign-in to AHIM can revoke another connection (including ChatGPT). The app does not initiate OAuth without a user click.

## Financial safety
The application does **not** invoke \`buy_credits\`, \`get_skill(confirm=true)\`, \`quote_tool\`, \`run_tool\`, or other billable Agensi tools. OAuth requests read-only access; purchasing or executing marketplace skills remains outside the initial release.

## Limitations & verification
- OAuth sign-in and live MCP responses must be manually tested with the account owner's permission; CI unit tests intentionally do not authenticate or make billable calls.
- The integration currently supports skill **discovery and library browsing**, not executing a skill or generating images/video with Agensi tools.
- If Agensi changes OAuth metadata, supported MCP protocol versions, or tool response shapes, adapt the backend.
- Cookies support small per-user sessions without database setup. For multi-user production scale or more complex token lifecycles, replace cookie-based token storage with a server-side encrypted session store and implement refresh locking and rate limiting.
- Vercel READY confirms deployment, not successful OAuth connection.

## Checks
\`\`\`sh
npm run check
npm test
\`\`\`

Visit:
- \`https://ahim-ai-studio.vercel.app/agensi.html\`
- \`https://ahim-ai-studio.vercel.app/api/agensi?op=status\`

Do not add API tokens or OAuth secrets to \`index.html\`, \`agensi.html\`, or committed repository files.

## Optional: run a free video prompt skill (staging)
The Agensi Hub now includes an opt-in **AI Video Prompt Director** text-only console.
It only supports the owned, currently free `ai-video-prompt-director` skill. The server
retrieves the licensed guidance transiently via Agensi OAuth/MCP, never stores it in
GitHub or returns the skill source to the browser, and uses the existing Cloudflare
AI REST credentials for text inference. **It does not render video or execute scripts.**

- Feature is **disabled by default**, including on production.
- Vercel env `AGENSI_TEXT_EXEC_ENABLED=true` enables the console only when
  `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` are also configured.
- **Before enabling**: add enforceable account-side API spend caps and a
  persistent per-identity / per-IP rate limit at the edge or gateway. The
  current serverless function is not itself a distributed rate limiter.
- Users must connect their own Agensi account, own the free skill, enter an idea,
  and explicitly agree to potential Cloudflare inference charges.
- Do not set a paid skill slug, call `get_skill(confirm=true)`, use
  `quote_tool`, or call `run_tool` from this endpoint. All paid Agensi tools remain
  unsupported.
- The OAuth `read` scope, Agensi session policy, and live MCP `get_skill`
  response must be verified manually in staging. If the skill changes price,
  is removed, or requires executable tools, fail closed.
- Set `AGENSI_TEXT_EXEC_ENABLED=false` to immediately turn this feature off.
  Existing Agensi search/library functionality remains available.

### Staging verification
1. Use a preview environment with the feature flag on, provider credentials
   set as encrypted backend secrets, and account billing controls active.
2. Confirm `GET /api/agensi?op=status` exposes only booleans, not tokens.
3. Without login confirm `POST /api/agensi?op=execute` returns 401
   after input validation. Cross-origin requests must return 403.
4. Connect Agensi knowingly (only one active agent per account is supported);
   check free library ownership, then test one short prompt with consent.
5. Confirm returned JSON has `type=text_prompt` and contains no raw licensed
   instructions or user credentials. Check browser mobile and desktop.
6. Confirm disabling the flag blocks all subsequent execution.
