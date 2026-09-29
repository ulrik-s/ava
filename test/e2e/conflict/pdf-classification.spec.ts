/**
 * PDF-text i den riktiga server-first-imagen (#1156, #1252) — full stack.
 *
 * Buggen: `bun build --compile` tog inte med pdfjs `DOMMatrix`-polyfill eller
 * worker-modul, så varje PDF gav TOM text i prod. Klassificeringen hade bara
 * filnamnet att gå på: "skanning-0042.pdf" blev "Övrigt", och sökningen hittade
 * ingenting i dokumentet.
 *
 * Här laddar juristen upp en komprimerad PDF med svenska tecken och ett
 * intetsägande filnamn i UI:t. Servern (den kompilerade binären i docker, utan
 * LLM) läser texten och klassar dokumentet ur rubriken på första sidan —
 * det kan den bara om PDF-texten faktiskt kommer ut.
 */
import { test, expect } from "@playwright/test";
import { asId } from "../../../src/lib/shared/schemas/ids";
import { clientFor, mintToken } from "../../../tooling/scripts/selfhosted-trpc-client";
import { flatePdf } from "../../helpers/flate-pdf";
import { login } from "./_selfhosted-login";

test("uppladdad PDF klassas ur texten i server-binären — inte ur filnamnet", async ({ page }) => {
  const admin = clientFor(await mintToken("admin", "admin"));
  const stamp = Date.now();
  const matter = await admin.matter.create.mutate({ title: `PDF-klassning ${stamp}` });
  const fileName = `skanning-${stamp}.pdf`;

  await login(page, "lawyer", "lawyer");
  await page.goto(`/ava/matters/${matter.id}/`);
  await expect(page.getByRole("heading", { name: `PDF-klassning ${stamp}` })).toBeVisible({ timeout: 30_000 });

  await page.locator('input[type="file"]').first().setInputFiles({
    name: fileName,
    mimeType: "application/pdf",
    buffer: Buffer.from(flatePdf([
      ["KALLELSE", "till huvudförhandling i Göteborgs tingsrätt"],
      ["STÄMNINGSANSÖKAN", "Käranden yrkar att svaranden förpliktas betala"],
    ])),
  });
  await expect(page.getByText(fileName).first()).toBeVisible({ timeout: 30_000 });

  // Servern klassar: rubriken "KALLELSE" på sidan 1 — filnamnet säger ingenting.
  await expect.poll(async () => {
    const { documents } = await admin.document.list.query({ matterId: asId<"MatterId">(matter.id) });
    const doc = documents.find((d) => d.fileName === fileName);
    return doc ? `${doc.analysisStatus}:${doc.documentType ?? ""}` : "saknas";
  }, { timeout: 60_000 }).toBe("DONE:KALLELSE");

  // …och juristen ser kategorin i dokumentlistan.
  await page.reload();
  const row = page.getByRole("row").filter({ hasText: fileName });
  await expect(row).toContainText("Kallelse", { timeout: 30_000 });
});
