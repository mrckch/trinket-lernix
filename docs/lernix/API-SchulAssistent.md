# Trinket Lernix: Token-API für den SchulAssistent

Stand: 09.10.2026, live auf https://trinket.lernix.site (ADR 0006). Vollständige Beschreibung:
`docs/lernix/openapi.yaml`. Diese Seite ordnet die Endpunkte nach Unterrichtsschritten, damit der
SchulAssistent passende MCP-Werkzeuge bekommt.

## Zugang

| | |
|---|---|
| Basis | `https://trinket.lernix.site/api/v1` |
| Kopfzeile | `Authorization: Bearer tl_<48 Hex-Zeichen>` (nie Cookies) |
| Token anlegen | als Lehrkraft: **Einstellungen → API-Tokens** (`/account/tokens`); das Token wird genau einmal angezeigt |
| Prüfpfad | `GET /me` (kein Scope nötig; liefert die wirksamen Scopes) |
| Scopes | lesend `courses:read`, `submissions:read`, `trinkets:read`; schreibend `courses:write`, `content:write`, `submissions:write`, `trinkets:write`, `students:manage` |

Vorschlag für `zugang.APPS`:

```python
"trinket": App("trinket", "Trinket Lernix", "TRINKET_URL", "https://trinket.lernix.site", "TRINKET_TOKEN",
               "/api/v1/me", "/account/tokens"),   # Einstellungen -> API-Tokens (Lehrkraft)
```

Ein Token kann nie mehr als seine Lehrkraft und wirkt nur in deren Kursen (Kursleitung, Kurs-Admin;
Inhalte auch als Mitarbeitende). Fehler: `{ statusCode, error, message, details? }`.

| Status | Wann |
|---|---|
| 400 | Eingabe ungültig oder unbekanntes Feld (`details` nennt die Felder) |
| 401 | Token fehlt, ungültig oder widerrufen |
| 403 | Scope fehlt, Rolle reicht nicht, fremder Kurs, fremdes Trinket |
| 404 | Kurs/Lektion/Material/Person/Trinket nicht gefunden oder nicht in diesem Kurs |
| 409 | Zustand passt nicht (z. B. noch nicht abgegeben, verspätet → erst annehmen, Vorlage in Benutzung) |
| 413 / 429 | zu groß (1/2/5 MB) / mehr als 120 Schreibzugriffe pro Minute (`Retry-After`) |

IDs sind 24-stellige Hex-Werte; Zeitpunkte ISO 8601 (`2026-10-19T07:45:00Z`). Bei Datumsfeldern
setzt ein Wert das Datum, `null` schaltet es ab, Weglassen lässt es, wie es ist.

## 1. Kurs anlegen

| Schritt | Aufruf | Scope |
|---|---|---|
| eigene IServ-Gruppen | `GET /iserv/groups` → `[{ act, name }]` (Stand letzter Login) | courses:read |
| Kurs anlegen | `POST /courses { name, description?, courseType?: private, contentDefault?: draft, iservGroup?: { act } }` → 201 | courses:write |
| Gruppe ändern/lösen | `PUT /courses/{id}/iserv-group { act }` · `DELETE …/iserv-group` | courses:write |
| Zugangscode (AGs) | `GET /courses/{id}/access-code` · `POST …/access-code` (neu) | courses:read / courses:write |
| Kurse auflisten | `GET /courses` · Gliederung `GET /courses/{id}` | courses:read |
| neues Schuljahr | `POST /courses/{id}/copy { name }` (ohne SuS/Abgaben/Gruppe), alten Kurs `PATCH /courses/{id} { archived: true }` | courses:write |
| löschen | `DELETE /courses/{id}?confirm=true` (nur Kursleitung; lieber archivieren) | courses:write |

SuS einer verknüpften Gruppe landen beim nächsten IServ-Login automatisch im Kurs. Liefert
`/iserv/groups` nichts, muss sich die Lehrkraft einmal neu anmelden.

## 2. Reihe importieren und Aufgaben stellen

