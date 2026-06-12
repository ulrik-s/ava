/**
 * SIE 4-rendering av semantiska verifikat (#236, ADR 0011).
 *
 * SIE (Standard Import/Export) är det svenska standardformatet för att flytta
 * bokföringsdata mellan system. En byrå UTAN Fortnox/extern ledger kan exportera
 * en SIE 4-fil och importera den i valfritt bokföringssystem — därför är detta
 * en ren, systemoberoende renderare av domänens semantiska verifikat
 * ([[semantic-voucher]]), helt utan externt API.
 *
 * Format (verifierat mot SIE-gruppens spec ver 4B + importörsdoc):
 *   - Poster radvis, taggen först (`#FLAGGA`, `#KONTO`, `#VER`, `#TRANS` …).
 *   - `#SIETYP 4`, teckenuppsättning historiskt PC8 (vi skriver ren text;
 *     ev. PC8-kodning är ett nedströms-bekymmer).
 *   - **Tecken-konvention för `#TRANS`-belopp: debet POSITIVT, kredit NEGATIVT.**
 *   - Datum `YYYYMMDD` (utan bindestreck). Belopp med punkt-decimal, 2 decimaler.
 *   - Verifikat: `#VER "serie" "nr" datum "text"` följt av `{` … `}` med en
 *     `#TRANS konto {objektlista} belopp` per rad (tom objektlista = `{}`).
 *
 * Invariant: domänmodellen är redan balanserad (Σdebet==Σkredit) → SIE-
 * verifikatets `#TRANS`-summa blir 0, vilket SIE kräver.
 */

import type { SemanticVoucher, VoucherRole } from "./semantic-voucher";

/** Byrå-metadata för SIE-headern. */
export interface SieCompany {
  name: string;
  /** Organisationsnummer (valfritt — emit:as som `#ORGNR` om satt). */
  orgNr?: string;
}

/** Ett BAS-konto (nummer + namn) som en roll mappas till. */
export interface SieAccount {
  number: string;
  name: string;
}

/** Roll → BAS-konto. Vendor-neutral motsvarighet till Fortnox konto-mappning. */
export type SieAccountMap = Partial<Record<VoucherRole, SieAccount>>;

/** Verifikat-identitet i SIE (serie + löpnummer). */
export interface SieVoucherMeta {
  series: string;
  number: string;
}

export interface SieRenderInput {
  company: SieCompany;
  /** Genereringsdatum `YYYYMMDD` (för `#GEN`). */
  generatedDate: string;
  accountMap: SieAccountMap;
  vouchers: ReadonlyArray<{ meta: SieVoucherMeta; voucher: SemanticVoucher }>;
  /** Program-signatur för `#PROGRAM` (default AVA). */
  program?: { name: string; version: string };
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** `Date | string` → `YYYYMMDD`. */
function toSieDate(d: Date | string): string {
  const dt = typeof d === "string" ? new Date(d) : d;
  return `${dt.getFullYear()}${pad2(dt.getMonth() + 1)}${pad2(dt.getDate())}`;
}

/** Citera ett fält enligt SIE (dubbla citationstecken, escape:a inre `"`). */
function quote(s: string): string {
  return `"${s.replace(/"/g, '\\"')}"`;
}

/** Öre (debet, kredit) → signerat SEK-belopp: debet positivt, kredit negativt. */
function transAmount(debit: number, credit: number): string {
  return ((debit - credit) / 100).toFixed(2);
}

/** Slå upp rollens konto; kasta om mappning saknas (completeness-gate). */
function accountFor(role: VoucherRole, map: SieAccountMap): SieAccount {
  const account = map[role];
  if (!account) throw new Error(`SIE: rollen '${role}' saknar konto-mappning`);
  return account;
}

function headerLines(input: SieRenderInput): string[] {
  const program = input.program ?? { name: "AVA", version: "1.0" };
  const lines = [
    "#FLAGGA 0",
    `#PROGRAM ${quote(program.name)} ${quote(program.version)}`,
    "#FORMAT PC8",
    `#GEN ${input.generatedDate}`,
    "#SIETYP 4",
    `#FNAMN ${quote(input.company.name)}`,
  ];
  if (input.company.orgNr) lines.push(`#ORGNR ${input.company.orgNr}`);
  return lines;
}

/** Unika `#KONTO`-poster för alla konton som verifikaten refererar, sorterade. */
function kontoLines(input: SieRenderInput): string[] {
  const accounts = new Map<string, string>();
  for (const { voucher } of input.vouchers) {
    for (const row of voucher.rows) {
      const account = accountFor(row.role, input.accountMap);
      accounts.set(account.number, account.name);
    }
  }
  return [...accounts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([number, name]) => `#KONTO ${number} ${quote(name)}`);
}

function voucherLines(
  entry: { meta: SieVoucherMeta; voucher: SemanticVoucher },
  map: SieAccountMap,
): string[] {
  const { meta, voucher } = entry;
  const head = `#VER ${quote(meta.series)} ${quote(meta.number)} ${toSieDate(voucher.date)} ${quote(voucher.description)}`;
  const trans = voucher.rows.map((row) => {
    const account = accountFor(row.role, map);
    return `   #TRANS ${account.number} {} ${transAmount(row.debit, row.credit)}`;
  });
  return [head, "{", ...trans, "}"];
}

/** Rendera en komplett SIE 4-fil (CRLF-terminerad enligt spec). */
export function renderSie(input: SieRenderInput): string {
  const lines = [
    ...headerLines(input),
    ...kontoLines(input),
    ...input.vouchers.flatMap((entry) => voucherLines(entry, input.accountMap)),
  ];
  return lines.join("\r\n") + "\r\n";
}
