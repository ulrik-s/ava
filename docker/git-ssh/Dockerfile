# Minimal SSH-only git-server (Tier 3 backend).
#
# Endast en sak: en `git`-user med `git-shell` som login, bare repos
# under /srv/git/, och sshd som lyssnar på 22. Auth = ed25519 public
# keys i /srv/git/.ssh/authorized_keys.
#
# Push/pull från klienten:
#   git remote set-url origin git@<host>:firma.git
#   git push origin main
FROM alpine:3.19

RUN apk add --no-cache openssh-server git bash \
    && ssh-keygen -A \
    && adduser -D -s /usr/bin/git-shell -h /srv/git git \
    && mkdir -p /srv/git/.ssh \
    && chown -R git:git /srv/git \
    && chmod 700 /srv/git/.ssh

# Lås sshd: bara public-key-auth, ingen root-login, ingen password-auth.
RUN sed -i 's/#PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config \
    && sed -i 's/#PermitRootLogin prohibit-password/PermitRootLogin no/' /etc/ssh/sshd_config \
    && sed -i 's/#PubkeyAuthentication yes/PubkeyAuthentication yes/' /etc/ssh/sshd_config \
    && echo "AllowUsers git" >> /etc/ssh/sshd_config

# Notera: default-repo /srv/git/firma.git skapas av entrypoint.sh vid
# första uppstart. Det går inte att skapa här eftersom (a) git-user:n har
# git-shell som ej tillåter generella kommandon, och (b) volym-mount:n vid
# `docker compose up` lägger sig ändå över /srv/git så lager-baked filer
# försvinner.

# Entrypoint: kopiera authorized_keys från mount → sätt rätt rättigheter
# → skapa default-repo → starta sshd i foreground.
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 22
CMD ["/entrypoint.sh"]
