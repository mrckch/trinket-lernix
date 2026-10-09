# ADR 0006 — Token-API mit Schreibrechten

Datum: 2026-10-09
Status: **vorgeschlagen** (Branch `api-ausbau`, noch nicht in `main`)

## Kontext

Die Lernstand-API (ADR 0004) ist nur lesend. Marc will den ganzen Unterrichtsablauf aus externen
Werkzeugen steuern, vor allem aus dem SchulAssistent (MCP-Server, spricht andere Apps schon per
Bearer-Token an): Kurse und Reihen anlegen, Aufgaben stellen, Abgaben auswerten und mit Rückmeldung
zurückgeben. Block-Aufgaben (Blockly) speichern XML; für eine Auswertung von außen braucht es den
Python-Code dazu. Alles muss dieselben Daten erzeugen wie die Oberfläche.

## Entscheidung

### Scopes und Rechte

| Scope | Erlaubt |
|---|---|
| `courses:read`, `submissions:read`, `trinkets:read` | wie ADR 0004 (lesend) |
| `courses:write` | Kurse anlegen, ändern, archivieren, kopieren, löschen; IServ-Gruppe; Zugangscode |
| `content:write` | Lektionen, Seiten, Aufgaben (Vorlage, Daten, Entwurf), Reihenfolge, Reihen-Import |
| `submissions:write` | Rückmeldung senden, Entwurf vorbereiten, verspätete Abgabe annehmen |
| `trinkets:write` | Trinkets der **eigenen** Bibliothek anlegen, ändern, löschen |
| `students:manage` | Teilnehmende aufnehmen/entfernen, im Dashboard aus-/einblenden, Kursrolle ändern |

- Wirksame Rechte bleiben **Token-Scopes ∩ Rolle**, bei jeder Anfrage neu berechnet. Nur Lehrkräfte
  und Admins bekommen Scopes; ein Token mit Scopes außerhalb der eigenen Rolle wird nicht angelegt.
- Zusätzlich gelten **dieselben Kursrechte wie in der Oberfläche**: `update-course-details`,
  `manage-course-content`, `manage-course-access`, `delete-course`, `send-submission-feedback`,
  Archivieren nur mit Rolle `course-owner`. Ein Token wirkt damit nur in eigenen bzw. verwalteten
  Kursen (Kursleitung, Kurs-Admin; Inhalte auch Mitarbeitende).
- Abweichung von der Oberfläche: **Kopieren** per Token nur bei Kursen, deren Inhalte man bearbeiten
  darf (oder mit Kopierrecht `make-course-copy`). Die Oberfläche lässt jede Lehrkraft jeden
  öffentlichen Kurs kopieren; per Token soll ein fremder Kurs nie Ziel sein.
- Token-Verwaltung bleibt pro Person: Liste, Seite und Widerruf zeigen bzw. treffen nur eigene Token
  (`revokeToken` sucht mit `_owner`; fremde Token → 404).

### Gleiche Daten wie die Oberfläche

- Fachlogik in `lib/services/kursverwaltung.js` (Kurse, Lektionen, Material, Teilnehmende),
  `lib/services/rueckmeldung.js` (Rückmeldungen) und `lib/services/trinkets.js` (Code-Format,
  Bibliothek). Sie verwenden die Modellmethoden der Oberfläche (`addUser`, `setGlobalSettings`,
  `setIservGroup`, `setDates`, `createBlankForAssignment`, `copy`, `updateView`, `updateRole` …).
- Die Rückmeldungs-Routen der Oberfläche (`sendFeedback`, `acceptSubmission`,
  `autosaveFeedbackComments`) rufen jetzt denselben Service auf. Dabei wird geprüft, dass die Abgabe
  zum Kurs der URL gehört (vorher nicht).
- Abläufe wie im Dashboard: „submittedLate“ → annehmen → „submitted“ → Rückmeldung → „completed“
  (Kommentar `feedback` + Überarbeitungs-Trinket, `submissionOpts`); Entwurf als `feedback-draft`
  füllt das Formular der Oberfläche vor. Eine **Note/Punktzahl** gibt es im Datenmodell nicht und
  wird nicht eingeführt (bei Bedarf in den Kommentartext).
- Code wird wie im Editor gespeichert: Editor-Sprachen als JSON-Liste `[{ name, content, hidden }]`,
  Blöcke als Blockly-XML.

### Blöcke → Python

Gewählt: **dieselben Generatoren wie im Browser, ohne Blockly-Kern.** Der Server lädt
`core/names.js`, `core/generator.js`, `generators/python.js` und `generators/python/*.js` aus
`public/components/blockly` (Fork `trinketapp/blockly` v20180924 aus dem Release-Tarball, siehe
Dockerfile) sowie die eigenen Blöcke `public/js/embed/blocks/{turtle,more_text,matplotlib}.js` in einen
`vm`-Kontext. Ein schlankes Block-/Workspace-Modell (`lib/services/blocks/index.js`) liefert genau die
Schnittstelle, die die Generatoren nutzen (Felder, Eingänge, Mutationen von `controls_if`,
`procedures_*`, `lists_create_with`, `text_join`, Variablenmodelle, Reihenfolge der Top-Blöcke nach
Position). Einstellungen wie im Editor: `disableInitVariables_`, `oneBasedIndex`.

