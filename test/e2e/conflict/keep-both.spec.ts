/**
 * Keep-both-konflikt-e2e (#742) — UI-driven verifiering.
 *
 * Förutsättning (körs av tooling/scripts/conflict-e2e.sh): den fulla
 * self-hosted-stacken (server-first tRPC + oauth2-proxy + Keycloak) är uppe och
 * `conflict-seed.ts` har provocerat fram en RIKTIG dokument-konflikt mellan två
 * användare (lawyer vann v2, admin fick 409 → keep-both-syskon). Seeden skrev
 * ärende-/filnamn till tooling/.conflict-seed.json.
 *
 * Spec:en bevisar att en RIKTIG användare ser resultatet i webb-appen: logga in
 * via Keycloaks formulär (lawyer), navigera till ärendet, och bekräfta att
 * dokumentlistan visar BÅDA filerna — originalet + keep-both-syskonet
 * ("… (din ändring …)"). Det uppfyller #742:s krav att testet ska UTGÅ FRÅN UIt
 * (konflikten provoceras via helperns nätväg; verifieringen sker i UIt).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect, type Page } from "@playwright/test";

interface SeedInfo {
  matterId: string;
  matterNumber: string;
  matterTitle: string;
  originalFileName: string;
  siblingFileName: string;
  siblingId: string;
}

const seed: SeedInfo = JSON.parse(
  readFileSync(join(__dirname, "..", "..", "..", "tooling", ".conflict-seed.json"), "utf8"),
) as SeedInfo;

const AUTHORIZE_RE = /realms\/ava\/protocol\/openid-connect\/auth/;
const onKeycloak = (u: URL): boolean => AUTHORIZE_RE.test(u.toString());

/** Driv Keycloaks login-formulär i browsern; vänta tillbaka till appen. */
async function login(page: Page, username: string, password: string): Promise<void> {
  await page.goto("/ava/");
  await page.waitForURL(AUTHORIZE_RE);
  await page.fill("#username", username);
  await page.fill("#password", password);
  await page.click("#kc-login");
  await page.waitForURL((u) => !onKeycloak(u));
}

test.describe("keep-both-konflikt (#742)", () => {
  test("ärendet visar 2 filer — originalet + keep-both-syskonet", async ({ page }) => {
    await login(page, "lawyer", "lawyer");

    // Hård-ladda den prerenderade ärendelistan, soft-navigera sen in i ärendet
    // via TITEL-länken (ärendenr är bara en <span>) → klient-routing, ingen
    // statisk 404 på den dynamiska detalj-routen.
    await page.goto("/ava/matters/");
    const matterLink = page.getByRole("link", { name: seed.matterTitle });
    await expect(matterLink).toBeVisible({ timeout: 30_000 });
    await matterLink.click();

    // På ärende-sidan: dokumentlistan ska visa BÅDA filerna.
    // - Originalet: substringen "minnesanteckning.txt" finns BARA i originalets
    //   namn (syskonet bryter efter "minnesanteckning (din ändring …").
    // - Syskonet: bär "(din ändring <label>)"-suffixet.
    await expect(page.getByText(seed.originalFileName, { exact: false }).first())
      .toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/din ändring/).first())
      .toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(seed.siblingFileName, { exact: false }).first())
      .toBeVisible({ timeout: 30_000 });
  });
});
