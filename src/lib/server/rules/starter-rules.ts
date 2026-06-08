/**
 * 8 startregler som demonstrerar regel-motorn och flyttar nuvarande hardcoded
 * affärslogik till deklarativ form.
 *
 * Dessa läggs i DB:n vid seeding (se `scripts/seed-rules.ts`) — de följer inte
 * automatiskt med kodbasen. Det betyder att en byrå kan skriva över dem eller
 * stänga av dem utan att vi behöver code-deploy.
 *
 * Ingen av dem är aktiv per default i `seed-rules` — du måste manuellt
 * `enabled: true` via UI eller `bun run ava rules enable <id>`.
 */

import type { AvaRule } from "./schema";

export const STARTER_RULES: AvaRule[] = [
  // ────────────────────────────────────────────────────────────────
  // 1. Daglig payment-scan (ersätter cron/send-payment-reminders).
  // Steg 1 av 3: triggas dagligen, emittar system.payment_scan_requested.
  // Domän-listener (payment-scan-listener.ts) reagerar och emittar
  // payment.due / payment.overdue per plan, vilka regel 1b/1c skickar mail för.
  // ────────────────────────────────────────────────────────────────
  {
    id: "_org/daily-payment-scan",
    name: "Daglig payment-scan kl 09:00",
    description: "Trigger för payment-scan-service som hittar planer som ska ha DUE-/OVERDUE-mail.",
    ownerId: "_org",
    enabled: false,
    trigger: { kind: "schedule", cron: "0 9 * * 1-5", timezone: "Europe/Stockholm" },
    steps: [
      { do: "audit.log", message: "Daglig payment-scan startas" },
      { do: "emit", eventType: "system.payment_scan_requested", payload: {} },
    ],
  },

  // 1b. Skicka DUE-mail när payment-scan emittar payment.due.
  {
    id: "_org/send-payment-due-mail",
    name: "Skicka månadens betalnings-mail",
    description: "Reagerar på payment.due-events från payment-scan-service.",
    ownerId: "_org",
    enabled: false,
    trigger: { kind: "event", type: "payment.due" },
    steps: [
      {
        do: "email.send",
        template: "payment-reminder",
        to: "{{payload.recipientEmail}}",
        vars: {
          recipientEmail: "{{payload.recipientEmail}}",
          recipientName: "{{payload.recipientName}}",
          matterNumber: "{{payload.matterNumber}}",
          matterTitle: "{{payload.matterTitle}}",
          invoiceAmount: "{{payload.invoiceAmount}}",
          monthlyAmount: "{{payload.monthlyAmount}}",
          dayOfMonth: "{{payload.dayOfMonth}}",
          remainingAmount: "{{payload.remainingAmount}}",
          organizationName: "{{payload.organizationName}}",
          organizationContact: "{{payload.organizationContact}}",
          bankgiro: "{{payload.bankgiro}}",
        },
        idempotencyKey: "{{payload.idempotencyKey}}",
      },
    ],
  },

  // 1c. Skicka OVERDUE-mail när payment-scan emittar payment.overdue.
  {
    id: "_org/send-payment-overdue-mail",
    name: "Skicka påminnelse om försenad betalning",
    description: "Reagerar på payment.overdue-events från payment-scan-service.",
    ownerId: "_org",
    enabled: false,
    trigger: { kind: "event", type: "payment.overdue" },
    steps: [
      {
        do: "email.send",
        template: "payment-overdue",
        to: "{{payload.recipientEmail}}",
        vars: {
          recipientEmail: "{{payload.recipientEmail}}",
          recipientName: "{{payload.recipientName}}",
          matterNumber: "{{payload.matterNumber}}",
          matterTitle: "{{payload.matterTitle}}",
          invoiceAmount: "{{payload.invoiceAmount}}",
          monthlyAmount: "{{payload.monthlyAmount}}",
          dayOfMonth: "{{payload.dayOfMonth}}",
          remainingAmount: "{{payload.remainingAmount}}",
          organizationName: "{{payload.organizationName}}",
          organizationContact: "{{payload.organizationContact}}",
          bankgiro: "{{payload.bankgiro}}",
        },
        idempotencyKey: "{{payload.idempotencyKey}}",
      },
    ],
  },

  // ────────────────────────────────────────────────────────────────
  // 2. Auto-analysera uppladdade dokument (ersätter direkt-anrop till
  // analyzeDocument från upload-route + templates/generate). Triggar
  // för alla dokument; LLM avgör vad som är värt att extrahera.
  // ────────────────────────────────────────────────────────────────
  {
    id: "_org/auto-analyze-on-upload",
    name: "Auto-analysera dokument vid uppladdning",
    description: "AI-extraktion körs på varje nytt dokument (fire-and-forget).",
    ownerId: "_org",
    enabled: false,
    trigger: { kind: "event", type: "document.uploaded" },
    steps: [
      {
        do: "llm.extract",
        documentId: "{{payload.documentId}}",
        schema: { titel: "string?", typ: "string?", parter: "string[]?" },
        into: "documents.{{payload.documentId}}.aiMetadata",
      },
      { do: "audit.log", message: "AI-analys triggad för {{payload.fileName}}" },
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
