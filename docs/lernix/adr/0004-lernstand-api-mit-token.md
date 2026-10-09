# ADR 0004 — Lernstand-API mit Bearer-Token

Datum: 2026-10-09
Status: **angenommen** (Schreibrechte: ADR 0006)

## Kontext

Der Lernstand soll von außen lesbar sein (SchulAssistent, Portal). trinket-oss hat rund 130
Routen, aber alle nur mit Session-Cookie; die Antwortformen sind an die AngularJS-Oberfläche
gebunden. Glossar und HTML_Share haben ein erprobtes Token-Modell (ADR-0004 dort).

## Entscheidung

### Token

- Modell `ApiToken`: `_owner`, `name`, `prefix`, `hash` (SHA-256 des Geheimnisses), `scopes`,
  `lastUsedAt`, `revokedAt`. Geheimnis `tl_` + 48 Hex-Zeichen, nur einmal beim Anlegen sichtbar.
  SHA-256 genügt, weil das Geheimnis zufällig und lang ist (kein Passwort).
- Nur **Lehrkräfte und Admins** legen Token an (`/account/tokens`, `POST /api/tokens`).
  SuS haben keine API.
- Wirksame Rechte = Token-Scopes ∩ von der Rolle erlaubte Scopes, bei jeder Anfrage neu
  berechnet. Verliert ein Konto die Lehrkraft-Rolle, liefern seine Token sofort 403.
- Scopes (alle lesend): `courses:read`, `submissions:read`, `trinkets:read`.
- Widerruf setzt `revokedAt`; die Zeile bleibt zur Nachvollziehbarkeit.

### Zugriff

- Eigene Hapi-Auth-Strategie `bearer`; `/api/v1/*` akzeptiert **nur** Bearer, nie Cookies.
  Damit gibt es keine CSRF-Fläche und keine Vermischung mit der Oberfläche.
- Kurszugriff über das vorhandene Kursrecht `view-assignment-submissions` (Owner, Kurs-Admin);
  Trinkets, wenn eigen oder aus einem solchen Kurs.
- Alle Fachlogik in `lib/services/lernstand.js`, die Controller bleiben dünn (Std 2). Die
  Zusammenfassung der Zustände folgt dem Dashboard der Oberfläche
  (`submitted`/`submittedLate` > `completed` > `started`/`modified`).

### Endpunkte (`docs/lernix/openapi.yaml`)

| Pfad | Scope |
|---|---|
| `GET /api/v1/me` | – |
| `GET /api/v1/courses` | `courses:read` |
| `GET /api/v1/courses/{id}` (Gliederung) | `courses:read` |
| `GET /api/v1/courses/{id}/students` | `courses:read` |
| `GET /api/v1/courses/{id}/lernstand` (Matrix + Zusammenfassung) | `submissions:read` |
| `GET /api/v1/courses/{id}/students/{userId}/submissions` | `submissions:read` |
| `GET /api/v1/trinkets/{id}` (Code, Rückmeldungen) | `trinkets:read` |

Fehler im Hapi/Boom-Format (`statusCode`, `error`, `message`) wie im Rest der App, nicht als
RFC 9457 – Abweichung von Std 2 zugunsten der Einheitlichkeit innerhalb von trinket-oss.

## Verworfene Alternativen

| Alternative | Warum nicht |
|---|---|
| Vorhandene Session-API per Token öffnen | Antwortformen UI-gebunden, viele schreibende Routen, CSRF-Fragen. |
| JWT ohne Datenbank | Kein Widerruf, keine Nutzungsanzeige; Token-Tabelle ist hier einfacher. |
| Schreibende Scopes jetzt | Kein Bedarf (YAGNI); das Modell ist dafür erweiterbar. |

## Konsequenzen

- `lastUsedAt` wird höchstens einmal pro Minute geschrieben (keine Schreiblast pro Anfrage).
- `POST /api/tokens` läuft über die Session ohne eigenes CSRF-Token (wie die restliche
  Session-API; Cookie ist `SameSite`). Bei einem CSRF-Konzept für die ganze App mitziehen.
- Tests: `test/lib/api/apiv1.js` (Token-Verwaltung, 401/403, alle Endpunkte am Beispiel einer
  gestarteten Aufgabe).
