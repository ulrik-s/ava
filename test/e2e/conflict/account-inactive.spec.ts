/**
 * Spärrat konto mot den fulla self-hosted-stacken (#1962, ADR 0018).
 *
 * Servern svarar `401` med `authFailure: "account-inactive"` på alla anrop när
 * kontot inte längre är aktivt i byrån. Klienten visar då bannern med beskedet,
 * utan "Logga in igen" (en ny inloggning hjälper inte), och kön ligger kvar.
 * När servern godtar anropen igen (kontot återaktiverat) synkas kön av sig
 * själv och bannern försvinner.
 *
 * Spärren efterliknas med `page.route`: ett tRPC-fel per anrop i batchen, med
 * samma form som serverns `errorFormatter` (serialiserat med `superjson`).
 */
import type { Route } from "@playwright/test";
import superjson from "superjson";

import { expect, test } from "../_helper-isolation";
import { login } from "./_selfhosted-login";

const TRPC = "**/api/trpc/**";

/** tRPC-felet servern ger ett spärrat konto, för proceduren `path`. */
function accountInactiveError(path: string): { error: ReturnType<typeof superjson.serialize> } {
  return {
    error: superjson.serialize({
      message: "UNAUTHORIZED",
      code: -32001,
      data: { code: "UNAUTHORIZED", httpStatus: 401, path, authFailure: "account-inactive" },
    }),
  };
}

/** Svara som servern gör för ett spärrat konto: ett fel per anrop i batchen. */
async function refuseAsInactive(route: Route): Promise<void> {
  const url = new URL(route.request().url());
  const paths = decodeURIComponent(url.pathname.replace(/^.*\/api\/trpc\//, "")).split(",");
  const errors = paths.map(accountInactiveError);
  const body = url.searchParams.has("batch") ? errors : errors[0];
  await route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify(body) });
}

test("spärrat konto → bannern utan 'Logga in igen', kön ligger kvar och synkas när kontot är aktivt igen", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, "lawyer", "lawyer");
  await page.goto("/ava/contacts/");
  const pill = page.getByTestId("sync-pill");
  await expect(pill).toContainText("Sparat", { timeout: 45_000 });

  await page.route(TRPC, refuseAsInactive);
  const name = `Spärrad-kontakt ${Date.now()}`;
  await page.getByRole("button", { name: "+ Ny part" }).click();
  await page.getByLabel("Namn *").fill(name);
  await page.getByRole("button", { name: "Spara part" }).click();
  await expect(page.getByText(name).first()).toBeVisible({ timeout: 15_000 });

  const banner = page.getByTestId("reauth-banner");
  await expect(banner).toContainText("Ditt konto är inte längre aktivt i byrån", { timeout: 30_000 });
  await expect(banner.getByRole("button", { name: "Logga in igen" })).toHaveCount(0);
  await expect(pill).toContainText("Synk-fel — försöker igen");

  // Kontot återaktiveras: servern godtar anropen igen.
  await page.unroute(TRPC);
  await expect(pill).toContainText("Sparat", { timeout: 60_000 });
  await expect(banner).toHaveCount(0);

  // Parten finns på servern: sökningen hittar den efter en omladdning.
  await page.reload();
  await expect(pill).toContainText("Sparat", { timeout: 45_000 });
  await page.getByPlaceholder("Sök parter...").fill(name);
  await expect(page.getByText(name).first()).toBeVisible({ timeout: 15_000 });
});
