"use client";

/**
 * Bilagor i förfrågningsknappen (#1788): välja bilder, PDF:er och Word- eller
 * Excel-dokument till en förfrågan eller ett svar, och visa användarens egna
 * bilagor i dialogen — bilder som miniatyrer, dokument som nedladdningslänkar.
 */
import { FileText, Paperclip, X } from "lucide-react";
import { useId, useState } from "react";
import { useFeedbackAttachment } from "@/lib/client/backend/server-feedback";
import { ACCEPT, type ImageCodec, type PickedAttachment, pickAttachment } from "@/lib/client/feedback/feedback-attachments";
import { ATTACHMENT_EXT, attachmentKind, type FeedbackAttachmentType, MAX_FEEDBACK_ATTACHMENTS } from "@/lib/shared/feedback";

const THUMB = "h-16 w-16 rounded border border-gray-200 object-cover";

/** En bilaga som valts men inte skickats: miniatyr för bilder, annars typen. */
function Chosen({ a, index, onRemove }: { a: PickedAttachment; index: number; onRemove: () => void }) {
  const label = `${attachmentKind(a.type)} ${index + 1}`;
  return (
    <li className="relative">
      {a.preview
        // eslint-disable-next-line @next/next/no-img-element -- en data-URL, inte en optimerbar bild
        ? <img src={a.preview} alt={label} className={THUMB} />
        : <span className="flex h-16 w-16 flex-col items-center justify-center rounded border border-gray-200 bg-gray-50 text-xs text-gray-600"><FileText className="h-5 w-5" aria-hidden="true" />{label}</span>}
      <button type="button" aria-label={`Ta bort ${label}`} onClick={onRemove}
        className="absolute -right-1.5 -top-1.5 rounded-full bg-white p-0.5 text-gray-600 shadow hover:text-red-600">
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </li>
  );
}

/** Välj bilagor: knappen, de valda med Ta bort, och varningen om klientuppgifter. */
export function AttachmentPicker({ attachments, onChange, codec }: {
  attachments: readonly PickedAttachment[]; onChange: (attachments: PickedAttachment[]) => void; codec?: ImageCodec;
}) {
  const inputId = useId();
  const [error, setError] = useState<string | null>(null);
  const add = async (files: FileList | null): Promise<void> => {
    const picked = [...(files ?? [])];
    const room = MAX_FEEDBACK_ATTACHMENTS - attachments.length;
    const results = await Promise.all(picked.slice(0, room).map((f) => pickAttachment(f, codec)));
    const firstError = results.flatMap((r) => (r.ok ? [] : [r.error]))[0] ?? null;
    setError(picked.length > room ? `Högst ${MAX_FEEDBACK_ATTACHMENTS} bilagor.` : firstError);
    onChange([...attachments, ...results.flatMap((r) => (r.ok ? [r.attachment] : []))]);
  };
  return (
    <div className="space-y-2">
      {attachments.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Bifogade filer">
          {attachments.map((a, i) => (
            <Chosen key={`${a.type}-${String(i)}-${a.data.slice(-16)}`} a={a} index={i} onRemove={() => { onChange(attachments.filter((_, j) => j !== i)); }} />
          ))}
        </ul>
      )}
      {attachments.length < MAX_FEEDBACK_ATTACHMENTS && (
        <label htmlFor={inputId} className="inline-flex cursor-pointer items-center gap-1.5 text-sm text-blue-700 hover:text-blue-900">
          <Paperclip className="h-4 w-4" aria-hidden="true" /> Bifoga fil
          <input id={inputId} type="file" accept={ACCEPT} multiple className="sr-only"
            onChange={(e) => { void add(e.target.files); e.target.value = ""; }} />
        </label>
      )}
      <p className="text-xs text-amber-700">
        Bilder, PDF och Word- eller Excel-dokument, högst {MAX_FEEDBACK_ATTACHMENTS} st och 10 MB var. Ta bort klientnamn,
        personnummer och ärendeuppgifter innan du bifogar (beskär eller måla över i bilder, använd en mall eller ett
        avidentifierat exempel i dokument). Bilagor sparas inte i utkastet.
      </p>
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
    </div>
  );
}

/** En skickad bilaga: bilden som miniatyr, dokumentet som nedladdningslänk. */
function Sent({ number, path, index }: { number: number; path: string; index: number }) {
  const file = useFeedbackAttachment(number, path);
  if (!file.data) return <span className="inline-block h-16 w-16 rounded bg-gray-100" aria-label={`Bilaga ${index + 1} laddas`} />;
  const type: FeedbackAttachmentType = file.data.type;
  const label = `${attachmentKind(type)} ${index + 1}`;
  const href = `data:${type};base64,${file.data.data}`;
  if (type.startsWith("image/")) {
    return (
      <a href={href} target="_blank" rel="noreferrer" aria-label={`Visa ${label}`}>
        {/* eslint-disable-next-line @next/next/no-img-element -- en data-URL, inte en optimerbar bild */}
        <img src={href} alt={label} className={THUMB} />
      </a>
    );
  }
  return (
    <a href={href} download={`bilaga-${index + 1}.${ATTACHMENT_EXT[type]}`}
      className="inline-flex items-center gap-1 rounded border border-gray-200 bg-white px-2 py-1 text-xs text-blue-700 hover:text-blue-900">
      <FileText className="h-4 w-4" aria-hidden="true" /> {label}
    </a>
  );
}

/** Användarens egna bilagor i förfrågan eller ett svar. */
export function FeedbackAttachments({ number, paths }: { number: number; paths: readonly string[] }) {
  if (paths.length === 0) return null;
  return (
    <ul className="mt-1.5 flex flex-wrap gap-2" aria-label="Bilagor">
      {paths.map((path, i) => <li key={path}><Sent number={number} path={path} index={i} /></li>)}
    </ul>
  );
}
