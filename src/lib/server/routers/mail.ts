/**
 * `mailRouter` — spara inkommande mail till ett ärende (#72, ADR 0013).
 *
 * Anropas av Outlook-add-in:en (tunn tRPC-HTTP-klient): användaren har ett
 * mail öppet, väljer rätt ärende i panelen, och add-in:en hämtar mailets
 * rå `.eml` (RFC822-MIME) via MS Graph (`/messages/{id}/$value`) och POST:ar
 * det hit. Servern äger git-db:n → den skriver bytes:en i sin working-copy
 * (`ctx.ports.content`), registrerar dokumentet och — valfritt — bokför en
 * tidspost i samma operation. Allt commit:as + push:as av session-finalize:n.
 *
 * `.eml` valdes som lagringsformat (full mejl-fidelitet, ett dokument); se
 * ADR 0013 "Ändringshistorik" (2026-06-14).
 */

import { z } from "zod";
import { router, orgProcedure } from "../trpc";
import { emit } from "../events/emit";
import type { IDataStore } from "../data-store/IDataStore";
import { uuidv7 } from "@/lib/shared/uuid";
import { asId } from "@/lib/shared/schemas/ids";

/** Den delmängd av tRPC-context tidspost-helpern + emit behöver. */
interface MailCtx {
  dataStore: IDataStore;
  user: { id: string };
}

/** Avkoda base64 → bytes (browser+Node-säkert; routern bundlas för bägge). */
function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Härled ett säkert `.eml`-filnamn ur mejlets ämne. */
function emlFileName(subject: string): string {
  const base = subject.trim().replace(/[\\/:*?"<>|]+/g, "_").slice(0, 120) || "mail";
  return `${base}.eml`;
}

const timeInput = z.object({
  minutes: z.number().int().min(1),
  description: z.string().min(1).optional(),
});

export const mailRouter = router({
  /**
   * Spara ett inkommande mail (rått `.eml`) i `matterId`:s dokumentlista,
   * plus en valfri tidspost. Returnerar det skapade dokumentet + ev. tidspost.
   */
  saveIncoming: orgProcedure
    .input(
      z.object({
        matterId: z.string(),
        /** Rå RFC822-MIME, base64-kodad för transport. */
        emlBase64: z.string().min(1),
        subject: z.string(),
        receivedAt: z.string(), // ISO
        folderId: z.string().nullable().optional(),
        time: timeInput.optional(),
        /** Klient-genererat id (annars uuidv7). Begränsat till filnamns-säkra
         *  tecken — path:en byggs av det (defense-in-depth mot traversal). */
        documentId: z.string().regex(/^[A-Za-z0-9_-]+$/).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // 1. Verifiera att ärendet tillhör anroparens org.
      await ctx.dataStore.matters.findFirstOrThrow({
        where: { id: input.matterId, organizationId: ctx.orgId },
      });

      // 2. Skriv .eml-bytes till git-working-copy:n (server-runtime).
      const id = input.documentId ?? uuidv7();
      const storagePath = `documents/content/${id}.eml`;
      const bytes = base64ToBytes(input.emlBase64);
      await ctx.ports.content.write(storagePath, bytes);

      // 3. Registrera dokument-metadata (projektion).
      const fileName = emlFileName(input.subject);
      const doc = await ctx.dataStore.documents.create({
        data: {
          id,
          matterId: input.matterId,
          fileName,
          mimeType: "message/rfc822",
          sizeBytes: bytes.byteLength,
          fileSize: bytes.byteLength, // denormaliserat (UI läser fileSize)
          storagePath,
          folderId: input.folderId ?? null,
          organizationId: ctx.orgId,
          analysisStatus: "PENDING",
          uploadedById: ctx.user.id,
          title: input.subject,
          documentType: "E-post",
          createdAt: new Date(input.receivedAt),
        } as never,
      });
      await emit.documentUploaded(ctx, { id, fileName, matterId: input.matterId });

      // 4. Valfri tidspost kopplad till mailet.
      const timeEntry = input.time
        ? await createMailTimeEntry(ctx, input.matterId, input.receivedAt, input.subject, input.time)
        : null;

      return { document: doc, timeEntry };
    }),
});

/** Bokför tidsposten som hör ihop med ett sparat mail (#72 funktion 1). */
async function createMailTimeEntry(
  ctx: MailCtx,
  matterId: string,
  receivedAt: string,
  subject: string,
  time: z.infer<typeof timeInput>,
) {
  const userId = asId<"UserId">(ctx.user.id);
  const user = await ctx.dataStore.users.findUniqueOrThrow({
    where: { id: userId },
    select: { hourlyRate: true },
  });
  const entry = await ctx.dataStore.timeEntries.create({
    data: {
      userId,
      matterId,
      date: new Date(receivedAt),
      minutes: time.minutes,
      description: time.description ?? subject,
      hourlyRate: user.hourlyRate ?? 0,
      billable: true,
    } as never,
  });
  await emit.timeEntryAdded(ctx, { id: entry.id, matterId: entry.matterId, minutes: entry.minutes });
  return entry;
}
