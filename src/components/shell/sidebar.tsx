"use client";

import { LogOut, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { z } from "zod";
import { loadFromStorage } from "@/lib/client/load-from-storage";
import { cn } from "@/lib/client/utils";

/**
 * Pure git-modell — ingen NextAuth-session. "Logga ut" rensar
 * firma-config (token + principalId) och navigerar till /login så
 * användaren kan välja konto igen. Måste rensa principalId — annars
 * tolkar demo-bootstrap reload:en som "redan inloggad".
 */
export function signOutLocally(): void {
  try {
    // Zod vid parsegränsen (#187): validera som objekt; trasigt → {} (utloggning rensar ändå).
    const cfg = loadFromStorage("ava.firma", z.record(z.string(), z.unknown()).catch({}), {});
    delete cfg.token;
    delete cfg.principalId;
    localStorage.setItem("ava.firma", JSON.stringify(cfg));
  } catch { /* ignorera */ }
  const basePath = process.env.NEXT_PUBLIC_DEMO_BASE_PATH ?? "";
  window.location.replace(`${basePath}/login/`);
}

const navigation = [
  // Jävskontroll överst — första steget i ärendehantering, mest framträdande (#89).
  // Ärenden direkt under — kärnan i det dagliga arbetet.
  { name: "Jävskontroll", href: "/conflicts", icon: "🔍" },
  { name: "Ärenden", href: "/matters", icon: "📁" },
  { name: "Startsida", href: "/", icon: "📊" },
  // EN lista för det som ska bevakas (#1167): bevakningar/frister + härledda
  // signaler. "Att göra" visade samma poster en gång till och förvirrade.
  { name: "Att bevaka", href: "/watchlist", icon: "🔔" },
  { name: "Kalender", href: "/calendar", icon: "🗓️" },
  { name: "Kontakter", href: "/contacts", icon: "👤" },
  { name: "Dokumentsök", href: "/search", icon: "📄" },
  { name: "Dokumentmallar", href: "/templates", icon: "📝" },
  { name: "Tidregistrering", href: "/time", icon: "⏱️" },
  { name: "Rapporter", href: "/reports", icon: "📈" },
  { name: "Fakturor", href: "/invoices", icon: "💰" },
  { name: "Avbetalningar", href: "/payment-plans", icon: "📅" },
  { name: "Användare", href: "/users", icon: "👥" },
  { name: "Min profil", href: "/profile", icon: "🪪" },
  { name: "Inställningar", href: "/settings", icon: "⚙️" },
];

interface SidebarProps {
  userName?: string | null;
}

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

/** Delade props för länkar/användardel: `iconOnly` = hopfällt desktop-läge (#1198). */
interface IconOnlyProp {
  iconOnly?: boolean;
}

/** Navigations-länkarna (delas av mobil-drawern + desktop-sidofältet, DRY). */
function NavLinks({ pathname, onNavigate, py = "py-2", iconOnly = false }: { pathname: string; onNavigate?: () => void; py?: string } & IconOnlyProp) {
  return (
    <>
      {navigation.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          {...(onNavigate ? { onClick: onNavigate } : {})}
          {...(iconOnly ? { title: item.name } : {})}
          className={cn(
            "flex items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors",
            py,
            iconOnly && "justify-center",
            isActive(pathname, item.href)
              ? "bg-blue-50 text-blue-700"
              : "text-gray-700 hover:bg-gray-100 hover:text-gray-900",
          )}
        >
          <span className="text-lg" aria-hidden="true">{item.icon}</span>
          <span className={cn(iconOnly && "sr-only")}>{item.name}</span>
        </Link>
      ))}
    </>
  );
}

/** "Logga ut" — textknapp, eller ikonknapp i hopfällt läge. */
function LogoutButton({ iconOnly = false }: IconOnlyProp) {
  if (iconOnly) {
    return (
      <button
        onClick={() => signOutLocally()}
        aria-label="Logga ut"
        title="Logga ut"
        className="flex w-full justify-center rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
      >
        <LogOut className="h-5 w-5" aria-hidden="true" />
      </button>
    );
  }
  return (
    <button
      onClick={() => signOutLocally()}
      className="text-sm text-gray-500 hover:text-gray-700"
    >
      Logga ut
    </button>
  );
}

