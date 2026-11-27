"use client";

/**
 * Logiken bakom dialogen Maila dokument (#1951): fälten, spärrarna och
 * utskicket. Mejlet går via Microsoft Graph från juristens egen brevlåda
 * (delegerad `Mail.Send`, ADR 0036) och hamnar i Skickat.
 *
 * Connectorn förladdas när dialogen öppnas, och **Skicka** startar
 * inloggningen utan något `await` före, så att Microsofts popup öppnas direkt
 * i klicket (krav i iOS Safari).
 */

import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { loadDocumentBlob } from "@/lib/client/backend/load-document-blob";
import { createServerDownloadClient } from "@/lib/client/backend/server-download-client";
import { mailDocument, type MailDocumentInput } from "@/lib/client/graph/mail-document";
import "@/lib/client/integrations/office365-connector"; // registrerar connectorn
import { getConnector } from "@/lib/client/integrations/registry";
import type { ConnectionStatus, IntegrationConnector } from "@/lib/client/integrations/types";
import { useTRPC } from "@/lib/client/trpc";
import type { DocumentId, MatterId } from "@/lib/shared/schemas/ids";
import { clientRecipients, fitsMailAttachment, hasValidRecipients, mailSubject, parseRecipients } from "./_mail-document-rules";

/** Dokumentet som mailas — det dokumentraden redan har. */
export interface MailableDocument {
  id: DocumentId;
  matterId: MatterId;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storagePath?: string | null | undefined;
  title?: string | null | undefined;
}

/** Var utskicket står. */
export type MailPhase =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "sent" }
  | { kind: "error"; message: string };

/** Det utskicket behöver utifrån. Injicerbart för tester. */
export interface MailDeps {
  connector: () => IntegrationConnector | undefined;
  loadBytes: (doc: MailableDocument) => Promise<Uint8Array | null>;
  send: (input: MailDocumentInput) => Promise<unknown>;
}

async function loadBytesFromServer(doc: MailableDocument): Promise<Uint8Array | null> {
  const blob = await loadDocumentBlob(createServerDownloadClient(), { id: doc.id, storagePath: doc.storagePath ?? null, fileName: doc.fileName });
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
}

const DEFAULT_DEPS: MailDeps = {
  connector: () => getConnector("office365"),
  loadBytes: loadBytesFromServer,
  send: mailDocument,
};

/** Hur länge "Skickat." står innan dialogen stängs. */
export const SENT_CLOSE_MS = 1_500;

/**
 * Token för utskicket. Ansluten: tyst (eller connectorns egen popup). Annars
 * `connect()` direkt, utan `await` före, så att popupen hör till klicket.
 */
function tokenFor(c: IntegrationConnector, status: ConnectionStatus["kind"]): Promise<string> {
  if (status === "connected") return c.getAccessToken();
  return c.connect().then(() => c.getAccessToken());
}

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Connectorns status, följd medan dialogen är öppen; förladdad när den öppnas. */
function useConnectorStatus(connector: IntegrationConnector | undefined): React.RefObject<ConnectionStatus["kind"]> {
  const status = useRef<ConnectionStatus["kind"]>("disconnected");
  useEffect(() => {
    if (!connector) return undefined;
    connector.preload?.().catch(() => {});
    return connector.subscribe((s) => { status.current = s.kind; });
  }, [connector]);
  return status;
}

/** Fälten, spärrarna och Skicka för ett dokument. */
export function useMailDocument(doc: MailableDocument, onClose: () => void, deps: MailDeps = DEFAULT_DEPS) {
  const t = useTRPC();
  const matter = useQuery(t.matter.getById.queryOptions({ id: doc.matterId }));
  const [connector] = useState(deps.connector);
  const status = useConnectorStatus(connector);
  const [edited, setTo] = useState<string | null>(null);
  const [subject, setSubject] = useState(() => mailSubject(doc));
  const [body, setBody] = useState("");
  const [phase, setPhase] = useState<MailPhase>({ kind: "idle" });

  const clients = clientRecipients(matter.data?.contacts);
  const to = edited ?? clients.join(", ");
  const recipients = parseRecipients(to);
  const fits = fitsMailAttachment(doc.sizeBytes);
  const canSend = fits && hasValidRecipients(recipients) && connector !== undefined && phase.kind !== "sending";

  const send = async (): Promise<void> => {
    if (!canSend) return;
    // Inloggningen startar först, i klicket; inget `await` före.
    const token = tokenFor(connector, status.current);
    setPhase({ kind: "sending" });
    try {
      const accessToken = await token;
      const bytes = await deps.loadBytes(doc);
      if (!bytes) throw new Error("Dokumentet kunde inte hämtas. Försök igen när du är uppkopplad.");
      await deps.send({
        token: accessToken, to: recipients, subject, body,
        doc: { fileName: doc.fileName, mimeType: doc.mimeType, bytes },
      });
      setPhase({ kind: "sent" });
      setTimeout(onClose, SENT_CLOSE_MS);
    } catch (e: unknown) {
      setPhase({ kind: "error", message: errorText(e) });
    }
  };

  return {
    to, setTo, subject, setSubject, body, setBody, phase, send, canSend, fits,
    noClientEmail: matter.isSuccess && clients.length === 0,
  };
}
