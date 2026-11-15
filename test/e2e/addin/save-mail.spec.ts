/**
 * Outlook-tillägget i en riktig webbläsare (Chromium + WebKit): den byggda
 * task-panen under /addin/, fake-Office i stället för Microsofts office.js,
 * fasta token i stället för NAA (config.js), och
 * tooling/scripts/addin-e2e-server.ts med den riktiga tRPC-handlern och en
 * Graph-fejk.
 *
 * Det som INTE testas här: att Outlooks riktiga Office.js och NAA beter sig
 * som `OfficeLike`/`AddinTokens` antar — det kräver en Outlook-värd (piloten).
 */

import { expect, type Page, test } from "@playwright/test";
import { DEFAULT_MAIL, installFakeOffice } from "../../helpers/office-fake";

const MAIL_TOKEN = "e2e-mail-token"; // = ADDIN_E2E_MAIL_TOKEN i servern

/** Ersätt installationens config.js (t.ex. en jurist som saknas i AVA). */
async function withConfig(page: Page, config: object | undefined): Promise<void> {
  await page.route("**/addin/config.js", (route) =>
    route.fulfill({ contentType: "text/javascript", body: `window.AVA_ADDIN = ${config ? JSON.stringify(config) : "undefined"};` }));
}

const tokensConfig = (baseURL: string, tokens: { ava: string; graph: string }) => ({
  clientId: "e2e-client", tenantId: "e2e-tenant", graphBaseUrl: `${baseURL}/graph/v1.0`,
  staticTokens: { ...tokens, name: "Test Testsson" },
});

async function openPane(page: Page): Promise<void> {
  // Microsofts office.js får inte laddas: den skulle skriva över fake:n (och kräva nätet).
  await page.route("https://appsforoffice.microsoft.com/**", (route) =>
    route.fulfill({ contentType: "text/javascript", body: "/* office.js ersatt av fake-Office i E2E */" }));
  await page.addInitScript(installFakeOffice, { item: DEFAULT_MAIL });
  await page.goto("/addin/taskpane.html");
}

/** Ärendets id via serverns tRPC (som tillägget). */
async function matterIdByNumber(page: Page, number: string): Promise<string> {
  const input = encodeURIComponent(JSON.stringify({ "0": { json: { search: number, pageSize: 8 } } }));
  const res = await page.request.get(`/api/trpc/matter.list?batch=1&input=${input}`, { headers: { authorization: "Bearer e2e-admin" } });
  const body = (await res.json()) as Array<{ result: { data: { json: { matters: Array<{ id: string; matterNumber: string }> } } } }>;
  const hit = body[0]?.result.data.json.matters.find((m) => m.matterNumber === number);
  if (!hit) throw new Error(`hittade inte ärende ${number}`);
  return hit.id;
}

async function searchAndPick(page: Page): Promise<string> {
  await page.locator("#q").fill("20");
  const first = page.locator("#results .matter").first();
  await expect(first).toBeVisible();
  await first.click();
  await expect(first).toHaveClass(/sel/);
  return ((await first.textContent()) ?? "").split(" — ")[0]?.trim() ?? "";
}

test("inloggad via Outlook: sparar det öppna mejlet och tidsposten i valt ärende", async ({ page }) => {
  await openPane(page);
  await expect(page.locator("#who")).toHaveText("Inloggad som Björn Bauer");
  await expect(page.locator("#save")).toBeDisabled();
  const number = await searchAndPick(page);
  await page.locator("#minutes").fill("0,25");
  await expect(page.locator("#save")).toBeEnabled();
  await page.locator("#save").click();

  await expect(page.locator("#status")).toHaveText(`✓ Sparat i ${number}`);
  await expect(page.locator("#status")).toHaveClass(/ok/);

  // Serversidan: exakt det mejl Graph gav, och 15 minuters tid.
  const id = await matterIdByNumber(page, number);
  const saved = (await (await page.request.get(`/__e2e/matter/${encodeURIComponent(id)}`)).json()) as {
    mails: Array<{ title: string; content: string | null }>; time: Array<{ minutes: number }>;
  };
  const mail = saved.mails.find((m) => m.title === DEFAULT_MAIL.subject);
  expect(mail?.content).toContain("Hej! Här kommer underlaget.");
  expect(saved.time.some((t) => t.minutes === 15)).toBe(true);
});

test("AVA känner inte igen inloggningen: begripligt fel, inget kan sökas", async ({ page, baseURL }) => {
  await withConfig(page, tokensConfig(baseURL ?? "", { ava: "okänd-token", graph: MAIL_TOKEN }));
  await openPane(page);
  await page.locator("#q").fill("20");
  await expect(page.locator("#status")).toContainText("Sök misslyckades");
  await expect(page.locator("#status")).toContainText("kände inte igen inloggningen");
  await expect(page.locator("#save")).toBeDisabled();
});

test("installationen saknar konfiguration: panelen säger det", async ({ page }) => {
  await withConfig(page, undefined);
  await openPane(page);
  await expect(page.locator("#app")).toContainText("inte konfigurerat");
});

test("Graph vägrar: felet visas och knappen går att trycka igen", async ({ page, baseURL }) => {
  await withConfig(page, tokensConfig(baseURL ?? "", { ava: "e2e-admin", graph: "fel-graph-token" }));
  await openPane(page);
  await searchAndPick(page);
  await page.locator("#save").click();
  await expect(page.locator("#status")).toContainText("Misslyckades");
  await expect(page.locator("#status")).toHaveClass(/err/);
  await expect(page.locator("#save")).toBeEnabled();
});

test("ogiltig tid stoppas innan något skickas", async ({ page }) => {
  await openPane(page);
  await searchAndPick(page);
  await page.locator("#minutes").fill("abc");
  await page.locator("#save").click();
  await expect(page.locator("#status")).toHaveClass(/err/);
  await expect(page.locator("#status")).not.toContainText("Sparat");
});
