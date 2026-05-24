import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { requireSession, parseJsonBody, withApiErrors } from "@/server/api-auth";
import { buildTemplateContext, renderTemplate, type TemplateContext } from "@/client/lib/template-context";
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
} from "@/client/lib/template-recipients";

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
type RenderArgs = {
  html: string;
  format: "pdf" | "docx";
  browser: Awaited<ReturnType<typeof puppeteer.launch>> | null;
  headerTemplate: string;
  footerTemplate: string;
  docxHeaderHtml: string;
  docxFooterHtml: string;
};

async function renderToFile(args: RenderArgs): Promise<{
  fileBuffer: Buffer;
  mimeType: string;
  extension: "pdf" | "docx";
}> {
  if (args.format === "pdf" && args.browser) {
    const page = await args.browser.newPage();
    try {
      // waitUntil: "load" — väntar på allt stylesheet/img-resurser. Vi
      // använder INTE "networkidle0" eftersom Puppeteer:s type-export
      // mellan top-level + core ibland kollapsar union:n och CI:s
      // type-resolution avvisar det. "load" är giltig i alla versioner
      // och tillräcklig för statisk HTML-rendering av mall-PDF:er.
      await page.setContent(args.html, { waitUntil: "load" });
      const pdf = await page.pdf({
        format: "A4",
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate: args.headerTemplate,
        footerTemplate: args.footerTemplate,
        margin: { top: "3.2cm", right: "2.5cm", bottom: "2.8cm", left: "3cm" },
      });
      return { fileBuffer: Buffer.from(pdf), mimeType: "application/pdf", extension: "pdf" };
    } finally {
      await page.close();
    }
  }
  const docxBuffer = await HTMLtoDOCX(args.html, args.docxHeaderHtml, {
    table: { row: { cantSplit: true } },
    header: true,
    footer: true,
    footerType: "first",
    pageNumber: false,
  }, args.docxFooterHtml);
  const fileBuffer = Buffer.isBuffer(docxBuffer) ? docxBuffer : Buffer.from(docxBuffer);
  return {
    fileBuffer,
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    extension: "docx",
  };
}

async function saveDocument(args: {
  fileName: string;
  mimeType: string;
  fileBuffer: Buffer;
  matterId: string;
  userId: string;
}) {
  const storagePath = process.env.DOCUMENT_STORAGE_PATH || "./data/storage/documents";
  const docId = crypto.randomUUID();
  const dirPath = path.join(storagePath, args.matterId, docId);
  await mkdir(dirPath, { recursive: true });
  const filePath = path.join(dirPath, args.fileName);
  await writeFile(filePath, args.fileBuffer);

  return prisma.document.create({
    data: {
      fileName: args.fileName,
      mimeType: args.mimeType,
      fileSize: args.fileBuffer.length,
      storagePath: filePath,
      matterId: args.matterId,
      uploadedById: args.userId,
    },
  });
}

type LoadResult =
  | { kind: "error"; response: NextResponse }
  | {
      kind: "ok";
      template: NonNullable<Awaited<ReturnType<typeof prisma.documentTemplate.findUnique>>>;
      matter: { organizationId: string; matterNumber: string; title: string };
    };

async function loadTemplateAndMatter(
  templateId: string,
  matterId: string,
  organizationId: string,
): Promise<LoadResult> {
  const template = await prisma.documentTemplate.findUnique({ where: { id: templateId } });
  if (!template || template.organizationId !== organizationId) {
    return { kind: "error", response: NextResponse.json({ error: "Template not found" }, { status: 404 }) };
  }
  const matter = await prisma.matter.findUnique({
    where: { id: matterId },
    select: { organizationId: true, matterNumber: true, title: true },
  });
  if (!matter || matter.organizationId !== organizationId) {
    return { kind: "error", response: NextResponse.json({ error: "Matter not found" }, { status: 404 }) };
  }
  return { kind: "ok", template, matter };
}

async function loadRecipients(
  recipientIds: string[],
  matterId: string,
): Promise<ResolvedRecipient[] | NextResponse> {
  if (recipientIds.length === 0) return [];
  const links = await prisma.matterContact.findMany({
    where: { matterId, contactId: { in: recipientIds } },
    include: { contact: true },
  });
  try {
    return resolveRecipients(recipientIds, links, matterId);
  } catch (e) {
    if (e instanceof RecipientNotLinkedError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    throw e;
  }
}

export const POST = withApiErrors(async (req: NextRequest): Promise<NextResponse> => {
  const { userId, orgId: organizationId } = await requireSession();
  const { templateId, matterId, format, recipientContactIds } = await parseJsonBody(req, GenerateBody);

  const loaded = await loadTemplateAndMatter(templateId, matterId, organizationId);
  if (loaded.kind === "error") return loaded.response;
  const { template, matter } = loaded;

  const baseContext = await buildTemplateContext(matterId, userId, prisma);

  const recipientIds = Array.isArray(recipientContactIds) ? recipientContactIds : [];
  const recipientResult = await loadRecipients(recipientIds, matterId);
  if (recipientResult instanceof NextResponse) return recipientResult;
  const recipientContacts: ResolvedRecipient[] = recipientResult;

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
      const { fileBuffer, mimeType, extension } = await renderToFile({
        html, format, browser, headerTemplate, footerTemplate, docxHeaderHtml, docxFooterHtml,
      });

      const fileName = buildGeneratedFileName(
        matter.matterNumber,
        template.name,
        extension,
        target.data,
      );

      const document = await saveDocument({
        fileName, mimeType, fileBuffer, matterId, userId,
      });

      analyzeDocument(document.id).catch((err) => console.error("Document analysis failed:", err));

      results.push({ documentId: document.id, fileName, recipientContactId: target.contactId });
    }
  } finally {
    if (browser) await browser.close();
  }

  return NextResponse.json({ documents: results });
});
