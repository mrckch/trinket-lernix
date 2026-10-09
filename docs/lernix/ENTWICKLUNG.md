# Entwicklung und Tests

## Dev-Stack starten

```bash
cp .env.example .env            # einmalig; für Entwicklung: NODE_ENV=development, AUTH_MODE=dev, APP_BIND=127.0.0.1
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build
```

- App: `http://127.0.0.1:<APP_PORT>` (Default 8090). Quellcode ist gemountet; Templates und
  Frontend-JS wirken sofort, Node-Code nach `docker compose … restart app`.
- Test-Anmeldung ohne IServ: `/auth/dev` (E-Mail, Name, Rolle `student|teacher|admin`).
- Nach `npm install` im Container (`docker compose … exec app npm install --legacy-peer-deps <paket>`)
  ändern sich `package.json`/`package-lock.json` im Repo; für Produktion das Image neu bauen.

## Lernstand-API ausprobieren (ADR 0004)

Als Lehrkraft unter `/account/tokens` ein Token anlegen, dann:

```bash
curl -H "Authorization: Bearer tl_…" http://127.0.0.1:8075/api/v1/courses
curl -H "Authorization: Bearer tl_…" http://127.0.0.1:8075/api/v1/courses/<id>/lernstand
```

Beschreibung aller Endpunkte: `docs/lernix/openapi.yaml`.

## Wartungslauf (Aufbewahrung, ADR 0003)

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml exec app node scripts/maintenance.js --dry-run
```

Im Dev-Stack läuft der Dienst `maintenance` nicht automatisch (Profil `maintenance`), in
Produktion täglich. Der Probelauf zeigt, was archiviert, in den Papierkorb gelegt und gelöscht würde.

## Tests

Die Suite (mocha 3, chai 3, sinon 17, supertest) braucht ein **MongoDB ohne Authentifizierung**
unter `localhost:27017` und lädt `config/test.yaml` (Datenbank `test` wird geleert!). Sie läuft
in einem Wegwerf-Container, der sich das Netz einer Test-Datenbank teilt – so bleibt die Dev-DB
unberührt und `config/local.yaml` außen vor (`NODE_CONFIG_DIR`).

```bash
# einmalig: Test-Datenbank (im Compose-Netz, ohne Auth)
docker run -d --name trinket-testdb --network trinketdev_internal mongo:7

# Suite ausführen (unter Git-Bash: MSYS_NO_PATHCONV=1 voranstellen)
docker run --rm --network container:trinket-testdb --volumes-from trinketdev-app \
  -w /usr/local/node/trinket -e NODE_ENV=test -e NODE_CONFIG_DIR=/tmp/cfg \
  -e NODE_CONFIG_PERSIST_ON_CHANGE=N --entrypoint sh trinket-lernix/app:latest \
  -c "mkdir -p /tmp/cfg && cp config/default.yaml config/test.yaml /tmp/cfg/ && node_modules/.bin/mocha"
```

`trinketdev-app` ist der Container-Name des Dev-Stacks (`COMPOSE_PROJECT_NAME=trinketdev`),
`trinketdev_internal` sein Netz.

### Was die Suite abdeckt und was bewusst übersprungen ist

- `test/lib/api/auth.js` – Dev-Login, Rollen `student`/`teacher`/`admin`, Sperren im
  IServ-Modus, Notfall-Admin, Admin-IP-Allowlist, `X-Forwarded-For` nur vom NPM.
- `test/lib/util/iserv.js` – Claim-Auswertung (UUID, Lehrkraft-Marker, Gruppen), CIDR-Prüfung.
- Übersprungen (`describe.skip`/`it.skip`, je mit Begründung im Code): Abo-Rollen aus trinket.io,
  Mail-Funktionen (Mail ist aus), Datei-Upload (S3 aus), Beispielkurs-Fixture, einige Kurs-Tests mit
  veralteter Antwortform – letztere werden in Phase 3 beim API-Ausbau neu geschrieben.

### Stolpersteine

- `test/setup.js` muss vor allen anderen Dateien laden (`--require` in `test/mocha.opts`), damit
  Hapi/Joi vor `mongoose-schema-extend` initialisiert werden – sonst „Schema can only contain
  plain objects“.
- Das globale `User` ist der Wrapper aus `lib/models/model.js` (nur `findById` + Klassenmethoden).
  Für `findOne`/`deleteMany` das rohe Modell nehmen: `require('mongoose').model('User')`.
- `app.js` ruft bei `app.start: false` `server.initialize()` auf; ohne das ist der Session-Cache
  „Disconnected“ und jede Anfrage endet mit 500.
- Joi 17 `.email()` lehnt Testdomains wie `.test` ab – in Tests `.de`-Adressen verwenden.
