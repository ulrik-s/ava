"use client";

import { use, useState } from "react";
import Link from "next/link";
import { trpc } from "@/lib/trpc";
import { formatMinutes, formatCurrency } from "@/lib/utils";
import { labelForMatterRole, matterRoles, contactTypes } from "@/lib/labels";
import { DocumentBrowser } from "@/components/document-browser";
import { SuggestionsPanel } from "@/components/suggestions-panel";
import { EventsPanel } from "@/components/events-panel";
import { InvoicesSection } from "@/components/invoices-section";
import { FileDown } from "lucide-react";

export default function MatterDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const matter = trpc.matter.getById.useQuery({ id });
  const timeEntries = trpc.timeEntry.list.useQuery({ matterId: id });
  const expenses = trpc.expense.list.useQuery({ matterId: id });
  const utils = trpc.useUtils();

  const [showContactForm, setShowContactForm] = useState(false);
  const [showTimeForm, setShowTimeForm] = useState(false);
  const [showExpenseForm, setShowExpenseForm] = useState(false);
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [generateTemplateId, setGenerateTemplateId] = useState("");
  const [generateFormat, setGenerateFormat] = useState<"pdf" | "docx">("pdf");
  const [generateRecipientIds, setGenerateRecipientIds] = useState<string[]>([]);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  const templates = trpc.documentTemplate.list.useQuery(undefined, { enabled: showGenerateModal });

  const handleGenerate = async () => {
    if (!generateTemplateId) return;
    setGenerating(true);
    setGenerateError(null);
    try {
      const res = await fetch("/api/templates/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateId: generateTemplateId,
          matterId: id,
          format: generateFormat,
          recipientContactIds: generateRecipientIds,
        }),
      });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        throw new Error(err.error || "Generering misslyckades");
      }
      const { documents } = await res.json() as {
        documents: Array<{ documentId: string; fileName: string; recipientContactId: string | null }>;
      };
      // Open / download each generated doc. PDFs in new tabs, DOCX as download.
      for (const doc of documents) {
        if (generateFormat === "pdf") {
          window.open(`/api/documents/${doc.documentId}/download`, "_blank", "noopener,noreferrer");
        } else {
          const dl = document.createElement("a");
          dl.href = `/api/documents/${doc.documentId}/download?download=1`;
          dl.download = doc.fileName;
          dl.click();
        }
      }
      // Refresh document browser
      utils.document.tree.invalidate({ matterId: id });
      setShowGenerateModal(false);
      setGenerateRecipientIds([]);
    } catch (e) {
      setGenerateError(e instanceof Error ? e.message : "Okänt fel");
    } finally {
      setGenerating(false);
    }
  };

  const toggleRecipient = (contactId: string) => {
    setGenerateRecipientIds((prev) =>
      prev.includes(contactId) ? prev.filter((x) => x !== contactId) : [...prev, contactId]
    );
  };

  // Add existing contact to matter
  const existingContacts = trpc.contacts.list.useQuery({ pageSize: 100 });
  const addContact = trpc.matter.addContact.useMutation({
    onSuccess: () => {
      utils.matter.getById.invalidate({ id });
      setExistingContactForm({ contactId: "", role: "MOTPART", notes: "" });
    },
  });

  // Create new contact and add to matter
  const addNewContact = trpc.matter.addNewContact.useMutation({
    onSuccess: () => {
      utils.matter.getById.invalidate({ id });
      utils.contacts.list.invalidate();
      setShowContactForm(false);
      setNewContactForm({ name: "", contactType: "PERSON", personalNumber: "", orgNumber: "", email: "", phone: "", role: "MOTPART", notes: "" });
    },
  });

  const removeContact = trpc.matter.removeContact.useMutation({
    onSuccess: () => utils.matter.getById.invalidate({ id }),
  });

  const createTimeEntry = trpc.timeEntry.create.useMutation({
    onSuccess: () => {
      utils.timeEntry.list.invalidate({ matterId: id });
      setShowTimeForm(false);
      setTimeForm({ date: new Date().toISOString().split("T")[0], minutes: 30, description: "", billable: true });
    },
  });

  const createExpense = trpc.expense.create.useMutation({
    onSuccess: () => {
      utils.expense.list.invalidate({ matterId: id });
      setShowExpenseForm(false);
      setExpenseForm({ date: new Date().toISOString().split("T")[0], amount: 0, description: "", billable: true });
    },
  });

  const deleteExpense = trpc.expense.delete.useMutation({
    onSuccess: () => utils.expense.list.invalidate({ matterId: id }),
  });

  const [addMode, setAddMode] = useState<"existing" | "new">("new");

  const [existingContactForm, setExistingContactForm] = useState({
    contactId: "", role: "MOTPART" as string, notes: "",
  });

  const [newContactForm, setNewContactForm] = useState({
    name: "", contactType: "PERSON" as string, personalNumber: "", orgNumber: "",
    email: "", phone: "", role: "MOTPART" as string, notes: "",
  });

  const [timeForm, setTimeForm] = useState({
    date: new Date().toISOString().split("T")[0], minutes: 30, description: "", billable: true,
  });

  const [expenseForm, setExpenseForm] = useState({
    date: new Date().toISOString().split("T")[0], amount: 0, description: "", billable: true,
  });


  if (matter.isLoading) return <p className="text-gray-500">Laddar...</p>;
  if (matter.error) return <p className="text-red-600">Fel: {matter.error.message}</p>;
  if (!matter.data) return null;

  const m = matter.data;

  // Group contacts by role
  const klient = m.contacts.filter((c) => c.role === "KLIENT");
  const otherContacts = m.contacts.filter((c) => c.role !== "KLIENT");

  return (
    <div>
      <div className="mb-6">
        <Link href="/matters" className="text-sm text-blue-600 hover:underline">&larr; Tillbaka till ärenden</Link>
      </div>

      {/* Header */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 sm:p-6 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
          <div>
            <p className="text-sm font-mono text-gray-500">{m.matterNumber}</p>
            <h1 className="text-2xl font-bold text-gray-900 mt-1">{m.title}</h1>
            <p className="text-sm text-gray-500 mt-1">
              {klient.length > 0 && (
                <>Klient: <Link href={`/contacts/${klient[0].contact.id}`} className="text-blue-600 hover:underline">{klient[0].contact.name}</Link></>
              )}
              {m.matterType && <>{klient.length > 0 ? " · " : ""}{m.matterType}</>}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${
              m.status === "ACTIVE" ? "bg-green-50 text-green-700" : m.status === "CLOSED" ? "bg-gray-100 text-gray-600" : "bg-yellow-50 text-yellow-700"
            }`}>
              {m.status === "ACTIVE" ? "Aktivt" : m.status === "CLOSED" ? "Stängt" : "Arkiverat"}
            </span>
            <button
              onClick={() => { setShowGenerateModal(true); setGenerateError(null); }}
              className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium bg-white border border-gray-300 rounded-full hover:bg-gray-50 text-gray-700"
            >
              <FileDown size={13} /> Generera dokument
            </button>
          </div>
        </div>
        {m.description && <p className="text-sm text-gray-700 mt-3">{m.description}</p>}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* AI-extraherade tidpunkter */}
        <EventsPanel matterId={id} />

        {/* AI-föreslagna kontakter */}
        <SuggestionsPanel matterId={id} />

        {/* Contacts */}
        <div className="bg-white rounded-lg border border-gray-200">
          <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
            <h2 className="font-semibold text-gray-900">Kontakter ({m.contacts.length})</h2>
            <button onClick={() => setShowContactForm(!showContactForm)} className="text-sm text-blue-600 hover:underline">
              {showContactForm ? "Avbryt" : "+ Lägg till"}
            </button>
          </div>

          {showContactForm && (
            <div className="p-4 border-b border-gray-200 space-y-3">
              <div className="flex gap-2 mb-3">
                <button onClick={() => setAddMode("new")}
                  className={`px-3 py-1 text-xs rounded-full ${addMode === "new" ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-600"}`}>
                  Ny kontakt
                </button>
                <button onClick={() => setAddMode("existing")}
                  className={`px-3 py-1 text-xs rounded-full ${addMode === "existing" ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-600"}`}>
                  Befintlig kontakt
                </button>
              </div>

              {addMode === "existing" ? (
                <form onSubmit={(e) => { e.preventDefault(); addContact.mutate({ matterId: id, ...existingContactForm } as Parameters<typeof addContact.mutate>[0]); }}>
                  <div className="grid grid-cols-2 gap-3">
                    <select required value={existingContactForm.contactId}
                      onChange={(e) => setExistingContactForm({ ...existingContactForm, contactId: e.target.value })}
                      className="rounded border border-gray-300 px-3 py-1.5 text-sm">
                      <option value="">Välj kontakt...</option>
                      {existingContacts.data?.contacts.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                    <select value={existingContactForm.role}
                      onChange={(e) => setExistingContactForm({ ...existingContactForm, role: e.target.value })}
                      className="rounded border border-gray-300 px-3 py-1.5 text-sm">
                      {matterRoles.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                    </select>
                  </div>
                  <button type="submit" disabled={addContact.isPending}
                    className="mt-3 px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50">
                    {addContact.isPending ? "Lägger till..." : "Lägg till"}
                  </button>
                </form>
              ) : (
                <form onSubmit={(e) => { e.preventDefault(); addNewContact.mutate({ matterId: id, ...newContactForm } as Parameters<typeof addNewContact.mutate>[0]); }}>
                  <div className="grid grid-cols-2 gap-3">
                    <input type="text" required placeholder="Namn *" value={newContactForm.name}
                      onChange={(e) => setNewContactForm({ ...newContactForm, name: e.target.value })}
                      className="rounded border border-gray-300 px-3 py-1.5 text-sm" />
                    <select value={newContactForm.role}
                      onChange={(e) => setNewContactForm({ ...newContactForm, role: e.target.value })}
                      className="rounded border border-gray-300 px-3 py-1.5 text-sm">
                      {matterRoles.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                    </select>
                    <select value={newContactForm.contactType}
                      onChange={(e) => setNewContactForm({ ...newContactForm, contactType: e.target.value })}
                      className="rounded border border-gray-300 px-3 py-1.5 text-sm">
                      {contactTypes.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                    <input type="text" placeholder={newContactForm.contactType === "PERSON" ? "Personnummer" : "Orgnummer"}
                      value={newContactForm.contactType === "PERSON" ? newContactForm.personalNumber : newContactForm.orgNumber}
                      onChange={(e) => newContactForm.contactType === "PERSON"
                        ? setNewContactForm({ ...newContactForm, personalNumber: e.target.value })
                        : setNewContactForm({ ...newContactForm, orgNumber: e.target.value })}
                      className="rounded border border-gray-300 px-3 py-1.5 text-sm" />
                  </div>
                  <button type="submit" disabled={addNewContact.isPending}
                    className="mt-3 px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50">
                    {addNewContact.isPending ? "Lägger till..." : "Skapa & lägg till"}
                  </button>
                </form>
              )}
            </div>
          )}

          <div className="divide-y divide-gray-100">
            {m.contacts.map((mc) => (
              <div key={mc.id} className="px-6 py-3 flex items-center justify-between">
                <div>
                  <Link href={`/contacts/${mc.contact.id}`} className="text-sm font-medium text-blue-600 hover:underline">
                    {mc.contact.name}
                  </Link>
                  <p className="text-xs text-gray-500">
                    <span className="font-medium">{labelForMatterRole(mc.role)}</span>
                    {mc.contact.personalNumber && ` · ${mc.contact.personalNumber}`}
                    {mc.contact.orgNumber && ` · ${mc.contact.orgNumber}`}
                  </p>
                </div>
                <button onClick={() => removeContact.mutate({ matterContactId: mc.id })}
                  className="text-xs text-red-500 hover:underline">Ta bort</button>
              </div>
            ))}
            {m.contacts.length === 0 && (
              <p className="px-6 py-4 text-sm text-gray-500">Inga kontakter kopplade</p>
            )}
          </div>
        </div>

        {/* Documents */}
        <DocumentBrowser matterId={id} />

        {/* Time entries */}
        <div className="bg-white rounded-lg border border-gray-200 lg:col-span-2">
          <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
            <h2 className="font-semibold text-gray-900">
              Tidregistrering
              {timeEntries.data && (
                <span className="ml-2 text-sm font-normal text-gray-500">(totalt {formatMinutes(timeEntries.data.totalMinutes)})</span>
              )}
            </h2>
            <button onClick={() => setShowTimeForm(!showTimeForm)} className="text-sm text-blue-600 hover:underline">
              {showTimeForm ? "Avbryt" : "+ Registrera tid"}
            </button>
          </div>

          {showTimeForm && (
            <form onSubmit={(e) => { e.preventDefault(); createTimeEntry.mutate({ ...timeForm, matterId: id }); }}
              className="p-4 border-b border-gray-200">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <input type="date" required value={timeForm.date}
                  onChange={(e) => setTimeForm({ ...timeForm, date: e.target.value })}
                  className="rounded border border-gray-300 px-3 py-1.5 text-sm" />
                <div className="flex items-center gap-2">
                  <input type="number" required min={1} value={timeForm.minutes}
                    onChange={(e) => setTimeForm({ ...timeForm, minutes: parseInt(e.target.value) || 0 })}
                    className="w-20 rounded border border-gray-300 px-3 py-1.5 text-sm" />
                  <span className="text-sm text-gray-500">min</span>
                </div>
                <input type="text" required placeholder="Beskrivning *" value={timeForm.description}
                  onChange={(e) => setTimeForm({ ...timeForm, description: e.target.value })}
                  className="md:col-span-2 rounded border border-gray-300 px-3 py-1.5 text-sm" />
              </div>
              <div className="mt-3 flex items-center gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={timeForm.billable}
                    onChange={(e) => setTimeForm({ ...timeForm, billable: e.target.checked })} />
                  Debiterbar
                </label>
                <button type="submit" disabled={createTimeEntry.isPending}
                  className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50">
                  {createTimeEntry.isPending ? "Sparar..." : "Spara"}
                </button>
              </div>
            </form>
          )}

          <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead>
              <tr className="bg-gray-50">
                <th className="px-6 py-2 text-left text-xs font-medium text-gray-500 uppercase">Datum</th>
                <th className="px-6 py-2 text-left text-xs font-medium text-gray-500 uppercase">Advokat</th>
                <th className="px-6 py-2 text-left text-xs font-medium text-gray-500 uppercase">Tid</th>
                <th className="px-6 py-2 text-left text-xs font-medium text-gray-500 uppercase">Beskrivning</th>
                <th className="px-6 py-2 text-left text-xs font-medium text-gray-500 uppercase">Deb.</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {timeEntries.data?.entries.map((entry) => (
                <tr key={entry.id}>
                  <td className="px-6 py-2 text-sm text-gray-500">{new Date(entry.date).toLocaleDateString("sv-SE")}</td>
                  <td className="px-6 py-2 text-sm text-gray-900">{entry.user.name}</td>
                  <td className="px-6 py-2 text-sm text-gray-900">{formatMinutes(entry.minutes)}</td>
                  <td className="px-6 py-2 text-sm text-gray-700">{entry.description}</td>
                  <td className="px-6 py-2 text-sm">{entry.billable ? "Ja" : "Nej"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>

        {/* Expenses */}
        <div className="bg-white rounded-lg border border-gray-200 lg:col-span-2">
          <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
            <h2 className="font-semibold text-gray-900">
              Utlägg
              {expenses.data && expenses.data.totalAmount > 0 && (
                <span className="ml-2 text-sm font-normal text-gray-500">(totalt {formatCurrency(expenses.data.totalAmount)})</span>
              )}
            </h2>
            <button onClick={() => setShowExpenseForm(!showExpenseForm)} className="text-sm text-blue-600 hover:underline">
              {showExpenseForm ? "Avbryt" : "+ Nytt utlägg"}
            </button>
          </div>

          {showExpenseForm && (
            <form onSubmit={(e) => {
              e.preventDefault();
              createExpense.mutate({
                matterId: id,
                date: expenseForm.date,
                amount: Math.round(expenseForm.amount * 100), // Convert SEK to öre
                description: expenseForm.description,
                billable: expenseForm.billable,
              });
            }} className="p-4 border-b border-gray-200">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <input type="date" required value={expenseForm.date}
                  onChange={(e) => setExpenseForm({ ...expenseForm, date: e.target.value })}
                  className="rounded border border-gray-300 px-3 py-1.5 text-sm" />
                <div className="flex items-center gap-2">
                  <input type="number" required min={0} step="0.01" value={expenseForm.amount || ""}
                    onChange={(e) => setExpenseForm({ ...expenseForm, amount: parseFloat(e.target.value) || 0 })}
                    placeholder="0,00"
                    className="w-28 rounded border border-gray-300 px-3 py-1.5 text-sm" />
                  <span className="text-sm text-gray-500">SEK</span>
                </div>
                <input type="text" required placeholder="Beskrivning *" value={expenseForm.description}
                  onChange={(e) => setExpenseForm({ ...expenseForm, description: e.target.value })}
                  className="md:col-span-2 rounded border border-gray-300 px-3 py-1.5 text-sm" />
              </div>
              <div className="mt-3 flex items-center gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={expenseForm.billable}
                    onChange={(e) => setExpenseForm({ ...expenseForm, billable: e.target.checked })} />
                  Debiterbar
                </label>
                <button type="submit" disabled={createExpense.isPending}
                  className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50">
                  {createExpense.isPending ? "Sparar..." : "Spara"}
                </button>
              </div>
            </form>
          )}

          <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead>
              <tr className="bg-gray-50">
                <th className="px-6 py-2 text-left text-xs font-medium text-gray-500 uppercase">Datum</th>
                <th className="px-6 py-2 text-left text-xs font-medium text-gray-500 uppercase">Registrerad av</th>
                <th className="px-6 py-2 text-left text-xs font-medium text-gray-500 uppercase">Belopp</th>
                <th className="px-6 py-2 text-left text-xs font-medium text-gray-500 uppercase">Beskrivning</th>
                <th className="px-6 py-2 text-left text-xs font-medium text-gray-500 uppercase">Deb.</th>
                <th className="px-6 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {expenses.data?.expenses.map((expense) => (
                <tr key={expense.id}>
                  <td className="px-6 py-2 text-sm text-gray-500 whitespace-nowrap">{new Date(expense.date).toLocaleDateString("sv-SE")}</td>
                  <td className="px-6 py-2 text-sm text-gray-900 whitespace-nowrap">{expense.user.name}</td>
                  <td className="px-6 py-2 text-sm font-mono text-gray-900 whitespace-nowrap">{formatCurrency(expense.amount)}</td>
                  <td className="px-6 py-2 text-sm text-gray-700">{expense.description}</td>
                  <td className="px-6 py-2 text-sm">{expense.billable ? "Ja" : "Nej"}</td>
                  <td className="px-6 py-2 text-right">
                    <button onClick={() => deleteExpense.mutate({ id: expense.id })}
                      className="text-xs text-red-500 hover:underline">Ta bort</button>
                  </td>
                </tr>
              ))}
              {expenses.data?.expenses.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-6 py-4 text-sm text-gray-500">Inga utlägg registrerade</td>
                </tr>
              )}
            </tbody>
          </table>
          </div>
        </div>

        <InvoicesSection matterId={id} />
      </div>

      {/* Generate document modal */}
      {showGenerateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-md w-full mx-4">
            <h3 className="font-semibold text-gray-900 mb-4">Generera dokument</h3>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Mall</label>
                {templates.isLoading ? (
                  <p className="text-sm text-gray-400">Laddar mallar…</p>
                ) : templates.data?.length === 0 ? (
                  <p className="text-sm text-gray-500">
                    Inga mallar skapade.{" "}
                    <Link href="/templates/new" className="text-blue-600 hover:underline">
                      Skapa en mall
                    </Link>
                  </p>
                ) : (
                  <select
                    value={generateTemplateId}
                    onChange={(e) => setGenerateTemplateId(e.target.value)}
                    className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="">Välj mall…</option>
                    {templates.data?.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.category ? `${t.category} – ` : ""}{t.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Mottagare ({generateRecipientIds.length})
                  <span className="ml-1 font-normal text-gray-500">
                    — lämna tomt för ett generellt dokument, eller välj flera för att generera ett dokument per mottagare
                  </span>
                </label>
                {m.contacts.length === 0 ? (
                  <p className="text-xs text-gray-400">Inga kontakter kopplade till ärendet.</p>
                ) : (
                  <div className="max-h-40 overflow-y-auto border border-gray-200 rounded divide-y divide-gray-100">
                    {m.contacts.map((mc) => {
                      const checked = generateRecipientIds.includes(mc.contact.id);
                      return (
                        <label
                          key={mc.id}
                          className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-50 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleRecipient(mc.contact.id)}
                            className="accent-blue-600"
                          />
                          <span className="flex-1 truncate">{mc.contact.name}</span>
                          <span className="text-[10px] rounded-full bg-gray-100 text-gray-600 px-2 py-0.5">
                            {labelForMatterRole(mc.role)}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-2">Format</label>
                <div className="flex gap-4">
                  {(["pdf", "docx"] as const).map((fmt) => (
                    <label key={fmt} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="format"
                        value={fmt}
                        checked={generateFormat === fmt}
                        onChange={() => setGenerateFormat(fmt)}
                        className="accent-blue-600"
                      />
                      <span className="text-sm">{fmt === "pdf" ? "PDF" : "Word (.docx)"}</span>
                    </label>
                  ))}
                </div>
              </div>

              {generateError && (
                <p className="text-sm text-red-600">{generateError}</p>
              )}
            </div>

            <div className="flex gap-2 justify-end mt-6">
              <button
                onClick={() => setShowGenerateModal(false)}
                disabled={generating}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50"
              >
                Avbryt
              </button>
              <button
                onClick={handleGenerate}
                disabled={!generateTemplateId || generating}
                className="flex items-center gap-1.5 px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <FileDown size={14} />
                {generating ? "Genererar…" : "Generera"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
