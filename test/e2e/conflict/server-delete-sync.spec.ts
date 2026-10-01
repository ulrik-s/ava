/**
 * Radering direkt på servern når en annan klient (#1234) — full self-hosted-stack.
 *
 * Routrarnas `hardDelete` loggade inget i `change_log` när de kördes direkt mot
 * Postgres (här: en kollegas anrop över /api/trpc, samma väg som helpern,
 * CLI:t och serverns omkörning av köade procedurer). Webbläsaren som redan
 * hade raden lokalt fick då aldrig någon tombstone och visade den för alltid.
 *
 * Ingen omladdning med flit: delta-markören ligger bara i minnet, så en
 * omladdning gör en FULL pull som råkar upptäcka att raden saknas. Felet syns
 * i den löpande synken — här triggad av att nätet går ner och kommer tillbaka
 * (samma `online`-väg som efter ett avbrott).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { BrowserContext } from "@playwright/test";

import { asId } from "../../../src/lib/shared/schemas/ids";
import { clientFor, mintToken } from "../../../tooling/scripts/selfhosted-trpc-client";
import { expect, test } from "../_helper-isolation";
import { login } from "./_selfhosted-login";

const seed = JSON.parse(
  readFileSync(join(__dirname, "..", "..", "..", "tooling", ".conflict-seed.json"), "utf8"),
) as { matterId: string; matterTitle: string };

/** Nätet ner och upp → appens `online`-hanterare synkar (delta-pull från markören). */
async function reconnect(context: BrowserContext): Promise<void> {
  await context.setOffline(true);
  await context.setOffline(false);
}

test("kollegan raderar en kontakt på servern → den försvinner i webbläsaren efter synk", async ({ page, context }) => {
  await login(page, "lawyer", "lawyer");
  const admin = clientFor(await mintToken("admin", "admin"));

  const name = `Raderas på servern ${Date.now()}`;
  const contact = await admin.contacts.create.mutate({ name, contactType: "PERSON" });

  await page.goto("/ava/contacts/");
  await expect(page.getByText(name).first()).toBeVisible({ timeout: 30_000 });

  await admin.contacts.delete.mutate({ id: contact.id });

  await reconnect(context);
  await expect(page.getByText(name)).toHaveCount(0, { timeout: 15_000 });
});

test("kollegan raderar en tidspost på servern → den försvinner i ärendet", async ({ page, context }) => {
  await login(page, "lawyer", "lawyer");
  const admin = clientFor(await mintToken("admin", "admin"));

  const description = `Tidspost raderas på servern ${Date.now()}`;
  const entry = await admin.timeEntry.create.mutate({
    matterId: asId<"MatterId">(seed.matterId), date: new Date().toISOString().slice(0, 10), minutes: 15, description,
  });

  await page.goto(`/ava/matters/${seed.matterId}/`);
  await expect(page.getByText(description).first()).toBeVisible({ timeout: 30_000 });

  await admin.timeEntry.delete.mutate({ id: entry.id });

  await reconnect(context);
  await expect(page.getByText(description)).toHaveCount(0, { timeout: 15_000 });
});
