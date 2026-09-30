"use client";

/** Bevakningen i Att bevaka (#1266): avvisade ändringar som väntar på juristen. */

import Link from "next/link";
import { useRejectedChanges } from "@/lib/client/sync/use-rejected-changes";

export function RejectedChangesNotice() {
  const count = useRejectedChanges().length;
  if (count === 0) return null;
  return (
    <Link href="/sync-conflicts" data-testid="rejected-changes-notice"
      className="mb-4 block rounded border border-orange-200 bg-orange-50 p-3 text-sm text-orange-900 hover:bg-orange-100">
      ⚠ {count === 1 ? "1 ändring" : `${count} ändringar`} avvisades av servern och behöver ditt beslut — försök igen eller kasta.
    </Link>
  );
}
