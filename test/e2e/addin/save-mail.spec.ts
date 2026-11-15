/**
 * Outlook-tillägget i en riktig webbläsare (Chromium + WebKit): den byggda
 * task-panen, fake-Office i stället för Microsofts office.js, och
 * tooling/scripts/addin-e2e-server.ts med den riktiga tRPC-handlern.
 *
 * Det enda som INTE testas här är att Outlooks riktiga Office.js beter sig
 * som `OfficeLike` antar — det kräver en Outlook-värd.
 */

import { expect, type Page, test } from "@playwright/test";
import { DEFAULT_MAIL, type FakeOfficeConfig, installFakeOffice } from "../../helpers/office-fake";

const MAIL_TOKEN = "e2e-mail-token"; // = ADDIN_E2E_MAIL_TOKEN i servern

async function openPane(page: Page, baseURL: string, overrides: Partial<FakeOfficeConfig> = {}): Promise<void> {
  // Microsofts office.js får inte laddas: den skulle skriva över fake:n (och kräva nätet).
  await page.route("https://appsforoffice.microsoft.com/**", (route) =>
    route.fulfill({ contentType: "text/javascript", body: "/* office.js ersatt av fake-Office i E2E */" }));
  const config: FakeOfficeConfig = { item: DEFAULT_MAIL, restUrl: `${baseURL}/rest/api`, callbackToken: MAIL_TOKEN, ...overrides };
  await page.addInitScript(installFakeOffice, config);
  await page.goto("/taskpane.html");
  await expect(page.locator("#server")).toBeVisible();
}

/** Ärendet med lägst nummer bland sökträffarna, via serverns tRPC (som tillägget). */
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

test("sparar det öppna mejlet och tidsposten i valt ärende", async ({ page, baseURL }) => {
  await openPane(page, baseURL ?? "");
  await page.locator("#server").fill(baseURL ?? "");
  await page.locator("#pat").fill("e2e-lawyer");
  const number = await searchAndPick(page);
  await page.locator("#minutes").fill("0,25");
  await expect(page.locator("#save")).toBeEnabled();
  await page.locator("#save").click();

  await expect(page.locator("#status")).toHaveText(`✓ Sparat i ${number}`);
  await expect(page.locator("#status")).toHaveClass(/ok/);

  // Serversidan: exakt det mejl Outlook-REST:en gav, och 15 minuters tid.
  const id = await matterIdByNumber(page, number);
  const saved = (await (await page.request.get(`/__e2e/matter/${encodeURIComponent(id)}`)).json()) as {
    mails: Array<{ title: string; content: string | null }>; time: Array<{ minutes: number }>;
  };
  const mail = saved.mails.find((m) => m.title === DEFAULT_MAIL.subject);
  expect(mail?.content).toContain("Hej! Här kommer underlaget.");
  expect(saved.time.some((t) => t.minutes === 15)).toBe(true);

  // Server och PAT sparas i Outlooks roaming-settings till nästa gång.
  const roaming = await page.evaluate(() => window.Office?.saved);
  expect(roaming).toEqual({ ava_server: baseURL, ava_pat: "e2e-lawyer" });
});

test("förifyller sparad server och PAT från roaming-settings", async ({ page, baseURL }) => {
  await openPane(page, baseURL ?? "", { roaming: { ava_server: baseURL ?? "", ava_pat: "e2e-admin" } });
  await expect(page.locator("#server")).toHaveValue(baseURL ?? "");
  await expect(page.locator("#pat")).toHaveValue("e2e-admin");
});

test("fel PAT: sökningen misslyckas begripligt och inget kan sparas", async ({ page, baseURL }) => {
  await openPane(page, baseURL ?? "");
  await page.locator("#server").fill(baseURL ?? "");
  await page.locator("#pat").fill("fel-token");
  await page.locator("#q").fill("20");
  await expect(page.locator("#status")).toContainText("Sök misslyckades");
  await expect(page.locator("#status")).toHaveClass(/err/);
  await expect(page.locator("#save")).toBeDisabled();
});

test("Outlook ger ingen REST-token: felet visas och knappen går att trycka igen", async ({ page, baseURL }) => {
  await openPane(page, baseURL ?? "", { callbackToken: null });
  await page.locator("#server").fill(baseURL ?? "");
  await page.locator("#pat").fill("e2e-admin");
  await searchAndPick(page);
  await page.locator("#save").click();
  await expect(page.locator("#status")).toContainText("Kunde inte hämta REST-token");
  await expect(page.locator("#save")).toBeEnabled();
});

test("ogiltig tid stoppas innan något skickas", async ({ page, baseURL }) => {
  await openPane(page, baseURL ?? "");
  await page.locator("#server").fill(baseURL ?? "");
  await page.locator("#pat").fill("e2e-admin");
  await searchAndPick(page);
  await page.locator("#minutes").fill("abc");
  await page.locator("#save").click();
  await expect(page.locator("#status")).toHaveClass(/err/);
  await expect(page.locator("#status")).not.toContainText("Sparat");
});
