/**
 * `EmailSender`-port (#180) — abstraktion för utgående e-post. Dispatch-workern
 * ([[dispatch-job]]) skickar via denna; den konkreta SMTP-implementationen
 * ([[smtp-sender]]) injiceras av runtime:n. Testas med en fejk-sender.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface EmailSender {
  /** Skicka ett mejl. Returnerar leverantörens meddelande-id. Kastar vid fel. */
  sendMail(msg: EmailMessage): Promise<{ messageId: string }>;
}
