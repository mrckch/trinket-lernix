# Trinket Lernix – Umbauplan

Stand: 2026-10-09 · Status: **freigegeben** (Marc, 2026-10-09)

Fork von `trinketapp/trinket-oss` (CC0) für den Informatikunterricht unter
`https://trinket.lernix.site`. Dieses Dokument folgt dem 6-Schritte-Prozess aus
`C:\Coding\ADR-homelab-Apps\CLAUDE.md` (Analyse → Risiken → Bibliotheken →
Rückfragen → Umsetzungsplan → Implementierung).

## 1. Analyse: Was der Fork schon mitbringt

| Wunsch | Vorhanden in trinket-oss | Wo |
|---|---|---|
| Gruppenverwaltung | Ja – `Course` ist eine Lerngruppe mit Rollen `course-owner / course-admin / course-collaborator / course-student`, Beitritt per Access-Code oder Einladung, Archivieren, Kopieren | `lib/models/course.js`, `lib/controllers/course.js` |
| Aufgaben/Übungen für SuS | Ja – Material vom Typ `assignment` mit Fälligkeit, Cutoff, Sichtbar-ab, Verstecken-nach; pro SuS ein eigenes Trinket mit `submissionState` (started, modified, submitted, completed) | `lib/models/material.js`, `lib/models/trinket.js` |
| Lehrerdashboard | Ja – Matrix SuS × Aufgabe, Abgaben je Aufgabe und je SuS, Feedback-Kommentare, Abgabe akzeptieren | `GET /api/courses/{id}/dashboard`, `…/submissions` |
| API | Ja – ca. 130 REST-Routen, aber nur per Session-Cookie | `config/api_routes.js` |
| Lernstand per API | Daten vorhanden, Zugriff nur mit Cookie | s. o. |
| Login | Lokal + Google-OAuth (handgeschrieben, kein Passport) | `lib/controllers/auth.js` |
| Python | Skulpt im Browser, ohne weitere Dienste | `public/components` (Release-Tarball) |

**Fehlt:** IServ-Login, Rollen Lehrkraft/SuS aus IServ, Token-Auth für die API,
Produktions-Compose hinter dem NPM, deutsche Oberfläche, Abschaltung von
Selbstregistrierung/Google/Mail.

Stack: Node (Dockerfile: 16, README: 18+), Hapi 20, Mongoose 6 auf MongoDB 5,
Redis optional, AngularJS 1.3 + Nunjucks, Konfiguration per YAML (`config/`).

## 2. Risiken

1. **Alter Stack.** Node 16 und AngularJS 1.3 sind End-of-Life. Für ein
   schulinternes Werkzeug hinter dem NPM tragbar; Node wird auf 20 LTS gehoben,
   AngularJS bleibt (Neuschreiben des Frontends ist kein Ziel).
2. **Konfiguration nur per YAML.** Die Standards verlangen `.env`. Die genutzte
   `config`-Bibliothek (0.4.x) kann keine Umgebungsvariablen lesen. Lösung: ein
   Entrypoint-Skript erzeugt `config/production.yaml` aus der `.env`
   (kein Secret im Image, keine Datei im Repo).
3. **Session-Cookie hinter Proxy.** Trinket setzt `isSecure` und `domain` aus der
   YAML, nicht aus `X-Forwarded-Proto`. Muss fest auf `isSecure: true`,
   `domain: ''`, `SameSite=Lax` (OIDC-Rücksprung) stehen.
4. **Frontend-Komponenten aus GitHub-Release.** Der Dockerfile lädt
   `public-components.tgz` von `trinketapp/trinket-oss` Release v1.1.0. Wenn das
   Release verschwindet, baut das Image nicht mehr. Tarball einmal ins eigene
   Release spiegeln.
5. **Skulpt-Fork.** Python-Ausführung hängt an `trinketapp/skulpt-dist`. Bugs
   dort sind nur mit eigenem Fork behebbar. Akzeptiert.
6. **Datenschutz.** SuS-Code, Abgaben, Kommentare und Interaktions-Log
   (`Interaction` speichert IP-Adresse und Referer) sind personenbezogen.
   IP-Speicherung abschalten, Aufbewahrung je Schuljahr festlegen (Std 15).
