# ADR 0008 — Anonyme Auswertung, um Aufgaben und App zu verbessern

Datum: 2026-11-23
Status: **angenommen** (Marc, 2026-11-23: „Ja, so bauen“)

Vorbild ist ADR 0011 in Hamster Lernix (Stufe 1, dort am 2026-11-23 akzeptiert). Anlass ist Marcs
Frage vom selben Tag, ob sich mit anonymen Daten der SuS die Apps verbessern lassen. Diese ADR
überträgt die Stufe 1 auf das Datenmodell von Trinket Lernix. Alles aus ADR 0003 (Aufbewahrung),
ADR 0004 (Lernstand) und ADR 0007 (Rückmeldungen) gilt weiter.

## Kontext

Die Fragen gehen an die **Aufgaben**, nicht an einzelne Kinder: Welche Aufgabe ist zu schwer? Wie
oft probieren die Kinder, bis sie abgeben? Wo verlangt die Lehrkraft oft eine Überarbeitung? Wo
steigen viele aus?

Was Trinket dazu schon speichert (alles personenbezogen, für den Lernstand des Kurses):

| Daten | Wo | Bedeutung |
|---|---|---|
| Arbeitsfassung je Kind und Aufgabe | `Snippet` mit `materialId`, `courseId`, `_creator`, Zustand `started` oder `modified` | `startedOn`, `lastUpdated`, `codeLastUpdated` |
| Abgabe je Kind und Aufgabe | `Snippet` mit Zustand `submitted`, `submittedLate` oder `completed` | `submittedOn` (letzte Abgabe), Rückmeldungen in `comments`, `submissionOpts.allowResubmit` („Noch einmal bearbeiten lassen“) |
| Läufe | `Interaction` mit `action: 'runs'`, `_trinket`, `_actor`, Zeit aus der ObjectId | Der Editor meldet einen Lauf, wenn der Code seit dem Laden der Seite noch nicht so gelaufen ist. Läufe mit gleichem Code zählen also einmal. |
| Aufgabe | `Material` (Typ `assignment`) mit Name und Vorlage (`trinket.trinketId`, Sprache, Startcode) | |

Es gibt keine automatische Prüfung, keine Tipps und keine Sterne. `completed` heißt „Rückmeldung
gesendet“, nicht „richtig gelöst“. Ein Geschafft wie im Hamster gibt es also nicht. Am nächsten
kommt ihm die Abgabe.

Es gibt auch **keine feste Reihe**. Jede Aufgabe gehört einer Lehrkraft. Gleiche Aufgaben in
mehreren Kursen entstehen auf drei Wegen:

1. **Kurs kopieren** (Oberfläche oder `POST /api/v1/courses/{id}/copy`): Name, Sprache und Startcode
   werden kopiert, die Vorlage bekommt `_parent`.
2. **Reihe importieren** (`POST /api/v1/courses/{id}/import`, zum Beispiel aus dem SchulAssistent):
   dieselbe Beschreibung in mehrere Kurse, jede Aufgabe mit eigener Vorlage, aber gleichem Namen
   und Startcode.
3. **Dieselbe Vorlage aus der Bibliothek** in mehreren Aufgaben (`starter.trinketId`).

## Grundsatz

Wie im Hamster: Ausgewertet wird **je Aufgabe, nie je Person und nie je Kurs**. Das Ergebnis
enthält keine Namen von Kindern oder Lehrkräften, keine Benutzer-IDs, keine Kurse und keine
Uhrzeiten. Eine Zahl erscheint nur, wenn mindestens **5 verschiedene Kinder** dahinterstehen, sonst
steht dort „zu wenige“. Keine Pseudonyme (keine gehashten Benutzer-IDs), denn pseudonyme Daten
bleiben personenbezogen (DSGVO, Erwägungsgrund 26).

## Entscheidungen

### 1. Welche Aufgaben ausgewertet werden

- **Gleiche Aufgabe** heißt: gleicher Name (Leerraum am Rand entfernt, innen zusammengefasst),
  gleiche Sprache und gleicher Startcode der Vorlage (Zeilenenden vereinheitlicht). Das deckt
  alle drei Wege oben ab, solange niemand die Aufgabe danach umbenennt oder den Startcode ändert.
  Eine so veränderte Aufgabe gilt als eigene Aufgabe.
- **Nur Aufgaben, die in mindestens 2 Kursen bearbeitet wurden**, das heißt: Die gezählten Kinder
  einer Aufgabe kommen aus mindestens 2 verschiedenen Kursen. Eine Aufgabe aus nur einem Kurs
  wird nicht ausgewertet, weil ihr Name sonst den Kurs verrät.
- Ein Kind, das dieselbe Aufgabe in zwei Kursen bearbeitet, zählt einmal: mit der Abgabe, sonst mit
  der zuletzt geänderten Fassung.
- Der Schlüssel ist ein Hash über Name, Sprache und Startcode. Er wird nicht gespeichert und
  erscheint nur, wenn zwei verschiedene Aufgaben denselben Namen und dieselbe Sprache haben
  (dann als kurze Kennung hinter dem Namen, damit man sie auseinanderhält).
- Grenze: Zwei Lehrkräfte, die unabhängig je eine Aufgabe „Aufgabe 1“ mit leerem Startcode
  anlegen, landen in derselben Zeile. Das verfälscht diese Zeile, verrät aber niemanden. Wer die
  Ausgabe liest, erkennt solche Namen.

