import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { requireSession, parseJsonBody, withApiErrors } from "@/server/api-auth";
import { buildTemplateContext, renderTemplate, type TemplateContext } from "@/lib/template-context";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import puppeteer from "puppeteer";
// @ts-expect-error html-to-docx has no type declarations
import HTMLtoDOCX from "html-to-docx";
import { analyzeDocument } from "@/server/services/document-analysis";
import {
  resolveRecipients,
  buildGeneratedFileName,
  RecipientNotLinkedError,
  type ResolvedRecipient,
} from "@/lib/template-recipients";

const GenerateBody = z.object({
  templateId: z.string().min(1),
  matterId: z.string().min(1),
  format: z.enum(["pdf", "docx"]),
  recipientContactIds: z.array(z.string().min(1)).optional(),
});

/**
 * POST /api/templates/generate
 *
 * Genererar ett eller flera dokument från en mall och ärendedata.
 *
 * Body:
 *  - templateId: string
 *  - matterId:   string
 *  - format:     "pdf" | "docx"
 *  - recipientContactIds?: string[]
 *      Om angivet → ett dokument per mottagare, med `{{recipient}}`-variabeln
 *      satt till respektive kontakt. Annars → ett dokument utan recipient.
 *
 * Response: { documents: Array<{ documentId, fileName, recipientContactId? }> }
 */
