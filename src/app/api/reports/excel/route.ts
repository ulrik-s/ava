import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/db";
import ExcelJS from "exceljs";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  if (!from || !to) {
    return NextResponse.json({ error: "from and to required" }, { status: 400 });
  }

  // Get the dev org (in production, derive from session)
  const org = await prisma.organization.findFirst();
  if (!org) {
    return NextResponse.json({ error: "No organization" }, { status: 404 });
  }

  const entries = await prisma.timeEntry.findMany({
    where: {
      matter: { organizationId: org.id },
      date: { gte: new Date(from), lte: new Date(to) },
    },
    include: {
      user: { select: { name: true } },
      matter: {
        select: {
          matterNumber: true, title: true,
          contacts: {
            where: { role: "KLIENT" },
            select: { contact: { select: { name: true } } },
            take: 1,
          },
        },
      },
    },
    orderBy: [{ userId: "asc" }, { date: "asc" }],
  });

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Tidsrapport");

  // Header style
  const headerStyle: Partial<ExcelJS.Style> = {
    font: { bold: true, size: 11 },
    fill: { type: "pattern", pattern: "solid", fgColor: { argb: "F3F4F6" } },
    border: {
      bottom: { style: "thin", color: { argb: "D1D5DB" } },
    },
  };

  // Title
  sheet.mergeCells("A1:G1");
  const titleCell = sheet.getCell("A1");
  titleCell.value = `Tidsrapport ${from} — ${to}`;
  titleCell.font = { bold: true, size: 14 };
  sheet.addRow([]);

  // Column headers
  sheet.columns = [
    { key: "date", header: "Datum", width: 14 },
    { key: "user", header: "Advokat", width: 22 },
    { key: "matterNumber", header: "Ärendenr", width: 14 },
    { key: "matterTitle", header: "Ärende", width: 28 },
    { key: "klient", header: "Klient", width: 22 },
    { key: "minutes", header: "Tid (min)", width: 12 },
    { key: "hours", header: "Tid (tim)", width: 12 },
    { key: "description", header: "Beskrivning", width: 40 },
    { key: "billable", header: "Debiterbar", width: 12 },
  ];

  const headerRow = sheet.getRow(3);
  headerRow.values = ["Datum", "Advokat", "Ärendenr", "Ärende", "Klient", "Tid (min)", "Tid (tim)", "Beskrivning", "Debiterbar"];
  headerRow.eachCell((cell) => {
    cell.style = headerStyle;
  });

  // Data rows
  let totalMinutes = 0;
  let billableMinutes = 0;

  for (const entry of entries) {
    const row = sheet.addRow({
      date: new Date(entry.date).toLocaleDateString("sv-SE"),
      user: entry.user.name,
      matterNumber: entry.matter.matterNumber,
      matterTitle: entry.matter.title,
      klient: entry.matter.contacts[0]?.contact.name ?? "",
      minutes: entry.minutes,
      hours: +(entry.minutes / 60).toFixed(2),
      description: entry.description,
      billable: entry.billable ? "Ja" : "Nej",
    });
    totalMinutes += entry.minutes;
    if (entry.billable) billableMinutes += entry.minutes;
  }

  // Summary
  sheet.addRow([]);
  const summaryRow = sheet.addRow({
    date: "",
    user: "SUMMA",
    matterNumber: "",
    matterTitle: "",
    klient: "",
    minutes: totalMinutes,
    hours: +(totalMinutes / 60).toFixed(2),
    description: `Varav debiterbart: ${billableMinutes} min (${(billableMinutes / 60).toFixed(2)} tim)`,
    billable: "",
  });
  summaryRow.font = { bold: true };

  const buffer = await workbook.xlsx.writeBuffer();

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="tidsrapport_${from}_${to}.xlsx"`,
    },
  });
}
