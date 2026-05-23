# git-ssh: minimal Tier 3 backend

En SSH-server som hostar bare git-repos. Klienten (browser-AVA) pushar/pullar
mot detta för att synka data. Inget annat — ingen databas, ingen LLM,
ingen text-extraktion. All logik körs i klienten.

## Setup

1. **Lägg din publika SSH-nyckel** i `docker/git-ssh/authorized_keys`:

   ```bash
   cat ~/.ssh/id_ed25519.pub >> docker/git-ssh/authorized_keys
   ```

   (Eller flera rader — en nyckel per användare.)

2. **Starta stacken**:

   ```bash
   docker compose up -d --build
   ```

3. **Testa SSH-anslutningen från host**:

   ```bash
   ssh -p 2222 git@localhost
   # Förväntat svar: "fatal: Interactive git shell is not enabled."
   # Det är OK — `git-shell` tillåter bara git-kommandon.
   ```

4. **Klona repo:t**:

   ```bash
   git clone ssh://git@localhost:2222/srv/git/firma.git
   cd firma
   echo "test" > test.txt
   git add . && git commit -m "init" && git push
   ```

## Konfiguration

- **Port**: 2222 på host (mappar till 22 i container)
- **Default repo**: `firma.git` (skapas vid build)
- **User**: `git` med `git-shell` som login → bara git-kommandon, ingen interaktiv shell
- **Auth**: ed25519 public keys i `authorized_keys`

## Lägga till fler repos

```bash
docker compose exec git-ssh su git -c "git init --bare /srv/git/<namn>.git"
```

## Reset

```bash
docker compose down -v   # tar bort persistent storage
```
