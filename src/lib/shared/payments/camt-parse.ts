/**
 * ISO 20022 camt-parser för betalfils-import (#181, jfr spike #164).
 *
 * Läser SEB:s/Bankgirots återrapportering av inkomna kundbetalningar:
 *   - camt.054 (BkToCstmrDbtCdtNtfctn) — löpande debit/credit-aviseringar.
 *   - camt.053 (BkToCstmrStmt) — kontoutdrag end-of-day.
 *
 * Struktur: `Ntry` (bokförd kontohändelse) → `NtryDtls` → `TxDtls[]` — en
 * samlad insättning (t.ex. domstol som betalar flera kostnadsräkningar i en
 * betalning) itemiseras av banken i flera `TxDtls`, var och en med eget
 * belopp + egen remittance-info. Parsern MÅSTE därför iterera `TxDtls`, inte
 * bara läsa entry-totalen (#175).
 *
 * Referenser per transaktion:
 *   - STRUKTURERADE (`RmtInf/Strd`): OCR (`CdtrRefInf/Ref`) eller
 *     dokumentnummer (`RfrdDocInf/Nb`), ofta med eget delbelopp
 *     (`RfrdDocAmt/RmtdAmt`) — en TxDtls kan betala flera fakturor.
 *   - FRI TEXT (`RmtInf/Ustrd`): målnummer/ärendereferens/fakturanr i
 *     löptext (#175) + `EndToEndId`.
 *
 * Använder DOMParser (browser-nativ; happy-dom i bun-test). Parsern är pure:
 * XML-sträng in → transaktioner ut. Ingen IO.
 *
 * STRIKTA DATATYPER: utdatat valideras med zod vid parsegränsen
 * (`camtFileSchema.parse`) — trasig/oväntad fildata failar högt här i stället
 * för att propagera in i matchning/bokföring. Typerna är z.infer-härledda.
 */

import { z } from "zod";

export const camtStructuredRefSchema = z.object({
  /** Referensen (OCR eller fakturanr/dokumentnr), trimmad. */
  ref: z.string().min(1),
  /** Delbelopp i öre för just denna referens (RfrdDocAmt), eller null. */
  amountOre: z.number().int().nullable(),
});

export type CamtStructuredRef = z.infer<typeof camtStructuredRefSchema>;

export const camtTransactionSchema = z.object({
  /** Unik transaktionsreferens för idempotent import (AcctSvcrRef → EndToEndId → msgId:index). */
  reference: z.string().min(1),
  /** Transaktionsbelopp i öre (TxAmt, annars Ntry-beloppet). */
  amountOre: z.number().int(),
  /** ISO 4217-valutakod (SEK, EUR, …). */
  currency: z.string().regex(/^[A-Z]{3}$/),
  /** Valutadatum från Ntry/ValDt, eller null. */
  valueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  /** Betalarens namn (RltdPties/Dbtr/Nm), eller null. */
  debtorName: z.string().min(1).nullable(),
  /** CRDT = inbetalning (det vi prickar av). DBIT hoppas över i matchningen. */
  creditDebit: z.enum(["CRDT", "DBIT"]),
  structuredRefs: z.array(camtStructuredRefSchema),
  /** Ostrukturerad remittance-info (Ustrd-rader). */
  freeTexts: z.array(z.string().min(1)),
});

export type CamtTransaction = z.infer<typeof camtTransactionSchema>;

export const camtFileSchema = z.object({
  messageId: z.string().min(1).nullable(),
  transactions: z.array(camtTransactionSchema),
});

export type CamtFile = z.infer<typeof camtFileSchema>;

/** Direkta barn-element med givet tag-namn (getElementsByTagName är subtree-vid). */
function children(el: Element, tag: string): Element[] {
  return Array.from(el.children).filter((c) => c.tagName === tag);
}

/** Första matchande element längs en path av direkta barn. */
function find(el: Element, ...path: string[]): Element | null {
  let cur: Element | null = el;
  for (const tag of path) {
    cur = cur ? (children(cur, tag)[0] ?? null) : null;
  }
  return cur;
}

function text(el: Element | null): string | null {
  const t = el?.textContent?.trim();
  return t ? t : null;
}

/** "100.00" → 10000 öre. Kastar på icke-numeriskt (trasig fil ska synas, inte tystas). */
function toOre(decimal: string): number {
  const n = Number(decimal);
  if (!Number.isFinite(n)) throw new Error(`Ogiltigt camt-belopp: "${decimal}"`);
  return Math.round(n * 100);
}

