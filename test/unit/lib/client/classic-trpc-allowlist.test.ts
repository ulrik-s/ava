/**
 * Spärren för den klassiska tRPC-bindningen (#1926, ADR 0040).
 *
 * `trpc` ur `@/lib/client/trpc` (`createTRPCReact`) är utfasad. Filerna flyttas
 * till `useTRPC()` en i taget, och bara filerna i `KNOWN` får fortfarande
 * importera den klassiska `trpc`. Listan får bara krympa.
 *
 * Testet matchar import-satsen, inte `trpc.`-anrop: flyttade filer skriver
 * `const trpc = useTRPC()` och `trpc.x.queryOptions(…)`, vilket är korrekt.
 * Förebild: `no-detail-link-regression.test.ts` och `KNOWN`-listorna i
 * `repository-list-contract.test.ts`.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it, expect } from "vitest-compat";

/** `import { …trpc… } from "@/lib/client/trpc"`, också över flera rader. */
const CLASSIC_IMPORT = /import\s*\{([^}]*)\}\s*from\s*["']@\/lib\/client\/trpc["']/g;
const DEFINING_FILE = "src/lib/client/trpc.ts";
const SCAN_DIR = "src";

/** Filerna som fortfarande använder den klassiska `trpc`. Får bara krympa. */
const KNOWN: readonly string[] = [
  "src/app/action-items/page.tsx",
  "src/app/contacts/[id]/_client.tsx",
  "src/app/contacts/page.tsx",
  "src/app/invoices/[id]/_client.tsx",
  "src/app/invoices/[id]/_dispatch-history.tsx",
  "src/app/invoices/[id]/_invoice-documents.tsx",
  "src/app/invoices/[id]/_ledger-booking.tsx",
  "src/app/invoices/[id]/_send-invoice-modal.tsx",
  "src/app/invoices/_attention.tsx",
  "src/app/invoices/_sie-export-button.tsx",
  "src/app/invoices/page.tsx",
  "src/app/matters/[id]/_billing-dialog.tsx",
  "src/app/matters/[id]/_billing-panel.tsx",
  "src/app/matters/[id]/_billing-runs-list.tsx",
  "src/app/matters/[id]/_billing-summary.tsx",
  "src/app/matters/[id]/_client.tsx",
  "src/app/matters/[id]/_conflict-check-section.tsx",
  "src/app/matters/[id]/_contacts-section.tsx",
  "src/app/matters/[id]/_expected-receivables-section.tsx",
  "src/app/matters/[id]/_expense-section.tsx",
  "src/app/matters/[id]/_generate-modal.tsx",
  "src/app/matters/[id]/_kostnadsrakning-entry.tsx",
  "src/app/matters/[id]/_kostnadsrakning-modal.tsx",
  "src/app/matters/[id]/_matter-header-edit.tsx",
  "src/app/matters/[id]/_mileage-form.tsx",
  "src/app/matters/[id]/_radgivning-entry.tsx",
  "src/app/matters/[id]/_service-notes-section.tsx",
  "src/app/matters/[id]/_settlement-dialog.tsx",
  "src/app/matters/[id]/_sjalvrisk-aconto-hint.tsx",
  "src/app/matters/[id]/_standard-atgard-suggestions.tsx",
  "src/app/matters/[id]/_time-section.tsx",
  "src/app/matters/[id]/_verdict-dialog.tsx",
  "src/app/matters/[id]/_watch-section.tsx",
  "src/app/matters/_use-matter-search.ts",
  "src/app/matters/page.tsx",
  "src/app/page.tsx",
  "src/app/payment-plans/[id]/_client.tsx",
  "src/app/payment-plans/page.tsx",
  "src/app/payments/import/page.tsx",
  "src/app/profile/page.tsx",
  "src/app/reports/_ar-summary.tsx",
  "src/app/reports/page.tsx",
  "src/app/search/page.tsx",
  "src/app/settings/_standard-atgarder-section.tsx",
  "src/app/settings/_vocabulary-sections.tsx",
  "src/app/settings/page.tsx",
  "src/app/templates/[id]/edit/_edit-client.tsx",
  "src/app/templates/new/page.tsx",
  "src/app/templates/page.tsx",
  "src/app/time/_time-entry-editing.tsx",
  "src/app/time/page.tsx",
  "src/app/users/[id]/_edit-client.tsx",
  "src/app/users/_user-form.tsx",
  "src/app/users/new/page.tsx",
  "src/app/users/page.tsx",
  "src/app/watchlist/page.tsx",
  "src/components/contacts/client-picker-dialog.tsx",
  "src/components/contacts/new-client-dialog.tsx",
  "src/components/documents/_document-details-dialog.tsx",
  "src/components/documents/_document-parts.tsx",
  "src/components/documents/_documents-list-view.tsx",
  "src/components/documents/_use-file-upload.ts",
  "src/components/documents/analyze-dispatcher-registrar.tsx",
  "src/components/documents/document-browser.tsx",
  "src/components/documents/external-edit-registrar.tsx",
  "src/components/documents/extract-text-dispatcher-registrar.tsx",
  "src/components/documents/use-lease-aware-open.tsx",
  "src/components/layout/dock-workspace.tsx",
  "src/components/layout/use-hidden-panels.ts",
  "src/components/matter/coverage-cap-warning.tsx",
  "src/components/matter/events-panel.tsx",
  "src/components/matter/matter-number.tsx",
  "src/components/matter/payment-method-fields.tsx",
  "src/components/matter/rattsskydd-nekad-banner.tsx",
  "src/components/matter/suggestions-panel.tsx",
  "src/components/matter/use-active-matter-options.ts",
  "src/components/settings/datasource-section.tsx",
  "src/components/settings/fortnox-section.tsx",
  "src/components/settings/ledger-accounts-section.tsx",
  "src/components/settings/org-defaults-section.tsx",
  "src/components/shell/app-shell.tsx",
  "src/components/shell/auth-status-banner.tsx",
  "src/components/shell/ledger-reconnect-banner.tsx",
  "src/components/shell/server-invoice-numbering.tsx",
  "src/components/shell/trpc-providers.tsx",
  "src/components/sync/sync-devices-section.tsx",
  "src/components/time/move-time-entries.tsx",
  "src/components/time/time-entry-form.tsx",
  "src/components/time/use-save-time-entry.ts",
  "src/components/ui/data-table.tsx",
  "src/components/watchlist/conflict-check-actions.tsx",
  "src/components/watchlist/conflict-hit-list.tsx",
  "src/components/watchlist/conflict-review-info.tsx",
  "src/components/watchlist/use-watch-actions.ts",
  "src/lib/client/backend/server-backup.ts",
  "src/lib/client/backend/server-feedback.ts",
  "src/lib/client/backend/sync-devices.ts",
  "src/lib/client/diagnostics/use-matter-invariants.ts",
  "src/lib/client/documents/use-matter-documents.ts",
  "src/lib/client/firma/use-eager-cache-matter-documents.ts",
  "src/lib/client/search/use-document-search.ts",
];

/** Sant när källan importerar den namngivna klassiska `trpc` (inte `useTRPC`). */
function importsClassicTrpc(source: string): boolean {
  for (const match of source.matchAll(CLASSIC_IMPORT)) {
    const names = (match[1] ?? "").split(",").map((n) => n.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]);
    if (names.includes("trpc")) return true;
  }
  return false;
}

