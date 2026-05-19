import { z } from "zod";
import { JsonProjection } from "./base";

export const documentSchema = z.object({
  id: z.string().min(1),
  matterId: z.string(),
  folderId: z.string().nullable().optional(),
  fileName: z.string(),
  mimeType: z.string().optional().default("application/octet-stream"),
  sizeBytes: z.number().optional().default(0),
  storagePath: z.string().optional().default(""),
  organizationId: z.string(),
  uploadedAt: z.coerce.date().optional(),
  uploadedById: z.string().optional(),
  analysisStatus: z.string().optional().default("PENDING"),
  documentType: z.string().nullable().optional(),
  summary: z.string().nullable().optional(),
});

export type DocumentProjectionData = z.infer<typeof documentSchema>;

export class DocumentProjection extends JsonProjection<DocumentProjectionData> {
  constructor() { super(documentSchema); }
  pathFor(d: DocumentProjectionData): string {
    return `documents/${d.id}.json`;
  }
}
