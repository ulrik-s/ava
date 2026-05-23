#!/usr/bin/env bash
# Entrypoint för git-ssh-containern.
#
# Kopierar authorized_keys från mount:ad /keys/-volym → /srv/git/.ssh/
# (måste vara ägd av git, mode 600). Skapar bara om filen finns.
# Startar sshd i foreground så containern lever så länge sshd körs.

set -euo pipefail

# Säkerställ att /srv/git/.ssh + default-repo finns (volym-mount nollställer)
mkdir -p /srv/git/.ssh
chown -R git:git /srv/git
chmod 700 /srv/git/.ssh

if [[ ! -d /srv/git/firma.git ]]; then
  echo "[git-ssh] Skapar default-repo /srv/git/firma.git…"
  # git:s shell är git-shell (bara git-kommandon tillåtna) — använd -s /bin/sh
  # för administrativa kommandon som git init.
  su -s /bin/sh git -c "HOME=/srv/git git init --bare /srv/git/firma.git"
fi

if [[ -f /keys/authorized_keys ]]; then
  cp /keys/authorized_keys /srv/git/.ssh/authorized_keys
  chown git:git /srv/git/.ssh/authorized_keys
  chmod 600 /srv/git/.ssh/authorized_keys
  KEY_COUNT=$(wc -l < /srv/git/.ssh/authorized_keys | tr -d ' ')
  echo "[git-ssh] $KEY_COUNT nyckel(ar) registrerade i authorized_keys"
else
  echo "[git-ssh] VARNING: /keys/authorized_keys saknas — ingen kan logga in!"
  echo "[git-ssh] Lägg dina publika SSH-nycklar i ./docker/git-ssh/authorized_keys"
fi

echo "[git-ssh] Repos under /srv/git/:"
ls -la /srv/git/ | grep -v "^total\|\.ssh"
echo "[git-ssh] Startar sshd på port 22…"
exec /usr/sbin/sshd -D -e
