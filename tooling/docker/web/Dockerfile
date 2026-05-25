# AVA web-server (Tier 3) — static web-app + smart-HTTP git endpoint.
#
# nginx servar dels den statiska web-app:n under /ava/, dels git över
# smart-HTTP under /git/ via git-http-backend (CGI körd av fcgiwrap).
#
# Smart-HTTP-endpointen finns för att browser-klienten (isomorphic-git)
# ska kunna klona/pusha mot SAMMA bare-repo som sshd-servicen exponerar —
# utan SSH (browsern kan inte öppna en TCP-socket) och utan CORS-proxy
# (samma origin som /ava/). Detta är vägen som lokala round-trip-tester
# och self-hosted byråer utan GitHub använder.
FROM nginx:1.27-alpine

# git         — git CLI (init/config av bare-repos)
# git-daemon  — innehåller git-http-backend (CGI) i /usr/libexec/git-core/
#               (ingår INTE i alpines bas-git-paket)
# fcgiwrap    — kör CGI-scriptet som FastCGI så nginx kan prata med det
# spawn-fcgi  — startar fcgiwrap på en unix-socket
# apache2-utils — ger oss `htpasswd`-binären för auth-administration
# (admin SSH:ar in och kör `htpasswd /auth-data/htpasswd <user>`)
# openssl    — för att slumpa initial admin-PAT vid första uppstart
RUN apk add --no-cache git git-daemon fcgiwrap spawn-fcgi apache2-utils openssl

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

CMD ["/entrypoint.sh"]
