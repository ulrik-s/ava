/**
 * `tool-descriptions` — vad varje procedur GÖR, i klartext (#1008).
 *
 * För en AI är verktygets beskrivning hela upptäcktsytan: det är på den den
 * väljer verktyg. Tidigare stod det `"mutation billingRun.appealKostnadsrakning"`
 * — vilket i praktiken betyder att valet gjordes på procedurnamnet ensamt.
 * `coverageSplit` säger ingenting om täckningsärenden och `setVerdict`
 * ingenting om domstolsbeslut.
 *
 * Varför en egen fil och inte `.meta()` på varje procedur: beskrivningarna
 * ska kunna GRANSKAS SOM PROSA — jämföras med varandra, hållas i samma ton,
 * läsas i ett svep. Utspridda över 24 routrar går det inte. Drift-risken som
 * annars följer med en sidoregister är stängd av `tool-descriptions.test.ts`,
 * som fäller åt BÅDA håll: en procedur utan beskrivning, och en beskrivning
 * utan procedur.
 *
 * Ton: en mening som säger vad det gör, plus en andra mening BARA när nyansen
 * behövs för att välja rätt verktyg (idempotens, vilket tillstånd som krävs,
 * vad som INTE händer).
 */

import type { ProcedureInfo } from "./introspect";

/**
 * Hur många rader ett paginerat verktyg returnerar när modellen inte säger
 * något (#1008). Zods egna defaults (20–50) ger svar på 10 000–17 000 tokens
 * på demo-seeden — över klientens varningströskel innan en riktig byrås data
 * ens är inblandad. Modellen kan alltid höja `pageSize` själv.
 */
export const MCP_DEFAULT_PAGE_SIZE = 10;

