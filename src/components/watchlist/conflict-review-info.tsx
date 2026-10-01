"use client";

/**
 * Jävskontrollens dokumenterade bedömning i ärendet (#1354): vem som bedömde
 * träffarna, när och med vilken motivering. Står kvar som senaste bedömning
 * när en ny kontroll — t.ex. efter en ny motpart — gett nya träffar.
 */

import { trpc } from "@/lib/client/trpc";
import { noteTimestamp } from "@/lib/shared/billing-notes";
import type { MatterId } from "@/lib/shared/schemas/ids";

/** Det komponenten läser ur ärendet. */
interface ReviewedMatter {
  conflictCheckStatus?: string | null | undefined;
  conflictReviewedById?: string | null | undefined;
  conflictReviewedAt?: Date | string | null | undefined;
  conflictReviewNote?: string | null | undefined;
}

/** "av Anna Advokat 2026-10-01 14:05" — eller en okänd granskare. */
function reviewedBy(m: ReviewedMatter, at: Date | string, users: ReadonlyArray<{ id: string; name: string }>): string {
  const name = users.find((u) => u.id === m.conflictReviewedById)?.name ?? "okänd användare";
  const { date, time } = noteTimestamp(new Date(at));
  return `av ${name} ${date} ${time}`;
}

export function ConflictReviewInfo({ matterId }: { matterId: MatterId }) {
  const matter = trpc.matter.getById.useQuery({ id: matterId });
  const users = trpc.user.list.useQuery();
  const m: ReviewedMatter | undefined = matter.data;
  const at = m?.conflictReviewedAt;
  if (!m || !at) return null;
  const current = m.conflictCheckStatus === "REVIEWED";
  return (
    <div role="note" aria-label="Jävskontrollens bedömning" className="px-6 py-3 border-t border-gray-100 text-sm">
      <p className="text-gray-700">
        <span className="font-medium">{current ? "Jävskontrollen bedömd" : "Senaste bedömningen av jävskontrollen"}</span>{" "}
        {reviewedBy(m, at, users.data?.users ?? [])}
      </p>
      <p className="mt-1 whitespace-pre-wrap text-gray-900">{m.conflictReviewNote}</p>
    </div>
  );
}