7. **Keine Selbstregistrierung.** `/signup`, `POST /users`, Google-Routen und
   Passwort-Reset abschalten, sonst entstehen Konten an IServ vorbei.

## 3. Bibliotheken

| Zweck | Wahl | Begründung |
|---|---|---|
| OIDC-Client | `openid-client` (Node) | Discovery, PKCE, JWKS-Prüfung, UserInfo – deckt alle IServ-Eigenheiten aus `HTML_Share/app/services/oidc.py` ab. Kein Passport nötig (Google-Flow ist schon manuell). |
| API-Token | eigene Hapi-Auth-Strategie `bearer`, Hash mit `crypto.scrypt` | Muster aus Glossar ADR-0004 (Scopes ∩ Rolle), keine zusätzliche Abhängigkeit |
| Break-Glass-Admin | vorhandener lokaler Login (`bcrypt`), nur ein Konto, IP-Allowlist | wie LeFo ADR 0003 |
| Backup | `mongo:5` Image mit täglichem `mongodump` | gleiches Muster wie `db-backup` in LeFo/HTML_Share |

## 4. Entscheidungen (aus dem Gespräch)

- **Nur Skulpt.** Kein `serverside/`-Stack, keine Python3/Java/R/Pygame-Container.
  Feature-Flags entsprechend.
- **SuS dürfen eigene Trinkets anlegen** (Rolle `student` behält
  `create-python-trinket`, `create-html-trinket`, verliert Kursanlage).
- **Reverse-Proxy = bestehender NPM** (VM 192.168.1.20) → Docker-VM
  (192.168.1.41) auf `APP_PORT`. Kein eigenes TLS, kein Caddy/nginx im Stack.
- **Login ausschließlich IServ** (Issuer `https://rsstu.de`), eigener SSO-Client
  „Trinket“, Scopes `openid profile email iserv:uuid iserv:groups iserv:roles`,
  Lehrkraft-Erkennung über `ISERV_TEACHER_MARKERS` (Rollen **und** Gruppen),
  alle anderen sind SuS – wie in Learning-Apps.

## 5. Zielarchitektur

```
Browser ─HTTPS─▶ NPM (192.168.1.20) ─HTTP─▶ Docker-VM:APP_PORT ─▶ app (Hapi :3000)
                                                                 ├─▶ mongodb (intern)
                                                                 ├─▶ redis   (intern)
                                                                 └─▶ db-backup (mongodump täglich)
IServ (rsstu.de) ◀─OIDC─ app
```

`.env` (Vorlage `.env.example`):

```
COMPOSE_PROJECT_NAME=trinket
APP_PORT=8090                 # Port am Docker-Host, auf den der NPM zeigt
APP_BIND=0.0.0.0
TRUSTED_PROXIES=192.168.1.20  # NPM-VM
PUBLIC_BASE_URL=https://trinket.lernix.site
SESSION_SECRET=               # openssl rand -hex 32
AUTH_MODE=iserv               # iserv | dev
ISERV_ISSUER=https://rsstu.de
ISERV_CLIENT_ID=
ISERV_CLIENT_SECRET=
ISERV_TEACHER_MARKERS=lehrer,teacher,kollegium
BREAKGLASS_EMAIL=
BREAKGLASS_PASSWORD=          # nur beim ersten Start ausgewertet
ADMIN_IP_ALLOWLIST=192.168.1.0/24
MONGO_ROOT_PASSWORD=
SITE_NAME=Trinket Lernix
```

NPM-Proxy-Host: `trinket.lernix.site` → `http://192.168.1.41:8090`,
Block Common Exploits, Force SSL, HTTP/2, Websockets nicht nötig.
IServ-Redirect-URI: `https://trinket.lernix.site/auth/iserv/callback`.

## 6. Rollenmodell

| Site-Rolle | Woher | Darf |
|---|---|---|
| `student` | IServ, nicht als Lehrkraft erkannt | eigene Trinkets (Python, HTML), Kursen beitreten, Aufgaben bearbeiten/abgeben |
| `teacher` | IServ, Marker in Rollen/Gruppen | zusätzlich Kurse anlegen, Aufgaben stellen, Dashboard, API-Token |
| `admin` | nur durch Admin in der App vergeben (nie aus IServ) | zusätzlich `/admin`, Nutzerverwaltung |
| Break-Glass | `.env`, lokales Passwort, nur aus `ADMIN_IP_ALLOWLIST` | wie `admin`, nur für Notfälle |