const DESCRIPTIONS: Readonly<Record<string, string>> = {
  // ── Fakturerings- och kostnadsräkningskörningar ──────────────────
  "billingRun.list": "Lista faktureringskörningar (aconto, slutfaktura, kostnadsräkning) i byrån, valfritt filtrerat på ärende.",
  "billingRun.byId": "Hämta en enskild faktureringskörning med dess frysta arbetsvärde och status.",
  "billingRun.proposal": "Avdragsmedvetet fakturaförslag för ett ärende: vilka tids- och utläggsposter som är ofakturerade, deras samlade upparbetade värde, och summan av tidigare aconton att dra av. Read-only — skapar ingen faktura.",
  "billingRun.invoiceSpecification": "Fakturaspecifikation: de tids- och utläggsrader som är kopplade till en viss faktura, plus avdragna aconton och summering. Driver fakturadokumentet. En ren aconto-faktura får tomma rader.",
  "billingRun.createAcconto": "Skapa en aconto-faktura (à conto) på ett ärende. Fryser inte arbetet — posterna kan faktureras igen på slutfakturan, med aconto-beloppet avdraget.",
  "billingRun.createFinal": "Skapa slutfaktura på ett ärende: fakturerar allt ofakturerat arbete, drar av tidigare aconton och fryser posterna.",
  "billingRun.createKostnadsrakning": "Skapa en kostnadsräkning till domstolen (offentligt uppdrag och rättshjälp). Status INSKICKAD — domstolens beslut registreras separat.",
  "billingRun.recordKostnadsrakningBeslut": "Registrera domstolens beslut på en kostnadsräkning: dömt belopp och eventuell prutning. INSKICKAD → BESLUTAD (tingsrätten), ÖVERKLAGAD → BESLUTAD slutgiltigt (hovrätten). Skapar ingen faktura — det är ett eget steg.",
  "billingRun.appealKostnadsrakning": "Överklaga domstolens prutning på en kostnadsräkning till hovrätten: BESLUTAD → ÖVERKLAGAD. Ingen ny kostnadsräkning skapas; hovrättens beslut registreras på samma körning.",
  "billingRun.setVerdict": "Registrera domen på ett offentligt uppdrag och skapa domstolsfakturan ur den beslutade kostnadsräkningen.",
  "billingRun.coverageSplit": "Räkna ut hur ett täckningsärende (rättshjälp eller rättsskydd) fördelas mellan klient, betalare och byråns egen förlust, värderat på det timarvode som gällde. Read-only — driver panelen; fakturorna skapas i slutregleringen.",
  "billingRun.settleCoverage": "Slutreglera ett täckningsärende när betalaren svarat: skapar klientfaktura (självrisk och prutning), betalarfaktura (försäkring eller stat) och bokar byråns förlust. Fryser allt arbete.",
  "billingRun.recordInsurerPruning": "Registrera försäkringsbolagets prutning efter slutreglering. Flyttar beloppet från försäkringsfakturan till klientfakturan — totalen är oförändrad och inga nya fakturor uppstår. Kräver befintliga slutregleringsfakturor.",

  // ── Kalender ─────────────────────────────────────────────────────
  "calendar.list": "Lista kalenderhändelser i byrån, valfritt inom ett datumintervall.",
  "calendar.listForMatter": "Alla kalenderhändelser kopplade till ett visst ärende, kronologiskt.",
  "calendar.listForUsers": "Kalenderhändelser för flera medarbetare i en enda fråga — underlag för gemensamma vyer.",
  "calendar.getById": "Hämta en enskild kalenderhändelse.",
  "calendar.create": "Skapa en kalenderhändelse (möte, förhandling, frist), valfritt kopplad till ett ärende.",
  "calendar.update": "Uppdatera en kalenderhändelse.",
  "calendar.delete": "Radera en kalenderhändelse.",
  "calendar.setMirrorState": "Sätt speglingsstatus mot Outlook. Anropas av synk-workern — inte något en användare gör manuellt.",

  // ── Jävskontroll ─────────────────────────────────────────────────
  "conflict.check": "Kör en jävskontroll mot byråns kontakter och ärenden, och spara resultatet. Ska göras innan ett nytt uppdrag antas.",
  "conflict.history": "Tidigare jävskontroller med sina träffar.",

  // ── Kontakter ────────────────────────────────────────────────────
  "contacts.list": "Lista och sök byråns kontakter (klienter, motparter, ombud, domstolar, försäkringsbolag).",
  "contacts.getById": "Hämta en enskild kontakt.",
  "contacts.create": "Lägg upp en ny kontakt.",
  "contacts.update": "Uppdatera en kontakts uppgifter.",
  "contacts.delete": "Radera en kontakt.",
  "contacts.addChild": "Lägg till en kontaktperson under en organisationskontakt.",

  // ── Dokument ─────────────────────────────────────────────────────
  "document.list": "Paginerad lista över dokument och mappar i ett ärende eller en mapp.",
  "document.tree": "Hela dokumentträdet (alla mappar och dokument) för ett ärende i en enda fråga.",
  "document.search": "Fulltextsök bland byråns dokument.",
  "document.listDocumentTypes": "Vilka dokumenttyper som förekommer i byrån, med antal per typ — underlag för filter.",
  "document.register": "Registrera ett uppladdat dokument. Används av klienten efter att filen skrivits lokalt; i serverdrift går uppladdningen i stället via HTTP-endpointen.",
  "document.delete": "Radera ett dokument.",
  "document.updateMetadata": "Skriv dokumentets metadata (typ, datum, motpart) — AI-genererad eller manuellt överstyrd.",
  "document.setTags": "Sätt dokumentets etiketter. Validerar mot byråns etikettvokabulär och bumpar inte versionen.",
  "document.analyze": "Kör (eller kör om) AI-analys av ett dokument. Returnerar omedelbart; resultatet skrivs när analysen är klar.",
  "document.suggestFromText": "Härled kontakt- och händelseförslag ur ett dokuments text. Idempotent — texten skickas in, routern läser inga filer.",
  "document.uploadContent": "Ta emot dokumentets bytes och lagra dem innehållsadresserat. Ger en ny immutabel version och triggar omklassificering.",
  "document.downloadContent": "Läs tillbaka dokumentets bytes ur innehållslagret.",
  "document.missingContent": "Vilka innehållsadresserade sökvägar servern saknar — byte-synken frågar detta för att bara ladda upp det som fattas.",
  "document.saveConflictCopy": "Spara användarens version som ett syskondokument när uppladdningen krockat med en nyare serverversion. Inget skrivs över, inget förloras.",
  "document.markExternallyEdited": "Markera att dokumentet ändrats i en extern editor (Word, PDF-verktyg). Bumpar version och storlek så synk-pipelinen upptäcker ändringen.",
  "document.createFolder": "Skapa en mapp i ett ärendes dokumentträd.",
  "document.renameFolder": "Byt namn på en mapp.",
  "document.deleteFolder": "Radera en mapp. Innehållet flyttas upp till föräldramappen — inget raderas med den.",
  "document.moveDocument": "Flytta ett dokument till en annan mapp.",
  "document.moveFolder": "Flytta en mapp. Cykler (mapp in i sig själv eller sin egen undermapp) blockeras.",
  "document.breadcrumb": "Sökvägen från roten till en viss mapp.",
  "document.acquireLease": "Ta redigeringslåset på ett dokument. Ledigt, utgånget eller redan ditt → du får det; annars returneras vem som håller det.",
  "document.renewLease": "Förnya ditt redigeringslås (heartbeat). Falskt svar betyder att du inte håller det längre.",
  "document.releaseLease": "Släpp ditt redigeringslås. Idempotent.",
  "document.takeoverLease": "Ta över ett dött eller inaktuellt redigeringslås — permanent omtilldelning till anroparen.",
  "document.getLease": "Vem som redigerar dokumentet just nu, sedan när, och om låset hunnit bli inaktuellt.",
  "document.events": "Händelser (möten, frister, förhandlingar) som hittats i ett ärendes dokument, kronologiskt och utan de avvisade.",
  "document.rejectEvent": "Avvisa en händelse som hittats i ett dokument.",
  "document.markEventAdded": "Markera att en dokumenthändelse lagts in i kalendern.",
  "document.pendingSuggestions": "Obehandlade kontaktförslag som härletts ur ett ärendes dokument.",
  "document.pendingSuggestionsGrouped": "Samma obehandlade kontaktförslag, men grupperade per person eller organisation så samma individ i flera dokument blir en rad.",
  "document.acceptSuggestion": "Acceptera ett kontaktförslag: länkar en befintlig kontakt eller skapar en ny, och kopplar den till ärendet med föreslagen roll.",
  "document.rejectSuggestion": "Avvisa ett kontaktförslag.",
  "document.acceptSuggestionGroup": "Acceptera hela gruppen av förslag som hör till samma person: skapar eller hittar kontakten och länkar den med alla distinkta roller.",
  "document.rejectSuggestionGroup": "Avvisa hela gruppen av förslag för en person.",

  // ── Dokumentmallar ───────────────────────────────────────────────
  "documentTemplate.list": "Byråns dokumentmallar.",
  "documentTemplate.getById": "Hämta en enskild dokumentmall.",
  "documentTemplate.create": "Lägg upp en ny dokumentmall.",
  "documentTemplate.update": "Uppdatera en dokumentmall.",
  "documentTemplate.delete": "Radera en dokumentmall.",

  // ── Förväntade domstolsbetalningar ───────────────────────────────
  "expectedReceivable.list": "Förväntade domstolsbetalningar, valfritt filtrerat på ärende.",
  "expectedReceivable.candidates": "Öppna fordringar berikade med ärende- och målnummer — matchningsunderlag vid avprickning mot bankfil.",
  "expectedReceivable.create": "Registrera en förväntad domstolsbetalning (status PENDING).",
  "expectedReceivable.settle": "Pricka av en fordran med det faktiskt utbetalda beloppet. Idempotent på betalningsreferensen — samma betalning bokförs aldrig två gånger.",
  "expectedReceivable.update": "Ändra begärt belopp eller beskrivning medan fordran är öppen.",
  "expectedReceivable.cancel": "Avbryt en fordran, t.ex. felregistrerad eller helt avslagen av domstolen.",

  // ── Utlägg ───────────────────────────────────────────────────────
  "expense.list": "Lista utlägg, valfritt filtrerat på ärende.",
  "expense.create": "Registrera ett utlägg på ett ärende, med momssats och om det är debiterbart.",
  "expense.update": "Uppdatera ett utlägg.",
  "expense.delete": "Radera ett utlägg.",

  // ── Fakturor ─────────────────────────────────────────────────────
  "invoice.list": "Lista fakturor, valfritt filtrerat på ärende, typ eller status.",
  "invoice.getById": "Hämta en enskild faktura med belopp, betalningar och utestående.",
  "invoice.createRadgivning": "Fakturera den obligatoriska rådgivningstimmen. Hålls medvetet i DRAFT: den är en additiv klientkostnad och ska aldrig dras av på en slutfaktura. Idempotent — avvisar om den redan registrerats.",
  "invoice.createCredit": "Kreditera en faktura: skapar en motfaktura med negativt belopp och annullerar originalet. En redan krediterad eller annullerad faktura kan inte krediteras igen.",
  "invoice.recordPayment": "Bokför en inbetalning på en faktura.",
  "invoice.writeOff": "Skriv av en faktura som konstaterad kundförlust, helt eller delvis. Endast utställda fakturor med utestående belopp; avskrivningen får inte överstiga det utestående.",
  "invoice.setStatus": "Ändra fakturans status manuellt (DRAFT→SENT, SENT→CANCELLED). För kundförlust används writeOff, som skapar en daterad post.",
  "invoice.createPaymentPlan": "Lägg upp en avbetalningsplan på en faktura.",
  "invoice.cancelPaymentPlan": "Avbryt en aktiv avbetalningsplan.",
  "invoice.markFortnoxBooked": "Märk fakturan som bokförd i Fortnox med sitt verifikatnummer. Skriver aldrig över ett redan satt id — det är dubbelbokföringsskyddet.",

  // ── Fakturautskick ───────────────────────────────────────────────
  "invoiceDispatch.list": "Utskickshistorik för fakturor.",
  "invoiceDispatch.listQueued": "Köade fakturautskick som väntar på att skickas.",
  "invoiceDispatch.queue": "Köa en faktura för utskick.",
  "invoiceDispatch.recordManual": "Registrera ett utskick som redan gjorts för hand, t.ex. via advokatens egen mailklient. Skapas direkt som skickat, aldrig köat — annars skulle utskicks-workern skicka igen.",
  "invoiceDispatch.updateStatus": "Uppdatera ett utskicks status (skickat, levererat, misslyckat).",

  // ── Kostnadsräkning (dokument) ───────────────────────────────────
  "kostnadsrakning.record": "Registrera ett genererat kostnadsräkningsdokument. Filen har redan skrivits av klienten; här sparas metadata och händelsen skickas vidare.",

  // ── Mail ─────────────────────────────────────────────────────────
  "mail.saveIncoming": "Spara ett inkommande mail som dokument på ett ärende, med valfri tidspost.",

  // ── Ärenden ──────────────────────────────────────────────────────
  "matter.list": "Lista och sök byråns ärenden, valfritt filtrerat på status eller handläggare.",
  "matter.getById": "Hämta ett enskilt ärende med betalningssätt, klient och ekonomi.",
  "matter.create": "Lägg upp ett nytt ärende med betalningssätt (privat, rättshjälp, rättsskydd eller offentligt uppdrag).",
  "matter.update": "Uppdatera ett ärendes uppgifter.",
  "matter.coverageUsage": "Hur mycket debiterbart arbete som är upparbetat i ärendet — underlag för varningen när täckningstaket närmar sig.",
  "matter.addContact": "Koppla en befintlig kontakt till ärendet i en roll (klient, motpart, ombud, domstol).",
  "matter.addNewContact": "Skapa en ny kontakt och koppla den till ärendet i ett steg.",
  "matter.removeContact": "Ta bort en kontaktkoppling från ärendet.",

  // ── Byrå och kontor ──────────────────────────────────────────────
  "organization.create": "Lägg upp byrån.",
  "organization.getSettings": "Byråns inställningar (namn, organisationsnummer, adress, momssatser, etikettvokabulär).",
  "organization.updateSettings": "Uppdatera byråns inställningar.",
  "organization.listOffices": "Byråns kontor.",
  "organization.addOffice": "Lägg till ett kontor.",
  "organization.updateOffice": "Uppdatera ett kontor.",
  "organization.deleteOffice": "Ta bort ett kontor.",

  // ── Avbetalningsplaner ───────────────────────────────────────────
  "paymentPlan.list": "Avbetalningsplaner med sina fakturor och förfallodagar.",
  "paymentPlan.getById": "Hämta en enskild avbetalningsplan.",
  "paymentPlan.cancel": "Avbryt en aktiv avbetalningsplan.",
  "paymentPlan.recordReminder": "Logga en utskickad påminnelse för en plan (förfallen eller försenad, för en viss månad).",
  "paymentPlan.scanDueReminders": "Gå igenom alla planer och logga de påminnelser som förfallit. Idempotent — redan loggade månader hoppas över.",

  // ── Inställningar (användare och byrå) ───────────────────────────
  "prefs.get": "Hämta både användarens och byråns inställning för en nyckel; anroparen väljer vilken som vinner.",
  "prefs.save": "Spara användarens egen inställning för en nyckel.",
  "prefs.clear": "Nollställ användarens inställning så byråns eller komponentens default gäller igen.",
  "prefs.setOrgDefault": "Sätt byråns default för en inställning. Endast administratör.",
  "prefs.clearOrgDefault": "Ta bort byråns default för en inställning. Endast administratör.",
  "prefs.listOrgDefaults": "Vilka inställningar som har en byrå-default satt.",

  // ── Rapporter ────────────────────────────────────────────────────
  "reports.perLawyer": "Advokatrapport för en period: vilka ärenden advokaten arbetat i, timdebitering per vecka, och upparbetat men ofakturerat arbete.",
  "reports.billed": "Fakturerat per advokat och period, attribuerat mot advokatens andel av det frysta arbetsvärdet, netto efter avskrivningar.",
  "reports.arSummary": "Kundfordringar över byråns livstid: brygga och åldersanalys, byggd på de daterade avskrivningsposterna.",

  // ── Delgivningskvitton ───────────────────────────────────────────
  "serviceNote.list": "Delgivningsanteckningar, valfritt filtrerat på ärende.",
  "serviceNote.create": "Registrera en delgivning på ett ärende.",
  "serviceNote.update": "Uppdatera en delgivningsanteckning.",
  "serviceNote.delete": "Radera en delgivningsanteckning.",

  // ── Synk ─────────────────────────────────────────────────────────
  "sync.pull": "Hämta ändringar efter en viss markör (delta-synk). Maskinväg — inte något en användare anropar.",
  "sync.push": "Skicka en köad klientmutation för serverauktoritativ tillämpning. Maskinväg.",

  // ── System ───────────────────────────────────────────────────────
  "system.capabilities": "Vad den här installationen kan (demo, self-hosted eller serverdrift) — styr vilka funktioner som är tillgängliga.",
  "system.helperConfig": "Inloggningskonfiguration som webbappen pushar till den lokala hjälpprocessen. Null i demon.",

  // ── Uppgifter ────────────────────────────────────────────────────
  "task.list": "Lista uppgifter, valfritt filtrerat på status eller ärende.",
  "task.create": "Skapa en uppgift, valfritt kopplad till ett ärende och med förfallodag.",
  "task.update": "Uppdatera en uppgift.",
  "task.complete": "Markera en uppgift som klar.",
  "task.delete": "Radera en uppgift.",

  // ── Tidsposter ───────────────────────────────────────────────────
  "timeEntry.list": "Lista tidsposter, valfritt filtrerat på ärende, medarbetare och datumintervall.",
  "timeEntry.create": "Registrera arbetad tid på ett ärende. Kategorin styr ersättningen: arbete, tidsspillan, arbete på obekväm tid, eller advokatberedskap som ersätts per dygn med noll minuter.",
  "timeEntry.update": "Uppdatera en tidspost.",
  "timeEntry.delete": "Radera en tidspost.",
  "timeEntry.report": "Tidsrapport aggregerad över en period.",

  // ── Att göra-vy ──────────────────────────────────────────────────
  "todo.list": "Sammanställd att göra-lista: uppgifter, frister och kalenderhändelser som kräver åtgärd.",

  // ── Användare ────────────────────────────────────────────────────
  "user.list": "Byråns medarbetare.",
  "user.getById": "Hämta en enskild medarbetare.",
  "user.current": "Den inloggade användaren med roll och byråtillhörighet.",
  "user.create": "Lägg upp en medarbetare med roll och timtaxa.",
  "user.update": "Uppdatera en medarbetares uppgifter.",
  "user.deactivate": "Avaktivera en medarbetare. Raden bevaras så historiken står kvar.",
  "user.delete": "Radera en medarbetare.",
};

