/**
 * Byte av användare och utloggning mot den fulla self-hosted-stacken (#1347,
 * advokatsekretess).
 *
 *   1. Juristen gör en ändring medan servern inte nås och loggar ut ändå
 *      (dialogen: "Du har 1 osynkad ändring"). Utloggningen går via
 *      oauth2-proxys `/oauth2/sign_out`: proxyns session är slut, cachen av
 *      byråns data är raderad — bara hennes osynkade ändring ligger kvar, i
 *      hennes egen databas.
 *   2. Admin loggar in i samma webbläsare: ser aldrig juristens ändring, och
 *      juristens kö spelas aldrig upp i admins namn.
 *   3. Admin loggar ut (inget osynkat → ingen fråga, allt raderas).
 *   4. Juristen loggar in igen: hennes ändring synkas.
 *
 * Servern görs onåbar genom att `/api/trpc` blockeras (inte `setOffline`):
 * navigeringen till `/oauth2/sign_out` och inloggningen måste gå fram.
 * Keycloaks SSO-session finns kvar efter proxyns utloggning (som Entras), så
 * testet tar bort cookies innan nästa användare loggar in — så som IdP:ns
 * utloggning (`AVA_OIDC_END_SESSION_URL`) gör i drift.
 */
import type { Page } from "@playwright/test";

import { expect, test } from "../_helper-isolation";
import { login } from "./_selfhosted-login";

interface Identity { organizationId: string; principalId: string }

/** Den inloggade enligt `ava.firma`. */
async function identity(page: Page): Promise<Identity> {
  return page.evaluate(() => {
    const cfg = JSON.parse(localStorage.getItem("ava.firma") ?? "{}") as Record<string, string>;
    return { organizationId: cfg.organizationId ?? "", principalId: cfg.principalId ?? "" };
  });
}

/** IndexedDB-databasernas namn i webbläsaren. */
async function databases(page: Page): Promise<string[]> {
  return page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name ?? ""));
}

/** Antal köposter i användarens egen kö (0 om databasen inte finns). */
async function queued(page: Page, who: Identity): Promise<number> {
  const name = `ava-mutation-queue@${who.organizationId}:${who.principalId}`;
  return page.evaluate(async (dbName) => {
    if (!(await indexedDB.databases()).some((d) => d.name === dbName)) return 0;
    return new Promise<number>((resolve, reject) => {
      const req = indexedDB.open(dbName);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const count = db.transaction("entries", "readonly").objectStore("entries").count();
        count.onsuccess = () => { db.close(); resolve(count.result); };
      };
    });
  }, name);
}

test("utloggning med en osynkad ändring → nästa användare ser den aldrig; samma användare synkar den senare", async ({ page, context }) => {
  test.setTimeout(240_000);
  await login(page, "lawyer", "lawyer");
  await page.goto("/ava/contacts/");
  const pill = page.getByTestId("sync-pill");
  await expect(pill).toContainText(/Sparat|Inte synkat/, { timeout: 30_000 });
  const lawyer = await identity(page);
  expect(lawyer.principalId).not.toBe("");

  // Servern nås inte → ändringen köas lokalt.
  await page.route("**/api/trpc/**", (route) => route.abort());
  const name = `Sekretess-kontakt ${Date.now()}`;
  await page.getByRole("button", { name: "+ Ny kontakt" }).click();
  await page.getByLabel("Namn *").fill(name);
  await page.getByRole("button", { name: "Spara kontakt" }).click();
  await expect(page.getByText(name).first()).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => queued(page, lawyer), { timeout: 15_000 }).toBe(1);

  // Logga ut → dialogen → "Logga ut ändå".
  await page.getByRole("button", { name: "Logga ut" }).first().click();
  await expect(page.getByTestId("sign-out-unsynced")).toHaveText("Du har 1 osynkad ändring.", { timeout: 15_000 });
  await page.getByRole("button", { name: "Logga ut ändå" }).click();
  await expect(page).toHaveURL(/\/ava\/login\/\?signedOut=1$/, { timeout: 30_000 });
  await expect(page.getByText("Du är utloggad")).toBeVisible();

  // Proxyns session är slut; bara juristens osynkade ändring ligger kvar lokalt.
  expect((await page.request.get("/oauth2/userinfo")).status()).toBe(401);
  const afterLogout = await databases(page);
  expect(afterLogout).not.toContain(`ava-local-store@${lawyer.organizationId}:${lawyer.principalId}`);
  expect(afterLogout).not.toContain("ava-local-store");
  expect(await queued(page, lawyer)).toBe(1);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("ava.firma") ?? "{}").principalId)).toBeUndefined();

  // Admin loggar in i samma webbläsare (IdP:ns session avslutad).
  await page.unroute("**/api/trpc/**");
  await context.clearCookies();
  await login(page, "admin", "admin");
  await page.goto("/ava/contacts/");
  await expect(pill).toContainText("Sparat", { timeout: 45_000 });
  const admin = await identity(page);
  expect(admin.principalId).not.toBe(lawyer.principalId);
  await expect(page.getByText(name)).toHaveCount(0);
  // Juristens kö spelades inte upp i admins namn — den ligger kvar orörd.
  expect(await queued(page, lawyer)).toBe(1);
  expect(await queued(page, admin)).toBe(0);

  // Admin loggar ut: inget osynkat → ingen fråga, allt hennes raderas.
  await page.getByRole("button", { name: "Logga ut" }).first().click();
  await expect(page).toHaveURL(/\/ava\/login\/\?signedOut=1$/, { timeout: 30_000 });
  expect((await databases(page)).filter((n) => n.endsWith(`@${admin.organizationId}:${admin.principalId}`))).toEqual([]);

  // Juristen tillbaka: hennes ändring synkas nu, i hennes namn.
  await context.clearCookies();
  await login(page, "lawyer", "lawyer");
  await page.goto("/ava/contacts/");
  await expect(pill).toContainText("Sparat", { timeout: 45_000 });
  await expect(page.getByText(name).first()).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => queued(page, lawyer), { timeout: 30_000 }).toBe(0);
});
