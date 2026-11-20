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