/** Alla paths som har en beskrivning — drift-testet läser den här. */
export function describedPaths(): readonly string[] {
  return Object.keys(DESCRIPTIONS);
}

/** Bär procedurens input ett `pageSize`-fält? Styr både default och not. */
export function isPaginated(schema: unknown): boolean {
  const props = (schema as { properties?: Record<string, unknown> } | null)?.properties;
  return props !== undefined && "pageSize" in props;
}

/**
 * Verktygsbeskrivningen som når modellen. Paginerade verktyg får en not om
 * sidstorleken — annars ser modellen ett trunkerat svar utan att förstå varför.
 */
export function toolDescription(proc: ProcedureInfo): string {
  const base = DESCRIPTIONS[proc.path] ?? `${proc.type} ${proc.path}`;
  if (!isPaginated(proc.inputSchema)) return base;
  return `${base} Returnerar ${MCP_DEFAULT_PAGE_SIZE} rader per sida om inget annat anges — höj pageSize eller stega med page för fler.`;
}

/**
 * Fyll i sidstorleken när modellen inte angett någon. Zods egna defaults
 * (20–50) ger svar som spränger klientens utdatabudget; MCP-ytan är snålare
 * och modellen kan alltid begära mer.
 */
export function withPageSizeDefault(schema: unknown, args: unknown): unknown {
  if (!isPaginated(schema)) return args;
  const obj = args !== null && typeof args === "object" ? (args as Record<string, unknown>) : {};
  if (obj.pageSize !== undefined) return args;
  return { ...obj, pageSize: MCP_DEFAULT_PAGE_SIZE };
}
