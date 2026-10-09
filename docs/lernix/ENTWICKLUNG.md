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

## Frontend-Bibliotheken (ADR 0005)

`public/vendor/` ist nicht im Repo. Nach dem Klonen oder nach Änderungen an `config/vendor.json`:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml exec app node scripts/vendor-fetch.js
```

Der Lauf prüft am Ende, ob jeder `/vendor/`-Verweis in Konfiguration, Templates und Skripten
existiert (`--check` nur prüfen). Neue externe Bibliothek: URL in `config/vendor.json`
eintragen, Verweis im Code auf `/vendor/<host>/…` setzen, Skript laufen lassen.

## Lernstand-API ausprobieren (ADR 0004)

Als Lehrkraft unter `/account/tokens` ein Token anlegen, dann:

```bash
curl -H "Authorization: Bearer tl_…" http://127.0.0.1:8075/api/v1/courses
curl -H "Authorization: Bearer tl_…" http://127.0.0.1:8075/api/v1/courses/<id>/lernstand
```

Beschreibung aller Endpunkte: `docs/lernix/openapi.yaml`.

## Schreib-API ausprobieren (ADR 0006)

Unter „Einstellungen → API-Tokens“ ein Token mit den nötigen Schreibrechten anlegen (Schreib-Scopes
sind nicht vorausgewählt). Im Dev-Stack Blöcke ggf. per `.env`/`config` freischalten.

```bash
T="Authorization: Bearer tl_…"; U=http://127.0.0.1:8075/api/v1; J="Content-Type: application/json"

# Kurs mit eigener IServ-Gruppe anlegen (Gruppen: GET $U/iserv/groups, nach dem Login gespeichert)
curl -s -H "$T" -H "$J" -X POST $U/courses -d '{"name":"Informatik 9a","courseType":"private","iservGroup":{"act":"klasse.9a"}}'

# Lektion und Aufgabe mit Python-Vorlage und Fälligkeit
curl -s -H "$T" -H "$J" -X POST $U/courses/<kurs>/lessons -d '{"name":"Schleifen"}'
curl -s -H "$T" -H "$J" -X POST $U/courses/<kurs>/lessons/<lektion>/materials   -d '{"type":"assignment","name":"Quadrat","content":"Zeichne ein Quadrat.","starter":{"lang":"python","code":"import turtle
"},"submissionsDue":"2026-10-19T07:45:00Z"}'

# ganze Reihe auf einmal
curl -s -H "$T" -H "$J" -X POST $U/courses/<kurs>/import   -d '{"lessons":[{"name":"Variablen","materials":[{"type":"page","name":"Einstieg","content":"# Variablen"}]}]}'

# Abgaben einer Aufgabe mit Code (Blöcke zusätzlich als pythonCode), eine Abgabe als Python-Text
curl -s -H "$T" "$U/courses/<kurs>/assignments/<aufgabe>/submissions?includeCode=true"
curl -s -H "$T" "$U/trinkets/<abgabe>?format=python"

# Entwurf vorbereiten (erscheint im Dashboard) oder direkt zurückgeben
curl -s -H "$T" -H "$J" -X PUT  $U/trinkets/<abgabe>/feedback-draft -d '{"comment":"Gut gelöst!"}'
curl -s -H "$T" -H "$J" -X POST $U/trinkets/<abgabe>/feedback -d '{"comment":"Gut gelöst!","allowResubmit":false}'

# Aufgabe ab Montag sichtbar, Kurs archivieren, Kurs löschen (nur mit confirm)
curl -s -H "$T" -H "$J" -X PATCH $U/courses/<kurs>/materials/<aufgabe> -d '{"availableOn":"2026-10-12T07:45:00Z"}'
curl -s -H "$T" -H "$J" -X PATCH $U/courses/<kurs> -d '{"archived":true}'
curl -s -H "$T" -X DELETE "$U/courses/<kurs>?confirm=true"
```

- Fehler kommen als `{ statusCode, error, message, details? }`; unbekannte Felder → 400.
- Jeder Schreibzugriff steht im App-Log (`API-Schreibzugriff …`), z. B.
  `docker compose logs app | grep API-Schreibzugriff`.
- Schreibbremse: 120 Schreibzugriffe je Token und Minute (`app.api.writeLimitPerMinute`), sonst 429.
- Die Umwandlung Blöcke → Python braucht `public/components/blockly` (kommt mit dem Image). Neue
  Referenzausgaben für `test/data/blocks/*.py` entstehen, indem man das XML im Editor lädt bzw. mit
  `blockly_compressed.js` + `python_compressed.js` übersetzt (`disableInitVariables_ = true`).
- Anleitung für den SchulAssistent nach Anwendungsfällen: `docs/lernix/API-SchulAssistent.md`.

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
- `test/lib/api/apiv1.js`, `test/lib/api/apiv1-write.js` – Token-API lesend/schreibend, Token-Trennung
  zwischen Lehrkräften, Rechte (Scope, fremder Kurs, SuS-Token, widerrufen), Gleichlauf mit der Oberfläche.
- `test/lib/util/blocks.js` – Blöcke → Python, zeichengleich mit dem Editor (`test/data/blocks`); wird
  übersprungen, wenn `public/components` fehlt.
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
