# Installera AVA Helper (Mac)

AVA Helper är en liten app på din Mac som gör att du kan öppna dokument från
AVA direkt i Word, Förhandsvisning m.fl. — och att det du sparar hamnar i AVA
igen. Du installerar den en gång.

## 1. Installera med en rad i Terminal

Enklast är att utgå från AVA: **Inställningar → AVA Helper → Installera på
Mac** visar raden med en **Kopiera**-knapp.

1. Kopiera raden (den ser ut så här, med din byrås AVA-adress):

   ```bash
   curl -fsSL https://ava-crm.io/helper/install.sh | bash
   ```

2. Tryck **⌘ mellanslag**, skriv **Terminal** och tryck Enter.
3. Klistra in med **⌘ V** och tryck Enter.

Skriptet hämtar senaste versionen, kontrollerar dess kontrollsumma, lägger
appen i **Program** i din hemkatalog (`~/Applications`) och startar den. Inga
administratörsrättigheter behövs.

Appen är ännu inte signerad hos Apple. Hämtad på det här sättet stoppas den
inte av macOS, så du behöver inte gå via *Integritet och säkerhet*.

## 2. Godkänn certifikatet

När appen startar första gången frågar den om den får **installera ett
certifikat**. Klicka **Installera** och bekräfta med ditt Mac-lösenord.

Certifikatet gäller bara din egen dator (`localhost`) och behövs för att AVA i
Safari och **Outlook-tillägget** ska få prata med helpern. Klickade du
*Inte nu* finns valet kvar i menyn: **Installera certifikat för Safari…**

När appen är installerad öppnas ett **statusfönster** med version, uppdatering,
synk och inloggning. Klicka **OK** — AVA Helper fortsätter i bakgrunden och
startar av sig själv när du loggar in på datorn. Fönstret visas igen när du
öppnar AVA Helper (t.ex. via Spotlight: ⌘ mellanslag, skriv "AVA Helper").

## 4. Koppla till AVA

1. Öppna AVA i Safari (t.ex. https://ava-crm.io) och logga in som vanligt.
2. AVA Helper frågar **"ava-crm.io vill använda AVA Helper"** — klicka
   **Tillåt**. (Tillåt bara din byrås egen AVA-adress.)
3. Öppna AVA Helper (Spotlight) → klicka **Logga in…** i statusfönstret och
   logga in med ditt vanliga Microsoft-konto i webbläsaren som öppnas.

Klart. Under **Inställningar → Extern editering** i AVA ska det nu stå att
helpern körs.

## Använda den

Klicka **Öppna i …** på ett dokument i AVA. Dokumentet öppnas i sitt program;
när du sparar skickas ändringen till AVA (även om du är offline en stund —
den skickas när nätet är tillbaka).

## Ny version

När en ny version finns öppnar AVA Helper statusfönstret av sig själv med
**Ny version finns**. Klicka **Uppdatera nu** — appen byts ut och startar om.
(Fungerar det inte: kör samma rad i Terminal igen, steg 1.)

## Om något inte fungerar

- **AVA säger att helpern inte körs:** öppna AVA Helper via Spotlight — visar
  statusfönstret att den kör, kontrollera att du har installerat certifikatet
  (steg 2).
- **Du råkade klicka Neka:** avsluta AVA Helper ("Avsluta AVA Helper helt" i statusfönstret) och starta den igen
  — den frågar på nytt nästa gång AVA anropar den.
- **Inloggningen misslyckas:** kontakta den som administrerar AVA hos er
  (Entra-appen behöver vara konfigurerad för helpern, se
  [self-hosted-entra.md](self-hosted-entra.md#ava-helper)).