export const POST = withApiErrors(async (req: NextRequest) => {
  const { userId, orgId: organizationId } = await requireSession();
  const { templateId, matterId, format, recipientContactIds } = await parseJsonBody(req, GenerateBody);

  // Load template (verify org ownership)
  const template = await prisma.documentTemplate.findUnique({ where: { id: templateId } });
  if (!template || template.organizationId !== organizationId) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  // Verify matter ownership
  const matter = await prisma.matter.findUnique({
    where: { id: matterId },
    select: { organizationId: true, matterNumber: true, title: true },
  });
  if (!matter || matter.organizationId !== organizationId) {
    return NextResponse.json({ error: "Matter not found" }, { status: 404 });
  }

  // Build base context once (expensive: touches org, contacts, time, expenses, logo)
  const baseContext = await buildTemplateContext(matterId, userId, prisma);

  // Resolve recipient list. Empty array / omitted → single render without recipient.
  const recipientIds = Array.isArray(recipientContactIds) ? recipientContactIds : [];
  let recipientContacts: ResolvedRecipient[] = [];

  if (recipientIds.length > 0) {
    const links = await prisma.matterContact.findMany({
      where: { matterId, contactId: { in: recipientIds } },
      include: { contact: true },
    });

    try {
      recipientContacts = resolveRecipients(recipientIds, links, matterId);
    } catch (e) {
      if (e instanceof RecipientNotLinkedError) {
        return NextResponse.json({ error: e.message }, { status: 400 });
      }
      throw e;
    }
  }

  // ─── Render helpers (browser stays open across loop for PDF) ──
  const esc = (s: string | null | undefined) =>
    (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const org = baseContext.organization;
  const logoBase64 = org.logoBase64;

  const footerPartsPdf = [
    `<b>${esc(org.name)}</b>`,
    esc(org.address),
    esc(org.phone),
    esc(org.email),
    org.orgNumber ? `Org.nr ${esc(org.orgNumber)}` : "",
  ].filter(Boolean);

  const headerTemplate = logoBase64
    ? `<div style="width:100%;padding:6pt 75pt 4pt 75pt;border-bottom:0.5pt solid #d0d0d0;display:flex;align-items:center">
         <img src="${logoBase64}" style="height:40pt;max-width:160pt;object-fit:contain">
       </div>`
    : `<div></div>`;

  const footerTemplate = `
    <div style="width:100%;font-size:7.5pt;color:#555;padding:4pt 75pt;border-top:0.5pt solid #e0e0e0">
      <table style="width:100%;border-collapse:collapse">
        <tr>
          <td style="padding:0">${footerPartsPdf.join("&nbsp;&nbsp;·&nbsp;&nbsp;")}</td>
          <td style="text-align:right;padding:0;color:#aaa">
            Sida <span class="pageNumber"></span> av <span class="totalPages"></span>
          </td>
        </tr>
      </table>
    </div>`;

  const orgFields = [
    org.name,
    org.address,
    org.phone,
    org.email,
    org.orgNumber ? `Org.nr ${org.orgNumber}` : null,
  ].filter(Boolean);

  const docxHeaderHtml = logoBase64
    ? `<p><img src="${logoBase64}" style="height:50px;max-width:200px;object-fit:contain"></p>`
    : `<p></p>`;

  const docxFooterHtml = `
    <table style="width:100%;border-top:1px solid #ccc;font-size:9pt;color:#444">
      <tr>
        ${orgFields.map((f) => `<td style="padding:4px 8px 0 0">${f}</td>`).join("")}
      </tr>
    </table>`;

  // Decide loop targets. `null` here means "no recipient-specific render".
  const targets: Array<{ contactId: string | null; data: TemplateContext["contacts"][number] | null }> =
    recipientContacts.length > 0
      ? recipientContacts.map((r) => ({ contactId: r.contactId, data: r.data }))
      : [{ contactId: null, data: null }];

  // Share a single Puppeteer instance across the loop if we're rendering PDFs.
  const browser =
    format === "pdf"
      ? await puppeteer.launch({
          headless: true,
          args: ["--no-sandbox", "--disable-setuid-sandbox"],
        })
      : null;

  const results: Array<{ documentId: string; fileName: string; recipientContactId: string | null }> = [];

  try {
    for (const target of targets) {
      const ctx: TemplateContext = {
        ...baseContext,
        recipient: target.data,
        recipients: recipientContacts.map((r) => r.data),
      };
      const html = renderTemplate(template.content, ctx);

      let fileBuffer: Buffer;
      let mimeType: string;
      let extension: string;

      if (format === "pdf" && browser) {
        const page = await browser.newPage();
        try {
          await page.setContent(html, { waitUntil: "networkidle0" });
          const pdf = await page.pdf({
            format: "A4",
            printBackground: true,
            displayHeaderFooter: true,
            headerTemplate,
            footerTemplate,
            margin: { top: "3.2cm", right: "2.5cm", bottom: "2.8cm", left: "3cm" },
          });
          fileBuffer = Buffer.from(pdf);
        } finally {
          await page.close();
        }
        mimeType = "application/pdf";
        extension = "pdf";
      } else {
        const docxBuffer = await HTMLtoDOCX(html, docxHeaderHtml, {
          table: { row: { cantSplit: true } },
          header: true,
          footer: true,
          footerType: "first",
          pageNumber: false,
        }, docxFooterHtml);
        fileBuffer = Buffer.isBuffer(docxBuffer) ? docxBuffer : Buffer.from(docxBuffer);
        mimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
        extension = "docx";
      }

      const fileName = buildGeneratedFileName(
        matter.matterNumber,
        template.name,
        extension as "pdf" | "docx",
        target.data,
      );

      // Save to storage
      const storagePath = process.env.DOCUMENT_STORAGE_PATH || "./storage/documents";
      const docId = crypto.randomUUID();
      const dirPath = path.join(storagePath, matterId, docId);
      await mkdir(dirPath, { recursive: true });
      const filePath = path.join(dirPath, fileName);
      await writeFile(filePath, fileBuffer);

      const document = await prisma.document.create({
        data: {
          fileName,
          mimeType,
          fileSize: fileBuffer.length,
          storagePath: filePath,
          matterId,
          uploadedById: userId,
        },
      });

      // Fire-and-forget analysis (won't block response)
      analyzeDocument(document.id).catch((err) =>
        console.error("Document analysis failed:", err),
      );

      results.push({
        documentId: document.id,
        fileName,
        recipientContactId: target.contactId,
      });
    }
  } finally {
    if (browser) await browser.close();
  }

  return NextResponse.json({ documents: results });
});
