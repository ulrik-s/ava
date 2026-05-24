/**
 * AVA GitHub OAuth Device Flow-proxy för Cloudflare Workers.
 *
 * Varför behövs detta?
 *   GitHub:s OAuth-endpoints (github.com/login/device/code och
 *   github.com/login/oauth/access_token) saknar CORS-header. Browser:n
 *   blockar därför direkta fetch:s från en GH Pages-deploy. Den här
 *   workern ligger emellan: tar emot vår fetch, gör calls mot GitHub,
 *   och sätter `Access-Control-Allow-Origin` så browser:n släpper in
 *   svaret.
 *
 * Vad lagras i workern?
 *   - GITHUB_CLIENT_SECRET (Worker-secret) — användarnas tokens
 *     passerar aldrig genom worker:n, bara request/response för
 *     själva auth-flowet.
 *
 * Endpoints
 *   POST /device/code              → returnerar device_code, user_code,
 *                                     verification_uri, expires_in,
 *                                     interval
 *   POST /token  { device_code }   → polla GitHub om device_code:n
 *                                     blivit godkänd. Returnerar
 *                                     access_token eller error.
 *
 * Deploy
 *   wrangler init ava-oauth-proxy --type ts
 *   # kopiera den här filen till src/index.ts
 *   wrangler secret put GITHUB_CLIENT_SECRET
 *   # sätt CLIENT_ID i wrangler.toml [vars]
 *   wrangler deploy
 *
 * GitHub OAuth App-setup
 *   https://github.com/settings/developers → New OAuth App
 *   - Application name: AVA
 *   - Homepage URL: <din-deploy>
 *   - Authorization callback URL: <din-worker>/callback  (krävs men
 *     används inte i device-flow)
 *   - **Enable Device Flow** ✓
 *
 * Säkerhet
 *   - CORS-header begränsas till din AVA-deploy-origin (env.AVA_ORIGIN)
 *   - Inga loggningar av tokens
 *   - Stateless — worker:n håller ingen data
 */

interface Env {
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  AVA_ORIGIN: string;
}

const SCOPES = "repo,user:email";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const cors = corsHeaders(env);
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });

    const url = new URL(request.url);
    try {
      if (url.pathname === "/device/code") return await deviceCode(env, cors);
      if (url.pathname === "/token") return await pollToken(request, env, cors);
      return json({ error: "Not found" }, 404, cors);
    } catch (err) {
      return json({ error: err instanceof Error ? err.message : String(err) }, 500, cors);
    }
  },
};

function corsHeaders(env: Env): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": env.AVA_ORIGIN || "*",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function json(data: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...cors },
  });
}

async function deviceCode(env: Env, cors: Record<string, string>): Promise<Response> {
  const res = await fetch("https://github.com/login/device/code", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, scope: SCOPES }),
  });
  const data = await res.json();
  return json(data, res.status, cors);
}

async function pollToken(req: Request, env: Env, cors: Record<string, string>): Promise<Response> {
  const body = await req.json().catch(() => ({})) as { device_code?: string };
  if (!body.device_code) return json({ error: "missing device_code" }, 400, cors);

  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      device_code: body.device_code,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    }),
  });
  const data = await res.json();
  return json(data, res.status, cors);
}
