/**
 * Dialogen Maila dokument (#1951): fälten, spärrarna och Skicka, med en falsk
 * connector, falska bytes och ett falskt utskick (inget nät, ingen Graph).
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest-compat";
import { MailDocumentDialog } from "@/components/documents/_mail-document-dialog";
import { MAIL_ATTACHMENT_MAX_BYTES, MAIL_TOO_LARGE_TEXT } from "@/components/documents/_mail-document-rules";
import { SENT_CLOSE_MS, type MailDeps, type MailableDocument } from "@/components/documents/use-mail-document";
import type { MailDocumentInput } from "@/lib/client/graph/mail-document";
import type { ConnectionStatus, IntegrationConnector } from "@/lib/client/integrations/types";
import { asId } from "@/lib/shared/schemas/ids";
import { fakeTrpcLink, TrpcTestProvider } from "../../../helpers/trpc-fake";

const DOC: MailableDocument = {
  id: asId<"DocumentId">("d1"), matterId: asId<"MatterId">("m1"),
  fileName: "stamning.pdf", mimeType: "application/pdf", sizeBytes: 2048, storagePath: "documents/d1.pdf", title: "Stämningsansökan",
};

const MATTER = {
  id: "m1",
  contacts: [
    { role: "MOTPART", contact: { email: "motpart@example.se" } },
    { role: "KLIENT", contact: { email: "klient@example.se" } },
    { role: "KLIENT", contact: { email: "klient2@example.se" } },
  ],
};

/** En connector utan MSAL: ansluten eller inte, och ett valfritt fel från inloggningen. */
function fakeConnector(start: ConnectionStatus["kind"], fail?: string) {
  let status: ConnectionStatus = start === "connected"
    ? { kind: "connected", account: { id: "a", displayName: "A", email: "a@x" }, scopes: [] }
    : { kind: "disconnected" };
  const listeners = new Set<(s: ConnectionStatus) => void>();
  const c = {
    id: "office365", displayName: "Office 365", capabilities: ["mail"],
    getStatus: () => Promise.resolve(status),
    preload: vi.fn(() => Promise.resolve()),
    connect: vi.fn(() => {
      if (fail) return Promise.reject(new Error(fail));
      status = { kind: "connected", account: { id: "a", displayName: "A", email: "a@x" }, scopes: [] };
      return Promise.resolve();
    }),
    disconnect: () => Promise.resolve(),
    getAccessToken: vi.fn(() => Promise.resolve("token-1")),
    subscribe: (l: (s: ConnectionStatus) => void) => { listeners.add(l); l(status); return () => { listeners.delete(l); }; },
  } satisfies IntegrationConnector;
  return c;
}

function setup(opts: {
  doc?: Partial<MailableDocument>; matter?: unknown; connector?: ReturnType<typeof fakeConnector>;
  send?: (i: MailDocumentInput) => Promise<unknown>; bytes?: Uint8Array | null;
} = {}) {
  const connector = opts.connector ?? fakeConnector("connected");
  const send = vi.fn(opts.send ?? (() => Promise.resolve({ sent: true })));
  const loadBytes = vi.fn(() => Promise.resolve(opts.bytes === undefined ? new Uint8Array([1, 2, 3]) : opts.bytes));
  const deps: MailDeps = { connector: () => connector, loadBytes, send };
  const onClose = vi.fn();
  const fake = fakeTrpcLink({ "matter.getById": () => opts.matter ?? MATTER });
  render(
    <TrpcTestProvider link={fake.link}>
      <MailDocumentDialog doc={{ ...DOC, ...opts.doc }} onClose={onClose} deps={deps} />
    </TrpcTestProvider>,
  );
  return { connector, send, loadBytes, onClose, fake };
}

const field = (name: string): HTMLInputElement => screen.getByLabelText(name);
const sendButton = (): HTMLElement => screen.getByRole("button", { name: "Skicka" });
/** Väntan på ärendets svar: generös, för den parallella sviten på en belastad maskin. */
const SLOW = { timeout: 10_000 };
/** Till är ifyllt ur ärendet och Skicka går att använda. */
const ready = () => waitFor(() => expect(sendButton()).not.toBeDisabled(), SLOW);

