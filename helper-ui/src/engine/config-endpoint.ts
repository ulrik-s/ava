/**
 * `POST /config` (ADR 0029) — web-appen auto-konfigurerar helpern: den postar
 * serverns OIDC-config hit och helpern skriver sin `helper-config.json`, så
 * icke-tekniska användare slipper skapa config-filer för hand. Endast localhost
 * + AVA-origins (CORS i server.ts). IO injicerat → testbart.
 */

import type { HelperConfigRequest } from "@/lib/shared/helper/protocol";
import { json, parseJsonBody, textError } from "./http.ts";
import { log } from "./log.ts";

export interface ConfigDeps {
  /** Spara configen; returnerar något sanningsenligt vid framgång, null annars. */
  save: (input: HelperConfigRequest) => object | null;
}

export async function handleConfig(req: Request, deps: ConfigDeps): Promise<Response> {
  if (req.method !== "POST") return textError(405, "method not allowed");
  const body = await parseJsonBody<HelperConfigRequest>(req);
  if (!body || typeof body.oidcIssuer !== "string" || body.oidcIssuer.trim() === "") {
    return textError(400, "oidcIssuer required");
  }
  if (!deps.save(body)) return textError(500, "could not persist config");
  log(`config: konfigurerad av web-appen (issuer ${body.oidcIssuer})`);
  return json({ status: "configured", oidcIssuer: body.oidcIssuer });
}
