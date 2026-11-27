/**
 * `writeSuggestionsFromText` (#988) — producenten som saknades.
 *
 * `SuggestionsPanel` och `EventsPanel` var fullt utbyggda men stod tomma i alla
 * tier: ingenting skapade raderna. Här testas skrivningen mot in-memory-
 * repositories — själva extraktionen har egna tester i
 * `document-extraction.test.ts`.
 *
 * Idempotensen är det viktiga. Ett dokument analyseras om vid uppladdning,
 * manuell "Analysera" och reconcile-replay; dubbletter vid varje körning hade
 * gjort panelerna oanvändbara, och ett AVFÄRDAT förslag som återuppstår är
 * värre än inget förslag alls.
 */

import { describe, it, expect } from "vitest-compat";
import { LocalStore } from "@/lib/server/data-store/in-memory/local-store";
import { writeSuggestionsFromText } from "@/lib/server/documents/suggest-from-text";
import type { SuggestionRepos } from "@/lib/server/documents/suggest-from-text";
import { InMemoryDocumentRepository } from "@/lib/server/repositories/in-memory-document-repository";
import { InMemoryDocumentSuggestionRepository } from "@/lib/server/repositories/in-memory-document-suggestion-repository";
import { InMemoryMatterEventSuggestionRepository } from "@/lib/server/repositories/in-memory-matter-event-suggestion-repository";
import { prebakeJoins } from "@/lib/shared/demo-source";
import { asId } from "@/lib/shared/schemas/ids";
import { uuidv7 } from "@/lib/shared/uuid";

const ORG = asId<"OrganizationId">("77777777-7777-7777-8777-777777777777");

const TEXT = [
  "STÄMNINGSANSÖKAN",
  "Kärande: Anna Andersson 850312-4567",
  "Svarande: Byggfirma Stenhammar AB 556677-8899",
  "",
  "Muntlig förberedelse har satts ut till 2026-09-15 kl. 09.30.",
].join("\n");

/** Uppställningen i HD:s protokoll när prövningstillstånd inte meddelas (#2099). */
const HD_PT = [
  "HÖGSTA DOMSTOLEN PROTOKOLL",
  "Mål nr T 2020-24",
  "BESLUT",
  "Högsta domstolen meddelar inte prövningstillstånd. Hovrättens avgörande står därmed fast.",
].join("\n");

function setup() {
  const matterId = asId<"MatterId">(uuidv7());
  const documentId = asId<"DocumentId">(uuidv7());
  const source = prebakeJoins({
    matters: [{ id: matterId, organizationId: ORG, matterNumber: "2026-1", title: "T" }],
    documents: [{ id: documentId, matterId, fileName: "stamning.pdf", title: "Stämning" }],
    documentAnalysisSuggestions: [],
    matterEventSuggestions: [],
  });
  const store = new LocalStore(source, async () => {});
  const repos: SuggestionRepos = {
    documents: new InMemoryDocumentRepository(store),
    documentAnalysisSuggestions: new InMemoryDocumentSuggestionRepository(store),
    matterEventSuggestions: new InMemoryMatterEventSuggestionRepository(store),
  };
  return { repos, documentId, matterId };
}

