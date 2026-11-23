"use client";

/**
 * "Nytt i AVA" (#2010): nyheterna på vanlig svenska. Öppnas av sig själv
 * första gången man öppnar AVA efter en uppdatering (`ReleaseNotesOnUpdate`,
 * en gång i skalet), och från länken bredvid versionen i sidofältet
 * (`ReleaseNotesLink`). Användarens egna förfrågningar som levererades i en
 * version visas under den.
 */

import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { useFeedbackEnabled, useMyFeedback } from "@/lib/client/backend/server-feedback";
import { readSeenRelease, useReleaseNotes, writeSeenRelease } from "@/lib/client/backend/server-release-notes";
import { MAX_UNSEEN_RELEASES, type ReleaseNote, unseenReleases } from "@/lib/shared/release-notes";

const TITLE = "Nytt i AVA";

/** Versionen som kör (bakas in vid bygget). */
const currentVersion = (): string => process.env.NEXT_PUBLIC_AVA_VERSION ?? "";

/** Användarens egna förfrågningar som levererades i `version`. */
function MyDelivered({ version }: { version: string }) {
  const { data } = useMyFeedback();
  const mine = (data ?? []).filter((i) => i.release === version);
  if (mine.length === 0) return null;
  return (
    <p className="mt-1 text-sm text-green-700">
      Din förfrågan finns med: {mine.map((i) => `"${i.title}"`).join(", ")}
    </p>
  );
}

function ReleaseList({ notes }: { notes: readonly ReleaseNote[] }) {
  const feedback = useFeedbackEnabled();
  return (
    <div className="space-y-4">
      {notes.map((n) => (
        <section key={n.version} data-release={n.version}>
          <h4 className="text-sm font-semibold text-gray-900">
            {n.version}
            {n.date && <span className="ml-2 font-normal text-gray-500">{n.date.slice(0, 10)}</span>}
          </h4>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-gray-700">
            {n.items.map((item) => <li key={item}>{item}</li>)}
          </ul>
          {feedback && <MyDelivered version={n.version} />}
        </section>
      ))}
    </div>
  );
}

/** Öppnas av sig själv när det finns versioner användaren inte sett; stängd = sedd. */
export function ReleaseNotesOnUpdate() {
  const { data } = useReleaseNotes();
  const [closed, setClosed] = useState(false);
  const unseen = data ? unseenReleases(data, readSeenRelease(), currentVersion()) : [];
  const close = (): void => {
    writeSeenRelease(currentVersion());
    setClosed(true);
  };
  return (
    <Modal open={!closed && unseen.length > 0} title={TITLE} onClose={close}>
      <ReleaseList notes={unseen} />
    </Modal>
  );
}

/** Länken bredvid versionen: de senaste nyheterna, när som helst. */
export function ReleaseNotesLink() {
  const { data } = useReleaseNotes();
  const [open, setOpen] = useState(false);
  if (!data || data.length === 0) return null;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="text-left text-xs text-blue-600 hover:underline">
        {TITLE}
      </button>
      <Modal open={open} title={TITLE} onClose={() => setOpen(false)}>
        <ReleaseList notes={data.slice(0, MAX_UNSEEN_RELEASES)} />
      </Modal>
    </>
  );
}