### 2. Stufe 1: Kennzahlen aus vorhandenen Daten (keine neuen Daten)

Gezählt werden die Trinkets von SuS-Konten (Site-Rolle `student`, nicht `teacher` oder `admin`, wie
in `lib/util/retention.js`) zu Kursaufgaben. Ein Trinket zählt, wenn es im gewählten Schuljahr
angelegt wurde und nicht im Papierkorb liegt. Ein Kind zählt bei einer Aufgabe, wenn es **selbst etwas getan hat**: Code
geändert (`modified`), mindestens einmal selbst ausgeführt oder abgegeben. Nur geöffnet zählt
nicht.

| Kennzahl je Aufgabe | Quelle |
|---|---|
| Bearbeitet (Kinder) | Kinder, die selbst etwas getan haben |
| Abgegeben (Anteil) | Zustand `submitted`, `submittedLate` oder `completed` |
| Läufe bis zur Abgabe (Median, oberes Viertel) | eigene Läufe (`_actor` = das Kind) in den Trinkets des Kindes zu dieser Aufgabe bis `submittedOn`, nur wer abgegeben hat |
| Minuten bis zur Abgabe (Median) | aus den Zeitpunkten der eigenen Läufe geschätzt: Lücken bis 10 Minuten zählen als Arbeitszeit, längere Lücken trennen Sitzungen; nur wer abgegeben hat |
| Überarbeitung verlangt (Anteil der Abgaben mit Rückmeldung) | `allowResubmit` gesetzt oder nach einer Rückmeldung erneut abgegeben |
| Nachgebessert (Anteil davon) | nach einer Rückmeldung erneut abgegeben (`submittedOn` nach der Rückmeldung) |
| Ausgestiegen (Anteil aller Bearbeitungen) | nicht abgegeben und seit 14 Tagen nichts mehr getan (letzte Änderung oder letzter eigener Lauf; bei einem vergangenen Schuljahr: 14 Tage vor seinem Ende) |

- Gerechnet wird beim Aufruf. Nichts davon wird gespeichert.
- Jede Kennzahl hat die Mindestgröße von 5 Kindern. Anteile werden auf ganze Prozent gerundet. Bei
  „Bearbeitet“ steht unter 5 nur „< 5“.
- Bewusst nicht dabei: verspätete Abgaben und „Rückmeldung bekommen“. Beides hängt an Fälligkeit
  und Arbeitsweise der Lehrkraft, nicht an der Aufgabe.
- Die Läufe sind eine Näherung: Läuft derselbe Code mehrmals, zählt das einmal. Die Minuten sind eine
  Schätzung. Für eine grobe Rangfolge der schweren Aufgaben reicht das.
- Zeitraum: ein Schuljahr (1. August bis 31. Juli), wählbar. Weil die Wartung SuS-Trinkets nach dem
  Schuljahresende in den Papierkorb legt (ADR 0003) und der Papierkorb nicht mitzählt, ist ein
  Schuljahr nur bis zu seinem Ende auswertbar. Die Auswertung also im Juli laufen lassen.

### 3. Stufe 2 (nicht Teil dieser ADR)

Anonyme Zähler, zum Beispiel für Python-Fehlertypen je Aufgabe, bräuchten neue Daten aus dem
Editor. Das entscheidet eine eigene ADR, wenn Stufe 1 zeigt, dass es sich lohnt.

### 4. Wer die Auswertung sieht

- **Nur Admins mit Zugang zur VM**, über die Kommandozeile:
  `docker compose exec app node scripts/auswertung.js [--schuljahr 2026/27]`. Die Ausgabe ist
  Markdown: eine Tabelle je Sprache (Python, Blöcke, HTML …), darin eine Zeile je Aufgabe.
- Keine Route, keine Seite in der Oberfläche, kein Zugriff per Token.
- Die Logik steht in `lib/services/auswertung.js` (Rechnen getrennt vom Laden aus MongoDB, damit es
  sich ohne Datenbank testen lässt), das Skript ruft nur auf.
- Ausgaben dürfen aufbewahrt und weitergegeben werden, zum Beispiel an die Fachkonferenz, weil sie
  anonym sind. Vorher kurz prüfen, ob irgendwo „zu wenige“ hätte stehen müssen und ob ein
  Aufgabenname etwas über eine Person verrät.

## Folgen

- Keine neuen Daten, keine Änderung an Modellen oder gespeicherten Daten, keine neue Route.
- **Lehrkräfte:** Die Ausgabe nennt keine Lehrkraft, aber ein Aufgabenname kann auf die Lehrkraft
  schließen lassen. Die Auswertung dient der Verbesserung der Aufgaben, nicht der Bewertung von
  Lehrkräften.
- **Datenschutz-Unterlagen der Schule:** Die Auswertung nutzt Daten, die für den Unterricht schon
  gespeichert sind, und dient der Verbesserung des Unterrichtsmaterials. Das Ergebnis enthält nur
  Zahlen über Gruppen. Das gehört in die Unterlagen, zusammen mit Hamster Lernix (ADR 0011). Vor dem
  ersten Einsatz kurz mit der oder dem Datenschutzbeauftragten der Schule absprechen.
- Trinket hat keine Hilfe-Seite „Datenschutz“ für SuS. `BETRIEB.md` beschreibt den Befehl und die
  Grenzen.
- Die Mindestgröße schützt nur vor dem Erraten aus der Ausgabe. Wer Admin ist, kann ohnehin in die
  Datenbank sehen. Daran ändert diese ADR nichts.
