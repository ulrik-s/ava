/**
 * camt.054-generator för e2e (#1067) — ren strängbyggare, ingen I/O.
 *
 * ## Varför den behövs
 *
 * `camt-parse.ts` är väl testad mot RIKTIGA SEB-filer i `test/fixtures/camt-seb`.
 * Men de filerna har fasta referenser och kan därför aldrig matcha fakturor
 * ett e2e just skapat. Följden är att e2e:erna byggt camt-TRANSAKTIONER i
 * minnet och matat matcharen direkt — vilket hoppar över hela XML-steget.
 *
 * Det är en verklig lucka: går parsern sönder, eller driver bankens format,
 * märker ingen kontroll det förrän en byrå importerar en fil som inte
 * bokförs. Med generatorn körs hela kedjan i CI: bankfil → parser → matchning
 * → bokförd betalning.
 *
 * ## Varför den härmar fixturen elementvis
 *
 * Strukturen nedan följer `camt.054_SE_CRED_BGC.xml` från SEB:s Test Bench
 * element för element — samma nästling, samma namnrymd, samma
 * `Ntry → NtryDtls → TxDtls`-hierarki. Det är avsiktligt: en generator som
 * bygger det VÅR parser råkar gilla bevisar ingenting. Den ska producera det
 * en bank faktiskt skickar.
 *
 * Beloppen skrivs i kronor med två decimaler (camt räknar i valutaenheter),
 * medan domänen räknar i öre. Konverteringen sker bara här.
 */

/** Belopp i öre → camt:s kron-representation ("125.00"). */
function kronor(ore: number): string {
  return (ore / 100).toFixed(2);
}

/** XML-escape för fri text — ett `&` i en klientreferens ska inte spräcka filen. */
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** En strukturerad referens (OCR/fakturanr) med valfritt eget delbelopp. */
export interface StructuredRef {
  /** OCR-nummer eller fakturanummer. */
  ref: string;
  /** Delbelopp i öre. Utelämnas → hela transaktionsbeloppet avser referensen. */
  amountOre?: number;
}

export interface CamtTx {
  /** Bankens transaktionsreferens — nyckeln för idempotent import. */
  reference: string;
  amountOre: number;
  /** Betalarens namn (DOMSTOLSVERKET, klientens namn, …). */
  debtorName: string;
  /** Strukturerade referenser (`RmtInf/Strd`) — OCR-vägen. */
  structuredRefs?: StructuredRef[];
  /** Fri text (`RmtInf/Ustrd`) — målnummer/ärendereferens-vägen (#175). */
  freeTexts?: string[];
}

export interface CamtFileOptions {
  /** Bokförings-/valutadatum (YYYY-MM-DD). */
  bookingDate: string;
  /** Meddelande-id i GrpHdr. Default härleds ur datumet. */
  messageId?: string;
}

function structuredBlock(r: StructuredRef): string {
  const amt = r.amountOre === undefined ? "" : `
								<RfrdDocAmt>
									<RmtdAmt Ccy="SEK">${kronor(r.amountOre)}</RmtdAmt>
								</RfrdDocAmt>`;
  return `
							<Strd>
								<RfrdDocInf>
									<Tp>
										<CdOrPrtry>
											<Cd>CINV</Cd>
										</CdOrPrtry>
									</Tp>
									<Nb>${esc(r.ref)}</Nb>
								</RfrdDocInf>${amt}
							</Strd>`;
}

/** En `TxDtls` — bankens itemisering av EN betalning inom kontohändelsen. */
function txDetails(tx: CamtTx): string {
  const strd = (tx.structuredRefs ?? []).map(structuredBlock).join("");
  const ustrd = (tx.freeTexts ?? []).map((t) => `
							<Ustrd>${esc(t)}</Ustrd>`).join("");
  return `
					<TxDtls>
						<Refs>
							<AcctSvcrRef>${esc(tx.reference)}</AcctSvcrRef>
						</Refs>
						<AmtDtls>
							<TxAmt>
								<Amt Ccy="SEK">${kronor(tx.amountOre)}</Amt>
							</TxAmt>
						</AmtDtls>
						<RltdPties>
							<Dbtr>
								<Nm>${esc(tx.debtorName)}</Nm>
							</Dbtr>
						</RltdPties>
						<RmtInf>${strd}${ustrd}
						</RmtInf>
					</TxDtls>`;
}

/**
 * Bygg en camt.054-avisering med en kontohändelse per transaktion.
 *
 * En riktig bank kan slå ihop flera betalningar i EN `Ntry` med flera
 * `TxDtls` — det fallet finns i fixturerna och parsern hanterar det. Här är
 * det en `Ntry` per transaktion, vilket är det vanliga för bankgiro-
 * inbetalningar och räcker för att bevisa kedjan.
 */
export function buildCamt054(txs: readonly CamtTx[], opts: CamtFileOptions): string {
  const total = txs.reduce((s, t) => s + t.amountOre, 0);
  const msgId = opts.messageId ?? `AVA-E2E-${opts.bookingDate.replace(/-/g, "")}`;
  const entries = txs.map((tx) => `
			<Ntry>
				<NtryRef>${esc(tx.reference)}</NtryRef>
				<Amt Ccy="SEK">${kronor(tx.amountOre)}</Amt>
				<CdtDbtInd>CRDT</CdtDbtInd>
				<Sts>BOOK</Sts>
				<BookgDt>
					<Dt>${opts.bookingDate}</Dt>
				</BookgDt>
				<ValDt>
					<Dt>${opts.bookingDate}</Dt>
				</ValDt>
				<AcctSvcrRef>${esc(tx.reference)}</AcctSvcrRef>
				<BkTxCd>
					<Domn>
						<Cd>PMNT</Cd>
						<Fmly>
							<Cd>RCDT</Cd>
							<SubFmlyCd>ATXN</SubFmlyCd>
						</Fmly>
					</Domn>
				</BkTxCd>
				<NtryDtls>${txDetails(tx)}
				</NtryDtls>
			</Ntry>`).join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="urn:iso:std:iso:20022:tech:xsd:camt.054.001.02 camt.054.001.02.xsd" xmlns="urn:iso:std:iso:20022:tech:xsd:camt.054.001.02">
	<BkToCstmrDbtCdtNtfctn>
		<GrpHdr>
			<MsgId>${esc(msgId)}</MsgId>
			<CreDtTm>${opts.bookingDate}T08:00:00</CreDtTm>
			<AddtlInf>/CRED/</AddtlInf>
		</GrpHdr>
		<Ntfctn>
			<Id>${esc(msgId)}-N1</Id>
			<CreDtTm>${opts.bookingDate}T08:00:00</CreDtTm>
			<Acct>
				<Id>
					<Othr>
						<Id>54401060156</Id>
						<SchmeNm>
							<Cd>BBAN</Cd>
						</SchmeNm>
					</Othr>
				</Id>
				<Ccy>SEK</Ccy>
			</Acct>
			<TxsSummry>
				<TtlCdtNtries>
					<NbOfNtries>${txs.length}</NbOfNtries>
					<Sum>${kronor(total)}</Sum>
				</TtlCdtNtries>
			</TxsSummry>${entries}
		</Ntfctn>
	</BkToCstmrDbtCdtNtfctn>
</Document>
`;
}
