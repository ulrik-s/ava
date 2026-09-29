/**
 * `processDeferredFakturaDocs` (#1243) — skapar de uppskjutna fakturadokumenten
 * efter en synk, när servern satt numret. Egen modul: `generate-faktura-doc`
 * skjuter upp (importerar lagringen), den här skapar (importerar generatorn).
 */

import { generateFakturaFromTemplate, type DocUtils, type RegisterMut } from "@/lib/client/kostnadsrakning/generate-faktura-doc";
import { deferredFakturaStore, type DeferredFakturaDoc } from "./deferred-faktura-docs";

/**
 * Skapa de uppskjutna dokument vars nummer nu är fastställt. Returnerar antalet
 * skapade; de som inte är synkade än — eller vars skapande misslyckades —
 * ligger kvar till nästa gång.
 */
export async function processDeferredFakturaDocs(deps: { register: RegisterMut; utils: DocUtils }): Promise<number> {
  const store = deferredFakturaStore();
  const remaining: DeferredFakturaDoc[] = [];
  let created = 0;
  for (const doc of await store.load()) {
    try {
      const outcome = await generateFakturaFromTemplate({ ...doc, ...deps, deferIfPending: false });
      if (outcome === "generated") created++;
      else remaining.push(doc);
    } catch (e) {
      console.warn(`[faktura] uppskjutet dokument för ${doc.invoiceId} misslyckades:`, e);
      remaining.push(doc);
    }
  }
  await store.save(remaining);
  return created;
}
