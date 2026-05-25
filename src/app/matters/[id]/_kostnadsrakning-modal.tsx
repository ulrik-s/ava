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
import { Clock, FileText, Mail, Send, X, AlertTriangle, Printer } from "lucide-react";
import { trpc } from "@/client/lib/trpc";
import { buildKostnadsrakningContext } from "@/shared/kostnadsrakning";
import type { TaxaLevel } from "@/shared/brottmalstaxa";
import { renderHandlebars } from "@/client/lib/kostnadsrakning/render-handlebars";
import {
  KOSTNADSRAKNING_DEFAULT_HTML,
  KOSTNADSRAKNING_TEMPLATE_CATEGORY,
} from "@/shared/kostnadsrakning-template";
import { formatCurrency } from "@/client/lib/utils";

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
  initialHasFTax?: boolean;
  initialHufStart?: string | Date | null;
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

// eslint-disable-next-line complexity
export function KostnadsrakningModal(props: Props) {
  const [hufStart, setHufStart] = useState<string>(() => defaultStart(props.initialHufStart));
  const [hufEnd, setHufEnd] = useState<string>(() => toDatetimeLocalValue(new Date()));
  const [level, setLevel] = useState<TaxaLevel>(props.initialLevel ?? 1);
  const [hasFTax, setHasFTax] = useState<boolean>(props.initialHasFTax ?? true);
  const [courtEmail, setCourtEmail] = useState<string>("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ filename: string } | null>(null);

  const templates = trpc.documentTemplate.list.useQuery();
  const matterUpdate = trpc.matter.update.useMutation();
  const recordKostn = trpc.kostnadsrakning.record.useMutation();

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
    expenses: props.expenses,
  }), [hufStart, hufEnd, level, hasFTax, props]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") props.onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [props]);

  const stoppaNu = () => setHufEnd(toDatetimeLocalValue(new Date()));

  // eslint-disable-next-line complexity
  const generate = async () => {
    setError(null);
    setGenerating(true);
    try {
      // Mall: byråns egen ("Kostnadsräkning"-kategori) eller default
      const tpl = (templates.data ?? []).find(
        (t: { category?: string | null; content?: string }) => t.category === KOSTNADSRAKNING_TEMPLATE_CATEGORY,
      ) as { content?: string } | undefined;
      const templateHtml = tpl?.content ?? KOSTNADSRAKNING_DEFAULT_HTML;

      // Rendera mall + ctx
      const html = renderHandlebars(templateHtml, ctx.templateContext);

      // Öppna i ny flik med auto-print — cross-platform PDF utan deps
      const printable = html.replace(
        "</body>",
        `<script>setTimeout(function(){window.print();},200);<\/script></body>`,
      );
      const blob = new Blob([printable], { type: "text/html; charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const tab = window.open(url, "_blank", "noopener,noreferrer");
      if (!tab) {
        throw new Error("Pop-up blockerad. Tillåt pop-ups för AVA och försök igen.");
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000);

      // Spara HTML i OPFS + registrera dokument + emit event
      const today = new Date().toISOString().slice(0, 10);
      const fileName = `Kostnadsräkning ${props.matterNumber} ${today}.html`;
      const docId = `kostn-${props.matterNumber}-${Date.now().toString(36)}`;
      const storagePath = `documents/content/${docId}.html`;
      const bytes = new TextEncoder().encode(html);
      try {
        const { loadHandle } = await import("@/client/lib/fsa/handle-store");
        const { FsaIsoGitAdapter } = await import("@/client/lib/fsa/fs-adapter");
        const handle = await loadHandle("repo-root");
        if (handle) {
          const fs = new FsaIsoGitAdapter(handle);
          await fs.writeFile("/" + storagePath, bytes);
        }
      } catch (e) {
        console.warn("[kostnadsrakning] FSA-skrivning misslyckades:", e);
      }

      try {
        await recordKostn.mutateAsync({
          id: docId,
          matterId: props.matterId,
          fileName,
          mimeType: "text/html; charset=utf-8",
          sizeBytes: bytes.byteLength,
          storagePath,
          totalInclVat: ctx.totalInclVat,
          huvudforhandlingMinutes: ctx.huvudforhandlingMinutes,
        });
      } catch (e) {
        console.warn("[kostnadsrakning] event-emit misslyckades:", e);
      }

      // Mailto (om e-post angiven)
      if (courtEmail) {
        const subject = `Kostnadsräkning Mål ${props.matterNumber} — ${props.defenderName}`;
        const body = [
          `Mål: ${props.matterNumber} (${props.matterTitle})`,
          `Klient: ${props.clientName}`,
          `Förhandlingstid: ${ctx.templateContext.huvudforhandlingFormatted}`,
          `Totalt att fakturera: ${ctx.templateContext.totalInclFormatted}`,
          "",
          "Kostnadsräkning bifogas (PDF — genererad via Spara som PDF i utskriftsdialogen).",
        ].join("\n");
        const mailto = `mailto:${encodeURIComponent(courtEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
        setTimeout(() => { window.location.href = mailto; }, 500);
      }

      setDone({ filename: fileName });
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

          <section className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
            <div>
              <span className="text-xs text-gray-700 mb-1 block">F-skatt</span>
              <div className="flex items-center gap-4 py-2 text-base">
                <label className="flex items-center gap-2">
                  <input type="radio" checked={hasFTax} onChange={() => setHasFTax(true)} className="w-5 h-5" /> Ja
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" checked={!hasFTax} onChange={() => setHasFTax(false)} className="w-5 h-5" /> Nej
                </label>
              </div>
            </div>
          </section>

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

          <section>
            <label className="block">
              <span className="text-xs text-gray-700 mb-1 flex items-center gap-1">
                <Mail size={12} /> E-post till rätten
              </span>
              <input
                type="email" value={courtEmail}
                onChange={(e) => setCourtEmail(e.target.value)}
                placeholder="t.ex. stockholms.tingsratt@dom.se"
                inputMode="email"
                autoComplete="email"
                className="w-full rounded border border-gray-300 px-3 py-2.5 text-base font-mono"
              />
            </label>
          </section>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-3">
              <AlertTriangle size={12} className="inline mr-1" /> {error}
            </p>
          )}
          {done && (
            <p className="text-sm text-green-800 bg-green-50 border border-green-200 rounded p-3">
              ✓ <strong>{done.filename}</strong> sparad i ärendets dokument.
              Utskriftsdialogen är öppen — välj <em>Spara som PDF</em> för att få filen,
              attacha sedan i mailet till rätten.
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
                <Printer size={18} />
                Generera + öppna utskrift
                {courtEmail && <Send size={14} />}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