Kursrollen bleiben wie in trinket-oss. Rollen werden bei **jedem** Login aus
IServ neu bestimmt (Wechsel SuS → Lehrkraft greift sofort); `admin` bleibt.

## 7. Umsetzungsplan

### Phase 0 – Fork und Basis (½ Tag) — **erledigt 2026-10-09**

Ergebnis: Fork `mrckch/trinket-lernix` (Remote `origin`, Upstream `upstream`),
Image auf Node 20, Compose nach Lernix-Muster, `.env.example`, Entrypoint,
`/healthz`, ADR 0001. Lokaler Testlauf mit `docker-compose.dev.yml`: Registrierung,
Login, Kurs per API, Skulpt führt Python im Browser aus.

Befunde aus dem Testlauf (Folgearbeit in den Phasen 1 und 4):
- Skulpt wurde per Default vom AWS-Platzhalter-CDN geladen; `app.embed.skulpt.local: true`
  im Entrypoint behebt das. Weitere `aws.*`-Hosts bleiben Platzhalter, da `features.assets=false`.
- Viele Frontend-Bibliotheken (AngularJS, jQuery, Foundation-Addons, MathJax, socket.io)
  kommen von cdnjs/googleapis. Für den Schulbetrieb mit SuS-Daten nach Std 8 selbst
  hosten → Phase 4.
- Upstream-Fehler: Nach fehlgeschlagener Registrierung leitet `POST /users` auf das
  nicht existierende `/sign-up`. Entfällt, weil die Registrierung in Phase 1 abgeschaltet wird.
- Joi 17 `.email()` lehnt Testdomains wie `.test` ab; beim Anlegen von IServ-Konten
  (Phase 1) die Validierung der Route nicht wiederverwenden.
- Compose: `ports` in Override-Dateien werden angehängt, nicht ersetzt. Dev-Port kommt
  deshalb aus der Basis-Datei mit `APP_BIND=127.0.0.1`.
- Port 8070 ist auf der Docker-VM vom Glossar belegt → Produktion auf **8090**.

Ursprünglicher Umfang:
- GitHub: `mrckch/trinket-lernix` als Fork, Upstream als `upstream`-Remote.
- `docs/lernix/` mit diesem Plan, ADR-Ordner `docs/lernix/adr/`.
- Dockerfile auf `node:20-bookworm-slim`, `public-components.tgz` ins eigene
  Release spiegeln.
- `docker-compose.yml` nach Lernix-Muster (ein Port, `internal`-Netz, Backup),
  `.env.example`, Entrypoint erzeugt `config/production.yaml`.
- Lokaler Start mit `AUTH_MODE=dev` prüfen (Build, Skulpt läuft, Kurs anlegen).

### Phase 1 – IServ-Login (1 Tag) — **erledigt 2026-10-09** (ADR 0002)

Ergebnis: `lib/auth/iserv.js` (openid-client 5: Discovery, PKCE, JWKS, UserInfo, Claim-Aliase),
`lib/auth/accounts.js` (Konto-Upsert über `iserv.uuid`, Site-Rollen `student`/`teacher`/`admin`,
Dev-Login, Notfall-Admin), `lib/util/clientIp.js` (TRUSTED_PROXIES, ADMIN_IP_ALLOWLIST),
Routen `/auth/iserv`, `/auth/iserv/callback`, `/auth/dev`; Registrierung, Google und lokaler
Login im IServ-Modus abgeschaltet; Kursanlage nur mit `create-*-course`. Testsuite repariert
(siehe `ENTWICKLUNG.md`): 114 grün, 41 bewusst übersprungen.

Offen für spätere Phasen:
- Echter Login gegen `rsstu.de` ist erst mit dem IServ-Client testbar (Phase 5, Betrieb).
- SuS sehen noch den Button „New Course“ und die Seite `/courses/new` (Absenden liefert 403) → Phase 4.
- Anonyme Besucher können weiterhin Trinkets anlegen (trinket.io-Verhalten); für den
  Schulbetrieb Login erzwingen? → Entscheidung in Phase 4.
