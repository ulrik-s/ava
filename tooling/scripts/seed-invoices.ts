/**
 * seed-invoices.ts — skapar demo-fakturor:
 *
 *   • 2026-0002 Bodelning: ACCONTO (10 000 kr, betald) + FINAL (alla tid+utlägg,
 *     med avdrag för acconto, delvis betald) — status SENT
 *   • 2026-0005 Försäkringstvist: FINAL (alla tid+utlägg), helt betald — status PAID
 *
 * Idempotent: hoppar över om fakturor redan finns på ärendet.
 *
 * Kör:  DATABASE_URL=... npx tsx tooling/scripts/seed-invoices.ts
 */

import { prisma } from "../../src/server/db.ts";

// hourlyRate på User är i SEK (heltal kr/h), belopp på Invoice/Expense i öre.
const oreFromTime = (minutes: number, hourlyRateSek: number): number =>
  Math.round((minutes * hourlyRateSek * 100) / 60);

async function buildFinalFromAll(
  matterId: string,
  opts: { accontoInvoiceId?: string } = {},
) {
  const [timeEntries, expenses] = await Promise.all([
    prisma.timeEntry.findMany({
      where: { matterId, invoiceId: null, billable: true },
      include: { user: { select: { hourlyRate: true } } },
    }),
    prisma.expense.findMany({
      where: { matterId, invoiceId: null, billable: true },
    }),
  ]);

  const timeOre = timeEntries.reduce(
    (s, t) => s + oreFromTime(t.minutes, t.user.hourlyRate ?? 0),
    0,
  );
  const expenseOre = expenses.reduce((s, e) => s + e.amount, 0);
  const grossOre = timeOre + expenseOre;

  return { timeEntries, expenses, grossOre, timeOre, expenseOre };
}

