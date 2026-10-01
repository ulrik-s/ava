/**
 * E2E (#1345): en jurist (inte administratör) registrerar tid i ärendet.
 *
 * `timeEntry.create` kräver nu att ärendet och juristen finns i byrån och
 * avvisar setup-fält (annan användare, eget á-pris, fakturakoppling,
 * skapad-datum) för icke-administratörer. UI:t skickar inga sådana fält — det
 * här testet visar att det vanliga flödet fortsätter fungera för en jurist.
 */

import { DEMO_BASE_URL, expect, fetchDemoSeed, matterIdWith, seedDemoConfig, test } from "./_demo-test";

test("en jurist registrerar tid i ärendet och posten syns i tidslistan", async ({ page, baseURL }) => {
  const base = (baseURL ?? DEMO_BASE_URL).replace(/\/+$/, "");
  const meta = await (await page.request.get(`${base}/.ava/meta.json`)).json() as {
    organizationId: string;
    users: Array<{ id: string; name: string; role: string }>;
  };
  const lawyer = meta.users.find((u) => u.role === "LAWYER");
  expect(lawyer, "demon har en jurist").toBeDefined();
  await seedDemoConfig(page, { principalId: lawyer?.id ?? "", organizationId: meta.organizationId, authorName: lawyer?.name ?? "" });
  const matterId = matterIdWith(await fetchDemoSeed(page, base), "timeEntries");

  await page.goto(`${base}/matters/${matterId}/`, { waitUntil: "load" });
  const tid = page.getByRole("region", { name: "Tid" }).last();
  await expect(tid).toBeVisible({ timeout: 25_000 });
  await tid.getByRole("button", { name: /Registrera tid/ }).click();

  const dialog = page.getByRole("dialog", { name: "Registrera tid" });
  const description = "E2E: genomgång av stämningsansökan (#1345)";
  await dialog.getByLabel("Beskrivning *").fill(description);
  await dialog.locator("button[type=submit]").click();

  await expect(dialog).toHaveCount(0);
  await expect(tid.getByText(description)).toBeVisible();
});
