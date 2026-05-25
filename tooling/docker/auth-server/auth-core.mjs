/**
 * `auth-core` — rena helpers för auth-tjänsten.
 *
 * Ingen I/O här. Alla side-effects (read/write htpasswd, invites.json)
 * sköts av server-handlern; helpers tar in/returnerar data så de kan
 * unit-testas utan filsystem.
 */

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

// ─── bcrypt-kompatibel hashing ────────────────────────────────────────────
//
// nginx auth_basic_user_file förstår bcrypt ($2a$/$2b$/$2y$) och
// crypt(3)-MD5 ($apr1$). Vi använder ett enkare alternativ som nginx
// stödjer: SHA-1 ({SHA}base64). Inte stark mot offline-brute force, men
// vi använder TOKEN-länga 32 bytes → 256 bits entropi → praktiskt
// omöjligt att gissa även med svag hashning. Och vi slipper bcrypt-dep.
//
// För produktion med långvariga lösenord vill du byta till bcrypt
// (via t.ex. `htpasswd -B`). Tokens är ok.
import { createHash } from "node:crypto";

export function hashToken(token) {
  return "{SHA}" + createHash("sha1").update(token).digest("base64");
}

/** Konstant-tid jämförelse mellan två tokens (mot timing-attacks). */
export function safeEqual(a, b) {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** Generera en URL-säker token. 32 bytes → ~43 chars base64url. */
export function newToken() {
  return randomBytes(32).toString("base64url");
}

// ─── htpasswd-format ──────────────────────────────────────────────────────

/** Parse:a htpasswd-content → Map<username, hash>. Skippar tomma rader. */
export function parseHtpasswd(content) {
  const out = new Map();
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const colon = trimmed.indexOf(":");
    if (colon < 0) continue;
    out.set(trimmed.slice(0, colon), trimmed.slice(colon + 1));
  }
  return out;
}

export function serializeHtpasswd(map) {
  const lines = [];
  for (const [user, hash] of map) lines.push(`${user}:${hash}`);
  return lines.join("\n") + "\n";
}

/** Lägg till eller uppdatera en användares hash. Pure → returnerar ny Map. */
export function upsertHtpasswd(map, username, token) {
  const next = new Map(map);
  next.set(username, hashToken(token));
  return next;
}

// ─── Invites-modell ───────────────────────────────────────────────────────

/**
 * En invite är: {token, email, role, expiresAt, redeemedAt}.
 * Lagras som JSON-array i en fil. När redeemedAt sätts är token:n förbrukad.
 *
 * `now` injicerbar för deterministiska tester.
 */
export function createInvite(email, role, opts = {}) {
  const ttlMs = opts.ttlMs ?? 7 * 24 * 60 * 60 * 1000; // 7 dygn default
  const now = opts.now ?? new Date();
  return {
    token: newToken(),
    email: email.toLowerCase().trim(),
    role,
    expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
    redeemedAt: null,
  };
}

export function findValidInvite(invites, token, now = new Date()) {
  for (const inv of invites) {
    if (!safeEqual(inv.token, token)) continue;
    if (inv.redeemedAt) return { ok: false, reason: "already-redeemed" };
    if (new Date(inv.expiresAt) < now) return { ok: false, reason: "expired" };
    return { ok: true, invite: inv };
  }
  return { ok: false, reason: "not-found" };
}

export function redeemInvite(invites, token, now = new Date()) {
  return invites.map((inv) =>
    safeEqual(inv.token, token) ? { ...inv, redeemedAt: now.toISOString() } : inv,
  );
}

// ─── Bootstrap state ──────────────────────────────────────────────────────

/**
 * `has-admin` baseras på htpasswd:t. Om det finns minst en användare
 * räknas systemet som bootstrappat. Bootstrap-secret:n kan då inte
 * användas igen (server-sidan vägrar).
 */
export function hasAdmin(htpasswdMap) {
  return htpasswdMap.size > 0;
}
