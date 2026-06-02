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

import { useEffect, useMemo, useState } from "react";
import { Clock, FileText, X, AlertTriangle, Save } from "lucide-react";
import { trpc } from "@/lib/client/trpc";
import { buildKostnadsrakningContext } from "@/lib/shared/kostnadsrakning";
import type { TaxaLevel } from "@/lib/shared/brottmalstaxa";
import { renderHandlebars } from "@/lib/client/kostnadsrakning/render-handlebars";
import {
  templateCategoryFor,
  defaultTemplateFor,
} from "@/lib/shared/kostnadsrakning-template";
import { useHelper, composeMailViaHelper } from "@/lib/client/helper/use-helper";
import { formatCurrency } from "@/lib/client/utils";
import { stashGeneratedDoc } from "@/lib/client/demo/generated-doc-cache";

interface Props {
  matterId: string;
  matterNumber: string;
  matterTitle: string;
  clientName: string;
  courtName?: string;
  defenderName: string;
  defenderEmail?: string;
  organizationName?: string;
  organizationOrgNumber?: string;
  organizationAddress?: string;
  expenses: ReadonlyArray<{
    id: string; date: string | Date; description: string;
    amount: number; vatRate?: number; vatIncluded?: boolean; billable?: boolean;
  }>;
  initialLevel?: TaxaLevel;
  /** @deprecated Alla advokater har F-skatt — fältet ignoreras. */
  initialHasFTax?: boolean;
  initialHufStart?: string | Date | null;
  initialIsTaxe?: boolean;
  onClose: () => void;
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

interface TemplateRow { category?: string | null; content?: string }

function renderHtml(isTaxe: boolean, templates: unknown, ctx: Record<string, unknown>): string {
  const wantedCategory = templateCategoryFor(isTaxe);
  const list = (templates ?? []) as TemplateRow[];
  const tpl = list.find((t) => t.category === wantedCategory);
  const html = tpl?.content ?? defaultTemplateFor(isTaxe);
  return renderHandlebars(html, ctx);
}

async function writeFsa(storagePath: string, bytes: Uint8Array): Promise<void> {
  try {
    const { loadHandle } = await import("@/lib/client/fsa/handle-store");
    const { FsaIsoGitAdapter } = await import("@/lib/client/fsa/fs-adapter");
    const handle = await loadHandle("repo-root");
    if (!handle) return;
    const fs = new FsaIsoGitAdapter(handle);
    await fs.writeFile("/" + storagePath, bytes);
  } catch (e) {
    console.warn("[kostnadsrakning] FSA-skrivning misslyckades:", e);
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
interface RecordDocOpts {
  recordKostn: { mutateAsync: (i: any) => Promise<unknown> };
  utils: {
    document: {
      list: { invalidate: (filter?: any) => Promise<unknown> };
      tree: {
        invalidate: (filter?: any) => Promise<unknown>;
        refetch: (filter?: any) => Promise<unknown>;
      };
    };
  };
  docId: string;
  matterId: string;
  fileName: string;
  storagePath: string;
  bytes: Uint8Array;
  totalInclVat: number;
  huvudforhandlingMinutes: number;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

async function recordDocument(opts: RecordDocOpts): Promise<void> {
  // Steg 1 MÅSTE lyckas. Om mutationen kastar propagerar vi felet så att
  // generate() visar en RIKTIG felruta istället för en falsk "sparad"-banner.
  // (Tidigare svaldes ALLT här → server-mutationen kunde rejekta på read-only
  // event-log utan att dokumentet skapades, men UI:t sa ändå "sparad".)
  await opts.recordKostn.mutateAsync({
    id: opts.docId, matterId: opts.matterId, fileName: opts.fileName,
    mimeType: "text/html; charset=utf-8", sizeBytes: opts.bytes.byteLength,
    storagePath: opts.storagePath, totalInclVat: opts.totalInclVat,
    huvudforhandlingMinutes: opts.huvudforhandlingMinutes,
  });
  // Steg 2 (invalidering) är best-effort — dokumentet är redan registrerat,
  // så ett invaliderings-hicka ska inte blockera success. DocumentBrowser
  // använder document.tree; faktura-panelen document.list. Invalidera båda +
  // tvinga explicit refetch på tree (R-Q v5 + tRPC v11 håller annars ibland
  // cached data tills nästa mount).
  try {
    await opts.utils.document.tree.invalidate({ matterId: opts.matterId });
    await opts.utils.document.tree.refetch({ matterId: opts.matterId });
    await opts.utils.document.list.invalidate({ matterId: opts.matterId });
    await opts.utils.document.list.invalidate();
  } catch (e) {
    console.warn("[kostnadsrakning] dokument-invalidering misslyckades (best-effort):", e);
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

interface MailOpts {
  helperAvailable: boolean;
  fileName: string;
  bytes: Uint8Array;
  matterNumber: string;
  matterTitle: string;
  clientName: string;
  huvudforhandlingFormatted: string;
  totalInclFormatted: string;
}

async function maybeComposeMail(opts: MailOpts): Promise<boolean> {
  if (!opts.helperAvailable) return false;
  const body = [
    `Mål: ${opts.matterNumber} (${opts.matterTitle})`,
    `Klient: ${opts.clientName}`,
    `Förhandlingstid: ${opts.huvudforhandlingFormatted}`,
    `Totalt att fakturera: ${opts.totalInclFormatted}`,
    "",
    "Kostnadsräkning bifogas.",
  ].join("\n");
  return composeMailViaHelper({
    fileName: opts.fileName,
    contentBase64: bytesToBase64(opts.bytes),
    mimeType: "text/html; charset=utf-8",
    subject: `Kostnadsräkning Mål ${opts.matterNumber}`,
    body,
  });
}

// eslint-disable-next-line complexity
export function KostnadsrakningModal(props: Props) {
  const [hufStart, setHufStart] = useState<string>(() => defaultStart(props.initialHufStart));
  const [hufEnd, setHufEnd] = useState<string>(() => toDatetimeLocalValue(new Date()));
  const [isTaxe, setIsTaxe] = useState<boolean>(props.initialIsTaxe ?? true);
  const [level, setLevel] = useState<TaxaLevel>(props.initialLevel ?? 1);
  // F-skatt antas alltid — alla advokater har F-skatt. Tidigare radio borttagen.
  const hasFTax = true;
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ filename: string; mailOpened: boolean } | null>(null);
  const helper = useHelper();

  const templates = trpc.documentTemplate.list.useQuery();
  const matterUpdate = trpc.matter.update.useMutation();
  const utils = trpc.useUtils();
  const recordKostn = trpc.kostnadsrakning.record.useMutation();
  // Tidsregistreringar — billable rader inkluderas i kostnadsräkningen.
  // För icke-taxa-ärenden räknas de in i arvodes-summan; för taxa-ärenden
  // visas de bara som specifikation (beloppet styrs av taxa).
  const timeEntries = trpc.timeEntry.list.useQuery({ matterId: props.matterId, pageSize: 100 });

  // Auto-spara HUF-start (debounced 600 ms)
  useEffect(() => {
    const t = setTimeout(() => {
      matterUpdate.mutate({ id: props.matterId, taxaHufStart: new Date(hufStart).toISOString() });
    }, 600);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hufStart]);

  const ctx = useMemo(() => buildKostnadsrakningContext({
    matter: { matterNumber: props.matterNumber, title: props.matterTitle, clientName: props.clientName },
    defender: { name: props.defenderName, email: props.defenderEmail },
    organization: { name: props.organizationName, orgNumber: props.organizationOrgNumber, address: props.organizationAddress },
    courtName: props.courtName,
    hufStart: new Date(hufStart),
    hufEnd: new Date(hufEnd),
    taxaLevel: level,
    hasFTax,
    isTaxeArende: isTaxe,
    expenses: props.expenses,
    timeEntries: ((timeEntries.data?.entries ?? []) as Array<{ id: string; date: string | Date; description: string; minutes: number; billable: boolean }>),
  }), [hufStart, hufEnd, level, isTaxe, props, timeEntries.data]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") props.onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [props]);

  const stoppaNu = () => setHufEnd(toDatetimeLocalValue(new Date()));

  const generate = async () => {
    setError(null);
    setGenerating(true);
    try {
      const fileName = `Kostnadsräkning ${props.matterNumber} ${new Date().toISOString().slice(0, 10)}.html`;
      const docId = `kostn-${props.matterNumber}-${Date.now().toString(36)}`;
      const html = renderHtml(isTaxe, templates.data, ctx.templateContext);
      const bytes = new TextEncoder().encode(html);
      const storagePath = `documents/content/${docId}.html`;
      // I demo-mode (GH Pages) finns ingen server som kan ta emot filen,
      // så stash:a bytes:erna i en in-memory blob-cache som document-row
      // och banner-länken slår upp när användaren klickar "öppna".
      stashGeneratedDoc(docId, bytes, "text/html", fileName);
      await writeFsa(storagePath, bytes);
      await recordDocument({
        recordKostn, utils, docId, matterId: props.matterId, fileName, storagePath,
        bytes, totalInclVat: ctx.totalInclVat,
        huvudforhandlingMinutes: ctx.huvudforhandlingMinutes,
      });
      // Persistera innehållet till demo-slaben så det kan öppnas igen efter
      // reload (metadata persisteras redan via record→writeBack). demo-bootstrap
      // lyssnar → skriver till MemFs + persist. Self-hosted: writeFsa ovan
      // skrev redan till FSA, så listenern (utan demo-runtime) no-op:ar.
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("ava:generated-doc", { detail: { id: docId, storagePath, content: html } }));
      }
      const mailOpened = await maybeComposeMail({
        helperAvailable: Boolean(helper.version),
        fileName, bytes,
        matterNumber: props.matterNumber, matterTitle: props.matterTitle,
        clientName: props.clientName,
        huvudforhandlingFormatted: String(ctx.templateContext.huvudforhandlingFormatted ?? ""),
        totalInclFormatted: String(ctx.templateContext.totalInclFormatted ?? ""),
      });
      setDone({ filename: fileName, mailOpened });
      setTimeout(() => props.onClose(), 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  };

  const hufMin = ctx.huvudforhandlingMinutes;

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
                onClick={stoppaNu}
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
                {ctx.templateContext.huvudforhandlingFormatted as string}
                <span className="text-xs text-gray-500 font-normal ml-2">({hufMin} min)</span>
              </p>
            </div>
          </section>

          <section className="space-y-3">
            <div>
              <span className="text-xs text-gray-700 mb-1 block">Ersättningstyp</span>
              <div className="flex flex-col sm:flex-row gap-3">
                <label className="flex items-center gap-2 text-base">
                  <input type="radio" checked={isTaxe} onChange={() => setIsTaxe(true)} className="w-5 h-5" />
                  Taxa (brottmålstaxan DVFS 2025:6)
                </label>
                <label className="flex items-center gap-2 text-base">
                  <input type="radio" checked={!isTaxe} onChange={() => setIsTaxe(false)} className="w-5 h-5" />
                  Icke-taxa (timkostnadsnorm × all tid)
                </label>
              </div>
            </div>
            {isTaxe && (
              <label className="block">
                <span className="text-xs text-gray-700 mb-1 block">Ersättningsnivå (DVFS 2025:6)</span>
                <select value={level} onChange={(e) => setLevel(Number(e.target.value) as TaxaLevel)}
                  className="w-full rounded border border-gray-300 px-3 py-2.5 text-base">
                  <option value={1}>1 — Grundersättning</option>
                  <option value={2}>2 — + häktningsförh. m.m.</option>
                  <option value={3}>3 — + RPU</option>
                  <option value={4}>4 — + häktning m.m. + RPU</option>
                </select>
              </label>
            )}
          </section>

          {ctx.timeLines.length > 0 && (
            <section>
              <h3 className="text-sm font-semibold text-gray-700 mb-2">Tidsspecifikation</h3>
              <div className="text-xs text-gray-600 mb-2">
                {ctx.timeLines.length} billable {ctx.timeLines.length === 1 ? "rad" : "rader"} — tot{" "}
                <span className="font-mono">{Math.round(ctx.billableArbetsMinutes / 60 * 10) / 10} h</span>
                {" + HUF "}
                <span className="font-mono">{Math.round(ctx.huvudforhandlingMinutes / 60 * 10) / 10} h</span>
                {" = "}
                <span className="font-mono font-semibold">{Math.round(ctx.totalArbetsMinutes / 60 * 10) / 10} h</span>
                {!isTaxe && " (grunden för icke-taxa-beräkningen)"}
              </div>
            </section>
          )}

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

          <section className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded px-3 py-2">
            {helper.checked && helper.version
              ? <>✓ AVA Helper {helper.version} installerad — mail-appen öppnas med bilaga efter generering.</>
              : helper.checked
                ? <>Helper ej installerad — dokumentet sparas i ärendet, du kan skicka mail manuellt därifrån.</>
                : <>Kontrollerar helper-status…</>}
          </section>

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
        </div>

        <div className="border-t border-gray-200 px-4 sm:px-6 py-3 bg-gray-50 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 sticky bottom-0">
          <button onClick={props.onClose}
            className="text-sm text-gray-600 hover:text-gray-900 py-2 px-3 order-2 sm:order-1">
            {done ? "Stäng" : "Avbryt"}
          </button>
          <button
            type="button"
            onClick={generate}
            disabled={generating || hufMin <= 0}
            className="w-full sm:w-auto px-6 py-3.5 bg-indigo-600 text-white text-base font-semibold rounded-lg shadow hover:bg-indigo-700 disabled:opacity-50 inline-flex items-center justify-center gap-2 touch-manipulation order-1 sm:order-2"
          >
            {generating ? (
              <>Genererar…</>
            ) : (
              <>
                <Save size={18} />
                {helper.version ? "Generera + öppna mail" : "Generera + spara"}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
