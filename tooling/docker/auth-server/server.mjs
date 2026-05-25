/**
 * `auth-server` — tunn provisioning-tjänst för self-hosted AVA.
 *
 * Endpoints (alla under `/auth/` när nginx-proxy:as):
 *   GET  /status              → { hasAdmin, totalUsers }
 *   POST /bootstrap           → { secret, email } → { token } — kräver match mot
 *                                bootstrap-secret + hasAdmin=false. Engångs.
 *   POST /redeem-invite       → { inviteToken, email } → { token } — utfärdar PAT
 *   POST /invite              → { adminEmail, adminToken, email, role } → { inviteToken }
 *                                Verifierar att caller är registrerad admin.
 *
 * State lagras i `/data/`:
 *   htpasswd      — användares username (=email) + SHA-hash, läses också av nginx
 *   invites.json  — utfärdade invites + redeem-status
 *   admins.txt    — radseparerad lista över emails som är admin (separat
 *                   från role:n i AVA git-db:n eftersom auth-servern inte
 *                   pratar git)
 *
 * Bootstrap-secret kommer från env BOOT_SECRET. Vid mismatch + hasAdmin=true
 * returneras 403 så token:n inte kan användas efter första provisioneringen.
 *
 * Ingen extern dep — bara node-built-ins.
 */

import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import {
  parseHtpasswd, serializeHtpasswd, upsertHtpasswd, hasAdmin,
  createInvite, findValidInvite, redeemInvite,
  newToken, safeEqual,
} from "./auth-core.mjs";

const PORT = Number(process.env.PORT || 3001);
const DATA_DIR = process.env.DATA_DIR || "/data";
const BOOT_SECRET = process.env.BOOT_SECRET || "";

const HTPASSWD = resolve(DATA_DIR, "htpasswd");
const INVITES = resolve(DATA_DIR, "invites.json");
const ADMINS = resolve(DATA_DIR, "admins.txt");

async function ensureDataDir() {
  await mkdir(DATA_DIR, { recursive: true });
}

async function loadHtpasswd() {
  try {
    return parseHtpasswd(await readFile(HTPASSWD, "utf8"));
  } catch {
    return new Map();
  }
}

async function saveHtpasswd(map) {
  await writeFile(HTPASSWD, serializeHtpasswd(map));
}

async function loadInvites() {
  try {
    return JSON.parse(await readFile(INVITES, "utf8"));
  } catch {
    return [];
  }
}

async function saveInvites(invites) {
  await writeFile(INVITES, JSON.stringify(invites, null, 2));
}

async function loadAdmins() {
  try {
    const text = await readFile(ADMINS, "utf8");
    return new Set(text.split(/\r?\n/).map((s) => s.trim().toLowerCase()).filter(Boolean));
  } catch {
    return new Set();
  }
}

async function saveAdmins(set) {
  await writeFile(ADMINS, [...set].join("\n") + "\n");
}

// ─── Request handlers ────────────────────────────────────────────────────

async function readBody(req) {
  const chunks = [];
  for await (const ch of req) chunks.push(ch);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return null;
  }
}

function json(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(data),
    // Tillåt cross-origin: i dev kallas vi från localhost:3000, prod
    // från samma origin. Reflektera Origin:n och tillåt credentials.
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  });
  res.end(data);
}

async function handleStatus(_req, res) {
  const map = await loadHtpasswd();
  json(res, 200, {
    hasAdmin: hasAdmin(map),
    totalUsers: map.size,
  });
}

async function handleBootstrap(req, res) {
  const body = await readBody(req);
  if (!body || typeof body.secret !== "string" || typeof body.email !== "string") {
    return json(res, 400, { error: "secret + email krävs" });
  }
  if (!BOOT_SECRET) {
    return json(res, 503, { error: "BOOT_SECRET inte konfigurerat på servern" });
  }
  if (!safeEqual(body.secret, BOOT_SECRET)) {
    return json(res, 403, { error: "Felaktig bootstrap-secret" });
  }
  const map = await loadHtpasswd();
  if (hasAdmin(map)) {
    return json(res, 409, { error: "Admin redan provisionerad — bootstrap stängt" });
  }
  const email = String(body.email).toLowerCase().trim();
  const pat = newToken();
  const next = upsertHtpasswd(map, email, pat);
  await saveHtpasswd(next);
  const admins = await loadAdmins();
  admins.add(email);
  await saveAdmins(admins);
  json(res, 200, { email, token: pat, role: "ADMIN" });
}

