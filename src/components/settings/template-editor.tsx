"use client";

import { useState, useMemo } from "react";
import { ChevronDown, ChevronRight, Eye, Code } from "lucide-react";

const VARIABLE_REFERENCE = [
  {
    group: "Ärende",
    vars: [
      { key: "matter.matterNumber", desc: "Ärendenummer (t.ex. 2024-0001)" },
      { key: "matter.title", desc: "Ärendetitel" },
      { key: "matter.description", desc: "Beskrivning" },
      { key: "matter.status", desc: "Status (ACTIVE / CLOSED / ARCHIVED)" },
      { key: "matter.matterType", desc: "Ärendetyp" },
      { key: "matter.createdAt", desc: "Skapat datum (använd med {{formatDate}})" },
    ],
  },
  {
    group: "Organisation",
    vars: [
      { key: "organization.name", desc: "Byråns namn" },
      { key: "organization.address", desc: "Adress (huvudkontor)" },
      { key: "organization.phone", desc: "Telefon" },
      { key: "organization.email", desc: "E-post" },
      { key: "organization.orgNumber", desc: "Org.nummer" },
      { key: "organization.bankgiro", desc: "Bankgiro" },
      { key: "organization.mainOffice.name", desc: "Huvudkontorets namn" },
      { key: "organization.mainOffice.address", desc: "Huvudkontorets adress" },
      { key: "organization.offices", desc: "Alla kontor (loop)" },
      { key: "organization.offices[i].name", desc: "Kontorets namn" },
      { key: "organization.offices[i].address", desc: "Kontorets adress" },
      { key: "organization.offices[i].phone", desc: "Kontorets telefon" },
    ],
  },
  {
    group: "Kontakter",
    vars: [
      { key: "klient.name", desc: "Klientens namn" },
      { key: "klient.personalNumber", desc: "Personnummer" },
      { key: "klient.address", desc: "Adress" },
      { key: "klient.phone", desc: "Telefon" },
      { key: "klient.email", desc: "E-post" },
      { key: "motpart.name", desc: "Motpartens namn" },
      { key: "recipient.name", desc: "Aktuell mottagares namn (null om ej vald)" },
      { key: "recipient.address", desc: "Aktuell mottagares adress" },
      { key: "recipient.email", desc: "Aktuell mottagares e-post" },
      { key: "recipient.roleLabel", desc: "Roll (t.ex. Klient, Motpart)" },
      { key: "contacts", desc: "Alla kontakter (loop)" },
      { key: "contacts[i].name", desc: "Kontaktens namn" },
      { key: "contacts[i].roleLabel", desc: "Roll (t.ex. Klient)" },
    ],
  },
  {
    group: "Tid & Utlägg",
    vars: [
      { key: "timeEntries", desc: "Tidposter (loop)" },
      { key: "timeEntries[i].description", desc: "Beskrivning" },
      { key: "timeEntries[i].hours", desc: "Timmar (t.ex. 1,5 tim)" },
      { key: "timeEntries[i].date", desc: "Datum" },
      { key: "timeEntries[i].userName", desc: "Utförd av" },
      { key: "expenses", desc: "Utlägg (loop)" },
      { key: "expenses[i].description", desc: "Beskrivning" },
      { key: "expenses[i].amount", desc: "Belopp i öre" },
      { key: "totalTimeMinutes", desc: "Total tid (minuter)" },
      { key: "totalTimeAmount", desc: "Total tid (öre)" },
      { key: "totalExpenseAmount", desc: "Totala utlägg (öre)" },
    ],
  },
  {
    group: "Övrigt",
    vars: [
      { key: "today", desc: "Dagens datum (t.ex. 2026-04-16)" },
      { key: "generatedBy.name", desc: "Genererat av (namn)" },
      { key: "generatedBy.title", desc: "Titel" },
    ],
  },
  {
    group: "Hjälpfunktioner",
    vars: [
      { key: "{{formatDate date}}", desc: "Datum → 16 april 2026" },
      { key: "{{formatDateShort date}}", desc: "Datum → 2026-04-16" },
      { key: "{{formatAmount amountInOre}}", desc: "Öre → 1 250,00 kr" },
      { key: "{{formatHours minutes}}", desc: "Minuter → 1,5 tim" },
    ],
  },
];


