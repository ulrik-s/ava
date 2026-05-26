"use client";

/**
 * `EditorExtensionsSection` — listar tredje-parts-extensions som öppnar
 * filer från AVA i fullfjädrade editorer.
 *
 * Vi bygger inget eget helper-program — istället pekar vi på etablerade
 * lösningar (Office URI-protokoll + Chrome-extensions).
 */

import { FileText } from "lucide-react";

interface ExtRow {
  name: string;
  desc: string;
  url: string;
  platforms: string;
}

const PDF_EXTENSIONS: ExtRow[] = [
  {
    name: "PDF Gear",
    desc: "Läs, editera och kommentera PDF i en flik. Spara → ladda ner → re-upload i AVA.",
    url: "https://chromewebstore.google.com/detail/pdfgear-pdf-read-edit-con/loeihpckhhjnallmllkbhmlccgoglgei",
    platforms: "Chrome/Edge",
  },
  {
    name: "Kami",
    desc: "Annotering, signering, formulär. Bra UX för advokater som markerar i klient-dokument.",
    url: "https://chromewebstore.google.com/detail/kami-for-google-chrome/ecnphlgnajanjnkcmbpancdjoidceilk",
    platforms: "Chrome/Edge",
  },
  {
    name: "Adobe Acrobat-extension",
    desc: "Öppna PDF i Acrobat (kräver Acrobat installerat på datorn).",
    url: "https://chromewebstore.google.com/detail/adobe-acrobat-pdf-edit-co/efaidnbmnnnibpcajpcglclefindmkaj",
    platforms: "Chrome/Edge",
  },
];

export function EditorExtensionsSection(): React.ReactElement {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-5 mb-5">
      <div className="flex items-center gap-2 mb-3">
        <FileText size={16} className="text-gray-500" />
        <h2 className="font-semibold text-gray-900">Editera dokument med dina favoritprogram</h2>
      </div>
      <p className="text-xs text-gray-500 mb-4">
        AVA bygger inte egen editor — vi pekar på etablerade verktyg.
        Två vägar beroende på filtyp:
      </p>

      <div className="space-y-5">
        <div>
          <h3 className="text-sm font-semibold text-gray-800 mb-2">Office-filer (Word, Excel, PowerPoint)</h3>
          <p className="text-xs text-gray-600">
            Om Microsoft Office är installerat: klicka <strong>📝 Öppna direkt i Word/Excel</strong> i
            dokumentmodalen så öppnas filen direkt via Microsofts inbyggda{" "}
            <a href="https://learn.microsoft.com/en-us/office/client-developer/office-uri-schemes"
              target="_blank" rel="noopener noreferrer"
              className="text-blue-600 hover:underline">URI Schemes</a>.
            Funkar både på Mac och Windows. Inget tillägg att installera.
          </p>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-gray-800 mb-2">PDF-editering — webb-extensions</h3>
          <p className="text-xs text-gray-600 mb-3">
            Klicka <strong>🖥 Editera externt</strong> på en doc-rad i AVA → välj &quot;Öppna fil&quot; i
            modalen → filen öppnas i extensionen. Save → ladda ner ny version → upload i AVA.
          </p>
          <ul className="space-y-2">
            {PDF_EXTENSIONS.map((r) => (
              <li key={r.url} className="text-xs">
                <a href={r.url} target="_blank" rel="noopener noreferrer"
                  className="text-blue-600 hover:underline font-medium">{r.name}</a>
                <span className="text-gray-400"> · {r.platforms} · gratis</span>
                <p className="text-gray-600">{r.desc}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
