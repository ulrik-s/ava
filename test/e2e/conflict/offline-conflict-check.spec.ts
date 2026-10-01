/**
 * Jävskontrollen för ett ärende som skapas offline (#1246) — full self-hosted-stack.
 *
 * Offline har juristen bara sin lokala kopia. Kontrollen avgörs därför av
 * servern när det köade anropet når den, mot byråns alla ärenden:
 *   1. juristen går offline,
 *   2. en kollega (admin, via API:t) gör under avbrottet klienten till motpart
 *      i ett eget ärende — det ser juristens flik inte,
 *   3. juristen lägger upp ett ärende för klienten offline,
 *   4. online igen: servern kör kontrollen och hittar kollegans ärende →
 *      "Jävskontroll: 1 träffar att bedöma" i juristens Att bevaka.
 */
import { asId } from "../../../src/lib/shared/schemas/ids";
import { clientFor, mintToken } from "../../../tooling/scripts/selfhosted-trpc-client";
import { expect, test } from "../_helper-isolation";
import { login } from "./_selfhosted-login";

test("ärende skapat offline: servern kör jävskontrollen och hittar det juristen inte kunde se", async ({ page, context }) => {
  const admin = clientFor(await mintToken("admin", "admin"));
  const stamp = Date.now();
  const klient = await admin.contacts.create.mutate({ name: `Klient ${stamp}`, contactType: "PERSON" });

  await login(page, "lawyer", "lawyer");
  await page.goto("/ava/matters/?new=1");
  await expect(page.getByTestId("sync-pill")).toContainText(/Sparat/, { timeout: 30_000 });

  await context.setOffline(true);

  // Kollegan gör klienten till motpart i ett eget ärende under avbrottet.
  const colleagues = await admin.matter.create.mutate({ title: `Kollegans ärende ${stamp}` });
  await admin.matter.addContact.mutate({ matterId: asId<"MatterId">(colleagues.id), contactId: asId<"ContactId">(klient.id), role: "MOTPART" });

  await page.getByLabel("Titel *").fill(`Offline-uppdrag ${stamp}`);
  await page.getByRole("button", { name: /Välj klient/ }).click();
  await page.getByPlaceholder("Namn, personnummer eller organisationsnummer").fill(`Klient ${stamp}`);
  await page.getByRole("list", { name: "Träffar" }).getByRole("button", { name: new RegExp(`Klient ${stamp}`) }).first().click();
  await page.getByRole("button", { name: "Skapa ärende" }).click();
  await expect(page.getByTestId("sync-pill")).toContainText(/ändring(ar)? väntar/, { timeout: 15_000 });

  await context.setOffline(false);
  await expect(page.getByTestId("sync-pill")).toContainText("Sparat", { timeout: 30_000 });

  // Servern avgjorde: träffen i kollegans ärende.
  const { matters } = await admin.matter.list.query({ search: `Offline-uppdrag ${stamp}` });
  expect(matters[0]).toMatchObject({ conflictCheckStatus: "HITS", conflictCheckHits: 1 });

  await page.goto("/ava/watchlist/");
  await page.getByRole("button", { name: "Jävskontroll" }).click();
  await expect(page.getByText("Jävskontroll: 1 träffar att bedöma").first()).toBeVisible({ timeout: 30_000 });
});
