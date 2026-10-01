/**
 * Handlingarna en virtuell jurist gör (#1366) — samma tRPC-anrop som UI:t.
 *
 * Mutationerna går genom appens klient (`vu.api`): routern körs lokalt och
 * anropet köas, och synken skickar det sedan (procedurkön eller radkön, efter
 * vad entiteten har). Sök, nedladdning och uppladdning går direkt mot servern,
 * som i appen (`use-document-search`, `server-download-client`, `content-sync`).
 */

import { runContentSync } from "@/lib/client/backend/content-sync";
import { bytesToBase64, contentStoragePath, sha256Hex } from "@/lib/shared/content-address";
import { asId } from "@/lib/shared/schemas/ids";
import { uuidv7 } from "@/lib/shared/uuid";
import type { Rng } from "./rng";
import type { VirtualUser } from "./virtual-user";

/** Dagens datum (YYYY-MM-DD) — tidsposter och anteckningar. */
export function today(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Klockslag (HH:mm) för en anteckning. */
export function clock(now: Date = new Date()): string {
  return now.toISOString().slice(11, 16);
}

/** Betalningssätt för ärenden i testet: privat (aconto) eller rättshjälp (kostnadsräkning). */
export type LoadPaymentMethod = "PRIVAT" | "RATTSHJALP";

/** Öppna ett ärende (procedurkön: ärendenumret tilldelas i serverns körning). */
export async function openMatter(vu: VirtualUser, title: string, paymentMethod: LoadPaymentMethod = "PRIVAT"): Promise<string> {
  const matter = await vu.api.matter.create.mutate({ title, paymentMethod });
  return String(matter.id);
}

/** Registrera tid (procedurkön). Returnerar postens id. */
export async function logTime(vu: VirtualUser, matterId: string, r: Rng, tag: string): Promise<string> {
  const entry = await vu.api.timeEntry.create.mutate({
    matterId, date: today(), minutes: r.int(1, 16) * 15, description: `Lasttest ${tag}`,
  });
  return String(entry.id);
}

/** Ändra en egen tidspost (procedurkön). */
export async function editTime(vu: VirtualUser, entryId: string, r: Rng): Promise<void> {
  await vu.api.timeEntry.update.mutate({ id: entryId, minutes: r.int(1, 16) * 15 });
}

/** Registrera ett utlägg (procedurkön). */
export async function addExpense(vu: VirtualUser, matterId: string, r: Rng, tag: string): Promise<string> {
  const expense = await vu.api.expense.create.mutate({ matterId, date: today(), amount: r.int(1, 500) * 100, description: `Utlägg ${tag}` });
  return String(expense.id);
}

/** Skriv en tjänsteanteckning (radkön). */
export async function addNote(vu: VirtualUser, matterId: string, tag: string): Promise<string> {
  const note = await vu.api.serviceNote.create.mutate({ matterId, date: today(), time: clock(), text: `Anteckning ${tag}` });
  return String(note.id);
}

/** Lägg upp en kontakt (radkön). */
export async function addContact(vu: VirtualUser, tag: string): Promise<string> {
  const contact = await vu.api.contacts.create.mutate({ name: `Kontakt ${tag}`, contactType: "PERSON" });
  return String(contact.id);
}

/** Sökord som finns i uppladdade dokument (och några som inte gör det). */
export const SEARCH_WORDS = ["stämningsansökan", "huvudförhandling", "yrkande", "ersättning", "vittne", "förlikning", "dom"] as const;

/** Fulltextsök i dokumenten (servern, #1215). */
export async function searchDocuments(vu: VirtualUser, r: Rng): Promise<number> {
  const hits = await vu.server.document.search.query({ query: r.pick(SEARCH_WORDS) ?? "dom", limit: 20 });
  return hits.totalHits;
}

/** Hämta ett dokuments innehåll (servern). */
export async function downloadDocument(vu: VirtualUser, documentId: string): Promise<number> {
  const res = await vu.server.document.downloadContent.query({ documentId });
  return res.contentBase64.length;
}

/** Ett textdokument av ungefär `kb` kB, unikt (egen sha) och sökbart. */
export function documentText(tag: string, kb: number): Uint8Array {
  const line = `${tag}: Stämningsansökan avseende ersättning. Huvudförhandling, yrkande och vittne enligt bilaga. Förlikning har inte nåtts.\n`;
  return new TextEncoder().encode(line.repeat(Math.max(1, Math.ceil((kb * 1024) / line.length))));
}

/**
 * Ladda upp ett dokument som appen gör: metadatan registreras lokalt och
 * synkas (radkön), sedan laddar byte-synken upp innehållet servern saknar
 * (`runContentSync`: missingContent → uploadContent). Uppladdningen startar
 * klassificeringsjobbet på servern.
 */
export async function uploadDocument(vu: VirtualUser, matterId: string, kb: number, tag: string): Promise<string> {
  const id = uuidv7();
  const bytes = documentText(`${tag} ${id}`, kb);
  const sha = await sha256Hex(bytes);
  await vu.api.document.register.mutate({
    id, matterId, fileName: `lasttest-${tag}.txt`, mimeType: "text/plain", sizeBytes: bytes.byteLength, storagePath: contentStoragePath(sha),
  });
  // Metadatan måste ha nått servern innan innehållet laddas upp (som i appen).
  await vu.drain(60_000);
  const pending = [{ documentId: asId<"DocumentId">(id), sha }];
  const uploaded = await runContentSync({
    pending: () => Promise.resolve(pending.splice(0)),
    missing: async (paths) => (await vu.server.document.missingContent.query({ storagePaths: paths })).missing,
    getBytes: () => Promise.resolve(bytes),
    upload: async (documentId, b) => { await vu.server.document.uploadContent.mutate({ documentId, contentBase64: bytesToBase64(b) }); },
    markUploaded: () => Promise.resolve(),
  });
  // Byte-synken sväljer ett uppladdningsfel (försöker igen nästa synk) — här är det ett fel.
  if (uploaded.length === 0) throw new Error(`uppladdningen av ${id} misslyckades`);
  return id;
}
