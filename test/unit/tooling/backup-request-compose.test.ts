/**
 * Backup på begäran (#1431) i produktions-compose:n: containern når hostens
 * backupjobb utan docker- eller host-åtkomst — en skrivbar begärandekatalog
 * och exporterna READ-ONLY, inget annat. Nedladdningen går under /api, där
 * Caddy kräver en oauth2-proxy-session.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest-compat";
import { BACKUP_DOWNLOAD_PATH } from "@/lib/shared/backup";

const DOCKER = join(process.cwd(), "tooling/docker");
const read = (f: string): string => readFileSync(join(DOCKER, f), "utf8");

interface ComposeService { volumes?: string[]; environment?: Record<string, string> }
const production = Bun.YAML.parse(read("docker-compose.production.yml")) as { services: Record<string, ComposeService> };
const server = production.services["server-first"];

describe("produktionsstacken: backup på begäran (#1431)", () => {
  it("servern får katalogerna via miljön", () => {
    expect(server?.environment).toMatchObject({ AVA_BACKUP_EXPORT_DIR: "/data/backup-exports", AVA_BACKUP_REQUEST_DIR: "/data/backup-requests" });
  });

  it("exporterna monteras read-only, begärandekatalogen skrivbar — och ingen docker-socket", () => {
    const volumes = server?.volumes ?? [];
    expect(volumes).toContain("${AVA_BACKUP_EXPORT_HOST_DIR:-/srv/backup-chroot/ava}:/data/backup-exports:ro");
    expect(volumes).toContain("${AVA_BACKUP_REQUEST_HOST_DIR:-/srv/ava/backup-requests}:/data/backup-requests");
    expect(volumes.some((v) => v.includes("docker.sock"))).toBe(false);
  });

  it("begärandekatalogen är den hostens .path-enhet bevakar", () => {
    const unit = readFileSync(join(process.cwd(), "tooling/systemd/ava-backup-request.path"), "utf8");
    expect(unit).toContain("PathChanged=/srv/ava/backup-requests\n");
  });

  it("nedladdningen ligger under /api — bakom Caddys forward_auth", () => {
    expect(BACKUP_DOWNLOAD_PATH.startsWith("/api/")).toBe(true);
    expect(read("caddy/Caddyfile")).toMatch(/handle \/api\/\* \{\s*forward_auth oauth2-proxy:4180/);
  });
});
