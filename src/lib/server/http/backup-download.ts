/**
 * `GET /api/backup/download?name=ava-<datum>.tar.age` (#1431) — strömmar en
 * krypterad export till en administratör.
 *
 * En HTTP-route och inte tRPC: exporten är databasen + alla dokument, och
 * tRPC-JSON hade lagt hela filen i minnet (och i base64). Här går den bit för
 * bit från disken till webbläsaren, som sparar den direkt.
 *
 * Under `/api` så att Caddy kräver en oauth2-proxy-session (forward_auth)
 * innan servern ens ser anropet. Servern kontrollerar sedan själv att
 * principalen är administratör i byrån — samma allowlist som tRPC-anropen.
 * Namnet valideras mot exporternas form, så det kan aldrig peka ut en annan
 * fil. Varje nedladdning loggas (bara id:n).
 */

import { BACKUP_DOWNLOAD_PATH, backupFileNameSchema, type BackupFileName } from "@/lib/shared/backup";
import { log } from "@/lib/shared/observability/logger";
import type { Principal } from "../auth/principal";
import type { IBackupStore } from "../ports";

export interface BackupDownloadDeps {
  /** Backupporten; saknas den finns ingen backup på begäran här. */
  backup: IBackupStore | undefined;
  /** Den server-verifierade principalen för anropet (samma väg som tRPC). */
  principalFor: (req: Request) => Promise<Principal | null>;
}

function refuse(status: number, message: string): Response {
  return new Response(`${message}\n`, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
}

/** Administratören, eller svaret som nekar. */
async function admin(req: Request, deps: BackupDownloadDeps): Promise<Principal | Response> {
  const principal = await deps.principalFor(req);
  if (!principal) return refuse(401, "Inte inloggad.");
  return principal.role === "ADMIN" ? principal : refuse(403, "Endast administratörer kan ladda ner backuper.");
}

/** Strömma exporten `name` till `principal`. */
async function stream(store: IBackupStore, name: BackupFileName, principal: Principal): Promise<Response> {
  const file = await store.openExport(name);
  if (!file) return refuse(404, "Backupen finns inte (kanske gallrad).");
  log.info("backup.downloaded", { userId: principal.id, orgId: principal.organizationId, ids: [name] });
  return new Response(file.body, {
    status: 200,
    headers: {
      "content-type": "application/octet-stream",
      "content-length": String(file.sizeBytes),
      "content-disposition": `attachment; filename="${name}"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

/** Hantera nedladdningsrouten; null när anropet gäller något annat. */
export async function handleBackupDownload(req: Request, deps: BackupDownloadDeps): Promise<Response | null> {
  const url = new URL(req.url);
  if (url.pathname !== BACKUP_DOWNLOAD_PATH) return null;
  if (req.method !== "GET") return refuse(405, "Endast GET.");
  const principal = await admin(req, deps);
  if (principal instanceof Response) return principal;
  if (!deps.backup) return refuse(404, "Backup på begäran är inte konfigurerad på servern.");
  const name = backupFileNameSchema.safeParse(url.searchParams.get("name"));
  return name.success ? stream(deps.backup, name.data, principal) : refuse(400, "Ogiltigt namn på backupfil.");
}
