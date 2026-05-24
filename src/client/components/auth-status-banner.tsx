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
import { useAuthMode } from "@/client/lib/auth/use-auth-mode";

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

export function AuthStatusBanner() {
  const { mode, user, loading } = useAuthMode();
  if (loading) return null;

  const label = mode === "anonymous"
    ? "Demo-läge — endast läsning"
    : mode === "identified-read"
    ? `Inloggad som @${user?.login ?? "okänd"} — endast läsning`
    : `Inloggad som @${user?.login ?? "okänd"} — kan spara`;

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