describe("MailDocumentDialog (#1951)", () => {
  it("Till är klienternas adresser, Ämne titeln, Meddelande tomt och Bilaga filnamn och storlek", async () => {
    const { connector, fake } = setup();
    await waitFor(() => expect(field("Till").value).toBe("klient@example.se, klient2@example.se"), SLOW);
    expect(field("Ämne").value).toBe("Stämningsansökan");
    expect(field("Meddelande").value).toBe("");
    expect(screen.getByText("📎 stamning.pdf (2 KB)")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Maila dokument" })).toBeInTheDocument();
    expect(connector.preload).toHaveBeenCalledOnce();
    expect(fake.calls[0]).toMatchObject({ path: "matter.getById", input: { id: "m1" } });
  });

  it("utan titel är ämnet filnamnet", () => {
    setup({ doc: { title: null } });
    expect(field("Ämne").value).toBe("stamning.pdf");
  });

  it("utan klient med e-post: tomt Till, en upplysning, och Skicka spärrad", async () => {
    setup({ matter: { id: "m1", contacts: [{ role: "MOTPART", contact: { email: "m@example.se" } }] } });
    expect(await screen.findByText("Klienten saknar e-post i AVA", {}, SLOW)).toBeInTheDocument();
    expect(field("Till").value).toBe("");
    expect(sendButton()).toBeDisabled();
  });

  it("Skicka är spärrad med en ogiltig adress, och går att använda med en giltig", async () => {
    setup();
    await ready();
    fireEvent.change(field("Till"), { target: { value: "inte-en-adress" } });
    expect(sendButton()).toBeDisabled();
    fireEvent.change(field("Till"), { target: { value: "annan@example.se" } });
    expect(sendButton()).not.toBeDisabled();
  });

  it("över 3 MB: texten om Outlook, Skicka spärrad, och inget hämtas", async () => {
    const { loadBytes } = setup({ doc: { sizeBytes: MAIL_ATTACHMENT_MAX_BYTES + 1 } });
    expect(screen.getByText(MAIL_TOO_LARGE_TEXT)).toBeInTheDocument();
    await waitFor(() => expect(field("Till").value).not.toBe(""), SLOW);
    expect(sendButton()).toBeDisabled();
    fireEvent.click(sendButton());
    expect(loadBytes).not.toHaveBeenCalled();
  });

  it("Skicka: mailDocument utan asDraft med dokumentets bytes, Skickat., och dialogen stängs", async () => {
    const { send, loadBytes, onClose } = setup();
    await ready();
    fireEvent.change(field("Meddelande"), { target: { value: "Hej, se bifogat." } });
    fireEvent.click(sendButton());
    await screen.findByText("Skickat.", {}, SLOW);
    expect(loadBytes).toHaveBeenCalledWith(expect.objectContaining({ id: "d1", storagePath: "documents/d1.pdf" }));
    expect(send).toHaveBeenCalledWith({
      token: "token-1", to: ["klient@example.se", "klient2@example.se"], subject: "Stämningsansökan", body: "Hej, se bifogat.",
      doc: { fileName: "stamning.pdf", mimeType: "application/pdf", bytes: new Uint8Array([1, 2, 3]) },
    });
    expect(send.mock.calls[0]?.[0]).not.toHaveProperty("asDraft");
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce(), { timeout: SENT_CLOSE_MS + 1_000 });
  });

  it("ej ansluten: Skicka ansluter i klicket och skickar sedan", async () => {
    const connector = fakeConnector("disconnected");
    const { send } = setup({ connector });
    await ready();
    fireEvent.click(sendButton());
    expect(connector.connect).toHaveBeenCalledOnce();
    await screen.findByText("Skickat.", {}, SLOW);
    expect(send).toHaveBeenCalledOnce();
  });

  it("inloggningen avbröts: felet visas, och inget hämtas eller skickas", async () => {
    const { send, loadBytes } = setup({ connector: fakeConnector("disconnected", "Inloggningen avbröts.") });
    await ready();
    fireEvent.click(sendButton());
    expect(await screen.findByRole("alert", {}, SLOW)).toHaveTextContent("Inloggningen avbröts.");
    expect(loadBytes).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("Graph svarade fel: felet visas", async () => {
    setup({ send: () => Promise.reject(new Error("Graph sendMail: 403")) });
    await ready();
    fireEvent.click(sendButton());
    expect(await screen.findByRole("alert", {}, SLOW)).toHaveTextContent("Graph sendMail: 403");
  });

  it("dokumentet gick inte att hämta: felet visas och inget skickas", async () => {
    const { send } = setup({ bytes: null });
    await ready();
    fireEvent.click(sendButton());
    expect(await screen.findByRole("alert", {}, SLOW)).toHaveTextContent("Dokumentet kunde inte hämtas");
    expect(send).not.toHaveBeenCalled();
  });

  it("Avbryt stänger utan att skicka", () => {
    const { send, onClose } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Avbryt" }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(send).not.toHaveBeenCalled();
  });
});