async function handleInvite(req, res) {
  const body = await readBody(req);
  if (!body) return json(res, 400, { error: "fel JSON" });
  const { adminEmail, adminToken, email, role } = body;
  if (typeof adminEmail !== "string" || typeof adminToken !== "string" || typeof email !== "string") {
    return json(res, 400, { error: "adminEmail + adminToken + email krävs" });
  }
  const map = await loadHtpasswd();
  const admins = await loadAdmins();
  if (!admins.has(adminEmail.toLowerCase())) {
    return json(res, 403, { error: "Bara admins kan bjuda in" });
  }
  const expectedHash = map.get(adminEmail.toLowerCase());
  // Verifiera token genom att hasha + jämföra
  const { hashToken } = await import("./auth-core.mjs");
  if (!expectedHash || !safeEqual(expectedHash, hashToken(adminToken))) {
    return json(res, 401, { error: "Felaktig admin-token" });
  }
  const inv = createInvite(email, typeof role === "string" ? role : "LAWYER");
  const invites = await loadInvites();
  invites.push(inv);
  await saveInvites(invites);
  json(res, 200, { inviteToken: inv.token, expiresAt: inv.expiresAt });
}

async function handleRedeem(req, res) {
  const body = await readBody(req);
  if (!body) return json(res, 400, { error: "fel JSON" });
  const { inviteToken, email } = body;
  if (typeof inviteToken !== "string" || typeof email !== "string") {
    return json(res, 400, { error: "inviteToken + email krävs" });
  }
  const invites = await loadInvites();
  const result = findValidInvite(invites, inviteToken);
  if (!result.ok) return json(res, 400, { error: `Invite: ${result.reason}` });
  if (result.invite.email !== email.toLowerCase().trim()) {
    return json(res, 400, { error: "E-postadressen matchar inte invite:n" });
  }
  const map = await loadHtpasswd();
  const pat = newToken();
  const next = upsertHtpasswd(map, email.toLowerCase().trim(), pat);
  await saveHtpasswd(next);
  if (result.invite.role === "ADMIN") {
    const admins = await loadAdmins();
    admins.add(email.toLowerCase().trim());
    await saveAdmins(admins);
  }
  await saveInvites(redeemInvite(invites, inviteToken));
  json(res, 200, { email: email.toLowerCase().trim(), token: pat, role: result.invite.role });
}

// ─── Router ──────────────────────────────────────────────────────────────

async function handle(req, res) {
  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    });
    return res.end();
  }
  const url = req.url || "/";
  // Strip optional /auth-prefix så vi tolerar både `/status` och `/auth/status`
  const path = url.replace(/^\/auth/, "") || "/";
  try {
    if (req.method === "GET" && (path === "/status" || path === "/")) return await handleStatus(req, res);
    if (req.method === "POST" && path === "/bootstrap") return await handleBootstrap(req, res);
    if (req.method === "POST" && path === "/invite") return await handleInvite(req, res);
    if (req.method === "POST" && path === "/redeem-invite") return await handleRedeem(req, res);
    return json(res, 404, { error: `Okänd path: ${path}` });
  } catch (err) {
    console.error("[auth] fel:", err);
    return json(res, 500, { error: "Internt fel" });
  }
}

// ─── Boot ────────────────────────────────────────────────────────────────

async function main() {
  await ensureDataDir();
  if (!BOOT_SECRET) {
    console.warn("[auth] VARNING: BOOT_SECRET är ej satt. Bootstrap är låst.");
  } else {
    const map = await loadHtpasswd();
    if (!hasAdmin(map)) {
      console.log("[auth] ─────────────────────────────────────────────────");
      console.log("[auth]  Bootstrap-läge: ingen admin existerar än.");
      console.log("[auth]  Använd följande secret på första provisionering:");
      console.log("[auth]");
      console.log(`[auth]    ${BOOT_SECRET}`);
      console.log("[auth]");
      console.log("[auth]  Gå till http://localhost:8080/ava/setup och klistra in.");
      console.log("[auth] ─────────────────────────────────────────────────");
    } else {
      console.log(`[auth] System redan bootstrappat (${map.size} användare).`);
    }
  }
  createServer(handle).listen(PORT, () => {
    console.log(`[auth] lyssnar på :${PORT}`);
  });
}

main().catch((err) => {
  console.error("[auth] startfel:", err);
  process.exit(1);
});
