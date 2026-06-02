/**
 * `IssueStore` — håller de självupptäckta invariant-överträdelser ([[invariants]])
 * som klienten hittat under sessionen. Driver "Rapportera fel"-knappens badge
 * (antal) och fyller felrapportens "Självupptäckta fel"-sektion.
 *
 * Dedupar på `code` + serialiserad `context` så att samma fel som upptäcks om
 * och om igen (varje render/refetch) bara räknas en gång. Notifierar
 * prenumeranter (UI) vid förändring.
 *
 * Ingen DOM/React — testbar i node. UI:t binder mot store:n via en hook.
 */

import type { InvariantViolation } from "@/lib/shared/diagnostics/invariants";

type Listener = () => void;

function keyOf(v: InvariantViolation): string {
  const ctx = Object.keys(v.context)
    .sort()
    .map((k) => `${k}=${v.context[k]}`)
    .join("&");
  return `${v.code}|${ctx}`;
}

export class IssueStore {
  private readonly byKey = new Map<string, InvariantViolation>();
  private readonly listeners = new Set<Listener>();

  /** Lägg till överträdelser (dedupade). Returnerar antal NYA poster. */
  report(violations: ReadonlyArray<InvariantViolation>): number {
    let added = 0;
    for (const v of violations) {
      const k = keyOf(v);
      if (!this.byKey.has(k)) {
        this.byKey.set(k, v);
        added++;
      }
    }
    if (added > 0) this.emit();
    return added;
  }

  list(): InvariantViolation[] {
    return [...this.byKey.values()];
  }

  count(): number {
    return this.byKey.size;
  }

  clear(): void {
    if (this.byKey.size === 0) return;
    this.byKey.clear();
    this.emit();
  }

  /** Prenumerera på förändringar. Returnerar avregistrerings-funktion. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }
}
