/**
 * `POST /compose-mail`-hanteraren: avkoda base64-bilaga, skriv den till
 * en per-session-tempkatalog och öppna OS:ets mail-app med förifyllt
 * kompositions-fönster. Port av Go:s server/compose_mail.go.
 */

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { composeMail, type ComposeMailOpts } from "./platform/mail.ts";
import { json, parseJsonBody, textError } from "./http.ts";
import { isSafeFileName, type ComposeMailRequest } from "@/lib/shared/helper/protocol";

export interface ComposeMailDeps {
  compose: (opts: ComposeMailOpts) => Promise<void>;
  makeSessionDir: () => Promise<string>;
  writeAttachment: (path: string, bytes: Buffer) => Promise<void>;
}

export const defaultComposeMailDeps: ComposeMailDeps = {
  compose: composeMail,
  makeSessionDir: () => mkdtemp(join(tmpdir(), "ava-helper-mail-")),
  writeAttachment: (path, bytes) => writeFile(path, bytes, { mode: 0o600 }),
};

export async function handleComposeMail(
  req: Request,
  deps: ComposeMailDeps = defaultComposeMailDeps,
): Promise<Response> {
  const parsed = await parseComposeRequest(req);
  if (parsed instanceof Response) return parsed;
  return runCompose(parsed.body, parsed.bytes, deps);
}

interface ParsedCompose {
  body: ComposeMailRequest;
  bytes: Buffer;
}

/** Validera + avkoda request → body+bytes, eller en fel-Response. */
async function parseComposeRequest(req: Request): Promise<ParsedCompose | Response> {
  if (req.method !== "POST") return textError(405, "method not allowed");
  const body = await parseJsonBody<ComposeMailRequest>(req);
  if (body === null) return textError(400, "invalid JSON");
  if (!body.fileName || !body.contentBase64) return textError(400, "fileName and contentBase64 required");
  if (!isSafeFileName(body.fileName)) return textError(400, "invalid fileName");
  const bytes = decodeBase64(body.contentBase64);
  if (bytes === null) return textError(400, "invalid base64");
  return { body, bytes };
}

async function runCompose(body: ComposeMailRequest, bytes: Buffer, deps: ComposeMailDeps): Promise<Response> {
  const attachmentPath = join(await deps.makeSessionDir(), body.fileName);
  const writeErr = await tryStep(() => deps.writeAttachment(attachmentPath, bytes), "write failed");
  if (writeErr) return writeErr;
  const composeErr = await tryStep(
    () => deps.compose({ to: body.to ?? "", subject: body.subject ?? "", body: body.body ?? "", attachmentPath }),
    "compose-mail failed",
  );
  if (composeErr) return composeErr;
  return json({ path: attachmentPath, status: "opened" });
}

/** Kör ett IO-steg; null vid framgång, annars en 500-Response. */
async function tryStep(fn: () => Promise<void>, label: string): Promise<Response | null> {
  try {
    await fn();
    return null;
  } catch (err) {
    return textError(500, `${label}: ${errMsg(err)}`);
  }
}

/** Strikt base64-avkodning; null om strängen inte är giltig base64. */
function decodeBase64(s: string): Buffer | null {
  const buf = Buffer.from(s, "base64");
  // Buffer.from är förlåtande; verifiera round-trip för att avvisa skräp
  // (motsvarar Go:s base64.StdEncoding.DecodeString-fel).
  if (buf.toString("base64").replace(/=+$/, "") !== s.replace(/=+$/, "")) {
    return null;
  }
  return buf;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
