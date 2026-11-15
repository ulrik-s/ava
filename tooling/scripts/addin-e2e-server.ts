#!/usr/bin/env bun
/**
 * Testserver för Outlook-tilläggets E2E (test/e2e/addin/, lager 3–4 i CI).
 *
 * Kör den RIKTIGA tRPC-handlern (`createServerTrpcHandler`, alla routrar) mot
 * den seedade backend:en i minnet, och spelar det som inte går att köra i CI:
 *
 *   - oauth2-proxy: en känd Bearer-token blir en identitet (`x-auth-request-email`),
 *     okänd token blir ingen identitet (→ 401). Klientens egna
 *     `x-auth-request-*` tas alltid bort, som Caddys `copy_headers`.
 *   - Outlooks REST: `GET /rest/api/v2.0/me/messages/<id>/$value` ger ett .eml
 *     om mejl-token:en stämmer.
 *   - `/__e2e/matter/<id>`: vad som sparades (dokument + innehåll + tid), så
 *     att testet kan kontrollera serversidan och inte bara UI-texten.
 *
 * Det byggda tillägget (office-addin/dist) serveras på samma origin.
 *
 *   bun run addin:build && bun tooling/scripts/addin-e2e-server.ts   (port AVA_ADDIN_E2E_PORT, default 3460)
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServerTrpcHandler } from "@/lib/server/http/server-trpc-handler";
import type { IPorts } from "@/lib/server/ports";
import { serveFetchHandler } from "@/lib/shared/http/node-http-adapter";
import { asId } from "@/lib/shared/schemas/ids";
import { createSeededBackend } from "../ava-cli/caller";
import { fileFor } from "./office-addin-serve";

export const ADDIN_E2E_ORG = "firma-ab";
/** Bearer-token → seedanvändare (ADMIN resp. LAWYER). */
export const ADDIN_E2E_TOKENS: Readonly<Record<string, string>> = {
  "e2e-admin": "user@firma.local",
  "e2e-lawyer": "bjorn@firma.local",
};
/** Token:en Outlooks REST godtar (det fake-Office:ns getCallbackTokenAsync ger). */
export const ADDIN_E2E_MAIL_TOKEN = "e2e-mail-token";

export const ADDIN_E2E_EML = [
  "From: Klient <klient@example.se>",
  "To: user@firma.local",
  "Subject: Ang. bouppteckning",
  "Date: Tue, 10 Nov 2026 09:30:00 +0000",
  "MIME-Version: 1.0",
  "Content-Type: text/plain; charset=utf-8",
  "",
  "Hej! Här kommer underlaget.",
  "",
].join("\r\n");

const DIST = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "office-addin", "dist");
const TYPES: Record<string, string> = { html: "text/html; charset=utf-8", js: "text/javascript", png: "image/png" };

/** oauth2-proxy-rollen: identitet ur känd Bearer, aldrig ur klientens egna headers. */
function asProxy(req: Request): Request {
  const headers = new Headers(req.headers);
  const token = (headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  for (const h of ["authorization", "x-auth-request-email", "x-auth-request-user", "x-ava-identity-token"]) headers.delete(h);
  const email = ADDIN_E2E_TOKENS[token];
  if (email) headers.set("x-auth-request-email", email);
  return new Request(req, { headers });
}

function outlookRest(req: Request): Response {
  if (req.headers.get("authorization") !== `Bearer ${ADDIN_E2E_MAIL_TOKEN}`) return new Response("unauthorized", { status: 401 });
  return new Response(ADDIN_E2E_EML, { headers: { "content-type": "message/rfc822" } });
}

function staticFile(path: string, root: string): Response {
  const file = fileFor(path, root);
  if (!file) return new Response("not found", { status: 404 });
  return new Response(readFileSync(file), { headers: { "content-type": TYPES[file.split(".").pop() ?? ""] ?? "application/octet-stream" } });
}

/** Hela testservern som en fetch-handler (testbar utan port). */
export function createAddinE2eHandler(root: string = DIST): (req: Request) => Promise<Response> {
  const backend = createSeededBackend();
  const { repos } = backend;
  // Seed-backend:ens innehållsport är en noop; här sparas bytes:en i minnet så
  // att testet kan kontrollera exakt vad tillägget skickade.
  const files = new Map<string, Uint8Array>();
  const ports: IPorts = {
    ...backend.ports,
    content: {
      write: (path, bytes) => { files.set(path, bytes); return Promise.resolve(); },
      read: (path) => Promise.resolve(files.get(path) ?? null),
      exists: (path) => Promise.resolve(files.has(path)),
    },
  };
  const trpc = createServerTrpcHandler({ repos, ports, organizationId: ADDIN_E2E_ORG });

  const savedFor = async (matterId: string): Promise<Response> => {
    const id = asId<"MatterId">(matterId);
    const docs = await repos.documents.listByMatter(id);
    const mails = await Promise.all(docs.filter((d) => d.mimeType === "message/rfc822").map(async (d) => {
      const bytes = await ports.content.read(d.storagePath);
      return { title: d.title, fileName: d.fileName, content: bytes ? new TextDecoder().decode(bytes) : null };
    }));
    const time = (await repos.timeEntries.listUnfrozenForMatter(id)).map((t) => ({ minutes: t.minutes, description: t.description }));
    return Response.json({ mails, time });
  };

  return async (req) => {
    const path = new URL(req.url).pathname;
    if (path.startsWith("/api/trpc")) return trpc(asProxy(req));
    if (/^\/rest\/api\/v2\.0\/me\/messages\/[^/]+\/\$value$/.test(path)) return outlookRest(req);
    const saved = /^\/__e2e\/matter\/([^/]+)$/.exec(path);
    if (saved?.[1]) return savedFor(decodeURIComponent(saved[1]));
    return staticFile(path, root);
  };
}

if (import.meta.main) {
  const port = Number(process.env.AVA_ADDIN_E2E_PORT ?? 3460);
  serveFetchHandler(createAddinE2eHandler(), { port, hostname: "127.0.0.1" });
  console.log(`[addin-e2e] http://127.0.0.1:${port}/taskpane.html`);
}