interface Props {
  initialName?: string;
  initialDescription?: string;
  initialCategory?: string;
  initialContent?: string;
  onSave: (data: { name: string; description: string; category: string; content: string }) => void;
  onCancel: () => void;
  saving?: boolean;
}

// eslint-disable-next-line complexity -- TODO: refactor (currently fails complexity@8: Function 'TemplateEditor' has a complexity of 12. Maximum allowed is 8.)
export function TemplateEditor({
  initialName = "",
  initialDescription = "",
  initialCategory = "",
  initialContent = "",
  onSave,
  onCancel,
  saving = false,
}: Props) {
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [category, setCategory] = useState(initialCategory);
  const [content, setContent] = useState(initialContent);
  const [activeTab, setActiveTab] = useState<"editor" | "preview">("editor");
  const [refOpen, setRefOpen] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(["Ärende", "Kontakter"]));

  const previewHtml = useMemo(() => {
    if (!content) return "<p style='color:#999;padding:2rem'>Skriv en mall till vänster för att se förhandsgranskning.</p>";
    try {
      // Simple client-side preview using basic string interpolation (Handlebars runs server-side)
      // We just show the raw template with highlighted tags for the preview
      const highlighted = content
        .replace(/\{\{#each\s+(\w+)\}\}/g, '<span style="background:#fef3c7;color:#92400e;padding:1px 3px;border-radius:2px;font-family:monospace">{{#each $1}}</span>')
        .replace(/\{\{\/each\}\}/g, '<span style="background:#fef3c7;color:#92400e;padding:1px 3px;border-radius:2px;font-family:monospace">{{/each}}</span>')
        .replace(/\{\{#if\s+([^}]+)\}\}/g, '<span style="background:#dbeafe;color:#1e3a8a;padding:1px 3px;border-radius:2px;font-family:monospace">{{#if $1}}</span>')
        .replace(/\{\{\/if\}\}/g, '<span style="background:#dbeafe;color:#1e3a8a;padding:1px 3px;border-radius:2px;font-family:monospace">{{/if}}</span>')
        .replace(/\{\{([^#/][^}]*)\}\}/g, '<span style="background:#dcfce7;color:#166534;padding:1px 3px;border-radius:2px;font-family:monospace">{{$1}}</span>');
      return `<html><body style="font-family:serif;font-size:13px;line-height:1.6;padding:1.5rem;color:#111">${highlighted}</body></html>`;
    } catch {
      return "<p style='color:red'>Fel i mallen.</p>";
    }
  }, [content]);

  const toggleGroup = (group: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  };

  const handleSave = () => {
    if (!name.trim() || !content.trim()) return;
    onSave({ name: name.trim(), description: description.trim(), category: category.trim(), content });
  };

  const insertVariable = (key: string) => {
    const tag = key.startsWith("{{") ? key : `{{${key}}}`;
    setContent((c) => c + tag);
    setActiveTab("editor");
  };

  return (
    <div className="flex flex-col h-full gap-4">
      <MetadataFields
        name={name} setName={setName}
        category={category} setCategory={setCategory}
        description={description} setDescription={setDescription}
      />

      <div className="flex-1 flex flex-col min-h-0 border border-gray-200 rounded-lg overflow-hidden">
        <EditorTabs
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          refOpen={refOpen}
          toggleRef={() => setRefOpen((v) => !v)}
        />

        <div className="flex flex-1 min-h-0">
          {refOpen && (
            <VariableSidebar
              expandedGroups={expandedGroups}
              toggleGroup={toggleGroup}
              onInsert={insertVariable}
            />
          )}

          {activeTab === "editor" && (
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              spellCheck={false}
              placeholder={`<h1>{{matter.title}}</h1>\n<p>Klient: {{klient.name}}</p>\n\n{{#each timeEntries}}\n<p>{{formatDateShort date}} – {{description}} ({{hours}})</p>\n{{/each}}`}
              className="flex-1 p-4 font-mono text-sm resize-none focus:outline-none bg-[#1e1e2e] text-[#cdd6f4] leading-relaxed"
            />
          )}

          {activeTab === "preview" && (
            <iframe
              srcDoc={previewHtml}
              className="flex-1 bg-white"
              sandbox="allow-same-origin"
              title="Förhandsgranskning"
            />
          )}
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="px-4 py-2 text-sm border border-gray-300 rounded hover:bg-gray-50">
          Avbryt
        </button>
        <button
          onClick={handleSave}
          disabled={!name.trim() || !content.trim() || saving}
          className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? "Sparar…" : "Spara mall"}
        </button>
      </div>
    </div>
  );
}

function MetadataFields({
  name, setName, category, setCategory, description, setDescription,
}: {
  name: string; setName: (v: string) => void;
  category: string; setCategory: (v: string) => void;
  description: string; setDescription: (v: string) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-3">
      <div className="col-span-1">
        <label className="block text-xs font-medium text-gray-700 mb-1">Namn *</label>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)}
          placeholder="t.ex. Uppdragsavtal"
          className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500" />
      </div>
      <div className="col-span-1">
        <label className="block text-xs font-medium text-gray-700 mb-1">Kategori</label>
        <input type="text" value={category} onChange={(e) => setCategory(e.target.value)}
          placeholder="t.ex. Avtal"
          className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500" />
      </div>
      <div className="col-span-1">
        <label className="block text-xs font-medium text-gray-700 mb-1">Beskrivning</label>
        <input type="text" value={description} onChange={(e) => setDescription(e.target.value)}
          placeholder="Valfri beskrivning"
          className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500" />
      </div>
    </div>
  );
}

function EditorTabs({
  activeTab, setActiveTab, refOpen, toggleRef,
}: {
  activeTab: "editor" | "preview";
  setActiveTab: (t: "editor" | "preview") => void;
  refOpen: boolean;
  toggleRef: () => void;
}) {
  return (
    <div className="flex border-b border-gray-200 bg-gray-50">
      <button
        onClick={() => setActiveTab("editor")}
        className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
          activeTab === "editor"
            ? "border-blue-600 text-blue-700"
            : "border-transparent text-gray-500 hover:text-gray-700"
        }`}
      >
        <Code size={14} /> Redigera
      </button>
      <button
        onClick={() => setActiveTab("preview")}
        className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
          activeTab === "preview"
            ? "border-blue-600 text-blue-700"
            : "border-transparent text-gray-500 hover:text-gray-700"
        }`}
      >
        <Eye size={14} /> Förhandsgranskning
      </button>
      <div className="flex-1" />
      <button onClick={toggleRef} className="flex items-center gap-1 px-3 py-2 text-xs text-gray-500 hover:text-gray-700">
        {refOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        Variabler
      </button>
    </div>
  );
}

function VariableSidebar({
  expandedGroups, toggleGroup, onInsert,
}: {
  expandedGroups: Set<string>;
  toggleGroup: (g: string) => void;
  onInsert: (key: string) => void;
}) {
  return (
    <div className="w-64 border-r border-gray-200 overflow-y-auto bg-gray-50 text-xs">
      {VARIABLE_REFERENCE.map((section) => (
        <div key={section.group}>
          <button
            onClick={() => toggleGroup(section.group)}
            className="w-full flex items-center gap-1 px-3 py-1.5 font-semibold text-gray-700 hover:bg-gray-100"
          >
            {expandedGroups.has(section.group) ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            {section.group}
          </button>
          {expandedGroups.has(section.group) && (
            <div className="pb-1">
              {section.vars.map((v) => (
                <div
                  key={v.key}
                  className="px-4 py-1 group cursor-pointer hover:bg-blue-50"
                  onClick={() => onInsert(v.key)}
                  title="Klicka för att infoga"
                >
                  <code className="text-blue-700 group-hover:text-blue-900">
                    {v.key.startsWith("{{") ? v.key : `{{${v.key}}}`}
                  </code>
                  <div className="text-gray-500 text-[10px] leading-tight">{v.desc}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
