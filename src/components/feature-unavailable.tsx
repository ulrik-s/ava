/**
 * `FeatureUnavailable` — visas på sidor som inte fungerar i demo-läget
 * (kräver autentisering eller annan server-funktionalitet).
 *
 * Ger användaren en tydlig förklaring + länkar tillbaka till
 * funktionella delar av appen istället för 404.
 */

import Link from "next/link";

interface Props {
  title: string;
  description: string;
}

export function FeatureUnavailable({ title, description }: Props) {
  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold text-gray-900 mb-2">{title}</h1>
      <p className="text-sm text-gray-600 mb-6">{description}</p>

      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
        <h2 className="text-sm font-semibold text-amber-900 mb-2">Inte tillgängligt i demo-läget</h2>
        <p className="text-xs text-amber-800">
          Den här sidan kräver auth/server-funktionalitet som demo-deployen
          inte har. I full-deploy (Tier 2/3) — se{" "}
          <Link href="/" className="underline">Dashboard</Link> för att gå
          tillbaka till de delar som fungerar:
        </p>
        <ul className="mt-3 text-xs text-amber-800 space-y-1">
          <li>• <Link href="/matters" className="underline">Ärenden</Link></li>
          <li>• <Link href="/contacts" className="underline">Kontakter</Link></li>
          <li>• <Link href="/invoices" className="underline">Fakturor</Link></li>
          <li>• <Link href="/time" className="underline">Tidregistrering</Link></li>
          <li>• <Link href="/reports" className="underline">Rapporter</Link></li>
        </ul>
      </div>
    </div>
  );
}
