"use client";

/**
 * "Bugg eller förslag" — knappen i sidofältet. Dialogen har två vyer:
 *
 * - **Lista:** formuläret för en ny förfrågan, och en tabell över användarens
 *   förfrågningar med status och en röd prick där Claude eller Ulrik har
 *   skrivit något nytt.
 * - **Tråd:** dialogen om en förfrågan — frågor till användaren och hens svar.
 *
 * Knappen visar antalet förfrågningar med olästa meddelanden. Syns bara när
 * servern kan ta emot förfrågningar.
 */

import { ArrowLeft, MessageSquarePlus } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { Modal } from "@/components/ui/modal";
import {
  useFeedbackEnabled, useFeedbackSeen, useMyFeedback, useReplyFeedback, useSubmitFeedback,
} from "@/lib/client/backend/server-feedback";
import { cn } from "@/lib/client/utils";
import {
  FEEDBACK_STATE_LABEL, hasUnread, isFinished, lastActivity, sortForList, unreadCount,
  type FeedbackItem, type FeedbackKind, type FeedbackMessage, type MessageAuthor,
} from "@/lib/shared/feedback";

const EMPTY = { kind: "bug" as FeedbackKind, title: "", body: "" };

const AUTHOR_LABEL: Readonly<Record<MessageAuthor, string>> = { claude: "Claude", ulrik: "Ulrik", du: "Du" };

