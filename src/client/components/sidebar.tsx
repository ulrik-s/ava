"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/client/lib/utils";

/**
 * Pure git-modell — ingen NextAuth-session. "Logga ut" rensar
 * firma-config (token), browsern reload:ar och visar inställnings-overlay:n.
 */
function signOutLocally(): void {
  try {
    const cfg = JSON.parse(localStorage.getItem("ava.firma") ?? "{}") as Record<string, unknown>;
    delete cfg.token;
    localStorage.setItem("ava.firma", JSON.stringify(cfg));
  } catch { /* ignorera */ }
  window.location.reload();
}

const navigation = [
  { name: "Dashboard", href: "/", icon: "📊" },
  { name: "Kontakter", href: "/contacts", icon: "👤" },
  { name: "Ärenden", href: "/matters", icon: "📁" },
  { name: "Dokumentsök", href: "/search", icon: "📄" },
  { name: "Dokumentmallar", href: "/templates", icon: "📝" },
  { name: "Tidregistrering", href: "/time", icon: "⏱️" },
  { name: "Jävskontroll", href: "/conflicts", icon: "🔍" },
  { name: "Rapporter", href: "/reports", icon: "📈" },
  { name: "Fakturor", href: "/invoices", icon: "💰" },
  { name: "Användare", href: "/users", icon: "👥" },
  { name: "Min profil", href: "/profile", icon: "🪪" },
  { name: "Inställningar", href: "/settings", icon: "⚙️" },
];

interface SidebarProps {
  userName?: string | null;
}

export function Sidebar({ userName }: SidebarProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Mobile top bar */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-30 flex h-14 items-center justify-between border-b border-gray-200 bg-white px-4">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-bold text-gray-900">AVA</h1>
          <span className="text-xs text-gray-500">Advokat CRM</span>
        </div>
        <button
          onClick={() => setOpen(!open)}
          className="rounded-lg p-2 text-gray-600 hover:bg-gray-100"
          aria-label="Öppna meny"
        >
          {open ? (
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
            </svg>
          )}
        </button>
      </div>

      {/* Mobile overlay */}
      {open && (
        <div className="lg:hidden fixed inset-0 z-40" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-black/30" />
          <nav
            className="absolute top-0 left-0 bottom-0 w-64 bg-white shadow-xl pt-4 flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex h-12 items-center px-6 mb-2">
              <h1 className="text-xl font-bold text-gray-900">AVA</h1>
              <span className="ml-2 text-sm text-gray-500">Advokat CRM</span>
            </div>
            <div className="px-3 space-y-1 flex-1">
              {navigation.map((item) => {
                const isActive =
                  item.href === "/"
                    ? pathname === "/"
                    : pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className={cn(
                      "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                      isActive
                        ? "bg-blue-50 text-blue-700"
                        : "text-gray-700 hover:bg-gray-100 hover:text-gray-900"
                    )}
                  >
                    <span className="text-lg">{item.icon}</span>
                    {item.name}
                  </Link>
                );
              })}
            </div>
            {/* User section mobile */}
            <div className="px-4 py-4 border-t border-gray-200">
              {userName && (
                <p className="text-sm font-medium text-gray-900 mb-2 truncate">{userName}</p>
              )}
              <button
                onClick={() => signOutLocally()}
                className="text-sm text-gray-500 hover:text-gray-700"
              >
                Logga ut
              </button>
            </div>
          </nav>
        </div>
      )}

      {/* Desktop sidebar */}
      <div className="hidden lg:flex lg:flex-col lg:w-64 lg:border-r lg:border-gray-200 lg:bg-white lg:shrink-0">
        <div className="flex h-16 items-center px-6 border-b border-gray-200">
          <h1 className="text-xl font-bold text-gray-900">AVA</h1>
          <span className="ml-2 text-sm text-gray-500">Advokat CRM</span>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          {navigation.map((item) => {
            const isActive =
              item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-blue-50 text-blue-700"
                    : "text-gray-700 hover:bg-gray-100 hover:text-gray-900"
                )}
              >
                <span className="text-lg">{item.icon}</span>
                {item.name}
              </Link>
            );
          })}
        </nav>
        {/* User section desktop */}
        <div className="px-4 py-4 border-t border-gray-200">
          {userName && (
            <p className="text-sm font-medium text-gray-900 mb-1 truncate">{userName}</p>
          )}
          <button
            onClick={() => signOutLocally()}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            Logga ut
          </button>
        </div>
      </div>
    </>
  );
}
