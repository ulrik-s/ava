# Runbook: servern är borta — återställ AVA från den krypterade backupen

Använd den här när produktionsservern inte finns kvar eller inte går att lita
på längre, till exempel efter en diskkrasch, en kapad server eller en
leverantör som stängt ned. Om det bara är databasen som är fel medan servern
lever, räcker [`restore-db.sh`](./deploy-server-first.md#återställning).

Allt du behöver finns **utanför** den gamla servern:

| Vad | Var |
|---|---|
| Senaste krypterade export: en full `ava-<datum>.tar.age`, eller en timexport `ava-<datum>-hourly.tar.age` **och** dess bas (den fulla export som `backup-verify.sh` skriver ut, steg 0) | datorn som hämtar (`~/AVA-backup`), den andra backupplatsen (`AVA_BACKUP_MIRROR`), eller nedladdningsmappen hos en administratör som tagit en backup med "Ta backup nu" i Inställningar ([#1431](./deploy-server-first.md#ta-backup-nu-från-inställningar-1431)) |
| Den privata age-nyckeln `age.key` | datorn som hämtar, och byråns lösenordshanterare |
| `ava-server.env` (OIDC, domän, byrå-id) | lösenordshanteraren. Hämta annars värdena hos IdP:n och skapa filen på nytt |
| Koden | `git clone https://github.com/ulrik-s/ava` |

Räkna med ungefär en timme, plus tiden för DNS.

## 0. Provåterställ först på din egen dator (5 min)

Innan du rör en ny server: bevisa att backupen och nyckeln fungerar.

```bash
bash tooling/scripts/backup-verify.sh ~/AVA-backup/ava-<datum>.tar.age ~/.config/ava-backup/age.key
```

Är den senaste exporten en **timexport** (`ava-<datum>-hourly.tar.age`, ADR
0039) går den inte att återställa ensam: databasen finns i den, men dokumenten
finns i basens fulla arkiv plus timexportens tillägg. Basen ska ligga i samma
katalog. Provåterställ timexporten, så kontrolleras båda:

```bash
bash tooling/scripts/backup-verify.sh ~/AVA-backup/ava-<datum>-hourly.tar.age ~/.config/ava-backup/age.key
```

Skriptet skriver ut `Basen: ava-<basdatum>.tar.age`. Det är de två filerna,
timexporten och basen, som ska till servern i steg 2.

Skriv upp raden `användare · ärenden · dokument · migrationer`. Du jämför mot
den i steg 5. Misslyckas det här, prova den näst senaste exporten och kopian
på den andra backupplatsen. Använd också nyckeln ur lösenordshanteraren.

## 1. Ny server

Följ [Installation](./deploy-server-first.md#installation) på en ny maskin:
`git clone`, bygget, `ava-server.env`. **Starta inte** stacken ännu. Peka
sedan DNS-namnet på den nya servern.

## 2. Packa upp backupen på servern

Kopiera `ava-<datum>.tar.age` och `age.key` till servern, till exempel med `scp` till
`/root/restore/`. Dekryptera sedan i en engångs-container, så att hosten
fortfarande bara behöver docker:

```bash
cd /root/restore
docker run --rm -v "$PWD":/w alpine sh -c \
  'apk add -q --no-cache age && age -d -i /w/age.key /w/ava-<datum>.tar.age | tar -C /w -xf -'
sha256sum -c SHA256SUMS          # båda .gz-filerna ska ge OK
shred -u age.key 2>/dev/null || rm -f age.key   # nyckeln ska inte ligga kvar på servern
```

Nu finns `ava-<datum>.sql.gz` (databasen) och `content.tar.gz` (dokumenten).

**Timexport:** kopiera också basen, till en egen katalog `/root/restore/bas/`
(båda arkiven har en `SHA256SUMS`). Packa upp båda och kontrollera båda:

```bash
cd /root/restore
docker run --rm -v "$PWD":/w alpine sh -c \
  'apk add -q --no-cache age && age -d -i /w/age.key /w/ava-<datum>-hourly.tar.age | tar -C /w -xf - \
   && age -d -i /w/age.key /w/bas/ava-<basdatum>.tar.age | tar -C /w/bas -xf -'
sha256sum -c SHA256SUMS              # timexporten: dumpen, content-diff.tar.gz och BASE
(cd bas && sha256sum -c SHA256SUMS)  # basen: dess dump och content.tar.gz
shred -u age.key 2>/dev/null || rm -f age.key
```

Nu finns timexportens `ava-<datum>.sql.gz` (databasen, den som läses in i
steg 3), basens `bas/content.tar.gz` (dokumenten vid basen) och
`content-diff.tar.gz` (det som tillkommit sedan dess). Basens egen dump används
inte.

## 3. Databasen

Starta bara Postgres, migrera schemat och läs in dumpen:

```bash
cd /srv/ava
docker compose -f tooling/docker/docker-compose.production.yml up -d --wait postgres
AVA_RESTORE_YES=1 bash tooling/scripts/restore-db.sh /root/restore/ava-<datum>.sql.gz
```

`restore-db.sh` droppar och återskapar databasen, läser in dumpen och startar
server-first. Den väntar sedan tills `/readyz` svarar.

## 4. Dokumenten

Dokumentens bytes ligger i volymen `ava_content`. Packa upp arkivet där, med
server-first stoppad så att ingenting skriver samtidigt:

```bash
docker compose -f tooling/docker/docker-compose.production.yml stop server-first
docker run --rm -v ava_content:/content -v /root/restore:/r:ro alpine \
  tar -C /content -xzf /r/content.tar.gz
docker compose -f tooling/docker/docker-compose.production.yml up -d --wait
```

**Timexport:** packa upp basens `content.tar.gz` först och **sedan**
`content-diff.tar.gz`, i den ordningen. Tillägget innehåller de filer som
ändrats sedan basen, också `.git/index` och refs i dokumentvolymen, och de
ska skriva över basens versioner på plats:

```bash
docker compose -f tooling/docker/docker-compose.production.yml stop server-first
docker run --rm -v ava_content:/content -v /root/restore:/r:ro alpine \
  sh -c 'tar -C /content -xzf /r/bas/content.tar.gz && tar -C /content -xzf /r/content-diff.tar.gz'
docker compose -f tooling/docker/docker-compose.production.yml up -d --wait
```

Har git:s städning packat refs efter basen kan en gammal lös ref från basen
ligga kvar efter uppackningen. Det påverkar bara git-historiken, inte
dokumentfilerna (ADR 0039).

## 5. Kontrollera

- `curl -fsS https://<domän>/readyz` ska svara ok.
- Logga in som en vanlig användare. Öppna ett ärende och **öppna ett dokument**.
  Ett dokument som öppnas bevisar att databasen och dokumentvolymen hör ihop.
- Jämför antalet med raden från steg 0:
  ```bash
  docker compose -f tooling/docker/docker-compose.production.yml exec -T postgres \
    psql -U ava -d ava -tAc "SELECT (SELECT count(*) FROM users), (SELECT count(*) FROM matters), (SELECT count(*) FROM documents WHERE deleted_at IS NULL)"
  ```
- Allt som skrevs efter den senaste exporten är borta. Med timexporten (ADR
  0039) är det högst ungefär en timme. Meddela byrån vilken tidpunkt som
  gäller (exportens datum och klockslag). Vad som händer i klienterna står i
  nästa avsnitt.
- `SELECT epoch, rotated_at FROM sync_epoch` ska visa en `rotated_at` från
  återställningen. `restore-db.sh` byter epoken; har du återställt på något
  annat sätt (en volym-snapshot, `psql` för hand), kör
  `tooling/db/rotate-sync-epoch.sql` mot databasen innan server-first startas.

## 5b. Klienterna efter återställningen (#1360)

Webbläsarna har en egen kopia av datan och en synk-cursor: numret på den
senaste ändringen de hämtat från servern. Efter en återställning har servern
gått tillbaka till backupens läge, så klienternas cursor ligger *före*
servern, och nya ändringar får nummer som klienterna redan passerat. Utan
åtgärd skulle de tyst missa dem.

Därför har databasen en **synkepok** (`sync_epoch`), ett id för dess
ändringshistorik. Klienten skickar sin epok med varje hämtning. Är den en
annan än databasens, eller ligger klientens cursor före serverns, svarar
servern med **hela historiken från början** (`resync`), i sidor om 500
ändringar som klienten hämtar efter varandra. Klienten gör då så här:

1. Den skriver in serverns rader, som vid en vanlig hämtning.
2. När **alla** sidor är hämtade, och först då:
   den **tar bort lokala rader som inte finns i den återställda databasen**,
   det vill säga sådant som skrevs efter exporten och redan hade synkats.
   Så ser klienten samma sak som en ny enhet skulle göra.
3. **Kön rörs inte.** Ändringar som inte hunnit synkas (gjorda offline eller
   strax före haveriet) ligger kvar lokalt och skickas till den återställda
   servern. Nyskapade poster godtas. En ändring av en post som inte finns i
   backupen avvisas och hamnar under *Avvisade ändringar*, där användaren
   kan se den.
4. Cursorn börjar om från den nya historiken, och epoken sparas.

Ingenting behöver göras i klienterna. Be ändå användarna öppna AVA och
vänta tills synken visar *Synkat* innan de arbetar vidare, och gå igenom
*Avvisade ändringar*.

**Begränsning:** det som skrevs efter exporten, och som klienterna redan
hade synkat, tas bort även ur klienternas kopior. Servern är källan till
sanning, och en klient kan inte avgöra om en sådan rad ska tillbaka.

**Det som skrevs efter nattbackupen räddas med timexporten**, inte ur
klienterna. Återställ från den senaste timexporten och dess bas, inte från
nattens fulla export ensam: provåterställ timexporten i steg 0 (skriptet
skriver ut basen), packa upp båda i steg 2, läs in timexportens dump i steg 3
och packa upp basens dokument och sedan tillägget i steg 4. Då är det bara
det som skrevs efter den senaste timexporten, högst ungefär en timme, som
försvinner.

## 6. Backupen igen

Den nya servern har ingen backup förrän du lägger tillbaka den:

1. Lägg in nattjobbet igen som `ava-backup.service` (`backup-db.sh` och
   `backup-export.sh`), den publika nyckeln i `/srv/ava/backup-recipient.txt`
   och read-only-kontot för hämtning, enligt [Backup](./deploy-server-first.md#backup).
   Första `deploy-prod.sh` därefter installerar `.path`-enheten för "Ta backup
   nu" i Inställningar och timexportens timer (`ava-backup-hourly.timer`).
2. Ta en **full** export direkt (`systemctl start ava-backup.service`), så att
   timexporterna får en bas på den nya servern. Utan den blir nästa timexport
   en full export.
3. Uppdatera `AVA_BACKUP_HOST` hos hämtaren om adressen ändrades, och kör
   `backup-pull.sh` en gång manuellt. Den ska sluta med `✓ senaste: …` och
   utan larm. Larmar den om *ingen andra backupplats*, sätt
   `AVA_BACKUP_MIRROR` ([Andra backupplatsen](./deploy-server-first.md#andra-backupplatsen)).
   Efter nästa kvart över ska en `ava-<datum>-hourly.tar.age` ha hämtats.
4. `rm -rf /root/restore` på servern.

## Övning

Gör steg 0 till 5 mot en **testserver** en gång om året, och skriv upp hur lång
tid det tog. Återställningsövningen i CI (`restore-drill.sh`) täcker kedjan
export → dekryptering → återställning → kontroll vid varje ändring, ur en
timexport och dess bas med kommandona ovan. Den
täcker inte DNS, IdP-konfigurationen eller att någon hittar nyckeln.
