/**
 * Flikarna går inte att stänga — inte heller med tangentbordet (#1356).
 *
 * dockview-core stänger en fokuserad flik med Delete/Backspace (en lyssnare på
 * flikraden) och bryr sig inte om `hideClose`. Sidan har en fast uppsättning
 * paneler (#1292), så en stängd panel var borta tills sidan laddades om.
 * Lyssnaren sitter i capture-fasen på dockytans omslag och stoppar tangenten
 * innan den når flikraden; piltangenter, Enter och Home/End fungerar som förut.
 */

const CLOSE_KEYS: ReadonlySet<string> = new Set(["Delete", "Backspace"]);

/** Klassen dockview sätter på varje flik — tangenten tillhör bara den. */
const TAB_SELECTOR = ".dv-tab";

/** Det hanteraren läser av tangenthändelsen (smalt → testbart utan React). */
export interface TabKeyEvent {
  readonly key: string;
  readonly target: EventTarget | null;
  stopPropagation(): void;
  preventDefault(): void;
}

/** Svälj Delete/Backspace på en dockview-flik; allt annat passerar orört. */
export function swallowTabCloseKey(e: TabKeyEvent): void {
  if (!CLOSE_KEYS.has(e.key)) return;
  if (!(e.target instanceof Element) || !e.target.matches(TAB_SELECTOR)) return;
  e.stopPropagation();
  e.preventDefault();
}
