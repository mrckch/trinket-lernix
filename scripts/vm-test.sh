#!/bin/sh
# Testsuite des lokalen Arbeitsstands auf der Docker-VM ausführen (ohne Docker Desktop).
# Kopiert app.js, lib, test, config, serverside und public/js in einen Wegwerf-Ordner auf der VM,
# startet ein MongoDB ohne Auth in einem eigenen Netz und hängt die Dateien in einen Container
# aus dem Produktions-Image (Abhängigkeiten, public/components) ein. Produktion bleibt unberührt.
#
#   sh scripts/vm-test.sh                 # Ziel root@dockervm2-zuhause
#   VM=root@andere-vm SUFFIX=-api sh scripts/vm-test.sh   # eigener Namenszusatz für parallele Läufe
set -e
VM="${VM:-root@dockervm2-zuhause}"
SUFFIX="${SUFFIX:-}"
IMAGE="${IMAGE:-trinket-lernix/app:latest}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

cd "$ROOT"
TMP="$(mktemp -d)"
tar czf "$TMP/src.tgz" app.js lib test config serverside public/js
scp -q "$TMP/src.tgz" "$VM:/root/trinket-testsrc$SUFFIX.tgz"
rm -rf "$TMP"

ssh -o BatchMode=yes "$VM" "SUFFIX='$SUFFIX' IMAGE='$IMAGE' sh -s" <<'REMOTE'
set -e
S=/root/trinket-testsrc$SUFFIX; T=/usr/local/node/trinket; N=trinket-test$SUFFIX; DB=trinket-testdb$SUFFIX
LOG=/root/trinket-testrun$SUFFIX.log
rm -rf "$S" && mkdir "$S" && tar xzf "$S.tgz" -C "$S" && rm "$S.tgz"
rm -f "$S/config/local.yaml"
docker rm -f "$DB" >/dev/null 2>&1 || true
docker network rm "$N" >/dev/null 2>&1 || true
docker network create "$N" >/dev/null
docker run -d --name "$DB" --network "$N" mongo:7 >/dev/null
sleep 8
RC=0
docker run --rm --network "container:$DB" \
  -v "$S/app.js:$T/app.js:ro" -v "$S/lib:$T/lib:ro" -v "$S/test:$T/test:ro" -v "$S/config:$T/config:ro" \
  -v "$S/serverside:$T/serverside:ro" -v "$S/public/js:$T/public/js:ro" \
  -w "$T" -e NODE_ENV=test -e NODE_CONFIG_DIR=/tmp/cfg -e NODE_CONFIG_PERSIST_ON_CHANGE=N \
  --entrypoint sh "$IMAGE" \
  -c "mkdir -p /tmp/cfg && cp config/default.yaml config/test.yaml /tmp/cfg/ && node_modules/.bin/mocha" > "$LOG" 2>&1 || RC=$?
docker rm -f "$DB" >/dev/null; docker network rm "$N" >/dev/null; rm -rf "$S"
grep -E "passing|failing|pending" "$LOG"
[ "$RC" = 0 ] || { sed -n "/failing/,\$p" "$LOG" | head -60; exit "$RC"; }
REMOTE
