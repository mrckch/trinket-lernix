# ADR 0003 — IServ-Gruppen als Kurse, Aufbewahrung je Schuljahr

Datum: 2026-10-09
Status: **angenommen** (Entscheidungen Marc, 2026-10-09)

## Kontext

Lerngruppen existieren bereits in IServ. Lehrkräfte sollen Kurse nicht von Hand mit
Schülerinnen und Schülern befüllen müssen; Access-Codes bleiben für AGs und Fördergruppen.
Die Aufbewahrung von SuS-Daten soll wie bei LeFo an das Schuljahr gebunden sein
(Std 15, Entscheidung: Schuljahresende + 30 Tage Papierkorb).

## Entscheidung

### Verknüpfung Kurs ↔ IServ-Gruppe

- Ein Kurs trägt optional `externalLink = { source: 'iserv', sourceId: <act>, name }`.
  `act` ist die stabile IServ-Kennung (Umbenennungen ändern sie nicht), `name` die Anzeige.
- Verknüpfen darf, wer `manage-course-access` hat **und** selbst Mitglied der Gruppe ist
  (Gruppen liegen nur in der Session, `iservGroups`); Admins dürfen jede Gruppe.
  Beim Anlegen (`POST /api/courses`, Feld `iservGroupAct`, Auswahl im Formular) oder
  nachträglich (`PUT /api/courses/{id}/iserv-group`, `act: ''` löst).
- Mehrere Kurse dürfen dieselbe Gruppe nutzen (Mathe und Informatik derselben Klasse).

### Automatische Zuordnung beim Login

- Bei jedem Login eines **reinen SuS-Kontos** (`student`, nicht `teacher`/`admin`):
  - in alle aktiven Kurse eintragen, deren Gruppe in den Claims steht (`joinedVia: 'iserv'`),
  - aus Kursen austragen, die mit einer Gruppe verknüpft sind, in der die Person nicht mehr
    ist – aber **nur**, wenn sie über IServ eingetragen wurde (`joinedVia: 'iserv'`).
- `joinedVia` wird für alle Wege gesetzt: `owner`, `iserv`, `code`, `invite`, `manual`.
  Beitritte per Code, Einladung oder Hand bleiben von der Automatik unberührt.
- Lehrkräfte werden nie automatisch eingetragen (Mitlehrkräfte wie bisher von Hand).
- Fehler in der Zuordnung brechen den Login nicht ab, sie werden protokolliert.
- Dev-Login kann Gruppen simulieren (`groups: "klasse.9b:Klasse 9b, …"`).

### Aufbewahrung (täglicher Lauf `scripts/maintenance.js`, Dienst `maintenance`)

Zustandslos und wiederholbar; Stichtag ist das letzte Schuljahresende
(`RETENTION_SCHOOL_YEAR_END`, Default `07-31`) vor dem Lauf:

1. IServ-verknüpfte Kurse, die vor dem Stichtag angelegt wurden → `archived: true`
   (keine automatische Zuordnung mehr; Inhalte bleiben der Lehrkraft erhalten, sie kann
   kopieren oder neu verknüpfen).
2. Trinkets von SuS-Konten (eigene Projekte **und** Abgaben), die vor dem Stichtag entstanden
   sind → Papierkorb (`deletedAt`). Trinkets von Lehrkräften bleiben.
3. Papierkorb leeren: alles mit `deletedAt` älter als `RETENTION_TRASH_DAYS` (Default 30)
   wird endgültig gelöscht, samt Entwürfen und Interaktions-Log.

`RETENTION_ENABLED=false` schaltet den Lauf ab; `--dry-run` zählt nur.

### Datensparsamkeit im Interaktions-Log

`Interaction` speichert IP-Adresse und Referer nur noch mit `features.storeClientAddress: true`
(Default `false`); der Pre-Save-Hook entfernt die Felder.

## Verworfene Alternativen

| Alternative | Warum nicht |
|---|---|
| Gruppen dauerhaft am Nutzer speichern | Nicht nötig, Claims kommen bei jedem Login; weniger personenbezogene Daten (ADR 0002). |
| Kurse automatisch aus Gruppen erzeugen | Lehrkraft soll bewusst entscheiden, welche Gruppe welchen Kurs bekommt; Fachkurse ≠ Klassen. |
| Austragen auch bei Code-/Einladungs-Beitritt | Würde bewusste Entscheidungen der Lehrkraft überschreiben. |
| Unbefristete Aufbewahrung (Portfolio) | Entscheidung Marc: Schuljahresbezug wie bei LeFo. |
| Datum des letzten Laufs speichern | Stichtags-Logik ist ohne Zustand wiederholbar und damit robuster (Neustart, Nachholen). |

## Konsequenzen

- Vor dem ersten Produktivlauf einen `--dry-run` ansehen: alle SuS-Trinkets, die vor dem
  letzten 31.07. entstanden sind, landen im Papierkorb.
- Nach dem Stichtag müssen Lehrkräfte für das neue Schuljahr neue Kurse anlegen bzw. den
  alten kopieren und neu verknüpfen.
- Die Kurs-Oberfläche zeigt die Verknüpfung noch nicht an (Phase 4); API und Formular stehen.
- Tests: `test/lib/api/groups.js`, `test/lib/util/retention.js`.
