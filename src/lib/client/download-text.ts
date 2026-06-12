/**
 * Trigga en browser-nedladdning (Blob + `<a download>`).
 *
 * Samma mönster som rapport-exporten (xlsx) men för data vi genererat i
 * klienten (t.ex. SIE-fil, #244). Ingen server inblandad → fungerar i alla
 * tiers.
 */
function triggerDownload(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Ladda ner en textsträng (UTF-8 default). */
export function downloadTextFile(
  filename: string,
  content: string,
  mime = "text/plain;charset=utf-8",
): void {
  triggerDownload(filename, new Blob([content], { type: mime }));
}

/** Ladda ner råa bytes (t.ex. PC8/CP437-kodad SIE-fil, #247). */
export function downloadBytes(
  filename: string,
  bytes: Uint8Array<ArrayBuffer>,
  mime = "application/octet-stream",
): void {
  triggerDownload(filename, new Blob([bytes], { type: mime }));
}
