/**
 * "Redigera uppgifter" för ett dokument: startvärden ur dokumentet och vad som
 * skickas till `document.updateDetails` — bara det som faktiskt ändrats.
 */

import { cleanFileName } from "@/lib/shared/document-file-name";
import { isDocumentKind, type DocumentKind } from "@/lib/shared/document-kind";
import type { DocumentDirection, DocumentRecipient } from "@/lib/shared/schemas/document";

/** Mänskliga etiketter för dokumentets motpart/mottagare (#901). */
export const DOCUMENT_RECIPIENT_LABELS: Record<string, string> = {
  DOMSTOL: "Domstol", MOTPART: "Motpart", KLIENT: "Klient",
  FORSAKRING: "Försäkring", MYNDIGHET: "Myndighet", OVRIGT: "Övrigt",
};

/** Det dialogen behöver av dokumentet. */
export interface EditableDocument {
  fileName: string;
  title?: string | null | undefined;
  documentType?: string | null | undefined;
  direction?: DocumentDirection | null | undefined;
  recipient?: DocumentRecipient | null | undefined;
  summary?: string | null | undefined;
}

/** Fältens värden; `""` = inget valt / tomt. */
export interface DocumentDetailsValues {
  title: string;
  fileName: string;
  /** En känd typ, eller `""` = behåll nuvarande (t.ex. specialvärdet "E-post"). */
  documentType: DocumentKind | "";
  direction: DocumentDirection | "";
  recipient: DocumentRecipient | "";
  summary: string;
}

export interface DocumentDetailsChanges {
  title?: string | null;
  fileName?: string;
  documentType?: DocumentKind;
  direction?: DocumentDirection | null;
  recipient?: DocumentRecipient | null;
  summary?: string | null;
}

export function detailsFromDocument(d: EditableDocument): DocumentDetailsValues {
  return {
    title: d.title ?? "",
    fileName: d.fileName,
    documentType: isDocumentKind(d.documentType) ? d.documentType : "",
    direction: d.direction ?? "",
    recipient: d.recipient ?? "",
    summary: d.summary ?? "",
  };
}

/** Fält som är text eller "tomt = null". */
function nullableChange(next: string, before: string | null | undefined): { changed: boolean; value: string | null } {
  const value = next.trim() === "" ? null : next.trim();
  return { changed: value !== (before?.trim() || null), value };
}

/** Ett val (`""` = inget) som ändrats → nytt värde eller null. */
function choiceChange<T extends string>(next: T | "", before: T | null | undefined): { changed: boolean; value: T | null } {
  const value = next === "" ? null : next;
  return { changed: value !== (before ?? null), value };
}

type Change<T> = { changed: boolean; value: T };

/** `{ key: value }` om fältet ändrats, annars inget. */
function pick<K extends string, T>(key: K, c: Change<T>): Partial<Record<K, T>> {
  // Beräknad nyckel ger `{ [x: string]: T }` i TS — castet smalnar av till K.
  return c.changed ? ({ [key]: c.value } as Partial<Record<K, T>>) : {};
}

/** Bara ändrade fält. Filnamnet städas som på servern (filändelsen behålls). */
export function detailsChanges(d: EditableDocument, v: DocumentDetailsValues): DocumentDetailsChanges {
  const name = cleanFileName(v.fileName, d.fileName);
  return {
    ...pick("title", nullableChange(v.title, d.title)),
    ...pick("summary", nullableChange(v.summary, d.summary)),
    ...pick("fileName", { changed: name !== null && name !== d.fileName, value: v.fileName }),
    ...(v.documentType && v.documentType !== d.documentType ? { documentType: v.documentType } : {}),
    ...pick("direction", choiceChange(v.direction, d.direction)),
    ...pick("recipient", choiceChange(v.recipient, d.recipient)),
  };
}

/** Filnamnet får inte bli tomt. */
export function canSaveDetails(d: EditableDocument, v: DocumentDetailsValues): boolean {
  return cleanFileName(v.fileName, d.fileName) !== null;
}