- Session-Cookie: Upstream hängt `SameSite=None; Secure` an (für Einbettung in fremde Seiten);
  für den OIDC-Rücksprung reicht `Lax`. Beim Betrieb hinter dem NPM prüfen.

Ursprünglicher Umfang:
- `lib/auth/iserv.js`: Discovery, PKCE, Code-Tausch, JWKS-Prüfung, UserInfo,
  Claim-Aliase (`groups`/`iserv:groups`/…), Kennung = `iserv:uuid`.
- Routen `GET /auth/iserv`, `GET /auth/iserv/callback`; Login-Seite zeigt nur
  noch „Mit IServ anmelden“ (+ Notfallzugang hinter IP-Allowlist).
- User-Schema: `profiles.iserv.uuid` (unique), `source: 'iserv'`.
  Username aus IServ-Account, Anzeigename aus `given_name family_name`.
- `lib/models/roles.js`: Rollen `student`, `teacher`, `admin` wie oben.
- Abschalten: `/signup`, `POST /users`, Google, Passwort-Reset, Mail-Versand.
- Tests: Nicht-Lehrkraft bekommt `student`; manipulierter `Host`-Header
  ändert die Redirect-URI nicht; `AUTH_MODE=dev` startet nicht mit `production`.

### Phase 2 – Gruppen aus IServ (½–1 Tag) — **erledigt 2026-10-09** (ADR 0003)

Ergebnis: `lib/auth/groups.js` (Session-Gruppen, Zuordnung beim Login, `joinedVia`),
Kursfeld `externalLink` mit Name, Auswahl im Formular „Kurs anlegen“, API
`GET /api/iserv/groups` und `PUT /api/courses/{id}/iserv-group`; Aufbewahrung in
`lib/util/retention.js` + `scripts/maintenance.js` (Compose-Dienst `maintenance`);
Interaktions-Log ohne IP/Referer. Tests: 131 grün.

Offen für Phase 4: Verknüpfung im Kurs-Editor anzeigen und ändern (AngularJS, Nutzer-Tab).

Ursprünglicher Umfang:
- Kurs bekommt `externalLink.source = 'iserv'`, `sourceId = <Gruppenname>`.
- Lehrkraft wählt beim Anlegen eines Kurses eine ihrer IServ-Gruppen (Claims
  werden pro Session zwischengespeichert, nicht dauerhaft gespeichert).
- Beim Login eines SuS: für jede IServ-Gruppe, zu der ein Kurs existiert,
  automatisch als `course-student` eintragen. Access-Codes bleiben als
  zweiter Weg (AGs, Fördergruppen).
- Schuljahreswechsel: Kurse archivieren, keine automatische Löschung (Std 15,
  Frist festlegen).

### Phase 3 – Token-API für den Lernstand (1 Tag) — **erledigt 2026-10-09** (ADR 0004)

Ergebnis: Modell `ApiToken`, `lib/auth/bearer.js` (Strategie `bearer`, Scopes ∩ Rolle),
`lib/services/lernstand.js`, Controller `apiv1`/`tokens`, Seite `/account/tokens`,
`docs/lernix/openapi.yaml`. Endpunkt für die Matrix heißt `…/lernstand` (statt `dashboard`).
Tests: 145 grün.

Ursprünglicher Umfang:
- Modell `ApiToken` (`userId`, `name`, `hash`, `scopes`, `lastUsedAt`,
  `revokedAt`); Hapi-Strategie `bearer`; Routen nur lesend:
  - `GET /api/v1/me`
  - `GET /api/v1/courses` (Kurse der Lehrkraft)
  - `GET /api/v1/courses/{id}/dashboard` (Matrix SuS × Aufgabe)
  - `GET /api/v1/courses/{id}/assignments`
  - `GET /api/v1/courses/{id}/users/{userId}/submissions`
  - `GET /api/v1/trinkets/{id}` (Code einer Abgabe)
- Wirksame Rechte = Token-Scopes ∩ Rolle; Token verliert mit der Rolle die
  Rechte. Verwaltung unter `/account/tokens`, Secret nur einmal sichtbar.
- OpenAPI-Beschreibung (`docs/lernix/openapi.yaml`), damit SchulAssistent
  und Portal andocken können.

### Phase 4 – Oberfläche (1–2 Tage) — **erledigt 2026-10-09** (ADR 0005)