- Prüfung: Die Testfälle (`test/data/blocks`) wurden mit dem echten `blockly_compressed.js` +
  `python_compressed.js` im Browser übersetzt; die Server-Ausgabe ist zeichengleich (Schleifen,
  Turtle, Funktionen mit Parametern, Rückgabewerte, Variablen, if/elif/else, Modulo, Zufall, Listen,
  Text, Farben, Diagramme, deaktivierte und freie Blöcke).
- Sicherheit: SuS-XML wird nur mit einem eigenen kleinen Parser gelesen (keine DTD/Entitäten,
  Grenzen für Größe 1 MB, Tiefe, 3000 Blöcke), nie ausgeführt; in den `vm`-Kontext kommen nur
  Dateien aus dem Image.
- Grenzen: nur `lang = blocks` (GlowScript-Blöcke haben einen eigenen Blockly-Fork → `pythonError`);
  ohne `public/components` (lokal ohne Tarball) gibt es nur `pythonError`; Kommentare an Wertblöcken
  werden in XML-Reihenfolge gesammelt – bei Blockly-XML dieselbe wie im Editor, nur bei von Hand
  geschriebenem XML kann die Reihenfolge der Kommentarzeilen abweichen; fehlen in solchem XML Felder,
  fehlen deren Standardwerte aus der Blockdefinition (Ausgabe kann dann abweichen oder scheitern).

### IServ-Gruppen ohne Session

Die Token-API hat keine Session, die IServ-Gruppen lagen bisher nur dort (ADR 0002/0003). Für
Lehrkräfte und Admins speichert der Login jetzt die **eigene** Gruppenliste (nur Kennung und Name,
`user.iserv.groups`, `groupsAt`); bei jedem Login überschrieben, bei Verlust der Lehrkraft-Rolle
gelöscht. SuS-Gruppen werden weiterhin **nie** gespeichert. Verknüpfen per Token: Admins jede Gruppe,
Lehrkräfte nur gespeicherte eigene. Nach dem Update muss sich jede Lehrkraft einmal neu anmelden.

### Schutz

- `/api/v1` nimmt nur `Authorization: Bearer`, nie Cookies (kein CSRF). `lib/auth/access.js` lässt
  `/api/v1` durch, weil die Token-Prüfung die Anmeldung ersetzt.
- Jede Eingabe wird mit Joi geprüft; unbekannte Felder → 400 (keine Mass Assignment); Fehler mit
  `details`. Grenzen: 1 MB (Default), 2 MB bei Code/Material, 5 MB beim Reihen-Import.
- Schreibbremse je Token: 120 Schreibzugriffe pro Minute (`app.api.writeLimitPerMinute`), sonst 429
  mit `Retry-After` (im Speicher des Prozesses).
- Protokoll: eine Zeile je Schreibzugriff (`API-Schreibzugriff METHODE Pfad → Status von <Benutzer>
  (Token <Anfang>… „Name“): was`), auch für abgelehnte Versuche.
- Kurs löschen nur mit `?confirm=true`; Bibliotheks-Trinkets, die Vorlage einer Aufgabe sind, lassen
  sich nicht löschen (409).

### Endpunkte

Vollständig in `docs/lernix/openapi.yaml`, nach Anwendungsfall in `docs/lernix/API-SchulAssistent.md`.

## Verworfene Alternativen

| Alternative | Warum nicht |
|---|---|
| Session-Routen der Oberfläche per Token öffnen | Antwortformen UI-gebunden, Validierungsfehler kommen als 200, CSRF-/Cookie-Vermischung. |
| npm `blockly` (aktuell) headless | Anderer Generator (andere Ausgabe als der Editor), Eigenblöcke müssten portiert werden, jsdom als schwere Abhängigkeit. |
| Ganzes Blockly 2018 mit jsdom | Neue Abhängigkeit, Blockly-Kern braucht DOM-Details; Gewinn gegenüber dem schlanken Modell gering. |
| Eigener XML→Python-Übersetzer | Doppelte Pflege, Abweichungen zum Editor wären sicher. |
| Gruppen nur in der Session lassen | Dann ginge Verknüpfen per Token nur für Admins. |
| Noten-Feld einführen | Kein Bedarf in der Oberfläche; eigenes Thema (Datenschutz, Export). |

## Konsequenzen

- Neue Abhängigkeiten: keine.
- Die Server-Umwandlung hängt am Komponenten-Tarball; wird Blockly dort aktualisiert, die
  Referenz-Ausgaben in `test/data/blocks` neu erzeugen.
- Die Schreibbremse ist pro Prozess; bei mehreren App-Instanzen gilt sie je Instanz.
- Tests: `test/lib/api/apiv1-write.js` (Token-Trennung, alle Endpunkte, 401/403/404/409/429/413,
  Gleichlauf mit der Oberfläche), `test/lib/util/blocks.js` (XML → Python).
