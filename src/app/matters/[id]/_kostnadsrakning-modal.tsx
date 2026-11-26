"use client";

/**
 * `KostnadsrakningModal` — stress-läget i rättssalen.
 *
 * Designprinciper:
 *   - **Ett enda flöde**: bekräfta start → "STOPPA NU" → "Generera".
 *   - **Stora knappar** för touch (iPad/iPhone/Android tablets).
 *   - **Live-preview** av totalbeloppet.
 *   - **Browser-print** istället för bundlad PDF-generator — fungerar
 *     identiskt på Mac, PC, iPad och Android utan extra deps.
 *   - **Auto-save** av HUF-starttid via debounced matter.update.
 *   - **Mall-driven**: läser `documentTemplate` med category "Kostnadsräkning"
 *     från byrå-data. Faller tillbaka på default-mallen.
 *   - **Regelmotor-hook**: `kostnadsrakning.record`-mutation emittar
 *     `kostnadsrakning.generated`-event så byrå-regler kan trigga.
 */

import { Clock, FileText, X, AlertTriangle, Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { persistGeneratedDoc } from "@/lib/client/demo/persist-generated-doc";
import { useHelper } from "@/lib/client/helper/use-helper";
import { renderKostnadsrakningPdf } from "@/lib/client/kostnadsrakning/render-pdf";
import { trpc } from "@/lib/client/trpc";
import { formatCurrency } from "@/lib/client/utils";
import type { TaxaLevel } from "@/lib/shared/brottmalstaxa";
import { buildKostnadsrakningContext, hasHearingEntry, withDocumentFields, type KrDocumentFields } from "@/lib/shared/kostnadsrakning";
import { formatDecimalHoursWithUnit } from "@/lib/shared/kr-format";
import { omitUndefined } from "@/lib/shared/omit-undefined";
import { primitiveText } from "@/lib/shared/primitive-text";
import type { BillingRunId, MatterId } from "@/lib/shared/schemas/ids";
import { uuidv7 } from "@/lib/shared/uuid";
import {
  AvslutChoice, ErsattningSection, ForhorSection, forhorOf, forordnandeInputOf, krRunClaimOf, type KrRunClaim, useErsattning,
} from "./_ersattning-section";
import { maybeComposeMail, recordDocument } from "./_kostnadsrakning-record";
import { UnbilledPosts, type SelectedPostIds } from "./_post-selection";
import { useKrPosts } from "./_use-kr-posts";

/** Dokumentfälten (#1218) — målnummer, titel och byråns sidfot — ärvs från KrDocumentFields. */
interface Props extends KrDocumentFields {
  matterId: MatterId;
  matterNumber: string;
  matterTitle: string;
  clientName: string;
  courtName?: string | undefined;
  defenderName: string;
  defenderEmail?: string | undefined;
  organizationName?: string | undefined;
  organizationOrgNumber?: string | undefined;
  organizationAddress?: string | undefined;
  expenses: ReadonlyArray<{
    id: string; date: string | Date; description: string;
    amount: number; vatRate?: number; vatIncluded?: boolean; billable?: boolean;
  }>;
  initialLevel?: TaxaLevel | undefined;
  initialHufStart?: string | Date | null | undefined;
  initialIsTaxe?: boolean | undefined;
  /** Rättshjälp (#383): klienten har betalat rådgivningstimmen separat →
   *  text-rad på kostnadsräkningen. */
  radgivningPaid?: boolean | undefined;
  /** Offentligt uppdrag (#1858): då kan förordnandetaxan väljas. */
  isOffentligtUppdrag?: boolean | undefined;
  onClose: () => void;
  /** Skickar in kostnadsräkningen (skapar körningen) och ger dess id. Anropas
   *  EN gång när PDF:en faktiskt renderats — inte när modalen stängs (Avbryt/
   *  Escape/X skapade förut en inskickad KR, #1121). Id:t länkar dokumentet till
   *  körningen så att "Ångra kostnadsräkning" kan ta bort det (#1230). Dialogens
   *  huvudförhandling, nivå och taxeval följer med: servern yrkar samma taxa som
   *  dokumentet (#1024). Urvalet ur postlistan (#1889) följer också med. */
  createRun: (claim: KrRunClaim, posts: SelectedPostIds) => Promise<BillingRunId>;
}

function toDatetimeLocalValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function defaultStart(stored?: string | Date | null): string {
  if (stored) return toDatetimeLocalValue(new Date(stored));
  const d = new Date();
  d.setHours(9, 0, 0, 0);
  return toDatetimeLocalValue(d);
}

/**
 * Det räkningen faktiskt yrkar. Utan förhandling (ärendet lades ner, ingen
 * "Deltagit i förhandling"-post) finns ingen förhandlingstid och ingen
 * brottmålstaxa: räkningen är bara ärendets poster (timkostnadsnorm × tid).
 */
export function effectiveHearing(hearing: boolean, hufStart: string, hufEnd: string, isTaxe: boolean): { hufEnd: string; isTaxe: boolean } {
  return hearing ? { hufEnd, isTaxe } : { hufEnd: hufStart, isTaxe: false };
}

/** Ärendet, försvararen, byrån och domstolen till räkningens underlag. */
function krPartiesOf(props: Props) {
  return {
    matter: { matterNumber: props.matterNumber, title: props.matterTitle, clientName: props.clientName, ...omitUndefined({ radgivningPaid: props.radgivningPaid }) },
    defender: {
      name: props.defenderName,
      ...omitUndefined({ email: props.defenderEmail }),
    },
    organization: omitUndefined({
      name: props.organizationName,
      orgNumber: props.organizationOrgNumber,
      address: props.organizationAddress,
    }),
    ...omitUndefined({ courtName: props.courtName }),
  };
}

type KostnContext = ReturnType<typeof buildKostnadsrakningContext>;
type HelperState = ReturnType<typeof useHelper>;

/** All state, auto-save, ctx-beräkning och generate-flödet för modalen. */
function useKostnadsrakningModal(props: Props) {
  const [hufStart, setHufStart] = useState<string>(() => defaultStart(props.initialHufStart));
  const [hufEnd, setHufEnd] = useState<string>(() => toDatetimeLocalValue(new Date()));
  // Yrkandedatumet (#980): när räkningen framställs — det är det som avgör vilket
  // års normer arbetet värderas på, inte när förhandlingen slutade. Låst när
  // modalen öppnas så att beloppen inte kryper medan man skriver, och skilt från
  // `hufEnd` som är ett riktigt klockslag i rättssalen.
  const [yrkandeDate] = useState<Date>(() => new Date());
  const [level, setLevel] = useState<TaxaLevel>(props.initialLevel ?? 1);
  // F-skatt antas alltid — alla advokater har F-skatt. Tidigare radio borttagen.
  const hasFTax = true;
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ filename: string; mailOpened: boolean } | null>(null);
  const helper = useHelper();

  const matterUpdate = trpc.matter.update.useMutation();
  const utils = trpc.useUtils();
  const recordKostn = trpc.kostnadsrakning.record.useMutation();
  // De valda posterna (#1889) — billable rader inkluderas i kostnadsräkningen.
  // För icke-taxa-ärenden räknas de in i arvodes-summan; för taxa-ärenden
  // visas de bara som specifikation (beloppet styrs av taxa). Dokumentet och
  // servern får exakt samma poster.
  const posts = useKrPosts(props.matterId, props.expenses);
  // Förhandlingsklockan bara när en vald post är "Deltagit i förhandling".
  // Annars: bara de valda posterna, utan klocka och taxa.
  const hearing = hasHearingEntry(posts.entries);
  const choice = useErsattning({ initialIsTaxe: props.initialIsTaxe, isOffentligtUppdrag: props.isOffentligtUppdrag ?? false, hearing });
  const { ersattning, avslut } = choice;
  const claim = effectiveHearing(hearing, hufStart, hufEnd, ersattning === "taxa");
  const showHuf = hearing && ersattning !== "forordnande";
  const runClaim = krRunClaimOf({ ersattning, avslut, hufStart, hufEnd: claim.hufEnd, taxaLevel: level, hasFTax });

  // Auto-spara HUF-start (debounced 600 ms)
  useEffect(() => {
    const t = setTimeout(() => {
      matterUpdate.mutate({ id: props.matterId, taxaHufStart: new Date(hufStart).toISOString() });
    }, 600);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hufStart]);

  const ctx = useMemo(() => buildKostnadsrakningContext(withDocumentFields({
    ...krPartiesOf(props),
    hufStart: new Date(hufStart),
    hufEnd: new Date(claim.hufEnd),
    yrkandeDate,
    taxaLevel: level,
    hasFTax,
    isTaxeArende: ersattning !== "lopande",
    // Förordnandemålet (#1858): förhören ur posterna i stället för klockan.
    ...forordnandeInputOf(ersattning, posts.entries, avslut),
    expenses: posts.expenses,
    // Låsta (redan fakturerade/redovisade) poster utelämnas av byggaren (#1205).
    timeEntries: posts.entries,
  }, props)), [hufStart, claim.hufEnd, yrkandeDate, level, ersattning, avslut, hasFTax, props, posts.entries, posts.expenses]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") props.onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [props]);

  const stoppaNu = () => setHufEnd(toDatetimeLocalValue(new Date()));

  const generate = async () => {
    if (!runClaim) return;
    setError(null);
    setGenerating(true);
    try {
      const fileName = `Kostnadsräkning ${props.matterNumber} ${primitiveText(ctx.templateContext.today)}.pdf`; // räkningens svenska datum (#980, #1677)
      // uuid — servern lagrar bara uuid-nycklade rader (dataförlusten 2026-09-23).
      const docId = uuidv7();
      // Riktig PDF direkt (pdf-lib, client-side) — öppnas inline i webbläsaren,
      // ingen utskrift behövs.
      const bytes = await renderKostnadsrakningPdf({
        result: ctx,
        meta: {
          matterNumber: props.matterNumber, matterTitle: props.matterTitle,
          clientName: props.clientName, courtName: props.courtName ?? "",
          defenderName: props.defenderName,
          ...omitUndefined({
            organizationName: props.organizationName,
            organizationOrgNumber: props.organizationOrgNumber,
          }),
        },
      });
      const storagePath = `documents/content/${docId}.pdf`;
      const billingRunId = await props.createRun(runClaim, posts.selection.ids);
      // Innehåll: in-memory blob-cache (öppna nu) + FSA (self-hosted) + demo-slab
      // (överlever reload). Metadata-raden skapas separat av recordDocument.
      await persistGeneratedDoc({ id: docId, storagePath, fileName, mimeType: "application/pdf", bytes });
      await recordDocument({
        recordKostn, utils, docId, matterId: props.matterId, billingRunId, fileName, storagePath,
        bytes, totalInclVat: ctx.totalInclVat,
        huvudforhandlingMinutes: ctx.huvudforhandlingMinutes,
      });
      const mailOpened = await maybeComposeMail({
        helperAvailable: Boolean(helper.version),
        fileName, bytes,
        matterNumber: props.matterNumber, matterTitle: props.matterTitle,
        clientName: props.clientName,
        huvudforhandlingFormatted: showHuf ? primitiveText(ctx.templateContext.huvudforhandlingFormatted) : "Ingen förhandling",
        totalInclFormatted: primitiveText(ctx.templateContext.totalInclFormatted),
      });
      setDone({ filename: fileName, mailOpened });
      setTimeout(() => props.onClose(), 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  };

  return {
    hufStart, setHufStart, hufEnd, setHufEnd, level, setLevel,
    generating, error, done, helper, ctx, stoppaNu, generate,
    hearing, showHuf, entriesLoading: posts.loading, selection: posts.selection,
    ...choice, entries: posts.entries, ready: runClaim !== null,
  };
}

export function KostnadsrakningModal(props: Props) {
  const k = useKostnadsrakningModal(props);
  const { ctx } = k;
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex md:items-center md:justify-center md:p-4">
      <div className="bg-white w-full md:max-w-2xl md:rounded-xl flex flex-col h-full md:h-auto md:max-h-[95vh] overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-4 sm:px-6 py-3 sm:py-4 sticky top-0 bg-white">
          <h2 className="text-base sm:text-xl font-bold text-gray-900 flex items-center gap-2">
            <FileText size={20} className="text-indigo-600" />
            <span className="truncate">Kostnadsräkning · {props.matterNumber}</span>
          </h2>
          <button onClick={props.onClose} aria-label="Stäng"
            className="p-2 hover:bg-gray-100 rounded touch-manipulation">
            <X size={22} />
          </button>
        </div>

        <div className="p-4 sm:p-6 space-y-5 overflow-y-auto flex-1">
          <BasisSections k={k} />
          <UnbilledPosts selection={k.selection} loading={k.entriesLoading} />
          <TimeSpecSection ctx={ctx} isTaxe={k.ersattning !== "lopande"} />
          <PreviewSection ctx={ctx} />
          <HelperStatusNote helper={k.helper} />
          <StatusMessages error={k.error} done={k.done} />
        </div>

        <ModalFooter
          done={k.done !== null}
          generating={k.generating}
          // Utan förhandling är 0 min rätt — bara med förhandling krävs en tid.
          blocked={k.entriesLoading || !k.ready || (k.showHuf && ctx.huvudforhandlingMinutes <= 0)}
          helperVersion={k.helper.version}
          onClose={props.onClose}
          onGenerate={() => void k.generate()}
        />
      </div>
    </div>
  );
}

/**
 * Grunden: förordnandetaxan med avslut och förhör, förhandlingsklockan med
 * ersättningstypen, eller (utan förhandling) förklaringen — i ett offentligt
 * uppdrag med valet av ersättningstyp ovanför.
 */
function BasisSections({ k }: { k: ReturnType<typeof useKostnadsrakningModal> }) {
  const choice = <ErsattningSection options={k.options} ersattning={k.ersattning} onChange={k.onErsattning} level={k.level} setLevel={k.setLevel} />;
  if (k.ersattning === "forordnande") {
    return <>{choice}<AvslutChoice avslut={k.avslut} onChange={k.setAvslut} /><ForhorSection forhor={forhorOf(k.entries)} notes={k.ctx.document.notes} /></>;
  }
  if (k.hearing) {
    return (
      <>
        <HufSection
          hufStart={k.hufStart} setHufStart={k.setHufStart}
          hufEnd={k.hufEnd} setHufEnd={k.setHufEnd}
          onStoppaNu={k.stoppaNu}
          hufFormatted={k.ctx.templateContext.huvudforhandlingFormatted as string}
          hufMin={k.ctx.huvudforhandlingMinutes}
        />
        {choice}
      </>
    );
  }
  return <>{k.options.length > 1 && choice}<NoHearingNote loading={k.entriesLoading} /></>;
}

/** Ärendet har ingen förhandlingspost: förklara varför klockan saknas. */
function NoHearingNote({ loading }: { loading: boolean }) {
  if (loading) return <p className="text-sm text-gray-500">Läser in ärendets poster…</p>;
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700" role="note">
      <p className="font-semibold">Ingen förhandling</p>
      <p className="mt-1 text-gray-600">
        Ärendet har ingen post &quot;Deltagit i förhandling&quot;, så kostnadsräkningen tar bara med ärendets
        registrerade tid och utlägg, ersatt enligt timkostnadsnormen. Hade ärendet en förhandling: registrera
        en tidspost med kategorin &quot;Deltagit i förhandling&quot;, så visas förhandlingsklockan här.
      </p>
    </div>
  );
}

/** Huvudförhandling: start/slut + "STOPPA NU" + live längd. */
function HufSection({ hufStart, setHufStart, hufEnd, setHufEnd, onStoppaNu, hufFormatted, hufMin }: {
  hufStart: string; setHufStart: (v: string) => void;
  hufEnd: string; setHufEnd: (v: string) => void;
  onStoppaNu: () => void; hufFormatted: string; hufMin: number;
}) {
  return (
    <section>
      <h3 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-1.5">
        <Clock size={14} /> Huvudförhandling
      </h3>
      <div className="space-y-3">
        <label className="block">
          <span className="text-xs text-gray-600 mb-1 block">Start</span>
          <input
            type="datetime-local" value={hufStart}
            onChange={(e) => setHufStart(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2.5 text-base font-mono"
          />
          <span className="text-[10px] text-gray-400 mt-0.5 block">Sparas automatiskt</span>
        </label>

        <button
          type="button"
          onClick={onStoppaNu}
          className="w-full py-5 bg-red-600 text-white text-xl font-bold rounded-lg shadow-lg hover:bg-red-700 active:scale-[0.98] transition-transform touch-manipulation"
          title="Sätt sluttid = nu"
        >
          ⏱  STOPPA NU
        </button>

        <label className="block">
          <span className="text-xs text-gray-600 mb-1 block">Slut</span>
          <input
            type="datetime-local" value={hufEnd}
            onChange={(e) => setHufEnd(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2.5 text-base font-mono"
          />
        </label>

        <p className="text-center text-2xl sm:text-3xl font-bold text-indigo-700">
          {hufFormatted}
          <span className="text-xs text-gray-500 font-normal ml-2">({hufMin} min)</span>
        </p>
      </div>
    </section>
  );
}

/** Tidsspecifikation — bara när det finns billable rader. */
function TimeSpecSection({ ctx, isTaxe }: { ctx: KostnContext; isTaxe: boolean }) {
  if (ctx.timeLines.length === 0) return null;
  return (
    <section>
      <h3 className="text-sm font-semibold text-gray-700 mb-2">Tidsspecifikation</h3>
      <div className="text-xs text-gray-600 mb-2">
        {ctx.timeLines.length} billable {ctx.timeLines.length === 1 ? "rad" : "rader"} — tot{" "}
        <span className="font-mono">{formatDecimalHoursWithUnit(ctx.billableArbetsMinutes)}</span>{" + HUF "}
        <span className="font-mono">{formatDecimalHoursWithUnit(ctx.huvudforhandlingMinutes)}</span>{" = "}
        <span className="font-mono font-semibold">{formatDecimalHoursWithUnit(ctx.totalArbetsMinutes)}</span>
        {!isTaxe && " (grunden för icke-taxa-beräkningen)"}
      </div>
    </section>
  );
}

/** Belopps-förhandsvisning (arvode + utlägg + total). */
function PreviewSection({ ctx }: { ctx: KostnContext }) {
  return (
    <section className="bg-gray-50 border border-gray-200 rounded p-4">
      <h3 className="text-sm font-semibold text-gray-700 mb-2">Förhandsvisning</h3>
      {ctx.taxa.kind === "exceeds-max" && (
        <div className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded p-2 mb-2">
          <AlertTriangle size={12} className="inline mr-1" />
          Tid &gt; 3 tim 45 min. Ersättning räknas enligt timkostnadsnorm × faktisk tid.
        </div>
      )}
      <dl className="grid grid-cols-2 gap-y-1 text-sm">
        <dt className="text-gray-600">Arvode inkl moms</dt>
        <dd className="font-mono text-right">{formatCurrency(ctx.arvodeInclVat)}</dd>
        <dt className="text-gray-600">Utlägg inkl moms ({ctx.expenseLines.length} st)</dt>
        <dd className="font-mono text-right">{formatCurrency(ctx.expenseSummary.inclVat)}</dd>
        <dt className="text-gray-900 font-bold pt-1 border-t border-gray-200">Total</dt>
        <dd className="font-mono text-right font-bold text-gray-900 pt-1 border-t border-gray-200">{formatCurrency(ctx.totalInclVat)}</dd>
      </dl>
    </section>
  );
}

/** Helper-status-noten (mail-app-integration). */
function HelperStatusNote({ helper }: { helper: HelperState }) {
  return (
    <section className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded px-3 py-2">
      {helper.checked && helper.version
        ? <>✓ AVA Helper {helper.version} installerad — mail-appen öppnas med bilaga efter generering.</>
        : helper.checked
          ? <>Helper ej installerad — dokumentet sparas i ärendet, du kan skicka mail manuellt därifrån.</>
          : <>Kontrollerar helper-status…</>}
    </section>
  );
}

/** Fel- och klar-meddelanden. */
function StatusMessages({ error, done }: { error: string | null; done: { filename: string; mailOpened: boolean } | null }) {
  return (
    <>
      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-3">
          <AlertTriangle size={12} className="inline mr-1" /> {error}
        </p>
      )}
      {done && (
        <p className="text-sm text-green-800 bg-green-50 border border-green-200 rounded p-3">
          ✓ <strong>{done.filename}</strong> sparad i ärendets dokument.
          {done.mailOpened
            ? <> Mail-appen öppnas med kostnadsräkningen som bilaga — fyll i adressaten och skicka.</>
            : <> Bifoga manuellt när du skickar mail till rätten.</>}
        </p>
      )}
    </>
  );
}

/** Footer: avbryt/stäng + generera-knappen. */
function ModalFooter({ done, generating, blocked, helperVersion, onClose, onGenerate }: {
  done: boolean; generating: boolean;
  /** Inte redo: posterna läses in, eller förhandlingen saknar tid. */
  blocked: boolean;
  helperVersion: HelperState["version"]; onClose: () => void; onGenerate: () => void;
}) {
  return (
    <div className="border-t border-gray-200 px-4 sm:px-6 py-3 bg-gray-50 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 sticky bottom-0">
      <button onClick={onClose}
        className="text-sm text-gray-600 hover:text-gray-900 py-2 px-3 order-2 sm:order-1">
        {done ? "Stäng" : "Avbryt"}
      </button>
      <button
        type="button"
        onClick={onGenerate}
        disabled={generating || blocked}
        className="w-full sm:w-auto px-6 py-3.5 bg-indigo-600 text-white text-base font-semibold rounded-lg shadow hover:bg-indigo-700 disabled:opacity-50 inline-flex items-center justify-center gap-2 touch-manipulation order-1 sm:order-2"
      >
        {generating ? (
          <>Genererar…</>
        ) : (
          <>
            <Save size={18} />
            {helperVersion ? "Generera + öppna mail" : "Generera + spara"}
          </>
        )}
      </button>
    </div>
  );
}
