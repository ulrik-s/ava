/**
 * PDF-text i den riktiga server-first-imagen (#1156, #1252) — full stack.
 *
 * Buggen: `bun build --compile` tog inte med pdfjs `DOMMatrix`-polyfill eller
 * worker-modul, så varje PDF gav TOM text i prod. Klassificeringen hade bara
 * filnamnet att gå på: "skanning-0042.pdf" blev "Övrigt", och sökningen hittade
 * ingenting i dokumentet.
 *
 * Och även när texten kom ut vann klientens gissning: i self-hosted körs
 * `uploadContent` i klienten, vars lokala analyzer skrev "Övrigt" (utan ens
 * filnamnet) och synkade upp det. Servern klassade bara när bytes:en laddades
 * upp — och en fil vars innehåll servern redan hade (samma PDF en gång till)
 * laddas aldrig upp. Då fick den aldrig någon riktig klassning.
 *
 * Här laddar juristen upp en komprimerad PDF med svenska tecken och ett
 * intetsägande filnamn i UI:t — två gånger, så att den andra är en dedup.
 * Servern (den kompilerade binären i docker, utan LLM) läser texten och klassar
 * båda ur rubriken på första sidan.
 */
import { test, expect } from "@playwright/test";
import { asId } from "../../../src/lib/shared/schemas/ids";
import { clientFor, mintToken } from "../../../tooling/scripts/selfhosted-trpc-client";
import { flatePdf } from "../../helpers/flate-pdf";
import { login } from "./_selfhosted-login";

const PDF = Buffer.from(flatePdf([
  ["KALLELSE", "till huvudförhandling i Göteborgs tingsrätt"],
  ["STÄMNINGSANSÖKAN", "Käranden yrkar att svaranden förpliktas betala"],
]));

type Admin = ReturnType<typeof clientFor>;

async function classification(admin: Admin, matterId: string, fileName: string): Promise<string> {
  const { documents } = await admin.document.list.query({ matterId: asId<"MatterId">(matterId) });
  const doc = documents.find((d) => d.fileName === fileName);
  return doc ? `${doc.analysisStatus}:${doc.documentType ?? ""}` : "saknas";
}

test("uppladdad PDF klassas ur texten i server-binären — också när servern redan har innehållet", async ({ page }) => {
  const admin = clientFor(await mintToken("admin", "admin"));
  const stamp = Date.now();
  const matter = await admin.matter.create.mutate({ title: `PDF-klassning ${stamp}` });
  const first = `skanning-${stamp}.pdf`;
  const again = `skanning-${stamp}-kopia.pdf`;

  await login(page, "lawyer", "lawyer");
  await page.goto(`/ava/matters/${matter.id}/`);
  await expect(page.getByRole("heading", { name: `PDF-klassning ${stamp}` })).toBeVisible({ timeout: 30_000 });

  const upload = async (name: string): Promise<void> => {
    await page.locator('input[type="file"]').first().setInputFiles({ name, mimeType: "application/pdf", buffer: PDF });
    await expect(page.getByText(name).first()).toBeVisible({ timeout: 30_000 });
  };
  await upload(first);
  await upload(again); // samma bytes → servern har redan innehållet (dedup på sha)

  // Servern klassar båda: rubriken "KALLELSE" på sidan 1 — filnamnet säger ingenting.
  for (const name of [first, again]) {
    await expect.poll(() => classification(admin, matter.id, name), { timeout: 60_000, message: name }).toBe("DONE:KALLELSE");
  }

  // …och juristen ser kategorin i dokumentlistan.
  await page.reload();
  for (const name of [first, again]) {
    await expect(page.getByRole("row").filter({ hasText: name })).toContainText("Kallelse", { timeout: 30_000 });
  }
});
