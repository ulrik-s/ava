"use client";

/**
 * "Bugg eller förslag?" — knappen i sidofältet. Öppnar en dialog där
 * användaren beskriver en bugg eller ett förslag och ser sina tidigare
 * förfrågningar och var de är. Syns bara när servern kan ta emot dem.
 */

import { MessageSquarePlus } from "lucide-react";
import { usePathname } from "next/navigation";
import { useId, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { useFeedbackEnabled, useMyFeedback, useSubmitFeedback } from "@/lib/client/backend/server-feedback";
import { cn } from "@/lib/client/utils";
import { FEEDBACK_STATE_LABEL, type FeedbackItem, type FeedbackKind } from "@/lib/shared/feedback";

const EMPTY = { kind: "bug" as FeedbackKind, title: "", body: "" };

function MyRequests({ items }: { items: FeedbackItem[] | undefined }) {
  if (!items || items.length === 0) return <p className="text-xs text-gray-400 italic">Inga förfrågningar ännu.</p>;
  return (
    <ul className="divide-y divide-gray-100 text-sm">
      {items.map((i) => (
        <li key={i.number} className="flex items-center justify-between gap-2 py-1.5">
          <span className="truncate">{i.kind === "bug" ? "🐞" : "💡"} {i.title}</span>
          <span className="shrink-0 text-xs text-gray-500">
            {FEEDBACK_STATE_LABEL[i.state]}{i.release ? ` i ${i.release}` : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}

function FeedbackForm({ onSent }: { onSent: (n: number) => void }) {
  const pathname = usePathname();
  const submit = useSubmitFeedback();
  const [form, setForm] = useState(EMPTY);
  const titleId = useId();
  const bodyId = useId();
  const send = (e: React.SyntheticEvent<HTMLFormElement>): void => {
    e.preventDefault();
    submit.mutate(
      { ...form, page: pathname, userAgent: navigator.userAgent },
      { onSuccess: (r) => { setForm(EMPTY); onSent(r.number); } },
    );
  };
  return (
    <form onSubmit={send} className="space-y-3">
      <div className="flex gap-4 text-sm" role="radiogroup" aria-label="Typ">
        {(["bug", "feature"] as const).map((k) => (
          <label key={k} className="inline-flex items-center gap-1.5">
            <input type="radio" name="feedback-kind" checked={form.kind === k} onChange={() => setForm({ ...form, kind: k })} />
            {k === "bug" ? "Något är fel" : "Förslag"}
          </label>
        ))}
      </div>
      <div>
        <label htmlFor={titleId} className="block text-sm font-medium text-gray-700 mb-1">Rubrik</label>
        <input id={titleId} required minLength={3} maxLength={120} value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
      </div>
      <div>
        <label htmlFor={bodyId} className="block text-sm font-medium text-gray-700 mb-1">Beskrivning</label>
        <textarea id={bodyId} required minLength={10} maxLength={5000} rows={5} value={form.body}
          onChange={(e) => setForm({ ...form, body: e.target.value })}
          placeholder="Vad gjorde du, vad hände, och vad hade du väntat dig?"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        <p className="mt-1 text-xs text-amber-700">
          Skriv inga klientnamn, personnummer eller ärendeuppgifter — beskriv hellre med &quot;klient A&quot;.
          Sidan du står på och AVA-versionen skickas med automatiskt.
        </p>
      </div>
      {submit.error && <p className="text-sm text-red-600" role="alert">{submit.error.message}</p>}
      <button type="submit" disabled={submit.isPending}
        className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
        {submit.isPending ? "Skickar…" : "Skicka"}
      </button>
    </form>
  );
}

/** Knappen — bara när servern kan ta emot förfrågningar (aldrig i demon). */
export function FeedbackButton({ iconOnly = false }: { iconOnly?: boolean }) {
  return useFeedbackEnabled() ? <FeedbackLauncher iconOnly={iconOnly} /> : null;
}

function FeedbackLauncher({ iconOnly }: { iconOnly: boolean }) {
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState<number | null>(null);
  const mine = useMyFeedback(open);
  const close = (): void => { setOpen(false); setSent(null); };
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label="Bugg eller förslag" title="Bugg eller förslag"
        className={cn("flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 mb-2", iconOnly && "w-full justify-center rounded-lg p-2 hover:bg-gray-100")}>
        <MessageSquarePlus className="h-5 w-5" aria-hidden="true" />
        {!iconOnly && "Bugg eller förslag"}
      </button>
      <Modal open={open} title="Bugg eller förslag" onClose={close}>
        {sent === null
          ? <FeedbackForm onSent={setSent} />
          : <p className="text-sm text-green-700" role="status">Tack! Din förfrågan är mottagen (nr {sent}). Du ser hur det går för den här nedanför.</p>}
        <h4 className="mt-5 mb-2 text-sm font-semibold text-gray-900">Dina förfrågningar</h4>
        <MyRequests items={mine.data} />
      </Modal>
    </>
  );
}
