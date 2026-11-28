/**
 * Verifikatets referens i bokföringssystemet (#1931): `ledgerRefOf` läser
 * `ledgerRef`, med `fortnoxId` som reserv, och en tom sträng räknas som saknad.
 */

import { describe, expect, it } from "vitest-compat";
import { type LedgerRefRow, ledgerRefOf } from "@/lib/shared/ledger-ref";

const CASES: readonly (readonly [string, LedgerRefRow, string | null])[] = [
  ["bara ledgerRef", { ledgerRef: "A/1" }, "A/1"],
  ["bara fortnoxId (äldre rad)", { fortnoxId: "A/2" }, "A/2"],
  ["båda: ledgerRef gäller", { ledgerRef: "A/1", fortnoxId: "A/2" }, "A/1"],
  ["inget", {}, null],
  ["null i båda", { ledgerRef: null, fortnoxId: null }, null],
  ["tom sträng i båda", { ledgerRef: "", fortnoxId: "" }, null],
  ["tom ledgerRef: fortnoxId gäller", { ledgerRef: "", fortnoxId: "A/2" }, "A/2"],
  ["fortnoxId som inte är en sträng", { fortnoxId: 7 }, null],
];

describe("ledgerRefOf", () => {
  for (const [name, row, expected] of CASES) {
    it(name, () => {
      expect(ledgerRefOf(row)).toBe(expected);
    });
  }
});