async function main() {
  console.log("🧾 Seedar demo-fakturor…\n");

  const dev = await prisma.user.findUniqueOrThrow({ where: { email: "dev@example.com" } });

  // ─── 2026-0002: Acconto (betald) + Slutfaktura (delvis betald) ─────
  {
    const matter = await prisma.matter.findUnique({ where: { matterNumber: "2026-0002" } });
    if (!matter) {
      console.log("⚠ Ärende 2026-0002 saknas — hoppar över");
    } else {
      const existing = await prisma.invoice.count({ where: { matterId: matter.id } });
      if (existing > 0) {
        console.log(`~ 2026-0002 Bodelning har redan ${existing} faktura(-or) — hoppar över`);
      } else {
        const today = new Date();
        const accontoDate = new Date(today);
        accontoDate.setDate(today.getDate() - 40);
        const accontoPaid = new Date(today);
        accontoPaid.setDate(today.getDate() - 35);

        // 1. ACCONTO 10 000 kr, status PAID
        const accontoAmount = 1_000_000; // 10 000 kr i öre
        const acconto = await prisma.invoice.create({
          data: {
            matterId: matter.id,
            amount: accontoAmount,
            invoiceType: "ACCONTO",
            status: "PAID",
            invoiceDate: accontoDate,
            dueDate: (() => { const d = new Date(accontoDate); d.setDate(d.getDate() + 14); return d; })(),
            notes: "Förskott enligt uppdragsavtal.",
          },
        });
        await prisma.payment.create({
          data: {
            invoiceId: acconto.id,
            amount: accontoAmount,
            paidAt: accontoPaid,
            note: "Banköverföring från Karin Lindström",
            recordedById: dev.id,
          },
        });
        console.log(`  + 2026-0002 ACCONTO 10 000 kr → PAID`);

        // 2. FINAL — konsumerar allt tid+utlägg, drar av acconto
        const { timeEntries, expenses, grossOre, timeOre, expenseOre } = await buildFinalFromAll(matter.id);

        const finalDate = new Date(today);
        finalDate.setDate(today.getDate() - 10);
        const final = await prisma.invoice.create({
          data: {
            matterId: matter.id,
            amount: grossOre, // brutto före accontoavdrag
            invoiceType: "FINAL",
            status: "SENT",
            invoiceDate: finalDate,
            dueDate: (() => { const d = new Date(finalDate); d.setDate(d.getDate() + 30); return d; })(),
            notes: "Slutfaktura med avdrag för tidigare förskott.",
            timeEntries: { connect: timeEntries.map((t) => ({ id: t.id })) },
            expenses: { connect: expenses.map((e) => ({ id: e.id })) },
            accontoDeductions: { create: [{ accontoInvoiceId: acconto.id }] },
          },
        });

        // Delbetalning: ca 40% av netto
        const netOre = grossOre - accontoAmount;
        const partialOre = Math.round(netOre * 0.4 / 100) * 100; // jämnt i kronor
        const partialDate = new Date(today);
        partialDate.setDate(today.getDate() - 3);
        await prisma.payment.create({
          data: {
            invoiceId: final.id,
            amount: partialOre,
            paidAt: partialDate,
            note: "Delbetalning — klient återkommer med resterande",
            recordedById: dev.id,
          },
        });

        console.log(
          `  + 2026-0002 FINAL ${(grossOre / 100).toLocaleString("sv-SE")} kr brutto (tid ${(timeOre / 100).toLocaleString("sv-SE")} kr + utlägg ${(expenseOre / 100).toLocaleString("sv-SE")} kr)`,
        );
        console.log(
          `    netto efter acconto: ${(netOre / 100).toLocaleString("sv-SE")} kr, varav betalt: ${(partialOre / 100).toLocaleString("sv-SE")} kr → SENT (delvis betald)`,
        );
      }
    }
  }

  // ─── 2026-0005: Slutfaktura helt betald ────────────────────────────
  {
    const matter = await prisma.matter.findUnique({ where: { matterNumber: "2026-0005" } });
    if (!matter) {
      console.log("⚠ Ärende 2026-0005 saknas — hoppar över");
    } else {
      const existing = await prisma.invoice.count({ where: { matterId: matter.id } });
      if (existing > 0) {
        console.log(`~ 2026-0005 Försäkringstvist har redan ${existing} faktura(-or) — hoppar över`);
      } else {
        const today = new Date();
        const finalDate = new Date(today);
        finalDate.setDate(today.getDate() - 25);
        const paidDate = new Date(today);
        paidDate.setDate(today.getDate() - 8);

        const { timeEntries, expenses, grossOre, timeOre, expenseOre } = await buildFinalFromAll(matter.id);

        const final = await prisma.invoice.create({
          data: {
            matterId: matter.id,
            amount: grossOre,
            invoiceType: "FINAL",
            status: "PAID",
            invoiceDate: finalDate,
            dueDate: (() => { const d = new Date(finalDate); d.setDate(d.getDate() + 30); return d; })(),
            notes: "Slutfaktura för uppdraget.",
            timeEntries: { connect: timeEntries.map((t) => ({ id: t.id })) },
            expenses: { connect: expenses.map((e) => ({ id: e.id })) },
          },
        });

        await prisma.payment.create({
          data: {
            invoiceId: final.id,
            amount: grossOre,
            paidAt: paidDate,
            note: "Banköverföring från Eva Persson — fullt betald",
            recordedById: dev.id,
          },
        });

        console.log(
          `  + 2026-0005 FINAL ${(grossOre / 100).toLocaleString("sv-SE")} kr (tid ${(timeOre / 100).toLocaleString("sv-SE")} kr + utlägg ${(expenseOre / 100).toLocaleString("sv-SE")} kr) → PAID`,
        );
      }
    }
  }

  const totalInvoices = await prisma.invoice.count();
  const totalPayments = await prisma.payment.count();
  console.log(`\n✅ Klart! ${totalInvoices} fakturor totalt, ${totalPayments} registrerade betalningar.`);
}

main()
  .catch((err) => {
    console.error("❌ Fel under seed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