Entscheidungen Marc: Login erzwingen, alles auf Deutsch, alle Bibliotheken selbst hosten.
Ergebnis: `lib/auth/access.js` (Allowlist, Einbettungen bleiben offen), deutsche Templates,
Partials, Bibliotheks-Ansichten, JS-Meldungen und Python-Hilfen; `config/vendor.json` +
`scripts/vendor-fetch.js` (51 Verweise, Schriften per @fontsource, MathJax per npm);
Konto-Seiten E-Mail/Passwort nur noch für Nicht-IServ-Konten. Tests: 152 grün.

Offen (klein, bei Bedarf): Admin-Bereich bleibt englisch; Embeds der abgeschalteten
Sprachen unübersetzt; Kurs-Editor zeigt die IServ-Gruppe noch nicht an.

Ursprünglicher Umfang:
- Deutsch für Login, Kursseiten, Dashboard, Aufgabenansicht (Nunjucks und
  AngularJS-Partials; Rest schrittweise).
- SuS-Startseite „Meine Aufgaben“ über alle Kurse (offen, fällig, abgegeben).
- Lehrkraft-Startseite: alle Kurse mit Abgabe-Zählern.
- Branding: Name, Logo aus `.env`/`public/img`.

### Phase 5 – Betrieb (½ Tag) — **erledigt 2026-10-09** (live unter https://trinket.lernix.site)

Erledigt: `docs/lernix/BETRIEB.md` (Erstinstallation, `.env`, IServ-Client, NPM, erster Admin,
Prüfen, Update, Backup/Restore, Aufbewahrung, Fehlersuche, Protokoll der Inbetriebnahme in
Abschnitt 11), `deploy/npm/README.md` + `advanced.conf`, deutsches `README.md`.

Deploy 2026-10-09 auf dockervm2 (`/opt/trinket`, Port 8090), DNS-CNAME `trinket` → `lernix.site`,
NPM mit Let's Encrypt, IServ-Client „trinket.lernix.site“. Live getestet: IServ-Login als
Lehrkraft, Admin per `make-admin`, Notfallzugang, Kurs mit IServ-Gruppe, Lektion/Aufgabe, Python
im Editor, keine CDN-Anfragen, Lernstand-API mit Token, Wartungs-Probelauf, Backup.
Entscheidungen: Port 8090 im LAN offen (kein ufw auf der VM), `ADMIN_IP_ALLOWLIST=*`.

Beim Deploy behobene Fehler: Login-Rücksprung auf Schriftdatei (`/assets` öffentlich, kein
`next` für Unterressourcen), 500er auf `/login` für Angemeldete, jQuery UI im Editor (404),
Dropzone-CSS vom CDN (+ CDN-Prüfung im Image-Bau), altes Notfall-Konto nach Adresswechsel.

Offen: Test mit einem Schülerkonto (Rolle, automatische Kursaufnahme über IServ-Gruppe);
Admin-Oberfläche und einige Editor-Texte noch englisch.

Ursprünglicher Umfang:
- `docs/lernix/BETRIEB.md`: NPM-Proxy-Host, IServ-Client anlegen, Erststart,
  Break-Glass, Backup/Restore (`mongodump`/`mongorestore`), Update aus Upstream.
- Deploy auf Docker-VM, NPM-Host, DNS `trinket` → 93.205.103.135.

## 8. Entscheidungen zu den Rückfragen (Marc, 2026-10-09)

1. **Kein Einrichtungsassistent.** Konfiguration nur per `.env`, Verwaltung über
   die bestehende `/admin`-Seite. Abweichung von Std 3 → ADR 0001.
2. **Port `8090`** auf der Docker-VM.
3. **IServ-Gruppen werden automatisch Kursen zugeordnet.** Access-Codes bleiben
   als zweiter Weg erhalten.
4. **Trinket-Typen für SuS:** Python, HTML, Blocks und GlowScript.
5. **Aufbewahrung:** SuS-Trinkets und Abgaben bis Schuljahresende + 30 Tage
   Papierkorb, wie bei LeFo (Std 15) → ADR 0002.
6. **Repo:** `mrckch/trinket-lernix` als GitHub-Fork.
7. **Mail komplett aus.** Keine SMTP-Konfiguration, keine Einladungs- oder
   Reset-Mails.