/** Användarnamn + "Logga ut" (delas av mobil-drawern + desktop-sidofältet). */
function UserSection({ userName, nameMargin = "mb-1", iconOnly = false }: { userName?: string | null | undefined; nameMargin?: string } & IconOnlyProp) {
  return (
    <div className={cn("py-4 border-t border-gray-200", iconOnly ? "px-2" : "px-4")}>
      {userName && !iconOnly && (
        <p className={cn("text-sm font-medium text-gray-900 truncate", nameMargin)}>{userName}</p>
      )}
      <LogoutButton iconOnly={iconOnly} />
    </div>
  );
}

/** localStorage-nyckel för desktop-menyns hopfällda läge (per webbläsare). */
const COLLAPSED_KEY = "ava.sidebar.collapsed";

const noopSubscribe = (): (() => void) => () => {};
const readCollapsed = (): boolean => loadFromStorage(COLLAPSED_KEY, z.boolean(), false);
const serverCollapsed = (): boolean => false;

/**
 * Hopfällt-läget för desktop-menyn. Sidofältet server-renderas i den
 * statiska exporten → lagringen läses via `useSyncExternalStore` med
 * server-snapshot `false` (ingen hydreringsmismatch, ingen setState-i-effect).
 * Efter en växling gäller komponentens eget val, även om lagringen är blockerad.
 */
function useCollapsed(): [boolean, () => void] {
  const stored = useSyncExternalStore(noopSubscribe, readCollapsed, serverCollapsed);
  const [override, setOverride] = useState<boolean | null>(null);
  const collapsed = override ?? stored;
  const toggle = (): void => {
    const next = !collapsed;
    setOverride(next);
    try {
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify(next));
    } catch { /* lagring blockerad — läget gäller bara denna vy */ }
  };
  return [collapsed, toggle];
}

/** Sidofältets huvud: "AVA" (+ "Advokat CRM" i fullt läge) och växlingsknappen. */
function SidebarHeader({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const ToggleIcon = collapsed ? PanelLeftOpen : PanelLeftClose;
  const toggleLabel = collapsed ? "Fäll ut menyn" : "Fäll ihop menyn";
  return (
    <div className={cn("flex h-16 items-center border-b border-gray-200", collapsed ? "flex-col justify-center gap-1 px-2" : "px-6")}>
      <h1 className={cn("font-bold text-gray-900", collapsed ? "text-base" : "text-xl")}>AVA</h1>
      {!collapsed && <span className="ml-2 text-sm text-gray-500">Advokat CRM</span>}
      <button
        onClick={onToggle}
        aria-label={toggleLabel}
        title={toggleLabel}
        className={cn("rounded-lg p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700", !collapsed && "ml-auto")}
      >
        <ToggleIcon className="h-5 w-5" aria-hidden="true" />
      </button>
    </div>
  );
}

/** Desktop-sidofältet — fullt (lg:w-64) eller bara ikoner (lg:w-16). */
function DesktopSidebar({ pathname, userName }: { pathname: string; userName?: string | null | undefined }) {
  const [collapsed, toggle] = useCollapsed();
  return (
    <div className={cn("hidden lg:flex lg:flex-col lg:border-r lg:border-gray-200 lg:bg-white lg:shrink-0", collapsed ? "lg:w-16" : "lg:w-64")}>
      <SidebarHeader collapsed={collapsed} onToggle={toggle} />
      <nav className={cn("flex-1 py-4 space-y-1", collapsed ? "px-2" : "px-3")}>
        <NavLinks pathname={pathname} iconOnly={collapsed} />
      </nav>
      <UserSection userName={userName} iconOnly={collapsed} />
    </div>
  );
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
              <NavLinks pathname={pathname} onNavigate={() => setOpen(false)} py="py-2.5" />
            </div>
            <UserSection userName={userName} nameMargin="mb-2" />
          </nav>
        </div>
      )}

      {/* Desktop sidebar */}
      <DesktopSidebar pathname={pathname} userName={userName} />
    </>
  );
}
