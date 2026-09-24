# Installera AVA Helper (Mac)

AVA Helper är en liten app i menyraden som gör att du kan öppna dokument från
AVA direkt i Word, Förhandsvisning m.fl. — och att det du sparar hamnar i AVA
igen. Du installerar den en gång.

## 1. Ladda ner och installera

1. Ladda ner senaste **AVA-Helper-…​.dmg** under
   [releaser som heter `helper-v…`](https://github.com/ulrik-s/ava/releases?q=helper-v&expanded=true).
2. Öppna dmg-filen och dra **AVA Helper** till **Program**.

## 2. Öppna appen första gången

Appen är ännu inte signerad hos Apple, så macOS stoppar den första gången:

1. Dubbelklicka på **AVA Helper** i Program. macOS säger att den inte kan
   öppnas — klicka **Klar**.
2. Öppna **Systeminställningar → Integritet och säkerhet**, scrolla ner och
   klicka **Öppna ändå** vid AVA Helper. Bekräfta med ditt lösenord.

Det behövs bara första gången. Appen syns sedan som en ikon i menyraden (uppe
till höger) och startar av sig själv när du loggar in på datorn.

## 3. Certifikat för Safari

Första gången frågar AVA Helper om den får **installera ett certifikat för
Safari**. Klicka **Installera** och bekräfta med ditt lösenord.

Certifikatet gäller bara din egen dator (`localhost`) och behövs för att AVA i
Safari ska få prata med helpern. Klickade du *Inte nu* finns valet kvar i
menyn: **Installera certifikat för Safari…**

## 4. Koppla till AVA

1. Öppna AVA i Safari (t.ex. https://ava-crm.io) och logga in som vanligt.
2. AVA Helper frågar **"ava-crm.io vill använda AVA Helper"** — klicka
   **Tillåt**. (Tillåt bara din byrås egen AVA-adress.)
3. Klicka på helper-ikonen i menyraden → **Logga in…** och logga in med ditt
   vanliga Microsoft-konto i webbläsaren som öppnas.

Klart. Under **Inställningar → AVA Helper** i AVA ska det nu stå att helpern
körs.

## Använda den

Klicka **Öppna i …** på ett dokument i AVA. Dokumentet öppnas i sitt program;
när du sparar skickas ändringen till AVA (även om du är offline en stund —
den skickas när nätet är tillbaka).

## Ny version

När en ny version finns står det **Ny version finns — ladda ner** i
helperns meny. Ladda ner och ersätt appen i Program på samma sätt som ovan.

## Om något inte fungerar

- **AVA säger att helpern inte körs:** kolla att ikonen finns i menyraden
  (annars starta AVA Helper från Program), och att du har installerat
  certifikatet (steg 3).
- **Du råkade klicka Neka:** avsluta AVA Helper i menyn och starta den igen
  — den frågar på nytt nästa gång AVA anropar den.
- **Inloggningen misslyckas:** kontakta den som administrerar AVA hos er
  (Entra-appen behöver vara konfigurerad för helpern, se
  [self-hosted-entra.md](self-hosted-entra.md#ava-helper)).
