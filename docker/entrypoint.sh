#!/bin/sh
# Trinket Lernix – Container-Start
#
# Erzeugt config/local.yaml aus Umgebungsvariablen (siehe .env.example) und startet
# dann den eigentlichen Befehl (node app.js). Die App selbst liest nur YAML
# (node-config 0.4 kennt keine Umgebungsvariablen) – deshalb dieser Umweg.
set -eu

fail() {
  echo "FEHLER: $*" >&2
  exit 1
}

# YAML-Wert in einfachen Anführungszeichen; enthaltene ' werden verdoppelt.
q() {
  printf "'%s'" "$(printf '%s' "$1" | sed "s/'/''/g")"
}

# Wahrheitswert aus "true/false/1/0/yes/no" → true|false
bool() {
  case "$(printf '%s' "$1" | tr 'A-Z' 'a-z')" in
    1|true|yes|on) echo true ;;
    *) echo false ;;
  esac
}

NODE_ENV="${NODE_ENV:-production}"
AUTH_MODE="${AUTH_MODE:-iserv}"
PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-http://localhost:8090}"
SESSION_SECRET="${SESSION_SECRET:-}"
SITE_NAME="${SITE_NAME:-Trinket Lernix}"
TRUSTED_PROXIES="${TRUSTED_PROXIES:-127.0.0.1}"
ADMIN_IP_ALLOWLIST="${ADMIN_IP_ALLOWLIST:-127.0.0.1/32}"
MONGO_HOST="${MONGO_HOST:-mongodb}"
MONGO_PORT="${MONGO_PORT:-27017}"
MONGO_DB="${MONGO_DB:-trinket}"
MONGO_USER="${MONGO_USER:-}"
MONGO_PASSWORD="${MONGO_PASSWORD:-}"
REDIS_ENABLED="$(bool "${REDIS_ENABLED:-true}")"
REDIS_HOST="${REDIS_HOST:-redis}"
REDIS_PORT="${REDIS_PORT:-6379}"

# --- Prüfungen -----------------------------------------------------------------
[ "${#SESSION_SECRET}" -ge 32 ] || fail "SESSION_SECRET fehlt oder ist kürzer als 32 Zeichen (openssl rand -hex 32)."
case "$SESSION_SECRET" in *change-me*) fail "SESSION_SECRET ist noch der Platzhalter aus .env.example." ;; esac

case "$AUTH_MODE" in
  iserv|dev) ;;
  *) fail "AUTH_MODE muss 'iserv' oder 'dev' sein (ist: $AUTH_MODE)." ;;
esac
if [ "$NODE_ENV" = "production" ] && [ "$AUTH_MODE" = "dev" ]; then
  fail "AUTH_MODE=dev ist mit NODE_ENV=production nicht erlaubt."
fi

# PUBLIC_BASE_URL zerlegen: https://trinket.lernix.site[:port]
case "$PUBLIC_BASE_URL" in
  http://*|https://*) ;;
  *) fail "PUBLIC_BASE_URL muss mit http:// oder https:// beginnen (ist: $PUBLIC_BASE_URL)." ;;
esac
URL_PROTOCOL="${PUBLIC_BASE_URL%%://*}"
URL_REST="${PUBLIC_BASE_URL#*://}"
URL_HOSTPORT="${URL_REST%%/*}"
URL_HOST="${URL_HOSTPORT%%:*}"
URL_PORT=""
case "$URL_HOSTPORT" in *:*) URL_PORT="${URL_HOSTPORT##*:}" ;; esac
[ -n "$URL_HOST" ] || fail "PUBLIC_BASE_URL enthält keinen Hostnamen."
if [ "$NODE_ENV" = "production" ] && [ "$URL_PROTOCOL" != "https" ]; then
  fail "PUBLIC_BASE_URL muss in Produktion mit https:// beginnen."
fi
COOKIE_SECURE=false
[ "$URL_PROTOCOL" = "https" ] && COOKIE_SECURE=true

# --- config/local.yaml schreiben ------------------------------------------------
CONFIG_FILE="$(dirname "$0")/../config/local.yaml"

cat > "$CONFIG_FILE" <<EOF
# Automatisch erzeugt von docker/entrypoint.sh – nicht von Hand bearbeiten.
# Quelle ist die .env (siehe .env.example).
features:
  courses: true
  assets: false
  accessibilityToggle: false
  storeClientAddress: false
  trinkets:
    python: true
    html: true
    blocks: true
    glowscript: true
    glowscript-blocks: true
    console: false
    music: false
    python3: false
    java: false
    pygame: false
    R: false

app:
  siteName: $(q "$SITE_NAME")
  siteUrl: $(q "$PUBLIC_BASE_URL")
  hostname: 0.0.0.0
  port: 3000
  url:
    protocol: $(q "$URL_PROTOCOL")
    hostname: $(q "$URL_HOST")
    port: $(q "$URL_PORT")
  plugins:
    session:
      cookieOptions:
        password: $(q "$SESSION_SECRET")
        isSecure: $COOKIE_SECURE
        domain: ''
  embed:
    skulpt:
      local: true   # Skulpt aus public/components statt vom (nicht vorhandenen) CDN
      min: true
  retention:
    enabled: $(bool "${RETENTION_ENABLED:-true}")
    schoolYearEnd: $(q "${RETENTION_SCHOOL_YEAR_END:-07-31}")
    trashDays: ${RETENTION_TRASH_DAYS:-30}
  trustedProxies: $(q "$TRUSTED_PROXIES")
  adminIpAllowlist: $(q "$ADMIN_IP_ALLOWLIST")
  auth:
    mode: $(q "$AUTH_MODE")
    requireLogin: $(bool "${REQUIRE_LOGIN:-true}")
    iserv:
      issuer: $(q "${ISERV_ISSUER:-}")
      clientID: $(q "${ISERV_CLIENT_ID:-}")
      clientSecret: $(q "${ISERV_CLIENT_SECRET:-}")
      teacherMarkers: $(q "${ISERV_TEACHER_MARKERS:-lehrer,teacher,kollegium}")
    breakglass:
      email: $(q "${BREAKGLASS_EMAIL:-}")
      password: $(q "${BREAKGLASS_PASSWORD:-}")
    google:
      clientID: ''
      clientSecret: ''
      callbackURL: ''
  mail:
    from: ''
    host: ''
    user: ''
    pass: ''
  recaptcha:
    sitekey: ''
    secretkey: ''

db:
  mongo:
    host: $(q "$MONGO_HOST")
    port: $MONGO_PORT
    database: $(q "$MONGO_DB")
    user: $(q "$MONGO_USER")
    pass: $(q "$MONGO_PASSWORD")
  redis:
    enabled: $REDIS_ENABLED
    app:
      host: $(q "$REDIS_HOST")
      port: $REDIS_PORT
      pass: ''
    exports:
      host: $(q "$REDIS_HOST")
      port: $REDIS_PORT
EOF

echo "[entrypoint] Konfiguration erzeugt: NODE_ENV=$NODE_ENV AUTH_MODE=$AUTH_MODE URL=$PUBLIC_BASE_URL Mongo=$MONGO_HOST/$MONGO_DB Redis=$REDIS_ENABLED"

exec "$@"
