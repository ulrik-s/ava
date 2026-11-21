/**
 * Utkasten i förfrågningsknappen (#1786): texten i en ny förfrågan och i
 * svaret på varje öppen förfrågan sparas medan man skriver, så att den finns
 * kvar när man går ut i AVA för att kolla något och kommer tillbaka — ett
 * utkast per förfrågan, samtidigt. Ett skickat utkast tas bort.
 *
 * I `localStorage` under en nyckel, som räknas till sessionen: utloggningen
 * tar bort den (`SESSION_LOCAL_STORAGE_KEYS`), så nästa användare på samma
 * dator ser inget.
 */
import { useCallback, useState } from "react";
import { z } from "zod";
import { loadFromStorage } from "@/lib/client/load-from-storage";

/** Nyckeln i `localStorage`. */
export const FEEDBACK_DRAFTS_KEY = "ava.feedbackDrafts";

const newDraftSchema = z.object({ kind: z.enum(["bug", "feature"]), title: z.string(), body: z.string() });

/** Utkastet till en ny förfrågan. */
export type NewFeedbackDraft = z.infer<typeof newDraftSchema>;

const draftsSchema = z.object({
  new: newDraftSchema.optional(),
  /** Svaret per förfrågan (numret som nyckel). */
  replies: z.record(z.string(), z.string()).default({}),
});
type Drafts = z.infer<typeof draftsSchema>;

const read = (): Drafts => loadFromStorage(FEEDBACK_DRAFTS_KEY, draftsSchema, { replies: {} });

function write(update: (d: Drafts) => Drafts): void {
  try {
    localStorage.setItem(FEEDBACK_DRAFTS_KEY, JSON.stringify(update(read())));
  } catch {
    // Privat läge eller full lagring: utkastet finns kvar i formuläret så länge det är öppet.
  }
}

/** Sparat utkast till en ny förfrågan, eller null. */
export const loadNewDraft = (): NewFeedbackDraft | null => read().new ?? null;

/** Spara (eller med null: ta bort) utkastet till en ny förfrågan. */
export function saveNewDraft(draft: NewFeedbackDraft | null): void {
  write(({ new: _old, ...rest }) => (draft === null ? rest : { ...rest, new: draft }));
}

/** Sparat svar på förfrågan `n`, eller tom text. */
export const loadReplyDraft = (n: number): string => read().replies[String(n)] ?? "";

/** Spara svaret på förfrågan `n`; tom text tar bort utkastet. */
export function saveReplyDraft(n: number, text: string): void {
  write((d) => {
    const { [String(n)]: _old, ...replies } = d.replies;
    return { ...d, replies: text === "" ? replies : { ...replies, [String(n)]: text } };
  });
}

/** Ett formulärs värde som sparas vid varje ändring; `clear` när det skickats. */
export function usePersistedDraft<T>(load: () => T, save: (value: T | null) => void, empty: T): [T, (value: T) => void, () => void] {
  const [value, setValue] = useState<T>(load);
  const set = useCallback((next: T) => { setValue(next); save(next); }, [save]);
  const clear = useCallback(() => { setValue(empty); save(null); }, [save, empty]);
  return [value, set, clear];
}
