"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc";

const IS_DEMO_BUILD = process.env.NEXT_PUBLIC_DEMO_BUILD === "1";

export default function Page() {
  // Demo-build:n har ingen "Dashboard" — / redirectar till /demo.
  // Vi splittar i två toppfunktioner så test-suiten (jsdom utan
  // app-router) inte tvingas mocka useRouter när den testar
  // Dashboard:en.
  if (IS_DEMO_BUILD) return <DemoRedirect />;
  return <Dashboard />;
}

function DemoRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace("/demo"); }, [router]);
  return null;
}

function Dashboard() {
  const contacts = trpc.contacts.list.useQuery({ page: 1, pageSize: 5 });
  const matters = trpc.matter.list.useQuery({ page: 1, pageSize: 5, status: "ACTIVE" });

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Dashboard</h1>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <p className="text-sm text-gray-500">Kontakter</p>
          <p className="text-3xl font-bold text-gray-900 mt-1">
            {contacts.data?.total ?? "..."}
          </p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <p className="text-sm text-gray-500">Aktiva ärenden</p>
          <p className="text-3xl font-bold text-gray-900 mt-1">
            {matters.data?.total ?? "..."}
          </p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <p className="text-sm text-gray-500">Snabblänkar</p>
          <div className="mt-2 space-y-1">
            <Link href="/contacts?new=1" className="block text-sm text-blue-600 hover:underline">
              + Ny kontakt
            </Link>
            <Link href="/matters?new=1" className="block text-sm text-blue-600 hover:underline">
              + Nytt ärende
            </Link>
            <Link href="/conflicts" className="block text-sm text-blue-600 hover:underline">
              Jävskontroll
            </Link>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg border border-gray-200">
          <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
            <h2 className="font-semibold text-gray-900">Senaste kontakter</h2>
            <Link href="/contacts" className="text-sm text-blue-600 hover:underline">Visa alla</Link>
          </div>
          <div className="divide-y divide-gray-100">
            {contacts.data?.contacts.map((contact) => (
              <Link key={contact.id} href={`/contacts/${contact.id}`} className="block px-6 py-3 hover:bg-gray-50">
                <p className="text-sm font-medium text-gray-900">{contact.name}</p>
                <p className="text-xs text-gray-500">
                  {contactTypeLabel(contact.contactType)} · {contact._count.matterLinks} ärenden
                </p>
              </Link>
            ))}
            {contacts.data?.contacts.length === 0 && (
              <p className="px-6 py-4 text-sm text-gray-500">Inga kontakter ännu</p>
            )}
          </div>
        </div>

        <div className="bg-white rounded-lg border border-gray-200">
          <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
            <h2 className="font-semibold text-gray-900">Aktiva ärenden</h2>
            <Link href="/matters" className="text-sm text-blue-600 hover:underline">Visa alla</Link>
          </div>
          <div className="divide-y divide-gray-100">
            {matters.data?.matters.map((matter) => {
              const klient = matter.contacts[0]?.contact.name;
              return (
                <Link key={matter.id} href={`/matters/${matter.id}`} className="block px-6 py-3 hover:bg-gray-50">
                  <p className="text-sm font-medium text-gray-900">
                    {matter.matterNumber} — {matter.title}
                  </p>
                  <p className="text-xs text-gray-500">
                    {klient ?? "Ingen klient"} · {matter._count.documents} dok · {matter._count.timeEntries} tidposter
                  </p>
                </Link>
              );
            })}
            {matters.data?.matters.length === 0 && (
              <p className="px-6 py-4 text-sm text-gray-500">Inga aktiva ärenden</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function contactTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    PERSON: "Person",
    COMPANY: "Företag",
    COURT: "Domstol",
    AUTHORITY: "Myndighet",
    INSURANCE_COMPANY: "Försäkringsbolag",
    LAW_FIRM: "Advokatbyrå",
    OTHER: "Övrig",
  };
  return labels[type] || type;
}
