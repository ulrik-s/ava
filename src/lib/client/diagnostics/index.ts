/**
 * Diagnostik — självupptäckta fel: invarianter som klienten kontrollerar
 * (`use-matter-invariants`) läggs i en app-wide store och loggas en gång
 * med `console.warn`, så de syns i webbläsarens konsol (F12).
 *
 * Användarnas felrapporter går via "Bugg eller förslag" i sidomenyn
 * (`components/shell/feedback-button.tsx`) till det privata intag-repot.
 */

import type { InvariantViolation } from "@/lib/shared/diagnostics/invariants";
import { IssueStore } from "./issue-store";

/** App-wide store för självupptäckta fel. */
export const issueStore = new IssueStore();

/**
 * Rapportera självupptäckta överträdelser: lägg i store:n OCH logga via
 * `console.warn` (F12). Nya, tidigare osedda fel loggas en gång — store:n dedupar.
 */
export function reportSelfDetected(violations: ReadonlyArray<InvariantViolation>): void {
  if (violations.length === 0) return;
  const added = issueStore.report(violations);
  if (added === 0) return;
  for (const v of violations) {
    console.warn(`[ava-invariant] ${v.code}: ${v.message}`, v.context);
  }
}
