"use client";

/**
 * `AuthStatusBanner` — visar nuvarande auth-mode i en liten banner
 * högst upp i appen. Tre lägen:
 *
 *   - anonymous: "Demo-läget — endast läsning"
 *   - identified-read: "Inloggad som @<user> — endast läsning"
 *   - identified-write: "Inloggad som @<user> — kan spara"
 *
 * Klick → går till /settings för att logga in/ut eller byta repo.
 */

import Link from "next/link";
import { useAuthMode } from "@/lib/client/auth/use-auth-mode";
import { trpc } from "@/lib/client/trpc";

const STYLES: Record<string, string> = {
  anonymous: "bg-gray-50 text-gray-700",
  "identified-read": "bg-amber-50 text-amber-900",
  "identified-write": "bg-green-50 text-green-900",
};

const ICONS: Record<string, string> = {
  anonymous: "👁",
  "identified-read": "👤",
  "identified-write": "✍️",
};

/** Banner-text per auth-mode. Utbruten ur komponenten för komplexitet ≤8. */
function bannerLabel(mode: string, who: string): string {
  if (mode === "anonymous") return "Demo-läge — endast läsning";
  const suffix = mode === "identified-read" ? "endast läsning" : "kan spara";
  return `Inloggad som ${who} — ${suffix}`;
}

export function AuthStatusBanner() {
  const { mode, user, loading } = useAuthMode();
  // ADR 0027: visa den FAKTISKA inloggade principalen (demo-väljaren ELLER
  // OIDC) i st.f. det pensionerade GitHub-`login`-fältet (som gav "@okänd" i
  // server-first). Faller tillbaka på legacy-login → "okänd" om inget finns.
  const me = trpc.user.current.useQuery();
  if (loading) return null;

  const who = me.data?.name ?? me.data?.email ?? user?.login ?? "okänd";
  const label = bannerLabel(mode, who);

  return (
    <Link
      href="/settings"
      className={`block w-full text-left text-xs px-3 py-1.5 flex items-center justify-between gap-2 hover:opacity-80 ${STYLES[mode]}`}
    >
      <span className="flex items-center gap-2">
        <span aria-hidden>{ICONS[mode]}</span>
        <span>{label}</span>
      </span>
      <span className="text-xs underline">Inställningar</span>
    </Link>
  );
}
