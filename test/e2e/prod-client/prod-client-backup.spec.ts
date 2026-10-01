/**
 * "Ta backup nu" i prod-klienten genom prod-Caddyn (#1431).
 *
 * Administratören (caddy-e2e@byra.se, seedad som admin) klickar i
 * Inställningar → Backup. Testet spelar hosten: när servern lagt sin begäran
 * skriver det en låtsasexport med checksumma i exportkatalogen som
 * server-first har monterad (docker-compose.server-first.yml), som
 * `ava-backup.service` gör i prod. Webbläsaren ska då ladda ner exakt den
 * filen — genom Caddy, oauth2-proxy-stubben och serverns adminkontroll.
 *
 * Kräver `AVA_BACKUP_E2E_DIR` (värdens sida av bind-mountarna); utan den
 * hoppas testet över.
 */

import { createHash, randomBytes } from "node:crypto";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { expect, test } from "../_helper-isolation";

const DIR = process.env.AVA_BACKUP_E2E_DIR ? resolve(process.env.AVA_BACKUP_E2E_DIR) : null;

/** Töm katalogerna: tidigare E2E-steg har tagit backup, och knappen väntar då tio minuter. */
function reset(dir: string): void {
  for (const sub of ["exports", "requests"]) {
    for (const f of readdirSync(join(dir, sub))) rmSync(join(dir, sub, f), { force: true });
  }
}

/** Som backup-export.sh: `ava-<YYYY-MM-DD-HHMM>.tar.age` + `.sha256`. */
function writeFakeExport(dir: string): { name: string; sha: string } {
  const at = new Date();
  const p = (n: number): string => String(n).padStart(2, "0");
  const name = `ava-${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())}-${p(at.getHours())}${p(at.getMinutes())}.tar.age`;
  const bytes = randomBytes(256 * 1024);
  const sha = createHash("sha256").update(bytes).digest("hex");
  writeFileSync(join(dir, "exports", name), bytes);
  writeFileSync(join(dir, "exports", `${name}.sha256`), `${sha}  ${name}\n`);
  return { name, sha };
}

test("admin: Ta backup nu → hosten skriver exporten → webbläsaren laddar ner den", async ({ page }) => {
  test.skip(DIR === null, "AVA_BACKUP_E2E_DIR saknas (kör via caddy-prod-e2e.sh mot server-first)");
  if (DIR === null) return;
  reset(DIR);

  await page.goto("/settings/");
  await page.getByRole("tab", { name: /^Backup/ }).first().click({ timeout: 30_000 });
  const section = page.getByTestId("backup-section");
  await expect(section.getByText(/privata age-nyckel/)).toBeVisible();
  await expect(section.getByText("Ingen backup finns än.")).toBeVisible();

  await section.getByRole("button", { name: "Ta backup nu" }).click();
  await expect(section.getByRole("status")).toContainText("Backup pågår");
  await expect.poll(() => existsSync(join(DIR, "requests", "request.json"))).toBe(true);

  const downloadStarted = page.waitForEvent("download", { timeout: 30_000 });
  const fake = writeFakeExport(DIR);
  const download = await downloadStarted;
  expect(download.suggestedFilename()).toBe(fake.name);
  const saved = await download.path();
  expect(createHash("sha256").update(readFileSync(saved)).digest("hex")).toBe(fake.sha);
  await expect(section.getByTestId("backup-sha256")).toHaveText(fake.sha);
  await expect(section.getByRole("button", { name: "Ta backup nu" })).toBeDisabled();
});
