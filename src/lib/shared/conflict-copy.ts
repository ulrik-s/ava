/**
 * Namnger en keep-both-kopia (ADR 0033 §4): när en 409-konflikt sker sparas
 * användarens version som ett SYSKON-dokument bredvid originalet — inget skrivs
 * över. Namnet ska göra det självklart för en icke-teknisk jurist vilket som är
 * deras egen ändring: `Avtal (din ändring 2026-06-22 14:32).docx`.
 *
 * Ren funktion (ingen IO/klocka) → `label` (lokal tidsstämpel) matas in av
 * anroparen, testbar deterministiskt.
 */
export function conflictCopyName(fileName: string, label: string): string {
  const suffix = ` (din ändring ${label})`;
  const dot = fileName.lastIndexOf(".");
  // dot <= 0 → ingen ändelse (eller en dotfile som ".gitignore"): lägg suffixet sist.
  if (dot <= 0) return `${fileName}${suffix}`;
  return `${fileName.slice(0, dot)}${suffix}${fileName.slice(dot)}`;
}
