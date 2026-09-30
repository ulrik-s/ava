/**
 * Offline-sökning i juristens aktiva ärenden (#1244) — full self-hosted-stack.
 *
 * Förut fanns ett dokument offline bara om ärendet öppnats, och sökningen
 * stängdes av utan nät. Nu förladdas juristens egna, aktiva ärenden — bytes
 * och text — och sökningen offline körs på enheten:
 *   1. en kollega lägger ett textdokument i ett ärende där juristen är ansvarig,
 *   2. juristen loggar in men öppnar aldrig ärendet,
 *   3. förladdningen hämtar dokumentet och indexerar texten,
 *   4. offline: sökningen hittar ett ord ur dokumentet, märkt "Lokal cache".
 */
import { test, expect, type Page } from "@playwright/test";
import { asId } from "../../../src/lib/shared/schemas/ids";
import { uuidv7 } from "../../../src/lib/shared/uuid";
import { clientFor, mintToken } from "../../../tooling/scripts/selfhosted-trpc-client";
import { login } from "./_selfhosted-login";

/** Dokument-id:n med sparad text i enhetens textlager (`LocalDocumentTextStore`). */
function indexedDocIds(page: Page): Promise<string[]> {
  return page.evaluate(() => new Promise<string[]>((resolve) => {
    const open = indexedDB.open("ava-doc-text");
    open.onerror = () => resolve([]);
    open.onsuccess = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains("kv")) { resolve([]); return; }
      const get = db.transaction("kv", "readonly").objectStore("kv").get("__index__");
      get.onsuccess = () => resolve(Array.isArray(get.result) ? get.result as string[] : []);
      get.onerror = () => resolve([]);
    };
  }));
}

test("juristens aktiva ärende finns offline: dokumentet förladdas och sökningen hittar texten", async ({ page, context }) => {
  const admin = clientFor(await mintToken("admin", "admin"));
  const lawyerMe = await clientFor(await mintToken("lawyer", "lawyer")).user.current.query();
  const stamp = Date.now();
  const word = `hyresavtal${stamp}`;

  const matter = await admin.matter.create.mutate({
    title: `Förladdat ärende ${stamp}`, responsibleLawyerId: asId<"UserId">(String(lawyerMe?.id)),
  });
  const documentId = asId<"DocumentId">(uuidv7());
  await admin.document.register.mutate({
    id: documentId, matterId: asId<"MatterId">(matter.id), fileName: `avtal-${stamp}.txt`, mimeType: "text/plain",
    sizeBytes: 0, storagePath: `documents/content/${documentId}`, uploadedById: asId<"UserId">(String(lawyerMe?.id)),
  });
  await admin.document.uploadContent.mutate({
    documentId, contentBase64: Buffer.from(`Parterna har ingått ett ${word} som löper ut i december.`).toString("base64"),
  });

  await login(page, "lawyer", "lawyer");
  await page.goto("/ava/search/");
  await expect(page.getByTestId("sync-pill")).toContainText(/Sparat/, { timeout: 30_000 });
  await expect.poll(() => indexedDocIds(page), { timeout: 60_000 }).toContain(documentId);

  await context.setOffline(true);
  await expect(page.getByText(/söker i dokumenten på den här enheten/)).toBeVisible({ timeout: 15_000 });
  await page.getByPlaceholder("Sök i dokument...").fill(word);
  await page.getByRole("button", { name: "Sök", exact: true }).click();
  const row = page.getByRole("row").filter({ hasText: `avtal-${stamp}.txt` });
  await expect(row).toBeVisible({ timeout: 15_000 });
  await expect(row).toContainText("Lokal cache");
});
