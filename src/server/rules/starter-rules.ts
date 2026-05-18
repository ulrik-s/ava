/**
 * 8 startregler som demonstrerar regel-motorn och flyttar nuvarande hardcoded
 * affärslogik till deklarativ form.
 *
 * Dessa läggs i DB:n vid seeding (se `scripts/seed-rules.ts`) — de följer inte
 * automatiskt med kodbasen. Det betyder att en byrå kan skriva över dem eller
 * stänga av dem utan att vi behöver code-deploy.
 *
 * Ingen av dem är aktiv per default i `seed-rules` — du måste manuellt
 * `enabled: true` via UI eller `yarn ava rules enable <id>`.
 */

import type { AvaRule } from "./schema";

export const STARTER_RULES: AvaRule[] = [
  // ────────────────────────────────────────────────────────────────
  // 1. Daglig betalningspåminnelse (ersätter cron/send-payment-reminders)
  // ────────────────────────────────────────────────────────────────
  {
    id: "_org/daily-payment-reminders",
    name: "Daglig betalningspåminnelse 09:00",
    description: "Skickar 14-dagars-påminnelse till klienter med förfallna fakturor.",
    ownerId: "_org",
    enabled: false,
    trigger: { kind: "schedule", cron: "0 9 * * 1-5", timezone: "Europe/Stockholm" },
    steps: [
      { do: "audit.log", message: "Daglig påminnelse-scan startad" },
      // Den faktiska "hitta-förfallna-fakturor"-logiken kommer som en
      // SQL-fråga i en `report.query`-step i nästa wave. För nu en
      // markörregel som visar mönstret.
    ],
  },

  // ────────────────────────────────────────────────────────────────
  // 2. Auto-extrahera avtalsmetadata vid uppladdning
  // ────────────────────────────────────────────────────────────────
  {
    id: "_org/extract-contract-metadata",
    name: "AI-extraktion av avtal vid uppladdning",
    description: "När ett dokument med 'avtal' i filnamnet laddas upp körs LLM-extraktion av parter, datum och belopp.",
    ownerId: "_org",
    enabled: false,
    trigger: {
      kind: "event",
      type: "document.uploaded",
      predicate: { in: ["avtal", { var: "payload.fileName" }] },
    },
    steps: [
      {
        do: "llm.extract",
        documentId: "{{payload.documentId}}",
        schema: { parter: "string[]", datum: "date", belopp: "number?" },
        into: "documents.{{payload.documentId}}.aiMetadata",
      },
      {
        do: "task.create",
        assignTo: "{{event.actor.id}}",
        title: "Granska AI-extraherat för {{payload.fileName}}",
      },
      { do: "audit.log", message: "AI-extraktion startad för {{payload.fileName}}" },
    ],
  },

  // ────────────────────────────────────────────────────────────────
  // 3. Auto-arkivera ärenden som stängts > 90 dagar sedan
  // ────────────────────────────────────────────────────────────────
  {
    id: "_org/auto-archive-closed-matters",
    name: "Auto-arkivera ärenden 90 dagar efter stängning",
    description: "Veckovis städ-pass som arkiverar gamla CLOSED-ärenden.",
    ownerId: "_org",
    enabled: false,
    trigger: { kind: "schedule", cron: "0 3 * * 1", timezone: "Europe/Stockholm" },
    steps: [
      { do: "audit.log", message: "Auto-arkivering-pass startat" },
    ],
  },

  // ────────────────────────────────────────────────────────────────
  // 4. Notifiera ansvarig advokat när ärendet får ny part
  // ────────────────────────────────────────────────────────────────
  {
    id: "_org/notify-on-matter-update",
    name: "Notifiera vid ärendeändringar",
    description: "När någon ändrar status på ett ärende, logga audit-rad.",
    ownerId: "_org",
    enabled: false,
    trigger: { kind: "event", type: "matter.status_changed" },
    steps: [
      {
        do: "audit.log",
        message: "Ärende {{event.matterId}}: status {{payload.from}} → {{payload.to}} av {{actor.id}}",
      },
    ],
  },

  // ────────────────────────────────────────────────────────────────
  // 5. Loggar tid-registreringar över 4 timmar för granskning
  // ────────────────────────────────────────────────────────────────
  {
    id: "_org/flag-long-time-entries",
    name: "Flagga långa tidsregistreringar",
    description: "Tidsposter > 240 min flaggas för granskning.",
    ownerId: "_org",
    enabled: false,
    trigger: {
      kind: "event",
      type: "time-entry.added",
      predicate: { ">": [{ var: "payload.minutes" }, 240] },
    },
    steps: [
      {
        do: "task.create",
        assignTo: "{{actor.id}}",
        title: "Granska lång tidspost: {{payload.minutes}} min på ärende {{event.matterId}}",
      },
    ],
  },

  // ────────────────────────────────────────────────────────────────
  // 6. Fortnox payment webhook
  // ────────────────────────────────────────────────────────────────
  {
    id: "_org/fortnox-payment-webhook",
    name: "Fortnox: betalning mottagen",
    description: "Webhook-endpoint för Fortnox som registrerar betalning på matchande faktura.",
    ownerId: "_org",
    enabled: false,
    trigger: {
      kind: "http",
      method: "POST",
      path: "fortnox/payment-received",
      auth: "shared-secret",
    },
    steps: [
      {
        do: "emit",
        eventType: "invoice.payment_received",
        payload: {
          invoiceId: "{{request.body.invoiceId}}",
          amount: "{{request.body.amount}}",
        },
      },
      { do: "http.respond", status: 200, body: { ok: true } },
    ],
  },

  // ────────────────────────────────────────────────────────────────
  // 7. Markera försenade fakturor (när dueDate passerats)
  // ────────────────────────────────────────────────────────────────
  {
    id: "_org/mark-overdue-invoices",
    name: "Markera förfallna fakturor",
    description: "Daglig kontroll: alla SENT-fakturor med dueDate < idag flaggas som overdue.",
    ownerId: "_org",
    enabled: false,
    trigger: { kind: "schedule", cron: "0 6 * * *", timezone: "Europe/Stockholm" },
    steps: [
      { do: "audit.log", message: "Overdue-scan kör" },
    ],
  },

  // ────────────────────────────────────────────────────────────────
  // 8. Auto-fila mail från känd domän till specifikt ärende
  // ────────────────────────────────────────────────────────────────
  {
    id: "anna/auto-file-counterparty-mail",
    name: "Anna: filera motpartsmail till ärende 2026-0003",
    description: "Personlig regel för Anna — auto-arkivera mail från @motpart.se till hennes huvudärende.",
    ownerId: "anna",
    enabled: false,
    trigger: {
      kind: "event",
      type: "mail.received",
      predicate: {
        and: [
          { "==": [{ var: "actor.id" }, "anna"] },
          { in: ["@motpart.se", { var: "payload.from" }] },
        ],
      },
    },
    steps: [
      {
        do: "matter.update",
        matterId: "matter-2026-0003",
        patch: { lastInboundMail: "{{event.ts}}" },
      },
      { do: "audit.log", message: "Auto-arkiverade mail från {{payload.from}}" },
    ],
  },
];
