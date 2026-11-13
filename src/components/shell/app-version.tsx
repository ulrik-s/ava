import { cn } from "@/lib/client/utils";
import { formatAppVersion } from "@/lib/shared/app-version";

/**
 * AVA:s version och datum som liten grå text (#1578), t.ex. `v0.7.11 · 13 nov 2026`.
 * Värdena bakas in vid bygget (`next.config.ts`). Saknas versionen renderas ingenting.
 */
export function AppVersion({ className }: { className?: string }) {
  const text = formatAppVersion(
    process.env.NEXT_PUBLIC_AVA_VERSION ?? "",
    process.env.NEXT_PUBLIC_AVA_VERSION_DATE ?? "",
  );
  if (!text) return null;
  return (
    <span data-app-version title={text} className={cn("text-xs text-gray-500", className)}>
      {text}
    </span>
  );
}