/** Avvikelserna mellan källorna och listan över tillåtna filer. */
function classicTrpcViolations(
  sources: ReadonlyMap<string, string>,
  allowed: readonly string[],
): { unlisted: string[]; stale: string[] } {
  const users = [...sources].filter(([, src]) => importsClassicTrpc(src)).map(([file]) => file);
  return {
    unlisted: users.filter((f) => !allowed.includes(f)),
    stale: allowed.filter((f) => !users.includes(f)),
  };
}

function scanSources(): Map<string, string> {
  const out = new Map<string, string>();
  const entries = readdirSync(SCAN_DIR, { withFileTypes: true, recursive: true }) as Array<{
    name: string; parentPath?: string; path?: string; isFile(): boolean;
  }>;
  for (const entry of entries) {
    if (!entry.isFile() || !/\.tsx?$/.test(entry.name)) continue;
    const file = relative(".", join(entry.parentPath ?? entry.path ?? SCAN_DIR, entry.name));
    if (file !== DEFINING_FILE) out.set(file, readFileSync(file, "utf8"));
  }
  return out;
}

const HINT =
  "Ny kod skriver `const trpc = useTRPC()` med `useQuery(trpc.x.y.queryOptions(…))` " +
  "(ADR 0040, förebild: src/lib/client/trpc.ts och test/helpers/trpc-fake.tsx).";

describe("klassiska trpc – bara de kända filerna (#1926)", () => {
  it("ingen ny fil importerar den klassiska trpc, och listan är inte inaktuell", () => {
    const { unlisted, stale } = classicTrpcViolations(scanSources(), KNOWN);
    expect(unlisted, `Klassisk trpc i en ny fil. ${HINT}\n${unlisted.join("\n")}`).toEqual([]);
    expect(stale, `Filen använder inte längre klassisk trpc – ta bort den ur KNOWN:\n${stale.join("\n")}`).toEqual([]);
  });

  it("fäller en ny fil som importerar den klassiska trpc", () => {
    const sources = new Map([["src/a.tsx", 'import { trpc } from "@/lib/client/trpc";\ntrpc.x.useQuery();']]);
    expect(classicTrpcViolations(sources, [])).toEqual({ unlisted: ["src/a.tsx"], stale: [] });
  });

  it("fäller en fil i listan som inte längre använder den", () => {
    const sources = new Map([["src/a.tsx", "export const a = 1;"]]);
    expect(classicTrpcViolations(sources, ["src/a.tsx"])).toEqual({ unlisted: [], stale: ["src/a.tsx"] });
  });

  it("släpper en flyttad fil med useTRPC och trpc.x.queryOptions", () => {
    const src = [
      'import { useQuery } from "@tanstack/react-query";',
      'import { useTRPC } from "@/lib/client/trpc";',
      "const trpc = useTRPC();",
      "useQuery(trpc.matter.list.queryOptions({}));",
    ].join("\n");
    expect(classicTrpcViolations(new Map([["src/b.tsx", src]]), [])).toEqual({ unlisted: [], stale: [] });
  });

  it("känner igen importen över flera rader och bland andra namn", () => {
    expect(importsClassicTrpc('import {\n  TRPCProvider,\n  trpc,\n} from "@/lib/client/trpc";')).toBe(true);
    expect(importsClassicTrpc('import { useTRPCClient } from "@/lib/client/trpc";')).toBe(false);
  });
});