describe("writeSuggestionsFromText", () => {
  it("skapar kontakt- och händelseförslag ur texten", async () => {
    const { repos, documentId } = setup();
    const res = await writeSuggestionsFromText(repos, documentId, TEXT);
    expect(res).toEqual({ parties: 2, events: 1, finalRuling: null });

    const parties = await repos.documentAnalysisSuggestions.listForDocument(documentId);
    expect(parties.map((p) => p.name).sort()).toEqual(["Anna Andersson", "Byggfirma Stenhammar AB"]);
    expect(parties.every((p) => p.status === "PENDING")).toBe(true);

    const events = await repos.matterEventSuggestions.listForDocument(documentId);
    expect(events[0]).toMatchObject({ title: "Muntlig förberedelse", eventType: "FORBEREDELSE" });
  });

  it("är idempotent — omkörning skapar inga dubbletter", async () => {
    const { repos, documentId } = setup();
    await writeSuggestionsFromText(repos, documentId, TEXT);
    const second = await writeSuggestionsFromText(repos, documentId, TEXT);

    expect(second, "andra körningen skapar noll nya").toEqual({ parties: 0, events: 0, finalRuling: null });
    expect(await repos.documentAnalysisSuggestions.listForDocument(documentId)).toHaveLength(2);
    expect(await repos.matterEventSuggestions.listForDocument(documentId)).toHaveLength(1);
  });

  it("återuppväcker INTE ett förslag användaren avfärdat", async () => {
    // Dedupen tittar på alla statusar, inte bara PENDING. Att få tillbaka ett
    // bortvalt förslag vid varje omanalys vore värre än att inte få det alls.
    const { repos, documentId } = setup();
    await writeSuggestionsFromText(repos, documentId, TEXT);
    const [first] = await repos.documentAnalysisSuggestions.listForDocument(documentId);
    await repos.documentAnalysisSuggestions.update(first!.id, { status: "REJECTED" });

    const again = await writeSuggestionsFromText(repos, documentId, TEXT);
    expect(again.parties).toBe(0);
    const after = await repos.documentAnalysisSuggestions.listForDocument(documentId);
    expect(after).toHaveLength(2);
    expect(after.filter((p) => p.status === "REJECTED")).toHaveLength(1);
  });

  it("nya förslag i en UPPDATERAD text läggs till, befintliga rörs inte", async () => {
    const { repos, documentId } = setup();
    await writeSuggestionsFromText(repos, documentId, TEXT);
    const res = await writeSuggestionsFromText(repos, documentId, `${TEXT}\nVittne: Karl Nilsson 720801-1234`);
    expect(res).toEqual({ parties: 1, events: 0, finalRuling: null });
    expect(await repos.documentAnalysisSuggestions.listForDocument(documentId)).toHaveLength(3);
  });

  it("tom text är en no-op", async () => {
    const { repos, documentId } = setup();
    expect(await writeSuggestionsFromText(repos, documentId, "   ")).toEqual({ parties: 0, events: 0, finalRuling: null });
    expect(await repos.documentAnalysisSuggestions.listForDocument(documentId)).toHaveLength(0);
  });
});

describe("writeSuggestionsFromText: slutligt avgörande (#2099)", () => {
  it("HD:s protokoll sparas som PT_HD utan att versionen höjs, och står i svaret", async () => {
    const { repos, documentId } = setup();
    const before = await repos.documents.getByIdOrThrow(documentId);
    const res = await writeSuggestionsFromText(repos, documentId, HD_PT);
    expect(res.finalRuling).toBe("PT_HD");
    const after = await repos.documents.getByIdOrThrow(documentId);
    expect(after.finalRuling).toBe("PT_HD");
    expect(after.version).toBe(before.version);
  });

  it("en andra körning skriver inget nytt", async () => {
    const { repos, documentId } = setup();
    await writeSuggestionsFromText(repos, documentId, HD_PT);
    const first = await repos.documents.getByIdOrThrow(documentId);
    await new Promise((r) => setTimeout(r, 5));
    expect((await writeSuggestionsFromText(repos, documentId, HD_PT)).finalRuling).toBe("PT_HD");
    expect((await repos.documents.getByIdOrThrow(documentId)).updatedAt).toEqual(first.updatedAt);
  });

  it("text utan markörer ger null och skriver inget", async () => {
    const { repos, documentId } = setup();
    const before = await repos.documents.getByIdOrThrow(documentId);
    expect((await writeSuggestionsFromText(repos, documentId, TEXT)).finalRuling).toBeNull();
    const after = await repos.documents.getByIdOrThrow(documentId);
    expect(after.finalRuling ?? null).toBeNull();
    expect(after.updatedAt).toEqual(before.updatedAt);
  });

  it("ett sparat värde töms inte av en senare text utan markörer", async () => {
    const { repos, documentId } = setup();
    await writeSuggestionsFromText(repos, documentId, HD_PT);
    await writeSuggestionsFromText(repos, documentId, TEXT);
    expect((await repos.documents.getByIdOrThrow(documentId)).finalRuling).toBe("PT_HD");
  });

  it("ett saknat dokument ger inget fel", async () => {
    const { repos } = setup();
    const missing = asId<"DocumentId">(uuidv7());
    expect((await writeSuggestionsFromText(repos, missing, HD_PT)).finalRuling).toBe("PT_HD");
    expect(await repos.documents.getById(missing)).toBeNull();
  });
});