| Schritt | Aufruf | Scope |
|---|---|---|
| ganze Reihe | `POST /courses/{id}/import { lessons: [{ name, isDraft?, materials: [Material…] }] }` → 201 mit allen IDs; wird vorher komplett geprüft, ein Fehler hinterlässt nichts | content:write |
| Lektion | `POST /courses/{id}/lessons { name, isDraft?, index? }` · `PATCH …/lessons/{lid} { name?, isDraft? }` · `DELETE …` | content:write |
| Seite/Aufgabe | `POST /courses/{id}/lessons/{lid}/materials` (Material, s. u.) | content:write |
| ändern/löschen | `PATCH /courses/{id}/materials/{mid}` · `DELETE …` (mit Abgaben nur `?confirm=true`, sonst 409; eine Lektion nimmt ihre Materialien mit) | content:write |
| lesen | `GET /courses/{id}/materials/{mid}` (Inhalt + Vorlage mit Code; `?python=true` für Blöcke als Python) | courses:read |
| sortieren | `PUT /courses/{id}/lessons/order { lessonIds }` · `PUT …/lessons/{lid}/materials/order { materialIds }` (holt Material aus anderen Lektionen) | content:write |
| Vorlagen-Bibliothek | `GET /trinkets?lang=` · `POST /trinkets { lang, name, code \| files }` · `PATCH`/`DELETE /trinkets/{id}` | trinkets:read / trinkets:write |

**Material** (`type` `page` oder `assignment`):

```json
{ "type": "assignment", "name": "Quadrat", "content": "Zeichne mit einer Schleife ein Quadrat.",
  "isDraft": false,
  "starter": { "lang": "blocks", "code": "<xml xmlns=\"http://www.w3.org/1999/xhtml\"></xml>" },
  "availableOn": "2026-10-12T07:45:00Z", "hideAfter": null,
  "submissionsDue": "2026-10-19T07:45:00Z", "submissionsCutoff": null }
```

- `content` ist Markdown (bei Aufgaben die Aufgabenstellung).
- `starter`: entweder `{ trinketId }` (eigenes Bibliotheks-Trinket) oder `{ lang, code | files }`.
  Wird eine geteilte Vorlage per `PATCH` geändert, bekommt nur diese Aufgabe eine eigene Kopie.
  Sprachen wie freigeschaltet: `python`, `blocks`, `html`, `glowscript`, `glowscript-blocks`.
  `code` = Hauptdatei bzw. Blockly-XML; `files` = `[{ name, content, hidden? }]`.
- Sichtbarkeit wie in der Oberfläche: Entwürfe (`isDraft`) sehen SuS nie, Aufgaben nur zwischen
  `availableOn` und `hideAfter`. „Ab Montag freischalten“ = `PATCH … { availableOn }`.
- Abgabe nach `submissionsDue` gilt als verspätet; nach `submissionsCutoff` ist sie gesperrt.

## 3. Abgaben auswerten

| Schritt | Aufruf | Scope |
|---|---|---|
| Überblick | `GET /courses/{id}/lernstand` (Matrix SuS × Aufgabe, Zählungen) | submissions:read |
| eine Aufgabe, alle SuS | `GET /courses/{id}/assignments/{mid}/submissions?includeCode=true` | submissions:read |
| eine SuS, alle Versuche | `GET /courses/{id}/students/{uid}/submissions` | submissions:read |
| ein Trinket | `GET /trinkets/{tid}` (Code, Dateien, Rückmeldungen; `?python=true` für `pythonCode`) · `GET /trinkets/{tid}?format=python` (reiner Python-Text) | trinkets:read |

