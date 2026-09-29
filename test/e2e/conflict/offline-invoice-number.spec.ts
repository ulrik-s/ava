/**
 * Fakturanumret sätts av servern (#1243, ADR 0012) — full self-hosted-stack.
 *
 * Buggen: klienten räknade fram fakturanumret ur de fakturor den kände till.
 * En jurist som fakturerade offline medan en kollega fakturerade online fick
 * SAMMA nummer som kollegan — en dubblett i serien (17 kap. 24 § 2 ML).
 *
 * Flödet, helt i UI:t för juristen:
 *   1. juristen har ärendet öppet och går offline,
 *   2. en kollega (admin, via API:t) ställer ut en faktura i ett annat ärende —
 *      den får nästa nummer i serien, N,
 *   3. juristen byter ärendet till rättshjälp offline → rådgivningsfakturan
 *      skapas lokalt, med det preliminära numret N (juristen känner inte till
 *      kollegans faktura),
 *   4. online igen: servern ger juristens faktura N+1, och fakturadokumentet
 *      skapas först nu — med serverns nummer, aldrig det preliminära.
 */
import { test, expect } from "@playwright/test";
import { asId } from "../../../src/lib/shared/schemas/ids";
import { clientFor, mintToken } from "../../../tooling/scripts/selfhosted-trpc-client";
import { login } from "./_selfhosted-login";

type Admin = ReturnType<typeof clientFor>;

async function invoiceNumbersOn(admin: Admin, matterId: string): Promise<string[]> {
  const res = await admin.invoice.list.query({ matterId: asId<"MatterId">(matterId) });
  const items = Array.isArray(res) ? res : res.items;
  return items.map((i) => i.invoiceNumber).filter((n): n is string => !!n);
}

async function documentNamesOn(admin: Admin, matterId: string): Promise<string[]> {
  const { documents } = await admin.document.list.query({ matterId: asId<"MatterId">(matterId) });
  return documents.map((d) => d.fileName);
}

test("faktura skapad offline får serverns nummer — ingen dubblett, dokumentet bär serverns nummer", async ({ page, context }) => {
  const admin = clientFor(await mintToken("admin", "admin"));
  const stamp = Date.now();
  const mine = await admin.matter.create.mutate({ title: `Offline-fakturering ${stamp}` });
  const colleagues = await admin.matter.create.mutate({ title: `Kollegans ärende ${stamp}`, paymentMethod: "RATTSHJALP" });

  await login(page, "lawyer", "lawyer");
  await page.goto(`/ava/matters/${mine.id}/`);
  await expect(page.getByRole("heading", { name: `Offline-fakturering ${stamp}` })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("sync-pill")).toContainText(/Sparat/, { timeout: 30_000 });

  await context.setOffline(true);

  // Kollegan fakturerar online under avbrottet → nästa nummer i serien.
  const { invoice: theirs } = await admin.invoice.createRadgivning.mutate({ matterId: asId<"MatterId">(colleagues.id) });
  const taken = theirs.invoiceNumber ?? "";
  expect(taken).toMatch(/^F-\d{4}-\d{4}$/);

  // Juristen byter till rättshjälp offline → rådgivningsfakturan skapas lokalt.
  await page.getByRole("tab", { name: /^Betalningssätt/ }).first().click();
  await page.getByRole("button", { name: "Ändra", exact: true }).first().click();
  await page.getByRole("combobox", { name: "Betalningssätt" }).selectOption("RATTSHJALP");
  await page.getByRole("button", { name: "Spara", exact: true }).click();
  await expect(page.getByTestId("sync-pill")).toContainText(/ändring(ar)? väntar/, { timeout: 15_000 });

  await context.setOffline(false);
  await expect(page.getByTestId("sync-pill")).toContainText("Sparat", { timeout: 30_000 });

  // Servern gav juristens faktura NÄSTA nummer — inte kollegans.
  await expect.poll(() => invoiceNumbersOn(admin, mine.id), { timeout: 30_000 }).toHaveLength(1);
  const [ours] = await invoiceNumbersOn(admin, mine.id);
  expect(ours, "juristens faktura får inte kollegans nummer").not.toBe(taken);
  expect(ours).toBe(`${taken.slice(0, -4)}${String(Number(taken.slice(-4)) + 1).padStart(4, "0")}`);

  // Dokumentet skapas efter synken, med serverns nummer — aldrig det preliminära.
  await expect.poll(() => documentNamesOn(admin, mine.id), { timeout: 45_000 })
    .toContainEqual(expect.stringContaining(`Faktura ${ours}`));
  expect((await documentNamesOn(admin, mine.id)).some((n) => n.includes(`Faktura ${taken}`))).toBe(false);
});
