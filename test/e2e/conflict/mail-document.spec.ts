/**
 * Maila ett ärendedokument från dokumentmenyn (#1951, #1952) — full stack.
 *
 * Ingen riktig Microsoft-inloggning och ingen riktig Graph: konfigurationen i
 * localStorage bär en fast Graph-token (testsömmen i connectorn, som
 * tilläggets `staticTokens`), och `page.route` fejkar Graph och fångar
 * `sendMail`. Ärendet har en klient och en motpart, båda med e-post: Till ska
 * vara klientens adress, och bilagan exakt de uppladdade bytesen.
 */
import type { Route } from "@playwright/test";
import { z } from "zod";

import { parseJsonWith } from "../../../src/lib/shared/parse-json";
import { asId } from "../../../src/lib/shared/schemas/ids";
import { clientFor, mintToken } from "../../../tooling/scripts/selfhosted-trpc-client";
import { flatePdf } from "../../helpers/flate-pdf";
import { expect, test } from "../_helper-isolation";
import { login } from "./_selfhosted-login";

const PDF = Buffer.from(flatePdf([["BREV", "till klienten om nästa steg i ärendet"]]));
const GRAPH_TOKEN = "e2e-graph-token";
const CLIENT_EMAIL = "klient.e2e@example.test";
const OPPONENT_EMAIL = "motpart.e2e@example.test";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** Den del av `sendMail`-anropets kropp som testet läser. */
const sendMailBodySchema = z.object({
  message: z.object({
    toRecipients: z.array(z.object({ emailAddress: z.object({ address: z.string() }) })),
    attachments: z.array(z.object({ name: z.string(), contentBytes: z.string() })),
  }),
});

/** Ett fångat `sendMail`: Authorization-huvudet och meddelandet. */
interface SentMail {
  authorization: string | undefined;
  message: z.infer<typeof sendMailBodySchema>["message"];
}

test.use({ serviceWorkers: "block" }); // page.route ser inte förfrågningar via appens service worker

type Admin = ReturnType<typeof clientFor>;

/** Ett ärende med en klient och en motpart, båda med e-post. */
async function matterWithParties(admin: Admin, title: string): Promise<string> {
  const matter = await admin.matter.create.mutate({ title });
  const matterId = asId<"MatterId">(matter.id);
  const parties = [
    { name: "Klient E2E", email: CLIENT_EMAIL, role: "KLIENT" },
    { name: "Motpart E2E", email: OPPONENT_EMAIL, role: "MOTPART" },
  ] as const;
  for (const p of parties) {
    const contact = await admin.contacts.create.mutate({ name: p.name, contactType: "PERSON", email: p.email });
    await admin.matter.addContact.mutate({ matterId, contactId: asId<"ContactId">(contact.id), role: p.role });
  }
  return matter.id;
}

test("Maila… skickar dokumentet till klienten via Graph, med de uppladdade bytesen som bilaga", async ({ page }) => {
  const admin = clientFor(await mintToken("admin", "admin"));
  const stamp = Date.now();
  const title = `Maila dokument ${stamp}`;
  const fileName = `brev-${stamp}.pdf`;
  const matterId = await matterWithParties(admin, title);

  await page.addInitScript((config) => {
    localStorage.setItem("ava.office365.config", JSON.stringify(config));
  }, { clientId: "e2e-client", tenantId: "e2e-tenant", staticGraphToken: GRAPH_TOKEN });

  const sent: SentMail[] = [];
  await page.route("https://graph.microsoft.com/**", async (route: Route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    if (new URL(req.url()).pathname === "/v1.0/me/sendMail") {
      const body = parseJsonWith(sendMailBodySchema, req.postData() ?? "{}");
      sent.push({ authorization: req.headers()["authorization"], message: body.message });
      return route.fulfill({ status: 202, headers: CORS, body: "" });
    }
    return route.fulfill({ status: 404, headers: CORS, body: "" });
  });

  await login(page, "lawyer", "lawyer");
  await page.goto(`/ava/matters/${matterId}/`);
  await expect(page.getByRole("heading", { name: title })).toBeVisible({ timeout: 30_000 });

  await page.locator('input[type="file"]').first().setInputFiles({ name: fileName, mimeType: "application/pdf", buffer: PDF });
  await page.getByRole("dialog", { name: "Namnge dokumentet" }).getByRole("button", { name: "Spara" }).click();
  const row = page.getByRole("row").filter({ hasText: fileName });
  await expect(row).toBeVisible({ timeout: 30_000 });

  await row.getByLabel("Dokumentåtgärder").click();
  await page.getByRole("menuitem", { name: /Maila…/ }).click();
  const dialog = page.getByRole("dialog", { name: "Maila dokument" });
  await expect(dialog.getByLabel("Till")).toHaveValue(CLIENT_EMAIL, { timeout: 20_000 });

  await dialog.getByRole("button", { name: "Skicka" }).click();
  await expect(dialog.getByRole("status")).toHaveText("Skickat.", { timeout: 30_000 });

  expect(sent).toHaveLength(1);
  const [mail] = sent;
  expect(mail?.authorization).toBe(`Bearer ${GRAPH_TOKEN}`);
  expect(mail?.message.toRecipients.map((r) => r.emailAddress.address)).toEqual([CLIENT_EMAIL]);
  expect(mail?.message.attachments).toHaveLength(1);
  expect(mail?.message.attachments[0]?.name).toBe(fileName);
  expect(Buffer.from(mail?.message.attachments[0]?.contentBytes ?? "", "base64").equals(PDF)).toBe(true);
});
