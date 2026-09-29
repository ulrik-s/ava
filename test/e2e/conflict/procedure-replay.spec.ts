/**
 * Procedur-kön mot full self-hosted-stack (#1265, ADR 0037).
 *
 * Tidsposter köas som ANROP och körs om av servern med samma `appRouter`,
 * som den inloggade användaren. Två flöden som radkön inte klarade:
 *
 *  1. En tidspost skapad offline skapas på servern med samma id och av rätt
 *     användare — servern har räknat fram á-priset, inte klienten.
 *  2. En kollega raderar en tidspost medan juristen ändrar den offline. Radkön
 *     skickade den ändrade RADEN, och servern återskapade den ("update på
 *     saknad rad → create"). Nu körs `timeEntry.update` om på servern, som
 *     svarar NOT_FOUND — posten förblir raderad, också i juristens webbläsare.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { asId } from "../../../src/lib/shared/schemas/ids";
import { clientFor, mintToken } from "../../../tooling/scripts/selfhosted-trpc-client";
import { login } from "./_selfhosted-login";

const seed = JSON.parse(
  readFileSync(join(__dirname, "..", "..", "..", "tooling", ".conflict-seed.json"), "utf8"),
) as { matterId: string };
const matterId = asId<"MatterId">(seed.matterId);

async function openMatter(page: Page): Promise<void> {
  await page.goto(`/ava/matters/${seed.matterId}/`);
  await expect(page.getByRole("button", { name: "+ Registrera tid" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("sync-pill")).toContainText(/Sparat|Inte synkat/, { timeout: 30_000 });
}

test("tidspost skapad offline körs om på servern — samma post, rätt användare", async ({ page, context }) => {
  await login(page, "lawyer", "lawyer");
  await openMatter(page);

  await context.setOffline(true);
  const description = `Offline-tid ${Date.now()}`;
  await page.getByRole("button", { name: "+ Registrera tid" }).click();
  await page.locator("#time-minutes").fill("25");
  await page.locator("#time-description").fill(description);
  await page.getByRole("button", { name: "Spara", exact: true }).click();
  await expect(page.getByText(description).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("sync-pill")).toContainText("1 ändring väntar");

  await context.setOffline(false);
  await expect(page.getByTestId("sync-pill")).toContainText("Sparat", { timeout: 30_000 });

  const admin = clientFor(await mintToken("admin", "admin"));
  const lawyer = clientFor(await mintToken("lawyer", "lawyer"));
  const me = await lawyer.user.current.query();
  const { entries } = await admin.timeEntry.list.query({ matterId, pageSize: 100 });
  const created = entries.filter((e) => e.description === description);
  expect(created).toHaveLength(1);
  expect(created[0]).toMatchObject({ minutes: 25, userId: me?.id });
});

test("offline-ändring av en tidspost som kollegan raderat återuppstår inte", async ({ page, context }) => {
  const admin = clientFor(await mintToken("admin", "admin"));
  const description = `Raderas under avbrottet ${Date.now()}`;
  const entry = await admin.timeEntry.create.mutate({
    matterId, date: new Date().toISOString().slice(0, 10), minutes: 20, description,
  });

  await login(page, "lawyer", "lawyer");
  await openMatter(page);
  const row = page.getByRole("row").filter({ hasText: description });
  await expect(row).toBeVisible({ timeout: 30_000 });

  await context.setOffline(true);
  await row.getByRole("button", { name: "Ändra" }).click();
  await page.locator("#time-description").fill(`${description} (ändrad offline)`);
  await page.getByRole("button", { name: "Spara", exact: true }).click();
  await expect(page.getByText(`${description} (ändrad offline)`).first()).toBeVisible({ timeout: 15_000 });

  await admin.timeEntry.delete.mutate({ id: entry.id });

  await context.setOffline(false);
  await expect(page.getByText(description)).toHaveCount(0, { timeout: 30_000 });

  const { entries } = await admin.timeEntry.list.query({ matterId, pageSize: 100 });
  expect(entries.some((e) => e.id === entry.id), "posten får inte återskapas av offline-ändringen").toBe(false);
});

/**
 * Utläggen (#1276) — samma sak: `expense.update` körs om på servern, som
 * svarar NOT_FOUND för ett utlägg som kollegan raderat. Via radkön hade den
 * ändrade raden återskapat det.
 */
test("offline-ändring av ett utlägg som kollegan raderat återuppstår inte", async ({ page, context }) => {
  const admin = clientFor(await mintToken("admin", "admin"));
  const description = `Utlägg raderas under avbrottet ${Date.now()}`;
  const expense = await admin.expense.create.mutate({
    matterId, date: new Date().toISOString().slice(0, 10), amount: 12_500, description,
  });

  await login(page, "lawyer", "lawyer");
  await openMatter(page);
  await page.getByRole("tab", { name: /^Utlägg/ }).first().click();
  const row = page.getByRole("row").filter({ hasText: description });
  await expect(row).toBeVisible({ timeout: 30_000 });

  await context.setOffline(true);
  await row.getByRole("button", { name: "Ändra" }).click();
  const dialog = page.getByRole("dialog", { name: "Ändra utlägg" });
  await dialog.getByPlaceholder("Beskrivning *").fill(`${description} (ändrad offline)`);
  await dialog.getByRole("button", { name: "Spara ändring" }).click();
  await expect(page.getByText(`${description} (ändrad offline)`).first()).toBeVisible({ timeout: 15_000 });

  await admin.expense.delete.mutate({ id: expense.id });

  await context.setOffline(false);
  await expect(page.getByText(description)).toHaveCount(0, { timeout: 30_000 });

  const { expenses } = await admin.expense.list.query({ matterId, pageSize: 100 });
  expect(expenses.some((e) => e.id === expense.id), "utlägget får inte återskapas av offline-ändringen").toBe(false);
});
