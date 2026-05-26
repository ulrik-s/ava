"use client";

/**
 * `EditorExtensionsSection` — listar tredje-parts-extensions och
 * URL-protokoll som låter användaren editera filer från AVA i sina
 * favoritprogram. Visas i /settings.
 *
 * Vi bygger inget eget helper-program — istället pekar vi på etablerade
 * lösningar:
 *   - Microsoft Office URI Schemes (gratis, inbyggt om Office installerat)
 *   - Webbaserade PDF-editorer som Chrome/Edge-extensions
 *   - WebDAV-mount-klienter (Cyberduck etc.)
 */

import { FileText, Sheet, Presentation } from "lucide-react";

interface ExtRow {
  name: string;
  desc: string;
  url: string;
  free: boolean;
  platforms: string;
}

const PDF_EXTENSIONS: ExtRow[] = [
  {
    name: "PDF Gear (Chrome-extension)",
    desc: "Läs, editera och kommentera PDF i en flik. Spara → ladda ner → re-upload i AVA.",
    url: "https://chromewebstore.google.com/detail/pdfgear-pdf-read-edit-con/loeihpckhhjnallmllkbhmlccgoglgei",
    free: true,
    platforms: "Chrome/Edge",
  },
  {
    name: "Kami",
    desc: "Annotering, signering, formulär. Bra UX för advokater som markerar i klient-dokument.",
    url: "https://chromewebstore.google.com/detail/kami-for-google-chrome/ecnphlgnajanjnkcmbpancdjoidceilk",
    free: true,
    platforms: "Chrome/Edge",
  },
  {
    name: "Adobe Acrobat-extension",
    desc: "Öppna PDF i Acrobat (kräver Acrobat installerat på datorn).",
    url: "https://chromewebstore.google.com/detail/adobe-acrobat-pdf-edit-co/efaidnbmnnnibpcajpcglclefindmkaj",
    free: true,
    platforms: "Chrome/Edge",
  },
];

const MOUNT_TOOLS: ExtRow[] = [
  {
    name: "Cyberduck",
    desc: "Mounta AVA-mappen som disk i Finder/Utforskaren. Dubbelklicka filen → öppnas i default-app. Open source.",
    url: "https://cyberduck.io",
    free: true,
    platforms: "Mac/Win",
  },
  {
    name: "Mountain Duck",
    desc: "Cyberducks PRO-version — djupare integration, offline-cache, smartare sync.",
    url: "https://mountainduck.io",
    free: false,
    platforms: "Mac/Win",
  },
  {
    name: "rclone mount",
    desc: "CLI-verktyg. Mounta WebDAV som disk. Kräver lite tekniskt grepp men gratis och kraftfullt.",
    url: "https://rclone.org",
    free: true,
    platforms: "Mac/Win/Linux",
  },
  {
    name: "RaiDrive",
    desc: "Mounta nätverkstjänster som disk i Utforskaren.",
    url: "https://raidrive.com",
    free: true,
    platforms: "Windows",
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
        AVA bygger inte egen editor — vi pekar på etablerade verktyg som du
        sannolikt redan har. Tre vägar beroende på filtyp:
      </p>

      <div className="space-y-5">
        <div>
          <h3 className="text-sm font-semibold text-gray-800 mb-2 flex items-center gap-1.5">
            <Sheet size={14} /> Office-filer (Word, Excel, PowerPoint)
          </h3>
          <p className="text-xs text-gray-600 mb-2">
            Om Microsoft Office är installerat: klicka <strong>📝 Öppna i Word/Excel</strong> på dokumentraden
            så öppnas filen direkt via Microsofts inbyggda
            {" "}
            <a href="https://learn.microsoft.com/en-us/office/client-developer/office-uri-schemes"
              target="_blank" rel="noopener noreferrer"
              className="text-blue-600 hover:underline">URI Schemes</a>.
            Save tillbaka direkt om filen ligger på din lokala AVA-mapp.
          </p>
          <p className="text-xs text-gray-600">
            Funkar både på Mac och Windows om Office är installerat. Inget tillägg att installera.
          </p>
        </div>

        <ExtList title="PDF-editering — webb-extensions" desc="Klicka 🖥 Editera externt i AVA → välj 'Öppna fil' i modalen → filen öppnas i extension. Save → ladda ner ny version → upload i AVA." rows={PDF_EXTENSIONS} />

        <div>
          <h3 className="text-sm font-semibold text-gray-800 mb-2 flex items-center gap-1.5">
            <Presentation size={14} /> Avancerat: mounta AVA som disk
          </h3>
          <p className="text-xs text-gray-600 mb-2">
            Vill du ha &quot;dubbelklick i Finder/Utforskaren&quot;-känslan som t.ex. KATS/iManage —
            mounta AVA:s lokala mapp via WebDAV. Då öppnas alla filer i deras
            default-app. Save sparas automatiskt tillbaka.
          </p>
          <ExtList title="" desc="" rows={MOUNT_TOOLS} />
        </div>
      </div>
    </div>
  );
}

function ExtList({ title, desc, rows }: { title: string; desc: string; rows: ExtRow[] }): React.ReactElement {
  return (
    <div>
      {title && <h3 className="text-sm font-semibold text-gray-800 mb-2">{title}</h3>}
      {desc && <p className="text-xs text-gray-600 mb-2">{desc}</p>}
      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.url} className="text-xs">
            <a href={r.url} target="_blank" rel="noopener noreferrer"
              className="text-blue-600 hover:underline font-medium">{r.name}</a>
            <span className="text-gray-400"> · {r.platforms} · {r.free ? "gratis" : "kommersiell"}</span>
            <p className="text-gray-600">{r.desc}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