/** Strukturerade referenser ur en TxDtls: alla Strd-block, OCR eller dokumentnr. */
function structuredRefsOf(tx: Element): CamtStructuredRef[] {
  const rmtInf = find(tx, "RmtInf");
  if (!rmtInf) return [];
  return children(rmtInf, "Strd").flatMap((strd) => {
    const ref = text(find(strd, "CdtrRefInf", "Ref")) ?? text(find(strd, "RfrdDocInf", "Nb"));
    if (!ref) return [];
    const amt = text(find(strd, "RfrdDocAmt", "RmtdAmt"));
    return [{ ref, amountOre: amt ? toOre(amt) : null }];
  });
}

function freeTextsOf(tx: Element): string[] {
  const rmtInf = find(tx, "RmtInf");
  if (!rmtInf) return [];
  return children(rmtInf, "Ustrd")
    .map((u) => u.textContent?.trim() ?? "")
    .filter((s) => s !== "");
}

interface EntryContext {
  amountOre: number;
  currency: string;
  valueDate: string | null;
  creditDebit: "CRDT" | "DBIT";
  messageId: string | null;
  index: () => number;
}

/** En TxDtls (eller Ntry utan detaljer) → CamtTransaction. */
function toTransaction(tx: Element, entry: EntryContext): CamtTransaction {
  const txAmt = text(find(tx, "AmtDtls", "TxAmt", "Amt"));
  const txCcy = find(tx, "AmtDtls", "TxAmt", "Amt")?.getAttribute("Ccy");
  const cdtDbt = text(find(tx, "CdtDbtInd")) as "CRDT" | "DBIT" | null;
  const reference =
    text(find(tx, "Refs", "AcctSvcrRef")) ??
    text(find(tx, "Refs", "EndToEndId")) ??
    `${entry.messageId ?? "camt"}:${entry.index()}`;
  return {
    reference,
    amountOre: txAmt ? toOre(txAmt) : entry.amountOre,
    currency: txCcy ?? entry.currency,
    valueDate: entry.valueDate,
    debtorName: text(find(tx, "RltdPties", "Dbtr", "Nm")),
    creditDebit: cdtDbt ?? entry.creditDebit,
    structuredRefs: structuredRefsOf(tx),
    freeTexts: freeTextsOf(tx),
  };
}

function entryContextOf(ntry: Element, messageId: string | null, index: () => number): EntryContext {
  const amtEl = children(ntry, "Amt")[0] ?? null;
  return {
    amountOre: toOre(text(amtEl) ?? "0"),
    currency: amtEl?.getAttribute("Ccy") ?? "SEK",
    valueDate: text(find(ntry, "ValDt", "Dt")),
    creditDebit: (text(find(ntry, "CdtDbtInd")) as "CRDT" | "DBIT" | null) ?? "CRDT",
    messageId,
    index,
  };
}

/** Alla transaktioner i en Ntry: en per TxDtls, eller Ntry:n själv utan detaljer. */
function transactionsOfEntry(ntry: Element, entry: EntryContext): CamtTransaction[] {
  const txDtls = children(ntry, "NtryDtls").flatMap((d) => children(d, "TxDtls"));
  if (txDtls.length === 0) return [toTransaction(ntry, entry)];
  return txDtls.map((tx) => toTransaction(tx, entry));
}

/**
 * Parsa en camt.053/054-fil. Kastar på XML som inte alls är camt
 * (saknar Ntry-bärande rot); en fil utan transaktioner ger tom lista.
 */
export function parseCamtXml(xml: string): CamtFile {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const root = doc.documentElement;
  if (!root || root.tagName !== "Document") throw new Error("Inte en camt-fil (Document-rot saknas).");
  const msg = children(root, "BkToCstmrDbtCdtNtfctn")[0] ?? children(root, "BkToCstmrStmt")[0];
  if (!msg) throw new Error("Inte en camt.053/054-fil (BkToCstmrDbtCdtNtfctn/BkToCstmrStmt saknas).");

  const messageId = text(find(msg, "GrpHdr", "MsgId"));
  let counter = 0;
  const index = (): number => ++counter;
  const transactions: CamtTransaction[] = [];

  // Ntfctn (054) eller Stmt (053) — kan vara flera (paginering).
  for (const container of [...children(msg, "Ntfctn"), ...children(msg, "Stmt")]) {
    for (const ntry of children(container, "Ntry")) {
      transactions.push(...transactionsOfEntry(ntry, entryContextOf(ntry, messageId, index)));
    }
  }
  // Strikta datatyper (#185): hela utdatat valideras vid parsegränsen — en
  // fil med t.ex. okänd CdtDbtInd eller trasigt datum failar HÄR, högt.
  return camtFileSchema.parse({ messageId, transactions });
}
