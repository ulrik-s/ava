/**
 * Prod-klienten genom prod-Caddyn (#1352).
 *
 * Bygget utan demodata (`AVA_BUILD_TARGET=server`) och Caddyfile:ns 404 på
 * demosökvägarna får inte ta något appen själv behöver. Smoken kör den
 * self-hostade appen som i prod — startsidan, ärendelistan och ett riktigt
 * ärende från servern via shell-rewriten (hård navigering till ett runtime-id)
 * — och fäller på varje svar ≥ 400 från den egna originen (utom tRPC:s
 * domän-NOT_FOUND) och varje okastat fel i sidan.
 *
 * Stacken (Caddy + låtsas-oauth2-proxy + server-first med data) startas av
 * `tooling/scripts/caddy-e2e/caddy-prod-e2e.sh`.
 */

import type { APIRequestContext, Page } from "@playwright/test";
import { z } from "zod";

import { expect, test } from "../_helper-isolation";

const PULL = `/api/trpc/sync.pull?batch=1&input=${encodeURIComponent(JSON.stringify({ 0: { json: { sinceCursor: 0 } } }))}`;

const pullSchema = z.array(z.object({
  result: z.object({
    data: z.object({
      json: z.object({ changes: z.array(z.object({ entity: z.string(), row: z.record(z.string(), z.unknown()) })) }),
    }),
  }),
}));

const matterSchema = z.object({ id: z.string().uuid(), title: z.string().min(1) });

/** Ett ärende som servern har — hämtat genom Caddy (forward_auth → server-first). */
async function serverMatter(request: APIRequestContext): Promise<z.infer<typeof matterSchema>> {
  const res = await request.get(PULL);
  expect(res.status()).toBe(200);
  const [batch] = pullSchema.parse(await res.json());
  const row = batch?.result.data.json.changes.find((c) => c.entity === "matter" && c.row.deletedAt == null)?.row;
  return matterSchema.parse(row);
}

/**
 * Ett felsvar från den egna originen som testet ska fälla på. tRPC:s
 * NOT_FOUND (404 under /api/trpc/) är ett domänsvar, inte en saknad fil:
 * ärendesidan förladdar dokumentinnehåll, och dokument som tidigare E2E-steg
 * skapat utan innehåll svarar så. Allt annat ≥ 400 räknas — även 401/403/5xx
 * från /api.
 */
function isProblemResponse(url: string, status: number, origin: string): boolean {
  if (!url.startsWith(origin) || status < 400) return false;
  return !(status === 404 && new URL(url).pathname.startsWith("/api/trpc/"));
}

/** Felsvar och sidfel under testet, som läsbara rader. */
function watch(page: Page, origin: string): string[] {
  const problems: string[] = [];
  page.on("response", (res) => {
    if (isProblemResponse(res.url(), res.status(), origin)) problems.push(`${res.status()} ${res.url()}`);
  });
  page.on("pageerror", (err) => problems.push(`pageerror: ${err.message}`));
  return problems;
}

/** Appen har bootat (inte fastnat på platshållaren eller ett felbesked). */
async function expectAppShell(page: Page): Promise<void> {
  await expect(page.locator("nav").getByRole("link", { name: /Ärenden/ })).toBeVisible();
}

test("startsida, ärendelista och ett ärende via shell-rewriten — utan 404 på samma origin", async ({ page, baseURL }) => {
  const origin = new URL(baseURL ?? "").origin;
  const matter = await serverMatter(page.request);
  const problems = watch(page, origin);

  await page.goto("/");
  await expectAppShell(page);

  // Listan är paginerad: ärendet från pull:en behöver inte stå på sida 1 —
  // kräv bara att listan renderat ärenden från servern.
  await page.goto("/matters/");
  await expectAppShell(page);
  await expect(page.locator('main a[href*="/matters/__shell__"]').first()).toBeVisible();

  // Hård navigering till ett runtime-id: Caddy skriver om till __shell__.
  await page.goto(`/matters/${matter.id}/`);
  await expectAppShell(page);
  await expect(page.locator("body")).toContainText(matter.title);
  expect(new URL(page.url()).pathname).toBe(`/matters/${matter.id}/`);

  await page.waitForLoadState("networkidle");
  expect(problems).toEqual([]);
});