/** "10 nov 14:05" */
function shortDate(iso: string): string {
  return new Date(iso).toLocaleString("sv-SE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function UnreadDot({ label }: { label: string }) {
  return <span className="inline-block h-2.5 w-2.5 rounded-full bg-red-500" role="img" aria-label={label} />;
}

function StatusText({ item }: { item: FeedbackItem }) {
  return <>{FEEDBACK_STATE_LABEL[item.state]}{item.release ? ` i ${item.release}` : ""}</>;
}

function RequestsTable({ items, seen, onOpen }: {
  items: FeedbackItem[]; seen: Record<string, string>; onOpen: (n: number) => void;
}) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
          <th className="w-4 py-1" aria-label="Nytt" />
          <th className="py-1 font-medium">Rubrik</th>
          <th className="py-1 font-medium">Status</th>
          <th className="py-1 font-medium text-right">Senast</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100">
        {items.map((i) => (
          <tr key={i.number} className="hover:bg-gray-50 cursor-pointer" onClick={() => onOpen(i.number)}>
            <td className="py-1.5">{hasUnread(i, seen) && <UnreadDot label="Nytt meddelande" />}</td>
            <td className="py-1.5 pr-2">
              <button type="button" onClick={(e) => { e.stopPropagation(); onOpen(i.number); }}
                className="text-left text-blue-700 hover:underline truncate max-w-[16rem] block">
                {i.kind === "bug" ? "🐞" : "💡"} {i.title}
              </button>
            </td>
            <td className="py-1.5 pr-2 text-xs text-gray-600"><StatusText item={i} /></td>
            <td className="py-1.5 text-right text-xs text-gray-500 whitespace-nowrap">{shortDate(lastActivity(i))}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Message({ m }: { m: FeedbackMessage }) {
  const mine = m.from === "du";
  return (
    <li className={cn("max-w-[85%] rounded-lg px-3 py-2 text-sm", mine ? "ml-auto bg-blue-50" : "bg-gray-100")}>
      <p className="mb-0.5 text-xs text-gray-500">{AUTHOR_LABEL[m.from]} · {shortDate(m.createdAt)}</p>
      <p className="whitespace-pre-wrap">{m.body}</p>
    </li>
  );
}

function ReplyForm({ number }: { number: number }) {
  const reply = useReplyFeedback();
  const [text, setText] = useState("");
  const id = useId();
  const send = (e: React.SyntheticEvent<HTMLFormElement>): void => {
    e.preventDefault();
    reply.mutate({ number, body: text }, { onSuccess: () => setText("") });
  };
  return (
    <form onSubmit={send} className="mt-3 space-y-2">
      <label htmlFor={id} className="block text-sm font-medium text-gray-700">Ditt svar</label>
      <textarea id={id} required maxLength={5000} rows={3} value={text} onChange={(e) => setText(e.target.value)}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
      {reply.error && <p className="text-sm text-red-600" role="alert">{reply.error.message}</p>}
      <button type="submit" disabled={reply.isPending || !text.trim()}
        className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
        {reply.isPending ? "Skickar…" : "Skicka svar"}
      </button>
    </form>
  );
}

function ThreadView({ item, onBack, markSeen }: {
  item: FeedbackItem; onBack: () => void; markSeen: (n: number, at: string) => void;
}) {
  // Att öppna tråden = att läsa den: pricken försvinner (på alla enheter).
  const last = item.messages.at(-1)?.createdAt;
  useEffect(() => { if (last) markSeen(item.number, last); }, [item.number, last, markSeen]);
  return (
    <div>
      <button type="button" onClick={onBack} className="mb-3 inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Alla förfrågningar
      </button>
      <h4 className="font-semibold text-gray-900">{item.kind === "bug" ? "🐞" : "💡"} {item.title}</h4>
      <p className="mb-3 text-xs text-gray-500">Status: <StatusText item={item} /></p>
      {item.messages.length === 0
        ? <p className="text-sm text-gray-500 italic">Inga meddelanden ännu. Du får en röd prick här om vi har frågor.</p>
        : <ul className="flex flex-col gap-2">{item.messages.map((m) => <Message key={m.id} m={m} />)}</ul>}
      {item.canReply && <ReplyForm number={item.number} />}
    </div>
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

function LauncherButton({ iconOnly, unread, onClick }: { iconOnly: boolean; unread: number; onClick: () => void }) {
  const label = unread > 0 ? `Bugg eller förslag — ${unread} med nytt meddelande` : "Bugg eller förslag";
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label}
      className={cn("relative flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 mb-2", iconOnly && "w-full justify-center rounded-lg p-2 hover:bg-gray-100")}>
      <MessageSquarePlus className="h-5 w-5" aria-hidden="true" />
      {!iconOnly && "Bugg eller förslag"}
      {unread > 0 && (
        <span className="absolute -top-1 left-3 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white" aria-hidden="true">
          {unread}
        </span>
      )}
    </button>
  );
}

/** Ny förfrågan: formuläret direkt om listan är tom, annars bakom en knapp. */
function NewRequest({ hasItems }: { hasItems: boolean }) {
  const [show, setShow] = useState(!hasItems);
  const [sent, setSent] = useState<number | null>(null);
  if (sent !== null) {
    return <p className="text-sm text-green-700" role="status">Tack! Din förfrågan är mottagen (nr {sent}). Du ser hur det går för den här nedanför.</p>;
  }
  if (!show) {
    return (
      <button type="button" onClick={() => setShow(true)}
        className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">+ Ny förfrågan</button>
    );
  }
  return <FeedbackForm onSent={setSent} />;
}

/** Listan: angelägnast först; avslutade undanstoppade bakom en knapp. */
function ListView({ items, seen, onOpen }: { items: FeedbackItem[]; seen: Record<string, string>; onOpen: (n: number) => void }) {
  const [showFinished, setShowFinished] = useState(false);
  const sorted = sortForList(items, seen);
  const active = sorted.filter((i) => !isFinished(i));
  const finished = sorted.filter(isFinished);
  return (
    <>
      <NewRequest hasItems={items.length > 0} />
      <h4 className="mt-5 mb-2 text-sm font-semibold text-gray-900">Dina förfrågningar</h4>
      {items.length === 0 && <p className="text-xs text-gray-400 italic">Inga förfrågningar ännu.</p>}
      {active.length > 0 && <RequestsTable items={active} seen={seen} onOpen={onOpen} />}
      {finished.length > 0 && (
        <button type="button" onClick={() => setShowFinished(!showFinished)} className="mt-3 text-xs text-gray-600 hover:text-gray-900">
          {showFinished ? "Dölj avslutade" : `Visa avslutade (${finished.length})`}
        </button>
      )}
      {showFinished && <div className="mt-2"><RequestsTable items={finished} seen={seen} onOpen={onOpen} /></div>}
    </>
  );
}

function FeedbackLauncher({ iconOnly }: { iconOnly: boolean }) {
  const [open, setOpen] = useState(false);
  const [thread, setThread] = useState<number | null>(null);
  const mine = useMyFeedback();
  const { seen, markSeen } = useFeedbackSeen();
  const items = mine.data ?? [];
  const current = items.find((i) => i.number === thread);
  const close = (): void => { setOpen(false); setThread(null); };
  return (
    <>
      <LauncherButton iconOnly={iconOnly} unread={unreadCount(items, seen)} onClick={() => setOpen(true)} />
      <Modal open={open} title="Bugg eller förslag" onClose={close} widthClass="max-w-2xl">
        {/* Lång lista: dialogen rullar inuti, aldrig utanför skärmen. */}
        <div className="-mx-5 -my-5 max-h-[75vh] overflow-y-auto px-5 py-5">
          {current
            ? <ThreadView item={current} onBack={() => setThread(null)} markSeen={markSeen} />
            : <ListView items={items} seen={seen} onOpen={setThread} />}
        </div>
      </Modal>
    </>
  );
}
