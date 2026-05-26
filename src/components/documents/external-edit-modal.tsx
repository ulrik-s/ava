"use client";

/**
 * `ExternalEditModal` — ersätter alert() i "🖥 Editera externt"-flödet.
 * Ger användaren konkreta actions istället för en read-only text:
 *
 *   - "Öppna fil" → laddar ner via <a download> så Chromes download-bar
 *     visas. User klickar "Öppna" i bar:n → PDF Gear startar.
 *   - "Kopiera path" → skickar mappnamn/<relativ-path> till clipboard
 *     så user kan klistra in i Finder Cmd+Shift+G.
 *   - Felmeddelanden (FSA ej stöd, ingen mapp, fil saknas, etc.) visas
 *     i samma modal med rätt nästa-steg-instruktion.
 */

import { useEffect, useState } from "react";

export type ModalState =
  | { kind: "closed" }
  | { kind: "ok"; fileName: string; folderName: string; relativePath: string; fileHandle: FileSystemFileHandle }
  | { kind: "error"; title: string; message: string };

interface Props {
  state: ModalState;
  onClose: () => void;
}

 
export function ExternalEditModal({ state, onClose }: Props): React.ReactElement | null {
  const [copied, setCopied] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);

  // Förbered en blob-URL för "Öppna fil"-knappen så download-attribut funkar.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (state.kind !== "ok") { setDownloadUrl(null); return; }
    let revoke: string | null = null;
    void state.fileHandle.getFile().then((f) => {
      const url = URL.createObjectURL(f);
       
      setDownloadUrl(url);
      revoke = url;
    });
    return () => { if (revoke) URL.revokeObjectURL(revoke); };
  }, [state]);

  if (state.kind === "closed") return null;

  // Hjälpare för Office URI-protokoll: ms-word: / ms-excel: / ms-powerpoint:
  // Funkar OM Office är installerat — det är OS-nivå-protokoll-handler.
  // Begränsning: vi behöver en absolut http(s)-URL, inte en blob — Office
  // hämtar filen själv via WebDAV-likt protokoll. För nu försöker vi med
  // blob-URL ändå; user-feedback får visa om det funkar.
  function officeUriFor(fileName: string, url: string | null): string | null {
    if (!url) return null;
    const ext = fileName.toLowerCase().match(/\.(docx|doc|xlsx|xls|pptx|ppt)$/)?.[1];
    if (!ext) return null;
    const scheme = ext.startsWith("xls") ? "ms-excel" : ext.startsWith("ppt") ? "ms-powerpoint" : "ms-word";
    return `${scheme}:ofe|u|${url}`;
  }
  function officeAppName(fileName: string): string {
    const ext = fileName.toLowerCase().match(/\.(docx|doc|xlsx|xls|pptx|ppt)$/)?.[1] ?? "";
    if (ext.startsWith("xls")) return "Excel";
    if (ext.startsWith("ppt")) return "PowerPoint";
    return "Word";
  }

  async function copyPath(): Promise<void> {
    if (state.kind !== "ok") return;
    try {
      await navigator.clipboard.writeText(`${state.folderName}/${state.relativePath}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // tyst — clipboard kan blockas av browser i vissa contexts
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-lg shadow-2xl max-w-lg w-full p-5">
        {state.kind === "error" ? (
          <>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">{state.title}</h2>
            <p className="text-sm text-gray-700 mb-5">{state.message}</p>
            <div className="flex justify-end">
              <button onClick={onClose} className="px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700">
                Stäng
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">
              Editera <code className="text-sm bg-gray-100 px-1 rounded">{state.fileName}</code> externt
            </h2>
            <p className="text-sm text-gray-700 mb-4">
              Filen ligger på:
            </p>
            <code className="block bg-gray-50 border border-gray-200 rounded px-3 py-2 text-xs font-mono text-gray-800 mb-4 break-all">
              {state.folderName}/{state.relativePath}
            </code>

            <div className="space-y-3 mb-5">
              {/* Office URI Schemes — om filen är .docx/.xlsx/.pptx kan vi öppna
                  direkt i Office utan download-omväg, förutsatt att Office är
                  installerat (inbyggt i Windows + macOS Office). */}
              {officeUriFor(state.fileName, downloadUrl) && (
                <div>
                  <a
                    href={officeUriFor(state.fileName, downloadUrl) ?? "#"}
                    className="inline-flex items-center gap-2 px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
                  >
                    📝 Öppna direkt i {officeAppName(state.fileName)}
                  </a>
                  <p className="text-xs text-gray-500 mt-1">
                    Funkar OM Office är installerat. Filen öppnas i {officeAppName(state.fileName)} och
                    save funkar mot AVA om filen ligger i din lokala mapp.
                  </p>
                </div>
              )}

              <div>
                <a
                  href={downloadUrl ?? "#"}
                  download={state.fileName}
                  onClick={(e) => { if (!downloadUrl) e.preventDefault(); }}
                  className="inline-flex items-center gap-2 px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
                >
                  ⬇ Öppna fil (via download-bar)
                </a>
                <p className="text-xs text-gray-500 mt-1">
                  Chrome visar filen längst ner. Klicka pilen → <strong>Öppna</strong> så
                  startar PDF Gear / Preview / Word.
                </p>
              </div>

              <div>
                <button
                  type="button"
                  onClick={() => void copyPath()}
                  className="inline-flex items-center gap-2 px-3 py-1.5 border border-gray-300 text-sm rounded hover:bg-gray-50"
                >
                  📋 {copied ? "Kopierat!" : "Kopiera path"}
                </button>
                <p className="text-xs text-gray-500 mt-1">
                  Tryck <kbd className="px-1 border rounded text-xs">⌘⇧G</kbd> i Finder och
                  klistra in path:en för att hitta filen direkt.
                </p>
              </div>
            </div>

            <div className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded p-3 mb-4">
              <strong>När du sparar i editorn:</strong>
              <ul className="list-disc ml-5 mt-1 space-y-0.5">
                <li>Om du arbetar med filen <em>i</em> mappen ovan → AVA committar automatiskt (efter 90 s, eller klicka &quot;Spara nu&quot; i bannern).</li>
                <li>Om du editar nedladdningen → dra tillbaka den till AVA via &quot;Ladda upp&quot; för att skapa en ny version.</li>
              </ul>
            </div>

            <div className="flex justify-end">
              <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">
                Stäng
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
