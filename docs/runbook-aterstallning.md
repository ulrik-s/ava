# Runbook: servern är borta — återställ AVA från den krypterade backupen

Använd den här när produktionsservern inte finns kvar eller inte går att lita
på längre, till exempel efter en diskkrasch, en kapad server eller en
leverantör som stängt ned. Om det bara är databasen som är fel medan servern
lever, räcker [`restore-db.sh`](./deploy-server-first.md#återställning).

Allt du behöver finns **utanför** den gamla servern:

| Vad | Var |
|---|---|
| Senaste krypterade export `ava-<datum>.tar.age` | datorn som hämtar (`~/AVA-backup`) eller den andra backupplatsen (`AVA_BACKUP_MIRROR`) |
| Den privata age-nyckeln `age.key` | datorn som hämtar, och byråns lösenordshanterare |
| `ava-server.env` (OIDC, domän, byrå-id) | lösenordshanteraren. Hämta annars värdena hos IdP:n och skapa filen på nytt |
| Koden | `git clone https://github.com/ulrik-s/ava` |

Räkna med ungefär en timme, plus tiden för DNS.

## 0. Provåterställ först på din egen dator (5 min)

Innan du rör en ny server: bevisa att backupen och nyckeln fungerar.

```bash
bash tooling/scripts/backup-verify.sh ~/AVA-backup/ava-<datum>.tar.age ~/.config/ava-backup/age.key
```

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

## 5. Kontrollera

- `curl -fsS https://<domän>/readyz` ska svara ok.
- Logga in som en vanlig användare. Öppna ett ärende och **öppna ett dokument**.
  Ett dokument som öppnas bevisar att databasen och dokumentvolymen hör ihop.
- Jämför antalet med raden från steg 0:
  ```bash
  docker compose -f tooling/docker/docker-compose.production.yml exec -T postgres \
    psql -U ava -d ava -tAc "SELECT (SELECT count(*) FROM users), (SELECT count(*) FROM matters), (SELECT count(*) FROM documents WHERE deleted_at IS NULL)"
  ```
- Allt som skrevs efter exporten är borta. Meddela byrån vilken tidpunkt som
  gäller (exportens datum och klockslag). Klienter som var offline har
  eventuellt osynkade ändringar lokalt, och de synkas när klienterna kommer
  online mot den nya servern.

## 6. Backupen igen

Den nya servern har ingen backup förrän du lägger tillbaka den:

1. Lägg in nattjobben igen (`backup-db.sh` och `backup-export.sh`) och
   read-only-kontot för hämtning, enligt [Backup](./deploy-server-first.md#backup).
2. Uppdatera `AVA_BACKUP_HOST` hos hämtaren om adressen ändrades, och kör
   `backup-pull.sh` en gång manuellt.
3. `rm -rf /root/restore` på servern.

## Övning

Gör steg 0 till 5 mot en **testserver** en gång om året, och skriv upp hur lång
tid det tog. Återställningsövningen i CI (`restore-drill.sh`) täcker kedjan
export → dekryptering → återställning → kontroll vid varje ändring. Den
täcker inte DNS, IdP-konfigurationen eller att någon hittar nyckeln.
