# ADR 0005 — Login-Pflicht, deutsche Oberfläche, selbst gehostete Bibliotheken

Datum: 2026-10-09
Status: **angenommen** (Entscheidungen Marc, 2026-10-09)

## Kontext

trinket.io war ein öffentlicher Dienst: Jeder konnte ohne Konto Trinkets anlegen, die
Oberfläche war englisch, und rund 35 Frontend-Bibliotheken kamen von cdnjs, Google und
code.jquery.com. Trinket Lernix ist eine Schulanwendung mit SuS-Daten (Std 7, Std 8:
keine externen CDNs, deutsche Oberfläche).

## Entscheidung

### Login-Pflicht (`REQUIRE_LOGIN`, Default `true`)

- `lib/auth/access.js`, Hapi-Erweiterung `onPostAuth`: Ohne Anmeldung sind nur erreichbar
  - Start-, Login-, Über- und Hilfeseite, `/healthz`, statische Dateien,
  - die Anmelde-Routen `/auth/*`,
  - die Token-API `/api/v1/*` (eigene Authentifizierung),
  - **Einbettungen vorhandener Trinkets** (`GET /embed/{lang}/{id}`) mit den Aufrufen, die der
    Embed zum Laden und Zählen braucht (`GET /api/trinkets/{id}`, Metriken, Fehler-Log,
    Dateien). So funktionieren in IServ-Seiten eingebettete Trinkets weiterhin für alle.
- Alles andere – Anlegen, Speichern, Remixen, Bibliothek, Kurse, leere Editoren – braucht ein
  Konto. HTML-Anfragen werden mit Rücksprung (`?next=`) zum Login umgeleitet, API-Anfragen
  bekommen `401`.
- Die Liste ist bewusst eine Allowlist (fail closed): Neue Routen sind automatisch geschützt.
- Für die Upstream-Tests ist die Pflicht in `config/test.yaml` aus; `test/lib/api/access.js`
  schaltet sie gezielt ein.

### Deutsche Oberfläche

- Nunjucks-Templates, AngularJS-Partials (auch die unter `public/js/library/`), die
  Bibliotheks- und Kurs-Controller sowie die Embed-Toolbar sind auf Deutsch; Anrede „du“ für
  SuS-Seiten, neutrale Formulierungen auf Lehrkraft-Seiten. Rollen heißen in der Oberfläche
  Schüler:in, Gast, Mitarbeitend, Kursadmin, Kursleitung.
- Die Python-Schlüsselwort-Hilfen (`public/partials/python-docs`) sind deutsch und nutzen
  Python-3-Syntax.
- `moment.js` lädt die Locale `de` (Datumsangaben wie „vor 3 Minuten“).
- Englisch bleiben: der Admin-Bereich (`/admin`, nur Marc), E-Mail-Vorlagen (Mail ist aus),
  Embeds der abgeschalteten Sprachen (Python 3, Java, R, Pygame, Musik), Konsolenausgaben
  von Skulpt. Alt-Texte, die nur Upstream-Fehler ausgeben (`Debug:`), bleiben Logs.
- Umsetzung über direkte Texte statt einer i18n-Schicht: Das Upstream-`translate` ist ein
  Stub ohne Wörterbuch, und ein Rückweg zu Englisch ist kein Ziel (Std 10, YAGNI).

### Selbst gehostete Bibliotheken (`public/vendor/`)

- `config/vendor.json` listet alle vormals externen URLs; `scripts/vendor-fetch.js` lädt sie
  beim Image-Bau nach `public/vendor/<cdnjs|googleapis|jquery>/…`, holt die in CSS
  referenzierten Schriften/Bilder nach und prüft am Ende, dass jeder `/vendor/`-Verweis im
  Code existiert (`--check`). Ohne Netz beim Bau schlägt der Bau fehl – gewollt.
- MathJax, Lato und Merriweather kommen als npm-Pakete (`mathjax`, `@fontsource/*`) und
  werden aus `node_modules` kopiert; Google Fonts entfallen.
- `public/vendor` und das Vite-Ergebnis `public/assets` sind nicht im Repo (`.gitignore`).
- Verbleibende externe Links sind nur noch Dokumentations-Links (webvpython.org, GitHub).

## Verworfene Alternativen

| Alternative | Warum nicht |
|---|---|
| Login-Pflicht per `auth: 'session'` an jeder Route | ~130 Routen einzeln; neue Routen wären standardmäßig offen. |
| Einbettungen ebenfalls sperren | Trinkets in IServ-Seiten müssten sich SuS erst anmelden; die Einbettung zeigt nur bestehenden Code. |
| i18n-Framework mit Sprachdateien | Keine zweite Sprache geplant; Aufwand ohne Nutzen. |
| Bibliotheken ins Repo committen | 73 MB Binärdaten in Git; die Manifest-Lösung ist reproduzierbar und versioniert die URLs. |

## Konsequenzen

- Das Image braucht beim Bau Internet (npm, Komponenten-Tarball, Vendor-Dateien).
- Upstream-Merges in Templates werden konfliktreicher; die Übersetzung ist die bewusste
  Abzweigung (ADR 0001 nennt die YAML-Konfiguration als unangetastet, Templates nicht).
- Tests: `test/lib/api/access.js` (öffentliche Pfade, Umleitung, 401, Einbettung, Abschaltung).
