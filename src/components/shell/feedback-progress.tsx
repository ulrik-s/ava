"use client";

/**
 * Hur långt en förfrågan kommit (#2216), överst i tråden: en tidslinje
 * (mottaget → godkänt → byggs → levereras), uppskattningen med sitt skäl och
 * delarna med en mätare. Data kommer med förfrågan från `feedback.mine`
 * (fältet `progress`); utan det visas inget — bara statusen, som förut.
 */

import { cn } from "@/lib/client/utils";
import type { FeedbackEta, FeedbackItem, FeedbackPartState, FeedbackProgress as Progress } from "@/lib/shared/feedback";

type StepStatus = "done" | "now" | "todo";

interface Step {
  title: string;
  detail: string | null;
  status: StepStatus;
}

/** "22 nov." */
function day(iso: string): string {
  return new Date(iso).toLocaleDateString("sv-SE", { day: "numeric", month: "short" });
}

function deliveryStep(item: FeedbackItem, built: boolean): Step {
  if (item.state === "levererad") {
    return { title: item.release ? `Levererat i ${item.release}` : "Levererat", detail: null, status: "done" };
  }
  return { title: "Levereras", detail: "Kommer med en uppdatering av AVA när sista delen är klar", status: built ? "now" : "todo" };
}

/** Tidslinjens fyra steg: klara gröna, det pågående blått, kommande grå. */
function timelineSteps(item: FeedbackItem, progress: Progress): Step[] {
  const built = progress.done >= progress.total || item.state === "levererad";
  return [
    { title: "Mottaget", detail: day(item.createdAt), status: "done" },
    { title: "Godkänt", detail: progress.approvedAt ? day(progress.approvedAt) : null, status: "done" },
    { title: `Byggs: ${progress.done} av ${progress.total} delar klara`, detail: null, status: built ? "done" : "now" },
    deliveryStep(item, built),
  ];
}

const MARKER: Readonly<Record<StepStatus, string>> = {
  done: "border-green-700 bg-green-700 text-white",
  now: "border-blue-700 bg-white text-blue-700 ring-4 ring-blue-50",
  todo: "border-gray-200 bg-white text-gray-500",
};

const STATUS_LABEL: Readonly<Record<StepStatus, string>> = { done: "klart", now: "pågår nu", todo: "kommer" };

function Timeline({ steps }: { steps: Step[] }) {
  return (
    <ol className="m-0 list-none p-0" aria-label="Tidslinje">
      {steps.map((s, n) => (
        <li key={s.title} className="relative grid grid-cols-[22px_1fr] gap-2.5 pb-3.5 last:pb-0" aria-current={s.status === "now" ? "step" : undefined}>
          {n < steps.length - 1 && <span aria-hidden="true" className="absolute bottom-0 left-[10px] top-[18px] w-0.5 bg-gray-200" />}
          <span aria-hidden="true" className={cn("z-10 grid h-[22px] w-[22px] place-items-center rounded-full border-2 text-xs font-bold", MARKER[s.status])}>
            {s.status === "done" ? "✓" : n + 1}
          </span>
          <div>
            <p className="text-sm font-semibold text-gray-900">{s.title}<span className="sr-only"> ({STATUS_LABEL[s.status]})</span></p>
            {s.detail && <p className="text-xs text-gray-500">{s.detail}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Rubriken och förklaringen i uppskattningsrutan. */
function etaText(eta: Exclude<FeedbackEta, null>): { title: string; detail: string } {
  switch (eta.kind) {
    case "range":
      return { title: `Uppskattning: ${eta.label}`, detail: eta.reason };
    case "next_release":
      return { title: "Uppskattning: med nästa uppdatering", detail: "Alla delar är klara. De kommer med nästa uppdatering av AVA." };
    case "waiting":
      return eta.on === "dig"
        ? { title: "Väntar på ditt svar", detail: "Svara i dialogen nedanför så fortsätter arbetet." }
        : { title: "Väntar på beslut", detail: "En del behöver ett beslut innan arbetet kan fortsätta. Uppskattningen kommer när beslutet är taget." };
  }
}

function EtaBox({ eta }: { eta: Exclude<FeedbackEta, null> }) {
  const { title, detail } = etaText(eta);
  return (
    <div className="grid gap-1 rounded-lg border border-blue-100 bg-blue-50 px-3.5 py-3" role="status">
      <p className="text-[15px] font-semibold text-gray-900">{title}</p>
      <p className="text-xs text-gray-600">{detail}</p>
    </div>
  );
}

const PART: Readonly<Record<FeedbackPartState, { icon: string; label: string; className: string }>> = {
  klar: { icon: "✓", label: "klar", className: "text-green-700" },
  pagar: { icon: "●", label: "pågår", className: "text-blue-700" },
  i_ko: { icon: "○", label: "i kön", className: "text-gray-400" },
  vantar_beslut: { icon: "⏸", label: "väntar på beslut", className: "text-amber-700" },
};

function Parts({ progress }: { progress: Progress }) {
  const label = `${progress.done} av ${progress.total} delar klara`;
  return (
    <div className="space-y-2">
      <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}
        className="h-1.5 overflow-hidden rounded-full bg-gray-200">
        <div className="h-full rounded-full bg-blue-700" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
      </div>
      <ul className="space-y-1 text-sm text-gray-800" aria-label="Delar">
        {progress.parts.map((p, n) => (
          <li key={`${n}-${p.title}`} className="flex gap-2">
            <span aria-hidden="true" className={cn("w-4 shrink-0 text-center", PART[p.state].className)}>{PART[p.state].icon}</span>
            <span>{p.title}<span className="sr-only"> ({PART[p.state].label})</span></span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Tidslinjen, uppskattningen och delarna — inget alls utan `progress`. */
export function FeedbackProgress({ item }: { item: FeedbackItem }) {
  const progress = item.progress;
  if (!progress) return null;
  return (
    <section className="mb-4 space-y-3" aria-label="Hur långt det kommit">
      <Timeline steps={timelineSteps(item, progress)} />
      {progress.eta && <EtaBox eta={progress.eta} />}
      <Parts progress={progress} />
    </section>
  );
}
