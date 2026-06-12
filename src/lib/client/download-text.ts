/**
 * Trigga en browser-nedladdning av en textfil (Blob + `<a download>`).
 *
 * Samma mönster som rapport-exporten (xlsx) men för text vi genererat i
 * klienten (t.ex. SIE-fil, #244). Ingen server inblandad → fungerar i alla
 * tiers.
 */
export function downloadTextFile(
  filename: string,
  content: string,
  mime = "text/plain;charset=utf-8",
): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