Je SuS liefert die Aufgaben-Übersicht `state` (`not-started`, `started`, `submitted`, `completed`),
`attempts` und das maßgebliche `trinket` (verspätet > abgegeben > zurückgegeben > angefangen) mit
`files`, `feedback.studentComment` und – bei Blöcken – `pythonCode`. Auch angefangene Arbeit zeigt den
aktuellen Stand (Autosave). `pythonCode` stammt aus denselben Generatoren wie die Python-Ansicht im
Editor und wird nur auf Wunsch erzeugt (`includeCode=true`, `python=true`, `format=python`);
scheitert die Umwandlung, steht der Grund in `pythonError` (bei `format=python` → 422). Grenzen:
3000 Blöcke, 1000 Variablen, 200 Plätze je Block, etwa 1 s je Programm.
Ausführen muss der SchulAssistent den Code selbst (z. B. in einer Sandbox); Turtle-Programme laufen
nur mit einer Turtle-Attrappe.

## 4. Rückmeldung geben

| Schritt | Aufruf | Scope |
|---|---|---|
| Entwurf vorbereiten | `PUT /trinkets/{tid}/feedback-draft { comment }` – erscheint vorausgefüllt im Dashboard, die Lehrkraft schickt ab | submissions:write |
| direkt zurückgeben | `POST /trinkets/{tid}/feedback { comment, allowResubmit?, revision?: { code \| files } }` → `completed` | submissions:write |
| verspätete Abgabe annehmen | `POST /trinkets/{tid}/accept` (erst danach Rückmeldung) | submissions:write |

- `tid` ist das `trinket.id` aus der Abgaben-Übersicht. Rückmeldung nur zu `submitted`/`completed`;
  erneutes Senden ändert die bestehende Rückmeldung (kein Duplikat); ohne `revision` bleibt eine
  vorhandene Überarbeitung samt `includeRevision` erhalten.
- `revision` = korrigierte Fassung, die SuS sehen (`includeRevision` sonst `false`).
  `allowResubmit: true` erlaubt eine neue Abgabe.
- Es gibt keine Noten/Punkte im Datenmodell – bei Bedarf in den Kommentartext.
- Empfehlung für den SchulAssistent: standardmäßig nur **Entwürfe** schreiben; direktes Zurückgeben
  erst nach ausdrücklicher Bestätigung der Lehrkraft.

## 5. Teilnehmende

| Schritt | Aufruf | Scope |
|---|---|---|
| Liste | `GET /courses/{id}/students` (nur SuS) · `GET /courses/{id}/members` (alle mit Rolle) | courses:read |
| aufnehmen | `POST /courses/{id}/students { login }` (Benutzername oder E-Mail, nur SuS-Konten; sonst 404) → 201, schon da → 200 `alreadyListed` | students:manage |
| ausblenden | `PATCH /courses/{id}/members/{uid} { onDashboard: false }` | students:manage |
| Rolle | `PATCH /courses/{id}/members/{uid} { role: student \| collaborator \| admin \| associate }` (außer `student` nur für Lehrkräfte) | students:manage |
| entfernen | `DELETE /courses/{id}/members/{uid}` (über IServ eingetragene SuS kommen beim nächsten Login wieder – dann ausblenden) | students:manage |

## Vorschlag für MCP-Werkzeuge

| Werkzeug | Endpunkte |
|---|---|
| `trinket_kurse` | `GET /courses`, `GET /courses/{id}` |
| `trinket_kurs_anlegen` | `GET /iserv/groups`, `POST /courses` |
| `trinket_reihe_importieren` | `POST /courses/{id}/import` |
| `trinket_export` | `GET /courses/{id}/export.zip` |
| `trinket_aufgabe_stellen` / `_aendern` | `POST …/materials`, `PATCH /courses/{id}/materials/{mid}` |
| `trinket_freischalten` | `PATCH …/materials/{mid} { isDraft, availableOn, hideAfter }` |
| `trinket_lernstand` | `GET /courses/{id}/lernstand` |
| `trinket_abgaben` | `GET /courses/{id}/assignments/{mid}/submissions?includeCode=true` |
| `trinket_rueckmeldung_entwurf` | `PUT /trinkets/{tid}/feedback-draft` |
| `trinket_rueckmeldung_senden` (mit Rückfrage) | `POST /trinkets/{tid}/accept`, `POST /trinkets/{tid}/feedback` |
| `trinket_teilnehmende` | `GET …/members`, `PATCH`/`DELETE …/members/{uid}`, `POST …/students` |
