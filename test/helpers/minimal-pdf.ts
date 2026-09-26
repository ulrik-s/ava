/**
 * Minimal giltig PDF (Helvetica, korrekt xref) med EN textrad per sida. Delad av
 * extraktionstesterna (#1156, #1215) — sidgränserna är poängen i #1215.
 * Texten måste vara ASCII utan parenteser/backslash (PDF-strängliteral).
 */
export function minimalPdf(pages: readonly string[]): string {
  const pageIds = pages.map((_, i) => 3 + i * 2);
  const fontId = 3 + pages.length * 2;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`,
    ...pages.flatMap((text, i) => {
      const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
      return [
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${4 + i * 2} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >>`,
        `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
      ];
    }),
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = objs.map((body, i) => {
    const at = pdf.length;
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return at;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return pdf;
}
