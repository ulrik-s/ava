import { House } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/client/utils";

/** Props för {@link HomeButton}. */
export interface HomeButtonProps {
  /** Står användaren på Startsidan (`/`)? Ger `aria-current="page"` och en ring. */
  active: boolean;
  /** Bara ikonen (hopfälld meny, ikonmenyn): texten blir tooltip och tillgängligt namn. */
  iconOnly?: boolean;
  /** Anropas vid klick, t.ex. för att stänga telefonmenyn. */
  onNavigate?: () => void;
}

/**
 * Rund knapp till Startsidan bredvid "AVA" (#1749), i alla menyvarianter.
 * Samma blå som "+ Skapa faktura"; ikonläget följer `LogoutButton`.
 */
export function HomeButton({ active, iconOnly = false, onNavigate }: HomeButtonProps) {
  return (
    <Link
      href="/"
      {...(active ? { "aria-current": "page" as const } : {})}
      {...(iconOnly ? { "aria-label": "Startsida", title: "Startsida" } : {})}
      {...(onNavigate ? { onClick: onNavigate } : {})}
      data-home-button
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full bg-blue-600 text-sm font-medium text-white hover:bg-blue-700",
        iconOnly ? "p-1.5" : "px-3 py-1",
        active && "ring-2 ring-blue-300 ring-offset-1",
      )}
    >
      <House className="h-4 w-4" aria-hidden="true" />
      {!iconOnly && <span>Startsida</span>}
    </Link>
  );
}
